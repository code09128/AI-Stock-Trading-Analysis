// 看盤頁左側的「技術總覽」表格與「提醒」面板，以及全站共用的提醒判斷引擎 AlertWatcher（掛在 App 上）
(() => {
  const { useState, useEffect, useRef } = React;
  const { fmt, colorOf, baseCode, normSym, readLS, writeLS } = window.TA;

  const LS_ALERTS = 'tw_us_alerts_v1';

  // 數值一律輸入正數：漲幅／跌幅都填「幾 %」，例如跌幅 3 代表今天跌了 3% 以上（舊資料存成負數也相容）
  const ALERT_TYPES = {
    price_above: {
      label: '價格 ≥',
      unit: '',
      hint: '價格，例 2400',
      test: (m, v) => m.price != null && m.price >= v,
    },
    price_below: {
      label: '價格 ≤',
      unit: '',
      hint: '價格，例 2300',
      test: (m, v) => m.price != null && m.price <= v,
    },
    chg_above: {
      label: '今日漲幅 ≥',
      unit: '%',
      hint: '例 3＝漲 3%',
      test: (m, v) => m.chg != null && m.chg >= Math.abs(v),
    },
    chg_below: {
      label: '今日跌幅 ≥',
      unit: '%',
      hint: '例 3＝跌 3%',
      test: (m, v) => m.chg != null && m.chg <= -Math.abs(v),
    },
    rsi_above: {
      label: 'RSI(14) ≥',
      unit: '',
      hint: '0–100，例 70',
      test: (m, v) => m.rsi != null && m.rsi >= v,
    },
    rsi_below: {
      label: 'RSI(14) ≤',
      unit: '',
      hint: '0–100，例 30',
      test: (m, v) => m.rsi != null && m.rsi <= v,
    },
  };
  const shownValue = (a) => (ALERT_TYPES[a.type]?.unit === '%' ? Math.abs(a.value) : a.value);

  // 提醒與觸發紀錄是全站共用的：任何頁面改動都會廣播 'alerts-changed'
  let alertLog = [];
  const loadAlerts = () => readLS(LS_ALERTS, []);
  const saveAlerts = (list) => {
    writeLS(LS_ALERTS, list);
    window.dispatchEvent(new Event('alerts-changed'));
  };

  // 桌面版縮到系統匣時由 Python 背景引擎檢查並寫回資料檔；回到前景時用資料檔的版本取代本機的，
  // 否則下次在頁面上改提醒會把背景已觸發的提醒蓋回「監控中」
  const reloadAlertsFromServer = async () => {
    try {
      const d = await fetch('/api/userdata').then((r) => r.json());
      const raw = d?.values?.[LS_ALERTS];
      if (typeof raw !== 'string') return;
      const server = JSON.parse(raw);
      if (!Array.isArray(server)) return;
      const before = new Map(loadAlerts().map((a) => [a.id, a]));
      const fired = server.filter((a) => !a.active && a.firedAt && before.get(a.id)?.active);
      if (fired.length) alertLog = [...fired, ...alertLog].slice(0, 30);
      if (JSON.stringify(server) !== JSON.stringify(loadAlerts()) || fired.length) {
        saveAlerts(server);
      }
      if (fired.length) {
        window.TA.toast?.(`🔔 背景期間觸發了 ${fired.length} 則提醒，紀錄在看盤頁的「提醒」`);
      }
    } catch (_e) {
      /* 讀不到就維持本機版本 */
    }
  };

  // 看盤頁「提醒」面板用：只負責顯示與編輯，檢查交給 AlertWatcher
  function useAlerts() {
    const [alerts, setState] = useState(loadAlerts);
    const [log, setLog] = useState(alertLog);
    useEffect(() => {
      const on = () => {
        setState(loadAlerts());
        setLog(alertLog);
      };
      window.addEventListener('alerts-changed', on);
      window.addEventListener('storage', on);
      return () => {
        window.removeEventListener('alerts-changed', on);
        window.removeEventListener('storage', on);
      };
    }, []);
    return { alerts, setAlerts: saveAlerts, log };
  }

  // 提醒引擎：掛在整個 App 上，不論在哪一頁都會檢查。報價每 10 秒、RSI 每 5 分鐘（後端也快取 5 分鐘）
  const QUOTE_EVERY_MS = 10000;
  const RSI_EVERY_MS = 300000;
  function AlertWatcher({ say }) {
    const { alerts } = useAlerts();
    const rsiRef = useRef({ at: 0, rows: {} });
    const active = alerts.filter((a) => a.active);
    const key = active.map((a) => `${a.id}:${a.symbol}`).join(',');
    useEffect(() => {
      if (!key) return undefined;
      let stop = false;
      const post = (url, symbols) =>
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbols }),
        }).then((r) => r.json());
      const check = async () => {
        if (window.TA.desktopHidden) return; // 縮在系統匣：交給背景引擎，避免同一則提醒觸發兩次
        const list = loadAlerts().filter((a) => a.active);
        if (!list.length) return;
        const syms = [...new Set(list.map((a) => a.symbol))];
        const quotes = {};
        try {
          for (const q of (await post('/api/quotes', syms)).quotes || []) {
            if (q) quotes[baseCode(q.symbol)] = q;
          }
          const rsiSyms = [
            ...new Set(list.filter((a) => a.type.startsWith('rsi')).map((a) => a.symbol)),
          ];
          if (rsiSyms.length && Date.now() - rsiRef.current.at > RSI_EVERY_MS) {
            const d = await post('/api/overview', rsiSyms);
            const rows = {};
            for (const r of d.rows || d.overview || []) rows[baseCode(r.symbol)] = r;
            rsiRef.current = { at: Date.now(), rows };
          }
        } catch (_e) {
          return; // 這一輪抓不到就等下一輪，不誤觸發
        }
        if (stop || window.TA.desktopHidden) return;
        const fired = [];
        const next = loadAlerts().map((a) => {
          if (!a.active) return a;
          const q = quotes[baseCode(a.symbol)];
          const o = rsiRef.current.rows[baseCode(a.symbol)];
          const metrics = { price: q?.price, chg: q?.change_pct, rsi: o?.rsi14 };
          if (!ALERT_TYPES[a.type]?.test(metrics, a.value)) return a;
          const f = {
            ...a,
            active: false,
            firedAt: new Date().toLocaleString('zh-TW', { hour12: false }),
            firedValue: metrics,
          };
          fired.push(f);
          return f;
        });
        if (!fired.length) return;
        alertLog = [...fired, ...alertLog].slice(0, 30);
        saveAlerts(next);
        for (const f of fired) {
          const t = ALERT_TYPES[f.type];
          const msg = `${f.symbol} 觸發：${t.label} ${shownValue(f)}${t.unit}`;
          say(msg);
          try {
            if (window.Notification && Notification.permission === 'granted') new Notification(msg);
          } catch (_e) {
            /* 通知不可用時忽略 */
          }
        }
      };
      // 上一輪還沒做完（網路卡住）就跳過，避免請求越疊越多
      let busy = false;
      const guarded = async () => {
        if (busy) return;
        busy = true;
        try {
          await check();
        } finally {
          busy = false;
        }
      };
      guarded();
      const id = setInterval(guarded, QUOTE_EVERY_MS);
      return () => {
        stop = true;
        clearInterval(id);
      };
    }, [key, say]);
    return null;
  }

  function AlertsPanel({ alerts, setAlerts, selected, log }) {
    const [form, setForm] = useState({ symbol: '', type: 'price_above', value: '' });
    const [perm, setPerm] = useState(() =>
      window.Notification ? Notification.permission : 'unsupported',
    );
    const [err, setErr] = useState('');
    const add = () => {
      const sym = normSym(form.symbol || selected);
      const value = Number(form.value);
      const t = ALERT_TYPES[form.type];
      if (!sym) return setErr('請輸入代號');
      if (form.value === '' || Number.isNaN(value)) return setErr(`請輸入數值（${t.hint}）`);
      if (t.unit === '%' && (value <= 0 || value >= 100))
        return setErr('漲跌幅請填 0～100 之間的正數，例如 3 代表 3%');
      if (form.type.startsWith('rsi') && (value <= 0 || value >= 100))
        return setErr('RSI 介於 0～100，請填例如 70 或 30');
      if (form.type.startsWith('price') && value <= 0) return setErr('價格必須大於 0');
      setErr('');
      setAlerts([...alerts, { id: Date.now(), symbol: sym, type: form.type, value, active: true }]);
      setForm({ ...form, value: '' });
      window.TA.notifySaved(`已新增提醒：${sym} ${t.label} ${value}${t.unit}`);
    };
    return (
      <div className="space-y-2">
        <div className="rounded-xl border border-slate-800 p-2 space-y-1.5">
          <div className="text-[11px] text-slate-400">新增提醒（預設標的：{selected}）</div>
          <div className="grid grid-cols-5 gap-1.5">
            <input
              value={form.symbol}
              onChange={(e) => setForm({ ...form, symbol: e.target.value })}
              placeholder={baseCode(selected)}
              aria-label="提醒代號"
              className="col-span-1 min-w-0 bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-xs mono text-white"
            />
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
              aria-label="提醒條件"
              className="col-span-2 min-w-0 bg-slate-950 border border-slate-700 rounded px-1 py-1.5 text-xs text-slate-200"
            >
              {Object.entries(ALERT_TYPES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>
            <input
              value={form.value}
              onChange={(e) => setForm({ ...form, value: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && add()}
              placeholder={ALERT_TYPES[form.type].hint}
              aria-label="提醒數值"
              className="col-span-1 min-w-0 bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-xs mono text-white"
            />
            <button
              type="button"
              onClick={add}
              className="col-span-1 rounded bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold cursor-pointer"
            >
              ＋
            </button>
          </div>
          {err && <div className="text-[11px] text-rose-300">{err}</div>}
          <div className="text-[10px] text-slate-500 leading-snug">
            ⚠️ 只要這個系統的網頁開著（在哪一頁都可以）就會檢查：報價每 10 秒、RSI 每 5
            分鐘。關掉網頁就不會通知。漲跌幅都填正數，例如「今日跌幅 ≥ 3」代表跌 3% 以上。
          </div>
          {perm === 'default' && (
            <button
              type="button"
              onClick={() => Notification.requestPermission().then(setPerm)}
              className="text-[11px] px-2 py-1 rounded bg-slate-800 text-sky-300 hover:bg-slate-700 cursor-pointer"
            >
              啟用桌面通知
            </button>
          )}
          {perm === 'granted' && (
            <div className="text-[10px] text-emerald-400">✅ 桌面通知已啟用</div>
          )}
          {perm === 'denied' && (
            <div className="text-[10px] text-slate-500">
              桌面通知被瀏覽器封鎖，仍會顯示畫面提示。
            </div>
          )}
        </div>

        {alerts.length === 0 && (
          <div className="text-sm text-slate-500 text-center py-4">還沒有提醒，上方新增一條。</div>
        )}
        {alerts.map((a) => (
          <div
            key={a.id}
            className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs ${
              a.active ? 'border-slate-800 bg-slate-950/70' : 'border-amber-500/40 bg-amber-500/10'
            }`}
          >
            <span className="mono font-bold text-white">{a.symbol}</span>
            <span className="text-slate-300">
              {ALERT_TYPES[a.type].label} {shownValue(a)}
              {ALERT_TYPES[a.type].unit}
            </span>
            <span className="ml-auto text-[11px] text-slate-400">
              {a.active ? '監控中' : `${a.firedAt}`}
            </span>
            {!a.active && (
              <button
                type="button"
                onClick={() => {
                  setAlerts(alerts.map((x) => (x.id === a.id ? { ...x, active: true } : x)));
                  window.TA.notifySaved(`已重新啟用 ${a.symbol} 的提醒`);
                }}
                className="text-sky-300 hover:text-white cursor-pointer"
              >
                重啟
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setAlerts(alerts.filter((x) => x.id !== a.id));
                window.TA.notifySaved(`已刪除 ${a.symbol} 的提醒`);
              }}
              className="text-slate-600 hover:text-rose-400 cursor-pointer"
              aria-label="刪除提醒"
            >
              ✕
            </button>
          </div>
        ))}
        {log.length > 0 && (
          <div className="text-[11px] text-slate-500 space-y-0.5">
            <div className="text-slate-400">本次開啟後觸發紀錄</div>
            {log.map((f) => (
              <div key={`${f.id}-${f.firedAt}`}>
                {f.firedAt}　{f.symbol} {ALERT_TYPES[f.type].label} {shownValue(f)}
                {ALERT_TYPES[f.type].unit}（當時價 {fmt(f.firedValue?.price)}）
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ---------- 技術總覽：自選股一張表 ----------
  function OverviewPanel({ symbols, rows, quotes, selected, onSelect, loading }) {
    const [sort, setSort] = useState('symbol');
    const data = symbols.map((s) => ({ s, q: quotes[baseCode(s)], o: rows[baseCode(s)] }));
    const val = {
      symbol: () => 0,
      chg: (d) => d.q?.change_pct ?? -999,
      rsi: (d) => d.o?.rsi14 ?? -999,
      ma20: (d) => d.o?.dist_ma20_pct ?? -999,
      vol: (d) => d.o?.volume_ratio ?? -999,
    }[sort];
    const sorted = sort === 'symbol' ? data : [...data].sort((a, b) => val(b) - val(a));
    const rsiCls = (r) =>
      r >= 70 ? 'text-rose-400' : r <= 30 ? 'text-emerald-400' : 'text-slate-200';
    const trendCls = { 多頭: 'text-rose-400', 空頭: 'text-emerald-400' };
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-[11px] text-slate-400">
          排序
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            aria-label="總覽排序"
            className="bg-slate-950 border border-slate-700 rounded px-1.5 py-1 text-slate-200"
          >
            <option value="symbol">我的順序</option>
            <option value="chg">今日漲幅</option>
            <option value="rsi">RSI 高→低</option>
            <option value="ma20">距 MA20 遠→近</option>
            <option value="vol">量比</option>
          </select>
          {loading && <span className="text-slate-500">計算中…</span>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px] mono">
            <thead>
              <tr className="text-slate-500 text-left">
                <th className="py-1">代號</th>
                <th>漲跌</th>
                <th title="RSI(14)：≥70 偏熱、≤30 偏冷">RSI</th>
                <th title="現價相對 20 日均線的位置">距MA20</th>
                <th title="今日成交量 ÷ 近 20 日均量（盤中偏低屬正常）">量比</th>
                <th>趨勢</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(({ s, q, o }) => (
                <tr
                  key={s}
                  onClick={() => onSelect(s)}
                  className={`border-t border-slate-800 cursor-pointer hover:bg-slate-800/50 ${
                    baseCode(selected) === baseCode(s) ? 'bg-sky-500/10' : ''
                  }`}
                >
                  <td className="py-1.5 font-bold text-white">{baseCode(s)}</td>
                  <td className={colorOf(q?.change_pct)}>
                    {q?.change_pct == null
                      ? '--'
                      : `${q.change_pct > 0 ? '+' : ''}${fmt(q.change_pct)}%`}
                  </td>
                  <td className={o?.rsi14 != null ? rsiCls(o.rsi14) : 'text-slate-600'}>
                    {o?.error ? '失敗' : o?.rsi14 != null ? fmt(o.rsi14, 1) : '…'}
                  </td>
                  <td className={colorOf(o?.dist_ma20_pct)}>
                    {o?.dist_ma20_pct == null
                      ? '--'
                      : `${o.dist_ma20_pct > 0 ? '+' : ''}${fmt(o.dist_ma20_pct)}%`}
                  </td>
                  <td>{o?.volume_ratio == null ? '--' : fmt(o.volume_ratio, 2)}</td>
                  <td className={trendCls[o?.trend] || 'text-slate-300'}>{o?.trend || '…'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[10px] text-slate-500 leading-snug">
          技術指標來自日 K 還權資料（Yahoo），盤中會把即時價併入當天的 K 棒，每 5
          分鐘更新；漲跌來自即時報價。趨勢：收盤＞MA20＞MA60 為多頭，反之為空頭。
        </p>
      </div>
    );
  }

  window.TA = Object.assign(window.TA || {}, {
    useAlerts,
    AlertWatcher,
    AlertsPanel,
    OverviewPanel,
    ALERT_TYPES,
    reloadAlertsFromServer,
  });
})();
