// 設定頁：金鑰與資料額度（寫進程式資料夾的 .env，使用者不必自己建立或搬檔案）
(() => {
  const { useState, useEffect } = React;

  // FinMind 近 1 小時用量：程式自設上限＝官方上限的 80%，到了就先停，避免被暫停 30 分鐘
  function FinMindUsage({ fm }) {
    const u = fm.usage;
    const pct = Math.min(100, Math.round((u.used_last_hour / u.budget) * 100));
    const bar = pct >= 100 ? 'bg-rose-500' : pct >= 70 ? 'bg-amber-400' : 'bg-emerald-500';
    return (
      <div className="text-[11px] text-slate-400 space-y-1">
        <div className="flex items-center gap-2">
          <span>
            近 1 小時已用 <b className="text-slate-200">{u.used_last_hour}</b> / {u.budget} 次（官方上限 {u.limit}）
          </span>
          <window.TA.Tip text="FinMind 以「每小時請求次數」計算，不是 AI token，也不收費。本程式只用到官方上限的 80%，到了就暫停 FinMind 請求，等最早那次滿 1 小時再自動恢復；其他資料來源（Yahoo、證交所）不受影響。" />
        </div>
        <div className="h-1.5 rounded bg-slate-800 overflow-hidden">
          <div className={`h-full ${bar}`} style={{ width: `${pct}%` }} />
        </div>
        {u.throttled_until && <div className="text-amber-300">已達自設上限，{u.throttled_until} 後恢復</div>}
        {fm.paused && (
          <div className="text-rose-300">
            {fm.reason}，{fm.resume_at} 前暫停
          </div>
        )}
      </div>
    );
  }

  function KeysPanel() {
    const [st, setSt] = useState(null);
    const [draft, setDraft] = useState({});
    const [msg, setMsg] = useState(null);
    const [busy, setBusy] = useState(false);
    const load = () =>
      fetch('/api/env')
        .then((r) => r.json())
        .then(setSt)
        .catch((e) => setMsg({ err: true, text: `讀取設定失敗：${e.message}` }));
    useEffect(() => {
      load();
    }, []);

    const send = async (values) => {
      setBusy(true);
      setMsg(null);
      try {
        const r = await fetch('/api/env/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ values }),
        });
        const d = await r.json();
        if (d.error) throw new Error(d.error);
        setSt(d);
        setDraft({});
        setMsg({ err: false, text: '已儲存，立即生效（不用重開程式）' });
        const n = Object.keys(values).length;
        window.TA.toast?.(`✅ 已儲存 ${n} 項金鑰／額度設定到 .env，立即生效`);
      } catch (e) {
        setMsg({ err: true, text: e.message });
        window.TA.toast?.(`⚠️ 金鑰設定沒有存成功：${e.message}`);
      } finally {
        setBusy(false);
      }
    };
    const changed = Object.keys(draft).filter((k) => draft[k] !== undefined && draft[k] !== '');

    return (
      <div
        className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-3"
        data-tour="settings-keys"
      >
        <div>
          <h3 className="font-bold text-white">
            金鑰與資料額度
            <window.TA.Tip text="這裡填的內容會存成程式資料夾裡的 .env 設定檔（環境變數）。不用自己建立或搬檔案，換版本重新安裝也會保留。全部都是選填，不填也能正常使用。" />
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            全部選填。存在這台電腦的設定檔，不會上傳，也不會跟著打包的程式給別人。 金鑰只顯示末 4
            碼；要更換就直接輸入新的值，要刪除按「清除」。
          </p>
        </div>

        {!st ? (
          <div className="text-xs text-slate-500">讀取中…</div>
        ) : (
          <div className="space-y-2">
            {st.fields.map((f) => (
              <div
                key={f.key}
                className="rounded-xl border border-slate-800 bg-slate-950/50 p-3 space-y-1.5"
              >
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <label htmlFor={`env-${f.key}`} className="font-semibold text-slate-200">
                    {f.label}
                  </label>
                  <span className="text-slate-500 mono text-[11px]">{f.key}</span>
                  <span
                    className={`ml-auto text-[11px] ${f.set ? 'text-emerald-300' : 'text-slate-500'}`}
                  >
                    {f.set ? `${f.display}${f.source ? `・來自${f.source}` : ''}` : '未設定'}
                  </span>
                </div>
                <div className="flex gap-2">
                  <input
                    id={`env-${f.key}`}
                    type={f.secret ? 'password' : 'text'}
                    autoComplete="off"
                    value={draft[f.key] ?? ''}
                    onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                    placeholder={f.set ? '輸入新的值以更換' : '貼上後按「儲存」'}
                    className="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white"
                  />
                  {f.set && f.source === '設定檔' && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => send({ [f.key]: '' })}
                      className="px-3 py-1.5 rounded-lg border border-slate-700 text-xs text-slate-300 hover:text-rose-300 cursor-pointer"
                    >
                      清除
                    </button>
                  )}
                </div>
                <div className="text-[11px] text-slate-400 leading-relaxed">
                  {f.help}
                  {f.link && (
                    <a
                      href={f.link}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-1 text-sky-300 hover:underline"
                    >
                      前往註冊
                    </a>
                  )}
                </div>
                {f.key === 'FINMIND_TOKEN' && st.finmind?.usage && <FinMindUsage fm={st.finmind} />}
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={busy || changed.length === 0}
                onClick={() => send(Object.fromEntries(changed.map((k) => [k, draft[k]])))}
                className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white text-xs font-semibold cursor-pointer"
              >
                {busy ? '儲存中…' : `儲存${changed.length ? `（${changed.length} 項）` : ''}`}
              </button>
              {msg && (
                <span className={`text-xs ${msg.err ? 'text-rose-300' : 'text-emerald-300'}`}>
                  {msg.err ? '⚠️ ' : '✅ '}
                  {msg.text}
                </span>
              )}
            </div>
            <div className="text-[11px] text-slate-500">
              設定檔位置：<span className="mono">{st.path}</span>
              {st.exists ? '' : '（還沒建立，第一次儲存時會自動建立）'}
            </div>
          </div>
        )}
      </div>
    );
  }

  window.TA = Object.assign(window.TA || {}, { KeysPanel });
})();
