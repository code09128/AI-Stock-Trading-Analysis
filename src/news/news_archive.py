"""
新聞標題每日存檔 (news_archive.py)
免費新聞來源只給最近 14～30 天，沒有歷史標題，沒辦法回頭驗證「新聞語氣和後續股價有沒有關係」。
所以每次抓到新聞就把標題存到 data/news_archive/YYYYMMDD.jsonl（一行一則），累積之後才能做回測。

只存標題、來源、種類、發布時間與連結，不存內文。保留 KEEP_DAYS 天，過期自動刪除。
存檔失敗不影響新聞功能（只是少累積一天）。
"""

from datetime import datetime, timedelta
import json
from pathlib import Path
import threading
from typing import Any, Dict, List

from src.server.config import get_app_dir

KEEP_DAYS = 400
FIELDS = ("title", "source", "kind", "local_iso", "link")
_LOCK = threading.Lock()


def archive_dir() -> Path:
    d = get_app_dir() / "data" / "news_archive"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _key(row: Dict[str, Any]) -> str:
    return f"{row.get('symbol')}|{row.get('title')}|{row.get('local_iso')}"


def save(symbol: str, items: List[Dict[str, Any]]) -> int:
    """把這次抓到的新聞併進今天的檔案（同一檔同標題同時間不重複存），回傳新增幾則。"""
    if not symbol or not items:
        return 0
    try:
        with _LOCK:
            folder = archive_dir()
            target = folder / f"{datetime.now():%Y%m%d}.jsonl"
            seen = set()
            if target.exists():
                for line in target.read_text(encoding="utf-8").splitlines():
                    try:
                        seen.add(_key(json.loads(line)))
                    except ValueError:
                        continue
            fresh = []
            for it in items:
                row = {"symbol": symbol, **{k: it.get(k) for k in FIELDS}}
                if row["title"] and _key(row) not in seen:
                    seen.add(_key(row))
                    fresh.append(json.dumps(row, ensure_ascii=False))
            if fresh:
                with target.open("a", encoding="utf-8") as f:
                    f.write("\n".join(fresh) + "\n")
            cutoff = f"{datetime.now() - timedelta(days=KEEP_DAYS):%Y%m%d}"
            for old in folder.glob("*.jsonl"):
                if old.stem.isdigit() and old.stem < cutoff:
                    old.unlink(missing_ok=True)
            return len(fresh)
    except Exception:
        return 0


def load(symbol: str = "") -> List[Dict[str, Any]]:
    """讀出存檔（給之後的回測工具用）；symbol 留空＝全部。"""
    rows: List[Dict[str, Any]] = []
    for f in sorted(archive_dir().glob("*.jsonl")):
        for line in f.read_text(encoding="utf-8").splitlines():
            try:
                row = json.loads(line)
            except ValueError:
                continue
            if not symbol or row.get("symbol") == symbol:
                rows.append(row)
    return rows
