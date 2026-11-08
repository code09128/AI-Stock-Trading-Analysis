// 卡片版面：12 欄格線、可拖曳排序、收合、隱藏、切換寬度；狀態記在 localStorage（tw_us_watch_cards_v2，已列入備份清單）
// 只管外觀與顯示狀態，不碰卡片裡的資料與功能
import { readLS, writeLS } from '../ui';

const { useState, useEffect, useRef } = React;

// v2：版面改成設計稿的預設（順序、寬度、不預設收合）；舊的 v1 只有我開發中的收合設定，不沿用
const LS_CARDS = 'tw_us_watch_cards_v2';

export type CardDef = { id: string; title: string; span: 4 | 6 | 8 | 12; collapsed?: boolean };
type Prefs = { order: string[]; collapsed: Record<string, boolean>; hidden: Record<string, boolean>; wide: Record<string, boolean> };

const asObj = (v: any) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

function useCardLayout(defs: CardDef[]) {
  const defaults = (): Prefs => ({
    order: defs.map((d) => d.id),
    collapsed: Object.fromEntries(defs.filter((d) => d.collapsed).map((d) => [d.id, true])),
    hidden: {},
    wide: {},
  });
  const [prefs, setPrefs] = useState<Prefs>(() => {
    const v = readLS(LS_CARDS, null);
    const base = defaults();
    if (!v || typeof v !== 'object') return base;
    // 舊版只存 collapsed／hidden；資料被手動改壞時退回預設，不要讓整個看盤頁出錯
    const ids = defs.map((d) => d.id);
    const saved = Array.isArray(v.order) ? v.order.filter((x: any) => ids.includes(x)) : [];
    const order = [...saved, ...ids.filter((x) => !saved.includes(x))];
    return {
      order,
      collapsed: v.collapsed ? { ...base.collapsed, ...asObj(v.collapsed) } : base.collapsed,
      hidden: asObj(v.hidden),
      wide: asObj(v.wide),
    };
  });
  useEffect(() => {
    writeLS(LS_CARDS, prefs);
  }, [prefs]);
  const [dragId, setDragId] = useState<string | null>(null);
  const flip = (kind: 'collapsed' | 'hidden' | 'wide', id: string) =>
    setPrefs((p) => ({ ...p, [kind]: { ...p[kind], [id]: !p[kind][id] } }));
  const move = (id: string, toIndexOrId: string | number) =>
    setPrefs((p) => {
      const cur = p.order.filter((x) => x !== id);
      const at = typeof toIndexOrId === 'number' ? toIndexOrId : p.order.indexOf(toIndexOrId);
      cur.splice(Math.max(0, Math.min(at, cur.length)), 0, id);
      return { ...p, order: cur };
    });
  return {
    defs,
    prefs,
    dragId,
    setDragId,
    toggleCollapsed: (id: string) => flip('collapsed', id),
    toggleHidden: (id: string) => flip('hidden', id),
    toggleWide: (id: string) => flip('wide', id),
    move,
    foldAll: () => setPrefs((p) => ({ ...p, collapsed: Object.fromEntries(defs.map((d) => [d.id, true])) })),
    openAll: () => setPrefs((p) => ({ ...p, collapsed: {} })),
    reset: () => setPrefs(defaults()),
    isOpen: (id: string) => !prefs.hidden[id] && !prefs.collapsed[id],
    // 「買進／賣出」這類按鈕要跳到某張卡：隱藏的顯示、收合的展開
    reveal: (id: string) =>
      setPrefs((p) => ({ ...p, hidden: { ...p.hidden, [id]: false }, collapsed: { ...p.collapsed, [id]: false } })),
  };
}
type Ctl = ReturnType<typeof useCardLayout>;

// 手機單欄、平板兩欄、桌面 12 欄；「寬」＝整列
const spanClass = (span: number, wide: boolean) =>
  wide || span === 12
    ? 'md:col-span-12'
    : span === 4
      ? 'md:col-span-6 xl:col-span-4'
      : span === 6
        ? 'md:col-span-6'
        : 'md:col-span-12 xl:col-span-8';

function CardGrid({ ctl, render }: { ctl: Ctl; render: (id: string) => any }) {
  const shown = ctl.prefs.order.filter((id) => !ctl.prefs.hidden[id]);
  return (
    <div className="grid grid-cols-1 md:grid-cols-12 grid-flow-dense gap-3.5" data-tour="watch-cards">
      {shown.length === 0 && (
        <div className="md:col-span-12 rounded-2xl border border-slate-800 p-8 text-center text-sm text-slate-400" role="status">
          卡片都被隱藏了。按右上角「版面設定」勾選要顯示的卡片，或按「還原預設版面」。
        </div>
      )}
      {shown.map((id) => (
        <RenderOne key={id} id={id} render={render} />
      ))}
    </div>
  );
}
function RenderOne({ id, render }: { id: string; render: (id: string) => any }) {
  return render(id);
}

function CardBox({
  id,
  title,
  sub,
  ctl,
  children,
  className = '',
}: {
  id: string;
  title: string;
  sub?: any;
  ctl: Ctl;
  children: any;
  className?: string;
}) {
  const def = ctl.defs.find((d) => d.id === id);
  const collapsed = !!ctl.prefs.collapsed[id];
  const wide = !!ctl.prefs.wide[id];
  const [over, setOver] = useState(false);
  const ref = useRef<HTMLElement>(null);
  const onKey = (e: any) => {
    // 不用滑鼠也能排序：在把手上按方向鍵，往前或往後移一格
    const i = ctl.prefs.order.indexOf(id);
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      ctl.move(id, Math.max(0, i - 1));
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault();
      ctl.move(id, i + 1);
    }
  };
  const btn = 'w-7 h-7 grid place-items-center rounded-lg text-slate-400 hover:text-white hover:bg-white/10 cursor-pointer';
  return (
    <section
      ref={ref}
      aria-label={title}
      data-card={id}
      onDragOver={(e) => {
        if (ctl.dragId && ctl.dragId !== id) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (ctl.dragId && ctl.dragId !== id) ctl.move(ctl.dragId, id);
        ctl.setDragId(null);
      }}
      className={`ta-card bg-slate-900/90 border border-slate-800 rounded-2xl min-w-0 ${spanClass(def?.span || 12, wide)} ${
        collapsed ? 'self-start' : ''
      } ${ctl.dragId === id ? 'opacity-40' : ''} ${over ? 'outline outline-2 outline-dashed outline-[#4f7cff] outline-offset-2' : ''} ${className}`}
    >
      <div className="flex items-center gap-2 px-4 pt-3 pb-1">
        <button
          type="button"
          draggable
          onDragStart={(e) => {
            ctl.setDragId(id);
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', id); // 有些瀏覽器沒帶資料就不會開始拖曳
            if (ref.current) e.dataTransfer.setDragImage(ref.current, 20, 20);
          }}
          onDragEnd={() => ctl.setDragId(null)}
          onKeyDown={onKey}
          aria-label={`移動「${title}」：拖曳，或按方向鍵調整順序`}
          title="拖曳排序（也可按方向鍵）"
          className={`${btn} cursor-grab tracking-[-3px]`}
        >
          ⋮⋮
        </button>
        <h3 className="m-0 text-[13.5px] font-bold text-slate-100 whitespace-nowrap">{title}</h3>
        {sub != null && <span className="text-xs text-slate-400 truncate min-w-0">{sub}</span>}
        <div className="ml-auto flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={() => ctl.toggleWide(id)}
            aria-pressed={wide}
            aria-label={wide ? `${title}縮回原寬度` : `${title}加寬成整列`}
            title={wide ? '縮回原寬度' : '加寬成整列'}
            className={`${btn} hidden md:grid ${wide ? 'text-white bg-white/10' : ''}`}
          >
            ⤢
          </button>
          <button
            type="button"
            onClick={() => ctl.toggleCollapsed(id)}
            aria-expanded={!collapsed}
            aria-label={collapsed ? `展開${title}` : `收合${title}`}
            title={collapsed ? '展開' : '收合'}
            className={btn}
          >
            {collapsed ? '▸' : '▾'}
          </button>
          <button
            type="button"
            onClick={() => ctl.toggleHidden(id)}
            aria-label={`隱藏${title}`}
            title="隱藏（到「版面設定」可以找回來）"
            className={btn}
          >
            ✕
          </button>
        </div>
      </div>
      {!collapsed && <div className="ta-cardbody px-3.5 pb-3.5 pt-1.5 space-y-3">{children}</div>}
    </section>
  );
}

// 版面設定：勾選要顯示的卡片、全部收合／展開、還原預設
function LayoutMenu({ ctl }: { ctl: Ctl }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const off = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', off);
    window.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', off);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);
  const hiddenN = ctl.defs.filter((d) => ctl.prefs.hidden[d.id]).length;
  return (
    <div className="relative" ref={box} data-tour="watch-layout">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="text-[12.5px] px-3 py-1.5 rounded-[10px] border border-white/10 bg-white/5 text-slate-100 hover:bg-white/10 cursor-pointer whitespace-nowrap"
      >
        版面設定 ▾{hiddenN > 0 && <span className="ml-1 text-amber-300">（{hiddenN} 張隱藏）</span>}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 z-30 w-60 rounded-xl border border-white/10 bg-[#0b1020]/95 p-3 shadow-2xl backdrop-blur-xl space-y-2 text-xs">
          {ctl.defs.map((d) => (
            <label key={d.id} className="flex items-center gap-2 text-slate-200 cursor-pointer">
              <input type="checkbox" checked={!ctl.prefs.hidden[d.id]} onChange={() => ctl.toggleHidden(d.id)} />
              {d.title}
            </label>
          ))}
          <div className="flex gap-1.5 pt-1">
            <button type="button" onClick={ctl.foldAll} className="flex-1 px-2 py-1 rounded-lg bg-slate-800 border border-slate-700 text-slate-200 cursor-pointer">
              全部收合
            </button>
            <button type="button" onClick={ctl.openAll} className="flex-1 px-2 py-1 rounded-lg bg-slate-800 border border-slate-700 text-slate-200 cursor-pointer">
              全部展開
            </button>
          </div>
          <button type="button" onClick={ctl.reset} className="w-full px-2 py-1 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 cursor-pointer">
            還原預設版面
          </button>
        </div>
      )}
    </div>
  );
}

export { CardBox, CardGrid, LayoutMenu, useCardLayout };
export type { Ctl as CardCtl };
