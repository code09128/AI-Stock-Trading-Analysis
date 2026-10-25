(() => {
  // 股市主題線條圖示（Lucide 風格 24×24，stroke 用 currentColor 跟著文字顏色）
  const ICON_PATHS = {
    candles: (
      <>
        <path d="M3 3v18h18" />
        <path d="M9 5v4" />
        <rect width="4" height="6" x="7" y="9" rx="1" />
        <path d="M9 15v2" />
        <path d="M17 3v2" />
        <rect width="4" height="8" x="15" y="5" rx="1" />
        <path d="M17 13v3" />
      </>
    ),
    trend: (
      <>
        <path d="M3 3v18h18" />
        <path d="m19 9-5 5-4-4-3 3" />
        <path d="M15 9h4v4" />
      </>
    ),
    news: (
      <>
        <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2" />
        <path d="M18 14h-8" />
        <path d="M15 18h-5" />
        <path d="M10 6h8v4h-8V6Z" />
      </>
    ),
    backtest: (
      <>
        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
        <path d="M3 3v5h5" />
        <path d="M12 7v5l4 2" />
      </>
    ),
    allocation: (
      <>
        <path d="M21.21 15.89A10 10 0 1 1 8 2.83" />
        <path d="M22 12A10 10 0 0 0 12 2v10z" />
      </>
    ),
    journal: (
      <>
        <path d="M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4" />
        <path d="M2 6h4" />
        <path d="M2 10h4" />
        <path d="M2 14h4" />
        <path d="M2 18h4" />
        <path d="M18.4 2.6a2.17 2.17 0 0 1 3 3L16 11l-4 1 1-4Z" />
      </>
    ),
    selfcheck: (
      <>
        <rect width="8" height="4" x="8" y="2" rx="1" />
        <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
        <path d="m9 14 2 2 4-4" />
      </>
    ),
    settings: (
      <>
        <path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3" />
        <path d="M14 2v4M8 10v4M16 18v4" />
      </>
    ),
    guide: (
      <>
        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
        <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
      </>
    ),
    bot: (
      <>
        <path d="M12 8V4H8" />
        <rect width="16" height="12" x="4" y="8" rx="2" />
        <path d="M2 14h2M20 14h2M15 13v2M9 13v2" />
      </>
    ),
  };

  function NavIcon({ name, className = 'w-[18px] h-[18px]' }) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        aria-hidden="true"
      >
        {ICON_PATHS[name]}
      </svg>
    );
  }

  const NAV_ITEMS = [
    {
      id: 'watch',
      group: '行情',
      short: '看盤',
      code: 'START',
      title: '看盤',
      subtitle: '自選股、我的持股、即時報價與模擬下單',
      icon: 'candles',
    },
    {
      id: 'mod1',
      group: '分析',
      short: '技術分析',
      title: '技術分析',
      subtitle: 'K 線、均線、支撐壓力與多空情境',
      icon: 'trend',
    },
    {
      id: 'mod2',
      group: '分析',
      short: '新聞判斷',
      title: '新聞判斷',
      subtitle: '新聞影響、是否已反映在股價、預期波動區間',
      icon: 'news',
    },
    {
      id: 'mod3',
      group: '分析',
      short: '策略回測',
      title: '策略回測',
      subtitle: '9 種策略＋自訂條件積木、驗證、今日訊號、策略組合、K 線回放、Pine 與 PDF',
      icon: 'backtest',
    },
    {
      id: 'mod4',
      group: '風控與檢討',
      short: '組合風控',
      title: '組合風控',
      subtitle: '資產配置、曝險與多情境壓力測試',
      icon: 'allocation',
    },
    {
      id: 'mod5',
      group: '風控與檢討',
      short: '交易檢討',
      title: '交易檢討',
      subtitle: '交易績效統計、行為偏誤與個人交易規則',
      icon: 'journal',
    },
    {
      id: 'visual_tests',
      group: '系統',
      short: '系統自檢',
      title: '系統自檢',
      subtitle: '核心計算規則的自動檢查',
      icon: 'selfcheck',
    },
    {
      id: 'settings',
      group: '系統',
      short: '設定',
      title: '設定',
      subtitle: 'AI 連線與資料管理',
      icon: 'settings',
    },
    {
      id: 'guide',
      group: '系統',
      short: '說明',
      code: 'HELP',
      title: '說明',
      subtitle: '操作流程、資料來源與名詞解釋',
      icon: 'guide',
    },
  ];

  // 範例只放新聞標題；事件前漲跌與停損條件留空，由系統用真實日 K 與支撐壓力計算（不要寫死價位，價位會過時）
  const NEWS_PRESETS = [
    {
      label: '台積電法說利多（檢驗是否已 Priced-in）',
      target: '2330.TW',
      headline: '法說會公布毛利率上修並擴大 CoWoS 產能，惟法說前股價已有一段漲幅',
      sentiment: 'POSITIVE',
      ret_5d_pct: '',
      ret_20d_pct: '',
      invalidation_criteria: '',
    },
    {
      label: '輝達財報盤後突破',
      target: 'NVDA',
      headline: 'Blackwell 伺服器出貨超預期，資料中心營收季增 22%，盤後跳空突破整理區',
      sentiment: 'POSITIVE',
      ret_5d_pct: '',
      ret_20d_pct: '',
      invalidation_criteria: '',
    },
    {
      label: '聯發科利空測試（模糊停損條件會被退回）',
      target: '2454.TW',
      headline: '手機晶片客戶庫存調整傳聞再起，外資單日調節賣超',
      sentiment: 'NEGATIVE',
      ret_5d_pct: '',
      ret_20d_pct: '',
      invalidation_criteria: '如果感覺盤勢不對勁或市場氣氛變差就考慮賣出',
    },
  ];

  const DEFAULT_HOLDINGS = [
    { symbol: '2330', market: 'TW', shares: 1000, price: 1050.0, target_pct: 35.0 },
    { symbol: '0050', market: 'TW', shares: 2000, price: 190.0, target_pct: 25.0 },
    { symbol: 'NVDA', market: 'US', shares: 100, price: 138.6, target_pct: 20.0 },
  ];

  const DEFAULT_JOURNAL = [
    {
      trade_id: '#01',
      symbol: '2330.TW',
      entry_time: '09:10',
      exit_time: '13:20',
      entry_price: 1000.0,
      exit_price: 1020.0,
      shares: 1000,
      net_pnl: 20000.0,
      return_pct: 2.0,
      emotion_score: 2,
      high_5d_after_exit: 1095.0,
    },
    {
      trade_id: '#02',
      symbol: '2603.TW',
      entry_time: '09:05',
      exit_time: '13:30',
      entry_price: 180.0,
      exit_price: 175.0,
      shares: 1000,
      net_pnl: -5000.0,
      return_pct: -2.7,
      emotion_score: 3,
      high_5d_after_exit: 176.0,
    },
    {
      trade_id: '#03',
      symbol: '3017.TW',
      entry_time: '09:15',
      exit_time: '10:00',
      entry_price: 600.0,
      exit_price: 528.0,
      shares: 1000,
      net_pnl: -72000.0,
      return_pct: -12.0,
      emotion_score: 10,
      high_5d_after_exit: 530.0,
    },
    {
      trade_id: '#04',
      symbol: '2330.TW',
      entry_time: '09:02',
      exit_time: '09:35',
      entry_price: 1020.0,
      exit_price: 1010.0,
      shares: 3000,
      net_pnl: -30000.0,
      return_pct: -1.0,
      emotion_score: 8,
      high_5d_after_exit: 1015.0,
    },
    {
      trade_id: '#08',
      symbol: 'NVDA',
      entry_time: '21:35',
      exit_time: '23:50',
      entry_price: 140.0,
      exit_price: 124.0,
      shares: 200,
      net_pnl: -3200.0,
      return_pct: -11.4,
      emotion_score: 9,
      high_5d_after_exit: 125.0,
    },
    {
      trade_id: '#09',
      symbol: 'NVDA',
      entry_time: '21:30',
      exit_time: '22:15',
      entry_price: 125.0,
      exit_price: 122.0,
      shares: 600,
      net_pnl: -1800.0,
      return_pct: -2.4,
      emotion_score: 7,
      high_5d_after_exit: 128.0,
    },
  ];

  /**
   * 互動式 SVG K線 + 十字準星 (Crosshair) + 懸停報價列 + 成交量副圖 (技術分析 專用)
   */

  // 策略回測預設值：策略參數放在 params（依策略不同），風控設定一起送到後端
  const DEFAULT_BACKTEST = {
    target_asset: '2330.TW',
    strategy: 'ma_cross',
    params: { fast_ma: 5, slow_ma: 20 },
    initial_capital: 1000000,
    commission_discount: 0.6,
    period_years: 1,
    sizing_mode: 'percent',
    sizing_value: 100,
    atr_mult: 2,
    stop_loss_pct: 0,
    trailing_pct: 0,
    market_filter: false,
    filter_ma: 60,
  };

  window.TA = Object.assign(window.TA || {}, {
    NAV_ITEMS,
    DEFAULT_BACKTEST,
    NavIcon,
    NEWS_PRESETS,
    DEFAULT_HOLDINGS,
    DEFAULT_JOURNAL,
  });
})();
