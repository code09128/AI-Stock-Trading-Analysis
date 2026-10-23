"""一鍵啟動：開啟本機伺服器並自動用瀏覽器打開看盤頁。用法：python run.py [埠號]"""

import os
import sys
import threading
import time
import webbrowser

from src.server.api_server import run_server

if __name__ == "__main__":
    if sys.platform == "win32":
        try:
            os.system("title 股票交易分析系統")
        except Exception:
            pass

    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8088
    url = f"http://127.0.0.1:{port}/"

    print("=" * 60)
    print("  ★ 股票交易分析系統已啟動")
    print(f"  ★ 本機網址: {url}")
    print("  ★ 系統正在為您開啟預設瀏覽器...")
    print("  ★ 提示：請勿關閉此視窗，關閉此視窗將結束看盤服務。")
    print("=" * 60)

    threading.Thread(
        target=lambda: (time.sleep(1.2), webbrowser.open(url)),
        daemon=True,
    ).start()
    run_server(port)
