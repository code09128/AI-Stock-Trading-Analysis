// 說明頁：K 線怎麼看（圖解）＋ 大盤實例 ＋「互動式還權 K 線與成交量副圖」的讀圖說明
(() => {
  const { useState, useEffect } = React;
  const { fmt, colorOf } = window.TA;

  const UP = '#fb7185'; // 台灣習慣：紅＝上漲
  const DOWN = '#34d399'; // 綠＝下跌

  // 單根蠟燭（示意圖用，座標以 0~100 的價格尺度）
  const Candle = ({ x, o, h, l, c, w = 14 }) => {
    const up = c >= o;
    const col = up ? UP : DOWN;
    const top = Math.max(o, c);
    const bot = Math.min(o, c);
    return (
      <g>
        <line x1={x} x2={x} y1={100 - h} y2={100 - l} stroke={col} strokeWidth="2" />
        <rect
          x={x - w / 2}
          y={100 - top}
          width={w}
          height={Math.max(top - bot, 1.5)}
          fill={up ? col : col}
          stroke={col}
          rx="1"
        />
      </g>
    );
  };

  // 1) 解剖圖
  const Anatomy = () => (
    <svg viewBox="0 0 320 130" className="w-full max-w-md" role="img" aria-label="K 棒構造圖">
      <title>K 棒構造：開高低收、實體、上下影線</title>
      <g transform="translate(0,15) scale(1,1)">
        <g transform="translate(60,0)">
          <Candle x={0} o={30} h={95} l={10} c={70} w={22} />
        </g>
        <g transform="translate(200,0)">
          <Candle x={0} o={70} h={95} l={10} c={30} w={22} />
        </g>
      </g>
      {[
        ['收', 60, 30, 100],
        ['開', 60, 85, 100],
        ['最高', 60, 20, 12],
        ['最低', 60, 112, 12],
      ].map(([t, x, y]) => (
        <text key={t + x + y} x={x + 18} y={y} fontSize="10" fill="#cbd5e1">
          ← {t}
        </text>
      ))}
      <text x="30" y="127" fontSize="11" fill={UP} textAnchor="middle">
        紅K（收＞開，上漲）
      </text>
      <text x="200" y="127" fontSize="11" fill={DOWN} textAnchor="middle">
        綠K（收＜開，下跌）
      </text>
      <text x="236" y="40" fontSize="10" fill="#cbd5e1">
        ← 上影線
      </text>
      <text x="236" y="68" fontSize="10" fill="#cbd5e1">
        ← 實體
      </text>
      <text x="236" y="100" fontSize="10" fill="#cbd5e1">
        ← 下影線
      </text>
    </svg>
  );

  // 2) 常見型態
  const PATTERNS = [
    { name: '大紅K', c: { o: 20, h: 82, l: 16, c: 78 }, note: '實體長、收在最高附近：買盤強勢。' },
    { name: '大綠K', c: { o: 78, h: 82, l: 16, c: 20 }, note: '實體長、收在最低附近：賣壓沉重。' },
    {
      name: '十字星',
      c: { o: 50, h: 80, l: 20, c: 51 },
      note: '開收幾乎相同：多空僵持，常是轉折前的猶豫。',
    },
    {
      name: '長下影（錘子）',
      c: { o: 62, h: 70, l: 10, c: 68 },
      note: '盤中殺低又被買回：下方有支撐，低檔出現較有意義。',
    },
    {
      name: '長上影（流星）',
      c: { o: 40, h: 92, l: 34, c: 36 },
      note: '盤中衝高又被賣下來：上方有壓力，高檔出現要小心。',
    },
  ];
  const Patterns = () => (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      {PATTERNS.map((p) => (
        <div
          key={p.name}
          className="rounded-xl border border-slate-800 bg-slate-950/60 p-2 text-center"
        >
          <svg viewBox="0 0 60 110" className="w-14 h-24 mx-auto" role="img" aria-label={p.name}>
            <title>{p.name}</title>
            <g transform="translate(30,5)">
              <Candle x={0} {...p.c} w={16} />
            </g>
          </svg>
          <div className="text-xs font-bold text-sky-300">{p.name}</div>
          <div className="text-[11px] text-slate-400 leading-snug mt-1">{p.note}</div>
        </div>
      ))}
    </div>
  );

  // 2b) 位置與多根組合：前面幾根淡色＝之前的走勢（交代位置），亮色＝型態本身
  const DOWN_TREND = [
    { o: 88, h: 90, l: 76, c: 78 },
    { o: 78, h: 80, l: 66, c: 68 },
    { o: 68, h: 70, l: 56, c: 58 },
  ];
  const UP_TREND = [
    { o: 20, h: 32, l: 18, c: 30 },
    { o: 30, h: 42, l: 28, c: 40 },
    { o: 40, h: 52, l: 38, c: 50 },
  ];
  const MiniChart = ({ before, bars, line, label }) => {
    const all = [...before, ...bars];
    const W = all.length * 16 + 8;
    return (
      <svg viewBox={`0 0 ${W} 104`} className="w-full h-32" role="img" aria-label={label}>
        <title>{label}</title>
        <g transform="translate(0,2)">
          {line != null && (
            <line x1="0" x2={W} y1={100 - line} y2={100 - line} stroke="#fbbf24" strokeDasharray="3 2" />
          )}
          {all.map((b, i) => (
            // 示意圖的 K 棒固定不變，用位置當 key
            <g key={i} opacity={i < before.length ? 0.3 : 1}>
              <Candle x={12 + i * 16} {...b} w={10} />
            </g>
          ))}
        </g>
      </svg>
    );
  };

  // 同一個形狀，出現在不同位置意義相反
  const PAIRS = [
    {
      shape: '小實體＋長下影線',
      items: [
        {
          name: '錘子',
          where: '低檔',
          before: DOWN_TREND,
          bars: [{ o: 52, h: 55, l: 28, c: 54 }],
          note: '跌了一段後盤中殺低又被買回：下方開始有人承接，可能止跌。',
        },
        {
          name: '吊人線',
          where: '高檔',
          before: UP_TREND,
          bars: [{ o: 58, h: 61, l: 36, c: 60 }],
          note: '漲了一段後盤中曾被大量賣下去：雖然收回來，但賣壓已經出現，可能見頂。',
        },
      ],
    },
    {
      shape: '小實體＋長上影線',
      items: [
        {
          name: '倒錘子',
          where: '低檔',
          before: DOWN_TREND,
          bars: [{ o: 50, h: 74, l: 48, c: 52 }],
          note: '跌了一段後買方嘗試往上推，雖然沒守住，但已經有人敢進場。',
        },
        {
          name: '流星',
          where: '高檔',
          before: UP_TREND,
          bars: [{ o: 60, h: 84, l: 58, c: 58 }],
          note: '漲了一段後衝高被賣回：追價力道不足，上方賣壓重。',
        },
      ],
    },
  ];

  const COMBOS = [
    {
      name: '晨星',
      where: '低檔・3 根',
      before: DOWN_TREND,
      bars: [
        { o: 58, h: 59, l: 40, c: 42 },
        { o: 36, h: 39, l: 32, c: 36.5 },
        { o: 40, h: 58, l: 39, c: 56 },
      ],
      note: '長綠 K → 小實體（十字）→ 長紅 K 收復第一根實體一半以上：賣方力竭、買方接手，跌勢可能翻轉。',
    },
    {
      name: '夜星',
      where: '高檔・3 根',
      before: UP_TREND,
      bars: [
        { o: 50, h: 70, l: 49, c: 68 },
        { o: 74, h: 77, l: 71, c: 73.5 },
        { o: 70, h: 71, l: 52, c: 54 },
      ],
      note: '晨星反過來：長紅 → 小實體 → 長綠跌破第一根實體一半以下，漲勢可能結束。',
    },
    {
      name: '母子線',
      where: '高低檔皆可・2 根',
      before: UP_TREND,
      bars: [
        { o: 50, h: 76, l: 48, c: 74 },
        { o: 66, h: 68, l: 58, c: 60 },
      ],
      note: '第二根（含影線）整根落在第一根實體內：原本的力道明顯縮小，常是變盤前兆，方向要等之後確認。',
    },
    {
      name: '平底',
      where: '低檔・2 根以上',
      before: DOWN_TREND,
      bars: [
        { o: 56, h: 58, l: 34, c: 40 },
        { o: 40, h: 52, l: 34, c: 50 },
      ],
      line: 34,
      note: '兩根的最低點落在同一個價位：跌到這裡兩次都撐住，形成短線支撐（黃色虛線）。跌破就失效。',
    },
  ];

  const PatternCard = ({ p }) => (
    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-2">
      <MiniChart before={p.before} bars={p.bars} line={p.line} label={`${p.name}（${p.where}）`} />
      <div className="text-xs font-bold text-sky-300 mt-1">
        {p.name}
        <span
          className={`ml-1.5 text-[10px] font-normal px-1.5 py-0.5 rounded ${
            p.where.startsWith('高') ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'
          }`}
        >
          {p.where}
        </span>
      </div>
      <div className="text-[11px] text-slate-400 leading-snug mt-1">{p.note}</div>
    </div>
  );

  const PositionPatterns = () => (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="text-xs text-slate-300">
          <b className="text-white">型態告訴你發生了什麼，位置才告訴你代表什麼。</b>
          下面每一組的形狀完全一樣，只差在出現在漲了一段之後（高檔）還是跌了一段之後（低檔）。淡色 K 棒是之前的走勢。
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {PAIRS.map((g) => (
            <div key={g.shape} className="rounded-xl border border-slate-800 p-2 space-y-1">
              <div className="text-[11px] text-slate-400">同一個形狀：{g.shape}</div>
              <div className="grid grid-cols-2 gap-2">
                {g.items.map((p) => (
                  <PatternCard key={p.name} p={p} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="space-y-2">
        <div className="text-xs font-semibold text-slate-300">多根組合型態</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {COMBOS.map((p) => (
            <PatternCard key={p.name} p={p} />
          ))}
        </div>
      </div>
      <div className="rounded-lg bg-slate-950/70 border border-slate-800 p-3 text-[11px] text-slate-300 leading-relaxed space-y-1">
        <div className="font-semibold text-white">看到型態後的檢查順序</div>
        <ol className="list-decimal pl-5 space-y-0.5">
          <li>
            <b>位置</b>：前面是漲了一段還是跌了一段？附近有沒有支撐／壓力（技術分析頁的虛線）？在盤整中間出現的型態意義不大。
          </li>
          <li>
            <b>確認</b>：等下一根 K 棒往型態預期的方向走（例如晨星之後再收紅），不要在型態剛出現就搶進。
          </li>
          <li>
            <b>成交量</b>：轉折型態搭配放量比較可信；量縮的反轉訊號容易失敗。
          </li>
          <li>
            <b>失效點</b>：先想好錯了在哪裡出場，例如錘子、平底的最低點被跌破就代表判斷錯誤。
          </li>
        </ol>
      </div>
    </div>
  );

  // 3) 真實大盤最近幾根 K
  const MARKETS = [
    ['^TWII', '台灣加權指數'],
    ['^GSPC', 'S&P 500'],
    ['^IXIC', '那斯達克'],
  ];
  const LiveCandles = () => {
    const [sym, setSym] = useState('^TWII');
    const [data, setData] = useState(null);
    useEffect(() => {
      let stop = false;
      setData(null);
      fetch('/api/candles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: sym, n: 15 }),
      })
        .then((r) => r.json())
        .then((d) => !stop && setData(d))
        .catch(() => !stop && setData({ bars: [], error: '無法連到本機伺服器' }));
      return () => {
        stop = true;
      };
    }, [sym]);
    const bars = data?.bars || [];
    const W = 620;
    const H = 170;
    const padL = 6;
    const padR = 54;
    const lo = Math.min(...bars.map((b) => b.low));
    const hi = Math.max(...bars.map((b) => b.high));
    const y = (v) => 10 + (1 - (v - lo) / (hi - lo || 1)) * (H - 24);
    const step = (W - padL - padR) / Math.max(bars.length, 1);
    const last = bars[bars.length - 1];
    let reading = null;
    if (last) {
      const up = last.close >= last.open;
      const range = last.high - last.low || 1;
      const body = Math.abs(last.close - last.open);
      const upper = last.high - Math.max(last.open, last.close);
      const lower = Math.min(last.open, last.close) - last.low;
      const prev = bars[bars.length - 2];
      const chg = prev ? ((last.close / prev.close - 1) * 100).toFixed(2) : null;
      reading = `${last.date}：開 ${fmt(last.open)} → 收 ${fmt(last.close)}，收${up ? '紅' : '綠'}K${
        chg ? `（較前一日 ${chg > 0 ? '+' : ''}${chg}%）` : ''
      }。實體約占全日振幅 ${fmt((body / range) * 100, 0)}%，上影線 ${fmt((upper / range) * 100, 0)}%、下影線 ${fmt(
        (lower / range) * 100,
        0,
      )}%${
        upper / range > 0.5 && !up
          ? '，上影線偏長：盤中有衝高但被賣下來。'
          : lower / range > 0.5
            ? '，下影線偏長：盤中有殺低但被買回。'
            : body / range < 0.15
              ? '，實體很小：多空僵持。'
              : '。'
      }`;
    }
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {MARKETS.map(([s, label]) => (
            <button
              type="button"
              key={s}
              onClick={() => setSym(s)}
              className={`px-3 py-1.5 rounded-lg border cursor-pointer ${
                sym === s
                  ? 'bg-sky-500/20 border-sky-400 text-white'
                  : 'bg-slate-950 border-slate-800 text-slate-400'
              }`}
            >
              {label}
            </button>
          ))}
          <span className="text-slate-500">最近 {bars.length || 15} 根日 K（真實資料）</span>
        </div>
        {data?.error && <div className="text-xs text-rose-300">抓取失敗：{data.error}</div>}
        {bars.length > 0 && (
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="w-full h-auto"
            role="img"
            aria-label="大盤最近日K線"
          >
            <title>大盤最近 15 根日 K 線</title>
            {[0, 0.5, 1].map((r) => {
              const v = lo + (hi - lo) * r;
              return (
                <g key={r}>
                  <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke="#1e293b" />
                  <text x={W - padR + 4} y={y(v) + 3} fontSize="10" fill="#94a3b8">
                    {fmt(v, 0)}
                  </text>
                </g>
              );
            })}
            {bars.map((b, i) => {
              const up = b.close >= b.open;
              const col = up ? UP : DOWN;
              const cx = padL + step * i + step / 2;
              const top = y(Math.max(b.open, b.close));
              const bot = y(Math.min(b.open, b.close));
              return (
                <g key={b.date}>
                  <title>{`${b.date} 開${b.open} 高${b.high} 低${b.low} 收${b.close}`}</title>
                  <line
                    x1={cx}
                    x2={cx}
                    y1={y(b.high)}
                    y2={y(b.low)}
                    stroke={col}
                    strokeWidth="1.5"
                  />
                  <rect
                    x={cx - step * 0.3}
                    y={top}
                    width={step * 0.6}
                    height={Math.max(bot - top, 1.5)}
                    fill={col}
                  />
                  {i === bars.length - 1 && (
                    <text x={cx} y={H - 2} fontSize="10" fill="#fbbf24" textAnchor="middle">
                      最新
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        )}
        {reading && (
          <div
            className={`text-xs leading-relaxed rounded-lg bg-slate-950/70 border border-slate-800 p-3 ${colorOf(0)}`}
          >
            最新一根怎麼讀：{reading}
          </div>
        )}
        <div className="text-[10px] text-slate-500">
          來源：{data?.source || 'Yahoo Finance'}。把滑鼠停在某根 K
          棒上可看開高低收。只是教學示範，不代表買賣建議。
        </div>
      </div>
    );
  };

  // 4) 互動式還權 K 線與成交量副圖 說明
  const ChartHelp = () => (
    <div className="space-y-3 text-xs text-slate-300 leading-relaxed">
      <p>
        技術分析「互動式還權 K 線與成交量副圖」上半部是 K
        線主圖，下半部是成交量副圖，兩者共用同一條時間軸。
      </p>
      <ol className="list-decimal pl-5 space-y-1.5">
        <li>
          <b className="text-white">K 棒顏色</b>
          ：紅＝收盤高於開盤（上漲），綠＝收盤低於開盤（下跌），與台股看盤習慣一致。
        </li>
        <li>
          <b className="text-yellow-400">MA5（黃線）</b>＝近 5 日收盤均價，反應短線；
          <b style={{ color: '#38bdf8' }}> MA20（藍線）</b>＝近 20 日（約一個月），反應中期趨勢；
          <b className="text-emerald-400"> MA60（綠線）</b>＝近 60
          日（約一季），被稱為季線或生命線。股價站上 MA20 且短中長均線多頭排列時，通常表示偏強。
        </li>
        <li>
          <b className="text-cyan-400">青藍色虛線＝支撐位</b>（過去反彈過的低點區）、
          <b className="text-rose-400"> 紅色虛線＝壓力位</b>
          （過去遇到賣壓的高點區）。價位由程式從波段高低點算出，台股會對齊合法跳動檔位。
        </li>
        <li>
          <b className="text-white">成交量副圖</b>：每根量柱對應上方同一天，顏色與 K
          棒相同。價漲量增較可靠；價漲量縮要留意追高風險； 突破壓力時爆量才有說服力。
        </li>
        <li>
          <b className="text-white">十字游標</b>
          ：滑鼠移到圖上，會顯示該根的開、高、低、收、漲跌幅、成交量與當時的 MA5／MA20／MA60。
        </li>
        <li>
          <b className="text-white">20／30／45／60 日</b>
          ：縮放顯示根數；切到「週線」時單位變成週，每根是一整週。
        </li>
        <li>
          <b className="text-white">還權（還原權值）</b>
          ：公司配息、配股或拆股後，股價會在除權息日「跳空下降」，但那不是真的下跌。
          還權就是把除權息前的歷史價格按比例調整，讓 K 線連續，均線與回測才不會被假缺口騙到。
        </li>
        <li>
          <b className="text-white">最後一根會即時更新</b>：每 5 秒用真實報價覆蓋當日最後一根 K
          棒的收盤／最高／最低。
        </li>
      </ol>
    </div>
  );

  const CandleGuide = () => (
    <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-5">
      <h3 className="font-bold text-white">K 線怎麼看（含大盤實例）</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-center">
        <Anatomy />
        <div className="text-xs text-slate-300 leading-relaxed space-y-1.5">
          <p>
            <b className="text-white">一根 K 棒 = 一段時間（日 K＝一天）的四個價格</b>
            ：開盤、最高、最低、收盤。
          </p>
          <p>
            中間較粗的方塊是<b className="text-white">實體</b>（開盤到收盤），細線是
            <b className="text-white">影線</b>
            （盤中曾到過但沒守住的最高／最低價）。
          </p>
          <p>實體越長代表當天方向越明確；影線越長代表盤中拉鋸越激烈。</p>
        </div>
      </div>
      <div>
        <div className="text-xs font-semibold text-slate-300 mb-2">常見的單根 K 棒型態</div>
        <Patterns />
        <p className="text-[11px] text-slate-500 mt-2">
          單根型態只是線索，要搭配位置（高檔／低檔）、成交量與前後幾根一起看，不能單獨當買賣訊號。
        </p>
      </div>
      <div>
        <div className="text-xs font-semibold text-slate-300 mb-2">位置決定意義：轉折型態</div>
        <PositionPatterns />
      </div>
      <div>
        <div className="text-xs font-semibold text-slate-300 mb-2">大盤實例：最近幾根日 K</div>
        <LiveCandles />
      </div>
      <div>
        <div className="text-xs font-semibold text-slate-300 mb-2">
          互動式還權 K 線與成交量副圖 讀圖說明
        </div>
        <ChartHelp />
      </div>
    </div>
  );

  window.TA = Object.assign(window.TA || {}, { CandleGuide });
})();
