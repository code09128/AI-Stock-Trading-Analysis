"""存股計畫：公式對照規格截圖數字、反推與正推一致、報酬率統計、API 參數檢查（全部離線）。"""

import unittest
from datetime import date, timedelta
from unittest.mock import patch

from src.market.bar import Bar
from src.market.cache import TTLCache
from src.portfolio import savings_plan as sp
from src.server import dispatcher
from src.server.handlers import savings


def _series(years: float, annual_pct: float, start: date = date(2016, 1, 4)):
    """每個平日一筆、固定年化報酬的還權收盤價。"""
    out, d, end = [], start, start + timedelta(days=round(years * 365.25))
    while d <= end:
        if d.weekday() < 5:
            out.append({"date": d.isoformat(), "close": 100 * (1 + annual_pct / 100) ** ((d - start).days / 365.25)})
        d += timedelta(days=1)
    return out


class FormulaTests(unittest.TestCase):
    def test_grow_matches_spec_screenshot(self):
        """每月 5,000、年化 14.7%：3／5／10／15／20 年約 23／44／137／328／726 萬。"""
        rows = sp.grow_table(5000, 0, [14.7])
        self.assertEqual([round(r["values"][0] / 1e4) for r in rows], [23, 44, 137, 328, 726])
        self.assertEqual(rows[2]["principal"], 600000)

    def test_target_round_trip(self):
        for rate in (14.7, 9.9, 0):
            m = sp.required_monthly(1e6, rate, 120, initial=50000)
            self.assertAlmostEqual(sp.future_value(m, rate, 120, 50000), 1e6, places=4)
        # 與 S1 一致：每月 5,000 存 10 年有 137 萬，那 100 萬只要每月 3,655
        self.assertEqual(round(sp.required_monthly(1e6, 14.7, 120)), 3655)

    def test_initial_already_reaches_target(self):
        self.assertEqual(sp.required_monthly(1e6, 8, 120, initial=1e6), 0)

    def test_income_capital(self):
        self.assertEqual(round(sp.income_capital(30000, 2.49) / 1e4), 1446)
        self.assertIsNone(sp.income_capital(30000, 0))
        self.assertIsNone(sp.income_capital(30000, None))
        # 一次投入是反方向：1,446 萬 × 2.49% ÷ 12 ≈ 每月 3 萬
        self.assertAlmostEqual(sp.income_from_capital(sp.income_capital(30000, 2.49), 2.49), 30000)
        self.assertIsNone(sp.income_from_capital(1e6, 0))

    def test_lifecycle_spends_down_to_zero(self):
        r = sp.lifecycle(30, 65, 100, 500000, 20000, 8, 8, 2)
        self.assertEqual(r["principal"], 8_900_000)  # 50 萬＋2 萬 × 420 個月
        self.assertLess(abs(r["curve"][-1]["value"]), 1)
        self.assertAlmostEqual(r["monthly_payout_today"], r["monthly_payout"] / 1.02 ** 35, delta=1)
        self.assertEqual(r["curve"][0], {"age": 30, "value": 500000, "phase": "存"})
        self.assertEqual(r["curve"][35]["phase"], "領")

    def test_lifecycle_rejects_bad_ages(self):
        with self.assertRaises(ValueError):
            sp.lifecycle(65, 60, 90, 0, 1000, 8, 4, 2)


class SimulationCrossCheckTests(unittest.TestCase):
    """用逐月模擬（不用公式）驗證封閉公式：正推、反推、退休提領三個都要一致。"""

    @staticmethod
    def _simulate(initial, monthly, pct, months):
        bal = initial
        for _ in range(months):
            bal = (bal + monthly) * (1 + pct / 1200)  # 月初投入、月底計息
        return bal

    def test_formulas_match_month_by_month(self):
        for pct in (14.7, 8, 2.5, 0, -3):
            for months in (12, 120, 420):
                self.assertAlmostEqual(sp.future_value(5000, pct, months, 500000),
                                       self._simulate(500000, 5000, pct, months), delta=1e-6 * 1e9)
                m = sp.required_monthly(1e7, pct, months, 100000)
                if self._simulate(100000, 0, pct, months) >= 1e7:
                    self.assertEqual(m, 0)  # 光初期投入就超過目標
                else:
                    self.assertAlmostEqual(self._simulate(100000, m, pct, months), 1e7, delta=0.01)

    def test_payout_spends_exactly(self):
        for pct in (8, 4, 0):
            pay = sp.monthly_payout(1e7, pct, 300)
            bal = 1e7
            for _ in range(300):
                bal = (bal - pay) * (1 + pct / 1200)  # 月初提領
            self.assertAlmostEqual(bal, 0, delta=0.01)


class TotalReturnIndexTests(unittest.TestCase):
    def test_cash_dividend_reinvested(self):
        """除息日價格從 100 掉到 95、配 5 元：含息報酬是 0，不是 −5%。"""
        res = sp.total_return_index([{"date": "2024-01-02", "close": 100}, {"date": "2024-01-03", "close": 95}],
                                    [{"date": "2024-01-03", "cash": 5}])
        self.assertAlmostEqual(res["points"][-1]["close"], 1.0)

    def test_split_detected_and_restored(self):
        """0050 一拆四：189 → 47.25 不是跌 75%。"""
        res = sp.total_return_index([{"date": "2025-06-10", "close": 189}, {"date": "2025-06-18", "close": 47.25},
                                     {"date": "2025-06-19", "close": 49.14}], [])
        self.assertEqual(res["splits"], [{"date": "2025-06-18", "factor": 4}])
        self.assertAlmostEqual(res["points"][1]["close"], 1.0)
        self.assertAlmostEqual(res["points"][2]["close"], 1.04)

    def test_stock_dividend_and_missing_trading_day(self):
        """配股 0.1 股（除權後 110 → 100）不算下跌；除權息日沒有成交時套用到下一個交易日；上市前的配息不計。"""
        res = sp.total_return_index(
            [{"date": "2024-01-02", "close": 110}, {"date": "2024-01-05", "close": 100}],
            [{"date": "2023-07-01", "cash": 9}, {"date": "2024-01-04", "stock": 0.1}])
        self.assertAlmostEqual(res["points"][-1]["close"], 1.0)
        self.assertEqual(res["splits"], [])


class DividendDedupTests(unittest.TestCase):
    def test_same_announcement_day_keeps_both_periods(self):
        """股利政策同一天公告兩個期別：本機快取去重時兩筆都要留下，不然還原指數會少算一次配息。"""
        from src.market import finmind_store
        key = finmind_store._key("TaiwanStockDividend")
        a = {"date": "2025-03-10", "year": "113年第4季", "CashExDividendTradingDate": "2025-03-20"}
        b = {"date": "2025-03-10", "year": "114年第1季", "CashExDividendTradingDate": "2025-06-18"}
        self.assertNotEqual(key(a), key(b))
        self.assertEqual(key(a), key(dict(a)))


class ReturnStatsTests(unittest.TestCase):
    def test_constant_growth(self):
        st = sp.return_stats(_series(10, 10))
        self.assertAlmostEqual(st["cagr"], 10, delta=0.05)
        self.assertAlmostEqual(st["rolling_median"], 10, delta=0.05)
        self.assertAlmostEqual(st["rolling_p20"], 10, delta=0.05)
        self.assertAlmostEqual(st["total_3y"], 33.1, delta=0.2)

    def test_short_history_has_no_rolling(self):
        """上市不到 5 年：穩定／較差報酬率回 None，不硬算。"""
        st = sp.return_stats(_series(2, 10))
        self.assertIsNotNone(st["cagr"])
        self.assertIsNone(st["rolling_median"])
        self.assertIsNone(st["total_3y"])

    def test_avg_yield_uses_listed_years(self):
        today = date(2026, 10, 1)
        events = [{"ex_date": "2026-07-01", "cash": 1.0}, {"ex_date": "2025-07-01", "cash": 1.0},
                  {"ex_date": "2022-07-01", "cash": 9.0}]
        self.assertEqual(sp.avg_yield(events, 20, "2016-01-01", today)["yield_pct"], 3.33)  # 3 年 2 元
        two = sp.avg_yield(events, 20, "2024-10-01", today)
        self.assertEqual((two["years"], two["yield_pct"]), (2.0, 5.0))
        self.assertIsNone(sp.avg_yield(events, 20, "2026-03-01", today))


class PortfolioTests(unittest.TestCase):
    def test_blend_weights_and_cash(self):
        """A 年化 10%、B 0%、現金 0%，各 50／30／20：組合每天報酬約是 A 的一半。"""
        a, b = _series(6, 10), _series(6, 0)
        res = sp.blend_index({"A": a, "B": b}, {"A": 0.5, "B": 0.3}, 0.2)
        st = sp.portfolio_stats(res["points"])
        self.assertAlmostEqual(st["cagr"], 4.88, delta=0.1)  # (1.1^(1/252) − 1) × 0.5 每天複利
        self.assertEqual(res["starts"], {"A": a[0]["date"], "B": b[0]["date"]})
        self.assertEqual(st["drawdown"]["pct"], 0)

    def test_late_listing_is_filled_by_others(self):
        """B 晚 3 年上市：上市前整個組合 = A；上市後才分一半。"""
        a = _series(6, 10)
        b = _series(3, 0, date(2019, 1, 7))
        res = sp.blend_index({"A": a, "B": b}, {"A": 0.5, "B": 0.5})
        pts = {p["date"]: p["close"] for p in res["points"]}
        self.assertAlmostEqual(pts["2019-01-04"], 1.1 ** ((date(2019, 1, 4) - date(2016, 1, 4)).days / 365.25), places=3)
        self.assertEqual(res["starts"]["B"], "2019-01-07")

    def test_period_returns_and_volatility(self):
        pts = _series(6, 10)
        pr = sp.period_returns(pts)
        self.assertAlmostEqual(pr["1y"], 10, delta=0.1)
        self.assertAlmostEqual(pr["5y"], 61, delta=0.5)
        self.assertLess(sp.volatility(pts), 0.5)  # 固定成長只剩每月天數不同造成的微小差異
        self.assertIsNone(sp.period_returns(_series(0.5, 10))["1y"])
        swing = [{"date": f"2020-{m:02d}-01", "close": 100 if m % 2 else 110} for m in range(1, 13)] + \
                [{"date": f"2021-{m:02d}-01", "close": 100 if m % 2 else 110} for m in range(1, 13)]
        self.assertGreater(sp.volatility(swing), 20)
        dd = sp.max_drawdown(swing)
        self.assertAlmostEqual(dd["pct"], 9.09, delta=0.01)

    def test_xirr(self):
        self.assertAlmostEqual(sp.xirr([("2020-01-01", -100), ("2021-01-01", 110)]), 10, delta=0.05)
        self.assertIsNone(sp.xirr([("2020-01-01", -100)]))
        self.assertIsNone(sp.xirr([]))

    def test_dca_backtest_flat_and_growth(self):
        flat = _series(4, 0)
        r = sp.dca_backtest({"A": flat}, {"A": 1.0}, 0, 10000, 1000, 3)
        self.assertEqual(r["invested"], r["value"])
        self.assertEqual(r["invested"], 10000 + 1000 * 37)  # 第一天＋之後 36 個月初
        g = sp.dca_backtest({"A": _series(4, 10)}, {"A": 1.0}, 0, 0, 1000, 3)
        self.assertAlmostEqual(g["xirr_pct"], 10, delta=0.3)
        self.assertIsNone(sp.dca_backtest({"A": flat}, {"A": 1.0}, 0, 0, 1000, 10))  # 期間開始時還沒上市

    def test_ledger_matches_nanotou(self):
        """奈米投畫面：投資 123,500、市值 193,255、配息 10,656 → 56.48% 與 65.11%。"""
        r = sp.ledger([{"name": "奈米投", "invested": 123500, "value": 193255, "dividends": 10656,
                        "start": "2022-01-05"}], today=date(2026, 10, 31))
        row = r["rows"][0]
        self.assertEqual((row["return_pct"], row["return_with_div_pct"]), (56.48, 65.11))
        self.assertEqual(row["deposits"], 58)  # 2022-01 ～ 2026-10
        self.assertGreater(row["xirr_pct"], 20)
        self.assertEqual(r["total"]["pnl"], 69755)
        none = sp.ledger([{"invested": 100, "value": 120}], today=date(2026, 10, 31))["rows"][0]
        self.assertIsNone(none["xirr_pct"])
        self.assertEqual(sp._monthly_flows("2026-01-31", 300, date(2026, 3, 31))[1][0], "2026-02-28")


class HandlerTests(unittest.TestCase):
    def setUp(self):
        self.d = dispatcher.TradingEngineDispatcher()

    def test_portfolio_endpoint(self):
        """比例合計不是 100% 會換算；晚上市與取不到資料都要標示；每月投入照比例分配並估算零股。"""
        hist = {"0050": {"points": _series(6, 10), "source": "fake", "warning": None},
                "00697B": {"points": _series(3, 2, date(2019, 1, 7)), "source": "fake", "warning": None},
                "ZZZZ": {}}
        quotes = [{"symbol": "0050.TW", "name": "元大台灣50", "price": 100.0},
                  {"symbol": "00697B.TW", "name": "元大美債7-10", "price": 35.5}]
        with patch.object(savings.SavingsHandlers, "_points", side_effect=lambda self_, s: hist[s], autospec=True), \
                patch.object(savings.SavingsHandlers, "_benchmark_points", return_value=_series(6, 5)), \
                patch.object(savings.quote_provider, "get_quotes", return_value=quotes):
            r = self.d.handle_savings_portfolio({"items": [{"symbol": "0050", "weight": 60},
                                                           {"symbol": "00697b", "weight": 20},
                                                           {"symbol": "ZZZZ", "weight": 10}, {"symbol": "", "weight": 5}],
                                                 "cash": 10, "monthly": 1000, "initial": 10000})
        rows = {x["symbol"]: x for x in r["items"]}
        self.assertEqual(r["raw_total_pct"], 100)
        self.assertEqual(rows["0050"]["monthly_amount"], 600)
        self.assertEqual(rows["0050"]["est_shares"], 6)
        self.assertEqual(rows["00697B"]["est_shares"], 5)
        self.assertTrue(any("ZZZZ" in w for w in r["warnings"]))
        self.assertTrue(any("00697B 2019-01-07 起才有資料" in w for w in r["warnings"]))
        self.assertIsNotNone(r["stats"]["cagr"])
        self.assertAlmostEqual(r["benchmark"]["periods"]["1y"], 5, delta=0.1)
        self.assertEqual(set(r["chart"]), {"3m", "6m", "1y", "3y"})
        self.assertLessEqual(len(r["chart"]["3y"]), savings.CHART_POINTS + 1)
        self.assertEqual(r["chart"]["1y"][0]["port"], 0)
        self.assertEqual([b["years"] for b in r["backtest"]], [1, 3, 5])
        with self.assertRaises(ValueError):
            self.d.handle_savings_portfolio({"items": [{"symbol": "", "weight": 50}]})
        with self.assertRaises(ValueError):
            self.d.handle_savings_portfolio({"items": [{"symbol": "0050", "weight": "abc"}]})

    def test_ledger_kind(self):
        r = self.d.handle_savings_calc({"kind": "ledger", "rows": [{"name": "A", "invested": 100, "value": 150}]})
        self.assertEqual(r["total"]["return_pct"], 50)
        with self.assertRaises(ValueError):
            self.d.handle_savings_calc({"kind": "ledger", "rows": [{"invested": -1}]})

    def test_calc_kinds_and_validation(self):
        g = self.d.handle_savings_calc({"kind": "grow", "monthly": 5000, "rates": [14.7, 9.9], "years": 20})
        self.assertEqual(len(g["table"][0]["values"]), 2)
        self.assertEqual(len(g["curve"]), 21)
        t = self.d.handle_savings_calc({"kind": "target", "target": 1e6, "rates": [14.7]})
        self.assertEqual(t["table"][2]["monthly"], [3655])
        life = self.d.handle_savings_calc({"kind": "life", "age": 30, "retire_age": 65, "end_age": 90})
        self.assertGreater(life["monthly_payout"], 0)
        for bad in ({"kind": "grow", "rates": []}, {"kind": "x"}, {"kind": "grow", "rates": ["abc"]},
                    {"kind": "life", "age": 70, "retire_age": 65}):
            with self.assertRaises(ValueError):
                self.d.handle_savings_calc(bad)

    def _fm(self, price_rows, div_rows=()):
        """假的 finmind_store.history：依資料集回傳本機假資料。"""
        def history(dataset, code, start):
            rows = price_rows if dataset == "TaiwanStockPrice" else list(div_rows)
            return {"rows": rows, "source": "cache", "stale": False, "error": None}
        return history

    def test_returns_tw_uses_finmind_full_history(self):
        """台股：FinMind 上市以來日 K＋除權息自行還原；未還權價格持平、每年配 5%，含息報酬約 5%。"""
        start = date(2008, 1, 2)
        prices = [{"date": p["date"], "close": 100.0} for p in _series(18, 0, start)]
        years = sorted({p["date"][:4] for p in prices})[1:]
        div_rows = [{"CashEarningsDistribution": 5.0, "CashExDividendTradingDate": f"{y}-07-15"} for y in years]
        quote = {"symbol": "0056.TW", "name": "元大高股息", "price": 100.0}
        with patch.object(savings.finmind_store, "history", side_effect=self._fm(prices, div_rows)), \
                patch.object(self.d.adapter, "fetch_bars") as yahoo, \
                patch.object(savings.quote_provider, "get_quotes", return_value=[quote]), \
                patch.object(savings.stock_info, "_dividends_yahoo", return_value=[]), \
                patch.object(savings.etf_data, "_CACHE", TTLCache()):
            r = self.d.handle_savings_returns({"symbol": "0056"})
        yahoo.assert_not_called()
        self.assertAlmostEqual(r["cagr"], 5, delta=0.3)
        self.assertAlmostEqual(r["rolling_median"], 5, delta=0.3)
        self.assertEqual(r["first_date"], prices[0]["date"])
        self.assertIn("FinMind", r["data_source"])
        self.assertGreaterEqual(r["rolling_from"], (date.fromisoformat(prices[-1]["date"]) - timedelta(days=15 * 366)).isoformat())

    def test_returns_offline(self):
        """FinMind 取不到時退回 Yahoo 近 10 年，並標示警告。"""
        start = date(2016, 1, 4)
        bars = [Bar(timestamp=p["date"], open=p["close"], high=p["close"], low=p["close"], close=p["close"],
                    volume=1) for p in _series(10, 8, start)]
        feed = {"data_source": "LIVE_YAHOO_FINANCE", "bars": bars}
        quote = {"symbol": "0050.TW", "name": "元大台灣50", "price": 200.0}
        divs = [{"ex_date": (date.today() - timedelta(days=100)).isoformat(), "cash": 6.0}]
        with patch.object(savings.finmind_store, "history", side_effect=RuntimeError("FinMind 暫停")), \
                patch.object(self.d.adapter, "fetch_bars", return_value=feed), \
                patch.object(savings.quote_provider, "get_quotes", return_value=[quote]), \
                patch.object(savings.stock_info, "_dividends_yahoo", return_value=divs), \
                patch.object(savings.etf_data, "_CACHE", TTLCache()):
            r = self.d.handle_savings_returns({"symbol": "0050"})
        self.assertAlmostEqual(r["cagr"], 8, delta=0.05)
        self.assertEqual(r["ttm_yield_pct"], 3.0)
        self.assertEqual(r["avg_yield_pct"], 1.0)  # 3 年只配 6 元
        self.assertEqual(r["frequency"], "年配")
        self.assertIn("只用近 10 年", r["warning"])
        with patch.object(savings.finmind_store, "history", side_effect=RuntimeError("FinMind 暫停")), \
                patch.object(self.d.adapter, "fetch_bars", return_value=feed), \
                patch.object(savings.quote_provider, "get_quotes", return_value=[quote]), \
                patch.object(savings.stock_info, "_dividends_yahoo", return_value=divs), \
                patch.object(savings.etf_data, "fund_registry", return_value={}), \
                patch.object(savings, "HIGH_DIVIDEND_POOL", []), \
                patch.object(savings.etf_data, "_CACHE", TTLCache()):
            d = self.d.handle_savings_dividends({"lump_sum": 1.2e6, "symbols": ["0050"]})
        self.assertEqual(d["rows"][0]["monthly_from_lump"], 1000)  # 120 萬 × 1% ÷ 12
        self.assertNotIn("capital_needed", d["rows"][0])

    def test_returns_unknown_symbol(self):
        with patch.object(savings.quote_provider, "get_quotes", return_value=[{"error": "查無此代號"}]):
            with self.assertRaises(ValueError):
                self.d.handle_savings_returns({"symbol": "ZZZZ"})


if __name__ == "__main__":
    unittest.main()
