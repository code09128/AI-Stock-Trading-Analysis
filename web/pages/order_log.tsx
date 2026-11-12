// 下單紀錄頁：每筆模擬成交（買進與賣出）。買進原本只合併進「我的持股」的平均成本，這頁另外逐筆列出。
// 資料：tw_us_orders_v1（portfolio_store 的 fillOrder、我的持股新增／匯入時寫入）；
// 這版以前的模擬賣出從交易紀錄（source＝模擬下單成交）補顯示，沒有任何買進紀錄的持股顯示成「期初持股」。
import { bus } from '../bus';
import { setOrders, usePortfolio } from '../portfolio_store';
import { notifySaved } from '../sync_store';
import { baseCode, colorOf, currencyOf, fmt, normSym, signed } from '../ui';
import { PCard, PageHead } from './card_box';
import { TradeFlow } from './trade_flow';
import { openInWatch } from './watch';

const { useState, useMemo } = React;

const key = (s) => baseCode(normSym(String(s || '')));

function OrderLogPage() {
  const { orders, journal, holdings } = usePortfolio();
  const [side, setSide] = useState('ALL');
  const [q, setQ] = useState('');

  // 舊紀錄：交易紀錄裡由模擬下單寫入、但下單紀錄沒有對應那筆的賣出（下單紀錄是這版才開始記）
  const rows = useMemo(() => {
    const logged = new Set(orders.map((o) => o.trade_id).filter(Boolean));
    const legacy = journal
      .filter((e) => e.source === '模擬下單成交' && !logged.has(e.trade_id))
      .map((e) => ({
        id: `legacy_${e.trade_id}`,
        legacy: true,
        time: String(e.exit_time || ''),
        symbol: e.symbol,
        name: '',
        side: 'SELL',
        price: Number(e.exit_price),
        shares: Number(e.shares),
        fees: Number(e.fees) || 0,
        trade_id: e.trade_id,
        net_pnl: Number(e.net_pnl),
        return_pct: Number(e.return_pct),
      }));
    // 期初持股：目前持有、但下單紀錄沒有任何一筆買進的股票（這版以前加入、之後都沒動過的持股），用目前股數與成本顯示。
    // 第一次對這檔成交或新增時，portfolio_store 的 withInitial 會把它存成一筆 source＝期初持股 的紀錄，之後就不靠這裡
    const bought = new Set(orders.filter((o) => o.side === 'BUY').map((o) => key(o.symbol)));
    const initial = holdings
      .filter((h) => !bought.has(key(h.symbol)))
      .map((h, i) => ({
        id: `init_${h.id || i}`,
        legacy: true,
        initial: true,
        time: String(h.opened || ''),
        symbol: h.symbol,
        name: '',
        side: 'BUY',
        price: Number(h.cost),
        shares: Number(h.shares),
        fees: 0,
        order_type: h.broker ? `券商 ${h.broker}` : '',
      }));
    return [...orders, ...legacy, ...initial].sort((a, b) => String(b.time).localeCompare(String(a.time)));
  }, [orders, journal, holdings]);

  const tradeIds = new Set(journal.map((e) => e.trade_id));
  const heldShares = (sym) =>
    holdings.filter((h) => key(h.symbol) === key(sym)).reduce((s, h) => s + (Number(h.shares) || 0), 0);

  const kw = q.trim().toUpperCase();
  const shown = rows.filter(
    (r) =>
      (side === 'ALL' || r.side === side) &&
      (!kw || String(r.symbol).toUpperCase().includes(kw) || String(r.name || '').toUpperCase().includes(kw)),
  );

  // 金額依幣別分開加總（台股、美股不能直接相加）
  const totals = useMemo(() => {
    const m = new Map();
    for (const r of shown) {
      const c = currencyOf(normSym(String(r.symbol)));
      const t = m.get(c) || { buy: 0, sell: 0, fees: 0, pnl: 0, nb: 0, ns: 0 };
      const amt = (Number(r.price) || 0) * (Number(r.shares) || 0);
      if (r.side === 'BUY') {
        t.buy += amt;
        t.nb += 1;
      } else {
        t.sell += amt;
        t.ns += 1;
        t.pnl += Number(r.net_pnl) || 0;
      }
      t.fees += Number(r.fees) || 0;
      m.set(c, t);
    }
    return [...m.entries()];
  }, [shown]);

  const remove = (r) => {
    if (
      !window.confirm(
        `確定刪除這筆下單紀錄（${r.time} ${r.symbol} ${r.side === 'BUY' ? '買進' : '賣出'}）？\n只會刪掉這頁的紀錄，我的持股與交易紀錄不會變動。刪除後沒辦法復原。`,
      )
    ) {
      bus.toast?.('ℹ️ 已取消，下單紀錄沒有變動');
      return;
    }
    setOrders(orders.filter((o) => o.id !== r.id));
    notifySaved(`已刪除下單紀錄（${r.symbol}）`);
  };

  const btn = 'px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer';

  return (
    <div className="space-y-3.5" data-tour="orders-root">
      <PageHead
        title="下單紀錄"
        desc="每一筆模擬成交與持股建立的明細：買進加進了哪些持股、賣出平倉賺賠多少，並連到個股、我的持股與交易檢討。"
        right={
          <button
            type="button"
            onClick={() => {
              const detail = { rightTab: 'quote', card: 'order' };
              bus._pendingWatch = detail;
              bus.goTab?.('watch');
              window.dispatchEvent(new CustomEvent('watch-action', { detail }));
            }}
            className="text-xs px-3 py-1.5 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-slate-100 font-semibold cursor-pointer"
          >
            去模擬下單 →
          </button>
        }
      />
      <TradeFlow current="orders" />

      <PCard
        title="成交統計"
        sub={side === 'ALL' && !kw ? '全部紀錄' : '依目前篩選'}
      >
        <div className="px-4 pb-4 grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))] text-xs">
          {!totals.length && <div className="text-slate-400">還沒有成交紀錄。</div>}
          {totals.map(([c, t]) => (
            <div key={c} className="bg-slate-950/70 border border-slate-800 rounded-xl px-3 py-2 space-y-1">
              <div className="font-semibold text-slate-200">{c}</div>
              <div className="text-slate-400">
                買進 {t.nb} 筆・<span className="font-mono text-slate-200">{fmt(t.buy, 0)}</span>
              </div>
              <div className="text-slate-400">
                賣出 {t.ns} 筆・<span className="font-mono text-slate-200">{fmt(t.sell, 0)}</span>
              </div>
              <div className="text-slate-400">
                已實現損益 <span className={`font-mono ${colorOf(t.pnl)}`}>{signed(t.pnl, 0)}</span>
                ・手續費＋稅 <span className="font-mono text-slate-200">{fmt(t.fees, 0)}</span>
              </div>
            </div>
          ))}
        </div>
      </PCard>

      <PCard title="逐筆成交" sub={`${shown.length} 筆`}>
        <div className="px-4 pb-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {[
              ['ALL', '全部'],
              ['BUY', '買進'],
              ['SELL', '賣出'],
            ].map(([k, label]) => (
              <button
                key={k}
                type="button"
                aria-pressed={side === k}
                onClick={() => setSide(k)}
                className={`px-2.5 py-1 rounded-lg border cursor-pointer ${
                  side === k ? 'border-sky-500 bg-sky-500/20 text-sky-100' : 'border-white/10 bg-white/5 text-slate-300'
                }`}
              >
                {label}
              </button>
            ))}
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="代號或名稱"
              aria-label="用代號或名稱篩選"
              className="ml-auto bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-100 w-36"
            />
          </div>

          {!rows.length ? (
            <div className="py-10 text-center text-xs text-slate-400 space-y-2">
              <div>還沒有紀錄。到個股頁的「模擬下單」卡填好委託、勾選規則後按成交，或在「我的持股」新增持股、按「加碼」「賣出」，這裡就會出現紀錄。</div>
              <div className="text-slate-500">更早就在我的持股裡的部位會顯示成「期初持股」，更早的模擬賣出會從交易紀錄補上。</div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs whitespace-nowrap">
                <thead>
                  <tr className="text-slate-400 text-left border-b border-slate-700">
                    <th className="py-2 pr-2">時間</th>
                    <th className="pr-2">股票</th>
                    <th className="pr-2">買賣</th>
                    <th className="pr-2 text-right">成交價</th>
                    <th className="pr-2 text-right">股數</th>
                    <th className="pr-2 text-right">金額</th>
                    <th className="pr-2 text-right">手續費＋稅</th>
                    <th className="pr-2">結果</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody className="text-slate-300">
                  {shown.map((r) => {
                    const amt = (Number(r.price) || 0) * (Number(r.shares) || 0);
                    const held = heldShares(r.symbol);
                    return (
                      <tr key={r.id} className="border-b border-slate-800/70 align-top">
                        <td className="py-1.5 pr-2 font-mono whitespace-nowrap">
                          {r.time}
                          {r.initial || r.source === '期初持股' ? (
                            <span className="ml-1 text-[10px] text-slate-500" title={r.initial ? '下單紀錄出現以前就在我的持股裡、還沒有任何紀錄：用目前股數與成本顯示' : '第一次加碼、賣出或新增這檔之前，原本持有的股數與成本'}>
                              期初持股
                            </span>
                          ) : r.legacy ? (
                            <span className="ml-1 text-[10px] text-slate-500" title="這版以前的模擬賣出，從交易紀錄補上，只有日期">
                              舊紀錄
                            </span>
                          ) : (
                            r.source && (
                              <span className="ml-1 text-[10px] text-amber-300/80" title="在我的持股新增或匯入的部位，不是模擬成交，沒有手續費">
                                {r.source}
                              </span>
                            )
                          )}
                        </td>
                        <td className="pr-2">
                          <span className="font-mono text-slate-100">{r.symbol}</span>
                          {r.name && <span className="ml-1 text-slate-400">{r.name}</span>}
                          {r.order_type && <div className="text-[10px] text-slate-500">{r.order_type}</div>}
                        </td>
                        <td className="pr-2">
                          <span className={r.side === 'BUY' ? 'ta-up-chip px-1.5 rounded' : 'ta-down-chip px-1.5 rounded'}>
                            {r.side === 'BUY' ? '買進' : '賣出'}
                          </span>
                        </td>
                        <td className="pr-2 text-right font-mono">{fmt(r.price, 2)}</td>
                        <td className="pr-2 text-right font-mono">{fmt(r.shares, Number.isInteger(Number(r.shares)) ? 0 : 4)}</td>
                        <td className="pr-2 text-right font-mono">{fmt(amt, 0)}</td>
                        <td className="pr-2 text-right font-mono">{fmt(r.fees, 0)}</td>
                        <td className="pr-2">
                          {r.side === 'BUY' ? (
                            <span className="text-slate-400">
                              {r.source || r.initial ? '建立持股' : '加入持股'}
                              <span className="text-slate-500">（目前 {fmt(held, Number.isInteger(held) ? 0 : 4)} 股）</span>
                            </span>
                          ) : (
                            <span>
                              <span className={`font-mono ${colorOf(r.net_pnl)}`}>
                                {signed(r.net_pnl, 0)}（{signed(r.return_pct, 2, '%')}）
                              </span>
                              <span className="ml-1 text-slate-500">
                                {tradeIds.has(r.trade_id) ? `交易紀錄 ${r.trade_id}` : `交易紀錄 ${r.trade_id} 已刪除`}
                              </span>
                            </span>
                          )}
                        </td>
                        <td className="whitespace-nowrap space-x-1">
                          <button type="button" className={btn} onClick={() => openInWatch(r.symbol)}>
                            看行情
                          </button>
                          {r.side === 'BUY' && held > 0 && (
                            <button
                              type="button"
                              className={btn}
                              onClick={() => {
                                bus._pendingWatch = { listTab: 'hold', rightTab: 'quote', select: normSym(String(r.symbol)) };
                                bus.goTab?.('watch');
                                window.dispatchEvent(new CustomEvent('watch-action', { detail: bus._pendingWatch }));
                              }}
                            >
                              我的持股
                            </button>
                          )}
                          {r.side === 'SELL' && tradeIds.has(r.trade_id) && (
                            <button type="button" className={btn} onClick={() => bus.goTab?.('mod5')}>
                              交易檢討
                            </button>
                          )}
                          {!r.legacy && (
                            <button
                              type="button"
                              className="px-2 py-0.5 text-rose-400 hover:text-rose-300 cursor-pointer"
                              onClick={() => remove(r)}
                            >
                              刪除
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-[11px] text-slate-500 leading-relaxed">
            刪除這頁的紀錄不會改動我的持股與交易紀錄；要修改或刪除已平倉交易請到「交易檢討」。
            「手動新增」「CSV 匯入」是在我的持股建立的部位（用成本價、不計手續費）；「期初持股」是更早就在持股裡、沒有逐筆紀錄的部位（第一次加碼、賣出或新增那檔時，會用當時的股數與成本存成一筆）；
            「舊紀錄」是這版以前的模擬賣出，從交易紀錄補上，只有日期。還沒存成紀錄的期初持股與舊紀錄不能在這裡刪除。紀錄只存在你這台電腦（data/userdata.json）。
          </p>
        </div>
      </PCard>
    </div>
  );
}

export { OrderLogPage };
