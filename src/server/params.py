"""API 參數讀取與檢查：錯誤時拋出可直接顯示給使用者的 ValueError。"""

from typing import Dict, Any

from src.market.data_adapter import DualMarketDataAdapter


def _hold_code(symbol: str) -> str:
    """持股比對用的代號：台股去掉 .TW／.TWO（2330），其他市場保留後綴（0700.HK、7203.T），避免跨市場撞號。"""
    return DualMarketDataAdapter.normalize_symbol(str(symbol))["raw_code"]


def arg_num(payload: Dict[str, Any], key: str, default: float, label: str, integer: bool = False,
            lo: float = None, hi: float = None) -> float:
    """讀取數字參數；不是數字或超出範圍時拋出可直接顯示給使用者的 ValueError（API 回 400）。"""
    raw = payload.get(key, default)
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        raw = default
    try:
        val = float(raw)
    except (TypeError, ValueError):
        raise ValueError(f"「{label}」必須是數字（收到「{raw}」）") from None
    if val != val or val in (float("inf"), float("-inf")):
        raise ValueError(f"「{label}」必須是有效數字")
    if integer:
        val = int(round(val))
    if (lo is not None and val < lo) or (hi is not None and val > hi):
        rng = f"{lo:g}～{hi:g}" if lo is not None and hi is not None else (f"≥ {lo:g}" if lo is not None else f"≤ {hi:g}")
        raise ValueError(f"「{label}」需在 {rng} 之間（收到 {raw}）")
    return val


def arg_ticker(payload: Dict[str, Any], *keys: str, default: str = "2330.TW") -> str:
    """讀取股票代號；有帶欄位但是空白時回白話錯誤，而不是默默改分析 2330。"""
    for k in keys:
        if k in payload:
            t = str(payload.get(k) or "").strip()
            if not t:
                raise ValueError("請輸入股票代號，例如 2330（台股）或 NVDA（美股）")
            return t
    return default

