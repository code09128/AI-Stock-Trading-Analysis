"""
Windows 桌面原生通知 (notifier.py)
透過 PowerShell 呼叫 Windows 10/11 原生 Toast 通知，無需額外安裝第三方套件。
"""

import os
import subprocess
import sys
from xml.sax.saxutils import escape

# Windows 只顯示「已註冊的 AppUserModelID」送出的通知；自訂名稱沒有註冊會被靜默丟掉，這裡借用 PowerShell 的 ID
_AUMID = r"{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe"

# 通知內容用環境變數傳進去：放在指令字串裡的話，$ 與反引號會被 PowerShell 當成變數或跳脫字元
_PS = """
$xml = [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]::new()
$xml.LoadXml($env:TA_TOAST_XML)
$toast = [Windows.UI.Notifications.ToastNotification, Windows.UI.Notifications, ContentType = WindowsRuntime]::new($xml)
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]::CreateToastNotifier($env:TA_TOAST_APP).Show($toast)
""".strip()


def toast_xml(title: str, message: str) -> str:
    return ("<toast><visual><binding template='ToastGeneric'>"
            f"<text>{escape(title)}</text><text>{escape(message)}</text></binding></visual></toast>")


def send_notification(title: str, message: str) -> bool:
    """在 Windows 桌面右下角彈出原生 Toast 通知（會花 1～2 秒啟動 PowerShell，請在背景執行緒呼叫）。"""
    if sys.platform != "win32":
        print(f"[NOTIFY] {title}: {message}")
        return False
    env = dict(os.environ, TA_TOAST_XML=toast_xml(title, message), TA_TOAST_APP=_AUMID)
    try:
        r = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", _PS],
            capture_output=True,
            timeout=8,
            env=env,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        if r.returncode != 0:
            print(f"通知發送失敗：{r.stderr.decode('utf-8', 'replace')[:300]}", file=sys.stderr)
        return r.returncode == 0
    except Exception as e:
        print(f"通知發送失敗：{e}", file=sys.stderr)
        return False
