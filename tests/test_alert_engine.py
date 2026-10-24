import unittest
from unittest.mock import patch, MagicMock

from src.server.alert_engine import evaluate_alert, format_alert_message, AlertEngine


class TestAlertEngine(unittest.TestCase):
    def test_evaluate_price_alerts(self):
        """價格 ≥ 與 ≤ 條件判斷"""
        a_above = {"type": "price_above", "value": 1000.0}
        self.assertTrue(evaluate_alert(a_above, {"price": 1000.0}))
        self.assertTrue(evaluate_alert(a_above, {"price": 1005.0}))
        self.assertFalse(evaluate_alert(a_above, {"price": 999.0}))
        self.assertFalse(evaluate_alert(a_above, {"price": None}))

        a_below = {"type": "price_below", "value": 500.0}
        self.assertTrue(evaluate_alert(a_below, {"price": 500.0}))
        self.assertTrue(evaluate_alert(a_below, {"price": 490.0}))
        self.assertFalse(evaluate_alert(a_below, {"price": 501.0}))

    def test_evaluate_change_alerts(self):
        """漲跌幅 ≥ 條件判斷（正數代表漲或跌幾 %）"""
        # 漲幅 ≥ 3%
        a_up = {"type": "chg_above", "value": 3.0}
        self.assertTrue(evaluate_alert(a_up, {"chg": 3.0}))
        self.assertTrue(evaluate_alert(a_up, {"chg": 5.2}))
        self.assertFalse(evaluate_alert(a_up, {"chg": 2.9}))
        self.assertFalse(evaluate_alert(a_up, {"chg": -4.0}))

        # 跌幅 ≥ 3% (填 3 或 -3 都應視為跌 3% 以上，即 chg <= -3.0)
        a_down = {"type": "chg_below", "value": 3.0}
        self.assertTrue(evaluate_alert(a_down, {"chg": -3.0}))
        self.assertTrue(evaluate_alert(a_down, {"chg": -5.0}))
        self.assertFalse(evaluate_alert(a_down, {"chg": -2.8}))
        self.assertFalse(evaluate_alert(a_down, {"chg": 1.0}))

    def test_evaluate_rsi_alerts(self):
        """RSI(14) 超買超賣提醒"""
        a_rsi_overbought = {"type": "rsi_above", "value": 75.0}
        self.assertTrue(evaluate_alert(a_rsi_overbought, {"rsi": 75.0}))
        self.assertTrue(evaluate_alert(a_rsi_overbought, {"rsi": 82.0}))
        self.assertFalse(evaluate_alert(a_rsi_overbought, {"rsi": 74.9}))

        a_rsi_oversold = {"type": "rsi_below", "value": 30.0}
        self.assertTrue(evaluate_alert(a_rsi_oversold, {"rsi": 30.0}))
        self.assertTrue(evaluate_alert(a_rsi_oversold, {"rsi": 25.0}))
        self.assertFalse(evaluate_alert(a_rsi_oversold, {"rsi": 30.1}))

    def test_format_alert_message(self):
        """通知字串格式化包含代號、條件與單位"""
        msg1 = format_alert_message({"symbol": "2330.TW", "type": "price_above", "value": 1050})
        self.assertIn("2330.TW", msg1)
        self.assertIn("價格 ≥", msg1)
        self.assertIn("1050", msg1)

        msg2 = format_alert_message({"symbol": "NVDA", "type": "chg_above", "value": 5.0})
        self.assertIn("NVDA", msg2)
        self.assertIn("今日漲幅 ≥", msg2)
        self.assertIn("5.0%", msg2)

    @patch("src.server.alert_engine.notifier.send_notification")
    @patch("src.server.alert_engine.quote_provider.get_quotes")
    def test_check_once_triggers_and_saves(self, mock_quotes, mock_notify):
        """驗證 check_once 流程：觸發提醒、寫回 active=False 並調用通知"""
        mock_quotes.return_value = [
            {"symbol": "2330.TW", "is_live": True, "price": 1080.0, "change_pct": 3.5}
        ]

        engine = AlertEngine()
        test_alerts = [
            {"id": 1, "symbol": "2330.TW", "type": "price_above", "value": 1050.0, "active": True},
            {"id": 2, "symbol": "2330.TW", "type": "price_below", "value": 900.0, "active": True},
        ]
        saved_alerts = []

        engine.load_alerts = MagicMock(return_value=test_alerts)
        engine.save_alerts = MagicMock(side_effect=lambda a: saved_alerts.extend(a))

        fired = engine.check_once()

        # id=1 達標（現價 1080 >= 1050），id=2 未達標
        self.assertEqual(len(fired), 1)
        self.assertEqual(fired[0]["id"], 1)
        self.assertFalse(fired[0]["active"])
        self.assertIn("firedAt", fired[0])
        self.assertEqual(fired[0]["firedValue"]["price"], 1080.0)

        # 驗證有發出桌面通知
        mock_notify.assert_called_once()
        # 驗證有存回 userdata
        engine.save_alerts.assert_called_once()
        self.assertFalse(saved_alerts[0]["active"])
        self.assertTrue(saved_alerts[1]["active"])


if __name__ == "__main__":
    unittest.main()
