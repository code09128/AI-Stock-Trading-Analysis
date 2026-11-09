// 設定頁：外觀（動態效果、資訊密度）
// 存在 tw_us_ui_prefs_v1（會跟著 userdata.json 同步）。套用方式：在 <html> 加 data-motion／data-density，樣式寫在 index.html。
// 動態效果「自動」＝跟隨作業系統的「減少動態效果」；「減少」＝一律關閉動畫與滑過浮起。
import { notifySaved } from '../sync_store';

const { useState, useEffect } = React;

const LS_UI = 'tw_us_ui_prefs_v1';
type UiPrefs = { motion: 'auto' | 'reduce'; density: 'comfortable' | 'compact'; color: 'tw' | 'us' };
const DEFAULT_PREFS: UiPrefs = { motion: 'auto', density: 'comfortable', color: 'tw' };

function loadUiPrefs(): UiPrefs {
  try {
    const v = JSON.parse(localStorage.getItem(LS_UI) || 'null');
    return {
      motion: v?.motion === 'reduce' ? 'reduce' : 'auto',
      density: v?.density === 'compact' ? 'compact' : 'comfortable',
      color: v?.color === 'us' ? 'us' : 'tw',
    };
  } catch (_e) {
    return DEFAULT_PREFS;
  }
}

function applyUiPrefs() {
  const p = loadUiPrefs();
  document.documentElement.dataset.motion = p.motion;
  document.documentElement.dataset.density = p.density;
  document.documentElement.dataset.color = p.color;
}

// 頂欄的快速切換：和設定頁存同一份
function setUiPref(patch: Partial<UiPrefs>) {
  localStorage.setItem(LS_UI, JSON.stringify({ ...loadUiPrefs(), ...patch }));
  window.dispatchEvent(new Event('ui-prefs-changed'));
}

// 開頁就套用；資料檔同步完成（userdata-status）後再套一次，因為偏好可能是從檔案讀回來的
applyUiPrefs();
window.addEventListener('userdata-status', applyUiPrefs);
window.addEventListener('ui-prefs-changed', applyUiPrefs);

const MOTION_OPTS = [
  ['auto', '自動', '有動畫；作業系統設定「減少動態效果」時自動關閉'],
  ['reduce', '減少', '關閉換頁淡入、數字閃動、滑過浮起等所有動畫'],
] as const;
const COLOR_OPTS = [
  ['tw', '紅漲綠跌', '台灣習慣：上漲紅色、下跌綠色'],
  ['us', '綠漲紅跌', '歐美習慣：上漲綠色、下跌紅色'],
] as const;
const DENSITY_OPTS = [
  ['comfortable', '舒適', '預設間距'],
  ['compact', '緊湊', '卡片內距與間距縮小，同一畫面看到更多資料'],
] as const;

function AppearanceSettings() {
  const [prefs, setPrefs] = useState<UiPrefs>(loadUiPrefs);
  useEffect(() => {
    const on = () => setPrefs(loadUiPrefs());
    window.addEventListener('ui-prefs-changed', on);
    return () => window.removeEventListener('ui-prefs-changed', on);
  }, []);
  const set = (patch: Partial<UiPrefs>) => {
    const next = { ...loadUiPrefs(), ...patch };
    setPrefs(next);
    try {
      localStorage.setItem(LS_UI, JSON.stringify(next));
    } catch (_e) {
      /* 存不了：這次仍會套用，下次開啟回到預設 */
    }
    window.dispatchEvent(new Event('ui-prefs-changed'));
    notifySaved('外觀偏好已更新');
  };
  const group = (
    label: string,
    key: keyof UiPrefs,
    opts: readonly (readonly [string, string, string])[],
  ) => (
    <fieldset className="space-y-1.5">
      <legend className="text-xs text-slate-300 font-semibold">{label}</legend>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {opts.map(([v, name, hint]) => (
          <button
            type="button"
            key={v}
            aria-pressed={prefs[key] === v}
            title={hint}
            onClick={() => set({ [key]: v } as Partial<UiPrefs>)}
            className={`px-3 py-1.5 rounded-lg border text-xs cursor-pointer ${
              prefs[key] === v
                ? 'border-sky-500 bg-sky-600/20 text-white'
                : 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="text-[11px] text-slate-500">{opts.find(([v]) => v === prefs[key])?.[2]}</div>
    </fieldset>
  );
  return (
    <div
      data-tour="settings-appearance"
      className="ta-card rounded-2xl p-5 space-y-3"
    >
      <h3 className="font-bold text-white">外觀：動態效果、資訊密度與漲跌配色</h3>
      <p className="text-xs text-slate-400 leading-relaxed">
        動畫只用來說明變化（換頁、報價漲跌、AI
        分析進度），不影響任何數字與功能。覺得會分心或畫面太鬆時可以在這裡調整，馬上生效。
      </p>
      {group('動態效果', 'motion', MOTION_OPTS)}
      {group('資訊密度', 'density', DENSITY_OPTS)}
      {group('漲跌配色', 'color', COLOR_OPTS)}
    </div>
  );
}

export { AppearanceSettings, applyUiPrefs, loadUiPrefs, setUiPref };
