"""AI 解讀可以只勾選部分面向（價格、籌碼、基本面、財報、新聞、大盤）：交集、忽略未知名稱、全部不認得時退回預設。"""

import unittest
from unittest.mock import patch

from src.ai import ai_client, ai_context
from src.market import chart_data


class PickSectionsTests(unittest.TestCase):
    def test_no_aspects_uses_default(self):
        self.assertEqual(ai_context.pick_sections("stock"), ai_context.SECTIONS_BY_MODULE["stock"])
        self.assertEqual(ai_context.pick_sections("stock", None), ai_context.SECTIONS_BY_MODULE["stock"])

    def test_intersection_keeps_module_order(self):
        self.assertEqual(ai_context.pick_sections("stock", ["news", "price"]), ("price", "news"))

    def test_unknown_or_other_module_names_ignored(self):
        # mod2 沒有 chips：就算前端送了也不會多抓
        self.assertEqual(ai_context.pick_sections("mod2", ["chips", "news"]), ("news",))
        self.assertEqual(ai_context.pick_sections("stock", ["price", "bogus"]), ("price",))

    def test_empty_or_all_unknown_falls_back_to_default(self):
        base = ai_context.SECTIONS_BY_MODULE["stock"]
        self.assertEqual(ai_context.pick_sections("stock", []), base)
        self.assertEqual(ai_context.pick_sections("stock", ["bogus"]), base)
        self.assertEqual(ai_context.pick_sections("stock", "price"), base)

    def test_unknown_module_is_empty(self):
        self.assertEqual(ai_context.pick_sections("nope", ["price"]), ())


class PreviewTests(unittest.TestCase):
    def test_marks_missing_sections_and_flattens(self):
        fake = {"名稱": "台積電", "價格走勢": {"現價": 100, "趨勢": "多頭"}, "籌碼面": {"資料不足": "沒有資料"},
                "基本面與評價": {}, "財報與市場預期": {"季": [{"a": 1}]}, "近期新聞與公告": [{"標題": "消息一"}], "大盤環境": None}
        with patch.object(ai_context, "build", return_value=fake):
            out = ai_context.preview("2330", "stock")
        by = {s["key"]: s for s in out["sections"]}
        self.assertEqual(out["name"], "台積電")
        self.assertTrue(by["price"]["ok"])
        self.assertEqual(by["price"]["facts"]["現價"], "100")
        self.assertFalse(by["chips"]["ok"])
        self.assertEqual(by["chips"]["why"], "沒有資料")
        self.assertFalse(by["fundamentals"]["ok"])
        self.assertFalse(by["market"]["ok"])
        self.assertEqual(by["news"]["facts"]["1"], "消息一")

    def test_empty_symbol_does_not_fetch(self):
        with patch.object(ai_context, "build") as b:
            out = ai_context.preview("", "stock")
        b.assert_not_called()
        self.assertTrue(all(not s["ok"] for s in out["sections"]))


def _fake_chart(n=3):
    day = 1762387200
    return {"meta": {"gmtoffset": 28800}, "timestamp": [day + i * 900 for i in range(n)],
            "indicators": {"quote": [{"close": [10 + i for i in range(n)], "volume": [5] * n}]}}


class QuestionPromptTests(unittest.TestCase):
    profile = {"type": "gemini", "api_key": "x", "model": "m"}

    def build(self, question):
        with patch.object(ai_client, "is_enabled", return_value=True):
            return ai_client._build_explain_prompt(self.profile, "stock", {"code": "2330"}, question)[0]

    def test_question_gets_direct_answer_not_fixed_report(self):
        user = self.build("估值貴不貴？")
        self.assertIn("【使用者想問】估值貴不貴？", user)
        self.assertIn("第一句就正面回答", user)
        self.assertNotIn("【部位建議】", user)  # 固定報告的段落不能出現
        self.assertNotIn("請直接從下面的骨架開始寫", user)

    def test_every_ai_page_answers_the_question(self):
        for module in ai_client.MODULE_TASKS:
            with self.subTest(module=module), patch.object(ai_client, "is_enabled", return_value=True):
                q = f"問題-{module}"
                user = ai_client._build_explain_prompt(self.profile, module, {"symbol": "2330"}, q)[0]
                self.assertIn(q, user)
                self.assertNotIn("骨架", user)
                report = ai_client._build_explain_prompt(self.profile, module, {"symbol": "2330"}, "")[0]
                self.assertIn("骨架", report)

    def test_every_ai_answer_asks_for_1000_to_1500_chars(self):
        for module in ai_client.MODULE_TASKS:
            with self.subTest(module=module), patch.object(ai_client, "is_enabled", return_value=True):
                for q in ("", "估值貴不貴？"):
                    user = ai_client._build_explain_prompt(self.profile, module, {"symbol": "2330"}, q)[0]
                    self.assertIn("1000～1500 字", user)

    def test_claude_output_limit_fits_1500_chinese_chars(self):
        self.assertGreaterEqual(ai_client.MAX_OUTPUT_TOKENS, 3000)

    def test_different_questions_produce_different_prompts(self):
        self.assertNotEqual(self.build("估值貴不貴？"), self.build("法人最近在買還是賣？"))

    def test_blank_question_writes_full_report(self):
        for q in ("", "   "):
            user = self.build(q)
            self.assertIn("【部位建議】", user)
            self.assertIn("請直接從下面的骨架開始寫", user)
            self.assertNotIn("【使用者想問】", user)


class TechIndicatorsTests(unittest.TestCase):
    def test_reads_values_from_snapshot_indicators(self):
        snap = {"latest_date": "2026-11-09", "trend_score": {"total": 39, "signal_label": "觀望"},
                "indicators": {"RSI14": 41.5, "MA5": 100.0, "MA20": 110.0, "MA60": 120.0, "ATR14": 3.2,
                               "MACD_DIF": -1.1, "MACD_SIGNAL": -0.9, "MACD_HIST": -0.2},
                "recent_low_20d": 95.0, "recent_high_20d": 125.0}
        with patch.object(ai_context, "DualMarketDataAdapter") as adapter:
            adapter.return_value.build_technical_snapshot.return_value = snap
            out = ai_context.tech_indicators("2330")
        self.assertEqual(out["RSI14"], 41.5)
        self.assertEqual(out["MA20"], 110.0)
        self.assertEqual(out["ATR14"], 3.2)
        self.assertIn("DIF -1.1", out["MACD"])
        self.assertEqual(out["支撐(20日低)"], 95.0)


class SparkMissTests(unittest.TestCase):
    def test_failed_symbol_is_not_requested_again_within_ttl(self):
        sym = "NOSUCHSPARK"
        with patch.object(chart_data, "_yahoo_symbols", return_value=[sym]),                 patch.object(chart_data, "_chart", side_effect=RuntimeError("404")) as chart:
            self.assertEqual(chart_data._spark_one(sym), [])
            self.assertEqual(chart_data._spark_one(sym), [])
        self.assertEqual(chart.call_count, 1)


class FiveDaysTests(unittest.TestCase):
    def test_returns_points(self):
        with patch.object(chart_data, "_chart", return_value=_fake_chart()):
            out = chart_data.five_days("FD-OK")
        self.assertEqual(len(out["points"]), 3)
        self.assertEqual(out["points"][0]["close"], 10)
        self.assertTrue(out["days"])

    def test_failure_reports_error_without_fake_numbers(self):
        with patch.object(chart_data, "_chart", side_effect=RuntimeError("斷線")):
            out = chart_data.five_days("FD-ERR")
        self.assertEqual(out["points"], [])
        self.assertIn("斷線", out["error"])


if __name__ == "__main__":
    unittest.main()
