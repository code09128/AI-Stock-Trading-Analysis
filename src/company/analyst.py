"""
分析師共識 (analyst.py)：目標價區間、評等分布（近 4 個月）、券商最近的調升／調降紀錄。給估值參考卡下方的「分析師共識」區塊與 AI 補充資料用。

資料：Yahoo quoteSummary 的 financialData（目標價、平均評等）、recommendationTrend（每月各評等家數）、upgradeDowngradeHistory（券商紀錄）。
- 一次請求拿三個模組；只在打開某一檔時抓那一檔，12 小時快取（分析師資料一天才變幾次），
  請求間隔沿用估值的 _yahoo_summary（和估值自己的請求至少隔 1 秒）。
- 台股大型股通常有目標價與評等分布，但沒有券商紀錄；中小型股常常完全沒有，就回 supported=False 並說明。
- 上漲空間用現在的報價（quote_provider，3 秒快取，和看盤頁共用）算，取不到才用 Yahoo 資料裡的價格。
限制：涵蓋的券商以外資為主，台股本土券商的報告不在裡面；目標價是 12 個月的預估，不是短線價位，也不是買賣建議。
"""

import time
from typing import Any, Dict, List, Optional

from src.company import stock_info, valuation
from src.market import etf_data
from src.market import quote_provider as qp

TTL = 12 * 3600
HISTORY_DAYS = 90  # 券商紀錄只列最近幾天的
HISTORY_MAX = 8
MODULES = "financialData,recommendationTrend,upgradeDowngradeHistory"

# Yahoo recommendationKey → 中文（平均評等 1＝強力買進 … 5＝強力賣出）
KEY_ZH = {"strong_buy": "強力買進", "buy": "買進", "hold": "持有", "underperform": "偏弱", "sell": "賣出", "strong_sell": "強力賣出"}
TREND_KEYS = (("strongBuy", "強力買進"), ("buy", "買進"), ("hold", "持有"), ("sell", "賣出"), ("strongSell", "強力賣出"))
ACTION_ZH = {"up": "調升", "down": "調降", "main": "維持", "reit": "重申", "init": "首次評等"}
TARGET_ACTION_ZH = {"Raises": "調高", "Lowers": "調低", "Maintains": "維持", "Announces": "首次給", "Sets": "首次給"}
# 各家用詞不同（Overweight、Outperform…），只分成三類給顏色用；原文照樣顯示
_BULL = ("buy", "overweight", "outperform", "positive", "accumulate", "add")
_BEAR = ("sell", "underweight", "underperform", "negative", "reduce")


def grade_side(grade: str) -> str:
    """券商評等原文 → bull／bear／neutral（Underperform 要先判成 bear，不能被 perform 之類的字誤判）。"""
    g = (grade or "").lower()
    if any(w in g for w in _BEAR):
        return "bear"
    if any(w in g for w in _BULL):
        return "bull"
    return "neutral"


def _parse(r: Dict[str, Any], now: float) -> Optional[Dict[str, Any]]:
    fd = r.get("financialData") or {}
    raw = lambda k: valuation._raw(fd, k)  # noqa: E731
    target = {"low": raw("targetLowPrice"), "mean": raw("targetMeanPrice"), "median": raw("targetMedianPrice"),
              "high": raw("targetHighPrice"), "count": raw("numberOfAnalystOpinions")}
    if target["count"] is not None:
        target["count"] = int(target["count"])
    trend = []
    for t in (r.get("recommendationTrend") or {}).get("trend") or []:
        counts = {zh: int(t.get(k) or 0) for k, zh in TREND_KEYS}
        if sum(counts.values()):
            trend.append({"period": t.get("period"), "counts": counts, "total": sum(counts.values())})
    history = []
    for h in (r.get("upgradeDowngradeHistory") or {}).get("history") or []:
        ts = h.get("epochGradeDate")
        if not isinstance(ts, (int, float)) or now - ts > HISTORY_DAYS * 86400:
            continue
        history.append({
            "date": time.strftime("%Y-%m-%d", time.localtime(ts)), "firm": h.get("firm") or "",
            "action": ACTION_ZH.get(h.get("action"), h.get("action") or ""),
            "from": h.get("fromGrade") or "", "to": h.get("toGrade") or "", "side": grade_side(h.get("toGrade") or ""),
            "target": valuation._num(h.get("currentPriceTarget")) or None,  # 0＝沒給目標價
            "prior_target": valuation._num(h.get("priorPriceTarget")) or None,
            "target_action": TARGET_ACTION_ZH.get(h.get("priceTargetAction"), ""),
        })
        if len(history) >= HISTORY_MAX:
            break
    if target["mean"] is None and not trend:
        return None
    mean = raw("recommendationMean")
    return {"target": target, "trend": trend, "history": history,
            "rating": {"score": round(mean, 2) if mean is not None else None, "label": KEY_ZH.get(fd.get("recommendationKey") or "")},
            "currency": fd.get("financialCurrency") or "", "data_price": raw("currentPrice")}


def _fetch(symbol: str) -> Optional[Dict[str, Any]]:
    """台股依序試 .TW／.TWO（上櫃股只多一次請求）。
    Yahoo 有回應但沒有分析師資料 → {"empty": True}（照 12 小時快取，不重抓）；全部連線失敗 → None（快取只記幾分鐘就重試）。"""
    answered = False
    for ysym in etf_data._yahoo_candidates(symbol):
        try:
            r = valuation._yahoo_summary(ysym, MODULES)
        except Exception:
            continue
        answered = True
        got = _parse(r, time.time())
        if got:
            return {**got, "yahoo_symbol": ysym}
    return {"empty": True} if answered else None


def _live_price(symbol: str) -> Optional[float]:
    try:
        q = qp.get_quotes([symbol], {})
        return valuation._num(q[0].get("price")) if q else None
    except Exception:
        return None


def analyze(symbol: str) -> Dict[str, Any]:
    cat = stock_info.classify(symbol)
    if cat["category"] != "STOCK":
        return {"supported": False, "reason": "ETF／債券沒有分析師目標價"}
    if cat["market"] not in ("TW", "US"):
        return {"supported": False, "reason": "目前只支援台股與美股的分析師共識"}
    d = etf_data._cached(f"analyst:{cat['symbol']}", lambda: _fetch(symbol), ttl=TTL)
    if not d:
        return {"supported": False, "reason": "分析師資料暫時取不到（Yahoo 沒有回應），稍後再試"}
    if d.get("empty"):
        return {"supported": False, "reason": "這檔沒有分析師資料（中小型股常沒有外資券商追蹤）"}
    price = _live_price(symbol) or d["data_price"]
    mean = d["target"]["mean"]
    out = {"supported": True, "symbol": cat["symbol"], "market": cat["market"], **d, "price": price,
           "upside_pct": round((mean / price - 1) * 100, 1) if mean and price else None,
           "source": "Yahoo Finance（彙整各券商的分析師資料，12 小時更新一次）",
           "note": "目標價是券商對 12 個月後的預估，不是短線價位；涵蓋的券商以外資為主。只是參考，不是買賣建議。"}
    if len(d["trend"]) >= 2:
        now, old = d["trend"][0], d["trend"][-1]
        bull = lambda t: t["counts"]["強力買進"] + t["counts"]["買進"]  # noqa: E731
        out["trend_change"] = {"from_period": old["period"], "bull_now": bull(now), "bull_before": bull(old),
                               "total_now": now["total"], "total_before": old["total"]}
    return out


def brief(symbol: str) -> str:
    """給 AI 補充資料的一行摘要；不適用或取不到就回空字串。"""
    try:
        a = analyze(symbol)
    except Exception:
        return ""
    if not a.get("supported"):
        return ""
    t, parts = a["target"], []
    if t.get("mean"):
        parts.append(f"{t.get('count') or '?'} 位分析師目標價 {t.get('low')}～{t.get('high')}（平均 {round(t['mean'], 2)}），"
                     f"現價 {a.get('price')}" + (f"，平均目標價相對現價 {a['upside_pct']:+.1f}%" if a.get("upside_pct") is not None else ""))
    if a["rating"].get("label"):
        parts.append(f"平均評等 {a['rating']['label']}（{a['rating']['score']}，1＝強力買進、5＝強力賣出）")
    tc = a.get("trend_change")
    if tc:
        parts.append(f"看多家數 {tc['bull_before']}/{tc['total_before']} → {tc['bull_now']}/{tc['total_now']}（近 4 個月）")
    ups = sum(1 for h in a["history"] if h["action"] == "調升")
    downs = sum(1 for h in a["history"] if h["action"] == "調降")
    if ups or downs:
        parts.append(f"近 {HISTORY_DAYS} 天券商調升 {ups} 次、調降 {downs} 次")
    return ("分析師共識（12 個月目標價，外資券商為主，非買賣建議）：" + "；".join(parts)) if parts else ""
