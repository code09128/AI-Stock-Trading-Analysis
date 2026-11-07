"""
近期新聞彙整 (news_digest.py)
對一檔標的的近期新聞（news_feed 抓的真實標題與摘要）逐則整理 5 個面向，並依重要性排序：
  1. 實際發生什麼事  2. 投資人為何需要關注  3. 影響偏短期或長期
  4. 哪些財務指標可能受影響  5. 市場可能隱含哪些假設
另外用真實日 K 計算每則新聞「發布前最後收盤 → 發布後第一個收盤」的實際價格反應，當作客觀的重要性依據。
- 有設定 AI：5 個面向由 AI 依標題整理，系統再檢查格式並標出資料裡沒有的數字
- 沒有 AI：用關鍵字規則判斷影響期間與財務指標，「發生什麼事／隱含假設」標示需要 AI
"""

import json
import re
from datetime import datetime
from typing import Any, Dict, List, Optional

from src.ai import ai_client

from src.market import markets
from src.market.bar import Bar
from src.market.tz import zone

MAX_ITEMS = 12
METRIC_RULES = [
    (r"營收|revenue|sales|出貨|訂單|orders?", "營收"),
    (r"毛利|margin|價格|漲價|降價|報價|price", "毛利率"),
    (r"EPS|獲利|盈餘|淨利|earnings|profit|財報|季報|法說", "EPS"),
    (r"資本支出|擴產|建廠|新廠|產能|capex|capacity|fab|plant", "資本支出"),
    (r"股利|配息|除息|dividend|買回|庫藏股|buyback", "股利／股東回饋"),
    (r"併購|收購|acqui|merger|入股|stake", "資產負債（併購）"),
    (r"關稅|tariff|管制|制裁|ban|export control|禁令|政策|法規|regulat", "營收（政策風險）"),
    (r"本益比|估值|valuation|目標價|price target|評等|upgrade|downgrade|調升|調降", "評價（本益比）"),
]
LONG_TERM = re.compile(r"擴產|建廠|產能|併購|收購|新產品|技術|製程|政策|法規|關稅|管制|策略|合作|capacity|acqui|merger|tariff|regulat|partnership|launch", re.I)
SHORT_TERM = re.compile(r"財報|季報|月營收|營收|法說|除息|目標價|評等|EPS|earnings|guidance|price target|upgrade|downgrade", re.I)
OFFICIAL_KINDS = ("重大訊息", "公司公告", "8-K")
TIMINGS = ("retrospective", "catalyst", "real_time")
# 標題常低估內文的負面程度：含這些字的新聞在畫面上提醒「點原文確認」（我們只讀標題與摘要，沒有抓內文）
CHECK_TEXT_RE = re.compile(r"大跌|重挫|崩|殺低|恐慌|賣壓|跌破|熔斷|避險|下修|警示|停損|爆量|暴跌|急殺|斷頭|違約|調降")
COLUMN_KIND = "分析專欄"  # 觀點文章，不是事件；新聞不夠 MAX_ITEMS 則時才補進來
HORIZONS = ("短期", "長期", "短期與長期")


def _close_hour(market: str) -> str:
    return markets.info(market)["sessions"][-1][1]


def price_reaction(bars: List[Bar], local_iso: str, market: str) -> Optional[Dict[str, Any]]:
    """發布前最後一個已知收盤 → 發布後第一個收盤。收盤後才發布的新聞，當天收盤算「發布前」。"""
    if len(local_iso) < 16 or not bars:
        return None
    day, hm = local_iso[:10], local_iso[11:16]
    after_close = hm >= _close_hour(market)
    before = [b for b in bars if (b.timestamp <= day if after_close else b.timestamp < day)]
    after = [b for b in bars if b.timestamp > before[-1].timestamp] if before else []
    if not before or not after:
        return {"pending": True, "note": "發布後還沒有收盤，尚無反應"}
    pct = (after[0].close / before[-1].close - 1) * 100
    out = {"pending": False, "from": before[-1].timestamp, "to": after[0].timestamp, "pct": round(pct, 2)}
    if after[0] is bars[-1]:
        now = datetime.now(zone(markets.info(market)["tz"]))
        if after[0].timestamp == now.strftime("%Y-%m-%d") and now.strftime("%H:%M") < _close_hour(market):
            out["note"] = "今天還在盤中，收盤價是暫定"
    return out


def _mentions(title: str, symbol: str, name: str) -> bool:
    code = symbol.split(".")[0]
    keys = [code] + ([name, name.split()[0]] if name else [])
    t = title.lower()
    return any(k and len(k) >= 2 and k.lower() in t for k in keys)


def _rule_fields(title: str, kind: str, detail: str = "") -> Dict[str, Any]:
    metrics = [m for pat, m in METRIC_RULES if re.search(pat, f"{title} {detail}", re.I)]
    lt, st = bool(LONG_TERM.search(title)), bool(SHORT_TERM.search(title))
    horizon = "短期與長期" if lt and st else "長期" if lt else "短期" if st else None
    return {"metrics": metrics, "horizon": horizon, "official": any(k in kind for k in OFFICIAL_KINDS)}


POS_RE = re.compile(r"上修|調升|調高|創高|新高|買超|轉盈|優於預期|超預期|大漲|飆|看好|受惠|擴產|接單|得標|"
                    r"beat|upgrade|raises?|record|surge|rally|strong", re.I)
NEG_RE = re.compile(r"下修|調降|調低|創低|新低|賣超|虧損|轉虧|衰退|低於預期|大跌|重挫|暴跌|示警|減產|裁員|罰款|調查|下滑|砍單|"
                    r"miss|downgrade|cuts?|plunge|slump|probe|lawsuit|warning|weak", re.I)


# 近期樣本對照（tools/backtest_news_tone.py，2026-11-07，9 檔台美股 55 則標題）：偏多標題發布後首個收盤方向相符 32%（平均 -0.63%），
# 偏空 83%（平均 -3.42%）；期間大盤整體下跌、免費來源沒有歷史標題，樣本太少，不能證明語氣有預測力。
def rule_sentiment(text: str):
    """用標題裡的利多／利空關鍵字粗略判斷方向，回傳 (POSITIVE|NEGATIVE|NEUTRAL, 命中的關鍵字)。

    限制（要升級就改用 AI 判斷）：只數關鍵字，看不懂否定（例如「不看好」會被算成利多）、反話與整句語意；
    正負數量相同一律算 NEUTRAL。只當沒有 AI 時的粗略參考，不是結論。
    """
    pos = [m.group(0) for m in POS_RE.finditer(text or "")]
    neg = [m.group(0) for m in NEG_RE.finditer(text or "")]
    hits = [*dict.fromkeys(pos), *dict.fromkeys(neg)]
    if len(pos) > len(neg):
        return "POSITIVE", hits
    if len(neg) > len(pos):
        return "NEGATIVE", hits
    return "NEUTRAL", hits


MIN_EVIDENCE = 3  # 少於這個則數，結論代表性不足
DECISIVE_MIN = 3  # 有利多／利空方向的新聞少於這個則數，語氣只能參考
TIMELINE_MAX = 8
OFFICIAL_WEIGHT = 3  # 官方公告在語氣投票的權重（一般新聞 1）


def summarize(items: List[Dict[str, Any]], errors: List[str], mode: str) -> Dict[str, Any]:
    """把已排序的新聞整理成研究摘要：重點新聞、整體語氣、數量、資料缺口、時間軸。

    columns（分析專欄）是觀點不是事件，不算進語氣、重點與時間軸。
    """
    non_column = [x for x in items if x["kind"] != COLUMN_KIND]
    # 標題沒提到這檔（也不是官方公告）的新聞常是同一來源順帶列出的無關報導，不計入語氣、重點與時間軸
    events = [x for x in non_column if x.get("mentions", True)]
    counts = {"official": 0, "news": 0, "column": len(items) - len(non_column), "unrelated": len(non_column) - len(events),
              "positive": 0, "negative": 0, "neutral": 0}
    w_pos = w_neg = 0
    for x in events:
        counts["official" if x.get("official") else "news"] += 1
        w = OFFICIAL_WEIGHT if x.get("official") else 1
        sent = x.get("sentiment", "NEUTRAL")
        if sent == "POSITIVE":
            counts["positive"] += 1
            w_pos += w
        elif sent == "NEGATIVE":
            counts["negative"] += 1
            w_neg += w
        else:
            counts["neutral"] += 1
    if not events:
        tone = "資料不足"
    elif w_pos and w_pos >= 1.5 * w_neg:
        tone = "偏多"
    elif w_neg and w_neg >= 1.5 * w_pos:
        tone = "偏空"
    elif w_pos and w_neg:
        tone = "分歧"
    else:
        tone = "中性"

    lead = None
    if events:
        e = events[0]
        lead = {k: e.get(k) for k in ("title", "source", "kind", "local_iso", "link", "sentiment", "sentiment_by", "timing", "reaction")}

    # 風險重點：重點新聞是溫和題材時，高波動的風險事件（利空）不能被蓋掉，另外列出一則
    risk_lead = None
    for e in events:
        if e.get("sentiment") == "NEGATIVE" and not (lead and e["title"] == lead["title"] and e["local_iso"] == lead["local_iso"]):
            risk_lead = {k: e.get(k) for k in ("title", "source", "kind", "local_iso", "link", "sentiment_by", "timing", "check_fulltext")}
            break
    if lead and lead.get("sentiment") == "NEGATIVE":
        risk_lead = None  # 重點新聞本身就是利空，不用重複

    gaps: List[str] = []
    if not events:
        gaps.append("沒有抓到這檔近期的新聞或公告，無法做新聞面判斷")
    elif len(events) < MIN_EVIDENCE:
        gaps.append(f"新聞與公告只有 {len(events)} 則（少於 {MIN_EVIDENCE} 則），結論代表性不足")
    if counts["unrelated"]:
        gaps.append(f"{counts['unrelated']} 則新聞標題沒有提到這檔，已不計入語氣與時間軸")
    if events and counts["positive"] + counts["negative"] < DECISIVE_MIN:
        gaps.append(f"有明確利多或利空方向的新聞只有 {counts['positive'] + counts['negative']} 則"
                    f"（少於 {DECISIVE_MIN} 則），語氣僅供參考")
    if events and counts["official"] == 0:
        gaps.append("近期沒有官方公告（重大訊息、公司公告、8-K），無法用公司自己的說法交叉驗證")
    if errors:
        gaps.append(f"{len(errors)} 個新聞來源抓取失敗，可能漏掉部分報導")
    if lead and (lead.get("reaction") or {}).get("pending"):
        gaps.append("重點新聞發布後還沒有收盤，價格反應尚未出現")
    if mode == "RULES" and events:
        gaps.append("未使用 AI：只有關鍵字規則，看不懂否定或標題以外的細節")
    elif events:
        gaps.append("新聞方向由 AI 只依標題與摘要判斷，沒讀內文，仍可能誤判")
        n_conf = sum(1 for x in events if x.get("sentiment_conflict"))
        if n_conf:
            gaps.append(f"{n_conf} 則的 AI 方向和關鍵字規則完全相反（一個利多、一個利空），其中至少一個判斷有誤，語氣請保守看待，建議點原文確認")

    timeline = [
        {"local_iso": x["local_iso"], "title": x["title"], "source": x["source"], "kind": x["kind"],
         "link": x.get("link") or "", "sentiment": x.get("sentiment"), "pct": (x.get("reaction") or {}).get("pct")}
        for x in sorted(events, key=lambda x: x["local_iso"])[-TIMELINE_MAX:]
    ]
    return {"tone": tone, "counts": counts, "lead": lead, "risk_lead": risk_lead, "gaps": gaps, "timeline": timeline}


def _rule_score(it: Dict[str, Any], atr_pct: Optional[float]) -> float:
    s = 2.0 if it["official"] else 0.0
    s += 1.0 if it["mentions"] else -1.0
    s += min(len(it["metrics"]), 2)
    r = it.get("reaction") or {}
    if not r.get("pending") and r.get("pct") is not None and atr_pct:
        s += min(abs(r["pct"]) / atr_pct, 3)  # 反應超過 1 個 ATR＝市場明顯有感
    return round(s, 2)


def _ai_fields(profile: Dict[str, Any], symbol: str, name: str, items: List[Dict[str, Any]]) -> Dict[str, Any]:
    rows = [{"no": i + 1, "date": it["local_iso"][:16], "kind": it["kind"], "source": it["source"],
             "title": it["title"], **({"summary": it["detail"]} if it.get("detail") else {}),
             "price_reaction_pct": (it.get("reaction") or {}).get("pct")}
            for i, it in enumerate(items)]
    data = json.dumps(rows, ensure_ascii=False)
    out = ai_client._json_call(profile, (
        f"以下是 {name or symbol}（{symbol}）近期的新聞標題（部分附 summary 摘要），kind＝分析專欄的是觀點文章不是事件；price_reaction_pct 是發布前最後收盤到發布後第一個收盤的真實漲跌幅（null＝尚無）。"
        "請逐則整理，只能根據標題、摘要與提供的數字，不要編造以外的細節或數字；資訊不足就寫「標題資訊不足」。\n"
        f"sentiment＝這則消息對 {name or symbol} 股價的方向：POSITIVE（實質利多，如財報／營收／訂單優於預期、上修財測、正面事件）、"
        "NEGATIVE（實質利空）、NEUTRAL（無明確方向）。要看語意而不是字眼。先判斷 timing：retrospective＝事後行情回顧"
        "（例如收盤後的「收跌多少」「昨日重挫」）、catalyst＝帶有新資訊的消息（財測、法說、政策、總經數據、供應鏈、評等調整、資金流向變化）、"
        "real_time＝盤中或開盤前正在發展的市場事件（例如盤中跌破整數關卡、賣壓湧現、避險升溫）。"
        "再給方向：retrospective 除非內文提出新的前瞻原因，一律 NEUTRAL；catalyst 依資訊本身判斷方向，即使標題同時描述已發生的漲跌；"
        "real_time 可以判 NEGATIVE／POSITIVE（代表風險或動能升高，是市場反應而不是基本面）。"
        "「價格已經大跌」和「造成大跌的新資訊」要分開看。投資人套牢或虧損心得、盤勢流水帳、排行榜與成交量統計、與這檔無關的新聞一律 NEUTRAL。\n"
        f"【新聞】{data}\n"
        '回傳 JSON：{"items": [{"no": 編號, "what": "實際發生什麼事（一句話）", "why": "投資人為何需要關注", '
        '"horizon": "短期"|"長期"|"短期與長期", "metrics": ["可能受影響的財務指標，如營收、毛利率、EPS、資本支出"], '
        '"assumptions": "市場可能隱含的假設", "importance": 1到5的整數（5 最重要）, "sentiment": "POSITIVE"|"NEGATIVE"|"NEUTRAL", "timing": "retrospective"|"catalyst"|"real_time"}], '
        '"reaction_changers": ["哪些因素可能改變目前的市場反應（2 到 4 點）"]}'
    ), timeout=180)
    got = out.get("items")
    if not isinstance(got, list) or not got:
        raise ai_client.AIError("AI 沒有回傳新聞整理")
    by_no: Dict[int, Dict[str, Any]] = {}
    for g in got:
        try:
            no = int(g.get("no"))
        except (TypeError, ValueError):
            continue
        if 1 <= no <= len(items):
            imp = g.get("importance")
            by_no[no] = {
                "what": str(g.get("what", ""))[:200], "why": str(g.get("why", ""))[:200],
                "horizon": g.get("horizon") if g.get("horizon") in HORIZONS else None,
                "metrics": [str(m)[:20] for m in (g.get("metrics") or []) if m][:4],
                "assumptions": str(g.get("assumptions", ""))[:200],
                "importance": int(imp) if isinstance(imp, (int, float)) and 1 <= imp <= 5 else None,
                "sentiment": g.get("sentiment") if g.get("sentiment") in ("POSITIVE", "NEGATIVE", "NEUTRAL") else None,
                "timing": g.get("timing") if g.get("timing") in TIMINGS else None,
            }
    if not by_no:
        raise ai_client.AIError("AI 回傳的新聞編號都對不上")
    changers = [str(x)[:160] for x in (out.get("reaction_changers") or []) if x][:4]
    text = " ".join(json.dumps(v, ensure_ascii=False) for v in by_no.values()) + " ".join(changers)
    return {"by_no": by_no, "reaction_changers": changers,
            "unverified_numbers": ai_client.unverified_numbers(text, data)}


def build(news: Dict[str, Any], bars: List[Bar], market: str, atr: Optional[float],
          profile: Optional[Dict[str, Any]], symbol: str, name: str) -> Dict[str, Any]:
    price = bars[-1].close if bars else None
    atr_pct = round(atr / price * 100, 2) if atr and price else None
    items = []
    raw = news.get("items", [])
    picked = [it for it in raw if it["kind"] != COLUMN_KIND][:MAX_ITEMS]
    picked += [it for it in raw if it["kind"] == COLUMN_KIND][:MAX_ITEMS - len(picked)]
    for it in picked:
        x = {k: it[k] for k in ("title", "source", "link", "kind", "local_iso")}
        x["detail"] = it.get("detail", "")
        x["reaction"] = price_reaction(bars, it["local_iso"], market)
        x.update(_rule_fields(it["title"], it["kind"], x["detail"]))
        x["sentiment"], x["sentiment_hits"] = rule_sentiment(f"{it['title']} {x['detail']}")
        x["sentiment_by"] = "關鍵字規則"
        x["check_fulltext"] = bool(CHECK_TEXT_RE.search(f"{it['title']} {x['detail']}"))
        x["mentions"] = x["official"] or _mentions(it["title"], symbol, name)
        x["rule_score"] = _rule_score(x, atr_pct)
        items.append(x)

    mode, ai_err, changers, unverified = "RULES", None, [], []
    if items and ai_client.is_enabled(profile):
        try:
            res = _ai_fields(profile, symbol, name, items)
            for i, x in enumerate(items, start=1):
                f = res["by_no"].get(i)
                if f:
                    x["ai"] = f
                    x["timing"] = f.get("timing")
                    if f.get("sentiment"):  # AI 看語意判斷方向，取代關鍵字規則（規則的結果留在 sentiment_rule 供對照）
                        x["sentiment_rule"], x["sentiment"], x["sentiment_by"] = x["sentiment"], f["sentiment"], "AI"
                        # 兩種方法方向完全相反（一個利多、一個利空）時，至少有一個錯：標出來請使用者點原文確認
                        x["sentiment_conflict"] = {x["sentiment_rule"], x["sentiment"]} == {"POSITIVE", "NEGATIVE"}
            changers, unverified = res["reaction_changers"], res["unverified_numbers"]
            mode = f"AI（{profile.get('model')}）"
        except ai_client.AIError as e:
            ai_err = f"AI 整理失敗，已改用關鍵字規則。{ai_client.friendly_error(e)}"

    # 排序：AI 的重要性為主、規則分數（官方公告、財務指標、實際價格反應）為輔
    items.sort(key=lambda x: (-((x.get("ai") or {}).get("importance") or 0), -x["rule_score"]))
    if not changers:
        changers = [
            "下一次財報或月營收公布的實際數字與市場預期的落差",
            "公司在法說會或財測中對下一季的展望是否改變",
            "股價收盤是否跌破或站上關鍵價位（請對照技術分析頁的三情境）",
        ]
    return {
        "symbol": symbol, "name": name, "mode": mode, "ai_error": ai_err,
        "atr_pct": atr_pct, "items": items, "reaction_changers": changers,
        "unverified_numbers": unverified,
        "summary": summarize(items, news.get("errors", []), mode if mode == "RULES" else "AI"),
        "sources": news.get("sources", []), "errors": news.get("errors", []),
        "method": ("價格反應＝發布前最後一個收盤到發布後第一個收盤的真實漲跌；超過 1 個 ATR（近 14 日平均波動）代表市場明顯有感。"
                   "同一天的多則新聞會共用同一個價格反應，無法分辨是哪一則造成的。"
                   "排序依 AI 重要性（有設定時），再參考是否為官方公告、標題是否提到這檔、牽涉的財務指標數與實際價格反應。"),
    }
