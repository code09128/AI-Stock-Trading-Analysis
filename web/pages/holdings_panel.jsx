(() => {
  // 我的持股：市值／成本／損益總覽（可切即時價或昨收、填帳戶現金／投資金額／已領配息以便和銀行對帳）、
  // 持股清單（分析、帶入賣出委託、移除）、新增與 CSV 匯入、送去組合風控
  const { useState, useEffect, useMemo } = React;
  const { readLS, writeLS, isTW, currencyOf, normSym, baseCode, fmt, colorOf, Tip } = window.TA;

  function HoldingsPanel({
    holdings,
    quotes,
    fx,
    fxWarn,
    holdCurrencies,
    sparks,
    selected,
    onSelect,
    onSell,
    say,
    onSendHoldings,
  }) {
    const { Row } = window.TA;
    const setHoldings = window.TA.setHoldings;
    const [holdForm, setHoldForm] = useState({ symbol: '', shares: '', cost: '' });
    const [csvText, setCsvText] = useState('');
    // 持股損益：市值可選「即時價」或「昨收」（銀行／券商的參考市值多用昨收，方便對帳）
    const [holdBasis, setHoldBasis] = useState(() => readLS('tw_us_hold_basis_v1', 'live'));
    const [divReceived, setDivReceived] = useState(() => readLS('tw_us_div_received_v1', ''));
    useEffect(() => writeLS('tw_us_hold_basis_v1', holdBasis), [holdBasis]);
    useEffect(() => writeLS('tw_us_div_received_v1', divReceived), [divReceived]);
    // 帳戶裡還沒買進的現金、實際投入金額：照銀行／券商「參考損益＝(持股市值＋現金) − 投資金額」的算法對帳
    const [acctCash, setAcctCash] = useState(() => readLS('tw_us_cash_v1', ''));
    const [invested, setInvested] = useState(() => readLS('tw_us_invested_v1', ''));
    useEffect(() => writeLS('tw_us_cash_v1', acctCash), [acctCash]);
    useEffect(() => writeLS('tw_us_invested_v1', invested), [invested]);
    const holdRows = useMemo(
      () =>
        holdings.map((h) => {
          const hq = quotes[baseCode(h.symbol)];
          const price = holdBasis === 'prev' ? (hq?.prev_close ?? hq?.price) : hq?.price;
          const currency = hq?.currency || currencyOf(h.symbol);
          // 每 1 單位計價幣別＝幾台幣；匯率還沒拿到時為 null（不計入台幣合計，避免算出 0 元）
          const mult = currency === 'TWD' ? 1 : (fx?.[currency] ?? null);
          const value = price != null ? price * h.shares : null;
          const cost = h.cost * h.shares;
          return {
            ...h,
            quote: hq,
            price,
            currency,
            value,
            pnl: value != null ? value - cost : null,
            pnlPct: value != null && cost ? ((value - cost) / cost) * 100 : null,
            valueTwd: value != null && mult != null ? value * mult : null,
            costTwd: mult != null ? cost * mult : null,
          };
        }),
      [holdings, quotes, fx, holdBasis],
    );
    const holdTotals = useMemo(() => {
      const ok = holdRows.filter((r) => r.valueTwd != null);
      const v = ok.reduce((a, r) => a + r.valueTwd, 0);
      const c = ok.reduce((a, r) => a + r.costTwd, 0);
      return {
        value: v,
        cost: c,
        pnl: v - c,
        pct: c ? ((v - c) / c) * 100 : 0,
        missing: holdRows.length - ok.length,
      };
    }, [holdRows]);
    const addHolding = () => {
      const sym = normSym(holdForm.symbol);
      const shares = Number(holdForm.shares);
      const cost = Number(holdForm.cost);
      if (!sym || !(shares > 0) || !(cost >= 0)) {
        say('請填代號、股數（正數）與成本價');
        return;
      }
      const old = holdings.find((h) => h.symbol === sym);
      setHoldings([
        ...holdings.filter((h) => h.symbol !== sym),
        { symbol: sym, shares, cost, opened: old?.opened || new Date().toISOString().slice(0, 10) },
      ]);
      setHoldForm({ symbol: '', shares: '', cost: '' });
    };
    const importCsv = () => {
      const rows = csvText
        .split(/\r?\n/)
        .map((l) => l.split(/[,\t]/).map((x) => x.trim()))
        .map(([a, b, c]) => ({ symbol: normSym(a || ''), shares: Number(b), cost: Number(c) }))
        .filter((r) => r.symbol && r.shares > 0 && r.cost >= 0);
      if (!rows.length) {
        say('沒有讀到有效列。格式：代號,股數,成本價（每行一檔）');
        return;
      }
      const map = new Map(holdings.map((h) => [h.symbol, h]));
      for (const r of rows)
        map.set(r.symbol, {
          ...r,
          opened: map.get(r.symbol)?.opened || new Date().toISOString().slice(0, 10),
        });
      setHoldings([...map.values()]);
      setCsvText('');
      say(`已匯入 ${rows.length} 檔持股`);
    };

    return (
      <div className="space-y-2">
        {holdRows.length > 0 && (
          <div className="rounded-xl border border-slate-700 bg-slate-950/70 p-3 text-xs mono space-y-0.5">
            <div className="flex justify-between">
              <span className="text-slate-400">總市值（台幣）</span>
              <span className="text-white font-bold">{fmt(holdTotals.value, 0)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">
                總成本
                <Tip text="各檔「成本價 × 股數」加總。銀行／券商的「投資金額」常是扣款金額加總、不含手續費，若你的成本價含手續費會略高。要完全一致可把成本價改成「投資金額 ÷ 股數」。" />
              </span>
              <span className="text-slate-200">{fmt(holdTotals.cost, 0)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">未實現損益</span>
              <span className={`font-bold ${colorOf(holdTotals.pnl)}`}>
                {holdTotals.pnl > 0 ? '+' : ''}
                {fmt(holdTotals.pnl, 0)}（{fmt(holdTotals.pct)}%）
              </span>
            </div>
            {[
              [
                '帳戶現金',
                acctCash,
                setAcctCash,
                '例如 3595',
                '帳戶裡還沒買成股票的現金（銀行「投資組合內容」最下面的「現金」）。會加進總資產。',
              ],
              [
                '投資金額',
                invested,
                setInvested,
                '例如 123500',
                '你實際投入（扣款）的總金額。填了就用銀行的算法：損益＝(持股市值＋帳戶現金) − 投資金額。',
              ],
              [
                '已領現金配息',
                divReceived,
                setDivReceived,
                '例如 10632',
                '已入帳的現金股利總額（台幣），用來算含息報酬率。',
              ],
            ].map(([label, val, setter, ph, tip]) => (
              <div key={label} className="flex justify-between items-center gap-2">
                <span className="text-slate-400 font-sans">
                  {label}
                  <Tip text={tip} />
                </span>
                <input
                  value={val}
                  onChange={(e) => setter(e.target.value.replace(/[^\d.]/g, ''))}
                  placeholder={ph}
                  aria-label={label}
                  className="w-28 bg-slate-900 border border-slate-700 rounded px-2 py-0.5 text-right text-white"
                />
              </div>
            ))}
            {(() => {
              const cash = Number(acctCash) || 0;
              const div = Number(divReceived) || 0;
              const base = Number(invested) > 0 ? Number(invested) : holdTotals.cost;
              const total = holdTotals.value + cash;
              const pnl = Number(invested) > 0 ? total - base : holdTotals.pnl;
              if (!base || (!cash && !div && !(Number(invested) > 0))) return null;
              const row = (label, v, tip) => (
                <div className="flex justify-between">
                  <span className="text-slate-400 font-sans">
                    {label}
                    <Tip text={tip} />
                  </span>
                  <span className={`font-bold ${colorOf(v)}`}>
                    {v > 0 ? '+' : ''}
                    {fmt(v, 0)}（{fmt((v / base) * 100)}%）
                  </span>
                </div>
              );
              return (
                <div className="pt-1 border-t border-slate-800 space-y-0.5">
                  {cash > 0 && (
                    <div className="flex justify-between">
                      <span className="text-slate-400 font-sans">總資產（持股＋現金）</span>
                      <span className="text-white font-bold">{fmt(total, 0)}</span>
                    </div>
                  )}
                  {Number(invested) > 0 &&
                    row(
                      '參考損益（依投資金額）',
                      pnl,
                      '(持股市值＋帳戶現金) − 投資金額，÷ 投資金額。和銀行／券商的「參考損益」「總投資報酬率」算法相同。',
                    )}
                  {div > 0 &&
                    row(
                      '含息損益',
                      pnl + div,
                      '再加上已入帳的現金配息，對應「投資報酬率（含已入帳配息）」。',
                    )}
                </div>
              );
            })()}
            <div className="flex items-center gap-1 pt-1 font-sans">
              <span className="text-[10px] text-slate-400 mr-1">
                市值計算
                <Tip text="即時價：盤中隨成交變動。昨收：用前一個交易日收盤價，多數銀行／券商的「參考市值」是這個，對帳時請切到昨收。" />
              </span>
              {[
                ['live', '即時價'],
                ['prev', '昨收'],
              ].map(([k, label]) => (
                <button
                  type="button"
                  key={k}
                  onClick={() => setHoldBasis(k)}
                  className={`px-2 py-0.5 rounded text-[11px] border cursor-pointer ${
                    holdBasis === k
                      ? 'bg-sky-600 border-sky-500 text-white'
                      : 'border-slate-700 text-slate-400 hover:text-white'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="text-[10px] text-slate-500">
              {holdCurrencies
                ? `海外持股以即時匯率換算台幣：${holdCurrencies
                    .split(',')
                    .map((c) => `${c} ${fx?.[c] ?? '--'}`)
                    .join(
                      '、',
                    )}${holdCurrencies.includes('GBp') ? '（GBp＝英國便士，0.01 英鎊）' : ''}`
                : '全部為台股'}
              {fxWarn && <span className="text-amber-300">（⚠️ {fxWarn}）</span>}
              {holdTotals.missing ? `；${holdTotals.missing} 檔查無即時價未計入` : ''}
            </div>
          </div>
        )}
        {holdRows.map((r) => (
          <Row
            key={r.symbol}
            sym={r.symbol}
            quote={r.quote}
            spark={sparks[r.symbol]}
            active={baseCode(selected) === baseCode(r.symbol)}
            onClick={() => onSelect(r.symbol)}
            sub={`${Number.isInteger(r.shares) ? fmt(r.shares, 0) : fmt(r.shares, 4)} 股・成本 ${fmt(r.cost)}・${
              r.pnlPct == null ? '--' : `${r.pnlPct > 0 ? '+' : ''}${fmt(r.pnlPct)}%`
            }`}
            action={
              <span className="flex items-center gap-1">
                <button
                  type="button"
                  title="到技術分析看這檔，並對照你的成本"
                  onClick={(e) => {
                    e.stopPropagation();
                    window.TA.analyzeSymbol?.(r.symbol);
                  }}
                  className="text-[11px] px-1.5 py-0.5 rounded bg-sky-700/40 text-sky-200 hover:bg-sky-700/70 cursor-pointer"
                >
                  分析
                </button>
                <button
                  type="button"
                  title="用模擬下單賣出（會寫入交易紀錄）"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSell(r);
                  }}
                  className="text-[11px] px-1.5 py-0.5 rounded bg-emerald-700/40 text-emerald-200 hover:bg-emerald-700/70 cursor-pointer"
                >
                  賣出
                </button>
                <button
                  type="button"
                  title="直接移除（不記錄交易）"
                  onClick={(e) => {
                    e.stopPropagation();
                    setHoldings(holdings.filter((h) => h.symbol !== r.symbol));
                  }}
                  className="text-slate-600 hover:text-rose-400 text-xs px-1 cursor-pointer"
                >
                  ✕
                </button>
              </span>
            }
          />
        ))}
        <div className="rounded-xl border border-slate-800 p-2 space-y-1.5">
          <div className="text-[11px] text-slate-400">
            新增 / 更新一檔持股
            <window.TA.Tip text="成本價＝你的「買進價格」（每股），不是收盤價。分批買進請填平均成本：總花費（含手續費）÷ 總股數。用模擬下單買進時，系統會自動用成交價加手續費算加權平均成本。" />
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {[
              ['symbol', '代號'],
              ['shares', '股數'],
              ['cost', '成本價'],
            ].map(([k, label]) => (
              <input
                key={k}
                value={holdForm[k]}
                onChange={(e) => setHoldForm({ ...holdForm, [k]: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && addHolding()}
                placeholder={label}
                aria-label={`持股${label}`}
                className="min-w-0 bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-xs mono text-white"
              />
            ))}
          </div>
          <button
            type="button"
            onClick={addHolding}
            className="w-full py-1.5 rounded bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold cursor-pointer"
          >
            ＋ 加入持股
          </button>
        </div>
        <details className="rounded-xl border border-slate-800 p-2 text-xs">
          <summary className="cursor-pointer text-slate-300">貼上券商 CSV 批次匯入</summary>
          <textarea
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            rows={4}
            placeholder={'每行一檔：代號,股數,成本價\n2330,1000,980\nNVDA,10,120.5'}
            aria-label="持股 CSV"
            className="w-full mt-2 bg-slate-950 border border-slate-700 rounded p-2 mono text-xs text-white"
          />
          <button
            type="button"
            onClick={importCsv}
            className="mt-1 px-3 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-100 cursor-pointer"
          >
            匯入
          </button>
        </details>
        {holdRows.length > 0 && (
          <button
            type="button"
            onClick={() =>
              onSendHoldings(
                holdRows.map((r) => ({
                  symbol: r.symbol,
                  market: isTW(r.symbol) ? 'TW' : 'US',
                  shares: r.shares,
                  price: r.price ?? r.cost,
                })),
              )
            }
            className="w-full py-2 rounded-lg bg-amber-500 text-slate-950 text-xs font-bold hover:brightness-110 cursor-pointer"
          >
            把我的持股送去組合風控分析
          </button>
        )}
        <p className="text-[10px] text-slate-500">持股只存在這個瀏覽器，不會上傳。</p>
      </div>
    );
  }

  window.TA = Object.assign(window.TA || {}, { HoldingsPanel });
})();
