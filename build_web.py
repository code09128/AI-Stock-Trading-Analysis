"""
前端事先編譯 (build_web.py)：打包前把 web/*.jsx 用 esbuild 轉成一般 JavaScript，合併成 app.bundle.js。
- 輸出到 build/web_dist/（打包用），原始碼的 web/ 不變：開發時照樣用 Babel 即時轉譯、改完重新整理就生效
- 打包版不需要 Babel（少 2.9 MB），開頁面也不用再花約 1 秒轉譯
- 任何 JSX 語法錯誤會讓編譯失敗，壞掉的畫面不會被打包出去
需要 Node.js（npx）。單獨執行：python build_web.py
"""

import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
WEB_DIR = ROOT / "web"
OUT_DIR = ROOT / "build" / "web_dist"
ESBUILD = "esbuild@0.24.0"  # 固定版本
BABEL_TAG = re.compile(r'^\s*<script src="\./vendor/babel\.min\.js"></script>\s*\n', re.M)
JSX_TAG = re.compile(r'^\s*<script type="text/babel" src="\./([^"]+\.jsx)"></script>\s*\n', re.M)


def jsx_order(html: str) -> list:
    """依 index.html 的載入順序（各檔靠 window.TA 互相引用，順序不能亂）。"""
    return JSX_TAG.findall(html)


def build() -> Path:
    npx = shutil.which("npx") or shutil.which("npx.cmd")
    if not npx:
        raise RuntimeError("找不到 Node.js（npx）。請安裝 Node.js，或改用原始碼方式執行。")
    html = (WEB_DIR / "index.html").read_text(encoding="utf-8")
    files = jsx_order(html)
    if not files:
        raise RuntimeError("index.html 裡找不到 JSX 檔")

    if OUT_DIR.exists():
        shutil.rmtree(OUT_DIR)
    tmp = OUT_DIR.parent / "web_jsx_tmp"
    if tmp.exists():
        shutil.rmtree(tmp)

    # 1. esbuild 只做語法轉換（不打包模組），React 是全域變數 → React.createElement
    cmd = [npx, "--yes", ESBUILD, *[str(WEB_DIR / f) for f in files], f"--outdir={tmp}", f"--outbase={WEB_DIR}",
           "--loader:.jsx=jsx", "--jsx=transform", "--target=es2019", "--minify", "--log-level=warning"]
    res = subprocess.run(cmd, cwd=str(ROOT), capture_output=True, text=True, encoding="utf-8", errors="replace")
    if res.returncode != 0:
        raise RuntimeError("JSX 編譯失敗：\n" + (res.stderr or res.stdout))

    # 2. 依順序合併；每個檔各自包一層，避免最上層變數名稱互相衝突
    parts = []
    for f in files:
        js = (tmp / f).with_suffix(".js").read_text(encoding="utf-8")
        parts.append(f"/* {f} */\n;(function(){{\n{js}\n}})();")
    shutil.rmtree(tmp)

    # 3. 複製其他靜態檔（不含 .jsx 與 Babel），改寫 index.html
    shutil.copytree(WEB_DIR, OUT_DIR, ignore=shutil.ignore_patterns("*.jsx", "babel.min.js"))
    (OUT_DIR / "app.bundle.js").write_text("\n".join(parts) + "\n", encoding="utf-8")
    for d in sorted(OUT_DIR.rglob("*"), reverse=True):  # 移除只放 .jsx 的空資料夾
        if d.is_dir() and not any(d.iterdir()):
            d.rmdir()
    out_html = BABEL_TAG.sub("", html)
    first = True

    def repl(m):
        nonlocal first
        if first:
            first = False
            return '  <script src="./app.bundle.js"></script>\n'
        return ""

    out_html = JSX_TAG.sub(repl, out_html)
    (OUT_DIR / "index.html").write_text(out_html, encoding="utf-8")
    size_kb = (OUT_DIR / "app.bundle.js").stat().st_size / 1024
    print(f"  [OK] 前端編譯完成：{len(files)} 個 JSX → app.bundle.js（{size_kb:.0f} KB），輸出 {OUT_DIR}")
    return OUT_DIR


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    build()
