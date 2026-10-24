import unittest
from unittest.mock import patch

from src.market.market_rules import calculate_friction_cost
from src.market.trade_rules import (
    FIXED_LOT,
    STATUTORY_FEES,
    rules_for,
    statutory_cost,
    _parse_hkex,
)
from src.backtest.backtest_engine import BacktestEngine
from src.market.bar import Bar


class TestTradeRules(unittest.TestCase):
    def test_fixed_lot_markets(self):
        """日股、陸股、星股每手固定 100 股"""
        jp = rules_for("7203.T")
        self.assertEqual(jp["lot"], 100)
        self.assertEqual(jp["lot_source"], "全市場固定")

        cn = rules_for("600519.SS")
        self.assertEqual(cn["lot"], 100)

        sg = rules_for("D05.SI")
        self.assertEqual(sg["lot"], 100)

    def test_uk_stamp_duty(self):
        """英股買進收取 0.5% SDRT，賣出不收法定印花稅"""
        buy_cost = statutory_cost(STATUTORY_FEES["UK"], "BUY", 10000.0)
        self.assertEqual(buy_cost, 50.0)

        sell_cost = statutory_cost(STATUTORY_FEES["UK"], "SELL", 10000.0)
        self.assertEqual(sell_cost, 0.0)

    def test_hk_stamp_duty_ceil(self):
        """港股印花稅 0.1% 雙邊，且未滿 1 港元向上進位 (math.ceil)"""
        fees = [
            {"label": "印花稅", "rate": 0.001, "side": "BOTH", "ceil": True},
        ]
        # 1000.5 * 0.001 = 1.0005 -> ceil -> 2.0
        c1 = statutory_cost(fees, "BUY", 1000.5)
        self.assertEqual(c1, 2.0)

        # 1000.0 * 0.001 = 1.0000 -> 1.0
        c2 = statutory_cost(fees, "BUY", 1000.0)
        self.assertEqual(c2, 1.0)

    def test_market_rules_calculate_friction_cost_non_tw_us(self):
        """calculate_friction_cost 針對非台美股能正確套用法定稅費表"""
        res_uk_buy = calculate_friction_cost("UK", "BUY", price=10.0, shares=1000)
        self.assertEqual(res_uk_buy["fee"], 0.0)
        self.assertEqual(res_uk_buy["tax"], 50.0)
        self.assertEqual(res_uk_buy["total_cost"], 50.0)
        self.assertEqual(res_uk_buy["net_amount"], 10050.0)

        res_uk_sell = calculate_friction_cost("UK", "SELL", price=10.0, shares=1000)
        self.assertEqual(res_uk_sell["tax"], 0.0)
        self.assertEqual(res_uk_sell["net_amount"], 10000.0)

    def test_backtest_engine_board_lot(self):
        """回測引擎對日股或港股等市場，部位試算依每手股數整數倍買進"""
        engine = BacktestEngine(market="JP", initial_capital=15000.0, lot_size=100)
        # 現價 120，資金 15000 -> 15000 // 120 = 125 股 -> 整手約束為 100 股
        shares = engine._position_size(price=120.0, cash=15000.0)
        self.assertEqual(shares, 100)


if __name__ == "__main__":
    unittest.main()
