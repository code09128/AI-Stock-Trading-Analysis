"""
持股結構與內部人交易 (ownership.py)：美股個股的「誰持有、內部人在買還是賣」，放在看盤頁基本資料區的「持股結構」分頁，AI 補充資料也會帶一行。

資料：Yahoo quoteSummary（整理自 SEC 申報）一次請求拿 4 個模組：
- majorHoldersBreakdown：內部人／機構持股比例、機構家數
- institutionOwnership：前 10 大機構（13F，季報，約落後 45 天）
- netSharePurchaseActivity：近 6 個月內部人淨買賣
- insiderTransactions：內部人逐筆交易（Form 4）
只在打開某一檔時抓，12 小時快取，請求間隔沿用估值的 _yahoo_summary。
為什麼不直接抓 SEC：13F 是「每家基金申報自己的持股」，SEC 沒有「某檔股票被誰持有」的查詢，要掃全部基金的申報才湊得出來；
Form 4 要逐份下載 XML。Yahoo 已經整理好，而且不用使用者填 SEC 聯絡資訊。畫面附 SEC EDGAR 的原始申報連結（使用者自己點，程式不抓）。
限制：只有美股；台股的大股東與法人持股看「籌碼」。股票獎酬（Award）、贈與（Gift）、行使選擇權不是市場買賣，淨買賣只算 Sale／Purchase。
"""

import time
import urllib.parse
from typing import Any, Dict, List, Optional

from src.company import stock_info, valuation
from src.market import etf_data

TTL = 12 * 3600
INSIDER_DAYS = 180
INSIDER_MAX = 15
MODULES = "majorHoldersBreakdown,institutionOwnership,netSharePurchaseActivity,insiderTransactions"
# Yahoo transactionText 開頭 → 中文分類；只有 buy／sell 是在市場上真的買賣
_KINDS = (("Sale", "sell", "賣出"), ("Purchase", "buy", "買進"), ("Stock Award", "award", "獲配股票獎酬"),
          ("Stock Gift", "gift", "贈與"), ("Conversion of Exercise", "exercise", "行使選擇權"),
          ("Option Exercise", "exercise", "行使選擇權"))


def classify(text: str) -> Dict[str, str]:
    t = (text or "").strip()
    for prefix, kind, zh in _KINDS:
        if t.lower().startswith(prefix.lower()):
            return {"kind": kind, "label": zh}
    return {"kind": "other", "label": "其他（未說明）" if not t else "其他"}


def _pct(d: Dict[str, Any], k: str) -> Optional[float]:
    v = valuation._raw(d, k)
    return round(v * 100, 2) if v is not None else None


def _parse(r: Dict[str, Any], now: float) -> Optional[Dict[str, Any]]:
    mh = r.get("majorHoldersBreakdown") or {}
    breakdown = {"insiders_pct": _pct(mh, "insidersPercentHeld"), "institutions_pct": _pct(mh, "institutionsPercentHeld"),
                 "institutions_float_pct": _pct(mh, "institutionsFloatPercentHeld"),
                 "institutions_count": valuation._raw(mh, "institutionsCount")}
    holders = []
    for h in (r.get("institutionOwnership") or {}).get("ownershipList") or []:
        holders.append({"name": h.get("organization") or "", "pct": _pct(h, "pctHeld"),
                        "shares": valuation._raw(h, "position"), "value": valuation._raw(h, "value"),
                        "change_pct": _pct(h, "pctChange"), "date": ((h.get("reportDate") or {}).get("fmt") or "")})
    ns = r.get("netSharePurchaseActivity") or {}
    net = None
    if ns:
        net = {"period": ns.get("period") or "6m", "buy_count": valuation._raw(ns, "buyInfoCount"),
               "buy_shares": valuation._raw(ns, "buyInfoShares"), "sell_count": valuation._raw(ns, "sellInfoCount"),
               "sell_shares": valuation._raw(ns, "sellInfoShares"), "net_shares": valuation._raw(ns, "netInfoShares"),
               "insider_shares": valuation._raw(ns, "totalInsiderShares")}
    trades: List[Dict[str, Any]] = []
    for t in (r.get("insiderTransactions") or {}).get("transactions") or []:
        ts = valuation._raw(t, "startDate")
        if ts is None or now - ts > INSIDER_DAYS * 86400:
            continue
        c = classify(t.get("transactionText") or "")
        trades.append({"date": time.strftime("%Y-%m-%d", time.gmtime(ts)), "name": t.get("filerName") or "",
                       "role": t.get("filerRelation") or "", **c, "text": t.get("transactionText") or "",
                       "shares": valuation._raw(t, "shares"), "value": valuation._raw(t, "value") or None})
    trades.sort(key=lambda x: x["date"], reverse=True)
    market = [t for t in trades if t["kind"] in ("buy", "sell")]
    summary = {"buy_count": sum(1 for t in market if t["kind"] == "buy"),
               "sell_count": sum(1 for t in market if t["kind"] == "sell"),
               "buy_value": round(sum(t["value"] or 0 for t in market if t["kind"] == "buy")),
               "sell_value": round(sum(t["value"] or 0 for t in market if t["kind"] == "sell"))}
    if not holders and not trades and breakdown["institutions_pct"] is None:
        return None
    # 名額先給市場買賣，剩下的才給獎酬／贈與（獎酬一次常有幾十筆，會把買賣擠掉）；最後依日期新到舊
    others = [t for t in trades if t["kind"] not in ("buy", "sell")]
    shown = sorted((market + others)[:INSIDER_MAX], key=lambda x: x["date"], reverse=True)
    return {"breakdown": breakdown, "holders": holders[:10], "net": net, "insider": shown, "insider_summary": summary}


def edgar_url(ticker: str) -> str:
    q = urllib.parse.urlencode({"action": "getcompany", "CIK": ticker.upper(), "type": "4", "dateb": "", "owner": "include", "count": "40"})
    return f"https://www.sec.gov/cgi-bin/browse-edgar?{q}"


def analyze(symbol: str) -> Dict[str, Any]:
    cat = stock_info.classify(symbol)
    if cat["market"] != "US":
        return {"supported": False, "reason": "持股結構與內部人交易目前只有美股（台股的大股東與三大法人請看「籌碼」）"}
    if cat["category"] != "STOCK":
        return {"supported": False, "reason": "ETF／債券沒有內部人與機構持股申報"}

    def load():
        try:
            r = valuation._yahoo_summary(cat["symbol"], MODULES)
        except Exception:
            return None  # 連線失敗：快取只記幾分鐘就重試
        return _parse(r, time.time()) or {"empty": True}

    d = etf_data._cached(f"ownership:{cat['symbol']}", load, ttl=TTL)
    if not d:
        return {"supported": False, "reason": "持股資料暫時取不到（Yahoo 沒有回應），稍後再試"}
    if d.get("empty"):
        return {"supported": False, "reason": "這檔沒有機構持股與內部人資料"}
    return {"supported": True, "symbol": cat["symbol"], **d, "edgar_url": edgar_url(cat["code"]),
            "source": "Yahoo Finance（整理自 SEC 13F 機構持股季報與 Form 4 內部人申報，12 小時更新一次）",
            "note": f"機構持股是季報（約落後 45 天）；內部人交易列近 {INSIDER_DAYS} 天，股票獎酬、贈與、行使選擇權不是市場買賣，"
                    "淨買賣只算買進與賣出。內部人賣股常是預先排定的計畫或繳稅，不一定代表看壞。"}


def brief(symbol: str) -> str:
    """給 AI 補充資料的一行摘要；不是美股或取不到就回空字串。"""
    try:
        a = analyze(symbol)
    except Exception:
        return ""
    if not a.get("supported"):
        return ""
    parts = []
    b = a["breakdown"]
    if b.get("institutions_pct") is not None:
        parts.append(f"機構持股 {b['institutions_pct']}%（{int(b['institutions_count'] or 0)} 家）、內部人持股 {b.get('insiders_pct')}%")
    if a["holders"]:
        h = a["holders"][0]
        parts.append(f"最大機構 {h['name']} {h['pct']}%（{h['date']} 季報，季增減 {h['change_pct']}%）")
    s = a["insider_summary"]
    if s["buy_count"] or s["sell_count"]:
        parts.append(f"近 {INSIDER_DAYS} 天內部人市場買進 {s['buy_count']} 筆（約 {s['buy_value'] / 1e6:.1f} 百萬美元）、"
                     f"賣出 {s['sell_count']} 筆（約 {s['sell_value'] / 1e6:.1f} 百萬美元）")
    return ("持股結構（SEC 申報整理，內部人賣股常是預排計畫或繳稅，不一定看壞）：" + "；".join(parts)) if parts else ""
