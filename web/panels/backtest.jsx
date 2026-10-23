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
            text={`把期間切兩段：前 70% 用來挑「歷史上最好」的均線參數（${wf.grid}），後 30% 是沒看過的資料，用來檢查那組參數是否還有效。前段很好、後段變差＝過度擬合。`}
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
                前段最佳 {wf.best_params.fast_ma}/{wf.best_params.slow_ma}
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

  function Mod3Panel({ ctx }) {
    const { m3Data, m3Form, m3Loading, runMod3, setM3Form } = ctx;
    const { EquityCurveChart } = window.TA;
    return (
      <div className="space-y-5" data-tour="mod3-root">
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4">
          <div>
            <h2 className="text-base font-semibold text-white">
              回測參數
            </h2>
            <span className="block mt-1 text-xs text-slate-500">
              資料狀態：回測用真實還權日 K（Yahoo/FinMind）；查無行情時會直接報錯，不會用假資料
            </span>
            <p className="text-xs text-slate-400">
              訊號於收盤確認、隔日開盤價成交，已扣除手續費與證交稅
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-7 gap-3 items-end">
            <div>
              <label htmlFor="m3-asset" className="block text-xs text-slate-400 mb-1">
                回測標的代號
                <window.TA.Tip text="用這檔的真實還權日 K（約 1 年）回測，台股輸入數字代號、美股輸入英文代號。" />
              </label>
              <input
                id="m3-asset"
                type="text"
                value={m3Form.target_asset}
                onChange={(e) => setM3Form({ ...m3Form, target_asset: e.target.value })}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm font-mono text-white"
              />
            </div>
            <div>
              <label htmlFor="m3-fast" className="block text-xs text-slate-400 mb-1">
                短均線週期 (MA Fast)
                <window.TA.Tip text="短均線由下往上穿過長均線＝買進訊號（黃金交叉）；短均線跌回長均線下方＝賣出訊號。" />
              </label>
              <input
                id="m3-fast"
                type="number"
                min="2"
                max="60"
                value={m3Form.fast_ma}
                onChange={(e) => setM3Form({ ...m3Form, fast_ma: Number(e.target.value) })}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm font-mono text-white"
              />
            </div>
            <div>
              <label htmlFor="m3-slow" className="block text-xs text-slate-400 mb-1">
                長均線週期 (MA Slow)
                <window.TA.Tip text="長均線代表較長期的平均成本，必須大於短均線週期。" />
              </label>
              <input
                id="m3-slow"
                type="number"
                min="5"
                max="120"
                value={m3Form.slow_ma}
                onChange={(e) => setM3Form({ ...m3Form, slow_ma: Number(e.target.value) })}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm font-mono text-white"
              />
            </div>
            <div>
              <label htmlFor="m3-cap" className="block text-xs text-slate-400 mb-1">
                初始本金（{window.TA.currencyOf(window.TA.normSym(m3Form.target_asset || ''))}）
                <window.TA.Tip text="本金幣別跟著標的：台股新台幣、美股美元、港股港幣、日股日圓、英股便士（GBp）…。例如回測 NVDA 填 1,000,000 代表 100 萬美元；想比照台幣 100 萬，請自行換算。" />
              </label>
              <input
                id="m3-cap"
                type="number"
                step="100000"
                value={m3Form.initial_capital}
                onChange={(e) => setM3Form({ ...m3Form, initial_capital: Number(e.target.value) })}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm font-mono text-white"
              />
            </div>
            <div>
              <label htmlFor="m3-disc" className="block text-xs text-slate-400 mb-1">
                台股手續費折數
                <window.TA.Tip text="券商手續費 0.1425% 乘上折數，例如 0.6＝六折。台股賣出另扣 0.3% 證交稅（ETF 0.1%）。" />
              </label>
              <input
                id="m3-disc"
                type="number"
                step="0.1"
                min="0.1"
                max="1.0"
                value={m3Form.commission_discount}
                onChange={(e) =>
                  setM3Form({
                    ...m3Form,
                    commission_discount: Number(e.target.value),
                  })
                }
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm font-mono text-white"
              />
            </div>
            <div>
              <label htmlFor="m3-years" className="block text-xs text-slate-400 mb-1">
                回測期間
                <window.TA.Tip text="期間越長、交易筆數越多，結果越可信；3 年以上才會涵蓋多頭、盤整、空頭不同環境，前後段驗證也比較有意義。" />
              </label>
              <select
                id="m3-years"
                value={m3Form.period_years || 1}
                onChange={(e) => setM3Form({ ...m3Form, period_years: Number(e.target.value) })}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
              >
                <option value={1}>近 1 年</option>
                <option value={3}>近 3 年</option>
                <option value={5}>近 5 年</option>
                <option value={10}>近 10 年</option>
              </select>
            </div>
            <div>
              <button
                type="button"
                onClick={runMod3}
                disabled={m3Loading}
                className="w-full py-2 px-4 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-semibold text-sm shadow-lg shadow-sky-600/25 transition cursor-pointer"
              >
                {m3Loading ? '回測中...' : '執行回測'}
              </button>
            </div>
          </div>
        </div>

        {(m3Data?.strategy_warnings || []).map((w) => (
          <div
            key={w}
            className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs text-amber-100"
          >
            ⚠️ {w}
          </div>
        ))}

        {m3Data?.backtest_result && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <div className="text-xs text-slate-400">
                  期末淨值 / 總報酬率
                  <window.TA.Tip text="從初始本金開始，依序加上每筆交易扣除手續費與稅後的損益。" />
                </div>
                <div className="text-lg font-bold font-mono text-emerald-400 mt-1">
                  {m3Data.backtest_result.final_equity?.toLocaleString()} {m3Data.currency || ''} (
                  {m3Data.backtest_result.total_return_pct}%)
                </div>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <div className="text-xs text-slate-400">
                  獲利因子 (Profit Factor)
                  <window.TA.Tip text="總獲利 ÷ 總虧損。大於 1 才有賺，1.5 以上較理想；交易筆數少時參考性很低。" />
                </div>
                <div className="text-lg font-bold font-mono text-sky-300 mt-1">
                  {m3Data.backtest_result.profit_factor}
                </div>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <div className="text-xs text-slate-400">
                  最大回撤 (Max Drawdown)
                  <window.TA.Tip text="淨值從高點跌到之後低點的最大幅度，代表照這個策略做時最痛的一段。" />
                </div>
                <div className="text-lg font-bold font-mono text-rose-400 mt-1">
                  -{m3Data.backtest_result.max_drawdown_pct}%
                </div>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <div className="text-xs text-slate-400">
                  勝率 / 單筆期望值
                  <window.TA.Tip text="勝率＝賺錢筆數 ÷ 總筆數；單筆期望值＝平均每筆報酬率。高勝率不一定賺錢，要搭配獲利因子一起看。" />
                </div>
                <div className="text-lg font-bold font-mono text-amber-300 mt-1">
                  {m3Data.backtest_result.win_rate_pct}% / {m3Data.backtest_result.expectancy_pct}%
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3">
                <div className="text-xs text-slate-400">
                  平均獲利（{m3Data.backtest_result.winning_trades ?? 0} 筆）
                  <window.TA.Tip text="只看賺錢的交易，平均每筆賺幾 %。" />
                </div>
                <div className="font-bold font-mono text-emerald-400 mt-1">+{m3Data.backtest_result.avg_win_pct}%</div>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3">
                <div className="text-xs text-slate-400">
                  平均虧損（{m3Data.backtest_result.losing_trades ?? 0} 筆）
                  <window.TA.Tip text="只看賠錢的交易，平均每筆賠幾 %。" />
                </div>
                <div className="font-bold font-mono text-rose-400 mt-1">{m3Data.backtest_result.avg_loss_pct}%</div>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3">
                <div className="text-xs text-slate-400">
                  賺賠比
                  <window.TA.Tip text="平均獲利 ÷ 平均虧損。賺賠比 2 代表賺的時候平均是賠的時候的 2 倍；勝率不到一半，只要賺賠比夠高仍可能獲利。" />
                </div>
                <div className="font-bold font-mono text-sky-300 mt-1">{m3Data.backtest_result.payoff_ratio ?? '--'}</div>
              </div>
            </div>

            <EquityCurveChart
              curve={m3Data.equity_curve}
              initialCapital={m3Data.strategy_params?.initial_capital || 1000000}
            />

            <div
              className={`rounded-xl border px-4 py-2 text-xs ${
                m3Data.backtest_result.sample_size_warning
                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
                  : 'border-emerald-500/30 bg-emerald-500/5 text-emerald-200'
              }`}
            >
              交易次數 {m3Data.backtest_result.total_trades} 筆：
              {m3Data.backtest_result.sample_size_note}
              <window.TA.Tip text="交易筆數太少時，好看的結果可能只是運氣或參數剛好配合這段行情（過度擬合）。一般建議至少 30 筆以上再相信統計數字。" />
            </div>

            <RegimeTable data={m3Data.regime_breakdown} />
            <WalkForwardCard wf={m3Data.walk_forward} />
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

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 overflow-x-auto">
              <div className="text-xs font-semibold text-slate-300 mb-3">
                逐筆交易明細（Next Bar Open：隔日開盤價成交，已扣摩擦成本）
                <window.TA.Tip text="訊號在當天收盤後才確定，所以用「隔天開盤價」成交，避免偷看未來；摩擦成本＝手續費＋證交稅。這些是策略的模擬成交，不是你的真實交易。" />
              </div>
              <table className="w-full text-left text-xs font-mono">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="py-2 px-2">#</th>
                    <th className="py-2 px-2">進場日 (t+1 Open)</th>
                    <th className="py-2 px-2">進場價</th>
                    <th className="py-2 px-2">出場日 (t+1 Open)</th>
                    <th className="py-2 px-2">出場價</th>
                    <th className="py-2 px-2">淨損益 (扣稅費)</th>
                    <th className="py-2 px-2">報酬率</th>
                    <th className="py-2 px-2 font-sans">進場時大盤</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {(m3Data.backtest_result.trades || []).map((t, idx) => (
                    <tr key={`${t.entry_date}-${idx}`} className="hover:bg-slate-800/40">
                      <td className="py-2 px-2 text-slate-400">#{idx + 1}</td>
                      <td className="py-2 px-2">{t.entry_date}</td>
                      <td className="py-2 px-2">{t.entry_price}</td>
                      <td className="py-2 px-2">{t.exit_date}</td>
                      <td className="py-2 px-2">{t.exit_price}</td>
                      <td
                        className={`py-2 px-2 font-bold ${
                          t.net_pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {t.net_pnl >= 0 ? `+${t.net_pnl}` : t.net_pnl}
                      </td>
                      <td
                        className={`py-2 px-2 font-bold ${
                          t.return_pct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {t.return_pct}%
                      </td>
                      <td className="py-2 px-2 font-sans text-slate-400">{t.regime || '--'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {m3Data?.backtest_result && (
          <window.TA.AiExplain
            module="mod3"
            provenance={[{ text: '回測使用真實還權日 K，並已扣除手續費與稅' }]}
            data={{
              symbol: m3Data.symbol,
              params: m3Data.strategy_params,
              result: {
                ...m3Data.backtest_result,
                trades: (m3Data.backtest_result.trades || []).slice(0, 12),
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
