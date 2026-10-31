"""存股計畫（/api/savings/*）：定期定額正推與反推、高股息 ETF 比較、生命週期試算；公式在 src/portfolio/savings_plan.py"""

from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, List

from datetime import datetime, timedelta
import math
import urllib.parse

from src.company import stock_info
from src.market import etf_data, finmind_store, fx, quote_provider
from src.market.data_adapter import DualMarketDataAdapter
from src.market.etf_reference import HIGH_DIVIDEND_POOL
from src.portfolio import savings_plan
from src.server.config import WATCHLIST_NAMES
from src.server.params import arg_num, arg_ticker

BARS_DAYS = 2600  # 備援：Yahoo 近 10 年還權日 K
FULL_HISTORY_FROM = "1990-01-01"  # 從上市日開始（FinMind 只回有資料的部分）
MAX_PORTFOLIO_ITEMS = 20
BACKTEST_YEARS = [1, 3, 5, 10]
CHART_RANGES = [("3m", 91), ("6m", 182), ("1y", 365), ("3y", 1096)]
CHART_POINTS = 250
BENCHMARK = ("^TWII", "加權指數（不含配息）")


def _finmind_events(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """FinMind 股利政策 → 除權息事件。配股欄位是「元」（面額 10 元），換成每股配幾股要 ÷ 10。"""
    out = []
    for r in rows:
        cash = float(r.get("CashEarningsDistribution") or 0) + float(r.get("CashStatutorySurplus") or 0)
        stock = (float(r.get("StockEarningsDistribution") or 0) + float(r.get("StockStatutorySurplus") or 0)) / 10
        if cash > 0 and r.get("CashExDividendTradingDate"):
            out.append({"date": r["CashExDividendTradingDate"], "cash": cash})
        if stock > 0 and r.get("StockExDividendTradingDate"):
            out.append({"date": r["StockExDividendTradingDate"], "stock": stock})
    return out


class SavingsHandlers:
    """存股計畫（/api/savings/*）"""

    def _history_points(self, symbol: str) -> Dict[str, Any]:
        """含息再投入的長期價格序列：{points, source, warning}。
        台股：Yahoo 的舊資料沒有依股票分割調整（0050 在 2013 年以前是分割前價格），
        所以用 FinMind 上市以來日 K＋除權息自行還原；其他市場用 Yahoo 完整歷史月資料（已調整）。
        取不到時退回 Yahoo 近 10 年還權日 K，並標示報酬率可能偏離長期水準。"""
        n = DualMarketDataAdapter.normalize_symbol(symbol)
        reason = ""
        try:
            if n["market"] == "TW":
                px = finmind_store.history("TaiwanStockPrice", n["raw_code"], FULL_HISTORY_FROM)
                dv = finmind_store.history("TaiwanStockDividend", n["raw_code"], FULL_HISTORY_FROM)
                if len(px["rows"]) >= 250:
                    res = savings_plan.total_return_index(
                        [{"date": r["date"], "close": float(r.get("close") or 0)} for r in px["rows"]],
                        _finmind_events(dv["rows"]))
                    splits = "、".join(f"{s['date']}（{s['factor']:g} 倍）" for s in res["splits"])
                    return {"points": res["points"],
                            "source": "FinMind 上市以來日 K＋除權息（含息再投入，自行還原）"
                                      + (f"；已還原股票分割 {splits}" if splits else ""),
                            "warning": "FinMind 這次沒有更新成功，用本機上次的資料" if px.get("stale") else None}
                reason = px.get("error") or "FinMind 沒有這檔的日 K"
            else:
                url = (f"{quote_provider.YAHOO_URL}{urllib.parse.quote(n['symbol'])}"
                       "?interval=1mo&range=max")
                res = quote_provider._http_json(url, timeout=15)["chart"]["result"][0]
                gmt = res["meta"].get("gmtoffset", 0)
                adj = res["indicators"]["adjclose"][0]["adjclose"]
                pts = [{"date": datetime.utcfromtimestamp(t + gmt).strftime("%Y-%m-%d"), "close": c}
                       for t, c in zip(res["timestamp"], adj) if c]
                # 月資料每根標在月初，但最後一根（本月）的價格是最新成交價：日期改成實際成交日，年數才不會少算
                last_t = res["meta"].get("regularMarketTime")
                if pts and last_t:
                    last_day = datetime.utcfromtimestamp(last_t + gmt).strftime("%Y-%m-%d")
                    pts[-1]["date"] = max(pts[-1]["date"], last_day)
                if len(pts) >= 24:
                    return {"points": pts, "source": "Yahoo 完整歷史月資料（還權，含配息再投入）", "warning": None}
                reason = "Yahoo 完整歷史資料不足"
        except Exception as e:
            reason = str(e)
        feed = self.adapter.fetch_bars(symbol, days=BARS_DAYS)
        return {"points": [{"date": b.timestamp, "close": b.close} for b in feed["bars"]],
                "source": "Yahoo 近 10 年還權日 K" if feed["data_source"] == "LIVE_YAHOO_FINANCE"
                else "FinMind 近 10 年日 K（未還權）",
                "warning": f"取不到上市以來的完整資料（{reason}），只用近 10 年計算，報酬率可能偏離長期水準"
                + ("；而且這份日 K 沒有包含配息，會偏低" if feed["data_source"] != "LIVE_YAHOO_FINANCE" else "")}

    def _savings_stats(self, symbol: str) -> Dict[str, Any]:
        """長期報酬率統計（6 小時快取）。"""
        def load():
            h = self._history_points(symbol)
            stats = savings_plan.return_stats(h["points"])
            stats["data_source"] = h["source"]
            if h["warning"]:
                stats["warning"] = h["warning"]
            return stats

        return etf_data._cached(f"savings:{symbol}", load) or {}

    @staticmethod
    def _split_adjusted_dividends(symbol: str) -> List[Dict[str, Any]]:
        """平均殖利率要跟現價比，配息必須依股票分割調整：FinMind 沒調整（0050 在 2025 年 1 拆 4，
        分割前每股配息會多算 4 倍），所以優先用 Yahoo（已調整），取不到才用 FinMind。"""
        events = etf_data._cached(f"savings_div:{symbol}", lambda: stock_info._dividends_yahoo(symbol) or None)
        return events or stock_info.dividend_events(symbol)["events"]

    def _savings_row(self, symbol: str, quote: Dict[str, Any], monthly_income: float = 0,
                     lump_sum: float = 0) -> Dict[str, Any]:
        stats = self._savings_stats(symbol)
        price = quote.get("price")
        divs = self._split_adjusted_dividends(symbol)
        avg = savings_plan.avg_yield(divs, price, stats.get("first_date"))
        analysis = stock_info.analyze_dividends(divs, price)
        ttm = analysis["ttm_yield_pct"] if price else None
        currency = quote.get("currency") or ""
        row = {"symbol": symbol, "name": quote.get("name") or symbol, "price": price,
               # 定期定額換算股數要用台幣價格：1 單位計價幣別＝幾台幣（取不到為 None）
               "currency": currency, "fx_to_twd": fx.rate_to_twd(currency)["rate"] if currency else None,
               "error": quote.get("error") if not price else None, "frequency": analysis["frequency"],
               "ttm_yield_pct": ttm, "avg_yield_pct": avg["yield_pct"] if avg else None,
               "avg_yield_years": avg["years"] if avg else None, **stats}
        use_yield = row["avg_yield_pct"] or ttm
        if monthly_income:
            need = savings_plan.income_capital(monthly_income, use_yield)
            row["capital_needed"] = round(need) if need else None
        if lump_sum:
            got = savings_plan.income_from_capital(lump_sum, use_yield)
            row["monthly_from_lump"] = round(got) if got else None
        return row

    def handle_savings_returns(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """單一標的的三種參考報酬率與殖利率（定期定額分頁用）。"""
        symbol = arg_ticker(payload, "symbol", default="0050")
        quote = quote_provider.get_quotes([symbol], WATCHLIST_NAMES)[0] or {}
        if not quote.get("price"):
            raise ValueError(f"查無 {symbol} 的報價：{quote.get('error') or '代號可能不存在'}")
        return self._savings_row(symbol, quote)

    def handle_savings_dividends(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """S3：每月想領多少 → 各高股息 ETF 需要的本金（或一次投入多少 → 每月可領）；附規模與近 3 年總報酬，避免只看殖利率。"""
        lump = arg_num(payload, "lump_sum", 0, "一次投入金額", lo=0, hi=1e12)
        income = 0 if lump else arg_num(payload, "monthly_income", 30000, "每月想領的金額", lo=1, hi=1e8)
        extra = [str(s).strip() for s in payload.get("symbols", []) if str(s).strip()][:3]
        pool: List[str] = list(dict.fromkeys(extra + HIGH_DIVIDEND_POOL))
        quotes = {q["symbol"].split(".")[0].upper(): q
                  for q in quote_provider.get_quotes(pool, WATCHLIST_NAMES) if q}
        reg = etf_data.fund_registry()

        def one(code: str) -> Dict[str, Any]:
            q = quotes.get(code.split(".")[0].upper()) or {}
            try:
                row = self._savings_row(code, q, income, lump)
            except Exception as e:
                row = {"symbol": code, "name": q.get("name") or code, "error": str(e)}
            try:
                units = float(reg.get(code.upper(), {}).get("發行單位數/轉換數"))
            except (TypeError, ValueError):
                units = None
            row["aum_billion"] = round(units * row["price"] / 1e8, 1) if units and row.get("price") else None
            return row

        with ThreadPoolExecutor(max_workers=4) as ex:
            rows = list(ex.map(one, pool))
        return {
            "monthly_income": income,
            "lump_sum": lump,
            "rows": rows,
            "sources": {
                "yield": "近 3 年現金股利合計 ÷ 年數 ÷ 現價（上市未滿 3 年用實際年數）；配息紀錄 FinMind／Yahoo",
                "total_3y": "Yahoo 還權日 K（含配息再投入）近 3 年漲跌幅",
                "aum": "TWSE OpenAPI 發行單位數 × 即時市價（市值估算，非淨值規模）",
            },
        }

    def _points(self, symbol: str) -> Dict[str, Any]:
        """含息還原的長期價格序列（6 小時快取）；抓不到回 {}。"""
        return etf_data._cached(f"savings_pts:{symbol}", lambda: self._history_points(symbol)) or {}

    @staticmethod
    def _benchmark_points() -> List[Dict[str, Any]]:
        """加權指數近 10 年日收盤（6 小時快取）；抓不到回 []。"""
        def load():
            url = f"{quote_provider.YAHOO_URL}{urllib.parse.quote(BENCHMARK[0])}?interval=1d&range=10y"
            res = quote_provider._http_json(url, timeout=15)["chart"]["result"][0]
            gmt = res["meta"].get("gmtoffset", 0)
            closes = res["indicators"]["quote"][0]["close"]
            return [{"date": datetime.utcfromtimestamp(t + gmt).strftime("%Y-%m-%d"), "close": c}
                    for t, c in zip(res["timestamp"], closes) if c] or None
        return etf_data._cached("savings_bench", load) or []

    @staticmethod
    def _chart(points: List[Dict[str, Any]], bench: List[Dict[str, Any]]) -> Dict[str, Any]:
        """各區間的累積報酬走勢（%），組合與大盤從同一天起算；每段最多 CHART_POINTS 點。"""
        out = {}
        if not points:
            return out
        b_dates = [p["date"] for p in bench]
        last = points[-1]["date"]
        for key, days in CHART_RANGES:
            start = (datetime.fromisoformat(last) - timedelta(days=days)).date().isoformat()
            seg = [p for p in points if p["date"] >= start]
            if len(seg) < 2 or points[0]["date"] > start:
                continue
            step = max(1, -(-len(seg) // CHART_POINTS))
            seg = seg[::step] + ([seg[-1]] if (len(seg) - 1) % step else [])
            b0 = savings_plan._value_on(bench, b_dates, seg[0]["date"])
            rows = []
            for p in seg:
                b = savings_plan._value_on(bench, b_dates, p["date"])
                rows.append({"date": p["date"], "port": round((p["close"] / seg[0]["close"] - 1) * 100, 2),
                             "bench": round((b / b0 - 1) * 100, 2) if b and b0 else None})
            out[key] = rows
        return out

    def handle_savings_portfolio(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """多標的組合：items = [{symbol, weight}]、cash = 現金比例（%）；initial／monthly 用於每月投入金額與歷史回測。"""
        items = []
        display: Dict[str, str] = {}  # 正規代號 → 畫面上第一次出現的寫法（回傳用，畫面靠它對回每一列）
        merged: Dict[str, List[str]] = {}
        for it in (payload.get("items") or [])[:MAX_PORTFOLIO_ITEMS]:
            sym = str(it.get("symbol") or "").strip().upper() if isinstance(it, dict) else ""
            if not sym:
                continue  # 畫面上還沒填完的空白列
            w = arg_num(it, "weight", 0, f"{sym} 的比例", lo=0, hi=100)
            if w > 0:
                # 0050 與 0050.TW 是同一檔：用正規代號合併比例，不然會被當成兩檔各算一次
                key = DualMarketDataAdapter.normalize_symbol(sym)["symbol"]
                shown = display.setdefault(key, sym)
                if sym != shown and sym not in merged.setdefault(key, [shown]):
                    merged[key].append(sym)
                items.append((shown, w))
        if not items:
            raise ValueError("請至少輸入一檔標的與比例")
        cash = arg_num(payload, "cash", 0, "現金比例", lo=0, hi=100)
        initial = arg_num(payload, "initial", 0, "期初投入", lo=0, hi=1e11)
        monthly = arg_num(payload, "monthly", 0, "每月投入", lo=0, hi=1e9)
        # 期初投入與每月定額的幣別（畫面可切台幣／美元）；回傳的金額都用這個幣別，股數換算時再經過匯率
        currency = str(payload.get("currency") or "TWD").upper()
        if currency not in ("TWD", "USD"):
            raise ValueError("幣別只能是 TWD 或 USD")
        in_rate = fx.rate_to_twd(currency)["rate"]
        if not in_rate:
            raise ValueError(f"取不到 {currency} 兌台幣匯率，請稍後再試或改用台幣")
        raw_total = sum(w for _, w in items) + cash
        weights: Dict[str, float] = {}
        for sym, w in items:
            weights[sym] = weights.get(sym, 0) + w / raw_total
        cash_w = cash / raw_total

        syms = list(weights)
        with ThreadPoolExecutor(max_workers=4) as ex:
            bench_f = ex.submit(self._benchmark_points)
            hist = dict(zip(syms, ex.map(self._points, syms)))
            quotes = {q["symbol"].split(".")[0].upper(): q
                      for q in quote_provider.get_quotes(syms, WATCHLIST_NAMES) if q}
            bench = bench_f.result()
        series = {s: h.get("points") or [] for s, h in hist.items()}
        warnings = [f"{s}：{h['warning']}" for s, h in hist.items() if h.get("warning")]
        warnings += [f"{'、'.join(names)} 是同一檔，比例已合併計算" for names in merged.values()]
        missing = [s for s in syms if not series[s]]
        if missing:
            warnings.append(f"{'、'.join(missing)} 取不到歷史資料，計算時當作不存在（比例分給其他標的）")
        blended = savings_plan.blend_index(series, weights, cash_w)
        if len(blended["points"]) < 2:
            raise ValueError("所有標的都取不到歷史資料，無法計算")
        starts = blended["starts"]
        first = min(starts.values())
        late = sorted((d, s) for s, d in starts.items() if d > first)
        if late:
            warnings.append("、".join(f"{s} {d} 起才有資料" for d, s in late)
                            + "；在那之前它的比例依比例分給其他標的")
        home = {"TWD": "TW", "USD": "US"}[currency]
        if any(DualMarketDataAdapter.normalize_symbol(s)["market"] != home for s in syms):
            warnings.append(f"跟輸入幣別（{currency}）不同市場的標的以原幣報酬計算，未含匯率變動；"
                            "股數換算用目前匯率")

        rows = []
        for s in syms:
            q = quotes.get(s.split(".")[0].upper()) or {}
            price = q.get("price")
            amount = monthly * weights[s]  # 輸入的幣別
            amount_twd = amount * in_rate
            tw = DualMarketDataAdapter.normalize_symbol(s)["market"] == "TW"
            # 每月金額與標的現價可能是不同幣別：都換成台幣再算股數（取不到標的幣別的匯率就不估）
            rate = 1.0 if tw else fx.rate_to_twd(q.get("currency") or "")["rate"]
            twd_price = price * rate if price and rate else None
            # 兩種買法：整股（券商零股定期定額，買不滿一股的錢留著）；碎股（銀行信託定期定額，金額全部買進，到小數 4 位）
            whole = math.floor(amount_twd / twd_price) if twd_price else None
            left = (amount_twd - whole * twd_price) / in_rate if twd_price else None
            dp = 0 if currency == "TWD" else 2  # 美元金額留到美分
            rows.append({"symbol": s, "name": q.get("name") or s, "price": price,
                         "currency": q.get("currency") or ("TWD" if tw else None),
                         "weight_pct": round(weights[s] * 100, 2), "monthly_amount": round(amount, dp),
                         "est_whole": whole,
                         "est_leftover": round(left, dp) if left is not None else None,
                         "est_frac": math.floor(amount_twd / twd_price * 1e4) / 1e4 if twd_price else None,
                         "first_date": starts.get(s),
                         "source": hist[s].get("source")})
        stats = savings_plan.portfolio_stats(blended["points"])
        return {
            "items": rows,
            "input_currency": currency,
            "input_fx_to_twd": in_rate,
            "cash_pct": round(cash_w * 100, 2),
            "raw_total_pct": round(raw_total, 2),
            "stats": stats,
            "benchmark": {"name": BENCHMARK[1], "periods": savings_plan.period_returns(bench) if bench else None},
            "chart": self._chart(blended["points"], bench),
            "backtest": [b for b in (savings_plan.dca_backtest(series, weights, cash_w, initial, monthly, y)
                                     for y in BACKTEST_YEARS) if b],
            "warnings": warnings,
        }

    def handle_savings_calc(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """純計算（不連網）：kind = grow（S1）／target（S2）／life（S4）。"""
        kind = payload.get("kind")
        rates = [arg_num({"v": r}, "v", 0, "報酬率", lo=-50, hi=100) for r in (payload.get("rates") or [])][:4]
        if kind in ("grow", "target") and not rates:
            raise ValueError("請至少提供一個報酬率")
        initial = arg_num(payload, "initial", 0, "初期投入", lo=0, hi=1e11)
        if kind == "grow":
            monthly = arg_num(payload, "monthly", 5000, "每月投入", lo=0, hi=1e9)
            years = int(arg_num(payload, "years", 20, "投資年數", integer=True, lo=1, hi=60))
            return {"table": savings_plan.grow_table(monthly, initial, rates),
                    "curve": savings_plan.growth_curve(monthly, initial, rates[0], years)}
        if kind == "target":
            target = arg_num(payload, "target", 1e6, "目標金額", lo=1, hi=1e12)
            return {"table": savings_plan.target_table(target, initial, rates)}
        if kind == "life":
            return savings_plan.lifecycle(
                int(arg_num(payload, "age", 30, "目前年齡", integer=True, lo=0, hi=100)),
                int(arg_num(payload, "retire_age", 65, "退休年齡", integer=True, lo=1, hi=110)),
                int(arg_num(payload, "end_age", 90, "規劃領到幾歲", integer=True, lo=2, hi=120)),
                initial,
                arg_num(payload, "monthly", 20000, "每月投入", lo=0, hi=1e9),
                arg_num(payload, "accum_pct", 8, "累積期報酬率", lo=-50, hi=100),
                arg_num(payload, "retire_pct", 4, "退休後報酬率", lo=-50, hi=100),
                arg_num(payload, "inflation_pct", 2, "通膨率", lo=-10, hi=50),
            )
        raise ValueError("kind 需為 grow、target 或 life")
