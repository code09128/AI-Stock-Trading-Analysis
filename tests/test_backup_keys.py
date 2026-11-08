"""備份／還原的資料鍵清單不能漏：web 原始碼用到的每一個 tw_us_* 鍵都要在設定頁的 DATA_KEYS 裡。
自動存檔是存全部 tw_us_*，但「下載備份／從備份還原」只處理 DATA_KEYS；漏掉的鍵（例如帳戶現金、存股計畫）搬家後會不見。"""

import re
import unittest
from pathlib import Path

WEB = Path(__file__).resolve().parents[1] / "web"


class BackupKeyTests(unittest.TestCase):
    def test_every_stored_key_is_in_backup_list(self):
        settings = (WEB / "pages" / "settings.tsx").read_text(encoding="utf-8")
        listed = set(re.findall(r"\['((?:tw_us|ta)_[a-z0-9_]+)',", settings))
        used = set()
        for p in WEB.rglob("*.tsx"):
            if p.name == "settings.tsx":
                continue
            used |= set(re.findall(r"'(tw_us_[a-z0-9_]+)'", p.read_text(encoding="utf-8")))
        used |= set(re.findall(r"'(tw_us_[a-z0-9_]+)'", settings))
        missing = sorted(used - listed)
        self.assertEqual(missing, [], f"這些資料鍵沒有放進備份清單（settings.tsx 的 DATA_KEYS）：{missing}")

    def test_ta_keys_are_in_backup_list(self):
        settings = (WEB / "pages" / "settings.tsx").read_text(encoding="utf-8")
        for k in ("ta_show_signals_v1", "ta_show_bollinger_v1"):
            self.assertIn(f"'{k}'", settings)


if __name__ == "__main__":
    unittest.main()
