"""技術分析（/api/mod1/analyze）"""

from typing import Dict, Any, List
import time

from src.market.data_adapter import DualMarketDataAdapter
from src.ai.llm_runner import LLMRunner
from src.market.bar import Bar
from src.technical import scenarios
from src.technical.indicators import calculate_ma
from src.market import quote_provider
from src.company import stock_info
from src.server.config import WATCHLIST_NAMES
from src.server.params import arg_num, arg_ticker
from src.technical.weekly import to_weekly_bars, weekly_summary


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


class TechnicalHandlers:
    """技術分析（/api/mod1/analyze）"""

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

        # 多空三情境：固定用約 2 年日線（週線才有足夠樣本），與畫面的 K 棒數量無關
        try:
            daily = feed["bars"] if timeframe == "W" else self.adapter.fetch_bars(ticker, days=520)["bars"]
            scen = scenarios.build(snapshot, daily)
        except Exception as e:
            scen = {"error": f"三情境計算失敗：{e}"}

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
            "scenarios": scen,
        }
