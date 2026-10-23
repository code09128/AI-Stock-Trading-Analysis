"""
真實新聞／公告來源 (news_feed.py) — 供模組 2 使用，取代範例新聞
來源（全部公開介面，請求記錄在抓取紀錄）：
- Google News RSS：台股用中文關鍵字（名稱+代號），美股用 ticker
- 鉅亨網新聞搜尋（api.cnyes.com，非公開文件介面）：台股用中文名稱、美股用 ticker，附內文摘要
- Yahoo 奇摩股市 RSS（台股，上市 .TW／上櫃 .TWO，附摘要；含上櫃公司公告）
- Yahoo Finance 搜尋新聞（美股）
- Google News 限定站台：MoneyDJ（台股新聞）、玩股網／財報狗（台股分析專欄）、TradingView／ETFdb（美股分析專欄）
- TWSE OpenAPI 上市公司「每日重大訊息」（僅當日、僅上市公司；上櫃無公開 JSON）
- SEC EDGAR 8-K（美股，近 45 天，附 Item 代碼說明）。SEC 要求識別用 User-Agent，可用環境變數 SEC_USER_AGENT 覆寫
每個來源獨立失敗、獨立回報錯誤，不會用假新聞補位。
"""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from typing import Any, Dict, List
from src.market import markets
from src.market.tz import zone
import html
import json
import os
import re
import threading
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

from src.market import quote_provider as qp
from src.market.data_adapter import DualMarketDataAdapter

TW_TZ = zone("Asia/Taipei")
US_TZ = zone("America/New_York")
SEC_UA_DEFAULT = "local-trading-research-tool/1.0"
TTL = 300
_LOCK = threading.Lock()
_CACHE: Dict[str, Any] = {}

SEC_ITEMS = {
    "1.01": "簽訂重大合約",
    "1.05": "資安事件",
    "2.02": "財報／業績公布",
    "2.03": "新增債務",
    "3.02": "未註冊股權出售",
    "5.02": "董事／高管異動",
    "5.07": "股東會表決結果",
    "7.01": "Reg FD 揭露",
    "8.01": "其他重大事件",
    "9.01": "財務報表與附件",
}


def _get_text(url: str, headers: Dict[str, str], timeout: int = 25) -> bytes:
    """與 quote_provider._http_json 相同的記錄方式，但回傳原始 bytes（RSS 用）。"""
    started = time.time()
    rec = {"time": datetime.now().strftime("%H:%M:%S"), "url": url, "status": "ERR", "ms": 0,
           "bytes": 0, "error": None}
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=timeout) as r:
            raw = r.read()
            rec.update(status=r.status, bytes=len(raw))
            return raw
    except Exception as e:
        rec["error"] = str(e)
        raise
    finally:
        rec["ms"] = int((time.time() - started) * 1000)
        with qp._LOCK:
            qp.FETCH_LOG.appendleft(rec)


def _item(title: str, source: str, link: str, dt_utc: datetime, kind: str, market: str,
          detail: str = "") -> Dict[str, Any]:
    local = dt_utc.astimezone(TW_TZ if market == "TW" else zone(markets.info(market)["tz"]))
    return {
        "title": " ".join(title.split()),
        "source": source,
        "link": link,
        "kind": kind,
        "detail": detail,
        "published_utc": dt_utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "local_iso": local.strftime("%Y-%m-%dT%H:%M:%S"),  # 市場當地時間（供盤前/盤中/盤後判斷）
    }


def _clean(text: str, limit: int = 200) -> str:
    """去掉 HTML 標籤與實體、合併空白，截到 limit 字。"""
    t = re.sub(r"</?mark>", "", text or "")  # 鉅亨網搜尋把關鍵字包在 <mark> 裡
    t = " ".join(html.unescape(re.sub(r"<[^>]+>", " ", t)).split())
    return t if len(t) <= limit else t[:limit].rstrip() + "…"


def _google_news(query: str, market: str, limit: int = 25, kind: str = "新聞",
                 site_query: bool = False) -> List[Dict[str, Any]]:
    if market == "TW":
        params = {"q": f"{query} when:14d", "hl": "zh-TW", "gl": "TW", "ceid": "TW:zh-Hant"}
    else:
        q = query if site_query else f"{query} stock"
        params = {"q": f"{q} when:14d", "hl": "en-US", "gl": "US", "ceid": "US:en"}
    raw = _get_text("https://news.google.com/rss/search?" + urllib.parse.urlencode(params),
                    {"User-Agent": "Mozilla/5.0"})
    cutoff = datetime.now(timezone.utc) - timedelta(days=30)  # 限定站台時 when: 常被忽略，自己再擋一次
    out = []
    for it in ET.fromstring(raw).findall("./channel/item"):
        try:
            dt = parsedate_to_datetime(it.findtext("pubDate")).astimezone(timezone.utc)
        except Exception:
            continue
        if dt < cutoff:
            continue
        source = it.findtext("source") or "Google News"
        title = it.findtext("title") or ""
        # 「標題 - CMoney」「標題- 新聞 - MoneyDJ理財網」→「標題」
        title = re.sub(r"(\s*-\s*(新聞|財經新聞|ETF Database|" + re.escape(source) + r"))+\s*$", "", title)
        out.append(_item(title, source, it.findtext("link") or "", dt, kind, market))
        if len(out) >= limit:
            break
    return out


def _google_site(sites: List[str], query: str, market: str, kind: str,
                 must_mention: List[str] = ()) -> List[Dict[str, Any]]:
    """Google News 限定站台搜尋（MoneyDJ、玩股網、財報狗、TradingView、ETFdb 都沒有公開新聞介面）。
    must_mention：標題至少要提到其中一個字（專欄站會回傳「主力券商雷達」這種跟個股無關的頁面）。"""
    clause = " OR ".join(f"site:{s}" for s in sites)
    q = f"({clause}) {query}" if len(sites) > 1 else f"{clause} {query}"
    got = _google_news(q, market, limit=25, kind=kind, site_query=True)
    keys = [k.lower() for k in must_mention if k and len(k) >= 2]
    if keys:
        got = [it for it in got if any(k in it["title"].lower() for k in keys)]
    return got[:10]


CNYES_SKIP_CATEGORIES = {"鏈文", "快訊", "幣圈"}  # 加密貨幣媒體轉載，對個股沒參考價值


def _cnyes_news(query: str, code: str, market: str) -> List[Dict[str, Any]]:
    """鉅亨網新聞搜尋。用代號搜會撈到不相干的數字（例如「2330 萬桶」），所以台股用中文名稱；
    美股只能用 ticker，再只留「標題含關鍵字」或「內文標 NVDA-US 這種代號」的。"""
    url = "https://api.cnyes.com/media/api/v1/search/news?" + urllib.parse.urlencode({"q": query, "limit": 20})
    data = json.loads(_get_text(url, {"User-Agent": "Mozilla/5.0", "Accept": "application/json"}))
    rows = ((data.get("items") or {}).get("data")) or []
    tag = f"{code}-{'TW' if market == 'TW' else 'US'}"
    cutoff = datetime.now(timezone.utc) - timedelta(days=30)
    out = []
    for x in rows:
        ts, nid = x.get("publishAt"), x.get("newsId")
        if not ts or not nid:
            continue
        dt = datetime.fromtimestamp(ts, tz=timezone.utc)
        cats = {c.get("name") for c in (x.get("category") or [])}
        content = _clean(x.get("content", ""))
        if dt < cutoff or cats & CNYES_SKIP_CATEGORIES:
            continue
        if not (x.get("titleWithKwd") or tag in content or (market == "TW" and query in content)):
            continue
        out.append(_item(_clean(x.get("title", ""), 300), "鉅亨網", f"https://news.cnyes.com/news/id/{nid}",
                         dt, "新聞", market, content))
    return out


def _yahoo_tw_rss(symbol: str) -> List[Dict[str, Any]]:
    """Yahoo 奇摩股市個股新聞 RSS（2330.TW／6488.TWO），附摘要；【公告】開頭是公司公告（含上櫃）。"""
    raw = _get_text("https://tw.stock.yahoo.com/rss?s=" + urllib.parse.quote(symbol), {"User-Agent": "Mozilla/5.0"})
    out = []
    for it in ET.fromstring(raw).findall("./channel/item")[:20]:
        try:
            dt = parsedate_to_datetime(it.findtext("pubDate")).astimezone(timezone.utc)
        except Exception:
            continue
        title = _clean(it.findtext("title") or "", 300)
        kind = "公司公告" if title.startswith("【公告】") else "新聞"
        out.append(_item(title, "Yahoo奇摩股市", it.findtext("link") or "", dt, kind, "TW",
                         _clean(it.findtext("description") or "")))
    return out


def _yahoo_news(symbol: str, market: str) -> List[Dict[str, Any]]:
    url = "https://query1.finance.yahoo.com/v1/finance/search?" + urllib.parse.urlencode(
        {"q": symbol, "newsCount": 12, "quotesCount": 0})
    data = qp._http_json(url)
    out = []
    for n in data.get("news", []):
        ts = n.get("providerPublishTime")
        if not ts:
            continue
        out.append(_item(n.get("title", ""), n.get("publisher", "Yahoo Finance"), n.get("link", ""),
                         datetime.fromtimestamp(ts, tz=timezone.utc), "新聞", market))
    return out


def _twse_material(code: str) -> List[Dict[str, Any]]:
    url = "https://openapi.twse.com.tw/v1/opendata/t187ap04_L"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"})
    started = time.time()
    with urllib.request.urlopen(req, timeout=15) as r:
        rows = json.loads(r.read().decode("utf-8"))
    with qp._LOCK:
        qp.FETCH_LOG.appendleft({"time": datetime.now().strftime("%H:%M:%S"), "url": url, "status": 200,
                                 "ms": int((time.time() - started) * 1000), "bytes": 0, "error": None})
    out = []
    for r in rows:
        if str(r.get("公司代號", "")).strip() != code:
            continue
        d, t = str(r.get("發言日期", "")), str(r.get("發言時間", "")).zfill(6)
        try:
            local = datetime(int(d[:-4]) + 1911, int(d[-4:-2]), int(d[-2:]), int(t[:2]), int(t[2:4]),
                             int(t[4:6]), tzinfo=TW_TZ)
        except ValueError:
            continue
        out.append(_item(str(r.get("主旨 ", r.get("主旨", ""))), "證交所重大訊息", "",
                         local.astimezone(timezone.utc), "重大訊息", "TW",
                         f"符合條款：{r.get('符合條款', '')}"))
    return out


_SEC_TICKERS: Dict[str, Any] = {}


def _sec_8k(ticker: str) -> List[Dict[str, Any]]:
    hdr = {"User-Agent": os.environ.get("SEC_USER_AGENT") or SEC_UA_DEFAULT}
    if not _SEC_TICKERS:
        data = json.loads(_get_text("https://www.sec.gov/files/company_tickers.json", hdr))
        _SEC_TICKERS.update({v["ticker"].upper(): v["cik_str"] for v in data.values()})
    cik = _SEC_TICKERS.get(ticker.upper())
    if not cik:
        return []
    sub = json.loads(_get_text(f"https://data.sec.gov/submissions/CIK{int(cik):010d}.json", hdr))
    rec = sub["filings"]["recent"]
    cutoff = datetime.now(timezone.utc) - timedelta(days=45)
    out = []
    for i, form in enumerate(rec["form"]):
        if form != "8-K":
            continue
        acc = rec.get("acceptanceDateTime", [""] * (i + 1))[i]
        try:
            dt = datetime.strptime(acc[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc)
        except ValueError:
            dt = datetime.strptime(rec["filingDate"][i], "%Y-%m-%d").replace(tzinfo=timezone.utc)
        if dt < cutoff:
            continue
        items = [x.strip() for x in str(rec.get("items", [""] * (i + 1))[i]).split(",") if x.strip()]
        desc = "、".join(SEC_ITEMS.get(x, x) for x in items) or "8-K"
        link = (f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/"
                f"{rec['accessionNumber'][i].replace('-', '')}/{rec['primaryDocument'][i]}")
        out.append(_item(f"SEC 8-K：{desc}（Item {', '.join(items)}）", "SEC EDGAR", link, dt, "8-K", "US"))
    return out


def _dedupe_key(title: str) -> str:
    return re.sub(r"[^0-9a-z一-鿿]", "", title.lower())[:30]


def dedupe(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """新到舊排序，同一則（不同網站轉載）只留一則；留下的那則沒摘要時，借用轉載版的摘要。"""
    seen: Dict[str, Dict[str, Any]] = {}
    uniq: List[Dict[str, Any]] = []
    for it in sorted(items, key=lambda x: x["published_utc"], reverse=True):
        k = _dedupe_key(it["title"])
        if k in seen:
            if not seen[k]["detail"] and it["detail"]:
                seen[k]["detail"] = it["detail"]
            continue
        seen[k] = it
        uniq.append(it)
    return uniq


def fetch_news(symbol: str, name: str = "") -> Dict[str, Any]:
    key = f"news:{symbol}"
    with _LOCK:
        hit = _CACHE.get(key)
        if hit and time.time() - hit["t"] < TTL:
            return hit["v"]
    n = DualMarketDataAdapter.normalize_symbol(symbol)
    market, code = n["market"], n["raw_code"]
    jobs = []
    if market == "TW":
        kw = name or code
        jobs = [("Google News", lambda: _google_news(f"{name} {code}".strip(), "TW")),
                ("鉅亨網", lambda: _cnyes_news(kw, code, "TW")),
                ("Yahoo奇摩股市", lambda: _yahoo_tw_rss(n["symbol"])),
                ("MoneyDJ", lambda: _google_site(["moneydj.com"], kw, "TW", "新聞")),
                ("分析專欄（玩股網、財報狗）",
                 lambda: _google_site(["wantgoo.com", "statementdog.com"], kw, "TW", "分析專欄", [name, code])),
                ("證交所重大訊息", lambda: _twse_material(code))]
    else:
        jobs = [("Google News", lambda: _google_news(code, "US")),
                ("Yahoo Finance 新聞", lambda: _yahoo_news(code, "US")),
                ("鉅亨網", lambda: _cnyes_news(code, code, "US")),
                ("分析專欄（TradingView、ETFdb）",
                 lambda: _google_site(["tradingview.com", "etfdb.com"], code, "US", "分析專欄",
                                      [code, (name.split() or [""])[0]])),
                ("SEC 8-K", lambda: _sec_8k(code))]
    items: List[Dict[str, Any]] = []
    errors: List[str] = []
    sources: List[str] = []

    def run(job):
        label, fn = job
        try:
            return label, fn(), None
        except Exception as e:
            return label, [], str(e)

    with ThreadPoolExecutor(max_workers=6) as ex:
        for label, got, err in ex.map(run, jobs):
            sources.append(f"{label}：{len(got)} 則")
            if err:
                errors.append(f"{label} 抓取失敗：{err}")
            items.extend(got)
    uniq = dedupe(items)
    result = {"symbol": n["symbol"], "market": market, "items": uniq[:60], "sources": sources,
              "errors": errors}
    with _LOCK:
        _CACHE[key] = {"t": time.time(), "v": result}
    return result
