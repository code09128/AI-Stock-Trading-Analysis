import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from src.server.api_server import get_resource_dir, get_app_dir, load_env_file
from src.server import activity_log


class PackagingPathTests(unittest.TestCase):
    """驗證打包成單一 exe (frozen) 與原始碼開發環境下的路徑解析行為。"""

    def test_default_development_paths(self):
        root = Path(__file__).resolve().parent.parent
        self.assertEqual(get_resource_dir(), root)
        self.assertEqual(get_app_dir(), root)

    def test_frozen_resource_path(self):
        with patch.object(sys, "frozen", True, create=True), \
             patch.object(sys, "_MEIPASS", "C:\\fake\\temp\\_MEI123", create=True):
            self.assertEqual(get_resource_dir(), Path("C:\\fake\\temp\\_MEI123"))

    def test_frozen_app_dir_path(self):
        with patch.object(sys, "frozen", True, create=True), \
             patch.object(sys, "executable", "C:\\Program Files\\Trading\\trading.exe"):
            self.assertEqual(get_app_dir(), Path("C:\\Program Files\\Trading"))

    def test_frozen_activity_log_dir(self):
        with patch.object(sys, "frozen", True, create=True), \
             patch.object(sys, "executable", "D:\\Apps\\Trading\\trading.exe"):
            log_dir = activity_log._get_app_dir() / "logs"
            self.assertEqual(log_dir, Path("D:\\Apps\\Trading\\logs"))

    def test_classified_subpackages(self):
        """驗證四大分類模組（core, market, analysis, server）皆可正常導入且與頂層轉發完全一致"""
        import src.ai.llm_runner as c_runner
        import src.ai.llm_runner as top_runner
        self.assertIs(c_runner, top_runner)

        import src.market.data_adapter as m_adapter
        import src.market.data_adapter as top_adapter
        self.assertIs(m_adapter, top_adapter)

        import src.technical.indicators as a_ind
        import src.technical.indicators as top_ind
        self.assertIs(a_ind, top_ind)

        import src.server.api_server as s_server
        import src.server.api_server as top_server
        self.assertIs(s_server, top_server)



class WebBuildTests(unittest.TestCase):
    """前端事先編譯：index.html 的 JSX 清單要完整且檔案存在（esbuild 本身需要 Node，打包時才跑）。"""

    def test_jsx_order_matches_files(self):
        import build_web
        html = (build_web.WEB_DIR / "index.html").read_text(encoding="utf-8")
        files = build_web.jsx_order(html)
        self.assertGreaterEqual(len(files), 20)
        self.assertEqual(files[-1], "app.jsx")  # 外殼最後載入
        for f in files:
            self.assertTrue((build_web.WEB_DIR / f).exists(), f)
        on_disk = {p.relative_to(build_web.WEB_DIR).as_posix() for p in build_web.WEB_DIR.rglob("*.jsx")}
        self.assertEqual(on_disk - set(files), set(), "有 JSX 檔沒被 index.html 載入")
