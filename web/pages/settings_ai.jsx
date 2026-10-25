// 設定頁：AI 連線的編輯表單與本機模型偵測（連線清單與作用範圍在 settings.jsx）
(() => {
  const { useState, useEffect } = React;
  const { callAI, cleanProfile } = window.TA;

  const TYPES = {
    gemini: { label: 'Google Gemini（雲端）', needKey: true, base: '' },
    openai: { label: 'OpenAI（雲端）', needKey: true, base: '' },
    anthropic: { label: 'Anthropic Claude（雲端）', needKey: true, base: '' },
    openrouter: { label: 'OpenRouter（雲端，多家模型、含免費模型）', needKey: true, base: '' },
    openai_compatible: {
      label: '本地／自架（OpenAI 相容：Ollama、LM Studio、llama.cpp、vLLM…）',
      needKey: false,
      base: 'http://127.0.0.1:11434/v1',
    },
  };
  const LOCAL_PRESETS = [
    ['Ollama', 'http://127.0.0.1:11434/v1'],
    ['LM Studio', 'http://127.0.0.1:1234/v1'],
    ['llama.cpp server', 'http://127.0.0.1:8080/v1'],
  ];
  const newProfile = (type = 'openai_compatible') => ({
    id: `p${Date.now()}`,
    name: type === 'openai_compatible' ? '本地模型' : TYPES[type].label.split('（')[0],
    type,
    base_url: TYPES[type].base,
    model: '',
    api_key: '',
  });

  function ProfileEditor({ p, onChange, onSave, onCancel }) {
    const [models, setModels] = useState([]);
    const [pricing, setPricing] = useState({});
    const [freeOnly, setFreeOnly] = useState(false);
    const [status, setStatus] = useState(null);
    const [busy, setBusy] = useState('');
    const t = TYPES[p.type];
    const set = (k, v) => onChange({ ...p, [k]: v });
    const isFree = (m) => pricing[m] && !pricing[m].in && !pricing[m].out;
    const shown = freeOnly ? models.filter(isFree) : models;
    // 選 OpenRouter 模型時，若「用量與費用」還沒填單價，就用官方清單的單價自動帶入
    const pickModel = (m) => {
      set('model', m);
      const pr = pricing[m];
      const { loadPrices, savePrices } = window.TA;
      if (pr && !loadPrices()[m]) savePrices({ ...loadPrices(), [m]: { in: pr.in, out: pr.out } });
    };
    const run = async (action) => {
      setBusy(action);
      setStatus(null);
      try {
        const r = await callAI(action, { profile: cleanProfile(p) });
        if (action === 'models') {
          if (r.error) setStatus({ ok: false, msg: r.error });
          else {
            setModels(r.models || []);
            setPricing(r.pricing || {});
            const free = Object.values(r.pricing || {}).filter((x) => !x.in && !x.out).length;
            setStatus({
              ok: true,
              msg: `取得 ${r.models?.length || 0} 個模型${r.pricing ? `（其中 ${free} 個免費）` : ''}`,
            });
            if (!p.model && r.models?.length) set('model', r.models[0]);
          }
        } else {
          setStatus(
            r.ok
              ? { ok: true, msg: `連線成功（${r.latency_ms} ms），模型回覆：${r.sample}` }
              : { ok: false, msg: r.error },
          );
        }
      } catch (e) {
        setStatus({ ok: false, msg: e.message });
      } finally {
        setBusy('');
      }
    };
    const field =
      'w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white';
    return (
      <div className="rounded-xl border border-sky-500/40 bg-slate-950/60 p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="text-xs text-slate-400 space-y-1">
            類型
            <select
              value={p.type}
              onChange={(e) => {
                const type = e.target.value;
                onChange({ ...p, type, base_url: TYPES[type].base, model: '' });
                setModels([]);
              }}
              className={field}
            >
              {Object.entries(TYPES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-400 space-y-1">
            顯示名稱
            <input value={p.name} onChange={(e) => set('name', e.target.value)} className={field} />
          </label>
          {p.type === 'openrouter' && (
            <div className="md:col-span-2 text-[11px] text-slate-400 leading-relaxed rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2">
              到 openrouter.ai 登入 → Keys 建立金鑰（以 sk-or-
              開頭）貼到下方。模型名稱格式為「廠商/模型」，例如{' '}
              <span className="mono text-sky-300">google/gemini-2.5-flash</span>；名稱結尾是{' '}
              <span className="mono text-emerald-300">:free</span>{' '}
              的是免費模型（有每日次數限制，且提供者可能會用輸入內容做訓練）。每次呼叫的實際花費由
              OpenRouter 回報，會直接記到「AI 用量與費用」。
            </div>
          )}
          <label className="text-xs text-slate-400 space-y-1 md:col-span-2">
            {p.type === 'openai_compatible'
              ? '服務網址（必填）'
              : '服務網址（選填，留空用官方；可填代理網址）'}
            <input
              value={p.base_url}
              onChange={(e) => set('base_url', e.target.value)}
              placeholder={TYPES[p.type].base || '官方預設'}
              className={`${field} mono`}
            />
            {p.type === 'openai_compatible' && (
              <span className="flex gap-2 pt-1">
                {LOCAL_PRESETS.map(([n, u]) => (
                  <button
                    type="button"
                    key={n}
                    onClick={() => set('base_url', u)}
                    className="px-2 py-0.5 rounded bg-slate-800 text-sky-300 hover:bg-slate-700 cursor-pointer"
                  >
                    {n}
                  </button>
                ))}
              </span>
            )}
          </label>
          <label className="text-xs text-slate-400 space-y-1">
            API Key{t.needKey ? '' : '（本地通常不用）'}
            <input
              type="password"
              value={p.api_key}
              onChange={(e) => set('api_key', e.target.value)}
              autoComplete="off"
              placeholder={t.needKey ? '貼上你的金鑰' : '留空'}
              className={`${field} mono`}
            />
          </label>
          <label className="text-xs text-slate-400 space-y-1">
            模型名稱
            <input
              value={p.model}
              onChange={(e) => set('model', e.target.value)}
              list={`models-${p.id}`}
              placeholder="按右側「取得模型清單」或手動輸入"
              className={`${field} mono`}
            />
            <datalist id={`models-${p.id}`}>
              {shown.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => run('models')}
            disabled={!!busy}
            className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-200 hover:bg-slate-700 cursor-pointer"
          >
            {busy === 'models' ? '取得中…' : '取得模型清單'}
          </button>
          <button
            type="button"
            onClick={() => run('test')}
            disabled={!!busy}
            className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-200 hover:bg-slate-700 cursor-pointer"
          >
            {busy === 'test' ? '測試中…' : '測試連線'}
          </button>
          <button
            type="button"
            onClick={onSave}
            className="px-4 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-semibold cursor-pointer"
          >
            儲存
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-slate-400 hover:text-white cursor-pointer"
          >
            取消
          </button>
        </div>
        {models.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
              <span>
                取得 {models.length} 個模型，點一下即可選用（目前：
                <span className="mono text-sky-300">{p.model || '未選'}</span>）
              </span>
              {Object.keys(pricing).length > 0 && (
                <label className="flex items-center gap-1 cursor-pointer text-emerald-300">
                  <input
                    type="checkbox"
                    checked={freeOnly}
                    onChange={(e) => setFreeOnly(e.target.checked)}
                  />
                  只顯示免費模型
                </label>
              )}
            </div>
            <div className="max-h-48 overflow-y-auto flex flex-wrap gap-1.5 rounded-lg border border-slate-800 bg-slate-950/50 p-2">
              {shown.map((m) => (
                <button
                  type="button"
                  key={m}
                  onClick={() => pickModel(m)}
                  title={
                    pricing[m]
                      ? isFree(m)
                        ? '免費'
                        : `每百萬 tokens：輸入 US$${pricing[m].in}／輸出 US$${pricing[m].out}`
                      : undefined
                  }
                  className={`px-2 py-1 rounded-md text-[11px] mono border cursor-pointer ${
                    p.model === m
                      ? 'bg-sky-500/25 border-sky-400 text-white'
                      : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-500'
                  }`}
                >
                  {m}
                  {isFree(m) && <span className="ml-1 text-emerald-400">免費</span>}
                </button>
              ))}
            </div>
          </div>
        )}
        {status && (
          <div className={`text-xs ${status.ok ? 'text-emerald-300' : 'text-rose-300'}`}>
            {status.ok ? '✅' : '⚠️'} {status.msg}
          </div>
        )}
      </div>
    );
  }

  // 偵測本機實際在跑的模型服務（Ollama / LM Studio / llama.cpp / vLLM），列出真正安裝的模型
  function LocalDetect({ cfg, save }) {
    const [rt, setRt] = useState(null);
    const [busy, setBusy] = useState(false);
    const detect = async () => {
      setBusy(true);
      try {
        const r = await callAI('detect', {});
        setRt(r.runtimes || []);
      } catch (_e) {
        setRt([]);
      } finally {
        setBusy(false);
      }
    };
    useEffect(() => {
      detect();
    }, []); // eslint-disable-line
    const use = (r, m) => {
      const exists = cfg.profiles.find(
        (p) => p.type === 'openai_compatible' && p.base_url === r.base_url && p.model === m.id,
      );
      if (exists) {
        save({ ...cfg, activeId: exists.id }, `已改用本機模型「${exists.name}」`);
        return;
      }
      const prof = {
        id: `p${Date.now()}`,
        name: `${r.runtime}・${m.id}`,
        type: 'openai_compatible',
        base_url: r.base_url,
        model: m.id,
        api_key: '',
      };
      save({ ...cfg, profiles: [...cfg.profiles, prof], activeId: prof.id }, `已新增並改用本機模型「${prof.name}」`);
    };
    return (
      <div
        className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-2"
        data-tour="settings-local"
      >
        <div className="flex items-center justify-between">
          <div className="text-sm font-bold text-emerald-200">本機偵測到的模型（真實掃描）</div>
          <button
            type="button"
            onClick={detect}
            disabled={busy}
            className="text-xs px-3 py-1 rounded-lg bg-slate-800 border border-slate-700 text-slate-200 hover:bg-slate-700 cursor-pointer"
          >
            {busy ? '掃描中…' : '重新掃描'}
          </button>
        </div>
        {rt === null && <div className="text-xs text-slate-400">掃描本機服務中…</div>}
        {rt?.map((r) => (
          <div key={r.runtime} className="text-xs">
            <div className="flex items-center gap-2">
              <span className={r.running ? 'text-emerald-400' : 'text-slate-600'}>●</span>
              <span className="font-semibold text-slate-200">{r.runtime}</span>
              <span className="mono text-slate-500">{r.base_url}</span>
              <span className="text-slate-400">
                {r.running ? `執行中，${r.models.length} 個模型` : '未偵測到（沒有在執行）'}
              </span>
            </div>
            {r.models.length > 0 && (
              <table className="w-full mt-1 mono text-[11px]">
                <tbody>
                  {r.models.map((m) => {
                    const active = cfg.profiles.find((p) => p.id === cfg.activeId);
                    const isActive =
                      active && active.base_url === r.base_url && active.model === m.id;
                    return (
                      <tr key={m.id} className="border-t border-slate-800/70">
                        <td className="py-1 text-white">{m.id}</td>
                        <td className="text-slate-400">{m.params || ''}</td>
                        <td className="text-slate-400">{m.quant || ''}</td>
                        <td className="text-slate-400">{m.size_gb ? `${m.size_gb} GB` : ''}</td>
                        <td className="text-right">
                          {isActive ? (
                            <span className="text-emerald-400">✅ 使用中</span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => use(r, m)}
                              className="px-2 py-0.5 rounded bg-sky-600 hover:bg-sky-500 text-white font-sans cursor-pointer"
                            >
                              新增並使用
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        ))}
        <p className="text-[10px] text-slate-500">
          掃描的是你這台電腦上的 Ollama（11434）、LM
          Studio（1234）、llama.cpp（8080）、vLLM（8000）。沒開的服務會顯示未偵測到。
        </p>
      </div>
    );
  }

  window.TA = Object.assign(window.TA || {}, {
    AI_TYPES: TYPES,
    newAIProfile: newProfile,
    ProfileEditor,
    LocalDetect,
  });
})();
