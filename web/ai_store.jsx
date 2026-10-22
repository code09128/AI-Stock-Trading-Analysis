// 全系統共用的 AI 設定與「AI 解讀」元件。設定存在瀏覽器 localStorage，每次呼叫時帶給本機伺服器，伺服器不保存金鑰。
(() => {
  const { useState, useEffect } = React;
  const { readLS, writeLS } = window.TA;

  const LS_AI = 'tw_us_ai_v1';
  const SCOPE_LABELS = {
    mod1: '技術分析（買賣決策由 AI 產出，仍需通過防幻覺稽核）',
    mod2: '新聞判斷（AI 解讀）',
    mod3: '策略回測（AI 解讀）',
    mod4: '組合風控（AI 解讀）',
    mod5: '交易檢討（AI 解讀）',
    stock: '個股／ETF 資訊（AI 解讀）',
  };
  const EMPTY = {
    profiles: [],
    activeId: null,
    scope: Object.fromEntries(Object.keys(SCOPE_LABELS).map((k) => [k, true])),
  };

  const loadAI = () => {
    const v = readLS(LS_AI, EMPTY);
    return { ...EMPTY, ...v, scope: { ...EMPTY.scope, ...(v.scope || {}) } };
  };
  const saveAI = (v) => {
    writeLS(LS_AI, v);
    window.dispatchEvent(new Event('ai-settings-changed'));
  };
  const activeProfile = (cfg = loadAI()) => cfg.profiles.find((p) => p.id === cfg.activeId) || null;
  const cleanProfile = (p) =>
    p && { type: p.type, base_url: p.base_url, model: p.model, api_key: p.api_key, name: p.name };

  // 任何元件都可以訂閱 AI 設定變動
  const useAISettings = () => {
    const [cfg, setCfg] = useState(loadAI);
    useEffect(() => {
      const on = () => setCfg(loadAI());
      window.addEventListener('ai-settings-changed', on);
      return () => window.removeEventListener('ai-settings-changed', on);
    }, []);
    return cfg;
  };

  // ---------- AI 用量與費用（只存在這個瀏覽器）----------
  // 後端把每次請求呼叫 AI 的 tokens 附在回應的 ai_usage；這裡攔截所有 /api/ 回應記下來，
  // 費用＝輸入 tokens × 輸入單價 ＋ 輸出 tokens × 輸出單價（單價：美元／每百萬 tokens，在「設定」填）。
  const LS_USAGE = 'tw_us_ai_usage_v1';
  const LS_PRICES = 'tw_us_ai_prices_v1';
  const USAGE_MAX = 2000;
  const ENDPOINT_LABELS = {
    '/api/mod1/analyze': '技術分析 AI 決策',
    '/api/mod2/news': '新聞 AI 情緒判斷',
    '/api/mod5/coach': '交易檢討 AI 規則',
    '/api/ai/explain': 'AI 解讀',
    '/api/ai/test': '測試連線',
  };
  const loadUsage = () => readLS(LS_USAGE, []);
  const loadPrices = () => readLS(LS_PRICES, {});
  const savePrices = (p) => {
    writeLS(LS_PRICES, p);
    window.dispatchEvent(new Event('ai-usage-changed'));
  };
  const clearUsage = () => {
    writeLS(LS_USAGE, []);
    window.dispatchEvent(new Event('ai-usage-changed'));
  };
  const recordUsage = (items, extra = {}) => {
    if (!items?.length) return;
    const next = [
      ...loadUsage(),
      ...items.map((u) => ({ ...u, label: ENDPOINT_LABELS[u.endpoint] || u.endpoint, ...extra })),
    ].slice(-USAGE_MAX);
    writeLS(LS_USAGE, next);
    window.dispatchEvent(new Event('ai-usage-changed'));
  };
  // 單筆估算費用（美元）；本地模型沒填單價視為 0；雲端模型沒填單價或沒回報 tokens 時回 null
  const usageCost = (u, prices = loadPrices()) => {
    const p = prices[u.model];
    if (!p && u.local) return 0;
    if (!p || u.input_tokens == null || u.output_tokens == null) return null;
    return (
      ((u.input_tokens || 0) * (Number(p.in) || 0) +
        (u.output_tokens || 0) * (Number(p.out) || 0)) /
      1e6
    );
  };
  const useAIUsage = () => {
    const [st, setSt] = useState(() => ({ usage: loadUsage(), prices: loadPrices() }));
    useEffect(() => {
      const on = () => setSt({ usage: loadUsage(), prices: loadPrices() });
      window.addEventListener('ai-usage-changed', on);
      window.addEventListener('storage', on);
      return () => {
        window.removeEventListener('ai-usage-changed', on);
        window.removeEventListener('storage', on);
      };
    }, []);
    return st;
  };
  // 全站攔截一次：任何 /api/ 回應帶 ai_usage 就記錄（用 clone，不影響原本讀取回應）
  if (!window.__aiUsageHooked) {
    window.__aiUsageHooked = true;
    const origFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const res = await origFetch(input, init);
      const url = typeof input === 'string' ? input : input?.url || '';
      if (url.startsWith('/api/') || url.includes('/api/')) {
        res
          .clone()
          .json()
          .then((d) => d && Array.isArray(d.ai_usage) && recordUsage(d.ai_usage))
          .catch(() => {});
      }
      return res;
    };
  }

  async function callAI(action, body) {
    const res = await fetch(`/api/ai/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.json();
  }

  // AI 解讀任務放在全站共用的 store：換頁時元件會卸載，但請求會繼續跑、結果保留，回到該頁就看得到。
  // key＝模組（基本資料另外加上代號）；完成時如果那一頁沒開著，就用全站提示通知。
  const MODULE_NAMES = {
    mod1: '技術分析',
    mod2: '新聞判斷',
    mod3: '策略回測',
    mod4: '組合風控',
    mod5: '交易檢討',
    stock: '基本資料',
  };
  const aiTasks = {}; // key -> { busy, out, question, doneAt }
  const mounted = {}; // key -> 目前顯示中的元件數
  const emitTasks = () => window.dispatchEvent(new Event('ai-tasks-changed'));
  const getTask = (key) => aiTasks[key] || { busy: false, out: null, question: '' };
  const setTask = (key, patch) => {
    aiTasks[key] = { ...getTask(key), ...patch };
    emitTasks();
  };
  const startExplain = async (key, label, body) => {
    if (getTask(key).busy) return;
    setTask(key, { busy: true, out: null });
    let out;
    try {
      out = await callAI('explain', body);
    } catch (e) {
      out = { error: e.message };
    }
    setTask(key, {
      busy: false,
      out,
      doneAt: new Date().toLocaleTimeString('zh-TW', { hour12: false }),
    });
    if (!mounted[key]) {
      window.TA.toast?.(
        out?.error
          ? `⚠️ ${label} 的 AI 解讀失敗：${out.error}`
          : `🤖 ${label} 的 AI 解讀完成，回到該頁查看`,
      );
    }
  };
  const useAiTask = (key) => {
    const [task, setLocal] = useState(() => getTask(key));
    useEffect(() => {
      mounted[key] = (mounted[key] || 0) + 1;
      const on = () => setLocal(getTask(key));
      on();
      window.addEventListener('ai-tasks-changed', on);
      return () => {
        mounted[key] -= 1;
        window.removeEventListener('ai-tasks-changed', on);
      };
    }, [key]);
    return task;
  };

  // 每個分頁底部的「AI 解讀」區塊：把系統算好的資料交給 AI 用白話解釋，並檢查 AI 回答中的數字是否真的來自資料
  function AiExplain({ module, data, title = '🤖 AI 解讀', provenance = [] }) {
    const cfg = useAISettings();
    const [pid, setPid] = useState('');
    const code = module === 'stock' ? data?.code || data?.symbol || '' : '';
    const key = code ? `${module}:${code}` : module;
    const task = useAiTask(key);
    const { busy, out, question } = task;
    const setQuestion = (q) => setTask(key, { question: q });
    if (cfg.scope[module] === false) return null;
    const profile = cfg.profiles.find((p) => p.id === (pid || cfg.activeId)) || null;
    const label = `${MODULE_NAMES[module] || module}${code ? ` ${code}` : ''}`;
    const run = () =>
      startExplain(key, label, {
        module,
        data: provenance.length ? { ...data, 資料來源說明: provenance.map((x) => x.text) } : data,
        question,
        profile: cleanProfile(profile),
      });
    return (
      <div className="rounded-2xl border border-violet-500/30 bg-violet-500/5 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-bold text-violet-200">{title}</div>
          <div className="flex items-center gap-2 text-xs">
            {cfg.profiles.length > 0 && (
              <select
                value={pid || cfg.activeId || ''}
                onChange={(e) => setPid(e.target.value)}
                aria-label="選擇 AI 連線"
                className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-200"
              >
                {cfg.profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}（{p.model || '未選模型'}）
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              onClick={() => window.TA.goTab?.('settings')}
              className="text-slate-400 hover:text-white cursor-pointer"
            >
              ⚙️ 設定
            </button>
          </div>
        </div>
        {!profile ? (
          <div className="text-xs text-slate-400">
            尚未設定 AI 連線。系統不用 AI 也能運作；若想要白話解讀，請到
            <button
              type="button"
              onClick={() => window.TA.goTab?.('settings')}
              className="mx-1 text-violet-300 underline cursor-pointer"
            >
              設定
            </button>
            新增雲端 AI（Gemini／OpenAI／Claude）或本地模型（Ollama、LM Studio）。
          </div>
        ) : (
          <>
            <div className="flex gap-2">
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !busy && run()}
                placeholder="（選填）想問 AI 的問題，例如：現在適合分批買進嗎？"
                aria-label="給 AI 的問題"
                className="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white"
              />
              <button
                type="button"
                onClick={run}
                disabled={busy}
                className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
              >
                {busy ? '思考中…' : 'AI 解讀目前結果'}
              </button>
            </div>
            {busy && (
              <div className="text-[11px] text-violet-300">
                AI 正在處理中，可以先切到其他頁面，完成後會通知你，結果會保留在這裡。
              </div>
            )}
            <div className="text-[11px] text-slate-500">
              只會把這一頁已計算好的資料送給「{profile.name}」；AI 只負責解釋，不負責算數字。
            </div>
          </>
        )}
        {provenance.length > 0 && (
          <ul className="text-[11px] space-y-0.5">
            {provenance.map((x) => (
              <li key={x.text} className={x.sample ? 'text-amber-300' : 'text-emerald-300'}>
                {x.sample ? '⚠️' : '✅'} {x.text}
              </li>
            ))}
          </ul>
        )}
        {out?.error && <div className="text-xs text-rose-300">⚠️ {out.error}</div>}
        {out?.answer && (
          <div className="space-y-2">
            <div className="whitespace-pre-wrap text-xs leading-relaxed text-slate-200 bg-slate-950/70 border border-slate-800 rounded-lg p-3">
              {out.answer}
            </div>
            {out.unverified_numbers?.length > 0 && (
              <div className="text-[11px] text-amber-300">
                ⚠️ 這些數字在系統提供的資料裡找不到，可能是 AI 自行推算或編造，請自行核對：
                {out.unverified_numbers.join('、')}
              </div>
            )}
            <div className="text-[10px] text-slate-500">
              {out.model}・{out.latency_ms} ms・{task.doneAt ? `${task.doneAt} 完成・` : ''}
              {(out.ai_usage || []).map((u) => {
                if (!u.reported) return '供應商未回報用量・';
                const c = usageCost(u);
                const fee =
                  u.local && !c
                    ? '本地模型（免費）'
                    : c == null
                      ? '未設定單價'
                      : `約 US$${c.toFixed(4)}`;
                return `${u.input_tokens ?? '?'} 入／${u.output_tokens ?? '?'} 出 tokens・${fee}・`;
              })}
              AI 內容僅供參考，不構成投資建議
            </div>
          </div>
        )}
      </div>
    );
  }

  window.TA = Object.assign(window.TA || {}, {
    loadAI,
    saveAI,
    activeProfile,
    cleanProfile,
    useAISettings,
    callAI,
    useAIUsage,
    usageCost,
    savePrices,
    clearUsage,
    LS_USAGE,
    LS_PRICES,
    AiExplain,
    SCOPE_LABELS,
  });
})();
