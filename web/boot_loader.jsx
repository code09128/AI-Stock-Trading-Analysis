// 啟動預載：React 畫面出現前，在載入動畫上逐項顯示「正在準備哪些資料」，並先把看盤頁一開始要用的資料抓好。
// - 後端有快取（走勢小圖 10 分鐘、技術指標 5 分鐘、分時 30 秒），預載完進到畫面就不用再等
// - 每項最多等 STEP_MS；比較慢的照樣進入，那一項在背景繼續抓（請求不會取消）
// - 整體最多 MAX_MS；SKIP_AFTER_MS 後出現「直接進入」
(() => {
  const STEP_MS = 8000;
  const MAX_MS = 15000;
  const SKIP_AFTER_MS = 3000;

  const readJSON = (k, d) => {
    try {
      const v = JSON.parse(localStorage.getItem(k));
      return v ?? d;
    } catch (_e) {
      return d;
    }
  };
  const getJSON = async (url, body) => {
    const r = await fetch(
      url,
      body === undefined
        ? undefined
        : {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          },
    );
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  };

  // ---------- 載入動畫上的步驟清單 ----------
  function makeList() {
    const splash = document.getElementById('splash');
    if (!splash) return null;
    const msg = document.getElementById('splash-msg');
    const list = document.createElement('ul');
    list.className = 'sp-steps';
    splash.appendChild(list);
    const skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'sp-skip';
    skip.textContent = '直接進入（剩下的在背景繼續載入）';
    splash.appendChild(skip);
    return { list, msg, skip };
  }

  function addRow(ui, label) {
    if (!ui) return { set: () => {} };
    const li = document.createElement('li');
    li.dataset.state = 'run';
    const icon = document.createElement('span');
    icon.className = 'sp-icon';
    const text = document.createElement('span');
    text.className = 'sp-label';
    text.textContent = label;
    const detail = document.createElement('span');
    detail.className = 'sp-detail';
    li.append(icon, text, detail);
    ui.list.appendChild(li);
    return {
      set(state, info) {
        li.dataset.state = state;
        icon.textContent = state === 'ok' ? '✓' : state === 'warn' ? '!' : '';
        detail.textContent = info || '';
      },
    };
  }

  // 跑一個步驟：成功顯示結果摘要；逾時或失敗只標示，不擋住進入
  function runStep(ui, label, fn) {
    const row = addRow(ui, label);
    const started = Date.now();
    let done = false;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        row.set('warn', '比較慢，進入後在背景繼續載入');
        resolve();
      }, STEP_MS);
      Promise.resolve()
        .then(fn)
        .then(
          (info) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            const sec = ((Date.now() - started) / 1000).toFixed(1);
            row.set('ok', info ? `${info}・${sec} 秒` : `${sec} 秒`);
            resolve();
          },
          (e) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            row.set('warn', `沒有取得（${e?.message || e}），進入後會再試`);
            resolve();
          },
        );
    });
  }

  function bootPreload() {
    const ui = makeList();
    const setMsg = (t) => {
      if (ui?.msg) ui.msg.textContent = t;
    };
    let finish;
    const all = new Promise((r) => {
      finish = r;
    });
    const skipTimer = setTimeout(() => ui?.skip.classList.add('show'), SKIP_AFTER_MS);
    const capTimer = setTimeout(() => finish(), MAX_MS);
    ui?.skip.addEventListener('click', () => finish());

    (async () => {
      setMsg('正在準備資料…');
      await Promise.all([
        runStep(ui, '連線本機伺服器', async () => {
          await getJSON('/api/health');
          return '';
        }),
        runStep(ui, '讀取你的資料', async () => {
          await window.TA.userDataReady;
          const w = readJSON('tw_us_watchlist_v1', null);
          const h = readJSON('tw_us_holdings_v1', []);
          return `自選股 ${Array.isArray(w) ? w.length : '預設'} 檔、持股 ${h.length} 筆`;
        }),
      ]);
      // 自選股要等資料讀回來才知道；沒有設定過就用看盤頁的預設清單
      const watch = readJSON('tw_us_watchlist_v1', null) || window.TA.DEFAULT_WATCH || [];
      const held = readJSON('tw_us_holdings_v1', [])
        .map((h) => h?.symbol)
        .filter(Boolean);
      const syms = [...new Set([...watch, ...held])].slice(0, 60);
      setMsg('正在取得行情…');
      const steps = [
        runStep(ui, '大盤指數', async () => {
          const d = await getJSON('/api/indices');
          return `${(d.indices || []).length} 個指數`;
        }),
      ];
      if (syms.length) {
        steps.push(
          runStep(ui, '即時報價', async () => {
            const d = await getJSON('/api/quotes', { symbols: syms });
            const qs = (d.quotes || []).filter(Boolean);
            const live = qs.filter((q) => q.is_live).length;
            return `${live}／${qs.length} 檔有即時價`;
          }),
          runStep(ui, '走勢小圖', async () => {
            await getJSON('/api/sparks', { symbols: watch });
            return `${watch.length} 檔`;
          }),
        );
      }
      if (watch[0]) {
        steps.push(
          runStep(ui, `分時走勢（${watch[0]}）`, async () => {
            await getJSON('/api/intraday', { symbol: watch[0] });
            return '';
          }),
        );
      }
      await Promise.all(steps);
      // 技術指標要逐檔抓日 K，最慢：等上面的輕量資料好了再開始，不跟報價搶連線
      if (watch.length) {
        setMsg('正在計算技術指標…');
        await runStep(ui, '技術指標總覽', async () => {
          const d = await getJSON('/api/overview', { symbols: watch });
          return `${(d.rows || []).length} 檔`;
        });
      }
      setMsg('準備完成');
      setTimeout(finish, 250); // 讓使用者看得到最後一項打勾
    })().catch(() => finish());

    return all.finally(() => {
      clearTimeout(skipTimer);
      clearTimeout(capTimer);
    });
  }

  window.TA = Object.assign(window.TA || {}, { bootPreload });
})();
