import unittest

from src.market.bar import Bar
from src.technical import intraday as I


class BarBuilderTests(unittest.TestCase):
    def test_ohlc_and_volume_from_cumulative(self):
        b = I.BarBuilder(60)
        for ts, p, v in [(0, 10, 100), (20, 12, 130), (40, 9, 150), (65, 10, 170), (110, 11, 220), (125, 11, 230)]:
            b.feed(ts, p, v)
        bars = b.bars(now=130)
        self.assertEqual(len(bars), 2)  # 第 3 根(120~180)還沒收完
        self.assertEqual((bars[0].open, bars[0].high, bars[0].low, bars[0].close), (10, 12, 9, 9))
        self.assertEqual(bars[1].volume, 220 - 150)
        self.assertEqual(len(b.bars(now=130, include_open=True)), 3)

    def test_ignores_bad_price_and_out_of_order(self):
        b = I.BarBuilder(60)
        b.feed(100, None, 1)
        b.feed(100, 0, 1)
        b.feed(100, 5, 10)
        b.feed(10, 99, 11)
        self.assertEqual(len(b.bars(now=1000)), 1)
        self.assertEqual(b.bars(now=1000)[0].high, 5)

    def test_cumulative_reset_starts_new_day(self):
        b = I.BarBuilder(60)
        b.feed(0, 10, 500)
        b.feed(61, 11, 600)
        b.feed(200000, 20, 5)
        bars = b.bars(now=300000)
        self.assertEqual([x.close for x in bars], [20])

    def test_invalid_interval(self):
        with self.assertRaises(ValueError):
            I.BarBuilder(0)


class ClosedBarsTests(unittest.TestCase):
    def test_drops_open_null_and_zero_volume_tail(self):
        rows = [(0, 1, 2, 1, 2, 10), (60, 2, 3, 2, 3, 20), (120, None, None, None, None, None),
                (180, 3, 3, 3, 3, 0), (240, 3, 4, 3, 4, 5)]
        out = I.closed_bars_only(rows, now=250, interval_sec=60)
        self.assertEqual([b.timestamp for b in out], ["0", "60"])  # 240 那根未收完、180 是量 0 的暫定棒


class BollingerTests(unittest.TestCase):
    def test_not_enough_data(self):
        self.assertIsNone(I.bollinger([1, 2])[-1])
        self.assertIsNone(I.bollinger_signal([Bar("0", 1, 1, 1, 1, 1)] * 5))

    def test_flat_series_has_zero_width(self):
        r = I.bollinger([10.0] * 20)[-1]
        self.assertEqual((r["upper"], r["lower"], r["width"]), (10.0, 10.0, 0.0))

    def _bars(self, closes):
        return [Bar(str(i), c, c, c, c, 1) for i, c in enumerate(closes)]

    def test_breakout_and_breakdown(self):
        base = [10.0, 10.2] * 10
        up = I.bollinger_signal(self._bars(base + [12.0]))
        down = I.bollinger_signal(self._bars(base + [8.0]))
        self.assertEqual(up["kind"], "break_up")
        self.assertEqual(down["kind"], "break_down")

    def test_back_inside_after_break(self):
        base = [10.0, 10.2] * 10
        s = I.bollinger_signal(self._bars(base + [12.0, 10.1]))
        self.assertEqual(s["kind"], "back_from_upper")


if __name__ == "__main__":
    unittest.main()
