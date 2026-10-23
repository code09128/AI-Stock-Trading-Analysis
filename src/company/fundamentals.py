"""
財報與市場預期 (fundamentals.py)
- 台股：FinMind 月營收（TaiwanStockMonthRevenue）與季財報（TaiwanStockFinancialStatements）
        → 月營收年增／月增、累計年增、近 8 季 EPS、毛利率、營業利益率；評價用 TWSE 本益比／淨值比／殖利率
        （台股沒有免費的分析師預估資料，所以只能比較「股價漲幅 vs 實際獲利成長」）
- 美股：Yahoo quoteSummary → 近 4 季 EPS 實際 vs 預估（驚喜幅度）、本季／下季／今年／明年 EPS 與營收預估、
        預估 90 天來的上修或下修、分析師目標價、毛利率、營業利益率、前瞻本益比、下次財報日
- 「預期差」：用固定規則把上面的真實數字分成「可能已反映在股價」與「可能讓市場意外」，每一條都附數字；
  3 個利多、3 個風險與綜合判斷交給 AI 解讀（「AI 解讀」按鈕），系統不自己下結論。
快取 12 小時（財報一個月或一季才更新一次），每檔台股每天最多用掉 FinMind 2 次額度。
"""

import urllib.parse
from datetime import date, timedelta
from typing import Any, Dict, List, Optional

from src.market import etf_data, finmind

from src.company import stock_info
from src.market import quote_provider as qp
from src.market.data_adapter import DualMarketDataAdapter

TTL = 12 * 3600


def _pct(a: Optional[float], b: Optional[float]) -> Optional[float]:
    return round((a / b - 1) * 100, 2) if a is not None and b else None


def _price_returns(symbol: str) -> Dict[str, Optional[float]]:
    bars = DualMarketDataAdapter().fetch_bars(symbol, days=300)["bars"]
    c = [b.close for b in bars]
    r = lambda n: _pct(c[-1], c[-1 - n]) if len(c) > n else None  # noqa: E731
    return {"3個月": r(63), "6個月": r(126), "1年": r(250)}


# ---------- 台股 ----------
def _tw_revenue(code: str) -> Dict[str, Any]:
    start = (date.today() - timedelta(days=800)).isoformat()
    rows = finmind.get_data("TaiwanStockMonthRevenue", code, start)
    by = {(int(r["revenue_year"]), int(r["revenue_month"])): float(r["revenue"]) for r in rows}
    keys = sorted(by)
    if len(keys) < 13:
        return {"available": False, "reason": "月營收資料不足 13 個月"}
    months = []
    for y, m in keys[-12:]:
        v = by[(y, m)]
        prev = keys[keys.index((y, m)) - 1]
        months.append({"month": f"{y}-{m:02d}", "revenue_100m": round(v / 1e8, 2),
                       "yoy_pct": _pct(v, by.get((y - 1, m))), "mom_pct": _pct(v, by.get(prev))})
    ly, lm = keys[-1]
    ytd = sum(by.get((ly, m), 0) for m in range(1, lm + 1))
    ytd_prev = sum(by.get((ly - 1, m), 0) for m in range(1, lm + 1))
    yoy = [x["yoy_pct"] for x in months if x["yoy_pct"] is not None]
    return {
        "available": True, "latest": months[-1], "months": months,
        "ytd_yoy_pct": _pct(ytd, ytd_prev),
        "yoy_3m_avg": round(sum(yoy[-3:]) / 3, 2) if len(yoy) >= 6 else None,
        "yoy_prev3m_avg": round(sum(yoy[-6:-3]) / 3, 2) if len(yoy) >= 6 else None,
    }


def _tw_quarters(code: str) -> Dict[str, Any]:
    start = (date.today() - timedelta(days=1000)).isoformat()
    rows = finmind.get_data("TaiwanStockFinancialStatements", code, start)
    q: Dict[str, Dict[str, float]] = {}
    for r in rows:
        if r["type"] in ("EPS", "Revenue", "GrossProfit", "OperatingIncome"):
            q.setdefault(r["date"], {})[r["type"]] = float(r["value"])
    dates = sorted(d for d in q if "EPS" in q[d])
    if len(dates) < 5:
        return {"available": False, "reason": "季財報不足 5 季"}
    out = []
    for d in dates[-8:]:
        x = q[d]
        rev = x.get("Revenue")
        yago = next((p for p in dates if p[:4] == str(int(d[:4]) - 1) and p[5:] == d[5:]), None)
        out.append({
            "quarter": f"{d[:4]}Q{(int(d[5:7]) - 1) // 3 + 1}", "eps": x["EPS"],
            "eps_yoy_pct": _pct(x["EPS"], q[yago]["EPS"]) if yago and q[yago]["EPS"] > 0 else None,
            "gross_margin_pct": round(x["GrossProfit"] / rev * 100, 2) if rev and "GrossProfit" in x else None,
            "op_margin_pct": round(x["OperatingIncome"] / rev * 100, 2) if rev and "OperatingIncome" in x else None,
        })
    ttm = sum(q[d]["EPS"] for d in dates[-4:])
    prev_ttm = sum(q[d]["EPS"] for d in dates[-8:-4]) if len(dates) >= 8 else None
    return {"available": True, "quarters": out, "ttm_eps": round(ttm, 2),
            "ttm_eps_yoy_pct": _pct(ttm, prev_ttm) if prev_ttm and prev_ttm > 0 else None}


def _tw(code: str, symbol: str) -> Dict[str, Any]:
    errors: List[str] = []

    def safe(fn, label):
        try:
            return fn(code)
        except Exception as e:  # FinMind 額度用完或暫停時，另一塊仍可顯示
            errors.append(f"{label}：{e}")
            return {"available": False, "reason": str(e)[:120]}

    rev = safe(_tw_revenue, "月營收")
    qs = safe(_tw_quarters, "季財報")
    val = stock_info._valuation().get(code, {})
    num = lambda x: float(x) if x not in (None, "", "-") else None  # noqa: E731
    return {
        "market": "TW", "revenue": rev, "quarterly": qs,
        "valuation": {"本益比": num(val.get("PEratio")), "股價淨值比": num(val.get("PBratio")),
                      "殖利率(%)": num(val.get("DividendYield"))},
        "estimates": None, "errors": errors,
        "sources": ["FinMind 月營收／季財報", "TWSE 本益比殖利率淨值比"],
    }


# ---------- 美股 ----------
def _raw(d: Dict[str, Any], k: str) -> Any:
    v = (d or {}).get(k)
    return v.get("raw") if isinstance(v, dict) else v


def _us(symbol: str) -> Dict[str, Any]:
    op, crumb = etf_data._yahoo_opener()
    res = None
    for ysym in etf_data._yahoo_candidates(symbol):
        url = (f"https://query2.finance.yahoo.com/v10/finance/quoteSummary/{urllib.parse.quote(ysym)}"
               "?modules=earnings,financialData,earningsTrend,calendarEvents,defaultKeyStatistics,earningsHistory,summaryDetail"
               f"&crumb={urllib.parse.quote(crumb)}")
        try:
            res = qp._http_json(url, timeout=15, opener=op)["quoteSummary"]["result"][0]
            break
        except Exception:
            continue
    if not res:
        raise RuntimeError("Yahoo 查無財報資料")
    fd, ks, sd = res.get("financialData") or {}, res.get("defaultKeyStatistics") or {}, res.get("summaryDetail") or {}
    hist = []
    for h in (res.get("earningsHistory") or {}).get("history") or []:
        a, e = _raw(h, "epsActual"), _raw(h, "epsEstimate")
        qd = _raw(h, "quarter")
        hist.append({"quarter": date.fromtimestamp(qd).isoformat() if isinstance(qd, (int, float)) else None,
                     "eps_actual": a, "eps_estimate": round(e, 3) if e is not None else None,
                     "surprise_pct": round(_raw(h, "surprisePercent") * 100, 2) if _raw(h, "surprisePercent") is not None else None})
    label = {"0q": "本季", "+1q": "下季", "0y": "今年度", "+1y": "明年度"}
    ests = []
    for t in (res.get("earningsTrend") or {}).get("trend") or []:
        if t.get("period") not in label:
            continue
        ee, re_, tr = t.get("earningsEstimate") or {}, t.get("revenueEstimate") or {}, t.get("epsTrend") or {}
        now, ago = _raw(tr, "current"), _raw(tr, "90daysAgo")
        ests.append({"period": label[t["period"]], "end": t.get("endDate"),
                     "eps_avg": round(_raw(ee, "avg"), 3) if _raw(ee, "avg") is not None else None, "eps_growth_pct": round(_raw(t, "growth") * 100, 1) if _raw(t, "growth") is not None else None,
                     "revenue_avg_b": round(_raw(re_, "avg") / 1e9, 2) if _raw(re_, "avg") else None,
                     "revenue_growth_pct": round(_raw(re_, "growth") * 100, 1) if _raw(re_, "growth") is not None else None,
                     "analysts": _raw(ee, "numberOfAnalysts"),
                     "revision_90d_pct": _pct(now, ago) if now and ago and ago > 0 else None})
    chart = ((res.get("earnings") or {}).get("financialsChart") or {}).get("quarterly") or []
    nxt = ((res.get("calendarEvents") or {}).get("earnings") or {}).get("earningsDate") or []
    price, target = _raw(fd, "currentPrice"), _raw(fd, "targetMeanPrice")
    target = round(target, 2) if target else target
    pctf = lambda v: round(v * 100, 2) if v is not None else None  # noqa: E731
    return {
        "market": "US",
        "quarterly": {"available": bool(chart), "quarters": [
            {"quarter": c.get("date"), "revenue_b": round(_raw(c, "revenue") / 1e9, 2) if _raw(c, "revenue") else None,
             "earnings_b": round(_raw(c, "earnings") / 1e9, 2) if _raw(c, "earnings") else None} for c in chart]},
        "eps_history": hist,
        "estimates": ests,
        "analyst": {"target_mean": target, "target_high": _raw(fd, "targetHighPrice"), "target_low": _raw(fd, "targetLowPrice"),
                    "count": _raw(fd, "numberOfAnalystOpinions"), "recommendation": _raw(fd, "recommendationKey"),
                    "upside_pct": _pct(target, price)},
        "margins": {"毛利率%": pctf(_raw(fd, "grossMargins")), "營業利益率%": pctf(_raw(fd, "operatingMargins")),
                    "營收年增%": pctf(_raw(fd, "revenueGrowth")), "獲利年增%": pctf(_raw(fd, "earningsGrowth"))},
        "valuation": {"本益比(TTM)": _raw(sd, "trailingPE"), "前瞻本益比": _raw(ks, "forwardPE"),
                      "PEG": _raw(ks, "pegRatio"), "股價淨值比": _raw(ks, "priceToBook")},
        "next_earnings": (nxt[0] or {}).get("fmt") if nxt else None,
        "errors": [], "sources": ["Yahoo Finance quoteSummary（財報、分析師預估）"],
    }


# ---------- 預期差規則 ----------
def expectation_gap(f: Dict[str, Any], ret: Dict[str, Optional[float]]) -> Dict[str, List[str]]:
    priced, up, down = [], [], []
    r6 = ret.get("6個月")
    if f["market"] == "TW":
        g = (f.get("quarterly") or {}).get("ttm_eps_yoy_pct")
        if r6 is not None and g is not None:
            if r6 > g + 20:
                priced.append(f"股價 6 個月漲 {r6}%，明顯高於近 4 季 EPS 年增 {g}%：漲幅來自評價拉高，好消息可能已先反映")
            elif r6 < g - 20:
                up.append(f"近 4 季 EPS 年增 {g}%，股價 6 個月只 {r6}%：獲利成長還沒完全反映在股價")
        rv = f.get("revenue") or {}
        a, b = rv.get("yoy_3m_avg"), rv.get("yoy_prev3m_avg")
        if a is not None and b is not None:
            if a > b + 10:
                up.append(f"月營收年增率加速：近 3 個月平均 {a}%，前 3 個月 {b}%")
            elif a < b - 10:
                down.append(f"月營收年增率放緩：近 3 個月平均 {a}%，前 3 個月 {b}%")
        qs = (f.get("quarterly") or {}).get("quarters") or []
        if len(qs) >= 5 and qs[-1]["gross_margin_pct"] is not None and qs[-5]["gross_margin_pct"] is not None:
            d = round(qs[-1]["gross_margin_pct"] - qs[-5]["gross_margin_pct"], 2)
            if d >= 2:
                up.append(f"毛利率 {qs[-1]['quarter']} {qs[-1]['gross_margin_pct']}%，比去年同季高 {d} 個百分點")
            elif d <= -2:
                down.append(f"毛利率 {qs[-1]['quarter']} {qs[-1]['gross_margin_pct']}%，比去年同季低 {abs(d)} 個百分點")
        pe = (f.get("valuation") or {}).get("本益比")
        if pe and pe >= 30:
            priced.append(f"本益比 {pe} 倍偏高，市場已給予高成長預期，財報只要不如預期就容易修正")
    else:
        hist = [h for h in f.get("eps_history") or [] if h.get("surprise_pct") is not None]
        if hist:
            beats = sum(1 for h in hist if h["surprise_pct"] > 0)
            avg = round(sum(h["surprise_pct"] for h in hist) / len(hist), 2)
            if beats == len(hist):
                priced.append(f"近 {len(hist)} 季 EPS 全部優於預估（平均 +{avg}%）：市場已習慣「財報打敗預期」，小幅超越不一定會漲")
            elif beats <= len(hist) // 2:
                down.append(f"近 {len(hist)} 季只有 {beats} 季 EPS 優於預估（平均驚喜 {avg}%）")
        for e in f.get("estimates") or []:
            rv = e.get("revision_90d_pct")
            if e["period"] in ("今年度", "明年度") and rv is not None:
                if rv >= 5:
                    priced.append(f"{e['period']} EPS 預估 90 天上修 {rv}%（現為 {e['eps_avg']}）：樂觀預期已在提高")
                elif rv <= -5:
                    down.append(f"{e['period']} EPS 預估 90 天下修 {abs(rv)}%（現為 {e['eps_avg']}）")
        an = f.get("analyst") or {}
        if an.get("upside_pct") is not None:
            if an["upside_pct"] < 0:
                priced.append(f"股價已高於分析師平均目標價 {an['target_mean']}（{an['count']} 位）")
            elif an["upside_pct"] >= 25:
                up.append(f"距分析師平均目標價 {an['target_mean']} 還有 {an['upside_pct']}%（{an['count']} 位分析師；目標價常落後股價調整）")
        v = f.get("valuation") or {}
        if v.get("本益比(TTM)") and v.get("前瞻本益比") and v["前瞻本益比"] < v["本益比(TTM)"] * 0.6:
            priced.append(f"前瞻本益比 {round(v['前瞻本益比'], 1)} 遠低於目前本益比 {round(v['本益比(TTM)'], 1)}：市場已假設獲利大幅成長，成長不如預期時風險較大")
    return {"可能已反映在股價": priced, "可能讓市場正向意外": up, "可能讓市場負向意外": down}


def analyze(symbol: str) -> Dict[str, Any]:
    def load():
        cat = stock_info.classify(symbol)["category"]
        if cat != "STOCK":
            return {"supported": False, "reason": "ETF／債券沒有單一公司的財報，請看成分股與配息"}
        n = DualMarketDataAdapter.normalize_symbol(symbol)
        f = _tw(n["raw_code"], symbol) if n["market"] == "TW" else _us(symbol)
        try:
            ret = _price_returns(symbol)
        except Exception:
            ret = {}
        return {"supported": True, "symbol": n["symbol"], **f, "price_returns_pct": ret,
                "expectation_gap": expectation_gap(f, ret),
                "gap_note": "以上依固定規則把真實財報數字分類，只是觀察方向，不是預測；綜合判斷請按「AI 解讀」。"}

    return etf_data._cached(f"fundamentals:{symbol}", load, ttl=TTL) or {"supported": False, "reason": "財報資料取得失敗"}


def compact(symbol: str) -> Dict[str, Any]:
    """給 AI 補充資料用的精簡版（去掉逐月明細）。"""
    f = analyze(symbol)
    if not f.get("supported"):
        return {"說明": f.get("reason")}
    out = {k: f.get(k) for k in ("valuation", "estimates", "analyst", "margins", "eps_history", "next_earnings",
                                  "price_returns_pct", "expectation_gap") if f.get(k)}
    if f["market"] == "TW":
        rv = f.get("revenue") or {}
        out["月營收"] = {k: rv.get(k) for k in ("latest", "ytd_yoy_pct", "yoy_3m_avg", "yoy_prev3m_avg")}
        out["近季財報"] = ((f.get("quarterly") or {}).get("quarters") or [])[-4:]
        out["近4季EPS"] = (f.get("quarterly") or {}).get("ttm_eps")
    else:
        out["近季營收獲利"] = (f.get("quarterly") or {}).get("quarters")
    return out
