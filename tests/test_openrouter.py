import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

from src.ai import ai_client


class FakeRouter(BaseHTTPRequestHandler):
    seen = {}

    def log_message(self, *a):
        pass

    def _send(self, obj, code=200):
        raw = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        self._send({"data": [
            {"id": "openai/gpt-x", "pricing": {"prompt": "0.0000025", "completion": "0.00001"}},
            {"id": "meta/llama:free", "pricing": {"prompt": "0", "completion": "0"}},
        ]})

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        FakeRouter.seen = {"auth": self.headers.get("Authorization"), "title": self.headers.get("X-Title"),
                           "body": body}
        if "response_format" in body:
            self._send({"error": "json mode unsupported"}, 400)
            return
        self._send({"choices": [{"message": {"content": "{\"ok\": 1}"}}],
                    "usage": {"prompt_tokens": 100, "completion_tokens": 20, "cost": 0.00045}})


class OpenRouterTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = HTTPServer(("127.0.0.1", 0), FakeRouter)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.profile = {"type": "openrouter", "model": "openai/gpt-x", "api_key": "sk-or-test",
                       "base_url": f"http://127.0.0.1:{cls.srv.server_port}/api/v1"}

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def test_models_have_per_million_pricing_and_free_first(self):
        r = ai_client.openrouter_models(self.profile)
        self.assertEqual(r["models"], ["meta/llama:free", "openai/gpt-x"])
        self.assertEqual(r["pricing"]["openai/gpt-x"], {"in": 2.5, "out": 10.0})
        self.assertEqual(ai_client.list_models(self.profile), r["models"])

    def test_completion_records_reported_cost_and_retries_without_json_mode(self):
        ai_client.begin_usage()
        out = ai_client.complete(self.profile, "s", "u", json_mode=True)
        usage = ai_client.collect_usage()
        self.assertEqual(out, '{"ok": 1}')
        self.assertEqual(FakeRouter.seen["auth"], "Bearer sk-or-test")
        self.assertEqual(FakeRouter.seen["title"], "TW-US Trading Analyzer")
        self.assertEqual(FakeRouter.seen["body"]["usage"], {"include": True})
        self.assertEqual(usage[0]["cost_usd"], 0.00045)
        self.assertFalse(usage[0]["local"])

    def test_requires_key(self):
        with self.assertRaises(ai_client.AIError):
            ai_client.complete({"type": "openrouter", "model": "x"}, "s", "u")


if __name__ == "__main__":
    unittest.main()
