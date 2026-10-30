"""
多幣別匯率 (fx.py)
把任何幣別換成新台幣：Yahoo Finance「{幣別}TWD=X」（美元用 TWD=X），快取 5 分鐘。
- GBp／GBX（英股便士報價）＝ GBP 匯率 ÷ 100
- 抓取失敗：沿用最後一次成功的匯率並標示時間；美元從未成功過才用預設 32.15；其他幣別沒有預設值，回 None
"""

from datetime import datetime
from typing import Any, Dict, Iterable
import threading
import time
import urllib.parse

from src.market.net import http_json

YAHOO_URL = "https://query1.finance.yahoo.com/v8/finance/chart/"
CACHE_TTL_SEC = 300
DEFAULT_USD_TWD = 32.15
PENCE = {"GBP": "GBP", "GBp": "GBP", "GBX": "GBP"}  # 便士報價 → 英鎊 ÷ 100

_LOCK = threading.Lock()
_CACHE: Dict[str, Dict[str, Any]] = {}  # 幣別 -> {"t", "rate"}
_LAST: Dict[str, Dict[str, Any]] = {}  # 幣別 -> {"rate", "at"}（最後一次成功）


def _pair(cur: str) -> str:
    return "TWD=X" if cur == "USD" else f"{cur}TWD=X"


def _fetch(cur: str, timeout: int = 8) -> float:
    url = f"{YAHOO_URL}{urllib.parse.quote(_pair(cur))}?interval=1d&range=5d"
    data = http_json(url, timeout=timeout)
    rate = float(data["chart"]["result"][0]["meta"]["regularMarketPrice"])
    if not rate > 0:
        raise ValueError(f"匯率數值異常：{rate}")
    return rate


def rate_to_twd(currency: str) -> Dict[str, Any]:
    """回傳 {"currency", "rate"（1 單位該幣別＝多少台幣，取不到為 None）, "source", "warning"}。"""
    cur = (currency or "").strip()
    if not cur:
        return {"currency": cur, "rate": None, "source": "UNKNOWN", "warning": "不知道這檔的計價幣別"}
    if cur.upper() == "TWD":
        return {"currency": "TWD", "rate": 1.0, "source": "TWD", "warning": None}
    if cur in PENCE and cur != "GBP":  # 便士
        base = rate_to_twd("GBP")
        rate = round(base["rate"] / 100, 6) if base["rate"] else None
        return {**base, "currency": cur, "rate": rate,
                "note": "英股以便士（GBp）報價，1 GBp ＝ 0.01 英鎊"}
    cur = cur.upper()
    with _LOCK:
        hit = _CACHE.get(cur)
        if hit and time.time() - hit["t"] < CACHE_TTL_SEC:
            return {"currency": cur, "rate": hit["rate"], "source": "LIVE_YAHOO_FX", "warning": None}
    try:
        rate = round(_fetch(cur), 6)
    except Exception as e:
        last = _LAST.get(cur)
        if last:
            return {"currency": cur, "rate": last["rate"], "source": "LAST_KNOWN_FX",
                    "warning": f"{cur} 即時匯率抓取失敗（{e}），沿用 {last['at']} 的匯率 {last['rate']}"}
        if cur == "USD":
            return {"currency": cur, "rate": DEFAULT_USD_TWD, "source": "FALLBACK_DEFAULT",
                    "warning": f"無法取得即時匯率（{e}），暫用預設 {DEFAULT_USD_TWD}，美股部位換算台幣可能有誤差"}
        return {"currency": cur, "rate": None, "source": "UNAVAILABLE",
                "warning": f"無法取得 {cur} 兌台幣匯率（{e}）"}
    with _LOCK:
        _CACHE[cur] = {"t": time.time(), "rate": rate}
        _LAST[cur] = {"rate": rate, "at": datetime.now().strftime("%m/%d %H:%M")}
    return {"currency": cur, "rate": rate, "source": "LIVE_YAHOO_FX", "warning": None}


def rates_to_twd(currencies: Iterable[str]) -> Dict[str, Dict[str, Any]]:
    return {c: rate_to_twd(c) for c in dict.fromkeys(c for c in currencies if c)}


def clear_cache() -> None:
    with _LOCK:
        _CACHE.clear()
        _LAST.clear()
