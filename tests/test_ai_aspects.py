"""AI 解讀可以只勾選部分面向（價格、籌碼、基本面、財報、新聞、大盤）：交集、忽略未知名稱、全部不認得時退回預設。"""

import unittest
from unittest.mock import patch

from src.ai import ai_context
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
