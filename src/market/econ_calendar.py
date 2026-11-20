"""
經濟日曆 (econ_calendar.py)：本週各國重要經濟數據與央行事件（美國 CPI、非農、FOMC 利率決議…），給大盤籌碼頁與 AI 補充資料用。

資料：Forex Factory 的公開週曆匯出檔（nfs.faireconomy.media/ff_calendar_thisweek.json），欄位有標題、幣別、時間、影響程度、預測值、前值。
不打爆來源的做法：
- 來源說檔案每小時才更新一次，抓太頻繁會被暫時封鎖（回「Request Denied」網頁）→ 最多 1 小時抓一次，
  結果存到資料夾（data/econ_calendar.json），重開程式也不會重抓；失敗或被擋就沿用舊資料，並且 15 分鐘內不再試。
- 多個分頁、多個使用者同時看，都只讀同一份檔案。
限制：
- 只有主要貨幣（美、歐、英、日、中、加、澳、紐、瑞），沒有台灣；匯出檔沒有「公布值」，公布後的實際數字要看新聞。
- 只有本週（週日～週六，美東時間），週末時看不到下週。
- 標題中文只翻常見指標，其他維持原文。
"""

import json
import os
import re
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional

from src.market import quote_provider as qp
from src.market.tz import zone
from src.server import user_data

URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json"
FRESH_SEC = 3600
RETRY_SEC = 900
SOURCE = "Forex Factory 經濟日曆（每小時更新，時間已換成台灣時間）"

COUNTRY_ZH = {"USD": "美國", "EUR": "歐元區", "GBP": "英國", "JPY": "日本", "CNY": "中國", "CAD": "加拿大",
              "AUD": "澳洲", "NZD": "紐西蘭", "CHF": "瑞士", "ALL": "全球"}
IMPACT_ZH = {"High": "高", "Medium": "中", "Low": "低", "Holiday": "假日"}
# 常見指標的中文（依序比對，先比長的）；比不到就維持原文
TITLE_ZH = [
    ("Non-Farm Employment Change", "非農就業人數"), ("ADP Non-Farm Employment Change", "ADP 就業人數"),
    ("Unemployment Claims", "初領失業救濟金人數"), ("Unemployment Rate", "失業率"),
    ("Average Hourly Earnings", "平均時薪"), ("JOLTS Job Openings", "JOLTS 職缺數"),
    ("Core CPI", "核心 CPI"), ("CPI", "CPI 消費者物價指數"), ("Core PPI", "核心 PPI"), ("PPI", "PPI 生產者物價指數"),
    ("Core PCE Price Index", "核心 PCE 物價指數"), ("PCE Price Index", "PCE 物價指數"),
    ("Federal Funds Rate", "聯準會利率決議"), ("FOMC Statement", "FOMC 聲明"), ("FOMC Press Conference", "FOMC 記者會"),
    ("FOMC Meeting Minutes", "FOMC 會議紀錄"), ("FOMC Member", "聯準會官員談話"), ("Fed Chairman", "聯準會主席談話"), ("Fed Chair", "聯準會主席談話"),
    ("Main Refinancing Rate", "歐洲央行利率決議"), ("ECB President", "歐洲央行總裁談話"),
    ("Official Bank Rate", "英國央行利率決議"), ("BOJ Policy Rate", "日本央行利率決議"), ("BOJ Gov", "日本央行總裁談話"),
    ("Overnight Rate", "加拿大央行利率決議"), ("Cash Rate", "澳洲央行利率決議"), ("Official Cash Rate", "紐西蘭央行利率決議"),
    ("Advance GDP", "GDP 初值"), ("Prelim GDP", "GDP 修正值"), ("Final GDP", "GDP 終值"), ("GDP", "GDP"),
    ("Core Retail Sales", "核心零售銷售"), ("Retail Sales", "零售銷售"),
    ("ISM Manufacturing PMI", "ISM 製造業 PMI"), ("ISM Services PMI", "ISM 服務業 PMI"),
    ("Flash Manufacturing PMI", "製造業 PMI 初值"), ("Flash Services PMI", "服務業 PMI 初值"),
    ("Manufacturing PMI", "製造業 PMI"), ("Services PMI", "服務業 PMI"),
    ("Prelim UoM Consumer Sentiment", "密大消費者信心初值"), ("Revised UoM Consumer Sentiment", "密大消費者信心終值"),
    ("Prelim UoM Inflation Expectations", "密大通膨預期初值"), ("Revised UoM Inflation Expectations", "密大通膨預期終值"),
    ("CB Consumer Confidence", "經濟諮商會消費者信心"), ("Durable Goods Orders", "耐久財訂單"),
    ("Core Durable Goods Orders", "核心耐久財訂單"), ("Building Permits", "營建許可"), ("Housing Starts", "新屋開工"),
    ("Existing Home Sales", "成屋銷售"), ("New Home Sales", "新屋銷售"), ("Pending Home Sales", "成屋待完成銷售"),
    ("Trade Balance", "貿易收支"), ("Industrial Production", "工業生產"), ("Crude Oil Inventories", "原油庫存"),
    ("Empire State Manufacturing Index", "紐約州製造業指數"), ("Philly Fed Manufacturing Index", "費城聯準製造業指數"),
    ("Bank Holiday", "銀行假日（休市）"),
]
TITLE_ZH.sort(key=lambda kv: -len(kv[0]))

_lock = threading.Lock()
_last_try = 0.0


def cache_path() -> Path:
    return user_data.data_dir() / "econ_calendar.json"


def _read() -> Optional[Dict[str, Any]]:
    try:
        d = json.loads(cache_path().read_text(encoding="utf-8"))
        return d if isinstance(d.get("raw"), list) else None
    except (OSError, ValueError, AttributeError):
        return None


def _write(raw: List[Dict[str, Any]], now: float) -> None:
    p = cache_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps({"fetched_at": now, "raw": raw}, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, p)


def title_zh(title: str) -> str:
    for en, zh in TITLE_ZH:
        if en.lower() in (title or "").lower():
            rest = re.sub(re.escape(en), "", title, count=1, flags=re.I).strip(" -")
            # 「CPI m/m」「GDP q/q」這種後綴保留成月增／季增／年增
            rest = rest.replace("m/m", "月增").replace("q/q", "季增").replace("y/y", "年增")
            rest = re.sub(r"\s*\bSpeaks\b", "", rest).strip()  # 「Fed Chairman Warsh Speaks」→ 聯準會主席談話 Warsh
            return f"{zh} {rest}".strip()
    return ""


def _event(r: Dict[str, Any], now_tw: datetime) -> Optional[Dict[str, Any]]:
    try:
        t = datetime.fromisoformat(str(r["date"])).astimezone(zone("Asia/Taipei"))
    except (KeyError, ValueError, TypeError):
        return None
    cur = str(r.get("country") or "")
    title = str(r.get("title") or "")
    return {"at": t.isoformat(), "date": t.strftime("%Y-%m-%d"), "time": t.strftime("%H:%M"),
            "weekday": "一二三四五六日"[t.weekday()], "country": cur, "country_zh": COUNTRY_ZH.get(cur, cur),
            "title": title, "title_zh": title_zh(title), "impact": IMPACT_ZH.get(r.get("impact"), "低"),
            "forecast": r.get("forecast") or "", "previous": r.get("previous") or "", "past": t < now_tw}


def _raw(now: float) -> Dict[str, Any]:
    """回傳 {"raw": [...], "fetched_at": ..., "stale": bool, "error": str|None}；只在快取過期且距上次失敗超過 RETRY_SEC 才對外抓。"""
    global _last_try
    with _lock:
        disk = _read()
        if disk and now - float(disk.get("fetched_at") or 0) < FRESH_SEC:
            return {**disk, "stale": False, "error": None}
        if now - _last_try < RETRY_SEC:
            return {**(disk or {"raw": [], "fetched_at": None}), "stale": bool(disk), "error": "剛才取得失敗，稍後自動重試"}
        _last_try = now
        try:
            raw = qp._http_json(URL, timeout=15)  # 被擋時回的是 HTML 網頁，json 解析會失敗，當成取得失敗
            if not isinstance(raw, list):
                raise ValueError("格式不對")
        except Exception as e:  # noqa: BLE001  任何失敗都沿用舊檔
            return {**(disk or {"raw": [], "fetched_at": None}), "stale": bool(disk), "error": f"經濟日曆取得失敗：{e}"}
        _write(raw, now)
        _last_try = 0.0
        return {"raw": raw, "fetched_at": now, "stale": False, "error": None}


def events(now: Optional[float] = None) -> Dict[str, Any]:
    now = now or time.time()
    got = _raw(now)
    now_tw = datetime.fromtimestamp(now, zone("Asia/Taipei"))
    evs = sorted((e for e in (_event(r, now_tw) for r in got["raw"]) if e), key=lambda e: e["at"])
    fetched = got.get("fetched_at")
    return {"events": evs, "source": SOURCE, "stale": got["stale"], "error": got["error"] if not evs else None,
            "fetched_at": datetime.fromtimestamp(fetched, zone("Asia/Taipei")).strftime("%m-%d %H:%M") if fetched else None,
            "note": "影響程度是資料來源的分級（高＝常讓市場大幅波動）。匯出檔沒有公布值，公布後的實際數字請看新聞。"}


def _fp(e: Dict[str, Any]) -> str:
    """「（預測 X，前值 Y）」，空的那個不寫。"""
    parts = [f"{k} {e[f]}" for k, f in (("預測", "forecast"), ("前值", "previous")) if e[f]]
    return f"（{'，'.join(parts)}）" if parts else ""


def brief(now: Optional[float] = None, days: int = 3) -> str:
    """給 AI 補充資料：接下來幾天內影響「高」或「中」的事件（只取美國與中國，和台股最相關）；沒有就回空字串。
    限制：匯出檔只有本週，週五、週末時看不到下週的事件。"""
    try:
        d = events(now)
    except Exception:
        return ""
    now_tw = datetime.fromtimestamp(now or time.time(), zone("Asia/Taipei"))
    until = (now_tw + timedelta(days=days)).isoformat()
    hits = [e for e in d["events"] if not e["past"] and e["impact"] in ("高", "中") and e["country"] in ("USD", "CNY") and e["at"] <= until]
    if not hits:
        return ""
    items = [f"{e['date'][5:]}（{e['weekday']}）{e['time']} {e['country_zh']} {e['title_zh'] or e['title']}（影響{e['impact']}）"
             + _fp(e) for e in hits[:6]]
    return f"未來 {days} 天的重要經濟事件（台灣時間，公布前後波動可能變大）：" + "；".join(items)
