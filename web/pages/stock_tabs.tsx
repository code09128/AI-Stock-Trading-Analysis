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

const { useLayoutEffect, useRef } = React;

export function StockTabs({ active, onGo }: { active: string; onGo: (id: string) => void }) {
  // 滑動指示：量出選中分頁的位置與寬度，讓同一塊底色（.ta-thumb）滑過去；視窗或字型改變寬度時重量
  const box = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = box.current;
    const t = thumb.current;
    if (!el || !t) return undefined;
    const place = () => {
      const b = el.querySelector<HTMLElement>('[aria-selected="true"]');
      if (!b) {
        t.style.opacity = '0';
        return;
      }
      t.style.opacity = '1';
      t.style.width = `${b.offsetWidth}px`;
      t.style.height = `${b.offsetHeight}px`;
      t.style.top = `${b.offsetTop}px`;
      t.style.bottom = 'auto';
      t.style.transform = `translateX(${b.offsetLeft}px)`;
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
  }, [active]);
  return (
    <div
      ref={box}
      data-tour="stock-tabs"
      role="tablist"
      aria-label="個股功能"
      className="relative flex flex-wrap gap-1 rounded-xl bg-black/20 p-[3px]"
    >
      <span ref={thumb} className="ta-thumb" aria-hidden="true" />
      {STOCK_TABS.map((t) => (
        <button
          type="button"
          key={t.id}
          role="tab"
          aria-selected={active === t.id}
          title={t.hint}
          onClick={() => onGo(t.id)}
          className={`ta-flat relative flex-1 min-w-[72px] px-2.5 py-[7px] text-[13px] rounded-[9px] cursor-pointer transition-colors ${
            active === t.id ? 'text-white font-semibold' : 'text-slate-400 hover:text-white'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
