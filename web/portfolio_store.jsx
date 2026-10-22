// 跨頁共用的「我的資料」：持股、交易紀錄（已平倉）、交易檢討產生的個人規則。
// 存在瀏覽器 localStorage；任何頁面改動都會廣播 'portfolio-changed'，讓看盤、組合風控、交易檢討、技術分析同步。
(() => {
  const { useState, useEffect } = React;
  const { readLS, writeLS } = window.TA;

  const KEYS = {
    holdings: 'tw_us_holdings_v1',
    journal: 'tw_us_journal_v1',
    rules: 'tw_us_rules_v1',
  };
  const today = () => new Date().toISOString().slice(0, 10);

  const load = () => ({
    holdings: readLS(KEYS.holdings, []),
    journal: readLS(KEYS.journal, []),
    rules: readLS(KEYS.rules, null), // { rules: [...], source, savedAt }
  });
  const save = (key, value) => {
    writeLS(KEYS[key], value);
    window.dispatchEvent(new Event('portfolio-changed'));
  };

  const usePortfolio = () => {
    const [st, setSt] = useState(load);
    useEffect(() => {
      const on = () => setSt(load());
      window.addEventListener('portfolio-changed', on);
      window.addEventListener('storage', on);
      return () => {
        window.removeEventListener('portfolio-changed', on);
        window.removeEventListener('storage', on);
      };
    }, []);
    return st;
  };

  const setHoldings = (h) => save('holdings', h);
  const setJournal = (j) => save('journal', j);
  const saveRules = (rules, source) =>
    save('rules', {
      rules,
      source,
      savedAt: new Date().toLocaleString('zh-TW', { hour12: false }),
    });

  // 模擬下單「成交」：買進 → 加到持股（加權平均成本）；賣出 → 從持股扣除並寫一筆已平倉交易到交易紀錄
  const fillOrder = ({ symbol, side, price, shares, fees = 0 }) => {
    const { holdings, journal } = load();
    const h = holdings.find((x) => x.symbol === symbol);
    if (side === 'BUY') {
      const next = h
        ? holdings.map((x) =>
            x.symbol === symbol
              ? {
                  ...x,
                  shares: x.shares + shares,
                  cost:
                    Math.round(
                      ((x.cost * x.shares + price * shares + fees) / (x.shares + shares)) * 10000,
                    ) / 10000,
                }
              : x,
          )
        : [
            ...holdings,
            {
              symbol,
              shares,
              cost: Math.round(((price * shares + fees) / shares) * 10000) / 10000,
              opened: today(),
            },
          ];
      setHoldings(next);
      return { ok: true, msg: `已成交買進 ${symbol} ${shares} 股，持股已更新` };
    }
    if (!h || h.shares < shares)
      return {
        ok: false,
        msg: `賣出失敗：持股中沒有足夠的 ${symbol}（目前 ${h ? h.shares : 0} 股）`,
      };
    const trade = {
      trade_id: `#${String(journal.length + 1).padStart(2, '0')}`,
      symbol,
      entry_time: h.opened || '',
      exit_time: today(),
      entry_price: h.cost,
      exit_price: price,
      shares,
      fees,
      emotion_score: 0,
      source: '模擬下單成交',
    };
    setJournal([...journal, trade]);
    setHoldings(
      h.shares === shares
        ? holdings.filter((x) => x.symbol !== symbol)
        : holdings.map((x) => (x.symbol === symbol ? { ...x, shares: x.shares - shares } : x)),
    );
    return { ok: true, msg: `已成交賣出 ${symbol} ${shares} 股，已寫入交易紀錄 ${trade.trade_id}` };
  };

  // 交易檢討產生的規則：在下單面板、技術分析、組合風控顯示
  function RulesReminder({ compact = false }) {
    const { rules } = usePortfolio();
    if (!rules?.rules?.length) return null;
    return (
      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-2 text-xs text-emerald-100 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <b className="text-emerald-300">📌 我的交易規則（來自交易檢討）</b>
          <span className="text-[10px] text-slate-400">
            {rules.savedAt} ・ {rules.source}
          </span>
          <button
            type="button"
            onClick={() => window.TA.goTab?.('mod5')}
            className="ml-auto text-[11px] text-sky-300 underline cursor-pointer"
          >
            到交易檢討更新
          </button>
        </div>
        {!compact &&
          rules.rules.map((r) => (
            <div key={r.rule_number}>
              {r.rule_number}. <b>{r.rule_name}</b>：當 {r.condition}，就 {r.action}
            </div>
          ))}
      </div>
    );
  }

  window.TA = Object.assign(window.TA || {}, {
    usePortfolio,
    loadPortfolio: load,
    setHoldings,
    setJournal,
    saveRules,
    fillOrder,
    RulesReminder,
  });
})();
