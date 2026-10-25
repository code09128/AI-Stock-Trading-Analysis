"""
回測進階驗證 (validation.py)
1. 參數熱力圖＋穩定高原：每組參數各跑一次完整回測；「自己排在前 40%、周圍格子也都在中位數以上」的標 ★（高原），
   只有單一格特別好、旁邊都差的叫孤島，實盤很容易失效。用相對排名而不是「有賺就好」，
   否則大多頭期間幾乎每格都賺，★ 會失去意義
2. 滾動前進分析（Rolling Walk-Forward）：切成多段「訓練期挑參數 → 下一段沒看過的資料實跑」，
   把各段樣本外結果串成一條曲線，並算 WFE（樣本外年化報酬 ÷ 樣本內年化報酬）
3. 蒙地卡羅：把每筆交易報酬打亂順序（shuffle）或重抽樣（bootstrap）上千次，看最大回撤與最終報酬的分布
全部只用真實 K 線與這次回測的交易，不呼叫 AI。
"""

import random
from itertools import product
from typing import Any, Dict, List, Optional

from src.backtest import strategies
from src.backtest.backtest_engine import BacktestEngine
from src.market.bar import Bar

MIN_TRADES = 3        # 少於這個筆數的格子不評分（運氣成分太大）
TRADING_DAYS = 250
MC_RUNS = (500, 1000, 2000, 3000)


def _engine(market: str, discount: float, engine_kw: Optional[Dict[str, Any]]) -> BacktestEngine:
    return BacktestEngine(market=market, commission_discount=discount, **(engine_kw or {}))


def _ret_pct(r: Dict[str, Any]) -> float:
    return round((r["final_equity"] / r["initial_capital"] - 1) * 100, 2)


def _annualize(ret_pct: float, bars: int) -> Optional[float]:
    if bars <= 0 or ret_pct <= -100:
        return None
    return round(((1 + ret_pct / 100) ** (TRADING_DAYS / bars) - 1) * 100, 2)


# ---------------------------------------------------------------- 1. 參數熱力圖
def param_heatmap(bars: List[Bar], market: str, discount: float, strategy: str, params: Dict[str, Any],
                  engine_kw: Optional[Dict[str, Any]] = None, allowed: Optional[List[bool]] = None) -> Dict[str, Any]:
    """依策略的 heatmap 兩軸（一個參數的策略只有一排）掃描，每格回傳總報酬、交易數、最大回撤與 ★ 標記。"""
    axes = strategies.STRATEGIES[strategy]["heatmap"]
    keys = list(axes)
    labels = {d["key"]: d["label"] for d in strategies.STRATEGIES[strategy]["params"]}
    xk = keys[0]
    yk = keys[1] if len(keys) > 1 else None
    xs = list(axes[xk])
    ys = list(axes[yk]) if yk else [None]

    cells: List[List[Optional[Dict[str, Any]]]] = []
    for yv in ys:
        row: List[Optional[Dict[str, Any]]] = []
        for xv in xs:
            p = {**params, xk: xv}
            if yk:
                p[yk] = yv
            if not strategies.valid_combo(strategy, p):
                row.append(None)
                continue
            r = _engine(market, discount, engine_kw).run(bars, strategies.signals(strategy, bars, p), allowed)
            row.append({"return_pct": _ret_pct(r), "trades": r["total_trades"],
                        "max_dd_pct": r["max_drawdown_detail"]["max_dd_pct"],
                        "profit_factor": r["profit_factor"]})
        cells.append(row)

    def scored(c: Optional[Dict[str, Any]]) -> bool:
        return bool(c) and c["trades"] >= MIN_TRADES

    ranked = sorted(c["return_pct"] for row in cells for c in row if scored(c))
    median = ranked[len(ranked) // 2] if ranked else 0.0
    top_cut = ranked[int(len(ranked) * 0.6)] if ranked else 0.0
    best = None
    plateau = 0
    for i, row in enumerate(cells):
        for j, c in enumerate(row):
            if not scored(c):
                continue
            if best is None or c["return_pct"] > cells[best[0]][best[1]]["return_pct"]:
                best = (i, j)
            nb = [cells[a][b] for a in range(i - 1, i + 2) for b in range(j - 1, j + 2)
                  if (a, b) != (i, j) and 0 <= a < len(cells) and 0 <= b < len(row) and cells[a][b]]
            nb_scored = [n for n in nb if scored(n)]
            avg = sum(n["return_pct"] for n in nb_scored) / len(nb_scored) if nb_scored else None
            c["neighbor_avg_pct"] = round(avg, 2) if avg is not None else None
            # 高原：自己賺且在前 40%、至少 2 個鄰格可評分且都賺、都不低於中位數、鄰格平均至少有自己的一半
            c["plateau"] = (c["return_pct"] > 0 and c["return_pct"] >= top_cut and len(nb_scored) >= 2
                            and all(n["return_pct"] > 0 and n["return_pct"] >= median for n in nb_scored)
                            and avg >= c["return_pct"] * 0.5)
            plateau += c["plateau"]

    def at(v, seq):
        return seq.index(v) if v in seq else None

    mine = (at(params.get(yk), ys) if yk else 0, at(params.get(xk), xs))
    best_cell = cells[best[0]][best[1]] if best else None
    island = bool(best_cell) and not best_cell["plateau"]
    if not best_cell:
        verdict = f"每組參數交易都少於 {MIN_TRADES} 筆，無法比較；請拉長回測期間。"
    elif plateau == 0:
        verdict = "沒有任何穩定高原：好的參數都是孤立的單一格，代表結果很依賴剛好選中的參數，實盤容易失效。"
    elif island:
        verdict = (f"最高分那格是孤島（旁邊的格子表現差），不要直接用；優先選 ★ 標記的區域，"
                   f"共 {plateau} 格。")
    else:
        verdict = f"最高分那格本身就在 ★ 高原裡（共 {plateau} 格），參數稍微變動結果仍穩定。"
    buy_hold = round((bars[-1].close / bars[0].close - 1) * 100, 2) if bars and bars[0].close else None
    beat = sum(1 for v in ranked if buy_hold is not None and v > buy_hold)
    if best_cell and buy_hold is not None and beat == 0:
        verdict += f"另外，沒有任何一組參數贏過同期「買進持有」的 {buy_hold}%。"
    return {
        "x": {"key": xk, "label": labels[xk], "values": xs},
        "y": {"key": yk, "label": labels[yk], "values": ys} if yk else None,
        "cells": cells,
        "best": {"row": best[0], "col": best[1]} if best else None,
        "mine": {"row": mine[0], "col": mine[1]} if None not in mine else None,
        "plateau_cells": plateau,
        "best_is_island": island,
        "min_trades": MIN_TRADES,
        "median_pct": round(median, 2),
        "buy_hold_pct": buy_hold,
        "beat_buy_hold": beat,
        "scored_cells": len(ranked),
        "verdict": verdict,
        "metric": "總報酬 %（整段期間、已扣稅費，部位與停損設定相同）",
    }


# ---------------------------------------------------------------- 2. 滾動前進分析
def _windows(n: int) -> Optional[Dict[str, int]]:
    """測試段長度 S＝總長 ÷ 7（至少 60 根），訓練段＝2S；能切出 2 段以上才做。"""
    test = max(60, n // 7)
    train = test * 2
    folds = (n - train) // test
    if train < 120 or folds < 2:
        return None
    return {"train": train, "test": test, "folds": min(folds, 6)}


def rolling_walk_forward(bars: List[Bar], market: str, discount: float, strategy: str, params: Dict[str, Any],
                         engine_kw: Optional[Dict[str, Any]] = None,
                         allowed: Optional[List[bool]] = None) -> Optional[Dict[str, Any]]:
    """多段「訓練期挑最佳參數（策略 GRID、依淨損益）→ 緊接的測試期實跑」，最後幾段剛好接到資料結尾。
    指標用整段資料算（不必每段重新暖機），交易只在各段內成交。"""
    w = _windows(len(bars))
    if not w:
        return None
    grid = strategies.STRATEGIES[strategy]["grid"]
    keys = list(grid)
    combos = [p for p in ({**params, **dict(zip(keys, c))} for c in product(*(grid[k] for k in keys)))
              if strategies.valid_combo(strategy, p)]
    sig_cache = {tuple(p[k] for k in keys): strategies.signals(strategy, bars, p) for p in combos}
    start0 = len(bars) - w["train"] - w["test"] * w["folds"]
    labels = {d["key"]: d["label"] for d in strategies.STRATEGIES[strategy]["params"]}

    def run(lo: int, hi: int, key) -> Dict[str, Any]:
        a = allowed[lo:hi] if allowed else None
        return _engine(market, discount, engine_kw).run(bars[lo:hi], sig_cache[key][lo:hi], a)

    folds, oos_eq, is_ann, oos_ann = [], 1.0, [], []
    for f in range(w["folds"]):
        tr_lo = start0 + f * w["test"]
        tr_hi = tr_lo + w["train"]
        te_hi = tr_hi + w["test"]
        cand = []
        for key in sig_cache:
            r = run(tr_lo, tr_hi, key)
            if r["total_trades"] >= MIN_TRADES:
                cand.append((r["total_net_pnl"], key, r))
        if not cand:
            folds.append({"train_period": f"{bars[tr_lo].timestamp} ~ {bars[tr_hi - 1].timestamp}",
                          "test_period": f"{bars[tr_hi].timestamp} ~ {bars[te_hi - 1].timestamp}",
                          "skipped": True, "reason": f"訓練期沒有參數組合達到 {MIN_TRADES} 筆交易"})
            continue
        _, key, r_is = max(cand, key=lambda x: x[0])
        r_os = run(tr_hi, te_hi, key)
        is_pct, os_pct = _ret_pct(r_is), _ret_pct(r_os)
        oos_eq *= 1 + os_pct / 100
        ia, oa = _annualize(is_pct, w["train"]), _annualize(os_pct, w["test"])
        if ia is not None and oa is not None:
            is_ann.append(ia)
            oos_ann.append(oa)
        folds.append({
            "train_period": f"{bars[tr_lo].timestamp} ~ {bars[tr_hi - 1].timestamp}",
            "test_period": f"{bars[tr_hi].timestamp} ~ {bars[te_hi - 1].timestamp}",
            "best_params": dict(zip(keys, key)),
            "best_label": "、".join(f"{labels[k]} {v:g}" for k, v in zip(keys, key)),
            "is_return_pct": is_pct,
            "oos_return_pct": os_pct,
            "oos_trades": r_os["total_trades"],
            "oos_max_dd_pct": r_os["max_drawdown_detail"]["max_dd_pct"],
            "skipped": False,
        })
    used = [f for f in folds if not f["skipped"]]
    if not used:
        return None
    avg_is = sum(is_ann) / len(is_ann) if is_ann else None
    avg_os = sum(oos_ann) / len(oos_ann) if oos_ann else None
    wfe = round(avg_os / avg_is, 2) if avg_is and avg_is > 0 and avg_os is not None else None
    distinct = len({f["best_label"] for f in used})
    if wfe is None:
        verdict = "訓練期本身就沒有賺錢，WFE 沒有意義：這個策略在這檔股票上找不到有效參數。"
    elif wfe >= 0.5:
        verdict = f"WFE {wfe}：樣本外保有樣本內一半以上的績效，參數在沒看過的行情仍大致有效。"
    elif wfe > 0:
        verdict = f"WFE {wfe}：樣本外仍賺但明顯縮水，挑出來的參數有部分是配合過去行情。"
    else:
        verdict = f"WFE {wfe}：樣本內賺、樣本外賠，典型過度擬合，不建議照最佳參數實盤。"
    return {
        "window": {"train_bars": w["train"], "test_bars": w["test"], "folds": w["folds"]},
        "folds": folds,
        "oos_total_return_pct": round((oos_eq - 1) * 100, 2),
        "avg_is_annual_pct": round(avg_is, 2) if avg_is is not None else None,
        "avg_oos_annual_pct": round(avg_os, 2) if avg_os is not None else None,
        "wfe": wfe,
        "param_changes": distinct,
        "verdict": verdict,
        "note": (f"每段訓練 {w['train']} 根 K（約 {w['train'] / TRADING_DAYS:.1f} 年）挑參數，接著 {w['test']} 根實跑；"
                 f"每段最佳參數換了 {distinct} 種，越常換代表參數越不穩定。"),
    }


# ---------------------------------------------------------------- 3. 蒙地卡羅
def _path(returns: List[float]) -> Dict[str, float]:
    eq, peak, mdd = 1.0, 1.0, 0.0
    for r in returns:
        eq *= 1 + r / 100
        peak = max(peak, eq)
        mdd = max(mdd, (peak - eq) / peak)
    return {"final_pct": (eq - 1) * 100, "mdd_pct": mdd * 100}


def _pct(sorted_vals: List[float], q: float) -> float:
    if not sorted_vals:
        return 0.0
    k = (len(sorted_vals) - 1) * q
    lo, hi = int(k), min(int(k) + 1, len(sorted_vals) - 1)
    return round(sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (k - lo), 2)


def _hist(vals: List[float], bins: int = 20) -> List[Dict[str, float]]:
    lo, hi = min(vals), max(vals)
    if hi - lo < 1e-9:
        return [{"from": round(lo, 2), "to": round(hi, 2), "count": len(vals)}]
    step = (hi - lo) / bins
    counts = [0] * bins
    for v in vals:
        counts[min(int((v - lo) / step), bins - 1)] += 1
    return [{"from": round(lo + i * step, 2), "to": round(lo + (i + 1) * step, 2), "count": c}
            for i, c in enumerate(counts)]


def monte_carlo(returns: List[float], runs: int = 1000, mode: str = "shuffle", seed: int = 42) -> Dict[str, Any]:
    """returns：每筆交易報酬 %（已扣稅費）。每筆用當下資金複利滾動，回撤以「每筆平倉後」計算。"""
    if mode not in ("shuffle", "bootstrap"):
        raise ValueError("模式只能是 shuffle（打亂順序）或 bootstrap（重抽樣）")
    if runs not in MC_RUNS:
        raise ValueError(f"模擬次數只能是 {'、'.join(map(str, MC_RUNS))}")
    rets = [float(r) for r in returns]
    if len(rets) < 5:
        raise ValueError("交易少於 5 筆，蒙地卡羅沒有意義；請拉長回測期間或換參數")
    rng = random.Random(seed)
    actual = _path(rets)
    finals, mdds = [], []
    for _ in range(runs):
        if mode == "shuffle":
            seq = rets[:]
            rng.shuffle(seq)
        else:
            seq = [rng.choice(rets) for _ in rets]
        p = _path(seq)
        finals.append(p["final_pct"])
        mdds.append(p["mdd_pct"])
    finals.sort()
    mdds.sort()
    qs = (0.05, 0.25, 0.5, 0.75, 0.95)
    worse = sum(1 for m in mdds if m > actual["mdd_pct"] + 1e-9) / runs * 100
    return {
        "mode": mode,
        "runs": runs,
        "trades": len(rets),
        "seed": seed,
        "actual": {"final_pct": round(actual["final_pct"], 2), "mdd_pct": round(actual["mdd_pct"], 2)},
        "final_pct": {f"p{int(q * 100)}": _pct(finals, q) for q in qs},
        "mdd_pct": {f"p{int(q * 100)}": _pct(mdds, q) for q in qs},
        "prob_loss_pct": round(sum(1 for f in finals if f < 0) / runs * 100, 1),
        "prob_mdd_worse_pct": round(worse, 1),
        "mdd_hist": _hist(mdds),
        "final_hist": _hist(finals) if mode == "bootstrap" else None,
        "note": ("打亂順序：每次的交易都一樣、只換順序，所以最終報酬全部相同；只看「運氣差、虧損連在一起」時回撤會多深。"
                 if mode == "shuffle" else
                 "重抽樣：每次從這些交易中隨機抽同樣筆數（可重複抽到），最終報酬與回撤都會變，用來看結果的不確定性。"),
    }
