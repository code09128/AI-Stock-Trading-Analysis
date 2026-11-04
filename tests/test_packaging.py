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
    """前端打包：進入點要匯入每個 .tsx；Python 呼叫頁面的介面（window.TA）要存在；自動打包的判斷邏輯。esbuild 本身需要 Node，不在這裡跑。"""

    def setUp(self):
        import build_web
        self.web = build_web.WEB_DIR

    def test_entry_imports_every_tsx_and_app_is_last(self):
        import re
        main = (self.web / "main.tsx").read_text(encoding="utf-8")
        imported = re.findall(r"^import '\./([^']+)';", main, re.M)
        self.assertEqual(imported[-1], "app")  # 外殼最後載入
        on_disk = {p.relative_to(self.web).with_suffix("").as_posix() for p in self.web.rglob("*.tsx")}
        self.assertEqual(on_disk - set(imported) - {"main", "bus"}, set(), "有 TSX 檔沒被 main.tsx 匯入")
        for f in imported:
            self.assertTrue((self.web / f"{f}.tsx").exists(), f)

    def test_index_html_loads_bundle_not_babel_or_sources(self):
        import re
        html = re.sub(r"<!--.*?-->", "", (self.web / "index.html").read_text(encoding="utf-8"), flags=re.S)  # 註解裡會提到 .tsx
        self.assertIn('src="./app.bundle.js"', html)
        self.assertNotIn("babel", html.lower())
        self.assertNotIn(".tsx", html)

    def test_no_window_ta_registry_left_except_desktop_interface(self):
        import re
        for p in self.web.rglob("*.tsx"):
            code = re.sub(r"//[^\n]*", "", p.read_text(encoding="utf-8"))
            if p.name != "main.tsx":
                self.assertNotIn("window.TA", code, p.name)

    def test_desktop_py_calls_exist_on_window_ta(self):
        """desktop.py 用 evaluate_js 呼叫 window.TA.xxx：頁面沒有提供就會悄悄失效（例如關視窗前沒有存檔）。"""
        import re
        used = set(re.findall(r"window\.TA\.(\w+)", (Path(__file__).resolve().parent.parent / "desktop.py").read_text(encoding="utf-8")))
        main = (self.web / "main.tsx").read_text(encoding="utf-8")
        exposed = set(re.findall(r"\w+", re.search(r"window\.TA = \{([^}]*)\}", main).group(1)))
        self.assertEqual(used - exposed, set(), f"desktop.py 用到但 main.tsx 沒提供：{used - exposed}")

    def test_committed_bundle_matches_sources(self):
        """線上更新只下載 Release 標籤的 src/ 與 web/：web/app.bundle.js 沒跟原始碼一起 commit 或已經過期，更新後的畫面就是空白。
        失敗時執行：python build_web.py --web（或啟動一次 start.bat），再把 web/app.bundle.js 一起 commit。"""
        from src.server import web_bundle as wb
        self.assertTrue((self.web / wb.BUNDLE).exists(), "web/app.bundle.js 不存在")
        self.assertEqual(wb.bundle_hash(self.web), wb.sources_hash(self.web),
                         "web/app.bundle.js 已過期：請執行 python build_web.py --web 後一起 commit")

    def test_sources_hash_ignores_line_endings_and_detects_changes(self):
        import tempfile
        from src.server import web_bundle as wb
        with tempfile.TemporaryDirectory() as d:
            web = Path(d)
            (web / "a.tsx").write_bytes(b"line1\r\nline2\r\n")
            crlf = wb.sources_hash(web)
            (web / "a.tsx").write_bytes(b"line1\nline2\n")
            self.assertEqual(wb.sources_hash(web), crlf)  # 解壓縮／換行轉換不能讓 bundle 變成「過期」
            (web / "a.tsx").write_bytes(b"line1\nline3\n")
            self.assertNotEqual(wb.sources_hash(web), crlf)

    def test_ensure_noop_when_packaged_or_fresh_and_reports_when_node_missing(self):
        import tempfile
        from unittest.mock import patch
        from src.server import web_bundle as wb
        with tempfile.TemporaryDirectory() as d:
            web = Path(d)
            self.assertEqual(wb.ensure_dev_bundle(web), "")  # 沒有 main.tsx＝打包版：什麼都不做
            (web / "main.tsx").write_text("x", encoding="utf-8")
            with patch.object(wb, "_esbuild_cmd", return_value=None):
                self.assertIn("空白", wb.ensure_dev_bundle(web))  # 沒有 bundle 也沒有 Node：說明畫面會空白
                (web / wb.BUNDLE).write_text(f"/* src-hash: {wb.sources_hash(web)} */\nold", encoding="utf-8")
                self.assertEqual(wb.ensure_dev_bundle(web), "")  # 雜湊一致：不打包、不需要 Node
                (web / "main.tsx").write_text("y", encoding="utf-8")
                self.assertIn("舊版", wb.ensure_dev_bundle(web))  # 原始碼變了、沒有 Node：沿用舊 bundle 並提醒
                with patch.object(wb.sys, "frozen", True, create=True):
                    self.assertEqual(wb.ensure_dev_bundle(web), "")  # 打包版（frozen）永遠不打包
