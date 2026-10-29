"""
市場規範與交易成本計算模組 (market_rules.py)
包含：
1. 台股法定 6 級 Tick Size 價格對齊器
2. 台美股真實交易成本（手續費、證交稅、美股規費）
3. 價格波動限制與合規檢查
"""

from datetime import date
from typing import Any, Dict, List, Optional
import math
import re

from src.market.trade_rules import STATUTORY_FEES, statutory_cost, us_fees

# ---------- 費率出處（稅費會變，更新時改這裡並更新查證日期；最後查證 2026-10-29）----------
# 台股手續費：成交值 1.425‰（券商可在此上限內打折），未滿 20 元以 20 元計
#   出處：證交所六十年史「手續費費率」https://www.twse.com.tw/staticFiles/product/publication/twse60/html/292/
#   零股最低 1 元是多數券商的做法（非法規），回測的「手續費折數」也是使用者自己的券商條件
TW_FEE_RATE = 0.001425
# 台股證交稅：股票 3‰、ETF（受益憑證）1‰，賣出時收取 —《證券交易稅條例》
# 債券 ETF 停徵到 2026-12-31；行政院 2026-10-01 通過延長到 2036-12-31 的修正草案，尚未三讀，三讀後再改
#   出處：中央社 https://www.cna.com.tw/news/aipl/202610010185.aspx
# 美股 SEC 規費與 FINRA TAF 的費率、出處在 trade_rules.py（回測與模擬下單共用同一份）

def get_tw_tick_size(price: float) -> float:
    """
    依據台灣證券交易所現行 6 級撮合跳動檔位 (Tick Size)：
    - 股價 < 10 元: 0.01 元
    - 10 <= 股價 < 50 元: 0.05 元
    - 50 <= 股價 < 100 元: 0.10 元
    - 100 <= 股價 < 500 元: 0.50 元
    - 500 <= 股價 < 1000 元: 1.00 元
    - 股價 >= 1000 元: 5.00 元
    """
    if price < 10.0:
        return 0.01
    elif price < 50.0:
        return 0.05
    elif price < 100.0:
        return 0.10
    elif price < 500.0:
        return 0.50
    elif price < 1000.0:
        return 1.00
    else:
        return 5.00

def align_tw_tick(price: float, mode: str = "nearest") -> float:
    """
    將任意價格對齊至合法台股跳動檔位。
    mode:
      - 'nearest': 四捨五入至最近 tick
      - 'ceil': 向上進位至下一個 tick (適用壓力位或賣單)
      - 'floor': 向下捨去至上一個 tick (適用支撐位或買單)
    """
    if price <= 0:
        return 0.0

    tick = get_tw_tick_size(price)
    if mode == "ceil":
        aligned = math.ceil(price / tick) * tick
    elif mode == "floor":
        aligned = math.floor(price / tick) * tick
    else:
        aligned = round(price / tick) * tick

    # 處理浮點數精度問題
    if tick < 0.1:
        return round(aligned, 2)
    elif tick < 1.0:
        return round(aligned, 2)
    else:
        return round(aligned, 1) if aligned % 1 != 0 else float(int(aligned))

BOND_ETF_TAX_FREE_UNTIL = date(2026, 12, 31)  # 債券 ETF 證交稅停徵期限（延長修法三讀後改這裡，前端 ui.jsx 的 twSellTaxRate 也要改）


def tw_sell_tax_rate(code: str, on: Optional[date] = None) -> float:
    """台股賣出證交稅率：股票 0.3%、ETF（00 開頭）0.1%、債券 ETF（00 開頭且 B 結尾）停徵期間 0。"""
    c = re.sub(r"\.(TW|TWO)$", "", str(code).upper())
    if not c.startswith("00"):
        return 0.003
    if c.endswith("B") and (on or date.today()) <= BOND_ETF_TAX_FREE_UNTIL:
        return 0.0
    return 0.001


def calculate_friction_cost(
    market: str,
    action: str,
    price: float,
    shares: int,
    commission_discount: float = 1.0,
    min_commission_twd: float = 20.0,
    fees: Optional[List[Dict[str, Any]]] = None,
    tw_tax_rate: Optional[float] = None,
) -> Dict[str, float]:
    """
    計算交易摩擦成本 (Friction Cost)。
    
    市場 'TW' (台股):
    - 手續費: 成交金額 * 0.1425% * 券商折扣 (預設 1.0，最低 20 元)
    - 證交稅: 賣出時收取，稅率由 tw_tax_rate 傳入（股票 0.3%、ETF 0.1%、債券 ETF 停徵；未傳時用 0.3%），買入免稅
    
    市場 'US' (美股):
    - 手續費: 一般券商零手續費 (或依自訂費率)
    - SEC 規費、FINRA TAF：賣出時收取，費率與出處見 trade_rules.us_fees()
      （回測沒有逐筆交易日期，用一般費率，不套用 TAF 暫停期間）

    其他市場：只算 trade_rules 的法定稅費（不含券商佣金）；fees 可傳入個股規則（如港股 ETF 免印花稅）。
    """
    total_val = price * shares
    action_upper = action.upper()
    market_upper = market.upper()

    if market_upper == "TW":
        # 手續費、證交稅都是元以下無條件捨去（+1e-9 避免浮點誤差把 1425.0 算成 1424.999…）
        base_fee = total_val * TW_FEE_RATE * commission_discount
        fee = max(min_commission_twd, math.floor(base_fee + 1e-9))
        rate = 0.003 if tw_tax_rate is None else tw_tax_rate  # 用 tw_sell_tax_rate() 依股票／ETF／債券 ETF 決定
        tax = math.floor(total_val * rate + 1e-9) if action_upper in ("SELL", "賣出") else 0.0
        return {
            "market": "TW",
            "total_value": round(total_val, 2),
            "fee": float(fee),
            "tax": float(tax),
            "total_cost": float(fee + tax),
            "net_amount": round(total_val - (fee + tax) if action_upper in ("SELL", "賣出") else total_val + fee, 2)
        }
    elif market_upper in STATUTORY_FEES:
        tax = statutory_cost(STATUTORY_FEES[market_upper] if fees is None else fees, action_upper, total_val)
        sell = action_upper in ("SELL", "SHORT", "賣出")
        return {
            "market": market_upper,
            "total_value": round(total_val, 2),
            "fee": 0.0,
            "tax": tax,
            "total_cost": tax,
            "net_amount": round(total_val - tax if sell else total_val + tax, 2)
        }
    else:
        # 美股
        fee = 0.0
        tax_fees = statutory_cost(us_fees(), action_upper, total_val, shares)
        return {
            "market": "US",
            "total_value": round(total_val, 2),
            "fee": fee,
            "tax": round(tax_fees, 2),
            "total_cost": round(fee + tax_fees, 2),
            "net_amount": round(total_val - tax_fees if action_upper in ("SELL", "SHORT") else total_val + fee, 2)
        }

def validate_tw_price_limit(yesterday_close: float, target_price: float) -> bool:
    """
    驗證台股價格是否在當日 ±10% 漲跌停價格限制範圍之內。
    """
    max_price = align_tw_tick(yesterday_close * 1.10, mode="floor")
    min_price = align_tw_tick(yesterday_close * 0.90, mode="ceil")
    return min_price <= target_price <= max_price
