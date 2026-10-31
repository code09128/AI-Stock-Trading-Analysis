"""
大盤籌碼頁資料 (market_board.py)：開盤前先看國際指數、台指期、資金流向、產業強弱、台灣 50。
資料來源（全部公開、不需金鑰，請求都記在抓取紀錄）：
- 國際指數、美股期貨、美元指數：Yahoo Finance（quote_provider.get_quotes）
- 加權、櫃買指數：TWSE MIS 即時行情（t00／o00）
- 台指期（日盤＋夜盤）：期交所 MIS 行情 API（mis.taifex.com.tw）
- 產業漲跌、類股成交金額、三大法人買賣超：證交所每日盤後資料（MI_INDEX、BFIAMU、BFI82U），收盤後約 14:30～15:00 才有當天資料，
  在那之前顯示最近一個交易日
- 台灣 50：證交所全部個股日成交（STOCK_DAY_ALL）× 上市公司已發行股數，取「上市市值前 50 大」近似台灣 50 成分股
  （正式成分股另有流通量等篩選），盤中價格用 TWSE MIS
取不到的欄位一律回 None 並附原因，不補假值。
"""

from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from typing import Any, Callable, Dict, List, Optional
import threading
import time
import urllib.parse

from src.company import stock_info
from src.market import quote_provider as qp
from src.market.cache import TTLCache
from src.market.util import to_num as _num

WORLD_GROUPS = [
    ("美股", [("^GSPC", "S&P 500"), ("^IXIC", "那斯達克"), ("^DJI", "道瓊"), ("^SOX", "費城半導體"),
             ("^VIX", "VIX 恐慌指數")]),
    ("美股期貨", [("ES=F", "S&P 500 期貨"), ("NQ=F", "那斯達克 100 期貨"), ("YM=F", "道瓊期貨")]),
    ("亞洲", [("^N225", "日經 225"), ("^HSI", "恆生指數"), ("000001.SS", "上證指數"), ("^KS11", "韓國綜合")]),
    ("匯率", [("DX-Y.NYB", "美元指數"), ("TWD=X", "美元／台幣")]),
]
TW_INDEX = [("t00", "tse", "加權指數"), ("o00", "otc", "櫃買指數")]

TAIFEX_URL = "https://mis.taifex.com.tw/futures/api/getQuoteList"
TWSE_RWD = "https://www.twse.com.tw/rwd/zh"
STOCK_DAY_ALL = "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL"

# 產業排行只列細分類；這幾個是多個類股加總的「大類」指數，會重複計算
AGGREGATE_SECTORS = {"水泥窯製類指數", "塑膠化工類指數", "機電類指數", "化學生技醫療類指數", "電子工業類指數", "電子類指數"}
SECTOR_ALIAS = {"電子類指數": "電子工業類指數", "航運業類指數": "航運類指數"}  # BFIAMU 與 MI_INDEX 名稱不同

LIVE_TTL = 15
DAILY_TTL = 600
RANK_TTL = 6 * 3600
TWSE_GAP_SEC = 0.8  # 證交所網站有頻率限制（約每 5 秒 3 次），連續請求之間至少間隔這麼久
MIS_CHUNK = 10  # MIS 一次查太多檔會變得很慢（實測 20 檔要十幾秒、10 檔不到 1 秒）

_LOCK = threading.Lock()
_CACHE = TTLCache()
_TWSE_LOCK = threading.Lock()
_TWSE_LAST = [0.0]


def _cached(key: str, ttl: Optional[float], loader: Callable[[], Any]) -> Any:
    return _CACHE.get_or_load(key, loader, ttl, on_error="raise")  # 失敗不快取，下次重新抓


def _safe(fn: Callable[[], Dict[str, Any]], what: str) -> Dict[str, Any]:
    """連線失敗時回傳錯誤說明（不快取，下次重新抓）。"""
    try:
        return fn()
    except Exception as e:
        return {"rows": [], "days": [], "error": f"{what}取得失敗：{e}"}


def _pct(change: Optional[float], ref: Optional[float]) -> Optional[float]:
    return round(change / ref * 100, 2) if change is not None and ref else None


# ---------- 國際指數＋台股指數＋台指期 ----------
def _mis_rows(ex_ch: List[str], timeout: int = 8) -> Dict[str, Dict[str, Any]]:
    url = f"{qp.MIS_URL}?{urllib.parse.urlencode({'ex_ch': '|'.join(ex_ch), 'json': 1, 'delay': 0})}"
    payload = qp._http_json(url, timeout=timeout)
    return {str(r.get("ch", "")).lower(): r for r in payload.get("msgArray", [])}


def _tw_indices() -> List[Dict[str, Any]]:
    try:
        rows = _mis_rows([f"{ex}_{code}.tw" for code, ex, _ in TW_INDEX])
        err = None
    except Exception as e:
        rows, err = {}, f"TWSE MIS 連線失敗：{e}"
    out = []
    for code, _, name in TW_INDEX:
        r = rows.get(f"{code}.tw") or {}
        price, prev = _num(r.get("z")), _num(r.get("y"))
        change = round(price - prev, 2) if price is not None and prev else None
        out.append({"symbol": code, "name": name, "price": price, "change": change, "change_pct": _pct(change, prev),
                    "quote_time": f"{r.get('d', '')} {r.get('t', '')}".strip(),
                    "error": None if price is not None else (err or "TWSE MIS 沒有回傳這個指數")})
    return out


def _taifex_session(market_type: str) -> Dict[str, Any]:
    body = {"MarketType": market_type, "SymbolType": "F", "KindID": "1", "CID": "TXF", "ExpireMonth": "",
            "RowSize": "全部", "PageNo": "", "SortColumn": "", "AscDesc": "A"}
    rows = qp._http_json(TAIFEX_URL, timeout=10, body=body).get("RtData", {}).get("QuoteList", [])
    # SymbolID：TXF-S／TXF-P 是現貨，其餘依到期月排序，第一筆是近月合約
    contracts = [r for r in rows if not str(r.get("SymbolID", "")).startswith("TXF-")]
    if not contracts:
        raise ValueError("期交所沒有回傳台指期合約")
    r = contracts[0]
    price, ref = _num(r.get("CLastPrice")), _num(r.get("CRefPrice"))
    t = str(r.get("CTime") or "")
    d = str(r.get("CDate") or "")
    return {"name": str(r.get("DispCName") or "台指期").strip(), "price": price, "ref": ref,
            "change": _num(r.get("CDiff")), "change_pct": _num(r.get("CDiffRate")),
            "volume": _num(r.get("CTotalVolume")),
            "quote_time": f"{d[:4]}-{d[4:6]}-{d[6:]} {t[:2]}:{t[2:4]}:{t[4:6]}" if len(d) == 8 and len(t) >= 6 else "",
            "error": None if price is not None else "這個時段還沒有成交"}


def tw_futures() -> Dict[str, Any]:
    """台指期近月：日盤（08:45–13:45）與夜盤（15:00–隔日 05:00），附與加權指數的價差（正價差＝期貨比現貨高）。"""
    def load():
        out = {"source": "期交所 MIS 行情（約延遲數秒）"}
        for key, mt in (("day", "0"), ("night", "1")):
            try:
                out[key] = _taifex_session(mt)
            except Exception as e:
                out[key] = {"name": "台指期", "price": None, "error": f"期交所行情取得失敗：{e}"}
        return out
    return _cached("tw_futures", LIVE_TTL, load)


def world_indices() -> Dict[str, Any]:
    def load():
        syms = [s for _, rows in WORLD_GROUPS for s, _ in rows]
        names = {s: n for _, rows in WORLD_GROUPS for s, n in rows}
        quotes = {q["symbol"]: q for q in qp.get_quotes(syms, names) if q}
        tw = _tw_indices()
        if tw[0]["price"] is None:  # MIS 偶爾很慢：加權指數改用 Yahoo 的 ^TWII
            q = qp.get_quotes(["^TWII"], {})[0] or {}
            if q.get("is_live"):
                tw[0].update(price=q["price"], change=q.get("change"), change_pct=q.get("change_pct"),
                             quote_time=q.get("quote_time") or "", error=None)
        groups = [{"name": "台股", "rows": tw}]
        for g, rows in WORLD_GROUPS:
            items = []
            for s, n in rows:
                q = quotes.get(s) or {}
                items.append({"symbol": s, "name": n, "price": q.get("price"), "change": q.get("change"),
                              "change_pct": q.get("change_pct"), "quote_time": q.get("quote_time") or "",
                              "error": q.get("error") if not q.get("is_live") else None})
            groups.append({"name": g, "rows": items})
        fut = tw_futures()
        twii = groups[0]["rows"][0]["price"]
        day = fut.get("day") or {}
        basis = round(day["price"] - twii, 2) if day.get("price") is not None and twii else None
        return {"groups": groups, "futures": {**fut, "basis": basis},
                "source": "Yahoo Finance（國際指數、美股期貨，其他市場可能延遲 15–20 分鐘）、TWSE MIS（加權、櫃買）、期交所（台指期）"}
    return _cached("world", LIVE_TTL, load)


# ---------- 證交所盤後資料（產業、類股成交、三大法人）----------
def _twse_day(path: str, params: Dict[str, str], day: date) -> Optional[Dict[str, Any]]:
    """取某一天的證交所盤後資料；那天沒有交易（假日、還沒收盤）回 None。過去日期的結果永久快取。"""
    key = f"twse:{path}:{day.isoformat()}"
    today = date.today()

    def load():
        with _TWSE_LOCK:
            wait = TWSE_GAP_SEC - (time.time() - _TWSE_LAST[0])
            if wait > 0:
                time.sleep(wait)
            try:
                q = {k: day.strftime("%Y%m%d") if v == "{date}" else v for k, v in params.items()}
                payload = qp._http_json(f"{TWSE_RWD}/{path}?{urllib.parse.urlencode({**q, 'response': 'json'})}", timeout=15)
            finally:
                _TWSE_LAST[0] = time.time()
        # 假日證交所也回 stat OK，只是 tables 每張表都是空的：要看表格裡真的有資料才算有交易
        has_rows = payload.get("data") or any(t.get("data") for t in payload.get("tables") or [])
        return payload if payload.get("stat", "OK") == "OK" and has_rows else None

    return _cached(key, None if day < today else DAILY_TTL, load)


def _twse_recent(path: str, params: Dict[str, str], n: int = 1, back: int = 10) -> List[Dict[str, Any]]:
    """最近 n 個交易日的資料（新到舊）；最多往回找 back 天。"""
    out, d = [], date.today()
    for _ in range(back):
        got = _twse_day(path, params, d)
        if got:
            got = {**got, "_date": d.isoformat()}
            out.append(got)
            if len(out) >= n:
                break
        d -= timedelta(days=1)
    return out


def _bfiamu_map(payload: Dict[str, Any]) -> Dict[str, float]:
    out = {}
    for r in payload.get("data") or []:
        name = str(r[0]).strip()
        out[SECTOR_ALIAS.get(name, name)] = _num(r[2])
    return out


def sectors() -> Dict[str, Any]:
    """上市各類股：漲跌幅、成交金額、占類股成交比重、成交金額比前一交易日（量比）。依漲跌幅排序。"""
    def load():
        idx = _twse_recent("afterTrading/MI_INDEX", {"date": "{date}", "type": "IND"})
        amu = _twse_recent("afterTrading/BFIAMU", {"date": "{date}"}, n=2)
        if not idx:
            return {"rows": [], "date": None, "error": "證交所近 10 天都沒有類股指數資料（連線失敗或長假）"}
        table = next((t for t in idx[0].get("tables") or [] if "價格指數(臺灣證券交易所)" in str(t.get("title"))), None)
        if not table:
            return {"rows": [], "date": idx[0]["_date"], "error": "證交所資料格式改變，找不到類股價格指數表"}
        today_amt = _bfiamu_map(amu[0]) if amu and amu[0]["_date"] == idx[0]["_date"] else {}
        prev_amt = _bfiamu_map(amu[1]) if len(amu) > 1 and today_amt else {}
        rows = []
        for r in table.get("data") or []:
            name = str(r[0]).strip()
            if not name.endswith("類指數") or name in AGGREGATE_SECTORS:
                continue
            amt, prev = today_amt.get(name), prev_amt.get(name)
            rows.append({"name": name[:-3], "close": _num(r[1]), "change_pct": _num(r[4]),
                         "turnover": amt, "turnover_ratio": round(amt / prev, 2) if amt and prev else None})
        total = sum(r["turnover"] or 0 for r in rows)
        for r in rows:
            r["turnover_share_pct"] = round(r["turnover"] / total * 100, 2) if r["turnover"] and total else None
        rows.sort(key=lambda r: r["change_pct"] if r["change_pct"] is not None else -999, reverse=True)
        return {"rows": rows, "date": idx[0]["_date"], "turnover_total": total or None,
                "source": "證交所 MI_INDEX（類股指數）、BFIAMU（類股成交金額）；上市類股，每日收盤後更新"}
    return _safe(lambda: _cached("sectors", DAILY_TTL, load), "證交所類股資料")


INST_KEYS = [("自營商(自行買賣)", "dealer"), ("自營商(避險)", "dealer"), ("投信", "trust"),
             ("外資及陸資(不含外資自營商)", "foreign"), ("外資自營商", "foreign"), ("合計", "total")]


def fund_flow(days: int = 5) -> Dict[str, Any]:
    """三大法人（外資、投信、自營商）買賣超金額，最近 days 個交易日，單位：億元。"""
    def load():
        rows = []
        for p in _twse_recent("fund/BFI82U", {"dayDate": "{date}", "type": "day"}, n=days, back=days * 3):
            agg: Dict[str, float] = {}
            for r in p.get("data") or []:
                name = str(r[0]).strip()
                key = next((k for label, k in INST_KEYS if name == label), None)
                net = _num(r[3])
                if key and net is not None:
                    agg[key] = agg.get(key, 0.0) + net
            rows.append({"date": p["_date"], **{k: round(v / 1e8, 2) for k, v in agg.items()}})
        return {"days": rows, "unit": "億元",
                "source": "證交所 BFI82U 三大法人買賣金額統計（上市），每日收盤後更新",
                "error": None if rows else "證交所沒有回傳三大法人資料"}
    return _safe(lambda: _cached(f"fund_flow:{days}", DAILY_TTL, load), "證交所三大法人資料")


# ---------- 台灣 50（上市市值前 50 大）----------
def _roc_date(s: str) -> Optional[str]:
    s = str(s or "").strip()
    if len(s) != 7 or not s.isdigit():
        return None
    return f"{int(s[:3]) + 1911}-{s[3:5]}-{s[5:]}"


def top_market_cap(n: int = 50) -> Dict[str, Any]:
    """依最近收盤價 × 已發行普通股數排出上市市值前 n 大（不含 ETF）。"""
    def load():
        reg = stock_info._company_registry()
        rows = qp._http_json(STOCK_DAY_ALL, timeout=25)
        out = []
        for r in rows:
            code = str(r.get("Code", "")).strip()
            info = reg.get(code)
            close, shares = _num(r.get("ClosingPrice")), _num((info or {}).get("已發行普通股數或TDR原股發行股數"))
            if not info or not close or not shares:
                continue
            out.append({"code": code, "name": str(r.get("Name", "")).strip(), "close": close,
                        "change": _num(r.get("Change")), "volume": (_num(r.get("TradeVolume")) or 0) / 1000,
                        "shares": shares, "date": _roc_date(r.get("Date"))})
        out.sort(key=lambda x: x["close"] * x["shares"], reverse=True)
        return {"rows": out[:n], "date": out[0]["date"] if out else None}
    return _cached(f"topcap:{n}", RANK_TTL, load)


def _mis_quotes(codes: List[str]) -> Dict[str, Dict[str, Any]]:
    chunks = [codes[i:i + MIS_CHUNK] for i in range(0, len(codes), MIS_CHUNK)]

    def one(chunk):
        try:
            return _mis_rows([f"tse_{c}.tw" for c in chunk])
        except Exception:
            return {}
    out: Dict[str, Dict[str, Any]] = {}
    with ThreadPoolExecutor(max_workers=2) as ex:  # 同時太多請求 MIS 反而變慢
        results = list(ex.map(one, chunks))
    for chunk, got in zip(chunks, results):
        if not got:  # MIS 偶爾逾時：失敗的那一批再試一次，避免同一張表混著即時價和前一天收盤價
            got = one(chunk)
        for k, r in got.items():
            out[k.split(".")[0].upper()] = r
    return out


def tw50() -> Dict[str, Any]:
    def load():
        rank = top_market_cap(50)
        base = rank["rows"]
        live = _mis_quotes([r["code"] for r in base]) if base else {}
        rows = []
        for r in base:
            m = live.get(r["code"].upper()) or {}
            price, prev = _num(m.get("z")) or _num(m.get("pz")), _num(m.get("y"))
            vol = _num(m.get("v"))
            quote_day = str(m.get("d") or "")
            if price is not None and prev:
                change = round(price - prev, 2)
                # 日成交資料是前一交易日時才算量比（今日累計量 ÷ 前一日全日量）；同一天就不算
                same_day = rank["date"] and quote_day and rank["date"].replace("-", "") == quote_day
                row = {"price": price, "change": change, "change_pct": _pct(change, prev), "volume": vol,
                       "volume_ratio": round(vol / r["volume"], 2) if vol and r["volume"] and not same_day else None,
                       "quote_time": f"{quote_day} {m.get('t', '')}".strip(), "is_live": True}
            else:
                prev_close = r["close"] - r["change"] if r["change"] is not None else None
                row = {"price": r["close"], "change": r["change"], "change_pct": _pct(r["change"], prev_close),
                       "volume": r["volume"], "volume_ratio": None, "quote_time": f"{r['date']} 收盤", "is_live": False}
            row.update(code=r["code"], name=r["name"],
                       market_cap=round(row["price"] * r["shares"] / 1e8) if row["price"] else None)
            rows.append(row)
        return {"rows": rows, "rank_date": rank["date"], "live_count": sum(1 for r in rows if r["is_live"]),
                "note": "依最近收盤日的市值排出上市前 50 大（不含 ETF），接近台灣 50 指數成分股；正式成分股另有流通量等篩選，可能差幾檔。",
                "source": "證交所 STOCK_DAY_ALL × 上市公司已發行股數（排名）、TWSE MIS（盤中價格）"}
    return _safe(lambda: _cached("tw50", LIVE_TTL, load), "台灣 50 資料")
