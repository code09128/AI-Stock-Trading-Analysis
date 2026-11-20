// 手動「立即更新」按鈕（看盤頁頂欄、熱力圖、大盤籌碼各卡共用）：
// - 按下馬上呼叫 onRefresh（呼叫端要跳過前端快取直接打 API），按鈕顯示「更新中…」並轉圈，至少 0.6 秒，本機回應太快時才看得出有在抓
// - 完成顯示「✓ 已更新」或「⚠ 更新失敗」＋倒數，冷卻 cooldownMs 內不能再按：避免一直按把證交所／Yahoo 打到限速
//   （後端另有共用快取與對外限速，這裡是第一道）
// onRefresh 回傳 false＝失敗（錯誤訊息由呼叫端照原本的方式顯示），其他值都當成功。
const { useState, useEffect } = React;

const MIN_BUSY_MS = 600;

function RefreshButton({
  onRefresh,
  idleLabel = '↻ 立即更新',
  title = '馬上重新抓資料（每 10 秒最多一次）',
  cooldownMs = 10000,
  className = '',
}: {
  onRefresh: () => Promise<unknown> | unknown;
  idleLabel?: any;
  title?: string;
  cooldownMs?: number;
  className?: string;
}) {
  const [st, setSt] = useState<{ state: 'idle' | 'busy' | 'done' | 'error'; at?: string; until: number }>({ state: 'idle', until: 0 });
  const [, setTick] = useState(0);
  const cooling = st.until > Date.now();
  useEffect(() => {
    if (!st.until) return undefined;
    const t = setInterval(() => {
      setTick(Date.now()); // 每秒重畫倒數
      if (Date.now() >= st.until) {
        clearInterval(t);
        setSt((s) => ({ ...s, until: 0 }));
      }
    }, 1000);
    return () => clearInterval(t);
  }, [st.until]);

  const run = async () => {
    if (st.state === 'busy' || st.until > Date.now()) return;
    setSt({ state: 'busy', until: 0 });
    let ok = true;
    try {
      const [res] = await Promise.all([Promise.resolve(onRefresh()), new Promise((r) => setTimeout(r, MIN_BUSY_MS))]);
      ok = res !== false;
    } catch {
      ok = false;
    }
    setSt({ state: ok ? 'done' : 'error', at: new Date().toLocaleTimeString('en-GB'), until: Date.now() + cooldownMs });
  };

  const left = Math.max(0, Math.ceil((st.until - Date.now()) / 1000));
  return (
    <button
      type="button"
      onClick={run}
      disabled={st.state === 'busy' || cooling}
      aria-live="polite"
      title={st.at ? `上次手動更新 ${st.at}${cooling ? `；為避免過度請求資料來源，${left} 秒後可再按` : ''}` : title}
      className={`inline-flex items-center justify-center gap-1 whitespace-nowrap border ${
        st.state === 'error' && cooling
          ? 'border-amber-400/40 bg-amber-500/10 text-amber-200'
          : st.state === 'done' && cooling
            ? 'border-emerald-400/30 bg-emerald-500/10 text-slate-200'
            : 'border-white/10 bg-white/5 text-slate-200'
      } ${st.state === 'busy' || cooling ? 'cursor-default opacity-90' : 'hover:bg-white/10 cursor-pointer'} ${className}`}
    >
      {st.state === 'busy' ? (
        <>
          <span className="ta-spin" aria-hidden="true">
            ↻
          </span>{' '}
          更新中…
        </>
      ) : cooling ? (
        <>
          {st.state === 'error' ? '⚠ 更新失敗' : '✓ 已更新'}
          <span className="mono text-[10px] opacity-70">{left}s</span>
        </>
      ) : (
        idleLabel
      )}
    </button>
  );
}

export { RefreshButton };
