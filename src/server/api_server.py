"""
本機 HTTP 伺服器 (api_server.py)：提供 web/ 靜態網頁與 /api/* 路由。
各功能的實作在 src/server/handlers/，由 src/server/dispatcher.py 組合成 DISPATCHER；這裡只負責：
- 路由表（ROUTES）：網址 → 處理函式
- JSON 回應、錯誤碼（輸入錯誤 400、其他 500）、AI 用量附加、操作紀錄
- 啟動伺服器（run_server）

主要端點：
- GET  /api/health、/api/indices、/api/etf、/api/fetchlog、/api/tests/run、/api/mod3/strategies（回測策略清單）
- POST /api/mod1/analyze（技術分析）、/api/mod2/news（新聞判斷）、/api/mod3/backtest（策略回測）、/api/mod3/optimize（參數熱力圖與滾動前進）、/api/mod3/montecarlo、/api/mod3/signals（今日訊號）、/api/mod3/pine（匯出 Pine v5）、/api/mod3/portfolio（策略組合）、/api/mod3/custom/describe（自訂策略檢查）、
       /api/mod4/risk（組合風控）、/api/mod5/coach（交易檢討）、/api/news/digest、/api/fundamentals、
       /api/quotes、/api/stockinfo、/api/ai/* …（完整清單見 ROUTES）
"""

import json
import os
import sys
import time
import traceback
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Callable, Dict

from src.ai import ai_client
from src.company import fundamentals
from src.market import quote_provider, trade_rules
from src.server import activity_log, alert_engine, autostart, env_settings, user_data
from src.server.config import WEB_DIR, get_app_dir, get_resource_dir, load_env_file, WATCHLIST_NAMES  # noqa: F401
from src.server.dispatcher import DISPATCHER, TradingEngineDispatcher  # noqa: F401
from src.server.handlers.technical import mark_bond_snapshot  # noqa: F401
from src.server.params import arg_num, arg_ticker  # noqa: F401
from src.technical.weekly import to_weekly_bars, weekly_summary  # noqa: F401

D = DISPATCHER

GET_ROUTES: Dict[str, Callable[[], Any]] = {
    "/api/health": D.handle_health,
    "/api/indices": D.handle_indices,
    "/api/etf": D.handle_etf_list,
    "/api/fetchlog": lambda: {"log": quote_provider.get_fetch_log()},
    "/api/env": env_settings.status,
    "/api/userdata": user_data.load,
    "/api/autostart": lambda: {"enabled": autostart.is_autostart_enabled()},
    "/api/tests/run": D.handle_run_tests,
    "/api/mod3/strategies": D.handle_mod3_strategies,
    "/api/mod3/custom/templates": D.handle_mod3_custom_templates,
}

ROUTES: Dict[str, Callable[[Dict[str, Any]], Any]] = {
    # 看盤與共用資料
    "/api/quotes": D.handle_quotes,
    "/api/intraday": D.handle_intraday,
    "/api/overview": D.handle_overview,
    "/api/stockinfo": D.handle_stockinfo,
    "/api/fundamentals": lambda p: fundamentals.analyze(arg_ticker(p, "symbol")),
    "/api/fx": D.handle_fx,
    "/api/chips": D.handle_chips,
    "/api/dividends": D.handle_dividend_calendar,
    "/api/categories": D.handle_categories,
    "/api/candles": D.handle_candles,
    "/api/sparks": D.handle_sparks,
    "/api/heatmap": D.handle_heatmap,
    "/api/trade_rules": lambda p: trade_rules.rules_for(arg_ticker(p, "symbol")),
    # 五個分析功能
    "/api/mod1/analyze": D.handle_mod1_analyze,
    "/api/news": D.handle_news,
    "/api/news/digest": D.handle_news_digest,
    "/api/mod2/news": D.handle_mod2_news,
    "/api/mod3/backtest": D.handle_mod3_backtest,
    "/api/mod3/optimize": D.handle_mod3_optimize,
    "/api/mod3/montecarlo": D.handle_mod3_montecarlo,
    "/api/mod3/signals": D.handle_mod3_signals,
    "/api/mod3/pine": D.handle_mod3_pine,
    "/api/mod3/portfolio": D.handle_mod3_portfolio,
    "/api/mod3/custom/describe": D.handle_mod3_custom_describe,
    "/api/mod4/risk": D.handle_mod4_risk,
    "/api/mod5/coach": D.handle_mod5_coach,
    # AI
    "/api/ai/test": lambda p: D.handle_ai("test", p),
    "/api/ai/models": lambda p: D.handle_ai("models", p),
    "/api/ai/explain": lambda p: D.handle_ai("explain", p),
    "/api/ai/detect": lambda p: D.handle_ai("detect", p),
    # 金鑰與資料額度（寫入 .env）
    "/api/env/save": lambda p: env_settings.save(p.get("values") or {}),
    # 使用者資料（持股、交易紀錄、規則…）存到 data/userdata.json
    "/api/userdata/save": lambda p: user_data.save(p.get("values") or {}),
    # 操作紀錄與自檢
    "/api/log": lambda p: {"written": activity_log.write(
        (p.get("events") if isinstance(p.get("events"), list) else [])[:200], "browser")},
    "/api/log/recent": lambda p: {"events": activity_log.read_recent(
        int(arg_num(p, "limit", 200, "筆數", integer=True, lo=1, hi=2000)), bool(p.get("errors_only")))},
    # 回傳設定後「實際」的狀態（set_autostart 只回報成功與否，取消成功時是 True）
    "/api/autostart": lambda p: {"ok": autostart.set_autostart(bool(p.get("enabled"))),
                                 "enabled": autostart.is_autostart_enabled()},
    "/api/alerts/check_now": lambda p: {"fired": alert_engine.ALERT_ENGINE.check_once()},
    "/api/tests/run": lambda p: D.handle_run_tests(),
}


class TradingAPIRequestHandler(SimpleHTTPRequestHandler):
    """結合靜態資源與 /api/* 路由的 HTTP Handler"""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB_DIR), **kwargs)

    def handle(self) -> None:
        # 頁面關掉、程式結束時連線被中斷（BrokenPipe／Reset／Aborted）：不是錯誤，不印一堆 Traceback
        try:
            super().handle()
        except ConnectionError:
            pass

    def _send_json(self, data: Dict[str, Any], status: int = 200) -> None:
        raw = json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def end_headers(self) -> None:
        # 開發用：靜態檔不快取，改完程式重新整理就會生效（API 路徑已另外設定）
        if not self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_GET(self) -> None:
        path = self.path.split("?")[0]
        handler = GET_ROUTES.get(path)  # 完整比對：前綴比對會讓 /api/env_xxx 之類的路徑誤中
        if handler:
            try:
                self._send_json(handler())
            except ConnectionError:
                return
            except Exception as err:  # 回 JSON 錯誤，不要直接斷線（前端才看得到原因）
                traceback.print_exc()
                self._send_json({"error": str(err)}, status=500)
            return
        self._exact_revalidation()
        super().do_GET()

    def _exact_revalidation(self) -> None:
        """只有快取的修改時間「完全等於」檔案時間才回 304。
        內建判斷是「檔案沒有比快取新」就 304：原始碼版和打包版共用同一個網址與 WebView2 快取時，
        打包版較新的 index.html（引用 app.bundle.js）會被當成原始碼版的，畫面就卡在載入動畫。"""
        ims = self.headers.get("If-Modified-Since")
        if not ims:
            return
        path = self.translate_path(self.path)
        if os.path.isdir(path):  # 「/」實際送的是 index.html
            path = os.path.join(path, "index.html")
        try:
            mtime = os.stat(path).st_mtime
        except OSError:
            return
        if ims != self.date_time_string(int(mtime)):
            del self.headers["If-Modified-Since"]

    # 伺服器端紀錄：輪詢型 API 只記錯誤，其他（分析、AI、風控…）成功也記，方便追蹤
    QUIET_PATHS = ("/api/quotes", "/api/indices", "/api/sparks", "/api/heatmap", "/api/intraday", "/api/overview", "/api/fx",
                   "/api/health", "/api/etf", "/api/fetchlog", "/api/log", "/api/categories", "/api/candles")

    def _log_request(self, status: int, started: float, payload: Any = None, res: Any = None) -> None:
        path = self.path.split("?")[0]
        if status < 400 and (path.startswith(self.QUIET_PATHS) or path == "/api/mod1/analyze"):
            return  # 技術分析每 5 秒自動刷新，成功的不記；失敗一定記
        p = payload if isinstance(payload, dict) else {}
        ev = {"type": "api", "path": path, "status": status, "ms": int((time.time() - started) * 1000),
              "symbol": p.get("ticker") or p.get("symbol") or p.get("target_asset") or p.get("target"),
              "module": p.get("module")}
        if isinstance(res, dict):
            if res.get("error"):
                ev["level"], ev["error"] = "error", str(res["error"])[:300]
            if res.get("ai_usage"):
                ev["ai_tokens"] = [(u.get("model"), u.get("input_tokens"), u.get("output_tokens")) for u in res["ai_usage"]]
        if status >= 400:
            ev["level"] = "error"
        try:
            activity_log.write([{k: v for k, v in ev.items() if v not in (None, "", [])}], "server")
        except Exception:
            pass

    def _with_usage(self, res: Any) -> Any:
        """把這次請求呼叫 AI 的用量附在回應（ai_usage），前端據此記錄與估算費用。"""
        usage = ai_client.collect_usage()
        if usage and isinstance(res, dict):
            res = {**res, "ai_usage": [{**u, "endpoint": self.path} for u in usage]}
        return res

    def do_POST(self) -> None:
        if not self.path.startswith("/api/"):
            self._send_json({"error": f"Unknown endpoint: {self.path}"}, status=404)
            return

        content_len = int(self.headers.get("Content-Length", "0"))
        body_bytes = self.rfile.read(content_len) if content_len > 0 else b"{}"
        try:
            payload = json.loads(body_bytes.decode("utf-8") or "{}")
        except Exception as e:
            self._send_json({"error": f"Invalid JSON payload: {e}"}, status=400)
            return

        # 只接受本機網頁送來的請求：避免其他網站在背景偷偷呼叫本機 API（例如改掉你的金鑰）
        origin = self.headers.get("Origin")
        if origin and not origin.startswith(("http://127.0.0.1:", "http://localhost:", "http://[::1]:")):
            self._send_json({"error": "拒絕來自其他網站的請求"}, status=403)
            return

        ai_client.begin_usage()  # 收集這個請求呼叫 AI 用掉的 tokens
        started = time.time()
        route_path = self.path.split("?")[0]
        if route_path == "/api/ai/explain_stream":
            self.send_response(200)
            self.send_header("Content-Type", "application/x-ndjson; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Accel-Buffering", "no")
            self.end_headers()
            final_res: Dict[str, Any] = {}
            try:
                for ev in D.handle_ai_explain_stream(payload):
                    if ev.get("type") in ("done", "error"):
                        ev = self._with_usage(ev)
                        final_res = ev
                    self.wfile.write((json.dumps(ev, ensure_ascii=False) + "\n").encode("utf-8"))
                    self.wfile.flush()
            except ConnectionError:
                return
            self._log_request(200, started, payload, final_res)
            return

        handler = ROUTES.get(route_path)
        if handler is None:
            self._send_json({"error": f"Route not found: {self.path}"}, status=404)
            self._log_request(404, started, payload, {"error": f"Route not found: {self.path}（伺服器可能是舊版，請重開）"})
            return
        try:
            res = self._with_usage(handler(payload))
            self._send_json(res, status=200)
            self._log_request(200, started, payload, res)
        except ConnectionError:  # 回應送到一半前端已斷線：不要當成 500 錯誤記錄
            return
        except ValueError as err:  # 輸入有誤：回 400 與可直接顯示給使用者的訊息
            self._send_json(self._with_usage({"error": str(err)}), status=400)
            self._log_request(400, started, payload, {"error": str(err)})
        except Exception as err:
            self._send_json(self._with_usage({"error": str(err)}), status=500)
            self._log_request(500, started, payload, {"error": str(err)})


def make_server(port: int = 8088) -> ThreadingHTTPServer:
    """載入 .env 並綁定埠號（綁定失敗會丟 OSError）；呼叫端自己決定在哪個執行緒 serve_forever。"""
    loaded = load_env_file()
    if loaded:
        print(f"已從 .env 載入：{', '.join(loaded)}")  # 只印鍵名，不印值
    server = ThreadingHTTPServer(("127.0.0.1", port), TradingAPIRequestHandler)
    print(f"Trading AI Full-Stack Server listening on http://localhost:{port}")
    return server


def run_server(port: int = 8088) -> None:
    make_server(port).serve_forever()


if __name__ == "__main__":
    target_port = int(sys.argv[1]) if len(sys.argv) > 1 else 8088
    run_server(target_port)
