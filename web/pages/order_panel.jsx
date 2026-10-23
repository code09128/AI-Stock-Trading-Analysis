// 看盤頁右下角：模擬下單暫存匣（台股整張/零股 + ROD/IOC/FOK；美股限價/市價 + ANY/AON）
(() => {
  const { fmt, Field, Seg } = window.TA;

  const { useState } = React;

  function OrderPanel({ ctx }) {
    const { rules } = window.TA.usePortfolio();
    const [checked, setChecked] = useState({});
    const ruleList = rules?.rules || [];
    const allChecked = ruleList.every((r) => checked[r.rule_number]);
    const {
      addToCart,
      amount,
      cart,
      fee,
      fillCartItem,
      order,
      orderIssues,
      q,
      setCart,
      setOrder,
      tax,
      tw,
    } = ctx;
    return (
      <div
        className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 space-y-3"
        data-tour="watch-order"
      >
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-white">
            模擬下單暫存匣（{tw ? '台股' : window.TA.marketName(q?.symbol || '')}）
          </h3>
          <span className="text-[11px] px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
            僅模擬・不會連接券商・成交後同步到持股與交易紀錄
          </span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
          <Field label="買賣">
            <Seg
              value={order.side}
              onChange={(v) => setOrder({ ...order, side: v })}
              options={[
                ['BUY', '買進', 'bg-rose-600'],
                ['SELL', '賣出', 'bg-emerald-600'],
              ]}
            />
          </Field>
          {tw ? (
            <>
              <Field label="交易單位" tip="整張＝1000 股；零股＝不足 1000 股的小額買賣">
                <Seg
                  value={order.lotType}
                  onChange={(v) => setOrder({ ...order, lotType: v, qty: 1 })}
                  options={[
                    ['ROUND', '整張'],
                    ['ODD', '零股'],
                  ]}
                />
              </Field>
              <Field
                label="委託條件"
                tip="ROD：當日有效，沒成交就一直掛著。IOC：立即成交否則取消未成交部分。FOK：要嘛全部立刻成交，要嘛整筆取消。"
              >
                <Seg
                  value={order.tif}
                  onChange={(v) => setOrder({ ...order, tif: v })}
                  options={[
                    ['ROD', 'ROD'],
                    ['IOC', 'IOC'],
                    ['FOK', 'FOK'],
                  ]}
                />
              </Field>
            </>
          ) : (
            <>
              <Field label="委託類型" tip="限價：指定價格；市價：以當時最佳價成交（價格不保證）">
                <Seg
                  value={order.usType}
                  onChange={(v) => setOrder({ ...order, usType: v })}
                  options={[
                    ['LIMIT', '限價'],
                    ['MARKET', '市價'],
                  ]}
                />
              </Field>
              <Field
                label="成交方式"
                tip="ANY：可部分成交。AON：必須全部成交，否則不成交（All Or None）"
              >
                <Seg
                  value={order.usTif}
                  onChange={(v) => setOrder({ ...order, usTif: v })}
                  options={[
                    ['ANY', 'ANY'],
                    ['AON', 'AON'],
                  ]}
                />
              </Field>
            </>
          )}
          <Field label={`價格（${q.currency}）`}>
            <input
              value={order.price}
              onChange={(e) => setOrder({ ...order, price: e.target.value })}
              inputMode="decimal"
              aria-label="委託價格"
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 mono text-white"
            />
          </Field>
          <Field label={`數量（${tw ? (order.lotType === 'ROUND' ? '張' : '股') : '股'}）`}>
            <input
              value={order.qty}
              onChange={(e) => setOrder({ ...order, qty: e.target.value })}
              inputMode="decimal"
              aria-label="委託數量"
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 mono text-white"
            />
          </Field>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs mono bg-slate-950/60 border border-slate-800 rounded-lg px-3 py-2">
          <span>預估金額 {fmt(Math.max(amount, 0), 0)}</span>
          {tw && <span>手續費約 {fmt(fee, 0)}</span>}
          {tw && order.side === 'SELL' && <span>證交稅約 {fmt(tax, 0)}</span>}
          <span className="text-slate-500">（手續費以 0.1425% 無折扣估算）</span>
        </div>

        {orderIssues.length > 0 && (
          <ul className="text-xs space-y-0.5">
            {orderIssues.map((m) => (
              <li key={m} className={m.startsWith('提醒') ? 'text-amber-300' : 'text-rose-300'}>
                {m.startsWith('提醒') ? 'ℹ️' : '⚠️'} {m}
              </li>
            ))}
          </ul>
        )}

        {ruleList.length > 0 && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2 space-y-1">
            <div className="text-[11px] text-emerald-300 font-semibold">
              下單前確認我的交易規則（來自交易檢討，全部勾選才能加入暫存匣）
            </div>
            {ruleList.map((r) => (
              <label
                key={r.rule_number}
                className="flex items-start gap-2 text-[11px] text-slate-200 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={!!checked[r.rule_number]}
                  onChange={(e) => setChecked({ ...checked, [r.rule_number]: e.target.checked })}
                  className="mt-0.5"
                />
                <span>
                  <b>{r.rule_name}</b>：當 {r.condition}，就 {r.action}
                </span>
              </label>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={() => {
            if (addToCart()) setChecked({}); // 沒加成功（例如價格不對）就保留已勾選的規則
          }}
          disabled={!allChecked}
          title={allChecked ? '' : '請先勾選上方所有交易規則'}
          className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-semibold text-sm cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          ＋ 加入暫存匣
        </button>

        {cart.length > 0 && (
          <div className="space-y-1.5 pt-1">
            <div className="flex justify-between text-xs text-slate-400">
              <span>暫存匣 {cart.length} 筆</span>
              <button
                type="button"
                onClick={() => setCart([])}
                className="hover:text-rose-300 cursor-pointer"
              >
                清空
              </button>
            </div>
            {cart.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between gap-2 text-xs bg-slate-950/70 border border-slate-800 rounded-lg px-3 py-1.5 mono"
              >
                <span className={c.side === 'BUY' ? 'text-rose-400' : 'text-emerald-400'}>
                  {c.side === 'BUY' ? '買' : '賣'}
                </span>
                <span className="text-white">
                  {c.symbol} {c.name}
                </span>
                <span className="text-slate-300">
                  {fmt(c.price)} × {c.qty}
                  {c.unit} [{c.type}]
                </span>
                <span className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => fillCartItem(c)}
                    title="模擬成交：買進加入我的持股；賣出寫入交易紀錄（交易檢討會用到）"
                    className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-200 hover:bg-amber-500/40 font-sans cursor-pointer"
                  >
                    成交
                  </button>
                  <button
                    type="button"
                    onClick={() => setCart(cart.filter((x) => x.id !== c.id))}
                    className="text-slate-500 hover:text-rose-300 cursor-pointer"
                  >
                    ✕
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  window.TA = Object.assign(window.TA || {}, { OrderPanel });
})();
