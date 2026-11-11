"""K 線收盤規則訊號（離線，用合成 K 棒）。"""

import unittest

from src.market.bar import Bar
from src.technical import kline_rules
from src.technical.kline_rules import compute, trend_of, visible


def _bar(i, o, h, l, c, v=1000):
    return Bar(timestamp=f"2026-01-{i + 1:03d}", open=o, high=h, low=l, close=c, volume=v)


def _path(closes, spread=0.5, volumes=None):
    """用收盤價序列造 K 棒：開盤＝前一根收盤，高低各加減 spread。"""
    bars = []
    for i, c in enumerate(closes):
        o = closes[i - 1] if i else c
        bars.append(_bar(i, o, max(o, c) + spread, min(o, c) - spread, c, (volumes or {}).get(i, 1000)))
    return bars


def _zigzag(points, step=1.0):
    """把轉折價連成每根走 step 的收盤價序列。"""
    closes = [points[0]]
    for target in points[1:]:
        while abs(target - closes[-1]) > 1e-9:
            d = min(step, abs(target - closes[-1]))
            closes.append(closes[-1] + (d if target > closes[-1] else -d))
    return closes


UP = _zigzag([100, 110, 105, 116, 111, 124])  # 頭頭高、底底高
DOWN = _zigzag([124, 114, 119, 108, 113, 100])  # 頭頭低、底底低


class KlineRuleTests(unittest.TestCase):
    def test_too_few_bars_gives_nothing(self):
        res = compute(_path([100.0] * 3))
        self.assertEqual((res["signals"], res["pivots"], res["trend"]), ([], [], "range"))

    def test_pivots_alternate_and_are_confirmed_late(self):
        bars = _path(UP)
        res = compute(bars)
        kinds = [p["kind"] for p in res["pivots"]]
        self.assertTrue(all(a != b for a, b in zip(kinds, kinds[1:])))
        # 少給最後幾根：還沒走完的頭底不能提早出現
        early = compute(bars[:12])
        self.assertTrue(all(p["index"] + kline_rules.PIVOT_SPAN <= 11 for p in early["pivots"]))

    def test_uptrend_is_bull_and_marks_confirm(self):
        res = compute(_path(UP + [123, 122, 121, 122]))  # 最後多走幾根讓最後一個頭被確認
        self.assertEqual(res["trend"], "bull")
        buys = [s for s in res["signals"] if s["label"] == "多頭確認"]
        self.assertTrue(buys)
        self.assertTrue(all(s["type"] == "buy" and "突破前一個頭" in s["reason"] for s in buys))

    def test_long_exits_only_when_close_breaks_previous_low(self):
        bars = _path(UP)
        res = compute(bars)
        by_date = {b.timestamp: i for i, b in enumerate(bars)}
        exits = [s for s in res["signals"] if s["label"] == "出場"]
        for s in exits:
            i = by_date[s["date"]]
            self.assertLess(bars[i].close, bars[i - 1].low)
        # 多頭確認之後、出場之前，每一根收盤都沒有跌破前一天低點
        first_buy = next(s for s in res["signals"] if s["label"] == "多頭確認")
        start = by_date[first_buy["date"]]
        end = by_date[exits[0]["date"]] if exits and by_date[exits[0]["date"]] > start else len(bars)
        for i in range(start + 1, end):
            self.assertGreaterEqual(bars[i].close, bars[i - 1].low)

    def test_intraday_dip_below_previous_low_does_not_exit(self):
        closes = UP + [125, 126]
        bars = _path(closes)
        i = len(bars) - 1
        bars[i] = _bar(i, 125, 126.5, 110, 126)  # 盤中殺低但收盤站回
        self.assertNotEqual(compute(bars)["signals"][-1]["label"], "出場")

    def test_downtrend_is_bear_and_marks_short_then_cover(self):
        res = compute(_path(DOWN + [101, 102, 103, 102]))
        self.assertEqual(res["trend"], "bear")
        labels = [s["label"] for s in res["signals"]]
        self.assertIn("空頭確認", labels)
        self.assertIn("回補", labels)
        self.assertLess(labels.index("空頭確認"), labels.index("回補"))

    def test_flat_market_has_no_signal(self):
        res = compute(_path([100.0] * 60))
        self.assertEqual(res["signals"], [])
        self.assertEqual(res["trend"], "range")

    def test_trend_needs_both_heads_and_bottoms(self):
        mixed = [
            {"kind": "high", "price": 110}, {"kind": "low", "price": 100},
            {"kind": "high", "price": 115}, {"kind": "low", "price": 95},  # 頭墊高但底破低
        ]
        self.assertEqual(trend_of(mixed), "range")

    def test_big_volume_long_upper_shadow_at_high_warns(self):
        closes = [100 + i * 0.5 for i in range(30)]
        bars = _path(closes)
        i = len(bars)
        last = closes[-1]
        bars.append(_bar(i, last, last + 8, last - 0.2, last + 0.5, v=3000))  # 創新高、爆量、長上影
        res = compute(bars)
        self.assertIn(bars[-1].timestamp, res["big_volume"])
        warns = [s for s in res["signals"] if s["type"] == "warn"]
        self.assertTrue(warns and "長上影線" in warns[-1]["reason"])

    def test_same_shape_without_volume_does_not_warn(self):
        closes = [100 + i * 0.5 for i in range(30)]
        bars = _path(closes)
        last = closes[-1]
        bars.append(_bar(len(bars), last, last + 8, last - 0.2, last + 0.5, v=1000))
        self.assertEqual([s for s in compute(bars)["signals"] if s["type"] == "warn"], [])

    def test_provisional_last_bar_is_unconfirmed(self):
        bars = _path(UP)
        n = len(bars)
        for s in compute(bars, last_provisional=True)["signals"]:
            self.assertEqual(s["confirmed"], s["index"] != n - 1)

    def test_visible_filters_by_first_date_and_reports_errors(self):
        bars = _path(UP)
        cut = bars[20].timestamp
        res, err = visible(bars, cut)
        self.assertIsNone(err)
        self.assertTrue(all(s["date"] >= cut and "index" not in s for s in res["signals"]))
        self.assertTrue(all(p["date"] >= cut for p in res["pivots"]))
        res, err = visible(None, cut)  # type: ignore[arg-type]
        self.assertEqual(res["signals"], [])
        self.assertIn("計算失敗", err)


class KlineRuleWiringTests(unittest.TestCase):
    def test_ai_prompt_carries_trend_pivots_and_stats(self):
        from unittest.mock import patch

        from src.ai import ai_client

        res, _ = visible(_path(UP + [123, 122, 121, 122]), "2026-01-001")
        with patch.object(ai_client, "is_enabled", return_value=True):
            user = ai_client._build_explain_prompt(
                {"provider": "claude", "model": "x"}, "mod1", {"snapshot": {"symbol": "2330"}, "kline_rules": res}, "")[0]
        self.assertIn("K 線收盤規則", user)
        self.assertIn("多頭（頭頭高、底底高）", user)
        self.assertIn("多頭確認", user)
        self.assertIn("48.4%", user)  # 歷史統計要一起給，AI 才不會說成有優勢

    def test_candles_endpoint_returns_rule_marks(self):
        from unittest.mock import patch

        from src.market import chart_data

        bars = _path(UP + [123, 122, 121, 122])
        quote = {k: [getattr(b, k) for b in bars] for k in ("open", "high", "low", "close", "volume")}
        fake = {"timestamp": [1767225600 + i * 86400 for i in range(len(bars))], "indicators": {"quote": [quote]}}
        with patch.object(chart_data, "_chart", return_value=fake), patch.object(chart_data, "_get", return_value=None), \
                patch.object(chart_data, "_put"):
            data = chart_data.candles("2330", 60)
        self.assertIsNone(data["kline_rules_error"])
        self.assertEqual(data["kline_rules"]["trend"], "bull")
        shown = {b["date"] for b in data["bars"]}
        self.assertTrue(data["kline_rules"]["signals"])
        self.assertTrue(all(s["date"] in shown for s in data["kline_rules"]["signals"]))


if __name__ == "__main__":
    unittest.main()
