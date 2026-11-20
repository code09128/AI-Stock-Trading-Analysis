"""AI 資料面向「分析師與持股結構」與大盤環境的經濟事件（ai_context）：全部離線。"""

import unittest
from unittest import mock

from src.ai import ai_context


class StreetSectionTests(unittest.TestCase):
    def test_both_briefs(self):
        with mock.patch.object(ai_context.analyst, "brief", return_value="分析師共識：A"), \
                mock.patch.object(ai_context.ownership, "brief", return_value="持股結構：B"):
            d = ai_context.street("NVDA")
        self.assertEqual(d, {"分析師共識": "分析師共識：A", "持股結構與內部人": "持股結構：B"})

    def test_none_is_marked_missing(self):
        with mock.patch.object(ai_context.analyst, "brief", return_value=""), \
                mock.patch.object(ai_context.ownership, "brief", return_value=""):
            self.assertIn("資料不足", ai_context.street("6488"))

    def test_in_stock_and_mod1_sections_with_label(self):
        for m in ("stock", "mod1"):
            self.assertIn("street", ai_context.SECTIONS_BY_MODULE[m])
        self.assertNotIn("street", ai_context.SECTIONS_BY_MODULE["mod2"])
        with mock.patch.object(ai_context.stock_info, "_quote", return_value={"name": "輝達"}), \
                mock.patch.object(ai_context, "street", return_value={"分析師共識": "x"}):
            out = ai_context.build("NVDA", ("street",))
        self.assertEqual(out["分析師與持股結構"], {"分析師共識": "x"})

    def test_preview_lists_street(self):
        with mock.patch.object(ai_context, "build", return_value={"名稱": "輝達", "分析師與持股結構": {"分析師共識": "x"}}):
            p = ai_context.preview("NVDA", "stock")
        sec = next(s for s in p["sections"] if s["key"] == "street")
        self.assertTrue(sec["ok"])
        self.assertEqual(sec["label"], "分析師與持股結構")
