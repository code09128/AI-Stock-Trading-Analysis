(() => {
  const { useState } = React;
  const { BAR_ZOOM_OPTIONS } = window.TA;

  function CandlestickChart({
    bars,
    supports,
    resistances,
    barCount,
    onChangeBarCount,
    unit = '日',
  }) {
    const [hoverIdx, setHoverIdx] = useState(null);

    if (!bars || bars.length === 0) return null;

    const activeIdx = hoverIdx !== null && hoverIdx < bars.length ? hoverIdx : bars.length - 1;
    const activeBar = bars[activeIdx];
    const isActiveUp = activeBar.close >= activeBar.open;

    const width = 780;
    const height = 340;
    const padLeft = 56;
    const padRight = 60;
    const padTop = 18;
    const priceH = 215;
    const volTop = padTop + priceH + 22;
    const volH = 58;
    const plotW = width - padLeft - padRight;

    const allPrices = [];
    let maxVol = 1;
    for (const b of bars) {
      allPrices.push(b.high, b.low);
      if (b.ma5) allPrices.push(b.ma5);
      if (b.ma20) allPrices.push(b.ma20);
      if (b.volume > maxVol) maxVol = b.volume;
    }
    for (const s of supports || []) allPrices.push(s);
    for (const r of resistances || []) allPrices.push(r);

    const minP = Math.min(...allPrices) * 0.992;
    const maxP = Math.max(...allPrices) * 1.008;
    const range = Math.max(maxP - minP, 0.01);

    const toY = (price) => padTop + priceH - ((price - minP) / range) * priceH;
    const toVolY = (vol) => volTop + volH - (vol / maxVol) * volH;
    const stepX = plotW / bars.length;

    const ma5Points = bars
      .map((b, idx) => (b.ma5 ? `${padLeft + idx * stepX + stepX / 2},${toY(b.ma5)}` : null))
      .filter(Boolean)
      .join(' ');

    const ma20Points = bars
      .map((b, idx) => (b.ma20 ? `${padLeft + idx * stepX + stepX / 2},${toY(b.ma20)}` : null))
      .filter(Boolean)
      .join(' ');

    const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => ({
      val: (minP + range * t).toFixed(1),
      y: padTop + priceH * (1 - t),
    }));

    const hoverCx = padLeft + activeIdx * stepX + stepX / 2;
    const hoverCy = toY(activeBar.close);

    return (
      <div className="bg-slate-950/95 border border-slate-800 rounded-xl p-4 space-y-3">
        {/* 頂部工具列：K棒根數縮放 + 圖例 */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-300">
              📊 互動式還權 K 線與成交量副圖
            </span>
            <div className="flex items-center bg-slate-900 border border-slate-800 rounded-lg p-0.5">
              {BAR_ZOOM_OPTIONS.map((cnt) => (
                <button
                  type="button"
                  key={cnt}
                  onClick={() => onChangeBarCount(cnt)}
                  className={`px-2 py-0.5 text-[11px] font-mono rounded-md transition cursor-pointer ${
                    barCount === cnt
                      ? 'bg-sky-600 text-white font-bold'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {cnt}
                  {unit}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-4 text-[11px] font-mono">
            <span className="flex items-center gap-1 text-amber-300">
              <span className="w-3 h-0.5 bg-amber-400 inline-block" /> MA5
            </span>
            <span className="flex items-center gap-1 text-sky-300">
              <span className="w-3 h-0.5 bg-sky-400 inline-block" /> MA20
            </span>
            <span className="flex items-center gap-1 text-emerald-400">
              <span className="w-3 h-0.5 border-b border-dashed border-emerald-400 inline-block" />{' '}
              支撐位
            </span>
            <span className="flex items-center gap-1 text-rose-400">
              <span className="w-3 h-0.5 border-b border-dashed border-rose-400 inline-block" />{' '}
              壓力位
            </span>
          </div>
        </div>

        {/* 動態十字準星 OHLCV 即時報價資訊條 */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 bg-slate-900/90 border border-slate-800/90 rounded-lg px-3 py-2 text-xs font-mono">
          <span className="text-sky-300 font-bold">📅 {activeBar.date}</span>
          <span>
            開:{' '}
            <strong className={isActiveUp ? 'text-rose-400' : 'text-emerald-400'}>
              {activeBar.open}
            </strong>
          </span>
          <span>
            高:{' '}
            <strong className={isActiveUp ? 'text-rose-400' : 'text-emerald-400'}>
              {activeBar.high}
            </strong>
          </span>
          <span>
            低:{' '}
            <strong className={isActiveUp ? 'text-rose-400' : 'text-emerald-400'}>
              {activeBar.low}
            </strong>
          </span>
          <span>
            收:{' '}
            <strong className={isActiveUp ? 'text-rose-400' : 'text-emerald-400'}>
              {activeBar.close}
            </strong>
          </span>
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
        </div>

        {/* SVG 互動式畫布 */}
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-72 overflow-visible select-none"
          onMouseLeave={() => setHoverIdx(null)}
        >
          <title>互動式 K 線與成交量副圖</title>
          {/* 價格水平格線 */}
          {yTicks.map((tk) => (
            <g key={tk.val}>
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

          {/* 成交量副圖分隔線與標籤 */}
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

          {/* 支撐虛線 */}
          {(supports || []).map((s) => (
            <g key={`sup-${s}`}>
              <line
                x1={padLeft}
                y1={toY(s)}
                x2={width - padRight}
                y2={toY(s)}
                stroke="#10b981"
                strokeWidth="1"
                strokeDasharray="4 4"
                opacity="0.7"
              />
              <text
                x={width - padRight + 4}
                y={toY(s) + 3}
                fill="#34d399"
                fontSize="9.5"
                fontFamily="monospace"
              >
                S:{s}
              </text>
            </g>
          ))}

          {/* 壓力虛線 */}
          {(resistances || []).map((r) => (
            <g key={`res-${r}`}>
              <line
                x1={padLeft}
                y1={toY(r)}
                x2={width - padRight}
                y2={toY(r)}
                stroke="#f43f5e"
                strokeWidth="1"
                strokeDasharray="4 4"
                opacity="0.7"
              />
              <text
                x={width - padRight + 4}
                y={toY(r) + 3}
                fill="#fb7185"
                fontSize="9.5"
                fontFamily="monospace"
              >
                R:{r}
              </text>
            </g>
          ))}

          {/* 十字準星垂直線與水平線 */}
          <line
            x1={hoverCx}
            y1={padTop}
            x2={hoverCx}
            y2={volTop + volH}
            stroke="#94a3b8"
            strokeWidth="1"
            strokeDasharray="3 3"
            opacity="0.75"
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
          />

          {/* K 線蠟燭與成交量柱狀體 */}
          {bars.map((b, idx) => {
            const cx = padLeft + idx * stepX + stepX / 2;
            const isUp = b.close >= b.open;
            const color = isUp ? '#ef4444' : '#10b981';
            const topY = toY(Math.max(b.open, b.close));
            const botY = toY(Math.min(b.open, b.close));
            const bodyH = Math.max(botY - topY, 2);
            const candleW = Math.max(stepX * 0.6, 3);
            const vY = toVolY(b.volume || 0);
            const vH = Math.max(volTop + volH - vY, 1.5);
            const isHovered = idx === activeIdx;

            return (
              <g key={b.date}>
                {/* 高亮選中背景帶 */}
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
                {/* 上下影線 */}
                <line
                  x1={cx}
                  y1={toY(b.high)}
                  x2={cx}
                  y2={toY(b.low)}
                  stroke={color}
                  strokeWidth={isHovered ? '1.8' : '1.2'}
                />
                {/* 實體蠟燭 */}
                <rect
                  x={cx - candleW / 2}
                  y={topY}
                  width={candleW}
                  height={bodyH}
                  fill={color}
                  rx="1"
                />
                {/* 成交量柱 */}
                <rect
                  x={cx - candleW / 2}
                  y={vY}
                  width={candleW}
                  height={vH}
                  fill={color}
                  opacity={isHovered ? '0.95' : '0.5'}
                  rx="1"
                />
                {/* X 軸日期標籤 */}
                {idx % Math.max(Math.floor(bars.length / 6), 3) === 0 && (
                  <text
                    x={cx}
                    y={height - 6}
                    textAnchor="middle"
                    fill="#64748b"
                    fontSize="9.5"
                    fontFamily="monospace"
                  >
                    {b.date.slice(5)}
                  </text>
                )}
                {/* 透明滑鼠感應區 */}
                {/* biome-ignore lint/a11y/noStaticElementInteractions: SVG crosshair hover sensor */}
                <rect
                  x={padLeft + idx * stepX}
                  y={padTop}
                  width={stepX}
                  height={volTop + volH - padTop}
                  fill="transparent"
                  className="cursor-crosshair"
                  onMouseEnter={() => setHoverIdx(idx)}
                />
              </g>
            );
          })}

          {/* MA5 與 MA20 折線 */}
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
      </div>
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
            📈 策略累積淨值曲線 (Equity Curve — 已扣除雙市場真實手續費與證交稅)
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
