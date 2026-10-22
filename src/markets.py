"""
多市場設定 (markets.py)
依 Yahoo Finance 代號後綴判斷市場：沒有後綴＝美股、.TW/.TWO＝台股、.HK＝港股、.T＝日股 …
每個市場記錄：預設幣別、交易所時區、交易時段（含午休）、比較 Beta 用的大盤指數。
實際幣別以 Yahoo 報價回傳的 currency 為準（例如英股回傳 GBp＝便士）。
"""

import re
from typing import Any, Dict, List, Tuple

MARKETS: Dict[str, Dict[str, Any]] = {
    "TW": {"name": "台股", "suffixes": (".TW", ".TWO"), "currency": "TWD", "tz": "Asia/Taipei",
           "sessions": [("09:00", "13:30")], "index": "^TWII"},
    "US": {"name": "美股", "suffixes": (), "currency": "USD", "tz": "America/New_York",
           "sessions": [("09:30", "16:00")], "pre_open": "04:00", "index": "^GSPC"},
    "HK": {"name": "港股", "suffixes": (".HK",), "currency": "HKD", "tz": "Asia/Hong_Kong",
           "sessions": [("09:30", "12:00"), ("13:00", "16:00")], "index": "^HSI"},
    "JP": {"name": "日股", "suffixes": (".T",), "currency": "JPY", "tz": "Asia/Tokyo",
           "sessions": [("09:00", "11:30"), ("12:30", "15:30")], "index": "^N225"},
    "KR": {"name": "韓股", "suffixes": (".KS", ".KQ"), "currency": "KRW", "tz": "Asia/Seoul",
           "sessions": [("09:00", "15:30")], "index": "^KS11"},
    "CN": {"name": "陸股", "suffixes": (".SS", ".SZ"), "currency": "CNY", "tz": "Asia/Shanghai",
           "sessions": [("09:30", "11:30"), ("13:00", "15:00")], "index": "000001.SS"},
    "UK": {"name": "英股", "suffixes": (".L",), "currency": "GBP", "tz": "Europe/London",
           "sessions": [("08:00", "16:30")], "index": "^FTSE"},
    "DE": {"name": "德股", "suffixes": (".DE", ".F"), "currency": "EUR", "tz": "Europe/Berlin",
           "sessions": [("09:00", "17:30")], "index": "^GDAXI"},
    "CA": {"name": "加股", "suffixes": (".TO", ".V"), "currency": "CAD", "tz": "America/Toronto",
           "sessions": [("09:30", "16:00")], "index": "^GSPTSE"},
    "AU": {"name": "澳股", "suffixes": (".AX",), "currency": "AUD", "tz": "Australia/Sydney",
           "sessions": [("10:00", "16:00")], "index": "^AXJO"},
    "SG": {"name": "星股", "suffixes": (".SI",), "currency": "SGD", "tz": "Asia/Singapore",
           "sessions": [("09:00", "12:00"), ("13:00", "17:00")], "index": "^STI"},
}

_SUFFIX_TO_MARKET = {sfx: code for code, m in MARKETS.items() for sfx in m["suffixes"]}
TW_PATTERN = re.compile(r"^\d{4,6}[A-Z]?(\.TW|\.TWO)?$")


def split_suffix(symbol: str) -> Tuple[str, str]:
    """'0700.HK' -> ('0700', '.HK')；沒有已知後綴時回 (symbol, '')。"""
    s = symbol.upper()
    for sfx in sorted(_SUFFIX_TO_MARKET, key=len, reverse=True):
        if s.endswith(sfx) and len(s) > len(sfx):
            return s[: -len(sfx)], sfx
    return s, ""


def market_of(symbol: str) -> str:
    s = symbol.strip().upper()
    if TW_PATTERN.match(s):
        return "TW"
    return _SUFFIX_TO_MARKET.get(split_suffix(s)[1], "US")


def canonical(symbol: str) -> str:
    """整理成 Yahoo 用的寫法：港股補滿 4 位數（700.HK -> 0700.HK）。"""
    code, sfx = split_suffix(symbol.strip().upper())
    if sfx == ".HK" and code.isdigit():
        code = code.zfill(4)
    return code + sfx


def info(market: str) -> Dict[str, Any]:
    return MARKETS.get(market, MARKETS["US"])


def sessions(market: str) -> List[Tuple[str, str]]:
    return info(market)["sessions"]


def market_list() -> List[Dict[str, Any]]:
    """給前端顯示用（代號後綴與範例）。"""
    return [{"code": k, "name": v["name"], "currency": v["currency"], "suffixes": list(v["suffixes"]),
             "tz": v["tz"], "sessions": v["sessions"]} for k, v in MARKETS.items()]
