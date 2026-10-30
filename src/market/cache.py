"""
共用的 TTL 快取 (cache.py)
同一個 key 同時有好幾個請求時只讓第一個去抓，其他等它抓完用同一份結果（組合風控會平行預熱後再逐檔讀取）。
loader 失敗時依 on_error 處理：
- "negative"：吞掉錯誤，記一筆「抓不到」（neg_ttl 內不重抓、等到逾時）；有舊資料就沿用舊資料。loader 回傳 None 也視為抓不到
- "cache"：把錯誤記起來（ttl 內再呼叫會直接丟同一個錯誤），不重抓
- "raise"：錯誤直接丟出、不記，下次重新抓
ttl=None 代表永不過期。
"""

import threading
import time
from typing import Any, Callable, Dict, Optional

NEG_TTL = 120  # 抓不到（例如台股債券 ETF 在 Yahoo 沒有成分股）記 2 分鐘：同一次分析裡不重抓；網路恢復後很快再試


class TTLCache:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._data: Dict[Any, Dict[str, Any]] = {}
        self._flight: Dict[Any, threading.Lock] = {}

    # ---- 簡單讀寫 ----
    def get(self, key: Any, ttl: Optional[float], default: Any = None) -> Any:
        with self._lock:
            hit = self._data.get(key)
            if hit and "v" in hit and not hit.get("neg") and (ttl is None or time.time() - hit["t"] < ttl):
                return hit["v"]
        return default

    def peek(self, key: Any, default: Any = None) -> Any:
        """不管有沒有過期，有就回傳（例如只想取用背景預熱好的結果）。"""
        with self._lock:
            hit = self._data.get(key)
            return hit["v"] if hit and "v" in hit and not hit.get("neg") else default

    def put(self, key: Any, value: Any) -> None:
        with self._lock:
            self._data[key] = {"t": time.time(), "v": value}

    def __contains__(self, key: Any) -> bool:
        with self._lock:
            return key in self._data

    def clear(self) -> None:
        with self._lock:
            self._data.clear()

    # ---- 單一飛行 ----
    def _fresh(self, key: Any, ttl: Optional[float], neg: float) -> Optional[Dict[str, Any]]:
        hit = self._data.get(key)  # 呼叫端要持有 self._lock
        if not hit:
            return None
        limit = neg if hit.get("neg") else ttl
        return hit if limit is None or time.time() - hit["t"] < limit else None

    @staticmethod
    def _result(hit: Dict[str, Any]) -> Any:
        if "err" in hit:
            raise hit["err"]
        return hit["v"]

    def get_or_load(self, key: Any, loader: Callable[[], Any], ttl: Optional[float],
                    on_error: str = "negative", neg_ttl: float = NEG_TTL) -> Any:
        neg = neg_ttl if ttl is None else min(neg_ttl, ttl)  # 更新很頻繁的資料失敗後也不能比自己的更新間隔停更久
        with self._lock:
            hit = self._fresh(key, ttl, neg)
            if hit:
                return self._result(hit)
            key_lock = self._flight.setdefault(key, threading.Lock())
        try:
            with key_lock:
                with self._lock:
                    hit = self._fresh(key, ttl, neg)
                    if hit:
                        return self._result(hit)
                    stale = self._data.get(key)
                err: Optional[Exception] = None
                value = None
                try:
                    value = loader()
                except Exception as e:
                    if on_error == "raise":
                        raise
                    err = e
                with self._lock:
                    now = time.time()
                    if err is not None and on_error == "cache":
                        self._data[key] = {"t": now, "err": err}
                    elif on_error == "negative" and (err is not None or value is None):
                        if stale and "v" in stale and not stale.get("neg"):
                            # 失敗時沿用舊資料，並在 neg 秒內不再重抓
                            self._data[key] = {"t": now - (ttl or 0) + neg, "v": stale["v"]}
                            return stale["v"]
                        self._data[key] = {"t": now, "v": None, "neg": True}
                        return None
                    else:
                        self._data[key] = {"t": now, "v": value}
                if err is not None:
                    raise err
                return value
        finally:
            with self._lock:  # 結果已寫進快取，之後的請求直接命中；鎖不用留著（不然每個 key 都會留一把）
                if self._flight.get(key) is key_lock:
                    del self._flight[key]
