"""新聞研究摘要：關鍵字情緒、整體語氣、資料缺口、時間軸（離線）。"""

import unittest
from unittest.mock import patch

from src.market.bar import Bar
from src.news import news_digest as nd


def item(title, kind="新聞", iso="2026-11-06T10:00", official=False, reaction=None, score=1.0, source="X"):
    return {
        "title": title, "kind": kind, "local_iso": iso, "source": source, "link": "", "detail": "",
        "official": official, "reaction": reaction, "rule_score": score, "metrics": [], "mentions": True,
    }


class RuleSentimentTests(unittest.TestCase):
    def test_positive_negative_neutral(self):
        self.assertEqual(nd.rule_sentiment("台積電上修全年營收預測，外資買超")[0], "POSITIVE")
        self.assertEqual(nd.rule_sentiment("公司下修財測，法人賣超")[0], "NEGATIVE")
        self.assertEqual(nd.rule_sentiment("公司召開股東會")[0], "NEUTRAL")

    def test_english_titles(self):
        self.assertEqual(nd.rule_sentiment("TSMC raises guidance, record revenue")[0], "POSITIVE")
        self.assertEqual(nd.rule_sentiment("Chipmaker cuts outlook after probe")[0], "NEGATIVE")

    def test_mixed_equal_counts_is_neutral_and_reports_hits(self):
        s, hits = nd.rule_sentiment("上修毛利率但下修營收")
        self.assertEqual(s, "NEUTRAL")
        self.assertTrue(any("上修" in h for h in hits) and any("下修" in h for h in hits))

    def test_hits_are_reported(self):
        s, hits = nd.rule_sentiment("外資買超創高")
        self.assertEqual(s, "POSITIVE")
        self.assertIn("買超", hits)


class SummaryTests(unittest.TestCase):
    def mk(self, *rows):
        items = []
        for r in rows:
            x = item(**r["kw"])
            x["sentiment"], x["sentiment_hits"] = r["s"], []
            items.append(x)
        return items

    def test_tone_bullish_when_positive_dominates(self):
        items = self.mk(
            {"kw": {"title": "a"}, "s": "POSITIVE"}, {"kw": {"title": "b"}, "s": "POSITIVE"},
            {"kw": {"title": "c"}, "s": "NEGATIVE"},
        )
        s = nd.summarize(items, [], "AI")
        self.assertEqual(s["tone"], "偏多")
        self.assertEqual(s["counts"]["positive"], 2)
        self.assertEqual(s["counts"]["negative"], 1)

    def test_official_announcement_weighs_more(self):
        items = self.mk(
            {"kw": {"title": "a", "kind": "重大訊息", "official": True}, "s": "NEGATIVE"},
            {"kw": {"title": "b"}, "s": "POSITIVE"},
        )
        self.assertEqual(nd.summarize(items, [], "AI")["tone"], "偏空")  # 官方 3 分 vs 一般 1 分

    def test_split_and_neutral(self):
        split = self.mk({"kw": {"title": "a"}, "s": "POSITIVE"}, {"kw": {"title": "b"}, "s": "NEGATIVE"})
        self.assertEqual(nd.summarize(split, [], "AI")["tone"], "分歧")
        flat = self.mk({"kw": {"title": "a"}, "s": "NEUTRAL"})
        self.assertEqual(nd.summarize(flat, [], "AI")["tone"], "中性")

    def test_columns_are_not_counted_as_events(self):
        items = self.mk(
            {"kw": {"title": "a", "kind": nd.COLUMN_KIND}, "s": "POSITIVE"},
            {"kw": {"title": "b"}, "s": "NEGATIVE"},
        )
        s = nd.summarize(items, [], "AI")
        self.assertEqual(s["counts"]["column"], 1)
        self.assertEqual(s["counts"]["positive"], 0)
        self.assertEqual(s["lead"]["title"], "b")  # 專欄不能當重點新聞

    def test_gaps_are_listed_honestly(self):
        s = nd.summarize([], ["Google News: timeout"], nd_mode := "RULES")
        text = " ".join(s["gaps"])
        self.assertIn("沒有抓到", text)
        self.assertIn("來源抓取失敗", text)
        self.assertIsNone(s["lead"])
        self.assertEqual(s["tone"], "資料不足")
        self.assertEqual(nd_mode, "RULES")

    def test_gap_no_official_and_few_items_and_rules_mode(self):
        items = self.mk({"kw": {"title": "a"}, "s": "POSITIVE"})
        text = " ".join(nd.summarize(items, [], "RULES")["gaps"])
        self.assertIn("少於 3 則", text)
        self.assertIn("沒有官方公告", text)
        self.assertIn("未使用 AI", text)

    def test_unrelated_titles_are_excluded_but_reported(self):
        unrelated = {"kw": {"title": "柏林安全會議"}, "s": "POSITIVE"}
        unrelated["kw"]["official"] = False
        items = self.mk({"kw": {"title": "台積電上修"}, "s": "NEUTRAL"}, unrelated)
        items[1]["mentions"] = False
        s = nd.summarize(items, [], "AI")
        self.assertEqual(s["counts"]["unrelated"], 1)
        self.assertEqual(s["counts"]["positive"], 0)  # 無關新聞不能把語氣拉偏
        self.assertEqual([t["title"] for t in s["timeline"]], ["台積電上修"])
        self.assertIn("沒有提到這檔", " ".join(s["gaps"]))

    def test_few_directional_items_warns(self):
        items = self.mk({"kw": {"title": "a"}, "s": "POSITIVE"}, {"kw": {"title": "b"}, "s": "POSITIVE"},
                        {"kw": {"title": "c"}, "s": "NEUTRAL"})
        text = " ".join(nd.summarize(items, [], "AI")["gaps"])
        self.assertIn("語氣僅供參考", text)
        many = self.mk(*[{"kw": {"title": str(i)}, "s": "POSITIVE"} for i in range(3)])
        self.assertNotIn("語氣僅供參考", " ".join(nd.summarize(many, [], "AI")["gaps"]))

    def test_pending_reaction_gap(self):
        items = self.mk({"kw": {"title": "a", "reaction": {"pending": True}}, "s": "POSITIVE"})
        self.assertIn("還沒有收盤", " ".join(nd.summarize(items, [], "AI")["gaps"]))

    def test_timeline_is_oldest_first_and_limited(self):
        rows = [{"kw": {"title": f"t{i}", "iso": f"2026-11-0{i + 1}T10:00"}, "s": "NEUTRAL"} for i in range(9)]
        tl = nd.summarize(self.mk(*rows), [], "AI")["timeline"]
        self.assertEqual(len(tl), 8)
        self.assertEqual([t["title"] for t in tl], sorted([t["title"] for t in tl], key=lambda x: int(x[1:])))
        self.assertEqual(tl[-1]["title"], "t8")  # 保留最新的 8 則

    def test_build_attaches_summary_and_sentiment(self):
        bars = [Bar(f"2026-10-{d:02d}", 100, 101, 99, 100 + d % 3, 1000) for d in range(1, 29)]
        news = {"items": [
            {"title": "台積電上修資本支出，外資買超", "source": "S", "link": "", "kind": "新聞",
             "local_iso": "2026-10-20T09:00", "detail": ""},
        ], "sources": ["S"], "errors": []}
        with patch.object(nd.ai_client, "is_enabled", return_value=False):
            d = nd.build(news, bars, "TW", 2.0, None, "2330.TW", "台積電")
        self.assertEqual(d["items"][0]["sentiment"], "POSITIVE")
        self.assertEqual(d["summary"]["lead"]["title"], "台積電上修資本支出，外資買超")
        self.assertEqual(d["summary"]["tone"], "偏多")
        self.assertIn("未使用 AI", " ".join(d["summary"]["gaps"]))

    def test_ai_gets_evidence_gaps_and_rules(self):
        # 功能改了，AI 看到的資料與提示也要跟著改：證據編號、缺口、語氣規則都要進關鍵數字卡與任務指示
        from src.ai.ai_client import key_facts
        from src.ai.ai_prompts import MODULE_TASKS

        data = {
            "symbol": "2330.TW", "headline": "台積電上修資本支出",
            "news_research": {
                "tone": "偏多", "counts": {"positive": 2, "negative": 0, "neutral": 1, "official": 0, "news": 3},
                "gaps": ["近期沒有官方公告"],
                "evidence": [{"no": 1, "time": "2026-11-06T10:00", "kind": "新聞", "source": "工商時報",
                              "title": "台積電上修資本支出", "sentiment": "POSITIVE", "reaction_pct": 1.2}],
            },
        }
        text = key_facts("mod2", data)
        self.assertIn("證據1", text)
        self.assertIn("工商時報", text)
        self.assertIn("資料缺口：近期沒有官方公告", text)
        self.assertIn("關鍵字規則", text)
        self.assertIn("證據編號", MODULE_TASKS["mod2"])
        self.assertNotIn("證據1", key_facts("mod2", {"symbol": "2330.TW", "headline": "x"}))


if __name__ == "__main__":
    unittest.main()
