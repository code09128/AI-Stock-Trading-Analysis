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
  // 多市場：與後端 src/markets.py 同一份後綴規則（沒有後綴＝美股）
  const MARKET_INFO = {
    TW: { name: '台股', currency: 'TWD', flag: '', tz: 'Asia/Taipei' },
    US: { name: '美股', currency: 'USD', flag: '', tz: 'America/New_York' },
    HK: { name: '港股', currency: 'HKD', flag: '', suffixes: ['.HK'], tz: 'Asia/Hong_Kong' },
    JP: { name: '日股', currency: 'JPY', flag: '', suffixes: ['.T'], tz: 'Asia/Tokyo' },
    KR: { name: '韓股', currency: 'KRW', flag: '', suffixes: ['.KS', '.KQ'], tz: 'Asia/Seoul' },
    CN: { name: '陸股', currency: 'CNY', flag: '', suffixes: ['.SS', '.SZ'], tz: 'Asia/Shanghai' },
    UK: { name: '英股', currency: 'GBp', flag: '', suffixes: ['.L'], tz: 'Europe/London' },
    DE: { name: '德股', currency: 'EUR', flag: '', suffixes: ['.DE', '.F'], tz: 'Europe/Berlin' },
    CA: { name: '加股', currency: 'CAD', flag: '', suffixes: ['.TO', '.V'], tz: 'America/Toronto' },
    AU: { name: '澳股', currency: 'AUD', flag: '', suffixes: ['.AX'], tz: 'Australia/Sydney' },
    SG: { name: '星股', currency: 'SGD', flag: '', suffixes: ['.SI'], tz: 'Asia/Singapore' },
  };
  const tzOf = (sym) => MARKET_INFO[marketOf(sym)]?.tz || 'America/New_York';
  const marketOf = (sym) => {
    const s = String(sym || '').toUpperCase();
    if (isTW(s)) return 'TW';
    for (const [k, v] of Object.entries(MARKET_INFO)) {
      if ((v.suffixes || []).some((x) => s.endsWith(x) && s.length > x.length)) return k;
    }
    return 'US';
  };
  const marketName = (sym) => MARKET_INFO[marketOf(sym)].name;
  // 預設計價幣別（實際以報價回傳的 currency 為準；英股是 GBp 便士）
  // 台股賣出證交稅率（與後端 market_rules.tw_sell_tax_rate 相同）：股票 0.3%、ETF 0.1%、債券 ETF 停徵到 2026-12-31
  // 台股賣出證交稅率：股票 0.3%、ETF 0.1%、債券 ETF 停徵（期限要和後端 market_rules.BOND_ETF_TAX_FREE_UNTIL 一致）
  const twSellTaxRate = (code) => {
    const c = String(code || '').toUpperCase().replace(/\.(TW|TWO)$/, '');
    if (!c.startsWith('00')) return 0.003;
    if (c.endsWith('B') && new Date().toLocaleDateString('sv-SE') <= '2026-12-31') return 0;
    return 0.001;
  };
  const currencyOf = (sym) => MARKET_INFO[marketOf(sym)].currency;
  // 以代號第一段判斷，與後端 normalize_symbol 同一規則；港股補滿 4 位數（700.HK → 0700.HK）
  const normSym = (raw) => {
    const t = raw.trim().toUpperCase().split(/\s+/)[0] || '';
    if (!t) return '';
    if (isTW(t)) return t.split('.')[0];
    const hk = t.match(/^(\d{1,4})\.HK$/);
    return hk ? `${hk[1].padStart(4, '0')}.HK` : t;
  };
  // 比對用的代號：只有台股去掉 .TW／.TWO；其他市場保留後綴（避免日股 7203.T 與台股 7203 撞號）
  const baseCode = (sym) => {
    const s = String(sym || '').toUpperCase();
    return isTW(s) ? s.split('.')[0] : s;
  };
  // 代號清單去重：0050 與 0050.TW、不同券商的同一檔只留第一個寫法（持股快捷鈕、熱力圖、訊號掃描共用）
  const uniqueSymbols = (syms) => {
    const seen = new Set();
    return (syms || []).filter((s) => {
      const k = s ? baseCode(normSym(String(s))) : '';
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };

  const fmt = (n, d = 2) =>
    n === null || n === undefined || Number.isNaN(n)
      ? '--'
      : Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

  // 帶正負號的數字（+1.23、-0.50）；沒有值顯示 --。unit 例如 '%'
  const signed = (v, d = 2, unit = '') => {
    const s = fmt(v, d);
    return s === '--' ? s : `${v > 0 ? '+' : ''}${s}${unit}`;
  };

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
  // 台股手續費折數：模擬下單、策略回測、存股計畫共用同一個設定（預設 0.6＝六折，跟回測預設一致）
  const LS_FEE_DISCOUNT = 'tw_us_fee_discount_v1';
  const feeDiscount = () => {
    const v = Number(readLS(LS_FEE_DISCOUNT, 0.6));
    return v > 0 && v <= 1 ? v : 0.6;
  };
  const setFeeDiscount = (v) => {
    const n = Number(v);
    if (!(n > 0 && n <= 1)) return false; // 輸入到一半（空白、0.）先不存
    writeLS(LS_FEE_DISCOUNT, n);
    window.dispatchEvent(new Event('fee-discount-changed'));
    return true;
  };
  // 台股手續費：成交金額 × 0.1425% × 折數，元以下捨去；整張最低 20 元、零股最低 1 元（與後端 market_rules 相同）
  const twFee = (amount, round, discount = feeDiscount()) =>
    Math.max(round ? 20 : 1, Math.floor(amount * 0.001425 * discount + 1e-9));
  // 本機日期 YYYY-MM-DD（toISOString 是 UTC，台灣早上 8 點前會是前一天）
  const localDate = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

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

  // 後端資料來源代碼 → 白話名稱
  const SOURCE_LABELS = {
    LIVE_YAHOO_FINANCE: 'Yahoo Finance',
    LIVE_FINMIND: 'FinMind',
    FALLBACK_OFFLINE: '離線範例資料',
  };
  const sourceLabel = (code) => SOURCE_LABELS[code] || code || '--';

  window.TA = Object.assign(window.TA || {}, {
    sourceLabel,
    DEFAULT_WATCH,
    LS_WATCH,
    LS_CART,
    LS_TOUR,
    readLS,
    writeLS,
    isTW,
    MARKET_INFO,
    marketOf,
    tzOf,
    marketName,
    currencyOf,
    twSellTaxRate,
    normSym,
    baseCode,
    uniqueSymbols,
    fmt,
    signed,
    colorOf,
    twTick,
    isOnTick,
    twFee,
    feeDiscount,
    setFeeDiscount,
    localDate,
    Tip,
    Stat,
  });
})();
