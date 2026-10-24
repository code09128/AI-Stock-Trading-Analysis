"""
桌面版啟動（desktop.py）：用 Windows 內建的 Edge WebView2 開獨立視窗，不開瀏覽器、不顯示黑色主控台。
- 視窗一出現就顯示載入動畫（與 web/index.html 同一段），伺服器在背景啟動後切到看盤畫面
- 8088 已經有本程式在跑（例如 start.bat 開著）就直接連過去；被其他程式佔用就往後找空的埠
- 關閉視窗＝結束程式；沒有主控台時，輸出與錯誤寫到 logs/desktop.log
需要 pywebview（pip install -r requirements-desktop.txt）；只想用瀏覽器開照舊執行 run.py。
用法：python desktop.py [埠號]
"""

import os
import re
import socket
import sys
import threading
import time
import traceback
import urllib.request

from src.server.config import WEB_DIR, get_app_dir

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


def _boot(window, state: dict, port: int) -> None:
    try:
        server, p = _start_server(port)
        state["server"] = server
        if server:
            threading.Thread(target=server.serve_forever, daemon=True, name="http-server").start()
        window.load_url(f"http://127.0.0.1:{p}/")
    except Exception as e:
        traceback.print_exc()
        window.load_html(_error_html(f"{type(e).__name__}: {e}"))


FLUSH_JS = "(window.TA && window.TA.flushUserData) ? (window.TA.flushUserData(true), 1) : 0"


def _on_closing(window, state: dict):
    """最後 0.5 秒內的修改可能還沒送出：第一次關閉先取消，在另一個執行緒把資料寫回伺服器後再真的關掉。
    （closing 事件跑在視窗執行緒上，直接在這裡執行 JS 會互相等待而卡死）"""
    if state.get("flushed"):
        return True

    def flush():
        try:
            window.evaluate_js(FLUSH_JS)
            time.sleep(0.3)  # 等 keepalive 的存檔請求送達
        except Exception:
            traceback.print_exc()

    def flush_then_close():
        t = threading.Thread(target=flush, daemon=True)
        t.start()
        t.join(1.5)  # 頁面卡住沒回應時也不能讓視窗關不掉
        state["flushed"] = True
        # 資料已送出：馬上關伺服器釋放埠號，使用者立刻重開時才不會連到正在結束的舊程式
        server = state.pop("server", None)
        if server:
            try:
                server.shutdown()
                server.server_close()
            except Exception:
                traceback.print_exc()
        window.destroy()
        # WebView2 收尾有時要好幾秒：最多再等 1.5 秒就直接結束（資料都已存好）
        threading.Timer(1.5, lambda: os._exit(0)).start()

    threading.Thread(target=flush_then_close, daemon=True, name="flush-on-close").start()
    return False


def main() -> int:
    app_dir = get_app_dir()
    _setup_output(app_dir)
    port = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_PORT
    try:
        import webview
    except ImportError:
        _close_pyi_splash()
        _message_box("缺少 pywebview 套件。\n請執行 pip install -r requirements-desktop.txt，或改用 run.py／start.bat 以瀏覽器開啟。")
        return 1

    webview.settings["ALLOW_DOWNLOADS"] = True  # 匯出 CSV、資料備份、操作紀錄
    state: dict = {}
    window = webview.create_window(APP_NAME, html=_splash_html("正在啟動…"), width=1440, height=900,
                                   min_size=(960, 640), background_color="#0d1117", text_select=True)
    window.events.shown += _close_pyi_splash
    window.events.closing += lambda: _on_closing(window, state)
    try:
        # private_mode=False＋固定 storage_path：localStorage（視窗位置、偏好）下次開啟還在
        webview.start(_boot, (window, state, port), private_mode=False, storage_path=str(app_dir / "data" / "webview"))
    finally:
        _close_pyi_splash()
        server = state.get("server")
        if server:
            server.shutdown()
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
