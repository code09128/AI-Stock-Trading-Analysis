(() => {
  // 組合風控：跨市場資產配置與穿透風控
  // 持股來源列：我的持股（看盤頁）範例
  function MyHoldingsBar({ m4Holdings, loadMyHoldings }) {
    const { holdings } = window.TA.usePortfolio();
    const isSample = JSON.stringify(m4Holdings) === JSON.stringify(window.TA.DEFAULT_HOLDINGS);
    // 帶入後看盤頁的持股又變了（成交、修改、刪除）：這裡分析的是舊版本，要提醒
    const key = (list) =>
      list
        .map((h) => `${window.TA.normSym(String(h.symbol))}:${Number(h.shares)}`)
        .sort()
        .join('|');
    const stale = !isSample && holdings.length > 0 && key(m4Holdings) !== key(holdings);
    return (
      <div
        data-tour="mod4-source"
        className={`rounded-xl border px-4 py-2 text-xs flex flex-wrap items-center gap-2 ${
          isSample || stale
            ? 'border-amber-500/40 bg-amber-500/10 text-amber-100'
            : 'border-emerald-500/30 bg-emerald-500/5 text-emerald-100'
        }`}
      >
        {isSample
          ? '⚠️ 目前用的是範例持股。'
          : stale
            ? '⚠️ 這裡的持股和看盤頁「我的持股」不一致（看盤頁後來有成交或修改，或你在這裡手動改過）。要分析最新持股請按「重新帶入我的持股」。'
            : '✅ 目前分析的是你帶入的持股。'}
        <span className="text-slate-400">
          看盤頁「我的持股」有 {holdings.length} 檔（含模擬成交）。
        </span>
        {holdings.length > 0 && (
          <button
            type="button"
            onClick={() => loadMyHoldings(holdings)}
            className="ml-auto px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer"
          >
            重新帶入我的持股
          </button>
        )}
        {holdings.length === 0 && (
          <button
            type="button"
            onClick={() => window.TA.goTab?.('watch')}
            className="ml-auto px-3 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 text-white cursor-pointer"
          >
            到看盤頁新增持股
          </button>
        )}
      </div>
    );
  }

  const pctColor = (v) =>
    v == null ? 'text-slate-500' : v >= 0 ? 'text-emerald-400' : 'text-rose-400';
  const ntd = (v) => (v == null ? '--' : `NT$ ${Math.round(v).toLocaleString()}`);

  function Bars({ items }) {
    return (
      <div className="space-y-1.5">
        {items.map((x) => (
          <div key={x.name}>
            <div className="flex justify-between text-[11px]">
              <span className="text-slate-300">
                {x.name}
                {x.symbols && (
                  <span className="text-slate-500 font-mono">（{x.symbols.join('、')}）</span>
                )}
              </span>
              <span
                className={`font-mono ${x.weight_pct >= 50 ? 'text-rose-400 font-bold' : 'text-sky-300'}`}
              >
                {x.weight_pct}%
              </span>
            </div>
            <div className="w-full h-2 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
              <div
                className={`h-full ${x.weight_pct >= 50 ? 'bg-rose-500' : 'bg-sky-500'}`}
                style={{ width: `${Math.min(x.weight_pct, 100)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    );
  }

  // 多情境壓力測試：Beta 線性 -10%/-20%、2022 升息與 2020 疫情的真實回放、曝險、高相關、避險取捨
  function ScenarioStress({ data }) {
    if (!data) return null;
    if (data.error) return <div className="text-xs text-amber-300">⚠️ {data.error}</div>;
    const { exposures: ex, correlation: cor } = data;
    return (
      <div
        data-tour="mod4-scenarios"
        className="bg-slate-900 border border-rose-500/30 rounded-xl p-5 space-y-4"
      >
        <div className="text-xs font-semibold text-rose-300">
          多情境壓力測試
          <window.TA.Tip text="同時看 4 種情境：大盤修正 -10%、熊市 -20%（用 Beta 線性估算），以及「利率快速上升」「經濟衰退」兩段真實歷史：把你現在的持股套回當時的真實收盤價，看會跌多少。歷史不代表未來。" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          {data.beta_scenarios.map((b) => (
            <div
              key={b.market_move_pct}
              className="rounded-lg bg-slate-950/70 border border-slate-800 p-3"
            >
              <div className="text-slate-400">
                {b.market_move_pct === -10 ? '市場修正' : '熊市下跌'} {b.market_move_pct}%
                <window.TA.Tip
                  text={`組合預估跌幅＝大盤跌幅 × 組合 Beta。線性估算，真實下跌時個股可能跌得更多。`}
                />
              </div>
              <div className="text-lg font-bold font-mono text-rose-400">
                {b.portfolio_move_pct}%
              </div>
              <div className="font-mono text-slate-300">{ntd(b.loss_twd)}</div>
              <div className="text-[10px] text-slate-500">Beta 線性估算</div>
            </div>
          ))}
          {data.historical_scenarios.map((h) => (
            <div key={h.key} className="rounded-lg bg-slate-950/70 border border-slate-800 p-3">
              <div className="text-slate-400">
                {h.name}
                <window.TA.Tip text={`${h.event}（${h.start} ~ ${h.end}）。${h.why}`} />
              </div>
              {h.available ? (
                <>
                  <div
                    className={`text-lg font-bold font-mono ${pctColor(h.portfolio_return_pct)}`}
                  >
                    {h.portfolio_return_pct}%
                  </div>
                  <div className="font-mono text-slate-300">{ntd(h.loss_twd_now)}</div>
                  <div className="text-[10px] text-slate-500">
                    {h.event}・期間最大回撤 {h.portfolio_max_drawdown_pct}%
                  </div>
                </>
              ) : (
                <div className="text-slate-500 mt-1">{h.reason}</div>
              )}
            </div>
          ))}
        </div>

        {data.historical_scenarios
          .filter((h) => h.available)
          .map((h) => (
            <div key={`t-${h.key}`} className="overflow-x-auto">
              <div className="text-[11px] text-slate-400 mb-1">
                {h.name}（{h.event}，{h.start} ~ {h.end}）各持股真實漲跌・涵蓋持股 {h.coverage_pct}
                %・同期大盤：
                {h.benchmarks.map((b) => ` ${b.name} ${b.return_pct}%`).join('、')}
              </div>
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="text-slate-500 text-left font-sans">
                    <th className="py-1">標的</th>
                    <th>目前權重</th>
                    <th>期間漲跌</th>
                    <th>期間最低</th>
                    <th>備註</th>
                  </tr>
                </thead>
                <tbody>
                  {h.rows.map((r) => (
                    <tr key={r.symbol} className="border-t border-slate-800">
                      <td className="py-1 text-white font-bold">{r.symbol}</td>
                      <td>{r.weight_pct}%</td>
                      <td className={pctColor(r.return_pct)}>
                        {r.return_pct == null ? '--' : `${r.return_pct}%`}
                      </td>
                      <td className={pctColor(r.worst_pct)}>
                        {r.worst_pct == null ? '--' : `${r.worst_pct}%`}
                      </td>
                      <td className="font-sans text-slate-400">
                        {r.note ||
                          (r.drags ? (
                            <span className="text-rose-300">
                              跌幅比組合多 5% 以上，拋售時拖累最大
                            </span>
                          ) : (
                            ''
                          ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <div className="text-xs font-semibold text-slate-300">
              地區曝險
              <window.TA.Tip text={ex.note} />
            </div>
            <Bars items={ex.region} />
          </div>
          <div className="space-y-2">
            <div className="text-xs font-semibold text-slate-300">
              產業曝險
              <window.TA.Tip text="依直接持有的標的分類，單一產業 ≥ 50% 標紅。ETF 另列，內容請看下方穿透曝險。" />
            </div>
            <Bars items={ex.sector} />
          </div>
        </div>

        <div className="space-y-1">
          <div className="text-xs font-semibold text-slate-300">
            重複押注／隱藏關聯（近 1 年日報酬相關係數）
            <window.TA.Tip text={cor.note} />
          </div>
          {cor.pairs.length ? (
            <div className="flex flex-wrap gap-2 text-xs font-mono">
              {cor.pairs.map((p) => (
                <span
                  key={`${p.a}-${p.b}`}
                  className={`px-2 py-1 rounded border ${
                    p.high
                      ? 'border-rose-500/50 bg-rose-500/10 text-rose-200'
                      : 'border-slate-700 text-slate-300'
                  }`}
                >
                  {p.a} × {p.b}：{p.corr}
                  {p.high && <span className="font-sans">（合計 {p.weight_pct}%，幾乎同步）</span>}
                </span>
              ))}
            </div>
          ) : (
            <div className="text-xs text-slate-500">同一市場的持股不到 2 檔，無法比較。</div>
          )}
        </div>

        <div className="overflow-x-auto">
          <div className="text-xs font-semibold text-slate-300 mb-1">
            分散或避險方式的取捨
            <window.TA.Tip text="一般性的工具比較，不是針對你的個人建議。沒有免費的避險：降低下跌風險，通常也會降低上漲時的報酬或增加成本。" />
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-500 text-left">
                <th className="py-1">方式</th>
                <th>優點</th>
                <th>缺點</th>
                <th>成本</th>
              </tr>
            </thead>
            <tbody>
              {data.hedges.map((h) => (
                <tr key={h.name} className="border-t border-slate-800 align-top">
                  <td className="py-1.5 pr-2 text-white font-bold whitespace-nowrap">{h.name}</td>
                  <td className="pr-2 text-emerald-200">{h.pros}</td>
                  <td className="pr-2 text-rose-200">{h.cons}</td>
                  <td className="text-slate-400">{h.cost}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  function Mod4Panel({ ctx }) {
    const {
      m4Beta,
      m4CashPct,
      m4Data,
      m4Holdings,
      m4Live,
      m4Loading,
      runMod4,
      setM4Beta,
      setM4CashPct,
      setM4Holdings,
      setM4Live,
      loadMyHoldings,
    } = ctx;
    return (
      <div className="space-y-5">
        <window.TA.RulesReminder compact />
        <MyHoldingsBar m4Holdings={m4Holdings} loadMyHoldings={loadMyHoldings} />
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-white">持股與目標權重</h2>
              <span className="block mt-1 text-xs text-slate-500">
                資料狀態：匯率、即時價、ETF
                前十大成分股、Beta（留空時）、歷史回落皆為真實資料；持股來源見上方
              </span>
              <p className="text-xs text-slate-400">
                以即時價與匯率換算台幣市值，拆解 ETF 成分股曝險並執行壓力測試
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                setM4Holdings([
                  ...m4Holdings,
                  {
                    symbol: '2454',
                    market: 'TW',
                    shares: 500,
                    price: 1300,
                    target_pct: 10,
                  },
                ])
              }
              className="text-xs px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-sky-300 border border-slate-700 cursor-pointer"
            >
              新增持股部位
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2 px-2">代號（2330／NVDA／0700.HK／7203.T）</th>
                  <th className="py-2 px-2">市場</th>
                  <th className="py-2 px-2">持有股數</th>
                  <th className="py-2 px-2">目前單價 (原幣)</th>
                  <th className="py-2 px-2">目標再平衡權重 (%)</th>
                  <th className="py-2 px-2">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {m4Holdings.map((h, idx) => (
                  <tr key={`${h.symbol}-${idx}`}>
                    <td className="py-2 px-2">
                      <input
                        type="text"
                        value={h.symbol}
                        onChange={(e) => {
                          const next = [...m4Holdings];
                          next[idx] = { ...next[idx], symbol: e.target.value };
                          setM4Holdings(next);
                        }}
                        className="bg-slate-950 border border-slate-700 rounded px-2 py-1 w-28 text-white"
                      />
                    </td>
                    <td className="py-2 px-2">
                      {/* 市場與幣別依代號自動判斷（.HK 港股、.T 日股、.KS 韓股、.L 英股…；沒有後綴＝美股） */}
                      <span className="whitespace-nowrap text-slate-200">
                        {window.TA.MARKET_INFO[window.TA.marketOf(h.symbol || '')].flag}{' '}
                        {window.TA.marketName(h.symbol || '')}
                        <span className="ml-1 text-slate-500">
                          (
                          {m4Data?.portfolio_valuation?.holdings?.find(
                            (x) => x.symbol === String(h.symbol).toUpperCase(),
                          )?.currency || window.TA.currencyOf(h.symbol || '')}
                          )
                        </span>
                      </span>
                    </td>
                    <td className="py-2 px-2">
                      <input
                        type="number"
                        value={h.shares}
                        onChange={(e) => {
                          const next = [...m4Holdings];
                          next[idx] = {
                            ...next[idx],
                            shares: Number(e.target.value),
                          };
                          setM4Holdings(next);
                        }}
                        className="bg-slate-950 border border-slate-700 rounded px-2 py-1 w-24 text-white"
                      />
                    </td>
                    <td className="py-2 px-2">
                      <input
                        type="number"
                        step="0.1"
                        value={h.price}
                        onChange={(e) => {
                          const next = [...m4Holdings];
                          next[idx] = {
                            ...next[idx],
                            price: Number(e.target.value),
                          };
                          setM4Holdings(next);
                        }}
                        className="bg-slate-950 border border-slate-700 rounded px-2 py-1 w-28 text-white"
                      />
                    </td>
                    <td className="py-2 px-2">
                      <input
                        type="number"
                        step="1"
                        value={h.target_pct}
                        onChange={(e) => {
                          const next = [...m4Holdings];
                          next[idx] = {
                            ...next[idx],
                            target_pct: Number(e.target.value),
                          };
                          setM4Holdings(next);
                        }}
                        className="bg-slate-950 border border-slate-700 rounded px-2 py-1 w-20 text-amber-300"
                      />
                    </td>
                    <td className="py-2 px-2">
                      <button
                        type="button"
                        onClick={() => setM4Holdings(m4Holdings.filter((_, i) => i !== idx))}
                        className="text-rose-400 hover:text-rose-300 cursor-pointer"
                      >
                        刪除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end pt-2 border-t border-slate-800">
            <div>
              <label htmlFor="m4-cash" className="block text-xs text-slate-400 mb-1">
                目標保留現金權重 (CASH %)
              </label>
              <input
                id="m4-cash"
                type="number"
                value={m4CashPct}
                onChange={(e) => setM4CashPct(Number(e.target.value))}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm font-mono text-emerald-300"
              />
            </div>
            <div>
              <label className="flex items-center gap-2 text-xs text-sky-300 mb-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={m4Live}
                  onChange={(e) => setM4Live(e.target.checked)}
                />
                用即時報價計算持股市值（取消＝用表格填的價格）
              </label>
              <label htmlFor="m4-beta" className="block text-xs text-slate-400 mb-1">
                投資組合加權 Beta 值（留空＝用近 1 年真實報酬自動算）
                <window.TA.Tip text="Beta＝相對大盤的波動倍數：1＝跟大盤差不多，1.5＝大盤漲跌 1% 時平均漲跌 1.5%，負值＝跟大盤反向（例如反向 ETF）。留空時用每檔近 1 年日報酬對大盤（台股對加權指數、美股對 S&P 500）計算，再依市值權重加權。範例：0050 佔 60%（Beta 1.0）＋ NVDA 佔 40%（Beta 1.9）→ 0.6×1.0 ＋ 0.4×1.9 ＝ 1.36，大盤跌 20% 時組合預估約跌 27%。算完後下方會列出每檔的 Beta。" />
              </label>
              <input
                id="m4-beta"
                type="number"
                step="0.05"
                value={m4Beta}
                onChange={(e) => setM4Beta(e.target.value)}
                placeholder={m4Data ? `自動：${m4Data.portfolio_beta_used}` : '留空＝自動計算'}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm font-mono text-white"
              />
            </div>
            <div>
              <button
                type="button"
                onClick={runMod4}
                disabled={m4Loading}
                className="w-full py-2 px-4 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-semibold text-sm shadow-lg shadow-sky-600/25 transition cursor-pointer"
              >
                {m4Loading ? '計算中...' : '計算穿透曝險與再平衡'}
              </button>
            </div>
          </div>
        </div>

        {m4Data && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <div className="text-xs text-slate-400">
                  組合折合新台幣總市值
                  <window.TA.Tip text="每檔持股 × 即時價加總；海外持股依各自幣別（USD、HKD、JPY、KRW、GBp 便士…）用即時匯率換成台幣。" />
                </div>
                <div className="text-xl font-bold font-mono text-white mt-1">
                  NT$ {m4Data.portfolio_valuation?.total_value_twd?.toLocaleString()}
                </div>
                <div className="text-[11px] font-mono text-slate-400 mt-1">
                  匯率：
                  {Object.entries(m4Data.fx_rates || { USD: { rate: m4Data.usd_twd_rate } })
                    .filter(([c]) => c !== 'TWD')
                    .map(
                      ([c, r]) =>
                        `${c} ${r.rate}${r.source === '使用者輸入' ? '（你輸入的）' : ''}`,
                    )
                    .join('、') || '全部為台幣'}
                </div>
                {m4Data.fx_warning && (
                  <div className="text-[11px] text-amber-300 mt-1">⚠️ {m4Data.fx_warning}</div>
                )}
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <div className="text-xs text-slate-400">
                  目標權重加總檢查（權重守恆，需等於 100%）
                  <window.TA.Tip text="所有目標權重（含現金）加總必須剛好 100%，避免建議加碼加超過，或有資金沒分配到。" />
                </div>
                <div
                  className={`text-lg font-bold font-mono mt-1 ${
                    m4Data.rebalance_verification?.weight_conservation_passed
                      ? 'text-emerald-400'
                      : 'text-rose-400'
                  }`}
                >
                  {m4Data.rebalance_verification?.weight_conservation_passed
                    ? `✅ 守恆通過 (${m4Data.rebalance_verification.target_sum_pct ?? m4Data.rebalance_verification.target_weight_sum_pct}%)`
                    : `❌ 權重總和異常 (${m4Data.rebalance_verification?.target_sum_pct ?? m4Data.rebalance_verification?.target_weight_sum_pct}%)`}
                </div>
                <div className="text-[11px] text-slate-400 mt-1">
                  所有標的 + 現金目標權重必須嚴格等於 100%
                </div>
              </div>
              <div className="bg-rose-950/30 border border-rose-500/40 rounded-xl p-4">
                <div className="text-xs text-rose-300">
                  大盤崩跌 -20% 壓力測試預估損失（Beta 線性估算）
                  <window.TA.Tip text="預估跌幅＝20% × 組合 Beta。例如 Beta 1.25 代表大盤跌 20% 時組合平均約跌 25%。這是簡化的線性估算，真實股災可能更大，請一併看下方「歷史回落重演」。" />
                </div>
                <div className="text-xl font-bold font-mono text-rose-400 mt-1">
                  -NT$ {m4Data.crash_20pct_stress_test?.potential_loss_twd?.toLocaleString()} (
                  {m4Data.crash_20pct_stress_test?.expected_portfolio_drawdown_pct}%)
                </div>
                <div className="text-[11px] text-rose-200/80 mt-1">
                  建議避險：{m4Data.crash_20pct_stress_test?.suggested_hedge_tool}。
                  {m4Data.crash_20pct_stress_test?.rationale}
                </div>
              </div>
            </div>

            <div className="bg-slate-900 border border-rose-500/30 rounded-xl p-5 space-y-2">
              <div className="text-xs font-semibold text-rose-300">
                歷史回落重演（用你現在的持股回推過去約 2 年的真實走勢）
                <window.TA.Tip text="把你現在的持股數量套回過去約 2 年每天的真實收盤價，找出組合曾經的最大回撤，以及最差的連續 20 個交易日。假設持股與匯率不變。" />
              </div>
              {m4Data.historical_replay?.available ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs font-mono">
                  <div className="rounded-lg bg-slate-950/70 border border-slate-800 p-3">
                    <div className="text-slate-400">最大回撤</div>
                    <div className="text-xl font-bold text-rose-400">
                      {m4Data.historical_replay.max_drawdown_pct}%
                    </div>
                    <div className="text-slate-300">
                      約 NT$ {m4Data.historical_replay.max_drawdown_loss_twd?.toLocaleString()}
                    </div>
                    <div className="text-slate-500">
                      {m4Data.historical_replay.max_drawdown_window}
                    </div>
                  </div>
                  <div className="rounded-lg bg-slate-950/70 border border-slate-800 p-3">
                    <div className="text-slate-400">最差 20 個交易日</div>
                    <div className="text-xl font-bold text-rose-400">
                      {m4Data.historical_replay.worst_20d_pct}%
                    </div>
                    <div className="text-slate-300">
                      約 NT$ {m4Data.historical_replay.worst_20d_loss_twd?.toLocaleString()}
                    </div>
                    <div className="text-slate-500">
                      {m4Data.historical_replay.worst_20d_window}
                    </div>
                  </div>
                  <div className="md:col-span-2 text-[11px] text-slate-400 font-sans">
                    資料區間 {m4Data.historical_replay.period}（
                    {m4Data.historical_replay.trading_days} 個交易日）。
                    {m4Data.historical_replay.note}
                    {m4Data.historical_replay.missing?.length > 0 &&
                      ` 查無歷史資料未計入：${m4Data.historical_replay.missing.join('、')}。`}
                  </div>
                </div>
              ) : (
                <div className="text-xs text-slate-400">
                  無法計算：{m4Data.historical_replay?.reason}
                </div>
              )}
            </div>

            <ScenarioStress data={m4Data.scenario_stress} />

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-2">
              <div className="text-xs font-semibold text-slate-300">
                再平衡建議（目前權重 → 目標權重）
                <window.TA.Tip text="目前權重＝該檔市值 ÷ 總市值；目標權重在上方表格設定。差距為正代表要加碼、為負代表要減碼。" />
              </div>
              {m4Data.rebalance_verification?.error && (
                <div className="text-xs text-rose-300">⚠️ {m4Data.rebalance_verification.error}</div>
              )}
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="text-slate-500 text-left">
                    <th>標的</th>
                    <th>目前</th>
                    <th>目標</th>
                    <th>差距</th>
                    <th>動作</th>
                  </tr>
                </thead>
                <tbody>
                  {(m4Data.rebalance_verification?.rebalance_actions || []).map((r) => (
                    <tr key={r.symbol} className="border-t border-slate-800">
                      <td className="py-1 text-white font-bold">{r.symbol}</td>
                      <td>{r.current_weight_pct}%</td>
                      <td>{r.target_weight_pct}%</td>
                      <td className={r.delta_pct >= 0 ? 'text-rose-400' : 'text-emerald-400'}>
                        {r.delta_pct > 0 ? '+' : ''}
                        {r.delta_pct}%
                      </td>
                      <td className="text-slate-300">{r.action}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
              <div className="text-xs font-semibold text-slate-300">
                實際押在哪些公司（穿透式曝險 Look-through：把 ETF 拆成前十大成分股）
                <window.TA.Tip text="把 ETF 拆成它的前十大成分股，再加上你直接持有的個股，看你真正押在每一檔的比例。單一標的超過 30% 會標紅，代表高度集中。" />
              </div>
              <div className="text-[11px] text-slate-400 space-y-0.5">
                {Object.entries(m4Data.price_sources || {}).map(([sym, src]) => (
                  <div key={`p-${sym}`}>
                    {sym} 價格：{src}
                  </div>
                ))}
                {Object.entries(m4Data.lookthrough_sources || {}).map(([etf, src]) => (
                  <div key={etf}>
                    {etf}：{src}
                  </div>
                ))}
                <div>
                  Beta {m4Data.portfolio_beta_used}：{m4Data.portfolio_beta_source}
                  {(m4Data.beta_detail || [])
                    .map((b) => ` ${b.symbol}=${b.beta ?? 'N/A'}`)
                    .join('，')}
                </div>
              </div>
              {Object.entries(m4Data.lookthrough_exposure_pct || {})
                .sort((x, y) => y[1] - x[1]) // 數字代號的鍵在 JS 物件裡會被排到前面，這裡依曝險重新排序
                .map(([sym, pct]) => (
                  <div key={sym} className="space-y-1">
                    <div className="flex justify-between text-xs font-mono">
                      <span className="text-slate-200 font-bold">
                        {sym}{' '}
                        {pct >= 30 && !sym.endsWith('其他成分股') && (
                          <span className="text-rose-400 ml-1">⚠️ 單一實體過度集中 (&gt;30%)</span>
                        )}
                      </span>
                      <span
                        className={
                          pct >= 30 && !sym.endsWith('其他成分股')
                            ? 'text-rose-400 font-bold'
                            : 'text-sky-300'
                        }
                      >
                        {pct}%
                      </span>
                    </div>
                    <div className="w-full h-3 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                      <div
                        className={`h-full rounded-full ${
                          pct >= 30 && !sym.endsWith('其他成分股') ? 'bg-rose-500' : 'bg-sky-500'
                        }`}
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}
        {m4Data && (
          <window.TA.AiExplain
            module="mod4"
            provenance={[
              JSON.stringify(m4Holdings) === JSON.stringify(window.TA.DEFAULT_HOLDINGS)
                ? {
                    text: '持股目前是範例（2330／0050／NVDA），不是你的真實部位，可從看盤頁「我的持股」帶入',
                    sample: true,
                  }
                : { text: '持股來自你輸入／匯入的部位' },
              { text: '即時價、匯率、ETF 成分股、Beta、歷史回落為真實資料' },
            ]}
            data={m4Data}
          />
        )}
      </div>
    );
  }

  window.TA = Object.assign(window.TA || {}, { Mod4Panel });
})();
