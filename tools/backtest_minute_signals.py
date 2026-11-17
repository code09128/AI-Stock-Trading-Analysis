"""分 K（5／15／60 分）買賣訊號歷史統計：驗證日 K 的兩套規則搬到分 K 上有沒有優勢（需要連網；不寫入 data/）。

用法：python tools/backtest_minute_signals.py
規則：src/technical/signals.compute_signals（20 根突破）與 src/technical/kline_rules.compute（K 線收盤規則），
      兩者都只看 K 棒順序，不看日期，所以分 K 上的「20 日」「前一天低點」會變成「20 根」「前一根低點」。
做法：同 tools/backtest_signals.py、tools/backtest_kline_rules.py：訊號在收盤出現 → 下一根開盤價成交；
      1. 買／賣訊號之後持有 N 根的報酬，和「任何一根進場」比較；
      2. K 線收盤規則成對交易：多頭確認 → 出場、空頭確認 → 回補，另列扣掉來回成本後的結果。
資料：Yahoo 只給得到 5／15 分 K 約 60 天、60 分 K 約 2 年（只含已收完的棒）。
限制：樣本只有下面這幾檔；跨夜（收盤最後一根出訊號、隔天開盤成交）也算進去；
      成本只粗估：台股個股 0.47%（手續費 6 折來回＋證交稅 0.3%）、台股 ETF 0.27%（稅 0.1%）、美股 0.02%，
      不含滑價；當沖證交稅減半等優惠未計；過去統計不保證未來。
"""

import statistics
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.market import chart_data  # noqa: E402
from src.technical.intraday import closed_bars_only  # noqa: E402
from src.technical.kline_rules import compute as kline_compute  # noqa: E402
from src.technical.signals import compute_signals  # noqa: E402

SYMBOLS = ["2330.TW", "2317.TW", "2454.TW", "2603.TW", "2881.TW", "0050.TW", "AAPL", "NVDA", "MSFT", "SPY"]
RANGES = {5: "60d", 15: "60d", 60: "730d"}  # Yahoo 分 K 能抓到的最長區間
HORIZONS = (5, 10, 20)
COST = {"tw_stock": 0.0047, "tw_etf": 0.0027, "us": 0.0002}


def cost_of(sym):
    if sym.endswith(".TW"):
        return COST["tw_etf"] if sym.startswith("00") else COST["tw_stock"]
    return COST["us"]


def fetch(sym, interval):
    res = chart_data._chart(sym, f"{interval}m", RANGES[interval])
    q = (res.get("indicators", {}).get("quote") or [{}])[0]
    stamps = res.get("timestamp") or []
    rows = [
        (ts, q["open"][i], q["high"][i], q["low"][i], q["close"][i], q["volume"][i])
        for i, ts in enumerate(stamps) if i < len(q.get("close") or [])
    ]
    return closed_bars_only(rows, time.time(), interval * 60)


def forward(bars, i, h):
    if i + h >= len(bars) or not bars[i + 1].open:
        return None
    return bars[i + h].close / bars[i + 1].open - 1


def run(sym, interval):
    bars = fetch(sym, interval)
    res = {"bars": len(bars), "base": {h: [] for h in HORIZONS}, "buy": {h: [] for h in HORIZONS},
           "sell": {h: [] for h in HORIZONS}, "confirm": {h: [] for h in HORIZONS},
           "long": [], "short": [], "cost": cost_of(sym)}
    for i in range(len(bars)):
        for h in HORIZONS:
            r = forward(bars, i, h)
            if r is not None:
                res["base"][h].append(r)
    for s in compute_signals(bars):
        for h in HORIZONS:
            r = forward(bars, s["index"], h)
            if r is not None:
                res[s["type"]][h].append(r)
    entry = None
    for s in kline_compute(bars)["signals"]:
        i = s["index"]
        if i + 1 >= len(bars) or not bars[i + 1].open:
            continue
        px = bars[i + 1].open
        if s["label"] == "多頭確認":
            for h in HORIZONS:
                r = forward(bars, i, h)
                if r is not None:
                    res["confirm"][h].append(r)
        if s["label"] in ("多頭確認", "空頭確認"):
            entry = (s["label"], px)
        elif s["label"] in ("出場", "回補") and entry:
            r = px / entry[1] - 1 if entry[0] == "多頭確認" else entry[1] / px - 1
            res["long" if entry[0] == "多頭確認" else "short"].append((r, r - res["cost"]))
            entry = None
    return res


def report(interval, rows):
    print(f"\n========== {interval} 分 K（{sum(r['bars'] for r in rows)} 根，{len(rows)} 檔）==========")
    for key, label, up in (("buy", "20 根突破：買進訊號", True), ("sell", "20 根突破：賣出訊號", False),
                           ("confirm", "K 線收盤規則：多頭確認", True)):
        print(f"【{label}之後持有 N 根】（基準＝任一根進場）")
        for h in HORIZONS:
            xs = [x for r in rows for x in r[key][h]]
            base = [x for r in rows for x in r["base"][h]]
            if not xs:
                print(f"{h:>3} 根 樣本不足")
                continue
            hit = (lambda v: v > 0) if up else (lambda v: v < 0)
            print(f"{h:>3} 根 次數 {len(xs):>5}  {'上漲' if up else '下跌'}比例 {sum(map(hit, xs)) / len(xs):.1%}"
                  f"（基準 {sum(map(hit, base)) / len(base):.1%}）  平均 {statistics.mean(xs):+.3%}"
                  f"（基準 {statistics.mean(base):+.3%}）")
    for key, label in (("long", "K 線收盤規則 做多：多頭確認 → 出場"), ("short", "K 線收盤規則 做空：空頭確認 → 回補")):
        xs = [x for r in rows for x in r[key]]
        if not xs:
            print(f"【{label}】樣本不足")
            continue
        gross = [g for g, _ in xs]
        net = [n for _, n in xs]
        print(f"【{label}】{len(xs)} 筆  獲利比例 {sum(g > 0 for g in gross) / len(xs):.1%}"
              f"  每筆平均 {statistics.mean(gross):+.3%}  扣成本後 {statistics.mean(net):+.3%}"
              f"（扣成本後獲利比例 {sum(n > 0 for n in net) / len(xs):.1%}）")


def main():
    for interval in (5, 15, 60):
        rows = []
        for sym in SYMBOLS:
            try:
                rows.append(run(sym, interval))
            except Exception as e:  # 單檔失敗不中斷，但要列出來，樣本少了結論要打折
                print(f"{sym} {interval} 分：抓不到或計算失敗，已略過（{e}）")
        if rows:
            report(interval, rows)


if __name__ == "__main__":
    main()
