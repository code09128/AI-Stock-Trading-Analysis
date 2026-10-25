(() => {
  // 策略回測：零未來函數策略回測
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
  const FALLBACK_CATALOG = {
    strategies: [
      {
        key: 'ma_cross',
        label: '雙均線交叉',
        kind: '趨勢',
        rule: '短均線由下往上穿過長均線買進；短均線跌回長均線下方賣出。',
        params: [
          { key: 'fast_ma', label: '短均線', default: 5, lo: 2, hi: 250, integer: true, tip: '短均線上穿長均線＝買進（黃金交叉）。' },
          { key: 'slow_ma', label: '長均線', default: 20, lo: 3, hi: 250, integer: true, tip: '必須大於短均線。' },
        ],
      },
    ],
    sizing_modes: { percent: '資金比例', fixed: '固定金額', atr_risk: 'ATR 風險定額' },
  };
  const SIZING_DEFAULT = { percent: 100, fixed: 200000, atr_risk: 1 };
  const SIZING_HELP = {
    percent: '每筆用「當下資金」的幾 %（含前面交易賺賠）。100＝全部資金，跟舊版相同。',
    fixed: '每筆固定投入多少錢（本金幣別），資金不足時用剩下的全部。適合比較不同策略，不會因複利放大。',
    atr_risk:
      '每筆最多賠「當下資金」的幾 %：股數＝資金 × 風險% ÷（ATR × 倍數）。波動大的股票自動買少一點，每筆風險差不多。常用 0.5～2%。',
  };
  const inputCls = 'w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm font-mono text-white';
  const TABS = [
    ['perf', '績效總覽'],
    ['trades', '交易明細'],
    ['verify', '驗證與下一步'],
  ];

  function NumField({ id, label, tip, value, onChange, step, min, max }) {
    return (
      <div>
        <label htmlFor={id} className="block text-xs text-slate-400 mb-1">
          {label}
          {tip && <window.TA.Tip text={tip} />}
        </label>
        <input
          id={id}
          type="number"
          step={step}
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className={inputCls}
        />
      </div>
    );
  }

  // 這頁的功能說明（預設收合）
  function HelpCard() {
    return (
      <details className="bg-slate-900/70 border border-slate-800 rounded-2xl px-5 py-3 text-xs text-slate-300 group">
        <summary className="cursor-pointer font-semibold text-slate-200 select-none">📘 這頁怎麼用（功能說明）</summary>
        <div className="mt-3 space-y-2 leading-relaxed">
          <p>
            <b className="text-white">回測規則</b>：每支策略只用到「當天收盤為止」的資料判斷，訊號隔天開盤價成交（不偷看未來），
            每筆都扣手續費與證交稅。交易是歷史上的模擬成交，不代表未來會一樣。
          </p>
          <p>
            <b className="text-white">6 種策略</b>：雙均線交叉、KD 低檔黃金交叉、均線多頭排列、量價突破、乖離率回歸、跳空缺口。
            選好策略後下方參數會自動換成該策略的設定，滑到 ⓘ 可看每個參數的意思。
          </p>
          <p>
            <b className="text-white">部位模型</b>：資金比例（每筆用當下資金的 X%）、固定金額（每筆固定投入）、
            ATR 風險定額（依波動決定股數，每筆風險差不多）。台股買得起整張就買整張，不足一張改零股。
          </p>
          <p>
            <b className="text-white">出場風控</b>：單筆最大虧損（跌破進場價 X% 停損）與移動停利（從持有期間最高價回落 X% 出場），
            都是盤中觸價成交，開盤就跳空跌破則以開盤價成交。停損出場後要等策略下一次買訊才會再進場。填 0＝不使用。
          </p>
          <p>
            <b className="text-white">大盤濾網</b>：大盤（台股為加權指數）收盤在 N 日均線（預設 60 日季線）之下時不開新倉，
            已持有的部位照原規則出場。「績效總覽」會列出被濾網擋下幾次。
          </p>
          <p>
            <b className="text-white">暫停交易</b>：成交量 0 的日子視同暫停交易，不成交、不採用那天的訊號，掛著的單順延到下一個有成交的日子。
          </p>
          <p>
            <b className="text-white">最大回撤</b>：用每天收盤市值計算（含持有中的帳面損益），比只看已平倉交易更接近實際感受。
          </p>
          <p>
            <b className="text-white">結果分頁</b>：績效總覽（指標、淨值曲線、出場原因）→ 交易明細（逐筆）→ 驗證與下一步
            （多頭／盤整／空頭拆分、前後段驗證是否過度擬合、下一個要測的規則）。
          </p>
        </div>
      </details>
    );
  }

  // 逐日淨值（收盤市值）曲線：最大回撤那段用紅色底標出來
  function DailyEquityChart({ points, initialCapital, dd }) {
    if (!points || points.length < 2) return null;
    const W = 720;
    const H = 200;
    const pad = { l: 70, r: 16, t: 14, b: 26 };
    const pw = W - pad.l - pad.r;
    const ph = H - pad.t - pad.b;
    const eqs = points.map((p) => p.equity);
    const lo = Math.min(...eqs, initialCapital);
    const hi = Math.max(...eqs, initialCapital);
    const range = Math.max(hi - lo, 1);
    const x = (i) => pad.l + (i / (points.length - 1)) * pw;
    const y = (v) => pad.t + ph - ((v - lo) / range) * ph;
    const line = points.map((p, i) => `${x(i).toFixed(1)},${y(p.equity).toFixed(1)}`).join(' ');
    const pi = dd?.peak_date ? points.findIndex((p) => p.date >= dd.peak_date) : -1;
    const ti = dd?.trough_date ? points.findIndex((p) => p.date >= dd.trough_date) : -1;
    const last = points[points.length - 1];
    return (
      <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2 text-xs">
          <span className="font-semibold text-slate-300">
            每日淨值（收盤市值，含持有中的帳面損益）
            <window.TA.Tip text="每天收盤時「現金＋持股市值」。紅色底＝最大回撤那段：從淨值高點跌到之後最低點。持有中的帳面損益還沒扣賣出的手續費與稅。" />
          </span>
          {dd?.max_dd_pct > 0 && (
            <span className="text-rose-300 font-mono">
              最大回撤 -{dd.max_dd_pct}%（{dd.peak_date} → {dd.trough_date}）
            </span>
          )}
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-44">
          <title>每日淨值曲線</title>
          {pi >= 0 && ti > pi && (
            <rect x={x(pi)} y={pad.t} width={x(ti) - x(pi)} height={ph} fill="#f43f5e" opacity="0.12" />
          )}
          <line x1={pad.l} x2={W - pad.r} y1={y(initialCapital)} y2={y(initialCapital)} stroke="#475569" strokeDasharray="4 4" />
          <text x={pad.l - 6} y={y(initialCapital) + 3} textAnchor="end" fill="#94a3b8" fontSize="10" fontFamily="monospace">
            本金
          </text>
          <text x={pad.l - 6} y={pad.t + 8} textAnchor="end" fill="#64748b" fontSize="10" fontFamily="monospace">
            {Math.round(hi).toLocaleString()}
          </text>
          <text x={pad.l - 6} y={pad.t + ph} textAnchor="end" fill="#64748b" fontSize="10" fontFamily="monospace">
            {Math.round(lo).toLocaleString()}
          </text>
          <polyline fill="none" stroke={last.equity >= initialCapital ? '#34d399' : '#fb7185'} strokeWidth="1.8" points={line} />
          <text x={pad.l} y={H - 6} fill="#64748b" fontSize="10" fontFamily="monospace">
            {points[0].date}
          </text>
          <text x={W - pad.r} y={H - 6} textAnchor="end" fill="#64748b" fontSize="10" fontFamily="monospace">
            {last.date}
          </text>
        </svg>
      </div>
    );
  }

  // 出場原因、濾網擋下次數、暫停交易日、期末持有中
  function RiskSummary({ r, risk, currency }) {
    const reasons = Object.entries(r.exit_reasons || {});
    const op = r.open_position;
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-xs space-y-2">
        <div className="font-semibold text-slate-300">
          部位與風控統計
          <window.TA.Tip text="出場原因：訊號＝策略的賣出條件；停損＝跌破單筆最大虧損；移動停利＝從高點回落出場且仍賺錢；移動停損＝從高點回落但已跌破進場價。" />
        </div>
        <div className="text-slate-400">股數規則：{r.position_sizing}</div>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-slate-300">
          <span>
            出場原因：
            {reasons.length ? reasons.map(([k, v]) => `${k} ${v} 筆`).join('、') : '尚無平倉交易'}
          </span>
          <span>
            停損 {risk?.stop_loss_pct ? `-${risk.stop_loss_pct}%` : '未使用'}｜移動停利{' '}
            {risk?.trailing_pct ? `回落 ${risk.trailing_pct}%` : '未使用'}
          </span>
          {risk?.market_filter ? (
            <span className={r.blocked_by_filter ? 'text-amber-300' : ''}>
              大盤濾網（{risk.filter_index} 在 {risk.filter_ma} 日線下不進場）擋下 <b>{r.blocked_by_filter}</b> 次買訊
              <window.TA.Tip
                text={`被擋下的訊號日（最近 30 筆）：${(r.blocked_dates || []).join('、') || '無'}。擋掉的可能是虧損單、也可能是錯過的漲勢，要和關閉濾網的結果比較才知道有沒有幫助。`}
              />
            </span>
          ) : (
            <span className="text-slate-500">大盤濾網未開啟</span>
          )}
          {r.suspended_days > 0 && <span>成交量 0（視同暫停交易）{r.suspended_days} 天</span>}
          {r.skipped_no_cash > 0 && <span>資金不足未成交 {r.skipped_no_cash} 次</span>}
          {r.skipped_no_atr > 0 && <span>ATR 尚未算出未進場 {r.skipped_no_atr} 次</span>}
        </div>
        {op && (
          <div className="rounded-lg border border-sky-500/30 bg-sky-500/5 px-3 py-2 text-sky-100">
            期末仍持有：{op.entry_date} 以 {op.entry_price} 買進 {op.shares.toLocaleString()} 股，{op.last_date} 收盤{' '}
            {op.last_close}，帳面 {op.unrealized_pnl >= 0 ? '+' : ''}
            {op.unrealized_pnl.toLocaleString()} {currency}（{op.unrealized_pct}%）。這筆不算進勝率等統計。
          </div>
        )}
      </div>
    );
  }

  function TradesTable({ trades }) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 overflow-x-auto">
        <div className="text-xs font-semibold text-slate-300 mb-3">
          逐筆交易明細（Next Bar Open：隔日開盤價成交，已扣摩擦成本）
          <window.TA.Tip text="訊號在當天收盤後才確定，所以用「隔天開盤價」成交，避免偷看未來；停損與移動停利是盤中觸價成交。摩擦成本＝手續費＋證交稅。這些是策略的模擬成交，不是你的真實交易。" />
        </div>
        {!trades.length ? (
          <div className="text-xs text-slate-500">這段期間沒有完成的交易。</div>
        ) : (
          <table className="w-full text-left text-xs font-mono whitespace-nowrap">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400">
                <th className="py-2 px-2">#</th>
                <th className="py-2 px-2">進場日</th>
                <th className="py-2 px-2">進場價</th>
                <th className="py-2 px-2">股數</th>
                <th className="py-2 px-2">出場日</th>
                <th className="py-2 px-2">出場價</th>
                <th className="py-2 px-2 font-sans">出場原因</th>
                <th className="py-2 px-2">持有天數</th>
                <th className="py-2 px-2">淨損益 (扣稅費)</th>
                <th className="py-2 px-2">報酬率</th>
                <th className="py-2 px-2 font-sans">進場時大盤</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {trades.map((t, idx) => (
                <tr key={`${t.entry_date}-${idx}`} className="hover:bg-slate-800/40">
                  <td className="py-2 px-2 text-slate-400">#{idx + 1}</td>
                  <td className="py-2 px-2">{t.entry_date}</td>
                  <td className="py-2 px-2">{t.entry_price}</td>
                  <td className="py-2 px-2">{t.shares?.toLocaleString() ?? '--'}</td>
                  <td className="py-2 px-2">{t.exit_date}</td>
                  <td className="py-2 px-2">{t.exit_price}</td>
                  <td
                    className={`py-2 px-2 font-sans ${t.exit_reason && t.exit_reason !== '訊號' ? 'text-amber-300' : 'text-slate-300'}`}
                  >
                    {t.exit_reason || '訊號'}
                  </td>
                  <td className="py-2 px-2">{t.holding_bars ?? '--'}</td>
                  <td className={`py-2 px-2 font-bold ${t.net_pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {t.net_pnl >= 0 ? `+${t.net_pnl}` : t.net_pnl}
                  </td>
                  <td className={`py-2 px-2 font-bold ${t.return_pct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {t.return_pct}%
                  </td>
                  <td className="py-2 px-2 font-sans text-slate-400">{t.regime || '--'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    );
  }

  function Kpi({ label, tip, value, cls }) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <div className="text-xs text-slate-400">
          {label}
          <window.TA.Tip text={tip} />
        </div>
        <div className={`text-lg font-bold font-mono mt-1 ${cls}`}>{value}</div>
      </div>
    );
  }

  function Mod3Panel({ ctx }) {
    const { m3Data, m3Form, m3Loading, runMod3, setM3Form } = ctx;
    const { EquityCurveChart } = window.TA;
    const [catalog, setCatalog] = React.useState(window.TA._btCatalog || null);
    const [tab, setTab] = React.useState('perf');
    React.useEffect(() => {
      if (catalog) return;
      fetch('/api/mod3/strategies')
        .then((r) => r.json())
        .then((d) => {
          if (!d.strategies) throw new Error('no strategies');
          window.TA._btCatalog = d;
          setCatalog(d);
        })
        .catch(() => setCatalog(FALLBACK_CATALOG));
    }, [catalog]);

    const cat = catalog || FALLBACK_CATALOG;
    const strat = cat.strategies.find((s) => s.key === m3Form.strategy) || cat.strategies[0];
    const params = { ...Object.fromEntries(strat.params.map((p) => [p.key, p.default])), ...(m3Form.params || {}) };
    const set = (patch) => setM3Form({ ...m3Form, ...patch });
    const pickStrategy = (key) => {
      const s = cat.strategies.find((x) => x.key === key);
      set({ strategy: key, params: Object.fromEntries(s.params.map((p) => [p.key, p.default])) });
    };
    const ccy = window.TA.currencyOf(window.TA.normSym(m3Form.target_asset || ''));
    const mode = m3Form.sizing_mode || 'percent';
    const r = m3Data?.backtest_result;

    return (
      <div className="space-y-5" data-tour="mod3-root">
        <HelpCard />
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4">
          <div>
            <h2 className="text-base font-semibold text-white">回測參數</h2>
            <span className="block mt-1 text-xs text-slate-500">
              資料狀態：回測用真實還權日 K（Yahoo/FinMind）；查無行情時會直接報錯，不會用假資料
            </span>
            <p className="text-xs text-slate-400">訊號於收盤確認、隔日開盤價成交，已扣除手續費與證交稅</p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-6 gap-3 items-end">
            <div>
              <label htmlFor="m3-asset" className="block text-xs text-slate-400 mb-1">
                回測標的代號
                <window.TA.Tip text="用這檔的真實還權日 K 回測，台股輸入數字代號、美股輸入英文代號。" />
              </label>
              <input
                id="m3-asset"
                type="text"
                value={m3Form.target_asset}
                onChange={(e) => set({ target_asset: e.target.value })}
                className={inputCls}
              />
            </div>
            <div className="col-span-2 md:col-span-2">
              <label htmlFor="m3-strategy" className="block text-xs text-slate-400 mb-1">
                策略
                <window.TA.Tip text={strat.rule} />
              </label>
              <select
                id="m3-strategy"
                value={strat.key}
                onChange={(e) => pickStrategy(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
              >
                {cat.strategies.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}（{s.kind}）
                  </option>
                ))}
              </select>
            </div>
            <NumField
              id="m3-cap"
              label={`初始本金（${ccy}）`}
              tip="本金幣別跟著標的：台股新台幣、美股美元、港股港幣、日股日圓、英股便士（GBp）…。例如回測 NVDA 填 1,000,000 代表 100 萬美元；想比照台幣 100 萬，請自行換算。"
              step="100000"
              value={m3Form.initial_capital}
              onChange={(v) => set({ initial_capital: v })}
            />
            <NumField
              id="m3-disc"
              label="台股手續費折數"
              tip="券商手續費 0.1425% 乘上折數，例如 0.6＝六折。台股賣出另扣 0.3% 證交稅（ETF 0.1%）。"
              step="0.1"
              min="0.1"
              max="1.0"
              value={m3Form.commission_discount}
              onChange={(v) => set({ commission_discount: v })}
            />
            <div>
              <label htmlFor="m3-years" className="block text-xs text-slate-400 mb-1">
                回測期間
                <window.TA.Tip text="期間越長、交易筆數越多，結果越可信；3 年以上才會涵蓋多頭、盤整、空頭不同環境，前後段驗證也比較有意義。" />
              </label>
              <select
                id="m3-years"
                value={m3Form.period_years || 1}
                onChange={(e) => set({ period_years: Number(e.target.value) })}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
              >
                <option value={1}>近 1 年</option>
                <option value={3}>近 3 年</option>
                <option value={5}>近 5 年</option>
                <option value={10}>近 10 年</option>
              </select>
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3 space-y-2">
            <div className="text-xs text-slate-300">
              <b>{strat.label}</b>：{strat.rule}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
              {strat.params.map((p) => (
                <NumField
                  key={`${strat.key}-${p.key}`}
                  id={`m3-p-${p.key}`}
                  label={p.label}
                  tip={`${p.tip}（範圍 ${p.lo}～${p.hi}）`}
                  step={p.integer ? 1 : 0.1}
                  min={p.lo}
                  max={p.hi}
                  value={params[p.key]}
                  onChange={(v) => set({ params: { ...params, [p.key]: v } })}
                />
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3 space-y-2">
            <div className="text-xs font-semibold text-slate-300">部位與風控</div>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3 items-end">
              <div>
                <label htmlFor="m3-sizing" className="block text-xs text-slate-400 mb-1">
                  部位模型
                  <window.TA.Tip text={SIZING_HELP[mode]} />
                </label>
                <select
                  id="m3-sizing"
                  value={mode}
                  onChange={(e) => set({ sizing_mode: e.target.value, sizing_value: SIZING_DEFAULT[e.target.value] })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                >
                  {Object.entries(cat.sizing_modes).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <NumField
                id="m3-sizing-v"
                label={mode === 'fixed' ? `每筆金額（${ccy}）` : mode === 'atr_risk' ? '每筆風險 %' : '每筆資金 %'}
                tip={SIZING_HELP[mode]}
                step={mode === 'fixed' ? 10000 : mode === 'atr_risk' ? 0.1 : 5}
                value={m3Form.sizing_value ?? SIZING_DEFAULT[mode]}
                onChange={(v) => set({ sizing_value: v })}
              />
              {mode === 'atr_risk' && (
                <NumField
                  id="m3-atr"
                  label="ATR 倍數"
                  tip="假設最壞跌幾倍 ATR(14)（近 14 天平均真實波動）。倍數越大、算出來的股數越少。常用 2。"
                  step={0.5}
                  value={m3Form.atr_mult ?? 2}
                  onChange={(v) => set({ atr_mult: v })}
                />
              )}
              <NumField
                id="m3-sl"
                label="單筆最大虧損 %"
                tip="跌破進場價這個 % 就停損出場（盤中觸價成交，跳空跌破以開盤價成交）。0＝不設停損。"
                step={1}
                min={0}
                max={50}
                value={m3Form.stop_loss_pct ?? 0}
                onChange={(v) => set({ stop_loss_pct: v })}
              />
              <NumField
                id="m3-trail"
                label="移動停利回落 %"
                tip="從持有期間最高價回落這個 % 就出場，讓獲利單跟著漲勢往上移出場點。0＝不使用。"
                step={1}
                min={0}
                max={50}
                value={m3Form.trailing_pct ?? 0}
                onChange={(v) => set({ trailing_pct: v })}
              />
              <div>
                <label className="flex items-center gap-2 text-xs text-slate-300 mb-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!m3Form.market_filter}
                    onChange={(e) => set({ market_filter: e.target.checked })}
                  />
                  大盤濾網
                  <window.TA.Tip text="大盤（台股＝加權指數，美股＝S&P 500…）收盤在 N 日均線之下時不開新倉，已持有的照原規則出場。預設 60 日（季線）。結果會統計被擋下幾次。" />
                </label>
                <input
                  aria-label="大盤濾網均線天數"
                  type="number"
                  min="5"
                  max="250"
                  disabled={!m3Form.market_filter}
                  value={m3Form.filter_ma ?? 60}
                  onChange={(e) => set({ filter_ma: Number(e.target.value) })}
                  className={`${inputCls} disabled:opacity-40`}
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={runMod3}
              disabled={m3Loading}
              className="py-2 px-6 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-semibold text-sm shadow-lg shadow-sky-600/25 transition cursor-pointer"
            >
              {m3Loading ? '回測中...' : '執行回測'}
            </button>
          </div>
        </div>

        {(m3Data?.strategy_warnings || []).map((w) => (
          <div key={w} className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs text-amber-100">
            ⚠️ {w}
          </div>
        ))}

        {r && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              {TABS.map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setTab(k)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer border ${
                    tab === k
                      ? 'bg-sky-600/20 border-sky-500/50 text-sky-200'
                      : 'border-slate-700 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {label}
                  {k === 'trades' ? `（${r.total_trades}）` : ''}
                </button>
              ))}
              <span className="ml-auto text-[11px] text-slate-500">
                {m3Data.symbol}｜{m3Data.strategy?.label || '雙均線交叉'}（{m3Data.strategy?.params_text}）｜{m3Data.period}
              </span>
            </div>

            {tab === 'perf' && (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Kpi
                    label="期末淨值 / 總報酬率"
                    tip="從初始本金開始，依序加上每筆已平倉交易扣除手續費與稅後的損益（期末仍持有的部位另外列在下方）。"
                    value={`${r.final_equity?.toLocaleString()} ${m3Data.currency || ''} (${r.total_return_pct}%)`}
                    cls="text-emerald-400"
                  />
                  <Kpi
                    label="獲利因子 (Profit Factor)"
                    tip="總獲利 ÷ 總虧損。大於 1 才有賺，1.5 以上較理想；交易筆數少時參考性很低。"
                    value={pf(r.profit_factor)}
                    cls="text-sky-300"
                  />
                  <Kpi
                    label="最大回撤 (Max Drawdown)"
                    tip="用每天收盤市值計算：淨值從高點跌到之後低點的最大幅度，含持有中的帳面虧損，代表照這個策略做時最痛的一段。"
                    value={`-${r.max_drawdown_pct}%`}
                    cls="text-rose-400"
                  />
                  <Kpi
                    label="勝率 / 單筆期望值"
                    tip="勝率＝賺錢筆數 ÷ 總筆數；單筆期望值＝平均每筆報酬率。高勝率不一定賺錢，要搭配獲利因子一起看。"
                    value={`${r.win_rate_pct}% / ${r.expectancy_pct}%`}
                    cls="text-amber-300"
                  />
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3">
                    <div className="text-xs text-slate-400">
                      平均獲利（{r.winning_trades ?? 0} 筆）
                      <window.TA.Tip text="只看賺錢的交易，平均每筆賺幾 %。" />
                    </div>
                    <div className="font-bold font-mono text-emerald-400 mt-1">+{r.avg_win_pct}%</div>
                  </div>
                  <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3">
                    <div className="text-xs text-slate-400">
                      平均虧損（{r.losing_trades ?? 0} 筆）
                      <window.TA.Tip text="只看賠錢的交易，平均每筆賠幾 %。" />
                    </div>
                    <div className="font-bold font-mono text-rose-400 mt-1">{r.avg_loss_pct}%</div>
                  </div>
                  <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3">
                    <div className="text-xs text-slate-400">
                      賺賠比
                      <window.TA.Tip text="平均獲利 ÷ 平均虧損。賺賠比 2 代表賺的時候平均是賠的時候的 2 倍；勝率不到一半，只要賺賠比夠高仍可能獲利。" />
                    </div>
                    <div className="font-bold font-mono text-sky-300 mt-1">{r.payoff_ratio ?? '--'}</div>
                  </div>
                </div>

                <DailyEquityChart
                  points={r.daily_equity}
                  initialCapital={m3Data.strategy_params?.initial_capital || 1000000}
                  dd={r.max_drawdown_detail}
                />
                <RiskSummary r={r} risk={m3Data.risk_settings} currency={m3Data.currency || ''} />
                <EquityCurveChart
                  curve={m3Data.equity_curve}
                  initialCapital={m3Data.strategy_params?.initial_capital || 1000000}
                />

                <div
                  className={`rounded-xl border px-4 py-2 text-xs ${
                    r.sample_size_warning
                      ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
                      : 'border-emerald-500/30 bg-emerald-500/5 text-emerald-200'
                  }`}
                >
                  交易次數 {r.total_trades} 筆：{r.sample_size_note || '這段期間沒有完成的交易'}
                  <window.TA.Tip text="交易筆數太少時，好看的結果可能只是運氣或參數剛好配合這段行情（過度擬合）。一般建議至少 30 筆以上再相信統計數字。" />
                </div>
              </>
            )}

            {tab === 'trades' && <TradesTable trades={r.trades || []} />}

            {tab === 'verify' && (
              <>
                <RegimeTable data={m3Data.regime_breakdown} />
                <WalkForwardCard wf={m3Data.walk_forward} />
                {!m3Data.regime_breakdown && !m3Data.walk_forward && (
                  <div className="text-xs text-slate-500">大盤資料或期間不足，沒有驗證結果；把回測期間拉長到 3 年以上再試。</div>
                )}
                {(m3Data.next_step_ideas || []).length > 0 && (
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-xs space-y-1">
                    <div className="font-semibold text-slate-300 mb-1">
                      下一步可測試的規則（不過度擬合）
                      <window.TA.Tip text="依上面的環境拆分與前後段驗證自動產生。每次只加一條規則再重跑，並看「後段驗證期」有沒有變好；一次改很多參數，很容易只是把歷史調得好看。" />
                    </div>
                    {m3Data.next_step_ideas.map((x) => (
                      <div key={x} className="text-slate-300">
                        • {x}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
        {r && (
          <window.TA.AiExplain
            module="mod3"
            provenance={[{ text: '回測使用真實還權日 K，並已扣除手續費與稅' }]}
            data={{
              symbol: m3Data.symbol,
              strategy: m3Data.strategy,
              params: m3Data.strategy_params,
              risk_settings: m3Data.risk_settings,
              result: {
                ...r,
                daily_equity: undefined,
                blocked_dates: undefined,
                trades: (r.trades || []).slice(0, 12),
              },
              warnings: m3Data.strategy_warnings,
              regime_breakdown: m3Data.regime_breakdown,
              walk_forward: m3Data.walk_forward,
              next_step_ideas: m3Data.next_step_ideas,
            }}
          />
        )}
      </div>
    );
  }

  window.TA = Object.assign(window.TA || {}, { Mod3Panel });
})();
