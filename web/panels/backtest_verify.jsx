// 策略回測：驗證類元件（市場環境拆分、前後段驗證、參數熱力圖、滾動前進分析、蒙地卡羅）
(() => {
  const pf = (v) => (v == null ? '--' : v >= 999 ? '無虧損' : v);
  const REGIME_COLOR = { 多頭: 'text-emerald-300', 盤整: 'text-amber-300', 空頭: 'text-rose-300' };

  // 依進場當天的大盤環境拆分績效
  function RegimeTable({ data }) {
    if (!data) return null;
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 overflow-x-auto">
        <div className="text-xs font-semibold text-slate-300 mb-2">
          不同市場環境下的績效（大盤 {data.index}）
          <window.TA.Tip
            text={`依「進場當天」的大盤狀態分類：${data.rule}。用來看策略在什麼行情賺、什麼行情賠；某環境只有 0～1 筆時不下結論。`}
          />
        </div>
        <table className="w-full text-left text-xs font-mono">
          <thead>
            <tr className="border-b border-slate-800 text-slate-400 font-sans">
              <th className="py-1.5 px-2">環境</th>
              <th className="py-1.5 px-2">交易數</th>
              <th className="py-1.5 px-2">勝率</th>
              <th className="py-1.5 px-2">平均報酬</th>
              <th className="py-1.5 px-2">獲利因子</th>
              <th className="py-1.5 px-2">淨損益</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {data.rows.map((r) => (
              <tr key={r.regime}>
                <td className={`py-1.5 px-2 font-sans font-bold ${REGIME_COLOR[r.regime]}`}>{r.regime}</td>
                <td className="py-1.5 px-2">{r.trades}</td>
                {r.trades ? (
                  <>
                    <td className="py-1.5 px-2">{r.win_rate_pct}%</td>
                    <td className={`py-1.5 px-2 ${r.avg_return_pct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {r.avg_return_pct}%
                    </td>
                    <td className="py-1.5 px-2">{pf(r.profit_factor)}</td>
                    <td className={`py-1.5 px-2 ${r.net_pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {r.net_pnl.toLocaleString()}
                    </td>
                  </>
                ) : (
                  <td colSpan={4} className="py-1.5 px-2 text-slate-500 font-sans">
                    這段期間沒有在此環境進場
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-2 text-xs text-slate-400">
          {data.best && (
            <span className="mr-3">
              ✅ 最有效：<b className="text-emerald-300">{data.best}</b>
            </span>
          )}
          {data.worst && (
            <span>
              ⚠️ 最容易失效：<b className="text-rose-300">{data.worst}</b>
            </span>
          )}
          {!data.best && !data.worst && <span>各環境筆數不足（每個環境至少 2 筆才比較），先拉長回測期間。</span>}
        </div>
      </div>
    );
  }

  function WfCell({ x }) {
    return (
      <td className={`py-1.5 px-2 ${x.net_pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
        {x.trades} 筆｜勝率 {x.trades ? `${x.win_rate_pct}%` : '--'}｜平均 {x.trades ? `${x.avg_return_pct}%` : '--'}｜PF{' '}
        {pf(x.profit_factor)}
      </td>
    );
  }

  // 前後段驗證：前 70% 挑最佳參數，後 30% 檢查是否還有效
  function WalkForwardCard({ wf }) {
    if (!wf) return null;
    return (
      <div
        className={`rounded-xl border p-4 text-xs overflow-x-auto ${
          wf.overfit_warning ? 'border-amber-500/40 bg-amber-500/5' : 'border-emerald-500/30 bg-emerald-500/5'
        }`}
      >
        <div className="font-semibold text-slate-200 mb-2">
          前後段驗證（防過度擬合）
          <window.TA.Tip
            text={`把期間切兩段：前 70% 用來挑「歷史上最好」的策略參數（${wf.grid}；部位、停損與大盤濾網跟這次設定相同），後 30% 是沒看過的資料，用來檢查那組參數是否還有效。前段很好、後段變差＝過度擬合。`}
          />
        </div>
        <table className="w-full text-left font-mono">
          <thead>
            <tr className="border-b border-slate-800 text-slate-400 font-sans">
              <th className="py-1.5 px-2">參數</th>
              <th className="py-1.5 px-2">前段（挑參數）{wf.train_period}</th>
              <th className="py-1.5 px-2">後段（驗證）{wf.test_period}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            <tr>
              <td className="py-1.5 px-2 font-sans text-slate-300">
                前段最佳 {wf.best_label || `${wf.best_params.fast_ma}/${wf.best_params.slow_ma}`}
              </td>
              <WfCell x={wf.best_train} />
              <WfCell x={wf.best_test} />
            </tr>
            <tr>
              <td className="py-1.5 px-2 font-sans text-slate-300">你的參數</td>
              <WfCell x={wf.mine_train} />
              <WfCell x={wf.mine_test} />
            </tr>
          </tbody>
        </table>
        <div className={`mt-2 ${wf.overfit_warning ? 'text-amber-200' : 'text-emerald-200'}`}>
          {wf.overfit_warning ? '⚠️ ' : '✅ '}
          {wf.verdict}
        </div>
      </div>
    );
  }

  // 後端抓不到策略清單時，至少還能跑雙均線

  // 依回測結果組出「同一組設定」的請求內容（表單之後被改過也不影響）
  function payloadFrom(d) {
    const { strategy, initial_capital, commission_discount, period_years, ...params } = d.strategy_params || {};
    const rs = d.risk_settings || {};
    return {
      target_asset: d.symbol,
      strategy,
      custom: d.custom_def || undefined,
      params,
      initial_capital,
      commission_discount,
      period_years,
      sizing_mode: rs.sizing_mode,
      sizing_value: rs.sizing_value,
      atr_mult: rs.atr_mult,
      stop_loss_pct: rs.stop_loss_pct,
      trailing_pct: rs.trailing_pct,
      market_filter: rs.market_filter,
      filter_ma: rs.filter_ma,
    };
  }

  async function postJSON(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
  }

  // 進階驗證結果只對「產生它的那次回測」有效：換一次回測就清掉，避免拿舊結果判讀
  const cache = { opt: { for: null, data: null }, mc: { for: null, data: null } };
  // PDF 報告用：只拿「這次回測」算過的結果，舊回測的不算
  const peekCached = (slot, owner) => (cache[slot].for === owner ? cache[slot].data : null);
  function useCached(slot, owner) {
    const [data, setData] = React.useState(cache[slot].for === owner ? cache[slot].data : null);
    React.useEffect(() => {
      if (cache[slot].for !== owner) setData(null);
    }, [slot, owner]);
    const save = (d) => {
      cache[slot] = { for: owner, data: d };
      setData(d);
    };
    return [data, save];
  }

  const heatBg = (v, maxAbs) => {
    if (v == null) return 'transparent';
    const a = Math.min(1, Math.abs(v) / (maxAbs || 1)) * 0.55 + 0.08;
    return v >= 0 ? `rgba(16,185,129,${a})` : `rgba(244,63,94,${a})`;
  };

  // 參數熱力圖：★＝穩定高原；藍框＝目前參數；黃框＝最高分那格
  function ParamHeatmap({ h, onPick }) {
    const vals = h.cells.flat().filter((c) => c && c.trades >= h.min_trades);
    const maxAbs = Math.max(1, ...vals.map((c) => Math.abs(c.return_pct)));
    const fmtV = (v) => (v == null ? '' : Number(v).toString());
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
        <div className="text-xs font-semibold text-slate-300">
          參數熱力圖（{h.metric}）
          <window.TA.Tip
            text={`每格是一組參數跑完整段期間的總報酬。★＝穩定高原：自己排在所有格子的前 40%、周圍可評分的格子都賺而且都不低於中位數，鄰格平均至少有自己的一半。只有單一格特別好、旁邊都差叫「孤島」，多半是剛好配合過去行情。交易少於 ${h.min_trades} 筆的格子不評分（灰色）。點任一格會把那組參數帶回上方表單。`}
          />
        </div>
        <div className="overflow-x-auto">
          <table className="text-[11px] font-mono border-separate" style={{ borderSpacing: 3 }}>
            <thead>
              <tr>
                <th className="text-slate-500 font-sans text-left pr-2">
                  {h.y ? `${h.y.label} ＼ ${h.x.label}` : h.x.label}
                </th>
                {h.x.values.map((x) => (
                  <th key={x} className="text-slate-400 px-1">
                    {fmtV(x)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {h.cells.map((row, i) => (
                <tr key={h.y ? h.y.values[i] : 'row'}>
                  <th className="text-slate-400 text-right pr-2">{h.y ? fmtV(h.y.values[i]) : ''}</th>
                  {row.map((c, j) => {
                    const mine = h.mine && h.mine.row === i && h.mine.col === j;
                    const best = h.best && h.best.row === i && h.best.col === j;
                    const scored = c && c.trades >= h.min_trades;
                    const p = { [h.x.key]: h.x.values[j] };
                    if (h.y) p[h.y.key] = h.y.values[i];
                    return (
                      <td key={h.x.values[j]} className="p-0">
                        {c ? (
                          <button
                            type="button"
                            onClick={() => onPick(p)}
                            title={`${c.trades} 筆｜總報酬 ${c.return_pct}%｜最大回撤 -${c.max_dd_pct}%｜鄰格平均 ${c.neighbor_avg_pct ?? '--'}%`}
                            className={`w-16 h-11 rounded-md cursor-pointer flex flex-col items-center justify-center border-2 ${
                              mine ? 'border-sky-400' : best ? 'border-amber-300' : 'border-transparent'
                            } ${scored ? 'text-white' : 'text-slate-500 bg-slate-800/60'}`}
                            style={scored ? { background: heatBg(c.return_pct, maxAbs) } : undefined}
                          >
                            <span>
                              {c.plateau && '★'}
                              {scored ? `${c.return_pct}%` : '--'}
                            </span>
                            <span className="text-[9px] opacity-75">{c.trades} 筆</span>
                          </button>
                        ) : (
                          <div className="w-16 h-11 rounded-md bg-slate-900 text-slate-700 flex items-center justify-center">
                            —
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap gap-3 text-[11px] text-slate-400">
          <span>
            ★ 穩定高原 {h.plateau_cells} / {h.scored_cells} 格｜中位數 {h.median_pct}%
          </span>
          {h.buy_hold_pct != null && (
            <span>
              同期買進持有 {h.buy_hold_pct}%（{h.beat_buy_hold} 格贏過）
              <window.TA.Tip text="同一段期間第一天買進、最後一天賣出的報酬（未扣稅費）。策略如果贏不了單純持有，代表進出場反而錯過漲幅；但策略通常回撤較小，要一起看。" />
            </span>
          )}
          <span className="text-sky-300">藍框＝目前參數</span>
          <span className="text-amber-300">黃框＝最高分</span>
          <span>—＝不合理的組合（例如短均線 ≥ 長均線）</span>
        </div>
        <div className={`text-xs ${h.plateau_cells && !h.best_is_island ? 'text-emerald-200' : 'text-amber-200'}`}>
          {h.plateau_cells && !h.best_is_island ? '✅ ' : '⚠️ '}
          {h.verdict}
        </div>
      </div>
    );
  }

  // 滾動前進分析：多段訓練→測試，WFE＝樣本外年化 ÷ 樣本內年化
  function RollingCard({ ro }) {
    const good = ro.wfe != null && ro.wfe >= 0.5;
    return (
      <div
        className={`rounded-xl border p-4 text-xs space-y-3 overflow-x-auto ${
          good ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-amber-500/40 bg-amber-500/5'
        }`}
      >
        <div className="font-semibold text-slate-200">
          滾動前進分析（Walk-Forward）
          <window.TA.Tip text="把期間切成好幾段：每段先用前面的「訓練期」挑出最好的參數，再拿到緊接著、沒看過的「測試期」實跑，一段一段往前滾。把所有測試期接起來就是一條「樣本外」曲線，最接近你照著這套方法實際操作的結果。WFE＝樣本外年化報酬 ÷ 樣本內年化報酬，0.5 以上算穩健，低於 0 代表過度擬合。" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <div>
            <div className="text-slate-400">WFE</div>
            <div className={`text-lg font-bold font-mono ${good ? 'text-emerald-300' : 'text-amber-300'}`}>
              {ro.wfe ?? '--'}
            </div>
          </div>
          <div>
            <div className="text-slate-400">樣本外串接總報酬</div>
            <div className={`text-lg font-bold font-mono ${ro.oos_total_return_pct >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
              {ro.oos_total_return_pct}%
            </div>
          </div>
          <div>
            <div className="text-slate-400">樣本內平均年化</div>
            <div className="text-lg font-bold font-mono text-slate-200">{ro.avg_is_annual_pct ?? '--'}%</div>
          </div>
          <div>
            <div className="text-slate-400">樣本外平均年化</div>
            <div className="text-lg font-bold font-mono text-slate-200">{ro.avg_oos_annual_pct ?? '--'}%</div>
          </div>
        </div>
        <table className="w-full text-left font-mono whitespace-nowrap">
          <thead>
            <tr className="border-b border-slate-800 text-slate-400 font-sans">
              <th className="py-1.5 px-2">#</th>
              <th className="py-1.5 px-2">訓練期（挑參數）</th>
              <th className="py-1.5 px-2">挑出的參數</th>
              <th className="py-1.5 px-2">樣本內報酬</th>
              <th className="py-1.5 px-2">測試期（實跑）</th>
              <th className="py-1.5 px-2">樣本外報酬</th>
              <th className="py-1.5 px-2">筆數</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {ro.folds.map((f, i) => (
              <tr key={f.test_period}>
                <td className="py-1.5 px-2 text-slate-400">{i + 1}</td>
                <td className="py-1.5 px-2">{f.train_period}</td>
                {f.skipped ? (
                  <td colSpan={5} className="py-1.5 px-2 font-sans text-slate-500">
                    {f.reason}
                  </td>
                ) : (
                  <>
                    <td className="py-1.5 px-2 font-sans text-slate-300">{f.best_label}</td>
                    <td className="py-1.5 px-2">{f.is_return_pct}%</td>
                    <td className="py-1.5 px-2">{f.test_period}</td>
                    <td className={`py-1.5 px-2 font-bold ${f.oos_return_pct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {f.oos_return_pct}%
                    </td>
                    <td className="py-1.5 px-2">{f.oos_trades}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="text-slate-400">{ro.note}</div>
        <div className={good ? 'text-emerald-200' : 'text-amber-200'}>
          {good ? '✅ ' : '⚠️ '}
          {ro.verdict}
        </div>
      </div>
    );
  }

  // 「參數最佳化」分頁：按鈕觸發，同一組設定掃熱力圖＋滾動前進分析
  function OptimizePanel({ m3Data, onPick }) {
    const [data, save] = useCached('opt', m3Data);
    const [busy, setBusy] = React.useState(false);
    const [err, setErr] = React.useState(null);
    const run = async () => {
      setBusy(true);
      setErr(null);
      try {
        const d = await window.TA.postJob('/api/mod3/optimize', payloadFrom(m3Data));
        if (d.error) throw new Error(d.error);
        save(d);
      } catch (e) {
        setErr(e.message);
      } finally {
        setBusy(false);
      }
    };
    return (
      <div className="space-y-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-xs text-slate-300 space-y-2">
          <div>
            用<b>這次回測的同一組設定</b>（標的、期間、部位、停損、大盤濾網）掃描參數：先看
            <b>參數熱力圖</b>找穩定區，再用<b>滾動前進分析</b>檢查「每次用過去挑參數、套到未來」是否仍有效。
            10 年資料約需數秒。
          </div>
          <button
            type="button"
            onClick={run}
            disabled={busy}
            className="py-1.5 px-4 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-semibold cursor-pointer"
          >
            {busy ? '掃描中…' : data ? '重新掃描' : '執行參數掃描'}
          </button>
          {err && <div className="text-rose-300">⚠️ {err}</div>}
        </div>
        {data && (
          <>
            {(data.warnings || []).map((w) => (
              <div key={w} className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs text-amber-100">
                ⚠️ {w}
              </div>
            ))}
            <ParamHeatmap h={data.heatmap} onPick={onPick} />
            {data.rolling && <RollingCard ro={data.rolling} />}
          </>
        )}
      </div>
    );
  }

  function Histogram({ bins, marker, label }) {
    const W = 640;
    const H = 150;
    const max = Math.max(...bins.map((b) => b.count), 1);
    const lo = bins[0].from;
    const hi = bins[bins.length - 1].to;
    const span = Math.max(hi - lo, 1e-9);
    const bw = W / bins.length;
    const mx = marker == null ? null : ((marker - lo) / span) * W;
    return (
      <svg viewBox={`0 0 ${W} ${H + 18}`} className="w-full h-40">
        <title>{label}</title>
        {bins.map((b, i) => {
          const h = (b.count / max) * H;
          return (
            <rect key={b.from} x={i * bw + 1} y={H - h} width={bw - 2} height={h} fill="#38bdf8" opacity="0.7">
              <title>{`${b.from}% ～ ${b.to}%：${b.count} 次`}</title>
            </rect>
          );
        })}
        {mx != null && mx >= 0 && mx <= W && (
          <g>
            <line x1={mx} x2={mx} y1={0} y2={H} stroke="#fbbf24" strokeWidth="2" strokeDasharray="4 3" />
            <text x={Math.min(mx + 4, W - 60)} y={12} fill="#fbbf24" fontSize="11">
              實際
            </text>
          </g>
        )}
        <text x={0} y={H + 14} fill="#64748b" fontSize="11" fontFamily="monospace">
          {lo}%
        </text>
        <text x={W} y={H + 14} textAnchor="end" fill="#64748b" fontSize="11" fontFamily="monospace">
          {hi}%
        </text>
      </svg>
    );
  }

  const PCT_ROWS = [
    ['p5', '最好 5%'],
    ['p25', '前 25%'],
    ['p50', '中位數'],
    ['p75', '後 25%'],
    ['p95', '最差 5%'],
  ];

  // 蒙地卡羅：用這次回測的每筆交易報酬，不必重抓資料
  function MonteCarloPanel({ m3Data }) {
    const [data, save] = useCached('mc', m3Data);
    const [mode, setMode] = React.useState('shuffle');
    const [runs, setRuns] = React.useState(1000);
    const [busy, setBusy] = React.useState(false);
    const [err, setErr] = React.useState(null);
    const trades = m3Data.backtest_result?.trades || [];
    const run = async () => {
      setBusy(true);
      setErr(null);
      try {
        save(await postJSON('/api/mod3/montecarlo', { returns: trades.map((t) => t.return_pct), runs, mode }));
      } catch (e) {
        setErr(e.message);
      } finally {
        setBusy(false);
      }
    };
    const selCls = 'bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white';
    return (
      <div className="space-y-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-xs text-slate-300 space-y-2">
          <div>
            把這次回測的 {trades.length} 筆交易重新排列組合上千次，看「運氣不好」時最大回撤可能多深。
            <window.TA.Tip text="打亂順序（Shuffle）：交易都一樣只換順序，最終報酬每次都相同，專門看虧損連在一起時的回撤分布。重抽樣（Bootstrap）：每次從這些交易隨機抽同樣筆數（可重複），最終報酬與回撤都會變。這裡的回撤以「每筆平倉後」計算，會比績效總覽的每日回撤小一些。" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="模擬方式" value={mode} onChange={(e) => setMode(e.target.value)} className={selCls}>
              <option value="shuffle">打亂交易順序（Shuffle）</option>
              <option value="bootstrap">重抽樣（Bootstrap）</option>
            </select>
            <select aria-label="模擬次數" value={runs} onChange={(e) => setRuns(Number(e.target.value))} className={selCls}>
              {[500, 1000, 2000, 3000].map((n) => (
                <option key={n} value={n}>
                  {n.toLocaleString()} 次
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={run}
              disabled={busy || trades.length < 5}
              className="py-1.5 px-4 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-semibold cursor-pointer"
            >
              {busy ? '模擬中…' : '執行模擬'}
            </button>
            {trades.length < 5 && <span className="text-amber-300">交易少於 5 筆，無法模擬</span>}
          </div>
          {err && <div className="text-rose-300">⚠️ {err}</div>}
        </div>
        {data && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-xs space-y-3">
            <div className="font-semibold text-slate-300">
              {data.mode === 'shuffle' ? '打亂交易順序' : '重抽樣'}｜{data.runs.toLocaleString()} 次｜{data.trades} 筆交易
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <div>
                <div className="text-slate-400">實際最大回撤（逐筆）</div>
                <div className="text-lg font-bold font-mono text-rose-300">-{data.actual.mdd_pct}%</div>
              </div>
              <div>
                <div className="text-slate-400">最差 5% 的回撤</div>
                <div className="text-lg font-bold font-mono text-rose-400">-{data.mdd_pct.p95}%</div>
              </div>
              <div>
                <div className="text-slate-400">回撤比實際更深的機率</div>
                <div className="text-lg font-bold font-mono text-amber-300">{data.prob_mdd_worse_pct}%</div>
              </div>
              <div>
                <div className="text-slate-400">{data.mode === 'shuffle' ? '最終報酬（每次相同）' : '最終虧錢的機率'}</div>
                <div className="text-lg font-bold font-mono text-slate-200">
                  {data.mode === 'shuffle' ? `${data.actual.final_pct}%` : `${data.prob_loss_pct}%`}
                </div>
              </div>
            </div>
            <div>
              <div className="text-slate-400 mb-1">最大回撤分布（黃線＝實際）</div>
              <Histogram bins={data.mdd_hist} marker={data.actual.mdd_pct} label="最大回撤分布" />
            </div>
            {data.final_hist && (
              <div>
                <div className="text-slate-400 mb-1">最終報酬分布（黃線＝實際）</div>
                <Histogram bins={data.final_hist} marker={data.actual.final_pct} label="最終報酬分布" />
              </div>
            )}
            <table className="text-left font-mono">
              <thead>
                <tr className="text-slate-400 font-sans border-b border-slate-800">
                  <th className="py-1 pr-6">分位</th>
                  <th className="py-1 pr-6">最大回撤</th>
                  {data.mode === 'bootstrap' && <th className="py-1 pr-6">最終報酬</th>}
                </tr>
              </thead>
              <tbody>
                {PCT_ROWS.map(([k, label]) => {
                  // 回撤由小到大排序：p5 最淺、p95 最深；報酬是 p95 最好，所以反過來對應
                  const fk = { p5: 'p95', p25: 'p75', p50: 'p50', p75: 'p25', p95: 'p5' }[k];
                  return (
                    <tr key={k}>
                      <td className="py-1 pr-6 font-sans text-slate-400">{label}</td>
                      <td className="py-1 pr-6 text-rose-300">-{data.mdd_pct[k]}%</td>
                      {data.mode === 'bootstrap' && <td className="py-1 pr-6">{data.final_pct[fk]}%</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="text-slate-400">{data.note}</div>
            <div className="text-slate-300">
              💡 用「最差 5% 的回撤」來決定能放多少資金：如果你最多只能承受虧 15%，而這裡顯示 -{data.mdd_pct.p95}%，
              就把部位降到約 {Math.max(1, Math.min(100, Math.round((15 / Math.max(data.mdd_pct.p95, 0.01)) * 100)))}%。
            </div>
          </div>
        )}
      </div>
    );
  }

  window.TA = Object.assign(window.TA || {}, {
    BT: Object.assign(window.TA?.BT || {}, {
      RegimeTable,
      WalkForwardCard,
      OptimizePanel,
      MonteCarloPanel,
      peekCached,
    }),
  });
})();
