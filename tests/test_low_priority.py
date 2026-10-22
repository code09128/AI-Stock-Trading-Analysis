"""低優先 9～15：匯率回退、交易日曆、時段、失效條件、時區後備、債券 ETF（離線，不連網）。"""

import unittest
from datetime import date, datetime, timedelta, timezone
from unittest.mock import patch

from src import data_adapter, fx, market_calendar
from src.api_server import mark_bond_snapshot
from src.data_adapter import DualMarketDataAdapter
from src.news_strategy import NewsStrategyAnalyzer
from src.tz import NewYorkRules, TAIPEI_FIXED


class FxFallbackTests(unittest.TestCase):
    def setUp(self):
        fx.clear_cache()

    def tearDown(self):
        fx.clear_cache()

    def test_last_known_then_default(self):
        a = DualMarketDataAdapter()
        fx._LAST["USD"] = {"rate": 32.5, "at": "10/22 09:00"}
        with patch("urllib.request.urlopen", side_effect=OSError("offline")):
            r = a.fetch_usd_twd_rate()
        self.assertEqual((r["usd_twd"], r["source"]), (32.5, "LAST_KNOWN_FX"))
        self.assertIn("沿用 10/22 09:00", r["warning"])
        fx.clear_cache()
        with patch("urllib.request.urlopen", side_effect=OSError("offline")):
            r = a.fetch_usd_twd_rate()
        self.assertEqual(r["source"], "FALLBACK_DEFAULT")
        self.assertIn("32.15", r["warning"])

    def test_pence_and_unavailable_currency(self):
        fx._CACHE["GBP"] = {"t": 9e18, "rate": 43.75}
        r = fx.rate_to_twd("GBp")
        self.assertAlmostEqual(r["rate"], 0.4375)
        with patch("urllib.request.urlopen", side_effect=OSError("offline")):
            r = fx.rate_to_twd("HKD")
        self.assertIsNone(r["rate"])  # 港幣沒有預設值，不亂猜
        self.assertIn("HKD", r["warning"])


class CalendarTests(unittest.TestCase):
    def test_nyse_2025_matches_official_calendar(self):
        got = {d.isoformat() for d in market_calendar.us_holidays(2025)}
        official = {"2025-01-01", "2025-01-20", "2025-02-17", "2025-04-18", "2025-05-26", "2025-06-19",
                    "2025-07-04", "2025-09-01", "2025-11-27", "2025-12-25"}
        self.assertEqual(got, official)

    def test_observed_rules(self):
        h = market_calendar.us_holidays(2026)
        self.assertIn(date(2026, 7, 3), h)  # 7/4 週六 → 週五
        self.assertNotIn(date(2021, 12, 31), market_calendar.us_holidays(2022))  # 元旦遇週六不提前

    def test_bars_decide_past_days(self):
        bars = ["2026-10-20", "2026-10-21", "2026-10-23"]
        self.assertEqual(market_calendar.trading_day("TW", date(2026, 10, 22), bars)[0], False)
        self.assertEqual(market_calendar.trading_day("TW", date(2026, 10, 21), bars)[0], True)
        self.assertEqual(market_calendar.trading_day("US", date(2026, 10, 24), bars),
                         (False, "週末休市"))

    def test_tw_official_schedule_excludes_first_trading_day(self):
        rows = [{"Name": "中華民國開國紀念日", "Date": "1150101"},
                {"Name": "國曆新年開始交易日", "Date": "1150102"},
                {"Name": "市場無交易，僅辦理結算交割作業", "Date": "1150212"}]
        market_calendar._TW_CACHE.update(t=0.0, days=None)
        with patch("src.quote_provider._http_json", return_value=rows):
            days = market_calendar.tw_holidays()
        market_calendar._TW_CACHE.update(t=0.0, days=None)
        self.assertEqual(days, {date(2026, 1, 1), date(2026, 2, 12)})


class NewsRuleTests(unittest.TestCase):
    def test_closed_session(self):
        a = NewsStrategyAnalyzer("TW")
        self.assertEqual(a.classify_market_session("2026-10-24T10:00:00"), "CLOSED")  # 週六
        self.assertEqual(a.classify_market_session("2026-10-26T10:00:00", (False, "證交所公告休市")), "CLOSED")
        self.assertEqual(a.classify_market_session("2026-10-22T10:00:00", (True, "")), "REGULAR")

    def test_vague_anchor_needs_price(self):
        v = NewsStrategyAnalyzer("TW").validate_invalidation_criteria
        self.assertFalse(v("日收盤跌破關鍵支撐價位或單日跌逾 3% 停損")["valid"])
        self.assertFalse(v("跌破重要支撐或單日跌逾 33% 出場")["valid"])  # 33% 不能被當成價位
        self.assertTrue(v("收盤跌破關鍵支撐 1020 元停損")["valid"])
        self.assertTrue(v("跌破 5 日低點出場")["valid"])
        self.assertFalse(v("感覺不對勁 3 次就賣")["valid"])


class TimezoneFallbackTests(unittest.TestCase):
    def test_new_york_rules_match_zoneinfo(self):
        from zoneinfo import ZoneInfo

        ref, ny = ZoneInfo("America/New_York"), NewYorkRules()
        t = datetime(2020, 1, 1, tzinfo=timezone.utc)
        while t.year < 2031:
            self.assertEqual(t.astimezone(ny).replace(tzinfo=None), t.astimezone(ref).replace(tzinfo=None), t)
            t += timedelta(hours=13)

    def test_taipei_fixed(self):
        t = datetime(2026, 10, 22, 1, 0, tzinfo=timezone.utc)
        self.assertEqual(t.astimezone(TAIPEI_FIXED).hour, 9)


class BondEtfTests(unittest.TestCase):
    def test_bond_marked_not_applicable(self):
        snap = {"trend_score": {"signal": "STRONG_BUY", "signal_label": "強烈買進"}}
        with patch("src.stock_info.classify", return_value={"category": "BOND"}):
            mark_bond_snapshot(snap, "00849B")
        self.assertEqual(snap["trend_score"]["signal"], "HOLD")
        self.assertIn("債券", snap["trend_score"]["not_applicable"])

    def test_stock_untouched(self):
        snap = {"trend_score": {"signal": "BUY", "signal_label": "買進"}}
        with patch("src.stock_info.classify", return_value={"category": "STOCK"}):
            mark_bond_snapshot(snap, "2330")
        self.assertEqual(snap["trend_score"]["signal"], "BUY")


if __name__ == "__main__":
    unittest.main()
