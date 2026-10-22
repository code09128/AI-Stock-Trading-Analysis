"""
台美股雙市場外部行情與匯率串接層 (data_adapter.py)
核心職責：
1. 雙市場代號正規化 (TW: 2330 -> 2330.TW / US: NVDA -> NVDA)
2. 串接外部真實行情 API：
   - 台股優先支援 FinMind API (TaiwanStockPriceAdjusted 還權資料) 與 Yahoo Finance v8 Chart API
   - 美股支援 Yahoo Finance v8 Chart API (含 auto_adjust 還權與盤前盤後資訊)
3. 即時 USD/TWD 匯率抓取 (支援外部 API 與離線保底匯率)
4. 確定性離線回退機制 (Deterministic Fallback)：當無外部網路或 API 限流時，明確標示 data_source="FALLBACK_SAMPLE" 並回傳標準還權歷史序列，確保系統不中斷且不隱藏狀態 (Rule 12: Fail loud)。
"""

from typing import Dict, Any, List, Optional
from datetime import datetime, timedelta
import urllib.request
import urllib.parse
import json
import os
import re
import threading
import time

from src import finmind
from src.backtest_engine import Bar
from src.indicators import (
    calculate_ma,
    calculate_rsi,
    calculate_macd,
    calculate_atr,
    find_swing_levels,
)
from src.market_rules import align_tw_tick, get_tw_tick_size
from src.trend_score import score_trend

# 各市場當地時區與收盤時間，用來判斷最新一根日 K 是否還在盤中（成交量未收齊）
SESSION_CLOSE = {"TW": ("Asia/Taipei", "13:30"), "US": ("America/New_York", "16:00")}


def is_partial_session(market: str, bar_date: str, now: Optional[datetime] = None) -> bool:
    from zoneinfo import ZoneInfo

    tz, close_hm = SESSION_CLOSE.get(market, SESSION_CLOSE["US"])
    local = (now or datetime.now(ZoneInfo("UTC"))).astimezone(ZoneInfo(tz))
    return bar_date == local.strftime("%Y-%m-%d") and local.strftime("%H:%M") < close_hm


# 日 K 快取：技術分析頁每 5 秒重跑分析，不快取的話同一檔每小時會打上千次 Yahoo／FinMind。
# 失敗也快取（例如上櫃股查 .TW 會 404），60 秒內不重送；最新價另由即時報價覆蓋，不受影響。
BAR_CACHE_TTL_SEC = 60
_BAR_CACHE: Dict[Any, Any] = {}
_BAR_LOCK = threading.Lock()


def _cached_bars(key: Any, loader) -> List[Bar]:
    with _BAR_LOCK:
        hit = _BAR_CACHE.get(key)
    if hit and time.time() - hit[0] < BAR_CACHE_TTL_SEC:
        if isinstance(hit[1], Exception):
            raise hit[1]
        return hit[1]
    try:
        value = loader()
    except Exception as e:
        with _BAR_LOCK:
            _BAR_CACHE[key] = (time.time(), e)
        raise
    with _BAR_LOCK:
        _BAR_CACHE[key] = (time.time(), value)
    return value


def clear_bar_cache() -> None:
    with _BAR_LOCK:
        _BAR_CACHE.clear()


class DualMarketDataAdapter:
    """台美股雙市場資料串接器"""

    def __init__(
        self,
        finmind_token: Optional[str] = None,
        timeout: int = 6,
        allow_sample: Optional[bool] = None,
    ):
        self.finmind_token = finmind_token or os.environ.get("FINMIND_TOKEN", "")
        self.timeout = timeout
        # 預設查不到行情就報錯；只有明確設 TRADING_ALLOW_SAMPLE=1（離線開發/測試）才使用假資料
        self.allow_sample = (
            os.environ.get("TRADING_ALLOW_SAMPLE") == "1" if allow_sample is None else allow_sample
        )

    @staticmethod
    def normalize_symbol(raw_ticker: str) -> Dict[str, str]:
        """
        正規化台美股代號：
        - 輸入 '2330' 或 '2330.TW' -> {'market': 'TW', 'symbol': '2330.TW', 'raw_code': '2330', 'currency': 'TWD'}
        - 輸入 '6488.TWO' -> {'market': 'TW', 'symbol': '6488.TWO', 'raw_code': '6488', 'currency': 'TWD'}
        - 輸入 'NVDA' -> {'market': 'US', 'symbol': 'NVDA', 'raw_code': 'NVDA', 'currency': 'USD'}
        """
        clean = raw_ticker.strip().upper()
        # 處理空白後附帶中文名稱的情況，例如 "2330.TW 台積電" -> 取第一段代號
        token = clean.split()[0] if clean else "2330.TW"

        if re.match(r"^\d{4,6}[A-Z]?(\.TW|\.TWO)?$", token):
            raw_code = token.split(".")[0]
            symbol = token if "." in token else f"{token}.TW"
            return {
                "market": "TW",
                "symbol": symbol,
                "raw_code": raw_code,
                "currency": "TWD",
            }

        return {
            "market": "US",
            "symbol": token,
            "raw_code": token,
            "currency": "USD",
        }

    def fetch_usd_twd_rate(self) -> Dict[str, Any]:
        """抓取即時 USD/TWD 匯率，失敗時明確標示回退值"""
        url = "https://query1.finance.yahoo.com/v8/finance/chart/TWD=X?interval=1d&range=5d"
        try:
            req = urllib.request.Request(
                url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
            )
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                meta = data["chart"]["result"][0]["meta"]
                rate = float(meta.get("regularMarketPrice", 32.15))
                return {"usd_twd": round(rate, 3), "source": "LIVE_YAHOO_FX"}
        except Exception as e:
            return {
                "usd_twd": 32.15,
                "source": "FALLBACK_DEFAULT",
                "warning": f"無法連線即時匯率 API ({e})，改用預設基準匯率 32.15",
            }

    def fetch_bars(self, raw_ticker: str, days: int = 250) -> Dict[str, Any]:
        """
        取得歷史還權日 K 線資料。
        優先順序：
        1. 若為台股且設有 FINMIND_TOKEN（或公開查詢可用），嘗試呼叫 Yahoo / FinMind
        2. 嘗試呼叫 Yahoo Finance v8 Chart API (支援 .TW 與美股代號)
        3. 若外部網路皆不可達，回傳確定性基準 K 線並明確標註 source = 'FALLBACK_OFFLINE'
        """
        norm = self.normalize_symbol(raw_ticker)
        market = norm["market"]
        symbol = norm["symbol"]
        raw_code = norm["raw_code"]

        # 1. 優先嘗試 Yahoo Finance v8 API (同時支援 2330.TW 與 NVDA)
        # 上櫃股在 Yahoo 是 .TWO（例如 6488.TWO），只查 .TW 會 404 而落到 T+1 的 FinMind
        candidates = [symbol]
        if market == "TW":
            candidates.append(f"{raw_code}.TWO" if symbol.endswith(".TW") else f"{raw_code}.TW")
        last_error = "Yahoo Finance 回傳 K 線筆數不足"
        for ysym in candidates:
            try:
                bars = self._fetch_from_yahoo(ysym, days=days)
            except Exception as yahoo_err:
                last_error = str(yahoo_err)
                continue
            if len(bars) >= 20:
                return {
                    "market": market,
                    "symbol": ysym,
                    "currency": norm["currency"],
                    "data_source": "LIVE_YAHOO_FINANCE",
                    "is_live": True,
                    "bars": bars,
                }

        # 2. 若為台股，嘗試 FinMind API
        if market == "TW":
            try:
                bars = self._fetch_from_finmind(raw_code, days=days)
                if len(bars) >= 20:
                    return {
                        "market": market,
                        "symbol": symbol,
                        "currency": norm["currency"],
                        "data_source": "LIVE_FINMIND_API",
                        "is_live": True,
                        "bars": bars,
                    }
            except Exception as fm_err:
                last_error = f"{last_error} | FinMind: {fm_err}"

        # 3. 明確表面化錯誤 (Rule 12: Fail loud)；非離線開發模式下不提供假資料
        if not self.allow_sample:
            raise RuntimeError(
                f"查無 {symbol} 的行情資料：代號可能不存在，或行情來源無法連線（{last_error}）"
            )
        fallback_bars = self._generate_deterministic_bars(market, raw_code, count=max(days, 65))
        return {
            "market": market,
            "symbol": symbol,
            "currency": norm["currency"],
            "data_source": "FALLBACK_OFFLINE_SEED",
            "is_live": False,
            "fallback_reason": f"外部行情 API 無法連線或逾時 ({last_error})，已啟用本地基準驗證序列",
            "bars": fallback_bars,
        }

    def _fetch_from_yahoo(self, symbol: str, days: int = 250) -> List[Bar]:
        range_str = "1y" if days <= 260 else "2y"
        bars = _cached_bars(("yahoo", symbol, range_str), lambda: self._load_yahoo(symbol, range_str))
        return bars[-days:]

    def _load_yahoo(self, symbol: str, range_str: str) -> List[Bar]:
        encoded_sym = urllib.parse.quote(symbol)
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{encoded_sym}?interval=1d&range={range_str}"
        req = urllib.request.Request(
            url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
        )
        with urllib.request.urlopen(req, timeout=self.timeout) as resp:
            payload = json.loads(resp.read().decode("utf-8"))

        result = payload["chart"]["result"][0]
        timestamps = result.get("timestamp", [])
        quote = result["indicators"]["quote"][0]
        adj_close_list = (
            result["indicators"].get("adjclose", [{}])[0].get("adjclose", quote.get("close", []))
        )

        opens = quote.get("open", [])
        highs = quote.get("high", [])
        lows = quote.get("low", [])
        closes = quote.get("close", [])
        volumes = quote.get("volume", [])

        # Yahoo 常在收盤後一段時間內把最新一根日 K 的 OHLC 回傳為 None；
        # 用 meta 的當日成交價/高低/量補上，避免技術分析比報價落後一天
        meta = result.get("meta", {})
        last = len(timestamps) - 1
        if last >= 0 and last < len(closes) and closes[last] is None and meta.get("regularMarketPrice") \
                and (meta.get("regularMarketTime") or 0) >= timestamps[last]:
            price = meta["regularMarketPrice"]
            closes[last] = price
            highs[last] = highs[last] if highs[last] is not None else meta.get("regularMarketDayHigh", price)
            lows[last] = lows[last] if lows[last] is not None else meta.get("regularMarketDayLow", price)
            opens[last] = opens[last] if opens[last] is not None else price
            if last < len(volumes) and volumes[last] is None:
                volumes[last] = meta.get("regularMarketVolume", 0)
            if last < len(adj_close_list):
                adj_close_list[last] = None  # 讓下方以收盤價計算（比例 1.0）

        bars: List[Bar] = []
        for i, ts in enumerate(timestamps):
            o, h, l, c, v = (
                opens[i],
                highs[i],
                lows[i],
                closes[i],
                volumes[i] if i < len(volumes) else 0,
            )
            if None in (o, h, l, c):
                continue
            # 若有還權收盤價則按比例調整 OHLC
            adj_c = adj_close_list[i] if i < len(adj_close_list) and adj_close_list[i] else c
            ratio = (adj_c / c) if c and c > 0 else 1.0
            dt_str = datetime.utcfromtimestamp(ts).strftime("%Y-%m-%d")
            bars.append(
                Bar(
                    timestamp=dt_str,
                    open=round(float(o) * ratio, 2),
                    high=round(float(h) * ratio, 2),
                    low=round(float(l) * ratio, 2),
                    close=round(float(adj_c), 2),
                    volume=float(v or 0),
                )
            )
        return bars

    def _fetch_from_finmind(self, stock_id: str, days: int = 250) -> List[Bar]:
        start_date = (datetime.now() - timedelta(days=int(days * 1.6))).strftime("%Y-%m-%d")
        rows = _cached_bars(
            ("finmind", stock_id, start_date),
            lambda: finmind.get_data("TaiwanStockPrice", stock_id, start_date,
                                     token=self.finmind_token or None, timeout=self.timeout),
        )
        if not rows:
            raise RuntimeError("FinMind empty response")

        bars: List[Bar] = []
        for row in rows:
            bars.append(
                Bar(
                    timestamp=row["date"],
                    open=float(row["open"]),
                    high=float(row["max"]),
                    low=float(row["min"]),
                    close=float(row["close"]),
                    volume=float(row.get("Trading_Volume", 0)),
                )
            )
        return bars[-days:]

    @staticmethod
    def _generate_deterministic_bars(market: str, raw_code: str, count: int = 80) -> List[Bar]:
        """產生確定性、可重現的標準測試 K 線序列（當外部網路無法連線時使用）"""
        if market == "TW":
            base_price = 1000.0 if raw_code == "2330" else 200.0
            step = 2.0 if raw_code == "2330" else 0.5
        else:
            base_price = 130.0 if raw_code == "NVDA" else 180.0
            step = 0.4

        bars: List[Bar] = []
        start_dt = datetime(2026, 5, 1)
        curr = base_price

        for i in range(count):
            dt_str = (start_dt + timedelta(days=i)).strftime("%Y-%m-%d")
            # 製造具備真實波段起伏的確定性序列 (非隨機，確保測試 100% 可重現)
            wave = ((i % 9) - 3.5) * step
            curr = max(10.0, round(curr + wave * 0.35 + step * 0.25, 2))
            open_p = round(curr - step * 0.3, 2)
            high_p = round(max(open_p, curr) + abs(step) * 1.5, 2)
            low_p = round(min(open_p, curr) - abs(step) * 1.2, 2)
            vol = 35000.0 + (i % 7) * 2500.0
            bars.append(
                Bar(
                    timestamp=dt_str,
                    open=open_p,
                    high=high_p,
                    low=low_p,
                    close=curr,
                    volume=vol,
                )
            )
        return bars

    def build_technical_snapshot(self, raw_ticker: str) -> Dict[str, Any]:
        """
        整合資料抓取 + 指標計算 + 台股 Tick 對齊，產出模組 1 所需的完整量化快照。
        嚴格在 Python 端算好所有指標，禁止讓 AI 心算。
        """
        feed = self.fetch_bars(raw_ticker, days=220)
        bars: List[Bar] = feed["bars"]
        market = feed["market"]

        closes = [b.close for b in bars]
        highs = [b.high for b in bars]
        lows = [b.low for b in bars]

        ma5 = calculate_ma(closes, 5)[-1]
        ma20 = calculate_ma(closes, 20)[-1]
        ma60 = calculate_ma(closes, 60)[-1]
        ma200 = calculate_ma(closes, 200)[-1]
        rsi14 = calculate_rsi(closes, 14)[-1]
        macd_res = calculate_macd(closes)
        atr14 = calculate_atr(highs, lows, closes, 14)[-1]
        swings = find_swing_levels(highs[-40:], lows[-40:], window=3)

        latest_close = closes[-1]
        recent_high_20 = max(highs[-20:])
        recent_low_20 = min(lows[-20:])

        # 台股強制對齊法定 Tick Size
        if market == "TW":
            supports = [align_tw_tick(s, mode="floor") for s in swings["supports"][-3:]]
            resistances = [align_tw_tick(r, mode="ceil") for r in swings["resistances"][-3:]]
            if not supports:
                supports = [align_tw_tick(recent_low_20, mode="floor")]
            if not resistances:
                resistances = [align_tw_tick(recent_high_20, mode="ceil")]
            tick_size = get_tw_tick_size(latest_close)
        else:
            supports = [round(s, 2) for s in swings["supports"][-3:]] or [round(recent_low_20, 2)]
            resistances = [round(r, 2) for r in swings["resistances"][-3:]] or [
                round(recent_high_20, 2)
            ]
            tick_size = 0.01

        # 計算近 5 日與近 20 日漲跌幅 (供模組 2 Priced-in 判斷共用)
        ret_5d_pct = (
            round(((latest_close - closes[-6]) / closes[-6]) * 100, 2) if len(closes) >= 6 else 0.0
        )
        ret_20d_pct = (
            round(((latest_close - closes[-21]) / closes[-21]) * 100, 2)
            if len(closes) >= 21
            else 0.0
        )
        vols_20 = [b.volume for b in bars[-20:]]
        avg_vol_20 = sum(vols_20) / len(vols_20) if vols_20 else 1.0
        volume_ratio_20d = round(bars[-1].volume / avg_vol_20, 2) if avg_vol_20 > 0 else 1.0
        partial = is_partial_session(market, bars[-1].timestamp)
        trend_score = score_trend(closes, [b.volume for b in bars], partial_session=partial)

        return {
            "symbol": feed["symbol"],
            "market": market,
            "currency": feed["currency"],
            "data_source": feed["data_source"],
            "is_live": feed["is_live"],
            "fallback_reason": feed.get("fallback_reason"),
            "latest_date": bars[-1].timestamp,
            "latest_close": latest_close,
            "tick_size": tick_size,
            "recent_high_20d": recent_high_20,
            "recent_low_20d": recent_low_20,
            "historical_high": max(highs),
            "historical_low": min(lows),
            "ret_5d_pct": ret_5d_pct,
            "ret_20d_pct": ret_20d_pct,
            "volume_ratio_20d": volume_ratio_20d,
            "indicators": {
                "MA5": ma5,
                "MA20": ma20,
                "MA60": ma60,
                "MA200": ma200,
                "RSI14": rsi14,
                "MACD_DIF": macd_res["dif"][-1],
                "MACD_SIGNAL": macd_res["signal"][-1],
                "MACD_HIST": macd_res["hist"][-1],
                "MACD_hist": macd_res["hist"][-1],
                "ATR14": atr14,
            },
            "support_levels": sorted(list(set(supports))),
            "resistance_levels": sorted(list(set(resistances))),
            "partial_session": partial,
            "trend_score": trend_score,
        }
