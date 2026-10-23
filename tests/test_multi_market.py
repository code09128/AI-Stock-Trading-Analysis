"""多市場：代號判斷、幣別換算、交易時段、時區後備（離線，不連網）。"""

import unittest
from datetime import date, datetime, timedelta, timezone

from src.market import fx, markets
from src.market.data_adapter import DualMarketDataAdapter, is_partial_session
from src.market.market_calendar import trading_day
from src.news.news_strategy import NewsStrategyAnalyzer
from src.portfolio.portfolio_risk import PortfolioRiskManager
from src.market.tz import _FALLBACK


class SymbolTests(unittest.TestCase):
    def test_market_detection(self):
        cases = {"2330": "TW", "6488.TWO": "TW", "NVDA": "US", "BRK-B": "US", "0700.HK": "HK",
                 "7203.T": "JP", "005930.KS": "KR", "VOD.L": "UK", "600519.SS": "CN", "SAP.DE": "DE",
                 "SHOP.TO": "CA", "BHP.AX": "AU", "D05.SI": "SG"}
        for sym, mkt in cases.items():
            self.assertEqual(DualMarketDataAdapter.normalize_symbol(sym)["market"], mkt, sym)

    def test_hk_padding_and_keys_keep_suffix(self):
        n = DualMarketDataAdapter.normalize_symbol("700.hk")
        self.assertEqual((n["symbol"], n["raw_code"], n["currency"]), ("0700.HK", "0700.HK", "HKD"))
        # 日股 7203.T 與台股 7203 不可撞號
        self.assertNotEqual(DualMarketDataAdapter.normalize_symbol("7203.T")["raw_code"],
                            DualMarketDataAdapter.normalize_symbol("7203")["raw_code"])


class CurrencyTests(unittest.TestCase):
    def setUp(self):
        fx.clear_cache()
        for cur, rate in {"USD": 32.5, "HKD": 4.16, "JPY": 0.205, "KRW": 0.0246, "GBP": 43.75}.items():
            fx._CACHE[cur] = {"t": 9e18, "rate": rate}

    def tearDown(self):
        fx.clear_cache()

    def test_rates_and_pence(self):
        self.assertEqual(fx.rate_to_twd("TWD")["rate"], 1.0)
        self.assertAlmostEqual(fx.rate_to_twd("GBp")["rate"], 0.4375)

    def test_portfolio_values_each_currency(self):
        rows = [
            {"symbol": "2330", "market": "TW", "currency": "TWD", "shares": 1000, "price": 2400},
            {"symbol": "005930.KS", "market": "KR", "currency": "KRW", "shares": 100, "price": 213000},
            {"symbol": "VOD.L", "market": "UK", "currency": "GBp", "shares": 10000, "price": 118.6},
        ]
        for r in rows:
            r["fx_rate"] = fx.rate_to_twd(r["currency"])["rate"]
        w = PortfolioRiskManager(usd_twd_rate=32.5).calculate_portfolio_weights(rows)
        vals = {h["symbol"]: round(h["value_twd"]) for h in w["holdings"]}
        self.assertEqual(vals["005930.KS"], round(100 * 213000 * 0.0246))  # 約 52 萬，不是當成美元的 6.9 億
        self.assertEqual(vals["VOD.L"], round(10000 * 118.6 * 0.4375))  # 便士 → 英鎊 → 台幣

    def test_old_rows_without_fx_rate_still_work(self):
        w = PortfolioRiskManager(usd_twd_rate=30).calculate_portfolio_weights(
            [{"symbol": "NVDA", "market": "US", "shares": 10, "price": 100}])
        self.assertEqual(w["holdings"][0]["value_twd"], 30000)


class SessionTests(unittest.TestCase):
    def test_sessions_by_market(self):
        cases = [("HK", "12:30", "REGULAR"), ("HK", "09:00", "PRE"), ("JP", "15:40", "POST"),
                 ("UK", "07:59", "PRE"), ("US", "03:00", "POST"), ("TW", "10:00", "REGULAR")]
        for mkt, hm, want in cases:
            got = NewsStrategyAnalyzer(mkt).classify_market_session(f"2026-10-22T{hm}:00")
            self.assertEqual(got, want, (mkt, hm))

    def test_partial_session_uses_local_close(self):
        # 台北 14:00＝東京 15:00（未收盤 15:30）、香港 14:00（未收盤 16:00）、首爾 15:00（未收盤 15:30）
        now = datetime(2026, 10, 22, 6, 0, tzinfo=timezone.utc)
        self.assertTrue(is_partial_session("JP", "2026-10-22", now))
        self.assertTrue(is_partial_session("HK", "2026-10-22", now))
        self.assertFalse(is_partial_session("TW", "2026-10-22", now))  # 台股 13:30 已收

    def test_calendar_other_markets_weekend_only(self):
        self.assertEqual(trading_day("HK", date(2026, 10, 24))[0], False)
        ok, why = trading_day("JP", date(2027, 1, 4))
        self.assertTrue(ok)
        self.assertIn("只排除週末", why)


class TimezoneFallbackAllMarketsTests(unittest.TestCase):
    def test_every_market_zone_matches_zoneinfo(self):
        from zoneinfo import ZoneInfo

        for m in markets.MARKETS.values():
            ref, fb = ZoneInfo(m["tz"]), _FALLBACK[m["tz"]]
            t = datetime(2021, 1, 1, tzinfo=timezone.utc)
            while t.year < 2029:
                self.assertEqual(t.astimezone(fb).replace(tzinfo=None), t.astimezone(ref).replace(tzinfo=None),
                                 (m["tz"], t))
                t += timedelta(hours=11)


if __name__ == "__main__":
    unittest.main()
