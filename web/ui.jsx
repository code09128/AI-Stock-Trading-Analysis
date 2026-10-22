// 共用工具與小元件（格式化、localStorage、台股檔位、Tip/Stat…）
(() => {
  const DEFAULT_WATCH = ['2330', '0055', '00891', '0050', '00935', '00849B', 'SPCX', 'NVDA'];
  const LS_WATCH = 'tw_us_watchlist_v1';
  const LS_CART = 'tw_us_cart_v1';
  const LS_TOUR = 'tw_us_tour_done_v1';

  const readLS = (key, fallback) => {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch (_e) {
      return fallback;
    }
  };
  const writeLS = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (_e) {
      /* 隱私模式等情況無法寫入，忽略 */
    }
  };

  const isTW = (sym) => /^\d{4,6}[A-Z]?(\.TW|\.TWO)?$/i.test(sym);
  // 以代號第一段判斷，與後端 normalize_symbol 同一規則
  const normSym = (raw) => {
    const t = raw.trim().toUpperCase().split(/\s+/)[0] || '';
    if (!t) return '';
    return isTW(t) ? t.split('.')[0] : t;
  };
  const baseCode = (sym) => sym.split('.')[0];

  const fmt = (n, d = 2) =>
    n === null || n === undefined || Number.isNaN(n)
      ? '--'
      : Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

  // 台灣紅漲綠跌
  const colorOf = (chg) =>
    chg > 0 ? 'text-rose-400' : chg < 0 ? 'text-emerald-400' : 'text-slate-300';

  // 台股跳動檔位（ETF 與股票不同）
  const twTick = (price, etf) => {
    if (etf) return price < 50 ? 0.01 : 0.05;
    if (price < 10) return 0.01;
    if (price < 50) return 0.05;
    if (price < 100) return 0.1;
    if (price < 500) return 0.5;
    if (price < 1000) return 1;
    return 5;
  };
  const isOnTick = (price, tick) => Math.abs(price / tick - Math.round(price / tick)) < 1e-6;

  // ---------- 小元件 ----------
  // 說明小圓點：點一下（或滑過、Tab 聚焦）顯示說明，再點一次／點外面／Esc／捲動就關閉。
  // 說明框掛在 body 上用 fixed 定位，不會被可捲動的容器裁切；原生 title 在部分瀏覽器不會出現，所以不用。
  function Tip({ text }) {
    const { useState, useRef, useEffect, useLayoutEffect } = React;
    const [open, setOpen] = useState(false);
    const [pinned, setPinned] = useState(false);
    const [pos, setPos] = useState(null);
    const btnRef = useRef(null);
    const boxRef = useRef(null);

    const close = () => {
      setOpen(false);
      setPinned(false);
    };

    useLayoutEffect(() => {
      if (!open || !btnRef.current || !boxRef.current) return;
      const b = btnRef.current.getBoundingClientRect();
      const w = boxRef.current.offsetWidth;
      const h = boxRef.current.offsetHeight;
      const left = Math.min(Math.max(8, b.left + b.width / 2 - w / 2), window.innerWidth - w - 8);
      const below = b.bottom + 6;
      const top = below + h > window.innerHeight - 8 ? Math.max(8, b.top - h - 6) : below;
      setPos({ left, top });
    }, [open]);

    useEffect(() => {
      if (!open) return undefined;
      const onDown = (e) => {
        if (!btnRef.current?.contains(e.target) && !boxRef.current?.contains(e.target)) close();
      };
      const onKey = (e) => e.key === 'Escape' && close();
      window.addEventListener('mousedown', onDown);
      window.addEventListener('keydown', onKey);
      window.addEventListener('scroll', close, true);
      window.addEventListener('resize', close);
      return () => {
        window.removeEventListener('mousedown', onDown);
        window.removeEventListener('keydown', onKey);
        window.removeEventListener('scroll', close, true);
        window.removeEventListener('resize', close);
      };
    }, [open]);

    const toggle = (e) => {
      e.preventDefault(); // 在 <label> 裡時，避免點了說明卻跳到輸入框
      e.stopPropagation(); // 在可點的列裡時，避免同時觸發選取
      if (pinned) close();
      else {
        setPinned(true);
        setOpen(true);
      }
    };

    return (
      <>
        {/* biome-ignore lint/a11y/useSemanticElements: 會被放在可點的列或 label 裡，不能用 button 巢狀 */}
        <span
          ref={btnRef}
          role="button"
          tabIndex={0}
          aria-label="說明"
          aria-expanded={open}
          onClick={toggle}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && toggle(e)}
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => !pinned && setOpen(false)}
          onFocus={() => setOpen(true)}
          onBlur={() => !pinned && setOpen(false)}
          className={`inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] cursor-pointer ml-1 align-middle select-none ${
            open ? 'bg-sky-500 text-white' : 'bg-slate-700 text-slate-200 hover:bg-slate-600'
          }`}
        >
          ?
        </span>
        {open &&
          ReactDOM.createPortal(
            <div
              ref={boxRef}
              role="tooltip"
              style={{
                position: 'fixed',
                left: pos ? pos.left : -9999,
                top: pos ? pos.top : -9999,
                zIndex: 1000,
              }}
              className="max-w-xs w-max px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 shadow-xl text-xs leading-relaxed text-slate-100 font-normal normal-case tracking-normal text-left whitespace-normal"
            >
              {text}
            </div>,
            document.body,
          )}
      </>
    );
  }

  const Stat = ({ label, value, cls = 'text-white', tip }) => (
    <div className="bg-slate-950/70 border border-slate-800 rounded-xl px-3 py-2">
      <div className="text-[11px] text-slate-400">
        {label}
        {tip && <Tip text={tip} />}
      </div>
      <div className={`mono text-base font-bold ${cls}`}>{value}</div>
    </div>
  );

  window.TA = Object.assign(window.TA || {}, {
    DEFAULT_WATCH,
    LS_WATCH,
    LS_CART,
    LS_TOUR,
    readLS,
    writeLS,
    isTW,
    normSym,
    baseCode,
    fmt,
    colorOf,
    twTick,
    isOnTick,
    Tip,
    Stat,
  });
})();
