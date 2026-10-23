"""
FinMind API 共用呼叫 (finmind.py)
所有 FinMind 請求都經過這裡，避免額度用完或被封鎖後還一直重試：
- 402 = 超過會員等級每小時上限（免費 300 次／小時，註冊 token 600 次）→ 暫停 PAUSE_402_SEC
- 403 = IP 被封鎖（官方說明 30 分鐘自動解除，期間持續送錯誤請求會再被封）→ 暫停 PAUSE_403_SEC
有 FINMIND_TOKEN 時以 Authorization: Bearer 標頭送出（不放網址，避免出現在抓取紀錄）。
暫停期間直接拋 FinMindPaused，不送出任何請求；請求仍記錄在 quote_provider 的抓取紀錄。
"""

from datetime import datetime
from typing import Any, Dict, List, Optional
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


class FinMindPaused(RuntimeError):
    pass


def pause_status() -> Dict[str, Any]:
    with _LOCK:
        until, reason = _PAUSE["until"], _PAUSE["reason"]
    if until <= time.time():
        return {"paused": False}
    return {"paused": True, "reason": reason,
            "resume_at": datetime.fromtimestamp(until).strftime("%H:%M:%S")}


def _pause(code: int, msg: str) -> None:
    sec = PAUSE_402_SEC if code == 402 else PAUSE_403_SEC
    label = "超過每小時請求上限" if code == 402 else "IP 被暫時封鎖"
    with _LOCK:
        _PAUSE["until"] = time.time() + sec
        _PAUSE["reason"] = f"FinMind 回 {code}（{label}：{msg}）"


def reset_pause() -> None:
    with _LOCK:
        _PAUSE.update(until=0.0, reason="")


def get_data(dataset: str, data_id: str, start_date: str, token: Optional[str] = None,
             timeout: int = 20) -> List[Dict[str, Any]]:
    """查詢 /api/v4/data，回傳 data 陣列；暫停中、402/403 或其他錯誤都會拋例外。"""
    from src.market import quote_provider as qp  # 延遲匯入：quote_provider 也會匯入 data_adapter

    status = pause_status()
    if status["paused"]:
        raise FinMindPaused(f"{status['reason']}，暫停到 {status['resume_at']} 前不再請求")
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
