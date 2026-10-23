"""
操作紀錄 (activity_log.py)
把前端送來的操作事件（點擊、換頁、API 呼叫結果、錯誤）與伺服器自己的 API 紀錄，
寫成每日一個 JSON Lines 檔：logs/activity-YYYYMMDD.jsonl（已列入 .gitignore），保留 30 天。
不記錄任何輸入框內容、API 金鑰或請求本文，只記錄動作名稱、代號、結果與耗時。
"""

from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, Iterable, List
import json
import sys
import threading

def _get_app_dir() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    cur = Path(__file__).resolve().parent
    for p in [cur, cur.parent, cur.parent.parent, cur.parent.parent.parent]:
        if (p / "run.py").is_file() or (p / "web").is_dir():
            return p
    return cur.parent.parent


LOG_DIR = _get_app_dir() / "logs"
KEEP_DAYS = 30
MAX_EVENT_CHARS = 2000
SENSITIVE_KEYS = {"api_key", "token", "authorization", "password", "key"}
_LOCK = threading.Lock()
_last_prune = {"day": ""}


def _scrub(ev: Any) -> Any:
    if isinstance(ev, dict):
        return {k: ("***" if str(k).lower() in SENSITIVE_KEYS else _scrub(v)) for k, v in ev.items()}
    if isinstance(ev, list):
        return [_scrub(v) for v in ev[:50]]
    return ev


def _prune() -> None:
    today = datetime.now().strftime("%Y%m%d")
    if _last_prune["day"] == today:
        return
    _last_prune["day"] = today
    cutoff = (datetime.now() - timedelta(days=KEEP_DAYS)).strftime("%Y%m%d")
    for f in LOG_DIR.glob("activity-*.jsonl"):
        if f.stem.split("-")[-1] < cutoff:
            try:
                f.unlink()
            except OSError:
                pass


def write(events: Iterable[Dict[str, Any]], source: str) -> int:
    lines: List[str] = []
    for ev in events:
        if not isinstance(ev, dict):
            continue
        rec = {"src": source, **_scrub(ev)}
        rec.setdefault("t", datetime.now().strftime("%Y-%m-%dT%H:%M:%S"))
        text = json.dumps(rec, ensure_ascii=False, default=str)
        lines.append(text if len(text) <= MAX_EVENT_CHARS else text[:MAX_EVENT_CHARS])
    if not lines:
        return 0
    with _LOCK:
        LOG_DIR.mkdir(exist_ok=True)
        _prune()
        path = LOG_DIR / f"activity-{datetime.now().strftime('%Y%m%d')}.jsonl"
        with path.open("a", encoding="utf-8") as fh:
            fh.write("\n".join(lines) + "\n")
    return len(lines)


def read_recent(limit: int = 200, errors_only: bool = False) -> List[Dict[str, Any]]:
    """讀最近的紀錄（最新的在前），給「設定」頁與除錯用。"""
    out: List[Dict[str, Any]] = []
    if not LOG_DIR.exists():
        return out
    for f in sorted(LOG_DIR.glob("activity-*.jsonl"), reverse=True):
        try:
            rows = f.read_text(encoding="utf-8").splitlines()
        except OSError:
            continue
        for line in reversed(rows):
            try:
                ev = json.loads(line)
            except ValueError:
                continue
            if errors_only and not (ev.get("level") == "error" or ev.get("type") == "error"):
                continue
            out.append(ev)
            if len(out) >= limit:
                return out
    return out
