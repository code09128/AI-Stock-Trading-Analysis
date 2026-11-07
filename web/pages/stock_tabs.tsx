// 「個股」頁頂端分頁：行情／技術分析／新聞判斷。
// 這三個畫面共用同一檔股票，所以放在同一個側欄項目底下；內部頁面 id 仍是 watch／mod1／mod2，
// 所以 bus.goTab、導覽教學、AI 範圍設定與舊連結都不用改。
export const STOCK_TABS = [
  { id: 'watch', label: '行情', hint: '自選股、報價、熱力圖、模擬下單' },
  { id: 'mod1', label: '技術分析', hint: 'K 線、買賣訊號、支撐壓力、多空情境' },
  { id: 'mod2', label: '新聞判斷', hint: '新聞語氣、是否已反映、預期波動' },
] as const;

export const STOCK_TAB_IDS: string[] = STOCK_TABS.map((t) => t.id);

export function StockTabs({ active, onGo }) {
  const idx = Math.max(
    0,
    STOCK_TABS.findIndex((t) => t.id === active),
  );
  // 滑動指示條：三格等寬，用 translateX 移動；減少動態效果設定時直接跳過動畫（見 index.html）
  return (
    <div
      data-tour="stock-tabs"
      role="tablist"
      aria-label="個股功能"
      className="relative grid grid-cols-3 rounded-xl bg-slate-900 border border-slate-800 p-1 max-w-xl"
    >
      <span
        aria-hidden="true"
        className="ta-tab-ind absolute top-1 bottom-1 left-1 rounded-lg bg-sky-500/20 border border-sky-400/60"
        style={{ width: 'calc((100% - 0.5rem) / 3)', transform: `translateX(${idx * 100}%)` }}
      />
      {STOCK_TABS.map((t) => (
        <button
          type="button"
          key={t.id}
          role="tab"
          aria-selected={active === t.id}
          title={t.hint}
          onClick={() => onGo(t.id)}
          className={`relative z-10 py-2 text-sm rounded-lg cursor-pointer transition-colors ${
            active === t.id ? 'text-white font-semibold' : 'text-slate-400 hover:text-white'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
