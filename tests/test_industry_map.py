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

    def test_also_sectors_are_validated_and_listed_on_those_hubs(self):
        layout = [["半導體", "汽車", "水泥"]]
        also = lambda *x: "；".join(im.validate([_chain(also=list(x))], layout, []))  # noqa: E731
        self.assertEqual(also("汽車"), "")
        self.assertIn("also 的產業別「不存在」不在 LAYOUT", also("不存在"))
        self.assertIn("also 不要重複主要產業別", also("半導體"))
        im._CACHE.clear()
        daily = {"date": "2026-11-03", "rows": []}
        with patch.object(im.market_board, "sector_index_live", return_value={}), patch.object(im.market_board, "sectors", return_value=daily):
            hubs = {h["name"]: h for h in im.overview()["hubs"]}
        self.assertEqual(hubs["數位雲端"]["chains"], ["cloud", "game"])      # 合併進「資訊與雲端服務」
        self.assertEqual(hubs["資訊服務"]["chains"], ["cloud"])
        self.assertEqual(hubs["橡膠"]["chains"], ["chem"])
        self.assertEqual(hubs["玻璃陶瓷"]["chains"], ["glass"])        # 沒有 also 的照舊

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
        net = next(c for c in chain_data.CHAINS if c["id"] == "net")
        total = {n["id"]: len(n["stocks"]) for n in net["nodes"]}  # 個股數隨資料增減，不寫死
        nic = d["nodes"]["nic"]
        self.assertEqual(nic["change_pct"], round((2.0 * 1e10 - 1.0 * 1e9) / 1.1e10, 2))
        self.assertEqual((nic["n_ok"], nic["n_total"]), (2, total["nic"]))
        opt = d["nodes"]["opt"]
        self.assertEqual((opt["change_pct"], opt["n_ok"], opt["n_total"]), (None, 0, total["opt"]))   # 一檔都沒有：None，不補 0
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


class UsChainTests(unittest.TestCase):
    """美股產業鏈：資料結構、不跟台股混在一起、類股 ETF 漲跌與成交金額（單位是股，不乘 1000）。"""

    def setUp(self):
        im._CACHE.clear()

    def test_real_us_definition_is_valid_and_ids_do_not_clash(self):
        from src.market import chain_data_us as us
        self.assertEqual(im.validate(market="US"), [])
        self.assertFalse({c["id"] for c in us.CHAINS} & {c["id"] for c in chain_data.CHAINS})
        self.assertEqual(set(us.SECTOR_ETF), {n for col in us.LAYOUT for n in col})  # 每個類股都有代表它的 ETF
        for c in us.CHAINS:
            used = {n["id"] for n in c["nodes"]}
            linked = {x for e in c["edges"] for x in e}
            self.assertEqual(used - linked, set(), f"{c['id']} 有孤立環節")

    def test_us_code_format_and_tw_code_not_accepted(self):
        bad = _chain(nodes=[{"id": "a", "name": "A", "stage": 0, "stocks": [("2330", "台積電")]},
                            {"id": "b", "name": "B", "stage": 1, "stocks": [("BRK-B", "波克夏")]}])
        self.assertIn("代號格式不對：2330", "；".join(im.validate([bad], [["半導體"]], [], market="US")))
        ok = _chain(nodes=[{"id": "a", "name": "A", "stage": 0, "stocks": [("NVDA", "輝達")]},
                           {"id": "b", "name": "B", "stage": 1, "stocks": [("BRK-B", "波克夏")]}])
        self.assertEqual(im.validate([ok], [["半導體"]], [], market="US"), [])
        self.assertIn("代號格式不對：NVDA", "；".join(im.validate([ok], [["半導體"]], [], market="TW")))

    def test_unknown_market_is_a_user_error(self):
        h = MarketDataHandlers()
        with self.assertRaises(ValueError):
            h.handle_chain_detail({"id": "us_semi", "market": "JP"})
        with self.assertRaises(ValueError):
            im.get_chain("semi", "US")  # 台股的鏈代號在美股查不到

    def test_overview_uses_sector_etf_quotes(self):
        def fake(symbols, names):
            return [{"symbol": s, "is_live": s != "XLE", "change_pct": 1.5 if s == "XLK" else -0.5, "price": 100.0,
                     "volume": 1000.0, "quote_time": "2026-11-04 10:00:00"} for s in symbols]
        with patch.object(im.qp, "get_quotes", side_effect=fake):
            d = im.overview("US")
        hubs = {h["name"]: h for h in d["hubs"]}
        self.assertEqual(d["market"], "US")
        self.assertEqual((hubs["科技"]["change_pct"], hubs["科技"]["source"]), (1.5, "live"))
        self.assertIsNone(hubs["能源"]["change_pct"])  # 沒有即時報價：None，不補 0
        self.assertEqual(hubs["科技"]["chains"], ["us_semi", "us_ai"])
        self.assertAlmostEqual(sum(h["turnover_share_pct"] or 0 for h in d["hubs"]), 100, delta=1)
        self.assertEqual(d["errors"], [])

    def test_overview_reports_when_all_etfs_fail(self):
        with patch.object(im.qp, "get_quotes", side_effect=lambda s, n: [{"symbol": x, "is_live": False} for x in s]):
            d = im.overview("US")
        self.assertTrue(d["errors"])

    def test_detail_turnover_is_in_shares_and_cache_is_per_market(self):
        qs = {"NVDA": {"symbol": "NVDA", "is_live": True, "price": 100.0, "volume": 2000.0, "change_pct": 2.0, "name": "NVIDIA", "quote_time": "t"},
              "AMD": {"symbol": "AMD", "is_live": True, "price": 50.0, "volume": 1000.0, "change_pct": -1.0, "name": "AMD", "quote_time": "t"}}
        with patch.object(im.qp, "get_quotes", side_effect=lambda s, n: [qs.get(x) for x in s]):
            d = im.chain_detail("us_semi", "US")
        self.assertEqual(d["stocks"]["NVDA"]["turnover"], 200000)
        design = d["nodes"]["design"]
        self.assertEqual(design["change_pct"], round((2.0 * 200000 - 1.0 * 50000) / 250000, 2))
        self.assertEqual((design["n_ok"], design["n_total"]), (2, 6))
        self.assertIn("Yahoo", d["source"])


class RealDataQualityTests(unittest.TestCase):
    """真實的 chain_data.py 的品質守門（離線）：補新鏈時最容易漏的地方。"""

    def test_every_node_is_connected(self):
        for ch in chain_data.CHAINS:
            touched = {e[0] for e in ch["edges"]} | {e[1] for e in ch["edges"]}
            self.assertEqual([n["id"] for n in ch["nodes"] if n["id"] not in touched], [], f"{ch['id']} 有孤立環節")

    def test_nodes_are_reasonably_sized(self):
        for ch in chain_data.CHAINS:
            for n in ch["nodes"]:
                self.assertTrue(1 <= len(n["stocks"]) <= 15, f"{ch['id']}/{n['id']} 個股數 {len(n['stocks'])}")

    def test_chain_ids_and_names_are_unique(self):
        ids = [c["id"] for c in chain_data.CHAINS]
        names = [c["name"] for c in chain_data.CHAINS]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(len(names), len(set(names)))

    def test_every_chain_sector_is_a_layout_sector(self):
        sectors = {s for col in chain_data.LAYOUT for s in col}
        for ch in chain_data.CHAINS:
            self.assertIn(ch["sector"], sectors, ch["id"])

    def test_covers_the_agreed_industries(self):
        ids = {c["id"] for c in chain_data.CHAINS}
        self.assertTrue({"semi", "ship", "fin", "steel", "cement", "textile", "food", "auto", "bio"} <= ids)
        self.assertTrue({"echan", "cloud", "retail", "leisure", "energy", "glass", "chem", "game", "hardware"} <= ids)
        semi = next(c for c in chain_data.CHAINS if c["id"] == "semi")
        mem = next(n for n in semi["nodes"] if n["id"] == "memory")
        self.assertTrue({"2337", "2344", "2408"} <= {c for c, _ in mem["stocks"]})

    def test_version_is_a_date(self):
        import re
        self.assertRegex(chain_data.VERSION, r"^\d{4}-\d{2}-\d{2}$")


if __name__ == "__main__":
    unittest.main()
