"""
台股名稱 → 代號查詢 (symbol_search.py)：自選股輸入「台積電」「元大台灣50」也能找到 2330、0050。

名單來源（都是官方公開資料，各快取 24 小時，任一個失敗不影響其他）：
- 上市公司：證交所 OpenAPI t187ap03_L（公司代號、公司簡稱、公司名稱）
- 上櫃公司：櫃買中心 OpenAPI mopsfin_t187ap03_O
- ETF／基金：證交所 OpenAPI t187ap47_L（基金簡稱、基金中文名稱）
限制：只查台股；美股、港股要輸入 ticker。興櫃與未上市櫃的公司沒有在名單裡。
"""

import re
from typing import Any, Dict, List

from src.market import etf_data
from src.market import quote_provider as qp

TWSE_LISTED = "https://openapi.twse.com.tw/v1/opendata/t187ap03_L"
TPEX_LISTED = "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O"
TWSE_FUNDS = f"{etf_data.TWSE_OPENAPI}/opendata/t187ap47_L"
TTL = 24 * 3600
_TICKER_RE = re.compile(r"^[A-Za-z0-9.\-]+$")


def _norm(s: str) -> str:
    return re.sub(r"\s+", "", str(s or "")).upper()


def looks_like_ticker(q: str) -> bool:
    """只有英數與 . - 的輸入視為代號（2330、NVDA、BRK-B、0700.HK）；含中文或空白分隔的視為名稱。"""
    return bool(_TICKER_RE.match((q or "").strip()))


def directory() -> List[Dict[str, str]]:
    """全部台股上市櫃公司與 ETF：[{code, name, full}]。三個來源各自快取，取不到的來源略過。"""
    out: List[Dict[str, str]] = []
    for key, url, code_k, name_k, full_k in (
        ("dir_listed", TWSE_LISTED, "公司代號", "公司簡稱", "公司名稱"),
        ("dir_otc", TPEX_LISTED, "SecuritiesCompanyCode", "CompanyAbbreviation", "CompanyName"),
        ("dir_funds", TWSE_FUNDS, "基金代號", "基金簡稱", "基金中文名稱"),
    ):
        def load(url=url):
            return qp._http_json(url, timeout=25)

        try:
            rows = etf_data._cached(key, load, ttl=TTL) or []
        except Exception:
            rows = []
        for r in rows:
            code = str(r.get(code_k, "")).strip().upper()
            if code:
                out.append({"code": code, "name": str(r.get(name_k, "")).strip(), "full": str(r.get(full_k, "")).strip()})
    return out


def search(query: str, limit: int = 8) -> List[Dict[str, Any]]:
    """依名稱找台股：完全相符 > 簡稱開頭 > 簡稱包含 > 全名包含。同分時代號小的在前（上市在上櫃前、ETF 在後）。"""
    q = _norm(query)
    if not q:
        return []
    scored = []
    for r in directory():
        n, f = _norm(r["name"]), _norm(r["full"])
        if n == q:
            rank = 0
        elif n.startswith(q):
            rank = 1
        elif q in n:
            rank = 2
        elif q in f:
            rank = 3
        else:
            continue
        scored.append((rank, len(n), r["code"], r))
    scored.sort(key=lambda x: x[:3])
    seen, out = set(), []
    for rank, _, code, r in scored:
        if code in seen:
            continue
        seen.add(code)
        out.append({"code": code, "name": r["name"], "exact": rank == 0})
        if len(out) >= limit:
            break
    return out
