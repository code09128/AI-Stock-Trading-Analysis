// 設定頁：AI 連線（雲端／本地，全系統共用）、AI 作用範圍、資料管理
(() => {
  const { useState, useEffect } = React;
  const { useAISettings, saveAI, callAI, cleanProfile, SCOPE_LABELS } = window.TA;

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

  // 瀏覽器裡存的所有資料（第三欄：清除後要通知哪些畫面立即更新）
  const DATA_KEYS = [
    ['tw_us_watchlist_v1', '自選股清單', null],
    ['tw_us_holdings_v1', '我的持股', 'portfolio-changed'],
    ['tw_us_journal_v1', '交易紀錄', 'portfolio-changed'],
    ['tw_us_rules_v1', '交易檢討產生的個人規則', 'portfolio-changed'],
    ['tw_us_alerts_v1', '提醒', 'alerts-changed'],
    ['tw_us_cart_v1', '模擬下單暫存匣', null],
    ['tw_us_ai_v1', 'AI 連線設定（含金鑰）', 'ai-settings-changed'],
    ['tw_us_ai_usage_v1', 'AI 用量紀錄', 'ai-usage-changed'],
    ['tw_us_ai_prices_v1', 'AI 模型單價', 'ai-usage-changed'],
    ['tw_us_activity_v1', '操作紀錄（瀏覽器端）', 'activity-changed'],
    ['tw_us_sidebar_v1', '介面偏好：側邊欄收合', null],
    ['tw_us_mkt_filter_v1', '介面偏好：看盤市場篩選', null],
    ['tw_us_bg_alerts_v1', '介面偏好：按 X 時預設縮到系統匣', null],
    ['tw_us_zoom_v1', '介面偏好：畫面縮放', null],
    ['tw_us_tour_done_v1', '新手導覽狀態（清除後會再次顯示導覽）', null],
  ];
  const describe = (k) => {
    try {
      const raw = localStorage.getItem(k);
      if (raw === null) return '沒有資料';
      const v = JSON.parse(raw);
      if (Array.isArray(v)) return `${v.length} 筆`;
      if (v && Array.isArray(v.rules)) return `${v.rules.length} 條`;
      if (v && Array.isArray(v.profiles)) return `${v.profiles.length} 組連線`;
      return '已設定';
    } catch (_e) {
      return '已設定';
    }
  };

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

  // 資料檔位置與最後存檔狀態
  function BackgroundServicePanel() {
    const LS_BG = 'tw_us_bg_alerts_v1';
    const [bgAlerts, setBgAlerts] = useState(() => {
      const v = localStorage.getItem(LS_BG);
      return v === null ? true : v === 'true';
    });
    const [autostart, setAutostart] = useState(false);
    const [checking, setChecking] = useState(false);
    const [checkResult, setCheckResult] = useState('');

    useEffect(() => {
      fetch('/api/autostart')
        .then((r) => r.json())
        .then((d) => setAutostart(!!d.enabled))
        .catch(() => {});
    }, []);

    const toggleBg = (checked) => {
      setBgAlerts(checked);
      localStorage.setItem(LS_BG, String(checked));
      window.dispatchEvent(new Event('storage'));
      window.TA.notifySaved(
        `按 X 時的預設選項改為「${checked ? '縮到系統匣' : '結束程式'}」`,
      );
    };

    const toggleAutostart = (checked) => {
      setAutostart(checked);
      fetch('/api/autostart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: checked }),
      })
        .then((r) => r.json())
        .then((d) => {
          setAutostart(!!d.enabled);
          // 這個設定寫在 Windows 啟動清單（登錄檔），不是資料檔，所以不用 notifySaved
          window.TA.toast?.(
            d.ok && !!d.enabled === checked
              ? `✅ 已${checked ? '設定' : '取消'}「開機自動在背景啟動」`
              : `⚠️ 開機啟動設定沒有成功（Windows 啟動清單寫入失敗），目前為${d.enabled ? '開啟' : '關閉'}`,
          );
        })
        .catch((e) => {
          setAutostart(!checked);
          window.TA.toast?.(`⚠️ 開機啟動設定失敗：${e.message}`);
        });
    };

    const runCheckNow = () => {
      setChecking(true);
      setCheckResult('');
      fetch('/api/alerts/check_now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
        .then((r) => r.json())
        .then((d) => {
          const count = (d.fired || []).length;
          setCheckResult(
            count > 0
              ? `檢查完成：觸發了 ${count} 則提醒！`
              : '檢查完成：目前無提醒達標',
          );
        })
        .catch((e) => setCheckResult(`檢查失敗：${e.message}`))
        .finally(() => {
          setChecking(false);
          window.TA.reloadAlertsFromServer?.(); // 後端觸發的提醒已寫回資料檔，頁面要跟著更新
        });
    };

    return (
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-white">常駐背景提醒與系統匣（System Tray）</h3>
          <span className="text-[11px] px-2 py-0.5 rounded bg-sky-500/15 text-sky-300 border border-sky-500/30">
            Windows 桌面視窗版
          </span>
        </div>
        <p className="text-xs text-slate-400 leading-relaxed">
          桌面視窗版按右上角 X 時會詢問要「縮到系統匣」或「結束程式」。縮到系統匣後由後端服務持續檢查價格、漲跌幅（每 15
          秒）與 RSI（每 5 分鐘），達標時發送 Windows 桌面原生通知。
        </p>

        <div className="space-y-2 text-xs">
          <label className="flex items-center gap-2 text-slate-200 cursor-pointer">
            <input
              type="checkbox"
              checked={bgAlerts}
              onChange={(e) => toggleBg(e.target.checked)}
            />
            按 X 時預設選「縮到系統匣」（繼續在背景檢查提醒）
          </label>
          <label className="flex items-center gap-2 text-slate-200 cursor-pointer">
            <input
              type="checkbox"
              checked={autostart}
              onChange={(e) => toggleAutostart(e.target.checked)}
            />
            開機自動在背景啟動（登入 Windows 後常駐系統匣檢查提醒）
          </label>
        </div>

        <div className="flex items-center gap-3 pt-1 text-xs">
          <button
            type="button"
            onClick={runCheckNow}
            disabled={checking}
            className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-sky-300 hover:bg-slate-700 cursor-pointer disabled:opacity-50"
          >
            {checking ? '檢查中…' : '立即手動執行一輪提醒檢查'}
          </button>
          {checkResult && <span className="text-slate-300">{checkResult}</span>}
        </div>

        <div className="rounded-xl border border-slate-800/80 bg-slate-950/60 p-3 text-[11px] text-slate-400 space-y-1">
          <div className="font-semibold text-slate-300">如何關閉背景服務：</div>
          <div>1. 右下角系統匣圖示按右鍵：點選「暫停提醒」或「結束程式」。</div>
          <div>2. 按視窗右上角 X，在詢問視窗選「結束程式」。</div>
          <div>3. 若設定了開機自動啟動，取消勾選即可自 Windows 啟動清單中移除。</div>
        </div>
      </div>
    );
  }

  function UserDataStatus() {
    const st = window.TA.userDataStatus || {};
    const [, tick] = useState(0);
    useEffect(() => {
      const on = () => tick((x) => x + 1);
      window.addEventListener('userdata-status', on);
      return () => window.removeEventListener('userdata-status', on);
    }, []);
    return (
      <div className="text-[11px] rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2 space-y-0.5">
        <div className="text-slate-400">
          資料檔：<span className="mono text-slate-300">{st.path || '讀取中…'}</span>
          <window.TA.Tip text="這個 userdata.json 就是你的資料正本；同一層的 backups 資料夾是每天的自動備份。搬家時把整個程式資料夾一起搬即可。" />
        </div>
        {st.ok ? (
          <div className="text-emerald-300">
            ✅ 自動存檔中{st.savedAt ? `，最後存檔 ${st.savedAt.toLocaleTimeString('zh-TW', { hour12: false })}` : ''}
          </div>
        ) : (
          <div className="text-amber-300">⚠️ {st.error}（修改仍保留在瀏覽器，下次修改時會再嘗試寫入）</div>
        )}
      </div>
    );
  }

  function SettingsPage() {
    const cfg = useAISettings();
    const [editing, setEditing] = useState(null);
    const [cleared, setCleared] = useState({});
    const [restoreMsg, setRestoreMsg] = useState('');
    // msg：存進資料檔後要顯示的通知（✅／⚠️ 由 notifySaved 決定）
    const save = (next, msg) => {
      saveAI(next);
      if (msg) window.TA.notifySaved(msg);
    };
    const saveProfile = () => {
      const exists = cfg.profiles.some((x) => x.id === editing.id);
      const profiles = exists
        ? cfg.profiles.map((x) => (x.id === editing.id ? editing : x))
        : [...cfg.profiles, editing];
      save(
        { ...cfg, profiles, activeId: cfg.activeId || editing.id },
        `${exists ? '已更新' : '已新增'} AI 連線「${editing.name || editing.model || '未命名'}」`,
      );
      setEditing(null);
    };
    return (
      <div className="space-y-5 max-w-4xl">
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4">
          <div>
            <h2 className="text-lg font-bold text-white">AI 連線</h2>
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
                onChange={() => save({ ...cfg, activeId: null }, '已改用內建規則引擎（不使用 AI）')}
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
                  onChange={() => save({ ...cfg, activeId: p.id }, `已改用 AI 連線「${p.name}」`)}
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
                    onClick={() => {
                      if (!window.confirm(`確定刪除 AI 連線「${p.name}」？（含這組連線裡的金鑰）`)) {
                        window.TA.toast?.('ℹ️ 已取消，AI 連線沒有變動');
                        return;
                      }
                      save(
                        {
                          ...cfg,
                          profiles: cfg.profiles.filter((x) => x.id !== p.id),
                          activeId: cfg.activeId === p.id ? null : cfg.activeId,
                        },
                        `已刪除 AI 連線「${p.name}」`,
                      );
                    }}
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
                ['openrouter', '＋ OpenRouter'],
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
              怎麼建立本地模型（以 Ollama 為例）
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
            API Key 只存在這個瀏覽器的 localStorage（未加密，請勿在共用電腦使用），只在你按 AI
            功能時經本機伺服器轉送給你選的服務，伺服器不會保存。 不想存在瀏覽器的話，可以把金鑰填在下方「金鑰與資料額度」，
            這裡的 Key 欄位留空即可。
          </p>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-2">
          <h3 className="font-bold text-white">AI 作用範圍</h3>
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
                onChange={(e) =>
                  save(
                    { ...cfg, scope: { ...cfg.scope, [k]: e.target.checked } },
                    `「${label}」已${e.target.checked ? '開啟' : '關閉'} AI`,
                  )
                }
              />
              {label}
            </label>
          ))}
        </div>

        <window.TA.KeysPanel />

        <window.TA.UsagePanel cfg={cfg} />

        <window.TA.ActivityPanel />

        <window.TA.ZoomSettings />

        <BackgroundServicePanel />

        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-2">
          <h3 className="font-bold text-white">資料管理</h3>
          <p className="text-xs text-slate-400">
            持股、交易紀錄、交易規則、自選股、提醒、AI 設定都自動存成程式資料夾裡的檔案，
            整個程式資料夾搬到別的位置或別台電腦，資料會跟著走；換瀏覽器、清除瀏覽紀錄也不會遺失。
            每天自動備份一份（保留 14 天）。清除要點兩次確認。
          </p>
          <UserDataStatus />
          <div className="flex flex-wrap gap-2 text-xs">
            <button
              type="button"
              onClick={() => {
                const data = {};
                for (const [k] of DATA_KEYS) {
                  const v = localStorage.getItem(k);
                  if (v !== null) data[k] = v;
                }
                const blob = new Blob(
                  [
                    JSON.stringify(
                      { app: 'stock-dashboard', savedAt: new Date().toISOString(), data },
                      null,
                      2,
                    ),
                  ],
                  {
                    type: 'application/json',
                  },
                );
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = `我的資料備份_${new Date().toISOString().slice(0, 10)}.json`;
                a.click();
                setTimeout(() => URL.revokeObjectURL(a.href), 1000);
                window.TA.toast?.(`✅ 已下載備份檔 ${a.download}（含 AI 金鑰，請妥善保存）`);
              }}
              className="px-3 py-1.5 rounded-lg bg-sky-700 hover:bg-sky-600 text-white cursor-pointer"
            >
              下載備份（含 AI 金鑰，請妥善保存）
            </button>
            <label className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 cursor-pointer">
              從備份還原
              <input
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (!f) return;
                  try {
                    const j = JSON.parse(await f.text());
                    const known = new Set(DATA_KEYS.map(([k]) => k));
                    const entries = Object.entries(j.data || {}).filter(([k]) => known.has(k));
                    if (!entries.length) throw new Error('檔案裡沒有可還原的資料');
                    for (const [k, v] of entries)
                      localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
                    setRestoreMsg(`正在把 ${entries.length} 項資料存進資料檔…`);
                    // 一定要等存進 data/userdata.json 再重新載入：否則載入時會讀回檔案裡的舊資料，還原就白做了
                    await window.TA.flushUserData();
                    const r = await window.TA.afterSave();
                    if (!r.ok) throw new Error(`資料檔寫入失敗（${r.error}），沒有重新載入，請稍後再試`);
                    setRestoreMsg(`已還原 ${entries.length} 項資料，重新載入中…`);
                    window.TA.toast?.(`✅ 已從備份還原 ${entries.length} 項資料並存檔，正在重新載入`);
                    setTimeout(() => window.location.reload(), 800);
                  } catch (err) {
                    setRestoreMsg(`還原失敗：${err.message}`);
                    window.TA.toast?.(`⚠️ 還原失敗：${err.message}`);
                  }
                }}
              />
            </label>
            {restoreMsg && <span className="self-center text-amber-300">{restoreMsg}</span>}
          </div>
          <div className="grid sm:grid-cols-2 gap-2 text-xs">
            {DATA_KEYS.map(([k, label, evt]) => (
              <div
                key={k}
                className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-slate-800 bg-slate-950/60"
              >
                <span className="text-slate-200">
                  {label}
                  <span className="ml-2 text-slate-500">
                    {cleared[k] === 'done' ? '已清除' : describe(k)}
                  </span>
                </span>
                <button
                  type="button"
                  disabled={cleared[k] === 'done' || localStorage.getItem(k) === null}
                  onClick={() => {
                    if (cleared[k] !== 'confirm') {
                      setCleared({ ...cleared, [k]: 'confirm' });
                      return;
                    }
                    try {
                      if (k === window.TA.LS_ACTIVITY) window.TA.clearActivity(); // 連記憶體裡的一起清
                      localStorage.removeItem(k);
                    } catch (_e) {
                      /* ignore */
                    }
                    if (evt) window.dispatchEvent(new Event(evt)); // 相關畫面立即更新
                    setCleared({ ...cleared, [k]: 'done' });
                    window.TA.notifySaved(`已清除「${label}」`);
                  }}
                  className="shrink-0 px-2.5 py-1 rounded bg-rose-950/50 border border-rose-800/60 text-rose-200 hover:bg-rose-900/60 cursor-pointer disabled:opacity-40 disabled:cursor-default"
                >
                  {cleared[k] === 'confirm' ? '再點一次確認' : '清除'}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  window.TA = Object.assign(window.TA || {}, { SettingsPage });
})();
