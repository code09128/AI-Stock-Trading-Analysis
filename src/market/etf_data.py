"""
ETF / 個股真實基本面資料層 (etf_data.py) — 取代原本人工維護的靜態數字
資料來源（皆為公開 JSON 介面，每次請求都記在 quote_provider.FETCH_LOG）：
- 基金基本資料（發行單位數、類型、追蹤指數）：TWSE OpenAPI /opendata/t187ap47_L
- 定期定額交易戶數排行（前 20 名 ETF）：TWSE OpenAPI /ETFReport/ETFRank
- 近 12 個月配息 → 殖利率：Yahoo Finance Chart API (events=div) 的實際配息紀錄 ÷ 現價（自行計算）
- ETF 前十大成分股：Yahoo Finance quoteSummary topHoldings（需 cookie + crumb）
- Beta：近 1 年日報酬 vs 該市場大盤（台 ^TWII、美 ^GSPC、港 ^HSI、日 ^N225…，見 markets.py）的 cov/var（自行計算）
資料取不到時回傳 None，由呼叫端顯示「無資料」，不會填假數字。快取 6 小時。
"""

from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional
import http.cookiejar
import threading
import time
import urllib.parse
import urllib.request

from src.market import quote_provider as qp
from src.market import markets
from src.market.data_adapter import DualMarketDataAdapter
from src.market.cache import TTLCache
from src.market.net import http_bytes

TWSE_OPENAPI = "https://openapi.twse.com.tw/v1"
TTL = 6 * 3600
_LOCK = threading.Lock()
_CACHE = TTLCache()
_OPENER: Dict[str, Any] = {}


def _cached(key: str, loader, ttl: int = TTL):
    """loader 失敗或回傳 None 時：有舊資料就沿用，否則記一筆「抓不到」（見 cache.TTLCache）。"""
    return _CACHE.get_or_load(key, loader, ttl)


def _yahoo_candidates(symbol: str) -> List[str]:
    n = DualMarketDataAdapter.normalize_symbol(symbol)
    if n["market"] != "TW":  # 台股以外：Yahoo 代號就是正規化後的 symbol（含後綴）
        return [n["symbol"]]
    base = n["raw_code"]
    return [f"{base}.TW", f"{base}.TWO"]


def first_bars(symbol: str, fetch, min_bars: int = 1):
    """依序試 Yahoo 候選代號（台股 .TW／.TWO），回傳第一個筆數足夠的日 K；都失敗回 None。fetch(yahoo_symbol) -> bars。"""
    for ysym in _yahoo_candidates(symbol):
        try:
            bars = fetch(ysym)
        except Exception:
            continue
        if len(bars) >= min_bars:
            return bars
    return None


# ---------- TWSE ----------
def fund_registry() -> Dict[str, Dict[str, Any]]:
    def load():
        rows = qp._http_json(f"{TWSE_OPENAPI}/opendata/t187ap47_L", timeout=20)
        return {str(r.get("基金代號", "")).strip().upper(): r for r in rows}

    return _cached("registry", load) or {}


def savings_plan_rank() -> Dict[str, int]:
    def load():
        rows = qp._http_json(f"{TWSE_OPENAPI}/ETFReport/ETFRank", timeout=20)
        out = {}
        for r in rows:
            try:
                out[str(r["ETFsSecurityCode"]).strip().upper()] = int(r["ETFsNumberofTradingAccounts"])
            except (KeyError, ValueError):
                continue
        return out

    return _cached("rank", load) or {}


# ---------- Yahoo ----------
def dividend_yield(symbol: str) -> Optional[Dict[str, Any]]:
    """近 12 個月實際配息合計 ÷ 現價。"""

    def load():
        for ysym in _yahoo_candidates(symbol):
            try:
                url = (
                    f"{qp.YAHOO_URL}{urllib.parse.quote(ysym)}"
                    "?interval=1d&range=2y&events=div"
                )
                res = qp._http_json(url, timeout=12)["chart"]["result"][0]
            except Exception:
                continue
            price = qp._num(res["meta"].get("regularMarketPrice"))
            divs = (res.get("events") or {}).get("dividends") or {}
            cutoff = datetime.now() - timedelta(days=365)
            ttm = [d["amount"] for d in divs.values() if datetime.fromtimestamp(d["date"]) >= cutoff]
            if not price:
                continue
            return {
                "yield_pct": round(sum(ttm) / price * 100, 2),
                "ttm_dividend": round(sum(ttm), 4),
                "n_dividends": len(ttm),
                "price": price,
            }
        return None

    return _cached(f"yield:{symbol}", load)


_OPENER_LOCK = threading.Lock()


def _yahoo_opener():
    def cached():
        with _LOCK:
            if "op" in _OPENER and time.time() - _OPENER["t"] < 3600:
                return _OPENER["op"], _OPENER["crumb"]
        return None

    hit = cached()
    if hit:
        return hit
    with _OPENER_LOCK:  # 好幾檔 ETF 同時預熱時，只讓第一個去取 cookie 與 crumb
        hit = cached()
        if hit:
            return hit
        jar = http.cookiejar.CookieJar()
        op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
        try:
            qp._http_json("https://fc.yahoo.com", timeout=8, opener=op)
        except Exception:
            pass  # 這個網址本來就回 404，只是為了取得 cookie
        crumb = http_bytes("https://query2.finance.yahoo.com/v1/test/getcrumb", 10, opener=op).decode()
        with _LOCK:
            _OPENER.update(op=op, crumb=crumb, t=time.time())
        return op, crumb


def top_holdings(symbol: str) -> Optional[Dict[str, Any]]:
    """ETF 前十大成分股與權重（%）。"""

    def load():
        op, crumb = _yahoo_opener()
        for ysym in _yahoo_candidates(symbol):
            url = (
                "https://query2.finance.yahoo.com/v10/finance/quoteSummary/"
                f"{urllib.parse.quote(ysym)}?modules=topHoldings&crumb={urllib.parse.quote(crumb)}"
            )
            try:
                res = qp._http_json(url, timeout=12, opener=op)["quoteSummary"]["result"][0]
            except Exception:
                continue
            hold = (res.get("topHoldings") or {}).get("holdings") or []
            if not hold:
                continue
            items = [
                {
                    "symbol": h["symbol"].split(".")[0],
                    "name": h.get("holdingName", ""),
                    "pct": round(h["holdingPercent"]["raw"] * 100, 2),
                }
                for h in hold
            ]
            return {
                "holdings": items,
                "covered_pct": round(sum(i["pct"] for i in items), 2),
                "source": "Yahoo Finance quoteSummary topHoldings（僅前十大，非全部成分股）",
            }
        return None

    return _cached(f"holdings:{symbol}", load)


def calc_beta(symbol: str) -> Optional[Dict[str, Any]]:
    """近 1 年日報酬 vs 大盤的 Beta（cov / var）。"""

    def load():
        norm = DualMarketDataAdapter.normalize_symbol(symbol)
        bench = markets.info(norm["market"])["index"]  # 各市場自己的大盤（台 ^TWII、美 ^GSPC、港 ^HSI…）
        ad = DualMarketDataAdapter()
        bench_bars = ad._fetch_from_yahoo(bench, days=250)
        bars = first_bars(symbol, lambda y: ad._fetch_from_yahoo(y, days=250), min_bars=61)
        if not bars:
            return None

        def rets(bs):
            return {
                bs[i].timestamp: bs[i].close / bs[i - 1].close - 1
                for i in range(1, len(bs))
                if bs[i - 1].close
            }

        a, b = rets(bars), rets(bench_bars)
        days = sorted(set(a) & set(b))
        if len(days) < 60:
            return None
        xa, xb = [a[d] for d in days], [b[d] for d in days]
        ma, mb = sum(xa) / len(xa), sum(xb) / len(xb)
        cov = sum((x - ma) * (y - mb) for x, y in zip(xa, xb))
        var = sum((y - mb) ** 2 for y in xb)
        if var == 0:
            return None
        return {"beta": round(cov / var, 2), "benchmark": bench, "n_days": len(days)}

    return _cached(f"beta:{symbol}", load)


# ---------- ETF 清單 ----------
def build_etf_rows(pool: List[str], quotes: Dict[str, Dict[str, Any]]) -> List[Dict[str, Any]]:
    reg, rank = fund_registry(), savings_plan_rank()
    rows = []
    for code in pool:
        r = reg.get(code.upper(), {})
        q = quotes.get(code.upper()) or {}
        units = None
        try:
            units = float(r.get("發行單位數/轉換數"))
        except (TypeError, ValueError):
            pass
        price = q.get("price")
        y = _CACHE.peek(f"yield:{code}")
        rows.append(
            {
                "symbol": code,
                "name": r.get("基金簡稱") or q.get("name") or code,
                "tag": (r.get("基金類型") or "").replace("國內成分證券", "").replace("指數股票型基金", "ETF")
                or "ETF",
                "index_name": r.get("標的指數/追蹤指數名稱"),
                "aum_billion": round(units * price / 1e8, 1) if units and price else None,
                "units": units,
                "savings_plan_accounts": rank.get(code.upper()),
                "yield_pct": y["yield_pct"] if y else None,
                "ttm_dividend": y["ttm_dividend"] if y else None,
                "n_dividends": y["n_dividends"] if y else None,
            }
        )
    return rows


def warm_yields(pool: List[str]) -> None:
    """背景預先計算殖利率（首次需約數秒），不阻塞 API。"""
    from concurrent.futures import ThreadPoolExecutor

    def run():
        with ThreadPoolExecutor(max_workers=4) as ex:
            list(ex.map(dividend_yield, pool))

    threading.Thread(target=run, daemon=True).start()
