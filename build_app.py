"""
自動打包腳本 (build_app.py)
一鍵將專案打包成桌面視窗程式（desktop.py：Edge WebView2 獨立視窗＋載入動畫，沒有黑色主控台）：
1. 綠色免安裝單一執行檔: dist/股票交易分析系統.exe（啟動時先解壓縮，期間顯示啟動圖）
2. 整合安裝程式: dist/股票交易分析系統_Setup.exe（安裝資料夾版，不必解壓縮，開啟最快）
需要：pip install -r requirements-desktop.txt（pywebview、pyinstaller）；有 Pillow 時會產生啟動圖。
"""

import shutil
import subprocess
import sys
from pathlib import Path

# 確保輸出不因 Windows cp950 編碼報錯
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

ROOT = Path(__file__).resolve().parent
DIST_DIR = ROOT / "dist"
BUILD_DIR = ROOT / "build"
WEB_DIR = ROOT / "web"
ICON_PATH = ROOT / "app.ico"


def get_pyinstaller_cmd() -> list:
    candidates = [
        shutil.which("pyinstaller"),
        r"C:\Users\code0\AppData\Local\Programs\Python\Python310\Scripts\pyinstaller.exe",
    ]
    for c in candidates:
        if c and Path(c).exists():
            return [str(c)]
    return [sys.executable, "-m", "PyInstaller"]


APP_NAME = "股票交易分析系統"
APP_DIR = DIST_DIR / APP_NAME  # 資料夾版（安裝程式用）


def build_web_dir() -> Path:
    """前端事先編譯（JSX → app.bundle.js，不帶 Babel）；沒有 Node.js 時退回原始碼版（瀏覽器即時轉譯）。"""
    try:
        import build_web
        return build_web.build()
    except RuntimeError as e:
        if "JSX 編譯失敗" in str(e):
            raise  # 語法錯誤：不要打包出會白屏的版本
        print(f"  [略過] 前端事先編譯：{e}；改用原始碼版 web/")
        return WEB_DIR


def make_splash_image():
    """單一 exe 解壓縮期間顯示的啟動圖（PyInstaller --splash）。沒有 Pillow 就略過，不影響打包。"""
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError:
        print("  [略過] 沒有 Pillow，單一 exe 不加啟動圖（pip install pillow 可加上）")
        return None
    w, h = 520, 300
    img = Image.new("RGB", (w, h), "#0d1117")
    d = ImageDraw.Draw(img)
    # 圖示：藍色漸層圓角方塊＋兩根 K 棒（與 index.html 的載入動畫一致）
    logo = Image.new("RGB", (72, 72))
    for y in range(72):
        for x in range(72):
            t = (x + y) / 142
            logo.putpixel((x, y), (int(14 + (79 - 14) * t), int(165 + (70 - 165) * t), int(233 + (229 - 233) * t)))
    mask = Image.new("L", (72, 72), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, 71, 71), radius=16, fill=255)
    lx, ly = (w - 72) // 2, 52
    img.paste(logo, (lx, ly), mask)
    s = 72 / 32
    for x1, y1, x2, y2, wick, fill in ((9.5, 10, 14.5, 22, (12, 6, 12, 25), True), (18.5, 8, 23.5, 18, (21, 5, 21, 22), False)):
        d.line([(lx + wick[0] * s, ly + wick[1] * s), (lx + wick[2] * s, ly + wick[3] * s)], fill="white", width=4)
        d.rounded_rectangle((lx + x1 * s, ly + y1 * s, lx + x2 * s, ly + y2 * s), radius=2,
                            fill="white" if fill else (36, 110, 230), outline="white", width=4)

    def font(size, bold=False):
        for name in (("msjhbd.ttc", "msjh.ttc") if bold else ("msjh.ttc",)) + ("arial.ttf",):
            try:
                return ImageFont.truetype(name, size)
            except OSError:
                continue
        return ImageFont.load_default()

    for text, y, size, color, bold in ((APP_NAME, 150, 28, "#dde2e9", True), ("AI STOCK TRADING ANALYSIS", 194, 12, "#6b7584", False),
                                       ("正在啟動…", 246, 14, "#9aa4b2", False)):
        f = font(size, bold)
        tw = d.textlength(text, font=f)
        d.text(((w - tw) / 2, y), text, font=f, fill=color)
    d.rounded_rectangle((150, 232, 370, 235), radius=2, fill="#222934")
    d.rounded_rectangle((150, 232, 238, 235), radius=2, fill="#3987e5")
    out = BUILD_DIR / "splash.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out)
    return out


def pyinstaller_base(web_dir: Path, name: str, mode: str) -> list:
    """桌面版共用參數：desktop.py 為入口、無主控台（--windowed）。"""
    return get_pyinstaller_cmd() + [
        "--noconfirm",
        "--clean",
        mode,
        "--windowed",
        f"--name={name}",
        f"--icon={ICON_PATH}",
        f"--add-data={web_dir};web",
        f"--add-data={ROOT / '.env.example'};.",
        "--collect-submodules=src",
        f"--workpath={BUILD_DIR / mode.strip('-')}",
        f"--specpath={BUILD_DIR}",
    ]


def check_desktop_deps() -> None:
    try:
        import webview  # noqa: F401  只檢查有沒有安裝
    except ImportError:
        raise RuntimeError("缺少 pywebview，請先執行：pip install -r requirements-desktop.txt") from None


def build_portable_exe(web_dir: Path) -> Path:
    """第一步：單一便攜式 exe（啟動時解壓縮到暫存區，期間顯示啟動圖）"""
    print(f"\n[1/4] 正在打包單一可執行檔 ({APP_NAME}.exe)...")
    cmd = pyinstaller_base(web_dir, APP_NAME, "--onefile")
    splash = make_splash_image()
    if splash:
        cmd.append(f"--splash={splash}")
    cmd.append(str(ROOT / "desktop.py"))

    res = subprocess.run(cmd, cwd=str(ROOT))
    if res.returncode != 0:
        raise RuntimeError("PyInstaller 打包可執行檔失敗！")

    exe_path = DIST_DIR / f"{APP_NAME}.exe"
    if not exe_path.exists():
        raise FileNotFoundError(f"未找到產生的 exe: {exe_path}")

    size_mb = exe_path.stat().st_size / (1024 * 1024)
    print(f"  [OK] 成功產生單一可執行檔: {exe_path} ({size_mb:.2f} MB)")
    return exe_path


def build_app_folder(web_dir: Path) -> Path:
    """第二步：資料夾版（exe＋_internal），不必解壓縮，給安裝程式用"""
    print(f"\n[2/4] 正在打包資料夾版 ({APP_DIR})...")
    cmd = pyinstaller_base(web_dir, APP_NAME, "--onedir") + [str(ROOT / "desktop.py")]
    res = subprocess.run(cmd, cwd=str(ROOT))
    if res.returncode != 0:
        raise RuntimeError("PyInstaller 打包資料夾版失敗！")
    if not (APP_DIR / f"{APP_NAME}.exe").exists():
        raise FileNotFoundError(f"未找到產生的資料夾版: {APP_DIR}")
    size_mb = sum(f.stat().st_size for f in APP_DIR.rglob("*") if f.is_file()) / (1024 * 1024)
    print(f"  [OK] 成功產生資料夾版: {APP_DIR} ({size_mb:.2f} MB)")
    return APP_DIR


def create_installer_script() -> Path:
    """準備安裝程式的原始碼 installer_main.py"""
    installer_code = r'''"""
股票交易分析系統 - 一鍵安裝精靈
安裝到「執行安裝程式的資料夾」底下的「股票交易分析系統」資料夾（沒有寫入權限時改裝到 %LOCALAPPDATA%\TradingSystem），
並在桌面（支援 OneDrive 桌面）與開始功能表建立捷徑。
"""
import base64
import ctypes
import os
import shutil
import subprocess
import sys
import uuid
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

APP_NAME = "股票交易分析系統"
LEGACY_DIR = Path(os.environ.get("LOCALAPPDATA", str(Path.home() / "AppData" / "Local"))) / "TradingSystem"
# Windows Known Folder ID（桌面被 OneDrive 接管時，路徑不是 %USERPROFILE%\Desktop）
FOLDERID_DESKTOP = "{B4BFCC3A-DB2C-424C-B029-7FE99A87C641}"
FOLDERID_PROGRAMS = "{A77F5D77-2E2B-44C3-A6A2-ABA601054A51}"


class _GUID(ctypes.Structure):
    _fields_ = [("Data1", ctypes.c_ulong), ("Data2", ctypes.c_ushort), ("Data3", ctypes.c_ushort),
                ("Data4", ctypes.c_ubyte * 8)]


def known_folder(folder_id: str, fallback: Path) -> Path:
    """用 SHGetKnownFolderPath 取得實際的系統資料夾路徑。"""
    try:
        u = uuid.UUID(folder_id)
        g = _GUID(u.fields[0], u.fields[1], u.fields[2], (ctypes.c_ubyte * 8).from_buffer_copy(u.bytes[8:]))
        out = ctypes.c_wchar_p()
        if ctypes.windll.shell32.SHGetKnownFolderPath(ctypes.byref(g), 0, None, ctypes.byref(out)) == 0:
            path = out.value
            ctypes.windll.ole32.CoTaskMemFree(out)
            if path:
                return Path(path)
    except Exception:
        pass
    return fallback


def create_shortcut(target: Path, shortcut: Path, icon: Path, work_dir: Path) -> bool:
    """用 PowerShell 建立 .lnk。指令以 UTF-16 編碼傳遞，中文路徑不會變亂碼；回傳捷徑檔是否真的存在。"""
    q = lambda p: str(p).replace("'", "''")  # noqa: E731  PowerShell 單引號字串跳脫
    ps = (
        "$s = New-Object -ComObject WScript.Shell;"
        f"$l = $s.CreateShortcut('{q(shortcut)}');"
        f"$l.TargetPath = '{q(target)}';"
        f"$l.WorkingDirectory = '{q(work_dir)}';"
        f"$l.IconLocation = '{q(icon)},0';"
        f"$l.Description = '{APP_NAME}';"
        "$l.Save()"
    )
    encoded = base64.b64encode(ps.encode("utf-16-le")).decode("ascii")
    try:
        shortcut.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
                        "-EncodedCommand", encoded], check=False, capture_output=True,
                       creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except Exception:
        pass
    return shortcut.exists()


def writable(d: Path) -> bool:
    try:
        d.mkdir(parents=True, exist_ok=True)
        probe = d / ".write_test"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink()
        return True
    except Exception:
        return False


POINTER = LEGACY_DIR.parent / APP_NAME / "install_location.txt"  # 記錄上次安裝位置，重裝到別處時可搬資料


def previous_installs() -> list:
    found = []
    try:
        p = Path(POINTER.read_text(encoding="utf-8").strip())
        if p.is_dir():
            found.append(p)
    except OSError:
        pass
    if LEGACY_DIR.is_dir():
        found.append(LEGACY_DIR)
    return found


def remember_install(install_dir: Path) -> None:
    try:
        POINTER.parent.mkdir(parents=True, exist_ok=True)
        POINTER.write_text(str(install_dir), encoding="utf-8")
    except OSError:
        pass


def choose_install_dir() -> Path:
    setup_dir = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else Path.cwd()
    preferred = setup_dir / APP_NAME
    if writable(preferred):
        return preferred
    print(f"  [提示] {preferred} 沒有寫入權限，改安裝到 {LEGACY_DIR}")
    LEGACY_DIR.mkdir(parents=True, exist_ok=True)
    return LEGACY_DIR


def main():
    if sys.platform == "win32":
        try:
            os.system(f"title {APP_NAME} 安裝精靈")
        except Exception:
            pass

    print("=" * 60)
    print(f"        * {APP_NAME} - 安裝精靈 *")
    print("=" * 60)

    install_dir = choose_install_dir()
    print(f"正在安裝至: {install_dir}")

    base_dir = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
    target_exe = install_dir / f"{APP_NAME}.exe"
    target_ico = install_dir / "app.ico"
    # 資料夾版（exe＋_internal）：先清掉舊的 _internal，避免殘留上一版的檔案；data\ 與 .env 不在裡面，不受影響
    try:
        if (install_dir / "_internal").exists():
            shutil.rmtree(install_dir / "_internal")
        shutil.copytree(base_dir / "app", install_dir, dirs_exist_ok=True)
    except PermissionError:
        msg = f"{APP_NAME} 正在執行中，無法覆蓋程式檔案。\n請先關閉程式視窗，再重新執行安裝程式。"
        print("  [失敗] " + msg)
        try:
            ctypes.windll.user32.MessageBoxW(0, msg, "安裝失敗", 0x10)
        except Exception:
            pass
        sys.exit(1)
    if (base_dir / "app.ico").exists():
        shutil.copy2(base_dir / "app.ico", target_ico)
    if (base_dir / ".env.example").exists():
        shutil.copy2(base_dir / ".env.example", install_dir / ".env.example")
    # 上次安裝在別的位置（或舊版的 %LOCALAPPDATA%\TradingSystem）：把金鑰（.env）與使用者資料（data\）帶過來
    for old in previous_installs():
        if old == install_dir:
            continue
        if (old / ".env").exists() and not (install_dir / ".env").exists():
            shutil.copy2(old / ".env", install_dir / ".env")
            print(f"  [OK] 已沿用上次的金鑰設定（{old}）")
        if (old / "data").is_dir() and not (install_dir / "data").exists():
            shutil.copytree(old / "data", install_dir / "data")
            print(f"  [OK] 已沿用上次的持股與交易紀錄（{old / 'data'}）")
    remember_install(install_dir)
    print("  [OK] 程式檔案安裝完成")

    icon = target_ico if target_ico.exists() else target_exe
    desktop = known_folder(FOLDERID_DESKTOP, Path.home() / "Desktop")
    programs = known_folder(FOLDERID_PROGRAMS,
                            Path(os.environ.get("APPDATA", str(Path.home()))) / "Microsoft" / "Windows" / "Start Menu" / "Programs")
    desktop_lnk = desktop / f"{APP_NAME}.lnk"
    start_lnk = programs / f"{APP_NAME}.lnk"
    created = []
    for label, lnk in (("桌面捷徑", desktop_lnk), ("開始功能表捷徑", start_lnk)):
        if create_shortcut(target_exe, lnk, icon, install_dir):
            created.append(lnk)
            print(f"  [OK] 已建立{label}: {lnk}")
        else:
            print(f"  [失敗] 無法建立{label}（{lnk}），可以直接執行 {target_exe}")

    # 解除安裝：Windows 批次檔必須用 CRLF 換行，否則中文會被 cmd 切成亂碼指令
    uninstaller = install_dir / "解除安裝.bat"
    lines = [
        "@echo off",
        "chcp 65001 >nul",
        f"echo 正在解除安裝 {APP_NAME}...",
        *[f'del "{lnk}" 2>nul' for lnk in created],
        "echo 正在移除程式檔案（你的資料 data 資料夾與金鑰 .env 會保留）...",
        *[f'del "{install_dir / n}" 2>nul' for n in (f"{APP_NAME}.exe", "app.ico", ".env.example")],
        f'rmdir /s /q "{install_dir / "_internal"}" 2>nul',
        f'rmdir /s /q "{install_dir / "logs"}" 2>nul',
        "echo 解除安裝已完成！",
        f"echo 你的持股、交易紀錄與金鑰仍保留在：{install_dir}",
        "echo 不需要的話，可以直接刪除整個資料夾。",
        "pause",
        '(goto) 2>nul & del "%~f0"',  # 最後刪掉這個批次檔本身
    ]
    uninstaller.write_bytes(("\r\n".join(lines) + "\r\n").encode("utf-8"))
    print(f"  [OK] 已產生解除安裝工具: {uninstaller}")

    print("\n" + "=" * 60)
    where = "桌面" if desktop_lnk in created else f"安裝資料夾（{install_dir}）"
    print(f"  * 安裝完成！可以從{where}開啟「{APP_NAME}」。")
    print("=" * 60)

    try:
        res = ctypes.windll.user32.MessageBoxW(
            0, f"{APP_NAME} 已安裝完成！\n安裝位置：{install_dir}\n捷徑：{where}\n\n是否立即啟動？",
            "安裝成功", 0x00000004 | 0x00000040)
        if res == 6:
            os.startfile(str(target_exe))
    except Exception as e:
        print(f"啟動提示: {e}")


if __name__ == "__main__":
    main()
'''
    script_path = ROOT / "installer_main.py"
    script_path.write_text(installer_code, encoding="utf-8")
    return script_path


def build_installer_exe(app_dir: Path) -> Path:
    """第三步：將資料夾版與安裝腳本打包成單一 Setup 安裝程式"""
    print("\n[3/4] 正在製作安裝包 (股票交易分析系統_Setup.exe)...")
    installer_script = create_installer_script()

    cmd = get_pyinstaller_cmd() + [
        "--noconfirm",
        "--clean",
        "--onefile",
        "--name=股票交易分析系統_Setup",
        f"--icon={ICON_PATH}",
        f"--workpath={BUILD_DIR / 'setup'}",
        f"--specpath={BUILD_DIR}",
        f"--add-data={app_dir};app",
        f"--add-data={ICON_PATH};.",
        f"--add-data={ROOT / '.env.example'};.",
        str(installer_script),
    ]
    
    res = subprocess.run(cmd, cwd=str(ROOT))
    if res.returncode != 0:
        raise RuntimeError("PyInstaller 打包安裝程式失敗！")
    
    installer_path = DIST_DIR / "股票交易分析系統_Setup.exe"
    if not installer_path.exists():
        raise FileNotFoundError(f"未找到產生的安裝包: {installer_path}")
    
    size_mb = installer_path.stat().st_size / (1024 * 1024)
    print(f"  [OK] 成功產生安裝包: {installer_path} ({size_mb:.2f} MB)")
    return installer_path


def main():
    print("=" * 60)
    print("開始構建 股票交易分析系統 Windows 執行檔與安裝包")
    print("=" * 60)
    
    check_desktop_deps()
    web_dir = build_web_dir()
    portable_exe = build_portable_exe(web_dir)
    app_dir = build_app_folder(web_dir)
    installer_exe = build_installer_exe(app_dir)

    print("\n[4/4] 全部打包構建完成！")
    print("=" * 60)
    print(f"1. 免安裝綠色單一執行檔: {portable_exe}")
    print(f"2. 資料夾版（可直接執行）: {app_dir / (APP_NAME + '.exe')}")
    print(f"3. 一鍵安裝程式 Setup:     {installer_exe}")
    print("=" * 60)


if __name__ == "__main__":
    main()
