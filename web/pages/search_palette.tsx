// 看盤頁左側的搜尋視窗（按 / 或點清單上方的搜尋列開啟）：打代號或台股名稱，Enter 開啟該股，★ 直接加入／移出自選。
// 名稱查詢走 /api/symbol_search（只查本機快取的台股名單，不會多打外部網站）；英數代號（2330、NVDA、0700.HK）直接當代號用。
import { baseCode, normSym } from '../ui';

const { useState, useEffect, useRef } = React;

const TICKER_RE = /^[A-Za-z0-9.\-]+$/;

type Hit = { sym: string; name: string; note?: string };

function SearchPalette({ open, onClose, watch, names, onOpen, onToggle }: {
  open: boolean;
  onClose: () => void;
  watch: string[];
  names: Record<string, string>;
  onOpen: (sym: string) => void;
  onToggle: (sym: string) => void;
}) {
  const [q, setQ] = useState('');
  const [matches, setMatches] = useState<Hit[]>([]);
  const [busy, setBusy] = useState(false);
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // 開啟時記住原本的焦點，關閉後還回去（用鍵盤的人才不會迷路）
  useEffect(() => {
    if (!open) return undefined;
    const back = document.activeElement as HTMLElement | null;
    return () => {
      if (back && document.contains(back)) back.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setQ('');
    setMatches([]);
    setIdx(0);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  // 名稱查詢：停止打字 200ms 後才查，避免每個字都打一次
  useEffect(() => {
    const v = q.trim();
    if (!open || !v || (TICKER_RE.test(v) && !/^[A-Za-z]/.test(v))) {
      setMatches([]);
      setBusy(false);
      return undefined;
    }
    let stop = false;
    setBusy(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch('/api/symbol_search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: v }),
        });
        const ms = r.ok ? (await r.json()).matches || [] : [];
        if (!stop) setMatches(ms.map((m: any) => ({ sym: String(m.code), name: String(m.name || '') })));
      } catch (_e) {
        if (!stop) setMatches([]);
      } finally {
        if (!stop) setBusy(false);
      }
    }, 200);
    return () => {
      stop = true;
      clearTimeout(t);
    };
  }, [q, open]);

  if (!open) return null;

  const v = q.trim();
  let hits: Hit[];
  if (!v) {
    hits = watch.map((s) => ({ sym: s, name: names[baseCode(s)] || '' }));
  } else {
    hits = [];
    // 「2330 台積電」這種代號＋名稱：第一段是英數就當代號（跟原本的新增輸入框一樣）
    const head = v.split(/\s+/)[0];
    if (TICKER_RE.test(head)) {
      const s = normSym(head);
      if (s) hits.push({ sym: s, name: names[baseCode(s)] || '', note: '代號' });
    }
    for (const m of matches) if (!hits.some((h) => baseCode(h.sym) === baseCode(m.sym))) hits.push(m);
  }
  const cur = Math.min(idx, Math.max(0, hits.length - 1));
  const inWatch = (s: string) => watch.some((w) => baseCode(w) === baseCode(s));

  const onKey = (e: any) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setIdx(Math.max(0, Math.min(hits.length - 1, cur + (e.key === 'ArrowDown' ? 1 : -1))));
    } else if (e.key === 'Enter' && hits[cur]) {
      e.preventDefault();
      onOpen(hits[cur].sym);
      onClose();
    }
  };

  return ReactDOM.createPortal(
    // biome-ignore lint/a11y/noStaticElementInteractions: 點背景關閉；鍵盤用 Esc
    // biome-ignore lint/a11y/useKeyWithClickEvents: 同上
    <div
      className="fixed inset-0 z-[80] bg-black/55 flex items-start justify-center px-4 pt-[12vh]"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="搜尋股票"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
        }}
        className="ta-card w-full max-w-[520px] rounded-2xl overflow-hidden bg-slate-900"
      >
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setIdx(0);
          }}
          onKeyDown={onKey}
          role="combobox"
          aria-expanded="true"
          aria-controls="search-palette-list"
          aria-activedescendant={hits[cur] ? `sp-${cur}` : undefined}
          aria-label="搜尋代號或台股名稱"
          placeholder="2330、台積電、NVDA"
          className="w-full bg-transparent border-0 border-b border-white/10 px-4 py-3.5 text-[15px] text-white placeholder:text-slate-500 focus:outline-none"
        />
        <div id="search-palette-list" role="listbox" aria-label="搜尋結果" className="max-h-[50vh] overflow-y-auto p-2 space-y-1">
          {!v && <div className="text-[11px] text-slate-500 px-2 pt-1 pb-0.5">你的自選股</div>}
          {hits.map((h, i) => (
            // biome-ignore lint/a11y/useKeyWithClickEvents: 鍵盤操作在輸入框（↑↓ Enter）
            <div
              key={h.sym}
              id={`sp-${i}`}
              role="option"
              tabIndex={-1}
              aria-selected={i === cur}
              onMouseEnter={() => setIdx(i)}
              onClick={() => {
                onOpen(h.sym);
                onClose();
              }}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 cursor-pointer ${i === cur ? 'ta-row-on' : 'hover:bg-white/5'}`}
            >
              <div className="min-w-0 flex-1">
                <b className="block text-[13.5px] text-white truncate">{h.name || h.sym}</b>
                <small className="text-[11.5px] text-slate-400 mono">
                  {h.sym}
                  {h.note && <span className="ml-1.5 text-slate-500">・{h.note}</span>}
                </small>
              </div>
              <button
                type="button"
                aria-pressed={inWatch(h.sym)}
                aria-label={`${inWatch(h.sym) ? '移出' : '加入'}自選：${h.name || h.sym}`}
                title={inWatch(h.sym) ? '已在自選（再按移出）' : '加入自選'}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggle(h.sym);
                }}
                className={`ta-icon w-8 h-8 rounded-lg inline-flex items-center justify-center text-[17px] cursor-pointer ${
                  inWatch(h.sym) ? 'text-amber-300' : 'text-slate-400 hover:text-amber-200'
                }`}
              >
                {inWatch(h.sym) ? '★' : '☆'}
              </button>
            </div>
          ))}
          {v && !hits.length && (
            <div className="text-sm text-slate-500 px-3 py-4">
              {busy ? '查詢中…' : `找不到「${v}」。台股可打名稱或代號，美股請打 ticker（例如 AAPL）`}
            </div>
          )}
        </div>
        <div className="text-[11px] text-slate-500 px-4 py-2 border-t border-white/10">↑↓ 選擇・Enter 開啟・★ 加入自選・Esc 關閉</div>
      </div>
    </div>,
    document.body,
  );
}

export { SearchPalette };
