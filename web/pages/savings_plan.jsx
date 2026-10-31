// 存股計畫頁：長期規劃（跟組合風控看「現在的持股風險」不同）。三個分頁：
// - 定期定額：每月存多少 → 未來資產（正推）／目標金額 → 每月要存多少（反推），報酬率用還權日 K 算的三種參考值
// - 股息試算：每月想領多少 → 各高股息 ETF 需要的本金，附規模與近 3 年總報酬
// - 生命週期：存到退休、退休後每月可領多少，並換算成今天的錢
// 公式都在後端 src/portfolio/savings_plan.py（/api/savings/calc），這裡只負責輸入與顯示
(() => {
  const { useState, useEffect, useRef } = React;
  const { fmt, readLS, writeLS, normSym, baseCode, marketOf, currencyOf, Tip, LS_CART, twFee, orderLabel } =
    window.TA;

  const LS_KEY = 'tw_us_savings_plan_v1';
  const DEFAULTS = {
    tab: 'plan',
    symbol: '0050',
    mode: 'grow',
    monthly: 5000,
    initial: 0,
    target: 1000000,
    years: 20,
    custom: '',
    income: 30000,
    incomeMode: 'monthly',
    lumpSum: 10000000,
    age: 30,
    retireAge: 65,
    endAge: 100,
    lifeInitial: 500000,
    lifeMonthly: 20000,
    accumPct: 8,
    retirePct: 4,
    inflationPct: 2,
  };

  const post = (url, body) =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => r.json());

  // 萬元顯示（試算金額大，用「萬」比較好讀）
  const wan = (v) => (v === null || v === undefined ? '--' : `${fmt(v / 1e4, v >= 1e6 ? 0 : 1)} 萬`);
  const pct = (v) => (v === null || v === undefined ? '--' : `${fmt(v, 2)}%`);

  // 輸入停手 0.3 秒才送出計算。結果標上計算種類：切換正推／反推時，新結果回來前不拿舊格式的結果來畫
  function useCalc(body) {
    const [res, setRes] = useState(null);
    const [err, setErr] = useState('');
    const seq = useRef(0);
    const key = JSON.stringify(body);
    useEffect(() => {
      const req = JSON.parse(key);
      if (!req) return undefined;
      const t = setTimeout(() => {
        const mine = ++seq.current; // 連續修改時，比較晚送出的請求可能比較早回來：只採用最後一次
        post('/api/savings/calc', req)
          .then((d) => {
            if (mine !== seq.current) return;
            if (d.error) setErr(d.error);
            else {
              setErr('');
              setRes({ ...d, kind: req.kind, req });
            }
          })
          .catch((e) => setErr(e.message));
      }, 300);
      return () => clearTimeout(t);
    }, [key]);
    return { res: res && res.kind === body?.kind ? res : null, err };
  }

  const inputCls =
    'w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs mono text-white focus:border-sky-400 focus:outline-none';

  function Num({ label, value, onChange, step = 1, suffix, tip }) {
    return (
      <label className="block space-y-1 min-w-0">
        <span className="text-[11px] text-slate-400 flex items-center gap-1">
          {label}
          {suffix && <span className="text-slate-500">（{suffix}）</span>}
          {tip && <Tip text={tip} />}
        </span>
        <input
          type="number"
          step={step}
          value={value}
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
          className={inputCls}
        />
      </label>
    );
  }

  function Card({ title, tip, extra, children }) {
    return (
      <section className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 space-y-3 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold text-white">{title}</h2>
          {tip && <Tip text={tip} />}
          <div className="ml-auto flex flex-wrap items-center gap-2 text-[11px] text-slate-500">{extra}</div>
        </div>
        {children}
      </section>
    );
  }

  const Btn = ({ onClick, children, disabled, tone = 'slate' }) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`px-2.5 py-1 rounded text-xs cursor-pointer disabled:opacity-50 ${
        tone === 'sky'
          ? 'bg-sky-600 text-white hover:bg-sky-500'
          : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
      }`}
    >
      {children}
    </button>
  );

  const copyText = (text) =>
    navigator.clipboard
      ?.writeText(text)
      .then(() => window.TA.toast?.('已複製試算結果，可以貼到記事本或訊息'))
      .catch(() => window.TA.toast?.('⚠️ 無法存取剪貼簿'));

  // 簡單折線圖：x 為年或年齡，可畫多條線
  function LineChart({ points, xKey, lines, xLabel }) {
    if (!points?.length) return null;
    const W = 640;
    const H = 180;
    const pad = { l: 52, r: 10, t: 10, b: 22 };
    const maxY = Math.max(1, ...points.flatMap((p) => lines.map((l) => p[l.key] || 0)));
    const xs = points.map((p) => p[xKey]);
    const x0 = xs[0];
    const x1 = xs[xs.length - 1] === x0 ? x0 + 1 : xs[xs.length - 1];
    const px = (x) => pad.l + ((x - x0) / (x1 - x0)) * (W - pad.l - pad.r);
    const py = (y) => H - pad.b - (Math.max(0, y) / maxY) * (H - pad.t - pad.b);
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => maxY * f);
    const step = Math.max(1, Math.ceil(points.length / 8));
    return (
      <div className="space-y-1">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="資產變化圖">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={py(t)} y2={py(t)} stroke="#1e293b" />
              <text x={pad.l - 4} y={py(t) + 3} fontSize="9" fill="#64748b" textAnchor="end">
                {wan(t)}
              </text>
            </g>
          ))}
          {points
            .filter((_, i) => i % step === 0 || i === points.length - 1)
            .map((p) => (
              <text key={p[xKey]} x={px(p[xKey])} y={H - 6} fontSize="9" fill="#64748b" textAnchor="middle">
                {p[xKey]}
              </text>
            ))}
          {lines.map((l) => (
            <polyline
              key={l.key}
              fill="none"
              stroke={l.color}
              strokeWidth="2"
              strokeDasharray={l.dash ? '4 3' : undefined}
              points={points.map((p) => `${px(p[xKey])},${py(p[l.key] || 0)}`).join(' ')}
            />
          ))}
        </svg>
        <div className="flex flex-wrap gap-3 text-[11px] text-slate-400">
          <span>橫軸：{xLabel}</span>
          {lines.map((l) => (
            <span key={l.key} className="flex items-center gap-1">
              <span className="inline-block w-3 h-0.5" style={{ background: l.color }} />
              {l.label}
            </span>
          ))}
        </div>
      </div>
    );
  }

  // ---------- 說明 ----------
  function PlanHelp() {
    const H = ({ children }) => <b className="text-white">{children}</b>;
    return (
      <details className="bg-slate-900/70 border border-slate-800 rounded-2xl px-5 py-3 text-xs text-slate-300">
        <summary className="cursor-pointer font-semibold text-slate-200 select-none">
          📘 計算方式與注意事項
        </summary>
        <div className="mt-3 space-y-2 leading-relaxed">
          <p>
            <H>計算方式</H>：每月<b>月初</b>投入、退休後每月<b>月初</b>提領；月報酬率＝年報酬率 ÷ 12，按月複利。
            正推與反推用同一個公式，所以「每月存 X 會有多少」和「要有多少每月得存 X」一定對得起來。
          </p>
          <p>
            <H>三種參考報酬率</H>（含配息再投入；台股用 FinMind 上市以來日 K 加回除權息並還原股票分割，其他市場用 Yahoo
            完整歷史月資料）：<b>歷史報酬率</b>＝上市以來的年化報酬；<b>穩定報酬率</b>＝最近 15 年內任一天買進持有 5 年的年化報酬中位數；
            <b>較差報酬率</b>＝同樣的 5 年報酬裡排在後 20% 的那個值。上市不到 5 年的 ETF 沒有後兩項，會顯示「資料不足」。
            0050 算出 14.63%／13.53%／10.02%，與 CMoney 的 14.7%／13.6%／9.9% 相符。
          </p>
          <p>
            <H>股息試算</H>：所需本金＝每月想領 × 12 ÷ 殖利率（近 3 年平均）。實際會比試算少：
            單筆股利 2 萬元以上要扣 2.11% 二代健保補充保費，股利也要併入所得課稅。
            高股息 ETF 的配息可能含收益平準金，除息後也不一定填息，所以表格附上<b>近 3 年總報酬</b>，配息高但總報酬低就要留意。
          </p>
          <p>
            <H>換算成今天的錢</H>：名目金額 ÷ (1＋通膨率)^年數。30 年後的 1 萬元，購買力遠低於今天的 1 萬元。
          </p>
          <p className="text-slate-400">
            過去報酬不代表未來；本頁是試算工具，不是投資建議。「加入下單暫存匣」只是模擬委託，不會真的下單。
          </p>
        </div>
      </details>
    );
  }

  // ---------- 參考報酬率 ----------
  function useReturns(symbol) {
    const [st, setSt] = useState({ data: null, err: '', loading: false });
    const load = (sym) => {
      if (!sym) return;
      setSt((s) => ({ ...s, loading: true, err: '' }));
      post('/api/savings/returns', { symbol: sym })
        .then((d) => setSt({ data: d.error ? null : d, err: d.error || '', loading: false }))
        .catch((e) => setSt({ data: null, err: e.message, loading: false }));
    };
    useEffect(() => load(symbol), [symbol]);
    return { ...st, reload: () => load(symbol) };
  }

  const rateList = (ret, custom) => {
    const out = [];
    if (custom !== '' && custom !== null && !Number.isNaN(Number(custom)))
      out.push({ label: '自訂', pct: Number(custom) });
    if (ret?.cagr != null) out.push({ label: '歷史', pct: ret.cagr });
    if (ret?.rolling_median != null) out.push({ label: '穩定', pct: ret.rolling_median });
    if (ret?.rolling_p20 != null) out.push({ label: '較差', pct: ret.rolling_p20 });
    return out;
  };

  function ReturnsCard({ s, set, ret }) {
    const [input, setInput] = useState(s.symbol);
    useEffect(() => setInput(s.symbol), [s.symbol]); // 從其他頁或比較表換標的時同步輸入框
    const d = ret.data;
    return (
      <Card
        title="① 選擇存股標的"
        tip="報酬率用這檔的還權日 K 計算（含配息再投入）。也可以直接填「自訂報酬率」，不選標的。"
      >
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const v = input.trim();
            if (v === s.symbol) ret.reload();
            else set({ symbol: v });
          }}
        >
          <label className="space-y-1">
            <span className="text-[11px] text-slate-400 block">代號（台股、美股都可以）</span>
            <input value={input} onChange={(e) => setInput(e.target.value)} className={`${inputCls} w-32`} />
          </label>
          <Btn tone="sky" disabled={ret.loading}>
            {ret.loading ? '計算中…' : '取得報酬率'}
          </Btn>
          {['0050', '006208', '00878', 'VOO'].map((x) => (
            <Btn
              key={x}
              onClick={() => {
                setInput(x);
                set({ symbol: x });
              }}
            >
              {x}
            </Btn>
          ))}
          <div className="w-28">
            <Num
              label="自訂報酬率"
              suffix="%"
              step={0.1}
              value={s.custom}
              onChange={(v) => set({ custom: v })}
            />
          </div>
        </form>
        {ret.err && <div className="text-xs text-rose-300">⚠️ {ret.err}</div>}
        {d && (
          <div className="space-y-2">
            <div className="text-xs text-slate-300">
              <b className="text-white">{d.name}</b>（{d.symbol}）現價 {fmt(d.price, 2)}・資料 {d.first_date} 起約{' '}
              {d.years} 年
              <button
                type="button"
                onClick={() => window.TA.openInWatch?.(d.symbol)}
                className="ml-2 text-sky-300 hover:underline cursor-pointer"
              >
                到看盤頁看這檔 →
              </button>
              <div className="text-[10px] text-slate-500">資料來源：{d.data_source}</div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
              {[
                ['歷史報酬率', d.cagr, `上市以來 ${d.years} 年年化`],
                ['穩定報酬率', d.rolling_median, '近 15 年持有 5 年中位數'],
                ['較差報酬率', d.rolling_p20, '近 15 年持有 5 年第 20 百分位'],
                ['近 3 年平均殖利率', d.avg_yield_pct, d.avg_yield_years ? `${d.avg_yield_years} 年平均` : ''],
                ['近 3 年總報酬', d.total_3y, '含配息'],
              ].map(([label, v, note]) => (
                <div key={label} className="bg-slate-950/60 rounded-lg px-3 py-2">
                  <div className="text-slate-400 text-[11px]">{label}</div>
                  <div className="mono text-base font-bold text-white">{v == null ? '資料不足' : pct(v)}</div>
                  <div className="text-[10px] text-slate-500">{note}</div>
                </div>
              ))}
            </div>
            {d.warning && <div className="text-xs text-amber-300">⚠️ {d.warning}</div>}
          </div>
        )}
      </Card>
    );
  }

  // ---------- ② 定期定額 ----------
  function PlanTab({ s, set, ret }) {
    const rates = rateList(ret.data, s.custom);
    const grow = s.mode === 'grow';
    const calc = useCalc(
      rates.length
        ? grow
          ? {
              kind: 'grow',
              monthly: s.monthly || 0,
              initial: s.initial || 0,
              years: s.years || 1,
              rates: rates.map((r) => r.pct),
              labels: rates.map((r) => r.label),
            }
          : {
              kind: 'target',
              target: s.target || 1,
              initial: s.initial || 0,
              rates: rates.map((r) => r.pct),
              labels: rates.map((r) => r.label),
            }
        : null,
    );
    const res = rates.length ? calc.res : null;
    // 表格欄位用「這份結果當時算的報酬率」：換標的後新結果回來前，欄位數可能和目前選的不同
    // （例如 0050 有三種、00919 上市未滿 5 年只有歷史報酬率），不能拿目前的 rates 去對舊結果
    const shownRates = res ? res.req.labels.map((label, i) => ({ label, pct: res.req.rates[i] })) : rates;
    const d = ret.data;

    // 換算成零股或美股股數，加入看盤頁的下單暫存匣（模擬委託）
    const addToCart = () => {
      if (!d?.price || !(s.monthly > 0)) return;
      const tw = marketOf(d.symbol) === 'TW';
      // 每月金額是台幣、外幣標的現價是原幣：先換成台幣價格再算股數
      const rate = tw ? 1 : d.fx_to_twd;
      if (!rate) {
        window.TA.toast?.(`⚠️ 取不到 ${d.currency || '外幣'} 兌台幣匯率，無法換算 ${d.name} 的股數`);
        return;
      }
      const twdPrice = d.price * rate;
      const qty = tw ? Math.floor(s.monthly / twdPrice) : Math.floor((s.monthly / twdPrice) * 1e4) / 1e4;
      if (!(qty > 0)) {
        window.TA.toast?.(`⚠️ 每月 ${fmt(s.monthly, 0)} 元買不到 1 股 ${d.name}（現價 ${fmt(d.price, 2)}）`);
        return;
      }
      const amount = qty * d.price; // 委託金額用原幣（跟看盤頁暫存匣其他委託一致）
      const item = {
        id: Date.now(),
        symbol: tw ? baseCode(d.symbol) : normSym(d.symbol),
        name: d.name,
        market: marketOf(d.symbol),
        side: 'BUY',
        price: d.price,
        qty,
        unit: '股',
        type: orderLabel({ tif: 'ROD', priceType: 'LIMIT', session: 'REGULAR', usType: 'LIMIT', usTif: 'ANY' }, tw),
        amount,
        fee: tw ? twFee(amount, false) : 0,
        tax: 0,
      };
      writeLS(LS_CART, [item, ...readLS(LS_CART, [])]);
      window.TA.notifySaved(
        `已把 ${d.name} 買進 ${qty} 股（約 ${fmt(qty * twdPrice, 0)} 元${tw ? '' : `，${d.currency} ${fmt(amount, 2)}`}）加入下單暫存匣（模擬，不會真的下單）`,
      );
    };

    const summary = () => {
      if (!res) return '';
      const head = `存股試算：${d ? `${d.name}（${d.symbol}）` : '自訂報酬率'}，初期投入 ${fmt(s.initial || 0, 0)} 元\n`;
      const cols = shownRates.map((r) => `${r.label} ${pct(r.pct)}`).join('｜');
      if (grow)
        return `${head}每月投入 ${fmt(s.monthly, 0)} 元（月初投入、按月複利）\n年數｜本金｜${cols}\n${res.table
          .map((r) => `${r.years} 年｜${wan(r.principal)}｜${r.values.map(wan).join('｜')}`)
          .join('\n')}`;
      return `${head}目標 ${wan(s.target)}，每月需要存\n年數｜${cols}\n${res.table
        .map((r) => `${r.years} 年｜${r.monthly.map((m) => `${fmt(m, 0)} 元`).join('｜')}`)
        .join('\n')}`;
    };

    return (
      <Card
        title="② 定期定額試算"
        extra={
          <>
            <Btn onClick={() => set({ mode: 'grow' })} tone={grow ? 'sky' : 'slate'}>
              每月存多少 → 未來資產
            </Btn>
            <Btn onClick={() => set({ mode: 'target' })} tone={grow ? 'slate' : 'sky'}>
              目標金額 → 每月要存
            </Btn>
          </>
        }
      >
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {grow ? (
            <Num label="每月投入" suffix="元" step={1000} value={s.monthly} onChange={(v) => set({ monthly: v })} />
          ) : (
            <Num label="目標金額" suffix="元" step={100000} value={s.target} onChange={(v) => set({ target: v })} />
          )}
          <Num label="初期投入" suffix="元" step={10000} value={s.initial} onChange={(v) => set({ initial: v })} />
          {grow && (
            <Num
              label="走勢圖年數"
              suffix="年"
              value={s.years}
              onChange={(v) => set({ years: v })}
              tip="下方走勢圖畫到第幾年（用第一個報酬率）"
            />
          )}
        </div>
        {!rates.length && (
          <div className="text-xs text-slate-400">請先在 ① 取得報酬率，或填「自訂報酬率」。</div>
        )}
        {calc.err && rates.length > 0 && <div className="text-xs text-rose-300">⚠️ {calc.err}</div>}
        {res?.table && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs mono">
              <thead className="text-slate-400">
                <tr className="border-b border-slate-800">
                  <th className="text-left py-1.5 font-normal">年數</th>
                  {grow && <th className="text-right font-normal">投入本金</th>}
                  {shownRates.map((r) => (
                    <th key={r.label} className="text-right font-normal">
                      {r.label} {pct(r.pct)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {res.table.map((row) => (
                  <tr key={row.years} className="border-b border-slate-800/60">
                    <td className="py-1.5 text-slate-300">{row.years} 年</td>
                    {grow && <td className="text-right text-slate-400">{wan(row.principal)}</td>}
                    {(grow ? row.values : row.monthly).map((v, i) => (
                      <td key={shownRates[i].label} className="text-right text-white">
                        {grow ? wan(v) : `${fmt(v, 0)} 元／月`}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {grow && res?.curve && (
          <LineChart
            points={res.curve}
            xKey="year"
            xLabel="第幾年"
            lines={[
              { key: 'value', color: '#38bdf8', label: `資產（${shownRates[0].label} ${pct(shownRates[0].pct)}）` },
              { key: 'principal', color: '#94a3b8', label: '投入本金', dash: true },
            ]}
          />
        )}
        <div className="flex flex-wrap gap-2">
          {grow && d?.price && (
            <Btn tone="sky" onClick={addToCart}>
              ⬇️ 把這個月的 {fmt(s.monthly, 0)} 元加入下單暫存匣
            </Btn>
          )}
          {res && <Btn onClick={() => copyText(summary())}>📋 複製試算結果</Btn>}
        </div>
      </Card>
    );
  }

  // ---------- 股息試算 ----------
  function IncomeTab({ s, set }) {
    const [data, setData] = useState(null);
    const [err, setErr] = useState('');
    const [loading, setLoading] = useState(false);
    // 兩種問法：每月想領多少 → 要存多少本金；一次投入多少 → 每月可領多少
    const lumpMode = s.incomeMode === 'lump';
    const income = s.income || 0;
    const lump = s.lumpSum || 0;
    const amountKey = lumpMode ? `L${lump}` : `M${income}`;
    const seq = useRef(0);
    // 停手 0.5 秒才重算；s.symbol 只影響比較清單，換代號不必重抓
    useEffect(() => {
      if (!((lumpMode ? lump : income) > 0)) return undefined;
      const t = setTimeout(() => {
        const mine = ++seq.current; // 第一次要 30 秒，期間又改金額：舊的結果晚回來時不採用
        setLoading(true);
        window.TA.postJob(
          '/api/savings/dividends',
          lumpMode ? { lump_sum: lump, symbols: [s.symbol] } : { monthly_income: income, symbols: [s.symbol] },
        )
          .then((d) => {
            if (mine !== seq.current) return;
            setErr(d.error || '');
            if (!d.error) setData(d);
          })
          .catch((e) => mine === seq.current && setErr(e.message))
          .finally(() => mine === seq.current && setLoading(false));
      }, 500);
      return () => clearTimeout(t);
    }, [amountKey]);
    // 新結果回來前不拿另一種問法的結果來畫
    const shown = data && (lumpMode ? data.lump_sum > 0 : !data.lump_sum) ? data : null;
    const mine = (shown?.rows || []).find((r) => r.symbol === s.symbol);

    const rows = (shown?.rows || [])
      .slice()
      .sort((a, b) => (b.avg_yield_pct ?? b.ttm_yield_pct ?? -1) - (a.avg_yield_pct ?? a.ttm_yield_pct ?? -1));

    return (
      <Card
        title="股息現金流試算"
        tip="所需本金＝每月想領 × 12 ÷ 近 3 年平均殖利率；每月可領＝一次投入 × 殖利率 ÷ 12。依近 3 年平均殖利率排序；規模未達 100 億的標灰色。點 ETF 名稱可以直接用那一檔做定期定額試算。"
        extra={
          <>
            {loading && <span>計算中（第一次約需 30～40 秒，之後 6 小時內很快）…</span>}
            <Btn onClick={() => set({ incomeMode: 'monthly' })} tone={lumpMode ? 'slate' : 'sky'}>
              每月想領
            </Btn>
            <Btn onClick={() => set({ incomeMode: 'lump' })} tone={lumpMode ? 'sky' : 'slate'}>
              一次投入
            </Btn>
          </>
        }
      >
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {lumpMode ? (
            <Num
              label="一次投入"
              suffix="元"
              step={100000}
              value={s.lumpSum}
              onChange={(v) => set({ lumpSum: v })}
            />
          ) : (
            <Num label="每月想領" suffix="元" step={1000} value={s.income} onChange={(v) => set({ income: v })} />
          )}
        </div>
        {mine && (
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 bg-slate-950/60 rounded-lg px-3 py-2">
            <span className="text-xs text-slate-300">
              {mine.name}（{mine.symbol}）近 3 年平均殖利率 {pct(mine.avg_yield_pct)}｜{mine.frequency}
            </span>
            <span className="text-xs text-slate-400">{lumpMode ? '每月可領' : '總共需存入'}</span>
            <span className="mono text-xl font-bold text-amber-200">
              {lumpMode ? `${fmt(mine.monthly_from_lump, 0)} 元` : wan(mine.capital_needed)}
            </span>
          </div>
        )}
        {err && <div className="text-xs text-rose-300">⚠️ {err}</div>}
        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs mono">
              <thead className="text-slate-400">
                <tr className="border-b border-slate-800">
                  <th className="text-left py-1.5 font-normal">ETF</th>
                  <th className="text-right font-normal">近 3 年平均殖利率</th>
                  <th className="text-right font-normal">近 12 月殖利率</th>
                  <th className="text-right font-normal">配息</th>
                  <th className="text-right font-normal">近 3 年總報酬</th>
                  <th className="text-right font-normal">規模</th>
                  <th className="text-right font-normal">{lumpMode ? '每月可領' : '需要本金'}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const small = r.aum_billion != null && r.aum_billion < 100;
                  return (
                    <tr
                      key={r.symbol}
                      className={`border-b border-slate-800/60 ${small ? 'text-slate-500' : 'text-white'}`}
                    >
                      <td className="py-1.5 font-sans">
                        <button
                          type="button"
                          onClick={() => set({ symbol: r.symbol, tab: 'plan' })}
                          title="用這檔做定期定額試算"
                          className="hover:text-sky-300 hover:underline cursor-pointer text-left"
                        >
                          {r.name}
                        </button>{' '}
                        <span className="text-slate-500 mono">{r.symbol}</span>
                        {r.symbol === s.symbol && <span className="ml-1 text-sky-300">（你選的）</span>}
                        {r.error && <div className="text-rose-300 text-[10px]">{r.error}</div>}
                      </td>
                      <td className="text-right">
                        {pct(r.avg_yield_pct)}
                        {r.avg_yield_years && r.avg_yield_years < 3 && (
                          <span className="text-[10px] text-slate-500">（{r.avg_yield_years} 年）</span>
                        )}
                      </td>
                      <td className="text-right">{pct(r.ttm_yield_pct)}</td>
                      <td className="text-right font-sans">{r.frequency || '--'}</td>
                      <td
                        className={`text-right ${r.total_3y == null ? '' : r.total_3y < 0 ? 'text-emerald-400' : 'text-rose-400'}`}
                      >
                        {r.total_3y == null ? '未滿 3 年' : pct(r.total_3y)}
                      </td>
                      <td className="text-right">{r.aum_billion == null ? '--' : `${fmt(r.aum_billion, 0)} 億`}</td>
                      <td className="text-right font-bold">
                        {lumpMode ? `${fmt(r.monthly_from_lump, 0)} 元` : wan(r.capital_needed)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="text-[11px] text-slate-400 leading-relaxed">
          ⚠️ 試算未扣稅：單筆股利 2 萬元以上扣 2.11% 二代健保補充保費，股利併入所得課稅，實際月領會比較少。
          配息高不代表賺得多：總報酬（含配息）偏低，代表配息可能來自本金或沒有填息。
        </div>
        {rows.length > 0 && (
          <Btn
            onClick={() =>
              copyText(
                `股息試算：${lumpMode ? `一次投入 ${fmt(lump, 0)} 元` : `每月想領 ${fmt(income, 0)} 元`}\n${rows
                  .map(
                    (r) =>
                      `${r.name}（${r.symbol}）近 3 年平均殖利率 ${pct(r.avg_yield_pct)}（${r.frequency}）、近 3 年總報酬 ${pct(r.total_3y)} → ${
                        lumpMode ? `每月可領 ${fmt(r.monthly_from_lump, 0)} 元` : `需要本金 ${wan(r.capital_needed)}`
                      }`,
                  )
                  .join('\n')}`,
              )
            }
          >
            📋 複製試算結果
          </Btn>
        )}
      </Card>
    );
  }

  // 「我的持股」每一筆的台幣市值（現價 × 股數，外幣換成台幣）。生命週期與投資組合分頁共用。
  // 跟看盤頁「我的持股」同一套算法，總市值才對得起來：價格依那裡選的「即時價／昨收」，
  // 計價幣別用報價的（沒有就由代號判斷），沒有報價時用成本價，取不到匯率的那筆不計入。
  async function holdingsValues() {
    const hs = readLS('tw_us_holdings_v1', []).filter((h) => h?.symbol && Number(h.shares) > 0);
    if (!hs.length) return { rows: [], total: 0, missing: 0, basis: 'live' };
    const basis = readLS('tw_us_hold_basis_v1', 'live');
    const syms = [...new Set(hs.map((h) => normSym(h.symbol)))].slice(0, 40);
    const q = await post('/api/quotes', { symbols: syms });
    const bySym = Object.fromEntries((q.quotes || []).filter(Boolean).map((x) => [baseCode(x.symbol), x]));
    const curOf = (h) => bySym[baseCode(h.symbol)]?.currency || currencyOf(h.symbol);
    const curs = [...new Set(hs.map(curOf).filter((c) => c && c !== 'TWD'))];
    const fx = curs.length ? (await post('/api/fx', { currencies: curs })).rates || {} : {};
    let total = 0;
    let missing = 0;
    const rows = hs.map((h) => {
      const x = bySym[baseCode(h.symbol)];
      const quoted = basis === 'prev' ? (x?.prev_close ?? x?.price) : x?.price;
      const price = quoted || Number(h.cost) || 0;
      const cur = curOf(h);
      const rate = cur === 'TWD' ? 1 : fx[cur]?.rate;
      if (!quoted || !rate) missing += 1;
      const value = rate ? price * Number(h.shares) * rate : 0;
      total += value;
      // 成本也換成台幣（外幣用目前匯率，不是買進當時的匯率）
      const cost = rate ? (Number(h.cost) || 0) * Number(h.shares) * rate : 0;
      return {
        symbol: h.symbol,
        key: baseCode(normSym(h.symbol)),
        name: x?.name || h.name || h.symbol,
        shares: Number(h.shares),
        value,
        cost,
      };
    });
    return { rows, total, missing, basis };
  }

  // ---------- 生命週期 ----------
  function LifeTab({ s, set, ret }) {
    const calc = useCalc({
      kind: 'life',
      age: s.age || 0,
      retire_age: s.retireAge || 0,
      end_age: s.endAge || 0,
      initial: s.lifeInitial || 0,
      monthly: s.lifeMonthly || 0,
      accum_pct: s.accumPct || 0,
      retire_pct: s.retirePct || 0,
      inflation_pct: s.inflationPct || 0,
    });
    const r = calc.err ? null : calc.res;
    const [mv, setMv] = useState({ loading: false, note: '' });
    const stable = ret.data?.rolling_median ?? ret.data?.cagr;

    // 用「我的持股」目前市值當初期投入（報價 × 股數，外幣換成台幣）
    const fillFromHoldings = async () => {
      setMv({ loading: true, note: '' });
      try {
        const h = await holdingsValues();
        if (!h.rows.length) {
          setMv({ loading: false, note: '「我的持股」是空的' });
          return;
        }
        set({ lifeInitial: Math.round(h.total) });
        setMv({
          loading: false,
          note: `已帶入 ${h.rows.length} 筆持股市值 ${fmt(h.total, 0)} 元（${h.basis === 'prev' ? '昨收' : '即時價'}，跟看盤頁「我的持股」的設定相同）${h.missing ? `；${h.missing} 筆沒有報價或匯率，用成本價或不計入` : ''}`,
        });
      } catch (e) {
        setMv({ loading: false, note: `⚠️ ${e.message}` });
      }
    };

    return (
      <Card title="生命週期試算（存到退休 → 退休後提領）">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Num label="目前年齡" value={s.age} onChange={(v) => set({ age: v })} />
          <Num label="退休年齡" value={s.retireAge} onChange={(v) => set({ retireAge: v })} />
          <Num
            label="預估壽命（領到幾歲）"
            value={s.endAge}
            onChange={(v) => set({ endAge: v })}
            tip="到這個年紀剛好把錢領完；想保守一點就填大一點"
          />
          <Num
            label="通膨率"
            suffix="%"
            step={0.1}
            value={s.inflationPct}
            onChange={(v) => set({ inflationPct: v })}
            tip="用來把未來的金額換算成今天的購買力"
          />
          <Num
            label="初期投入"
            suffix="元"
            step={10000}
            value={s.lifeInitial}
            onChange={(v) => set({ lifeInitial: v })}
          />
          <Num
            label="每月投入"
            suffix="元"
            step={1000}
            value={s.lifeMonthly}
            onChange={(v) => set({ lifeMonthly: v })}
          />
          <Num
            label="累積期年報酬率"
            suffix="%"
            step={0.1}
            value={s.accumPct}
            onChange={(v) => set({ accumPct: v })}
          />
          <Num
            label="退休後年報酬率"
            suffix="%"
            step={0.1}
            value={s.retirePct}
            onChange={(v) => set({ retirePct: v })}
            tip="退休後通常改配較多債券或現金，報酬率預設比累積期保守"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Btn onClick={fillFromHoldings} disabled={mv.loading}>
            {mv.loading ? '計算持股市值中…' : '用目前持股市值當初期投入'}
          </Btn>
          {stable != null && (
            <Btn onClick={() => set({ accumPct: stable })}>
              累積期改用 {ret.data.name} 的{ret.data.rolling_median != null ? '穩定' : '歷史'}報酬率 {pct(stable)}
            </Btn>
          )}
          {mv.note && <span className="text-slate-400">{mv.note}</span>}
        </div>
        {s.age > 0 && (
          <div className="text-[11px] text-slate-500">
            常見的配置參考：股票比例 ≈ 110 − 年齡（{s.age} 歲約 {Math.max(0, Math.min(100, 110 - s.age))}%
            股票，其餘放債券或現金）。越接近退休，報酬率假設越該保守。
          </div>
        )}
        {calc.err && <div className="text-xs text-rose-300">⚠️ {calc.err}</div>}
        {r && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
              {[
                ['退休前儲蓄', wan(r.principal), `存 ${r.years_saving} 年的本金`],
                ['投資獲利', wan(r.at_retire - r.principal), '退休時資產 − 儲蓄'],
                ['退休時資產', wan(r.at_retire), `≈ 今天的 ${wan(r.at_retire_today)}`],
                ['退休後每月可領', `${fmt(r.monthly_payout, 0)} 元`, `≈ 今天的 ${fmt(r.monthly_payout_today, 0)} 元`],
                ['退休後共領', wan(r.total_payout), `${r.years_retired} 年`],
              ].map(([label, v, note]) => (
                <div key={label} className="bg-slate-950/60 rounded-lg px-3 py-2">
                  <div className="text-slate-400 text-[11px]">{label}</div>
                  <div className="mono text-base font-bold text-white">{v}</div>
                  <div className="text-[10px] text-amber-300/80">{note}</div>
                </div>
              ))}
            </div>
            <LineChart
              points={r.curve}
              xKey="age"
              xLabel="年齡"
              lines={[{ key: 'value', color: '#38bdf8', label: '資產（名目金額）' }]}
            />
            <Btn
              onClick={() =>
                copyText(
                  `生命週期試算：${s.age} 歲開始，初期 ${fmt(s.lifeInitial, 0)} 元、每月 ${fmt(s.lifeMonthly, 0)} 元，` +
                    `年報酬 ${pct(s.accumPct)}，${s.retireAge} 歲退休（退休後報酬 ${pct(s.retirePct)}），領到 ${s.endAge} 歲\n` +
                    `投入本金 ${wan(r.principal)}；退休時資產 ${wan(r.at_retire)}（今天的 ${wan(r.at_retire_today)}）\n` +
                    `每月可領 ${fmt(r.monthly_payout, 0)} 元（通膨 ${pct(s.inflationPct)} 換算成今天約 ${fmt(r.monthly_payout_today, 0)} 元）`,
                )
              }
            >
              📋 複製試算結果
            </Btn>
          </>
        )}
      </Card>
    );
  }

  const TABS = [
    ['plan', '定期定額'],
    ['portfolio', '投資組合'],
    ['income', '股息試算'],
    ['life', '生命週期'],
  ];

  function SavingsPlanPage() {
    const [s, setS] = useState(() => {
      const saved = { ...DEFAULTS, ...readLS(LS_KEY, {}) };
      // 上次停在已移除的分頁（例如舊版的實際對帳）時回到第一個分頁，不然整頁空白
      return TABS.some(([id]) => id === saved.tab) ? saved : { ...saved, tab: TABS[0][0] };
    });
    const first = useRef(true);
    useEffect(() => {
      if (first.current) {
        first.current = false;
        return;
      }
      writeLS(LS_KEY, s);
    }, [s]);
    const set = (patch) => setS((old) => ({ ...old, ...patch }));
    const ret = useReturns(s.symbol);
    // 新手導覽切到這頁時，順便切換到要介紹的分頁
    useEffect(() => {
      const on = (e) =>
        e.detail?.tab &&
        setS((old) => ({ ...old, tab: e.detail.tab, ...(e.detail.symbol ? { symbol: e.detail.symbol } : {}) }));
      window.addEventListener('savings-action', on);
      return () => window.removeEventListener('savings-action', on);
    }, []);

    return (
      <div className="space-y-4" data-tour="savings-root">
        <div className="flex flex-wrap gap-2">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => set({ tab: id })}
              className={`px-3 py-1.5 rounded-lg text-sm cursor-pointer ${
                s.tab === id ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <PlanHelp />
        {s.tab === 'plan' && (
          <>
            <ReturnsCard s={s} set={set} ret={ret} />
            <PlanTab s={s} set={set} ret={ret} />
          </>
        )}
        {s.tab === 'portfolio' && window.TA.SavingsPortfolioTab && <window.TA.SavingsPortfolioTab />}
        {s.tab === 'income' && <IncomeTab s={s} set={set} />}
        {s.tab === 'life' && <LifeTab s={s} set={set} ret={ret} />}
      </div>
    );
  }

  // 其他頁面（看盤頁）帶某一檔來做存股試算：先寫進設定，存股頁掛上時就會讀到
  const openSavings = (symbol, tab = 'plan') => {
    writeLS(LS_KEY, { ...DEFAULTS, ...readLS(LS_KEY, {}), symbol, tab });
    window.TA.goTab?.('savings');
    window.dispatchEvent(new CustomEvent('savings-action', { detail: { tab, symbol } }));
  };

  // 投資組合分頁（savings_portfolio.jsx）共用的元件與工具
  const savingsUI = { Card, Num, Btn, LineChart, useCalc, post, wan, pct, inputCls, copyText, holdingsValues };

  window.TA = Object.assign(window.TA || {}, { SavingsPlanPage, openSavings, savingsUI });
})();
