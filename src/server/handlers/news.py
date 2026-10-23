"""新聞：新聞清單、近期新聞彙整、新聞判斷（/api/mod2/news）"""

from typing import Dict, Any, List
from datetime import datetime

from src.market.data_adapter import DualMarketDataAdapter
from src.news.news_strategy import NewsStrategyAnalyzer
from src.market.bar import Bar
from src.news import news_digest
from src.market import quote_provider
from src.market import market_calendar
from src.news import news_feed
from src.ai import ai_client
from src.server.config import WATCHLIST_NAMES
from src.server.params import arg_num, arg_ticker


class NewsHandlers:
    """新聞：新聞清單、近期新聞彙整、新聞判斷（/api/mod2/news）"""

    def handle_news(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        sym = str(payload.get("symbol", "2330")).strip()
        return news_feed.fetch_news(sym, self._display_name(sym))

    @staticmethod
    def _display_name(sym: str) -> str:
        norm = DualMarketDataAdapter.normalize_symbol(sym)
        name = WATCHLIST_NAMES.get(norm["symbol"]) or WATCHLIST_NAMES.get(norm["raw_code"]) or ""
        if not name:
            q = quote_provider.get_quotes([sym], WATCHLIST_NAMES)[0]
            name = q.get("name", "") if q.get("name") != norm["raw_code"] else ""
        return name

    def handle_news_digest(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """近期新聞逐則整理 5 個面向並依重要性排序（有 AI 時由 AI 整理，否則關鍵字規則）。"""
        from src.technical.indicators import calculate_atr
        news = self.handle_news(payload)
        feed = self.adapter.fetch_bars(str(payload.get("symbol", "2330")), days=120)
        bars = feed["bars"]
        atr = calculate_atr([b.high for b in bars], [b.low for b in bars], [b.close for b in bars])[-1] if bars else None
        name = self._display_name(str(payload.get("symbol", "2330")))
        return news_digest.build(news, bars, feed["market"], atr, payload.get("ai"), news["symbol"], name)

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

        invalidation_text = str(payload.get("invalidation_criteria") or "").strip()
        if not invalidation_text:  # 沒填就用現價附近的真實支撐／壓力組出具體條件
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
