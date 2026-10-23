"""
個股／ETF 基本資料與配息資訊 (stock_info.py)
- 分類：股票 / ETF / 債券（台股用 TWSE 基金清單；債券 ETF 看類型或代號 B 結尾；美股看 Yahoo instrumentType）
- 配息：台股用 FinMind TaiwanStockDividend（有除息日、發放日、每股現金股利，含已公告未來場次），失敗回退 Yahoo 配息紀錄；
  美股用 Yahoo 配息紀錄（只有除息日）。配息頻率與常見月份由實際紀錄統計，「下次推測」會明確標示為推測。
- 基本資料：台股公司＝TWSE 上市公司基本資料 + 本益比/殖利率/淨值比；ETF＝TWSE 基金清單 + 前十大成分股；美股＝Yahoo quoteSummary。
取不到的欄位回 None，由前端顯示「無資料」，不填假數字。快取 6 小時。
"""

from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional
import re
import urllib.parse

from src.market import etf_data, finmind
from src.market import quote_provider as qp
from src.market.data_adapter import DualMarketDataAdapter

INDUSTRY = {
    "01": "水泥工業", "02": "食品工業", "03": "塑膠工業", "04": "紡織纖維", "05": "電機機械",
    "06": "電器電纜", "08": "玻璃陶瓷", "09": "造紙工業", "10": "鋼鐵工業", "11": "橡膠工業",
    "12": "汽車工業", "14": "建材營造", "15": "航運業", "16": "觀光餐旅", "17": "金融保險",
    "18": "貿易百貨", "19": "綜合", "20": "其他", "21": "化學工業", "22": "生技醫療",
    "23": "油電燃氣", "24": "半導體", "25": "電腦及週邊設備", "26": "光電業", "27": "通信網路業",
    "28": "電子零組件", "29": "電子通路業", "30": "資訊服務業", "31": "其他電子業", "35": "綠能環保",
    "36": "數位雲端", "37": "運動休閒", "38": "居家生活",
}
CATEGORY_LABEL = {"STOCK": "股票", "ETF": "ETF", "BOND": "債券"}
BOND_WORDS = re.compile(r"bond|treasury|aggregate|fixed income|債", re.I)


def _company_registry() -> Dict[str, Dict[str, Any]]:
    def load():
        rows = qp._http_json("https://openapi.twse.com.tw/v1/opendata/t187ap03_L", timeout=25)
        return {str(r.get("公司代號", "")).strip().upper(): r for r in rows}

    return etf_data._cached("company_registry", load, ttl=24 * 3600) or {}


def _valuation() -> Dict[str, Dict[str, Any]]:
    def load():
        rows = qp._http_json("https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL", timeout=25)
        return {str(r.get("Code", "")).strip().upper(): r for r in rows}

    return etf_data._cached("valuation", load, ttl=6 * 3600) or {}


def _quote(symbol: str) -> Dict[str, Any]:
    try:
        return qp.get_quotes([symbol], {})[0]
    except Exception:
        return {}


def classify(symbol: str) -> Dict[str, Any]:
    n = DualMarketDataAdapter.normalize_symbol(symbol)
    code = n["raw_code"].upper()
    if n["market"] == "TW":
        reg = etf_data.fund_registry().get(code)
        if reg:
            typ = str(reg.get("基金類型", ""))
            cat = "BOND" if "債" in typ or "債" in str(reg.get("基金簡稱", "")) else "ETF"
        elif code.startswith("00"):
            cat = "BOND" if code.endswith("B") else "ETF"
        else:
            cat = "STOCK"
    else:
        q = _quote(symbol)
        it = str(q.get("instrument_type") or "").upper()
        if it in ("ETF", "MUTUALFUND"):
            cat = "BOND" if BOND_WORDS.search(str(q.get("name", ""))) else "ETF"
        else:
            cat = "STOCK"
    return {"symbol": n["symbol"], "code": code, "market": n["market"], "category": cat,
            "label": CATEGORY_LABEL[cat]}


def categories(symbols: List[str]) -> Dict[str, Dict[str, Any]]:
    with ThreadPoolExecutor(max_workers=6) as ex:
        res = list(ex.map(classify, symbols))
    return {r["code"]: r for r in res}


# ---------- 配息 ----------
def _dividends_finmind(code: str) -> List[Dict[str, Any]]:
    start = (date.today() - timedelta(days=365 * 4)).isoformat()
    rows = finmind.get_data("TaiwanStockDividend", code, start)
    out = []
    for r in rows:
        cash = float(r.get("CashEarningsDistribution") or 0) + float(r.get("CashStatutorySurplus") or 0)
        ex = r.get("CashExDividendTradingDate") or ""
        if cash <= 0 or not ex:
            continue
        out.append({"ex_date": ex, "pay_date": r.get("CashDividendPaymentDate") or None,
                    "cash": round(cash, 4), "period": r.get("year") or ""})
    return out


def _dividends_yahoo(symbol: str) -> List[Dict[str, Any]]:
    for ysym in etf_data._yahoo_candidates(symbol):
        try:
            url = f"{qp.YAHOO_URL}{urllib.parse.quote(ysym)}?interval=1d&range=5y&events=div"
            res = qp._http_json(url, timeout=15)["chart"]["result"][0]
        except Exception:
            continue
        divs = (res.get("events") or {}).get("dividends") or {}
        gmt = res["meta"].get("gmtoffset", 0)
        return [{"ex_date": datetime.utcfromtimestamp(d["date"] + gmt).strftime("%Y-%m-%d"), "pay_date": None,
                 "cash": round(d["amount"], 4), "period": ""} for d in divs.values()]
    return []


def dividend_events(symbol: str) -> Dict[str, Any]:
    def load():
        n = DualMarketDataAdapter.normalize_symbol(symbol)
        events, source = [], ""
        if n["market"] == "TW":
            try:
                events = _dividends_finmind(n["raw_code"])
                source = "FinMind TaiwanStockDividend（含除息日與發放日）"
            except Exception:
                events = []
        if not events:
            events = _dividends_yahoo(symbol)
            source = "Yahoo Finance 配息紀錄（只有除息日，沒有發放日）" if events else ""
        seen, uniq = set(), []
        for e in sorted(events, key=lambda x: x["ex_date"], reverse=True):
            k = (e["ex_date"], e["cash"])
            if k not in seen:
                seen.add(k)
                uniq.append(e)
        return {"events": uniq, "source": source}

    return etf_data._cached(f"divev:{symbol}", load) or {"events": [], "source": ""}


def analyze_dividends(events: List[Dict[str, Any]], price: Optional[float]) -> Dict[str, Any]:
    today = date.today()
    past = [e for e in events if e["ex_date"] <= today.isoformat()]
    future = sorted([e for e in events if e["ex_date"] > today.isoformat()], key=lambda x: x["ex_date"])
    last12 = [e for e in past if e["ex_date"] >= (today - timedelta(days=365)).isoformat()]
    n12 = len(last12)
    freq = ("月配" if n12 >= 10 else "雙月配" if n12 >= 6 else "季配" if n12 >= 3 else "半年配" if n12 == 2
            else "年配" if n12 == 1 else "近一年無配息")
    ttm = round(sum(e["cash"] for e in last12), 4)
    three = [e for e in past if e["ex_date"] >= (today - timedelta(days=365 * 3)).isoformat()]
    cnt = Counter(int(e["ex_date"][5:7]) for e in three)
    typical = sorted(m for m, c in cnt.items() if c >= 2)
    if not typical:
        typical = sorted({int(e["ex_date"][5:7]) for e in last12})
    result: Dict[str, Any] = {
        "frequency": freq, "ttm_cash": ttm, "events_last12": n12,
        "ttm_yield_pct": round(ttm / price * 100, 2) if price else None,
        "typical_months": typical, "months_last12": sorted({int(e["ex_date"][5:7]) for e in last12}),
        "next_announced": future[0] if future else None, "next_estimate": None,
    }
    if not future and typical:
        nxt = next((m for m in typical if m > today.month), typical[0])
        result["next_estimate"] = f"依過去規律，下次可能在 {nxt} 月除息（推測，非公告，實際以公司公告為準）"
    return result


def dividend_calendar(symbols: List[str]) -> Dict[str, Any]:
    def one(sym: str) -> Dict[str, Any]:
        ev = dividend_events(sym)
        price = (_quote(sym) or {}).get("price")
        a = analyze_dividends(ev["events"], price)
        today = date.today().isoformat()
        upcoming = [e for e in ev["events"] if e["ex_date"] > today][:3]
        recent = [e for e in ev["events"] if e["ex_date"] <= today][:4]
        return {"symbol": sym, **a, "upcoming": upcoming, "recent": recent, "source": ev["source"]}

    with ThreadPoolExecutor(max_workers=4) as ex:
        return {"rows": list(ex.map(one, symbols))}


# ---------- 基本資料 ----------
def _profile_tw_stock(code: str) -> Dict[str, Any]:
    c = _company_registry().get(code, {})
    v = _valuation().get(code, {})
    num = lambda x: float(x) if x not in (None, "", "-") else None  # noqa: E731
    cap = num(c.get("實收資本額"))
    return {
        "公司全名": c.get("公司名稱"), "產業別": INDUSTRY.get(str(c.get("產業別", "")).zfill(2), c.get("產業別")),
        "董事長": c.get("董事長"), "成立日期": c.get("成立日期"), "上市日期": c.get("上市日期"),
        "實收資本額(億)": round(cap / 1e8, 1) if cap else None, "網站": c.get("網址"),
        "本益比": num(v.get("PEratio")), "股價淨值比": num(v.get("PBratio")), "殖利率(%)": num(v.get("DividendYield")),
        "_source": "TWSE OpenAPI 上市公司基本資料 / 本益比殖利率淨值比",
    }


def _profile_tw_fund(code: str, price: Optional[float]) -> Dict[str, Any]:
    r = etf_data.fund_registry().get(code, {})
    units = None
    try:
        units = float(r.get("發行單位數/轉換數"))
    except (TypeError, ValueError):
        pass
    return {
        "基金全名": r.get("基金中文名稱"), "類型": r.get("基金類型"), "追蹤指數": r.get("標的指數/追蹤指數名稱"),
        "成立日期": r.get("成立日期"), "上市日期": r.get("上市日期"), "基金經理人": r.get("基金經理人"),
        "發行單位數(億)": round(units / 1e8, 2) if units else None,
        "市值估算(億)": round(units * price / 1e8, 1) if units and price else None,
        "定期定額戶數": etf_data.savings_plan_rank().get(code),
        "_source": "TWSE OpenAPI 基金基本資料（找不到代號時欄位為空，例如上櫃債券 ETF）",
    }


def _profile_yahoo(symbol: str) -> Dict[str, Any]:
    op, crumb = etf_data._yahoo_opener()
    for ysym in etf_data._yahoo_candidates(symbol):
        url = ("https://query2.finance.yahoo.com/v10/finance/quoteSummary/"
               f"{urllib.parse.quote(ysym)}?modules=assetProfile,summaryDetail,defaultKeyStatistics,fundProfile"
               f"&crumb={urllib.parse.quote(crumb)}")
        try:
            res = qp._http_json(url, timeout=15, opener=op)["quoteSummary"]["result"][0]
        except Exception:
            continue
        raw = lambda d, k: (d.get(k) or {}).get("raw") if isinstance(d.get(k), dict) else d.get(k)  # noqa: E731
        ap, sd, ks, fp = (res.get(k) or {} for k in ("assetProfile", "summaryDetail", "defaultKeyStatistics", "fundProfile"))
        return {
            "產業": ap.get("industry"), "板塊": ap.get("sector"), "員工數": ap.get("fullTimeEmployees"),
            "簡介(英文)": (ap.get("longBusinessSummary") or "")[:400] or None,
            "網站": ap.get("website"), "本益比(TTM)": raw(sd, "trailingPE"), "市值": raw(sd, "marketCap"),
            "Beta": raw(sd, "beta") or raw(ks, "beta"), "殖利率(%)": round(raw(sd, "dividendYield") * 100, 2)
            if raw(sd, "dividendYield") else None, "基金類別": fp.get("categoryName"),
            "基金公司": fp.get("family"), "費用率(%)": round(raw(fp.get("feesExpensesInvestment") or {}, "annualReportExpenseRatio") * 100, 3)
            if raw(fp.get("feesExpensesInvestment") or {}, "annualReportExpenseRatio") else None,
            "_source": "Yahoo Finance quoteSummary",
        }
    return {}


def stock_info(symbol: str) -> Dict[str, Any]:
    q = _quote(symbol)
    if not q or (not q.get("is_live") and q.get("error")):
        # 報價都查不到就不要猜分類（以前會把不存在的代號標成「股票」並用代號當名稱）
        raise ValueError(f"查無 {symbol.strip()} 的資料：{(q or {}).get('error') or '代號可能不存在'}")
    cls = classify(symbol)
    price = q.get("price")
    with ThreadPoolExecutor(max_workers=3) as ex:
        f_div = ex.submit(dividend_events, symbol)
        if cls["market"] == "TW":
            f_prof = ex.submit(_profile_tw_stock if cls["category"] == "STOCK" else _profile_tw_fund,
                               *( [cls["code"]] if cls["category"] == "STOCK" else [cls["code"], price]))
        else:
            f_prof = ex.submit(_profile_yahoo, symbol)
        f_hold = ex.submit(etf_data.top_holdings, cls["code"]) if cls["category"] != "STOCK" else None
        div = f_div.result()
        try:
            profile = f_prof.result()
        except Exception as e:
            profile = {"_error": str(e)}
        holdings = f_hold.result() if f_hold else None
    analysis = analyze_dividends(div["events"], price)
    return {
        **cls, "name": q.get("name"), "price": price, "currency": q.get("currency"),
        "profile": {k: v for k, v in profile.items() if v not in (None, "")},
        "dividends": {"events": div["events"][:24], "analysis": analysis, "source": div["source"]},
        "holdings": holdings,
    }
