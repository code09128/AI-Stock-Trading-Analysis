"""自訂策略（條件積木）：格式檢查、參數合併、訊號計算、不偷看未來、註冊與 Pine 轉換（全部離線）。"""

import math
import unittest
from datetime import date, timedelta

from src.backtest import custom_rules as cr
from src.backtest import pine_export, strategies
from src.market.bar import Bar


def make_bars(closes):
    out, d = [], date(2024, 1, 1)
    for c in closes:
        while d.weekday() >= 5:
            d += timedelta(days=1)
        out.append(Bar(d.isoformat(), c, c * 1.01, c * 0.99, c, 1000 + 500 * math.sin(len(out) / 5)))
        d += timedelta(days=1)
    return out


WAVE = [100 + 12 * math.sin(2 * math.pi * i / 40) + 0.03 * i for i in range(400)]
CROSS = {"name": "交叉",
         "entry": {"logic": "all", "rules": [{"left": {"type": "sma", "n": 5}, "op": "cross_up", "right": {"type": "sma", "n": 20}}]},
         "exit": {"logic": "any", "rules": [{"left": {"type": "sma", "n": 5}, "op": "cross_down", "right": {"type": "sma", "n": 20}}]}}


class TestCustomRules(unittest.TestCase):
    def test_matches_builtin_ma_cross(self):
        """「5 日均線上穿 20 日均線進、下穿出」要和內建雙均線同樣的訊號。"""
        bars = make_bars(WAVE)
        self.assertEqual(cr.signals(cr.normalize(CROSS), bars),
                         strategies.signals("ma_cross", bars, {"fast_ma": 5, "slow_ma": 20}))

    def test_shared_periods_become_one_param(self):
        specs = cr.describe(CROSS)["params"]
        self.assertEqual([s["default"] for s in specs], [5, 20])
        d = cr._apply(cr.normalize(CROSS), {"n2": 30})
        self.assertEqual(d["entry"]["rules"][0]["right"]["n"], 30)
        self.assertEqual(d["exit"]["rules"][0]["right"]["n"], 30)  # 進出場一起改

    def test_validation_errors(self):
        bad = [
            {},
            {"entry": {"rules": [{"left": {"type": "close"}, "op": "??", "right": {"type": "sma"}}]}, "exit": CROSS["exit"]},
            {"entry": {"rules": [{"left": {"type": "sma", "n": 999}, "op": ">", "right": {"type": "close"}}]}, "exit": CROSS["exit"]},
            {"entry": {"rules": [{"left": {"type": "close"}, "op": ">", "right": {"type": "close"}}]}, "exit": CROSS["exit"]},
            {"entry": {"rules": [CROSS["entry"]["rules"][0]] * 7}, "exit": CROSS["exit"]},
        ]
        for b in bad:
            with self.assertRaises(ValueError):
                cr.normalize(b)

    def test_templates_all_valid_and_no_lookahead(self):
        bars = make_bars(WAVE)
        extra = strategies.BarSeries(bars, {"inst": [round(500 * math.sin(i / 4)) for i in range(len(bars))]})
        cut = strategies.BarSeries(bars[:250], {"inst": extra.extra["inst"][:250]})
        for t in cr.TEMPLATES:
            d = cr.normalize(t)
            full = cr.signals(d, extra)
            self.assertEqual(cr.signals(d, cut), full[:250], t["name"])

    def test_register_is_content_addressed_and_works_everywhere(self):
        k1, k2 = cr.register(CROSS), cr.register(dict(CROSS))
        self.assertEqual(k1, k2)
        self.assertNotIn(k1, [c["key"] for c in strategies.catalog()])  # 自訂策略不進內建清單
        meta = strategies.STRATEGIES[k1]
        self.assertEqual(set(meta["grid"]), {"n1", "n2"})
        params = strategies.resolve_params(k1, {})
        code = pine_export.build("2330.TW", "TW", k1, params, 1e6, 0.6, {"sizing_mode": "percent", "sizing_value": 100})["code"]
        self.assertIn("ta.crossover(ta.sma(close, 5), ta.sma(close, 20))", code)

    def test_highest_excludes_today(self):
        bars = make_bars([1, 2, 3, 10])
        d = cr.normalize({"entry": {"rules": [{"left": {"type": "close"}, "op": ">", "right": {"type": "highest", "n": 3}}]},
                          "exit": {"rules": [{"left": {"type": "close"}, "op": "<", "right": {"type": "lowest", "n": 3}}]}})
        self.assertEqual(cr.signals(d, bars)[3], 1)  # 10 > 前 3 天最高 3


if __name__ == "__main__":
    unittest.main()
