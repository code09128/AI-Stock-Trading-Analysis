"""缺資料不能被包裝成正常判斷：趨勢評分標出缺的維度、AI 決策摘要列出抓不到的面向、事件前漲幅不足時不當成 0%（全部離線）。"""

import unittest
from unittest.mock import patch

from src.ai import ai_context
from src.news.news_strategy import NewsStrategyAnalyzer
from src.technical.trend_score import score_trend


def _wavy_up(n):
    """緩漲但有回檔，RSI 不會衝到 80、離 MA5 不會太遠。"""
    return [100 + i * 0.3 + (1.5 if i % 2 else -1.5) for i in range(n)]


class TrendScoreMissingTests(unittest.TestCase):
    def test_full_history_has_no_missing(self):
        r = score_trend(_wavy_up(80), [1000.0] * 80)
        self.assertEqual(r["missing"], [])
        self.assertEqual(r["missing_note"], "")

    def test_only_macd_missing_is_reported_but_not_blocking(self):
        r = score_trend(_wavy_up(30), [1000.0] * 30)
        self.assertEqual(r["missing"], ["macd"])
        self.assertIn("MACD", r["missing_note"])
        self.assertFalse(any("資料不足" in x for x in r["hard_rules"]))

    def test_two_or_more_missing_blocks_buy(self):
        r = score_trend(_wavy_up(12), [1000.0] * 12)
        self.assertEqual(set(r["missing"]), {"trend", "macd", "rsi"})
        self.assertTrue(r["buy_blocked"])
        self.assertTrue(any("3 項資料不足" in x for x in r["hard_rules"]))
        self.assertNotIn(r["signal"], ("BUY", "STRONG_BUY"))
        self.assertEqual(sum(r["breakdown"].values()), r["total"])  # 缺的仍給中間分，不扣分

    def test_support_without_ma10_is_neutral_and_missing(self):
        r = score_trend(_wavy_up(8), [1000.0] * 8)
        self.assertIn("support", r["missing"])
        self.assertEqual(r["breakdown"]["support"], 5)
        self.assertIn("均線支撐", r["missing_note"])

    def test_partial_session_volume_is_not_missing(self):
        r = score_trend(_wavy_up(60), [1000.0] * 59 + [10.0], partial_session=True)
        self.assertNotIn("volume", r["missing"])


class SummaryMissingTests(unittest.TestCase):
    def test_failed_sections_are_listed_for_ai(self):
        built = {
            "價格走勢": {"報酬率%": {"5日": 1, "20日": 2, "60日": 3, "120日": 4}, "距52週高點%": -5, "距52週低點%": 20},
            "籌碼面": {"說明": "2330 籌碼暫時抓不到"},
            "基本面與評價": {"資料不足": "連線逾時"},
            "大盤環境": {"資料不足": "Yahoo 回傳錯誤"},
            "近期新聞與公告": [],
        }
        with patch.object(ai_context, "build", return_value=built), \
                patch.object(ai_context.valuation, "brief", return_value=""), \
                patch.object(ai_context.analyst, "brief", return_value=""), \
                patch.object(ai_context.econ_calendar, "brief", return_value=""):
            text = ai_context.summary_lines("2330")
        self.assertIn("本次缺少的資料", text)
        self.assertIn("基本面與評價（連線逾時）", text)
        self.assertIn("大盤環境（Yahoo 回傳錯誤）", text)
        self.assertIn("近期新聞與公告（這次沒有抓到相關新聞）", text)
        self.assertIn("價格位置", text)

    def test_nothing_missing_adds_no_gap_line(self):
        built = {"價格走勢": {"報酬率%": {}}, "大盤環境": {"趨勢": "多頭"},
                 "近期新聞與公告": [{"標題": "某公司公告"}]}
        with patch.object(ai_context, "build", return_value=built), \
                patch.object(ai_context.valuation, "brief", return_value=""), \
                patch.object(ai_context.analyst, "brief", return_value=""), \
                patch.object(ai_context.econ_calendar, "brief", return_value=""):
            self.assertNotIn("本次缺少的資料", ai_context.summary_lines("2330"))


class YearRangeTests(unittest.TestCase):
    def _feed(self, n):
        from src.market.bar import Bar
        bars = [Bar(f"2026-01-{i + 1:03d}", 100, 101 + i * 0.1, 99, 100 + i * 0.1, 1000) for i in range(n)]
        return {"bars": bars, "currency": "TWD"}

    def test_short_history_says_52w_is_partial(self):
        with patch.object(ai_context.DualMarketDataAdapter, "fetch_bars", return_value=self._feed(40)):
            r = ai_context.price_action("6999")
        self.assertIn("近 40 個交易日", r["52週高低點涵蓋"])

    def test_full_year_has_no_note(self):
        with patch.object(ai_context.DualMarketDataAdapter, "fetch_bars", return_value=self._feed(260)):
            self.assertIsNone(ai_context.price_action("2330")["52週高低點涵蓋"])


class PricedInMissingTests(unittest.TestCase):
    def test_missing_returns_do_not_claim_not_priced_in(self):
        r = NewsStrategyAnalyzer().evaluate_priced_in_risk("利多", None, None)
        self.assertFalse(r["priced_in_risk"])
        self.assertIn("資料不足", r["analysis_note"])
        self.assertIsNone(r["ret_20d_pct"])


if __name__ == "__main__":
    unittest.main()
