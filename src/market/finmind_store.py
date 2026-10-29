"""
FinMind 歷史資料本機快取 (finmind_store.py)
籌碼與月營收策略回測要好幾年的資料，每次都整段重抓會很快用完 FinMind 每小時額度，所以：
- 每檔 × 每個資料集存一個檔：data/finmind_cache/<資料集>/<代號>.json
- 第一次抓整段；之後只補抓「最後一筆往前幾天」到今天（法人／融資補 10 天、月營收補 70 天，蓋掉可能修正過的資料）
- REFRESH_SEC（6 小時）內抓過就直接用本機檔，不送請求
- 抓取失敗（額度用完、斷線）但本機有舊資料時沿用舊資料並標示 stale，沒有才拋錯
過去的資料不會變，所以快取不設過期；要重抓可直接刪掉 data/finmind_cache 資料夾。
"""

from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple
import json
import os
import threading
import time

from src.market import finmind
from src.server.config import get_app_dir

REFRESH_SEC = 6 * 3600
OVERLAP_DAYS = {"TaiwanStockMonthRevenue": 70}  # 其餘資料集補抓 10 天
_LOCKS: Dict[str, threading.Lock] = {}
_LOCKS_GUARD = threading.Lock()


def cache_dir() -> Path:
    return get_app_dir() / "data" / "finmind_cache"


def _key(dataset: str) -> Callable[[Dict[str, Any]], Tuple]:
    """同一筆資料的唯一鍵：法人買賣一天有多種身分（name）、月營收以年月為準、
    股利政策同一天可能公告多個期別（以期別與除權息日區分）。"""
    if dataset == "TaiwanStockInstitutionalInvestorsBuySell":
        return lambda r: (r.get("date"), r.get("name"))
    if dataset == "TaiwanStockMonthRevenue":
        return lambda r: (int(r.get("revenue_year") or 0), int(r.get("revenue_month") or 0))
    if dataset == "TaiwanStockDividend":
        return lambda r: (r.get("date"), r.get("year"), r.get("CashExDividendTradingDate"),
                          r.get("StockExDividendTradingDate"))
    return lambda r: (r.get("date"),)


def _lock(path: Path) -> threading.Lock:
    with _LOCKS_GUARD:
        return _LOCKS.setdefault(str(path), threading.Lock())


def _read(path: Path) -> Optional[Dict[str, Any]]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _write(path: Path, obj: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, path)


def history(dataset: str, code: str, start: str,
            fetch: Optional[Callable[[str, str, str], List[Dict[str, Any]]]] = None) -> Dict[str, Any]:
    """回傳 {"rows": [...]（date >= start，依日期排序）, "source": "cache"|"fetched", "stale": bool, "error": str|None}。"""
    fetch = fetch or finmind.get_data
    path = cache_dir() / dataset / f"{code.upper()}.json"
    key = _key(dataset)
    with _lock(path):
        cached = _read(path)
        now = time.time()
        rows: List[Dict[str, Any]] = cached["rows"] if cached else []
        covers = bool(cached) and cached.get("start", "9999") <= start
        fresh = covers and now - cached.get("fetched_at", 0) < REFRESH_SEC
        source, error, stale = "cache", None, False
        if not fresh:
            if covers and rows:
                last = max(r.get("date", "") for r in rows) or start
                since = (date.fromisoformat(last[:10]) - timedelta(days=OVERLAP_DAYS.get(dataset, 10))).isoformat()
                fetch_from = max(since, start)
            else:
                fetch_from = start
            try:
                new = fetch(dataset, code, fetch_from)
                merged = {key(r): r for r in rows}
                merged.update({key(r): r for r in new})
                rows = sorted(merged.values(), key=lambda r: (r.get("date", ""), str(r.get("name", ""))))
                _write(path, {"dataset": dataset, "code": code.upper(),
                              "start": min(start, cached.get("start", start)) if cached else start,
                              "fetched_at": now, "fetched_at_text": datetime.now().isoformat(timespec="seconds"),
                              "rows": rows})
                source = "fetched"
            except Exception as e:  # 額度用完或斷線：有舊資料就沿用
                if not rows:
                    raise
                error, stale = str(e), True
    return {"rows": [r for r in rows if r.get("date", "") >= start], "source": source, "stale": stale,
            "error": error}
