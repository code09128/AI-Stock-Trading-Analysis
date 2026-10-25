// 策略回測頁：表單＋結果分頁。小元件在 backtest_parts.jsx，驗證類在 backtest_verify.jsx
(() => {
  const TABS = [
    ['perf', '績效總覽'],
    ['trades', '交易明細'],
    ['verify', '環境與前後段'],
    ['optimize', '參數最佳化'],
    ['mc', '蒙地卡羅'],
  ];

  function Mod3Panel({ ctx }) {
    const { m3Data, m3Form, m3Loading, runMod3, setM3Form } = ctx;
    const { EquityCurveChart } = window.TA;
    const {
      pf,
      FALLBACK_CATALOG,
      SIZING_DEFAULT,
      SIZING_HELP,
      inputCls,
      NumField,
      HelpCard,
      DailyEquityChart,
      RiskSummary,
      TradesTable,
      Kpi,
      RegimeTable,
      WalkForwardCard,
      OptimizePanel,
      MonteCarloPanel,
    } = window.TA.BT;
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
    // 熱力圖點一格：把那組參數帶回表單（策略改回這次回測用的），捲回上方讓使用者確認後再執行
    const pickParams = (p) => {
      const { strategy: key, initial_capital, commission_discount, period_years, ...used } = m3Data.strategy_params || {};
      set({ strategy: key, params: { ...used, ...p } });
      document.querySelector('[data-tour="mod3-root"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      window.TA.toast?.(`已帶入參數 ${Object.entries(p).map(([k, v]) => `${k}=${v}`).join('、')}，按「執行回測」套用`);
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
            {tab === 'optimize' && <OptimizePanel m3Data={m3Data} onPick={pickParams} />}
            {tab === 'mc' && <MonteCarloPanel m3Data={m3Data} />}
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
