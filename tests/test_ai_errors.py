"""AI 失敗時的原因說明（離線）。"""

import unittest
from unittest.mock import patch

from src.ai import ai_client
from src.ai.ai_client import friendly_error


class FriendlyErrorTests(unittest.TestCase):
    def check(self, raw, expect_why):
        text = friendly_error(raw)
        self.assertIn(expect_why, text, text)
        self.assertIn("原始訊息：", text)
        self.assertIn("不受影響", text)
        return text

    def test_timeout(self):
        self.check("The read operation timed out", "沒有在時限內回應")
        self.check("timed out", "沒有在時限內回應")

    def test_auth(self):
        self.check("HTTP 401：{\"error\": \"bad key\"}", "金鑰無效")
        self.check("HTTP 403：permission denied", "金鑰無效")

    def test_rate_limit(self):
        self.check("HTTP 429：RESOURCE_EXHAUSTED", "額度用完")

    def test_model_not_found(self):
        self.check("HTTP 404：models/foo is not found", "找不到這個模型")

    def test_server_busy(self):
        self.check("HTTP 503：overloaded", "暫時忙碌")

    def test_network(self):
        self.check("<urlopen error [Errno 11001] getaddrinfo failed>", "連不到 AI 服務")

    def test_setup_missing(self):
        self.check("尚未填入 API Key", "還沒設定完成")
        self.check("尚未選擇模型（請到「設定」頁填入或按「取得模型清單」）", "還沒設定完成")

    def test_bad_format_and_stream_cut(self):
        self.check("Gemini 回應格式異常：{}", "格式不符")
        self.check("AI 串流中斷，未收到完整回應", "中途斷線")

    def test_unknown_still_carries_raw_message(self):
        text = self.check("something strange", "原因不明")
        self.assertIn("something strange", text)

    def test_empty_and_none(self):
        self.assertIn("（無）", friendly_error(None))
        self.assertIn("原因不明", friendly_error(""))

    def test_raw_message_is_truncated(self):
        self.assertLess(len(friendly_error("x" * 5000)), 400)

    def test_api_key_is_never_added(self):
        # 上游 _mask 已把金鑰換成 ***；這裡確認不會憑空帶出別的內容
        self.assertNotIn("sk-secret", friendly_error("HTTP 401：***"))

    def test_test_connection_returns_friendly_text(self):
        with patch.object(ai_client, "complete", side_effect=ai_client.AIError("timed out")):
            r = ai_client.test({"type": "openai", "model": "m", "api_key": "k"})
        self.assertFalse(r["ok"])
        self.assertIn("沒有在時限內回應", r["error"])


if __name__ == "__main__":
    unittest.main()
