import json
import threading
import unittest
from datetime import date, timedelta
from http.server import BaseHTTPRequestHandler, HTTPServer

from src.ai import ai_client

from src.company import stock_info


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
        if body.get("stream"):
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.end_headers()
            chunks = [
                {"choices": [{"delta": {"reasoning": "先檢查趨勢與支撐價位"}}]},
                {"choices": [{"delta": {"content": "【觀點】收盤 2405 元，"}}]},
                {"choices": [{"delta": {"content": "目標價 99999 元。"}}], "usage": {"prompt_tokens": 120, "completion_tokens": 25}},
            ]
            for c in chunks:
                self.wfile.write(f"data: {json.dumps(c, ensure_ascii=False)}\n\n".encode("utf-8"))
            self.wfile.write(b"data: [DONE]\n\n")
            return
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

    def test_unverified_numbers_allows_unit_conversion_and_index_names(self):
        data = "avg20: 3086175, vol_need: 27800, foreign_20d: -149120, index: ^GSPC"
        ans = "標普 500（^GSPC）盤整，20日均量約 3.08 百萬股（308.6 萬股），外資賣超 14.9 萬張，量能需達 2.78 萬張，假目標 8888 元。"
        self.assertEqual(ai_client.unverified_numbers(ans, data), ["8888"])

    def test_clean_math_replaces_latex_and_preserves_currency(self):
        raw = "組合內存在多組相關係數 $\\ge 0.7$ 的配對，波動 $\\pm 2.5\\%$，區間 $100 ～ $120（約 US$0.05）。"
        cleaned = ai_client.to_traditional(raw)
        self.assertIn("相關係數 ≥ 0.7 的配對", cleaned)
        self.assertIn("波動 ± 2.5%", cleaned)
        self.assertIn("$100 ～ $120（約 US$0.05）", cleaned)

    def test_explain_stream_emits_thinking_deltas_and_done(self):
        ai_client.begin_usage()
        events = list(ai_client.explain_stream(self.profile, "mod1", {"close": 2405.0}))
        types = [e["type"] for e in events]
        self.assertIn("status", types)
        self.assertIn("delta", types)
        self.assertEqual(events[-1]["type"], "done")
        done = events[-1]
        self.assertEqual(done["answer"], "【觀點】收盤 2405 元，目標價 99999 元。")
        self.assertIn("99999", done["unverified_numbers"])
        self.assertNotIn("2405", done["unverified_numbers"])
        usage = ai_client.collect_usage()
        self.assertEqual(usage[0]["input_tokens"], 120)
        self.assertEqual(usage[0]["output_tokens"], 25)

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
        from src.ai.llm_runner import LLMRunner
        bad = {"action": "BUY", "order_type": "LIMIT", "entry_price": 2420.0, "stop_loss_price": 2380.0,
               "take_profit_target": 2590, "invalidation_criteria": " price < stop_loss_price 除外",
               "rationale": ["價格 2500.0"]}
        issues = LLMRunner._sanity_issues(bad, {"market": "TW"}, "收盤 2420.0 壓力 2500.0")
        self.assertTrue(any("委託別" in i for i in issues))
        self.assertTrue(any("失效條件" in i for i in issues))

    def test_good_ai_decision_passes(self):
        from src.ai.llm_runner import LLMRunner
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
        from src.server.api_server import DISPATCHER
        from src.market.bar import Bar
        bars = [Bar(f"2026-08-{d:02d}", 100, 100 + d, 99, 100, 1) for d in range(1, 31)]
        with patch.object(DISPATCHER.adapter, "fetch_bars", return_value={"bars": bars}):
            out = DISPATCHER._enrich_journal([{"symbol": "X", "entry_time": "2026-08-01", "exit_time": "2026-08-10",
                                               "entry_price": 100, "exit_price": 110, "shares": 10, "fees": 5}])[0]
        self.assertEqual(out["net_pnl"], 95.0)          # (110-100)*10 - 5
        self.assertEqual(out["return_pct"], 10.0)
        self.assertEqual(out["holding_days"], 9)
        self.assertEqual(out["high_5d_after_exit"], 115)  # 08-11~08-15 最高價


class TestExtractJson(unittest.TestCase):
    def test_extra_text_after_json(self):
        from src.ai.ai_text import extract_json
        raw = '{"rules": [{"rule_name": "a"}]}\n\n補充說明：{這是多寫的字}'
        self.assertEqual(extract_json(raw, "rules")["rules"][0]["rule_name"], "a")

    def test_think_block_and_fences_and_duplicates(self):
        from src.ai.ai_text import extract_json
        raw = '<think>先想一下 {x: 1}</think>```json\n{"note": 1}\n{"rules": []}\n```'
        self.assertEqual(extract_json(raw, "rules"), {"rules": []})
        self.assertEqual(extract_json(raw), {"note": 1})

    def test_no_json(self):
        from src.ai.ai_text import extract_json
        with self.assertRaises(ValueError):
            extract_json("沒有 JSON {壞掉")

    def test_json_call_retries_once(self):
        from unittest import mock
        replies = iter(['{"rules": [1]} 多寫 {', '{"rules": [1, 2, 3]}'])
        with mock.patch.object(ai_client, "complete", lambda *a, **k: next(replies)):
            self.assertEqual(ai_client._json_call({"type": "gemini"}, "x", want="rules")["rules"], [1])
        replies2 = iter(['亂寫', '{"rules": [1, 2, 3]}'])
        with mock.patch.object(ai_client, "complete", lambda *a, **k: next(replies2)):
            self.assertEqual(len(ai_client._json_call({"type": "gemini"}, "x", want="rules")["rules"]), 3)


class AiRulePartialTests(unittest.TestCase):
    GOOD = {"rule_name": "停損", "condition": "單筆虧損達 5% 時", "action": "立即全數賣出"}
    BAD_NUM = {"rule_name": "不加碼", "condition": "停損後下一筆", "action": "不得加碼下單"}
    BAD_CODE = {"rule_name": "鎖利", "condition": "獲利達 3% 時", "action": "執行 partial_close 鎖利"}

    def test_retry_fixes_bad_rule(self):
        from unittest.mock import patch
        replies = iter([{"rules": [self.GOOD, self.BAD_NUM, dict(self.GOOD, rule_name="二")]},
                        {"rules": [dict(self.GOOD, rule_name="補")]}])
        with patch.object(ai_client, "_json_call", lambda *a, **k: next(replies)):
            out = ai_client.personal_rules({"type": "openai_compatible", "model": "m"}, {}, [])
        self.assertEqual([r["source"] for r in out], ["AI", "AI", "AI"])
        self.assertEqual(out[2]["rule_name"], "補")

    def test_fallback_fills_when_retry_still_bad(self):
        from unittest.mock import patch
        fb = [{"rule_number": 1, "rule_name": "範本A", "condition": "x 5%", "action": "賣出"},
              {"rule_number": 2, "rule_name": "範本B", "condition": "y 2 筆", "action": "停止"}]
        with patch.object(ai_client, "_json_call", lambda *a, **k: {"rules": [self.GOOD, self.BAD_CODE, self.BAD_NUM]}):
            out = ai_client.personal_rules({"type": "openai_compatible", "model": "m"}, {}, [], fallback=fb)
        self.assertEqual([r["source"] for r in out], ["AI", "依資料計算", "依資料計算"])
        self.assertEqual([r["rule_number"] for r in out], [1, 2, 3])

    def test_problem_messages(self):
        self.assertIn("數字", ai_client._rule_problem(self.BAD_NUM))
        self.assertIn("partial_close", ai_client._rule_problem(self.BAD_CODE))
        self.assertIsNone(ai_client._rule_problem(self.GOOD))

    def test_broken_outer_json_is_reported_not_inner_object(self):
        from src.ai.ai_text import extract_json
        cut = '{"rules": [{"rule_name": "a", "condition": "5%", "action": "賣出"}, {"rule_name": "b", "cond'
        with self.assertRaises(ValueError) as cm:
            extract_json(cut, "rules")
        self.assertIn("截斷", str(cm.exception))
        self.assertEqual(extract_json('[{"rule_name": "a"}]', "rules"), {"rules": [{"rule_name": "a"}]})

    def test_compact_json_never_cuts_mid_string(self):
        import json as _j
        big = {"detected_biases": [{"ids": list(range(3000))}]}
        text = ai_client._compact_json(big, 2000)
        self.assertLessEqual(len(text), 2000)
        _j.loads(text)  # 仍是合法 JSON
