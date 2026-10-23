"""日 K 聚合成週 K 與週線指標摘要。"""

from typing import Dict, Any, List
from datetime import datetime

from src.market.bar import Bar
from src.technical.indicators import calculate_ma


def to_weekly_bars(daily: List[Bar]) -> List[Bar]:
    """把還權日 K 聚合成週 K：開=週第一根開盤、高低=週內極值、收=週最後一根收盤、量=週總量；時間標記為該週最後一個交易日。"""
    weeks: Dict[Any, List[Bar]] = {}
    for b in daily:
        y, w, _ = datetime.strptime(b.timestamp, "%Y-%m-%d").isocalendar()
        weeks.setdefault((y, w), []).append(b)
    out = []
    for key in sorted(weeks):
        g = weeks[key]
        out.append(Bar(timestamp=g[-1].timestamp, open=g[0].open, high=max(x.high for x in g),
                       low=min(x.low for x in g), close=g[-1].close, volume=sum(x.volume for x in g)))
    return out


def weekly_summary(wbars: List[Bar]) -> Dict[str, Any]:
    """週線指標摘要（程式算好，不讓 AI 心算）。"""
    closes = [b.close for b in wbars]
    from src.technical.indicators import calculate_macd, calculate_rsi
    ma = {n: calculate_ma(closes, n)[-1] for n in (5, 20, 60)}
    macd = calculate_macd(closes)
    last = closes[-1]
    return {
        "weeks": len(wbars),
        "last_week_close": last,
        "MA5": ma[5], "MA20": ma[20], "MA60": ma[60],
        "RSI14": calculate_rsi(closes, 14)[-1],
        "MACD_HIST": macd["hist"][-1],
        "above_MA20": ma[20] is not None and last > ma[20],
        "trend_note": (
            "週線多頭排列（收盤>MA5>MA20）" if ma[5] and ma[20] and last > ma[5] > ma[20]
            else "週線空頭排列（收盤<MA5<MA20）" if ma[5] and ma[20] and last < ma[5] < ma[20]
            else "週線盤整／多空交錯"
        ),
    }
