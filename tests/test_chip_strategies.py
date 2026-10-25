"""籌碼／月營收策略：FinMind 本機快取（增量補抓、失敗沿用舊資料）、月營收公布日、資料對齊（全部離線）。"""

import shutil
import tempfile
import time
import unittest
from datetime import date
from pathlib import Path
from unittest import mock

from src.backtest import chip_features, strategies
from src.market import finmind_store
from src.market.bar import Bar


def bars_for(dates):
    return [Bar(d, 100, 101, 99, 100, 1000) for d in dates]


class TestFinMindStore(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.patch = mock.patch.object(finmind_store, "cache_dir", lambda: self.dir)
        self.patch.start()

    def tearDown(self):
        self.patch.stop()
        shutil.rmtree(self.dir, ignore_errors=True)

    def test_first_full_then_cache_then_incremental(self):
        calls = []

        def fetch(dataset, code, start):
            calls.append(start)
            if len(calls) == 1:
                return [{"date": "2026-01-02", "MarginPurchaseTodayBalance": 100},
                        {"date": "2026-01-20", "MarginPurchaseTodayBalance": 90}]
            return [{"date": "2026-01-20", "MarginPurchaseTodayBalance": 95},  # 修正過的舊資料
                    {"date": "2026-02-01", "MarginPurchaseTodayBalance": 80}]

        ds = "TaiwanStockMarginPurchaseShortSale"
        r1 = finmind_store.history(ds, "2330", "2026-01-01", fetch)
        self.assertEqual((r1["source"], len(r1["rows"])), ("fetched", 2))
        r2 = finmind_store.history(ds, "2330", "2026-01-01", fetch)
        self.assertEqual(r2["source"], "cache")  # 6 小時內不重抓
        self.assertEqual(len(calls), 1)
        with mock.patch.object(finmind_store.time, "time", return_value=time.time() + finmind_store.REFRESH_SEC + 5):
            r3 = finmind_store.history(ds, "2330", "2026-01-01", fetch)
        self.assertEqual(calls[1], "2026-01-10")  # 從最後一筆往前 10 天補抓
        self.assertEqual([x["MarginPurchaseTodayBalance"] for x in r3["rows"]], [100, 95, 80])

    def test_fetch_failure_uses_stale_cache(self):
        ds = "TaiwanStockMarginPurchaseShortSale"
        finmind_store.history(ds, "2454", "2026-01-01", lambda *a: [{"date": "2026-01-02", "MarginPurchaseTodayBalance": 1}])

        def boom(*_a):
            raise RuntimeError("FinMind 402")

        with mock.patch.object(finmind_store.time, "time", return_value=time.time() + finmind_store.REFRESH_SEC + 5):
            r = finmind_store.history(ds, "2454", "2026-01-01", boom)
        self.assertTrue(r["stale"])
        self.assertIn("402", r["error"])
        self.assertEqual(len(r["rows"]), 1)
        with self.assertRaises(RuntimeError):  # 沒有快取時照樣拋錯
            finmind_store.history(ds, "9999", "2026-01-01", boom)

    def test_inst_rows_keyed_by_investor_type(self):
        ds = "TaiwanStockInstitutionalInvestorsBuySell"
        rows = [{"date": "2026-01-02", "name": "Foreign_Investor", "buy": 1, "sell": 0},
                {"date": "2026-01-02", "name": "Investment_Trust", "buy": 1, "sell": 0}]
        r = finmind_store.history(ds, "2330", "2026-01-01", lambda *a: rows)
        self.assertEqual(len(r["rows"]), 2)


class TestAlignment(unittest.TestCase):
    def test_revenue_known_only_from_10th_of_next_month(self):
        self.assertEqual(chip_features.revenue_available_on(2026, 9), date(2026, 10, 10))
        self.assertEqual(chip_features.revenue_available_on(2026, 12), date(2027, 1, 10))
        rows = [{"revenue_year": 2025, "revenue_month": 9, "revenue": 50},
                {"revenue_year": 2026, "revenue_month": 9, "revenue": 100}]
        bars = bars_for(["2026-10-08", "2026-10-09", "2026-10-12"])
        rev = chip_features.align_revenue(bars, rows)
        self.assertEqual(rev[1]["month"], "2025-09")  # 10/9 還看不到 9 月營收
        self.assertEqual(rev[2]["month"], "2026-09")  # 10/10 起才看得到（10/12 是之後第一個交易日）
        self.assertEqual(rev[2]["yoy_pct"], 100.0)

    def test_inst_sums_groups_in_lots_and_margin_forward_fills(self):
        bars = bars_for(["2026-01-02", "2026-01-05", "2026-01-06"])
        inst = chip_features.align_inst(bars, [
            {"date": "2026-01-02", "name": "Foreign_Investor", "buy": 5000, "sell": 1000},
            {"date": "2026-01-02", "name": "Investment_Trust", "buy": 0, "sell": 2000},
            {"date": "2026-01-02", "name": "total", "buy": 99999, "sell": 0},  # 合計列不能重複加
        ])
        self.assertEqual(inst, [2, None, None])
        mg = chip_features.align_margin(bars, [{"date": "2026-01-02", "MarginPurchaseTodayBalance": 10},
                                               {"date": "2026-01-06", "MarginPurchaseTodayBalance": 8}])
        self.assertEqual(mg, [10, 10, 8])


class TestChipStrategies(unittest.TestCase):
    def test_inst_buy_streaks(self):
        bars = bars_for([f"2026-01-{d:02d}" for d in range(1, 11)])
        s = strategies.BarSeries(bars, {"inst": [1, 1, 1, 0, -1, -1, 5, None, 3, 3]})
        sig = strategies.signals("inst_buy", s, {"days": 3, "exit_days": 2})
        self.assertEqual(sig[2], 1)   # 連 3 天買超
        self.assertEqual(sig[5], -1)  # 連 2 天賣超
        self.assertEqual(sig[9], 0)   # None 中斷連續，第 8～9 天只有 2 天

    def test_margin_down_entry(self):
        bars = [Bar(f"2026-02-{d:02d}", p, p, p, p, 1000) for d, p in zip(range(1, 9), [10, 10, 10, 11, 12, 13, 14, 15])]
        s = strategies.BarSeries(bars, {"margin": [100, 100, 100, 100, 90, 90, 90, 90]})
        sig = strategies.signals("margin_down", s, {"days": 3, "drop_pct": 5, "ma": 3})
        self.assertEqual(sig.index(1), 4)


if __name__ == "__main__":
    unittest.main()
