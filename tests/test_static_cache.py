"""靜態檔快取：只有修改時間完全相同才回 304（原始碼版與打包版共用同一個網址與 WebView2 快取）。"""

import os
import threading
import unittest
import urllib.error
import urllib.request
from email.utils import formatdate

from src.server.api_server import make_server
from src.server.config import WEB_DIR


class TestStaticRevalidation(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = make_server(0)
        cls.port = cls.server.server_address[1]
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def status(self, path, ims):
        req = urllib.request.Request(f"http://127.0.0.1:{self.port}{path}", headers={"If-Modified-Since": ims})
        try:
            with self.opener.open(req, timeout=5) as r:
                return r.status
        except urllib.error.HTTPError as e:
            return e.code

    def test_newer_cached_copy_from_other_build_is_not_reused(self):
        mtime = int(os.stat(WEB_DIR / "index.html").st_mtime)
        self.assertEqual(self.status("/", formatdate(mtime + 3600, usegmt=True)), 200)

    def test_same_file_still_returns_304(self):
        mtime = int(os.stat(WEB_DIR / "index.html").st_mtime)
        self.assertEqual(self.status("/", formatdate(mtime, usegmt=True)), 304)


if __name__ == "__main__":
    unittest.main()
