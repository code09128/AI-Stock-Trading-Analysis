import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor

from src.market import net

MIS = "https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=tse_2330.tw"
YAHOO_LIVE = "https://query1.finance.yahoo.com/v8/finance/chart/2330.TW?interval=1d&range=5d"
YAHOO_BULK = "https://query1.finance.yahoo.com/v8/finance/chart/2330.TW?interval=1d&range=10y"


class HostSlotTest(unittest.TestCase):
    def test_same_host_never_exceeds_limit(self):
        limit = net.HOST_LIMITS["mis.twse.com.tw"]
        lock = threading.Lock()
        state = {"now": 0, "peak": 0}

        def call(_):
            with net.host_slot(MIS):
                with lock:
                    state["now"] += 1
                    state["peak"] = max(state["peak"], state["now"])
                time.sleep(0.02)
                with lock:
                    state["now"] -= 1

        with ThreadPoolExecutor(max_workers=10) as ex:
            list(ex.map(call, range(20)))
        self.assertEqual(state["peak"], limit)

    def test_live_and_bulk_use_separate_slots(self):
        self.assertEqual(net._kind(YAHOO_LIVE), "live")
        self.assertEqual(net._kind(YAHOO_BULK), "bulk")
        self.assertEqual(net._kind("https://query2.finance.yahoo.com/v10/finance/quoteSummary/0050.TW"), "bulk")
        # 日 K 本機快取的補抓走大下載連線，不跟美股報價搶
        self.assertEqual(net._kind("https://query1.finance.yahoo.com/v8/finance/chart/VTI?interval=1d&range=1mo"), "bulk")
        self.assertIsNot(net._slot(YAHOO_LIVE), net._slot(YAHOO_BULK))
        self.assertIs(net._slot(YAHOO_LIVE), net._slot(YAHOO_LIVE.replace("query1", "QUERY1")))

    def test_bulk_downloads_do_not_block_live_quotes(self):
        held = [net.host_slot(YAHOO_BULK) for _ in range(net.DEFAULT_HOST_LIMIT)]
        for h in held:
            h.__enter__()
        try:
            with net.host_slot(YAHOO_LIVE, wait=0.2):  # 大下載佔滿了，即時請求仍可立刻通過
                pass
            with self.assertRaises(TimeoutError):
                with net.host_slot(YAHOO_BULK, wait=0.1):
                    pass
        finally:
            for h in held:
                h.__exit__(None, None, None)


class MacCertTest(unittest.TestCase):
    """Mac 沒有憑證檔時改用系統根憑證；有憑證檔或不是 Mac 就不動。"""

    def _run(self, platform, cafile, tmp):
        import os
        import subprocess
        from types import SimpleNamespace
        from unittest.mock import patch
        pem = b"-----BEGIN CERTIFICATE-----\nAAA\n-----END CERTIFICATE-----\n"
        done = subprocess.CompletedProcess([], 0, stdout=pem)
        env = {k: v for k, v in os.environ.items() if k != "SSL_CERT_FILE"}
        with patch.object(net.sys, "platform", platform), patch.dict(net.os.environ, env, clear=True), \
             patch.object(net.ssl, "get_default_verify_paths", return_value=SimpleNamespace(cafile=cafile)), \
             patch.object(net.subprocess, "run", return_value=done) as run, \
             patch.object(net.tempfile, "gettempdir", return_value=tmp):
            changed = net.use_mac_system_certs()
            return changed, net.os.environ.get("SSL_CERT_FILE"), run.called

    def test_mac_without_cafile_exports_system_roots(self):
        import tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as tmp:
            changed, cert_file, _ = self._run("darwin", None, tmp)
            self.assertTrue(changed)
            self.assertEqual(Path(cert_file), Path(tmp) / "trading_mac_roots.pem")
            self.assertIn(b"BEGIN CERTIFICATE", Path(cert_file).read_bytes())

    def test_untouched_when_cafile_exists_or_not_mac(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(self._run("darwin", __file__, tmp), (False, None, False))
            self.assertEqual(self._run("win32", None, tmp), (False, None, False))


if __name__ == "__main__":
    unittest.main()
