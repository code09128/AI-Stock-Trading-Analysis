import unittest
from src.market.bar import Bar
from src.market.data_adapter import DualMarketDataAdapter


class TestLiveTechnicalIndicators(unittest.TestCase):
    def setUp(self):
        self.adapter = DualMarketDataAdapter()
        # 建立 30 根基準日 K 棒，價格穩定在 100
        self.bars = [
            Bar(
                timestamp=f"2026-10-{i:02d}",
                open=100.0,
                high=102.0,
                low=98.0,
                close=100.0,
                volume=1000.0,
            )
            for i in range(1, 24)
        ]

    def test_merge_realtime_bar_same_day_update(self):
        """當日報價存在時，以即時成交價更新當日最後一根 K 棒，且不污染原始列表"""
        quote = {
            "is_live": True,
            "price": 110.0,
            "open": 101.0,
            "high": 112.0,
            "low": 99.0,
            "volume": 2500.0,
            "quote_date_local": "20261023",
            "quote_time": "2026-10-23 11:30:00",
            "source": "TWSE MIS",
        }
        original_last_close = self.bars[-1].close
        merged, info = self.adapter.merge_realtime_bar(self.bars, quote)

        self.assertTrue(info["applied"])
        self.assertEqual(info["mode"], "update")
        self.assertEqual(merged[-1].close, 110.0)
        self.assertEqual(merged[-1].high, 112.0)
        self.assertEqual(merged[-1].volume, 2500.0)
        # 確保原 bars 未被修改
        self.assertEqual(self.bars[-1].close, original_last_close)

    def test_merge_realtime_bar_next_day_append(self):
        """盤中日 K 尚未生成今日 bar 時，自動追加一根今日盤中 K 棒"""
        quote = {
            "is_live": True,
            "price": 105.0,
            "open": 102.0,
            "high": 106.0,
            "low": 101.0,
            "volume": 3000.0,
            "quote_date_local": "20261024",
            "quote_time": "2026-10-24 10:15:00",
            "source": "Yahoo",
        }
        merged, info = self.adapter.merge_realtime_bar(self.bars, quote)

        self.assertTrue(info["applied"])
        self.assertEqual(info["mode"], "append")
        self.assertEqual(len(merged), len(self.bars) + 1)
        self.assertEqual(merged[-1].timestamp, "2026-10-24")
        self.assertEqual(merged[-1].close, 105.0)

    def test_indicators_incorporate_live_price(self):
        """驗證 build_technical_snapshot 納入即時報價後，MA 與最新價格即時連動"""
        snap_no_live = self.adapter.build_technical_snapshot("2330.TW", include_live=False)
        base_price = snap_no_live["latest_close"]
        live_quote = {
            "is_live": True,
            "price": base_price + 200.0,
            "open": base_price + 10.0,
            "high": base_price + 210.0,
            "low": base_price,
            "volume": 5000.0,
            "quote_date_local": "20261024",
            "quote_time": "2026-10-24 13:00:00",
            "source": "TWSE MIS",
        }
        snap = self.adapter.build_technical_snapshot("2330.TW", quote=live_quote, include_live=True)
        self.assertEqual(snap["latest_close"], base_price + 200.0)
        self.assertTrue(snap["live_overlay"]["applied"])
        self.assertGreater(snap["indicators"]["MA5"], snap_no_live["indicators"]["MA5"])

    def test_offline_or_invalid_quote_graceful_fallback(self):
        """報價無效或離線時，安全回退不報錯"""
        invalid_quote = {"is_live": False, "price": None}
        merged, info = self.adapter.merge_realtime_bar(self.bars, invalid_quote)
        self.assertFalse(info["applied"])
        self.assertEqual(len(merged), len(self.bars))


if __name__ == "__main__":
    unittest.main()
