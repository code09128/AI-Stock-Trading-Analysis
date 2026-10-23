"""
模組 4：投資組合風險管理核心模組 (portfolio_risk.py)
核心功能：
1. 跨幣別 (TWD/USD) 統一折算市值與計算真實權重
2. 相關係數矩陣 (Correlation Matrix) 與投資組合加權 Beta 計算
3. 穿透式 ETF 曝險檢查 (拆解 0050、QQQ 成分並與個股持倉累加)
4. 再平衡方案輸出端權重守恆驗收 (目標加總嚴格 = 100.0%)
5. 大盤下跌 20% 情境壓力測試與微台指 / 反向 ETF 避險試算
"""

from typing import List, Dict, Any, Tuple
import math
import re

class PortfolioRiskManager:
    # 常用 ETF 權重成分預設表 (穿透式拆解用)
    ETF_HOLDINGS_LOOKTHROUGH = {
        "0050": {"2330": 0.54, "2317": 0.06, "2454": 0.05}, # 0050 台積電約佔 54%
        "QQQ": {"NVDA": 0.088, "AAPL": 0.091, "MSFT": 0.082} # QQQ 輝達約佔 8.8%
    }

    def __init__(self, usd_twd_rate: float = 32.2, etf_holdings: Dict[str, Dict[str, float]] = None):
        self.usd_twd_rate = usd_twd_rate
        # 傳入即時取得的成分股權重（0~1）時優先使用，否則退回上方靜態概略表
        self.etf_holdings = {**self.ETF_HOLDINGS_LOOKTHROUGH, **(etf_holdings or {})}

    def calculate_portfolio_weights(self, holdings: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        跨幣別統一折算總市值 (TWD) 並計算真實權重。
        holdings: [{"symbol": "2330", "market": "TW", "shares": 1000, "price": 1050.0}, ...]
        """
        total_value_twd = 0.0
        parsed_items = []

        for h in holdings:
            sym = h["symbol"].upper()
            mkt = h.get("market", "TW").upper()
            shares = h.get("shares", 0)
            price = h.get("price", 0.0)

            # 換算台幣：有 fx_rate（每 1 單位計價幣別＝幾台幣）就用；沒有時沿用舊規則（台股 1、其他以美元匯率）
            rate = h.get("fx_rate")
            if rate is None:
                rate = 1.0 if mkt == "TW" else self.usd_twd_rate
            val_twd = price * shares * rate

            total_value_twd += val_twd
            parsed_items.append({
                "symbol": sym,
                **({"name": h["name"]} if h.get("name") else {}),
                "market": mkt,
                "currency": h.get("currency") or ("TWD" if mkt == "TW" else "USD"),
                "fx_rate": rate,
                "shares": shares,
                "price": price,
                "value_twd": val_twd
            })

        if total_value_twd == 0:
            return {"total_value_twd": 0.0, "holdings": []}

        # 計算權重
        for item in parsed_items:
            item["weight_pct"] = round((item["value_twd"] / total_value_twd) * 100, 2)

        return {
            "total_value_twd": round(total_value_twd, 2),
            "holdings": parsed_items
        }

    OTHER_SUFFIX = " 其他成分股"

    @staticmethod
    def _code(sym: str) -> str:
        """台股代號去掉 .TW／.TWO，美股維持原樣（大寫）。"""
        return re.sub(r"\.(TWO|TW)$", "", str(sym).upper())

    def calculate_lookthrough_exposure(self, holdings_result: Dict[str, Any]) -> Dict[str, float]:
        """
        穿透式曝險：ETF 拆成成分股後與直接持有的個股累加。
        ETF 本身的權重會被拆掉（不重複計算）；沒拆到的部分（前十大以外）列為「<ETF> 其他成分股」。
        回傳依曝險由大到小排序，合計 = 100%（四捨五入誤差除外）。
        """
        direct_weights: Dict[str, float] = {}
        for h in holdings_result.get("holdings", []):
            code = self._code(h["symbol"])
            direct_weights[code] = direct_weights.get(code, 0.0) + h["weight_pct"]

        exposures: Dict[str, float] = {}
        for code, direct_pct in direct_weights.items():
            breakdown = self.etf_holdings.get(code)
            if not breakdown:
                exposures[code] = exposures.get(code, 0.0) + direct_pct
                continue
            covered = 0.0
            for sub, share in breakdown.items():
                sub_code = self._code(sub)
                exposures[sub_code] = exposures.get(sub_code, 0.0) + direct_pct * share
                covered += share
            rest = direct_pct * max(0.0, 1.0 - covered)
            if rest > 0:
                exposures[code + self.OTHER_SUFFIX] = exposures.get(code + self.OTHER_SUFFIX, 0.0) + rest

        return {k: round(v, 2) for k, v in sorted(exposures.items(), key=lambda kv: -kv[1])}

    def calculate_correlation(self, returns_a: List[float], returns_b: List[float]) -> float:
        """
        計算兩數列之皮爾森相關係數 (Pearson Correlation Coefficient)。
        """
        n = min(len(returns_a), len(returns_b))
        if n < 2:
            return 0.0

        a = returns_a[:n]
        b = returns_b[:n]

        mean_a = sum(a) / n
        mean_b = sum(b) / n

        cov = sum((a[i] - mean_a) * (b[i] - mean_b) for i in range(n))
        var_a = sum((a[i] - mean_a) ** 2 for i in range(n))
        var_b = sum((b[i] - mean_b) ** 2 for i in range(n))

        if var_a == 0 or var_b == 0:
            return 0.0

        return round(cov / math.sqrt(var_a * var_b), 3)

    def calculate_portfolio_beta(self, weights: List[float], betas: List[float]) -> float:
        """計算投資組合加權 Beta 值"""
        if len(weights) != len(betas) or len(weights) == 0:
            return 1.0
        weighted_beta = sum(w * b for w, b in zip(weights, betas))
        return round(weighted_beta, 2)

    def simulate_crash_20pct(
        self,
        total_value_twd: float,
        portfolio_beta: float,
        retail_friendly: bool = True
    ) -> Dict[str, Any]:
        """
        模擬大盤下跌 20% 之壓力測試與避險方案。
        受 Beta 放大效應：預估虧損 = 20% * Beta。
        避險建議：若總資產小於 500 萬，建議微台指 (保證金門檻低) 或 00632R 反向 ETF，避免門檻過高之大台指期。
        """
        expected_drawdown_pct = round(20.0 * portfolio_beta, 2)
        potential_loss_twd = round(total_value_twd * (expected_drawdown_pct / 100), 2)

        if total_value_twd < 3_000_000 and retail_friendly:
            hedge_tool = "微台指 (TMF) 放空 或 台灣50反1 (00632R)"
            hedge_rationale = "散戶資金規模適中，大台指期保證金門檻過高易產生保證金不足斷頭風險，採用微台指 (保證金僅大台 1/10) 或反向 ETF 可精確避險。"
        else:
            hedge_tool = "小台指期 (MTX) / SPY Protective Put 選擇權"
            hedge_rationale = "資產規模充足，透過指數期貨放空或價外 Put 選擇權鎖定下檔風險。"

        return {
            "market_drawdown_pct": -20.0,
            "portfolio_beta": portfolio_beta,
            "expected_portfolio_drawdown_pct": -expected_drawdown_pct,
            "potential_loss_twd": potential_loss_twd,
            "suggested_hedge_tool": hedge_tool,
            "rationale": hedge_rationale
        }

    def generate_rebalance_plan(
        self,
        current_holdings: List[Dict[str, Any]],
        target_weights: Dict[str, float]
    ) -> Dict[str, Any]:
        """
        生成再平衡配置方案，嚴格驗收目標權重總和是否等於 100.0%。
        """
        total_target_pct = round(sum(target_weights.values()), 1)
        if total_target_pct != 100.0:
            raise ValueError(f"再平衡目標權重總和必須嚴格等於 100.0%，目前加總為 {total_target_pct}%")

        plan = []
        for sym, target_pct in target_weights.items():
            curr_item = next((h for h in current_holdings if h["symbol"] == sym), None)
            curr_pct = curr_item["weight_pct"] if curr_item else 0.0
            delta_pct = round(target_pct - curr_pct, 2)

            action = "維持"
            if delta_pct > 0:
                action = f"加碼 +{delta_pct}%"
            elif delta_pct < 0:
                action = f"減碼 {delta_pct}%"

            plan.append({
                "symbol": sym,
                "current_weight_pct": curr_pct,
                "target_weight_pct": target_pct,
                "delta_pct": delta_pct,
                "action": action
            })

        return {
            "weight_conservation_passed": True,
            "target_sum_pct": 100.0,
            "rebalance_actions": plan
        }
