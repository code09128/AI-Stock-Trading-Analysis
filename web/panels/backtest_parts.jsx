// 策略回測：表單與績效顯示用的小元件（說明卡、數字欄位、每日淨值圖、風控統計、交易明細）
(() => {
  const pf = (v) => (v == null ? '--' : v >= 999 ? '無虧損' : v);

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
            <b className="text-white">結果分頁</b>：績效總覽（指標、淨值曲線、出場原因）→ 交易明細（逐筆）→ 環境與前後段
            （多頭／盤整／空頭拆分、一次切分的前後段驗證、下一個要測的規則）→ 參數最佳化 → 蒙地卡羅。
          </p>
          <p>
            <b className="text-white">參數最佳化</b>：按「執行參數掃描」後，用同一組設定把兩個參數各試 6 個值畫成熱力圖，
            ★ 標出「自己賺、周圍也賺」的穩定高原；只有單一格特別好的「孤島」不要用。點格子可把參數帶回表單。
            下方的滾動前進分析把期間切成多段「過去挑參數 → 下一段實跑」，WFE（樣本外 ÷ 樣本內年化報酬）0.5 以上算穩健。
          </p>
          <p>
            <b className="text-white">蒙地卡羅</b>：把這次的交易打亂順序或重抽樣 500～3,000 次，看最大回撤可能多深，
            用「最差 5%」的回撤決定資金要放多少。
          </p>
          <p>
            <b className="text-white">📡 今日訊號</b>：用同一組策略與風控設定掃描自選股（或持股、自訂清單），
            列出每檔今天是買進、賣出、持有中、今日停損出場或被大盤濾網擋下，可匯出 CSV 當盤後選股清單。
            「持有中」是策略的模擬部位，不是你的真實持股。
          </p>
          <p>
            <b className="text-white">📤 匯出 Pine v5</b>：把策略轉成 TradingView 的 Pine Script，貼到 TradingView
            就能看買賣點與回測；頁面上有 5 步使用說明，以及結果和本系統不同的原因（還權價格、證交稅攤提、整張股數…）。
          </p>
          <p>
            <b className="text-white">🖨️ PDF 報告</b>：回測結果右上角，開啟列印後選「另存為 PDF」。
          </p>
          <p>
            <b className="text-white">結果會失效</b>：重新執行回測後，參數最佳化與蒙地卡羅的結果會清掉，需要再按一次計算，
            避免拿舊設定的結果判讀。</p>
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


  window.TA = Object.assign(window.TA || {}, {
    BT: Object.assign(window.TA?.BT || {}, {
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
    }),
  });
})();
