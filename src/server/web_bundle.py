"""
前端打包 (web_bundle.py)：用 esbuild 把 web/main.tsx 與它匯入的所有 .tsx 打成一個 app.bundle.js。

為什麼 app.bundle.js 要進 git：線上更新（updater.py、manual_update.ps1）是下載 Release 標籤的原始碼壓縮包，只取 src/ 與 web/ 放進
update/，已經發出去的舊版更新程式沒辦法改成下載別的東西。web/ 裡沒有現成的 app.bundle.js，更新後的畫面就是空白。
所以：app.bundle.js 一定要跟原始碼一起 commit（發版前確認 tests/test_packaging.py 通過，它會檢查 bundle 沒有過期）。

- bundle 第一行寫入「原始碼的雜湊值」（正規化換行後的 .tsx 內容），用雜湊而不是檔案時間判斷是否過期：
  git checkout／解壓縮／Windows 換行轉換都會改檔案時間與換行，雜湊不受影響。
- 原始碼版（python run.py／start.bat／desktop.py）啟動時呼叫 ensure_dev_bundle()：過期且有 Node.js 才重打；
  沒有 Node.js 但 bundle 還在就沿用並提醒；打包版（frozen）永遠不打包。
- 輸出固定是壓縮版、沒有 sourcemap（跟發版用的完全一樣，commit 才不會每次都有一堆差異）；要除錯用 python build_web.py --debug。
只用標準函式庫；esbuild 固定 0.24.0（package.json 的 devDependency，沒有 node_modules 時退回 npx 臨時下載）。
"""

import hashlib
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import List, Optional

ESBUILD_VERSION = "0.24.0"
ENTRY = "main.tsx"
BUNDLE = "app.bundle.js"
HEADER_RE = re.compile(r"^/\* src-hash: ([0-9a-f]{64})")


class BundleError(RuntimeError):
    pass


def _esbuild_cmd(root: Path) -> Optional[List[str]]:
    """本機 node_modules 的 esbuild 優先（快、不用網路）；沒有就用 npx 臨時下載固定版本；都沒有（沒裝 Node.js）回 None。"""
    local = root / "node_modules" / ".bin" / ("esbuild.cmd" if sys.platform == "win32" else "esbuild")
    if local.exists():
        return [str(local)]
    npx = shutil.which("npx") or shutil.which("npx.cmd")
    return [npx, "--yes", f"esbuild@{ESBUILD_VERSION}"] if npx else None


def sources(web_dir: Path) -> List[Path]:
    return sorted(p for p in web_dir.rglob("*.tsx") if "vendor" not in p.parts)


def sources_hash(web_dir: Path) -> str:
    """所有 .tsx 的（相對路徑＋換行正規化後的內容）雜湊。"""
    h = hashlib.sha256()
    for p in sources(web_dir):
        h.update(p.relative_to(web_dir).as_posix().encode("utf-8") + b"\0")
        h.update(p.read_bytes().replace(b"\r\n", b"\n") + b"\0")
    return h.hexdigest()


def bundle_hash(web_dir: Path) -> Optional[str]:
    """bundle 第一行記錄的原始碼雜湊；沒有 bundle 或格式不對回 None。"""
    out = web_dir / BUNDLE
    if not out.exists():
        return None
    with open(out, "r", encoding="utf-8", errors="replace") as f:
        m = HEADER_RE.match(f.readline())
    return m.group(1) if m else None


def bundle(web_dir: Path, outfile: Path, minify: bool = True, root: Optional[Path] = None, sourcemap: bool = False) -> None:
    """打包 web_dir/main.tsx → outfile。React／ReactDOM 是 index.html 另外載入的全域變數，不打進去。"""
    root = root or web_dir.parent
    base = _esbuild_cmd(root)
    if base is None:
        raise BundleError("找不到 Node.js（npx）。打包前端需要 Node.js：安裝後重開，或改用 Release 的打包版。")
    cmd = base + [str(web_dir / ENTRY), "--bundle", "--format=iife", "--target=es2019", "--jsx=transform",
                  f"--outfile={outfile}", "--log-level=warning", f"--banner:js=/* src-hash: {sources_hash(web_dir)} */"]
    if minify:
        cmd.append("--minify")
    if sourcemap:
        cmd.append("--sourcemap")
    res = subprocess.run(cmd, cwd=str(root), capture_output=True, text=True, encoding="utf-8", errors="replace")
    if res.returncode != 0:
        raise BundleError("前端編譯失敗：\n" + (res.stderr or res.stdout))


def is_stale(web_dir: Path) -> bool:
    """bundle 不存在，或記錄的雜湊和目前的 .tsx 不一致。"""
    return bundle_hash(web_dir) != sources_hash(web_dir)


def ensure_dev_bundle(web_dir: Path) -> str:
    """原始碼版啟動時呼叫。回傳狀態文字（空字串＝一切正常）供呼叫端印出；打包失敗不丟例外，由呼叫端決定要不要繼續。
    打包版（frozen）或沒有 main.tsx 的資料夾直接略過。"""
    if getattr(sys, "frozen", False) or not (web_dir / ENTRY).exists():
        return ""
    if not is_stale(web_dir):
        return ""
    out = web_dir / BUNDLE
    try:
        bundle(web_dir, out)
        return ""
    except BundleError as e:
        if out.exists():
            return f"⚠ 前端沒有重新打包，目前畫面是舊版（{str(e).splitlines()[0]}）"
        return f"❌ 前端還沒有打包，畫面會是空白：{e}"
