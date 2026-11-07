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

    def test_timeline_keeps_links_for_clicking(self):
        rows = [{"kw": {"title": "a", "iso": "2026-11-01T10:00"}, "s": "NEUTRAL"}]
        items = self.mk(*rows)
        items[0]["link"] = "https://example.com/a"
        tl = nd.summarize(items, [], "AI")["timeline"]
        self.assertEqual(tl[0]["link"], "https://example.com/a")

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

    def _build_with_ai(self, ai_by_no):
        bars = [Bar(f"2026-10-{d:02d}", 100, 101, 99, 100 + d % 3, 1000) for d in range(1, 29)]
        news = {"items": [
            {"title": "0050買在112元套牢逾500萬 憂台股難創新高 勸別急著砍", "source": "S", "link": "https://x/1", "kind": "新聞",
             "local_iso": "2026-10-20T09:00", "detail": ""},
        ], "sources": ["S"], "errors": []}
        res = {"by_no": ai_by_no, "reaction_changers": [], "unverified_numbers": []}
        with patch.object(nd.ai_client, "is_enabled", return_value=True),                 patch.object(nd, "_ai_fields", return_value=res):
            return nd.build(news, bars, "TW", 2.0, {"model": "m"}, "0050.TW", "0050")

    def test_ai_sentiment_replaces_keyword_guess(self):
        d = self._build_with_ai({1: {"sentiment": "NEUTRAL", "importance": 3}})
        it = d["items"][0]
        self.assertEqual(it["sentiment_rule"], "POSITIVE")  # 規則被「買」字騙了
        self.assertEqual(it["sentiment"], "NEUTRAL")
        self.assertEqual(it["sentiment_by"], "AI")
        self.assertEqual(d["summary"]["counts"]["positive"], 0)
        self.assertIn("沒讀內文", " ".join(d["summary"]["gaps"]))

    def test_missing_ai_sentiment_keeps_rule_and_says_so(self):
        d = self._build_with_ai({1: {"sentiment": None, "importance": 3}})
        self.assertEqual(d["items"][0]["sentiment_by"], "關鍵字規則")
        self.assertEqual(d["items"][0]["sentiment"], "POSITIVE")

    def test_prompt_asks_for_sentiment_by_meaning(self):
        sent = {}
        def fake(profile, prompt, timeout=0):
            sent["p"] = prompt
            return {"items": [{"no": 1, "sentiment": "BOGUS"}], "reaction_changers": []}
        with patch.object(nd.ai_client, "_json_call", side_effect=fake):
            res = nd._ai_fields({"model": "m"}, "0050.TW", "0050", [item("t")])
        self.assertIn("套牢", sent["p"])
        self.assertIn("NEUTRAL", sent["p"])
        self.assertIsNone(res["by_no"][1]["sentiment"])  # 不合法的值不採用

    def test_risk_lead_is_listed_when_lead_is_mild(self):
        items = self.mk({"kw": {"title": "產業合作消息", "iso": "2026-11-06T12:00"}, "s": "NEUTRAL"},
                        {"kw": {"title": "盤中急殺賣壓湧現", "iso": "2026-11-06T11:00"}, "s": "NEGATIVE"})
        items[1]["timing"] = "real_time"
        s = nd.summarize(items, [], "AI")
        self.assertEqual(s["lead"]["title"], "產業合作消息")
        self.assertEqual(s["risk_lead"]["title"], "盤中急殺賣壓湧現")
        self.assertEqual(s["risk_lead"]["timing"], "real_time")

    def test_no_risk_lead_when_lead_is_already_negative_or_none_negative(self):
        neg_lead = self.mk({"kw": {"title": "a"}, "s": "NEGATIVE"}, {"kw": {"title": "b"}, "s": "NEGATIVE"})
        self.assertIsNone(nd.summarize(neg_lead, [], "AI")["risk_lead"])
        calm = self.mk({"kw": {"title": "a"}, "s": "POSITIVE"}, {"kw": {"title": "b"}, "s": "NEUTRAL"})
        self.assertIsNone(nd.summarize(calm, [], "AI")["risk_lead"])

    def test_fulltext_hint_and_timing_parse(self):
        d = self._build_with_ai({1: {"sentiment": "NEGATIVE", "timing": "real_time", "importance": 4}})
        self.assertIn(d["items"][0]["timing"], ("real_time",))
        self.assertTrue(nd.CHECK_TEXT_RE.search("台股一度重挫刷新最大跌點"))
        self.assertFalse(nd.CHECK_TEXT_RE.search("公司召開股東會"))

    def test_prompt_separates_retrospective_from_new_information(self):
        sent = {}
        def fake(profile, prompt, timeout=0):
            sent["p"] = prompt
            return {"items": [{"no": 1, "sentiment": "NEGATIVE", "timing": "weird"}], "reaction_changers": []}
        with patch.object(nd.ai_client, "_json_call", side_effect=fake):
            res = nd._ai_fields({"model": "m"}, "0050.TW", "0050", [item("t")])
        for word in ("retrospective", "catalyst", "real_time", "造成大跌的新資訊"):
            self.assertIn(word, sent["p"])
        self.assertIsNone(res["by_no"][1]["timing"])  # 不合法的類型不採用

    def test_ai_key_facts_include_risk_lead_and_timing(self):
        from src.ai.ai_client import key_facts
        text = key_facts("mod2", {"symbol": "0050.TW", "headline": "x", "news_research": {
            "tone": "中性", "counts": {}, "gaps": [],
            "risk_lead": {"title": "盤中急殺", "source": "S", "local_iso": "2026-11-06T11:00", "timing": "real_time"},
            "evidence": [{"no": 1, "time": "t", "kind": "新聞", "source": "S", "title": "盤中急殺", "sentiment": "NEGATIVE",
                          "timing": "real_time", "reaction_pct": -1}]}})
        self.assertIn("風險重點", text)
        self.assertIn("即時市場事件", text)

    def test_conflict_between_ai_and_rule_is_flagged(self):
        d = self._build_with_ai({1: {"sentiment": "NEGATIVE", "importance": 3}})  # 規則因「創新高」判利多
        self.assertTrue(d["items"][0]["sentiment_conflict"])
        self.assertIn("完全相反", " ".join(d["summary"]["gaps"]))
        d2 = self._build_with_ai({1: {"sentiment": "NEUTRAL", "importance": 3}})
        self.assertFalse(d2["items"][0]["sentiment_conflict"])

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
