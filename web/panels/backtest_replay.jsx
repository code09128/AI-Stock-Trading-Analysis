// 策略回測：▶ K 線回放教學。逐根播放這次回測用的日 K，遇到訊號／進場／出場自動暫停並說明原因，可開語音解說
(() => {
  const { useState, useEffect, useRef, useMemo } = React;

  const sma = (arr, n) => {
    const out = new Array(arr.length).fill(null);
    let s = 0;
    for (let i = 0; i < arr.length; i += 1) {
      s += arr[i];
      if (i >= n) s -= arr[i - n];
      if (i >= n - 1) out[i] = s / n;
    }
    return out;
  };
  const f2 = (v) => (v == null ? '--' : Number(v).toFixed(2));

  // 各策略要畫的均線（參數 key）
  const OVERLAYS = {
    ma_cross: ['fast_ma', 'slow_ma'],
    ma_align: ['short_ma', 'mid_ma', 'long_ma'],
    volume_breakout: ['exit_ma'],
    bias_revert: ['ma'],
    revenue_high: ['exit_ma'],
    margin_down: ['ma'],
  };
  const LINE_COLORS = ['#f59e0b', '#38bdf8', '#a78bfa'];

  // 白話說明訊號當天為什麼成立（技術面策略帶出當天的指標數字；籌碼類用規則文字）
  function buyReason(key, p, bars, i) {
    const c = bars.map((b) => b[4]);
    const v = bars.map((b) => b[5]);
    if (key === 'ma_cross') {
      const a = sma(c, p.fast_ma);
      const b = sma(c, p.slow_ma);
      return `${p.fast_ma} 日均線 ${f2(a[i])} 由下往上穿過 ${p.slow_ma} 日均線 ${f2(b[i])}（黃金交叉）`;
    }
    if (key === 'ma_align') {
      const [s, m, l] = [p.short_ma, p.mid_ma, p.long_ma].map((n) => sma(c, n)[i]);
      return `均線排成多頭：${p.short_ma} 日 ${f2(s)} ＞ ${p.mid_ma} 日 ${f2(m)} ＞ ${p.long_ma} 日 ${f2(l)}，收盤 ${f2(c[i])} 站上短均線`;
    }
    if (key === 'volume_breakout') {
      const hi = Math.max(...c.slice(Math.max(0, i - p.lookback), i));
      const vm = sma(v, p.lookback)[i - 1];
      return `收盤 ${f2(c[i])} 突破前 ${p.lookback} 天最高收盤 ${f2(hi)}，成交量是均量的 ${vm ? (v[i] / vm).toFixed(1) : '--'} 倍`;
    }
    if (key === 'bias_revert') {
      const m = sma(c, p.ma)[i];
      return `收盤 ${f2(c[i])} 比 ${p.ma} 日均線 ${f2(m)} 低 ${m ? (((m - c[i]) / m) * 100).toFixed(1) : '--'}%，超過 ${p.entry_bias}% 的超跌門檻`;
    }
    if (key === 'gap_up') {
      return `當天最低價 ${f2(bars[i][3])} 高於前一天最高價 ${f2(bars[i - 1][2])}，向上跳空 ${(((bars[i][3] / bars[i - 1][2]) - 1) * 100).toFixed(1)}%，且量大於 20 日均量`;
    }
    if (key === 'kd_cross') return `K 值在 ${p.buy_below} 以下由下往上穿過 D 值（KD ${p.kd_n} 日、台灣常用公式）`;
    if (key === 'inst_buy') return `三大法人合計連續 ${p.days} 天買超`;
    if (key === 'revenue_high') return `新公布的月營收是近 ${p.lookback} 個月最高，而且比去年同月成長`;
    if (key === 'margin_down')
      return `融資餘額 ${p.days} 天內減少 ${p.drop_pct}% 以上，且收盤 ${f2(c[i])} 站上 ${p.ma} 日均線 ${f2(sma(c, p.ma)[i])}`;
    return null;
  }

  function Candles({ bars, from, to, overlays, trades, stopLine, w = 760, h = 300 }) {
    const view = bars.slice(from, to + 1);
    if (!view.length) return null;
    const pad = { l: 8, r: 58, t: 12, b: 22 };
    const volH = 50;
    const ph = h - pad.t - pad.b - volH - 8;
    const lo = Math.min(...view.map((b) => b[3]), ...(stopLine ? [stopLine] : []));
    const hi = Math.max(...view.map((b) => b[2]));
    const span = Math.max(hi - lo, 1e-9);
    // 固定每根寬度（至少容納 60 根），剛開始只有幾根時從左邊長出來，不會被拉得很寬
    const cw = (w - pad.l - pad.r) / Math.max(view.length, 60);
    const x = (i) => pad.l + (i - from) * cw + cw / 2;
    const y = (v) => pad.t + ph - ((v - lo) / span) * ph;
    const vmax = Math.max(...view.map((b) => b[5]), 1);
    const vy = h - pad.b;
    const marks = [];
    for (const t of trades) {
      if (t.ei >= from && t.ei <= to) marks.push({ i: t.ei, buy: true, t });
      if (t.xi >= from && t.xi <= to) marks.push({ i: t.xi, buy: false, t });
    }
    return (
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height: h }}>
        <title>K 線回放</title>
        {trades
          .filter((t) => t.xi >= from && t.ei <= to)
          .map((t) => (
            <rect
              key={`hold-${t.ei}`}
              x={x(Math.max(t.ei, from)) - cw / 2}
              y={pad.t}
              width={(Math.min(t.xi, to) - Math.max(t.ei, from) + 1) * cw}
              height={ph}
              fill={t.net_pnl >= 0 ? '#ef4444' : '#10b981'}
              opacity="0.06"
            />
          ))}
        {[hi, (hi + lo) / 2, lo].map((v) => (
          <text key={v} x={w - pad.r + 4} y={y(v) + 3} fontSize="10" fill="#64748b" fontFamily="monospace">
            {f2(v)}
          </text>
        ))}
        {view.map((b, k) => {
          const i = from + k;
          const up = b[4] >= b[1];
          const col = up ? '#ef4444' : '#10b981';
          return (
            <g key={b[0]}>
              <line x1={x(i)} x2={x(i)} y1={y(b[2])} y2={y(b[3])} stroke={col} />
              <rect
                x={x(i) - Math.max(cw * 0.35, 0.5)}
                y={y(Math.max(b[1], b[4]))}
                width={Math.max(cw * 0.7, 1)}
                height={Math.max(Math.abs(y(b[1]) - y(b[4])), 1)}
                fill={col}
              />
              <rect x={x(i) - cw * 0.35} y={vy - (b[5] / vmax) * volH} width={cw * 0.7} height={(b[5] / vmax) * volH} fill={col} opacity="0.35" />
            </g>
          );
        })}
        {overlays.map((o, n) => {
          const pts = [];
          for (let i = from; i <= to; i += 1) if (o.values[i] != null) pts.push(`${x(i)},${y(o.values[i])}`);
          return <polyline key={o.label} points={pts.join(' ')} fill="none" stroke={LINE_COLORS[n % 3]} strokeWidth="1.4" />;
        })}
        {stopLine && (
          <line x1={pad.l} x2={w - pad.r} y1={y(stopLine)} y2={y(stopLine)} stroke="#fb7185" strokeDasharray="5 4" />
        )}
        {marks.map((m) => (
          <g key={`${m.buy ? 'b' : 's'}-${m.i}`}>
            <text
              x={x(m.i)}
              y={m.buy ? y(bars[m.i][3]) + 16 : y(bars[m.i][2]) - 6}
              textAnchor="middle"
              fontSize="11"
              fontWeight="bold"
              fill={m.buy ? '#fca5a5' : '#6ee7b7'}
            >
              {m.buy ? '▲買' : '▼賣'}
            </text>
          </g>
        ))}
        <text x={pad.l} y={h - 6} fontSize="10" fill="#64748b" fontFamily="monospace">
          {view[0][0]}
        </text>
        <text x={w - pad.r} y={h - 6} fontSize="10" fill="#64748b" fontFamily="monospace" textAnchor="end">
          {view[view.length - 1][0]}
        </text>
      </svg>
    );
  }

  const SPEEDS = [
    [2, '慢'],
    [5, '中'],
    [12, '快'],
    [30, '很快'],
  ];
  const WINDOW = 90;

  function ReplayPanel({ m3Data }) {
    const bars = m3Data.chart_bars || [];
    const r = m3Data.backtest_result;
    const strat = m3Data.strategy || {};
    const { strategy: key, ...rest } = m3Data.strategy_params || {};
    const params = useMemo(() => {
      const { initial_capital, commission_discount, period_years, ...p } = rest;
      return p;
    }, [m3Data]);
    const idxOf = useMemo(() => new Map(bars.map((b, i) => [b[0], i])), [bars]);
    const trades = useMemo(
      () =>
        (r.trades || [])
          .map((t) => ({ ...t, si: idxOf.get(t.signal_date), ei: idxOf.get(t.entry_date), xi: idxOf.get(t.exit_date) }))
          .filter((t) => t.ei != null && t.xi != null),
      [r, idxOf],
    );
    // 會暫停的事件：買訊（收盤）、進場（開盤）、出場
    const events = useMemo(() => {
      const ev = new Map();
      for (const t of trades) {
        if (t.si != null) ev.set(t.si, { kind: 'signal', t });
        ev.set(t.ei, { kind: 'entry', t });
        ev.set(t.xi, { kind: 'exit', t });
      }
      return ev;
    }, [trades]);
    const overlays = useMemo(() => {
      const c = bars.map((b) => b[4]);
      return (OVERLAYS[key] || [])
        .filter((k) => params[k])
        .map((k) => ({ label: `${params[k]} 日均線`, values: sma(c, params[k]) }));
    }, [bars, key, params]);

    const startIdx = Math.max(0, Math.min((trades[0]?.si ?? trades[0]?.ei ?? WINDOW) - 60, bars.length - 1));
    const [idx, setIdx] = useState(startIdx);
    const [playing, setPlaying] = useState(false);
    const [speed, setSpeed] = useState(5);
    const [autoPause, setAutoPause] = useState(true);
    const [voice, setVoice] = useState(false);
    const [note, setNote] = useState(null);
    const lastSpoken = useRef(null);
    const ttsOK = typeof window !== 'undefined' && 'speechSynthesis' in window;

    const speak = (text) => {
      if (!voice || !ttsOK) return;
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'zh-TW';
      const v = window.speechSynthesis.getVoices().find((x) => /zh[-_]TW/i.test(x.lang));
      if (v) u.voice = v;
      u.rate = 1.05;
      window.speechSynthesis.speak(u);
    };
    useEffect(() => () => ttsOK && window.speechSynthesis.cancel(), [ttsOK]);

    const describe = (i) => {
      const e = events.get(i);
      if (!e) return null;
      const t = e.t;
      if (e.kind === 'signal') {
        const why = (buyReason(key, params, bars, i) || strat.rule || '').replace(/[。\s]+$/, '');
        return {
          tone: 'sky',
          title: `${bars[i][0]} 收盤出現買進訊號`,
          text: `${why}。訊號在收盤後才確定，所以下一個交易日開盤才買進（不偷看未來）。`,
        };
      }
      if (e.kind === 'entry') {
        return {
          tone: 'rose',
          title: `${bars[i][0]} 開盤買進`,
          text: `以開盤價 ${t.entry_price} 買進 ${Number(t.shares || 0).toLocaleString()} 股。${
            m3Data.risk_settings?.stop_loss_pct ? `停損設在進場價下方 ${m3Data.risk_settings.stop_loss_pct}%。` : ''
          }`,
        };
      }
      const why =
        t.exit_reason === '訊號'
          ? '出現策略的賣出條件'
          : t.exit_reason === '停損'
            ? `盤中跌破停損價（進場價下方 ${m3Data.risk_settings?.stop_loss_pct}%）`
            : `從持有期間高點回落 ${m3Data.risk_settings?.trailing_pct}%（${t.exit_reason}）`;
      return {
        tone: t.net_pnl >= 0 ? 'emerald' : 'amber',
        title: `${bars[i][0]} 賣出（${t.exit_reason}）`,
        text: `${why}，以 ${t.exit_price} 出場，持有 ${t.holding_bars} 天，扣稅費後${t.net_pnl >= 0 ? '賺' : '賠'} ${Math.abs(
          t.net_pnl,
        ).toLocaleString()}（${t.return_pct}%）。`,
      };
    };

    useEffect(() => {
      if (!playing) return undefined;
      const id = setInterval(() => {
        setIdx((i) => {
          const n = Math.min(i + 1, bars.length - 1);
          if (n === bars.length - 1) setPlaying(false);
          if (autoPause && events.has(n)) setPlaying(false);
          return n;
        });
      }, 1000 / speed);
      return () => clearInterval(id);
    }, [playing, speed, autoPause, events, bars.length]);

    useEffect(() => {
      const d = describe(idx);
      if (d) setNote(d);
      if (d && lastSpoken.current !== idx) {
        lastSpoken.current = idx;
        speak(`${d.title}。${d.text}`);
      }
    }, [idx]);

    if (bars.length < 2) return <div className="text-xs text-slate-500">沒有 K 線資料，請重新執行回測。</div>;

    const from = Math.max(0, idx - WINDOW + 1);
    const open = trades.find((t) => t.ei <= idx && t.xi > idx);
    let stopLine = null;
    if (open) {
      const rs = m3Data.risk_settings || {};
      const lv = [];
      if (rs.stop_loss_pct) lv.push(open.entry_price * (1 - rs.stop_loss_pct / 100));
      if (rs.trailing_pct) {
        const peak = Math.max(open.entry_price, ...bars.slice(open.ei, idx).map((b) => b[2]));
        lv.push(peak * (1 - rs.trailing_pct / 100));
      }
      if (lv.length) stopLine = Math.max(...lv);
    }
    const nextEvent = [...events.keys()].sort((a, b) => a - b).find((i) => i > idx);
    const prevEvent = [...events.keys()].sort((a, b) => b - a).find((i) => i < idx);
    const btn = 'px-2.5 py-1.5 rounded-lg border border-slate-700 text-slate-200 hover:bg-slate-800 cursor-pointer text-xs';
    const TONE = {
      sky: 'border-sky-500/40 bg-sky-500/10 text-sky-100',
      rose: 'border-rose-500/40 bg-rose-500/10 text-rose-100',
      emerald: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100',
      amber: 'border-amber-500/40 bg-amber-500/10 text-amber-100',
    };

    return (
      <div className="space-y-3">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-xs text-slate-300">
          逐根播放這次回測的日 K：<b>▲買</b>＝進場、<b>▼賣</b>＝出場，淡色底是持有期間，紅色虛線是當下的停損價。
          勾選「遇到買賣點自動暫停」時，會停在訊號日、進場日、出場日並說明原因；開啟語音會用瀏覽器內建的中文語音朗讀。
          <window.TA.Tip text="這是策略在歷史上的模擬成交，用來看懂「為什麼在這裡買、這裡賣」，不是預測。語音使用作業系統內建的中文語音（Windows 通常有「Hanhan」「Yating」），沒有中文語音時會用預設語音或沒有聲音。" />
        </div>
        <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3 space-y-2">
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
            <span className="font-mono text-slate-200">{bars[idx][0]}</span>
            <span className="font-mono">
              開 {f2(bars[idx][1])} 高 {f2(bars[idx][2])} 低 {f2(bars[idx][3])} 收 {f2(bars[idx][4])}
            </span>
            {overlays.map((o, n) => (
              <span key={o.label} style={{ color: LINE_COLORS[n % 3] }}>
                {o.label} {f2(o.values[idx])}
              </span>
            ))}
            {open && (
              <span className={bars[idx][4] >= open.entry_price ? 'text-rose-300' : 'text-emerald-300'}>
                持有中：成本 {open.entry_price}，帳面 {(((bars[idx][4] / open.entry_price) - 1) * 100).toFixed(2)}%
              </span>
            )}
          </div>
          <Candles bars={bars} from={from} to={idx} overlays={overlays} trades={trades} stopLine={stopLine} />
          <input
            type="range"
            aria-label="回放位置"
            min={0}
            max={bars.length - 1}
            value={idx}
            onChange={(e) => {
              setPlaying(false);
              setIdx(Number(e.target.value));
            }}
            className="w-full"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={btn} onClick={() => { setPlaying(false); setIdx(startIdx); }}>
              ⏮ 從頭
            </button>
            <button type="button" className={btn} disabled={prevEvent == null} onClick={() => { setPlaying(false); setIdx(prevEvent); }}>
              ⏪ 上一個買賣點
            </button>
            <button type="button" className={btn} onClick={() => { setPlaying(false); setIdx((i) => Math.max(0, i - 1)); }}>
              ◀ 一根
            </button>
            <button
              type="button"
              className="px-4 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-semibold cursor-pointer text-xs"
              onClick={() => {
                if (idx >= bars.length - 1) setIdx(startIdx);
                setPlaying(!playing);
              }}
            >
              {playing ? '⏸ 暫停' : '▶ 播放'}
            </button>
            <button type="button" className={btn} onClick={() => { setPlaying(false); setIdx((i) => Math.min(bars.length - 1, i + 1)); }}>
              一根 ▶
            </button>
            <button type="button" className={btn} disabled={nextEvent == null} onClick={() => { setPlaying(false); setIdx(nextEvent); }}>
              下一個買賣點 ⏩
            </button>
            <select aria-label="播放速度" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white">
              {SPEEDS.map(([v, l]) => (
                <option key={v} value={v}>
                  速度：{l}（每秒 {v} 根）
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1 text-xs text-slate-300 cursor-pointer">
              <input type="checkbox" checked={autoPause} onChange={(e) => setAutoPause(e.target.checked)} />
              遇到買賣點自動暫停
            </label>
            <label className={`flex items-center gap-1 text-xs cursor-pointer ${ttsOK ? 'text-slate-300' : 'text-slate-600'}`}>
              <input
                type="checkbox"
                disabled={!ttsOK}
                checked={voice}
                onChange={(e) => {
                  setVoice(e.target.checked);
                  if (!e.target.checked && ttsOK) window.speechSynthesis.cancel();
                }}
              />
              🔊 語音解說{ttsOK ? '' : '（此瀏覽器不支援）'}
            </label>
            <span className="ml-auto text-[11px] text-slate-500">
              第 {idx + 1} / {bars.length} 根｜{trades.length} 筆交易
            </span>
          </div>
        </div>
        {note && (
          <div className={`rounded-xl border px-4 py-3 text-sm ${TONE[note.tone]}`}>
            <div className="font-semibold">{note.title}</div>
            <div className="text-xs mt-1 leading-relaxed">{note.text}</div>
          </div>
        )}
      </div>
    );
  }

  window.TA = Object.assign(window.TA || {}, {
    BT: Object.assign(window.TA?.BT || {}, { ReplayPanel }),
  });
})();
