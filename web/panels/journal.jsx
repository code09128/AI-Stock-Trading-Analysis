(() => {
  // 交易檢討：交易日誌教練
  const { useState } = React;

  // 交易紀錄來源：我的（模擬成交／匯入）或 範例；可貼 CSV 匯入真實券商對帳單
  function JournalSource({ m5Source, setM5Source, setM5Entries, runMod5 }) {
    const { journal } = window.TA.usePortfolio();
    const [csv, setCsv] = useState('');
    const [msg, setMsg] = useState('');
    const importCsv = () => {
      const rows = csv
        .split(/\r?\n/)
        .map((l) => l.split(/[,\t]/).map((x) => x.trim()))
        .filter((c) => c.length >= 6 && Number(c[2]) > 0 && Number(c[4]) > 0 && Number(c[5]) > 0)
        .map((c, i) => ({
          trade_id: `#${String(Number(window.TA.nextTradeId(journal).slice(1)) + i).padStart(2, '0')}`,
          symbol: c[0].toUpperCase(),
          entry_time: c[1],
          entry_price: Number(c[2]),
          exit_time: c[3],
          exit_price: Number(c[4]),
          shares: Number(c[5]),
          emotion_score: 0,
          source: 'CSV 匯入',
        }));
      if (!rows.length) {
        const m = '沒有匯入：沒有讀到有效列。格式：代號,買進日期,買進價,賣出日期,賣出價,股數';
        setMsg(m);
        window.TA.toast?.(`⚠️ ${m}`);
        return;
      }
      const next = [...journal, ...rows];
      window.TA.setJournal(next);
      setM5Source('mine');
      setM5Entries(next);
      setCsv('');
      setMsg(`已匯入 ${rows.length} 筆`);
      window.TA.notifySaved(`已匯入 ${rows.length} 筆交易紀錄`);
    };
    return (
      <div
        className="rounded-xl border border-slate-800 bg-slate-950/50 p-3 space-y-2 text-xs"
        data-tour="mod5-source"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-slate-400">交易紀錄來源：</span>
          {[
            ['mine', `我的交易紀錄（${journal.length} 筆）`],
            ['sample', '內建範例'],
          ].map(([k, label]) => (
            <button
              type="button"
              key={k}
              onClick={() => {
                setM5Source(k);
                setM5Entries(k === 'mine' ? journal : window.TA.DEFAULT_JOURNAL);
                window.TA.toast?.(
                  k === 'mine'
                    ? `ℹ️ 已改用我的交易紀錄（${journal.length} 筆）`
                    : 'ℹ️ 已改用內建範例（不會動到你的交易紀錄）',
                );
              }}
              className={`px-3 py-1 rounded-lg border cursor-pointer ${
                m5Source === k
                  ? 'bg-sky-500/20 border-sky-400 text-white'
                  : 'border-slate-700 text-slate-400'
              }`}
            >
              {label}
            </button>
          ))}
          <span className={m5Source === 'mine' ? 'text-emerald-300' : 'text-amber-300'}>
            {m5Source === 'mine'
              ? '✅ 分析你的真實／模擬成交紀錄；損益、持有天數、出場後 5 日最高價由系統用真實日 K 計算'
              : '⚠️ 範例資料，不是你的交易'}
          </span>
        </div>
        <div className="text-slate-500">
          我的交易紀錄來自：看盤頁模擬下單「成交」賣出時自動寫入，或下方貼上券商對帳單 CSV。
        </div>
        <details>
          <summary className="cursor-pointer text-slate-300">貼上 CSV 匯入真實交易</summary>
          <textarea
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            rows={4}
            placeholder={
              '每行一筆：代號,買進日期,買進價,賣出日期,賣出價,股數\n2330,2026-08-01,2200,2026-08-20,2250,1000'
            }
            aria-label="交易紀錄 CSV"
            className="w-full mt-2 bg-slate-950 border border-slate-700 rounded p-2 font-mono text-white"
          />
          <div className="flex items-center gap-2 mt-1">
            <button
              type="button"
              onClick={importCsv}
              className="px-3 py-1 rounded bg-slate-700 hover:bg-slate-600 text-white cursor-pointer"
            >
              匯入
            </button>
            <button
              type="button"
              onClick={runMod5}
              className="px-3 py-1 rounded bg-sky-600 hover:bg-sky-500 text-white cursor-pointer"
            >
              匯入後診斷
            </button>
            {msg && <span className="text-slate-300">{msg}</span>}
          </div>
        </details>
      </div>
    );
  }

  function Mod5Panel({ ctx }) {
    const { m5Data, m5Entries, m5Loading, m5Source, runMod5, setM5Entries, setM5Source } = ctx;
    // 「我的交易紀錄」模式：表格就是交易紀錄本身，改動立刻存回（否則回看盤頁成交後再診斷，會用舊表格蓋掉新紀錄）
    // msg：要通知的內容；逐字修改用延遲通知（停手 1 秒才提示一次），刪除等一次性動作立即通知
    const edit = (next, msg, immediate = false) => {
      setM5Entries(next);
      if (m5Source === 'mine') {
        window.TA.setJournal(next);
        if (msg) (immediate ? window.TA.notifySaved : (m) => window.TA.notifySavedLater('m5-edit', m))(msg);
      } else if (msg) {
        window.TA.toast?.(`ℹ️ ${msg}（目前是內建範例，只在這次畫面有效，不會存檔）`);
      }
    };
    return (
      <div className="space-y-5">
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-white">交易紀錄</h2>
              <span className="block mt-1 text-xs text-slate-500">
                資料狀態：見下方「交易紀錄來源」；統計與偏誤偵測由程式計算，規則來源會另外標示
              </span>
              <p className="text-xs text-slate-400">
                依你的交易紀錄計算勝率與期望值，找出重複出現的壞習慣並產生 3 條交易規則
              </p>
            </div>
            <div className="flex gap-2">
              {m5Source !== 'mine' && (
                <button
                  type="button"
                  title="加一筆範例交易（只在內建範例模式；你的交易請用模擬成交或 CSV 匯入）"
                  onClick={() => {
                    window.TA.toast?.('ℹ️ 已新增一筆範例交易（範例模式只在這次畫面有效，不會存檔）');
                    setM5Entries([
                      ...m5Entries,
                      {
                        trade_id: window.TA.nextTradeId(m5Entries),
                        symbol: '2330.TW',
                        entry_time: '09:03',
                        exit_time: '10:15',
                        entry_price: 1060.0,
                        exit_price: 1030.0,
                        shares: 2000,
                        net_pnl: -60000.0,
                        return_pct: -2.8,
                        emotion_score: 9,
                        high_5d_after_exit: 1055.0,
                      },
                    ]);
                  }}
                  className="text-xs px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-sky-300 border border-slate-700 cursor-pointer"
                >
                  新增一筆範例交易
                </button>
              )}
              <button
                type="button"
                onClick={runMod5}
                disabled={m5Loading}
                className="text-xs px-4 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-semibold shadow-lg shadow-sky-600/25 cursor-pointer"
              >
                {m5Loading ? '診斷中...' : '執行交易診斷'}
              </button>
            </div>
          </div>

          <JournalSource
            m5Source={m5Source}
            setM5Source={setM5Source}
            setM5Entries={setM5Entries}
            runMod5={runMod5}
          />

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2 px-1.5">編號</th>
                  <th className="py-2 px-1.5">標的</th>
                  <th className="py-2 px-1.5">進場時間</th>
                  <th className="py-2 px-1.5">股數</th>
                  <th className="py-2 px-1.5">淨損益</th>
                  <th className="py-2 px-1.5">報酬率%</th>
                  <th className="py-2 px-1.5">情緒(1-10)</th>
                  <th className="py-2 px-1.5">出場後5日高點</th>
                  <th className="py-2 px-1.5">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {m5Entries.map((en, idx) => (
                  <tr key={en.trade_id}>
                    <td className="py-1.5 px-1.5 font-bold text-amber-300">{en.trade_id}</td>
                    <td className="py-1.5 px-1.5">
                      <input
                        type="text"
                        value={en.symbol}
                        onChange={(e) => {
                          const next = [...m5Entries];
                          next[idx] = { ...next[idx], symbol: e.target.value };
                          edit(next, `已儲存交易紀錄 ${en.trade_id} 的修改`);
                        }}
                        className="bg-slate-950 border border-slate-700 rounded px-2 py-1 w-24 text-white"
                      />
                    </td>
                    <td className="py-1.5 px-1.5">
                      <input
                        type="text"
                        value={en.entry_time}
                        onChange={(e) => {
                          const next = [...m5Entries];
                          next[idx] = {
                            ...next[idx],
                            entry_time: e.target.value,
                          };
                          edit(next, `已儲存交易紀錄 ${en.trade_id} 的修改`);
                        }}
                        className="bg-slate-950 border border-slate-700 rounded px-2 py-1 w-16 text-white"
                      />
                    </td>
                    <td className="py-1.5 px-1.5">{en.shares}</td>
                    <td
                      className={`py-1.5 px-1.5 font-bold ${
                        en.net_pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {en.net_pnl}
                    </td>
                    <td className="py-1.5 px-1.5">
                      <input
                        type="number"
                        step="0.5"
                        value={en.return_pct}
                        onChange={(e) => {
                          const next = [...m5Entries];
                          next[idx] = {
                            ...next[idx],
                            return_pct: Number(e.target.value),
                          };
                          edit(next, `已儲存交易紀錄 ${en.trade_id} 的修改`);
                        }}
                        className="bg-slate-950 border border-slate-700 rounded px-2 py-1 w-16 text-white"
                      />
                    </td>
                    <td className="py-1.5 px-1.5">
                      <input
                        type="number"
                        min="1"
                        max="10"
                        value={en.emotion_score}
                        onChange={(e) => {
                          const next = [...m5Entries];
                          next[idx] = {
                            ...next[idx],
                            emotion_score: Number(e.target.value),
                          };
                          edit(next, `已儲存交易紀錄 ${en.trade_id} 的修改`);
                        }}
                        className="bg-slate-950 border border-slate-700 rounded px-2 py-1 w-14 text-amber-300"
                      />
                    </td>
                    <td className="py-1.5 px-1.5">{en.high_5d_after_exit}</td>
                    <td className="py-1.5 px-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          if (
                            m5Source === 'mine' &&
                            !window.confirm(`確定刪除交易紀錄 ${en.trade_id}（${en.symbol}）？刪除後沒辦法復原。`)
                          ) {
                            window.TA.toast?.('ℹ️ 已取消，交易紀錄沒有變動');
                            return;
                          }
                          edit(
                            m5Entries.filter((_, i) => i !== idx),
                            `已刪除交易紀錄 ${en.trade_id}（${en.symbol}）`,
                            true,
                          );
                        }}
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
        </div>

        {m5Data && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <div className="text-xs text-slate-400">
                  交易勝率 (Win Rate)
                  <window.TA.Tip text="賺錢的交易筆數 ÷ 總交易筆數。" />
                </div>
                <div className="text-lg font-bold font-mono text-sky-300 mt-1">
                  {m5Data.statistics?.win_rate_pct}%
                </div>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <div className="text-xs text-slate-400">
                  賺賠比 (Payoff Ratio)
                  <window.TA.Tip text="平均每筆獲利 ÷ 平均每筆虧損。賺賠比 2＝賺的時候平均是賠的時候的 2 倍；勝率不到一半，只要賺賠比夠高也能獲利。" />
                </div>
                <div className="text-lg font-bold font-mono text-amber-300 mt-1">
                  {m5Data.statistics?.payoff_ratio}
                </div>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <div className="text-xs text-slate-400">
                  單筆期望值 (Expectancy)
                  <window.TA.Tip text="平均每筆交易的淨損益（元）。大於 0 代表長期平均下來每筆是賺的。" />
                </div>
                <div
                  className={`text-lg font-bold font-mono mt-1 ${
                    m5Data.statistics?.expectancy >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {m5Data.statistics?.expectancy}
                </div>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <div className="text-xs text-slate-400">
                  出場後 5 日賣飛率
                  <window.TA.Tip text="獲利出場後 5 個交易日內，最高價又比出場價高 5% 以上的比例（用真實日 K 判斷）。偏高代表常常賣太早。" />
                </div>
                <div className="text-lg font-bold font-mono text-rose-400 mt-1">
                  {m5Data.statistics?.sold_too_early_ratio_pct}%
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-2.5">
                <div className="text-xs font-semibold text-rose-300">
                  偵測到之壞習慣與具體交割編號證據
                  <window.TA.Tip text="處置效應＝賠錢單抱著不停損（虧損 ≥10% 且持有 ≥5 天，或情緒分數 ≥8）；報復性交易＝虧損後下一筆部位放大 2 倍以上想翻本。後面的編號就是證據交易。" />
                </div>
                {(m5Data.detected_biases || []).map((b) => (
                  <div
                    key={b.bias_name ?? b.bias_type}
                    className="bg-rose-950/25 border border-rose-500/30 rounded-lg p-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-rose-300">
                        {b.bias_name ?? b.bias_type}
                      </span>
                      <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-rose-500/20 text-rose-200">
                        證據: {(b.evidence_trade_ids || b.evidence_trades || []).join(', ')}
                      </span>
                    </div>
                    <p className="text-xs text-slate-300 mt-1.5">{b.description}</p>
                  </div>
                ))}
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-2.5">
                <div className="text-xs font-semibold text-emerald-300">
                  3 條量化改善規則
                  <window.TA.Tip text="每條規則都要有明確數字門檻與動作，才能真的執行。用你的交易紀錄產生後，會同步成下單前必須勾選的清單。" />
                </div>
                <div
                  className={`text-[11px] ${
                    m5Data.rules_source?.startsWith('AI（') ? 'text-violet-300' : 'text-amber-300'
                  }`}
                >
                  {m5Data.rules_source?.startsWith('AI（') ? '' : '⚠️'} 來源：{m5Data.rules_source}
                </div>
                {(m5Data.personalized_3_rules || []).map((rule) => (
                  <div
                    key={rule.rule_number ?? rule.rule_name}
                    className="bg-emerald-950/20 border border-emerald-500/30 rounded-lg p-3 text-xs text-emerald-100 leading-relaxed space-y-1"
                  >
                    <div className="font-bold text-emerald-300">
                      規則 {rule.rule_number}：{rule.rule_name}
                      {rule.source && (
                        <span
                          className={`ml-2 px-1.5 py-0.5 rounded text-[10px] font-normal ${
                            rule.source === 'AI' ? 'bg-sky-500/20 text-sky-200' : 'bg-slate-700/60 text-slate-300'
                          }`}
                        >
                          {rule.source}
                        </span>
                      )}
                      <span className="ml-2 text-[10px] font-normal text-emerald-400/80">
                        針對：{rule.target_bias}
                      </span>
                      {rule.evidence && (
                        <span className="block text-[10px] font-normal text-emerald-400/70">
                          依據：{rule.evidence}
                        </span>
                      )}
                      {rule.formula && (
                        <span className="block text-[10px] font-normal text-sky-300/80">算法：{rule.formula}</span>
                      )}
                    </div>
                    <div>
                      <span className="text-emerald-400">當</span> {rule.condition}
                    </div>
                    <div>
                      <span className="text-emerald-400">就</span> {rule.action}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
        {m5Data && (
          <window.TA.AiExplain
            module="mod5"
            provenance={[
              JSON.stringify(m5Entries) === JSON.stringify(window.TA.DEFAULT_JOURNAL)
                ? { text: '交易紀錄目前是內建範例，不是你的真實交易', sample: true }
                : { text: '交易紀錄來自你輸入的資料' },
            ]}
            data={m5Data}
          />
        )}
      </div>
    );
  }

  window.TA = Object.assign(window.TA || {}, { Mod5Panel });
})();
