import { bus } from './bus';
import { notifySaved, userDataReady } from './sync_store';
import { DEFAULT_BACKTEST, DEFAULT_HOLDINGS, DEFAULT_JOURNAL, NAV_ITEMS, NEWS_PRESETS, NavIcon } from './config';
import { Mod1Panel } from './panels/technical';
import { Mod2Panel } from './panels/news';
import { FALLBACK_CATALOG } from './panels/backtest_parts';
import { Mod3Panel } from './panels/backtest';
import { Mod4Panel } from './panels/portfolio';
import { Mod5Panel } from './panels/journal';
import { SelfTestPanel } from './panels/selftest';
import { feeDiscount, marketOf, readLS, writeLS } from './ui';
import { logEvent } from './activity_log';
import { activeProfile, cleanProfile, loadAI, useAISettings } from './ai_store';
import { loadPortfolio, saveRules, setJournal } from './portfolio_store';
import { IndexBar } from './live_widgets';
import { AlertWatcher } from './pages/overview_alerts';
import { WatchPage } from './pages/watch';
import { STOCK_TAB_IDS, StockTabs } from './pages/stock_tabs';
import { MarketBoardPage } from './pages/market_board';
import { IndustryChainPage } from './pages/industry_chain';
import { MultiChartPage } from './pages/multi_chart';
import { SavingsPlanPage } from './pages/savings_plan';
import { SettingsPage } from './pages/settings';
import { GuideTour } from './pages/tour';
import { GuidePage, tourAlreadyDone } from './pages/guide';
import { bootPreload } from './boot_loader';
import { ZoomControl, pageAway, postJob } from './desktop_bridge';
import { buildExportReport, downloadText, stamp } from './export_report';

const { useState, useEffect, useCallback, useMemo, useRef } = React;


// 提示框的圖示：訊息開頭已經有圖示（✅／⚠️／ℹ️…）就用它並依類型上色，沒有才補 ✅，避免出現兩個圖示
const TOAST_TONES = {
  warn: 'bg-amber-950/95 border-amber-500/40 text-amber-200',
  info: 'bg-sky-950/95 border-sky-500/40 text-sky-200',
  ok: 'bg-emerald-950/95 border-emerald-500/40 text-emerald-200',
};
function splitToast(msg: unknown) {
  const text = String(msg ?? '');
  const m = text.match(/^(\p{Extended_Pictographic}️?)\s*/u);
  const icon = m ? m[1] : '✅';
  const body = m ? text.slice(m[0].length) : text;
  const tone = /^(⚠|❌|⛔)/u.test(icon) ? 'warn' : /^ℹ/u.test(icon) ? 'info' : 'ok';
  return { icon, body, tone };
}

function App() {
  const [activeTab, setActiveTab] = useState(() => (window.location.hash.startsWith('#chains') ? 'chains' : 'watch')); // 產業鏈的網址定位可直接開到那一頁
  const aiCfg = useAISettings();
  // 技術分析的買賣決策若交給 AI，就不自動每 5 秒刷新（否則會每 5 秒呼叫一次模型）
  const aiDecisionOn =
    aiCfg.scope.mod1 !== false && !!aiCfg.profiles.find((p) => p.id === aiCfg.activeId);
  const [sidebarOpen, setSidebarOpen] = useState(() => readLS('tw_us_sidebar_v1', true));
  const [tourOpen, setTourOpen] = useState(() => !tourAlreadyDone());
  const [tourStart, setTourStart] = useState(0);
  const [health, setHealth] = useState(null);
  const [toastMsg, setToastMsg] = useState(null);

  // Backdrop Modals (保留原有 ID 與 Backdrop 點擊關閉行為)
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);

  // 技術分析 狀態與動態看盤控制
  const [m1Ticker, setM1Ticker] = useState('2330');
  const [m1BarCount, setM1BarCount] = useState(30);
  const [m1Timeframe, setM1Timeframe] = useState('D');
  const [m1Context, setM1Context] = useState(null);
  const [m1Loading, setM1Loading] = useState(false);
  const [m1Data, setM1Data] = useState(null);
  const [isLivePolling, setIsLivePolling] = useState(true);
  const [countdownSec, setCountdownSec] = useState(5);
  const [priceFlash, setPriceFlash] = useState(null); // "UP" | "DOWN" | null
  const prevPriceRef = useRef(null);
  const m1ReqRef = useRef(0);
  // 回測／風控／交易檢討：前一次還沒算完又觸發（例如從技術分析帶另一檔來回測）時，只採用最後一次的結果
  const m3ReqRef = useRef(0);
  const m4ReqRef = useRef(0);
  const m5ReqRef = useRef(0);
  const m1Busy = useRef(false);
  const toastTimer = useRef(null);

  // 新聞判斷 狀態
  const [m2Form, setM2Form] = useState(NEWS_PRESETS[0]);
  const [m2Loading, setM2Loading] = useState(false);
  const [m2Data, setM2Data] = useState(null);

  // 策略回測 狀態
  // 手續費折數與看盤頁模擬下單共用（window.TA.feeDiscount）：開啟時帶入、在下單面板改了也同步
  const [m3Form, setM3Form] = useState(() => ({
    ...DEFAULT_BACKTEST,
    commission_discount: feeDiscount(),
  }));
  useEffect(() => {
    const on = () => setM3Form((f) => ({ ...f, commission_discount: feeDiscount() }));
    window.addEventListener('fee-discount-changed', on);
    return () => window.removeEventListener('fee-discount-changed', on);
  }, []);
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
  // 有已平倉交易或持股就用「我的」：還沒賣出過也能看持有中部位，不會退回範例
  const hasMine = () => {
    const pf: any = loadPortfolio?.() || {};
    return (pf.journal || []).length > 0 || (pf.holdings || []).length > 0;
  };
  const [m5Source, setM5Source] = useState(() => (hasMine() ? 'mine' : 'sample')); // 'mine' | 'sample'
  const [m4Loading, setM4Loading] = useState(false);
  const [m4Data, setM4Data] = useState(null);

  // 交易檢討 狀態
  const [m5Entries, setM5Entries] = useState(() =>
    hasMine() ? loadPortfolio().journal : DEFAULT_JOURNAL,
  );
  const [m5Loading, setM5Loading] = useState(false);
  const [m5Data, setM5Data] = useState(null);

  useEffect(() => {
    const onPortfolioChange = () => {
      if (hasMine()) {
        setM5Source('mine');
        setM5Entries(loadPortfolio().journal);
      }
    };
    window.addEventListener('portfolio-changed', onPortfolioChange);
    window.addEventListener('storage', onPortfolioChange);
    return () => {
      window.removeEventListener('portfolio-changed', onPortfolioChange);
      window.removeEventListener('storage', onPortfolioChange);
    };
  }, []);

  // 系統 12 項自檢狀態
  const [testSuiteRunning, setTestSuiteRunning] = useState(false);
  const [testSuiteReport, setTestSuiteReport] = useState(null);

  // page：只屬於某一頁的結果提示（例如背景跑完的回測）；使用者已經切到別頁就不顯示，只留在操作紀錄
  const showToast = useCallback((msg, page?: string) => {
    // 畫面提示也記到操作紀錄；含失敗／錯誤字樣的標成錯誤，方便篩選
    logEvent?.(
      'notice',
      { message: String(msg).slice(0, 200) },
      /失敗|錯誤|無法|⚠️/.test(String(msg)) ? 'error' : 'info',
    );
    if (page && bus.currentPage !== page) return;
    setToastMsg(msg);
    clearTimeout(toastTimer.current); // 連續提示時，上一則的計時器不能提早關掉這一則
    toastTimer.current = setTimeout(() => setToastMsg(null), 2600);
  }, []);

  // 技術分析 分析與盤中動態跳動
  const runMod1 = useCallback(
    // quiet：自動輪詢與初始載入不跳「完成」通知（失敗仍會通知）；使用者自己按的查詢才提示
    async ({ overrideTicker, overrideTimeframe, useAI = true, quiet = false }: { overrideTicker?: string; overrideTimeframe?: string; overrideBarCount?: number; useAI?: boolean; quiet?: boolean; simulateTick?: boolean } = {}) => {
      const targetTicker = overrideTicker || m1Ticker;
      const targetTf = overrideTimeframe || m1Timeframe;
      const reqId = ++m1ReqRef.current; // 快速換股／換日週線時，慢回來的舊請求不能蓋掉新的
      m1Busy.current = true;
      setM1Loading(true);
      try {
        const res = await fetch('/api/mod1/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ticker: targetTicker,
            bar_count: 500, // 一次拿約 2 年，圖表在前端縮放／平移（targetBars 只決定預設顯示幾根）
            timeframe: targetTf,
            ai: (() => {
              const cfg = loadAI();
              // 只有使用者主動查詢時才把決策交給 AI；首次載入一律用規則引擎
              return !useAI || cfg.scope.mod1 === false
                ? null
                : cleanProfile(activeProfile(cfg));
            })(),
          }),
        });
        const data = await res.json();
        if (reqId !== m1ReqRef.current) return;
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
        if (!quiet)
          showToast(`✅ 技術分析完成：${targetTicker}（${targetTf === 'W' ? '週線' : '日線'}）`, 'mod1');
      } catch (err) {
        if (reqId === m1ReqRef.current) showToast(`⚠️ 技術分析 分析失敗: ${err.message}`, 'mod1');
      } finally {
        if (reqId === m1ReqRef.current) {
          setM1Loading(false);
          m1Busy.current = false;
        }
      }
    },
    [m1Ticker, m1BarCount, m1Timeframe, showToast],
  );

  // 初始載入：只查系統狀態；技術分析等切到該頁才抓（handleSwitchTab 沒有資料時會分析），不在啟動時先抓
  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((d) => setHealth(d))
      .catch(() => {});
  }, []);

  // 盤中動態每秒倒數與每 5 秒自動跳動更新
  useEffect(() => {
    if (!isLivePolling || activeTab !== 'mod1' || aiDecisionOn) return undefined;

    const timer = setInterval(() => {
      setCountdownSec((prev) => {
        if (prev <= 1) {
          // 上一次還沒回來、或頁面不在前景就跳過這一輪
          if (!m1Busy.current && !pageAway?.()) runMod1({ simulateTick: false, quiet: true });
          return 5;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isLivePolling, activeTab, runMod1, aiDecisionOn]);

  const runMod2 = useCallback(
    async (presetOverride?: any) => {
      const base = presetOverride || m2Form;
      const cfg = loadAI();
      const prof =
        cfg.scope.mod2 === false ? null : cleanProfile(activeProfile(cfg));
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
        showToast(`✅ 新聞判斷完成：${base.target || ''}`, 'mod2');
      } catch (err) {
        showToast(`⚠️ 新聞判斷 評估失敗: ${err.message}`, 'mod2');
      } finally {
        setM2Loading(false);
      }
    },
    [m2Form, showToast],
  );

  const runMod3 = useCallback(async () => {
    setM3Loading(true);
    const mine = ++m3ReqRef.current;
    try {
      const data = await postJob('/api/mod3/backtest', m3Form);
      if (mine !== m3ReqRef.current) return;
      if (data.error) throw new Error(data.error);
      setM3Data(data);
      showToast(
        `✅ 回測完成：${m3Form.target_asset}，共 ${data.backtest_result?.total_trades ?? 0} 筆交易`,
        'mod3',
      );
    } catch (err) {
      if (mine === m3ReqRef.current) showToast(`⚠️ 策略回測 回測失敗: ${err.message}`, 'mod3');
    } finally {
      if (mine === m3ReqRef.current) setM3Loading(false);
    }
  }, [m3Form, showToast]);

  const runMod4 = useCallback(async () => {
    if (!m4Holdings.some((h) => String(h.symbol || '').trim() && Number(h.shares) > 0)) {
      setM4Data(null); // 沒有持股時不留著上一次的結果，避免誤會
      showToast('目前沒有可計算的持股：請至少輸入一檔代號，且股數大於 0');
      return;
    }
    setM4Loading(true);
    const mine = ++m4ReqRef.current;
    try {
      const targetWeights = { CASH: Number(m4CashPct) || 0 };
      for (const h of m4Holdings) {
        targetWeights[h.symbol] = Number(h.target_pct) || 0;
      }
      const data = await postJob('/api/mod4/risk', {
        holdings: m4Holdings.map((h) => ({
          symbol: h.symbol,
          market: h.market,
          shares: Number(h.shares),
          price: Number(h.price),
        })),
        target_weights: targetWeights,
        use_live_prices: m4Live,
        portfolio_beta: m4Beta === '' ? null : Number(m4Beta),
      });
      if (mine !== m4ReqRef.current) return;
      if (data.error) throw new Error(data.error);
      setM4Data(data);
      showToast(`✅ 組合風控計算完成（${m4Holdings.length} 檔持股）`, 'mod4');
    } catch (err) {
      if (mine === m4ReqRef.current) showToast(`⚠️ 組合風控 風控運算失敗: ${err.message}`, 'mod4');
    } finally {
      if (mine === m4ReqRef.current) setM4Loading(false);
    }
  }, [m4Holdings, m4CashPct, m4Beta, m4Live, showToast]);

  const runMod5 = useCallback(
    async (overrideEntries?: any, overrideSource?: any) => {
      const usedEntries = Array.isArray(overrideEntries) ? overrideEntries : m5Entries;
      const usedSource = typeof overrideSource === 'string' ? overrideSource : m5Source;
      setM5Loading(true);
      const mine = ++m5ReqRef.current;
      try {
        const data = await postJob('/api/mod5/coach', {
          entries: usedEntries,
          mine: usedSource === 'mine', // 我的紀錄：沒有已平倉交易時也不要改用範例
          // 持有中的部位（只顯示帳面損益，不算進勝率等統計）
          holdings: usedSource === 'mine' ? loadPortfolio().holdings : [],
          ai: (() => {
            const cfg = loadAI();
            return cfg.scope.mod5 === false
              ? null
              : cleanProfile(activeProfile(cfg));
          })(),
        });
        if (mine !== m5ReqRef.current) return;
        if (data.error) throw new Error(data.error);
        setM5Data(data);
        if (data.entries_used) setM5Entries(data.entries_used);
        if (usedSource === 'mine' && !data.closed_trades_used) {
          showToast(`✅ 已更新持有中部位（${(data.open_positions || []).length} 檔）；賣出成交後才會有勝率與個人規則`, 'mod5');
        } else if (usedSource === 'mine') {
          setJournal(data.entries_used || usedEntries);
          saveRules(data.personalized_3_rules, data.rules_source);
          notifySaved('交易診斷完成，已更新交易紀錄與 3 條個人規則（下單面板會顯示）');
        } else {
          showToast('✅ 交易診斷完成（範例資料，不會更新你的交易紀錄與規則）', 'mod5');
        }
      } catch (err) {
        if (mine === m5ReqRef.current) showToast(`⚠️ 交易檢討 診斷失敗: ${err.message}`, 'mod5');
      } finally {
        if (mine === m5ReqRef.current) setM5Loading(false);
      }
    },
    [m5Entries, m5Source, showToast],
  );

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

  // 看盤頁熱力圖 → 新聞判斷：換成這檔、清掉舊的標題與事件前漲跌，並自動抓最新新聞
  const sendToMod2 = (symbol, name) => {
    setM2Form({
      label: '',
      target: symbol,
      headline: '',
      sentiment: 'POSITIVE',
      ret_5d_pct: '',
      ret_20d_pct: '',
      invalidation_criteria: '',
    });
    setM2Data(null);
    bus._autoNews = symbol;
    setActiveTab('mod2');
    showToast(`已帶入 ${symbol} ${name || ''} 到新聞判斷，正在抓最新新聞`);
  };

  // 合併同代號（例如不同券商持有同一檔），並確保目標權重總和 + 現金 = 100%
  const normalizeHoldingsForMod4 = useCallback(
    (rawList, cashPct = m4CashPct) => {
      const mergedMap = new Map();
      for (const h of rawList || []) {
        const sym = String(h.symbol || '')
          .trim()
          .toUpperCase();
        if (!sym || !(Number(h.shares) > 0)) continue;
        const sh = Number(h.shares);
        const pr = Number(h.price ?? h.cost ?? 0);
        const prev = mergedMap.get(sym);
        if (prev) {
          const totalSh = prev.shares + sh;
          prev.price = totalSh > 0 ? (prev.shares * prev.price + sh * pr) / totalSh : pr;
          prev.shares = Number(totalSh.toFixed(6));
        } else {
          mergedMap.set(sym, {
            symbol: sym,
            market: h.market || marketOf(sym),
            shares: sh,
            price: pr,
          });
        }
      }
      const list = Array.from(mergedMap.values());
      const investable = Math.max(0, Math.round((100 - Number(cashPct || 0)) * 10) / 10);
      const baseEach = list.length ? Math.floor((investable / list.length) * 10) / 10 : 0;
      const remUnits = list.length ? Math.round((investable - baseEach * list.length) * 10) : 0;
      return list.map((h, idx) => ({
        ...h,
        target_pct: Number((baseEach + (idx < remUnits ? 0.1 : 0)).toFixed(1)),
      }));
    },
    [m4CashPct],
  );

  // 看盤頁「我的持股」→ 組合風控：帶入持股並自動平均配置目標權重（現金沿用目前設定）
  const sendHoldings = (list) => {
    const normalized = normalizeHoldingsForMod4(list, m4CashPct);
    setM4Holdings(normalized);
    setM4Data(null);
    setActiveTab('mod4');
    setPendingRun4(true);
    showToast(`已帶入 ${normalized.length} 檔持股到組合風控`);
  };

  const loadMyHoldings = (mine) => {
    sendHoldings(
      mine.map((h) => ({
        symbol: h.symbol,
        market: marketOf(h.symbol),
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

  // 根據代號整理回測連動參數（帶入技術分析停損 %、持股成本／市值、美股自動換非台股限定策略）
  const buildBacktestFormPatch = useCallback(
    (symbol, prevForm) => {
      const bare = String(symbol || '')
        .trim()
        .toUpperCase()
        .replace(/\.(TW|TWO)$/i, '');
      if (!bare) return prevForm;
      const snap = m1Data?.snapshot;
      const snapBare = String(snap?.symbol || '')
        .trim()
        .toUpperCase()
        .replace(/\.(TW|TWO)$/i, '');
      const sameAsM1 = snap && snapBare === bare;
      const slPrice = m1Data?.llm_result?.decision_payload?.stop_loss_price ?? snap?.recent_low_20d;
      const m1SlPct =
        sameAsM1 && snap.latest_close > 0 && slPrice > 0 && slPrice < snap.latest_close
          ? Number((((snap.latest_close - slPrice) / snap.latest_close) * 100).toFixed(1))
          : null;

      const mine = (loadPortfolio?.().holdings || []).filter(
        (h) =>
          String(h.symbol || '')
            .trim()
            .toUpperCase()
            .replace(/\.(TW|TWO)$/i, '') === bare,
      );
      const heldShares = mine.reduce((s, h) => s + Number(h.shares || 0), 0);
      const heldCost = mine.reduce((s, h) => s + Number(h.shares || 0) * Number(h.cost || 0), 0);
      const refPrice = sameAsM1 && snap.latest_close > 0 ? snap.latest_close : 0;
      const heldVal = Math.round(refPrice > 0 && heldShares > 0 ? heldShares * refPrice : heldCost);

      const isUS = marketOf?.(bare) === 'US';
      const catalog = (bus._btCatalog || FALLBACK_CATALOG)?.strategies || [];
      const curStratMeta = catalog.find((s) => s.key === prevForm.strategy);
      const nextStrategy = isUS && curStratMeta?.tw_only ? 'ma_cross' : prevForm.strategy;

      let nextCap = prevForm.initial_capital;
      if (heldVal >= 1000) {
        nextCap = heldVal;
      } else if (isUS && prevForm.initial_capital === 1000000) {
        nextCap = 10000;
      } else if (!isUS && prevForm.initial_capital === 10000) {
        nextCap = 1000000;
      }

      return {
        ...prevForm,
        target_asset: bare,
        strategy: nextStrategy,
        initial_capital: nextCap,
        stop_loss_pct:
          m1SlPct != null && m1SlPct > 0 && m1SlPct < 50 ? m1SlPct : prevForm.stop_loss_pct,
      };
    },
    [m1Data],
  );

  // 技術分析 / 我的持股 → 策略回測：帶入同一檔、停損參考與持股本金
  const backtestThis = (symbol) => {
    const bare = String(symbol || '')
      .trim()
      .toUpperCase()
      .replace(/\.(TW|TWO)$/i, '');
    setM3Form((f) => buildBacktestFormPatch(bare, f));
    setActiveTab('mod3');
    setPendingRun3(true);
    showToast(`已帶入 ${bare} 到策略回測（同步技術停損與部位設定）`);
  };

  useEffect(() => {
    if (pendingRun4) {
      setPendingRun4(false);
      runMod4();
    }
  }, [pendingRun4, runMod4]);

  useEffect(() => writeLS('tw_us_sidebar_v1', sidebarOpen), [sidebarOpen]);

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
  // 切頁（含個股頁的三個分頁）時回到頁面頂端，避免停在上一頁捲到的位置
  useEffect(() => {
    document.querySelector('main')?.parentElement?.scrollTo?.({ top: 0 });
  }, [activeTab]);
  const goTab = (id) => {
    handleSwitchTab(id);
    setMenuOpen(false);
  };

  const handleSwitchTab = (tabId) => {
    setActiveTab(tabId);
    if (tabId === 'mod1') {
      const watchQuote = bus._watchSelected;
      if (watchQuote?.symbol && m1Ticker === '2330' && watchQuote.symbol !== '2330') {
        setM1Ticker(watchQuote.symbol);
        setM1Context(watchQuote);
        prevPriceRef.current = null;
        runMod1({ overrideTicker: watchQuote.symbol, simulateTick: false });
        return;
      }
      if (!m1Data) runMod1({ simulateTick: false });
    }
    if (tabId === 'mod2') {
      if (!m2Data) runMod2();
    }
    if (tabId === 'mod3') {
      const activeSym = String(m1Data?.snapshot?.symbol || m1Ticker || '')
        .trim()
        .toUpperCase()
        .replace(/\.(TW|TWO)$/i, '');
      const curAsset = String(m3Form.target_asset || '')
        .trim()
        .toUpperCase()
        .replace(/\.(TW|TWO)$/i, '');
      if (activeSym && (curAsset === '2330' || !m3Data) && activeSym !== curAsset) {
        setM3Form((f) => buildBacktestFormPatch(activeSym, f));
        setPendingRun3(true);
        return;
      }
      if (!m3Data) runMod3();
    }
    if (tabId === 'mod4') {
      // 組合風控預設同步「我的持股」（看盤頁新增／移除持股或模擬成交後自動同步）
      const mine = loadPortfolio().holdings;
      if (mine.length) {
        const normalizedMine = normalizeHoldingsForMod4(
          mine.map((h) => ({
            symbol: h.symbol,
            market: marketOf(h.symbol),
            shares: h.shares,
            price: h.cost,
          })),
          m4CashPct,
        );
        const curSig = m4Holdings.map((h) => `${h.symbol}:${Number(h.shares)}`).join('|');
        const mineSig = normalizedMine.map((h) => `${h.symbol}:${Number(h.shares)}`).join('|');
        if (curSig !== mineSig) {
          setM4Holdings(normalizedMine);
          setM4Data(null);
          setPendingRun4(true);
          return;
        }
      }
      if (!m4Data) runMod4();
    }
    if (tabId === 'mod5') {
      // 交易檢討預設使用「我的交易紀錄」（模擬成交賣出或匯入的已平倉交易），沒有才用範例；持股另外顯示為持有中部位
      const { journal, holdings } = loadPortfolio();
      if (journal.length || holdings.length) {
        const stale = m5Source !== 'mine' || JSON.stringify(journal) !== JSON.stringify(m5Entries);
        setM5Source('mine');
        setM5Entries(journal);
        if (stale || !m5Data) {
          setM5Data(null);
          runMod5(journal, 'mine');
        }
        return;
      }
      if (!m5Data) runMod5();
    }
    if (tabId === 'visual_tests' && !testSuiteReport) runVisualTestSuite();
  };

  const confirmResetAll = () => {
    setM1Ticker('2330');
    setM1BarCount(30);
    setM2Form(NEWS_PRESETS[0]);
    // 手續費折數是使用者的券商條件（與模擬下單共用），重置分析參數時保留
    setM3Form({ ...DEFAULT_BACKTEST, commission_discount: feeDiscount() });
    setM4Holdings(DEFAULT_HOLDINGS);
    setM4CashPct(20.0);
    // 換回範例時來源也要改成範例：否則仍標成「我的紀錄」，下次診斷會把範例寫回蓋掉真正的交易紀錄
    setM5Source('sample');
    setM5Entries(DEFAULT_JOURNAL);
    setM5Data(null);
    setIsResetModalOpen(false);
    // 不在技術分析頁就只清掉結果，等切過去再抓
    if (activeTab === 'mod1')
      runMod1({ overrideTicker: '2330', overrideBarCount: 30, simulateTick: false, quiet: true });
    else setM1Data(null);
    showToast('已將各分頁參數重置為出廠預設值');
  };

  // 匯出報告：只在開啟匯出視窗時才組資料（避免每 5 秒更新都重算一次大 JSON）；內容在 export_report.tsx
  const exportReport = useMemo(
    () =>
      isExportModalOpen
        ? buildExportReport({ health, m1Data, m2Data, m3Data, m4Data, m5Data, m5Source })
        : null,
    [isExportModalOpen, health, m1Data, m2Data, m3Data, m4Data, m5Data, m5Source],
  );

  // 操作紀錄：目前在哪一頁、換頁
  useEffect(() => {
    bus.currentPage = activeTab;
    logEvent?.('page', { to: activeTab });
  }, [activeTab]);
  // 瀏覽器上一頁／下一頁回到產業鏈的網址定位時，切到產業鏈那一頁（頁面自己再套用定位）
  useEffect(() => {
    const onHash = () => {
      if (window.location.hash.startsWith('#chains')) setActiveTab('chains');
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  bus.goTab = handleSwitchTab;
  bus.toast = showToast; // 背景任務（例如 AI 解讀）完成時用
  // 任何頁面都能要求「分析這檔」（看盤持股列、技術分析的持股切換）
  bus.analyzeSymbol = (sym) => {
    setM1Ticker(sym);
    prevPriceRef.current = null;
    setActiveTab('mod1');
    runMod1({ overrideTicker: sym });
  };
  bus.backtestSymbol = backtestThis;
  bus.startTour = (step: number | string = 0) => {
    setTourStart(step as number);
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

  const navItems = NAV_ITEMS.filter((i) => !i.hidden); // 隱藏的頁面（系統自檢）仍可由設定頁進入
  const groups: string[] = [...new Set<string>(navItems.map((i) => i.group))];
  // 行情／技術分析／新聞判斷合併成側欄的「個股」一項；內部頁面 id 不變
  const inStock = STOCK_TAB_IDS.includes(activeTab);
  const current = NAV_ITEMS.find((i) => i.id === (inStock ? 'watch' : activeTab)) || NAV_ITEMS[0];
  const stockSub = inStock ? NAV_ITEMS.find((i) => i.id === activeTab) : undefined;
  const sampleBadge =
    activeTab === 'mod4' && JSON.stringify(m4Holdings) === JSON.stringify(DEFAULT_HOLDINGS)
      ? '目前用的是內建範例持股，不是你的持股'
      : activeTab === 'mod5' && m5Source === 'sample'
        ? '目前用的是內建範例交易，不是你的交易'
        : '';
  const ai = useAISettings();
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
        {...({ inert: isMobile && !menuOpen ? '' : undefined } as Record<string, unknown>)}
      >
        <div className="flex items-center gap-3 px-3 h-14 border-b border-slate-800 shrink-0">
          <div className="w-9 h-9 shrink-0 rounded-xl bg-gradient-to-br from-sky-500 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-sky-500/20">
            <NavIcon name="candles" className="w-5 h-5" />
          </div>
          {expanded && (
            <div className="min-w-0">
              <div className="text-sm font-bold text-white truncate">股票交易分析</div>
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
              {navItems.filter((i) => i.group === g).map((item) => {
                const isActive = activeTab === item.id || (item.id === 'watch' && inStock);
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
            title={aiProfile ? `AI：${aiProfile.name}` : 'AI 未啟用，點此設定'}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[11px] text-slate-300 hover:bg-slate-800 cursor-pointer ${
              expanded ? '' : 'justify-center px-0'
            }`}
          >
            <NavIcon name="bot" className="w-4 h-4 shrink-0" />
            {expanded && (
              <span className="truncate">
                {aiProfile ? aiProfile.name : 'AI 未啟用（使用內建規則）'}
              </span>
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
                  {/* 範例資料標示：避免把內建範例的數字當成自己的持股或交易 */}
                  {sampleBadge && (
                    <span
                      className="ml-2 align-middle text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/50 text-amber-200"
                      title={sampleBadge}
                    >
                      範例資料
                    </span>
                  )}
                </h1>
                <p className="hidden md:block text-[11px] text-slate-500 truncate">
                  {stockSub ? stockSub.subtitle : current.subtitle}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <ZoomControl />
              <button
                type="button"
                onClick={() => setIsExportModalOpen(true)}
                aria-label="匯出報告"
                className="text-xs px-2.5 md:px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition cursor-pointer"
              >
                <span className="hidden sm:inline"> 匯出報告</span>
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
            <IndexBar />
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-3 md:p-6">
          <main className="space-y-4 md:space-y-6 max-w-[1600px] mx-auto">
            {inStock && <StockTabs active={activeTab} onGo={goTab} />}
            {activeTab === 'watch' && (
              <WatchPage
                onSendToMod1={sendToMod1}
                onSendToMod2={sendToMod2}
                onSendHoldings={sendHoldings}
                onShowTour={() => bus.startTour('watch')}
              />
            )}
            {activeTab === 'board' && <MarketBoardPage />}
            {activeTab === 'chains' && <IndustryChainPage />}
            {activeTab === 'multichart' && <MultiChartPage />}
            {activeTab === 'savings' && <SavingsPlanPage />}
            {activeTab === 'guide' && (
              <GuidePage
                onGo={handleSwitchTab}
                onShowTour={() => bus.startTour(0)}
              />
            )}

            {/* ================= MOD 01: 多維度動態看盤與技術分析 ================= */}

            {/* ================= MOD 02: 新聞催化劑與 Priced-in 實驗室 ================= */}

            {/* ================= MOD 03: 零未來函數策略回測引擎 ================= */}

            {/* ================= MOD 04: 跨市場資產配置與穿透風控 ================= */}

            {/* ================= MOD 05: 交易日誌教練與偏誤診斷 ================= */}

            {/* ================= TEST 12: 系統底層 12 項自檢中心 ================= */}
            {activeTab === 'settings' && <SettingsPage />}
            {activeTab === 'mod1' && (
              <div key="mod1" className="ta-fade-up">
                <Mod1Panel ctx={ctx} />
              </div>
            )}
            {activeTab === 'mod2' && (
              <div key="mod2" className="ta-fade-up">
                <Mod2Panel ctx={ctx} />
              </div>
            )}
            {activeTab === 'mod3' && <Mod3Panel ctx={ctx} />}
            {activeTab === 'mod4' && <Mod4Panel ctx={ctx} />}
            {activeTab === 'mod5' && <Mod5Panel ctx={ctx} />}
            {activeTab === 'visual_tests' && <SelfTestPanel ctx={ctx} />}
          </main>
        </div>
      </div>

      {/* Reset Modal (保留 #resetModal 與 Backdrop 點擊行為) */}
      <GuideTour
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
            if ((e.target as HTMLElement).id === 'resetModal') setIsResetModalOpen(false);
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
            if ((e.target as HTMLElement).id === 'exportModal') setIsExportModalOpen(false);
          }}
          className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        >
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-2xl w-full p-6 shadow-2xl flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-bold text-white">匯出分析報告</h3>
              <button
                type="button"
                onClick={() => setIsExportModalOpen(false)}
                className="text-slate-400 hover:text-white text-sm cursor-pointer"
              >
                ✕ 關閉
              </button>
            </div>
            <p className="text-[11px] text-slate-400 mb-2">
              內容包含各頁目前的分析結果（技術分析＋籌碼、新聞、回測、組合風控、交易檢討）與你的持股、交易紀錄。下方預覽為文字摘要。
            </p>
            <pre className="bg-slate-950 border border-slate-800 rounded-xl p-4 text-xs font-mono text-emerald-300 overflow-y-auto flex-1 whitespace-pre-wrap">
              {exportReport?.markdown}
            </pre>
            <div className="flex flex-wrap justify-end gap-2 mt-4">
              <button
                type="button"
                onClick={() =>
                  downloadText(
                    exportReport.markdown,
                    `分析報告_${stamp()}.md`,
                    'text/markdown;charset=utf-8',
                  )
                }
                className="px-4 py-2 rounded-lg text-xs font-semibold bg-slate-700 hover:bg-slate-600 text-white cursor-pointer"
              >
                下載摘要 (.md)
              </button>
              <button
                type="button"
                onClick={() =>
                  downloadText(
                    exportReport.json,
                    `分析報告_${stamp()}.json`,
                    'application/json;charset=utf-8',
                  )
                }
                className="px-4 py-2 rounded-lg text-xs font-semibold bg-slate-700 hover:bg-slate-600 text-white cursor-pointer"
              >
                下載完整資料 (.json)
              </button>
              <button
                type="button"
                onClick={() =>
                  navigator.clipboard
                    .writeText(exportReport.json)
                    .then(() => showToast('已複製完整資料（JSON）'))
                    .catch(() => showToast('瀏覽器不允許複製，請改用「下載完整資料」'))
                }
                className="px-4 py-2 rounded-lg text-xs font-semibold bg-sky-600 hover:bg-sky-500 text-white cursor-pointer"
              >
                複製 JSON
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {/* 全站提醒引擎：不論在哪一頁都檢查提醒 */}
      <AlertWatcher say={showToast} />

      {toastMsg &&
        (() => {
          const t = splitToast(toastMsg);
          return (
            <div
              role={t.tone === 'warn' ? 'alert' : 'status'}
              className={`fixed bottom-6 right-6 z-50 border px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2 text-xs font-medium max-w-[min(32rem,calc(100vw-3rem))] ${TOAST_TONES[t.tone]}`}
            >
              <span aria-hidden="true">{t.icon}</span>
              <span>{t.body}</span>
            </div>
          );
        })()}
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
// 載入動畫上逐項預載資料（boot_loader.tsx，最多 15 秒，可按「直接進入」）；預載失敗也照常顯示畫面
const bootReady = bootPreload
  ? bootPreload()
  : Promise.race([userDataReady, new Promise((r) => setTimeout(r, 4000))]);
bootReady.finally(() => {
  bus.appRendered = true; // sync_store 靠這個判斷資料是不是在畫面顯示之後才到
  root.render(<App />);
});

// 線上更新的失敗保護：畫面載入後 4 秒內沒有發生未捕捉的錯誤，就回報「這個版本可以正常使用」（updater.mark_healthy）。
// 更新後的版本連續幾次啟動都沒有這個回報，下次啟動會自動換回內建版（舊版後端沒有這個路由，404 無害）。
let pageCrashed = false;
window.addEventListener('error', () => {
  pageCrashed = true;
});
setTimeout(() => {
  if (!pageCrashed) fetch('/api/update/ok', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {});
}, 4000);
