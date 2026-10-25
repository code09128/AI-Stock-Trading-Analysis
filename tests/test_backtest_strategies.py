"""回測第一批：多策略、部位模型、停損／移動停利、大盤濾網、成交量 0、逐日最大回撤、FinMind 自我節流（全部離線）。"""

import math
import os
import unittest
from datetime import date, timedelta

from src.backtest import backtest_analysis as ba
from src.backtest import strategies
from src.backtest.backtest_engine import BacktestEngine
from src.market import finmind
from src.market.bar import Bar


def make_bars(closes, vol=1000.0, start=date(2024, 1, 1)):
    out, d = [], start
    for c in closes:
        while d.weekday() >= 5:
            d += timedelta(days=1)
        out.append(Bar(d.isoformat(), open=c, high=c * 1.01, low=c * 0.99, close=c, volume=vol))
        d += timedelta(days=1)
    return out


def wave(n, base=100.0, amp=12.0, period=40, drift=0.0):
    return [base + drift * i + amp * math.sin(2 * math.pi * i / period) for i in range(n)]


def flat(prices):
    """開高低收都一樣的 K 棒，方便算準成交價。"""
    return [Bar(f"2026-01-{i + 1:02d}", open=p, high=p, low=p, close=p, volume=1000) for i, p in enumerate(prices)]


def with_extra(bars):
    """替籌碼／月營收策略補上確定性的假資料（法人買賣超、融資餘額、月營收）。"""
    from src.backtest import chip_features
    n = len(bars)
    inst = [round(1000 * math.sin(i / 3)) for i in range(n)]
    margin = [50000 * (1 + 0.2 * math.sin(i / 15)) for i in range(n)]
    first = date.fromisoformat(bars[0].timestamp)
    rows = []
    for k in range(-14, n // 20 + 2):
        y, m = divmod(first.year * 12 + first.month - 1 + k, 12)
        rows.append({"revenue_year": y, "revenue_month": m + 1, "revenue": 1e9 * (1 + 0.3 * math.sin(k / 2) + k * 0.01),
                     "date": f"{y}-{m + 1:02d}-01"})
    return strategies.BarSeries(bars, {"inst": inst, "margin": margin,
                                       "revenue": chip_features.align_revenue(bars, rows)})


def cut(series, k):
    return strategies.BarSeries(series[:k], {name: v[:k] for name, v in series.extra.items()})


class TestStrategies(unittest.TestCase):
    def test_every_strategy_has_valid_defaults_and_signals(self):
        bars = with_extra(make_bars(wave(400, drift=0.05)))
        for key in strategies.STRATEGIES:
            params = strategies.resolve_params(key, {})
            sig = strategies.signals(key, bars, params)
            self.assertEqual(len(sig), len(bars), key)
            self.assertTrue(set(sig) <= {-1, 0, 1}, key)

    def test_no_lookahead_prefix_invariance(self):
        """只用到當天為止的資料：截掉後面的 K 棒，前面的訊號不能改變。"""
        bars = with_extra(make_bars(wave(300, amp=15, period=30)))
        for key in strategies.STRATEGIES:
            p = strategies.resolve_params(key, {})
            full = strategies.signals(key, bars, p)
            self.assertEqual(strategies.signals(key, cut(bars, 200), p), full[:200], key)

    def test_chip_strategies_require_data(self):
        with self.assertRaises(ValueError):
            strategies.signals("inst_buy", make_bars(wave(50)), strategies.resolve_params("inst_buy", {}))

    def test_kd_values_range(self):
        kd = strategies.kd_values(make_bars(wave(100)), 9)
        vals = [v for v in kd["k"] + kd["d"] if v is not None]
        self.assertTrue(all(0 <= v <= 100 for v in vals))

    def test_gap_up_buys_on_gap_and_sells_when_filled(self):
        prices = [100.0] * 25
        bars = [Bar(f"2026-02-{i + 1:02d}", 100, 101, 99, 100, 1000) for i in range(25)]
        bars.append(Bar("2026-02-26", 105, 106, 104, 105, 5000))  # 低點 104 > 前高 101 → 跳空
        bars.append(Bar("2026-02-27", 104, 104, 100, 100.5, 1000))  # 收盤 100.5 < 缺口下緣 101 → 回補
        sig = strategies.gap_up(bars, {"min_gap_pct": 1})
        self.assertEqual(sig[25], 1)
        self.assertEqual(sig[26], -1)
        self.assertEqual(len(prices), 25)

    def test_resolve_params_range_and_order(self):
        with self.assertRaises(ValueError):
            strategies.resolve_params("ma_cross", {"fast_ma": 30, "slow_ma": 10})
        with self.assertRaises(ValueError):
            strategies.resolve_params("ma_align", {"short_ma": 20, "mid_ma": 10, "long_ma": 60})
        with self.assertRaises(ValueError):
            strategies.resolve_params("kd_cross", {"kd_n": 999})
        with self.assertRaises(ValueError):
            strategies.resolve_params("nope", {})
        self.assertEqual(strategies.resolve_params("bias_revert", {"entry_bias": "6"})["entry_bias"], 6.0)

    def test_catalog_has_no_functions(self):
        import json
        json.dumps(strategies.catalog())  # 可序列化給前端


class TestRiskRules(unittest.TestCase):
    def test_stop_loss_fills_at_stop_price(self):
        bars = flat([100, 100, 100]) + [Bar("2026-01-04", 98, 99, 85, 90, 1000), Bar("2026-01-05", 90, 90, 90, 90, 1000)]
        r = BacktestEngine(market="US", initial_capital=10_000, stop_loss_pct=10).run(bars, [1, 0, 0, 0, 0])
        t = r["trades_detail"][0]
        self.assertEqual(t["exit_reason"], "停損")
        self.assertAlmostEqual(t["exit_price"], 90.0)
        self.assertEqual(t["exit_date"], "2026-01-04")

    def test_stop_loss_gap_down_fills_at_open(self):
        bars = flat([100, 100]) + [Bar("2026-01-03", 80, 82, 78, 80, 1000)]
        r = BacktestEngine(market="US", initial_capital=10_000, stop_loss_pct=10).run(bars, [1, 0, 0])
        self.assertEqual(r["trades_detail"][0]["exit_price"], 80)

    def test_trailing_stop_follows_peak(self):
        bars = flat([100, 100, 110, 120]) + [Bar("2026-01-05", 119, 119, 100, 105, 1000)]
        r = BacktestEngine(market="US", initial_capital=10_000, trailing_pct=10).run(bars, [1, 0, 0, 0, 0])
        t = r["trades_detail"][0]
        self.assertEqual(t["exit_reason"], "移動停利")
        self.assertAlmostEqual(t["exit_price"], 108.0)  # 最高 120 回落 10%

    def test_trailing_below_entry_is_labelled_stop(self):
        bars = flat([100, 100]) + [Bar("2026-01-03", 99, 99, 80, 85, 1000)]
        r = BacktestEngine(market="US", initial_capital=10_000, trailing_pct=5).run(bars, [1, 0, 0])
        self.assertEqual(r["trades_detail"][0]["exit_reason"], "移動停損")

    def test_daily_drawdown_includes_open_position(self):
        """只看已平倉會是 0%；持有中跌一半，逐日最大回撤要算到。"""
        bars = flat([100, 100, 50, 50])
        r = BacktestEngine(market="US", initial_capital=10_000).run(bars, [1, 0, 0, 0])
        self.assertEqual(r["total_trades"], 0)
        self.assertGreater(r["max_drawdown_detail"]["max_dd_pct"], 45)
        self.assertIsNotNone(r["open_position"])
        self.assertLess(r["open_position"]["unrealized_pnl"], 0)

    def test_sizing_modes(self):
        e = BacktestEngine(market="US", initial_capital=10_000, sizing={"mode": "percent", "value": 50})
        self.assertEqual(e._order_size(100.0, 10_000, None), 50)  # 資金的 50%（美股無券商手續費）
        e = BacktestEngine(market="US", initial_capital=10_000, sizing={"mode": "fixed", "value": 2_000})
        self.assertEqual(e._order_size(100.0, 10_000, None), 20)
        e = BacktestEngine(market="US", initial_capital=10_000, sizing={"mode": "atr_risk", "value": 1, "atr_mult": 2})
        self.assertEqual(e._order_size(100.0, 10_000, 5.0), 10)  # 100 ÷ (5×2)
        self.assertIsNone(e._order_size(100.0, 10_000, None))
        self.assertEqual(e._order_size(100.0, 10_000, 0.01), 100)  # 風險算出很多股，仍不能超過資金

    def test_default_sizing_matches_old_all_in(self):
        bars = make_bars(wave(300))
        sig = ba.ma_cross_signals(bars, 5, 20)
        a = BacktestEngine(market="TW").run(bars, sig)
        b = BacktestEngine(market="TW", sizing={"mode": "percent", "value": 100}).run(bars, sig)
        self.assertEqual(a["trades_detail"], b["trades_detail"])


class TestFiltersAndSuspension(unittest.TestCase):
    def test_market_filter_blocks_and_counts(self):
        bars = flat([100] * 6)
        r = BacktestEngine(market="US", initial_capital=10_000).run(
            bars, [1, 0, -1, 1, 0, 0], [False, True, True, True, True, True])
        self.assertEqual(r["blocked_by_filter"], 1)
        self.assertEqual(r["blocked_dates"], ["2026-01-01"])
        self.assertIsNotNone(r["open_position"])  # 第二次買訊沒被擋

    def test_market_filter_from_index(self):
        idx = make_bars([100 + i for i in range(80)] + [180 - 3 * i for i in range(40)])
        allowed = ba.market_filter(idx, idx, 20)
        self.assertTrue(allowed[60])
        self.assertFalse(allowed[-1])

    def test_zero_volume_day_defers_fill_and_ignores_its_signal(self):
        bars = flat([100, 100, 100, 100, 100])
        bars[1] = Bar(bars[1].timestamp, 100, 100, 100, 100, 0)
        r = BacktestEngine(market="US", initial_capital=10_000).run(bars, [1, 0, 0, -1, 0])
        self.assertEqual(r["suspended_days"], 1)
        t = r["trades_detail"][0]
        self.assertEqual(t["entry_date"], bars[2].timestamp)  # 暫停那天不成交，順延
        r2 = BacktestEngine(market="US", initial_capital=10_000).run(bars, [0, 1, 0, 0, 0])
        self.assertEqual(r2["ignored_suspended_signals"], 1)

    def test_last_bar_zero_volume_is_not_a_halt(self):
        """Yahoo 最新一天常先給量 0 的 K 棒，不能算成暫停交易。"""
        bars = flat([100, 100, 100])
        bars[-1] = Bar(bars[-1].timestamp, 100, 100, 100, 100, 0)
        self.assertEqual(BacktestEngine(market="US").run(bars, [0, 0, 0])["suspended_days"], 0)

    def test_volume_rule_skipped_when_data_has_no_volume(self):
        bars = [Bar(b.timestamp, b.open, b.high, b.low, b.close, 0) for b in flat([100, 100, 110, 110])]
        r = BacktestEngine(market="US", initial_capital=10_000).run(bars, [1, 0, -1, 0])
        self.assertEqual(r["total_trades"], 1)


class TestWalkForwardGeneric(unittest.TestCase):
    def test_walk_forward_other_strategy(self):
        bars = make_bars(wave(700, amp=15, period=50, drift=0.03))
        wf = ba.walk_forward(bars, "US", 1.0, strategy="bias_revert",
                             params=strategies.resolve_params("bias_revert", {}),
                             engine_kw={"stop_loss_pct": 10})
        if wf is not None:
            self.assertIn("ma", wf["best_params"])
            self.assertIn("均線天數", wf["best_label"])

    def test_old_signature_still_works(self):
        wf = ba.walk_forward(make_bars(wave(700, amp=15, period=60, drift=0.05)), "US", 1.0, 5, 20)
        self.assertIsNotNone(wf)
        self.assertIn(wf["best_params"]["fast_ma"], ba.FAST_GRID)

    def test_ideas_skip_rules_already_on(self):
        ideas = ba.next_step_ideas({"total_trades": 40, "payoff_ratio": 0.8}, None, None, {"stop_loss_pct": 8})
        self.assertFalse(any("固定停損" in x for x in ideas))
        self.assertTrue(any("移動停利" in x for x in ideas))


class TestFinMindBudget(unittest.TestCase):
    def setUp(self):
        finmind.reset_pause()
        self._old = os.environ.get("FINMIND_HOURLY_BUDGET")
        os.environ["FINMIND_HOURLY_BUDGET"] = "2"

    def tearDown(self):
        finmind.reset_pause()
        if self._old is None:
            os.environ.pop("FINMIND_HOURLY_BUDGET", None)
        else:
            os.environ["FINMIND_HOURLY_BUDGET"] = self._old

    def test_throttles_before_official_limit(self):
        finmind._take_slot()
        finmind._take_slot()
        with self.assertRaises(finmind.FinMindPaused):
            finmind._take_slot()
        u = finmind.usage()
        self.assertEqual(u["used_last_hour"], 2)
        self.assertIn("throttled_until", u)

    def test_default_budget_is_80_percent(self):
        os.environ.pop("FINMIND_HOURLY_BUDGET")
        b = finmind.hourly_budget()
        self.assertEqual(b["budget"], int(b["limit"] * 0.8))


if __name__ == "__main__":
    unittest.main()


class TestTwSellTax(unittest.TestCase):
    def test_rates_by_type(self):
        from datetime import date as d
        from src.market.market_rules import tw_sell_tax_rate
        self.assertEqual(tw_sell_tax_rate("2330.TW"), 0.003)
        self.assertEqual(tw_sell_tax_rate("0050"), 0.001)
        self.assertEqual(tw_sell_tax_rate("00679B.TWO", d(2026, 6, 1)), 0.0)
        self.assertEqual(tw_sell_tax_rate("00679B", d(2027, 1, 1)), 0.001)  # 停徵到期

    def test_engine_uses_etf_rate(self):
        bars = flat([100, 100, 100, 100])
        stock = BacktestEngine(market="TW", initial_capital=1_000_000).run(bars, [1, 0, -1, 0])
        etf = BacktestEngine(market="TW", initial_capital=1_000_000, tw_tax_rate=0.001).run(bars, [1, 0, -1, 0])
        # 賣出 9,000 股 × 100 元：股票稅 2,700、ETF 稅 900
        self.assertAlmostEqual(etf["trades_detail"][0]["net_pnl"] - stock["trades_detail"][0]["net_pnl"], 1800, places=0)
