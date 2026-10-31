"""
背景工作 (jobs.py)：組合風控、回測、配息這類要跑 10～30 秒的 API，改成「送出 → 每秒查一次結果」。
- 瀏覽器對同一個主機只開 6 條連線：一個請求掛 30 秒就少一條，同時開好幾個慢的分析時其他畫面會排隊
- 同一個路徑＋同樣參數的工作還在跑時直接共用（切頁再回來、連按兩次不會重算一次）
- 結果保留 KEEP_SEC 秒，前端查到結果後就不再需要
只接受 JOB_PATHS 裡的路徑（不能拿來呼叫任意 API）。
"""

from typing import Any, Callable, Dict, Optional
import json
import threading
import time
import uuid

from src.ai import ai_client

JOB_PATHS = {"/api/mod4/risk", "/api/mod5/coach", "/api/mod3/backtest", "/api/mod3/portfolio", "/api/mod3/optimize",
             "/api/savings/dividends", "/api/savings/portfolio", "/api/dividends"}
KEEP_SEC = 600
MAX_WAIT_SEC = 2.0  # 每次查詢最多在伺服器端等幾秒（工作提早完成就提早回）

_LOCK = threading.Lock()
_JOBS: Dict[str, Dict[str, Any]] = {}
_RUNNING: Dict[str, str] = {}  # 路徑＋參數 → 執行中的工作 id


def _cleanup(now: float) -> None:
    for jid in [j for j, job in _JOBS.items() if job["done"].is_set() and now - job["finished"] > KEEP_SEC]:
        del _JOBS[jid]


def start(path: str, payload: Dict[str, Any], handler: Callable[[Dict[str, Any]], Any],
          on_done: Optional[Callable[[int, float, Any], None]] = None) -> str:
    """開始（或共用）一個工作，回傳 id。handler 丟 ValueError＝輸入有誤（400），其他例外＝500。
    on_done(status, started, result) 在工作結束時呼叫（寫伺服器紀錄用）。"""
    if path not in JOB_PATHS:
        raise ValueError(f"{path} 不支援背景工作")
    key = f"{path} {json.dumps(payload, sort_keys=True, ensure_ascii=False)}"
    with _LOCK:
        _cleanup(time.time())
        jid = _RUNNING.get(key)
        if jid:
            return jid
        jid = uuid.uuid4().hex[:12]
        job = {"path": path, "started": time.time(), "finished": 0.0, "done": threading.Event(),
               "status": 0, "result": None}
        _JOBS[jid] = job
        _RUNNING[key] = jid

    def run() -> None:
        ai_client.begin_usage()
        try:
            res, status = handler(payload), 200
        except ValueError as e:
            res, status = {"error": str(e)}, 400
        except Exception as e:
            res, status = {"error": str(e)}, 500
        usage = ai_client.collect_usage()
        if usage and isinstance(res, dict):
            res = {**res, "ai_usage": [{**u, "endpoint": path} for u in usage]}
        with _LOCK:
            job.update(result=res, status=status, finished=time.time())
            _RUNNING.pop(key, None)
        job["done"].set()
        if on_done:
            on_done(status, job["started"], res)

    threading.Thread(target=run, name=f"job-{path}", daemon=True).start()
    return jid


def poll(jid: str, wait: float = 0) -> Dict[str, Any]:
    """{state: running|done, elapsed_sec, status?, result?}；wait＞0 時最多等 MAX_WAIT_SEC 秒看能不能等到結果。"""
    with _LOCK:
        job = _JOBS.get(jid)
    if job is None:
        raise ValueError("找不到這個工作（可能伺服器重開過或結果已過期），請重新執行")
    if wait > 0:
        job["done"].wait(min(float(wait), MAX_WAIT_SEC))
    if not job["done"].is_set():
        return {"state": "running", "elapsed_sec": round(time.time() - job["started"], 1)}
    out = {"state": "done", "elapsed_sec": round(job["finished"] - job["started"], 1), "status": job["status"],
           "result": job["result"]}
    # AI 用量放在最外層讓前端記錄費用（ai_store 攔截 /api/ 回應的 ai_usage）；共用同一個工作的第二個畫面不重複記
    with _LOCK:
        first = not job.get("usage_sent")
        job["usage_sent"] = True
    usage = (job["result"] or {}).get("ai_usage") if isinstance(job["result"], dict) else None
    if first and usage:
        out["ai_usage"] = usage
    return out
