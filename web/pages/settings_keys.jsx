// 設定頁：版本與線上更新、金鑰與資料額度（寫進程式資料夾的 .env，使用者不必自己建立或搬檔案）
(() => {
  const { useState, useEffect } = React;

  function UpdatePanel() {
    const [chk, setChk] = useState(null);
    const [busy, setBusy] = useState('');
    const [msg, setMsg] = useState(null);

    const runCheck = async () => {
      setBusy('check');
      setMsg(null);
      try {
        const r = await fetch('/api/update/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        });
        const d = await r.json();
        if (!d.ok || d.error) throw new Error(d.error || '檢查更新失敗');
        setChk(d);
        setMsg({
          err: false,
          text: d.has_update
            ? `發現新版本 ${d.remote?.tag}（目前 v${d.current?.version}）${
                d.source_checkout ? '；原始碼版請用 git pull 更新' : '，可按右邊按鈕下載套用'
              }`
            : `目前已是最新版本 v${d.current?.version}`,
        });
      } catch (e) {
        setMsg({ err: true, text: e.message });
      } finally {
        setBusy('');
      }
    };

    const runApply = async () => {
      setBusy('apply');
      setMsg({ err: false, text: '正在檢查並下載 GitHub 最新正式版本（Release），請稍候…' });
      try {
        const r = await fetch('/api/update/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        });
        const d = await r.json();
        if (!d.ok || d.error) throw new Error(d.error || '更新失敗');
        if (d.already_latest || d.updated === false) {
          setChk({ ok: true, has_update: !d.already_latest, current: d.current, remote: d.remote });
          const text = d.msg || '目前已是最新版本';
          setMsg({ err: false, text });
          window.TA.toast?.(`✅ ${text}`);
          return;
        }
        setMsg({ err: false, text: `${d.msg}，正在重新載入畫面…` });
        window.TA.toast?.(`✅ ${d.msg}，正在重新載入`);
        setTimeout(() => window.location.reload(), 900);
      } catch (e) {
        setMsg({ err: true, text: e.message });
        window.TA.toast?.(`⚠️ 線上更新失敗：${e.message}`);
      } finally {
        setBusy('');
      }
    };

    return (
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-bold text-white">
              版本與線上更新
              <window.TA.Tip text="只會更新到 GitHub 上正式發布的版本（Release，例如 v1.0.1），開發中的修改不會被推給你。打包版（.exe）每次重新啟動時會自動檢查並下載新版本；也可以在這裡手動檢查、下載。更新只換程式本身，你的持股資料（data/）與金鑰（.env）不受影響。原始碼版不會自動覆蓋程式碼，有新版時請用 git pull。" />
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              打包版重新啟動時會自動檢查並下載最新正式版本；也可隨時手動檢查與下載（保留所有個人資料與金鑰）。
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <button
            type="button"
            disabled={!!busy}
            onClick={runCheck}
            className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-200 hover:bg-slate-700 disabled:opacity-40 cursor-pointer"
          >
            {busy === 'check' ? '檢查中…' : '🔄 檢查更新'}
          </button>
          <button
            type="button"
            disabled={!!busy}
            onClick={runApply}
            className="px-4 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white font-semibold cursor-pointer"
          >
            {busy === 'apply'
              ? '下載更新中…'
              : chk?.has_update
                ? `⚡ 下載並套用 ${chk.remote?.tag || '新版'}`
                : '⚡ 檢查並下載更新'}
          </button>
          {msg && (
            <span className={`text-xs ${msg.err ? 'text-rose-300' : 'text-emerald-300'}`}>
              {msg.err ? '⚠️ ' : '✅ '}
              {msg.text}
            </span>
          )}
        </div>
      </div>
    );
  }

  // FinMind 近 1 小時用量：程式自設上限＝官方上限的 80%，到了就先停，避免被暫停 30 分鐘
  function FinMindUsage({ fm }) {
    const u = fm.usage;
    const pct = Math.min(100, Math.round((u.used_last_hour / u.budget) * 100));
    const bar = pct >= 100 ? 'bg-rose-500' : pct >= 70 ? 'bg-amber-400' : 'bg-emerald-500';
    return (
      <div className="text-[11px] text-slate-400 space-y-1">
        <div className="flex items-center gap-2">
          <span>
            近 1 小時已用 <b className="text-slate-200">{u.used_last_hour}</b> / {u.budget}{' '}
            次（官方上限 {u.limit}）
          </span>
          <window.TA.Tip text="FinMind 以「每小時請求次數」計算，不是 AI token，也不收費。本程式只用到官方上限的 80%，到了就暫停 FinMind 請求，等最早那次滿 1 小時再自動恢復；其他資料來源（Yahoo、證交所）不受影響。" />
        </div>
        <div className="h-1.5 rounded bg-slate-800 overflow-hidden">
          <div className={`h-full ${bar}`} style={{ width: `${pct}%` }} />
        </div>
        {u.throttled_until && (
          <div className="text-amber-300">已達自設上限，{u.throttled_until} 後恢復</div>
        )}
        {fm.paused && (
          <div className="text-rose-300">
            {fm.reason}，{fm.resume_at} 前暫停
          </div>
        )}
      </div>
    );
  }

  function FieldCard({ f, st, draft, setDraft, busy, send, onTestFinmind, testBusy, testMsg }) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label htmlFor={`env-${f.key}`} className="font-semibold text-slate-200">
            {f.label}
          </label>
          <span className="text-slate-500 mono text-[11px]">{f.key}</span>
          <span
            className={`ml-auto text-[11px] px-2 py-0.5 rounded ${
              f.in_file
                ? 'bg-emerald-500/15 border border-emerald-500/40 text-emerald-300'
                : f.set
                  ? 'bg-sky-500/15 border border-sky-500/40 text-sky-300'
                  : 'text-slate-500'
            }`}
          >
            {f.in_file
              ? `✅ 已寫入 .env 檔案（${f.display}）`
              : f.set
                ? `✅ ${f.display}${f.source ? `・來自${f.source}` : ''}`
                : '未設定'}
          </span>
        </div>
        {f.in_file && st?.path && (
          <div className="text-[11px] text-emerald-300/90">
            📁 檔案確認：<span className="mono">{st.path}</span>（已寫入並生效）
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <input
            id={`env-${f.key}`}
            type={f.secret ? 'password' : 'text'}
            autoComplete="off"
            value={draft[f.key] ?? ''}
            onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
            placeholder={f.set ? '已設定（若要更換請貼上新值再按儲存）' : '貼上後按「儲存」'}
            className="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white"
          />
          {f.key === 'FINMIND_TOKEN' && (
            <button
              type="button"
              disabled={busy || testBusy || (!f.set && !draft.FINMIND_TOKEN)}
              onClick={onTestFinmind}
              className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs text-sky-300 hover:bg-slate-700 disabled:opacity-40 cursor-pointer"
            >
              {testBusy ? '驗證中…' : '測試並驗證 Token'}
            </button>
          )}
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
        {f.key === 'FINMIND_TOKEN' && testMsg && (
          <div className={`text-xs ${testMsg.ok ? 'text-emerald-300' : 'text-rose-300'}`}>
            {testMsg.ok ? '✅ ' : '⚠️ '}
            {testMsg.text}
          </div>
        )}
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
    );
  }

  function KeysPanel() {
    const [st, setSt] = useState(null);
    const [draft, setDraft] = useState({});
    const [msg, setMsg] = useState(null);
    const [busy, setBusy] = useState(false);
    const [testBusy, setTestBusy] = useState(false);
    const [testMsg, setTestMsg] = useState(null);
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
        setMsg({ err: false, text: `已寫入 ${d.path || '.env'}，立即生效（不用重開程式）` });
        const n = Object.keys(values).length;
        window.TA.toast?.(`✅ 已儲存 ${n} 項設定到 .env，立即生效`);
      } catch (e) {
        setMsg({ err: true, text: e.message });
        window.TA.toast?.(`⚠️ 金鑰設定沒有存成功：${e.message}`);
      } finally {
        setBusy(false);
      }
    };

    const testFinmind = async () => {
      setTestBusy(true);
      setTestMsg(null);
      try {
        const r = await fetch('/api/env/test_finmind', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: draft.FINMIND_TOKEN || '' }),
        });
        const d = await r.json();
        if (d.status) setSt(d.status);
        if (draft.FINMIND_TOKEN && d.ok) {
          const next = { ...draft };
          delete next.FINMIND_TOKEN;
          setDraft(next);
        }
        setTestMsg({ ok: !!d.ok, text: d.ok ? d.msg : d.error || '驗證失敗' });
        window.TA.toast?.(d.ok ? `✅ ${d.msg}` : `⚠️ ${d.error}`);
      } catch (e) {
        setTestMsg({ ok: false, text: e.message });
      } finally {
        setTestBusy(false);
      }
    };

    const changed = Object.keys(draft).filter((k) => draft[k] !== undefined && draft[k] !== '');
    const dataFields = st ? st.fields : [];

    return (
      <div
        className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-3"
        data-tour="settings-keys"
      >
        <div>
          <h3 className="font-bold text-white">
            資料來源與金鑰額度（.env 設定檔）
            <window.TA.Tip text="這裡填的內容會存成程式資料夾裡的 .env 設定檔（環境變數）。不用自己建立或搬檔案，換版本重新安裝也會保留。全部都是選填，不填也能正常使用。" />
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            全部選填。存在這台電腦的 <span className="mono">.env</span>{' '}
            設定檔，不會上傳，也不會跟著打包的程式給別人。 金鑰只顯示末 4
            碼；要更換就直接輸入新的值，要刪除按「清除」。
          </p>
        </div>

        {!st ? (
          <div className="text-xs text-slate-500">讀取中…</div>
        ) : (
          <div className="space-y-2">
            {dataFields.map((f) => (
              <FieldCard
                key={f.key}
                f={f}
                st={st}
                draft={draft}
                setDraft={setDraft}
                busy={busy}
                send={send}
                onTestFinmind={testFinmind}
                testBusy={testBusy}
                testMsg={testMsg}
              />
            ))}

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={busy || changed.length === 0}
                onClick={() => send(Object.fromEntries(changed.map((k) => [k, draft[k]])))}
                className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white text-xs font-semibold cursor-pointer"
              >
                {busy
                  ? '儲存中…'
                  : `儲存到 .env${changed.length ? `（${changed.length} 項）` : ''}`}
              </button>
              {msg && (
                <span className={`text-xs ${msg.err ? 'text-rose-300' : 'text-emerald-300'}`}>
                  {msg.err ? '⚠️ ' : '✅ '}
                  {msg.text}
                </span>
              )}
            </div>
            <div className="text-[11px] text-slate-400">
              設定檔路徑：<span className="mono text-slate-300">{st.path}</span>
              {st.exists ? (
                <span className="ml-2 text-emerald-400">（✅ 檔案已存在）</span>
              ) : (
                <span className="ml-2 text-slate-500">（第一次儲存時會自動建立）</span>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  window.TA = Object.assign(window.TA || {}, { KeysPanel, UpdatePanel });
})();
