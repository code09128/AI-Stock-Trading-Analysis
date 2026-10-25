"""
匯出 TradingView Pine Script v5 (pine_export.py)
把「策略＋參數＋部位＋停損停利＋大盤濾網＋摩擦成本」轉成可直接貼到 TradingView 的 Pine v5 策略。
成交規則與本系統相同：訊號在收盤確認、下一根開盤成交（process_orders_on_close=false）；
停損／移動停利用 strategy.exit 的 stop 價（盤中觸價，跳空以開盤價成交）。
Pine 做不到、或資料不同的地方，都列在 notes 讓使用者知道結果為什麼會和本系統不同。
"""

from typing import Any, Dict, List

from src.backtest import strategies
from src.market import markets
from src.market.market_rules import tw_sell_tax_rate

# TradingView 上對應的大盤代號（大盤濾網用）
TV_INDEX = {
    "TW": "TWSE:TAIEX", "US": "SP:SPX", "HK": "HSI:HSI", "JP": "TVC:NI225", "KR": "KRX:KOSPI",
    "CN": "SSE:000001", "UK": "TVC:UKX", "DE": "XETR:DAX", "CA": "TSX:TSX", "AU": "ASX:XJO", "SG": "TVC:STI",
}
# TradingView 的交易所前綴
TV_PREFIX = {
    ".TW": "TWSE", ".TWO": "TPEX", ".HK": "HKEX", ".T": "TSE", ".KS": "KRX", ".KQ": "KRX", ".SS": "SSE",
    ".SZ": "SZSE", ".L": "LSE", ".DE": "XETR", ".F": "FWB", ".TO": "TSX", ".V": "TSXV", ".AX": "ASX", ".SI": "SGX",
}

SIGNALS = {
    "ma_cross": """fast = ta.sma(close, fast_ma)
slow = ta.sma(close, slow_ma)
buySig = ta.crossover(fast, slow)
sellSig = fast < slow
plot(fast, "短均線", color.orange)
plot(slow, "長均線", color.blue)""",
    "kd_cross": """// 台灣常用 KD：K＝⅔K前＋⅓RSV、D＝⅔D前＋⅓K，起始 50（和 TradingView 內建 Stoch 不同）
lo = ta.lowest(low, kd_n)
hi = ta.highest(high, kd_n)
rsv = hi == lo ? 50.0 : (close - lo) / (hi - lo) * 100
var float k = 50.0
var float d = 50.0
k := k * 2 / 3 + rsv / 3
d := d * 2 / 3 + k / 3
buySig = ta.crossover(k, d) and k[1] < buy_below and bar_index >= kd_n - 1
sellSig = ta.crossunder(k, d)""",
    "ma_align": """s = ta.sma(close, short_ma)
m = ta.sma(close, mid_ma)
l = ta.sma(close, long_ma)
aligned = s > m and m > l and close > s
buySig = aligned and not aligned[1]
sellSig = close < m
plot(s, "短均線", color.orange)
plot(m, "中均線", color.blue)
plot(l, "長均線", color.purple)""",
    "volume_breakout": """volMa = ta.sma(volume, lookback)
exitMa = ta.sma(close, exit_ma)
buySig = close > ta.highest(close, lookback)[1] and volume > volMa[1] * vol_mult
sellSig = close < exitMa
plot(exitMa, "出場均線", color.blue)""",
    "bias_revert": """basis = ta.sma(close, ma)
bias = (close - basis) / basis * 100
buySig = bias <= -math.abs(entry_bias)
sellSig = bias >= exit_bias
plot(basis, "均線", color.blue)""",
    "gap_up": """volMa = ta.sma(volume, 20)
var float gapFloor = na
gapNow = low > high[1] * (1 + min_gap_pct / 100) and volume > volMa[1]
buySig = gapNow and strategy.position_size == 0
if buySig
    gapFloor := high[1]
sellSig = not na(gapFloor) and close < gapFloor""",
}


def tv_symbol(symbol: str) -> str:
    """Yahoo 代號 → TradingView 代號（2330.TW → TWSE:2330、8069.TWO → TPEX:8069）。沒寫後綴的台股當上市。"""
    from src.market.data_adapter import DualMarketDataAdapter  # 延遲匯入，避免載入就抓網路設定
    code, sfx = markets.split_suffix(DualMarketDataAdapter.normalize_symbol(symbol)["symbol"])
    return f"{TV_PREFIX[sfx]}:{code}" if sfx in TV_PREFIX else code


def _num(v: Any) -> str:
    return str(int(v)) if float(v).is_integer() else f"{float(v):g}"


def commission_per_side(market: str, symbol: str, discount: float) -> Dict[str, Any]:
    """Pine 只能設一個手續費率、買賣都收：台股把「只在賣出收的證交稅」平均攤到兩邊。"""
    if market == "TW":
        fee = 0.1425 * discount
        tax = tw_sell_tax_rate(symbol) * 100
        return {"pct": round(fee + tax / 2, 5), "fee_pct": round(fee, 5), "tax_pct": tax,
                "text": f"手續費 0.1425% × {discount:g} 折 = {fee:.4f}%，賣出證交稅 {tax:g}% 攤到買賣各 {tax / 2:g}%"}
    if market == "US":
        text = "美股多數券商免佣金，設為 0；本系統另計的 SEC／FINRA 賣出規費金額很小，Pine 沒有設定"
    else:
        text = "未設定佣金（本系統也只算法定稅費，例如港股印花稅）；請依你的券商在 TradingView 策略屬性裡調整"
    return {"pct": 0.0, "fee_pct": 0.0, "tax_pct": 0.0, "text": text}


def build(symbol: str, market: str, strategy: str, params: Dict[str, Any], initial_capital: float,
          commission_discount: float, risk: Dict[str, Any]) -> Dict[str, Any]:
    meta = strategies.STRATEGIES[strategy]
    defs = {d["key"]: d for d in meta["params"]}
    com = commission_per_side(market, symbol, commission_discount)
    mode, value = risk.get("sizing_mode", "percent"), float(risk.get("sizing_value", 100))
    notes: List[str] = []

    if mode == "fixed":
        qty_decl = f"default_qty_type=strategy.cash, default_qty_value={_num(value)}"
    elif mode == "atr_risk":
        qty_decl = "default_qty_type=strategy.fixed, default_qty_value=1"
    else:
        qty_decl = f"default_qty_type=strategy.percent_of_equity, default_qty_value={_num(min(value, 100))}"

    inputs = []
    for k, v in params.items():
        d = defs[k]
        kind = "input.int" if d["integer"] else "input.float"
        inputs.append(f'{k} = {kind}({_num(v)}, "{d["label"]}", minval={_num(d["lo"])}, maxval={_num(d["hi"])})')
    sl, tr = float(risk.get("stop_loss_pct") or 0), float(risk.get("trailing_pct") or 0)
    inputs.append(f'stopLossPct = input.float({_num(sl)}, "單筆最大虧損 %（0＝不用）", minval=0)')
    inputs.append(f'trailPct = input.float({_num(tr)}, "移動停利回落 %（0＝不用）", minval=0)')
    use_filter = bool(risk.get("market_filter"))
    idx = TV_INDEX.get(market, "SP:SPX")
    inputs.append(f'useFilter = input.bool({"true" if use_filter else "false"}, "大盤濾網")')
    inputs.append(f'filterIndex = input.symbol("{idx}", "大盤代號")')
    inputs.append(f'filterMa = input.int({int(risk.get("filter_ma") or 60)}, "大盤均線天數", minval=5)')
    if mode == "atr_risk":
        inputs.append(f'riskPct = input.float({_num(value)}, "每筆風險 %", minval=0.1)')
        inputs.append(f'atrMult = input.float({_num(risk.get("atr_mult", 2))}, "ATR 倍數", minval=0.5)')

    entry = "strategy.entry(\"L\", strategy.long)"
    if mode == "atr_risk":
        entry = ("riskQty = math.floor(strategy.equity * riskPct / 100 / (ta.atr(14) * atrMult))\n"
                 "    maxQty = math.floor(strategy.equity / close)\n"
                 "    if math.min(riskQty, maxQty) > 0\n"
                 "        strategy.entry(\"L\", strategy.long, qty=math.min(riskQty, maxQty))")

    title = f"{meta['label']} {symbol}"
    code = f"""//@version=5
// 由「股票交易分析系統」匯出：{meta['label']}（{'、'.join(f"{defs[k]['label']} {_num(v)}" for k, v in params.items())}）
// 規則：{meta['rule']}
// 成交：訊號在收盤確認，下一根開盤成交；停損／移動停利盤中觸價。
// 成本：{com['text']}
strategy("{title}", overlay=true, initial_capital={_num(initial_capital)}, {qty_decl},
     commission_type=strategy.commission.percent, commission_value={com['pct']},
     process_orders_on_close=false, pyramiding=0)

{chr(10).join(inputs)}

{SIGNALS[strategy]}

// 大盤濾網：大盤收盤在 N 日均線之下不開新倉（只擋進場，已持有照原規則出場）
idxClose = request.security(filterIndex, "D", close, lookahead=barmerge.lookahead_off)
idxMa = request.security(filterIndex, "D", ta.sma(close, filterMa), lookahead=barmerge.lookahead_off)
marketOk = not useFilter or na(idxMa) or idxClose >= idxMa

flat = strategy.position_size == 0
if buySig and flat and marketOk
    {entry}
if sellSig and not flat
    strategy.close("L", comment="訊號")

// 停損與移動停利：高點只用到前一根為止（和本系統一樣，避免同一根先高後低的假設）
var float peak = na
if flat
    peak := na
else
    peak := na(peak) ? math.max(strategy.position_avg_price, high) : math.max(peak, high)
stopLv = float(na)
if not flat
    if stopLossPct > 0
        stopLv := strategy.position_avg_price * (1 - stopLossPct / 100)
    if trailPct > 0
        tl = math.max(strategy.position_avg_price, nz(peak[1], strategy.position_avg_price)) * (1 - trailPct / 100)
        stopLv := na(stopLv) ? tl : math.max(stopLv, tl)
    if not na(stopLv)
        strategy.exit("風控", "L", stop=stopLv)
plot(stopLv, "停損價", color.red, style=plot.style_linebr)
plotshape(buySig and flat and not marketOk, "被濾網擋下", shape.xcross, location.belowbar, color.gray, size=size.tiny)
"""

    notes.append(f"在 TradingView 開啟 {tv_symbol(symbol)} 的日線圖再加入這個策略，結果才會對應。")
    notes.append("價格資料不同：本系統用 Yahoo「還權」日 K（除權息已調整），TradingView 預設是未調整價格；"
                 "長期回測、高配息股票差異會比較大，可在圖表設定裡開啟「調整股息」接近本系統。")
    if market == "TW":
        notes.append(f"證交稅攤提：Pine 只能設一個買賣都收的手續費率，所以把賣出證交稅 {com['tax_pct']:g}% "
                     f"平均攤到買、賣各 {com['tax_pct'] / 2:g}%，總成本相同但單筆損益會略有不同；"
                     "台股手續費最低 20 元（零股 1 元）在 Pine 也無法設定。")
        notes.append("股數：本系統台股買得起整張就只買整張、不足一張買零股；Pine 依比例算出的股數不會湊成整張，筆數與報酬會略有差異。")
    elif market not in ("US",):
        notes.append("每手股數（港股、日股等）在 Pine 無法限制，股數不會湊成整手。")
    if mode == "atr_risk":
        notes.append("ATR 風險定額在 Pine 用 ta.atr(14) 於訊號當根計算，與本系統相同；股數未湊整張／整手。")
    if use_filter:
        notes.append(f"大盤濾網用 TradingView 的 {idx}；如果你的帳號看不到這個代號，可在策略設定改成其他大盤代號或關閉濾網。")
    notes.append("成交量 0（暫停交易）的日子本系統不成交、訊號順延；Pine 沒有這條規則。")
    if sl or tr:
        notes.append("進場當天：本系統從進場那根就檢查停損；Pine 的停損單在進場後下一根才生效，偶爾會差一筆。")
    if strategy == "kd_cross":
        notes.append("KD 用的是台灣常用公式（⅔ 前值＋⅓ 新值），不是 TradingView 內建的 Stoch，兩者數值不同。")
    return {"code": code, "notes": notes, "tv_symbol": tv_symbol(symbol), "commission": com,
            "title": title}
