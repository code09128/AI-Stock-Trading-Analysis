"""
線上更新 (updater.py)：只讀 GitHub 正式發布的 Release（例如 v1.0.0、v1.0.1），不讀 main 分支
- 版本號在 src/version.py（APP_VERSION）；發布新版＝改版本號 → commit → 在 GitHub 建立同名 Release
- 打包版（.exe）：重新啟動時自動檢查最新 Release，有新版就下載該版本的 src/ 與 web/ 到程式資料夾的 update/，
  並優先載入 update/ 的程式碼（不碰 data/ 與 .env）；設定頁也可手動「檢查更新」「下載並套用」
- 原始碼版（有 .git）：不會覆蓋開發中的程式碼，只告訴你有新版本，請自己 git pull
- 下載後會核對壓縮檔裡 src/version.py 的版本號和 Release 一致，不一致就不套用

失敗保護（update_state.json）：
- 套用前先驗證（verify_package）：所有 .py 能編譯、index.html 引用的檔案都在；不合格就不套用，目前的版本原封不動。
- 套用後這個版本要在畫面載入完成時回報（前端 POST /api/update/ok → mark_healthy）。連續 MAX_UNHEALTHY_BOOTS 次啟動都沒有回報，
  就判定這個版本壞了：update/ 移到 update_bad/、版本記進 bad、改用內建版。壞版本只是被略過，之後更高的版本照常更新，不會卡住。
- 環境變數 TRADING_SAFE_MODE=1：這次啟動完全不載入 update/（排查問題用）。
限制：這些保護只存在「內建的更新程式」裡；已經發出去的舊版 exe 內建的更新程式沒有，也無法用線上更新補上（打包版的線上更新只能覆蓋
src/ 的非 server 子套件與 web/，覆蓋不到 src/server/，更新程式就在那裡），要重新安裝新版安裝包才有。
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
import ssl
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


def _windows_root_context() -> Optional[ssl.SSLContext]:
    """只信任 Windows「受信任的根憑證」（不含「中繼憑證」）的連線設定。
    有些電腦的中繼憑證區留著舊的交叉簽章憑證（例如被 AAA Certificate Services 簽的 USERTrust ECC），
    Python 驗證 GitHub 憑證鏈時會先挑到它而失敗（unable to get issuer certificate）；瀏覽器與 PowerShell 不受影響。"""
    if not hasattr(ssl, "enum_certificates"):  # 只有 Windows 有
        return None
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    for cert, enc, trust in ssl.enum_certificates("ROOT"):
        if enc == "x509_asn" and (trust is True or "1.3.6.1.5.5.7.3.1" in trust):  # 可用於伺服器驗證
            try:
                ctx.load_verify_locations(cadata=cert)
            except ssl.SSLError:
                pass
    return ctx


def _urlopen(req: urllib.request.Request, timeout: int):
    """一般連線；憑證驗證失敗時改用只信任根憑證的設定再試一次（仍然完整驗證憑證，不會略過）。"""
    try:
        return urllib.request.urlopen(req, timeout=timeout)
    except urllib.error.URLError as e:
        ctx = _windows_root_context() if isinstance(e.reason, ssl.SSLCertVerificationError) else None
        if ctx is None:
            raise
        return urllib.request.urlopen(req, timeout=timeout, context=ctx)


def update_dir() -> Path:
    return get_app_dir() / "update"


def parse_version(v: Any) -> Tuple[int, int, int]:
    """'v1.2.3' / '1.2.3' → (1, 2, 3)；看不懂的回 (0, 0, 0)。"""
    m = re.search(r"(\d+)\.(\d+)\.(\d+)", str(v or ""))
    return tuple(int(x) for x in m.groups()) if m else (0, 0, 0)


def _read_json(path: Path) -> Optional[Dict[str, Any]]:
    try:
        if path.is_file():
            return json.loads(path.read_text(encoding="utf-8-sig"))  # -sig：容許 BOM（手動放的檔案常有）
    except Exception:
        pass
    return None


STATE_NAME = "update_state.json"
_boot_counted = False  # 同一個行程只算一次啟動（desktop 的 auto_update_on_boot 和 make_server 都會呼叫 activate）
MAX_UNHEALTHY_BOOTS = 3  # 同一個更新版本連續幾次啟動都沒有「畫面載入完成」的回報，就判定失敗並還原


def _state_path() -> Path:
    return get_app_dir() / STATE_NAME


def load_state() -> Dict[str, Any]:
    """{'bad': {版本: {reason, at}}, 'pending': {version, boots} 或 None, 'ok': 已確認正常的更新版本或 None}"""
    d = _read_json(_state_path()) or {}
    bad = d.get("bad") if isinstance(d.get("bad"), dict) else {}
    pending = d.get("pending") if isinstance(d.get("pending"), dict) else None
    return {"bad": bad, "pending": pending, "ok": d.get("ok") or None}


def save_state(state: Dict[str, Any]) -> None:
    try:
        _state_path().write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError:
        pass  # 寫不進去（唯讀資料夾）：保護失效但不影響程式本身


def next_boot_state(state: Dict[str, Any], version: str, count_boot: bool = True) -> Tuple[bool, str, Dict[str, Any]]:
    """這次啟動要不要繼續用 update/ 的這個版本。回傳 (繼續用, 不用的原因, 新狀態)。純函式，方便測試。"""
    st = {"bad": dict(state["bad"]), "pending": state["pending"], "ok": state["ok"]}
    if version in st["bad"]:
        return False, "這個版本先前已被判定失敗", st
    if st["ok"] == version:
        return True, "", st
    p = st["pending"] if st["pending"] and st["pending"].get("version") == version else {"version": version, "boots": 0}
    if count_boot and p["boots"] >= MAX_UNHEALTHY_BOOTS:  # 只在「新的一次啟動」才放棄；同一次啟動內的重複呼叫（不計數）不能把剛允許的版本翻掉
        st["pending"] = None
        st["bad"][version] = {"reason": f"連續 {p['boots']} 次啟動都沒有完成畫面載入", "at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")}
        return False, st["bad"][version]["reason"], st
    if count_boot:
        p = {"version": version, "boots": p["boots"] + 1}
    st["pending"] = p
    return True, "", st


def quarantine(version: str, reason: str) -> None:
    """把壞掉的更新版本記進 bad，並把 update/ 移到 update_bad/（留著給人看哪裡壞）。之後更高的版本照常更新。"""
    st = load_state()
    st["bad"].setdefault(version, {"reason": reason, "at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")})  # 已記過就保留原本的原因
    st["pending"] = None
    if st["ok"] == version:
        st["ok"] = None
    save_state(st)
    bad_dir = get_app_dir() / "update_bad"
    shutil.rmtree(bad_dir, ignore_errors=True)
    try:
        os.replace(update_dir(), bad_dir)
    except OSError:
        shutil.rmtree(update_dir(), ignore_errors=True)


def mark_healthy() -> bool:
    """畫面載入完成時由前端回報（POST /api/update/ok）。目前用的是 update/ 的版本才記錄；回傳是否有寫入。"""
    up = _update_info().get("version")
    if not up or current_version().get("source") != "線上更新版":
        return False
    st = load_state()
    if st["ok"] == up:
        return False
    st["ok"], st["pending"] = up, None
    save_state(st)
    return True


_LOCAL_SRC_RE = re.compile(r"""<script[^>]+src=["']\./([^"']+)["']""")


def verify_package(root: Path) -> None:
    """套用前的驗證：不合格就丟 RuntimeError（呼叫端不會套用，目前的版本不動）。"""
    for p in sorted((root / "src").rglob("*.py")):
        try:
            compile(p.read_text(encoding="utf-8"), str(p), "exec")
        except SyntaxError as e:
            raise RuntimeError(f"更新包的 {p.relative_to(root).as_posix()} 第 {e.lineno} 行有語法錯誤，未套用") from None
        except (OSError, ValueError) as e:
            raise RuntimeError(f"更新包的 {p.relative_to(root).as_posix()} 無法讀取（{e}），未套用") from None
    html = (root / "web" / "index.html").read_text(encoding="utf-8", errors="replace")
    for ref in _LOCAL_SRC_RE.findall(html):
        if not (root / "web" / ref.split("?")[0]).is_file():
            raise RuntimeError(f"更新包的 web/index.html 引用了不存在的檔案 {ref}，未套用")


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


def activate_update_if_present(count_boot: bool = True) -> bool:
    """update/ 裡的版本比內建新才掛上（優先載入）；內建版已經一樣新或更新（例如重裝了新的安裝包）就清掉 update/。"""
    up = update_dir()
    if os.environ.get("TRADING_SAFE_MODE") == "1":
        return False
    if not (up / "src").is_dir() or not (up / "web" / "index.html").is_file():
        return False
    ver = str(_update_info().get("version") or "")
    if parse_version(ver) <= parse_version(bundled_version()):
        shutil.rmtree(up, ignore_errors=True)
        return False
    global _boot_counted
    if count_boot:
        count_boot, _boot_counted = not _boot_counted, True
    use, reason, new_state = next_boot_state(load_state(), ver, count_boot=count_boot)
    if not use:
        quarantine(ver, reason)  # 記進 bad、update/ 移到 update_bad/
        print(f"更新版 {ver} 不使用（{reason}），改用內建版", file=sys.stderr)
        return False
    save_state(new_state)

    up_str = str(up)
    if up_str not in sys.path:
        sys.path.insert(0, up_str)
    # 確保 PathFinder 在 PyInstaller 的 PyiFrozenImporter 之前，才會優先讀取 update/src/
    if PathFinder in sys.meta_path and sys.meta_path[0] is not PathFinder:
        sys.meta_path.remove(PathFinder)
        sys.meta_path.insert(0, PathFinder)
    elif PathFinder not in sys.meta_path:
        sys.meta_path.insert(0, PathFinder)
    for name, sub in (("src", ""), ("src.server", "server")):
        # src.server 也要加：已經 import 的 src.server 套件的 __path__ 不會自動跟著 src 變，不加的話 update/src/server/ 永遠不會被載入
        # （實測打包版：只有 src.market 之類的子套件會被更新版取代）。updater 自己已經載入，不受影響＝永遠是內建的那份
        mod = sys.modules.get(name)
        up_pkg = str(up / "src" / sub) if sub else str(up / "src")
        if mod is not None and hasattr(mod, "__path__"):
            paths = list(mod.__path__)
            if up_pkg not in paths:
                mod.__path__ = [up_pkg] + paths
    return True


def fetch_latest_release(timeout: int = 6) -> Dict[str, Any]:
    """GitHub 最新正式 Release（不含草稿與預先發布版）。"""
    req = urllib.request.Request(RELEASES_API, headers=UA)
    try:
        with _urlopen(req, timeout) as resp:
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
    skipped = rel["version"] in load_state()["bad"]  # 這個版本先前更新後壞掉：不再重複下載，等更高的版本
    return {
        "ok": True,
        "has_update": parse_version(rel["version"]) > parse_version(cur["version"]) and not skipped,
        "skipped_bad": skipped,
        "current": cur,
        "remote": rel,
        "repo": REPO,
        "source_checkout": _is_source_checkout(),
    }


def _reload_runtime() -> None:
    """熱重載 src.* 模組與伺服器路由，讓更新不必重開程式也立即生效。"""
    activate_update_if_present(count_boot=False)
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
        with _urlopen(urllib.request.Request(url, headers=UA), timeout) as resp:
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

        verify_package(tmp_dir)  # 不合格就丟例外：不會動到目前的 update/
        info = {"version": rel["version"], "tag": rel["tag"], "name": rel.get("name", ""),
                "published_at": rel.get("published_at", ""), "updated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")}
        (tmp_dir / "version.json").write_text(json.dumps(info, ensure_ascii=False, indent=2), encoding="utf-8")
        old_dir = app_d / "update_old"
        shutil.rmtree(old_dir, ignore_errors=True)
        if target.exists():
            os.replace(target, old_dir)
        os.replace(tmp_dir, target)
        shutil.rmtree(old_dir, ignore_errors=True)
        st = load_state()
        st["pending"], st["ok"] = {"version": rel["version"], "boots": 0}, None  # 新版本要重新通過「畫面載入完成」的確認
        save_state(st)
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
        if rel["version"] in load_state()["bad"]:
            return {"ok": True, "updated": False, "already_latest": False, "mode": "skipped_bad",
                    "msg": f"{rel['tag']} 先前更新後無法正常載入，已還原並略過；等下一個版本會再自動更新",
                    "current": cur, "remote": rel}
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
            on_status(f"發現新版本：v{chk['current']['version']} → {chk['remote']['tag']}，正在下載更新…")
        return bool(apply_update(timeout=20).get("updated"))
    except Exception:
        return False
