"""
線上熱更新模組 (updater.py)：
支援「打包版 (.exe)」與「原始碼版」直接從 GitHub 檢查並拉取最新程式碼（src/ 與 web/）：
- 打包版 (.exe)：不需安裝 Git 或 Python，直接從 GitHub 下載最新 main 分支壓縮包，
  解壓 src/ 與 web/ 到程式資料夾下的 update/（絕不觸碰 data/ 與 .env），
  並透過 sys.meta_path / sys.__path__ 優先載入 update/ 內的最新程式碼與前端靜態檔。
- 啟動時（desktop.py）可自動檢查更新並直接套用；「設定」頁也可隨時手動按「檢查更新／立即更新」。
"""

from datetime import datetime
from importlib.machinery import PathFinder
from pathlib import Path
from typing import Any, Callable, Dict, Optional
import importlib
import io
import json
import os
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import zipfile

from src.server.config import get_app_dir, get_resource_dir

REPO = os.environ.get("TRADING_GITHUB_REPO", "code09128/AI-Stock-Trading-Analysis")
BRANCH = os.environ.get("TRADING_GITHUB_BRANCH", "main")
COMMITS_API = f"https://api.github.com/repos/{REPO}/commits/{BRANCH}"
ZIP_URL = f"https://codeload.github.com/{REPO}/zip/refs/heads/{BRANCH}"
UA = {"User-Agent": "TW-US-Trading-Analyzer-Updater/1.0", "Accept": "application/vnd.github.v3+json"}
_LOCK = threading.Lock()


def update_dir() -> Path:
    return get_app_dir() / "update"


def _read_json(path: Path) -> Optional[Dict[str, Any]]:
    try:
        if path.is_file():
            return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        pass
    return None


def _git_current_version(root: Path) -> Optional[Dict[str, Any]]:
    if not (root / ".git").exists():
        return None
    try:
        out = subprocess.check_output(
            ["git", "log", "-1", "--format=%H%n%h%n%ci%n%s"],
            cwd=str(root), stderr=subprocess.DEVNULL, timeout=3,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        ).decode("utf-8", "replace").strip().splitlines()
        if len(out) >= 4:
            return {"sha": out[0], "short_sha": out[1], "date": out[2][:19], "message": out[3]}
    except Exception:
        pass
    return None


def bundled_version() -> Optional[Dict[str, Any]]:
    return _read_json(get_resource_dir() / "version.json")


def current_version() -> Dict[str, Any]:
    """取得目前生效中的版本資訊（優先順序：update/version.json → .git → 打包內建 version.json）。"""
    up_ver = _read_json(update_dir() / "version.json")
    base_ver = bundled_version()
    if up_ver and up_ver.get("sha"):
        return {**up_ver, "source": "線上更新版 (update/)"}
    git_ver = _git_current_version(get_app_dir())
    if git_ver:
        return {**git_ver, "source": "Git 原始碼"}
    if base_ver and base_ver.get("sha"):
        return {**base_ver, "source": "打包內建版"}
    return {"sha": "", "short_sha": "未知", "date": "", "message": "本地版本（無版本標記）", "source": "本地版"}


def activate_update_if_present() -> bool:
    """若程式資料夾下有 update/src 與 update/web，將其掛載為最高優先權；若比內建版舊則自動清除。"""
    up = update_dir()
    if not (up / "src").is_dir() or not (up / "web" / "index.html").is_file():
        return False
    up_ver = _read_json(up / "version.json") or {}
    base_ver = bundled_version() or {}
    # 若重新安裝了更新的 Setup.exe（內建版日期比 update/ 更新，或同一個 SHA），自動清理舊的 update/
    if base_ver.get("sha") and up_ver.get("sha"):
        if base_ver["sha"] == up_ver["sha"] or (
            base_ver.get("date", "") and up_ver.get("date", "") and base_ver["date"] > up_ver["date"]
        ):
            try:
                shutil.rmtree(up, ignore_errors=True)
            except Exception:
                pass
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


def fetch_remote_version(timeout: int = 6) -> Dict[str, Any]:
    """向 GitHub API 查詢最新 commit 資訊。"""
    req = urllib.request.Request(COMMITS_API, headers=UA)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"GitHub API 回應 HTTP {e.code}（請確認網路或倉庫是否公開）") from None
    except Exception as e:
        raise RuntimeError(f"無法連線至 GitHub 檢查更新：{e}") from None

    sha = str(data.get("sha") or "")
    commit = data.get("commit") or {}
    committer = commit.get("committer") or commit.get("author") or {}
    raw_date = str(committer.get("date") or "")
    msg = str(commit.get("message") or "").splitlines()[0]
    return {
        "sha": sha,
        "short_sha": sha[:7] if sha else "",
        "date": raw_date.replace("T", " ").replace("Z", "")[:19],
        "message": msg,
    }


def check_update(timeout: int = 6) -> Dict[str, Any]:
    """檢查是否有新版本。"""
    cur = current_version()
    try:
        rem = fetch_remote_version(timeout=timeout)
    except Exception as e:
        return {"ok": False, "error": str(e), "has_update": False, "current": cur, "remote": None}
    has_update = bool(rem.get("sha") and rem["sha"] != cur.get("sha"))
    return {
        "ok": True,
        "has_update": has_update,
        "current": cur,
        "remote": rem,
        "repo": REPO,
        "branch": BRANCH,
    }


def _reload_runtime() -> None:
    """熱重載 src.* 模組與伺服器路由，讓更新不必重開 exe 也立即生效。"""
    activate_update_if_present()
    from src.server import config
    config.WEB_DIR = config.get_web_dir()

    # 重新載入非狀態型的業務模組（保留資料庫快取鎖與正在跑的 server 執行緒）
    keep_prefixes = ("src.server.api_server", "src.server.updater", "src.server.config",
                     "src.server.alert_engine", "src.server.tray_icon")
    to_reload = [
        name for name, mod in list(sys.modules.items())
        if (name == "src" or name.startswith("src.")) and mod is not None
        and not name.startswith(keep_prefixes)
    ]
    # 由底層往上層排序重載
    for name in sorted(to_reload, key=lambda x: x.count("."), reverse=True):
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


def _apply_via_zip(rem: Dict[str, Any], timeout: int = 30) -> Dict[str, Any]:
    """從 GitHub 下載最新分支 zip，解壓 src/ 與 web/ 到 update/。"""
    req = urllib.request.Request(ZIP_URL, headers=UA)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw_zip = resp.read()
    except Exception as e:
        raise RuntimeError(f"下載更新檔失敗：{e}") from None

    app_d = get_app_dir()
    tmp_dir = app_d / "update_tmp"
    target = update_dir()
    if tmp_dir.exists():
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
                rel = member[len(prefix):]
                if not rel or not (rel.startswith("src/") or rel.startswith("web/")):
                    continue
                if ".." in Path(rel).parts:
                    continue
                dest = tmp_dir / rel
                if member.endswith("/"):
                    dest.mkdir(parents=True, exist_ok=True)
                else:
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    with zf.open(member) as src_f, open(dest, "wb") as dst_f:
                        shutil.copyfileobj(src_f, dst_f)

        if not (tmp_dir / "src").is_dir() or not (tmp_dir / "web" / "index.html").is_file():
            raise RuntimeError("更新包結構不完整（缺少 src/ 或 web/index.html）")

        ver_info = {
            **rem,
            "updated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        }
        (tmp_dir / "version.json").write_text(json.dumps(ver_info, ensure_ascii=False, indent=2), encoding="utf-8")

        old_dir = app_d / "update_old"
        if old_dir.exists():
            shutil.rmtree(old_dir, ignore_errors=True)
        if target.exists():
            os.replace(target, old_dir)
        os.replace(tmp_dir, target)
        if old_dir.exists():
            shutil.rmtree(old_dir, ignore_errors=True)
    finally:
        if tmp_dir.exists():
            shutil.rmtree(tmp_dir, ignore_errors=True)

    _reload_runtime()
    return {
        "ok": True,
        "mode": "zip_hot_update",
        "msg": f"已更新至最新版本 {rem.get('short_sha', '')}（{rem.get('message', '')}）",
        "current": current_version(),
    }


def apply_update(timeout: int = 30) -> Dict[str, Any]:
    """執行線上更新：原始碼且乾淨時優先 git pull，打包版（或 git pull 不可用時）走 GitHub 壓縮包熱更新。"""
    with _LOCK:
        rem = fetch_remote_version(timeout=10)
        cur = current_version()
        app_d = get_app_dir()
        # 原始碼開發環境且不是打包版：嘗試 git pull --ff-only
        if not getattr(sys, "frozen", False) and (app_d / ".git").exists() and not (update_dir() / "version.json").exists():
            try:
                res = subprocess.run(
                    ["git", "pull", "--ff-only", "origin", BRANCH],
                    cwd=str(app_d), capture_output=True, text=True, encoding="utf-8", errors="replace",
                    timeout=timeout, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                )
                if res.returncode == 0:
                    _reload_runtime()
                    return {
                        "ok": True,
                        "mode": "git_pull",
                        "msg": f"已透過 git pull 更新至最新版本 {rem.get('short_sha', '')}",
                        "current": current_version(),
                    }
            except Exception:
                pass
        return _apply_via_zip(rem, timeout=timeout)


def auto_update_on_boot(on_status: Optional[Callable[[str], None]] = None) -> bool:
    """桌面版啟動時自動檢查並下載更新（只針對打包版或已啟用線上更新的環境；逾時極短不卡啟動）。"""
    activate_update_if_present()
    if os.environ.get("TRADING_NO_AUTO_UPDATE") == "1":
        return False
    # 原始碼開發模式預設不自動覆蓋（避免開發者改到一半被蓋掉），打包版 (.exe) 自動檢查更新
    if not getattr(sys, "frozen", False) and not (update_dir() / "version.json").exists():
        return False
    try:
        chk = check_update(timeout=3)
        if not chk.get("ok") or not chk.get("has_update"):
            return False
        rem = chk.get("remote") or {}
        if on_status:
            on_status(f"發現新版本 ({rem.get('short_sha', '')})，正在自動更新…")
        apply_update(timeout=20)
        return True
    except Exception:
        return False
