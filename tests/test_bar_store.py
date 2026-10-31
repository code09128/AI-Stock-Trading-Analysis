"""日 K 本機快取：第一次整段抓、之後只補 1 個月、配息後還權比例調整、對不起來就重抓、斷線沿用本機（離線，寫到暫存資料夾）。"""

import tempfile
import time
import unittest
from datetime import date, timedelta
from pathlib import Path
from unittest.mock import patch

from src.market import bar_store, data_adapter
from src.market.data_adapter import DualMarketDataAdapter


def _rows(start: date, n: int, adj_ratio: float = 1.0, price: float = 100.0):
    out, d = [], start
    while len(out) < n:
        if d.weekday() < 5:
            c = price + len(out)
            out.append([d.isoformat(), c, c + 1, c - 1, c, 1000.0, c * adj_ratio])
        d += timedelta(days=1)
    return out


class MergeTests(unittest.TestCase):
    def test_dividend_rescales_old_adjclose(self):
        old = _rows(date(2026, 1, 5), 40, adj_ratio=0.9)
        new = [r[:6] + [r[4] * 0.9 * 0.95] for r in old[-20:]] + _rows(date(2026, 3, 2), 3, 0.9 * 0.95, 200)
        merged = bar_store.merge(old, new)
        self.assertEqual(len(merged), 43)
        self.assertAlmostEqual(merged[0][6], old[0][4] * 0.9 * 0.95)
        self.assertEqual(merged[-1], new[-1])

    def test_inconsistent_or_no_overlap_needs_refetch(self):
        old = _rows(date(2026, 1, 5), 40)
        half = [r[:6] + [r[4] * (0.95 if i < 10 else 1.0)] for i, r in enumerate(old[-20:])]  # 除息日落在重疊期間
        self.assertIsNone(bar_store.merge(old, half))
        self.assertIsNone(bar_store.merge(old, _rows(date(2026, 6, 1), 5)))
        self.assertEqual(bar_store.merge(old, []), old)


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        bar_store.enable(Path(self.tmp.name) / "bar_cache")  # 跟正式一樣放在子資料夾：daily() 存在它的上一層
        self.addCleanup(bar_store.disable)
        self.addCleanup(self.tmp.cleanup)
        self.calls = []
        self.full = _rows(date(2025, 1, 6), 260)
        p = patch.object(bar_store, "RECENT_SEC", 0)  # 預設每次都補抓，才測得到補抓流程
        p.start()
        self.addCleanup(p.stop)

    def test_recent_fetch_is_reused(self):
        """同一次計算裡 Beta、壓力測試、情境回放都要同一檔：60 秒內只補抓一次。"""
        with patch.object(bar_store, "RECENT_SEC", 60):
            bar_store.get("VTI", "1y", self.fetch)
            bar_store.get("VTI", "1y", self.fetch)
            bar_store.get("VTI", "1y", self.fetch)
        self.assertEqual(self.calls, ["1y"])

    def fetch(self, symbol, range_str):
        self.calls.append(range_str)
        if range_str == "1mo":
            return {"rows": self.full[-21:] + _rows(date(2026, 1, 5), 2, price=500), "currency": "TWD"}
        return {"rows": self.full, "currency": "TWD"}

    def test_full_then_increment_then_upgrade(self):
        first = bar_store.get("0050.TW", "1y", self.fetch)
        self.assertEqual(len(first["rows"]), 260)
        second = bar_store.get("0050.TW", "1y", self.fetch)
        self.assertEqual(len(second["rows"]), 262)
        bar_store.get("0050.TW", "10y", self.fetch)  # 本機只有 1 年：要整段抓 10 年
        self.assertEqual(self.calls, ["1y", "1mo", "10y"])
        self.assertIsNotNone(bar_store.peek("0050.TW", "2025-01-06"))
        self.assertIsNone(bar_store.peek("0050.TW", "2020-01-01"))

    def test_offline_uses_local_copy(self):
        bar_store.get("NVDA", "1y", self.fetch)

        def down(symbol, range_str):
            raise OSError("斷線")
        self.assertEqual(len(bar_store.get("NVDA", "1y", down)["rows"]), 260)
        with self.assertRaises(OSError):
            bar_store.get("AAPL", "1y", down)

    def test_daily_cache(self):
        """ETF 成分股：一天內不重抓；過期後抓失敗或抓回空的沿用舊資料；None 只信 1 小時。"""
        calls = []

        def load():
            calls.append(1)
            return {"holdings": [1]}
        self.assertEqual(bar_store.daily("etf_holdings", "0050", load), {"holdings": [1]})
        self.assertEqual(bar_store.daily("etf_holdings", "0050", load), {"holdings": [1]})
        self.assertEqual(len(calls), 1)
        later = time.time() + 2 * 86400
        with patch.object(bar_store.time, "time", return_value=later):
            self.assertEqual(bar_store.daily("etf_holdings", "0050", lambda: None), {"holdings": [1]})
            self.assertEqual(bar_store.daily("etf_holdings", "0050", self._boom), {"holdings": [1]})
        self.assertIsNone(bar_store.daily("etf_holdings", "2330", lambda: None))
        with patch.object(bar_store.time, "time", return_value=time.time() + 7200):
            self.assertEqual(bar_store.daily("etf_holdings", "2330", load), {"holdings": [1]})  # None 過 1 小時就重問

    @staticmethod
    def _boom():
        raise OSError("斷線")

    def test_adapter_uses_store_and_matches_direct_download(self):
        """接上 data_adapter：第二次（記憶體快取過期後）只補抓 1 個月，結果與直接下載轉出來的 K 線一樣。"""
        a = DualMarketDataAdapter()
        with patch.object(a, "_load_yahoo_raw", side_effect=lambda s, r="", span="": self.fetch(s, r)):
            data_adapter.clear_bar_cache()
            b1 = a._fetch_from_yahoo("0050.TW", days=250)
            data_adapter.clear_bar_cache()
            b2 = a._fetch_from_yahoo("0050.TW", days=250)
            data_adapter.clear_bar_cache()
            period = a.fetch_period("0050.TW", "2025-03-03", "2025-03-07")
        self.assertEqual(self.calls, ["1y", "1mo"])  # 情境回放直接用本機資料，不連網
        self.assertEqual(b1, data_adapter.rows_to_bars(self.full)[-250:])
        self.assertEqual(b2[-1].timestamp, "2026-01-06")
        self.assertEqual([b.timestamp for b in period], ["2025-03-03", "2025-03-04", "2025-03-05", "2025-03-06",
                                                         "2025-03-07"])
        data_adapter.clear_bar_cache()


if __name__ == "__main__":
    unittest.main()
