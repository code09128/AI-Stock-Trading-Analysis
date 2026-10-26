"""
桌面版啟動（desktop.py）：用 Windows 內建的 Edge WebView2 開獨立視窗，不開瀏覽器、不顯示黑色主控台。
- 視窗一出現就顯示載入動畫（與 web/index.html 同一段），伺服器在背景啟動後切到看盤畫面
- 8088 已經有本程式在跑（例如 start.bat 開著）就直接連過去；被其他程式佔用就往後找空的埠
- 按 X 會詢問「縮到系統匣（背景繼續檢查提醒）／結束程式」；沒有主控台時，輸出與錯誤寫到 logs/desktop.log
需要 pywebview（pip install -r requirements-desktop.txt）；只想用瀏覽器開照舊執行 run.py。
用法：python desktop.py [埠號] [--background]（--background：開機自動啟動用，直接縮在系統匣）
"""

import os
import re
import socket
import sys
import threading
import time
import traceback
import urllib.request

from src.server.config import WEB_DIR, get_app_dir, get_resource_dir

APP_NAME = "股票交易分析系統"
DEFAULT_PORT = 8088
SPLASH_FALLBACK = '<div id="splash" style="position:fixed;inset:0;background:#0d1117"></div>'
_NO_PROXY = urllib.request.build_opener(urllib.request.ProxyHandler({}))  # 連本機不要走系統代理


def _setup_output(app_dir) -> None:
    """打包成無主控台的 exe 時 sys.stdout／stderr 是 None，改寫到 logs/desktop.log（超過 1 MB 輪替一次）。"""
    if sys.stdout is not None and sys.stderr is not None:
        return
    log_dir = app_dir / "logs"
    try:
        log_dir.mkdir(parents=True, exist_ok=True)
        path = log_dir / "desktop.log"
        if path.exists() and path.stat().st_size > 1_000_000:
            path.replace(log_dir / "desktop.old.log")
        f = open(path, "a", encoding="utf-8", buffering=1)
    except OSError:
        import os
        f = open(os.devnull, "w", encoding="utf-8")
    f.write(f"\n===== {time.strftime('%Y-%m-%d %H:%M:%S')} 啟動 =====\n")
    sys.stdout = sys.stdout or f
    sys.stderr = sys.stderr or f


def _message_box(text: str) -> None:
    try:
        import ctypes
        ctypes.windll.user32.MessageBoxW(0, text, APP_NAME, 0x10)
    except Exception:
        print(text, file=sys.stderr)


def _splash_html(msg: str) -> str:
    """從 index.html 取出載入動畫（<style id="splash-css"> 與 <!--splash-->…<!--/splash-->），兩邊畫面才會一致。"""
    try:
        html = (WEB_DIR / "index.html").read_text(encoding="utf-8")
        css = re.search(r'<style id="splash-css">.*?</style>', html, re.S).group(0)
        body = re.search(r"<!--splash-->(.*?)<!--/splash-->", html, re.S).group(1)
        body = body.replace("正在載入介面…", msg)
    except (OSError, AttributeError):
        css, body = "", SPLASH_FALLBACK
    return (f'<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="UTF-8">{css}</head>'
            f'<body style="margin:0;background:#0d1117">{body}</body></html>')


def _error_html(err: str) -> str:
    esc = err.replace("&", "&amp;").replace("<", "&lt;")
    return ('<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="UTF-8"></head>'
            '<body style="margin:0;background:#0d1117;color:#dde2e9;font-family:\'Microsoft JhengHei\',sans-serif;'
            'display:flex;align-items:center;justify-content:center;height:100vh">'
            '<div style="max-width:560px;padding:24px;line-height:1.7">'
            f'<h2 style="margin:0 0 8px;color:#f43f5e">{APP_NAME}無法啟動</h2>'
            f'<pre style="white-space:pre-wrap;color:#9aa4b2;font-size:13px">{esc}</pre>'
            '<p style="font-size:13px;color:#9aa4b2">詳細錯誤記錄在程式資料夾的 logs\\desktop.log。'
            '也可以改用 start.bat（瀏覽器版）開啟。</p></div></body></html>')


def _listening(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.3)
        return s.connect_ex(("127.0.0.1", port)) == 0


def _is_ours(port: int) -> bool:
    try:
        with _NO_PROXY.open(f"http://127.0.0.1:{port}/", timeout=1.5) as r:
            return APP_NAME in r.read(4096).decode("utf-8", "replace")
    except Exception:
        return False


def _start_server(port: int):
    """回傳 (server 或 None, 實際埠號)。先檢查埠是否已有人在聽：Windows 上 SO_REUSEADDR 會讓兩個伺服器搶同一個埠。"""
    for p in range(port, port + 20):
        if _listening(p):
            if _is_ours(p):
                print(f"埠 {p} 已有本程式在執行，直接連線")
                return None, p
            continue
        from src.server.api_server import make_server  # 載入所有模組較久，放在視窗顯示之後
        return make_server(p), p
    raise RuntimeError(f"埠 {port}～{port + 19} 都被其他程式佔用")


def _close_pyi_splash() -> None:
    """打包版的 PyInstaller 啟動圖（解壓縮期間顯示）在視窗出現後關掉。"""
    if "_PYI_SPLASH_IPC" not in os.environ:  # 沒有啟動圖（原始碼、資料夾版）：import 會在紀錄印出誤導人的錯誤
        return
    try:
        import pyi_splash  # 只存在於打包版
        pyi_splash.close()
    except Exception:
        pass


def _tray_is_default() -> bool:
    """關閉確認對話框的預設選項：設定頁「關閉視窗後常駐背景提醒」開著（預設）就預設縮到系統匣。"""
    try:
        from src.server import user_data
        raw = user_data.load().get("values", {}).get("tw_us_bg_alerts_v1")
        if raw is not None:
            return str(raw).strip().strip('"').lower() not in ("false", "0")
    except Exception:
        pass
    return True


def _run_with_timeout(fn, timeout: float, name: str):
    """在另一個執行緒跑 fn，最多等 timeout 秒；逾時回傳 None（卡住的執行緒是 daemon，不會擋住結束）。"""
    box: dict = {}

    def run():
        try:
            box["v"] = fn()
        except Exception:
            traceback.print_exc()

    t = threading.Thread(target=run, daemon=True, name=name)
    t.start()
    t.join(timeout)
    return box.get("v")


def _boot(window, state: dict, port: int) -> None:
    try:
        from src.server import updater
        updater.auto_update_on_boot(on_status=lambda msg: not state.get("hidden") and window.load_html(_splash_html(msg)))
        server, p = _start_server(port)
        state["server"] = server
        if server:
            threading.Thread(target=server.serve_forever, daemon=True, name="http-server").start()
        _start_background(window, state)
        if state.get("hidden"):  # 縮在系統匣啟動：視窗不會出現，shown 事件不會觸發
            _close_pyi_splash()
        window.load_url(f"http://127.0.0.1:{p}/")
    except Exception as e:
        traceback.print_exc()
        window.load_html(_error_html(f"{type(e).__name__}: {e}"))


def _start_background(window, state: dict) -> None:
    """背景提醒引擎＋系統匣。引擎只在視窗縮到系統匣時檢查（視窗開著時由頁面檢查），避免同一則提醒觸發兩次。"""
    try:
        from src.server.alert_engine import ALERT_ENGINE
        from src.server.tray_icon import TrayIcon

        ALERT_ENGINE.set_window_visible(not state.get("hidden"))
        ALERT_ENGINE.start()
        state["alert_engine"] = ALERT_ENGINE
        tray = TrayIcon(title=APP_NAME, icon_path=str(get_resource_dir() / "app.ico"),
                        on_open=lambda: _show_window(window, state),
                        on_toggle_pause=ALERT_ENGINE.set_paused,
                        on_exit=lambda: _exit_app(window, state))
        tray.start()
        state["tray"] = tray
    except Exception:  # 背景提醒失敗不影響主程式
        traceback.print_exc()


FLUSH_JS = "(window.TA && window.TA.flushUserData) ? (window.TA.flushUserData(true), 1) : 0"
ASK_CLOSE_JS = "(window.TA && window.TA.askClose) ? (window.TA.askClose(%s), 1) : 0"


def _set_page_hidden(window, hidden: bool) -> None:
    """通知頁面目前是否縮在系統匣：縮著時頁面停止檢查提醒；回到前景時從資料檔重新載入提醒（背景可能已觸發）。"""
    js = f"window.TA && window.TA.setDesktopHidden && window.TA.setDesktopHidden({'true' if hidden else 'false'})"
    _run_with_timeout(lambda: window.evaluate_js(js), 1.5, "page-hidden")


def _hide_to_tray(window, state: dict) -> None:
    if not state.get("tray"):  # 系統匣沒有啟動成功：縮下去就找不回來，直接結束
        _exit_app(window, state)
        return
    _run_with_timeout(lambda: window.evaluate_js(FLUSH_JS), 1.5, "flush-before-hide")
    state["hidden"] = True
    _set_page_hidden(window, True)
    window.hide()
    engine = state.get("alert_engine")
    if engine:
        engine.set_window_visible(False)
    if not state.get("notified_tray"):
        state["notified_tray"] = True
        from src.server import notifier
        threading.Thread(target=notifier.send_notification, daemon=True, name="tray-notice", args=(
            APP_NAME, "已縮到右下角系統匣，會繼續在背景檢查提醒。要完全結束請在系統匣圖示按右鍵。")).start()


def _show_window(window, state: dict) -> None:
    state["hidden"] = False
    engine = state.get("alert_engine")
    if engine:
        engine.set_window_visible(True)
    try:
        window.show()
        window.restore()
    except Exception:
        traceback.print_exc()
    threading.Thread(target=_set_page_hidden, args=(window, False), daemon=True).start()


def _exit_app(window, state: dict) -> None:
    """真的結束：先隱藏視窗（使用者感覺立刻關掉），再在背景平行收尾，最多 4 秒一定結束。
    順序限制只有一個：伺服器要等頁面把最後的修改送出後才能關；提醒引擎、系統匣與存檔同時進行。"""
    with state.setdefault("lock", threading.Lock()):
        if state.get("exiting"):
            return
        state["exiting"] = True
    threading.Timer(4.0, lambda: os._exit(0)).start()  # 保險：任何一步卡住都不會讓程式關不掉

    def cleanup():
        try:
            window.hide()
        except Exception:
            pass
        workers = []
        engine, tray = state.pop("alert_engine", None), state.pop("tray", None)
        if engine:
            workers.append(threading.Thread(target=engine.stop, daemon=True, name="stop-alerts"))
        if tray:
            workers.append(threading.Thread(target=tray.stop, daemon=True, name="stop-tray"))
        for t in workers:
            t.start()
        # 頁面最後 0.5 秒內的修改可能還沒送出：送出後等 keepalive 請求到達
        if _run_with_timeout(lambda: window.evaluate_js(FLUSH_JS), 1.5, "flush-on-exit"):
            time.sleep(0.3)
        server = state.pop("server", None)
        if server:
            _run_with_timeout(lambda: (server.shutdown(), server.server_close()), 1.0, "stop-server")
        for t in workers:
            t.join(1.0)  # 系統匣圖示要確實移除，否則右下角會殘留一個點了沒反應的圖示
        try:
            window.destroy()
        except Exception:
            pass
        # WebView2 收尾有時要好幾秒：最多再等 1 秒就直接結束（資料都已存好）
        threading.Timer(1.0, lambda: os._exit(0)).start()

    threading.Thread(target=cleanup, daemon=True, name="cleanup-on-exit").start()


def _ask_close(window, state: dict) -> None:
    """按下視窗的 X：在頁面上問「縮到系統匣／結束程式／取消」，選擇由 DesktopApi.close_choice 傳回來。
    頁面還沒載入或沒有回應時改用系統對話框。"""
    if state.get("asking"):
        return
    state["asking"] = True
    try:
        has_tray = bool(state.get("tray"))
        arg = '{"tray": %s, "trayDefault": %s}' % (
            "true" if has_tray else "false", "true" if has_tray and _tray_is_default() else "false")
        if _run_with_timeout(lambda: window.evaluate_js(ASK_CLOSE_JS % arg), 1.5, "ask-close"):
            return  # 對話框已顯示；asking 由 close_choice 清掉
        if window.create_confirmation_dialog(APP_NAME, "確定要結束程式嗎？"):
            _exit_app(window, state)
        state["asking"] = False
    except Exception:
        traceback.print_exc()
        _exit_app(window, state)


class DesktopApi:
    """給頁面呼叫的 window.pywebview.api。屬性用底線開頭，pywebview 才不會把視窗物件也公開給頁面。"""

    def __init__(self, state: dict):
        self._state = state
        self._window = None

    def close_choice(self, choice: str) -> bool:
        state, window = self._state, self._window
        state["asking"] = False
        if window is None:
            return False
        if choice == "exit":
            _exit_app(window, state)
        elif choice == "tray":
            threading.Thread(target=_hide_to_tray, args=(window, state), daemon=True, name="hide-to-tray").start()
        return True

    def set_zoom(self, factor) -> bool:
        """整個畫面縮放（WebView2 的 ZoomFactor，等同瀏覽器的 Ctrl＋加減號）：
        CSS 看到的視窗寬度跟著改變，響應式版面會重新排列，不會只是把固定版面硬放大而擠壓。"""
        try:
            f = max(0.5, min(2.0, float(factor)))
        except (TypeError, ValueError):
            return False
        form = getattr(self._window, "native", None)
        control = getattr(getattr(form, "browser", None), "webview", None)
        if control is None:
            return False
        from System import Func, Type  # pywebview 的 WinForms 後端已載入 pythonnet

        def apply():
            control.ZoomFactor = f

        form.Invoke(Func[Type](apply))  # WinForms 控制項只能在視窗執行緒上改
        return True


def _on_closing(window, state: dict):
    """closing 事件跑在視窗執行緒上：這裡不能直接執行 JS 或跳對話框（會互相等待而卡死），一律交給另一個執行緒。"""
    if state.get("exiting"):
        return True
    threading.Thread(target=_ask_close, args=(window, state), daemon=True, name="ask-close").start()
    return False


def main() -> int:
    app_dir = get_app_dir()
    _setup_output(app_dir)
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    port = int(args[0]) if args else DEFAULT_PORT
    start_hidden = "--background" in sys.argv  # 開機自動啟動：直接縮在系統匣
    try:
        import webview
    except ImportError:
        _close_pyi_splash()
        _message_box("缺少 pywebview 套件。\n請執行 pip install -r requirements-desktop.txt，或改用 run.py／start.bat 以瀏覽器開啟。")
        return 1

    webview.settings["ALLOW_DOWNLOADS"] = True  # 匯出 CSV、資料備份、操作紀錄
    state: dict = {"hidden": start_hidden}
    api = DesktopApi(state)
    window = webview.create_window(APP_NAME, html=_splash_html("正在啟動…"), width=1440, height=900,
                                   min_size=(960, 640), background_color="#0d1117", text_select=True,
                                   js_api=api, hidden=start_hidden)
    api._window = window
    window.events.shown += _close_pyi_splash
    window.events.closing += lambda: _on_closing(window, state)
    # 頁面每次載入完成（含開機縮在系統匣啟動）都告訴它目前是否在背景
    window.events.loaded += lambda: state.get("hidden") and threading.Thread(
        target=_set_page_hidden, args=(window, True), daemon=True).start()
    try:
        # private_mode=False＋固定 storage_path：localStorage（視窗位置、偏好）下次開啟還在
        webview.start(_boot, (window, state, port), private_mode=False, storage_path=str(app_dir / "data" / "webview"))
    finally:
        _close_pyi_splash()
        for key in ("tray", "alert_engine"):
            obj = state.pop(key, None)
            if obj:
                _run_with_timeout(obj.stop, 1.0, f"stop-{key}")
        server = state.pop("server", None)
        if server:
            _run_with_timeout(server.shutdown, 1.0, "stop-server")
    return 0


if __name__ == "__main__":
    try:
        rc = main()
    except Exception as exc:
        traceback.print_exc()
        _message_box(f"{APP_NAME}啟動失敗：\n{type(exc).__name__}: {exc}\n\n"
                     "若是缺少 WebView2，請安裝 Microsoft Edge WebView2 Runtime，或改用 start.bat（瀏覽器版）。")
        rc = 1
    # 直接結束：不等還在抓報價／新聞的背景執行緒逾時（否則視窗關了程式還會多留 5～8 秒）。
    # 存檔在請求內同步完成且是原子寫入（暫存檔＋置換），關閉前也已先送出最後的修改。
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.flush()
        except Exception:
            pass
    os._exit(rc)
