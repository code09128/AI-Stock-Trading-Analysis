// 產業鏈地圖：全部類股即時漲跌（第 1 層）→ 點進去展開上中下游環節與個股（第 2 層），可回放近 30 日。
// 畫面由 chain_engine.tsx 的 Canvas 引擎繪製；這支檔案負責抓資料、HUD（清單、明細、回放列、小地圖）與把兩邊接起來。
// 資料：/api/chains/map（全景，30 秒）、/api/chains/detail（單一產業鏈的即時報價，30 秒）、/api/chains/history（回放，按需載入）
// 產業鏈結構在 src/market/chain_data.py（自行整理的示意分類，更新方式見該檔開頭）。
import { Tip } from '../ui';
import { ChainEngine } from './chain_engine';
import { pollEvery } from '../desktop_bridge';

const { useState, useEffect, useRef, useMemo, useCallback } = React;


const PANEL = 'bg-slate-950/80 border border-slate-700/60 backdrop-blur-md rounded-xl';
const BTN = 'px-2.5 py-1 text-xs rounded-lg bg-slate-900/80 border border-slate-700/70 text-slate-200 hover:border-cyan-400 cursor-pointer disabled:opacity-50 disabled:cursor-default';
const STAGE_COLORS = ['#22d3ee', '#a78bfa', '#f59e0b', '#34d399'];

const fmtPct = (v) => (v === null || v === undefined ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`);
const toneCls = (v) =>
  v === null || v === undefined ? 'text-slate-400' : Math.abs(v) < 0.05 ? 'text-sky-300' : v > 0 ? 'text-rose-400' : 'text-emerald-400';
const barColor = (v) => (Math.abs(v) < 0.05 ? '#7aa2ff' : v > 0 ? '#ff4d6d' : '#2dffa0');
const fmtAsOf = (s) => (s || '').replace(/^(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
const fmtYi = (v, market) => (!v ? '—' : market === 'US' ? `$${(v / 1e9).toFixed(v >= 1e10 ? 0 : 1)}B` : `${(v / 1e8).toFixed(v >= 1e10 ? 0 : 1)} 億`);

async function postJson(path, payload) {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || (d.error && !d.stocks && !d.dates)) throw new Error(d.error || `HTTP ${r.status}`);
  return d;
}

// 回放序列取某一天的值：累積模式＝從第一天加總到這天
function pickSeries(series, day, cum) {
  if (!series) return null;
  if (!cum) return series[day] ?? null;
  let sum = 0;
  let any = false;
  for (let i = 0; i <= day; i++) {
    if (series[i] !== null && series[i] !== undefined) {
      sum += series[i];
      any = true;
    }
  }
  return any ? sum : null;
}

// 引擎每幀來讀的數字：回放中讀歷史，否則讀即時報價；沒有資料一律回 null（畫面顯示「—」，不補假值）
function readValue(D, kind, a, b) {
  if (kind === 'hub') {
    const h = D.hubMap[a];
    if (!h || h.change_pct === null || h.change_pct === undefined) return { v: null };
    return { v: h.change_pct, note: h.source === 'live' ? '即時' : '盤後' };
  }
  const hist = D.replay.on ? D.history[a] : null;
  if (hist && !hist.error) {
    const v = pickSeries(kind === 'node' ? hist.nodes[b] : hist.stocks[b], D.replay.day, D.replay.cum);
    return { v, note: kind === 'node' ? '回放' : '' };
  }
  const det = D.details[a];
  if (!det) return { v: null };
  if (kind === 'node') {
    const n = det.nodes[b];
    if (!n) return { v: null };
    return { v: n.change_pct, note: n.n_ok < n.n_total ? `報價 ${n.n_ok}/${n.n_total}` : '' };
  }
  const s = det.stocks[b];
  return { v: s?.ok ? s.change_pct : null };
}

function StageChart({ chain, hist, day }) {
  const W = 300;
  const H = 100;
  const series = chain.stages.map((_, si) => {
    const ids = chain.nodes.filter((n) => n.stage === si).map((n) => n.id);
    let c = 0;
    return hist.dates.map((_d, i) => {
      const vals = ids.map((id) => hist.nodes[id]?.[i]).filter((v) => v !== null && v !== undefined);
      if (vals.length) c += vals.reduce((x, y) => x + y, 0) / vals.length;
      return c;
    });
  });
  const all = series.flat();
  const lo = Math.min(...all, 0);
  const hi = Math.max(...all, 0);
  const n = hist.dates.length;
  const X = (i) => 6 + ((W - 12) * i) / Math.max(1, n - 1);
  const Y = (v) => 8 + (H - 16) * (1 - (v - lo) / (hi - lo || 1));
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="各階段累積漲跌折線，用來看上游先動、下游晚幾天跟上">
        <line x1="6" x2={W - 6} y1={Y(0)} y2={Y(0)} stroke="rgba(120,160,255,.3)" strokeDasharray="3 4" />
        {series.map((s, i) => (
          <polyline
            key={chain.stages[i]}
            fill="none"
            stroke={STAGE_COLORS[i % 4]}
            strokeWidth="2.2"
            style={{ filter: `drop-shadow(0 0 3px ${STAGE_COLORS[i % 4]})` }}
            points={s.map((v, k) => `${X(k).toFixed(1)},${Y(v).toFixed(1)}`).join(' ')}
          />
        ))}
        <line x1={X(day)} x2={X(day)} y1="8" y2={H - 8} stroke="#fff" strokeWidth="1.3" />
      </svg>
      <div className="text-[11px] text-slate-400 flex flex-wrap gap-x-3">
        {chain.stages.map((s, i) => (
          <span key={s}>
            <span style={{ color: STAGE_COLORS[i % 4] }}>━</span> {s}
          </span>
        ))}
      </div>
    </div>
  );
}

function Row({ left, mid, bar, right, tone, onClick }: { left: any; mid: any; bar?: number; right: string; tone: string; onClick?: () => void }) {
  const inner = (
    <>
      <span className="text-slate-400 tabular-nums w-12 shrink-0 text-left">{left}</span>
      <span className="flex-1 truncate text-left">{mid}</span>
      {bar !== undefined && (
        <span className="w-16 h-1.5 rounded bg-slate-800 overflow-hidden shrink-0">
          <i className="block h-full rounded" style={{ width: `${Math.min(100, (Math.abs(bar) / 4) * 100)}%`, background: barColor(bar) }} />
        </span>
      )}
      <b className={`tabular-nums w-[4.8rem] text-right shrink-0 ${tone}`}>{right}</b>
    </>
  );
  const cls = 'flex items-center gap-2 py-1 border-b border-slate-800/70 text-[13px] w-full';
  return onClick ? (
    <button type="button" onClick={onClick} className={`${cls} hover:bg-cyan-500/10 cursor-pointer`}>
      {inner}
    </button>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

function DetailPanel({ view, map, hubMap, det, hist, replay, market, onNode, onChain }) {
  const chain = view.chain ? map.chains.find((c) => c.id === view.chain) : null;
  const sectorHub = chain ? map.hubs.find((h) => h.name === chain.sector) : null;
  if (!chain) {
    const h = hubMap[view.sector];
    if (!h) return null;
    return (
      <div className="space-y-2">
        <div className="text-[11px] text-slate-400 tracking-wider">產業別</div>
        <h2 className="text-xl font-bold text-white">{h.name}</h2>
        <div className={`text-3xl font-extrabold tabular-nums ${toneCls(h.change_pct)}`}>{fmtPct(h.change_pct)}</div>
        <div className="text-xs text-slate-400">
          {h.source === 'live' ? (market === 'US' ? `類股 ETF 即時報價・${fmtAsOf(h.as_of)}` : `證交所即時類股指數・${fmtAsOf(h.as_of)}`) : h.source === 'daily' ? `證交所盤後資料・${fmtAsOf(h.as_of)}（這個類股沒有即時指數）` : '目前沒有資料'}
        </div>
        <div className="text-xs text-slate-300">成交金額占上市類股 {h.turnover_share_pct ?? '—'}%</div>
        {h.chains.length ? (
          <div className="border-t border-slate-800 pt-2 space-y-1.5">
            <div className="text-[11px] text-cyan-300 tracking-wider">產業鏈（{h.chains.length}）</div>
            <div className="flex flex-wrap gap-1">
              {h.chains.map((id) => (
                <button key={id} type="button" onClick={() => onChain(id)} className={BTN}>
                  {map.chains.find((c) => c.id === id)?.name} ▸
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="text-xs text-slate-500 border-t border-slate-800 pt-2">這個產業別還沒有整理產業鏈。之後在 src/market/chain_data.py 新增即可，地圖會自動出現。</div>
        )}
      </div>
    );
  }
  const useHist = replay.on && hist && !hist.error;
  const day = replay.day;
  const nodeVal = (id) => (useHist ? pickSeries(hist.nodes[id], day, replay.cum) : (det?.nodes[id]?.change_pct ?? null));
  const sum = det?.summary;
  const node = view.node ? chain.nodes.find((n) => n.id === view.node) : null;
  return (
    <div className="space-y-2">
      <div className="text-[11px] text-slate-400 tracking-wider">
        {chain.sector}
        {node ? `・${chain.stages[node.stage]}` : ''}
      </div>
      <h2 className="text-xl font-bold text-white">{node ? node.name : chain.name}</h2>
      {!node && <div className="text-xs text-slate-400">{chain.blurb}</div>}
      {!node && sectorHub && sectorHub.chains.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {sectorHub.chains.map((id) => (
            <button key={id} type="button" onClick={() => onChain(id)} className={`${BTN} ${id === chain.id ? 'border-cyan-400 bg-cyan-500/15' : ''}`}>
              {map.chains.find((c) => c.id === id).name}
            </button>
          ))}
        </div>
      )}
      {node ? (
        <>
          <div className={`text-3xl font-extrabold tabular-nums ${toneCls(nodeVal(node.id))}`}>{fmtPct(nodeVal(node.id))}</div>
          <div className="text-xs text-slate-400">
            上一環：{chain.edges.filter((e) => e[1] === node.id).map((e) => chain.nodes.find((n) => n.id === e[0]).name).join('、') || '—'}　下一環：
            {chain.edges.filter((e) => e[0] === node.id).map((e) => chain.nodes.find((n) => n.id === e[1]).name).join('、') || '—'}
          </div>
          <div className="text-[11px] text-cyan-300 tracking-wider pt-1">成分個股</div>
          {node.stocks.map((s) => {
            const st = det?.stocks[s.code];
            const v = useHist ? pickSeries(hist.stocks[s.code], day, replay.cum) : st?.ok ? st.change_pct : null;
            return (
              <Row key={s.code} left={s.code} mid={st?.name || s.name} bar={v ?? 0} right={fmtPct(v)} tone={toneCls(v)} />
            );
          })}
          {!useHist && (
            <div className="text-[11px] text-slate-500">
              成交值：
              {node.stocks.map((s) => `${s.name} ${fmtYi(det?.stocks[s.code]?.turnover, market)}`).join('、')}
            </div>
          )}
        </>
      ) : (
        <>
          <div className={`text-3xl font-extrabold tabular-nums ${toneCls(useHist ? null : sum?.change_pct)}`}>
            {useHist ? (hist.dates[day] || '').slice(5) : fmtPct(sum?.change_pct)}
          </div>
          <div className="text-xs text-slate-400">
            {useHist
              ? `回放第 ${day + 1}/${hist.dates.length} 天・個股日報酬；環節＝個股等權平均（即時模式是成交值加權，數字會不同）`
              : det
                ? `${sum.n_ok}/${sum.n_total} 檔有報價・${fmtAsOf(det.as_of)}`
                : '載入個股報價中…'}
          </div>
          {det?.error && <div className="text-xs text-amber-300 bg-amber-900/20 border border-amber-800/50 rounded p-2">{det.error}</div>}
          {chain.stages.map((st, si) => (
            <div key={st}>
              <div className="text-[11px] text-cyan-300 tracking-wider pt-1">{st}</div>
              {chain.nodes
                .filter((n) => n.stage === si)
                .map((n) => (
                  <Row key={n.id} left="" mid={n.name} right={fmtPct(nodeVal(n.id))} tone={toneCls(nodeVal(n.id))} onClick={() => onNode(n.id)} />
                ))}
            </div>
          ))}
          {useHist && (
            <div className="pt-2">
              <div className="text-[11px] text-cyan-300 tracking-wider">各階段累積漲跌（看傳導的時間差）</div>
              <StageChart chain={chain} hist={hist} day={day} />
            </div>
          )}
        </>
      )}
      <div className="text-[11px] text-slate-500 border-t border-slate-800 pt-2 leading-relaxed">
        環節分類為自行整理的示意，上中下游只表示產業位置，不等於供應商與客戶的實際供應關係。不構成投資建議。
      </div>
    </div>
  );
}

// ---- 搜尋產業：輸入名稱 → 候選清單 → 鏡頭飛過去 ----
type Hit = { label: string; kind: 'sector' | 'chain' | 'node' | 'stock'; sector: string; chain?: string; node?: string; sub: string };
const KIND_LABEL = { sector: '產業別', chain: '產業鏈', node: '環節', stock: '個股' };
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '');

function buildIndex(map): Hit[] {
  const out: Hit[] = [];
  for (const h of map.hubs) out.push({ label: h.name, kind: 'sector', sector: h.name, sub: h.chains.length ? `${h.chains.length} 條產業鏈` : '尚無產業鏈' });
  for (const c of map.chains) {
    out.push({ label: c.name, kind: 'chain', sector: c.sector, chain: c.id, sub: c.sector });
    for (const n of c.nodes) {
      out.push({ label: n.name, kind: 'node', sector: c.sector, chain: c.id, node: n.id, sub: `${c.name}・${c.stages[n.stage]}` });
      for (const s of n.stocks) out.push({ label: `${s.code} ${s.name}`, kind: 'stock', sector: c.sector, chain: c.id, node: n.id, sub: `${c.name}・${n.name}` });
    }
  }
  return out;
}

function searchHits(index: Hit[], q: string): Hit[] {
  const k = norm(q);
  if (!k) return [];
  const order = { sector: 0, chain: 1, node: 2, stock: 3 };
  return index
    .map((h) => {
      const t = norm(h.label);
      return { h, s: t === k ? 0 : t.startsWith(k) ? 1 : t.includes(k) ? 2 : 9 };
    })
    .filter((x) => x.s < 9)
    .sort((a, b) => a.s - b.s || order[a.h.kind] - order[b.h.kind])
    .slice(0, 8)
    .map((x) => x.h);
}

function ChainSearch({ map, onPick }: { map: any; onPick: (h: Hit) => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);
  const index = useMemo(() => (map ? buildIndex(map) : []), [map]);
  const hits = useMemo(() => searchHits(index, q), [index, q]);
  const pick = (h: Hit) => {
    onPick(h);
    setQ('');
    setOpen(false);
    setIdx(0);
  };
  const listId = 'chain-search-list';
  return (
    <div className="relative">
      <input
        type="search"
        value={q}
        disabled={!map}
        placeholder="搜尋產業、環節或個股（半導體、2330）"
        aria-label="搜尋產業並前往"
        role="combobox"
        aria-expanded={open && q.trim() !== ''}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setIdx(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (hits.length) setIdx((i) => (i + (e.key === 'ArrowDown' ? 1 : hits.length - 1)) % hits.length);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            if (hits[idx]) pick(hits[idx]);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
        className="w-56 px-2.5 py-1 text-xs rounded-lg bg-slate-900/80 border border-slate-700/70 text-slate-100 placeholder:text-slate-500 outline-none focus:border-cyan-400"
      />
      {open && q.trim() !== '' && (
        <div id={listId} role="listbox" className={`${PANEL} absolute left-0 top-9 w-64 p-1 z-20`} style={{ backgroundColor: "rgb(2 6 23)" }}>
          {hits.length === 0 && <div className="px-2 py-1.5 text-xs text-slate-400">找不到「{q.trim()}」，試試產業別或產業鏈名稱</div>}
          {hits.map((h, i) => (
            <div
              key={`${h.kind}-${h.chain || ''}-${h.node || h.label}`}
              role="option"
              aria-selected={i === idx}
              tabIndex={-1}
              onMouseDown={(e) => {
                e.preventDefault(); // 不要讓輸入框先失焦、清單先收起來
                pick(h);
              }}
              onMouseEnter={() => setIdx(i)}
              className={`flex items-center justify-between gap-2 px-2 py-1 rounded-md text-[13px] cursor-pointer ${i === idx ? 'bg-cyan-500/20' : ''}`}
            >
              <span className="truncate text-slate-100">{h.label}</span>
              <span className="text-[10px] text-slate-400 shrink-0">
                {KIND_LABEL[h.kind]}・{h.sub}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// 滑鼠移動時只重繪這個小元件，不牽動整個頁面
function HoverTip({ apiRef }) {
  const [h, setH] = useState(null);
  useEffect(() => {
    apiRef.current = setH;
    return () => {
      apiRef.current = null;
    };
  }, [apiRef]);
  if (!h) return null;
  return (
    <div className="fixed z-50 pointer-events-none px-2.5 py-1.5 rounded-lg text-xs bg-slate-950/95 border border-slate-600 text-slate-100 whitespace-nowrap" style={{ left: h.x + 14, top: h.y + 14 }}>
      <b>{h.kind === 'stock' ? `${h.code} ${h.name}` : h.name}</b> <span className={toneCls(h.has ? h.v : null)}>{fmtPct(h.has ? h.v : null)}</span>
      <div className="text-slate-400">
        {h.kind === 'hub' ? (h.hasChains ? '點擊展開產業鏈' : `${h.note || '無資料'}・這個類股還沒有產業鏈`) : h.kind === 'node' ? '點擊看成分個股' : ''}
      </div>
    </div>
  );
}

function IndustryChainPage() {
  const canvasRef = useRef(null);
  const miniRef = useRef(null);
  const boxRef = useRef(null);
  const engineRef = useRef(null);
  const [map, setMap] = useState(null);
  const [mapErr, setMapErr] = useState('');
  const [market, setMarket] = useState('TW'); // 'TW' 台股（證交所類股）／'US' 美股（SPDR 類股 ETF）
  const [view, setView] = useState({ state: 'overview', chain: null, node: null, sector: null });
  const [details, setDetails] = useState({});
  const [history, setHistory] = useState({});
  const [histLoading, setHistLoading] = useState(false);
  const [histErr, setHistErr] = useState('');
  const [replay, setReplay] = useState({ on: false, day: 0, cum: false, playing: false });
  const [listOpen, setListOpen] = useState(true);
  const [anim, setAnim] = useState(true);
  const [debug, setDebug] = useState(false);
  const [stats, setStats] = useState(null);
  const tipRef = useRef(null);

  const hubMap = useMemo(() => Object.fromEntries((map?.hubs || []).map((h) => [h.name, h])), [map]);
  // 引擎每幀讀的最新資料（用 ref，不必每次資料更新都重建引擎）
  const dataRef = useRef({ hubMap: {}, details: {}, history: {}, replay });
  dataRef.current = { hubMap, details, history, replay };
  const listRef = useRef(listOpen);
  listRef.current = listOpen;

  // ---- 引擎 ----
  useEffect(() => {
    const canvas = canvasRef.current;
    const box = boxRef.current;
    const host = {
      reduced: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      get minimap() {
        return miniRef.current; // 明細面板開著時小地圖會卸載，所以每次都現取
      },
      read: (kind, a, b) => readValue(dataRef.current, kind, a, b),
      insets: (S) => {
        const wide = box.clientWidth >= 900;
        return { l: wide && listRef.current && S.state === 'overview' ? 268 : 0, r: wide && (S.state !== 'overview' || S.sector) ? 352 : 0, t: 58, b: S.state === 'overview' ? 18 : 84 };
      },
      onState: (S) => setView(S),
      onHover: (info, x, y) => tipRef.current?.(info ? { ...info, x, y } : null),
    };
    const engine = ChainEngine.create(canvas, host);
    engineRef.current = engine;
    const ro = new ResizeObserver(() => engine.resize(box.clientWidth, box.clientHeight));
    ro.observe(box);
    engine.resize(box.clientWidth, box.clientHeight);
    engine.start();
    if (host.reduced) setAnim(false);
    return () => {
      ro.disconnect();
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  // ---- 全景資料 ----
  const marketRef = useRef(market);
  marketRef.current = market;
  const loadMap = useCallback(() => {
    const asked = market;
    fetch(asked === 'US' ? '/api/chains/map_us' : '/api/chains/map')
      .then((r) => {
        if (r.status === 404 && asked === 'US') throw new Error('美股產業鏈需要新版後端，請重新安裝新版程式（線上更新只能更新畫面）');
        return r.json();
      })
      .then((d) => {
        if (marketRef.current !== asked) return; // 回應回來時已經切到另一個市場：丟掉，免得舊市場的地圖蓋掉新的
        if (d.error && !d.hubs) throw new Error(d.error);
        setMap(d);
        setMapErr('');
        engineRef.current?.setMap(d);
      })
      .catch((e) => marketRef.current === asked && setMapErr(e.message || String(e)));
  }, [market]);
  // 切換台股／美股：清掉舊市場的資料與回放、回到全景，再載入新市場的地圖
  const firstMarket = useRef(true);
  useEffect(() => {
    if (firstMarket.current) {
      firstMarket.current = false;
    } else {
      setMap(null);
      setMapErr('');
      setDetails({});
      setHistory({});
      setHistErr('');
      setReplay({ on: false, day: 0, cum: false, playing: false });
      engineRef.current?.go({ state: 'overview', sector: null }, true);
    }
    loadMap();
    return pollEvery(loadMap, 30000);
  }, [loadMap]);

  // ---- 目前產業鏈的即時報價 ----
  const chainId = view.chain;
  // 切換市場的瞬間 view 與地圖還是舊市場的：地圖屬於目前市場、而且有這條鏈才送請求，免得拿美股鏈代號去查台股
  const chainKnown = Boolean(chainId && map && (map.market || 'TW') === market && map.chains.some((c) => c.id === chainId));
  useEffect(() => {
    if (!chainKnown) return undefined;
    const load = () =>
      postJson('/api/chains/detail', { id: chainId, market })
        .then((d) => setDetails((m) => ({ ...m, [chainId]: d })))
        .catch((e) => setDetails((m) => ({ ...m, [chainId]: { error: e.message, nodes: {}, stocks: {}, summary: { change_pct: null, n_ok: 0, n_total: 0 } } })));
    load();
    return pollEvery(load, 30000);
  }, [chainId, market, chainKnown]);

  // ---- 離開產業鏈就結束回放 ----
  useEffect(() => {
    // 離開或換到另一條產業鏈：結束回放（每條鏈的歷史天數可能不同，沿用舊的日期位置會越界）
    setReplay((r) => (r.on ? { on: false, day: 0, cum: false, playing: false } : r));
  }, [chainId]);

  // ---- 回放播放 ----
  useEffect(() => {
    if (!replay.playing) return undefined;
    const hist = history[chainId];
    const id = setInterval(() => {
      setReplay((r) => (r.day >= (hist?.dates.length || 1) - 1 ? { ...r, playing: false } : { ...r, day: r.day + 1 }));
      setTimeout(() => engineRef.current?.burst(), 260);
    }, 700);
    return () => clearInterval(id);
  }, [replay.playing, history, chainId]);

  // ---- 版面或選取變化時重新取景 ----
  useEffect(() => {
    engineRef.current?.refit();
  }, [listOpen, view.sector]);
  useEffect(() => {
    engineRef.current?.setAnim(anim);
  }, [anim]);
  useEffect(() => {
    if (!debug) return undefined;
    const id = setInterval(() => setStats(engineRef.current?.stats() || null), 500);
    return () => clearInterval(id);
  }, [debug]);

  const hist = chainId ? history[chainId] : null;
  const histOk = hist && !hist.error;
  const startReplay = () => {
    const open = (h) => setReplay({ on: true, day: h.dates.length - 1, cum: false, playing: false });
    if (histOk) return open(hist);
    setHistLoading(true);
    setHistErr('');
    postJson('/api/chains/history', { id: chainId, days: 30, market })
      .then((h) => {
        setHistory((m) => ({ ...m, [chainId]: h }));
        if (h.error) setHistErr(h.error);
        else open(h);
      })
      .catch((e) => setHistErr(e.message || String(e)))
      .finally(() => setHistLoading(false));
    return undefined;
  };

  // 搜尋後的導覽：先回全景對準該產業（擴散波）→ 鏡頭推進產業鏈 → 再推進到環節。每一步都用引擎既有的鏡頭補間
  const viewRef = useRef(view);
  viewRef.current = view;
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [trip, setTrip] = useState('');
  const clearTimers = () => {
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];
  };
  useEffect(() => clearTimers, []);
  const flyTo = (h: Hit) => {
    const eng = engineRef.current;
    if (!eng) return;
    clearTimers();
    const later = (fn: () => void, ms: number) => timers.current.push(setTimeout(fn, ms));
    const fromDeep = viewRef.current.state !== 'overview';
    const t1 = fromDeep ? 1000 : 400; // 從產業鏈內部出發要先等鏡頭拉回全景
    setReplay({ on: false, day: 0, cum: false, playing: false });
    setTrip(h.kind === 'sector' ? h.label : h.kind === 'chain' ? (h.sector === h.label ? h.label : `${h.sector} › ${h.label}`) : `${h.sub.replace('・', ' › ')} › ${h.label}`);
    eng.go({ state: 'overview', sector: h.sector });
    later(() => eng.ping('hub', h.sector), t1);
    if (h.kind !== 'sector') {
      const chain = h.chain as string;
      later(() => eng.go({ state: 'chain', chain }), t1 + 600);
      if (h.node) {
        later(() => eng.go({ state: 'node', chain, node: h.node }), t1 + 600 + 1300);
        later(() => eng.ping('node', h.node as string), t1 + 600 + 1300 + 700);
      }
    }
    later(() => setTrip(''), t1 + 600 + (h.node ? 2000 : 1100) + 400);
  };

  const goChain = (id) => engineRef.current?.go({ state: 'chain', chain: id });
  const goNode = (id) => engineRef.current?.go({ state: 'node', chain: chainId, node: id });
  const clickSector = (h) => (h.chains.length ? goChain(h.chains[0]) : engineRef.current?.go({ state: 'overview', sector: h.name }));
  const ranked = useMemo(() => [...(map?.hubs || [])].sort((a, b) => (b.change_pct ?? -999) - (a.change_pct ?? -999)), [map]);
  const withData = ranked.filter((h) => h.change_pct !== null);
  const showDetail = view.state !== 'overview' || view.sector;

  return (
    <div className="space-y-3" data-tour="chains-root">
      <div
        ref={boxRef}
        role="application"
        aria-label="產業鏈互動地圖"
        tabIndex={-1}
        onKeyDown={(e) => {
          if (!(e.target as HTMLElement).matches?.('input,select,textarea') && engineRef.current?.key(e)) e.preventDefault();
        }}
        className="relative rounded-2xl border border-slate-800 overflow-hidden outline-none"
        style={{ height: 'calc(100vh - 230px)', minHeight: 560, background: '#03050b' }}
      >
        <canvas
          ref={canvasRef}
          tabIndex={0}
          aria-label="產業鏈互動地圖：拖曳平移、滾輪縮放、點擊產業進入，Esc 返回上一層"
          className="absolute inset-0 block touch-none outline-none"
          style={{ width: '100%', height: '100%' }}
        />

        {/* 上方：產業鏈切換與工具 */}
        <div className="absolute z-30 left-3 right-3 top-3 flex flex-wrap xl:flex-nowrap items-center gap-2 pointer-events-none">
          <div className={`${PANEL} px-2 py-1.5 flex flex-wrap xl:flex-nowrap xl:min-w-0 items-center gap-1 pointer-events-auto`}>
            <fieldset className="flex m-0 p-0 min-w-0 rounded-lg overflow-hidden border border-slate-700/70 mr-1" aria-label="市場">
              {[['TW', '台股'], ['US', '美股']].map(([m, label]) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={market === m}
                  onClick={() => setMarket(m)}
                  className={`px-2.5 py-1 text-xs cursor-pointer ${market === m ? 'bg-cyan-500/25 text-cyan-100' : 'bg-slate-900/80 text-slate-300 hover:text-white'}`}
                >
                  {label}
                </button>
              ))}
            </fieldset>
            <ChainSearch map={map} onPick={flyTo} />
            <span className="text-[11px] text-slate-400 px-1">產業鏈</span>
            {/* 產業鏈變多了（25 條）：單行橫向捲動，不要把工具列撐成好幾排蓋住下面的清單 */}
            <div className="flex gap-1 overflow-x-auto pb-1 w-full min-w-0 xl:w-auto xl:flex-1">
              {(map?.chains || []).map((c) => (
                <button key={c.id} type="button" onClick={() => goChain(c.id)} className={`${BTN} shrink-0 whitespace-nowrap ${view.chain === c.id ? 'border-cyan-400 bg-cyan-500/20' : ''}`}>
                  {c.name}
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1" />
          <div className="flex gap-1.5 pointer-events-auto shrink-0">
            {view.state !== 'overview' && (
              <button type="button" className={BTN} onClick={() => engineRef.current?.back()}>
                ← 返回
              </button>
            )}
            <button type="button" className={BTN} onClick={() => engineRef.current?.refit()}>
              ⌖ 重置視角
            </button>
            <button type="button" className={`${BTN} ${listOpen ? 'border-cyan-400' : ''}`} aria-pressed={listOpen} onClick={() => setListOpen((v) => !v)}>
              ☰ 清單
            </button>
            <button type="button" className={`${BTN} ${debug ? 'border-cyan-400' : ''}`} aria-pressed={debug} onClick={() => setDebug((v) => !v)}>
              ⚙ 引擎
            </button>
          </div>
        </div>

        {trip && (
          <div className={`${PANEL} absolute left-1/2 -translate-x-1/2 top-16 max-w-[92%] text-center px-4 py-1.5 text-sm text-cyan-100 pointer-events-none z-10 animate-pulse`} role="status">
            ✈ 前往 {trip}…
          </div>
        )}

        {/* 左側：全部產業清單 */}
        {listOpen && map && view.state === 'overview' && (
          <aside className={`${PANEL} absolute left-3 top-28 xl:top-14 ${debug ? 'bottom-44' : 'bottom-24'} w-[250px] p-2.5 overflow-auto hidden md:block`} aria-label="全部產業">
            <div className="flex items-center gap-1 text-[11px] text-slate-400 tracking-wider mb-1.5">
              全部產業（{map.hubs.length}）
              <Tip text="證交所全部類股。漲跌用即時類股指數（盤中隨成交更新），少數類股沒有即時指數就用盤後資料。有「鏈」標記的可以點進去看上中下游環節與個股。" />
            </div>
            {withData.length > 1 && (
              <div className="grid gap-0.5 text-[11px] p-2 mb-2 rounded-lg bg-cyan-500/5 border border-slate-700/60">
                <div className="flex justify-between">
                  <span className="text-slate-400">最強</span>
                  <span className={toneCls(withData[0].change_pct)}>
                    {withData[0].name} {fmtPct(withData[0].change_pct)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">最弱</span>
                  <span className={toneCls(withData[withData.length - 1].change_pct)}>
                    {withData[withData.length - 1].name} {fmtPct(withData[withData.length - 1].change_pct)}
                  </span>
                </div>
              </div>
            )}
            {ranked.map((h) => (
              <button
                key={h.name}
                type="button"
                onClick={() => clickSector(h)}
                className={`w-full flex items-center justify-between gap-2 px-2 py-1 rounded-md text-[13px] hover:bg-cyan-500/10 cursor-pointer ${view.sector === h.name ? 'bg-cyan-500/15' : ''}`}
              >
                <span className="truncate text-left text-slate-200">
                  {h.name}
                  {h.chains.length > 0 && <span className="ml-1 text-[10px] text-cyan-300">鏈</span>}
                </span>
                <span className={`tabular-nums ${toneCls(h.change_pct)}`}>{fmtPct(h.change_pct)}</span>
              </button>
            ))}
          </aside>
        )}

        {/* 右側：明細 */}
        {showDetail && map && (
          <aside className={`${PANEL} absolute right-3 top-44 xl:top-14 bottom-44 md:bottom-24 w-[330px] max-w-[calc(100%-1.5rem)] p-3 overflow-auto`} aria-live="polite">
            <DetailPanel
              view={view}
              map={map}
              hubMap={hubMap}
              det={chainId ? details[chainId] : null}
              hist={hist}
              replay={replay}
              market={market}
              onNode={goNode}
              onChain={goChain}
            />
          </aside>
        )}

        {/* 下方：回放列 */}
        <div className={`${PANEL} absolute left-1/2 -translate-x-1/2 bottom-3 px-3 py-2 flex flex-wrap items-center justify-center gap-2.5 max-w-[calc(100%-1.5rem)]`}>
          {chainId ? (
            replay.on && histOk ? (
              <>
                <button type="button" className={BTN} onClick={() => setReplay((r) => (r.day >= hist.dates.length - 1 ? { ...r, day: 0, playing: true } : { ...r, playing: !r.playing }))}>
                  {replay.playing ? '⏸ 暫停' : '▶ 播放'}
                </button>
                <input
                  type="range"
                  min="0"
                  max={hist.dates.length - 1}
                  value={replay.day}
                  aria-label="回放日期"
                  className="w-44 accent-cyan-400"
                  onChange={(e) => {
                    const day = Number(e.target.value);
                    setReplay((r) => ({ ...r, day, playing: false }));
                  }}
                />
                <span className="text-xs text-slate-300 tabular-nums w-24">{hist.dates[replay.day]}</span>
                <label className="text-xs text-slate-400 flex items-center gap-1 cursor-pointer">
                  <input type="checkbox" checked={replay.cum} onChange={(e) => setReplay((r) => ({ ...r, cum: e.target.checked }))} className="accent-cyan-400" />
                  累積
                </label>
                <button type="button" className={BTN} onClick={() => setReplay({ on: false, day: 0, cum: false, playing: false })}>
                  回到即時
                </button>
              </>
            ) : (
              <>
                <button type="button" className={BTN} disabled={histLoading} onClick={startReplay}>
                  {histLoading ? '載入歷史日 K…' : '▶ 回放近 30 日'}
                </button>
                <span className="text-[11px] text-slate-400">{histErr ? <span className="text-amber-300">{histErr}</span> : '目前是即時報價；回放可看漲跌怎麼由上游傳到下游'}</span>
              </>
            )
          ) : (
            <span className="text-[11px] text-slate-400">拖曳平移・滾輪縮放・點擊有「鏈」的產業展開・Esc 返回</span>
          )}
          <button type="button" className={`${BTN} ${anim ? 'border-cyan-400' : ''}`} aria-pressed={anim} onClick={() => setAnim((v) => !v)}>
            流動動畫
          </button>
        </div>

        {!showDetail && (
          <canvas
            ref={miniRef}
            width="400"
            height="240"
            aria-label="小地圖，點擊可移動視角"
            onPointerDown={(e) => engineRef.current?.minimapClick(e)}
            className={`${PANEL} absolute right-3 bottom-3 w-[200px] h-[120px] cursor-crosshair hidden lg:block`}
          />
        )}

        {debug && stats && (
          <pre className="absolute left-3 bottom-3 m-0 px-2.5 py-2 rounded-lg text-[11px] leading-snug text-cyan-200 bg-black/70 border border-cyan-500/30 pointer-events-none">
            {`FPS        ${stats.fps.toFixed(0)}\n更新次數   ${stats.ticks}（固定 60Hz）\n實體數     ${stats.entities}（本幀繪製 ${stats.drawn}）\n粒子(活動) ${stats.particles}/${stats.particlesMax}\n補間動畫   ${stats.tweens}\n攝影機     (${stats.camX.toFixed(0)}, ${stats.camY.toFixed(0)}) x${stats.zoom.toFixed(2)}\n狀態       ${stats.state}${stats.chain ? ` / ${stats.chain}` : ''}${stats.node ? ` / ${stats.node}` : ''}\n畫布       ${stats.w}x${stats.h} @${stats.dpr}x`}
          </pre>
        )}

        {!map && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-300 pointer-events-none">
            {mapErr ? (
              <div className="pointer-events-auto text-center space-y-2">
                <div className="text-rose-300">產業資料取得失敗：{mapErr}</div>
                <button type="button" className={BTN} onClick={loadMap}>
                  重試
                </button>
              </div>
            ) : (
              '載入全部產業中…'
            )}
          </div>
        )}

        <HoverTip apiRef={tipRef} />
      </div>

      <p className="text-[11px] text-slate-500 leading-relaxed">
        {map
          ? `${map.source}。分類版本 ${map.version}，更新 ${map.timestamp}${map.errors?.length ? `　⚠ ${map.errors.join('；')}` : ''}。`
          : ''}
        產業鏈的環節與個股為自行整理的示意分類（不是官方資料）；漲跌為即時或盤後行情，僅供研究參考，不構成投資建議。
      </p>
    </div>
  );
}

export { IndustryChainPage };
