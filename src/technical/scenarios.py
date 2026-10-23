"""
多頭／中性／空頭三情境 (scenarios.py)
- 同時看日線與週線（週線由還權日 K 聚合），加上成交量變化
- 每個情境都給「成立條件」與「失效條件」，價位全部取自系統算出的支撐／壓力與 ATR
- 只列出支持各情境的現有訊號，不給機率、不預測哪個一定發生
全部規則計算，不呼叫 AI。
"""

from typing import Any, Dict, List, Optional

from src.market.bar import Bar
from src.technical.weekly import to_weekly_bars
from src.technical.indicators import calculate_ma, calculate_macd, calculate_rsi
from src.market.market_rules import align_tw_tick

DISCLAIMER = "三種情境是「如果…就…」的條件推演，不是預測；任何一種都可能發生，請依實際收盤是否符合條件來判斷。"


def _px(v: Optional[float], market: str) -> Optional[float]:
    if v is None:
        return None
    v = align_tw_tick(v) if market == "TW" else round(v, 2)
    return int(v) if float(v).is_integer() else v


def _trend(bars: List[Bar], label: str) -> Dict[str, Any]:
    closes = [b.close for b in bars]
    last = closes[-1]
    ma5, ma20, ma60 = (calculate_ma(closes, n)[-1] for n in (5, 20, 60))
    hist = calculate_macd(closes)["hist"]
    rsi = calculate_rsi(closes, 14)[-1]
    if ma5 and ma20 and last > ma5 > ma20:
        state, text = "bull", "多頭排列（收盤 > MA5 > MA20）"
    elif ma5 and ma20 and last < ma5 < ma20:
        state, text = "bear", "空頭排列（收盤 < MA5 < MA20）"
    else:
        state, text = "mixed", "盤整／多空交錯"
    macd_turn = None
    if len(hist) >= 2 and hist[-1] is not None and hist[-2] is not None:
        macd_turn = "柱狀體翻正" if hist[-2] <= 0 < hist[-1] else "柱狀體翻負" if hist[-2] >= 0 > hist[-1] else None
    return {
        "frame": label, "state": state, "text": text, "close": round(last, 2),
        "MA5": round(ma5, 2) if ma5 else None, "MA20": round(ma20, 2) if ma20 else None,
        "MA60": round(ma60, 2) if ma60 else None,
        "RSI14": round(rsi, 1) if rsi is not None else None,
        "MACD_HIST": round(hist[-1], 2) if hist and hist[-1] is not None else None,
        "macd_turn": macd_turn,
    }


def volume_profile(daily: List[Bar]) -> Dict[str, Any]:
    """近 20 日：上漲日平均量 vs 下跌日平均量、近 5 日均量 vs 20 日均量、最後一天量比。"""
    win = daily[-21:]
    up, down = [], []
    for prev, b in zip(win, win[1:]):
        (up if b.close > prev.close else down if b.close < prev.close else []).append(b.volume)
    vols = [b.volume for b in daily[-20:]]
    avg20 = sum(vols) / len(vols) if vols else 0
    avg5 = sum(vols[-5:]) / 5 if len(vols) >= 5 else 0
    up_avg = sum(up) / len(up) if up else 0
    down_avg = sum(down) / len(down) if down else 0
    ratio = round(up_avg / down_avg, 2) if down_avg else None
    if ratio is None:
        note = "近 20 日沒有下跌日，無法比較"
    elif ratio >= 1.2:
        note = "上漲日量明顯大於下跌日量，買盤較積極"
    elif ratio <= 0.8:
        note = "下跌日量明顯大於上漲日量，賣壓較重"
    else:
        note = "漲跌日量能差不多，方向不明"
    return {
        "avg20": round(avg20), "avg5_vs_avg20": round(avg5 / avg20, 2) if avg20 else None,
        "last_vs_avg20": round(daily[-1].volume / avg20, 2) if avg20 else None,
        "up_down_volume_ratio": ratio, "note": note,
    }


def build(snapshot: Dict[str, Any], daily: List[Bar]) -> Dict[str, Any]:
    market = snapshot["market"]
    price = snapshot["latest_close"]
    atr = snapshot["indicators"].get("ATR14") or price * 0.02
    sup = snapshot.get("support_levels") or []
    res = snapshot.get("resistance_levels") or []
    # 關鍵價位要拉開間距：第一道離現價至少 0.5 ATR、第二道再離第一道至少 1 ATR，否則區間太窄沒有意義
    below = [v for v in reversed(sup) if price - v >= atr * 0.5]
    above = [v for v in res if v - price >= atr * 0.5]
    s1 = below[0] if below else _px(price - atr * 1.5, market)
    r1 = above[0] if above else _px(price + atr * 1.5, market)
    s2 = next((v for v in below if s1 - v >= atr), None) or _px(s1 - atr * 2, market)
    r2 = next((v for v in above if v - r1 >= atr), None) or _px(r1 + atr * 2, market)
    s1, s2, r1, r2 = (_px(v, market) for v in (s1, s2, r1, r2))
    level_src = ("取自系統支撐／壓力，並依 ATR 拉開間距" if below and above
                 else "部分價位由 ATR 推估（附近沒有夠遠的歷史轉折點）")

    d = _trend(daily, "日線")
    weekly_bars = to_weekly_bars(daily)
    w = _trend(weekly_bars, "週線") if len(weekly_bars) >= 25 else None
    vol = volume_profile(daily)
    vol_need = round(vol["avg20"] * 1.2) if vol["avg20"] else None

    bull_ev, bear_ev, flat_ev = [], [], []
    for t in filter(None, (d, w)):
        (bull_ev if t["state"] == "bull" else bear_ev if t["state"] == "bear" else flat_ev).append(f"{t['frame']}{t['text']}")
        if t["macd_turn"] == "柱狀體翻正":
            bull_ev.append(f"{t['frame']} MACD 柱狀體剛翻正")
        elif t["macd_turn"] == "柱狀體翻負":
            bear_ev.append(f"{t['frame']} MACD 柱狀體剛翻負")
    rsi = d["RSI14"]
    if rsi is not None:
        if rsi >= 70:
            bear_ev.append(f"日 RSI {rsi} 過熱，追高風險升高")
        elif rsi >= 55:
            bull_ev.append(f"日 RSI {rsi} 偏強")
        elif rsi <= 30:
            bull_ev.append(f"日 RSI {rsi} 超賣，可能出現反彈")
        elif rsi <= 45:
            bear_ev.append(f"日 RSI {rsi} 偏弱")
        else:
            flat_ev.append(f"日 RSI {rsi} 位於中性區")
    ud = vol["up_down_volume_ratio"]
    if ud is not None:
        (bull_ev if ud >= 1.2 else bear_ev if ud <= 0.8 else flat_ev).append(f"量能：{vol['note']}（上漲日/下跌日量比 {ud}）")
    if d["MA20"] is not None:
        (bull_ev if price > d["MA20"] else bear_ev).append(f"現價{'站上' if price > d['MA20'] else '位於'} MA20 {d['MA20']}{'' if price > d['MA20'] else ' 之下'}")
    if w and w["MA20"] is not None:
        (bull_ev if price > w["MA20"] else bear_ev).append(f"現價{'在' if price > w['MA20'] else '跌破'}週 MA20 {w['MA20']}{'之上' if price > w['MA20'] else ''}")

    if vol_need and market == "TW":  # 台股習慣用「張」（1 張＝1,000 股），數字短也比較不會被看錯單位
        vol_txt = f"，且當日量 ≥ 20 日均量 1.2 倍（約 {round(vol_need / 1000):,} 張）"
    elif vol_need:
        vol_txt = f"，且當日量 ≥ 20 日均量 1.2 倍（約 {vol_need / 1e6:,.1f} 百萬股）"
    else:
        vol_txt = "，且量能放大"
    scenarios = [
        {
            "key": "bull", "name": "多頭情境", "evidence": bull_ev,
            "trigger": f"日收盤站上壓力 {r1}{vol_txt}",
            "target": f"上看下一壓力 {r2}",
            "invalidation": f"突破後收盤又跌回 {r1} 之下（假突破），或跌破支撐 {s1}",
        },
        {
            "key": "neutral", "name": "中性情境", "evidence": flat_ev,
            "trigger": f"收盤持續在 {s1} ～ {r1} 區間內，量能沒有明顯放大",
            "target": f"區間來回，靠近 {s1} 偏買、靠近 {r1} 偏賣",
            "invalidation": f"帶量收盤突破 {r1}（轉多）或跌破 {s1}（轉空）",
        },
        {
            "key": "bear", "name": "空頭情境", "evidence": bear_ev,
            "trigger": f"日收盤跌破支撐 {s1}",
            "target": f"下看下一支撐 {s2}",
            "invalidation": f"跌破後 3 個交易日內收盤站回 {s1} 之上",
        },
    ]
    counts = {s["key"]: len(s["evidence"]) for s in scenarios}
    lean = max(counts, key=counts.get)
    if list(counts.values()).count(counts[lean]) > 1:
        lean = None
    return {
        "price": price,
        "levels": {"S2": s2, "S1": s1, "R1": r1, "R2": r2, "source": level_src, "ATR14": round(atr, 2)},
        "daily": d,
        "weekly": w,
        "volume": vol,
        "scenarios": scenarios,
        "lean": lean,
        "lean_note": ("目前支持訊號最多的是「" + {"bull": "多頭", "neutral": "中性", "bear": "空頭"}[lean] + "」情境，"
                      "但這只代表現有訊號的數量，不代表它一定會發生") if lean else "各情境的支持訊號數量接近，方向不明",
        "disclaimer": DISCLAIMER,
    }
