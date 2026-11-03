"""產業鏈地圖：資料定義的結構檢查、全景（即時類股指數＋盤後備援）、環節加權漲跌、回放日報酬、輸入錯誤（離線，不連網）。"""

import unittest
from unittest.mock import patch

from src.market import chain_data, industry_map as im, market_board as mb
from src.market.bar import Bar
from src.server.handlers.market_data import MarketDataHandlers


def _chain(**over):
    base = {"id": "t", "name": "測試", "sector": "半導體", "blurb": "", "stages": ["上", "下"],
            "nodes": [{"id": "a", "name": "A", "stage": 0, "stocks": [("2330", "台積電")]},
                      {"id": "b", "name": "B", "stage": 1, "stocks": [("2317", "鴻海")]}],
            "edges": [("a", "b")]}
    base.update(over)
    return base


class DefinitionTests(unittest.TestCase):
    def test_real_definition_is_valid(self):
        self.assertEqual(im.validate(), [], "src/market/chain_data.py 有誤，請照訊息修改")
        self.assertGreaterEqual(len(chain_data.CHAINS), 10)
        d = im._definition()
        self.assertEqual({c["id"] for c in d["chains"]}, {c["id"] for c in chain_data.CHAINS})

    def test_validate_catches_each_mistake(self):
        layout, links = [["半導體", "汽車"]], []

        def problems(**over):
            return "；".join(im.validate([_chain(**over)], layout, links))

        self.assertEqual(im.validate([_chain()], layout, links), [])
        self.assertIn("鏈代號重複", "；".join(im.validate([_chain(), _chain()], layout, links)))
        self.assertIn("不在 LAYOUT", problems(sector="不存在的類股"))
        self.assertIn("指向不存在的環節", problems(edges=[("a", "zz")]))
        self.assertIn("要由前面的階段指向後面", problems(edges=[("b", "a")]))
        self.assertIn("代號格式不對", problems(nodes=[{"id": "a", "name": "A", "stage": 0, "stocks": [("ABC", "x")]},
                                                  {"id": "b", "name": "B", "stage": 1, "stocks": [("2317", "鴻海")]}]))
        self.assertIn("沒有個股", problems(nodes=[{"id": "a", "name": "A", "stage": 0, "stocks": []},
                                              {"id": "b", "name": "B", "stage": 1, "stocks": [("2317", "鴻海")]}]))
        self.assertIn("stage 要是", problems(nodes=[{"id": "a", "name": "A", "stage": 5, "stocks": [("2330", "台積電")]},
                                                {"id": "b", "name": "B", "stage": 1, "stocks": [("2317", "鴻海")]}]))
        self.assertIn("沒有任何環節", problems(stages=["上", "中", "下"]))
        self.assertIn("重複的個股", problems(nodes=[{"id": "a", "name": "A", "stage": 0, "stocks": [("2330", "台積電"), ("2330", "台積電")]},
                                               {"id": "b", "name": "B", "stage": 1, "stocks": [("2317", "鴻海")]}]))
        self.assertIn("環節代號重複", problems(nodes=[{"id": "a", "name": "A", "stage": 0, "stocks": [("2330", "台積電")]},
                                                  {"id": "a", "name": "B", "stage": 1, "stocks": [("2317", "鴻海")]}]))
        self.assertIn("個股要寫成", problems(nodes=[{"id": "a", "name": "A", "stage": 0, "stocks": [("2330",)]},
                                              {"id": "b", "name": "B", "stage": 1, "stocks": [("2317", "鴻海")]}]))
        self.assertIn("個股要寫成", problems(nodes=[{"id": "a", "name": "A", "stage": 0, "stocks": [("2330", "")]},
                                              {"id": "b", "name": "B", "stage": 1, "stocks": [("2317", "鴻海")]}]))
        self.assertIn("LINKS", "；".join(im.validate([_chain()], layout, [("半導體", "不存在")])))
        self.assertIn("重複的產業別", "；".join(im.validate([_chain()], [["半導體"], ["半導體"]], [])))

    def test_unknown_chain_is_a_user_error(self):
        for call in (lambda: im.get_chain("nope"), lambda: im.chain_detail("nope"), lambda: im.chain_history("nope")):
            with self.assertRaises(ValueError):
                call()
        h = MarketDataHandlers()
        with self.assertRaises(ValueError):
            h.handle_chain_detail({"id": ""})
        with self.assertRaises(ValueError):
            h.handle_chain_history({"id": "semi", "days": 999})

    def test_routes_registered(self):
        from src.server import api_server
        self.assertIn("/api/chains/map", api_server.GET_ROUTES)
        self.assertIn("/api/chains/detail", api_server.ROUTES)
        self.assertIn("/api/chains/history", api_server.ROUTES)


class SectorIndexLiveTests(unittest.TestCase):
    def setUp(self):
        mb._CACHE.clear()

    def test_parses_mis_and_skips_unusable_rows(self):
        rows = {
            "t24.tw": {"n": "半導體類指數", "z": "1446.44", "y": "1491.61", "d": "20261103", "t": "13:33:00"},
            "t07.tw": {"n": "化學生技醫療類指數", "z": "153.15", "y": "155.34"},   # 大類加總：不列入
            "t13.tw": {"n": "電子工業類指數", "z": "2678.03", "y": "2780.68"},      # 大類加總：不列入
            "t02.tw": {"n": "食品類指數", "z": "-", "y": "1966.67"},                # 開盤前還沒成交
            "t19.tw": {"z": "-"},                                                    # 查無的代號
            "t15.tw": {"n": "航運類指數", "z": "216.50", "y": "221.97", "d": "20261103", "t": "13:33:00"},
        }
        with patch.object(mb, "_mis_rows", return_value=rows):
            out = mb.sector_index_live()
        self.assertEqual(set(out), {"半導體", "航運"})
        self.assertEqual(out["半導體"]["change_pct"], -3.03)
        self.assertEqual(out["航運"]["quote_time"], "20261103 13:33:00")


class OverviewTests(unittest.TestCase):
    def setUp(self):
        im._CACHE.clear()

    def _run(self, live, daily):
        with patch.object(im.market_board, "sector_index_live", side_effect=live if isinstance(live, Exception) else None,
                          return_value=None if isinstance(live, Exception) else live), \
                patch.object(im.market_board, "sectors", return_value=daily):
            return im.overview()

    def test_live_preferred_daily_fallback_and_new_sector_appended(self):
        live = {"半導體": {"change_pct": -3.03, "quote_time": "20261103 13:33:00"}}
        daily = {"date": "2026-11-03", "rows": [
            {"name": "半導體", "change_pct": -1.0, "turnover_share_pct": 40.0},
            {"name": "數位雲端", "change_pct": -3.69, "turnover_share_pct": 0.1},
            {"name": "新類股", "change_pct": 1.5, "turnover_share_pct": 0.2}]}
        out = self._run(live, daily)
        hubs = {h["name"]: h for h in out["hubs"]}
        self.assertEqual((hubs["半導體"]["change_pct"], hubs["半導體"]["source"]), (-3.03, "live"))
        self.assertEqual(hubs["半導體"]["turnover_share_pct"], 40.0)
        self.assertEqual((hubs["數位雲端"]["change_pct"], hubs["數位雲端"]["source"], hubs["數位雲端"]["as_of"]), (-3.69, "daily", "2026-11-03"))
        self.assertEqual(hubs["新類股"]["col"], len(chain_data.LAYOUT) - 1)      # LAYOUT 沒收錄的新類股放最後一欄
        self.assertIsNone(hubs["水泥"]["change_pct"])                              # 兩邊都沒有：None，不補假值
        self.assertEqual(hubs["電子零組件"]["chains"], ["pcb", "passive"])          # 同一類股可以有好幾條鏈
        self.assertEqual(len(out["hubs"]), sum(len(c) for c in chain_data.LAYOUT) + 1)
        self.assertEqual(out["errors"], [])

    def test_live_failure_falls_back_and_reports(self):
        daily = {"date": "2026-11-03", "rows": [{"name": "半導體", "change_pct": -1.0}], "error": "證交所部分資料缺"}
        out = self._run(OSError("連不上"), daily)
        hub = next(h for h in out["hubs"] if h["name"] == "半導體")
        self.assertEqual((hub["change_pct"], hub["source"]), (-1.0, "daily"))
        self.assertTrue(any("即時類股指數取得失敗" in e for e in out["errors"]))
        self.assertIn("證交所部分資料缺", out["errors"])


def _quote(code, price, vol, pct, live=True):
    return {"symbol": code, "name": f"名{code}", "is_live": live, "price": price, "volume": vol, "change_pct": pct,
            "quote_time": "20261103 13:30:00", "error": None if live else "查無"}


class ChainDetailTests(unittest.TestCase):
    def setUp(self):
        im._CACHE.clear()

    def test_node_change_is_turnover_weighted_and_partial_failures_are_counted(self):
        qs = {"2454": _quote("2454", 1000, 10000, 2.0),   # 成交值 1e10
              "2379": _quote("2379", 500, 2000, -1.0),    # 成交值 1e9
              "3163": _quote("3163", 100, 100, None, live=False)}  # 沒報價

        def fake(symbols, names):
            return [qs.get(s) for s in symbols]

        with patch.object(im.qp, "get_quotes", side_effect=fake):
            d = im.chain_detail("net")
        nic = d["nodes"]["nic"]
        self.assertEqual(nic["change_pct"], round((2.0 * 1e10 - 1.0 * 1e9) / 1.1e10, 2))
        self.assertEqual((nic["n_ok"], nic["n_total"]), (2, 2))
        opt = d["nodes"]["opt"]
        self.assertEqual((opt["change_pct"], opt["n_ok"], opt["n_total"]), (None, 0, 3))   # 一檔都沒有：None，不補 0
        self.assertFalse(d["stocks"]["3163"]["ok"])
        self.assertEqual(d["stocks"]["2454"]["turnover"], 1000 * 10000 * 1000)
        self.assertEqual(d["stocks"]["2454"]["name"], "名2454")
        self.assertEqual(d["summary"]["n_ok"], 2)
        self.assertIsNone(d["error"])

    def test_all_failed_reports_error(self):
        with patch.object(im.qp, "get_quotes", side_effect=lambda s, n: [_quote(x, 0, 0, None, live=False) for x in s]):
            d = im.chain_detail("net")
        self.assertIsNone(d["summary"]["change_pct"])
        self.assertIn("都沒有取得報價", d["error"])

    def test_equal_weight_when_no_turnover(self):
        qs = {"2454": _quote("2454", 1000, 0, 2.0), "2379": _quote("2379", 500, 0, 4.0)}
        with patch.object(im.qp, "get_quotes", side_effect=lambda s, n: [qs.get(x) for x in s]):
            d = im.chain_detail("net")
        self.assertEqual(d["nodes"]["nic"]["change_pct"], 3.0)


class ChainHistoryTests(unittest.TestCase):
    def setUp(self):
        im._CACHE.clear()

    def test_daily_returns_node_mean_and_missing(self):
        dates = ["2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"]

        def bars(closes):
            return [Bar(d, c, c, c, c, 1) for d, c in zip(dates, closes)]

        data = {"3034": bars([100, 110, 99, 99]), "3545": bars([50, 50, 55, 44])}

        def fake_first_bars(code, fetch, min_bars=1):
            return data.get(code)

        with patch.object(im.etf_data, "first_bars", side_effect=fake_first_bars):
            h = im.chain_history("display", 5)
        self.assertEqual(h["dates"], dates[1:])
        self.assertEqual(h["stocks"]["3034"], [10.0, -10.0, 0.0])
        self.assertEqual(h["stocks"]["3545"], [0.0, 10.0, -20.0])
        self.assertEqual(h["nodes"]["drv"], [5.0, 0.0, -10.0])      # 兩檔等權平均
        self.assertIn("6176", h["missing"])                          # 沒有日 K 的個股列出來
        self.assertEqual(h["nodes"]["bl"], [None, None, None])       # 整個環節都沒資料：None
        self.assertIsNone(h["error"])

    def test_not_enough_history(self):
        with patch.object(im.etf_data, "first_bars", return_value=None):
            h = im.chain_history("display", 5)
        self.assertIn("無法回放", h["error"])
        self.assertEqual(h["dates"], [])


if __name__ == "__main__":
    unittest.main()
