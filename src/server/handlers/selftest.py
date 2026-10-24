"""系統自檢（/api/tests/run）"""

from typing import Dict, Any

from src.news.news_strategy import NewsStrategyAnalyzer
from src.market.bar import Bar
from src.backtest.backtest_engine import BacktestEngine
from src.portfolio.portfolio_risk import PortfolioRiskManager


class SelfTestHandlers:
    """系統自檢（/api/tests/run）"""

    def handle_run_tests(self) -> Dict[str, Any]:
        """
        執行全系統視覺化驗收測試套件，回傳每項測試的模組歸屬、測試意圖、預期值 vs 實測輸出、耗時與狀態。
        """
        import time as _time
        from src.technical.indicators import calculate_ma, calculate_rsi
        from src.market.market_rules import align_tw_tick, calculate_friction_cost
        from src.ai.anti_hallucination import AntiHallucinationGuard

        test_cases = []

        def _record(mod_tag: str, name: str, intent: str, fn):
            t0 = _time.perf_counter()
            try:
                detail = fn()
                elapsed_ms = round((_time.perf_counter() - t0) * 1000, 2)
                test_cases.append({
                    "id": f"tc_{len(test_cases) + 1:02d}",
                    "module": mod_tag,
                    "name": name,
                    "intent": intent,
                    "status": "PASS",
                    "duration_ms": elapsed_ms,
                    "expected": detail["expected"],
                    "actual": detail["actual"],
                })
            except Exception as ex:
                elapsed_ms = round((_time.perf_counter() - t0) * 1000, 2)
                test_cases.append({
                    "id": f"tc_{len(test_cases) + 1:02d}",
                    "module": mod_tag,
                    "name": name,
                    "intent": intent,
                    "status": "FAIL",
                    "duration_ms": elapsed_ms,
                    "expected": "測試無異常通過",
                    "actual": f"失敗: {ex}",
                })

        # 1. 均線精確度驗證
        def _t1():
            ma3 = calculate_ma([10.0, 11.0, 12.0, 13.0, 14.0], 3)
            assert ma3[-1] == 13.0 and ma3[2] == 11.0
            return {"expected": "MA3 = [None, None, 11.0, 12.0, 13.0]", "actual": f"MA3 = {ma3}"}

        _record("MODULE 01", "SMA 簡單移動平均線零誤差驗算", "禁止 AI 心算均線，確保程式端計算 0.00% 誤差", _t1)

        # 2. Wilder RSI 平滑演算法驗證
        def _t2():
            rsi = calculate_rsi([10.0 + i for i in range(16)], 14)
            assert rsi[-1] == 100.0
            return {"expected": "連續 15 日上漲 RSI(14) = 100.0", "actual": f"RSI(14) = {rsi[-1]}"}

        _record("MODULE 01", "Wilder's RSI(14) 動能指標平滑驗算", "對齊 TradingView 與券商看盤軟體之 Wilder 平滑公式", _t2)

        # 3. 台股法定 6 級 Tick Size 對齊驗證
        def _t3():
            p1 = align_tw_tick(1053.2)
            p2 = align_tw_tick(233.4)
            assert p1 == 1055.0 and p2 == 233.5
            return {
                "expected": "1053.2 元 -> 1055.0 元 (5元檔)｜233.4 元 -> 233.5 元 (0.5元檔)",
                "actual": f"1053.2 -> {p1}｜233.4 -> {p2}",
            }

        _record("MODULE 01", "台股法定 6 級 Tick Size 跳動檔位對齊", "防止千元以上台股給出非 5 元倍數之無效委託價", _t3)

        # 4. 防價格幻覺邊界與失效條件攔截驗證
        def _t4():
            guard = AntiHallucinationGuard(1100.0, 950.0, {"MA20": 1020.0})
            ok_res = guard.inspect_decision_payload({
                "action": "BUY",
                "support_levels": [980.0],
                "resistance_levels": [1080.0],
                "invalidation_criteria": "收盤跌破 950 元立即停損",
            })
            bad_res = guard.inspect_decision_payload({
                "action": "BUY",
                "support_levels": [600.0],
                "resistance_levels": [1500.0],
                "invalidation_criteria": "",
            })
            assert ok_res["passed"] is True and bad_res["passed"] is False
            return {
                "expected": "合規價位 [980, 1080] 放行 (True)｜捏造價位 [600, 1500] 攔截 (False)",
                "actual": f"合規放行={ok_res['passed']}｜幻覺攔截={not bad_res['passed']} ({len(bad_res['violations'])} 項違規)",
            }

        _record("MODULE 01", "AI 價格幻覺與過期記憶防禦閘門", "強制攔截超出歷史高低點區間之幻覺價位（如 600 元台積電）", _t4)

        # 5. 新聞時段與 Priced-in 利多出盡盲測驗證
        def _t5():
            az = NewsStrategyAnalyzer(market="TW")
            sess = az.classify_market_session("2026-10-19T08:30:00")
            pi = az.evaluate_priced_in_risk("利多", ret_5d_pct=7.5, ret_20d_pct=14.2)
            assert sess == "PRE" and pi["priced_in_risk"] is True
            return {
                "expected": "08:30 判定為盤前 (PRE)｜前 20 日漲 14.2% 觸發 Priced-in 利多出盡警示",
                "actual": f"時段={sess}｜Priced-in 風險={pi['priced_in_risk']}",
            }

        _record("MODULE 02", "新聞時段正規化與 Priced-in 利多出盡盲測", "事件前大漲逾 10% 時強制標記利多出盡風險", _t5)

        # 6. 台股單日 ±10% 漲跌停波動邊界與量化失效條件驗證
        def _t6():
            az = NewsStrategyAnalyzer(market="TW")
            b = az.calculate_expected_volatility_bounds(1000.0, atr_14=150.0, atr_multiplier=1.5)
            inv = az.validate_invalidation_criteria("若市場情緒轉差保持良好心態隨機應變")
            assert b["upper_bound"] <= 1100.0 and b["lower_bound"] >= 900.0 and inv["valid"] is False
            return {
                "expected": "1000 元台股單日預期上下界受限於 [900.0, 1100.0]｜空泛心態失效詞彙自動退回",
                "actual": f"波動區間=[{b['lower_bound']}, {b['upper_bound']}]｜空泛詞彙攔截={not inv['valid']}",
            }

        _record("MODULE 02", "台股 ±10% 漲跌停波動約束與失效條件量化審計", "杜絕 AI 預測台股單日漲跌超過法定 10% 或給出空話失效條件", _t6)

        # 7. 台股手續費與 0.3% 證交稅真實摩擦成本驗證
        def _t7():
            buy_c = calculate_friction_cost("TW", "BUY", 1000.0, 1000)
            sell_c = calculate_friction_cost("TW", "SELL", 1100.0, 1000)
            assert buy_c["fee"] == 1425.0 and sell_c["tax"] == 3300.0
            return {
                "expected": "買進 100 萬手續費 1,425 元 (免稅)｜賣出 110 萬證交稅 3,300 元 (0.3%)",
                "actual": f"買進手續費=${buy_c['fee']}｜賣出證交稅=${sell_c['tax']}",
            }

        _record("MODULE 03", "台美股手續費與 0.3% 證交稅摩擦成本驗算", "回測強制扣除真實稅費，杜絕忽略交易稅的虛胖績效", _t7)

        # 8. 回測 Next Bar Open 防偷看未來數據驗證
        def _t8():
            bars = [
                Bar("2026-01-01", 100.0, 105.0, 99.0, 104.0, 1000),
                Bar("2026-01-02", 105.0, 110.0, 104.0, 109.0, 1500),
                Bar("2026-01-03", 110.0, 115.0, 108.0, 114.0, 2000),
                Bar("2026-01-04", 115.0, 120.0, 113.0, 118.0, 1800),
                Bar("2026-01-05", 120.0, 122.0, 118.0, 121.0, 1200),
            ]
            bt = BacktestEngine(market="TW").run(bars, [0, 1, 0, -1, 0])
            tr = bt["trades_detail"][0]
            assert tr["entry_price"] == 110.0 and tr["exit_price"] == 120.0 and bt["sample_size_warning"] is True
            return {
                "expected": "Day2 訊號於 Day3 開盤 110.0 成交｜Day4 訊號於 Day5 開盤 120.0 成交｜<30 筆觸發警告",
                "actual": f"進場價={tr['entry_price']}｜出場價={tr['exit_price']}｜淨利=${tr['net_pnl']}｜樣本警告={bt['sample_size_warning']}",
            }

        _record("MODULE 03", "回測引擎 Next Bar Open 零偷看未來數據驗證", "訊號成立後強制隔日開盤價撮合，杜絕偷看當根最低價", _t8)

        # 9. 跨幣別換算、穿透式 ETF 拆解與再平衡 100% 權重守恆驗證
        def _t9():
            rm = PortfolioRiskManager(usd_twd_rate=32.0)
            lt = rm.calculate_lookthrough_exposure({
                "total_value_twd": 1000000.0,
                "holdings": [
                    {"symbol": "2330", "weight_pct": 30.0},
                    {"symbol": "0050", "weight_pct": 40.0},
                    {"symbol": "CASH", "weight_pct": 30.0},
                ],
            })
            plan = rm.generate_rebalance_plan(
                [{"symbol": "2330", "weight_pct": 60.0}],
                {"2330": 40.0, "NVDA": 30.0, "CASH": 30.0},
            )
            assert lt["2330"] == 51.6 and plan["weight_conservation_passed"] is True
            return {
                "expected": "2330 (30%) + 0050 (40%*54%) 穿透式總曝險 = 51.6%｜再平衡目標總和 = 100.0%",
                "actual": f"2330 穿透曝險={lt['2330']}%｜再平衡總和={plan['target_sum_pct']}%",
            }

        _record("MODULE 04", "跨幣別市值折算、0050 穿透式拆解與 100% 權重守恆", "抓出表面分散實則高度重疊之半導體曝險並確保再平衡算術守恆", _t9)

        # 10. 大盤下跌 20% 壓力測試與散戶微台指避險建議驗證
        def _t10():
            rm = PortfolioRiskManager(usd_twd_rate=32.0)
            crash = rm.simulate_crash_20pct(total_value_twd=1640000.0, portfolio_beta=1.35)
            assert crash["expected_portfolio_drawdown_pct"] == -27.0 and "微台指" in crash["suggested_hedge_tool"]
            return {
                "expected": "Beta 1.35 下跌預估 -27.0%｜散戶資金推薦『微台指 (TMF) 或 00632R』",
                "actual": f"預估回撤={crash['expected_portfolio_drawdown_pct']}%｜避險工具={crash['suggested_hedge_tool']}",
            }

        _record("MODULE 04", "大盤 -20% 壓力測試與散戶可行避險工具匹配", "避免向小資散戶推薦保證金門檻過高的大台指期", _t10)

        # 11. 交易日誌處置效應、報復性翻倍與 #編號證據綁定驗證
        def _t11():
            res = self.handle_mod5_coach({})
            biases = res["detected_biases"]
            rules = res["personalized_3_rules"]
            assert len(biases) >= 2 and len(rules) == 3
            return {
                "expected": "精準抓出處置效應 (#03, #08) 與報復性翻倍交易 (#04, #09)｜產出 3 條量化守則",
                "actual": f"偵測偏誤={len(biases)} 項 ({biases[0]['evidence_trade_ids']}, {biases[1]['evidence_trade_ids']})｜守則={len(rules)} 條",
            }

        _record("MODULE 05", "植入式壞習慣偵測與交易 #編號證據強制綁定", "每個行為偏誤結論皆必須點名具體交易編號並制定量化規則", _t11)

        # 12. 雙市場代號正規化與即時行情串接端到端驗證
        def _t12():
            tw = self.adapter.normalize_symbol("2330.TW 台積電")
            us = self.adapter.normalize_symbol("NVDA")
            m1 = self.handle_mod1_analyze({"ticker": "2330.TW"})
            assert tw["market"] == "TW" and us["market"] == "US" and m1["llm_result"]["anti_hallucination_audit"]["passed"]
            return {
                "expected": "2330.TW -> TW (TWD)｜NVDA -> US (USD)｜端到端快照與防幻覺審查 100% 通過",
                "actual": f"來源={m1['snapshot']['data_source']}｜最新收盤={m1['snapshot']['latest_close']}｜審查通過={m1['llm_result']['anti_hallucination_audit']['passed']}",
            }

        _record("FULL-STACK", "台美股外部行情 API 抓取與五大模組端到端串接", "驗證從外部行情抓取、指標預算到防幻覺審查的全閉環", _t12)

        passed_count = sum(1 for tc in test_cases if tc["status"] == "PASS")
        total_ms = round(sum(tc["duration_ms"] for tc in test_cases), 2)

        return {
            "total": len(test_cases),
            "passed": passed_count,
            "failed": len(test_cases) - passed_count,
            "pass_rate_pct": round((passed_count / len(test_cases)) * 100, 1) if test_cases else 0.0,
            "total_duration_ms": total_ms,
            "timestamp": _time.strftime("%Y-%m-%d %H:%M:%S"),
            "results": test_cases,
        }
