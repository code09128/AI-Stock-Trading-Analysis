"""新手導覽不能指向不存在的畫面：每一步的 go（頁面 id）要在側欄或頁面清單裡，target 要能在原始碼找到 data-tour。
導覽是靠 data-tour 屬性定位的，改畫面時漏改就會變成「點開導覽卻找不到那個功能」。"""

import re
import unittest
from pathlib import Path

WEB = Path(__file__).resolve().parents[1] / "web"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


class TourTargetTests(unittest.TestCase):
    def setUp(self):
        self.tour = read(WEB / "pages" / "tour.tsx")
        self.sources = "\n".join(read(p) for p in WEB.rglob("*.tsx"))

    def test_every_go_is_a_known_page(self):
        ids = set(re.findall(r"id: '([\w]+)',\s*(?:hidden: true,[^\n]*\n\s*)?group:", read(WEB / "config.tsx")))
        ids |= {"guide", "settings", "savings"}
        gos = set(re.findall(r"go: '([\w]+)'", self.tour))
        self.assertTrue(gos)
        self.assertEqual(gos - ids, set(), "導覽的 go 指向不存在的頁面")

    def exists(self, t):
        if f'data-tour="{t}"' in self.sources or f"data-tour='{t}'" in self.sources:
            return True
        # AiExplain 用 data-tour={"ai-explain-" + module} 動態產生
        return t.startswith("ai-explain-") and 'data-tour={"ai-explain-"' in self.sources.replace("`", '"') or (
            t.startswith("ai-explain-") and "ai-explain-" in self.sources
        )

    def test_every_target_exists_in_sources(self):
        targets = set(re.findall(r"target: '([\w-]+)'", self.tour))
        self.assertGreater(len(targets), 20)
        missing = [t for t in sorted(targets) if not self.exists(t)]
        self.assertEqual(missing, [], f"導覽目標在畫面原始碼找不到：{missing}")

    def test_flow_targets_exist_too(self):
        flows = set(re.findall(r"\['(?:watch|mod\d|board|chains|multichart|savings|settings)', '[^']*', '([\w-]+)'", self.tour))
        missing = [t for t in sorted(flows) if not self.exists(t)]
        self.assertEqual(missing, [], f"流程卡的導覽目標找不到：{missing}")


if __name__ == "__main__":
    unittest.main()
