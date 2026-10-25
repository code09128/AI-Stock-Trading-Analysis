"""
交易策略回測分析引擎 (backtest_engine.py)
核心標準：
1. 防偷看未來數據 (Zero Look-Ahead Bias): 當日訊號成立，強制以下一根 K 棒開盤價 (Next Bar Open) 成交
2. 四大核心指標計算: 勝率、獲利因子 (Profit Factor)、最大回撤 (MDD)、交易次數與平均報酬
3. 真實摩擦成本扣除 (台股 0.1425% 手續費與 0.3% 證交稅 / 美股規費)
4. 樣本數 < 30 筆過度擬合警告
5. 提取前 5 大虧損交易背景
6. 最大回撤用「每天收盤市值」計算（含持有中的未實現損益），不是只看已平倉交易
7. 部位模型：資金比例、固定金額、ATR 風險定額；出場風控：固定停損、移動停利（盤中觸價成交）
8. 進場濾網（例如大盤在季線下不開新倉）與成交量 0 視同暫停交易
"""

import math
from typing import List, Dict, Any, Optional
from dataclasses import dataclass
from src.market.bar import Bar
from src.market.market_rules import calculate_friction_cost
from src.market.trade_rules import FIXED_LOT
from src.technical.indicators import calculate_atr

SIZING_MODES = {
    "percent": "資金比例",
    "fixed": "固定金額",
    "atr_risk": "ATR 風險定額",
}
DAILY_POINTS = 500  # 逐日淨值曲線最多回傳幾個點給前端


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
    exit_reason: str = "訊號"


class BacktestEngine:
    def __init__(self, market: str = "TW", initial_capital: float = 1_000_000.0, commission_discount: float = 1.0,
                 lot_size: Optional[int] = None, fees: Optional[List[Dict[str, Any]]] = None,
                 sizing: Optional[Dict[str, Any]] = None, stop_loss_pct: float = 0.0, trailing_pct: float = 0.0):
        self.market = market
        self.initial_capital = initial_capital
        self.commission_discount = commission_discount
        # 每手股數：港股由呼叫端依個股傳入；日、陸、星股全市場 100 股
        self.lot_size = lot_size or FIXED_LOT.get(market.upper(), 1)
        self.fees = fees
        # 部位模型：percent＝每筆用當下資金的 value%；fixed＝每筆固定 value 元；
        # atr_risk＝每筆最多賠當下資金的 value%（停損距離＝ATR × atr_mult）
        self.sizing = {"mode": "percent", "value": 100.0, "atr_mult": 2.0, **(sizing or {})}
        self.stop_loss_pct = stop_loss_pct or 0.0
        self.trailing_pct = trailing_pct or 0.0

    def run(self, bars: List[Bar], signals: List[int], entry_allowed: Optional[List[bool]] = None) -> Dict[str, Any]:
        """
        執行回測。
        signals: 長度與 bars 相同的整數陣列。
          1: 買進信號
         -1: 賣出信號
          0: 無信號
        entry_allowed: 可省略；長度與 bars 相同，False 的那天出現的買訊不進場（例如大盤在季線下）。

        注意：當 index i 產生信號時，必須在 index i + 1 的 open 價進行撮合成交。
        停損與移動停利是事先掛好的觸價單：當天最低價碰到就以停損價成交，開盤就跳空跌破則以開盤價成交。
        """
        if len(bars) != len(signals):
            raise ValueError("Bars and signals must have the same length")
        if entry_allowed is not None and len(entry_allowed) != len(bars):
            raise ValueError("entry_allowed must have the same length as bars")

        self._trades: List[Trade] = []
        self._equity = self.initial_capital
        in_position = False
        entry_idx = signal_idx = -1
        entry_price = peak = 0.0
        shares = 0
        pending, pending_idx = 0, -1
        skipped_no_cash = skipped_no_atr = 0
        blocked: List[str] = []
        suspended_days = ignored_suspended = 0
        daily: List[Dict[str, Any]] = []

        # 成交量 0 的日子視同暫停交易；整份資料幾乎都沒有成交量（例如部分指數）就不套用
        check_volume = sum(1 for b in bars if b.volume > 0) >= len(bars) * 0.5
        atr: List[Optional[float]] = [None] * len(bars)
        if self.sizing["mode"] == "atr_risk" and bars:
            atr = calculate_atr([b.high for b in bars], [b.low for b in bars], [b.close for b in bars], 14)

        for i, bar in enumerate(bars):
            # 1. 前一天收盤確認的訊號 → 今天開盤執行；暫停交易日不成交，訊號留到下一個能交易的日子
            if i > 0 and signals[i - 1] != 0:
                if check_volume and bars[i - 1].volume <= 0:
                    ignored_suspended += 1  # 成交量 0 那天算出來的訊號不可信，不採用
                else:
                    pending, pending_idx = signals[i - 1], i - 1
            # 最後一根常是 Yahoo 還沒補上成交量的最新一天（開高低收相同、量 0），不算暫停交易
            suspended = check_volume and bar.volume <= 0 and i < len(bars) - 1
            if suspended:
                suspended_days += 1
            elif pending:
                if pending == 1 and not in_position:
                    if entry_allowed is not None and not entry_allowed[pending_idx]:
                        blocked.append(bars[pending_idx].timestamp)
                    else:
                        n = self._order_size(bar.open, self._equity, atr[pending_idx])
                        if n is None:
                            skipped_no_atr += 1
                        elif n <= 0:
                            skipped_no_cash += 1  # 資金連 1 股（1 手）都買不起：這筆訊號不成交
                        else:
                            in_position, shares = True, n
                            entry_idx, signal_idx = i, pending_idx
                            entry_price = peak = bar.open
                elif pending == -1 and in_position:
                    self._close(bars, entry_idx, signal_idx, i, bar.open, shares, "訊號")
                    in_position = False
                pending = 0

            # 2. 盤中停損／移動停利（進場當天也會檢查）
            if in_position and not suspended:
                stops = []
                if self.stop_loss_pct > 0:
                    stops.append((entry_price * (1 - self.stop_loss_pct / 100), "停損"))
                if self.trailing_pct > 0:
                    stops.append((peak * (1 - self.trailing_pct / 100), "移動停利"))
                if stops:
                    level, reason = max(stops)
                    if bar.low <= level:
                        fill = min(bar.open, level) if i > entry_idx else level
                        if reason == "移動停利" and fill < entry_price:
                            reason = "移動停損"  # 從高點回落、但已跌破進場價：實際上是賠錢出場
                        self._close(bars, entry_idx, signal_idx, i, round(fill, 4), shares, reason)
                        in_position = False
                if in_position:
                    peak = max(peak, bar.high)  # 今天的高點從明天起才拿來算移動停利，避免同一天先高後低的假設

            # 3. 每天收盤市值（未實現損益不扣手續費，期末未平倉另外列出）
            mtm = self._equity + ((bar.close - entry_price) * shares if in_position else 0.0)
            daily.append({"date": bar.timestamp, "equity": round(mtm, 2)})

        # 計算績效指標
        res = self._calculate_metrics(self._trades)
        dd = self._drawdown(daily)
        res["max_drawdown"] = f"{dd['max_dd_pct']}%"
        res["max_drawdown_detail"] = dd
        res["daily_equity"] = self._sample(daily, dd)
        res["position_sizing"] = self._sizing_text()
        res["sizing_mode"] = self.sizing["mode"]
        res["risk_rules"] = {
            "stop_loss_pct": self.stop_loss_pct,
            "trailing_pct": self.trailing_pct,
        }
        exit_counts: Dict[str, int] = {}
        for t in self._trades:
            exit_counts[t.exit_reason] = exit_counts.get(t.exit_reason, 0) + 1
        res["exit_reasons"] = exit_counts
        res["initial_capital"] = self.initial_capital
        res["final_equity"] = round(self._equity, 2)
        res["skipped_no_cash"] = skipped_no_cash
        res["skipped_no_atr"] = skipped_no_atr
        res["blocked_by_filter"] = len(blocked)
        res["blocked_dates"] = blocked[-30:]
        res["suspended_days"] = suspended_days
        res["ignored_suspended_signals"] = ignored_suspended
        res["open_position"] = None
        if in_position and bars:
            last = bars[-1]
            res["open_position"] = {
                "entry_date": bars[entry_idx].timestamp,
                "entry_price": entry_price,
                "shares": shares,
                "last_date": last.timestamp,
                "last_close": last.close,
                "unrealized_pnl": round((last.close - entry_price) * shares, 2),
                "unrealized_pct": round((last.close / entry_price - 1) * 100, 2) if entry_price else 0.0,
            }
        return res

    def _close(self, bars: List[Bar], entry_idx: int, signal_idx: int, exit_idx: int, exit_price: float,
               shares: int, reason: str) -> None:
        entry_bar, exit_bar = bars[entry_idx], bars[exit_idx]
        entry_price = entry_bar.open
        min_fee = self._min_fee(shares)
        entry_costs = calculate_friction_cost(
            self.market, "BUY", entry_price, shares, self.commission_discount, min_fee, self.fees
        )
        exit_costs = calculate_friction_cost(
            self.market, "SELL", exit_price, shares, self.commission_discount, min_fee, self.fees
        )
        gross_pnl = (exit_price - entry_price) * shares
        net_pnl = gross_pnl - entry_costs["total_cost"] - exit_costs["total_cost"]
        self._trades.append(Trade(
            trade_id=len(self._trades) + 1,
            signal_date=bars[signal_idx].timestamp,
            entry_date=entry_bar.timestamp,
            entry_price=entry_price,
            exit_date=exit_bar.timestamp,
            exit_price=exit_price,
            shares=shares,
            gross_pnl=round(gross_pnl, 2),
            net_pnl=round(net_pnl, 2),
            return_pct=round((net_pnl / (entry_price * shares)) * 100, 2),
            holding_bars=exit_idx - entry_idx,
            entry_cost=entry_costs["total_cost"],
            exit_cost=exit_costs["total_cost"],
            exit_reason=reason,
        ))
        self._equity += net_pnl

    @staticmethod
    def _min_fee(shares: int) -> float:
        """台股手續費最低：整張 20 元、零股 1 元（多數券商的零股低消）。"""
        return 20.0 if shares >= 1000 else 1.0

    def _round_lot(self, n: int) -> int:
        """台股買得起整張就只買整張，不足一張改零股；其他市場只能整手買。"""
        if self.market.upper() == "TW":
            return n // 1000 * 1000 if n >= 1000 else n
        return n // self.lot_size * self.lot_size

    def _position_size(self, price: float, cash: float) -> int:
        """資金 cash 在價格 price 最多買幾股（含買進手續費不超過資金）。台股優先整張，不足一張改零股。"""
        if price <= 0 or cash <= 0:
            return 0

        def affordable(n: int) -> bool:
            cost = calculate_friction_cost(self.market, "BUY", price, n, self.commission_discount,
                                           self._min_fee(n), self.fees)["total_cost"]
            return price * n + cost <= cash

        n = int(cash // price)
        while n > 0 and not affordable(n):  # 扣掉手續費後再往下調（通常只差幾股）
            n -= 1
        return self._round_lot(n)

    def _order_size(self, price: float, equity: float, atr: Optional[float]) -> Optional[int]:
        """依部位模型決定這筆買幾股；ATR 模型在 ATR 還算不出來時回 None。"""
        mode, value = self.sizing["mode"], float(self.sizing["value"])
        if mode == "fixed":
            return self._position_size(price, min(value, equity))
        if mode == "atr_risk":
            if not atr:
                return None
            per_share = atr * float(self.sizing["atr_mult"])
            by_risk = int(equity * value / 100 / per_share) if per_share > 0 else 0
            return self._round_lot(min(by_risk, self._position_size(price, equity)))
        return self._position_size(price, equity * min(value, 100.0) / 100)

    def _sizing_text(self) -> str:
        mode, v = self.sizing["mode"], self.sizing["value"]
        lot = "台股買得起整張就買整張，不足一張改買零股；港、日、陸、星股以每手股數為單位，其他市場以 1 股為單位"
        if mode == "fixed":
            return f"每筆固定投入 {v:,.0f}（資金不足時用剩下的全部）；{lot}"
        if mode == "atr_risk":
            return (f"ATR 風險定額：每筆假設跌 {self.sizing['atr_mult']:g} 倍 ATR(14) 時最多賠當下資金的 {v:g}%，"
                    f"波動越大買越少（不超過可用資金）；{lot}")
        return f"每筆用當下資金的 {v:g}%（含前面交易的損益）；{lot}"

    @staticmethod
    def _drawdown(daily: List[Dict[str, Any]]) -> Dict[str, Any]:
        """逐日淨值的最大回撤，以及高點、低點日期。"""
        peak, peak_date = -math.inf, ""
        best = {"max_dd_pct": 0.0, "peak_date": "", "trough_date": "", "trough_idx": -1}
        for i, d in enumerate(daily):
            if d["equity"] > peak:
                peak, peak_date = d["equity"], d["date"]
            dd = (peak - d["equity"]) / peak * 100 if peak > 0 else 0.0
            if dd > best["max_dd_pct"]:
                best = {"max_dd_pct": round(dd, 2), "peak_date": peak_date, "trough_date": d["date"], "trough_idx": i}
        return best

    @staticmethod
    def _sample(daily: List[Dict[str, Any]], dd: Dict[str, Any]) -> List[Dict[str, Any]]:
        """抽樣成最多 DAILY_POINTS 點；最大回撤的低點一定保留，曲線才看得到最痛的那天。"""
        if len(daily) <= DAILY_POINTS:
            return daily
        step = math.ceil(len(daily) / DAILY_POINTS)
        keep = set(range(0, len(daily), step)) | {len(daily) - 1}
        if dd["trough_idx"] >= 0:
            keep.add(dd["trough_idx"])
        return [daily[i] for i in sorted(keep)]

    def _calculate_metrics(self, trades: List[Trade]) -> Dict[str, Any]:
        total_trades = len(trades)
        if total_trades == 0:
            return {
                "total_trades": 0,
                "win_rate": "0.0%",
                "profit_factor": 0.0,
                "max_drawdown": "0.0%",
                "avg_return": "0.0%",
                "avg_win_pct": 0.0,
                "avg_loss_pct": 0.0,
                "payoff_ratio": None,
                "total_net_pnl": 0.0,
                "sample_size_warning": True,
                "sample_size_note": "這段期間沒有完成的交易，無法評估",
                "trades": [],
                "trades_detail": [],
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

        # 找出虧損最大的前 5 筆
        sorted_by_loss = sorted(trades, key=lambda t: t.net_pnl)
        worst_5 = [
            {
                "trade_id": t.trade_id,
                "entry_date": t.entry_date,
                "exit_date": t.exit_date,
                "net_pnl": t.net_pnl,
                "return_pct": f"{t.return_pct}%",
                "holding_bars": t.holding_bars,
                "exit_reason": t.exit_reason,
            }
            for t in sorted_by_loss if t.net_pnl < 0
        ][:5]

        return {
            "total_trades": total_trades,
            "win_rate": f"{win_rate}%",
            "profit_factor": profit_factor,
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
                    "shares": t.shares,
                    "net_pnl": t.net_pnl,
                    "return_pct": t.return_pct,
                    "holding_bars": t.holding_bars,
                    "exit_reason": t.exit_reason,
                }
                for t in trades
            ]
        }
