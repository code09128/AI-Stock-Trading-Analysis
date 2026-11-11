"""新聞判斷品質：方向衝突不投票、風險重點獨立排序、涵蓋範圍說明、標題每日存檔（全部離線）。"""

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from src.news import news_archive
from src.news import news_digest as nd


def ev(title, sentiment, iso="2026-11-06T10:00", **extra):
    return {"title": title, "kind": "新聞", "local_iso": iso, "source": "X", "link": "", "detail": "", "official": False,
            "reaction": None, "rule_score": 1.0, "metrics": [], "mentions": True, "sentiment": sentiment, **extra}


class ConflictTests(unittest.TestCase):
    def test_conflicting_items_do_not_vote(self):
        items = [ev("a", "POSITIVE"), ev("b", "NEGATIVE", sentiment_conflict=True),
                 ev("c", "NEGATIVE", sentiment_conflict=True), ev("d", "NEGATIVE", sentiment_conflict=True)]
        s = nd.summarize(items, [], "AI")
        self.assertEqual(s["tone"], "偏多")  # 三則利空都有衝突，不算票
        self.assertEqual((s["counts"]["positive"], s["counts"]["negative"], s["counts"]["neutral"], s["counts"]["conflict"]),
                         (1, 0, 3, 3))
        self.assertIn("已不計入整體語氣", " ".join(s["gaps"]))

    def test_without_conflict_votes_as_before(self):
        s = nd.summarize([ev("a", "POSITIVE"), ev("b", "NEGATIVE"), ev("c", "NEGATIVE"), ev("d", "NEGATIVE")], [], "AI")
        self.assertEqual(s["tone"], "偏空")
        self.assertEqual(s["counts"]["conflict"], 0)

    def test_conflicting_item_is_not_the_risk_lead(self):
        items = [ev("合作消息", "NEUTRAL"), ev("恐慌賣壓", "NEGATIVE", sentiment_conflict=True)]
        self.assertIsNone(nd.summarize(items, [], "AI")["risk_lead"])


class RiskRankTests(unittest.TestCase):
    def test_risk_lead_prefers_urgent_event_over_earlier_mild_negative(self):
        items = [ev("合作消息", "NEUTRAL"), ev("分析師調降評等", "NEGATIVE"),
                 ev("盤中跌破整數關卡賣壓湧現", "NEGATIVE", timing="real_time")]
        self.assertEqual(nd.summarize(items, [], "AI")["risk_lead"]["title"], "盤中跌破整數關卡賣壓湧現")

    def test_bigger_drop_scores_higher(self):
        small = ev("x", "NEGATIVE", reaction={"pct": -1.0})
        big = ev("x", "NEGATIVE", reaction={"pct": -6.0})
        pending = ev("x", "NEGATIVE", reaction={"pct": -6.0, "pending": True})
        self.assertGreater(nd._risk_score(big), nd._risk_score(small))
        self.assertEqual(nd._risk_score(pending), 0.0)

    def test_coverage_note_is_listed_when_there_is_news(self):
        self.assertIn(nd.COVERAGE_NOTE, nd.summarize([ev("a", "NEUTRAL")], [], "RULES")["gaps"])
        self.assertNotIn(nd.COVERAGE_NOTE, nd.summarize([], [], "RULES")["gaps"])


class ArchiveTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.patch = patch.object(news_archive, "archive_dir", return_value=Path(self.tmp.name))
        self.patch.start()

    def tearDown(self):
        self.patch.stop()
        self.tmp.cleanup()

    def test_saves_once_and_keeps_only_listed_fields(self):
        items = [{"title": "台積電法說", "source": "鉅亨網", "kind": "新聞", "local_iso": "2026-11-06T10:00", "link": "l",
                  "detail": "很長的摘要不要存"}]
        self.assertEqual(news_archive.save("2330.TW", items), 1)
        self.assertEqual(news_archive.save("2330.TW", items), 0)  # 同一則不重複存
        self.assertEqual(news_archive.save("2317.TW", items), 1)  # 別檔股票算另一則
        rows = news_archive.load("2330.TW")
        self.assertEqual(len(rows), 1)
        self.assertEqual(set(rows[0]), {"symbol", *news_archive.FIELDS})

    def test_old_files_are_removed_and_bad_lines_skipped(self):
        folder = Path(self.tmp.name)
        (folder / "20200101.jsonl").write_text('{"symbol": "2330.TW", "title": "舊"}\n', encoding="utf-8")
        (folder / "notes.jsonl").write_text("不是存檔\n", encoding="utf-8")
        news_archive.save("2330.TW", [{"title": "新", "local_iso": "t"}])
        self.assertFalse((folder / "20200101.jsonl").exists())
        self.assertTrue((folder / "notes.jsonl").exists())  # 不是日期檔名的不動
        self.assertEqual([r["title"] for r in news_archive.load("2330.TW")], ["新"])

    def test_empty_input_or_write_error_does_not_raise(self):
        self.assertEqual(news_archive.save("", [{"title": "a"}]), 0)
        self.assertEqual(news_archive.save("2330.TW", []), 0)
        with patch.object(news_archive, "archive_dir", side_effect=OSError("唯讀")):
            self.assertEqual(news_archive.save("2330.TW", [{"title": "a"}]), 0)


if __name__ == "__main__":
    unittest.main()
