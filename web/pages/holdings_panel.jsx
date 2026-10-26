(() => {
  // 我的持股：市值／成本／損益總覽（可切即時價或昨收、填帳戶現金／投資金額／已領配息以便和銀行對帳）、
  // 持股清單（分析、回測、帶入賣出委託、移除）、新增與 CSV 匯入、送去組合風控
  const { useState, useEffect, useMemo } = React;
  const { readLS, writeLS, currencyOf, normSym, baseCode, fmt, colorOf, Tip } = window.TA;

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
    prefill,
    onPrefillUsed,
  }) {
    const { Row } = window.TA;
    const setHoldings = window.TA.setHoldings;
    const [holdForm, setHoldForm] = useState({ symbol: '', shares: '', cost: '', broker: '' });
    // 看盤頁按「加入我的持股」：帶入代號與現價，用過就清掉，下次切回這個分頁不會再蓋掉表單
    useEffect(() => {
      if (!prefill) return;
      setHoldForm((f) => ({ ...f, ...prefill, broker: prefill.broker || '' }));
      onPrefillUsed?.();
    }, [prefill, onPrefillUsed]);
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
        holdings.map((h, idx) => {
          const hq = quotes[baseCode(h.symbol)];
          const price = holdBasis === 'prev' ? (hq?.prev_close ?? hq?.price) : hq?.price;
          const currency = hq?.currency || currencyOf(h.symbol);
          // 每 1 單位計價幣別＝幾台幣；匯率還沒拿到時為 null（不計入台幣合計，避免算出 0 元）
          const mult = currency === 'TWD' ? 1 : (fx?.[currency] ?? null);
          const value = price != null ? price * h.shares : null;
          const cost = h.cost * h.shares;
          return {
            ...h,
            rowIndex: idx,
            id: h.id || `${h.symbol}_${h.broker || ''}_${idx}`,
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
      const sym = normSym((holdForm.symbol || '').trim());
      const shares = Number(
        String(holdForm.shares || '')
          .replace(/,/g, '')
          .trim(),
      );
      const cost = Number(
        String(holdForm.cost || '')
          .replace(/,/g, '')
          .trim(),
      );
      const broker = (holdForm.broker || '').trim();
      if (!sym || !(shares > 0) || !(cost >= 0)) {
        say('⚠️ 沒有新增：請填代號、股數（正數）與成本價');
        return;
      }
      const sameEntry = (h) => h.symbol === sym && (h.broker || '').trim() === broker;
      const old = holdings.find(sameEntry);
      let next;
      if (old) {
        const totalShares = old.shares + shares;
        const weightedCost =
          Math.round(((old.cost * old.shares + cost * shares) / totalShares) * 10000) / 10000;
        next = holdings.map((h) =>
          sameEntry(h) ? { ...h, shares: totalShares, cost: weightedCost } : h,
        );
        window.TA.notifySaved(
          `已累加持股 ${sym}${broker ? `（${broker}）` : ''}：原 ${old.shares} 股 + 新增 ${shares} 股 ＝ 共 ${totalShares} 股、成本 ${weightedCost}`,
        );
      } else {
        const newEntry = {
          id: `${sym}_${broker || 'main'}_${Date.now()}`,
          symbol: sym,
          shares,
          cost,
          broker: broker || undefined,
          opened: new Date().toISOString().slice(0, 10),
        };
        next = [...holdings, newEntry];
        window.TA.notifySaved(
          `已新增持股 ${sym}${broker ? `（${broker}）` : ''}：${shares} 股、成本 ${cost}`,
        );
      }
      setHoldings(next);
      setHoldForm({ symbol: '', shares: '', cost: '', broker: '' });
    };
    const importCsv = () => {
      // 1. 去除首尾空格，切分行，並過濾掉純空格或空行（末行空格自動清除）
      const lines = csvText
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

      const parsedRows = [];
      for (const line of lines) {
        if (/^(代號|symbol|ticker|股票代號|商品代碼)/i.test(line)) continue;
        const rawParts = line.split(/[\t,;]/).map((x) => x.replace(/^["']|["']$/g, '').trim());

        // 拿掉末端因多餘逗號或空格產生的空欄位
        while (rawParts.length > 3 && rawParts[rawParts.length - 1] === '') {
          rawParts.pop();
        }
        if (rawParts.length < 3) continue;

        const a = rawParts[0];
        let bStr = rawParts[1];
        let cStr = rawParts[2];
        let broker = rawParts[3] ? rawParts[3].trim() : '';

        // 如果股數因千分位被逗號拆散（例如 0050, 1, 130, 41.7, 富邦）
        if (
          rawParts.length >= 4 &&
          !Number.isNaN(Number(rawParts[1])) &&
          !Number.isNaN(Number(rawParts[2])) &&
          !Number.isNaN(Number(rawParts[3]))
        ) {
          const combinedShares = Number(`${rawParts[1]}${rawParts[2]}`);
          const possibleCost = Number(rawParts[3]);
          if (combinedShares > 0 && possibleCost >= 0) {
            bStr = String(combinedShares);
            cStr = String(possibleCost);
            broker = rawParts[4] ? rawParts[4].trim() : '';
          }
        }

        const sym = normSym((a || '').trim());
        const shares = Number(
          String(bStr || '')
            .replace(/,/g, '')
            .trim(),
        );
        const cost = Number(
          String(cStr || '')
            .replace(/,/g, '')
            .trim(),
        );

        if (sym && shares > 0 && cost >= 0) {
          parsedRows.push({
            symbol: sym,
            shares,
            cost,
            broker: broker || undefined,
          });
        }
      }

      if (!parsedRows.length) {
        say('⚠️ 沒有匯入：沒有讀到有效列。格式：代號,股數,成本價[,券商]（每行一檔）');
        return;
      }

      // 根據情境增加持股：在既有持股基礎上「累加/新增」，不抹除其他持股
      // 同標的且同券商：加權平均累加股數與成本
      // 同標的但不同券商（或新標的）：新增為獨立持股項目
      const currentHoldings = [...holdings];
      let addedCount = 0;
      let mergedCount = 0;

      for (const r of parsedRows) {
        const brokerKey = (r.broker || '').trim();
        const existingIdx = currentHoldings.findIndex(
          (h) => h.symbol === r.symbol && (h.broker || '').trim() === brokerKey,
        );

        if (existingIdx >= 0) {
          const old = currentHoldings[existingIdx];
          const totalShares = old.shares + r.shares;
          const weightedCost =
            Math.round(((old.cost * old.shares + r.cost * r.shares) / totalShares) * 10000) / 10000;
          currentHoldings[existingIdx] = {
            ...old,
            shares: totalShares,
            cost: weightedCost,
          };
          mergedCount++;
        } else {
          currentHoldings.push({
            id: `${r.symbol}_${brokerKey || 'main'}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            ...r,
            opened: new Date().toISOString().slice(0, 10),
          });
          addedCount++;
        }
      }

      setHoldings(currentHoldings);
      setCsvText('');
      const msg =
        mergedCount > 0
          ? `已成功匯入持股：新增 ${addedCount} 筆、累加合併 ${mergedCount} 筆`
          : `已成功匯入 ${addedCount} 檔持股`;
      window.TA.notifySaved(msg);
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
        {holdRows.map((r, idx) => (
          <Row
            key={r.id || `${r.symbol}_${r.broker || ''}_${idx}`}
            sym={r.symbol}
            quote={r.quote}
            tag={
              r.broker
                ? {
                    label: r.broker,
                    className: 'text-cyan-300 border-cyan-500/40 bg-cyan-950/40',
                  }
                : undefined
            }
            spark={sparks[r.symbol]}
            active={baseCode(selected) === baseCode(r.symbol)}
            onClick={() => onSelect(r.symbol)}
            sub={`${r.broker ? `【${r.broker}】` : ''}${Number.isInteger(r.shares) ? fmt(r.shares, 0) : fmt(r.shares, 4)} 股・成本 ${fmt(r.cost)}・${
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
                  title="到策略回測跑這檔，並帶入你的持股金額"
                  onClick={(e) => {
                    e.stopPropagation();
                    window.TA.backtestSymbol?.(r.symbol);
                  }}
                  className="text-[11px] px-1.5 py-0.5 rounded bg-violet-700/40 text-violet-200 hover:bg-violet-700/70 cursor-pointer"
                >
                  回測
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
                    // 刪除沒辦法復原：先確認（要記錄賣出請改按「賣出」）
                    if (
                      !window.confirm(
                        `確定移除持股 ${r.symbol}${r.broker ? `（${r.broker}）` : ''}（${fmt(r.shares, 4)} 股）？\n不會寫入交易紀錄；要記錄賣出請改按「賣出」。`,
                      )
                    ) {
                      say('ℹ️ 已取消，持股沒有變動');
                      return;
                    }
                    setHoldings(holdings.filter((_, i) => i !== r.rowIndex));
                    window.TA.notifySaved(
                      `已移除持股 ${r.symbol}${r.broker ? `（${r.broker}）` : ''}`,
                    );
                  }}
                  aria-label={`移除持股 ${r.symbol}`}
                  className="text-slate-600 hover:text-rose-400 text-xs px-1 cursor-pointer"
                >
                  ✕
                </button>
              </span>
            }
          />
        ))}
        <div className="rounded-xl border border-slate-800 p-3 space-y-2.5 bg-slate-900/50">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
            <span>新增 / 累加持股部位</span>
            <window.TA.Tip text="成本價＝每股買進價格。若在不同券商持有同一標的，可填寫「券商」獨立分開管理；若未填或同券商，系統會自動加權平均累加股數與成本。" />
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <label className="block text-[11px] text-slate-400">
              <span className="block mb-1">標的代號</span>
              <input
                value={holdForm.symbol || ''}
                onChange={(e) => setHoldForm({ ...holdForm, symbol: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && addHolding()}
                placeholder="如 2330 / 0050"
                aria-label="持股代號"
                className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs mono text-white focus:border-sky-400 focus:outline-none"
              />
            </label>
            <label className="block text-[11px] text-sky-400 font-medium">
              <span className="block mb-1">券商 / 帳戶 (選填)</span>
              <input
                value={holdForm.broker || ''}
                onChange={(e) => setHoldForm({ ...holdForm, broker: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && addHolding()}
                placeholder="如 元大 / 富邦"
                aria-label="持股券商"
                className="w-full bg-slate-950 border border-sky-600/50 rounded px-2.5 py-1.5 text-xs mono text-white focus:border-sky-400 focus:outline-none placeholder:text-slate-500"
              />
            </label>
            <label className="block text-[11px] text-slate-400">
              <span className="block mb-1">持有股數</span>
              <input
                value={holdForm.shares || ''}
                onChange={(e) => setHoldForm({ ...holdForm, shares: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && addHolding()}
                placeholder="如 1000"
                aria-label="持股股數"
                className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs mono text-white focus:border-sky-400 focus:outline-none"
              />
            </label>
            <label className="block text-[11px] text-slate-400">
              <span className="block mb-1">買進每股成本</span>
              <input
                value={holdForm.cost || ''}
                onChange={(e) => setHoldForm({ ...holdForm, cost: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && addHolding()}
                placeholder="如 100 或 41.7"
                aria-label="持股成本價"
                className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs mono text-white focus:border-sky-400 focus:outline-none"
              />
            </label>
          </div>
          <button
            type="button"
            onClick={addHolding}
            className="w-full py-1.5 rounded bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold cursor-pointer shadow-sm"
          >
            ＋ 加入 / 累加持股
          </button>
        </div>
        <details className="rounded-xl border border-slate-800 p-2 text-xs">
          <summary className="cursor-pointer text-slate-300">貼上券商 CSV 批次匯入</summary>
          <textarea
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            rows={4}
            placeholder={
              '每行一檔：代號,股數,成本價[,券商]\n0050,1000,100,元大\n0050,130,41.7,富邦\nNVDA,10,120.5'
            }
            aria-label="持股 CSV"
            className="w-full mt-2 bg-slate-950 border border-slate-700 rounded p-2 mono text-xs text-white"
          />
          <div className="flex items-center justify-between mt-1">
            <button
              type="button"
              onClick={importCsv}
              className="px-3 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-100 cursor-pointer"
            >
              匯入持股
            </button>
            <span className="text-[10px] text-slate-500">
              末行空格自動清除・支援分券商或同券商自動累加
            </span>
          </div>
        </details>
        {holdRows.length > 0 && (
          <button
            type="button"
            onClick={() =>
              onSendHoldings(
                holdRows.map((r) => ({
                  symbol: r.symbol,
                  market: window.TA.marketOf(r.symbol),
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
