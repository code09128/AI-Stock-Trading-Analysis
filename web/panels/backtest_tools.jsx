// 策略回測頁的工具：今日訊號（自選股掃描＋CSV）、匯出 TradingView Pine v5、PDF 報告（瀏覽器列印）
(() => {
  const { useState } = React;

  async function postJSON(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
  }

  // 表單裡跟「標的」無關的策略與風控設定（今日訊號、Pine 匯出共用）
  const strategyPayload = (f) => ({
    strategy: f.strategy,
    params: f.params,
    initial_capital: f.initial_capital,
    commission_discount: f.commission_discount,
    period_years: f.period_years,
    sizing_mode: f.sizing_mode,
    sizing_value: f.sizing_value,
    atr_mult: f.atr_mult,
    stop_loss_pct: f.stop_loss_pct,
    trailing_pct: f.trailing_pct,
    market_filter: f.market_filter,
    filter_ma: f.filter_ma,
  });

  const STATUS_STYLE = {
    buy: 'bg-rose-500/15 text-rose-200 border-rose-500/40',
    sell: 'bg-emerald-500/15 text-emerald-200 border-emerald-500/40',
    stopped: 'bg-amber-500/15 text-amber-200 border-amber-500/40',
    blocked: 'bg-slate-700/40 text-slate-300 border-slate-600',
    hold: 'bg-sky-500/15 text-sky-200 border-sky-500/40',
    wait: 'bg-slate-800/60 text-slate-400 border-slate-700',
  };

  function downloadCSV(rows, filename) {
    const head = ['代號', '狀態', '最新日期', '收盤', '盤中未確定', '進場日', '進場價', '帳面損益%', '停損價', '今日出場價', '錯誤'];
    const esc = (v) => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = rows.map((r) =>
      [
        r.symbol,
        r.status_label || '',
        r.last_date || '',
        r.close ?? '',
        r.provisional ? '是' : '',
        r.position?.entry_date || '',
        r.position?.entry_price ?? '',
        r.position?.unrealized_pct ?? '',
        r.position?.stop_price ?? '',
        r.exit_today?.exit_price ?? '',
        r.error || '',
      ]
        .map(esc)
        .join(','),
    );
    // 開頭加 BOM，Excel 開啟才不會亂碼
    window.TA.downloadText(`﻿${[head.join(','), ...lines].join('\n')}`, filename, 'text/csv;charset=utf-8');
  }

  // 📡 今日訊號：自選股（或持股、自訂清單）× 目前表單的策略與風控設定
  function SignalsPanel({ m3Form, onBacktest }) {
    const { readLS, LS_WATCH, DEFAULT_WATCH, loadPortfolio } = window.TA;
    const [source, setSource] = useState('watch');
    const [custom, setCustom] = useState('');
    const [data, setData] = useState(null);
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState(null);
    const watch = readLS(LS_WATCH, DEFAULT_WATCH);
    const held = [...new Set((loadPortfolio().holdings || []).map((h) => h.symbol))];
    const list =
      source === 'watch'
        ? watch
        : source === 'hold'
          ? held
          : custom
              .split(/[\s,，、]+/)
              .map((x) => x.trim())
              .filter(Boolean);
    const run = async () => {
      setBusy(true);
      setErr(null);
      try {
        setData(await postJSON('/api/mod3/signals', { ...strategyPayload(m3Form), symbols: list }));
      } catch (e) {
        setErr(e.message);
      } finally {
        setBusy(false);
      }
    };
    const srcBtn = (k, label) => (
      <button
        type="button"
        onClick={() => setSource(k)}
        className={`px-3 py-1.5 rounded-lg text-xs border cursor-pointer ${
          source === k ? 'bg-sky-600/20 border-sky-500/50 text-sky-200' : 'border-slate-700 text-slate-400'
        }`}
      >
        {label}
      </button>
    );
    return (
      <div className="space-y-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-xs text-slate-300 space-y-3">
          <div>
            用上方表單的<b>策略、參數、部位、停損停利與大盤濾網</b>，把清單裡每一檔跑到最新一根日 K，列出今天的狀態。
            <window.TA.Tip text="買進／賣出＝最新一根收盤出現訊號，下一個交易日開盤執行；持有中＝這支策略用同一套規則一路模擬到今天、目前仍持有（不是你的真實持股），附目前的停損價；被大盤濾網擋下＝有買訊但大盤在均線下；今日停損／停利出場＝最新一根盤中觸價。盤中執行時最新一根是盤中 K 棒，收盤前訊號可能改變。每檔約抓 2 年日 K，只用 Yahoo 行情，不會用到 FinMind 額度（Yahoo 抓不到的台股才會改用 FinMind）。" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {srcBtn('watch', `自選股（${watch.length}）`)}
            {srcBtn('hold', `我的持股（${held.length}）`)}
            {srcBtn('custom', '自訂清單')}
            <button
              type="button"
              onClick={run}
              disabled={busy || !list.length}
              className="ml-auto py-1.5 px-4 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-semibold cursor-pointer"
            >
              {busy ? `掃描中…（${list.length} 檔）` : `掃描 ${list.length} 檔`}
            </button>
          </div>
          {source === 'custom' && (
            <textarea
              aria-label="自訂代號清單"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="輸入代號，用空白、逗號或換行分隔，例如：2330 2454 0050 NVDA（最多 60 檔）"
              className="w-full h-16 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 font-mono text-white"
            />
          )}
          {source !== 'custom' && (
            <div className="text-slate-500 font-mono break-all">{list.join('、') || '（清單是空的）'}</div>
          )}
          {err && <div className="text-rose-300">⚠️ {err}</div>}
        </div>

        {data && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-xs space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-slate-200">
                {data.strategy.label}（{data.strategy.params_text}）
              </span>
              {Object.entries(data.labels).map(([k, label]) =>
                data.summary[k] ? (
                  <span key={k} className={`px-2 py-0.5 rounded border ${STATUS_STYLE[k]}`}>
                    {label} {data.summary[k]}
                  </span>
                ) : null,
              )}
              {data.summary.error > 0 && <span className="text-rose-300">失敗 {data.summary.error}</span>}
              <button
                type="button"
                onClick={() => downloadCSV(data.rows, `今日訊號_${window.TA.stamp()}.csv`)}
                className="ml-auto px-3 py-1 rounded-lg border border-slate-700 text-slate-300 hover:text-white cursor-pointer"
              >
                匯出 CSV
              </button>
            </div>
            {data.warnings.map((w) => (
              <div key={w} className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-amber-100">
                ⚠️ {w}
              </div>
            ))}
            <div className="overflow-x-auto">
              <table className="w-full text-left font-mono whitespace-nowrap">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 font-sans">
                    <th className="py-1.5 px-2">代號</th>
                    <th className="py-1.5 px-2">狀態</th>
                    <th className="py-1.5 px-2">最新日期</th>
                    <th className="py-1.5 px-2">收盤</th>
                    <th className="py-1.5 px-2 font-sans">策略部位（模擬）</th>
                    <th className="py-1.5 px-2">停損價</th>
                    <th className="py-1.5 px-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {data.rows.map((r) => (
                    <tr key={r.input}>
                      <td className="py-1.5 px-2 text-slate-200">{r.symbol}</td>
                      {r.error ? (
                        <td colSpan={5} className="py-1.5 px-2 font-sans text-rose-300 whitespace-normal">
                          {r.error}
                        </td>
                      ) : (
                        <>
                          <td className="py-1.5 px-2 font-sans">
                            <span className={`px-2 py-0.5 rounded border ${STATUS_STYLE[r.status]}`}>{r.status_label}</span>
                            {r.provisional && <span className="ml-1 text-amber-300">盤中</span>}
                          </td>
                          <td className="py-1.5 px-2">{r.last_date}</td>
                          <td className="py-1.5 px-2">{r.close}</td>
                          <td className="py-1.5 px-2 font-sans text-slate-400">
                            {r.position
                              ? `${r.position.entry_date} 以 ${r.position.entry_price} 進場，帳面 ${r.position.unrealized_pct}%`
                              : r.exit_today
                                ? `今日${r.exit_today.exit_reason} ${r.exit_today.exit_price}（${r.exit_today.return_pct}%）`
                                : '--'}
                          </td>
                          <td className="py-1.5 px-2 text-rose-300">{r.position?.stop_price ?? '--'}</td>
                        </>
                      )}
                      <td className="py-1.5 px-2">
                        <button
                          type="button"
                          onClick={() => onBacktest(r.symbol)}
                          className="text-sky-300 hover:underline cursor-pointer font-sans"
                        >
                          回測這檔
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="text-slate-400">{data.note}</div>
          </div>
        )}
      </div>
    );
  }

  // 📤 匯出 Pine v5：說明怎麼用、跟本系統有哪些差異，再給程式碼
  function PineExportPanel({ m3Form, m3Data }) {
    const [data, setData] = useState(null);
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState(null);
    const [copied, setCopied] = useState(false);
    const { baseCode } = window.TA;
    // 回測過同一檔就用回測解析出的完整代號（例如上櫃 8069.TWO），TradingView 代號才對得上
    const symbol =
      m3Data && baseCode(m3Data.symbol) === baseCode(window.TA.normSym(m3Form.target_asset || ''))
        ? m3Data.symbol
        : m3Form.target_asset;
    const run = async () => {
      setBusy(true);
      setErr(null);
      setCopied(false);
      try {
        setData(await postJSON('/api/mod3/pine', { ...strategyPayload(m3Form), target_asset: symbol }));
      } catch (e) {
        setErr(e.message);
      } finally {
        setBusy(false);
      }
    };
    const copy = async () => {
      try {
        await navigator.clipboard.writeText(data.code);
        setCopied(true);
      } catch (_e) {
        setErr('無法寫入剪貼簿，請直接在下方程式碼框全選後複製');
      }
    };
    return (
      <div className="space-y-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-xs text-slate-300 space-y-2 leading-relaxed">
          <div className="font-semibold text-slate-200">什麼是 Pine Script？</div>
          <p>
            Pine Script 是 TradingView（全球常用的看盤網站）的策略語言。這裡會把上方表單的
            <b>策略、參數、部位、停損停利、大盤濾網與手續費／證交稅</b>轉成 Pine v5 程式碼，
            貼到 TradingView 就能在它的圖表上看到買賣點，並用「策略測試器」回測、或設定到價通知。
          </p>
          <div className="font-semibold text-slate-200 pt-1">怎麼用（5 步）</div>
          <ol className="list-decimal pl-5 space-y-0.5">
            <li>按下方「產生程式碼」，再按「複製」。</li>
            <li>
              到 tradingview.com 開啟這檔的<b>日線</b>圖（代號見下方，例如 TWSE:2330）。
            </li>
            <li>點畫面下方的「Pine 編輯器」，把原本的內容全部刪掉、貼上程式碼。</li>
            <li>按「加到圖表」（Add to chart），圖上會出現買賣標記與紅色停損線。</li>
            <li>點「策略測試器」（Strategy Tester）看績效；參數可在策略的「設定」裡直接調整，不必改程式碼。</li>
          </ol>
          <p className="text-amber-200">
            ⚠️ TradingView 的回測結果<b>不會和本系統完全一樣</b>（價格是否還權、證交稅攤提、整張股數等），差異說明會列在產生的程式碼下方。
            這份程式碼只是把策略規則搬過去，不是買賣建議。
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-slate-400">
              標的 <b className="text-slate-200 font-mono">{symbol}</b>｜策略與風控取自上方表單
            </span>
            <button
              type="button"
              onClick={run}
              disabled={busy}
              className="ml-auto py-1.5 px-4 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-semibold cursor-pointer"
            >
              {busy ? '產生中…' : data ? '重新產生' : '產生程式碼'}
            </button>
          </div>
          {err && <div className="text-rose-300">⚠️ {err}</div>}
        </div>
        {data && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-xs space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-slate-300">
                TradingView 代號 <b className="font-mono text-white">{data.tv_symbol}</b>｜每邊手續費{' '}
                <b className="font-mono">{data.commission.pct}%</b>
                <window.TA.Tip text={data.commission.text} />
              </span>
              <button
                type="button"
                onClick={copy}
                className="ml-auto px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold cursor-pointer"
              >
                {copied ? '已複製 ✓' : '複製'}
              </button>
              <button
                type="button"
                onClick={() => window.TA.downloadText(data.code, `${data.title}.pine`, 'text/plain;charset=utf-8')}
                className="px-3 py-1 rounded-lg border border-slate-700 text-slate-300 hover:text-white cursor-pointer"
              >
                下載 .pine
              </button>
            </div>
            <pre className="bg-slate-950 border border-slate-800 rounded-lg p-3 max-h-80 overflow-auto text-[11px] text-emerald-200 whitespace-pre">
              {data.code}
            </pre>
            <div>
              <div className="font-semibold text-slate-300 mb-1">和本系統的差異（結果不同時先看這裡）</div>
              <ul className="list-disc pl-5 space-y-0.5 text-slate-400">
                {data.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    );
  }

  // 🖨️ PDF 報告：組一份白底的列印頁，放進隱藏 iframe 後呼叫列印（桌面版與瀏覽器都能用，選「另存為 PDF」）
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  function equitySvg(points, initial) {
    if (!points || points.length < 2) return '';
    const W = 700;
    const H = 180;
    const eq = points.map((p) => p.equity);
    const lo = Math.min(...eq, initial);
    const hi = Math.max(...eq, initial);
    const r = Math.max(hi - lo, 1);
    const x = (i) => (i / (points.length - 1)) * W;
    const y = (v) => H - ((v - lo) / r) * H;
    const line = points.map((p, i) => `${x(i).toFixed(1)},${y(p.equity).toFixed(1)}`).join(' ');
    return `<svg viewBox="0 0 ${W} ${H + 16}" width="100%" height="200"><line x1="0" x2="${W}" y1="${y(initial)}" y2="${y(initial)}" stroke="#999" stroke-dasharray="4 4"/><polyline fill="none" stroke="#0369a1" stroke-width="1.6" points="${line}"/><text x="0" y="${H + 14}" font-size="11" fill="#555">${esc(points[0].date)}</text><text x="${W}" y="${H + 14}" font-size="11" fill="#555" text-anchor="end">${esc(points[points.length - 1].date)}</text></svg>`;
  }

  const table = (head, rows) =>
    `<table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows
      .map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`)
      .join('')}</tbody></table>`;

  function buildReportHTML(d) {
    const r = d.backtest_result;
    const rs = d.risk_settings || {};
    const opt = window.TA.BT.peekCached?.('opt', d);
    const mc = window.TA.BT.peekCached?.('mc', d);
    const sec = [];
    sec.push(`<h1>策略回測報告：${esc(d.symbol)}</h1>
      <p class="muted">${esc(d.strategy?.label)}（${esc(d.strategy?.params_text)}）｜${esc(d.period)}｜本金 ${esc(
        Number(d.strategy_params?.initial_capital).toLocaleString(),
      )} ${esc(d.currency)}｜產生時間 ${esc(new Date().toLocaleString())}</p>
      <p class="muted">${esc(d.strategy?.rule)}</p>
      <p class="muted">部位：${esc(r.position_sizing)}；停損 ${rs.stop_loss_pct ? `-${rs.stop_loss_pct}%` : '未使用'}；移動停利 ${
        rs.trailing_pct ? `回落 ${rs.trailing_pct}%` : '未使用'
      }；大盤濾網 ${rs.market_filter ? `${esc(rs.filter_index)} ${rs.filter_ma} 日線（擋下 ${r.blocked_by_filter} 次）` : '未開啟'}</p>`);
    sec.push(`<h2>績效摘要</h2>${table(
      ['總報酬', '最大回撤（每日）', '獲利因子', '勝率', '交易數', '平均獲利', '平均虧損', '賺賠比'],
      [
        [
          `${r.total_return_pct}%`,
          `-${r.max_drawdown_pct}%`,
          r.profit_factor >= 999 ? '無虧損' : r.profit_factor,
          `${r.win_rate_pct}%`,
          r.total_trades,
          `+${r.avg_win_pct}%`,
          `${r.avg_loss_pct}%`,
          r.payoff_ratio ?? '--',
        ],
      ],
    )}<p class="muted">${esc(r.sample_size_note || '')}</p>`);
    sec.push(`<h2>每日淨值</h2>${equitySvg(r.daily_equity, d.strategy_params?.initial_capital || 1)}`);
    if (d.regime_breakdown)
      sec.push(
        `<h2>市場環境拆分（${esc(d.regime_breakdown.index)}）</h2>${table(
          ['環境', '交易數', '勝率', '平均報酬', '淨損益'],
          d.regime_breakdown.rows.map((x) => [
            x.regime,
            x.trades,
            x.trades ? `${x.win_rate_pct}%` : '--',
            x.trades ? `${x.avg_return_pct}%` : '--',
            x.trades ? x.net_pnl : '--',
          ]),
        )}`,
      );
    if (d.walk_forward) sec.push(`<h2>前後段驗證</h2><p>${esc(d.walk_forward.verdict)}</p>`);
    if (opt?.rolling)
      sec.push(
        `<h2>滾動前進分析（WFE ${esc(opt.rolling.wfe ?? '--')}）</h2>${table(
          ['測試期', '挑出的參數', '樣本內', '樣本外', '筆數'],
          opt.rolling.folds
            .filter((f) => !f.skipped)
            .map((f) => [f.test_period, f.best_label, `${f.is_return_pct}%`, `${f.oos_return_pct}%`, f.oos_trades]),
        )}<p>${esc(opt.rolling.verdict)}</p>`,
      );
    if (opt?.heatmap) sec.push(`<h2>參數穩定度</h2><p>${esc(opt.heatmap.verdict)}</p>`);
    if (mc)
      sec.push(
        `<h2>蒙地卡羅（${mc.mode === 'shuffle' ? '打亂順序' : '重抽樣'} ${mc.runs} 次）</h2>${table(
          ['實際回撤（逐筆）', '中位數回撤', '最差 5% 回撤', '回撤比實際更深的機率', '虧錢機率'],
          [
            [
              `-${mc.actual.mdd_pct}%`,
              `-${mc.mdd_pct.p50}%`,
              `-${mc.mdd_pct.p95}%`,
              `${mc.prob_mdd_worse_pct}%`,
              mc.mode === 'bootstrap' ? `${mc.prob_loss_pct}%` : '--',
            ],
          ],
        )}`,
      );
    if (!opt || !mc)
      sec.push(
        `<p class="muted">${!opt ? '未執行參數最佳化。' : ''}${!mc ? '未執行蒙地卡羅。' : ''}要放進報告，請先在對應分頁按計算再匯出。</p>`,
      );
    if ((d.next_step_ideas || []).length)
      sec.push(`<h2>下一步可測試的規則</h2><ul>${d.next_step_ideas.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`);
    const trades = r.trades || [];
    sec.push(
      `<h2>交易明細${trades.length > 40 ? `（最近 40 筆，共 ${trades.length} 筆）` : ''}</h2>${table(
        ['#', '進場日', '進場價', '出場日', '出場價', '出場原因', '淨損益', '報酬率'],
        trades
          .slice(-40)
          .map((t) => [t.trade_id, t.entry_date, t.entry_price, t.exit_date, t.exit_price, t.exit_reason, t.net_pnl, `${t.return_pct}%`]),
      )}`,
    );
    sec.push(
      '<p class="muted">本報告由程式依真實歷史日 K 模擬計算（訊號隔日開盤成交、已扣手續費與稅），不代表未來績效，也不是投資建議。</p>',
    );
    return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>策略回測報告 ${esc(d.symbol)}</title>
      <style>
        body{font-family:"Microsoft JhengHei","PingFang TC",sans-serif;color:#111;background:#fff;margin:24px;font-size:12px}
        h1{font-size:20px;margin:0 0 6px} h2{font-size:14px;margin:18px 0 6px;border-bottom:1px solid #ccc;padding-bottom:3px}
        table{border-collapse:collapse;width:100%;margin:4px 0} th,td{border:1px solid #ccc;padding:3px 6px;text-align:left}
        th{background:#f1f5f9} .muted{color:#555;margin:2px 0}
        @page{size:A4;margin:12mm} h2{break-after:avoid} tr{break-inside:avoid}
      </style></head><body>${sec.join('\n')}</body></html>`;
  }

  function printReport(m3Data) {
    const old = document.getElementById('bt-print-frame');
    if (old) old.remove();
    const f = document.createElement('iframe');
    f.id = 'bt-print-frame';
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    document.body.appendChild(f);
    const doc = f.contentWindow.document;
    doc.open();
    doc.write(buildReportHTML(m3Data));
    doc.close();
    setTimeout(() => {
      f.contentWindow.focus();
      f.contentWindow.print();
    }, 300);
  }

  window.TA = Object.assign(window.TA || {}, {
    BT: Object.assign(window.TA?.BT || {}, { SignalsPanel, PineExportPanel, printReport, buildReportHTML }),
  });
})();
