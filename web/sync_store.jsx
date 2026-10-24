// 使用者資料同步：程式資料夾的 data/userdata.json 是正本，瀏覽器 localStorage 只是暫存。
// - 開頁面時先從伺服器讀回（App 等它完成才顯示，所以各頁一開始就讀到正確資料）
// - 第一次啟用：檔案裡沒有、瀏覽器裡有的資料，自動搬進檔案
// - 之後任何 tw_us_* 的寫入（持股、交易紀錄、規則、自選股、提醒、AI 設定…）0.5 秒後自動寫回檔案
(() => {
  // 所有 /api/ 請求都有等待上限：資料來源或網路卡住時，畫面不會永遠停在「載入中」。
  // 上限比後端自己的逾時（行情 8～25 秒、AI 最多 180 秒）寬，正常的慢請求不會被誤砍。
  const rawFetch = window.fetch.bind(window);
  const LONG = ['/api/ai/', '/api/mod1/analyze', '/api/mod2/', '/api/news/digest', '/api/mod4/', '/api/mod5/'];
  window.fetch = (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    // 串流的 AI 解讀不設總時限（本機模型長回答可能超過 4 分鐘）；後端每段讀取有自己的逾時
    if (!url.includes('/api/') || url.includes('explain_stream') || init.signal || !window.AbortSignal?.timeout) {
      return rawFetch(input, init);
    }
    const ms = LONG.some((p) => url.includes(p)) ? 240000 : 90000;
    return rawFetch(input, { ...init, signal: AbortSignal.timeout(ms) }).catch((e) => {
      if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
        throw new Error(`等待伺服器超過 ${ms / 1000} 秒沒有回應（網路或資料來源可能卡住），請稍後再試`);
      }
      throw e;
    });
  };

  const PREFIX = 'tw_us_';
  const SKIP = new Set(['tw_us_activity_v1']); // 操作紀錄量大，伺服器另有 logs/
  const synced = (k) => typeof k === 'string' && k.startsWith(PREFIX) && !SKIP.has(k);

  const proto = Storage.prototype;
  const rawSet = proto.setItem;
  const rawRemove = proto.removeItem;
  let ready = false;
  let pending = {};
  let timer = null;
  let retryMs = 3000;
  const status = { ok: true, path: null, error: null, savedAt: null };

  const flush = (keepalive = false) => {
    clearTimeout(timer);
    timer = null;
    const values = pending;
    pending = {};
    if (!Object.keys(values).length) return Promise.resolve();
    return fetch('/api/userdata/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values }),
      keepalive,
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        retryMs = 3000;
        Object.assign(status, { ok: true, error: null, savedAt: new Date() });
      })
      .catch((e) => {
        pending = { ...values, ...pending }; // 失敗就留著自動再送（不必等下一次修改），間隔 3 秒起逐次加倍、最長 1 分鐘
        Object.assign(status, { ok: false, error: e.message });
        if (!timer) timer = setTimeout(() => flush(), retryMs);
        retryMs = Math.min(retryMs * 2, 60000);
      })
      .finally(() => window.dispatchEvent(new Event('userdata-status')));
  };
  const queue = (k, v) => {
    pending[k] = v;
    if (!timer) timer = setTimeout(() => flush(), 500);
  };

  proto.setItem = function (k, v) {
    rawSet.call(this, k, v);
    if (ready && this === window.localStorage && synced(k)) queue(k, String(v));
  };
  proto.removeItem = function (k) {
    rawRemove.call(this, k);
    if (ready && this === window.localStorage && synced(k)) queue(k, null);
  };
  window.addEventListener('pagehide', () => flush(true));

  const userDataReady = fetch('/api/userdata')
    .then((r) => r.json())
    .then((d) => {
      const server = d.values || {};
      status.path = d.path;
      let changed = false;
      for (const [k, v] of Object.entries(server)) {
        if (window.localStorage.getItem(k) !== v) changed = true;
        rawSet.call(window.localStorage, k, v);
      }
      // 畫面已經用舊資料先顯示（伺服器超過 4 秒才回應）且內容不同：重新載入，
      // 不然 React 裡的舊值會在下次操作時寫回去蓋掉檔案裡的正本
      if (changed && window.TA?.appRendered) {
        window.location.reload();
        return undefined;
      }
      // 檔案裡還沒有的（升級前只存在瀏覽器的資料）→ 搬進檔案
      for (let i = 0; i < window.localStorage.length; i += 1) {
        const k = window.localStorage.key(i);
        if (synced(k) && !(k in server)) pending[k] = window.localStorage.getItem(k);
      }
      ready = true;
      return flush();
    })
    .catch((e) => {
      ready = true; // 伺服器讀不到：照常用瀏覽器資料，之後的修改仍會嘗試寫回
      Object.assign(status, { ok: false, error: `讀取資料檔失敗：${e.message}` });
    });

  window.TA = Object.assign(window.TA || {}, { userDataReady, userDataStatus: status, flushUserData: flush });
})();
