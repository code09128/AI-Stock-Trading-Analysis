"""前端與後端、前端與樣式的約定：讀原始碼檢查，型別檢查抓不到這類打錯欄位或忘了定義的問題。"""

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def tsx_files():
    return list(WEB.rglob("*.tsx"))


class AiDrawerFieldTests(unittest.TestCase):
    """AI 抽屜讀的分析結果欄位，都要是對應 API 真的會回傳的（打錯欄位時畫面只會顯示資料不足，AI 也拿不到資料）。"""

    def assert_fields_exist(self, var: str, handler: str):
        drawer = read(WEB / "pages" / "ai_drawer.tsx")
        body = read(ROOT / "src" / "server" / "handlers" / handler)
        fields = set(re.findall(rf"\b{var}\??\.(\w+)", drawer))
        self.assertTrue(fields, f"{var} 應該有被讀取")
        missing = sorted(f for f in fields if f'"{f}"' not in body)
        self.assertEqual(missing, [], f"{handler} 沒有回傳這些欄位")

    def test_backtest_fields(self):
        self.assert_fields_exist("m3Data", "backtest.py")

    def test_risk_fields(self):
        self.assert_fields_exist("m4Data", "portfolio.py")

    def test_journal_fields(self):
        self.assert_fields_exist("m5Data", "journal.py")


class OpenDrawerTests(unittest.TestCase):
    def test_open_ai_drawer_only_takes_module_id(self):
        for f in tsx_files():
            self.assertNotRegex(read(f), r"openAiDrawer\?\.\(\s*\{", f"{f.name} 要傳模組代號字串，不是物件")


class StyleContractTests(unittest.TestCase):
    def test_css_variables_are_defined(self):
        html = read(WEB / "index.html")
        defined = set(re.findall(r"(--[\w-]+)\s*:", html))
        used = set()
        for f in tsx_files():
            used |= set(re.findall(r"var\((--[\w-]+)", read(f)))
        self.assertEqual(sorted(used - defined), [], "這些 CSS 變數沒有定義，對應的顏色會直接消失")

    def test_card_class_is_defined(self):
        self.assertRegex(read(WEB / "index.html"), r"\.ta-card\s*\{", "用了 ta-card 卻沒有樣式，卡片會沒有底色和外框")


if __name__ == "__main__":
    unittest.main()
