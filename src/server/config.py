"""伺服器設定：程式與資源路徑（原始碼／打包版）、.env 載入、常用標的中文名稱。"""

from typing import List
from pathlib import Path
import sys


def _find_project_root() -> Path:
    cur = Path(__file__).resolve().parent
    for p in [cur, cur.parent, cur.parent.parent, cur.parent.parent.parent]:
        if (p / "web").is_dir() or (p / "run.py").is_file():
            return p
    return cur.parent.parent


def get_resource_dir() -> Path:
    """取得打包內部的靜態資源根目錄（PyInstaller 解壓路徑 sys._MEIPASS 或本機專案目錄）。"""
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        return Path(sys._MEIPASS)
    return _find_project_root()


def _source_project_of(exe_dir: Path):
    """exe 放在原始碼專案的 dist\\（單一檔案版）或 dist\\<程式名稱>\\（資料夾版）裡時，回傳專案根目錄。"""
    for d in (exe_dir, exe_dir.parent):
        if d.name.lower() == "dist" and (d.parent / "run.py").is_file() and (d.parent / "src" / "server").is_dir():
            return d.parent
    return None


MAC_APP_NAME = "股票交易分析系統"


def _mac_bundle_of(exe_dir: Path):
    """Mac 打包版的執行檔在「<名稱>.app/Contents/MacOS/」裡，回傳 .app 本身；不是就回傳 None。"""
    if sys.platform == "darwin" and exe_dir.name == "MacOS" and exe_dir.parent.parent.suffix == ".app":
        return exe_dir.parent.parent
    return None


def get_app_dir() -> Path:
    """取得應用程式工作目錄，用於存取 data\\、.env 與 logs。
    打包版是 exe 所在目錄；但從專案的 dist\\ 直接執行時用專案根目錄，跟 start.bat／run.py 共用同一份資料。
    Mac 的 .app 內部不能寫入（放在「應用程式」資料夾沒有權限、寫入也會破壞簽章），
    改用 ~/Library/Application Support/股票交易分析系統/；重新安裝或換版本資料都還在。"""
    if getattr(sys, "frozen", False):
        exe_dir = Path(sys.executable).resolve().parent
        bundle = _mac_bundle_of(exe_dir)
        if bundle is not None:
            return (_source_project_of(bundle.parent)
                    or Path.home() / "Library" / "Application Support" / MAC_APP_NAME)
        return _source_project_of(exe_dir) or exe_dir
    return _find_project_root()


def get_web_dir() -> Path:
    """若程式資料夾下有線上更新的 update/web，優先使用；否則使用內建或原始碼的 web/。"""
    up_web = get_app_dir() / "update" / "web"
    if (up_web / "index.html").is_file():
        return up_web
    return get_resource_dir() / "web"


WEB_DIR = get_web_dir()


WATCHLIST_NAMES = {
    "2330.TW": "台積電",
    "2317.TW": "鴻海",
    "2454.TW": "聯發科",
    "NVDA": "NVIDIA",
    "AAPL": "Apple",
    "TSLA": "Tesla",
    "SPCX": "SpaceX",
    "2330": "台積電",
    "0050": "元大台灣50",
    "00935": "野村臺灣新科技50",
    "00891": "中信關鍵半導體",
    "0055": "元大MSCI金融",
}


def load_env_file(path: Path = None) -> List[str]:
    """讀取專案根目錄的 .env（KEY=VALUE，# 開頭為註解）；已存在的環境變數優先，不覆蓋。回傳載入的鍵名。"""
    import os

    is_default = path is None
    if path is None:
        path = get_app_dir() / ".env"
    loaded = []
    if not path.exists():
        if is_default:
            bundled = get_resource_dir() / ".env"
            if bundled.exists() and bundled != path:
                path = bundled
            else:
                return loaded
        else:
            return loaded
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value
            loaded.append(key)
    return loaded
