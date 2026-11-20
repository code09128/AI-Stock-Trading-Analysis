// 看盤頁「基本資料・配息」卡的「持股結構」分頁（只有美股）：機構／內部人持股比例、前 10 大機構、內部人近 180 天交易。
// 後端 src/company/ownership.py（Yahoo 整理的 SEC 13F／Form 4，12 小時快取）；SEC EDGAR 原始申報只給連結，不另外抓。
import { cachedJson } from '../fetch_cache';
import { Tip, fmt } from '../ui';

const { useState, useEffect } = React;

const KIND_TONE: Record<string, string> = {
  buy: 'text-rose-300 border-rose-400/40',
  sell: 'text-emerald-300 border-emerald-400/40',
};
const big = (v: number | null | undefined) =>
  v == null ? '—' : v >= 1e9 ? `${fmt(v / 1e9, 2)}B` : v >= 1e6 ? `${fmt(v / 1e6, 2)}M` : v >= 1e3 ? `${fmt(v / 1e3, 1)}K` : fmt(v, 0);

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-slate-800/60 p-2 min-w-0">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="mono text-white font-bold">{value}</div>
      {sub && <div className="text-[10px] text-slate-500 truncate">{sub}</div>}
    </div>
  );
}

export function OwnershipCard({ symbol }: { symbol: string }) {
  const [d, setD] = useState<any>(null);
  useEffect(() => {
    let stop = false;
    setD(null);
    cachedJson('/api/ownership', { symbol }, 600000)
      .then((x) => (x?._status === 404 ? { supported: false, reason: '目前的伺服器版本還沒有這個功能，重開程式後再試' } : x))
      .then((x) => !stop && setD(x))
      .catch((e) => !stop && setD({ supported: false, reason: `持股資料取得失敗：${e.message}` }));
    return () => {
      stop = true;
    };
  }, [symbol]);

  if (!d) return <div className="text-xs text-slate-500 p-2">正在整理 {symbol} 的持股結構…</div>;
  if (!d.supported) return <div className="text-xs text-slate-400 p-2">{d.reason}</div>;
  const b = d.breakdown || {};
  const s = d.insider_summary || {};
  return (
    <div className="space-y-3 text-xs">
      <div className="grid [grid-template-columns:repeat(auto-fit,minmax(96px,1fr))] gap-2">
        <Stat label="機構持股" value={b.institutions_pct != null ? `${b.institutions_pct}%` : '—'} sub={b.institutions_count ? `${fmt(b.institutions_count, 0)} 家` : undefined} />
        <Stat label="內部人持股" value={b.insiders_pct != null ? `${b.insiders_pct}%` : '—'} sub="董監事與高階主管" />
        <Stat
          label="內部人近 180 天"
          value={`買 ${s.buy_count ?? 0}／賣 ${s.sell_count ?? 0}`}
          sub={s.buy_count || s.sell_count ? `買 ${big(s.buy_value)}・賣 ${big(s.sell_value)} 美元` : '沒有市場買賣'}
        />
      </div>

      {d.holders?.length > 0 && (
        <div className="space-y-1">
          <div className="text-[11px] text-slate-400 flex items-center gap-1">
            前 10 大機構（{d.holders[0].date} 季報）
            <Tip text="來自機構每季申報的 13F，約在季末後 45 天才公布，所以是幾個月前的持股。季增減＝這一季持股數的變化。" />
          </div>
          {/* 卡片很窄（看盤頁 4 欄寬）：用兩行的清單，不用表格 */}
          <ul className="space-y-1">
            {d.holders.map((h: any) => (
              <li key={h.name} className="rounded-lg bg-slate-800/50 px-2.5 py-1.5">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-slate-200 truncate flex-1" title={h.name}>
                    {h.name}
                  </span>
                  <b className="mono text-white shrink-0">{h.pct}%</b>
                </div>
                <div className="flex items-center gap-2 text-[10.5px] text-slate-500">
                  <span className="mono">市值 {big(h.value)} 美元</span>
                  <span className={`ml-auto mono ${h.change_pct > 0 ? 'text-rose-300' : h.change_pct < 0 ? 'text-emerald-300' : ''}`}>
                    季增減 {h.change_pct > 0 ? '+' : ''}
                    {h.change_pct}%
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {d.insider?.length > 0 && (
        <div className="space-y-1">
          <div className="text-[11px] text-slate-400">內部人交易（近 180 天，買賣優先列出）</div>
          <ul className="space-y-1">
            {d.insider.map((t: any, i: number) => (
              <li key={`${t.date}-${t.name}-${i}`} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg bg-slate-800/50 px-2.5 py-1.5" title={t.text}>
                <span className="mono text-slate-500">{t.date.slice(5)}</span>
                <span className="text-slate-200 truncate max-w-[9rem]">{t.name}</span>
                <span className="text-slate-500 truncate max-w-[7rem]">{t.role}</span>
                <span className={`px-1.5 rounded border text-[10.5px] ${KIND_TONE[t.kind] || 'text-slate-400 border-slate-600/50'}`}>{t.label}</span>
                <span className="ml-auto mono text-slate-300">
                  {big(t.shares)} 股{t.value ? `・${big(t.value)} 美元` : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="text-[10px] text-slate-500 leading-relaxed">
        {d.note} 來源：{d.source}・
        <a href={d.edgar_url} target="_blank" rel="noreferrer" className="text-sky-300 hover:underline">
          SEC EDGAR 原始申報
        </a>
      </div>
    </div>
  );
}
