"""大盤籌碼頁資料：台指期近月、產業排行與成交比重、三大法人加總、台灣 50 排名與量比、取不到資料的標示（離線，不連網）。"""

from datetime import date, timedelta
import unittest
from unittest.mock import patch

from src.market import market_board as mb


def _fresh():
    mb._CACHE.clear()


class FuturesTests(unittest.TestCase):
    def setUp(self):
        _fresh()

    def test_near_month_skips_spot_and_reads_both_sessions(self):
        def fake(url, timeout=8, body=None, **_):
            night = body["MarketType"] == "1"
            spot = {"SymbolID": "TXF-P" if night else "TXF-S", "DispCName": "臺指現貨", "CLastPrice": "47035.58"}
            near = {"SymbolID": "TXFK6-M" if night else "TXFK6-F", "DispCName": "臺指期116",
                    "CLastPrice": "47115.00" if night else "47244.00", "CRefPrice": "47249", "CDiff": "-134",
                    "CDiffRate": "-0.28", "CTotalVolume": "15905", "CDate": "20261028", "CTime": "224839"}
            return {"RtData": {"QuoteList": [spot, near]}}
        with patch.object(mb.qp, "_http_json", side_effect=fake):
            f = mb.tw_futures()
        self.assertEqual(f["day"]["price"], 47244.0)
        self.assertEqual(f["night"]["price"], 47115.0)
        self.assertEqual(f["night"]["quote_time"], "2026-10-28 22:48:39")
        self.assertEqual(f["night"]["change_pct"], -0.28)

    def test_failure_is_reported_not_faked(self):
        with patch.object(mb.qp, "_http_json", side_effect=OSError("timeout")):
            f = mb.tw_futures()
        self.assertIsNone(f["day"]["price"])
        self.assertIn("期交所行情取得失敗", f["day"]["error"])


class TwseDailyTests(unittest.TestCase):
    def setUp(self):
        _fresh()

    def _run(self, fn, pages):
        """pages：{(path 片段, 日期字串): payload}；沒列到的日期＝沒有交易。"""
        def fake(url, timeout=8, **_):
            for (frag, day), payload in pages.items():
                if frag in url and day in url:
                    return payload
            return {"stat": "很抱歉，沒有符合條件的資料!"}
        with patch.object(mb.qp, "_http_json", side_effect=fake), patch.object(mb, "TWSE_GAP_SEC", 0):
            return fn()

    def test_sectors_rank_share_and_ratio_skip_aggregates(self):
        d0 = date.today() - timedelta(days=1)  # 今天還沒收盤（沒有資料）→ 用昨天
        d1 = d0 - timedelta(days=3)
        k0, k1 = d0.strftime("%Y%m%d"), d1.strftime("%Y%m%d")
        idx = {"stat": "OK", "tables": [{"title": "價格指數(臺灣證券交易所)", "data": [
            ["發行量加權股價指數", "47,035.58", "+", "939", "2.04", ""],
            ["電子工業類指數", "2,938", "+", "71", "2.48", ""],
            ["半導體類指數", "1,564.79", "+", "34", "2.29", ""],
            ["航運業類指數", "200", "-", "1", "-0.50", ""],
        ]}]}
        amu0 = {"stat": "OK", "data": [["電子類指數", "1", "500", "1", "0"], ["半導體類指數", "1", "300", "1", "0"],
                                       ["航運業類指數", "1", "100", "1", "0"]]}
        amu1 = {"stat": "OK", "data": [["半導體類指數", "1", "150", "1", "0"], ["航運業類指數", "1", "200", "1", "0"]]}
        out = self._run(mb.sectors, {("MI_INDEX", k0): idx, ("BFIAMU", k0): amu0, ("BFIAMU", k1): amu1})
        self.assertEqual(out["date"], d0.isoformat())
        self.assertEqual([r["name"] for r in out["rows"]], ["半導體", "航運業"])  # 依漲跌排序、去掉大類與大盤
        semi, ship = out["rows"]
        self.assertEqual(semi["turnover_share_pct"], 75.0)
        self.assertEqual(semi["turnover_ratio"], 2.0)
        self.assertEqual(ship["turnover_ratio"], 0.5)

    def test_fund_flow_sums_dealer_and_foreign_in_hundred_millions(self):
        d0 = date.today()
        k0 = d0.strftime("%Y%m%d")
        page = {"stat": "OK", "data": [
            ["自營商(自行買賣)", "0", "0", "100,000,000"], ["自營商(避險)", "0", "0", "-300,000,000"],
            ["投信", "0", "0", "250,000,000"], ["外資及陸資(不含外資自營商)", "0", "0", "1,000,000,000"],
            ["外資自營商", "0", "0", "0"], ["合計", "0", "0", "1,050,000,000"]]}
        out = self._run(lambda: mb.fund_flow(days=1), {("BFI82U", k0): page})
        self.assertEqual(out["days"], [{"date": d0.isoformat(), "dealer": -2.0, "trust": 2.5, "foreign": 10.0,
                                        "total": 10.5}])

    def test_network_error_returns_message_and_is_not_cached(self):
        with patch.object(mb.qp, "_http_json", side_effect=OSError("down")), patch.object(mb, "TWSE_GAP_SEC", 0):
            out = mb.sectors()
        self.assertIn("取得失敗", out["error"])
        self.assertNotIn("sectors", mb._CACHE)


class Tw50Tests(unittest.TestCase):
    def setUp(self):
        _fresh()

    def test_rank_by_market_cap_live_price_and_volume_ratio(self):
        day_all = [
            {"Code": "2330", "Name": "台積電", "ClosingPrice": "1000", "Change": "10", "TradeVolume": "2000000", "Date": "1151027"},
            {"Code": "2317", "Name": "鴻海", "ClosingPrice": "200", "Change": "-2", "TradeVolume": "4000000", "Date": "1151027"},
            {"Code": "0050", "Name": "元大台灣50", "ClosingPrice": "70", "Change": "0", "TradeVolume": "1", "Date": "1151027"},
        ]
        reg = {"2330": {"已發行普通股數或TDR原股發行股數": "100"}, "2317": {"已發行普通股數或TDR原股發行股數": "1000"}}
        live = {"2317": {"z": "210", "y": "200", "v": "2000", "d": "20261028", "t": "10:00:00"}}
        with patch.object(mb.qp, "_http_json", return_value=day_all), \
                patch.object(mb.stock_info, "_company_registry", return_value=reg), \
                patch.object(mb, "_mis_quotes", return_value=live):
            out = mb.tw50()
        self.assertEqual([r["code"] for r in out["rows"]], ["2317", "2330"])  # 市值 200×1000 > 1000×100；ETF 不列
        hon, tsmc = out["rows"]
        self.assertTrue(hon["is_live"])
        self.assertEqual(hon["change_pct"], 5.0)
        self.assertEqual(hon["volume_ratio"], 0.5)  # 今日 2000 張 ÷ 前一日 4000 張
        self.assertFalse(tsmc["is_live"])  # 沒有即時價：用收盤資料並標示
        self.assertEqual(tsmc["quote_time"], "2026-10-27 收盤")
        self.assertIsNone(tsmc["volume_ratio"])
        self.assertEqual(out["live_count"], 1)


if __name__ == "__main__":
    unittest.main()
