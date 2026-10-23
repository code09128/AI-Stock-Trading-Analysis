# 台美股看盤與 AI 分析系統

## 啟動
需要 Python 3.10+（只用標準函式庫，不用 pip install）與網路。

```bash
python run.py
```
會自動打開 http://127.0.0.1:8088/ 。Windows 也可雙擊 `啟動.bat`。停止：關閉視窗或按 Ctrl+C。
只開伺服器不開瀏覽器：`python -m src.server.api_server [埠號]`。服務只綁定 127.0.0.1，僅本機可連。

## 打包成 Windows 執行檔 / 安裝包
程式更新後，有兩種方式重新打包：
1. **一鍵點擊（最方便）**：直接雙擊專案目錄下的 `打包.bat`。
2. **命令列執行**：
   ```bash
   python build_app.py
   ```
打包完成後會自動更新 `dist/` 資料夾：
- `dist/股票交易分析系統.exe`：單一免安裝便攜版。
- `dist/股票交易分析系統_Setup.exe`：一鍵安裝包（自動建立桌面與開始功能表捷徑）。

## 使用
- **看盤**：左側自選股／ETF 精選／我的持股，右側分時圖、五檔、模擬下單。快捷鍵：`/` 搜尋、`↑↓` 切換標的。
- **我的持股**：輸入或貼上 CSV（代號,股數,成本價），即時算損益，並可一鍵送去「組合風控」。
- **設定**：連接雲端 AI（Gemini／OpenAI／Claude／OpenRouter，OpenRouter 一把金鑰可用多家模型、可篩選免費模型並自動記錄實際花費）或本地模型（Ollama、LM Studio…），全系統共用；不設定也能用內建規則引擎。
- 其餘分頁：技術分析、新聞判斷、策略回測、組合風控、交易檢討、系統自檢、說明（含新手導覽）。
- 資料來源與真實／範例的區分請看「說明」頁或 `Continu.md`。

## 開發
```bash
python -m unittest discover tests   # 後端測試
npx @biomejs/biome check web        # 前端語法/無障礙檢查
```
## 資料存放
- **持股、交易紀錄、交易規則、自選股、提醒、AI 設定**：自動存成程式資料夾的 `data\userdata.json`（瀏覽器只當暫存，修改後 0.5 秒自動存檔）。
  整個程式資料夾搬家，資料跟著走；換瀏覽器、清除瀏覽紀錄不會遺失。每天自動備份到 `data\backups\`，保留 14 天。
- 重新安裝到別的資料夾時，安裝程式會把上次安裝位置的 `data\` 與 `.env` 帶過來；解除安裝會保留這兩者。
- 報價、日 K、新聞等行情資料只暫存在記憶體，不存檔。

## 金鑰與資料額度（.env）
全部選填，不設定也能用。到程式的 **設定 → 金鑰與資料額度** 直接填寫即可，存檔後立即生效，不用自己建立或搬移檔案：
- `FINMIND_TOKEN`：FinMind 額度由每小時 300 提高到 600 次（到 finmindtrade.com 免費註冊）。
- `GEMINI_API_KEY`／`OPENAI_API_KEY`／`ANTHROPIC_API_KEY`／`OPENROUTER_API_KEY`：填這裡就不必把金鑰存在瀏覽器（「AI 連線」的 Key 欄位留空）。
- `SEC_USER_AGENT`：抓美股 SEC 公告用的聯絡資訊。

內容存在程式資料夾的 `.env`（安裝版 `%LOCALAPPDATA%\TradingSystem\.env`、免安裝版在 exe 旁、原始碼在專案根目錄），
不會被打包進執行檔。也可以手動編輯，格式見 `.env.example`；已設定的系統環境變數優先。
開發測試可設 `TRADING_ALLOW_SAMPLE=1`（查不到行情時用離線範例資料，預設會報錯）。

## 程式碼架構
後端 `src/` 依功能分資料夾：

```
src/
├── market/      行情與市場規則：quote_provider（TWSE MIS／Yahoo 即時報價）、data_adapter（日 K）、bar（K 棒資料結構）、
│                finmind、chip_data（籌碼）、etf_data、etf_reference、chart_data、fx、markets、market_calendar、market_rules、tz
├── technical/   技術分析：indicators、trend_score（100 分趨勢評分）、scenarios（多空三情境）、weekly（週 K）
├── news/        新聞：news_feed（抓取）、news_strategy（Priced-in／波動區間）、news_digest（近期新聞彙整）
├── backtest/    策略回測：backtest_engine（Next Bar Open）、backtest_analysis（環境拆分、前後段驗證）
├── portfolio/   組合風控：portfolio_risk、portfolio_scenarios（多情境）、stress（歷史回落）
├── journal/     交易檢討：journal_coach
├── company/     公司與基金：stock_info（基本資料、配息）、fundamentals（財報與市場預期）
├── ai/          AI：ai_client、ai_context、llm_runner、anti_hallucination（防幻覺稽核）
└── server/      api_server（HTTP 路由表）、dispatcher、handlers/（各功能 API）、config（路徑、.env 載入）、
                 params（參數檢查）、env_settings（設定頁寫入 .env）、activity_log
```

前端 `web/`（React 18 + Tailwind，套件放在 `web/vendor/` 可離線使用）：
- 原始碼執行時由瀏覽器內的 Babel 即時轉譯 JSX，改完重新整理就生效。
- 打包時 `build_web.py` 先用 esbuild 把 JSX 編譯並合併成 `app.bundle.js`（輸出到 `build/web_dist/`），打包版不帶 Babel、開啟較快；
  JSX 有語法錯誤會讓打包失敗。需要 Node.js，沒有的話自動退回原始碼版。
- `app.jsx` 外殼與側邊導覽；`config.jsx`、`ui.jsx`、`charts.jsx`、`live_widgets.jsx` 共用元件
- `panels/`：technical、news、backtest、portfolio、journal、selftest（各分析頁）
- `pages/`：watch（看盤）、holdings_panel（我的持股）、order_panel、stock_info_panel、overview_alerts、
  settings／settings_keys／settings_monitor、guide、tour、candle_guide、strategy_guide
