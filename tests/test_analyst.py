"""分析師共識（src/company/analyst.py）：全部離線，Yahoo 回應用假資料。"""

import time
import unittest
from unittest import mock

from src.company import analyst

NOW = time.time()


def _yahoo(history=True, target=True):
    r = {"recommendationTrend": {"trend": [
        {"period": "0m", "strongBuy": 11, "buy": 34, "hold": 15, "sell": 2, "strongSell": 0},
        {"period": "-1m", "strongBuy": 10, "buy": 49, "hold": 2, "sell": 1, "strongSell": 0},
        {"period": "-3m", "strongBuy": 9, "buy": 48, "hold": 2, "sell": 1, "strongSell": 0},
    ]}}
    if target:
        r["financialData"] = {"currentPrice": {"raw": 150.0}, "targetLowPrice": {"raw": 130.0}, "targetMeanPrice": {"raw": 240.0},
                              "targetMedianPrice": {"raw": 235.0}, "targetHighPrice": {"raw": 425.0},
                              "numberOfAnalystOpinions": {"raw": 55}, "recommendationMean": {"raw": 1.79032},
                              "recommendationKey": "buy", "financialCurrency": "USD"}
    if history:
        r["upgradeDowngradeHistory"] = {"history": [
            {"epochGradeDate": NOW - 86400, "firm": "A Bank", "toGrade": "Buy", "fromGrade": "Buy", "action": "main",
             "priceTargetAction": "Lowers", "currentPriceTarget": 230.0, "priorPriceTarget": 305.0},
            {"epochGradeDate": NOW - 2 * 86400, "firm": "B Sec", "toGrade": "Underperform", "fromGrade": "Neutral", "action": "down",
             "priceTargetAction": "Lowers", "currentPriceTarget": 0, "priorPriceTarget": 0},
            {"epochGradeDate": NOW - 200 * 86400, "firm": "Old", "toGrade": "Buy", "fromGrade": "Hold", "action": "up"},
        ]}
    return r


class GradeSideTests(unittest.TestCase):
    def test_sides(self):
        for g in ("Buy", "Strong Buy", "Overweight", "Outperform", "Market Outperform"):
            self.assertEqual(analyst.grade_side(g), "bull", g)
        for g in ("Underperform", "Underweight", "Sell", "Reduce"):
            self.assertEqual(analyst.grade_side(g), "bear", g)
        for g in ("Hold", "Neutral", "Equal-Weight", "Market Perform", ""):
            self.assertEqual(analyst.grade_side(g), "neutral", g)


class AnalyzeTests(unittest.TestCase):
    def setUp(self):
        analyst.etf_data._CACHE.clear()
        self.cls = mock.patch.object(analyst.stock_info, "classify",
                                     return_value={"symbol": "NVDA", "market": "US", "category": "STOCK"})
        self.cls.start()
        self.q = mock.patch.object(analyst.qp, "get_quotes", return_value=[{"price": 160.0}])
        self.q.start()

    def tearDown(self):
        self.cls.stop()
        self.q.stop()

    def test_full(self):
        with mock.patch.object(analyst.valuation, "_yahoo_summary", return_value=_yahoo()) as y:
            a = analyst.analyze("NVDA")
            analyst.analyze("NVDA")  # 第二次走快取
        self.assertEqual(y.call_count, 1)
        self.assertIn("recommendationTrend", y.call_args[0][1])
        self.assertTrue(a["supported"])
        self.assertEqual(a["target"]["count"], 55)
        self.assertEqual(a["price"], 160.0)  # 用即時報價，不是 Yahoo 資料裡的 150
        self.assertEqual(a["upside_pct"], 50.0)
        self.assertEqual(a["rating"], {"score": 1.79, "label": "買進"})
        self.assertEqual(a["trend"][0]["counts"]["買進"], 34)
        self.assertEqual(a["trend_change"], {"from_period": "-3m", "bull_now": 45, "bull_before": 57, "total_now": 62, "total_before": 60})
        self.assertEqual(len(a["history"]), 2)  # 200 天前的不列
        h0, h1 = a["history"]
        self.assertEqual((h0["action"], h0["target_action"], h0["target"], h0["prior_target"]), ("維持", "調低", 230.0, 305.0))
        self.assertEqual((h1["action"], h1["side"], h1["target"]), ("調降", "bear", None))  # 0＝沒給目標價

    def test_live_price_missing_falls_back(self):
        with mock.patch.object(analyst.qp, "get_quotes", side_effect=RuntimeError("x")), \
                mock.patch.object(analyst.valuation, "_yahoo_summary", return_value=_yahoo()):
            a = analyst.analyze("NVDA")
        self.assertEqual(a["price"], 150.0)

    def test_tw_without_history_and_tw_fallback(self):
        calls = []

        def fake(ysym, modules):
            calls.append(ysym)
            if ysym.endswith(".TW"):
                raise RuntimeError("404")
            return _yahoo(history=False)

        with mock.patch.object(analyst.stock_info, "classify", return_value={"symbol": "6488", "market": "TW", "category": "STOCK"}), \
                mock.patch.object(analyst.valuation, "_yahoo_summary", side_effect=fake):
            a = analyst.analyze("6488")
        self.assertEqual(calls, ["6488.TW", "6488.TWO"])
        self.assertTrue(a["supported"])
        self.assertEqual(a["history"], [])
        self.assertEqual(a["yahoo_symbol"], "6488.TWO")

    def test_no_data_is_cached_as_empty(self):
        with mock.patch.object(analyst.valuation, "_yahoo_summary", return_value={}) as y:
            a = analyst.analyze("NVDA")
            analyst.analyze("NVDA")
        self.assertFalse(a["supported"])
        self.assertIn("沒有分析師資料", a["reason"])
        self.assertEqual(y.call_count, 1)

    def test_network_failure_reason(self):
        with mock.patch.object(analyst.valuation, "_yahoo_summary", side_effect=RuntimeError("timeout")):
            a = analyst.analyze("NVDA")
        self.assertFalse(a["supported"])
        self.assertIn("暫時取不到", a["reason"])

    def test_etf_not_supported(self):
        with mock.patch.object(analyst.stock_info, "classify", return_value={"symbol": "0050", "market": "TW", "category": "ETF"}), \
                mock.patch.object(analyst.valuation, "_yahoo_summary") as y:
            a = analyst.analyze("0050")
        y.assert_not_called()
        self.assertFalse(a["supported"])

    def test_brief(self):
        with mock.patch.object(analyst.valuation, "_yahoo_summary", return_value=_yahoo()):
            b = analyst.brief("NVDA")
        self.assertIn("55 位分析師目標價 130.0～425.0", b)
        self.assertIn("+50.0%", b)
        self.assertIn("平均評等 買進", b)
        self.assertIn("57/60 → 45/62", b)
        self.assertIn("調降 1 次", b)

    def test_brief_empty_when_unsupported(self):
        with mock.patch.object(analyst.valuation, "_yahoo_summary", return_value={}):
            self.assertEqual(analyst.brief("NVDA"), "")


if __name__ == "__main__":
    unittest.main()
