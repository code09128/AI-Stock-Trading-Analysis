(() => {
  const { useState } = React;

  // 互動式 K 線：滾輪縮放（以游標所在 K 棒為中心）、拖曳平移、兩指縮放、範圍按鈕、全螢幕放大
  const RANGE_PRESETS = [
    ['1M', 22],
    ['3M', 66],
    ['6M', 130],
    ['1Y', 250],
    ['全部', Infinity],
  ];
  const MIN_VISIBLE = 10;

  function CandlestickChart({ bars: allBars, supports, resistances, barCount = 60, unit = '日' }) {
    const { useRef, useEffect } = React;
    const total = allBars?.length || 0;
    // view：顯示幾根（count）與最右邊離最新差幾根（offset，0＝貼齊最新）
    const [view, setView] = useState({ count: barCount, offset: 0 });
    const [hoverIdx, setHoverIdx] = useState(null);
    const [expanded, setExpanded] = useState(false);
    const svgRef = useRef(null);
    const drag = useRef(null);
    const pointers = useRef(new Map());

    const clamp = (v) => {
      const count = Math.max(Math.min(MIN_VISIBLE, total), Math.min(total, Math.round(v.count)));
      const offset = Math.max(0, Math.min(total - count, Math.round(v.offset)));
      return { count, offset };
    };
    const cur = clamp(view);
    const end = total - cur.offset;
    const start = end - cur.count;
    const bars = total ? allBars.slice(start, end) : [];

    const width = 780;
    const height = expanded ? 560 : 340;
    const padLeft = 56;
    const padRight = 60;
    const padTop = 18;
    const volH = expanded ? 90 : 58;
    const priceH = height - padTop - volH - 22 - 22;
    const volTop = padTop + priceH + 22;
    const plotW = width - padLeft - padRight;
    const stepX = plotW / Math.max(bars.length, 1);

    // 視窗座標 → 第幾根（相對可見範圍）
    const idxAt = (clientX) => {
      const r = svgRef.current?.getBoundingClientRect();
      if (!r) return null;
      const x = ((clientX - r.left) / r.width) * width;
      if (x < padLeft || x > width - padRight) return null;
      return Math.max(0, Math.min(bars.length - 1, Math.floor((x - padLeft) / stepX)));
    };
    const zoomAt = (factor, clientX) => {
      setView((v) => {
        const c = clamp(v);
        const anchor = clientX != null ? idxAt(clientX) : null;
        const frac = anchor != null ? (anchor + 0.5) / c.count : 1; // 游標在可見範圍的比例
        const count = Math.max(MIN_VISIBLE, Math.min(total, c.count * factor));
        // 讓游標下那根 K 棒維持在同一個位置
        const rightIdx = total - c.offset; // 不含
        const anchorAbs = rightIdx - c.count + frac * c.count;
        const newRight = anchorAbs + (1 - frac) * count;
        return clamp({ count, offset: total - newRight });
      });
    };

    // 滾輪需要 passive:false 才能阻止頁面捲動
    useEffect(() => {
      const el = svgRef.current;
      if (!el) return undefined;
      const onWheel = (e) => {
        e.preventDefault();
        zoomAt(e.deltaY > 0 ? 1.15 : 1 / 1.15, e.clientX);
      };
      el.addEventListener('wheel', onWheel, { passive: false });
      return () => el.removeEventListener('wheel', onWheel);
    });
    useEffect(() => {
      if (!expanded) return undefined;
      const onKey = (e) => e.key === 'Escape' && setExpanded(false);
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, [expanded]);

    const onPointerDown = (e) => {
      pointers.current.set(e.pointerId, e.clientX);
      e.currentTarget.setPointerCapture?.(e.pointerId);
      if (pointers.current.size === 1) drag.current = { x: e.clientX, offset: cur.offset };
      else if (pointers.current.size === 2) {
        const [a, b] = [...pointers.current.values()];
        drag.current = { pinch: Math.abs(a - b) || 1, count: cur.count, center: (a + b) / 2 };
      }
    };
    const onPointerMove = (e) => {
      if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, e.clientX);
      const d = drag.current;
      if (d && pointers.current.size === 2 && d.pinch) {
        const [a, b] = [...pointers.current.values()];
        const dist = Math.abs(a - b) || 1;
        setView((v) => ({ ...clamp(v), count: d.count * (d.pinch / dist) }));
        return;
      }
      if (d && pointers.current.size === 1 && d.offset != null) {
        const r = svgRef.current.getBoundingClientRect();
        const barsMoved = (((e.clientX - d.x) / r.width) * width) / stepX;
        setView((v) => clamp({ count: v.count, offset: d.offset + barsMoved }));
        return;
      }
      setHoverIdx(idxAt(e.clientX));
    };
    const onPointerUp = (e) => {
      pointers.current.delete(e.pointerId);
      if (pointers.current.size === 0) drag.current = null;
    };

    if (!total) return null;

    const activeIdx = hoverIdx !== null && hoverIdx < bars.length ? hoverIdx : bars.length - 1;
    const activeBar = bars[activeIdx];
    const isActiveUp = activeBar.close >= activeBar.open;

    const allPrices = [];
    let maxVol = 1;
    for (const b of bars) {
      allPrices.push(b.high, b.low);
      if (b.ma5) allPrices.push(b.ma5);
      if (b.ma20) allPrices.push(b.ma20);
      if (b.ma60 && cur.count > 40) allPrices.push(b.ma60);
      if (b.volume > maxVol) maxVol = b.volume;
    }
    const minRaw = Math.min(...allPrices);
    const maxRaw = Math.max(...allPrices);
    // 支撐壓力只在可見價格附近時才納入縮放範圍（太遠的會把 K 棒壓扁）
    const near = (p) => p >= minRaw * 0.9 && p <= maxRaw * 1.1;
    const levelsS = (supports || []).filter(near);
    const levelsR = (resistances || []).filter(near);
    for (const v of [...levelsS, ...levelsR]) allPrices.push(v);

    const minP = Math.min(...allPrices) * 0.992;
    const maxP = Math.max(...allPrices) * 1.008;
    const range = Math.max(maxP - minP, 0.01);
    const toY = (price) => padTop + priceH - ((price - minP) / range) * priceH;
    const toVolY = (vol) => volTop + volH - (vol / maxVol) * volH;
    const line = (key) =>
      bars
        .map((b, idx) => (b[key] ? `${padLeft + idx * stepX + stepX / 2},${toY(b[key])}` : null))
        .filter(Boolean)
        .join(' ');
    const ma5Points = line('ma5');
    const ma20Points = line('ma20');
    const ma60Points = cur.count > 40 ? line('ma60') : '';
    const decimals = maxP < 50 ? 2 : 1;
    const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => ({
      val: (minP + range * t).toFixed(decimals),
      y: padTop + priceH * (1 - t),
    }));
    const hoverCx = padLeft + activeIdx * stepX + stepX / 2;
    const hoverCy = toY(activeBar.close);
    const candleW = Math.max(stepX * 0.6, 0.8);
    const labelEvery = Math.max(Math.floor(bars.length / 6), 1);
    const atLatest = cur.offset === 0;

    const btn = 'px-2 py-0.5 text-[11px] font-mono rounded-md transition cursor-pointer';
    const chart = (
      <div
        className={`bg-slate-950/95 border border-slate-800 rounded-xl p-4 space-y-3 ${
          expanded ? 'fixed inset-2 md:inset-6 z-50 overflow-auto shadow-2xl' : ''
        }`}
      >
        {/* 頂部工具列：範圍、縮放、放大 + 圖例 */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-slate-300">
              互動式還權 K 線與成交量副圖
            </span>
            <div className="flex items-center bg-slate-900 border border-slate-800 rounded-lg p-0.5">
              {RANGE_PRESETS.map(([label, n]) => {
                const count = Math.min(
                  total,
                  n === Infinity ? total : unit === '週' ? Math.ceil(n / 5) : n,
                );
                return (
                  <button
                    type="button"
                    key={label}
                    onClick={() => setView({ count, offset: 0 })}
                    className={`${btn} ${
                      cur.count === count && atLatest
                        ? 'bg-sky-600 text-white font-bold'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center bg-slate-900 border border-slate-800 rounded-lg p-0.5">
              <button
                type="button"
                aria-label="放大（顯示較少 K 棒）"
                onClick={() => zoomAt(1 / 1.4)}
                className={`${btn} text-slate-300 hover:text-white`}
              >
                ＋
              </button>
              <button
                type="button"
                aria-label="縮小（顯示較多 K 棒）"
                onClick={() => zoomAt(1.4)}
                className={`${btn} text-slate-300 hover:text-white`}
              >
                －
              </button>
              <button
                type="button"
                aria-label="回到最新"
                onClick={() => setView((v) => ({ ...v, offset: 0 }))}
                disabled={atLatest}
                className={`${btn} text-slate-300 hover:text-white disabled:opacity-40 disabled:cursor-default`}
              >
                ⇥ 最新
              </button>
              <button
                type="button"
                aria-label={expanded ? '關閉全螢幕' : '全螢幕放大'}
                onClick={() => setExpanded(!expanded)}
                className={`${btn} text-slate-300 hover:text-white`}
              >
                {expanded ? '✕ 關閉' : '⛶ 放大'}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-3 text-[11px] font-mono">
            <span className="flex items-center gap-1 text-amber-300">
              <span className="w-3 h-0.5 bg-amber-400 inline-block" /> MA5
            </span>
            <span className="flex items-center gap-1 text-sky-300">
              <span className="w-3 h-0.5 bg-sky-400 inline-block" /> MA20
            </span>
            {ma60Points && (
              <span className="flex items-center gap-1 text-violet-300">
                <span className="w-3 h-0.5 bg-violet-400 inline-block" /> MA60
              </span>
            )}
            <span className="flex items-center gap-1 text-emerald-400">
              <span className="w-3 h-0.5 border-b border-dashed border-emerald-400 inline-block" />{' '}
              支撐
            </span>
            <span className="flex items-center gap-1 text-rose-400">
              <span className="w-3 h-0.5 border-b border-dashed border-rose-400 inline-block" />{' '}
              壓力
            </span>
          </div>
        </div>

        {/* 十字準星 OHLCV 資訊條 */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 bg-slate-900/90 border border-slate-800/90 rounded-lg px-3 py-2 text-xs font-mono">
          <span className="text-sky-300 font-bold">{activeBar.date}</span>
          {[
            ['開', activeBar.open],
            ['高', activeBar.high],
            ['低', activeBar.low],
            ['收', activeBar.close],
          ].map(([k, v]) => (
            <span key={k}>
              {k}:{' '}
              <strong className={isActiveUp ? 'text-rose-400' : 'text-emerald-400'}>{v}</strong>
            </span>
          ))}
          <span
            className={`px-1.5 py-0.5 rounded font-bold ${
              (activeBar.change_pct || 0) >= 0
                ? 'bg-rose-500/20 text-rose-300'
                : 'bg-emerald-500/20 text-emerald-300'
            }`}
          >
            {(activeBar.change_pct || 0) >= 0
              ? `▲ +${activeBar.change_pct || 0}%`
              : `▼ ${activeBar.change_pct || 0}%`}
          </span>
          <span className="text-slate-300">
            量: <strong>{(activeBar.volume || 0).toLocaleString()}</strong>
          </span>
          <span className="text-amber-300">MA5: {activeBar.ma5 ?? '-'}</span>
          <span className="text-sky-300">MA20: {activeBar.ma20 ?? '-'}</span>
          {activeBar.ma60 != null && (
            <span className="text-violet-300">MA60: {activeBar.ma60}</span>
          )}
        </div>

        <svg
          ref={svgRef}
          viewBox={`0 0 ${width} ${height}`}
          className={`w-full ${expanded ? 'h-[calc(100vh-14rem)] min-h-[420px]' : 'h-72'} select-none touch-none ${
            drag.current ? 'cursor-grabbing' : 'cursor-crosshair'
          }`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={() => setHoverIdx(null)}
          onDoubleClick={() => setView({ count: barCount, offset: 0 })}
        >
          <title>互動式 K 線與成交量副圖（滾輪縮放、拖曳平移、雙擊還原）</title>
          {yTicks.map((tk) => (
            <g key={tk.y}>
              <line
                x1={padLeft}
                y1={tk.y}
                x2={width - padRight}
                y2={tk.y}
                stroke="#1e293b"
                strokeWidth="1"
              />
              <text
                x={padLeft - 6}
                y={tk.y + 4}
                textAnchor="end"
                fill="#64748b"
                fontSize="10"
                fontFamily="monospace"
              >
                {tk.val}
              </text>
            </g>
          ))}
          <line
            x1={padLeft}
            y1={volTop - 6}
            x2={width - padRight}
            y2={volTop - 6}
            stroke="#334155"
            strokeWidth="1"
          />
          <text
            x={padLeft - 6}
            y={volTop + 10}
            textAnchor="end"
            fill="#64748b"
            fontSize="9.5"
            fontFamily="monospace"
          >
            VOL
          </text>

          {levelsS.map((v) => (
            <g key={`sup-${v}`}>
              <line
                x1={padLeft}
                y1={toY(v)}
                x2={width - padRight}
                y2={toY(v)}
                stroke="#10b981"
                strokeWidth="1"
                strokeDasharray="4 4"
                opacity="0.7"
              />
              <text
                x={width - padRight + 4}
                y={toY(v) + 3}
                fill="#34d399"
                fontSize="9.5"
                fontFamily="monospace"
              >
                S:{v}
              </text>
            </g>
          ))}
          {levelsR.map((v) => (
            <g key={`res-${v}`}>
              <line
                x1={padLeft}
                y1={toY(v)}
                x2={width - padRight}
                y2={toY(v)}
                stroke="#f43f5e"
                strokeWidth="1"
                strokeDasharray="4 4"
                opacity="0.7"
              />
              <text
                x={width - padRight + 4}
                y={toY(v) + 3}
                fill="#fb7185"
                fontSize="9.5"
                fontFamily="monospace"
              >
                R:{v}
              </text>
            </g>
          ))}

          {bars.map((b, idx) => {
            const cx = padLeft + idx * stepX + stepX / 2;
            const color = b.close >= b.open ? '#ef4444' : '#10b981';
            const topY = toY(Math.max(b.open, b.close));
            const bodyH = Math.max(toY(Math.min(b.open, b.close)) - topY, 1);
            const vY = toVolY(b.volume || 0);
            const isHovered = idx === activeIdx;
            return (
              <g key={b.date}>
                {isHovered && (
                  <rect
                    x={padLeft + idx * stepX}
                    y={padTop}
                    width={stepX}
                    height={volTop + volH - padTop}
                    fill="#38bdf8"
                    opacity="0.08"
                  />
                )}
                <line
                  x1={cx}
                  y1={toY(b.high)}
                  x2={cx}
                  y2={toY(b.low)}
                  stroke={color}
                  strokeWidth={isHovered ? 1.8 : stepX < 3 ? 0.8 : 1.2}
                />
                <rect
                  x={cx - candleW / 2}
                  y={topY}
                  width={candleW}
                  height={bodyH}
                  fill={color}
                  rx={stepX > 6 ? 1 : 0}
                />
                <rect
                  x={cx - candleW / 2}
                  y={vY}
                  width={candleW}
                  height={Math.max(volTop + volH - vY, 1)}
                  fill={color}
                  opacity={isHovered ? 0.95 : 0.5}
                />
                {idx % labelEvery === 0 && (
                  <text
                    x={cx}
                    y={height - 6}
                    textAnchor="middle"
                    fill="#64748b"
                    fontSize="9.5"
                    fontFamily="monospace"
                  >
                    {cur.count > 250 ? b.date.slice(0, 7) : b.date.slice(5)}
                  </text>
                )}
              </g>
            );
          })}

          <line
            x1={hoverCx}
            y1={padTop}
            x2={hoverCx}
            y2={volTop + volH}
            stroke="#94a3b8"
            strokeWidth="1"
            strokeDasharray="3 3"
            opacity="0.75"
            pointerEvents="none"
          />
          <line
            x1={padLeft}
            y1={hoverCy}
            x2={width - padRight}
            y2={hoverCy}
            stroke="#94a3b8"
            strokeWidth="1"
            strokeDasharray="3 3"
            opacity="0.75"
            pointerEvents="none"
          />
          {ma60Points && (
            <polyline
              fill="none"
              stroke="#a78bfa"
              strokeWidth="1.5"
              points={ma60Points}
              opacity="0.85"
              pointerEvents="none"
            />
          )}
          {ma20Points && (
            <polyline
              fill="none"
              stroke="#38bdf8"
              strokeWidth="1.8"
              points={ma20Points}
              opacity="0.9"
              pointerEvents="none"
            />
          )}
          {ma5Points && (
            <polyline
              fill="none"
              stroke="#fbbf24"
              strokeWidth="1.8"
              points={ma5Points}
              opacity="0.95"
              pointerEvents="none"
            />
          )}
        </svg>

        {/* 目前顯示範圍＋全部資料的位置條 */}
        <div className="space-y-1">
          <div className="relative h-1.5 bg-slate-800 rounded-full">
            <div
              className="absolute h-1.5 bg-sky-500/70 rounded-full"
              style={{ left: `${(start / total) * 100}%`, width: `${(cur.count / total) * 100}%` }}
            />
          </div>
          <div className="flex flex-wrap justify-between gap-2 text-[10px] text-slate-500">
            <span>
              顯示 {bars[0]?.date} ～ {bars[bars.length - 1]?.date}（{cur.count} 根{unit} K，共{' '}
              {total} 根）
            </span>
            <span>
              滾輪縮放・拖曳左右平移・手機兩指縮放・雙擊還原{expanded ? '・Esc 關閉' : ''}
            </span>
          </div>
        </div>
      </div>
    );
    return expanded ? (
      <>
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: 背景點擊關閉，Esc 也可關閉 */}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: 全螢幕背景 */}
        <div className="fixed inset-0 z-40 bg-black/70" onClick={() => setExpanded(false)} />
        {chart}
      </>
    ) : (
      chart
    );
  }

  /**
   * 策略回測 累積淨值曲線 SVG 圖表
   */
  function EquityCurveChart({ curve, initialCapital }) {
    if (!curve || curve.length < 2) return null;

    const width = 720;
    const height = 210;
    const padL = 65;
    const padR = 25;
    const padT = 20;
    const padB = 30;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;

    const eqs = curve.map((c) => c.equity);
    const minE = Math.min(...eqs, initialCapital) * 0.995;
    const maxE = Math.max(...eqs, initialCapital) * 1.005;
    const range = Math.max(maxE - minE, 1);

    const toX = (idx) => padL + (idx / (curve.length - 1)) * plotW;
    const toY = (val) => padT + plotH - ((val - minE) / range) * plotH;

    const polyPoints = curve.map((c, idx) => `${toX(idx)},${toY(c.equity)}`).join(' ');
    const baseLineY = toY(initialCapital);

    return (
      <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-slate-300">
            策略累積淨值曲線 (Equity Curve — 已扣除雙市場真實手續費與證交稅)
          </span>
          <span className="text-[11px] font-mono text-slate-400">
            初始本金: {initialCapital.toLocaleString()}
          </span>
        </div>
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-48 overflow-visible">
          <title>策略累積淨值曲線</title>
          <line
            x1={padL}
            y1={baseLineY}
            x2={width - padR}
            y2={baseLineY}
            stroke="#475569"
            strokeDasharray="4 4"
            strokeWidth="1"
          />
          <text
            x={padL - 6}
            y={baseLineY + 3}
            textAnchor="end"
            fill="#94a3b8"
            fontSize="9.5"
            fontFamily="monospace"
          >
            本金基準
          </text>
          <polyline fill="none" stroke="#38bdf8" strokeWidth="2.5" points={polyPoints} />
          {curve.map((c, idx) => (
            <g key={c.step}>
              <circle
                cx={toX(idx)}
                cy={toY(c.equity)}
                r="4"
                fill={c.equity >= initialCapital ? '#10b981' : '#f43f5e'}
                stroke="#0f172a"
                strokeWidth="1.5"
              />
              <text
                x={toX(idx)}
                y={toY(c.equity) - 8}
                textAnchor="middle"
                fill="#e2e8f0"
                fontSize="9"
                fontFamily="monospace"
              >
                {Math.round(c.equity).toLocaleString()}
              </text>
              <text
                x={toX(idx)}
                y={height - 8}
                textAnchor="middle"
                fill="#64748b"
                fontSize="9"
                fontFamily="monospace"
              >
                {c.step === 0 ? '起點' : `#${c.step}`}
              </text>
            </g>
          ))}
        </svg>
      </div>
    );
  }

  window.TA = Object.assign(window.TA || {}, { CandlestickChart, EquityCurveChart });
})();
