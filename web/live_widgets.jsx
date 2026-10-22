// 看盤用的圖形小元件：迷你走勢、區間條、當日分時圖、大盤指數列
(() => {
  const { useState, useEffect } = React;
  const { fmt, colorOf } = window.TA;

  // ---------- 迷你走勢 (Sparkline)：自選股列用 ----------
  const Sparkline = ({ values, w = 64, h = 22 }) => {
    if (!values || values.length < 2) return <span className="inline-block" style={{ width: w }} />;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const pts = values
      .map((v, i) => `${(i / (values.length - 1)) * w},${h - 2 - ((v - min) / span) * (h - 4)}`)
      .join(' ');
    const up = values[values.length - 1] >= values[0];
    return (
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="近一個月走勢">
        <title>近一個月收盤走勢</title>
        <polyline fill="none" stroke={up ? '#fb7185' : '#34d399'} strokeWidth="1.5" points={pts} />
      </svg>
    );
  };

  // ---------- 區間條：日內 / 52 週高低位置 (Yahoo 風格) ----------
  const RangeBar = ({ label, low, high, value, digits = 2 }) => {
    if (low == null || high == null || value == null || high <= low) return null;
    const pos = Math.max(0, Math.min(100, ((value - low) / (high - low)) * 100));
    return (
      <div>
        <div className="flex justify-between text-[11px] text-slate-400 mb-1">
          <span>{label}</span>
          <span className="mono">位於區間 {fmt(pos, 0)}%</span>
        </div>
        <div className="relative h-1.5 rounded bg-slate-800">
          <div
            className="absolute -top-1 w-1 h-3.5 rounded bg-amber-400"
            style={{ left: `calc(${pos}% - 2px)` }}
          />
        </div>
        <div className="flex justify-between text-[11px] mono text-slate-300 mt-1">
          <span>{fmt(low, digits)}</span>
          <span>{fmt(high, digits)}</span>
        </div>
      </div>
    );
  };

  // ---------- 當日分時圖 (TradingView / Yahoo 風格)：折線 + 昨收虛線 + 成交量 + 十字游標 ----------
  const IntradayChart = ({ data }) => {
    const [hover, setHover] = useState(null);
    const pts = data?.points || [];
    if (pts.length < 2) {
      return (
        <div className="h-40 flex items-center justify-center text-xs text-slate-500 border border-dashed border-slate-700 rounded-xl">
          {data?.error ? `分時資料取得失敗：${data.error}` : '目前沒有分時資料（可能尚未開盤）'}
        </div>
      );
    }
    const W = 720;
    const H = 230;
    const padL = 8;
    const padR = 56;
    const padT = 10;
    const volH = 34;
    const priceH = H - padT - volH - 22;
    const plotW = W - padL - padR;
    const prev = data.prev_close;
    const closes = pts.map((p) => p.close);
    const lo = Math.min(...closes, prev ?? Infinity);
    const hi = Math.max(...closes, prev ?? -Infinity);
    const pad = (hi - lo) * 0.08 || 1;
    const minP = lo - pad;
    const maxP = hi + pad;
    const y = (v) => padT + priceH - ((v - minP) / (maxP - minP)) * priceH;
    const t0 = data.session_start ?? pts[0].ts;
    const t1 = data.session_end ?? pts[pts.length - 1].ts;
    const x = (ts) => padL + ((ts - t0) / (t1 - t0 || 1)) * plotW;
    const maxVol = Math.max(...pts.map((p) => p.volume), 1);
    const last = pts[pts.length - 1];
    const up = prev == null ? true : last.close >= prev;
    const col = up ? '#fb7185' : '#34d399';
    const line = pts.map((p) => `${x(p.ts)},${y(p.close)}`).join(' ');
    const area = `${x(pts[0].ts)},${padT + priceH} ${line} ${x(last.ts)},${padT + priceH}`;
    const act = hover != null ? pts[hover] : last;
    const onMove = (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * W;
      let best = 0;
      let bd = Infinity;
      pts.forEach((p, i) => {
        const d = Math.abs(x(p.ts) - px);
        if (d < bd) {
          bd = d;
          best = i;
        }
      });
      setHover(best);
    };
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((r) => {
      const v = minP + (maxP - minP) * r;
      return { v, y: y(v) };
    });
    return (
      <div>
        <div className="flex flex-wrap gap-x-4 text-[11px] mono text-slate-400 mb-1">
          <span>時間 {act.t}</span>
          <span className="text-white">價 {fmt(act.close)}</span>
          {prev != null && (
            <span className={colorOf(act.close - prev)}>
              {fmt(((act.close - prev) / prev) * 100)}% vs 昨收
            </span>
          )}
          <span>量 {fmt(act.volume, 0)}</span>
        </div>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full h-auto"
          role="img"
          aria-label="當日分時走勢圖"
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        >
          <title>當日分時走勢圖</title>
          {ticks.map((t) => (
            <g key={t.y}>
              <line x1={padL} x2={W - padR} y1={t.y} y2={t.y} stroke="#1e293b" strokeWidth="1" />
              <text x={W - padR + 4} y={t.y + 3} fontSize="10" fill="#94a3b8" className="mono">
                {fmt(t.v)}
              </text>
            </g>
          ))}
          {prev != null && (
            <g>
              <line
                x1={padL}
                x2={W - padR}
                y1={y(prev)}
                y2={y(prev)}
                stroke="#64748b"
                strokeDasharray="4 3"
              />
              <text x={W - padR + 4} y={y(prev) + 3} fontSize="10" fill="#cbd5e1" className="mono">
                昨收
              </text>
            </g>
          )}
          <polygon points={area} fill={col} opacity="0.12" />
          <polyline points={line} fill="none" stroke={col} strokeWidth="1.8" />
          {pts.map((p) => (
            <rect
              key={p.ts}
              x={x(p.ts) - 1.5}
              y={padT + priceH + 22 + volH - (p.volume / maxVol) * volH}
              width="3"
              height={(p.volume / maxVol) * volH}
              fill="#475569"
            />
          ))}
          <text x={padL} y={H - 2} fontSize="10" fill="#94a3b8" className="mono">
            {pts[0].t}
          </text>
          <text
            x={W - padR}
            y={H - 2}
            fontSize="10"
            fill="#94a3b8"
            textAnchor="end"
            className="mono"
          >
            {last.t}
          </text>
          {hover != null && (
            <g>
              <line
                x1={x(act.ts)}
                x2={x(act.ts)}
                y1={padT}
                y2={padT + priceH}
                stroke="#94a3b8"
                strokeDasharray="2 2"
              />
              <circle cx={x(act.ts)} cy={y(act.close)} r="3.5" fill={col} />
            </g>
          )}
          {hover == null && <circle cx={x(last.ts)} cy={y(last.close)} r="3.5" fill={col} />}
        </svg>
      </div>
    );
  };

  // ---------- 大盤指數列 (Yahoo / 券商首頁風格) ----------
  const IndexBar = () => {
    const [rows, setRows] = useState([]);
    useEffect(() => {
      let stop = false;
      const load = () =>
        fetch('/api/indices')
          .then((r) => r.json())
          .then((d) => !stop && setRows(d.indices || []))
          .catch(() => {});
      load();
      const id = setInterval(load, 30000);
      return () => {
        stop = true;
        clearInterval(id);
      };
    }, []);
    if (!rows.length) return null;
    return (
      // 手機：一行可左右滑（隱藏捲軸）；平板以上：自動換行
      <section
        className="flex flex-nowrap md:flex-wrap items-center gap-x-5 gap-y-1 text-xs mono overflow-x-auto md:overflow-visible [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        aria-label="大盤指數"
      >
        {rows.map((r) => (
          <span
            key={r.symbol}
            className="flex items-baseline gap-1.5 shrink-0 whitespace-nowrap"
            title={`資料時間 ${r.quote_time || '--'}`}
          >
            <span className="text-slate-400">{r.name}</span>
            <span className="text-white font-bold">
              {fmt(r.price, r.symbol === 'TWD=X' ? 3 : 2)}
            </span>
            <span className={colorOf(r.change)}>
              {r.change > 0 ? '▲' : r.change < 0 ? '▼' : ''}
              {fmt(Math.abs(r.change_pct))}%
            </span>
          </span>
        ))}
      </section>
    );
  };

  window.TA = Object.assign(window.TA || {}, { Sparkline, RangeBar, IntradayChart, IndexBar });
})();
