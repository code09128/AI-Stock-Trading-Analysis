# 股票交易分析系統 — 交接、待辦與開發紀錄 (Continue.md)

> 最後更新：2026-10-24

## 一、現況摘要
- **啟動**：瀏覽器版 `python run.py` 或雙擊 `start.bat` → http://127.0.0.1:8088/ ；桌面視窗版 `python desktop.py`（需 `pip install -r requirements-desktop.txt`）。打包：雙擊 `package.bat`（產出桌面視窗版；有 Node.js 時先用 esbuild 編譯前端）。
- **後端 `src/`**：依功能分資料夾 — `market/`（行情、日 K、市場規則）、`technical/`、`news/`、`backtest/`、`portfolio/`、`journal/`、`company/`、`ai/`、`server/`（路由表 `api_server.py`、`dispatcher.py`、`handlers/`、`config.py`、`env_settings.py`、`user_data.py`）。詳見 README「程式碼架構」。
- **前端 `web/`**：React 18 + Tailwind（`web/vendor/` 可離線）；`panels/`（technical、news、backtest、portfolio、journal、selftest）、`pages/`、`sync_store.jsx`（資料同步）、`markdown.jsx`（AI 回答格式化與 LaTeX 數學符號轉換）。
- **資料存放**：持股、交易紀錄、規則、自選股、提醒、AI 設定 → `data/userdata.json`（每日備份 `data/backups/`，保留 14 天）；金鑰 → `.env`（設定頁「金鑰與資料額度」可直接填）；操作紀錄 → `logs/`。
- **AI**：研究主管／交易員口吻的報告格式＋關鍵數字卡＋數字核對（含中文單位換算與指數名稱識別）＋即時串流顯示（Streaming，含推理思考階段進度提示）＋LaTeX 數學符號自動轉可讀符號；Ollama 自動加大上下文；雲端 503／429 自動重試。
- **測試**：`python -m unittest discover tests`（目前 159 個全過）；前端 `npx @biomejs/biome lint web`（0 警告）；`python -m pyflakes src`（只剩 `api_server.py` 為了測試刻意保留的 re-export）。
- **約定**：畫面文字用繁體中文、專業術語以「白話（術語）」並附「?」說明；不填假資料，取不到就顯示原因。

---

## 二、待辦與後續可考慮項目
1. ✅ **已完成驗證與升級（2026-10-23）**：
   - 六大頁面（技術分析 `mod1`、基本資料 `stock`、新聞判斷 `mod2`、策略回測 `mod3`、組合風控 `mod4`、交易檢討 `mod5`）新版 AI 解讀、建議問題帶入、Markdown 段落／表格顯示皆已實測通過。
   - **AI 解讀即時串流顯示（Streaming）**：後端新增 `complete_stream()`、`explain_stream()` 與 `POST /api/ai/explain_stream`（NDJSON），支援 Gemini、OpenRouter、OpenAI、Anthropic 與本機 Ollama；前端 `web/ai_store.jsx` 即時顯示資料整理階段、模型推理思考字數進度與逐段 Markdown 渲染，完成後自動執行數字核對與 tokens／費用紀錄。
   - **LaTeX 數學符號顯示修正**：前後端同步新增 `cleanMath` / `clean_math`（如 `$\ge 0.7$` 自動轉為 `≥ 0.7`，保留 `$100 ～ $120` 金額符號）。
   - **持有標的部位連動**：`VTI`（1.09826 股、成本 377.09）的「你持有這檔」部位自動帶入已分別用 OpenRouter（`nvidia/nemotron-3-ultra-550b-a55b:free`）與 Google Gemini（`gemini-3.5-flash-lite`）實測確認。
   - **新聞判斷三個範例按鈕**：確認 `2330.TW`、`NVDA`、`2454.TW` 均改由真實日 K 計算事件前漲跌與支撐停損條件，不再出現舊寫死的 1035 元／132.5 元。
   - **數字核對（`unverified_numbers()`）補強**：支援中文常見單位換算（張 `÷1e3`、萬 `÷1e4`、百萬 `÷1e6`、萬張 `÷1e7`、億 `÷1e8`）與常見指數名稱（標普 500、日經 225、滬深 300、富時 100）。
   - 更新 `biome.json` schema 至 2.6.2 並通過前端 Lint 零警告檢查；重新執行 `build_app.py` 更新 `dist/股票交易分析系統.exe` 與 `dist/股票交易分析系統_Setup.exe`。
2. **舊安裝資料夾清理**：舊安裝位置 `%LOCALAPPDATA%\TradingSystem` 確認新版安裝正常後，可由使用者自行移除。
3. **可考慮（未排程）**：建議問題加「一鍵直接送出」；AI 回答可匯出成報告。
4. ✅ **股市熱力圖（第二階段，2026-10-23）**：看盤頁右側第 3 個分頁。範圍：我的自選＋持股／台股熱門族群（32 檔）／美股核心（23 檔）；方塊大小：成交金額／市值／等權重／我的持股市值（全部換算台幣）；紅漲綠跌 7 段、漲跌停黃框、族群加權平均漲跌；單擊選股、雙擊看行情、一鍵送技術分析或「查今天的新聞」（自動帶入新聞判斷並抓新聞）。後端 `src/market/heatmap.py`、`POST /api/heatmap`；美股用 Yahoo v7 批次報價一次查完。測試 `tests/test_heatmap.py`。需重開 `start.bat` 才生效。
5. ✅ **新聞來源擴充（第一階段，2026-10-23）**：台股加鉅亨網（附摘要）、Yahoo奇摩股市 RSS（附摘要，含上櫃公司公告）、MoneyDJ、玩股網／財報狗分析專欄；美股加鉅亨網、TradingView／ETFdb 分析專欄。跨站轉載去重、新聞列表可依「新聞／公告／分析專欄」篩選，摘要一併送進新聞彙整的規則與 AI。測試 `tests/test_news_sources.py`。需重開 `start.bat` 才生效。

6. ✅ **跨頁連動檢查與修正（2026-10-23）**：說明頁「功能怎麼串在一起」四條流程逐一實測。修正：交易檢討在「我的交易紀錄」模式下改為表格即紀錄、回到該頁自動重讀（原本會用舊表格覆蓋掉之後模擬成交的紀錄）；「我的交易紀錄」模式隱藏寫死的範例交易按鈕；持股列「賣出」支援美股碎股、台股小數股（零股賣出提醒）與非整張（先帶整張、提示零頭）；平倉加容許誤差；下單沒加成功不清空已勾規則；組合風控持股與「我的持股」不一致時改顯示提醒；新增導覽步驟「各頁底部 AI 解讀」（共 18 步），導覽目標被捲走時會再捲回。
7. ✅ **桌面視窗版與打包改版（2026-10-24）**：`desktop.py` 用 pywebview（Edge WebView2）開獨立視窗、沒有黑色主控台，啟動先顯示載入動畫（`web/index.html` 的 `#splash`，瀏覽器版也看得到），伺服器在背景啟動；8088 已有本程式就直接連線；關視窗前先把最後的修改寫回 `data/userdata.json`，再立即結束程式。`build_app.py` 產出單一 exe（含 PyInstaller 啟動圖）、資料夾版、安裝精靈（裝資料夾版）。實測：資料夾版 0.8 秒出視窗、1.4 秒介面可用；單一 exe 2.0／2.6 秒。程式輸出寫 `logs/desktop.log`，視窗資料 `data/webview/`。
8. ✅ **全專案 Bug 檢查與清理（2026-10-24）**：
   - 修正：技術分析換股時會多送一次 2330 的分析而可能蓋掉畫面（初始載入的 effect 每次換股都重跑）＋請求序號防過期回應；看盤頁「加入我的持股」按鈕呼叫未定義函式；「重置」後交易檢討仍標為我的紀錄，診斷會用範例蓋掉真正的交易紀錄；啟動時資料檔超過 4 秒才到會被畫面舊值寫回；下單面板報價跳動蓋掉手填限價；模擬成交代號寫法不同（2330／2330.TW）會拆成兩筆持股；模擬賣出的交易紀錄補上損益與報酬率；非台美市場的分時圖時區與市場代碼；連續提示訊息被上一則計時器提早關掉。
   - 後端：歷史回落重演在起點當天某市場休市時市值被當 0；GET API 出錯改回 JSON 500（原本直接斷線）且改完整路徑比對；`.env` 存檔加鎖並原子寫入；資料檔損毀改讀備份時補上鍵名／型別過濾；港日英等市場的新聞時間改用當地時區、SEC 8-K 只抓美股；報價快取回傳複本。
   - 清理：移除沒用到的函式（`extract_prices`、`calculate_portfolio_beta`、`US_TZ`、`BAR_ZOOM_OPTIONS`）與 import；`installer_main.py` 改為打包時產生、不進 git；刪除已完成的規劃文件。
   - 網路卡住：前端所有 `/api/` 請求加等待上限（一般 90 秒、會呼叫 AI 的 240 秒，串流 AI 解讀除外），逾時顯示原因而不是永遠轉圈；報價（5 秒）、技術分析（5 秒）、提醒、熱力圖、分時圖、大盤指數的定時更新加「上一輪還沒回來就跳過」，實測每個請求卡 12 秒時同時最多 2 個（原本會一直累積）。後端所有對外連線本來就有 8～180 秒逾時，AI 串流連線用 `with` 確保關閉。
   - 存檔：存檔前讀不到 `userdata.json`（防毒、OneDrive 短暫鎖住）原本會拿舊備份當底寫回、蓋掉當天修改 → 改為重試 5 次仍讀不到就這次不存並回報；寫入置換也會重試；損毀檔先另存 `userdata.corrupt-*.json`；每日備份失敗不再擋住存檔；前端存檔失敗自動重送（3 秒起逐次加倍、最長 1 分鐘）；`.env` 置換同樣重試；操作紀錄寫不進去不影響功能。新增測試 2 個（共 158 個）。
   - 檢查方式：Claude 主審＋agy（Gemini）副手分前後端各掃一次，每個回報都打開程式碼確認後才修。
9. ✅ **回測依本金計算股數、稅費取整數、操作通知（2026-10-24）**：
   - 回測：每筆用當下資金買進（損益滾入下一筆），台股買得起就整張、不足一張改零股（零股手續費低消 1 元），其他市場以 1 股為單位；回傳 `position_sizing`、`initial_capital`、`final_equity`、`skipped_no_cash`，回測頁顯示「本金 → 期末」。
   - 台股手續費與證交稅改為元以下無條件捨去（前端模擬下單與後端回測一致）。
   - 導覽快速切換步驟時取消上一步還沒送出的分頁切換。
   - **增刪改查一律通知**：`window.TA.notifySaved(msg)` 等修改真的寫進 `data/userdata.json` 才顯示 ✅，失敗顯示 ⚠️＋原因並說明會自動重試，補存成功再通知一次；逐字修改的表格用 `notifySavedLater` 停手 1 秒才提示。涵蓋：自選股、暫存匣、模擬成交、我的持股（新增／更新／CSV 匯入／移除）、提醒、交易紀錄（修改／刪除／CSV 匯入／切換來源）、交易診斷寫回規則、AI 連線（新增／編輯／刪除／切換／作用範圍）、金鑰設定、清除資料、備份下載與還原、風控試算表；使用者主動的查詢（技術分析、新聞抓取與判斷、回測、風控、診斷）顯示完成或失敗，自動輪詢不提示。刪除持股、交易紀錄、AI 連線前先確認。
   - 修正：「從備份還原」原本 0.8 秒就重新載入，資料還沒存進檔案就被檔案裡的舊資料蓋回，現在等存檔完成才重新載入。

---

## 三、已知限制與待優化細節
1. 週線只有 MA/RSI/MACD 摘要，沒有週線版的買賣決策。
2. 無「內外盤」真實資料來源（用五檔委買/委賣量比例代替）；ETF「規模」是市值估算、戶數只有前 20 名、成分股只有前十大；00849B 查無規模。
3. 歷史回落重演假設持股數量與匯率不變。
4. 熱力圖：上櫃公司與部分上櫃 ETF 沒有公開股數，美股 ETF 沒有市值欄位，市值模式以最小方塊顯示；懸停資訊沒有 5 日／20 日漲跌（每檔要多抓日 K，先不做）。
5. 新聞：鉅亨網搜尋是非公開文件介面（格式可能變動，失敗會單獨顯示錯誤）；美股在鉅亨網只能用代號搜，則數少；MoneyDJ／專欄站經由 Google News 限定站台搜尋，沒有摘要；情緒方向預設由使用者判斷（或勾選 AI 判斷）。SEC 8-K 需要網路可連 sec.gov。
6. 台美股以外沒有內建假日表（今天以後只排除週末，過去日期看有沒有日 K）。
7. ✅ 熱力圖英股（`.L`）市值：已用 SHEL.L 真實資料確認 Yahoo `marketCap` 是英鎊、報價是便士，2026-10-24 修正為英鎊匯率換算（測試 `test_uk_market_cap_is_pounds_while_price_is_pence`）。
8. ✅ 台美股以外市場手續費與每手股數（2026-10-24）：法定稅費表（港股印花稅 0.1% 雙邊+徵費、英股 0.5% SDRT、陸股 0.05% 印花稅+費、韓股 0.2% 證交稅、星股清算費），佣金預設 0 並註明「未含券商佣金」；每手股數（日/陸/星股固定 100 股，港股由港交所官方證券清單 ListOfSecurities.xlsx 每日快取取得）；模擬下單與回測同步約束每手整數倍（測試 `tests/test_trade_rules.py`）。
9. ✅ 盤中技術指標納入即時價（2026-10-24）：`DualMarketDataAdapter.merge_realtime_bar` 與 `build_technical_snapshot` 在盤中自動將即時報價更新最後一根 K 棒（若日 K 尚未開出今日 bar 則追加盤中 K 棒），MA5/20/60/200、RSI14、MACD、ATR14、100 分趨勢評分及看盤頁技術總覽全部即時連動（測試 `tests/test_live_technical_indicators.py`）。
10. ✅ 常駐背景提醒與系統匣服務（2026-10-24）：Python 端重寫 `AlertEngine`（每 15 秒檢查價格與漲跌幅、每 5 分鐘檢查 RSI，達標發送 Windows 原生 Toast 通知）；純 Win32 ctypes 實作 `TrayIcon` 系統匣常駐、右鍵選單（開啟主畫面、暫停/繼續提醒、結束程式）；`desktop.py` 按 X 時詢問縮到系統匣或結束程式；設定頁提供開關與開機自動啟動 `autostart.py`（測試 `tests/test_alert_engine.py`）。
11. ✅ 證交所重大訊息每日存檔與歷史公告（2026-10-24）：每日自動將全市場重大訊息（TWSE OpenAPI）留存至 `data/announcements/twse_material_YYYYMMDD.json`（保留 90 天），查詢個股重大訊息時自動合併當日最新與本地歷史累積去重；並新增 Google News 搜尋近 30 天包含【公告】或重大訊息之新聞來源補強歷史（測試 `tests/test_announcements.py`）。


---

## 四、完整開發歷程紀錄

### 1. 2026-10-20 核心引擎與看盤頁建立
- 完成模組 1～5 Python 計算引擎、Yahoo Finance / FinMind 還權日 K 與即時匯率串接、LLM 防幻覺閘門（`AntiHallucinationGuard`）、REST API 伺服器（Port 8088）與 React 18 + Tailwind CSS 互動主控台。
- 新增看盤頁（`web/pages/watch.jsx`）：自選股、ETF 精選、即時報價（台股 TWSE MIS 含五檔、美股 Yahoo Chart API）、當日分時圖、52 週區間條、台美股模擬下單、週線切換（日線聚合還權）、價格／漲跌幅／RSI 提醒、自選股技術總覽、說明頁與 K 線／策略教學。

### 2. 2026-10-21 導覽改版、AI 連線管理與跨頁連動
- 介面改為左側可收合導覽（行情／分析／風控與檢討／系統）；新增設定頁（支援 Gemini／OpenAI／Claude／OpenRouter／本機 Ollama、LM Studio 偵測 `/api/ai/detect`）與各分頁底部「AI 解讀」。
- 新增標的「基本資料與配息」分頁（除息日、發放日、配息頻率、下一場公告或推測、前十大成分股）與配息月曆。
- 跨頁連動（`web/portfolio_store.jsx`）：共用「我的持股／交易紀錄／交易規則」；看盤模擬下單成交自動寫入持股或交易紀錄；交易檢討產生的 3 條個人紀律同步至下單面板、技術分析與組合風控；新增 17 步互動式新手導覽（`web/pages/tour.jsx`）。

### 3. 2026-10-22 趨勢評分、籌碼面板、全系統 Review 修正與多市場支援
- **100 分趨勢評分（`src/technical/trend_score.py`）**：六維度評分（趨勢 30／乖離 20／MACD 15／量能 15／RSI 10／支撐 10），強制 RSI≥80 或 MA5 乖離>5% 不買；修正上櫃 `.TWO` 日 K 抓取與收盤後空 K 棒補齊。
- **台股籌碼面板（`src/market/chip_data.py`）**：FinMind 三大法人、融資融券、外資持股比與連續買賣超統計，並加入 FinMind 402/403 自動暫停保護與日 K 60 秒快取。
- **全系統 Review 高／中／低優先修正**：
  - 支撐／壓力改依「現價」動態分類（`classify_levels` / `reclassify_levels`），修正 SELL 決策的停損（上方失效價）與目標（下方目標價）方向。
  - ETF 穿透曝險扣除前十大後列為「其他成分股」，確保權重守恆 100%。
  - 提醒改掛全域 `AlertWatcher`；完善白話輸入檢核（HTTP 400）、離線時區規則（`src/market/tz.py`）、台美股休市日曆（`src/market/market_calendar.py`）與債券 ETF 識別。
- **多市場支援（`src/market/markets.py`、`src/market/fx.py`）**：支援台、美、港（`.HK`）、日（`.T`）、韓（`.KS`/`.KQ`）、陸（`.SS`/`.SZ`）、英（`.L`）、德（`.DE`）、加（`.TO`）、澳（`.AX`）、星（`.SI`）共 11 個市場與自動跨幣別台幣匯率換算。
- **AI 用量估算、補充資料包與 K 線縮放**：新增 tokens 與費用統計（`ai_usage`）、多面向補充資料包（`src/ai/ai_context.py`）、前推式操作紀錄（`logs/activity-YYYYMMDD.jsonl`）與 K 線滾輪／拖曳／全螢幕縮放。

### 4. 2026-10-23 五套分析框架、架構模組化、打包安裝精靈與 AI 串流升級
- **五套分析框架**：
  - 策略回測（`src/backtest/backtest_analysis.py`）：1／3／5／10 年期間、多頭／盤整／空頭環境拆解、前 70%／後 30% 前後段驗證（Walk-forward）。
  - 技術分析三情境（`src/technical/scenarios.py`）：日線＋週線＋量能之多頭／中性／空頭劇本（觸發、目標、失效條件）。
  - 新聞彙整（`src/news/news_digest.py`）：近期新聞逐則 5 面向整理與發布前後真實股價反應（ATR 倍數）。
  - 組合風控多情境（`src/portfolio/portfolio_scenarios.py`）：Beta -10%／-20%、2022 升息與 2020 疫情歷史真實走勢回放、地區與產業曝險、同市場相關係數矩陣、6 種避險方式取捨。
  - 財報與市場預期（`src/company/fundamentals.py`）：台股月營收＋季財報、美股 EPS 預估與上下修、分析師目標價與預期差分類。
- **持股對帳強化**：支援即時價／昨收切換、總成本、帳戶現金、投資金額、已領現金配息與小數碎股（4 位小數）。
- **程式碼架構重整**：`src/` 拆分為 `market/`、`technical/`、`news/`、`backtest/`、`portfolio/`、`journal/`、`company/`、`ai/`、`server/`；前端 `web/vendor/` 本地化支援離線開啟。
- **金鑰與使用者資料持久化**：設定頁直接填寫 `.env` 金鑰（`src/server/env_settings.py`）；持股、交易紀錄、規則與 AI 設定自動同步至 `data/userdata.json` 並每日備份（`src/server/user_data.py`、`web/sync_store.jsx`）。
- **一鍵打包與安裝精靈（`build_web.py`、`build_app.py`）**：esbuild 預編譯 JSX 為 `app.bundle.js`，PyInstaller 產出免安裝 `dist/股票交易分析系統.exe` 與 `dist/股票交易分析系統_Setup.exe`（支援 OneDrive 桌面捷徑、PowerShell UTF-16 建立捷徑、保留舊版 `data/` 與 `.env`）。
- **AI 解讀全面升級**：資深研究主管／交易員報告格式、持股部位自動帶入、「可以這樣問」動態建議問題、Ollama 原生 `/api/chat` 自動擴充 `num_ctx`、NDJSON 即時串流顯示（Streaming 含推理字數進度）、中文單位換算數字核對與 LaTeX 數學符號自動轉可讀符號。

### 5. 2026-10-24 多市場交易規則、盤中指標即時融合、常駐系統匣背景提醒與重大訊息存檔
- **多市場法定稅費與每手股數（`src/market/trade_rules.py`）**：
  - 建立法定稅費表（港股印花稅 0.1% 雙邊+交易徵費、英股 0.5% SDRT、陸股 0.05% 印花稅+費、韓股 0.2% 證交稅、星股清算費），佣金預設 0 並註明未含券商佣金。
  - 每手股數規範：日/陸/星股預設固定 100 股；港股由港交所官方證券名單 `ListOfSecurities.xlsx` 解析每檔標的實際每手股數（本地快取 24 小時），並正確判定免徵印花稅標的。
  - 模擬下單面板（`order_panel.jsx`）與策略回測部位計算（`backtest_engine.py`）嚴格執行每手整數倍買進約束與非整手碎股提示。
- **盤中技術指標即時重算（`src/market/data_adapter.py`）**：
  - 新增 `merge_realtime_bar(bars, quote)` 與 `build_technical_snapshot`：自動比對即時報價日期，若盤中日 K 尚未開出則追加盤中 bar，若已開出則以最新價覆蓋當天 high/low/close/volume。
  - 即時連動 MA5/20/60/200、RSI14、MACD、ATR14 及 100 分趨勢評分，解決盤中指標落後一天的問題。
- **Windows 系統匣常駐背景服務與提醒引擎（`src/server/`、`desktop.py`）**：
  - `alert_engine.py`：後端定時輪詢價格與漲跌幅（每 15 秒）及 RSI（每 5 分鐘），達標發出通知並回寫 `userdata.json`。
  - `notifier.py`：透過 PowerShell 呼叫 Windows 10/11 原生 Toast 通知中心。
  - `tray_icon.py`：純 Win32 ctypes 實作系統匣圖示與右鍵選單（開啟主畫面、暫停/繼續提醒、結束程式）。
  - `autostart.py`：管理 Windows HKCU Run 註冊表開機啟動。
  - `desktop.py`：按 X 時頁面跳出「縮到系統匣／結束程式／取消」（`web/desktop_bridge.jsx`，選擇經 `window.pywebview.api.close_choice` 傳回；頁面沒回應時改用系統對話框）。closing 事件內不得直接 `evaluate_js` 或跳對話框（會卡死視窗執行緒），一律丟到別的執行緒。
  - 結束流程：先隱藏視窗，提醒引擎、系統匣與頁面存檔平行收尾，存檔送出後才關伺服器；4 秒保險計時一定結束。實測視窗 0.1 秒消失、0.4 秒行程結束，最後一筆修改有存到。
  - 避免提醒重複觸發：視窗開著時由頁面檢查，縮到系統匣時才由 `AlertEngine` 檢查；回到前景時頁面從資料檔重新載入提醒。
  - 開機自動啟動帶 `--background`，直接縮在系統匣啟動。Toast 通知借用 PowerShell 的 AppUserModelID（未註冊的自訂 ID 會被 Windows 靜默丟掉）。
  - 畫面縮放（桌面版）：標題列「－ 100% ＋」、設定頁常用比例、Ctrl＋加減號／滾輪、Ctrl＋0。用 WebView2 的 `ZoomFactor`（`DesktopApi.set_zoom`），等同瀏覽器縮放，CSS 寬度跟著改變，響應式版面重新排列不擠壓；比例存在 `tw_us_zoom_v1`。實測 110／125／150% 寬度 1295／1139／949，無橫向捲軸，重開沿用。瀏覽器版用瀏覽器本身的縮放。
  - 啟動預載（`web/boot_loader.jsx`）：載入動畫上逐項顯示並預先抓好伺服器連線、使用者資料、大盤、即時報價、走勢小圖、分時、技術指標總覽（後端快取，進入後不用再等）。每項最多 8 秒、整體最多 15 秒，3 秒後可按「直接進入」；慢的項目在背景繼續抓。
  - 從專案 `dist\`（單一檔案版）或 `dist\股票交易分析系統\`（資料夾版）執行 exe 時，`get_app_dir()` 回傳專案根目錄，與原始碼版共用 `data\`、`.env`、`logs\`；安裝到其他位置的照舊用 exe 所在資料夾（`tests/test_packaging.py`）。
  - 打包資料夾版時會保留 `dist\股票交易分析系統\` 裡的 `data`、`logs`、`.env`（PyInstaller `--noconfirm` 會整個刪掉輸出資料夾）。
  - 設定頁新增「常駐背景提醒與系統匣」管理面板與開關。
- **證交所重大訊息每日存檔與歷史查詢（`src/news/announcement_store.py`）**：
  - 每日將 TWSE OpenAPI 全市場重大訊息自動存檔至 `data/announcements/twse_material_YYYYMMDD.json`，保留 90 天。
  - 查詢個股時自動融合當日最新與本地 90 天累積歷史紀錄並自動去重。
  - 同步支援 Google News 搜尋過去 30 天包含【公告】或重大訊息之新聞來源，解決 OpenAPI 僅有當日的限制。
