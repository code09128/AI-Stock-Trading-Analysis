"""線上更新的失敗保護：驗證、失敗標記與還原、壞版本只略過不擋後續更新（見 src/server/updater.py 檔頭）。全部離線。"""

import io
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from src.server import updater as up


class Sandbox(unittest.TestCase):
    """假的程式資料夾：get_app_dir／get_resource_dir 指到暫存資料夾，結束後還原 sys.path 與套件路徑（activate 會改它們）。"""

    BUNDLED = "1.0.12"

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.app = Path(self._tmp.name) / "app"
        self.res = Path(self._tmp.name) / "res"
        self.app.mkdir()
        self.res.mkdir()
        (self.res / "version.json").write_text(json.dumps({"version": self.BUNDLED}), encoding="utf-8")
        for p in (patch.object(up, "get_app_dir", return_value=self.app), patch.object(up, "get_resource_dir", return_value=self.res)):
            p.start()
            self.addCleanup(p.stop)
        saved_path, saved_meta = list(sys.path), list(sys.meta_path)
        saved_pkgs = {n: list(sys.modules[n].__path__) for n in ("src", "src.server") if n in sys.modules}

        def restore():
            sys.path[:] = saved_path
            sys.meta_path[:] = saved_meta
            for n, v in saved_pkgs.items():
                sys.modules[n].__path__ = v

        self.addCleanup(restore)
        self.addCleanup(setattr, up, "_boot_counted", up._boot_counted)
        self.addCleanup(lambda: __import__("os").environ.pop("TRADING_SAFE_MODE", None))

    def boot(self, **kw):
        """模擬「新的一次程式啟動」（同一個行程內第二次呼叫不會再算一次）。"""
        up._boot_counted = False
        return up.activate_update_if_present(**kw)

    def make_update(self, version="1.0.14", body="X = 1\n"):
        d = self.app / "update"
        (d / "src").mkdir(parents=True)
        (d / "src" / "version.py").write_text(f'APP_VERSION = "{version}"\n', encoding="utf-8")
        (d / "src" / "mod.py").write_text(body, encoding="utf-8")
        (d / "web").mkdir()
        (d / "web" / "index.html").write_text('<script src="./app.bundle.js"></script>', encoding="utf-8")
        (d / "web" / "app.bundle.js").write_text("1", encoding="utf-8")
        (d / "version.json").write_text(json.dumps({"version": version}), encoding="utf-8")
        return d


class BootStateTests(unittest.TestCase):
    def fresh(self):
        return {"bad": {}, "pending": None, "ok": None}

    def test_counts_boots_then_gives_up_after_the_limit(self):
        st = self.fresh()
        for n in range(1, up.MAX_UNHEALTHY_BOOTS + 1):
            use, _, st = up.next_boot_state(st, "1.0.14")
            self.assertTrue(use)
            self.assertEqual(st["pending"]["boots"], n)
        use, reason, st = up.next_boot_state(st, "1.0.14")  # 前面都沒有回報正常：這次放棄
        self.assertFalse(use)
        self.assertIn("1.0.14", st["bad"])
        self.assertIn("沒有完成畫面載入", reason)
        self.assertIsNone(st["pending"])

    def test_healthy_version_is_never_rolled_back_and_hot_reload_does_not_count(self):
        st = {"bad": {}, "pending": None, "ok": "1.0.14"}
        for _ in range(10):
            use, _, st = up.next_boot_state(st, "1.0.14")
            self.assertTrue(use)
        use, _, st2 = up.next_boot_state(self.fresh(), "1.0.14", count_boot=False)
        self.assertEqual(st2["pending"]["boots"], 0)

    def test_second_call_in_the_last_allowed_boot_does_not_give_up(self):
        st = {"bad": {}, "pending": {"version": "1.0.14", "boots": up.MAX_UNHEALTHY_BOOTS - 1}, "ok": None}
        use, _, st = up.next_boot_state(st, "1.0.14")  # 第 3 次啟動：還可以用
        self.assertTrue(use)
        use, _, st = up.next_boot_state(st, "1.0.14", count_boot=False)  # 同一次啟動的第二次呼叫
        self.assertTrue(use)
        self.assertFalse(up.next_boot_state(st, "1.0.14")[0])  # 下一次啟動才放棄

    def test_new_version_restarts_the_count_and_bad_version_stays_bad(self):
        st = {"bad": {"1.0.14": {"reason": "x", "at": ""}}, "pending": {"version": "1.0.14", "boots": 3}, "ok": None}
        self.assertFalse(up.next_boot_state(st, "1.0.14")[0])
        use, _, st = up.next_boot_state(st, "1.0.15")  # 更高的版本不受前一個壞版本影響
        self.assertTrue(use)
        self.assertEqual(st["pending"], {"version": "1.0.15", "boots": 1})


class ActivationTests(Sandbox):
    def test_unhealthy_update_is_rolled_back_to_bundled_and_kept_for_diagnosis(self):
        self.make_update()
        for _ in range(up.MAX_UNHEALTHY_BOOTS):
            self.assertTrue(self.boot())
        self.assertFalse(self.boot())  # 第 4 次：放棄
        self.assertFalse((self.app / "update").exists())
        self.assertTrue((self.app / "update_bad" / "src" / "mod.py").exists())
        self.assertIn("1.0.14", up.load_state()["bad"])
        self.assertEqual(up.current_version()["version"], self.BUNDLED)
        self.assertFalse(self.boot())  # 之後沒有 update/ 也不會出錯

    def test_two_activations_in_one_process_count_as_one_boot(self):
        self.make_update()
        up._boot_counted = False
        self.assertTrue(up.activate_update_if_present())  # auto_update_on_boot
        self.assertTrue(up.activate_update_if_present())  # make_server
        self.assertEqual(up.load_state()["pending"]["boots"], 1)

    def test_mark_healthy_stops_the_countdown(self):
        self.make_update()
        self.assertTrue(self.boot())
        self.assertTrue(up.mark_healthy())
        self.assertFalse(up.mark_healthy())  # 已記錄過
        for _ in range(10):
            self.assertTrue(self.boot())
        self.assertTrue((self.app / "update").exists())

    def test_mark_healthy_without_an_active_update_does_nothing(self):
        self.assertFalse(up.mark_healthy())

    def test_safe_mode_ignores_update_dir(self):
        self.make_update()
        with patch.dict("os.environ", {"TRADING_SAFE_MODE": "1"}):
            self.assertFalse(self.boot())
        self.assertTrue((self.app / "update").exists())  # 只是這次不載入，沒有被刪

    def test_update_not_newer_than_bundled_is_removed(self):
        self.make_update(version="1.0.12")
        self.assertFalse(self.boot())
        self.assertFalse((self.app / "update").exists())

    def test_server_package_path_is_extended_so_server_code_can_be_updated(self):
        import src.server
        self.make_update()
        self.assertTrue(self.boot())
        self.assertEqual(src.server.__path__[0], str(self.app / "update" / "src" / "server"))


class CheckAndApplyTests(Sandbox):
    def rel(self, version):
        return {"version": version, "tag": f"v{version}", "name": "x", "notes": "", "published_at": "", "url": ""}

    def test_bad_version_is_skipped_but_a_higher_one_still_updates(self):
        st = up.load_state()
        st["bad"]["1.0.14"] = {"reason": "x", "at": ""}
        up.save_state(st)
        with patch.object(up, "fetch_latest_release", return_value=self.rel("1.0.14")):
            r = up.check_update()
            self.assertFalse(r["has_update"])
            self.assertTrue(r["skipped_bad"])
            self.assertEqual(up.apply_update()["mode"], "skipped_bad")
        with patch.object(up, "fetch_latest_release", return_value=self.rel("1.0.15")):
            r = up.check_update()
            self.assertTrue(r["has_update"])  # 失敗不會讓之後的更新卡住
            self.assertFalse(r["skipped_bad"])

    def _zip(self, version, files):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("repo-x/src/version.py", f'APP_VERSION = "{version}"\n')
            zf.writestr("repo-x/web/index.html", '<script src="./app.bundle.js"></script>')
            for name, content in files.items():
                zf.writestr(f"repo-x/{name}", content)
        return buf.getvalue()

    class _Resp:
        def __init__(self, raw):
            self.raw = raw

        def read(self):
            return self.raw

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    def _download(self, raw, version="1.0.15"):
        with patch.object(up, "_urlopen", return_value=self._Resp(raw)), patch.object(up, "_reload_runtime"):
            return up._download_release(self.rel(version))

    def test_invalid_package_is_rejected_and_current_update_untouched(self):
        self.make_update()
        before = (self.app / "update" / "src" / "mod.py").read_text(encoding="utf-8")
        cases = {
            "語法錯誤": self._zip("1.0.15", {"src/broken.py": "def f(:\n", "web/app.bundle.js": "1"}),
            "引用的檔案不存在": self._zip("1.0.15", {"src/ok.py": "X = 1\n"}),  # index.html 引用 app.bundle.js 但沒附
        }
        for label, raw in cases.items():
            with self.subTest(label):
                with self.assertRaises(RuntimeError):
                    self._download(raw)
                self.assertEqual((self.app / "update" / "src" / "mod.py").read_text(encoding="utf-8"), before)
                self.assertFalse((self.app / "update_tmp").exists())

    def test_valid_package_is_applied_and_needs_a_fresh_health_report(self):
        raw = self._zip("1.0.15", {"src/ok.py": "X = 1\n", "web/app.bundle.js": "1"})
        r = self._download(raw)
        self.assertTrue(r["updated"])
        st = up.load_state()
        self.assertEqual(st["pending"], {"version": "1.0.15", "boots": 0})
        self.assertIsNone(st["ok"])

    def test_real_repo_passes_verification(self):
        """目前的程式碼本身要能通過自己的驗證，否則下一版發出去會被自己擋下來。"""
        up.verify_package(Path(__file__).resolve().parent.parent)


class OldUpdaterCompatTests(unittest.TestCase):
    def test_health_route_survives_an_old_bundled_updater(self):
        """舊版 exe：新的 api_server 從 update/ 載入，但 updater 是內建舊版（沒有 mark_healthy）。路由不能丟例外（會變成 500）。"""
        from src.server import api_server

        class OldUpdater:  # 沒有 mark_healthy
            pass

        with patch.object(api_server, "updater", OldUpdater()):
            self.assertEqual(api_server.ROUTES["/api/update/ok"]({}), {"ok": True, "recorded": False})


if __name__ == "__main__":
    unittest.main()
