// 全域宣告：各檔靠 window.TA 互相引用（沒有 import／export），型別先用 any，之後可逐步補成具體介面。
declare const React: typeof import('react');
declare const ReactDOM: typeof import('react-dom/client') & typeof import('react-dom');
declare const tailwind: any;

interface Window {
  TA: any;
  [key: string]: any;
}
