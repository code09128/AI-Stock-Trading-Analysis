(() => {
  // 新聞判斷：新聞催化劑與 Priced-in
  function Mod2Panel({ ctx }) {
    const { m2Data, m2Form, m2Loading, runMod2, setM2Form } = ctx;
    const { NEWS_PRESETS } = window.TA;
    const { useState } = React;
    const [news, setNews] = useState(null);
    const aiCfg = window.TA.useAISettings();
    const aiOn =
      aiCfg.scope.mod2 !== false && !!aiCfg.profiles.find((p) => p.id === aiCfg.activeId);
    const [newsLoading, setNewsLoading] = useState(false);
    const loadNews = async () => {
      setNewsLoading(true);
      try {
        const res = await fetch('/api/news', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbol: m2Form.target }),
        });
        const d = await res.json();
        if (d.error) throw new Error(d.error);
        setNews(d);
      } catch (e) {
        setNews({ items: [], sources: [], errors: [e.message] });
      } finally {
        setNewsLoading(false);
      }
    };
    const pickNews = (it) => {
      // 用新聞發布當下已知的真實價格計算「事件前」漲幅（use_event_date），情緒方向仍由你判斷
      const f = {
        ...m2Form,
        headline: it.title,
        timestamp_iso: it.local_iso,
        use_event_date: true,
      };
      setM2Form(f);
      runMod2(f);
    };
    return (
      <div className="space-y-5">
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-white">
                📰 新聞判斷：新聞催化劑與 Priced-in 利多鈍化實驗室
              </h2>
              <span className="inline-block mt-1 text-[11px] px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
                資料狀態：新聞標題與情緒是「範例輸入」，可自行修改；股價、ATR、事件前漲幅來自真實日
                K（Yahoo/FinMind）
              </span>
              <p className="text-xs text-slate-400">
                檢測事件發布前股價是否已提前反應（Priced-in），並根據 ATR
                計算事件後合理波動上下限與審查失效條件
              </p>
            </div>
          </div>

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

          <div
            className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-3 space-y-2"
            data-tour="mod2-news"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs text-sky-200">
                📡 抓取「{m2Form.target}」最新真實新聞／公告（Google
                News、Yahoo、證交所重大訊息、SEC 8-K）。 點一則 →
                自動帶入標題與發布時間，並用當時已知的真實價格算事件前漲幅。
              </div>
              <button
                type="button"
                onClick={loadNews}
                disabled={newsLoading}
                className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold cursor-pointer"
              >
                {newsLoading ? '抓取中…' : '抓取最新新聞'}
              </button>
            </div>
            {news && (
              <div className="space-y-1">
                <div className="text-[11px] text-slate-400">
                  {news.sources?.join('・')}
                  {news.errors?.map((e) => (
                    <span key={e} className="text-rose-300 ml-2">
                      ⚠️ {e}
                    </span>
                  ))}
                </div>
                <div className="max-h-60 overflow-y-auto space-y-1">
                  {news.items.map((it) => (
                    <button
                      type="button"
                      key={`${it.published_utc}-${it.title}`}
                      onClick={() => pickNews(it)}
                      className="w-full text-left px-3 py-1.5 rounded-lg bg-slate-950/70 border border-slate-800 hover:border-sky-400 text-xs cursor-pointer"
                    >
                      <span className="text-slate-500 font-mono mr-2">
                        {it.local_iso.replace('T', ' ').slice(0, 16)}
                      </span>
                      <span className="text-[10px] px-1 rounded bg-slate-800 text-sky-300 mr-2">
                        {it.kind}
                      </span>
                      <span className="text-slate-200">{it.title}</span>
                      <span className="text-slate-500 ml-2">— {it.source}</span>
                    </button>
                  ))}
                  {news.items.length === 0 && (
                    <div className="text-xs text-slate-500">
                      沒有抓到新聞（可能該代號近期無報導）。
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
            <div className="md:col-span-3">
              <label htmlFor="m2-target" className="block text-xs text-slate-400 mb-1">
                股票代號
              </label>
              <input
                id="m2-target"
                type="text"
                value={m2Form.target}
                onChange={(e) => setM2Form({ ...m2Form, target: e.target.value })}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm font-mono text-white"
              />
            </div>
            <div className="md:col-span-3">
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
            <div className="md:col-span-3">
              <label htmlFor="m2-ret5" className="block text-xs text-slate-400 mb-1">
                事件前 5 日累計漲跌 (%)
              </label>
              <input
                id="m2-ret5"
                type="number"
                step="0.1"
                value={m2Form.ret_5d_pct}
                onChange={(e) => setM2Form({ ...m2Form, ret_5d_pct: Number(e.target.value) })}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm font-mono text-white"
              />
            </div>
            <div className="md:col-span-3">
              <label htmlFor="m2-ret20" className="block text-xs text-slate-400 mb-1">
                事件前 20 日累計漲跌 (%)
              </label>
              <input
                id="m2-ret20"
                type="number"
                step="0.1"
                value={m2Form.ret_20d_pct}
                onChange={(e) => setM2Form({ ...m2Form, ret_20d_pct: Number(e.target.value) })}
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
                進場邏輯失效條件 (必須包含具體價格、跌破或百分比，否則將被防幻覺攔截)
              </label>
              <input
                id="m2-inv"
                type="text"
                value={m2Form.invalidation_criteria}
                onChange={(e) => setM2Form({ ...m2Form, invalidation_criteria: e.target.value })}
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
                {m2Loading ? '評估中...' : '⚡ 執行 Priced-in 評估'}
              </button>
            </div>
          </div>
        </div>

        {m2Data && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {m2Data.sentiment_info && (
              <div className="md:col-span-2 text-xs rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-2">
                <span className="text-slate-400">
                  情緒方向：
                  <window.TA.Tip text="利多／利空由你選，或勾選「改由 AI 判斷」；系統再用價格資料檢查消息是否已被股價反映。" />
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
                  🕒 事件前後的真實價格反應（用新聞發布當下已知的收盤價計算）
                  <window.TA.Tip text="事件前 N 日＝發布當下已知的最後收盤價 vs N 個交易日前（盤前、盤中發布看不到當天收盤）；事件後＝之後實際的收盤變化，可用來回頭檢驗判斷。" />
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
                Priced-in 利多鈍化 / 利空出盡檢測
                <window.TA.Tip text="Priced-in＝消息已提前反映在股價。利多新聞若事件前 20 日已漲 ≥10% 或 5 日已漲 ≥6%，公布後容易「利多出盡」；利空前已跌同樣幅度，則可能「利空出盡」。數字用真實日 K 計算。" />
              </div>
              <div className="text-lg font-bold mt-1 text-white">
                {m2Data.priced_in_evaluation?.priced_in_risk
                  ? '⚠️ 高度 Priced-in 鈍化風險（嚴禁追價）'
                  : '✅ 尚未過度反應（具順勢操作空間）'}
              </div>
              <p className="text-xs text-slate-300 mt-2 leading-relaxed">
                {m2Data.priced_in_evaluation?.analysis_note ?? m2Data.priced_in_evaluation?.warning}
              </p>
              <div className="mt-3 pt-3 border-t border-slate-800/80 flex justify-between text-xs font-mono text-slate-400">
                <span>
                  發布時段:{' '}
                  {{ PRE: '盤前', REGULAR: '盤中', POST: '盤後' }[m2Data.session] || m2Data.session}
                </span>
                <span>市場首次反應: {m2Data.session === 'POST' ? '下一個交易日' : '當日'}</span>
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
              <div className="text-xs font-mono uppercase text-slate-400">
                ATR 預期波動區間
                <window.TA.Tip text="ATR(14)＝近 14 天平均每天的真實波動。預期區間＝現價 ± ATR×1.5，是消息後一天常見的上下範圍，只是統計範圍、不代表方向；台股另受 ±10% 漲跌停限制。" />
              </div>
              <div className="grid grid-cols-2 gap-3 font-mono">
                <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                  <div className="text-[11px] text-slate-400">
                    事件預期下限 ~ 上限
                    <window.TA.Tip text="現價 − ATR×1.5 ～ 現價 + ATR×1.5。" />
                  </div>
                  <div className="text-sm font-bold text-sky-300 mt-1">
                    {m2Data.volatility_bounds?.lower_bound} ~{' '}
                    {m2Data.volatility_bounds?.upper_bound}
                  </div>
                </div>
                <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                  <div className="text-[11px] text-slate-400">
                    預期單日波動（ATR×1.5）
                    <window.TA.Tip text="ATR×1.5 ÷ 現價，換算成百分比的常見單日波動幅度。" />
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
                    : '❌ 防幻覺攔截：失效出場條件過於模糊！'}
                </div>
                <div className="mt-1 text-[11px] opacity-90">
                  {m2Data.invalidation_audit?.reason ?? m2Data.invalidation_audit?.criteria}
                </div>
              </div>
            </div>
          </div>
        )}
        {m2Data && (
          <window.TA.AiExplain
            module="mod2"
            provenance={[
              m2Form.use_event_date
                ? { text: '新聞標題與時間來自你選的真實新聞；事件前後漲幅用真實日 K 計算' }
                : {
                    text: '目前的新聞標題是範例／手動輸入，不是真實新聞（可先按「抓取最新新聞」）',
                    sample: true,
                  },
              { text: 'ATR、波動區間為真實日 K 計算' },
            ]}
            data={m2Data}
          />
        )}
      </div>
    );
  }

  window.TA = Object.assign(window.TA || {}, { Mod2Panel });
})();
