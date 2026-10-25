// 設定頁：AI 連線（雲端／本地，全系統共用）、AI 作用範圍、資料管理
(() => {
  const { useState, useEffect } = React;
  const { useAISettings, saveAI, SCOPE_LABELS } = window.TA;
  // 以下元件在 settings_ai.jsx、settings_background.jsx（index.html 先載入）
  const { AI_TYPES: TYPES, newAIProfile: newProfile, ProfileEditor, LocalDetect, BackgroundServicePanel } = window.TA;


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

  // 資料檔位置與最後存檔狀態
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
