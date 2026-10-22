"""支撐壓力依現價分類、BUY／SELL 價位方向、ETF 穿透不重複計算、組合風控空持股（離線，不連網）。"""

import unittest

from src.api_server import TradingEngineDispatcher
from src.data_adapter import DualMarketDataAdapter, classify_levels
from src.llm_runner import LLMRunner
from src.portfolio_risk import PortfolioRiskManager
from src.trend_score import score_trend


class ClassifyLevelsTests(unittest.TestCase):
    def test_levels_split_by_current_price(self):
        r = classify_levels([780, 823, 826, 872, 875, 931, 1260], 830, atr=60, market="US")
        self.assertTrue(all(v < 830 for v in r["supports"]))
        self.assertTrue(all(v > 830 for v in r["resistances"]))
        self.assertEqual(r["supports"], [780, 823, 826])  # 最近的三個，由低到高
        self.assertEqual(r["resistances"], [872, 875, 931])
        self.assertEqual(r["notes"], [])

    def test_new_high_projects_resistance_with_atr(self):
        r = classify_levels([90, 95, 100], 110, atr=2, market="US")
        self.assertEqual(r["resistances"], [114.0])
        self.assertIn("創新高", r["notes"][0])

    def test_new_low_projects_support_with_atr(self):
        r = classify_levels([90, 95, 100], 80, atr=2, market="US")
        self.assertEqual(r["supports"], [76.0])
        self.assertIn("創新低", r["notes"][0])

    def test_tw_levels_align_to_tick_and_stay_on_correct_side(self):
        r = classify_levels([828.3, 831.2], 830, atr=10, market="TW")
        self.assertEqual(r["supports"], [828.0])  # 100–500 以上檔位 1 元，支撐捨去
        self.assertEqual(r["resistances"], [832.0])  # 壓力進位

    def test_reclassify_after_live_price(self):
        snap = {"level_candidates": [100, 105, 110], "indicators": {"ATR14": 1}, "market": "US",
                "support_levels": [100, 105], "resistance_levels": [110]}
        DualMarketDataAdapter.reclassify_levels(snap, 107)
        self.assertEqual(snap["support_levels"], [100, 105])
        self.assertEqual(snap["resistance_levels"], [110])
        DualMarketDataAdapter.reclassify_levels(snap, 103)  # 跌破 105 後，105 變壓力
        self.assertEqual(snap["support_levels"], [100])
        self.assertEqual(snap["resistance_levels"], [105, 110])


def _snapshot(signal, market="US", close=100.0):
    closes = [90 + i * 0.2 for i in range(60)]
    score = score_trend(closes, [1000.0] * 60)
    score["signal"] = signal
    return {
        "symbol": "TEST", "market": market, "latest_close": close, "historical_low": 80, "historical_high": 120,
        "indicators": {"MA5": 99, "MA20": 97, "RSI14": 55, "ATR14": 2.0},
        "support_levels": [94.0, 96.0, 99.5], "resistance_levels": [100.2, 104.0, 108.0],
        "trend_score": score,
    }


class DecisionDirectionTests(unittest.TestCase):
    def test_buy_prices_ordered_stop_entry_target(self):
        d = LLMRunner._deterministic_technical_decision(_snapshot("BUY"))
        self.assertEqual(d["action"], "BUY")
        self.assertLess(d["stop_loss_price"], d["entry_price"])
        self.assertLess(d["entry_price"], d["take_profit_target"])
        self.assertEqual(d["entry_price"], 99.5)  # 最近支撐在 1 ATR 內
        self.assertEqual(d["take_profit_target"], 104.0)  # 跳過離進場不到 0.5 ATR 的 100.2

    def test_sell_prices_ordered_target_entry_stop(self):
        d = LLMRunner._deterministic_technical_decision(_snapshot("STRONG_SELL"))
        self.assertEqual(d["action"], "SELL")
        self.assertEqual(d["entry_price"], 100.0)
        self.assertGreater(d["stop_loss_price"], d["entry_price"])  # 失效價在上方
        self.assertLess(d["take_profit_target"], d["entry_price"])  # 下檔目標在下方
        self.assertEqual(d["take_profit_target"], 96.0)  # 跳過太近的 99.5
        self.assertIn("空方判斷失效", d["invalidation_criteria"])
        self.assertEqual(LLMRunner._sanity_issues(d, _snapshot("SELL"), " ".join(d["step_by_step_rationale"])), [])

    def test_far_support_uses_current_price_as_entry(self):
        snap = _snapshot("BUY")
        snap["support_levels"] = [90.0]
        d = LLMRunner._deterministic_technical_decision(snap)
        self.assertEqual(d["entry_price"], 100.0)

    def test_ai_sell_with_wrong_direction_is_rejected(self):
        bad = {"action": "SELL", "order_type": "LIMIT", "entry_price": 100, "stop_loss_price": 95,
               "take_profit_target": 110, "invalidation_criteria": "收盤站回 105 停止賣出"}
        issues = LLMRunner._sanity_issues(bad, {"market": "US"}, "")
        self.assertTrue(any("失效價" in i for i in issues))
        self.assertTrue(any("下檔目標" in i for i in issues))


class LookthroughTests(unittest.TestCase):
    def _weights(self, rows):
        rm = PortfolioRiskManager(usd_twd_rate=32.0, etf_holdings={"0050": {"2330": 0.56, "2317": 0.05}})
        return rm, rm.calculate_portfolio_weights(rows)

    def test_etf_weight_is_split_not_double_counted(self):
        rm, w = self._weights([
            {"symbol": "2330.TW", "market": "TW", "shares": 700, "price": 100},
            {"symbol": "0050", "market": "TW", "shares": 300, "price": 100},
        ])
        exp = rm.calculate_lookthrough_exposure(w)
        self.assertNotIn("0050", exp)
        self.assertAlmostEqual(exp["2330"], 70 + 30 * 0.56, places=2)
        self.assertAlmostEqual(exp["0050 其他成分股"], 30 * 0.39, places=2)
        self.assertAlmostEqual(sum(exp.values()), 100.0, delta=0.05)
        self.assertEqual(list(exp)[0], "2330")  # 由大到小

    def test_two_suffix_is_stripped(self):
        rm, w = self._weights([{"symbol": "6488.TWO", "market": "TW", "shares": 10, "price": 800}])
        self.assertEqual(rm.calculate_lookthrough_exposure(w), {"6488": 100.0})

    def test_zero_value_portfolio_keeps_holdings_key(self):
        rm, w = self._weights([{"symbol": "2330", "market": "TW", "shares": 0, "price": 100}])
        self.assertEqual(w["holdings"], [])
        self.assertEqual(rm.calculate_lookthrough_exposure(w), {})


class EmptyHoldingsTests(unittest.TestCase):
    def test_no_valid_holdings_raises_friendly_error(self):
        d = TradingEngineDispatcher.__new__(TradingEngineDispatcher)
        d.adapter = type("A", (), {"fetch_usd_twd_rate": lambda self: {"usd_twd": 32.0, "source": "TEST"}})()
        for holdings in ([], [{"symbol": "", "shares": 10}], [{"symbol": "2330", "shares": 0}],
                         [{"symbol": "2330", "shares": "abc"}]):
            with self.assertRaises(ValueError) as cm:
                d.handle_mod4_risk({"holdings": holdings, "use_live_prices": False})
            self.assertIn("沒有可計算的持股", str(cm.exception))


if __name__ == "__main__":
    unittest.main()
