// 估值參考卡：近四季 EPS × 同產業本益比，直接標示「便宜／偏便宜／合理／偏貴／貴」（後端 src/company/valuation.py）
import { cachedJson } from '../fetch_cache';
import { Tip } from '../ui';
import { CardBox } from './card_box';

const { useState, useEffect } = React;

const LEVELS = ['便宜', '偏便宜', '合理', '偏貴', '貴'];
const LEVEL_STYLE: Record<string, string> = {
  便宜: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50',
  偏便宜: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
  合理: 'bg-sky-500/10 text-sky-300 border-sky-500/30',
  偏貴: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
  貴: 'bg-rose-500/20 text-rose-300 border-rose-500/50',
};
const BAR_STYLE = ['bg-emerald-500/70', 'bg-emerald-500/40', 'bg-sky-500/40', 'bg-amber-500/40', 'bg-rose-500/70'];
const money = (v: number | null | undefined) =>
  v == null ? '—' : v.toLocaleString('zh-TW', { maximumFractionDigits: 2 });

// ctl 有值＝放進看盤頁的卡片格線（可拖曳、收合、隱藏）；沒有＝維持原本獨立的一張卡（基本資料頁）
export function ValuationCard({ symbol, ctl }: { symbol: string; ctl?: any }) {
  const [v, setV] = useState<any>(null);
  useEffect(() => {
    let stop = false;
    setV(null);
    cachedJson('/api/valuation', { symbol }, 295000)
      // 舊版後端沒有這個路由：不顯示整張卡，不要讓使用者看到錯誤
      .then((d) => (d?._status === 404 ? { supported: false, hidden: true } : d))
      .then((d) => !stop && setV(d))
      .catch((e) => !stop && setV({ supported: false, reason: `估值資料取得失敗：${e.message}` }));
    return () => {
      stop = true;
    };
  }, [symbol]);

  if (!v) return ctl ? null : <div className="text-xs text-slate-500 px-1">正在計算估值參考…</div>;
  if (v.hidden || (!v.supported && /ETF|債券/.test(v.reason || ''))) return null;
  const body = !v.supported ? (
    <div className="text-xs text-slate-400">{v.reason}</div>
  ) : !v.verdict ? (
    <div className="text-xs text-slate-400">{v.reason}</div>
  ) : (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <span className={`text-lg font-bold px-3 py-1 rounded-xl border ${LEVEL_STYLE[v.verdict]}`}>{v.verdict}</span>
        <div className="text-xs text-slate-300 leading-relaxed">
          本益比 <span className="mono text-white font-bold">{v.own_pe}</span> 倍，
          {v.market === 'US' ? (
            <>
              相對{v.industry}（本益比 {v.benchmark.pe?.toFixed(1)} 倍）
              <span className="mono text-white font-bold"> {v.premium_pct > 0 ? '溢價' : '折價'} {Math.abs(v.premium_pct)}%</span>
            </>
          ) : (
            <>
              在{v.industry}（{v.industry_stats.count} 家）中排第{' '}
              <span className="mono text-white font-bold">{v.pe_percentile}</span> 百分位
              <span className="text-slate-500">（越小越便宜）</span>
            </>
          )}
        </div>
      </div>
      <div>
        <div className="relative flex h-2.5 rounded-full overflow-hidden">
          {BAR_STYLE.map((c, i) => (
            <div key={LEVELS[i]} className={`flex-1 ${c} ${i ? 'border-l border-slate-900' : ''}`} />
          ))}
          <div
            className="absolute top-0 h-full w-0.5 bg-white"
            style={{ left: `${Math.min(99, Math.max(0, v.gauge))}%` }}
          />
        </div>
        <div className="flex justify-between text-[10px] text-slate-500 mt-0.5">
          {LEVELS.map((l) => (
            <span key={l}>{l}</span>
          ))}
        </div>
      </div>
      <div className="grid [grid-template-columns:repeat(auto-fit,minmax(130px,1fr))] gap-2 text-xs">
        <div className="rounded-lg bg-slate-800/60 p-2">
          <div className="text-slate-500">現價（{v.price_date}）</div>
          <div className="mono text-white font-bold">{money(v.price)}</div>
        </div>
        <div className="rounded-lg bg-slate-800/60 p-2">
          <div className="text-slate-500">
            近四季 EPS
            <Tip text="基期＝計算本益比所用的那四個季度的 EPS 合計。EPS 剛大增，本益比會被墊低（看起來便宜）；EPS 剛大減，本益比會被墊高（看起來貴）。" />
          </div>
          <div className="mono text-white font-bold">{money(v.eps)}</div>
          <div className="text-[10px] text-slate-500">
            {v.base_period?.quarters ? `基期 ${v.base_period.quarters}` : v.eps_source}
            {v.base_period?.ttm_eps_yoy_pct != null && `・年增 ${v.base_period.ttm_eps_yoy_pct}%`}
          </div>
        </div>
        <div className="rounded-lg bg-slate-800/60 p-2">
          <div className="text-slate-500">{v.market === 'US' ? `${v.benchmark.etf} 類股本益比` : '同業本益比中位數'}</div>
          <div className="mono text-white font-bold">{v.market === 'US' ? v.benchmark.pe?.toFixed(1) : v.industry_stats.median} 倍</div>
          <div className="text-[10px] text-slate-500">
            {v.market === 'US'
              ? v.forward_pe
                ? `本檔前瞻本益比 ${v.forward_pe.toFixed(1)} 倍`
                : '市值加權'
              : `中間 50%：${v.industry_stats.p25}～${v.industry_stats.p75}`}
          </div>
        </div>
        <div className="rounded-lg bg-slate-800/60 p-2">
          <div className="text-slate-500">
            合理價區間
            <Tip text="台股：近四季 EPS × 同業本益比（25～75 百分位），區間常很寬，請以上方的分級為主。美股：EPS × 類股 ETF 本益比 ±10%。" />
          </div>
          <div className="mono text-white font-bold">
            {money(v.fair_low)}～{money(v.fair_high)}
          </div>
          <div className="text-[10px] text-slate-500">
            中間估價 {money(v.fair_mid)}（現價 {v.vs_mid_pct > 0 ? '高' : '低'} {Math.abs(v.vs_mid_pct)}%）
          </div>
        </div>
      </div>
    </>
  );
  const tip = <Tip text={v.method || '用近四季 EPS 和同產業本益比，判斷現在的價格相對同業是貴還是便宜。'} />;
  const rest = (
    <>
      {body}
      {(v.notes || []).map((n: string) => (
        <div key={n} className="text-[11px] text-amber-200/80 leading-relaxed">
          ⚠ {n}
        </div>
      ))}
      <div className="text-[10px] text-slate-500">
        依固定規則計算的相對比較，不是預測，也不是買賣建議。來源：{(v.sources || []).join('、') || '—'}
      </div>
    </>
  );
  if (ctl)
    return (
      <CardBox id="val" title="估值參考" sub={v.verdict || undefined} ctl={ctl}>
        <div data-tour="valuation" className="space-y-3">
          <div className="text-xs text-slate-400">估值方法說明 {tip}</div>
          {rest}
        </div>
      </CardBox>
    );
  return (
    <div data-tour="valuation" className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 space-y-3">
      <div className="text-sm font-bold text-white">
        估值參考
        {tip}
      </div>
      {rest}
    </div>
  );
}
