"""K 線買賣訊號歷史統計（需要連網抓日 K；不寫入 data/）。

用法：python tools/backtest_signals.py [起日 YYYY-MM-DD]
做法：對每檔股票逐根計算 src/technical/signals.compute_signals，訊號在收盤出現，
      以「下一根開盤價」進場、持有 N 根後的收盤價出場（不含手續費與稅），
      並和「任何一天隨機進場」的平均報酬比較，看訊號有沒有比亂買好。
限制：只是單純的前瞻報酬統計，不含停損、手續費、稅、滑價；樣本是下面這幾檔，不代表所有股票；
      過去統計不保證未來。買進訊號看「上漲比例／平均報酬」，賣出訊號看「下跌比例」（賣出標記後真的跌才算對）。
"""

import statistics
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.market.data_adapter import DualMarketDataAdapter  # noqa: E402
from src.technical.signals import compute_signals  # noqa: E402

SYMBOLS = ["2330.TW", "2317.TW", "2454.TW", "2603.TW", "2881.TW", "0050.TW", "AAPL", "NVDA", "MSFT", "SPY"]
HORIZONS = (5, 10, 20)


def forward_returns(bars, i, h):
    """第 i 根收盤出訊號 → 第 i+1 根開盤進場 → 第 i+h 根收盤出場；資料不夠回傳 None。"""
    if i + h >= len(bars):
        return None
    entry = bars[i + 1].open
    if not entry:
        return None
    return bars[i + h].close / entry - 1


def run(symbol, start):
    adapter = DualMarketDataAdapter()
    bars = adapter.fetch_period(symbol, start, datetime.now().strftime("%Y-%m-%d"))
    sigs = compute_signals(bars)
    res = {"symbol": symbol, "bars": len(bars), "buy": {h: [] for h in HORIZONS}, "sell": {h: [] for h in HORIZONS},
           "base": {h: [] for h in HORIZONS}}
    for i in range(len(bars)):
        for h in HORIZONS:
            r = forward_returns(bars, i, h)
            if r is not None:
                res["base"][h].append(r)
    for s in sigs:
        for h in HORIZONS:
            r = forward_returns(bars, s["index"], h)
            if r is not None:
                res[s["type"]][h].append(r)
    return res


def summarize(rows, kind):
    out = []
    for h in HORIZONS:
        xs = [r for res in rows for r in res[kind][h]]
        base = [r for res in rows for r in res["base"][h]]
        if not xs:
            out.append((h, 0, None, None, None, None))
            continue
        win = sum(1 for r in xs if (r > 0 if kind == "buy" else r < 0)) / len(xs)
        base_win = sum(1 for r in base if (r > 0 if kind == "buy" else r < 0)) / len(base)
        out.append((h, len(xs), win, statistics.mean(xs), statistics.median(xs), (base_win, statistics.mean(base))))
    return out


def main():
    start = sys.argv[1] if len(sys.argv) > 1 else "2019-01-01"
    rows = []
    for sym in SYMBOLS:
        try:
            rows.append(run(sym, start))
            print(f"{sym}: {rows[-1]['bars']} 根日 K，買進 {len(rows[-1]['buy'][5])} 次、賣出 {len(rows[-1]['sell'][5])} 次（5 日可計）")
        except Exception as e:  # 單檔失敗不中斷，但要列出來，樣本少了結論要打折
            print(f"{sym}: 抓不到或計算失敗，已略過（{e}）")
    print(f"\n區間 {start} 起；進場＝訊號隔日開盤；未含手續費稅；基準＝任一天進場\n")
    for kind, label, good in (("buy", "買進訊號", "上漲比例"), ("sell", "賣出訊號", "下跌比例")):
        print(f"【{label}】持有 N 根收盤出場")
        print(f"{'N':>3} {'次數':>6} {good:>8} {'平均報酬':>8} {'中位數':>8} | 基準{good:>8} 基準平均")
        for h, n, win, mean, med, base in summarize(rows, kind):
            if not n:
                print(f"{h:>3} {0:>6}   樣本不足")
                continue
            print(f"{h:>3} {n:>6} {win:>8.1%} {mean:>8.2%} {med:>8.2%} | {base[0]:>10.1%} {base[1]:>8.2%}")
        print()
    print("判讀：買進訊號要比基準的上漲比例與平均報酬明顯更高才算有優勢；賣出訊號要有更高的下跌比例、更負的平均報酬。")


if __name__ == "__main__":
    main()
