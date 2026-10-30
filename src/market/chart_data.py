"""
看盤頁的圖表資料 (chart_data.py)：大盤指數列、當日分時走勢、自選股迷你走勢 (sparkline)
全部來自 Yahoo Finance Chart API（經 quote_provider._http_json，請求會記錄在抓取紀錄），取不到就回 None/空陣列，不填假資料。
"""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from typing import Any, Dict, List, Optional
import urllib.parse

from src.market import quote_provider as qp
from src.market.cache import TTLCache
from src.market.data_adapter import DualMarketDataAdapter

INDICES = [
    ("^TWII", "加權指數"),
    ("^GSPC", "S&P 500"),
    ("^IXIC", "那斯達克"),
    ("^DJI", "道瓊"),
    ("^SOX", "費城半導體"),
    ("TWD=X", "USD/TWD"),
]
INDEX_NAMES = dict(INDICES)

INTRADAY_TTL = 30
SPARK_TTL = 600
_CACHE = TTLCache()


def _get(key: str, ttl: int):
    return _CACHE.get(key, ttl)


def _put(key: str, value: Any) -> None:
    _CACHE.put(key, value)


def _yahoo_symbols(symbol: str) -> List[str]:
    n = DualMarketDataAdapter.normalize_symbol(symbol)
    if n["market"] != "TW":  # 台股以外：Yahoo 代號就是正規化後的 symbol（含後綴）
        return [n["symbol"]]
    primary = n["symbol"] if n["symbol"].endswith((".TW", ".TWO")) else f"{n['raw_code']}.TW"
    alt = f"{n['raw_code']}.TWO" if primary.endswith(".TW") else f"{n['raw_code']}.TW"
    return [primary, alt]


def _chart(ysym: str, interval: str, rng: str) -> Dict[str, Any]:
    url = f"{qp.YAHOO_URL}{urllib.parse.quote(ysym)}?interval={interval}&range={rng}"
    return qp._http_json(url, timeout=10)["chart"]["result"][0]


def indices() -> List[Dict[str, Any]]:
    quotes = qp.get_quotes([s for s, _ in INDICES], INDEX_NAMES)
    out = []
    for q in quotes:
        if not q.get("is_live"):
            continue
        out.append(
            {
                "symbol": q["symbol"],
                "name": INDEX_NAMES.get(q["symbol"], q["symbol"]),
                "price": q["price"],
                "change": q["change"],
                "change_pct": q["change_pct"],
                "quote_time": q.get("quote_time"),
            }
        )
    return out


def _extract_intraday_points(res: Dict[str, Any]):
    meta = res.get("meta") or {}
    quote = (res.get("indicators", {}).get("quote") or [{}])[0]
    gmt = meta.get("gmtoffset", 0)
    pts = []
    for i, ts in enumerate(res.get("timestamp") or []):
        c = quote.get("close", [None] * (i + 1))[i]
        if c is None:
            continue
        v = (quote.get("volume") or [0] * (i + 1))[i] or 0
        local = datetime.utcfromtimestamp(ts + gmt)
        pts.append({"date": local.strftime("%Y-%m-%d"), "t": local.strftime("%H:%M"), "ts": ts, "close": round(c, 4), "volume": v})
    return pts, meta, gmt


def intraday(symbol: str) -> Optional[Dict[str, Any]]:
    """當日 5 分鐘走勢 + 昨收 + 日內/52 週高低 + 交易時段；若當日無資料則自動回退取最後成交日。"""
    key = f"intraday:{symbol}"
    cached = _get(key, INTRADAY_TTL)
    if cached:
        return cached
    last_err = None
    for ysym in _yahoo_symbols(symbol):
        res = None
        try:
            res = _chart(ysym, "5m", "1d")
        except Exception as e:
            last_err = str(e)

        pts_1d, meta_1d, gmt_1d = _extract_intraday_points(res) if res else ([], {}, 0)
        pts = [{"t": p["t"], "ts": p["ts"], "close": p["close"], "volume": p["volume"]} for p in pts_1d]
        meta = meta_1d
        is_fallback = False
        trade_date = pts_1d[-1]["date"] if pts_1d else None
        prev_close = meta.get("chartPreviousClose") or meta.get("previousClose")
        day_high = meta.get("regularMarketDayHigh")
        day_low = meta.get("regularMarketDayLow")
        reg = (meta.get("currentTradingPeriod") or {}).get("regular") or {}
        session_start = reg.get("start")
        session_end = reg.get("end")

        if len(pts) < 2:
            try:
                res_5d = _chart(ysym, "5m", "5d")
                res = res or res_5d
                pts_5d, meta_5d, gmt_5d = _extract_intraday_points(res_5d)
                distinct_dates = sorted(set(p["date"] for p in pts_5d))
                if distinct_dates:
                    candidate_date = next((d for d in reversed(distinct_dates) if sum(1 for p in pts_5d if p["date"] == d) >= 2), distinct_dates[-1])
                    candidate_pts = [p for p in pts_5d if p["date"] == candidate_date]
                    if candidate_pts:
                        pts = [{"t": p["t"], "ts": p["ts"], "close": p["close"], "volume": p["volume"]} for p in candidate_pts]
                        meta = meta_5d
                        is_fallback = True
                        trade_date = candidate_date
                        prev_close = meta_5d.get("previousClose") or meta_5d.get("chartPreviousClose")
                        closes = [p["close"] for p in pts]
                        day_high = max(closes)
                        day_low = min(closes)
                        session_start = pts[0]["ts"]
                        session_end = pts[-1]["ts"]
            except Exception as e:
                if not last_err:
                    last_err = str(e)

        if not pts and not res:
            continue

        # 開盤前（例如美股台灣白天）：Yahoo「1 天」回的仍是上一個交易日的點，交易時段卻已是今天，
        # 前端依時段算位置會把點全部畫在圖外 → 把時段整天往前移到這些點的那一天，並標成上一個交易日
        if len(pts) >= 2 and session_start and pts[-1]["ts"] < session_start:
            days = -(-(session_start - pts[0]["ts"]) // 86400)  # 無條件進位
            session_start -= days * 86400
            if session_end:
                session_end -= days * 86400
            is_fallback = True

        data = {
            "symbol": symbol,
            "yahoo_symbol": ysym,
            "points": pts,
            "prev_close": prev_close,
            "day_high": day_high,
            "day_low": day_low,
            "week52_high": meta.get("fiftyTwoWeekHigh"),
            "week52_low": meta.get("fiftyTwoWeekLow"),
            "session_start": session_start,
            "session_end": session_end,
            "timezone": meta.get("timezone"),
            "is_fallback": is_fallback,
            "trade_date": trade_date,
            "source": "Yahoo Finance Chart API（5 分鐘線）",
        }
        _put(key, data)
        return data
    return {"symbol": symbol, "points": [], "error": last_err or "查無分時資料"}


def _spark_one(symbol: str) -> List[float]:
    key = f"spark:{symbol}"
    cached = _get(key, SPARK_TTL)
    if cached is not None:
        return cached
    for ysym in _yahoo_symbols(symbol):
        try:
            res = _chart(ysym, "1d", "1mo")
        except Exception:
            continue
        closes = [round(c, 4) for c in (res["indicators"]["quote"][0].get("close") or []) if c]
        _put(key, closes)
        return closes
    return []


def sparks(symbols: List[str]) -> Dict[str, List[float]]:
    with ThreadPoolExecutor(max_workers=6) as ex:
        return dict(zip(symbols, ex.map(_spark_one, symbols)))


# ---------- 技術總覽（自選股一張表）----------
OVERVIEW_TTL = 300


def _overview_one(symbol: str, quote: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    key = f"overview:{symbol}"
    cached = _get(key, OVERVIEW_TTL)
    if cached:
        return cached
    try:
        # quote 由 overview() 一次批次抓好傳進來；沒有就不併即時價（不要每檔各自再連一次報價）
        snap = DualMarketDataAdapter().build_technical_snapshot(symbol, quote=quote, include_live=quote is not None)
        ind, close = snap["indicators"], snap["latest_close"]
        ma20, ma60 = ind.get("MA20"), ind.get("MA60")
        dist = lambda m: round((close / m - 1) * 100, 2) if m else None  # noqa: E731
        if ma20 and ma60:
            trend = "多頭" if close > ma20 > ma60 else "空頭" if close < ma20 < ma60 else "盤整"
        else:
            trend = "資料不足"
        row = {
            "symbol": snap["symbol"], "close": close, "date": snap["latest_date"],
            "rsi14": ind.get("RSI14"), "dist_ma20_pct": dist(ma20), "dist_ma60_pct": dist(ma60),
            "volume_ratio": snap.get("volume_ratio_20d"), "ret_5d_pct": snap.get("ret_5d_pct"),
            "ret_20d_pct": snap.get("ret_20d_pct"), "trend": trend, "is_live": snap.get("is_live"),
        }
    except Exception as e:
        row = {"symbol": symbol, "error": str(e)}
    _put(key, row)
    return row


def overview(symbols: List[str]) -> List[Dict[str, Any]]:
    quotes: Dict[str, Dict[str, Any]] = {}
    if any(_get(f"overview:{sym}", OVERVIEW_TTL) is None for sym in symbols):
        try:
            from src.server.config import WATCHLIST_NAMES
            for q in qp.get_quotes(symbols, WATCHLIST_NAMES):
                if q and q.get("symbol"):
                    quotes[q["symbol"]] = q
        except Exception:  # 抓不到即時報價就只用日 K
            pass
    norm = lambda sym: DualMarketDataAdapter.normalize_symbol(sym)["symbol"]  # noqa: E731
    with ThreadPoolExecutor(max_workers=4) as ex:
        return list(ex.map(lambda sym: _overview_one(sym, quotes.get(norm(sym))), symbols))


# ---------- 近 N 根日 K（說明頁的實例、大盤範例用）----------
def candles(symbol: str, n: int = 15) -> Dict[str, Any]:
    n = max(5, min(60, n))
    key = f"candles:{symbol}:{n}"
    cached = _get(key, SPARK_TTL)
    if cached:
        return cached
    last_err = None
    for ysym in _yahoo_symbols(symbol):
        try:
            res = _chart(ysym, "1d", "3mo")
        except Exception as e:
            last_err = str(e)
            continue
        q = res["indicators"]["quote"][0]
        rows = []
        for i, ts in enumerate(res.get("timestamp") or []):
            o, h, lo, c = (q[k][i] for k in ("open", "high", "low", "close"))
            if None in (o, h, lo, c):
                continue
            rows.append({"date": datetime.utcfromtimestamp(ts).strftime("%Y-%m-%d"), "open": round(o, 2),
                         "high": round(h, 2), "low": round(lo, 2), "close": round(c, 2),
                         "volume": (q.get("volume") or [0] * (i + 1))[i] or 0})
        data = {"symbol": symbol, "bars": rows[-n:], "source": "Yahoo Finance 日 K（指數不含還權）"}
        _put(key, data)
        return data
    return {"symbol": symbol, "bars": [], "error": last_err or "查無資料"}
