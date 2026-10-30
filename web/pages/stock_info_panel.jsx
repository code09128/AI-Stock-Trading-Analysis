// 看盤頁：個股／ETF 基本資料與配息（右側分頁）＋ 配息月曆（左側分頁）
(() => {
  const { useState, useEffect } = React;
  const { fmt, signed, colorOf, baseCode } = window.TA;

  const CAT_STYLE = {
    STOCK: 'bg-sky-500/15 text-sky-300 border-sky-500/40',
    ETF: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
    BOND: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  };
  const CatChip = ({ cls }) =>
    cls ? (
      <span className={`text-[10px] px-1.5 py-0.5 rounded border ${CAT_STYLE[cls.category]}`}>
        {cls.label}
      </span>
    ) : null;

  const INFO_TIPS = {
    配息頻率:
      '依近 12 個月實際除息次數判斷：10 次以上月配、6 次雙月配、3–5 次季配、2 次半年配、1 次年配。',
    '近 12 月現金股利': '近 12 個月每股現金股利加總（以除息日計）。',
    '近 12 月殖利率': '近 12 個月現金股利 ÷ 現價。是「過去」的殖利率，不保證未來配息一樣多。',
    '近 12 月配息次數': '近 12 個月實際除息的次數。',
  };

  const MONTHS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
  const MonthStrip = ({ typical = [], last12 = [], nextMonth }) => (
    <div className="flex gap-1" role="img" aria-label="12 個月除息月份">
      {MONTHS.map((m, i) => {
        const n = i + 1;
        const hit = last12.includes(n);
        const usual = typical.includes(n);
        return (
          <div
            key={m}
            title={`${n} 月${hit ? '：近 12 個月有除息' : usual ? '：過去常在此月除息' : ''}`}
            className={`flex-1 min-w-[18px] text-center text-[10px] rounded py-0.5 mono border ${
              nextMonth === n ? 'border-amber-400 text-amber-200' : 'border-transparent'
            } ${hit ? 'bg-rose-500/25 text-rose-200 font-bold' : usual ? 'bg-slate-700/60 text-slate-300' : 'bg-slate-900 text-slate-600'}`}
          >
            {m}
          </div>
        );
      })}
    </div>
  );

  const KV = ({ k, v }) => (
    <div className="flex justify-between gap-3 py-1 border-b border-slate-800/70 text-xs">
      <span className="text-slate-400 shrink-0">{k}</span>
      <span className="text-slate-100 text-right break-all">{String(v)}</span>
    </div>
  );

  // 財報與市場預期：台股月營收＋季財報；美股 EPS 驚喜、分析師預估與上下修；規則分類的「預期差」
  const sgn = (v, d = 2) => signed(v, d, '%');
  const sgnCls = (v) => (v == null ? 'text-slate-500' : v >= 0 ? 'text-emerald-400' : 'text-rose-400');
  const GAP_STYLE = {
    可能已反映在股價: 'border-amber-500/40 bg-amber-500/5 text-amber-100',
    可能讓市場正向意外: 'border-emerald-500/40 bg-emerald-500/5 text-emerald-100',
    可能讓市場負向意外: 'border-rose-500/40 bg-rose-500/5 text-rose-100',
  };
  const GAP_TIPS = {
    可能已反映在股價: '市場已經預期到、股價也已經先動的部分。這類好消息真的公布時，股價不一定再漲（利多出盡）。',
    可能讓市場正向意外: '實際數字比股價反映的還好，或趨勢正在轉強；之後公布時有機會帶來正面驚喜。',
    可能讓市場負向意外: '實際數字轉弱、預估被下修；之後公布時可能讓股價失望。',
  };

  function Th({ children }) {
    return <th className="py-1 pr-2 font-normal">{children}</th>;
  }

  function FundamentalsCard({ symbol }) {
    const [f, setF] = useState(null);
    useEffect(() => {
      let stop = false;
      setF(null);
      fetch('/api/fundamentals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol }),
      })
        .then((r) => r.json())
        .then((d) => !stop && setF(d))
        .catch((e) => !stop && setF({ error: e.message }));
      return () => {
        stop = true;
      };
    }, [symbol]);
    if (!f) return <div className="text-xs text-slate-500 px-1">正在整理財報與市場預期…</div>;
    if (f.error) return <div className="text-xs text-rose-300 px-1">⚠️ 財報資料取得失敗：{f.error}</div>;
    if (!f.supported) return null;
    const rv = f.revenue || {};
    const qs = f.quarterly?.quarters || [];
    return (
      <div data-tour="fundamentals" className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 space-y-3">
        <div className="text-sm font-bold text-white">
          財報與市場預期
          <window.TA.Tip text="看懂市場正在定價什麼：先看實際財報數字（營收、EPS、毛利率）與市場預估，再把它們和股價漲幅比較，分出「已反映在股價」與「還可能讓市場意外」的部分。" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          {Object.entries(f.expectation_gap).map(([k, list]) => (
            <div key={k} className={`rounded-xl border p-2.5 text-xs space-y-1 ${GAP_STYLE[k]}`}>
              <div className="font-bold">
                {k}
                <window.TA.Tip text={GAP_TIPS[k]} />
              </div>
              {list.length ? (
                list.map((x) => (
                  <div key={x} className="leading-relaxed">
                    • {x}
                  </div>
                ))
              ) : (
                <div className="text-slate-500">目前沒有符合規則的訊號</div>
              )}
            </div>
          ))}
        </div>
        <div className="text-[11px] text-slate-400">
          股價漲跌：3 個月 <span className={sgnCls(f.price_returns_pct?.['3個月'])}>{sgn(f.price_returns_pct?.['3個月'])}</span>
          ・6 個月 <span className={sgnCls(f.price_returns_pct?.['6個月'])}>{sgn(f.price_returns_pct?.['6個月'])}</span>
          ・1 年 <span className={sgnCls(f.price_returns_pct?.['1年'])}>{sgn(f.price_returns_pct?.['1年'])}</span>
          。{f.gap_note}
        </div>

        {f.market === 'TW' && (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            <div className="text-xs">
              <div className="font-semibold text-slate-300 mb-1">
                月營收（億元）
                <window.TA.Tip text="上市櫃公司每月 10 日前公布上個月營收，是台股最即時的基本面資料。年增＝比去年同月、月增＝比上個月；看年增率是在加速還是放緩。" />
                {rv.available && (
                  <span className="ml-2 font-normal text-slate-400">
                    今年累計年增 <span className={sgnCls(rv.ytd_yoy_pct)}>{sgn(rv.ytd_yoy_pct)}</span>
                  </span>
                )}
              </div>
              {rv.available ? (
                <div className="max-h-56 overflow-y-auto">
                  <table className="w-full mono">
                    <thead>
                      <tr className="text-slate-500 text-left">
                        <Th>月份</Th>
                        <Th>營收</Th>
                        <Th>年增</Th>
                        <Th>月增</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...rv.months].reverse().map((m) => (
                        <tr key={m.month} className="border-t border-slate-800">
                          <td className="py-0.5 text-slate-300">{m.month}</td>
                          <td className="text-white">{fmt(m.revenue_100m, 1)}</td>
                          <td className={sgnCls(m.yoy_pct)}>{sgn(m.yoy_pct)}</td>
                          <td className={sgnCls(m.mom_pct)}>{sgn(m.mom_pct)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-slate-500">{rv.reason}</div>
              )}
            </div>
            <div className="text-xs">
              <div className="font-semibold text-slate-300 mb-1">
                季財報
                <window.TA.Tip text="EPS＝每股盈餘；毛利率＝毛利 ÷ 營收（產品賺錢能力）；營業利益率＝本業獲利 ÷ 營收。EPS 年增＝和去年同一季比。近 4 季 EPS 加總可以和本益比一起看。" />
                {f.quarterly?.ttm_eps != null && (
                  <span className="ml-2 font-normal text-slate-400">
                    近 4 季 EPS {fmt(f.quarterly.ttm_eps)}（年增 {sgn(f.quarterly.ttm_eps_yoy_pct)}）
                  </span>
                )}
              </div>
              {f.quarterly?.available ? (
                <table className="w-full mono">
                  <thead>
                    <tr className="text-slate-500 text-left">
                      <Th>季度</Th>
                      <Th>EPS</Th>
                      <Th>EPS 年增</Th>
                      <Th>毛利率</Th>
                      <Th>營益率</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...qs].reverse().map((q) => (
                      <tr key={q.quarter} className="border-t border-slate-800">
                        <td className="py-0.5 text-slate-300">{q.quarter}</td>
                        <td className="text-white">{fmt(q.eps)}</td>
                        <td className={sgnCls(q.eps_yoy_pct)}>{sgn(q.eps_yoy_pct)}</td>
                        <td className="text-slate-200">{q.gross_margin_pct == null ? '--' : `${fmt(q.gross_margin_pct)}%`}</td>
                        <td className="text-slate-200">{q.op_margin_pct == null ? '--' : `${fmt(q.op_margin_pct)}%`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="text-slate-500">{f.quarterly?.reason}</div>
              )}
              <div className="text-[11px] text-slate-500 mt-1">
                台股沒有免費的分析師預估資料，因此「預期」用股價漲幅和實際獲利成長互相比較。
              </div>
            </div>
          </div>
        )}

        {f.market === 'US' && (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 text-xs">
            <div>
              <div className="font-semibold text-slate-300 mb-1">
                近 4 季 EPS：實際 vs 市場預估
                <window.TA.Tip text="驚喜幅度＝(實際 − 預估) ÷ 預估。持續打敗預估代表市場已習慣好成績，股價反應常取決於「超出多少」與下一季財測。" />
              </div>
              <table className="w-full mono">
                <thead>
                  <tr className="text-slate-500 text-left">
                    <Th>季末</Th>
                    <Th>實際</Th>
                    <Th>預估</Th>
                    <Th>驚喜</Th>
                  </tr>
                </thead>
                <tbody>
                  {[...(f.eps_history || [])].reverse().map((h) => (
                    <tr key={h.quarter} className="border-t border-slate-800">
                      <td className="py-0.5 text-slate-300">{h.quarter}</td>
                      <td className="text-white">{h.eps_actual}</td>
                      <td className="text-slate-300">{h.eps_estimate}</td>
                      <td className={sgnCls(h.surprise_pct)}>{sgn(h.surprise_pct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-slate-300">
                {Object.entries({ ...f.margins, ...f.valuation }).map(([k, v]) => (
                  <div key={k} className="flex justify-between border-b border-slate-800/60">
                    <span className="text-slate-400">{k}</span>
                    <span className="mono">{v == null ? '--' : fmt(v)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="font-semibold text-slate-300 mb-1">
                分析師預估（財測共識）
                <window.TA.Tip text="華爾街分析師對未來的平均預估。90 天上下修＝現在的 EPS 預估比 90 天前高或低多少，上修代表市場預期正在變樂觀（也代表更多好消息已被預期）。" />
              </div>
              <table className="w-full mono">
                <thead>
                  <tr className="text-slate-500 text-left">
                    <Th>期間</Th>
                    <Th>EPS 預估</Th>
                    <Th>EPS 成長</Th>
                    <Th>營收預估(B)</Th>
                    <Th>90 天上下修</Th>
                  </tr>
                </thead>
                <tbody>
                  {(f.estimates || []).map((e) => (
                    <tr key={e.period} className="border-t border-slate-800">
                      <td className="py-0.5 text-slate-300 font-sans">
                        {e.period}
                        <span className="text-slate-500 text-[10px] ml-1">{e.end}</span>
                      </td>
                      <td className="text-white">{e.eps_avg ?? '--'}</td>
                      <td className={sgnCls(e.eps_growth_pct)}>{sgn(e.eps_growth_pct, 1)}</td>
                      <td className="text-slate-200">{e.revenue_avg_b ?? '--'}</td>
                      <td className={sgnCls(e.revision_90d_pct)}>{sgn(e.revision_90d_pct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {f.analyst?.target_mean != null && (
                <div className="mt-2 text-slate-300">
                  分析師平均目標價 <b className="mono text-white">{f.analyst.target_mean}</b>（區間 {f.analyst.target_low} ～{' '}
                  {f.analyst.target_high}，{f.analyst.count} 位，距現價 {sgn(f.analyst.upside_pct)}）
                  <window.TA.Tip text="目標價是分析師的看法，常常落後股價才調整，只能當作市場預期的溫度計，不是保證。" />
                </div>
              )}
              {f.next_earnings && <div className="text-amber-200 mt-1">下次財報日：{f.next_earnings}</div>}
            </div>
          </div>
        )}
        <div className="text-[10px] text-slate-500">
          來源：{f.sources?.join('、')}
          {f.errors?.length > 0 && <span className="text-amber-300 ml-2">⚠️ {f.errors.join('；')}</span>}
        </div>
      </div>
    );
  }

  function StockInfoPanel({ symbol }) {
    const [info, setInfo] = useState(null);
    const [err, setErr] = useState(null);
    useEffect(() => {
      let stop = false;
      setInfo(null);
      setErr(null);
      fetch('/api/stockinfo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol }),
      })
        .then((r) => r.json())
        .then((d) => !stop && (d.error ? setErr(d.error) : setInfo(d)))
        .catch((e) => !stop && setErr(e.message));
      return () => {
        stop = true;
      };
    }, [symbol]);

    if (err)
      return (
        <div className="rounded-2xl border border-rose-700 bg-rose-950/50 p-5 text-sm text-rose-200">
          ⚠️ 取得資料失敗：{err}
        </div>
      );
    if (!info)
      return (
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-8 text-center text-slate-400">
          正在整理 {symbol} 的基本資料與配息紀錄…（第一次約需數秒）
        </div>
      );

    const a = info.dividends.analysis;
    const next = a.next_announced;
    const profile = Object.entries(info.profile).filter(([k]) => !k.startsWith('_'));
    const nextMonth = next ? Number(next.ex_date.slice(5, 7)) : null;
    const today = new Date().toISOString().slice(0, 10);
    return (
      <div className="space-y-4">
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xl font-bold text-white">{info.name}</span>
            <span className="mono text-sm text-slate-400">{info.symbol}</span>
            <CatChip cls={info} />
            {info.price != null && (
              <span className="ml-auto mono text-lg font-bold text-white">
                {fmt(info.price)} <span className="text-xs text-slate-400">{info.currency}</span>
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {[
              ['配息頻率', a.frequency],
              ['近 12 月現金股利', a.events_last12 ? `${fmt(a.ttm_cash, 3)} / 股` : '無'],
              ['近 12 月殖利率', a.ttm_yield_pct != null ? `${fmt(a.ttm_yield_pct)}%` : '--'],
              ['近 12 月配息次數', `${a.events_last12} 次`],
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl bg-slate-950/70 border border-slate-800 px-3 py-2">
                <div className="text-[11px] text-slate-400">
                  {k}
                  {INFO_TIPS[k] && <window.TA.Tip text={INFO_TIPS[k]} />}
                </div>
                <div className="text-base font-bold text-white mono">{v}</div>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3 space-y-2">
            <div className="text-xs font-semibold text-slate-300">
              哪幾個月會除息／配息
              <span className="ml-2 text-[10px] font-normal text-slate-500">
                紅＝近 12 個月實際除息、灰＝過去常在此月、橘框＝下一場
              </span>
            </div>
            <MonthStrip typical={a.typical_months} last12={a.months_last12} nextMonth={nextMonth} />
            {next ? (
              <div className="text-xs text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
                ✅ 已公告的下一場：<b>{next.ex_date}</b> 除息，每股現金股利 <b>{next.cash}</b>
                {next.pay_date ? `，預計 ${next.pay_date} 發放` : '（來源沒有發放日）'}
                {next.period ? `（${next.period}）` : ''}
              </div>
            ) : a.next_estimate ? (
              <div className="text-xs text-slate-300 bg-slate-800/60 rounded-lg px-3 py-2">
                {a.next_estimate}
              </div>
            ) : (
              <div className="text-xs text-slate-500">目前沒有可用的配息紀錄。</div>
            )}
            <div className="text-[10px] text-slate-500">
              除息日＝當天起買進不能領這次股利（股價通常會扣掉股利）；發放日＝股利實際入帳。配息來源：
              {info.dividends.source || '無'}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4">
            <div className="text-sm font-bold text-white mb-2">配息紀錄</div>
            {info.dividends.events.length === 0 ? (
              <div className="text-xs text-slate-500">
                沒有配息紀錄（可能不配息，或來源沒有資料）。
              </div>
            ) : (
              <div className="max-h-72 overflow-y-auto">
                <table className="w-full text-xs mono">
                  <thead>
                    <tr className="text-slate-500 text-left">
                      <th className="py-1">除息日</th>
                      <th>發放日</th>
                      <th>每股現金</th>
                      <th>期別</th>
                    </tr>
                  </thead>
                  <tbody>
                    {info.dividends.events.map((e) => (
                      <tr key={`${e.ex_date}-${e.cash}`} className="border-t border-slate-800">
                        <td className="py-1 text-white">
                          {e.ex_date}
                          {e.ex_date > today && (
                            <span className="ml-1 text-[10px] text-amber-300">未來</span>
                          )}
                        </td>
                        <td className="text-slate-300">{e.pay_date || '--'}</td>
                        <td className="text-rose-300">{e.cash}</td>
                        <td className="text-slate-400">{e.period || ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4">
            <div className="text-sm font-bold text-white mb-2">ℹ️ 基本資料</div>
            {profile.length === 0 ? (
              <div className="text-xs text-slate-500">
                來源查無這個代號的基本資料（例如上櫃債券 ETF 不在證交所基金清單內）。
              </div>
            ) : (
              profile.map(([k, v]) => <KV key={k} k={k} v={v} />)
            )}
            {info.profile._source && (
              <div className="text-[10px] text-slate-500 mt-2">來源：{info.profile._source}</div>
            )}
          </div>
        </div>

        {info.holdings?.holdings?.length > 0 && (
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4">
            <div className="text-sm font-bold text-white mb-2">
              前十大成分股（合計 {info.holdings.covered_pct}%）
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
              {info.holdings.holdings.map((h) => (
                <div
                  key={h.symbol}
                  className="flex items-center gap-2 py-1 border-b border-slate-800/70 text-xs"
                >
                  <span className="mono font-bold text-white w-14">{h.symbol}</span>
                  <span className="text-slate-300 truncate flex-1">{h.name}</span>
                  <span className="mono text-sky-300">{h.pct}%</span>
                </div>
              ))}
            </div>
            <div className="text-[10px] text-slate-500 mt-2">{info.holdings.source}</div>
          </div>
        )}

        <FundamentalsCard symbol={symbol} />

        <window.TA.AiExplain module="stock" data={info} title="AI 解讀這檔標的（含 3 利多／3 風險）" />
      </div>
    );
  }

  // ---------- 配息月曆（左側清單）----------
  function DividendCalendar({ symbols, quotes, categories, selected, onSelect }) {
    const [rows, setRows] = useState({});
    const [loading, setLoading] = useState(false);
    const key = symbols.join(',');
    useEffect(() => {
      if (!symbols.length) return undefined;
      let stop = false;
      setLoading(true);
      fetch('/api/dividends', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols }),
      })
        .then((r) => r.json())
        .then((d) => {
          if (stop) return;
          const m = {};
          for (const r of d.rows || []) m[baseCode(r.symbol)] = r;
          setRows(m);
        })
        .catch(() => {})
        .finally(() => !stop && setLoading(false));
      return () => {
        stop = true;
      };
    }, [key]); // eslint-disable-line
    const sorted = [...symbols].sort((a, b) => {
      const na = rows[baseCode(a)]?.upcoming?.[0]?.ex_date || '9999';
      const nb = rows[baseCode(b)]?.upcoming?.[0]?.ex_date || '9999';
      return na.localeCompare(nb);
    });
    return (
      <div className="space-y-2">
        <div className="text-[11px] text-slate-400">
          依「下一場已公告除息日」排序。紅＝近 12
          個月實際除息月，灰＝歷史常見月，橘框＝下一場。點任一檔看完整配息紀錄。
          {loading && <span className="ml-2 text-slate-500">整理中…</span>}
        </div>
        {sorted.map((s) => {
          const r = rows[baseCode(s)];
          const q = quotes[baseCode(s)];
          const up = r?.upcoming?.[0];
          return (
            // biome-ignore lint/a11y/useSemanticElements: 內含多個子元素
            <div
              role="button"
              tabIndex={0}
              key={s}
              onClick={() => onSelect(s)}
              onKeyDown={(e) => e.key === 'Enter' && onSelect(s)}
              className={`rounded-xl border px-3 py-2 space-y-1.5 cursor-pointer ${
                baseCode(selected) === baseCode(s)
                  ? 'border-sky-400 bg-sky-500/10'
                  : 'border-slate-800 bg-slate-950/60 hover:border-slate-600'
              }`}
            >
              <div className="flex items-center gap-2 text-xs">
                <span className="mono font-bold text-white">{baseCode(s)}</span>
                <span className="text-slate-400 truncate">{q?.name}</span>
                <CatChip cls={categories[baseCode(s)]} />
                <span className="ml-auto text-slate-300">{r ? r.frequency : '…'}</span>
                {r?.ttm_yield_pct != null && (
                  <span className={`mono ${colorOf(1)}`}>{fmt(r.ttm_yield_pct)}%</span>
                )}
              </div>
              {r && (
                <MonthStrip
                  typical={r.typical_months}
                  last12={r.months_last12}
                  nextMonth={up ? Number(up.ex_date.slice(5, 7)) : undefined}
                />
              )}
              {r && (
                <div className="text-[11px] text-slate-400">
                  {up
                    ? `下一場：${up.ex_date} 除息・每股 ${up.cash}${up.pay_date ? `・${up.pay_date} 發放` : ''}`
                    : r.next_estimate
                      ? '尚未公告；依歷史規律推測見詳情'
                      : '沒有配息紀錄'}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  window.TA = Object.assign(window.TA || {}, { StockInfoPanel, DividendCalendar, CatChip });
})();
