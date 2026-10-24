"""
Windows 系統匣常駐圖示 (tray_icon.py)
採用純 Win32 ctypes 實作，無需第三方肥大套件，支援 64 位元 Windows。
功能：
- 系統匣常駐圖示與提示字
- 左鍵點擊／雙擊：喚起主視窗 (on_open)
- 右鍵彈出選單：開啟主畫面、暫停／繼續提醒、結束程式
"""

import ctypes
from ctypes import wintypes as w
import sys
import threading
import time
from typing import Callable, Optional

if sys.platform == "win32":
    user32 = ctypes.windll.user32
    shell32 = ctypes.windll.shell32
    kernel32 = ctypes.windll.kernel32

    user32.DefWindowProcW.argtypes = [w.HWND, w.UINT, w.WPARAM, w.LPARAM]
    user32.DefWindowProcW.restype = w.LPARAM
    user32.PostMessageW.argtypes = [w.HWND, w.UINT, w.WPARAM, w.LPARAM]
    user32.PostMessageW.restype = w.BOOL
    # 64 位元下 HWND／HICON 是指標大小，不設 restype 會被截成 32 位元整數
    user32.CreateWindowExW.restype = w.HWND
    user32.CreateWindowExW.argtypes = [w.DWORD, w.LPCWSTR, w.LPCWSTR, w.DWORD, ctypes.c_int, ctypes.c_int,
                                       ctypes.c_int, ctypes.c_int, w.HWND, w.HMENU, w.HINSTANCE, w.LPVOID]
    user32.LoadIconW.restype = w.HICON
    user32.LoadIconW.argtypes = [w.HINSTANCE, w.LPVOID]
    user32.LoadImageW.restype = w.HANDLE
    user32.LoadImageW.argtypes = [w.HINSTANCE, w.LPCWSTR, w.UINT, ctypes.c_int, ctypes.c_int, w.UINT]
    kernel32.GetModuleHandleW.restype = w.HMODULE
    user32.CreatePopupMenu.restype = w.HMENU
    user32.AppendMenuW.argtypes = [w.HMENU, w.UINT, ctypes.c_size_t, w.LPCWSTR]
    user32.TrackPopupMenu.argtypes = [w.HMENU, w.UINT, ctypes.c_int, ctypes.c_int, ctypes.c_int, w.HWND, w.LPVOID]
    user32.DestroyMenu.argtypes = [w.HMENU]
    user32.SetForegroundWindow.argtypes = [w.HWND]

    WM_USER = 0x0400
    WM_TRAYICON = WM_USER + 20
    WM_COMMAND = 0x0111
    WM_RBUTTONUP = 0x0205
    WM_LBUTTONDBLCLK = 0x0203
    WM_LBUTTONUP = 0x0202
    WM_DESTROY = 0x0002
    WM_CLOSE = 0x0010
    IMAGE_ICON = 1
    LR_LOADFROMFILE = 0x0010
    LR_DEFAULTSIZE = 0x0040

    NIM_ADD = 0
    NIM_MODIFY = 1
    NIM_DELETE = 2
    NIF_MESSAGE = 0x01
    NIF_ICON = 0x02
    NIF_TIP = 0x04

    MF_STRING = 0x0000
    MF_SEPARATOR = 0x0800
    TPM_RIGHTBUTTON = 0x0002

    ID_OPEN = 1001
    ID_PAUSE = 1002
    ID_EXIT = 1003

    class NOTIFYICONDATAW(ctypes.Structure):
        _fields_ = [
            ("cbSize", w.DWORD),
            ("hWnd", w.HWND),
            ("uID", w.UINT),
            ("uFlags", w.UINT),
            ("uCallbackMessage", w.UINT),
            ("hIcon", w.HICON),
            ("szTip", w.WCHAR * 128),
            ("dwState", w.DWORD),
            ("dwStateMask", w.DWORD),
            ("szInfo", w.WCHAR * 256),
            ("uTimeoutOrVersion", w.UINT),
            ("szInfoTitle", w.WCHAR * 64),
            ("dwInfoFlags", w.DWORD),
            ("guidItem", ctypes.c_byte * 16),
            ("hBalloonIcon", w.HICON),
        ]

    WNDPROC = ctypes.WINFUNCTYPE(ctypes.c_longlong, w.HWND, w.UINT, w.WPARAM, w.LPARAM)

    class WNDCLASSW(ctypes.Structure):
        _fields_ = [
            ("style", w.UINT),
            ("lpfnWndProc", WNDPROC),
            ("cbClsExtra", ctypes.c_int),
            ("cbWndExtra", ctypes.c_int),
            ("hInstance", w.HINSTANCE),
            ("hIcon", w.HICON),
            ("hCursor", w.HICON),
            ("hbrBackground", w.HBRUSH),
            ("lpszMenuName", w.LPCWSTR),
            ("lpszClassName", w.LPCWSTR),
        ]

    class POINT(ctypes.Structure):
        _fields_ = [("x", w.LONG), ("y", w.LONG)]


class TrayIcon:
    def __init__(
        self,
        title: str = "股票交易分析系統",
        on_open: Optional[Callable[[], None]] = None,
        on_toggle_pause: Optional[Callable[[bool], None]] = None,
        on_exit: Optional[Callable[[], None]] = None,
        icon_path: Optional[str] = None,
    ):
        self.title = title
        self.icon_path = icon_path
        self.on_open = on_open
        self.on_toggle_pause = on_toggle_pause
        self.on_exit = on_exit
        self.paused = False
        self.hwnd = None
        self.thread: Optional[threading.Thread] = None
        if sys.platform == "win32":
            self._wndproc_ref = WNDPROC(self._wnd_proc)

    def _wnd_proc(self, hwnd, msg, wparam, lparam):
        try:
            return self._handle(hwnd, msg, wparam, lparam)
        except Exception:  # 例外不能穿過 Win32 回呼，否則整個訊息迴圈會壞掉
            import traceback
            traceback.print_exc()
            return 0

    def _load_icon(self):
        if self.icon_path:
            h = user32.LoadImageW(None, self.icon_path, IMAGE_ICON, 0, 0, LR_LOADFROMFILE | LR_DEFAULTSIZE)
            if h:
                return h
        return user32.LoadIconW(None, ctypes.c_void_p(32512))  # 系統預設的應用程式圖示

    def _handle(self, hwnd, msg, wparam, lparam):
        if msg == WM_TRAYICON:
            if lparam in (WM_LBUTTONUP, WM_LBUTTONDBLCLK):
                if self.on_open:
                    self.on_open()
                return 0
            elif lparam == WM_RBUTTONUP:
                pt = POINT()
                user32.GetCursorPos(ctypes.byref(pt))
                menu = user32.CreatePopupMenu()
                user32.AppendMenuW(menu, MF_STRING, ID_OPEN, "開啟主畫面")
                pause_label = "繼續提醒" if self.paused else "暫停提醒"
                user32.AppendMenuW(menu, MF_STRING, ID_PAUSE, pause_label)
                user32.AppendMenuW(menu, MF_SEPARATOR, 0, None)
                user32.AppendMenuW(menu, MF_STRING, ID_EXIT, "結束程式")
                user32.SetForegroundWindow(hwnd)
                user32.TrackPopupMenu(menu, TPM_RIGHTBUTTON, pt.x, pt.y, 0, hwnd, None)
                user32.PostMessageW(hwnd, 0, 0, 0)
                user32.DestroyMenu(menu)
                return 0
        elif msg == WM_COMMAND:
            cmd = wparam & 0xFFFF
            if cmd == ID_OPEN and self.on_open:
                self.on_open()
            elif cmd == ID_PAUSE:
                self.paused = not self.paused
                if self.on_toggle_pause:
                    self.on_toggle_pause(self.paused)
            elif cmd == ID_EXIT and self.on_exit:
                self.on_exit()
            return 0
        elif msg == WM_DESTROY:
            self._remove_icon()
            user32.PostQuitMessage(0)
            return 0
        return user32.DefWindowProcW(hwnd, msg, wparam, lparam)

    def _remove_icon(self):
        if self.hwnd:
            nid = NOTIFYICONDATAW()
            nid.cbSize = ctypes.sizeof(NOTIFYICONDATAW)
            nid.hWnd = self.hwnd
            nid.uID = 1
            shell32.Shell_NotifyIconW(NIM_DELETE, ctypes.byref(nid))

    def _run(self):
        if sys.platform != "win32":
            return
        hinst = kernel32.GetModuleHandleW(None)
        cls_name = f"TradingTrayCls_{int(time.time()*1000)}"
        wc = WNDCLASSW()
        wc.hInstance = hinst
        wc.lpszClassName = cls_name
        wc.lpfnWndProc = self._wndproc_ref
        icon = self._load_icon()
        wc.hIcon = icon
        user32.RegisterClassW(ctypes.byref(wc))

        self.hwnd = user32.CreateWindowExW(
            0, cls_name, "TradingSystemTray", 0, 0, 0, 0, 0, 0, 0, hinst, None
        )

        nid = NOTIFYICONDATAW()
        nid.cbSize = ctypes.sizeof(NOTIFYICONDATAW)
        nid.hWnd = self.hwnd
        nid.uID = 1
        nid.uFlags = NIF_ICON | NIF_MESSAGE | NIF_TIP
        nid.uCallbackMessage = WM_TRAYICON
        nid.hIcon = icon
        nid.szTip = self.title[:127]
        shell32.Shell_NotifyIconW(NIM_ADD, ctypes.byref(nid))

        msg = w.MSG()
        while user32.GetMessageW(ctypes.byref(msg), 0, 0, 0) > 0:
            user32.TranslateMessage(ctypes.byref(msg))
            user32.DispatchMessageW(ctypes.byref(msg))

    def start(self):
        if sys.platform != "win32":
            return
        self.thread = threading.Thread(target=self._run, daemon=True, name="TrayThread")
        self.thread.start()

    def stop(self):
        """WM_CLOSE → DestroyWindow → WM_DESTROY（移除圖示、結束訊息迴圈），等執行緒收尾，避免右下角殘留圖示。"""
        if sys.platform == "win32" and self.hwnd:
            user32.PostMessageW(self.hwnd, WM_CLOSE, 0, 0)
        if self.thread and self.thread.is_alive() and self.thread is not threading.current_thread():
            self.thread.join(1.0)
