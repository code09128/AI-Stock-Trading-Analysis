"""
全套串接與本機 API 伺服器驗證測試 (test_integration.py)
嚴格遵循 Rule 9 — Tests verify intent, not just behavior：
1. 驗證雙市場代號路由：確保台股純數字代號不會誤用美股 Tick ($0.01) 與零證交稅
2. 驗證技術快照與防幻覺閉環：確保 build_technical_snapshot 產出的支撐壓力 100% 對齊台股 Tick Size，且 LLMRunner 決策通過 AntiHallucinationGuard
3. 驗證 TradingEngineDispatcher 5 大模組端到端串接：確保模組 1~5 API 輸出結構完整且數學邏輯守恆
"""

import unittest
from src.market.data_adapter import DualMarketDataAdapter
from src.ai.llm_runner import LLMRunner
from src.server.api_server import TradingEngineDispatcher


class TestFullStackIntegration(unittest.TestCase):

    def setUp(self):
        # 設定短 timeout 避免測試環境被外部網路卡住，同時測試真实或確定性回退流程
        self.adapter = DualMarketDataAdapter(timeout=2)
        self.dispatcher = TradingEngineDispatcher()

    def test_symbol_normalization_prevents_market_misrouting(self):
        """
        意圖驗證：若台股代號 '2330 台積電' 被誤判為美股，將漏算 0.3% 證交稅並給出錯誤的 $0.01 跳動檔位。
        """
        tw_res = self.adapter.normalize_symbol("2330.TW 台積電")
        self.assertEqual(tw_res["market"], "TW")
        self.assertEqual(tw_res["symbol"], "2330.TW")
        self.assertEqual(tw_res["raw_code"], "2330")
        self.assertEqual(tw_res["currency"], "TWD")

        us_res = self.adapter.normalize_symbol("NVDA (NVIDIA Corp.)")
        self.assertEqual(us_res["market"], "US")
        self.assertEqual(us_res["symbol"], "NVDA")
        self.assertEqual(us_res["currency"], "USD")

    def test_technical_snapshot_and_llm_anti_hallucination_loop(self):
        """
        意圖驗證：程式端必須預先算好 MA/RSI/ATR 並將台股支撐壓力對齊至法定 Tick Size，
        且 LLMRunner 輸出的決策必須 100% 通過 AntiHallucinationGuard 邊界與失效條件審查。
        """
        snapshot = self.adapter.build_technical_snapshot("2330.TW")
        self.assertEqual(snapshot["market"], "TW")
        self.assertIsNotNone(snapshot["indicators"]["MA20"])
        self.assertIsNotNone(snapshot["indicators"]["RSI14"])
        self.assertIsNotNone(snapshot["indicators"]["ATR14"])

        # 若股價 >= 1000，所有支撐與壓力位必須是 5 元的倍數
        if snapshot["latest_close"] >= 1000.0:
            for s in snapshot["support_levels"]:
                self.assertEqual(s % 5.0, 0.0, f"支撐價位 {s} 未對齊台股千元以上 5 元 Tick")

        runner = LLMRunner(provider="AUTO", api_key=None)
        res = runner.generate_technical_decision(snapshot)
        self.assertTrue(res["anti_hallucination_audit"]["passed"])
        self.assertEqual(len(res["anti_hallucination_audit"]["violations"]), 0)
        self.assertIn(res["decision_payload"]["action"], ["BUY", "HOLD", "SELL"])

    def test_dispatcher_all_5_modules_end_to_end(self):
        """
        意圖驗證：驗證前端呼叫 /api/mod1 ~ /api/mod5 時，後端五大引擎皆能完成資料推進並回傳合規結構。
        """
        # 模組 1
        m1 = self.dispatcher.handle_mod1_analyze({"ticker": "NVDA"})
        self.assertEqual(m1["module"], 1)
        self.assertEqual(m1["snapshot"]["market"], "US")
        self.assertTrue(m1["llm_result"]["anti_hallucination_audit"]["passed"])

        # 模組 2：事件前大漲 15% 必須觸發 Priced-in 警示
        m2 = self.dispatcher.handle_mod2_news({
            "target": "2330.TW",
            "sentiment": "POSITIVE",
            "ret_5d_pct": 8.2,
            "ret_20d_pct": 15.6,
            "invalidation_criteria": "跌破 1015 元或外資連賣 2 萬張立即停損",
        })
        self.assertEqual(m2["module"], 2)
        self.assertTrue(m2["priced_in_evaluation"]["priced_in_risk"])
        self.assertTrue(m2["invalidation_audit"]["valid"])

        # 模組 3：Next Bar Open 回測
        m3 = self.dispatcher.handle_mod3_backtest({"target_asset": "2330.TW"})
        self.assertEqual(m3["module"], 3)
        self.assertGreater(m3["bars_tested"], 20)
        self.assertIn("profit_factor", m3["backtest_result"])

        # 模組 4：跨幣別折算、穿透式曝險與 100% 再平衡守恆
        m4 = self.dispatcher.handle_mod4_risk({})
        self.assertEqual(m4["module"], 4)
        self.assertTrue(m4["rebalance_verification"]["weight_conservation_passed"])
        self.assertGreater(m4["lookthrough_exposure_pct"]["2330"], 35.0)

        # 模組 5：交易日誌偏誤偵測與編號鎖定
        m5 = self.dispatcher.handle_mod5_coach({})
        self.assertEqual(m5["module"], 5)
        self.assertEqual(len(m5["personalized_3_rules"]), 3)
        self.assertGreaterEqual(len(m5["detected_biases"]), 2)

    def test_visual_test_runner_endpoint_intent(self):
        """
        意圖驗證：確保前端視覺化測試中心 (/api/tests/run) 執行的 12 項核心意圖測試全數通過並回傳預期與實際對照數據。
        """
        report = self.dispatcher.handle_run_tests()
        self.assertEqual(report["total"], 12)
        self.assertEqual(report["passed"], 12)
        self.assertEqual(report["failed"], 0)
        self.assertEqual(report["pass_rate_pct"], 100.0)
        self.assertEqual(len(report["results"]), 12)

    def test_interactive_terminal_custom_operation_modes(self):
        """
        意圖驗證：驗證互動式交易終端機新增之操作模式：
        1. 模組 1 必須回傳 recent_bars 供前端繪製 SVG K 線與 MA5/MA20 均線圖
        2. 模組 3 支援自訂短長均線 (fast_ma/slow_ma) 與初始本金，並回傳對齊初始本金的 equity_curve 淨值曲線
        3. 模組 4 支援動態新增/編輯持股部位，且當目標權重總和不等於 100% 時能精準攔截異常
        """
        # 1. 驗證模組 1 K線序列輸出
        m1 = self.dispatcher.handle_mod1_analyze({"ticker": "2330.TW"})
        self.assertIn("recent_bars", m1)
        self.assertEqual(len(m1["recent_bars"]), 30)
        self.assertIn("ma5", m1["recent_bars"][-1])
        self.assertIn("ma20", m1["recent_bars"][-1])

        # 2. 驗證模組 3 自訂參數與 Equity Curve
        m3 = self.dispatcher.handle_mod3_backtest({
            "target_asset": "NVDA",
            "fast_ma": 3,
            "slow_ma": 15,
            "initial_capital": 500_000.0,
            "commission_discount": 0.5,
        })
        self.assertEqual(m3["strategy_params"]["fast_ma"], 3)
        self.assertEqual(m3["strategy_params"]["slow_ma"], 15)
        self.assertEqual(m3["equity_curve"][0]["equity"], 500_000.0)
        self.assertGreaterEqual(len(m3["equity_curve"]), 2)

        # 3. 驗證模組 4 互動式自訂部位與非 100% 權重攔截
        m4_bad = self.dispatcher.handle_mod4_risk({
            "holdings": [
                {"symbol": "2330", "market": "TW", "shares": 2000, "price": 1050.0},
                {"symbol": "0050", "market": "TW", "shares": 1000, "price": 190.0},
            ],
            "target_weights": {"2330": 50.0, "0050": 30.0, "CASH": 10.0},  # 總和 90% != 100%
        })
        self.assertFalse(m4_bad["rebalance_verification"]["weight_conservation_passed"])

    def test_dynamic_market_watch_live_overlay(self):
        """
        意圖驗證：K 棒縮放 (bar_count=45) 與十字準星 change_pct 欄位正常；
        盤中不再使用模擬 Tick，改以真實報價覆蓋當日最後一根 K 棒（live_overlay），
        且決策輸出仍通過防幻覺審核、台股價位符合 Tick 檔位。
        """
        m1 = self.dispatcher.handle_mod1_analyze({"ticker": "2330.TW", "bar_count": 45})
        self.assertEqual(m1["bar_count"], 45)
        self.assertFalse(m1["simulate_tick"])
        self.assertIn("applied", m1["live_overlay"])
        self.assertIn("change_pct", m1["recent_bars"][-1])
        self.assertTrue(m1["llm_result"]["anti_hallucination_audit"]["passed"])
        if m1["snapshot"]["latest_close"] >= 1000.0 and not m1["live_overlay"]["applied"]:
            for s in m1["snapshot"]["support_levels"]:
                self.assertEqual(s % 5.0, 0.0)


if __name__ == "__main__":
    unittest.main()



