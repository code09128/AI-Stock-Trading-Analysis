"""回測第二批：參數熱力圖與穩定高原、滾動前進分析（WFE）、蒙地卡羅（全部離線、確定性資料）。"""

import math
import unittest
from datetime import date, timedelta

from src.backtest import strategies, validation
from src.market.bar import Bar


def make_bars(closes, vol=1000.0):
    out, d = [], date(2020, 1, 1)
    for c in closes:
        while d.weekday() >= 5:
            d += timedelta(days=1)
        out.append(Bar(d.isoformat(), open=c, high=c * 1.01, low=c * 0.99, close=c, volume=vol))
        d += timedelta(days=1)
    return out


def wave(n, base=100.0, amp=15.0, period=60, drift=0.05):
    return [base + drift * i + amp * math.sin(2 * math.pi * i / period) for i in range(n)]


class TestHeatmap(unittest.TestCase):
    def setUp(self):
        self.bars = make_bars(wave(750))
        self.params = strategies.resolve_params("ma_cross", {})

    def test_shape_invalid_cells_and_mine(self):
        h = validation.param_heatmap(self.bars, "US", 1.0, "ma_cross", self.params)
        axes = strategies.STRATEGIES["ma_cross"]["heatmap"]
        self.assertEqual(len(h["cells"]), len(axes["slow_ma"]))
        self.assertEqual(len(h["cells"][0]), len(axes["fast_ma"]))
        # 短均線 20、長均線 20 不合理 → None
        self.assertIsNone(h["cells"][axes["slow_ma"].index(20)][axes["fast_ma"].index(20)])
        self.assertEqual(h["mine"], {"row": axes["slow_ma"].index(20), "col": axes["fast_ma"].index(5)})
        self.assertIsInstance(h["best_is_island"], bool)

    def test_plateau_rule(self):
        """每個 ★ 格都符合規則：自己賺、鄰格平均 ≥ 自己一半。"""
        h = validation.param_heatmap(self.bars, "US", 1.0, "ma_cross", self.params)
        for i, row in enumerate(h["cells"]):
            for j, c in enumerate(row):
                if not c or c["trades"] < validation.MIN_TRADES:
                    continue
                if c["plateau"]:
                    self.assertGreater(c["return_pct"], 0)
                    self.assertGreaterEqual(c["neighbor_avg_pct"], c["return_pct"] * 0.5)

    def test_one_param_strategy_is_single_row(self):
        h = validation.param_heatmap(self.bars, "US", 1.0, "gap_up", strategies.resolve_params("gap_up", {}))
        self.assertIsNone(h["y"])
        self.assertEqual(len(h["cells"]), 1)

    def test_every_strategy_has_heatmap_axes_within_range(self):
        for key, meta in strategies.STRATEGIES.items():
            defs = {d["key"]: d for d in meta["params"]}
            for k, vals in meta["heatmap"].items():
                self.assertIn(k, defs, key)
                self.assertTrue(all(defs[k]["lo"] <= v <= defs[k]["hi"] for v in vals), (key, k))


class TestRollingWalkForward(unittest.TestCase):
    def test_folds_are_consecutive_and_end_at_last_bar(self):
        bars = make_bars(wave(900))
        ro = validation.rolling_walk_forward(bars, "US", 1.0, "ma_cross", strategies.resolve_params("ma_cross", {}))
        self.assertIsNotNone(ro)
        used = [f for f in ro["folds"] if not f["skipped"]]
        self.assertGreaterEqual(len(used), 2)
        self.assertTrue(ro["folds"][-1]["test_period"].endswith(bars[-1].timestamp))
        for a, b in zip(ro["folds"], ro["folds"][1:]):
            self.assertLess(a["test_period"], b["test_period"])  # 測試期一段接一段往前
        if ro["wfe"] is not None:
            self.assertAlmostEqual(ro["wfe"], round(ro["avg_oos_annual_pct"] / ro["avg_is_annual_pct"], 2), places=1)

    def test_too_short(self):
        self.assertIsNone(validation.rolling_walk_forward(
            make_bars(wave(200)), "US", 1.0, "ma_cross", strategies.resolve_params("ma_cross", {})))


class TestMonteCarlo(unittest.TestCase):
    RETS = [5.0, -3.0, 8.0, -6.0, 2.0, -4.0, 10.0, -2.0, 3.0, -5.0]

    def test_shuffle_keeps_final_return(self):
        mc = validation.monte_carlo(self.RETS, runs=500, mode="shuffle")
        self.assertEqual(mc["final_pct"]["p5"], mc["final_pct"]["p95"])
        self.assertAlmostEqual(mc["final_pct"]["p50"], mc["actual"]["final_pct"], places=1)
        self.assertLessEqual(mc["mdd_pct"]["p5"], mc["mdd_pct"]["p95"])
        self.assertEqual(sum(b["count"] for b in mc["mdd_hist"]), 500)
        self.assertIsNone(mc["final_hist"])

    def test_bootstrap_spreads_final_return_and_is_deterministic(self):
        a = validation.monte_carlo(self.RETS, runs=1000, mode="bootstrap")
        b = validation.monte_carlo(self.RETS, runs=1000, mode="bootstrap")
        self.assertEqual(a, b)  # 固定亂數種子：同樣輸入同樣結果
        self.assertLess(a["final_pct"]["p5"], a["final_pct"]["p95"])
        self.assertTrue(0 <= a["prob_loss_pct"] <= 100)

    def test_rejects_bad_input(self):
        with self.assertRaises(ValueError):
            validation.monte_carlo([1, 2, 3], runs=500)
        with self.assertRaises(ValueError):
            validation.monte_carlo(self.RETS, runs=123)
        with self.assertRaises(ValueError):
            validation.monte_carlo(self.RETS, runs=500, mode="x")

    def test_all_losses_drawdown(self):
        mc = validation.monte_carlo([-10.0] * 5, runs=500)
        self.assertAlmostEqual(mc["actual"]["mdd_pct"], (1 - 0.9 ** 5) * 100, places=1)


if __name__ == "__main__":
    unittest.main()
