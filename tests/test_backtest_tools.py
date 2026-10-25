"""回測第三批：今日訊號狀態判斷、盤中判斷、Pine v5 匯出（全部離線）。"""

import unittest
from datetime import datetime, timezone

from src.backtest import live_signals, pine_export, strategies
from src.market.bar import Bar


def flat_bars(prices, start_day=1):
    return [Bar(f"2026-03-{start_day + i:02d}", p, p, p, p, 1000) for i, p in enumerate(prices)]


P = {"fast_ma": 2, "slow_ma": 3}


class TestEvaluate(unittest.TestCase):
    def test_buy_on_last_bar(self):
        # 最後一根短均線上穿長均線
        bars = flat_bars([10, 10, 10, 10, 9, 8, 12])
        row = live_signals.evaluate(bars, "US", "ma_cross", P)
        self.assertEqual(row["signal_today"], 1)
        self.assertEqual(row["status"], "buy")

    def test_blocked_by_filter(self):
        bars = flat_bars([10, 10, 10, 10, 9, 8, 12])
        row = live_signals.evaluate(bars, "US", "ma_cross", P, allowed=[True] * 6 + [False])
        self.assertEqual(row["status"], "blocked")
        self.assertFalse(row["market_ok"])

    def test_hold_with_stop_price(self):
        bars = flat_bars([10, 10, 10, 10, 9, 8, 12, 13, 14, 15])
        row = live_signals.evaluate(bars, "US", "ma_cross", P, engine_kw={"stop_loss_pct": 10, "trailing_pct": 20})
        self.assertEqual(row["status"], "hold")
        pos = row["position"]
        self.assertEqual(pos["entry_price"], 13)  # 買訊隔天開盤
        self.assertAlmostEqual(pos["stop_price"], max(13 * 0.9, 15 * 0.8), places=2)

    def test_sell_on_last_bar(self):
        bars = flat_bars([10, 10, 10, 10, 9, 8, 12, 13, 14, 15, 9])
        row = live_signals.evaluate(bars, "US", "ma_cross", P)
        self.assertEqual(row["status"], "sell")

    def test_stopped_today(self):
        bars = flat_bars([10, 10, 10, 10, 9, 8, 12, 13, 14])
        bars.append(Bar("2026-03-10", 14, 14, 10, 13.5, 1000))  # 盤中跌破停損 13×0.9
        row = live_signals.evaluate(bars, "US", "ma_cross", P, engine_kw={"stop_loss_pct": 10})
        self.assertEqual(row["status"], "stopped")
        self.assertEqual(row["exit_today"]["exit_reason"], "停損")

    def test_summary_counts_errors(self):
        s = live_signals.summarize([{"status": "buy"}, {"error": "x"}, {"status": "wait"}])
        self.assertEqual((s["buy"], s["wait"], s["error"]), (1, 1, 1))


class TestProvisional(unittest.TestCase):
    def test_tw_intraday_vs_after_close(self):
        # 台北 10:00＝UTC 02:00；台北 14:00＝UTC 06:00
        self.assertTrue(live_signals.is_provisional("TW", "2026-03-10", datetime(2026, 3, 10, 2, 0, tzinfo=timezone.utc)))
        self.assertFalse(live_signals.is_provisional("TW", "2026-03-10", datetime(2026, 3, 10, 6, 0, tzinfo=timezone.utc)))
        self.assertFalse(live_signals.is_provisional("TW", "2026-03-09", datetime(2026, 3, 10, 2, 0, tzinfo=timezone.utc)))


class TestPine(unittest.TestCase):
    RISK = {"sizing_mode": "percent", "sizing_value": 100, "stop_loss_pct": 8, "trailing_pct": 10,
            "market_filter": True, "filter_ma": 60}

    def test_every_strategy_builds(self):
        for key in strategies.STRATEGIES:
            out = pine_export.build("2330.TW", "TW", key, strategies.resolve_params(key, {}), 1_000_000, 0.6, self.RISK)
            code = out["code"]
            self.assertTrue(code.startswith("//@version=5"), key)
            self.assertIn("buySig", code)
            self.assertIn("sellSig", code)
            self.assertIn("process_orders_on_close=false", code)
            for p in strategies.STRATEGIES[key]["params"]:
                self.assertIn(f"{p['key']} = input.", code, key)

    def test_tax_spread_by_instrument(self):
        stock = pine_export.commission_per_side("TW", "2330.TW", 0.6)
        etf = pine_export.commission_per_side("TW", "0050.TW", 0.6)
        self.assertAlmostEqual(stock["pct"], 0.0855 + 0.15, places=4)
        self.assertAlmostEqual(etf["pct"], 0.0855 + 0.05, places=4)
        self.assertEqual(pine_export.commission_per_side("US", "NVDA", 0.6)["pct"], 0.0)

    def test_sizing_modes_and_notes(self):
        fixed = pine_export.build("NVDA", "US", "ma_cross", {"fast_ma": 5, "slow_ma": 20}, 10000, 1,
                                  {**self.RISK, "sizing_mode": "fixed", "sizing_value": 2000})
        self.assertIn("default_qty_type=strategy.cash, default_qty_value=2000", fixed["code"])
        atr = pine_export.build("2330.TW", "TW", "ma_cross", {"fast_ma": 5, "slow_ma": 20}, 1e6, 0.6,
                                {**self.RISK, "sizing_mode": "atr_risk", "sizing_value": 1, "atr_mult": 2})
        self.assertIn("ta.atr(14) * atrMult", atr["code"])
        self.assertTrue(any("還權" in n for n in atr["notes"]))
        self.assertTrue(any("證交稅" in n for n in atr["notes"]))

    def test_tv_symbol(self):
        self.assertEqual(pine_export.tv_symbol("2330.TW"), "TWSE:2330")
        self.assertEqual(pine_export.tv_symbol("8069.TWO"), "TPEX:8069")
        self.assertEqual(pine_export.tv_symbol("0050"), "TWSE:0050")
        self.assertEqual(pine_export.tv_symbol("NVDA"), "NVDA")


if __name__ == "__main__":
    unittest.main()
