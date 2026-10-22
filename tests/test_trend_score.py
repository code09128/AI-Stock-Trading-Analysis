"""100 分趨勢評分、嚴進規則、盤中判斷，以及 Yahoo 日 K 最新一根為 None 的補值（全部離線、不連網）。"""

import io
import json
import unittest
from datetime import datetime, timezone
from unittest.mock import patch

from src.data_adapter import DualMarketDataAdapter, clear_bar_cache, is_partial_session
from src.llm_runner import LLMRunner
from src.trend_score import score_trend


class TrendScoreTests(unittest.TestCase):
    def test_steady_uptrend_is_bullish_but_overbought_blocks_buy(self):
        closes = [100 + i for i in range(80)]
        r = score_trend(closes, [1000.0] * 80)
        self.assertEqual(r["details"]["alignment"], "bullish")
        self.assertTrue(r["buy_blocked"])  # 只漲不跌 → RSI=100
        self.assertNotIn(r["signal"], ("BUY", "STRONG_BUY"))
        self.assertEqual(sum(r["breakdown"].values()), r["total"])

    def test_chasing_far_above_ma5_is_blocked(self):
        closes = [100.0] * 60 + [100.0, 99.0, 100.0, 99.0, 112.0]
        r = score_trend(closes, [1000.0] * len(closes))
        self.assertGreater(r["details"]["bias_ma5_pct"], 5)
        self.assertTrue(any("乖離" in h for h in r["hard_rules"]))

    def test_downtrend_scores_low_and_sells(self):
        closes = [200 - i * 1.5 for i in range(80)]
        r = score_trend(closes, [1000.0] * 79 + [3000.0])
        self.assertIn(r["details"]["alignment"], ("bearish", "strong_bearish"))
        self.assertEqual(r["details"]["volume_state"], "heavy_volume_down")
        self.assertIn(r["signal"], ("SELL", "STRONG_SELL", "WAIT"))

    def test_partial_session_volume_is_neutral(self):
        closes = [100 + (i % 3) for i in range(60)]
        r = score_trend(closes, [1000.0] * 59 + [10.0], partial_session=True)
        self.assertEqual(r["details"]["volume_state"], "partial_session")
        self.assertEqual(r["breakdown"]["volume"], 8)

    def test_is_partial_session(self):
        tw_morning = datetime(2026, 10, 22, 2, 0, tzinfo=timezone.utc)  # 台北 10:00
        self.assertTrue(is_partial_session("TW", "2026-10-22", tw_morning))
        self.assertFalse(is_partial_session("TW", "2026-10-21", tw_morning))
        tw_evening = datetime(2026, 10, 22, 7, 0, tzinfo=timezone.utc)  # 台北 15:00
        self.assertFalse(is_partial_session("TW", "2026-10-22", tw_evening))

    def test_ai_buy_rejected_when_hard_rule_triggered(self):
        snap = {"market": "US", "trend_score": {"buy_blocked": True, "hard_rules": ["RSI14=85 ≥ 80（超買）"]}}
        p = {"action": "BUY", "order_type": "LIMIT", "entry_price": 100, "stop_loss_price": 95,
             "take_profit_target": 110, "invalidation_criteria": "收盤跌破 95 停損"}
        self.assertTrue(any("嚴進規則" in i for i in LLMRunner._sanity_issues(p, snap, "")))


def _yahoo_payload(last_close, meta_time):
    ts = [1760000000 + 86400 * i for i in range(25)]
    closes = [100.0 + i for i in range(24)] + [last_close]
    return {"chart": {"result": [{
        "meta": {"regularMarketPrice": 130.0, "regularMarketDayHigh": 131.0, "regularMarketDayLow": 120.0,
                 "regularMarketVolume": 5555, "regularMarketTime": meta_time(ts)},
        "timestamp": ts,
        "indicators": {"quote": [{"open": [c for c in closes[:-1]] + [None],
                                  "high": [c + 1 for c in closes[:-1]] + [None],
                                  "low": [c - 1 for c in closes[:-1]] + [None],
                                  "close": closes, "volume": [1000] * 24 + [None]}],
                       "adjclose": [{"adjclose": closes}]},
    }]}}


class _Resp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class YahooLatestBarTests(unittest.TestCase):
    def setUp(self):
        clear_bar_cache()

    def _bars(self, payload):
        with patch("urllib.request.urlopen", return_value=_Resp(json.dumps(payload).encode())):
            return DualMarketDataAdapter()._fetch_from_yahoo("NVDA", days=250)

    def test_none_latest_bar_is_filled_from_meta(self):
        bars = self._bars(_yahoo_payload(None, lambda ts: ts[-1] + 9 * 3600))
        self.assertEqual(len(bars), 25)
        self.assertEqual((bars[-1].close, bars[-1].high, bars[-1].low, bars[-1].volume), (130.0, 131.0, 120.0, 5555))

    def test_meta_older_than_bar_is_not_used(self):
        bars = self._bars(_yahoo_payload(None, lambda ts: ts[-2]))
        self.assertEqual(len(bars), 24)


if __name__ == "__main__":
    unittest.main()
