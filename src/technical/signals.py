"""K 線買賣訊號標記（只用歷史 K 棒計算，離線、不連網）。

規則（買進；賣出為鏡像）：
1. 價格突破：收盤價 > 前 20 根 K 棒的最高價（不含當根）
2. MACD 確認：當根或前兩根出現金叉，或當根柱體 > 0 且比前一根放大
3. 震盪過濾：RSI(14) ≥ 80 時不標買進（賣出：RSI ≤ 20 不標，避免在極端超賣追殺）
同方向的訊號之間至少隔 COOLDOWN 根，避免連續標記。

規則依據（2026-11-07 查閱公開資料；這些是交易慣例，不是經過本系統回測驗證的結論）：
- 20 日高低點突破：Donchian 通道與海龜交易法 System 1（突破 20 日高點進場、跌破 10 日低點出場）。
  本系統的賣出標記是買進規則的鏡像（跌破 20 日低點），不是海龜的 10 日出場規則。
  https://www.luxalgo.com/library/concept/donchian-trend-rules/
- MACD 12／26／9 為預設參數；金叉＝MACD 線上穿訊號線；柱體（histogram）通常早於交叉改變方向，
  所以「紅柱放大」可視為較早的確認。https://www.investing.com/academy/analysis/how-to-use-rsi-and-macd-together
- RSI(14)：Wilder 原始門檻為 70／30；強勢趨勢中 RSI 可長時間停在 70 以上，實務上常放寬到 80／20，
  所以本系統用 80／20 當「極端過熱／超賣不追」的過濾，而不是 70／30。
  https://en.wikipedia.org/wiki/Relative_strength_index
- 20 根、同方向間隔 5 根、MACD 金叉看前兩根：本系統自訂的預設值，沒有找到公開標準。

歷史統計（tools/backtest_signals.py，2019-01-01 起 2330／2317／2454／2603／2881／0050／AAPL／NVDA／MSFT／SPY，
訊號隔日開盤進場、持有 N 根收盤出場、未含手續費與稅，2026-11-07 執行）：
- 買進訊號 5／10／20 日後上漲比例 58.6%／61.4%／63.4%（804／803／800 次），任一天進場為 55.5%／59.1%／62.7%；
  平均報酬 0.70%／1.63%／3.24% 對 0.58%／1.31%／2.85%。優勢很小，樣本期以多頭為主，不能當作有效策略的證據。
- 賣出訊號後 5／10／20 日下跌比例只有 45.7%／39.6%／35.2%，和任一天（42.8%／39.9%／36.5%）差不多；後續平均報酬仍為正，
  代表「跌破 20 日低點」在這批股票多半是短線震盪而非趨勢反轉。

限制：這是固定規則的歷史統計標記，不是預測；盤整行情容易頻繁出現假突破。
最後一根若是盤中尚未收完的 K 棒，標記會帶 confirmed=False，收盤後可能消失。
"""

from typing import Any, Dict, List

from src.market.bar import Bar
from src.technical.indicators import calculate_macd, calculate_rsi

BREAKOUT_LOOKBACK = 20
COOLDOWN = 5
RSI_BUY_MAX = 80
RSI_SELL_MIN = 20


def _cross(dif: List[Any], sig: List[Any], i: int, up: bool) -> bool:
    """第 i 根是否剛好 DIF 上穿（up）或下穿 Signal。"""
    if i < 1 or None in (dif[i], sig[i], dif[i - 1], sig[i - 1]):
        return False
    if up:
        return dif[i - 1] <= sig[i - 1] and dif[i] > sig[i]
    return dif[i - 1] >= sig[i - 1] and dif[i] < sig[i]


def compute_signals(bars: List[Bar], last_provisional: bool = False) -> List[Dict[str, Any]]:
    """回傳 [{index, date, type: 'buy'|'sell', reason, confirmed}]（依時間排序）。"""
    n = len(bars)
    if n < BREAKOUT_LOOKBACK + 2:
        return []
    closes = [b.close for b in bars]
    macd = calculate_macd(closes)
    dif, sig, hist = macd["dif"], macd["signal"], macd["hist"]
    rsi = calculate_rsi(closes, 14)

    out: List[Dict[str, Any]] = []
    last_at = {"buy": -10**9, "sell": -10**9}
    for i in range(BREAKOUT_LOOKBACK, n):
        window = bars[i - BREAKOUT_LOOKBACK:i]
        hi = max(b.high for b in window)
        lo = min(b.low for b in window)
        r = rsi[i]
        h, hp = hist[i], hist[i - 1]

        kind = None
        reason = ""
        if closes[i] > hi:
            golden = any(_cross(dif, sig, j, True) for j in (i, i - 1, i - 2))
            grow = h is not None and hp is not None and h > 0 and h > hp
            if (golden or grow) and (r is None or r < RSI_BUY_MAX):
                kind = "buy"
                reason = f"收盤突破近{BREAKOUT_LOOKBACK}日高點 {hi:g}，MACD {'金叉' if golden else '紅柱放大'}"
        elif closes[i] < lo:
            dead = any(_cross(dif, sig, j, False) for j in (i, i - 1, i - 2))
            shrink = h is not None and hp is not None and h < 0 and h < hp
            if (dead or shrink) and (r is None or r > RSI_SELL_MIN):
                kind = "sell"
                reason = f"收盤跌破近{BREAKOUT_LOOKBACK}日低點 {lo:g}，MACD {'死叉' if dead else '綠柱放大'}"

        if kind and i - last_at[kind] >= COOLDOWN:
            last_at[kind] = i
            out.append({
                "index": i,
                "date": bars[i].timestamp,
                "type": kind,
                "reason": reason,
                "confirmed": not (last_provisional and i == n - 1),
            })
    return out


def visible_signals(bars: List[Bar], first_date: str, last_provisional: bool = False):
    """給 API 用：回傳 (畫面上看得到的訊號, 錯誤訊息)。計算失敗不讓整個技術分析失敗，但要把原因帶回去讓畫面提示。"""
    try:
        sigs = [
            {k: v for k, v in s.items() if k != "index"}
            for s in compute_signals(bars, last_provisional=last_provisional)
            if first_date and s["date"] >= first_date
        ]
        return sigs, None
    except Exception as e:  # 輔助標記，不能拖垮主要分析
        return [], f"買賣訊號計算失敗：{e}"
