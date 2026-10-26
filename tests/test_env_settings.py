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
        self.assertIn("已確認寫入", res["msg"])
        self.assertEqual(os.environ.get("FINMIND_TOKEN"), "my_valid_token_9999")
        self.assertIn("FINMIND_TOKEN=my_valid_token_9999", self.path.read_text(encoding="utf-8"))


class UpdaterTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.app_dir = Path(self.tmp.name)
        self.p_app = patch.object(updater, "get_app_dir", return_value=self.app_dir)
        self.p_res = patch.object(updater, "get_resource_dir", return_value=self.app_dir / "bundled")
        self.p_app.start()
        self.p_res.start()

    def tearDown(self):
        self.p_app.stop()
        self.p_res.stop()
        self.tmp.cleanup()

    def _make_fake_repo_zip(self) -> bytes:
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("repo-main/src/__init__.py", "# updated src\n")
            zf.writestr("repo-main/web/index.html", "<html>updated web</html>\n")
            zf.writestr("repo-main/README.md", "ignored\n")
        return buf.getvalue()

    def test_apply_zip_extracts_src_and_web_without_touching_user_data(self):
        (self.app_dir / ".env").write_text("FINMIND_TOKEN=keep_me\n", encoding="utf-8")
        (self.app_dir / "data").mkdir(parents=True, exist_ok=True)
        (self.app_dir / "data" / "userdata.json").write_text('{"ok":true}', encoding="utf-8")

        fake_zip = self._make_fake_repo_zip()

        class FakeResp:
            def __enter__(self):
                return self

            def __exit__(self, *args):
                pass

            def read(self):
                return fake_zip

        rem = {"sha": "abc1234567890", "short_sha": "abc1234", "date": "2026-10-26 18:00:00", "message": "feat: update"}
        with patch("urllib.request.urlopen", return_value=FakeResp()), \
             patch.object(updater, "_reload_runtime"):
            res = updater._apply_via_zip(rem)

        self.assertTrue(res["ok"])
        self.assertTrue((self.app_dir / "update" / "src" / "__init__.py").is_file())
        self.assertTrue((self.app_dir / "update" / "web" / "index.html").is_file())
        self.assertFalse((self.app_dir / "update" / "README.md").exists())
        # 確保 .env 與 data/ 完全不受影響
        self.assertEqual((self.app_dir / ".env").read_text(encoding="utf-8"), "FINMIND_TOKEN=keep_me\n")
        self.assertEqual((self.app_dir / "data" / "userdata.json").read_text(encoding="utf-8"), '{"ok":true}')
        cur = updater.current_version()
        self.assertEqual(cur["sha"], "abc1234567890")

    def test_stale_update_cleaned_when_bundled_is_newer(self):
        up = self.app_dir / "update"
        (up / "src").mkdir(parents=True)
        (up / "web").mkdir(parents=True)
        (up / "web" / "index.html").write_text("old", encoding="utf-8")
        (up / "version.json").write_text(
            json.dumps({"sha": "old111", "date": "2026-10-01 10:00:00"}), encoding="utf-8"
        )
        bundled = self.app_dir / "bundled"
        bundled.mkdir(parents=True)
        (bundled / "version.json").write_text(
            json.dumps({"sha": "new222", "date": "2026-10-26 10:00:00"}), encoding="utf-8"
        )
        active = updater.activate_update_if_present()
        self.assertFalse(active)
        self.assertFalse(up.exists())


if __name__ == "__main__":
    unittest.main()
