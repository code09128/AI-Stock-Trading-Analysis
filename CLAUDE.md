# 專案規則：AI Stock Trading Analysis

架構、啟動與資料來源見 `README.md`；進度、待辦與已知限制見 `Continue.md`。

## 資料安全
- 不得覆蓋或修改使用者的 `data/userdata.json`。需要實際跑伺服器測試時，用隔離伺服器（埠 8096，資料放 `%TEMP%\trading_sync_test`），不要用 8088。
- `.env`、`data/`、`logs/` 不能提交或上傳，也不要派給 agy 副手讀取。
- 動用使用者的 AI API 金鑰（會產生費用）前要先取得同意。

## Git
- GitHub：`code09128/AI-Stock-Trading-Analysis`（公開），本機 `main` 追蹤 `origin/main`。
- commit 或 push 前一定要先問使用者。

## 開發慣例
- 後端只用 Python 標準函式庫，不新增第三方套件藥用要詢問使用者。唯一例外：桌面視窗版 `desktop.py` 與打包用 pywebview／PyInstaller（`requirements-desktop.txt`），`run.py`／`start.bat` 不需要它們。
- 桌面版要測試時，寫一支暫存腳本把 `user_data.data_dir` 與 `desktop.get_app_dir` 指到 `%TEMP%\trading_sync_test` 再呼叫 `desktop.main()`（埠 8096），不要直接 `python desktop.py`（會用到真的 `data/`）。
- 改完跑 `python -m unittest discover tests`（全部離線）；前端改動跑 `npx @biomejs/biome lint web`。
- 批次檔（`.bat`）要用 CRLF 換行。
