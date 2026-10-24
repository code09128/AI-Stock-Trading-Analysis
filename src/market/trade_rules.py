"""
台美股以外市場的交易規則 (trade_rules.py)
1. 每手股數：日股、陸股、星股全市場 100 股；港股每檔不同，從港交所官方證券清單取得（每天下載一次）。
2. 法定稅費：只算交易所／政府固定收取的稅費，不含券商佣金（每家券商不同）。
台股、美股仍用 market_rules.calculate_friction_cost 原本的算法。
"""

import io
import math
import re
import threading
import time
import urllib.request
import zipfile
from typing import Any, Dict, List, Optional

from src.market.markets import market_of, split_suffix

FIXED_LOT = {"JP": 100, "CN": 100, "SG": 100}

# side：BUY／SELL／BOTH；ceil：無條件進位到整數元（港股印花稅以 1 港元為單位進位）
STATUTORY_FEES: Dict[str, List[Dict[str, Any]]] = {
    "HK": [
        {"label": "印花稅", "rate": 0.001, "side": "BOTH", "ceil": True},
        {"label": "證監會交易徵費", "rate": 0.000027, "side": "BOTH"},
        {"label": "會財局交易徵費", "rate": 0.0000015, "side": "BOTH"},
        {"label": "港交所交易費", "rate": 0.0000565, "side": "BOTH"},
    ],
    "UK": [{"label": "印花稅（SDRT）", "rate": 0.005, "side": "BUY"}],
    "CN": [
        {"label": "印花稅", "rate": 0.0005, "side": "SELL"},
        {"label": "過戶費", "rate": 0.00001, "side": "BOTH"},
        {"label": "交易所經手費", "rate": 0.0000341, "side": "BOTH"},
    ],
    "KR": [{"label": "證券交易稅", "rate": 0.002, "side": "SELL"}],
    "SG": [
        {"label": "SGX 清算費", "rate": 0.000325, "side": "BOTH"},
        {"label": "SGX 交易接取費", "rate": 0.000075, "side": "BOTH"},
    ],
    "JP": [], "DE": [], "CA": [], "AU": [],
}

NOTES = {
    "HK": "港股 ETF 免印花稅（依港交所清單判斷）",
    "UK": "英股 ETF 與 AIM 股票免印花稅，這裡一律計入，實際可能較低",
    "CN": "陸股賣出可以賣零股（不足 100 股的部分）",
    "KR": "韓股證券交易稅以 0.20% 計（KOSPI 含農特稅）",
}

HKEX_URL = "https://www.hkex.com.hk/eng/services/trading/securities/securitieslists/ListOfSecurities.xlsx"
_HK_TTL = 24 * 3600
_hk_cache: Dict[str, Any] = {"at": 0.0, "data": None, "error": None}
_hk_lock = threading.Lock()


def _parse_hkex(xlsx: bytes) -> Dict[str, Dict[str, Any]]:
    """港交所清單的儲存格都是內嵌文字：A 欄代號、E 欄每手股數、H 欄是否需印花稅（Y／空白）。"""
    sheet = zipfile.ZipFile(io.BytesIO(xlsx)).read("xl/worksheets/sheet1.xml").decode("utf-8")
    cell = re.compile(r'<x:c r="([A-Z]+)\d+"[^>]*?(?:/>|>(?:<x:v>(.*?)</x:v>)?</x:c>)')
    out: Dict[str, Dict[str, Any]] = {}
    for row in re.findall(r"<x:row [^>]*>(.*?)</x:row>", sheet):
        c = {k: (v or "").strip() for k, v in cell.findall(row)}
        lot = c.get("E", "").replace(",", "")
        if c.get("A", "").isdigit() and lot.isdigit():
            out[c["A"].lstrip("0") or "0"] = {"lot": int(lot), "stamp_duty": c.get("H") == "Y"}
    return out


def _hk_list() -> Optional[Dict[str, Dict[str, Any]]]:
    with _hk_lock:
        if _hk_cache["data"] is None or time.time() - _hk_cache["at"] > _HK_TTL:
            try:
                req = urllib.request.Request(HKEX_URL, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req, timeout=30) as r:
                    _hk_cache["data"] = _parse_hkex(r.read())
                _hk_cache["error"] = None
            except Exception as e:  # 下載失敗：保留上次成功的清單，並回報原因
                _hk_cache["error"] = f"港交所證券清單下載失敗：{e}"
            _hk_cache["at"] = time.time()
        return _hk_cache["data"]


def rules_for(symbol: str) -> Dict[str, Any]:
    market = market_of(symbol)
    res: Dict[str, Any] = {"symbol": symbol, "market": market, "lot": 1, "lot_source": "",
                           "fees": list(STATUTORY_FEES.get(market, [])), "note": NOTES.get(market, ""),
                           "error": None}
    if market in FIXED_LOT:
        res["lot"], res["lot_source"] = FIXED_LOT[market], "全市場固定"
    elif market == "HK":
        hk = _hk_list()
        item = (hk or {}).get(split_suffix(symbol)[0].lstrip("0") or "0")
        if item:
            res["lot"], res["lot_source"] = item["lot"], "港交所證券清單"
            if not item["stamp_duty"]:
                res["fees"] = [f for f in res["fees"] if f["label"] != "印花稅"]
        else:
            res["lot"] = None
            res["error"] = _hk_cache["error"] or "港交所證券清單查無此代號"
    return res


def statutory_cost(fees: List[Dict[str, Any]], action: str, amount: float) -> float:
    side = "SELL" if action.upper() in ("SELL", "SHORT", "賣出") else "BUY"
    total = 0.0
    for f in fees:
        if f["side"] in (side, "BOTH"):
            v = amount * f["rate"]
            total += float(math.ceil(v - 1e-9)) if f.get("ceil") else round(v, 2)
    return round(total, 2)
