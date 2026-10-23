"""
五套分析框架的新功能（離線、確定性資料）：
- 回測：平均獲利／虧損、市場環境拆分、前後段驗證、下一步規則
- 三情境：價位間距、成立／失效條件、量能判斷
- 新聞彙整：發布前後價格反應、關鍵字規則
- 組合多情境：Beta 線性情境
- 財報預期差規則
"""

import math
import unittest

from src.backtest import backtest_analysis as ba
from src.company import fundamentals
from src.news import news_digest
from src.portfolio import portfolio_scenarios
from src.technical import scenarios
from src.market.bar import Bar
from src.backtest.backtest_engine import BacktestEngine
def make_bars(closes, start=(2024, 1, 1), vol=1000.0):
    from datetime import date, timedelta
    d0 = date(*start)
    out, d = [], d0
    for c in closes:
        while d.weekday() >= 5:
            d += timedelta(days=1)
        out.append(Bar(timestamp=d.isoformat(), open=c, high=c * 1.01, low=c * 0.99, close=c, volume=vol))
        d += timedelta(days=1)
    return out


def wave(n, base=100.0, amp=10.0, period=40, drift=0.0):
    return [base + drift * i + amp * math.sin(2 * math.pi * i / period) for i in range(n)]


class TestBacktestDiagnostics(unittest.TestCase):
    def test_avg_win_loss_and_payoff(self):
        bars = make_bars(wave(300))
        r = BacktestEngine(market="US").run(bars, ba.ma_cross_signals(bars, 5, 20))
        self.assertGreater(r["total_trades"], 0)
        self.assertIn("avg_win_pct", r)
        self.assertLessEqual(r["avg_loss_pct"], 0)
        if r["avg_loss_pct"]:
            self.assertAlmostEqual(r["payoff_ratio"], round(r["avg_win_pct"] / abs(r["avg_loss_pct"]), 2))

    def test_regime_labels(self):
        up = make_bars([100 + i for i in range(260)])
        down = make_bars([400 - i for i in range(260)])
        self.assertEqual(ba.regime_by_date(up)[up[-1].timestamp], "多頭")
        self.assertEqual(ba.regime_by_date(down)[down[-1].timestamp], "空頭")

    def test_regime_breakdown_counts(self):
        trades = [{"entry_date": "d1", "net_pnl": 10, "return_pct": 1.0},
                  {"entry_date": "d1", "net_pnl": 20, "return_pct": 2.0},
                  {"entry_date": "d2", "net_pnl": -5, "return_pct": -0.5},
                  {"entry_date": "d2", "net_pnl": -5, "return_pct": -0.5},
                  {"entry_date": "x", "net_pnl": 1, "return_pct": 0.1}]
        out = ba.regime_breakdown(trades, {"d1": "多頭", "d2": "空頭"})
        rows = {r["regime"]: r for r in out["rows"]}
        self.assertEqual(rows["多頭"]["trades"], 2)
        self.assertEqual(rows["空頭"]["win_rate_pct"], 0.0)
        self.assertEqual(out["unclassified"], 1)
        self.assertEqual(out["best"], "多頭")
        self.assertEqual(out["worst"], "空頭")

    def test_walk_forward_shape(self):
        bars = make_bars(wave(700, amp=15, period=60, drift=0.05))
        wf = ba.walk_forward(bars, "US", 1.0, 5, 20)
        self.assertIsNotNone(wf)
        self.assertLess(wf["train_period"], wf["test_period"])
        self.assertIn(wf["best_params"]["fast_ma"], ba.FAST_GRID)
        self.assertIsInstance(wf["overfit_warning"], bool)

    def test_walk_forward_too_short(self):
        self.assertIsNone(ba.walk_forward(make_bars(wave(120)), "US", 1.0, 5, 20))

    def test_next_step_ideas_always_ends_with_principle(self):
        ideas = ba.next_step_ideas({"total_trades": 5, "payoff_ratio": 0.8}, None, None)
        self.assertTrue(any("30 筆" in x for x in ideas))
        self.assertTrue(any("賺賠比" in x for x in ideas))
        self.assertIn("每次只改一條規則", ideas[-1])


class TestScenarios(unittest.TestCase):
    def snap(self, price, sup, res, atr=2.0):
        return {"market": "US", "latest_close": price, "indicators": {"ATR14": atr},
                "support_levels": sup, "resistance_levels": res}

    def test_levels_spaced_by_atr(self):
        bars = make_bars(wave(300, base=100, amp=5))
        out = scenarios.build(self.snap(100.0, [95.0, 98.0, 99.5], [100.5, 101.0, 106.0]), bars)
        lv = out["levels"]
        self.assertEqual(lv["S1"], 98.0)        # 99.5 離現價不到 0.5 ATR
        self.assertEqual(lv["R1"], 101.0)       # 100.5 太近
        self.assertGreaterEqual(lv["R2"] - lv["R1"], 2.0)
        self.assertGreaterEqual(lv["S1"] - lv["S2"], 2.0)

    def test_three_scenarios_with_conditions(self):
        bars = make_bars([50 + i * 0.5 for i in range(300)])  # 穩定上漲
        out = scenarios.build(self.snap(bars[-1].close, [], [], atr=1.0), bars)
        keys = [s["key"] for s in out["scenarios"]]
        self.assertEqual(keys, ["bull", "neutral", "bear"])
        for s in out["scenarios"]:
            self.assertTrue(s["trigger"] and s["invalidation"])
        self.assertEqual(out["lean"], "bull")
        self.assertIn("不是預測", out["disclaimer"])
        self.assertIn("ATR", out["levels"]["source"])

    def test_volume_profile(self):
        closes = [100 + (1 if i % 2 else -1) * 0.5 + i * 0.01 for i in range(40)]
        bars = make_bars(closes)
        for i, b in enumerate(bars):
            b.volume = 2000.0 if i and b.close > bars[i - 1].close else 1000.0
        v = scenarios.volume_profile(bars)
        self.assertGreaterEqual(v["up_down_volume_ratio"], 1.9)
        self.assertIn("買盤", v["note"])


class TestNewsDigest(unittest.TestCase):
    def test_price_reaction_before_and_after_close(self):
        bars = make_bars([100, 101, 103], start=(2026, 10, 19))  # 10-19, 10-20, 10-21
        intraday = news_digest.price_reaction(bars, "2026-10-20T10:00:00", "TW")
        self.assertEqual((intraday["from"], intraday["to"]), ("2026-10-19", "2026-10-20"))
        self.assertEqual(intraday["pct"], 1.0)
        after = news_digest.price_reaction(bars, "2026-10-20T14:00:00", "TW")  # 台股 13:30 收盤後
        self.assertEqual((after["from"], after["to"]), ("2026-10-20", "2026-10-21"))
        self.assertTrue(news_digest.price_reaction(bars, "2026-10-21T15:00:00", "TW")["pending"])

    def test_rule_fields(self):
        f = news_digest._rule_fields("台積電擴產先進封裝，9月營收年增54%", "新聞")
        self.assertIn("營收", f["metrics"])
        self.assertIn("資本支出", f["metrics"])
        self.assertEqual(f["horizon"], "短期與長期")
        self.assertTrue(news_digest._mentions("NVIDIA beats estimates", "NVDA", "NVIDIA Corporation"))
        self.assertFalse(news_digest._mentions("Hermès luxury slowdown", "NVDA", "NVIDIA"))


class TestPortfolioScenarios(unittest.TestCase):
    def test_beta_linear(self):
        out = portfolio_scenarios.beta_scenarios(1_000_000, 1.2)
        self.assertEqual([x["portfolio_move_pct"] for x in out], [-12.0, -24.0])
        self.assertEqual(out[1]["loss_twd"], -240000)

    def test_window_rejects_not_yet_listed(self):
        closes = {"2022-06-01": 10.0, "2022-06-02": 11.0, "2022-06-03": 12.0, "2022-06-06": 12.0, "2022-06-07": 12.0}
        self.assertIsNone(portfolio_scenarios._window(closes, "2022-01-03", "2022-10-31"))

    def test_corr(self):
        a = [math.sin(i) for i in range(100)]
        self.assertEqual(portfolio_scenarios._corr(a, a), 1.0)
        self.assertEqual(portfolio_scenarios._corr(a, [-x for x in a]), -1.0)


class TestExpectationGap(unittest.TestCase):
    def test_tw_rules(self):
        f = {"market": "TW", "quarterly": {"ttm_eps_yoy_pct": 5.0, "quarters": []},
             "revenue": {"yoy_3m_avg": 40.0, "yoy_prev3m_avg": 10.0}, "valuation": {"本益比": 35}}
        g = fundamentals.expectation_gap(f, {"6個月": 60.0})
        self.assertEqual(len(g["可能已反映在股價"]), 2)  # 漲幅遠大於獲利成長＋高本益比
        self.assertEqual(len(g["可能讓市場正向意外"]), 1)  # 月營收加速

    def test_us_rules(self):
        f = {"market": "US",
             "eps_history": [{"surprise_pct": 5}, {"surprise_pct": 3}, {"surprise_pct": 2}, {"surprise_pct": 1}],
             "estimates": [{"period": "明年度", "revision_90d_pct": -8.0, "eps_avg": 3.0}],
             "analyst": {"upside_pct": -3.0, "target_mean": 90, "count": 20},
             "valuation": {"本益比(TTM)": 40, "前瞻本益比": 20}}
        g = fundamentals.expectation_gap(f, {})
        self.assertEqual(len(g["可能已反映在股價"]), 3)
        self.assertEqual(len(g["可能讓市場負向意外"]), 1)


if __name__ == "__main__":
    unittest.main()
