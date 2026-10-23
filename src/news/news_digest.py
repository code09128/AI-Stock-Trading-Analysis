"""
近期新聞彙整 (news_digest.py)
對一檔標的的近期新聞（news_feed 抓的真實標題）逐則整理 5 個面向，並依重要性排序：
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
OFFICIAL_KINDS = ("重大訊息", "8-K")
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


def _rule_fields(title: str, kind: str) -> Dict[str, Any]:
    metrics = [m for pat, m in METRIC_RULES if re.search(pat, title, re.I)]
    lt, st = bool(LONG_TERM.search(title)), bool(SHORT_TERM.search(title))
    horizon = "短期與長期" if lt and st else "長期" if lt else "短期" if st else None
    return {"metrics": metrics, "horizon": horizon, "official": any(k in kind for k in OFFICIAL_KINDS)}


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
             "title": it["title"], "price_reaction_pct": (it.get("reaction") or {}).get("pct")}
            for i, it in enumerate(items)]
    data = json.dumps(rows, ensure_ascii=False)
    out = ai_client._json_call(profile, (
        f"以下是 {name or symbol}（{symbol}）近期的新聞標題，price_reaction_pct 是發布前最後收盤到發布後第一個收盤的真實漲跌幅（null＝尚無）。"
        "請逐則整理，只能根據標題與提供的數字，不要編造標題以外的細節或數字；標題資訊不足就寫「標題資訊不足」。\n"
        f"【新聞】{data}\n"
        '回傳 JSON：{"items": [{"no": 編號, "what": "實際發生什麼事（一句話）", "why": "投資人為何需要關注", '
        '"horizon": "短期"|"長期"|"短期與長期", "metrics": ["可能受影響的財務指標，如營收、毛利率、EPS、資本支出"], '
        '"assumptions": "市場可能隱含的假設", "importance": 1到5的整數（5 最重要）}], '
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
    for it in news.get("items", [])[:MAX_ITEMS]:
        x = {k: it[k] for k in ("title", "source", "link", "kind", "local_iso")}
        x["reaction"] = price_reaction(bars, it["local_iso"], market)
        x.update(_rule_fields(it["title"], it["kind"]))
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
            changers, unverified = res["reaction_changers"], res["unverified_numbers"]
            mode = f"AI（{profile.get('model')}）"
        except ai_client.AIError as e:
            ai_err = f"AI 整理失敗，改用關鍵字規則：{e}"

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
        "sources": news.get("sources", []), "errors": news.get("errors", []),
        "method": ("價格反應＝發布前最後一個收盤到發布後第一個收盤的真實漲跌；超過 1 個 ATR（近 14 日平均波動）代表市場明顯有感。"
                   "同一天的多則新聞會共用同一個價格反應，無法分辨是哪一則造成的。"
                   "排序依 AI 重要性（有設定時），再參考是否為官方公告、標題是否提到這檔、牽涉的財務指標數與實際價格反應。"),
    }
