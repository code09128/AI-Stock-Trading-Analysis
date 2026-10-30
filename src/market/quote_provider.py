"""
即時報價資料來源層 (quote_provider.py)
資料來源與爬取方式（全部是公開 HTTP JSON 端點，不需登入）：
- 台股 (含 ETF)：TWSE MIS 即時行情 https://mis.twse.com.tw/stock/api/getStockInfo.jsp
  - 上市 tse_、上櫃 otc_ 兩種前綴都會查詢；提供成交價、昨收、開高低、累計量、漲跌停、委買委賣五檔
  - 資料約延遲 5 秒（官方 userDelay）
- 美股：Yahoo Finance v8 Chart API（meta 欄位）。2026-10-21 美股盤中實測報價時間只落後 0–5 秒；無五檔
任何失敗都會回傳 is_live=False 與 error 訊息，不會偷偷用假資料補上 (Fail loud)。
每一次對外請求都會寫入 FETCH_LOG（網址、狀態、耗時、位元組），供前端「資料來源透明面板」顯示。
"""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from typing import Any, Dict, List
import threading
import time
import urllib.error
import urllib.parse

from src.market.data_adapter import DualMarketDataAdapter
from src.market.net import FETCH_LOG, LOG_LOCK, http_json
from src.market.util import to_num

MIS_URL = "https://mis.twse.com.tw/stock/api/getStockInfo.jsp"
YAHOO_URL = "https://query1.finance.yahoo.com/v8/finance/chart/"

_LOCK = threading.Lock()
_CACHE: Dict[str, Any] = {}
CACHE_TTL_SEC = 3.0
US_CACHE_TTL_SEC = 3.0
_http_json = http_json  # 其他模組習慣用 qp._http_json（帶 UA、受連線上限控管、寫入 FETCH_LOG；實作在 net.py）
_num = to_num


def _split_levels(prices: str, vols: str) -> List[Dict[str, float]]:
    ps = [p for p in (prices or "").split("_") if p]
    vs = [v for v in (vols or "").split("_") if v]
    out = []
    for i, p in enumerate(ps):
        pv = _num(p)
        if pv:
            out.append({"price": pv, "vol": (_num(vs[i]) or 0) if i < len(vs) else 0})
    return out


def _base(norm: Dict[str, str], names: Dict[str, str]) -> Dict[str, Any]:
    return {
        "symbol": norm["symbol"],
        "name": names.get(norm["symbol"]) or names.get(norm["raw_code"]) or norm["raw_code"],
        "market": norm["market"],
        "currency": norm["currency"],
        "is_live": False,
        "quote_date_local": "",
        "error": None,
    }


MIS_CHUNK = 5  # 每批 5 檔（上市＋上櫃各一筆＝10 筆）：MIS 一次查太多會很慢（實測 16 檔要 30 秒、10 筆不到 1 秒）
MIS_WORKERS = 2  # 同時太多請求 MIS 反而變慢


def _mis_batch(chunk: List[Dict[str, str]]) -> Dict[str, Any]:
    ex_ch = "|".join(f"{ex}_{n['raw_code'].upper()}.tw" for n in chunk for ex in ("tse", "otc"))
    url = f"{MIS_URL}?{urllib.parse.urlencode({'ex_ch': ex_ch, 'json': 1, 'delay': 0})}"
    try:
        try:
            payload = _http_json(url, timeout=6)
        except Exception:  # 證交所偶爾回應很慢，重試一次
            payload = _http_json(url, timeout=8)
        return {"rows": {r.get("c", "").upper(): r for r in payload.get("msgArray", [])}, "error": None}
    except Exception as e:
        return {"rows": {}, "error": str(e)}


def fetch_tw_quotes(
    norms: List[Dict[str, str]], names: Dict[str, str]
) -> Dict[str, Dict[str, Any]]:
    chunks = [norms[i:i + MIS_CHUNK] for i in range(0, len(norms), MIS_CHUNK)]
    with ThreadPoolExecutor(max_workers=MIS_WORKERS) as pool:
        batches = list(pool.map(_mis_batch, chunks))
    rows: Dict[str, Any] = {}
    failed: Dict[str, str] = {}  # 代號 -> 那一批的連線錯誤（只有那一批的股票標失敗，其他批照常顯示）
    for chunk, b in zip(chunks, batches):
        rows.update(b["rows"])
        if b["error"]:
            for n in chunk:
                failed[n["raw_code"].upper()] = b["error"]
    url = MIS_URL

    result: Dict[str, Dict[str, Any]] = {}
    for n in norms:
        q = _base(n, names)
        if n["raw_code"].upper() in failed:
            q["error"] = f"TWSE MIS 連線失敗: {failed[n['raw_code'].upper()]}"
            result[n["symbol"]] = q
            continue
        r = rows.get(n["raw_code"].upper())
        if not r:
            q["error"] = "TWSE MIS 查無此代號（上市/上櫃皆無資料）"
            result[n["symbol"]] = q
            continue
        if q["name"] == n["raw_code"] and r.get("n"):
            q["name"] = r["n"]  # 名單裡沒有的代號，用證交所回傳的簡稱
        prev = _num(r.get("y"))
        price = _num(r.get("z")) or _num(r.get("pz"))
        asks = _split_levels(r.get("a"), r.get("f"))
        bids = _split_levels(r.get("b"), r.get("g"))
        if price is None and bids and asks:
            price = (bids[0]["price"] + asks[0]["price"]) / 2  # 尚未成交時取中間價
        change = round(price - prev, 4) if price and prev else None
        bid_vol, ask_vol = sum(b["vol"] for b in bids), sum(a["vol"] for a in asks)
        q.update(
            is_live=price is not None,
            price=price,
            prev_close=prev,
            change=change,
            change_pct=round(change / prev * 100, 2) if change is not None and prev else None,
            open=_num(r.get("o")),
            high=_num(r.get("h")),
            low=_num(r.get("l")),
            volume=_num(r.get("v")),
            volume_unit="張",
            last_lot=_num(r.get("tv")),
            limit_up=_num(r.get("u")),
            limit_down=_num(r.get("w")),
            bids=bids,
            asks=asks,
            bid_ask_ratio=round(bid_vol / (bid_vol + ask_vol) * 100, 1)
            if bid_vol + ask_vol
            else None,
            quote_time=f"{r.get('d', '')} {r.get('t', '')}".strip(),
            quote_date_local=str(r.get("d", "")).replace("-", "").replace("/", "").strip(),
            source="TWSE MIS 即時行情（約延遲 5 秒）",
            endpoint=url,
        )
        result[n["symbol"]] = q
    return result


def fetch_us_quote(norm: Dict[str, str], names: Dict[str, str]) -> Dict[str, Any]:
    """台股以外（美、港、日、韓、英…）都走 Yahoo；幣別以 Yahoo 回傳為準（英股是 GBp 便士）。"""
    q = _base(norm, names)
    url = f"{YAHOO_URL}{urllib.parse.quote(norm['symbol'])}?interval=1d&range=1d"
    try:
        payload = _http_json(url)
        res = payload["chart"]["result"][0]
        m = res["meta"]
        price = _num(m.get("regularMarketPrice"))
        prev = _num(m.get("chartPreviousClose")) or _num(m.get("previousClose"))
        change = round(price - prev, 4) if price and prev else None
        quote = (res.get("indicators", {}).get("quote") or [{}])[0]
        opens = [x for x in quote.get("open", []) if x is not None]
        if q["name"] == norm["raw_code"]:
            q["name"] = " ".join(str(m.get("shortName") or m.get("longName") or q["name"]).split())
        q.update(
            is_live=price is not None,
            price=price,
            prev_close=prev,
            change=change,
            change_pct=round(change / prev * 100, 2) if change is not None and prev else None,
            open=opens[0] if opens else None,
            high=_num(m.get("regularMarketDayHigh")),
            low=_num(m.get("regularMarketDayLow")),
            volume=_num(m.get("regularMarketVolume")),
            volume_unit="股",
            instrument_type=m.get("instrumentType"),
            currency=m.get("currency") or q["currency"],
            exchange=m.get("fullExchangeName") or m.get("exchangeName"),
            # 交易所當地日期（判斷即時價能不能覆蓋當日 K 棒用；quote_time 是本機時間）
            quote_date_local=datetime.utcfromtimestamp(m["regularMarketTime"] + (m.get("gmtoffset") or 0)).strftime("%Y%m%d")
            if m.get("regularMarketTime")
            else "",
            bids=[],
            asks=[],
            bid_ask_ratio=None,
            quote_time=datetime.fromtimestamp(m["regularMarketTime"]).strftime("%Y-%m-%d %H:%M:%S")
            if m.get("regularMarketTime")
            else "",
            source="Yahoo Finance v8 Chart API（美股盤中實測延遲約 0–5 秒；其他市場依交易所規定可能延遲 15–20 分鐘；無五檔）",
            endpoint=url,
        )
    except urllib.error.HTTPError as e:
        q["error"] = "Yahoo Finance 查無此代號" if e.code == 404 else f"Yahoo Finance 回應錯誤（HTTP {e.code}）"
    except Exception as e:
        q["error"] = f"Yahoo Finance 連線失敗: {e}"
    return q


def get_quotes(symbols: List[str], names: Dict[str, str]) -> List[Dict[str, Any]]:
    """批次取得報價。逐檔快取 3 秒（台股與美股相同），避免同一秒內重複請求被來源端限流。"""
    norms = [DualMarketDataAdapter.normalize_symbol(s) for s in symbols if s and s.strip()]
    now = time.time()
    fresh: Dict[str, Dict[str, Any]] = {}
    need_tw: List[Dict[str, str]] = []
    need_us: List[Dict[str, str]] = []
    with _LOCK:
        for n in norms:
            hit = _CACHE.get(n["symbol"])
            ttl = CACHE_TTL_SEC if n["market"] == "TW" else US_CACHE_TTL_SEC
            if hit and now - hit["t"] < ttl:
                fresh[n["symbol"]] = hit["data"]
            else:
                (need_tw if n["market"] == "TW" else need_us).append(n)

    started = time.time()
    got: Dict[str, Dict[str, Any]] = {}
    if need_tw:
        got.update(fetch_tw_quotes(need_tw, names))
    if need_us:  # 美股每檔一個請求，平行抓取縮短等待
        with ThreadPoolExecutor(max_workers=6) as pool:
            for n, quote in zip(need_us, pool.map(lambda x: fetch_us_quote(x, names), need_us)):
                got[n["symbol"]] = quote

    fetched_at = datetime.now().strftime("%H:%M:%S")
    latency = int((time.time() - started) * 1000)
    with _LOCK:
        for sym, quote in got.items():
            quote["fetched_at"] = fetched_at
            quote["latency_ms"] = latency
            old = _CACHE.get(sym)
            if quote.get("error") and old and old["data"].get("is_live"):
                continue  # 失敗時不覆蓋；下方會標示沿用舊資料
            _CACHE[sym] = {"t": time.time(), "data": quote}
    out = []
    for n in norms:
        q = got.get(n["symbol"]) or fresh.get(n["symbol"])
        if q and q.get("error"):
            old = _CACHE.get(n["symbol"])
            if old and old["data"].get("is_live"):
                q = dict(old["data"])
                q["stale_warning"] = f"最新一次抓取失敗，沿用 {q.get('fetched_at')} 的資料"
        out.append(dict(q) if q else q)  # 回傳複本：呼叫端修改欄位時不會改到快取
    return out


def get_fetch_log() -> List[Dict[str, Any]]:
    with LOG_LOCK:
        return list(FETCH_LOG)
