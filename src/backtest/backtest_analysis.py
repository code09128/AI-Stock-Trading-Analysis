"""
回測進階診斷 (backtest_analysis.py)
1. 雙均線訊號產生（舊介面，實作在 strategies.py）
2. 市場環境拆分：依「進場當天」大盤收盤 vs 200 日線與 200 日線斜率，把每筆交易分成多頭／空頭／盤整
3. 前後段驗證（Walk-forward）：前 70% 期間挑最佳參數（掃描各策略的 GRID），後 30% 期間驗證，看結果是否只是過度擬合
4. 下一步可測試的規則：每次只加一條、而且要用後段資料驗證
全部只用真實 K 線計算，不呼叫 AI。
"""

from itertools import product
from typing import Any, Dict, List, Optional

from src.market.bar import Bar

from src.backtest import strategies
from src.backtest.backtest_engine import BacktestEngine
from src.technical.indicators import calculate_ma

REGIMES = ("多頭", "盤整", "空頭")
REGIME_RULE = "大盤收盤在 200 日線上、且 200 日線比 20 天前高＝多頭；在線下且 200 日線下彎＝空頭；其他＝盤整"
FAST_GRID = (3, 5, 10, 20)
SLOW_GRID = (20, 30, 60, 120)
TRAIN_RATIO = 0.7


def ma_cross_signals(bars: List[Bar], fast_ma: int, slow_ma: int) -> List[int]:
    """短均線上穿長均線＝買進（1），跌回長均線下方＝賣出（-1）。"""
    return strategies.ma_cross(bars, {"fast_ma": fast_ma, "slow_ma": slow_ma})


def market_filter(bars: List[Bar], index_bars: List[Bar], ma_days: int) -> List[bool]:
    """每個交易日是否允許開新倉：大盤收盤在 N 日均線之上＝允許。
    個股與大盤日期對不上（例如大盤缺一天）時用最近一個大盤交易日；均線還算不出來的日子不擋。"""
    closes = [b.close for b in index_bars]
    ma = calculate_ma(closes, ma_days)
    ok_by_date = {b.timestamp: (ma[i] is None or b.close >= ma[i]) for i, b in enumerate(index_bars)}
    dates = sorted(ok_by_date)
    out, k, last = [], 0, True
    for b in bars:
        while k < len(dates) and dates[k] <= b.timestamp:
            last = ok_by_date[dates[k]]
            k += 1
        out.append(last)
    return out


def regime_by_date(index_bars: List[Bar]) -> Dict[str, str]:
    """每個交易日的大盤環境。前 220 天 200 日線還算不出來，不標示。"""
    closes = [b.close for b in index_bars]
    ma200 = calculate_ma(closes, 200)
    out: Dict[str, str] = {}
    for i, b in enumerate(index_bars):
        if i < 20 or ma200[i] is None or ma200[i - 20] is None:
            continue
        rising = ma200[i] > ma200[i - 20]
        if b.close > ma200[i] and rising:
            out[b.timestamp] = "多頭"
        elif b.close < ma200[i] and not rising:
            out[b.timestamp] = "空頭"
        else:
            out[b.timestamp] = "盤整"
    return out


def _stats(trades: List[Dict[str, Any]]) -> Dict[str, Any]:
    n = len(trades)
    if not n:
        return {"trades": 0}
    wins = [t for t in trades if t["net_pnl"] > 0]
    losses = [t for t in trades if t["net_pnl"] < 0]
    gp = sum(t["net_pnl"] for t in wins)
    gl = abs(sum(t["net_pnl"] for t in losses))
    return {
        "trades": n,
        "win_rate_pct": round(len(wins) / n * 100, 1),
        "avg_return_pct": round(sum(t["return_pct"] for t in trades) / n, 2),
        "profit_factor": round(gp / gl, 2) if gl else (None if not gp else 999.0),
        "net_pnl": round(sum(t["net_pnl"] for t in trades), 2),
    }


def regime_breakdown(trades: List[Dict[str, Any]], regimes: Dict[str, str]) -> Dict[str, Any]:
    groups: Dict[str, List[Dict[str, Any]]] = {r: [] for r in REGIMES}
    unknown = 0
    for t in trades:
        r = regimes.get(t["entry_date"])
        t["regime"] = r or "無資料"
        if r:
            groups[r].append(t)
        else:
            unknown += 1
    rows = [{"regime": r, **_stats(groups[r])} for r in REGIMES]
    scored = [x for x in rows if x["trades"] >= 2]
    best = max(scored, key=lambda x: x["avg_return_pct"], default=None)
    worst = min(scored, key=lambda x: x["avg_return_pct"], default=None)
    return {
        "rule": REGIME_RULE,
        "rows": rows,
        "unclassified": unknown,
        "best": best["regime"] if best and best["avg_return_pct"] > 0 else None,
        "worst": worst["regime"] if worst and worst["avg_return_pct"] < 0 else None,
    }


def _run(bars: List[Bar], signals: List[int], market: str, discount: float,
         engine_kw: Optional[Dict[str, Any]] = None, allowed: Optional[List[bool]] = None) -> Dict[str, Any]:
    return BacktestEngine(market=market, commission_discount=discount, **(engine_kw or {})).run(bars, signals, allowed)


def params_text(key: str, params: Dict[str, Any]) -> str:
    defs = {d["key"]: d["label"] for d in strategies.STRATEGIES[key]["params"]}
    return "、".join(f"{defs.get(k, k)} {v:g}" for k, v in params.items())


def _summary(r: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "trades": r["total_trades"],
        "win_rate_pct": float(str(r["win_rate"]).rstrip("%") or 0),
        "avg_return_pct": float(str(r["avg_return"]).rstrip("%") or 0),
        "profit_factor": r["profit_factor"],
        "net_pnl": r["total_net_pnl"],
    }


def walk_forward(bars: List[Bar], market: str, discount: float, fast_ma: Optional[int] = None,
                 slow_ma: Optional[int] = None, *, strategy: str = "ma_cross", params: Optional[Dict[str, Any]] = None,
                 engine_kw: Optional[Dict[str, Any]] = None, allowed: Optional[List[bool]] = None) -> Optional[Dict[str, Any]]:
    """前 70% 挑最佳參數、後 30% 驗證。指標用整段算（後段開頭不必重新暖機），但交易只在各自區段內成交。
    掃描的是策略 GRID 裡的參數，其他參數、部位模型、停損與大盤濾網都跟使用者這次設定相同。"""
    split = int(len(bars) * TRAIN_RATIO)
    if split < 150 or len(bars) - split < 60:
        return None
    if params is None:
        params = {"fast_ma": fast_ma, "slow_ma": slow_ma}
    train, test = bars[:split], bars[split:]
    a_train = allowed[:split] if allowed else None
    a_test = allowed[split:] if allowed else None

    def seg(p: Dict[str, Any]) -> Dict[str, Any]:
        sig = strategies.signals(strategy, bars, p)
        return {"train": _run(train, sig[:split], market, discount, engine_kw, a_train),
                "test": _run(test, sig[split:], market, discount, engine_kw, a_test)}

    grid = strategies.STRATEGIES[strategy]["grid"]
    keys = list(grid)
    candidates = []
    for combo in product(*(grid[k] for k in keys)):
        p = {**params, **dict(zip(keys, combo))}
        if not strategies.valid_combo(strategy, p):
            continue
        r = seg(p)
        if r["train"]["total_trades"] >= 3:
            candidates.append((r["train"]["total_net_pnl"], p, r))
    if not candidates:
        return None
    _, bp, best = max(candidates, key=lambda x: x[0])
    mine = seg(params)
    b_train, b_test = _summary(best["train"]), _summary(best["test"])
    # 前段最佳參數到後段報酬大幅變差，或從賺變賠＝典型的過度擬合
    overfit = b_train["net_pnl"] > 0 and (b_test["net_pnl"] <= 0 or b_test["avg_return_pct"] < b_train["avg_return_pct"] * 0.3)
    label = params_text(strategy, {k: bp[k] for k in keys})
    labels = {d["key"]: d["label"] for d in strategies.STRATEGIES[strategy]["params"]}
    grid_text = " × ".join(f"{labels[k]} {list(grid[k])}" for k in keys)
    return {
        "train_period": f"{train[0].timestamp} ~ {train[-1].timestamp}",
        "test_period": f"{test[0].timestamp} ~ {test[-1].timestamp}",
        "grid": f"{grid_text}，共 {len(candidates)} 組有 3 筆以上交易",
        "best_params": {k: bp[k] for k in keys},
        "best_label": label,
        "best_train": b_train,
        "best_test": b_test,
        "mine_train": _summary(mine["train"]),
        "mine_test": _summary(mine["test"]),
        "overfit_warning": overfit,
        "verdict": (
            f"前段最佳參數（{label}）到了後段表現明顯變差，代表「最佳參數」多半是剛好配合前段行情，不要直接拿來用。"
            if overfit else
            f"前段最佳參數（{label}）在後段仍維持類似方向，穩定度較高；但仍只是一段歷史，需持續觀察。"
        ),
    }


def next_step_ideas(result: Dict[str, Any], breakdown: Optional[Dict[str, Any]], wf: Optional[Dict[str, Any]],
                    settings: Optional[Dict[str, Any]] = None) -> List[str]:
    """依結果提出「一次只加一條」的可測試規則。不給一堆參數組合，避免越調越擬合。
    settings：這次用的風控設定（market_filter、stop_loss_pct），已經開的規則就不再建議。"""
    settings = settings or {}
    ideas: List[str] = []
    if breakdown:
        rows = {r["regime"]: r for r in breakdown["rows"]}
        bear, side = rows.get("空頭", {}), rows.get("盤整", {})
        if bear.get("trades", 0) >= 2 and bear.get("avg_return_pct", 0) < 0:
            if settings.get("market_filter"):
                ideas.append("已開大盤濾網但空頭環境仍虧：測試把濾網均線拉長（例如 60 → 120 日），其他參數不動。")
            else:
                ideas.append("空頭環境平均報酬為負：測試開啟「大盤濾網」（大盤在季線下不開新倉）這一條，其他參數不動。")
        if side.get("trades", 0) >= 2 and side.get("avg_return_pct", 0) < 0:
            ideas.append("盤整環境容易來回被洗：測試「黃金交叉後收盤需高於長均線 1% 以上才進場」，減少假突破。")
    payoff = result.get("payoff_ratio")
    if payoff is not None and payoff < 1.2 and not settings.get("stop_loss_pct"):
        ideas.append(f"賺賠比只有 {payoff}：測試固定停損（例如進場價 −8% 出場），看能否把平均虧損壓小。")
    elif payoff is not None and payoff < 1.2 and not settings.get("trailing_pct"):
        ideas.append(f"已有停損但賺賠比只有 {payoff}：測試移動停利（例如從高點回落 10% 出場），讓獲利單抱久一點。")
    if result.get("total_trades", 0) < 30:
        ideas.append("交易次數不到 30 筆：先把回測期間拉長（3 年或 5 年）再判斷，比調參數更重要。")
    if wf and wf["overfit_warning"]:
        ideas.append("前後段驗證顯示有過度擬合跡象：維持常用的簡單參數（例如 5/20、20/60），不要追逐前段最佳值。")
    if not ideas:
        ideas.append("目前各環境沒有明顯弱點；下一步可換一檔不同產業的標的，用同一組參數驗證是否仍有效。")
    ideas.append("原則：每次只改一條規則，並用「後段驗證期」確認，改善才算數。")
    return ideas
