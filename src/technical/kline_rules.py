"""K 線收盤規則訊號（頭底趨勢＋前一天高低點），只用歷史 K 棒計算，離線、不連網。

和 signals.py 的「20 日突破＋MACD」是兩套獨立的規則，畫面上可以切換。

規則（常見的波段操作口訣，數字是本系統自訂的預設值，不是公開標準）：
1. 頭與底：一根 K 棒的最高價是前後各 PIVOT_SPAN 根裡最高的＝頭；最低價是最低的＝底。
   要等後面 PIVOT_SPAN 根走完才能確認，所以頭底的標示會晚幾根出現，但不會事後消失。
2. 趨勢：頭頭高、底底高＝多頭；頭頭低、底底低＝空頭；其他＝盤整。
3. 多頭確認（買）：手上沒有部位、最近的底比前一個底高，收盤往上突破最近的頭。
4. 出場（賣）：多頭確認之後，收盤跌破前一天的最低價。只看收盤，盤中跌破不算。
5. 空頭確認與回補：上面兩條的鏡像（底不過前高時收盤跌破最近的底；之後收盤突破前一天最高價回補）。
6. 轉弱觀察：股價創近 HIGH_LOOKBACK 根新高、成交量是前 5 根均量的 BIG_VOLUME_RATIO 倍以上，
   而且是長上影線或長實體（長紅、長黑）。只是提醒，隔天收盤跌破它的低點才會出場（第 4 條）。

限制：這是固定規則的標記，不是預測。「跌破前一天低點就出場」很敏感，強勢股常被洗出場後又創新高；
盤整行情會反覆出現確認又出場。歷史統計見 tools/backtest_signals.py（執行結果寫在說明頁）。
最後一根若是盤中尚未收完的 K 棒，標記會帶 confirmed=False，收盤後可能消失。
"""

from typing import Any, Dict, List, Optional

from src.market.bar import Bar

PIVOT_SPAN = 3
BIG_VOLUME_RATIO = 1.5
HIGH_LOOKBACK = 20
LONG_BODY_RATIO = 2.0  # 實體是前 10 根平均實體的幾倍算長紅／長黑
TREND_LABELS = {"bull": "多頭（頭頭高、底底高）", "bear": "空頭（頭頭低、底底低）", "range": "盤整（頭和底沒有一致方向）"}


def _pivot_at(bars: List[Bar], j: int) -> Optional[str]:
    """第 j 根是不是頭（'high'）或底（'low'）；前後不足 PIVOT_SPAN 根回傳 None。同價時取最早的那根。"""
    if j < PIVOT_SPAN or j + PIVOT_SPAN >= len(bars):
        return None
    before = bars[j - PIVOT_SPAN:j]
    after = bars[j + 1:j + PIVOT_SPAN + 1]
    if all(bars[j].high > b.high for b in before) and all(bars[j].high >= b.high for b in after):
        return "high"
    if all(bars[j].low < b.low for b in before) and all(bars[j].low <= b.low for b in after):
        return "low"
    return None


def _add_pivot(pivots: List[Dict[str, Any]], bars: List[Bar], j: int, kind: str) -> None:
    """頭和底要交替出現：連續兩個頭只留比較高的，連續兩個底只留比較低的。"""
    price = bars[j].high if kind == "high" else bars[j].low
    item = {"index": j, "date": bars[j].timestamp, "kind": kind, "price": price}
    if pivots and pivots[-1]["kind"] == kind:
        better = price > pivots[-1]["price"] if kind == "high" else price < pivots[-1]["price"]
        if better:
            pivots[-1] = item
        return
    pivots.append(item)


def _last_two(pivots: List[Dict[str, Any]], kind: str) -> List[Dict[str, Any]]:
    return [p for p in pivots if p["kind"] == kind][-2:]


def trend_of(pivots: List[Dict[str, Any]]) -> str:
    highs, lows = _last_two(pivots, "high"), _last_two(pivots, "low")
    if len(highs) < 2 or len(lows) < 2:
        return "range"
    up_h, up_l = highs[1]["price"] > highs[0]["price"], lows[1]["price"] > lows[0]["price"]
    if up_h and up_l:
        return "bull"
    if not up_h and not up_l and highs[1]["price"] < highs[0]["price"] and lows[1]["price"] < lows[0]["price"]:
        return "bear"
    return "range"


def is_big_volume(bars: List[Bar], i: int) -> bool:
    """成交量是前 5 根均量的 BIG_VOLUME_RATIO 倍以上。"""
    if i < 5:
        return False
    avg = sum(b.volume for b in bars[i - 5:i]) / 5
    return avg > 0 and bars[i].volume >= avg * BIG_VOLUME_RATIO


def _weak_shape(bars: List[Bar], i: int) -> str:
    """高檔轉弱的 K 棒形狀：長上影線、長紅、長黑；都不是回傳空字串。"""
    b = bars[i]
    body = abs(b.close - b.open)
    upper = b.high - max(b.open, b.close)
    span = b.high - b.low
    if span > 0 and upper >= body * 2 and upper >= span * 0.4:
        return "長上影線"
    prev = [abs(x.close - x.open) for x in bars[max(0, i - 10):i]]
    avg = sum(prev) / len(prev) if prev else 0
    if avg > 0 and body >= avg * LONG_BODY_RATIO:
        return "長紅" if b.close >= b.open else "長黑"
    return ""


def compute(bars: List[Bar], last_provisional: bool = False) -> Dict[str, Any]:
    """回傳 {signals, pivots, big_volume, trend, trend_label}；signals 每筆含 index, date, type, label, reason, confirmed。

    type：'buy'（多頭確認、回補）、'sell'（出場、空頭確認）、'warn'（轉弱觀察）。
    """
    n = len(bars)
    pivots: List[Dict[str, Any]] = []
    signals: List[Dict[str, Any]] = []
    big_volume: List[str] = []
    pos: Optional[str] = None
    warn_at = -1

    def add(i: int, kind: str, label: str, reason: str) -> None:
        signals.append({
            "index": i, "date": bars[i].timestamp, "type": kind, "label": label, "reason": reason,
            "confirmed": not (last_provisional and i == n - 1),
        })

    for i in range(1, n):
        j = i - PIVOT_SPAN  # 這一根收完，才能確認 j 是不是頭或底
        kind = _pivot_at(bars, j) if j >= 0 else None
        if kind:
            _add_pivot(pivots, bars, j, kind)

        b, prev = bars[i], bars[i - 1]
        big = is_big_volume(bars, i)
        if big:
            big_volume.append(b.timestamp)
        vol_note = "，成交量放大" if big else ""
        highs, lows = _last_two(pivots, "high"), _last_two(pivots, "low")

        if pos == "long":
            if b.close < prev.low:
                extra = "（前一根是高檔大量轉弱 K 棒）" if warn_at == i - 1 else ""
                add(i, "sell", "出場", f"收盤 {b.close:g} 跌破前一天低點 {prev.low:g}{extra}")
                pos = None
        elif pos == "short":
            if b.close > prev.high:
                add(i, "buy", "回補", f"收盤 {b.close:g} 突破前一天高點 {prev.high:g}")
                pos = None
        elif highs and len(lows) == 2 and lows[1]["price"] > lows[0]["price"] \
                and b.close > highs[-1]["price"] >= prev.close:
            add(i, "buy", "多頭確認", f"底不破前低，收盤 {b.close:g} 突破前一個頭 {highs[-1]['price']:g}{vol_note}")
            pos = "long"
        elif lows and len(highs) == 2 and highs[1]["price"] < highs[0]["price"] \
                and b.close < lows[-1]["price"] <= prev.close:
            add(i, "sell", "空頭確認", f"頭不過前高，收盤 {b.close:g} 跌破前一個底 {lows[-1]['price']:g}{vol_note}")
            pos = "short"

        # 轉弱觀察：只提醒，不改變部位；同一根已經有買賣標記就不重複標
        if big and i >= HIGH_LOOKBACK and b.high >= max(x.high for x in bars[i - HIGH_LOOKBACK:i]):
            shape = _weak_shape(bars, i)
            if shape:
                warn_at = i
                if not (signals and signals[-1]["index"] == i):
                    add(i, "warn", "轉弱觀察", f"創近 {HIGH_LOOKBACK} 根新高且成交量放大，出現{shape}；隔天收盤跌破低點 {b.low:g} 就是轉弱")

    trend = trend_of(pivots)
    return {
        "signals": signals,
        "pivots": pivots,
        "big_volume": big_volume,
        "trend": trend,
        "trend_label": TREND_LABELS[trend],
        "position": pos,
    }


def visible(bars: List[Bar], first_date: str, last_provisional: bool = False):
    """給 API 用：回傳 (畫面上看得到的那段結果, 錯誤訊息)。計算失敗不讓整個技術分析失敗，但要把原因帶回去讓畫面提示。"""
    try:
        res = compute(bars, last_provisional=last_provisional)
        keep = lambda d: bool(first_date) and d >= first_date  # noqa: E731
        res["signals"] = [{k: v for k, v in s.items() if k != "index"} for s in res["signals"] if keep(s["date"])]
        res["pivots"] = [{k: v for k, v in p.items() if k != "index"} for p in res["pivots"] if keep(p["date"])]
        res["big_volume"] = [d for d in res["big_volume"] if keep(d)]
        return res, None
    except Exception as e:  # 輔助標記，不能拖垮主要分析
        return {"signals": [], "pivots": [], "big_volume": [], "trend": "range", "trend_label": "", "position": None}, \
            f"K 線收盤規則計算失敗：{e}"
