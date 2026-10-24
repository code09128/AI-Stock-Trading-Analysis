// 股市熱力圖（看盤頁第 3 個分頁）：方塊面積＝成交值／市值／等權重／持股市值，顏色＝今日漲跌（紅漲綠跌）
// 版面用 Squarified Treemap 自己算（不引入圖表套件）：先排族群，再在族群裡排個股。
(() => {
  const { useState, useEffect, useMemo, useRef, useCallback } = React;
  const { readLS, writeLS, baseCode } = window.TA;

  const POOLS = [
    ['mine', '我的自選＋持股'],
    ['tw_hot', '台股熱門族群'],
    ['us_core', '美股核心'],
  ];
  const SIZES = [
    [
      'turnover',
      '成交金額',
      '今天成交了多少錢（現價 × 成交量）：方塊越大＝資金越集中在這檔，適合找當天的熱門題材。',
    ],
    ['cap', '市值', '公司（或 ETF）總價值：方塊越大＝對大盤指數影響越大，適合看權值股有沒有撐盤。'],
    ['equal', '等權重', '每檔一樣大，只看顏色（漲跌），避免大型股把小型股擠到看不見。'],
    ['holding', '我的持股市值', '只顯示你持有的標的，方塊大小＝你在這檔放了多少錢（換算台幣）。'],
  ];
  // 台股習慣：紅漲綠跌，7 段
  const BANDS = [
    [5, '#c62828', '≥ +5%'],
    [2, '#a33a36', '+2～5%'],
    [0.0001, '#6b2f2f', '0～2%'],
    [-0.0001, '#3d4450', '平盤'],
    [-2, '#24523b', '0～-2%'],
    [-5, '#1d7347', '-2～-5%'],
    [-Infinity, '#15924f', '≤ -5%'],
  ];
  const colorFor = (pct) => {
    if (pct == null) return '#262b33';
    if (pct > -0.0001 && pct < 0.0001) return BANDS[3][1];
    if (pct > 0) return pct >= 5 ? BANDS[0][1] : pct >= 2 ? BANDS[1][1] : BANDS[2][1];
    return pct <= -5 ? BANDS[6][1] : pct <= -2 ? BANDS[5][1] : BANDS[4][1];
  };
  const pctText = (p) => (p == null ? '—' : `${p > 0 ? '+' : ''}${p.toFixed(2)}%`);
  const twdText = (v) =>
    v == null
      ? '無資料'
      : v >= 1e12
        ? `${(v / 1e12).toFixed(2)} 兆`
        : v >= 1e8
          ? `${(v / 1e8).toFixed(1)} 億`
          : `${Math.round(v / 1e4).toLocaleString()} 萬`;
  const sizeOf = (it, by) =>
    by === 'turnover'
      ? it.turnover_twd
      : by === 'cap'
        ? it.market_cap_twd
        : by === 'holding'
          ? it.holding_twd
          : 1;

  // Squarified treemap：values 需由大到小，回傳每塊的 {x,y,w,h}
  function squarify(nodes, x, y, w, h) {
    const total = nodes.reduce((s, n) => s + n.v, 0);
    if (!nodes.length || total <= 0 || w <= 0 || h <= 0) return [];
    const scale = (w * h) / total;
    let rest = nodes.map((n) => ({ ...n, a: n.v * scale }));
    const out = [];
    const worst = (row, side) => {
      const s = row.reduce((t, r) => t + r.a, 0);
      const mx = Math.max(...row.map((r) => r.a));
      const mn = Math.min(...row.map((r) => r.a));
      return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn));
    };
    while (rest.length) {
      const side = Math.min(w, h);
      const row = [rest[0]];
      let i = 1;
      while (i < rest.length && worst([...row, rest[i]], side) <= worst(row, side)) {
        row.push(rest[i]);
        i += 1;
      }
      const area = row.reduce((t, r) => t + r.a, 0);
      if (w >= h) {
        const cw = area / h;
        let cy = y;
        for (const r of row) {
          const rh = r.a / cw;
          out.push({ ...r, x, y: cy, w: cw, h: rh });
          cy += rh;
        }
        x += cw;
        w -= cw;
      } else {
        const rh = area / w;
        let cx = x;
        for (const r of row) {
          const rw = r.a / rh;
          out.push({ ...r, x: cx, y, w: rw, h: rh });
          cx += rw;
        }
        y += rh;
        h -= rh;
      }
      rest = rest.slice(row.length);
    }
    return out;
  }

  function Cell({ c, active, onPick, onOpen, onHover }) {
    const it = c.item;
    const big = c.w > 92 && c.h > 56;
    const mid = c.w > 46 && c.h > 30;
    const tiny = c.w > 26 && c.h > 15;
    const fs = Math.max(10, Math.min(18, Math.sqrt(c.w * c.h) / 6));
    const flag = it.limit_up ? '漲停' : it.limit_down ? '跌停' : null;
    return (
      <button
        type="button"
        onClick={() => onPick(it)}
        onDoubleClick={() => onOpen(it)}
        onMouseMove={(e) => onHover(it, e)}
        onMouseLeave={() => onHover(null)}
        aria-label={`${it.code} ${it.name} ${pctText(it.change_pct)}`}
        className="absolute overflow-hidden text-white text-center flex flex-col items-center justify-center leading-tight cursor-pointer hover:brightness-125"
        style={{
          left: c.x + 1,
          top: c.y + 1,
          width: Math.max(0, c.w - 2),
          height: Math.max(0, c.h - 2),
          background: colorFor(it.change_pct),
          outline: active ? '2px solid #fff' : flag ? '2px solid #facc15' : 'none',
          outlineOffset: -2,
          opacity: it.error ? 0.55 : 1,
        }}
      >
        {big && (
          <>
            <span className="font-semibold mono" style={{ fontSize: fs }}>
              {it.code}
            </span>
            <span className="text-[11px] text-white/80 truncate max-w-full px-1">{it.name}</span>
            <span className="font-semibold mono" style={{ fontSize: Math.max(11, fs * 0.85) }}>
              {pctText(it.change_pct)}
            </span>
            {c.h > 84 && (
              <span className="text-[10px] text-white/70 mono">
                {it.price ?? '—'}
                {flag && <span className="ml-1 text-yellow-300 font-semibold">{flag}</span>}
              </span>
            )}
          </>
        )}
        {!big && mid && (
          <>
            <span className="font-semibold mono text-[11px]">{it.code}</span>
            <span className="mono text-[10px]">{pctText(it.change_pct)}</span>
          </>
        )}
        {!mid && tiny && <span className="mono text-[9px]">{it.code}</span>}
      </button>
    );
  }

  function HeatmapPanel({
    watch,
    holdings,
    selected,
    onSelect,
    onOpenQuote,
    onSendMod1,
    onSendMod2,
  }) {
    const [pool, setPool] = useState(() => readLS('tw_us_heatmap_pool_v1', 'tw_hot'));
    const [sizeChoice, setSizeBy] = useState(() => readLS('tw_us_heatmap_size_v1', 'turnover'));
    // 「我的持股市值」只在自選範圍有意義，其他範圍自動改用成交金額
    const sizeBy = sizeChoice === 'holding' && pool !== 'mine' ? 'turnover' : sizeChoice;
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState(null);
    const [hover, setHover] = useState(null);
    const [width, setWidth] = useState(800);
    const boxRef = useRef(null);
    const reqId = useRef(0); // 只採用最後一次請求的結果（切換範圍時，慢回來的舊請求不能蓋掉新畫面）
    const busyRef = useRef(false); // 定時更新：上一輪還沒回來就跳過
    useEffect(() => writeLS('tw_us_heatmap_pool_v1', pool), [pool]);
    useEffect(() => writeLS('tw_us_heatmap_size_v1', sizeChoice), [sizeChoice]);

    const mine = useMemo(
      () => [...new Set([...watch, ...holdings.map((h) => h.symbol)])],
      [watch, holdings],
    );
    const holdMap = useMemo(
      () => Object.fromEntries(holdings.map((h) => [h.symbol, Number(h.shares) || 0])),
      [holdings],
    );
    const mineKey = mine.join(',');
    const holdKey = JSON.stringify(holdMap);

    const load = useCallback(async () => {
      const id = ++reqId.current;
      busyRef.current = true;
      setLoading(true);
      try {
        const res = await fetch('/api/heatmap', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pool, symbols: mine, holdings: holdMap }),
        });
        const d = await res.json();
        if (id !== reqId.current) return;
        if (d.error) throw new Error(d.error);
        setData(d);
        setErr(null);
      } catch (e) {
        if (id === reqId.current) setErr(e.message);
      } finally {
        if (id === reqId.current) {
          setLoading(false);
          busyRef.current = false;
        }
      }
      // eslint-disable-next-line
    }, [pool, mineKey, holdKey]);

    useEffect(() => {
      setData(null);
      load();
      const t = setInterval(() => {
        if (!document.hidden && !busyRef.current) load(); // 上一輪還沒回來就跳過
      }, 20000);
      return () => clearInterval(t);
    }, [load]);

    useEffect(() => {
      const el = boxRef.current;
      if (!el) return undefined;
      const ro = new ResizeObserver(() => setWidth(el.clientWidth));
      ro.observe(el);
      setWidth(el.clientWidth);
      return () => ro.disconnect();
    }, []);
    const height = width < 640 ? 440 : 560;

    // 版面：沒有面積資料的給最小值（仍顯示，靠 hover 看原因）；持股模式只留有持股的
    const layout = useMemo(() => {
      if (!data) return { groups: [], cells: [], missing: 0, shown: 0 };
      let items = data.items;
      if (sizeBy === 'holding') items = items.filter((it) => it.holding_twd);
      const vals = items.map((it) => sizeOf(it, sizeBy)).filter((v) => v > 0);
      const floor = vals.length ? Math.min(...vals) * 0.6 : 1;
      const missing = items.filter((it) => !(sizeOf(it, sizeBy) > 0)).length;
      const byGroup = {};
      for (const it of items) {
        const v = sizeOf(it, sizeBy) > 0 ? sizeOf(it, sizeBy) : floor;
        if (!byGroup[it.group]) byGroup[it.group] = [];
        byGroup[it.group].push({ v, item: it });
      }
      const groupNodes = Object.entries(byGroup)
        .map(([name, list]) => {
          const w = list.filter((x) => x.item.change_pct != null);
          const sw = w.reduce((s, x) => s + x.v, 0);
          const avg = sw ? w.reduce((s, x) => s + x.v * x.item.change_pct, 0) / sw : null;
          return {
            name,
            v: list.reduce((s, x) => s + x.v, 0),
            list: list.sort((a, b) => b.v - a.v),
            avg,
          };
        })
        .sort((a, b) => b.v - a.v);
      const groups = squarify(groupNodes, 0, 0, width, height);
      const cells = [];
      for (const g of groups) {
        const head = g.h > 40 && g.w > 60 ? 18 : 0;
        for (const c of squarify(g.list, g.x + 1, g.y + head + 1, g.w - 2, g.h - head - 2))
          cells.push(c);
      }
      return { groups, cells, missing, shown: items.length };
    }, [data, sizeBy, width, height]);

    const onHover = (it, e) => {
      if (!it) return setHover(null);
      const r = boxRef.current.getBoundingClientRect();
      setHover({ it, x: e.clientX - r.left, y: e.clientY - r.top });
      return undefined;
    };
    const pickedItem = data?.items.find((x) => baseCode(x.symbol) === baseCode(selected));
    const sizeInfo = SIZES.find((s) => s[0] === sizeBy);

    return (
      <div
        className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 space-y-3"
        data-tour="heatmap"
      >
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-slate-400">範圍</span>
          {POOLS.map(([k, label]) => (
            <button
              type="button"
              key={k}
              onClick={() => setPool(k)}
              className={`px-2.5 py-1 rounded-lg border cursor-pointer ${pool === k ? 'bg-sky-500/20 border-sky-400 text-white' : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'}`}
            >
              {label}
            </button>
          ))}
          <span className="text-slate-400 ml-2">方塊大小</span>
          {SIZES.filter(([k]) => k !== 'holding' || pool === 'mine').map(([k, label]) => (
            <button
              type="button"
              key={k}
              onClick={() => setSizeBy(k)}
              className={`px-2.5 py-1 rounded-lg border cursor-pointer ${sizeBy === k ? 'bg-sky-500/20 border-sky-400 text-white' : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'}`}
            >
              {label}
            </button>
          ))}
          <window.TA.Tip
            text={`面積（方塊大小）＝${sizeInfo?.[2] || ''} 顏色＝今天的漲跌幅（紅漲綠跌，越深越多）。族群標題後面的 % 是依方塊大小加權的平均漲跌。黃框＝漲停或跌停。單擊方塊＝選這檔，雙擊＝直接看行情與下單。每 20 秒自動更新。`}
          />
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="ml-auto px-2.5 py-1 rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700 cursor-pointer"
          >
            {loading ? '更新中…' : `↻ 更新${data?.timestamp ? `（${data.timestamp}）` : ''}`}
          </button>
        </div>

        {err && <div className="text-xs text-rose-300">⚠️ 熱力圖資料抓取失敗：{err}</div>}
        {data?.warnings?.map((w) => (
          <div key={w} className="text-xs text-amber-300">
            ⚠️ {w}
          </div>
        ))}
        {data && layout.missing > 0 && sizeBy !== 'equal' && (
          <div className="text-[11px] text-slate-500">
            有 {layout.missing} 檔沒有「{sizeInfo?.[1]}」資料（例如美股 ETF
            沒有市值、上櫃公司沒有公開股數），以最小方塊顯示，滑鼠移上去可看原因。
          </div>
        )}

        <div
          ref={boxRef}
          className="relative w-full rounded-lg bg-slate-950 overflow-hidden"
          style={{ height }}
        >
          {!data && !err && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-500">
              正在抓取報價…
            </div>
          )}
          {data && layout.shown === 0 && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-500 px-6 text-center">
              {sizeBy === 'holding'
                ? '目前沒有持股資料（或持股抓不到報價）。'
                : '這個範圍沒有標的，請先在左側加入自選股。'}
            </div>
          )}
          {layout.groups.map((g) => (
            <div
              key={g.name}
              className="absolute border border-slate-950 pointer-events-none"
              style={{ left: g.x, top: g.y, width: g.w, height: g.h }}
            >
              {g.h > 40 && g.w > 60 && (
                <div className="h-[18px] px-1.5 text-[11px] leading-[18px] text-slate-200 bg-slate-900/90 truncate">
                  {g.name}
                  <span
                    className={`ml-1 mono ${g.avg > 0 ? 'text-rose-300' : g.avg < 0 ? 'text-emerald-300' : 'text-slate-400'}`}
                  >
                    {g.avg == null ? '' : pctText(g.avg)}
                  </span>
                </div>
              )}
            </div>
          ))}
          {layout.cells.map((c) => (
            <Cell
              key={c.item.symbol}
              c={c}
              active={baseCode(c.item.symbol) === baseCode(selected)}
              onPick={(it) => onSelect(it.symbol)}
              onOpen={(it) => onOpenQuote(it.symbol)}
              onHover={onHover}
            />
          ))}
          {hover && (
            <div
              className="absolute z-10 pointer-events-none w-56 rounded-lg bg-slate-900 border border-slate-700 shadow-xl p-2 text-[11px] text-slate-300 space-y-0.5"
              style={{
                left: Math.min(hover.x + 14, width - 232),
                top: Math.min(hover.y + 14, height - 170),
              }}
            >
              <div className="text-white font-semibold">
                <span className="mono">{hover.it.code}</span> {hover.it.name}
              </div>
              <div className="text-slate-500">{hover.it.group}</div>
              <div>
                現價 <span className="mono text-white">{hover.it.price ?? '—'}</span>{' '}
                {hover.it.currency}{' '}
                <span
                  className={`mono ${hover.it.change_pct > 0 ? 'text-rose-300' : hover.it.change_pct < 0 ? 'text-emerald-300' : ''}`}
                >
                  {pctText(hover.it.change_pct)}
                </span>
                {hover.it.limit_up && <span className="ml-1 text-yellow-300">漲停</span>}
                {hover.it.limit_down && <span className="ml-1 text-yellow-300">跌停</span>}
              </div>
              <div>
                成交量 <span className="mono">{hover.it.volume?.toLocaleString() ?? '—'}</span>{' '}
                {hover.it.volume_unit || ''}
              </div>
              <div>成交金額 ≈ {twdText(hover.it.turnover_twd)} 台幣</div>
              <div>
                市值 ≈ {twdText(hover.it.market_cap_twd)}
                {hover.it.market_cap_twd
                  ? ' 台幣'
                  : hover.it.market_cap_note
                    ? `（${hover.it.market_cap_note}）`
                    : ''}
              </div>
              {hover.it.holding_twd && (
                <div>我的持股市值 ≈ {twdText(hover.it.holding_twd)} 台幣</div>
              )}
              {hover.it.error && <div className="text-rose-300">⚠️ {hover.it.error}</div>}
              {hover.it.stale_warning && (
                <div className="text-amber-300">{hover.it.stale_warning}</div>
              )}
              <div className="text-slate-500">{hover.it.quote_time}</div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1 text-[10px] text-slate-400">
          <span className="mr-1">今日漲跌</span>
          {BANDS.map(([, c, label]) => (
            <span
              key={label}
              className="px-1.5 py-0.5 rounded text-white"
              style={{ background: c }}
            >
              {label}
            </span>
          ))}
          <span className="px-1.5 py-0.5 rounded border-2 border-yellow-400 text-slate-200">
            漲跌停
          </span>
          <span className="px-1.5 py-0.5 rounded text-slate-400" style={{ background: '#262b33' }}>
            無報價
          </span>
        </div>

        {pickedItem && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-950/70 border border-slate-800 px-3 py-2 text-xs">
            <span className="text-white font-semibold">
              <span className="mono">{pickedItem.code}</span> {pickedItem.name}
            </span>
            <span className="mono text-slate-300">{pickedItem.price ?? '—'}</span>
            <span
              className={`mono ${pickedItem.change_pct > 0 ? 'text-rose-300' : pickedItem.change_pct < 0 ? 'text-emerald-300' : 'text-slate-400'}`}
            >
              {pctText(pickedItem.change_pct)}
            </span>
            <span className="text-slate-500">成交 {twdText(pickedItem.turnover_twd)}</span>
            <span className="ml-auto flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => onOpenQuote(pickedItem.symbol)}
                className="px-2.5 py-1 rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700 cursor-pointer"
              >
                看行情與下單
              </button>
              <button
                type="button"
                onClick={() => onSendMod1(pickedItem)}
                className="px-2.5 py-1 rounded-lg bg-amber-500/90 text-slate-950 font-semibold hover:brightness-110 cursor-pointer"
              >
                送技術分析
              </button>
              <button
                type="button"
                onClick={() => onSendMod2(pickedItem)}
                className="px-2.5 py-1 rounded-lg bg-sky-600 text-white font-semibold hover:bg-sky-500 cursor-pointer"
              >
                查今天的新聞
              </button>
            </span>
          </div>
        )}
        <div className="text-[10px] text-slate-500">
          資料來源：
          {data
            ? Object.entries(data.sources)
                .map(([k, v]) => `${k}＝${v}`)
                .join('；')
            : '—'}
          。金額一律換算台幣，方便台美股放在同一張圖比較。
        </div>
      </div>
    );
  }

  window.TA = Object.assign(window.TA || {}, { HeatmapPanel });
})();
