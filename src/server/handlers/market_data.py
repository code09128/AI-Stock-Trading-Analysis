"""行情與共用資料：健康檢查、報價、大盤、分時、技術總覽、基本資料、匯率、籌碼、配息、分類、K 線、迷你走勢、ETF 清單"""

from typing import Dict, Any
import time

from src.market import quote_provider
from src.market.etf_reference import ETF_POOL
from src.market import etf_data, chart_data, chip_data, finmind, fx, heatmap, industry_map, market_board, markets, symbol_search
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

    def handle_symbol_search(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """自選股輸入名稱（例如「台積電」）找台股代號。數字開頭的輸入（2330、00878、0700.HK）一定是代號，不查名單；
        英文開頭的（NVDA、AES-KY）可能是美股代號也可能是台股簡稱，照常查，由前端只採用「名稱完全相符」的結果。"""
        q = str(payload.get("query") or "").strip()[:40]
        is_ticker = symbol_search.looks_like_ticker(q)
        if not q or (is_ticker and not q[0].isalpha()):
            return {"query": q, "matches": [], "is_ticker": is_ticker}
        return {"query": q, "matches": symbol_search.search(q), "is_ticker": is_ticker}

    def handle_indices(self) -> Dict[str, Any]:
        return {"indices": chart_data.indices(), "timestamp": time.strftime("%H:%M:%S")}

    def handle_intraday(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        return chart_data.intraday(str(payload.get("symbol", "2330")))

    def handle_five_days(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        return chart_data.five_days(str(payload.get("symbol", "2330")))

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

    def handle_board(self, part: str) -> Dict[str, Any]:
        """大盤籌碼頁：world（國際指數＋台指期）／sectors（產業排行）／flow（三大法人）／tw50。"""
        fn = {"world": market_board.world_indices, "sectors": market_board.sectors,
              "flow": market_board.fund_flow, "tw50": market_board.tw50}[part]
        return {**fn(), "timestamp": time.strftime("%H:%M:%S")}

    def handle_chain_map(self) -> Dict[str, Any]:
        """產業鏈地圖：全部類股的即時漲跌、各類股底下的產業鏈與結構。"""
        return {**industry_map.overview(), "timestamp": time.strftime("%H:%M:%S")}

    def handle_chain_map_us(self) -> Dict[str, Any]:
        """美股產業鏈地圖：11 檔類股 ETF 的即時漲跌、各類股底下的產業鏈與結構。"""
        return {**industry_map.overview("US"), "timestamp": time.strftime("%H:%M:%S")}

    @staticmethod
    def _chain_market(payload: Dict[str, Any]) -> str:
        market = str(payload.get("market") or "TW").upper()
        if market not in industry_map.MARKETS:
            raise ValueError(f"market 只能是 TW 或 US，收到 {market!r}")
        return market

    def handle_chain_detail(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """產業鏈地圖：一條鏈裡每檔個股的即時報價與環節漲跌（payload.market：TW 預設、US）。"""
        return {**industry_map.chain_detail(str(payload.get("id") or ""), self._chain_market(payload)), "timestamp": time.strftime("%H:%M:%S")}

    def handle_chain_history(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """產業鏈地圖：一條鏈最近 N 個交易日的日報酬（回放用）。"""
        days = int(arg_num(payload, "days", 30, "回放天數", integer=True, lo=5, hi=industry_map.HISTORY_MAX_DAYS))
        return industry_map.chain_history(str(payload.get("id") or ""), days, self._chain_market(payload))

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
