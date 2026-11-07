"""K 線買賣訊號標記（離線，用合成 K 棒）。"""

import unittest

from src.market.bar import Bar
from unittest.mock import patch

from src.technical import signals as sig_mod
from src.technical.signals import compute_signals, visible_signals


def _bars(closes, spread=0.5):
    return [
        Bar(timestamp=f"2026-01-{i + 1:03d}", open=c, high=c + spread, low=c - spread, close=c, volume=1000)
        for i, c in enumerate(closes)
    ]


class SignalTests(unittest.TestCase):
    def test_too_few_bars_gives_nothing(self):
        self.assertEqual(compute_signals(_bars([100.0] * 10)), [])

    def test_flat_market_has_no_signal(self):
        self.assertEqual(compute_signals(_bars([100.0] * 80)), [])

    def test_breakout_after_base_marks_buy(self):
        # 先下跌再盤整再向上突破：突破當天附近 MACD 會轉強
        closes = [120 - i * 0.5 for i in range(40)] + [100.0] * 20 + [100 + i * 1.5 for i in range(1, 15)]
        sigs = compute_signals(_bars(closes))
        buys = [s for s in sigs if s["type"] == "buy"]
        self.assertTrue(buys)
        self.assertTrue(all("突破" in s["reason"] for s in buys))
        self.assertTrue(all(s["confirmed"] for s in buys))

    def test_breakdown_marks_sell(self):
        closes = [100 + i * 0.5 for i in range(40)] + [120.0] * 20 + [120 - i * 1.5 for i in range(1, 15)]
        sells = [s for s in compute_signals(_bars(closes)) if s["type"] == "sell"]
        self.assertTrue(sells)
        self.assertTrue(all("跌破" in s["reason"] for s in sells))

    def test_cooldown_spaces_same_direction_signals(self):
        closes = [120 - i * 0.5 for i in range(40)] + [100.0] * 20 + [100 + i * 1.5 for i in range(1, 15)]
        buys = [s["index"] for s in compute_signals(_bars(closes)) if s["type"] == "buy"]
        for a, b in zip(buys, buys[1:]):
            self.assertGreaterEqual(b - a, 5)

    def test_overbought_rsi_blocks_buy(self):
        # 一路只漲：RSI 接近 100，不應標買進
        closes = [100 + i for i in range(80)]
        self.assertEqual([s for s in compute_signals(_bars(closes)) if s["type"] == "buy"], [])

    def test_provisional_last_bar_is_unconfirmed(self):
        closes = [120 - i * 0.5 for i in range(40)] + [100.0] * 20 + [100 + i * 1.5 for i in range(1, 15)]
        n = len(closes)
        flagged = compute_signals(_bars(closes), last_provisional=True)
        plain = compute_signals(_bars(closes))
        self.assertEqual([s["index"] for s in flagged], [s["index"] for s in plain])
        for s in flagged:
            self.assertEqual(s["confirmed"], s["index"] != n - 1)

    def test_visible_signals_filters_by_first_date(self):
        closes = [120 - i * 0.5 for i in range(40)] + [100.0] * 20 + [100 + i * 1.5 for i in range(1, 15)]
        bars = _bars(closes)
        allv, err = visible_signals(bars, "")  # 沒有起始日＝不回傳（沒有畫面可標）
        self.assertEqual((allv, err), ([], None))
        last_date = bars[-1].timestamp
        sigs, err = visible_signals(bars, bars[0].timestamp)
        self.assertIsNone(err)
        self.assertTrue(sigs)
        self.assertTrue(all("index" not in s for s in sigs))
        only_last, _ = visible_signals(bars, last_date)
        self.assertTrue(all(s["date"] >= last_date for s in only_last))

    def test_failure_is_reported_not_swallowed(self):
        with patch.object(sig_mod, "compute_signals", side_effect=RuntimeError("boom")):
            sigs, err = visible_signals(_bars([100.0] * 60), "2026-01-001")
        self.assertEqual(sigs, [])
        self.assertIn("boom", err)

    def test_ai_key_facts_include_signals_and_rule(self):
        # 功能改了，AI 看到的資料也要跟著改：訊號與規則說明要出現在 mod1 的關鍵數字卡
        from src.ai.ai_client import key_facts
        from src.ai.ai_prompts import MODULE_TASKS

        data = {
            "snapshot": {"symbol": "2330"},
            "signals": [
                {"date": "2026-10-22", "type": "sell", "reason": "收盤跌破近20日低點", "confirmed": True},
                {"date": "2026-11-06", "type": "buy", "reason": "收盤突破近20日高點", "confirmed": False},
            ],
        }
        text = key_facts("mod1", data)
        self.assertIn("買賣訊號標記", text)
        self.assertIn("歷史統計", text)
        self.assertIn("58.6%", text)
        self.assertIn("沒有預警效果", text)
        self.assertIn("2026-10-22 賣出標記", text)
        self.assertIn("盤中尚未確認", text)
        self.assertIn("K 線買賣訊號標記", MODULE_TASKS["mod1"])
        self.assertNotIn("買賣訊號標記", key_facts("mod1", {"snapshot": {"symbol": "2330"}}))


class BollingerContextTests(unittest.TestCase):
    def test_ai_gets_bollinger_position_and_prompt_warns(self):
        from src.ai.ai_client import key_facts
        from src.ai.ai_prompts import MODULE_TASKS

        bb = {"kind": "break_up", "text": "收盤突破上軌（強勢，也可能過熱）", "squeeze": True,
              "upper": 105.0, "mid": 100.0, "lower": 95.0}
        text = key_facts("mod1", {"snapshot": {"symbol": "2330"}, "bollinger": bb})
        self.assertIn("布林通道", text)
        self.assertIn("上軌 105.0", text)
        self.assertIn("方向不明", text)
        self.assertNotIn("布林通道", key_facts("mod1", {"snapshot": {"symbol": "2330"}}))
        self.assertIn("布林通道", MODULE_TASKS["mod1"])

    def test_api_bars_carry_bands_matching_ma20(self):
        from src.technical.intraday import bollinger
        closes = [100 + (i % 7) for i in range(40)]
        bb = bollinger(closes, 20, 2.0)
        self.assertIsNone(bb[18])
        self.assertAlmostEqual(bb[30]["mid"], sum(closes[11:31]) / 20)
        self.assertGreater(bb[30]["upper"], bb[30]["mid"])
        self.assertLess(bb[30]["lower"], bb[30]["mid"])


if __name__ == "__main__":
    unittest.main()
