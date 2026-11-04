"""台股名稱 → 代號查詢（離線）。"""

import unittest
from unittest.mock import patch

from src.market import symbol_search as ss
from src.server.handlers.market_data import MarketDataHandlers

DIR = [
    {"code": "2330", "name": "台積電", "full": "台灣積體電路製造股份有限公司"},
    {"code": "2303", "name": "聯電", "full": "聯華電子股份有限公司"},
    {"code": "3711", "name": "日月光投控", "full": "日月光投資控股股份有限公司"},
    {"code": "2301", "name": "光寶科", "full": "光寶科技股份有限公司"},
    {"code": "0050", "name": "元大台灣50", "full": "元大台灣卓越50證券投資信託基金"},
    {"code": "0056", "name": "元大高股息", "full": "元大台灣高股息證券投資信託基金"},
    {"code": "00878", "name": "國泰永續高股息", "full": "國泰台灣ESG永續高股息ETF證券投資信託基金"},
    {"code": "2330", "name": "台積電", "full": "重複的代號"},
    {"code": "6781", "name": "AES-KY", "full": "AES-KY股份有限公司"},
]


class SearchTests(unittest.TestCase):
    def setUp(self):
        p = patch.object(ss, "directory", return_value=DIR)
        p.start()
        self.addCleanup(p.stop)

    def test_exact_name_wins_and_is_marked(self):
        r = ss.search("台積電")
        self.assertEqual((r[0]["code"], r[0]["exact"]), ("2330", True))
        self.assertEqual(len([x for x in r if x["code"] == "2330"]), 1)  # 重複代號只留一筆

    def test_prefix_before_contains_before_full_name(self):
        self.assertEqual([x["code"] for x in ss.search("元大")], ["0056", "0050"])  # 簡稱開頭：短的在前
        self.assertEqual([x["code"] for x in ss.search("高股息")], ["0056", "00878"])  # 簡稱包含
        self.assertEqual(ss.search("積體電路")[0]["code"], "2330")  # 只出現在公司全名

    def test_spaces_and_case_ignored_and_no_match(self):
        self.assertEqual(ss.search(" 台 積 電 ")[0]["code"], "2330")
        self.assertEqual(ss.search("不存在的公司"), [])
        self.assertEqual(ss.search("   "), [])

    def test_looks_like_ticker(self):
        for t in ("2330", "NVDA", "BRK-B", "0700.HK", "00878"):
            self.assertTrue(ss.looks_like_ticker(t), t)
        for t in ("台積電", "台積電 2330", "元大50"):
            self.assertFalse(ss.looks_like_ticker(t), t)

    def test_handler_skips_lookup_for_tickers(self):
        h = MarketDataHandlers()
        for numeric in ("2330", "00878", "0700.HK"):  # 數字開頭一定是代號：不查名單
            r = h.handle_symbol_search({"query": numeric})
            self.assertEqual((r["matches"], r["is_ticker"]), ([], True))
        self.assertEqual(h.handle_symbol_search({"query": "NVDA"})["matches"], [])  # 英文開頭會查，但名單裡沒有
        aes = h.handle_symbol_search({"query": "aes-ky"})["matches"]  # 英文簡稱的台股：完全相符，前端會採用
        self.assertEqual((aes[0]["code"], aes[0]["exact"]), ("6781", True))
        self.assertEqual(h.handle_symbol_search({"query": "聯電"})["matches"][0]["code"], "2303")
        self.assertEqual(h.handle_symbol_search({})["matches"], [])

    def test_route_registered(self):
        from src.server import api_server
        self.assertIn("/api/symbol_search", api_server.ROUTES)


class DirectoryTests(unittest.TestCase):
    def test_one_failing_source_does_not_hide_the_others(self):
        from src.market import etf_data

        def fake(key, loader, ttl=0):
            if key == "dir_otc":
                raise OSError("down")
            return {"dir_listed": [{"公司代號": "2330", "公司簡稱": "台積電", "公司名稱": "台灣積體電路製造股份有限公司"}],
                    "dir_funds": [{"基金代號": "0050", "基金簡稱": "元大台灣50", "基金中文名稱": "x"}]}[key]
        with patch.object(etf_data, "_cached", side_effect=fake):
            codes = [r["code"] for r in ss.directory()]
        self.assertEqual(codes, ["2330", "0050"])


if __name__ == "__main__":
    unittest.main()
