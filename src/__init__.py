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

import sys


def _bootstrap_hot_update() -> None:
    """打包版：盡早（其他 src 模組載入之前）掛上線上更新 update/。
    是否掛載交給 updater.activate_update_if_present 決定（版本比較、壞版本清單、失敗還原、TRADING_SAFE_MODE 都在那裡）；
    這裡不可以自己先掛路徑，否則 updater 事後判定失敗並搬走 update/ 時，已掛上的路徑會指向不存在的資料夾，整個程式起不來。
    任何例外都吞掉，退回內建版。"""
    if not getattr(sys, "frozen", False):
        return
    try:
        from src.server import updater  # updater 與 config 永遠是內建那份（已先被載入就不會被更新版取代）

        updater.activate_update_if_present()
    except Exception as e:  # noqa: BLE001
        print(f"線上更新掛載失敗，改用內建版：{e}", file=sys.stderr)


_bootstrap_hot_update()
