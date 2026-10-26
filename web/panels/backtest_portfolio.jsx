// 策略回測：🧩 策略組合。多支「標的 × 策略」合成一個組合，比較等權重／波動率倒數／夏普值加權
(() => {
  const { useState } = React;
  const LS_KEY = 'tw_us_bt_portfolio_v1';
  const METHOD_COLORS = { equal: '#38bdf8', inv_vol: '#34d399', sharpe: '#f59e0b' };

  const corrBg = (v) => {
    if (v == null) return 'transparent';
    const a = Math.min(1, Math.abs(v)) * 0.6 + 0.05;
    return v >= 0 ? `rgba(244,63,94,${a})` : `rgba(56,189,248,${a})`;
  };

  function Curves({ results }) {
    const W = 720;
    const H = 200;
    const all = results.flatMap((r) => r.curve.map((p) => p.value));
    const lo = Math.min(...all, 1);
    const hi = Math.max(...all, 1);
    const span = Math.max(hi - lo, 1e-9);
    const n = Math.max(...results.map((r) => r.curve.length));
    const x = (i) => (i / Math.max(n - 1, 1)) * W;
    const y = (v) => H - ((v - lo) / span) * H;
    return (
      <svg viewBox={`0 0 ${W} ${H + 18}`} className="w-full h-52">
        <title>組合淨值曲線</title>
        <line x1="0" x2={W} y1={y(1)} y2={y(1)} stroke="#475569" strokeDasharray="4 4" />
        {results.map((r) => (
          <polyline
            key={r.method}
            fill="none"
            stroke={METHOD_COLORS[r.method]}
            strokeWidth="1.8"
            points={r.curve.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')}
          />
        ))}
        <text x="0" y={H + 14} fontSize="11" fill="#64748b" fontFamily="monospace">
          {results[0].curve[1]?.date}
        </text>
        <text x={W} y={H + 14} fontSize="11" fill="#64748b" fontFamily="monospace" textAnchor="end">
          {results[0].curve[results[0].curve.length - 1]?.date}
        </text>
      </svg>
    );
  }

  function PortfolioPanel({ m3Form }) {
    const { readLS, writeLS } = window.TA;
    const catalog = [
      ...(window.TA._btCatalog || window.TA.BT.FALLBACK_CATALOG).strategies,
      ...window.TA.BT.customStrategies(),
    ];
    const labelOf = (k) => catalog.find((s) => s.key === k)?.label || k;
    const heldSyms = [
      ...new Set((window.TA.loadPortfolio?.().holdings || []).map((h) => h.symbol)),
    ];
    const defaultLegs =
      heldSyms.length >= 2
        ? heldSyms.slice(0, 4).map((s) => ({ target_asset: s, strategy: 'ma_cross', params: {} }))
        : [
            { target_asset: '2330', strategy: 'ma_cross', params: {} },
            { target_asset: '0056', strategy: 'bias_revert', params: {} },
          ];
    const [legs, setLegsRaw] = useState(() => readLS(LS_KEY, defaultLegs));
    const setLegs = (v) => {
      setLegsRaw(v);
      writeLS(LS_KEY, v);
    };
    const [data, setData] = useState(null);
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState(null);
    const upd = (i, patch) => setLegs(legs.map((l, k) => (k === i ? { ...l, ...patch } : l)));

    const run = async () => {
      setBusy(true);
      setErr(null);
      try {
        const res = await fetch('/api/mod3/portfolio', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            initial_capital: m3Form.initial_capital,
            commission_discount: m3Form.commission_discount,
            period_years: m3Form.period_years,
            sizing_mode: m3Form.sizing_mode,
            sizing_value: m3Form.sizing_value,
            atr_mult: m3Form.atr_mult,
            stop_loss_pct: m3Form.stop_loss_pct,
            trailing_pct: m3Form.trailing_pct,
            market_filter: m3Form.market_filter,
            filter_ma: m3Form.filter_ma,
            legs,
          }),
        });
        const d = await res.json();
        if (d.error) throw new Error(d.error);
        setData(d);
      } catch (e) {
        setErr(e.message);
      } finally {
        setBusy(false);
      }
    };
    const inp = 'bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white';
    const best = data && [...data.results].sort((a, b) => (b.sharpe ?? -99) - (a.sharpe ?? -99))[0];

    return (
      <div className="space-y-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-xs text-slate-300 space-y-3">
          <div>
            把 2～8 支「標的 × 策略」放在一起，用上方表單的
            <b>期間、本金、部位、停損停利與大盤濾網</b>各自回測，
            再用三種方法分配資金，看組合是否比單一策略更穩。
            <window.TA.Tip text="等權重：每支分一樣多。波動率倒數：近期波動小的分多一點，讓每支的風險貢獻差不多。夏普值加權：近期「報酬÷波動」好的分多一點（容易追逐過去的贏家）。權重每月第一個交易日只用之前 120 天的資料重算，不偷看未來。相關係數越低（甚至負的），組合越能互相抵消波動。" />
          </div>
          <div className="space-y-1.5">
            {legs.map((l, i) => (
              <div key={`${i}-${l.strategy}`} className="flex flex-wrap items-center gap-2">
                <span className="text-slate-500 w-5">{i + 1}.</span>
                <input
                  aria-label={`第 ${i + 1} 支標的`}
                  value={l.target_asset}
                  onChange={(e) => upd(i, { target_asset: e.target.value })}
                  className={`${inp} w-28 font-mono`}
                />
                <select
                  aria-label={`第 ${i + 1} 支策略`}
                  value={l.strategy}
                  onChange={(e) =>
                    upd(i, {
                      strategy: e.target.value,
                      params: {},
                      custom: catalog.find((s) => s.key === e.target.value)?.custom,
                    })
                  }
                  className={inp}
                >
                  {catalog.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                      {s.tw_only ? '（僅台股）' : ''}
                    </option>
                  ))}
                </select>
                <span className="text-slate-500">
                  {Object.keys(l.params || {}).length
                    ? Object.entries(l.params)
                        .map(([k, v]) => `${k}=${v}`)
                        .join('、')
                    : '預設參數'}
                </span>
                <button
                  type="button"
                  onClick={() => setLegs(legs.filter((_, k) => k !== i))}
                  className="ml-auto text-slate-500 hover:text-rose-300 cursor-pointer"
                >
                  移除
                </button>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={legs.length >= 8}
              onClick={() =>
                setLegs([
                  ...legs,
                  {
                    target_asset: m3Form.target_asset,
                    strategy: m3Form.strategy,
                    params: m3Form.params || {},
                    custom: m3Form.custom,
                  },
                ])
              }
              className="px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300 hover:text-white cursor-pointer disabled:opacity-40"
            >
              ＋ 加入上方表單（{m3Form.target_asset}・{labelOf(m3Form.strategy)}）
            </button>
            <button
              type="button"
              disabled={legs.length >= 8}
              onClick={() =>
                setLegs([...legs, { target_asset: '', strategy: 'ma_cross', params: {} }])
              }
              className="px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300 hover:text-white cursor-pointer disabled:opacity-40"
            >
              ＋ 新增空白一支
            </button>
            {heldSyms.length >= 2 && (
              <button
                type="button"
                onClick={() =>
                  setLegs(
                    heldSyms.slice(0, 8).map((s) => ({
                      target_asset: s,
                      strategy: m3Form.strategy || 'ma_cross',
                      params: m3Form.params || {},
                    })),
                  )
                }
                className="px-3 py-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20 cursor-pointer"
              >
                帶入我的持股（前 {Math.min(8, heldSyms.length)} 檔）
              </button>
            )}
            <button
              type="button"
              onClick={run}
              disabled={busy || legs.length < 2 || legs.some((l) => !String(l.target_asset).trim())}
              className="ml-auto py-1.5 px-4 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-semibold cursor-pointer"
            >
              {busy ? '計算中…' : `執行組合回測（${legs.length} 支）`}
            </button>
          </div>
          {err && <div className="text-rose-300">⚠️ {err}</div>}
        </div>

        {data && (
          <div className="space-y-4">
            {data.leg_info
              .flatMap((l) => l.warnings.map((w) => `${l.label}：${w}`))
              .map((w) => (
                <div
                  key={w}
                  className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs text-amber-100"
                >
                  ⚠️ {w}
                </div>
              ))}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-xs space-y-3 overflow-x-auto">
              <div className="font-semibold text-slate-200">
                三種權重法比較（{data.period}）
                <window.TA.Tip text={data.rule} />
              </div>
              <table className="w-full text-left font-mono whitespace-nowrap">
                <thead>
                  <tr className="text-slate-400 font-sans border-b border-slate-800">
                    <th className="py-1.5 px-2">方法</th>
                    <th className="py-1.5 px-2">總報酬</th>
                    <th className="py-1.5 px-2">年化報酬</th>
                    <th className="py-1.5 px-2">年化波動</th>
                    <th className="py-1.5 px-2">夏普值</th>
                    <th className="py-1.5 px-2">最大回撤</th>
                    <th className="py-1.5 px-2 font-sans">平均權重</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {data.results.map((r) => (
                    <tr key={r.method}>
                      <td
                        className="py-1.5 px-2 font-sans"
                        style={{ color: METHOD_COLORS[r.method] }}
                      >
                        {r.label}
                        {best?.method === r.method ? ' ★' : ''}
                      </td>
                      <td className="py-1.5 px-2">{r.total_return_pct}%</td>
                      <td className="py-1.5 px-2">{r.annual_return_pct}%</td>
                      <td className="py-1.5 px-2">{r.annual_vol_pct}%</td>
                      <td className="py-1.5 px-2">{r.sharpe ?? '--'}</td>
                      <td className="py-1.5 px-2 text-rose-300">-{r.max_dd_pct}%</td>
                      <td className="py-1.5 px-2 text-slate-400">
                        {r.avg_weights.map((w) => `${w}%`).join(' / ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Curves results={data.results} />
              <div className="text-slate-400">
                ★＝夏普值最高的方法。組合的年化波動和「波動最低的單一策略」（
                {data.lowest_single_vol_pct}%）比， 更低代表分散真的有效。
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-xs overflow-x-auto">
                <div className="font-semibold text-slate-200 mb-2">各支策略（單獨持有）</div>
                <table className="w-full text-left font-mono whitespace-nowrap">
                  <thead>
                    <tr className="text-slate-400 font-sans border-b border-slate-800">
                      <th className="py-1 px-2">#</th>
                      <th className="py-1 px-2 font-sans">標的・策略</th>
                      <th className="py-1 px-2">年化</th>
                      <th className="py-1 px-2">波動</th>
                      <th className="py-1 px-2">夏普</th>
                      <th className="py-1 px-2">回撤</th>
                      <th className="py-1 px-2">筆數</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {data.legs.map((l, i) => (
                      <tr key={l.label}>
                        <td className="py-1 px-2 text-slate-500">{i + 1}</td>
                        <td className="py-1 px-2 font-sans text-slate-200">{l.label}</td>
                        <td className="py-1 px-2">{l.annual_return_pct}%</td>
                        <td className="py-1 px-2">{l.annual_vol_pct}%</td>
                        <td className="py-1 px-2">{l.sharpe ?? '--'}</td>
                        <td className="py-1 px-2 text-rose-300">-{l.max_dd_pct}%</td>
                        <td className="py-1 px-2">{data.leg_info[i].trades}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-xs overflow-x-auto">
                <div className="font-semibold text-slate-200 mb-2">
                  相關係數矩陣（平均 {data.avg_correlation ?? '--'}）
                  <window.TA.Tip text="兩支策略日報酬的相關係數，-1～1。接近 1＝常常同漲同跌，放在一起分散效果差；接近 0 或負數＝走勢互補，能降低組合波動。紅色正相關、藍色負相關。" />
                </div>
                <table
                  className="font-mono text-center"
                  style={{ borderSpacing: 2, borderCollapse: 'separate' }}
                >
                  <thead>
                    <tr>
                      <th />
                      {data.legs.map((l, j) => (
                        <th key={l.label} className="px-2 text-slate-400">
                          {j + 1}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.correlation.map((row, i) => (
                      <tr key={data.legs[i].label}>
                        <th className="px-2 text-slate-400">{i + 1}</th>
                        {row.map((v, j) => (
                          <td
                            key={data.legs[j].label}
                            className="px-2 py-1 rounded text-white"
                            style={{ background: i === j ? 'rgba(71,85,105,0.4)' : corrBg(v) }}
                          >
                            {v == null ? '--' : v.toFixed(2)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-xs overflow-x-auto">
              <div className="font-semibold text-slate-200 mb-2">
                績效貢獻（組合報酬來自哪一支）
                <window.TA.Tip text="每天「權重 × 該策略日報酬」加總後占全部的比例。負數代表這支在組合裡是拖累。" />
              </div>
              <table className="w-full text-left font-mono whitespace-nowrap">
                <thead>
                  <tr className="text-slate-400 font-sans border-b border-slate-800">
                    <th className="py-1 px-2 font-sans">標的・策略</th>
                    {data.results.map((r) => (
                      <th
                        key={r.method}
                        className="py-1 px-2 font-sans"
                        style={{ color: METHOD_COLORS[r.method] }}
                      >
                        {r.label}（目前權重）
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {data.legs.map((l, i) => (
                    <tr key={l.label}>
                      <td className="py-1 px-2 font-sans text-slate-200">{l.label}</td>
                      {data.results.map((r) => (
                        <td
                          key={r.method}
                          className={`py-1 px-2 ${(r.contribution_share_pct[i] ?? 0) < 0 ? 'text-emerald-300' : 'text-rose-200'}`}
                        >
                          {r.contribution_share_pct[i] ?? '--'}%（{r.last_weights[i] ?? '--'}%）
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  }

  window.TA = Object.assign(window.TA || {}, {
    BT: Object.assign(window.TA?.BT || {}, { PortfolioPanel }),
  });
})();
