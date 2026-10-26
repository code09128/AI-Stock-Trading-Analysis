// 技術分析頁的獨立卡片：籌碼面板（FinMind 三大法人、融資融券、外資持股）、「你持有這檔」部位卡片
(() => {
  const { useState, useEffect } = React;

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
          還沒有持股。到看盤頁「我的持股」輸入或用模擬下單成交後，這裡會顯示你持有部位在這次分析下的停損／目標損益。
        </div>
      );
    }
    const sym = m1Data?.snapshot?.symbol ? baseCode(m1Data.snapshot.symbol) : null;
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
    const h = sym ? grouped.find((x) => x.code === sym) : null;
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
          <b className="text-amber-200">我的持股</b>
          {grouped.map((x) => (
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
                {Number.isInteger(h.shares) ? fmt(h.shares, 0) : fmt(h.shares, 4)} 股 @{' '}
                {fmt(h.cost)}
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
              <button
                type="button"
                onClick={() => window.TA.backtestSymbol?.(m1Data?.snapshot?.symbol || h.symbol)}
                className="px-3 py-1 rounded-lg bg-sky-600/30 border border-sky-500/50 text-sky-200 hover:bg-sky-600/50 cursor-pointer"
              >
                回測這檔持股 →
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
  // 多頭／中性／空頭三情境：條件推演，不是預測

  window.TA = Object.assign(window.TA || {}, { ChipPanel, MyPositionCard });
})();
