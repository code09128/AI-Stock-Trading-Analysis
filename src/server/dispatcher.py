"""把各功能處理器組合成單一派送器（DISPATCHER），HTTP 層只負責路由。"""

from src.server.handlers.market_data import MarketDataHandlers
from src.server.handlers.technical import TechnicalHandlers
from src.server.handlers.news import NewsHandlers
from src.server.handlers.backtest import BacktestHandlers
from src.server.handlers.portfolio import PortfolioHandlers
from src.server.handlers.journal import JournalHandlers
from src.server.handlers.ai import AIHandlers
from src.server.handlers.selftest import SelfTestHandlers
from src.market.data_adapter import DualMarketDataAdapter


class TradingEngineDispatcher(
    MarketDataHandlers,
    TechnicalHandlers,
    NewsHandlers,
    BacktestHandlers,
    PortfolioHandlers,
    JournalHandlers,
    AIHandlers,
    SelfTestHandlers,
):
    """所有 /api/* 功能的處理器；各功能實作在 src/server/handlers/。"""

    def __init__(self):
        self.adapter = DualMarketDataAdapter()


DISPATCHER = TradingEngineDispatcher()
