"""
台美股以外市場的交易規則 (trade_rules.py)
1. 每手股數：日股、陸股、星股全市場 100 股；港股每檔不同，從港交所官方證券清單取得（每天下載一次）。
2. 法定稅費：只算交易所／政府固定收取的稅費，不含券商佣金（每家券商不同）。
   美股的 SEC 規費與 FINRA TAF 也在這裡（us_fees），回測（market_rules）與看盤頁模擬下單（/api/trade_rules）共用。
台股手續費與證交稅在 market_rules.calculate_friction_cost。
"""

import io
import math
import re
import threading
import time
import zipfile
from datetime import date
from typing import Any, Dict, List, Optional

from src.market.markets import market_of, split_suffix
from src.market.net import http_bytes

FIXED_LOT = {"JP": 100, "CN": 100, "SG": 100}

# side：BUY／SELL／BOTH；ceil：無條件進位到整數元（港股印花稅以 1 港元為單位進位）
# 稅費會變，更新時改這裡並更新查證日期（最後查證 2026-10-29）：
# - 港股：印花稅 0.1%（2023-11-17 起）、證監會徵費 0.0027%、會財局徵費 0.00015%、港交所交易費 0.00565%
#   （這次只查到券商與財經網站的整理，尚未對到港交所／證監會官方收費表，下次更新請以官方為準）
# - 英股：SDRT 0.5%（買方）；政府規劃 2027 年改成新的證券交易稅，草案 2026-07-13 公布
#   https://www.gov.uk/hmrc-internal-manuals/stamp-taxes-shares-manual/stsm011110
# - 陸股：印花稅 0.05%（賣方，2023-08-28 起）、過戶費 0.001%（雙向，2022-04-29 起）、經手費 0.00341%（雙向，2023 年上交所調降）
#   （同樣只查到財經網站整理，尚未對到上交所／深交所／中國結算官方公告）
# - 韓股：2026-01-01 起 KOSPI 0.05%＋農漁村特別稅 0.15%、KOSDAQ 0.20%，合計都是 0.20%
#   https://taxsummaries.pwc.com/republic-of-korea/corporate/other-taxes
# - 星股：SGX 清算費 0.0325%、交易接取費 0.0075%（另有 GST，未計入）
#   https://links.sgx.com/1.0.0/corporate-announcements/R8Z4VSSB8K55UHYI/290820_20140207_SGX_to_effect_revised_securities_mkt_fee_structure_1June.pdf
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

# 美股 SEC Section 31 規費：FY2026 每百萬美元 20.60 美元，交易日 2026-04-04 起適用（2025-05-14～2026-04-03 為 0），
#   每年會重新公告 — FINRA Information Notice 2026-03-17
#   https://www.finra.org/rules-guidance/notices/information-notice-20260317
#   最低 0.01 美元是券商進位到分的做法
SEC_FEE_RATE = 20.60 / 1_000_000
# 美股 FINRA TAF：股票賣出每股 0.000195 美元、每筆上限 9.79 美元；2026-10-01～2026-12-31 暫停收費
#   出處：SR-FINRA-2026-021 https://www.finra.org/rules-guidance/rule-filings/sr-finra-2026-021（查證 2026-10-29）
TAF_PER_SHARE = 0.000195
TAF_MAX = 9.79
TAF_HOLIDAYS = [(date(2026, 10, 1), date(2026, 12, 31))]


def us_fees(on: Optional[date] = None) -> List[Dict[str, Any]]:
    """美股賣出規費。on＝交易日：落在 TAF 暫停期間就不列 TAF；沒有日期（回測）就用一般費率。"""
    fees: List[Dict[str, Any]] = [{"label": "SEC 規費", "rate": SEC_FEE_RATE, "side": "SELL", "min": 0.01}]
    if not (on is not None and any(a <= on <= b for a, b in TAF_HOLIDAYS)):
        fees.append({"label": "FINRA TAF", "per_share": TAF_PER_SHARE, "max": TAF_MAX, "side": "SELL"})
    return fees


def _us_note(on: date) -> str:
    """美股提示依當天日期產生，不寫死日期：暫停期間過了就不會再顯示「暫停收費」。"""
    for a, b in TAF_HOLIDAYS:
        if a <= on <= b:
            return f"美股賣出另收 SEC 規費；FINRA TAF 在 {a:%Y-%m-%d}～{b:%Y-%m-%d} 暫停收費"
    return "美股賣出另收 SEC 規費與 FINRA TAF"


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
                _hk_cache["data"] = _parse_hkex(http_bytes(HKEX_URL, 30))
                _hk_cache["error"] = None
            except Exception as e:  # 下載失敗：保留上次成功的清單，並回報原因
                _hk_cache["error"] = f"港交所證券清單下載失敗：{e}"
            _hk_cache["at"] = time.time()
        return _hk_cache["data"]


def rules_for(symbol: str) -> Dict[str, Any]:
    market = market_of(symbol)
    res: Dict[str, Any] = {"symbol": symbol, "market": market, "lot": 1, "lot_source": "",
                           "fees": us_fees(date.today()) if market == "US" else list(STATUTORY_FEES.get(market, [])),
                           "note": _us_note(date.today()) if market == "US" else NOTES.get(market, ""),
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


def statutory_cost(fees: List[Dict[str, Any]], action: str, amount: float, shares: float = 0) -> float:
    """法定稅費合計。每一項：rate＝按成交金額，或 per_share＝按股數；可選 ceil（進位到整數元）、min、max。
    前端看盤頁模擬下單（watch.jsx 的 statutoryTax）用同一套規則，改這裡要一起改。"""
    side = "SELL" if action.upper() in ("SELL", "SHORT", "賣出") else "BUY"
    total = 0.0
    for f in fees:
        if f["side"] not in (side, "BOTH"):
            continue
        v = shares * f["per_share"] if "per_share" in f else amount * f["rate"]
        v = float(math.ceil(v - 1e-9)) if f.get("ceil") else round(v, 2)
        if "min" in f:
            v = max(f["min"], v)
        if "max" in f:
            v = min(f["max"], v)
        total += v
    return round(total, 2)
