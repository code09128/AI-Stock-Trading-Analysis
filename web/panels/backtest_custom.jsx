// 策略回測：🧱 自訂策略（條件積木）。用下拉選單組「指標 × 比較 × 指標或數字」，存檔後出現在所有策略選單
(() => {
  const { useState, useEffect } = React;
  const LS_KEY = 'tw_us_bt_custom_v1';

  // 存好的自訂策略 → 和內建策略同樣格式（給策略選單、組合、今日訊號用）
  function customStrategies() {
    return (window.TA.readLS(LS_KEY, []) || []).map((c) => ({
      key: `custom:${c.id}`,
      label: `自訂：${c.name}`,
      kind: '自訂',
      rule: c.rule,
      params: c.params,
      tw_only: c.tw_only,
      custom: c.definition,
    }));
  }

  const blankRule = () => ({ left: { type: 'close' }, op: '>', right: { type: 'sma', n: 20 } });

  function OperandEditor({ value, onChange, meta, allowNumber, label }) {
    const info = meta.operands[value.type] || {};
    const sel = 'bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white';
    return (
      <span className="inline-flex items-center gap-1">
        <select
          aria-label={label}
          value={value.type}
          onChange={(e) => {
            const t = e.target.value;
            const m = meta.operands[t];
            onChange(t === 'number' ? { type: t, value: 0 } : m.needs_n ? { type: t, n: m.default_n } : { type: t });
          }}
          className={sel}
        >
          {Object.entries(meta.operands)
            .filter(([k]) => allowNumber || k !== 'number')
            .map(([k, o]) => (
              <option key={k} value={k}>
                {o.label}
              </option>
            ))}
        </select>
        {info.needs_n && (
          <input
            type="number"
            min="2"
            max="250"
            aria-label={`${label}天數`}
            value={value.n}
            onChange={(e) => onChange({ ...value, n: Number(e.target.value) })}
            className={`${sel} w-16 font-mono`}
          />
        )}
        {info.needs_n && <span className="text-slate-500">日</span>}
        {value.type === 'number' && (
          <input
            type="number"
            step="any"
            aria-label={`${label}數字`}
            value={value.value}
            onChange={(e) => onChange({ ...value, value: Number(e.target.value) })}
            className={`${sel} w-24 font-mono`}
          />
        )}
      </span>
    );
  }

  function BlockEditor({ title, block, onChange, meta }) {
    const set = (rules) => onChange({ ...block, rules });
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <b className="text-slate-200">{title}</b>
          <select
            aria-label={`${title}組合方式`}
            value={block.logic}
            onChange={(e) => onChange({ ...block, logic: e.target.value })}
            className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white"
          >
            <option value="all">以下全部成立（且）</option>
            <option value="any">任一條成立（或）</option>
          </select>
        </div>
        {block.rules.map((r, i) => (
          <div key={`${title}-${i}`} className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-slate-500 w-4">{i + 1}.</span>
            <OperandEditor
              label={`${title}第 ${i + 1} 條左邊`}
              value={r.left}
              meta={meta}
              allowNumber={false}
              onChange={(v) => set(block.rules.map((x, k) => (k === i ? { ...x, left: v } : x)))}
            />
            <select
              aria-label={`${title}第 ${i + 1} 條比較`}
              value={r.op}
              onChange={(e) => set(block.rules.map((x, k) => (k === i ? { ...x, op: e.target.value } : x)))}
              className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-sky-200"
            >
              {Object.entries(meta.ops).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
            <OperandEditor
              label={`${title}第 ${i + 1} 條右邊`}
              value={r.right}
              meta={meta}
              allowNumber
              onChange={(v) => set(block.rules.map((x, k) => (k === i ? { ...x, right: v } : x)))}
            />
            <button
              type="button"
              disabled={block.rules.length <= 1}
              onClick={() => set(block.rules.filter((_, k) => k !== i))}
              className="text-slate-500 hover:text-rose-300 cursor-pointer disabled:opacity-30"
            >
              刪除
            </button>
          </div>
        ))}
        <button
          type="button"
          disabled={block.rules.length >= meta.max_rules}
          onClick={() => set([...block.rules, blankRule()])}
          className="text-xs text-sky-300 hover:underline cursor-pointer disabled:opacity-40"
        >
          ＋ 加一條條件
        </button>
      </div>
    );
  }

  function CustomPanel({ onUse }) {
    const { readLS, writeLS } = window.TA;
    const [meta, setMeta] = useState(window.TA._btCustomMeta || null);
    const [saved, setSavedRaw] = useState(() => readLS(LS_KEY, []));
    const [draft, setDraft] = useState(null);
    const [editingId, setEditingId] = useState(null);
    const [msg, setMsg] = useState(null);
    const [busy, setBusy] = useState(false);
    const setSaved = (v) => {
      setSavedRaw(v);
      writeLS(LS_KEY, v);
    };
    useEffect(() => {
      if (meta) return;
      fetch('/api/mod3/custom/templates')
        .then((r) => r.json())
        .then((d) => {
          window.TA._btCustomMeta = d;
          setMeta(d);
        })
        .catch((e) => setMsg({ err: true, text: `讀取積木清單失敗：${e.message}` }));
    }, [meta]);

    const startFrom = (def, id = null) => {
      setDraft(JSON.parse(JSON.stringify(def)));
      setEditingId(id);
      setMsg(null);
    };
    const save = async () => {
      setBusy(true);
      setMsg(null);
      try {
        const res = await fetch('/api/mod3/custom/describe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ custom: draft }),
        });
        const d = await res.json();
        if (d.error) throw new Error(d.error);
        const item = {
          id: editingId || `c${Date.now()}`,
          name: d.definition.name,
          definition: d.definition,
          params: d.params,
          rule: d.rule,
          tw_only: d.tw_only,
        };
        const next = editingId ? saved.map((x) => (x.id === editingId ? item : x)) : [...saved, item];
        setSaved(next);
        setEditingId(item.id);
        setDraft(d.definition);
        setMsg({ err: false, text: `已儲存「${item.name}」，策略選單裡會出現「自訂：${item.name}」。` });
        window.TA.notifySaved?.(`已儲存自訂策略「${item.name}」`);
      } catch (e) {
        setMsg({ err: true, text: e.message });
      } finally {
        setBusy(false);
      }
    };
    const remove = (id) => {
      const item = saved.find((x) => x.id === id);
      if (!window.confirm(`刪除自訂策略「${item?.name}」？`)) return;
      setSaved(saved.filter((x) => x.id !== id));
      if (editingId === id) {
        setDraft(null);
        setEditingId(null);
      }
    };

    if (!meta) return <div className="text-xs text-slate-500">{msg?.text || '讀取中…'}</div>;
    const btn = 'px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300 hover:text-white cursor-pointer text-xs';
    return (
      <div className="space-y-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-xs text-slate-300 space-y-3">
          <div>
            不用寫程式，用下拉選單組出自己的進場與出場條件（例如「RSI 向上穿越 30 且 收盤價 大於 60 日均線」）。
            存檔後會出現在上方表單、今日訊號、策略組合的策略選單，也能用部位與停損、參數熱力圖、蒙地卡羅、匯出 Pine。
            <window.TA.Tip text="指標都只用到當天收盤為止的資料，組不出偷看未來的條件；訊號一樣是收盤確認、隔天開盤成交。條件裡的天數與門檻會變成可調參數（同一種指標同樣天數會合成一個）。「三大法人買賣超」只支援台股，會用到 FinMind（有本機快取）。" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-slate-400">從範本開始：</span>
            {meta.templates.map((t) => (
              <button key={t.name} type="button" onClick={() => startFrom(t)} className={btn}>
                {t.name}
              </button>
            ))}
            <button
              type="button"
              onClick={() =>
                startFrom({
                  name: '我的策略',
                  entry: { logic: 'all', rules: [blankRule()] },
                  exit: { logic: 'any', rules: [{ left: { type: 'close' }, op: '<', right: { type: 'sma', n: 20 } }] },
                })
              }
              className={btn}
            >
              ＋ 空白策略
            </button>
          </div>
          {saved.length > 0 && (
            <div className="space-y-1">
              <div className="text-slate-400">已存的自訂策略：</div>
              {saved.map((c) => (
                <div key={c.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-950/50 px-2 py-1.5">
                  <b className="text-slate-200">{c.name}</b>
                  {c.tw_only && <span className="text-[10px] text-amber-300">僅台股</span>}
                  <span className="text-slate-500 flex-1 min-w-[12rem]">{c.rule}</span>
                  <button type="button" onClick={() => onUse(c)} className="text-sky-300 hover:underline cursor-pointer">
                    拿去回測
                  </button>
                  <button type="button" onClick={() => startFrom(c.definition, c.id)} className="text-slate-300 hover:underline cursor-pointer">
                    編輯
                  </button>
                  <button type="button" onClick={() => remove(c.id)} className="text-slate-500 hover:text-rose-300 cursor-pointer">
                    刪除
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {draft && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <label htmlFor="custom-name" className="text-slate-400">
                策略名稱
              </label>
              <input
                id="custom-name"
                value={draft.name}
                maxLength={30}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white w-56"
              />
              <span className="text-slate-500">{editingId ? '（編輯中，儲存會覆蓋原本的）' : '（新的策略）'}</span>
            </div>
            <BlockEditor title="進場條件" block={draft.entry} meta={meta} onChange={(b) => setDraft({ ...draft, entry: b })} />
            <BlockEditor title="出場條件" block={draft.exit} meta={meta} onChange={(b) => setDraft({ ...draft, exit: b })} />
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={save}
                disabled={busy}
                className="py-1.5 px-4 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-semibold cursor-pointer text-xs"
              >
                {busy ? '檢查中…' : '檢查並儲存'}
              </button>
              {editingId && (
                <button
                  type="button"
                  onClick={() => {
                    const c = saved.find((x) => x.id === editingId);
                    if (c) onUse(c);
                  }}
                  className={btn}
                >
                  用這支去回測
                </button>
              )}
              <button type="button" onClick={() => setDraft(null)} className={btn}>
                關閉編輯
              </button>
            </div>
            {msg && <div className={`text-xs ${msg.err ? 'text-rose-300' : 'text-emerald-300'}`}>{msg.err ? '⚠️ ' : '✅ '}{msg.text}</div>}
          </div>
        )}
      </div>
    );
  }

  window.TA = Object.assign(window.TA || {}, {
    BT: Object.assign(window.TA?.BT || {}, { CustomPanel, customStrategies }),
  });
})();
