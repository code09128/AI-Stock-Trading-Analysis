import { bus } from '../bus';
import { NEWS_PRESETS } from '../config';
import { Tip, baseCode, normSym, uniqueSymbols } from '../ui';
import { AiExplain, useAISettings } from '../ai_store';
import { usePortfolio } from '../portfolio_store';
import { ResearchSummary, useDigest } from './news_research';

// 新聞判斷：新聞催化劑與 Priced-in
function Mod2Panel({ ctx }) {
  const { m2Data, m2Form, m2Loading, runMod2, setM2Form } = ctx;

  const { holdings } = usePortfolio();
  const heldSymbols = uniqueSymbols(holdings.map((h) => h.symbol));
  const { useState } = React;
  const aiCfg = useAISettings();
  const aiOn = aiCfg.scope.mod2 !== false && !!aiCfg.profiles.find((p) => p.id === aiCfg.activeId);
  const digest = useDigest(m2Form.target, aiOn);
  const [step, setStep] = useState('');
  // 一鍵分析：抓新聞並整理 → 系統挑出最重要的一則 → 用它發布當下已知的價格做 Priced-in 評估
  // 情緒方向：沒有指定時用標題關鍵字規則（粗略）；想要 AI 判斷請在進階區勾選「改由 AI 判斷」
  const analyze = async () => {
    setStep('正在抓取並整理新聞…');
    const dig = await digest.run();
    const lead = dig?.summary?.lead;
    if (!lead) {
      setStep('');
      bus.toast?.(
        dig?.fail ? `⚠️ 新聞整理失敗：${dig.fail}` : `⚠️ ${m2Form.target} 近期沒有可分析的新聞或公告`,
      );
      return;
    }
    setStep('正在用重點新聞評估是否已反映在股價…');
    const f = {
      ...m2Form,
      headline: lead.title,
      timestamp_iso: lead.local_iso,
      use_event_date: true,
      sentiment: lead.sentiment || 'NEUTRAL',
    };
    setM2Form(f);
    await runMod2({
      ...f,
      sentiment_source:
        lead.sentiment_by === 'AI'
          ? 'AI 逐則判斷（整理新聞時，只看標題與摘要）'
          : '標題關鍵字規則（粗估）',
    });
    setStep('');
  };
  // 從看盤頁熱力圖「查今天的新聞」過來：自動分析一次
  React.useEffect(() => {
    if (bus._autoNews && bus._autoNews === m2Form.target) {
      bus._autoNews = null;
      analyze();
    }
    // eslint-disable-next-line
  }, [m2Form.target]);
  const pickNews = async (it) => {
    // 用新聞發布當下已知的真實價格計算「事件前」漲幅（use_event_date），情緒方向由標題關鍵字規則或 AI 判斷
    const f = {
      ...m2Form,
      headline: it.title,
      timestamp_iso: it.local_iso,
      use_event_date: true,
      sentiment: it.sentiment || m2Form.sentiment,
    };
    setM2Form(f);
    await runMod2({
      ...f,
      sentiment_source:
        it.sentiment_by === 'AI'
          ? 'AI 逐則判斷（整理新聞時，只看標題與摘要）'
          : '標題關鍵字規則（粗估）',
    });
  };
  return (
    <div className="space-y-5">
      <div
        data-tour="mod2-news"
        className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5 space-y-3"
      >
        <div>
          <h2 className="text-base font-semibold text-white">新聞研究</h2>
          <p className="mt-1 text-xs text-slate-400">
            輸入代號按「分析新聞」：自動抓近期真實新聞與公告 → 整理並挑出最重要的一則 →
            用它發布當下已知的價格，判斷消息是否已反映在股價。結論都附出處，沒有資料會明講缺口。
          </p>
        </div>
        {heldSymbols.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <b className="text-amber-200">我的持股</b>
            {heldSymbols.map((sym) => (
              <button
                type="button"
                key={sym}
                onClick={() => {
                  bus._autoNews = sym;
                  setM2Form({
                    ...m2Form,
                    target: sym,
                    headline: '',
                    ret_5d_pct: '',
                    ret_20d_pct: '',
                    invalidation_criteria: '',
                  });
                }}
                className={`px-2 py-0.5 rounded-md mono border cursor-pointer ${
                  baseCode(normSym(sym)) === baseCode(normSym(m2Form.target || ''))
                    ? 'bg-amber-500/30 border-amber-400 text-white'
                    : 'border-slate-700 text-slate-300 hover:border-slate-500'
                }`}
              >
                {sym}
              </button>
            ))}
            <span className="text-slate-500">點代號自動分析該檔新聞</span>
          </div>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-44">
            <label htmlFor="m2-quick-target" className="block text-xs text-slate-400 mb-1">
              股票代號
            </label>
            <input
              id="m2-quick-target"
              type="text"
              value={m2Form.target}
              onChange={(e) => setM2Form({ ...m2Form, target: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !digest.loading && !m2Loading) analyze();
              }}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm font-mono text-white"
            />
          </div>
          <button
            type="button"
            onClick={analyze}
            disabled={digest.loading || m2Loading}
            className="px-5 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-60 text-white font-semibold text-sm cursor-pointer"
          >
            {digest.loading || m2Loading ? '分析中…' : '分析新聞'}
          </button>
          <span className="text-xs text-slate-400" role="status" aria-live="polite">
            {step ||
              (aiOn ? '已啟用 AI：整理新聞時會呼叫 AI' : '未啟用 AI：只用關鍵字規則（粗略）')}
          </span>
        </div>
      </div>

      <ResearchSummary
        d={digest.d && !digest.d.fail ? digest.d : null}
        m2Data={m2Data}
        onPick={pickNews}
      />
      {digest.d?.fail && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/5 px-4 py-3 text-xs text-rose-200">
          ⚠️ 新聞整理失敗：{digest.d.fail}
        </div>
      )}

      {m2Data && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {m2Data.sentiment_info && (
            <div className="md:col-span-2 text-xs rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-2">
              <span className="text-slate-400">
                情緒方向：
                <Tip text="利多／利空由你選，或勾選「改由 AI 判斷」；系統再用價格資料檢查消息是否已被股價反映。" />
              </span>
              <b className="text-white">
                {{ POSITIVE: '利多', NEGATIVE: '利空', NEUTRAL: '中性' }[m2Data.sentiment] ||
                  m2Data.sentiment}
              </b>
              <span className="text-slate-400">（判斷來源：{m2Data.sentiment_info.source}）</span>
              {m2Data.sentiment_info.reason && (
                <span className="text-slate-300">　{m2Data.sentiment_info.reason}</span>
              )}
            </div>
          )}
          {m2Data.event_price_context?.available && (
            <div className="md:col-span-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-xs text-emerald-100 space-y-1">
              <div className="font-bold text-emerald-300">
                事件前後的真實價格反應（用新聞發布當下已知的收盤價計算）
                <Tip text="事件前 N 日＝發布當下已知的最後收盤價 vs N 個交易日前（盤前、盤中發布看不到當天收盤）；事件後＝之後實際的收盤變化，可用來回頭檢驗判斷。" />
              </div>
              <div className="font-mono">
                事件前收盤 {m2Data.event_price_context.close_before_event}（
                {m2Data.event_price_context.as_of_bar}）・事件前 5 日{' '}
                {m2Data.event_price_context.ret_5d_pct}%・10 日{' '}
                {m2Data.event_price_context.ret_10d_pct}
                %・20 日 {m2Data.event_price_context.ret_20d_pct}%
              </div>
              {m2Data.event_price_context.next_day_return_pct != null ? (
                <div className="font-mono">
                  事件後首個交易日 {m2Data.event_price_context.next_day_bar}：
                  {m2Data.event_price_context.next_day_return_pct}%
                  {m2Data.event_price_context.after_5d_return_pct != null
                    ? `；第 5 個交易日累計 ${m2Data.event_price_context.after_5d_return_pct}%`
                    : ''}
                </div>
              ) : (
                <div className="text-slate-400">事件後尚無收盤價（可能剛發生）。</div>
              )}
            </div>
          )}
          <div
            className={`rounded-xl p-5 border ${
              m2Data.priced_in_evaluation?.priced_in_risk
                ? 'bg-amber-950/30 border-amber-500/40'
                : 'bg-emerald-950/25 border-emerald-500/40'
            }`}
          >
            <div className="text-xs font-mono uppercase text-slate-400">
              消息是否已反映在股價（Priced-in）
              <Tip text="Priced-in＝消息已提前反映在股價。利多新聞若事件前 20 日已漲 ≥10% 或 5 日已漲 ≥6%，公布後容易「利多出盡」；利空前已跌同樣幅度，則可能「利空出盡」。數字用真實日 K 計算。" />
            </div>
            <div className="text-lg font-bold mt-1 text-white">
              {m2Data.priced_in_evaluation?.priced_in_risk
                ? '⚠️ 消息可能已反映在股價，追價風險高'
                : '✅ 尚未過度反應（具順勢操作空間）'}
            </div>
            <p className="text-xs text-slate-300 mt-2 leading-relaxed">
              {m2Data.priced_in_evaluation?.analysis_note ?? m2Data.priced_in_evaluation?.warning}
            </p>
            <div className="mt-3 pt-3 border-t border-slate-800/80 flex justify-between text-xs font-mono text-slate-400">
              <span>
                發布時段:{' '}
                {{ PRE: '盤前', REGULAR: '盤中', POST: '盤後', CLOSED: '休市日' }[m2Data.session] ||
                  m2Data.session}
                {m2Data.session_note && (
                  <span className="ml-1 text-[11px] text-slate-500">（{m2Data.session_note}）</span>
                )}
              </span>
              <span>
                市場首次反應:{' '}
                {m2Data.session === 'POST' || m2Data.session === 'CLOSED' ? '下一個交易日' : '當日'}
              </span>
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
            <div className="text-xs font-mono uppercase text-slate-400">
              ATR 預期波動區間
              <Tip text="ATR(14)＝近 14 天平均每天的真實波動。預期區間＝現價 ± ATR×1.5，是消息後一天常見的上下範圍，只是統計範圍、不代表方向；台股另受 ±10% 漲跌停限制。" />
            </div>
            <div className="grid grid-cols-2 gap-3 font-mono">
              <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                <div className="text-[11px] text-slate-400">
                  事件預期下限 ~ 上限
                  <Tip text="現價 − ATR×1.5 ～ 現價 + ATR×1.5。" />
                </div>
                <div className="text-sm font-bold text-sky-300 mt-1">
                  {m2Data.volatility_bounds?.lower_bound} ~ {m2Data.volatility_bounds?.upper_bound}
                </div>
              </div>
              <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                <div className="text-[11px] text-slate-400">
                  預期單日波動（ATR×1.5）
                  <Tip text="ATR×1.5 ÷ 現價，換算成百分比的常見單日波動幅度。" />
                </div>
                <div className="text-sm font-bold text-amber-300 mt-1">
                  ±{m2Data.volatility_bounds?.expected_move_pct}%
                </div>
              </div>
            </div>
            <div
              className={`p-3 rounded-lg border text-xs ${
                m2Data.invalidation_audit?.valid
                  ? 'bg-emerald-950/30 border-emerald-700/40 text-emerald-300'
                  : 'bg-rose-950/40 border-rose-600/50 text-rose-300'
              }`}
            >
              <div className="font-bold">
                {m2Data.invalidation_audit?.valid
                  ? '✅ 失效出場條件審查通過（具備量化可驗證性）'
                  : '❌ 停損條件太模糊，請寫出具體價格或百分比'}
              </div>
              <div className="mt-1 text-[11px] opacity-90">
                {m2Data.invalidation_audit?.reason ?? m2Data.invalidation_audit?.criteria}
              </div>
            </div>
          </div>
        </div>
      )}
      {m2Data && (
        <AiExplain
          module="mod2"
          provenance={[
            m2Form.use_event_date
              ? { text: '新聞標題與時間來自你選的真實新聞；事件前後漲幅用真實日 K 計算' }
              : {
                  text: '目前的新聞標題是範例／手動輸入，不是真實新聞（可先按「分析新聞」）',
                  sample: true,
                },
            { text: 'ATR、波動區間為真實日 K 計算' },
          ]}
          data={{
            ...m2Data,
            news_research: digest.d?.summary
              ? {
                  tone: digest.d.summary.tone,
                  counts: digest.d.summary.counts,
                  gaps: digest.d.summary.gaps,
                  lead: digest.d.summary.lead,
                  risk_lead: digest.d.summary.risk_lead,
                  mode: digest.d.mode,
                  evidence: (digest.d.items || [])
                    .filter((it) => it.kind !== '分析專欄')
                    .slice(0, 6)
                    .map((it, i) => ({
                      no: i + 1,
                      time: it.local_iso,
                      kind: it.kind,
                      source: it.source,
                      title: it.title,
                      sentiment: it.sentiment,
                      timing: it.timing,
                      reaction_pct: it.reaction?.pct ?? null,
                    })),
                }
              : undefined,
          }}
        />
      )}

      <details
        data-tour="mod2-advanced"
        className="rounded-2xl border border-slate-800 bg-slate-900/60"
      >
        <summary className="cursor-pointer select-none px-5 py-3 text-sm font-semibold text-slate-200 hover:text-white">
          手動輸入：自己填新聞標題、情緒與事件前漲幅，測試「假設這則消息」（新聞清單與逐則細節在上面的新聞研究）
        </summary>
        <div className="p-5 space-y-4">
          <span className="block text-xs text-slate-500">
            這裡的標題與情緒是你自己填的，不是真實新聞；股價、ATR、事件前漲幅來自真實日
            K（Yahoo/FinMind）。 判斷消息是否已提前反映在股價，並估算事件後的合理波動範圍。
          </span>
          <div className="flex flex-wrap gap-2">
            {NEWS_PRESETS.map((preset) => (
              <button
                type="button"
                key={preset.label}
                onClick={() => {
                  setM2Form(preset);
                  runMod2(preset);
                }}
                className="text-xs px-3 py-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 text-sky-300 border border-slate-800 transition cursor-pointer"
              >
                {preset.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
            <div className="md:col-span-4">
              <label htmlFor="m2-sentiment" className="block text-xs text-slate-400 mb-1">
                新聞情緒方向
                {aiOn && (
                  <span className="ml-2 inline-flex items-center gap-1 text-violet-300">
                    <input
                      type="checkbox"
                      checked={!!m2Form.ai_sentiment}
                      onChange={(e) => setM2Form({ ...m2Form, ai_sentiment: e.target.checked })}
                      aria-label="改由 AI 判斷情緒"
                    />
                    改由 AI 判斷
                  </span>
                )}
              </label>
              <select
                id="m2-sentiment"
                value={m2Form.sentiment}
                onChange={(e) => setM2Form({ ...m2Form, sentiment: e.target.value })}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
              >
                <option value="POSITIVE">POSITIVE (利多催化)</option>
                <option value="NEGATIVE">NEGATIVE (利空衝擊)</option>
                <option value="NEUTRAL">NEUTRAL (中性訊息)</option>
              </select>
            </div>
            <div className="md:col-span-4">
              <label htmlFor="m2-ret5" className="block text-xs text-slate-400 mb-1">
                事件前 5 日累計漲跌 (%)
              </label>
              <input
                id="m2-ret5"
                type="number"
                step="0.1"
                value={m2Form.ret_5d_pct ?? ''}
                onChange={(e) =>
                  setM2Form({
                    ...m2Form,
                    ret_5d_pct: e.target.value === '' ? '' : Number(e.target.value),
                  })
                }
                placeholder="留空＝用真實日 K 計算"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm font-mono text-white"
              />
            </div>
            <div className="md:col-span-4">
              <label htmlFor="m2-ret20" className="block text-xs text-slate-400 mb-1">
                事件前 20 日累計漲跌 (%)
              </label>
              <input
                id="m2-ret20"
                type="number"
                step="0.1"
                value={m2Form.ret_20d_pct ?? ''}
                onChange={(e) =>
                  setM2Form({
                    ...m2Form,
                    ret_20d_pct: e.target.value === '' ? '' : Number(e.target.value),
                  })
                }
                placeholder="留空＝用真實日 K 計算"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm font-mono text-white"
              />
            </div>
            <div className="md:col-span-12">
              <label htmlFor="m2-headline" className="block text-xs text-slate-400 mb-1">
                新聞事件標題 / 摘要
              </label>
              <input
                id="m2-headline"
                type="text"
                value={m2Form.headline}
                onChange={(e) => setM2Form({ ...m2Form, headline: e.target.value })}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
              />
            </div>
            <div className="md:col-span-9">
              <label htmlFor="m2-inv" className="block text-xs text-slate-400 mb-1">
                停損／判斷失效條件（Invalidation，要寫出具體價格或百分比，例如「跌破 980
                停損」；太模糊會被系統退回）
              </label>
              <input
                id="m2-inv"
                type="text"
                value={m2Form.invalidation_criteria}
                onChange={(e) => setM2Form({ ...m2Form, invalidation_criteria: e.target.value })}
                placeholder="留空＝系統用真實支撐／壓力自動產生"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
              />
            </div>
            <div className="md:col-span-3 flex items-end">
              <button
                type="button"
                onClick={() => runMod2()}
                disabled={m2Loading}
                className="w-full py-2 px-4 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-semibold text-sm shadow-lg shadow-sky-600/25 transition cursor-pointer"
              >
                {m2Loading ? '評估中...' : '執行 Priced-in 評估'}
              </button>
            </div>
          </div>
        </div>
      </details>
    </div>
  );
}

export { Mod2Panel };
