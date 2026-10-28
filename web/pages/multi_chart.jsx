// 多圖走勢：一次排好 2×2／3×3／4×4 張分時走勢，每格可換股票，5 組版面各自儲存（自動同步到 data/userdata.json）。
// 資料：/api/intraday（後端快取 30 秒）；同時最多抓 3 檔，每 60 秒更新一輪。
(() => {
  const { useState, useEffect, useMemo } = React;
  const { fmt, colorOf, readLS, writeLS, normSym, baseCode, tzOf, Tip, DEFAULT_WATCH, LS_WATCH } = window.TA;

  const LS_KEY = 'tw_us_multichart_v1';
  const GRIDS = [2, 3, 4];
  const SLOTS = 5;
  const REFRESH_MS = 60000;
  const CONCURRENCY = 3;

  const fill = (syms, n = 16) => [...syms.slice(0, n), ...Array(Math.max(0, n - syms.length)).fill('')];
  const myWatch = () => readLS(LS_WATCH, null) || DEFAULT_WATCH;
  const myHoldings = () =>
    [...new Set(readLS('tw_us_holdings_v1', []).map((h) => h?.symbol).filter(Boolean))];

  function loadState() {
    const saved = readLS(LS_KEY, null);
    if (saved?.slots?.length === SLOTS) return saved;
    const slots = Array.from({ length: SLOTS }, (_, i) => ({
      name: i === 0 ? '自選股' : i === 1 ? '持股' : `版面 ${i + 1}`,
      grid: 3,
      symbols: fill(i === 0 ? myWatch() : i === 1 ? myHoldings() : []),
    }));
    return { active: 0, slots };
  }

  // ---------- 單格的小分時圖 ----------
  function MiniIntraday({ data, tz }) {
    const pts = data?.points || [];
    const prev = data?.prev_close;
    if (pts.length < 2 || !prev) {
      return (
        <div className="h-full flex items-center justify-center text-[11px] text-slate-500">
          {data?.error || (data ? '還沒有分時資料' : '載入中…')}
        </div>
      );
    }
    const W = 300;
    const H = 110;
    const start = data.session_start || pts[0].ts;
    const end = Math.max(data.session_end || pts[pts.length - 1].ts, pts[pts.length - 1].ts);
    const closes = pts.map((p) => p.close);
    const hi = Math.max(prev, ...closes);
    const lo = Math.min(prev, ...closes);
    const pad = (hi - lo) * 0.08 || prev * 0.002;
    const top = hi + pad;
    const bot = lo - pad;
    const x = (ts) => ((ts - start) / Math.max(1, end - start)) * W;
    const y = (v) => ((top - v) / (top - bot)) * H;
    const line = pts.map((p) => `${x(p.ts).toFixed(1)},${y(p.close).toFixed(1)}`).join(' ');
    const last = closes[closes.length - 1];
    const color = last > prev ? '#f43f5e' : last < prev ? '#10b981' : '#94a3b8';
    const pct = (v) => `${v > prev ? '+' : ''}${(((v - prev) / prev) * 100).toFixed(2)}%`;
    const hm = (ts) => {
      try {
        return new Date(ts * 1000).toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' });
      } catch {
        return '';
      }
    };
    return (
      <div className="relative h-full">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-full" aria-hidden="true">
          <line x1="0" x2={W} y1={y(prev)} y2={y(prev)} stroke="#475569" strokeDasharray="3 3" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <polyline points={line} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        </svg>
        <span className="absolute left-1 top-0 text-[10px] mono text-rose-300/80">{pct(hi)}</span>
        <span className="absolute left-1 bottom-3 text-[10px] mono text-emerald-300/80">{pct(lo)}</span>
        <span className="absolute left-1 bottom-0 text-[9px] mono text-slate-500">{hm(start)}</span>
        <span className="absolute right-1 bottom-0 text-[9px] mono text-slate-500">{hm(end)}</span>
      </div>
    );
  }

  function Cell({ sym, data, quote, onChange, height }) {
    const [text, setText] = useState(sym);
    useEffect(() => setText(sym), [sym]);
    const pts = data?.points || [];
    const last = pts.length ? pts[pts.length - 1].close : null;
    const prev = data?.prev_close;
    const chg = last != null && prev ? last - prev : null;
    const commit = () => {
      const v = text.trim().toUpperCase();
      if (v !== sym) onChange(v ? normSym(v) : '');
    };
    return (
      <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-2 flex flex-col min-w-0" style={{ height }}>
        <div className="flex items-center gap-1.5 min-w-0">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            placeholder="輸入代號"
            aria-label="這格的股票代號"
            className="w-20 shrink-0 bg-slate-900 border border-slate-800 rounded px-1.5 py-0.5 text-xs mono text-white focus:border-sky-500 outline-none"
          />
          {sym && <span className="truncate text-xs text-slate-300">{quote?.name || ''}</span>}
          {sym && last != null && (
            <span className={`ml-auto shrink-0 mono text-xs ${colorOf(chg)}`}>
              {fmt(last)} {chg > 0 ? '▲' : chg < 0 ? '▼' : ''}
              {prev ? `${((chg / prev) * 100).toFixed(2)}%` : ''}
            </span>
          )}
        </div>
        <div className="flex-1 min-h-0 mt-1">
          {sym ? (
            <MiniIntraday data={data} tz={tzOf(sym)} />
          ) : (
            <div className="h-full flex items-center justify-center text-[11px] text-slate-600">空格：輸入代號後按 Enter</div>
          )}
        </div>
        {sym && data?.is_fallback && <div className="text-[9px] text-slate-500">非今日：{data.trade_date || '上一交易日'}</div>}
      </div>
    );
  }

  // ---------- 功能說明 ----------
  function MultiHelp() {
    return (
      <details className="bg-slate-900/70 border border-slate-800 rounded-2xl px-5 py-3 text-xs text-slate-300">
        <summary className="cursor-pointer font-semibold text-slate-200 select-none">📘 這頁怎麼用（功能說明）</summary>
        <ul className="mt-3 list-disc pl-5 space-y-1 leading-relaxed">
          <li>
            <b className="text-white">一次看多檔分時走勢</b>：選 2×2、3×3 或 4×4，畫面自動排好 4／9／16 張當日走勢。
            虛線是昨收，紅線＝目前比昨收高、綠線＝比昨收低，左上／左下是今天最高、最低的漲跌幅。
          </li>
          <li>
            <b className="text-white">每格自己選股票</b>：在格子左上角輸入代號（台股 2330、美股 NVDA、港股 0700.HK…）按 Enter；
            清空就變空格。
          </li>
          <li>
            <b className="text-white">5 組版面</b>：上方 1～5 各自記住格數與股票（例如持股、觀察名單、同產業各存一組），
            盤中一鍵切換；雙擊版面名稱可以改名。「帶入自選股／持股」會用目前清單覆蓋這一組。
          </li>
          <li>
            <b className="text-white">更新頻率</b>：每 60 秒更新一輪（5 分鐘線，與看盤頁同一份資料）。
            休市時顯示最後一個交易日，格子下方會註明「非今日」。設定會自動存到 data/userdata.json。
          </li>
        </ul>
      </details>
    );
  }

  function MultiChartPage() {
    const [state, setState] = useState(loadState);
    const [charts, setCharts] = useState({});
    const [quotes, setQuotes] = useState({});
    const [renaming, setRenaming] = useState(null);
    const slot = state.slots[state.active];
    const n = slot.grid * slot.grid;
    const visible = useMemo(() => slot.symbols.slice(0, n).filter(Boolean), [slot, n]);
    const visibleKey = visible.join(',');

    useEffect(() => writeLS(LS_KEY, state), [state]);

    const updateSlot = (patch) =>
      setState((s) => ({ ...s, slots: s.slots.map((x, i) => (i === s.active ? { ...x, ...patch } : x)) }));

    // 分時資料：同時最多 CONCURRENCY 檔，每 REFRESH_MS 一輪；換版面就重新開始
    useEffect(() => {
      let stop = false;
      const syms = visibleKey ? visibleKey.split(',') : [];
      const run = async () => {
        const queue = [...new Set(syms)];
        const worker = async () => {
          while (!stop && queue.length) {
            const sym = queue.shift();
            try {
              const r = await fetch('/api/intraday', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ symbol: sym }),
              });
              const d = await r.json();
              if (!stop) setCharts((c) => ({ ...c, [sym]: d }));
            } catch (e) {
              if (!stop) setCharts((c) => ({ ...c, [sym]: { points: [], error: e.message || String(e) } }));
            }
          }
        };
        await Promise.all(Array.from({ length: CONCURRENCY }, worker));
      };
      run();
      // 名稱用報價 API 一次查（後端快取 3 秒）
      if (syms.length) {
        fetch('/api/quotes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbols: syms }),
        })
          .then((r) => r.json())
          .then((d) => {
            if (stop) return;
            const m = {};
            (d.quotes || []).forEach((q) => {
              if (q?.symbol) m[baseCode(q.symbol)] = q;
            });
            setQuotes((old) => ({ ...old, ...m }));
          })
          .catch(() => {});
      }
      const id = setInterval(run, REFRESH_MS);
      return () => {
        stop = true;
        clearInterval(id);
      };
    }, [visibleKey]);

    const cellH = slot.grid === 2 ? 260 : slot.grid === 3 ? 200 : 160;
    const cols = window.innerWidth < 768 ? Math.min(slot.grid, 2) : slot.grid; // 手機最多兩欄
    const btn = (on) =>
      `px-2.5 py-1 rounded-lg border text-xs cursor-pointer ${on ? 'bg-sky-500/20 border-sky-400 text-white' : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'}`;

    return (
      <div className="space-y-4">
        <MultiHelp />
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-400">版面</span>
          {state.slots.map((s, i) =>
            renaming === i ? (
              <input
                key={i}
                ref={(el) => el?.focus()}
                defaultValue={s.name}
                aria-label="版面名稱"
                onBlur={(e) => {
                  const v = e.target.value.trim().slice(0, 12);
                  if (v) setState((st) => ({ ...st, slots: st.slots.map((x, j) => (j === i ? { ...x, name: v } : x)) }));
                  setRenaming(null);
                }}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                className="w-24 bg-slate-950 border border-sky-500 rounded-lg px-2 py-1 text-xs text-white outline-none"
              />
            ) : (
              <button
                type="button"
                key={i}
                onClick={() => setState((st) => ({ ...st, active: i }))}
                onDoubleClick={() => setRenaming(i)}
                title="點一下切換，雙擊改名"
                className={btn(state.active === i)}
              >
                {i + 1}．{s.name}
              </button>
            ),
          )}
          <span className="text-xs text-slate-400 ml-3">格數</span>
          {GRIDS.map((g) => (
            <button type="button" key={g} onClick={() => updateSlot({ grid: g })} className={btn(slot.grid === g)}>
              {g}×{g}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2">
            <button type="button" onClick={() => updateSlot({ symbols: fill(myWatch()) })} className={btn(false)}>
              帶入自選股
            </button>
            <button type="button" onClick={() => updateSlot({ symbols: fill(myHoldings()) })} className={btn(false)}>
              帶入持股
            </button>
            <Tip text="用目前的自選股或持股清單（前 16 檔）覆蓋這一組版面的股票。" />
          </div>
        </div>

        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {slot.symbols.slice(0, n).map((sym, i) => (
            <Cell
              key={i}
              sym={sym}
              data={sym ? charts[sym] : null}
              quote={sym ? quotes[baseCode(sym)] : null}
              height={cellH}
              onChange={(v) => updateSlot({ symbols: slot.symbols.map((x, j) => (j === i ? v : x)) })}
            />
          ))}
        </div>
      </div>
    );
  }

  window.TA = Object.assign(window.TA || {}, { MultiChartPage });
})();
