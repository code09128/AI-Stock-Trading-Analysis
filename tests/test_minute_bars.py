"""技術分析分 K：只含已收完的棒、均線與布林、週期檢查（離線，不連網）。"""

import time
import unittest
from unittest.mock import patch

from src.market import chart_data


def fake_chart(n=70, step=300, last_open=False):
    now = int(time.time())
    base = now - n * step - (0 if not last_open else step // 2)
    ts = [base + i * step for i in range(n)]
    close = [100 + (i % 5) for i in range(n)]
    return {
        "meta": {"gmtoffset": 28800},
        "timestamp": ts,
        "indicators": {"quote": [{
            "open": [c - 0.5 for c in close], "high": [c + 1 for c in close], "low": [c - 1 for c in close],
            "close": close, "volume": [1000 + i for i in range(n)],
        }]},
    }


class MinuteBarsTests(unittest.TestCase):
    def setUp(self):
        chart_data._CACHE.clear() if hasattr(chart_data._CACHE, "clear") else None

    def test_rejects_unsupported_interval(self):
        with self.assertRaises(ValueError):
            chart_data.minute_bars("2330", 7)

    def test_returns_closed_bars_with_ma_and_bollinger(self):
        with patch.object(chart_data, "_chart", return_value=fake_chart()):
            out = chart_data.minute_bars("MIN1-2330", 5)
        bars = out["bars"]
        self.assertGreater(len(bars), 60)
        self.assertEqual(out["interval"], 5)
        self.assertRegex(bars[0]["date"], r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$")
        self.assertIsNone(bars[10]["ma20"])
        self.assertIsNotNone(bars[30]["ma20"])
        self.assertIsNotNone(bars[65]["ma60"])
        self.assertGreater(bars[30]["bb_upper"], bars[30]["ma20"])
        self.assertLess(bars[30]["bb_lower"], bars[30]["ma20"])

    def test_unclosed_last_bar_is_dropped(self):
        now = int(time.time())
        res = fake_chart(10)
        res["timestamp"][-1] = now - 10  # 這根 5 分鐘還沒收完
        with patch.object(chart_data, "_chart", return_value=res):
            out = chart_data.minute_bars("MIN2-2330", 5)
        self.assertEqual(len(out["bars"]), 9)

    def test_failure_is_reported_not_faked(self):
        with patch.object(chart_data, "_chart", side_effect=RuntimeError("boom")):
            with self.assertRaises(RuntimeError) as cm:
                chart_data.minute_bars("MIN3-2330", 15)
        self.assertIn("boom", str(cm.exception))


if __name__ == "__main__":
    unittest.main()
