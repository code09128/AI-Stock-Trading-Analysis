"""
市場規範與交易成本計算模組 (market_rules.py)
包含：
1. 台股法定 6 級 Tick Size 價格對齊器
2. 台美股真實交易成本（手續費、證交稅、美股規費）
3. 價格波動限制與合規檢查
"""

from typing import Dict
import math

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

def calculate_friction_cost(
    market: str,
    action: str,
    price: float,
    shares: int,
    commission_discount: float = 1.0,
    min_commission_twd: float = 20.0
) -> Dict[str, float]:
    """
    計算交易摩擦成本 (Friction Cost)。
    
    市場 'TW' (台股):
    - 手續費: 成交金額 * 0.1425% * 券商折扣 (預設 1.0，最低 20 元)
    - 證交稅: 賣出時收取 成交金額 * 0.3% (買入免稅)
    
    市場 'US' (美股):
    - 手續費: 一般券商零手續費 (或依自訂費率)
    - SEC 規費: 賣出時收取 (成交金額 * 0.0000278，最低 $0.01)
    - FINRA TAF: 賣出時每股 $0.000166 (上限 $8.30)
    """
    total_val = price * shares
    action_upper = action.upper()
    market_upper = market.upper()

    if market_upper == "TW":
        base_fee = total_val * 0.001425 * commission_discount
        fee = max(min_commission_twd, round(base_fee))
        tax = round(total_val * 0.003) if action_upper in ("SELL", "賣出") else 0.0
        return {
            "market": "TW",
            "total_value": round(total_val, 2),
            "fee": float(fee),
            "tax": float(tax),
            "total_cost": float(fee + tax),
            "net_amount": round(total_val - (fee + tax) if action_upper in ("SELL", "賣出") else total_val + fee, 2)
        }
    else:
        # 美股
        fee = 0.0
        sec_fee = max(0.01, round(total_val * 0.0000278, 2)) if action_upper in ("SELL", "SHORT") else 0.0
        taf = min(8.30, round(shares * 0.000166, 2)) if action_upper in ("SELL", "SHORT") else 0.0
        tax_fees = sec_fee + taf
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
