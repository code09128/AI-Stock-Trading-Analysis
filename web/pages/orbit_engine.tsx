// 產業鏈地圖的畫面引擎：軌道版（Canvas 2D，不依賴任何套件）。對外介面與舊的格子版引擎相同，頁面（industry_chain.tsx）只負責資料與 HUD。
// 三層，同一套引力與天氣，一層牽一層：
//   全景  核心＝大盤（台股加權指數／美股 S&P 500），類股依上下游分圈繞行（材料 → 元件 → 模組 → 終端，由內到外）
//   產業鏈 核心＝該類股，環節依上中下游分圈繞行
//   環節  核心＝該環節，代表個股像衛星繞行
// 視覺（UE 風格）：
//   光層 L（會動、會發光的東西：吸積盤、光束、列車、風暴粒子、閃電）不每幀清空而是慢慢淡出 → 柔和殘影
//   Bloom：前景縮小（1/4、1/8）再放大疊回去，所有光融在一起；背景（星空＋銀河）最後才墊到下面，不會被洗白
//   星空：程式畫的三層視差星點（像 Niagara 粒子，永遠清楚）＋銀河自發光層（Poly Haven CC0 全景轉檔，見 tools/sky_emissive.py）
//   曝光鎖定：不做自動曝光，拖曳、縮放、切換層級時亮度固定
// 強度 power：漲跌越大越強（連續），決定重力井深度、吸積盤、引力絲、拉動鄰居的力道、列車長度、風暴粒子量。
// 天氣：漲跌幅排名前幾且夠大 → 大漲龍捲風（上升氣流）／大跌漩渦（往下沉）；次一級 → 風暴雲（漲＝火花上飄、跌＝下雨）；
//   相關的一起大漲或大跌 → 風暴前緣（成片的雲與閃電）。門檻見 gradeStorms（示意值，不是統計檢定）。
// 引擎只管「畫」。數字都由外部的 host.read(kind, a, b) 提供（'index' | 'hub' | 'node' | 'stock'），引擎每幀讀取，回放與即時都自動跟上。
// 效能：大螢幕太慢時自動降畫質（先關 bloom 的 1/4 層與顆粒，再減光塵），快了再升回來；stats() 可看目前畫質。

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const mix = (a: number[], b: number[], t: number) => a.map((v, i) => lerp(v, b[i], t));
const rgba = (c: number[], a: number) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
// 台股習慣：紅漲綠跌；切換為美股配色（html[data-color="us"]）則綠漲紅跌
const UP = [255, 77, 109];
const DOWN = [45, 255, 160];
const FLAT = [122, 162, 255];
const NONE = [96, 112, 150];
const isUsColor = () => typeof document !== 'undefined' && document.documentElement?.dataset?.color === 'us';
const toneDir = (d: number) => (d === 0 ? FLAT : (d > 0) !== isUsColor() ? UP : DOWN);
const toneOf = (v: number, has: boolean) => (!has ? NONE : Math.abs(v) < 0.05 ? FLAT : toneDir(Math.sign(v)));
const toneX = (x: any) => toneOf(x.v, x.has); // 有數值的東西（核心、類股、環節、個股）依漲跌取色
const pct = (v: number, has: boolean) => (!has ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`);
const FONT = '"Noto Sans TC","Microsoft JhengHei",system-ui,sans-serif';
const MONO = 'Consolas,"JetBrains Mono",monospace';
function powerOf(v: number) {
  return clamp(Math.abs(v) / 6, 0, 1.6); // ±6% ≈ 1，±9.6% 封頂
}
// 類股、環節、個股共用的欄位：數值（host.read 讀進來）＋天氣與強度（gradeStorms 算）
const ent = (kind: string, extra: any): any => ({ kind, v: 0, has: false, note: '', storm: 0, dir: 0, power: 0, particles: [], disk: [], ...extra });
const setVal = (x: any, r: any) => {
  const q = r || {};
  x.has = q.v !== null && q.v !== undefined;
  x.v = x.has ? q.v : 0;
  x.note = q.note || '';
};
const sigOf = (list: any[]) => list.map((x) => (x.has ? x.v.toFixed(1) : '-')).join(','); // 數值有沒有變（到 0.1%）

// ---- 版面（世界座標；y 是軌道平面上的深度方向，畫面上會乘以傾斜）----
const RING0 = 190;
const RING_GAP = 125;
const STAGE0 = 70;
const STAGE_GAP = 62;
const SKY_SRC: Record<string, string> = { strong: 'assets/sky/rogland_emissive.png', soft: 'assets/sky/qwantani_emissive.png' };

function create(canvas: HTMLCanvasElement, host: any) {
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  let DPR = 1;
  let W = 1;
  let H = 1;
  const mk = (): [HTMLCanvasElement, CanvasRenderingContext2D] => {
    const c = document.createElement('canvas');
    return [c, c.getContext('2d') as CanvasRenderingContext2D];
  };
  const [Lc, lx] = mk(); // 光層
  const [B1, b1] = mk(); // bloom 1/4
  const [B2, b2] = mk(); // bloom 1/8
  const [Bc, bx] = mk(); // 背景（半解析度）
  const [Gc, gx] = mk(); // 顆粒
  Gc.width = Gc.height = 192;
  {
    const im = gx.createImageData(192, 192);
    for (let i = 0; i < im.data.length; i += 4) {
      const v = Math.random() * 255;
      im.data[i] = im.data[i + 1] = im.data[i + 2] = v;
      im.data[i + 3] = 22;
    }
    gx.putImageData(im, 0, 0);
  }
  // 光暈貼圖：顏色取到 8 的倍數當快取鍵（景深霧化算出的顏色是小數，不取整會每幀新增貼圖、越跑越慢）
  const glowCache = new Map<string, HTMLCanvasElement>();
  const glow = (c0: number[]) => {
    const c = c0.map((v) => Math.min(255, Math.round(v / 8) * 8));
    const k = c.join(',');
    const hit = glowCache.get(k);
    if (hit) return hit;
    if (glowCache.size > 400) glowCache.clear();
    const [g, x] = mk();
    g.width = g.height = 128;
    const gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, rgba(c, 0.9));
    gr.addColorStop(0.25, rgba(c, 0.35));
    gr.addColorStop(1, rgba(c, 0));
    x.fillStyle = gr;
    x.fillRect(0, 0, 128, 128);
    glowCache.set(k, g);
    return g;
  };
  const sprite = (stops: [number, string][]) => {
    const [c, x] = mk();
    c.width = c.height = 128;
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    for (const [o, col] of stops) g.addColorStop(o, col);
    x.fillStyle = g;
    x.fillRect(0, 0, 128, 128);
    return c;
  };
  const CLOUD = sprite([[0, 'rgba(92,108,148,.55)'], [0.55, 'rgba(64,78,116,.32)'], [1, 'rgba(50,62,96,0)']]);
  const VOID = sprite([[0, 'rgba(0,0,0,.55)'], [0.5, 'rgba(4,10,20,.25)'], [1, 'rgba(0,0,0,0)']]);
  const SKY: Record<string, HTMLImageElement> = {};
  for (const [k, src] of Object.entries(SKY_SRC)) {
    const im = new Image();
    im.src = src; // 載入失敗就只有程式星空（不影響其他功能）
    SKY[k] = im;
  }

  // ---- 狀態 ----
  const S: any = { state: 'overview', chain: null, node: null, sector: null };
  const E: any = {
    t: 0, timeScale: 1, motion: !host.reduced, tilt: 0.42, fx: { sky: 'strong', tilt: true }, hover: null,
    cam: { x: 0, y: 0, z: 0.8 }, camTo: { x: 0, y: 0, z: 0.8 }, pan: { x: 0, y: 0 }, zoomK: 1, dragging: false, focusT: 0, nodeT: 0,
    shock: [], bolts: [], effects: [], fps: 60, ms: 0, quality: 2, slow: 0, fast: 0, ticks: 0, drawn: 0, map: null, sig: '', gradeAt: 0, gradeSig: '',
  };
  let hubs: any[] = [];
  let hubByName: Record<string, any> = {};
  let links: any[] = [];
  let chains: Record<string, any> = {};
  let OUTER = RING0 + 3 * RING_GAP + 70;
  let ringCount = 4;
  const index = ent('index', { name: '大盤' });
  const stars = [0.15, 0.35, 0.7].map((depth, L) =>
    Array.from({ length: 260 - L * 70 }, () => ({ x: Math.random() * 4000 - 2000, y: Math.random() * 4000 - 2000, r: Math.random() * (0.6 + L * 0.5) + 0.2, a: Math.random() * 0.6 + 0.2, tw: Math.random() * 6, depth })),
  );
  const spawnDust = (anywhere: boolean) => ({
    r: anywhere ? 62 + (OUTER - 62) * Math.random() ** 1.6 : OUTER - Math.random() * 40, th: Math.random() * Math.PI * 2, s: Math.random() * 1.4 + 0.4, b: Math.random() * 0.6 + 0.4,
  });
  let dust: any[] = [];
  const resetDust = () => {
    dust = Array.from({ length: 750 }, () => spawnDust(true));
  };
  resetDust();

  // ---- 投影：面板開著時，畫面中心往空的那一側移 ----
  const view = () => {
    const ins = host.insets(S) || { l: 0, r: 0, t: 0, b: 0 };
    return { cx: ins.l + (W - ins.l - ins.r) / 2, cy: ins.t + (H - ins.t - ins.b) / 2, aw: Math.max(200, W - ins.l - ins.r), ah: Math.max(200, H - ins.t - ins.b) };
  };
  let V = { cx: 0, cy: 0, aw: 1, ah: 1 };
  const project = (wx: number, wy: number) => ({ x: V.cx + (wx - E.cam.x) * E.cam.z, y: V.cy + (wy * E.tilt - E.cam.y) * E.cam.z });
  const fitZoom = () => Math.min(V.aw / (2 * (OUTER + 60)), V.ah / (2 * (OUTER + 60) * 0.42 + 110));

  // ---- 建立模型 ----
  function build(map: any) {
    const cols = Math.max(1, (map.columns || []).length);
    ringCount = cols;
    OUTER = RING0 + (cols - 1) * RING_GAP + 70;
    resetDust();
    hubs = [];
    const byCol: any[][] = Array.from({ length: cols }, () => []);
    for (const def of map.hubs) {
      const h = ent('hub', { name: def.name, def, ring: clamp(def.col ?? 0, 0, cols - 1) });
      hubs.push(h);
      byCol[h.ring].push(h);
    }
    byCol.forEach((list, k) => {
      list.sort((a, b) => (a.def.order ?? 0) - (b.def.order ?? 0));
      list.forEach((h, i) => {
        h.R = RING0 + k * RING_GAP;
        h.base = (i / list.length) * Math.PI * 2 + k * 0.6;
        h.omega = (k % 2 ? -1 : 1) * (0.045 - k * 0.006); // 內圈快、外圈慢，相鄰兩圈反向
        h.size = 7 + Math.sqrt(Math.max(0.05, h.def.turnover_share_pct || 0.3)) * 2.8; // 平方根壓縮：成交佔一半也不會蓋住別人
      });
    });
    hubByName = Object.fromEntries(hubs.map((h) => [h.name, h]));
    links = (map.links || []).map(([a, b]: string[]) => [hubByName[a], hubByName[b]]).filter(([a, b]: any[]) => a && b);
    chains = {};
    for (const c of map.chains || []) {
      const moons = c.nodes.map((n: any) => {
        const same = c.nodes.filter((m: any) => m.stage === n.stage);
        const moon = ent('node', { id: n.id, name: n.name, def: n, stage: n.stage, r: STAGE0 + n.stage * STAGE_GAP });
        moon.base = (same.indexOf(n) / same.length) * Math.PI * 2 + n.stage;
        moon.omega = (n.stage % 2 ? -1 : 1) * 0.22;
        moon.size = 6 + n.stocks.length * 0.6;
        moon.stocks = n.stocks.map((s: any, i: number) =>
          ent('stock', { code: s.code, name: s.name, r: 34 + (i % 3) * 16, base: (i / n.stocks.length) * Math.PI * 2, omega: (i % 2 ? -1 : 1) * 0.5, size: 4 }),
        );
        return moon;
      });
      const byId = Object.fromEntries(moons.map((m: any) => [m.id, m]));
      chains[c.id] = { def: c, hub: hubByName[c.sector], moons, byId, edges: (c.edges || []).map(([a, b]: string[]) => [byId[a], byId[b]]).filter(([a, b]: any[]) => a && b) };
    }
    E.gradeSig = '';
  }
  const hubOfChain = (id: string) => chains[id]?.hub || hubs[0];

  // ---- 讀數值＋分級（每 0.5 秒；數值沒變就不重算，風暴粒子不會一直重生）----
  function readValues() {
    const ix = host.read('index');
    setVal(index, ix);
    index.name = ix?.name || '大盤';
    for (const h of hubs) setVal(h, host.read('hub', h.name));
    const ch = S.chain && chains[S.chain];
    if (!ch) return;
    for (const m of ch.moons) {
      setVal(m, host.read('node', S.chain, m.id));
      if (S.node === m.id) for (const s of m.stocks) setVal(s, host.read('stock', S.chain, s.code));
    }
  }
  function gradeStorms(list: any[], top: number, hi: number, share: number, lo: number, nBig: number) {
    const abs = list.filter((x) => x.has).map((x) => Math.abs(x.v)).sort((a, b) => b - a);
    const cut2 = Math.max(hi, abs[top - 1] ?? 99);
    const cut1 = Math.max(lo, abs[Math.floor(abs.length * share)] ?? 99);
    for (const x of list) {
      const v = x.has ? Math.abs(x.v) : 0;
      const storm = !x.has ? 0 : v >= cut2 ? 2 : v >= cut1 ? 1 : 0;
      const dir = Math.sign(x.v);
      const pw = x.has ? powerOf(x.v) : 0;
      if (storm !== x.storm || dir !== x.dir || Math.abs(pw - x.power) > 0.05) {
        x.storm = storm;
        x.dir = dir;
        x.power = pw;
        const n = storm ? Math.max(20, Math.round((storm === 2 ? nBig : 40) * (0.55 + 0.45 * Math.min(1.6, pw)))) : 0;
        x.particles = Array.from({ length: n }, () => ({ u: Math.random(), a: Math.random() * 7, k: Math.random() }));
        x.disk = Array.from({ length: Math.round(8 + 46 * pw + (storm === 2 ? 26 : 0)) }, () => ({ r: 0.15 + Math.random() * 0.85, th: Math.random() * 7, k: Math.random() }));
      }
    }
  }
  function groupFronts(list: any[], edges: any[]) {
    const parent = new Map(list.map((x) => [x, x]));
    const find = (x: any): any => (parent.get(x) === x ? x : find(parent.get(x)));
    for (const [a, b] of edges) if (a.storm && b.storm && a.dir === b.dir) parent.set(find(a), find(b));
    const groups = new Map<any, any[]>();
    for (const x of list) {
      if (!x.storm) continue;
      const r = find(x);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r)?.push(x);
    }
    return [...groups.values()]
      .filter((g) => g.length >= 2)
      .map((members) => ({
        members, dir: members[0].dir, edges: edges.filter(([a, b]) => members.includes(a) && members.includes(b)),
        blobs: Array.from({ length: Math.min(10, 4 + members.length * 2) }, () => ({ t: Math.random(), e: Math.random(), o: Math.random() * 7, r: 0.6 + Math.random() * 0.6 })),
      }))
      .filter((f) => f.edges.length);
  }
  function regrade() {
    const ch = S.chain && chains[S.chain];
    const moon = ch && S.node ? ch.byId[S.node] : null;
    const sig = [sigOf(hubs), ch ? sigOf(ch.moons) : '', moon ? sigOf(moon.stocks) : ''].join('|');
    if (sig === E.gradeSig) return;
    E.gradeSig = sig;
    gradeStorms(hubs, 3, 6, 0.25, 3, 220);
    E.fronts = groupFronts(hubs, links);
    if (ch) {
      gradeStorms(ch.moons, 2, 5, 0.5, 2.5, 120);
      E.moonFronts = groupFronts(ch.moons, ch.edges);
    }
    if (moon) gradeStorms(moon.stocks, 2, 7, 0.4, 4, 70);
  }

  // ---- 位置 ----
  function placeHubs() {
    for (const h of hubs) {
      const th = h.base + E.t * h.omega;
      h._th = th;
      h._wx = Math.cos(th) * h.R;
      h._wy = Math.sin(th) * h.R;
      h._depth = Math.sin(th);
      h._s = E.fx.tilt ? 0.72 + 0.28 * (h._depth + 1) / 2 : 1;
    }
    applyTug(hubs, links, (h) => [h._wx, h._wy], (h) => { h._wx += h._ox; h._wy += h._oy; }, 34);
    for (const h of hubs) h._p = project(h._wx, h._wy);
  }
  // 牽引：相關的有大波動時，鄰居被往那邊拉偏（越兇拉越多），牽引絲跟著繃緊
  function applyTug(list: any[], edges: any[], getW: (x: any) => number[], setP: (x: any) => void, maxPull: number) {
    for (const x of list) {
      x._tx = 0;
      x._ty = 0;
      x._tug = 0;
    }
    for (const [a, b] of edges) {
      for (const [self, other] of [[a, b], [b, a]]) {
        const ps = self.power || 0;
        const po = other.power || 0;
        if (po <= ps + 0.15) continue;
        const [sx, sy] = getW(self);
        const [ox, oy] = getW(other);
        const d = Math.hypot(ox - sx, oy - sy) || 1;
        const f = maxPull * clamp(po - ps, 0, 1.2) * (1 + 0.12 * Math.sin(E.t * 2.3 + (self.base || 0) * 5));
        self._tx += ((ox - sx) / d) * f;
        self._ty += ((oy - sy) / d) * f;
        self._tug = Math.max(self._tug, f / maxPull);
      }
    }
    for (const x of list) {
      x._ox = lerp(x._ox || 0, x._tx, 0.06);
      x._oy = lerp(x._oy || 0, x._ty, 0.06);
      setP(x);
    }
  }
  // 子系統（產業鏈的環節、環節的個股）：以 center 為中心，本地座標 → 螢幕
  function placeMoons(list: any[], edges: any[], center: any, scale: number, maxPull: number) {
    for (const m of list) {
      const th = m.base + E.t * m.omega;
      m._th = th;
      m._lx = Math.cos(th) * m.r;
      m._ly = Math.sin(th) * m.r;
      m._dn = (Math.sin(th) + 1) / 2;
    }
    applyTug(list, edges, (m) => [m._lx, m._ly], (m) => {
      m._lx += m._ox;
      m._ly += m._oy;
      m._q = { x: center.x + m._lx * scale, y: center.y + m._ly * scale * E.tilt };
    }, maxPull);
  }

  // ---- 繪圖小工具 ----
  const fog = (c: number[], dn: number) => mix([34, 52, 120], c, 0.45 + 0.55 * dn);
  function sphere(x: number, y: number, r: number, col: number[], from: any, a: number, dn: number) {
    const dx = from.x - x;
    const dy = from.y - y;
    const L = Math.hypot(dx, dy) || 1;
    const c = fog(col, dn);
    const g = ctx.createRadialGradient(x + (dx / L) * r * 0.45, y + (dy / L) * r * 0.45, r * 0.05, x, y, r);
    g.addColorStop(0, rgba(mix(c, [255, 255, 255], 0.55), a));
    g.addColorStop(0.35, rgba(c, a));
    g.addColorStop(0.85, rgba(c.map((v) => v * 0.22), a));
    g.addColorStop(1, rgba(c.map((v) => v * 0.1), a));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 7);
    ctx.fill();
    const back = Math.atan2(-dy, -dx);
    ctx.strokeStyle = rgba(mix(c, [255, 255, 255], 0.3), 0.55 * a);
    ctx.lineWidth = Math.max(1, r * 0.12);
    ctx.beginPath();
    ctx.arc(x, y, r * 0.95, back - 1.1, back + 1.1);
    ctx.stroke();
  }
  // 在軌道平面上畫：以 (x, y) 為原點、y 軸乘以傾斜，圓就變成透視的橢圓
  const inPlane = (c2: CanvasRenderingContext2D, x: number, y: number, draw: () => void) => {
    c2.save();
    c2.translate(x, y);
    c2.scale(1, E.tilt);
    draw();
    c2.restore();
  };
  // 軌道平面上的圓（只建路徑，restore 後路徑還在，呼叫端再 stroke／fill）
  const ellipse = (c2: CanvasRenderingContext2D, x: number, y: number, r: number) =>
    inPlane(c2, x, y, () => {
      c2.beginPath();
      c2.arc(0, 0, r, 0, 7);
    });
  function cloud(x: number, y: number, r: number, col: number[], a: number, seed: number) {
    ctx.globalAlpha = a;
    for (let i = 0; i < 6; i++) {
      const ox = Math.cos(seed + i * 1.7) * r * 0.7;
      const oy = Math.sin(seed * 1.3 + i * 2.1) * r * 0.22;
      const rr = r * (0.45 + 0.25 * Math.sin(seed * 3 + i + E.t * 0.6));
      ctx.drawImage(CLOUD, x + ox - rr, y + oy - rr, rr * 2, rr * 2);
    }
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.4 * a;
    ctx.drawImage(glow(col), x - r, y - r * 0.55, r * 2, r * 1.4);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }
  function bolt(x1: number, y1: number, x2: number, y2: number, col: number[], w: number) {
    const pts = [[x1, y1]];
    for (let i = 1; i < 7; i++) {
      const t = i / 7;
      const j = (Math.random() - 0.5) * Math.hypot(x2 - x1, y2 - y1) * 0.18;
      pts.push([lerp(x1, x2, t) + j, lerp(y1, y2, t) + j * 0.3]);
    }
    pts.push([x2, y2]);
    E.bolts.push({ pts, col, life: 1, w });
  }
  function filament(A: any, B: any, ctrl: any, col: number[], a: number, w: number, tension: number) {
    lx.strokeStyle = rgba(col, a);
    lx.lineWidth = w;
    lx.beginPath();
    lx.moveTo(A.x, A.y);
    lx.quadraticCurveTo(ctrl.x, ctrl.y, B.x, B.y);
    lx.stroke();
    if (tension > 0.4) {
      lx.setLineDash([3, 10]);
      lx.lineDashOffset = -E.t * 60;
      lx.strokeStyle = rgba(mix(col, [255, 255, 255], 0.2), a * 0.9 * Math.min(1, tension));
      lx.beginPath();
      lx.moveTo(A.x, A.y);
      lx.quadraticCurveTo(ctrl.x, ctrl.y, B.x, B.y);
      lx.stroke();
      lx.setLineDash([]);
    }
  }
  function drawDisk(x: any, cx: number, cy: number, Rd: number, a: number, run: number, col: number[]) {
    const pw = x.power || 0;
    const bright = mix(col, [255, 255, 255], 0.45);
    const cols = [0, 1, 2, 3, 4, 5].map((i) => rgba(mix(bright, [150, 180, 255], (i / 5) * 0.6), 1));
    const every = E.quality === 0 ? 2 : 1;
    let i = 0;
    for (const q of x.disk) {
      q.th += (run * (1.2 + 3.4 * pw)) / (q.r + 0.25);
      q.r -= run * (0.05 + 0.2 * pw);
      if (q.r < 0.1) {
        q.r = 1;
        q.th = Math.random() * 7;
      }
      if (i++ % every) continue;
      lx.fillStyle = cols[Math.round(clamp(q.r, 0, 1) * 5)];
      lx.globalAlpha = a * (0.25 + 0.6 * (1 - q.r)) * (0.6 + 0.4 * q.k);
      const s = 0.9 + q.k * 1.1 + (1 - q.r) * 0.8;
      lx.fillRect(cx + Math.cos(q.th) * q.r * Rd, cy + Math.sin(q.th) * q.r * Rd * E.tilt, s, s);
    }
    lx.globalAlpha = 1;
  }
  // 時空網格：平面底下的網格往質量處凹陷（核心最深），一眼看出誰在拉誰
  function wellGrid(proj: (x: number, y: number) => any, masses: any[], R: number, scale: number, a: number) {
    if (a <= 0.02) return;
    const k = scale * (1 - E.tilt * 0.55) * 0.09;
    const pt = (x: number, y: number) => {
      let s = 0;
      for (const m of masses) s += (m.m * 1000) / (Math.hypot(x - m.x, y - m.y) + m.soft);
      const p = proj(x, y);
      return [p.x, p.y + s * k];
    };
    ctx.lineWidth = 1;
    const rings = 10; // 網格解析度：每點都要對全部質量算距離，點數是效能主因
    for (let i = 1; i <= rings; i++) {
      const r = (R * i) / rings;
      ctx.strokeStyle = `rgba(110,170,255,${a * (0.08 + 0.16 * (1 - i / rings))})`;
      ctx.beginPath();
      for (let j = 0; j <= 64; j++) {
        const t = (j / 64) * Math.PI * 2;
        const [X, Y] = pt(Math.cos(t) * r, Math.sin(t) * r);
        if (j) ctx.lineTo(X, Y);
        else ctx.moveTo(X, Y);
      }
      ctx.stroke();
    }
    ctx.strokeStyle = `rgba(110,170,255,${a * 0.09})`;
    for (let i = 0; i < 24; i++) {
      const t = (i / 24) * Math.PI * 2;
      ctx.beginPath();
      for (let j = 0; j <= 18; j++) {
        const r = R * (0.06 + 0.94 * (j / 18));
        const [X, Y] = pt(Math.cos(t) * r, Math.sin(t) * r);
        if (j) ctx.lineTo(X, Y);
        else ctx.moveTo(X, Y);
      }
      ctx.stroke();
    }
  }
  // 天氣：一個有天氣的東西畫風暴；全景、產業鏈、環節三層共用。r0：本體半徑；k：整體尺寸倍率
  function stormAt(e: any, p: any, r0: number, k: number, a: number, run: number, dt: number) {
    if (!e.storm) return;
    const z = E.cam.z;
    const col = toneDir(e.dir);
    const bright = mix(col, [255, 255, 255], 0.35);
    const ps = clamp(z, 0.7, 1.6) * Math.min(1.6, Math.sqrt(k));
    if (e.storm === 2 && e.dir > 0) {
      const Ht = 150 * z * k;
      const rt = 48 * z * k;
      const rb = Math.max(r0 * 0.6, 4 * z * k);
      for (const q of e.particles) {
        q.u += run * (0.22 + q.k * 0.12);
        q.a += run * (6 - q.u * 3.5);
        if (q.u > 1) {
          q.u = 0;
          q.a = Math.random() * 7;
        }
        const rad = lerp(rb, rt, q.u ** 1.4) * (0.85 + 0.3 * q.k);
        const x = p.x + Math.cos(q.a) * rad + Math.sin(E.t * 1.3 + q.u * 3) * 10 * z * k * q.u;
        const y = p.y - q.u * Ht + Math.sin(q.a) * rad * 0.28;
        lx.fillStyle = rgba(bright, (Math.sin(q.a) > 0 ? 0.85 : 0.35) * a * (1 - q.u * 0.4));
        const sz = (1.6 + q.k * 1.8) * ps;
        lx.fillRect(x, y, sz, sz);
      }
      lx.globalAlpha = 0.28 * a;
      for (let i = 0; i < 6; i++) {
        const u = i / 5;
        const rad = lerp(rb, rt, u ** 1.4) * 1.6;
        lx.drawImage(glow(col), p.x - rad, p.y - u * Ht - rad * 0.5, rad * 2, rad);
      }
      lx.globalAlpha = 1;
      cloud(p.x, p.y - Ht - 6 * z * k, 62 * z * k, col, 0.8 * a, (e.base || 0) * 10);
      if (E.motion && Math.random() < dt * 0.9) bolt(p.x + (Math.random() - 0.5) * 40 * z * k, p.y - Ht, p.x, p.y - r0, bright, 2);
    } else if (e.storm === 2) {
      const R = 64 * z * k;
      for (const q of e.particles) {
        q.u += run * (0.18 + q.k * 0.1);
        q.a += run * (2 + 7 * q.u);
        if (q.u > 1) {
          q.u = 0;
          q.a = Math.random() * 7;
        }
        const rad = R * (1 - q.u) ** 0.8;
        const sink = q.u > 0.75 ? ((q.u - 0.75) / 0.25) * 46 * z * k : 0;
        lx.fillStyle = rgba(bright, (0.25 + 0.7 * q.u) * a);
        const sz = (1 + q.k * 1.3) * ps;
        lx.fillRect(p.x + Math.cos(q.a) * rad, p.y + Math.sin(q.a) * rad * E.tilt + sink, sz, sz);
      }
      inPlane(ctx, p.x, p.y, () => {
        ctx.globalAlpha = a;
        ctx.drawImage(VOID, -R, -R, R * 2, R * 2); // 漩渦的暗心
      });
      ctx.globalAlpha = 1;
      cloud(p.x, p.y - 52 * z * k, 50 * z * k, col, 0.65 * a, (e.base || 0) * 10);
      if (E.motion && Math.random() < dt * 0.6) bolt(p.x + (Math.random() - 0.5) * 30 * z * k, p.y - 52 * z * k, p.x, p.y, bright, 1.6);
    } else {
      cloud(p.x, p.y - 34 * z * k, 30 * z * k, col, 0.5 * a, (e.base || 0) * 10);
      for (const q of e.particles) {
        q.u += run * (0.5 + q.k * 0.4);
        if (q.u > 1) q.u = 0;
        const x = p.x + (q.k - 0.5) * 44 * z * k;
        const y = e.dir > 0 ? p.y - 6 * z * k - q.u * 34 * z * k : p.y - 30 * z * k + q.u * 38 * z * k;
        lx.fillStyle = rgba(bright, 0.6 * a * Math.sin(q.u * Math.PI));
        if (e.dir > 0) lx.fillRect(x, y, 1.6 * ps, 1.6 * ps);
        else {
          lx.strokeStyle = lx.fillStyle;
          lx.lineWidth = 0.8;
          lx.beginPath();
          lx.moveTo(x, y);
          lx.lineTo(x - 1.5 * z, y + 4 * z);
          lx.stroke();
        }
      }
    }
  }
  function front(f: any, posOf: (x: any) => any, scale: number, a: number, dt: number) {
    const z = E.cam.z;
    const col = toneDir(f.dir);
    for (const b of f.blobs) {
      const [A, B] = f.edges[Math.floor(b.e * f.edges.length)];
      const pa = posOf(A);
      const pb = posOf(B);
      cloud(lerp(pa.x, pb.x, b.t) + Math.sin(E.t * 0.3 + b.o) * 14 * z * scale, lerp(pa.y, pb.y, b.t) - 26 * z * scale, 70 * z * scale * b.r, col, 0.55 * a, b.o);
    }
    if (E.motion && Math.random() < dt * 0.8) {
      const [A, B] = f.edges[Math.floor(Math.random() * f.edges.length)];
      const pa = posOf(A);
      const pb = posOf(B);
      bolt(pa.x, pa.y - 30 * z * scale, pb.x, pb.y - 30 * z * scale, mix(col, [255, 255, 255], 0.6), 1.6);
    }
  }

  // ---- 子系統（產業鏈 or 環節）：同一套網格、旋臂絲、牽引絲、吸積盤、軌道、天氣、球體 ----
  function drawSystem(center: any, coreEnt: any, list: any[], edges: any[], scale: number, k: number, run: number, dt: number, part: string, opts: any) {
    const masses = [{ x: 0, y: 0, m: 3 + (coreEnt.power || 0) * 2.5, soft: 40 }];
    for (const m of list) masses.push({ x: m._lx, y: m._ly, m: 0.4 + (m.power || 0) * 1.2, soft: 22 });
    const proj = (x: number, y: number) => ({ x: center.x + x * scale, y: center.y + y * scale * E.tilt });
    if (part === 'grid') {
      wellGrid(proj, masses, Math.max(...list.map((m) => m.r), 40) + 60, scale * 0.75, k * opts.alpha);
      const radii = [...new Set(list.map((m) => m.r))];
      for (const r of radii) {
        ellipse(ctx, center.x, center.y, r * scale);
        ctx.strokeStyle = `rgba(127,209,255,${0.18 * k * opts.alpha})`;
        ctx.lineWidth = 6 * E.cam.z;
        ctx.globalAlpha = 0.4;
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      return;
    }
    if (part === 'light') {
      lx.globalCompositeOperation = 'lighter';
      for (const m of list) {
        const col = toneX(m);
        const pw = m.power || 0;
        const a = k * opts.alpha * (opts.hl && opts.hl !== m ? 0.35 : 1);
        const th = m._th - Math.sign(m.omega) * 0.6;
        filament(center, m._q, proj(Math.cos(th) * m.r * 0.5, Math.sin(th) * m.r * 0.5), col, a * (0.06 + 0.2 * pw), 0.8 + 1.4 * pw, 0);
        drawDisk(m, m._q.x, m._q.y, (12 + 22 * pw) * scale * opts.diskK, a * (0.5 + 0.5 * m._dn), run, col);
      }
      for (const [A, B] of edges) {
        const heavy = (A.power || 0) >= (B.power || 0) ? A : B;
        const light = heavy === A ? B : A;
        const ctrl = { x: lerp(lerp(light._q.x, heavy._q.x, 0.65), center.x, 0.2), y: lerp(lerp(light._q.y, heavy._q.y, 0.65), center.y, 0.2) };
        const pw = Math.max(A.power || 0, B.power || 0);
        filament(light._q, heavy._q, ctrl, mix(toneX(heavy), [150, 220, 255], 0.35), k * opts.alpha * (0.1 + 0.2 * pw), 0.8 + 1.2 * pw, Math.max(A._tug || 0, B._tug || 0));
        for (let i = 0; i < 2; i++) {
          const t = (E.t * 0.35 + i / 2) % 1;
          lx.globalAlpha = k * opts.alpha * Math.sin(t * Math.PI);
          lx.drawImage(glow([150, 220, 255]), lerp(light._q.x, heavy._q.x, t) - 6, lerp(light._q.y, heavy._q.y, t) - 6, 12, 12);
        }
        lx.globalAlpha = 1;
      }
      return;
    }
    if (part === 'storms') {
      for (const f of opts.fronts || []) front(f, (m: any) => m._q, opts.frontK, 0.9 * k * opts.alpha, dt);
      for (const m of list) stormAt(m, m._q, m.size * scale * 0.8, opts.stormK, k * opts.alpha * (0.5 + 0.5 * m._dn), run, dt);
      return;
    }
    // 'bodies'：遠的先畫
    for (const m of [...list].sort((a, b) => a._dn - b._dn)) {
      const col = toneX(m);
      const r = m.size * scale * 0.8 * (opts.hover === m ? 1.25 : 1);
      const a = k * opts.alpha * (opts.hl && opts.hl !== m ? 0.45 : 1);
      lx.globalCompositeOperation = 'lighter';
      lx.globalAlpha = a;
      lx.drawImage(glow(fog(col, m._dn)), m._q.x - r * 4, m._q.y - r * 4, r * 8, r * 8);
      lx.globalAlpha = 1;
      sphere(m._q.x, m._q.y, r, col, center, a, m._dn);
      m._r = r;
    }
  }

  // ---- 每幀 ----
  let raf = 0;
  let last = 0;
  let acc = 0;
  let fpsN = 0;
  let shockT = 0;
  let miniT = 0;
  const focusHub = () => (S.state === 'overview' ? null : hubOfChain(S.chain));
  function update(dt: number) {
    E.ticks++;
    const target = !E.motion ? 0 : E.hover ? 0.12 : S.state !== 'overview' ? 0.25 : 1;
    E.timeScale = lerp(E.timeScale, target, 0.08);
    E.t += dt * E.timeScale;
    E.tilt = lerp(E.tilt, E.fx.tilt ? (S.state === 'overview' ? 0.42 : 0.55) : 1, 0.06);
    if (E.motion) {
      shockT += dt;
      if (shockT > 3.2) {
        shockT = 0;
        E.shock.push({ age: 0 });
      }
    }
    for (const s of E.shock) s.age += dt * 0.45;
    E.shock = E.shock.filter((s: any) => s.age < 1);
    E.focusT = S.state === 'overview' ? 0 : E.focusT + dt * 1.1;
    E.nodeT = S.state === 'node' ? E.nodeT + dt * 1.1 : 0;
    E.gradeAt -= dt;
    if (E.gradeAt <= 0) {
      E.gradeAt = 0.5;
      readValues();
      regrade();
    }
  }
  // 目前這一層的焦點（攝影機的基準位置與縮放）：全景＝大盤（或選中的類股）、產業鏈＝類股、環節＝環節
  function baseTarget() {
    const fit = fitZoom();
    const fh = focusHub();
    if (S.state === 'chain' && fh) return { x: fh._wx, y: fh._wy * E.tilt, z: clamp(fit * 2.6, 1.2, 3.4) };
    if (S.state === 'node' && fh) {
      // 環節的本地座標在展開完成後就等於世界座標的位移（系統縮放＝攝影機縮放）
      const m = chains[S.chain]?.byId[S.node];
      return { x: fh._wx + (m?._lx ?? 0), y: (fh._wy + (m?._ly ?? 0)) * E.tilt, z: clamp(fit * 2.6, 1.2, 3.4) * 1.9 };
    }
    const sh = S.sector && hubByName[S.sector];
    return sh ? { x: sh._wx, y: sh._wy * E.tilt, z: fit * 1.7 } : { x: 0, y: 0, z: fit };
  }
  // 攝影機永遠跟著焦點；拖曳與滾輪記成相對偏移（pan）與縮放倍率（zoomK），焦點繞軌道時不會漂出畫面。換層級或重置視角時歸零
  function cameraTarget() {
    const b = baseTarget();
    E.camTo = { x: b.x + E.pan.x, y: b.y + E.pan.y, z: clamp(b.z * E.zoomK, 0.3, 8) };
  }
  const resetView = () => {
    E.pan = { x: 0, y: 0 };
    E.zoomK = 1;
  };

  function render(dt: number) {
    const t0 = performance.now();
    V = view();
    cameraTarget();
    const k = S.state === 'overview' ? 0.12 : 0.07;
    // 拖曳時位置直接跟手（不補間，才不會覺得拖不動）；縮放照樣平滑
    E.cam.x = E.dragging ? E.camTo.x : lerp(E.cam.x, E.camTo.x, k);
    E.cam.y = E.dragging ? E.camTo.y : lerp(E.cam.y, E.camTo.y, k);
    E.cam.z = lerp(E.cam.z, E.camTo.z, k);
    placeHubs();
    const z = E.cam.z;
    const run = E.motion ? dt * Math.max(0.35, E.timeScale) : 0;
    const fk = ease(clamp(E.focusT, 0, 1));
    const dim = S.state === 'overview' ? 1 : 1 - 0.8 * fk;
    const fh = focusHub();
    const ch = S.chain ? chains[S.chain] : null;
    const moon = ch && S.node ? ch.byId[S.node] : null;
    const nk = ease(clamp(E.nodeT, 0, 1));
    const sysScale = z * fk;
    if (ch && fh) placeMoons(ch.moons, ch.edges, fh._p, sysScale, 26);
    if (moon) placeMoons(moon.stocks, [], moon._q, sysScale * 0.9 * nk, 0);
    const c = project(0, 0);
    const coreCol = toneX(index);
    let drawn = 0;

    // 1. 場景（透明底）
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    // 重力井網格（全景）
    if (dim > 0.05) {
      const masses = [{ x: 0, y: 0, m: 6 + (index.has ? powerOf(index.v) : 0) * 3, soft: 70 }];
      for (const h of hubs) masses.push({ x: h._wx, y: h._wy, m: 0.45 + Math.sqrt(Math.max(0.05, h.def.turnover_share_pct || 0.3)) * 0.22 + h.power * 1.3, soft: 30 });
      wellGrid(project, masses, OUTER + 40, z, dim);
    }
    // 核心照亮軌道平面
    if (dim > 0.5) {
      inPlane(ctx, c.x, c.y, () => {
        ctx.globalCompositeOperation = 'lighter';
        const R = OUTER * z * 1.05;
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
        const cc = mix(coreCol, [255, 255, 255], 0.15);
        g.addColorStop(0, rgba(cc, 0.2 * dim));
        g.addColorStop(0.25, rgba(cc, 0.06 * dim));
        g.addColorStop(0.7, rgba(cc, 0.015 * dim));
        g.addColorStop(1, rgba(cc, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, R, 0, 7);
        ctx.fill();
      });
    }
    // 軌道帶
    for (let i = 0; i < ringCount; i++) {
      const R = (RING0 + i * RING_GAP) * z;
      const g = ctx.createLinearGradient(c.x, c.y - R * E.tilt, c.x, c.y + R * E.tilt);
      g.addColorStop(0, `rgba(110,150,255,${0.05 * dim})`);
      g.addColorStop(1, `rgba(150,200,255,${0.26 * dim})`);
      ellipse(ctx, c.x, c.y, R);
      ctx.strokeStyle = g;
      ctx.lineWidth = 9 * z;
      ctx.globalAlpha = 0.5;
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.globalAlpha = 1;
      ctx.stroke();
    }
    // 子系統網格與軌道（在實體之前）
    if (ch && fh) drawSystem(fh._p, fh, ch.moons, ch.edges, sysScale, fk, run, dt, 'grid', { alpha: moon ? 0.4 : 1 });
    if (moon) drawSystem(moon._q, moon, moon.stocks, [], sysScale * 0.9 * nk, nk, run, dt, 'grid', { alpha: 1 });

    // 2. 實體：後半圈 → 核心 → 前半圈
    // 滑過某類股時其他（不相關的）變淡；全景選了某類股時，不是它也不相關的變淡
    const hubAlpha = (h: any) => {
      const sel = S.state === 'overview' && S.sector ? hubByName[S.sector] : null;
      return dim * (dimmedByHover(h) ? 0.4 : 1) * (sel && sel !== h && !linkedTo(h, sel) ? 0.45 : 1);
    };
    const order = [...hubs].sort((a, b) => a._depth - b._depth);
    const drawHub = (h: any) => {
      if (h === fh) return;
      const p = h._p;
      const r = h.size * z * h._s * (E.hover === h ? 1.3 : 1);
      const a = hubAlpha(h);
      sphere(p.x, p.y, r, toneX(h), c, a, (h._depth + 1) / 2);
      if (h.def.chains?.length) {
        ellipse(ctx, p.x, p.y, r * 1.7);
        ctx.strokeStyle = rgba(fog(toneX(h), (h._depth + 1) / 2), 0.35 * a);
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      h._r = r;
      drawn++;
    };
    for (const h of order) if (h._depth < 0) drawHub(h);
    {
      const R = 56 * z * (1 + 0.03 * Math.sin(E.t * 2.2));
      ctx.globalAlpha = dim;
      const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, R);
      g.addColorStop(0, rgba(mix(coreCol, [255, 255, 255], 0.75), 1));
      g.addColorStop(0.35, rgba(mix(coreCol, [255, 255, 255], 0.3), 1));
      g.addColorStop(0.8, rgba(coreCol, 1));
      g.addColorStop(1, rgba(coreCol, 0.6));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(c.x, c.y, R, 0, 7);
      ctx.fill();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.55 * dim;
      ctx.drawImage(glow(coreCol), c.x - R * 3, c.y - R * 3, R * 6, R * 6);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
    for (const h of order) if (h._depth >= 0) drawHub(h);
    if (fh) {
      // 進到環節層時，上一層的核心（類股）縮小變淡，焦點留給環節與個股
      const nkk = S.state === 'node' ? ease(clamp(E.nodeT, 0, 1)) : 0;
      fh._r = Math.min(fh.size * z, 64) * (1 - 0.55 * nkk); // 放大很多時核心也不要大到蓋住環節
      sphere(fh._p.x, fh._p.y, fh._r, toneX(fh), c, 1 - 0.5 * nkk, 1);
    }

    // 3. 光層：淡出 → 吸積盤光塵、核心放射光、衛星光、列車、脈衝、牽引絲、衝擊波
    const camSpeed = Math.hypot(E.camTo.x - E.cam.x, E.camTo.y - E.cam.y) * z + Math.abs(E.camTo.z - E.cam.z) * 600;
    lx.setTransform(1, 0, 0, 1, 0, 0);
    lx.globalCompositeOperation = 'destination-out';
    lx.globalAlpha = 1;
    lx.fillStyle = `rgba(0,0,0,${clamp(0.26 + camSpeed * 0.02 + (E.motion ? 0 : 0.5), 0.26, 1)})`;
    lx.fillRect(0, 0, Lc.width, Lc.height);
    lx.setTransform(DPR, 0, 0, DPR, 0, 0);
    lx.globalCompositeOperation = 'lighter';
    const lite = dim > 0.5;
    const dustEvery = !lite ? 3 : E.quality === 0 ? 3 : E.quality === 1 ? 2 : 1;
    let di = 0;
    const dustCols = new Map<number, string>();
    const dustStyle = (near: number, dn: number) => {
      const nb = Math.round(near * 7);
      const db = Math.round(dn * 3);
      const key = nb * 4 + db;
      let st = dustCols.get(key);
      if (!st) {
        const n = nb / 7;
        st = rgba(fog(mix(mix([120, 160, 255], coreCol, n * 0.8), [255, 255, 255], n * n * 0.4), db / 3), 1);
        dustCols.set(key, st);
      }
      return st;
    };
    for (const d of dust) {
      if (E.motion) {
        d.th += (dt * E.timeScale * 9) / d.r ** 0.85;
        d.r -= dt * E.timeScale * (6 + 900 / d.r);
      }
      if (d.r < 60) Object.assign(d, spawnDust(false));
      if (di++ % dustEvery) continue;
      const p = project(Math.cos(d.th) * d.r, Math.sin(d.th) * d.r);
      const near = 1 - clamp((d.r - 60) / (OUTER - 60), 0, 1);
      lx.fillStyle = dustStyle(near, (Math.sin(d.th) + 1) / 2);
      lx.globalAlpha = (0.1 + 0.4 * near) * d.b * dim;
      const s = d.s * (0.7 + near) * clamp(z, 0.6, 1.6);
      lx.fillRect(p.x, p.y, s, s);
    }
    lx.globalAlpha = 1;
    if (lite) {
      for (let i = 0; i < 14; i++) {
        const a = E.t * 0.08 + i * ((Math.PI * 2) / 14) + Math.sin(i * 7.1) * 0.2;
        const len = (180 + 120 * Math.sin(i * 3.3 + E.t * 0.4)) * z;
        const ex = c.x + Math.cos(a) * len;
        const ey = c.y + Math.sin(a) * len * 0.8;
        const g = lx.createLinearGradient(c.x, c.y, ex, ey);
        g.addColorStop(0, rgba(coreCol, 0.08 * dim));
        g.addColorStop(1, rgba(coreCol, 0));
        lx.strokeStyle = g;
        lx.lineWidth = (3 + (i % 3) * 2) * z;
        lx.beginPath();
        lx.moveTo(c.x, c.y);
        lx.lineTo(ex, ey);
        lx.stroke();
      }
    }
    for (const h of hubs) {
      if (h === fh) continue;
      const p = h._p;
      const col = toneX(h);
      const dn = (h._depth + 1) / 2;
      const a = hubAlpha(h);
      const r = h.size * z * h._s;
      if (lite) {
        inPlane(lx, p.x, p.y, () => {
          lx.globalAlpha = 0.08 * a * (0.6 + h.power); // 衛星照在軌道帶上的光
          lx.drawImage(glow(fog(col, dn)), -r * 5, -r * 5, r * 10, r * 10);
        });
        lx.globalAlpha = 1;
      }
      const strength = clamp(Math.abs(h.v) / 6, 0.3, 1);
      const nTrain = 5 + Math.round(12 * h.power); // 漲跌越大，列車越長
      lx.fillStyle = rgba(fog(mix(col, [255, 255, 255], 0.35), dn), a * strength * 0.7);
      for (let j = 1; j <= nTrain; j++) {
        const th = h._th - Math.sign(h.omega) * j * 0.02;
        const q = project(Math.cos(th) * h.R + (h._ox || 0), Math.sin(th) * h.R + (h._oy || 0));
        const rr = Math.max(0.8, r * 0.16 * (1 - j / (nTrain + 2)));
        lx.globalAlpha = 1 - j / (nTrain + 1);
        lx.beginPath();
        lx.arc(q.x, q.y, rr, 0, 7);
        lx.fill();
      }
      lx.globalAlpha = 1;
      // 引力絲：核心像旋臂一樣拉著每個類股；吸積盤
      const th = h._th - Math.sign(h.omega) * 0.55;
      const ctrl = project(Math.cos(th) * h.R * 0.55, Math.sin(th) * h.R * 0.55);
      filament(c, p, ctrl, col, a * (0.04 + 0.16 * h.power), 0.8 + 1.6 * h.power, 0);
      drawDisk(h, p.x, p.y, (20 + 34 * h.power) * z * h._s, a, run, col);
      // 影響力脈衝：沿軌道平面往核心螺旋
      const w = clamp((h.def.turnover_share_pct || 0) / 10, 0.04, 1);
      const n = Math.max(1, Math.round(w * 5));
      for (let i = 0; i < n; i++) {
        const t = (E.t * (0.12 + w * 0.3) + i / n + h.base * 0.37) % 1;
        const rr = lerp(h.R, 60, ease(t));
        const th2 = h._th + Math.sign(h.omega) * t * 0.9;
        const q = project(Math.cos(th2) * rr, Math.sin(th2) * rr);
        const s = (2.2 + w * 3) * z * (E.hover === h ? 1.6 : 1);
        lx.globalAlpha = a * 0.55 * Math.sin(t * Math.PI);
        lx.drawImage(glow(mix(col, [255, 255, 255], 0.3)), q.x - s * 3, q.y - s * 3, s * 6, s * 6);
      }
      lx.globalAlpha = 1;
    }
    // 相關類股之間的牽引絲（彎向較重的一端）＋流動光點
    for (const [A, B] of links) {
      const heavy = A.power >= B.power ? A : B;
      const light = heavy === A ? B : A;
      const m = { x: lerp(light._p.x, heavy._p.x, 0.65), y: lerp(light._p.y, heavy._p.y, 0.65) };
      const ctrl = { x: lerp(m.x, c.x, 0.25), y: lerp(m.y, c.y, 0.25) };
      const hl = E.hover && (E.hover === A || E.hover === B);
      const pw = Math.max(A.power, B.power);
      filament(light._p, heavy._p, ctrl, mix(toneX(heavy), [170, 140, 255], 0.35), dim * (hl ? 0.55 : E.hover ? 0.03 : 0.03 + 0.08 * pw), 0.6 + 0.8 * pw, hl || !E.hover ? Math.max(A._tug, B._tug) : 0);
      for (let i = 0; i < 4; i++) {
        const t = (E.t * 0.2 + i / 4 + A.base) % 1;
        const q = { x: (1 - t) ** 2 * light._p.x + 2 * (1 - t) * t * ctrl.x + t * t * heavy._p.x, y: (1 - t) ** 2 * light._p.y + 2 * (1 - t) * t * ctrl.y + t * t * heavy._p.y };
        lx.globalAlpha = (hl ? 0.95 : E.hover ? 0.06 : 0.4) * dim * Math.sin(t * Math.PI);
        lx.drawImage(glow([175, 145, 255]), q.x - 6, q.y - 6, 12, 12);
      }
      lx.globalAlpha = 1;
    }
    for (const s of E.shock) {
      ellipse(lx, c.x, c.y, (60 + s.age * 300) * z);
      lx.strokeStyle = rgba(coreCol, Math.max(0, 0.35 * (1 - s.age)) * dim);
      lx.lineWidth = 6 * (1 - s.age) + 1;
      lx.stroke();
    }
    // 子系統：光層 → 球體 → 天氣
    const hlMoon = E.hover?.kind === 'node' ? E.hover : moon;
    if (ch && fh) {
      drawSystem(fh._p, fh, ch.moons, ch.edges, sysScale, fk, run, dt, 'light', { alpha: moon ? 0.45 : 1, diskK: 1, hl: hlMoon });
      drawSystem(fh._p, fh, ch.moons, ch.edges, sysScale, fk, run, dt, 'bodies', { alpha: moon ? 0.5 : 1, hl: hlMoon, hover: E.hover });
      drawn += ch.moons.length;
    }
    if (moon) {
      const sc = sysScale * 0.9 * nk;
      drawSystem(moon._q, moon, moon.stocks, [], sc, nk, run, dt, 'light', { alpha: 1, diskK: 0.6, hl: E.hover?.kind === 'stock' ? E.hover : null });
      drawSystem(moon._q, moon, moon.stocks, [], sc, nk, run, dt, 'bodies', { alpha: 1, hl: E.hover?.kind === 'stock' ? E.hover : null, hover: E.hover });
      drawn += moon.stocks.length;
    }
    // 天氣：全景（類股）→ 展開後系統級（核心類股的風暴放大）→ 子系統各自的天氣
    if (dim > 0.3) {
      for (const f of E.fronts || []) front(f, (h: any) => h._p, 1, dim, dt);
      for (const h of hubs) if (h !== fh) stormAt(h, h._p, h.size * z * h._s, h._s, hubAlpha(h) * (0.5 + 0.5 * (h._depth + 1) / 2), run, dt);
    }
    if (ch && fh) {
      if (fh.storm) stormAt(fh, fh._p, fh.size * z, fh.storm === 2 ? 4.2 : 2.6, 0.55 * fk * (moon ? 0.5 : 1), run, dt);
      drawSystem(fh._p, fh, ch.moons, ch.edges, sysScale, fk, run, dt, 'storms', { alpha: moon ? 0.4 : 1, fronts: E.moonFronts, frontK: 0.55, stormK: 0.55 });
    }
    if (moon) {
      if (moon.storm) stormAt(moon, moon._q, moon._r || 8, moon.storm === 2 ? 2.4 : 1.6, 0.5 * nk, run, dt);
      drawSystem(moon._q, moon, moon.stocks, [], sysScale * 0.9 * nk, nk, run, dt, 'storms', { alpha: 1, fronts: [], frontK: 0.4, stormK: 0.35 });
    }
    for (const b of E.bolts) {
      lx.strokeStyle = rgba(b.col, b.life);
      lx.lineWidth = b.w * b.life + 0.5;
      lx.lineJoin = 'round';
      lx.beginPath();
      lx.moveTo(b.pts[0][0], b.pts[0][1]);
      for (const [x, y] of b.pts) lx.lineTo(x, y);
      lx.stroke();
      b.life -= dt * 5;
    }
    E.bolts = E.bolts.filter((b: any) => b.life > 0);
    // 搜尋導向／回放的擴散波
    for (const ef of E.effects) {
      const p = ef.at();
      if (!p) continue;
      ellipse(lx, p.x, p.y, (ef.r + (1 - ef.life) * ef.max) * z * 0.6);
      lx.strokeStyle = rgba(ef.color, ef.life * 0.8);
      lx.lineWidth = 2.5 * ef.life + 0.5;
      lx.stroke();
      ef.life -= dt * 0.9;
    }
    E.effects = E.effects.filter((ef: any) => ef.life > 0);
    lx.globalAlpha = 1;

    // 4. 合成光層（暫停時光層幾乎每幀清空，亮度只剩約 1/3：多疊兩次補回來）
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = E.motion ? 1 : 3; i > 0; i--) ctx.drawImage(Lc, 0, 0);
    // 5. Bloom（只從前景算）
    if (E.quality > 0) {
      b1.globalCompositeOperation = 'copy';
      b1.drawImage(canvas, 0, 0, B1.width, B1.height);
      b2.globalCompositeOperation = 'copy';
      b2.drawImage(B1, 0, 0, B2.width, B2.height);
      if (E.quality > 1) {
        ctx.globalAlpha = 0.16;
        ctx.drawImage(B1, 0, 0, canvas.width, canvas.height);
      }
      ctx.globalAlpha = 0.22;
      ctx.drawImage(B2, 0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = 1;
    }
    // 6. 背景墊到下面：星點（全解析度）→ 星雲＋銀河（半解析度）
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = 'rgb(200,220,255)';
    for (const layer of stars)
      for (const s of layer) {
        const x = (((s.x - E.cam.x * s.depth) % W) + W * 1.5) % W;
        const y = (((s.y - E.cam.y * s.depth) % H) + H * 1.5) % H;
        ctx.globalAlpha = s.a * (0.65 + 0.35 * Math.sin(E.t * 1.3 + s.tw));
        ctx.fillRect(x, y, s.r, s.r);
      }
    ctx.globalAlpha = 1;
    renderBackdrop();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(Bc, 0, 0, canvas.width, canvas.height);
    // 7. 調色、暗角、顆粒
    ctx.globalCompositeOperation = 'source-over';
    const cw = canvas.width;
    const chh = canvas.height;
    const g1 = ctx.createRadialGradient(cw / 2, chh / 2, 0, cw / 2, chh / 2, Math.max(cw, chh) * 0.7);
    g1.addColorStop(0, 'rgba(90,200,255,.03)');
    g1.addColorStop(1, 'rgba(90,40,160,.12)');
    ctx.fillStyle = g1;
    ctx.fillRect(0, 0, cw, chh);
    const g2 = ctx.createRadialGradient(cw / 2, chh / 2, Math.min(cw, chh) * 0.38, cw / 2, chh / 2, Math.max(cw, chh) * 0.75);
    g2.addColorStop(0, 'rgba(0,0,0,0)');
    g2.addColorStop(1, 'rgba(0,0,0,.6)');
    ctx.fillStyle = g2;
    ctx.fillRect(0, 0, cw, chh);
    if (E.quality > 1) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.35;
      const pat = ctx.createPattern(Gc, 'repeat');
      if (pat) {
        ctx.fillStyle = pat;
        const ox = (Math.random() * 192) | 0;
        const oy = (Math.random() * 192) | 0;
        ctx.translate(-ox, -oy);
        ctx.fillRect(ox, oy, cw, chh);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    // 8. 文字（最後畫，不吃 bloom）
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    labels(dim, fh, ch, moon, fk, nk);
    E.drawn = drawn + hubs.length;
    // 自動畫質：開頭 2 秒（載入圖片、第一次建貼圖）不算；連續約 1.5 秒超過 16ms 降一級，連續約 2 秒低於 10ms 升一級
    E.ms = lerp(E.ms, performance.now() - t0, 0.1);
    if (E.ticks < 120) {
      // 暖機中
    } else if (E.ms > 16) {
      E.slow++;
      E.fast = 0;
      if (E.slow > 90 && E.quality > 0) {
        E.quality--;
        E.slow = 0;
      }
    } else if (E.ms < 10) {
      E.fast++;
      E.slow = 0;
      if (E.fast > 120 && E.quality < 2) {
        E.quality++;
        E.fast = 0;
      }
    }
    miniT -= dt;
    if (miniT <= 0) {
      miniT = 0.2;
      drawMinimap();
    }
  }
  function renderBackdrop() {
    bx.setTransform(DPR / 2, 0, 0, DPR / 2, 0, 0);
    bx.globalCompositeOperation = 'source-over';
    bx.globalAlpha = 1;
    const g = bx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.8);
    g.addColorStop(0, '#0b1636');
    g.addColorStop(0.5, '#060b20');
    g.addColorStop(1, '#020309');
    bx.fillStyle = g;
    bx.fillRect(0, 0, W, H);
    bx.globalCompositeOperation = 'lighter';
    for (const [c, ox, oy, r] of [[[70, 50, 190], 0.25, 0.28, 0.6], [[20, 110, 170], 0.78, 0.72, 0.55], [[120, 40, 110], 0.62, 0.18, 0.35]] as [number[], number, number, number][]) {
      const x = W * ox + Math.sin(E.t * 0.05 + ox * 9) * 50 - E.cam.x * 0.05;
      const y = H * oy + Math.cos(E.t * 0.04 + oy * 7) * 40 - E.cam.y * 0.05;
      const n = bx.createRadialGradient(x, y, 0, x, y, Math.max(W, H) * r);
      n.addColorStop(0, rgba(c, 0.14));
      n.addColorStop(1, rgba(c, 0));
      bx.fillStyle = n;
      bx.fillRect(0, 0, W, H);
    }
    const im = SKY[E.fx.sky];
    if (im?.complete && im.naturalWidth) {
      const h = H * 0.95;
      const w = (im.naturalWidth * h) / im.naturalHeight;
      const off = ((((W / 2 - w * 0.64 - E.cam.x * 0.03 - E.t * 2.5) % w) + w) % w);
      bx.globalAlpha = 0.55;
      for (let x = off - w; x < W; x += w) bx.drawImage(im, x, -H * 0.04 - E.cam.y * 0.02, w + 1, h);
      bx.globalAlpha = 1;
    }
    bx.globalCompositeOperation = 'source-over';
  }
  function labels(dim: number, fh: any, ch: any, moon: any, fk: number, nk: number) {
    const z = E.cam.z;
    const c = project(0, 0);
    ctx.textAlign = 'center';
    // 深色外框取代 shadowBlur：畫布文字的模糊陰影每次都要做一次高斯模糊，幾十個標籤每幀就好幾毫秒
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(2,4,12,0.85)';
    const txt = (str: string, x: number, y: number) => {
      ctx.strokeText(str, x, y);
      ctx.fillText(str, x, y);
    };
    ctx.globalAlpha = dim;
    ctx.fillStyle = '#ffffff';
    // 字體都設上限：放大到環節層（約 5 倍）時，背景的名稱不會變成蓋住畫面的大字
    ctx.font = `800 ${clamp(15 * z, 11, 24)}px ${FONT}`;
    txt(index.name, c.x, c.y - 3 * z);
    ctx.font = `700 ${clamp(13 * z, 10, 20)}px ${MONO}`;
    txt(pct(index.v, index.has), c.x, c.y + 15 * z);
    for (const h of hubs) {
      if (h === fh) continue;
      const s = h._s;
      const hl = E.hover === h;
      if (z * s < 0.5 && !hl) continue;
      const r = h.size * z * s * (hl ? 1.3 : 1);
      ctx.globalAlpha = dim * (dimmedByHover(h) ? 0.3 : 1) * (0.35 + 0.65 * (h._depth + 1) / 2);
      ctx.font = `700 ${clamp(12 * z * s, 10, 18)}px ${FONT}`;
      ctx.fillStyle = '#e9f1ff';
      txt(h.name, h._p.x, h._p.y + r + 14 * z * s);
      ctx.font = `600 ${clamp(11 * z * s, 9, 16)}px ${MONO}`;
      ctx.fillStyle = rgba(mix(toneX(h), [255, 255, 255], 0.2), 1);
      txt(pct(h.v, h.has), h._p.x, h._p.y + r + 27 * z * s);
    }
    if (fh) {
      const r = fh._r || fh.size * z;
      ctx.globalAlpha = moon ? 1 - 0.65 * nk : 1;
      ctx.font = `800 ${clamp(16 * z * 0.7, 12, 24)}px ${FONT}`;
      ctx.fillStyle = '#fff';
      txt(fh.name, fh._p.x, fh._p.y + r + 18 * z * 0.7);
      ctx.font = `700 ${clamp(13 * z * 0.7, 10, 20)}px ${MONO}`;
      ctx.fillStyle = rgba(toneX(fh), 1);
      txt(pct(fh.v, fh.has), fh._p.x, fh._p.y + r + 34 * z * 0.7);
    }
    const sub = (list: any[], k: number, alpha: number, unit: string) => {
      for (const m of list) {
        const r = m._r || 6;
        ctx.globalAlpha = k * alpha * (0.45 + 0.55 * m._dn);
        ctx.font = `700 ${clamp(11 * z * 0.7, 10, 15)}px ${FONT}`;
        ctx.fillStyle = '#e8f0ff';
        txt(m.name || m.code, m._q.x, m._q.y + r + 12);
        ctx.font = `600 ${clamp(10 * z * 0.7, 9, 13)}px ${MONO}`;
        ctx.fillStyle = rgba(toneX(m), 1);
        txt(`${pct(m.v, m.has)}${unit ? `・${m.stocks.length} ${unit}` : m.code ? ` ${m.code}` : ''}`, m._q.x, m._q.y + r + 24);
      }
    };
    if (ch) sub(ch.moons, fk, moon ? 0.45 : 1, '檔');
    if (moon) sub(moon.stocks, nk, 1, '');
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
  }
  // h 和 other 是直接相關的類股
  function linkedTo(h: any, other: any) {
    return !!other && links.some(([a, b]: any[]) => (a === h && b === other) || (a === other && b === h));
  }
  // 滑過某類股時，不是它也不相關的類股要變淡
  function dimmedByHover(h: any) {
    return E.hover?.kind === 'hub' && E.hover !== h && !linkedTo(h, E.hover);
  }
  // 小地圖：俯視（不傾斜）軌道與類股、目前視野框
  function drawMinimap() {
    const mini = host.minimap;
    if (!mini) return;
    const m = mini.getContext('2d');
    const mw = mini.width;
    const mh = mini.height;
    const k = Math.min(mw, mh * 1.6) / (2 * (OUTER + 30));
    const ox = mw / 2;
    const oy = mh / 2;
    mini._k = { k, ox, oy };
    m.setTransform(1, 0, 0, 1, 0, 0);
    m.fillStyle = 'rgba(3,6,16,.92)';
    m.fillRect(0, 0, mw, mh);
    m.save();
    m.translate(ox, oy);
    m.scale(1, 0.62);
    m.strokeStyle = 'rgba(110,170,255,.35)';
    for (let i = 0; i < ringCount; i++) {
      m.beginPath();
      m.arc(0, 0, (RING0 + i * RING_GAP) * k, 0, 7);
      m.stroke();
    }
    m.restore();
    m.fillStyle = rgba(toneX(index), 1);
    m.beginPath();
    m.arc(ox, oy, 5, 0, 7);
    m.fill();
    for (const h of hubs) {
      m.fillStyle = rgba(toneX(h), h.name === S.sector || h === focusHub() ? 1 : 0.75);
      m.beginPath();
      m.arc(ox + h._wx * k, oy + h._wy * k * 0.62, h.name === S.sector || h === focusHub() ? 4 : 2.4, 0, 7);
      m.fill();
    }
    const vw = W / E.cam.z;
    const vh = H / E.cam.z / Math.max(0.3, E.tilt);
    m.strokeStyle = 'rgba(34,211,238,.9)';
    m.lineWidth = 2;
    m.strokeRect(ox + (E.cam.x - vw / 2) * k, oy + ((E.cam.y / Math.max(0.3, E.tilt)) - vh / 2) * k * 0.62, vw * k, vh * k * 0.62);
  }

  // ---- 互動 ----
  const local = (e: any) => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  function pickAt(x: number, y: number) {
    let best: any = null;
    let bd = 1e9;
    const consider = (e: any, p: any, r: number) => {
      if (!p) return;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < Math.max(14, r + 8) && d < bd) {
        bd = d;
        best = e;
      }
    };
    const ch = S.chain && chains[S.chain];
    const moon = ch && S.node ? ch.byId[S.node] : null;
    if (moon) for (const s of moon.stocks) consider(s, s._q, s._r || 6);
    if (ch && !best) for (const m of ch.moons) consider(m, m._q, m._r || 8);
    if (!best && S.state === 'overview') for (const h of hubs) consider(h, h._p, h._r || h.size);
    return best;
  }
  function setHover(e: any, ev?: any) {
    if (e === E.hover) return;
    E.hover = e;
    canvas.style.cursor = e ? 'pointer' : 'grab';
    host.onHover(
      e && ev ? { kind: e.kind, name: e.name, code: e.code, v: e.v, has: e.has, note: e.note, hasChains: e.kind === 'hub' && !!e.def.chains?.length } : null,
      ev ? ev.clientX : 0,
      ev ? ev.clientY : 0,
    );
  }
  const emit = () => host.onState({ ...S });
  function show(next: any, instant?: boolean) {
    const changed = next.state !== S.state || next.chain !== S.chain || next.node !== S.node;
    Object.assign(S, next);
    if (changed) {
      E.gradeSig = '';
      E.gradeAt = 0;
      setHover(null);
      resetView();
    }
    if (instant) {
      E.focusT = next.state === 'overview' ? 0 : 1.2;
      E.nodeT = next.state === 'node' ? 1.2 : 0;
      readValues();
      regrade();
      V = view();
      placeHubs();
      cameraTarget();
      E.cam = { ...E.camTo };
    }
    emit();
  }
  function onClick(e: any) {
    if (!e) {
      if (S.state === 'node') api.go({ state: 'chain', chain: S.chain });
      else if (S.state === 'overview' && S.sector) api.select(null);
      return;
    }
    if (e.kind === 'hub') {
      if (e.def.chains?.length) api.go({ state: 'chain', chain: e.def.chains[0], sector: e.name });
      else api.select(e.name);
    } else if (e.kind === 'node') {
      api.go(S.node === e.id ? { state: 'chain', chain: S.chain } : { state: 'node', chain: S.chain, node: e.id });
    }
  }
  let drag: any = null;
  const onDown = (e: any) => {
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch (_) {
      // 合成事件沒有擷取需求，略過
    }
    const [x, y] = local(e);
    drag = { sx: x, sy: y, px: E.pan.x, py: E.pan.y, moved: false };
  };
  const onMove = (e: any) => {
    const [x, y] = local(e);
    if (drag) {
      const dx = x - drag.sx;
      const dy = y - drag.sy;
      if (!drag.moved && Math.hypot(dx, dy) > 5) {
        drag.moved = true;
        E.dragging = true;
        setHover(null);
      }
      if (drag.moved) {
        E.pan.x = drag.px - dx / E.cam.z;
        E.pan.y = drag.py - dy / E.cam.z;
      }
    } else setHover(pickAt(x, y), e);
  };
  const onUp = (e: any) => {
    const d = drag;
    drag = null;
    E.dragging = false;
    canvas.style.cursor = 'grab';
    if (d && !d.moved) {
      const [x, y] = local(e);
      onClick(pickAt(x, y));
    }
  };
  const onLeave = () => {
    if (!drag) setHover(null);
  };
  const onCancel = () => {
    drag = null;
    E.dragging = false;
  };
  const onWheel = (e: any) => {
    e.preventDefault();
    E.zoomK = clamp(E.zoomK * Math.exp(-e.deltaY * 0.0015), 0.25, 6);
    setHover(null);
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('pointercancel', onCancel);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  function loop(now: number) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    acc += dt;
    fpsN++;
    if (acc > 0.5) {
      E.fps = fpsN / acc;
      acc = 0;
      fpsN = 0;
    }
    update(dt);
    render(dt);
    raf = requestAnimationFrame(loop);
  }

  // ---- 對外介面（與舊的格子版引擎相同）----
  const api: any = {
    setMap(map: any) {
      E.map = map;
      const sig = JSON.stringify([map.columns, map.hubs.map((h: any) => [h.name, h.col, h.order]), map.links, map.chains.map((c: any) => [c.id, c.sector, c.stages, c.nodes.map((n: any) => [n.id, n.stage, n.stocks.length]), c.edges])]);
      if (sig === E.sig) {
        for (const d of map.hubs) if (hubByName[d.name]) hubByName[d.name].def = d; // 結構沒變：只更新資料
        return;
      }
      E.sig = sig;
      const keep = { ...S };
      build(map);
      const valid = keep.chain && chains[keep.chain] && (keep.state !== 'node' || chains[keep.chain].byId[keep.node]);
      show(valid ? keep : { state: 'overview', chain: null, node: null, sector: null }, true);
    },
    go(next: any, instant?: boolean) {
      if (!E.map) return;
      if (next.state !== 'overview' && !chains[next.chain]) return;
      const base = { state: next.state, chain: next.state === 'overview' ? null : next.chain, node: next.state === 'node' ? next.node : null };
      const sector = next.state === 'overview' ? (next.sector ?? null) : hubOfChain(next.chain)?.name;
      if (base.state === 'chain' && S.state === 'overview') E.focusT = 0;
      if (base.state === 'node' && S.node !== base.node) E.nodeT = 0;
      show({ ...base, sector }, instant);
    },
    select(name: string | null) {
      S.sector = name;
      resetView();
      emit();
    },
    back() {
      if (S.state === 'node') api.go({ state: 'chain', chain: S.chain });
      else if (S.state === 'chain') api.go({ state: 'overview', sector: S.sector });
      else if (S.sector) api.select(null);
    },
    refit() {
      resetView();
    },
    resize(w: number, h: number) {
      DPR = Math.min(window.devicePixelRatio || 1, 2);
      W = Math.max(1, w);
      H = Math.max(1, h);
      canvas.width = Math.round(W * DPR);
      canvas.height = Math.round(H * DPR);
      Lc.width = canvas.width;
      Lc.height = canvas.height;
      B1.width = Math.max(1, canvas.width >> 2);
      B1.height = Math.max(1, canvas.height >> 2);
      B2.width = Math.max(1, canvas.width >> 3);
      B2.height = Math.max(1, canvas.height >> 3);
      Bc.width = Math.max(1, canvas.width >> 1); // 背景只有柔的漸層與銀河，半解析度就夠
      Bc.height = Math.max(1, canvas.height >> 1);
    },
    // 回放時：漲跌超標的類股（或環節）放出擴散波
    burst(threshold = 1.6) {
      if (host.reduced) return;
      const ch = S.chain && chains[S.chain];
      const list = ch ? ch.moons : hubs;
      for (const x of list) if (x.has && Math.abs(x.v) >= threshold) E.effects.push({ at: () => x._q || x._p, r: 10, max: 160, life: 1, color: toneOf(x.v, true) });
    },
    // 搜尋導向用：在目標類股（'hub'）或環節（'node'）放兩圈青色擴散波
    ping(kind: 'hub' | 'node', name: string) {
      if (host.reduced) return;
      const t = kind === 'hub' ? hubByName[name] : S.chain && chains[S.chain]?.byId[name];
      if (!t) return;
      for (const [delay, max] of [[0, 220], [220, 300]]) setTimeout(() => E.effects.push({ at: () => t._q || t._p, r: 12, max, life: 1, color: [34, 211, 238] }), delay);
    },
    setAnim(on: boolean) {
      E.motion = on && !host.reduced;
    },
    // 畫面設定：sky＝'strong' | 'soft' | 'off'（銀河強／淡／關），tilt＝3D 傾斜
    setFx(fx: any) {
      E.fx = { ...E.fx, ...fx };
    },
    markDirty() {},
    key(e: any) {
      const step = 90 / E.cam.z;
      if (e.key === 'Escape') api.back();
      else if (e.key === 'ArrowLeft') E.pan.x -= step;
      else if (e.key === 'ArrowRight') E.pan.x += step;
      else if (e.key === 'ArrowUp') E.pan.y -= step;
      else if (e.key === 'ArrowDown') E.pan.y += step;
      else if (e.key === '+' || e.key === '=') E.zoomK = clamp(E.zoomK * 1.15, 0.25, 6);
      else if (e.key === '-') E.zoomK = clamp(E.zoomK / 1.15, 0.25, 6);
      else return false;
      return true;
    },
    minimapClick(e: any) {
      const mini = host.minimap;
      if (!mini?._k) return;
      const r = mini.getBoundingClientRect();
      const { k, ox, oy } = mini._k;
      const mx = ((e.clientX - r.left) / r.width) * mini.width;
      const my = ((e.clientY - r.top) / r.height) * mini.height;
      const b = baseTarget(); // 點小地圖：偏移設成「點的位置－目前焦點」
      E.pan.x = (mx - ox) / k - b.x;
      E.pan.y = ((my - oy) / (k * 0.62)) * E.tilt - b.y;
    },
    stats() {
      const parts = hubs.reduce((n, h) => n + h.particles.length + h.disk.length, 0);
      return {
        fps: E.fps, ticks: E.ticks, entities: hubs.length + (S.chain ? chains[S.chain]?.moons.length || 0 : 0), drawn: E.drawn,
        particles: parts + dust.length, particlesMax: parts + dust.length, tweens: 0, camX: E.cam.x, camY: E.cam.y, zoom: E.cam.z,
        state: S.state, chain: S.chain, node: S.node, w: canvas.width, h: canvas.height, dpr: DPR, ms: E.ms, quality: E.quality,
      };
    },
    start() {
      last = performance.now();
      raf = requestAnimationFrame(loop);
    },
    // 測試用：不靠 requestAnimationFrame，手動推進
    step(n = 1) {
      for (let i = 0; i < n; i++) {
        update(1 / 60);
        render(1 / 60);
      }
    },
    destroy() {
      cancelAnimationFrame(raf);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('pointercancel', onCancel);
      canvas.removeEventListener('wheel', onWheel);
    },
  };
  return api;
}

export const OrbitEngine = { create };
