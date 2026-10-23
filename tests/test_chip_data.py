"""籌碼面統計（離線，不連網）。"""

import unittest
from unittest.mock import patch

from src.market import chip_data
from src.market.chip_data import _streak, summarize


def _inst(days):
    """days: [(date, 外資淨股數, 投信淨股數)]"""
    rows = []
    for d, f, t in days:
        rows += [{"date": d, "name": "Foreign_Investor", "buy": max(f, 0), "sell": max(-f, 0)},
                 {"date": d, "name": "Foreign_Dealer_Self", "buy": 0, "sell": 0},
                 {"date": d, "name": "Investment_Trust", "buy": max(t, 0), "sell": max(-t, 0)},
                 {"date": d, "name": "Dealer_self", "buy": 1000, "sell": 0},
                 {"date": d, "name": "Dealer_Hedging", "buy": 0, "sell": 0}]
    return rows


DATES = [f"2026-10-{d:02d}" for d in range(1, 23)]


class ChipSummaryTests(unittest.TestCase):
    def test_streak(self):
        self.assertEqual(_streak([1, -2, -3, -4]), -3)
        self.assertEqual(_streak([-1, 2, 3]), 2)
        self.assertEqual(_streak([5, 0]), 0)
        self.assertEqual(_streak([]), 0)

    def test_net_sums_in_lots_and_notes(self):
        inst = _inst([(d, -2_000_000, 500_000) for d in DATES])
        margin = [{"date": d, "MarginPurchaseTodayBalance": 1000 + i * 10, "ShortSaleTodayBalance": 400,
                   "MarginPurchaseLimit": 100000} for i, d in enumerate(DATES)]
        hold = [{"date": d, "ForeignInvestmentSharesRatio": 70 - i * 0.1} for i, d in enumerate(DATES)]
        s = summarize(inst, margin, hold)
        self.assertEqual(s["institutional"]["foreign"]["net_5d"], -10_000)
        self.assertEqual(s["institutional"]["foreign"]["net_20d"], -40_000)
        self.assertEqual(s["institutional"]["trust"]["streak"], 22)
        self.assertEqual(s["institutional"]["dealer"]["net_5d"], 5)
        self.assertEqual(s["margin"]["margin_change_5d"], 50)
        self.assertEqual(s["margin"]["short_margin_ratio_pct"], round(400 / 1210 * 100, 2))
        self.assertEqual(s["foreign_holding"]["change_5d_pct"], -0.5)
        self.assertEqual(s["latest_date"], "2026-10-22")
        self.assertEqual(len(s["daily"]), 20)
        joined = " ".join(s["notes"])
        self.assertIn("外資連續 22 日賣超", joined)
        self.assertIn("籌碼由法人流向散戶", joined)
        self.assertIn("券資比", joined)

    def test_missing_dataset_is_none_not_fake(self):
        s = summarize(None, None, None)
        self.assertIsNone(s["institutional"])
        self.assertIsNone(s["margin"])
        self.assertIsNone(s["foreign_holding"])
        self.assertEqual(s["daily"], [])

    def test_us_symbol_not_supported(self):
        self.assertFalse(chip_data.chips("NVDA")["supported"])

    def test_partial_failure_reports_errors(self):
        chip_data._CACHE.clear()

        def fake(ds, code, start):
            if ds == chip_data.DATASETS["holding"]:
                raise RuntimeError("timeout")
            return []

        with patch.object(chip_data, "_finmind", side_effect=fake):
            r = chip_data.chips("9999")
        self.assertTrue(r["supported"])
        self.assertEqual(len(r["errors"]), 1)
        chip_data._CACHE.clear()


if __name__ == "__main__":
    unittest.main()
