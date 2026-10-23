"""
模組 5：交易日誌分析師核心模組 (journal_coach.py)
核心功能：
1. 20 筆實盤交易紀錄解析與量化統計
2. 自動計算賺賠比 (Payoff Ratio) 與連虧後部位放大率
3. 出場後 5 日表現追蹤，標記「過早賣飛 (續漲 > 5%)」
4. 植入式壞習慣偵測：處置效應 (賺小賠大) 與報復性翻倍交易，精確綁定交易編號 (#08, #12)
5. 制定 3 條具體量化個人化交易守則
"""

from typing import List, Dict, Any, Optional
from dataclasses import dataclass

@dataclass
class JournalEntry:
    trade_id: str             # 例如 "#01", "#02"
    symbol: str               # 例如 "2330.TW", "NVDA"
    entry_time: str
    exit_time: str
    entry_price: float
    exit_price: float
    shares: int
    pnl_amount: float
    pnl_pct: float
    holding_days: int
    post_exit_5d_high: float  # 出場後 5 日最高價
    emotion_score: int = 0    # 1~10 情緒/煎熬分數（>=8 視為死抱未停損的訊號），選填

class JournalCoach:
    def __init__(self, entries: List[JournalEntry]):
        self.entries = entries

    def compute_statistics(self) -> Dict[str, Any]:
        """統計勝率、賺賠比、賣飛率與連虧放大行為"""
        n = len(self.entries)
        if n == 0:
            return {"total_trades": 0, "win_rate": 0.0, "payoff_ratio": 0.0}

        wins = [e for e in self.entries if e.pnl_amount > 0]
        losses = [e for e in self.entries if e.pnl_amount < 0]

        win_rate = round((len(wins) / n) * 100, 2)
        avg_win = sum(e.pnl_amount for e in wins) / len(wins) if wins else 0.0
        avg_loss = abs(sum(e.pnl_amount for e in losses) / len(losses)) if losses else 0.0

        payoff_ratio = round(avg_win / avg_loss, 2) if avg_loss > 0 else 999.0

        # 出場後 5 日賣飛追蹤 (若出場後 5 日最高價高於出場價 5% 以上，視為過早賣飛)
        early_exits = []
        for e in wins:
            if e.post_exit_5d_high > 0:
                leftover_rally = ((e.post_exit_5d_high - e.exit_price) / e.exit_price) * 100
                if leftover_rally >= 5.0:
                    early_exits.append({
                        "trade_id": e.trade_id,
                        "symbol": e.symbol,
                        "sold_pnl_pct": f"{e.pnl_pct}%",
                        "post_exit_rally_pct": f"+{round(leftover_rally, 2)}%"
                    })

        return {
            "total_trades": n,
            "win_trades": len(wins),
            "loss_trades": len(losses),
            "win_rate_pct": win_rate,
            "avg_win_amount": round(avg_win, 2),
            "avg_loss_amount": round(avg_loss, 2),
            "payoff_ratio": payoff_ratio,
            "expectancy": round(sum(e.pnl_amount for e in self.entries) / n, 2),  # 平均每筆淨損益（元）
            "sold_too_early_ratio_pct": round(len(early_exits) / len(wins) * 100, 1) if wins else 0.0,
            "early_exits_count": len(early_exits),
            "early_exits_detail": early_exits
        }

    def detect_behavioral_biases(self) -> List[Dict[str, Any]]:
        """
        行為偏誤映射：
        1. 處置效應 (Disposition Effect)：平均獲利 < 3% 且平均虧損 > 8%，或單筆虧損抱超過 10 天死抱凹單
        2. 報復性交易 (Revenge Trading)：在虧損後下一筆交易部位 (shares) 暴增 >= 2 倍
        """
        biases = []

        # 1. 檢驗處置效應
        disposition_trades = []
        for e in self.entries:
            # 虧損超過 10% 仍死抱凹單
            if e.pnl_pct <= -10.0 and (e.holding_days >= 5 or e.emotion_score >= 8):
                disposition_trades.append(e.trade_id)

        if disposition_trades:
            biases.append({
                "bias_name": "處置效應 (Disposition Effect)",
                "evidence_trade_ids": disposition_trades,
                "description": f"檢測到在交易 {', '.join(disposition_trades)} 中出現嚴重凹單行為：虧損超過 10% 仍抱單不願停損，導致少數幾筆大虧吃掉多筆獲利。"
            })

        # 2. 檢驗報復性交易 (連虧後下一筆部位放大)
        revenge_trades = []
        for i in range(1, len(self.entries)):
            prev = self.entries[i - 1]
            curr = self.entries[i]
            if prev.pnl_amount < 0 and curr.shares >= prev.shares * 2:
                revenge_trades.append(curr.trade_id)

        if revenge_trades:
            biases.append({
                "bias_name": "報復性翻倍交易 (Revenge Trading)",
                "evidence_trade_ids": revenge_trades,
                "description": f"檢測到在交易 {', '.join(revenge_trades)} 中出現情緒化失控行為：在前一筆停損後，下一筆下單股數直接翻倍放大，大幅增加穿價斷頭風險。"
            })

        return biases

    def formulate_personalized_rules(self, biases: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        根據行為偏誤診斷結果，制定 3 條可執行的具體量化規則 (非空泛心態口號)。
        """
        rules = [
            {
                "rule_number": 1,
                "rule_name": "強制單筆硬停損線",
                "condition": "單筆持倉未實現虧損達 5.0% 時",
                "action": "無條件以市價 IOC 停損出場，嚴禁取消停損單或盤中改單。",
                "target_bias": "處置效應 (凹單)"
            },
            {
                "rule_number": 2,
                "rule_name": "連虧冷靜期與部位鎖定",
                "condition": "若當日或連續 2 筆交易觸發停損",
                "action": "當日強制停止開新倉；次日單筆委託股數嚴格降為標準部位的 50%，禁止翻倍加碼。",
                "target_bias": "報復性交易"
            },
            {
                "rule_number": 3,
                "rule_name": "移動鎖利防賣飛鐵律",
                "condition": "當帳面獲利突破 +3.0% 時",
                "action": "僅允許平倉 50% 部位，剩餘 50% 強制以 10MA 或前日低點作為移動停利基準，不得手動急躁出清。",
                "target_bias": "過早賣飛 (抱不住贏家)"
            }
        ]
        return rules
