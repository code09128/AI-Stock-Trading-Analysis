// 執行期才由別的模組設定的共用函式與狀態（取代原本掛在 window.TA 上、在 app.tsx 執行後才出現的欄位）。
// 呼叫前先檢查存在（例如 bus.toast?.('...')）：這些欄位在 App 掛載之前是 undefined。
// 限制：這是全域可變狀態；之後可以改成 React context 或事件匯流排。
export const bus: {
  goTab?: (tab: string) => void;
  toast?: (msg: string) => void;
  analyzeSymbol?: (sym: string) => void;
  backtestSymbol?: (sym: string) => void;
  startTour?: (step?: number | string) => void;
  currentPage?: string;
  appRendered?: boolean;
  desktopHidden?: boolean;
  [key: string]: any;
} = {};
