"""
指標計算模組 (indicators.py)
嚴格執行：在程式端算好所有技術指標，禁止讓 AI 心算。
包含：MA(5/20/60/200), RSI(14), MACD(12,26,9), ATR(14), 與 Swing High/Low 波段支撐壓力識別。
"""

from typing import List, Dict, Optional

def calculate_ma(prices: List[float], period: int) -> List[Optional[float]]:
    """
    計算簡單移動平均線 (SMA)。未滿 period 期間填入 None。
    """
    if period <= 0:
        raise ValueError("Period must be greater than 0")
    
    ma_list: List[Optional[float]] = []
    current_sum = 0.0
    for i, p in enumerate(prices):
        current_sum += p
        if i >= period:
            current_sum -= prices[i - period]
        if i >= period - 1:
            ma_list.append(round(current_sum / period, 4))
        else:
            ma_list.append(None)
    return ma_list

def calculate_rsi(prices: List[float], period: int = 14) -> List[Optional[float]]:
    """
    計算 Wilder's Smoothed RSI (標準 14 期)。
    與 TradingView / 券商軟體完全一致的平滑演算法。
    """
    if len(prices) <= period:
        return [None] * len(prices)

    deltas = [prices[i] - prices[i - 1] for i in range(1, len(prices))]
    rsi_list: List[Optional[float]] = [None] # 第 0 筆無 delta

    # 初始第 1~period 筆
    gains = [max(d, 0.0) for d in deltas[:period]]
    losses = [max(-d, 0.0) for d in deltas[:period]]

    avg_gain = sum(gains) / period
    avg_loss = sum(losses) / period

    for _ in range(period - 1):
        rsi_list.append(None)

    # 第一個 RSI
    if avg_loss == 0:
        first_rsi = 100.0
    else:
        rs = avg_gain / avg_loss
        first_rsi = 100.0 - (100.0 / (1.0 + rs))
    rsi_list.append(round(first_rsi, 2))

    # 後續使用 Wilder 平滑公式: avg = (prev_avg * 13 + current) / 14
    for i in range(period, len(deltas)):
        d = deltas[i]
        gain = max(d, 0.0)
        loss = max(-d, 0.0)
        avg_gain = (avg_gain * (period - 1) + gain) / period
        avg_loss = (avg_loss * (period - 1) + loss) / period

        if avg_loss == 0:
            rsi = 100.0
        else:
            rs = avg_gain / avg_loss
            rsi = 100.0 - (100.0 / (1.0 + rs))
        rsi_list.append(round(rsi, 2))

    return rsi_list

def calculate_ema(prices: List[float], period: int) -> List[Optional[float]]:
    """計算指數移動平均線 (EMA)"""
    if len(prices) < period:
        return [None] * len(prices)

    ema_list: List[Optional[float]] = [None] * (period - 1)
    k = 2.0 / (period + 1)
    
    # 第一個 EMA 採用前 period 筆的 SMA 作為種子
    initial_sma = sum(prices[:period]) / period
    ema_list.append(round(initial_sma, 4))
    prev_ema = initial_sma

    for i in range(period, len(prices)):
        val = (prices[i] * k) + (prev_ema * (1.0 - k))
        ema_list.append(round(val, 4))
        prev_ema = val

    return ema_list

def calculate_macd(
    prices: List[float], fast: int = 12, slow: int = 26, signal: int = 9
) -> Dict[str, List[Optional[float]]]:
    """
    計算 MACD 指標 (DIF, MACD Signal, Histogram)
    """
    fast_ema = calculate_ema(prices, fast)
    slow_ema = calculate_ema(prices, slow)

    dif_list: List[Optional[float]] = []
    for f, s in zip(fast_ema, slow_ema):
        if f is not None and s is not None:
            dif_list.append(round(f - s, 4))
        else:
            dif_list.append(None)

    # 對 valid dif 計算 signal ema
    valid_difs = [d for d in dif_list if d is not None]
    valid_signals = calculate_ema(valid_difs, signal)

    signal_list: List[Optional[float]] = []
    hist_list: List[Optional[float]] = []
    
    signal_idx = 0
    for d in dif_list:
        if d is None:
            signal_list.append(None)
            hist_list.append(None)
        else:
            sig = valid_signals[signal_idx]
            signal_list.append(sig)
            if sig is not None:
                hist_list.append(round((d - sig) * 2, 4)) # 一般習慣柱狀體取 2*(DIF-MACD) 或 DIF-MACD
            else:
                hist_list.append(None)
            signal_idx += 1

    return {
        "dif": dif_list,
        "signal": signal_list,
        "hist": hist_list
    }

def calculate_atr(
    highs: List[float], lows: List[float], closes: List[float], period: int = 14
) -> List[Optional[float]]:
    """
    計算 ATR (Average True Range 真實波動區間)
    """
    if len(highs) != len(lows) or len(highs) != len(closes):
        raise ValueError("High, Low, Close arrays must have equal length")
    if len(highs) < period:
        return [None] * len(highs)

    tr_list: List[float] = [highs[0] - lows[0]]
    for i in range(1, len(highs)):
        tr = max(
            highs[i] - lows[i],
            abs(highs[i] - closes[i - 1]),
            abs(lows[i] - closes[i - 1])
        )
        tr_list.append(tr)

    atr_list: List[Optional[float]] = [None] * (period - 1)
    initial_atr = sum(tr_list[:period]) / period
    atr_list.append(round(initial_atr, 4))
    prev_atr = initial_atr

    for i in range(period, len(tr_list)):
        val = (prev_atr * (period - 1) + tr_list[i]) / period
        atr_list.append(round(val, 4))
        prev_atr = val

    return atr_list

def find_swing_levels(
    highs: List[float], lows: List[float], window: int = 3
) -> Dict[str, List[float]]:
    """
    識別近期波段高點 (Swing High) 與低點 (Swing Low) 作為支撐與壓力位。
    window 為左右確認根數。
    """
    swing_highs: List[float] = []
    swing_lows: List[float] = []
    n = len(highs)

    for i in range(window, n - window):
        # 檢驗波段高點
        is_high = all(highs[i] >= highs[i - w] and highs[i] >= highs[i + w] for w in range(1, window + 1))
        if is_high:
            swing_highs.append(highs[i])

        # 檢驗波段低點
        is_low = all(lows[i] <= lows[i - w] and lows[i] <= lows[i + w] for w in range(1, window + 1))
        if is_low:
            swing_lows.append(lows[i])

    # 去重並排序
    unique_resistances = sorted(list(set(swing_highs)))
    unique_supports = sorted(list(set(swing_lows)))

    return {
        "resistances": unique_resistances,
        "supports": unique_supports
    }
