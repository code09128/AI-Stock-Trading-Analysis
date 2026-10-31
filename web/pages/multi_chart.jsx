// 多圖走勢：一次排好多張分時走勢（2×2／3×3／4×4 或自訂幾列幾欄），每格可換股票，
// 版面可自己新增（最多 MAX_SLOTS 組）、各自儲存（自動同步到 data/userdata.json）。
// 資料：/api/intraday（後端快取 30 秒）；同時最多抓 3 檔，每 60 秒更新一輪。
(() => {
  const { useState, useEffect, useMemo, useRef } = React;
  const { fmt, colorOf, readLS, writeLS, normSym, baseCode, tzOf, Tip, DEFAULT_WATCH, LS_WATCH } = window.TA;

  const LS_KEY = 'tw_us_multichart_v1';
  const GRIDS = [2, 3, 4];
  const SLOTS = 5; // 第一次使用時建立的版面數
  const MAX_SLOTS = 20;
  const MAX_SIDE = 6; // 自訂格數：每邊最多 6（最多 36 格）
  const REFRESH_MS = 60000;
  const CONCURRENCY = 3;

  const fill = (syms, n = 16) => [...syms.slice(0, n), ...Array(Math.max(0, n - syms.length)).fill('')];
  // 舊版只存 grid（正方形）：列數、欄數都沿用 grid，已存的版面不會跑掉
  const rowsOf = (slot) => slot.rows || slot.grid || 3;
  const colsOf = (slot) => slot.cols || slot.grid || 3;
  const clampSide = (v) => Math.max(1, Math.min(MAX_SIDE, Math.round(Number(v) || 1)));
  const myWatch = () => readLS(LS_WATCH, null) || DEFAULT_WATCH;
  const myHoldings = () =>
    window.TA.uniqueSymbols(readLS('tw_us_holdings_v1', []).map((h) => h?.symbol));

  function loadState() {
    const saved = readLS(LS_KEY, null);
    if (Array.isArray(saved?.slots) && saved.slots.length) {
      return { ...saved, active: Math.min(saved.active || 0, saved.slots.length - 1) };
    }
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

  // drag：拖拉排列用（左上角 ⠿ 把手拖到另一格放開＝兩格互換；拖到空格＝移過去）
  function Cell({ sym, data, quote, onChange, height, drag }) {
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
      <li
        onDragOver={drag.over}
        onDragLeave={drag.leave}
        onDrop={drag.drop}
        className={`bg-slate-950/70 border rounded-xl p-2 flex flex-col min-w-0 transition-colors ${
          drag.isTarget ? 'border-sky-400 bg-sky-950/40' : drag.isSource ? 'border-slate-600 opacity-50' : 'border-slate-800'
        }`}
        style={{ height }}
      >
        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
          <button
            type="button"
            draggable
            onDragStart={drag.start}
            onDragEnd={drag.end}
            aria-label="拖拉這一格到其他位置"
            title="按住拖到其他格子：兩格互換位置"
            className="shrink-0 cursor-grab active:cursor-grabbing select-none text-slate-500 hover:text-slate-200 text-sm leading-none px-0.5"
          >
            ⠿
          </button>
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
          {sym && (
            <span className={`${last != null ? '' : 'ml-auto '}shrink-0 flex gap-1`}>
              <button
                type="button"
                onClick={() => window.TA.openInWatch?.(sym)}
                title="到看盤頁看五檔、新聞與下單"
                className="px-1.5 rounded bg-slate-800 text-[10px] text-slate-300 hover:bg-slate-700 cursor-pointer"
              >
                看盤
              </button>
              <button
                type="button"
                onClick={() => window.TA.analyzeSymbol?.(sym)}
                title="送技術分析"
                className="px-1.5 rounded bg-slate-800 text-[10px] text-slate-300 hover:bg-slate-700 cursor-pointer"
              >
                分析
              </button>
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
      </li>
    );
  }

  // 自訂列數／欄數：打字時只改輸入框，按 Enter 或離開欄位才套用（不然清空就先變 1、打兩位數會被夾成上限）
  // 點選格數：像 Word 插入表格，滑鼠移到 6×6 小方格上預覽「幾列 × 幾欄」，點一下套用
  function GridPicker({ rows, cols, onPick }) {
    const [open, setOpen] = useState(false);
    const [hover, setHover] = useState(null);
    const ref = useRef(null);
    useEffect(() => {
      if (!open) return undefined;
      const close = (e) => {
        if (ref.current && !ref.current.contains(e.target)) setOpen(false);
      };
      const esc = (e) => e.key === 'Escape' && setOpen(false);
      document.addEventListener('mousedown', close);
      document.addEventListener('keydown', esc);
      return () => {
        document.removeEventListener('mousedown', close);
        document.removeEventListener('keydown', esc);
      };
    }, [open]);
    const show = hover || { r: rows, c: cols };
    return (
      <span className="relative" ref={ref}>
        <button
          type="button"
          onClick={() => {
            setHover(null); // 每次打開都從目前的格數開始顯示
            setOpen(!open);
          }}
          aria-expanded={open}
          className="px-2.5 py-1 rounded-lg border text-xs cursor-pointer bg-slate-950 border-slate-800 text-slate-300 hover:text-white"
        >
          ▦ 點選格數
        </button>
        {open && (
          <div className="absolute z-30 left-0 top-full mt-1 p-2 rounded-xl bg-slate-900 border border-slate-700 shadow-2xl">
            <div
              className="grid gap-1"
              style={{ gridTemplateColumns: `repeat(${MAX_SIDE}, 1.25rem)` }}
            >
              {Array.from({ length: MAX_SIDE * MAX_SIDE }, (_, k) => {
                const r = Math.floor(k / MAX_SIDE) + 1;
                const c = (k % MAX_SIDE) + 1;
                const on = r <= show.r && c <= show.c;
                return (
                  <button
                    type="button"
                    key={k}
                    aria-label={`${r} 列 × ${c} 欄`}
                    onMouseEnter={() => setHover({ r, c })}
                    onFocus={() => setHover({ r, c })}
                    onClick={() => {
                      onPick(r, c);
                      setOpen(false);
                    }}
                    className={`w-5 h-5 rounded-sm border cursor-pointer ${
                      on ? 'bg-sky-500/60 border-sky-300' : 'bg-slate-950 border-slate-700 hover:border-slate-500'
                    }`}
                  />
                );
              })}
            </div>
            <div className="mt-1.5 text-center text-xs mono text-slate-200">
              {show.r} 列 × {show.c} 欄（{show.r * show.c} 格）
            </div>
          </div>
        )}
      </span>
    );
  }

  function SideInput({ label, value, onCommit }) {
    const [text, setText] = useState(String(value));
    useEffect(() => setText(String(value)), [value]);
    const commit = () => {
      if (text.trim() === '') {
        setText(String(value));
        return;
      }
      setText(String(clampSide(text))); // 超出範圍時顯示實際套用的值
      if (clampSide(text) !== value) onCommit(text);
    };
    return (
      <input
        type="number"
        min={1}
        max={MAX_SIDE}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        aria-label={label}
        className="w-14 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs mono text-white"
      />
    );
  }

  // ---------- 功能說明 ----------
  function MultiHelp() {
    return (
      <details className="bg-slate-900/70 border border-slate-800 rounded-2xl px-5 py-3 text-xs text-slate-300">
        <summary className="cursor-pointer font-semibold text-slate-200 select-none">📘 這頁怎麼用（功能說明）</summary>
        <ul className="mt-3 list-disc pl-5 space-y-1 leading-relaxed">
          <li>
            <b className="text-white">一次看多檔分時走勢</b>：選 2×2、3×3、4×4，按「▦ 點選格數」用滑鼠在小方格上點出幾列幾欄，或在「自訂」輸入（每邊 1～6，最多 36 格），
            畫面自動排好當日走勢。
            虛線是昨收，紅線＝目前比昨收高、綠線＝比昨收低，左上／左下是今天最高、最低的漲跌幅。
          </li>
          <li>
            <b className="text-white">每格自己選股票</b>：在格子左上角輸入代號（台股 2330、美股 NVDA、港股 0700.HK…）按 Enter；
            清空就變空格。
          </li>
          <li>
            <b className="text-white">多組版面</b>：每組各自記住格數與股票（例如持股、觀察名單、同產業各存一組），
            盤中一鍵切換；雙擊版面名稱可以改名。「＋ 新增版面」最多 {MAX_SLOTS} 組，「刪除這組」會先確認。
            「帶入自選股／持股」會用目前清單覆蓋這一組。
          </li>
          <li>
            <b className="text-white">拖拉排列</b>：按住每格左上角的 ⠿ 拖到另一格放開，兩格就會互換位置（拖到空格就是移過去），
            可以把同一族群排在同一列一起看；排好的順序會跟版面一起存起來。
          </li>
          <li>
            <b className="text-white">跟其他頁連動</b>：每格右上角「看盤」直接切到看盤頁看那一檔的五檔、新聞與下單，
            「分析」送技術分析；版面的股票可以一鍵帶入看盤頁的自選股或我的持股。
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
    const [dragFrom, setDragFrom] = useState(null);
    const [dragOver, setDragOver] = useState(null);
    const slot = state.slots[state.active];
    const rows = rowsOf(slot);
    const colN = colsOf(slot);
    const n = rows * colN;
    const visible = useMemo(() => slot.symbols.slice(0, n).filter(Boolean), [slot, n]);
    const visibleKey = visible.join(',');

    useEffect(() => writeLS(LS_KEY, state), [state]);

    const updateSlot = (patch) =>
      setState((s) => ({ ...s, slots: s.slots.map((x, i) => (i === s.active ? { ...x, ...patch } : x)) }));
    // 改格數：格子變多時補空格，原本的股票保留
    const setGrid = (r, c) => {
      const nr = clampSide(r);
      const nc = clampSide(c);
      updateSlot({
        grid: nr === nc ? nr : undefined,
        rows: nr,
        cols: nc,
        symbols: fill(slot.symbols, Math.max(nr * nc, slot.symbols.length)),
      });
    };
    const addSlot = () =>
      setState((s) =>
        s.slots.length >= MAX_SLOTS
          ? s
          : {
              active: s.slots.length,
              slots: [...s.slots, { name: `版面 ${s.slots.length + 1}`, rows: 3, cols: 3, grid: 3, symbols: fill([], 9) }],
            },
      );
    const removeSlot = () => {
      if (state.slots.length <= 1) return;
      if (!window.confirm(`刪除版面「${slot.name}」？這一組的股票設定會一起刪掉。`)) return;
      setState((s) => ({
        active: Math.max(0, s.active - 1),
        slots: s.slots.filter((_, i) => i !== s.active),
      }));
    };

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
      const cancel = window.TA.pollEvery(run, REFRESH_MS);
      return () => {
        stop = true;
        cancel();
      };
    }, [visibleKey]);

    // 拖拉排列：放開時兩格互換（空格也算一格，所以拖到空格就是移過去）
    const dragProps = (i) => ({
      isSource: dragFrom === i,
      isTarget: dragOver === i && dragFrom !== null && dragFrom !== i,
      start: (e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(i)); // Firefox 要有資料才會開始拖
        setDragFrom(i);
      },
      end: () => {
        setDragFrom(null);
        setDragOver(null);
      },
      over: (e) => {
        if (dragFrom === null) return;
        e.preventDefault(); // 允許放下
        if (dragOver !== i) setDragOver(i);
      },
      leave: () => dragOver === i && setDragOver(null),
      drop: (e) => {
        e.preventDefault();
        if (dragFrom !== null && dragFrom !== i) {
          const next = [...slot.symbols];
          [next[dragFrom], next[i]] = [next[i], next[dragFrom]];
          updateSlot({ symbols: next });
        }
        setDragFrom(null);
        setDragOver(null);
      },
    });
    const cellH = rows <= 2 ? 260 : rows === 3 ? 200 : rows === 4 ? 160 : 130;
    const cols = window.innerWidth < 768 ? Math.min(colN, 2) : colN; // 手機最多兩欄
    const btn = (on) =>
      `px-2.5 py-1 rounded-lg border text-xs cursor-pointer ${on ? 'bg-sky-500/20 border-sky-400 text-white' : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'}`;

    return (
      <div className="space-y-4" data-tour="multichart-root">
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
          {state.slots.length < MAX_SLOTS && (
            <button type="button" onClick={addSlot} className={btn(false)} title="新增一組空白版面">
              ＋ 新增版面
            </button>
          )}
          {state.slots.length > 1 && (
            <button type="button" onClick={removeSlot} className={`${btn(false)} hover:text-rose-300`} title="刪除目前這一組版面">
              刪除這組
            </button>
          )}
        </div>
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-400">格數</span>
          {GRIDS.map((g) => (
            <button type="button" key={g} onClick={() => setGrid(g, g)} className={btn(rows === g && colN === g)}>
              {g}×{g}
            </button>
          ))}
          <GridPicker rows={rows} cols={colN} onPick={setGrid} />
          <span className="text-xs text-slate-400 ml-2">自訂</span>
          <SideInput label="列數" value={rows} onCommit={(v) => setGrid(v, colN)} />
          <span className="text-xs text-slate-400">列 ×</span>
          <SideInput label="欄數" value={colN} onCommit={(v) => setGrid(rows, v)} />
          <span className="text-xs text-slate-400">欄（{n} 格，每邊最多 {MAX_SIDE}）</span>
          <div className="ml-auto flex items-center gap-2">
            <button type="button" onClick={() => updateSlot({ symbols: fill(myWatch(), Math.max(n, 16)) })} className={btn(false)}>
              帶入自選股
            </button>
            <button type="button" onClick={() => updateSlot({ symbols: fill(myHoldings(), Math.max(n, 16)) })} className={btn(false)}>
              帶入持股
            </button>
            <Tip text="用目前的自選股或持股清單覆蓋這一組版面的股票（依格數帶入前幾檔）。" />
          </div>
        </div>

        <ul className="grid gap-2 list-none p-0 m-0" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {slot.symbols.slice(0, n).map((sym, i) => (
            <Cell
              key={i}
              sym={sym}
              data={sym ? charts[sym] : null}
              quote={sym ? quotes[baseCode(sym)] : null}
              height={cellH}
              onChange={(v) => updateSlot({ symbols: slot.symbols.map((x, j) => (j === i ? v : x)) })}
              drag={dragProps(i)}
            />
          ))}
        </ul>
      </div>
    );
  }

  window.TA = Object.assign(window.TA || {}, { MultiChartPage });
})();
