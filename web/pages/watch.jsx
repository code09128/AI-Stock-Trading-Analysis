// 看盤頁：左側清單（自選股/ETF/持股）＋右側報價、分時圖、五檔、模擬下單
(() => {
  const { useState, useEffect, useMemo, useCallback, useRef } = React;
  const {
    DEFAULT_WATCH,
    LS_WATCH,
    LS_CART,
    readLS,
    writeLS,
    isTW,
    currencyOf,
    marketName,
    normSym,
    baseCode,
    fmt,
    colorOf,
    twTick,
    isOnTick,
    Tip,
    Stat,
    RangeBar,
    IntradayChart,
  } = window.TA;
  const {
    Row,
    SourcePanel,
    useAlerts,
    AlertsPanel,
    OverviewPanel,
    StockInfoPanel,
    DividendCalendar,
    CatChip,
  } = window.TA;

  // ---------- 看盤頁 ----------
  function WatchPage({ onSendToMod1, onSendToMod2, onSendHoldings, onShowTour }) {
    const [watch, setWatch] = useState(() => readLS(LS_WATCH, DEFAULT_WATCH));
    const [listTab, setListTab] = useState('watch');
    const [holdPrefill, setHoldPrefill] = useState(null); // 「加入我的持股」要預填到持股面板表單的內容
    const [etfs, setEtfs] = useState({ etfs: [], pending_yields: 0, sources: {} });
    const [etfSort, setEtfSort] = useState('hot');
    const [selected, setSelected] = useState(() => readLS(LS_WATCH, DEFAULT_WATCH)[0] || '2330');
    const [quotes, setQuotes] = useState({});
    const [fetchLog, setFetchLog] = useState([]);
    const [updatedAt, setUpdatedAt] = useState('--:--:--');
    const [netError, setNetError] = useState(null);
    const [polling, setPolling] = useState(true);
    const [input, setInput] = useState('');
    const [showSource, setShowSource] = useState(false);
    const [toast, setToast] = useState(null);
    const [cart, setCart] = useState(() => readLS(LS_CART, []));
    const [sparks, setSparks] = useState({});
    const [intraday, setIntraday] = useState(null);
    const [sortKey, setSortKey] = useState('default');
    // 持股改用跨頁共用的資料（組合風控、交易檢討也讀同一份）
    const portfolio = window.TA.usePortfolio();
    const holdings = portfolio.holdings;
    const [fx, setFx] = useState({}); // 幣別 -> 兌台幣匯率
    const [fxWarn, setFxWarn] = useState(null);
    const searchRef = useRef(null);
    const listRef = useRef(null);
    const [order, setOrder] = useState({
      side: 'BUY',
      lotType: 'ROUND',
      tif: 'ROD',
      usType: 'LIMIT',
      usTif: 'ANY',
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
    // 接收導覽或其他頁面的指令：{ listTab, rightTab, select }
    useEffect(() => {
      const apply = (d) => {
        if (!d) return;
        if (d.listTab) setListTab(d.listTab);
        if (d.rightTab) setRightTab(d.rightTab);
        if (d.select) setSelected(d.select);
      };
      apply(window.TA._pendingWatch);
      window.TA._pendingWatch = null;
      const on = (e) => apply(e.detail);
      window.addEventListener('watch-action', on);
      return () => window.removeEventListener('watch-action', on);
    }, []);
    const [overviewRows, setOverviewRows] = useState({});
    const [overviewLoading, setOverviewLoading] = useState(false);
    const { alerts, setAlerts, log: alertLog } = useAlerts(); // 檢查由 App 上的 AlertWatcher 負責

    useEffect(() => writeLS(LS_WATCH, watch), [watch]);
    useEffect(() => writeLS(LS_CART, cart), [cart]);

    useEffect(() => {
      let stop = false;
      let timer = null;
      const load = () =>
        fetch('/api/etf')
          .then((r) => r.json())
          .then((d) => {
            if (stop) return;
            setEtfs(d);
            if (d.pending_yields > 0) timer = setTimeout(load, 6000); // 殖利率背景計算中
          })
          .catch(() => {});
      load();
      return () => {
        stop = true;
        clearTimeout(timer);
      };
    }, []);

    // 需要報價的代號：自選 + ETF 名單 + 目前選中
    const allSyms = useMemo(() => {
      const set = new Set(watch);
      if (selected) set.add(selected);
      for (const e of etfs.etfs) set.add(e.symbol);
      for (const h of holdings) set.add(h.symbol);
      for (const a of alerts) set.add(a.symbol);
      return [...set];
    }, [watch, etfs, selected, holdings, alerts]);
    const symKey = allSyms.join(',');

    const quotesBusy = useRef(false);
    const loadQuotes = useCallback(async () => {
      // 上一輪還沒回來（網路或資料來源卡住）就跳過這一輪，請求不會越疊越多
      if (quotesBusy.current) return;
      quotesBusy.current = true;
      // 台股與美股分開請求：台股很快就能先顯示，美股（Yahoo 較慢）晚點補上
      const syms = symKey.split(',').filter(Boolean);
      const groups = [syms.filter(isTW), syms.filter((x) => !isTW(x))].filter((g) => g.length);
      try {
      await Promise.all(
        groups.map(async (group) => {
          try {
            const res = await fetch('/api/quotes', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ symbols: group }),
            });
            const data = await res.json();
            if (data.error) throw new Error(data.error);
            setQuotes((prev) => {
              const next = { ...prev };
              for (const qq of data.quotes) next[baseCode(qq.symbol)] = qq;
              return next;
            });
            setFetchLog(data.fetch_log || []);
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
      const id = setInterval(loadQuotes, 5000);
      return () => clearInterval(id);
    }, [loadQuotes, polling]);

    // 迷你走勢：自選股與持股（10 分鐘快取在後端）
    const sparkKey = [...new Set([...watch, ...holdings.map((h) => h.symbol)])].join(',');
    useEffect(() => {
      const syms = sparkKey.split(',').filter(Boolean);
      if (!syms.length) return;
      fetch('/api/sparks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols: syms }),
      })
        .then((r) => r.json())
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
        fetch('/api/fx', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ currencies: holdCurrencies.split(',') }),
        })
          .then((r) => r.json())
          .then((d) => {
            if (stop) return;
            setFx(Object.fromEntries(Object.entries(d.rates || {}).map(([c, r]) => [c, r.rate])));
            const warns = Object.values(d.rates || {})
              .map((r) => r.warning)
              .filter(Boolean);
            setFxWarn(warns.length ? warns.join('；') : null);
          })
          .catch(() => {});
      load();
      const id = setInterval(load, 300000);
      return () => {
        stop = true;
        clearInterval(id);
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
        fetch('/api/intraday', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbol: selected }),
        })
          .then((r) => r.json())
          .then((d) => !stop && setIntraday(d))
          .catch(() => {})
          .finally(() => {
            busy = false;
          });
      };
      load();
      const id = setInterval(load, 30000);
      return () => {
        stop = true;
        clearInterval(id);
      };
    }, [selected]);

    // 台美股以外：每手股數與法定稅費（港股每檔不同，後端查港交所清單）
    const [tradeRules, setTradeRules] = useState(null);
    useEffect(() => {
      let stop = false;
      setTradeRules(null);
      const m = window.TA.marketOf(selected);
      if (m === 'TW' || m === 'US') return;
      fetch('/api/trade_rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: selected }),
      })
        .then((r) => r.json())
        .then((d) => !stop && setTradeRules(d))
        .catch((e) => !stop && setTradeRules({ lot: null, fees: [], error: `交易規則查詢失敗：${e.message}` }));
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
        fetch('/api/overview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbols: ovKey.split(',').filter(Boolean) }),
        })
          .then((r) => r.json())
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
      const id = setInterval(load, 300000);
      return () => {
        stop = true;
        clearInterval(id);
      };
    }, [needOverview, ovKey]);

    // 分類（股票 / ETF / 債券）
    const catKey = [...new Set([...watch, ...holdings.map((h) => h.symbol)])].join(',');
    useEffect(() => {
      const syms = catKey.split(',').filter(Boolean);
      if (!syms.length) return;
      fetch('/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols: syms }),
      })
        .then((r) => r.json())
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
        .filter((x) => catFilter === 'ALL' || categories[baseCode(x)]?.category === catFilter);
      return keyFn ? [...base].sort((a, b) => keyFn(b) - keyFn(a)) : base;
    }, [watch, quotes, sortKey, catFilter, categories, mktFilter]); // eslint-disable-line

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

    const addSymbol = () => {
      const s = normSym(input);
      if (!s) return;
      if (watch.includes(s)) {
        say(`ℹ️ ${s} 已在自選清單，沒有重複加入`);
      } else {
        setWatch([...watch, s]);
        window.TA.notifySaved(`已把 ${s} 加入自選股`);
      }
      setSelected(s);
      setListTab('watch');
      setInput('');
    };
    const removeSymbol = (s) => {
      setWatch(watch.filter((x) => x !== s));
      if (selected === s) setSelected(watch.find((x) => x !== s) || '2330');
      window.TA.notifySaved(`已從自選股移除 ${s}`);
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
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
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
    }, [listTab, holdings, watchRows, etfRows, selected]);

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
    const priceNum = Number(order.price);
    const qtyNum = Number(order.qty);
    const shares = tw ? (order.lotType === 'ROUND' ? qtyNum * 1000 : qtyNum) : qtyNum;
    const amount = priceNum * shares;
    const feeRate = 0.001425;
    // 台股手續費與證交稅都是「元以下無條件捨去」（與券商對帳單一致）；手續費整張最低 20 元、零股最低 1 元
    const fee = tw ? Math.max(order.lotType === 'ROUND' ? 20 : 1, Math.floor(amount * feeRate + 1e-9)) : 0;
    const sideKey = order.side === 'SELL' ? 'SELL' : 'BUY';
    const statutoryTax = (tradeRules?.fees || [])
      .filter((f) => f.side === sideKey || f.side === 'BOTH')
      .reduce((s, f) => {
        const v = amount * f.rate;
        return s + (f.ceil ? Math.ceil(v - 1e-9) : Math.round(v * 100) / 100);
      }, 0);
    const tax = tw
      ? order.side === 'SELL'
        ? Math.floor(amount * (etfFlag ? 0.001 : 0.003) + 1e-9)
        : 0
      : Math.round(statutoryTax * 100) / 100;
    const orderIssues = [];
    if (!(priceNum > 0)) orderIssues.push('請輸入價格');
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
    if (tw && order.lotType === 'ODD' && order.tif === 'ROD')
      orderIssues.push('提醒：盤中零股為逐筆撮合，ROD 以當日有效為準');
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
      const r = window.TA.fillOrder({
        symbol: normSym(c.symbol),
        side: c.side,
        price: c.price,
        shares: sh,
        fees: (c.fee || 0) + (c.tax || 0),
      });
      if (r.ok) {
        setCart(cart.filter((x) => x.id !== c.id));
        window.TA.notifySaved(r.msg); // 持股／交易紀錄真的存進檔案才顯示成功
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
        market: window.TA.marketOf(selected),
        side: order.side,
        price: priceNum,
        qty: qtyNum,
        unit: tw ? (order.lotType === 'ROUND' ? '張' : '股') : '股',
        type: tw ? order.tif : `${order.usType === 'LIMIT' ? '限價' : '市價'}/${order.usTif}`,
        amount,
        fee,
        tax,
      };
      setCart([item, ...cart]);
      window.TA.notifySaved(`已把 ${selected} ${order.side === 'BUY' ? '買進' : '賣出'}委託加入暫存匣（模擬，不會真的下單）`);
      return true;
    };

    const bestAsk = q?.asks?.[0];
    const bestBid = q?.bids?.[0];
    const ratio = q?.bid_ask_ratio;

    return (
      <div className="space-y-4" data-tour="watch-root">
        {/* 頂部說明列 */}
        <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/90 border border-slate-800 rounded-2xl px-4 py-3">
          <div>
            <h2 className="text-base font-semibold text-white">即時行情</h2>
            <p className="text-xs text-slate-400">
              選一檔股票 → 看行情 →
              送去技術分析。左邊挑標的，右邊看報價與模擬下單。紅色代表上漲、綠色代表下跌（台灣習慣）。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="mono text-slate-400">更新 {updatedAt}</span>
            <button
              type="button"
              onClick={() => setPolling(!polling)}
              className={`px-3 py-1.5 rounded-lg border cursor-pointer ${
                polling
                  ? 'bg-emerald-950/60 border-emerald-500/50 text-emerald-300'
                  : 'bg-slate-950 border-slate-700 text-slate-400'
              }`}
            >
              {polling ? '每 5 秒自動更新' : '已暫停'}
            </button>
            <button
              type="button"
              onClick={loadQuotes}
              className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-200 hover:bg-slate-700 cursor-pointer"
            >
              ↻ 立即更新
            </button>
            <button
              type="button"
              onClick={onShowTour}
              className="px-3 py-1.5 rounded-lg bg-sky-600/20 border border-sky-500/50 text-sky-200 hover:bg-sky-600/30 cursor-pointer"
            >
              新手導覽
            </button>
          </div>
        </div>

        {netError && (
          <div className="rounded-xl border border-rose-700 bg-rose-950/60 text-rose-200 text-sm px-4 py-3">
            ⚠️ {netError}
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
          {/* ===== 左：清單 ===== */}
          <aside
            className="xl:col-span-4 bg-slate-900/90 border border-slate-800 rounded-2xl p-3 space-y-3"
            data-tour="watch-list"
          >
            <div className="grid grid-cols-3 gap-1.5">
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
                  onClick={() => setListTab(id)}
                  className={`py-2 rounded-lg text-sm font-semibold border cursor-pointer ${
                    listTab === id
                      ? 'bg-sky-500/20 border-sky-400 text-white'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {listTab === 'watch' && (
              <div className="flex gap-1.5">
                <input
                  ref={searchRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addSymbol()}
                  placeholder="輸入代號（按 / 快速聚焦）如 2330、AAPL"
                  aria-label="新增自選股代號"
                  className="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white mono focus:outline-none focus:border-sky-400"
                />
                <button
                  type="button"
                  onClick={addSymbol}
                  className="px-3 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-sm font-semibold cursor-pointer"
                >
                  ＋ 新增
                </button>
              </div>
            )}

            {(listTab === 'watch' || listTab === 'div' || listTab === 'overview') && (
              <div
                data-tour="watch-filters"
                className="grid grid-cols-3 gap-1 rounded-lg bg-slate-950 p-1 border border-slate-800"
              >
                {[
                  ['ALL', '全部'],
                  ['TW', '台股'],
                  ['INTL', '美股／海外'],
                ].map(([k, label]) => (
                  <button
                    type="button"
                    key={k}
                    onClick={() => setMktFilter(k)}
                    aria-pressed={mktFilter === k}
                    className={`py-1.5 rounded-md text-xs font-semibold cursor-pointer ${
                      mktFilter === k
                        ? 'bg-sky-600 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {label} <span className="mono text-[10px] opacity-70">{mktCounts[k]}</span>
                  </button>
                ))}
              </div>
            )}

            {(listTab === 'watch' || listTab === 'div' || listTab === 'overview') && (
              <div className="flex flex-wrap gap-1.5">
                {[
                  ['ALL', '全部'],
                  ['STOCK', '股票'],
                  ['ETF', 'ETF'],
                  ['BOND', '債券'],
                ].map(([k, label]) => (
                  <button
                    type="button"
                    key={k}
                    onClick={() => setCatFilter(k)}
                    className={`px-2.5 py-1 rounded-full text-xs border cursor-pointer ${
                      catFilter === k
                        ? 'bg-sky-500/20 border-sky-400 text-white'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {label} <span className="mono text-[10px] opacity-70">{catCounts[k]}</span>
                  </button>
                ))}
              </div>
            )}

            {listTab === 'watch' && (
              <div className="flex items-center gap-2 text-[11px] text-slate-400">
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
                <span className="ml-auto text-slate-600">↑↓ 切換標的</span>
              </div>
            )}

            {listTab === 'etf' && (
              <div className="space-y-1.5">
                <div className="grid grid-cols-4 gap-1">
                  {[
                    ['hot', '今日熱門'],
                    ['aum', '資產規模'],
                    ['plan', '定期定額戶'],
                    ['yield', '殖利率'],
                  ].map(([id, label]) => (
                    <button
                      type="button"
                      key={id}
                      onClick={() => setEtfSort(id)}
                      className={`py-1.5 rounded-md text-xs border cursor-pointer ${
                        etfSort === id
                          ? 'bg-amber-500/20 border-amber-400 text-amber-200'
                          : 'bg-slate-950 border-slate-800 text-slate-400'
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

            <div ref={listRef} className="max-h-[560px] overflow-y-auto space-y-1.5 pr-1">
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
                            window.TA.notifySaved(`已把 ${r.symbol} 加入自選股`);
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
                  onSelect={(x) => {
                    setSelected(x);
                    setRightTab('info');
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
                <window.TA.HoldingsPanel
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
                    setOrder((o) => ({
                      ...o,
                      side: 'SELL',
                      lotType: t ? (round ? 'ROUND' : 'ODD') : o.lotType,
                      qty: round ? lots : r.shares,
                      price: String(r.price ?? r.cost),
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
                  window.TA.notifySaved('自選股已還原為預設 8 檔');
                }}
                className="text-[11px] text-slate-500 hover:text-slate-300 cursor-pointer"
              >
                ↺ 還原預設 8 檔
              </button>
            )}
          </aside>

          {/* ===== 右：報價 + 下單 ===== */}
          <section className="xl:col-span-8 space-y-4">
            <div
              className="flex gap-1.5"
              role="tablist"
              aria-label="標的檢視"
              data-tour="watch-subtabs"
            >
              {[
                ['quote', '行情與下單'],
                ['info', '基本資料與配息'],
                ['heatmap', '股市熱力圖'],
              ].map(([k, label]) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={rightTab === k}
                  key={k}
                  onClick={() => setRightTab(k)}
                  className={`px-4 py-2 rounded-lg text-sm font-semibold border cursor-pointer ${
                    rightTab === k
                      ? 'bg-sky-500/20 border-sky-400 text-white'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {label}
                </button>
              ))}
              <span className="ml-2 self-center text-xs text-slate-500">
                目前：<span className="mono text-slate-300">{baseCode(selected)}</span>
                {categories[baseCode(selected)] && (
                  <span className="ml-1">
                    <CatChip cls={categories[baseCode(selected)]} />
                  </span>
                )}
              </span>
            </div>

            {rightTab === 'heatmap' && (
              <window.TA.HeatmapPanel
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

            {rightTab === 'info' && (
              <div data-tour="stock-info">
                <StockInfoPanel symbol={selected} />
              </div>
            )}

            {rightTab === 'quote' && !q && (
              <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-8 text-center text-slate-400">
                正在抓取 {selected} 的報價…
              </div>
            )}

            {rightTab === 'quote' && q && (
              <>
                <div
                  className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 space-y-4"
                  data-tour="watch-quote"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-2xl font-bold text-white">{q.name}</span>
                        <span className="mono text-sm text-slate-400">{q.symbol}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-sky-300">
                          {marketName(selected)}
                        </span>
                      </div>
                      {q.error ? (
                        <div className="mt-1 text-xs text-rose-300">
                          抓取失敗：{q.error}（為避免誤導，不顯示任何替代數字）
                        </div>
                      ) : (
                        <div className="mt-1 text-xs text-emerald-300">
                          真實資料・{q.source}・最後成交 {q.quote_time || '--'}
                        </div>
                      )}
                    </div>
                    <div className="text-right">
                      <div className={`mono text-4xl font-bold ${colorOf(q.change)}`}>
                        {fmt(q.price)}
                      </div>
                      <div className={`mono text-sm ${colorOf(q.change)}`}>
                        {q.change > 0 ? '▲' : q.change < 0 ? '▼' : ''} {fmt(Math.abs(q.change))} (
                        {q.change_pct > 0 ? '+' : ''}
                        {fmt(q.change_pct)}%)
                      </div>
                    </div>
                  </div>

                  <IntradayChart
                    data={intraday}
                    lastTrade={q?.quote_time}
                    tz={window.TA.tzOf(selected)}
                  />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <RangeBar label="今日區間（低—高）" low={q.low} high={q.high} value={q.price} />
                    <RangeBar
                      label="52 週區間（低—高）"
                      low={intraday?.week52_low}
                      high={intraday?.week52_high}
                      value={q.price}
                    />
                  </div>

                  {/* 六宮格 */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    <Stat
                      label="開盤"
                      value={fmt(q.open)}
                      cls={colorOf((q.open || 0) - (q.prev_close || 0))}
                    />
                    <Stat label="最高" value={fmt(q.high)} cls="text-rose-400" />
                    <Stat label="最低" value={fmt(q.low)} cls="text-emerald-400" />
                    <Stat
                      label="昨收"
                      value={fmt(q.prev_close)}
                      tip="前一個交易日的收盤價，漲跌幅以它為基準"
                    />
                    <Stat
                      label={`成交量（${q.volume_unit || ''}）`}
                      value={fmt(q.volume, 0)}
                      tip={
                        tw
                          ? '台股 1 張 = 1000 股'
                          : `${marketName(selected)}以股為單位（實際交易所可能有每手最少股數）`
                      }
                    />
                    {tw ? (
                      <Stat
                        label="漲停 / 跌停"
                        value={`${fmt(q.limit_up)} / ${fmt(q.limit_down)}`}
                        tip="台股單日漲跌幅限制 ±10%，委託價不能超出此範圍"
                      />
                    ) : (
                      <Stat
                        label="日內振幅"
                        value={`${q.high && q.low && q.prev_close ? fmt(((q.high - q.low) / q.prev_close) * 100) : '--'}%`}
                        tip="(最高 - 最低) ÷ 昨收"
                      />
                    )}
                  </div>

                  {/* 委買/委賣力道 + 五檔 */}
                  {tw && q.bids?.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <div className="text-xs text-slate-400 mb-1">
                          委買 / 委賣掛單量比例
                          <Tip text="把五檔的委買總量與委賣總量相比。注意：這不是『內外盤』（成交方向統計），官方公開資料沒有提供內外盤，所以這裡誠實標示為掛單量比例。" />
                        </div>
                        <div className="flex h-6 rounded-lg overflow-hidden border border-slate-700 text-[11px] mono font-bold">
                          <div
                            style={{ width: `${ratio}%` }}
                            className="bg-rose-500/80 text-white flex items-center justify-center"
                          >
                            {fmt(ratio, 0)}%
                          </div>
                          <div
                            style={{ width: `${100 - ratio}%` }}
                            className="bg-emerald-500/80 text-white flex items-center justify-center"
                          >
                            {fmt(100 - ratio, 0)}%
                          </div>
                        </div>
                        <div className="flex justify-between text-[10px] text-slate-500 mt-0.5">
                          <span>委買（想買的）</span>
                          <span>委賣（想賣的）</span>
                        </div>
                        {bestBid && bestAsk && (
                          <div className="text-[11px] text-slate-400 mt-2">
                            買賣價差 {fmt(bestAsk.price - bestBid.price)}（約{' '}
                            {fmt(((bestAsk.price - bestBid.price) / bestAsk.price) * 100, 2)}%）
                            ，價差越小越容易成交
                          </div>
                        )}
                      </div>
                      <div>
                        <div className="text-xs text-slate-400 mb-1">
                          最佳五檔
                          <Tip text="市場上最接近成交價的 5 個買價與 5 個賣價，以及各價位掛單張數" />
                        </div>
                        <table className="w-full text-xs mono">
                          <thead>
                            <tr className="text-slate-500">
                              <th className="text-left font-normal">委買量</th>
                              <th>價格</th>
                              <th className="text-right font-normal">委賣量</th>
                            </tr>
                          </thead>
                          <tbody>
                            {[...Array(5)].map((_, i) => {
                              const a = q.asks[4 - i];
                              return (
                                <tr key={`a${i}`}>
                                  <td />
                                  <td className="text-center text-emerald-300">
                                    {a ? fmt(a.price) : ''}
                                  </td>
                                  <td className="text-right text-slate-300">
                                    {a ? fmt(a.vol, 0) : ''}
                                  </td>
                                </tr>
                              );
                            })}
                            <tr>
                              <td colSpan={3} className="border-t border-slate-700" />
                            </tr>
                            {[...Array(5)].map((_, i) => {
                              const b = q.bids[i];
                              return (
                                <tr key={`b${i}`}>
                                  <td className="text-slate-300">{b ? fmt(b.vol, 0) : ''}</td>
                                  <td className="text-center text-rose-300">
                                    {b ? fmt(b.price) : ''}
                                  </td>
                                  <td />
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-slate-500 bg-slate-950/60 border border-slate-800 rounded-lg px-3 py-2">
                      {tw
                        ? '此時段沒有五檔資料（可能尚未開盤或無掛單）。'
                        : `ℹ️ ${marketName(selected)}的公開免費資料源不提供五檔與內外盤，這裡不顯示（不會用假資料補上）。`}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      data-tour="send-mod1"
                      onClick={() => onSendToMod1(q)}
                      className="px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-slate-950 font-bold text-sm hover:brightness-110 cursor-pointer"
                    >
                      將目前選中標的送入技術分析沙盒
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setHoldPrefill({ symbol: baseCode(selected), shares: '', cost: String(q.price ?? '') });
                        setListTab('hold');
                      }}
                      className="px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-200 text-sm hover:bg-slate-700 cursor-pointer"
                    >
                      加入我的持股
                    </button>
                    <button
                      type="button"
                      onClick={() => setListTab('alerts')}
                      className="px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-200 text-sm hover:bg-slate-700 cursor-pointer"
                    >
                      設提醒
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowSource(!showSource)}
                      className="px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-200 text-sm hover:bg-slate-700 cursor-pointer"
                    >
                      {showSource ? '收起' : '看資料怎麼抓的'}
                    </button>
                  </div>

                  {showSource && <SourcePanel q={q} log={fetchLog} />}
                </div>

                <window.TA.OrderPanel
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
                  }}
                />
              </>
            )}
          </section>
        </div>

        {toast && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-slate-800 border border-slate-600 text-white text-sm px-4 py-2 rounded-xl shadow-lg">
            {toast}
          </div>
        )}
      </div>
    );
  }

  window.TA = Object.assign(window.TA || {}, { WatchPage });
})();
