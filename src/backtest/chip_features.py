"""
籌碼與月營收資料 → 對齊每根日 K (chip_features.py)
給「法人連買」「月營收創新高」「融資減少」三支台股策略用，資料都來自 FinMind（經 finmind_store 本機快取）：
- inst：三大法人合計買賣超（張），當天收盤後公布，當天收盤的訊號可以用（隔天開盤才成交）
- margin：融資餘額（張），沒有資料的日子沿用前一天
- revenue：月營收。法定公布期限是次月 10 日，所以 X 月營收一律從「次月 10 日（含）之後的第一個交易日」才算已知，
  不用公布日以前的資料，避免偷看未來
"""

from datetime import date, timedelta
from typing import Any, Dict, Iterable, List, Optional

from src.market import finmind_store
from src.market.bar import Bar

DATASETS = {
    "inst": "TaiwanStockInstitutionalInvestorsBuySell",
    "margin": "TaiwanStockMarginPurchaseShortSale",
    "revenue": "TaiwanStockMonthRevenue",
}
LABELS = {"inst": "三大法人買賣超", "margin": "融資餘額", "revenue": "月營收"}
INST_GROUPS = {"Foreign_Investor", "Foreign_Dealer_Self", "Investment_Trust", "Dealer_self", "Dealer_Hedging"}


def revenue_available_on(year: int, month: int) -> date:
    """X 年 Y 月營收視為已公布的日子：次月 10 日。"""
    return date(year + (month == 12), month % 12 + 1, 10)


def align_inst(bars: List[Bar], rows: List[Dict[str, Any]]) -> List[Optional[float]]:
    net: Dict[str, float] = {}
    for r in rows:
        if r.get("name") in INST_GROUPS:
            net[r["date"]] = net.get(r["date"], 0.0) + (float(r.get("buy") or 0) - float(r.get("sell") or 0)) / 1000
    return [round(net[b.timestamp]) if b.timestamp in net else None for b in bars]


def align_margin(bars: List[Bar], rows: List[Dict[str, Any]]) -> List[Optional[float]]:
    by = {r["date"]: float(r.get("MarginPurchaseTodayBalance") or 0) for r in rows}
    out, last = [], None
    for b in bars:
        last = by.get(b.timestamp, last)
        out.append(last)
    return out


def align_revenue(bars: List[Bar], rows: List[Dict[str, Any]]) -> List[Optional[Dict[str, Any]]]:
    """每根 K 棒當天「已公布」的最新一個月營收：{month, revenue, yoy_pct, history（含之前所有已公布月份的營收）}。"""
    months = sorted({(int(r["revenue_year"]), int(r["revenue_month"])): float(r["revenue"])
                     for r in rows if r.get("revenue_year") and r.get("revenue")}.items())
    out: List[Optional[Dict[str, Any]]] = []
    k = 0
    known: List[float] = []
    by = dict(months)
    latest = None
    for b in bars:
        d = date.fromisoformat(b.timestamp[:10])
        while k < len(months) and revenue_available_on(*months[k][0]) <= d:
            (y, m), v = months[k]
            known.append(v)
            prev = by.get((y - 1, m))
            latest = {"month": f"{y}-{m:02d}", "revenue": v,
                      "yoy_pct": round((v / prev - 1) * 100, 2) if prev else None, "history": list(known)}
            k += 1
        out.append(latest)
    return out


def load(code: str, bars: List[Bar], needs: Iterable[str]) -> Dict[str, Any]:
    """抓（或讀本機快取）策略需要的資料並對齊日 K。回傳 {"extra": {...}, "notes": [...]}；完全取不到就拋錯。"""
    first = date.fromisoformat(bars[0].timestamp[:10])
    extra: Dict[str, Any] = {}
    notes: List[str] = []
    for need in needs:
        # 月營收要多抓 14 個月：第一根 K 棒就要能比較「過去 12 個月」與去年同期
        start = (first - timedelta(days=430 if need == "revenue" else 10)).isoformat()
        res = finmind_store.history(DATASETS[need], code, start)
        rows = res["rows"]
        if not rows:
            raise ValueError(f"FinMind 查無 {code} 的{LABELS[need]}資料")
        extra[need] = {"inst": align_inst, "margin": align_margin, "revenue": align_revenue}[need](bars, rows)
        if res["stale"]:
            notes.append(f"{LABELS[need]}這次沒更新成功（{res['error']}），使用本機快取的舊資料，最新幾天可能缺。")
        notes.append(f"{LABELS[need]}：{'本機快取' if res['source'] == 'cache' else 'FinMind 更新'}，"
                     f"資料到 {rows[-1].get('date', '')}。")
    return {"extra": extra, "notes": notes}
