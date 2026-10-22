"""輸入錯誤回白話訊息、查無代號不誤導（離線，不連網）。"""

import unittest
from unittest.mock import patch

from src import chip_data, stock_info
from src.api_server import TradingEngineDispatcher, arg_num, arg_ticker


class ArgParsingTests(unittest.TestCase):
    def test_arg_num(self):
        self.assertEqual(arg_num({"n": "12"}, "n", 5, "數量", integer=True), 12)
        self.assertEqual(arg_num({"n": ""}, "n", 5, "數量"), 5)  # 空白用預設
        self.assertEqual(arg_num({}, "n", 5, "數量"), 5)
        with self.assertRaises(ValueError) as cm:
            arg_num({"n": "abc"}, "n", 5, "K 棒數量")
        self.assertIn("「K 棒數量」必須是數字（收到「abc」）", str(cm.exception))
        with self.assertRaises(ValueError) as cm:
            arg_num({"d": 2}, "d", 0.6, "手續費折數", lo=0, hi=1)
        self.assertIn("0～1", str(cm.exception))

    def test_arg_ticker(self):
        self.assertEqual(arg_ticker({"ticker": " nvda "}, "ticker"), "nvda")
        self.assertEqual(arg_ticker({}, "ticker"), "2330.TW")  # 沒帶欄位才用預設
        with self.assertRaises(ValueError) as cm:
            arg_ticker({"ticker": "  "}, "ticker")
        self.assertIn("請輸入股票代號", str(cm.exception))

    def test_backtest_rejects_fast_not_less_than_slow(self):
        d = TradingEngineDispatcher.__new__(TradingEngineDispatcher)
        with self.assertRaises(ValueError) as cm:
            d.handle_mod3_backtest({"ticker": "2330", "fast_ma": 30, "slow_ma": 10})
        self.assertIn("長均線週期（10）必須大於短均線週期（30）", str(cm.exception))


class UnknownSymbolTests(unittest.TestCase):
    def test_stock_info_unknown_symbol_raises(self):
        q = {"symbol": "ZZZZ9", "is_live": False, "error": "Yahoo Finance 連線失敗: HTTP Error 404: Not Found"}
        with patch.object(stock_info, "_quote", return_value=q):
            with self.assertRaises(ValueError) as cm:
                stock_info.stock_info("ZZZZ9")
        self.assertIn("查無 ZZZZ9 的資料", str(cm.exception))

    def test_chips_non_tw_says_not_tw_code(self):
        r = chip_data.chips("ZZZZ9")
        self.assertFalse(r["supported"])
        self.assertIn("不是台股代號", r["reason"])

    def test_chips_tw_code_without_any_data_is_marked_empty(self):
        chip_data._CACHE.clear()
        with patch.object(chip_data, "_finmind", return_value=[]):
            r = chip_data.chips("9999")
        chip_data._CACHE.clear()
        self.assertTrue(r["empty"])
        self.assertIn("查無 9999 的籌碼資料", r["reason"])


if __name__ == "__main__":
    unittest.main()
