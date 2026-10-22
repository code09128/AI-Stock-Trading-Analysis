const { useState, useEffect, useCallback, useRef } = React;
const { NAV_ITEMS, NavIcon, NEWS_PRESETS, DEFAULT_HOLDINGS, DEFAULT_JOURNAL } = window.TA;
function App() {
  const [activeTab, setActiveTab] = useState('watch');
  const aiCfg = window.TA.useAISettings();
  // 技術分析的買賣決策若交給 AI，就不自動每 5 秒刷新（否則會每 5 秒呼叫一次模型）
  const aiDecisionOn =
    aiCfg.scope.mod1 !== false && !!aiCfg.profiles.find((p) => p.id === aiCfg.activeId);
  const [sidebarOpen, setSidebarOpen] = useState(() => window.TA.readLS('tw_us_sidebar_v1', true));
  const [tourOpen, setTourOpen] = useState(() => !window.TA.tourAlreadyDone());
  const [tourStart, setTourStart] = useState(0);
  const [health, setHealth] = useState(null);
  const [toastMsg, setToastMsg] = useState(null);

  // Backdrop Modals (保留原有 ID 與 Backdrop 點擊關閉行為)
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);

  // 技術分析 狀態與動態看盤控制
  const [m1Ticker, setM1Ticker] = useState('2330.TW');
  const [m1BarCount, setM1BarCount] = useState(30);
  const [m1Timeframe, setM1Timeframe] = useState('D');
  const [m1Context, setM1Context] = useState(null);
  const [m1Loading, setM1Loading] = useState(false);
  const [m1Data, setM1Data] = useState(null);
  const [isLivePolling, setIsLivePolling] = useState(true);
  const [countdownSec, setCountdownSec] = useState(5);
  const [priceFlash, setPriceFlash] = useState(null); // "UP" | "DOWN" | null
  const prevPriceRef = useRef(null);

  // 新聞判斷 狀態
  const [m2Form, setM2Form] = useState(NEWS_PRESETS[0]);
  const [m2Loading, setM2Loading] = useState(false);
  const [m2Data, setM2Data] = useState(null);

  // 策略回測 狀態
  const [m3Form, setM3Form] = useState({
    target_asset: '2330.TW',
    fast_ma: 5,
    slow_ma: 20,
    initial_capital: 1000000,
    commission_discount: 0.6,
  });
  const [m3Loading, setM3Loading] = useState(false);
  const [m3Data, setM3Data] = useState(null);

  // 組合風控 狀態
  const [m4Holdings, setM4Holdings] = useState(DEFAULT_HOLDINGS);
  const [m4CashPct, setM4CashPct] = useState(20.0);
  const [m4Beta, setM4Beta] = useState('');
  const [m4Live, setM4Live] = useState(true);
  const [pendingRun4, setPendingRun4] = useState(false);
  const [pendingRun3, setPendingRun3] = useState(false);
  const [pendingRun5, setPendingRun5] = useState(false);
  const [m5Source, setM5Source] = useState('sample'); // 'mine' | 'sample'
  const [m4Loading, setM4Loading] = useState(false);
  const [m4Data, setM4Data] = useState(null);

  // 交易檢討 狀態
  const [m5Entries, setM5Entries] = useState(DEFAULT_JOURNAL);
  const [m5Loading, setM5Loading] = useState(false);
  const [m5Data, setM5Data] = useState(null);

  // 系統 12 項自檢狀態
  const [testSuiteRunning, setTestSuiteRunning] = useState(false);
  const [testSuiteReport, setTestSuiteReport] = useState(null);

  const showToast = useCallback((msg) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 2600);
  }, []);

  // 技術分析 分析與盤中動態跳動
  const runMod1 = useCallback(
    async ({ overrideTicker, overrideBarCount, overrideTimeframe, useAI = true } = {}) => {
      const targetTicker = overrideTicker || m1Ticker;
      const targetBars = overrideBarCount || m1BarCount;
      const targetTf = overrideTimeframe || m1Timeframe;
      setM1Loading(true);
      try {
        const res = await fetch('/api/mod1/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ticker: targetTicker,
            bar_count: targetBars,
            timeframe: targetTf,
            ai: (() => {
              const cfg = window.TA.loadAI();
              // 只有使用者主動查詢時才把決策交給 AI；首次載入一律用規則引擎
              return !useAI || cfg.scope.mod1 === false
                ? null
                : window.TA.cleanProfile(window.TA.activeProfile(cfg));
            })(),
          }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        const newClose = data?.snapshot?.latest_close;
        if (prevPriceRef.current !== null && newClose !== undefined) {
          if (newClose > prevPriceRef.current) {
            setPriceFlash('UP');
            setTimeout(() => setPriceFlash(null), 900);
          } else if (newClose < prevPriceRef.current) {
            setPriceFlash('DOWN');
            setTimeout(() => setPriceFlash(null), 900);
          }
        }
        if (newClose !== undefined) prevPriceRef.current = newClose;
        setM1Data(data);
      } catch (err) {
        showToast(`技術分析 分析失敗: ${err.message}`);
      } finally {
        setM1Loading(false);
      }
    },
    [m1Ticker, m1BarCount, m1Timeframe, showToast],
  );

  // 初始載入
  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((d) => setHealth(d))
      .catch(() => {});
    runMod1({ overrideTicker: '2330.TW', simulateTick: false, useAI: false });
  }, [runMod1]);

  // 盤中動態每秒倒數與每 5 秒自動跳動更新
  useEffect(() => {
    if (!isLivePolling || activeTab !== 'mod1' || aiDecisionOn) return undefined;

    const timer = setInterval(() => {
      setCountdownSec((prev) => {
        if (prev <= 1) {
          runMod1({ simulateTick: false });
          return 5;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isLivePolling, activeTab, runMod1, aiDecisionOn]);

  const runMod2 = useCallback(
    async (presetOverride) => {
      const base = presetOverride || m2Form;
      const cfg = window.TA.loadAI();
      const prof =
        cfg.scope.mod2 === false ? null : window.TA.cleanProfile(window.TA.activeProfile(cfg));
      const payload = { ...base, ai: base.ai_sentiment ? prof : null };
      setM2Loading(true);
      try {
        const res = await fetch('/api/mod2/news', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        setM2Data(data);
      } catch (err) {
        showToast(`新聞判斷 評估失敗: ${err.message}`);
      } finally {
        setM2Loading(false);
      }
    },
    [m2Form, showToast],
  );

  const runMod3 = useCallback(async () => {
    setM3Loading(true);
    try {
      const res = await fetch('/api/mod3/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(m3Form),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setM3Data(data);
    } catch (err) {
      showToast(`策略回測 回測失敗: ${err.message}`);
    } finally {
      setM3Loading(false);
    }
  }, [m3Form, showToast]);

  const runMod4 = useCallback(async () => {
    setM4Loading(true);
    try {
      const targetWeights = { CASH: Number(m4CashPct) || 0 };
      for (const h of m4Holdings) {
        targetWeights[h.symbol] = Number(h.target_pct) || 0;
      }
      const res = await fetch('/api/mod4/risk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          holdings: m4Holdings.map((h) => ({
            symbol: h.symbol,
            market: h.market,
            shares: Number(h.shares),
            price: Number(h.price),
          })),
          target_weights: targetWeights,
          use_live_prices: m4Live,
          portfolio_beta: m4Beta === '' ? null : Number(m4Beta),
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setM4Data(data);
    } catch (err) {
      showToast(`組合風控 風控運算失敗: ${err.message}`);
    } finally {
      setM4Loading(false);
    }
  }, [m4Holdings, m4CashPct, m4Beta, m4Live, showToast]);

  const runMod5 = useCallback(async () => {
    setM5Loading(true);
    try {
      const res = await fetch('/api/mod5/coach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entries: m5Entries,
          ai: (() => {
            const cfg = window.TA.loadAI();
            return cfg.scope.mod5 === false
              ? null
              : window.TA.cleanProfile(window.TA.activeProfile(cfg));
          })(),
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setM5Data(data);
      if (data.entries_used) setM5Entries(data.entries_used);
      if (m5Source === 'mine') {
        window.TA.setJournal(data.entries_used || m5Entries);
        window.TA.saveRules(data.personalized_3_rules, data.rules_source);
      }
    } catch (err) {
      showToast(`交易檢討 診斷失敗: ${err.message}`);
    } finally {
      setM5Loading(false);
    }
  }, [m5Entries, m5Source, showToast]);

  const runVisualTestSuite = useCallback(async () => {
    setTestSuiteRunning(true);
    try {
      const res = await fetch('/api/tests/run', { method: 'POST' });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setTestSuiteReport(data);
      showToast(`完成 ${data.total} 項核心驗證（通過 ${data.passed} 項）`);
    } catch (err) {
      showToast(`執行測試失敗: ${err.message}`);
    } finally {
      setTestSuiteRunning(false);
    }
  }, [showToast]);

  // 看盤頁 → 技術分析：帶入代號與當下盤況
  const sendToMod1 = (quote) => {
    setM1Ticker(quote.symbol);
    setM1Context(quote);
    prevPriceRef.current = null;
    setActiveTab('mod1');
    runMod1({ overrideTicker: quote.symbol, simulateTick: false });
    showToast(`已將 ${quote.symbol} ${quote.name} 送入技術分析`);
  };

  // 看盤頁「我的持股」→ 組合風控：帶入持股並自動平均配置目標權重（現金沿用目前設定）
  const sendHoldings = (list) => {
    const each = list.length
      ? Math.round(((100 - Number(m4CashPct || 0)) / list.length) * 10) / 10
      : 0;
    setM4Holdings(list.map((h) => ({ ...h, target_pct: each })));
    setM4Data(null);
    setActiveTab('mod4');
    setPendingRun4(true);
    showToast(`已帶入 ${list.length} 檔持股到組合風控`);
  };

  const loadMyHoldings = (mine) => {
    sendHoldings(
      mine.map((h) => ({
        symbol: h.symbol,
        market: window.TA.isTW(h.symbol) ? 'TW' : 'US',
        shares: h.shares,
        price: h.cost,
      })),
    );
  };

  useEffect(() => {
    if (pendingRun5) {
      setPendingRun5(false);
      runMod5();
    }
  }, [pendingRun5, runMod5]);

  useEffect(() => {
    if (pendingRun3) {
      setPendingRun3(false);
      runMod3();
    }
  }, [pendingRun3, runMod3]);

  // 技術分析 → 策略回測：帶入同一檔
  const backtestThis = (symbol) => {
    setM3Form((f) => ({ ...f, target_asset: symbol }));
    setActiveTab('mod3');
    setPendingRun3(true);
  };

  useEffect(() => {
    if (pendingRun4) {
      setPendingRun4(false);
      runMod4();
    }
  }, [pendingRun4, runMod4]);

  useEffect(() => window.TA.writeLS('tw_us_sidebar_v1', sidebarOpen), [sidebarOpen]);

  // 手機（< 768px）：側邊欄改成從左側滑出的選單，選完頁面或點旁邊就關閉
  const mobileQuery = '(max-width: 767px)';
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(mobileQuery).matches);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(mobileQuery);
    const onChange = () => {
      setIsMobile(mq.matches);
      setMenuOpen(false);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKey = (e) => e.key === 'Escape' && setMenuOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);
  const expanded = isMobile || sidebarOpen; // 手機選單一律顯示文字
  const goTab = (id) => {
    handleSwitchTab(id);
    setMenuOpen(false);
  };

  const handleSwitchTab = (tabId) => {
    setActiveTab(tabId);
    if (tabId === 'mod2' && !m2Data) runMod2();
    if (tabId === 'mod3' && !m3Data) runMod3();
    if (tabId === 'mod4') {
      // 組合風控預設使用「我的持股」（看盤頁輸入或模擬成交），沒有才用範例
      const mine = window.TA.loadPortfolio().holdings;
      if (mine.length && JSON.stringify(m4Holdings) === JSON.stringify(DEFAULT_HOLDINGS)) {
        loadMyHoldings(mine);
        return;
      }
      if (!m4Data) runMod4();
    }
    if (tabId === 'mod5') {
      // 交易檢討預設使用「我的交易紀錄」（模擬成交或匯入），沒有才用範例
      const journal = window.TA.loadPortfolio().journal;
      if (journal.length && m5Source !== 'mine') {
        setM5Source('mine');
        setM5Entries(journal);
        setM5Data(null);
        setPendingRun5(true);
        return;
      }
      if (!m5Data) runMod5();
    }
    if (tabId === 'visual_tests' && !testSuiteReport) runVisualTestSuite();
  };

  const confirmResetAll = () => {
    setM1Ticker('2330.TW');
    setM1BarCount(30);
    setM2Form(NEWS_PRESETS[0]);
    setM3Form({
      target_asset: '2330.TW',
      fast_ma: 5,
      slow_ma: 20,
      initial_capital: 1000000,
      commission_discount: 0.6,
    });
    setM4Holdings(DEFAULT_HOLDINGS);
    setM4CashPct(20.0);
    setM5Entries(DEFAULT_JOURNAL);
    setIsResetModalOpen(false);
    runMod1({ overrideTicker: '2330.TW', overrideBarCount: 30, simulateTick: false });
    showToast('已將各分頁參數重置為出廠預設值');
  };

  const exportSnapshotJson = JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      health,
      mod1_snapshot: m1Data?.snapshot || null,
      mod1_decision: m1Data?.llm_result?.decision_payload || null,
      mod2_news: m2Data || null,
      mod3_backtest_summary: m3Data?.backtest_result || null,
      mod4_risk_summary: m4Data?.rebalance_verification || null,
      mod5_coach_rules: m5Data?.personalized_3_rules || null,
    },
    null,
    2,
  );

  window.TA.goTab = handleSwitchTab;
  // 任何頁面都能要求「分析這檔」（看盤持股列、技術分析的持股切換）
  window.TA.analyzeSymbol = (sym) => {
    setM1Ticker(sym);
    prevPriceRef.current = null;
    setActiveTab('mod1');
    runMod1({ overrideTicker: sym });
  };
  window.TA.startTour = (step = 0) => {
    setTourStart(step);
    setTourOpen(true);
  };

  const ctx = {
    m5Source,
    setM5Source,
    loadMyHoldings,
    backtestThis,
    aiDecisionOn,
    handleSwitchTab,
    countdownSec,
    isLivePolling,
    m1BarCount,
    m1Timeframe,
    setM1Timeframe,
    m1Context,
    m1Data,
    m1Loading,
    m1Ticker,
    m2Data,
    m2Form,
    m2Loading,
    m3Data,
    m3Form,
    m3Loading,
    m4Beta,
    m4CashPct,
    m4Data,
    m4Holdings,
    m4Live,
    m4Loading,
    m5Data,
    m5Entries,
    m5Loading,
    prevPriceRef,
    priceFlash,
    runMod1,
    runMod2,
    runMod3,
    runMod4,
    runMod5,
    runVisualTestSuite,
    setCountdownSec,
    setIsLivePolling,
    setM1BarCount,
    setM1Context,
    setM1Ticker,
    setM2Form,
    setM3Form,
    setM4Beta,
    setM4CashPct,
    setM4Holdings,
    setM4Live,
    setM5Entries,
    testSuiteReport,
    testSuiteRunning,
  };

  const groups = [...new Set(NAV_ITEMS.map((i) => i.group))];
  const current = NAV_ITEMS.find((i) => i.id === activeTab) || NAV_ITEMS[0];
  const ai = window.TA.useAISettings();
  const aiProfile = ai.profiles.find((p) => p.id === ai.activeId);

  return (
    <div className="h-screen flex bg-slate-950 text-slate-100 overflow-hidden">
      {/* 左側導覽列（可收合，類似後台／Chrome 側邊欄） */}
      {isMobile && menuOpen && (
        <button
          type="button"
          aria-label="關閉選單"
          onClick={() => setMenuOpen(false)}
          className="fixed inset-0 z-40 bg-black/60 cursor-default"
        />
      )}
      <aside
        data-tour="sidebar"
        className={`flex flex-col bg-slate-900 border-r border-slate-800 transition-all duration-200 ${
          isMobile
            ? `fixed inset-y-0 left-0 z-50 w-64 shadow-2xl ${menuOpen ? 'translate-x-0' : '-translate-x-full'}`
            : `shrink-0 ${sidebarOpen ? 'w-56' : 'w-16'}`
        }`}
        aria-label="功能導覽"
        aria-hidden={isMobile && !menuOpen ? 'true' : undefined}
        inert={isMobile && !menuOpen ? '' : undefined}
      >
        <div className="flex items-center gap-3 px-3 h-14 border-b border-slate-800 shrink-0">
          <div className="w-9 h-9 shrink-0 rounded-xl bg-gradient-to-br from-sky-500 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-sky-500/20">
            <NavIcon name="candles" className="w-5 h-5" />
          </div>
          {expanded && (
            <div className="min-w-0">
              <div className="text-sm font-bold text-white truncate">台美股交易分析</div>
              <div className="text-[10px] text-emerald-300">● 真實資料</div>
            </div>
          )}
        </div>
        <nav className="flex-1 overflow-y-auto py-2 px-2 space-y-3">
          {groups.map((g) => (
            <div key={g} className="space-y-0.5">
              {expanded ? (
                <div className="px-3 pt-1 pb-1 text-[10px] tracking-wider text-slate-500">{g}</div>
              ) : (
                <div className="mx-3 my-1 border-t border-slate-800" />
              )}
              {NAV_ITEMS.filter((i) => i.group === g).map((item) => {
                const isActive = activeTab === item.id;
                return (
                  <button
                    type="button"
                    key={item.id}
                    title={`${item.title}：${item.subtitle}`}
                    aria-current={isActive ? 'page' : undefined}
                    onClick={() => goTab(item.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition cursor-pointer border-l-2 ${
                      isActive
                        ? 'bg-sky-500/15 border-sky-400 text-white font-semibold'
                        : 'border-transparent text-slate-400 hover:text-white hover:bg-slate-800/70'
                    } ${expanded ? '' : 'justify-center px-0'}`}
                  >
                    <span className="shrink-0">
                      <NavIcon name={item.icon} />
                    </span>
                    {expanded && <span className="truncate">{item.short}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="shrink-0 border-t border-slate-800 p-2 space-y-1">
          <button
            type="button"
            onClick={() => goTab('settings')}
            title={aiProfile ? `AI：${aiProfile.name}` : 'AI：內建規則引擎（點此設定）'}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[11px] text-slate-300 hover:bg-slate-800 cursor-pointer ${
              expanded ? '' : 'justify-center px-0'
            }`}
          >
            <NavIcon name="bot" className="w-4 h-4 shrink-0" />
            {expanded && (
              <span className="truncate">{aiProfile ? aiProfile.name : '規則引擎（未接 AI）'}</span>
            )}
          </button>
          <button
            type="button"
            onClick={() => (isMobile ? setMenuOpen(false) : setSidebarOpen(!sidebarOpen))}
            aria-label={isMobile ? '關閉選單' : sidebarOpen ? '收合側邊欄' : '展開側邊欄'}
            className="w-full py-1.5 rounded-lg text-xs text-slate-500 hover:text-white hover:bg-slate-800 cursor-pointer"
          >
            {isMobile ? '✕ 關閉選單' : sidebarOpen ? '« 收合' : '»'}
          </button>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        {/* 頂部列：目前頁面 + 大盤指數 + 工具 */}
        <header className="shrink-0 bg-slate-900/95 border-b border-slate-800 px-3 md:px-6 py-2 md:py-2.5">
          <div className="flex items-center justify-between gap-2 md:gap-3">
            <div className="flex items-center gap-2 md:gap-3 min-w-0">
              {isMobile && (
                <button
                  type="button"
                  onClick={() => setMenuOpen(true)}
                  aria-label="開啟選單"
                  aria-expanded={menuOpen}
                  className="shrink-0 -ml-1 p-1.5 rounded-lg text-slate-300 hover:bg-slate-800 cursor-pointer"
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="w-6 h-6"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    aria-hidden="true"
                  >
                    <path d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                </button>
              )}
              <span className="text-sky-400 shrink-0">
                <NavIcon name={current.icon} className="w-6 h-6" />
              </span>
              <div className="min-w-0">
                <h1 className="text-base font-bold text-white truncate">
                  {isMobile ? current.short : current.title}
                </h1>
                <p className="hidden md:block text-[11px] text-slate-500 truncate">
                  {current.subtitle}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setIsExportModalOpen(true)}
                aria-label="匯出報告"
                className="text-xs px-2.5 md:px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition cursor-pointer"
              >
                📤<span className="hidden sm:inline"> 匯出報告</span>
              </button>
              <button
                type="button"
                onClick={() => setIsResetModalOpen(true)}
                aria-label="重置"
                className="text-xs px-2.5 md:px-3 py-1.5 rounded-lg bg-rose-950/60 hover:bg-rose-900/70 text-rose-300 border border-rose-800/60 transition cursor-pointer"
              >
                ↺<span className="hidden sm:inline"> 重置</span>
              </button>
            </div>
          </div>
          {/* 大盤指數列（真實報價，每 30 秒更新） */}
          <div className="mt-2 pt-2 border-t border-slate-800/80" data-tour="index-bar">
            <window.TA.IndexBar />
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-3 md:p-6">
          <main className="space-y-4 md:space-y-6 max-w-[1600px] mx-auto">
            {activeTab === 'watch' && (
              <window.TA.WatchPage
                onSendToMod1={sendToMod1}
                onSendHoldings={sendHoldings}
                onShowTour={() => window.TA.startTour(0)}
              />
            )}
            {activeTab === 'guide' && (
              <window.TA.GuidePage
                onGo={handleSwitchTab}
                onShowTour={() => window.TA.startTour(0)}
              />
            )}

            {/* ================= MOD 01: 多維度動態看盤與技術分析 ================= */}

            {/* ================= MOD 02: 新聞催化劑與 Priced-in 實驗室 ================= */}

            {/* ================= MOD 03: 零未來函數策略回測引擎 ================= */}

            {/* ================= MOD 04: 跨市場資產配置與穿透風控 ================= */}

            {/* ================= MOD 05: 交易日誌教練與偏誤診斷 ================= */}

            {/* ================= TEST 12: 系統底層 12 項自檢中心 ================= */}
            {activeTab === 'settings' && <window.TA.SettingsPage />}
            {activeTab === 'mod1' && <window.TA.Mod1Panel ctx={ctx} />}
            {activeTab === 'mod2' && <window.TA.Mod2Panel ctx={ctx} />}
            {activeTab === 'mod3' && <window.TA.Mod3Panel ctx={ctx} />}
            {activeTab === 'mod4' && <window.TA.Mod4Panel ctx={ctx} />}
            {activeTab === 'mod5' && <window.TA.Mod5Panel ctx={ctx} />}
            {activeTab === 'visual_tests' && <window.TA.SelfTestPanel ctx={ctx} />}
          </main>
        </div>
      </div>

      {/* Reset Modal (保留 #resetModal 與 Backdrop 點擊行為) */}
      <window.TA.GuideTour
        open={tourOpen}
        start={tourStart}
        onClose={() => setTourOpen(false)}
        onGo={handleSwitchTab}
      />

      {isResetModalOpen && (
        // biome-ignore lint/a11y/noStaticElementInteractions: preserve backdrop click behavior
        <div
          id="resetModal"
          role="presentation"
          onClick={(e) => {
            if (e.target.id === 'resetModal') setIsResetModalOpen(false);
          }}
          className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        >
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-white mb-2">確定要重置所有分頁參數嗎？</h3>
            <p className="text-sm text-slate-400 mb-6">
              這將會把各分析頁的股票代號、回測參數、投資組合部位與交易日誌恢復為出廠預設值。
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setIsResetModalOpen(false)}
                className="px-4 py-2 rounded-lg text-sm bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
              >
                取消
              </button>
              <button
                type="button"
                onClick={confirmResetAll}
                className="px-4 py-2 rounded-lg text-sm bg-rose-600 hover:bg-rose-500 text-white font-semibold cursor-pointer"
              >
                確定重置
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Export Modal (保留 #exportModal 與 Backdrop 點擊行為) */}
      {isExportModalOpen && (
        // biome-ignore lint/a11y/noStaticElementInteractions: preserve backdrop click behavior
        <div
          id="exportModal"
          role="presentation"
          onClick={(e) => {
            if (e.target.id === 'exportModal') setIsExportModalOpen(false);
          }}
          className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        >
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-2xl w-full p-6 shadow-2xl flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-bold text-white">📤 匯出量化分析報告 (JSON)</h3>
              <button
                type="button"
                onClick={() => setIsExportModalOpen(false)}
                className="text-slate-400 hover:text-white text-sm cursor-pointer"
              >
                ✕ 關閉
              </button>
            </div>
            <pre className="bg-slate-950 border border-slate-800 rounded-xl p-4 text-xs font-mono text-emerald-300 overflow-y-auto flex-1">
              {exportSnapshotJson}
            </pre>
            <div className="flex justify-end gap-3 mt-4">
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(exportSnapshotJson);
                  showToast('已複製量化分析報告 JSON！');
                }}
                className="px-4 py-2 rounded-lg text-xs font-semibold bg-sky-600 hover:bg-sky-500 text-white cursor-pointer"
              >
                複製 JSON 內容
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toastMsg && (
        <div className="fixed bottom-6 right-6 z-50 bg-emerald-950/95 border border-emerald-500/40 text-emerald-200 px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2 text-xs font-medium">
          <span>✅</span>
          <span>{toastMsg}</span>
        </div>
      )}
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
