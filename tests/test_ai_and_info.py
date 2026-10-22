import json
import threading
import unittest
from datetime import date, timedelta
from http.server import BaseHTTPRequestHandler, HTTPServer

from src import ai_client, stock_info


class FakeLLM(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, obj):
        raw = json.dumps(obj).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        self._send({"data": [{"id": "fake-7b"}, {"id": "another"}]})

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        user = body["messages"][-1]["content"]
        text = "OK" if "回覆「OK」" in user else "收盤 2405 元，目標價 99999 元。"
        self._send({"choices": [{"message": {"content": text}}]})


class AiClientTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = HTTPServer(("127.0.0.1", 0), FakeLLM)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.profile = {"type": "openai_compatible", "model": "fake-7b", "name": "local",
                       "base_url": f"http://127.0.0.1:{cls.srv.server_port}/v1"}

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def test_models_and_connection(self):
        self.assertEqual(ai_client.list_models(self.profile), ["another", "fake-7b"])
        self.assertTrue(ai_client.test(self.profile)["ok"])

    def test_explain_flags_numbers_not_in_data(self):
        r = ai_client.explain(self.profile, "mod1", {"close": 2405.0})
        self.assertIn("99999", r["unverified_numbers"])
        self.assertNotIn("2405", r["unverified_numbers"])

    def test_cloud_without_key_or_model_is_rejected(self):
        with self.assertRaises(ai_client.AIError):
            ai_client.complete({"type": "gemini", "model": "x"}, "s", "u")
        with self.assertRaises(ai_client.AIError):
            ai_client.complete({"type": "openai", "api_key": "k"}, "s", "u")

    def test_rules_profile_is_not_ai(self):
        self.assertFalse(ai_client.is_enabled({"type": "rules"}))
        self.assertFalse(ai_client.is_enabled(None))


class DividendAnalysisTests(unittest.TestCase):
    def _ev(self, days_ago, cash=1.0):
        return {"ex_date": (date.today() - timedelta(days=days_ago)).isoformat(), "pay_date": None, "cash": cash}

    def test_frequency_and_ttm(self):
        quarterly = [self._ev(d) for d in (30, 120, 210, 300)]
        a = stock_info.analyze_dividends(quarterly, 100.0)
        self.assertEqual(a["frequency"], "季配")
        self.assertEqual(a["ttm_cash"], 4.0)
        self.assertEqual(a["ttm_yield_pct"], 4.0)

    def test_future_event_is_announced_not_estimated(self):
        fut = {"ex_date": (date.today() + timedelta(days=10)).isoformat(), "pay_date": "2099-01-01", "cash": 2.0}
        a = stock_info.analyze_dividends([fut, self._ev(100)], 50.0)
        self.assertEqual(a["next_announced"]["cash"], 2.0)
        self.assertIsNone(a["next_estimate"])

    def test_no_dividends(self):
        a = stock_info.analyze_dividends([], 10.0)
        self.assertEqual(a["frequency"], "近一年無配息")


if __name__ == "__main__":
    unittest.main()


class AiDecisionSanityTests(unittest.TestCase):
    def test_bad_ai_decision_is_rejected(self):
        from src.llm_runner import LLMRunner
        bad = {"action": "BUY", "order_type": "LIMIT", "entry_price": 2420.0, "stop_loss_price": 2380.0,
               "take_profit_target": 2590, "invalidation_criteria": " price < stop_loss_price 除外",
               "rationale": ["價格 2500.0"]}
        issues = LLMRunner._sanity_issues(bad, {"market": "TW"}, "收盤 2420.0 壓力 2500.0")
        self.assertTrue(any("委託別" in i for i in issues))
        self.assertTrue(any("失效條件" in i for i in issues))

    def test_good_ai_decision_passes(self):
        from src.llm_runner import LLMRunner
        good = {"action": "HOLD", "order_type": "ROD", "entry_price": 2370.0, "stop_loss_price": 2320.0,
                "take_profit_target": 2590, "invalidation_criteria": "日線收盤跌破 2320 元停損",
                "rationale": ["收盤 2420.0 低於 MA20 2490.0"]}
        self.assertEqual(LLMRunner._sanity_issues(good, {"market": "TW"}, "收盤 2420.0 MA20=2490.0 2320"), [])


class AiRuleValidationTests(unittest.TestCase):
    def test_code_like_rules_are_rejected(self):
        from unittest.mock import patch
        junk = {"rules": [{"rule_name": "x", "condition": "loss_trades > loss_trades * 0.3",
                           "action": "stop_loss_at_30_percent_loss"}] * 3}
        with patch.object(ai_client, "_json_call", return_value=junk):
            with self.assertRaises(ai_client.AIError):
                ai_client.personal_rules({"type": "openai_compatible", "model": "m"}, {}, [])

    def test_readable_rules_pass(self):
        from unittest.mock import patch
        ok = {"rules": [{"rule_name": "停損", "condition": "單筆虧損達 5% 時", "action": "立即全數賣出",
                         "target_bias": "處置效應", "evidence": "#03"}] * 3}
        with patch.object(ai_client, "_json_call", return_value=ok):
            self.assertEqual(len(ai_client.personal_rules({"type": "openai_compatible", "model": "m"}, {}, [])), 3)


class JournalEnrichTests(unittest.TestCase):
    def test_pnl_days_and_post_exit_high_are_computed(self):
        from unittest.mock import patch
        from src.api_server import DISPATCHER
        from src.backtest_engine import Bar
        bars = [Bar(f"2026-08-{d:02d}", 100, 100 + d, 99, 100, 1) for d in range(1, 31)]
        with patch.object(DISPATCHER.adapter, "fetch_bars", return_value={"bars": bars}):
            out = DISPATCHER._enrich_journal([{"symbol": "X", "entry_time": "2026-08-01", "exit_time": "2026-08-10",
                                               "entry_price": 100, "exit_price": 110, "shares": 10, "fees": 5}])[0]
        self.assertEqual(out["net_pnl"], 95.0)          # (110-100)*10 - 5
        self.assertEqual(out["return_pct"], 10.0)
        self.assertEqual(out["holding_days"], 9)
        self.assertEqual(out["high_5d_after_exit"], 115)  # 08-11~08-15 最高價
