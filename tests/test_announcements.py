import json
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock

from src.news import announcement_store
from src.news.news_feed import _twse_material


class TestAnnouncements(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = Path(tempfile.mkdtemp())
        self.orig_dir = announcement_store.announcements_dir
        announcement_store.announcements_dir = lambda: self.tmp_dir

    def tearDown(self):
        announcement_store.announcements_dir = self.orig_dir
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    def test_save_and_load_history(self):
        """驗證當日存檔與歷史重大訊息載入及去重"""
        mock_data_day1 = [
            {"公司代號": "2330", "發言日期": "1151020", "發言時間": "143000", "主旨": "公告本公司董事會重大決議", "符合條款": "第44款"},
            {"公司代號": "2454", "發言日期": "1151020", "發言時間": "150000", "主旨": "公告代子公司處分資產", "符合條款": "第20款"},
        ]
        # 模擬存入第一天
        f1 = self.tmp_dir / "twse_material_20261020.json"
        f1.write_text(json.dumps(mock_data_day1, ensure_ascii=False), encoding="utf-8")

        mock_data_day2 = [
            {"公司代號": "2330", "發言日期": "1151024", "發言時間": "091500", "主旨": "澄清媒體報導", "符合條款": "第26款"},
            # 重複項測試
            {"公司代號": "2330", "發言日期": "1151020", "發言時間": "143000", "主旨": "公告本公司董事會重大決議", "符合條款": "第44款"},
        ]
        announcement_store.save_today_twse_material(mock_data_day2)

        # 讀取 2330 的歷史重大訊息
        history_2330 = announcement_store.load_history_twse_material("2330", days=90)
        # 應有 2 筆（去重後）
        self.assertEqual(len(history_2330), 2)
        titles = [r["主旨"] for r in history_2330]
        self.assertIn("公告本公司董事會重大決議", titles)
        self.assertIn("澄清媒體報導", titles)

    @patch("src.news.news_feed.urllib.request.urlopen")
    def test_twse_material_merges_live_and_history(self, mock_urlopen):
        """驗證 _twse_material 結合即時回應與本地歷史累積"""
        # 本地先有一筆 10/20 的歷史紀錄
        f1 = self.tmp_dir / "twse_material_20261020.json"
        f1.write_text(
            json.dumps([{"公司代號": "2330", "發言日期": "1151020", "發言時間": "143000", "主旨": "歷史公告", "符合條款": "第1款"}], ensure_ascii=False),
            encoding="utf-8"
        )

        # 模擬 OpenAPI 回傳今日 10/24 另一筆
        mock_resp = MagicMock()
        mock_resp.read.return_value = json.dumps([
            {"公司代號": "2330", "發言日期": "1151024", "發言時間": "100000", "主旨": "今日公告", "符合條款": "第2款"}
        ]).encode("utf-8")
        mock_urlopen.return_value.__enter__.return_value = mock_resp

        items = _twse_material("2330")
        self.assertEqual(len(items), 2)
        item_titles = [it["title"] for it in items]
        self.assertIn("今日公告", item_titles)
        self.assertIn("歷史公告", item_titles)


if __name__ == "__main__":
    unittest.main()
