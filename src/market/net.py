"""
對外連線的同時數量控管 (net.py)
各頁面、各執行緒池（組合風控預熱、情境回放、熱力圖…）可能同時對同一個資料來源發出幾十個請求，
加起來會互相搶頻寬、拖慢彼此，證交所 MIS 還會因此回得更慢。這裡替每個主機設一個上限，
超過的請求在本機排隊，不論從哪個執行緒池發出都一樣。
- 即時（報價、匯率、分時）與大下載（多年日 K、配息、成分股）分開計算：看盤頁的報價不會被組合風控的 10 年下載擋在後面。
- 排隊有時間上限：等太久就直接當作逾時，讓呼叫端走原本的失敗處理（重試、顯示錯誤），不要無限期卡著。
"""

import json
import threading
import time
import urllib.parse
import urllib.request
from collections import deque
from contextlib import contextmanager
from datetime import datetime
from typing import Any, Dict, Optional, Tuple

# 實測：MIS 同時 2 條最快，再多反而變慢；Yahoo 在頻寬有限時 4 條以上也不會更快
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
FETCH_LOG: deque = deque(maxlen=120)  # 每一次對外請求的紀錄（網址、狀態、耗時、位元組），供前端「資料來源透明面板」顯示
LOG_LOCK = threading.Lock()

HOST_LIMITS = {"mis.twse.com.tw": 2}
DEFAULT_HOST_LIMIT = 4
SLOT_WAIT_SEC = 12  # 排隊最久等多久；超過就丟 TimeoutError

_LOCK = threading.Lock()
_SLOTS: Dict[Tuple[str, str], threading.BoundedSemaphore] = {}
_LIVE_RANGES = ("range=1d", "range=5d")  # 日 K 本機快取的補抓（range=1mo）算大下載：不跟報價搶即時連線


def _kind(url: str) -> str:
    """Yahoo 的多年日 K（range=1y 以上）與 quoteSummary 是大下載；其餘（報價、匯率、1d／5d 分時）視為即時。"""
    if "quoteSummary" in url:
        return "bulk"
    if "period1=" in url or ("range=" in url and not any(r in url for r in _LIVE_RANGES)):
        return "bulk"
    return "live"


def _slot(url: str) -> threading.BoundedSemaphore:
    host = (urllib.parse.urlsplit(url).hostname or "").lower()
    key = (host, _kind(url))
    with _LOCK:
        slot = _SLOTS.get(key)
        if slot is None:
            slot = _SLOTS[key] = threading.BoundedSemaphore(HOST_LIMITS.get(host, DEFAULT_HOST_LIMIT))
    return slot


@contextmanager
def host_slot(url: str, wait: float = SLOT_WAIT_SEC):
    """用法：with host_slot(url): 送出請求並讀完回應。只包住網路 I/O，裡面不要再拿其他鎖。"""
    slot = _slot(url)
    if not slot.acquire(timeout=wait):
        host = urllib.parse.urlsplit(url).hostname
        raise TimeoutError(f"{host} 同時連線太多，排隊超過 {wait:g} 秒")
    try:
        yield
    finally:
        slot.release()


def http_bytes(url: str, timeout: float = 8, opener: Any = None,
               headers: Optional[Dict[str, str]] = None, body: Any = None) -> bytes:
    """所有資料來源共用的對外請求：帶 UA、受連線上限控管、寫入 FETCH_LOG；失敗時記錄後再拋出。
    headers 用來放認證（例如 FinMind token），不會寫進紀錄；不要把金鑰放在網址裡。
    body 不是 None 時改用 POST 送出 JSON（期交所行情 API 用）。"""
    started = time.time()
    rec = {"time": datetime.now().strftime("%H:%M:%S"), "url": url, "status": "ERR", "ms": 0, "bytes": 0, "error": None}
    try:
        if body is None:
            req = urllib.request.Request(url, headers={**UA, **(headers or {})})
        else:
            req = urllib.request.Request(url, data=json.dumps(body).encode("utf-8"),
                                         headers={**UA, "Content-Type": "application/json", **(headers or {})})
        opener_open = opener.open if opener else urllib.request.urlopen
        with host_slot(url), opener_open(req, timeout=timeout) as resp:
            raw = resp.read()
            rec["status"] = getattr(resp, "status", 200)
            rec["bytes"] = len(raw)
        return raw
    except Exception as e:
        rec["error"] = str(e)
        raise
    finally:
        rec["ms"] = int((time.time() - started) * 1000)
        with LOG_LOCK:
            FETCH_LOG.appendleft(rec)


def http_json(url: str, timeout: float = 8, opener: Any = None,
              headers: Optional[Dict[str, str]] = None, body: Any = None) -> Any:
    return json.loads(http_bytes(url, timeout, opener, headers, body).decode("utf-8", errors="replace"))
