// 估值參考卡下方的「分析師共識」：目標價區間（含現價位置）、評等分布（近 4 個月）、券商最近的調升／調降（後端 src/company/analyst.py）。
// 只在打開該股時抓一次（後端 12 小時快取）；沒有資料的股票（多數中小型台股）只顯示一行說明。
import { cachedJson } from '../fetch_cache';
import { fmt, Tip } from '../ui';

const { useState, useEffect } = React;

const SEG = [
  ['強力買進', 'bg-violet-500'],
  ['買進', 'bg-violet-400/60'],
  ['持有', 'bg-slate-500/70'],
  ['賣出', 'bg-amber-400/60'],
  ['強力賣出', 'bg-amber-500'],
] as const;
const PERIOD = (p: string) => (p === '0m' ? '本月' : `${p.replace(/^-|m$/g, '')} 個月前`);
const SIDE_TONE: Record<string, string> = {
  bull: 'text-violet-200 border-violet-400/40',
  bear: 'text-amber-200 border-amber-400/40',
  neutral: 'text-slate-300 border-slate-500/50',
};
const ACTION_TONE: Record<string, string> = { 調升: 'text-rose-300', 調降: 'text-emerald-300' };
const money = (v: number | null | undefined) => (v == null ? '—' : fmt(v, v >= 1000 ? 0 : 2));

// 目標價區間條：最低～最高，標出平均目標價與現價；現價在區間外時把刻度延伸到現價
function TargetBar({ t, price }: { t: any; price: number | null }) {
  const lo = Math.min(t.low, price ?? t.low);
  const hi = Math.max(t.high, price ?? t.high);
  const span = hi - lo || 1;
  const pct = (v: number) => ((v - lo) / span) * 100;
  const pos = (v: number) => `${pct(v)}%`;
  // 標籤靠近兩端時改成靠左／靠右對齊，才不會超出卡片
  const anchor = (v: number) => (pct(v) < 15 ? 'left-0' : pct(v) > 85 ? 'right-0' : 'left-1/2 -translate-x-1/2');
  return (
    <div className="flex items-center gap-2.5 text-[10.5px]">
      <span className="shrink-0 text-slate-500 text-right leading-tight">
        最低
        <br />
        <b className="mono text-slate-300">{money(t.low)}</b>
      </span>
      <div className="relative flex-1 h-2 my-6 rounded-full ta-track">
        <div className="absolute top-0 h-full rounded-full bg-violet-400/35" style={{ left: pos(t.low), width: `calc(${pos(t.high)} - ${pos(t.low)})` }} />
        {t.mean != null && (
          <div className="absolute bottom-0 w-0.5 h-5 bg-violet-300" style={{ left: pos(t.mean) }}>
            <span className={`absolute bottom-full mb-0.5 text-violet-200 whitespace-nowrap ${anchor(t.mean)}`}>平均 {money(t.mean)}</span>
          </div>
        )}
        {price != null && (
          <div className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-3" style={{ left: pos(price) }}>
            <div className="w-3 h-3 rounded-full bg-white border-2 border-slate-900" />
            <span className={`absolute top-full mt-1 text-white whitespace-nowrap ${anchor(price)}`}>現價 {money(price)}</span>
          </div>
        )}
      </div>
      <span className="shrink-0 text-slate-500 leading-tight">
        最高
        <br />
        <b className="mono text-slate-300">{money(t.high)}</b>
      </span>
    </div>
  );
}

function Distribution({ trend }: { trend: any[] }) {
  return (
    <div className="space-y-1.5">
      {trend.map((t) => (
        <div key={t.period} className="flex items-center gap-2 text-[11px]">
          <span className="w-14 shrink-0 text-slate-500">{PERIOD(t.period)}</span>
          <div
            className="flex-1 flex h-2.5 rounded-full overflow-hidden"
            role="img"
            aria-label={`${PERIOD(t.period)}：${SEG.map(([k]) => `${k} ${t.counts[k]}`).join('、')}`}
          >
            {SEG.map(([k, c]) => t.counts[k] > 0 && <div key={k} className={c} style={{ width: `${(t.counts[k] / t.total) * 100}%` }} />)}
          </div>
          <span className="w-8 shrink-0 text-right mono text-slate-400">{t.total}</span>
        </div>
      ))}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] text-slate-500 pl-16">
        {SEG.map(([k, c]) => (
          <span key={k} className="inline-flex items-center gap-1">
            <i className={`inline-block w-2 h-2 rounded-sm ${c}`} />
            {k} {trend[0]?.counts[k] ?? 0}
          </span>
        ))}
      </div>
    </div>
  );
}

// 券商紀錄最多 8 筆，全部攤開會把卡片拉很長：預設只顯示最近 3 筆
const HIST_FOLD = 3;

export function AnalystPanel({ symbol }: { symbol: string }) {
  const [a, setA] = useState<any>(null);
  const [allHist, setAllHist] = useState(false);
  useEffect(() => {
    let stop = false;
    setA(null);
    setAllHist(false);
    cachedJson('/api/analyst', { symbol }, 600000)
      // 舊版後端沒有這個路由：整段不顯示
      .then((d) => (d?._status === 404 ? { supported: false, hidden: true } : d))
      .then((d) => !stop && setA(d))
      .catch((e) => !stop && setA({ supported: false, reason: `分析師資料取得失敗：${e.message}` }));
    return () => {
      stop = true;
    };
  }, [symbol]);

  if (!a || a.hidden) return null;
  const head = (
    <div className="text-xs font-bold text-slate-200 flex items-center gap-1">
      分析師共識
      <Tip text="各券商分析師對這檔的 12 個月目標價與評等（Yahoo Finance 彙整，以外資券商為主，12 小時更新一次）。目標價不是短線價位，也不是買賣建議。" />
    </div>
  );
  if (!a.supported)
    return (
      <div className="pt-3 mt-1 border-t border-white/5 space-y-1">
        {head}
        <div className="text-xs text-slate-500">{a.reason}</div>
      </div>
    );
  const t = a.target || {};
  const tc = a.trend_change;
  return (
    <div data-tour="analyst" className="pt-3 mt-1 border-t border-white/5 space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {head}
        {a.rating?.label && (
          <span className={`text-[11px] px-2 py-0.5 rounded-md border ${SIDE_TONE[(a.rating.score ?? 3) <= 2.5 ? 'bull' : (a.rating.score ?? 3) >= 3.5 ? 'bear' : 'neutral']}`}>
            {a.rating.label}・{a.rating.score}
          </span>
        )}
        {t.count != null && <span className="text-[11px] text-slate-400">{t.count} 位分析師</span>}
        {a.upside_pct != null && (
          <span className="text-[11px] text-slate-400 ml-auto">
            平均目標價相對現價{' '}
            <b className={`mono ${a.upside_pct >= 0 ? 'text-rose-300' : 'text-emerald-300'}`}>
              {a.upside_pct > 0 ? '+' : ''}
              {a.upside_pct}%
            </b>
          </span>
        )}
      </div>
      {t.low != null && t.high != null && <TargetBar t={t} price={a.price} />}
      {a.trend?.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[11px] text-slate-400">
            評等分布
            {tc && (
              <span className="text-slate-500">
                ：看多 {tc.bull_before}/{tc.total_before} → {tc.bull_now}/{tc.total_now}（{PERIOD(tc.from_period)}→本月）
              </span>
            )}
          </div>
          <Distribution trend={a.trend} />
        </div>
      )}
      {a.history?.length > 0 && (
        <div className="space-y-1">
          <div className="text-[11px] text-slate-400">券商最近 90 天的動作</div>
          <ul className="space-y-1">
            {(allHist ? a.history : a.history.slice(0, HIST_FOLD)).map((h: any) => (
              <li key={`${h.date}-${h.firm}`} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] rounded-lg bg-slate-800/50 px-2.5 py-1.5">
                <span className="mono text-slate-500">{h.date.slice(5)}</span>
                <span className="text-slate-200 truncate max-w-[9rem]" title={h.firm}>
                  {h.firm}
                </span>
                <span className={ACTION_TONE[h.action] || 'text-slate-400'}>{h.action}</span>
                <span className={`px-1.5 rounded border text-[10.5px] ${SIDE_TONE[h.side]}`}>
                  {h.from && h.from !== h.to ? `${h.from} → ${h.to}` : h.to}
                </span>
                {h.target != null && (
                  <span className="ml-auto mono text-slate-400">
                    目標 {h.prior_target != null && h.prior_target !== h.target ? `${money(h.prior_target)} → ` : ''}
                    <b className="text-white">{money(h.target)}</b>
                  </span>
                )}
              </li>
            ))}
          </ul>
          {a.history.length > HIST_FOLD && (
            <button type="button" onClick={() => setAllHist(!allHist)} aria-expanded={allHist} className="text-[11px] text-sky-300 hover:underline">
              {allHist ? '收合' : `顯示全部 ${a.history.length} 筆`}
            </button>
          )}
        </div>
      )}
      {!a.history?.length && a.market === 'TW' && <div className="text-[11px] text-slate-500">台股沒有個別券商的調升／調降紀錄，只有彙整後的目標價與評等。</div>}
      <div className="text-[10px] text-slate-500">{a.note} 來源：{a.source}</div>
    </div>
  );
}
