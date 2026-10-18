/**
 * 台美股 AI 交易分析系統 — 開發與檢核主控台核心腳本 (app.js)
 * 功能：
 * 1. 28 項開發清單 + 17 項驗收測試的動態渲染與 LocalStorage 持久化
 * 2. 即時計算各模組與總體完成度 %
 * 3. 市場模式 (ALL/TW/US) 與技術路線過濾
 * 4. 提示詞沙盒參數載入與複製
 * 5. 一鍵匯出標準 Markdown 進度報告
 */

// 核心資料字典 (模組 2 ~ 6)
const SYSTEM_DATA = {
  modules: [
    {
      id: 'mod-2',
      num: '02',
      title: '自動化技術分析師',
      subtitle:
        '用日線與週線拆解趨勢和關鍵價位，依序整理支撐壓力、趨勢線、關鍵均線與動能指標，並提供「買進／觀望／賣出」的判斷流程與逐步理由。',
      dev_items: [
        {
          id: 'd2-1',
          market: 'ALL',
          title: '實作日線 (Daily) 與週線 (Weekly) 還權 K 線資料自動同步與快取機制',
          desc: '確保包含除權除息調整價格，支援多週期技術指標運算。',
        },
        {
          id: 'd2-2',
          market: 'ALL',
          title: '在程式碼端預先算好 MA(5/20/60/200)、RSI(14)、MACD 與 ATR',
          desc: '嚴格禁止讓 AI 心算指標，所有數值於系統端注入 Prompt。',
        },
        {
          id: 'd2-3',
          market: 'ALL',
          title: '實作近期波段高低點 (Swing High/Low) 與成交量密集區自動識別演算法',
          desc: '自動提取波段支撐與壓力區間作為 AI 參考基準。',
        },
        {
          id: 'd2-4',
          market: 'TW',
          title: '【台股專屬】加入台股 Tick Size 價格對齊器',
          desc: '例如股價 ≥1000 元時，支撐壓力價位自動取 5 元倍數。',
        },
        {
          id: 'd2-5',
          market: 'US',
          title: '【美股專屬】整合美股盤前／盤後跳空缺口 (Gap) 偵測',
          desc: '支援 200MA (機構年線) 關鍵位與盤前動能判斷。',
        },
        {
          id: 'd2-6',
          market: 'ALL',
          title: '完成「買進／觀望／賣出」三階段條件式決策樹輸出介面',
          desc: '明確綁定觸發價位與委託單型態 (ROD/IOC)，杜絕模稜兩可。',
        },
      ],
      test_items: [
        {
          id: 't2-1',
          market: 'ALL',
          title: '指標數值零誤差交叉驗證 (Indicator Accuracy Check)',
          desc: '抽樣台股 (2330、2603) 與美股 (NVDA、AAPL)，比對日/週線 MA20、MA60、RSI14。標準：均線誤差 < 0.05%，RSI 誤差 < 0.5。',
        },
        {
          id: 't2-2',
          market: 'ALL',
          title: 'AI 價格幻覺防禦測試 (Anti-Hallucination Check)',
          desc: '檢查輸出的支撐壓力是否 100% 落在傳入的歷史區間，連 10 次生成無憑空捏造或記憶殘留價格。',
        },
        {
          id: 't2-3',
          market: 'TW',
          title: '【台股驗證】除權息跳空與 Tick 檔位測試',
          desc: '確認使用還權 K 線避免假斷崖，建議委託價 100% 符合法定 Tick 檔位。',
        },
        {
          id: 't2-4',
          market: 'ALL',
          title: '決策流程可執行性驗收 (Actionability Check)',
          desc: '買進、觀望、賣出皆包含具體價位門檻 (若股價觸及 X 且量 > Y) 與逐步推論理由。',
        },
      ],
    },
    {
      id: 'mod-3',
      num: '03',
      title: '新聞轉交易策略',
      subtitle:
        '把公司或產業的最新消息轉換成可研究的市場影響，涵蓋短長期影響、預期波動區間、市場已反映與未反映因素、部位配置與失效條件。',
      dev_items: [
        {
          id: 'd3-1',
          market: 'ALL',
          title: '建立新聞時間戳記正規化與去重機制',
          desc: '嚴格區分「盤前、盤中、盤後」發布之消息，杜絕時序混淆。',
        },
        {
          id: 'd3-2',
          market: 'ALL',
          title: '自動在新聞分析前注入「事件前 5 日／20 日股價漲跌幅」',
          desc: '讓 AI 有客觀依據判斷市場是否已提前反映 (Priced-in)。',
        },
        {
          id: 'd3-3',
          market: 'ALL',
          title: '結合個股 ATR（真實波動區間）計算合理的「預期價格波動區間」',
          desc: '避免 AI 隨意瞎猜漲跌幅度，依波動度建立上下界。',
        },
        {
          id: 'd3-4',
          market: 'TW',
          title: '【台股專屬】串接每月 10 日前月營收公告與法說會重訊',
          desc: '建立台股上下游供應鏈代號映射表與同業連動機制。',
        },
        {
          id: 'd3-5',
          market: 'US',
          title: '【美股專屬】串接 SEC 8-K / 財報指引數據',
          desc: '納入盤後股價即時反應與選擇權隱含波動率 (Implied Move) 參考。',
        },
        {
          id: 'd3-6',
          market: 'ALL',
          title: '在輸出解析器強制檢查「判斷失效的條件 (Invalidation Criteria)」',
          desc: '欄位不可為空，必須提供停損停利或反向觀點觸發點。',
        },
      ],
      test_items: [
        {
          id: 't3-1',
          market: 'ALL',
          title: '歷史重大新聞回溯盲測 (Historical Event Blind Test)',
          desc: '遮蔽後續走勢輸入 3 則重大財報新聞。標準：事件前 10 日已大漲逾 10% 時，必須標示利多出盡已反映風險。',
        },
        {
          id: 't3-2',
          market: 'ALL',
          title: '失效條件具體性驗證 (Invalidation Specificity Check)',
          desc: '100% 測試案例皆產出至少 1 條價格失效條件與 1 條基本面/籌碼失效條件。',
        },
        {
          id: 't3-3',
          market: 'ALL',
          title: '預期波動區間合理性驗證 (Volatility Bounds Check)',
          desc: '台股單日預期波動嚴格受限於 ±10% 限制內，美股波動與近期 ATR 倍數相符。',
        },
      ],
    },
    {
      id: 'mod-4',
      num: '04',
      title: '交易策略回測分析師',
      subtitle:
        '用數據檢查策略是否真的具有優勢，完整呈現勝率、獲利因子、最大回撤、交易次數與平均報酬，並提出可提高策略優勢的具體改進方向。',
      dev_items: [
        {
          id: 'd4-1',
          market: 'ALL',
          title: '建立信號產生與成交時間隔離機制',
          desc: '當日收盤產生訊號，強制設為『隔日開盤價 (Next Bar Open)』成交，杜絕偷看未來數據。',
        },
        {
          id: 'd4-2',
          market: 'ALL',
          title: '完成四大核心指標自動計算器',
          desc: '勝率、獲利因子 (Profit Factor)、最大回撤 (MDD)、交易次數與平均報酬。',
        },
        {
          id: 'd4-3',
          market: 'TW',
          title: '【台股專屬】內建台股手續費折扣與 0.3% 證交稅扣除邏輯',
          desc: '使用除權息還權股價 (Adjusted Price)，避免虛胖獲利。',
        },
        {
          id: 'd4-4',
          market: 'US',
          title: '【美股專屬】處理美股歷史拆股 (Stock Split) 還原',
          desc: '加入財報日跳空滑價 (Slippage) 模擬。',
        },
        {
          id: 'd4-5',
          market: 'ALL',
          title: '自動提取回測中「虧損最大的前 5 筆交易」發生背景',
          desc: '一併交由 AI 診斷策略盲點與提出具體改進方案。',
        },
        {
          id: 'd4-6',
          market: 'ALL',
          title: '加入樣本數過少警告',
          desc: '當總交易次數 < 30 筆時，自動標記統計顯著性不足，防範過度擬合 (Overfitting)。',
        },
      ],
      test_items: [
        {
          id: 't4-1',
          market: 'ALL',
          title: '防偷看未來數據驗收 (Zero Look-Ahead Bias Test)',
          desc: '抽取前 5 筆交易對照歷史 K 線，成交價 100% 為訊號後下一根 K 棒開盤價。',
        },
        {
          id: 't4-2',
          market: 'ALL',
          title: '四大指標公式數學驗收 (Metrics Math Verification)',
          desc: '單筆損益手動驗算總獲利/總虧損等於獲利因子，系統指標與手動驗算 0.00% 誤差。',
        },
        {
          id: 't4-3',
          market: 'TW',
          title: '稅費敏感度對比測試 (Friction Cost Stress Test)',
          desc: '切換零手續費與真實稅費 (含 0.3% 證交稅)，確認每筆淨報酬如實扣除成本。',
        },
        {
          id: 't4-4',
          market: 'ALL',
          title: 'AI 改進建議二次回測驗證 (Walk-Forward Improvement Check)',
          desc: '將改進濾網參數套用至 20% 樣本外期間，驗收獲利因子提升或 MDD 實質收斂。',
        },
      ],
    },
    {
      id: 'mod-5',
      num: '05',
      title: '投資組合風險管理',
      subtitle:
        '找出過度集中與不易察覺的關聯風險，分析組合弱點、過度曝險部位與隱藏相關性，並依風險承受度提出再平衡方案與市場下跌 20% 的避險策略。',
      dev_items: [
        {
          id: 'd5-1',
          market: 'ALL',
          title: '實作跨幣別持倉市值統一換算器',
          desc: '自動抓取即時 USD/TWD 匯率，將台美股與現金合併計算真實權重。',
        },
        {
          id: 'd5-2',
          market: 'ALL',
          title: '實作過去 1 年歷史日報酬率相關係數矩陣與加權 Beta 值計算',
          desc: '量化資產間的共變同動性。',
        },
        {
          id: 'd5-3',
          market: 'ALL',
          title: '建立「穿透式曝險檢查」',
          desc: '持有 0050 或 QQQ 時，自動拆解內含的台積電/輝達權重並與個股持倉累加。',
        },
        {
          id: 'd5-4',
          market: 'ALL',
          title: '在再平衡方案輸出端加入「權重總和 = 100%」自動驗算',
          desc: '並對齊台股整張／零股可買股數計算邏輯。',
        },
        {
          id: 'd5-5',
          market: 'ALL',
          title: '建立大盤下跌 20% 情境壓力測試公式',
          desc: '依各股 Beta 與歷史股災最大回撤推算組合潛在虧損金額。',
        },
      ],
      test_items: [
        {
          id: 't5-1',
          market: 'ALL',
          title: '極端集中與跨市場隱藏相關性壓力測試',
          desc: '輸入表面分散但全為 AI 伺服器供應鏈組合 (2330, 2317, 3017, NVDA, AMD)，能準確識別出 > 80% 曝險集中警告。',
        },
        {
          id: 't5-2',
          market: 'ALL',
          title: '再平衡權重守恆驗證 (Weight Conservation Check)',
          desc: '目標配置比例加總嚴格等於 100.0%，加減碼幅度完全對齊無算術誤差。',
        },
        {
          id: 't5-3',
          market: 'ALL',
          title: '市場下跌 20% 避險工具可行性驗證',
          desc: '針對保守/穩健/積極給出避險策略，散戶不建議大台指，應推薦微台指或反向 ETF。',
        },
      ],
    },
    {
      id: 'mod-6',
      num: '06',
      title: '交易日誌分析師',
      subtitle:
        '從最近 20 筆交易紀錄找出反覆出現的錯誤、錯過的機會與可能影響決策的行為偏誤，並制定 3 條可立即執行的個人化規則提升交易一致性。',
      dev_items: [
        {
          id: 'd6-1',
          market: 'ALL',
          title: '建立標準化 20 筆交易紀錄匯入器',
          desc: '支援台美股券商 CSV 匯入與手動表單批次新增。',
        },
        {
          id: 'd6-2',
          market: 'ALL',
          title: '自動統計賺賠比、下單時段勝率與連虧後部位放大率',
          desc: '量化交易行為特徵。',
        },
        {
          id: 'd6-3',
          market: 'ALL',
          title: '實作「出場後 5 日表現追蹤」',
          desc: '自動標記哪些交易屬於『過早賣飛（出場後續漲 > 5%）』。',
        },
        {
          id: 'd6-4',
          market: 'ALL',
          title: '設計行為偏誤映射邏輯',
          desc: '強制 AI 在指出錯誤時必須列出對應的交易編號（如 #08、#12）作為證據。',
        },
        {
          id: 'd6-5',
          market: 'ALL',
          title: '將 AI 制定的「3 條個人化規則」串接回系統首頁',
          desc: '作為下次下單前的強制打勾確認項。',
        },
      ],
      test_items: [
        {
          id: 't6-1',
          market: 'ALL',
          title: '植入式壞習慣偵測驗收 (Planted Flaw Detection Test)',
          desc: '輸入含處置效應 (賺2%跑賠10%抱) 與報復性交易測試帳單，100% 精準指出偏誤與對應編號。',
        },
        {
          id: 't6-2',
          market: 'ALL',
          title: '3 條個人化規則可量化性驗收 (Rule Specificity Check)',
          desc: '規則具備明確數字/時間門檻 (如 09:15 前禁止下單)，非空泛心態詞彙。',
        },
        {
          id: 't6-3',
          market: 'ALL',
          title: '跨模組閉環連動測試 (Closed-Loop Integration Check)',
          desc: '儲存規則後，模組 2 (技術決策) 與模組 5 (風控) 能同步讀取最新交易守則。',
        },
      ],
    },
  ],
};

// 提示詞沙盒範本內容
const SANDBOX_TEMPLATES = {
  'tw-2330': {
    prompt: `你是一位資深量化與技術分析師。請嚴格根據系統程式端預先算好的客觀數據進行多空決策，禁止自行心算指標或捏造不存在的歷史價位。

【標的資訊】
- 市場：台灣證券交易所 (TWSE)
- 股票代號：2330 台積電 (TSMC)
- 日線收盤價：1050.0 元 (台股 ≥1000 元跳動檔位為 5.0 元)
- 近期波段高低區間：[980.0 ~ 1080.0] 元

【預算指標 (系統計算，請勿心算)】
- MA5: 1045.0 | MA20: 1015.0 | MA60: 975.0 | MA200: 890.0
- RSI(14): 64.2 (健康強勢區，未達 75 嚴重超買)
- MACD(12,26,9): DIF=18.5, Signal=14.2, Hist=+4.3 (紅柱擴張)
- ATR(14): 22.5 元 (預期單日合理波動區間 ±2%)
- 程式識別支撐位：[1015.0, 980.0]
- 程式識別壓力位：[1080.0, 1100.0]

【輸出要求】
請產出合規 JSON 格式，必須包含：
1. action: "BUY" | "HOLD" | "SELL"
2. entry_price_range: 進場區間 (需對齊 5 元 Tick)
3. stop_loss_price: 停損價位
4. invalidation_criteria: 具體量化失效條件 (跌破何價位或指標)
5. step_by_step_rationale: 逐步推導邏輯`,
    schema: `{
  "ticker": "2330.TW",
  "action": "BUY",
  "trigger_condition": "若回測 MA5 (1045元) 守穩且成交量 > 35,000張",
  "order_type": "ROD",
  "entry_price": 1045.0,
  "take_profit_target": 1080.0,
  "stop_loss_price": 1010.0,
  "invalidation_criteria": "日收盤跌破 MA20 關鍵支撐 1015.0 元，或外資單日大額賣超逾 20,000 張",
  "step_by_step_rationale": [
    "1. 均線排列呈多頭發散，收盤價穩居 MA20 (1015) 之上",
    "2. RSI 64.2 保持多頭動能，MACD 紅柱持續擴大 (+4.3)",
    "3. 距離歷史波段前高 1080 元仍有波段空間，風險報酬比 1:2.3"
  ]
}`,
  },
  'us-nvda': {
    prompt: `你是一位美股機構量化分析師。請依據系統傳入數據進行 NVDA 決策分析。

【標的資訊】
- 市場：NASDAQ (美國市場)
- 標的：NVDA 輝達
- 收盤價：$138.50 | 盤前報價：$140.20 (+1.23% 跳空缺口)
- 歷史高低區間：[$115.0 ~ $144.0]
- 200MA (機構年線)：$118.20 | 50MA: $128.40
- RSI(14): 61.8 | ATR(14): $4.10
- 選擇權隱含波動 (Implied Move): ±5.8%

【分析要求】
評估盤前跳空缺口延續性，並給出明確進出場點與失效條件。`,
    schema: `{
  "ticker": "NVDA",
  "action": "BUY",
  "trigger_condition": "若開盤後 15 分鐘維持在盤前缺口 $139.50 之上",
  "order_type": "IOC",
  "entry_price": 140.0,
  "take_profit_target": 144.0,
  "stop_loss_price": 136.0,
  "invalidation_criteria": "盤中回補缺口並跌破 $138.00，或科技板塊 QQQ 出現大單拋售",
  "step_by_step_rationale": [
    "1. 盤前跳空突破近期密集成交區 ($138.50)",
    "2. 股價遠高於 200MA 機構年線 ($118.20)，長期多頭格局完好",
    "3. ATR $4.10 顯示波動未失控，距波段前高 $144 具備操作優勢"
  ]
}`,
  },
  'mod-3': {
    prompt: `你是一位資深財經新聞與交易策略轉化專家。請將以下事件新聞轉化為可量化交易策略。

【新聞資訊】
- 發布時間：盤前 07:30
- 標的：台積電 (2330.TW)
- 事件：宣布上調全年營收財測成長逾 30%，預期 AI 晶片需求持續供不應求。
- 事件前 5 日漲跌幅：+7.8% (市場已部分反映)
- 事件前 20 日漲跌幅：+14.5%
- 當前個股日 ATR：22.0 元 (單日波動 ±2.1%)

【強制檢驗】
1. 嚴格對比「已反映 (Priced-in)」與「未反映」因素，警示利多出盡可能。
2. 限制單日預期波動區間符合台股 ±10% 規則。
3. 輸出明確可量化的判斷失效條件 (Invalidation Criteria)。`,
    schema: `{
  "event_summary": "台積電上調全年營收成長至 30%+",
  "priced_in_factors": "事件前 20 日累計大漲 14.5%，法人已有預期，短線提防利多出盡震盪",
  "unpriced_factors": "明年資本支出低標由 300 億美元上修至 340 億美元，高階封裝 CoWoS 產能吃緊超乎外資模型",
  "expected_volatility_range": {
    "upper_bound": 1090.0,
    "lower_bound": 1030.0,
    "max_limit_pct": "受限台股單日 10% 漲跌停"
  },
  "invalidation_criteria": "若開盤衝高後爆出 60,000 張以上天量卻跌破開盤價，或收盤跌破法說前低點 1020 元則策略失效",
  "suggested_action": "拉回量縮至 1035~1045 元分批布局，不追開盤第一根急拉"
}`,
  },
  'mod-4': {
    prompt: `你是一位量化回測與風險診斷專家。請分析以下策略回測結果並提出具體改進建議。

【回測設定】
- 撮合機制：訊號於當日 Close 產生，強制以下一根 K 棒 Open (Next Bar Open) 成交
- 扣除稅費：台股手續費 0.1425% (6折) + 賣出證交稅 0.3%

【回測指標結果】
- 總交易次數：42 筆 (>= 30 筆，樣本數充足)
- 勝率：54.76%
- 獲利因子 (Profit Factor)：1.85 (總獲利 $485,000 / 總虧損 $262,000)
- 最大回撤 (MDD)：-14.8%
- 平均報酬率：+3.2%
- 虧損最大前 3 筆背景：皆發生於 2024 年 8 月初全球股市暴跌波段，因均線糾結後假突破買入引發連續停損。

【任務】
1. 診斷策略最大盲點。
2. 提出具體改進濾網（例如增加 RSI 超買超賣濾網或長天期均線濾網）。
3. 指定 Walk-Forward 樣本外測試驗證標準。`,
    schema: `{
  "backtest_evaluation": "策略具備正期望值 (PF 1.85)，且嚴格消除 Look-ahead bias 並計入 0.3% 證交稅",
  "primary_blindspot": "在盤整期或系統性崩跌初期，單純均線突破容易頻繁產生假信號 (Whipsaw)",
  "actionable_improvements": [
    "1. 增加大盤長均線濾網：僅當大盤指數位於 60MA 之上時才允許開新多單",
    "2. 增加 ATR 波動濾網：若突破當根 K 棒實體小於 1.2 倍 ATR，視為弱突破不進場",
    "3. 出場機制由固定週期改為追蹤停利 (Trailing Stop 2.5*ATR)"
  ],
  "walk_forward_protocol": "保留最近 20% (約 8 筆交易期間) 作為 Out-of-sample 驗證，目標使 MDD 壓縮至 10% 以內"
}`,
  },
  'mod-5': {
    prompt: `你是一位投資組合風險管理專家。請依據持倉資料進行隱藏相關性診斷與 -20% 壓力測試。

【目前持倉 (匯率 1 USD = 32.2 TWD)】
1. 2330 台積電 (TW): 市值 150 萬 TWD (34.8%)
2. 2317 鴻海 (TW): 市值 60 萬 TWD (13.9%)
3. 3017 奇鋐 (TW): 市值 50 萬 TWD (11.6%)
4. NVDA 輝達 (US): 市值 3.5 萬 USD (~112.7 萬 TWD, 26.1%)
5. 現金 (TWD/USD): 58.5 萬 TWD (13.6%)
總資產：431.2 萬 TWD

【計算結果】
- 股票持倉中 AI 伺服器與半導體供應鏈曝險比率：86.4%
- 組合加權 Beta：1.42
- 2330 與 NVDA 過去一年日報酬相關係數：0.78 (高度正相關)`,
    schema: `{
  "portfolio_health": "危險集中。表面持有 4 檔跨台美市場股票，實質 86.4% 曝險於同一 AI 因子，缺乏實質分散效果",
  "hidden_correlation_warning": "2330 與 NVDA 相關係數達 0.78，奇鋐與鴻海亦高度連動，市場回檔時將同步受創",
  "stress_test_market_down_20pct": {
    "estimated_portfolio_drawdown": "-28.4% (受 Beta 1.42 放大)",
    "estimated_capital_loss": "約 122.4 萬 TWD"
  },
  "rebalancing_plan_target_100pct": [
    {"asset": "2330 台積電", "target_weight": "25.0%", "action": "減碼 9.8%"},
    {"asset": "NVDA 輝達", "target_weight": "20.0%", "action": "減碼 6.1%"},
    {"asset": "2317 / 3017", "target_weight": "15.0%", "action": "精簡合併部位"},
    {"asset": "美債/防禦配置 (TLT/00679B)", "target_weight": "20.0%", "action": "新增配置"},
    {"asset": "現金儲備", "target_weight": "20.0%", "action": "提高流動性"}
  ],
  "retail_hedging_strategy": "小資散戶不建議保證金門檻過高之大台指，建議買進微台指空單 (保證金僅 1/10) 或布局台灣 50 反 1 (00632R) 作為下跌避險"
}`,
  },
  'mod-6': {
    prompt: `你是一位專業交易心理與日誌教練 (Trading Journal Coach)。請分析該交易員最近 20 筆實盤帳單，找出行為偏誤並制定 3 條立即執行的守則。

【交易統計摘要】
- 總交易：20 筆 (11 贏 9 輸，勝率 55%)
- 平均獲利：+$4,200 | 平均虧損：-$14,500 (賺賠比僅 0.29:1，嚴重失衡)
- 出場後 5 日表現追蹤：有 6 筆贏單在賣出後續漲逾 8% (過早賣飛)
- 連虧後行為：在 #07、#08 連續虧損後，#09 下單股數直接放大 3 倍 (報復性交易)
- 處置效應跡象：#03、#11、#18 虧損超過 10% 仍持續凹單超過 15 個交易日`,
    schema: `{
  "behavioral_biases_detected": [
    {
      "bias": "處置效應 (Disposition Effect)",
      "evidence_trade_ids": ["#03", "#11", "#18"],
      "analysis": "賺 2% 急著落袋賣飛，虧損 10% 以上卻抱著不放，導致賺賠比惡化至 0.29"
    },
    {
      "bias": "報復性翻倍交易 (Revenge Trading)",
      "evidence_trade_ids": ["#09"],
      "analysis": "在 #07 與 #08 停損後，#09 失去冷靜將部位擅自放大 3 倍，險些造成穿價斷頭"
    }
  ],
  "personalized_3_rules": [
    {
      "rule_num": 1,
      "name": "強制硬停損",
      "threshold": "單筆虧損達 5.0% 無條件執行市價 IOC 停損出場，嚴禁手動取消停損單"
    },
    {
      "rule_num": 2,
      "name": "連虧冷靜期與部位鎖定",
      "threshold": "連續 2 筆虧損後，當日強制停止下單；次日第一筆交易部位嚴格限制為平時標準倉位的 50%"
    },
    {
      "rule_num": 3,
      "name": "移動鎖利防賣飛",
      "threshold": "獲利達 3% 後不得手動市價停利，改以波段低點或 5MA 作為移動出場基準"
    }
  ],
  "pre_trade_checklist_binding": "已將上述 3 條規則注入系統下單前彈跳確認視窗"
}`,
  },
};

// Python 範本程式碼 (供展示與複製)
const PYTHON_TEMPLATE_CODE = `"""
台美雙市場資料路由與技術指標計算核心範本 (Python)
完全遵循「在程式碼端預先算好指標，禁止讓 AI 心算」原則
"""

from typing import List, Dict, Any, Optional
import math

class DualMarketRouter:
    """雙市場代號正規化與規格路由"""
    
    @staticmethod
    def normalize_symbol(symbol: str) -> Dict[str, str]:
        sym = symbol.strip().upper()
        if sym.endswith(".TW") or sym.endswith(".TWO") or (sym.isdigit() and len(sym) >= 4):
            market = "TW"
            clean_sym = sym if "." in sym else f"{sym}.TW"
        else:
            market = "US"
            clean_sym = sym
        return {"market": market, "symbol": clean_sym}

    @staticmethod
    def get_tick_size(price: float, market: str) -> float:
        """台股 6 級 Tick Size vs 美股 0.01 美元"""
        if market == "TW":
            if price < 10.0: return 0.01
            elif price < 50.0: return 0.05
            elif price < 100.0: return 0.10
            elif price < 500.0: return 0.50
            elif price < 1000.0: return 1.00
            else: return 5.00
        return 0.01

def calculate_indicators(closes: List[float], highs: List[float], lows: List[float]) -> Dict[str, Any]:
    """純 Python 標準庫計算關鍵指標 (SMA, RSI, ATR)"""
    n = len(closes)
    
    # 1. 均線
    ma5 = round(sum(closes[-5:]) / 5, 2) if n >= 5 else None
    ma20 = round(sum(closes[-20:]) / 20, 2) if n >= 20 else None
    ma60 = round(sum(closes[-60:]) / 60, 2) if n >= 60 else None
    
    # 2. RSI 14 (Wilder's Smoothing)
    if n >= 15:
        deltas = [closes[i] - closes[i-1] for i in range(1, n)]
        gains = [max(d, 0) for d in deltas]
        losses = [max(-d, 0) for d in deltas]
        avg_gain = sum(gains[:14]) / 14
        avg_loss = sum(losses[:14]) / 14
        for i in range(14, len(deltas)):
            avg_gain = (avg_gain * 13 + gains[i]) / 14
            avg_loss = (avg_loss * 13 + losses[i]) / 14
        rs = avg_gain / avg_loss if avg_loss != 0 else 999.0
        rsi14 = round(100 - (100 / (1 + rs)), 2)
    else:
        rsi14 = None
        
    return {
        "current_close": closes[-1],
        "MA5": ma5,
        "MA20": ma20,
        "MA60": ma60,
        "RSI14": rsi14
    }
`;

// 應用程式狀態管理器
class DashboardApp {
  constructor() {
    this.storageKey = 'ai_trading_checklist_status_v12';
    this.statusMap = this.loadState();
    this.currentMarket = 'ALL';
    this.currentTech = 'PYTHON';
    this.currentSubModule = 'mod-2';
    this.activeChecklistTag = 'ALL';

    this.initElements();
    this.bindEvents();
    this.renderAll();
  }

  loadState() {
    try {
      const saved = localStorage.getItem(this.storageKey);
      return saved ? JSON.parse(saved) : {};
    } catch (e) {
      console.warn('Could not load local storage', e);
      return {};
    }
  }

  saveState() {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.statusMap));
    } catch (e) {
      console.warn('Could not save to local storage', e);
    }
  }

  initElements() {
    // 導覽標籤
    this.mainTabs = document.querySelectorAll('.tab-btn');
    this.tabPanes = document.querySelectorAll('.tab-pane');
    this.subTabBtns = document.querySelectorAll('.sub-tab-btn');
    this.moduleCards = document.querySelectorAll('.module-card');

    // 篩選與操作按鈕
    this.marketFilterBtns = document.querySelectorAll('#market-filter .btn-segment');
    this.techFilterBtns = document.querySelectorAll('#tech-filter .btn-segment');
    this.btnExportMd = document.getElementById('btn-export-markdown');
    this.btnResetData = document.getElementById('btn-reset-data');

    // Modal
    this.modalExport = document.getElementById('modal-export');
    this.btnCloseModal = document.getElementById('btn-close-modal');
    this.btnCopyMarkdown = document.getElementById('btn-copy-markdown');
    this.btnDownloadMarkdown = document.getElementById('btn-download-markdown');
    this.textareaMarkdown = document.getElementById('markdown-export-content');

    // KPI 顯示節點
    this.overallPercentage = document.getElementById('overall-percentage');
    this.overallRatioText = document.getElementById('overall-ratio-text');
    this.overallProgressBar = document.getElementById('overall-progress-bar');
    this.overallBadge = document.getElementById('overall-badge');

    this.devCountBadge = document.getElementById('dev-count-badge');
    this.devPercentage = document.getElementById('dev-percentage');
    this.devProgressBar = document.getElementById('dev-progress-bar');

    this.testCountBadge = document.getElementById('test-count-badge');
    this.testPercentage = document.getElementById('test-percentage');
    this.testProgressBar = document.getElementById('test-progress-bar');

    // 全域清單與 Toast
    this.fullChecklistContainer = document.getElementById('full-checklist-container');
    this.checklistFilterTags = document.querySelectorAll('.btn-filter-tag');
    this.toast = document.getElementById('toast');

    // 程式碼範本
    const pyCodeEl = document.getElementById('code-python-template');
    if (pyCodeEl) {
      pyCodeEl.textContent = PYTHON_TEMPLATE_CODE;
    }
  }

  bindEvents() {
    // 主標籤切換
    this.mainTabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        this.mainTabs.forEach((t) => {
          t.classList.remove('active');
        });
        this.tabPanes.forEach((p) => {
          p.classList.remove('active');
        });
        tab.classList.add('active');
        const targetId = tab.dataset.tab;
        const targetPane = document.getElementById(targetId);
        if (targetPane) targetPane.classList.add('active');
      });
    });

    // 模組子標籤切換
    this.subTabBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        this.subTabBtns.forEach((b) => {
          b.classList.remove('active');
        });
        this.moduleCards.forEach((c) => {
          c.classList.remove('active');
        });
        btn.classList.add('active');
        this.currentSubModule = btn.dataset.mod;
        const targetView = document.getElementById(`view-${this.currentSubModule}`);
        if (targetView) targetView.classList.add('active');
      });
    });

    // 市場篩選
    this.marketFilterBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        this.marketFilterBtns.forEach((b) => {
          b.classList.remove('active');
        });
        btn.classList.add('active');
        this.currentMarket = btn.dataset.market;
        this.applyFilterVisibility();
        this.showToast(`已切換市場模式：${btn.textContent}`);
      });
    });

    // 技術路線篩選
    this.techFilterBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        this.techFilterBtns.forEach((b) => {
          b.classList.remove('active');
        });
        btn.classList.add('active');
        this.currentTech = btn.dataset.tech;
        this.showToast(`已切換技術路線：${btn.textContent}`);
      });
    });

    // 重設進度
    this.btnResetData.addEventListener('click', () => {
      if (confirm('確定要重設所有檢查清單與測試項目嗎？這將會清空目前儲存的打勾狀態。')) {
        this.statusMap = {};
        this.saveState();
        this.renderAll();
        this.showToast('已成功重設所有進度記錄！');
      }
    });

    // 匯出 Markdown Modal
    this.btnExportMd.addEventListener('click', () => {
      const md = this.generateMarkdownReport();
      this.textareaMarkdown.value = md;
      this.modalExport.style.display = 'flex';
    });

    this.btnCloseModal.addEventListener('click', () => {
      this.modalExport.style.display = 'none';
    });

    this.modalExport.addEventListener('click', (e) => {
      if (e.target === this.modalExport) {
        this.modalExport.style.display = 'none';
      }
    });

    this.btnCopyMarkdown.addEventListener('click', () => {
      navigator.clipboard.writeText(this.textareaMarkdown.value).then(() => {
        this.showToast('已複製 Markdown 報告至剪貼簿！');
      });
    });

    this.btnDownloadMarkdown.addEventListener('click', () => {
      const blob = new Blob([this.textareaMarkdown.value], {
        type: 'text/markdown;charset=utf-8;',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `台美股AI交易系統_開發與檢核進度報告_${new Date().toISOString().slice(0, 10)}.md`;
      a.click();
      URL.revokeObjectURL(url);
      this.showToast('已下載進度報告檔案！');
    });

    // 全域清單過濾標籤
    this.checklistFilterTags.forEach((btn) => {
      btn.addEventListener('click', () => {
        this.checklistFilterTags.forEach((b) => {
          b.classList.remove('active');
        });
        btn.classList.add('active');
        this.activeChecklistTag = btn.dataset.tag;
        this.renderFullChecklist();
      });
    });

    // 提示詞沙盒 Preset 與複製監聽
    this.bindSandboxEvents();
  }

  bindSandboxEvents() {
    // 模組 2 Preset 切換
    const btn2330 = document.getElementById('btn-preset-2330');
    const btnNvda = document.getElementById('btn-preset-nvda');
    const codePromptMod2 = document.getElementById('code-prompt-mod-2');
    const codeSchemaMod2 = document.getElementById('code-schema-mod-2');

    if (btn2330 && btnNvda) {
      btn2330.addEventListener('click', () => {
        btn2330.classList.add('active');
        btnNvda.classList.remove('active');
        codePromptMod2.textContent = SANDBOX_TEMPLATES['tw-2330'].prompt;
        codeSchemaMod2.textContent = SANDBOX_TEMPLATES['tw-2330'].schema;
      });

      btnNvda.addEventListener('click', () => {
        btnNvda.classList.add('active');
        btn2330.classList.remove('active');
        codePromptMod2.textContent = SANDBOX_TEMPLATES['us-nvda'].prompt;
        codeSchemaMod2.textContent = SANDBOX_TEMPLATES['us-nvda'].schema;
      });

      // 預設載入 2330
      codePromptMod2.textContent = SANDBOX_TEMPLATES['tw-2330'].prompt;
      codeSchemaMod2.textContent = SANDBOX_TEMPLATES['tw-2330'].schema;
    }

    // 模組 3 ~ 6 沙盒初始填充
    for (let m = 3; m <= 6; m++) {
      const pEl = document.getElementById(`code-prompt-mod-${m}`);
      const sEl = document.getElementById(`code-schema-mod-${m}`);
      if (pEl && SANDBOX_TEMPLATES[`mod-${m}`]) {
        pEl.textContent = SANDBOX_TEMPLATES[`mod-${m}`].prompt;
      }
      if (sEl && SANDBOX_TEMPLATES[`mod-${m}`]) {
        sEl.textContent = SANDBOX_TEMPLATES[`mod-${m}`].schema;
      }

      // 複製按鈕
      const copyBtn = document.getElementById(`btn-copy-mod-${m}`);
      if (copyBtn && pEl) {
        copyBtn.addEventListener('click', () => {
          navigator.clipboard.writeText(pEl.textContent).then(() => {
            this.showToast(`已複製模組 0${m} Prompt 至剪貼簿！`);
          });
        });
      }
    }

    const copyBtnMod2 = document.getElementById('btn-copy-mod-2');
    if (copyBtnMod2 && codePromptMod2) {
      copyBtnMod2.addEventListener('click', () => {
        navigator.clipboard.writeText(codePromptMod2.textContent).then(() => {
          this.showToast('已複製模組 02 Prompt 至剪貼簿！');
        });
      });
    }
  }

  renderAll() {
    this.renderModuleChecklists();
    this.renderFullChecklist();
    this.updateStats();
    this.applyFilterVisibility();
  }

  renderModuleChecklists() {
    SYSTEM_DATA.modules.forEach((mod) => {
      // 1. 渲染開發清單
      const devUl = document.getElementById(`list-dev-${mod.id}`);
      if (devUl) {
        devUl.innerHTML = '';
        mod.dev_items.forEach((item) => {
          const li = this.createCheckItemElement(item, 'DEV');
          devUl.appendChild(li);
        });
      }

      // 2. 渲染測試清單
      const testUl = document.getElementById(`list-test-${mod.id}`);
      if (testUl) {
        testUl.innerHTML = '';
        mod.test_items.forEach((item) => {
          const li = this.createCheckItemElement(item, 'TEST');
          testUl.appendChild(li);
        });
      }
    });
  }

  createCheckItemElement(item, type) {
    const isChecked = !!this.statusMap[item.id];
    const li = document.createElement('li');
    li.className = `check-item ${isChecked ? 'completed' : ''}`;
    li.dataset.id = item.id;
    li.dataset.market = item.market;
    li.dataset.type = type;

    const marketBadgeClass = item.market === 'TW' ? 'tw' : item.market === 'US' ? 'us' : 'all';
    const marketBadgeText = item.market === 'TW' ? 'TW' : item.market === 'US' ? 'US' : 'ALL';

    li.innerHTML = `
      <input type="checkbox" id="chk-${item.id}" ${isChecked ? 'checked' : ''}>
      <label class="item-content" for="chk-${item.id}">
        <div class="item-title">
          <span class="tag-badge ${marketBadgeClass}">[${marketBadgeText}]</span>
          <span>${item.title}</span>
        </div>
        <div class="item-desc">${item.desc}</div>
      </label>
    `;

    const chk = li.querySelector('input[type="checkbox"]');
    chk.addEventListener('change', (e) => {
      this.statusMap[item.id] = e.target.checked;
      this.saveState();
      li.classList.toggle('completed', e.target.checked);
      this.updateStats();
      this.syncCheckboxes(item.id, e.target.checked);
    });

    li.addEventListener('click', (e) => {
      if (e.target !== chk && !e.target.closest('label')) {
        chk.click();
      }
    });

    return li;
  }

  syncCheckboxes(id, checked) {
    // 同步其他地方可能存在的相同 id checkbox (例如全域清單)
    document
      .querySelectorAll(`input[id="chk-${id}"], input[id="full-chk-${id}"]`)
      .forEach((input) => {
        input.checked = checked;
        const parentItem = input.closest('.check-item');
        if (parentItem) {
          parentItem.classList.toggle('completed', checked);
        }
      });
  }

  renderFullChecklist() {
    if (!this.fullChecklistContainer) return;
    this.fullChecklistContainer.innerHTML = '';

    let allItems = [];
    SYSTEM_DATA.modules.forEach((mod) => {
      mod.dev_items.forEach((d) => {
        allItems.push({ ...d, modTitle: mod.title, modNum: mod.num, type: 'DEV' });
      });
      mod.test_items.forEach((t) => {
        allItems.push({ ...t, modTitle: mod.title, modNum: mod.num, type: 'TEST' });
      });
    });

    // 依標籤過濾
    if (this.activeChecklistTag === 'DEV') {
      allItems = allItems.filter((i) => i.type === 'DEV');
    } else if (this.activeChecklistTag === 'TEST') {
      allItems = allItems.filter((i) => i.type === 'TEST');
    } else if (this.activeChecklistTag === 'UNCHECKED') {
      allItems = allItems.filter((i) => !this.statusMap[i.id]);
    }

    // 依市場模式過濾
    if (this.currentMarket !== 'ALL') {
      allItems = allItems.filter((i) => i.market === 'ALL' || i.market === this.currentMarket);
    }

    allItems.forEach((item) => {
      const isChecked = !!this.statusMap[item.id];
      const div = document.createElement('div');
      div.className = `check-item ${isChecked ? 'completed' : ''}`;
      div.dataset.id = item.id;
      div.dataset.market = item.market;
      div.dataset.type = item.type;

      const typeBadge = item.type === 'DEV' ? '🛠️ 開發' : '🧪 驗收';
      const marketBadgeClass = item.market === 'TW' ? 'tw' : item.market === 'US' ? 'us' : 'all';

      div.innerHTML = `
        <input type="checkbox" id="full-chk-${item.id}" ${isChecked ? 'checked' : ''}>
        <label class="item-content" for="full-chk-${item.id}">
          <div class="item-title">
            <span class="tag-badge ${marketBadgeClass}">[${item.market}]</span>
            <span style="color: var(--accent-cyan); font-family: var(--font-mono); font-size: 0.78rem; margin-right: 0.4rem;">[模組 ${item.modNum} · ${typeBadge}]</span>
            <span>${item.title}</span>
          </div>
          <div class="item-desc">${item.desc}</div>
        </label>
      `;

      const chk = div.querySelector('input[type="checkbox"]');
      chk.addEventListener('change', (e) => {
        this.statusMap[item.id] = e.target.checked;
        this.saveState();
        div.classList.toggle('completed', e.target.checked);
        this.updateStats();
        this.syncCheckboxes(item.id, e.target.checked);
      });

      div.addEventListener('click', (e) => {
        if (e.target !== chk && !e.target.closest('label')) {
          chk.click();
        }
      });

      this.fullChecklistContainer.appendChild(div);
    });
  }

  applyFilterVisibility() {
    const market = this.currentMarket;
    document.querySelectorAll('.check-item').forEach((el) => {
      const itemMarket = el.dataset.market;
      if (market === 'ALL' || itemMarket === 'ALL' || itemMarket === market) {
        el.style.display = 'flex';
      } else {
        el.style.display = 'none';
      }
    });
    this.renderFullChecklist();
  }

  updateStats() {
    let totalDev = 0;
    let checkedDev = 0;
    let totalTest = 0;
    let checkedTest = 0;

    SYSTEM_DATA.modules.forEach((mod) => {
      const modDevTotal = mod.dev_items.length;
      const modDevChecked = mod.dev_items.filter((i) => !!this.statusMap[i.id]).length;
      const modTestTotal = mod.test_items.length;
      const modTestChecked = mod.test_items.filter((i) => !!this.statusMap[i.id]).length;

      totalDev += modDevTotal;
      checkedDev += modDevChecked;
      totalTest += modTestTotal;
      checkedTest += modTestChecked;

      // 更新模組內部計數
      const countDevEl = document.getElementById(`count-dev-${mod.id}`);
      if (countDevEl) countDevEl.textContent = `${modDevChecked} / ${modDevTotal}`;

      const countTestEl = document.getElementById(`count-test-${mod.id}`);
      if (countTestEl) countTestEl.textContent = `${modTestChecked} / ${modTestTotal}`;

      const modTotal = modDevTotal + modTestTotal;
      const modChecked = modDevChecked + modTestChecked;
      const modRate = modTotal > 0 ? Math.round((modChecked / modTotal) * 100) : 0;

      const rateEl = document.getElementById(`rate-${mod.id}`);
      if (rateEl) rateEl.textContent = `${modRate}%`;

      const badgeEl = document.getElementById(`badge-${mod.id}`);
      if (badgeEl) badgeEl.textContent = `${modChecked}/${modTotal}`;
    });

    const totalAll = totalDev + totalTest;
    const checkedAll = checkedDev + checkedTest;
    const overallPct = totalAll > 0 ? Math.round((checkedAll / totalAll) * 100) : 0;
    const devPct = totalDev > 0 ? Math.round((checkedDev / totalDev) * 100) : 0;
    const testPct = totalTest > 0 ? Math.round((checkedTest / totalTest) * 100) : 0;

    // 更新 KPI 儀表板
    this.overallPercentage.textContent = `${overallPct}%`;
    this.overallRatioText.textContent = `總計 ${checkedAll} / ${totalAll} 項目完成`;
    this.overallProgressBar.style.width = `${overallPct}%`;

    if (overallPct === 100) {
      this.overallBadge.textContent = '全數驗收完成 🚀';
      this.overallBadge.style.color = 'var(--accent-emerald)';
    } else if (overallPct > 0) {
      this.overallBadge.textContent = '開發衝刺中 ⚡';
      this.overallBadge.style.color = 'var(--accent-cyan)';
    } else {
      this.overallBadge.textContent = '準備啟動 🎯';
      this.overallBadge.style.color = 'var(--text-muted)';
    }

    this.devCountBadge.textContent = `${checkedDev} / ${totalDev}`;
    this.devPercentage.textContent = `${devPct}%`;
    this.devProgressBar.style.width = `${devPct}%`;

    this.testCountBadge.textContent = `${checkedTest} / ${totalTest}`;
    this.testPercentage.textContent = `${testPct}%`;
    this.testProgressBar.style.width = `${testPct}%`;
  }

  generateMarkdownReport() {
    let totalDev = 0;
    let checkedDev = 0;
    let totalTest = 0;
    let checkedTest = 0;

    SYSTEM_DATA.modules.forEach((mod) => {
      totalDev += mod.dev_items.length;
      checkedDev += mod.dev_items.filter((i) => !!this.statusMap[i.id]).length;
      totalTest += mod.test_items.length;
      checkedTest += mod.test_items.filter((i) => !!this.statusMap[i.id]).length;
    });

    const totalAll = totalDev + totalTest;
    const checkedAll = checkedDev + checkedTest;
    const overallPct = totalAll > 0 ? Math.round((checkedAll / totalAll) * 100) : 0;

    let md = `# 台美股 AI 交易分析系統 — 開發與檢核進度報告\n`;
    md += `- 整體完成度：**${overallPct}%**（開發檢查清單：${checkedDev}/${totalDev}｜驗證測試：${checkedTest}/${totalTest}）\n`;
    md += `- 目標市場模式：${this.currentMarket}｜技術路線：${this.currentTech}\n\n`;

    SYSTEM_DATA.modules.forEach((mod) => {
      md += `## ${mod.num.startsWith('0') ? mod.num.slice(1) : mod.num}. ${mod.title}\n`;
      md += `> ${mod.subtitle}\n\n`;

      md += `### 1. 開發檢查清單 (Dev Checklist)\n`;
      mod.dev_items.forEach((item) => {
        const checkMark = this.statusMap[item.id] ? 'x' : ' ';
        md += `- [${checkMark}] [${item.market}] ${item.title}\n`;
      });
      md += `\n`;

      md += `### 2. 驗證與驗收標準 (Verification Protocol)\n`;
      mod.test_items.forEach((item) => {
        const checkMark = this.statusMap[item.id] ? 'x' : ' ';
        md += `- [${checkMark}] **${item.title}**\n`;
        md += `  - 驗收項目：${item.desc}\n`;
      });
      md += `\n`;
    });

    return md;
  }

  showToast(msg) {
    if (!this.toast) return;
    this.toast.textContent = msg;
    this.toast.classList.add('show');
    setTimeout(() => {
      this.toast.classList.remove('show');
    }, 2400);
  }
}

// 啟動主控台
document.addEventListener('DOMContentLoaded', () => {
  window.app = new DashboardApp();
});
