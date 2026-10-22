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

  async function callAI(action, body) {
    const res = await fetch(`/api/ai/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.json();
  }

  // 每個分頁底部的「AI 解讀」區塊：把系統算好的資料交給 AI 用白話解釋，並檢查 AI 回答中的數字是否真的來自資料
  function AiExplain({ module, data, title = '🤖 AI 解讀', provenance = [] }) {
    const cfg = useAISettings();
    const [pid, setPid] = useState('');
    const [question, setQuestion] = useState('');
    const [busy, setBusy] = useState(false);
    const [out, setOut] = useState(null);
    if (cfg.scope[module] === false) return null;
    const profile = cfg.profiles.find((p) => p.id === (pid || cfg.activeId)) || null;
    const run = async () => {
      setBusy(true);
      setOut(null);
      try {
        setOut(
          await callAI('explain', {
            module,
            data: provenance.length
              ? { ...data, 資料來源說明: provenance.map((x) => x.text) }
              : data,
            question,
            profile: cleanProfile(profile),
          }),
        );
      } catch (e) {
        setOut({ error: e.message });
      } finally {
        setBusy(false);
      }
    };
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
              {out.model}・{out.latency_ms} ms・AI 內容僅供參考，不構成投資建議
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
    AiExplain,
    SCOPE_LABELS,
  });
})();
