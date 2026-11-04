// 前端進入點：依原本 index.html 的載入順序匯入（有副作用的檔案：攔截 fetch、同步資料、掛載畫面），由 esbuild 打包成 app.bundle.js
import './sync_store';
import './config';
import './charts';
import './panels/technical_parts';
import './panels/technical';
import './panels/news';
import './panels/backtest_parts';
import './panels/backtest_verify';
import './panels/backtest_tools';
import './panels/backtest_replay';
import './panels/backtest_portfolio';
import './panels/backtest_custom';
import './panels/backtest';
import './panels/portfolio';
import './panels/journal';
import './panels/selftest';
import './ui';
import './activity_log';
import './markdown';
import './ai_store';
import './portfolio_store';
import './live_widgets';
import './pages/watch_parts';
import './pages/overview_alerts';
import './pages/stock_info_panel';
import './pages/order_panel';
import './pages/holdings_panel';
import './pages/heatmap';
import './pages/watch';
import './pages/market_board';
import './pages/chain_engine';
import './pages/industry_chain';
import './pages/multi_chart';
import './pages/savings_plan';
import './pages/savings_portfolio';
import './pages/candle_guide';
import './pages/strategy_guide';
import './pages/settings_monitor';
import './pages/settings_keys';
import './pages/settings_ai';
import './pages/settings_background';
import './pages/settings';
import './pages/tour';
import './pages/guide';
import './boot_loader';
import './desktop_bridge';
import './export_report';
import './app';

import { askClose, setDesktopHidden } from './desktop_bridge';
import { flushUserData } from './sync_store';

// 桌面版（desktop.py）用 evaluate_js 從 Python 呼叫這三個函式：關視窗前存檔、詢問要縮到系統匣還是結束、通知頁面縮到系統匣。
// 這是 Python 與頁面之間的介面，名稱不能改（tests/test_packaging.py 會檢查 desktop.py 用到的名稱都在這裡）；其餘模組之間都用 import。
window.TA = { flushUserData, askClose, setDesktopHidden };
