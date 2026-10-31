// 操作紀錄：點擊、換頁、API 呼叫結果、錯誤與畫面提示。
// 存在瀏覽器（最近 3000 筆）並分批送到本機伺服器寫成 logs/activity-YYYYMMDD.jsonl，方便之後追蹤問題。
// 不記錄任何輸入框內容（避免記到 API 金鑰），也不記錄請求本文，只留代號、模組等必要欄位。
(() => {
  const { readLS, writeLS } = window.TA;
  const LS_ACTIVITY = 'tw_us_activity_v1';
  const MAX = 3000;
  // 自動輪詢的 API：成功不記，只記失敗（否則每 5 秒一筆會淹沒紀錄）
  const QUIET = [
    '/api/quotes',
    '/api/indices',
    '/api/board/',
    '/api/sparks',
    '/api/intraday',
    '/api/overview',
    '/api/fx',
    '/api/health',
    '/api/etf',
    '/api/fetchlog',
    '/api/categories',
    '/api/candles',
    '/api/log',
    '/api/jobs/', // 背景工作的 start／poll；結束時由 postJob 用原本的路徑記一筆
  ];

  let memory = readLS(LS_ACTIVITY, []);
  let pending = [];
  let dirty = false;
  const pad = (n) => String(n).padStart(2, '0');
  const now = () => {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
      d.getMinutes(),
    )}:${pad(d.getSeconds())}`;
  };

  const logEvent = (type, detail = {}, level = 'info') => {
    const ev = { t: now(), type, level, page: window.TA.currentPage || '', ...detail };
    memory.push(ev);
    if (memory.length > MAX) memory = memory.slice(-MAX);
    pending.push(ev);
    dirty = true;
    window.dispatchEvent(new Event('activity-changed'));
  };
  const flushLocal = () => {
    if (!dirty) return;
    writeLS(LS_ACTIVITY, memory);
    dirty = false;
  };
  const origFetch = window.fetch.bind(window);
  const flushServer = (useBeacon = false) => {
    if (!pending.length) return;
    const batch = pending.slice(0, 200);
    pending = pending.slice(200);
    const body = JSON.stringify({ events: batch });
    if (useBeacon && navigator.sendBeacon) {
      navigator.sendBeacon('/api/log', new Blob([body], { type: 'text/plain' }));
      return;
    }
    origFetch('/api/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    }).catch(() => {
      pending = [...batch, ...pending].slice(-1000); // 伺服器暫時連不上：下次再送
    });
  };
  setInterval(() => {
    flushLocal();
    flushServer();
  }, 10000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushLocal();
      flushServer(true);
    }
  });

  // 點擊：只記按鈕／連結的名稱（aria-label、文字或 title），不記輸入內容
  const labelOf = (el) =>
    (el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || el.tagName)
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60);
  document.addEventListener(
    'click',
    (e) => {
      const el = e.target.closest?.(
        'button, a, [role="button"], summary, input[type="checkbox"], input[type="radio"]',
      );
      if (!el || el.closest('[data-no-log]')) return;
      const sym = el.closest('[data-sym]')?.getAttribute('data-sym');
      const detail = { label: labelOf(el) };
      if (sym) detail.symbol = sym;
      if (el.type === 'checkbox' || el.type === 'radio') detail.checked = el.checked;
      logEvent('click', detail);
    },
    true,
  );
  document.addEventListener(
    'change',
    (e) => {
      const el = e.target;
      if (el.tagName !== 'SELECT' || el.closest('[data-no-log]')) return;
      logEvent('select', {
        label: (el.getAttribute('aria-label') || el.name || el.id || 'select').slice(0, 40),
        value: el.options[el.selectedIndex]?.text?.slice(0, 40),
      });
    },
    true,
  );

  // 前端錯誤
  window.addEventListener('error', (e) =>
    logEvent(
      'error',
      { message: String(e.message).slice(0, 300), source: `${e.filename || ''}:${e.lineno || ''}` },
      'error',
    ),
  );
  window.addEventListener('unhandledrejection', (e) =>
    logEvent('error', { message: String(e.reason?.message || e.reason).slice(0, 300) }, 'error'),
  );

  // API：記錄路徑、代號、狀態與耗時；輪詢型只記失敗；技術分析自動刷新只在換代號或失敗時記
  let lastM1 = '';
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    if (!url.includes('/api/') || url.endsWith('/api/log')) return origFetch(input, init);
    const path = url.slice(url.indexOf('/api/')).split('?')[0];
    let body = {};
    try {
      body = init?.body ? JSON.parse(init.body) : {};
    } catch (_e) {
      body = {};
    }
    const symbol = body.ticker || body.symbol || body.target_asset || body.target || undefined;
    const started = performance.now();
    try {
      const res = await origFetch(input, init);
      const ms = Math.round(performance.now() - started);
      const quiet =
        QUIET.some((q) => path.startsWith(q)) ||
        (path === '/api/mod1/analyze' && symbol === lastM1);
      if (path === '/api/mod1/analyze') lastM1 = symbol;
      res
        .clone()
        .json()
        .then((d) => {
          const err = d?.error;
          if (quiet && res.ok && !err) return;
          logEvent(
            'api',
            {
              path,
              status: res.status,
              ms,
              symbol,
              module: body.module,
              error: err ? String(err).slice(0, 300) : undefined,
            },
            err || !res.ok ? 'error' : 'info',
          );
        })
        .catch(() => {});
      return res;
    } catch (err) {
      logEvent('api', { path, symbol, error: `連線失敗：${err.message}` }, 'error');
      throw err;
    }
  };

  const useActivityLog = () => {
    const [list, setList] = React.useState(() => memory.slice());
    React.useEffect(() => {
      const on = () => setList(memory.slice());
      window.addEventListener('activity-changed', on);
      return () => window.removeEventListener('activity-changed', on);
    }, []);
    return list;
  };
  const clearActivity = () => {
    memory = [];
    dirty = true;
    flushLocal();
    window.dispatchEvent(new Event('activity-changed'));
  };

  logEvent('open', {
    userAgent: navigator.userAgent.slice(0, 120),
    screen: `${window.innerWidth}x${window.innerHeight}`,
  });
  window.TA = Object.assign(window.TA || {}, {
    logEvent,
    useActivityLog,
    clearActivity,
    LS_ACTIVITY,
  });
})();
