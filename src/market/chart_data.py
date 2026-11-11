"""
看盤頁的圖表資料 (chart_data.py)：大盤指數列、當日分時走勢、自選股迷你走勢 (sparkline)
全部來自 Yahoo Finance Chart API（經 quote_provider._http_json，請求會記錄在抓取紀錄），取不到就回 None/空陣列，不填假資料。
"""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from typing import Any, Dict, List, Optional
import urllib.parse

from src.market import quote_provider as qp
from src.market import markets
from src.market.bar import Bar
from src.technical import kline_rules
from src.market.cache import TTLCache
from src.market.data_adapter import DualMarketDataAdapter, is_partial_session

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
            # 2026-11 實測：Yahoo 台股分 K 固定落後約 20 分鐘，美股即時
            "delay_note": "台股分時資料約延遲 20 分鐘" if ysym.endswith((".TW", ".TWO")) else "",
        }
        _put(key, data)
        return data
    return {"symbol": symbol, "points": [], "error": last_err or "查無分時資料"}


# 分 K 週期（分鐘）→ Yahoo 取樣範圍（Yahoo 對分 K 有天數上限：5 分最多 60 天、15 分 60 天、60 分 730 天）
MINUTE_RANGES = {5: "5d", 15: "1mo", 60: "3mo"}
MINUTE_TTL = 30


def minute_bars(symbol: str, interval_min: int) -> Dict[str, Any]:
    """技術分析圖用的分 K：只含已收完的棒（進行中那根不算，避免畫面上的棒跟著跳動又沒有收盤價）。
    回傳 {interval, bars:[{date 'YYYY-MM-DD HH:MM'(當地時間), open, high, low, close, volume, change_pct, ma5, ma20, ma60, bb_upper, bb_lower}]}。
    取不到就拋錯，不填假資料。限制：Yahoo 分 K 台股有延遲、量可能缺值（缺值記 0）。"""
    import time as _time

    from src.technical.indicators import calculate_ma
    from src.technical.intraday import bollinger, closed_bars_only

    if interval_min not in MINUTE_RANGES:
        raise ValueError(f"分 K 週期只支援 {sorted(MINUTE_RANGES)} 分鐘")
    key = f"minutes:{symbol}:{interval_min}"
    cached = _get(key, MINUTE_TTL)
    if cached:
        return cached
    last_err = None
    for ysym in _yahoo_symbols(symbol):
        try:
            res = _chart(ysym, f"{interval_min}m", MINUTE_RANGES[interval_min])
        except Exception as e:
            last_err = str(e)
            continue
        q = (res.get("indicators", {}).get("quote") or [{}])[0]
        stamps = res.get("timestamp") or []
        rows = [
            (ts, (q.get("open") or [])[i], (q.get("high") or [])[i], (q.get("low") or [])[i],
             (q.get("close") or [])[i], (q.get("volume") or [])[i])
            for i, ts in enumerate(stamps) if i < len(q.get("close") or [])
        ]
        bars = closed_bars_only(rows, _time.time(), interval_min * 60)
        if not bars:
            last_err = "Yahoo 沒有回傳可用的分 K"
            continue
        gmt = (res.get("meta") or {}).get("gmtoffset", 0)
        closes = [b.close for b in bars]
        ma5, ma20, ma60 = (calculate_ma(closes, n) for n in (5, 20, 60))
        bb = bollinger(closes, 20, 2.0)
        out = []
        for i, b in enumerate(bars):
            prev = bars[i - 1].close if i else b.open
            local = datetime.utcfromtimestamp(int(b.timestamp) + gmt)
            out.append({
                "date": local.strftime("%Y-%m-%d %H:%M"),
                "open": round(b.open, 2), "high": round(b.high, 2), "low": round(b.low, 2), "close": round(b.close, 2),
                "volume": int(b.volume), "change_pct": round((b.close / prev - 1) * 100, 2) if prev else 0.0,
                "ma5": round(ma5[i], 2) if ma5[i] is not None else None,
                "ma20": round(ma20[i], 2) if ma20[i] is not None else None,
                "ma60": round(ma60[i], 2) if ma60[i] is not None else None,
                "bb_upper": round(bb[i]["upper"], 2) if bb[i] else None,
                "bb_lower": round(bb[i]["lower"], 2) if bb[i] else None,
            })
        result = {"symbol": symbol, "interval": interval_min, "bars": out}
        _put(key, result)
        return result
    raise RuntimeError(f"取不到 {symbol} 的 {interval_min} 分 K：{last_err}")


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
    _put(key, [])  # 查不到也記住，SPARK_TTL 內不要每次都再連 Yahoo
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
def five_days(symbol: str) -> Dict[str, Any]:
    """近 5 個交易日走勢（15 分鐘線），給個股頁走勢卡的「5 日」用。第一點的價當比較基準。"""
    key = f"five_days:{symbol}"
    cached = _get(key, SPARK_TTL)
    if cached:
        return cached
    last_err = None
    for ysym in _yahoo_symbols(symbol):
        try:
            pts, _meta, _gmt = _extract_intraday_points(_chart(ysym, "15m", "5d"))
        except Exception as e:
            last_err = str(e)
            continue
        if len(pts) < 2:
            continue
        data = {"symbol": symbol, "points": pts, "days": sorted({p["date"] for p in pts}),
                "source": "Yahoo Finance 15 分鐘線"}
        _put(key, data)
        return data
    return {"symbol": symbol, "points": [], "days": [], "error": last_err or "查無資料"}


def _last_bar_partial(symbol: str, rows: List[Dict[str, Any]]) -> bool:
    try:
        return bool(rows) and is_partial_session(markets.market_of(symbol), rows[-1]["date"])
    except Exception:
        return False


def candles(symbol: str, n: int = 15) -> Dict[str, Any]:
    n = max(5, min(60, n))
    key = f"candles:{symbol}:{n}"
    cached = _get(key, SPARK_TTL)
    if cached:
        return cached
    last_err = None
    for ysym in _yahoo_symbols(symbol):
        try:
            res = _chart(ysym, "1d", "6mo")
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
        # K 線收盤規則標記：用抓到的全部 K 棒（約 3 個月）計算，只回傳畫面上那段
        bars = [Bar(r["date"], r["open"], r["high"], r["low"], r["close"], r["volume"]) for r in rows]
        data["kline_rules"], data["kline_rules_error"] = kline_rules.visible(
            bars, data["bars"][0]["date"] if data["bars"] else "", _last_bar_partial(symbol, rows))
        _put(key, data)
        return data
    return {"symbol": symbol, "bars": [], "error": last_err or "查無資料"}
