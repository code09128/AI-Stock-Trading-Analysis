"""台股盤前／試撮報價（quote_provider.fetch_tw_quotes）：用 2026-11-20 08:31 實測的證交所回應，全部離線。"""

import unittest
from datetime import datetime
from unittest import mock

from src.market import quote_provider as qp
from src.market.data_adapter import DualMarketDataAdapter
from src.market.tz import zone

TPE = zone("Asia/Taipei")
# 08:33 試撮中：z 沒有成交、pz 是試撮價、ps 是試撮量、ts="1"
TRIAL = {"c": "2330", "n": "台積電", "z": "-", "pz": "2075.0000", "ps": "788", "ts": "1", "y": "2100.0000", "v": "0",
         "a": "2075.0000_2080.0000_", "f": "1_16_", "b": "2070.0000_2065.0000_", "g": "12_2_",
         "d": "20261120", "t": "08:33:06", "u": "2310.0000", "w": "1890.0000"}
# 盤中：z 偶爾是「-」，pz 是最近一筆成交，照舊使用
LIVE_DASH = {**TRIAL, "ts": "0", "z": "-", "pz": "2110.0000", "t": "10:00:00"}
LIVE = {**TRIAL, "ts": "0", "z": "2120.0000", "pz": "2115.0000", "t": "10:00:05"}
# 收盤前試撮：已經有成交（z），試撮價另外給
CLOSING_TRIAL = {**TRIAL, "ts": "1", "z": "2090.0000", "pz": "2085.0000", "t": "13:26:00"}


def _quote(row, now=None):
    n = DualMarketDataAdapter.normalize_symbol("2330")
    with mock.patch.object(qp, "_mis_batch", return_value={"rows": {row["c"]: row} if row else {}, "error": None}), \
            mock.patch.object(qp, "tw_pre_open", return_value=bool(now and now.hour < 9)):
        return qp.fetch_tw_quotes([n], {})[n["symbol"]]


class TrialTests(unittest.TestCase):
    def test_pre_open_trial_is_not_a_trade(self):
        q = _quote(TRIAL)
        self.assertIsNone(q["price"])
        self.assertFalse(q["is_live"])  # 提醒、持股、技術分析只看 is_live／price，不會用到試撮價
        self.assertTrue(q["price_is_trial"])
        self.assertFalse(q["price_is_mid"])  # 試撮時不要再算買賣中間價
        self.assertEqual((q["trial_price"], q["trial_change"], q["trial_change_pct"], q["trial_volume"]), (2075.0, -25.0, -1.19, 788))
        self.assertEqual(q["prev_close"], 2100.0)
        self.assertEqual(len(q["bids"]), 2)

    def test_closing_trial_keeps_last_trade(self):
        q = _quote(CLOSING_TRIAL)
        self.assertEqual(q["price"], 2090.0)
        self.assertTrue(q["is_live"])
        self.assertEqual(q["trial_price"], 2085.0)

    def test_normal_session_unchanged(self):
        self.assertEqual(_quote(LIVE)["price"], 2120.0)
        q = _quote(LIVE_DASH)
        self.assertEqual(q["price"], 2110.0)  # 盤中 z 是「-」時照舊用 pz
        self.assertFalse(q["price_is_trial"])
        self.assertIsNone(q["trial_price"])


class PreOpenMissingTests(unittest.TestCase):
    def test_blank_before_open_is_notice_not_error(self):
        q = _quote(None, now=datetime(2026, 11, 20, 7, 56, tzinfo=TPE))
        self.assertIsNone(q["error"])
        self.assertIn("盤前", q["notice"])

    def test_blank_during_session_is_error(self):
        q = _quote(None, now=datetime(2026, 11, 20, 10, 0, tzinfo=TPE))
        self.assertIn("查無此代號", q["error"])

    def test_tw_pre_open_window(self):
        self.assertTrue(qp.tw_pre_open(datetime(2026, 11, 20, 8, 59, tzinfo=TPE)))  # 週五
        self.assertFalse(qp.tw_pre_open(datetime(2026, 11, 20, 9, 0, tzinfo=TPE)))
        self.assertFalse(qp.tw_pre_open(datetime(2026, 11, 21, 8, 0, tzinfo=TPE)))  # 週六


if __name__ == "__main__":
    unittest.main()
