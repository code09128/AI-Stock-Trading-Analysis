"""AI 用量紀錄：各家 tokens 欄位、每個請求各自收集、附在 API 回應（離線，不連網）。"""

import threading
import unittest
from unittest.mock import patch

from src.ai import ai_client


class UsageParsingTests(unittest.TestCase):
    def test_gemini_counts_thinking_as_output(self):
        u = ai_client.usage_from_response(
            "gemini", {"usageMetadata": {"promptTokenCount": 900, "candidatesTokenCount": 300, "thoughtsTokenCount": 200}})
        self.assertEqual(u, {"input_tokens": 900, "output_tokens": 500})

    def test_anthropic_includes_cache_tokens_in_input(self):
        u = ai_client.usage_from_response(
            "anthropic", {"usage": {"input_tokens": 800, "output_tokens": 120, "cache_read_input_tokens": 100}})
        self.assertEqual(u, {"input_tokens": 900, "output_tokens": 120})

    def test_openai_compatible_and_missing(self):
        self.assertEqual(ai_client.usage_from_response("openai", {"usage": {"prompt_tokens": 5, "completion_tokens": 7}}),
                         {"input_tokens": 5, "output_tokens": 7})
        self.assertEqual(ai_client.usage_from_response("openai_compatible", {}),
                         {"input_tokens": None, "output_tokens": None})


class UsageCollectionTests(unittest.TestCase):
    def test_complete_records_usage_only_inside_a_request(self):
        resp = {"choices": [{"message": {"content": "OK"}}], "usage": {"prompt_tokens": 11, "completion_tokens": 3}}
        prof = {"type": "openai_compatible", "base_url": "http://127.0.0.1:1/v1", "model": "m", "name": "本地"}
        with patch.object(ai_client, "_request", return_value=resp):
            ai_client.complete(prof, "s", "u")  # 沒有 begin_usage：不收集
            self.assertEqual(ai_client.collect_usage(), [])
            ai_client.begin_usage()
            ai_client.complete(prof, "s", "u")
            items = ai_client.collect_usage()
        self.assertEqual(len(items), 1)
        self.assertEqual((items[0]["input_tokens"], items[0]["output_tokens"], items[0]["local"]), (11, 3, True))
        self.assertEqual(ai_client.collect_usage(), [])  # 收過就清空

    def test_threads_do_not_mix(self):
        seen = {}

        def worker(name, n):
            ai_client.begin_usage()
            for _ in range(n):
                ai_client.record_usage("openai", "m", name, {"usage": {"prompt_tokens": 1, "completion_tokens": 1}}, 0)
            seen[name] = len(ai_client.collect_usage())

        ts = [threading.Thread(target=worker, args=(f"t{i}", i + 1)) for i in range(4)]
        for t in ts:
            t.start()
        for t in ts:
            t.join()
        self.assertEqual(seen, {"t0": 1, "t1": 2, "t2": 3, "t3": 4})


if __name__ == "__main__":
    unittest.main()


class ActivityLogTests(unittest.TestCase):
    def test_write_scrubs_secrets_and_reads_back(self):
        import tempfile
        from pathlib import Path

        from src.server import activity_log

        with tempfile.TemporaryDirectory() as d, patch.object(activity_log, "LOG_DIR", Path(d)):
            n = activity_log.write([{"type": "click", "label": "儲存", "api_key": "sk-secret"},
                                    {"type": "api", "path": "/api/x", "level": "error", "error": "boom"}, "bad"], "browser")
            self.assertEqual(n, 2)
            text = "".join(f.read_text(encoding="utf-8") for f in Path(d).glob("*.jsonl"))
            self.assertNotIn("sk-secret", text)
            recent = activity_log.read_recent(10)
            self.assertEqual(recent[0]["path"], "/api/x")  # 最新的在前
            self.assertEqual([e["type"] for e in activity_log.read_recent(10, errors_only=True)], ["api"])


class ExplainContextTests(unittest.TestCase):
    def test_explain_includes_context_and_drops_noise(self):
        cap = {}

        def fake(profile, system, user, json_mode=False, timeout=90):
            cap["user"] = user
            return "答"

        prof = {"type": "openai_compatible", "base_url": "http://127.0.0.1:1/v1", "model": "m"}
        data = {"snapshot": {"symbol": "2330.TW", "level_candidates": [1, 2, 3], "latest_close": 2385}}
        ctx = {"標的": "2330", "籌碼面": {"觀察": ["外資連續 11 日賣超"]}}
        with patch.object(ai_client, "complete", side_effect=fake):
            r = ai_client.explain(prof, "mod1", data, "", ctx)
        self.assertIn("補充資料", cap["user"])
        self.assertIn("外資連續 11 日賣超", cap["user"])
        self.assertNotIn("level_candidates", cap["user"])
        self.assertIn("【多空劇本】", cap["user"])
        # 資料在前、格式骨架在最後；關鍵數字卡在任務前面
        self.assertLess(cap["user"].index("【本頁資料】"), cap["user"].index("【任務】"))
        self.assertTrue(cap["user"].rstrip().endswith("【接下來盯什麼】"))
        self.assertIn("現價 2385", cap["user"])
        self.assertNotIn("None", cap["user"].split("【任務】")[0].split("【關鍵數字")[1])
        self.assertEqual(r["context_sections"], ["籌碼面"])
        self.assertFalse(r["truncated"])


class RetryTests(unittest.TestCase):
    def test_retries_busy_then_succeeds(self):
        calls = []

        def fake(*a, **k):
            calls.append(1)
            if len(calls) < 3:
                raise ai_client.AIError("HTTP 503：model overloaded")
            return {"ok": True}

        with patch.object(ai_client, "_request_once", side_effect=fake), patch.object(ai_client.time, "sleep"):
            self.assertEqual(ai_client._request("u", {}, {}, 5, ""), {"ok": True})
        self.assertEqual(len(calls), 3)

    def test_no_retry_on_auth_error(self):
        with patch.object(ai_client, "_request_once", side_effect=ai_client.AIError("HTTP 401：bad key")) as m, \
                patch.object(ai_client.time, "sleep"):
            with self.assertRaises(ai_client.AIError):
                ai_client._request("u", {}, {}, 5, "")
        self.assertEqual(m.call_count, 1)


class EmptyAnswerTests(unittest.TestCase):
    def test_retry_then_error_on_blank(self):
        prof = {"type": "openrouter", "model": "x", "api_key": "k"}
        with patch.object(ai_client, "complete", side_effect=["", "【觀點】偏多"]) as m:
            r = ai_client.explain(prof, "mod5", {"a": 1})
        self.assertEqual(m.call_count, 2)
        self.assertIn("偏多", r["answer"])
        with patch.object(ai_client, "complete", return_value="  "):
            with self.assertRaises(ai_client.AIError):
                ai_client.explain(prof, "mod5", {"a": 1})
