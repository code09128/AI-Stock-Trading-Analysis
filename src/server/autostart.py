"""
Windows 開機自動啟動管理 (autostart.py)
透過 HKCU 註冊表設置開機啟動，無需系統管理員權限。
"""

import sys
from pathlib import Path

REG_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
APP_NAME = "TradingSystem"


def get_launch_command() -> str:
    """取得啟動本系統的完整指令。如果是打包後的 exe 就直接用 exe 路徑，若是 Python 腳本則用 python desktop.py。"""
    if getattr(sys, "frozen", False):
        return f'"{sys.executable}" --background'
    python_exe = Path(sys.executable)
    pythonw = python_exe.with_name("pythonw.exe")  # 開機啟動不要跳出黑色主控台
    if pythonw.exists():
        python_exe = pythonw
    desktop_py = Path(__file__).resolve().parent.parent.parent / "desktop.py"
    return f'"{python_exe}" "{desktop_py}" --background'


def is_autostart_enabled() -> bool:
    if sys.platform != "win32":
        return False
    import winreg

    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, REG_KEY, 0, winreg.KEY_READ) as key:
            winreg.QueryValueEx(key, APP_NAME)
            return True
    except OSError:
        return False


def set_autostart(enable: bool) -> bool:
    if sys.platform != "win32":
        return False
    import winreg

    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, REG_KEY, 0, winreg.KEY_SET_VALUE) as key:
            if enable:
                cmd = get_launch_command()
                winreg.SetValueEx(key, APP_NAME, 0, winreg.REG_SZ, cmd)
            else:
                try:
                    winreg.DeleteValue(key, APP_NAME)
                except FileNotFoundError:
                    pass
        return True
    except OSError:
        return False
