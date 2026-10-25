"""
金鑰與資料額度設定 (env_settings.py)：讓使用者在「設定」頁直接填寫，不必自己建立或搬移 .env。
- 寫入程式資料夾的 .env（安裝版與免安裝版＝exe 旁邊，原始碼＝專案根目錄）
- 存檔後立即更新這次執行的環境變數，不用重開程式
- 只接受白名單內的鍵；讀取時只回傳「是否已設定」與末 4 碼，不回傳完整值
- 保留 .env 裡其他的行與註解
"""

import os
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from src.server.config import get_app_dir

FIELDS: List[Dict[str, Any]] = [
    {"key": "FINMIND_TOKEN", "label": "FinMind Token", "secret": True,
     "help": "台股日 K 備援、籌碼、配息、月營收、季財報的資料額度。不填每小時 300 次；到 finmindtrade.com 免費註冊後填入可提高到 600 次。程式只用到上限的 80%（保留餘量），各功能也都有快取。",
     "link": "https://finmindtrade.com/"},
    {"key": "GEMINI_API_KEY", "label": "Google Gemini 金鑰", "secret": True,
     "help": "選填。填在這裡後，在「AI 連線」新增 Gemini 時金鑰欄可以留空，金鑰就不會存進瀏覽器。"},
    {"key": "OPENAI_API_KEY", "label": "OpenAI 金鑰", "secret": True, "help": "選填，用法同上。"},
    {"key": "ANTHROPIC_API_KEY", "label": "Anthropic（Claude）金鑰", "secret": True, "help": "選填，用法同上。"},
    {"key": "OPENROUTER_API_KEY", "label": "OpenRouter 金鑰", "secret": True, "help": "選填，用法同上。"},
    {"key": "SEC_USER_AGENT", "label": "SEC 識別字串", "secret": False,
     "help": "抓美股 SEC 8-K 公告時，SEC 要求附上聯絡方式，例如「王小明 you@example.com」。不填用預設值。"},
]
ALLOWED = {f["key"] for f in FIELDS}
_LOCK = threading.Lock()
HEADER = "# 由「設定 → 金鑰與資料額度」自動產生，也可以手動編輯（每行 KEY=VALUE）\n"


def env_path() -> Path:
    return get_app_dir() / ".env"


def _read_file(path: Path) -> Dict[str, str]:
    out: Dict[str, str] = {}
    if not path.exists():
        return out
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, _, v = line.partition("=")
            out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def _mask(v: str, secret: bool) -> str:
    if not secret:
        return v
    return f"已設定（結尾 …{v[-4:]}）" if len(v) > 8 else "已設定"


def status() -> Dict[str, Any]:
    path = env_path()
    in_file = _read_file(path)
    fields = []
    for f in FIELDS:
        v = os.environ.get(f["key"], "")
        src: Optional[str] = None
        if f["key"] in in_file and in_file[f["key"]]:
            src = "設定檔"
        elif v:
            src = "系統環境變數"
        fields.append({**f, "set": bool(v), "display": _mask(v, f["secret"]) if v else "", "source": src})
    from src.market import finmind  # 延遲匯入：只有設定頁讀狀態時才需要
    return {"path": str(path), "exists": path.exists(), "fields": fields, "finmind": finmind.pause_status()}


def save(values: Dict[str, Any]) -> Dict[str, Any]:
    """values：{KEY: 新值}；空字串＝刪除；沒出現的鍵不變。"""
    updates: Dict[str, str] = {}
    for k, v in (values or {}).items():
        if k not in ALLOWED:
            raise ValueError(f"不支援的設定項目：{k}")
        v = str(v if v is not None else "").strip()
        if any(c in v for c in "\r\n\0"):
            raise ValueError(f"{k} 不能包含換行")
        updates[k] = v
    if not updates:
        return status()

    with _LOCK:  # 兩個存檔請求同時進來時不要互相蓋掉
        return _save_locked(updates)


def _save_locked(updates: Dict[str, str]) -> Dict[str, Any]:
    path = env_path()
    lines = path.read_text(encoding="utf-8-sig").splitlines() if path.exists() else [HEADER.rstrip("\n")]
    done = set()
    out = []
    for line in lines:
        k = line.split("=", 1)[0].strip() if "=" in line and not line.strip().startswith("#") else None
        if k in updates:
            if updates[k] and k not in done:
                out.append(f"{k}={updates[k]}")
            done.add(k)
            continue
        out.append(line)
    out += [f"{k}={v}" for k, v in updates.items() if k not in done and v]
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(".env.tmp")  # 先寫暫存檔再置換：寫到一半當機也不會弄壞原本的 .env
        tmp.write_text("\n".join(out).rstrip("\n") + "\n", encoding="utf-8")
        for i in range(5):  # 防毒軟體／同步軟體可能短暫鎖住檔案，稍等再試
            try:
                os.replace(tmp, path)
                break
            except PermissionError:
                if i == 4:
                    raise
                time.sleep(0.1 * (i + 1))
    except OSError as e:  # 例如免安裝版放在 Program Files 這類沒有寫入權限的資料夾
        raise ValueError(f"無法寫入 {path}（{e.strerror or e}）。請把程式放到有寫入權限的資料夾，或改用安裝版。") from None

    for k, v in updates.items():  # 立即生效，不用重開
        if v:
            os.environ[k] = v
        else:
            os.environ.pop(k, None)
    return status()
