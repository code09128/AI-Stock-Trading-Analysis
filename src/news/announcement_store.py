"""
證交所重大訊息每日存檔與歷史回溯 (announcement_store.py)
解決 TWSE OpenAPI 僅提供「當日」重大訊息的限制：
1. 每天將獲取的全市場重大訊息存至 data/announcements/twse_material_YYYYMMDD.json
2. 查詢個股時，同時載入當日最新與本地累積的歷史重大訊息（保留 90 天），自動去重
"""

from datetime import datetime, timedelta
import json
from pathlib import Path
import threading
from typing import Any, Dict, List

from src.server.config import get_app_dir

KEEP_DAYS = 90
_LOCK = threading.Lock()


def announcements_dir() -> Path:
    d = get_app_dir() / "data" / "announcements"
    d.mkdir(parents=True, exist_ok=True)
    return d


def save_today_twse_material(rows: List[Dict[str, Any]]) -> None:
    """將當天 TWSE 全市場重大訊息儲存，並自動清理超過 90 天的檔案。"""
    if not rows or not isinstance(rows, list):
        return
    today_str = datetime.now().strftime("%Y%m%d")
    target = announcements_dir() / f"twse_material_{today_str}.json"
    temp = target.with_suffix(".tmp")
    with _LOCK:
        try:
            # 若今日檔案已存在，合併去重後寫回
            existing_rows = []
            if target.exists():
                try:
                    existing_rows = json.loads(target.read_text(encoding="utf-8"))
                except Exception:
                    pass
            combined = {f"{r.get('公司代號')}_{r.get('發言日期')}_{r.get('發言時間')}_{r.get('主旨')}": r
                        for r in (existing_rows + rows) if isinstance(r, dict)}
            temp.write_text(json.dumps(list(combined.values()), ensure_ascii=False, indent=1), encoding="utf-8")
            temp.replace(target)

            # 清理過期檔案
            cutoff = (datetime.now() - timedelta(days=KEEP_DAYS)).strftime("%Y%m%d")
            for f in announcements_dir().glob("twse_material_*.json"):
                parts = f.stem.split("_")
                if len(parts) >= 3 and parts[-1].isdigit() and parts[-1] < cutoff:
                    try:
                        f.unlink(missing_ok=True)
                    except OSError:
                        pass
        except Exception:
            pass


def load_history_twse_material(code: str, days: int = 90) -> List[Dict[str, Any]]:
    """載入本地累積的指定代號歷史重大訊息。"""
    cutoff = (datetime.now() - timedelta(days=days)).strftime("%Y%m%d")
    matched: Dict[str, Dict[str, Any]] = {}

    with _LOCK:
        files = sorted(announcements_dir().glob("twse_material_*.json"), reverse=True)

    for f in files:
        parts = f.stem.split("_")
        if len(parts) >= 3 and parts[-1].isdigit() and parts[-1] < cutoff:
            continue
        try:
            rows = json.loads(f.read_text(encoding="utf-8"))
            for r in rows:
                if str(r.get("公司代號", "")).strip() == code:
                    key = f"{r.get('發言日期')}_{r.get('發言時間')}_{r.get('主旨')}"
                    if key not in matched:
                        matched[key] = r
        except Exception:
            continue

    return list(matched.values())
