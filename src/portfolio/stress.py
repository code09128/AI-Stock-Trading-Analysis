"""
歷史回落壓力測試 (stress.py)：用「目前持股數量」回推過去約 2 年的組合價值走勢，
找出組合實際發生過的最大回撤與最差 20 個交易日跌幅（真實還權日 K，不是線性估算）。
限制：假設持股數量不變、匯率固定為目前值（未計入匯率波動）、兩市場休市日不同以前值補齊。
"""

from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, List, Optional
import threading
import time

from src.market.data_adapter import DualMarketDataAdapter
from src.market import etf_data

TTL = 1800
_LOCK = threading.Lock()
_CACHE: Dict[str, Any] = {}


def _closes(symbol: str) -> Optional[Dict[str, float]]:
    with _LOCK:
        hit = _CACHE.get(symbol)
        if hit and time.time() - hit["t"] < TTL:
            return hit["v"]
    ad = DualMarketDataAdapter()
    for ysym in etf_data._yahoo_candidates(symbol):
        try:
            bars = ad._fetch_from_yahoo(ysym, days=500)
        except Exception:
            continue
        if len(bars) > 60:
            v = {b.timestamp: b.close for b in bars}
            with _LOCK:
                _CACHE[symbol] = {"t": time.time(), "v": v}
            return v
    return None


def historical_stress(holdings: List[Dict[str, Any]], usd_twd: float) -> Dict[str, Any]:
    syms = [str(h["symbol"]) for h in holdings]
    with ThreadPoolExecutor(max_workers=6) as ex:
        series = dict(zip(syms, ex.map(_closes, syms)))
    ok = [h for h in holdings if series.get(str(h["symbol"]))]
    missing = [str(h["symbol"]) for h in holdings if not series.get(str(h["symbol"]))]
    if not ok:
        return {"available": False, "reason": "所有持股都查無歷史日 K", "missing": missing}

    dates = sorted({d for h in ok for d in series[str(h["symbol"])]})
    # 從所有持股都有資料的第一天開始
    start = max(min(series[str(h["symbol"])]) for h in ok)
    dates = [d for d in dates if d >= start]
    # 起點當天某市場可能休市（例如台股＋美股）：先帶入各檔在起點以前最近一天的收盤，不然那幾天市值會被當成 0
    last: Dict[str, float] = {}
    for h in ok:
        s = str(h["symbol"])
        before = [d for d in series[s] if d <= start]
        if before:
            last[s] = series[s][max(before)]
    values: List[float] = []
    for d in dates:
        total = 0.0
        for h in ok:
            s = str(h["symbol"])
            if d in series[s]:
                last[s] = series[s][d]
            mult = h.get("fx_rate") or (1.0 if h.get("market", "TW").upper() == "TW" else usd_twd)
            total += last.get(s, 0.0) * float(h["shares"]) * mult
        values.append(total)
    if len(values) < 40:
        return {"available": False, "reason": "共同歷史資料不足 40 個交易日", "missing": missing}

    # 最大回撤
    peak_i, mdd, mdd_pair = 0, 0.0, (0, 0)
    for i, v in enumerate(values):
        if v > values[peak_i]:
            peak_i = i
        dd = v / values[peak_i] - 1
        if dd < mdd:
            mdd, mdd_pair = dd, (peak_i, i)
    # 最差 20 個交易日
    worst20, w_pair = 0.0, (0, 0)
    for i in range(20, len(values)):
        r = values[i] / values[i - 20] - 1
        if r < worst20:
            worst20, w_pair = r, (i - 20, i)
    now = values[-1]
    return {
        "available": True,
        "period": f"{dates[0]} ~ {dates[-1]}",
        "trading_days": len(values),
        "max_drawdown_pct": round(mdd * 100, 2),
        "max_drawdown_window": f"{dates[mdd_pair[0]]} → {dates[mdd_pair[1]]}",
        "max_drawdown_loss_twd": round(now * mdd, 0),
        "worst_20d_pct": round(worst20 * 100, 2),
        "worst_20d_window": f"{dates[w_pair[0]]} → {dates[w_pair[1]]}",
        "worst_20d_loss_twd": round(now * worst20, 0),
        "missing": missing,
        "note": "以目前持股數量回推；各幣別假設匯率不變（用目前匯率換算）。歷史不代表未來，極端行情可能更大。",
    }
