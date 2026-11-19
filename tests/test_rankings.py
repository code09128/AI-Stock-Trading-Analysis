"""探索榜單（src/market/rankings.py）：全部離線，資料來源用假資料。"""

import unittest
from datetime import datetime
from unittest import mock

from src.market import rankings
from src.market.tz import zone

TW50 = {"rows": [
    {"code": "2330", "name": "台積電", "price": 1000.0, "change": -10.0, "change_pct": -1.0, "volume": 30000, "industry": "半導體業"},
    {"code": "2454", "name": "聯發科", "price": 1500.0, "change": 75.0, "change_pct": 5.26, "volume": 8000, "industry": "半導體業"},
    {"code": "2317", "name": "鴻海", "price": 200.0, "change": 2.0, "change_pct": 1.01, "volume": 90000, "industry": "其他電子業"},
    {"code": "9999", "name": "沒報價", "price": None, "change": None, "change_pct": None, "volume": None, "industry": "其他"},
], "source": "測試"}


def _yq(sym, pct, rating="1.8 - Buy", price=100.0, vol=1000):
    return {"symbol": sym, "shortName": sym + " Inc", "regularMarketPrice": price, "regularMarketChange": pct,
            "regularMarketChangePercent": pct, "regularMarketVolume": vol, "averageAnalystRating": rating}


class RatingTests(unittest.TestCase):
    def test_parse(self):
        self.assertEqual(rankings.parse_rating("1.8 - Buy"), {"score": 1.8, "label": "買進"})
        self.assertEqual(rankings.parse_rating("1.3 - Strong Buy")["label"], "強力買進")
        self.assertEqual(rankings.parse_rating("3.1 - Hold")["label"], "持有")

    def test_bad_input_is_none(self):
        for v in (None, "", "Buy", "x - Buy", "2.0 - Unknown", 2.0):
            self.assertIsNone(rankings.parse_rating(v), v)


class UsOpenTests(unittest.TestCase):
    def test_hours(self):
        ny = zone("America/New_York")
        self.assertTrue(rankings.us_open(datetime(2026, 11, 18, 10, 0, tzinfo=ny)))  # 週三
        self.assertFalse(rankings.us_open(datetime(2026, 11, 18, 9, 29, tzinfo=ny)))
        self.assertFalse(rankings.us_open(datetime(2026, 11, 18, 16, 0, tzinfo=ny)))
        self.assertFalse(rankings.us_open(datetime(2026, 11, 21, 12, 0, tzinfo=ny)))  # 週六


class TwHotTests(unittest.TestCase):
    def setUp(self):
        rankings._CACHE.clear()
        self.p = mock.patch.object(rankings.market_board, "tw50", return_value=TW50)
        self.p.start()

    def tearDown(self):
        self.p.stop()

    def test_gain_lose_turn_order(self):
        gain = [r["symbol"] for r in rankings.ranking("TW", "gain")["rows"]]
        self.assertEqual(gain[:3], ["2454", "2317", "2330"])
        self.assertEqual(gain[-1], "9999")  # 沒報價的排最後，不會排到第一
        lose = [r["symbol"] for r in rankings.ranking("TW", "lose")["rows"]]
        self.assertEqual(lose[:3], ["2330", "2317", "2454"])
        turn = rankings.ranking("TW", "turn")["rows"]
        self.assertEqual(turn[0]["symbol"], "2330")  # 1000 × 30000 張
        self.assertEqual(turn[0]["turnover"], 1000 * 30000 * 1000)

    def test_meta(self):
        d = rankings.ranking("tw", "gain")
        self.assertEqual((d["market"], d["kind"], d["title"]), ("TW", "gain", "熱門升幅"))
        self.assertIn("市值前 50", d["note"])
        self.assertTrue(any(t["id"] == "semi" for t in d["themes"]))

    def test_tw50_error_raises(self):
        with mock.patch.object(rankings.market_board, "tw50", return_value={"rows": [], "error": "台灣 50 資料取得失敗：x"}):
            with self.assertRaises(RuntimeError):
                rankings.ranking("TW", "gain")


class UsTests(unittest.TestCase):
    def setUp(self):
        rankings._CACHE.clear()

    def test_screener_rows_and_one_request(self):
        payload = {"finance": {"result": [{"quotes": [_yq("AAA", 9.5), _yq("BBB", 7.0, rating=None)]}]}}
        with mock.patch.object(rankings, "_yahoo", return_value=payload) as y:
            d1 = rankings.ranking("US", "gain")
            d2 = rankings.ranking("US", "gain")  # 第二次走快取
        self.assertEqual(y.call_count, 1)
        self.assertIn("day_gainers", y.call_args[0][0])
        self.assertEqual(d1, d2)
        a, b = d1["rows"]
        self.assertEqual((a["symbol"], a["change_pct"], a["rating"]["label"]), ("AAA", 9.5, "買進"))
        self.assertIsNone(b["rating"])

    def test_theme_uses_one_batch_request_with_chinese_names(self):
        chain = rankings.industry_map.get_chain("us_semi", "US")
        codes = list(rankings.industry_map._codes(chain))
        payload = {"quoteResponse": {"result": [_yq(c, i - 3) for i, c in enumerate(codes)]}}
        with mock.patch.object(rankings, "_yahoo", return_value=payload) as y:
            d = rankings.ranking("US", "theme", "us_semi")
        self.assertEqual(y.call_count, 1)
        self.assertIn("v7/finance/quote", y.call_args[0][0])
        self.assertEqual(len(d["rows"]), len(codes))
        self.assertEqual(d["title"], "半導體")
        nvda = next(r for r in d["rows"] if r["symbol"] == "NVDA")
        self.assertEqual(nvda["name"], "輝達")
        pcts = [r["change_pct"] for r in d["rows"]]
        self.assertEqual(pcts, sorted(pcts, reverse=True))


class TwThemeTests(unittest.TestCase):
    def test_uses_chain_detail_cache(self):
        detail = {"stocks": {"2330": {"code": "2330", "name": "台積電", "price": 1000.0, "change_pct": -1.0, "turnover": 5},
                             "2303": {"code": "2303", "name": "聯電", "price": 50.0, "change_pct": 2.0, "turnover": 3},
                             "6770": {"code": "6770", "name": "力積電", "price": None, "change_pct": None, "turnover": None}},
                  "source": "測試"}
        with mock.patch.object(rankings.industry_map, "chain_detail", return_value=detail) as cd:
            d = rankings.ranking("TW", "theme", "semi")
        cd.assert_called_once_with("semi", "TW")
        self.assertEqual([r["symbol"] for r in d["rows"]], ["2303", "2330"])  # 沒價格的不列


class ThemeListTests(unittest.TestCase):
    def test_empty_theme_returns_list_without_fetching(self):
        with mock.patch.object(rankings.industry_map, "chain_detail") as cd, mock.patch.object(rankings, "_yahoo") as y:
            d = rankings.ranking("US", "theme", "")
        cd.assert_not_called()
        y.assert_not_called()
        self.assertEqual(d["rows"], [])
        self.assertTrue(any(t["id"] == "us_semi" for t in d["themes"]))


class ValidationTests(unittest.TestCase):
    def test_bad_args(self):
        with self.assertRaises(ValueError):
            rankings.ranking("HK", "gain")
        with self.assertRaises(ValueError):
            rankings.ranking("TW", "best")
        with self.assertRaises(ValueError):
            rankings.ranking("TW", "theme", "no_such_chain")


if __name__ == "__main__":
    unittest.main()
