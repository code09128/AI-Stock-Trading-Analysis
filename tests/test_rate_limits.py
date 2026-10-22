"""FinMind 402/403 暫停與日 K 60 秒快取（離線，不連網）。"""

import io
import json
import unittest
import urllib.error
from unittest.mock import patch

from src import data_adapter, finmind
from src.data_adapter import DualMarketDataAdapter, clear_bar_cache


class _Resp(io.BytesIO):
    status = 200

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def _ok(payload):
    return lambda *a, **k: _Resp(json.dumps(payload).encode())


def _http_error(code):
    def raise_(*a, **k):
        raise urllib.error.HTTPError("https://api.finmindtrade.com", code, "limit", {}, None)
    return raise_


class FinMindPauseTests(unittest.TestCase):
    def setUp(self):
        finmind.reset_pause()

    def tearDown(self):
        finmind.reset_pause()

    def test_402_pauses_and_blocks_further_requests(self):
        with patch("urllib.request.urlopen", side_effect=_http_error(402)):
            with self.assertRaises(urllib.error.HTTPError):
                finmind.get_data("TaiwanStockPrice", "2330", "2026-10-01")
        st = finmind.pause_status()
        self.assertTrue(st["paused"])
        self.assertIn("402", st["reason"])
        with patch("urllib.request.urlopen") as net:
            with self.assertRaises(finmind.FinMindPaused):
                finmind.get_data("TaiwanStockPrice", "2330", "2026-10-01")
            net.assert_not_called()

    def test_403_in_json_body_also_pauses(self):
        with patch("urllib.request.urlopen", side_effect=_ok({"status": 403, "msg": "ip banned"})):
            with self.assertRaises(RuntimeError):
                finmind.get_data("TaiwanStockPrice", "2330", "2026-10-01")
        self.assertIn("IP", finmind.pause_status()["reason"])

    def test_other_errors_do_not_pause(self):
        with patch("urllib.request.urlopen", side_effect=_http_error(500)):
            with self.assertRaises(urllib.error.HTTPError):
                finmind.get_data("TaiwanStockPrice", "2330", "2026-10-01")
        self.assertFalse(finmind.pause_status()["paused"])

    def test_resumes_after_pause_expires(self):
        with patch.object(finmind, "PAUSE_402_SEC", 0), \
                patch("urllib.request.urlopen", side_effect=_http_error(402)):
            with self.assertRaises(urllib.error.HTTPError):
                finmind.get_data("X", "1", "2026-10-01")
        self.assertFalse(finmind.pause_status()["paused"])  # 暫停時間已到
        rows = [{"date": "2026-10-21"}]
        with patch("urllib.request.urlopen", side_effect=_ok({"status": 200, "data": rows})):
            self.assertEqual(finmind.get_data("X", "1", "2026-10-01"), rows)


def _yahoo(n=30):
    ts = [1760000000 + 86400 * i for i in range(n)]
    c = [100.0 + i for i in range(n)]
    return {"chart": {"result": [{"meta": {}, "timestamp": ts, "indicators": {
        "quote": [{"open": c, "high": c, "low": c, "close": c, "volume": [1] * n}],
        "adjclose": [{"adjclose": c}]}}]}}


class BarCacheTests(unittest.TestCase):
    def setUp(self):
        clear_bar_cache()

    def tearDown(self):
        clear_bar_cache()

    def test_repeat_calls_within_ttl_hit_network_once(self):
        a = DualMarketDataAdapter()
        with patch("urllib.request.urlopen", side_effect=_ok(_yahoo())) as net:
            first = a.fetch_bars("NVDA", days=220)
            second = a.fetch_bars("NVDA", days=90)
        self.assertEqual(net.call_count, 1)
        self.assertEqual(first["bars"][-1], second["bars"][-1])

    def test_cached_list_is_not_mutated_by_callers(self):
        a = DualMarketDataAdapter()
        with patch("urllib.request.urlopen", side_effect=_ok(_yahoo())):
            a.fetch_bars("NVDA")["bars"][-1] = None
            self.assertIsNotNone(a.fetch_bars("NVDA")["bars"][-1])

    def test_failures_are_cached_too(self):
        a = DualMarketDataAdapter()
        with patch("urllib.request.urlopen", side_effect=_http_error(404)) as net:
            for _ in range(3):
                with self.assertRaises(urllib.error.HTTPError):
                    a._fetch_from_yahoo("6488.TW")
        self.assertEqual(net.call_count, 1)

    def test_expired_entry_refetches(self):
        a = DualMarketDataAdapter()
        with patch("urllib.request.urlopen", side_effect=_ok(_yahoo())) as net, \
                patch.object(data_adapter, "BAR_CACHE_TTL_SEC", 0):
            a._fetch_from_yahoo("NVDA")
            a._fetch_from_yahoo("NVDA")
        self.assertEqual(net.call_count, 2)


class FinMindTokenTests(unittest.TestCase):
    def setUp(self):
        finmind.reset_pause()

    def test_token_sent_as_header_not_in_url_or_log(self):
        from src import quote_provider as qp

        seen = {}

        def capture(req, *a, **k):
            seen["url"], seen["auth"] = req.full_url, req.get_header("Authorization")
            return _Resp(json.dumps({"status": 200, "data": []}).encode())

        with patch("urllib.request.urlopen", side_effect=capture):
            finmind.get_data("TaiwanStockPrice", "2330", "2026-10-01", token="Bearer abc.def")
        self.assertEqual(seen["auth"], "Bearer abc.def")
        self.assertNotIn("abc.def", seen["url"])
        self.assertFalse(any("abc.def" in r["url"] for r in qp.get_fetch_log()))

    def test_no_token_sends_no_auth_header(self):
        seen = {}

        def capture(req, *a, **k):
            seen["auth"] = req.get_header("Authorization")
            return _Resp(json.dumps({"status": 200, "data": []}).encode())

        with patch.dict("os.environ", {}, clear=True), patch("urllib.request.urlopen", side_effect=capture):
            finmind.get_data("TaiwanStockPrice", "2330", "2026-10-01")
        self.assertIsNone(seen["auth"])


class EnvFileTests(unittest.TestCase):
    def test_env_file_loads_without_overriding(self):
        import os
        import tempfile
        from pathlib import Path

        from src.api_server import load_env_file

        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / ".env"
            f.write_text('# 註解\nTEST_ENV_NEW="v1"\nTEST_ENV_KEEP=fromfile\nbadline\n', encoding="utf-8")
            with patch.dict(os.environ, {"TEST_ENV_KEEP": "original"}):
                self.assertEqual(load_env_file(f), ["TEST_ENV_NEW"])
                self.assertEqual(os.environ["TEST_ENV_NEW"], "v1")
                self.assertEqual(os.environ["TEST_ENV_KEEP"], "original")
            self.assertEqual(load_env_file(Path(d) / "missing"), [])


if __name__ == "__main__":
    unittest.main()
