// 看盤頁用的零件：自選股列、表單欄位、分段按鈕
(() => {
  const { useState, useEffect, useRef } = React;
  const { fmt, colorOf, Sparkline, Tip, baseCode } = window.TA;

  function Row({ sym, quote, active, onClick, action, rank, nameOverride, sub, spark, tag }) {
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
        className={`flex items-center gap-2 px-3 py-2 rounded-xl border cursor-pointer transition-colors duration-700 ${
          active
            ? 'bg-sky-500/15 border-sky-400'
            : 'bg-slate-950/70 border-slate-800 hover:border-slate-600'
        } ${flash === 'up' ? '!bg-rose-500/30' : flash === 'down' ? '!bg-emerald-500/30' : ''}`}
      >
        {rank && <span className="text-[11px] text-slate-500 w-4">{rank}</span>}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span className="mono font-bold text-white text-sm">{sym}</span>
            {tag && (
              <span
                className={`text-[9px] px-1 rounded border ${
                  tag.className ||
                  ({
                    STOCK: 'text-sky-300 border-sky-500/40',
                    ETF: 'text-amber-300 border-amber-500/40',
                    BOND: 'text-emerald-300 border-emerald-500/40',
                  }[tag.category] || 'text-cyan-300 border-cyan-500/40')
                }`}
              >
                {tag.label}
              </span>
            )}
            <span className="text-xs text-slate-400 truncate">
              {nameOverride || quote?.name || ''}
            </span>
          </div>
          {sub && <div className="text-[11px] text-slate-500 truncate">{sub}</div>}
        </div>
        {spark && <Sparkline values={spark} />}
        {quote?.error ? (
          <span className="text-[11px] text-rose-400">抓取失敗</span>
        ) : quote ? (
          <div className="text-right mono">
            <div className={`text-sm font-bold ${colorOf(chg)}`}>{fmt(quote.price)}</div>
            <div className={`text-[11px] ${colorOf(chg)}`}>
              {quote.change_pct > 0 ? '+' : ''}
              {fmt(quote.change_pct)}%
            </div>
          </div>
        ) : (
          <span className="text-[11px] text-slate-600">載入中…</span>
        )}
        {action}
      </div>
    );
  }

  const Field = ({ label, tip, children }) => (
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

  window.TA = Object.assign(window.TA || {}, { Row, Field, Seg });
})();
