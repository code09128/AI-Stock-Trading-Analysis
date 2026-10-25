"""
FinMind API 共用呼叫 (finmind.py)
所有 FinMind 請求都經過這裡，避免額度用完或被封鎖後還一直重試：
- 402 = 超過會員等級每小時上限（免費 300 次／小時，註冊 token 600 次）→ 暫停 PAUSE_402_SEC
- 403 = IP 被封鎖（官方說明 30 分鐘自動解除，期間持續送錯誤請求會再被封）→ 暫停 PAUSE_403_SEC
有 FINMIND_TOKEN 時以 Authorization: Bearer 標頭送出（不放網址，避免出現在抓取紀錄）。
暫停期間直接拋 FinMindPaused，不送出任何請求；請求仍記錄在 quote_provider 的抓取紀錄。
自我節流：記錄近 1 小時實際送出的請求數，到上限的 80%（不填 token 240 次、有 token 480 次，
可用 FINMIND_HOURLY_BUDGET 改）就先停，等最早那次滿 1 小時再放行；留下的 20% 給其他功能與手動操作，
避免真的打到 402 被暫停 30 分鐘。各功能本身也都有快取，同一檔同一份資料不會重複抓。
"""

from collections import deque
from datetime import datetime
from typing import Any, Deque, Dict, List, Optional
import os
import threading
import time
import urllib.error
import urllib.parse

URL = "https://api.finmindtrade.com/api/v4/data"
PAUSE_402_SEC = 30 * 60
PAUSE_403_SEC = 31 * 60
_LOCK = threading.Lock()
_PAUSE: Dict[str, Any] = {"until": 0.0, "reason": ""}
_SENT: Deque[float] = deque()  # 近 1 小時送出請求的時間
WINDOW_SEC = 3600
BUDGET_RATIO = 0.8


class FinMindPaused(RuntimeError):
    pass


def _has_token() -> bool:
    return bool((os.environ.get("FINMIND_TOKEN") or "").strip())


def hourly_budget() -> Dict[str, int]:
    """官方每小時上限與本程式自己用到的上限。"""
    limit = 600 if _has_token() else 300
    try:
        budget = int(os.environ.get("FINMIND_HOURLY_BUDGET") or 0)
    except ValueError:
        budget = 0
    if not 0 < budget <= limit:
        budget = int(limit * BUDGET_RATIO)
    return {"limit": limit, "budget": budget}


def _prune(now: float) -> None:
    while _SENT and now - _SENT[0] >= WINDOW_SEC:
        _SENT.popleft()


def usage() -> Dict[str, Any]:
    now = time.time()
    with _LOCK:
        _prune(now)
        used = len(_SENT)
        oldest = _SENT[0] if _SENT else None
    b = hourly_budget()
    out: Dict[str, Any] = {"used_last_hour": used, **b}
    if used >= b["budget"] and oldest:
        out["throttled_until"] = datetime.fromtimestamp(oldest + WINDOW_SEC).strftime("%H:%M:%S")
    return out


def _take_slot() -> None:
    """要送出請求前呼叫：超過自我上限就拋 FinMindPaused，不送出。"""
    now = time.time()
    b = hourly_budget()
    with _LOCK:
        _prune(now)
        if len(_SENT) >= b["budget"]:
            resume = datetime.fromtimestamp(_SENT[0] + WINDOW_SEC).strftime("%H:%M:%S")
            raise FinMindPaused(
                f"FinMind 近 1 小時已用 {len(_SENT)} 次，達本程式自設上限 {b['budget']} 次"
                f"（官方 {b['limit']} 次，保留餘量避免被暫停），{resume} 後恢復"
            )
        _SENT.append(now)


def pause_status() -> Dict[str, Any]:
    with _LOCK:
        until, reason = _PAUSE["until"], _PAUSE["reason"]
    u = usage()
    if until <= time.time():
        return {"paused": False, "usage": u}
    return {"paused": True, "reason": reason,
            "resume_at": datetime.fromtimestamp(until).strftime("%H:%M:%S"), "usage": u}


def _pause(code: int, msg: str) -> None:
    sec = PAUSE_402_SEC if code == 402 else PAUSE_403_SEC
    label = "超過每小時請求上限" if code == 402 else "IP 被暫時封鎖"
    with _LOCK:
        _PAUSE["until"] = time.time() + sec
        _PAUSE["reason"] = f"FinMind 回 {code}（{label}：{msg}）"


def reset_pause() -> None:
    with _LOCK:
        _PAUSE.update(until=0.0, reason="")
        _SENT.clear()


def get_data(dataset: str, data_id: str, start_date: str, token: Optional[str] = None,
             timeout: int = 20) -> List[Dict[str, Any]]:
    """查詢 /api/v4/data，回傳 data 陣列；暫停中、402/403 或其他錯誤都會拋例外。"""
    from src.market import quote_provider as qp  # 延遲匯入：quote_provider 也會匯入 data_adapter

    status = pause_status()
    if status["paused"]:
        raise FinMindPaused(f"{status['reason']}，暫停到 {status['resume_at']} 前不再請求")
    _take_slot()
    params = {"dataset": dataset, "data_id": data_id, "start_date": start_date}
    # token 放 Authorization 標頭而不是網址參數，才不會出現在前端的抓取紀錄裡
    tok = (token or os.environ.get("FINMIND_TOKEN") or "").strip()
    if tok.lower().startswith("bearer "):
        tok = tok[7:].strip()
    headers = {"Authorization": f"Bearer {tok}"} if tok else None
    try:
        payload = qp._http_json(f"{URL}?{urllib.parse.urlencode(params)}", timeout=timeout, headers=headers)
    except urllib.error.HTTPError as e:
        if e.code in (402, 403):
            _pause(e.code, str(e.reason))
        raise
    code = payload.get("status")
    if code in (402, 403):  # 有些情況錯誤碼放在 JSON 內容裡
        _pause(code, str(payload.get("msg", "")))
        raise RuntimeError(f"FinMind {code}: {payload.get('msg')}")
    if code != 200:
        raise RuntimeError(payload.get("msg") or "FinMind 回應異常")
    return payload.get("data") or []
