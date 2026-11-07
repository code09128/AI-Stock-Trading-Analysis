// 新聞研究摘要：把「近期新聞彙整」的 summary 與 Priced-in 結果整理成結論、已反映程度、資料缺口、時間軸與引用清單
// 結論句與語氣都是規則算出來的（不是 AI 編的）；每個結論都附出處，沒有資料就明講缺口。
import { Tip } from '../ui';
import { activeProfile, cleanProfile, loadAI } from '../ai_store';

const { useState } = React;

const OFFICIAL = ['重大訊息', '公司公告', '8-K'];

// 近期新聞彙整的資料與執行狀態（提到外面，讓「分析新聞」一鍵可以串起整理、挑重點、評估）
function useDigest(symbol, aiOn) {
  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(false);
  const run = async () => {
    setLoading(true);
    let out = null;
    try {
      const cfg = loadAI ? loadAI() : null;
      const prof = aiOn && cfg ? cleanProfile(activeProfile(cfg)) : null;
      const res = await fetch('/api/news/digest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, ai: prof }),
      });
      const j = await res.json();
      if (j.error) throw new Error(j.error);
      out = j;
      setD(j);
    } catch (e) {
      setD({ fail: e.message });
    } finally {
      setLoading(false);
    }
    return out;
  };
  return { d, loading, run };
}

// 台股紅漲綠跌：偏多用紅、偏空用綠；分歧琥珀；中性灰
const TONES = {
  偏多: { cls: 'bg-rose-500/15 border-rose-500/50 text-rose-200', icon: '▲' },
  偏空: { cls: 'bg-emerald-500/15 border-emerald-500/50 text-emerald-200', icon: '▼' },
  分歧: { cls: 'bg-amber-500/15 border-amber-500/50 text-amber-200', icon: '◆' },
  中性: { cls: 'bg-slate-700/40 border-slate-600 text-slate-200', icon: '●' },
  資料不足: { cls: 'bg-slate-800/60 border-slate-700 text-slate-400', icon: '○' },
};
const SENT = {
  POSITIVE: { label: '利多', cls: 'text-rose-300' },
  NEGATIVE: { label: '利空', cls: 'text-emerald-300' },
  NEUTRAL: { label: '中性', cls: 'text-slate-400' },
};

const fmtTime = (iso) => String(iso || '').replace('T', ' ').slice(0, 16);
const sign = (v) => (v == null ? '--' : `${v > 0 ? '+' : ''}${v}%`);

// 事件前漲幅與 Priced-in 門檻（news_strategy：20 日 ≥10% 或 5 日 ≥6% 視為可能已反映）
// 已反映要「漲跌方向和消息方向相同」才成立：利多前已漲、利空前已跌；方向相反（利多卻先跌）不算已反映
function Gauge({ label, value, limit, delay, sentiment }) {
  const v = Number(value);
  const ok = Number.isFinite(v);
  const ratio = ok ? Math.min(Math.abs(v) / limit, 1) : 0;
  const big = ok && Math.abs(v) >= limit;
  const over =
    big && ((sentiment === 'POSITIVE' && v > 0) || (sentiment === 'NEGATIVE' && v < 0));
  const opposite =
    big && ((sentiment === 'POSITIVE' && v < 0) || (sentiment === 'NEGATIVE' && v > 0));
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[11px] text-slate-400">
        <span>{label}</span>
        <span className={`font-mono ${over ? 'text-amber-300 font-semibold' : 'text-slate-300'}`}>
          {ok ? sign(v) : '--'}
          <span className="text-slate-500">（門檻 ±{limit}%）</span>
          {opposite && <span className="ml-1 text-sky-300">股價先反向走，未反映這個方向</span>}
        </span>
      </div>
      <div
        className="h-2 rounded-full bg-slate-800 overflow-hidden"
        role="img"
        aria-label={`${label} ${ok ? sign(v) : '無資料'}，門檻 ${limit}%${over ? '，已超過且方向與消息相同' : opposite ? '，已超過但方向與消息相反' : ''}`}
      >
        <div
          className={`h-2 rounded-full ta-grow-x ${over ? 'bg-amber-400' : 'bg-sky-500'}`}
          style={{ width: `${ratio * 100}%`, animationDelay: `${delay}ms` }}
        />
      </div>
    </div>
  );
}

function SentimentBar({ counts }) {
  const total = counts.positive + counts.negative + counts.neutral;
  if (!total) return <div className="text-[11px] text-slate-500">沒有可統計的新聞</div>;
  const seg = (n, cls) =>
    n > 0 ? (
      <div
        className={`h-2 ta-grow-x ${cls}`}
        style={{ width: `${(n / total) * 100}%` }}
        title={`${n} 則`}
      />
    ) : null;
  return (
    <div className="space-y-1">
      <div className="flex h-2 rounded-full overflow-hidden bg-slate-800">
        {seg(counts.positive, 'bg-rose-500')}
        {seg(counts.neutral, 'bg-slate-500')}
        {seg(counts.negative, 'bg-emerald-500')}
      </div>
      <div className="flex gap-3 text-[11px] text-slate-400">
        <span className="text-rose-300">利多 {counts.positive}</span>
        <span>中性 {counts.neutral}</span>
        <span className="text-emerald-300">利空 {counts.negative}</span>
      </div>
    </div>
  );
}

function ResearchSummary({ d, m2Data, onPick }) {
  const s = d?.summary;
  if (!s) return null;
  const tone = TONES[s.tone] || TONES.中性;
  const lead = s.lead;
  const pi = m2Data?.priced_in_evaluation;
  const events = s.counts.official + s.counts.news;
  const sentimentNote =
    d.mode === 'RULES'
      ? '語氣由標題關鍵字規則計算（官方公告權重 ×3），看不懂否定與反話。'
      : '語氣仍由標題關鍵字規則計算（官方公告權重 ×3）；AI 只負責逐則整理，不改這個統計。';
  // 結論句：全部由資料拼出來，不加任何新事實
  const sentence =
    events === 0
      ? '近期沒有抓到可用的新聞或公告，這一頁無法給出新聞面結論。'
      : `近期 ${events} 則新聞與公告（官方 ${s.counts.official}、一般 ${s.counts.news}）中，利多 ${s.counts.positive}、利空 ${s.counts.negative}、中性 ${s.counts.neutral}，整體${s.tone}。`;
  return (
    <section
      data-tour="mod2-research"
      className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5 space-y-4 ta-fade-up"
      aria-label="新聞研究摘要"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-white">
          研究摘要・{d.name ? `${d.symbol} ${d.name}` : d.symbol}
        </h2>
        <span className={`px-3 py-1 rounded-full border text-sm font-semibold ${tone.cls}`}>
          <span aria-hidden="true">{tone.icon} </span>
          {s.tone}
          <Tip text={sentimentNote} />
        </span>
      </div>

      <p className="text-sm text-slate-200 leading-relaxed">
        {sentence}
        {lead && (
          <>
            {' '}
            系統選出的重點新聞：
            {lead.link ? (
              <a
                href={lead.link}
                target="_blank"
                rel="noreferrer"
                className="text-sky-300 hover:underline"
              >
                「{lead.title}」
              </a>
            ) : (
              <>「{lead.title}」</>
            )}
            （{lead.source}，{fmtTime(lead.local_iso)}）。
          </>
        )}
        {pi && lead && (
          <>
            {' '}
            這則發布前 20 日股價 {sign(pi.ret_20d_pct)}、5 日 {sign(pi.ret_5d_pct)}，
            {pi.priced_in_risk ? '消息可能已反映在股價，追價風險較高' : '尚未明顯提前反映'}。
          </>
        )}
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-xl bg-slate-950/60 border border-slate-800 p-3 space-y-2 ta-fade-up" style={{ animationDelay: '80ms' }}>
          <div className="text-[11px] text-slate-400">新聞語氣分布</div>
          <SentimentBar counts={s.counts} />
          {s.counts.column > 0 && (
            <div className="text-[11px] text-slate-500">另有 {s.counts.column} 篇分析專欄（觀點，不計入語氣）</div>
          )}
        </div>
        <div className="rounded-xl bg-slate-950/60 border border-slate-800 p-3 space-y-2 ta-fade-up" style={{ animationDelay: '160ms' }}>
          <div className="text-[11px] text-slate-400">
            已反映程度（重點新聞發布前的漲幅）
            <Tip text="Priced-in＝消息已提前反映在股價。利多新聞若事件前 20 日已漲 ≥10% 或 5 日已漲 ≥6%，容易利多出盡；利空前已跌同樣幅度則可能利空出盡。數字用真實日 K 計算。" />
          </div>
          {pi ? (
            <>
              <Gauge label="事件前 20 日" value={pi.ret_20d_pct} limit={10} delay={200} sentiment={m2Data?.sentiment} />
              <Gauge label="事件前 5 日" value={pi.ret_5d_pct} limit={6} delay={300} sentiment={m2Data?.sentiment} />
            </>
          ) : (
            <div className="text-[11px] text-slate-500">評估中，或還沒有可評估的重點新聞</div>
          )}
        </div>
      </div>

      {s.gaps.length > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 ta-fade-up" style={{ animationDelay: '240ms' }}>
          <div className="text-xs font-semibold text-amber-200">資料缺口與限制</div>
          <ul className="mt-1 space-y-0.5 text-[11px] text-amber-100/90 list-disc pl-4">
            {s.gaps.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        </div>
      )}

      {s.timeline.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs font-semibold text-slate-300">事件時間軸（舊 → 新）</div>
          <ol className="relative border-l border-slate-700 ml-2 space-y-2">
            {s.timeline.map((t, i) => {
              const st = SENT[t.sentiment] || SENT.NEUTRAL;
              return (
                <li
                  key={`${t.local_iso}-${t.title}`}
                  className="ml-4 ta-fade-up"
                  style={{ animationDelay: `${300 + i * 60}ms` }}
                >
                  <span
                    className={`absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full border border-slate-900 ${
                      t.sentiment === 'POSITIVE'
                        ? 'bg-rose-500'
                        : t.sentiment === 'NEGATIVE'
                          ? 'bg-emerald-500'
                          : 'bg-slate-500'
                    }`}
                    aria-hidden="true"
                  />
                  <div className="text-[11px] text-slate-500 font-mono">
                    {fmtTime(t.local_iso)}・{t.source}
                  </div>
                  <div className="text-xs text-slate-200">
                    <span
                      className={`mr-1 text-[10px] px-1 rounded ${
                        OFFICIAL.includes(t.kind) ? 'bg-amber-500/15 text-amber-300' : 'bg-slate-800 text-sky-300'
                      }`}
                    >
                      {t.kind}
                    </span>
                    {t.title}
                    <span className={`ml-2 ${st.cls}`}>{st.label}</span>
                    {t.pct != null && (
                      <span className="ml-2 text-slate-400 font-mono">發布後首個收盤 {sign(t.pct)}</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {d.items?.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs font-semibold text-slate-300">
            我讀了這些（{d.items.length} 則，已去除轉載；點一則改用它來評估）
          </div>
          <div className="space-y-1">
            {d.items.map((it) => {
              const st = SENT[it.sentiment] || SENT.NEUTRAL;
              const isLead = lead && it.title === lead.title && it.local_iso === lead.local_iso;
              return (
                <button
                  type="button"
                  key={`${it.local_iso}-${it.title}`}
                  onClick={() => onPick?.(it)}
                  aria-pressed={isLead}
                  className={`w-full text-left px-3 py-1.5 rounded-lg border text-xs cursor-pointer transition ${
                    isLead
                      ? 'border-sky-400 bg-sky-500/10'
                      : 'border-slate-800 bg-slate-950/60 hover:border-slate-600'
                  }`}
                >
                  <span className="text-slate-500 font-mono mr-2">{fmtTime(it.local_iso)}</span>
                  <span
                    className={`mr-1 text-[10px] px-1 rounded ${
                      OFFICIAL.includes(it.kind)
                        ? 'bg-amber-500/15 text-amber-300'
                        : it.kind === '分析專欄'
                          ? 'bg-slate-700/60 text-slate-300'
                          : 'bg-slate-800 text-sky-300'
                    }`}
                  >
                    {it.kind}
                  </span>
                  <span className="text-slate-200">{it.title}</span>
                  <span className="text-slate-500 ml-2">— {it.source}</span>
                  <span className={`ml-2 ${st.cls}`}>{st.label}</span>
                  {isLead && <span className="ml-2 text-sky-300">已選為重點</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

export { useDigest, ResearchSummary };
