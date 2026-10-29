// 策略回測頁：表單＋結果分頁。小元件在 backtest_parts.jsx，驗證類在 backtest_verify.jsx
(() => {
  const MODES = [
    ['backtest', '📊 單檔回測'],
    ['signals', '📡 今日訊號'],
    ['portfolio', '🧩 策略組合'],
    ['custom', '🧱 自訂策略'],
    ['pine', '📤 匯出 Pine v5'],
  ];
  const TABS = [
    ['perf', '績效總覽'],
    ['trades', '交易明細'],
    ['verify', '環境與前後段'],
    ['optimize', '參數最佳化'],
    ['mc', '蒙地卡羅'],
    ['replay', '▶ K 線回放'],
  ];

  // 找標的 → 技術分析 → 策略回測：我的持股快速帶入＋技術分析連動資訊卡
  function BacktestLinkBar({ ctx, m3Form, setM3Form, onPickSymbol }) {
    const { holdings } = window.TA.usePortfolio();
    const { baseCode, normSym, fmt, currencyOf } = window.TA;
    const m1Data = ctx.m1Data;
    const curCode = baseCode(normSym(m3Form.target_asset || ''));
    const grouped = [];
    for (const item of holdings) {
      const k = baseCode(normSym(item.symbol));
      const ex = grouped.find((g) => g.code === k);
      if (ex) {
        const total = ex.shares + Number(item.shares || 0);
        ex.cost =
          total > 0
            ? (ex.cost * ex.shares + Number(item.cost || 0) * Number(item.shares || 0)) / total
            : ex.cost;
        ex.shares = total;
      } else {
        grouped.push({
          code: k,
          symbol: item.symbol,
          shares: Number(item.shares || 0),
          cost: Number(item.cost || 0),
        });
      }
    }
    const h = grouped.find((x) => x.code === curCode);
    const snap =
      m1Data?.snapshot?.symbol && baseCode(m1Data.snapshot.symbol) === curCode
        ? m1Data.snapshot
        : null;
    const dec = snap ? m1Data?.llm_result?.decision_payload || {} : {};
    const refPrice = snap?.latest_close || h?.cost || 0;
    const slPrice = dec.stop_loss_price ?? snap?.recent_low_20d;
    const slPct =
      snap?.latest_close > 0 && slPrice > 0 && slPrice < snap.latest_close
        ? Math.max(
            1,
            Math.min(
              25,
              Math.round(((snap.latest_close - slPrice) / snap.latest_close) * 1000) / 10,
            ),
          )
        : null;
    const holdVal = h && refPrice > 0 ? Math.max(100, Math.round(h.shares * refPrice)) : null;
    const ccy = snap?.currency || currencyOf(normSym(m3Form.target_asset || ''));

    return (
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <b className="text-amber-200">我的持股 × 技術分析連動</b>
          {grouped.length > 0 ? (
            <>
              {grouped.map((x) => (
                <button
                  type="button"
                  key={x.code}
                  onClick={() => onPickSymbol(x.symbol)}
                  className={`px-2 py-0.5 rounded-md mono border cursor-pointer ${
                    x.code === curCode
                      ? 'bg-amber-500/30 border-amber-400 text-white'
                      : 'border-slate-700 text-slate-300 hover:border-slate-500'
                  }`}
                  title="點選直接帶入回測這檔持股"
                >
                  {x.symbol}
                </button>
              ))}
              <span className="text-slate-500">點持股代號直接帶入並回測</span>
            </>
          ) : (
            <span className="text-slate-400">尚無持股（可在看盤頁「我的持股」新增）</span>
          )}
          <button
            type="button"
            onClick={() => window.TA.analyzeSymbol?.(m3Form.target_asset)}
            className="ml-auto px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700 text-sky-200 hover:bg-slate-700 cursor-pointer"
          >
            ← 去技術分析看 {m3Form.target_asset}
          </button>
        </div>

        {(snap || h) && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-1 border-t border-amber-500/20 text-slate-200">
            {snap && (
              <span>
                📊 <b>技術分析已帶入</b>：{snap.symbol} {snap.name || ''}｜收盤{' '}
                <b className="mono text-white">{snap.latest_close}</b> {ccy}｜趨勢評分{' '}
                <b className="mono text-sky-300">
                  {snap.trend_score?.total ?? snap.trend_score ?? '--'}
                </b>
                （建議{' '}
                <b
                  className={
                    dec.action === 'BUY'
                      ? 'text-emerald-300'
                      : dec.action === 'SELL'
                        ? 'text-rose-300'
                        : 'text-amber-300'
                  }
                >
                  {dec.action || 'HOLD'}
                </b>
                ）
                {snap.recent_low_20d != null &&
                  `｜支撐 ${snap.recent_low_20d} / 壓力 ${snap.recent_high_20d}`}
                {slPct != null && `｜建議停損 ${slPrice}（-${slPct}%）`}
              </span>
            )}
            {h && (
              <span>
                💼 <b>我的持股</b>：
                {Number.isInteger(h.shares) ? fmt(h.shares, 0) : fmt(h.shares, 4)} 股 @ 成本{' '}
                {fmt(h.cost)}（部位價值約{' '}
                <b className="mono text-amber-200">{holdVal?.toLocaleString()}</b> {ccy}）
              </span>
            )}
            <span className="flex flex-wrap items-center gap-1.5 ml-auto">
              {slPct != null && m3Form.stop_loss_pct !== slPct && (
                <button
                  type="button"
                  onClick={() => {
                    setM3Form({ ...m3Form, stop_loss_pct: slPct });
                    window.TA.toast?.(`已套用技術分析停損幅度 ${slPct}%，按「執行回測」生效`);
                  }}
                  className="px-2.5 py-1 rounded-lg bg-rose-500/20 border border-rose-500/40 text-rose-200 hover:bg-rose-500/30 cursor-pointer"
                >
                  套用技術分析停損（{slPct}%）
                </button>
              )}
              {holdVal != null && m3Form.initial_capital !== holdVal && (
                <button
                  type="button"
                  onClick={() => {
                    setM3Form({ ...m3Form, initial_capital: holdVal });
                    window.TA.toast?.(
                      `已帶入持股部位金額 ${holdVal.toLocaleString()} ${ccy} 為回測本金`,
                    );
                  }}
                  className="px-2.5 py-1 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/30 cursor-pointer"
                >
                  套用持股金額（{holdVal.toLocaleString()} {ccy}）
                </button>
              )}
            </span>
          </div>
        )}
      </div>
    );
  }

  // 根據回測歷史統計＋最新收盤價，產出當下訊號與下一階段推演（預設預測資訊供使用者判讀）
  function BacktestForecastCard({ m3Data, m1Data }) {
    const { holdings } = window.TA.usePortfolio();
    const { baseCode, normSym, fmt, colorOf } = window.TA;
    const r = m3Data?.backtest_result;
    if (!r) return null;
    const curCode = baseCode(normSym(m3Data.symbol || ''));
    const snap =
      m1Data?.snapshot?.symbol && baseCode(m1Data.snapshot.symbol) === curCode
        ? m1Data.snapshot
        : null;
    const op = r.open_position;
    const lastEq = (r.daily_equity || [])[(r.daily_equity || []).length - 1];
    const lastTrade = (r.trades || [])[(r.trades || []).length - 1];
    // 基準價一律用最新收盤（策略空手時不要拿最後一筆交易的出場價，那可能是好幾個月前）
    const lastBar = (m3Data.chart_bars || [])[(m3Data.chart_bars || []).length - 1];
    const refPrice = op?.last_close || lastBar?.[4] || snap?.latest_close || lastTrade?.exit_price || 0;
    const ccy = m3Data.currency || snap?.currency || '';
    const avgWinPct = Number(r.avg_win_pct || 0);
    const avgLossPct = Math.abs(Number(r.avg_loss_pct || 0));
    const cfgStopPct = Number(m3Data.risk_settings?.stop_loss_pct || 0);
    const cfgTrailPct = Number(m3Data.risk_settings?.trailing_pct || 0);
    const effectiveStopPct = cfgStopPct > 0 ? cfgStopPct : avgLossPct > 0 ? avgLossPct : 5;
    const effectiveWinPct = avgWinPct > 0 ? avgWinPct : effectiveStopPct * 1.5;
    const projTarget =
      refPrice > 0 ? Number((refPrice * (1 + effectiveWinPct / 100)).toFixed(2)) : null;
    const projStop =
      refPrice > 0 ? Number((refPrice * (1 - effectiveStopPct / 100)).toFixed(2)) : null;
    const projTrail =
      refPrice > 0 && cfgTrailPct > 0
        ? Number((refPrice * (1 - cfgTrailPct / 100)).toFixed(2))
        : null;

    // 彙整使用者在這檔的持股
    const matchedHoldings = holdings.filter((x) => baseCode(normSym(x.symbol)) === curCode);
    const totalShares = matchedHoldings.reduce((s, x) => s + Number(x.shares || 0), 0);
    const avgCost =
      totalShares > 0
        ? matchedHoldings.reduce((s, x) => s + Number(x.cost || 0) * Number(x.shares || 0), 0) /
          totalShares
        : 0;

    return (
      <div className="rounded-xl border border-sky-500/35 bg-sky-500/5 p-4 text-xs space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-bold text-sky-200 text-sm">
            🔮 根據回測資料的當下狀態與後續推演（預設預測參考）
            <window.TA.Tip text="依本次回測到最新一根日 K 的策略部位狀態、歷史平均獲利／虧損幅度與風控設定，推算下一階段的參考目標價與停損保護價。統計推演僅供紀律規劃，不保證未來走勢。" />
          </div>
          <span className="text-[11px] text-slate-400 font-mono">
            基準收盤價：{refPrice || '--'} {ccy}
            {lastEq?.date ? `（${lastEq.date}）` : ''}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-3 space-y-1">
            <div className="text-slate-400">當下策略部位狀態</div>
            {op ? (
              <>
                <div className="text-sm font-bold text-rose-300">📈 策略目前持有中（續抱訊號）</div>
                <div className="text-slate-300 font-mono">
                  {op.entry_date} @ {op.entry_price} 進場（{op.shares?.toLocaleString()} 股）
                </div>
                <div className={colorOf(op.unrealized_pnl)}>
                  目前帳面：{op.unrealized_pnl >= 0 ? '+' : ''}
                  {op.unrealized_pnl?.toLocaleString()} {ccy}（{op.unrealized_pct}%）
                </div>
              </>
            ) : (
              <>
                <div className="text-sm font-bold text-amber-300">⏸️ 策略目前空手（等待買訊）</div>
                <div className="text-slate-300">
                  {lastTrade
                    ? `最近平倉：${lastTrade.exit_date} @ ${lastTrade.exit_price}（${lastTrade.exit_reason || '訊號'}，${lastTrade.return_pct}%）`
                    : '回測期間尚無已平倉交易'}
                </div>
                <div className="text-slate-400">
                  進場條件：{m3Data.strategy?.rule || '依所選策略訊號'}
                </div>
              </>
            )}
          </div>

          <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-3 space-y-1 font-mono">
            <div className="text-slate-400 font-sans">
              回測統計推演價位（以現價 {refPrice || '--'} 計）
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400 font-sans">
                預期獲利目標（+{effectiveWinPct.toFixed(1)}%）
              </span>
              <b className="text-emerald-400">{projTarget ?? '--'}</b>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400 font-sans">
                風控停損價（-{effectiveStopPct.toFixed(1)}%）
              </span>
              <b className="text-rose-400">{projStop ?? '--'}</b>
            </div>
            {projTrail != null && (
              <div className="flex justify-between">
                <span className="text-slate-400 font-sans">移動停利線（-{cfgTrailPct}%）</span>
                <b className="text-amber-300">{projTrail}</b>
              </div>
            )}
            <div className="text-[11px] text-slate-400 font-sans pt-0.5">
              歷史勝率 <b className="text-white">{r.win_rate_pct}%</b>｜單筆期望值{' '}
              <b className={colorOf(r.expectancy_pct)}>{r.expectancy_pct}%</b>｜賺賠比{' '}
              <b className="text-sky-300">{r.payoff_ratio ?? '--'}</b>
            </div>
          </div>

          <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-3 space-y-1">
            <div className="text-slate-400">對照你的持股部位預估</div>
            {totalShares > 0 && refPrice > 0 ? (
              <div className="space-y-1 font-mono">
                <div className="text-slate-200">
                  持有 {Number.isInteger(totalShares) ? fmt(totalShares, 0) : fmt(totalShares, 4)}{' '}
                  股 @ 成本 {fmt(avgCost)}
                </div>
                {projTarget != null && (
                  <div className="flex justify-between">
                    <span className="text-slate-400 font-sans">若達回測目標價 {projTarget}：</span>
                    <span className={colorOf((projTarget - avgCost) * totalShares)}>
                      {fmt((projTarget - avgCost) * totalShares, 0)} {ccy}
                    </span>
                  </div>
                )}
                {projStop != null && (
                  <div className="flex justify-between">
                    <span className="text-slate-400 font-sans">若跌到停損價 {projStop}：</span>
                    <span className={colorOf((projStop - avgCost) * totalShares)}>
                      {fmt((projStop - avgCost) * totalShares, 0)} {ccy}
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-slate-400">
                目前未持有 {curCode}。若以本金{' '}
                {(m3Data.strategy_params?.initial_capital || 0).toLocaleString()} {ccy}{' '}
                進場，達目標價約{' '}
                <span className="text-emerald-400 font-mono">+{effectiveWinPct.toFixed(1)}%</span>
                、觸停損約{' '}
                <span className="text-rose-400 font-mono">-{effectiveStopPct.toFixed(1)}%</span>。
              </div>
            )}
            <div className="pt-1 flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => {
                  window.TA._pendingWatch = {
                    listTab: totalShares > 0 ? 'hold' : 'watch',
                    rightTab: 'quote',
                    select: curCode,
                  };
                  window.TA.goTab?.('watch');
                }}
                className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 cursor-pointer"
              >
                去模擬下單 →
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

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
      SignalsPanel,
      PineExportPanel,
      ReplayPanel,
      PortfolioPanel,
      CustomPanel,
      customStrategies,
      printReport,
    } = window.TA.BT;
    const [catalog, setCatalog] = React.useState(window.TA._btCatalog || null);
    const [tab, setTab] = React.useState('perf');
    const [view, setView] = React.useState('backtest');
    // 今日訊號 →「回測這檔」：換標的、切回單檔回測，使用者確認後按執行
    const backtestSymbol = (sym) => {
      setM3Form({ ...m3Form, target_asset: sym });
      setView('backtest');
      document
        .querySelector('[data-tour="mod3-root"]')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      window.TA.toast?.(`已帶入 ${sym}，按「執行回測」開始`);
    };
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
    // 內建策略＋使用者存的自訂策略（自訂的帶著條件定義 custom，送到後端時一起帶過去）
    const allStrategies = [...cat.strategies, ...customStrategies()];
    const strat = allStrategies.find((s) => s.key === m3Form.strategy) || cat.strategies[0];
    const params = {
      ...Object.fromEntries(strat.params.map((p) => [p.key, p.default])),
      ...(m3Form.params || {}),
    };
    const set = (patch) => setM3Form({ ...m3Form, ...patch });
    const pickStrategy = (key) => {
      const s = allStrategies.find((x) => x.key === key);
      set({
        strategy: key,
        custom: s.custom,
        params: Object.fromEntries(s.params.map((p) => [p.key, p.default])),
      });
    };
    // 自訂策略頁「拿去回測」
    const applyCustom = (c) => {
      set({
        strategy: `custom:${c.id}`,
        custom: c.definition,
        params: Object.fromEntries(c.params.map((p) => [p.key, p.default])),
      });
      setView('backtest');
      document
        .querySelector('[data-tour="mod3-root"]')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      window.TA.toast?.(`已選用自訂策略「${c.name}」，按「執行回測」開始`);
    };
    // 熱力圖點一格：把那組參數帶回表單（策略改回這次回測用的），捲回上方讓使用者確認後再執行
    const pickParams = (p) => {
      const {
        strategy: key,
        initial_capital,
        commission_discount,
        period_years,
        ...used
      } = m3Data.strategy_params || {};
      set({ strategy: key, params: { ...used, ...p } });
      document
        .querySelector('[data-tour="mod3-root"]')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      window.TA.toast?.(
        `已帶入參數 ${Object.entries(p)
          .map(([k, v]) => `${k}=${v}`)
          .join('、')}，按「執行回測」套用`,
      );
    };
    const ccy = window.TA.currencyOf(window.TA.normSym(m3Form.target_asset || ''));
    const mode = m3Form.sizing_mode || 'percent';
    const r = m3Data?.backtest_result;

    return (
      <div className="space-y-5" data-tour="mod3-root">
        <HelpCard />
        <BacktestLinkBar
          ctx={ctx}
          m3Form={m3Form}
          setM3Form={setM3Form}
          onPickSymbol={(sym) => {
            setView('backtest');
            ctx.backtestThis(sym);
          }}
        />
        <div className="flex flex-wrap gap-2">
          {MODES.map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setView(k)}
              className={`px-4 py-2 rounded-xl text-sm font-semibold cursor-pointer border ${
                view === k
                  ? 'bg-sky-600/25 border-sky-500/60 text-sky-100'
                  : 'border-slate-700 text-slate-400 hover:text-slate-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4">
          <div>
            <h2 className="text-base font-semibold text-white">回測參數</h2>
            <span className="block mt-1 text-xs text-slate-500">
              資料狀態：回測用真實還權日 K（Yahoo/FinMind）；查無行情時會直接報錯，不會用假資料
            </span>
            <p className="text-xs text-slate-400">
              訊號於收盤確認、隔日開盤價成交，已扣除手續費與證交稅
            </p>
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
                {allStrategies.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}（{s.kind}
                    {s.tw_only ? '・僅台股' : ''}）
                  </option>
                ))}
              </select>
            </div>
            <NumField
              id="m3-cap"
              label={`初始本金（${ccy}）`}
              tip="本金幣別跟著標的：台股新台幣、美股美元、港股港幣、日股日圓、英股便士（GBp）…。例如回測 NVDA 填 1,000,000 代表 100 萬美元；想比照台幣 100 萬，請自行換算。"
              step="1000"
              min="1"
              value={m3Form.initial_capital}
              onChange={(v) => set({ initial_capital: v })}
            />
            <NumField
              id="m3-disc"
              label="台股手續費折數"
              tip="券商手續費 0.1425% 乘上折數，例如 0.6＝六折；這個折數跟看盤頁模擬下單共用，改一邊另一邊也會跟著變。台股賣出另扣證交稅：股票 0.3%、ETF 0.1%、債券 ETF（代號 B 結尾）停徵到 2026 年底，回測會依標的自動套用。美股賣出另扣 SEC 規費與 FINRA TAF。"
              step="0.1"
              min="0.1"
              max="1.0"
              value={m3Form.commission_discount}
              onChange={(v) => {
                set({ commission_discount: v });
                window.TA.setFeeDiscount(v); // 與模擬下單共用；輸入到一半的值不會存
              }}
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
                  onChange={(e) =>
                    set({
                      sizing_mode: e.target.value,
                      sizing_value: SIZING_DEFAULT[e.target.value],
                    })
                  }
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
                label={
                  mode === 'fixed'
                    ? `每筆金額（${ccy}）`
                    : mode === 'atr_risk'
                      ? '每筆風險 %'
                      : '每筆資金 %'
                }
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

          <div className={`flex justify-end ${view === 'backtest' ? '' : 'hidden'}`}>
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

        {view === 'signals' && <SignalsPanel m3Form={m3Form} onBacktest={backtestSymbol} />}
        {view === 'pine' && <PineExportPanel m3Form={m3Form} m3Data={m3Data} />}
        {view === 'portfolio' && <PortfolioPanel m3Form={m3Form} />}
        {view === 'custom' && <CustomPanel onUse={applyCustom} />}

        {view === 'backtest' &&
          (m3Data?.strategy_warnings || []).map((w) => (
            <div
              key={w}
              className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs text-amber-100"
            >
              ⚠️ {w}
            </div>
          ))}

        {view === 'backtest' && (m3Data?.data_notes || []).length > 0 && (
          <div className="text-[11px] text-slate-500 px-1">
            籌碼／營收資料（FinMind，存在本機 data/finmind_cache，之後只補抓最新幾天）：
            {m3Data.data_notes.join('；')}
          </div>
        )}
        {view === 'backtest' && r && (
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
                {m3Data.symbol}｜{m3Data.strategy?.label || '雙均線交叉'}（
                {m3Data.strategy?.params_text}）｜{m3Data.period}
              </span>
              <button
                type="button"
                onClick={() => printReport(m3Data)}
                className="px-3 py-1.5 rounded-lg text-xs border border-slate-700 text-slate-300 hover:text-white cursor-pointer"
              >
                🖨️ PDF 報告
                <window.TA.Tip text="開啟列印視窗，目的地選「另存為 PDF」即可存檔。內容：績效摘要、每日淨值、環境拆分、前後段驗證、交易明細；如果已在「參數最佳化」「蒙地卡羅」分頁按過計算，也會一起放進去（重新回測後要再算一次）。報告一律白底，方便列印。" />
              </button>
            </div>

            {tab === 'perf' && (
              <>
                <BacktestForecastCard m3Data={m3Data} m1Data={ctx.m1Data} />
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
                    <div className="font-bold font-mono text-emerald-400 mt-1">
                      +{r.avg_win_pct}%
                    </div>
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
                    <div className="font-bold font-mono text-sky-300 mt-1">
                      {r.payoff_ratio ?? '--'}
                    </div>
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
                  <div className="text-xs text-slate-500">
                    大盤資料或期間不足，沒有驗證結果；把回測期間拉長到 3 年以上再試。
                  </div>
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
            {tab === 'replay' && (
              <ReplayPanel
                key={`${m3Data.symbol}|${m3Data.period}|${m3Data.strategy?.key}|${m3Data.strategy?.params_text}`}
                m3Data={m3Data}
              />
            )}
          </div>
        )}
        {view === 'backtest' && r && (
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
