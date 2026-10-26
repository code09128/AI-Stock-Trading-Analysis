"""
模組 2、模組 4、模組 5 核心驗證單元測試 (test_modules.py)
嚴格檢驗：
1. 【模組 2】時段分類、事件前大漲之 Priced-in (利多出盡) 警示、台股 ±10% 波動限制、量化失效條件
2. 【模組 4】跨幣別匯率折算、穿透式 ETF 曝險拆解、相關係數矩陣、再平衡權重守恆 (100.0%)、大盤 -20% 壓力測試
3. 【模組 5】賺賠比計算、出場後 5 日賣飛追蹤、處置效應與報復性交易精準鎖定交易編號 (#08, #12)、3 條個人化規則
"""

import unittest
from src.news.news_strategy import NewsStrategyAnalyzer
from src.portfolio.portfolio_risk import PortfolioRiskManager
from src.journal.journal_coach import JournalCoach, JournalEntry


class TestAdvancedModules(unittest.TestCase):

    # ==================== 模組 2: 新聞轉交易策略驗證 ====================
    def test_news_strategy_priced_in_and_volatility(self):
        analyzer_tw = NewsStrategyAnalyzer(market="TW")

        # 1. 時段分類驗證
        self.assertEqual(analyzer_tw.classify_market_session("2026-10-19T08:30:00"), "PRE")
        self.assertEqual(analyzer_tw.classify_market_session("2026-10-19T10:15:00"), "REGULAR")
        self.assertEqual(analyzer_tw.classify_market_session("2026-10-19T14:00:00"), "POST")

        # 2. 利多出盡 (Priced-in) 盲測驗證：事件前 20 日大漲超過 10%
        res_priced_in = analyzer_tw.evaluate_priced_in_risk(
            news_sentiment="利多",
            ret_5d_pct=7.5,
            ret_20d_pct=14.2
        )
        self.assertTrue(res_priced_in["priced_in_risk"])
        self.assertIn("已高度反映", res_priced_in["analysis_note"])

        # 3. 預期價格波動區間合理性驗證 (台股嚴格受限於 ±10% 漲跌停限制)
        current_price = 1000.0
        # 假設極大 ATR (例如 150 元，原本會算出 1225 元，但台股上限為 1100 元)
        bounds = analyzer_tw.calculate_expected_volatility_bounds(current_price, atr_14=150.0, atr_multiplier=1.5)
        self.assertLessEqual(bounds["upper_bound"], 1100.0)
        self.assertGreaterEqual(bounds["lower_bound"], 900.0)

        # 4. 失效條件具體量化性驗證 (拒絕空泛詞彙，必須有具體數字價位)
        valid_eval = analyzer_tw.validate_invalidation_criteria("收盤跌破法說會前低點 1020 元或單日跌逾 3% 立即停損")
        self.assertTrue(valid_eval["valid"])

        invalid_eval = analyzer_tw.validate_invalidation_criteria("若市場情緒轉差保持良好心態隨機應變")
        self.assertFalse(invalid_eval["valid"])

    # ==================== 模組 4: 投資組合風險管理驗證 ====================
    def test_portfolio_risk_and_weight_conservation(self):
        risk_mgr = PortfolioRiskManager(usd_twd_rate=32.0)

        # 1. 跨幣別持倉市值統一換算器 (台幣 100 萬 + 美股 100 股 * $200 * 32 = 64 萬，總計 164 萬)
        holdings = [
            {"symbol": "2330", "market": "TW", "shares": 1000, "price": 1000.0}, # 1,000,000 TWD
            {"symbol": "NVDA", "market": "US", "shares": 100, "price": 200.0}     # 20,000 USD = 640,000 TWD
        ]
        res = risk_mgr.calculate_portfolio_weights(holdings)
        self.assertEqual(res["total_value_twd"], 1640000.0)
        self.assertEqual(res["holdings"][0]["weight_pct"], 60.98)
        self.assertEqual(res["holdings"][1]["weight_pct"], 39.02)

        # 2. 穿透式 ETF 曝險檢查 (持有 0050，自動拆解內含台積電 54% 權重並與個股累加)
        mock_etf_holdings = {
            "total_value_twd": 1000000.0,
            "holdings": [
                {"symbol": "2330", "weight_pct": 30.0},
                {"symbol": "0050", "weight_pct": 40.0}, # 內含 54% 2330 => 21.6%
                {"symbol": "CASH", "weight_pct": 30.0}
            ]
        }
        lookthrough = risk_mgr.calculate_lookthrough_exposure(mock_etf_holdings)
        # 2330 最終曝險應為 30% + (40% * 0.54) = 51.6%
        self.assertEqual(lookthrough["2330"], 51.6)

        # 3. 相關係數矩陣計算 (驗證完全正相關)
        ret1 = [0.01, 0.02, -0.01, 0.03, -0.02]
        ret2 = [0.02, 0.04, -0.02, 0.06, -0.04]
        corr = risk_mgr.calculate_correlation(ret1, ret2)
        self.assertAlmostEqual(corr, 1.0, places=2)

        # 4. 再平衡權重守恆驗證 (目標加總必須嚴格等於 100.0%)
        valid_targets = {"2330": 40.0, "NVDA": 30.0, "CASH": 30.0}
        plan = risk_mgr.generate_rebalance_plan(res["holdings"], valid_targets)
        self.assertTrue(plan["weight_conservation_passed"])
        self.assertEqual(plan["target_sum_pct"], 100.0)

        # 驗證非 100% 時會拋出異常
        with self.assertRaises(ValueError):
            risk_mgr.generate_rebalance_plan(res["holdings"], {"2330": 50.0, "NVDA": 40.0})

        # 5. 大盤 -20% 壓力測試與散戶避險工具可行性 (小資金不建議大台指，應推薦微台指或反向 ETF)
        crash_res = risk_mgr.simulate_crash_20pct(total_value_twd=1640000.0, portfolio_beta=1.35)
        self.assertEqual(crash_res["expected_portfolio_drawdown_pct"], -27.0)
        self.assertIn("微台指", crash_res["suggested_hedge_tool"])

    # ==================== 模組 5: 交易日誌分析師驗證 ====================
    def test_journal_coach_bias_detection_and_rules(self):
        # 準備測試交易紀錄，植入「處置效應 (賠 12% 抱 10 天)」與「報復性交易 (虧損後部位由 1000 放大至 3000)」
        entries = [
            JournalEntry("#01", "2330.TW", "09:10", "13:20", 1000.0, 1020.0, 1000, 20000.0, 2.0, 1, post_exit_5d_high=1090.0), # 賣飛 (續漲 6.8%)
            JournalEntry("#02", "2603.TW", "09:05", "13:30", 180.0, 175.0, 1000, -5000.0, -2.7, 1, post_exit_5d_high=176.0),
            JournalEntry("#03", "3017.TW", "09:15", "10:00", 600.0, 528.0, 1000, -72000.0, -12.0, 10, post_exit_5d_high=530.0), # 處置效應 (賠 12% 抱 10 天)
            JournalEntry("#04", "2330.TW", "09:00", "09:30", 1020.0, 1010.0, 3000, -30000.0, -1.0, 1, post_exit_5d_high=1015.0)  # 報復性翻倍 (部位由 1000 暴增至 3000)
        ]

        coach = JournalCoach(entries)
        stats = coach.compute_statistics()

        # 1. 賺賠比與賣飛追蹤
        self.assertEqual(stats["total_trades"], 4)
        self.assertEqual(stats["early_exits_count"], 1) # #01 賣飛
        self.assertEqual(stats["early_exits_detail"][0]["trade_id"], "#01")

        # 2. 行為偏誤精確偵測並點名對應交易編號
        biases = coach.detect_behavioral_biases()
        bias_names = [b["bias_name"] for b in biases]
        self.assertTrue(any("處置效應" in name for name in bias_names))
        self.assertTrue(any("報復性" in name for name in bias_names))

        # 確認交易編號綁定
        disposition_bias = next(b for b in biases if "處置效應" in b["bias_name"])
        self.assertIn("#03", disposition_bias["evidence_trade_ids"])

        revenge_bias = next(b for b in biases if "報復性" in b["bias_name"])
        self.assertIn("#04", revenge_bias["evidence_trade_ids"])

        # 3. 制定 3 條具體個人守則
        rules = coach.formulate_personalized_rules(biases)
        self.assertEqual(len(rules), 3)
        self.assertRegex(rules[0]["condition"], r"\d+(\.\d+)?%")  # 停損門檻是依資料算出的具體數字
        self.assertTrue(all(r.get("formula") for r in rules))  # 每條都說明怎麼算出來

    def test_dynamic_rules_follow_data(self):
        """停損線跟著平均獲利變；沒有賣飛紀錄時第 3 條改成賺賠比規則。"""
        def coach(win_pct):
            return JournalCoach([
                JournalEntry("#1", "A", "", "", 100, 100 * (1 + win_pct / 100), 1000, 1000 * win_pct, win_pct, 3, 0),
                JournalEntry("#2", "A", "", "", 100, 90, 1000, -10000, -10.0, 3, 0),
            ])
        r_small = coach(3.0).formulate_personalized_rules([])
        r_big = coach(6.0).formulate_personalized_rules([])
        self.assertIn("3.0%", r_small[0]["condition"])
        self.assertIn("6.0%", r_big[0]["condition"])
        self.assertIn("1.5", r_small[2]["formula"])  # 沒有賣飛 → 賺賠比規則
        self.assertIn("#2", r_small[0]["evidence"])

    def test_journal_coach_fractional_shares_preserved(self):
        """美股／定期定額碎股（如 1.09826 股 VTI）平倉送入交易檢討時，不可截斷為整數股。"""
        from src.server.dispatcher import DISPATCHER
        res = DISPATCHER.handle_mod5_coach({
            "entries": [
                {
                    "trade_id": "#01",
                    "symbol": "VTI",
                    "entry_time": "2026-01-15",
                    "exit_time": "2026-02-20",
                    "entry_price": 266.22,
                    "exit_price": 280.50,
                    "shares": 1.09826,
                    "fees": 1.0,
                    "emotion_score": 0,
                    "high_5d_after_exit": 282.0,
                }
            ]
        })
        self.assertAlmostEqual(res["entries_used"][0]["shares"], 1.09826, places=5)
        self.assertAlmostEqual(res["entries_used"][0]["net_pnl"], round((280.50 - 266.22) * 1.09826 - 1.0, 2), places=2)

    def test_journal_open_buy_entry_enriched_with_latest_close(self):
        """模擬下單買進（持有中）寫入交易檢討時，應自動帶入最新收盤價計算未實現損益與近5日高點。"""
        from unittest.mock import patch
        from src.market.bar import Bar
        from src.server.dispatcher import DISPATCHER

        fake_bars = [
            Bar("2026-10-20", 50.0, 52.0, 49.5, 51.0, 1000),
            Bar("2026-10-21", 51.0, 53.5, 50.8, 53.0, 1200),
        ]
        with patch.object(DISPATCHER.adapter, "fetch_bars", return_value={"bars": fake_bars}):
            res = DISPATCHER.handle_mod5_coach({
                "entries": [
                    {
                        "trade_id": "#01",
                        "symbol": "0055",
                        "side": "BUY",
                        "entry_time": "2026-10-20",
                        "exit_time": "持有中",
                        "entry_price": 51.0,
                        "exit_price": 51.0,
                        "shares": 1000,
                        "fees": 73,
                        "emotion_score": 5,
                        "source": "模擬下單買進",
                    }
                ]
            })
        # 持有中的部位：另外列在 open_positions（用最新收盤價算帳面損益），不算進已平倉統計、也沒有「出場後 5 日高點」
        self.assertEqual(res["closed_trades_used"], 0)
        self.assertEqual(res["statistics"]["total_trades"], 0)
        pos = res["open_positions"][0]
        self.assertEqual(pos["current_price"], 53.0)
        self.assertEqual(pos["net_pnl"], round((53.0 - 51.0) * 1000 - 73, 2))
        self.assertNotIn("high_5d_after_exit", pos)
        self.assertGreaterEqual(pos["holding_days"], 1)
        self.assertEqual(res["entries_used"][0]["exit_price"], 51.0)  # 存回去的紀錄不被現價蓋掉

    def test_holdings_shown_as_open_positions_not_trades(self):
        from unittest.mock import patch
        from src.market.bar import Bar
        from src.server.dispatcher import DISPATCHER
        bars = [Bar("2026-10-20", 100, 101, 99, 100, 1), Bar("2026-10-21", 100, 111, 99, 110, 1)]
        closed = {"trade_id": "#01", "symbol": "2330", "entry_time": "2026-10-01", "exit_time": "2026-10-10",
                  "entry_price": 100, "exit_price": 90, "shares": 1000}
        with patch.object(DISPATCHER.adapter, "fetch_bars", return_value={"bars": bars}):
            res = DISPATCHER.handle_mod5_coach({"entries": [closed], "holdings": [
                {"symbol": "0050", "shares": 2000, "cost": 100, "opened": "2026-10-01"},
                {"symbol": "2330", "shares": 0, "cost": 100}]})
        self.assertEqual(res["statistics"]["total_trades"], 1)
        self.assertEqual([p["symbol"] for p in res["open_positions"]], ["0050"])
        self.assertEqual(res["open_positions"][0]["net_pnl"], 20000.0)


    def test_mine_with_only_holdings_does_not_fall_back_to_sample(self):
        """還沒賣出過（只有持股）：不用範例資料、不產生規則，只回持有中部位。"""
        from unittest.mock import patch
        from src.market.bar import Bar
        from src.server.dispatcher import DISPATCHER
        bars = [Bar("2026-10-21", 100, 101, 99, 105, 1)]
        with patch.object(DISPATCHER.adapter, "fetch_bars", return_value={"bars": bars}):
            res = DISPATCHER.handle_mod5_coach({"entries": [], "mine": True, "ai": {"type": "gemini", "model": "x"},
                                                "holdings": [{"symbol": "0055", "shares": 1000, "cost": 100}]})
        self.assertEqual(res["closed_trades_used"], 0)
        self.assertEqual(res["statistics"]["total_trades"], 0)
        self.assertIn("還沒有已平倉", res["rules_source"])
        self.assertEqual(res["open_positions"][0]["net_pnl"], 5000.0)


if __name__ == "__main__":
    unittest.main()
