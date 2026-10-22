// 設定頁：AI 連線（雲端／本地，全系統共用）、AI 作用範圍、資料管理
(() => {
  const { useState, useEffect } = React;
  const { useAISettings, saveAI, callAI, cleanProfile, SCOPE_LABELS } = window.TA;

  const TYPES = {
    gemini: { label: 'Google Gemini（雲端）', needKey: true, base: '' },
    openai: { label: 'OpenAI（雲端）', needKey: true, base: '' },
    anthropic: { label: 'Anthropic Claude（雲端）', needKey: true, base: '' },
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

  const DATA_KEYS = [
    ['tw_us_watchlist_v1', '自選股清單'],
    ['tw_us_holdings_v1', '我的持股'],
    ['tw_us_alerts_v1', '提醒'],
    ['tw_us_cart_v1', '模擬下單暫存匣'],
    ['tw_us_tour_done_v1', '新手導覽狀態（清除後會再次顯示導覽）'],
  ];

  function ProfileEditor({ p, onChange, onSave, onCancel }) {
    const [models, setModels] = useState([]);
    const [status, setStatus] = useState(null);
    const [busy, setBusy] = useState('');
    const t = TYPES[p.type];
    const set = (k, v) => onChange({ ...p, [k]: v });
    const run = async (action) => {
      setBusy(action);
      setStatus(null);
      try {
        const r = await callAI(action, { profile: cleanProfile(p) });
        if (action === 'models') {
          if (r.error) setStatus({ ok: false, msg: r.error });
          else {
            setModels(r.models || []);
            setStatus({ ok: true, msg: `取得 ${r.models?.length || 0} 個模型` });
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
              {models.map((m) => (
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
            <div className="text-xs text-slate-400">
              取得 {models.length} 個模型，點一下即可選用（目前：
              <span className="mono text-sky-300">{p.model || '未選'}</span>）
            </div>
            <div className="max-h-48 overflow-y-auto flex flex-wrap gap-1.5 rounded-lg border border-slate-800 bg-slate-950/50 p-2">
              {models.map((m) => (
                <button
                  type="button"
                  key={m}
                  onClick={() => set('model', m)}
                  className={`px-2 py-1 rounded-md text-[11px] mono border cursor-pointer ${
                    p.model === m
                      ? 'bg-sky-500/25 border-sky-400 text-white'
                      : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-500'
                  }`}
                >
                  {m}
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
        save({ ...cfg, activeId: exists.id });
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
      save({ ...cfg, profiles: [...cfg.profiles, prof], activeId: prof.id });
    };
    return (
      <div
        className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-2"
        data-tour="settings-local"
      >
        <div className="flex items-center justify-between">
          <div className="text-sm font-bold text-emerald-200">🖥️ 本機偵測到的模型（真實掃描）</div>
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

  function SettingsPage() {
    const cfg = useAISettings();
    const [editing, setEditing] = useState(null);
    const [cleared, setCleared] = useState({});
    const save = (next) => saveAI(next);
    const saveProfile = () => {
      const exists = cfg.profiles.some((x) => x.id === editing.id);
      const profiles = exists
        ? cfg.profiles.map((x) => (x.id === editing.id ? editing : x))
        : [...cfg.profiles, editing];
      save({ ...cfg, profiles, activeId: cfg.activeId || editing.id });
      setEditing(null);
    };
    return (
      <div className="space-y-5 max-w-4xl">
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4">
          <div>
            <h2 className="text-lg font-bold text-white">🤖 AI 連線</h2>
            <p className="text-xs text-slate-400 leading-relaxed mt-1">
              這裡的設定<b className="text-white">全系統共用</b>
              ：技術分析的買賣決策、各分頁底部的「AI 解讀」都會用同一組連線，
              也可以在每一頁臨時改用別組。<b className="text-white">不設定也完全能用</b>
              ，系統會使用內建規則引擎。 你可以綁定雲端
              AI（Gemini、OpenAI、Claude），或接到自己電腦上的本地模型（Ollama、LM Studio 等）。
            </p>
          </div>

          <LocalDetect cfg={cfg} save={save} />

          <div className="space-y-2">
            <label className="flex items-center gap-3 px-3 py-2 rounded-xl border border-slate-800 bg-slate-950/60 text-sm cursor-pointer">
              <input
                type="radio"
                name="ai-active"
                checked={!cfg.activeId}
                onChange={() => save({ ...cfg, activeId: null })}
              />
              <span className="text-white font-semibold">內建規則引擎（不使用 AI）</span>
              <span className="text-[11px] text-slate-500">
                價位與決策完全由程式規則產生，AI 解讀按鈕會提示先設定連線
              </span>
            </label>
            {cfg.profiles.map((p) => (
              <div
                key={p.id}
                className="flex flex-wrap items-center gap-3 px-3 py-2 rounded-xl border border-slate-800 bg-slate-950/60 text-sm"
              >
                <input
                  type="radio"
                  name="ai-active"
                  checked={cfg.activeId === p.id}
                  onChange={() => save({ ...cfg, activeId: p.id })}
                  aria-label={`預設使用 ${p.name}`}
                />
                <span className="text-white font-semibold">{p.name}</span>
                <span className="text-[11px] text-slate-400">
                  {TYPES[p.type]?.label.split('（')[0]}
                </span>
                <span className="mono text-[11px] text-sky-300">{p.model || '未選模型'}</span>
                {p.base_url && (
                  <span className="mono text-[11px] text-slate-500">{p.base_url}</span>
                )}
                <span className="ml-auto flex gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setEditing({ ...p })}
                    className="text-sky-300 hover:text-white cursor-pointer"
                  >
                    編輯
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      save({
                        ...cfg,
                        profiles: cfg.profiles.filter((x) => x.id !== p.id),
                        activeId: cfg.activeId === p.id ? null : cfg.activeId,
                      })
                    }
                    className="text-slate-500 hover:text-rose-400 cursor-pointer"
                  >
                    刪除
                  </button>
                </span>
              </div>
            ))}
          </div>

          {editing ? (
            <ProfileEditor
              p={editing}
              onChange={setEditing}
              onSave={saveProfile}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <div className="flex flex-wrap gap-2 text-xs">
              {[
                ['gemini', '＋ Gemini'],
                ['openai', '＋ OpenAI'],
                ['anthropic', '＋ Claude'],
                ['openai_compatible', '＋ 本地／自架模型'],
              ].map(([t, label]) => (
                <button
                  type="button"
                  key={t}
                  onClick={() => setEditing(newProfile(t))}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-sky-300 hover:bg-slate-700 cursor-pointer"
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          <details className="rounded-xl border border-slate-800 p-3 text-xs text-slate-300 leading-relaxed">
            <summary className="cursor-pointer text-slate-200">
              🖥️ 怎麼建立本地模型（以 Ollama 為例）
            </summary>
            <ol className="list-decimal pl-5 mt-2 space-y-1">
              <li>
                到 ollama.com 安裝 Ollama，開啟後它會在{' '}
                <span className="mono">http://127.0.0.1:11434</span> 提供服務。
              </li>
              <li>
                在終端機下載一個模型，例如 <span className="mono">ollama pull qwen2.5:7b</span>
                （大小與記憶體需求依模型而定， 7B 約需 8GB 以上記憶體）。
              </li>
              <li>
                回到這裡按「＋
                本地／自架模型」，點「Ollama」帶入網址，再按「取得模型清單」選擇剛下載的模型，最後「測試連線」。
              </li>
              <li>
                LM Studio、llama.cpp server、vLLM 等只要提供 OpenAI 相容的 /v1
                介面也能用，填對應網址即可。
              </li>
            </ol>
            <p className="mt-2 text-slate-500">
              本地模型的中文與數字能力通常弱於大型雲端模型，所以系統會檢查 AI
              回答裡的數字是否來自系統資料，並標出找不到的數字。
              資料不會離開你的電腦（除非你選雲端服務）。
            </p>
          </details>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            🔒 API Key 只存在這個瀏覽器的 localStorage（未加密，請勿在共用電腦使用），只在你按 AI
            功能時經本機伺服器轉送給你選的服務，伺服器不會保存。 也可以改用環境變數
            GEMINI_API_KEY／OPENAI_API_KEY／ANTHROPIC_API_KEY，此時 Key 欄位留空即可。
          </p>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-2">
          <h3 className="font-bold text-white">🎯 AI 作用範圍</h3>
          <p className="text-xs text-slate-400">
            取消勾選的功能不會顯示 AI 區塊（或不使用 AI 決策），改回純規則引擎／純數字。
          </p>
          {Object.entries(SCOPE_LABELS).map(([k, label]) => (
            <label
              key={k}
              className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={cfg.scope[k] !== false}
                onChange={(e) => save({ ...cfg, scope: { ...cfg.scope, [k]: e.target.checked } })}
              />
              {label}
            </label>
          ))}
        </div>

        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-2">
          <h3 className="font-bold text-white">🧹 資料管理</h3>
          <p className="text-xs text-slate-400">
            以下資料只存在你的瀏覽器。點一次會變成「再點一次確認」。
          </p>
          <div className="flex flex-wrap gap-2 text-xs">
            {DATA_KEYS.map(([k, label]) => (
              <button
                type="button"
                key={k}
                onClick={() => {
                  if (!cleared[k]) {
                    setCleared({ ...cleared, [k]: 'confirm' });
                    return;
                  }
                  try {
                    localStorage.removeItem(k);
                  } catch (_e) {
                    /* ignore */
                  }
                  setCleared({ ...cleared, [k]: 'done' });
                }}
                className="px-3 py-1.5 rounded-lg bg-rose-950/50 border border-rose-800/60 text-rose-200 hover:bg-rose-900/60 cursor-pointer"
              >
                {cleared[k] === 'done'
                  ? '✅ 已清除（重新整理生效）'
                  : cleared[k] === 'confirm'
                    ? `再點一次確認清除：${label}`
                    : `清除${label}`}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  window.TA = Object.assign(window.TA || {}, { SettingsPage });
})();
