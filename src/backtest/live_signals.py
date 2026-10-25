"""
今日訊號 (live_signals.py)
把「自選股 × 一支策略（含部位、停損停利、大盤濾網設定）」跑到最新一根日 K，判斷每檔現在的狀態：
- buy：最新一根收盤出現買訊 → 下一個交易日開盤買進
- sell：持有中且最新一根出現賣訊 → 下一個交易日開盤賣出
- stopped：最新一根盤中觸發停損／移動停利（已出場）
- hold：策略持有中、沒有賣訊（附進場日、進場價、帳面損益、目前停損價）
- blocked：最新一根有買訊但被大盤濾網擋下
- wait：沒有訊號、也沒有持有
狀態跟回測用同一個引擎，所以「持有中」是策略自己的模擬部位，不是你的真實持股。
盤中執行時最新一根是盤中 K 棒，收盤前訊號可能消失或改變，會標 provisional。
"""

from datetime import datetime
from typing import Any, Dict, List, Optional

from src.backtest import strategies
from src.backtest.backtest_engine import BacktestEngine
from src.market import markets, tz
from src.market.bar import Bar

STATUS_LABEL = {
    "buy": "買進",
    "sell": "賣出",
    "stopped": "今日停損／停利出場",
    "hold": "持有中",
    "blocked": "被大盤濾網擋下",
    "wait": "觀望",
}
STATUS_ORDER = ("buy", "sell", "stopped", "blocked", "hold", "wait")


def is_provisional(market: str, last_date: str, now: Optional[datetime] = None) -> bool:
    """最新一根是「今天」且還沒收盤＝盤中 K 棒，訊號尚未確定。"""
    info = markets.info(market)
    local = now.astimezone(tz.zone(info["tz"])) if now else datetime.now(tz.zone(info["tz"]))
    if last_date != local.strftime("%Y-%m-%d"):
        return False
    close = info["sessions"][-1][1]
    return local.strftime("%H:%M") < close


def evaluate(bars: List[Bar], market: str, strategy: str, params: Dict[str, Any],
             engine_kw: Optional[Dict[str, Any]] = None, allowed: Optional[List[bool]] = None,
             commission_discount: float = 0.6, now: Optional[datetime] = None) -> Dict[str, Any]:
    if len(bars) < 2:
        raise ValueError("日 K 不足 2 根")
    sig = strategies.signals(strategy, bars, params)
    r = BacktestEngine(market=market, commission_discount=commission_discount, **(engine_kw or {})).run(
        bars, sig, allowed)
    last = bars[-1]
    op = r["open_position"]
    trades = r["trades_detail"]
    today_exit = trades[-1] if trades and trades[-1]["exit_date"] == last.timestamp else None
    blocked_today = allowed is not None and not allowed[-1]

    if sig[-1] == -1 and op:
        status = "sell"
    elif today_exit and today_exit["exit_reason"] != "訊號":
        status = "stopped"
    elif sig[-1] == 1 and not op:
        status = "blocked" if blocked_today else "buy"
    elif op:
        status = "hold"
    else:
        status = "wait"

    row: Dict[str, Any] = {
        "status": status,
        "status_label": STATUS_LABEL[status],
        "last_date": last.timestamp,
        "close": last.close,
        "provisional": is_provisional(market, last.timestamp, now),
        "signal_today": sig[-1],
        "market_ok": None if allowed is None else bool(allowed[-1]),
    }
    if op:
        row["position"] = {k: op[k] for k in ("entry_date", "entry_price", "unrealized_pct")}
        stop = engine_kw or {}
        levels = []
        if stop.get("stop_loss_pct"):
            levels.append(op["entry_price"] * (1 - stop["stop_loss_pct"] / 100))
        if stop.get("trailing_pct"):
            seg = [b.high for b in bars if b.timestamp >= op["entry_date"]]
            levels.append(max([op["entry_price"], *seg]) * (1 - stop["trailing_pct"] / 100))
        if levels:
            row["position"]["stop_price"] = round(max(levels), 2)
    if today_exit:
        row["exit_today"] = {k: today_exit[k] for k in ("exit_price", "exit_reason", "return_pct")}
    return row


def summarize(rows: List[Dict[str, Any]]) -> Dict[str, int]:
    out = {k: 0 for k in STATUS_ORDER}
    out["error"] = 0
    for r in rows:
        out[r.get("status", "error") if not r.get("error") else "error"] += 1
    return out
