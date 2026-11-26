// 看盤頁用的零件：自選股列、表單欄位、分段按鈕
import { TRIAL_TIP, Tip, baseCode, colorOf, fmt, shownQuote } from '../ui';
import { Sparkline } from '../live_widgets';

const { useState, useEffect, useRef } = React;


// 當日小 K 棒：影線＝最高到最低，實體＝開盤到現價；收高於開盤用漲色，收低用跌色（和漲跌幅比的是昨收，兩者可能不同色）
function MiniCandle({ quote }: { quote: any }) {
  const { open, high, low, price } = quote || {};
  const W = 9;
  const H = 30;
  if (![open, high, low, price].every((v) => typeof v === 'number' && v > 0) || high < low) {
    return <span className="shrink-0 inline-block" style={{ width: W, height: H }} aria-hidden="true" />;
  }
  const span = high - low;
  const y = (v: number) => (span > 0 ? 1 + ((high - v) / span) * (H - 2) : H / 2);
  const col = price > open ? 'var(--up)' : price < open ? 'var(--down)' : 'rgb(var(--slate-400))';
  const top = y(Math.max(open, price));
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="shrink-0" role="img" aria-label={`今日開 ${open} 高 ${high} 低 ${low} 現價 ${price}`}>
      <title>{`今日 K 棒：開 ${open}・高 ${high}・低 ${low}・現價 ${price}`}</title>
      <line x1={W / 2} x2={W / 2} y1={y(high)} y2={y(low)} stroke={col} strokeWidth="1.2" />
      <rect x="1" width={W - 2} y={top} height={Math.max(1.5, y(Math.min(open, price)) - top)} fill={col} />
    </svg>
  );
}

// 價格跳動：價格變了就回傳 'up'／'down'，0.9 秒後回到 null。清單列、看盤頁右上報價與分時走勢標題共用，同一筆報價三處一起閃
// key：換了標的（例如看盤頁右上換一檔）就重新起算，不把「換股票造成的價差」當成跳動
function usePriceFlash(price: number | null | undefined, key?: string): 'up' | 'down' | null {
  const prev = useRef(price);
  const prevKey = useRef(key);
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);
  useEffect(() => {
    if (key !== prevKey.current) {
      prevKey.current = key;
      prev.current = price;
      setFlash(null);
      return undefined;
    }
    if (price != null && prev.current != null && price !== prev.current) {
      setFlash(price > prev.current ? 'up' : 'down');
      const t = setTimeout(() => setFlash(null), 900);
      prev.current = price;
      return () => clearTimeout(t);
    }
    prev.current = price;
    return undefined;
  }, [price, key]);
  return flash;
}

// 自選列的拖動排序：有傳 drag 才能拖（排序選「我的順序」時），列左邊顯示 ⠿
type RowDrag = {
  dragging?: boolean;
  over?: boolean;
  onDragStart: (e: any) => void;
  onDragEnd: () => void;
  onDragOver: (e: any) => void;
  onDrop: (e: any) => void;
};

// bell：這檔有提醒時在代號旁顯示 🔔（'fired'＝有已觸發的，多一個驚嘆號）
// compact：排行用的緊湊列（上下內距小、不顯示當日小 K 棒）
function Row({ sym, quote: rawQuote, active, onClick, action, actionBelow, rank, nameOverride, sub, spark, tag, bell, drag, compact }: { sym: any; quote?: any; active?: boolean; onClick?: any; action?: any; actionBelow?: boolean; rank?: number; nameOverride?: any; sub?: any; spark?: any; tag?: any; bell?: 'on' | 'fired'; drag?: RowDrag; compact?: boolean }) {
  // 盤前沒有成交價時顯示試撮價或昨收（見 ui.shownQuote，只影響畫面）
  const quote = rawQuote ? shownQuote(rawQuote) : rawQuote;
  const chg = quote?.change;
  const flash = usePriceFlash(quote?.price);
  return (
    // biome-ignore lint/a11y/useSemanticElements: 列內含按鈕，不能用 button 巢狀
    <div
      role="button"
      tabIndex={0}
      data-sym={baseCode(sym)}
      aria-current={active ? 'true' : undefined}
      onClick={onClick}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onClick()}
      draggable={drag ? true : undefined}
      onDragStart={drag?.onDragStart}
      onDragEnd={drag?.onDragEnd}
      onDragOver={drag?.onDragOver}
      onDrop={drag?.onDrop}
      className={`group rounded-xl border cursor-pointer transition-[transform,background-color,border-color] duration-200 hover:translate-x-[3px] ${compact ? 'py-1.5' : 'py-3'} ${
        drag ? 'pl-2 pr-3.5' : 'px-3.5'
      } ${active ? 'ta-row-on border-transparent' : 'border-transparent bg-white/5 hover:bg-white/10'} ${drag?.dragging ? 'opacity-40' : ''}`}
      style={{
        ...(flash === 'up' ? { background: 'var(--up-bg)' } : flash === 'down' ? { background: 'var(--down-bg)' } : {}),
        // 拖到這列上方時：上緣一條強調色線，表示會放在這列前面
        ...(drag?.over ? { boxShadow: '0 -2px 0 rgb(var(--accent-500))' } : {}),
      }}
    >
      <div className="flex items-center gap-3">
        {drag && (
          <span aria-hidden="true" title="拖動調整順序" className="-mr-1.5 text-slate-500 group-hover:text-slate-300 cursor-grab select-none text-[13px] leading-none">
            ⠿
          </span>
        )}
        {rank &&<span className="text-[11px] font-semibold text-slate-300 bg-white/5 rounded-md w-6 h-6 inline-flex items-center justify-center shrink-0">{rank}</span>}
        {!compact && <MiniCandle quote={quote?.error ? null : quote} />}
        <div className="min-w-0 flex-1">
          <b className="block text-[13.5px] text-white truncate">{nameOverride || quote?.name || sym}</b>
          <small className="flex items-center gap-1.5 mt-0.5 text-[11.5px] text-slate-400 min-w-0">
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
            {bell && (
              <span
                className="text-[10.5px] text-amber-300 shrink-0"
                title={bell === 'fired' ? '有已觸發的提醒' : '有監控中的提醒'}
                role="img"
                aria-label={bell === 'fired' ? '有已觸發的提醒' : '有監控中的提醒'}
              >
                🔔{bell === 'fired' ? '!' : ''}
              </span>
            )}
          </small>
          {sub && <div className="text-[11px] text-slate-400 truncate">{sub}</div>}
        </div>
        {quote?.error ? (
          <span className="text-[11px] text-rose-400 shrink-0">抓取失敗</span>
        ) : quote ? (
          <div className={`text-right mono shrink-0 ${colorOf(chg)}`}>
            <div className="text-[13.5px] font-semibold">
              {/* key 隨價格變動：重新掛載才會重播跳動動畫 */}
              <span key={quote.price} className={flash ? `ta-tick-${flash}` : ''}>
                {fmt(quote.price)}
              </span>
            </div>
            <div className="text-[11.5px]" title={quote.tag === '試撮' ? TRIAL_TIP : quote.notice || undefined}>
              {quote.tag && <span className="mr-1 text-[10px] px-1 rounded border border-amber-400/40 text-amber-200">{quote.tag}</span>}
              {quote.tag === '昨收' ? '' : quote.notice && quote.price == null ? '盤前' : `${quote.change_pct > 0 ? '+' : ''}${fmt(quote.change_pct)}%`}
            </div>
          </div>
        ) : (
          <span className="text-[11px] text-slate-500 shrink-0">載入中…</span>
        )}
        {spark && <span className="shrink-0"><Sparkline values={spark} w={56} /></span>}
        {!actionBelow && action && <span className="shrink-0 flex items-center gap-1.5 pl-1">{action}</span>}
      </div>
      {/* 列下方的動作（持股列的分析／回測／加碼／賣出／移除）：滑過、鍵盤選到或選中那一列才出現（index.html 的 .ta-reveal-row） */}
      {actionBelow && action && <div className="ta-reveal-row mt-1.5">{action}</div>}
    </div>
  );
}

// ★ 一顆切換：空心＝加入自選、實心＝已在自選（再按移出）。點了不會觸發所在那一列的選股
function StarToggle({ on, name, onToggle }: { on: boolean; name: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={`${on ? '移出' : '加入'}自選：${name}`}
      title={on ? '已在自選（再按移出）' : '加入自選'}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      onKeyDown={(e) => e.stopPropagation()}
      className={`ta-icon w-8 h-8 rounded-lg inline-flex items-center justify-center text-[17px] cursor-pointer ${
        on ? 'text-amber-300' : 'text-slate-400 hover:text-amber-200'
      }`}
    >
      {on ? '★' : '☆'}
    </button>
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
  <div className="ta-track flex gap-1 p-1 rounded-lg">
    {options.map(([v, label, on]) => {
      const active = value === v;
      const isUpDown = on === 'up' || on === 'down';
      return (
        <button
          type="button"
          key={v}
          aria-pressed={active}
          onClick={() => onChange(v)}
          style={
            active && isUpDown
              ? { background: on === 'up' ? 'var(--up)' : 'var(--down)' }
              : undefined
          }
          className={`flex-1 px-1 py-1 rounded-md text-xs font-semibold cursor-pointer ${
            active
              ? `${isUpDown ? '' : on || 'bg-sky-600'} text-white`
              : 'bg-slate-950 text-slate-400'
          }`}
        >
          {label}
        </button>
      );
    })}
  </div>
);

export { Row, Field, Seg, StarToggle, usePriceFlash };
