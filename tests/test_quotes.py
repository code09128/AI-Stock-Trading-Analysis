import unittest
from unittest.mock import patch

from src.market import quote_provider as qp
from src.market.data_adapter import DualMarketDataAdapter

MIS_ROW = {
    "c": "2330", "z": "2405.0000", "y": "2420.0000", "o": "2400.0000", "h": "2415.0000",
    "l": "2395.0000", "v": "16995", "u": "2660.0000", "w": "2180.0000",
    "a": "2405.0000_2410.0000_", "f": "100_200_", "b": "2400.0000_2395.0000_", "g": "300_100_",
    "d": "20261020", "t": "13:30:00",
}


class QuoteProviderTests(unittest.TestCase):
    def setUp(self):
        qp._CACHE.clear()

    def test_normalize_bond_etf_code(self):
        n = DualMarketDataAdapter.normalize_symbol("00849B")
        self.assertEqual((n["market"], n["raw_code"]), ("TW", "00849B"))

    def test_tw_quote_parsing(self):
        with patch.object(qp, "_http_json", return_value={"msgArray": [MIS_ROW]}):
            q = qp.get_quotes(["2330"], {"2330.TW": "台積電"})[0]
        self.assertTrue(q["is_live"])
        self.assertEqual(q["price"], 2405.0)
        self.assertEqual(q["change"], -15.0)
        self.assertEqual(q["change_pct"], -0.62)
        self.assertEqual(q["bid_ask_ratio"], 57.1)  # 400 / (400 + 300)
        self.assertEqual(q["limit_up"], 2660.0)

    def test_failure_is_loud_not_faked(self):
        with patch.object(qp, "_http_json", side_effect=OSError("boom")):
            q = qp.get_quotes(["2330"], {})[0]
        self.assertFalse(q["is_live"])
        self.assertIn("boom", q["error"])
        self.assertIsNone(q.get("price"))


if __name__ == "__main__":
    unittest.main()


class EtfDataTests(unittest.TestCase):
    def setUp(self):
        from src.market import etf_data
        etf_data._CACHE.clear()
        self.ed = etf_data

    def test_aum_and_rank_from_registry(self):
        reg = {"0050": {"基金簡稱": "元大台灣50", "基金類型": "國內成分證券指數股票型基金", "發行單位數/轉換數": "1000000000"}}
        with patch.object(self.ed, "fund_registry", return_value=reg), patch.object(
            self.ed, "savings_plan_rank", return_value={"0050": 123}
        ):
            rows = self.ed.build_etf_rows(["0050", "9999"], {"0050": {"price": 100.0}})
        self.assertEqual(rows[0]["aum_billion"], 1000.0)  # 1e9 單位 × 100 元 / 1e8
        self.assertEqual(rows[0]["savings_plan_accounts"], 123)
        self.assertIsNone(rows[1]["aum_billion"])  # 查無資料不填假數字

    def test_lookthrough_uses_live_holdings(self):
        from src.portfolio.portfolio_risk import PortfolioRiskManager
        mgr = PortfolioRiskManager(etf_holdings={"0050": {"2330": 0.5}})
        res = {"holdings": [{"symbol": "0050", "weight_pct": 40.0}]}
        self.assertEqual(mgr.calculate_lookthrough_exposure(res)["2330"], 20.0)


class ChartDataTests(unittest.TestCase):
    def test_intraday_parsing_and_failure(self):
        from src.market import chart_data
        chart_data._CACHE.clear()
        fake = {
            "meta": {"chartPreviousClose": 100.0, "gmtoffset": 28800, "fiftyTwoWeekHigh": 120,
                     "fiftyTwoWeekLow": 80, "currentTradingPeriod": {"regular": {"start": 1000, "end": 2000}}},
            "timestamp": [1000, 1300],
            "indicators": {"quote": [{"close": [101.0, None], "volume": [5, 6]}]},
        }
        with patch.object(chart_data, "_chart", return_value=fake):
            d = chart_data.intraday("2330")
        self.assertEqual(len(d["points"]), 1)  # None 的收盤價被略過
        self.assertEqual(d["prev_close"], 100.0)
        self.assertEqual(d["week52_high"], 120)
        chart_data._CACHE.clear()
        with patch.object(chart_data, "_chart", side_effect=OSError("down")):
            bad = chart_data.intraday("2330")
        self.assertEqual(bad["points"], [])
        self.assertIn("down", bad["error"])


class WeeklyNewsStressTests(unittest.TestCase):
    def test_weekly_aggregation(self):
        from src.server.api_server import to_weekly_bars
        from src.market.bar import Bar
        days = [Bar("2026-10-19", 10, 12, 9, 11, 100), Bar("2026-10-20", 11, 15, 10, 14, 200),
                Bar("2026-10-26", 14, 16, 13, 15, 50)]
        w = to_weekly_bars(days)
        self.assertEqual(len(w), 2)
        self.assertEqual((w[0].open, w[0].high, w[0].low, w[0].close, w[0].volume), (10, 15, 9, 14, 300))
        self.assertEqual(w[0].timestamp, "2026-10-20")  # 該週最後一個交易日

    def test_news_source_failure_is_reported_not_faked(self):
        from src.news import news_feed
        news_feed._CACHE.clear()
        with patch.object(news_feed, "_google_news", side_effect=OSError("rss down")), patch.object(
            news_feed, "_twse_material", return_value=[]
        ):
            r = news_feed.fetch_news("2330", "台積電")
        self.assertEqual(r["items"], [])
        self.assertTrue(any("rss down" in e for e in r["errors"]))

    def test_event_price_context_uses_only_known_prices(self):
        from src.server.api_server import DISPATCHER
        from src.market.bar import Bar
        from datetime import date, timedelta
        bars = [Bar((date(2026, 8, 1) + timedelta(i)).isoformat(), 100, 100, 100, 100 + i, 1) for i in range(60)]
        pre = DISPATCHER._price_context(bars, "2026-09-20T08:00:00", "PRE")
        self.assertEqual(pre["as_of_bar"], "2026-09-19")        # 盤前發布：看不到當天收盤
        post = DISPATCHER._price_context(bars, "2026-09-20T15:00:00", "POST")
        self.assertEqual(post["as_of_bar"], "2026-09-20")        # 盤後發布：已知當天收盤

    def test_historical_stress_math(self):
        from src.portfolio import stress
        up_then_down = {f"2026-01-{d:02d}": float(v) for d, v in zip(range(1, 29), [100] * 14 + [50] * 14)}
        feb = {f"2026-02-{d:02d}": 50.0 for d in range(1, 29)}
        series = {**up_then_down, **feb}
        with patch.object(stress, "_closes", return_value=series):
            r = stress.historical_stress([{"symbol": "X", "market": "TW", "shares": 10}], 32.0)
        self.assertTrue(r["available"])
        self.assertEqual(r["max_drawdown_pct"], -50.0)
