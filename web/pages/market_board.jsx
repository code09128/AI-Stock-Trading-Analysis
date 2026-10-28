// 大盤籌碼頁：開盤前先看國際指數、台指期、資金流向、產業強弱與台灣 50，再決定今天怎麼操作。
// 資料：/api/board/world（國際指數＋台指期，30 秒）、/api/board/tw50（30 秒）、
//       /api/board/sectors、/api/board/flow（證交所盤後資料，10 分鐘）
(() => {
  const { useState, useEffect, useCallback, useRef } = React;
  const { fmt, colorOf, Tip } = window.TA;

  // 定時抓一個 GET 端點：上一輪還沒回來就跳過；頁面離開就停止
  function usePoll(url, ms) {
    const [data, setData] = useState(null);
    const [err, setErr] = useState('');
    const [loading, setLoading] = useState(false);
    const busy = useRef(false);
    const load = useCallback(() => {
      if (busy.current) return;
      busy.current = true;
      setLoading(true);
      fetch(url)
        .then((r) => r.json())
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
    }, [url]);
    useEffect(() => {
      load();
      const id = setInterval(load, ms);
      return () => clearInterval(id);
    }, [load, ms]);
    return { data, err, loading, load };
  }

  const sign = (v, d = 2) => (v === null || v === undefined ? '--' : `${v > 0 ? '+' : ''}${fmt(v, d)}`);
  const Arrow = ({ v }) => (v > 0 ? '▲' : v < 0 ? '▼' : '');

  function Card({ title, tip, extra, children }) {
    return (
      <section className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 space-y-3 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold text-white">{title}</h2>
          {tip && <Tip text={tip} />}
          <div className="ml-auto flex items-center gap-2 text-[11px] text-slate-500">{extra}</div>
        </div>
        {children}
      </section>
    );
  }

  const Refresh = ({ poll }) => (
    <button
      type="button"
      onClick={poll.load}
      disabled={poll.loading}
      className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 cursor-pointer"
    >
      {poll.loading ? '更新中…' : `↻ ${poll.data?.timestamp || '更新'}`}
    </button>
  );

  const Err = ({ text }) => (text ? <div className="text-xs text-rose-300">⚠️ {text}</div> : null);
  const Wait = ({ poll }) => (!poll.data && !poll.err ? <div className="text-xs text-slate-500">載入中…</div> : null);

  // ---------- 功能說明 ----------
  function BoardHelp() {
    const H = ({ children }) => <b className="text-white">{children}</b>;
    return (
      <details className="bg-slate-900/70 border border-slate-800 rounded-2xl px-5 py-3 text-xs text-slate-300">
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
              <H>資金流向</H>：最近 5 個交易日三大法人（外資、投信、自營商）在上市市場的買賣超金額（億元），
              以及今天成交金額集中在哪些類股（占比越高＝資金越集中）。
            </li>
            <li>
              <H>產業漲跌排行</H>：證交所各類股指數依漲跌幅排序，強勢族群浮在上面。
              <b>量比</b>＝類股成交金額 ÷ 前一交易日，大於 1 代表比昨天熱絡。可點欄位標題換排序。
            </li>
            <li>
              <H>台灣 50</H>：上市市值前 50 大個股（接近台灣 50 指數成分股），盤中每 30 秒更新價格。
              <b>量比</b>＝今天累計成交量 ÷ 前一交易日成交量（盤中還沒收完，數字會一路變大）。
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
  function FuturesRow({ label, f }) {
    return (
      <div className="bg-slate-950/60 border border-slate-800 rounded-xl px-3 py-2 min-w-0">
        <div className="text-[11px] text-slate-400">
          {label}・{f?.name || '台指期'}
        </div>
        {f?.price != null ? (
          <>
            <div className={`mono text-lg font-bold ${colorOf(f.change)}`}>{fmt(f.price, 0)}</div>
            <div className={`mono text-xs ${colorOf(f.change)}`}>
              <Arrow v={f.change} /> {fmt(Math.abs(f.change ?? 0), 0)}（{sign(f.change_pct)}%）
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
    return (
      <Card
        title="國際指數與台指期"
        tip="美股、美股期貨、亞洲指數、美元指數；台指期分日盤與夜盤，價差＝台指期日盤 − 加權指數。每 30 秒更新。"
        extra={<Refresh poll={poll} />}
      >
        <Err text={poll.err} />
        <Wait poll={poll} />
        {d && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <FuturesRow label="日盤" f={fut.day} />
              <FuturesRow label="夜盤" f={fut.night} />
              <div className="bg-slate-950/60 border border-slate-800 rounded-xl px-3 py-2">
                <div className="text-[11px] text-slate-400">
                  價差（期貨 − 加權）
                  <Tip text="台指期近月日盤價格減加權指數。正價差＝期貨比現貨高，市場偏樂觀；逆價差＝偏悲觀。除息旺季（6～9 月）期貨會因為預期除息而自然偏低。" />
                </div>
                <div className={`mono text-lg font-bold ${colorOf(fut.basis)}`}>{sign(fut.basis, 0)}</div>
                <div className="text-[10px] text-slate-500">
                  {fut.basis > 0 ? '正價差' : fut.basis < 0 ? '逆價差' : '--'}
                </div>
              </div>
            </div>
            <table className="w-full text-xs">
              <tbody>
                {(d.groups || []).map((g) =>
                  g.rows.map((r, i) => (
                    <tr key={r.symbol} className="border-t border-slate-800/60">
                      <td className="py-1 pr-2 text-slate-500 w-16 align-top">{i === 0 ? g.name : ''}</td>
                      <td className="py-1 pr-2 text-slate-200">{r.name}</td>
                      {r.price != null ? (
                        <>
                          <td className="py-1 pr-2 mono text-right text-white">
                            {fmt(r.price, r.symbol === 'TWD=X' ? 3 : 2)}
                          </td>
                          <td className={`py-1 pr-2 mono text-right ${colorOf(r.change)}`}>{sign(r.change)}</td>
                          <td className={`py-1 mono text-right ${colorOf(r.change)}`}>{sign(r.change_pct)}%</td>
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
            <div className="text-[10px] text-slate-500">來源：{d.source}</div>
          </>
        )}
      </Card>
    );
  }

  // ---------- 資金流向 ----------
  const INST = [
    ['foreign', '外資'],
    ['trust', '投信'],
    ['dealer', '自營商'],
    ['total', '合計'],
  ];

  function FlowCard({ sectors }) {
    const poll = usePoll('/api/board/flow', 600000);
    const days = poll.data?.days || [];
    const shares = [...(sectors?.rows || [])]
      .filter((r) => r.turnover_share_pct != null)
      .sort((a, b) => b.turnover_share_pct - a.turnover_share_pct)
      .slice(0, 8);
    const maxShare = shares[0]?.turnover_share_pct || 1;
    return (
      <Card
        title="資金流向"
        tip="上：最近 5 個交易日三大法人在上市市場的買賣超（億元，紅＝買超、綠＝賣超）。下：今天成交金額最集中的類股。證交所收盤後更新。"
        extra={<Refresh poll={poll} />}
      >
        <Err text={poll.err} />
        <Wait poll={poll} />
        {days.length > 0 && (
          <table className="w-full text-xs">
            <thead>
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
              {days.map((d) => (
                <tr key={d.date} className="border-t border-slate-800/60">
                  <td className="py-1 mono text-slate-300">{d.date.slice(5)}</td>
                  {INST.map(([k]) => (
                    <td
                      key={k}
                      className={`py-1 mono text-right ${colorOf(d[k])} ${k === 'total' ? 'font-semibold' : ''}`}
                    >
                      {sign(d[k])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {shares.length > 0 && (
          <div className="space-y-1 pt-1">
            <div className="text-[11px] text-slate-400">
              類股成交比重（{sectors.date}，前 8 名）
            </div>
            {shares.map((r) => (
              <div key={r.name} className="flex items-center gap-2 text-xs">
                <span className="w-24 shrink-0 truncate text-slate-300">{r.name}</span>
                <div className="flex-1 h-2.5 bg-slate-800 rounded">
                  <div
                    className="h-2.5 rounded bg-sky-500/70"
                    style={{ width: `${(r.turnover_share_pct / maxShare) * 100}%` }}
                  />
                </div>
                <span className="w-14 text-right mono text-slate-200">{fmt(r.turnover_share_pct, 1)}%</span>
                <span className={`w-14 text-right mono ${colorOf(r.change_pct)}`}>{sign(r.change_pct)}%</span>
              </div>
            ))}
          </div>
        )}
        <div className="text-[10px] text-slate-500">
          單位：億元・來源：{poll.data?.source || '證交所'}
        </div>
      </Card>
    );
  }

  // ---------- 可排序表格的欄位標題 ----------
  function SortTh({ k, label, sort, setSort, align = 'text-right' }) {
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
  const sortRows = (rows, sort) =>
    [...rows].sort((a, b) => {
      const x = a[sort.key];
      const y = b[sort.key];
      if (x == null) return 1;
      if (y == null) return -1;
      return sort.desc ? y - x : x - y;
    });

  // ---------- 產業漲跌排行 ----------
  function SectorCard({ poll }) {
    const [sort, setSort] = useState({ key: 'change_pct', desc: true });
    const rows = sortRows(poll.data?.rows || [], sort);
    const maxAbs = Math.max(1, ...rows.map((r) => Math.abs(r.change_pct || 0)));
    return (
      <Card
        title="產業漲跌排行"
        tip="證交所各類股指數的漲跌幅（上市，細分類）。量比＝類股成交金額 ÷ 前一交易日。點欄位標題可換排序。證交所收盤後更新。"
        extra={
          <>
            {poll.data?.date && <span>{poll.data.date}</span>}
            <Refresh poll={poll} />
          </>
        }
      >
        <Err text={poll.err} />
        <Wait poll={poll} />
        {rows.length > 0 && (
          <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
            <table className="w-full text-xs whitespace-nowrap">
              <thead className="sticky top-0 bg-slate-900">
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
                {rows.map((r) => (
                  <tr key={r.name} className="border-t border-slate-800/60">
                    <td className="py-1 px-1.5 text-slate-200">{r.name}</td>
                    <td className={`py-1 px-1.5 mono text-right ${colorOf(r.change_pct)}`}>{sign(r.change_pct)}%</td>
                    <td className="py-1 px-1.5">
                      <div className="relative h-2 bg-slate-800/60 rounded">
                        <div
                          className={`absolute top-0 h-2 rounded ${r.change_pct >= 0 ? 'left-1/2 bg-rose-500/70' : 'right-1/2 bg-emerald-500/70'}`}
                          style={{ width: `${(Math.abs(r.change_pct || 0) / maxAbs) * 50}%` }}
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
      </Card>
    );
  }

  // ---------- 台灣 50 ----------
  function Tw50Card() {
    const poll = usePoll('/api/board/tw50', 30000);
    const [sort, setSort] = useState({ key: 'market_cap', desc: true });
    const d = poll.data;
    const rows = sortRows(d?.rows || [], sort);
    return (
      <Card
        title="台灣 50 成分股"
        tip="上市市值前 50 大（不含 ETF），接近台灣 50 指數成分股。量比＝今天累計成交量 ÷ 前一交易日成交量。點欄位標題可換排序，每 30 秒更新。"
        extra={
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
              <thead className="sticky top-0 bg-slate-900">
                <tr className="text-slate-400">
                  <th className="py-1.5 px-1.5 text-left font-normal">代號</th>
                  <th className="py-1.5 px-1.5 text-left font-normal">名稱</th>
                  <SortTh k="price" label="成交價" sort={sort} setSort={setSort} />
                  <SortTh k="change_pct" label="漲跌%" sort={sort} setSort={setSort} />
                  <SortTh k="volume_ratio" label="量比" sort={sort} setSort={setSort} />
                  <SortTh k="volume" label="成交量(張)" sort={sort} setSort={setSort} />
                  <SortTh k="market_cap" label="市值(億)" sort={sort} setSort={setSort} />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.code} className="border-t border-slate-800/60" title={`資料時間 ${r.quote_time}`}>
                    <td className="py-1 px-1.5 mono text-slate-400">{r.code}</td>
                    <td className="py-1 px-1.5 text-slate-200">
                      {r.name}
                      {!r.is_live && <span className="ml-1 text-[10px] text-slate-500">收盤</span>}
                    </td>
                    <td className={`py-1 px-1.5 mono text-right ${colorOf(r.change)}`}>{fmt(r.price)}</td>
                    <td className={`py-1 px-1.5 mono text-right ${colorOf(r.change)}`}>{sign(r.change_pct)}%</td>
                    <td
                      className={`py-1 px-1.5 mono text-right ${r.volume_ratio >= 1 ? 'text-amber-300' : 'text-slate-400'}`}
                    >
                      {r.volume_ratio != null ? fmt(r.volume_ratio, 2) : '--'}
                    </td>
                    <td className="py-1 px-1.5 mono text-right text-slate-300">{fmt(r.volume, 0)}</td>
                    <td className="py-1 px-1.5 mono text-right text-slate-300">{fmt(r.market_cap, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {d?.note && <div className="text-[10px] text-slate-500">{d.note}</div>}
      </Card>
    );
  }

  function MarketBoardPage() {
    // 產業排行與資金流向共用類股資料（同一份請求）
    const sectors = usePoll('/api/board/sectors', 600000);
    return (
      <div className="space-y-4">
        <BoardHelp />
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <WorldCard />
          <FlowCard sectors={sectors.data} />
          <SectorCard poll={sectors} />
          <Tw50Card />
        </div>
      </div>
    );
  }

  window.TA = Object.assign(window.TA || {}, { MarketBoardPage });
})();
