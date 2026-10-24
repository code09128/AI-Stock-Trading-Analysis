"""使用者資料存檔：白名單、刪除、原子寫入、每日備份、損毀時讀備份。"""

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from src.server import user_data


class UserDataTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.p = patch.object(user_data, "data_dir", return_value=Path(self.tmp.name) / "data")
        self.p.start()

    def tearDown(self):
        self.p.stop()
        self.tmp.cleanup()

    def test_save_and_load_roundtrip(self):
        h = json.dumps([{"symbol": "0050", "shares": 856.6932, "cost": 58.87}])
        user_data.save({"tw_us_holdings_v1": h, "tw_us_cash_v1": '"3595"'})
        out = user_data.load()
        self.assertEqual(out["values"]["tw_us_holdings_v1"], h)
        self.assertTrue(out["exists"])
        user_data.save({"tw_us_cash_v1": None})  # null＝刪除
        self.assertNotIn("tw_us_cash_v1", user_data.load()["values"])
        self.assertIn("tw_us_holdings_v1", user_data.load()["values"])  # 其他鍵不受影響

    def test_rejects_other_keys(self):
        for bad in ({"PATH": "x"}, {"tw_us_activity_v1": "[]"}, {"tw_us_x": 123}):
            with self.assertRaises(ValueError):
                user_data.save(bad)

    def test_daily_backup_and_corrupt_recovery(self):
        user_data.save({"tw_us_journal_v1": "[1]"})
        user_data.save({"tw_us_journal_v1": "[1,2]"})  # 第二次寫入前備份第一次的檔
        backups = list((user_data.data_dir() / "backups").glob("userdata-*.json"))
        self.assertEqual(len(backups), 1)
        user_data.data_file().write_text("{壞掉", encoding="utf-8")
        self.assertEqual(user_data.load()["values"]["tw_us_journal_v1"], "[1]")
        self.assertTrue(list(user_data.data_dir().glob("userdata.corrupt-*.json")))  # 損毀檔先留一份

    def test_locked_file_never_saved_from_old_backup(self):
        """存檔前讀不到正本（防毒／OneDrive 鎖住）：要報錯讓前端稍後重送，不能拿舊備份當底蓋掉今天的修改。"""
        user_data.save({"tw_us_journal_v1": "[1]"})
        user_data.save({"tw_us_journal_v1": "[1,2]"})  # 備份裡是 [1]，正本是 [1,2]
        real = Path.read_text

        def locked(self, *a, **k):
            if self.name == "userdata.json":
                raise PermissionError(13, "被其他程式使用中")
            return real(self, *a, **k)

        with patch.object(Path, "read_text", locked), patch.object(user_data.time, "sleep"):
            with self.assertRaises(ValueError):
                user_data.save({"tw_us_cash_v1": '"1"'})
        values = user_data.load()["values"]
        self.assertEqual(values["tw_us_journal_v1"], "[1,2]")  # 今天的修改還在
        self.assertNotIn("tw_us_cash_v1", values)

    def test_transient_lock_is_retried(self):
        user_data.save({"tw_us_journal_v1": "[1]"})
        real, calls = Path.read_text, {"n": 0}

        def flaky(self, *a, **k):
            if self.name == "userdata.json" and calls["n"] < 2:
                calls["n"] += 1
                raise PermissionError(13, "暫時鎖住")
            return real(self, *a, **k)

        with patch.object(Path, "read_text", flaky), patch.object(user_data.time, "sleep"):
            user_data.save({"tw_us_cash_v1": '"1"'})
        values = user_data.load()["values"]
        self.assertEqual(values["tw_us_journal_v1"], "[1]")
        self.assertEqual(values["tw_us_cash_v1"], '"1"')


if __name__ == "__main__":
    unittest.main()
