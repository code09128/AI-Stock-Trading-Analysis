// 「策略 → 下單 → 檢討」步驟條：放在策略回測、下單紀錄、交易檢討頁上方，標出目前在哪一步，點了就跳過去。
// 說明頁的「功能怎麼串在一起」也有同一條流程（tour.tsx 的 FLOWS）。
import { bus } from '../bus';
import { usePortfolio } from '../portfolio_store';

type StepId = 'backtest' | 'signals' | 'order' | 'orders' | 'review' | 'rules';

const STEPS: { id: StepId; label: string; what: string }[] = [
  { id: 'backtest', label: '策略回測', what: '選一檔和一種策略，看這套買賣規則過去有沒有賺、最大回撤多深（交易明細是策略自己算的，不是你的交易）。' },
  { id: 'signals', label: '今日訊號', what: '用同一套策略掃自選股或持股，列出今天出現買點或賣點的股票。' },
  { id: 'order', label: '模擬下單', what: '到個股頁的「模擬下單」卡填委託，勾選個人規則後成交：買進加入我的持股，賣出寫入交易紀錄。已經有持股的話，也可以從我的持股按「加碼」「賣出」帶入。' },
  { id: 'orders', label: '下單紀錄', what: '每筆模擬成交（買進與賣出）與持股新增／匯入的時間、價格、費用，賣出那筆的損益與交易紀錄編號。' },
  { id: 'review', label: '交易檢討', what: '用已平倉的交易算勝率、賺賠比，找出賣太早、處置效應、報復性交易等壞習慣。' },
  { id: 'rules', label: '個人規則', what: '交易檢討產生 3 條規則，回到模擬下單卡變成下單前要勾選的清單，再從第 3 步繼續。' },
];

const goStep = (id: StepId) => {
  if (id === 'backtest' || id === 'signals') {
    bus._pendingBtView = id;
    bus.goTab?.('mod3');
    window.dispatchEvent(new CustomEvent('bt-view', { detail: id }));
  } else if (id === 'order' || id === 'rules') {
    const detail = { rightTab: 'quote', card: 'order' };
    bus._pendingWatch = detail;
    bus.goTab?.('watch');
    window.dispatchEvent(new CustomEvent('watch-action', { detail }));
  } else if (id === 'orders') bus.goTab?.('orders');
  else bus.goTab?.('mod5');
};

function TradeFlow({ current }: { current: StepId }) {
  const { orders, journal, rules } = usePortfolio();
  const ruleCount = rules?.rules?.length || 0;
  // 每一步右上角的小字：有資料就顯示數量
  const badge: Partial<Record<StepId, string>> = {
    orders: orders.length ? `${orders.length} 筆` : '',
    review: journal.length ? `已平倉 ${journal.length} 筆` : '',
    rules: ruleCount ? `${ruleCount} 條` : '',
  };
  const idx = STEPS.findIndex((s) => s.id === current);
  const cur = STEPS[idx];
  const next = STEPS[idx + 1];
  return (
    <nav aria-label="策略到下單到檢討的步驟" className="ta-card rounded-2xl px-4 py-3 space-y-2">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-slate-400 mr-1">練習流程：</span>
        {STEPS.map((s, k) => (
          <span key={s.id} className="flex items-center gap-1.5">
            {k > 0 && <span className="text-slate-600" aria-hidden="true">→</span>}
            <button
              type="button"
              onClick={() => goStep(s.id)}
              aria-current={s.id === current ? 'step' : undefined}
              title={s.what}
              className={`px-2.5 py-1 rounded-lg border cursor-pointer ${
                s.id === current
                  ? 'bg-gradient-to-r from-[#4f7cff] to-[#8b5cf6] border-transparent text-white font-semibold'
                  : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
              }`}
            >
              {'①②③④⑤⑥'[k]} {s.label}
              {badge[s.id] && <span className="ml-1 text-[10px] opacity-75">（{badge[s.id]}）</span>}
            </button>
          </span>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
        <span>
          <b className="text-slate-200">這一步：</b>
          {cur.what}
        </span>
        {next && (
          <button
            type="button"
            onClick={() => goStep(next.id)}
            className="ml-auto text-sky-300 hover:text-sky-200 underline cursor-pointer"
          >
            下一步：{next.label} →
          </button>
        )}
      </div>
    </nav>
  );
}

export { TradeFlow };
