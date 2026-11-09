// 個股頁與分析頁（策略回測／組合風控／交易檢討）右側的 AI 抽屜：
// 看每個資料面向有沒有資料、勾選要傳哪些 → 點選建議問題或自由提問 → 串流解讀與數字核對。
// 沿用 AiExplain、後端串流、提示詞與數字核對，不另外寫一套 AI 邏輯。
import { AiExplain, explainKey, myPosition, setExplainQuestion } from '../ai_store';
import { DEFAULT_HOLDINGS } from '../config';
import { cachedJson } from '../fetch_cache';
import { usePortfolio } from '../portfolio_store';
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
      { label: '現在適合進場／加碼嗎？', needs: ['price', 'tech'] },
      { label: '估值貴不貴？', needs: ['fundamentals'] },
      { label: '法人最近在買還是賣？', needs: ['chips'] },
      { label: '停損放哪裡？', needs: ['price', 'tech'] },
      { label: '下次財報前，市場最在意哪個數字？', needs: ['earnings'] },
      { label: '最近消息是利多還是利空？已反映了嗎？', needs: ['news'] },
      { label: '目前最大的風險是什麼？', needs: ['price', 'tech'] },
    ],
  },
  tech: {
    module: 'mod1',
    tab: '技術面',
    title: '盤後技術面快評',
    sub: '觀點、核心理由、關鍵價位、多空劇本、操作計畫',
    questions: [
      { label: '趨勢現在是多是空？', needs: ['tech'] },
      { label: '關鍵支撐壓力在哪？', needs: ['tech'] },
      { label: 'RSI 與量能有沒有警訊？', needs: ['tech'] },
      { label: '停損放哪裡？', needs: ['price', 'tech'] },
      { label: '已持有／空手各該怎麼做？', needs: ['price', 'tech'] },
    ],
  },
  event: {
    module: 'mod2',
    tab: '事件',
    title: '事件快評（Desk Note）',
    sub: '定調、已定價多少、預期差、交易含義、反方解讀',
    questions: [
      { label: '這些消息已經反映在股價了嗎？', needs: ['news', 'price'] },
      { label: '隔天預期波動區間多大？', needs: ['price', 'tech'] },
      { label: '消息出來後怎麼處理？', needs: ['news', 'tech'] },
    ],
  },
};

function AiDrawer({ q, open, task, setTask, onClose, m1Data, m2Data, digest, onRunTech }: { q: any; open: boolean; task: string; setTask: (t: string) => void; onClose: () => void; m1Data: any; m2Data: any; digest: any; onRunTech: () => void }) {
  const T = TASKS[task] || TASKS.stock;
  const symbol = q?.symbol || '';
  const { holdings } = usePortfolio();
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
    cachedJson('/api/ai/context', { symbol, module: T.module }, 60000)
      .then((d) => (d?._status === 404 ? { old: true, sections: [] } : d))
      .then((d) => !stop && setCtx(d))
      .catch((e) => !stop && setCtx({ error: e.message, sections: [] }));
    return () => {
      stop = true;
    };
  }, [open, symbol, T.module]);
  if (!open || !q?.symbol) return null;

  const techReady = baseCode(m1Data?.snapshot?.symbol || '') === baseCode(symbol);
  const base = { symbol, code: baseCode(symbol), name: q.name, label: q.name, price: q.price, change_pct: q.change_pct };
  const pos = myPosition(T.module, base, holdings);

  const rawSections: any[] = [...(ctx?.sections || [])];
  // 若前端已有 m1Data，補齊或強化「技術指標」面向
  if (techReady && m1Data?.snapshot) {
    const snap = m1Data.snapshot;
    const lv = m1Data.scenarios?.levels || {};
    const techFacts: Record<string, string> = {
      趨勢評分: snap.trend_score ? `${snap.trend_score.total}/100（${snap.trend_score.signal_label}）` : '—',
      RSI14: String(snap.indicators?.RSI14 ?? '—'),
      MA5: String(snap.indicators?.MA5 ?? '—'),
      MA20: String(snap.indicators?.MA20 ?? '—'),
      MA60: String(snap.indicators?.MA60 ?? '—'),
      支撐壓力: `S1 ${lv.S1 ?? snap.recent_low_20d ?? '—'} ／ R1 ${lv.R1 ?? snap.recent_high_20d ?? '—'}`,
    };
    const idx = rawSections.findIndex((s) => s.key === 'tech');
    if (idx >= 0) {
      rawSections[idx] = { ...rawSections[idx], ok: true, facts: { ...rawSections[idx].facts, ...techFacts }, why: '' };
    } else if (ctx) {
      rawSections.splice(1, 0, { key: 'tech', label: '技術指標', ok: true, facts: techFacts, why: '' });
    }
  }
  // 加入「我的持股部位」面向，讓使用者可單獨勾選是否傳給 AI
  if (ctx) {
    rawSections.push(
      pos
        ? {
            key: 'hold',
            label: '我的持股部位',
            ok: true,
            facts: {
              代號: String(pos.代號),
              持有股數: `${pos.股數} 股`,
              平均成本: String(pos.平均成本),
              ...(pos.目前損益率 != null ? { 目前損益率: `${pos.目前損益率 > 0 ? '+' : ''}${pos.目前損益率}%` } : {}),
            },
            why: '',
          }
        : {
            key: 'hold',
            label: '我的持股部位',
            ok: false,
            facts: {},
            why: '這檔目前沒有持股（建議會以空手者角度寫）',
          },
    );
  }

  const sections = rawSections;
  const chosen = sections.filter((s: any) => s.ok && !off[s.key]);
  const skipped = sections.filter((s: any) => s.ok && off[s.key]);
  const has = (key: string) => chosen.some((s: any) => s.key === key);
  const labelOf = (key: string) => sections.find((s: any) => s.key === key)?.label || key;

  const data =
    task === 'tech'
      ? techReady
        ? {
            snapshot: has('tech') || !sections.length ? m1Data.snapshot : { symbol: m1Data.snapshot?.symbol, latest_close: m1Data.snapshot?.latest_close, latest_date: m1Data.snapshot?.latest_date },
            signals: has('tech') || !sections.length ? m1Data.signals : [],
            bollinger: has('tech') || !sections.length ? m1Data.bollinger : null,
            weekly: has('tech') || !sections.length ? m1Data.weekly_snapshot : null,
            scenarios: has('tech') || !sections.length ? m1Data.scenarios : null,
            decision: has('tech') || !sections.length ? m1Data.llm_result?.decision_payload : null,
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
                  <span className="px-2 py-px rounded-full text-[11px] text-teal-300 bg-teal-500/15">可用</span>
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
              <div className="text-xs text-slate-400 mb-1">可以這樣問（點一下填進輸入框，再按下面的按鈕才會送出）；有填問題會直接回答該問題，輸入框留空才寫完整報告</div>
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
                aspects={sections.length ? chosen.filter((s: any) => s.key !== 'hold').map((s: any) => s.key) : undefined}
                skippedLabels={skipped.map((s: any) => s.label)}
                includeHoldings={!off.hold}
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

const MOD_META: Record<string, { title: string; sub: string; questions: Q[] }> = {
  mod3: {
    title: '策略審查',
    sub: '量化研究主管審查：績效拆解、過度擬合檢查、下一個實驗',
    questions: [
      { label: '這個策略能實際拿來用嗎？最大的風險是什麼？', needs: ['bt'] },
      { label: '參數要怎麼調整才不會過度擬合？', needs: ['bt', 'btsplit'] },
      { label: '空頭或盤整時要不要停用這個策略？', needs: ['bt', 'btsplit'] },
      { label: '如果只用這個策略，部位大小該怎麼控制？', needs: ['bt'] },
    ],
  },
  mod4: {
    title: '組合健檢',
    sub: '風險等級、三大風險、壓力測試、調整建議',
    questions: [
      { label: '我的組合最該先調整哪一個部位？請排優先順序。', needs: ['rk'] },
      { label: '哪幾檔 ETF 重複押注？可以怎麼精簡？', needs: ['rk'] },
      { label: '如果再遇到 2022 年那樣的升息，我該怎麼降低損失？', needs: ['rkstress'] },
      { label: '要不要加入債券或現金？比例多少比較合理？', needs: ['rk', 'rkstress'] },
    ],
  },
  mod5: {
    title: '交易檢討',
    sub: '診斷、數字、具體案例、三條紀律、下月目標',
    questions: [
      { label: '我最需要先改掉哪一個習慣？', needs: ['jn', 'jbias'] },
      { label: '幫我把三條紀律寫成下單前的檢查清單。', needs: ['jbias'] },
      { label: '以我的勝率和賺賠比，停損該設幾 % 比較合理？', needs: ['jn'] },
      { label: '下個月要怎麼追蹤自己有沒有進步？', needs: ['jn'] },
    ],
  },
};

function buildModSections(mod: string, m3Data: any, m4Data: any, m5Data: any) {
  if (mod === 'mod3') {
    const r = m3Data?.backtest_result;
    const st = m3Data?.strategy;
    const wf = m3Data?.walk_forward;
    const rg = m3Data?.regime_breakdown;
    return [
      {
        key: 'bt',
        label: '回測績效與風控設定',
        ok: !!r,
        facts: r
          ? {
              策略: `${st?.label || st?.key || '—'}（標的 ${m3Data?.symbol || '—'}）`,
              總報酬率: `${r.total_return_pct}%`,
              交易次數: `${r.total_trades} 筆`,
              勝率與獲利因子: `勝率 ${r.win_rate_pct}% ／ 獲利因子 ${r.profit_factor}`,
              最大回撤: `${r.max_drawdown_pct}%`,
            }
          : {},
        why: '尚未執行回測，請先按「執行回測」',
      },
      {
        key: 'btsplit',
        label: '多空環境與前後段驗證',
        ok: !!(wf || rg),
        facts:
          wf || rg
            ? {
                前段淨損益: wf?.best_train ? String(wf.best_train.net_pnl) : '—',
                後段淨損益: wf?.best_test ? String(wf.best_test.net_pnl) : '—',
                過度擬合警示: wf ? (wf.overfit_warning ? '有' : '無') : '—',
                多空環境分拆: rg ? `有（依 ${rg.index || '大盤'} 區分）` : '—',
              }
            : {},
        why: '回測期間太短，沒有前後段或多空環境驗證資料',
      },
    ];
  }
  if (mod === 'mod4') {
    const val = m4Data?.portfolio_valuation;
    const crash = m4Data?.crash_20pct_stress_test;
    const scen = m4Data?.scenario_stress;
    const hr = m4Data?.historical_replay;
    const weights = (val?.holdings || []).map((h: any) => Number(h.weight_pct) || 0);
    const look = Object.entries((m4Data?.lookthrough_exposure_pct || {}) as Record<string, number>)
      .filter(([sym]) => !sym.endsWith('其他成分股'))
      .sort((a, b) => b[1] - a[1])[0];
    return [
      {
        key: 'rk',
        label: '持股配置與穿透曝險',
        ok: !!val,
        facts: val
          ? {
              總市值: `NT$ ${Number(val.total_value_twd || 0).toLocaleString()}`,
              持股檔數: `${(val.holdings || []).length} 檔`,
              最大單一部位: weights.length ? `${Math.max(...weights)}%` : '—',
              穿透後最大曝險: look ? `${look[0]} ${look[1]}%` : '—',
            }
          : {},
        why: '尚未計算組合風控，請先新增持股並計算',
      },
      {
        key: 'rkstress',
        label: '壓力測試與相關係數',
        ok: !!(crash || scen || hr),
        facts:
          crash || scen || hr
            ? {
                組合Beta: String(m4Data?.portfolio_beta_used ?? '—'),
                大盤跌20估算: crash ? `${crash.expected_portfolio_drawdown_pct}%` : '—',
                歷史最大回撤: hr?.max_drawdown_pct != null ? `${hr.max_drawdown_pct}%` : '—',
                高相關配對: `${(scen?.correlation?.pairs || []).filter((p: any) => p.high).length} 組`,
              }
            : {},
        why: '沒有壓力測試資料',
      },
    ];
  }
  if (mod === 'mod5') {
    const stats = m5Data?.statistics;
    const closed = !!stats && m5Data?.closed_trades_used !== 0;
    const biases = m5Data?.detected_biases || [];
    const rules = m5Data?.personalized_3_rules || [];
    return [
      {
        key: 'jn',
        label: '交易成績與統計',
        ok: closed,
        facts: closed
          ? {
              平倉筆數: `${stats.total_trades ?? 0} 筆`,
              勝率: `${stats.win_rate_pct ?? 0}%`,
              賺賠比: String(stats.payoff_ratio ?? '—'),
              單筆期望值: `${stats.expectancy ?? 0} 元`,
              賣飛率: `${stats.sold_too_early_ratio_pct ?? 0}%`,
            }
          : {},
        why: '還沒有已賣出（平倉）的交易，或尚未執行交易診斷',
      },
      {
        key: 'jbias',
        label: '偏誤偵測與個人規則',
        ok: closed && !!(biases.length || rules.length),
        facts: {
          偵測到偏誤: biases.length ? biases.map((b: any) => b.bias_name || b.bias_type).join('、') : '無明顯偏誤',
          量化改善規則: `${rules.length} 條`,
        },
        why: '還沒有已賣出（平倉）的交易，尚無偏誤偵測與規則',
      },
    ];
  }
  return [];
}

function ModAiDrawer({
  mod,
  onClose,
  m3Data,
  m4Data,
  m5Data,
  m4Holdings,
  m5Source,
}: {
  mod: 'mod3' | 'mod4' | 'mod5' | null;
  onClose: () => void;
  m3Data: any;
  m4Data: any;
  m5Data: any;
  m4Holdings?: any[];
  m5Source?: string;
}) {
  const [off, setOff] = useState<Record<string, boolean>>({});
  // 只有換模組時才重設勾選：App 每次重畫都會給新的 onClose，不能放進同一個 effect，否則使用者取消的勾選會自己勾回去
  useEffect(() => {
    setOff({});
  }, [mod]);
  useEffect(() => {
    if (!mod) return undefined;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mod, onClose]);

  if (!mod) return null;
  const meta = MOD_META[mod];
  const sections = buildModSections(mod, m3Data, m4Data, m5Data);
  const chosen = sections.filter((s) => s.ok && !off[s.key]);
  const skipped = sections.filter((s) => s.ok && off[s.key]);
  const has = (k: string) => chosen.some((s) => s.key === k);
  const labelOf = (k: string) => sections.find((s) => s.key === k)?.label || k;

  // 送給 AI 的內容沿用各頁原本的資料，只依勾選切開；回測的逐日淨值與全部交易不送（量太大，AI 也用不到）
  let rawData: any = null;
  let provenance: any[] = [];
  if (mod === 'mod3' && m3Data?.backtest_result) {
    const r = m3Data.backtest_result;
    rawData = {
      symbol: m3Data.symbol,
      strategy: m3Data.strategy,
      params: m3Data.strategy_params,
      risk_settings: m3Data.risk_settings,
      ...(has('bt')
        ? {
            result: { ...r, daily_equity: undefined, blocked_dates: undefined, trades: (r.trades || []).slice(0, 12) },
            warnings: m3Data.strategy_warnings,
            next_step_ideas: m3Data.next_step_ideas,
          }
        : {}),
      ...(has('btsplit') ? { regime_breakdown: m3Data.regime_breakdown, walk_forward: m3Data.walk_forward } : {}),
    };
    provenance = [{ text: '回測使用真實還權日 K，並已扣除手續費與稅' }];
  } else if (mod === 'mod4' && m4Data) {
    rawData = {
      ...(has('rk')
        ? {
            portfolio_valuation: m4Data.portfolio_valuation,
            fx_rates: m4Data.fx_rates,
            fx_warning: m4Data.fx_warning,
            lookthrough_exposure_pct: m4Data.lookthrough_exposure_pct,
            lookthrough_sources: m4Data.lookthrough_sources,
            price_sources: m4Data.price_sources,
            rebalance_verification: m4Data.rebalance_verification,
          }
        : {}),
      ...(has('rkstress')
        ? {
            portfolio_beta_used: m4Data.portfolio_beta_used,
            portfolio_beta_source: m4Data.portfolio_beta_source,
            beta_detail: m4Data.beta_detail,
            crash_20pct_stress_test: m4Data.crash_20pct_stress_test,
            scenario_stress: m4Data.scenario_stress,
            historical_replay: m4Data.historical_replay,
          }
        : {}),
    };
    provenance = [
      JSON.stringify(m4Holdings) === JSON.stringify(DEFAULT_HOLDINGS)
        ? { text: '持股目前是範例（2330／0050／NVDA），不是你的真實部位，可從看盤頁「我的持股」帶入', sample: true }
        : { text: '持股來自你輸入／匯入的部位' },
      { text: '即時價、匯率、ETF 成分股、Beta、歷史回落為真實資料' },
    ];
  } else if (mod === 'mod5' && m5Data && m5Data.closed_trades_used !== 0) {
    rawData = {
      ...(has('jn')
        ? {
            statistics: m5Data.statistics,
            closed_trades_used: m5Data.closed_trades_used,
            entries_used: m5Data.entries_used,
            open_positions: m5Data.open_positions,
          }
        : {}),
      ...(has('jbias')
        ? {
            detected_biases: m5Data.detected_biases,
            personalized_3_rules: m5Data.personalized_3_rules,
            rules_source: m5Data.rules_source,
          }
        : {}),
    };
    provenance = [
      m5Source === 'mine'
        ? { text: '交易紀錄來自你輸入的資料' }
        : { text: '交易紀錄目前是內建範例，不是你的真實交易', sample: true },
    ];
  }

  const key = rawData ? explainKey(mod, rawData, true) : '';

  return ReactDOM.createPortal(
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: 遮罩點一下關閉 */}
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
          <button
            type="button"
            onClick={onClose}
            aria-label="關閉 AI 分析"
            className="w-7 h-7 grid place-items-center rounded-lg text-slate-400 hover:text-white hover:bg-white/10 cursor-pointer"
          >
            ✕
          </button>
        </div>
        <div>
          <b className="text-sm text-white">{meta.title}</b>{' '}
          <span className="text-slate-400 text-sm">
            ・{mod === 'mod3' ? m3Data?.symbol || '目前回測' : '目前頁面資料'}
          </span>
          <div className="text-[11.5px] text-slate-400 mt-0.5">{meta.sub}</div>
        </div>

        <div>
          <div className="text-[12.5px] font-semibold text-slate-200 mb-1">
            傳給 AI 的資料面向（不含金鑰與其他私人資料）
          </div>
          {sections.map((s) => (
            <details
              key={s.key}
              className={`bg-white/5 rounded-[10px] px-2.5 py-1.5 mb-[5px] ${s.ok ? '' : 'opacity-75'}`}
            >
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
                  <span className="px-2 py-px rounded-full text-[11px] text-teal-300 bg-teal-500/15">
                    可用
                  </span>
                ) : (
                  <span className="px-2 py-px rounded-full text-[11px] text-amber-300 bg-amber-500/15">
                    資料不足
                  </span>
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

        {!rawData ? (
          <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-amber-300">
            這一頁還沒有分析結果，請先在頁面上執行計算後再開啟 AI 分析。
          </div>
        ) : (
          <>
            <div>
              <div className="text-xs text-slate-400 mb-1">
                可以這樣問（點一下填進輸入框，再按下面的按鈕才會送出）；有填問題會直接回答該問題，輸入框留空才寫完整報告
              </div>
              <div className="flex flex-wrap gap-1.5">
                {meta.questions.map((x) => {
                  const miss = x.needs.filter((n) => !has(n));
                  return (
                    <button
                      type="button"
                      key={x.label}
                      disabled={miss.length > 0}
                      title={
                        miss.length
                          ? `需要「${miss.map(labelOf).join('、')}」，目前資料不足或沒有勾選`
                          : undefined
                      }
                      onClick={() => setExplainQuestion(key, x.label)}
                      className="px-2.5 py-[3px] rounded-full text-xs border border-white/10 text-slate-300 cursor-pointer hover:border-[#4f7cff] hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {x.label}
                    </button>
                  );
                })}
              </div>
            </div>
            {chosen.length === 0 ? (
              <div className="text-xs text-amber-300">至少勾選一個可用的面向才能分析。</div>
            ) : (
              <AiExplain
                module={mod}
                data={rawData}
                title="問 AI"
                provenance={provenance}
                drawer
                skippedLabels={skipped.map((s) => s.label)}
              />
            )}
            <div className="text-[11.5px] text-slate-500">
              會用你設定的 AI 連線，可能產生費用；要按下按鈕才會送出。沒勾的面向不會送給 AI，AI 會寫「資料不足」而不是猜。
            </div>
          </>
        )}
      </aside>
    </>,
    document.body,
  );
}

export { AiDrawer, ModAiDrawer };
