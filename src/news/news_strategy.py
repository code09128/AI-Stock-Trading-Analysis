"""
模組 2：新聞轉交易策略核心模組 (news_strategy.py)
核心功能：
1. 新聞時間戳記正規化（嚴格區分盤前 PRE、盤中 REGULAR、盤後 POST）
2. 注入事件前 5 日／20 日漲跌幅，客觀判定市場是否已提前反映 (Priced-in)
3. 結合 ATR 計算合理的預期波動區間（台股嚴格受限於 ±10% 漲跌停限制，美股依 ATR 倍數）
4. 強制驗證「判斷失效條件 (Invalidation Criteria)」具備量化價位或事件
"""

from typing import Dict, Any, List, Optional
from datetime import datetime, time
import re

class NewsStrategyAnalyzer:
    def __init__(self, market: str = "TW"):
        self.market = market.upper()

    def classify_market_session(self, timestamp_iso: str, trading_day: Optional[tuple] = None) -> str:
        """
        正規化時間戳記並判斷發布時段（trading_day＝market_calendar.trading_day() 的結果；非交易日回 CLOSED）：
        - 交易時段來自 src/markets.py（當地時間；港、日、陸、星有午休，午休視同盤中）
        - 開盤前＝PRE（美股 04:00 前算前一晚的 POST）、收盤後＝POST
        """
        try:
            dt = datetime.fromisoformat(timestamp_iso.replace("Z", "+00:00"))
            t = dt.time()
        except Exception:
            return "UNKNOWN"
        if dt.weekday() >= 5 or (trading_day is not None and not trading_day[0]):
            return "CLOSED"  # 週末或假日休市：消息要到下一個交易日開盤才反應

        from src.market import markets

        hm = lambda x: time(int(x[:2]), int(x[3:]))  # noqa: E731
        windows = [(hm(a), hm(b)) for a, b in markets.sessions(self.market)]
        if any(a <= t <= b for a, b in windows):
            return "REGULAR"  # 盤中
        if windows[0][0] > t:
            pre = markets.info(self.market).get("pre_open")
            # 美股 04:00 以前的消息歸到盤後（前一晚），其他市場開盤前都算盤前
            return "PRE" if not pre or t >= hm(pre) else "POST"
        if t > windows[-1][1]:
            return "POST"  # 盤後
        return "REGULAR"  # 午休：下午盤就會反應，視同盤中

    def evaluate_priced_in_risk(
        self,
        news_sentiment: str,
        ret_5d_pct: float,
        ret_20d_pct: float
    ) -> Dict[str, Any]:
        """
        根據事件前 5 日／20 日累積漲跌幅，評估利多出盡 (Sell the news) 或利空鈍化風險：
        - 若新聞為利多 (POSITIVE)，但過去 10~20 日漲幅已超過 10%，標記為高「已反映 (Priced-in)」風險。
        - 若新聞為利空 (NEGATIVE)，但過去 10~20 日跌幅已超過 10%，標記為「利空出盡可能」。
        """
        is_positive = news_sentiment.upper() in ["POSITIVE", "BULLISH", "利多"]
        is_negative = news_sentiment.upper() in ["NEGATIVE", "BEARISH", "利空"]

        priced_in_risk = False
        warning_msg = "市場尚未顯著提前反映此消息。"

        if is_positive:
            if ret_20d_pct >= 10.0 or ret_5d_pct >= 6.0:
                priced_in_risk = True
                warning_msg = f"警示：事件前 20 日已大漲 {ret_20d_pct}% (5日漲 {ret_5d_pct}%)，市場已高度反映 (Priced-in)，提防利多出盡開高走低！"
        elif is_negative:
            if ret_20d_pct <= -10.0 or ret_5d_pct <= -6.0:
                priced_in_risk = True
                warning_msg = f"注意：事件前 20 日已重挫 {ret_20d_pct}%，市場已部分消化利空，留意低檔背離或利空出盡反彈。"

        return {
            "priced_in_risk": priced_in_risk,
            "ret_5d_pct": ret_5d_pct,
            "ret_20d_pct": ret_20d_pct,
            "analysis_note": warning_msg
        }

    def calculate_expected_volatility_bounds(
        self,
        current_price: float,
        atr_14: float,
        atr_multiplier: float = 1.5
    ) -> Dict[str, float]:
        """
        結合 ATR 計算預期價格波動區間。
        - 台股嚴格限制於單日 ±10% 漲跌停價格限制之內。
        - 美股依據 ATR 倍數動態計算。
        """
        raw_move = atr_14 * atr_multiplier

        if self.market == "TW":
            # 台股法定 ±10% 上下限
            max_limit = round(current_price * 1.10, 2)
            min_limit = round(current_price * 0.90, 2)

            upper_bound = min(round(current_price + raw_move, 2), max_limit)
            lower_bound = max(round(current_price - raw_move, 2), min_limit)
        else:
            upper_bound = round(current_price + raw_move, 2)
            lower_bound = max(0.01, round(current_price - raw_move, 2))

        return {
            "current_price": current_price,
            "atr": atr_14,
            "upper_bound": upper_bound,
            "lower_bound": lower_bound,
            "expected_move_pct": round((raw_move / current_price) * 100, 2)
        }

    def validate_invalidation_criteria(self, criteria_text: str) -> Dict[str, Any]:
        """
        驗證策略失效條件是否具備具體量化標準：
        - 必須包含具體數字價位（如 1020 元、跌破 5 日低點）或具體籌碼基本面事件。
        - 禁止空泛心態詞彙（如「若大盤轉差」、「若市場悲觀」）。
        """
        if not criteria_text or len(criteria_text.strip()) < 6:
            return {"valid": False, "reason": "失效條件不能為空，字數不足。"}

        # 檢查是否含有數字或價位模式
        has_number = bool(re.search(r"\d+", criteria_text))
        vague_phrases = ["市場轉差", "情緒不佳", "保持良好心態", "隨機應變", "若走勢不如預期",
                         "感覺", "不對勁", "氣氛", "看情況", "視情況"]
        has_vague = any(vp in criteria_text for vp in vague_phrases)
        # 「關鍵支撐價位」這類參考點沒寫出價格：句子裡除了百分比、天數之外，要有一個真正的價位數字
        vague_anchor = re.search(r"(關鍵|重要|主要)(支撐|壓力|價位|價格)|支撐價位|壓力價位", criteria_text)
        price_numbers = re.findall(r"(?<![\d.])\d+(?:\.\d+)?(?![\d.]|\s*(?:%|％|日|天|週|周|月|年|根|倍|分鐘|小時|萬|張|股|次|檔))",
                                   criteria_text)
        if vague_anchor and not price_numbers:
            return {
                "valid": False,
                "reason": f"「{vague_anchor.group(0)}」沒有寫出具體價位，請改成例如「跌破 1035 元」。"
            }

        if not has_number:
            return {
                "valid": False,
                "reason": "失效條件缺少具體可量化的價位或百分比門檻（例如：跌破 1020 元或跌逾 3%）。"
            }

        if has_vague:
            return {
                "valid": False,
                "reason": "包含模糊空泛描述，請替換為客觀可執行的停損或退場標準。"
            }

        return {"valid": True, "criteria": criteria_text}
