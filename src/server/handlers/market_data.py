"""行情與共用資料：健康檢查、報價、大盤、分時、技術總覽、基本資料、匯率、籌碼、配息、分類、K 線、迷你走勢、ETF 清單"""

from typing import Dict, Any
import time

from src.market import quote_provider
from src.market.etf_reference import ETF_POOL
from src.market import etf_data, chart_data, chip_data, finmind, fx, heatmap, markets
from src.company import stock_info
from src.server.config import WATCHLIST_NAMES
from src.server.params import arg_num


class MarketDataHandlers:
    """行情與共用資料：健康檢查、報價、大盤、分時、技術總覽、基本資料、匯率、籌碼、配息、分類、K 線、迷你走勢、ETF 清單"""

    def handle_health(self) -> Dict[str, Any]:
        fx = self.adapter.fetch_usd_twd_rate()
        return {
            "status": "OK",
            "modules_ready": [1, 2, 3, 4, 5],
            "fx_usd_twd": fx["usd_twd"],
            "fx_source": fx["source"],
            "fx_warning": fx.get("warning"),
            "finmind": finmind.pause_status(),
        }

    def handle_quotes(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """看盤頁用：真實報價（TWSE MIS / Yahoo）+ 抓取紀錄"""
        symbols = [str(x) for x in payload.get("symbols", [])][:40]
        quotes = quote_provider.get_quotes(symbols, WATCHLIST_NAMES)
        return {
            "quotes": quotes,
            "timestamp": time.strftime("%H:%M:%S"),
            "fetch_log": quote_provider.get_fetch_log()[:12],
        }

    def handle_indices(self) -> Dict[str, Any]:
        return {"indices": chart_data.indices(), "timestamp": time.strftime("%H:%M:%S")}

    def handle_intraday(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        return chart_data.intraday(str(payload.get("symbol", "2330")))

    def handle_overview(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        syms = [str(x) for x in payload.get("symbols", [])][:30]
        return {"rows": chart_data.overview(syms), "timestamp": time.strftime("%H:%M:%S")}

    def handle_stockinfo(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        return stock_info.stock_info(str(payload.get("symbol", "2330")))

    def handle_fx(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """各幣別兌台幣匯率（看盤頁持股損益換算用）。"""
        curs = [str(c) for c in payload.get("currencies", [])][:20]
        return {"rates": fx.rates_to_twd(curs), "markets": markets.market_list()}

    def handle_chips(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        return chip_data.chips(str(payload.get("symbol", "2330")))

    def handle_dividend_calendar(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        return stock_info.dividend_calendar([str(x) for x in payload.get("symbols", [])][:30])

    def handle_categories(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        return {"categories": stock_info.categories([str(x) for x in payload.get("symbols", [])][:40])}

    def handle_candles(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        return chart_data.candles(str(payload.get("symbol", "^TWII")),
                                  int(arg_num(payload, "n", 15, "K 棒數量", integer=True, lo=1, hi=250)))

    def handle_heatmap(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """股市熱力圖：pool＝mine（帶 symbols、holdings）／tw_hot／us_core。"""
        out = heatmap.build(str(payload.get("pool", "mine")), [str(x) for x in payload.get("symbols", [])],
                            payload.get("holdings") if isinstance(payload.get("holdings"), dict) else None)
        out["timestamp"] = time.strftime("%H:%M:%S")
        return out

    def handle_sparks(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        syms = [str(x) for x in payload.get("symbols", [])][:40]
        return {"sparks": chart_data.sparks(syms)}

    def handle_etf_list(self) -> Dict[str, Any]:
        """ETF 精選：規模/殖利率/定期定額戶數皆為真實來源計算；殖利率在背景預熱，pending>0 代表還在算。"""
        quotes = {
            q["symbol"].split(".")[0].upper(): q
            for q in quote_provider.get_quotes(ETF_POOL, WATCHLIST_NAMES)
        }
        etf_data.warm_yields(ETF_POOL)
        rows = etf_data.build_etf_rows(ETF_POOL, quotes)
        return {
            "etfs": rows,
            "pending_yields": sum(1 for r in rows if r["yield_pct"] is None),
            "sources": {
                "name/aum": "TWSE OpenAPI t187ap47_L 發行單位數 × 即時市價（市值估算，非淨值規模）",
                "yield": "Yahoo Finance 近 12 個月實際配息 ÷ 現價（自行計算）",
                "savings_plan": "TWSE OpenAPI ETFRank 定期定額交易戶數（僅前 20 名有值，非總持股人數）",
            },
        }
