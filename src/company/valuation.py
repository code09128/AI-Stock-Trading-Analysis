"""
估值參考 (valuation.py)：用「近四季 EPS × 同產業本益比」推算合理價區間，直接回答現在偏貴、合理還是偏便宜。

台股：
- 資料全部是「整份檔案」，不逐檔查詢（避免被擋）：
    上市本益比 TWSE BWIBBU_ALL（已有，6 小時快取）、上櫃本益比 櫃買 tpex_mainboard_peratio_analysis（24 小時快取）、
    上市產業 t187ap03_L（已有）、上櫃產業 mopsfin_t187ap03_O（24 小時快取）。
- 同產業本益比分布（中位數、25／75 百分位）在本機算，只算本益比 > 0 的公司（虧損公司本益比沒有意義）。
- EPS 優先用財報查詢的近四季合計（有基期季別），財報取不到就用「股價 ÷ 官方本益比」反推。
- 結論規則（固定、可預期，不是預測）：本檔本益比在同產業的百分位，<20 便宜、20～40 偏便宜、40～60 合理、60～80 偏貴、≥80 貴；
  另外附「EPS × 同業 25～75 百分位」的合理價區間當參考。
美股：沒有免費的全市場本益比檔，改用「該股所屬的 SPDR 類股 ETF 本益比」當產業本益比（Yahoo quoteSummary）：
- 打開哪一檔才抓它那一檔的類股 ETF（11 檔之一），24 小時快取；個股自己的 EPS、前瞻本益比也只在打開時抓（1 小時快取）。
- 判斷：本檔本益比（現價 ÷ 近四季 EPS）相對類股 ETF 本益比的溢價，溢價 −30%／−10%／+10%／+30% 為五級的分界；合理價 = EPS × ETF 本益比 ±10%。
- 限制：ETF 本益比是市值加權（偏向大型股），不是同業中位數；科技、高成長股長期相對類股有溢價；只有一個基準值，沒有分布可看百分位。
限制：同產業分類很粗（例如「電子零組件」裡什麼都有），同業太少（< MIN_PEERS）不給結論；EPS 近四季合計對景氣循環股與一次性損益很敏感，
      EPS 變化很大時會在 notes 標出「基期」提醒。只是參考的相對比較，不是買賣建議。
"""

import threading
import time
import urllib.parse
from statistics import median
from typing import Any, Dict, List, Optional

from src.company import fundamentals, stock_info
from src.market import etf_data
from src.market import quote_provider as qp
from src.market.data_adapter import DualMarketDataAdapter

TPEX_PE = "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_peratio_analysis"
TPEX_REGISTRY = "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O"
MIN_PEERS = 8  # 同產業本益比為正的公司至少要有幾家才給結論
PE_CAP = 150.0  # 本益比超過這個值當離群值，不納入同業分布（避免個別極端值把 75 百分位拉走）
EPS_JUMP_PCT = 30.0  # 近四季 EPS 年增／年減超過這個幅度，提醒基期效應


def _num(x: Any) -> Optional[float]:
    try:
        v = float(str(x).replace(",", ""))
        return v if v == v else None
    except (TypeError, ValueError):
        return None


def _otc_pe() -> Dict[str, float]:
    def load():
        rows = qp._http_json(TPEX_PE, timeout=25)
        return {str(r.get("SecuritiesCompanyCode", "")).strip().upper(): _num(r.get("PriceEarningRatio")) for r in rows}

    return etf_data._cached("valuation_otc_pe", load, ttl=24 * 3600) or {}


def _otc_industry() -> Dict[str, str]:
    def load():
        rows = qp._http_json(TPEX_REGISTRY, timeout=25)
        return {str(r.get("SecuritiesCompanyCode", "")).strip().upper(): str(r.get("SecuritiesIndustryCode", "")).strip() for r in rows}

    return etf_data._cached("valuation_otc_industry", load, ttl=24 * 3600) or {}


def _industry_table() -> Dict[str, Any]:
    """{code: (產業代碼, 本益比)} 與 {產業代碼: [本益比...]}；上市上櫃合併，本益比 ≤ 0、空白、離群的不納入分布。"""
    listed_ind = {c: str(r.get("產業別", "")).strip() for c, r in stock_info._company_registry().items()}
    listed_pe = {c: _num(r.get("PEratio")) for c, r in stock_info._valuation().items()}
    otc_ind, otc_pe = _otc_industry(), _otc_pe()
    own: Dict[str, Any] = {}
    dist: Dict[str, List[float]] = {}
    for ind_map, pe_map, board in ((listed_ind, listed_pe, "上市"), (otc_ind, otc_pe, "上櫃")):
        for code, ind in ind_map.items():
            pe = pe_map.get(code)
            own[code] = (ind, pe, board)
            if ind and pe and 0 < pe <= PE_CAP:
                dist.setdefault(ind, []).append(pe)
    return {"own": own, "dist": dist, "otc_ok": bool(otc_ind) and bool(otc_pe)}


def _percentile(sorted_vals: List[float], p: float) -> float:
    """線性內插百分位（p 在 0～1）。"""
    k = (len(sorted_vals) - 1) * p
    lo = int(k)
    hi = min(lo + 1, len(sorted_vals) - 1)
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (k - lo)


def industry_stats(values: List[float]) -> Dict[str, Any]:
    v = sorted(values)
    return {"count": len(v), "median": round(median(v), 2), "p25": round(_percentile(v, 0.25), 2), "p75": round(_percentile(v, 0.75), 2)}


LEVELS = ((20, "便宜"), (40, "偏便宜"), (60, "合理"), (80, "偏貴"), (101, "貴"))


def judge(price: float, eps: float, stats: Dict[str, Any], peers: List[float]) -> Dict[str, Any]:
    """本檔本益比（價格 ÷ 近四季 EPS）在同產業本益比分布的百分位，分五級：<20 便宜、20～40 偏便宜、40～60 合理、60～80 偏貴、≥80 貴。
    合理價區間（EPS × 同業 25～75 百分位）只當參考；區間很寬時（同業差異大），百分位分級比單看區間更能分出高低。"""
    own_pe = price / eps
    rank = round(sum(1 for x in peers if x < own_pe) / len(peers) * 100)
    verdict = next(name for limit, name in LEVELS if rank < limit)
    low, mid, high = eps * stats["p25"], eps * stats["median"], eps * stats["p75"]
    return {"verdict": verdict, "pe_percentile": rank, "gauge": rank, "fair_low": round(low, 2), "fair_mid": round(mid, 2), "fair_high": round(high, 2),
            "vs_mid_pct": round((price / mid - 1) * 100, 1), "own_pe": round(own_pe, 2)}


def _last_close(symbol: str) -> Dict[str, Any]:
    bars = DualMarketDataAdapter().fetch_bars(symbol, days=30)["bars"]  # 少於約 30 天行情來源會拒絕（實測 15 天回 404）
    if not bars:
        raise RuntimeError("取不到日 K")
    b = bars[-1]
    return {"price": float(b.close), "date": str(b.timestamp)[:10]}


def _base_period(fund: Dict[str, Any]) -> Dict[str, Any]:
    qs = (fund.get("quarterly") or {})
    if not qs.get("available") or qs.get("ttm_eps") is None:
        return {}  # 季別不連續算不出近四季 EPS：不顯示基期，呼叫端改用官方本益比反推
    rows = qs.get("quarters") or []
    return {"ttm_eps": qs.get("ttm_eps"), "ttm_eps_yoy_pct": qs.get("ttm_eps_yoy_pct"),
            "quarters": f"{rows[-4]['quarter']}～{rows[-1]['quarter']}" if len(rows) >= 4 else None}


def analyze_tw(symbol: str) -> Dict[str, Any]:
    n = DualMarketDataAdapter.normalize_symbol(symbol)
    code = n["raw_code"].upper()
    table = _industry_table()
    ind, official_pe, board = table["own"].get(code, (None, None, None))
    if not ind:
        if not table.get("otc_ok", True):
            return {"supported": False, "reason": "上櫃公司資料暫時取不到，請稍後再試"}
        return {"supported": False, "reason": "查不到這檔的產業分類（可能是興櫃或剛上市櫃）"}
    ind_name = stock_info.INDUSTRY.get(ind, f"產業代碼 {ind}")
    peers = table["dist"].get(ind, [])
    notes: List[str] = []
    try:
        px = _last_close(symbol)
    except Exception as e:
        return {"supported": False, "reason": f"取不到股價：{str(e)[:80]}"}
    price = px["price"]

    base: Dict[str, Any] = {}
    try:
        base = _base_period(fundamentals.analyze(symbol))
    except Exception:
        pass
    eps, eps_src = base.get("ttm_eps"), "近四季 EPS 合計（財報）"
    if not table.get("otc_ok", True):
        notes.append("上櫃公司資料暫時取不到，同業本益比分布只含上市公司")
    if eps is None and official_pe and official_pe > 0:
        eps, eps_src = round(price / official_pe, 2), "股價 ÷ 官方本益比 反推"
        notes.append("財報查詢取不到，EPS 改用官方本益比反推，沒有基期季別資訊")
    out: Dict[str, Any] = {
        "supported": True, "symbol": n["symbol"], "market": "TW", "industry": ind_name, "board": board,
        "price": price, "price_date": px["date"], "official_pe": official_pe, "eps": eps, "eps_source": eps_src,
        "base_period": base, "notes": notes,
        "method": "本益比（現價 ÷ 近四季 EPS）在同產業的百分位分五級：<20 便宜、20～40 偏便宜、40～60 合理、60～80 偏貴、≥80 貴；合理價區間 = 近四季 EPS × 同業本益比 25～75 百分位（中間值為中位數）。",
        "sources": ["TWSE 本益比", "櫃買中心 本益比", "公司產業分類", "FinMind 季財報"],
    }
    if eps is None or eps <= 0:
        out.update(verdict=None, reason="近四季 EPS 為負或不足，本益比不適用（虧損公司不能用本益比估值）")
        return out
    if len(peers) < MIN_PEERS:
        out.update(verdict=None, reason=f"同產業只有 {len(peers)} 家本益比為正的公司，樣本太少不給結論",
                   industry_stats=industry_stats(peers) if peers else None)
        return out
    stats = industry_stats(peers)
    out["industry_stats"] = stats
    out.update(judge(price, eps, stats, peers))
    yoy = base.get("ttm_eps_yoy_pct")
    if yoy is not None and yoy >= EPS_JUMP_PCT:
        notes.append(f"近四季 EPS 比前一年多 {yoy:.0f}%，基期偏低、本益比被墊低；獲利能否延續要另外確認")
    elif yoy is not None and yoy <= -EPS_JUMP_PCT:
        notes.append(f"近四季 EPS 比前一年少 {abs(yoy):.0f}%，基期降低、本益比被墊高，可能是獲利低點而不是真的貴")
    if out["own_pe"] > PE_CAP:
        notes.append("本益比極高，通常代表 EPS 很低，這個結論參考價值有限")
    notes.append(f"{ind_name} 產業分類很粗，同業內公司性質可能差很多；只作相對比較，不是買賣建議")
    return out


# Yahoo 的 sector 名稱 → SPDR 類股 ETF（與 chain_data_us.SECTOR_ETF 同一組 11 檔）
YAHOO_SECTOR_ETF = {
    "Technology": ("XLK", "科技"), "Financial Services": ("XLF", "金融"), "Healthcare": ("XLV", "醫療保健"),
    "Consumer Cyclical": ("XLY", "非必需消費"), "Consumer Defensive": ("XLP", "必需消費"), "Energy": ("XLE", "能源"),
    "Industrials": ("XLI", "工業"), "Basic Materials": ("XLB", "原物料"), "Utilities": ("XLU", "公用事業"),
    "Real Estate": ("XLRE", "房地產"), "Communication Services": ("XLC", "通訊服務"),
}
US_BAND = 0.10  # 溢價在 ±10% 內＝合理；±30% 以外＝便宜／貴


_YAHOO_GAP = 1.0  # 估值自己的兩個 Yahoo 請求（個股、類股 ETF）至少隔幾秒
_yahoo_lock = threading.Lock()
_yahoo_next = 0.0


def _yahoo_summary(ysym: str, modules: str) -> Dict[str, Any]:
    """限制：只管估值自己的請求之間的間隔；不改全域的 HOST_MIN_GAP（熱力圖等頁面也打同一個主機，全域限速會讓它們排隊逾時）。"""
    global _yahoo_next
    with _yahoo_lock:
        wait = _yahoo_next - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        _yahoo_next = time.monotonic() + _YAHOO_GAP
    op, crumb = etf_data._yahoo_opener()
    url = (f"https://query2.finance.yahoo.com/v10/finance/quoteSummary/{urllib.parse.quote(ysym)}?modules={modules}"
           f"&crumb={urllib.parse.quote(crumb)}")
    return qp._http_json(url, timeout=15, opener=op)["quoteSummary"]["result"][0]


def _raw(d: Dict[str, Any], k: str) -> Optional[float]:
    v = (d or {}).get(k)
    return _num(v.get("raw") if isinstance(v, dict) else v)


def _etf_pe(etf: str) -> Optional[float]:
    def load():
        return _raw((_yahoo_summary(etf, "summaryDetail")).get("summaryDetail") or {}, "trailingPE")

    return etf_data._cached(f"valuation_etf_pe:{etf}", load, ttl=24 * 3600)


def _us_stock(ysym: str) -> Optional[Dict[str, Any]]:
    def load():
        r = _yahoo_summary(ysym, "summaryDetail,defaultKeyStatistics,assetProfile,financialData")
        sd, ks, fd = r.get("summaryDetail") or {}, r.get("defaultKeyStatistics") or {}, r.get("financialData") or {}
        return {"sector": (r.get("assetProfile") or {}).get("sector"),
                "price": _raw(fd, "currentPrice") or _raw(sd, "regularMarketPrice") or _raw(sd, "previousClose"),
                "eps": _raw(ks, "trailingEps"), "forward_eps": _raw(ks, "forwardEps"),
                "trailing_pe": _raw(sd, "trailingPE"), "forward_pe": _raw(sd, "forwardPE") or _raw(ks, "forwardPE"),
                "earnings_growth_pct": round(_raw(fd, "earningsGrowth") * 100, 1) if _raw(fd, "earningsGrowth") is not None else None}

    return etf_data._cached(f"valuation_us:{ysym}", load, ttl=3600)


def judge_us(price: float, eps: float, etf_pe: float) -> Dict[str, Any]:
    """本檔本益比相對類股 ETF 本益比的溢價（%）→ 0～100 的刻度（溢價 0% ＝ 50，每 1% 一格），再用和台股相同的五級分界。"""
    own_pe = price / eps
    premium = (own_pe / etf_pe - 1) * 100
    gauge = round(min(100.0, max(0.0, 50 + premium)))
    mid = eps * etf_pe
    return {"verdict": next(name for limit, name in LEVELS if gauge < limit), "gauge": gauge, "premium_pct": round(premium, 1),
            "own_pe": round(own_pe, 2), "fair_low": round(mid * (1 - US_BAND), 2), "fair_mid": round(mid, 2),
            "fair_high": round(mid * (1 + US_BAND), 2), "vs_mid_pct": round((price / mid - 1) * 100, 1)}


def analyze_us(symbol: str) -> Dict[str, Any]:
    n = DualMarketDataAdapter.normalize_symbol(symbol)
    s = _us_stock(n["symbol"])
    if not s:
        return {"supported": False, "reason": "取不到這檔的 Yahoo 財務資料（可能暫時連不上，或查詢被暫停）"}
    mapped = YAHOO_SECTOR_ETF.get(s.get("sector") or "")
    if not mapped:
        return {"supported": False, "reason": f"查不到這檔對應的類股（Yahoo 分類：{s.get('sector') or '無'}）"}
    etf, sector_zh = mapped
    etf_pe = _etf_pe(etf)
    notes: List[str] = []
    out: Dict[str, Any] = {
        "supported": True, "symbol": n["symbol"], "market": "US", "industry": f"{sector_zh}類股（{etf}）", "price": s["price"],
        "price_date": "最新", "eps": s["eps"], "eps_source": "近四季 EPS（TTM，Yahoo）", "forward_pe": s["forward_pe"],
        "official_pe": s["trailing_pe"], "benchmark": {"etf": etf, "pe": etf_pe}, "notes": notes,
        "method": "本益比（現價 ÷ 近四季 EPS）相對所屬 SPDR 類股 ETF 本益比的溢價：−30%／−10%／+10%／+30% 為便宜、偏便宜、合理、偏貴、貴的分界；合理價 = EPS × ETF 本益比 ±10%。",
        "sources": [f"Yahoo Finance（個股 EPS、{etf} 類股 ETF 本益比）"],
    }
    if not s["price"] or s["eps"] is None or s["eps"] <= 0:
        out.update(verdict=None, reason="近四季 EPS 為負或取不到，本益比不適用（虧損公司不能用本益比估值）")
        return out
    if not etf_pe or etf_pe <= 0:
        out.update(verdict=None, reason=f"取不到 {etf} 的類股本益比，這次無法比較")
        return out
    out.update(judge_us(s["price"], s["eps"], etf_pe))
    if s["forward_pe"]:
        notes.append(f"前瞻本益比 {s['forward_pe']:.1f} 倍（依分析師預估的未來 EPS）；上面的判斷用的是近四季實際 EPS，成長股的前瞻值通常比較低")
    g = s["earnings_growth_pct"]
    if g is not None and abs(g) >= EPS_JUMP_PCT:
        notes.append(f"最近一季獲利年增 {g:+.0f}%，近四季 EPS 的基期可能還沒反映這個變化")
    notes.append(f"{etf} 的本益比是市值加權，偏向類股裡的大型股，不是同業中位數；科技與高成長股長期相對類股有溢價。只作相對比較，不是買賣建議")
    return out


def analyze(symbol: str) -> Dict[str, Any]:
    cat = stock_info.classify(symbol)
    if cat["category"] != "STOCK":
        return {"supported": False, "reason": "ETF／債券沒有單一公司的 EPS，不適用本益比估值"}
    if cat["market"] == "TW":
        return analyze_tw(symbol)
    if cat["market"] == "US":
        return analyze_us(symbol)
    return {"supported": False, "reason": "目前只支援台股與美股的估值參考"}


def brief(symbol: str) -> str:
    """給 AI 補充資料的一行摘要；不適用或取不到就回空字串。"""
    try:
        v = analyze(symbol)
    except Exception:
        return ""
    if not v.get("supported") or not v.get("verdict"):
        return ""
    if v.get("market") == "US":
        b = v["benchmark"]
        return (f"估值參考：{v['industry']}本益比 {b['pe']:.1f}，本檔本益比 {v['own_pe']}（相對溢價 {v['premium_pct']:+.0f}%），近四季 EPS {v['eps']} → "
                f"合理價區間 {v['fair_low']}～{v['fair_high']}，現價 {v['price']} → {v['verdict']}（規則判斷，非預測）")
    s = v["industry_stats"]
    return (f"估值參考：{v['industry']}同業本益比中位數 {s['median']}（{s['p25']}～{s['p75']}，{s['count']} 家），本檔本益比 {v['own_pe']}（在同業第 {v['pe_percentile']} 百分位），"
            f"近四季 EPS {v['eps']} → 合理價區間 {v['fair_low']}～{v['fair_high']}（中間 {v['fair_mid']}），現價 {v['price']} → {v['verdict']}（規則判斷，非預測）")
