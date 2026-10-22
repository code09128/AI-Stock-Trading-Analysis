(() => {
  const { useState, useEffect } = React;
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
            ⛔ 嚴進規則：{score.hard_rules.join('；')}
          </div>
        )}
      </div>
    );
  }

  // 籌碼面（FinMind，T+1）：只顯示，不納入 100 分評分
  const fmtLots = (v) =>
    v == null ? '--' : `${v > 0 ? '+' : ''}${Math.round(v).toLocaleString()}`;
  const fmtPp = (v) => (v == null ? '--' : `${v > 0 ? '+' : ''}${Number(v).toFixed(2)}`);
  const lotTone = (v) => (v > 0 ? 'text-rose-400' : v < 0 ? 'text-emerald-400' : 'text-slate-300');
  function ChipPanel({ symbol }) {
    const [data, setData] = useState(null);
    const [err, setErr] = useState(null);
    useEffect(() => {
      if (!symbol) return undefined;
      let stop = false;
      setData(null);
      setErr(null);
      fetch('/api/chips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol }),
      })
        .then((r) => r.json())
        .then((d) => {
          if (stop) return;
          if (d.error) setErr(d.error);
          else {
            setData(d);
            window.TA.lastChips = d; // 給「匯出報告」用
          }
        })
        .catch((e) => !stop && setErr(String(e)));
      return () => {
        stop = true;
      };
    }, [symbol]);

    const box = 'bg-slate-900 border border-slate-800 rounded-xl p-3.5';
    if (err) return <div className={`${box} text-xs text-rose-300`}>籌碼資料讀取失敗：{err}</div>;
    if (!data) return <div className={`${box} text-xs text-slate-500`}>籌碼資料載入中…</div>;
    if (!data.supported)
      return <div className={`${box} text-xs text-slate-500`}>籌碼面：{data.reason}</div>;
    if (data.empty)
      return <div className={`${box} text-xs text-amber-300`}>籌碼面：{data.reason}</div>;

    const inst = data.institutional;
    const mg = data.margin;
    const fh = data.foreign_holding;
    const rows = inst
      ? [
          ['外資', inst.foreign],
          ['投信', inst.trust],
          ['自營商', inst.dealer],
        ]
      : [];
    const bars = (data.daily || []).filter((d) => d.foreign != null);
    const maxAbs = Math.max(1, ...bars.map((d) => Math.abs(d.foreign + (d.trust || 0))));
    return (
      <div className={box}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-[11px] text-slate-400">
            籌碼面（張）
            <window.TA.Tip text="三大法人買賣超＝外資、投信、自營商當天買進減賣出的張數（紅＝買超、綠＝賣超）。融資＝散戶借錢買股的餘額，增加代表散戶加碼；融券＝借券放空的餘額。券資比＝融券÷融資。資料在收盤後才更新（T+1），盤中看不到當日。僅供參考，未納入趨勢評分。" />
          </span>
          <span className="text-[10px] text-slate-500">
            資料日 {data.latest_date || '--'} ・ FinMind（T+1）
          </span>
        </div>

        {data.notes?.length > 0 && (
          <ul className="mt-2 space-y-0.5 text-[11px] text-amber-200">
            {data.notes.map((n) => (
              <li key={n}>• {n}</li>
            ))}
          </ul>
        )}

        <div className="grid md:grid-cols-3 gap-3 mt-3">
          <table className="text-[11px] font-mono w-full">
            <thead className="text-slate-500">
              <tr>
                <th className="text-left font-normal">法人買賣超</th>
                <th className="text-right font-normal">近 5 日</th>
                <th className="text-right font-normal">近 20 日</th>
                <th className="text-right font-normal">連續</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([label, g]) => (
                <tr key={label}>
                  <td className="text-slate-300">{label}</td>
                  <td className={`text-right ${lotTone(g.net_5d)}`}>{fmtLots(g.net_5d)}</td>
                  <td className={`text-right ${lotTone(g.net_20d)}`}>{fmtLots(g.net_20d)}</td>
                  <td className={`text-right ${lotTone(g.streak)}`}>
                    {g.streak ? `${Math.abs(g.streak)} 日${g.streak > 0 ? '買' : '賣'}` : '--'}
                  </td>
                </tr>
              ))}
              {!inst && (
                <tr>
                  <td colSpan={4} className="text-slate-500">
                    無法人資料
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <table className="text-[11px] font-mono w-full">
            <thead className="text-slate-500">
              <tr>
                <th className="text-left font-normal">信用交易</th>
                <th className="text-right font-normal">餘額</th>
                <th className="text-right font-normal">5 日變化</th>
                <th className="text-right font-normal">20 日變化</th>
              </tr>
            </thead>
            <tbody>
              {mg ? (
                <>
                  <tr>
                    <td className="text-slate-300">融資</td>
                    <td className="text-right text-slate-200">
                      {mg.margin_balance.toLocaleString()}
                    </td>
                    <td className={`text-right ${lotTone(mg.margin_change_5d)}`}>
                      {fmtLots(mg.margin_change_5d)}
                    </td>
                    <td className={`text-right ${lotTone(mg.margin_change_20d)}`}>
                      {fmtLots(mg.margin_change_20d)}
                    </td>
                  </tr>
                  <tr>
                    <td className="text-slate-300">融券</td>
                    <td className="text-right text-slate-200">
                      {mg.short_balance.toLocaleString()}
                    </td>
                    <td className={`text-right ${lotTone(mg.short_change_5d)}`}>
                      {fmtLots(mg.short_change_5d)}
                    </td>
                    <td className={`text-right ${lotTone(mg.short_change_20d)}`}>
                      {fmtLots(mg.short_change_20d)}
                    </td>
                  </tr>
                  <tr>
                    <td className="text-slate-500" colSpan={4}>
                      券資比 {mg.short_margin_ratio_pct ?? '--'}% ・ 融資使用率{' '}
                      {mg.margin_usage_pct ?? '--'}%
                    </td>
                  </tr>
                </>
              ) : (
                <tr>
                  <td colSpan={4} className="text-slate-500">
                    無融資融券資料（部分 ETF／不可信用交易的標的沒有）
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <div className="text-[11px] font-mono">
            <div className="text-slate-500">外資持股比</div>
            {fh ? (
              <div className="mt-1">
                <span className="text-lg font-bold text-sky-300">{fh.ratio_pct}%</span>
                <div className="text-slate-400">
                  5 日 <span className={lotTone(fh.change_5d_pct)}>{fmtPp(fh.change_5d_pct)}</span>{' '}
                  ・ 20 日{' '}
                  <span className={lotTone(fh.change_20d_pct)}>{fmtPp(fh.change_20d_pct)}</span>{' '}
                  個百分點
                </div>
              </div>
            ) : (
              <div className="text-slate-500 mt-1">無資料</div>
            )}
          </div>
        </div>

        {bars.length > 0 && (
          <div className="mt-3">
            <div className="text-[10px] text-slate-500 mb-1">
              近 {bars.length} 日外資＋投信買賣超（上＝買超、下＝賣超）
            </div>
            <div className="flex items-center gap-[3px] h-16">
              {bars.map((d) => {
                const v = d.foreign + (d.trust || 0);
                const h = `${(Math.abs(v) / maxAbs) * 100}%`;
                return (
                  <div
                    key={d.date}
                    className="flex-1 h-full flex flex-col justify-center"
                    title={`${d.date}　外資 ${fmtLots(d.foreign)}　投信 ${fmtLots(d.trust)}　融資餘額 ${d.margin_balance ?? '--'}`}
                  >
                    <div className="h-1/2 flex items-end">
                      {v > 0 && (
                        <div className="w-full bg-rose-500/80 rounded-t-sm" style={{ height: h }} />
                      )}
                    </div>
                    <div className="h-1/2 flex items-start border-t border-slate-700">
                      {v < 0 && (
                        <div
                          className="w-full bg-emerald-500/80 rounded-b-sm"
                          style={{ height: h }}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {data.errors?.length > 0 && (
          <div className="mt-2 text-[10px] text-rose-300">
            部分資料取得失敗：{data.errors.join('；')}
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

  // 技術分析 × 我的持股：快速切換持股、並用這次分析的停損／目標價換算你的部位損益
  function MyPositionCard({ m1Data, onAnalyze }) {
    const { holdings } = window.TA.usePortfolio();
    const { fmt, colorOf, baseCode, normSym } = window.TA;
    if (!holdings.length) {
      return (
        <div
          data-tour="mod1-holding"
          className="rounded-xl border border-slate-800 bg-slate-900/70 px-4 py-2 text-xs text-slate-400"
        >
          💼
          還沒有持股。到看盤頁「我的持股」輸入或用模擬下單成交後，這裡會顯示你持有部位在這次分析下的停損／目標損益。
        </div>
      );
    }
    const sym = m1Data?.snapshot?.symbol ? baseCode(m1Data.snapshot.symbol) : null;
    const h = sym ? holdings.find((x) => baseCode(normSym(x.symbol)) === sym) : null;
    const d = m1Data?.llm_result?.decision_payload || {};
    const isSell = d.action === 'SELL';
    const price = m1Data?.snapshot?.latest_close;
    const pnlAt = (p) => (h && p != null ? (p - h.cost) * h.shares : null);
    const pctAt = (p) => (h && p != null ? (p / h.cost - 1) * 100 : null);
    const cur = m1Data?.snapshot?.currency || window.TA.currencyOf(h?.symbol || '');
    return (
      <div
        data-tour="mod1-holding"
        className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs space-y-2"
      >
        <div className="flex flex-wrap items-center gap-2">
          <b className="text-amber-200">💼 我的持股</b>
          {holdings.map((x) => (
            <button
              type="button"
              key={x.symbol}
              onClick={() => onAnalyze(x.symbol)}
              className={`px-2 py-0.5 rounded-md mono border cursor-pointer ${
                baseCode(normSym(x.symbol)) === sym
                  ? 'bg-amber-500/30 border-amber-400 text-white'
                  : 'border-slate-700 text-slate-300 hover:border-slate-500'
              }`}
              title="分析這檔持股"
            >
              {x.symbol}
            </button>
          ))}
          <span className="text-slate-500">點代號就分析那檔</span>
        </div>
        {h ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mono">
            <div>
              <div className="text-slate-400 font-sans">持有 / 成本</div>
              <div className="text-white">
                {fmt(h.shares, 0)} 股 @ {fmt(h.cost)}
              </div>
            </div>
            <div>
              <div className="text-slate-400 font-sans">目前未實現（以分析收盤價）</div>
              <div className={colorOf(pnlAt(price))}>
                {fmt(pnlAt(price), 0)} {cur}（{fmt(pctAt(price))}%）
              </div>
            </div>
            {/* SELL：停損欄位是「空方失效價」（高於現價），對持有者改顯示「現在賣出」與「續跌到下檔」 */}
            <div>
              <div className="text-slate-400 font-sans">
                {isSell ? '若現在賣出' : '若跌到停損'}{' '}
                {(isSell ? d.entry_price : d.stop_loss_price) ?? '--'}
              </div>
              <div className={colorOf(pnlAt(isSell ? d.entry_price : d.stop_loss_price))}>
                {fmt(pnlAt(isSell ? d.entry_price : d.stop_loss_price), 0)}（
                {fmt(pctAt(isSell ? d.entry_price : d.stop_loss_price))}%）
              </div>
            </div>
            <div>
              <div className="text-slate-400 font-sans">
                {isSell ? '若續抱跌到下檔' : '若漲到目標'} {d.take_profit_target ?? '--'}
              </div>
              <div className={colorOf(pnlAt(d.take_profit_target))}>
                {fmt(pnlAt(d.take_profit_target), 0)}（{fmt(pctAt(d.take_profit_target))}%）
              </div>
            </div>
            <div className="col-span-2 md:col-span-4 font-sans text-slate-300 flex flex-wrap items-center gap-2">
              {d.action === 'SELL' && (
                <span className="text-rose-300">
                  ⚠️ 這次分析建議偏「賣出」，而你持有這檔，請對照你的停損規則；收盤站回{' '}
                  {d.stop_loss_price} 代表這個判斷失效。
                </span>
              )}
              {d.action === 'BUY' && (
                <span className="text-emerald-300">
                  這次分析偏「買進」；若要加碼，留意加權平均成本會改變。
                </span>
              )}
              {d.action === 'HOLD' && <span>這次分析建議「觀望」。</span>}
              <button
                type="button"
                onClick={() => {
                  window.TA._pendingWatch = {
                    listTab: 'hold',
                    rightTab: 'quote',
                    select: h.symbol,
                  };
                  window.TA.goTab?.('watch');
                }}
                className="ml-auto px-3 py-1 rounded-lg bg-slate-800 border border-slate-700 text-slate-200 hover:bg-slate-700 cursor-pointer"
              >
                到看盤頁處理這檔持股（賣出／加碼）
              </button>
            </div>
          </div>
        ) : (
          <div className="text-slate-400">
            目前分析的 {sym || '標的'} 不在你的持股裡；點上方代號可直接分析你持有的股票。
          </div>
        )}
      </div>
    );
  }

  // 技術分析：多維度動態看盤與技術分析
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
              ⚡ 已從看盤帶入：{m1Context.symbol} {m1Context.name}・現價 {m1Context.price}（
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
              <h2 className="text-lg font-bold text-white">
                📈 技術分析：多維度動態看盤與技術分析工作台
              </h2>
              <p className="text-xs text-slate-400">
                支援滑鼠十字準星懸停查價、20~60 日 K 線縮放、每 5 秒以真實報價更新最新一根 K
                棒與防幻覺決策審核
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
                  ? '⏸️ AI 決策模式：不自動刷新（按查詢才會呼叫 AI）'
                  : isLivePolling
                    ? `🟢 每 5 秒更新真實報價 (${countdownSec}s)`
                    : '⏸️ 已暫停自動刷新'}
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
              推論引擎：
              <b className="text-slate-200">
                {m1Data?.llm_result?.execution_mode?.startsWith('LIVE')
                  ? 'AI 模型'
                  : '內建規則引擎'}
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
                  : '🔍 查詢標的'}
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
                    ? '🤖 AI 建議方向'
                    : '⚙️ 規則引擎建議'}
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
                <div className="text-[11px] text-slate-400">防幻覺護欄審核</div>
                <div className="text-sm font-bold font-mono text-emerald-400 mt-1.5">
                  {m1Data.llm_result?.anti_hallucination_audit?.passed
                    ? '✅ 100% 合規通過'
                    : '❌ 攔截違規'}
                </div>
                <div className="text-[10px] text-slate-400 font-mono truncate">
                  來源: {m1Data.snapshot.data_source}
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
                📖 怎麼看這張圖
              </button>
              <button
                type="button"
                onClick={() => backtestThis(m1Data.snapshot.symbol)}
                className="px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-950 text-amber-300 hover:text-white cursor-pointer"
                title="用真實歷史資料回測這一檔"
                data-tour="mod1-backtest"
              >
                🧮 回測這檔
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
                  🎯 關鍵支撐與壓力價位（已隨最新 Tick 對齊{' '}
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
                    ? '🤖 AI 決策邏輯'
                    : '⚙️ 規則引擎決策邏輯'}
                  與強制失效出場條件
                </div>
                <ol className="list-decimal pl-5 space-y-1 text-xs text-slate-300 leading-relaxed bg-slate-950 p-3 rounded-lg border border-slate-800">
                  {(m1Data.llm_result?.decision_payload?.step_by_step_rationale || []).map((r) => (
                    <li key={r}>{r.replace(/^\d+\.\s*/, '')}</li>
                  ))}
                </ol>
                <div className="text-[11px] text-slate-500">
                  {m1Data?.llm_result?.notice?.includes('未通過') ||
                    (m1Data.llm_result.notice.includes('失敗') && (
                      <span className="block text-amber-300">⚠️ {m1Data.llm_result.notice}</span>
                    ))}
                  決策來源：
                  {m1Data.llm_result?.execution_mode === 'DETERMINISTIC_RULE_ENGINE'
                    ? '本機規則引擎（未使用 AI 模型）'
                    : m1Data.llm_result?.execution_mode}
                  。價位全部由程式計算，並通過防幻覺稽核。
                </div>
                <div className="bg-rose-950/30 border border-rose-700/40 rounded-lg p-3 text-xs text-rose-200">
                  <span className="font-bold text-rose-400">🚨 邏輯失效出場條件：</span>
                  {m1Data.llm_result?.decision_payload?.invalidation_criteria}
                </div>
              </div>
            </div>
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
