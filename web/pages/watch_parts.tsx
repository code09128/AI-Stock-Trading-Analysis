// 看盤頁用的零件：自選股列、表單欄位、分段按鈕
import { Tip, baseCode, colorOf, fmt } from '../ui';
import { Sparkline } from '../live_widgets';

const { useState, useEffect, useRef } = React;


function Row({ sym, quote, active, onClick, action, actionBelow, rank, nameOverride, sub, spark, tag }: { sym: any; quote?: any; active?: boolean; onClick?: any; action?: any; actionBelow?: boolean; rank?: number; nameOverride?: any; sub?: any; spark?: any; tag?: any }) {
  const chg = quote?.change;
  const prevPrice = useRef(quote?.price);
  const [flash, setFlash] = useState(null);
  useEffect(() => {
    const p = quote?.price;
    if (p != null && prevPrice.current != null && p !== prevPrice.current) {
      setFlash(p > prevPrice.current ? 'up' : 'down');
      const t = setTimeout(() => setFlash(null), 900);
      prevPrice.current = p;
      return () => clearTimeout(t);
    }
    prevPrice.current = p;
    return undefined;
  }, [quote?.price]);
  return (
    // biome-ignore lint/a11y/useSemanticElements: 列內含按鈕，不能用 button 巢狀
    <div
      role="button"
      tabIndex={0}
      data-sym={baseCode(sym)}
      aria-current={active ? 'true' : undefined}
      onClick={onClick}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onClick()}
      className={`group rounded-xl border cursor-pointer transition-[transform,background-color,border-color] duration-200 hover:translate-x-[3px] px-2.5 py-2 ${
        active
          ? 'border-[#4f7cff] bg-gradient-to-r from-[#4f7cff]/20 to-[#4f7cff]/5'
          : 'border-transparent bg-white/5 hover:bg-white/10'
      } ${flash === 'up' ? '!bg-rose-500/30' : flash === 'down' ? '!bg-emerald-500/30' : ''}`}
    >
      <div className="flex items-center gap-2">
        {rank && <span className="text-[11px] text-slate-500 w-4 shrink-0">{rank}</span>}
        <div className="min-w-0 flex-1">
          <b className="block text-[13px] text-white truncate">{nameOverride || quote?.name || sym}</b>
          <small className="flex items-center gap-1 text-[11.5px] text-slate-400 min-w-0">
            <span className="mono shrink-0">{sym}</span>
            {tag && (
              <span
                className={`text-[9px] px-1 rounded border shrink-0 ${
                  tag.className ||
                  ({
                    STOCK: 'text-sky-300 border-sky-500/40',
                    ETF: 'text-amber-300 border-amber-500/40',
                    BOND: 'text-teal-300 border-teal-500/40',
                  }[tag.category] || 'text-cyan-300 border-cyan-500/40')
                }`}
              >
                {tag.label}
              </span>
            )}
          </small>
          {sub && <div className="text-[11px] text-slate-400 truncate">{sub}</div>}
        </div>
        {quote?.error ? (
          <span className="text-[11px] text-rose-400 shrink-0">抓取失敗</span>
        ) : quote ? (
          <div className={`text-right mono shrink-0 ${colorOf(chg)}`}>
            <div className="text-[13px]">
              {/* key 隨價格變動：重新掛載才會重播跳動動畫 */}
              <span key={quote.price} className={flash ? `ta-tick-${flash}` : ''}>
                {fmt(quote.price)}
              </span>
            </div>
            <div className="text-[11.5px]">
              {quote.change_pct > 0 ? '+' : ''}
              {fmt(quote.change_pct)}%
            </div>
          </div>
        ) : (
          <span className="text-[11px] text-slate-500 shrink-0">載入中…</span>
        )}
        {spark && <span className="shrink-0"><Sparkline values={spark} w={56} /></span>}
        {!actionBelow && action}
      </div>
      {actionBelow && action && <div className="mt-1.5">{action}</div>}
    </div>
  );
}

const Field = ({ label, tip, children }: { label: any; tip?: any; children?: any }) => (
  <div>
    <div className="text-[11px] text-slate-400 mb-1">
      {label}
      {tip && <Tip text={tip} />}
    </div>
    {children}
  </div>
);

const Seg = ({ value, onChange, options }) => (
  <div className="flex rounded-lg overflow-hidden border border-slate-700">
    {options.map(([v, label, on]) => (
      <button
        type="button"
        key={v}
        onClick={() => onChange(v)}
        className={`flex-1 py-1.5 text-xs font-semibold cursor-pointer ${
          value === v ? `${on || 'bg-sky-600'} text-white` : 'bg-slate-950 text-slate-400'
        }`}
      >
        {label}
      </button>
    ))}
  </div>
);

export { Row, Field, Seg };
