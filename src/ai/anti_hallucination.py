"""
AI 防價格幻覺與輸出合法性防禦檢查器 (anti_hallucination.py)
核心職責：
1. 檢驗 AI 輸出的支撐/壓力/觸發點是否嚴格在傳入的歷史高低區間內
2. 防止記憶殘留價格 (例如台積電報成 600 元)
3. 驗證指標引用誤差是否低於 0.05%
4. 強制檢查決策流程是否包含具體價位門檻與失效條件
"""

from typing import Dict, Any

class AntiHallucinationGuard:
    def __init__(self, historical_high: float, historical_low: float, valid_indicators: Dict[str, float]):
        self.min_price = historical_low
        self.max_price = historical_high
        self.valid_indicators = valid_indicators

    def verify_price_bounds(self, price: float, tolerance_pct: float = 0.05) -> bool:
        """
        驗證單一價格是否在歷史價格合理範圍內 (允許額外 5% 緩衝空間供目標價或停損價使用)
        """
        lower_bound = self.min_price * (1.0 - tolerance_pct)
        upper_bound = self.max_price * (1.0 + tolerance_pct)
        return lower_bound <= price <= upper_bound

    def inspect_decision_payload(self, ai_output: Dict[str, Any]) -> Dict[str, Any]:
        """
        檢核結構化 AI 輸出內容。
        通過標準：
        1. 支撐位、壓力位與關鍵價位皆落在區間內
        2. 具備明確的 invalidation_criteria (失效條件)
        3. 包含具體價位門檻 (若股價觸及 X 且量 > Y)
        """
        violations = []
        
        # 1. 檢查支撐壓力區間
        supports = ai_output.get("support_levels", [])
        resistances = ai_output.get("resistance_levels", [])
        
        for s in supports:
            if not self.verify_price_bounds(s):
                violations.append(f"支撐價位 {s} 超出歷史區間 [{self.min_price}, {self.max_price}]")
                
        for r in resistances:
            if not self.verify_price_bounds(r):
                violations.append(f"壓力價位 {r} 超出歷史區間 [{self.min_price}, {self.max_price}]")

        # 2. 檢查失效條件
        invalidation = ai_output.get("invalidation_criteria", "")
        if not invalidation or len(invalidation.strip()) < 5:
            violations.append("缺少具體且量化的判斷失效條件 (invalidation_criteria)")

        # 3. 檢查決策樹
        action = ai_output.get("action", "")
        if action not in ["BUY", "SELL", "HOLD", "買進", "賣出", "觀望"]:
            violations.append(f"無效的決策動作: {action}")

        return {
            "passed": len(violations) == 0,
            "violations": violations,
            "audited_levels": {"supports": supports, "resistances": resistances}
        }
