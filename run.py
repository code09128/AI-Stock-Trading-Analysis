"""一鍵啟動：開啟本機伺服器並自動用瀏覽器打開看盤頁。用法：python run.py [埠號]"""

import sys
import threading
import time
import webbrowser

from src.api_server import run_server

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8088
    threading.Thread(
        target=lambda: (time.sleep(1.2), webbrowser.open(f"http://127.0.0.1:{port}/")),
        daemon=True,
    ).start()
    run_server(port)
