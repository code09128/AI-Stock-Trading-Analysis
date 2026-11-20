"""經濟日曆（src/market/econ_calendar.py）：全部離線，快取檔放暫存資料夾。"""

import json
import shutil
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest import mock

from src.market import econ_calendar as ec
from src.market.tz import zone

# 2026-11-18（三）12:00 美東 ＝ 台灣 11-19（四）01:00
NOW = datetime(2026, 11, 18, 12, 0, tzinfo=zone("America/New_York")).timestamp()
RAW = [
    {"title": "CPI m/m", "country": "USD", "date": "2026-11-18T08:30:00-05:00", "impact": "High", "forecast": "0.3%", "previous": "0.2%"},
    {"title": "Non-Farm Employment Change", "country": "USD", "date": "2026-11-20T08:30:00-05:00", "impact": "High", "forecast": "150K", "previous": "120K"},
    {"title": "Some Local Index", "country": "NZD", "date": "2026-11-19T16:30:00-05:00", "impact": "Low", "forecast": "", "previous": "50.9"},
    {"title": "Retail Sales y/y", "country": "CNY", "date": "2026-11-19T21:00:00-05:00", "impact": "High", "forecast": "", "previous": ""},
    {"title": "bad", "country": "USD", "date": "not a date", "impact": "High"},
]


class Base(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.p = mock.patch.object(ec.user_data, "data_dir", return_value=self.dir)
        self.p.start()
        ec._last_try = 0.0

    def tearDown(self):
        self.p.stop()
        shutil.rmtree(self.dir, ignore_errors=True)


class FetchCacheTests(Base):
    def test_fetch_once_then_disk_cache(self):
        with mock.patch.object(ec.qp, "_http_json", return_value=RAW) as h:
            d1 = ec.events(NOW)
            d2 = ec.events(NOW + 1800)  # 半小時內讀檔，不對外抓
        self.assertEqual(h.call_count, 1)
        self.assertTrue((self.dir / "econ_calendar.json").exists())
        self.assertEqual(len(d1["events"]), 4)  # 日期壞掉的那筆略過
        self.assertEqual(d1["events"], d2["events"])

    def test_refetch_after_an_hour(self):
        with mock.patch.object(ec.qp, "_http_json", return_value=RAW) as h:
            ec.events(NOW)
            ec.events(NOW + 3700)
        self.assertEqual(h.call_count, 2)

    def test_blocked_keeps_old_and_waits_before_retry(self):
        with mock.patch.object(ec.qp, "_http_json", return_value=RAW):
            ec.events(NOW)
        with mock.patch.object(ec.qp, "_http_json", side_effect=ValueError("Request Denied 網頁不是 JSON")) as h:
            d = ec.events(NOW + 3700)
            ec.events(NOW + 3800)  # 15 分鐘內不再試
        self.assertEqual(h.call_count, 1)
        self.assertTrue(d["stale"])
        self.assertEqual(len(d["events"]), 4)
        self.assertIsNone(d["error"])  # 有舊資料就不當錯誤顯示

    def test_first_fetch_fails(self):
        with mock.patch.object(ec.qp, "_http_json", side_effect=OSError("timeout")):
            d = ec.events(NOW)
        self.assertEqual(d["events"], [])
        self.assertIn("取得失敗", d["error"])

    def test_corrupt_file_ignored(self):
        (self.dir / "econ_calendar.json").write_text("{not json", encoding="utf-8")
        with mock.patch.object(ec.qp, "_http_json", return_value=RAW) as h:
            ec.events(NOW)
        self.assertEqual(h.call_count, 1)
        self.assertEqual(len(json.loads((self.dir / "econ_calendar.json").read_text(encoding="utf-8"))["raw"]), 5)


class EventTests(Base):
    def test_taiwan_time_and_fields(self):
        with mock.patch.object(ec.qp, "_http_json", return_value=RAW):
            evs = ec.events(NOW)["events"]
        cpi = evs[0]
        self.assertEqual((cpi["date"], cpi["time"], cpi["weekday"]), ("2026-11-18", "21:30", "三"))
        self.assertEqual((cpi["country_zh"], cpi["impact"], cpi["title_zh"]), ("美國", "高", "CPI 消費者物價指數 月增"))
        self.assertTrue(cpi["past"])
        nfp = next(e for e in evs if e["title"].startswith("Non-Farm"))
        self.assertFalse(nfp["past"])
        self.assertEqual(nfp["title_zh"], "非農就業人數")
        self.assertEqual(next(e for e in evs if e["country"] == "NZD")["title_zh"], "")  # 沒對到就留空

    def test_title_zh_prefers_longer(self):
        self.assertEqual(ec.title_zh("Core CPI m/m"), "核心 CPI 月增")
        self.assertEqual(ec.title_zh("ADP Non-Farm Employment Change"), "ADP 就業人數")
        self.assertEqual(ec.title_zh("Fed Chairman Warsh Speaks"), "聯準會主席談話 Warsh")


class BriefTests(Base):
    def test_upcoming_high_mid_us_cn_only(self):
        with mock.patch.object(ec.qp, "_http_json", return_value=RAW):
            b = ec.brief(NOW)
        self.assertIn("非農就業人數（影響高）（預測 150K，前值 120K）", b)
        self.assertIn("中國 零售銷售 年增", b)
        self.assertNotIn("CPI", b)  # 已經公布
        self.assertNotIn("紐西蘭", b)

    def test_only_previous_no_empty_forecast(self):
        raw = [{"title": "Revised UoM Inflation Expectations", "country": "USD", "date": "2026-11-20T10:00:00-05:00",
                "impact": "Medium", "forecast": "", "previous": "4.3%"}]
        with mock.patch.object(ec.qp, "_http_json", return_value=raw):
            b = ec.brief(NOW)
        self.assertIn("密大通膨預期終值（影響中）（前值 4.3%）", b)
        self.assertNotIn("預測 ，", b)

    def test_empty_when_nothing(self):
        with mock.patch.object(ec.qp, "_http_json", return_value=[]):
            self.assertEqual(ec.brief(NOW), "")


if __name__ == "__main__":
    unittest.main()
