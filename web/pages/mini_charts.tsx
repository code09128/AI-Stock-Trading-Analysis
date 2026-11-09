// 小圖表：圓餅（甜甜圈）、橫條、直條、散布圖、迷你長條。純 SVG／HTML，沒有外部套件；只畫傳進來的數字，不補假資料
// 有座標字的圖都依卡片實際寬度重畫（useChartWidth），卡片加寬時字維持原大小
import { useChartWidth } from '../live_widgets';

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
  const [boxRef, W] = useChartWidth(320);
  const pts = dots.filter((d) => Number.isFinite(d.x) && Number.isFinite(d.y));
  if (pts.length < 2) return null;
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
    <svg ref={boxRef} width="100%" height={H} viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label={label}>
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

// 直條（支援正負值與零軸）：三大法人、外資 10 日、壓力測試、每筆交易報酬、歷年股利等
type VBar = { label: string; value: number; color?: string };
function VBars({ items, height = 150, unit = '', label }: { items: VBar[]; height?: number; unit?: string; label?: string }) {
  const [boxRef, W] = useChartWidth(320);
  if (!items?.length) return null;
  const vals = items.map((i) => Number(i.value) || 0);
  const min = Math.min(0, ...vals);
  const max = Math.max(0, ...vals);
  const span = max - min || 1;
  const H = height;
  const p = 24;
  const pb = 34; // 下方要放負值的數字和標籤
  const plotH = H - p - pb;
  const zeroY = p + ((max - 0) / span) * plotH;
  const slot = (W - p * 2) / items.length;
  const bw = Math.max(6, Math.min(44, slot - 8));
  // 格子太窄時數字疊在一起：改成滑鼠停上去看（<title>），下方標籤隔幾個才顯示
  const showVal = slot >= 40;
  const labelStep = Math.max(1, Math.ceil(36 / slot));
  return (
    <svg ref={boxRef} width="100%" height={H} viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label={label || '直條圖'}>
      <line x1={p} x2={W - p} y1={zeroY} y2={zeroY} stroke="rgba(255,255,255,.18)" />
      {items.map((it, idx) => {
        const v = Number(it.value) || 0;
        const x = p + idx * slot + (slot - bw) / 2;
        const y = v >= 0 ? p + ((max - v) / span) * plotH : zeroY;
        const h = Math.max(2, (Math.abs(v) / span) * plotH);
        const c = it.color || (v >= 0 ? 'var(--up)' : 'var(--down)');
        return (
          <g key={`${it.label}-${idx}`}>
            <rect x={x} y={y} width={bw} height={h} rx="4" fill={c} opacity=".88">
              <title>{`${it.label}: ${v >= 0 ? '+' : ''}${v}${unit}`}</title>
            </rect>
            {showVal && (
              <text x={x + bw / 2} y={v >= 0 ? Math.max(11, y - 4) : Math.min(H - 14, y + h + 11)} textAnchor="middle" fontSize="10" fill="#e8ebf4" className="mono">
                {v >= 0 ? `+${v}` : v}
                {unit}
              </text>
            )}
            {idx % labelStep === 0 && (
              <text x={x + bw / 2} y={H - 5} textAnchor="middle" fontSize="10" fill="#8a93a8">
                {it.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// 多折線／面積圖：累積報酬、存股資產成長、生命週期等
type LineSeries = { name: string; values: number[]; color?: string; fill?: boolean; dash?: string };
function LinesChart({
  series,
  labels = [],
  height = 180,
  unit = '',
  zeroLine = false,
  label,
}: {
  series: LineSeries[];
  labels?: string[];
  height?: number;
  unit?: string;
  zeroLine?: boolean;
  label?: string;
}) {
  const [boxRef, W] = useChartWidth(520);
  const valid = (series || []).filter((s) => Array.isArray(s.values) && s.values.length >= 2);
  if (!valid.length) return null;
  const all = valid.flatMap((s) => s.values.filter((v) => Number.isFinite(v)));
  if (all.length < 2) return null;
  const H = height;
  const pl = 46;
  const pr = 14;
  const pt = 14;
  const pb = 24;
  let min = Math.min(...all);
  let max = Math.max(...all);
  if (zeroLine) {
    min = Math.min(0, min);
    max = Math.max(0, max);
  }
  const span = max - min || 1;
  const xAt = (i: number, n: number) => pl + (i / Math.max(1, n - 1)) * (W - pl - pr);
  const yAt = (v: number) => pt + ((max - v) / span) * (H - pt - pb);
  const ticks = [0, 0.5, 1].map((t) => min + (max - min) * t);
  const n0 = valid[0].values.length;
  const step = Math.max(1, Math.floor(labels.length / 5));
  return (
    <div>
      <svg ref={boxRef} width="100%" height={H} viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label={label || '折線圖'}>
        {ticks.map((v) => {
          const y = yAt(v);
          return (
            <g key={v}>
              <line x1={pl} x2={W - pr} y1={y} y2={y} stroke="rgba(255,255,255,.06)" />
              <text x={pl - 5} y={y + 3} textAnchor="end" fontSize="9.5" fill="#8a93a8" className="mono">
                {Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(0)}k` : Math.abs(max - min) < 10 ? v.toFixed(1) : v.toFixed(0)}
                {unit}
              </text>
            </g>
          );
        })}
        {zeroLine && min < 0 && max > 0 && <line x1={pl} x2={W - pr} y1={yAt(0)} y2={yAt(0)} stroke="rgba(255,255,255,.22)" strokeDasharray="3 3" />}
        {valid.map((s, si) => {
          const c = s.color || PALETTE[si % PALETTE.length];
          const pts = s.values.map((v, i) => `${xAt(i, s.values.length).toFixed(1)},${yAt(v).toFixed(1)}`).join(' ');
          const area = s.fill ? `M${pl},${H - pb} L${pts.replace(/ /g, ' L')} L${W - pr},${H - pb} Z` : '';
          return (
            <g key={s.name}>
              {s.fill && <path d={area} fill={c} opacity=".14" />}
              <polyline fill="none" stroke={c} strokeWidth="2.2" strokeDasharray={s.dash || ''} points={pts} />
            </g>
          );
        })}
        {labels.map((lb, i) =>
          i % step === 0 || i === labels.length - 1 ? (
            <text key={`${lb}-${i}`} x={xAt(i, n0)} y={H - 6} textAnchor="middle" fontSize="9.5" fill="#8a93a8">
              {lb}
            </text>
          ) : null,
        )}
      </svg>
      {valid.length > 1 && (
        <div className="flex flex-wrap gap-3 text-xs text-slate-400 mt-1">
          {valid.map((s, si) => (
            <span key={s.name}>
              <i className="inline-block w-2.5 h-2.5 rounded-full mr-1" style={{ background: s.color || PALETTE[si % PALETTE.length] }} />
              {s.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// 相關係數矩陣：輸入兩兩配對 pairs [{a, b, r}]，轉成對稱方陣熱力表；沒有算過的配對（不同市場）顯示「—」，不是 0
function HeatMat({ pairs }: { pairs: { a: string; b: string; r: number }[] }) {
  if (!pairs?.length) return null;
  const names = Array.from(new Set(pairs.flatMap((p) => [p.a, p.b])));
  if (names.length < 2) return null;
  const map = new Map<string, number>();
  for (const p of pairs) {
    map.set(`${p.a}|${p.b}`, p.r);
    map.set(`${p.b}|${p.a}`, p.r);
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="text-slate-400 border-b border-white/10">
            <th className="py-1.5 px-2 text-left font-normal">標的</th>
            {names.map((n) => (
              <th key={n} className="py-1.5 px-2 text-right font-normal mono">
                {n}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {names.map((rName, i) => (
            <tr key={rName} className="border-b border-white/5">
              <td className="py-1.5 px-2 font-bold mono text-slate-200">{rName}</td>
              {names.map((cName, j) => {
                const v = i === j ? 1 : (map.get(`${rName}|${cName}`) ?? null);
                const bg =
                  i === j || v === null
                    ? 'rgba(255,255,255,.06)'
                    : v >= 0.7
                      ? 'rgba(255,77,109,.28)'
                      : v >= 0.4
                        ? 'rgba(251,191,36,.20)'
                        : v < 0
                          ? 'rgba(34,211,160,.20)'
                          : 'rgba(79,124,255,.15)';
                return (
                  <td key={cName} className="py-1.5 px-2 text-right mono text-slate-100" style={{ background: bg }} title={v === null ? '不同市場的持股沒有比較' : undefined}>
                    {v === null ? '—' : v.toFixed(2)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export { Donut, HBars, HeatMat, LinesChart, MiniBars, Scatter, VBars, topSlices, PALETTE };
