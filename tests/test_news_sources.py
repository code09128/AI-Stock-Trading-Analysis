"""新聞來源解析：鉅亨網、Yahoo 奇摩 RSS、Google 限定站台、跨站去重、新聞彙整挑選（離線，不連網）。"""

import json
import unittest
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime
from unittest.mock import patch

from src.news import news_digest, news_feed

NOW = datetime.now(timezone.utc)


def _ts(hours_ago: float) -> int:
    return int((NOW - timedelta(hours=hours_ago)).timestamp())


def _rss(items) -> bytes:
    body = "".join(
        f"<item><title>{t}</title><link>https://x/{i}</link><pubDate>{format_datetime(NOW - timedelta(hours=h))}</pubDate>"
        f"<description>{d}</description><source url='https://s'>{src}</source></item>"
        for i, (t, h, d, src) in enumerate(items))
    return f"<rss><channel>{body}</channel></rss>".encode("utf-8")


class CnyesTests(unittest.TestCase):
    def _run(self, rows, query, code, market):
        payload = json.dumps({"items": {"data": rows}}).encode("utf-8")
        with patch.object(news_feed, "_get_text", return_value=payload):
            return news_feed._cnyes_news(query, code, market)

    def test_tw_parses_summary_and_strips_mark(self):
        rows = [{"newsId": 1, "title": "<mark>台積電</mark>擴產", "content": "<mark>台積電</mark>(2330-TW)宣布",
                 "publishAt": _ts(2), "titleWithKwd": 1, "category": [{"name": "台股新聞"}]}]
        got = self._run(rows, "台積電", "2330", "TW")
        self.assertEqual(len(got), 1)
        self.assertEqual(got[0]["title"], "台積電擴產")
        self.assertEqual(got[0]["detail"], "台積電(2330-TW)宣布")
        self.assertEqual(got[0]["link"], "https://news.cnyes.com/news/id/1")
        self.assertEqual(got[0]["source"], "鉅亨網")

    def test_us_keeps_only_relevant_and_skips_crypto_and_old(self):
        rows = [
            {"newsId": 1, "title": "輝達大漲", "content": "輝達(NVDA-US)股價", "publishAt": _ts(1), "titleWithKwd": 0},
            {"newsId": 2, "title": "Meme 幣股", "content": "$NVDA 代幣", "publishAt": _ts(1), "titleWithKwd": 0},
            {"newsId": 3, "title": "NVDA 永續合約", "content": "x", "publishAt": _ts(1), "titleWithKwd": 1,
             "category": [{"name": "快訊"}]},
            {"newsId": 4, "title": "舊聞", "content": "(NVDA-US)", "publishAt": _ts(24 * 40), "titleWithKwd": 1},
        ]
        got = self._run(rows, "NVDA", "NVDA", "US")
        self.assertEqual([g["link"][-1] for g in got], ["1"])


class YahooTwRssTests(unittest.TestCase):
    def test_announcement_kind_and_summary(self):
        raw = _rss([("【公告】環球晶召開法說會", 3, "日 期：2026年10月20日 &lt;b&gt;說明&lt;/b&gt;", "Yahoo"),
                    ("環球晶部分復工", 5, "中央社報導", "Yahoo")])
        with patch.object(news_feed, "_get_text", return_value=raw) as m:
            got = news_feed._yahoo_tw_rss("6488.TWO")
        self.assertIn("s=6488.TWO", m.call_args[0][0])
        self.assertEqual([g["kind"] for g in got], ["公司公告", "新聞"])
        self.assertEqual(got[0]["detail"], "日 期：2026年10月20日 說明")
        self.assertIn("公司公告", news_digest.OFFICIAL_KINDS)


class GoogleSiteTests(unittest.TestCase):
    def test_strips_site_suffix_filters_unrelated_and_old(self):
        raw = _rss([("台積電法說會重點- 新聞 - MoneyDJ理財網", 2, "", "MoneyDJ理財網"),
                    ("主力券商雷達- 績優券商", 2, "", "玩股網"),
                    ("台積電ROE排名 - 財報狗", 3, "", "財報狗"),
                    ("台積電去年舊文 - 財報狗", 24 * 60, "", "財報狗")])
        with patch.object(news_feed, "_get_text", return_value=raw) as m:
            got = news_feed._google_site(["wantgoo.com", "statementdog.com"], "台積電", "TW", "分析專欄",
                                         ["台積電", "2330"])
        self.assertIn("site%3Awantgoo.com+OR+site%3Astatementdog.com", m.call_args[0][0])
        self.assertEqual([g["title"] for g in got], ["台積電法說會重點", "台積電ROE排名"])
        self.assertTrue(all(g["kind"] == "分析專欄" for g in got))


class DedupeTests(unittest.TestCase):
    def test_same_story_kept_once_and_borrows_summary(self):
        a = news_feed._item("台積電 運動會取消", "Google", "l1", NOW, "新聞", "TW")
        b = news_feed._item("台積電運動會取消！", "鉅亨網", "l2", NOW - timedelta(minutes=5), "新聞", "TW", "摘要內容")
        c = news_feed._item("另一則", "Yahoo", "l3", NOW - timedelta(hours=1), "新聞", "TW")
        got = news_feed.dedupe([c, b, a])
        self.assertEqual([g["link"] for g in got], ["l1", "l3"])
        self.assertEqual(got[0]["detail"], "摘要內容")


class FetchIsolationTests(unittest.TestCase):
    def test_one_source_failing_does_not_hide_others(self):
        news_feed._CACHE.clear()
        ok = [news_feed._item("台積電新聞", "鉅亨網", "l", NOW, "新聞", "TW", "摘要")]
        with patch.object(news_feed, "_google_news", return_value=[]), \
                patch.object(news_feed, "_cnyes_news", side_effect=OSError("cnyes down")), \
                patch.object(news_feed, "_yahoo_tw_rss", return_value=ok), \
                patch.object(news_feed, "_google_site", return_value=[]), \
                patch.object(news_feed, "_twse_material", return_value=[]):
            r = news_feed.fetch_news("2330", "台積電")
        news_feed._CACHE.clear()
        self.assertEqual(len(r["items"]), 1)
        self.assertTrue(any("鉅亨網 抓取失敗" in e for e in r["errors"]))
        self.assertIn("Yahoo奇摩股市：1 則", r["sources"])


class DigestPickTests(unittest.TestCase):
    def test_columns_only_fill_leftover_slots_and_summary_goes_to_ai(self):
        news = {"items": [news_feed._item(f"台積電專欄{i}", "財報狗", "l", NOW, "分析專欄", "TW") for i in range(5)]
                + [news_feed._item("台積電月營收創高", "鉅亨網", "l", NOW - timedelta(days=1), "新聞", "TW",
                                   "9 月營收 3000 億元")]}
        cap = {}

        def fake(profile, prompt, timeout=90):
            cap["prompt"] = prompt
            return {"items": [{"no": 1, "what": "營收 3000 億元", "importance": 4}]}

        with patch.object(news_digest.ai_client, "is_enabled", return_value=True), \
                patch.object(news_digest.ai_client, "_json_call", side_effect=fake):
            d = news_digest.build(news, [], "TW", None, {"model": "m"}, "2330.TW", "台積電")
        self.assertEqual(d["items"][0]["kind"], "新聞")  # 新聞排在專欄前面挑選
        self.assertEqual(len(d["items"]), 6)
        self.assertIn("9 月營收 3000 億元", cap["prompt"])
        self.assertIn("營收", d["items"][0]["metrics"])  # 規則也看摘要
        self.assertEqual(d["unverified_numbers"], [])  # 摘要裡有的數字不算編造


if __name__ == "__main__":
    unittest.main()
