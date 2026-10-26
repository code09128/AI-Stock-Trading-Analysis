// 看盤頁右下角：模擬下單（流程：成交模擬交易 → 規則確認下單 → 交易檢討）
(() => {
  const { fmt, Field, Seg, normSym } = window.TA;
  const { useState } = React;

  function OrderPanel({ ctx }) {
    const { rules, journal } = window.TA.usePortfolio();
    const [checked, setChecked] = useState({});
    const [lastFill, setLastFill] = useState(null);
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
      tradeRules,
      tw,
    } = ctx;

    const hardIssues = (orderIssues || []).filter((x) => !x.startsWith('提醒'));

    // 直接確認規則並模擬成交（不必先放暫存匣再點一次成交）
    const directFill = () => {
      if (!allChecked) {
        window.TA.toast?.('⚠️ 請先勾選「規則確認下單」的所有交易規則');
        return;
      }
      if (hardIssues.length) {
        window.TA.toast?.(`⚠️ 無法下單成交：${hardIssues[0]}`);
        return;
      }
      const sym = normSym(q?.symbol || '');
      const priceNum = Number(order.price);
      const qtyNum = Number(order.qty);
      const sh = tw ? (order.lotType === 'ROUND' ? qtyNum * 1000 : qtyNum) : qtyNum;
      const r = window.TA.fillOrder({
        symbol: sym,
        side: order.side,
        price: priceNum,
        shares: sh,
        fees: (fee || 0) + (tax || 0),
      });
      if (r.ok) {
        setChecked({});
        setLastFill({ side: order.side, symbol: sym, shares: sh, price: priceNum, msg: r.msg });
        window.TA.notifySaved(r.msg);
      } else {
        window.TA.toast?.(`⚠️ ${r.msg}`);
      }
    };

    const handleCartFill = (c) => {
      if (!allChecked) {
        window.TA.toast?.('⚠️ 請先勾選上方「規則確認下單」的所有交易規則再成交');
        return;
      }
      fillCartItem(c);
      setChecked({});
      setLastFill({
        side: c.side,
        symbol: normSym(c.symbol),
        shares: c.market === 'TW' && c.unit === '張' ? c.qty * 1000 : c.qty,
        price: c.price,
        msg: `已執行 ${c.symbol} ${c.side === 'BUY' ? '買進' : '賣出'}模擬成交`,
      });
    };

    return (
      <div
        className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 space-y-3"
        data-tour="watch-order"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-bold text-white">
            模擬交易下單（{tw ? '台股' : window.TA.marketName(q?.symbol || '')}）
          </h3>
          <span className="text-[11px] px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
            僅模擬・不會連接券商・成交後同步到持股與交易紀錄
          </span>
        </div>

        {/* 介面流程指示：成交模擬交易 → 規則確認下單 → 交易檢討 */}
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] bg-slate-950/80 border border-slate-800 rounded-xl px-3 py-2">
          <span className="px-2 py-0.5 rounded bg-sky-500/20 text-sky-200 font-semibold">
            ① 成交模擬交易（填寫委託）
          </span>
          <span className="text-slate-500">→</span>
          <span
            className={`px-2 py-0.5 rounded font-semibold ${
              allChecked ? 'bg-emerald-500/20 text-emerald-200' : 'bg-amber-500/20 text-amber-200'
            }`}
          >
            ② 規則確認下單
            {ruleList.length ? (allChecked ? '（已確認 ✓）' : '（待勾選）') : '（可下單）'}
          </span>
          <span className="text-slate-500">→</span>
          <button
            type="button"
            onClick={() => window.TA.goTab?.('mod5')}
            className="px-2.5 py-0.5 rounded bg-violet-600/30 hover:bg-violet-600/50 text-violet-200 border border-violet-500/40 font-semibold cursor-pointer"
          >
            ③ 交易檢討（{journal.length} 筆）→
          </button>
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
          {tw && <span className="text-slate-500">（手續費以 0.1425% 無折扣估算）</span>}
          {tradeRules && (
            <span>
              法定稅費約 {fmt(tax, 2)}
              {tradeRules.lot > 1 && `・每手 ${tradeRules.lot} 股（${tradeRules.lot_source}）`}
            </span>
          )}
          {tradeRules && (
            <span className="text-slate-500">
              （未含券商佣金{tradeRules.note ? `；${tradeRules.note}` : ''}）
            </span>
          )}
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

        {/* 第二步：規則確認下單 */}
        {ruleList.length > 0 ? (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2.5 space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] text-emerald-300 font-semibold">
                ② 規則確認下單（勾選個人交易規則後即可成交或加入暫存匣）
              </span>
              <span className="flex items-center gap-2 text-[11px]">
                <button
                  type="button"
                  onClick={() => {
                    const next = {};
                    for (const r of ruleList) next[r.rule_number] = !allChecked;
                    setChecked(next);
                  }}
                  className="text-emerald-300 hover:underline cursor-pointer"
                >
                  {allChecked ? '取消全選' : '一鍵全部確認 ✓'}
                </button>
              </span>
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
        ) : (
          <div className="rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2 text-[11px] text-slate-400 flex flex-wrap items-center justify-between gap-2">
            <span>
              ②
              規則確認下單：目前尚無個人交易規則，可直接確認下單成交（完成賣出平倉後，可至「交易檢討」產生個人規則）。
            </span>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={directFill}
            disabled={!allChecked}
            title={allChecked ? '確認規則並立即執行模擬成交' : '請先勾選上方所有交易規則'}
            className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-sm cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ⚡ 規則確認並直接成交（
            {order.side === 'BUY' ? '買進加入持股' : '賣出平倉寫入檢討'}）
          </button>
          <button
            type="button"
            onClick={() => {
              addToCart();
            }}
            disabled={!allChecked}
            title={allChecked ? '先放入下方暫存匣，稍後再按成交' : '請先勾選上方所有交易規則'}
            className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-semibold text-sm cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ＋ 加入暫存匣
          </button>
          <button
            type="button"
            onClick={() => window.TA.goTab?.('mod5')}
            className="ml-auto px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold cursor-pointer"
          >
            前往交易檢討（{journal.length} 筆）→
          </button>
        </div>

        {/* 第三步：成交後引導至交易檢討 */}
        {lastFill && (
          <div className="rounded-xl border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-xs text-sky-100 flex flex-wrap items-center justify-between gap-2">
            <span>
              ✅ {lastFill.msg}
              {lastFill.side === 'SELL'
                ? '（已平倉寫入交易紀錄，可前往交易檢討分析勝率與行為偏誤）'
                : '（已加入我的持股；交易檢討的「持有中部位」會顯示帳面損益）'}
            </span>
            <button
              type="button"
              onClick={() => window.TA.goTab?.('mod5')}
              className="px-3 py-1 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-semibold cursor-pointer"
            >
              ③ 前往交易檢討（{journal.length} 筆）→
            </button>
          </div>
        )}

        {cart.length > 0 && (
          <div className="space-y-1.5 pt-1">
            <div className="flex justify-between text-xs text-slate-400">
              <span>暫存匣 {cart.length} 筆</span>
              <button
                type="button"
                onClick={() => {
                  const n = cart.length;
                  setCart([]);
                  window.TA.notifySaved(`已清空暫存匣（${n} 筆）`);
                }}
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
                    onClick={() => handleCartFill(c)}
                    disabled={!allChecked}
                    title={
                      allChecked
                        ? '模擬成交：買進加入我的持股；賣出寫入交易紀錄（交易檢討會用到）'
                        : '請先勾選上方所有交易規則'
                    }
                    className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-200 hover:bg-amber-500/40 font-sans cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    成交
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCart(cart.filter((x) => x.id !== c.id));
                      window.TA.notifySaved(
                        `已從暫存匣移除 ${c.symbol} ${c.side === 'BUY' ? '買進' : '賣出'}委託`,
                      );
                    }}
                    aria-label={`移除 ${c.symbol} 委託`}
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
