"""組合風控（/api/mod4/risk）"""

from typing import Dict, Any
from concurrent.futures import ThreadPoolExecutor

from src.market.data_adapter import DualMarketDataAdapter
from src.portfolio import portfolio_scenarios
from src.portfolio.portfolio_risk import PortfolioRiskManager
from src.market import quote_provider
from src.market import etf_data, fx
from src.portfolio import stress
from src.server.config import WATCHLIST_NAMES
from src.server.params import arg_num, _hold_code


class PortfolioHandlers:
    """組合風控（/api/mod4/risk）"""

    def handle_mod4_risk(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        fx_info = self.adapter.fetch_usd_twd_rate()
        usd_twd = arg_num(payload, "usd_twd_rate", fx_info["usd_twd"], "美元匯率", lo=1, hi=1000)

        holdings = payload.get(
            "holdings",
            [
                {"symbol": "2330", "market": "TW", "shares": 1000, "price": 1050.0},
                {"symbol": "0050", "market": "TW", "shares": 2000, "price": 190.0},
                {"symbol": "NVDA", "market": "US", "shares": 100, "price": 138.6},
            ],
        )
        # 只計算有代號且股數為正的持股；全部無效時回 400 與白話訊息（避免後面除以 0 或缺欄位而崩潰）
        def _num(v: Any) -> float:
            try:
                return float(v)
            except (TypeError, ValueError):
                return 0.0

        holdings = [
            {**h, "symbol": str(h.get("symbol", "")).strip(), "shares": _num(h.get("shares")),
             "price": _num(h.get("price"))}
            for h in (holdings or []) if isinstance(h, dict)
        ]
        holdings = [h for h in holdings if h["symbol"] and h["shares"] > 0]
        if not holdings:
            raise ValueError("目前沒有可計算的持股：請至少輸入一檔代號，且股數大於 0")

        # 即時價格：use_live_prices（預設 True）時以真實報價覆蓋每檔持股價格；查不到才沿用你填的價格並標示
        price_notes: Dict[str, str] = {}
        live_q: Dict[str, Dict[str, Any]] = {}
        if payload.get("use_live_prices", True):
            syms = [str(h.get("symbol", "")) for h in holdings]
            for q in quote_provider.get_quotes(syms, WATCHLIST_NAMES):
                if q:
                    live_q[_hold_code(q["symbol"])] = q
            holdings = [dict(h) for h in holdings]
            for h in holdings:
                code = _hold_code(h["symbol"])
                q = live_q.get(code)
                if q and q.get("is_live"):
                    h["price"] = q["price"]
                    h["currency"] = q.get("currency")
                    if q.get("name") and q["name"] != code:
                        h["name"] = q["name"]  # 給 AI 解讀用：避免模型把 0050 猜成台積電
                    price_notes[code] = f"即時價 {q['price']} {q.get('currency', '')}（{q['source']}，{q.get('quote_time', '')}）"
                else:
                    price_notes[code] = "查無即時價，沿用輸入價格"

        # 市場一律依代號判斷（使用者選的 TW／US 只當參考）；幣別：即時報價回傳的優先，否則用市場預設
        for h in holdings:
            n = DualMarketDataAdapter.normalize_symbol(h["symbol"])
            h["market"] = n["market"]
            h["currency"] = h.get("currency") or n["currency"]
        fx_rates = fx.rates_to_twd(h["currency"] for h in holdings)
        if "usd_twd_rate" in payload and "USD" in fx_rates:  # 使用者手動指定美元匯率
            fx_rates["USD"] = {**fx_rates["USD"], "rate": usd_twd, "source": "使用者輸入", "warning": None}
        missing_fx = [c for c, r in fx_rates.items() if not r.get("rate")]
        if missing_fx:
            raise ValueError("無法取得 " + "、".join(missing_fx) + " 兌台幣匯率，暫時無法換算這些持股的台幣價值，請稍後再試")
        for h in holdings:
            h["fx_rate"] = fx_rates[h["currency"]]["rate"]

        # 預先平行抓取各持股的 Beta / 歷史日 K / 前十大成分股（結果會快取，下面再呼叫時是即時的）
        def _warm(fn):
            try:
                fn()
            except Exception:
                pass

        warm_tasks = []
        for h in holdings:
            code = _hold_code(h["symbol"])
            warm_tasks.append(lambda c=code: etf_data.calc_beta(c))
            warm_tasks.append(lambda c=code: stress._closes(c))
            if (h["market"] == "TW" and code.startswith("00")) or (live_q.get(code) or {}).get("instrument_type") == "ETF":
                warm_tasks.append(lambda c=code: etf_data.top_holdings(c))
        with ThreadPoolExecutor(max_workers=8) as pool:
            list(pool.map(_warm, warm_tasks))

        # 真實 ETF 前十大成分股（Yahoo topHoldings）；抓不到才回退到程式內的概略表並標示
        etf_holdings: Dict[str, Dict[str, float]] = {}
        lookthrough_sources: Dict[str, str] = {}
        for h in holdings:
            code = _hold_code(h["symbol"])
            is_etf = (
                code in etf_data.fund_registry()  # 台股 ETF（TWSE 基金清單）
                or (h["market"] == "TW" and code.startswith("00"))
                or (live_q.get(code) or {}).get("instrument_type") == "ETF"  # 美股 ETF
                or code in ("QQQ", "SPY", "VOO", "VTI")
            )
            th = etf_data.top_holdings(code) if is_etf else None
            if th:
                etf_holdings[code] = {i["symbol"]: i["pct"] / 100 for i in th["holdings"]}
                lookthrough_sources[code] = f"{th['source']}，前十大合計 {th['covered_pct']}%"
            elif code in PortfolioRiskManager.ETF_HOLDINGS_LOOKTHROUGH:
                lookthrough_sources[code] = "STATIC_FALLBACK 程式內概略值（即時來源抓取失敗，不可當真）"
        risk_mgr = PortfolioRiskManager(usd_twd_rate=usd_twd, etf_holdings=etf_holdings or None)
        weights_res = risk_mgr.calculate_portfolio_weights(holdings)
        lookthrough = risk_mgr.calculate_lookthrough_exposure(weights_res)

        # Beta：使用者有填就用填的，留空則用近 1 年真實日報酬自動計算
        beta_detail = []
        raw_beta = payload.get("portfolio_beta")
        if raw_beta in (None, "", 0):
            tot = sum(h["weight_pct"] for h in weights_res["holdings"]) or 1.0
            acc, covered = 0.0, 0.0
            for h in weights_res["holdings"]:
                b = etf_data.calc_beta(h["symbol"])
                beta_detail.append({"symbol": h["symbol"], "beta": b["beta"] if b else None,
                                    "benchmark": b["benchmark"] if b else None})
                if b:
                    acc += h["weight_pct"] * b["beta"]
                    covered += h["weight_pct"]
            portfolio_beta = round(acc / covered, 2) if covered else 1.0
            beta_source = (
                f"近 1 年日報酬 vs 大盤自動計算（涵蓋持股 {round(covered / tot * 100, 1)}%）"
                if covered else "無法計算，暫用 1.0"
            )
            if len({h["market"] for h in holdings}) > 1:
                beta_source += "；不同市場各自對自己的大盤計算，混合市場時「大盤 -20%」等於假設各市場同時跌 20%，僅供粗估"
        else:
            portfolio_beta = arg_num(payload, "portfolio_beta", 1.0, "Beta（留空＝自動計算）", lo=-5, hi=5)
            beta_source = "使用者手動輸入"

        target_weights = payload.get(
            "target_weights",
            {"2330": 35.0, "0050": 25.0, "NVDA": 20.0, "CASH": 20.0},
        )
        try:
            rebalance = risk_mgr.generate_rebalance_plan(weights_res["holdings"], target_weights)
        except ValueError as err:
            total_target = round(sum(float(v) for v in target_weights.values()), 2)
            rebalance = {
                "weight_conservation_passed": False,
                "target_weight_sum_pct": total_target,
                "error": str(err),
                "rebalance_table": [],
            }
        try:
            historical = stress.historical_stress(weights_res["holdings"], usd_twd)
        except Exception as e:
            historical = {"available": False, "reason": f"歷史回落計算失敗：{e}"}
        try:
            scen = portfolio_scenarios.build(weights_res["holdings"], weights_res["total_value_twd"], portfolio_beta)
        except Exception as e:
            scen = {"error": f"多情境壓力測試失敗：{e}"}
        crash_sim = risk_mgr.simulate_crash_20pct(
            total_value_twd=weights_res["total_value_twd"],
            portfolio_beta=portfolio_beta,
        )

        return {
            "module": 4,
            "usd_twd_rate": usd_twd,
            "fx_rates": fx_rates,
            "fx_source": fx_info["source"] if "usd_twd_rate" not in payload else "使用者輸入",
            "fx_warning": "；".join(r["warning"] for r in fx_rates.values() if r.get("warning")) or None,
            "portfolio_valuation": weights_res,
            "lookthrough_exposure_pct": lookthrough,
            "lookthrough_sources": lookthrough_sources,
            "price_sources": price_notes,
            "historical_replay": historical,
            "portfolio_beta_used": portfolio_beta,
            "portfolio_beta_source": beta_source,
            "beta_detail": beta_detail,
            "rebalance_verification": rebalance,
            "crash_20pct_stress_test": crash_sim,
            "scenario_stress": scen,
        }
