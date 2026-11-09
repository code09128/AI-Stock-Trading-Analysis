// 組合風控：跨市場資產配置與穿透風控
// 持股來源列：我的持股（看盤頁）範例
import { bus } from '../bus';
import { DEFAULT_HOLDINGS } from '../config';
import { MARKET_INFO, Tip, colorOf, currencyOf, marketName, marketOf, normSym, signed } from '../ui';
import { AiExplain } from '../ai_store';
import { PCard, PageHead } from '../pages/card_box';
import { Donut, HBars, HeatMat, VBars, topSlices } from '../pages/mini_charts';
import { RulesReminder, usePortfolio } from '../portfolio_store';

function MyHoldingsBar({ m4Holdings, loadMyHoldings }) {
  const { holdings } = usePortfolio();
  const isSample = JSON.stringify(m4Holdings) === JSON.stringify(DEFAULT_HOLDINGS);
  // 帶入後看盤頁的持股又變了（成交、修改、刪除）：這裡分析的是舊版本，要提醒
  const key = (list) =>
    list
      .map((h) => `${normSym(String(h.symbol))}:${Number(h.shares)}`)
      .sort()
      .join('|');
  const stale = !isSample && holdings.length > 0 && key(m4Holdings) !== key(holdings);
  return (
    <div
      data-tour="mod4-source"
      className={`rounded-xl border px-4 py-2 text-xs flex flex-wrap items-center gap-2 ${
        isSample || stale
          ? 'border-amber-500/40 bg-amber-500/10 text-amber-100'
          : 'border-emerald-500/30 bg-emerald-500/5 text-emerald-100'
      }`}
    >
      {isSample
        ? '⚠️ 目前用的是範例持股。'
        : stale
          ? '⚠️ 這裡的持股和看盤頁「我的持股」不一致（看盤頁後來有成交或修改，或你在這裡手動改過）。要分析最新持股請按「重新帶入我的持股」。'
          : '✅ 目前分析的是你帶入的持股。'}
      <span className="text-slate-400">
        看盤頁「我的持股」有 {holdings.length} 檔（含模擬成交）。
      </span>
      {holdings.length > 0 && (
        <button
          type="button"
          onClick={() => {
            loadMyHoldings(holdings);
            bus.toast?.(`✅ 已重新帶入我的持股（${holdings.length} 檔），按「執行風控」重新計算`);
          }}
          className="ml-auto px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer"
        >
          重新帶入我的持股
        </button>
      )}
      {holdings.length === 0 && (
        <button
          type="button"
          onClick={() => bus.goTab?.('watch')}
          className="ml-auto px-3 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 text-white cursor-pointer"
        >
          到看盤頁新增持股
        </button>
      )}
    </div>
  );
}

const pctColor = (v) => (v == null ? 'text-slate-500' : colorOf(v));
const ntd = (v) => (v == null ? '--' : `NT$ ${Math.round(v).toLocaleString()}`);

function Bars({ items }) {
  return (
    <div className="space-y-1.5">
      {items.map((x) => (
        <div key={x.name}>
          <div className="flex justify-between text-[11px]">
            <span className="text-slate-300">
              {x.name}
              {x.symbols && (
                <span className="text-slate-500 font-mono">（{x.symbols.join('、')}）</span>
              )}
            </span>
            <span
              className={`font-mono ${x.weight_pct >= 50 ? 'text-amber-300 font-bold' : 'text-sky-300'}`}
            >
              {x.weight_pct}%
            </span>
          </div>
          <div className="w-full h-2 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
            <div
              className={`h-full ${x.weight_pct >= 50 ? 'bg-amber-400' : 'bg-gradient-to-r from-[#4f7cff] to-[#8b5cf6]'}`}
              style={{ width: `${Math.min(x.weight_pct, 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// 計算組合風險等級（低／中／高／過高）與具體原因
function assessRisk(m4Data: any) {
  const reasons: string[] = [];
  let score = 0;
  const lt = Object.entries((m4Data?.lookthrough_exposure_pct || {}) as Record<string, number>)
    .filter(([sym]) => !sym.endsWith('其他成分股'))
    .sort((a, b) => b[1] - a[1]);
  if (lt[0] && lt[0][1] >= 40) {
    score += 2;
    reasons.push(`單一穿透標的 ${lt[0][0]} 佔 ${lt[0][1]}%`);
  } else if (lt[0] && lt[0][1] >= 30) {
    score += 1;
    reasons.push(`單一穿透標的 ${lt[0][0]} 佔 ${lt[0][1]}%（>30%）`);
  }
  const sectors = m4Data?.scenario_stress?.exposures?.sector || [];
  const topSec = sectors[0];
  if (topSec && topSec.weight_pct >= 50) {
    score += 1;
    reasons.push(`${topSec.name} 佔比達 ${topSec.weight_pct}%`);
  }
  const beta = Number(m4Data?.portfolio_beta_used || 1);
  if (beta >= 1.35) {
    score += 1;
    reasons.push(`組合 Beta 偏高 (${beta})`);
  }
  const highPairs = (m4Data?.scenario_stress?.correlation?.pairs || []).filter((p: any) => p.high);
  if (highPairs.length > 0) {
    score += 1;
    reasons.push(`${highPairs[0].a}×${highPairs[0].b} 高度相關 (${highPairs[0].corr})`);
  }
  const level = score >= 4 ? '過高' : score >= 2 ? '高' : score === 1 ? '中' : '低';
  const badgeCls =
    score >= 4
      ? 'border-rose-500/40 bg-rose-500/15 text-rose-300'
      : score >= 2
        ? 'border-amber-500/40 bg-amber-500/15 text-amber-300'
        : score === 1
          ? 'border-sky-500/40 bg-sky-500/15 text-sky-300'
          : 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300';
  return {
    level,
    badgeCls,
    summary: reasons.length ? reasons.join('、') : '單一標的、產業與 Beta 均在均衡範圍內',
  };
}

function RiskSummaryCard({ m4Data }: { m4Data: any }) {
  const risk = assessRisk(m4Data);
  const pass = m4Data.rebalance_verification?.weight_conservation_passed;
  const sumPct =
    m4Data.rebalance_verification?.target_sum_pct ??
    m4Data.rebalance_verification?.target_weight_sum_pct;
  return (
    <PCard
      id="mod4-risk-overview"
      span={4}
      title="風險等級與組合總覽"
      sub="穿透集中度 × Beta × 相關性"
    >
      <div className="rounded-xl bg-white/[0.025] border border-white/[0.06] p-3 flex items-center justify-between gap-2">
        <div>
          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-extrabold border ${risk.badgeCls}`}>
            風險等級：{risk.level}
          </span>
          <div className="text-xs text-slate-400 mt-1.5 leading-relaxed">{risk.summary}</div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2.5 text-xs">
        <div className="rounded-xl bg-white/[0.025] border border-white/[0.06] p-2.5">
          <div className="text-slate-400 flex items-center gap-1">
            <span>折合新台幣總市值</span>
            <Tip text="每檔持股 × 即時價加總；海外持股依各自幣別（USD、HKD、JPY、KRW、GBp 便士…）用即時匯率換成台幣。" />
          </div>
          <div className="mono text-base font-extrabold text-white mt-0.5">
            NT$ {m4Data.portfolio_valuation?.total_value_twd?.toLocaleString()}
          </div>
          <div className="text-[10px] font-mono text-slate-500 truncate mt-0.5">
            匯率：
            {Object.entries((m4Data.fx_rates || { USD: { rate: m4Data.usd_twd_rate } }) as Record<string, any>)
              .filter(([c]) => c !== 'TWD')
              .map(([c, r]) => `${c} ${r.rate}${r.source === '使用者輸入' ? '（你輸入的）' : ''}`)
              .join('、') || '全部為台幣'}
          </div>
        </div>
        <div className="rounded-xl bg-white/[0.025] border border-white/[0.06] p-2.5">
          <div className="text-slate-400 flex items-center gap-1">
            <span>加權 Beta / 權重守恆</span>
            <Tip text="所有目標權重（含現金）加總必須剛好 100%，避免建議加碼加超過，或有資金沒分配到。" />
          </div>
          <div className="mono text-base font-extrabold text-sky-300 mt-0.5">
            β {m4Data.portfolio_beta_used}
          </div>
          <div className={`text-[11px] font-mono mt-0.5 ${pass ? 'text-teal-300' : 'text-amber-300'}`}>
            {pass ? `✅ 守恆通過 ${sumPct}%` : `⚠️ 權重總和異常 ${sumPct}%（需等於 100%）`}
          </div>
        </div>
        <div className="col-span-2 rounded-xl bg-rose-950/25 border border-rose-500/30 p-2.5">
          <div className="text-rose-300 flex items-center gap-1">
            <span>大盤崩跌 -20% 壓力測試預估損失（Beta 線性估算）</span>
            <Tip text="預估跌幅＝20% × 組合 Beta。例如 Beta 1.25 代表大盤跌 20% 時組合平均約跌 25%。這是簡化的線性估算，真實股災可能更大，請一併看下方「歷史回落重演」。" />
          </div>
          <div className={`mono text-base font-extrabold mt-0.5 ${colorOf(-1)}`}>
            -NT$ {m4Data.crash_20pct_stress_test?.potential_loss_twd?.toLocaleString()}（
            {m4Data.crash_20pct_stress_test?.expected_portfolio_drawdown_pct}%）
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            建議避險：{m4Data.crash_20pct_stress_test?.suggested_hedge_tool}。{m4Data.crash_20pct_stress_test?.rationale}
          </div>
        </div>
      </div>
      {m4Data.fx_warning && <div className="text-[11px] text-amber-300">⚠️ {m4Data.fx_warning}</div>}
    </PCard>
  );
}

function AllocationCompareCard({ m4Data, m4CashPct }: { m4Data: any; m4CashPct: number }) {
  const actions = m4Data.rebalance_verification?.rebalance_actions || [];
  const curSlices = topSlices(
    actions.map((r: any) => ({ label: r.symbol, value: Number(r.current_weight_pct || 0) })),
    6,
  );
  const tgtItems = [
    ...actions.map((r: any) => ({ label: r.symbol, value: Number(r.target_weight_pct || 0) })),
    ...(Number(m4CashPct) > 0 && !actions.some((r: any) => r.symbol === 'CASH')
      ? [{ label: 'CASH 現金', value: Number(m4CashPct), color: '#22d3a0' }]
      : []),
  ];
  const tgtSlices = topSlices(tgtItems, 6);
  const ex = m4Data.scenario_stress?.exposures;
  return (
    <PCard
      id="mod4-alloc-compare"
      span={8}
      title="目前配置 vs 目標配置"
      sub="雙圓餅對照與地區／產業曝險"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
        <div>
          <div className="text-xs text-slate-400 mb-2">目前市值權重</div>
          <Donut items={curSlices} size={148} center="目前" sub="100%" label="目前市值權重圓餅圖" />
        </div>
        <div>
          <div className="text-xs text-slate-400 mb-2">目標再平衡權重（含現金）</div>
          <Donut items={tgtSlices} size={148} center="目標" sub={`現金 ${m4CashPct}%`} label="目標再平衡權重圓餅圖" />
        </div>
      </div>
      {ex && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-white/10">
          <div className="space-y-1.5">
            <div className="text-xs font-semibold text-slate-300 flex items-center gap-1">
              <span>地區曝險</span>
              <Tip text={ex.note} />
            </div>
            <Bars items={ex.region || []} />
          </div>
          <div className="space-y-1.5">
            <div className="text-xs font-semibold text-slate-300 flex items-center gap-1">
              <span>產業曝險</span>
              <Tip text="依直接持有的標的分類，單一產業 ≥ 50% 標示警示。ETF 另列，內容請看下方穿透曝險。" />
            </div>
            <Bars items={ex.sector || []} />
          </div>
        </div>
      )}
    </PCard>
  );
}

// 多情境壓力測試與拖累排行、相關係數矩陣、避險比較
function ScenarioStressCards({ data, replay }: { data: any; replay: any }) {
  if (!data) return null;
  if (data.error) {
    return (
      <PCard span={12} title="多情境壓力測試">
        <div className="text-xs text-amber-300">⚠️ {data.error}</div>
      </PCard>
    );
  }
  const { correlation: cor } = data;
  const barItems = [
    ...(data.beta_scenarios || []).map((b: any) => ({
      label: `${b.market_move_pct === -10 ? '修正' : '熊市'} ${b.market_move_pct}%`,
      value: Number(b.portfolio_move_pct || 0),
    })),
    ...(data.historical_scenarios || [])
      .filter((h: any) => h.available)
      .map((h: any) => ({
        label: h.name,
        value: Number(h.portfolio_return_pct || 0),
      })),
  ];
  const availHist = (data.historical_scenarios || []).filter((h: any) => h.available);
  const worstHist = [...availHist].sort(
    (a: any, b: any) => Number(a.portfolio_return_pct || 0) - Number(b.portfolio_return_pct || 0),
  )[0];
  const dragItems = (worstHist?.rows || [])
    .filter((r: any) => r.return_pct != null)
    .sort((a: any, b: any) => Number(a.return_pct) - Number(b.return_pct))
    .map((r: any) => ({
      label: `${r.symbol} (${r.weight_pct}%)`,
      value: Number(r.return_pct),
    }));
  const heatPairs = (cor?.pairs || []).map((p: any) => ({
    a: p.a,
    b: p.b,
    r: Number(p.corr || 0),
  }));

  return (
    <>
      <PCard
        id="mod4-stress"
        span={6}
        title="多情境壓力測試"
        sub="Beta -10%/-20% 與 2022 升息、2020 疫情真實回放"
        tip={<Tip text="同時看 4 種情境：大盤修正 -10%、熊市 -20%（用 Beta 線性估算），以及「利率快速上升」「經濟衰退」兩段真實歷史：把你現在的持股套回當時的真實收盤價，看會跌多少。歷史不代表未來。" />}
      >
        <div data-tour="mod4-scenarios" className="space-y-3">
          {barItems.length > 0 && <VBars items={barItems} height={150} unit="%" label="多情境壓力測試跌幅比較" />}
          <div className="grid grid-cols-2 gap-2.5 text-xs">
            {(data.beta_scenarios || []).map((b: any) => (
              <div key={b.market_move_pct} className="rounded-xl bg-white/[0.025] border border-white/[0.06] p-2.5">
                <div className="text-slate-400">
                  {b.market_move_pct === -10 ? '市場修正' : '熊市下跌'} {b.market_move_pct}%
                  <Tip text="組合預估跌幅＝大盤跌幅 × 組合 Beta。線性估算，真實下跌時個股可能跌得更多。" />
                </div>
                <div className={`text-base font-extrabold font-mono ${pctColor(b.portfolio_move_pct)}`}>
                  {b.portfolio_move_pct}%
                </div>
                <div className="font-mono text-slate-300">{ntd(b.loss_twd)}</div>
                <div className="text-[10px] text-slate-500">Beta 線性估算</div>
              </div>
            ))}
            {(data.historical_scenarios || []).map((h: any) => (
              <div key={h.key} className="rounded-xl bg-white/[0.025] border border-white/[0.06] p-2.5">
                <div className="text-slate-400 flex items-center gap-1">
                  <span>{h.name}</span>
                  <Tip text={`${h.event}（${h.start} ~ ${h.end}）。${h.why}`} />
                </div>
                {h.available ? (
                  <>
                    <div className={`text-base font-extrabold font-mono ${pctColor(h.portfolio_return_pct)}`}>
                      {h.portfolio_return_pct}%
                    </div>
                    <div className="font-mono text-slate-300">{ntd(h.loss_twd_now)}</div>
                    <div className="text-[10px] text-slate-500">
                      {h.event}・最大回撤 {h.portfolio_max_drawdown_pct}%
                    </div>
                  </>
                ) : (
                  <div className="text-slate-500 mt-1">{h.reason}</div>
                )}
              </div>
            ))}
          </div>
          {availHist.map((h: any) => (
            <details key={`t-${h.key}`} className="text-xs text-slate-400">
              <summary className="cursor-pointer hover:text-slate-200 select-none">
                {h.name}（{h.event}，{h.start} ~ {h.end}）各持股真實漲跌明細
              </summary>
              <div className="text-[11px] text-slate-400 mt-1.5">
                涵蓋持股 {h.coverage_pct}%・同期大盤：{(h.benchmarks || []).map((b: any) => ` ${b.name} ${b.return_pct}%`).join('、')}
              </div>
              <div className="overflow-x-auto mt-1.5">
                <table className="w-full text-xs font-mono">
                  <thead>
                    <tr className="text-slate-500 text-left font-sans">
                      <th className="py-1">標的</th>
                      <th>目前權重</th>
                      <th>期間漲跌</th>
                      <th>期間最低</th>
                      <th>備註</th>
                    </tr>
                  </thead>
                  <tbody>
                    {h.rows.map((r: any) => (
                      <tr key={r.symbol} className="border-t border-slate-800">
                        <td className="py-1 text-white font-bold">{r.symbol}</td>
                        <td>{r.weight_pct}%</td>
                        <td className={pctColor(r.return_pct)}>{r.return_pct == null ? '--' : `${r.return_pct}%`}</td>
                        <td className={pctColor(r.worst_pct)}>{r.worst_pct == null ? '--' : `${r.worst_pct}%`}</td>
                        <td className="font-sans text-slate-400">
                          {r.note || (r.drags ? <span className="text-rose-300">跌幅比組合多 5% 以上，拋售時拖累最大</span> : '')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ))}
        </div>
      </PCard>

      <PCard
        id="mod4-drag"
        span={6}
        title={worstHist ? `最傷情境（${worstHist.name}）：個股拖累排行` : '歷史回落重演與個股拖累'}
        sub="找出股災時跌幅最深、最拖累組合的部位"
        tip={<Tip text="把你現在的持股數量套回歷史股災與過去約 2 年每天的真實收盤價，找出組合曾經的最大回撤與拖累排行。" />}
      >
        {dragItems.length > 0 && (
          <HBars items={dragItems} format={(v) => `${signed(v, 1)}%`} />
        )}
        <div className="pt-2 border-t border-white/10 space-y-2">
          <div className="text-xs font-semibold text-slate-300">
            歷史回落重演（用你現在的持股回推過去約 2 年的真實走勢）
            <Tip text="把你現在的持股數量套回過去約 2 年每天的真實收盤價，找出組合曾經的最大回撤，以及最差的連續 20 個交易日。假設持股與匯率不變。" />
          </div>
          {replay?.available ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs font-mono">
              <div className="rounded-xl bg-white/[0.025] border border-white/[0.06] p-2.5">
                <div className="text-slate-400">最大回撤</div>
                <div className={`text-lg font-extrabold ${colorOf(-1)}`}>{replay.max_drawdown_pct}%</div>
                <div className="text-slate-300">約 NT$ {replay.max_drawdown_loss_twd?.toLocaleString()}</div>
                <div className="text-[10px] text-slate-500">{replay.max_drawdown_window}</div>
              </div>
              <div className="rounded-xl bg-white/[0.025] border border-white/[0.06] p-2.5">
                <div className="text-slate-400">最差 20 個交易日</div>
                <div className={`text-lg font-extrabold ${colorOf(-1)}`}>{replay.worst_20d_pct}%</div>
                <div className="text-slate-300">約 NT$ {replay.worst_20d_loss_twd?.toLocaleString()}</div>
                <div className="text-[10px] text-slate-500">{replay.worst_20d_window}</div>
              </div>
              <div className="sm:col-span-2 text-[11px] text-slate-400 font-sans">
                資料區間 {replay.period}（{replay.trading_days} 個交易日）。{replay.note}
                {replay.missing?.length > 0 && ` 查無歷史資料未計入：${replay.missing.join('、')}。`}
              </div>
            </div>
          ) : (
            <div className="text-xs text-slate-400">無法計算：{replay?.reason}</div>
          )}
        </div>
      </PCard>

      <PCard
        id="mod4-corr"
        span={6}
        title="持股相關係數矩陣"
        sub=">0.70 高度同向（分散效果有限）"
        tip={<Tip text={cor?.note || '近 1 年日報酬相關係數'} />}
      >
        {heatPairs.length > 0 ? (
          <>
            <HeatMat pairs={heatPairs} />
            <div className="flex flex-wrap gap-1.5 text-xs font-mono pt-1">
              {cor.pairs.map((p: any) => (
                <span
                  key={`${p.a}-${p.b}`}
                  className={`px-2 py-0.5 rounded-lg border ${
                    p.high
                      ? 'border-amber-500/50 bg-amber-500/10 text-amber-200'
                      : 'border-white/10 text-slate-300'
                  }`}
                >
                  {p.a} × {p.b}：{p.corr}
                  {p.high && <span className="font-sans">（合計 {p.weight_pct}%，幾乎同步）</span>}
                </span>
              ))}
            </div>
          </>
        ) : (
          <div className="text-xs text-slate-500">同一市場的持股不到 2 檔，無法比較。</div>
        )}
      </PCard>

      <PCard
        id="mod4-hedges"
        span={6}
        title="分散與避險方式比較"
        sub="降低波動的工具與代價對照"
        tip={<Tip text="一般性的工具比較，不是針對你的個人建議。沒有免費的避險：降低下跌風險，通常也會降低上漲時的報酬或增加成本。" />}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-400 text-left border-b border-white/10">
                <th className="py-1.5 pr-2">方式</th>
                <th className="py-1.5 pr-2">優點</th>
                <th className="py-1.5 pr-2">缺點</th>
                <th className="py-1.5">成本</th>
              </tr>
            </thead>
            <tbody>
              {(data.hedges || []).map((h: any) => (
                <tr key={h.name} className="border-t border-slate-800/70 align-top">
                  <td className="py-1.5 pr-2 text-white font-bold whitespace-nowrap">{h.name}</td>
                  <td className="py-1.5 pr-2 text-emerald-200">{h.pros}</td>
                  <td className="py-1.5 pr-2 text-rose-200">{h.cons}</td>
                  <td className="py-1.5 text-slate-400">{h.cost}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </PCard>
    </>
  );
}

function Mod4Panel({ ctx }) {
  const {
    m4Beta,
    m4CashPct,
    m4Data,
    m4Holdings,
    m4Live,
    m4Loading,
    runMod4,
    setM4Beta,
    setM4CashPct,
    setM4Holdings,
    setM4Live,
    loadMyHoldings,
  } = ctx;
  return (
    <div className="space-y-3.5">
      <PageHead
        title="組合風控"
        desc="跨市場資產配置、穿透式 ETF 曝險、多情境壓力測試與目標權重再平衡。"
        right={
          <>
            <button
              type="button"
              onClick={() => bus.openAiDrawer?.('mod4')}
              className="text-xs px-3 py-1.5 rounded-xl bg-gradient-to-r from-[#4f7cff] to-[#8b5cf6] text-white font-semibold shadow-lg shadow-indigo-500/20 cursor-pointer"
            >
              ✦ AI 組合風控分析
            </button>
            <button
              type="button"
              onClick={runMod4}
              disabled={m4Loading}
              className="text-xs px-3 py-1.5 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-slate-100 font-semibold cursor-pointer"
            >
              {m4Loading ? '計算中...' : '↻ 重新計算風控'}
            </button>
          </>
        }
      />
      <RulesReminder compact />
      <MyHoldingsBar m4Holdings={m4Holdings} loadMyHoldings={loadMyHoldings} />

      <div className="grid grid-cols-1 md:grid-cols-12 gap-3.5">
        {m4Data && (
          <>
            <RiskSummaryCard m4Data={m4Data} />
            <AllocationCompareCard m4Data={m4Data} m4CashPct={m4CashPct} />
          </>
        )}

        <PCard
          id="mod4-holdings-rebalance"
          span={12}
          title="持股與目標再平衡表"
          sub="資料狀態：匯率、即時價、ETF 成分股、Beta（留空時）、歷史回落皆為真實資料；持股來源見上方。以即時價與匯率換算台幣市值，拆解 ETF 成分股曝險並執行壓力測試"
          right={
            <button
              type="button"
              onClick={() => {
                setM4Holdings([
                  ...m4Holdings,
                  {
                    symbol: '2454',
                    market: 'TW',
                    shares: 500,
                    price: 1300,
                    target_pct: 10,
                  },
                ]);
                bus.toast?.('ℹ️ 已在試算表新增一列（這裡是風控試算，不會改到看盤頁的我的持股）');
              }}
              className="text-xs px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-sky-300 border border-white/10 cursor-pointer"
            >
              + 新增持股部位
            </button>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2 px-2">代號（2330／NVDA／0700.HK／7203.T）</th>
                  <th className="py-2 px-2">市場</th>
                  <th className="py-2 px-2">持有股數</th>
                  <th className="py-2 px-2">目前單價 (原幣)</th>
                  <th className="py-2 px-2">目標再平衡權重 (%)</th>
                  <th className="py-2 px-2">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {m4Holdings.map((h, idx) => (
                  <tr key={`${h.symbol}-${idx}`}>
                    <td className="py-2 px-2">
                      <input
                        type="text"
                        value={h.symbol}
                        onChange={(e) => {
                          const next = [...m4Holdings];
                          next[idx] = { ...next[idx], symbol: e.target.value };
                          setM4Holdings(next);
                        }}
                        className="bg-slate-950 border border-slate-700 rounded px-2 py-1 w-28 text-white"
                      />
                    </td>
                    <td className="py-2 px-2">
                      {/* 市場與幣別依代號自動判斷（.HK 港股、.T 日股、.KS 韓股、.L 英股…；沒有後綴＝美股） */}
                      <span className="whitespace-nowrap text-slate-200">
                        {MARKET_INFO[marketOf(h.symbol || '')].flag}{' '}
                        {marketName(h.symbol || '')}
                        <span className="ml-1 text-slate-500">
                          (
                          {m4Data?.portfolio_valuation?.holdings?.find(
                            (x) => x.symbol === String(h.symbol).toUpperCase(),
                          )?.currency || currencyOf(h.symbol || '')}
                          )
                        </span>
                      </span>
                    </td>
                    <td className="py-2 px-2">
                      <input
                        type="number"
                        value={h.shares}
                        onChange={(e) => {
                          const next = [...m4Holdings];
                          next[idx] = {
                            ...next[idx],
                            shares: Number(e.target.value),
                          };
                          setM4Holdings(next);
                        }}
                        className="bg-slate-950 border border-slate-700 rounded px-2 py-1 w-24 text-white"
                      />
                    </td>
                    <td className="py-2 px-2">
                      <input
                        type="number"
                        step="0.1"
                        value={h.price}
                        onChange={(e) => {
                          const next = [...m4Holdings];
                          next[idx] = {
                            ...next[idx],
                            price: Number(e.target.value),
                          };
                          setM4Holdings(next);
                        }}
                        className="bg-slate-950 border border-slate-700 rounded px-2 py-1 w-28 text-white"
                      />
                    </td>
                    <td className="py-2 px-2">
                      <input
                        type="number"
                        step="1"
                        value={h.target_pct}
                        onChange={(e) => {
                          const next = [...m4Holdings];
                          next[idx] = {
                            ...next[idx],
                            target_pct: Number(e.target.value),
                          };
                          setM4Holdings(next);
                        }}
                        className="bg-slate-950 border border-slate-700 rounded px-2 py-1 w-20 text-amber-300"
                      />
                    </td>
                    <td className="py-2 px-2">
                      <button
                        type="button"
                        onClick={() => {
                          setM4Holdings(m4Holdings.filter((_, i) => i !== idx));
                          bus.toast?.(`ℹ️ 已從試算表刪除 ${h.symbol || '這一列'}（不會改到看盤頁的我的持股）`);
                        }}
                        className="text-rose-400 hover:text-rose-300 cursor-pointer"
                      >
                        刪除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end pt-2 border-t border-slate-800">
            <div>
              <label htmlFor="m4-cash" className="block text-xs text-slate-400 mb-1">
                目標保留現金權重 (CASH %)
              </label>
              <input
                id="m4-cash"
                type="number"
                value={m4CashPct}
                onChange={(e) => setM4CashPct(Number(e.target.value))}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm font-mono text-emerald-300"
              />
            </div>
            <div>
              <label className="flex items-center gap-2 text-xs text-sky-300 mb-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={m4Live}
                  onChange={(e) => setM4Live(e.target.checked)}
                />
                用即時報價計算持股市值（取消＝用表格填的價格）
              </label>
              <label htmlFor="m4-beta" className="block text-xs text-slate-400 mb-1">
                投資組合加權 Beta 值（留空＝用近 1 年真實報酬自動算）
                <Tip text="Beta＝相對大盤的波動倍數：1＝跟大盤差不多，1.5＝大盤漲跌 1% 時平均漲跌 1.5%，負值＝跟大盤反向（例如反向 ETF）。留空時用每檔近 1 年日報酬對大盤（台股對加權指數、美股對 S&P 500）計算，再依市值權重加權。範例：0050 佔 60%（Beta 1.0）＋ NVDA 佔 40%（Beta 1.9）→ 0.6×1.0 ＋ 0.4×1.9 ＝ 1.36，大盤跌 20% 時組合預估約跌 27%。算完後下方會列出每檔的 Beta。" />
              </label>
              <input
                id="m4-beta"
                type="number"
                step="0.05"
                value={m4Beta}
                onChange={(e) => setM4Beta(e.target.value)}
                placeholder={m4Data ? `自動：${m4Data.portfolio_beta_used}` : '留空＝自動計算'}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm font-mono text-white"
              />
            </div>
            <div>
              <button
                type="button"
                onClick={runMod4}
                disabled={m4Loading}
                className="w-full py-2 px-4 rounded-xl bg-gradient-to-r from-[#4f7cff] to-[#8b5cf6] hover:opacity-95 text-white font-semibold text-sm shadow-lg shadow-indigo-600/25 transition cursor-pointer"
              >
                {m4Loading ? '計算中...' : '計算穿透曝險與再平衡'}
              </button>
            </div>
          </div>

          {m4Data && (
            <div className="pt-3 border-t border-white/10 space-y-2">
              <div className="text-xs font-semibold text-slate-300 flex items-center gap-1">
                <span>再平衡建議（目前權重 → 目標權重）</span>
                <Tip text="目前權重＝該檔市值 ÷ 總市值；目標權重在上方表格設定。差距為正代表要加碼、為負代表要減碼。" />
              </div>
              {m4Data.rebalance_verification?.error && (
                <div className="text-xs text-rose-300">⚠️ {m4Data.rebalance_verification.error}</div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-xs font-mono">
                  <thead>
                    <tr className="text-slate-500 text-left">
                      <th className="py-1">標的</th>
                      <th>目前</th>
                      <th>目標</th>
                      <th>差距</th>
                      <th>動作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(m4Data.rebalance_verification?.rebalance_actions || []).map((r: any) => (
                      <tr key={r.symbol} className="border-t border-slate-800">
                        <td className="py-1 text-white font-bold">{r.symbol}</td>
                        <td>{r.current_weight_pct}%</td>
                        <td>{r.target_weight_pct}%</td>
                        <td className={colorOf(r.delta_pct)}>
                          {r.delta_pct > 0 ? '+' : ''}
                          {r.delta_pct}%
                        </td>
                        <td className="text-slate-300">{r.action}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </PCard>

        {m4Data && (
          <>
            <ScenarioStressCards data={m4Data.scenario_stress} replay={m4Data.historical_replay} />

            <PCard
              id="mod4-lookthrough"
              span={12}
              title="實際押在哪些公司（穿透式曝險 Look-through：把 ETF 拆成成分股）"
              sub="單一標的超過 30% 會標示過度集中警示"
              tip={<Tip text="把 ETF 拆成它的成分股，再加上你直接持有的個股，看你真正押在每一檔的比例。元大發行的 ETF 用完整成分股清單，其他 ETF 只有前十大，沒涵蓋的部分列為「其他成分股」。單一標的超過 30% 會標示警示，代表高度集中。" />}
            >
              <div className="text-[11px] text-slate-400 space-y-0.5">
                {Object.entries((m4Data.price_sources || {}) as Record<string, string>).map(([sym, src]) => (
                  <div key={`p-${sym}`}>
                    {sym} 價格：{src}
                  </div>
                ))}
                {Object.entries((m4Data.lookthrough_sources || {}) as Record<string, string>).map(([etf, src]) => (
                  <div key={etf}>
                    {etf}：{src}
                  </div>
                ))}
                <div>
                  Beta {m4Data.portfolio_beta_used}：{m4Data.portfolio_beta_source}
                  {(m4Data.beta_detail || [])
                    .map((b: any) => ` ${b.symbol}=${b.beta ?? 'N/A'}`)
                    .join('，')}
                </div>
              </div>
              {(() => {
                // 數字代號的鍵在 JS 物件裡會被排到前面，這裡依曝險重新排序；元大 ETF 的完整成分股可達幾百檔，只列前 30 檔
                const all = Object.entries((m4Data.lookthrough_exposure_pct || {}) as Record<string, number>).sort((x, y) => y[1] - x[1]);
                const shown = all.filter(([sym], i) => i < 30 || sym.endsWith('其他成分股'));
                const hidden = all.filter((e) => !shown.includes(e));
                return (
                  <div className="space-y-2 pt-1">
                    {shown.map(([sym, pct]) => (
                      <div key={sym} className="space-y-1">
                        <div className="flex justify-between text-xs font-mono">
                          <span className="text-slate-200 font-bold">
                            {sym}{' '}
                            {pct >= 30 && !sym.endsWith('其他成分股') && (
                              <span className="text-amber-300 ml-1">⚠️ 單一實體過度集中 (&gt;30%)</span>
                            )}
                          </span>
                          <span
                            className={
                              pct >= 30 && !sym.endsWith('其他成分股')
                                ? 'text-amber-300 font-bold'
                                : 'text-sky-300'
                            }
                          >
                            {pct}%
                          </span>
                        </div>
                        <div className="w-full h-2.5 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                          <div
                            className={`h-full rounded-full ${
                              pct >= 30 && !sym.endsWith('其他成分股') ? 'bg-amber-400' : 'bg-gradient-to-r from-[#4f7cff] to-[#8b5cf6]'
                            }`}
                            style={{ width: `${Math.min(pct, 100)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                    {hidden.length > 0 && (
                      <div className="text-[11px] text-slate-500">
                        另有 {hidden.length} 檔較小的曝險未列出（合計 {hidden.reduce((s, e) => s + e[1], 0).toFixed(2)}%）
                      </div>
                    )}
                  </div>
                );
              })()}
            </PCard>
          </>
        )}
      </div>

      {m4Data && (
        <AiExplain
          module="mod4"
          provenance={[
            JSON.stringify(m4Holdings) === JSON.stringify(DEFAULT_HOLDINGS)
              ? {
                  text: '持股目前是範例（2330／0050／NVDA），不是你的真實部位，可從看盤頁「我的持股」帶入',
                  sample: true,
                }
              : { text: '持股來自你輸入／匯入的部位' },
            { text: '即時價、匯率、ETF 成分股、Beta、歷史回落為真實資料' },
          ]}
          data={m4Data}
        />
      )}
    </div>
  );
}

export { Mod4Panel };
