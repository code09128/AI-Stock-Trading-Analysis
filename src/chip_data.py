"""
台股籌碼面 (chip_data.py)
資料來源：FinMind（公開免 token 可用，設 FINMIND_TOKEN 可提高額度），收盤後才更新（T+1，盤中看不到當日）
- TaiwanStockInstitutionalInvestorsBuySell：三大法人買賣（股數，這裡換算成張）
  外資＝Foreign_Investor + Foreign_Dealer_Self；投信＝Investment_Trust；自營商＝Dealer_self + Dealer_Hedging
- TaiwanStockMarginPurchaseShortSale：融資／融券餘額（單位已是張）
- TaiwanStockShareholding：外資持股比例
只做描述性統計，不納入 100 分趨勢評分。取不到的資料集回 None 並列在 errors，不填假數字。快取 1 小時。
"""

from collections import defaultdict
from datetime import date, timedelta
from typing import Any, Dict, List, Optional
import threading
import time

from src import finmind
from src.data_adapter import DualMarketDataAdapter

DATASETS = {
    "inst": "TaiwanStockInstitutionalInvestorsBuySell",
    "margin": "TaiwanStockMarginPurchaseShortSale",
    "holding": "TaiwanStockShareholding",
}
GROUPS = {
    "Foreign_Investor": "foreign", "Foreign_Dealer_Self": "foreign",
    "Investment_Trust": "trust", "Dealer_self": "dealer", "Dealer_Hedging": "dealer",
}
WINDOWS = (5, 20)
CACHE_TTL_SEC = 3600
_CACHE: Dict[str, Any] = {}
_LOCK = threading.Lock()


def _finmind(dataset: str, code: str, start: str) -> List[Dict[str, Any]]:
    return finmind.get_data(dataset, code, start)


def _streak(values: List[int]) -> int:
    """最近連續買超（正）或賣超（負）的天數；最新一天為 0 時回 0。"""
    if not values or values[-1] == 0:
        return 0
    sign, n = values[-1] > 0, 0
    for v in reversed(values):
        if v == 0 or (v > 0) != sign:
            break
        n += 1
    return n if sign else -n


def _change(series: List[float], back: int) -> Optional[float]:
    if len(series) <= back:
        return None
    return series[-1] - series[-1 - back]


def summarize(inst_rows: Optional[List[Dict[str, Any]]], margin_rows: Optional[List[Dict[str, Any]]],
              holding_rows: Optional[List[Dict[str, Any]]]) -> Dict[str, Any]:
    """把三個資料集整理成近 5／20 日的統計與每日明細。任一資料集為 None 表示抓取失敗。"""
    daily: Dict[str, Dict[str, Any]] = defaultdict(dict)
    out: Dict[str, Any] = {"institutional": None, "margin": None, "foreign_holding": None}

    if inst_rows is not None:
        net: Dict[str, Dict[str, int]] = defaultdict(lambda: {"foreign": 0, "trust": 0, "dealer": 0})
        for r in inst_rows:
            g = GROUPS.get(r.get("name"))
            if g:
                net[r["date"]][g] += int(r.get("buy") or 0) - int(r.get("sell") or 0)
        dates = sorted(net)
        lots = {g: [round(net[d][g] / 1000) for d in dates] for g in ("foreign", "trust", "dealer")}
        for i, d in enumerate(dates):
            daily[d].update({g: lots[g][i] for g in lots})
        if dates:
            inst: Dict[str, Any] = {"days_available": len(dates)}
            for g, vals in lots.items():
                inst[g] = {f"net_{w}d": sum(vals[-w:]) for w in WINDOWS}
                inst[g]["streak"] = _streak(vals)
            out["institutional"] = inst

    if margin_rows is not None:
        rows = sorted(margin_rows, key=lambda r: r["date"])
        mb = [float(r.get("MarginPurchaseTodayBalance") or 0) for r in rows]
        sb = [float(r.get("ShortSaleTodayBalance") or 0) for r in rows]
        for r, m, s in zip(rows, mb, sb):
            daily[r["date"]].update({"margin_balance": int(m), "short_balance": int(s)})
        if rows:
            out["margin"] = {
                "margin_balance": int(mb[-1]),
                "short_balance": int(sb[-1]),
                "short_margin_ratio_pct": round(sb[-1] / mb[-1] * 100, 2) if mb[-1] else None,
                **{f"margin_change_{w}d": _change(mb, w) for w in WINDOWS},
                **{f"short_change_{w}d": _change(sb, w) for w in WINDOWS},
                "margin_usage_pct": round(mb[-1] / float(rows[-1]["MarginPurchaseLimit"]) * 100, 2)
                if rows[-1].get("MarginPurchaseLimit") else None,
            }

    if holding_rows is not None:
        rows = sorted(holding_rows, key=lambda r: r["date"])
        ratio = [float(r.get("ForeignInvestmentSharesRatio") or 0) for r in rows]
        for r, v in zip(rows, ratio):
            daily[r["date"]]["foreign_ratio_pct"] = v
        if rows:
            out["foreign_holding"] = {
                "ratio_pct": ratio[-1],
                **{f"change_{w}d_pct": round(c, 2) if (c := _change(ratio, w)) is not None else None
                   for w in WINDOWS},
            }

    dates = sorted(daily)
    out["latest_date"] = dates[-1] if dates else None
    out["daily"] = [{"date": d, **daily[d]} for d in dates[-20:]]
    out["notes"] = _notes(out)
    return out


def _notes(s: Dict[str, Any]) -> List[str]:
    """把數字翻成白話觀察（只描述事實，不做買賣建議）。"""
    notes = []
    inst, mg = s.get("institutional"), s.get("margin")
    names = {"foreign": "外資", "trust": "投信"}
    if inst:
        for g, label in names.items():
            k = inst[g]["streak"]
            if abs(k) >= 3:
                notes.append(f"{label}連續 {abs(k)} 日{'買超' if k > 0 else '賣超'}")
        f5, t5 = inst["foreign"]["net_5d"], inst["trust"]["net_5d"]
        if f5 * t5 < 0:
            notes.append(f"近 5 日外資與投信方向相反（外資 {f5:+,} 張、投信 {t5:+,} 張）")
    if inst and mg and mg.get("margin_change_5d") is not None:
        legal5 = sum(inst[g]["net_5d"] for g in ("foreign", "trust", "dealer"))
        m5 = mg["margin_change_5d"]
        if legal5 < 0 < m5:
            notes.append(f"近 5 日法人合計賣超 {abs(legal5):,} 張、融資卻增加 {int(m5):,} 張：籌碼由法人流向散戶")
        elif legal5 > 0 > m5:
            notes.append(f"近 5 日法人合計買超 {legal5:,} 張、融資減少 {abs(int(m5)):,} 張：籌碼由散戶流向法人")
    if mg and (mg.get("short_margin_ratio_pct") or 0) >= 30:
        notes.append(f"券資比 {mg['short_margin_ratio_pct']}% 偏高，空方部位多，上漲時可能出現回補")
    return notes


def chips(symbol: str) -> Dict[str, Any]:
    n = DualMarketDataAdapter.normalize_symbol(symbol)
    if n["market"] != "TW":
        return {"symbol": n["symbol"], "supported": False,
                "reason": "籌碼資料（三大法人、融資融券）只有台股有；美股沒有對應的公開每日資料"}
    code = n["raw_code"]
    with _LOCK:
        hit = _CACHE.get(code)
        if hit and time.time() - hit["t"] < CACHE_TTL_SEC:
            return hit["v"]

    # 抓約 45 個日曆天，確保有 20 個以上交易日（含連假）
    start = (date.today() - timedelta(days=45)).isoformat()
    got: Dict[str, Optional[List[Dict[str, Any]]]] = {}
    errors = []
    for key, ds in DATASETS.items():
        try:
            got[key] = _finmind(ds, code, start)
        except Exception as e:
            got[key] = None
            errors.append(f"{ds}: {e}")
    result = {
        "symbol": n["symbol"], "supported": True,
        **summarize(got["inst"], got["margin"], got["holding"]),
        "errors": errors,
        "source": "FinMind（三大法人買賣超、融資融券、外資持股），收盤後更新（T+1）",
    }
    with _LOCK:
        if len(errors) < len(DATASETS):  # 全部失敗不快取，下次重試
            _CACHE[code] = {"t": time.time(), "v": result}
    return result
