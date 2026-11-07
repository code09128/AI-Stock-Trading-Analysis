"""盤中分 K 的純函式：報價取樣合成 K 棒、丟掉未收完的棒、布林通道與突破訊號。

限制（升級條件）：
- 台股 MIS 取樣的價格若沒有成交價（z 為 "-"），呼叫端傳入的是買賣中間價，K 棒的 high／low 會比實際
  成交範圍窄；要升級成逐筆資料才會準。
- 取樣間隔內的高低點抓不到，只能由取樣點構成；取樣越密越接近實際。
- 這裡不碰網路、不讀時鐘，全部由呼叫端傳入時間，方便離線測試。
"""

from typing import Dict, List, Optional, Tuple

from src.market.bar import Bar


class BarBuilder:
    """把 (時間戳秒, 價格, 當日累計量) 的取樣合成固定週期的 K 棒。

    量：每根棒的量 = 該棒最後一次累計量 − 前一根棒結束時的累計量（累計量變小視為新的一天，重新起算）。
    """

    def __init__(self, interval_sec: int):
        if interval_sec <= 0:
            raise ValueError("interval_sec 必須大於 0")
        self.interval = interval_sec
        self._bars: List[Dict] = []  # 每根：start, o, h, l, c, cum_end

    def feed(self, ts: float, price: Optional[float], cum_volume: Optional[float]) -> None:
        if price is None or price <= 0:
            return
        start = int(ts // self.interval) * self.interval
        cum = cum_volume if cum_volume is not None else (self._bars[-1]["cum_end"] if self._bars else 0.0)
        if self._bars and start < self._bars[-1]["start"]:
            return  # 亂序的舊取樣直接略過
        if self._bars and cum < self._bars[-1]["cum_end"]:
            self._bars.clear()  # 累計量倒退＝新的交易日
        if not self._bars or self._bars[-1]["start"] != start:
            self._bars.append({"start": start, "o": price, "h": price, "l": price, "c": price, "cum_end": cum})
            return
        b = self._bars[-1]
        b["h"] = max(b["h"], price)
        b["l"] = min(b["l"], price)
        b["c"] = price
        b["cum_end"] = cum

    def bars(self, now: float, include_open: bool = False) -> List[Bar]:
        """回傳已收完的棒；include_open=True 時附上進行中那根（只當暫定價位，別拿來算訊號）。"""
        out: List[Bar] = []
        prev_cum: Optional[float] = None
        for i, b in enumerate(self._bars):
            closed = b["start"] + self.interval <= now
            if i == 0:
                vol = 0.0  # 第一根缺少前一根的累計量，無法得知這根之前已成交多少，量記 0
            else:
                vol = max(0.0, b["cum_end"] - prev_cum)
            prev_cum = b["cum_end"]
            if closed or include_open:
                out.append(Bar(str(b["start"]), b["o"], b["h"], b["l"], b["c"], vol))
        return out


def closed_bars_only(rows: List[Tuple[int, float, float, float, float, float]], now: float, interval_sec: int) -> List[Bar]:
    """Yahoo 之類的 (ts, o, h, l, c, v) 分 K：去掉還沒收完的棒、缺值的棒，以及量為 0 的最後一根暫定棒。"""
    out: List[Bar] = []
    for ts, o, h, l, c, v in rows:
        if None in (o, h, l, c) or ts + interval_sec > now:
            continue
        out.append(Bar(str(ts), o, h, l, c, v or 0))
    while out and out[-1].volume == 0 and len(out) > 1:
        out.pop()  # 量為 0 的尾端棒是行情商附加的暫定價位
    return out


def bollinger(closes: List[float], period: int = 20, k: float = 2.0) -> List[Optional[Dict[str, float]]]:
    """布林通道（母體標準差）。資料不足 period 根的位置為 None。"""
    out: List[Optional[Dict[str, float]]] = []
    for i in range(len(closes)):
        if i + 1 < period:
            out.append(None)
            continue
        w = closes[i + 1 - period:i + 1]
        mid = sum(w) / period
        sd = (sum((x - mid) ** 2 for x in w) / period) ** 0.5
        up, lo = mid + k * sd, mid - k * sd
        out.append({"mid": mid, "upper": up, "lower": lo, "width": (up - lo) / mid if mid else 0.0})
    return out


def bollinger_signal(bars: List[Bar], period: int = 20, k: float = 2.0, squeeze_pct: float = 0.1) -> Optional[Dict]:
    """用最後一根『已收完』的棒判斷：突破上軌／跌破下軌／收回通道／通道收斂。資料不足回 None。

    squeeze_pct：通道寬度（上下軌差 ÷ 中軌）低於「近 period 根寬度的最小值 × (1+squeeze_pct)」視為收斂。
    """
    if len(bars) < period + 1:
        return None
    bb = bollinger([b.close for b in bars], period, k)
    cur, prev = bb[-1], bb[-2]
    if cur is None or prev is None:
        return None
    c, pc = bars[-1].close, bars[-2].close
    kind, text = "inside", "價格在通道內"
    if c > cur["upper"]:
        kind, text = "break_up", "收盤突破上軌（強勢，也可能過熱）"
    elif c < cur["lower"]:
        kind, text = "break_down", "收盤跌破下軌（弱勢，也可能超跌）"
    elif pc > prev["upper"] and c <= cur["upper"]:
        kind, text = "back_from_upper", "從上軌外收回通道內（留意回檔）"
    elif pc < prev["lower"] and c >= cur["lower"]:
        kind, text = "back_from_lower", "從下軌外收回通道內（留意反彈）"
    widths = [x["width"] for x in bb[-period:] if x]
    squeeze = bool(widths) and cur["width"] <= min(widths) * (1 + squeeze_pct)
    return {"kind": kind, "text": text, "squeeze": squeeze, **{n: round(cur[n], 4) for n in ("mid", "upper", "lower", "width")}, "close": c}
