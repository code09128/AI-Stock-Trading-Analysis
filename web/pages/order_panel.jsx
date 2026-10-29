// 看盤頁右下角：模擬下單（流程：成交模擬交易 → 規則確認下單 → 交易檢討）
(() => {
  const { fmt, Field, Seg, normSym, twTick, localDate } = window.TA;
  const { useState, useEffect } = React;

  const TW_PRICE_TYPES = [
    ['LIMIT', '限價'],
    ['UP', '漲停'],
    ['DOWN', '跌停'],
    ['FLAT', '平盤'],
    ['MKT', '市價'],
  ];
  const US_KINDS = [
    ['NORMAL', '一般委託'],
    ['STOP', '觸價單'],
    ['MOO', '限定開盤'],
    ['MOC', '限定收盤'],
  ];
  const labelOf = (list, v) => (list.find((x) => x[0] === v) || [])[1] || v;

  // 暫存匣顯示的委託條件，例如「限價/ROD」「盤後定價/ROD」「觸價@150 限價/ANY 長效至 2027-01-29」
  const orderLabel = (o, tw) => {
    if (tw) {
      if (o.session === 'AFTER') return `${o.lotType === 'ROUND' ? '盤後定價' : '盤後零股'}/${o.tif}`;
      return `${labelOf(TW_PRICE_TYPES, o.priceType || 'LIMIT')}/${o.tif}`;
    }
    const kind =
      o.usKind === 'STOP'
        ? `觸價@${o.stopPrice} `
        : o.usKind && o.usKind !== 'NORMAL'
          ? `${labelOf(US_KINDS, o.usKind)} `
          : '';
    const gtc = o.gtc ? ` 長效至 ${o.gtcDate}` : '';
    return `${kind}${o.usType === 'MARKET' ? '市價' : '限價'}/${o.usTif}${gtc}${o.settle === 'TWD' ? ' 台幣交割' : ''}`;
  };

  // 手續費折數（與策略回測共用）：打字時只改輸入框，是 0～1 的有效數字才存；離開欄位時還原成目前的值
  function FeeDiscountInput({ value }) {
    const [text, setText] = useState(String(value));
    useEffect(() => setText(String(value)), [value]);
    return (
      <label className="flex items-center gap-1 text-slate-400 font-sans">
        手續費 0.1425% ×
        <input
          type="number"
          step="0.05"
          min="0.1"
          max="1"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            window.TA.setFeeDiscount(e.target.value);
          }}
          onBlur={() => setText(String(value))}
          aria-label="手續費折數"
          className="w-14 bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 mono text-white"
        />
        （{fmt(value * 10, 1)} 折，跟策略回測共用；依你的券商條件填）
      </label>
    );
  }

  const stepCls =
    'px-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed';

  // 數字輸入兩側加 −／＋（價格依跳動檔位、數量每次 1）
  function Stepper({ value, onChange, onStep, disabled, label }) {
    return (
      <div className="flex">
        <button
          type="button"
          onClick={() => onStep(-1)}
          disabled={disabled}
          aria-label={`${label}減少`}
          className={`${stepCls} rounded-l-lg`}
        >
          −
        </button>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          inputMode="decimal"
          aria-label={label}
          className="w-full min-w-0 bg-slate-950 border-y border-slate-700 px-2 py-1.5 mono text-white text-center disabled:text-amber-200"
        />
        <button
          type="button"
          onClick={() => onStep(1)}
          disabled={disabled}
          aria-label={`${label}增加`}
          className={`${stepCls} rounded-r-lg`}
        >
          ＋
        </button>
      </div>
    );
  }

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
      priceNum,
      priceLocked,
      etfFlag,
      afterRound,
      feeDisc,
    } = ctx;
    const set = (patch) => setOrder({ ...order, ...patch });

    // 美股選台幣交割時，預估金額另外換算成台幣
    const cur = q?.currency;
    const [fxRate, setFxRate] = useState(null);
    useEffect(() => {
      setFxRate(null);
      if (tw || !cur || cur === 'TWD' || order.settle !== 'TWD') return undefined;
      let stop = false;
      fetch('/api/fx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currencies: [cur] }),
      })
        .then((r) => r.json())
        .then((d) => {
          if (!stop) setFxRate(d.rates?.[cur]?.rate || null);
        })
        .catch(() => {});
      return () => {
        stop = true;
      };
    }, [tw, cur, order.settle]);

    // −／＋：價格依台股跳動檔位（美股 0.01），按了就切回限價。
    // 往下跨過檔位邊界要用下一檔的跳動單位（1000 往下是 999，不是 995）
    const stepPrice = (dir) => {
      const base = priceNum > 0 ? priceNum : Number(q?.price) || 0;
      const tick = tw ? twTick(dir < 0 ? base - 1e-9 : base, etfFlag) : 0.01;
      const next = Math.max(tick, Math.round((base + dir * tick) / tick) * tick);
      set({ priceType: 'LIMIT', price: String(Number(next.toFixed(4))) });
    };
    // 數量每次 ±1，保留小數（持股帶入的美股碎股、銀行零頭）；減到 0 以下就不動
    const stepQty = (dir) => {
      const next = Math.round(((Number(order.qty) || 0) + dir) * 1e4) / 1e4;
      if (next > 0) set({ qty: next });
    };

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
              onChange={(v) =>
                // 市價只能用在賣出：改成買進時換回委託價格
                set({ side: v, ...(v === 'BUY' && order.usType === 'MARKET' ? { usType: 'LIMIT' } : {}) })
              }
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
                label="盤別"
                tip="盤中 09:00～13:30。盤後：整張是「盤後定價交易」14:00～14:30，一律以收盤價成交；零股是「盤後零股」13:40～14:30，14:30 一次撮合。盤後只接受限價 ROD。"
              >
                <Seg
                  value={order.session}
                  onChange={(v) =>
                    set({ session: v, ...(v === 'AFTER' ? { tif: 'ROD', priceType: 'LIMIT' } : {}) })
                  }
                  options={[
                    ['REGULAR', '盤中'],
                    ['AFTER', '盤後'],
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
              <Field
                label="委託種類"
                tip="一般委託：送出就掛單。觸價單：價格碰到觸發價才送出。限定開盤／限定收盤：只參加開盤或收盤競價。模擬下單都是立即成交，種類只記在委託條件裡。"
              >
                <select
                  value={order.usKind}
                  onChange={(e) => set({ usKind: e.target.value })}
                  aria-label="委託種類"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white"
                >
                  {US_KINDS.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label="價格方式"
                tip="委託價格：指定價格（限價）。市價：只能用在賣出，以當時最佳價成交（價格不保證）。"
              >
                <Seg
                  value={order.usType}
                  onChange={(v) => {
                    if (v === 'MARKET' && order.side === 'BUY') {
                      window.TA.toast?.('⚠️ 市價只能用在賣出');
                      return;
                    }
                    set({ usType: v });
                  }}
                  options={[
                    ['LIMIT', '委託價格'],
                    ['MARKET', '市價賣出'],
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
          <Field
            label={`價格（${q.currency}）${afterRound ? '・盤後定價＝收盤價' : ''}`}
            tip={tw ? '−／＋ 依台股跳動檔位調整，按了會切回「限價」' : undefined}
          >
            <Stepper
              label="委託價格"
              value={priceLocked ? (priceNum ? String(priceNum) : '--') : order.price}
              onChange={(v) => set({ price: v, priceType: 'LIMIT' })}
              onStep={stepPrice}
              disabled={afterRound}
            />
          </Field>
          <Field label={`數量（${tw ? (order.lotType === 'ROUND' ? '張' : '股') : '股'}）`}>
            <Stepper
              label="委託數量"
              value={order.qty}
              onChange={(v) => set({ qty: v })}
              onStep={stepQty}
            />
          </Field>
        </div>

        {tw && !afterRound && (
          <Field
            label="價格類型"
            tip="漲停／跌停／平盤（昨收）跟著報價自動帶入；市價：買進用最佳賣價、賣出用最佳買價模擬成交。"
          >
            <Seg
              value={order.priceType}
              onChange={(v) =>
                order.session === 'AFTER' && v !== 'LIMIT'
                  ? window.TA.toast?.('⚠️ 盤後零股只接受限價委託')
                  : set({ priceType: v, ...(v === 'LIMIT' && priceNum ? { price: String(priceNum) } : {}) })
              }
              options={TW_PRICE_TYPES}
            />
          </Field>
        )}

        {!tw && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
            {order.usKind === 'STOP' && (
              <Field
                label={`觸發價（${q.currency}）`}
                tip="買進：價格漲到觸發價才送出；賣出：跌到觸發價才送出（停損常用）"
              >
                <input
                  value={order.stopPrice}
                  onChange={(e) => set({ stopPrice: e.target.value })}
                  inputMode="decimal"
                  aria-label="觸發價"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 mono text-white"
                />
              </Field>
            )}
            <Field label="長效單" tip="勾選後委託到指定日期前都有效（一般委託只到當天收盤）">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={!!order.gtc}
                  onChange={(e) => {
                    const d = new Date();
                    d.setMonth(d.getMonth() + 3);
                    set({ gtc: e.target.checked, gtcDate: order.gtcDate || localDate(d) });
                  }}
                  aria-label="長效單"
                />
                <input
                  type="date"
                  value={order.gtcDate}
                  disabled={!order.gtc}
                  onChange={(e) => set({ gtcDate: e.target.value })}
                  aria-label="長效單到期日"
                  className="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs mono text-white disabled:opacity-40"
                />
              </div>
            </Field>
            <Field
              label="交割幣別"
              tip="外幣交割：從外幣帳戶扣款。台幣交割：券商用當天匯率換成台幣扣款（匯率以券商為準，這裡是估算）"
            >
              <Seg
                value={order.settle}
                onChange={(v) => set({ settle: v })}
                options={[
                  ['FX', `以外幣（${q.currency}）`],
                  ['TWD', '以台幣'],
                ]}
              />
            </Field>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 text-xs mono bg-slate-950/60 border border-slate-800 rounded-lg px-3 py-2">
          <span>
            預估金額 {tw ? '' : `${q.currency} `}
            {fmt(Math.max(amount, 0), tw ? 0 : 2)}
          </span>
          {!tw && order.settle === 'TWD' && (
            <span className="text-amber-200">
              {/* 買進要付成交金額＋稅費；賣出入帳是成交金額－稅費（SEC 規費、TAF 從賣出款扣） */}
              ≈ 台幣{' '}
              {fxRate
                ? fmt((Math.max(amount, 0) + (order.side === 'SELL' ? -1 : 1) * (tax || 0)) * fxRate, 0)
                : '（匯率取得中…）'}
              {fxRate
                ? `（匯率約 ${fmt(fxRate, 3)}，${order.side === 'SELL' ? '已扣' : '含'}法定稅費）`
                : ''}
            </span>
          )}
          {tw && <span>手續費約 {fmt(fee, 0)}</span>}
          {tw && order.side === 'SELL' && <span>證交稅約 {fmt(tax, 0)}</span>}
          {tw && <FeeDiscountInput value={feeDisc} />}
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

  window.TA = Object.assign(window.TA || {}, { OrderPanel, orderLabel });
})();
