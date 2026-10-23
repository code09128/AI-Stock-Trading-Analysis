// 使用者資料同步：程式資料夾的 data/userdata.json 是正本，瀏覽器 localStorage 只是暫存。
// - 開頁面時先從伺服器讀回（App 等它完成才顯示，所以各頁一開始就讀到正確資料）
// - 第一次啟用：檔案裡沒有、瀏覽器裡有的資料，自動搬進檔案
// - 之後任何 tw_us_* 的寫入（持股、交易紀錄、規則、自選股、提醒、AI 設定…）0.5 秒後自動寫回檔案
(() => {
  const PREFIX = 'tw_us_';
  const SKIP = new Set(['tw_us_activity_v1']); // 操作紀錄量大，伺服器另有 logs/
  const synced = (k) => typeof k === 'string' && k.startsWith(PREFIX) && !SKIP.has(k);

  const proto = Storage.prototype;
  const rawSet = proto.setItem;
  const rawRemove = proto.removeItem;
  let ready = false;
  let pending = {};
  let timer = null;
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
        Object.assign(status, { ok: true, error: null, savedAt: new Date() });
      })
      .catch((e) => {
        pending = { ...values, ...pending }; // 失敗就留著下次再送
        Object.assign(status, { ok: false, error: e.message });
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
      for (const [k, v] of Object.entries(server)) rawSet.call(window.localStorage, k, v);
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
