"""
真實新聞／公告來源 (news_feed.py) — 供模組 2 使用，取代範例新聞
來源（全部公開介面，請求記錄在抓取紀錄）：
- Google News RSS：台股用中文關鍵字（名稱+代號），美股用 ticker
- Yahoo Finance 搜尋新聞（美股）
- TWSE OpenAPI 上市公司「每日重大訊息」（僅當日、僅上市公司；上櫃無公開 JSON）
- SEC EDGAR 8-K（美股，近 45 天，附 Item 代碼說明）。SEC 要求識別用 User-Agent，可用環境變數 SEC_USER_AGENT 覆寫
每個來源獨立失敗、獨立回報錯誤，不會用假新聞補位。
"""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from typing import Any, Dict, List
from zoneinfo import ZoneInfo
import json
import os
import threading
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

from src import quote_provider as qp
from src.data_adapter import DualMarketDataAdapter

TW_TZ = ZoneInfo("Asia/Taipei")
US_TZ = ZoneInfo("America/New_York")
SEC_UA = os.environ.get("SEC_USER_AGENT", "local-trading-research-tool/1.0")
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
    local = dt_utc.astimezone(TW_TZ if market == "TW" else US_TZ)
    return {
        "title": " ".join(title.split()),
        "source": source,
        "link": link,
        "kind": kind,
        "detail": detail,
        "published_utc": dt_utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "local_iso": local.strftime("%Y-%m-%dT%H:%M:%S"),  # 市場當地時間（供盤前/盤中/盤後判斷）
    }


def _google_news(query: str, market: str) -> List[Dict[str, Any]]:
    if market == "TW":
        params = {"q": f"{query} when:14d", "hl": "zh-TW", "gl": "TW", "ceid": "TW:zh-Hant"}
    else:
        params = {"q": f"{query} stock when:14d", "hl": "en-US", "gl": "US", "ceid": "US:en"}
    raw = _get_text("https://news.google.com/rss/search?" + urllib.parse.urlencode(params),
                    {"User-Agent": "Mozilla/5.0"})
    out = []
    for it in ET.fromstring(raw).findall("./channel/item")[:25]:
        try:
            dt = parsedate_to_datetime(it.findtext("pubDate")).astimezone(timezone.utc)
        except Exception:
            continue
        out.append(_item(it.findtext("title") or "", it.findtext("source") or "Google News",
                         it.findtext("link") or "", dt, "新聞", market))
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
    hdr = {"User-Agent": SEC_UA}
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
        jobs = [("Google News", lambda: _google_news(f"{name} {code}".strip(), "TW")),
                ("證交所重大訊息", lambda: _twse_material(code))]
    else:
        jobs = [("Google News", lambda: _google_news(code, "US")),
                ("Yahoo Finance 新聞", lambda: _yahoo_news(code, "US")),
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

    with ThreadPoolExecutor(max_workers=4) as ex:
        for label, got, err in ex.map(run, jobs):
            sources.append(f"{label}：{len(got)} 則")
            if err:
                errors.append(f"{label} 抓取失敗：{err}")
            items.extend(got)
    seen, uniq = set(), []
    for it in sorted(items, key=lambda x: x["published_utc"], reverse=True):
        k = it["title"][:40]
        if k in seen:
            continue
        seen.add(k)
        uniq.append(it)
    result = {"symbol": n["symbol"], "market": market, "items": uniq[:30], "sources": sources,
              "errors": errors}
    with _LOCK:
        _CACHE[key] = {"t": time.time(), "v": result}
    return result
