"""
使用者資料存檔 (user_data.py)：持股、交易紀錄、交易規則、自選股、提醒、AI 設定等，存成程式資料夾的 data/userdata.json。
- 程式資料夾整個搬走，資料跟著走；換瀏覽器、清快取、改用 localhost 或 127.0.0.1 開都不會遺失
- 瀏覽器 localStorage 只當暫存：開頁面時從這裡讀回，修改時自動寫回（web/sync_store.jsx）
- 寫入用「先寫暫存檔再取代」，寫到一半當機也不會壞檔；每天第一次寫入前備份一份到 data/backups/，保留 14 份
"""

import json
import os
import shutil
import threading
from datetime import datetime
from pathlib import Path
from typing import Any, Dict

from src.server.config import get_app_dir

PREFIX = "tw_us_"
SKIP = {"tw_us_activity_v1"}  # 瀏覽器端操作紀錄量大，伺服器另有 logs/，不重複存
MAX_VALUE_CHARS = 2_000_000
KEEP_BACKUPS = 14
_LOCK = threading.Lock()


def data_dir() -> Path:
    return get_app_dir() / "data"


def data_file() -> Path:
    return data_dir() / "userdata.json"


def allowed(key: str) -> bool:
    return isinstance(key, str) and key.startswith(PREFIX) and key not in SKIP and len(key) <= 64


def _read() -> Dict[str, str]:
    path = data_file()
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return {k: v for k, v in data.get("values", {}).items() if allowed(k) and isinstance(v, str)}
    except (OSError, ValueError):
        # 檔案損毀：改讀最近一份備份，不讓使用者看到空資料
        for b in sorted((data_dir() / "backups").glob("userdata-*.json"), reverse=True):
            try:
                return json.loads(b.read_text(encoding="utf-8")).get("values", {})
            except (OSError, ValueError):
                continue
        return {}


def _backup_today(path: Path) -> None:
    bdir = data_dir() / "backups"
    target = bdir / f"userdata-{datetime.now():%Y%m%d}.json"
    if target.exists() or not path.exists():
        return
    bdir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(path, target)
    for old in sorted(bdir.glob("userdata-*.json"))[:-KEEP_BACKUPS]:
        old.unlink(missing_ok=True)


def load() -> Dict[str, Any]:
    with _LOCK:
        values = _read()
    return {"values": values, "path": str(data_file()), "exists": data_file().exists(),
            "backups": str(data_dir() / "backups"), "keep_backups": KEEP_BACKUPS}


def save(values: Dict[str, Any]) -> Dict[str, Any]:
    """values：{鍵: 字串值}；值為 null＝刪除該鍵。只更新有傳的鍵。"""
    if not isinstance(values, dict):
        raise ValueError("資料格式錯誤")
    for k, v in values.items():
        if not allowed(k):
            raise ValueError(f"不支援的資料項目：{k}")
        if v is not None and (not isinstance(v, str) or len(v) > MAX_VALUE_CHARS):
            raise ValueError(f"{k} 的內容格式錯誤或太大")
    path = data_file()
    with _LOCK:
        current = _read()
        for k, v in values.items():
            if v is None:
                current.pop(k, None)
            else:
                current[k] = v
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            _backup_today(path)
            tmp = path.with_suffix(".tmp")
            tmp.write_text(json.dumps({"version": 1, "saved_at": datetime.now().isoformat(timespec="seconds"),
                                       "values": current}, ensure_ascii=False, indent=1), encoding="utf-8")
            os.replace(tmp, path)
        except OSError as e:
            raise ValueError(f"無法寫入 {path}（{e.strerror or e}）。請把程式放到有寫入權限的資料夾。") from None
    return {"saved": len(values), "path": str(path)}
