"""
ETF / 個股真實基本面資料層 (etf_data.py) — 取代原本人工維護的靜態數字
資料來源（皆為公開 JSON 介面，每次請求都記在 quote_provider.FETCH_LOG）：
- 基金基本資料（發行單位數、類型、追蹤指數）：TWSE OpenAPI /opendata/t187ap47_L
- 定期定額交易戶數排行（前 20 名 ETF）：TWSE OpenAPI /ETFReport/ETFRank
- 近 12 個月配息 → 殖利率：Yahoo Finance Chart API (events=div) 的實際配息紀錄 ÷ 現價（自行計算）
- ETF 前十大成分股：Yahoo Finance quoteSummary topHoldings（需 cookie + crumb）
- Beta：近 1 年日報酬 vs 大盤（台股 ^TWII、美股 ^GSPC）的 cov/var（自行計算）
資料取不到時回傳 None，由呼叫端顯示「無資料」，不會填假數字。快取 6 小時。
"""

from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional
import http.cookiejar
import threading
import time
import urllib.parse
import urllib.request

from src import quote_provider as qp
from src.data_adapter import DualMarketDataAdapter

TWSE_OPENAPI = "https://openapi.twse.com.tw/v1"
TTL = 6 * 3600
_LOCK = threading.Lock()
_CACHE: Dict[str, Any] = {}
_OPENER: Dict[str, Any] = {}


def _cached(key: str, loader, ttl: int = TTL):
    with _LOCK:
        hit = _CACHE.get(key)
        if hit and time.time() - hit["t"] < ttl:
            return hit["v"]
    try:
        value = loader()
    except Exception:
        value = None
    with _LOCK:
        if value is None and hit:
            return hit["v"]  # 失敗時沿用舊資料
        if value is not None:
            _CACHE[key] = {"t": time.time(), "v": value}
    return value


def _yahoo_candidates(symbol: str) -> List[str]:
    n = DualMarketDataAdapter.normalize_symbol(symbol)
    if n["market"] == "US":
        return [n["symbol"]]
    base = n["raw_code"]
    return [f"{base}.TW", f"{base}.TWO"]


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


def _yahoo_opener():
    with _LOCK:
        if "op" in _OPENER and time.time() - _OPENER["t"] < 3600:
            return _OPENER["op"], _OPENER["crumb"]
    jar = http.cookiejar.CookieJar()
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    try:
        qp._http_json("https://fc.yahoo.com", timeout=8, opener=op)
    except Exception:
        pass  # 這個網址本來就回 404，只是為了取得 cookie
    crumb_req = urllib.request.Request(
        "https://query2.finance.yahoo.com/v1/test/getcrumb", headers=qp.UA
    )
    with op.open(crumb_req, timeout=10) as resp:
        crumb = resp.read().decode()
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
        bench = "^TWII" if norm["market"] == "TW" else "^GSPC"
        ad = DualMarketDataAdapter()
        bench_bars = ad._fetch_from_yahoo(bench, days=250)
        bars = None
        for ysym in _yahoo_candidates(symbol):
            try:
                bars = ad._fetch_from_yahoo(ysym, days=250)
                if len(bars) > 60:
                    break
            except Exception:
                continue
        if not bars or len(bars) <= 60:
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
        with _LOCK:
            y = (_CACHE.get(f"yield:{code}") or {}).get("v")
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
