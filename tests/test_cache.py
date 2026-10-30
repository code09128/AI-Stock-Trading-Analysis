import time
import unittest
from concurrent.futures import ThreadPoolExecutor

from src.market.cache import TTLCache


class TTLCacheTest(unittest.TestCase):
    def test_get_put_and_expiry(self):
        c = TTLCache()
        self.assertIsNone(c.get("a", 10))
        c.put("a", 1)
        self.assertEqual(c.get("a", 10), 1)
        time.sleep(0.03)
        self.assertIsNone(c.get("a", 0.01))
        self.assertEqual(c.peek("a"), 1)  # peek 不管過期
        self.assertEqual(c.get("a", None), 1)  # ttl=None 永不過期

    def test_negative_failure_is_not_cached_longer_than_ttl(self):
        c, calls = TTLCache(), []

        def loader():
            calls.append(1)
            return None

        c.get_or_load("k", loader, ttl=0.05)
        c.get_or_load("k", loader, ttl=0.05)
        self.assertEqual(len(calls), 1)  # 失敗後短時間內不重抓
        time.sleep(0.08)
        c.get_or_load("k", loader, ttl=0.05)
        self.assertEqual(len(calls), 2)  # 超過自己的更新間隔就重試（不是卡在固定的 NEG_TTL）

    def test_negative_mode_keeps_stale_value_on_failure(self):
        c, state = TTLCache(), {"fail": False, "n": 0}

        def loader():
            state["n"] += 1
            if state["fail"]:
                raise RuntimeError("down")
            return "old"

        self.assertEqual(c.get_or_load("k", loader, ttl=0.03), "old")
        time.sleep(0.05)
        state["fail"] = True
        self.assertEqual(c.get_or_load("k", loader, ttl=0.03), "old")  # 失敗沿用舊資料
        self.assertEqual(c.get_or_load("k", loader, ttl=0.03), "old")
        self.assertEqual(state["n"], 2)  # 失敗後沒有每次都重抓

    def test_cache_mode_remembers_error(self):
        c, calls = TTLCache(), []

        def loader():
            calls.append(1)
            raise ValueError("404")

        for _ in range(3):
            with self.assertRaises(ValueError):
                c.get_or_load("k", loader, ttl=10, on_error="cache")
        self.assertEqual(len(calls), 1)

    def test_raise_mode_does_not_cache_error(self):
        c, calls = TTLCache(), []

        def loader():
            calls.append(1)
            raise ValueError("down")

        for _ in range(2):
            with self.assertRaises(ValueError):
                c.get_or_load("k", loader, ttl=10, on_error="raise")
        self.assertEqual(len(calls), 2)
        self.assertNotIn("k", c)

    def test_concurrent_calls_load_once_and_release_lock(self):
        c, calls = TTLCache(), []

        def loader():
            calls.append(1)
            time.sleep(0.05)
            return {"ok": 1}

        with ThreadPoolExecutor(max_workers=6) as ex:
            res = list(ex.map(lambda _: c.get_or_load("k", loader, ttl=10), range(6)))
        self.assertEqual(len(calls), 1)
        self.assertTrue(all(r == {"ok": 1} for r in res))
        self.assertEqual(c._flight, {})  # 單一飛行用的鎖用完就移除


if __name__ == "__main__":
    unittest.main()
