(() => {
  // 策略回測：零未來函數策略回測
  function Mod3Panel({ ctx }) {
    const { m3Data, m3Form, m3Loading, runMod3, setM3Form } = ctx;
    const { EquityCurveChart } = window.TA;
    return (
      <div className="space-y-5" data-tour="mod3-root">
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4">
          <div>
            <h2 className="text-lg font-bold text-white">
              ⚙️ 策略回測：零未來函數策略回測實驗室 (Next Bar Open)
            </h2>
            <span className="inline-block mt-1 text-[11px] px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
              資料狀態：回測用真實還權日 K（Yahoo/FinMind）；查無行情時會直接報錯，不會用假資料
            </span>
            <p className="text-xs text-slate-400">
              第 t 日收盤訊號強制於 t+1 日開盤價成交，並自動依台美股市場扣除手續費與 0.3%
              台股賣出證交稅
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-6 gap-3 items-end">
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
                初始本金
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
              <button
                type="button"
                onClick={runMod3}
                disabled={m3Loading}
                className="w-full py-2 px-4 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-semibold text-sm shadow-lg shadow-sky-600/25 transition cursor-pointer"
              >
                {m3Loading ? '回測中...' : '⚡ 執行回測'}
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
                  {m3Data.backtest_result.final_equity?.toLocaleString()} (
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

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 overflow-x-auto">
              <div className="text-xs font-semibold text-slate-300 mb-3">
                📋 Next Bar Open 逐筆進出場明細（已扣除摩擦成本）
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
            }}
          />
        )}
      </div>
    );
  }

  window.TA = Object.assign(window.TA || {}, { Mod3Panel });
})();
