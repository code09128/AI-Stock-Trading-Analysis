"""
前端打包 (build_web.py)：用 esbuild 把 web/main.tsx 與它匯入的所有 .tsx 打成 app.bundle.js（細節見 src/server/web_bundle.py）。
  python build_web.py            打包 exe／dmg 前用：壓縮版輸出到 build/web_dist/（build_app.py 會自動呼叫）
  python build_web.py --web      更新 web/app.bundle.js（要 commit 的那一份；原始碼版啟動時也會自動做）
  python build_web.py --debug    web/app.bundle.js 改成未壓縮＋sourcemap（除錯用，不要 commit）
  python build_web.py --watch    監看原始碼，存檔就重新打包 web/app.bundle.js（等同 npm run dev）
型別直接拿掉、不做型別檢查（型別檢查用 npm run typecheck）；任何語法錯誤會讓編譯失敗，壞掉的畫面不會被打包出去。
需要 Node.js（npx 或 node_modules 裡的 esbuild）。
"""

import shutil
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
WEB_DIR = ROOT / "web"
OUT_DIR = ROOT / "build" / "web_dist"

sys.path.insert(0, str(ROOT))
from src.server import web_bundle  # noqa: E402


def build() -> Path:
    if OUT_DIR.exists():
        shutil.rmtree(OUT_DIR)
    # 其他靜態檔（vendor、index.html）照搬；原始碼、型別宣告、開發時產生的 bundle 與 sourcemap 不帶
    shutil.copytree(WEB_DIR, OUT_DIR, ignore=shutil.ignore_patterns(
        "*.tsx", "*.d.ts", "app.bundle.js", "app.bundle.js.map"), dirs_exist_ok=True)
    try:
        web_bundle.bundle(WEB_DIR, OUT_DIR / web_bundle.BUNDLE, minify=True, root=ROOT)
    except web_bundle.BundleError as e:
        shutil.rmtree(OUT_DIR, ignore_errors=True)
        raise RuntimeError(str(e)) from e
    for d in sorted(OUT_DIR.rglob("*"), reverse=True):  # 移除只放原始碼的空資料夾（pages、panels）
        if d.is_dir() and not any(d.iterdir()):
            d.rmdir()
    size_kb = (OUT_DIR / web_bundle.BUNDLE).stat().st_size / 1024
    n = len(web_bundle.sources(WEB_DIR))
    print(f"  [OK] 前端編譯完成：{n} 個 TSX → app.bundle.js（{size_kb:.0f} KB），輸出 {OUT_DIR}")
    return OUT_DIR


def build_web_bundle(debug: bool = False) -> None:
    out = WEB_DIR / web_bundle.BUNDLE
    web_bundle.bundle(WEB_DIR, out, minify=not debug, root=ROOT, sourcemap=debug)
    print(f"  [OK] {out}（{out.stat().st_size / 1024:.0f} KB{'，未壓縮＋sourcemap：除錯用，不要 commit' if debug else ''}）")


def watch(debug: bool = True) -> None:
    """每秒檢查一次原始碼雜湊，變了就重打。只用標準函式庫（不依賴 esbuild --watch，bundle 開頭的雜湊才會一致）。"""
    last = None
    print("監看前端原始碼中（Ctrl+C 結束）…")
    while True:
        cur = web_bundle.sources_hash(WEB_DIR)
        if cur != last:
            last = cur
            try:
                build_web_bundle(debug=debug)
            except web_bundle.BundleError as e:
                print(f"  [失敗] {e}")
        time.sleep(1)


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    args = sys.argv[1:]
    try:
        if "--watch" in args:
            watch(debug="--minify" not in args)
        elif "--web" in args or "--debug" in args:
            build_web_bundle(debug="--debug" in args)
        else:
            build()
    except (web_bundle.BundleError, RuntimeError) as e:
        print(e)
        sys.exit(1)
    except KeyboardInterrupt:
        pass
