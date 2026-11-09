// 大盤籌碼頁：開盤前先看國際指數、台指期、資金流向、產業強弱與台灣 50，再決定今天怎麼操作。
// 資料：/api/board/world（國際指數＋台指期，30 秒）、/api/board/tw50（30 秒）、
//       /api/board/sectors、/api/board/flow（證交所盤後資料，10 分鐘）
import { Tip, colorOf, fmt, signed } from '../ui';
import { PCard, PageHead } from './card_box';
import { Donut, HBars, VBars, topSlices } from './mini_charts';
import { openInWatch } from './watch';
import { pollEvery } from '../desktop_bridge';
import { cachedJson } from '../fetch_cache';
import { Sparkline } from '../live_widgets';

const { useState, useEffect, useCallback, useRef } = React;

// 定時抓一個 GET 端點：上一輪還沒回來就跳過；頁面離開就停止
function usePoll(url: string, ms: number) {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const busy = useRef(false);
  const load = useCallback((force?: boolean) => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    // 離開再回來不用全部重抓：快取時間比輪詢短一點，輪詢照常更新；按 ↻ 一定重抓
    cachedJson(url, undefined, force === true ? 0 : ms - 2000)
      .then((d) => {
        if (d.error && !(d.rows || d.days || d.groups || []).length) setErr(d.error);
        else setErr('');
        setData(d);
      })
      .catch((e) => setErr(e.message || String(e)))
      .finally(() => {
        busy.current = false;
        setLoading(false);
      });
  }, [url, ms]);
  useEffect(() => {
    load();
    return pollEvery(() => load(), ms);
  }, [load, ms]);
  return { data, err, loading, load };
}

const Arrow = ({ v }: { v: number }) => (v > 0 ? '▲' : v < 0 ? '▼' : '');

const Refresh = ({ poll }: { poll: any }) => (
  <button
    type="button"
    onClick={() => poll.load(true)}
    disabled={poll.loading}
    className="px-2 py-0.5 rounded-lg bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10 cursor-pointer text-[11px]"
  >
    {poll.loading ? '更新中…' : `↻ ${poll.data?.timestamp || '更新'}`}
  </button>
);

const Err = ({ text }: { text: string }) => (text ? <div className="text-xs text-rose-300">⚠️ {text}</div> : null);
const Wait = ({ poll }: { poll: any }) => (!poll.data && !poll.err ? <div className="text-xs text-slate-500">載入中…</div> : null);

// ---------- 功能說明 ----------
function BoardHelp() {
  const H = ({ children }: { children: any }) => <b className="text-white">{children}</b>;
  return (
    <details className="ta-card rounded-2xl px-5 py-3 text-xs text-slate-300">
      <summary className="cursor-pointer font-semibold text-slate-200 select-none">📘 這頁怎麼用（功能說明）</summary>
      <div className="mt-3 space-y-3 leading-relaxed">
        <p>
          <H>這頁在做什麼</H>：開盤前（或盤中）先看整體環境：國際股市和美股期貨昨晚怎麼走、台指期夜盤怎麼反應、
          法人在買還是賣、哪些產業最強，再決定今天要積極還是保守。
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <H>國際指數與台指期</H>：美股、美股期貨、亞洲主要指數、美元指數與台幣匯率。台指期分<b>日盤</b>
            （08:45–13:45）與<b>夜盤</b>（15:00–隔天 05:00），夜盤反映美股時段的消息；
            <b>價差</b>＝台指期日盤 − 加權指數，正數代表期貨比現貨貴（偏樂觀）。每 30 秒更新。
          </li>
          <li>
            <H>三大法人與外資 10 日</H>：最近 10 個交易日三大法人（外資、投信、自營商）在上市市場的買賣超金額（億元），
            並單獨列出外資近 10 日買賣超直條圖與累計動能。
          </li>
          <li>
            <H>產業漲跌排行與資金流向</H>：證交所各類股指數依漲跌幅排序，並用圓餅與橫條顯示今天成交金額集中在哪些類股（占比越高＝資金越集中）。
            <b>量比</b>＝類股成交金額 ÷ 前一交易日，大於 1 代表比昨天熱絡。可點欄位標題換排序，點類股可切到產業鏈頁。
          </li>
          <li>
            <H>台灣 50 與產業權重</H>：上市市值前 50 大個股（接近台灣 50 指數成分股），盤中每 30 秒更新價格並統計各產業市值權重。
            <b>量比</b>＝今天累計成交量 ÷ 前一交易日成交量（盤中還沒收完，數字會一路變大）。
            點股票名稱會切到看盤頁看那一檔的五檔、新聞並可模擬下單。
          </li>
        </ul>
        <p className="text-slate-400">
          資料時間：產業排行、類股成交與三大法人是證交所<b>收盤後</b>公布（約 14:30～15:00），
          之前顯示最近一個交易日（卡片右上角有日期）。國際指數來自 Yahoo，非美股市場可能延遲 15–20 分鐘。
          所有資料都是公開來源，不需要金鑰，也不會用到 FinMind 額度。
        </p>
      </div>
    </details>
  );
}

// ---------- 國際指數與台指期 ----------
function FuturesTile({ label, f }: { label: string; f: any }) {
  return (
    <div className="rounded-xl bg-white/[0.025] border border-white/[0.06] px-3 py-2.5 min-w-0">
      <div className="text-[11px] text-slate-400 truncate">
        {label}・{f?.name || '台指期'}
      </div>
      {f?.price != null ? (
        <>
          <div className={`mono text-base font-extrabold mt-0.5 ${colorOf(f.change)}`}>{fmt(f.price, 0)}</div>
          <div className={`mono text-xs ${colorOf(f.change)}`}>
            <Arrow v={f.change} /> {fmt(Math.abs(f.change ?? 0), 0)}（{signed(f.change_pct)}%）
          </div>
          <div className="text-[10px] text-slate-500 truncate">
            量 {fmt(f.volume, 0)} 口・{f.quote_time || '--'}
          </div>
        </>
      ) : (
        <div className="text-xs text-slate-500 mt-1">{f?.error || '沒有資料'}</div>
      )}
    </div>
  );
}

function WorldCard() {
  const poll = usePoll('/api/board/world', 30000);
  const d = poll.data;
  const fut = d?.futures || {};
  const flatRows = (d?.groups || []).flatMap((g: any) => (g.rows || []).map((r: any) => ({ ...r, group: g.name })));
  // 走勢小圖只查 Yahoo 有的代號（^ 指數、=F 期貨、=X 匯率）；日線小圖 10 分鐘更新一次就夠
  const sparkKey = flatRows.map((r: any) => r.symbol).filter((s: string) => /[\^=]/.test(s)).join(',');
  const [sparks, setSparks] = useState<Record<string, number[]>>({});
  useEffect(() => {
    if (!sparkKey) return undefined;
    let stop = false;
    cachedJson('/api/sparks', { symbols: sparkKey.split(',') }, 600000)
      .then((x) => !stop && setSparks(x.sparks || {}))
      .catch(() => {});
    return () => {
      stop = true;
    };
  }, [sparkKey]);
  return (
    <PCard
      id="board-world"
      span={12}
      title="國際指數與台指期"
      sub="美股／亞股／匯率／VIX／台指期日夜盤與價差"
      tip={<Tip text="美股、美股期貨、亞洲指數、美元指數；台指期分日盤與夜盤，價差＝台指期日盤 − 加權指數。每 30 秒更新。" />}
      right={<Refresh poll={poll} />}
    >
      <Err text={poll.err} />
      <Wait poll={poll} />
      {d && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-2.5">
            {flatRows.map((r: any) => (
              <div key={r.symbol} className="rounded-xl bg-white/[0.025] border border-white/[0.06] px-3 py-2.5 min-w-0">
                <div className="flex items-center justify-between gap-1 text-[11px] text-slate-400">
                  <span className="truncate">{r.name}</span>
                  <span className="text-[10px] text-slate-500 shrink-0">{r.group}</span>
                </div>
                {r.price != null ? (
                  <>
                    <div className="mono text-base font-extrabold text-slate-100 mt-0.5">
                      {fmt(r.price, r.symbol === 'TWD=X' ? 3 : 2)}
                    </div>
                    <div className={`mono text-xs font-semibold ${colorOf(r.change)}`}>
                      {signed(r.change)}（{signed(r.change_pct)}%）
                    </div>
                    {sparks[r.symbol]?.length > 1 && (
                      <div className="mt-1">
                        <Sparkline values={sparks[r.symbol]} w={110} h={24} />
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-xs text-slate-500 mt-1 truncate">{r.error || '沒有資料'}</div>
                )}
              </div>
            ))}
            <FuturesTile label="日盤" f={fut.day} />
            <FuturesTile label="夜盤" f={fut.night} />
            <div className="rounded-xl bg-white/[0.025] border border-white/[0.06] px-3 py-2.5 min-w-0">
              <div className="text-[11px] text-slate-400 flex items-center gap-1">
                <span>價差（期貨 − 加權）</span>
                <Tip text="台指期近月日盤價格減加權指數。正價差＝期貨比現貨高，市場偏樂觀；逆價差＝偏悲觀。除息旺季（6～9 月）期貨會因為預期除息而自然偏低。" />
              </div>
              <div className={`mono text-base font-extrabold mt-0.5 ${colorOf(fut.basis)}`}>{signed(fut.basis, 0)}</div>
              <div className="text-[11px] text-slate-400">
                {fut.basis > 0 ? '正價差（偏多）' : fut.basis < 0 ? '逆價差（偏保守）' : '--'}
              </div>
            </div>
          </div>
          <details className="text-xs text-slate-400">
            <summary className="cursor-pointer hover:text-slate-200 select-none">展開分組明細表</summary>
            <table className="w-full text-xs mt-2">
              <tbody>
                {(d.groups || []).map((g: any) =>
                  g.rows.map((r: any, i: number) => (
                    <tr key={r.symbol} className="border-t border-slate-800/60">
                      <td className="py-1 pr-2 text-slate-500 w-16 align-top">{i === 0 ? g.name : ''}</td>
                      <td className="py-1 pr-2 text-slate-200">{r.name}</td>
                      {r.price != null ? (
                        <>
                          <td className="py-1 pr-2 mono text-right text-white">
                            {fmt(r.price, r.symbol === 'TWD=X' ? 3 : 2)}
                          </td>
                          <td className={`py-1 pr-2 mono text-right ${colorOf(r.change)}`}>{signed(r.change)}</td>
                          <td className={`py-1 mono text-right ${colorOf(r.change)}`}>{signed(r.change_pct)}%</td>
                        </>
                      ) : (
                        <td colSpan={3} className="py-1 text-right text-slate-500">
                          {r.error || '沒有資料'}
                        </td>
                      )}
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </details>
          <div className="text-[10px] text-slate-500">來源：{d.source}</div>
        </>
      )}
    </PCard>
  );
}

// ---------- 三大法人與外資近 10 日 ----------
const INST: [string, string][] = [
  ['foreign', '外資'],
  ['trust', '投信'],
  ['dealer', '自營商'],
  ['total', '合計'],
];

function InstFlowCard({ poll }: { poll: any }) {
  const days = poll.data?.days || [];
  const latest = days[0];
  const barItems = latest
    ? INST.map(([k, label]) => ({
        label,
        value: Number(latest[k] || 0),
      }))
    : [];
  return (
    <PCard
      id="board-inst"
      span={4}
      title="三大法人買賣超（億元）"
      sub={latest ? `${latest.date} 盤後` : '證交所盤後統計'}
      tip={<Tip text="圖：最近交易日三大法人（外資、投信、自營商）在上市市場的買賣超；表：最近 10 個交易日（億元，紅＝買超、綠＝賣超）。證交所每日收盤後更新。" />}
      right={<Refresh poll={poll} />}
    >
      <Err text={poll.err} />
      <Wait poll={poll} />
      {barItems.length > 0 && <VBars items={barItems} height={150} unit="億" label="三大法人買賣超直條圖" />}
      {days.length > 0 && (
        <div className="overflow-x-auto max-h-44 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-900/95">
              <tr className="text-slate-400">
                <th className="py-1 text-left font-normal">日期</th>
                {INST.map(([k, label]) => (
                  <th key={k} className="py-1 text-right font-normal">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {days.map((d: any) => (
                <tr key={d.date} className="border-t border-slate-800/60">
                  <td className="py-1 mono text-slate-300">{d.date.slice(5)}</td>
                  {INST.map(([k]) => (
                    <td
                      key={k}
                      className={`py-1 mono text-right ${colorOf(d[k])} ${k === 'total' ? 'font-semibold' : ''}`}
                    >
                      {signed(d[k])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="text-[10px] text-slate-500">單位：億元・來源：{poll.data?.source || '證交所'}</div>
    </PCard>
  );
}

function Foreign10dCard({ poll }: { poll: any }) {
  const days = [...(poll.data?.days || [])].slice(0, 10).reverse();
  const sum = days.reduce((a, d) => a + Number(d.foreign || 0), 0);
  const items = days.map((d: any) => ({
    label: String(d.date || '').slice(5).replace('-', '/'),
    value: Number(d.foreign || 0),
  }));
  return (
    <PCard
      id="board-foreign10"
      span={4}
      title="外資近 10 日買賣超"
      sub={days.length ? `近 ${days.length} 日累計 ${signed(sum, 1)} 億` : '載入中'}
      tip={<Tip text="外資及陸資最近 10 個交易日每日買賣超金額（億元），由舊到新排列，觀察外資連續買超或調節趨勢。" />}
      right={<Refresh poll={poll} />}
    >
      <Err text={poll.err} />
      <Wait poll={poll} />
      {items.length > 0 ? (
        <VBars items={items} height={180} label="外資近 10 日買賣超直條圖" />
      ) : (
        !poll.loading && <div className="text-xs text-slate-500">尚無外資近 10 日資料</div>
      )}
      {items.length > 0 && items.length < 10 && (
        <div className="text-[11px] text-amber-300">目前只有 {items.length} 日資料（舊版後端只回 5 日，要重新安裝新版才有 10 日）。</div>
      )}
      <div className="text-[10px] text-slate-500">單位：億元・來源：證交所 BFI82U</div>
    </PCard>
  );
}

function Tw50IndustryWeightCard({ poll }: { poll: any }) {
  const rows = poll.data?.rows || [];
  const byInd = new Map<string, number>();
  for (const r of rows) {
    const ind = r.industry || '其他';
    const w = Number(r.weight_pct ?? r.market_cap ?? 0);
    if (w > 0) byInd.set(ind, (byInd.get(ind) || 0) + w);
  }
  const slices = topSlices(
    Array.from(byInd.entries()).map(([label, value]) => ({ label, value })),
    5,
  );
  return (
    <PCard
      id="board-tw50-weight"
      span={4}
      title="台灣 50 權值股產業權重"
      sub={poll.data?.rank_date ? `${poll.data.rank_date} 市值加權` : '上市前 50 大市值占比'}
      tip={<Tip text="統計台灣 50（上市市值前 50 大）成分股在各產業的市值權重占比。" />}
    >
      <Err text={poll.err} />
      <Wait poll={poll} />
      {rows.length > 0 && !rows.some((r: any) => r.industry) ? (
        <div className="text-xs text-amber-300">這個版本的後端沒有產業資料（要重新安裝新版才有）。</div>
      ) : slices.length > 0 ? (
        <Donut items={slices} size={156} center="TW50" sub="產業占比" label="台灣 50 權值股產業權重圓餅圖" />
      ) : (
        !poll.loading && <div className="text-xs text-slate-500">尚無產業權重資料</div>
      )}
    </PCard>
  );
}

// ---------- 可排序表格的欄位標題 ----------
function SortTh({ k, label, sort, setSort, align = 'text-right' }: any) {
  const on = sort.key === k;
  return (
    <th className={`py-1.5 px-1.5 font-normal ${align}`}>
      <button
        type="button"
        onClick={() => setSort({ key: k, desc: on ? !sort.desc : true })}
        className={`cursor-pointer hover:text-white ${on ? 'text-sky-300' : ''}`}
      >
        {label}
        {on ? (sort.desc ? ' ▼' : ' ▲') : ''}
      </button>
    </th>
  );
}
const sortRows = (rows: any[], sort: { key: string; desc: boolean }) =>
  [...rows].sort((a, b) => {
    const x = a[sort.key];
    const y = b[sort.key];
    if (x == null) return 1;
    if (y == null) return -1;
    return sort.desc ? y - x : x - y;
  });

// ---------- 產業漲跌排行 ----------
function SectorCard({ poll }: { poll: any }) {
  const [sort, setSort] = useState({ key: 'change_pct', desc: true });
  const raw = poll.data?.rows || [];
  const rows = sortRows(raw, sort);
  const maxAbs = Math.max(1, ...raw.map((r: any) => Math.abs(r.change_pct || 0)));
  const topBot = raw.length > 8 ? [...raw.slice(0, 4), ...raw.slice(-4)] : raw;
  const goChains = () => {
    location.hash = '#chains';
  };
  return (
    <PCard
      id="board-sectors"
      span={6}
      title="產業漲跌排行"
      sub="點類股可切到產業鏈地圖"
      tip={<Tip text="證交所各類股指數的漲跌幅（上市，細分類）。量比＝類股成交金額 ÷ 前一交易日。點欄位標題可換排序。證交所收盤後更新。" />}
      right={
        <>
          {poll.data?.date && <span>{poll.data.date}</span>}
          <Refresh poll={poll} />
        </>
      }
    >
      <Err text={poll.err} />
      <Wait poll={poll} />
      {topBot.length > 0 && (
        <HBars
          items={topBot.map((r: any) => ({
            id: r.name,
            label: r.name,
            value: Number(r.change_pct || 0),
          }))}
          format={(v) => `${signed(v)}%`}
          onPick={goChains}
        />
      )}
      {rows.length > 0 && (
        <div className="overflow-x-auto max-h-[360px] overflow-y-auto">
          <table className="w-full text-xs whitespace-nowrap">
            <thead className="sticky top-0 bg-slate-900/95 z-10">
              <tr className="text-slate-400">
                <th className="py-1.5 px-1.5 text-left font-normal">類股</th>
                <SortTh k="change_pct" label="漲跌%" sort={sort} setSort={setSort} />
                <th className="py-1.5 px-1.5 font-normal w-24" aria-label="漲跌幅長條" />
                <SortTh k="turnover" label="成交(億)" sort={sort} setSort={setSort} />
                <SortTh k="turnover_share_pct" label="比重" sort={sort} setSort={setSort} />
                <SortTh k="turnover_ratio" label="量比" sort={sort} setSort={setSort} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any) => (
                <tr key={r.name} className="border-t border-slate-800/60 hover:bg-white/[0.02]">
                  <td className="py-1 px-1.5 text-slate-200">
                    <button type="button" onClick={goChains} className="hover:text-sky-300 hover:underline cursor-pointer text-left">
                      {r.name}
                    </button>
                  </td>
                  <td className={`py-1 px-1.5 mono text-right ${colorOf(r.change_pct)}`}>{signed(r.change_pct)}%</td>
                  <td className="py-1 px-1.5">
                    <div className="relative h-2 bg-slate-800/60 rounded">
                      <div
                        className={`absolute top-0 h-2 rounded ${r.change_pct >= 0 ? 'left-1/2' : 'right-1/2'}`}
                        style={{
                          width: `${(Math.abs(r.change_pct || 0) / maxAbs) * 50}%`,
                          background: r.change_pct >= 0 ? 'var(--up)' : 'var(--down)',
                        }}
                      />
                    </div>
                  </td>
                  <td className="py-1 px-1.5 mono text-right text-slate-300">
                    {r.turnover != null ? fmt(r.turnover / 1e8, 0) : '--'}
                  </td>
                  <td className="py-1 px-1.5 mono text-right text-slate-300">
                    {r.turnover_share_pct != null ? `${fmt(r.turnover_share_pct, 1)}%` : '--'}
                  </td>
                  <td
                    className={`py-1 px-1.5 mono text-right ${r.turnover_ratio >= 1 ? 'text-amber-300' : 'text-slate-400'}`}
                  >
                    {r.turnover_ratio != null ? fmt(r.turnover_ratio, 2) : '--'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {poll.data?.source && <div className="text-[10px] text-slate-500">來源：{poll.data.source}</div>}
    </PCard>
  );
}

// ---------- 資金流向（類股成交比重） ----------
function SectorShareCard({ poll }: { poll: any }) {
  const sectors = poll.data;
  const shares = [...(sectors?.rows || [])]
    .filter((r: any) => r.turnover_share_pct != null)
    .sort((a: any, b: any) => b.turnover_share_pct - a.turnover_share_pct);
  const top8 = shares.slice(0, 8);
  const maxShare = top8[0]?.turnover_share_pct || 1;
  const slices = topSlices(
    shares.map((r: any) => ({ label: r.name, value: Number(r.turnover_share_pct || 0) })),
    6,
  );
  return (
    <PCard
      id="board-flow-share"
      span={6}
      title="資金流向：類股成交比重"
      sub={sectors?.date ? `${sectors.date} 前 8 大成交類股` : '證交所盤後統計'}
      tip={<Tip text="今天成交金額最集中的類股（占比越高＝市場資金越集中）。證交所收盤後更新。" />}
      right={<Refresh poll={poll} />}
    >
      <Err text={poll.err} />
      <Wait poll={poll} />
      {slices.length > 0 && (
        <Donut items={slices} size={140} center="成交" sub="類股比重" label="類股成交比重圓餅圖" />
      )}
      {top8.length > 0 && (
        <div className="space-y-1.5 pt-1">
          {top8.map((r: any) => (
            <div key={r.name} className="flex items-center gap-2 text-xs">
              <span className="w-24 shrink-0 truncate text-slate-300">{r.name}</span>
              <div className="flex-1 h-2.5 bg-white/5 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[#4f7cff] to-[#8b5cf6]"
                  style={{ width: `${(r.turnover_share_pct / maxShare) * 100}%` }}
                />
              </div>
              <span className="w-14 text-right mono text-slate-200">{fmt(r.turnover_share_pct, 1)}%</span>
              <span className={`w-14 text-right mono ${colorOf(r.change_pct)}`}>{signed(r.change_pct)}%</span>
            </div>
          ))}
        </div>
      )}
      <div className="text-[10px] text-slate-500">來源：證交所 BFIAMU 各類股成交金額比重</div>
    </PCard>
  );
}

// ---------- 台灣 50 ----------
function Tw50Card({ poll }: { poll: any }) {
  const [sort, setSort] = useState({ key: 'market_cap', desc: true });
  const d = poll.data;
  const rows = sortRows(d?.rows || [], sort);
  return (
    <PCard
      id="board-tw50"
      span={12}
      title="台灣 50 成分股"
      sub="點列跳個股看盤"
      tip={<Tip text="上市市值前 50 大（不含 ETF），接近台灣 50 指數成分股。量比＝今天累計成交量 ÷ 前一交易日成交量。點欄位標題可換排序，每 30 秒更新。" />}
      right={
        <>
          {d && <span>即時 {d.live_count}／{(d.rows || []).length} 檔</span>}
          <Refresh poll={poll} />
        </>
      }
    >
      <Err text={poll.err} />
      <Wait poll={poll} />
      {rows.length > 0 && (
        <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
          <table className="w-full text-xs whitespace-nowrap">
            <thead className="sticky top-0 bg-slate-900/95 z-10">
              <tr className="text-slate-400">
                <th className="py-1.5 px-1.5 text-left font-normal">代號</th>
                <th className="py-1.5 px-1.5 text-left font-normal">名稱</th>
                <th className="py-1.5 px-1.5 text-left font-normal">產業</th>
                <SortTh k="weight_pct" label="權重%" sort={sort} setSort={setSort} />
                <SortTh k="price" label="成交價" sort={sort} setSort={setSort} />
                <SortTh k="change_pct" label="漲跌%" sort={sort} setSort={setSort} />
                <SortTh k="volume_ratio" label="量比" sort={sort} setSort={setSort} />
                <SortTh k="volume" label="成交量(張)" sort={sort} setSort={setSort} />
                <SortTh k="market_cap" label="市值(億)" sort={sort} setSort={setSort} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any) => (
                <tr key={r.code} className="border-t border-slate-800/60 hover:bg-white/[0.02]" title={`資料時間 ${r.quote_time}`}>
                  <td className="py-1.5 px-1.5 mono font-bold text-slate-300">{r.code}</td>
                  <td className="py-1.5 px-1.5 text-slate-200">
                    <button
                      type="button"
                      onClick={() => openInWatch?.(r.code)}
                      title="到看盤頁看這檔的五檔、新聞與下單"
                      className="hover:text-sky-300 hover:underline cursor-pointer text-left font-medium"
                    >
                      {r.name}
                    </button>
                    {!r.is_live && <span className="ml-1 text-[10px] text-slate-500">收盤</span>}
                  </td>
                  <td className="py-1.5 px-1.5 text-slate-400">{r.industry || '其他'}</td>
                  <td className="py-1.5 px-1.5 mono text-right text-slate-300">
                    {r.weight_pct != null ? `${fmt(r.weight_pct, 2)}%` : '--'}
                  </td>
                  <td className={`py-1.5 px-1.5 mono text-right font-semibold ${colorOf(r.change)}`}>{fmt(r.price)}</td>
                  <td className={`py-1.5 px-1.5 mono text-right font-semibold ${colorOf(r.change)}`}>{signed(r.change_pct)}%</td>
                  <td
                    className={`py-1.5 px-1.5 mono text-right ${r.volume_ratio >= 1 ? 'text-amber-300' : 'text-slate-400'}`}
                  >
                    {r.volume_ratio != null ? fmt(r.volume_ratio, 2) : '--'}
                  </td>
                  <td className="py-1.5 px-1.5 mono text-right text-slate-300">{fmt(r.volume, 0)}</td>
                  <td className="py-1.5 px-1.5 mono text-right text-slate-300">{fmt(r.market_cap, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {d?.note && <div className="text-[10px] text-slate-500">{d.note}</div>}
    </PCard>
  );
}

function MarketBoardPage() {
  // 產業排行與資金流向共用類股資料；三大法人與外資 10 日共用 flow；產業權重與台灣 50 共用 tw50
  const sectors = usePoll('/api/board/sectors', 600000);
  const flow = usePoll('/api/board/flow', 600000);
  const tw50 = usePoll('/api/board/tw50', 30000);
  return (
    <div className="space-y-3.5" data-tour="board-root">
      <PageHead
        title="大盤籌碼"
        desc="開盤前先看國際指數、台指期、資金流向、產業強弱與台灣 50，再決定今天怎麼操作。"
      />
      <BoardHelp />
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3.5">
        <WorldCard />
        <InstFlowCard poll={flow} />
        <Foreign10dCard poll={flow} />
        <Tw50IndustryWeightCard poll={tw50} />
        <SectorCard poll={sectors} />
        <SectorShareCard poll={sectors} />
        <Tw50Card poll={tw50} />
      </div>
    </div>
  );
}

export { MarketBoardPage };
