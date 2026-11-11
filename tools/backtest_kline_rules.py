"""K 線收盤規則（src/technical/kline_rules.py）歷史統計（需要連網抓日 K；不寫入 data/）。

用法：python tools/backtest_kline_rules.py [起日 YYYY-MM-DD]
做法：訊號在收盤出現，以「下一根開盤價」成交。
      1. 多頭確認之後持有 N 根的報酬，和「任何一天進場」比較。
      2. 成對交易：多頭確認進場 → 出場訊號賣出；空頭確認放空 → 回補訊號買回。
限制：不含手續費、稅、滑價、融券成本；樣本只有下面這幾檔，不代表所有股票；過去統計不保證未來。
"""

import statistics
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.market.data_adapter import DualMarketDataAdapter  # noqa: E402
from src.technical.kline_rules import compute  # noqa: E402

SYMBOLS = ["2330.TW", "2317.TW", "2454.TW", "2603.TW", "2881.TW", "0050.TW", "AAPL", "NVDA", "MSFT", "SPY"]
HORIZONS = (5, 10, 20)


def forward(bars, i, h):
    if i + h >= len(bars) or not bars[i + 1].open:
        return None
    return bars[i + h].close / bars[i + 1].open - 1


def run(symbol, start):
    bars = DualMarketDataAdapter().fetch_period(symbol, start, datetime.now().strftime("%Y-%m-%d"))
    sigs = compute(bars)["signals"]
    res = {"bars": len(bars), "confirm": {h: [] for h in HORIZONS}, "base": {h: [] for h in HORIZONS},
           "long": [], "short": [], "hold_long": [], "warn": {h: [] for h in HORIZONS}}
    for i in range(len(bars)):
        for h in HORIZONS:
            r = forward(bars, i, h)
            if r is not None:
                res["base"][h].append(r)
    entry = None
    for s in sigs:
        i = s["index"]
        if i + 1 >= len(bars) or not bars[i + 1].open:
            continue
        px = bars[i + 1].open
        if s["label"] in ("多頭確認", "空頭確認"):
            entry = (s["label"], i + 1, px)
        elif s["label"] in ("出場", "回補") and entry:
            if entry[0] == "多頭確認":
                res["long"].append(px / entry[2] - 1)
                res["hold_long"].append(i + 1 - entry[1])
            else:
                res["short"].append(entry[2] / px - 1)
            entry = None
        key = {"多頭確認": "confirm", "轉弱觀察": "warn"}.get(s["label"])
        if key:
            for h in HORIZONS:
                r = forward(bars, i, h)
                if r is not None:
                    res[key][h].append(r)
    return res


def main():
    start = sys.argv[1] if len(sys.argv) > 1 else "2019-01-01"
    rows = []
    for sym in SYMBOLS:
        try:
            rows.append(run(sym, start))
            r = rows[-1]
            print(f"{sym}: {r['bars']} 根日 K，做多 {len(r['long'])} 筆、做空 {len(r['short'])} 筆")
        except Exception as e:  # 單檔失敗不中斷，但要列出來，樣本少了結論要打折
            print(f"{sym}: 抓不到或計算失敗，已略過（{e}）")
    print(f"\n區間 {start} 起；成交＝訊號隔日開盤；未含手續費稅\n")
    for key, label, up in (("confirm", "多頭確認之後", True), ("warn", "轉弱觀察之後", False)):
        print(f"【{label}持有 N 根】（基準＝任一天進場）")
        for h in HORIZONS:
            xs = [x for r in rows for x in r[key][h]]
            base = [x for r in rows for x in r["base"][h]]
            if not xs:
                print(f"{h:>3} 樣本不足")
                continue
            hit = (lambda v: v > 0) if up else (lambda v: v < 0)
            print(f"{h:>3} 次數 {len(xs):>5}  {'上漲' if up else '下跌'}比例 {sum(map(hit, xs)) / len(xs):.1%}"
                  f"（基準 {sum(map(hit, base)) / len(base):.1%}）  平均 {statistics.mean(xs):.2%}（基準 {statistics.mean(base):.2%}）")
        print()
    for key, label in (("long", "做多：多頭確認 → 出場"), ("short", "做空：空頭確認 → 回補")):
        xs = [x for r in rows for x in r[key]]
        if not xs:
            print(f"【{label}】樣本不足")
            continue
        wins = [x for x in xs if x > 0]
        losses = [x for x in xs if x <= 0]
        print(f"【{label}】{len(xs)} 筆  獲利比例 {len(wins) / len(xs):.1%}  每筆平均 {statistics.mean(xs):.2%}  中位數 {statistics.median(xs):.2%}")
        print(f"    賺的平均 {statistics.mean(wins) if wins else 0:.2%}  賠的平均 {statistics.mean(losses) if losses else 0:.2%}"
              f"  最大單筆獲利 {max(xs):.2%}  最大單筆虧損 {min(xs):.2%}")
    holds = [x for r in rows for x in r["hold_long"]]
    if holds:
        print(f"    做多平均持有 {statistics.mean(holds):.1f} 根，中位數 {statistics.median(holds):.0f} 根")


if __name__ == "__main__":
    main()
