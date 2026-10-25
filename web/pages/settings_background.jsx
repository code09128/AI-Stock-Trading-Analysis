// 設定頁：背景服務（按 X 時縮到系統匣、背景價格提醒、開機自動啟動）
(() => {
  const { useState, useEffect } = React;

  function BackgroundServicePanel() {
    const LS_BG = 'tw_us_bg_alerts_v1';
    const [bgAlerts, setBgAlerts] = useState(() => {
      const v = localStorage.getItem(LS_BG);
      return v === null ? true : v === 'true';
    });
    const [autostart, setAutostart] = useState(false);
    const [checking, setChecking] = useState(false);
    const [checkResult, setCheckResult] = useState('');

    useEffect(() => {
      fetch('/api/autostart')
        .then((r) => r.json())
        .then((d) => setAutostart(!!d.enabled))
        .catch(() => {});
    }, []);

    const toggleBg = (checked) => {
      setBgAlerts(checked);
      localStorage.setItem(LS_BG, String(checked));
      window.dispatchEvent(new Event('storage'));
      window.TA.notifySaved(
        `按 X 時的預設選項改為「${checked ? '縮到系統匣' : '結束程式'}」`,
      );
    };

    const toggleAutostart = (checked) => {
      setAutostart(checked);
      fetch('/api/autostart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: checked }),
      })
        .then((r) => r.json())
        .then((d) => {
          setAutostart(!!d.enabled);
          // 這個設定寫在 Windows 啟動清單（登錄檔），不是資料檔，所以不用 notifySaved
          window.TA.toast?.(
            d.ok && !!d.enabled === checked
              ? `✅ 已${checked ? '設定' : '取消'}「開機自動在背景啟動」`
              : `⚠️ 開機啟動設定沒有成功（Windows 啟動清單寫入失敗），目前為${d.enabled ? '開啟' : '關閉'}`,
          );
        })
        .catch((e) => {
          setAutostart(!checked);
          window.TA.toast?.(`⚠️ 開機啟動設定失敗：${e.message}`);
        });
    };

    const runCheckNow = () => {
      setChecking(true);
      setCheckResult('');
      fetch('/api/alerts/check_now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
        .then((r) => r.json())
        .then((d) => {
          const count = (d.fired || []).length;
          setCheckResult(
            count > 0
              ? `檢查完成：觸發了 ${count} 則提醒！`
              : '檢查完成：目前無提醒達標',
          );
        })
        .catch((e) => setCheckResult(`檢查失敗：${e.message}`))
        .finally(() => {
          setChecking(false);
          window.TA.reloadAlertsFromServer?.(); // 後端觸發的提醒已寫回資料檔，頁面要跟著更新
        });
    };

    return (
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-white">常駐背景提醒與系統匣（System Tray）</h3>
          <span className="text-[11px] px-2 py-0.5 rounded bg-sky-500/15 text-sky-300 border border-sky-500/30">
            Windows 桌面視窗版
          </span>
        </div>
        <p className="text-xs text-slate-400 leading-relaxed">
          桌面視窗版按右上角 X 時會詢問要「縮到系統匣」或「結束程式」。縮到系統匣後由後端服務持續檢查價格、漲跌幅（每 15
          秒）與 RSI（每 5 分鐘），達標時發送 Windows 桌面原生通知。
        </p>

        <div className="space-y-2 text-xs">
          <label className="flex items-center gap-2 text-slate-200 cursor-pointer">
            <input
              type="checkbox"
              checked={bgAlerts}
              onChange={(e) => toggleBg(e.target.checked)}
            />
            按 X 時預設選「縮到系統匣」（繼續在背景檢查提醒）
          </label>
          <label className="flex items-center gap-2 text-slate-200 cursor-pointer">
            <input
              type="checkbox"
              checked={autostart}
              onChange={(e) => toggleAutostart(e.target.checked)}
            />
            開機自動在背景啟動（登入 Windows 後常駐系統匣檢查提醒）
          </label>
        </div>

        <div className="flex items-center gap-3 pt-1 text-xs">
          <button
            type="button"
            onClick={runCheckNow}
            disabled={checking}
            className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-sky-300 hover:bg-slate-700 cursor-pointer disabled:opacity-50"
          >
            {checking ? '檢查中…' : '立即手動執行一輪提醒檢查'}
          </button>
          {checkResult && <span className="text-slate-300">{checkResult}</span>}
        </div>

        <div className="rounded-xl border border-slate-800/80 bg-slate-950/60 p-3 text-[11px] text-slate-400 space-y-1">
          <div className="font-semibold text-slate-300">如何關閉背景服務：</div>
          <div>1. 右下角系統匣圖示按右鍵：點選「暫停提醒」或「結束程式」。</div>
          <div>2. 按視窗右上角 X，在詢問視窗選「結束程式」。</div>
          <div>3. 若設定了開機自動啟動，取消勾選即可自 Windows 啟動清單中移除。</div>
        </div>
      </div>
    );
  }

  window.TA = Object.assign(window.TA || {}, { BackgroundServicePanel });
})();
