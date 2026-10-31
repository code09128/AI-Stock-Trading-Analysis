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
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, Optional

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


def _retry(fn, tries: int = 5, wait: float = 0.1):
    """Windows 上防毒軟體、OneDrive 同步會短暫鎖住檔案：稍等再試幾次，不要一次失敗就放棄。"""
    for i in range(tries):
        try:
            return fn()
        except PermissionError:
            if i == tries - 1:
                raise
            time.sleep(wait * (i + 1))


def _read(strict: bool = False) -> Dict[str, str]:
    """strict=True（存檔前讀取）：檔案存在卻讀不到時直接報錯，不能拿舊備份當底，否則會把今天的修改蓋掉。"""
    path = data_file()
    if not path.exists():
        return {}
    try:
        text = _retry(lambda: path.read_text(encoding="utf-8"))
    except OSError as e:
        if strict:
            raise ValueError(f"暫時讀不到 {path}（{e.strerror or e}），這次修改先不存，稍後會自動再試") from None
        text = None
    if text is not None:
        try:
            data = json.loads(text)
            return {k: v for k, v in data.get("values", {}).items() if allowed(k) and isinstance(v, str)}
        except ValueError:
            # 內容損毀：先留一份損毀的檔案（之後存檔會覆蓋正本），再改用備份
            try:
                bad = path.with_name(f"userdata.corrupt-{datetime.now():%Y%m%d-%H%M%S}.json")
                if not any(path.parent.glob("userdata.corrupt-*.json")):
                    shutil.copy2(path, bad)
            except OSError:
                pass
    # 讀不到（只有顯示用時）或損毀：改讀最近一份備份，不讓使用者看到空資料
    for b in sorted((data_dir() / "backups").glob("userdata-*.json"), reverse=True):
        try:
            values = json.loads(b.read_text(encoding="utf-8")).get("values", {})
            return {k: v for k, v in values.items() if allowed(k) and isinstance(v, str)}
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
    with _LOCK:
        current = _read(strict=True)
        for k, v in values.items():
            if v is None:
                current.pop(k, None)
            else:
                current[k] = v
        _write(current)
    return {"saved": len(values), "path": str(data_file())}


def update(key: str, fn: Callable[[Optional[str]], Optional[str]]) -> Optional[str]:
    """讀取－修改－寫回一個鍵，整段在鎖裡完成：背景提醒引擎用它標記「已觸發」，
    不會把使用者在檢查期間新增／刪除的提醒蓋掉。fn 回傳 None＝不用改。"""
    if not allowed(key):
        raise ValueError(f"不支援的資料項目：{key}")
    with _LOCK:
        current = _read(strict=True)
        new = fn(current.get(key))
        if new is not None and new != current.get(key):
            current[key] = new
            _write(current)
        return new


def _write(current: Dict[str, str]) -> None:
    """呼叫端要持有 _LOCK。"""
    path = data_file()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        try:
            _backup_today(path)
        except OSError as e:  # 備份失敗不能擋住存檔
            print(f"[user_data] 今日備份失敗：{e}")
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps({"version": 1, "saved_at": datetime.now().isoformat(timespec="seconds"),
                                   "values": current}, ensure_ascii=False, indent=1), encoding="utf-8")
        _retry(lambda: os.replace(tmp, path))
    except OSError as e:
        raise ValueError(f"無法寫入 {path}（{e.strerror or e}）。請把程式放到有寫入權限的資料夾。") from None
