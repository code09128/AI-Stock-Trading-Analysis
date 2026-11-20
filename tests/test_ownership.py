"""美股持股結構與內部人交易（src/company/ownership.py）＋ SEC 識別字串格式檢查：全部離線。"""

import os
import shutil
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

from src.company import ownership
from src.server import env_settings

NOW = time.time()


def _t(days_ago, text, value, name="DOE JOHN", shares=1000):
    return {"startDate": {"raw": NOW - days_ago * 86400}, "transactionText": text, "value": {"raw": value},
            "shares": {"raw": shares}, "filerName": name, "filerRelation": "Director"}


YAHOO = {
    "majorHoldersBreakdown": {"insidersPercentHeld": {"raw": 0.0404}, "institutionsPercentHeld": {"raw": 0.71578},
                              "institutionsFloatPercentHeld": {"raw": 0.74589}, "institutionsCount": {"raw": 7806}},
    "institutionOwnership": {"ownershipList": [
        {"organization": "Blackrock Inc.", "pctHeld": {"raw": 0.0805}, "position": {"raw": 1940885915},
         "value": {"raw": 283330517579}, "pctChange": {"raw": -0.0005}, "reportDate": {"fmt": "2026-09-30"}}]},
    "netSharePurchaseActivity": {"period": "6m", "buyInfoCount": {"raw": 18}, "sellInfoCount": {"raw": 9},
                                 "netInfoShares": {"raw": -3585082}},
    "insiderTransactions": {"transactions": [
        _t(10, "Sale at price 219.72 - 220.42 per share.", 300147095),
        _t(20, "Purchase at price 100.00 per share.", 500000),
        *[_t(30 + i, "Stock Award(Grant) at price 0.00 per share.", 0) for i in range(20)],
        _t(40, "Stock Gift at price 0.00 per share.", 0),
        _t(400, "Sale at price 50 per share.", 99),  # 超過 180 天不列
    ]},
}


class ClassifyTests(unittest.TestCase):
    def test_kinds(self):
        self.assertEqual(ownership.classify("Sale at price 1 per share.")["kind"], "sell")
        self.assertEqual(ownership.classify("Purchase at price 1")["kind"], "buy")
        self.assertEqual(ownership.classify("Stock Award(Grant) at price 0.")["kind"], "award")
        self.assertEqual(ownership.classify("Stock Gift at price 0.00")["kind"], "gift")
        self.assertEqual(ownership.classify("Conversion of Exercise of derivative security")["kind"], "exercise")
        self.assertEqual(ownership.classify("")["kind"], "other")


class AnalyzeTests(unittest.TestCase):
    def setUp(self):
        ownership.etf_data._CACHE.clear()
        self.cls = mock.patch.object(ownership.stock_info, "classify",
                                     return_value={"symbol": "NVDA", "code": "NVDA", "market": "US", "category": "STOCK"})
        self.cls.start()

    def tearDown(self):
        self.cls.stop()

    def test_full(self):
        with mock.patch.object(ownership.valuation, "_yahoo_summary", return_value=YAHOO) as y:
            a = ownership.analyze("NVDA")
            ownership.analyze("NVDA")
        self.assertEqual(y.call_count, 1)
        self.assertTrue(a["supported"])
        self.assertEqual(a["breakdown"]["institutions_pct"], 71.58)
        self.assertEqual(a["holders"][0]["pct"], 8.05)
        self.assertEqual(a["holders"][0]["change_pct"], -0.05)
        s = a["insider_summary"]
        self.assertEqual((s["buy_count"], s["sell_count"], s["sell_value"]), (1, 1, 300147095))
        kinds = [t["kind"] for t in a["insider"]]
        self.assertEqual(len(kinds), ownership.INSIDER_MAX)
        self.assertIn("sell", kinds)  # 20 筆獎酬也不會把買賣擠掉
        self.assertIn("buy", kinds)
        dates = [t["date"] for t in a["insider"]]
        self.assertEqual(dates, sorted(dates, reverse=True))
        self.assertIn("CIK=NVDA", a["edgar_url"])

    def test_tw_and_etf_not_supported(self):
        with mock.patch.object(ownership.stock_info, "classify", return_value={"symbol": "2330.TW", "code": "2330", "market": "TW", "category": "STOCK"}), \
                mock.patch.object(ownership.valuation, "_yahoo_summary") as y:
            self.assertFalse(ownership.analyze("2330")["supported"])
        y.assert_not_called()
        with mock.patch.object(ownership.stock_info, "classify", return_value={"symbol": "SPY", "code": "SPY", "market": "US", "category": "ETF"}):
            self.assertFalse(ownership.analyze("SPY")["supported"])

    def test_empty_and_failure(self):
        with mock.patch.object(ownership.valuation, "_yahoo_summary", return_value={}):
            self.assertIn("沒有機構持股", ownership.analyze("NVDA")["reason"])
        ownership.etf_data._CACHE.clear()
        with mock.patch.object(ownership.valuation, "_yahoo_summary", side_effect=RuntimeError("x")):
            self.assertIn("暫時取不到", ownership.analyze("NVDA")["reason"])

    def test_brief(self):
        with mock.patch.object(ownership.valuation, "_yahoo_summary", return_value=YAHOO):
            b = ownership.brief("NVDA")
        self.assertIn("機構持股 71.58%（7806 家）", b)
        self.assertIn("Blackrock Inc. 8.05%", b)
        self.assertIn("賣出 1 筆（約 300.1 百萬美元）", b)


class SecUserAgentTests(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.p = mock.patch.object(env_settings, "get_app_dir", return_value=self.dir)
        self.p.start()
        self.old = os.environ.get("SEC_USER_AGENT")

    def tearDown(self):
        self.p.stop()
        if self.old is None:
            os.environ.pop("SEC_USER_AGENT", None)
        else:
            os.environ["SEC_USER_AGENT"] = self.old
        shutil.rmtree(self.dir, ignore_errors=True)

    def test_format(self):
        for bad in ("you@example.com", "Wang", "Wang you@example"):
            with self.assertRaises(ValueError):
                env_settings.save({"SEC_USER_AGENT": bad})
        env_settings.save({"SEC_USER_AGENT": "Wang you@example.com"})
        self.assertIn("SEC_USER_AGENT=Wang you@example.com", (self.dir / ".env").read_text(encoding="utf-8"))
        env_settings.save({"SEC_USER_AGENT": ""})  # 清除不檢查格式


if __name__ == "__main__":
    unittest.main()
