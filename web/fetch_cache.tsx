// 前端短期快取：切頁回來、同一畫面的不同卡片要同一份資料時，不用再問一次伺服器。
// - 同樣的請求（網址＋內容）正在跑就共用，不重複送
// - ttlMs 內直接用上次結果；ttlMs 設 0＝一定重抓（使用者按「更新」）
// - 帶 error 的回應與 404 不記住，下次會重試
// 只用在「看一下就好」的唯讀資料；時間要短於或等於後端快取，畫面才不會比原本舊。
// 限制：記憶體快取，重新整理頁面就清空；項目超過 MAX_ITEMS 時整批清掉（不做 LRU，這個量級用不到）。
const MAX_ITEMS = 300;
const store = new Map<string, { at: number; value: any }>();
const flying = new Map<string, Promise<any>>();

async function request(url: string, body: unknown): Promise<any> {
  const res = await fetch(
    url,
    body === undefined
      ? undefined
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
  );
  // 只線上更新畫面、後端還是舊版時會遇到 404（內容也不一定是 JSON）
  if (res.status === 404) return { error: '這個版本的後端還不支援（要重新安裝新版才有）', _status: 404 };
  return res.json();
}

function cachedJson(url: string, body: unknown, ttlMs: number): Promise<any> {
  const key = `${url}|${body === undefined ? '' : JSON.stringify(body)}`;
  const hit = store.get(key);
  if (ttlMs > 0 && hit && Date.now() - hit.at < ttlMs) return Promise.resolve(hit.value);
  const running = flying.get(key);
  if (running) return running;
  const job = request(url, body)
    .then((value) => {
      if (value && !value.error) {
        if (store.size >= MAX_ITEMS) store.clear();
        store.set(key, { at: Date.now(), value });
      }
      return value;
    })
    .finally(() => flying.delete(key));
  flying.set(key, job);
  return job;
}

export { cachedJson };
