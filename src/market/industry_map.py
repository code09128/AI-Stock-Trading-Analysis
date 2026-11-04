"""
產業鏈地圖資料 (industry_map.py)：「產業全景」＋「產業鏈」兩層的資料。
- 全景（overview）：證交所全部類股，漲跌用 MIS 即時類股指數（盤中隨成交更新），MIS 沒有的類股退回證交所盤後資料；
  每個類股附成交比重與底下有哪幾條產業鏈。
- 產業鏈（chain_detail）：鏈裡每檔個股的 TWSE MIS 即時報價，環節漲跌＝環節內個股以成交值加權平均。
- 回放（chain_history）：鏈裡個股最近 N 個交易日的日報酬（Yahoo 日 K），環節＝個股等權平均。
鏈的結構（環節、個股、連線）在 chain_data.py，是自行整理的示意分類；取不到的欄位回 None 並附原因，不補假值。
"""

from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, List, Optional
import re

from src.market import chain_data, chain_data_us, etf_data, market_board
from src.market import quote_provider as qp
from src.market.cache import TTLCache
from src.market.data_adapter import DualMarketDataAdapter

OVERVIEW_TTL = 15
DETAIL_TTL = 20
HISTORY_TTL = 600
HISTORY_MAX_DAYS = 60
CODE_RE = re.compile(r"^\d{4,6}[A-Z]?$")
US_CODE_RE = re.compile(r"^[A-Z]{1,5}(-[A-Z])?$")  # NVDA、BRK-B
MARKETS = ("TW", "US")


def _data(market: str):
    """該市場的資料定義模組（chain_data／chain_data_us）。"""
    if market not in MARKETS:
        raise ValueError(f"不支援的市場：{market!r}")
    return chain_data_us if market == "US" else chain_data
_CACHE = TTLCache()


def validate(chains: Optional[List[Dict[str, Any]]] = None, layout: Optional[List[List[str]]] = None,
             links: Optional[List[Any]] = None, market: str = "TW") -> List[str]:
    """離線檢查資料定義，回傳問題清單（空＝沒問題）。改 chain_data.py／chain_data_us.py 後由測試呼叫。"""
    data = _data(market)
    code_re = US_CODE_RE if market == "US" else CODE_RE
    chains = data.CHAINS if chains is None else chains
    layout = data.LAYOUT if layout is None else layout
    links = data.LINKS if links is None else links
    problems: List[str] = []
    sectors = [n for col in layout for n in col]
    if len(set(sectors)) != len(sectors):
        problems.append("LAYOUT 有重複的產業別")
    for a, b in links:
        for n in (a, b):
            if n not in sectors:
                problems.append(f"LINKS：產業別「{n}」不在 LAYOUT 裡")
    ids = [c.get("id") for c in chains]
    for dup in {i for i in ids if ids.count(i) > 1}:
        problems.append(f"鏈代號重複：{dup}")
    for c in chains:
        cid = c.get("id") or "?"
        if not re.fullmatch(r"[a-z][a-z0-9_]*", str(c.get("id") or "")):
            problems.append(f"{cid}：id 只能用小寫英文、數字與底線")
        if c.get("sector") not in sectors:
            problems.append(f"{cid}：產業別「{c.get('sector')}」不在 LAYOUT 裡（要跟證交所類股名稱一致）")
        stages, nodes = c.get("stages") or [], c.get("nodes") or []
        if len(stages) < 2:
            problems.append(f"{cid}：至少要有 2 個階段")
        node_ids = [n.get("id") for n in nodes]
        for dup in {i for i in node_ids if node_ids.count(i) > 1}:
            problems.append(f"{cid}：環節代號重複：{dup}")
        stage_of = {}
        for n in nodes:
            nid = n.get("id")
            if not isinstance(n.get("stage"), int) or not 0 <= n["stage"] < len(stages):
                problems.append(f"{cid}/{nid}：stage 要是 0～{len(stages) - 1} 的整數")
            else:
                stage_of[nid] = n["stage"]
            stocks = n.get("stocks") or []
            for s in stocks:
                if not (isinstance(s, (list, tuple)) and len(s) == 2 and all(isinstance(x, str) and x.strip() for x in s)):
                    problems.append(f"{cid}/{nid}：個股要寫成 (\"代號\", \"簡稱\")，收到 {s!r}")
            codes = [s[0] for s in stocks if isinstance(s, (list, tuple)) and s]
            if not codes:
                problems.append(f"{cid}/{nid}：沒有個股")
            for code in codes:
                if not code_re.match(str(code)):
                    problems.append(f"{cid}/{nid}：代號格式不對：{code}")
            if len(set(codes)) != len(codes):
                problems.append(f"{cid}/{nid}：同一環節有重複的個股")
        for s in range(len(stages)):
            if not any(st == s for st in stage_of.values()):
                problems.append(f"{cid}：階段「{stages[s]}」沒有任何環節")
        for a, b in c.get("edges") or []:
            if a not in stage_of or b not in stage_of:
                problems.append(f"{cid}：連線 {a}→{b} 指向不存在的環節")
            elif stage_of[a] >= stage_of[b]:
                problems.append(f"{cid}：連線 {a}→{b} 要由前面的階段指向後面的階段")
    return problems


def _definition(market: str = "TW") -> Dict[str, Any]:
    problems = validate(market=market)
    if problems:
        raise ValueError("產業鏈資料有誤（src/market/chain_data*.py）：" + "；".join(problems[:5]))
    chains = []
    for c in _data(market).CHAINS:
        chains.append({
            "id": c["id"], "name": c["name"], "sector": c["sector"], "blurb": c.get("blurb", ""), "stages": list(c["stages"]),
            "nodes": [{"id": n["id"], "name": n["name"], "stage": n["stage"],
                       "stocks": [{"code": s[0], "name": s[1]} for s in n["stocks"]]} for n in c["nodes"]],
            "edges": [list(e) for e in c["edges"]],
        })
    return {"chains": chains}


def get_chain(chain_id: str, market: str = "TW") -> Dict[str, Any]:
    for c in _definition(market)["chains"]:
        if c["id"] == chain_id:
            return c
    raise ValueError(f"沒有這條產業鏈：{chain_id!r}")


def _codes(chain: Dict[str, Any]) -> Dict[str, str]:
    """鏈裡不重複的 {代號: 簡稱}（同一檔可以出現在不同環節）。"""
    out: Dict[str, str] = {}
    for n in chain["nodes"]:
        for s in n["stocks"]:
            out.setdefault(s["code"], s["name"])
    return out


# ---------- 全景 ----------
def overview(market: str = "TW") -> Dict[str, Any]:
    if market == "US":
        return _overview_us()

    def load():
        d = _definition()
        errors: List[str] = []
        try:
            live = market_board.sector_index_live()
        except Exception as e:
            live = {}
            errors.append(f"即時類股指數取得失敗：{e}")
        daily = market_board.sectors()
        if daily.get("error"):
            errors.append(str(daily["error"]))
        by_daily = {r["name"]: r for r in daily.get("rows") or []}
        by_sector: Dict[str, List[str]] = {}
        for c in d["chains"]:
            by_sector.setdefault(c["sector"], []).append(c["id"])
        columns: List[List[str]] = [list(col) for col in chain_data.LAYOUT]
        known = {n for col in columns for n in col}
        for name in list(live) + list(by_daily):  # 證交所新增、LAYOUT 還沒收錄的類股：自動放到最後一欄
            if name not in known:
                columns[-1].append(name)
                known.add(name)
        hubs = []
        for col, names in enumerate(columns):
            for order, name in enumerate(names):
                lv, dv = live.get(name), by_daily.get(name)
                hub = {"name": name, "col": col, "order": order, "change_pct": None, "source": None, "as_of": None,
                       "turnover_share_pct": dv.get("turnover_share_pct") if dv else None, "chains": by_sector.get(name, [])}
                if lv:
                    hub.update(change_pct=lv["change_pct"], source="live", as_of=lv["quote_time"])
                elif dv and dv.get("change_pct") is not None:
                    hub.update(change_pct=dv["change_pct"], source="daily", as_of=daily.get("date"))
                hubs.append(hub)
        return {
            "version": chain_data.VERSION, "market": "TW", "columns": list(chain_data.COLUMNS), "hubs": hubs,
            "links": [list(x) for x in chain_data.LINKS], "chains": d["chains"], "daily_date": daily.get("date"),
            "errors": errors,
            "source": "漲跌：證交所 MIS 即時類股指數（沒有的類股用證交所盤後資料）；成交比重：證交所 BFIAMU；"
                      "產業鏈分類為自行整理的示意，不是官方資料",
        }
    return _CACHE.get_or_load("overview", load, OVERVIEW_TTL, on_error="raise")


def _overview_us() -> Dict[str, Any]:
    """美股全景：11 檔 SPDR 類股 ETF 的 Yahoo 即時報價當類股漲跌；成交比重＝ETF 成交金額占 11 檔合計。"""
    def load():
        data = chain_data_us
        d = _definition("US")
        etfs = list(data.SECTOR_ETF.values())
        quotes = qp.get_quotes(etfs, {})
        by_sym = {q["symbol"]: q for q in quotes if q}
        errors: List[str] = []
        money = {}
        for name, etf in data.SECTOR_ETF.items():
            q = by_sym.get(etf) or {}
            if q.get("price") and q.get("volume"):
                money[name] = q["price"] * q["volume"]
        total = sum(money.values())
        by_sector: Dict[str, List[str]] = {}
        for c in d["chains"]:
            by_sector.setdefault(c["sector"], []).append(c["id"])
        hubs = []
        for col, names in enumerate(data.LAYOUT):
            for order, name in enumerate(names):
                q = by_sym.get(data.SECTOR_ETF.get(name, "")) or {}
                ok = bool(q.get("is_live")) and q.get("change_pct") is not None
                hub = {"name": name, "col": col, "order": order, "change_pct": q.get("change_pct") if ok else None,
                       "source": "live" if ok else None, "as_of": q.get("quote_time") if ok else None,
                       "turnover_share_pct": round(money[name] / total * 100, 1) if name in money and total else None,
                       "chains": by_sector.get(name, [])}
                hubs.append(hub)
        if not any(h["source"] for h in hubs):
            errors.append("類股 ETF 都沒有取得報價（可能連線失敗）")
        return {
            "version": data.VERSION, "market": "US", "columns": list(data.COLUMNS), "hubs": hubs,
            "links": [list(x) for x in data.LINKS], "chains": d["chains"], "daily_date": None, "errors": errors,
            "source": "漲跌：Yahoo Finance 的 SPDR 類股 ETF（XLK、XLF…）即時報價，休市時是最近一個交易日；成交比重＝11 檔 ETF 成交金額占比；"
                      "產業鏈分類為自行整理的示意，不是官方資料",
        }
    return _CACHE.get_or_load("overview:US", load, OVERVIEW_TTL, on_error="raise")


# ---------- 單一產業鏈：即時報價 ----------
def _weighted(items: List[Dict[str, Any]]) -> Optional[float]:
    """items 是有漲跌幅的個股；以成交值加權平均，成交值全部沒有時改用等權。"""
    if not items:
        return None
    ws = [i["turnover"] or 0 for i in items]
    if not sum(ws):
        ws = [1.0] * len(items)
    return round(sum(i["change_pct"] * w for i, w in zip(items, ws)) / sum(ws), 2)


def chain_detail(chain_id: str, market: str = "TW") -> Dict[str, Any]:
    chain = get_chain(chain_id, market)
    unit = 1 if market == "US" else 1000  # 台股成交量是「張」（1000 股），美股是股

    def load():
        codes = _codes(chain)
        quotes = qp.get_quotes(list(codes), codes)
        stocks: Dict[str, Dict[str, Any]] = {}
        for code, q in zip(codes, quotes):
            q = q or {}
            ok = bool(q.get("is_live")) and q.get("change_pct") is not None
            price, vol = q.get("price"), q.get("volume")
            stocks[code] = {
                "code": code, "name": q.get("name") if q.get("name") and q.get("name") != code else codes[code],
                "price": price, "change_pct": q.get("change_pct") if ok else None, "volume": vol,
                "turnover": round(price * vol * unit) if ok and price and vol else None,  # 台股張 → 股；單位為當地幣別
                "quote_time": q.get("quote_time") or "", "ok": ok, "error": None if ok else (q.get("error") or "沒有報價"),
            }
        nodes = {}
        for n in chain["nodes"]:
            items = [stocks[s["code"]] for s in n["stocks"] if stocks[s["code"]]["ok"]]
            nodes[n["id"]] = {"change_pct": _weighted(items), "n_ok": len(items), "n_total": len(n["stocks"]),
                              "turnover": sum(i["turnover"] or 0 for i in items) or None}
        uniq = [s for s in stocks.values() if s["ok"]]
        times = sorted(s["quote_time"] for s in uniq if s["quote_time"])
        return {
            "id": chain_id, "stocks": stocks, "nodes": nodes,
            "summary": {"change_pct": _weighted(uniq), "n_ok": len(uniq), "n_total": len(stocks)},
            "as_of": times[-1] if times else None,
            "error": None if uniq else "這條產業鏈的個股都沒有取得報價（可能休市或連線失敗）",
            "source": ("Yahoo Finance 即時報價（美股盤中約延遲 0～5 秒，休市時是最近一個交易日）" if market == "US" else "證交所 MIS 即時行情（約延遲 5 秒）")
                      + "；環節漲跌＝環節內個股以成交值加權平均",
        }
    return _CACHE.get_or_load(f"detail:{market}:{chain_id}", load, DETAIL_TTL, on_error="raise")


# ---------- 單一產業鏈：回放 ----------
def chain_history(chain_id: str, days: int = 30, market: str = "TW") -> Dict[str, Any]:
    chain = get_chain(chain_id, market)
    days = max(5, min(int(days), HISTORY_MAX_DAYS))

    def load():
        codes = _codes(chain)
        ad = DualMarketDataAdapter()

        def one(code: str):
            try:
                bars = etf_data.first_bars(code, lambda y: ad._fetch_from_yahoo(y, days=days + 15), min_bars=5)
            except Exception:
                bars = None
            return code, {b.timestamp: b.close for b in bars} if bars else {}

        with ThreadPoolExecutor(max_workers=6) as ex:
            closes = dict(ex.map(one, list(codes)))
        have = {c: v for c, v in closes.items() if v}
        counts = Counter(d for v in have.values() for d in v)
        need = max(1, (len(have) + 1) // 2)  # 至少一半的個股有收盤價的日子才算交易日（避開個別個股停牌）
        dates = sorted(d for d, n in counts.items() if n >= need)[-(days + 1):]
        if len(dates) < 3:
            return {"id": chain_id, "dates": [], "stocks": {}, "nodes": {}, "missing": list(codes),
                    "error": "取不到足夠的歷史日 K，無法回放", "source": "Yahoo Finance 日 K"}
        stocks: Dict[str, List[Optional[float]]] = {}
        for code, c in have.items():
            series = []
            for i in range(1, len(dates)):
                a, b = c.get(dates[i - 1]), c.get(dates[i])
                series.append(round((b / a - 1) * 100, 2) if a and b else None)
            if any(v is not None for v in series):
                stocks[code] = series
        nodes: Dict[str, List[Optional[float]]] = {}
        for n in chain["nodes"]:
            rows = [stocks[s["code"]] for s in n["stocks"] if s["code"] in stocks]
            nodes[n["id"]] = [
                round(sum(vals) / len(vals), 2) if (vals := [r[i] for r in rows if r[i] is not None]) else None
                for i in range(len(dates) - 1)
            ]
        return {"id": chain_id, "dates": dates[1:], "stocks": stocks, "nodes": nodes,
                "missing": [c for c in codes if c not in stocks], "error": None,
                "source": "Yahoo Finance 日 K 收盤價；環節＝環節內個股等權平均"}
    return _CACHE.get_or_load(f"history:{market}:{chain_id}:{days}", load, HISTORY_TTL, on_error="raise")
