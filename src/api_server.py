"""
本機前後端整合 API 伺服器 (api_server.py)
同時提供：
1. 靜態網頁服務 (預設根目錄為 web/)
2. 五大 AI 交易模組 REST API 端點：
   - GET  /api/health       -> 系統健康狀態與引擎連線檢查
   - POST /api/mod1/analyze -> 模組 1：自動抓取行情 + 預算指標 + Tick 對齊 + 防幻覺決策輸出
   - POST /api/mod2/news    -> 模組 2：新聞時段正規化 + Priced-in 檢定 + 波動上下限 + 失效條件驗收
   - POST /api/mod3/backtest-> 模組 3：還權 K 線雙均線/RSI 策略 Next Bar Open 回測 + 四大指標
   - POST /api/mod4/risk    -> 模組 4：跨幣別即時匯率折算 + 穿透式 ETF 拆解 + 再平衡 100% 驗收 + -20% 避險
   - POST /api/mod5/coach   -> 模組 5：交易日誌賺賠比 + 5日賣飛追蹤 + 處置效應/報復性交易編號鎖定 + 3條規則
"""

from typing import Dict, Any, List
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import json
import re
from datetime import datetime
import sys

from src.data_adapter import DualMarketDataAdapter
from src.llm_runner import LLMRunner
from src.news_strategy import NewsStrategyAnalyzer
from src.backtest_engine import BacktestEngine, Bar
from src.indicators import calculate_ma
from src.market_rules import get_tw_tick_size, align_tw_tick
from src.portfolio_risk import PortfolioRiskManager
from src.journal_coach import JournalCoach, JournalEntry
from src import quote_provider
from src.etf_reference import ETF_POOL
from src import etf_data, chart_data, news_feed, stress, stock_info, ai_client, chip_data, finmind, market_calendar, fx, markets, ai_context, activity_log
import time



def to_weekly_bars(daily: List[Bar]) -> List[Bar]:
    """把還權日 K 聚合成週 K：開=週第一根開盤、高低=週內極值、收=週最後一根收盤、量=週總量；時間標記為該週最後一個交易日。"""
    weeks: Dict[Any, List[Bar]] = {}
    for b in daily:
        y, w, _ = datetime.strptime(b.timestamp, "%Y-%m-%d").isocalendar()
        weeks.setdefault((y, w), []).append(b)
    out = []
    for key in sorted(weeks):
        g = weeks[key]
        out.append(Bar(timestamp=g[-1].timestamp, open=g[0].open, high=max(x.high for x in g),
                       low=min(x.low for x in g), close=g[-1].close, volume=sum(x.volume for x in g)))
    return out


def weekly_summary(wbars: List[Bar]) -> Dict[str, Any]:
    """週線指標摘要（程式算好，不讓 AI 心算）。"""
    closes = [b.close for b in wbars]
    from src.indicators import calculate_macd, calculate_rsi
    ma = {n: calculate_ma(closes, n)[-1] for n in (5, 20, 60)}
    macd = calculate_macd(closes)
    last = closes[-1]
    return {
        "weeks": len(wbars),
        "last_week_close": last,
        "MA5": ma[5], "MA20": ma[20], "MA60": ma[60],
        "RSI14": calculate_rsi(closes, 14)[-1],
        "MACD_HIST": macd["hist"][-1],
        "above_MA20": ma[20] is not None and last > ma[20],
        "trend_note": (
            "週線多頭排列（收盤>MA5>MA20）" if ma[5] and ma[20] and last > ma[5] > ma[20]
            else "週線空頭排列（收盤<MA5<MA20）" if ma[5] and ma[20] and last < ma[5] < ma[20]
            else "週線盤整／多空交錯"
        ),
    }


WEB_DIR = Path(__file__).resolve().parent.parent / "web"

WATCHLIST_NAMES = {
    "2330.TW": "台積電",
    "2317.TW": "鴻海",
    "2454.TW": "聯發科",
    "NVDA": "NVIDIA",
    "AAPL": "Apple",
    "TSLA": "Tesla",
    "SPCX": "SpaceX",
    "2330": "台積電",
    "0050": "元大台灣50",
    "00935": "野村臺灣新科技50",
    "00891": "中信關鍵半導體",
    "0055": "元大MSCI金融",
}

def _hold_code(symbol: str) -> str:
    """持股比對用的代號：台股去掉 .TW／.TWO（2330），其他市場保留後綴（0700.HK、7203.T），避免跨市場撞號。"""
    return DualMarketDataAdapter.normalize_symbol(str(symbol))["raw_code"]


def arg_num(payload: Dict[str, Any], key: str, default: float, label: str, integer: bool = False,
            lo: float = None, hi: float = None) -> float:
    """讀取數字參數；不是數字或超出範圍時拋出可直接顯示給使用者的 ValueError（API 回 400）。"""
    raw = payload.get(key, default)
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        raw = default
    try:
        val = float(raw)
    except (TypeError, ValueError):
        raise ValueError(f"「{label}」必須是數字（收到「{raw}」）") from None
    if val != val or val in (float("inf"), float("-inf")):
        raise ValueError(f"「{label}」必須是有效數字")
    if integer:
        val = int(round(val))
    if (lo is not None and val < lo) or (hi is not None and val > hi):
        rng = f"{lo:g}～{hi:g}" if lo is not None and hi is not None else (f"≥ {lo:g}" if lo is not None else f"≤ {hi:g}")
        raise ValueError(f"「{label}」需在 {rng} 之間（收到 {raw}）")
    return val


def arg_ticker(payload: Dict[str, Any], *keys: str, default: str = "2330.TW") -> str:
    """讀取股票代號；有帶欄位但是空白時回白話錯誤，而不是默默改分析 2330。"""
    for k in keys:
        if k in payload:
            t = str(payload.get(k) or "").strip()
            if not t:
                raise ValueError("請輸入股票代號，例如 2330（台股）或 NVDA（美股）")
            return t
    return default


BOND_NOTE = ("債券 ETF 的價格主要跟著利率走、波動很小，股票用的均線排列／乖離／RSI 門檻對它意義不大；"
             "下方評分僅供參考，不產生買賣訊號。判斷債券請看殖利率、存續期間與利率方向。")


def mark_bond_snapshot(snapshot: Dict[str, Any], ticker: str) -> None:
    """債券 ETF：趨勢評分標示不適用，訊號固定為持有（規則引擎就不會據此給 BUY／SELL）。"""
    try:
        category = stock_info.classify(ticker)["category"]
    except Exception:
        return
    snapshot["asset_category"] = category
    score = snapshot.get("trend_score")
    if category == "BOND" and score:
        score.update(not_applicable=BOND_NOTE, signal="HOLD", signal_label="不適用（債券）")


class TradingEngineDispatcher:
    """集中調度模組 1 ~ 5 的後端運算與外部串接"""

    def __init__(self):
        self.adapter = DualMarketDataAdapter()

    def handle_health(self) -> Dict[str, Any]:
        fx = self.adapter.fetch_usd_twd_rate()
        return {
            "status": "OK",
            "modules_ready": [1, 2, 3, 4, 5],
            "fx_usd_twd": fx["usd_twd"],
            "fx_source": fx["source"],
            "fx_warning": fx.get("warning"),
            "finmind": finmind.pause_status(),
        }

    def handle_quotes(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """看盤頁用：真實報價（TWSE MIS / Yahoo）+ 抓取紀錄"""
        symbols = [str(x) for x in payload.get("symbols", [])][:40]
        quotes = quote_provider.get_quotes(symbols, WATCHLIST_NAMES)
        return {
            "quotes": quotes,
            "timestamp": time.strftime("%H:%M:%S"),
            "fetch_log": quote_provider.get_fetch_log()[:12],
        }

    def handle_news(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        sym = str(payload.get("symbol", "2330")).strip()
        norm = DualMarketDataAdapter.normalize_symbol(sym)
        name = WATCHLIST_NAMES.get(norm["symbol"]) or WATCHLIST_NAMES.get(norm["raw_code"]) or ""
        if not name:
            q = quote_provider.get_quotes([sym], WATCHLIST_NAMES)[0]
            name = q.get("name", "") if q.get("name") != norm["raw_code"] else ""
        return news_feed.fetch_news(sym, name)

    def _price_context(self, bars: List[Bar], event_local_iso: str, session: str) -> Dict[str, Any]:
        """以事件當下「已知」的收盤價計算事件前 5/20 日漲幅，並回報事件後實際反應（若已發生）。"""
        ev_date = event_local_iso[:10]
        # 盤前/盤中發布：事件日收盤尚未發生；盤後發布：事件日收盤已知
        known = [b for b in bars if (b.timestamp <= ev_date if session == "POST" else b.timestamp < ev_date)]
        if len(known) < 21:
            return {"available": False, "reason": "事件日期之前的歷史 K 線不足 21 根"}
        last = known[-1].close
        ret = lambda n: round((last / known[-1 - n].close - 1) * 100, 2)  # noqa: E731
        after = [b for b in bars if b.timestamp > known[-1].timestamp]
        ctx = {"available": True, "as_of_bar": known[-1].timestamp, "close_before_event": last,
               "ret_5d_pct": ret(5), "ret_10d_pct": ret(10), "ret_20d_pct": ret(20)}
        if after:
            ctx["next_day_bar"] = after[0].timestamp
            ctx["next_day_return_pct"] = round((after[0].close / last - 1) * 100, 2)
            if len(after) >= 5:
                ctx["after_5d_return_pct"] = round((after[4].close / last - 1) * 100, 2)
        return ctx

    def handle_indices(self) -> Dict[str, Any]:
        return {"indices": chart_data.indices(), "timestamp": time.strftime("%H:%M:%S")}

    def handle_intraday(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        return chart_data.intraday(str(payload.get("symbol", "2330")))

    def handle_overview(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        syms = [str(x) for x in payload.get("symbols", [])][:30]
        return {"rows": chart_data.overview(syms), "timestamp": time.strftime("%H:%M:%S")}

    def handle_ai(self, action: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        profile = payload.get("profile") or {}
        try:
            if action == "test":
                return ai_client.test(profile)
            if action == "detect":
                return {"runtimes": ai_client.detect_local()}
            if action == "models":
                return {"models": ai_client.list_models(profile)}
            if action == "explain":
                module, data = str(payload.get("module", "")), payload.get("data")
                context = None
                symbol = ai_context.symbol_of(module, data)
                if symbol and module in ai_context.SECTIONS_BY_MODULE and ai_client.is_enabled(profile):
                    context = ai_context.build(symbol, ai_context.SECTIONS_BY_MODULE[module])
                return ai_client.explain(profile, module, data, str(payload.get("question", "")), context)
        except ai_client.AIError as e:
            return {"error": str(e)}
        return {"error": f"未知的 AI 動作：{action}"}

    def handle_stockinfo(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        return stock_info.stock_info(str(payload.get("symbol", "2330")))

    def handle_fx(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """各幣別兌台幣匯率（看盤頁持股損益換算用）。"""
        curs = [str(c) for c in payload.get("currencies", [])][:20]
        return {"rates": fx.rates_to_twd(curs), "markets": markets.market_list()}

    def handle_chips(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        return chip_data.chips(str(payload.get("symbol", "2330")))

    def handle_dividend_calendar(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        return stock_info.dividend_calendar([str(x) for x in payload.get("symbols", [])][:30])

    def handle_categories(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        return {"categories": stock_info.categories([str(x) for x in payload.get("symbols", [])][:40])}

    def handle_candles(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        return chart_data.candles(str(payload.get("symbol", "^TWII")),
                                  int(arg_num(payload, "n", 15, "K 棒數量", integer=True, lo=1, hi=250)))

    def handle_sparks(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        syms = [str(x) for x in payload.get("symbols", [])][:40]
        return {"sparks": chart_data.sparks(syms)}

    def handle_etf_list(self) -> Dict[str, Any]:
        """ETF 精選：規模/殖利率/定期定額戶數皆為真實來源計算；殖利率在背景預熱，pending>0 代表還在算。"""
        quotes = {
            q["symbol"].split(".")[0].upper(): q
            for q in quote_provider.get_quotes(ETF_POOL, WATCHLIST_NAMES)
        }
        etf_data.warm_yields(ETF_POOL)
        rows = etf_data.build_etf_rows(ETF_POOL, quotes)
        return {
            "etfs": rows,
            "pending_yields": sum(1 for r in rows if r["yield_pct"] is None),
            "sources": {
                "name/aum": "TWSE OpenAPI t187ap47_L 發行單位數 × 即時市價（市值估算，非淨值規模）",
                "yield": "Yahoo Finance 近 12 個月實際配息 ÷ 現價（自行計算）",
                "savings_plan": "TWSE OpenAPI ETFRank 定期定額交易戶數（僅前 20 名有值，非總持股人數）",
            },
        }

    def handle_mod1_analyze(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        ticker = arg_ticker(payload, "ticker")
        api_key = str(payload.get("api_key", "")).strip() or None
        provider = str(payload.get("provider", "AUTO")).strip()
        # 圖表可縮放／平移：最多回傳 500 根日 K（約 2 年）或 104 根週 K，前端自己決定顯示範圍
        bar_count = int(max(10, min(500, arg_num(payload, "bar_count", 30, "K 棒數量", integer=True))))
        timeframe = "W" if str(payload.get("timeframe", "D")).upper() == "W" else "D"

        snapshot = self.adapter.build_technical_snapshot(ticker)
        mark_bond_snapshot(snapshot, ticker)
        # 週線：抓約 2 年日線（還權）再聚合成週 K，才有足夠的週均線樣本
        feed = self.adapter.fetch_bars(ticker, days=520 if timeframe == "W" else max(90, bar_count + 60))
        bars: List[Bar] = to_weekly_bars(feed["bars"]) if timeframe == "W" else feed["bars"]

        # 以真實即時報價覆蓋當日最後一根 K 棒（僅限報價日期與該 K 棒同一天），不再使用模擬跳動
        live_overlay: Dict[str, Any] = {"applied": False}
        try:
            lq = quote_provider.get_quotes([ticker], WATCHLIST_NAMES)[0]
            q_date = lq.get("quote_date_local") or "".join(
                ch for ch in (str(lq.get("quote_time", "")).split() or [""])[0] if ch.isdigit())
            if bars and lq.get("is_live") and q_date == bars[-1].timestamp.replace("-", ""):
                last_b = bars[-1]
                px = float(lq["price"])
                bars[-1] = Bar(
                    timestamp=last_b.timestamp,
                    open=last_b.open,
                    high=max(last_b.high, px),
                    low=min(last_b.low, px),
                    close=px,
                    volume=last_b.volume,
                )
                snapshot["latest_close"] = px
                DualMarketDataAdapter.reclassify_levels(snapshot, px)
                live_overlay = {"applied": True, "price": px, "source": lq.get("source"),
                                "quote_time": lq.get("quote_time")}
        except Exception as e:
            live_overlay = {"applied": False, "error": str(e)}

        closes = [b.close for b in bars]
        ma5_series = calculate_ma(closes, 5)
        ma20_series = calculate_ma(closes, 20)
        ma60_series = calculate_ma(closes, 60)

        recent_bars = []
        start_idx = max(0, len(bars) - bar_count)
        for i in range(start_idx, len(bars)):
            b = bars[i]
            prev_c = bars[i - 1].close if i > 0 else b.open
            chg_pct = round(((b.close - prev_c) / prev_c) * 100, 2) if prev_c else 0.0
            recent_bars.append({
                "date": b.timestamp,
                "open": round(b.open, 2),
                "high": round(b.high, 2),
                "low": round(b.low, 2),
                "close": round(b.close, 2),
                "change_pct": chg_pct,
                "volume": int(b.volume),
                "ma5": round(ma5_series[i], 2) if ma5_series[i] is not None else None,
                "ma20": round(ma20_series[i], 2) if ma20_series[i] is not None else None,
                "ma60": round(ma60_series[i], 2) if ma60_series[i] is not None else None,
            })

        runner = LLMRunner(provider=provider, api_key=api_key, profile=payload.get("ai"))
        decision = runner.generate_technical_decision(snapshot)

        return {
            "module": 1,
            "bar_count": len(recent_bars),
            "simulate_tick": False,
            "timeframe": timeframe,
            "weekly_snapshot": weekly_summary(bars) if timeframe == "W" else None,
            "live_overlay": live_overlay,
            "updated_at": time.strftime("%H:%M:%S"),
            "snapshot": snapshot,
            "recent_bars": recent_bars,
            "llm_result": decision,
        }

    def handle_mod2_news(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        ticker = arg_ticker(payload, "target", "ticker")
        headline = str(
            payload.get(
                "headline",
                "法說會釋出 CoWoS 產能倍增與毛利率超預期利多，惟事件前股價已波段連漲",
            )
        ).strip()
        sentiment = str(payload.get("sentiment", "POSITIVE")).strip()
        sentiment_info = {"source": "使用者選擇", "reason": ""}
        if ai_client.is_enabled(payload.get("ai")) and payload.get("ai_sentiment"):
            try:
                cls = ai_client.classify_sentiment(payload["ai"], headline, ticker)
                sentiment = cls["sentiment"]
                sentiment_info = {"source": f"AI（{payload['ai'].get('model')}）", "reason": cls["reason"]}
            except ai_client.AIError as e:
                sentiment_info = {"source": "使用者選擇（AI 判斷失敗）", "reason": str(e)}
        timestamp_iso = str(payload.get("timestamp_iso", "2026-10-19T08:15:00")).strip()
        snapshot = self.adapter.build_technical_snapshot(ticker)
        market = snapshot["market"]
        analyzer = NewsStrategyAnalyzer(market=market)

        if "invalidation_criteria" in payload:
            invalidation_text = str(payload.get("invalidation_criteria") or "").strip()
        else:  # 沒填就用現價附近的真實支撐／壓力組出具體條件
            bearish = sentiment.upper() in ("NEGATIVE", "BEARISH", "利空")
            lvl = (snapshot["resistance_levels"] or [None])[0] if bearish else (snapshot["support_levels"] or [None])[-1]
            invalidation_text = (
                f"若日收盤站回 {lvl} 之上或單日漲逾 3%，利空判斷失效" if bearish
                else f"若日收盤跌破 {lvl} 或單日跌逾 3% 立即停損出場"
            )

        # 時段：先看那天是不是交易日（有日 K 就以 K 棒為準，否則用證交所公告／NYSE 假日）
        feed = self.adapter.fetch_bars(ticker, days=500)
        trading = None
        try:
            trading = market_calendar.trading_day(
                market, datetime.fromisoformat(timestamp_iso[:10]).date(), [b.timestamp for b in feed["bars"]]
            )
        except ValueError:
            pass
        session = analyzer.classify_market_session(timestamp_iso, trading_day=trading)
        price_ctx: Dict[str, Any] = {"available": False}
        event_local = str(payload.get("timestamp_iso", ""))
        if payload.get("use_event_date") and len(event_local) >= 10:
            # 以新聞發布當下已知的價格計算「事件前」漲幅，並回報事件後實際反應（真實日 K）
            price_ctx = self._price_context(feed["bars"], event_local, session)
        if price_ctx.get("available"):
            ret_5d, ret_20d = price_ctx["ret_5d_pct"], price_ctx["ret_20d_pct"]
        else:
            ret_5d = arg_num(payload, "ret_5d_pct", snapshot["ret_5d_pct"], "事件前 5 日漲跌幅")
            ret_20d = arg_num(payload, "ret_20d_pct", snapshot["ret_20d_pct"], "事件前 20 日漲跌幅")

        priced_in = analyzer.evaluate_priced_in_risk(sentiment, ret_5d, ret_20d)
        atr_val = snapshot["indicators"]["ATR14"] or round(snapshot["latest_close"] * 0.02, 2)
        vol_bounds = analyzer.calculate_expected_volatility_bounds(
            snapshot["latest_close"], atr_val, atr_multiplier=1.5
        )
        inv_check = analyzer.validate_invalidation_criteria(invalidation_text)

        return {
            "module": 2,
            "symbol": snapshot["symbol"],
            "market": market,
            "headline": headline,
            "data_source": snapshot["data_source"],
            "session": session,
            "session_note": trading[1] if trading else None,
            "event_price_context": price_ctx,
            "sentiment": sentiment,
            "sentiment_info": sentiment_info,
            "priced_in_evaluation": priced_in,
            "volatility_bounds": vol_bounds,
            "invalidation_audit": inv_check,
        }

    def handle_mod3_backtest(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        ticker = arg_ticker(payload, "target_asset", "ticker")
        fast_ma = int(arg_num(payload, "fast_ma", 5, "短均線週期", integer=True, lo=2, hi=250))
        slow_ma = int(arg_num(payload, "slow_ma", 20, "長均線週期", integer=True, lo=3, hi=250))
        if slow_ma <= fast_ma:
            raise ValueError(f"長均線週期（{slow_ma}）必須大於短均線週期（{fast_ma}），例如 5 與 20")
        initial_capital = arg_num(payload, "initial_capital", 1_000_000.0, "初始本金", lo=10000)
        commission_discount = arg_num(payload, "commission_discount", 0.6, "手續費折數", lo=0, hi=1)

        feed = self.adapter.fetch_bars(ticker, days=250)
        bars: List[Bar] = feed["bars"]
        market = feed["market"]

        closes = [b.close for b in bars]
        fast_list = calculate_ma(closes, fast_ma)
        slow_list = calculate_ma(closes, slow_ma)

        signals: List[int] = [0] * len(bars)
        in_pos = False
        for i in range(1, len(bars)):
            if (
                fast_list[i] is None
                or slow_list[i] is None
                or fast_list[i - 1] is None
                or slow_list[i - 1] is None
            ):
                continue
            if not in_pos and fast_list[i] > slow_list[i] and fast_list[i - 1] <= slow_list[i - 1]:
                signals[i] = 1
                in_pos = True
            elif in_pos and fast_list[i] < slow_list[i]:
                signals[i] = -1
                in_pos = False

        # 不再偷換策略：若此參數在期間內沒有產生足夠訊號，就如實回報（交易次數少/為 0）
        buy_signals = sum(1 for sg in signals if sg == 1)
        strategy_warnings = []
        if buy_signals < 2:
            strategy_warnings.append(
                f"此均線參數 (快線 {fast_ma}/慢線 {slow_ma}) 在這段期間只產生 {buy_signals} 次買進訊號，結果沒有統計意義；請調整參數，系統不會自動換成別的策略。"
            )

        engine = BacktestEngine(
            market=market,
            initial_capital=initial_capital,
            commission_discount=commission_discount,
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
            },
            "strategy_warnings": strategy_warnings,
            "execution_rule": "NEXT_BAR_OPEN (零偷看未來數據)",
            "equity_curve": equity_curve,
            "backtest_result": bt_result,
        }

    def handle_mod4_risk(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        fx_info = self.adapter.fetch_usd_twd_rate()
        usd_twd = arg_num(payload, "usd_twd_rate", fx_info["usd_twd"], "美元匯率", lo=1, hi=1000)

        holdings = payload.get(
            "holdings",
            [
                {"symbol": "2330", "market": "TW", "shares": 1000, "price": 1050.0},
                {"symbol": "0050", "market": "TW", "shares": 2000, "price": 190.0},
                {"symbol": "NVDA", "market": "US", "shares": 100, "price": 138.6},
            ],
        )
        # 只計算有代號且股數為正的持股；全部無效時回 400 與白話訊息（避免後面除以 0 或缺欄位而崩潰）
        def _num(v: Any) -> float:
            try:
                return float(v)
            except (TypeError, ValueError):
                return 0.0

        holdings = [
            {**h, "symbol": str(h.get("symbol", "")).strip(), "shares": _num(h.get("shares")),
             "price": _num(h.get("price"))}
            for h in (holdings or []) if isinstance(h, dict)
        ]
        holdings = [h for h in holdings if h["symbol"] and h["shares"] > 0]
        if not holdings:
            raise ValueError("目前沒有可計算的持股：請至少輸入一檔代號，且股數大於 0")

        # 即時價格：use_live_prices（預設 True）時以真實報價覆蓋每檔持股價格；查不到才沿用你填的價格並標示
        price_notes: Dict[str, str] = {}
        live_q: Dict[str, Dict[str, Any]] = {}
        if payload.get("use_live_prices", True):
            syms = [str(h.get("symbol", "")) for h in holdings]
            for q in quote_provider.get_quotes(syms, WATCHLIST_NAMES):
                if q:
                    live_q[_hold_code(q["symbol"])] = q
            holdings = [dict(h) for h in holdings]
            for h in holdings:
                code = _hold_code(h["symbol"])
                q = live_q.get(code)
                if q and q.get("is_live"):
                    h["price"] = q["price"]
                    h["currency"] = q.get("currency")
                    price_notes[code] = f"即時價 {q['price']} {q.get('currency', '')}（{q['source']}，{q.get('quote_time', '')}）"
                else:
                    price_notes[code] = "查無即時價，沿用輸入價格"

        # 市場一律依代號判斷（使用者選的 TW／US 只當參考）；幣別：即時報價回傳的優先，否則用市場預設
        for h in holdings:
            n = DualMarketDataAdapter.normalize_symbol(h["symbol"])
            h["market"] = n["market"]
            h["currency"] = h.get("currency") or n["currency"]
        fx_rates = fx.rates_to_twd(h["currency"] for h in holdings)
        if "usd_twd_rate" in payload and "USD" in fx_rates:  # 使用者手動指定美元匯率
            fx_rates["USD"] = {**fx_rates["USD"], "rate": usd_twd, "source": "使用者輸入", "warning": None}
        missing_fx = [c for c, r in fx_rates.items() if not r.get("rate")]
        if missing_fx:
            raise ValueError("無法取得 " + "、".join(missing_fx) + " 兌台幣匯率，暫時無法換算這些持股的台幣價值，請稍後再試")
        for h in holdings:
            h["fx_rate"] = fx_rates[h["currency"]]["rate"]

        # 預先平行抓取各持股的 Beta / 歷史日 K / 前十大成分股（結果會快取，下面再呼叫時是即時的）
        def _warm(fn):
            try:
                fn()
            except Exception:
                pass

        warm_tasks = []
        for h in holdings:
            code = _hold_code(h["symbol"])
            warm_tasks.append(lambda c=code: etf_data.calc_beta(c))
            warm_tasks.append(lambda c=code: stress._closes(c))
            if (h["market"] == "TW" and code.startswith("00")) or (live_q.get(code) or {}).get("instrument_type") == "ETF":
                warm_tasks.append(lambda c=code: etf_data.top_holdings(c))
        with ThreadPoolExecutor(max_workers=8) as pool:
            list(pool.map(_warm, warm_tasks))

        # 真實 ETF 前十大成分股（Yahoo topHoldings）；抓不到才回退到程式內的概略表並標示
        etf_holdings: Dict[str, Dict[str, float]] = {}
        lookthrough_sources: Dict[str, str] = {}
        for h in holdings:
            code = _hold_code(h["symbol"])
            is_etf = (
                code in etf_data.fund_registry()  # 台股 ETF（TWSE 基金清單）
                or (h["market"] == "TW" and code.startswith("00"))
                or (live_q.get(code) or {}).get("instrument_type") == "ETF"  # 美股 ETF
                or code in ("QQQ", "SPY", "VOO", "VTI")
            )
            th = etf_data.top_holdings(code) if is_etf else None
            if th:
                etf_holdings[code] = {i["symbol"]: i["pct"] / 100 for i in th["holdings"]}
                lookthrough_sources[code] = f"{th['source']}，前十大合計 {th['covered_pct']}%"
            elif code in PortfolioRiskManager.ETF_HOLDINGS_LOOKTHROUGH:
                lookthrough_sources[code] = "STATIC_FALLBACK 程式內概略值（即時來源抓取失敗，不可當真）"
        risk_mgr = PortfolioRiskManager(usd_twd_rate=usd_twd, etf_holdings=etf_holdings or None)
        weights_res = risk_mgr.calculate_portfolio_weights(holdings)
        lookthrough = risk_mgr.calculate_lookthrough_exposure(weights_res)

        # Beta：使用者有填就用填的，留空則用近 1 年真實日報酬自動計算
        beta_detail = []
        raw_beta = payload.get("portfolio_beta")
        if raw_beta in (None, "", 0):
            tot = sum(h["weight_pct"] for h in weights_res["holdings"]) or 1.0
            acc, covered = 0.0, 0.0
            for h in weights_res["holdings"]:
                b = etf_data.calc_beta(h["symbol"])
                beta_detail.append({"symbol": h["symbol"], "beta": b["beta"] if b else None,
                                    "benchmark": b["benchmark"] if b else None})
                if b:
                    acc += h["weight_pct"] * b["beta"]
                    covered += h["weight_pct"]
            portfolio_beta = round(acc / covered, 2) if covered else 1.0
            beta_source = (
                f"近 1 年日報酬 vs 大盤自動計算（涵蓋持股 {round(covered / tot * 100, 1)}%）"
                if covered else "無法計算，暫用 1.0"
            )
            if len({h["market"] for h in holdings}) > 1:
                beta_source += "；不同市場各自對自己的大盤計算，混合市場時「大盤 -20%」等於假設各市場同時跌 20%，僅供粗估"
        else:
            portfolio_beta = arg_num(payload, "portfolio_beta", 1.0, "Beta（留空＝自動計算）", lo=-5, hi=5)
            beta_source = "使用者手動輸入"

        target_weights = payload.get(
            "target_weights",
            {"2330": 35.0, "0050": 25.0, "NVDA": 20.0, "CASH": 20.0},
        )
        try:
            rebalance = risk_mgr.generate_rebalance_plan(weights_res["holdings"], target_weights)
        except ValueError as err:
            total_target = round(sum(float(v) for v in target_weights.values()), 2)
            rebalance = {
                "weight_conservation_passed": False,
                "target_weight_sum_pct": total_target,
                "error": str(err),
                "rebalance_table": [],
            }
        try:
            historical = stress.historical_stress(weights_res["holdings"], usd_twd)
        except Exception as e:
            historical = {"available": False, "reason": f"歷史回落計算失敗：{e}"}
        crash_sim = risk_mgr.simulate_crash_20pct(
            total_value_twd=weights_res["total_value_twd"],
            portfolio_beta=portfolio_beta,
        )

        return {
            "module": 4,
            "usd_twd_rate": usd_twd,
            "fx_rates": fx_rates,
            "fx_source": fx_info["source"] if "usd_twd_rate" not in payload else "使用者輸入",
            "fx_warning": "；".join(r["warning"] for r in fx_rates.values() if r.get("warning")) or None,
            "portfolio_valuation": weights_res,
            "lookthrough_exposure_pct": lookthrough,
            "lookthrough_sources": lookthrough_sources,
            "price_sources": price_notes,
            "historical_replay": historical,
            "portfolio_beta_used": portfolio_beta,
            "portfolio_beta_source": beta_source,
            "beta_detail": beta_detail,
            "rebalance_verification": rebalance,
            "crash_20pct_stress_test": crash_sim,
        }

    def _enrich_journal(self, entries: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """使用者的真實交易：自動補上損益、報酬率、持有天數，並用真實日 K 算『出場後 5 個交易日最高價』。"""
        out, bars_cache = [], {}
        date_re = re.compile(r"^\d{4}-\d{2}-\d{2}")
        for e in entries:
            e = dict(e)
            try:
                ep, xp, sh = float(e.get("entry_price") or 0), float(e.get("exit_price") or 0), int(float(e.get("shares") or 0))
            except (TypeError, ValueError):
                out.append(e)
                continue
            fees = float(e.get("fees") or 0)
            if ep and xp and sh:
                e["net_pnl"] = round((xp - ep) * sh - fees, 2)
            if ep and xp:
                e["return_pct"] = round((xp / ep - 1) * 100, 2)
            ed, xd = str(e.get("entry_time", "")), str(e.get("exit_time", ""))
            if date_re.match(ed) and date_re.match(xd):
                e["holding_days"] = (datetime.strptime(xd[:10], "%Y-%m-%d") - datetime.strptime(ed[:10], "%Y-%m-%d")).days
            if date_re.match(xd) and e.get("high_5d_after_exit") in (None, "", 0) and e.get("symbol"):
                sym = str(e["symbol"])
                if sym not in bars_cache:
                    try:
                        bars_cache[sym] = self.adapter.fetch_bars(sym, days=250)["bars"]
                    except Exception:
                        bars_cache[sym] = []
                after = [b for b in bars_cache[sym] if b.timestamp > xd[:10]][:5]
                if after:
                    e["high_5d_after_exit"] = max(b.high for b in after)
                    e["post_exit_source"] = "真實還權日 K（出場後 5 個交易日最高價；還權價與實際成交價可能有些微差異）"
            out.append(e)
        return out

    @staticmethod
    def _to_journal_entry(e: Dict[str, Any]) -> JournalEntry:
        """相容前端欄位名 (net_pnl/return_pct/high_5d_after_exit) 與引擎欄位名 (pnl_amount/pnl_pct/post_exit_5d_high)。"""
        g = lambda *keys, default=0: next((e[k] for k in keys if k in e and e[k] not in (None, "")), default)  # noqa: E731
        return JournalEntry(
            trade_id=str(g("trade_id", default="#00")),
            symbol=str(g("symbol", default="")),
            entry_time=str(g("entry_time", default="")),
            exit_time=str(g("exit_time", default="")),
            entry_price=float(g("entry_price")),
            exit_price=float(g("exit_price")),
            shares=int(g("shares")),
            pnl_amount=float(g("pnl_amount", "net_pnl")),
            pnl_pct=float(g("pnl_pct", "return_pct")),
            holding_days=int(g("holding_days")),
            post_exit_5d_high=float(g("post_exit_5d_high", "high_5d_after_exit")),
            emotion_score=int(g("emotion_score")),
        )

    def handle_mod5_coach(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        raw_entries = payload.get("entries")
        if raw_entries:
            raw_entries = self._enrich_journal(raw_entries)
            entries = [self._to_journal_entry(e) for e in raw_entries]
        else:
            entries = [
                JournalEntry("#01", "2330.TW", "09:10", "13:20", 1000.0, 1020.0, 1000, 20000.0, 2.0, 1, 1095.0),
                JournalEntry("#02", "2603.TW", "09:05", "13:30", 180.0, 175.0, 1000, -5000.0, -2.7, 1, 176.0),
                JournalEntry("#03", "3017.TW", "09:15", "10:00", 600.0, 528.0, 1000, -72000.0, -12.0, 10, 530.0),
                JournalEntry("#04", "2330.TW", "09:02", "09:35", 1020.0, 1010.0, 3000, -30000.0, -1.0, 1, 1015.0),
                JournalEntry("#08", "NVDA", "21:35", "23:50", 140.0, 124.0, 200, -3200.0, -11.4, 8, 125.0),
                JournalEntry("#09", "NVDA", "21:30", "22:15", 125.0, 122.0, 600, -1800.0, -2.4, 1, 128.0),
            ]

        coach = JournalCoach(entries)
        stats = coach.compute_statistics()
        biases = coach.detect_behavioral_biases()
        rules = coach.formulate_personalized_rules(biases)
        rules_source = "固定規則範本（未使用 AI，不是依你的交易量身產生）"
        if ai_client.is_enabled(payload.get("ai")):
            try:
                rules = ai_client.personal_rules(payload["ai"], stats, biases)
                rules_source = f"AI（{payload['ai'].get('model')}）依你的交易統計與偏誤產生，已檢查每條都有數字門檻"
            except ai_client.AIError as e:
                rules_source = f"AI 產生失敗，改用固定規則範本（{e}）"

        return {
            "module": 5,
            "statistics": stats,
            "detected_biases": biases,
            "personalized_3_rules": rules,
            "rules_source": rules_source,
            "entries_used": raw_entries if raw_entries else None,
        }

    def handle_run_tests(self) -> Dict[str, Any]:
        """
        執行全系統視覺化驗收測試套件，回傳每項測試的模組歸屬、測試意圖、預期值 vs 實測輸出、耗時與狀態。
        """
        import time as _time
        from src.indicators import calculate_ma, calculate_rsi
        from src.market_rules import align_tw_tick, calculate_friction_cost
        from src.anti_hallucination import AntiHallucinationGuard

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


DISPATCHER = TradingEngineDispatcher()


class TradingAPIRequestHandler(SimpleHTTPRequestHandler):
    """結合靜態資源與 /api/* 路由的 HTTP Handler"""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB_DIR), **kwargs)

    def _send_json(self, data: Dict[str, Any], status: int = 200) -> None:
        raw = json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def end_headers(self) -> None:
        # 開發用：靜態檔不快取，改完程式重新整理就會生效（API 路徑已另外設定）
        if not self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_GET(self) -> None:
        if self.path.startswith("/api/health"):
            self._send_json(DISPATCHER.handle_health())
            return
        if self.path.startswith("/api/indices"):
            self._send_json(DISPATCHER.handle_indices())
            return
        if self.path.startswith("/api/etf"):
            self._send_json(DISPATCHER.handle_etf_list())
            return
        if self.path.startswith("/api/fetchlog"):
            self._send_json({"log": quote_provider.get_fetch_log()})
            return
        if self.path.startswith("/api/tests/run"):
            self._send_json(DISPATCHER.handle_run_tests())
            return
        super().do_GET()

    # 伺服器端紀錄：輪詢型 API 只記錯誤，其他（分析、AI、風控…）成功也記，方便追蹤
    QUIET_PATHS = ("/api/quotes", "/api/indices", "/api/sparks", "/api/intraday", "/api/overview", "/api/fx",
                   "/api/health", "/api/etf", "/api/fetchlog", "/api/log", "/api/categories", "/api/candles")

    def _log_request(self, status: int, started: float, payload: Any = None, res: Any = None) -> None:
        path = self.path.split("?")[0]
        if status < 400 and (path.startswith(self.QUIET_PATHS) or path == "/api/mod1/analyze"):
            return  # 技術分析每 5 秒自動刷新，成功的不記；失敗一定記
        p = payload if isinstance(payload, dict) else {}
        ev = {"type": "api", "path": path, "status": status, "ms": int((time.time() - started) * 1000),
              "symbol": p.get("ticker") or p.get("symbol") or p.get("target_asset") or p.get("target"),
              "module": p.get("module")}
        if isinstance(res, dict):
            if res.get("error"):
                ev["level"], ev["error"] = "error", str(res["error"])[:300]
            if res.get("ai_usage"):
                ev["ai_tokens"] = [(u.get("model"), u.get("input_tokens"), u.get("output_tokens")) for u in res["ai_usage"]]
        if status >= 400:
            ev["level"] = "error"
        try:
            activity_log.write([{k: v for k, v in ev.items() if v not in (None, "", [])}], "server")
        except Exception:
            pass

    def _with_usage(self, res: Any) -> Any:
        """把這次請求呼叫 AI 的用量附在回應（ai_usage），前端據此記錄與估算費用。"""
        usage = ai_client.collect_usage()
        if usage and isinstance(res, dict):
            res = {**res, "ai_usage": [{**u, "endpoint": self.path} for u in usage]}
        return res

    def do_POST(self) -> None:
        if not self.path.startswith("/api/"):
            self._send_json({"error": f"Unknown endpoint: {self.path}"}, status=404)
            return

        content_len = int(self.headers.get("Content-Length", "0"))
        body_bytes = self.rfile.read(content_len) if content_len > 0 else b"{}"
        try:
            payload = json.loads(body_bytes.decode("utf-8") or "{}")
        except Exception as e:
            self._send_json({"error": f"Invalid JSON payload: {e}"}, status=400)
            return

        ai_client.begin_usage()  # 收集這個請求呼叫 AI 用掉的 tokens
        started = time.time()
        try:
            if self.path == "/api/mod1/analyze":
                res = DISPATCHER.handle_mod1_analyze(payload)
            elif self.path == "/api/news":
                res = DISPATCHER.handle_news(payload)
            elif self.path == "/api/intraday":
                res = DISPATCHER.handle_intraday(payload)
            elif self.path == "/api/overview":
                res = DISPATCHER.handle_overview(payload)
            elif self.path in ("/api/ai/test", "/api/ai/models", "/api/ai/explain", "/api/ai/detect"):
                res = DISPATCHER.handle_ai(self.path.rsplit("/", 1)[1], payload)
            elif self.path == "/api/stockinfo":
                res = DISPATCHER.handle_stockinfo(payload)
            elif self.path == "/api/log":
                events = payload.get("events") if isinstance(payload.get("events"), list) else []
                res = {"written": activity_log.write(events[:200], "browser")}
            elif self.path == "/api/log/recent":
                res = {"events": activity_log.read_recent(int(arg_num(payload, "limit", 200, "筆數", integer=True, lo=1, hi=2000)),
                                                          bool(payload.get("errors_only")))}
            elif self.path == "/api/fx":
                res = DISPATCHER.handle_fx(payload)
            elif self.path == "/api/chips":
                res = DISPATCHER.handle_chips(payload)
            elif self.path == "/api/dividends":
                res = DISPATCHER.handle_dividend_calendar(payload)
            elif self.path == "/api/categories":
                res = DISPATCHER.handle_categories(payload)
            elif self.path == "/api/candles":
                res = DISPATCHER.handle_candles(payload)
            elif self.path == "/api/sparks":
                res = DISPATCHER.handle_sparks(payload)
            elif self.path == "/api/quotes":
                res = DISPATCHER.handle_quotes(payload)
            elif self.path == "/api/mod2/news":
                res = DISPATCHER.handle_mod2_news(payload)
            elif self.path == "/api/mod3/backtest":
                res = DISPATCHER.handle_mod3_backtest(payload)
            elif self.path == "/api/mod4/risk":
                res = DISPATCHER.handle_mod4_risk(payload)
            elif self.path == "/api/mod5/coach":
                res = DISPATCHER.handle_mod5_coach(payload)
            elif self.path == "/api/tests/run":
                res = DISPATCHER.handle_run_tests()
            else:
                self._send_json({"error": f"Route not found: {self.path}"}, status=404)
                self._log_request(404, started, payload, {"error": f"Route not found: {self.path}（伺服器可能是舊版，請重開）"})
                return
            res = self._with_usage(res)
            self._send_json(res, status=200)
            self._log_request(200, started, payload, res)
        except ValueError as err:  # 輸入有誤：回 400 與可直接顯示給使用者的訊息
            self._send_json(self._with_usage({"error": str(err)}), status=400)
            self._log_request(400, started, payload, {"error": str(err)})
        except Exception as err:
            self._send_json(self._with_usage({"error": str(err)}), status=500)
            self._log_request(500, started, payload, {"error": str(err)})


def load_env_file(path: Path = Path(__file__).resolve().parent.parent / ".env") -> List[str]:
    """讀取專案根目錄的 .env（KEY=VALUE，# 開頭為註解）；已存在的環境變數優先，不覆蓋。回傳載入的鍵名。"""
    import os

    loaded = []
    if not path.exists():
        return loaded
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value
            loaded.append(key)
    return loaded


def run_server(port: int = 8088) -> None:
    loaded = load_env_file()
    if loaded:
        print(f"已從 .env 載入：{', '.join(loaded)}")  # 只印鍵名，不印值
    server = ThreadingHTTPServer(("127.0.0.1", port), TradingAPIRequestHandler)
    print(f"Trading AI Full-Stack Server listening on http://localhost:{port}")
    server.serve_forever()


if __name__ == "__main__":
    target_port = int(sys.argv[1]) if len(sys.argv) > 1 else 8088
    run_server(target_port)
