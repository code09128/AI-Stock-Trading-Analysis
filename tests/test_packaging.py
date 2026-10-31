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
        app = Path.home().resolve() / "Program Files" / "Trading"  # 絕對路徑：Windows 與 Mac 都能跑
        with patch.object(sys, "frozen", True, create=True), \
             patch.object(sys, "executable", str(app / "trading.exe")):
            self.assertEqual(get_app_dir(), app)

    def test_frozen_exe_in_project_dist_shares_project_data(self):
        """從專案 dist\\ 直接執行打包版（單一檔案版與資料夾版）要讀專案的 data\\，不能各自一份。"""
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            (root / "src" / "server").mkdir(parents=True)
            (root / "run.py").write_text("", encoding="utf-8")
            for exe in (root / "dist" / "app.exe", root / "dist" / "股票交易分析系統" / "app.exe"):
                with patch.object(sys, "frozen", True, create=True), \
                     patch.object(sys, "executable", str(exe)):
                    self.assertEqual(get_app_dir(), root)
            # 安裝到別處（不是專案的 dist）照舊用 exe 所在資料夾
            other = root / "dist_copy" / "app.exe"
            with patch.object(sys, "frozen", True, create=True), patch.object(sys, "executable", str(other)):
                self.assertEqual(get_app_dir(), other.parent)

    def test_mac_app_uses_application_support(self):
        """Mac 的 .app 內部不能寫：資料放 ~/Library/Application Support；從專案 dist/ 執行時照樣共用專案資料。"""
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            exe = Path("/Applications/股票交易分析系統.app/Contents/MacOS/股票交易分析系統")
            with patch.object(sys, "platform", "darwin"), patch.object(sys, "frozen", True, create=True), \
                 patch.object(sys, "executable", str(exe)), patch.object(Path, "home", return_value=root):
                self.assertEqual(get_app_dir(), root / "Library" / "Application Support" / "股票交易分析系統")
            (root / "src" / "server").mkdir(parents=True)
            (root / "run.py").write_text("", encoding="utf-8")
            in_dist = root / "dist" / "股票交易分析系統.app" / "Contents" / "MacOS" / "股票交易分析系統"
            with patch.object(sys, "platform", "darwin"), patch.object(sys, "frozen", True, create=True), \
                 patch.object(sys, "executable", str(in_dist)):
                self.assertEqual(get_app_dir(), root)

    def test_frozen_activity_log_dir(self):
        app = Path.home().resolve() / "Apps" / "Trading"
        with patch.object(sys, "frozen", True, create=True), \
             patch.object(sys, "executable", str(app / "trading.exe")):
            log_dir = activity_log._get_app_dir() / "logs"
            self.assertEqual(log_dir, app / "logs")

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
