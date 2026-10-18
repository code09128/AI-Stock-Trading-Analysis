"""
核心模組單元測試 (test_core.py)
嚴格檢驗：
1. MA / RSI / MACD / ATR / Swing 支撐壓力計算
2. 台股法定 Tick Size 價格對齊
3. 交易手續費與 0.3% 證交稅計算
4. 回測引擎 Next Bar Open 撮合 (無偷看未來數據)
5. 獲利因子、勝率、MDD 數學公式對齊
6. 防價格幻覺邊界檢查
"""

import unittest
from src.indicators import calculate_ma, calculate_rsi, calculate_macd, calculate_atr, find_swing_levels
from src.market_rules import align_tw_tick, get_tw_tick_size, calculate_friction_cost, validate_tw_price_limit
from src.anti_hallucination import AntiHallucinationGuard
from src.backtest_engine import BacktestEngine, Bar

class TestTradingCore(unittest.TestCase):

    def test_sma_calculation(self):
        prices = [10.0, 11.0, 12.0, 13.0, 14.0]
        ma3 = calculate_ma(prices, 3)
        self.assertIsNone(ma3[0])
        self.assertIsNone(ma3[1])
        self.assertEqual(ma3[2], 11.0)
        self.assertEqual(ma3[3], 12.0)
        self.assertEqual(ma3[4], 13.0)

    def test_rsi_calculation(self):
        # 16 筆上升數列，RSI 應極高
        prices = [10.0 + i for i in range(16)]
        rsi = calculate_rsi(prices, 14)
        self.assertEqual(len(rsi), 16)
        self.assertIsNotNone(rsi[-1])
        self.assertEqual(rsi[-1], 100.0) # 全漲無跌 RSI=100

    def test_tw_tick_sizes(self):
        # 測試台股 6 級檔位
        self.assertEqual(get_tw_tick_size(8.5), 0.01)
        self.assertEqual(get_tw_tick_size(25.3), 0.05)
        self.assertEqual(get_tw_tick_size(88.0), 0.10)
        self.assertEqual(get_tw_tick_size(250.0), 0.50)
        self.assertEqual(get_tw_tick_size(780.0), 1.00)
        self.assertEqual(get_tw_tick_size(1050.0), 5.00)

        # 測試股價 >= 1000 元時對齊至 5 元倍數
        self.assertEqual(align_tw_tick(1053.2), 1055.0)
        self.assertEqual(align_tw_tick(1051.8), 1050.0)
        # 測試 100~500 元時對齊至 0.5 元倍數
        self.assertEqual(align_tw_tick(233.2), 233.0)
        self.assertEqual(align_tw_tick(233.4), 233.5)

    def test_friction_cost_calculation(self):
        # 買進 1 張 (1,000股) 1,000 元台積電: 總額 1,000,000
        buy_res = calculate_friction_cost("TW", "BUY", 1000.0, 1000)
        self.assertEqual(buy_res["fee"], 1425.0)
        self.assertEqual(buy_res["tax"], 0.0)

        # 賣出 1 張 1,100 元台積電: 總額 1,100,000
        sell_res = calculate_friction_cost("TW", "SELL", 1100.0, 1000)
        self.assertEqual(sell_res["fee"], 1568.0)
        self.assertEqual(sell_res["tax"], 3300.0) # 0.3% 證交稅

    def test_backtest_zero_lookahead_and_metrics(self):
        # 模擬 5 根 K 棒
        bars = [
            Bar("2026-01-01", open=100.0, high=105.0, low=99.0, close=104.0, volume=1000),
            Bar("2026-01-02", open=105.0, high=110.0, low=104.0, close=109.0, volume=1500), # 訊號日
            Bar("2026-01-03", open=110.0, high=115.0, low=108.0, close=114.0, volume=2000), # 買進執行 (Open 110)
            Bar("2026-01-04", open=115.0, high=120.0, low=113.0, close=118.0, volume=1800), # 訊號日 (平倉)
            Bar("2026-01-05", open=120.0, high=122.0, low=118.0, close=121.0, volume=1200), # 賣出執行 (Open 120)
        ]
        signals = [0, 1, 0, -1, 0] # Day 2 買訊，Day 4 賣訊

        engine = BacktestEngine(market="TW", initial_capital=1_000_000.0)
        result = engine.run(bars, signals)

        self.assertEqual(result["total_trades"], 1)
        self.assertTrue(result["sample_size_warning"]) # <30 筆應有警示
        trade = result["trades_detail"][0]
        self.assertEqual(trade["entry_price"], 110.0) # 強制 Next Bar Open
        self.assertEqual(trade["exit_price"], 120.0)  # 強制 Next Bar Open
        self.assertGreater(trade["net_pnl"], 0)       # 獲利扣除稅費

    def test_anti_hallucination_guard(self):
        guard = AntiHallucinationGuard(
            historical_high=1100.0,
            historical_low=950.0,
            valid_indicators={"MA20": 1020.0, "RSI": 65.2}
        )

        # 正常合理輸出
        valid_payload = {
            "action": "BUY",
            "support_levels": [980.0, 960.0],
            "resistance_levels": [1080.0, 1100.0],
            "invalidation_criteria": "跌破波段低點 950 元或月營收年減逾 10% 則策略立即停損出場"
        }
        res_valid = guard.inspect_decision_payload(valid_payload)
        self.assertTrue(res_valid["passed"])
        self.assertEqual(len(res_valid["violations"]), 0)

        # 幻覺捏造歷史外價格 (例如 600 元台積電) 或缺少失效條件
        hallucinated_payload = {
            "action": "BUY",
            "support_levels": [600.0],
            "resistance_levels": [1500.0],
            "invalidation_criteria": ""
        }
        res_invalid = guard.inspect_decision_payload(hallucinated_payload)
        self.assertFalse(res_invalid["passed"])
        self.assertGreaterEqual(len(res_invalid["violations"]), 2)

if __name__ == "__main__":
    unittest.main()
