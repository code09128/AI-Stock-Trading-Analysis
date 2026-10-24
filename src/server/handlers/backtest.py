"""策略回測（/api/mod3/backtest）"""

from typing import Dict, Any, List

from src.market.bar import Bar

from src.backtest.backtest_engine import BacktestEngine
from src.backtest import backtest_analysis
from src.market import markets, trade_rules
from src.server.params import arg_num, arg_ticker


class BacktestHandlers:
    """策略回測（/api/mod3/backtest）"""

    def handle_mod3_backtest(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        ticker = arg_ticker(payload, "target_asset", "ticker")
        fast_ma = int(arg_num(payload, "fast_ma", 5, "短均線週期", integer=True, lo=2, hi=250))
        slow_ma = int(arg_num(payload, "slow_ma", 20, "長均線週期", integer=True, lo=3, hi=250))
        if slow_ma <= fast_ma:
            raise ValueError(f"長均線週期（{slow_ma}）必須大於短均線週期（{fast_ma}），例如 5 與 20")
        initial_capital = arg_num(payload, "initial_capital", 1_000_000.0, "初始本金", lo=10000)
        commission_discount = arg_num(payload, "commission_discount", 0.6, "手續費折數", lo=0, hi=1)

        period_years = int(arg_num(payload, "period_years", 1, "回測期間（年）", integer=True, lo=1, hi=10))
        feed = self.adapter.fetch_bars(ticker, days=250 * period_years)
        bars: List[Bar] = feed["bars"]
        market = feed["market"]
        signals = backtest_analysis.ma_cross_signals(bars, fast_ma, slow_ma)

        # 不再偷換策略：若此參數在期間內沒有產生足夠訊號，就如實回報（交易次數少/為 0）
        buy_signals = sum(1 for sg in signals if sg == 1)
        strategy_warnings = []
        if buy_signals < 2:
            strategy_warnings.append(
                f"此均線參數 (快線 {fast_ma}/慢線 {slow_ma}) 在這段期間只產生 {buy_signals} 次買進訊號，結果沒有統計意義；請調整參數，系統不會自動換成別的策略。"
            )

        rules = trade_rules.rules_for(ticker) if market not in ("TW", "US") else {}
        if rules.get("error"):
            strategy_warnings.append(f"{rules['error']}，這次回測以每手 1 股計算。")
        engine = BacktestEngine(
            market=market,
            initial_capital=initial_capital,
            commission_discount=commission_discount,
            lot_size=rules.get("lot"),
            fees=rules.get("fees"),
        )
        bt_result = engine.run(bars, signals)
        trades_list = bt_result.get("trades_detail", bt_result.get("trades", []))

        # 建構累積淨值曲線 (Equity Curve) 供前端視覺化繪圖
        equity_curve = [{"step": 0, "label": "初始本金", "equity": round(initial_capital, 2), "pnl": 0.0}]
        running_eq = initial_capital
        for idx, t in enumerate(trades_list, start=1):
            running_eq = round(running_eq + float(t.get("net_pnl", 0.0)), 2)
            equity_curve.append({
                "step": idx,
                "label": f"#{idx} ({t.get('exit_date', '')})",
                "equity": running_eq,
                "pnl": round(float(t.get("net_pnl", 0.0)), 2),
                "return_pct": round(float(t.get("return_pct", 0.0)), 2),
            })

        bt_result["trades"] = trades_list
        bt_result["final_equity"] = running_eq
        bt_result["total_return_pct"] = round(((running_eq - initial_capital) / initial_capital) * 100, 2)
        bt_result["win_rate_pct"] = bt_result.get("win_rate", "0%").replace("%", "")
        bt_result["max_drawdown_pct"] = bt_result.get("max_drawdown", "0%").replace("%", "")
        bt_result["expectancy_pct"] = bt_result.get("avg_return", "0%").replace("%", "")

        # 市場環境拆分：大盤要多抓 1 年，200 日線才算得出來
        breakdown = None
        index_sym = markets.info(market)["index"]
        try:
            idx_bars = self.adapter._fetch_from_yahoo(index_sym, days=250 * (period_years + 1))
            breakdown = backtest_analysis.regime_breakdown(trades_list, backtest_analysis.regime_by_date(idx_bars))
            breakdown["index"] = index_sym
        except Exception as e:  # 大盤抓不到就不拆，不影響主要回測
            strategy_warnings.append(f"大盤 {index_sym} 資料取得失敗，無法拆分市場環境：{e}")
        wf = backtest_analysis.walk_forward(bars, market, commission_discount, fast_ma, slow_ma)
        if wf is None:
            strategy_warnings.append("期間太短或訊號太少，無法做前後段驗證；請把回測期間拉長到 3 年以上。")

        return {
            "module": 3,
            "symbol": feed["symbol"],
            "market": market,
            "currency": feed["currency"],
            "data_source": feed["data_source"],
            "bars_tested": len(bars),
            "period": f"{bars[0].timestamp} ~ {bars[-1].timestamp}" if bars else "",
            "data_note": "價格為真實還權日 K；交易是這個策略在歷史價格上的「模擬成交」（訊號隔日開盤價），不是你的真實交易",
            "strategy_params": {
                "fast_ma": fast_ma,
                "slow_ma": slow_ma,
                "initial_capital": initial_capital,
                "commission_discount": commission_discount,
                "period_years": period_years,
            },
            "strategy_warnings": strategy_warnings,
            "regime_breakdown": breakdown,
            "walk_forward": wf,
            "next_step_ideas": backtest_analysis.next_step_ideas(bt_result, breakdown, wf),
            "execution_rule": "NEXT_BAR_OPEN (零偷看未來數據)",
            "equity_curve": equity_curve,
            "backtest_result": bt_result,
        }
