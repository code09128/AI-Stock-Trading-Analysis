"""新聞標題關鍵字語氣 vs 發布後第一個收盤的實際漲跌（需要連網）。

用法：python tools/backtest_news_tone.py
限制（重要）：免費新聞來源只保留近期（約數週）的標題，沒有多年的歷史標題可用，
所以這不是長期回測，只是「近期樣本的對照」；樣本數通常只有幾十則，統計意義很弱。
只看有提到該股的標題，且語氣為「偏多／偏空」者（中性不算）。
"""
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.market.data_adapter import DualMarketDataAdapter  # noqa: E402
from src.news import news_digest as nd  # noqa: E402
from src.news.news_feed import fetch_news  # noqa: E402

SYMBOLS = [("2330.TW", "台積電", "TW"), ("2317.TW", "鴻海", "TW"), ("2454.TW", "聯發科", "TW"),
           ("2603.TW", "長榮", "TW"), ("2881.TW", "富邦金", "TW"), ("AAPL", "Apple", "US"),
           ("NVDA", "Nvidia", "US"), ("MSFT", "Microsoft", "US"), ("TSLA", "Tesla", "US")]


def main():
    ad = DualMarketDataAdapter()
    rows = []
    for sym, name, market in SYMBOLS:
        try:
            news = fetch_news(sym, name)
            bars = ad.fetch_bars(sym, 120)["bars"] if isinstance(ad.fetch_bars(sym, 120), dict) else ad.fetch_bars(sym, 120)
        except Exception as e:
            print(f"{sym}: 失敗略過（{e}）")
            continue
        for it in news.get("items", []):
            if it["kind"] == nd.COLUMN_KIND or not nd._mentions(it["title"], sym, name):
                continue
            s, _ = nd.rule_sentiment(f"{it['title']} {it.get('detail', '')}")
            r = nd.price_reaction(bars, it["local_iso"], market)
            if s != "NEUTRAL" and r and not r.get("pending"):
                rows.append((s, r["pct"]))
        print(f"{sym}: 累計樣本 {len(rows)}")
    for label, key, good in (("偏多", "POSITIVE", lambda p: p > 0), ("偏空", "NEGATIVE", lambda p: p < 0)):
        xs = [p for s, p in rows if s == key]
        if not xs:
            print(f"{label}：樣本不足")
            continue
        print(f"{label}標題 {len(xs)} 則：發布後首個收盤 方向相符 {sum(good(p) for p in xs) / len(xs):.0%}，平均 {statistics.mean(xs):+.2f}%")
    print("判讀：偏多標題的平均應為正、偏空為負；樣本很少時不能下結論。")


if __name__ == "__main__":
    main()
