"""
線上更新 (updater.py)：只讀 GitHub 正式發布的 Release（例如 v1.0.0、v1.0.1），不讀 main 分支
- 版本號在 src/version.py（APP_VERSION）；發布新版＝改版本號 → commit → 在 GitHub 建立同名 Release
- 打包版（.exe）：重新啟動時自動檢查最新 Release，有新版就下載該版本的 src/ 與 web/ 到程式資料夾的 update/，
  並優先載入 update/ 的程式碼（不碰 data/ 與 .env）；設定頁也可手動「檢查更新」「下載並套用」
- 原始碼版（有 .git）：不會覆蓋開發中的程式碼，只告訴你有新版本，請自己 git pull
- 下載後會核對壓縮檔裡 src/version.py 的版本號和 Release 一致，不一致就不套用
"""

from datetime import datetime
from importlib.machinery import PathFinder
from pathlib import Path
from typing import Any, Callable, Dict, Optional, Tuple
import importlib
import io
import json
import os
import re
import shutil
import sys
import threading
import urllib.error
import urllib.request
import zipfile

from src.server.config import get_app_dir, get_resource_dir

REPO = os.environ.get("TRADING_GITHUB_REPO", "code09128/AI-Stock-Trading-Analysis")
RELEASES_API = f"https://api.github.com/repos/{REPO}/releases/latest"
TAG_ZIP = "https://codeload.github.com/{repo}/zip/refs/tags/{tag}"
UA = {"User-Agent": "TW-US-Trading-Analyzer-Updater/1.0", "Accept": "application/vnd.github+json"}
_VERSION_RE = re.compile(r'APP_VERSION\s*=\s*["\'](\d+\.\d+\.\d+)["\']')
_LOCK = threading.Lock()


def update_dir() -> Path:
    return get_app_dir() / "update"


def parse_version(v: Any) -> Tuple[int, int, int]:
    """'v1.2.3' / '1.2.3' → (1, 2, 3)；看不懂的回 (0, 0, 0)。"""
    m = re.search(r"(\d+)\.(\d+)\.(\d+)", str(v or ""))
    return tuple(int(x) for x in m.groups()) if m else (0, 0, 0)


def _read_json(path: Path) -> Optional[Dict[str, Any]]:
    try:
        if path.is_file():
            return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        pass
    return None


def _version_in(text: str) -> Optional[str]:
    m = _VERSION_RE.search(text or "")
    return m.group(1) if m else None


def bundled_version() -> str:
    """這份程式本身（安裝包或原始碼）的版本：打包版讀打包時寫的 version.json，原始碼版讀 src/version.py。"""
    info = _read_json(get_resource_dir() / "version.json") or {}
    if parse_version(info.get("version")) > (0, 0, 0):
        return str(info["version"])
    try:
        v = _version_in((get_resource_dir() / "src" / "version.py").read_text(encoding="utf-8"))
        if v:
            return v
    except OSError:
        pass
    from src.version import APP_VERSION  # 最後退路
    return APP_VERSION


def _update_info() -> Dict[str, Any]:
    return _read_json(update_dir() / "version.json") or {}


def current_version() -> Dict[str, Any]:
    """目前生效中的版本：線上更新下載的版本比內建新就用它，否則用內建版本。"""
    base = bundled_version()
    up = _update_info()
    if parse_version(up.get("version")) > parse_version(base) and (update_dir() / "src").is_dir():
        return {"version": up["version"], "source": "線上更新版", "updated_at": up.get("updated_at", "")}
    frozen = getattr(sys, "frozen", False)
    return {"version": base, "source": "打包內建版" if frozen else "原始碼版"}


def activate_update_if_present() -> bool:
    """update/ 裡的版本比內建新才掛上（優先載入）；內建版已經一樣新或更新（例如重裝了新的安裝包）就清掉 update/。"""
    up = update_dir()
    if not (up / "src").is_dir() or not (up / "web" / "index.html").is_file():
        return False
    if parse_version(_update_info().get("version")) <= parse_version(bundled_version()):
        shutil.rmtree(up, ignore_errors=True)
        return False

    up_str = str(up)
    if up_str not in sys.path:
        sys.path.insert(0, up_str)
    # 確保 PathFinder 在 PyInstaller 的 PyiFrozenImporter 之前，才會優先讀取 update/src/
    if PathFinder in sys.meta_path and sys.meta_path[0] is not PathFinder:
        sys.meta_path.remove(PathFinder)
        sys.meta_path.insert(0, PathFinder)
    elif PathFinder not in sys.meta_path:
        sys.meta_path.insert(0, PathFinder)
    src_mod = sys.modules.get("src")
    up_src = str(up / "src")
    if src_mod is not None and hasattr(src_mod, "__path__"):
        paths = list(src_mod.__path__)
        if up_src not in paths:
            src_mod.__path__ = [up_src] + paths
    return True


def fetch_latest_release(timeout: int = 6) -> Dict[str, Any]:
    """GitHub 最新正式 Release（不含草稿與預先發布版）。"""
    req = urllib.request.Request(RELEASES_API, headers=UA)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as e:
        if e.code == 404:
            raise RuntimeError("GitHub 上還沒有發布任何正式版本（Release）") from None
        raise RuntimeError(f"GitHub 回應 HTTP {e.code}，請稍後再試") from None
    except Exception as e:
        raise RuntimeError(f"無法連線至 GitHub 檢查更新：{e}") from None
    tag = str(data.get("tag_name") or "")
    if parse_version(tag) == (0, 0, 0):
        raise RuntimeError(f"最新 Release 的標籤「{tag}」不是版本號格式（應為 v1.0.0 這種寫法）")
    return {
        "version": ".".join(map(str, parse_version(tag))),
        "tag": tag,
        "name": str(data.get("name") or tag),
        "notes": str(data.get("body") or "")[:2000],
        "published_at": str(data.get("published_at") or "").replace("T", " ").replace("Z", "")[:19],
        "url": str(data.get("html_url") or ""),
    }


def _is_source_checkout() -> bool:
    return not getattr(sys, "frozen", False) and (get_app_dir() / ".git").exists()


def check_update(timeout: int = 6) -> Dict[str, Any]:
    cur = current_version()
    try:
        rel = fetch_latest_release(timeout=timeout)
    except Exception as e:
        return {"ok": False, "error": str(e), "has_update": False, "current": cur, "remote": None}
    return {
        "ok": True,
        "has_update": parse_version(rel["version"]) > parse_version(cur["version"]),
        "current": cur,
        "remote": rel,
        "repo": REPO,
        "source_checkout": _is_source_checkout(),
    }


def _reload_runtime() -> None:
    """熱重載 src.* 模組與伺服器路由，讓更新不必重開程式也立即生效。"""
    activate_update_if_present()
    from src.server import config
    config.WEB_DIR = config.get_web_dir()
    keep_prefixes = ("src.server.api_server", "src.server.updater", "src.server.config",
                     "src.server.alert_engine", "src.server.tray_icon")
    to_reload = [
        name for name, mod in list(sys.modules.items())
        if (name == "src" or name.startswith("src.")) and mod is not None
        and not name.startswith(keep_prefixes)
    ]
    for name in sorted(to_reload, key=lambda x: x.count("."), reverse=True):  # 由底層往上層重載
        try:
            importlib.reload(sys.modules[name])
        except Exception:
            pass
    try:
        from src.server import dispatcher, api_server
        importlib.reload(dispatcher)
        api_server.D = dispatcher.DISPATCHER
        api_server.refresh_routes()
    except Exception:
        pass


def _download_release(rel: Dict[str, Any], timeout: int = 30) -> Dict[str, Any]:
    """下載該 Release 標籤的原始碼壓縮包，只解出 src/ 與 web/ 到 update/。"""
    url = TAG_ZIP.format(repo=REPO, tag=rel["tag"])
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as resp:
            raw_zip = resp.read()
    except Exception as e:
        raise RuntimeError(f"下載 {rel['tag']} 失敗：{e}") from None

    app_d = get_app_dir()
    tmp_dir = app_d / "update_tmp"
    target = update_dir()
    shutil.rmtree(tmp_dir, ignore_errors=True)
    tmp_dir.mkdir(parents=True, exist_ok=True)
    try:
        with zipfile.ZipFile(io.BytesIO(raw_zip)) as zf:
            names = zf.namelist()
            if not names:
                raise RuntimeError("下載的壓縮包是空的")
            prefix = names[0].split("/")[0] + "/"
            for member in names:
                if not member.startswith(prefix):
                    continue
                rel_path = member[len(prefix):]
                if not rel_path or not rel_path.startswith(("src/", "web/")) or ".." in Path(rel_path).parts:
                    continue
                dest = tmp_dir / rel_path
                if member.endswith("/"):
                    dest.mkdir(parents=True, exist_ok=True)
                else:
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    with zf.open(member) as src_f, open(dest, "wb") as dst_f:
                        shutil.copyfileobj(src_f, dst_f)
        if not (tmp_dir / "src").is_dir() or not (tmp_dir / "web" / "index.html").is_file():
            raise RuntimeError("更新包結構不完整（缺少 src/ 或 web/index.html）")
        code_ver = _version_in((tmp_dir / "src" / "version.py").read_text(encoding="utf-8")) \
            if (tmp_dir / "src" / "version.py").is_file() else None
        if code_ver != rel["version"]:
            raise RuntimeError(f"Release {rel['tag']} 裡的程式版本是 {code_ver or '未標示'}，和標籤不一致，未套用")

        info = {"version": rel["version"], "tag": rel["tag"], "name": rel.get("name", ""),
                "published_at": rel.get("published_at", ""), "updated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")}
        (tmp_dir / "version.json").write_text(json.dumps(info, ensure_ascii=False, indent=2), encoding="utf-8")
        old_dir = app_d / "update_old"
        shutil.rmtree(old_dir, ignore_errors=True)
        if target.exists():
            os.replace(target, old_dir)
        os.replace(tmp_dir, target)
        shutil.rmtree(old_dir, ignore_errors=True)
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)

    _reload_runtime()
    return {"ok": True, "updated": True, "already_latest": False, "mode": "release_download",
            "msg": f"已更新到 {rel['tag']}（{rel.get('name', '')}）", "current": current_version(), "remote": rel}


def apply_update(timeout: int = 30) -> Dict[str, Any]:
    """有比目前新的 Release 才下載套用；原始碼版只提示，不覆蓋開發中的程式碼。"""
    with _LOCK:
        rel = fetch_latest_release(timeout=10)
        cur = current_version()
        if parse_version(rel["version"]) <= parse_version(cur["version"]):
            return {"ok": True, "updated": False, "already_latest": True, "mode": "noop",
                    "msg": f"目前已是最新版本 v{cur['version']}", "current": cur, "remote": rel}
        if _is_source_checkout():
            return {"ok": True, "updated": False, "already_latest": False, "mode": "source",
                    "msg": f"有新版本 {rel['tag']}；原始碼版不會自動覆蓋程式碼，請用 git pull 更新",
                    "current": cur, "remote": rel}
        return _download_release(rel, timeout=timeout)


def auto_update_on_boot(on_status: Optional[Callable[[str], None]] = None) -> bool:
    """打包版每次啟動時檢查最新 Release，有新版就下載套用（逾時很短，不會卡住啟動）。
    原始碼版不自動更新；設定環境變數 TRADING_NO_AUTO_UPDATE=1 可關閉。"""
    activate_update_if_present()
    if os.environ.get("TRADING_NO_AUTO_UPDATE") == "1" or not getattr(sys, "frozen", False):
        return False
    try:
        chk = check_update(timeout=3)
        if not chk.get("ok") or not chk.get("has_update"):
            return False
        if on_status:
            on_status(f"發現新版本 {chk['remote']['tag']}，正在下載更新…")
        return bool(apply_update(timeout=20).get("updated"))
    except Exception:
        return False
