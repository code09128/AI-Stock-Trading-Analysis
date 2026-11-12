// 看盤頁：左側清單（自選股/ETF/持股）＋右側報價、分時圖、五檔、模擬下單
import { bus } from '../bus';
import { notifySaved } from '../sync_store';
import { DEFAULT_WATCH, LS_CART, LS_WATCH, marketSessionOpen, baseCode, colorOf, currencyOf, feeDiscount, fmt, isOnTick, isTW, localDate, marketName, marketOf, normSym, readLS, twFee, twSellTaxRate, twTick, tzOf, writeLS } from '../ui';
import { fillOrder, usePortfolio } from '../portfolio_store';
import { Row } from './watch_parts';
import { AlertsPanel, OverviewPanel, useAlerts } from './overview_alerts';
import { CatChip, DividendCalendar, StockInfoPanel } from './stock_info_panel';
import { OrderPanel, orderLabel } from './order_panel';
import { HoldingsPanel } from './holdings_panel';
import { HeatmapPanel } from './heatmap';
import { CardBox, CardGrid, LayoutMenu, useCardLayout } from './card_box';
import type { CardDef } from './card_box';
import { ValuationCard } from './valuation_card';
import { AiDrawer } from './ai_drawer';
import { StockTabs } from './stock_tabs';
import { StockChart } from './stock_chart';
import { DepthBody, HoldBody, NewsBody, StatsBody } from './quote_cards';
import { HBars } from './mini_charts';
import { openSavings } from './savings_plan';
import { pollEvery } from '../desktop_bridge';
import { cachedJson } from '../fetch_cache';

const { useState, useEffect, useMemo, useCallback, useRef } = React;



// ---------- 看盤頁 ----------
// 行情分頁的卡片（順序＝預設順序；span 是 12 欄格線裡佔幾欄）
const CARD_DEFS: CardDef[] = [
  { id: 'chart', title: '分時走勢', span: 8 },
  { id: 'stats', title: '開高低量・區間', span: 4 },
  { id: 'depth', title: '委買／委賣五檔', span: 4 },
  { id: 'order', title: '模擬下單', span: 8 },
  { id: 'news', title: '相關新聞', span: 8 },
  { id: 'val', title: '估值參考', span: 8 },
  { id: 'profile', title: '基本資料・配息', span: 4 },
  { id: 'hold', title: '我的持股', span: 4 },
];
const PROFILE_TABS = [
  ['basic', '基本資料'],
  ['fin', '財報'],
  ['div', '配息'],
];

function WatchPage({ active = 'watch', goTab, techPanel, newsPanel, m1Ticker, m1Data, m2Data, m2Target, onSendToMod1, onSendToMod2, onSendHoldings, onShowTour }: any) {
  const [watch, setWatch] = useState(() => readLS(LS_WATCH, DEFAULT_WATCH));
  const [listTab, setListTab] = useState('watch');
  const [holdPrefill, setHoldPrefill] = useState(null); // 「加入我的持股」要預填到持股面板表單的內容
  const [etfs, setEtfs] = useState({ etfs: [], pending_yields: 0, sources: {} });
  const [etfSort, setEtfSort] = useState('hot');
  const [selected, setSelected] = useState(
    () => bus._watchSelected || readLS(LS_WATCH, DEFAULT_WATCH)[0] || '2330',
  );
  useEffect(() => {
    bus._watchSelected = selected;
  }, [selected]);
  // 切頁回來先顯示上次的報價（bus.quoteMemo），不用等新一輪回來才有畫面
  const [quotes, setQuotes] = useState<any>(() =>
    Object.fromEntries(Object.entries((bus.quoteMemo || {}) as Record<string, any>).map(([k, m]) => [k, m.q])),
  );
  const [updatedAt, setUpdatedAt] = useState('--:--:--');
  const [netError, setNetError] = useState(null);
  const [polling, setPolling] = useState(true);
  const [input, setInput] = useState('');
  const [toast, setToast] = useState(null);
  const [cart, setCart] = useState(() => readLS(LS_CART, []));
  const [sparks, setSparks] = useState({});
  const [intraday, setIntraday] = useState(null);
  // 走勢圖上的新聞點：預設打開，可以關（打開後每換一檔會抓一次新聞，後端有 5 分鐘快取）
  const [showNews, setShowNews] = useState(() => readLS('tw_us_chart_news_v2', true) !== false);
  const [digest, setDigest] = useState<{ symbol: string; data: any; error: string; loading: boolean } | null>(null);
  const [profileTab, setProfileTab] = useState('basic');
  const [holdOnly, setHoldOnly] = useState(false);
  const [listQuery, setListQuery] = useState('');
  const [selOverview, setSelOverview] = useState<any>(null);
  const [slots, setSlots] = useState<{ chip: Element | null; layout: Element | null }>({ chip: null, layout: null });
  const [sortKey, setSortKey] = useState('default');
  // 持股改用跨頁共用的資料（組合風控、交易檢討也讀同一份）
  const portfolio = usePortfolio();
  const holdings = portfolio.holdings;
  const [fx, setFx] = useState({}); // 幣別 -> 兌台幣匯率
  const [fxWarn, setFxWarn] = useState(null);
  const searchRef = useRef(null);
  const listRef = useRef(null);
  const [order, setOrder] = useState({
    side: 'BUY',
    lotType: 'ROUND',
    tif: 'ROD',
    priceType: 'LIMIT', // 台股：LIMIT 限價／UP 漲停／DOWN 跌停／FLAT 平盤／MKT 市價
    session: 'REGULAR', // 台股：REGULAR 盤中／AFTER 盤後
    usKind: 'NORMAL', // 美股：NORMAL 一般／STOP 觸價／MOO 限定開盤／MOC 限定收盤
    stopPrice: '',
    gtc: false, // 美股長效單
    gtcDate: '',
    usType: 'LIMIT',
    usTif: 'ANY',
    settle: 'FX', // 美股交割：FX 外幣／TWD 台幣
    price: '',
    qty: 1,
  });
  const toastTimer = useRef(null);

  const say = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2400);
  }, []);

  const [categories, setCategories] = useState({});
  const [catFilter, setCatFilter] = useState('ALL');
  const [mktFilter, setMktFilter] = useState(() => readLS('tw_us_mkt_filter_v1', 'ALL'));
  useEffect(() => writeLS('tw_us_mkt_filter_v1', mktFilter), [mktFilter]);
  // 市場區分：台股（含上櫃、ETF、債券 ETF）／美股與其他海外市場
  const inMkt = (x) => mktFilter === 'ALL' || (mktFilter === 'TW' ? isTW(x) : !isTW(x));
  const mktCounts = {
    ALL: watch.length,
    TW: watch.filter(isTW).length,
    INTL: watch.filter((x) => !isTW(x)).length,
  };
  const [rightTab, setRightTab] = useState('quote');
  const cardCtl = useCardLayout(CARD_DEFS);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiTask, setAiTask] = useState('stock');
  // 接收導覽或其他頁面的指令：{ listTab, rightTab, select }
  useEffect(() => {
    const apply = (d) => {
      if (!d) return;
      if (d.listTab) setListTab(d.listTab);
      // 「基本資料與配息」已改成行情分頁裡的一張卡：舊的 rightTab:'info' 指令（導覽、舊連結）改成展開那張卡
      if (d.rightTab === 'info') {
        setRightTab('quote');
        setProfileTab('div');
        cardCtl.reveal('profile');
      } else if (d.rightTab) setRightTab(d.rightTab);
      if (d.select) setSelected(d.select);
      // 步驟條「模擬下單」：展開下單卡並捲過去
      if (d.card) {
        cardCtl.reveal(d.card);
        setTimeout(
          () => document.querySelector(`[data-tour="watch-${d.card}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
          300,
        );
      }
    };
    apply(bus._pendingWatch);
    bus._pendingWatch = null;
    const on = (e) => apply(e.detail);
    window.addEventListener('watch-action', on);
    return () => window.removeEventListener('watch-action', on);
  }, []);
  const [overviewRows, setOverviewRows] = useState({});
  const [overviewLoading, setOverviewLoading] = useState(false);
  const { alerts, setAlerts, log: alertLog } = useAlerts(); // 檢查由 App 上的 AlertWatcher 負責

  useEffect(() => writeLS(LS_WATCH, watch), [watch]);
  useEffect(() => writeLS('tw_us_chart_news_v2', showNews), [showNews]);
  // 技術分析、新聞研究分頁不需要這份（新聞研究有自己的按鈕）；AI 抽屜的事件任務會用到
  const wantNews = aiOpen || (active === 'watch' && rightTab === 'quote' && (showNews || cardCtl.isOpen('news')));
  // 新聞卡或走勢圖新聞點有打開才抓；連續切換標的時等 0.4 秒才抓；過期的回應不要蓋掉新標的。
  // 這裡不帶 AI 設定：語氣用關鍵字規則，不會呼叫 AI、不產生費用
  useEffect(() => {
    if (!wantNews) {
      setDigest(null);
      return undefined;
    }
    let stop = false;
    setDigest({ symbol: selected, data: null, error: '', loading: true });
    const timer = setTimeout(() => {
      cachedJson('/api/news/digest', { symbol: selected }, 295000) // 後端快取 5 分鐘
        .then((d) => {
          if (stop) return;
          setDigest({ symbol: selected, data: d, error: d?.error ? String(d.error) : '', loading: false });
        })
        .catch((e) => !stop && setDigest({ symbol: selected, data: null, error: `新聞載入失敗：${e.message}`, loading: false }));
    }, 400);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [wantNews, selected]);
  // 開高低量卡的「量比」：只抓目前這檔（後端快取 5 分鐘）
  useEffect(() => {
    let stop = false;
    setSelOverview(null);
    cachedJson('/api/overview', { symbols: [selected] }, 295000)
      .then((d) => !stop && setSelOverview(d.rows?.[0] || null))
      .catch(() => {});
    return () => {
      stop = true;
    };
  }, [selected]);
  // 頂欄的插槽（行情狀態、版面設定）在 App 的頂部列；頂部搜尋欄打字時篩選左邊清單
  useEffect(() => {
    setSlots({ chip: document.getElementById('topbar-chip'), layout: document.getElementById('topbar-layout') });
    const onQ = (e) => setListQuery(String(e.detail || ''));
    window.addEventListener('watch-query', onQ);
    return () => window.removeEventListener('watch-query', onQ);
  }, []);
  // 技術分析／新聞研究分頁和左邊清單看同一檔：
  // 在分頁裡點左邊另一檔 → 分析那一檔（不帶 AI，免費）；從別處或輸入框分析了別檔 → 標頭跟著換
  const same = (a, b) => baseCode(String(a || '')) === baseCode(String(b || ''));
  const quoteOf = (s) => quotes[baseCode(s)] || { symbol: s, name: s };
  useEffect(() => {
    if (active === 'mod1' && !same(m1Ticker, selected)) onSendToMod1?.(quoteOf(selected), { silent: true });
    if (active === 'mod2' && !same(m2Target, selected)) onSendToMod2?.(selected, quoteOf(selected).name, { silent: true });
  }, [selected]); // eslint-disable-line
  useEffect(() => {
    if (active === 'mod1' && m1Ticker && !same(m1Ticker, selected)) setSelected(baseCode(m1Ticker));
    if (active === 'mod2' && m2Target && !same(m2Target, selected)) setSelected(baseCode(m2Target));
  }, [active]); // eslint-disable-line
  const m1Sym = m1Data?.snapshot?.symbol;
  useEffect(() => {
    if (active === 'mod1' && m1Sym && !same(m1Sym, selected)) setSelected(baseCode(m1Sym));
  }, [m1Sym]); // eslint-disable-line
  // 頂欄「✦ AI 分析」：依目前分頁決定任務
  useEffect(() => {
    bus.openStockAi = (task) => {
      setAiTask(task || (active === 'mod1' ? 'tech' : active === 'mod2' ? 'event' : 'stock'));
      setAiOpen(true);
    };
    return () => {
      bus.openStockAi = null;
    };
  }, [active]);
  useEffect(() => writeLS(LS_CART, cart), [cart]);

  useEffect(() => {
    let stop = false;
    let timer = null;
    const load = (ttl = 600000) =>
      cachedJson('/api/etf', undefined, ttl)
        .then((d) => {
          if (stop) return;
          setEtfs(d);
          if (d.pending_yields > 0) timer = setTimeout(() => load(0), 6000); // 殖利率背景計算中
        })
        .catch(() => {});
    load();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, []);

  // 需要報價的代號：自選 + 目前選中 + 持股 + 提醒；ETF 名單只有打開 ETF 分頁才抓（平常每 5 秒多抓幾十檔沒人看）
  const allSyms = useMemo(() => {
    const set = new Set(watch);
    if (selected) set.add(selected);
    if (listTab === 'etf') for (const e of etfs.etfs) set.add(e.symbol);
    for (const h of holdings) set.add(h.symbol);
    for (const a of alerts) set.add(a.symbol);
    return [...set];
  }, [watch, etfs, selected, holdings, alerts, listTab]);
  const symKey = allSyms.join(',');

  const quotesBusy = useRef(false);
  const quotesDone = useRef<Record<string, { at: number; key: string }>>({});
  const loadQuotes = useCallback(async (mode?: unknown) => {
    // 上一輪還沒回來（網路或資料來源卡住）就跳過這一輪，請求不會越疊越多
    if (quotesBusy.current) return;
    quotesBusy.current = true;
    // 台股與美股分開請求：台股很快就能先顯示，美股（Yahoo 較慢）晚點補上
    const syms = symKey.split(',').filter(Boolean);
    // 自動更新時，整組都在休市就 30 秒才抓一次（清單有變或按「立即更新」不受限）
    const closedSkip = (group: string[], name: string) => {
      if (mode !== 'auto') return false;
      const last = quotesDone.current[name];
      return !!last && last.key === group.join(',') && Date.now() - last.at < 30000 && !group.some((s) => marketSessionOpen(s));
    };
    const groups = [
      ['tw', syms.filter(isTW)] as [string, string[]],
      ['intl', syms.filter((x) => !isTW(x))] as [string, string[]],
    ].filter(([name, g]) => g.length && !closedSkip(g, name));
    try {
      await Promise.all(
        groups.map(async ([name, group]) => {
          try {
            const res = await fetch('/api/quotes', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ symbols: group }),
            });
            const data = await res.json();
            if (data.error) throw new Error(data.error);
            bus.quoteMemo = bus.quoteMemo || {};
            for (const qq of data.quotes) bus.quoteMemo[baseCode(qq.symbol)] = { q: qq, at: Date.now() }; // 提醒檢查共用
            quotesDone.current[name] = { at: Date.now(), key: group.join(',') };
            setQuotes((prev) => {
              const next = { ...prev };
              for (const qq of data.quotes) next[baseCode(qq.symbol)] = qq;
              return next;
            });
            setUpdatedAt(data.timestamp);
            setNetError(null);
          } catch (e) {
            setNetError(
              `無法連到本機伺服器 (${e.message})。請確認 python -m src.api_server 正在執行。`,
            );
          }
        }),
      );
    } finally {
      quotesBusy.current = false;
    }
  }, [symKey]);

  useEffect(() => {
    loadQuotes();
    if (!polling) return undefined;
    return pollEvery(() => loadQuotes('auto'), 5000);
  }, [loadQuotes, polling]);

  // 迷你走勢：自選股與持股（10 分鐘快取在後端）
  const sparkKey = [...new Set([...watch, ...holdings.map((h) => h.symbol)])].join(',');
  useEffect(() => {
    const syms = sparkKey.split(',').filter(Boolean);
    if (!syms.length) return;
    cachedJson('/api/sparks', { symbols: syms }, 600000) // 後端快取 10 分鐘
      .then((d) => setSparks((prev) => ({ ...prev, ...(d.sparks || {}) })))
      .catch(() => {});
  }, [sparkKey]);

  // 匯率（持股換算台幣用）：依持股實際幣別向後端要各幣別兌台幣匯率，每 5 分鐘更新
  const holdCurrencies = [
    ...new Set(
      holdings
        .map((h) => quotes[baseCode(h.symbol)]?.currency || currencyOf(h.symbol))
        .filter((c) => c && c !== 'TWD'),
    ),
  ]
    .sort()
    .join(',');
  useEffect(() => {
    if (!holdCurrencies) {
      setFx({});
      setFxWarn(null);
      return undefined;
    }
    let stop = false;
    const load = () =>
      cachedJson('/api/fx', { currencies: holdCurrencies.split(',') }, 295000)
        .then((d) => {
          if (stop) return;
          setFx(Object.fromEntries(Object.entries(d.rates || {}).map(([c, r]: [string, any]) => [c, r.rate])));
          const warns = Object.values(d.rates || {})
            .map((r: any) => r.warning)
            .filter(Boolean);
          setFxWarn(warns.length ? warns.join('；') : null);
        })
        .catch(() => {});
    load();
    const cancel = pollEvery(load, 300000);
    return () => {
      stop = true;
      cancel();
    };
  }, [holdCurrencies]);

  // 選中標的的當日分時圖，每 30 秒更新
  useEffect(() => {
    let stop = false;
    let busy = false; // 上一輪還沒回來就跳過
    setIntraday(null);
    const load = () => {
      if (busy) return;
      busy = true;
      cachedJson('/api/intraday', { symbol: selected }, 25000) // 切頁回來不用重抓；30 秒輪詢照常更新
        .then((d) => !stop && setIntraday(d))
        .catch(() => {})
        .finally(() => {
          busy = false;
        });
    };
    load();
    const cancel = pollEvery(load, 30000);
    return () => {
      stop = true;
      cancel();
    };
  }, [selected]);

  // 台美股以外：每手股數與法定稅費（港股每檔不同，後端查港交所清單）
  const [tradeRules, setTradeRules] = useState(null);
  // 手續費折數（與策略回測共用）：在下單面板或回測頁改了，這裡跟著重算
  const [feeDisc, setFeeDisc] = useState(feeDiscount);
  useEffect(() => {
    const on = () => setFeeDisc(feeDiscount());
    window.addEventListener('fee-discount-changed', on);
    return () => window.removeEventListener('fee-discount-changed', on);
  }, []);
  useEffect(() => {
    let stop = false;
    setTradeRules(null);
    const m = marketOf(selected);
    if (m === 'TW') return; // 美股也要查：SEC 規費、FINRA TAF 由後端依今天日期決定
    cachedJson('/api/trade_rules', { symbol: selected }, 3600000)
      .then((d) => !stop && setTradeRules(d))
      .catch(
        (e) =>
          !stop &&
          setTradeRules({ lot: null, fees: [], error: `交易規則查詢失敗：${e.message}` }),
      );
    return () => {
      stop = true;
    };
  }, [selected]);

  // 技術總覽 / RSI 提醒用的指標（後端快取 5 分鐘）
  const needOverview = listTab === 'overview';
  const ovKey = watch.join(',');
  useEffect(() => {
    if (!needOverview) return undefined;
    let stop = false;
    const load = () => {
      setOverviewLoading(true);
      cachedJson('/api/overview', { symbols: ovKey.split(',').filter(Boolean) }, 295000)
        .then((d) => {
          if (stop) return;
          const m = {};
          for (const r of d.rows || []) m[baseCode(r.symbol)] = r;
          setOverviewRows((prev) => ({ ...prev, ...m }));
        })
        .catch(() => {})
        .finally(() => !stop && setOverviewLoading(false));
    };
    load();
    const cancel = pollEvery(load, 300000);
    return () => {
      stop = true;
      cancel();
    };
  }, [needOverview, ovKey]);

  // 分類（股票 / ETF / 債券）
  const catKey = [...new Set([...watch, ...holdings.map((h) => h.symbol)])].join(',');
  useEffect(() => {
    const syms = catKey.split(',').filter(Boolean);
    if (!syms.length) return;
    cachedJson('/api/categories', { symbols: syms }, 3600000)
      .then((d) => setCategories((prev) => ({ ...prev, ...(d.categories || {}) })))
      .catch(() => {});
  }, [catKey]);

  const catCounts = useMemo(() => {
    const inScope = watch.filter(inMkt);
    const c = { ALL: inScope.length, STOCK: 0, ETF: 0, BOND: 0 };
    for (const s2 of inScope) {
      const k = categories[baseCode(s2)]?.category;
      if (k) c[k] += 1;
    }
    return c;
  }, [watch, categories, mktFilter]); // eslint-disable-line

  const watchRows = useMemo(() => {
    const val = (s) => quotes[baseCode(s)];
    const keyFn = {
      chg: (s) => val(s)?.change_pct ?? -999,
      chgAsc: (s) => -(val(s)?.change_pct ?? 999),
      turn: (s) => (val(s)?.price || 0) * (val(s)?.volume || 0) * (isTW(s) ? 1000 : 1),
    }[sortKey];
    const base = watch
      .filter(inMkt)
      .filter((x) => catFilter === 'ALL' || categories[baseCode(x)]?.category === catFilter)
      .filter((x) => !holdOnly || holdings.some((h) => baseCode(h.symbol) === baseCode(x)))
      .filter((x) => {
        const t = listQuery.trim().toLowerCase();
        return !t || x.toLowerCase().includes(t) || String(val(x)?.name || '').toLowerCase().includes(t);
      });
    return keyFn ? [...base].sort((a, b) => keyFn(b) - keyFn(a)) : base;
  }, [watch, quotes, sortKey, catFilter, categories, mktFilter, holdOnly, holdings, listQuery]); // eslint-disable-line

  const q = quotes[baseCode(selected)];
  const tw = isTW(selected);
  const etfFlag = /^00/.test(baseCode(selected));

  // 選股時把價格預設帶入下單面板：每檔只帶一次，之後報價跳動不會蓋掉使用者手動輸入的限價
  const pricedFor = useRef(null);
  useEffect(() => {
    if (q?.price && pricedFor.current !== selected) {
      pricedFor.current = selected;
      setOrder((o) => ({ ...o, price: String(q.price) }));
    }
  }, [q?.price, selected]); // eslint-disable-line

  const addSymbol = async () => {
    let s = normSym(input);
    if (!s) return;
    // 輸入的是名稱（含中文，例如「台積電」）：先查台股名單換成代號；找不到或有好幾檔時請使用者再確認，不亂猜
    // 只看第一段：「2330 台積電」這種代號＋名稱的寫法仍照代號處理（跟以前一樣）
    // 中文開頭＝名稱；英文開頭（AES-KY）可能是台股簡稱也可能是美股代號，只採用名稱完全相符的結果，其餘照代號處理
    const head = input.trim().split(/\s+/)[0];
    const isName = /[\u4e00-\u9fff]/.test(head);
    if (isName || /^[A-Za-z]/.test(head)) {
      let matches = [];
      try {
        const r = await fetch('/api/symbol_search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: input }),
        });
        if (r.status === 404) {
          // 後端是舊版（線上更新只能更新畫面，後端要重新安裝新版安裝包）：沒有名稱查詢，英文開頭照代號處理
          if (isName) return say('此版本的後端還不支援用名稱新增，請輸入代號，或重新安裝新版程式');
        } else {
          matches = (await r.json()).matches || [];
        }
      } catch (_) {
        if (isName) return say('❌ 查詢名稱失敗，請稍後再試或直接輸入代號');
      }
      const pick = matches.find((m) => m.exact) || (isName && matches.length === 1 ? matches[0] : null);
      if (!pick && isName) {
        return say(
          matches.length
            ? `找到多檔：${matches.map((m) => `${m.name} ${m.code}`).join('、')}。請輸入更完整的名稱或代號`
            : `找不到名稱「${input.trim()}」的台股，請確認名稱或直接輸入代號（美股輸入 ticker，例如 AAPL）`,
        );
      }
      if (pick) s = pick.code;
    }
    if (watch.includes(s)) {
      say(`ℹ️ ${s} 已在自選清單，沒有重複加入`);
    } else {
      setWatch([...watch, s]);
      notifySaved(`已把 ${s} 加入自選股`);
    }
    setSelected(s);
    setListTab('watch');
    setInput('');
  };
  const removeSymbol = (s) => {
    setWatch(watch.filter((x) => x !== s));
    if (selected === s) setSelected(watch.find((x) => x !== s) || '2330');
    notifySaved(`已從自選股移除 ${s}`);
  };

  const etfRows = useMemo(() => {
    const rows = etfs.etfs.map((e) => {
      const lq = quotes[e.symbol];
      const turnover = lq?.price && lq?.volume ? lq.price * lq.volume * 1000 : 0;
      return { ...e, lq, turnover };
    });
    const key = {
      hot: 'turnover',
      aum: 'aum_billion',
      plan: 'savings_plan_accounts',
      yield: 'yield_pct',
    }[etfSort];
    // 沒有資料的排最後
    return rows.sort((a, b) => (b[key] ?? -1) - (a[key] ?? -1));
  }, [etfs, quotes, etfSort]);

  // 鍵盤：/ 聚焦搜尋；↑↓ 在目前分頁的清單中切換標的，並把焦點與捲動跟到新選的那一列
  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (e.key === '/') {
        e.preventDefault();
        setListTab('watch');
        setTimeout(() => searchRef.current?.focus(), 0);
      } else if (active === 'watch' && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        const list =
          listTab === 'hold'
            ? holdings.map((h) => h.symbol)
            : listTab === 'etf'
              ? etfRows.map((r) => r.symbol)
              : watchRows;
        const i = list.findIndex((x) => baseCode(x) === baseCode(selected));
        const next =
          list[Math.max(0, Math.min(list.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
        if (next) {
          e.preventDefault();
          setSelected(next);
          requestAnimationFrame(() => {
            const row = listRef.current?.querySelector(`[data-sym="${baseCode(next)}"]`);
            row?.focus({ preventScroll: true });
            row?.scrollIntoView({ block: 'nearest' });
          });
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, listTab, holdings, watchRows, etfRows, selected]);

  const etfMetric = (r) => {
    if (etfSort === 'hot') return `成交 ${fmt(r.turnover / 1e8, 1)} 億`;
    if (etfSort === 'aum')
      return r.aum_billion == null ? '規模 無資料' : `市值約 ${fmt(r.aum_billion, 0)} 億`;
    if (etfSort === 'plan')
      return r.savings_plan_accounts == null
        ? '定期定額戶數：不在前 20 名'
        : `定期定額 ${fmt(r.savings_plan_accounts / 10000, 1)} 萬戶`;
    return r.yield_pct == null
      ? '殖利率計算中…'
      : `近12月殖利率 ${fmt(r.yield_pct, 2)}%（${r.n_dividends} 次配息）`;
  };

  // 下單試算與檢核
  // 台股價格類型不是「限價」時，價格跟著報價走：漲停／跌停／平盤（昨收）；市價買用最佳賣價、賣用最佳買價
  // 盤後整張是「盤後定價交易」，一律用收盤價
  const afterRound = tw && order.session === 'AFTER' && order.lotType === 'ROUND';
  const derivedPrice = !tw
    ? null
    : afterRound
      ? q?.price
      : order.priceType === 'UP'
        ? q?.limit_up
        : order.priceType === 'DOWN'
          ? q?.limit_down
          : order.priceType === 'FLAT'
            ? q?.prev_close
            : order.priceType === 'MKT'
              ? (order.side === 'BUY' ? q?.asks?.[0]?.price : q?.bids?.[0]?.price) || q?.price
              : null;
  const priceLocked = tw && (afterRound || order.priceType !== 'LIMIT');
  const priceNum = priceLocked ? Number(derivedPrice || 0) : Number(order.price);
  const qtyNum = Number(order.qty);
  const shares = tw ? (order.lotType === 'ROUND' ? qtyNum * 1000 : qtyNum) : qtyNum;
  const amount = priceNum * shares;
  // 台股手續費與證交稅都是「元以下無條件捨去」（與券商對帳單一致）；手續費整張最低 20 元、零股最低 1 元
  const fee = tw ? twFee(amount, order.lotType === 'ROUND', feeDisc) : 0;
  const sideKey = order.side === 'SELL' ? 'SELL' : 'BUY';
  const statutoryTax = (tradeRules?.fees || [])
    .filter((f) => f.side === sideKey || f.side === 'BOTH')
    .reduce((s, f) => {
      // 與後端 trade_rules.statutory_cost 相同：按金額（rate）或按股數（per_share，美股 TAF），可有最低／上限
      let v = f.per_share != null ? shares * f.per_share : amount * f.rate;
      v = f.ceil ? Math.ceil(v - 1e-9) : Math.round(v * 100) / 100;
      if (f.min != null) v = Math.max(f.min, v);
      if (f.max != null) v = Math.min(f.max, v);
      return s + v;
    }, 0);
  const tax = tw
    ? order.side === 'SELL'
      ? Math.floor(amount * twSellTaxRate(baseCode(selected)) + 1e-9)
      : 0
    : Math.round(statutoryTax * 100) / 100;
  const orderIssues = [];
  if (!(priceNum > 0))
    orderIssues.push(priceLocked ? '目前取不到這個價格類型的報價資料（漲跌停／昨收／五檔），請改用限價' : '請輸入價格');
  // 數量：台股整張與零股買進要整數；台股零股賣出允許小數（把銀行碎股記錄平倉用）；美股可交易碎股
  if (!(qtyNum > 0)) orderIssues.push('數量需大於 0');
  else if (tw && order.lotType === 'ROUND' && !Number.isInteger(qtyNum))
    orderIssues.push('整張數量需為整數');
  else if (tw && !Number.isInteger(qtyNum) && order.side === 'BUY')
    orderIssues.push('台股零股買進需為整數股');
  else if (tw && !Number.isInteger(qtyNum))
    orderIssues.push('提醒：台股實際不能交易小數股，這裡只是把持股裡的碎股記錄平倉');
  if (tw && order.lotType === 'ODD' && qtyNum >= 1000) orderIssues.push('零股需少於 1000 股');
  if (tw && priceNum > 0 && !isOnTick(priceNum, twTick(priceNum, etfFlag)))
    orderIssues.push(`價格不符台股跳動檔位（此價位應為 ${twTick(priceNum, etfFlag)} 的倍數）`);
  if (tw && q?.limit_up && priceNum > q.limit_up) orderIssues.push(`高於漲停價 ${q.limit_up}`);
  if (tw && q?.limit_down && priceNum > 0 && priceNum < q.limit_down)
    orderIssues.push(`低於跌停價 ${q.limit_down}`);
  if (tw && order.lotType === 'ODD' && order.tif === 'ROD' && order.session === 'REGULAR')
    // 盤中零股是集合競價：09:10 第一次撮合，之後每 5 秒一次（2024-12-02 起；原本寫「逐筆撮合」是錯的）
    // 出處：證交所／櫃買中心零股交易規則 https://www.tpex.org.tw/zh-tw/mainboard/trading/rules/odd-lot.html（查證 2026-10-29）
    orderIssues.push('提醒：盤中零股是集合競價，09:10 第一次撮合、之後每 5 秒撮合一次；ROD 當日有效');
  if (tw && order.session === 'AFTER') {
    orderIssues.push(
      order.lotType === 'ROUND'
        ? '提醒：盤後定價交易 14:00～14:30 接受委託，一律以當日收盤價成交（模擬用目前價格）'
        : '提醒：盤後零股 13:40～14:30 接受委託，14:30 一次撮合',
    );
    if (order.tif !== 'ROD') orderIssues.push('盤後交易只接受 ROD');
    if (order.lotType === 'ODD' && order.priceType !== 'LIMIT') orderIssues.push('盤後零股只接受限價委託');
  }
  if (tw && order.priceType === 'MKT' && order.session === 'REGULAR')
    orderIssues.push('提醒：市價單不保證成交價，模擬以目前最佳一檔價格計算');
  if (!tw && order.usType === 'MARKET' && order.side === 'BUY') orderIssues.push('市價只能用在賣出');
  if (!tw && order.usKind === 'STOP' && !(Number(order.stopPrice) > 0)) orderIssues.push('觸價單請輸入觸發價');
  if (!tw && order.usKind === 'STOP' && Number(order.stopPrice) > 0)
    orderIssues.push(
      `提醒：觸價單要等價格${order.side === 'BUY' ? '漲到' : '跌到'} ${order.stopPrice} 才會送出；模擬成交不等待觸發`,
    );
  if (!tw && (order.usKind === 'MOO' || order.usKind === 'MOC'))
    orderIssues.push(
      `提醒：${order.usKind === 'MOO' ? '限定開盤只在開盤競價' : '限定收盤只在收盤競價'}成交；模擬以目前價格計算`,
    );
  if (!tw && order.gtc && !(order.gtcDate > localDate()))
    orderIssues.push('長效單的到期日要晚於今天');
  const lot = tradeRules?.lot;
  if (!tw && tradeRules?.error) orderIssues.push(`提醒：${tradeRules.error}，無法檢查每手股數`);
  if (!tw && lot > 1 && qtyNum > 0 && qtyNum % lot !== 0)
    orderIssues.push(
      order.side === 'BUY'
        ? `每手 ${lot} 股，買進股數需為 ${lot} 的倍數`
        : `提醒：每手 ${lot} 股，不足一手的部分實際要在碎股市場賣出`,
    );

  const hardIssues = orderIssues.filter((x) => !x.startsWith('提醒'));
  // 模擬「成交」：買進加入持股、賣出寫入交易紀錄（跨頁共用）
  const fillCartItem = (c) => {
    const sh = c.market === 'TW' && c.unit === '張' ? c.qty * 1000 : c.qty;
    const r = fillOrder({
      symbol: normSym(c.symbol),
      side: c.side,
      price: c.price,
      shares: sh,
      fees: (c.fee || 0) + (c.tax || 0),
      name: c.name && c.name !== c.symbol ? c.name : '',
      orderType: c.type || '',
    });
    if (r.ok) {
      setCart(cart.filter((x) => x.id !== c.id));
      notifySaved(r.msg); // 持股／交易紀錄真的存進檔案才顯示成功
    } else {
      say(`⚠️ ${r.msg}`);
    }
  };

  const addToCart = () => {
    if (hardIssues.length) {
      say(`⚠️ 無法加入：${hardIssues[0]}`);
      return false;
    }
    const item = {
      id: Date.now(),
      symbol: selected,
      name: q?.name || selected,
      market: marketOf(selected),
      side: order.side,
      price: priceNum,
      qty: qtyNum,
      unit: tw ? (order.lotType === 'ROUND' ? '張' : '股') : '股',
      type: orderLabel(order, tw),
      amount,
      fee,
      tax,
    };
    setCart([item, ...cart]);
    notifySaved(
      `已把 ${selected} ${order.side === 'BUY' ? '買進' : '賣出'}委託加入暫存匣（模擬，不會真的下單）`,
    );
    return true;
  };


  // 行情分頁的卡片：外框是 CardBox，模擬下單、估值、基本資料沿用原本的元件與資料
  const newsData = digest?.data;
  const chartNews = newsData ? [...(newsData.items || []), ...(newsData.others || [])] : undefined;
  const goOrder = (side) => {
    setRightTab('quote');
    goTab?.('watch');
    setOrder((o) => ({ ...o, side }));
    cardCtl.reveal('order');
    setTimeout(() => document.querySelector('[data-card="order"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
  };
  const openAi = (task) => {
    setAiTask(task);
    setAiOpen(true);
  };
  const onStockTab = (id) => {
    if (id === 'heatmap' || id === 'watch') {
      setRightTab(id === 'heatmap' ? 'heatmap' : 'quote');
      goTab?.('watch');
    } else if (id === 'mod1') {
      if (same(m1Ticker, selected) && m1Data) goTab?.('mod1');
      else onSendToMod1?.(quoteOf(selected), { silent: true });
    } else if (same(m2Target, selected)) goTab?.('mod2');
    else onSendToMod2?.(selected, quoteOf(selected).name, { silent: true });
  };
  const inWatch = watch.some((x) => baseCode(x) === baseCode(selected));
  const toggleWatch = () => {
    if (inWatch) {
      setWatch(watch.filter((x) => baseCode(x) !== baseCode(selected)));
      notifySaved(`已把 ${baseCode(selected)} 移出自選股`);
    } else {
      setWatch([...watch, baseCode(selected)]);
      notifySaved(`已把 ${baseCode(selected)} 加入自選股`);
    }
  };
  const myHoldN = holdings.filter((h) => baseCode(h.symbol) === baseCode(selected)).reduce((a, h) => a + h.shares, 0);
  const renderCard = (id) => {
    if (!q) return null;
    switch (id) {
      case 'chart':
        return (
          <CardBox key={id} id={id} title="分時走勢" sub={`${fmt(q.price)}  ${q.change_pct > 0 ? '+' : ''}${fmt(q.change_pct)}%`} ctl={cardCtl}>
            <StockChart
              symbol={selected}
              quoteTime={q?.quote_time}
              livePrice={q?.is_live && !q.price_is_mid ? q.price : undefined}
              intraday={intraday}
              tz={tzOf(selected)}
              news={chartNews}
              showNews={showNews}
              setShowNews={setShowNews}
              newsLoading={digest?.loading}
              newsError={digest?.error}
            />
          </CardBox>
        );
      case 'stats':
        return (
          <CardBox key={id} id={id} title="開高低量・區間" sub={selOverview?.volume_ratio == null ? undefined : `量比 ${fmt(selOverview.volume_ratio, 2)}x`} ctl={cardCtl}>
            <StatsBody q={q} tw={tw} etf={etfFlag} intraday={intraday} volRatio={selOverview?.volume_ratio} />
          </CardBox>
        );
      case 'depth':
        return (
          <CardBox key={id} id={id} title="委買／委賣五檔" sub={tw ? '委買／委賣' : `${marketName(selected)}無五檔`} ctl={cardCtl}>
            <DepthBody q={q} tw={tw} />
          </CardBox>
        );
      case 'order':
        return (
          <CardBox key={id} id={id} title="模擬下單" sub={`${order.side === 'BUY' ? '買進' : '賣出'}・暫存匣 ${cart.length}`} ctl={cardCtl}>
            <OrderPanel
              ctx={{
                addToCart,
                fillCartItem,
                amount,
                cart,
                fee,
                order,
                orderIssues,
                q,
                setCart,
                setOrder,
                tax,
                tradeRules,
                tw,
                priceNum,
                priceLocked,
                etfFlag,
                afterRound,
                feeDisc,
              }}
            />
          </CardBox>
        );
      case 'news':
        return (
          <CardBox key={id} id={id} title="相關新聞" sub={newsData?.items ? `${newsData.items.length + (newsData.others?.length || 0)} 則` : undefined} ctl={cardCtl}>
            <NewsBody
              digest={newsData}
              loading={!!digest?.loading}
              error={digest?.error || ''}
              onAskAi={() => openAi('event')}
              onDeep={() => onStockTab('mod2')}
            />
          </CardBox>
        );
      case 'val':
        return <ValuationCard key={id} symbol={selected} ctl={cardCtl} />;
      case 'profile':
        return (
          <CardBox key={id} id={id} title="基本資料・配息" ctl={cardCtl}>
            <div className="flex gap-1" role="tablist" aria-label="基本資料分類">
              {PROFILE_TABS.map(([k, label]) => (
                <button
                  type="button"
                  role="tab"
                  key={k}
                  aria-selected={profileTab === k}
                  onClick={() => setProfileTab(k)}
                  className={`flex-1 rounded-lg px-1 py-[5px] text-xs cursor-pointer ${profileTab === k ? 'bg-[#4f7cff]/25 text-white' : 'bg-white/5 text-slate-400 hover:text-white'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div data-tour="stock-info" className="max-h-[440px] overflow-y-auto pr-1">
              <StockInfoPanel symbol={selected} hideValuation tab={profileTab} onAskAi={() => openAi('stock')} />
            </div>
          </CardBox>
        );
      case 'hold':
        return (
          <CardBox key={id} id={id} title="我的持股" sub={myHoldN ? `${fmt(myHoldN, Number.isInteger(myHoldN) ? 0 : 4)} 股` : '未持有'} ctl={cardCtl}>
            <HoldBody
              holdings={holdings}
              quotes={quotes}
              fx={fx}
              selected={selected}
              price={q.price}
              onPick={setSelected}
              onSell={() => goOrder('SELL')}
            />
          </CardBox>
        );
      default:
        return null;
    }
  };

  return (
    <div className="space-y-4" data-tour="watch-root">
      {/* 行情狀態、自動更新、立即更新、新手導覽、版面設定都放到頂欄（App 的頂部列留了插槽） */}
      {slots.chip &&
        ReactDOM.createPortal(
          <div className="flex flex-wrap items-center gap-1.5 text-xs" title="選一檔股票 → 看行情 → 送去技術分析。左邊挑標的，右邊看報價與模擬下單。紅色代表上漲、綠色代表下跌（台灣習慣，可用右邊按鈕切換）。">
            <button
              type="button"
              onClick={() => setPolling(!polling)}
              aria-pressed={polling}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-white/10 bg-white/5 text-slate-400 hover:text-white cursor-pointer"
            >
              <span
                aria-hidden="true"
                className={`w-[7px] h-[7px] rounded-full ${polling ? 'ta-live-dot' : 'bg-slate-500'}`}
              />
              {polling ? '即時行情・每 5 秒更新（休市 30 秒）' : '已暫停自動更新'}
              <span className="mono">{updatedAt}</span>
            </button>
            <button
              type="button"
              onClick={() => loadQuotes()}
              className="px-2.5 py-1 rounded-[10px] border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 cursor-pointer"
            >
              ↻ 立即更新
            </button>
            <button
              type="button"
              onClick={onShowTour}
              className="px-2.5 py-1 rounded-[10px] border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 cursor-pointer"
            >
              新手導覽
            </button>
          </div>,
          slots.chip,
        )}
      {slots.layout && ReactDOM.createPortal(<LayoutMenu ctl={cardCtl} />, slots.layout)}

      {netError && (
        <div className="rounded-xl border border-rose-700 bg-rose-950/60 text-rose-200 text-sm px-4 py-3">
          ⚠️ {netError}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[340px_minmax(0,1fr)] gap-4 items-start">
        {/* ===== 左：清單 ===== */}
        <aside
          className="ta-card xl:sticky xl:top-0 xl:max-h-[calc(100vh-130px)] flex flex-col bg-slate-900/90 border border-slate-800 rounded-2xl p-3 gap-2.5"
          data-tour="watch-list"
        >
          <div className="grid grid-cols-3 gap-1 shrink-0" role="tablist" aria-label="左側清單">
            {[
              ['watch', '自選股'],
              ['etf', 'ETF 精選'],
              ['hold', '我的持股'],
              ['overview', '技術總覽'],
              ['alerts', '提醒'],
              ['div', '配息月曆'],
            ].map(([id, label]) => (
              <button
                type="button"
                key={id}
                role="tab"
                aria-selected={listTab === id}
                onClick={() => setListTab(id)}
                className={`py-1.5 px-0.5 rounded-[9px] text-xs border cursor-pointer transition-colors ${
                  listTab === id
                    ? 'bg-[#4f7cff]/20 border-[#4f7cff] text-white'
                    : 'bg-transparent border-white/10 text-slate-400 hover:text-slate-200'
                }`}
              >
                {label}
                {id === 'alerts' && alerts.some((a) => !a.active) && <span className="text-amber-300"> •</span>}
              </button>
            ))}
          </div>

          {listTab === 'watch' && (
            <div className="flex gap-1.5 shrink-0 order-2">
              <input
                ref={searchRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addSymbol()}
                placeholder="輸入代號或台股名稱（按 / 快速聚焦）如 2330、台積電、AAPL"
                aria-label="新增自選股代號或台股名稱"
                className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded-[9px] px-2.5 py-1.5 text-xs text-white focus:outline-none"
              />
              <button
                type="button"
                onClick={addSymbol}
                className="px-3 rounded-[10px] border border-white/10 bg-white/5 text-xs text-slate-100 hover:bg-white/10 cursor-pointer"
              >
                ＋ 新增
              </button>
            </div>
          )}

          {(listTab === 'watch' || listTab === 'div' || listTab === 'overview') && (
            <div data-tour="watch-filters" className="flex flex-wrap items-center gap-1.5 shrink-0 order-1">
              {[
                ['ALL', '全部', mktFilter, setMktFilter, mktCounts],
                ['TW', '台股', mktFilter, setMktFilter, mktCounts],
                ['INTL', '美股／海外', mktFilter, setMktFilter, mktCounts],
                ['STOCK', '股票', catFilter, (v) => setCatFilter(catFilter === v ? 'ALL' : v), catCounts],
                ['ETF', 'ETF', catFilter, (v) => setCatFilter(catFilter === v ? 'ALL' : v), catCounts],
                ['BOND', '債券', catFilter, (v) => setCatFilter(catFilter === v ? 'ALL' : v), catCounts],
              ].map(([k, label, cur, set, counts]: any) => (
                <button
                  type="button"
                  key={k}
                  aria-pressed={cur === k}
                  onClick={() => set(k)}
                  className={`px-2.5 py-[3px] rounded-full text-xs border cursor-pointer ${
                    cur === k ? 'bg-[#4f7cff]/20 border-[#4f7cff] text-white' : 'border-white/10 text-slate-400 hover:text-white'
                  }`}
                >
                  {label} <span className="mono text-[10px] opacity-70">{counts[k]}</span>
                </button>
              ))}
              {listTab === 'watch' && (
                <button
                  type="button"
                  aria-pressed={holdOnly}
                  onClick={() => setHoldOnly(!holdOnly)}
                  className={`px-2.5 py-[3px] rounded-full text-xs border cursor-pointer ${
                    holdOnly ? 'bg-[#4f7cff]/20 border-[#4f7cff] text-white' : 'border-white/10 text-slate-400 hover:text-white'
                  }`}
                >
                  持有
                </button>
              )}
            </div>
          )}

          {listTab === 'watch' && (
            <div className="flex items-center gap-2 text-[11px] text-slate-400 shrink-0 order-3">
              排序
              <select
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value)}
                aria-label="自選股排序"
                className="bg-slate-950 border border-slate-700 rounded px-1.5 py-1 text-slate-200"
              >
                <option value="default">我的順序</option>
                <option value="chg">漲幅大→小</option>
                <option value="chgAsc">跌幅大→小</option>
                <option value="turn">成交金額</option>
              </select>
              <span className="ml-auto text-slate-500">↑↓ 切換標的</span>
            </div>
          )}

          {listTab === 'etf' && (
            <div className="space-y-1.5 shrink-0 order-1">
              <div className="grid grid-cols-4 gap-0.5 rounded-[10px] border border-white/10 bg-white/5 p-0.5">
                {[
                  ['hot', '今日熱門'],
                  ['aum', '資產規模'],
                  ['plan', '定期定額戶'],
                  ['yield', '殖利率'],
                ].map(([id, label]) => (
                  <button
                    type="button"
                    key={id}
                    aria-pressed={etfSort === id}
                    onClick={() => setEtfSort(id)}
                    className={`py-1 rounded-lg text-xs cursor-pointer ${
                      etfSort === id ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-slate-500 leading-snug">
                {etfSort === 'hot'
                  ? '今日熱門＝即時成交金額（真實報價計算）'
                  : etfSort === 'aum'
                    ? '市值估算＝TWSE 發行單位數 × 即時市價（非淨值規模）'
                    : etfSort === 'plan'
                      ? 'TWSE 定期定額交易戶數排行，只有前 20 名有值（不是總持股人數）'
                      : '近 12 個月實際配息 ÷ 現價，由 Yahoo 配息紀錄自行計算'}
              </p>
            </div>
          )}

          <div ref={listRef} className="flex-1 min-h-[120px] overflow-y-auto space-y-1.5 pr-1 order-4">
            {listTab === 'etf' && etfRows.some((r) => r.yield_pct != null) && (
              <div className="pb-1">
                <div className="text-[11.5px] text-slate-400 mb-1">殖利率比較（前 8 檔）</div>
                <HBars
                  items={etfRows
                    .filter((r) => r.yield_pct != null)
                    .slice(0, 8)
                    .map((r) => ({ label: r.name || r.symbol, value: r.yield_pct, id: r.symbol, color: '#8b5cf6' }))}
                  format={(v) => `${fmt(v)}%`}
                  onPick={setSelected}
                  plain
                />
              </div>
            )}
            {listTab === 'watch' &&
              watchRows.map((s) => (
                <Row
                  key={s}
                  sym={s}
                  quote={quotes[baseCode(s)]}
                  spark={sparks[s]}
                  tag={categories[baseCode(s)]}
                  active={baseCode(selected) === baseCode(s)}
                  onClick={() => setSelected(s)}
                  action={
                    <button
                      type="button"
                      title="從自選移除"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeSymbol(s);
                      }}
                      className="text-slate-600 hover:text-rose-400 text-xs px-1 cursor-pointer"
                    >
                      ✕
                    </button>
                  }
                />
              ))}
            {listTab === 'etf' &&
              etfRows.map((r, i) => (
                <Row
                  key={r.symbol}
                  sym={r.symbol}
                  rank={i + 1}
                  nameOverride={r.name}
                  sub={`${r.tag}・${etfMetric(r)}`}
                  quote={r.lq}
                  active={baseCode(selected) === r.symbol}
                  onClick={() => setSelected(r.symbol)}
                  action={
                    watch.includes(r.symbol) ? (
                      <span className="text-[10px] text-slate-500">已自選</span>
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setWatch([...watch, r.symbol]);
                          notifySaved(`已把 ${r.symbol} 加入自選股`);
                        }}
                        className="text-[11px] px-1.5 py-0.5 rounded bg-slate-800 text-sky-300 hover:bg-slate-700 cursor-pointer"
                      >
                        ＋自選
                      </button>
                    )
                  }
                />
              ))}
            {listTab === 'overview' && (
              <OverviewPanel
                symbols={watchRows}
                rows={overviewRows}
                quotes={quotes}
                selected={selected}
                onSelect={setSelected}
                loading={overviewLoading}
              />
            )}
            {listTab === 'div' && (
              <DividendCalendar
                symbols={watchRows}
                quotes={quotes}
                categories={categories}
                selected={selected}
                holdings={holdings}
                fx={fx}
                onSelect={(x) => {
                  setSelected(x);
                  setRightTab('quote');
                  setProfileTab('div');
                  cardCtl.reveal('profile');
                  goTab?.('watch');
                }}
              />
            )}
            {listTab === 'alerts' && (
              <AlertsPanel
                alerts={alerts}
                setAlerts={setAlerts}
                selected={selected}
                log={alertLog}
              />
            )}
            {listTab === 'hold' && (
              <HoldingsPanel
                holdings={holdings}
                quotes={quotes}
                fx={fx}
                fxWarn={fxWarn}
                holdCurrencies={holdCurrencies}
                sparks={sparks}
                selected={selected}
                onSelect={setSelected}
                onSell={(r) => {
                  // 台股：整張用張；不足 1000 股用零股；超過 1000 股又不是整張，先帶整張，零頭要再下一筆零股
                  const t = isTW(r.symbol);
                  const lots = Math.floor(r.shares / 1000);
                  const rest = Math.round((r.shares - lots * 1000) * 10000) / 10000;
                  const round = t && lots > 0;
                  setSelected(r.symbol);
                  setRightTab('quote');
                  goTab?.('watch');
                  cardCtl.reveal('order');
                  setTimeout(() => document.querySelector('[data-card="order"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
                  setOrder((o) => ({
                    ...o,
                    side: 'SELL',
                    lotType: t ? (round ? 'ROUND' : 'ODD') : o.lotType,
                    qty: round ? lots : r.shares,
                    price: String(r.price ?? r.cost),
                    priceType: 'LIMIT',
                    session: 'REGULAR', // 之前選了盤後的話，整張會鎖成收盤價，帶入的價格就沒作用
                  }));
                  say(
                    round && rest > 0
                      ? `已帶入賣出 ${lots} 張；剩下的 ${rest} 股請成交後再切「零股」下一筆`
                      : '已帶入賣出委託：確認右側下單面板後「加入暫存匣」再按「成交」，就會寫入交易紀錄',
                  );
                }}
                say={say}
                onSendHoldings={onSendHoldings}
                prefill={holdPrefill}
                onPrefillUsed={() => setHoldPrefill(null)}
              />
            )}
            {listTab === 'watch' && watch.length > 0 && watchRows.length === 0 && (
              <div className="text-sm text-slate-500 text-center py-6">
                這個篩選條件下沒有自選股，可改選「全部」或新增代號。
              </div>
            )}
            {listTab === 'watch' && watch.length === 0 && (
              <div className="text-sm text-slate-500 text-center py-6">
                清單是空的，上方輸入代號新增。
              </div>
            )}
          </div>
          {listTab === 'watch' && (
            <button
              type="button"
              onClick={() => {
                setWatch(DEFAULT_WATCH);
                notifySaved('自選股已還原為預設 8 檔');
              }}
              className="text-[11px] text-slate-500 hover:text-slate-300 cursor-pointer shrink-0 order-5 text-left"
            >
              共 {watch.length} 檔・↺ 還原預設 8 檔
            </button>
          )}
        </aside>

        {/* ===== 右：報價卡（內含分頁）＋ 內容 ===== */}
        <section className="min-w-0 space-y-3.5">
          <div className="ta-card bg-slate-900/90 border border-slate-800 rounded-2xl px-4 py-3.5" data-tour="watch-quote">
            {q ? (
              // 股價固定在右上角、左邊文字單行：換標的時（來源說明長短不同）數字位置不會跳
              <div className="flex items-start justify-between gap-3 min-h-[76px]">
                <div className="min-w-0 flex-1">
                  <div className="text-[22px] font-extrabold text-white truncate">
                    {q.name}
                    <small className="ml-1.5 text-[13px] font-medium text-slate-400 mono">{q.symbol}</small>
                  </div>
                  <div className="mt-1 flex items-center gap-1 min-w-0">
                    <span className="shrink-0 inline-block px-2 py-0.5 rounded-full text-[11px] bg-[#4f7cff]/20 text-[#b8c8ff]">{marketName(selected)}</span>
                    {categories[baseCode(selected)] && <CatChip cls={categories[baseCode(selected)]} />}
                    {q.error ? (
                      <span className="text-xs text-rose-300 truncate" title={`抓取失敗：${q.error}（為避免誤導，不顯示任何替代數字）`}>
                        抓取失敗：{q.error}（為避免誤導，不顯示任何替代數字）
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400 truncate" title={`真實資料・${q.source}・最後成交 ${q.quote_time || '--'}`}>
                        真實資料・{String(q.source || '').split('（')[0]}・最後成交 {q.quote_time || '--'}
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className={`mono text-[28px] sm:text-[38px] leading-tight font-extrabold ${colorOf(q.change)}`}>{fmt(q.price)}</div>
                  {q.price_is_mid && (
                    <div className="text-[11px] text-amber-300" title="證交所這一刻沒有回傳成交價，這裡顯示的是最佳買價與最佳賣價的平均，不是實際成交價；有成交後會自動換成成交價。">
                      買賣中間價（尚未成交）
                    </div>
                  )}
                  <span
                    className={`mono inline-block mt-1 px-2.5 py-0.5 rounded-full text-[13px] font-semibold whitespace-nowrap ${colorOf(q.change)}`}
                    style={{
                      background: `color-mix(in srgb,${q.change > 0 ? 'var(--up)' : q.change < 0 ? 'var(--down)' : '#8a93a8'} 16%,transparent)`,
                      boxShadow: q.change ? `0 0 18px color-mix(in srgb,${q.change > 0 ? 'var(--up)' : 'var(--down)'} 30%,transparent)` : undefined,
                    }}
                  >
                    {q.change > 0 ? '▲' : q.change < 0 ? '▼' : ''} {fmt(Math.abs(q.change))}（{q.change_pct > 0 ? '+' : ''}
                    {fmt(q.change_pct)}%）
                  </span>
                </div>
              </div>
            ) : (
              <div className="min-h-[76px] py-3 text-sm text-slate-400">正在抓取 {selected} 的報價…</div>
            )}
            <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
              <button
                type="button"
                onClick={() => goOrder('BUY')}
                className="px-3 py-1.5 rounded-[10px] text-[12.5px] font-bold text-white cursor-pointer hover:brightness-110"
                style={{ background: 'linear-gradient(135deg,var(--up),color-mix(in srgb,var(--up) 60%,#000))' }}
              >
                買進
              </button>
              <button
                type="button"
                onClick={() => goOrder('SELL')}
                className="px-3 py-1.5 rounded-[10px] text-[12.5px] font-bold text-[#04130d] cursor-pointer hover:brightness-110"
                style={{ background: 'linear-gradient(135deg,var(--down),color-mix(in srgb,var(--down) 60%,#000))' }}
              >
                賣出
              </button>
              {[
                ['加入我的持股', () => {
                  setHoldPrefill({ symbol: baseCode(selected), shares: '', cost: String(q?.price ?? '') });
                  setListTab('hold');
                }, undefined],
                ['設提醒', () => setListTab('alerts'), undefined],
                ['存股試算', () => openSavings?.(baseCode(selected)), '到存股計畫，用這檔的長期報酬率試算定期定額'],
                [inWatch ? '移出自選' : '加入自選', toggleWatch, undefined],
              ].map(([label, fn, hint]: any) => (
                <button
                  type="button"
                  key={label}
                  onClick={fn}
                  title={hint}
                  className="px-3 py-1.5 rounded-[10px] border border-white/10 bg-white/5 text-[12.5px] text-slate-100 hover:bg-white/10 cursor-pointer"
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="mt-3">
              <StockTabs active={active === 'watch' ? (rightTab === 'heatmap' ? 'heatmap' : 'watch') : active} onGo={onStockTab} />
            </div>
          </div>

          {active === 'mod1' && techPanel}
          {active === 'mod2' && newsPanel}
          {active === 'watch' && rightTab === 'heatmap' && (
            <HeatmapPanel
              watch={watch}
              holdings={holdings}
              selected={selected}
              onSelect={setSelected}
              onOpenQuote={(s) => {
                setSelected(s);
                setRightTab('quote');
              }}
              onSendMod1={(it) => onSendToMod1(quotes[baseCode(it.symbol)] || it)}
              onSendMod2={(it) => onSendToMod2(it.symbol, it.name)}
            />
          )}
          {active === 'watch' && rightTab === 'quote' && q && <CardGrid ctl={cardCtl} render={renderCard} />}
        </section>
      </div>

      <AiDrawer
        q={q}
        open={aiOpen}
        task={aiTask}
        setTask={setAiTask}
        onClose={() => setAiOpen(false)}
        m1Data={m1Data}
        m2Data={m2Data}
        digest={newsData}
        onRunTech={() => onSendToMod1?.(quoteOf(selected), { silent: true })}
      />

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-slate-800 border border-slate-600 text-white text-sm px-4 py-2 rounded-xl shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

// 其他頁面（多圖走勢、大盤籌碼、存股計畫）一鍵切到看盤頁看某一檔：看盤頁掛上時讀 _pendingWatch
const openInWatch = (sym) => {
  if (!sym) return;
  const detail = { select: normSym(sym), rightTab: 'quote' };
  bus._pendingWatch = detail;
  bus.goTab?.('watch');
  window.dispatchEvent(new CustomEvent('watch-action', { detail }));
};

export { WatchPage, openInWatch };
