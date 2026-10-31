"""
Yahoo 日 K 本機快取 (bar_store.py)
組合風控、回測、Beta 每次開程式都要重新下載好幾檔 5～10 年日 K（每檔約 200 KB），打包版每次啟動都從零開始。
歷史日 K 不會變，所以：
- 每檔存一個檔：data/bar_cache/<Yahoo 代號>.json，存「未還權」開高低收量＋Yahoo 的還權收盤價
- 第一次抓需要的整段（1y／2y／5y／10y）；之後只補抓最近 1 個月（INCREMENT_RANGE），跟本機合併
- 配息、拆股後 Yahoo 會把「之前所有日子」的還權收盤價乘上同一個比例：用重疊的日子算出這個比例，套用到本機舊資料；
  重疊日子的比例對不起來（例如除息日剛好落在重疊期間）或沒有重疊，就整段重抓，不冒險拼接
- 補抓失敗（斷線、Yahoo 擋）時沿用本機資料；本機沒有才拋錯
只有正式啟動的伺服器（run_server／桌面版）會呼叫 enable()；單元測試預設不寫檔。要重抓可直接刪掉 data/bar_cache 資料夾。
"""

from pathlib import Path
from typing import Any, Callable, Dict, List, Optional
import json
import os
import re
import threading
import time

RANGES = ["1y", "2y", "5y", "10y"]
INCREMENT_RANGE = "1mo"
RATIO_TOL = 1e-4  # 重疊日子之間的還權比例差異容許值（相對）
RECENT_SEC = 60  # 這麼久內補抓過就不再補（跟記憶體日 K 快取一樣長；盤中最新價另由即時報價覆蓋）

_DIR: Optional[Path] = None
_LOCKS: Dict[str, threading.Lock] = {}
_LOCKS_GUARD = threading.Lock()


def enable(path: Optional[Path] = None) -> None:
    global _DIR
    if path is None:
        from src.server.config import get_app_dir
        path = get_app_dir() / "data" / "bar_cache"
    _DIR = Path(path)


def disable() -> None:
    global _DIR
    _DIR = None


def enabled() -> bool:
    return _DIR is not None


def _path(symbol: str) -> Path:
    return _DIR / f"{re.sub(r'[^A-Za-z0-9._^=-]', '_', symbol.upper())}.json"


def _lock(path: Path) -> threading.Lock:
    with _LOCKS_GUARD:
        return _LOCKS.setdefault(str(path), threading.Lock())


def _read(path: Path) -> Optional[Dict[str, Any]]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _write(path: Path, obj: Dict[str, Any]) -> None:
    """先寫暫存檔再取代。暫存檔名含行程與執行緒編號：原始碼版和桌面版同時開時（兩個行程、各自的鎖）也不會互相寫壞。
    寫不進去（權限、防毒鎖檔）不影響這次取得的資料，下次再存。"""
    tmp = path.with_name(f"{path.stem}.{os.getpid()}.{threading.get_ident()}.tmp")
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp.write_text(json.dumps(obj, separators=(",", ":")), encoding="utf-8")
        os.replace(tmp, path)
    except OSError as e:
        print(f"[bar_store] 存檔失敗 {path.name}：{e}")
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass


def _rank(range_str: str) -> int:
    return RANGES.index(range_str) if range_str in RANGES else len(RANGES)


def merge(old: List[list], new: List[list]) -> Optional[List[list]]:
    """把補抓的列併進舊資料；舊資料的還權收盤價依重疊日子算出的比例調整。對不起來回 None（要整段重抓）。
    列格式：[日期, 開, 高, 低, 收, 量, 還權收盤或 None]。"""
    if not new:
        return old
    by_date = {r[0]: r for r in old}
    ks = []
    for r in new:
        o = by_date.get(r[0])
        if o and o[6] and r[6] and o[4] > 0 and r[4] > 0:
            ks.append((r[6] / r[4]) / (o[6] / o[4]))
    if not ks or max(ks) / min(ks) - 1 > RATIO_TOL:
        return None
    k = sum(ks) / len(ks)
    first_new = new[0][0]
    kept = [r[:6] + [r[6] * k if r[6] else None] for r in old if r[0] < first_new]
    return kept + [list(r) for r in new]


def get(symbol: str, range_str: str, fetch_raw: Callable[..., Dict[str, Any]]) -> Dict[str, Any]:
    """回傳 {rows, currency}。fetch_raw(symbol, range_str) 回 {rows, currency}（見 data_adapter._load_yahoo_raw）。"""
    path = _path(symbol)
    with _lock(path):
        cached = _read(path)
        if cached and cached.get("rows") and _rank(cached.get("range")) >= _rank(range_str):
            if time.time() - cached.get("fetched_at", 0) < RECENT_SEC:  # 剛補抓過（同一次計算裡別的功能也要這檔）
                return {"rows": cached["rows"], "currency": cached.get("currency")}
            try:
                inc = fetch_raw(symbol, INCREMENT_RANGE)
            except Exception:
                return {"rows": cached["rows"], "currency": cached.get("currency")}  # 斷線：沿用本機
            rows = merge(cached["rows"], inc["rows"])
            if rows is not None:
                _save(path, symbol, cached["range"], rows, inc.get("currency") or cached.get("currency"))
                return {"rows": rows, "currency": inc.get("currency") or cached.get("currency")}
        want = range_str if not cached or _rank(range_str) >= _rank(cached.get("range")) else cached["range"]
        try:
            full = fetch_raw(symbol, want)
        except Exception:
            if cached and cached.get("rows"):
                return {"rows": cached["rows"], "currency": cached.get("currency")}
            raise
        if full["rows"]:
            _save(path, symbol, want, full["rows"], full.get("currency"))
        return full


def _save(path: Path, symbol: str, range_str: str, rows: List[list], currency: Optional[str]) -> None:
    _write(path, {"symbol": symbol, "range": range_str, "currency": currency, "fetched_at": time.time(),
                  "rows": rows})


def daily(kind: str, key: str, loader: Callable[[], Any], max_age: float = 86400) -> Any:
    """變動很慢的資料（ETF 成分股）存本機：data/<kind>/<key>.json，max_age 秒內直接用；過期才重抓，
    抓失敗沿用舊的。loader 回 None（例如個股沒有成分股）也存起來，同樣一天內不重問。沒有 enable() 就每次都呼叫 loader。"""
    if not enabled():
        return loader()
    path = _DIR.parent / kind / f"{re.sub(r'[^A-Za-z0-9._^=-]', '_', key.upper())}.json"
    with _lock(path):
        cached = _read(path)
        # 存的是 None（沒有資料）時只信 1 小時：分不出是「真的沒有」還是「那次剛好抓失敗」
        age_limit = max_age if cached and cached.get("value") is not None else min(max_age, 3600)
        if cached and time.time() - cached.get("fetched_at", 0) < age_limit:
            return cached.get("value")
        try:
            value = loader()
        except Exception:
            if cached:
                return cached.get("value")
            raise
        if value is not None or not cached or cached.get("value") is None:
            _write(path, {"key": key, "fetched_at": time.time(), "value": value})
            return value
        return cached.get("value")  # 這次抓回空的但以前有：可能是暫時失敗，沿用舊的（下次過期再試）


def peek(symbol: str, start: str) -> Optional[List[list]]:
    """不連網：本機資料從 start 以前就有時回傳全部列，否則 None。"""
    path = _path(symbol)
    with _lock(path):
        cached = _read(path)
    rows = (cached or {}).get("rows") or []
    return rows if rows and rows[0][0] <= start else None
