# 台美股 AI 交易分析系統 — 當前開發進度與交接報告 (Continu.md)

> **最後更新時間**：2026-10-19 19:55  
> **系統整體架構**：已完成模組 1～5 全面落地、Python 核心計算引擎、單元測試 100% 通過、以及本機互動式檢核主控台 Web App。

---

## 一、目前已達成目標（100% 落地清單）

### 1. 互動式檢核主控台 (Web App)
- **本機預覽網址**：[`http://localhost:8088/`](http://localhost:8088/)（由背景服務持續運行中）
- **主要檔案**：
  - [`web/index.html`](file:///e:/python/trading/web/index.html)：全面校正為**模組 1 至 模組 5**，包含：
    - **View 0 流程架構＆交接總覽**：雙技術路線說明、四層閉環流程架構圖、5 大模組分類與核心測向一覽表。
    - **View 1 模組開發主控台 (1～5)**：各模組之「怎麼設定 (Setup)」、「開發檢查 (Checklist)」、「怎麼驗證 (Verification)」、「提示詞與測試沙盒 (Prompt Sandbox)」。
    - **View 2 台美股底層規格對照**：8 大市場差異（代號、單位、Tick Size、稅費、交割 T+1/T+2、波動限制、盤前盤後、還權調整）。
    - **View 3 全域檢查與驗收總表**：全域 45 項檢查追蹤、支援新增自訂檢核項、一鍵標記完成。
    - **View 4 系統架構與落地路線圖**：4 週敏捷推進計畫、建議專案目錄結構、`market_router.py` 雙市場路由核心程式碼。
  - [`web/style.css`](file:///e:/python/trading/web/style.css)：深色高質感金融終端設計。
  - [`web/app.js`](file:///e:/python/trading/web/app.js)：本地儲存 (LocalStorage)、打勾狀態持久化、進度即時計算、Markdown 報告自動生成。
  - [`biome.json`](file:///e:/python/trading/biome.json)：完全通過 Biome 2.5.15 靜態語法檢查（0 errors, 0 warnings）。

---

### 2. Python 核心計算引擎（純 Python 標準庫，零外部肥大依賴）
已落地的 5 大模組底層邏輯與演算法庫：

| 模組編號 | 核心實作檔案 | 核心功能實作摘要 |
| :--- | :--- | :--- |
| **模組 1：自動化技術分析師** | [`src/indicators.py`](file:///e:/python/trading/src/indicators.py)<br>[`src/market_rules.py`](file:///e:/python/trading/src/market_rules.py)<br>[`src/anti_hallucination.py`](file:///e:/python/trading/src/anti_hallucination.py) | • 程式端預算 SMA(5/20/60/200)、RSI(14)、MACD、ATR(14)，禁止 AI 心算<br>• 波段高低點 (Swing High/Low) 支撐壓力識別<br>• 台股法定 6 級 Tick Size 價格對齊器 (`align_tw_tick`)<br>• 0.1425% 手續費與 0.3% 證交稅計算<br>• 防價格幻覺邊界檢查器 (`AntiHallucinationGuard`) |
| **模組 2：新聞轉交易策略** | [`src/news_strategy.py`](file:///e:/python/trading/src/news_strategy.py) | • 新聞時間戳記正規化（嚴格區分盤前 PRE、盤中 REGULAR、盤後 POST）<br>• 事件前 5 日／20 日漲跌幅注入，自動判定是否「已反映 (Priced-in)」<br>• ATR 預期波動區間計算（台股嚴格約束在法定 ±10% 限制內）<br>• 強制量化失效條件驗收（拒絕空泛心態詞彙，必須有具體數字價位） |
| **模組 3：交易策略回測分析師** | [`src/backtest_engine.py`](file:///e:/python/trading/src/backtest_engine.py) | • 訊號成立隔離機制（強制以 Next Bar Open 隔日開盤價撮合，零偷看未來數據）<br>• 四大指標公式數學對齊：勝率、獲利因子 (Profit Factor)、最大回撤 (MDD)、平均報酬<br>• 扣除台股 0.3% 證交稅真實成本<br>• 總交易次數 < 30 筆過度擬合警示<br>• 自動提取虧損最大前 5 筆交易背景 |
| **模組 4：投資組合風險管理** | [`src/portfolio_risk.py`](file:///e:/python/trading/src/portfolio_risk.py) | • 跨幣別市值換算器（自動抓取 USD/TWD 匯率換算真實持倉權重）<br>• 穿透式 ETF 曝險拆解（拆解 0050 內含 54% 台積電並與個股累加）<br>• 252 日日報酬皮爾森相關係數矩陣 (Correlation Matrix) 與組合加權 Beta<br>• 再平衡方案目標權重守恆驗收（加總嚴格等於 100.0%）<br>• 大盤下跌 20% 壓力測試與散戶微台指 / 反向 ETF 避險試算 |
| **模組 5：交易日誌分析師** | [`src/journal_coach.py`](file:///e:/python/trading/src/journal_coach.py) | • 20 筆對帳單結構化解析與統計（勝率、平均獲利、平均虧損、賺賠比）<br>• 出場後 5 日表現追蹤（自動標記賣出後續漲 > 5% 的「過早賣飛」）<br>• 行為偏誤客觀證據鎖定：精準抓出「處置效應 (賺小賠大)」與「報復性翻倍交易」，並點名交易編號 (#03、#08)<br>• 自動制定 3 條個人化硬性守則（回寫模組 1 與模組 4 閉環） |

---

### 3. 單元測試與自動化驗收
- **測試檔案**：
  - [`tests/test_core.py`](file:///e:/python/trading/tests/test_core.py)：模組 1、模組 3 核心指標、Tick 對齊、防偷看撮合測試。
  - [`tests/test_modules.py`](file:///e:/python/trading/tests/test_modules.py)：模組 2 新聞波動限制、模組 4 穿透式曝險與權重 100% 守恆、模組 5 偏誤偵測與 #編號綁定。
- **執行結果**：
  ```bash
  python -m unittest discover tests
  .........
  Ran 9 tests in 0.001s
  OK (全數 100% 通過)
  ```

---

## 二、專案目錄結構現狀

```text
E:\python\trading\
├── .gitignore               # 已排除 pycache、pyc、node_modules
├── biome.json               # 程式碼格式化與 Linter 配置 (通過檢查)
├── Continu.md               # 本開發進度與交接說明檔案
├── src/                     # Python 核心運算引擎
│   ├── indicators.py        # 模組 1: MA, RSI, MACD, ATR, Swing
│   ├── market_rules.py      # 模組 1/3: 台美股市場規範、Tick 對齊、稅費
│   ├── anti_hallucination.py# 模組 1/2: 防價格幻覺檢查器
│   ├── news_strategy.py     # 模組 2: 新聞時段、Priced-in、波動限制、失效條件
│   ├── backtest_engine.py   # 模組 3: Next Bar Open 回測、四大指標、警示
│   ├── portfolio_risk.py    # 模組 4: 跨幣別換算、穿透式曝險、相關係數、-20%避險
│   └── journal_coach.py     # 模組 5: 20筆帳單統計、偏誤鎖定編號、3條守則
├── tests/                   # 單元測試集 (100% PASS)
│   ├── test_core.py
│   └── test_modules.py
└── web/                     # 互動式主控台 Web App (http://localhost:8088)
    ├── index.html
    ├── style.css
    └── app.js
```

---

## 三、隨時可接續的下一步任務 (Next Steps)

若要繼續往下推進實盤對接，可從以下任一方向著手：
1. **外部 API 真實串接層 (Data Ingestion Adapter)**：
   - 台股：串接 FinMind API 或永豐 Shioaji 抓取 2330 / 0050 最新還權 K 線。
   - 美股：串接 yfinance 或 Polygon 抓取 NVDA / QQQ 最新報價。
2. **大語言模型 API 對接 (LLM Runner)**：
   - 串接 OpenAI (GPT-4o) 或 Google Gemini API，將 `src/` 算好的客觀 JSON 數據自動注入 Prompt，驗證真實 LLM 產出的結構化決策。
3. **對外 Git 遠端倉庫推送**：
   - 目前所有變更已在本地 Git 倉庫完成版本控制。若提供 GitHub / GitLab 遠端 URL，可直接執行 `git push` 上傳。
