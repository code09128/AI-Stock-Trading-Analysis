"""
股市熱力圖資料 (heatmap.py) — 看盤頁「股市熱力圖」分頁用
- 股票池：我的自選＋持股（前端傳代號）／台股熱門族群／美股核心（內建清單，見 POOLS）
- 每檔：漲跌幅、成交值、市值、持股市值，全部換算台幣方便同一張圖比較。
  台股走 quote_provider（TWSE MIS，與看盤頁共用快取）；其他市場用 Yahoo v7 批次報價一次查完（逐檔查要 5 秒以上），
  批次失敗才退回 quote_provider 逐檔查
- 市值：台股上市公司＝TWSE 已發行普通股數 × 現價；台股 ETF＝TWSE 發行單位數 × 現價；
  美股＝Yahoo v7 quote 的 marketCap（ETF 沒有市值欄位）。上櫃公司沒有可用的公開 JSON，市值留空
- 分群：內建池用固定族群；自選池台股用 TWSE 產業別、美股用 Yahoo sector、ETF／債券 ETF 各自一群
取不到的欄位一律回 None 並附原因，不補假值。
"""

from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, List, Optional
import time
import urllib.parse

from src.company import stock_info
from src.market import etf_data, fx, markets
from src.market import quote_provider as qp
from src.market.data_adapter import DualMarketDataAdapter
from src.market.util import to_num as _num

MAX_SYMBOLS = 60

POOLS: Dict[str, Dict[str, Any]] = {
    "tw_hot": {
        "label": "台股熱門族群",
        "groups": [
            ("半導體", ["2330", "2454", "2303", "3711", "2379", "3034", "3443"]),
            ("AI 伺服器／電腦", ["2317", "2382", "3231", "6669", "2357", "2376"]),
            ("電子零組件／光學", ["2308", "3037", "2327", "3008"]),
            ("金融", ["2881", "2882", "2891", "2886"]),
            ("航運", ["2603", "2609", "2615"]),
            ("傳產", ["1301", "2002", "1216"]),
            ("熱門 ETF", ["0050", "0056", "00878", "00919", "006208"]),
        ],
    },
    "us_core": {
        "label": "美股核心",
        "groups": [
            ("科技七雄", ["AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA"]),
            ("AI 半導體", ["AVGO", "AMD", "TSM", "MU", "QCOM", "INTC"]),
            ("其他龍頭", ["JPM", "V", "LLY", "COST", "WMT"]),
            ("大盤與債券 ETF", ["SPY", "QQQ", "VTI", "SOXX", "TLT"]),
        ],
    },
}

US_SECTOR_ZH = {
    "Technology": "科技", "Communication Services": "通訊服務", "Consumer Cyclical": "非必需消費",
    "Consumer Defensive": "必需消費", "Financial Services": "金融", "Healthcare": "醫療保健",
    "Industrials": "工業", "Energy": "能源", "Utilities": "公用事業", "Real Estate": "不動產",
    "Basic Materials": "原物料",
}


V7_FIELDS = ("regularMarketPrice,regularMarketChangePercent,regularMarketVolume,regularMarketTime,currency,"
             "shortName,longName,marketCap,sector,quoteType")


def _yahoo_batch(symbols: List[str]) -> Dict[str, Dict[str, Any]]:
    """Yahoo v7 批次報價：價格、漲跌幅、成交量、市值、sector、quoteType（一次請求，快取 10 秒）。"""
    if not symbols:
        return {}

    def load():
        op, crumb = etf_data._yahoo_opener()
        url = ("https://query2.finance.yahoo.com/v7/finance/quote?"
               + urllib.parse.urlencode({"symbols": ",".join(symbols), "fields": V7_FIELDS, "crumb": crumb}))
        rows = qp._http_json(url, timeout=12, opener=op).get("quoteResponse", {}).get("result", [])
        return {str(r.get("symbol", "")).upper(): r for r in rows} or None

    return etf_data._cached("heatmap_v7:" + ",".join(sorted(symbols)), load, ttl=10) or {}


def _from_v7(n: Dict[str, str], r: Dict[str, Any]) -> Dict[str, Any]:
    price = _num(r.get("regularMarketPrice"))
    t = r.get("regularMarketTime")
    return {"symbol": n["symbol"], "name": " ".join(str(r.get("shortName") or r.get("longName") or n["raw_code"]).split()),
            "currency": r.get("currency") or n["currency"], "is_live": price is not None, "price": price,
            "change_pct": round(r["regularMarketChangePercent"], 2) if r.get("regularMarketChangePercent") is not None else None,
            "volume": _num(r.get("regularMarketVolume")), "volume_unit": "股",
            "quote_time": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(t)) if t else "",
            "error": None if price is not None else "Yahoo 批次報價沒有這檔的價格"}


def _tw_info(code: str) -> Dict[str, Any]:
    """台股：分群名稱與發行股數／單位數（取不到為 None）。"""
    fund = etf_data.fund_registry().get(code)
    if fund or code.startswith("00"):
        typ = str((fund or {}).get("基金類型", "")) + str((fund or {}).get("基金簡稱", ""))
        bond = "債" in typ or code.endswith("B")
        return {"group": "債券 ETF" if bond else "台股 ETF",
                "shares": _num((fund or {}).get("發行單位數/轉換數")),
                "cap_note": None if fund else "TWSE 基金清單查無此代號（多為上櫃 ETF），沒有發行單位數"}
    c = stock_info._company_registry().get(code)
    if not c:
        return {"group": "上櫃／其他", "shares": None, "cap_note": "上櫃公司沒有可用的公開股數資料"}
    ind = str(c.get("產業別", "")).zfill(2)
    return {"group": stock_info.INDUSTRY.get(ind, "其他"), "shares": _num(c.get("已發行普通股數或TDR原股發行股數")),
            "cap_note": None}


def build(pool: str, symbols: Optional[List[str]] = None,
          holdings: Optional[Dict[str, float]] = None) -> Dict[str, Any]:
    if pool in POOLS:
        spec = [(g, s) for g, ss in POOLS[pool]["groups"] for s in ss]
        label = POOLS[pool]["label"]
    elif pool == "mine":
        spec = [(None, s) for s in dict.fromkeys(str(x).strip() for x in (symbols or []) if str(x).strip())]
        label = "我的自選＋持股"
    else:
        raise ValueError(f"不支援的股票池：{pool}（可用 mine、tw_hot、us_core）")
    spec = spec[:MAX_SYMBOLS]
    norms = [DualMarketDataAdapter.normalize_symbol(s) for _, s in spec]
    tw_syms = [n["symbol"] for n in norms if n["market"] == "TW"]
    us_norms = [n for n in norms if n["market"] != "TW"]
    quotes = {q["symbol"]: q for q in qp.get_quotes(tw_syms, {}) if q} if tw_syms else {}
    meta = _yahoo_batch([n["symbol"] for n in us_norms])
    missing = [n["symbol"] for n in us_norms if n["symbol"].upper() not in meta]
    for n in us_norms:
        if n["symbol"].upper() in meta:
            quotes[n["symbol"]] = _from_v7(n, meta[n["symbol"].upper()])
    if missing:  # 批次沒回來的（或整個批次失敗）逐檔查
        quotes.update({q["symbol"]: q for q in qp.get_quotes(missing, {}) if q})
    tw_codes = [n["raw_code"] for n in norms if n["market"] == "TW"]
    with ThreadPoolExecutor(max_workers=4) as ex:
        tw_info = dict(zip(tw_codes, ex.map(_tw_info, tw_codes)))
    rates = fx.rates_to_twd({(quotes.get(n["symbol"]) or {}).get("currency") or n["currency"] for n in norms})
    hold = {DualMarketDataAdapter.normalize_symbol(k)["symbol"]: _num(v) for k, v in (holdings or {}).items()}

    items, warnings = [], []
    for (group, _), n in zip(spec, norms):
        q = quotes.get(n["symbol"]) or {}
        cur = q.get("currency") or n["currency"]
        rate = (rates.get(cur) or {}).get("rate")
        price, vol = q.get("price"), q.get("volume")
        tw = n["market"] == "TW"
        shares_traded = (vol * 1000 if q.get("volume_unit") == "張" else vol) if vol is not None else None
        turnover = price * shares_traded * rate if price and shares_traded is not None and rate else None
        cap, cap_note = None, None
        if tw:
            info = tw_info.get(n["raw_code"], {})
            group = group or info.get("group")
            if info.get("shares") and price and rate:
                cap = info["shares"] * price * rate
            cap_note = info.get("cap_note")
        else:
            m = meta.get(n["symbol"].upper(), {})
            if m.get("marketCap") and rate:
                cap = m["marketCap"] * rate * (100 if cur in ("GBp", "GBX") else 1)  # 英股報價是便士，marketCap 是英鎊
            else:
                cap_note = "ETF 沒有市值欄位" if m.get("quoteType") == "ETF" else "Yahoo 沒有回傳市值"
            if not group:
                if m.get("quoteType") == "ETF":
                    group = "美股 ETF" if n["market"] == "US" else f"{markets.info(n['market'])['name']} ETF"
                elif n["market"] != "US":
                    group = markets.info(n["market"])["name"]
                else:
                    group = f"美股・{US_SECTOR_ZH.get(m.get('sector'), m.get('sector') or '其他')}"
        held = hold.get(n["symbol"])
        lu, ld = q.get("limit_up"), q.get("limit_down")
        items.append({
            "symbol": n["symbol"], "code": n["raw_code"], "name": q.get("name") or n["raw_code"],
            "market": n["market"], "group": group or "其他", "currency": cur,
            "price": price, "change_pct": q.get("change_pct"),
            "volume": vol, "volume_unit": q.get("volume_unit"),
            "turnover_twd": round(turnover) if turnover else None,
            "market_cap_twd": round(cap) if cap else None, "market_cap_note": cap_note,
            "holding_twd": round(held * price * rate) if held and price and rate else None,
            "limit_up": bool(price and lu and price >= lu), "limit_down": bool(price and ld and price <= ld),
            "quote_time": q.get("quote_time"), "error": None if q.get("is_live") else (q.get("error") or "沒有取得報價"),
            "stale_warning": q.get("stale_warning"),
        })
    for cur, r in rates.items():
        if r.get("warning"):
            warnings.append(r["warning"])
    bad = [i["code"] for i in items if i["error"]]
    if bad:
        warnings.append(f"{len(bad)} 檔抓不到報價（{'、'.join(bad[:8])}），以灰色顯示")
    groups: Dict[str, List[str]] = {}
    for it in items:
        groups.setdefault(it["group"], []).append(it["symbol"])
    return {
        "pool": pool, "label": label, "items": items,
        "groups": [{"name": g, "symbols": s} for g, s in groups.items()],
        "warnings": warnings,
        "sources": {
            "漲跌幅": "台股 TWSE MIS 即時行情；其他市場 Yahoo Finance",
            "成交值": "現價 × 成交量（台股 1 張＝1000 股），換算台幣",
            "市值": "台股上市＝TWSE 已發行股數 × 現價；台股 ETF＝發行單位數 × 現價；美股＝Yahoo marketCap",
        },
    }
