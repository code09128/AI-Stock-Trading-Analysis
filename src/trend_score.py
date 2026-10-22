"""
100 分趨勢評分 (trend_score.py)
參考 liusai0820/Stock-Analysis-Skill 的六維度評分，改用本專案 indicators.py 的計算：
- 趨勢（MA5/10/20 排列）30、乖離率（距 MA5）20、MACD 15、量能 15、RSI 10、均線支撐 10
與原版不同處：
- 「RSI ≥ 80」與「MA5 乖離 > 5%」兩條嚴進規則在程式端強制執行（原版只寫在提示詞裡），觸發時訊號最高為「持有」
- 盤中最新一根日 K 的成交量尚未收齊，量能維度給中性分並標註，避免把「還沒收盤」誤判成「縮量回檔」
- RSI 用 14 日（與模組 1 其他地方一致；原版用 RSI12）
"""

from typing import Any, Dict, List, Optional

from src.indicators import calculate_ma, calculate_macd, calculate_rsi

TREND_POINTS = {
    "strong_bullish": 30, "bullish": 26, "weak_bullish": 18, "consolidation": 12,
    "weak_bearish": 8, "bearish": 4, "strong_bearish": 0, "insufficient_data": 12,
}
VOLUME_POINTS = {
    "shrink_pullback": 15, "heavy_volume_up": 12, "normal": 10, "shrink_up": 6,
    "heavy_volume_down": 0, "partial_session": 8, "insufficient_data": 8,
}
MACD_POINTS = {
    "golden_cross_above_zero": 15, "crossing_above_zero": 13, "golden_cross": 12, "bullish": 10,
    "neutral": 7, "bearish": 3, "crossing_below_zero": 1, "death_cross": 0, "insufficient_data": 7,
}
RSI_POINTS = {"oversold": 10, "strong": 8, "neutral": 5, "weak": 3, "overbought": 0, "unknown": 5}

ALIGNMENT_LABELS = {
    "strong_bullish": "強勢多頭排列", "bullish": "多頭排列", "weak_bullish": "弱多排列",
    "consolidation": "盤整", "weak_bearish": "弱空排列", "bearish": "空頭排列",
    "strong_bearish": "強勢空頭排列", "insufficient_data": "資料不足",
}
LABELS = {
    "insufficient_data": "資料不足",
    "shrink_pullback": "縮量回檔", "heavy_volume_up": "放量上漲", "normal": "量能正常",
    "shrink_up": "縮量上漲", "heavy_volume_down": "放量下跌", "partial_session": "盤中量能未收齊",
    "golden_cross_above_zero": "零軸上黃金交叉", "crossing_above_zero": "DIF 上穿零軸",
    "golden_cross": "零軸下黃金交叉", "bullish": "多方", "bearish": "空方", "crossing_below_zero": "DIF 下穿零軸",
    "death_cross": "死亡交叉", "neutral": "中性",
    "oversold": "超賣", "strong": "強勢", "weak": "弱勢", "overbought": "超買", "unknown": "未知",
}
SIGNALS = {
    "STRONG_BUY": "強烈買進", "BUY": "買進", "HOLD": "持有",
    "WAIT": "觀望", "SELL": "賣出", "STRONG_SELL": "強烈賣出",
}
RSI_HARD_LIMIT = 80.0
BIAS_HARD_LIMIT = 5.0


def _last(series: List[Optional[float]], back: int = 1) -> Optional[float]:
    return series[-back] if len(series) >= back else None


def _alignment(ma5: Optional[float], ma10: Optional[float], ma20: Optional[float]) -> str:
    if None in (ma5, ma10, ma20) or not ma20:
        return "insufficient_data"
    if ma5 > ma10 > ma20:
        return "strong_bullish" if (ma5 - ma20) / ma20 * 100 > 5 else "bullish"
    if ma5 < ma10 < ma20:
        return "strong_bearish" if (ma20 - ma5) / ma20 * 100 > 5 else "bearish"
    if ma5 > ma10:
        return "weak_bullish"
    if ma5 < ma10:
        return "weak_bearish"
    return "consolidation"


def _macd_state(dif: List[Optional[float]], dea: List[Optional[float]]) -> str:
    c_dif, p_dif, c_dea, p_dea = _last(dif), _last(dif, 2), _last(dea), _last(dea, 2)
    if None in (c_dif, p_dif, c_dea, p_dea):
        return "insufficient_data"
    if p_dif < 0 <= c_dif:
        return "crossing_above_zero"
    if p_dif > 0 >= c_dif:
        return "crossing_below_zero"
    prev_gap, gap = p_dif - p_dea, c_dif - c_dea
    if prev_gap <= 0 < gap:
        return "golden_cross_above_zero" if c_dif > 0 else "golden_cross"
    if prev_gap >= 0 > gap:
        return "death_cross"
    if c_dif > 0 and c_dea > 0:
        return "bullish"
    if c_dif < 0 and c_dea < 0:
        return "bearish"
    return "neutral"


def _rsi_zone(rsi: Optional[float]) -> str:
    if rsi is None:
        return "unknown"
    if rsi >= 80:
        return "overbought"
    if rsi >= 60:
        return "strong"
    if rsi >= 40:
        return "neutral"
    if rsi >= 20:
        return "weak"
    return "oversold"


def _volume_state(volumes: List[float], closes: List[float], partial_session: bool) -> Dict[str, Any]:
    if partial_session:
        return {"state": "partial_session", "vol_ratio_5d": None}
    if len(volumes) < 6 or len(closes) < 2:
        return {"state": "insufficient_data", "vol_ratio_5d": None}
    avg5 = sum(volumes[-6:-1]) / 5
    ratio = round(volumes[-1] / avg5, 2) if avg5 > 0 else None
    up = closes[-1] >= closes[-2]
    if ratio is None:
        state = "insufficient_data"
    elif ratio >= 1.5:
        state = "heavy_volume_up" if up else "heavy_volume_down"
    elif ratio <= 0.7:
        state = "shrink_up" if up else "shrink_pullback"
    else:
        state = "normal"
    return {"state": state, "vol_ratio_5d": ratio}


def _bias_points(bias: Optional[float]) -> int:
    if bias is None:
        return 10
    if -3 <= bias < 0:
        return 20  # 略低於 MA5：理想的回檔買點
    if 0 <= bias < 2:
        return 18
    if 2 <= bias < 5:
        return 14
    if bias >= 5:
        return 4  # 離 MA5 太遠，不追高
    if -5 <= bias < -3:
        return 14
    return 6


def score_trend(closes: List[float], volumes: List[float], partial_session: bool = False) -> Dict[str, Any]:
    """依日 K 收盤價與成交量算出 0–100 分與訊號。partial_session=True 表示最後一根是盤中未收完的 K 棒。"""
    ma5, ma10, ma20 = (_last(calculate_ma(closes, p)) for p in (5, 10, 20))
    close = closes[-1] if closes else None
    rsi14 = _last(calculate_rsi(closes, 14)) if len(closes) > 15 else None
    macd = calculate_macd(closes) if len(closes) >= 35 else {"dif": [], "signal": []}

    alignment = _alignment(ma5, ma10, ma20)
    macd_state = _macd_state(macd["dif"], macd["signal"])
    rsi_zone = _rsi_zone(rsi14)
    vol = _volume_state(volumes, closes, partial_session)
    bias = round((close - ma5) / ma5 * 100, 2) if close and ma5 else None
    near_ma5 = bool(close and ma5 and abs(close - ma5) / close * 100 <= 1.0)
    near_ma10 = bool(close and ma10 and abs(close - ma10) / close * 100 <= 1.5)

    breakdown = {
        "trend": TREND_POINTS[alignment],
        "bias": _bias_points(bias),
        "macd": MACD_POINTS[macd_state],
        "volume": VOLUME_POINTS[vol["state"]],
        "rsi": RSI_POINTS[rsi_zone],
        "support": 5 * near_ma5 + 5 * near_ma10,
    }
    total = sum(breakdown.values())

    bull = alignment in ("strong_bullish", "bullish")
    if total >= 75 and bull:
        signal = "STRONG_BUY"
    elif total >= 60 and (bull or alignment == "weak_bullish"):
        signal = "BUY"
    elif total >= 45:
        signal = "HOLD"
    elif total >= 30:
        signal = "WAIT"
    elif alignment in ("bearish", "strong_bearish"):
        signal = "STRONG_SELL"
    else:
        signal = "SELL"

    hard_rules = []
    if rsi14 is not None and rsi14 >= RSI_HARD_LIMIT:
        hard_rules.append(f"RSI14={round(rsi14, 2)} ≥ {RSI_HARD_LIMIT:g}（超買），不給買進訊號")
    if bias is not None and bias > BIAS_HARD_LIMIT:
        hard_rules.append(f"距 MA5 乖離 {bias}% > {BIAS_HARD_LIMIT:g}%，不追高")
    if hard_rules and signal in ("STRONG_BUY", "BUY"):
        signal = "HOLD"

    return {
        "total": total,
        "breakdown": breakdown,
        "signal": signal,
        "signal_label": SIGNALS[signal],
        "buy_blocked": bool(hard_rules),
        "hard_rules": hard_rules,
        "details": {
            "alignment": alignment, "alignment_label": ALIGNMENT_LABELS[alignment],
            "macd_state": macd_state, "macd_label": LABELS[macd_state],
            "rsi14": round(rsi14, 2) if rsi14 is not None else None, "rsi_zone": rsi_zone,
            "rsi_label": LABELS[rsi_zone],
            "volume_state": vol["state"], "volume_label": LABELS[vol["state"]],
            "vol_ratio_5d": vol["vol_ratio_5d"],
            "bias_ma5_pct": bias,
            "MA5": ma5, "MA10": ma10, "MA20": ma20,
            "support_ma5": near_ma5, "support_ma10": near_ma10,
        },
    }
