"""
背景提醒檢查引擎 (alert_engine.py)
負責在背景週期性檢查使用者在 data/userdata.json 設置的價格、漲跌幅、RSI 提醒。
當符合條件時：
1. 更新提醒狀態為已觸發 (active=False, firedAt=..., firedValue=...)
2. 同步寫回 data/userdata.json
3. 調用 notifier 發送 Windows 桌面原生 Toast 通知
"""

from datetime import datetime
import json
import threading
import time
from typing import Any, Dict, List, Optional

from src.market import quote_provider
from src.market.data_adapter import DualMarketDataAdapter
from src.server import notifier, user_data
from src.server.config import WATCHLIST_NAMES

ALERT_LABELS = {
    "price_above": ("價格 ≥", ""),
    "price_below": ("價格 ≤", ""),
    "chg_above": ("今日漲幅 ≥", "%"),
    "chg_below": ("今日跌幅 ≥", "%"),
    "rsi_above": ("RSI(14) ≥", ""),
    "rsi_below": ("RSI(14) ≤", ""),
}


def evaluate_alert(alert: Dict[str, Any], metrics: Dict[str, Any]) -> bool:
    """判斷單一提醒是否觸發。metrics 包含 price, chg, rsi。"""
    t = alert.get("type")
    val = alert.get("value")
    if val is None:
        return False
    try:
        val = float(val)
    except (TypeError, ValueError):
        return False

    price = metrics.get("price")
    chg = metrics.get("chg")
    rsi = metrics.get("rsi")

    if t == "price_above":
        return price is not None and price >= val
    elif t == "price_below":
        return price is not None and price <= val
    elif t == "chg_above":
        return chg is not None and chg >= abs(val)
    elif t == "chg_below":
        return chg is not None and chg <= -abs(val)
    elif t == "rsi_above":
        return rsi is not None and rsi >= val
    elif t == "rsi_below":
        return rsi is not None and rsi <= val
    return False


def format_alert_message(alert: Dict[str, Any]) -> str:
    sym = alert.get("symbol", "")
    t = alert.get("type", "")
    val = alert.get("value", "")
    label, unit = ALERT_LABELS.get(t, (t, ""))
    shown_val = abs(float(val)) if unit == "%" else val
    return f"{sym} 觸發：{label} {shown_val}{unit}"


class AlertEngine:
    def __init__(self, interval_quote: float = 15.0, interval_rsi: float = 300.0):
        self.interval_quote = interval_quote
        self.interval_rsi = interval_rsi
        self.paused = False
        self.window_visible = False  # 桌面版視窗開著時由頁面檢查，這裡只在縮到系統匣時檢查
        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._last_rsi_check = 0.0
        self._rsi_cache: Dict[str, float] = {}
        self._lock = threading.Lock()
        self._check_lock = threading.Lock()

    def load_alerts(self) -> List[Dict[str, Any]]:
        raw = user_data.load().get("values", {}).get("tw_us_alerts_v1", "[]")
        try:
            parsed = json.loads(raw)
            return parsed if isinstance(parsed, list) else []
        except Exception:
            return []

    def mark_fired(self, fired: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """把觸發的提醒合併進最新的清單；回傳實際標記到的（已被刪除或關閉的就不通知）。"""
        by_id = {f.get("id"): f for f in fired}
        marked: List[Dict[str, Any]] = []

        def merge(raw: Optional[str]) -> Optional[str]:
            marked.clear()
            try:
                latest = json.loads(raw or "[]")
            except ValueError:
                return None
            if not isinstance(latest, list):
                return None
            out = []
            for a in latest:
                f = by_id.get(a.get("id")) if isinstance(a, dict) else None
                if f and a.get("active"):
                    a = {**a, "active": False, "firedAt": f["firedAt"], "firedValue": f["firedValue"]}
                    marked.append(a)
                out.append(a)
            return json.dumps(out, ensure_ascii=False) if marked else None

        user_data.update("tw_us_alerts_v1", merge)
        return marked

    def check_once(self) -> List[Dict[str, Any]]:
        """執行一輪檢查，回傳觸發的提醒清單。背景迴圈與「立即檢查」不能同時跑，否則同一則會通知兩次。"""
        if self.paused:
            return []
        with self._check_lock:
            return self._check()

    def _check(self) -> List[Dict[str, Any]]:

        alerts = self.load_alerts()
        active = [a for a in alerts if a.get("active")]
        if not active:
            return []

        syms = list({a["symbol"] for a in active if a.get("symbol")})
        # 1. 抓取即時報價
        quotes: Dict[str, Dict[str, Any]] = {}
        try:
            for q in quote_provider.get_quotes(syms, WATCHLIST_NAMES):
                if q and q.get("is_live"):
                    # 統一以去除後綴的大寫代號比對
                    code = DualMarketDataAdapter.normalize_symbol(q["symbol"])["raw_code"].upper()
                    quotes[code] = q
                    quotes[q["symbol"].upper()] = q
        except Exception:
            pass

        # 2. 抓取 RSI（每 5 分鐘或無快取時重算）
        now = time.time()
        rsi_syms = list({a["symbol"] for a in active if a.get("type", "").startswith("rsi")})
        if rsi_syms and (now - self._last_rsi_check >= self.interval_rsi or not self._rsi_cache):
            adapter = DualMarketDataAdapter()
            for s in rsi_syms:
                try:
                    q = quotes.get(s.upper())
                    snap = adapter.build_technical_snapshot(s, quote=q)
                    rsi_val = snap.get("indicators", {}).get("RSI14")
                    if rsi_val is not None:
                        code = DualMarketDataAdapter.normalize_symbol(s)["raw_code"].upper()
                        self._rsi_cache[code] = float(rsi_val)
                        self._rsi_cache[s.upper()] = float(rsi_val)
                except Exception:
                    pass
            self._last_rsi_check = now

        # 3. 逐一比對
        fired: List[Dict[str, Any]] = []
        has_changed = False

        for a in alerts:
            if not a.get("active"):
                continue

            sym = a.get("symbol", "")
            code = DualMarketDataAdapter.normalize_symbol(sym)["raw_code"].upper()
            q = quotes.get(code) or quotes.get(sym.upper())
            rsi = self._rsi_cache.get(code) or self._rsi_cache.get(sym.upper())

            metrics = {
                "price": q.get("price") if q else None,
                "chg": q.get("change_pct") if q else None,
                "rsi": rsi,
            }

            if evaluate_alert(a, metrics):
                fired_item = dict(a)
                fired_item["active"] = False
                fired_item["firedAt"] = datetime.now().strftime("%Y/%m/%d %H:%M:%S")
                fired_item["firedValue"] = metrics
                fired.append(fired_item)
                has_changed = True

        # 4. 若有觸發，寫回 userdata 並送出通知。檢查要花幾秒（抓報價、算 RSI），期間使用者可能新增或刪除提醒：
        #    不能把開頭讀到的整份蓋回去，改成在存檔鎖裡讀最新的清單，只把這輪觸發的（依 id、仍啟用中）標成已觸發
        if has_changed:
            fired = self.mark_fired(fired)
            for f in fired:
                msg = format_alert_message(f)
                notifier.send_notification("股票交易分析系統 - 提醒觸發", msg)

        return fired

    def _loop(self):
        while self._running:
            try:
                if not self.window_visible:
                    self.check_once()
            except Exception as e:
                print(f"提醒檢查發生錯誤：{e}")
            # 分割 sleep，確保 stop 時能立即退出
            for _ in range(int(self.interval_quote * 2)):
                if not self._running:
                    break
                time.sleep(0.5)

    def start(self):
        with self._lock:
            if self._running:
                return
            self._running = True
            self._thread = threading.Thread(target=self._loop, daemon=True, name="AlertEngineLoop")
            self._thread.start()

    def stop(self):
        with self._lock:
            self._running = False
        if self._thread and self._thread.is_alive():
            self._thread.join(2.0)

    def set_paused(self, paused: bool):
        self.paused = paused

    def set_window_visible(self, visible: bool):
        self.window_visible = visible


ALERT_ENGINE = AlertEngine()
