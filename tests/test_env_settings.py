"""設定頁寫入 .env：白名單、保留其他行、空值刪除、立即生效、只回傳遮罩值。"""

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from src.server import env_settings


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


if __name__ == "__main__":
    unittest.main()
