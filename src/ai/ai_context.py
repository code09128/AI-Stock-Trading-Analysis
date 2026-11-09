"""
AI 補充資料包 (ai_context.py)
「AI 解讀」與「AI 決策」原本只收到當頁的一張指標快照，回答容易只看單一面向。
這裡在呼叫 AI 前，由後端另外整理同一檔標的的多面向真實資料（全部來自既有模組，各自快取）：
- 價格走勢：5／20／60／120／250 日報酬、距 52 週高低點、近 10 日收盤、量能變化
- 籌碼面（台股）：三大法人 5／20 日買賣超、融資融券變化、外資持股比、白話觀察
- 基本面／評價：本益比、淨值比、殖利率、產業、配息節奏
- 財報與市場預期：月營收、季 EPS／毛利率、分析師預估與上下修、預期差（見 fundamentals.py）
- 消息面：最近新聞與重大訊息標題（依相關度排序）
- 大盤環境：該市場指數相對 MA20／MA60 的位置與 20 日報酬
任何一塊抓不到就標示「資料不足」與原因，不補假資料。
"""

from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable, Dict, List, Optional

from src.market import chip_data, markets

from src.company import fundamentals as fin, stock_info, valuation

from src.news import news_feed
from src.market.data_adapter import DualMarketDataAdapter
from src.technical.indicators import calculate_ma


def _ret(closes: List[float], n: int) -> Optional[float]:
    return round((closes[-1] / closes[-1 - n] - 1) * 100, 2) if len(closes) > n and closes[-1 - n] else None


def price_action(symbol: str) -> Dict[str, Any]:
    feed = DualMarketDataAdapter().fetch_bars(symbol, days=260)
    bars = feed["bars"]
    closes = [b.close for b in bars]
    year = bars[-250:]
    hi, lo = max(b.high for b in year), min(b.low for b in year)
    vols = [b.volume for b in bars]
    avg20 = sum(vols[-20:]) / min(20, len(vols))
    avg60 = sum(vols[-60:]) / min(60, len(vols))
    return {
        "資料日期": bars[-1].timestamp,
        "幣別": feed["currency"],
        "報酬率%": {f"{n}日": _ret(closes, n) for n in (5, 20, 60, 120, 250)},
        "52週高點": round(hi, 2),
        "52週低點": round(lo, 2),
        "距52週高點%": round((closes[-1] / hi - 1) * 100, 2),
        "距52週低點%": round((closes[-1] / lo - 1) * 100, 2),
        "近10日收盤": [[b.timestamp[5:], round(b.close, 2)] for b in bars[-10:]],
        "20日均量÷60日均量": round(avg20 / avg60, 2) if avg60 else None,
    }


def tech_indicators(symbol: str) -> Dict[str, Any]:
    snap = DualMarketDataAdapter().build_technical_snapshot(symbol)
    score = snap.get("trend_score") or {}
    ind = snap.get("indicators") or {}
    has_macd = ind.get("MACD_DIF") is not None
    return {
        "資料日期": snap.get("latest_date"),
        "趨勢評分": f"{score.get('total')}/100（{score.get('signal_label')}）" if score else None,
        "RSI14": ind.get("RSI14"),
        "MA5": ind.get("MA5"),
        "MA20": ind.get("MA20"),
        "MA60": ind.get("MA60"),
        "MACD": f"DIF {ind.get('MACD_DIF')} / DEA {ind.get('MACD_SIGNAL')} / 柱狀 {ind.get('MACD_HIST')}" if has_macd else None,
        "ATR14": ind.get("ATR14"),
        "支撐(20日低)": snap.get("recent_low_20d"),
        "壓力(20日高)": snap.get("recent_high_20d"),
    }


def chips(symbol: str) -> Dict[str, Any]:
    c = chip_data.chips(symbol)
    if not c.get("supported") or c.get("empty"):
        return {"說明": c.get("reason")}
    return {
        "資料日期": c.get("latest_date"),
        "三大法人(張)": c.get("institutional"),
        "融資融券(張)": c.get("margin"),
        "外資持股比": c.get("foreign_holding"),
        "觀察": c.get("notes"),
        "抓取錯誤": c.get("errors") or None,
    }


def fundamentals(symbol: str) -> Dict[str, Any]:
    s = stock_info.stock_info(symbol)
    prof = {k: v for k, v in (s.get("profile") or {}).items()
            if not k.startswith("_") and k not in ("網站", "簡介(英文)", "董事長", "成立日期")}
    div = (s.get("dividends") or {}).get("analysis") or {}
    return {
        "名稱": s.get("name"),
        "類別": s.get("label"),
        "基本資料與評價": prof,
        "配息": {k: div.get(k) for k in ("frequency", "ttm_cash", "ttm_yield_pct", "next_announced", "next_estimate")},
        "ETF前幾大成分股": [(h.get("symbol"), h.get("pct")) for h in ((s.get("holdings") or {}).get("holdings") or [])[:5]]
        or None,
    }


def news(symbol: str, name: str = "", limit: int = 8) -> List[Dict[str, Any]]:
    n = DualMarketDataAdapter.normalize_symbol(symbol)
    items = news_feed.fetch_news(symbol, name).get("items", [])
    keys = [k for k in (name, n["raw_code"].split(".")[0]) if k]

    def rank(it: Dict[str, Any]) -> tuple:
        official = it.get("kind") in ("重大訊息", "8-K")
        relevant = any(k.lower() in str(it.get("title", "")).lower() for k in keys)
        return (not official, not relevant)

    picked = sorted(items, key=rank)[:limit]
    return [{"時間": str(it.get("local_iso", ""))[:16].replace("T", " "), "類型": it.get("kind"),
             "來源": it.get("source"), "標題": str(it.get("title", ""))[:120]} for it in picked]


def market_backdrop(symbol: str) -> Dict[str, Any]:
    market = DualMarketDataAdapter.normalize_symbol(symbol)["market"]
    index = markets.info(market)["index"]
    bars = DualMarketDataAdapter()._fetch_from_yahoo(index, days=120)
    closes = [b.close for b in bars]
    ma20, ma60 = calculate_ma(closes, 20)[-1], calculate_ma(closes, 60)[-1]
    c = closes[-1]
    trend = ("多頭" if c > ma20 > ma60 else "空頭" if c < ma20 < ma60 else "盤整") if ma20 and ma60 else "資料不足"
    return {"指數": index, "市場": markets.info(market)["name"], "收盤": round(c, 2),
            "相對MA20%": round((c / ma20 - 1) * 100, 2) if ma20 else None,
            "相對MA60%": round((c / ma60 - 1) * 100, 2) if ma60 else None,
            "20日報酬%": _ret(closes, 20), "趨勢": trend}


def build(symbol: str, sections=("price", "chips", "fundamentals", "news", "market")) -> Dict[str, Any]:
    """平行抓各面向；每塊獨立失敗、標示原因。"""
    name = ""
    try:
        name = stock_info._quote(symbol).get("name") or ""
    except Exception:
        pass
    jobs: Dict[str, Callable[[], Any]] = {
        "price": lambda: price_action(symbol),
        "tech": lambda: tech_indicators(symbol),
        "chips": lambda: chips(symbol),
        "fundamentals": lambda: fundamentals(symbol),
        "earnings": lambda: fin.compact(symbol),
        "news": lambda: news(symbol, name),
        "market": lambda: market_backdrop(symbol),
    }
    labels = {"price": "價格走勢", "tech": "技術指標", "chips": "籌碼面", "fundamentals": "基本面與評價",
              "earnings": "財報與市場預期", "news": "近期新聞與公告", "market": "大盤環境"}
    out: Dict[str, Any] = {"標的": symbol, "名稱": name}

    def run(key: str):
        try:
            return key, jobs[key]()
        except Exception as e:
            return key, {"資料不足": str(e)[:160]}

    with ThreadPoolExecutor(max_workers=6) as ex:
        for key, val in ex.map(run, [s for s in sections if s in jobs]):
            out[labels[key]] = val
    return out


def symbol_of(module: str, data: Any) -> Optional[str]:
    """從各頁送來的資料找出標的代號（技術分析、基本資料、新聞判斷）。"""
    if not isinstance(data, dict):
        return None
    if module == "mod1":
        return (data.get("snapshot") or {}).get("symbol")
    if module in ("stock", "mod2"):
        return data.get("symbol")
    return None


SECTIONS_BY_MODULE = {
    "mod1": ("price", "tech", "chips", "fundamentals", "earnings", "news", "market"),
    "stock": ("price", "tech", "chips", "fundamentals", "earnings", "news", "market"),
    "mod2": ("price", "tech", "news", "market"),
}


SECTION_LABELS = {"price": "價格走勢", "tech": "技術指標", "chips": "籌碼面", "fundamentals": "基本面與評價",
                  "earnings": "財報與市場預期", "news": "近期新聞與公告", "market": "大盤環境"}


def _flat_facts(val: Any) -> Dict[str, str]:
    """把一個面向的資料攤平成「欄位：值」給畫面顯示；巢狀或太長的值截短（只是預覽，實際送給 AI 的是完整資料）。"""
    if isinstance(val, dict):
        return {str(k): (str(v) if not isinstance(v, (dict, list)) else str(v)[:120]) for k, v in val.items() if v is not None}
    if isinstance(val, list):
        return {str(i + 1): str(x.get("標題") or x.get("title") or x)[:120] if isinstance(x, dict) else str(x)[:120]
                for i, x in enumerate(val[:8])}
    return {}


def preview(symbol: str, module: str = "stock") -> Dict[str, Any]:
    """各面向有沒有資料、有哪些欄位；抓不到的標「資料不足」與原因。"""
    base = SECTIONS_BY_MODULE.get(module, ())
    built = build(symbol, base) if symbol and base else {}
    sections = []
    for key in base:
        label = SECTION_LABELS[key]
        val = built.get(label)
        why = val.get("資料不足") if isinstance(val, dict) else None
        facts = {} if why else _flat_facts(val)
        ok = bool(facts)
        sections.append({"key": key, "label": label, "ok": ok, "facts": facts,
                         "why": "" if ok else str(why or "這檔沒有這部分的資料")})
    return {"symbol": symbol, "name": built.get("名稱", ""), "module": module, "sections": sections}


def pick_sections(module: str, aspects=None) -> tuple:
    """該頁預設的資料面向；使用者勾選了面向（aspects）就只取交集。
    不認得的名稱直接忽略；全部都不認得或沒勾任何一個時，視為沒有指定、用預設（不會因此送出空資料）。"""
    base = SECTIONS_BY_MODULE.get(module, ())
    if not isinstance(aspects, (list, tuple)):
        return base
    chosen = tuple(s for s in base if s in aspects)
    return chosen or base


def summary_lines(symbol: str) -> str:
    """給「AI 決策」提示詞用的精簡摘要（只在真的要呼叫 AI 時才組）。"""
    c = build(symbol)
    lines = []
    pa = c.get("價格走勢") or {}
    if "報酬率%" in pa:
        r = pa["報酬率%"]
        lines.append(f"價格位置：5日 {r.get('5日')}%、20日 {r.get('20日')}%、60日 {r.get('60日')}%、120日 {r.get('120日')}%；"
                     f"距52週高點 {pa.get('距52週高點%')}%、距52週低點 {pa.get('距52週低點%')}%")
    ch = c.get("籌碼面") or {}
    if ch.get("觀察"):
        lines.append("籌碼觀察：" + "；".join(ch["觀察"]))
    elif ch.get("說明"):
        lines.append("籌碼：" + str(ch["說明"]))
    fu = (c.get("基本面與評價") or {}).get("基本資料與評價") or {}
    val = {k: v for k, v in fu.items() if any(x in k for x in ("本益比", "淨值比", "殖利率"))}
    if val:
        lines.append("評價：" + "、".join(f"{k} {v}" for k, v in val.items()))
    vb = valuation.brief(symbol)
    if vb:
        lines.append(vb)
    mk = c.get("大盤環境") or {}
    if "趨勢" in mk:
        lines.append(f"大盤（{mk.get('指數')}）：{mk.get('趨勢')}，相對MA20 {mk.get('相對MA20%')}%、20日報酬 {mk.get('20日報酬%')}%")
    nw = c.get("近期新聞與公告")
    if isinstance(nw, list) and nw:
        lines.append("近期新聞標題：" + "／".join(n["標題"][:60] for n in nw[:3]))
    return ("補充資料（請一併考量，與技術面矛盾時要在理由中說明）：\n" + "\n".join(lines) + "\n") if lines else ""
