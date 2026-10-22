# 台美股 AI 交易分析系統 — 當前開發進度與交接報告 (Continu.md)

> **最後更新時間**：2026-10-20 22:10  
> **系統整體架構**：已完成模組 1～5 Python 全端計算引擎、外部即時行情與匯率 API 串接、LLM 結構化推論防幻覺閘門、本機 REST API Server (`Port 8088`)、以及 **React 18 + Tailwind CSS** 互動式主控台。

---

## 一、目前已達成目標（100% 落地清單）

### 1. React 18 + Tailwind CSS 互動式主控台與即時 API 串接
- **本機運行網址**：[`http://localhost:8088/`](http://localhost:8088/)（由 [`src/api_server.py`](file:///e:/python/trading/src/api_server.py) 同時提供前端與 REST API 服務）
- **主要檔案**：
  - [`web/index.html`](file:///e:/python/trading/web/index.html)：零建置 React 18 + Babel + Tailwind CSS 入口容器。
  - [`web/data.js`](file:///e:/python/trading/web/data.js)：模組 1～5 完整資料字典、預設台美股參數與雙市場制度規格對照表。
  - [`web/app.jsx`](file:///e:/python/trading/web/app.jsx)：React Hooks (`useState` / `useEffect` / `useMemo`) 元件化主控台，內建「🚀 本機 Python 量化引擎 ＋ LLM 防幻覺即時串接測試」面板，可直接呼叫 `/api/mod1/analyze` ～ `/api/mod5/coach`。
  - [`biome.json`](file:///e:/python/trading/biome.json)：完全通過 Biome 2.5.15 靜態語法與 A11y 檢查（0 errors, 0 warnings）。

---

### 1b. 看盤頁與說明導覽（2026-10-20 新增，預設首頁）
- [`web/watch.jsx`](web/watch.jsx)：左側「自選股 / ETF 精選（今日熱門＝即時成交金額；規模/持股人數/殖利率＝靜態參考值）」，右側報價六宮格、委買委賣比例條、五檔、台股（整張/零股・ROD/IOC/FOK・Tick 與漲跌停檢核）與美股（限價/市價・ANY/AON）模擬下單暫存匣、「送入模組 1」、「看資料怎麼抓的」資料來源與抓取紀錄面板、6 步新手導覽與說明頁。
- [`src/quote_provider.py`](src/quote_provider.py)：真實報價。台股＝TWSE MIS（上市 tse_/上櫃 otc_，約延遲 5 秒，含五檔）；美股＝Yahoo Chart API（約延遲 15 分鐘，無五檔）。失敗顯示錯誤、不補假資料；每次請求寫入 `FETCH_LOG`。台股快取 3 秒、美股 30 秒。
- [`src/etf_data.py`](src/etf_data.py)：ETF/個股真實基本面。規模＝TWSE 發行單位數×市價；殖利率＝Yahoo 近 12 月實際配息÷現價；定期定額戶數＝TWSE ETFRank（僅前 20 名）；前十大成分股＝Yahoo topHoldings；Beta＝近 1 年日報酬 vs ^TWII/^GSPC 自算。快取 6 小時，取不到回傳 None（不填假數字）。[`src/etf_reference.py`](src/etf_reference.py) 只剩候選代號 `ETF_POOL`。
- 新增 API：`POST /api/quotes`、`GET /api/etf`、`GET /api/fetchlog`。頂部自選股跑馬燈已改用真實報價。

### 2. Python 全端量化與串接引擎 (`src/`)

| 檔案名稱 | 對應模組與核心職責 |
| :--- | :--- |
| [`src/data_adapter.py`](file:///e:/python/trading/src/data_adapter.py) | • 雙市場代號正規化 (`normalize_symbol`)<br>• 串接 Yahoo Finance v8 Chart API 與 FinMind API 抓取台美股真實還權日 K 線<br>• 即時抓取 `USD/TWD` 匯率 (`LIVE_YAHOO_FX`)，並具備確定性離線回退機制 |
| [`src/llm_runner.py`](file:///e:/python/trading/src/llm_runner.py) | • 支援 Google Gemini API / OpenAI API 結構化 JSON 推論與本地量化規則引擎保底<br>• 強制串接 [`AntiHallucinationGuard`](file:///e:/python/trading/src/anti_hallucination.py#L13-L80) 審計支撐壓力邊界與量化失效條件 |
| [`src/api_server.py`](file:///e:/python/trading/src/api_server.py) | • 整合靜態網頁與 `/api/health`、`/api/mod1/analyze`、`/api/mod2/news`、`/api/mod3/backtest`、`/api/mod4/risk`、`/api/mod5/coach` REST API |
| [`src/indicators.py`](file:///e:/python/trading/src/indicators.py)<br>[`src/market_rules.py`](file:///e:/python/trading/src/market_rules.py)<br>[`src/anti_hallucination.py`](file:///e:/python/trading/src/anti_hallucination.py) | • 模組 1：程式端預先算好 SMA(5/20/60/200)、RSI(14)、MACD、ATR(14)、Swing 高低點<br>• 台股法定 6 級 Tick Size 對齊器與 0.1425% 手續費 + 0.3% 證交稅計算 |
| [`src/news_strategy.py`](file:///e:/python/trading/src/news_strategy.py) | • 模組 2：新聞時段分類 (PRE/REGULAR/POST)、事件前 5/20 日漲跌幅 Priced-in 檢定、±10% 波動上下限、失效條件量化檢查 |
| [`src/backtest_engine.py`](file:///e:/python/trading/src/backtest_engine.py) | • 模組 3：強制 `Next Bar Open` 隔日開盤價撮合（零偷看未來數據）、四大指標與 <30 筆過度擬合警示 |
| [`src/portfolio_risk.py`](file:///e:/python/trading/src/portfolio_risk.py) | • 模組 4：跨幣別即時匯率折算、穿透式 ETF (0050/QQQ) 曝險拆解、再平衡 100.0% 權重守恆驗算、大盤 -20% 壓力測試 |
| [`src/journal_coach.py`](file:///e:/python/trading/src/journal_coach.py) | • 模組 5：賺賠比統計、出場後 5 日賣飛追蹤、處置效應與報復性交易編號鎖定 (#03, #08)、3 條量化個人守則 |

---

### 3. 自動化測試與靜態檢查結果
- **單元與端到端串接測試** ([`tests/test_core.py`](file:///e:/python/trading/tests/test_core.py)、[`tests/test_modules.py`](file:///e:/python/trading/tests/test_modules.py)、[`tests/test_integration.py`](file:///e:/python/trading/tests/test_integration.py))：
  ```bash
  python -m unittest discover -v tests
  Ran 18 tests — OK (100% 通過，含 tests/test_quotes.py)
  ```
- **Biome 靜態檢查**：
  ```bash
  npx @biomejs/biome check .
  Checked 5 files in 30ms. No fixes applied. (0 errors, 0 warnings)
  ```

---

### 4. 2026-10-22 資料更新修正與 100 分趨勢評分
- 修正：Yahoo 收盤後一段時間會把最新一根日 K 回傳為 None，原本整根被丟掉 → 美股技術分析比報價慢一天。現以 meta 當日價補上（僅限 meta 時間 ≥ 該 K 棒）。
- 修正：上櫃股（如 6488）日 K 只查 `.TW` 會 404，落到 FinMind（T+1，缺當日）。現自動改查 `.TWO`。
- 新增 [`src/trend_score.py`](src/trend_score.py)：參考 liusai0820/Stock-Analysis-Skill 的六維度 100 分評分（趨勢30/乖離20/MACD15/量能15/RSI10/支撐10）。RSI≥80、MA5 乖離>5% 不買由程式強制（AI 給 BUY 會被合理性檢查擋下）；盤中量能未收齊時量能給中性分。規則引擎的 BUY/HOLD/SELL 改由評分訊號決定，技術分析頁顯示評分卡。測試：`tests/test_trend_score.py`。

### 5. 2026-10-22 籌碼面板（只顯示，不納入評分）
- [`src/chip_data.py`](src/chip_data.py) + `POST /api/chips`：FinMind 三大法人（股→張）、融資融券（張）、外資持股比，近 5／20 日加總、連續買賣超天數、券資比、白話觀察。T+1，只有台股；快取 1 小時（每檔每小時 3 次請求）。技術分析頁的 `ChipPanel` 顯示。測試：`tests/test_chip_data.py`。
- 請求額度：FinMind 免費 300 次／小時（註冊 token 600），超過回 402；短時間大量 4xx 會被封 IP 30 分鐘。
  - 所有 FinMind 呼叫改走 [`src/finmind.py`](src/finmind.py)：收到 402 暫停 30 分鐘、403 暫停 31 分鐘，期間不送請求；狀態在 `/api/health` 的 `finmind` 欄位。
  - FinMind token 存在本機 `.env`（gitignore），`run_server` 啟動時以 `load_env_file()` 載入；以 Authorization 標頭送出（不放網址，避免出現在前端抓取紀錄）。已驗證免費會員額度 600 次／小時。
  - 日 K（Yahoo 與 FinMind）加 60 秒快取，失敗也快取。實測技術分析頁 1 分鐘（12 次分析）對外請求：6488 由 51 → 4、2330 由 27 → 3、NVDA 由 26 → 3。測試：`tests/test_rate_limits.py`。

### 6. 2026-10-22 全系統 review 後修正（高優先 1～3）
- 支撐／壓力：改由 `data_adapter.classify_levels()` 依「現價」分類（低於現價＝支撐、高於＝壓力，各取最近 3 個；創新高／新低時以現價 ± 2×ATR 推估並標示 `level_notes`）。即時報價覆蓋最新價後 `reclassify_levels()` 會重新分類。原本取「價位最高的 3 個波段點」，導致目標價低於現價、支撐高於現價。
- 規則引擎價位：BUY／HOLD 保證 停損 < 進場 < 目標（最近支撐在 1 ATR 內才掛支撐，否則用現價；目標跳過離現價不到 0.5 ATR 的壓力）。SELL＝賣出／減碼：進場＝現價、`stop_loss_price`＝空方失效價（上方）、`take_profit_target`＝下檔目標（下方），失效條件改為「收盤站回…」。AI 合理性檢查、提示詞、技術分析頁（決策卡與持股損益卡）同步改用 SELL 語意。
- ETF 穿透：ETF 本身權重拆成成分股、前十大以外列為「<ETF> 其他成分股」，合計 100%（原本重複計算到 105%）；`.TWO` 代號也會去尾。前端依曝險排序，「其他成分股」不顯示單一實體集中警示。
- 組合風控：沒有有效持股（無代號／股數 ≤ 0）時回 400 與白話訊息，前端直接提示並清掉舊結果；Beta 非數字也回 400。API 對 `ValueError` 一律回 400。
- 測試：`tests/test_levels_and_risk.py`（共 74 個測試通過）。

### 7. 2026-10-22 中優先修正（4～8）與 AI 任務
- 提醒：判斷引擎改成 `AlertWatcher` 掛在 App 上，任何分頁都會檢查（報價每 10 秒、RSI 每 5 分鐘）；看盤頁只負責顯示／編輯，提醒與觸發紀錄透過 `alerts-changed` 事件全站同步。
- 漲跌幅提醒一律填正數（「今日跌幅 ≥ 3」＝跌 3% 以上；舊的負數資料相容），輸入框依條件顯示範例，並檢查範圍。
- 交易編號：`nextTradeId()`（最大編號 + 1）取代「筆數 + 1」，模擬成交、CSV 匯入、手動新增共用；讀取時自動修正舊資料的重複編號。
- 輸入錯誤：`arg_num()`／`arg_ticker()` 回白話訊息（HTTP 400）；空白代號不再默默改分析 2330；回測長均線 ≤ 短均線直接提示（以前自動改參數）。
- 查無代號：基本資料回「查無 X 的資料」；籌碼對非台股說「不是台股代號」、台股代號查無資料標示 `empty`；美股報價 404 改說「查無此代號」。
- AI 解讀（各頁底部）：任務改放全站 store，換頁不會中斷、結果保留；不在該頁時完成會跳提示。
- 推論引擎：技術分析頁「推論引擎」標示改看 `LIVE*`（含環境變數直連）；舊的 GEMINI／OPENAI 環境變數直連只在明確指定 provider 時使用，且一樣過 AI 合理性檢查（選「內建規則引擎」時不會偷偷呼叫 AI）。
- 測試：`tests/test_input_errors.py`（共 80 個）。

### 8. 2026-10-22 低優先修正（9～15）
- 回測：本金標示幣別（台股 TWD／美股 USD），結果顯示幣別；回應新增 `currency`。
- 匯出：開啟時才組資料；內容含技術分析＋籌碼、新聞、回測（去掉逐筆明細）、組合風控（Beta、壓力測試、歷史回落、穿透）、交易檢討、我的持股與交易紀錄；可下載 `.md` 摘要與 `.json` 完整資料（檔名用本地時間），複製失敗會提示。
- 匯率：抓不到時沿用最後一次成功的匯率（標示時間），從未成功才用 32.15；`fx_warning` 會顯示在看盤持股與組合風控。
- 設定「資料管理」：列出全部 10 項瀏覽器資料與筆數，清除立即生效；新增「下載備份／從備份還原」（換電腦用，含 AI 金鑰）。
- 新聞：新增 [`src/market_calendar.py`](src/market_calendar.py)（過去日期看有沒有日 K；今天以後台股用證交所 holidaySchedule、美股用 NYSE 規則計算），非交易日時段為 `CLOSED`；失效條件出現「關鍵支撐／支撐價位」等參考點卻沒有價位數字時不通過；沒填失效條件時用現價附近真實支撐／壓力產生。
- Windows：新增 [`src/tz.py`](src/tz.py)，沒有 tzdata 時用內建規則（台北 UTC+8、美東日光節約），與 zoneinfo 比對 2007–2035 年 36,316 個時間點全部一致。
- 債券 ETF：技術分析時以 `stock_info.classify` 判斷，債券的趨勢評分標示「不適用（債券）」、訊號固定持有，畫面顯示原因。
- 測試：`tests/test_low_priority.py`（共 91 個）。

### 9. 2026-10-22 多市場支援（港、日、韓、陸、英、德、加、澳、星）
- [`src/markets.py`](src/markets.py)：依 Yahoo 代號後綴判斷市場（無後綴＝美股、.TW/.TWO 台、.HK 港、.T 日、.KS/.KQ 韓、.SS/.SZ 陸、.L 英、.DE 德、.TO 加、.AX 澳、.SI 星），記錄預設幣別、時區、交易時段（含午休）、Beta 用大盤指數。港股代號自動補 4 位（700.HK→0700.HK）。台股以外的 `raw_code` 保留後綴，前端 `baseCode()` 也只去掉台股後綴，避免 7203.T 與 7203 撞號。
- [`src/fx.py`](src/fx.py)：任何幣別換台幣（Yahoo `{幣別}TWD=X`，快取 5 分鐘，失敗沿用上次成功值）；英股 GBp（便士）＝ GBP ÷ 100；`/api/fx` 給看盤頁持股損益用。`fetch_usd_twd_rate()` 改呼叫 fx。
- 報價幣別以 Yahoo 回傳為準；日 K 日期用交易所當地日期（gmtoffset，修正澳股會差一天）；即時價覆蓋 K 棒用 `quote_date_local` 比對。
- 組合風控：每檔持股依自己的幣別換算台幣（`fx_rates` 回傳各幣別匯率），市場依代號自動判斷（前端改為顯示旗幟＋市場＋幣別）；Beta 對各自市場大盤，混合市場會註明壓力測試為粗估；歷史回落各幣別用目前匯率換算。
- 新聞時段、盤中判斷、時區後備（tz.py 加入歐洲／澳洲日光節約規則，11 個時區與 zoneinfo 比對全部一致）都改讀 markets.py。
- 已知限制：台美股以外沒有內建假日表（今天以後只排除週末，過去日期看有沒有日 K）；其他市場的手續費／印花稅沿用美股規則（回測摩擦成本不精確）；港、日、陸、星股每手股數未檢核；報價依交易所規定可能延遲 15–20 分鐘。
- 測試：`tests/test_multi_market.py`（共 101 個）。

### 10. 2026-10-22 AI 用量與費用估算
- 後端：`ai_client.record_usage()` 在每次呼叫 AI 後取出供應商回報的 tokens（Gemini `usageMetadata`，思考 tokens 算輸出；Claude／OpenAI 相容 `usage`，Claude 快取讀寫算輸入），以執行緒區分每個請求，`api_server._with_usage()` 附在回應的 `ai_usage`（含錯誤回應）。環境變數直連路徑也有記錄。伺服器不保存。
- 前端：`ai_store.jsx` 攔截所有 `/api/` 回應記錄用量（瀏覽器 `tw_us_ai_usage_v1`，最多 2000 筆）；單價存在 `tw_us_ai_prices_v1`（美元／每百萬 tokens）。設定頁「AI 用量與費用」顯示今天／本月／全部的次數、tokens、估算費用（含台幣換算）、各模型單價、最近 20 次；本地模型預設免費，雲端沒填單價的會標示「未計入」。各頁「AI 解讀」結果下方顯示該次 tokens 與費用。
- 測試：`tests/test_ai_usage.py`（共 106 個）。

### 11. 2026-10-22 AI 補充資料、操作紀錄、K 線縮放
- AI 回答片面的原因：各頁「AI 解讀」只收到當頁的一張指標快照（技術分析約 2,000 字元、新聞約 660 字元），沒有價格歷程、籌碼、評價、新聞、大盤，且提示詞要求「精簡」。新增 [`src/ai_context.py`](src/ai_context.py)：技術分析／基本資料的 AI 解讀會另外附上價格走勢（5～250 日報酬、距 52 週高低）、籌碼、基本面與評價、近期新聞（公告與相關標題優先）、該市場大盤趨勢；新聞判斷附價格走勢、新聞、大盤。技術分析「AI 決策」也附精簡摘要（只有真的呼叫 AI 才抓）。提示詞改為多面向結構（結論、技術、價格位置、籌碼、評價、消息、大盤、多空理由與矛盾、觀察條件、風險），缺資料要寫「資料不足」。資料清掉重複欄位、上限 24,000 字元且截斷會明講。
- 操作紀錄：[`web/activity_log.jsx`](web/activity_log.jsx) 記錄點擊（只記按鈕名稱）、選單、換頁、API 呼叫（輪詢型只記失敗）、前端錯誤與畫面提示；瀏覽器保留 3000 筆，每 10 秒送到 `/api/log`，由 [`src/activity_log.py`](src/activity_log.py) 寫成 `logs/activity-YYYYMMDD.jsonl`（gitignore、保留 30 天、過濾金鑰欄位），伺服器自己的 API 錯誤／重要請求也寫進去（含舊版伺服器的 Route not found）。設定頁「📝 操作紀錄」可看本機／伺服器、只看錯誤、下載、清除。
- K 線：技術分析一次拿最多 500 根日 K／104 根週 K（含 MA60），圖表在前端縮放平移：滾輪（以游標為中心）、拖曳、手機兩指、1M／3M／6M／1Y／全部、＋／－、回到最新、雙擊還原、「⛶ 放大」全螢幕（Esc 關閉）、範圍位置條；可見範圍內自動調整 Y 軸，十字準星改用游標位置計算。
- 測試：共 108 個。

## 二、待優化清單（尚未完成）
1. 模組 1 指標（MA/RSI 等）盤中仍用未覆蓋的日 K 計算；週線只有 MA/RSI/MACD 摘要，沒有週線版的買賣決策。
2. 無「內外盤」真實資料來源（用五檔委買/委賣量比例代替）；ETF「規模」是市值估算、戶數只有前 20 名、成分股只有前十大；00849B 查無規模。
3. 前端依賴 CDN（Tailwind/React/Babel，版本已固定）離線無法使用；`pages/watch.jsx` 仍約 1000 行可再拆（持股面板）。
4. 提醒只在網頁開著時運作（沒有背景服務推播）；歷史回落重演假設持股數量與匯率不變。
5. 新聞：台股只有 Google News + 證交所「當日」重大訊息（上櫃無公開 JSON）；情緒方向仍由使用者判斷。SEC 8-K 需要網路可連 sec.gov。
6. 指標與 TradingView 交叉驗證、防幻覺連續 10 次測試、模組 5 規則回寫到模組 1/4 提醒（閉環）尚無自動化驗證。
7. 規格書編號為模組 2～6，專案內為 1～5，尚需對照表。
8. `__pycache__` 仍被 git 追蹤（依指示未動 git）。

---

## 三、目前架構（2026-10-20 更新）
```
python run.py（或 啟動.bat）→ src/api_server.py（127.0.0.1:8088，靜態檔 + REST）
src/
  api_server.py     路由與各模組調度（/api/quotes /indices /intraday /sparks /etf /fetchlog /mod1~5 /health /tests/run）
  quote_provider.py 即時報價：TWSE MIS(台股,五檔) / Yahoo(美股) + 抓取紀錄 + 逐檔快取
  chart_data.py     大盤指數、當日分時(5m)、迷你走勢、52 週高低、自選股技術總覽（Yahoo）
  news_feed.py      模組 2 真實新聞：Google News / Yahoo / 證交所重大訊息 / SEC 8-K
  stress.py         歷史回落重演（持股回推約 2 年的最大回撤與最差 20 日）
  etf_data.py       ETF 規模/殖利率/戶數/前十大成分股/Beta（TWSE OpenAPI + Yahoo，快取 6h）
  data_adapter.py   日 K（Yahoo→FinMind）；查不到預設報錯（TRADING_ALLOW_SAMPLE=1 才用假資料）
  indicators / market_rules / anti_hallucination / llm_runner
  news_strategy / backtest_engine / portfolio_risk / journal_coach   模組 2~5
web/（React18+Tailwind，CDN 已固定版本，免建置；用 window.TA 共享）
  index.html        依序載入：data.js → config → charts → panels/* → ui → live_widgets → pages/* → app
  app.jsx (~570行)  App 外殼：分頁列、大盤指數列、全域狀態與處理函式
  config.jsx        NAV_ITEMS、預設範例資料
  charts.jsx        K 線圖、淨值曲線
  ui.jsx            共用工具（格式化、localStorage、台股檔位、Tip/Stat）
  live_widgets.jsx  Sparkline、RangeBar、IntradayChart、IndexBar
  pages/            watch.jsx（看盤）、watch_parts.jsx、order_panel.jsx（模擬下單）、overview_alerts.jsx（技術總覽+提醒）、guide.jsx（說明/導覽）
  panels/           mod1~5.jsx、visual_tests.jsx（各分頁面板，用 ctx 取得 App 狀態）
tests/              32 個 unittest；前端檢查：npx @biomejs/biome check web
```
- 看盤頁：自選股（迷你走勢、價格閃色、排序、↑↓ 與 / 快捷鍵）、ETF 精選、我的持股（成本/損益/CSV 匯入，可送去模組 4）、當日分時圖、今日/52 週區間條、五檔、模擬下單。
- 啟動說明見 [README.md](README.md)。
- 2026-10-20 順手修復：模組 5 欄位名不一致造成 500/白屏、模組 4 壓力測試與再平衡欄位顯示空白（並補上再平衡表）。
- 2026-10-20 新增：週線切換（日線聚合還權）、價格/漲跌幅/RSI 提醒、自選股技術總覽、模組 2 真實新聞與事件前後價格反應、模組 4 歷史回落重演；模組 1 顯示完整決策（委託別/進場/停損/目標/逐步理由），模組 2 欄位對齊。
- 說明頁（pages/candle_guide.jsx、strategy_guide.jsx）：K 線圖解與單根型態、大盤最近 15 根日 K 實例（/api/candles）、互動式還權 K 線與成交量副圖讀圖說明、7 種基本交易策略卡、紀律清單、停損股數算法、擴充名詞辭典。
- 2026-10-21：介面改成左側可收合導覽（行情／分析／風控與檢討／系統），頁面標題只顯示名稱不再有「模組 N」；新增 ⚙️ 設定頁（全系統共用的 AI 連線：Gemini／OpenAI／Claude／本地或自架 OpenAI 相容服務如 Ollama、LM Studio，可測試連線與取得模型清單、可設定 AI 作用範圍、可清除本機資料）；各分頁底部新增「AI 解讀」（`src/ai_client.py`，會標出回答中不在系統資料內的數字）；自選股可依 股票／ETF／債券 篩選，標的新增「基本資料與配息」分頁（除息日、發放日、配息頻率、常見月份、下一場公告或推測、前十大成分股，`src/stock_info.py`）與「📅 配息月曆」。
- AI 金鑰只存瀏覽器 localStorage，隨請求送到本機伺服器轉送，伺服器不保存；規則引擎永遠是預設，不設定 AI 也能用。
- 2026-10-21：設定頁新增「本機偵測到的模型」（/api/ai/detect 掃描 Ollama/LM Studio/llama.cpp/vLLM 實際安裝的模型，一鍵新增並使用）。
- 2026-10-21：AI 真實化稽核：技術分析決策（主動查詢時才呼叫 AI，需通過價位+委託別+停損目標順序+失效條件+數字來源檢查，否則退回規則引擎並顯示原因；AI 模式不再每 5 秒自動刷新）、新聞判斷可「改由 AI 判斷情緒」、交易檢討 3 條規則由 AI 依真實統計產生（需為含數字門檻的可讀中文規則，否則退回固定範本並標示）、各頁 AI 解讀標示資料是真實或範例。本地思考型模型預設送 reasoning_effort=none。移除未使用的 web/data.js 載入（檔案保留）。畫面上「AI」字樣只在真的由 AI 產生時出現。
- 2026-10-21：跨頁連動：web/portfolio_store.jsx 共用「我的持股／交易紀錄／交易規則」。看盤模擬下單可「成交」（買進→持股、賣出→交易紀錄），持股列可一鍵「賣出」；組合風控預設帶入我的持股；交易檢討預設分析我的交易紀錄（可 CSV 匯入，損益/持有天數/出場後 5 日最高價由後端用真實日 K 計算），產生的 3 條規則同步到下單面板（全部勾選才能下單）、技術分析與組合風控；技術分析可「回測這檔」；策略回測顯示資料來源與「模擬成交」說明。
- 2026-10-21：技術分析 × 我的持股（持股卡：成本、未實現、停損／目標時部位賺賠、一鍵切換分析持股、跳回看盤處理）；看盤持股列新增「分析」。新手導覽改寫為 17 步並會自動切頁、切換看盤左右分頁、框出對應區塊（pages/tour.jsx，data-tour 錨點）；說明頁新增「功能怎麼串在一起」流程，可點去該頁或從該步開始導覽。
