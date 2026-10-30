"""小工具 (util.py)：各資料來源共用的轉換函式。"""

from typing import Any, Optional


def to_num(v: Any) -> Optional[float]:
    """字串或數字轉 float；去掉千分位逗號，空字串、'-'、NaN 等無法轉換的回 None。"""
    try:
        f = float(str(v).replace(",", ""))
        return f if f == f else None
    except (TypeError, ValueError):
        return None
