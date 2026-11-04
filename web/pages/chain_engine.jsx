// 產業鏈地圖的畫面引擎（Canvas 2D，不依賴任何套件）：把「產業全景 → 單一產業鏈 → 環節個股」畫成可拖曳縮放的互動地圖。
// 架構（都在這一支檔案裡）：
//   Tweens／Camera／ParticlePool／Scene   補間動畫、攝影機（平移縮放運鏡）、粒子池、實體分層與點擊測試
//   HubEntity／NodeEntity／StockEntity／FiberEntity／LabelEntity   各種畫在地圖上的東西
//   create()   組裝成引擎：固定步長 60Hz 更新 + 每個畫面更新率繪圖，狀態機 overview → chain → node
// 引擎只管「畫」。數字（漲跌、報價）都由外部的 host.read(kind, a, b) 提供，引擎每幀讀取，畫面自然跟著資料更新。
(() => {
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = {
    inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
    outCubic: (t) => 1 - (1 - t) ** 3,
    outBack: (t) => {
      const c1 = 1.70158;
      const c3 = c1 + 1;
      return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
    },
  };
  // 台股習慣：紅漲綠跌
  const TONE = { up: [255, 77, 109], down: [45, 255, 160], flat: [122, 162, 255], none: [96, 112, 150] };
  const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
  const toneOf = (v, has) => (!has ? TONE.none : Math.abs(v) < 0.05 ? TONE.flat : v > 0 ? TONE.up : TONE.down);
  const fmt = (v, has) => (!has ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`);
  const FONT = '"Noto Sans TC","Microsoft JhengHei",system-ui,sans-serif';

  // ---- 版面常數（世界座標）----
  const ROWS_PER = 5;
  const ROW_GAP = 250;
  const SUB_GAP = 290;
  const GROUP_GAP = 230;
  const PAD_X = 260;
  const TOP = 260;
  const LOCAL_W = 1160;
  const LOCAL_H = 720;
  const NODE_W = 230;
  const NODE_H = 100;

  class Tweens {
    constructor(reduced) {
      this.list = [];
      this.reduced = reduced;
    }
    to(obj, props, dur, o = {}) {
      const delay = this.reduced ? 0 : o.delay || 0;
      const d = this.reduced ? 0 : dur;
      if (d <= 0 && delay <= 0) {
        Object.assign(obj, props);
        if (o.onDone) o.onDone();
        return;
      }
      this.list.push({ obj, props, dur: Math.max(d, 1e-4), delay, ease: o.ease || ease.outCubic, el: 0, from: null, onDone: o.onDone });
    }
    cancel(obj) {
      this.list = this.list.filter((t) => t.obj !== obj);
    }
    update(dt) {
      for (const t of this.list.slice()) {
        t.el += dt;
        if (t.el < t.delay) continue;
        if (!t.from) {
          t.from = {};
          for (const k of Object.keys(t.props)) t.from[k] = t.obj[k];
        }
        const p = clamp((t.el - t.delay) / t.dur, 0, 1);
        const e = t.ease(p);
        for (const k of Object.keys(t.props)) t.obj[k] = lerp(t.from[k], t.props[k], e);
        if (p >= 1) {
          this.list.splice(this.list.indexOf(t), 1);
          if (t.onDone) t.onDone();
        }
      }
    }
  }

  class Camera {
    constructor() {
      this.x = 0;
      this.y = 0;
      this.zoom = 0.4;
      this.vw = 1;
      this.vh = 1;
      this.inset = { l: 0, r: 0, t: 0, b: 0 };
      this.min = 0.15;
      this.max = 2.6;
    }
    cx() {
      return this.inset.l + (this.vw - this.inset.l - this.inset.r) / 2;
    }
    cy() {
      return this.inset.t + (this.vh - this.inset.t - this.inset.b) / 2;
    }
    s2w(sx, sy) {
      return [(sx - this.cx()) / this.zoom + this.x, (sy - this.cy()) / this.zoom + this.y];
    }
    zoomAt(sx, sy, f) {
      const [wx, wy] = this.s2w(sx, sy);
      this.zoom = clamp(this.zoom * f, this.min, this.max);
      this.x = wx - (sx - this.cx()) / this.zoom;
      this.y = wy - (sy - this.cy()) / this.zoom;
    }
    apply(ctx, dpr) {
      ctx.setTransform(dpr * this.zoom, 0, 0, dpr * this.zoom, dpr * (this.cx() - this.x * this.zoom), dpr * (this.cy() - this.y * this.zoom));
    }
  }

  // 預先配置的粒子池：光纖封包、抵達火花、環境塵埃共用，不在每幀建立新物件
  class ParticlePool {
    constructor(n, world) {
      this.p = Array.from({ length: n }, () => ({ alive: false }));
      this.cur = 0;
      this.world = world;
      this.sprites = new Map();
    }
    get active() {
      let c = 0;
      for (const q of this.p) if (q.alive) c++;
      return c;
    }
    reset() {
      for (const q of this.p) q.alive = false;
    }
    spawn(init) {
      for (let i = 0; i < this.p.length; i++) {
        const q = this.p[(this.cur + i) % this.p.length];
        if (!q.alive) {
          this.cur = (this.cur + i + 1) % this.p.length;
          Object.assign(q, { alive: true, vx: 0, vy: 0, life: 1, max: 1, d: 0 }, init);
          return q;
        }
      }
      return null;
    }
    sprite(c) {
      const k = c.join(',');
      let s = this.sprites.get(k);
      if (!s) {
        s = document.createElement('canvas');
        s.width = 64;
        s.height = 64;
        const g = s.getContext('2d');
        const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
        r.addColorStop(0, 'rgba(255,255,255,1)');
        r.addColorStop(0.18, rgba(c, 0.95));
        r.addColorStop(0.5, rgba(c, 0.35));
        r.addColorStop(1, rgba(c, 0));
        g.fillStyle = r;
        g.fillRect(0, 0, 64, 64);
        this.sprites.set(k, s);
      }
      return s;
    }
    update(dt) {
      const W = this.world;
      for (const q of this.p) {
        if (!q.alive) continue;
        if (q.type === 'packet') {
          const f = q.fiber;
          q.d += q.speed * dt;
          if (f.alpha < 0.05 || !f.visible) {
            q.alive = false;
          } else if (q.d >= f.len) {
            q.alive = false;
            const end = f.at(f.len);
            for (let i = 0; i < 4; i++) {
              const a = Math.random() * Math.PI * 2;
              const s = 30 + Math.random() * 60;
              this.spawn({ type: 'spark', x: end.x, y: end.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.5, max: 0.5, color: q.color, size: 9 });
            }
          }
        } else if (q.type === 'spark') {
          q.x += q.vx * dt;
          q.y += q.vy * dt;
          q.life -= dt;
          if (q.life <= 0) q.alive = false;
        } else if (q.type === 'dust') {
          q.x += q.vx * dt;
          q.y += q.vy * dt;
          if (q.x < -50) q.x = W.w + 50;
          if (q.x > W.w + 50) q.x = -50;
          if (q.y < -50) q.y = W.h + 50;
          if (q.y > W.h + 50) q.y = -50;
        }
      }
    }
    draw(ctx, cam) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const q of this.p) {
        if (!q.alive) continue;
        if (q.type === 'packet') {
          const f = q.fiber;
          const a = clamp(f.alpha, 0, 1);
          const head = f.at(q.d);
          const tail = f.at(Math.max(0, q.d - 46));
          ctx.globalAlpha = a * 0.8;
          ctx.strokeStyle = rgba(q.color, 1);
          ctx.lineWidth = 3.2;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(tail.x, tail.y);
          ctx.lineTo(head.x, head.y);
          ctx.stroke();
          ctx.globalAlpha = a;
          ctx.drawImage(this.sprite(q.color), head.x - q.size, head.y - q.size, q.size * 2, q.size * 2);
        } else if (q.type === 'spark') {
          ctx.globalAlpha = clamp(q.life / q.max, 0, 1) * 0.9;
          const s = q.size * (0.6 + (0.4 * q.life) / q.max);
          ctx.drawImage(this.sprite(q.color), q.x - s, q.y - s, s * 2, s * 2);
        } else if (q.type === 'dust') {
          ctx.globalAlpha = q.a * clamp(cam.zoom * 1.6, 0.3, 1);
          ctx.fillStyle = '#9db8ff';
          ctx.fillRect(q.x, q.y, q.size, q.size);
        }
      }
      ctx.restore();
    }
  }

  function glowText(c, text, x, y, size, color, weight = 700) {
    c.font = `${weight} ${size}px ${FONT}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = color;
    c.fillText(text, x, y);
  }
  function hexPath(c, x, y, r) {
    c.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 6 + (i * Math.PI) / 3;
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r;
      if (i) c.lineTo(px, py);
      else c.moveTo(px, py);
    }
    c.closePath();
  }
  function bevelPath(c, x, y, w, h, b) {
    const l = x - w / 2;
    const r = x + w / 2;
    const t = y - h / 2;
    const bt = y + h / 2;
    c.beginPath();
    c.moveTo(l + b, t);
    c.lineTo(r - b, t);
    c.lineTo(r, t + b);
    c.lineTo(r, bt - b);
    c.lineTo(r - b, bt);
    c.lineTo(l + b, bt);
    c.lineTo(l, bt - b);
    c.lineTo(l, t + b);
    c.closePath();
  }

  class Entity {
    constructor(eng, o) {
      this.eng = eng;
      Object.assign(this, { x: 0, y: 0, scale: 1, alpha: 1, visible: true, layer: 3, kind: '', v: 0, has: false, note: '', hover: 0, interactive: false, hovered: false }, o);
    }
    read() {
      return { v: null };
    }
    update(dt) {
      const r = this.read();
      this.has = r.v !== null && r.v !== undefined;
      this.note = r.note || '';
      this.v += ((this.has ? r.v : 0) - this.v) * Math.min(1, dt * 7); // 數字平滑追上目標，顏色不會突然跳
      this.hover += ((this.hovered ? 1 : 0) - this.hover) * Math.min(1, dt * 12);
    }
    draw() {}
    hit() {
      return false;
    }
  }

  class HubEntity extends Entity {
    constructor(eng, def, x, y) {
      super(eng, { kind: 'hub', layer: 3, interactive: true });
      this.def = def;
      this.name = def.name;
      this.bx = x;
      this.by = y;
      this.ox = 0;
      this.oy = 0;
      this.x = x;
      this.y = y;
    }
    get hasChains() {
      return this.def.chains.length > 0;
    }
    get r() {
      return 60 + 36 * Math.sqrt(clamp((this.def.turnover_share_pct || 0) / 40, 0, 1));
    }
    read() {
      return this.eng.host.read('hub', this.name);
    }
    update(dt) {
      super.update(dt);
      this.x = this.bx + this.ox;
      this.y = this.by + this.oy;
    }
    hit(wx, wy) {
      return Math.hypot(wx - this.x, wy - this.y) <= this.r * this.scale;
    }
    draw(c, eng) {
      const t = eng.time;
      const r = this.r * this.scale;
      const col = toneOf(this.v, this.has);
      const mag = this.has ? clamp(Math.abs(this.v) / 3, 0, 1) : 0;
      const sel = eng.S.sector === this.name;
      c.save();
      c.globalAlpha = this.alpha;
      c.shadowColor = rgba(col, 0.9);
      c.shadowBlur = 12 + 26 * mag + 12 * this.hover + (sel ? 22 : 0) + (this.hasChains ? 6 : 0);
      hexPath(c, this.x, this.y, r);
      const g = c.createRadialGradient(this.x, this.y, 0, this.x, this.y, r);
      g.addColorStop(0, rgba(col, 0.1 + 0.28 * mag));
      g.addColorStop(1, 'rgba(6,10,24,.9)');
      c.fillStyle = g;
      c.fill();
      c.lineWidth = sel ? 4.5 : this.hasChains ? 3.2 : 2;
      c.strokeStyle = sel ? '#ffffff' : rgba(col, this.hasChains ? 1 : 0.7);
      c.stroke();
      c.shadowBlur = 0;
      if (this.hasChains) {
        // 有產業鏈的站點：內圈旋轉虛線，提示可以點進去
        c.save();
        c.translate(this.x, this.y);
        c.rotate(t * 0.25);
        hexPath(c, 0, 0, r * 0.8);
        c.lineWidth = 1.4;
        c.strokeStyle = rgba(col, 0.5);
        c.setLineDash([14, 12]);
        c.stroke();
        c.restore();
      }
      const s = clamp(r / 80, 0.85, 1.15);
      glowText(c, this.name, this.x, this.y - 16 * s, 27 * s, '#ffffff');
      glowText(c, fmt(this.v, this.has), this.x, this.y + 18 * s, 26 * s, rgba(col, 1), 800);
      glowText(c, this.hasChains ? `${this.def.chains.length} 條產業鏈 ▸` : this.note || '', this.x, this.y + 46 * s, 14 * s, 'rgba(170,190,230,.85)', 500);
      c.restore();
    }
  }

  class NodeEntity extends Entity {
    constructor(eng, chain, n, x, y) {
      super(eng, { kind: 'node', layer: 3, interactive: true, x, y, alpha: 0, scale: 0.6, visible: false });
      this.chain = chain;
      this.n = n;
      this.id = n.id;
      this.stage = n.stage;
    }
    read() {
      return this.eng.host.read('node', this.chain.def.id, this.id);
    }
    hit(wx, wy) {
      return Math.abs(wx - this.x) <= (NODE_W * this.scale) / 2 && Math.abs(wy - this.y) <= (NODE_H * this.scale) / 2;
    }
    draw(c, eng) {
      const col = toneOf(this.v, this.has);
      const mag = this.has ? clamp(Math.abs(this.v) / 3, 0, 1) : 0;
      const sel = eng.S.node === this.id && eng.S.chain === this.chain.def.id;
      const w = NODE_W * this.scale;
      const h = NODE_H * this.scale;
      const s = this.scale;
      c.save();
      c.globalAlpha = this.alpha;
      c.shadowColor = rgba(col, 0.95);
      c.shadowBlur = 12 + 22 * mag + 12 * this.hover + (sel ? 18 : 0);
      bevelPath(c, this.x, this.y, w, h, 16 * s);
      const g = c.createLinearGradient(this.x - w / 2, this.y - h / 2, this.x + w / 2, this.y + h / 2);
      g.addColorStop(0, rgba(col, 0.18 + 0.3 * mag));
      g.addColorStop(1, 'rgba(6,10,24,.92)');
      c.fillStyle = g;
      c.fill();
      c.lineWidth = sel ? 4 : 2.4;
      c.strokeStyle = sel ? '#ffffff' : rgba(col, 1);
      c.stroke();
      c.shadowBlur = 0;
      glowText(c, this.n.name, this.x, this.y - 26 * s, 21 * s, '#fff');
      glowText(c, fmt(this.v, this.has), this.x, this.y + 8 * s, 30 * s, rgba(col, 1), 800);
      glowText(c, `${this.n.stocks.length} 檔${this.note ? `・${this.note}` : ''}`, this.x, this.y + 36 * s, 13 * s, 'rgba(170,190,230,.85)', 500);
      c.restore();
    }
  }

  class StockEntity extends Entity {
    constructor(eng, chain, st, x, y, nodeEnt) {
      super(eng, { kind: 'stock', layer: 4, interactive: true, x, y, scale: 0 });
      this.chain = chain;
      this.code = st.code;
      this.name = st.name;
      this.nodeEnt = nodeEnt;
    }
    read() {
      return this.eng.host.read('stock', this.chain.def.id, this.code);
    }
    hit(wx, wy) {
      return Math.hypot(wx - this.x, wy - this.y) <= 38 * this.scale;
    }
    draw(c) {
      const col = toneOf(this.v, this.has);
      const r = 38 * this.scale;
      const s = this.scale;
      const nd = this.nodeEnt;
      c.save();
      c.globalAlpha = this.alpha;
      c.setLineDash([4, 7]);
      c.lineWidth = 1.6;
      c.strokeStyle = rgba(col, 0.6);
      c.beginPath();
      c.moveTo(nd.x, nd.y);
      c.lineTo(this.x, this.y);
      c.stroke();
      c.setLineDash([]);
      c.shadowColor = rgba(col, 0.9);
      c.shadowBlur = 14 + 12 * this.hover;
      c.beginPath();
      c.arc(this.x, this.y, r, 0, Math.PI * 2);
      c.fillStyle = 'rgba(6,10,24,.92)';
      c.fill();
      c.lineWidth = 2.4;
      c.strokeStyle = rgba(col, 1);
      c.stroke();
      c.shadowBlur = 0;
      glowText(c, this.code, this.x, this.y - 11 * s, 13 * s, 'rgba(170,190,230,.9)', 500);
      glowText(c, fmt(this.v, this.has), this.x, this.y + 8 * s, 15 * s, rgba(col, 1), 800);
      glowText(c, this.name, this.x, this.y + r + 15 * s, 15 * s, '#e8f0ff', 600);
      c.restore();
    }
  }

  // 光纖：兩個端點之間的貝茲曲線，封包沿著它流動；端點由 a()/b() 提供，站點被推開時會跟著重新計算
  class FiberEntity extends Entity {
    constructor(eng, o) {
      super(eng, { kind: 'fiber', layer: 1 });
      Object.assign(this, { progress: 1, pts: [], cum: [0], len: 1, ax: Number.NaN, ay: Number.NaN, bx: Number.NaN, by: Number.NaN, timer: Math.random(), speed: 150, local: false }, o);
      this.rebuild();
    }
    rebuild() {
      const A = this.a();
      const B = this.b();
      if (A.x === this.ax && A.y === this.ay && B.x === this.bx && B.y === this.by) return;
      this.ax = A.x;
      this.ay = A.y;
      this.bx = B.x;
      this.by = B.y;
      const dx = B.x - A.x;
      const dy = B.y - A.y;
      const vertical = Math.abs(dx) < 80;
      const c1 = vertical ? { x: A.x, y: A.y + dy * 0.5 } : { x: A.x + dx * 0.5, y: A.y };
      const c2 = vertical ? { x: B.x, y: B.y - dy * 0.5 } : { x: B.x - dx * 0.5, y: B.y };
      this.pts = [];
      this.cum = [0];
      for (let i = 0; i <= 40; i++) {
        const t = i / 40;
        const m = 1 - t;
        const p = {
          x: m * m * m * A.x + 3 * m * m * t * c1.x + 3 * m * t * t * c2.x + t * t * t * B.x,
          y: m * m * m * A.y + 3 * m * m * t * c1.y + 3 * m * t * t * c2.y + t * t * t * B.y,
        };
        this.pts.push(p);
        if (i) this.cum.push(this.cum[i - 1] + Math.hypot(p.x - this.pts[i - 1].x, p.y - this.pts[i - 1].y));
      }
      this.len = this.cum[40] || 1;
    }
    at(d) {
      const dd = clamp(d, 0, this.len);
      let lo = 0;
      let hi = 40;
      while (hi - lo > 1) {
        const m = (lo + hi) >> 1;
        if (this.cum[m] <= dd) lo = m;
        else hi = m;
      }
      const span = this.cum[hi] - this.cum[lo] || 1;
      const t = (dd - this.cum[lo]) / span;
      return { x: lerp(this.pts[lo].x, this.pts[hi].x, t), y: lerp(this.pts[lo].y, this.pts[hi].y, t) };
    }
    update(dt) {
      this.rebuild();
      this.has = this.src.has;
      this.v = this.src.v;
      const eng = this.eng;
      if (!this.visible || this.alpha < 0.2 || this.progress < 1 || !this.has || !eng.anim || eng.host.reduced) return;
      this.timer -= dt;
      if (this.timer <= 0) {
        const m = Math.abs(this.v);
        this.timer = ((this.local ? 1.0 : 1.5) / (0.5 + Math.min(m, 3) * 0.7)) * (0.8 + Math.random() * 0.4);
        eng.pool.spawn({ type: 'packet', fiber: this, d: 0, speed: this.speed * (0.8 + Math.min(m, 3) * 0.15), color: toneOf(this.v, true), size: this.local ? 15 : 22 });
      }
    }
    draw(c) {
      const col = toneOf(this.v, this.has);
      const n = Math.max(2, Math.floor(this.progress * 40) + 1);
      const path = () => {
        c.beginPath();
        c.moveTo(this.pts[0].x, this.pts[0].y);
        for (let i = 1; i < n; i++) c.lineTo(this.pts[i].x, this.pts[i].y);
      };
      c.save();
      c.globalAlpha = this.alpha;
      c.lineCap = 'round';
      c.lineJoin = 'round';
      path();
      c.strokeStyle = rgba(col, this.has ? 0.14 : 0.06);
      c.lineWidth = this.local ? 12 : 14;
      c.stroke();
      path();
      c.strokeStyle = rgba(col, this.has ? 0.55 : 0.2);
      c.lineWidth = this.local ? 2.2 : 2.6;
      if (!this.has) c.setLineDash([8, 10]);
      c.stroke();
      c.restore();
    }
  }

  class LabelEntity extends Entity {
    constructor(eng, o) {
      super(eng, Object.assign({ kind: 'label', layer: 0 }, o));
    }
    draw(c) {
      c.save();
      c.globalAlpha = this.alpha;
      glowText(c, this.text, this.x, this.y, this.size || 28, this.color || 'rgba(130,160,230,.55)', 700);
      c.restore();
    }
  }

  class Scene {
    constructor() {
      this.list = [];
      this.dirty = true;
      this.ordered = [];
    }
    add(e) {
      this.list.push(e);
      this.dirty = true;
      return e;
    }
    remove(e) {
      this.list = this.list.filter((x) => x !== e);
      this.dirty = true;
    }
    clear() {
      this.list = [];
      this.dirty = true;
    }
    order() {
      if (this.dirty) {
        this.ordered = this.list
          .map((e, i) => [e, i])
          .sort((a, b) => a[0].layer - b[0].layer || a[1] - b[1])
          .map((a) => a[0]);
        this.dirty = false;
      }
      return this.ordered;
    }
    update(dt) {
      for (const e of this.list) e.update(dt);
    }
    pick(wx, wy) {
      const o = this.order();
      for (let i = o.length - 1; i >= 0; i--) {
        const e = o[i];
        if (e.interactive && e.visible && e.alpha > 0.5 && e.scale > 0.3 && e.hit(wx, wy)) return e;
      }
      return null;
    }
  }

  // 每欄的站點分成多個子欄（每個子欄 5 個），奇數子欄下移半格，排成蜂巢狀
  function layoutHubs(hubs, ncols) {
    const cols = Array.from({ length: ncols }, () => []);
    for (const h of hubs) cols[clamp(h.col, 0, ncols - 1)].push(h);
    const pos = {};
    const heads = [];
    let x = PAD_X;
    for (const list of cols) {
      list.sort((a, b) => a.order - b.order);
      const sub = Math.max(1, Math.ceil(list.length / ROWS_PER));
      list.forEach((h, i) => {
        const s = Math.floor(i / ROWS_PER);
        pos[h.name] = { x: x + s * SUB_GAP, y: TOP + (i % ROWS_PER) * ROW_GAP + (s % 2 ? ROW_GAP / 2 : 0) };
      });
      heads.push(x + ((sub - 1) * SUB_GAP) / 2);
      x += (sub - 1) * SUB_GAP + GROUP_GAP + SUB_GAP;
    }
    return { pos, heads, w: x - GROUP_GAP - SUB_GAP + PAD_X, h: TOP + (ROWS_PER - 1) * ROW_GAP + ROW_GAP / 2 + 160 };
  }

  function create(canvas, host) {
    const ctx = canvas.getContext('2d');
    const world = { w: 3000, h: 1600 };
    const eng = {
      host,
      S: { state: 'overview', chain: null, node: null, sector: null },
      cam: new Camera(),
      tw: new Tweens(host.reduced),
      scene: new Scene(),
      pool: new ParticlePool(1800, world),
      effects: [],
      hubs: {},
      chains: {},
      hubFibers: [],
      colHeads: [],
      time: 0,
      ticks: 0,
      drawn: 0,
      fps: 0,
      anim: !host.reduced,
      sig: '',
      map: null,
    };
    const { S, cam, tw, scene, pool } = eng;
    let DPR = 1;
    let raf = 0;
    let last = 0;
    let acc = 0;
    let fpsT = 0;
    let fpsF = 0;
    let drag = null;
    let hoverEnt = null;
    const STEP = 1 / 60;

    const emit = () => host.onState({ ...S });
    const hubOfChain = (id) => eng.hubs[eng.chains[id].def.sector];

    // ---- 建立世界 ----
    function build(map) {
      scene.clear();
      pool.reset();
      eng.hubs = {};
      eng.chains = {};
      eng.hubFibers = [];
      eng.colHeads = [];
      const L = layoutHubs(map.hubs, map.columns.length);
      world.w = L.w;
      world.h = L.h;
      for (const h of map.hubs) {
        const p = L.pos[h.name];
        eng.hubs[h.name] = scene.add(new HubEntity(eng, h, p.x, p.y));
      }
      map.columns.forEach((name, i) => {
        eng.colHeads.push(scene.add(new LabelEntity(eng, { x: L.heads[i] ?? 0, y: 100, text: name, size: 36, layer: 0 })));
      });
      for (const [a, b] of map.links) {
        const A = eng.hubs[a];
        const B = eng.hubs[b];
        if (!A || !B) continue;
        eng.hubFibers.push(
          scene.add(
            new FiberEntity(eng, {
              a: () => ({ x: A.x + A.r * A.scale * 0.86, y: A.y }),
              b: () => ({ x: B.x - B.r * B.scale * 0.86, y: B.y }),
              src: A,
              speed: 190,
            }),
          ),
        );
      }
      for (const def of map.chains) {
        const hub = eng.hubs[def.sector];
        if (!hub) continue;
        const chain = { def, ents: [], nodeEnts: {}, fibers: [] };
        const S_ = def.stages.length;
        const colX = (si) => hub.bx - LOCAL_W / 2 + NODE_W / 2 + (S_ > 1 ? (si * (LOCAL_W - NODE_W)) / (S_ - 1) : (LOCAL_W - NODE_W) / 2);
        def.stages.forEach((_, si) => {
          const ns = def.nodes.filter((n) => n.stage === si);
          const gap = (LOCAL_H - ns.length * NODE_H) / (ns.length + 1);
          ns.forEach((n, j) => {
            const e = new NodeEntity(eng, chain, n, colX(si), hub.by - LOCAL_H / 2 + gap * (j + 1) + NODE_H * j + NODE_H / 2);
            chain.nodeEnts[n.id] = e;
            chain.ents.push(e);
            scene.add(e);
          });
        });
        def.stages.forEach((name, si) => {
          const l = new LabelEntity(eng, { x: colX(si), y: hub.by - LOCAL_H / 2 - 38, text: name, size: 24, color: 'rgba(34,211,238,.85)', alpha: 0, visible: false, layer: 4 });
          l.stage = si;
          chain.ents.push(l);
          scene.add(l);
        });
        for (const [a, b] of def.edges) {
          const A = chain.nodeEnts[a];
          const B = chain.nodeEnts[b];
          const f = new FiberEntity(eng, {
            a: () => ({ x: A.x + (NODE_W / 2) * A.scale, y: A.y }),
            b: () => ({ x: B.x - (NODE_W / 2) * B.scale, y: B.y }),
            src: A,
            local: true,
            alpha: 0,
            visible: false,
            progress: 0,
          });
          f.stage = A.stage;
          chain.fibers.push(f);
          chain.ents.push(f);
          scene.add(f);
        }
        eng.chains[def.id] = chain;
      }
      for (let i = 0; i < 140; i++) {
        pool.spawn({ type: 'dust', x: Math.random() * world.w, y: Math.random() * world.h, vx: (Math.random() - 0.5) * 10, vy: (Math.random() - 0.5) * 10, a: 0.15 + Math.random() * 0.35, size: 2 + Math.random() * 2.5 });
      }
      if (host.reduced) for (const q of pool.p) if (q.type === 'dust') q.vx = q.vy = 0;
    }

    // ---- 狀態機與運鏡 ----
    function viewFor() {
      const ins = host.insets(S); // 面板開著要留多少邊界，由外部依目前狀態決定
      const aw = cam.vw - ins.l - ins.r;
      const ah = cam.vh - ins.t - ins.b;
      if (S.state === 'overview') return { x: world.w / 2, y: world.h / 2, zoom: Math.min(aw / world.w, ah / world.h) * 0.97, ins };
      const hub = hubOfChain(S.chain);
      const z = Math.min(aw / (LOCAL_W + 140), ah / (LOCAL_H + 170));
      if (S.state === 'chain') return { x: hub.bx, y: hub.by + 8, zoom: z, ins };
      const n = eng.chains[S.chain].nodeEnts[S.node];
      return { x: lerp(hub.bx, n.x, 0.25), y: lerp(hub.by, n.y, 0.25), zoom: z * 0.9, ins };
    }
    function moveCamera(dur, instant) {
      const v = viewFor();
      cam.min = Math.min(v.zoom, 0.3) * 0.7;
      tw.cancel(cam);
      tw.cancel(cam.inset);
      const d = instant ? 0 : dur;
      tw.to(cam, { x: v.x, y: v.y, zoom: v.zoom }, d, { ease: ease.inOutCubic });
      tw.to(cam.inset, v.ins, d, { ease: ease.inOutCubic });
    }
    function clearStocks() {
      for (const e of scene.list.filter((x) => x.kind === 'stock')) {
        tw.cancel(e);
        scene.remove(e);
      }
    }
    function spawnStocks(chain, nodeId, instant) {
      clearStocks();
      const n = chain.def.nodes.find((x) => x.id === nodeId);
      const ne = chain.nodeEnts[nodeId];
      const hub = hubOfChain(chain.def.id);
      const base = Math.atan2(ne.y - hub.by, ne.x - hub.bx);
      const cnt = n.stocks.length;
      const spread = Math.min(Math.PI * 1.2, 0.5 + cnt * 0.45);
      n.stocks.forEach((s, i) => {
        const a = base + (cnt > 1 ? (i / (cnt - 1) - 0.5) * spread : 0);
        const dist = 215 + (i % 2) * 30;
        const e = scene.add(new StockEntity(eng, chain, s, ne.x, ne.y, ne));
        tw.to(e, { x: ne.x + Math.cos(a) * dist, y: ne.y + Math.sin(a) * dist * 0.85, scale: 1 }, instant ? 0 : 0.7, { ease: ease.outBack, delay: instant ? 0 : 0.15 + i * 0.07 });
      });
    }
    function show(next, instant) {
      Object.assign(S, next);
      const dur = instant ? 0 : 0.9;
      const away = S.state !== 'overview';
      const focusHub = away ? hubOfChain(S.chain) : null;
      for (const h of Object.values(eng.hubs)) {
        const focused = away && h === focusHub;
        const other = away && !focused;
        let ox = 0;
        let oy = 0;
        if (other) {
          const dx = h.bx - focusHub.bx;
          const dy = h.by - focusHub.by;
          const d = Math.hypot(dx, dy) || 1;
          ox = (dx / d) * 1200;
          oy = (dy / d) * 1200;
        }
        tw.cancel(h);
        tw.to(h, { ox, oy, alpha: focused ? 0 : other ? 0.25 : 1, scale: focused ? 1.9 : 1 }, dur, { ease: ease.inOutCubic });
      }
      for (const f of eng.hubFibers) {
        tw.cancel(f);
        tw.to(f, { alpha: away ? 0.1 : 1 }, dur);
      }
      for (const c of eng.colHeads) {
        tw.cancel(c);
        tw.to(c, { alpha: away ? 0 : 1 }, dur);
      }
      // 點進單一環節（支線個股展開）時，同一條鏈的其他環節、光纖、階段標題全部淡出，只留被選的環節，避免和個股、流動封包重疊
      const shown = (chain, e) => away && chain.def.id === S.chain && (S.state !== 'node' || (e instanceof NodeEntity && e.id === S.node));
      for (const chain of Object.values(eng.chains)) {
        for (const e of chain.ents) {
          const on = shown(chain, e);
          tw.cancel(e);
          if (on) {
            e.visible = true;
            const dl = instant ? 0 : 0.3 + (e.stage ?? 0) * 0.14;
            const D = instant ? 0 : 1;
            if (e instanceof FiberEntity) {
              e.progress = 0;
              tw.to(e, { alpha: 1, progress: 1 }, 0.7 * D, { delay: dl + (instant ? 0 : 0.25), ease: ease.inOutCubic });
            } else {
              tw.to(e, { alpha: 1, scale: 1 }, 0.6 * D, { delay: dl, ease: ease.outBack });
            }
          } else if (e.visible) {
            const done = () => {
              if (!shown(chain, e)) e.visible = false;
            };
            if (e instanceof FiberEntity) tw.to(e, { alpha: 0 }, dur * 0.5, { onDone: done });
            else tw.to(e, { alpha: 0, scale: 0.6 }, dur * 0.5, { onDone: done });
          }
        }
      }
      if (S.state === 'node') spawnStocks(eng.chains[S.chain], S.node, instant);
      else clearStocks();
      moveCamera(dur + 0.1, instant);
      emit();
    }

    // ---- 更新與繪圖 ----
    function update(dt) {
      eng.time += dt;
      eng.ticks++;
      tw.update(dt);
      scene.update(dt);
      pool.update(dt);
      for (const e of eng.effects) e.life -= dt * 1.1;
      while (eng.effects.length && eng.effects[0].life <= 0) eng.effects.shift();
    }
    function drawMini() {
      const mini = host.minimap;
      if (!mini) return;
      const m = mini.getContext('2d');
      const W = mini.width;
      const H = mini.height;
      const k = Math.min(W / world.w, H / world.h) * 0.94;
      const ox = (W - world.w * k) / 2;
      const oy = (H - world.h * k) / 2;
      m.clearRect(0, 0, W, H);
      m.strokeStyle = 'rgba(120,160,255,.35)';
      m.strokeRect(ox, oy, world.w * k, world.h * k);
      for (const f of eng.hubFibers) {
        m.strokeStyle = 'rgba(120,160,255,.15)';
        m.beginPath();
        m.moveTo(ox + f.ax * k, oy + f.ay * k);
        m.lineTo(ox + f.bx * k, oy + f.by * k);
        m.stroke();
      }
      for (const h of Object.values(eng.hubs)) {
        m.fillStyle = rgba(toneOf(h.v, h.has), h.hasChains ? 1 : 0.6);
        m.beginPath();
        m.arc(ox + h.x * k, oy + h.y * k, h.hasChains ? 7 : 5, 0, 7);
        m.fill();
      }
      const [x0, y0] = cam.s2w(cam.inset.l, cam.inset.t);
      const [x1, y1] = cam.s2w(cam.vw - cam.inset.r, cam.vh - cam.inset.b);
      m.strokeStyle = '#22d3ee';
      m.lineWidth = 2;
      m.strokeRect(ox + x0 * k, oy + y0 * k, (x1 - x0) * k, (y1 - y0) * k);
      mini._k = { k, ox, oy };
    }
    function render() {
      const w = cam.vw;
      const h = cam.vh;
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.fillStyle = '#03050b';
      ctx.fillRect(0, 0, w, h);
      let g = ctx.createRadialGradient(w * 0.2, 0, 0, w * 0.2, 0, Math.max(w, h) * 0.8);
      g.addColorStop(0, 'rgba(99,102,241,.2)');
      g.addColorStop(1, 'rgba(99,102,241,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      g = ctx.createRadialGradient(w, h * 0.1, 0, w, h * 0.1, Math.max(w, h) * 0.7);
      g.addColorStop(0, 'rgba(34,211,238,.13)');
      g.addColorStop(1, 'rgba(34,211,238,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      cam.apply(ctx, DPR);
      const [x0, y0] = cam.s2w(0, 0);
      const [x1, y1] = cam.s2w(w, h);
      const st = 120;
      ctx.lineWidth = 1 / cam.zoom;
      ctx.beginPath();
      for (let gx = Math.floor(x0 / st) * st; gx <= x1; gx += st) {
        ctx.moveTo(gx, y0);
        ctx.lineTo(gx, y1);
      }
      for (let gy = Math.floor(y0 / st) * st; gy <= y1; gy += st) {
        ctx.moveTo(x0, gy);
        ctx.lineTo(x1, gy);
      }
      ctx.strokeStyle = 'rgba(90,130,255,.07)';
      ctx.stroke();
      if (S.state === 'overview') {
        ctx.setLineDash([16, 14]);
        ctx.strokeStyle = 'rgba(90,130,255,.25)';
        ctx.lineWidth = 2 / cam.zoom;
        ctx.strokeRect(0, 0, world.w, world.h);
        ctx.setLineDash([]);
      }
      const ord = scene.order();
      let drawn = 0;
      let i = 0;
      for (; i < ord.length && ord[i].layer < 2; i++) {
        if (ord[i].visible && ord[i].alpha > 0.01) {
          ord[i].draw(ctx, eng);
          drawn++;
        }
      }
      pool.draw(ctx, cam);
      for (; i < ord.length; i++) {
        if (ord[i].visible && ord[i].alpha > 0.01) {
          ord[i].draw(ctx, eng);
          drawn++;
        }
      }
      for (const e of eng.effects) {
        const p = 1 - e.life;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = e.life * 0.8;
        ctx.lineWidth = 5 / Math.max(0.4, cam.zoom * 0.6);
        ctx.strokeStyle = rgba(e.color, 1);
        ctx.beginPath();
        ctx.arc(e.x, e.y, lerp(e.r, e.max, ease.outCubic(p)), 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      eng.drawn = drawn;
      drawMini();
    }
    function loop(t) {
      const dt = Math.min((t - last) / 1000, 0.1);
      last = t;
      acc += dt;
      while (acc >= STEP) {
        update(STEP);
        acc -= STEP;
      }
      render();
      fpsF++;
      fpsT += dt;
      if (fpsT >= 0.5) {
        eng.fps = fpsF / fpsT;
        fpsF = 0;
        fpsT = 0;
      }
      raf = requestAnimationFrame(loop);
    }

    // ---- 輸入 ----
    const local = (e) => {
      const r = canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    const pickAt = (sx, sy) => scene.pick(...cam.s2w(sx, sy));
    function setHover(e, ev) {
      if (hoverEnt && hoverEnt !== e) hoverEnt.hovered = false;
      hoverEnt = e;
      if (e) e.hovered = true;
      canvas.style.cursor = e ? 'pointer' : drag?.moved ? 'grabbing' : 'grab';
      host.onHover(e && ev ? { kind: e.kind, name: e.name || e.n?.name, code: e.code, v: e.v, has: e.has, note: e.note, hasChains: e.hasChains } : null, ev ? ev.clientX : 0, ev ? ev.clientY : 0);
    }
    const clampCam = () => {
      cam.x = clamp(cam.x, -200, world.w + 200);
      cam.y = clamp(cam.y, -200, world.h + 200);
    };
    function stopTweens() {
      tw.cancel(cam);
      tw.cancel(cam.inset);
    }
    function onClick(e) {
      if (!e) {
        if (S.state === 'node') api.go({ state: 'chain', chain: S.chain, node: null });
        else if (S.state === 'overview' && S.sector) api.select(null);
        return;
      }
      if (e.kind === 'hub') {
        if (e.hasChains) api.go({ state: 'chain', chain: e.def.chains[0], node: null, sector: e.name });
        else api.select(e.name);
      } else if (e.kind === 'node') {
        api.go(S.node === e.id ? { state: 'chain', chain: S.chain, node: null } : { state: 'node', chain: S.chain, node: e.id });
      }
    }
    const onDown = (e) => {
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch (_) {
        // 非活動指標（測試用的合成事件）沒有擷取需求，略過
      }
      const [x, y] = local(e);
      drag = { sx: x, sy: y, cx: cam.x, cy: cam.y, moved: false };
    };
    const onMove = (e) => {
      const [x, y] = local(e);
      if (drag) {
        const dx = x - drag.sx;
        const dy = y - drag.sy;
        if (!drag.moved && Math.hypot(dx, dy) > 5) {
          drag.moved = true;
          stopTweens();
          setHover(null);
        }
        if (drag.moved) {
          cam.x = drag.cx - dx / cam.zoom;
          cam.y = drag.cy - dy / cam.zoom;
          clampCam();
        }
      } else {
        setHover(pickAt(x, y), e);
      }
    };
    const onUp = (e) => {
      const d = drag;
      drag = null;
      canvas.style.cursor = 'grab';
      if (d && !d.moved) {
        const [x, y] = local(e);
        onClick(pickAt(x, y));
      }
    };
    const onLeave = () => {
      if (!drag) setHover(null);
    };
    const onWheel = (e) => {
      e.preventDefault();
      const [x, y] = local(e);
      stopTweens();
      cam.zoomAt(x, y, Math.exp(-e.deltaY * 0.0015));
      clampCam();
      setHover(null);
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    // ---- 對外介面 ----
    const api = {
      eng,
      setMap(map) {
        eng.map = map;
        const sig = JSON.stringify([map.columns, map.hubs.map((h) => [h.name, h.col, h.order]), map.links, map.chains.map((c) => [c.id, c.sector, c.stages, c.nodes.map((n) => [n.id, n.stage, n.stocks.length]), c.edges])]);
        if (sig === eng.sig) {
          for (const h of map.hubs) if (eng.hubs[h.name]) eng.hubs[h.name].def = h; // 結構沒變：只更新資料，不重建場景
          return;
        }
        eng.sig = sig;
        const keep = { ...S };
        build(map);
        const valid = keep.chain && eng.chains[keep.chain] && (keep.state !== 'node' || eng.chains[keep.chain].nodeEnts[keep.node]);
        show(valid ? keep : { state: 'overview', chain: null, node: null, sector: null }, true);
      },
      go(next, instant) {
        if (!eng.map) return;
        if (next.state !== 'overview' && !eng.chains[next.chain]) return;
        const base = { state: next.state, chain: next.state === 'overview' ? null : next.chain, node: next.state === 'node' ? next.node : null };
        const sector = next.state === 'overview' ? next.sector ?? null : hubOfChain(next.chain).name;
        show({ ...base, sector }, instant);
      },
      select(name) {
        S.sector = name;
        moveCamera(0.5);
        emit();
      },
      back() {
        if (S.state === 'node') api.go({ state: 'chain', chain: S.chain });
        else if (S.state === 'chain') api.go({ state: 'overview', sector: S.sector });
        else if (S.sector) api.select(null);
      },
      refit() {
        if (eng.map) moveCamera(0.5);
      },
      resize(w, h) {
        DPR = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.round(w * DPR);
        canvas.height = Math.round(h * DPR);
        cam.vw = w;
        cam.vh = h;
        if (eng.map) moveCamera(0, true);
      },
      // 回放時：漲跌超標的環節（或全景的站點）放出衝擊波
      burst(threshold = 1.6) {
        if (host.reduced) return;
        if (S.state === 'overview') {
          for (const h of Object.values(eng.hubs)) if (h.has && Math.abs(h.v) >= threshold) eng.effects.push({ x: h.x, y: h.y, r: h.r, max: 260, life: 1, color: toneOf(h.v, true) });
        } else {
          for (const n of Object.values(eng.chains[S.chain].nodeEnts)) if (n.has && Math.abs(n.v) >= threshold) eng.effects.push({ x: n.x, y: n.y, r: 90, max: 330, life: 1, color: toneOf(n.v, true) });
        }
      },
      setAnim(on) {
        eng.anim = on && !host.reduced;
      },
      key(e) {
        const pan = 90 / cam.zoom;
        if (e.key === 'Escape') api.back();
        else if (e.key === 'ArrowLeft') cam.x -= pan;
        else if (e.key === 'ArrowRight') cam.x += pan;
        else if (e.key === 'ArrowUp') cam.y -= pan;
        else if (e.key === 'ArrowDown') cam.y += pan;
        else if (e.key === '+' || e.key === '=') cam.zoomAt(cam.vw / 2, cam.vh / 2, 1.15);
        else if (e.key === '-') cam.zoomAt(cam.vw / 2, cam.vh / 2, 1 / 1.15);
        else return false;
        stopTweens();
        clampCam();
        return true;
      },
      minimapClick(e) {
        const mini = host.minimap;
        if (!mini?._k) return;
        const r = mini.getBoundingClientRect();
        const { k, ox, oy } = mini._k;
        const mx = ((e.clientX - r.left) / r.width) * mini.width;
        const my = ((e.clientY - r.top) / r.height) * mini.height;
        stopTweens();
        tw.to(cam, { x: (mx - ox) / k, y: (my - oy) / k }, 0.5);
      },
      stats() {
        return { fps: eng.fps, ticks: eng.ticks, entities: scene.list.length, drawn: eng.drawn, particles: pool.active, particlesMax: pool.p.length, tweens: tw.list.length, camX: cam.x, camY: cam.y, zoom: cam.zoom, state: S.state, chain: S.chain, node: S.node, w: canvas.width, h: canvas.height, dpr: DPR };
      },
      start() {
        last = performance.now();
        raf = requestAnimationFrame(loop);
      },
      // 測試用：不靠 requestAnimationFrame，手動推進固定步長更新
      step(n = 1) {
        for (let i = 0; i < n; i++) update(STEP);
        render();
      },
      destroy() {
        cancelAnimationFrame(raf);
        canvas.removeEventListener('pointerdown', onDown);
        canvas.removeEventListener('pointermove', onMove);
        canvas.removeEventListener('pointerup', onUp);
        canvas.removeEventListener('pointerleave', onLeave);
        canvas.removeEventListener('wheel', onWheel);
      },
    };
    return api;
  }

  window.TA = Object.assign(window.TA || {}, { ChainEngine: { create } });
})();
