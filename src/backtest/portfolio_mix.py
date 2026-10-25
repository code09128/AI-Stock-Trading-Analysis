"""
策略組合 (portfolio_mix.py)
把多支「標的 × 策略」的回測（每支各自用全部本金跑出逐日淨值）依權重合成一個組合：
- 權重法：equal（等權重）、inv_vol（波動率倒數：波動小的分多一點）、sharpe（夏普值加權：近期報酬／波動好的分多一點）
- 不偷看未來：每月第一個交易日，只用「之前」最多 WINDOW 天的日報酬重新算權重；歷史不足 MIN_HISTORY 天先用等權重
- 兩次調整之間，每天都依權重再平衡（簡化：實務上會有額外交易成本，這裡沒算）
- 相關係數矩陣：各支策略日報酬的相關係數（只算兩邊都有資料的日子），越低代表越能互補降波動
- 績效貢獻：每天「權重 × 該策略日報酬」加總，看組合的報酬主要來自哪一支
"""

import math
from typing import Any, Dict, List, Optional

TRADING_DAYS = 250
WINDOW = 120
MIN_HISTORY = 20
METHODS = {"equal": "等權重", "inv_vol": "波動率倒數", "sharpe": "夏普值加權"}
VOL_FLOOR = 0.001  # 一直空手的策略波動是 0，設下限避免權重無限大


def _mean(xs: List[float]) -> float:
    return sum(xs) / len(xs) if xs else 0.0


def _std(xs: List[float]) -> float:
    if len(xs) < 2:
        return 0.0
    m = _mean(xs)
    return math.sqrt(sum((x - m) ** 2 for x in xs) / (len(xs) - 1))


def _corr(a: List[Optional[float]], b: List[Optional[float]]) -> Optional[float]:
    pairs = [(x, y) for x, y in zip(a, b) if x is not None and y is not None]
    if len(pairs) < 20:
        return None
    xs, ys = [p[0] for p in pairs], [p[1] for p in pairs]
    sx, sy = _std(xs), _std(ys)
    if sx == 0 or sy == 0:
        return None
    mx, my = _mean(xs), _mean(ys)
    return round(sum((x - mx) * (y - my) for x, y in pairs) / ((len(pairs) - 1) * sx * sy), 2)


def align_returns(legs: List[Dict[str, Any]]) -> Dict[str, Any]:
    """各支的逐日淨值 → 共同期間的日報酬。某支當天沒交易（不同市場假日）＝報酬 None（組合裡當 0）。"""
    by = [{d["date"]: d["equity"] for d in leg["daily"]} for leg in legs]
    start = max(leg["daily"][0]["date"] for leg in legs)
    end = min(leg["daily"][-1]["date"] for leg in legs)
    dates = sorted({d for m in by for d in m if start <= d <= end})
    rets: List[List[Optional[float]]] = []
    last = [None] * len(legs)
    for d in dates:
        row: List[Optional[float]] = []
        for i, m in enumerate(by):
            v = m.get(d)
            if v is None or last[i] in (None, 0):
                row.append(None)
            else:
                row.append(v / last[i] - 1)
            if v is not None:
                last[i] = v
        rets.append(row)
    return {"dates": dates[1:], "rets": rets[1:]}


def _weights(method: str, hist: List[List[Optional[float]]], n: int) -> List[float]:
    if method == "equal" or len(hist) < MIN_HISTORY:
        return [1 / n] * n
    cols = [[r[i] for r in hist if r[i] is not None] for i in range(n)]
    if method == "inv_vol":
        raw = [1 / max(_std(c), VOL_FLOOR) for c in cols]
    else:
        raw = []
        for c in cols:
            sd = _std(c)
            raw.append(max(_mean(c) / sd, 0.0) if sd > 0 else 0.0)
    total = sum(raw)
    return [x / total for x in raw] if total > 0 else [1 / n] * n


def _metrics(curve: List[float]) -> Dict[str, Any]:
    rets = [curve[i] / curve[i - 1] - 1 for i in range(1, len(curve))]
    peak, mdd = curve[0], 0.0
    for v in curve:
        peak = max(peak, v)
        mdd = max(mdd, (peak - v) / peak if peak else 0.0)
    total = curve[-1] / curve[0] - 1
    years = max(len(rets) / TRADING_DAYS, 1e-9)
    vol = _std(rets) * math.sqrt(TRADING_DAYS)
    ann = (1 + total) ** (1 / years) - 1 if total > -1 else -1.0
    return {
        "total_return_pct": round(total * 100, 2),
        "annual_return_pct": round(ann * 100, 2),
        "annual_vol_pct": round(vol * 100, 2),
        "sharpe": round(ann / vol, 2) if vol > 0 else None,
        "max_dd_pct": round(mdd * 100, 2),
    }


def combine(legs: List[Dict[str, Any]], method: str) -> Dict[str, Any]:
    al = align_returns(legs)
    dates, rets, n = al["dates"], al["rets"], len(legs)
    eq, curve, contrib = 1.0, [1.0], [0.0] * n
    w = [1 / n] * n
    month = None
    weight_log = []
    for t, (d, row) in enumerate(zip(dates, rets)):
        if d[:7] != month:  # 每月第一個交易日依「之前」的資料調整權重
            month = d[:7]
            w = _weights(method, rets[max(0, t - WINDOW):t], n)
            weight_log.append({"date": d, "weights": [round(x, 4) for x in w]})
        r = sum(wi * (ri or 0.0) for wi, ri in zip(w, row))
        for i in range(n):
            contrib[i] += w[i] * (row[i] or 0.0)
        eq *= 1 + r
        curve.append(eq)
    total_c = sum(contrib)
    step = max(1, len(curve) // 300)
    return {
        "method": method,
        "label": METHODS[method],
        **_metrics(curve),
        "contribution_pct": [round(c * 100, 2) for c in contrib],
        "contribution_share_pct": [round(c / total_c * 100, 1) if total_c else None for c in contrib],
        "avg_weights": [round(_mean([x["weights"][i] for x in weight_log]) * 100, 1) for i in range(n)],
        "last_weights": [round(x * 100, 1) for x in weight_log[-1]["weights"]] if weight_log else [],
        "curve": [{"date": (["start"] + dates)[i], "value": round(curve[i], 4)} for i in range(0, len(curve), step)],
    }


def analyze(legs: List[Dict[str, Any]]) -> Dict[str, Any]:
    al = align_returns(legs)
    if len(al["dates"]) < 60:
        raise ValueError("各策略共同的期間不到 60 個交易日，無法組合；請拉長回測期間或換標的")
    n = len(legs)
    cols = [[r[i] for r in al["rets"]] for i in range(n)]
    leg_stats = []
    for i, leg in enumerate(legs):
        curve = [1.0]
        for x in cols[i]:
            curve.append(curve[-1] * (1 + (x or 0.0)))
        leg_stats.append({"label": leg["label"], **_metrics(curve)})
    corr = [[1.0 if i == j else _corr(cols[i], cols[j]) for j in range(n)] for i in range(n)]
    offdiag = [corr[i][j] for i in range(n) for j in range(i + 1, n) if corr[i][j] is not None]
    results = [combine(legs, m) for m in METHODS]
    best_single = min(s["annual_vol_pct"] for s in leg_stats)
    return {
        "period": f"{al['dates'][0]} ~ {al['dates'][-1]}",
        "legs": leg_stats,
        "correlation": corr,
        "avg_correlation": round(_mean(offdiag), 2) if offdiag else None,
        "results": results,
        "lowest_single_vol_pct": best_single,
        "rule": (f"每月第一個交易日用之前最多 {WINDOW} 天的日報酬重新計算權重（不足 {MIN_HISTORY} 天用等權重），"
                 "期間內每天依權重再平衡；再平衡的交易成本沒有計入。各策略本身的手續費與稅都已扣除。"),
    }
