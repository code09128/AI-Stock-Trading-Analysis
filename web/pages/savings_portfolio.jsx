// 存股計畫頁的兩個分頁（共用元件在 savings_plan.jsx 的 window.TA.savingsUI）：
// - 投資組合：多檔 ETF 照比例定期定額，算組合的三種參考報酬率、年化波動、最大回撤、與加權指數比較、
//   過去 N 年實際回測（每月照比例投入、不賣出），可存多組並排比較、一鍵帶入我的持股
// - 實際對帳：像銀行 App 的「投資現況」那樣填投資金額、參考市值、已入帳配息，算報酬率、含息報酬率與年化（XIRR）
// 公式都在後端 src/portfolio/savings_plan.py（/api/savings/portfolio、/api/savings/calc kind=ledger）
(() => {
  const { useState, useEffect, useRef } = React;
  const { fmt, readLS, writeLS, signed } = window.TA;

  const LS_PORT = 'tw_us_savings_portfolios_v1';
  const LS_LEDGER = 'tw_us_savings_ledger_v1';
  const PORT_DEFAULTS = {
    list: [
      {
        id: 'p1',
        name: '範例：股七債三',
        items: [
          { symbol: '0050', weight: 35 },
          { symbol: '00713', weight: 35 },
          { symbol: '00697B', weight: 30 },
        ],
        cash: 0,
      },
    ],
    active: 'p1',
    initial: 10000,
    monthly: 1000,
    years: 10,
    range: '1y',
    compare: [],
  };
  const RANGES = [
    ['3m', '3月'],
    ['6m', '6月'],
    ['1y', '1年'],
    ['3y', '3年'],
  ];
  const PERIODS = [
    ['3m', '近3月'],
    ['6m', '近6月'],
    ['1y', '近1年'],
    ['3y', '近3年'],
    ['5y', '近5年'],
  ];

  const newId = () => `p${Date.now().toString(36)}`;
  // 每個組合有自己的期初投入與每月定額（舊資料沒有就用共用的預設值）。每一檔存的是比例（weight，%）：
  // 畫面上比例與每月金額都能填，填金額就換算成比例（金額 ÷ 每月定額），改每月定額時各檔金額跟著比例變。
  // 比例合計不到 100% 的部分就是「未分配」，當作現金（不投入）。
  const monthlyOf = (p, s) => Number(p.monthly ?? s.monthly) || 0;
  const initialOf = (p, s) => Number(p.initial ?? s.initial) || 0;
  // 期初投入與每月定額的幣別（組合裡有美股時可以改用美元填）；沒設定就是台幣
  const curOf = (p) => (p.currency === 'USD' ? 'USD' : 'TWD');
  const unitOf = (c) => (c === 'USD' ? '美元' : '元');
  const money = (v, c) => (v == null ? '--' : `${fmt(v, c === 'USD' ? 2 : 0)} ${unitOf(c)}`);
  const weightSum = (p) => p.items.reduce((a, it) => a + (Number(it.weight) || 0), 0);
  // 只送代號與比例：帶入持股時記下的 held 只在畫面上顯示，不影響試算
  const reqOf = (p, s) => ({
    items: p.items
      .filter((it) => String(it.symbol || '').trim())
      .map((it) => ({ symbol: it.symbol, weight: it.weight })),
    cash: Math.max(0, Math.round((100 - weightSum(p)) * 1e4) / 1e4),
    initial: initialOf(p, s),
    monthly: monthlyOf(p, s),
    currency: curOf(p),
  });
  // 畫面上即時顯示用（不用等試算）：每一列的比例與金額、台股／海外／未分配的合計。
  // 比例合計超過 100% 時後端會依比例縮小，這裡也照同樣方式顯示
  function allocation(p, s) {
    const sum = weightSum(p);
    const scale = Math.max(100, sum);
    const monthly = monthlyOf(p, s);
    const initial = initialOf(p, s);
    const rows = p.items.map((it) => {
      const w = (Number(it.weight) || 0) / scale;
      return { w, amount: w * monthly, initial: w * initial };
    });
    const split = { tw: 0, other: 0, cash: Math.max(0, 100 - sum) / scale };
    p.items.forEach((it, i) => {
      if (!String(it.symbol || '').trim()) return;
      split[window.TA.marketOf(window.TA.normSym(it.symbol)) === 'TW' ? 'tw' : 'other'] += rows[i].w;
    });
    return { rows, sum, monthly, initial, split, over: sum > 100.0001, currency: curOf(p) };
  }
  const upDown = (v) => (v == null ? 'text-slate-400' : v < 0 ? 'text-emerald-400' : 'text-rose-400');

  function usePersist(key, defaults) {
    const [s, setS] = useState(() => ({ ...defaults, ...readLS(key, {}) }));
    const first = useRef(true);
    useEffect(() => {
      if (first.current) {
        first.current = false;
        return;
      }
      writeLS(key, s);
    }, [s]);
    return [s, (patch) => setS((old) => ({ ...old, ...(typeof patch === 'function' ? patch(old) : patch) }))];
  }

  // 組合與加權指數的累積報酬走勢（%）
  function PctChart({ rows }) {
    if (!rows?.length) return null;
    const W = 640;
    const H = 200;
    const pad = { l: 40, r: 10, t: 10, b: 22 };
    const vals = rows.flatMap((r) => [r.port, r.bench]).filter((v) => v != null);
    const lo = Math.min(0, ...vals);
    const hi = Math.max(0, ...vals);
    const span = hi - lo || 1;
    const px = (i) => pad.l + (i / Math.max(1, rows.length - 1)) * (W - pad.l - pad.r);
    const py = (v) => H - pad.b - ((v - lo) / span) * (H - pad.t - pad.b);
    const line = (key) =>
      rows
        .map((r, i) => (r[key] == null ? null : `${px(i)},${py(r[key])}`))
        .filter(Boolean)
        .join(' ');
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => lo + span * f);
    const step = Math.max(1, Math.ceil(rows.length / 6));
    return (
      <div className="space-y-1">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="組合與加權指數累積報酬">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={py(t)} y2={py(t)} stroke="#1e293b" />
              <text x={pad.l - 4} y={py(t) + 3} fontSize="9" fill="#64748b" textAnchor="end">
                {fmt(t, 0)}%
              </text>
            </g>
          ))}
          <line x1={pad.l} x2={W - pad.r} y1={py(0)} y2={py(0)} stroke="#475569" strokeDasharray="3 3" />
          {rows
            .map((r, i) => [r, i])
            .filter(([, i]) => i % step === 0)
            .map(([r, i]) => (
              <text key={r.date} x={px(i)} y={H - 6} fontSize="9" fill="#64748b" textAnchor="middle">
                {r.date.slice(0, 7)}
              </text>
            ))}
          <polyline fill="none" stroke="#60a5fa" strokeWidth="1.5" points={line('bench')} />
          <polyline fill="none" stroke="#f59e0b" strokeWidth="2" points={line('port')} />
        </svg>
        <div className="flex flex-wrap gap-3 text-[11px] text-slate-400">
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-0.5 bg-amber-500" />
            投資組合（含息）
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-0.5 bg-blue-400" />
            加權指數（不含配息）
          </span>
        </div>
      </div>
    );
  }

  // 台股／海外／現金各佔多少（填的當下就更新，不用等試算）
  function AllocBar({ alloc }) {
    const parts = [
      ['台股', alloc.split.tw, 'bg-amber-500'],
      ['海外', alloc.split.other, 'bg-sky-500'],
      ['未分配（現金）', alloc.split.cash, 'bg-slate-500'],
    ].filter(([, w]) => w > 0);
    if (!parts.length) return null;
    return (
      <div className="space-y-1 max-w-lg">
        <div className="flex h-2 rounded overflow-hidden bg-slate-800">
          {parts.map(([l, w, c]) => (
            <div key={l} className={c} style={{ width: `${w * 100}%` }} />
          ))}
        </div>
        <div className="flex flex-wrap gap-3 text-[11px] text-slate-400">
          {parts.map(([l, w, c]) => (
            <span key={l} className="flex items-center gap-1">
              <span className={`inline-block w-2 h-2 rounded-sm ${c}`} />
              {l} {fmt(w * 100, 1)}%（每月 {money(w * alloc.monthly, alloc.currency)}）
            </span>
          ))}
        </div>
      </div>
    );
  }

  // 每月扣款後照比例買進的明細：跟銀行／券商定期定額的「買進明細」同樣的欄位
  function BuyCard({ d, monthly }) {
    const { Card } = window.TA.savingsUI;
    const bought = d.items.reduce((a, r) => a + (r.monthly_amount || 0), 0);
    const c = d.input_currency || 'TWD';
    return (
      <Card
        title="每月扣款買進明細（照比例）"
        tip="每月扣款 × 比例＝每檔買進金額；買進股數＝金額 ÷ 現價（外幣先換成台幣）。碎股：銀行信託的定期定額，金額全部買進，股數到小數 4 位。整股：券商零股定期定額，只買整數股，剩下的錢留在帳戶。現價是目前報價，實際以扣款日成交價為準。"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-xs mono">
            <thead className="text-slate-400">
              <tr className="border-b border-slate-800 font-sans">
                <th className="text-left py-1.5 font-normal">標的</th>
                <th className="text-right font-normal">比例</th>
                <th className="text-right font-normal">買進金額</th>
                <th className="text-right font-normal">現價</th>
                <th className="text-right font-normal">碎股股數</th>
                <th className="text-right font-normal">整股（剩餘）</th>
                <th className="text-right font-normal">資料起始</th>
              </tr>
            </thead>
            <tbody>
              {d.items.map((r) => (
                <tr key={r.symbol} className="border-b border-slate-800/60">
                  <td className="py-1.5 font-sans text-slate-200">
                    {r.symbol} <span className="text-slate-400">{r.name}</span>
                  </td>
                  <td className="text-right text-slate-300">{fmt(r.weight_pct, 2)}%</td>
                  <td className="text-right text-white">{money(r.monthly_amount, c)}</td>
                  <td className="text-right">
                    {r.price == null ? '--' : `${fmt(r.price, 2)}${r.currency && r.currency !== 'TWD' ? ` ${r.currency}` : ''}`}
                  </td>
                  <td className="text-right text-white">{r.est_frac == null ? '--' : `${fmt(r.est_frac, 4)} 股`}</td>
                  <td className="text-right text-slate-300">
                    {r.est_whole == null ? '--' : `${fmt(r.est_whole, 0)} 股（剩 ${money(r.est_leftover, c)}）`}
                  </td>
                  <td className="text-right text-slate-400">{r.first_date || '--'}</td>
                </tr>
              ))}
              <tr className="font-sans text-slate-300">
                <td className="py-1.5">每月扣款 {money(monthly, c)}</td>
                <td className="text-right">{fmt(100 - (d.cash_pct || 0), 2)}%</td>
                <td className="text-right mono text-white">{money(bought, c)}</td>
                <td colSpan={4} className="text-right text-slate-400">
                  {d.cash_pct ? `現金 ${fmt(d.cash_pct, 2)}%（${money(monthly - bought, c)}）不投入` : ''}
                  {c !== 'TWD' && d.input_fx_to_twd ? `・1 美元 ≈ ${fmt(d.input_fx_to_twd, 2)} 元` : ''}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
    );
  }

  // ---------- 投資組合 ----------
  function PortfolioTab() {
    const { Card, Num, Btn, LineChart, useCalc, post, wan, pct, inputCls, copyText, holdingsValues } =
      window.TA.savingsUI;
    const [s, set] = usePersist(LS_PORT, PORT_DEFAULTS);
    const [res, setRes] = useState({}); // {組合 id: {key, data, err, loading}}
    const [note, setNote] = useState('');
    const [pickBasis, setPickBasis] = useState(false); // 「帶入我的持股」要選依成本或依市值
    const p = s.list.find((x) => x.id === s.active) || s.list[0];
    const alloc = allocation(p, s);
    const hasHeld = p.items.some((it) => it.held);

    const patchP = (patch) =>
      set((old) => ({ list: old.list.map((x) => (x.id === p.id ? { ...x, ...patch } : x)) }));
    const patchItem = (i, patch) => patchP({ items: p.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) });

    const latest = useRef({}); // 組合 id → 最後一次送出的序號：改完又按一次時，舊的結果晚回來不採用
    const run = (port) => {
      const body = reqOf(port, s);
      const key = JSON.stringify(body);
      if (!body.items.length) return;
      const mine = (latest.current[port.id] || 0) + 1;
      latest.current[port.id] = mine;
      const done = (v) => latest.current[port.id] === mine && setRes((r) => ({ ...r, [port.id]: v }));
      setRes((r) => ({ ...r, [port.id]: { ...r[port.id], loading: true, err: '' } }));
      window.TA.postJob('/api/savings/portfolio', body)
        .then((d) => done(d.error ? { key, err: d.error } : { key, data: d }))
        .catch((e) => done({ key, err: e.message }));
    };
    // 切換組合時，沒算過就自動算一次；之後改內容要按「試算」（第一次抓各檔上市以來資料要一點時間）
    useEffect(() => {
      if (!res[p.id]) run(p);
    }, [p.id]);

    const cur = res[p.id];
    const d = cur?.data;
    const stale = cur?.key && cur.key !== JSON.stringify(reqOf(p, s));
    const st = d?.stats;
    // 第一個報酬率畫成走勢圖：資料夠 5 年就用穩定報酬率，不夠就只剩歷史報酬率
    const rates = st
      ? [
          ['穩定', st.rolling_median],
          ['較差', st.rolling_p20],
          ['歷史', st.cagr],
        ].filter(([, v]) => v != null)
      : [];
    const calc = useCalc(
      rates.length
        ? {
            kind: 'grow',
            monthly: monthlyOf(p, s),
            initial: initialOf(p, s),
            years: s.years || 1,
            rates: rates.map(([, v]) => v),
            labels: rates.map(([l]) => l),
          }
        : null,
    );
    const proj = rates.length ? calc.res : null;

    // 大金額：台幣用「萬」，美元直接寫到元
    const cy = curOf(p);
    const big = (v, c = cy) => (v == null ? '--' : c === 'USD' ? `${fmt(v, 0)} 美元` : wan(v));
    // 切換幣別：期初投入與每月定額用目前匯率換算過去，比例不變（各檔金額跟著換）
    const [fxNote, setFxNote] = useState('');
    const switchCurrency = async (to) => {
      if (to === cy) return;
      try {
        const rate = (await post('/api/fx', { currencies: ['USD'] })).rates?.USD?.rate;
        if (!rate) throw new Error('取不到美元匯率');
        const conv = (v) =>
          to === 'USD' ? Math.round(((Number(v) || 0) / rate) * 100) / 100 : Math.round((Number(v) || 0) * rate);
        patchP({ currency: to, monthly: conv(monthlyOf(p, s)), initial: conv(initialOf(p, s)) });
        setFxNote(`已用 1 美元 ≈ ${fmt(rate, 2)} 元換算（目前匯率）`);
      } catch (e) {
        setFxNote(`⚠️ ${e.message}，幣別沒有切換`);
      }
    };

    // 填每月金額 → 換算成比例（金額 ÷ 每月定額）；每月定額是 0 時沒辦法換算，畫面會提示先填每月定額
    const setAmount = (i, v) => {
      const m = monthlyOf(p, s);
      if (!(m > 0)) return;
      patchItem(i, { weight: v === '' ? '' : Math.round(((Number(v) || 0) / m) * 100 * 1e4) / 1e4 });
    };

    const addPortfolio = (port) =>
      set((old) => ({ list: [...old.list, port], active: port.id }));

    // basis：'cost'＝依投入成本（股數 × 成本價，比較接近你當初每檔放多少錢）；'value'＝依目前市值（漲多的那檔比例會變大）
    const fromHoldings = async (basis) => {
      setPickBasis(false);
      setNote('計算持股中…');
      try {
        const h = await holdingsValues();
        if (!h.rows.length || !(h.total > 0)) {
          setNote('「我的持股」是空的或取不到市值');
          return;
        }
        // 同一檔可能分在不同券商、或寫成 0050／0050.TW：用正規代號合併股數、成本與市值
        const merged = {};
        for (const r of h.rows) {
          const m = merged[r.key] || { symbol: r.key, shares: 0, value: 0, cost: 0 };
          m.shares += r.shares;
          m.value += r.value;
          m.cost += r.cost;
          merged[r.key] = m;
        }
        const list = Object.values(merged);
        const by = (m) => (basis === 'cost' ? m.cost : m.value);
        const base = list.reduce((a, m) => a + by(m), 0);
        if (!(base > 0)) {
          setNote('持股沒有成本資料，請改用「依目前市值」');
          return;
        }
        const today = new Date().toISOString().slice(0, 10);
        addPortfolio({
          id: newId(),
          name: `我的持股（依${basis === 'cost' ? '成本' : '市值'}）`,
          items: list
            .sort((a, b) => by(b) - by(a))
            .map((m) => ({
              symbol: m.symbol,
              weight: Math.round((by(m) / base) * 10000) / 100,
              held: {
                shares: Math.round(m.shares * 1e4) / 1e4,
                value: Math.round(m.value),
                cost: Math.round(m.cost),
                at: today,
              },
            })),
          cash: 0,
          monthly: monthlyOf(p, s),
          initial: initialOf(p, s),
        });
        setNote(
          `已把 ${h.rows.length} 筆持股（合併成 ${list.length} 檔）依${basis === 'cost' ? `投入成本 ${fmt(base, 0)} 元` : `目前市值 ${fmt(base, 0)} 元（${h.basis === 'prev' ? '昨收' : '即時價'}）`}換算成比例${h.missing ? `；${h.missing} 筆沒有報價或匯率，用成本價或不計入` : ''}。要照每月實際扣款金額，直接在「每月金額」欄填。`,
        );
      } catch (e) {
        setNote(`⚠️ ${e.message}`);
      }
    };

    // 帶到實際對帳：有帶入持股就填投資金額（成本）與市值，並記下對應的組合，對帳頁可以點回來
    const toLedger = () => {
      const held = p.items.filter((it) => it.held);
      const sum = (k) => Math.round(held.reduce((a, it) => a + (Number(it.held[k]) || 0), 0));
      const old = { ...LEDGER_DEFAULTS, ...readLS(LS_LEDGER, {}) };
      const row = {
        id: newId(),
        name: p.name,
        start: '',
        invested: held.length ? sum('cost') : 0,
        value: held.length ? sum('value') : 0,
        dividends: 0,
        portfolio: p.id,
      };
      writeLS(LS_LEDGER, { ...old, rows: [...old.rows, row] });
      window.dispatchEvent(new CustomEvent('savings-action', { detail: { tab: 'ledger' } }));
    };

    const removeP = () => {
      if (s.list.length <= 1) return;
      set((old) => {
        const list = old.list.filter((x) => x.id !== p.id);
        return { list, active: list[0].id, compare: old.compare.filter((id) => id !== p.id) };
      });
    };

    const summary = () => {
      if (!d) return '';
      const lines = [
        `投資組合試算：${p.name}`,
        `每月扣款 ${money(monthlyOf(p, s), cy)}：${d.items.map((it) => `${it.name}（${it.symbol}）${pct(it.weight_pct)} ${money(it.monthly_amount, d.input_currency)}`).join('、')}${d.cash_pct ? `、現金 ${pct(d.cash_pct)}` : ''}`,
        `參考年化報酬：歷史 ${pct(st.cagr)}｜穩定 ${pct(st.rolling_median)}｜較差 ${pct(st.rolling_p20)}；年化波動 ${pct(st.volatility_pct)}；最大回撤 ${pct(st.drawdown?.pct)}`,
        `近期報酬：${PERIODS.map(([k, l]) => `${l} ${pct(st.periods?.[k])}`).join('｜')}`,
        ...d.backtest.map(
          (b) =>
            `過去 ${b.years} 年每月照比例投入：投入 ${big(b.invested, d.input_currency)} → ${big(b.value, d.input_currency)}（${pct(b.return_pct)}，年化 ${pct(b.xirr_pct)}）`,
        ),
      ];
      return lines.join('\n');
    };

    return (
      <>
        <Card
          title="① 投資組合配置"
          tip="先填期初投入與每月定額，再填每檔的比例或每月金額（兩個都能填，填一個另一個自動算；跟銀行、券商設定定期定額一樣）。比例合計不到 100% 的部分是「未分配」，當作現金不投入。還沒上市的期間，它的比例依比例分給其他標的。「帶入時持股」是按「帶入我的持股」當下的股數、成本與市值，不會自動更新。"
          extra={
            <>
              <Btn onClick={() => setPickBasis((v) => !v)}>帶入我的持股</Btn>
              <Btn onClick={toLedger}>帶到實際對帳</Btn>
              <Btn
                onClick={() =>
                  addPortfolio({
                    id: newId(),
                    name: `組合 ${s.list.length + 1}`,
                    items: [{ symbol: '', weight: 100 }],
                    cash: 0,
                    monthly: monthlyOf(p, s),
                    initial: initialOf(p, s),
                  })
                }
              >
                ＋ 新組合
              </Btn>
              <Btn onClick={() => addPortfolio({ ...p, id: newId(), name: `${p.name}（複製）` })}>複製</Btn>
              <Btn onClick={removeP} disabled={s.list.length <= 1}>
                刪除
              </Btn>
            </>
          }
        >
          <div className="flex flex-wrap gap-2">
            {s.list.map((x) => (
              <button
                key={x.id}
                type="button"
                onClick={() => set({ active: x.id })}
                className={`px-2.5 py-1 rounded-lg text-xs cursor-pointer ${
                  x.id === p.id ? 'bg-amber-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                {x.name}
              </button>
            ))}
          </div>
          {pickBasis && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300 bg-slate-950/60 rounded-lg px-3 py-2">
              比例要依：
              <Btn tone="sky" onClick={() => fromHoldings('cost')}>
                投入成本
              </Btn>
              <span className="text-slate-500">接近你當初每檔各放多少錢</span>
              <Btn tone="sky" onClick={() => fromHoldings('value')}>
                目前市值
              </Btn>
              <span className="text-slate-500">漲比較多的那檔比例會變大</span>
            </div>
          )}
          {note && <div className="text-xs text-slate-400">{note}</div>}
          {/* 1. 組合名稱與金額設定：先決定每月扣多少，下面各檔的金額才換算得出來 */}
          {/* 寬螢幕一列排完；窄一點時組合名稱自己一列，三個數字一列（標籤才不會被擠成兩行而對不齊） */}
          <div className="grid grid-cols-3 xl:grid-cols-5 gap-3 items-end">
            <div className="col-span-3 xl:col-span-2 flex items-end gap-2 min-w-0">
              <label className="block space-y-1 min-w-0 flex-1">
                <span className="text-[11px] text-slate-400 flex items-center gap-1">組合名稱</span>
                <input value={p.name} onChange={(e) => patchP({ name: e.target.value })} className={inputCls} />
              </label>
              <fieldset className="flex gap-1 border-0 p-0 m-0 shrink-0" aria-label="金額幣別">
                {[
                  ['TWD', '台幣'],
                  ['USD', '美元'],
                ].map(([c, l]) => (
                  <Btn key={c} tone={cy === c ? 'sky' : 'slate'} onClick={() => switchCurrency(c)}>
                    {l}
                  </Btn>
                ))}
              </fieldset>
            </div>
            <Num
              label="期初投入"
              suffix={unitOf(cy)}
              step={cy === 'USD' ? 100 : 10000}
              value={initialOf(p, s)}
              onChange={(v) => patchP({ initial: v })}
            />
            <Num
              label="每月定額"
              suffix={unitOf(cy)}
              step={cy === 'USD' ? 10 : 1000}
              value={monthlyOf(p, s)}
              onChange={(v) => patchP({ monthly: v })}
            />
            <Num label="試算年數" suffix="年" value={s.years} onChange={(v) => set({ years: v })} />
          </div>
          {/* 2. 各檔配置：比例與每月金額都能填 */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-slate-400">
                <tr className="border-b border-slate-800">
                  <th className="text-left py-1.5 font-normal">代號</th>
                  <th className="text-right font-normal">比例（%）</th>
                  <th className="text-right font-normal">每月金額（{unitOf(cy)}）</th>
                  <th className="text-right font-normal">期初分配</th>
                  {hasHeld && <th className="text-right font-normal">帶入時持股</th>}
                  <th />
                </tr>
              </thead>
              <tbody>
                {p.items.map((it, i) => {
                  const r = d?.items.find((x) => x.symbol === String(it.symbol).trim().toUpperCase());
                  return (
                    // 列可能還沒填代號，只能用位置當 key
                    <tr key={i} className="border-b border-slate-800/60">
                      <td className="py-1 pr-2">
                        <input
                          value={it.symbol}
                          onChange={(e) => patchItem(i, { symbol: e.target.value })}
                          className={`${inputCls} w-24`}
                          placeholder="例如 0050"
                          aria-label="代號"
                        />
                        {r && <div className="text-[10px] text-slate-500 mt-0.5">{r.name}</div>}
                      </td>
                      <td className="text-right">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={it.weight ?? ''}
                          onChange={(e) =>
                            patchItem(i, { weight: e.target.value === '' ? '' : Number(e.target.value) })
                          }
                          className={`${inputCls} w-20 text-right`}
                          aria-label="比例"
                        />
                      </td>
                      <td className="text-right">
                        <input
                          type="number"
                          step={cy === 'USD' ? 1 : 100}
                          min="0"
                          value={cy === 'USD' ? Math.round(alloc.rows[i].amount * 100) / 100 : Math.round(alloc.rows[i].amount)}
                          onChange={(e) => setAmount(i, e.target.value)}
                          disabled={!(alloc.monthly > 0)}
                          title={alloc.monthly > 0 ? '' : '先填每月定額'}
                          className={`${inputCls} w-24 text-right`}
                          aria-label="每月金額"
                        />
                      </td>
                      <td className="text-right mono text-slate-400">{money(alloc.rows[i].initial, cy)}</td>
                      {hasHeld && (
                        <td className="text-right mono text-slate-300">
                          {it.held ? (
                            <>
                              {`${fmt(it.held.shares, Number.isInteger(it.held.shares) ? 0 : 4)} 股`}
                              <div className="text-[10px] text-slate-500">
                                {it.held.cost != null && `成本 ${fmt(it.held.cost, 0)}・`}
                                {`市值 ${fmt(it.held.value, 0)} 元`}
                              </div>
                            </>
                          ) : (
                            '--'
                          )}
                        </td>
                      )}
                      <td className="text-right">
                        <button
                          type="button"
                          onClick={() => patchP({ items: p.items.filter((_, j) => j !== i) })}
                          className="text-slate-500 hover:text-rose-300 cursor-pointer px-1"
                          title="刪除這一列"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
                <tr className="text-slate-300">
                  <td className="py-1.5">
                    <Btn onClick={() => patchP({ items: [...p.items, { symbol: '', weight: 0 }] })}>＋ 加一檔</Btn>
                  </td>
                  <td className={`text-right mono ${alloc.over ? 'text-amber-300' : ''}`}>合計 {fmt(alloc.sum, 2)}%</td>
                  <td className="text-right mono">
                    {money(alloc.monthly * (1 - alloc.split.cash), cy)} / {money(alloc.monthly, cy)}
                  </td>
                  <td className="text-right mono text-slate-400">
                    {money(alloc.initial * (1 - alloc.split.cash), cy)}
                  </td>
                  <td colSpan={hasHeld ? 2 : 1} />
                </tr>
              </tbody>
            </table>
          </div>
          {/* 3. 分配結果：台股／海外／未分配 */}
          {alloc.over && (
            <div className="text-xs text-amber-300">
              比例合計超過 100%（每月金額加起來超過每月定額），試算時會依比例縮小成 100%。
            </div>
          )}
          {!(alloc.monthly > 0) && <div className="text-xs text-amber-300">先填每月定額，才能用金額換算比例。</div>}
          {fxNote && <div className="text-xs text-slate-400">{fxNote}</div>}
          <AllocBar alloc={alloc} />
          <div className="flex flex-wrap items-center gap-2">
            <Btn tone="sky" onClick={() => run(p)} disabled={cur?.loading}>
              {cur?.loading ? '計算中（第一次約需 10～40 秒）…' : '投資試算'}
            </Btn>
            {stale && !cur?.loading && <span className="text-xs text-amber-300">內容改過了，按「投資試算」更新結果</span>}
          </div>
          {cur?.err && <div className="text-xs text-rose-300">⚠️ {cur.err}</div>}
          {d?.warnings?.map((w) => (
            <div key={w} className="text-xs text-amber-300">
              ⚠️ {w}
            </div>
          ))}
        </Card>

        {d && !stale && <BuyCard d={d} monthly={monthlyOf(p, s)} />}

        {st && (
          <Card
            title="② 組合表現"
            tip="參考報酬率用組合指數計算：每天依目標比例加權各檔的含息報酬（等於每天調回目標比例）。穩定／較差報酬率需要組合有 5 年以上資料。"
            extra={<span>資料 {st.first_date} 起約 {st.years} 年</span>}
          >
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
              {[
                ['歷史報酬率', pct(st.cagr), '資料期間年化'],
                ['穩定報酬率', st.rolling_median == null ? '資料不足' : pct(st.rolling_median), '持有 5 年中位數'],
                ['較差報酬率', st.rolling_p20 == null ? '資料不足' : pct(st.rolling_p20), '持有 5 年第 20 百分位'],
                ['年化波動率', pct(st.volatility_pct), '月報酬標準差 × √12'],
                [
                  '最大回撤',
                  st.drawdown?.pct ? `-${fmt(st.drawdown.pct, 2)}%` : '--',
                  st.drawdown?.peak_date ? `${st.drawdown.peak_date} → ${st.drawdown.trough_date}` : '',
                ],
              ].map(([label, v, sub]) => (
                <div key={label} className="bg-slate-950/60 rounded-lg px-3 py-2">
                  <div className="text-slate-400 text-[11px]">{label}</div>
                  <div className="mono text-base font-bold text-white">{v}</div>
                  <div className="text-[10px] text-slate-500">{sub}</div>
                </div>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs mono">
                <thead className="text-slate-400">
                  <tr className="border-b border-slate-800">
                    <th className="text-left py-1.5 font-normal font-sans" />
                    {PERIODS.map(([k, l]) => (
                      <th key={k} className="text-right font-normal font-sans">
                        {l}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['投資組合（含息）', st.periods],
                    [d.benchmark.name, d.benchmark.periods],
                  ].map(([label, per]) => (
                    <tr key={label} className="border-b border-slate-800/60">
                      <td className="py-1.5 font-sans text-slate-300">{label}</td>
                      {PERIODS.map(([k]) => (
                        <td key={k} className={`text-right ${upDown(per?.[k])}`}>
                          {per?.[k] == null ? '--' : signed(per[k], 2, '%')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
              與大盤比較・區間：
              {RANGES.map(([k, l]) => (
                <Btn key={k} tone={s.range === k ? 'sky' : 'slate'} onClick={() => set({ range: k })} disabled={!d.chart[k]}>
                  {l}
                </Btn>
              ))}
            </div>
            <PctChart rows={d.chart[s.range]} />
          </Card>
        )}

        {st && (
          <Card
            title="③ 未來資產預估與歷史回測"
            tip="未來預估：用上面三種參考報酬率，月初投入、按月複利。歷史回測：用真實含息價格，過去 N 年第一天投入期初金額，之後每月第一個交易日照比例投入、不賣出。"
          >
            {calc.err && <div className="text-xs text-rose-300">⚠️ {calc.err}</div>}
            {proj?.table && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs mono">
                  <thead className="text-slate-400">
                    <tr className="border-b border-slate-800">
                      <th className="text-left py-1.5 font-normal">年數</th>
                      <th className="text-right font-normal">累積投入</th>
                      {proj.req.labels.map((l, i) => (
                        <th key={l} className="text-right font-normal">
                          {l} {pct(proj.req.rates[i])}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {proj.table.map((row) => (
                      <tr key={row.years} className="border-b border-slate-800/60">
                        <td className="py-1.5 text-slate-300">{row.years} 年</td>
                        <td className="text-right text-slate-400">{big(row.principal)}</td>
                        {row.values.map((v, i) => (
                          <td key={proj.req.labels[i]} className="text-right text-white">
                            {big(v)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {proj?.curve && (
              <LineChart
                points={proj.curve}
                xKey="year"
                xLabel="第幾年"
                lines={[
                  {
                    key: 'value',
                    color: '#f59e0b',
                    label: `預估資產（${proj.req.labels[0]} ${pct(proj.req.rates[0])}）`,
                  },
                  { key: 'principal', color: '#94a3b8', label: '累積投入', dash: true },
                ]}
              />
            )}
            {d.backtest.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-xs mono">
                  <thead className="text-slate-400">
                    <tr className="border-b border-slate-800">
                      <th className="text-left py-1.5 font-normal">如果從</th>
                      <th className="text-right font-normal">累積投入</th>
                      <th className="text-right font-normal">現在價值</th>
                      <th className="text-right font-normal">總報酬率</th>
                      <th className="text-right font-normal">年化（XIRR）</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.backtest.map((b) => (
                      <tr key={b.years} className="border-b border-slate-800/60">
                        <td className="py-1.5 text-slate-300">
                          {b.years} 年前（{b.from}）
                        </td>
                        <td className="text-right text-slate-400">{big(b.invested, d.input_currency)}</td>
                        <td className="text-right text-white">{big(b.value, d.input_currency)}</td>
                        <td className={`text-right ${upDown(b.return_pct)}`}>{signed(b.return_pct, 2, '%')}</td>
                        <td className={`text-right ${upDown(b.xirr_pct)}`}>{signed(b.xirr_pct, 2, '%')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-xs text-slate-400">每月定額與期初投入都是 0，或資料不足 1 年，沒有歷史回測。</div>
            )}
            <div className="flex flex-wrap gap-2">
              <Btn onClick={() => copyText(summary())}>📋 複製試算結果</Btn>
            </div>
            <div className="text-[11px] text-slate-500">
              過去報酬不代表未來；外幣標的以原幣報酬計算、未含匯率；未扣交易手續費與二代健保。本頁是試算工具，不是投資建議。
            </div>
          </Card>
        )}

        <CompareCard s={s} set={set} res={res} run={run} />
      </>
    );
  }

  // 多組並排比較：勾選要比較的組合，沒算過或內容改過的會重新計算
  function CompareCard({ s, set, res, run }) {
    const { Card, Btn, pct } = window.TA.savingsUI;
    const picked = s.list.filter((x) => s.compare.includes(x.id));
    const toggle = (id) =>
      set((old) => ({
        compare: old.compare.includes(id) ? old.compare.filter((x) => x !== id) : [...old.compare, id],
      }));
    const refresh = () => {
      for (const x of picked) {
        const r = res[x.id];
        if (!r?.loading && r?.key !== JSON.stringify(reqOf(x, s))) run(x);
      }
    };
    if (s.list.length < 2) return null;
    return (
      <Card
        title="④ 多組並排比較"
        tip="勾選要比較的組合後按「比較」。每個組合用它自己的期初投入與每月定額。"
        extra={
          <Btn tone="sky" onClick={refresh} disabled={!picked.length}>
            比較
          </Btn>
        }
      >
        <div className="flex flex-wrap gap-3 text-xs text-slate-300">
          {s.list.map((x) => (
            <label key={x.id} className="flex items-center gap-1 cursor-pointer">
              <input type="checkbox" checked={s.compare.includes(x.id)} onChange={() => toggle(x.id)} />
              {x.name}
            </label>
          ))}
        </div>
        {picked.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs mono">
              <thead className="text-slate-400">
                <tr className="border-b border-slate-800">
                  <th className="text-left py-1.5 font-normal font-sans">組合</th>
                  <th className="text-right font-normal">歷史</th>
                  <th className="text-right font-normal">穩定</th>
                  <th className="text-right font-normal">較差</th>
                  <th className="text-right font-normal">年化波動</th>
                  <th className="text-right font-normal">最大回撤</th>
                  <th className="text-right font-normal">近1年</th>
                  <th className="text-right font-normal">近3年</th>
                  <th className="text-right font-normal">資料起始</th>
                </tr>
              </thead>
              <tbody>
                {picked.map((x) => {
                  const r = res[x.id];
                  const st = r?.data?.stats;
                  const stale = r?.key && r.key !== JSON.stringify(reqOf(x, s));
                  return (
                    <tr key={x.id} className="border-b border-slate-800/60">
                      <td className="py-1.5 font-sans text-slate-200">
                        {x.name}
                        {r?.loading && <span className="text-slate-500">（計算中…）</span>}
                        {stale && !r?.loading && <span className="text-amber-300">（已修改，按比較更新）</span>}
                        {r?.err && <div className="text-rose-300 text-[10px]">{r.err}</div>}
                      </td>
                      {st ? (
                        <>
                          <td className="text-right text-white">{pct(st.cagr)}</td>
                          <td className="text-right">{pct(st.rolling_median)}</td>
                          <td className="text-right">{pct(st.rolling_p20)}</td>
                          <td className="text-right">{pct(st.volatility_pct)}</td>
                          <td className="text-right text-emerald-400">
                            {st.drawdown?.pct ? `-${fmt(st.drawdown.pct, 2)}%` : '--'}
                          </td>
                          <td className={`text-right ${upDown(st.periods?.['1y'])}`}>{pct(st.periods?.['1y'])}</td>
                          <td className={`text-right ${upDown(st.periods?.['3y'])}`}>{pct(st.periods?.['3y'])}</td>
                          <td className="text-right text-slate-400">{st.first_date}</td>
                        </>
                      ) : (
                        <td colSpan={8} className="text-right text-slate-500">
                          {r?.loading ? '' : '尚未計算'}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="text-[11px] text-slate-500">
          資料起始日不同的組合，報酬率涵蓋的市場期間也不同（例如只有近 3 年資料的組合沒經歷過 2022 年的下跌），比較時要留意。
        </div>
      </Card>
    );
  }

  // ---------- 實際對帳 ----------
  const LEDGER_DEFAULTS = {
    rows: [{ id: 'l1', name: '計畫 1', start: '', invested: 0, value: 0, dividends: 0 }],
  };

  function LedgerTab() {
    const { Card, Btn, useCalc, inputCls, copyText } = window.TA.savingsUI;
    const [s, set] = usePersist(LS_LEDGER, LEDGER_DEFAULTS);
    const calc = useCalc({
      kind: 'ledger',
      rows: s.rows.map(({ name, start, invested, value, dividends }) => ({
        name,
        start: start || null,
        invested: invested || 0,
        value: value || 0,
        dividends: dividends || 0,
      })),
    });
    const r = calc.err ? null : calc.res;
    const patchRow = (id, patch) => set((old) => ({ rows: old.rows.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
    // 對應的投資組合：投資組合頁「帶到實際對帳」會自動填；也可以自己選，按「看組合」切過去
    const ports = { ...PORT_DEFAULTS, ...readLS(LS_PORT, {}) }.list;
    const goPortfolio = (id) => {
      writeLS(LS_PORT, { ...PORT_DEFAULTS, ...readLS(LS_PORT, {}), active: id });
      window.dispatchEvent(new CustomEvent('savings-action', { detail: { tab: 'portfolio' } }));
    };
    const num = (row, key) => (
      <input
        type="number"
        value={row[key]}
        onChange={(e) => patchRow(row.id, { [key]: e.target.value === '' ? '' : Number(e.target.value) })}
        className={`${inputCls} w-28 text-right`}
      />
    );
    const cells = (x) => [
      <td key="pnl" className={`text-right ${upDown(x?.pnl)}`}>
        {x ? signed(x.pnl, 0) : '--'}
      </td>,
      <td key="ret" className={`text-right ${upDown(x?.return_pct)}`}>
        {x?.return_pct == null ? '--' : signed(x.return_pct, 2, '%')}
      </td>,
      <td key="div" className={`text-right ${upDown(x?.return_with_div_pct)}`}>
        {x?.return_with_div_pct == null ? '--' : signed(x.return_with_div_pct, 2, '%')}
      </td>,
      <td key="irr" className={`text-right ${upDown(x?.xirr_pct)}`}>
        {x?.xirr_pct == null ? '--' : signed(x.xirr_pct, 2, '%')}
      </td>,
    ];
    const summary = () =>
      r
        ? [
            ...r.rows.map(
              (x) =>
                `${x.name || '未命名'}：投資 ${fmt(x.invested, 0)}、市值 ${fmt(x.value, 0)}、配息 ${fmt(x.dividends, 0)} → 報酬率 ${signed(x.return_pct, 2, '%')}、含息 ${signed(x.return_with_div_pct, 2, '%')}、年化 ${signed(x.xirr_pct, 2, '%')}`,
            ),
            `合計：投資 ${fmt(r.total.invested, 0)}、市值 ${fmt(r.total.value, 0)}、配息 ${fmt(r.total.dividends, 0)} → 報酬率 ${signed(r.total.return_pct, 2, '%')}、含息 ${signed(r.total.return_with_div_pct, 2, '%')}、年化 ${signed(r.total.xirr_pct, 2, '%')}${r.total.xirr_excluded ? `（年化不含 ${r.total.xirr_excluded} 個沒填開始日的計畫）` : ''}`,
          ].join('\n')
        : '';

    return (
      <Card
        title="實際對帳（多個存股計畫加總）"
        tip="照銀行或券商 App 的「投資現況」填：投資金額 A、參考市值 B、已入帳現金配息 C。報酬率＝(B−A)÷A，含息報酬率＝(B−A+C)÷A。"
        extra={
          <Btn
            onClick={() =>
              set((old) => ({
                rows: [
                  ...old.rows,
                  { id: newId(), name: `計畫 ${old.rows.length + 1}`, start: '', invested: 0, value: 0, dividends: 0 },
                ],
              }))
            }
          >
            ＋ 加一個計畫
          </Btn>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-xs mono">
            <thead className="text-slate-400">
              <tr className="border-b border-slate-800 font-sans">
                <th className="text-left py-1.5 font-normal">名稱</th>
                <th className="text-left font-normal">開始扣款日</th>
                <th className="text-right font-normal">投資金額 A</th>
                <th className="text-right font-normal">參考市值 B</th>
                <th className="text-right font-normal">已入帳配息 C</th>
                <th className="text-right font-normal">參考損益</th>
                <th className="text-right font-normal">報酬率</th>
                <th className="text-right font-normal">含息報酬率</th>
                <th className="text-right font-normal">年化（估）</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {s.rows.map((row, i) => (
                <tr key={row.id} className="border-b border-slate-800/60">
                  <td className="py-1 pr-2">
                    <input
                      value={row.name}
                      onChange={(e) => patchRow(row.id, { name: e.target.value })}
                      className={`${inputCls} w-28 font-sans`}
                      aria-label="計畫名稱"
                    />
                    <div className="flex items-center gap-1 mt-1 font-sans">
                      <select
                        value={ports.some((x) => x.id === row.portfolio) ? row.portfolio : ''}
                        onChange={(e) => patchRow(row.id, { portfolio: e.target.value })}
                        className="bg-slate-950 border border-slate-700 rounded px-1 py-0.5 text-[10px] text-slate-300 w-24"
                        aria-label="對應的投資組合"
                      >
                        <option value="">不對應組合</option>
                        {ports.map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.name}
                          </option>
                        ))}
                      </select>
                      {ports.some((x) => x.id === row.portfolio) && (
                        <button
                          type="button"
                          onClick={() => goPortfolio(row.portfolio)}
                          className="text-[10px] text-sky-300 underline cursor-pointer"
                        >
                          看組合
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="pr-2">
                    <input
                      type="date"
                      value={row.start}
                      onChange={(e) => patchRow(row.id, { start: e.target.value })}
                      className={`${inputCls} w-36`}
                    />
                  </td>
                  <td className="text-right">{num(row, 'invested')}</td>
                  <td className="text-right">{num(row, 'value')}</td>
                  <td className="text-right">{num(row, 'dividends')}</td>
                  {cells(r?.rows[i])}
                  <td className="text-right">
                    <button
                      type="button"
                      onClick={() => set((old) => ({ rows: old.rows.filter((x) => x.id !== row.id) }))}
                      className="text-slate-500 hover:text-rose-300 cursor-pointer px-1"
                      title="刪除這個計畫"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
              {r && s.rows.length > 1 && (
                <tr className="font-bold">
                  <td className="py-1.5 font-sans text-white" colSpan={2}>
                    合計
                  </td>
                  <td className="text-right text-white">{fmt(r.total.invested, 0)}</td>
                  <td className="text-right text-white">{fmt(r.total.value, 0)}</td>
                  <td className="text-right text-white">{fmt(r.total.dividends, 0)}</td>
                  {cells(r.total)}
                  <td />
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {calc.err && <div className="text-xs text-rose-300">⚠️ {calc.err}</div>}
        {r?.total?.xirr_excluded > 0 && s.rows.length > 1 && (
          <div className="text-[11px] text-amber-300">
            合計的年化（估）不含 {r.total.xirr_excluded} 個沒填開始扣款日的計畫（不知道從哪天開始存，無法換算年化）。
          </div>
        )}
        <div className="text-[11px] text-slate-400 leading-relaxed">
          報酬率是「累積」報酬，存的時間不同就不能直接比較；<b>年化（估）</b>假設從開始扣款日起每月同一天等額投入、配息在今天入帳，
          用 XIRR 換算成每年報酬，可以拿來和其他計畫或定存比較。實際金額以銀行或券商對帳單為準。
        </div>
        {r && <Btn onClick={() => copyText(summary())}>📋 複製對帳結果</Btn>}
      </Card>
    );
  }

  window.TA = Object.assign(window.TA || {}, { SavingsPortfolioTab: PortfolioTab, SavingsLedgerTab: LedgerTab });
})();
