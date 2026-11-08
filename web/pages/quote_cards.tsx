// 行情分頁幾張卡的內容：開高低量、委買委賣五檔、相關新聞、我的持股。
// 數字都來自傳進來的真實資料；沒有資料就照實說，不用假資料補。
import { Tip, baseCode, colorOf, currencyOf, fmt, marketName, twTick } from '../ui';
import { Donut, HBars, topSlices } from './mini_charts';

const { useState } = React;

function Rng({ label, low, high, value, right }: { label: string; low: any; high: any; value: any; right?: string }) {
  const ok = low != null && high != null && value != null && high > low;
  const pos = ok ? Math.max(0, Math.min(100, ((value - low) / (high - low)) * 100)) : null;
  return (
    <div className="my-2.5">
      <div className="flex justify-between gap-2 text-[11.5px] text-slate-400 mb-1">
        <span>{label}</span>
        <span className="mono">{right ?? (ok ? `${fmt(low)} — ${fmt(high)}` : '--')}</span>
      </div>
      <div className="relative h-2 rounded-full" style={{ background: 'linear-gradient(90deg,var(--down),#475069 50%,var(--up))' }}>
        {pos != null && (
          <i
            className="absolute top-1/2 w-3.5 h-3.5 rounded-full bg-white"
            style={{ left: `${pos}%`, transform: 'translate(-50%,-50%)', boxShadow: '0 0 0 3px rgba(79,124,255,.5)' }}
          />
        )}
      </div>
    </div>
  );
}

function Kv({ label, tip, children, cls = '' }: { label: any; tip?: string; children: any; cls?: string }) {
  return (
    <div className="bg-white/5 rounded-[10px] px-2.5 py-[7px] min-w-0">
      <small className="block text-slate-400 text-[11.5px]">
        {label}
        {tip && <Tip text={tip} />}
      </small>
      <b className={`mono text-[14.5px] ${cls}`}>{children}</b>
    </div>
  );
}

function StatsBody({ q, tw, etf, intraday, volRatio }: { q: any; tw: boolean; etf: boolean; intraday: any; volRatio: any }) {
  const amp = q.high && q.low && q.prev_close ? ((q.high - q.low) / q.prev_close) * 100 : null;
  return (
    <div>
      <div className="grid [grid-template-columns:repeat(auto-fit,minmax(84px,1fr))] gap-2">
        <Kv label="開盤" cls={colorOf((q.open || 0) - (q.prev_close || 0))}>
          {fmt(q.open)}
        </Kv>
        <Kv label="最高" cls="text-rose-400">
          {fmt(q.high)}
        </Kv>
        <Kv label="最低" cls="text-emerald-400">
          {fmt(q.low)}
        </Kv>
        <Kv label="昨收" tip="前一個交易日的收盤價，漲跌幅以它為基準">
          {fmt(q.prev_close)}
        </Kv>
        <Kv
          label={`成交量（${q.volume_unit || ''}）`}
          tip={tw ? '台股 1 張 = 1000 股' : `${marketName(q.symbol)}以股為單位（實際交易所可能有每手最少股數）`}
        >
          {fmt(q.volume, 0)}
        </Kv>
        <Kv label="量比" tip="今日成交量 ÷ 近 20 日均量（盤中偏低屬正常）">
          {volRatio == null ? '--' : `${fmt(volRatio, 2)}x`}
        </Kv>
        {tw && (
          <Kv label="漲停 / 跌停" tip="台股單日漲跌幅限制 ±10%，委託價不能超出此範圍">
            <span className="text-[13px]">
              <span className="text-rose-400">{fmt(q.limit_up)}</span> / <span className="text-emerald-400">{fmt(q.limit_down)}</span>
            </span>
          </Kv>
        )}
        <Kv label="日內振幅" tip="(最高 - 最低) ÷ 昨收">
          {amp == null ? '--' : `${fmt(amp)}%`}
        </Kv>
        <Kv label="最小跳動" tip={tw ? '台股每個價位的最小變動單位（股票與 ETF 不同）' : '美股報價單位'}>
          {tw && q.price != null ? fmt(twTick(q.price, etf)) : '0.01'}
        </Kv>
      </div>
      <Rng label="今日區間（低—高）" low={q.low} high={q.high} value={q.price} />
      <Rng label="52 週區間（低—高）" low={intraday?.week52_low} high={intraday?.week52_high} value={q.price} />
    </div>
  );
}

function DepthBody({ q, tw }: { q: any; tw: boolean }) {
  if (!tw || !q.bids?.length) {
    return (
      <div className="text-xs text-slate-400 bg-black/20 border border-white/5 rounded-lg px-3 py-2">
        {tw
          ? '此時段沒有五檔資料（可能尚未開盤或無掛單）。'
          : `ℹ️ ${marketName(q.symbol)}的公開免費資料源不提供五檔與內外盤，這裡不顯示（不會用假資料補上）。`}
      </div>
    );
  }
  const rows = [0, 1, 2, 3, 4].map((i) => ({ b: q.bids[i], a: q.asks?.[i] }));
  const sumB = q.bids.reduce((s: number, x: any) => s + (x.vol || 0), 0);
  const sumA = (q.asks || []).reduce((s: number, x: any) => s + (x.vol || 0), 0);
  const mx = Math.max(1, ...rows.flatMap((r) => [r.b?.vol || 0, r.a?.vol || 0]));
  const bestB = q.bids[0];
  const bestA = q.asks?.[0];
  return (
    <div>
      <div className="text-xs text-slate-400 mb-1">
        委買／委賣掛單量比例（不是內外盤）
        <Tip text="把五檔的委買總量與委賣總量相比。注意：這不是『內外盤』（成交方向統計），官方公開資料沒有提供內外盤，所以這裡誠實標示為掛單量比例。" />
      </div>
      <div className="flex h-[22px] rounded-lg overflow-hidden text-[11px] font-bold">
        <span className="grid place-items-center text-white" style={{ flex: sumB || 1, background: 'color-mix(in srgb,var(--up) 70%,#000)' }}>
          委買 {fmt(sumB, 0)}
        </span>
        <span className="grid place-items-center text-[#04130d]" style={{ flex: sumA || 1, background: 'color-mix(in srgb,var(--down) 70%,#000)' }}>
          委賣 {fmt(sumA, 0)}
        </span>
      </div>
      <div className="text-xs text-slate-400 mt-2">
        最佳五檔
        <Tip text="市場上最接近成交價的 5 個買價與 5 個賣價，以及各價位掛單張數" />
      </div>
      <table className="w-full text-[12.5px] mono mt-1 border-collapse">
        <thead>
          <tr className="text-slate-400">
            <td className="px-1 py-[3px]">委買量</td>
            <td className="px-1 py-[3px] text-center">價格</td>
            <td className="px-1 py-[3px] text-center">價格</td>
            <td className="px-1 py-[3px] text-right">委賣量</td>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.b?.price ?? 'b'}${r.a?.price ?? 'a'}${i}`}>
              <td className="relative px-1 py-[3px]">
                {r.b && <div className="absolute top-[3px] bottom-[3px] right-0 rounded opacity-[.22]" style={{ width: `${(r.b.vol / mx) * 100}%`, background: 'var(--up)' }} />}
                <span className="relative">{r.b ? fmt(r.b.vol, 0) : ''}</span>
              </td>
              <td className="px-1 py-[3px] text-center text-rose-400">{r.b ? fmt(r.b.price) : ''}</td>
              <td className="px-1 py-[3px] text-center text-emerald-400">{r.a ? fmt(r.a.price) : ''}</td>
              <td className="relative px-1 py-[3px] text-right">
                {r.a && <div className="absolute top-[3px] bottom-[3px] left-0 rounded opacity-[.22]" style={{ width: `${(r.a.vol / mx) * 100}%`, background: 'var(--down)' }} />}
                <span className="relative">{r.a ? fmt(r.a.vol, 0) : ''}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {bestB && bestA && (
        <div className="text-[11.5px] text-slate-400 mt-2">
          買賣價差 {fmt(bestA.price - bestB.price)}（約 {fmt(((bestA.price - bestB.price) / bestA.price) * 100, 2)}%），價差越小越容易成交。
        </div>
      )}
    </div>
  );
}

const SENT: Record<string, [string, string]> = {
  POSITIVE: ['利多', 'var(--up)'],
  NEGATIVE: ['利空', 'var(--down)'],
  NEUTRAL: ['中性', '#b8c8ff'],
};

function NewsBody({ digest, loading, error, onAskAi, onDeep }: { digest: any; loading: boolean; error: string; onAskAi: () => void; onDeep: () => void }) {
  const [kind, setKind] = useState('全部');
  if (loading && !digest) return <div className="text-xs text-slate-400">新聞載入中…（要連多個新聞來源，約數秒）</div>;
  if (error) return <div className="text-xs text-amber-300">⚠️ {error}</div>;
  const items = digest?.items || [];
  const others = digest?.others || [];
  if (!items.length && !others.length) return <div className="text-xs text-slate-400">目前沒有抓到這檔的新聞。</div>;
  const pos = items.filter((n: any) => n.sentiment === 'POSITIVE').length;
  const neg = items.filter((n: any) => n.sentiment === 'NEGATIVE').length;
  const mid = items.length - pos - neg;
  const dated = items.filter((n: any) => n.sentiment !== 'NEUTRAL' && n.reaction && !n.reaction.pending && n.reaction.pct != null);
  const hit = dated.filter((n: any) => (n.sentiment === 'POSITIVE' ? n.reaction.pct > 0 : n.reaction.pct < 0)).length;
  const reflected = dated.length ? (hit / dated.length) * 100 : null;
  const kinds = ['全部', ...Array.from(new Set(items.map((n: any) => n.kind).filter(Boolean)))] as string[];
  const shown = items.filter((n: any) => kind === '全部' || n.kind === kind);
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-1.5 mb-2">
        <div className="flex flex-1 min-w-[180px] h-[22px] rounded-lg overflow-hidden text-[11px] font-bold">
          <span className="grid place-items-center text-white" style={{ flex: pos || 0.2, background: 'color-mix(in srgb,var(--up) 70%,#000)' }}>
            利多 {pos}
          </span>
          <span className="grid place-items-center text-white" style={{ flex: mid || 0.2, background: '#3b4256' }}>
            中性 {mid}
          </span>
          <span className="grid place-items-center text-[#04130d]" style={{ flex: neg || 0.2, background: 'color-mix(in srgb,var(--down) 70%,#000)' }}>
            利空 {neg}
          </span>
        </div>
        <button
          type="button"
          onClick={onAskAi}
          className="px-2.5 py-1 rounded-[10px] text-xs font-semibold text-white bg-gradient-to-br from-[#4f7cff] to-[#8b5cf6] cursor-pointer hover:brightness-110"
        >
          ✦ 讓 AI 判斷這些新聞
        </button>
      </div>
      <Rng
        label="消息是否已反映在股價（左：尚未／右：已反映）"
        low={0}
        high={100}
        value={reflected}
        right={reflected == null ? '資料不足' : `${dated.length} 則中 ${hit} 則方向一致`}
      />
      <div className="flex flex-wrap gap-1.5 my-1.5">
        {kinds.map((k) => (
          <button
            type="button"
            key={k}
            aria-pressed={kind === k}
            onClick={() => setKind(k)}
            className={`px-2.5 py-[3px] rounded-full text-xs border cursor-pointer ${
              kind === k ? 'bg-[#4f7cff]/20 border-[#4f7cff] text-white' : 'border-white/10 text-slate-400 hover:text-white'
            }`}
          >
            {k}
          </button>
        ))}
      </div>
      <div className="grid gap-2 max-h-[440px] overflow-y-auto pr-1">
        {shown.map((n: any) => {
          const [label, tone] = SENT[n.sentiment] || SENT.NEUTRAL;
          const px = n.reaction && !n.reaction.pending ? n.reaction.pct : null;
          return (
            <div key={`${n.link}${n.title}`} className="bg-white/5 rounded-xl px-3 py-[9px] grid gap-[3px]">
              <div className="text-[13px] leading-snug">
                <span className="inline-block px-2 py-px rounded-full text-[11px] mr-1" style={{ color: tone, background: `color-mix(in srgb,${tone} 18%,transparent)` }}>
                  {label}
                </span>
                <span className="inline-block px-2 py-px rounded-full text-[11px] mr-1 bg-[#4f7cff]/20 text-[#b8c8ff]">{n.kind || '新聞'}</span>
                {/^https?:\/\//i.test(n.link || '') ? (
                  <a href={n.link} target="_blank" rel="noopener noreferrer" className="font-semibold text-slate-100 hover:text-[#b8c8ff] hover:underline">
                    {n.title} ↗
                  </a>
                ) : (
                  <span className="font-semibold text-slate-100">{n.title}</span>
                )}
              </div>
              <small className="text-slate-400 text-[11.5px]">
                {n.source}・{String(n.local_iso || '').slice(5, 16).replace('T', ' ')}
                {px != null && (
                  <span className={`ml-1 mono ${colorOf(px)}`}>
                    ・發布後 {px > 0 ? '+' : ''}
                    {fmt(px)}%
                  </span>
                )}
                {n.check_fulltext && <span className="ml-1 text-amber-300">・標題可能低估，建議看原文</span>}
              </small>
            </div>
          );
        })}
        {!shown.length && <div className="text-xs text-slate-400">這個分類目前沒有新聞。</div>}
      </div>
      <div className="text-[11.5px] text-slate-400 mt-2">
        語氣是關鍵字規則判斷（粗估）；「已反映」＝已有價格反應的新聞裡，發布前後收盤的方向和語氣一致的比例。
        另有 {others.length} 則其他新聞，逐則細節、其他新聞與手動輸入在
        <button type="button" onClick={onDeep} className="mx-1 text-[#b8c8ff] underline cursor-pointer">
          新聞研究
        </button>
        分頁。
      </div>
    </div>
  );
}

function HoldBody({ holdings, quotes, fx, selected, price, onPick, onSell }: { holdings: any[]; quotes: any; fx: any; selected: string; price: any; onPick: (s: string) => void; onSell: () => void }) {
  const mine = holdings.filter((h) => baseCode(h.symbol) === baseCode(selected));
  const shares = mine.reduce((a, h) => a + h.shares, 0);
  const cost = mine.reduce((a, h) => a + h.cost * h.shares, 0);
  const pnl = price != null && cost ? price * shares - cost : null;
  const by = new Map<string, { value: number; pnl: number; market: string; symbol: string; name: string }>();
  let missing = 0;
  for (const h of holdings) {
    const hq = quotes[baseCode(h.symbol)];
    const currency = hq?.currency || currencyOf(h.symbol);
    const mult = currency === 'TWD' ? 1 : (fx?.[currency] ?? null);
    if (hq?.price == null || mult == null) {
      missing += 1;
      continue;
    }
    const k = baseCode(h.symbol);
    const cur = by.get(k) || { value: 0, pnl: 0, market: currency === 'TWD' ? '台幣' : '外幣', symbol: h.symbol, name: hq.name || k };
    cur.value += hq.price * h.shares * mult;
    cur.pnl += (hq.price - h.cost) * h.shares * mult;
    by.set(k, cur);
  }
  const rows = Array.from(by, ([, v]) => ({ label: v.name, ...v }));
  const total = rows.reduce((a, r) => a + r.value, 0);
  const twd = rows.filter((r) => r.market === '台幣').reduce((a, r) => a + r.value, 0);
  return (
    <div>
      {mine.length ? (
        <div className="grid [grid-template-columns:repeat(auto-fit,minmax(120px,1fr))] gap-2">
          <Kv label="持有股數">{fmt(shares, Number.isInteger(shares) ? 0 : 4)}</Kv>
          <Kv label="均價">{fmt(shares ? cost / shares : 0)}</Kv>
          <Kv label="市值">{price == null ? '--' : fmt(price * shares, 0)}</Kv>
          <Kv label="未實現損益" cls={colorOf(pnl)}>
            {pnl == null ? '--' : `${pnl > 0 ? '+' : ''}${fmt(pnl, 0)}（${pnl > 0 ? '+' : ''}${fmt((pnl / cost) * 100)}%）`}
          </Kv>
          <button
            type="button"
            onClick={onSell}
            className="[grid-column:1/-1] px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-200 hover:bg-white/10 cursor-pointer"
          >
            賣出這檔
          </button>
        </div>
      ) : (
        <div className="text-xs text-slate-400">這檔目前沒有持股。可用上方「加入我的持股」或下單買進建立部位。</div>
      )}
      {total > 0 && (
        <>
          <div className="text-[11.5px] text-slate-400 mt-3 mb-2">全部持股配置（換算台幣）・總市值 {fmt(total, 0)}</div>
          <Donut
            items={topSlices(rows.map((r) => ({ label: r.label, value: r.value })))}
            center={`${fmt(total / 1e4, 0)}萬`}
            sub="總市值(台幣)"
            label="持股配置圓餅圖"
            size={130}
          />
          <div className="text-[11.5px] text-slate-400 my-2">
            台幣計價 {fmt((twd / total) * 100, 0)}%／外幣計價 {fmt(((total - twd) / total) * 100, 0)}%（外幣用即時匯率換算）
            {missing > 0 && `；${missing} 筆查無報價或匯率，未計入`}
          </div>
          <HBars
            items={[...rows].sort((a, b) => b.pnl - a.pnl).map((r) => ({ label: r.label, value: r.pnl, id: r.symbol }))}
            format={(v) => `${v > 0 ? '+' : ''}${(v / 1e4).toFixed(1)}萬`}
            onPick={onPick}
          />
        </>
      )}
    </div>
  );
}

export { DepthBody, HoldBody, Kv, NewsBody, Rng, StatsBody };
