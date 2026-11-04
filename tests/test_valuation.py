"""估值參考（src/company/valuation.py）：同業本益比分布、五級判斷、各種不適用情境。全部離線。"""

import unittest
from unittest.mock import patch

from src.company import valuation as v


def peers(n=20, start=10.0, step=1.0):
    return [start + i * step for i in range(n)]  # 10, 11, ..., 29


class JudgeTests(unittest.TestCase):
    def setUp(self):
        self.p = peers()
        self.stats = v.industry_stats(self.p)

    def verdict(self, pe):
        return v.judge(pe * 5, 5.0, self.stats, self.p)

    def test_five_levels_follow_the_percentile(self):
        self.assertEqual(self.verdict(10.5)["verdict"], "便宜")  # 比 1 家便宜 → 5%
        self.assertEqual(self.verdict(14.5)["verdict"], "偏便宜")  # 5 家 → 25%
        self.assertEqual(self.verdict(19.5)["verdict"], "合理")  # 10 家 → 50%
        self.assertEqual(self.verdict(24.5)["verdict"], "偏貴")  # 15 家 → 75%
        self.assertEqual(self.verdict(28.5)["verdict"], "貴")  # 19 家 → 95%

    def test_fair_range_is_eps_times_peer_percentiles(self):
        r = v.judge(100.0, 5.0, self.stats, self.p)
        self.assertAlmostEqual(r["fair_mid"], 5.0 * self.stats["median"], places=1)
        self.assertLess(r["fair_low"], r["fair_mid"])
        self.assertLess(r["fair_mid"], r["fair_high"])
        self.assertEqual(r["own_pe"], 20.0)

    def test_stats(self):
        s = v.industry_stats([10, 20, 30, 40])
        self.assertEqual((s["count"], s["median"]), (4, 25))
        self.assertLess(s["p25"], s["median"])


class AnalyzeTwTests(unittest.TestCase):
    def table(self, n=20):
        own = {"2330": ("24", 20.0, "上市")}
        dist = {"24": peers(n)}
        return {"own": own, "dist": dist}

    def run_tw(self, eps=5.0, n=20, yoy=None, price=100.0, official_pe=20.0, table=None):
        t = table or self.table(n)
        t["own"]["2330"] = ("24", official_pe, "上市")
        fund = {"quarterly": {"available": eps is not None, "ttm_eps": eps, "ttm_eps_yoy_pct": yoy,
                              "quarters": [{"quarter": f"2025Q{i}"} for i in (1, 2, 3, 4)]}}
        with patch.object(v, "_industry_table", return_value=t), \
             patch.object(v, "_last_close", return_value={"price": price, "date": "2026-11-04"}), \
             patch.object(v.fundamentals, "analyze", return_value=fund):
            return v.analyze_tw("2330.TW")

    def test_normal_case_gives_a_verdict_and_base_period(self):
        r = self.run_tw()
        self.assertTrue(r["supported"])
        self.assertIn(r["verdict"], ("便宜", "偏便宜", "合理", "偏貴", "貴"))
        self.assertEqual(r["base_period"]["quarters"], "2025Q1～2025Q4")
        self.assertEqual(r["industry"], "半導體")

    def test_loss_making_company_gets_no_verdict(self):
        r = self.run_tw(eps=-1.2)
        self.assertIsNone(r["verdict"])
        self.assertIn("虧損", r["reason"])

    def test_too_few_peers_gives_no_verdict(self):
        r = self.run_tw(n=v.MIN_PEERS - 1)
        self.assertIsNone(r["verdict"])
        self.assertIn("樣本太少", r["reason"])

    def test_big_eps_changes_are_flagged_as_base_effect(self):
        self.assertTrue(any("基期偏低" in n for n in self.run_tw(yoy=60)["notes"]))
        self.assertTrue(any("基期降低" in n for n in self.run_tw(yoy=-50)["notes"]))
        self.assertFalse(any("基期" in n for n in self.run_tw(yoy=5)["notes"]))

    def test_falls_back_to_official_pe_when_financials_missing(self):
        t = self.table()
        t["own"]["2330"] = ("24", 20.0, "上市")
        with patch.object(v, "_industry_table", return_value=t), \
             patch.object(v, "_last_close", return_value={"price": 100.0, "date": "2026-11-04"}), \
             patch.object(v.fundamentals, "analyze", side_effect=RuntimeError("FinMind 額度用完")):
            r = v.analyze_tw("2330.TW")
        self.assertEqual(r["eps"], 5.0)  # 100 ÷ 20
        self.assertIn("反推", r["eps_source"])

    def test_unknown_industry_is_unsupported(self):
        with patch.object(v, "_industry_table", return_value={"own": {}, "dist": {}}):
            self.assertFalse(v.analyze_tw("9999.TW")["supported"])

    def test_price_failure_is_reported_not_raised(self):
        with patch.object(v, "_industry_table", return_value=self.table()), \
             patch.object(v, "_last_close", side_effect=RuntimeError("網路")):
            r = v.analyze_tw("2330.TW")
        self.assertFalse(r["supported"])
        self.assertIn("股價", r["reason"])


class RobustnessTests(unittest.TestCase):
    def test_ttm_eps_requires_four_consecutive_quarters(self):
        from src.company import fundamentals as f

        ok = ["2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31"]
        self.assertTrue(f._consecutive(ok))
        self.assertFalse(f._consecutive(["2025-03-31", "2025-09-30", "2025-12-31", "2026-03-31"]))  # 少了 2025Q2
        self.assertTrue(f._consecutive(["2025-09-30", "2025-12-31", "2026-03-31", "2026-06-30"]))  # 跨年也算連續

    def test_tw_quarters_with_a_gap_has_no_ttm(self):
        from src.company import fundamentals as f

        dates = ["2024-12-31", "2025-03-31", "2025-09-30", "2025-12-31", "2026-03-31"]  # 缺 2025-06-30
        rows = [{"date": d, "type": "EPS", "value": "2"} for d in dates]
        with patch.object(f.finmind, "get_data", return_value=rows):
            r = f._tw_quarters("2330")
        self.assertTrue(r["available"])
        self.assertIsNone(r["ttm_eps"])

    def test_missing_otc_data_is_reported_not_misleading(self):
        t = {"own": {"2330": ("24", 20.0, "上市")}, "dist": {"24": peers()}, "otc_ok": False}
        with patch.object(v, "_industry_table", return_value=t),              patch.object(v, "_last_close", return_value={"price": 100.0, "date": "x"}),              patch.object(v.fundamentals, "analyze", side_effect=RuntimeError("x")):
            r = v.analyze_tw("2330.TW")
        self.assertTrue(any("上櫃公司資料暫時取不到" in n for n in r["notes"]))
        t2 = {"own": {}, "dist": {}, "otc_ok": False}
        with patch.object(v, "_industry_table", return_value=t2):
            self.assertIn("上櫃公司資料暫時取不到", v.analyze_tw("6488.TWO")["reason"])


class TableTests(unittest.TestCase):
    def test_non_positive_blank_and_outlier_pe_are_excluded_from_distribution(self):
        listed_ind = {"1101": {"產業別": "01"}, "1102": {"產業別": "01"}, "1103": {"產業別": "01"}, "1104": {"產業別": "01"}}
        listed_pe = {"1101": {"PEratio": "12.5"}, "1102": {"PEratio": "0"}, "1103": {"PEratio": ""}, "1104": {"PEratio": "999"}}
        with patch.object(v.stock_info, "_company_registry", return_value=listed_ind), \
             patch.object(v.stock_info, "_valuation", return_value=listed_pe), \
             patch.object(v, "_otc_industry", return_value={"6488": "01"}), \
             patch.object(v, "_otc_pe", return_value={"6488": 30.0}):
            t = v._industry_table()
        self.assertEqual(sorted(t["dist"]["01"]), [12.5, 30.0])  # 上市＋上櫃合併，0／空白／離群值不算
        self.assertEqual(t["own"]["6488"][2], "上櫃")


class JudgeUsTests(unittest.TestCase):
    def test_premium_maps_to_the_same_five_levels(self):
        # ETF 本益比 20、EPS 5：現價 100＝本益比 20＝溢價 0%
        for price, verdict in ((60, "便宜"), (80, "偏便宜"), (100, "合理"), (120, "偏貴"), (140, "貴")):
            self.assertEqual(v.judge_us(price, 5.0, 20.0)["verdict"], verdict, price)

    def test_fair_range_is_plus_minus_ten_percent_of_eps_times_etf_pe(self):
        r = v.judge_us(100.0, 5.0, 20.0)
        self.assertEqual((r["fair_low"], r["fair_mid"], r["fair_high"]), (90.0, 100.0, 110.0))
        self.assertEqual(r["gauge"], 50)

    def test_gauge_is_clamped(self):
        self.assertEqual(v.judge_us(1000.0, 1.0, 20.0)["gauge"], 100)
        self.assertEqual(v.judge_us(1.0, 5.0, 20.0)["gauge"], 0)


class AnalyzeUsTests(unittest.TestCase):
    STOCK = {"sector": "Technology", "price": 120.0, "eps": 5.0, "forward_eps": 6.0, "trailing_pe": 24.0, "forward_pe": 20.0,
             "earnings_growth_pct": 10.0}

    def run_us(self, stock=None, etf_pe=20.0):
        with patch.object(v, "_us_stock", return_value=stock if stock is not None else dict(self.STOCK)),              patch.object(v, "_etf_pe", return_value=etf_pe):
            return v.analyze_us("AAPL")

    def test_normal_case_uses_the_sector_etf(self):
        r = self.run_us()
        self.assertEqual(r["benchmark"]["etf"], "XLK")
        self.assertEqual(r["verdict"], "偏貴")
        self.assertTrue(any("前瞻本益比" in n for n in r["notes"]))

    def test_loss_unknown_sector_and_missing_data(self):
        self.assertIsNone(self.run_us(stock={**self.STOCK, "eps": -2.0})["verdict"])
        self.assertFalse(self.run_us(stock={**self.STOCK, "sector": None})["supported"])
        self.assertIsNone(self.run_us(etf_pe=None)["verdict"])

    def test_fetch_failure_is_reported(self):
        with patch.object(v, "_us_stock", return_value=None):
            self.assertFalse(v.analyze_us("AAPL")["supported"])

    def test_big_recent_earnings_change_is_flagged(self):
        self.assertTrue(any("基期" in n for n in self.run_us(stock={**self.STOCK, "earnings_growth_pct": 128.0})["notes"]))

    def test_every_yahoo_sector_maps_to_a_distinct_etf(self):
        etfs = [e for e, _ in v.YAHOO_SECTOR_ETF.values()]
        self.assertEqual(len(etfs), 11)
        self.assertEqual(len(set(etfs)), 11)


class RoutingTests(unittest.TestCase):
    def test_etf_is_not_supported_and_markets_are_routed(self):
        with patch.object(v.stock_info, "classify", return_value={"category": "ETF", "market": "TW"}):
            self.assertFalse(v.analyze("0050.TW")["supported"])
        with patch.object(v.stock_info, "classify", return_value={"category": "STOCK", "market": "US"}),              patch.object(v, "analyze_us", return_value={"market": "US"}) as us:
            self.assertEqual(v.analyze("AAPL"), {"market": "US"})
        us.assert_called_once()
        with patch.object(v.stock_info, "classify", return_value={"category": "STOCK", "market": "HK"}):
            self.assertFalse(v.analyze("0700.HK")["supported"])

    def test_brief_is_empty_when_there_is_no_verdict(self):
        with patch.object(v, "analyze", return_value={"supported": True, "verdict": None}):
            self.assertEqual(v.brief("2330.TW"), "")
        with patch.object(v, "analyze", side_effect=RuntimeError("x")):
            self.assertEqual(v.brief("2330.TW"), "")


if __name__ == "__main__":
    unittest.main()
