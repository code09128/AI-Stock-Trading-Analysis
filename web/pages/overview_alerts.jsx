// 看盤頁左側的「技術總覽」表格與「提醒」面板，以及提醒判斷引擎（頁面開著時才會監控）
(() => {
  const { useState, useEffect, useRef } = React;
  const { fmt, colorOf, baseCode, normSym, readLS, writeLS } = window.TA;

  const LS_ALERTS = 'tw_us_alerts_v1';

  const ALERT_TYPES = {
    price_above: { label: '價格 ≥', unit: '', test: (m, v) => m.price != null && m.price >= v },
    price_below: { label: '價格 ≤', unit: '', test: (m, v) => m.price != null && m.price <= v },
    chg_above: { label: '今日漲幅 ≥', unit: '%', test: (m, v) => m.chg != null && m.chg >= v },
    chg_below: { label: '今日跌幅 ≤', unit: '%', test: (m, v) => m.chg != null && m.chg <= v },
    rsi_above: { label: 'RSI(14) ≥', unit: '', test: (m, v) => m.rsi != null && m.rsi >= v },
    rsi_below: { label: 'RSI(14) ≤', unit: '', test: (m, v) => m.rsi != null && m.rsi <= v },
  };

  // 提醒引擎：每當報價 / 技術指標更新就檢查；觸發後標記為已觸發（不重複吵）
  function useAlerts({ quotes, overview, say }) {
    const [alerts, setAlerts] = useState(() => readLS(LS_ALERTS, []));
    const [log, setLog] = useState([]);
    useEffect(() => writeLS(LS_ALERTS, alerts), [alerts]);
    const lastRun = useRef('');
    useEffect(() => {
      const fired = [];
      const next = alerts.map((a) => {
        if (!a.active) return a;
        const q = quotes[baseCode(a.symbol)];
        const o = overview[baseCode(a.symbol)];
        const metrics = { price: q?.price, chg: q?.change_pct, rsi: o?.rsi14 };
        if (ALERT_TYPES[a.type]?.test(metrics, a.value)) {
          const f = {
            ...a,
            active: false,
            firedAt: new Date().toLocaleString('zh-TW', { hour12: false }),
            firedValue: metrics,
          };
          fired.push(f);
          return f;
        }
        return a;
      });
      const sig = JSON.stringify(fired.map((f) => f.id));
      if (fired.length && sig !== lastRun.current) {
        lastRun.current = sig;
        setAlerts(next);
        setLog((l) => [...fired, ...l].slice(0, 30));
        for (const f of fired) {
          const msg = `🔔 ${f.symbol} 觸發：${ALERT_TYPES[f.type].label} ${f.value}${ALERT_TYPES[f.type].unit}`;
          say(msg);
          try {
            if (window.Notification && Notification.permission === 'granted') new Notification(msg);
          } catch (_e) {
            /* 通知不可用時忽略 */
          }
        }
      }
    }, [quotes, overview, alerts, say]);
    return { alerts, setAlerts, log };
  }

  function AlertsPanel({ alerts, setAlerts, selected, log }) {
    const [form, setForm] = useState({ symbol: '', type: 'price_above', value: '' });
    const [perm, setPerm] = useState(() =>
      window.Notification ? Notification.permission : 'unsupported',
    );
    const add = () => {
      const sym = normSym(form.symbol || selected);
      const value = Number(form.value);
      if (!sym || Number.isNaN(value) || form.value === '') return;
      setAlerts([...alerts, { id: Date.now(), symbol: sym, type: form.type, value, active: true }]);
      setForm({ ...form, value: '' });
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
              placeholder="數值"
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
          <div className="text-[10px] text-slate-500 leading-snug">
            ⚠️ 提醒只在這個網頁開著時檢查（每 5 秒報價、每 5 分鐘技術指標），關掉頁面就不會通知。
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
              {ALERT_TYPES[a.type].label} {a.value}
              {ALERT_TYPES[a.type].unit}
            </span>
            <span className="ml-auto text-[11px] text-slate-400">
              {a.active ? '🟢 監控中' : `🔔 ${a.firedAt}`}
            </span>
            {!a.active && (
              <button
                type="button"
                onClick={() =>
                  setAlerts(alerts.map((x) => (x.id === a.id ? { ...x, active: true } : x)))
                }
                className="text-sky-300 hover:text-white cursor-pointer"
              >
                重啟
              </button>
            )}
            <button
              type="button"
              onClick={() => setAlerts(alerts.filter((x) => x.id !== a.id))}
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
                {f.firedAt}　{f.symbol} {ALERT_TYPES[f.type].label} {f.value}（當時價{' '}
                {fmt(f.firedValue?.price)}）
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
          技術指標來自日 K 還權資料（Yahoo），每 5
          分鐘更新；漲跌來自即時報價。趨勢：收盤＞MA20＞MA60 為多頭，反之為空頭。
        </p>
      </div>
    );
  }

  window.TA = Object.assign(window.TA || {}, {
    useAlerts,
    AlertsPanel,
    OverviewPanel,
    ALERT_TYPES,
  });
})();
