"""
交易策略回測分析引擎 (backtest_engine.py)
核心標準：
1. 防偷看未來數據 (Zero Look-Ahead Bias): 當日訊號成立，強制以下一根 K 棒開盤價 (Next Bar Open) 成交
2. 四大核心指標計算: 勝率、獲利因子 (Profit Factor)、最大回撤 (MDD)、交易次數與平均報酬
3. 真實摩擦成本扣除 (台股 0.1425% 手續費與 0.3% 證交稅 / 美股規費)
4. 樣本數 < 30 筆過度擬合警告
5. 提取前 5 大虧損交易背景
"""

from typing import List, Dict, Any, Optional
from dataclasses import dataclass
from src.market.bar import Bar
from src.market.market_rules import calculate_friction_cost
from src.market.trade_rules import FIXED_LOT

@dataclass
class Trade:
    trade_id: int
    signal_date: str
    entry_date: str
    entry_price: float
    exit_date: str
    exit_price: float
    shares: int
    gross_pnl: float
    net_pnl: float
    return_pct: float
    holding_bars: int
    entry_cost: float
    exit_cost: float

class BacktestEngine:
    def __init__(self, market: str = "TW", initial_capital: float = 1_000_000.0, commission_discount: float = 1.0,
                 lot_size: Optional[int] = None, fees: Optional[List[Dict[str, Any]]] = None):
        self.market = market
        self.initial_capital = initial_capital
        self.commission_discount = commission_discount
        # 每手股數：港股由呼叫端依個股傳入；日、陸、星股全市場 100 股
        self.lot_size = lot_size or FIXED_LOT.get(market.upper(), 1)
        self.fees = fees

    def run(self, bars: List[Bar], signals: List[int]) -> Dict[str, Any]:
        """
        執行回測。
        signals: 長度與 bars 相同的整數陣列。
          1: 買進信號
         -1: 賣出信號
          0: 無信號

        注意：當 index i 產生信號時，必須在 index i + 1 的 open 價進行撮合成交。
        """
        if len(bars) != len(signals):
            raise ValueError("Bars and signals must have the same length")

        trades: List[Trade] = []
        in_position = False
        entry_idx = -1
        signal_idx = -1
        current_trade_id = 1
        equity = self.initial_capital
        shares = 0
        skipped_no_cash = 0

        # 逐日回測迴圈
        for i in range(len(bars)):
            # 1. 檢查是否需要執行前一日產生的信號 (Next Bar Open 撮合)
            if i > 0 and signals[i - 1] != 0:
                prev_sig = signals[i - 1]
                
                # 買進執行：依「當下資金」決定股數（之前的損益滾入下一筆）
                if prev_sig == 1 and not in_position:
                    shares = self._position_size(bars[i].open, equity)
                    if shares <= 0:
                        skipped_no_cash += 1  # 資金連 1 股都買不起：這筆訊號不成交
                        continue
                    in_position = True
                    entry_idx = i
                    signal_idx = i - 1
                
                # 賣出執行
                elif prev_sig == -1 and in_position:
                    in_position = False
                    exit_idx = i
                    
                    entry_bar = bars[entry_idx]
                    exit_bar = bars[exit_idx]
                    
                    # 以當根 Open 成交
                    entry_price = entry_bar.open
                    exit_price = exit_bar.open
                    
                    min_fee = self._min_fee(shares)
                    entry_costs = calculate_friction_cost(
                        self.market, "BUY", entry_price, shares, self.commission_discount, min_fee, self.fees
                    )
                    exit_costs = calculate_friction_cost(
                        self.market, "SELL", exit_price, shares, self.commission_discount, min_fee, self.fees
                    )
                    
                    gross_pnl = (exit_price - entry_price) * shares
                    net_pnl = gross_pnl - entry_costs["total_cost"] - exit_costs["total_cost"]
                    return_pct = round((net_pnl / (entry_price * shares)) * 100, 2)
                    
                    trade = Trade(
                        trade_id=current_trade_id,
                        signal_date=bars[signal_idx].timestamp,
                        entry_date=entry_bar.timestamp,
                        entry_price=entry_price,
                        exit_date=exit_bar.timestamp,
                        exit_price=exit_price,
                        shares=shares,
                        gross_pnl=round(gross_pnl, 2),
                        net_pnl=round(net_pnl, 2),
                        return_pct=return_pct,
                        holding_bars=exit_idx - entry_idx,
                        entry_cost=entry_costs["total_cost"],
                        exit_cost=exit_costs["total_cost"]
                    )
                    trades.append(trade)
                    current_trade_id += 1
                    equity += net_pnl

        # 計算績效指標
        res = self._calculate_metrics(trades)
        res["position_sizing"] = (
            "每筆用當下全部資金買進（含前面交易的損益）；台股買得起整張就買整張，不足一張改買零股；其他市場以 1 股為單位"
        )
        res["initial_capital"] = self.initial_capital
        res["final_equity"] = round(equity, 2)
        res["skipped_no_cash"] = skipped_no_cash
        return res

    @staticmethod
    def _min_fee(shares: int) -> float:
        """台股手續費最低：整張 20 元、零股 1 元（多數券商的零股低消）。"""
        return 20.0 if shares >= 1000 else 1.0

    def _position_size(self, price: float, cash: float) -> int:
        """資金 cash 在價格 price 最多買幾股（含買進手續費不超過資金）。台股優先整張，不足一張改零股。"""
        if price <= 0 or cash <= 0:
            return 0
        tw = self.market.upper() == "TW"

        def affordable(n: int) -> bool:
            cost = calculate_friction_cost(self.market, "BUY", price, n, self.commission_discount,
                                           self._min_fee(n), self.fees)["total_cost"]
            return price * n + cost <= cash

        n = int(cash // price)
        while n > 0 and not affordable(n):  # 扣掉手續費後再往下調（通常只差幾股）
            n -= 1
        if tw and n >= 1000:
            n = n // 1000 * 1000  # 買得起整張：只買整張
        elif not tw:
            n = n // self.lot_size * self.lot_size  # 其他市場只能整手買
        return n

    def _calculate_metrics(self, trades: List[Trade]) -> Dict[str, Any]:
        total_trades = len(trades)
        if total_trades == 0:
            return {
                "total_trades": 0,
                "win_rate": 0.0,
                "profit_factor": 0.0,
                "max_drawdown": 0.0,
                "avg_return": 0.0,
                "avg_win_pct": 0.0,
                "avg_loss_pct": 0.0,
                "payoff_ratio": None,
                "total_net_pnl": 0.0,
                "sample_size_warning": True,
                "trades": [],
                "worst_5_trades": []
            }

        winning_trades = [t for t in trades if t.net_pnl > 0]
        losing_trades = [t for t in trades if t.net_pnl < 0]

        win_rate = round((len(winning_trades) / total_trades) * 100, 2)
        total_profit = sum(t.net_pnl for t in winning_trades)
        total_loss = abs(sum(t.net_pnl for t in losing_trades))

        if total_loss == 0:
            profit_factor = 999.0 if total_profit > 0 else 0.0
        else:
            profit_factor = round(total_profit / total_loss, 2)

        total_net_pnl = sum(t.net_pnl for t in trades)
        avg_return = round(sum(t.return_pct for t in trades) / total_trades, 2)
        # 平均獲利／平均虧損分開算（賺賠比＝兩者相除），勝率低的策略靠這個才看得出能不能賺
        avg_win_pct = round(sum(t.return_pct for t in winning_trades) / len(winning_trades), 2) if winning_trades else 0.0
        avg_loss_pct = round(sum(t.return_pct for t in losing_trades) / len(losing_trades), 2) if losing_trades else 0.0
        payoff_ratio = round(avg_win_pct / abs(avg_loss_pct), 2) if avg_loss_pct else None

        # 計算權益曲線與最大回撤 (MDD)
        equity = self.initial_capital
        peak = equity
        max_dd = 0.0

        for t in trades:
            equity += t.net_pnl
            if equity > peak:
                peak = equity
            dd = (peak - equity) / peak if peak > 0 else 0.0
            if dd > max_dd:
                max_dd = dd

        # 找出虧損最大的前 5 筆
        sorted_by_loss = sorted(trades, key=lambda t: t.net_pnl)
        worst_5 = [
            {
                "trade_id": t.trade_id,
                "entry_date": t.entry_date,
                "exit_date": t.exit_date,
                "net_pnl": t.net_pnl,
                "return_pct": f"{t.return_pct}%",
                "holding_bars": t.holding_bars
            }
            for t in sorted_by_loss if t.net_pnl < 0
        ][:5]

        return {
            "total_trades": total_trades,
            "win_rate": f"{win_rate}%",
            "profit_factor": profit_factor,
            "max_drawdown": f"{round(max_dd * 100, 2)}%",
            "avg_return": f"{avg_return}%",
            "avg_win_pct": avg_win_pct,
            "avg_loss_pct": avg_loss_pct,
            "payoff_ratio": payoff_ratio,
            "winning_trades": len(winning_trades),
            "losing_trades": len(losing_trades),
            "total_net_pnl": round(total_net_pnl, 2),
            "sample_size_warning": total_trades < 30,
            "sample_size_note": "交易次數 < 30 筆，統計顯著性不足，請注意過度擬合 (Overfitting) 風險！" if total_trades < 30 else "樣本數充足 (>=30)",
            "worst_5_trades": worst_5,
            "trades_detail": [
                {
                    "trade_id": t.trade_id,
                    "entry_date": t.entry_date,
                    "entry_price": t.entry_price,
                    "exit_date": t.exit_date,
                    "exit_price": t.exit_price,
                    "net_pnl": t.net_pnl,
                    "return_pct": t.return_pct
                }
                for t in trades
            ]
        }
