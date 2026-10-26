"""
股票交易分析系統 後端程式庫（依功能分類）
- market/  : 市場資料與交易規則：報價、日 K、匯率、籌碼、ETF、市場時區與交易日、台股檔位與稅費
- technical/  : 技術分析：指標、100 分趨勢評分、多空三情境
- news/  : 新聞：抓取、Priced-in 與波動區間、近期新聞彙整
- backtest/  : 策略回測：Next Bar Open 引擎、市場環境拆分與前後段驗證
- portfolio/  : 組合風控：權重、穿透曝險、Beta、歷史回落、多情境壓力測試
- journal/  : 交易檢討：績效統計與行為偏誤
- company/  : 公司與基金：基本資料、配息、財報與市場預期
- ai/  : AI：連線與解讀、補充資料包、技術分析決策、防幻覺稽核
- server/  : HTTP 伺服器與操作紀錄
"""

from importlib.machinery import PathFinder
from pathlib import Path
import sys


def _bootstrap_hot_update() -> None:
    """打包版若存在線上更新目錄 update/src，優先掛載至 __path__ 與 sys.meta_path。"""
    if not getattr(sys, "frozen", False):
        return
    exe_dir = Path(sys.executable).resolve().parent
    up_src = exe_dir / "update" / "src"
    if not up_src.is_dir():
        return
    up_root = str(exe_dir / "update")
    if up_root not in sys.path:
        sys.path.insert(0, up_root)
    if PathFinder in sys.meta_path and sys.meta_path[0] is not PathFinder:
        sys.meta_path.remove(PathFinder)
        sys.meta_path.insert(0, PathFinder)
    if str(up_src) not in __path__:
        __path__.insert(0, str(up_src))


_bootstrap_hot_update()
