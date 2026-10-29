"""設定頁寫入 .env 與線上熱更新測試：白名單、保留其他行、空值刪除、FinMind 驗證、GitHub 壓縮包熱更新。"""

import io
import json
import os
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from src.server import env_settings, updater


class EnvSettingsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / ".env"
        self.p = patch.object(env_settings, "env_path", return_value=self.path)
        self.p.start()
        self.saved = {k: os.environ.pop(k, None) for k in env_settings.ALLOWED}

    def tearDown(self):
        self.p.stop()
        for k, v in self.saved.items():
            os.environ.pop(k, None)
            if v is not None:
                os.environ[k] = v
        self.tmp.cleanup()

    def test_save_creates_file_and_applies_immediately(self):
        st = env_settings.save({"FINMIND_TOKEN": "abcdefgh12345678"})
        self.assertEqual(os.environ["FINMIND_TOKEN"], "abcdefgh12345678")
        self.assertIn("FINMIND_TOKEN=abcdefgh12345678", self.path.read_text(encoding="utf-8"))
        f = next(x for x in st["fields"] if x["key"] == "FINMIND_TOKEN")
        self.assertTrue(f["set"])
        self.assertTrue(f["in_file"])
        self.assertEqual(f["group"], "data")
        self.assertNotIn("abcdefgh", f["display"])  # 不回傳完整金鑰
        self.assertIn("5678", f["display"])

    def test_keeps_other_lines_and_removes_empty(self):
        self.path.write_text("# 我的註解\nOTHER=1\nFINMIND_TOKEN=old\n", encoding="utf-8")
        env_settings.save({"FINMIND_TOKEN": "", "SEC_USER_AGENT": "me me@example.com"})
        text = self.path.read_text(encoding="utf-8")
        self.assertIn("# 我的註解", text)
        self.assertIn("OTHER=1", text)
        self.assertNotIn("FINMIND_TOKEN", text)
        self.assertIn("SEC_USER_AGENT=me me@example.com", text)
        self.assertNotIn("FINMIND_TOKEN", os.environ)

    def test_rejects_unknown_key_and_newline(self):
        with self.assertRaises(ValueError):
            env_settings.save({"PATH": "x"})
        with self.assertRaises(ValueError):
            env_settings.save({"FINMIND_TOKEN": "a\nB=2"})

    def test_finmind_token_verification_saves_and_checks_file(self):
        res_empty = env_settings.test_finmind("")
        self.assertFalse(res_empty["ok"])
        with patch("src.market.finmind.get_data", return_value=[{"date": "2026-10-20", "close": 1000}]):
            res = env_settings.test_finmind("my_valid_token_9999")
        self.assertTrue(res["ok"])
        self.assertIn("已寫入", res["msg"])
        self.assertEqual(os.environ.get("FINMIND_TOKEN"), "my_valid_token_9999")
        self.assertIn("FINMIND_TOKEN=my_valid_token_9999", self.path.read_text(encoding="utf-8"))

    def test_finmind_bad_token_is_not_saved(self):
        with patch("src.market.finmind.get_data", side_effect=RuntimeError("FinMind 402")):
            res = env_settings.test_finmind("bad_token_0000")
        self.assertFalse(res["ok"])
        self.assertIn("未儲存", res["error"])
        self.assertNotIn("bad_token_0000", self.path.read_text(encoding="utf-8") if self.path.exists() else "")


class UpdaterTests(unittest.TestCase):
    """線上更新只讀 GitHub Release：版本比較、下載只解 src/ 與 web/、版本不一致不套用、原始碼版不覆蓋。"""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.app_dir = Path(self.tmp.name)
        bundled = self.app_dir / "bundled"
        bundled.mkdir()
        (bundled / "version.json").write_text(json.dumps({"version": "1.0.0"}), encoding="utf-8")
        self.patches = [patch.object(updater, "get_app_dir", return_value=self.app_dir),
                        patch.object(updater, "get_resource_dir", return_value=bundled),
                        patch.object(updater, "_reload_runtime")]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.tmp.cleanup()

    @staticmethod
    def _zip(version: str) -> bytes:
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr(f"repo-{version}/src/__init__.py", "")
            zf.writestr(f"repo-{version}/src/version.py", f'APP_VERSION = "{version}"\n')
            zf.writestr(f"repo-{version}/web/index.html", "<html></html>")
            zf.writestr(f"repo-{version}/README.md", "ignored")
            zf.writestr(f"repo-{version}/TradingAnalysis.zip", "ignored")
        return buf.getvalue()

    @staticmethod
    def _resp(raw: bytes):
        class R:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                pass

            def read(self):
                return raw
        return R()

    def test_parse_version(self):
        self.assertEqual(updater.parse_version("v1.2.10"), (1, 2, 10))
        self.assertGreater(updater.parse_version("1.10.0"), updater.parse_version("1.9.9"))
        self.assertEqual(updater.parse_version("main"), (0, 0, 0))

    def test_download_extracts_only_src_web_and_keeps_user_data(self):
        (self.app_dir / ".env").write_text("FINMIND_TOKEN=keep_me\n", encoding="utf-8")
        (self.app_dir / "data").mkdir()
        (self.app_dir / "data" / "userdata.json").write_text('{"ok":true}', encoding="utf-8")
        rel = {"version": "1.0.1", "tag": "v1.0.1", "name": "v1.0.1"}
        with patch("urllib.request.urlopen", return_value=self._resp(self._zip("1.0.1"))):
            res = updater._download_release(rel)
        self.assertTrue(res["updated"])
        up = self.app_dir / "update"
        self.assertTrue((up / "src" / "version.py").is_file())
        self.assertFalse((up / "README.md").exists())
        self.assertFalse((up / "TradingAnalysis.zip").exists())
        self.assertEqual((self.app_dir / ".env").read_text(encoding="utf-8"), "FINMIND_TOKEN=keep_me\n")
        # 自選股、持股、AI 設定都存在 data/userdata.json：更新不能動到
        self.assertEqual((self.app_dir / "data" / "userdata.json").read_text(encoding="utf-8"), '{"ok":true}')
        self.assertEqual(updater.current_version()["version"], "1.0.1")

    def test_version_mismatch_is_rejected(self):
        rel = {"version": "1.0.2", "tag": "v1.0.2"}
        with patch("urllib.request.urlopen", return_value=self._resp(self._zip("1.0.1"))):
            with self.assertRaises(RuntimeError):
                updater._download_release(rel)
        self.assertFalse((self.app_dir / "update").exists())

    def test_stale_update_cleaned_when_bundled_is_same_or_newer(self):
        up = self.app_dir / "update"
        (up / "src").mkdir(parents=True)
        (up / "web").mkdir(parents=True)
        (up / "web" / "index.html").write_text("old", encoding="utf-8")
        (up / "version.json").write_text(json.dumps({"version": "1.0.0"}), encoding="utf-8")
        self.assertFalse(updater.activate_update_if_present())
        self.assertFalse(up.exists())

    def test_noop_when_latest_and_source_checkout_not_overwritten(self):
        with patch.object(updater, "fetch_latest_release", return_value={"version": "1.0.0", "tag": "v1.0.0"}),              patch.object(updater, "_download_release") as dl:
            res = updater.apply_update()
        self.assertTrue(res["already_latest"])
        dl.assert_not_called()
        (self.app_dir / ".git").mkdir()
        with patch.object(updater, "fetch_latest_release", return_value={"version": "1.1.0", "tag": "v1.1.0"}),              patch.object(updater, "_download_release") as dl:
            res = updater.apply_update()
        self.assertEqual(res["mode"], "source")
        dl.assert_not_called()

    def test_cert_verify_failure_retries_with_root_store_context(self):
        """中繼憑證區有舊交叉簽章憑證時，改用只信任根憑證的設定再連一次（仍然驗證憑證）。"""
        import ssl
        import urllib.error
        bad = urllib.error.URLError(ssl.SSLCertVerificationError("unable to get issuer certificate"))
        body = b'{"tag_name": "v1.2.0", "body": "notes"}'
        ctx = object()
        with patch("urllib.request.urlopen", side_effect=[bad, self._resp(body)]) as op, \
                patch.object(updater, "_windows_root_context", return_value=ctx):
            rel = updater.fetch_latest_release()
        self.assertEqual(rel["version"], "1.2.0")
        self.assertIs(op.call_args_list[1].kwargs["context"], ctx)

    def test_other_network_errors_are_not_retried(self):
        import urllib.error
        with patch("urllib.request.urlopen", side_effect=urllib.error.URLError("timed out")) as op:
            res = updater.check_update()
        self.assertFalse(res["ok"])
        self.assertEqual(op.call_count, 1)

    def test_no_release_yet(self):
        import urllib.error
        err = urllib.error.HTTPError(updater.RELEASES_API, 404, "Not Found", {}, None)
        with patch("urllib.request.urlopen", side_effect=err):
            res = updater.check_update()
        self.assertFalse(res["ok"])
        self.assertIn("Release", res["error"])
