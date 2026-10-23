"""股市熱力圖資料：成交值／市值／持股市值換算台幣、分群、漲跌停、取不到資料的標示（離線，不連網）。"""

import unittest
from unittest.mock import patch

from src.market import heatmap


def _tw_quote(sym, price, pct, vol, name, lu=None, ld=None):
    return {"symbol": sym, "name": name, "currency": "TWD", "is_live": True, "price": price, "change_pct": pct,
            "volume": vol, "volume_unit": "張", "limit_up": lu, "limit_down": ld, "quote_time": "t", "error": None}


class HeatmapBuildTests(unittest.TestCase):
    def _build(self, pool, symbols=None, holdings=None, tw=(), v7=None, rates=None):
        tw_quotes = {q["symbol"]: q for q in tw}
        rates = rates or {"TWD": {"rate": 1.0}, "USD": {"rate": 32.0}}
        registry = {"2330": {"產業別": "24", "已發行普通股數或TDR原股發行股數": "1000"}}
        funds = {"0056": {"基金類型": "股票型", "發行單位數/轉換數": "500"}}
        with patch.object(heatmap.qp, "get_quotes", side_effect=lambda syms, _: [tw_quotes[s] for s in syms if s in tw_quotes]), \
                patch.object(heatmap, "_yahoo_batch", return_value=v7 or {}), \
                patch.object(heatmap.stock_info, "_company_registry", return_value=registry), \
                patch.object(heatmap.etf_data, "fund_registry", return_value=funds), \
                patch.object(heatmap.fx, "rates_to_twd", side_effect=lambda curs: {c: rates.get(c, {"rate": None}) for c in curs}):
            return heatmap.build(pool, symbols, holdings)

    def test_mine_pool_values_groups_and_limit_flags(self):
        tw = [_tw_quote("2330.TW", 100.0, 9.9, 2, "台積電", lu=100.0),
              _tw_quote("0056.TW", 30.0, -1.0, 10, "元大高股息"),
              _tw_quote("6488.TW", 500.0, -10.0, 1, "環球晶", ld=500.0)]
        v7 = {"NVDA": {"regularMarketPrice": 200.0, "regularMarketChangePercent": 1.234, "regularMarketVolume": 1000,
                       "currency": "USD", "shortName": "NVIDIA", "marketCap": 5000, "sector": "Technology",
                       "quoteType": "EQUITY"},
              "VTI": {"regularMarketPrice": 300.0, "regularMarketChangePercent": -0.5, "regularMarketVolume": 10,
                      "currency": "USD", "shortName": "Vanguard", "quoteType": "ETF"}}
        d = self._build("mine", ["2330", "0056", "6488", "NVDA", "VTI"], {"NVDA": 2, "2330": 10}, tw, v7)
        by = {i["code"]: i for i in d["items"]}
        self.assertEqual(by["2330"]["turnover_twd"], 100 * 2 * 1000)          # 1 張＝1000 股
        self.assertEqual(by["2330"]["market_cap_twd"], 1000 * 100)             # 已發行股數 × 現價
        self.assertEqual(by["2330"]["group"], "半導體")
        self.assertTrue(by["2330"]["limit_up"])
        self.assertTrue(by["6488"]["limit_down"])
        self.assertIsNone(by["6488"]["market_cap_twd"])                        # 上櫃：沒有公開股數，不猜
        self.assertIn("上櫃", by["6488"]["market_cap_note"])
        self.assertEqual(by["0056"]["group"], "台股 ETF")
        self.assertEqual(by["0056"]["market_cap_twd"], 500 * 30)
        self.assertEqual(by["NVDA"]["turnover_twd"], 200 * 1000 * 32)          # 美元換算台幣
        self.assertEqual(by["NVDA"]["market_cap_twd"], 5000 * 32)
        self.assertEqual(by["NVDA"]["holding_twd"], 2 * 200 * 32)
        self.assertEqual(by["NVDA"]["group"], "美股・科技")
        self.assertEqual(by["NVDA"]["change_pct"], 1.23)
        self.assertEqual(by["VTI"]["group"], "美股 ETF")
        self.assertIsNone(by["VTI"]["market_cap_twd"])
        self.assertEqual(by["2330"]["holding_twd"], 10 * 100)

    def test_builtin_pool_uses_fixed_groups_and_reports_missing_quotes(self):
        d = self._build("tw_hot", tw=[_tw_quote("2330.TW", 100.0, 1.0, 1, "台積電")])
        names = [g["name"] for g in d["groups"]]
        self.assertEqual(names[0], "半導體")
        self.assertIn("熱門 ETF", names)
        missing = [i for i in d["items"] if i["code"] != "2330"]
        self.assertTrue(all(i["change_pct"] is None and i["turnover_twd"] is None for i in missing))
        self.assertTrue(any("抓不到報價" in w for w in d["warnings"]))

    def test_v7_batch_failure_falls_back_to_per_symbol(self):
        fallback = {"symbol": "AAPL", "name": "Apple", "currency": "USD", "is_live": True, "price": 10.0,
                    "change_pct": 2.0, "volume": 5, "volume_unit": "股", "error": None}
        with patch.object(heatmap, "_yahoo_batch", return_value={}), \
                patch.object(heatmap.qp, "get_quotes", return_value=[fallback]) as gq, \
                patch.object(heatmap.fx, "rates_to_twd", return_value={"USD": {"rate": 30.0}}):
            d = heatmap.build("mine", ["AAPL"])
        gq.assert_called_once_with(["AAPL"], {})
        self.assertEqual(d["items"][0]["turnover_twd"], 10 * 5 * 30)
        self.assertEqual(d["items"][0]["market_cap_note"], "Yahoo 沒有回傳市值")

    def test_unknown_pool_rejected(self):
        with self.assertRaises(ValueError):
            heatmap.build("bogus")


if __name__ == "__main__":
    unittest.main()
