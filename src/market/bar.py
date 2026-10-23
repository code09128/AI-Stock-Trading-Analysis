"""一根 K 棒（日 K／週 K）的資料結構，行情、技術分析、新聞、回測共用。"""

from dataclasses import dataclass


@dataclass
class Bar:
    timestamp: str
    open: float
    high: float
    low: float
    close: float
    volume: float
