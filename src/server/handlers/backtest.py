"""策略回測（/api/mod3/backtest、strategies、optimize、montecarlo、signals 今日訊號、pine 匯出）"""

from concurrent.futures import ThreadPoolExecutor
import threading
from typing import Dict, Any, List, Optional

from src.market.bar import Bar

from src.backtest.backtest_engine import BacktestEngine, SIZING_MODES
from src.backtest import backtest_analysis, live_signals, pine_export, strategies, validation
from src.market import markets, trade_rules
from src.market.market_rules import tw_sell_tax_rate
from src.server.params import arg_num, arg_ticker


class BacktestHandlers:
    """策略回測（/api/mod3/backtest）"""

    def handle_mod3_strategies(self) -> Dict[str, Any]:
        return {"strategies": strategies.catalog(), "sizing_modes": SIZING_MODES}

    @staticmethod
    def _settings(payload: Dict[str, Any]) -> Dict[str, Any]:
        """策略、參數與風控設定（不含標的）：回測、參數掃描、今日訊號、Pine 匯出共用。"""
        strategy = str(payload.get("strategy") or "ma_cross")
        raw_params = dict(payload.get("params") or {})
        if strategy == "ma_cross":  # 舊版只送 fast_ma／slow_ma
            for k in ("fast_ma", "slow_ma"):
                if k in payload and k not in raw_params:
                    raw_params[k] = payload[k]
        params = strategies.resolve_params(strategy, raw_params)
        meta = strategies.STRATEGIES[strategy]
        initial_capital = arg_num(payload, "initial_capital", 1_000_000.0, "初始本金", lo=10000)
        commission_discount = arg_num(payload, "commission_discount", 0.6, "手續費折數", lo=0, hi=1)
        period_years = int(arg_num(payload, "period_years", 1, "回測期間（年）", integer=True, lo=1, hi=10))

        # 部位與出場風控
        sizing_mode = str(payload.get("sizing_mode") or "percent")
        if sizing_mode not in SIZING_MODES:
            raise ValueError(f"未知的部位模型：{sizing_mode}")
        if sizing_mode == "fixed":
            sizing_value = arg_num(payload, "sizing_value", initial_capital, "每筆固定金額", lo=1)
        elif sizing_mode == "atr_risk":
            sizing_value = arg_num(payload, "sizing_value", 1.0, "每筆風險 %", lo=0.1, hi=10)
        else:
            sizing_value = arg_num(payload, "sizing_value", 100.0, "每筆資金比例 %", lo=1, hi=100)
        atr_mult = arg_num(payload, "atr_mult", 2.0, "ATR 倍數", lo=0.5, hi=10)
        stop_loss_pct = arg_num(payload, "stop_loss_pct", 0.0, "單筆最大虧損 %", lo=0, hi=50)
        trailing_pct = arg_num(payload, "trailing_pct", 0.0, "移動停利回落 %", lo=0, hi=50)
        use_filter = bool(payload.get("market_filter"))
        filter_ma = int(arg_num(payload, "filter_ma", 60, "大盤濾網均線", integer=True, lo=5, hi=250))
        return {
            "strategy": strategy, "params": params, "meta": meta, "initial_capital": initial_capital,
            "commission_discount": commission_discount, "period_years": period_years,
            "sizing": {"mode": sizing_mode, "value": sizing_value, "atr_mult": atr_mult},
            "stop_loss_pct": stop_loss_pct, "trailing_pct": trailing_pct,
            "use_filter": use_filter, "filter_ma": filter_ma,
        }

    @staticmethod
    def _engine_kw(ticker: str, market: str, st: Dict[str, Any]) -> Dict[str, Any]:
        """引擎設定：每手股數與海外稅費依標的、台股證交稅依股票／ETF／債券 ETF；_rules_error 由呼叫端取出。"""
        rules = trade_rules.rules_for(ticker) if market not in ("TW", "US") else {}
        return {
            "lot_size": rules.get("lot"),
            "fees": rules.get("fees"),
            "sizing": st["sizing"],
            "stop_loss_pct": st["stop_loss_pct"],
            "trailing_pct": st["trailing_pct"],
            "tw_tax_rate": tw_sell_tax_rate(ticker) if market == "TW" else None,
            "_rules_error": rules.get("error"),
        }

    def _prepare(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """回測、參數掃描共用：檢查參數、抓日 K 與大盤、組出引擎設定。"""
        ticker = arg_ticker(payload, "target_asset", "ticker")
        st = self._settings(payload)
        strategy, params, meta = st["strategy"], st["params"], st["meta"]
        initial_capital, commission_discount, period_years = (
            st["initial_capital"], st["commission_discount"], st["period_years"])
        sizing_mode, sizing_value, atr_mult = st["sizing"]["mode"], st["sizing"]["value"], st["sizing"]["atr_mult"]
        stop_loss_pct, trailing_pct = st["stop_loss_pct"], st["trailing_pct"]
        use_filter, filter_ma = st["use_filter"], st["filter_ma"]

        feed = self.adapter.fetch_bars(ticker, days=250 * period_years)
        bars: List[Bar] = feed["bars"]
        market = feed["market"]
        signals = strategies.signals(strategy, bars, params)

        # 不再偷換策略：若此參數在期間內沒有產生足夠訊號，就如實回報（交易次數少/為 0）
        buy_signals = sum(1 for sg in signals if sg == 1)
        strategy_warnings = []
        if buy_signals < 2:
            strategy_warnings.append(
                f"「{meta['label']}」（{backtest_analysis.params_text(strategy, params)}）在這段期間只產生 {buy_signals} 次買進訊號，"
                "結果沒有統計意義；請調整參數或拉長期間，系統不會自動換成別的策略。"
            )

        engine_kw = self._engine_kw(ticker, market, st)
        rules_error = engine_kw.pop("_rules_error")
        if rules_error:
            strategy_warnings.append(f"{rules_error}，這次回測以每手 1 股計算。")

        # 大盤資料：市場環境拆分要 200 日線（多抓 1 年），大盤濾網也共用這份
        index_sym = markets.info(market)["index"]
        idx_bars: Optional[List[Bar]] = None
        try:
            idx_bars = self.adapter._fetch_from_yahoo(index_sym, days=250 * (period_years + 1))
        except Exception as e:  # 大盤抓不到就不拆、不濾，不影響主要回測
            strategy_warnings.append(f"大盤 {index_sym} 資料取得失敗，無法拆分市場環境：{e}")
        allowed = None
        if use_filter:
            if idx_bars:
                allowed = backtest_analysis.market_filter(bars, idx_bars, filter_ma)
            else:
                strategy_warnings.append("大盤資料取得失敗，這次回測沒有套用大盤濾網。")
        return {
            "ticker": ticker, "strategy": strategy, "params": params, "meta": meta, "feed": feed, "bars": bars,
            "market": market, "signals": signals, "warnings": strategy_warnings, "engine_kw": engine_kw,
            # 進階驗證要用同一筆本金（固定金額部位才會一致）
            "val_kw": {**engine_kw, "initial_capital": initial_capital},
            "initial_capital": initial_capital, "commission_discount": commission_discount,
            "period_years": period_years, "index_sym": index_sym, "idx_bars": idx_bars, "allowed": allowed,
            "risk": {
                "sizing_mode": sizing_mode, "sizing_label": SIZING_MODES[sizing_mode], "sizing_value": sizing_value,
                "atr_mult": atr_mult, "stop_loss_pct": stop_loss_pct, "trailing_pct": trailing_pct,
                "market_filter": use_filter and allowed is not None, "filter_ma": filter_ma, "filter_index": index_sym,
            },
        }

    def handle_mod3_backtest(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        c = self._prepare(payload)
        strategy, params, meta, feed, bars, market = (c[k] for k in ("strategy", "params", "meta", "feed", "bars", "market"))
        signals, strategy_warnings, engine_kw, allowed = c["signals"], c["warnings"], c["engine_kw"], c["allowed"]
        initial_capital, commission_discount, period_years = c["initial_capital"], c["commission_discount"], c["period_years"]
        idx_bars, index_sym = c["idx_bars"], c["index_sym"]

        engine = BacktestEngine(
            market=market,
            initial_capital=initial_capital,
            commission_discount=commission_discount,
            **engine_kw,
        )
        bt_result = engine.run(bars, signals, allowed)
        trades_list = bt_result.get("trades_detail", bt_result.get("trades", []))
        if bt_result["ignored_suspended_signals"]:
            strategy_warnings.append(
                f"有 {bt_result['ignored_suspended_signals']} 次訊號出現在成交量 0 的日子（視同暫停交易），未採用。"
            )

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
        bt_result["win_rate_pct"] = str(bt_result.get("win_rate", "0%")).replace("%", "")
        bt_result["max_drawdown_pct"] = str(bt_result.get("max_drawdown", "0%")).replace("%", "")
        bt_result["expectancy_pct"] = str(bt_result.get("avg_return", "0%")).replace("%", "")

        breakdown = None
        if idx_bars:
            breakdown = backtest_analysis.regime_breakdown(trades_list, backtest_analysis.regime_by_date(idx_bars))
            breakdown["index"] = index_sym
        wf = backtest_analysis.walk_forward(bars, market, commission_discount, strategy=strategy, params=params,
                                            engine_kw=c["val_kw"], allowed=allowed)
        if wf is None:
            strategy_warnings.append("期間太短或訊號太少，無法做前後段驗證；請把回測期間拉長到 3 年以上。")

        risk_settings = c["risk"]
        return {
            "module": 3,
            "symbol": feed["symbol"],
            "market": market,
            "currency": feed["currency"],
            "data_source": feed["data_source"],
            "bars_tested": len(bars),
            "period": f"{bars[0].timestamp} ~ {bars[-1].timestamp}" if bars else "",
            "data_note": "價格為真實還權日 K；交易是這個策略在歷史價格上的「模擬成交」（訊號隔日開盤價），不是你的真實交易",
            "strategy": {"key": strategy, "label": meta["label"], "rule": meta["rule"],
                         "params_text": backtest_analysis.params_text(strategy, params)},
            "strategy_params": {
                **params,
                "strategy": strategy,
                "initial_capital": initial_capital,
                "commission_discount": commission_discount,
                "period_years": period_years,
            },
            "risk_settings": risk_settings,
            "strategy_warnings": strategy_warnings,
            "regime_breakdown": breakdown,
            "walk_forward": wf,
            "next_step_ideas": backtest_analysis.next_step_ideas(bt_result, breakdown, wf, risk_settings),
            "execution_rule": "NEXT_BAR_OPEN (零偷看未來數據)",
            "equity_curve": equity_curve,
            "backtest_result": bt_result,
        }

    def handle_mod3_optimize(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """參數熱力圖＋滾動前進分析（同一組資料與風控設定），按鈕觸發才算。"""
        c = self._prepare(payload)
        args = (c["bars"], c["market"], c["commission_discount"], c["strategy"], c["params"], c["val_kw"], c["allowed"])
        rolling = validation.rolling_walk_forward(*args)
        warnings = list(c["warnings"])
        if rolling is None:
            warnings.append("資料太短，切不出 2 段以上的滾動前進分析；請把回測期間拉長到 3 年以上。")
        return {
            "symbol": c["feed"]["symbol"],
            "strategy": {"key": c["strategy"], "label": c["meta"]["label"],
                         "params_text": backtest_analysis.params_text(c["strategy"], c["params"])},
            "period": f"{c['bars'][0].timestamp} ~ {c['bars'][-1].timestamp}" if c["bars"] else "",
            "heatmap": validation.param_heatmap(*args),
            "rolling": rolling,
            "warnings": warnings,
        }

    def handle_mod3_montecarlo(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """用這次回測的每筆交易報酬 % 做蒙地卡羅，不必重抓資料。"""
        returns = payload.get("returns")
        if not isinstance(returns, list):
            raise ValueError("缺少每筆交易報酬（returns）")
        runs = int(arg_num(payload, "runs", 1000, "模擬次數", integer=True, lo=500, hi=3000))
        mode = str(payload.get("mode") or "shuffle")
        return validation.monte_carlo(returns[:5000], runs=runs, mode=mode)

    def handle_mod3_signals(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """今日訊號：自選股 × 這組策略設定，跑到最新一根日 K 判斷買進／賣出／持有／被擋下。"""
        raw = payload.get("symbols")
        if not isinstance(raw, list) or not raw:
            raise ValueError("請提供要掃描的代號（symbols）")
        symbols = list(dict.fromkeys(str(x).strip() for x in raw if str(x).strip()))[:60]
        st = self._settings(payload)
        days = 500  # 約 2 年日 K：長均線（最長 250 日）暖機後，策略的持有狀態才接得上
        idx_cache: Dict[str, Any] = {}
        idx_lock = threading.Lock()

        def index_ok(market: str, bars: List[Bar]) -> Optional[List[bool]]:
            if not st["use_filter"]:
                return None
            sym = markets.info(market)["index"]
            with idx_lock:
                if sym not in idx_cache:
                    try:
                        idx_cache[sym] = self.adapter._fetch_from_yahoo(sym, days=days)
                    except Exception:  # 大盤抓不到：這個市場不套濾網，列在 warnings
                        idx_cache[sym] = None
                idx = idx_cache[sym]
            return backtest_analysis.market_filter(bars, idx, st["filter_ma"]) if idx else None

        def one(sym: str) -> Dict[str, Any]:
            try:
                feed = self.adapter.fetch_bars(sym, days=days)
                kw = self._engine_kw(sym, feed["market"], st)
                kw.pop("_rules_error")
                row = live_signals.evaluate(feed["bars"], feed["market"], st["strategy"], st["params"], kw,
                                            index_ok(feed["market"], feed["bars"]), st["commission_discount"])
                return {"symbol": feed["symbol"], "input": sym, "market": feed["market"],
                        "currency": feed["currency"], **row}
            except Exception as e:  # 單檔失敗不影響其他檔
                return {"symbol": sym, "input": sym, "error": str(e)}

        with ThreadPoolExecutor(max_workers=6) as ex:
            rows = list(ex.map(one, symbols))
        order = {k: i for i, k in enumerate(live_signals.STATUS_ORDER)}
        rows.sort(key=lambda r: (1 if r.get("error") else 0, order.get(r.get("status"), 99)))
        warnings = [f"大盤 {k} 資料取得失敗，這個市場沒有套用大盤濾網。" for k, v in idx_cache.items() if v is None]
        if any(r.get("provisional") for r in rows):
            warnings.append("部分標的目前還在盤中：最新一根是盤中 K 棒，訊號要到收盤才確定，可能消失或改變。")
        return {
            "strategy": {"key": st["strategy"], "label": st["meta"]["label"],
                         "params_text": backtest_analysis.params_text(st["strategy"], st["params"])},
            "risk": {"sizing_mode": st["sizing"]["mode"], "stop_loss_pct": st["stop_loss_pct"],
                     "trailing_pct": st["trailing_pct"], "market_filter": st["use_filter"],
                     "filter_ma": st["filter_ma"]},
            "rows": rows,
            "summary": live_signals.summarize(rows),
            "warnings": warnings,
            "labels": live_signals.STATUS_LABEL,
            "note": ("「持有中」是這支策略在歷史上的模擬部位（用同一套規則一路跑到今天），不是你的真實持股；"
                     "買進／賣出代表下一個交易日開盤執行。"),
        }

    def handle_mod3_pine(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """匯出 TradingView Pine Script v5。"""
        ticker = arg_ticker(payload, "target_asset", "ticker")
        st = self._settings(payload)
        risk = {
            "sizing_mode": st["sizing"]["mode"], "sizing_value": st["sizing"]["value"],
            "atr_mult": st["sizing"]["atr_mult"], "stop_loss_pct": st["stop_loss_pct"],
            "trailing_pct": st["trailing_pct"], "market_filter": st["use_filter"], "filter_ma": st["filter_ma"],
        }
        return pine_export.build(ticker, markets.market_of(ticker), st["strategy"], st["params"],
                                 st["initial_capital"], st["commission_discount"], risk)
