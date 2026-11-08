// 個股頁的分頁：行情／技術分析／新聞研究／熱力圖，放在報價卡裡面。
// 這幾個畫面共用同一檔股票、共用左邊的清單；內部頁面 id 仍是 watch／mod1／mod2，
// 所以 bus.goTab、導覽教學、AI 範圍設定與舊連結都不用改。熱力圖是 watch 底下的 rightTab。
export const STOCK_TABS = [
  { id: 'watch', label: '行情', hint: '報價、走勢、五檔、模擬下單、新聞、估值、基本資料' },
  { id: 'mod1', label: '技術分析', hint: 'K 線、買賣訊號、支撐壓力、多空情境' },
  { id: 'mod2', label: '新聞研究', hint: '新聞語氣、是否已反映、預期波動' },
  { id: 'heatmap', label: '熱力圖', hint: '一格一檔：今天資金在哪個族群' },
] as const;

export const STOCK_TAB_IDS: string[] = ['watch', 'mod1', 'mod2'];

export function StockTabs({ active, onGo }: { active: string; onGo: (id: string) => void }) {
  return (
    <div
      data-tour="stock-tabs"
      role="tablist"
      aria-label="個股功能"
      className="flex flex-wrap gap-1 rounded-xl bg-black/20 p-[3px]"
    >
      {STOCK_TABS.map((t) => (
        <button
          type="button"
          key={t.id}
          role="tab"
          aria-selected={active === t.id}
          title={t.hint}
          onClick={() => onGo(t.id)}
          className={`flex-1 min-w-[72px] px-2.5 py-[7px] text-[13px] rounded-[9px] cursor-pointer transition-colors ${
            active === t.id
              ? 'bg-gradient-to-br from-[#4f7cff]/35 to-[#8b5cf6]/25 text-white font-semibold'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
