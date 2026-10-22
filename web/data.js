// 台美股 AI 交易分析系統 — 模組 1～5 完整資料字典與架構範本 (data.js)
// 供 React 主控台元件 (app.jsx) 引用

window.MODULES_DATA = [
  {
    id: 1,
    code: 'MODULE 01',
    shortName: '1. 自動化技術分析師',
    title: '1. 自動化技術分析師 (Automated Technical Analyst)',
    subtitle:
      '用日線與週線拆解趨勢和關鍵價位，依序整理支撐壓力、趨勢線、關鍵均線與動能指標，並提供「買進／觀望／賣出」的判斷流程與逐步理由。',
    apiEndpoint: '/api/mod1/analyze',
    originalPromptTemplate: `請使用日線圖與週線圖分析【{ticker}】，並依序整理：
→ 支撐與壓力區間
→ 主要趨勢線
→ 關鍵移動平均線
→ 動能指標的變化
最後提供「買進／觀望／賣出」的判斷流程，並逐步說明理由。`,
    engineeredPromptTemplate: `你是一位專精於台股與美股的資深量化技術分析師。請根據以下系統傳入的【{ticker}】（市場：{market}）最新日線（Daily）與週線（Weekly）客觀數據進行結構化拆解：

【系統注入之客觀行情與指標數據】
- 最新收盤價與近期高低點：{price_context}
- 關鍵移動平均線（MA5 / MA20 / MA60 / MA200）：{ma_context}
- 動能與波動指標（RSI14 / MACD / KD / ATR）：{momentum_context}

請嚴格依據上述數據（禁止自行捏造未提供的價位），依序輸出：
1. 【支撐與壓力區間】：分別列出週線級別（中期）與日線級別（短期）的 2 道關鍵支撐區間與 2 道壓力區間，並說明該區間是由前波高低點、跳空缺口或均線共振所形成。
2. 【主要趨勢線】：判定目前週線與日線處於「上升趨勢、下降趨勢或區間盤整」，並標出趨勢線破壞的關鍵價位。
3. 【關鍵移動平均線】：分析目前股價與短中長期均線的排列關係（多頭排列／空頭排列／糾結）、乖離率是否過大，以及均線扣抵方向。
4. 【動能指標的變化】：解讀 RSI、MACD 柱狀體與 KD 是否出現黃金／死亡交叉、高檔鈍化或頂底背離訊號。
5. 【買進／觀望／賣出 判斷流程】：給出明確的決策樹（Decision Tree）——
   - 觸發「買進」的確切價位條件與建議委託方式（台股請註明限價 ROD 或突破 IOC；美股請註明 Limit 或 Stop-Limit）
   - 維持「觀望」的震盪區間範圍
   - 觸發「賣出／停損」的防守價位，並逐步說明每一步的邏輯理由。`,
    presets: {
      tw: {
        ticker: '2330.TW 台積電',
        market: '台股 TWSE (整張 1000 股 / 最小跳動 5 元)',
        price_context:
          '現價 2420 元（今日下跌 20 元 / -0.82%），近 20 日高點 2485 元、近 20 日低點 2360 元；週線前波頸線支撐 2350 元',
        ma_context:
          '日線 MA5=2432、MA20=2405、MA60=2310、MA200=2080；週線 20MA=2290（均線呈多頭排列但短線跌破 5 日線）',
        momentum_context:
          '日線 RSI(14)=54.2（自 68 回落）、MACD 紅柱收斂接近零軸、ATR(14)=38 元；週線 MACD 維持多頭開口',
      },
      us: {
        ticker: 'NVDA (NVIDIA Corp.)',
        market: '美股 NASDAQ (最小單位 1 股 / 最小跳動 $0.01)',
        price_context:
          '現價 $138.60，盤前高點 $140.20，前波歷史高點壓力 $143.71，近期缺口支撐 $131.50～$133.00',
        ma_context:
          '日線 EMA20=$134.10、SMA50=$126.80、SMA200=$108.40；週線守穩 10 週均線 ($130.50) 之上',
        momentum_context: '日線 RSI(14)=61.8，MACD 快線於零軸上方再次黃金交叉，日均 ATR(14)=$4.65',
      },
    },
    inputFields: [
      { key: 'ticker', label: '標的／代號' },
      { key: 'market', label: '市場與交易規則註記' },
      { key: 'price_context', label: '近期高低點與現價數據' },
      { key: 'ma_context', label: '關鍵移動平均線數值 (日線/週線)' },
      { key: 'momentum_context', label: '動能指標數值 (RSI/MACD/ATR)' },
    ],
    setup: {
      twSources: [
        '歷史與日週 K 線：FinMind API (TaiwanStockPriceAdjusted 還權股價)、yfinance (2330.TW)',
        '即時五檔與分時報價：永豐金 Shioaji API、富邦新一代 API 或 Fugle 富果行情 API',
        '台股特殊設定：需載入證交所股價升降單位表（Tick Size，如 1000 元以上每檔 5 元）與除權息還權因子',
      ],
      usSources: [
        '歷史與日週 K 線：Polygon.io REST API、Alpaca Market Data API 或 yfinance',
        '盤前／盤後與即時報價：Alpaca WebSocket 或 TradingView Webhook 訊號串接',
        '美股特殊設定：必須開啟 Adjusted=True（自動處理拆股與配息），並支援盤前 (Pre-market) 與盤後高低點標記',
      ],
      pythonSteps: [
        '在 Python 端 (src/indicators.py) 用還權日 K 與週 K 算出精確的 MA(5, 20, 60, 200)、RSI(14)、MACD(12, 26, 9) 與波段高低點。',
        '切勿只把股票代號丟給 LLM 讓它憑記憶猜價格！務必先由 Python 算出最新數值 JSON，再填入 Prompt 模板送交 API。',
        '透過 AntiHallucinationGuard 強制檢驗模型回傳之支撐壓力與失效條件。',
      ],
      agentSteps: [
        '在 Dify / n8n 或 Make 建立工作流：Node 1 為 HTTP Request 節點，呼叫 Yahoo Finance 或 FinMind 取得最近 250 根日線資料。',
        'Node 2 使用內建 Code 節點計算最近 20 日高低點、MA20/MA60 與 RSI14 數值摘要。',
        'Node 3 將數值摘要綁定至 LLM 節點（設定 Temperature = 0.1 降低隨機性），輸出標準化技術分析報告。',
      ],
      schema: `{
  "symbol": "2330.TW",
  "market": "TW",
  "timeframes": {
    "weekly_trend": "BULLISH",
    "daily_trend": "PULLBACK_IN_UPTREND"
  },
  "support_zones": [
    {"level": "2400-2405", "basis": "日線 MA20 與整數關卡"},
    {"level": "2350-2360", "basis": "週線頸線與前波低點"}
  ],
  "resistance_zones": [
    {"level": "2450-2485", "basis": "前波高點套牢區"}
  ],
  "moving_averages": {"ma5": 2432, "ma20": 2405, "ma60": 2310},
  "momentum": {"rsi14": 54.2, "macd_signal": "BULLISH_CONVERGING"},
  "decision_flow": {
    "buy_trigger": "回測 2405 元守穩且出量，或帶量突破 2435 元",
    "hold_zone": "2405-2430 元量縮整理區間",
    "sell_trigger": "日線收盤跌破 2395 元且 MACD 翻黑"
  }
}`,
    },
    devChecklist: [
      {
        id: 'm1_d1',
        market: 'ALL',
        title: '實作日線 (Daily) 與週線 (Weekly) 還權 K 線資料自動同步與快取機制',
      },
      {
        id: 'm1_d2',
        market: 'ALL',
        title: '在程式碼端預先算好 MA(5/20/60/200)、RSI(14)、MACD 與 ATR，禁止讓 AI 心算指標',
      },
      {
        id: 'm1_d3',
        market: 'ALL',
        title: '實作近期波段高低點 (Swing High/Low) 與成交量密集區自動識別演算法，作為支撐壓力基準',
      },
      {
        id: 'm1_d4',
        market: 'TW',
        title:
          '【台股專屬】加入台股 Tick Size 價格對齊器（例如股價 ≥1000 元時，支撐壓力價位自動取 5 元倍數）',
      },
      {
        id: 'm1_d5',
        market: 'US',
        title:
          '【美股專屬】整合美股盤前／盤後跳空缺口 (Gap) 偵測，並支援 200MA (機構年線) 關鍵位判斷',
      },
      {
        id: 'm1_d6',
        market: 'ALL',
        title:
          '完成「買進／觀望／賣出」三階段條件式決策樹輸出介面，明確綁定觸發價位與委託單型態 (ROD/IOC)',
      },
    ],
    verifications: [
      {
        id: 'm1_v1',
        market: 'ALL',
        title: '指標數值零誤差交叉驗證 (Indicator Accuracy Check)',
        method:
          '隨機抽樣台股 (2330、2603) 與美股 (NVDA、AAPL) 各 3 檔，比對系統算出的日／週線 MA20、MA60、RSI14 與看盤軟體數值。',
        passCriteria: '均線誤差 < 0.05%，RSI 誤差 < 0.5，且週線收盤價與看盤軟體完全一致。',
      },
      {
        id: 'm1_v2',
        market: 'ALL',
        title: 'AI 價格幻覺防禦測試 (Anti-Hallucination Check)',
        method:
          '檢查 AI 輸出的支撐區間、壓力區間與均線價位，是否 100% 落在系統傳入的歷史高低點範圍內，有無憑空捏造過期股價。',
        passCriteria:
          '連續 10 次生成報告中，所有提及之價位與輸入數據 100% 吻合，無任何記憶殘留價格。',
      },
      {
        id: 'm1_v3',
        market: 'TW',
        title: '【台股驗證】除權息跳空與 Tick 檔位測試',
        method:
          '選取剛除權息的台股標的，驗證系統是否因使用「未還權股價」而誤判為暴跌破線；並檢查給出的進出場價是否符合台股跳動檔位。',
        passCriteria: '除權息日趨勢線與均線平滑無假性斷崖，且建議委託價皆為合法 Tick 價位。',
      },
      {
        id: 'm1_v4',
        market: 'ALL',
        title: '決策流程可執行性驗收 (Actionability Check)',
        method:
          '檢視最終輸出的「買進／觀望／賣出」判斷流程，是否具備明確的「若股價觸及 X 元且成交量 > Y 則執行 Z」條件。',
        passCriteria: '買進、觀望、賣出三個分支皆包含具體價位門檻與逐步推論理由。',
      },
    ],
  },
  {
    id: 2,
    code: 'MODULE 02',
    shortName: '2. 新聞轉交易策略',
    title: '2. 新聞轉交易策略 (News-to-Strategy Converter)',
    subtitle:
      '把公司或產業的最新消息轉換成可研究的市場影響，涵蓋短長期影響、預期波動區間、市場已反映與未反映因素、部位配置與失效條件。',
    apiEndpoint: '/api/mod2/news',
    originalPromptTemplate: `請整理【{target}】的最新消息，並分析它可能帶來的交易影響。
請提供：
→ 短期與長期可能影響
→ 預期價格波動區間
→ 市場可能已反映與尚未反映的因素
→ 可考慮的部位配置方向，以及判斷失效的條件。`,
    engineeredPromptTemplate: `你是一位宏觀與產業事件驅動（Event-Driven）交易策略師。請根據以下【{target}】（市場：{market}）的最新消息與當前盤面數據，轉換為可執行的交易研究報告：

【輸入新聞與事件摘要】
{news_summary}

【事件發生前之股價位階與波動率基準】
{market_context}

請嚴格依序提供以下 4 個維度的深度分析：
1. 【短期與長期可能影響】
2. 【預期價格波動區間】（台股受限於 ±10% 漲跌停）
3. 【市場可能已反映 (Priced-in) 與尚未反映 (Not Priced-in) 的因素】
4. 【可考慮的部位配置方向，以及判斷失效的條件（Invalidation Criteria）】`,
    presets: {
      tw: {
        target: '2330.TW 台積電（法說會上修全年營收展望與資本支出）',
        market: '台股 TWSE (需留意隔日開盤跳空與外資期現貨動向)',
        news_summary:
          '台積電最新法說會公布單季毛利率超越財測高標，並宣布上調今年美元營收成長預期至近 30%，同時指出 AI 晶片需求強勁，CoWoS 產能至明年仍供不應求。',
        market_context:
          '法說會前 10 個交易日股價已先上漲 6.5% 至 2420 元；目前日均 ATR 為 38 元（約 1.57%），外資法說前連買 4 日。',
      },
      us: {
        target: 'NVDA 輝達（發布最新一季財報 8-K 與下季財測指引）',
        market: '美股 NASDAQ (留意盤後交易波動與選擇權隱含波動率 IV Crush)',
        news_summary:
          'NVIDIA 公布最新財報，資料中心營收年增 112% 優於華爾街預期，下季營收指引中位數亦高於市場共識 15 億美元，但新一代晶片初期毛利率略降至 73%。',
        market_context:
          '財報公布前股價收在 $138.60，近一個月已大漲 18%；選擇權市場隱含財報當週波動幅度（Implied Move）為 ±7.5%。',
      },
    },
    inputFields: [
      { key: 'target', label: '公司／產業名稱與事件主題' },
      { key: 'market', label: '所屬市場與交易特性' },
      { key: 'news_summary', label: '最新消息／法說會／財報重點原文' },
      { key: 'market_context', label: '事件前股價位階與波動率基準 (ATR / 近期漲跌幅)' },
    ],
    setup: {
      twSources: [
        '官方重大訊息：公開資訊觀測站 (MOPS) 重大訊息 RSS、證交所法說會行事曆與月營收公告（每月 10 日前）',
        '財經新聞源：鉅亨網 (cnyes) 台股新聞 API、經濟日報／工商時報產業新聞',
        '產業供應鏈映射：建立台股概念股關聯字典（如 CoWoS 供應鏈：2330、3131 弘塑、3583 辛耘）',
      ],
      usSources: [
        '官方申報文件：SEC EDGAR API 即時抓取 8-K（重大事件）、10-Q（季報）、10-K（年報）',
        '即時快訊 API：Polygon.io Ticker News API、Finnhub News API',
        '市場預期基準：整合財報市場共識 (Consensus EPS/Revenue) 與近 10 日股價超額報酬',
      ],
      pythonSteps: [
        '實作新聞時間戳記正規化（精確區分盤前 PRE、盤中 REGULAR、盤後 POST）。',
        '在把新聞送給 AI 前，自動由股價 API 撈出該標的「過去 5 日與 20 日漲跌幅」與「14 日 ATR 波動值」一併傳入 Prompt。',
        '強制要求輸出必須包含「失效價位 (Invalidation Level)」，無具體數字價位則自動攔截。',
      ],
      agentSteps: [
        '在 n8n / Make 設定排程或 RSS Trigger，監聽指定自選股（如 2330、NVDA）的最新新聞。',
        '加入搜尋節點彙整過去 24 小時同主題的正反方市場觀點。',
        '將新聞內容與近期股價漲跌幅傳入 Gemini / GPT 節點，輸出結構化卡片。',
      ],
      schema: `{
  "target": "2330.TW 台積電",
  "session": "PRE",
  "priced_in_evaluation": {
    "priced_in_risk": true,
    "ret_5d_pct": 6.5,
    "ret_20d_pct": 14.2
  },
  "expected_volatility_range": {
    "upper_bound": 2460.0,
    "lower_bound": 2380.0
  },
  "invalidation_conditions": [
    "突破缺口被完全回補且收盤跌破 2380 元",
    "外資於法說後連續 3 日大額賣超逾 2 萬張"
  ]
}`,
    },
    devChecklist: [
      {
        id: 'm2_d1',
        market: 'ALL',
        title: '建立新聞時間戳記正規化與去重機制（嚴格區分「盤前、盤中、盤後」發布之消息）',
      },
      {
        id: 'm2_d2',
        market: 'ALL',
        title:
          '自動在新聞分析前注入「事件前 5 日／20 日股價漲跌幅」，讓 AI 有客觀依據判斷是否已提前反映 (Priced-in)',
      },
      {
        id: 'm2_d3',
        market: 'ALL',
        title: '結合個股 ATR（真實波動區間）計算合理的「預期價格波動區間」，避免 AI 隨意瞎猜漲跌幅',
      },
      {
        id: 'm2_d4',
        market: 'TW',
        title:
          '【台股專屬】串接每月 10 日前月營收公告與法說會重訊，並建立台股上下游供應鏈代號映射表',
      },
      {
        id: 'm2_d5',
        market: 'US',
        title:
          '【美股專屬】串接 SEC 8-K / 財報指引數據，並納入盤後股價反應與選擇權隱含波動率 (Implied Move) 參考',
      },
      {
        id: 'm2_d6',
        market: 'ALL',
        title: '在輸出解析器強制檢查「判斷失效的條件 (Invalidation Criteria)」欄位不可為空',
      },
    ],
    verifications: [
      {
        id: 'm2_v1',
        market: 'ALL',
        title: '歷史重大新聞回溯盲測 (Historical Event Blind Test)',
        method:
          '遮蔽公司後續走勢，輸入過去 3 則已知結果的重大財報／法說新聞（含「利多出盡下跌」案例），檢查系統能否在「已反映因素」中提出警示。',
        passCriteria:
          '當事件前 10~20 日股價已大漲超過 10% 時，系統必須在『已反映因素』標示利多出盡風險。',
      },
      {
        id: 'm2_v2',
        market: 'ALL',
        title: '失效條件具體性驗證 (Invalidation Specificity Check)',
        method:
          '檢查系統產出的「判斷失效條件」是否包含明確可量化的價位或時間條件，而非『若市場情緒轉差』等模糊詞彙。',
        passCriteria: '100% 測試案例皆產出至少 1 條價格失效條件與 1 條基本面／籌碼失效條件。',
      },
      {
        id: 'm2_v3',
        market: 'ALL',
        title: '預期波動區間合理性驗證 (Volatility Bounds Check)',
        method:
          '比對系統給出的短期預期價格波動區間，是否符合該市場規則（例如台股單日不可超過 ±10% 漲跌停限制）。',
        passCriteria: '台股單日預期波動區間嚴格受限於 ±10% 內，美股波動區間與近期 ATR 倍數相符。',
      },
    ],
  },
  {
    id: 3,
    code: 'MODULE 03',
    shortName: '3. 交易策略回測分析師',
    title: '3. 交易策略回測分析師 (Strategy Backtest Analyst)',
    subtitle:
      '用數據檢查策略是否真的具有優勢，完整呈現勝率、獲利因子、最大回撤、交易次數與平均報酬，並提出可提高策略優勢的具體改進方向。',
    apiEndpoint: '/api/mod3/backtest',
    originalPromptTemplate: `請針對【{strategy_name}】在【{target_asset}】過去【{time_period}】的表現進行回測。
請呈現：
→ 勝率
→ 獲利因子
→ 最大回撤
→ 交易次數與平均報酬
最後提出可提高策略優勢的具體改進方向。`,
    engineeredPromptTemplate: `你是一位嚴謹的量化策略回測分析師。請針對以下策略回測設定與回測引擎統計數據，進行深度績效診斷與優化分析：

【回測設定參數】
- 測試交易策略：{strategy_name}
- 測試標的／指數：{target_asset}（市場與摩擦成本：{market}）
- 回測時間區間：{time_period}
- 回測引擎產出之原始數據摘要：{backtest_metrics}

請嚴格依序呈現並診斷：
1. 【勝率 (Win Rate)】
2. 【獲利因子 (Profit Factor)】
3. 【最大回撤 (Max Drawdown, MDD)】
4. 【交易次數與平均報酬】
5. 【可提高策略優勢的具體改進方向】`,
    presets: {
      tw: {
        strategy_name: '日線 MA5 向上突破 MA20 買進，跌破 MA10 或虧損達 5% 出場（雙均線趨勢策略）',
        target_asset: '2330.TW 台積電',
        time_period: '過去 1 年 (250 個交易日)',
        market: '台股 TWSE（已計入單邊手續費 0.0855% + 賣出證交稅 0.3%，以次日開盤價成交）',
        backtest_metrics:
          '總交易次數 42 筆｜勝率 45.2% (19勝23敗)｜獲利因子 (Profit Factor) = 1.98｜最大回撤 (MDD) = -16.4%｜單筆平均淨報酬 +1.82%',
      },
      us: {
        strategy_name:
          '日線 RSI(14) 低於 30 且股價守在 200MA 之上買進，RSI 高於 65 或停損 6% 出場（均值回歸策略）',
        target_asset: 'NVDA 輝達',
        time_period: '過去 1 年 (250 個交易日)',
        market: '美股 NASDAQ（免佣金 + 預估滑價 0.05% + SEC 規費，使用 Adjusted Close 還權資料）',
        backtest_metrics:
          '總交易次數 36 筆｜勝率 63.9% (23勝13敗)｜獲利因子 (Profit Factor) = 2.15｜最大回撤 (MDD) = -19.2%｜單筆平均淨報酬 +2.35%',
      },
    },
    inputFields: [
      { key: 'strategy_name', label: '交易策略邏輯（進出場條件）' },
      { key: 'target_asset', label: '股票／指數代號' },
      { key: 'time_period', label: '回測時間區間' },
      { key: 'market', label: '市場稅費與滑價設定' },
      { key: 'backtest_metrics', label: '回測引擎計算結果摘要' },
    ],
    setup: {
      twSources: [
        '還權歷史資料庫：FinMind TaiwanStockPriceAdjusted 或 Yahoo 還權日 K（務必還原除權息）',
        '台股摩擦成本參數：買進手續費 0.1425% * 折扣、賣出手續費 + 賣出證交稅 0.3%',
        '流動性限制：加入台股漲跌停（±10%）限制，且強制以 Next Bar Open 撮合',
      ],
      usSources: [
        '還權歷史資料庫：Polygon.io / yfinance auto_adjust=True（自動還原歷年拆股 Stock Splits 與現金股息）',
        '美股摩擦成本參數：每股固定滑價 + SEC/FINRA 賣出規費',
        '生存者偏差防範：注意下市股票避免高估歷史勝率',
      ],
      pythonSteps: [
        '使用 src/backtest_engine.py 執行實際數值運算，強制以 Next Bar Open 成交杜絕偷看未來數據。',
        '標準化計算四大指標：Win Rate、Profit Factor、MDD、交易次數與平均報酬。',
        '自動提取最大虧損前 5 筆交易明細與 <30 筆樣本數過少警告。',
      ],
      agentSteps: [
        '開啟 Gemini / ChatGPT 的 Code Interpreter（Python 程式碼執行環境）。',
        '上傳目標股票的歷史 CSV 檔，讓 AI 在沙盒中直接執行回測腳本。',
        '強制要求沙盒腳本輸出四大指標與具體改進參數。',
      ],
      schema: `{
  "strategy": "MA5_CROSS_MA20",
  "symbol": "2330.TW",
  "execution_rule": "NEXT_BAR_OPEN",
  "metrics": {
    "win_rate_pct": 45.2,
    "profit_factor": 1.98,
    "max_drawdown_pct": -16.4,
    "total_trades": 42,
    "avg_return_per_trade_pct": 1.82
  }
}`,
    },
    devChecklist: [
      {
        id: 'm3_d1',
        market: 'ALL',
        title:
          '建立信號產生與成交時間隔離機制（當日收盤產生訊號，強制設為『隔日開盤價』成交，杜絕偷看未來數據）',
      },
      {
        id: 'm3_d2',
        market: 'ALL',
        title:
          '完成四大核心指標自動計算器：勝率、獲利因子 (Profit Factor)、最大回撤 (MDD)、交易次數與平均報酬',
      },
      {
        id: 'm3_d3',
        market: 'TW',
        title:
          '【台股專屬】內建台股手續費折扣與 0.3% 證交稅扣除邏輯，並使用除權息還權股價 (Adjusted Price)',
      },
      {
        id: 'm3_d4',
        market: 'US',
        title:
          '【美股專屬】處理美股歷史拆股 (Stock Split) 還原，並加入財報日跳空滑價 (Slippage) 模擬',
      },
      {
        id: 'm3_d5',
        market: 'ALL',
        title:
          '自動提取回測中「虧損最大的前 5 筆交易」發生背景，一併交由 AI 診斷策略盲點與提出改進方案',
      },
      {
        id: 'm3_d6',
        market: 'ALL',
        title:
          '加入樣本數過少警告（當總交易次數 < 30 筆時，自動標記統計顯著性不足，防止過度擬合 Overfitting）',
      },
    ],
    verifications: [
      {
        id: 'm3_v1',
        market: 'ALL',
        title: '防偷看未來數據驗收 (Zero Look-Ahead Bias Test)',
        method:
          '人工抽取回測報表中的前 5 筆交易，對照歷史 K 線圖，確認進場價格是否為「訊號成立後下一根 K 棒的開盤價」。',
        passCriteria: '5 筆抽樣交易之進出場時點與成交價 100% 符合實盤時間先後順序。',
      },
      {
        id: 'm3_v2',
        market: 'ALL',
        title: '四大指標公式數學驗收 (Metrics Math Verification)',
        method: '將回測輸出的所有單筆損益匯出，驗算 總獲利 / 總虧損 是否等於系統顯示的獲利因子。',
        passCriteria:
          '系統計算之勝率、獲利因子、MDD、平均報酬與手動驗算結果完全一致（誤差 0.00%）。',
      },
      {
        id: 'm3_v3',
        market: 'ALL',
        title: '稅費敏感度對比測試 (Friction Cost Stress Test)',
        method:
          '切換「零手續費」與「台股真實稅費 (含 0.3% 證交稅)」，驗證短線策略的獲利因子與平均報酬是否如實扣除成本。',
        passCriteria: '開啟稅費後，每筆交易淨報酬準確扣除對應成本，不會出現忽略交易稅的虛胖績效。',
      },
      {
        id: 'm3_v4',
        market: 'ALL',
        title: 'AI 改進建議二次回測驗證 (Walk-Forward Improvement Check)',
        method: '將 AI 提出的具體改進方向實際改寫回測參數重跑一次，並保留 20% 樣本外期間測試。',
        passCriteria: '套用改進建議後，樣本外期間之獲利因子提升或最大回撤 (MDD) 實質收斂。',
      },
    ],
  },
  {
    id: 4,
    code: 'MODULE 04',
    shortName: '4. 投資組合風險管理',
    title: '4. 投資組合風險管理 (Portfolio Risk Manager)',
    subtitle:
      '找出過度集中與不易察覺的關聯風險，分析組合弱點、過度曝險部位與隱藏相關性，並依風險承受度提出再平衡方案與市場下跌 20% 的避險策略。',
    apiEndpoint: '/api/mod4/risk',
    originalPromptTemplate: `請分析我的投資組合：【{portfolio_holdings}】。
請找出：
→ 組合中的弱點
→ 過度曝險的部位
→ 標的之間隱藏的相關性
再依照我的風險承受度提出再平衡方案，並提供可因應市場下跌 20% 的避險策略。`,
    engineeredPromptTemplate: `你是一位機構級跨市場投資組合風控長（CRO）。請根據以下投資人的台美股持倉明細、風險承受度與量化相關性數據，進行全面風險體檢：

【目前投資組合與配置比例】
{portfolio_holdings}

【投資人風險承受度與基準設定】
{risk_profile}

【系統計算之量化風控指標（Beta 與相關性摘要）】
{quant_risk_context}

請嚴格依序診斷並提供具體方案：
1. 【組合中的弱點】
2. 【過度曝險的部位】（含穿透式 ETF 權重累加）
3. 【標的之間隱藏的相關性】
4. 【依風險承受度之再平衡方案 (目標權重總和嚴格 = 100%)】
5. 【因應市場下跌 20% 的避險策略 (微台指 / 反向 ETF / Put 選擇權)】`,
    presets: {
      tw: {
        portfolio_holdings:
          '2330.TW 台積電 (45%)、2317.TW 鴻海 (25%)、2454.TW 聯發科 (20%)、現金 TWD (10%)',
        risk_profile: '穩健偏積極型（可承受單年最大帳面回撤 15%，基準指數為台灣加權指數 / 0050）',
        quant_risk_context:
          '組合整體 Beta 值 = 1.32；電子半導體與 AI 伺服器供應鏈合計佔比高達 90%；2330 與 2454 近一年日報酬相關係數達 0.74',
      },
      us: {
        portfolio_holdings:
          '台股 2330.TW 台積電 (35%)、美股 NVDA 輝達 (30%)、美股 TSMC ADR (10%)、美股 QQQ (15%)、美元現金 (10%)',
        risk_profile:
          '穩健型跨市場投資人（以新台幣為總資產計算基準，希望將大盤暴跌 20% 時的組合虧損控制在 12% 以內）',
        quant_risk_context:
          '跨市場 AI 晶片曝險極度重疊（2330 + TSM + NVDA + QQQ 內含權重合計實質半導體曝險逾 80%）；組合對費城半導體指數 Beta 達 1.55',
      },
    },
    inputFields: [
      { key: 'portfolio_holdings', label: '輸入標的代號與配置比例（支援台美股混合）' },
      { key: 'risk_profile', label: '個人風險承受度與最大可接受回撤' },
      { key: 'quant_risk_context', label: '系統計算之 Beta 與相關係數矩陣摘要' },
    ],
    setup: {
      twSources: [
        '台股產業分類與權重：證交所產業分類表與 0050 成分股穿透式權重（0050 內含 54% 台積電）',
        '台股避險工具庫：微台指期 (TMF)、小台指 (MTX)、台灣50反1 (00632R)、美債 ETF (00679B)',
        '持倉匯入格式：支援券商庫存匯出 CSV，自動折算市值佔總資產百分比',
      ],
      usSources: [
        '美股 GICS 11 大產業分類：透過 yfinance / Polygon 取得個股 Sector & Industry',
        '跨市場相關性計算：將台股日報酬與美股前一日收盤報酬計算 252 日皮爾森相關係數',
        '美股避險工具庫：SPY / QQQ Protective Put、反向 ETF (SH / PSQ)、長債與黃金 ETF (TLT / GLD)',
      ],
      pythonSteps: [
        '先由 src/portfolio_risk.py 將台股（TWD）與美股（USD）持倉透過最新 USD/TWD 匯率統一換算為同幣別總市值。',
        '執行穿透式 ETF 拆解（例如持有 0050 與 QQQ 時，自動累加內含的 2330 與 NVDA 曝險）。',
        '驗證再平衡目標配置比例總和嚴格等於 100.0%，並試算大盤下跌 20% 之 Beta 放大虧損與散戶避險方案。',
      ],
      agentSteps: [
        '建立 Google Sheets 持倉管理表，利用 GOOGLEFINANCE() 自動抓取台美股即時現價與 USD/TWD 匯率。',
        '透過 Make / n8n 讀取整張持倉表，傳送給模組 4 Agent 分析隱藏相關性。',
        '每週末固定排程產出「週度部位風控與再平衡建議書」。',
      ],
      schema: `{
  "base_currency": "TWD",
  "usd_twd_rate": 32.15,
  "lookthrough_exposure_pct": {"2330": 51.6, "NVDA": 26.1},
  "rebalance_verification": {
    "weight_conservation_passed": true,
    "target_sum_pct": 100.0
  },
  "crash_20pct_hedge": {
    "expected_portfolio_drawdown_pct": -27.6,
    "suggested_hedge_tool": "微台指 (TMF) 放空 或 台灣50反1 (00632R)"
  }
}`,
    },
    devChecklist: [
      {
        id: 'm4_d1',
        market: 'ALL',
        title:
          '實作跨幣別持倉市值統一換算器（自動抓取最新 USD/TWD 匯率，將台美股與現金合併計算真實權重）',
      },
      {
        id: 'm4_d2',
        market: 'ALL',
        title:
          '實作過去 1 年歷史日報酬率相關係數矩陣 (Correlation Matrix) 與投資組合加權 Beta 值計算',
      },
      {
        id: 'm4_d3',
        market: 'ALL',
        title:
          '建立「穿透式曝險檢查」（例如持有 0050 或 QQQ 時，自動拆解其內含的台積電與輝達權重並與個股持倉累加）',
      },
      {
        id: 'm4_d4',
        market: 'ALL',
        title: '在再平衡方案輸出端加入「權重總和 = 100%」與「台股整張／零股可買股數」自動驗算邏輯',
      },
      {
        id: 'm4_d5',
        market: 'ALL',
        title:
          '建立大盤下跌 20% 情境壓力測試公式（依各股 Beta 與歷史股災最大回撤推算組合潛在虧損金額）',
      },
    ],
    verifications: [
      {
        id: 'm4_v1',
        market: 'ALL',
        title: '極端集中與跨市場隱藏相關性壓力測試',
        method:
          '輸入一組「表面分散在 5 檔不同台美股，但全數為 AI 伺服器供應鏈（2330、2317、3017、NVDA、AMD）」的測試組合，檢查系統能否發出高度集中警告。',
        passCriteria: '系統準確識別出 > 80% 曝險集中於同一產業因子，並標出高相關係數配對。',
      },
      {
        id: 'm4_v2',
        market: 'ALL',
        title: '再平衡權重守恆驗證 (Weight Conservation Check)',
        method:
          '檢查系統建議的「再平衡目標配置比例」加總是否嚴格等於 100.0%，且加減碼幅度完全對齊。',
        passCriteria: '所有再平衡標的（含現金與新增避險部位）目標權重總和 = 100%，無算術誤差。',
      },
      {
        id: 'm4_v3',
        market: 'ALL',
        title: '市場下跌 20% 避險工具可行性驗證',
        method:
          '檢視系統針對「保守／穩健／積極」三種不同風險承受度給出的 -20% 避險策略，確認小資金散戶不會被建議門檻過高的大台指期。',
        passCriteria: '避險工具與部位規模匹配（推薦微台指或反向 ETF），且清楚說明避險啟動條件。',
      },
    ],
  },
  {
    id: 5,
    code: 'MODULE 05',
    shortName: '5. 交易日誌分析師',
    title: '5. 交易日誌分析師 (Trading Journal Coach)',
    subtitle:
      '從最近 20 筆交易紀錄找出反覆出現的錯誤、錯過的機會與可能影響決策的行為偏誤，並制定 3 條可立即執行的個人化規則提升交易一致性。',
    apiEndpoint: '/api/mod5/coach',
    originalPromptTemplate: `請檢視我最近 20 筆交易：【{trade_logs}】。
請分析：
→ 反覆出現的錯誤
→ 錯過的機會
→ 可能影響決策的行為偏誤
最後依照我的交易紀錄，制定 3 條可立即執行的個人化規則，幫助我提升交易一致性。`,
    engineeredPromptTemplate: `你是一位頂尖交易心理學家與實盤績效教練。請深入檢視以下交易人最近 20 筆台美股實盤交易紀錄（包含進場、出場、持倉時間、損益結果與當下筆記）：

【最近 20 筆交易明細與統計摘要】
{trade_logs}

請根據具體的交易編號與數據證據（禁止空泛說教，每個結論都必須引用對應的交易紀錄），依序分析：
1. 【反覆出現的錯誤 (Recurring Mistakes)】
2. 【錯過的機會 (Missed Opportunities) — 出場後 5 日續漲追蹤】
3. 【可能影響決策的行為偏誤 (處置效應 / 報復性交易，需綁定 #編號)】
4. 【制定 3 條可立即執行的個人化規則 (3 Actionable Rules)】`,
    presets: {
      tw: {
        trade_logs: `[統計摘要：近20筆台股交易｜勝率 55% (11勝9敗)，但總損益為 -48,500 元（賺小賠大：平均獲利 +6,200 元，平均虧損 -12,960 元）]
- #01~#05 (2330/2317)：順勢波段買進，獲利達 +2.5% 時因擔心回吐立刻市價 IOC 賣出，出場後股價續漲逾 8%。
- #08 (2603 長榮)：09:05 見早盤急拉 6% 用市價 IOC 追高買進 5 張，收盤翻黑跌破日內均線未停損，隔日續跌 -7% 才砍在最低點（單筆虧損 -42,000 元）。
- #12 (3017 奇鋐)：原設停損價 620 元，盤中跌破時手動取消停損單並逢低攤平加碼 2 張，3 天後因大盤回檔被迫在 585 元認賠出場（單筆虧損 -51,000 元）。`,
      },
      us: {
        trade_logs: `[統計摘要：近20筆美股交易｜勝率 50% (10勝10敗)，總損益 -$1,840 USD（平均獲利 +$320，平均虧損 -$504）]
- #02, #07, #14 (NVDA / AMD)：於財報公布前夕重倉買進賭財報，隔日開盤跳空下跌 6%～9%，造成單筆重大虧損。
- #04, #09, #11 (TSLA / PLTR)：突破關鍵壓力位進場後，帳面獲利達 +3% 即手動平倉，錯過後續 +18% 主升段。
- #16, #17 (SOXL 3倍槓桿半導體 ETF)：在連虧兩筆個股後，臨時切換買進 3 倍槓桿 ETF 想快速翻本，隔日觸發 -8% 停損。`,
      },
    },
    inputFields: [
      { key: 'trade_logs', label: '最近 20 筆交易紀錄（包含進場、出場、損益結果與當下操作背景）' },
    ],
    setup: {
      twSources: [
        '台股對帳單匯入：支援各大券商（元大、凱基、富邦、永豐、玉山）已實現損益明細 CSV 匯入',
        '委託行為特徵擷取：記錄每筆交易下單時間、委託別（限價 ROD vs 市價 IOC 追價）與是否曾刪改停損單',
        '出場後追蹤 (Post-Exit Tracking)：自動抓取賣出後 5 個交易日的最高價，量化「過早賣飛」錯失的潛在報酬',
      ],
      usSources: [
        '美股對帳單匯入：支援 Interactive Brokers (IBKR)、Firstrade、Charles Schwab 交易紀錄 CSV 匯入',
        '時段與事件標籤：自動比對每筆美股進場時間是否為「財報公布前 24 小時」或「疲勞交易時段」',
        'MFE / MAE 指標計算：自動計算每筆交易持倉期間的「最大有利波動」與「最大不利波動」',
      ],
      pythonSteps: [
        '由 src/journal_coach.py 統計勝率、平均賺賠比 (Payoff Ratio) 與出場後 5 日賣飛率。',
        '自動偵測「處置效應 (虧損 > 10% 死抱凹單)」與「報復性交易 (虧損後部位翻倍)」，並強制綁定交易編號 (#03, #08)。',
        '將模組 5 產出的「3 條個人化規則」同步回寫至主控台，形成下單前閉環檢查。',
      ],
      agentSteps: [
        '建立 Notion 或 Google Sheets「交易日誌表」，每滿 20 筆交易自動觸發 Make / n8n 工作流。',
        '將最近 20 筆列資料轉為 Markdown 表格傳入模組 5 Agent。',
        '自動將 AI 診斷出的「反覆錯誤」與「3 條個人化規則」置頂更新於看盤儀表板首頁。',
      ],
      schema: `{
  "statistics": {
    "total_trades": 6,
    "win_rate_pct": 16.67,
    "payoff_ratio": 0.71,
    "early_exits_count": 1
  },
  "detected_biases": [
    {
      "bias_name": "處置效應 (Disposition Effect)",
      "evidence_trade_ids": ["#03", "#08"]
    },
    {
      "bias_name": "報復性翻倍交易 (Revenge Trading)",
      "evidence_trade_ids": ["#04", "#09"]
    }
  ]
}`,
    },
    devChecklist: [
      {
        id: 'm5_d1',
        market: 'ALL',
        title: '建立標準化 20 筆交易紀錄匯入器（支援台美股券商 CSV 匯入與手動表單新增）',
      },
      {
        id: 'm5_d2',
        market: 'ALL',
        title: '自動統計賺賠比 (平均獲利 ÷ 平均虧損)、下單時段勝率與「連虧後下一筆部位放大率」',
      },
      {
        id: 'm5_d3',
        market: 'ALL',
        title: '實作「出場後 5 日表現追蹤」，自動標記哪些交易屬於『過早賣飛（出場後續漲 > 5%）』',
      },
      {
        id: 'm5_d4',
        market: 'ALL',
        title:
          '設計行為偏誤映射邏輯，強制 AI 在指出錯誤時必須列出對應的交易編號（如 #08、#12）作為證據',
      },
      {
        id: 'm5_d5',
        market: 'ALL',
        title: '將 AI 制定的「3 條個人化規則」串接回系統首頁，作為下次下單前的強制打勾確認項',
      },
    ],
    verifications: [
      {
        id: 'm5_v1',
        market: 'ALL',
        title: '植入式壞習慣偵測驗收 (Planted Flaw Detection Test)',
        method:
          '準備一份包含明顯「賺 2% 就跑、賠 10% 死抱（處置效應）」與「大虧後隔日部位翻倍（報復性交易）」的測試帳單，檢視系統能否精準抓出這兩項偏誤並點名對應交易編號。',
        passCriteria: '100% 準確指出植入的壞習慣與對應交易編號，無遺漏或張冠李戴。',
      },
      {
        id: 'm5_v2',
        market: 'ALL',
        title: '3 條個人化規則可量化性驗收 (Rule Specificity Check)',
        method:
          '檢查系統最終制定的 3 條規則是否具備明確的數字、時間或指標門檻（例如『單筆虧損達 5.0% 強制市價 IOC 停損』）。',
        passCriteria: '3 條規則皆包含明確可執行的觸發條件與限制動作，可直接轉化為下單前檢核表。',
      },
      {
        id: 'm5_v3',
        market: 'ALL',
        title: '跨模組閉環連動測試 (Closed-Loop Integration Check)',
        method:
          '確認模組 5 產出的 3 條個人化規則儲存後，能否在模組 1（技術分析決策）與模組 4（部位風控）介面中正常顯示提醒。',
        passCriteria: '儲存規則後，全系統各模組皆能同步讀取最新 3 條個人化交易守則。',
      },
    ],
  },
];

window.MARKET_SPECS_TABLE = [
  {
    dim: '1. 標的代號與正規化',
    tw: '純數字 4～6 碼（如 2330、0050），跨國 API 需加後綴 .TW（上市）或 .TWO（上櫃）。',
    us: '英文字母 1～5 碼（如 NVDA、AAPL、BRK.B）。',
    rule: 'DualMarketDataAdapter.normalize_symbol() 自動識別並補齊後綴與幣別。',
  },
  {
    dim: '2. 交易單位與部位計算',
    tw: '整張為 1,000 股，盤中／盤後零股為 1～999 股。',
    us: '標準以 1 股為單位（支援碎股 Fractional Shares）。',
    rule: '再平衡與回測預設台股 1,000 股/張、美股 100 股或依資金動態換算。',
  },
  {
    dim: '3. 最小跳動單位 (Tick Size)',
    tw: '法定 6 級階梯制：1000 元以上每檔 5.0 元；500~1000 元每檔 1.0 元；100~500 元每檔 0.5 元。',
    us: '股價 ≥ $1 時固定為 $0.01。',
    rule: 'align_tw_tick() 強制將支撐、壓力與委託價對齊至合法 Tick，杜絕無效委託。',
  },
  {
    dim: '4. 交易稅費與摩擦成本',
    tw: '買賣雙邊手續費 0.1425%（可打折，低消 20 元）+ 賣出單邊證交稅 0.3%（ETF 0.1%）。',
    us: '主流券商免手續費，賣出收取微小 SEC 規費 (0.00278%) 與 FINRA TAF。',
    rule: 'calculate_friction_cost() 於回測與淨損益計算中自動扣除真實摩擦成本。',
  },
  {
    dim: '5. 單日漲跌停限制',
    tw: '上市櫃普通股單日漲跌停限制為前日收盤價 ±10%。',
    us: '無單日漲跌停百分比限制（僅有 LULD 熔斷機制）。',
    rule: '模組 2 波動區間與模組 1 防幻覺器強制約束台股單日預期目標價不超過 ±10%。',
  },
  {
    dim: '6. 交易時段與盤前盤後',
    tw: '普通交易 09:00～13:30（無連續撮合盤前交易，僅盤後定價 14:00～14:30）。',
    us: '美東時間盤前 04:00～09:30、正規盤 09:30～16:00、盤後 16:00～20:00。',
    rule: 'NewsStrategyAnalyzer.classify_market_session() 依市場時區精準切分 PRE / REGULAR / POST。',
  },
  {
    dim: '7. 除權息與拆股還原',
    tw: '每年高頻率除權息，未還權 K 線會出現假性跳空斷崖。',
    us: '常見股票分割 (Stock Split，如 NVDA 1拆10) 與季配息。',
    rule: '全面採用 Adjusted Close 還權價格計算均線與 RSI，避免除權息日假死叉。',
  },
  {
    dim: '8. 交割制度與幣別匯率',
    tw: 'T+2 交割（新台幣 TWD 計價，違約交割具法律刑責）。',
    us: 'T+1 交割（美元 USD 計價）。',
    rule: 'PortfolioRiskManager 動態抓取 USD/TWD 匯率統一折算總市值並檢驗權重總和 = 100%。',
  },
];

window.FOLDER_TREE_SAMPLE = `E:\\python\\trading\\
├── biome.json                 # Biome 靜態檢查設定
├── Continu.md                 # 進度與架構交接報告
├── src/
│   ├── api_server.py          # 本機整合 HTTP + REST API Server (Port 8088)
│   ├── data_adapter.py        # 台美股外部行情 (Yahoo/FinMind) 與即時匯率串接層
│   ├── llm_runner.py          # Gemini/OpenAI 結構化推論 + 防幻覺強制閘門
│   ├── indicators.py          # 模組 1: MA, RSI, MACD, ATR, Swing 高低點
│   ├── market_rules.py        # 模組 1/3: 台股 6 級 Tick 對齊與 0.3% 證交稅計算
│   ├── anti_hallucination.py  # 模組 1/2: AI 價格邊界與量化失效條件審計器
│   ├── news_strategy.py       # 模組 2: 新聞時段、Priced-in 檢定、±10% 波動區間
│   ├── backtest_engine.py     # 模組 3: Next Bar Open 零偷看回測與四大指標
│   ├── portfolio_risk.py      # 模組 4: 跨幣別換算、穿透式 ETF 拆解、-20% 壓力測試
│   └── journal_coach.py       # 模組 5: 交易日誌統計、偏誤編號綁定、3 條守則
├── tests/
│   ├── test_core.py           # 指標、Tick、稅費、防偷看回測單元測試
│   ├── test_modules.py        # 模組 2/4/5 邏輯單元測試
│   └── test_integration.py    # 端到端全套串接與 API 調度器整合測試
└── web/
    ├── index.html             # React 18 + Tailwind CSS 入口容器
    ├── data.js                # 模組 1~5 完整規格與預設參數字典
    ├── app.jsx                # React + Tailwind 互動式主控台與即時 API 串接元件
    └── style.css              # 捲軸與玻璃擬態輔助樣式`;

window.BOILERPLATE_CODE_SAMPLE = `from src.data_adapter import DualMarketDataAdapter
from src.llm_runner import LLMRunner

# 1. 自動識別台美股並抓取還權 K 線、預先算好 MA/RSI/MACD/ATR 與台股 Tick 對齊支撐壓力
adapter = DualMarketDataAdapter()
snapshot = adapter.build_technical_snapshot("2330.TW")

# 2. 注入結構化 Prompt 並強制通過 AntiHallucinationGuard 防價格幻覺審查
runner = LLMRunner(provider="AUTO")
result = runner.generate_technical_decision(snapshot)
print(result["decision_payload"])
print("防幻覺審查通過:", result["anti_hallucination_audit"]["passed"])`;
