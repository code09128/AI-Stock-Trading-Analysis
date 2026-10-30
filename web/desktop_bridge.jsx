// 桌面視窗版（desktop.py）專用：按 X 時的「縮到系統匣／結束程式」確認框，以及縮到系統匣時暫停頁面的提醒檢查。
// 瀏覽器版不會呼叫這些函式。選擇結果透過 window.pywebview.api.close_choice 傳回 Python。
(() => {
  let box = null;

  const choose = (choice) => {
    if (box) {
      box.remove();
      box = null;
    }
    document.removeEventListener('keydown', onKey, true);
    try {
      window.pywebview?.api?.close_choice(choice);
    } catch (_e) {
      /* 視窗已在關閉中 */
    }
  };

  function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      choose('cancel');
    }
  }

  const button = (label, sub, choice, primary) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `w-full text-left rounded-xl border px-4 py-3 cursor-pointer transition ${
      primary
        ? 'border-sky-500 bg-sky-600/20 hover:bg-sky-600/30'
        : 'border-slate-700 bg-slate-800/60 hover:bg-slate-800'
    }`;
    const t = document.createElement('div');
    t.className = 'text-sm font-semibold text-white';
    t.textContent = label;
    b.appendChild(t);
    if (sub) {
      const s = document.createElement('div');
      s.className = 'text-xs text-slate-400 mt-0.5';
      s.textContent = sub;
      b.appendChild(s);
    }
    b.addEventListener('click', () => choose(choice));
    return b;
  };

  // opts：{ tray: 系統匣是否可用, trayDefault: 預設選項是否為縮到系統匣 }
  function askClose(opts = {}) {
    if (box) return;
    box = document.createElement('div');
    box.className = 'fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    const card = document.createElement('div');
    card.className =
      'w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-900 p-5 space-y-3 shadow-2xl';
    const h = document.createElement('h3');
    h.className = 'font-bold text-white';
    h.textContent = '要關閉程式嗎？';
    card.appendChild(h);
    const buttons = [];
    if (opts.tray) {
      buttons.push(
        button('縮到系統匣', '視窗收起來，右下角繼續在背景檢查提醒', 'tray', opts.trayDefault),
      );
    }
    buttons.push(button('結束程式', '儲存資料後完全關閉', 'exit', !opts.trayDefault));
    buttons.push(button('取消', '', 'cancel', false));
    for (const b of buttons) card.appendChild(b);
    box.appendChild(card);
    box.addEventListener('click', (e) => {
      if (e.target === box) choose('cancel');
    });
    document.body.appendChild(box);
    document.addEventListener('keydown', onKey, true);
    (buttons.find((b) => b.className.includes('border-sky-500')) || buttons[0]).focus();
  }

  // 縮到系統匣時由 Python 背景引擎檢查提醒，頁面暫停；回到前景時重新載入資料檔裡的提醒（背景可能已觸發）
  function setDesktopHidden(hidden) {
    window.TA.desktopHidden = !!hidden;
    if (!hidden) {
      window.TA.reloadAlertsFromServer?.();
      window.dispatchEvent(new Event('ta-resume')); // 讓定時更新的畫面馬上補抓一次
    }
  }

  // 頁面不在前景（瀏覽器分頁切走、桌面版縮到系統匣）：定時更新的畫面先暫停，回來後下一輪再抓
  const pageAway = () => document.hidden || !!window.TA.desktopHidden;

  // 定時更新：不在前景就跳過該輪；回到前景（切回分頁、從系統匣叫回）立刻補抓一次，不用等下一輪。回傳取消函式
  function pollEvery(fn, ms) {
    const run = () => {
      if (!pageAway()) fn();
    };
    const id = setInterval(run, ms);
    document.addEventListener('visibilitychange', run);
    window.addEventListener('ta-resume', run);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', run);
      window.removeEventListener('ta-resume', run);
    };
  }

  // ---------- 畫面縮放（桌面版）----------
  // 用 WebView2 的 ZoomFactor（等同瀏覽器 Ctrl＋加減號）：字與介面一起放大，視窗的 CSS 寬度跟著變小，
  // 響應式版面會自動改排（例如放大後側欄收起、表格改成單欄），不會硬擠。瀏覽器版直接用瀏覽器的 Ctrl＋加減號。
  const LS_ZOOM = 'tw_us_zoom_v1';
  const ZOOM_MIN = 0.7;
  const ZOOM_MAX = 1.75;
  const ZOOM_PRESETS = [0.8, 0.9, 1, 1.1, 1.25, 1.5];
  const clampZoom = (z) => Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)) * 100) / 100;
  const savedZoom = () => {
    try {
      const z = Number(JSON.parse(localStorage.getItem(LS_ZOOM)));
      return z > 0 ? clampZoom(z) : 1;
    } catch (_e) {
      return 1;
    }
  };
  let zoom = savedZoom();
  const canZoom = () => !!window.pywebview?.api?.set_zoom;

  let saveTimer = null;
  function setZoom(z, { save = true } = {}) {
    if (!canZoom()) return;
    zoom = clampZoom(z);
    window.pywebview.api.set_zoom(zoom).catch(() => {});
    window.dispatchEvent(new Event('zoom-changed'));
    if (save) {
      clearTimeout(saveTimer); // Ctrl＋滾輪會連續觸發：停下來才存
      saveTimer = setTimeout(() => {
        try {
          localStorage.setItem(LS_ZOOM, JSON.stringify(zoom));
        } catch (_e) {
          /* 存不了下次就回到 100% */
        }
      }, 400);
    }
  }
  // ＋／－ 跳到下一個常用比例；超出常用範圍時每次 10%
  const stepZoom = (dir) => {
    const next =
      dir > 0
        ? ZOOM_PRESETS.find((p) => p > zoom + 0.001)
        : [...ZOOM_PRESETS].reverse().find((p) => p < zoom - 0.001);
    setZoom(next ?? zoom + dir * 0.1);
  };

  // pywebview 的 api 物件是頁面載入後才注入：注入完成就套用上次的縮放
  const applySaved = () => canZoom() && setZoom(savedZoom(), { save: false });
  window.addEventListener('pywebviewready', applySaved);
  applySaved();

  document.addEventListener(
    'keydown',
    (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || !canZoom()) return;
      if (e.key === '=' || e.key === '+') stepZoom(1);
      else if (e.key === '-' || e.key === '_') stepZoom(-1);
      else if (e.key === '0') setZoom(1);
      else return;
      e.preventDefault();
    },
    true,
  );
  let wheelAcc = 0;
  window.addEventListener(
    'wheel',
    (e) => {
      if (!e.ctrlKey || !canZoom()) return;
      e.preventDefault();
      wheelAcc += e.deltaY;
      if (Math.abs(wheelAcc) < 100) return; // 觸控板的細小捲動累積到一格才縮放
      setZoom(zoom + (wheelAcc < 0 ? 0.05 : -0.05));
      wheelAcc = 0;
    },
    { passive: false },
  );

  function useZoom() {
    const [, tick] = React.useState(0);
    React.useEffect(() => {
      const on = () => tick((x) => x + 1);
      window.addEventListener('zoom-changed', on);
      window.addEventListener('pywebviewready', on);
      return () => {
        window.removeEventListener('zoom-changed', on);
        window.removeEventListener('pywebviewready', on);
      };
    }, []);
    return { zoom, available: canZoom() };
  }

  // 標題列的小控制：－ 100% ＋（點百分比回到 100%）
  function ZoomControl() {
    const { zoom: z, available } = useZoom();
    if (!available) return null;
    const btn =
      'w-7 h-7 flex items-center justify-center text-slate-300 hover:text-white hover:bg-slate-700 cursor-pointer disabled:opacity-40';
    return (
      <div
        className="hidden sm:flex items-center rounded-lg border border-slate-700 bg-slate-800 text-xs overflow-hidden"
        title="畫面縮放（Ctrl＋加減號、Ctrl＋滾輪；Ctrl＋0 回到 100%）"
      >
        <button
          type="button"
          className={btn}
          onClick={() => stepZoom(-1)}
          disabled={z <= ZOOM_MIN}
          aria-label="縮小畫面"
        >
          −
        </button>
        <button
          type="button"
          className="px-1.5 h-7 mono text-slate-200 hover:bg-slate-700 cursor-pointer"
          onClick={() => setZoom(1)}
          aria-label="畫面縮放比例，按一下回到 100%"
        >
          {Math.round(z * 100)}%
        </button>
        <button
          type="button"
          className={btn}
          onClick={() => stepZoom(1)}
          disabled={z >= ZOOM_MAX}
          aria-label="放大畫面"
        >
          +
        </button>
      </div>
    );
  }

  // 設定頁：常用比例
  function ZoomSettings() {
    const { zoom: z, available } = useZoom();
    return (
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-3">
        <h3 className="font-bold text-white">畫面縮放</h3>
        {available ? (
          <>
            <p className="text-xs text-slate-400 leading-relaxed">
              字與介面一起放大縮小，版面會依放大後的寬度自動重新排列（不會擠在一起）。也可以用
              Ctrl＋加減號、Ctrl＋滾輪，Ctrl＋0 回到 100%；下次開啟會沿用。
            </p>
            <div className="flex flex-wrap gap-2">
              {ZOOM_PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setZoom(p)}
                  className={`px-3 py-1.5 rounded-lg border text-xs cursor-pointer ${
                    Math.abs(z - p) < 0.001
                      ? 'border-sky-500 bg-sky-600/20 text-white'
                      : 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {Math.round(p * 100)}%
                </button>
              ))}
              <span className="self-center text-xs text-slate-500 ml-1">
                目前 {Math.round(z * 100)}%
              </span>
            </div>
          </>
        ) : (
          <p className="text-xs text-slate-400 leading-relaxed">
            瀏覽器版請用瀏覽器本身的縮放：Ctrl＋加減號或 Ctrl＋滾輪，Ctrl＋0
            回到 100%。桌面視窗版會在這裡顯示縮放按鈕。
          </p>
        )}
      </div>
    );
  }

  window.TA = Object.assign(window.TA || {}, {
    askClose,
    setDesktopHidden,
    desktopHidden: false,
    pageAway,
    pollEvery,
    ZoomControl,
    ZoomSettings,
  });
})();
