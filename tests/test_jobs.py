"""背景工作：結果查得到、同樣的請求共用一個工作、輸入錯誤回 400、AI 用量只回報一次、只接受慢的分析路徑（離線）。"""

import threading
import unittest

from src.server import api_server, jobs


class JobTests(unittest.TestCase):
    def test_shared_job_and_result(self):
        gate = threading.Event()
        calls = []

        def slow(p):
            calls.append(p)
            gate.wait(2)
            return {"ok": p["x"], "ai_usage": [{"model": "m", "input_tokens": 1, "output_tokens": 2}]}
        a = jobs.start("/api/mod4/risk", {"x": 1}, slow)
        b = jobs.start("/api/mod4/risk", {"x": 1}, slow)  # 同樣參數還在跑：共用
        c = jobs.start("/api/mod4/risk", {"x": 2}, slow)
        self.assertEqual(a, b)
        self.assertNotEqual(a, c)
        self.assertEqual(jobs.poll(a)["state"], "running")
        gate.set()
        first = jobs.poll(a, wait=2)
        self.assertEqual((first["state"], first["status"], first["result"]["ok"]), ("done", 200, 1))
        self.assertEqual(len(first["ai_usage"]), 1)
        self.assertNotIn("ai_usage", jobs.poll(a))  # 第二次查（共用的另一個畫面）不重複記費用
        jobs.poll(c, wait=2)
        self.assertEqual(len(calls), 2)
        d = jobs.start("/api/mod4/risk", {"x": 1}, slow)  # 跑完後再送一次：重新計算
        self.assertNotEqual(a, d)
        jobs.poll(d, wait=2)

    def test_errors(self):
        def bad(p):
            raise ValueError("請輸入持股")
        r = jobs.poll(jobs.start("/api/mod5/coach", {}, bad), wait=2)
        self.assertEqual((r["status"], r["result"]["error"]), (400, "請輸入持股"))
        with self.assertRaises(ValueError):
            jobs.start("/api/env/save", {}, bad)
        with self.assertRaises(ValueError):
            jobs.poll("nope")

    def test_route_runs_real_handler(self):
        """/api/jobs/start 用路由表裡的處理函式；不在路由表的路徑直接拒絕。"""
        done = []
        saved = api_server.ROUTES["/api/savings/portfolio"]
        try:
            api_server.ROUTES["/api/savings/portfolio"] = lambda p: done.append(p) or {"n": 1}
            jid = api_server.ROUTES["/api/jobs/start"]({"path": "/api/savings/portfolio", "payload": {"a": 1}})["id"]
            r = api_server.ROUTES["/api/jobs/poll"]({"id": jid, "wait": 2})
            self.assertEqual(r["result"], {"n": 1})
            self.assertEqual(done, [{"a": 1}])
            with self.assertRaises(ValueError):
                api_server.ROUTES["/api/jobs/start"]({"path": "/api/nothing"})
        finally:
            api_server.ROUTES["/api/savings/portfolio"] = saved


if __name__ == "__main__":
    unittest.main()
