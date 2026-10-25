// 設定頁的監控區塊：AI 用量與估算費用、操作紀錄（瀏覽器與伺服器）
(() => {
  const { useState, useEffect } = React;

  // AI 用量與費用：每次呼叫的 tokens（來自供應商回報）× 你填的單價（美元／每百萬 tokens）
  function UsagePanel({ cfg }) {
    const { useAIUsage, usageCost, savePrices, clearUsage } = window.TA;
    const { usage, prices } = useAIUsage();
    const [usdTwd, setUsdTwd] = useState(null);
    const [confirmClear, setConfirmClear] = useState(false);
    useEffect(() => {
      fetch('/api/fx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currencies: ['USD'] }),
      })
        .then((r) => r.json())
        .then((d) => setUsdTwd(d.rates?.USD?.rate || null))
        .catch(() => {});
    }, []);

    const today = new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD（本機時間）
    const month = today.slice(0, 7);
    const sum = (list) => {
      let cost = 0;
      let unpriced = 0;
      for (const u of list) {
        const c = usageCost(u, prices);
        if (c == null) unpriced += 1;
        else cost += c;
      }
      return {
        calls: list.length,
        input: list.reduce((a, u) => a + (u.input_tokens || 0), 0),
        output: list.reduce((a, u) => a + (u.output_tokens || 0), 0),
        cost,
        unpriced,
      };
    };
    const periods = [
      ['今天', usage.filter((u) => String(u.time).startsWith(today))],
      ['本月', usage.filter((u) => String(u.time).startsWith(month))],
      ['全部紀錄', usage],
    ].map(([label, list]) => [label, sum(list)]);
    // 模型清單：目前 AI 連線用的模型＋用量紀錄裡出現過的模型（連線刪掉後舊紀錄仍要靠單價算費用）
    const current = new Map(
      cfg.profiles.filter((p) => p.model).map((p) => [p.model, p.type === 'openai_compatible']),
    );
    const stats = new Map();
    for (const u of usage) {
      const st = stats.get(u.model) || {
        calls: 0,
        input: 0,
        output: 0,
        cost: 0,
        unpriced: 0,
        reported: 0,
        last: '',
        local: !!u.local,
      };
      st.calls += 1;
      st.input += u.input_tokens || 0;
      st.output += u.output_tokens || 0;
      if (typeof u.cost_usd === 'number') st.reported += 1;
      const c = usageCost(u, prices);
      if (c == null) st.unpriced += 1;
      else st.cost += c;
      if (String(u.time) > st.last) st.last = String(u.time);
      stats.set(u.model, st);
    }
    const byLast = (a, b) => (stats.get(b)?.last || '').localeCompare(stats.get(a)?.last || '');
    const currentModels = [...current.keys()].sort(byLast);
    const historyModels = [...stats.keys()].filter((m) => !current.has(m)).sort(byLast);
    const money = (usd) =>
      `US$${usd.toFixed(usd < 1 ? 4 : 2)}${usdTwd ? `（約 NT$${(usd * usdTwd).toFixed(usd * usdTwd < 10 ? 2 : 0)}）` : ''}`;
    const setPrice = (model, field, value) =>
      savePrices({
        ...prices,
        [model]: { ...(prices[model] || {}), [field]: value === '' ? '' : Number(value) },
      });

    const priceInput = (model, field, local) => (
      <input
        type="number"
        min="0"
        step="0.01"
        aria-label={`${model} ${field === 'in' ? '輸入' : '輸出'}單價`}
        value={prices[model]?.[field] ?? ''}
        placeholder={local ? '0' : '未設定'}
        onChange={(e) => setPrice(model, field, e.target.value)}
        className="w-24 bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono text-white"
      />
    );
    // 一個模型一列：用量統計＋單價；付費模型沒填單價、又有沒算到費用的紀錄時特別提醒。
    // 用一般函式呼叫（不是 <ModelRow />），否則每次重繪都是新元件，輸入單價時游標會跳掉
    const modelRow = (model, local, st) => {
      const allReported = st && st.reported === st.calls;
      return (
        <div key={model} className="rounded-lg bg-slate-950/50 px-2 py-1.5 text-xs space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-slate-200 min-w-[12rem] break-all">{model}</span>
            {local && <span className="text-[10px] text-emerald-400">本地（預設免費）</span>}
            {allReported && <span className="text-[10px] text-sky-300">供應商回報實際費用，不必填單價</span>}
            {!allReported && (
              <>
                <span className="flex items-center gap-1 text-slate-400">
                  輸入 {priceInput(model, 'in', local)}
                </span>
                <span className="flex items-center gap-1 text-slate-400">
                  輸出 {priceInput(model, 'out', local)}
                </span>
              </>
            )}
          </div>
          <div className="flex flex-wrap gap-x-3 text-[11px] text-slate-400 font-mono">
            {st ? (
              <>
                <span>
                  {st.calls} 次・入 {st.input.toLocaleString()}／出 {st.output.toLocaleString()}
                </span>
                <span className="text-emerald-300">{money(st.cost)}</span>
                <span>最後使用 {st.last.slice(0, 10)}</span>
              </>
            ) : (
              <span>還沒有呼叫紀錄</span>
            )}
            {st?.unpriced > 0 && (
              <span className="text-amber-300 font-sans">⚠️ 未設定單價，{st.unpriced} 次費用沒有算進去</span>
            )}
          </div>
        </div>
      );
    };

    return (
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4">
        <div>
          <h3 className="font-bold text-white">AI 用量與費用（估算）</h3>
          <p className="text-xs text-slate-400 mt-1">
            每次呼叫 AI 用掉的 tokens 由 AI 供應商回報，記在這個瀏覽器；費用＝輸入 tokens × 輸入單價
            ＋ 輸出 tokens × 輸出單價。單價請依供應商官網填寫（美元／每百萬
            tokens），本地模型預設免費。這是估算，實際以供應商帳單為準。
          </p>
        </div>

        <div className="grid sm:grid-cols-3 gap-2">
          {periods.map(([label, t]) => (
            <div key={label} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
              <div className="text-[11px] text-slate-400">{label}</div>
              <div className="text-lg font-bold font-mono text-emerald-300">{money(t.cost)}</div>
              <div className="text-[11px] text-slate-400 font-mono">
                {t.calls} 次・入 {t.input.toLocaleString()}／出 {t.output.toLocaleString()} tokens
              </div>
              {t.unpriced > 0 && (
                <div className="text-[11px] text-amber-300">{t.unpriced} 次因未設定單價未計入</div>
              )}
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <div className="text-xs text-slate-300 font-semibold">
            各模型用量與單價（美元／每百萬 tokens）
            <window.TA.Tip text="上面是目前 AI 連線用的模型；下面收合的是只在用量紀錄出現過的模型（連線已刪除或換掉），保留它們的單價才算得出「本月」「全部紀錄」的費用。OpenRouter 會回報每次實際花費，不必填單價；Gemini、OpenAI、Claude 等付費模型請到官網查單價填入。" />
          </div>
          {currentModels.length + historyModels.length === 0 ? (
            <div className="text-xs text-slate-500">還沒有 AI 連線或呼叫紀錄。</div>
          ) : (
            <>
              <div className="text-[11px] text-slate-400">目前連線的模型（{currentModels.length}）</div>
              {currentModels.length === 0 ? (
                <div className="text-xs text-slate-500">目前沒有 AI 連線。</div>
              ) : (
                <div className="space-y-1.5">
                  {currentModels.map((m) => modelRow(m, current.get(m), stats.get(m)))}
                </div>
              )}
              {historyModels.length > 0 && (
                <details className="rounded-lg border border-slate-800 px-3 py-2">
                  <summary className="cursor-pointer text-[11px] text-slate-400 select-none">
                    只在歷史紀錄出現的模型（{historyModels.length}）— 連線已刪除或換掉，保留單價供舊紀錄計費
                  </summary>
                  <div className="space-y-1.5 mt-2">
                    {historyModels.map((m) => modelRow(m, stats.get(m).local, stats.get(m)))}
                  </div>
                </details>
              )}
            </>
          )}
        </div>

        {usage.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-slate-300 font-semibold">最近 20 次呼叫</span>
              <button
                type="button"
                onClick={() => {
                  if (!confirmClear) return setConfirmClear(true);
                  clearUsage();
                  setConfirmClear(false);
                }}
                className="text-[11px] px-2 py-1 rounded bg-rose-950/50 border border-rose-800/60 text-rose-200 cursor-pointer"
              >
                {confirmClear ? '再點一次確認清除紀錄' : '清除用量紀錄'}
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px] font-mono">
                <thead className="text-slate-500">
                  <tr>
                    <th className="text-left font-normal py-1">時間</th>
                    <th className="text-left font-normal">功能</th>
                    <th className="text-left font-normal">模型</th>
                    <th className="text-right font-normal">輸入</th>
                    <th className="text-right font-normal">輸出</th>
                    <th className="text-right font-normal">估算費用</th>
                  </tr>
                </thead>
                <tbody className="text-slate-300">
                  {usage
                    .slice(-20)
                    .reverse()
                    .map((u, i) => {
                      const c = usageCost(u, prices);
                      return (
                        <tr key={`${u.time}-${i}`} className="border-t border-slate-800/60">
                          <td className="py-1 whitespace-nowrap">{String(u.time).slice(5, 16)}</td>
                          <td className="font-sans">{u.label}</td>
                          <td className="truncate max-w-[10rem]">{u.model}</td>
                          <td className="text-right">{u.input_tokens?.toLocaleString() ?? '—'}</td>
                          <td className="text-right">{u.output_tokens?.toLocaleString() ?? '—'}</td>
                          <td className="text-right">
                            {!u.reported
                              ? '未回報'
                              : c == null
                                ? '未設定單價'
                                : `US$${c.toFixed(4)}`}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  }

  // 操作紀錄：本機（瀏覽器）與伺服器檔案 logs/activity-YYYYMMDD.jsonl
  function ActivityPanel() {
    const local = window.TA.useActivityLog();
    const [src, setSrc] = useState('local');
    const [onlyErr, setOnlyErr] = useState(false);
    const [server, setServer] = useState(null);
    const [confirmClear, setConfirmClear] = useState(false);
    useEffect(() => {
      if (src !== 'server') return;
      fetch('/api/log/recent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 300, errors_only: onlyErr }),
      })
        .then((r) => r.json())
        .then((d) => setServer(d.events || []))
        .catch(() => setServer([]));
    }, [src, onlyErr]);
    const rows = (src === 'local' ? [...local].reverse() : server || []).filter(
      (e) => !onlyErr || e.level === 'error',
    );
    const describe = (e) =>
      e.type === 'click'
        ? `點擊「${e.label}」${e.symbol ? `（${e.symbol}）` : ''}${e.checked !== undefined ? `→ ${e.checked ? '勾選' : '取消'}` : ''}`
        : e.type === 'select'
          ? `選擇 ${e.label}：${e.value}`
          : e.type === 'page'
            ? `切換到 ${e.to}`
            : e.type === 'api'
              ? `${e.path}${e.symbol ? ` ${e.symbol}` : ''} → ${e.status ?? ''}${e.ms != null ? ` ${e.ms}ms` : ''}${
                  e.error ? `：${e.error}` : ''
                }${e.ai_tokens ? `（AI tokens ${JSON.stringify(e.ai_tokens)}）` : ''}`
              : e.type === 'notice'
                ? `提示：${e.message}`
                : e.type === 'error'
                  ? `錯誤：${e.message} ${e.source || ''}`
                  : e.type === 'open'
                    ? `開啟系統（${e.screen}）`
                    : JSON.stringify(e);
    const download = () => {
      const blob = new Blob([local.map((e) => JSON.stringify(e)).join('\n')], {
        type: 'application/json',
      });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `操作紀錄_${new Date().toISOString().slice(0, 10)}.jsonl`;
      a.click();
    };
    return (
      <div
        className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-3"
        data-no-log
      >
        <div>
          <h3 className="font-bold text-white">操作紀錄</h3>
          <p className="text-xs text-slate-400 mt-1">
            記錄點擊、換頁、API
            呼叫結果（自動更新的只記失敗）、錯誤與畫面提示，不記錄任何輸入內容或金鑰。
            瀏覽器保留最近 3000 筆；同時寫到本機伺服器的{' '}
            <span className="font-mono">logs/activity-日期.jsonl</span>
            （保留 30 天，伺服器自己的 API 錯誤也在裡面），遇到問題時可以把檔案提供給開發者追查。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {[
            ['local', `這個瀏覽器（${local.length} 筆）`],
            ['server', '伺服器檔案'],
          ].map(([k, label]) => (
            <button
              type="button"
              key={k}
              onClick={() => setSrc(k)}
              className={`px-3 py-1.5 rounded-lg border cursor-pointer ${
                src === k
                  ? 'bg-sky-500/20 border-sky-400 text-white'
                  : 'border-slate-700 text-slate-300'
              }`}
            >
              {label}
            </button>
          ))}
          <label className="flex items-center gap-1 text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={onlyErr}
              onChange={(e) => setOnlyErr(e.target.checked)}
            />
            只看錯誤
          </label>
          <button
            type="button"
            onClick={download}
            className="ml-auto px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 cursor-pointer"
          >
            下載本機紀錄
          </button>
          <button
            type="button"
            onClick={() => {
              if (!confirmClear) return setConfirmClear(true);
              window.TA.clearActivity();
              setConfirmClear(false);
            }}
            className="px-3 py-1.5 rounded-lg bg-rose-950/50 border border-rose-800/60 text-rose-200 cursor-pointer"
          >
            {confirmClear ? '再點一次確認清除' : '清除本機紀錄'}
          </button>
        </div>
        <div className="max-h-80 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/60">
          {rows.length === 0 ? (
            <div className="text-xs text-slate-500 p-3">
              {src === 'server' && server === null ? '載入中…' : '沒有紀錄'}
            </div>
          ) : (
            <table className="w-full text-[11px]">
              <tbody>
                {rows.slice(0, 300).map((e, i) => (
                  <tr key={`${e.t}-${i}`} className="border-t border-slate-800/60 align-top">
                    <td className="px-2 py-1 font-mono text-slate-500 whitespace-nowrap">
                      {String(e.t).slice(5, 19).replace('T', ' ')}
                    </td>
                    <td className="px-1 py-1 text-slate-500 whitespace-nowrap">
                      {e.src === 'server' ? '伺服器' : e.page}
                    </td>
                    <td
                      className={`px-2 py-1 ${e.level === 'error' ? 'text-rose-300' : 'text-slate-300'}`}
                    >
                      {describe(e)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    );
  }

  window.TA = Object.assign(window.TA || {}, { UsagePanel, ActivityPanel });
})();
