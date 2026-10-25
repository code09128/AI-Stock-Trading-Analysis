# AI Stock Trading Analysis（台美股看盤與 AI 分析系統）

在自己電腦上執行的台股＋美股看盤、技術分析、新聞判斷、策略回測、組合風控與交易檢討工具。
行情全部來自公開的真實資料來源，分析由程式計算；AI（雲端或本地模型）是選配，用來解讀程式算好的數字。

> ⚠️ 本工具僅供研究與學習，不構成投資建議。模擬下單不會送出任何真實委託。

## 功能一覽

| 頁面 | 做什麼 |
|---|---|
| **看盤** | 自選股、ETF 精選、我的持股（含碎股、帳戶現金、已領配息對帳）；即時報價、五檔、分時圖、52 週區間；**Windows 系統匣常駐背景提醒**（價格、漲跌幅、RSI 原生 Toast 通知）；模擬下單（台股整張／零股、ROD／IOC／FOK，美股限價／市價，多市場每手股數檢核與法定稅費）；基本資料與配息；**股市熱力圖**（成交金額／市值／等權重／持股市值，紅漲綠跌） |
| **技術分析** | 還權日 K、**盤中指標即時重算**（均線、RSI、MACD、ATR 自動納入盤中最新價）、支撐壓力、100 分趨勢評分、多空三情境、週線；買進／觀望／賣出條件；顯示你這檔持股在停損／目標價的賺賠 |
| **新聞判斷** | 多來源真實新聞（Google News、鉅亨網、Yahoo 奇摩股市、MoneyDJ、證交所重大訊息、SEC 8-K、分析專欄），附摘要、去重；**重大訊息每日存檔（保留 90 天）與歷史公告查詢**；判斷消息是否已反映在股價（Priced-in）與預期波動區間；近期新聞彙整 |
| **策略回測** | 6 種技術策略（雙均線、KD 低檔黃金交叉、均線多頭排列、量價突破、乖離率回歸、跳空缺口），訊號隔日開盤成交、含各市場手續費與法定稅；部位模型（資金比例／固定金額／ATR 風險定額）、單筆停損與移動停利、大盤均線濾網（統計擋下次數）、成交量 0 視同暫停交易；最大回撤以每日收盤市值計算；1／3／5／10 年、多空盤整環境拆解、前後段驗證；參數熱力圖（★ 穩定高原、對照買進持有）、滾動前進分析（WFE）、蒙地卡羅（打亂順序／重抽樣 500～3,000 次）；📡 今日訊號（自選股／持股／自訂清單 × 策略，匯出 CSV）、📤 匯出 TradingView Pine v5（附使用說明與差異說明）、🖨️ PDF 報告；台股證交稅依股票 0.3%／ETF 0.1%／債券 ETF 停徵自動套用 |
| **組合風控** | 集中度、ETF 穿透曝險、Beta、相關係數、大盤下跌情境、歷史回落重演（2020 疫情、2022 升息） |
| **交易檢討** | 分析交易紀錄的勝率、賺賠比、處置效應、報復性交易，產生 3 條個人規則，並成為下單前的勾選清單 |
| **AI 解讀** | 每頁底部，研究主管／交易員口吻的報告格式（表格與段落），依你的持股給建議，回答中的數字自動與資料核對 |
| **設定** | 雲端 AI（Gemini／OpenAI／Claude／OpenRouter）或本地模型（Ollama／LM Studio 自動偵測）；常駐背景提醒與 Windows 開機自動啟動；畫面縮放；金鑰與資料額度直接在畫面填寫 |

各頁之間會互相連動（看盤 → 技術分析 → 回測；熱力圖 → 查新聞；模擬成交 → 交易檢討 → 規則回到下單），程式內「說明」頁有完整流程圖與新手導覽。

## 使用方式

有三種用法，依你的需要選一種：

| 用法 | 適合誰 | 需要安裝 | 怎麼開 |
|---|---|---|---|
| **A. 直接執行（打包好的程式）** | 只想使用、不改程式 | 不用 Python | 執行安裝精靈，或雙擊免安裝 exe |
| **B. 從原始碼執行** | 想用最新程式碼 | Python 3.10 以上 | `start.bat`（瀏覽器）或 `python desktop.py`（桌面視窗） |
| **C. 開發模式** | 要修改程式 | Python 3.10 以上；選配 Node.js | `start.bat`，改完重新整理或重開 |

服務只綁定 127.0.0.1，只有本機能連線。

### A. 直接執行（打包好的程式）

先打包（見下方「打包」），或拿別人打包好的檔案：

- **安裝版（建議，開啟最快）**：執行 `股票交易分析系統_Setup.exe` → 桌面出現捷徑 → 雙擊開啟。重新安裝會沿用原本的資料與金鑰。
- **免安裝版**：雙擊 `股票交易分析系統.exe`，可以放隨身碟帶著走。每次開啟要先解壓縮，會先顯示啟動圖（約 2 秒）。

兩種都是獨立視窗、沒有黑色主控台。電腦需要 Microsoft Edge WebView2 Runtime（Windows 11 與更新過的 Windows 10 內建）。桌面視窗版（打包版與 `python desktop.py`）的操作：

- **啟動**：載入動畫上逐項顯示正在準備的資料（伺服器、你的資料、大盤、即時報價、走勢小圖、分時、技術指標），先抓好進到畫面就不用等。每項最多 8 秒、整體最多 15 秒；3 秒後可按「直接進入」，慢的項目在背景繼續抓。
- **畫面縮放**：標題列右上角「－ 100% ＋」、設定頁的常用比例，或 Ctrl＋加減號、Ctrl＋滾輪（Ctrl＋0 回到 100%）。字與介面一起縮放，版面依放大後的寬度自動重新排列，不會擠在一起；下次開啟沿用。
- **關閉**：按右上角 X 會詢問「縮到系統匣／結束程式／取消」。
  - 縮到系統匣：價格、漲跌幅（每 15 秒）與 RSI（每 5 分鐘）提醒繼續在背景檢查，達標時跳出 Windows 通知；點系統匣圖示叫回視窗。
  - 結束程式：先存好最新修改，視窗立刻消失，背景工作平行收尾，最多 4 秒一定結束。系統匣圖示按右鍵也可以「結束程式」。
- **開機自動啟動**（設定頁）：登入 Windows 後直接縮在系統匣執行。
- **資料位置**：存在程式所在資料夾的 `data/`。**直接執行專案 `dist\` 裡的 exe 時，改用專案根目錄的 `data/`、`.env`、`logs/`**，跟 `start.bat`／`python desktop.py` 共用同一份自選股與持股；裝到其他位置的才各自一份。

### B. 從原始碼執行

```bash
git clone https://github.com/code09128/AI-Stock-Trading-Analysis.git
cd AI-Stock-Trading-Analysis
```

- **瀏覽器版（不用安裝任何套件）**：

  ```bash
  python run.py
  ```

  Windows 也可以雙擊 `start.bat`。會自動用瀏覽器打開 http://127.0.0.1:8088/ ；停止：關閉黑色視窗或按 Ctrl+C。換埠號：`python run.py 8090`。

- **桌面視窗版**（Windows，跟打包版一樣的獨立視窗）：

  ```bash
  pip install -r requirements-desktop.txt
  python desktop.py
  ```

  8088 已經有本程式在跑（例如 `start.bat` 開著）時，桌面版會直接連過去，不會開第二個伺服器。改了程式不用重新打包，關掉再執行 `python desktop.py` 就是新版。

  > 不要同時開著瀏覽器版和桌面版修改資料：兩邊會互相蓋掉對方剛存的內容。

### C. 開發模式

用 `start.bat`（或 `python run.py`）開瀏覽器版開發，最方便：

- **改前端（`web/*.jsx`、`index.html`）**：存檔後在瀏覽器按 F5 就生效（原始碼版由瀏覽器即時轉譯 JSX，不用編譯）。
- **改後端（`src/*.py`）**：要**關掉黑色視窗、重新開 `start.bat`** 才會載入；只重新整理會看到舊功能或「Route not found」。
- **只開伺服器、不開瀏覽器**：`python -m src.server.api_server [埠號]`
- **測試與檢查**：

  ```bash
  python -m unittest discover tests     # 後端測試（test_integration 會實際連 Yahoo，網路慢時約 1 分鐘，其餘離線）
  npx @biomejs/biome lint web           # 前端語法／無障礙檢查（需要 Node.js）
  ```

- **離線範例資料**：設環境變數 `TRADING_ALLOW_SAMPLE=1`，查不到行情時改用範例資料（預設會直接報錯）。
- 開發時的資料一樣存在專案的 `data/userdata.json`；要測試又不想動到自己的資料，可以把專案複製一份到別的資料夾再開。

> `git pull` 更新程式碼後，同樣要重開 `start.bat`／`desktop.py`。

## 設定（全部選填）

不設定任何東西也能完整使用（AI 部分改用內建規則引擎）。需要時到程式的 **設定** 頁：

1. **金鑰與資料額度**：直接填寫，存檔後立即生效，會寫進專案根目錄的 `.env`（已在 `.gitignore`，不會被提交）。
   - `FINMIND_TOKEN`：FinMind 額度由每小時 300 次提高到 600 次（[finmindtrade.com](https://finmindtrade.com) 免費註冊）。程式只用到上限的 80%（240／480 次，可用 `FINMIND_HOURLY_BUDGET` 改），到了就先暫停 FinMind 請求、滿 1 小時自動恢復；設定頁會顯示近 1 小時用量。
   - `GEMINI_API_KEY`／`OPENAI_API_KEY`／`ANTHROPIC_API_KEY`／`OPENROUTER_API_KEY`：AI 金鑰。
   - `SEC_USER_AGENT`：抓美股 SEC 公告用的聯絡資訊（SEC 要求，可填自己的 email）。
2. **AI 連線**：選雲端模型，或讓程式自動掃描本機的 Ollama／LM Studio。OpenRouter 一把金鑰可用多家模型，並可篩選免費模型。

也可以手動複製 `.env.example` 為 `.env` 再編輯；系統環境變數優先於 `.env`。

## 資料存放與隱私

| 資料 | 位置 |
|---|---|
| 持股、交易紀錄、交易規則、自選股、提醒、AI 設定 | `data/userdata.json`（修改後 0.5 秒自動存檔；每天備份到 `data/backups/`，保留 14 天） |
| 金鑰 | `.env` |
| 操作紀錄 | `logs/`（每日一檔，保留 30 天）；桌面版的程式輸出與錯誤在 `logs/desktop.log` |
| 證交所重大訊息存檔 | `data/announcements/`（每日一檔，保留 90 天） |
| 桌面版視窗的瀏覽器資料（偏好設定、快取） | `data/webview/` |
| 報價、日 K、新聞 | 只暫存在記憶體，不存檔 |

`data/`、`.env`、`logs/` 都已排除在 Git 之外，不會上傳。搬移程式資料夾時連同這些一起搬，資料就不會遺失。

## 資料來源

全部是公開資料介面（JSON／RSS），不是爬網頁畫面；抓不到時直接顯示錯誤，不會用假資料補位。

- **台股報價**：證交所 MIS（約延遲 5 秒）；公司與基金基本資料、本益比、ETF 發行單位數：TWSE OpenAPI
- **美股與海外報價、日 K、指數、匯率**：Yahoo Finance
- **台股備援日 K、籌碼、配息、月營收、財報**：FinMind
- **新聞**：Google News RSS、鉅亨網、Yahoo 奇摩股市 RSS、MoneyDJ／玩股網／財報狗／TradingView／ETFdb（經 Google News 限定站台）、證交所重大訊息、SEC EDGAR 8-K

每次請求的網址、狀態與耗時都會記錄，看盤頁「看資料怎麼抓的」可以查看。公開資料源可能改版、限流或延遲。

## 打包成 Windows 程式

**第一次**先安裝打包工具（只要做一次）：

```bash
pip install -r requirements-desktop.txt
```

之後每次打包：雙擊 `package.bat`，或執行：

```bash
python build_app.py              # 資料夾版＋安裝精靈（約 2～3 分鐘）
python build_app.py --portable   # 另外再產生免安裝單一執行檔（多 1～2 分鐘）
```

有 Node.js 時會先用 esbuild 把前端 JSX 預先編譯（開啟更快；沒有就自動用原始碼版）；有 Pillow 時單一執行檔會有啟動圖。產出在 `dist/`：

| 檔案 | 說明 | 用在 | 啟動速度（實測） |
|---|---|---|---|
| `股票交易分析系統/` | 資料夾版（exe＋`_internal`），直接執行裡面的 exe；從專案 `dist\` 執行時與原始碼版共用 `data/` | **自己測試** | 視窗約 1 秒、可操作約 1.5 秒 |
| `股票交易分析系統_Setup.exe` | 安裝精靈，**內容就是上面的資料夾版**，多了安裝、桌面與開始功能表捷徑、解除安裝；裝到「執行安裝程式所在資料夾\股票交易分析系統」，重新安裝會帶過上次的 `data/` 與 `.env`，解除安裝會保留它們 | **給別人用** | 同資料夾版 |
| `股票交易分析系統.exe` | 免安裝單一執行檔（只有加 `--portable` 才產生），每次啟動先解壓縮（期間顯示啟動圖） | 放隨身碟、免安裝 | 視窗約 2 秒、可操作約 2.5 秒 |

沒加 `--portable` 時，`dist/` 裡如果有之前打包的單一執行檔會保留，但它是舊版，打包結束時會提醒。

> 每台電腦第一次開啟會多 2～3 秒（WebView2 建立設定檔）。打包版沒有黑色主控台，程式輸出與錯誤寫在程式資料夾的 `logs/desktop.log`，出問題時看這個檔案。
>
> 打包前請先關掉正在執行的打包版程式，否則檔案被佔用會打包失敗。
>
> 重新打包會保留資料夾版 `dist\股票交易分析系統\` 裡的 `data/`、`logs/`、`.env`。

## 程式碼架構

根目錄的入口與工具：

| 檔案 | 用途 |
|---|---|
| `run.py`／`start.bat` | 瀏覽器版：開伺服器並用預設瀏覽器打開 |
| `desktop.py` | 桌面視窗版：WebView2 獨立視窗、關閉確認、系統匣、畫面縮放，伺服器在背景執行（打包版的入口）；`--background` 直接縮在系統匣啟動 |
| `build_app.py`／`package.bat` | 打包成單一 exe、資料夾版與安裝精靈 |
| `build_web.py` | 前端預先編譯（esbuild），打包時自動呼叫 |
| `requirements-desktop.txt` | 桌面版與打包需要的套件（pywebview、PyInstaller） |

後端 `src/`（純 Python 標準函式庫）依功能分資料夾：

```
src/
├── market/      行情與市場規則：quote_provider（TWSE MIS／Yahoo 即時報價）、data_adapter（日 K）、bar、
│                trade_rules（海外手續費/每手股數）、finmind、chip_data（籌碼）、etf_data、etf_reference、
│                chart_data、heatmap（股市熱力圖）、fx、markets、market_calendar、market_rules、tz
├── technical/   技術分析：indicators、trend_score（100 分趨勢評分）、scenarios（多空三情境）、weekly（週 K）
├── news/        新聞：news_feed（多來源抓取與去重）、announcement_store（重大訊息每日存檔與歷史）、
│                news_strategy（Priced-in／波動區間）、news_digest（近期新聞彙整）
├── backtest/    策略回測：strategies（6 種策略與參數定義）、backtest_engine（Next Bar Open、部位模型、停損停利、濾網）、
│                backtest_analysis（大盤濾網、環境拆分、前後段驗證）、validation（參數熱力圖、滾動前進、蒙地卡羅）、
│                live_signals（今日訊號）、pine_export（匯出 Pine v5）
├── portfolio/   組合風控：portfolio_risk、portfolio_scenarios（多情境）、stress（歷史回落）
├── journal/     交易檢討：journal_coach
├── company/     公司與基金：stock_info（基本資料、配息）、fundamentals（財報與市場預期）
├── ai/          AI：ai_client（各家連線與串流）、ai_prompts（提示詞）、ai_text（數字核對、簡轉繁）、ai_context、
│                llm_runner、anti_hallucination（防幻覺稽核）
└── server/      api_server（HTTP 路由表）、dispatcher、handlers/（各功能 API）、config、params、
                 alert_engine（背景提醒檢查）、tray_icon（Win32 系統匣常駐）、notifier（Toast 通知）、
                 autostart（開機啟動）、env_settings、user_data（資料存檔與備份）、activity_log
```

前端 `web/`（React 18 + Tailwind，套件放在 `web/vendor/`，可離線使用）：

- 原始碼執行時由瀏覽器內的 Babel 即時轉譯 JSX，改完重新整理就生效；打包時 `build_web.py` 用 esbuild 預先編譯成 `app.bundle.js`。
- `app.jsx` 外殼與側邊導覽；`config.jsx`、`ui.jsx`、`charts.jsx`、`live_widgets.jsx`、`markdown.jsx` 共用元件；`sync_store.jsx` 資料同步；`boot_loader.jsx` 啟動預載；`desktop_bridge.jsx` 桌面版關閉確認與畫面縮放；`ai_store.jsx`、`portfolio_store.jsx` 跨頁狀態
- `panels/`：technical（＋technical_parts 籌碼與持股卡片）、news、backtest（＋backtest_parts 小元件、backtest_verify 驗證類、backtest_tools 今日訊號／Pine／PDF）、portfolio、journal、selftest（各分析頁）
- `export_report.jsx`：右上角「匯出報告」的 JSON／Markdown 組裝
- `pages/`：watch（看盤）、heatmap（股市熱力圖）、holdings_panel、order_panel、stock_info_panel、overview_alerts、
  settings／settings_ai（AI 連線編輯）／settings_background（背景服務）／settings_keys／settings_monitor、guide、tour、candle_guide、strategy_guide

開發進度、待辦與已知限制見 [`Continue.md`](Continue.md)。
