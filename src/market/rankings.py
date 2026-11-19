"""
探索榜單 (rankings.py)：看盤頁左側「探索」的熱門升幅／熱門跌幅／成交熱門與主題榜。

不打爆資料來源的做法（每個榜單都只用已有的快取或一次批次請求，不逐檔查價）：
- 台股熱門榜：直接用大盤頁「台灣 50」的資料（market_board.tw50，15 秒快取，和大盤頁共用），不另外抓。
  範圍＝上市市值前 50 大，不是全市場；全市場盤中排行要逐檔查 MIS（每批 5 檔），太重，不做。
- 美股熱門榜：Yahoo 預設篩選榜單（漲幅／跌幅／成交量），一次請求 25 檔，盤中 60 秒、休市 30 分鐘快取。
- 主題榜＝自己整理的產業鏈（chain_data*.py）：
  台股用產業鏈地圖的明細（industry_map.chain_detail，20 秒快取，和產業鏈地圖共用）；
  美股用 Yahoo 批次報價一次查完整條鏈（產業鏈地圖是逐檔查，這裡不沿用），60 秒快取。
- 美股兩種來源都會帶分析師平均評等（averageAnalystRating，例如「1.8 - Buy」），所以清單上的評等標籤不用再逐檔查。
限制：美股開盤判斷只看美東時間週一到週五 9:30～16:00，不含假日；假日時只是快取比較短，不影響正確性。
"""

import urllib.parse
from datetime import datetime
from typing import Any, Dict, List, Optional

from src.market import etf_data, industry_map, market_board
from src.market import quote_provider as qp
from src.market.cache import TTLCache
from src.market.tz import zone

US_OPEN_TTL = 60
US_CLOSED_TTL = 1800
KINDS = ("gain", "lose", "turn", "theme")
_SCREENERS = {"gain": "day_gainers", "lose": "day_losers", "turn": "most_actives"}
_TITLES = {"gain": "熱門升幅", "lose": "熱門跌幅", "turn": "成交熱門"}
# Yahoo 的評等字串 → 中文（分數 1＝強力買進 … 5＝強力賣出）
RATING_ZH = {"strong buy": "強力買進", "buy": "買進", "hold": "持有", "underperform": "偏弱", "sell": "賣出", "strong sell": "強力賣出"}
LIMIT = 25

_CACHE = TTLCache()


def parse_rating(s: Any) -> Optional[Dict[str, Any]]:
    """「1.8 - Buy」→ {"score": 1.8, "label": "買進"}；格式不對回 None。"""
    if not isinstance(s, str) or "-" not in s:
        return None
    left, right = s.split("-", 1)
    try:
        score = float(left.strip())
    except ValueError:
        return None
    label = RATING_ZH.get(right.strip().lower())
    return {"score": score, "label": label} if label else None


def us_open(now: Optional[datetime] = None) -> bool:
    ny = zone("America/New_York")  # Windows 沒裝 tzdata 也能用（見 tz.py）
    t = (now or datetime.now(ny)).astimezone(ny)
    return t.weekday() < 5 and (9, 30) <= (t.hour, t.minute) < (16, 0)


def _us_ttl() -> int:
    return US_OPEN_TTL if us_open() else US_CLOSED_TTL


def _yahoo(url: str) -> Dict[str, Any]:
    op, crumb = etf_data._yahoo_opener()
    sep = "&" if "?" in url else "?"
    return qp._http_json(f"{url}{sep}crumb={urllib.parse.quote(crumb)}", timeout=15, opener=op)


def _us_row(q: Dict[str, Any], name: Optional[str] = None) -> Dict[str, Any]:
    price, vol = q.get("regularMarketPrice"), q.get("regularMarketVolume")
    return {
        "symbol": str(q.get("symbol") or ""), "name": name or q.get("shortName") or q.get("longName") or q.get("symbol"),
        "price": price, "change": q.get("regularMarketChange"),
        "change_pct": round(q["regularMarketChangePercent"], 2) if isinstance(q.get("regularMarketChangePercent"), (int, float)) else None,
        "volume": vol, "turnover": round(price * vol) if isinstance(price, (int, float)) and isinstance(vol, (int, float)) else None,
        "market_cap": q.get("marketCap"), "rating": parse_rating(q.get("averageAnalystRating")),
    }


def _us_screener(kind: str) -> Dict[str, Any]:
    def load():
        d = _yahoo(f"https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds={_SCREENERS[kind]}&count={LIMIT}")
        quotes = ((d.get("finance") or {}).get("result") or [{}])[0].get("quotes") or []
        return {"rows": [_us_row(q) for q in quotes if q.get("symbol")][:LIMIT],
                "note": "Yahoo 美股預設榜單（全市場，含中小型股）。",
                "source": "Yahoo Finance 預設篩選榜單（盤中約延遲數秒，休市時是最近一個交易日）"}
    return _CACHE.get_or_load(f"us:{kind}", load, _us_ttl(), on_error="raise")


def _tw_hot(kind: str) -> Dict[str, Any]:
    d = market_board.tw50()
    if d.get("error"):
        raise RuntimeError(d["error"])
    rows = []
    for r in d.get("rows") or []:
        price, vol = r.get("price"), r.get("volume")
        rows.append({"symbol": r["code"], "name": r["name"], "price": price, "change": r.get("change"),
                     "change_pct": r.get("change_pct"), "volume": vol,
                     "turnover": round(price * vol * 1000) if price and vol else None,  # 張 → 股
                     "sub": r.get("industry")})
    key = {"gain": lambda x: -(x["change_pct"] if x["change_pct"] is not None else -1e9),
           "lose": lambda x: x["change_pct"] if x["change_pct"] is not None else 1e9,
           "turn": lambda x: -(x["turnover"] or 0)}[kind]
    rows.sort(key=key)
    return {"rows": rows[:LIMIT], "note": "範圍是上市市值前 50 大（接近台灣 50），不是全市場。", "source": d.get("source")}


def themes(market: str) -> List[Dict[str, str]]:
    return [{"id": c["id"], "name": c["name"]} for c in industry_map._definition(market)["chains"]]


def _theme(market: str, chain_id: str) -> Dict[str, Any]:
    chain = industry_map.get_chain(chain_id, market)
    names = industry_map._codes(chain)
    blurb = chain.get("blurb") or ""
    note = f"產業鏈「{chain['name']}」的成分股（自行整理，非完整名單）。{blurb}"
    if market == "TW":
        d = industry_map.chain_detail(chain_id, "TW")
        rows = [{"symbol": s["code"], "name": s["name"], "price": s["price"], "change_pct": s["change_pct"],
                 "turnover": s["turnover"]} for s in d["stocks"].values() if s.get("price") is not None]
        source = d.get("source")
    else:
        def load():
            syms = ",".join(urllib.parse.quote(c) for c in names)
            res = (_yahoo(f"https://query1.finance.yahoo.com/v7/finance/quote?symbols={syms}").get("quoteResponse") or {}).get("result") or []
            return [_us_row(q, names.get(str(q.get("symbol")))) for q in res if q.get("symbol")]
        rows = _CACHE.get_or_load(f"theme:US:{chain_id}", load, _us_ttl(), on_error="raise")
        source = "Yahoo Finance 批次報價（盤中約延遲數秒，休市時是最近一個交易日）"
    rows = sorted(rows, key=lambda x: -(x["change_pct"] if x.get("change_pct") is not None else -1e9))
    return {"rows": rows, "title": chain["name"], "note": note, "source": source}


def ranking(market: str, kind: str, theme: str = "") -> Dict[str, Any]:
    """market＝TW／US；kind＝gain／lose／turn／theme（theme 要給產業鏈 id）。回傳 {rows, title, note, source, themes}。"""
    market = (market or "TW").upper()
    if market not in ("TW", "US"):
        raise ValueError(f"market 只能是 TW 或 US，收到 {market!r}")
    if kind not in KINDS:
        raise ValueError(f"kind 只能是 {'／'.join(KINDS)}，收到 {kind!r}")
    if kind == "theme" and not theme:  # 只要主題清單（前端第一次打開「主題」時），不抓任何報價
        out = {"rows": [], "title": "主題", "note": "", "source": ""}
    elif kind == "theme":
        out = _theme(market, theme)
    else:
        out = (_tw_hot if market == "TW" else _us_screener)(kind)
        out = {**out, "title": _TITLES[kind]}
    return {**out, "market": market, "kind": kind, "themes": themes(market)}
