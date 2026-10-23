"""
自動打包腳本 (build_app.py)
一鍵將專案打包成：
1. 綠色免安裝單一執行檔: dist/股票交易分析系統.exe
2. 整合安裝程式: dist/股票交易分析系統_Setup.exe
"""

import os
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


def build_portable_exe() -> Path:
    """第一步：使用 PyInstaller 打包單一便攜式 exe"""
    print("\n[1/3] 正在打包單一可執行檔 (股票交易分析系統.exe)...")
    # 前端事先編譯（JSX → app.bundle.js，不帶 Babel）；沒有 Node.js 時退回原始碼版（瀏覽器即時轉譯）
    try:
        import build_web
        web_dir = build_web.build()
    except RuntimeError as e:
        if "JSX 編譯失敗" in str(e):
            raise  # 語法錯誤：不要打包出會白屏的版本
        print(f"  [略過] 前端事先編譯：{e}；改用原始碼版 web/")
        web_dir = WEB_DIR

    cmd = get_pyinstaller_cmd() + [
        "--noconfirm",
        "--clean",
        "--onefile",
        "--name=股票交易分析系統",
        f"--icon={ICON_PATH}",
        f"--add-data={web_dir};web",
        f"--add-data={ROOT / '.env.example'};.",
        "--collect-submodules=src",
        str(ROOT / "run.py"),
    ]
    
    res = subprocess.run(cmd, cwd=str(ROOT))
    if res.returncode != 0:
        raise RuntimeError("PyInstaller 打包可執行檔失敗！")
    
    exe_path = DIST_DIR / "股票交易分析系統.exe"
    if not exe_path.exists():
        raise FileNotFoundError(f"未找到產生的 exe: {exe_path}")
    
    size_mb = exe_path.stat().st_size / (1024 * 1024)
    print(f"  [OK] 成功產生單一可執行檔: {exe_path} ({size_mb:.2f} MB)")
    return exe_path


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
    for name, dst in ((f"{APP_NAME}.exe", target_exe), ("app.ico", target_ico)):
        src = base_dir / name
        if src.exists():
            shutil.copy2(src, dst)
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


def build_installer_exe(portable_exe: Path) -> Path:
    """第二步：將便攜版 exe 與安裝腳本打包成單一 Setup 安裝程式"""
    print("\n[2/3] 正在製作安裝包 (股票交易分析系統_Setup.exe)...")
    installer_script = create_installer_script()
    
    cmd = get_pyinstaller_cmd() + [
        "--noconfirm",
        "--clean",
        "--onefile",
        "--name=股票交易分析系統_Setup",
        f"--icon={ICON_PATH}",
        f"--add-data={portable_exe};.",
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
    
    portable_exe = build_portable_exe()
    installer_exe = build_installer_exe(portable_exe)
    
    print("\n[3/3] 全部打包構建完成！")
    print("=" * 60)
    print(f"1. 免安裝綠色單一執行檔: {portable_exe}")
    print(f"2. 一鍵安裝程式 Setup:   {installer_exe}")
    print("=" * 60)


if __name__ == "__main__":
    main()
