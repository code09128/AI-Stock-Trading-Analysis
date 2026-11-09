// 走勢卡：分時／5 日／日 K 三種模式。分時沿用原本的 IntradayChart（真實資料、休市提示、時區處理）；
// 5 日與日 K 只在切過去時才抓，舊版後端（線上更新只更新畫面）沒有 5 日路由時顯示原因，不用假資料補。
import { IntradayChart, useChartWidth } from '../live_widgets';
import { cachedJson } from '../fetch_cache';
import { Tip, fmt } from '../ui';

const { useState, useEffect } = React;

const MODES = [
  ['intra', '分時'],
  ['d5', '5 日'],
  ['k', '日 K'],
];
const H = 268;
const PAD_R = 62;
const PT = 8;
const PB = 62;
const VB = H - 4;

const useSeries = (url: string, symbol: string, on: boolean, n?: number) => {
  const [s, setS] = useState<any>(null);
  useEffect(() => {
    if (!on) return undefined;
    let stop = false;
    setS(null);
    cachedJson(url, n ? { symbol, n } : { symbol }, 60000)
      .then((d) => !stop && setS(d))
      .catch((e) => !stop && setS({ error: e.message }));
    return () => {
      stop = true;
    };
  }, [url, symbol, on, n]);
  return s;
};

const pctStr = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
const cls = (v: number) => (v > 0 ? 'text-rose-400' : v < 0 ? 'text-emerald-400' : 'text-slate-300');

function Empty({ text }: { text: string }) {
  return <div className="h-40 flex items-center justify-center text-xs text-slate-500 border border-dashed border-slate-700 rounded-xl">{text}</div>;
}

function FiveDay({ data }: { data: any }) {
  const [hover, setHover] = useState<number | null>(null);
  const [boxRef, W] = useChartWidth();
  const pts = data?.points || [];
  if (!data) return <Empty text="正在抓近 5 日走勢…" />;
  if (pts.length < 2) return <Empty text={`近 5 日走勢取得失敗：${data.error || '沒有資料'}`} />;
  const base = pts[0].close;
  const vals = pts.map((p: any) => p.close);
  const m = Math.max(Math.abs(Math.max(...vals) - base), Math.abs(Math.min(...vals) - base), base * 0.003) * 1.12;
  const plotW = W - PAD_R;
  const x = (i: number) => (i / (pts.length - 1)) * plotW;
  const y = (v: number) => PT + ((base + m - v) / (2 * m)) * (H - PT - 22);
  const line = pts.map((p: any, i: number) => `${x(i).toFixed(1)},${y(p.close).toFixed(1)}`).join(' ');
  const i = hover ?? pts.length - 1;
  const p = pts[i];
  const chg = (p.close / base - 1) * 100;
  const dayStart = (data.days || []).map((d: string) => pts.findIndex((q: any) => q.date === d));
  const up = vals[vals.length - 1] >= base;
  return (
    <div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400 my-2 min-h-5 mono">
        <span>
          {p.date} {p.t}
        </span>
        <span>
          價 <b className={cls(chg)}>{fmt(p.close)}</b>
        </span>
        <span className={cls(chg)}>{pctStr(chg)} vs 5 日前</span>
        <span>量 {fmt(p.volume, 0)}</span>
      </div>
      <svg
        ref={boxRef}
        width="100%"
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full block rounded-xl bg-black/20"
        role="img"
        aria-label="近 5 日走勢圖"
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          setHover(Math.max(0, Math.min(pts.length - 1, Math.round((px / plotW) * (pts.length - 1)))));
        }}
        onMouseLeave={() => setHover(null)}
      >
        <polyline points={line} fill="none" stroke={up ? 'var(--up)' : 'var(--down)'} strokeWidth="2" strokeLinejoin="round" />
        <line x1="0" x2={plotW} y1={y(base)} y2={y(base)} stroke="rgba(255,255,255,.55)" strokeDasharray="5 4" />
        <text x={plotW + 4} y={y(base) + 3} fontSize="10.5" fill="#fff">
          {fmt(base)}
        </text>
        {[base + m, base - m].map((v) => (
          <text key={v} x={plotW + 4} y={y(v) + 8} fontSize="10.5" fill="#8a93a8">
            {fmt(v)}
          </text>
        ))}
        {dayStart.map((si: number, k: number) => (
          <g key={data.days[k]}>
            <line x1={x(si)} x2={x(si)} y1={PT} y2={H - 22} stroke="rgba(255,255,255,.07)" />
            <text x={x(si) + 2} y={H - 6} fontSize="10.5" fill="#8a93a8">
              {data.days[k].slice(5)}
            </text>
          </g>
        ))}
        {hover != null && <line x1={x(i)} x2={x(i)} y1={PT} y2={H - 22} stroke="rgba(255,255,255,.4)" />}
        {hover != null && <circle cx={x(i)} cy={y(p.close)} r="4" fill="#fff" />}
      </svg>
      <div className="text-[11.5px] text-slate-400 mt-1.5">近 5 個交易日（{data.source}）；虛線是 5 日前第一筆的價格。</div>
    </div>
  );
}

function DailyK({ data }: { data: any }) {
  const [hover, setHover] = useState<number | null>(null);
  const [boxRef, W] = useChartWidth();
  const bars = data?.bars || [];
  if (!data) return <Empty text="正在抓日 K…" />;
  if (bars.length < 2) return <Empty text={`日 K 取得失敗：${data.error || '沒有資料'}`} />;
  const lo = Math.min(...bars.map((b: any) => b.low));
  const hi = Math.max(...bars.map((b: any) => b.high));
  const pad = (hi - lo) * 0.08;
  const mn = lo - pad;
  const mx = hi + pad;
  const plotW = W - PAD_R;
  const w = plotW / bars.length;
  const y = (v: number) => PT + ((mx - v) / (mx - mn)) * (H - PT - PB);
  const mv = Math.max(...bars.map((b: any) => b.volume), 1);
  const i = hover ?? bars.length - 1;
  const b = bars[i];
  const prev = bars[i - 1]?.close;
  return (
    <div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400 my-2 min-h-5 mono">
        <span>{b.date}</span>
        <span>開 {fmt(b.open)}</span>
        <span>高 {fmt(b.high)}</span>
        <span>低 {fmt(b.low)}</span>
        <span>收 {fmt(b.close)}</span>
        {prev != null && <span className={cls(b.close - prev)}>{pctStr((b.close / prev - 1) * 100)}</span>}
        <span>量 {fmt(b.volume, 0)}</span>
      </div>
      <svg
        ref={boxRef}
        width="100%"
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full block rounded-xl bg-black/20"
        role="img"
        aria-label="日 K 線與成交量"
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          setHover(Math.max(0, Math.min(bars.length - 1, Math.floor(px / w))));
        }}
        onMouseLeave={() => setHover(null)}
      >
        {[mx - pad, (mx + mn) / 2, mn + pad].map((v) => (
          <g key={v}>
            <line x1="0" x2={plotW} y1={y(v)} y2={y(v)} stroke="rgba(255,255,255,.06)" />
            <text x={plotW + 4} y={y(v) + 3} fontSize="10.5" fill="#8a93a8">
              {fmt(v)}
            </text>
          </g>
        ))}
        {bars.map((k: any, n: number) => {
          const c = k.close >= k.open ? 'var(--up)' : 'var(--down)';
          const cx = n * w + w / 2;
          const vh = (k.volume / mv) * 46;
          return (
            <g key={k.date}>
              <line x1={cx} x2={cx} y1={y(k.high)} y2={y(k.low)} stroke={c} />
              <rect x={cx - w * 0.32} width={w * 0.64} y={y(Math.max(k.open, k.close))} height={Math.max(1, Math.abs(y(k.open) - y(k.close)))} fill={c} />
              <rect x={cx - w * 0.32} width={w * 0.64} y={VB - vh} height={vh} fill={c} opacity=".45" />
            </g>
          );
        })}
        {hover != null && <line x1={i * w + w / 2} x2={i * w + w / 2} y1={PT} y2={VB} stroke="rgba(255,255,255,.4)" />}
        <text x="2" y={H - 54} fontSize="10.5" fill="#8a93a8">
          {bars[0].date.slice(5)}
        </text>
        <text x={plotW - 2} y={H - 54} textAnchor="end" fontSize="10.5" fill="#8a93a8">
          {bars[bars.length - 1].date.slice(5)}
        </text>
      </svg>
      <div className="text-[11.5px] text-slate-400 mt-1.5">近 {bars.length} 日日 K 與成交量（{data.source}）。要看均線、訊號與更長區間請到「技術分析」分頁。</div>
    </div>
  );
}

function StockChart({ symbol, quoteTime, livePrice, intraday, tz, news, showNews, setShowNews, newsLoading, newsError }: { symbol: string; quoteTime: any; livePrice?: number; intraday: any; tz: any; news: any[] | undefined; showNews: boolean; setShowNews: (v: boolean) => void; newsLoading?: boolean; newsError?: string }) {
  const [mode, setMode] = useState('intra');
  const d5 = useSeries('/api/five_days', symbol, mode === 'd5');
  const k = useSeries('/api/candles', symbol, mode === 'k', 60);
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex flex-wrap gap-0.5 rounded-[10px] border border-white/10 bg-white/5 p-0.5">
          {MODES.map(([id, label]) => (
            <button
              type="button"
              key={id}
              aria-pressed={mode === id}
              onClick={() => setMode(id)}
              className={`px-[11px] py-1 rounded-lg text-xs cursor-pointer ${mode === id ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-white'}`}
            >
              {label}
            </button>
          ))}
        </div>
        {mode === 'intra' ? (
          <label className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer" data-tour="watch-news-dots">
            <input type="checkbox" checked={showNews} onChange={(e) => setShowNews(e.target.checked)} aria-label="在走勢圖上標出新聞發布時間" />
            標出新聞（紅利多／綠利空／灰中性）
            <Tip text="把發布時間落在這段走勢內的新聞用彩色圓點標在走勢線上，方便對照「消息出來時股價怎麼動」。顏色是關鍵字規則判斷的語氣（粗估）。停在圓點上看標題，點一下另開分頁看原文。" />
            {newsLoading && <span className="text-slate-500">載入中…</span>}
            {newsError && <span className="text-amber-300">⚠️ {newsError}</span>}
          </label>
        ) : (
          <span className="text-xs text-slate-400">滑鼠移到圖上看該點時間、價格、量</span>
        )}
      </div>
      {mode === 'intra' && (
        <div className="mt-2">
          <IntradayChart data={intraday} lastTrade={quoteTime} livePrice={livePrice} tz={tz} news={showNews ? news : undefined} />
        </div>
      )}
      {mode === 'd5' && <FiveDay data={d5} />}
      {mode === 'k' && <DailyK data={k} />}
    </div>
  );
}

export { StockChart };
