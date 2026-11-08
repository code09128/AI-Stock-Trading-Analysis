// 個股頁右側的 AI 抽屜：選任務（個股研究／技術面／事件）→ 看每個資料面向有沒有資料、勾選要傳哪些 → 問問題。
// 只是換個位置放 AI 解讀（沿用 AiExplain、後端串流、提示詞與數字核對），不另外寫一套 AI 邏輯。
// 面向預覽（/api/ai/context）只抓資料、不呼叫 AI；真的呼叫 AI 一律要使用者按按鈕（會產生費用）。
import { AiExplain, explainKey, setExplainQuestion } from '../ai_store';
import { baseCode } from '../ui';

const { useState, useEffect } = React;

type Q = { label: string; needs: string[] };
const TASKS: Record<string, { module: string; tab: string; title: string; sub: string; questions: Q[] }> = {
  stock: {
    module: 'stock',
    tab: '個股研究',
    title: '個股研究短報',
    sub: '結論先行：評等、估值、利多風險、部位建議',
    questions: [
      { label: '現在適合進場／加碼嗎？', needs: ['price'] },
      { label: '估值貴不貴？', needs: ['fundamentals'] },
      { label: '法人最近在買還是賣？', needs: ['chips'] },
      { label: '下次財報前，市場最在意哪個數字？', needs: ['earnings'] },
      { label: '最近消息是利多還是利空？已反映了嗎？', needs: ['news'] },
      { label: '目前最大的風險是什麼？', needs: ['price'] },
    ],
  },
  tech: {
    module: 'mod1',
    tab: '技術面',
    title: '盤後技術面快評',
    sub: '觀點、核心理由、關鍵價位、多空劇本、操作計畫',
    questions: [
      { label: '趨勢現在是多是空？', needs: ['price'] },
      { label: '關鍵支撐壓力在哪？', needs: ['price'] },
      { label: 'RSI 與量能有沒有警訊？', needs: ['price'] },
      { label: '停損放哪裡？', needs: ['price'] },
      { label: '已持有／空手各該怎麼做？', needs: ['price'] },
    ],
  },
  event: {
    module: 'mod2',
    tab: '事件',
    title: '事件快評（Desk Note）',
    sub: '定調、已定價多少、預期差、交易含義、反方解讀',
    questions: [
      { label: '這些消息已經反映在股價了嗎？', needs: ['news', 'price'] },
      { label: '隔天預期波動區間多大？', needs: ['price'] },
      { label: '消息出來後怎麼處理？', needs: ['news'] },
    ],
  },
};

function AiDrawer({ q, open, task, setTask, onClose, m1Data, m2Data, digest, onRunTech }: { q: any; open: boolean; task: string; setTask: (t: string) => void; onClose: () => void; m1Data: any; m2Data: any; digest: any; onRunTech: () => void }) {
  const T = TASKS[task] || TASKS.stock;
  const symbol = q?.symbol || '';
  const [ctx, setCtx] = useState<any>(null);
  const [off, setOff] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  useEffect(() => {
    if (!open || !symbol) return undefined;
    let stop = false;
    setCtx(null);
    setOff({});
    fetch('/api/ai/context', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, module: T.module }),
    })
      .then((r) => (r.status === 404 ? { old: true, sections: [] } : r.json()))
      .then((d) => !stop && setCtx(d))
      .catch((e) => !stop && setCtx({ error: e.message, sections: [] }));
    return () => {
      stop = true;
    };
  }, [open, symbol, T.module]);
  if (!open || !q?.symbol) return null;

  const sections = ctx?.sections || [];
  const chosen = sections.filter((s: any) => s.ok && !off[s.key]);
  const skipped = sections.filter((s: any) => s.ok && off[s.key]);
  const has = (key: string) => chosen.some((s: any) => s.key === key);
  const labelOf = (key: string) => sections.find((s: any) => s.key === key)?.label || key;

  const techReady = baseCode(m1Data?.snapshot?.symbol || '') === baseCode(symbol);
  const base = { symbol, code: baseCode(symbol), name: q.name, label: q.name, price: q.price, change_pct: q.change_pct };
  const data =
    task === 'tech'
      ? techReady
        ? {
            snapshot: m1Data.snapshot,
            signals: m1Data.signals,
            bollinger: m1Data.bollinger,
            weekly: m1Data.weekly_snapshot,
            scenarios: m1Data.scenarios,
            decision: m1Data.llm_result?.decision_payload,
            timeframe: m1Data.timeframe,
          }
        : null
      : task === 'event'
        ? {
            ...(baseCode(m2Data?.symbol || '') === baseCode(symbol) ? m2Data : {}),
            ...base,
            近期新聞: (digest?.items || []).slice(0, 8).map((n: any) => ({
              time: n.local_iso,
              kind: n.kind,
              source: n.source,
              title: n.title,
              sentiment: n.sentiment,
              reaction_pct: n.reaction?.pct ?? null,
            })),
          }
        : base;
  const key = data ? explainKey(T.module, data, true) : '';

  // 掛到 body：內容區有換頁動畫與圖層，放在裡面會被頂欄蓋住、遮罩也蓋不滿
  return ReactDOM.createPortal(
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: 遮罩點一下關閉；鍵盤用 Esc 或關閉鈕 */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: 同上 */}
      <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[3px]" onClick={onClose} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="AI 分析"
        data-tour="ai-drawer"
        className="fixed right-0 top-0 bottom-0 z-50 w-[min(440px,100vw)] overflow-y-auto border-l border-white/10 bg-[#0e1220]/95 p-[18px] flex flex-col gap-3 backdrop-blur-xl"
      >
        <div className="flex items-center justify-between">
          <h2 className="m-0 text-base font-bold text-white">✦ AI 分析</h2>
          <button type="button" onClick={onClose} aria-label="關閉 AI 分析" className="w-7 h-7 grid place-items-center rounded-lg text-slate-400 hover:text-white hover:bg-white/10 cursor-pointer">
            ✕
          </button>
        </div>
        <div>
          <b className="text-sm text-white">{T.title}</b>{' '}
          <span className="text-slate-400 text-sm">
            ・{q.name} {baseCode(symbol)}
          </span>
          <div className="text-[11.5px] text-slate-400 mt-0.5">{T.sub}</div>
        </div>
        <div className="inline-flex self-start gap-0.5 rounded-[10px] border border-white/10 bg-white/5 p-0.5">
          {Object.entries(TASKS).map(([id, t]) => (
            <button
              type="button"
              key={id}
              aria-pressed={task === id}
              onClick={() => setTask(id)}
              className={`px-[11px] py-1 rounded-lg text-xs cursor-pointer ${task === id ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-white'}`}
            >
              {t.tab}
            </button>
          ))}
        </div>

        <div>
          <div className="text-[12.5px] font-semibold text-slate-200 mb-1">傳給 AI 的資料面向（不含金鑰與其他私人資料）</div>
          {!ctx && <div className="text-xs text-slate-400">正在整理這檔有哪些資料…（不會呼叫 AI）</div>}
          {ctx?.error && <div className="text-xs text-amber-300">⚠️ 面向預覽失敗：{ctx.error}（仍可直接問，後端會照常抓資料）</div>}
          {ctx?.old && <div className="text-xs text-amber-300">這個版本的後端不支援面向預覽（要重新安裝新版）；仍可直接問，會參考全部面向。</div>}
          {sections.map((s: any) => (
            <details key={s.key} className={`bg-white/5 rounded-[10px] px-2.5 py-1.5 mb-[5px] ${s.ok ? '' : 'opacity-75'}`}>
              <summary className="cursor-pointer text-[13px] text-slate-200">
                <label className="inline-flex items-center gap-1.5 mr-1.5">
                  <input
                    type="checkbox"
                    disabled={!s.ok}
                    checked={s.ok && !off[s.key]}
                    onChange={(e) => setOff((p) => ({ ...p, [s.key]: !e.target.checked }))}
                  />
                  {s.label}
                </label>
                {s.ok ? (
                  <span className="px-2 py-px rounded-full text-[11px] text-emerald-400 bg-emerald-500/15">可用</span>
                ) : (
                  <span className="px-2 py-px rounded-full text-[11px] text-amber-300 bg-amber-500/15">資料不足</span>
                )}
              </summary>
              {s.ok ? (
                <ul className="mt-1 pl-[18px] list-disc text-xs text-slate-400 space-y-0.5">
                  {Object.entries(s.facts).map(([k, v]) => (
                    <li key={k} className="break-words">
                      {k}：{String(v)}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-[11.5px] text-slate-400 mt-1">資料不足：{s.why}</div>
              )}
            </details>
          ))}
        </div>

        {task === 'tech' && !techReady && (
          <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-slate-300 space-y-2">
            <div>技術面快評要用這檔算好的價位與訊號，目前還沒有 {baseCode(symbol)} 的技術分析結果。</div>
            <button type="button" onClick={onRunTech} className="px-3 py-1.5 rounded-lg bg-white/10 text-white cursor-pointer hover:bg-white/15">
              先跑這檔的技術分析
            </button>
          </div>
        )}

        {data && key && (
          <>
            <div>
              <div className="text-xs text-slate-400 mb-1">可以這樣問（點一下填進輸入框，再按下面的按鈕才會送出）</div>
              <div className="flex flex-wrap gap-1.5">
                {T.questions.map((x) => {
                  const miss = sections.length ? x.needs.filter((n) => !has(n)) : [];
                  return (
                    <button
                      type="button"
                      key={x.label}
                      disabled={miss.length > 0}
                      title={miss.length ? `需要「${miss.map(labelOf).join('、')}」，目前資料不足或沒有勾選` : undefined}
                      onClick={() => setExplainQuestion(key, x.label)}
                      className="px-2.5 py-[3px] rounded-full text-xs border border-white/10 text-slate-300 cursor-pointer hover:border-[#4f7cff] hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {x.label}
                    </button>
                  );
                })}
              </div>
            </div>
            {sections.length > 0 && chosen.length === 0 ? (
              <div className="text-xs text-amber-300">至少勾選一個可用的面向才能分析。</div>
            ) : (
              <AiExplain
                module={T.module}
                data={data}
                title="問 AI"
                drawer
                aspects={sections.length ? chosen.map((s: any) => s.key) : undefined}
                skippedLabels={skipped.map((s: any) => s.label)}
              />
            )}
            <div className="text-[11.5px] text-slate-500">會用你設定的 AI 連線，可能產生費用；要按下按鈕才會送出。沒勾的面向不會抓也不會送，AI 會寫「資料不足」而不是猜。</div>
          </>
        )}
      </aside>
    </>,
    document.body,
  );
}

export { AiDrawer };
