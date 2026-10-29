"""
存股計畫與退休試算 (savings_plan.py)
計算方式（全部模組一致，畫面上的「計算方式」說明也照這裡寫）：
- 每月月初投入、月初提領；月報酬率 = 年報酬率 ÷ 12（名目利率，按月複利）
- 定期定額終值：FV = 初期投入 × (1+r)^n ＋ 每月金額 × (1+r) × ((1+r)^n − 1) ÷ r
- 目標反推每月金額：把上式的「每月金額」解出來（初期投入的終值已超過目標時回 0）
- 股息現金流：所需本金 = 每月想領 × 12 ÷ 殖利率（未扣二代健保補充保費與所得稅）
- 退休後每月可領：退休時資產在剩餘月數內領完的期初年金
- 換算成今天的錢：名目金額 ÷ (1 + 通膨率)^距今年數
報酬率參考值用含配息再投入的還原價計算（台股：FinMind 上市以來日 K＋除權息自行還原；其他市場：Yahoo 完整歷史月資料）：
- 歷史報酬率：上市以來（全部資料）的年化報酬（CAGR）
- 穩定報酬率／較差報酬率：最近 15 年內任一天起持有 5 年的年化報酬，取中位數／第 20 百分位數；資料不足 5 年就回 None，不硬算
  （2026-10-29 用 0050 驗證：14.63%／13.53%／10.02%，與 CMoney 的 14.7%／13.6%／9.9% 相符）
"""

from bisect import bisect_left
from datetime import date, timedelta
from typing import Any, Dict, List, Optional

ROLL_YEARS = 5
ROLL_WINDOW_YEARS = 15  # 穩定／較差報酬率只看最近 15 年
SPLIT_LOW, SPLIT_HIGH = 0.4, 2.5
TABLE_YEARS = [3, 5, 10, 15, 20]


def _r(annual_pct: float) -> float:
    return annual_pct / 100 / 12


def future_value(monthly: float, annual_pct: float, months: int, initial: float = 0.0) -> float:
    r = _r(annual_pct)
    if r == 0:
        return initial + monthly * months
    g = (1 + r) ** months
    return initial * g + monthly * (1 + r) * (g - 1) / r


def required_monthly(target: float, annual_pct: float, months: int, initial: float = 0.0) -> float:
    r = _r(annual_pct)
    g = (1 + r) ** months
    remaining = target - initial * g
    if remaining <= 0:
        return 0.0
    if r == 0:
        return remaining / months
    return remaining * r / ((1 + r) * (g - 1))


def monthly_payout(capital: float, annual_pct: float, months: int) -> float:
    """月初提領、剛好在 months 個月內領完。"""
    r = _r(annual_pct)
    if months <= 0:
        return 0.0
    if r == 0:
        return capital / months
    return capital * r / ((1 + r) * (1 - (1 + r) ** -months))


def income_capital(monthly_income: float, yield_pct: Optional[float]) -> Optional[float]:
    if not yield_pct or yield_pct <= 0:
        return None
    return monthly_income * 12 / (yield_pct / 100)


def income_from_capital(capital: float, yield_pct: Optional[float]) -> Optional[float]:
    """一次投入：每月可領 = 本金 × 殖利率 ÷ 12。"""
    if not yield_pct or yield_pct <= 0:
        return None
    return capital * yield_pct / 100 / 12


def grow_table(monthly: float, initial: float, rates: List[float], years: List[int] = None) -> List[Dict[str, Any]]:
    """S1：每列一個年數，各報酬率下的資產與投入本金。"""
    out = []
    for y in years or TABLE_YEARS:
        principal = initial + monthly * y * 12
        values = [round(future_value(monthly, p, y * 12, initial)) for p in rates]
        out.append({"years": y, "principal": round(principal), "values": values})
    return out


def target_table(target: float, initial: float, rates: List[float], years: List[int] = None) -> List[Dict[str, Any]]:
    """S2：每列一個年數，各報酬率下每月要存多少。"""
    return [{"years": y, "monthly": [round(required_monthly(target, p, y * 12, initial)) for p in rates]}
            for y in (years or TABLE_YEARS)]


def growth_curve(monthly: float, initial: float, annual_pct: float, years: int) -> List[Dict[str, Any]]:
    return [{"year": y, "principal": round(initial + monthly * y * 12),
             "value": round(future_value(monthly, annual_pct, y * 12, initial))} for y in range(0, years + 1)]


def lifecycle(age: int, retire_age: int, end_age: int, initial: float, monthly: float,
              accum_pct: float, retire_pct: float, inflation_pct: float) -> Dict[str, Any]:
    """S4：存到退休、退休後每月提領到 end_age 領完。"""
    if not age < retire_age < end_age:
        raise ValueError("年齡需滿足：目前年齡 < 退休年齡 < 規劃領到幾歲")
    acc_months = (retire_age - age) * 12
    pay_months = (end_age - retire_age) * 12
    principal = initial + monthly * acc_months
    at_retire = future_value(monthly, accum_pct, acc_months, initial)
    payout = monthly_payout(at_retire, retire_pct, pay_months)
    deflate = (1 + inflation_pct / 100) ** (retire_age - age)

    curve, bal = [], float(initial)
    r_acc, r_ret = _r(accum_pct), _r(retire_pct)
    for a in range(age, end_age + 1):
        curve.append({"age": a, "value": round(max(bal, 0)), "phase": "存" if a < retire_age else "領"})
        for _ in range(12):
            if a < retire_age:
                bal = (bal + monthly) * (1 + r_acc)
            else:
                bal = (bal - payout) * (1 + r_ret)
    return {
        "principal": round(principal),
        "at_retire": round(at_retire),
        "at_retire_today": round(at_retire / deflate),
        "monthly_payout": round(payout),
        "monthly_payout_today": round(payout / deflate),
        "total_payout": round(payout * pay_months),
        "years_saving": retire_age - age,
        "years_retired": end_age - retire_age,
        "curve": curve,
    }


# ---------- 報酬率參考值（還權日 K）----------
def _years_between(a: str, b: str) -> float:
    return (date.fromisoformat(b) - date.fromisoformat(a)).days / 365.25


def _percentile(sorted_vals: List[float], q: float) -> float:
    """線性內插的百分位數（q 介於 0～1）。"""
    pos = (len(sorted_vals) - 1) * q
    lo = int(pos)
    hi = min(lo + 1, len(sorted_vals) - 1)
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (pos - lo)


def total_return_index(prices: List[Dict[str, Any]], events: List[Dict[str, Any]]) -> Dict[str, Any]:
    """未還權收盤價＋除權息 → 含息再投入的還原指數（第一天 = 1）。
    prices：[{date, close}] 由舊到新；events：[{date: 除權息交易日, cash: 每股現金股利, stock: 每股配股數}]。
    單日收盤變成前一天的 40% 以下或 2.5 倍以上、當天又沒有配股，視為股票分割（合併），按整數比例還原，
    例如 0050 在 2025-06-18 一拆四。除權息日沒有成交資料時，套用到之後第一個有成交的日子。"""
    evs = sorted((e for e in events if e.get("cash") or e.get("stock")), key=lambda e: e["date"])
    k, idx, prev = 0, 1.0, None
    out: List[Dict[str, Any]] = []
    splits: List[Dict[str, Any]] = []
    for p in prices:
        c = p.get("close")
        if not c or c <= 0:
            continue
        cash = stock = 0.0
        while k < len(evs) and evs[k]["date"] <= p["date"]:
            if prev is not None:  # 第一筆以前的除權息與報酬無關
                cash += evs[k].get("cash") or 0
                stock += evs[k].get("stock") or 0
            k += 1
        if prev is not None:
            raw = c / prev
            if not stock and (raw < SPLIT_LOW or raw > SPLIT_HIGH):
                factor = round(prev / c) if raw < 1 else 1 / round(c / prev)
                splits.append({"date": p["date"], "factor": factor})
                idx *= (c + cash) * factor / prev
            else:
                idx *= (c * (1 + stock) + cash) / prev
        out.append({"date": p["date"], "close": idx})
        prev = c
    return {"points": out, "splits": splits}


def return_stats(points: List[Dict[str, Any]], roll_window_years: float = ROLL_WINDOW_YEARS) -> Dict[str, Any]:
    """points：[{date: 'YYYY-MM-DD', close: 還原價或還原指數}]，由舊到新（日資料或月資料都可以）。報酬率單位都是 %。
    歷史報酬率用全部資料；穩定／較差報酬率只取最近 roll_window_years 年內的 5 年持有期間。"""
    pts = [p for p in points if p.get("close") and p["close"] > 0]
    out: Dict[str, Any] = {"cagr": None, "rolling_median": None, "rolling_p20": None, "rolling_windows": 0,
                           "rolling_from": None, "total_3y": None, "years": 0.0, "first_date": None,
                           "last_date": None}
    if len(pts) < 2:
        return out
    first, last = pts[0], pts[-1]
    yrs = _years_between(first["date"], last["date"])
    out.update(years=round(yrs, 1), first_date=first["date"], last_date=last["date"])
    if yrs >= 1:
        out["cagr"] = round(((last["close"] / first["close"]) ** (1 / yrs) - 1) * 100, 2)

    dates = [p["date"] for p in pts]
    three_ago = (date.fromisoformat(last["date"]) - timedelta(days=round(3 * 365.25))).isoformat()
    if first["date"] <= three_ago:
        base = pts[bisect_left(dates, three_ago)]
        out["total_3y"] = round((last["close"] / base["close"] - 1) * 100, 2)

    win_from = (date.fromisoformat(last["date"]) - timedelta(days=round(roll_window_years * 365.25))).isoformat()
    start_i = bisect_left(dates, win_from)
    step = 5 if len(pts) / max(yrs, 1e-9) > 100 else 1  # 日資料每 5 個交易日取一個起點（結果與逐日相差極小），月資料每個月
    rolls = []
    for i in range(start_i, len(pts), step):
        end = (date.fromisoformat(pts[i]["date"]) + timedelta(days=round(ROLL_YEARS * 365.25))).isoformat()
        j = bisect_left(dates, end)
        if j >= len(pts):
            break
        held = _years_between(pts[i]["date"], pts[j]["date"])
        rolls.append(((pts[j]["close"] / pts[i]["close"]) ** (1 / held) - 1) * 100)
    if len(rolls) >= 12:  # 起點太少（日資料約 3 個月、月資料 1 年）分位數沒有意義
        rolls.sort()
        out.update(rolling_median=round(_percentile(rolls, 0.5), 2), rolling_p20=round(_percentile(rolls, 0.2), 2),
                   rolling_windows=len(rolls), rolling_from=pts[start_i]["date"])
    return out


def avg_yield(events: List[Dict[str, Any]], price: Optional[float], first_date: Optional[str],
              today: Optional[date] = None, years: int = 3) -> Optional[Dict[str, Any]]:
    """近 years 年平均年殖利率 = 期間現金股利合計 ÷ 年數 ÷ 現價。上市未滿 years 年就用實際年數（至少 1 年）。"""
    if not price:
        return None
    today = today or date.today()
    span = float(years)
    if first_date:
        span = min(span, _years_between(first_date, today.isoformat()))
    if span < 1:
        return None
    cutoff = (today - timedelta(days=round(span * 365.25))).isoformat()
    cash = sum(e["cash"] for e in events if cutoff < e["ex_date"] <= today.isoformat())
    return {"yield_pct": round(cash / span / price * 100, 2), "years": round(span, 1)}
