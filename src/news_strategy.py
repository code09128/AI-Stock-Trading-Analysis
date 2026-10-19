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

    def classify_market_session(self, timestamp_iso: str) -> str:
        """
        正規化時間戳記並判斷發布時段：
        - TW (台股 09:00 ~ 13:30): PRE (00:00~08:59), REGULAR (09:00~13:30), POST (13:31~23:59)
        - US (美股 09:30 ~ 16:00 美東): PRE (04:00~09:29), REGULAR (09:30~16:00), POST (16:01~20:00)
        """
        try:
            dt = datetime.fromisoformat(timestamp_iso.replace("Z", "+00:00"))
            t = dt.time()
        except Exception:
            return "UNKNOWN"

        if self.market == "TW":
            if time(9, 0) <= t <= time(13, 30):
                return "REGULAR" # 盤中
            elif t < time(9, 0):
                return "PRE"     # 盤前
            else:
                return "POST"    # 盤後
        else:
            # 簡易美股交易時段判定
            if time(9, 30) <= t <= time(16, 0):
                return "REGULAR"
            elif time(4, 0) <= t < time(9, 30):
                return "PRE"
            else:
                return "POST"

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
        vague_phrases = ["市場轉差", "情緒不佳", "保持良好心態", "隨機應變", "若走勢不如預期"]
        
        has_vague = any(vp in criteria_text for vp in vague_phrases)

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
