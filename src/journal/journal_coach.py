"""
模組 5：交易日誌分析師核心模組 (journal_coach.py)
核心功能：
1. 20 筆實盤交易紀錄解析與量化統計
2. 自動計算賺賠比 (Payoff Ratio) 與連虧後部位放大率
3. 出場後 5 日表現追蹤，標記「過早賣飛 (續漲 > 5%)」
4. 植入式壞習慣偵測：處置效應 (賺小賠大) 與報復性翻倍交易，精確綁定交易編號 (#08, #12)
5. 制定 3 條具體量化個人化交易守則
"""

from typing import List, Dict, Any
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

    @staticmethod
    def _clamp(v: float, lo: float, hi: float) -> float:
        return max(lo, min(hi, v))

    def _losing_streak(self) -> int:
        best = cur = 0
        for e in self.entries:
            cur = cur + 1 if e.pnl_amount < 0 else 0
            best = max(best, cur)
        return best

    def _max_size_jump_after_loss(self) -> Dict[str, Any]:
        """虧損後下一筆股數放大最多的倍數與交易編號。"""
        best = {"ratio": 0.0, "trade_id": None}
        for prev, curr in zip(self.entries, self.entries[1:]):
            if prev.pnl_amount < 0 and prev.shares > 0:
                r = curr.shares / prev.shares
                if r > best["ratio"]:
                    best = {"ratio": round(r, 2), "trade_id": curr.trade_id}
        return best

    def formulate_personalized_rules(self, biases: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        依你的交易紀錄計算門檻，制定 3 條可執行的量化規則（不是寫死的數字）。每條附 formula 說明怎麼算出來的：
        1. 停損線＝你的平均獲利幅度（讓平均虧損不大於平均獲利），限制在 2%～8%；並估算過去照這條停損可少虧多少
        2. 連虧冷靜期＝依你最長連虧筆數（至少 2 筆、最多 3 筆）；停損後下一筆股數上限＝前一筆的 1 倍
        3. 鎖利：有賣飛紀錄時，用你賣出時的平均獲利與出場後平均續漲幅度決定「先賣一半」與移動停利回落幅度；
           沒有賣飛紀錄時，要求進場前目標獲利至少是停損的 1.5 倍
        資料不足（沒有獲利或虧損紀錄）時用保守預設值，並在 formula 註明。
        """
        wins = [e for e in self.entries if e.pnl_amount > 0]
        losses = [e for e in self.entries if e.pnl_amount < 0]
        avg_win_pct = sum(e.pnl_pct for e in wins) / len(wins) if wins else None
        avg_loss_pct = sum(abs(e.pnl_pct) for e in losses) / len(losses) if losses else None

        # 1. 停損線
        if avg_win_pct is not None:
            stop = round(self._clamp(avg_win_pct, 2.0, 8.0), 1)
            stop_formula = (f"你的平均獲利 {avg_win_pct:.1f}%（{len(wins)} 筆）→ 停損設在同樣幅度，"
                            f"讓平均虧損不大於平均獲利（限制在 2%～8%）")
        else:
            stop = 5.0
            stop_formula = "還沒有獲利交易可參考，先用常見的 5%"
        deep = [e for e in losses if abs(e.pnl_pct) > stop]
        saved = sum(abs(e.pnl_amount) * (1 - stop / abs(e.pnl_pct)) for e in deep)
        stop_evidence = (f"過去 {len(deep)} 筆虧損超過 {stop}%（{', '.join(e.trade_id for e in deep)}），"
                         f"照這條停損約可少虧 {saved:,.0f} 元" if deep else
                         f"目前虧損都在 {stop}% 以內" if losses else "目前沒有虧損交易")
        if avg_loss_pct is not None:
            stop_evidence += f"；你的平均虧損是 {avg_loss_pct:.1f}%"

        # 2. 連虧冷靜期與部位上限
        streak = self._losing_streak()
        n_cool = int(self._clamp(streak, 2, 3))
        jump = self._max_size_jump_after_loss()
        cool_evidence = f"你最長連續虧損 {streak} 筆"
        if jump["trade_id"] and jump["ratio"] > 1:
            cool_evidence += f"；虧損後下一筆股數最多放大到 {jump['ratio']:g} 倍（{jump['trade_id']}）"

        # 3. 鎖利
        early = []
        for e in wins:
            if e.post_exit_5d_high > 0 and e.exit_price > 0:
                rally = (e.post_exit_5d_high - e.exit_price) / e.exit_price * 100
                if rally >= 5.0:
                    early.append((e, rally))
        if early:
            sold = sum(e.pnl_pct for e, _ in early) / len(early)
            rally = sum(r for _, r in early) / len(early)
            half_at = round(self._clamp(sold, 1.0, 15.0), 1)
            trail = round(self._clamp(rally / 2, 3.0, 10.0), 1)
            rule3 = {
                "rule_name": "先賣一半、剩下移動停利",
                "condition": f"單筆帳面獲利達 +{half_at}% 時",
                "action": f"只賣出一半，另一半改用移動停利：從持有期間最高價回落 {trail}% 才出場，不再一次全部賣掉。",
                "target_bias": "過早賣飛（抱不住贏家）",
                "formula": (f"你賣飛的 {len(early)} 筆平均在 +{sold:.1f}% 賣出、之後 5 天平均又漲 {rally:.1f}% → "
                            f"在 +{half_at}% 先賣一半，移動停利取續漲幅度的一半 {trail}%（限制 3%～10%）"),
                "evidence": "、".join(e.trade_id for e, _ in early),
            }
        else:
            target = round(stop * 1.5, 1)
            rule3 = {
                "rule_name": "進場前先確認賺賠比",
                "condition": f"進場前預估的目標獲利不到 +{target}%（停損 {stop}% 的 1.5 倍）時",
                "action": "不進場；目標價至少要是停損距離的 1.5 倍才下單。",
                "target_bias": "賺小賠大",
                "formula": f"沒有賣飛紀錄 → 改要求賺賠比至少 1.5：停損 {stop}% × 1.5 = {target}%",
                "evidence": f"目前賺賠比（平均獲利金額 ÷ 平均虧損金額）{self.compute_statistics().get('payoff_ratio')}",
            }

        rules = [
            {
                "rule_name": "依你的平均獲利設定硬停損",
                "condition": f"單筆持倉未實現虧損達 {stop}% 時",
                "action": "無條件以市價停損出場，嚴禁取消停損單或盤中改單。",
                "target_bias": "處置效應（凹單）",
                "formula": stop_formula,
                "evidence": stop_evidence,
            },
            {
                "rule_name": "連虧冷靜期與部位上限",
                "condition": f"連續 {n_cool} 筆交易停損出場時",
                "action": "當天停止開新倉；下一筆的股數不得超過上一筆（停損後絕不加碼翻倍），最好降為一半。",
                "target_bias": "報復性交易",
                "formula": f"你最長連虧 {streak} 筆 → 冷靜期門檻取 {n_cool} 筆（限制 2～3 筆）",
                "evidence": cool_evidence,
            },
            rule3,
        ]
        for k, r in enumerate(rules, start=1):
            r["rule_number"] = k
        return rules
