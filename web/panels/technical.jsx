// 技術分析頁。籌碼面板與「你持有這檔」卡片在 technical_parts.jsx
(() => {
  const { useState, useEffect } = React;
  const { ChipPanel, MyPositionCard } = window.TA;
  // 指標統一顯示 2 位小數（後端仍保留完整精度做計算）
  const fmt2 = (v) => (v == null || Number.isNaN(Number(v)) ? '--' : Number(v).toFixed(2));
  // 白話判斷目前的均線排列
  const maOrderText = (snap) => {
    const c = snap.latest_close;
    const { MA5: a, MA20: b, MA60: d } = snap.indicators || {};
    if ([c, a, b, d].some((x) => x == null)) return '';
    if (c > a && a > b && b > d) return '→ 多頭排列（短中長期都向上）';
    if (c < a && a < b && b < d) return '→ 空頭排列（短中長期都向下）';
    if (c < b)
      return `→ 股價在 MA20 之下（比月均價低 ${(((b - c) / b) * 100).toFixed(1)}%），短線偏弱`;
    return `→ 股價在 MA20 之上（比月均價高 ${(((c - b) / b) * 100).toFixed(1)}%），短線偏強`;
  };

  // 100 分趨勢評分（參考 Stock-Analysis-Skill 的六維度；嚴進規則由後端強制）
  const SCORE_DIMS = [
    ['trend', '趨勢', 30],
    ['bias', '乖離', 20],
    ['macd', 'MACD', 15],
    ['volume', '量能', 15],
    ['rsi', 'RSI', 10],
    ['support', '支撐', 10],
  ];
  function TrendScoreCard({ score }) {
    if (!score) return null;
    const d = score.details || {};
    const tone = ['STRONG_BUY', 'BUY'].includes(score.signal)
      ? 'text-emerald-400'
      : ['STRONG_SELL', 'SELL'].includes(score.signal)
        ? 'text-rose-400'
        : 'text-amber-300';
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-[11px] text-slate-400">
            趨勢評分
            <window.TA.Tip text="六個面向加總 100 分：均線排列 30、距 MA5 乖離 20、MACD 15、量能 15、RSI 10、均線支撐 10。75 分以上且多頭排列＝強烈買進；60 以上＝買進；45 以上＝持有；30 以上＝觀望；以下＝賣出。RSI ≥ 80 或乖離 > 5% 時一律不給買進。盤中量能未收齊時，量能給中性分。" />
          </span>
          <span className="text-xl font-bold font-mono text-white">{score.total}</span>
          <span className="text-[11px] text-slate-500">/ 100</span>
          <span className={`text-sm font-bold ${tone}`}>{score.signal_label}</span>
          <span className="text-[11px] text-slate-400">
            {d.alignment_label} ・ MACD {d.macd_label} ・ {d.volume_label} ・ 距 MA5 乖離{' '}
            {fmt2(d.bias_ma5_pct)}%
          </span>
        </div>
        <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mt-2">
          {SCORE_DIMS.map(([k, label, max]) => (
            <div key={k} className="text-[11px] text-slate-400">
              <div className="flex justify-between">
                <span>{label}</span>
                <span className="font-mono text-slate-200">
                  {score.breakdown[k]}/{max}
                </span>
              </div>
              <div className="h-1.5 bg-slate-800 rounded mt-1">
                <div
                  className="h-1.5 bg-sky-500 rounded"
                  style={{ width: `${(score.breakdown[k] / max) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
        {score.not_applicable && (
          <div className="mt-2 text-[11px] text-sky-300">ℹ️ {score.not_applicable}</div>
        )}
        {score.hard_rules?.length > 0 && (
          <div className="mt-2 text-[11px] text-amber-300">
            嚴進規則：{score.hard_rules.join('；')}
          </div>
        )}
      </div>
    );
  }

  // 輸入代號時，在輸入框下方即時顯示股票名稱（停止輸入 0.4 秒後查詢）
  function TickerName({ ticker }) {
    const [info, setInfo] = useState(null);
    useEffect(() => {
      const t = (ticker || '').trim();
      if (!t) {
        setInfo(null);
        return undefined;
      }
      let stop = false;
      const id = setTimeout(() => {
        fetch('/api/quotes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbols: [t] }),
        })
          .then((r) => r.json())
          .then((d) => !stop && setInfo(d.quotes?.[0] || null))
          .catch(() => !stop && setInfo(null));
      }, 400);
      return () => {
        stop = true;
        clearTimeout(id);
      };
    }, [ticker]);
    if (!info) return <div className="mt-1 text-xs text-slate-600 h-4">&nbsp;</div>;
    if (info.error || !info.is_live)
      return <div className="mt-1 text-xs text-rose-300">查無此代號</div>;
    return (
      <div className="mt-1 text-xs text-slate-300">
        <span className="font-bold text-white">{info.name}</span>
        <span className="text-slate-500">
          {' '}
          ・{window.TA.marketName(info.symbol || ticker)}・現價 {info.price} {info.currency}
        </span>
      </div>
    );
  }

  const SCEN_STYLE = {
    bull: 'border-emerald-500/40 bg-emerald-500/5 text-emerald-200',
    neutral: 'border-amber-500/40 bg-amber-500/5 text-amber-200',
    bear: 'border-rose-500/40 bg-rose-500/5 text-rose-200',
  };

  function TrendLine({ t }) {
    if (!t) return null;
    return (
      <span>
        <b className="text-slate-200">{t.frame}</b>：{t.text}・RSI {t.RSI14 ?? '--'}・MACD 柱 {t.MACD_HIST ?? '--'}
        {t.macd_turn ? `（${t.macd_turn}）` : ''}
      </span>
    );
  }

  function ScenarioPanel({ data }) {
    if (!data) return null;
    if (data.error) return <div className="text-xs text-amber-300">⚠️ {data.error}</div>;
    const { levels: lv, volume: vol } = data;
    return (
      <div data-tour="mod1-scenarios" className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 space-y-3">
        <div className="text-xs font-semibold text-slate-300">
          多頭／中性／空頭三情境（日線＋週線＋成交量）
          <window.TA.Tip text="用同一組關鍵價位推演三種「如果…就…」的劇本：每種情境都有成立條件與失效條件。價位取自系統算出的支撐壓力，並用 ATR 拉開間距；下面列的是目前支持各情境的訊號，數量多不代表一定發生。" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px] text-slate-400 bg-slate-950 p-3 rounded-lg border border-slate-800">
          <TrendLine t={data.daily} />
          {data.weekly ? <TrendLine t={data.weekly} /> : <span>週線：資料不足 25 週</span>}
          <span className="md:col-span-2">
            <b className="text-slate-200">成交量</b>
            <window.TA.Tip text="上漲日/下跌日量比＝近 20 日上漲那幾天的平均量 ÷ 下跌那幾天的平均量；大於 1.2 代表買盤較積極，小於 0.8 代表賣壓較重。近 5 日／20 日均量比大於 1 代表最近量能放大。" />
            ：{vol.note}・上漲日/下跌日量比 {vol.up_down_volume_ratio ?? '--'}・近 5 日/20 日均量 {vol.avg5_vs_avg20 ?? '--'} 倍・最後一天 {vol.last_vs_avg20 ?? '--'} 倍
          </span>
          <span className="md:col-span-2 font-mono">
            <span className="font-sans">關鍵價位</span>
            <window.TA.Tip text={`${lv.source}。S＝支撐、R＝壓力；ATR14＝${lv.ATR14}（近 14 日平均真實波動）。`} />
            ：S2 {lv.S2}｜S1 {lv.S1}｜現價 <b className="text-amber-300">{data.price}</b>｜R1 {lv.R1}｜R2 {lv.R2}
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {data.scenarios.map((s) => (
            <div key={s.key} className={`rounded-xl border p-3 text-xs space-y-1.5 ${SCEN_STYLE[s.key]}`}>
              <div className="font-bold text-sm">
                {s.name}
                {data.lean === s.key && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">訊號最多</span>}
              </div>
              <div>
                <span className="text-slate-400">成立條件：</span>
                {s.trigger}
              </div>
              <div>
                <span className="text-slate-400">若成立：</span>
                {s.target}
              </div>
              <div>
                <span className="text-slate-400">失效條件：</span>
                {s.invalidation}
              </div>
              <div className="pt-1 border-t border-slate-700/50 text-slate-300">
                <span className="text-slate-400">目前支持的訊號（{s.evidence.length}）：</span>
                {s.evidence.length ? (
                  <ul className="list-disc pl-4">
                    {s.evidence.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                ) : (
                  <span className="text-slate-500">無</span>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="text-[11px] text-slate-400">
          {data.lean_note}。{data.disclaimer}
        </div>
      </div>
    );
  }

  function Mod1Panel({ ctx }) {
    const {
      aiDecisionOn,
      backtestThis,
      countdownSec,
      handleSwitchTab,
      isLivePolling,
      m1Context,
      m1Data,
      m1Loading,
      m1Ticker,
      m1Timeframe,
      prevPriceRef,
      priceFlash,
      runMod1,
      setCountdownSec,
      setIsLivePolling,
      setM1Context,
      setM1Ticker,
      setM1Timeframe,
    } = ctx;
    const { CandlestickChart } = window.TA;
    return (
      <div className="space-y-5">
        <window.TA.RulesReminder />
        <MyPositionCard m1Data={m1Data} onAnalyze={(sym) => window.TA.analyzeSymbol?.(sym)} />
        {m1Context && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs text-amber-100 flex flex-wrap items-center justify-between gap-2">
            <span>
              已從看盤帶入：{m1Context.symbol} {m1Context.name}・現價 {m1Context.price}（
              {m1Context.change_pct}%）・{m1Context.quote_time}
              。下方技術分析用的是日 K 還權資料，與這筆即時價是不同資料源。
            </span>
            <button
              type="button"
              onClick={() => setM1Context(null)}
              className="text-amber-300 hover:text-white cursor-pointer"
            >
              關閉 ✕
            </button>
          </div>
        )}
        {/* 控制面板與即時跳動開關 */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
            <div>
              <h2 className="text-base font-semibold text-white">
                查詢標的
              </h2>
              <p className="text-xs text-slate-400">
                輸入代號查看 K 線、指標與多空情境；盤中可每 5 秒以即時報價更新最後一根 K 棒
              </p>
            </div>

            {/* 盤中動態自動刷新控制列 */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsLivePolling(!isLivePolling);
                  setCountdownSec(5);
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-mono font-semibold border transition cursor-pointer flex items-center gap-2 ${
                  isLivePolling
                    ? 'bg-emerald-950/60 border-emerald-500/50 text-emerald-300'
                    : 'bg-slate-950 border-slate-800 text-slate-400'
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    isLivePolling ? 'bg-emerald-400 animate-ping' : 'bg-slate-600'
                  }`}
                />
                {aiDecisionOn
                  ? 'AI 決策模式：不自動刷新（按查詢才會呼叫 AI）'
                  : isLivePolling
                    ? `每 5 秒更新真實報價 (${countdownSec}s)`
                    : '已暫停自動刷新'}
              </button>

              <button
                type="button"
                onClick={() => {
                  runMod1({ simulateTick: false });
                  setCountdownSec(5);
                }}
                className="px-3 py-1.5 rounded-xl text-xs font-mono bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 transition cursor-pointer"
              >
                ↻ 立即抓取最新報價
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end" data-tour="mod1-query">
            <div className="md:col-span-4">
              <label htmlFor="m1-ticker" className="block text-xs text-slate-400 mb-1 font-medium">
                股票代號（台股 2330、美股 NVDA、港股 0700.HK、日股 7203.T…）
              </label>
              <input
                id="m1-ticker"
                type="text"
                value={m1Ticker}
                onChange={(e) => setM1Ticker(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    prevPriceRef.current = null;
                    runMod1({ simulateTick: false });
                  }
                }}
                placeholder="例如: 2330.TW 或 NVDA"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm font-mono text-white focus:border-sky-400 focus:outline-none"
              />
              <TickerName ticker={m1Ticker} />
            </div>
            <div className="md:col-span-6 text-[11px] text-slate-400 leading-relaxed">
              分析方式：
              <b className="text-slate-200">
                {m1Data?.llm_result?.execution_mode?.startsWith('LIVE')
                  ? 'AI 模型'
                  : '內建規則'}
              </b>
              。想改用雲端 AI 或本地模型，到
              <button
                type="button"
                onClick={() => handleSwitchTab('settings')}
                className="mx-1 text-sky-300 underline cursor-pointer"
              >
                設定
              </button>
              新增連線（全系統共用）。
            </div>
            <div className="md:col-span-2">
              <button
                type="button"
                onClick={() => {
                  prevPriceRef.current = null;
                  runMod1({ simulateTick: false });
                }}
                disabled={m1Loading}
                className="w-full py-2 px-4 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-semibold text-sm shadow-lg shadow-sky-600/25 transition cursor-pointer"
              >
                {m1Loading
                  ? aiDecisionOn
                    ? 'AI 推論中（可能數十秒）…'
                    : '分析中...'
                  : '查詢標的'}
              </button>
            </div>
          </div>
        </div>

        {/* 技術分析 分析結果 */}
        {m1Data?.snapshot && (
          <div className="space-y-4">
            {/* 頂部核心指標列 (含價格跳動紅綠閃爍動畫) */}
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5">
                <div className="text-[11px] text-slate-400">標的與市場</div>
                <div className="text-base font-bold font-mono text-white mt-1">
                  {m1Data.snapshot.symbol}
                </div>
                <div className="text-[11px] text-sky-400 font-mono">
                  {m1Data.snapshot.market} ({m1Data.snapshot.currency})
                </div>
              </div>
              <div
                className={`rounded-xl p-3.5 border transition-all duration-300 ${
                  priceFlash === 'UP'
                    ? 'bg-rose-950/60 border-rose-500 ring-2 ring-rose-500/40'
                    : priceFlash === 'DOWN'
                      ? 'bg-emerald-950/60 border-emerald-500 ring-2 ring-emerald-500/40'
                      : 'bg-slate-900 border-slate-800'
                }`}
              >
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span>最新成交價</span>
                  <span className="font-mono text-[10px]">{m1Data.updated_at || ''}</span>
                </div>
                <div className="text-xl font-bold font-mono text-amber-300 mt-1 flex items-center gap-1">
                  <span>{m1Data.snapshot.latest_close}</span>
                  {priceFlash === 'UP' && <span className="text-xs text-rose-400">▲</span>}
                  {priceFlash === 'DOWN' && <span className="text-xs text-emerald-400">▼</span>}
                </div>
                <div className="text-[11px] text-slate-400 font-mono">
                  5日漲跌: {m1Data.snapshot.ret_5d_pct}%
                </div>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5">
                <div className="text-[11px] text-slate-400">
                  {m1Data.llm_result?.execution_mode?.startsWith('LIVE')
                    ? 'AI 建議方向'
                    : '系統建議（規則引擎）'}
                  <window.TA.Tip text="BUY＝偏向買進、HOLD＝觀望、SELL＝賣出或減碼。規則引擎＝依固定條件（均線排列、RSI、支撐壓力）判斷，不使用 AI。下方 ROD／IOC 是委託方式：ROD 當日有效、IOC 立即成交否則取消。" />
                </div>
                <div
                  className={`text-xl font-bold font-mono mt-1 ${
                    m1Data.llm_result?.decision_payload?.action === 'BUY'
                      ? 'text-emerald-400'
                      : m1Data.llm_result?.decision_payload?.action === 'SELL'
                        ? 'text-rose-400'
                        : 'text-amber-300'
                  }`}
                >
                  {m1Data.llm_result?.decision_payload?.action}
                </div>
                <div className="text-[11px] text-slate-400 font-mono">
                  {(() => {
                    const p = m1Data.llm_result?.decision_payload || {};
                    const [a, b, c] =
                      p.action === 'SELL' ? ['賣出', '失效', '下檔'] : ['進場', '停損', '目標'];
                    return `${p.order_type} ・ ${a} ${p.entry_price} ・ ${b} ${p.stop_loss_price} ・ ${c} ${p.take_profit_target}`;
                  })()}
                </div>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5">
                <div className="text-[11px] text-slate-400">
                  RSI (14) 強弱
                  <window.TA.Tip text="RSI：0–100 的強弱指標。高於 70 常視為過熱、低於 30 常視為過冷，不代表一定會反轉。MACD 柱體由負轉正代表動能轉強。" />
                </div>
                <div className="text-xl font-bold font-mono text-sky-300 mt-1">
                  {fmt2(m1Data.snapshot.indicators.RSI14)}
                </div>
                <div className="text-[11px] text-slate-400 font-mono">
                  MACD柱: {fmt2(m1Data.snapshot.indicators.MACD_hist)}
                </div>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5">
                <div className="text-[11px] text-slate-400">
                  ATR (14) 波動值
                  <window.TA.Tip text="ATR：近 14 天平均每天的真實波動幅度（價格單位）。例如 ATR 38 代表這檔平常一天大約會上下動 38 元，常用來設停損距離。量能比＝今日成交量 ÷ 近 20 日均量。" />
                </div>
                <div className="text-xl font-bold font-mono text-purple-300 mt-1">
                  {fmt2(m1Data.snapshot.indicators.ATR14)}
                </div>
                <div className="text-[11px] text-slate-400 font-mono">
                  量能比: {m1Data.snapshot.volume_ratio_20d}x
                </div>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5">
                <div className="text-[11px] text-slate-400">
                  AI 數字核對（防幻覺稽核）
                  <window.TA.Tip text="「幻覺」是指 AI 編造出資料裡沒有的數字。系統會逐一比對決策裡的價位是否來自真實行情與程式算出的支撐壓力、停損是否在合理位置，不通過就改用內建規則。" />
                </div>
                <div className="text-sm font-bold font-mono text-emerald-400 mt-1.5">
                  {m1Data.llm_result?.anti_hallucination_audit?.passed
                    ? '✅ 數字全部核對無誤'
                    : '❌ 攔截違規'}
                </div>
                <div className="text-[10px] text-slate-400 font-mono truncate">
                  來源：{window.TA.sourceLabel(m1Data.snapshot.data_source)}
                </div>
              </div>
            </div>

            <TrendScoreCard score={m1Data.snapshot.trend_score} />

            <ChipPanel symbol={m1Data.snapshot.symbol} />

            {/* 日線 / 週線切換 */}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-slate-400">K 線週期</span>
              {[
                ['D', '日線'],
                ['W', '週線（日線聚合，還權）'],
              ].map(([tf, label]) => (
                <button
                  type="button"
                  key={tf}
                  onClick={() => {
                    setM1Timeframe(tf);
                    runMod1({ overrideTimeframe: tf, simulateTick: false });
                  }}
                  className={`px-3 py-1.5 rounded-lg border cursor-pointer ${
                    m1Timeframe === tf
                      ? 'bg-sky-500/20 border-sky-400 text-white'
                      : 'bg-slate-950 border-slate-800 text-slate-400'
                  }`}
                >
                  {label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => handleSwitchTab('guide')}
                className="px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-950 text-sky-300 hover:text-white cursor-pointer"
                title="K 棒顏色、均線、支撐壓力、成交量副圖、還權的白話說明"
              >
                怎麼看這張圖
              </button>
              <button
                type="button"
                onClick={() => backtestThis(m1Data.snapshot.symbol)}
                className="px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-950 text-amber-300 hover:text-white cursor-pointer"
                title="用真實歷史資料回測這一檔"
                data-tour="mod1-backtest"
              >
                回測這檔
              </button>
              {m1Data.weekly_snapshot && (
                <span className="font-mono text-slate-300">
                  週 MA5 {fmt2(m1Data.weekly_snapshot.MA5)} ・ MA20{' '}
                  {fmt2(m1Data.weekly_snapshot.MA20)} ・ MA60{' '}
                  {m1Data.weekly_snapshot.MA60 == null
                    ? '資料不足'
                    : fmt2(m1Data.weekly_snapshot.MA60)}{' '}
                  ・ 週 RSI {fmt2(m1Data.weekly_snapshot.RSI14)} ・{' '}
                  {m1Data.weekly_snapshot.trend_note}
                </span>
              )}
            </div>

            {/* 互動式 K 線 + 十字準星 + 成交量副圖 */}
            <CandlestickChart
              bars={m1Data.recent_bars}
              supports={m1Data.snapshot.support_levels}
              resistances={m1Data.snapshot.resistance_levels}
              key={`${m1Data.snapshot.symbol}-${m1Timeframe}`}
              barCount={m1Timeframe === 'W' ? 52 : 60}
              unit={m1Timeframe === 'W' ? '週' : '日'}
            />

            {/* 支撐壓力檔位與 AI 決策依據 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 space-y-3">
                <div className="text-xs font-semibold text-slate-300">
                  關鍵支撐與壓力價位（已隨最新 Tick 對齊{' '}
                  {m1Data.snapshot.market === 'TW' ? '台股六級跳動單位' : '0.01 精度'}）
                </div>
                <div className="grid grid-cols-3 gap-2 text-center font-mono">
                  <div className="bg-emerald-950/30 border border-emerald-700/40 rounded-lg p-2.5">
                    <div className="text-[11px] text-emerald-400">第一/二支撐位</div>
                    <div className="text-sm font-bold text-emerald-300 mt-1">
                      {m1Data.snapshot.support_levels.join(' / ')}
                    </div>
                  </div>
                  <div className="bg-amber-950/30 border border-amber-700/40 rounded-lg p-2.5">
                    <div className="text-[11px] text-amber-400">目前成交價</div>
                    <div className="text-sm font-bold text-amber-300 mt-1">
                      {m1Data.snapshot.latest_close}
                    </div>
                  </div>
                  <div className="bg-rose-950/30 border border-rose-700/40 rounded-lg p-2.5">
                    <div className="text-[11px] text-rose-400">第一/二壓力位</div>
                    <div className="text-sm font-bold text-rose-300 mt-1">
                      {m1Data.snapshot.resistance_levels.join(' / ')}
                    </div>
                  </div>
                </div>
                <div className="text-xs text-slate-400 bg-slate-950 p-3 rounded-lg border border-slate-800 font-mono">
                  <span className="font-sans">均線排列</span>
                  <window.TA.Tip text="MA＝移動平均線：最近 N 個交易日收盤價的平均。MA5≈一週（短線）、MA20≈一個月（中期）、MA60≈一季（較長期）。股價 > MA5 > MA20 > MA60 叫多頭排列（偏強），順序相反叫空頭排列（偏弱）。" />
                  ：MA5={fmt2(m1Data.snapshot.indicators.MA5)} ｜ MA20=
                  {fmt2(m1Data.snapshot.indicators.MA20)} ｜ MA60=
                  {fmt2(m1Data.snapshot.indicators.MA60)} ｜ MA200=
                  {fmt2(m1Data.snapshot.indicators.MA200)}
                  <span className="font-sans ml-2 text-slate-300">
                    {maOrderText(m1Data.snapshot)}
                  </span>
                </div>
              </div>

              <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 space-y-2.5">
                <div className="text-xs font-semibold text-slate-300">
                  {m1Data.llm_result?.execution_mode?.startsWith('LIVE')
                    ? 'AI 決策邏輯'
                    : '系統判斷依據（規則引擎）'}
                  與強制失效出場條件
                </div>
                <ol className="list-decimal pl-5 space-y-1 text-xs text-slate-300 leading-relaxed bg-slate-950 p-3 rounded-lg border border-slate-800">
                  {(m1Data.llm_result?.decision_payload?.step_by_step_rationale || []).map((r) => (
                    <li key={r}>{r.replace(/^\d+\.\s*/, '')}</li>
                  ))}
                </ol>
                <div className="text-[11px] text-slate-500">
                  {(m1Data?.llm_result?.notice?.includes('未通過') ||
                    m1Data?.llm_result?.notice?.includes('失敗')) && (
                    <span className="block text-amber-300">⚠️ {m1Data.llm_result.notice}</span>
                  )}
                  決策來源：
                  {m1Data.llm_result?.execution_mode === 'DETERMINISTIC_RULE_ENGINE'
                    ? '內建規則（未使用 AI）'
                    : m1Data.llm_result?.execution_mode}
                  。價位全部由程式計算，並經過數字核對（避免 AI 編造價格）。
                </div>
                <div className="bg-rose-950/30 border border-rose-700/40 rounded-lg p-3 text-xs text-rose-200">
                  <span className="font-bold text-rose-400">邏輯失效出場條件：</span>
                  {m1Data.llm_result?.decision_payload?.invalidation_criteria}
                </div>
              </div>
            </div>

            <ScenarioPanel data={m1Data.scenarios} />
          </div>
        )}
        {m1Data?.snapshot && (
          <window.TA.AiExplain
            module="mod1"
            provenance={[
              {
                text: '日 K、均線、RSI、MACD、ATR 為真實行情（Yahoo/FinMind）由程式計算，最後一根以即時報價覆蓋',
              },
            ]}
            data={{
              snapshot: m1Data.snapshot,
              weekly: m1Data.weekly_snapshot,
              scenarios: m1Data.scenarios,
              decision: m1Data.llm_result?.decision_payload,
              timeframe: m1Data.timeframe,
            }}
          />
        )}
      </div>
    );
  }

  window.TA = Object.assign(window.TA || {}, { Mod1Panel });
})();
