// 小圖表：圓餅（甜甜圈）、橫條、直條、散布圖、迷你長條。純 SVG／HTML，沒有外部套件；只畫傳進來的數字，不補假資料
const PALETTE = ['#4f7cff', '#8b5cf6', '#22d3a0', '#fbbf24', '#fb7185', '#38bdf8', '#f97316', '#a3e635', '#e879f9', '#94a3b8'];

type Slice = { label: string; value: number; color?: string };

// 前 maxN 名各自一塊，其餘合併成「其他」；值 ≤ 0 的不畫
function topSlices(items: Slice[], maxN = 6): Slice[] {
  const pos = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  const head = pos.slice(0, maxN);
  const rest = pos.slice(maxN).reduce((a, i) => a + i.value, 0);
  const out = rest > 0 ? [...head, { label: '其他', value: rest }] : head;
  return out.map((s, i) => ({ ...s, color: s.color || PALETTE[i % PALETTE.length] }));
}

function Donut({ items, center, sub, label, size = 112 }: { items: Slice[]; center?: string; sub?: string; label: string; size?: number }) {
  const shown = items.filter((i) => i.value > 0);
  const total = shown.reduce((a, i) => a + i.value, 0);
  if (!(total > 0)) return null;
  const R = size / 2 - 16;
  const C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <div className="flex flex-wrap items-center gap-3.5">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} className="shrink-0">
        {shown.map((s, i) => {
          const len = (s.value / total) * C;
          const el = (
            <circle
              key={s.label}
              cx={size / 2}
              cy={size / 2}
              r={R}
              fill="none"
              stroke={s.color || PALETTE[i % PALETTE.length]}
              strokeWidth="18"
              strokeDasharray={`${Math.max(0, len - 1.5)} ${C}`}
              strokeDashoffset={-acc}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            >
              <title>{`${s.label} ${((s.value / total) * 100).toFixed(1)}%`}</title>
            </circle>
          );
          acc += len;
          return el;
        })}
        {center && (
          <text x="50%" y="49%" textAnchor="middle" fill="#e8ebf4" fontSize={size / 9} fontWeight="700">
            {center}
          </text>
        )}
        {sub && (
          <text x="50%" y="63%" textAnchor="middle" fill="#8a93a8" fontSize={size / 14}>
            {sub}
          </text>
        )}
      </svg>
      <div className="flex flex-col gap-[3px] text-xs text-slate-400 min-w-0">
        {shown.map((s, i) => (
          <span key={s.label} className="truncate">
            <i className="inline-block w-[9px] h-[9px] rounded-full mr-[5px]" style={{ background: s.color || PALETTE[i % PALETTE.length] }} />
            {s.label} <b className="mono text-slate-300">{((s.value / total) * 100).toFixed(0)}%</b>
          </span>
        ))}
      </div>
    </div>
  );
}

// 橫條：標籤＋長條＋數字；正值紅、負值綠（可用 color 指定），點一下回呼 onPick
type Bar = { label: string; value: number; color?: string; id?: string };
function HBars({ items, format, onPick, plain }: { items: Bar[]; format: (v: number) => string; onPick?: (id: string) => void; plain?: boolean }) {
  const mx = Math.max(...items.map((x) => Math.abs(x.value)), 1e-9);
  return (
    <div className="grid gap-[5px]">
      {items.map((x) => {
        const body = (
          <>
            <span className="truncate text-left">{x.label}</span>
            <span className="h-[9px] rounded-full bg-white/5 overflow-hidden">
              <i
                className="block h-full rounded-full"
                style={{ width: `${Math.max(2, (Math.abs(x.value) / mx) * 100)}%`, background: x.color || (x.value >= 0 ? 'var(--up)' : 'var(--down)') }}
              />
            </span>
            <b className="mono text-right" style={plain ? undefined : { color: x.value > 0 ? 'var(--up)' : x.value < 0 ? 'var(--down)' : undefined }}>
              {format(x.value)}
            </b>
          </>
        );
        const cls = 'grid grid-cols-[84px_1fr_68px] gap-2 items-center text-[12.5px] rounded-lg px-1 py-px';
        return onPick && x.id ? (
          <button type="button" key={x.label} onClick={() => onPick(x.id)} className={`${cls} w-full hover:bg-white/5 cursor-pointer`}>
            {body}
          </button>
        ) : (
          <div key={x.label} className={cls}>
            {body}
          </div>
        );
      })}
    </div>
  );
}

// 直條：配息月份、近幾年股利這類數量少的資料
function MiniBars({ items, format }: { items: { label: string; value: number }[]; format: (v: number) => string }) {
  const mx = Math.max(...items.map((x) => x.value), 1e-9);
  return (
    <div className="flex items-end gap-2 h-[90px] mt-1.5">
      {items.map((x) => (
        <div key={x.label} className="flex-1 min-w-0 h-full flex flex-col justify-end items-center gap-[3px] text-[11px] text-slate-400">
          <span className="mono truncate">{format(x.value)}</span>
          <i
            className="block w-full rounded-t-md rounded-b-sm bg-gradient-to-b from-[#4f7cff] to-[#8b5cf6]"
            style={{ height: `${Math.max(2, (x.value / mx) * 60)}%` }}
          />
          <span className="truncate">{x.label}</span>
        </div>
      ))}
    </div>
  );
}

// 散布圖：點一下圓點回呼 onPick(id)。只畫兩個值都有的點
type Dot = { id: string; label: string; x: number; y: number; color: string };
function Scatter({ dots, onPick, activeId, label, xLabel, yLabel, x0, x1 }: { dots: Dot[]; onPick?: (id: string) => void; activeId?: string; label: string; xLabel: string; yLabel: string; x0?: number; x1?: number }) {
  const pts = dots.filter((d) => Number.isFinite(d.x) && Number.isFinite(d.y));
  if (pts.length < 2) return null;
  const W = 320;
  const H = 200;
  const pl = 34;
  const pb = 22;
  const pt = 8;
  const pr = 10;
  const xmin = x0 ?? Math.min(...pts.map((d) => d.x));
  const xmax = x1 ?? Math.max(...pts.map((d) => d.x));
  const ymin = Math.min(-5, ...pts.map((d) => d.y)) - 1;
  const ymax = Math.max(5, ...pts.map((d) => d.y)) + 1;
  const px = (v: number) => pl + ((v - xmin) / (xmax - xmin || 1)) * (W - pl - pr);
  const py = (v: number) => pt + ((ymax - v) / (ymax - ymin || 1)) * (H - pt - pb);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block" role="img" aria-label={label}>
      <line x1={pl} x2={W - pr} y1={H - pb} y2={H - pb} stroke="rgba(255,255,255,.2)" />
      <line x1={pl} x2={pl} y1={pt} y2={H - pb} stroke="rgba(255,255,255,.2)" />
      <text x={W - pr} y={H - 6} textAnchor="end" fill="#8a93a8" fontSize="10">
        {xLabel}
      </text>
      <text x={pl + 2} y={pt + 9} fill="#8a93a8" fontSize="10">
        {yLabel}
      </text>
      {pts.map((d) => (
        // biome-ignore lint/a11y/useSemanticElements: SVG 圓點不能用 button；補上 role 與鍵盤操作
        <g
          key={d.id}
          role="button"
          tabIndex={0}
          aria-label={`${d.label}：${xLabel} ${d.x.toFixed(0)}、${yLabel} ${d.y.toFixed(1)}`}
          onClick={() => onPick?.(d.id)}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onPick?.(d.id)}
          className="cursor-pointer"
        >
          <circle cx={px(d.x)} cy={py(d.y)} r={d.id === activeId ? 6 : 5} fill={d.color} opacity=".85" stroke={d.id === activeId ? '#fff' : 'none'} />
          <text x={px(d.x) + 7} y={py(d.y) + 3} fontSize="9" fill="#e8ebf4">
            {d.label}
          </text>
          <title>{d.label}</title>
        </g>
      ))}
    </svg>
  );
}

export { Donut, HBars, MiniBars, Scatter, topSlices, PALETTE };
