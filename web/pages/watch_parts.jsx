// 看盤頁用的零件：自選股列、表單欄位、分段按鈕、資料來源面板
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
                  {
                    STOCK: 'text-sky-300 border-sky-500/40',
                    ETF: 'text-amber-300 border-amber-500/40',
                    BOND: 'text-emerald-300 border-emerald-500/40',
                  }[tag.category]
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

  function SourcePanel({ q, log }) {
    return (
      <div className="rounded-xl border border-slate-700 bg-slate-950/70 p-3 space-y-2 text-xs">
        <div className="font-bold text-slate-200">📡 這筆報價是怎麼來的？</div>
        <ol className="list-decimal pl-5 space-y-0.5 text-slate-300">
          <li>
            你的瀏覽器每 5 秒呼叫本機伺服器 <span className="mono">/api/quotes</span>。
          </li>
          <li>
            本機 Python 伺服器（不是瀏覽器）向公開網站發出 HTTP 請求，
            {q.market === 'TW'
              ? '台股走證交所 MIS 即時行情（上市 tse_／上櫃 otc_ 都會試）'
              : `${window.TA.marketName(q.symbol)}走 Yahoo Finance Chart API（幣別 ${q.currency || '--'}）`}
            ，回傳的是 JSON，不是去解析網頁 HTML。
          </li>
          <li>伺服器整理欄位（價格、昨收、五檔…）後回傳，並有 3 秒快取避免被對方限流。</li>
          <li>失敗時直接顯示錯誤，絕不用假資料補位。</li>
        </ol>
        <div className="mono break-all text-slate-400">
          來源：{q.source}
          <br />
          請求網址：{q.endpoint || '--'}
          <br />
          本次抓取 {q.fetched_at}・耗時 {q.latency_ms} ms・資料時間 {q.quote_time || '--'}
        </div>
        <div className="font-bold text-slate-200 pt-1">最近的抓取紀錄</div>
        <div className="max-h-40 overflow-y-auto">
          <table className="w-full mono text-[11px]">
            <thead>
              <tr className="text-slate-500 text-left">
                <th>時間</th>
                <th>狀態</th>
                <th>耗時</th>
                <th>大小</th>
                <th>網址</th>
              </tr>
            </thead>
            <tbody>
              {log.map((r, i) => (
                <tr key={`${r.time}-${i}`} className={r.error ? 'text-rose-300' : 'text-slate-300'}>
                  <td className="pr-2">{r.time}</td>
                  <td className="pr-2">{r.status}</td>
                  <td className="pr-2">{r.ms}ms</td>
                  <td className="pr-2">{r.bytes}B</td>
                  <td className="truncate max-w-[260px]" title={r.url}>
                    {r.url.replace(/^https:\/\//, '').slice(0, 60)}
                  </td>
                </tr>
              ))}
              {log.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-slate-500">
                    尚無紀錄
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="text-slate-500">⚠️ 資料僅供研究參考，可能延遲或錯誤，不構成投資建議。</div>
      </div>
    );
  }

  window.TA = Object.assign(window.TA || {}, { Row, Field, Seg, SourcePanel });
})();
