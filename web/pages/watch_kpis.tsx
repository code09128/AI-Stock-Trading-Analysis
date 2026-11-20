// 看盤頁右側最上面的問候列＋指標卡（一行，不另外佔一大塊），以及持股頁摘要卡共用的持股計算。
// 只用看盤頁已經抓好的報價與匯率，不另外打 API。
import { baseCode, colorOf, currencyOf, fmt, marketSessionOpen, signed } from '../ui';

// 持股合計（台幣）：沒有報價或匯率的那檔不計入（missing 記數），避免算出 0 元。
// 今日損益＝(現價−昨收)×股數；休市時是最近一個交易日的漲跌。盤前沒有成交價時用昨收，今日損益算 0。
export function holdStats(holdings: any[], quotes: any, fx: any) {
  let value = 0;
  let cost = 0;
  let today = 0;
  let missing = 0;
  for (const h of holdings) {
    const q = quotes[baseCode(h.symbol)];
    const price = q?.price ?? q?.prev_close;
    const cur = q?.currency || currencyOf(h.symbol);
    const m = cur === 'TWD' ? 1 : fx?.[cur];
    if (price == null || m == null) {
      missing++;
      continue;
    }
    value += price * h.shares * m;
    cost += h.cost * h.shares * m;
    if (q?.price != null && q?.prev_close != null) today += (q.price - q.prev_close) * h.shares * m;
  }
  const base = value - today;
  return {
    n: holdings.length,
    value,
    cost,
    pnl: value - cost,
    pct: cost ? ((value - cost) / cost) * 100 : 0,
    today,
    todayPct: base ? (today / base) * 100 : 0,
    missing,
  };
}

function Kpi({ label, value, sub, tone = '', hero = false, onClick, title }: { label: string; value: any; sub?: any; tone?: string; hero?: boolean; onClick?: () => void; title?: string }) {
  const body = (
    <>
      <span className={`block text-[11px] ${hero ? 'text-white/80' : 'text-slate-400'}`}>{label}</span>
      <b className={`block mono text-[15px] leading-tight ${hero ? 'text-white' : tone || 'text-white'}`}>{value}</b>
      {sub != null && <span className={`block mono text-[10.5px] ${hero ? 'text-white/75' : tone || 'text-slate-500'}`}>{sub}</span>}
    </>
  );
  const cls = `min-w-[104px] text-left rounded-xl px-3 py-1.5 ${hero ? 'bg-gradient-to-br from-[#4f7cff] to-[#6d4fd8]' : 'ta-card'}`;
  return onClick ? (
    <button type="button" onClick={onClick} title={title} className={`${cls} cursor-pointer ${hero ? '' : 'ta-key'}`}>
      {body}
    </button>
  ) : (
    <div className={cls} title={title}>
      {body}
    </div>
  );
}

export function GreetingBar({ watch, quotes, holdings, fx, alerts, onOpenHold, onOpenAlerts }: { watch: string[]; quotes: any; holdings: any[]; fx: any; alerts: any[]; onOpenHold: () => void; onOpenAlerts: () => void }) {
  const h = new Date().getHours();
  const hi = h < 5 ? '夜深了' : h < 11 ? '早安' : h < 18 ? '午安' : '晚安';
  let ups = 0;
  let downs = 0;
  for (const s of watch) {
    const c = quotes[baseCode(s)]?.change_pct;
    if (c > 0) ups++;
    else if (c < 0) downs++;
  }
  const fired = alerts.filter((a) => !a.active && a.firedAt).length;
  const watching = alerts.filter((a) => a.active).length;
  const st = holdStats(holdings, quotes, fx);
  const sess = `台股${marketSessionOpen('2330.TW') ? '盤中' : '休市'}・美股${marketSessionOpen('AAPL') ? '盤中' : '休市'}`;
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5 px-1" data-tour="greet">
      <div className="min-w-0 mr-auto">
        <h1 className="text-lg font-semibold text-white leading-snug">
          {hi}，今天自選 <span className="text-rose-400">{ups} 漲</span> <span className="text-emerald-400">{downs} 跌</span>
        </h1>
        <p className="text-xs text-slate-400">
          {sess}
          {fired ? <span className="text-amber-300">・{fired} 則提醒已觸發</span> : watching ? `・${watching} 則提醒監控中` : ''}
        </p>
      </div>
      {/* 指標卡：窄螢幕可橫向捲動，不會換成好幾行把報價卡往下推 */}
      <div className="flex gap-2.5 overflow-x-auto max-w-full pb-0.5">
        {st.n > 0 && (
          <>
            <Kpi
              hero
              label="持股市值（台幣）"
              value={fmt(st.value, 0)}
              sub={st.missing ? `${st.missing} 檔缺報價或匯率` : `${st.n} 筆持股`}
              onClick={onOpenHold}
              title="看我的持股"
            />
            <Kpi label="今日損益" value={signed(st.today, 0)} sub={signed(st.todayPct, 2, '%')} tone={colorOf(st.today)} title="（現價−昨收）×股數；休市時是最近一個交易日" />
            <Kpi label="未實現損益" value={signed(st.pnl, 0)} sub={signed(st.pct, 2, '%')} tone={colorOf(st.pnl)} title="市值−成本（成本價×股數）" />
          </>
        )}
        <Kpi
          label="提醒"
          value={fired ? `${fired} 已觸發` : `${watching} 監控中`}
          tone={fired ? 'text-amber-300' : ''}
          onClick={onOpenAlerts}
          title="打開提醒清單"
        />
      </div>
    </div>
  );
}
