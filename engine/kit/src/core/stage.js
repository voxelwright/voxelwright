// The stage keeps one live voxel model per adopted element, and draws only what changed.
// At rest nothing runs: no frame loop, no timers.

import { Renderer } from './gl.js';
import { Model } from './model.js';
import { LIGHTS } from './materials.js';
import { Spring, assemble, crumble, settle, reducedMotion } from './motion.js';

export const SHEAR = [0.5, 0.5]; // screen shift per voxel of height: right, down

const IDENTITY = [0, 0, 0, 1];

export class Live {
  constructor(el, def, stage) {
    this.el = el; this.def = def; this.stage = stage;
    this.springs = {};
    this.labels = []; // [{ node, z: () => number }]
    this.state = {};
    this.visible = true;
    this.dirty = true;
    this.fxCount = 0;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'vx-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.ctx = this.canvas.getContext('2d');
    (def.canvasHost ? def.canvasHost(el) : el).prepend(this.canvas);
    el.setAttribute('data-vx-live', '');
    this.unbind = def.bind ? def.bind(this) : null;
    this.rebuild();
  }

  /** Read the element's size and theme, and build the model again. */
  rebuild() {
    const el = this.el, def = this.def;
    const cs = getComputedStyle(el);
    this.vx = parseFloat(cs.getPropertyValue('--vx')) || 4;
    this.theme = cs.getPropertyValue('--vx-theme').trim() === 'night' ? 'night' : 'day';
    const w = el.offsetWidth, h = el.offsetHeight;
    this.cssW = w; this.cssH = h;
    this.W = Math.max(1, Math.floor(w / this.vx + 0.01));
    this.H = Math.max(1, Math.floor(h / this.vx + 0.01));
    this.pad = def.pad ?? 6;
    this.faceZ = 0;
    this.model = new Model();
    this.labels.length = 0;
    def.build(this, this.model);
    this.model.bake(this.theme);
    let n = 0, glows = false;
    for (const p of this.model.parts) { n += p.count; for (let i = 0; i < p.count; i++) if (p.col[i * 4 + 3] > 0) { glows = true; break; } }
    this.capacity = n;
    this.pos = new Float32Array(n * 8);
    this.col = new Float32Array(n * 4);
    this.ao = new Uint32Array(n * 2);
    this.glows = glows;
    this.layout();
    def.pose?.(this);
    this.invalidate();
  }

  retint() {
    const cs = getComputedStyle(this.el);
    const theme = cs.getPropertyValue('--vx-theme').trim() === 'night' ? 'night' : 'day';
    if (theme === this.theme) return;
    this.theme = theme;
    this.model.tint(theme);
    this.invalidate();
  }

  layout() {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const padPx = this.pad * this.vx;
    const cw = this.cssW + padPx * 2, ch = this.cssH + padPx * 2;
    const c = this.canvas;
    this.wpx = Math.round(cw * dpr); this.hpx = Math.round(ch * dpr);
    if (c.width !== this.wpx) c.width = this.wpx;
    if (c.height !== this.hpx) c.height = this.hpx;
    c.style.width = cw + 'px'; c.style.height = ch + 'px';
    c.style.left = -padPx + 'px'; c.style.top = -padPx + 'px';
    this.s = this.vx * dpr;
    // The face that carries the label sits exactly on the element's box when at rest.
    const lift = this.faceZ;
    const remX = (this.cssW - this.W * this.vx) / 2, remY = (this.cssH - this.H * this.vx) / 2;
    this.ox = Math.round((padPx + remX - lift * SHEAR[0] * this.vx) * dpr);
    this.oy = Math.round((padPx + remY - lift * SHEAR[1] * this.vx) * dpr);
    this.bounds = [-this.pad - lift, -this.pad - lift, this.W + this.pad + lift, this.H + this.pad + lift];
  }

  spring(name, x = 0, k = 170, c = 26) {
    return (this.springs[name] ??= new Spring(x, k, c));
  }

  /** Keep a DOM node glued to a face: it shifts with the face's height above its rest height. */
  label(node, z) {
    if (node) this.labels.push({ node, z });
  }

  /** Run a per-voxel effect on one part, or all. Returns a promise that resolves when it ends. */
  play(effect, parts, opts = {}) {
    const list = parts ? [].concat(parts).map((p) => (typeof p === 'string' ? this.model.byName[p] : p)).filter(Boolean) : this.model.parts;
    const make = reducedMotion() ? (p) => settle(p, { out: effect === 'crumble' }) : effect === 'crumble' ? (p) => crumble(p, opts) : (p) => assemble(p, opts);
    let longest = 0;
    for (const p of list) { p.fx = make(p); p.hidden = false; longest = Math.max(longest, p.fx.end); }
    this.invalidate();
    return new Promise((resolve) => { (this.waiters ??= []).push({ list, resolve }); });
  }

  invalidate() {
    this.dirty = true;
    this.stage.wake(this);
  }

  /** One step of time. Returns true if this needs another frame. */
  step(dt) {
    let moving = false;
    for (const k in this.springs) if (this.springs[k].step(dt)) moving = true;
    for (const p of this.model.parts) {
      if (!p.fx) continue;
      p.fx.t += dt;
      moving = true;
    }
    if (this.def.step && this.def.step(this, dt)) moving = true;
    if (moving) this.dirty = true;
    return moving;
  }

  draw() {
    if (!this.dirty || !this.visible) return;
    this.def.pose?.(this);
    const pos = this.pos, col = this.col, ao = this.ao;
    let o = 0, n = 0;
    for (const p of this.model.parts) {
      if (p.hidden || !p.count) continue;
      const cnt = p.count;
      if (p.fx) {
        const done = p.fx.write(pos, o, p);
        if (done) {
          const kind = p.fx.kind;
          p.fx = null;
          if (kind === 'crumble') p.hidden = true;
          this.settled(p);
          if (kind === 'crumble') continue; // nothing left to draw
          this.writeRest(p, o);
        }
      } else this.writeRest(p, o);
      col.set(p.col, n * 4);
      ao.set(p.ao, n * 2);
      o += cnt * 8; n += cnt;
    }
    const ok = this.stage.renderer.draw({
      pos, col, ao, count: n, wpx: this.wpx, hpx: this.hpx, ox: this.ox, oy: this.oy, s: this.s,
      bounds: this.bounds, light: LIGHTS[this.theme], shear: SHEAR, glows: this.glows,
      soft: this.def.soft, glowRadius: this.def.glowRadius, glowStrength: this.def.glowStrength,
    }, this.ctx);
    // labels follow their faces
    const k = this.vx;
    for (const l of this.labels) {
      const dz = l.z() - this.faceZ;
      const tx = dz * SHEAR[0] * k, ty = dz * SHEAR[1] * k;
      const t = Math.abs(tx) < 0.01 && Math.abs(ty) < 0.01 ? '' : `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px)`;
      if (l.last !== t) { l.node.style.transform = t; l.last = t; }
    }
    if (ok) this.dirty = false;
  }

  writeRest(p, o) {
    const pos = this.pos, rest = p.rest, sc = p.scales;
    for (let i = 0; i < p.count; i++, o += 8) {
      pos[o] = rest[i * 3] + p.tx; pos[o + 1] = rest[i * 3 + 1] + p.ty; pos[o + 2] = rest[i * 3 + 2] + p.tz;
      pos[o + 3] = sc ? sc[i] : 1; pos[o + 4] = 0; pos[o + 5] = 0; pos[o + 6] = 0; pos[o + 7] = 1;
    }
  }

  settled(part) {
    if (!this.waiters) return;
    this.waiters = this.waiters.filter((w) => {
      if (w.list.some((p) => p.fx)) return true;
      w.resolve();
      return false;
    });
  }

  destroy() {
    this.unbind?.();
    this.canvas.remove();
    this.el.removeAttribute('data-vx-live');
    for (const l of this.labels) l.node.style.transform = '';
  }
}

export class Stage {
  constructor() {
    this.renderer = new Renderer();
    this.renderer.onrestore = () => { for (const l of this.lives.values()) l.invalidate(); };
    this.lives = new Map();
    this.awake = new Set();
    this.raf = 0;
    this.last = 0;
    this.tick = this.tick.bind(this);
    this.resize = new ResizeObserver((entries) => {
      for (const e of entries) {
        const live = this.lives.get(e.target);
        if (!live) continue;
        if (e.target.offsetWidth !== live.cssW || e.target.offsetHeight !== live.cssH) live.rebuild();
      }
    });
    this.seen = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const live = this.lives.get(e.target);
        if (!live) continue;
        live.visible = e.isIntersecting;
        if (live.visible && live.dirty) this.wake(live);
      }
    }, { rootMargin: '200px' });
    this.dpr = window.devicePixelRatio;
    addEventListener('resize', () => {
      if (window.devicePixelRatio === this.dpr) return;
      this.dpr = window.devicePixelRatio;
      for (const l of this.lives.values()) { l.layout(); l.invalidate(); }
    });
    const retint = () => { for (const l of this.lives.values()) l.retint(); };
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', retint);
    new MutationObserver(retint).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'], subtree: true });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && this.awake.size) this.schedule(); });
  }

  add(el, def) {
    if (this.lives.has(el)) return this.lives.get(el);
    const live = new Live(el, def, this);
    this.lives.set(el, live);
    this.resize.observe(el);
    this.seen.observe(el);
    return live;
  }

  remove(el) {
    const live = this.lives.get(el);
    if (!live) return;
    this.resize.unobserve(el); this.seen.unobserve(el);
    this.awake.delete(live);
    live.destroy();
    this.lives.delete(el);
  }

  wake(live) {
    this.awake.add(live);
    this.schedule();
  }

  schedule() {
    if (!this.raf && !document.hidden) this.raf = requestAnimationFrame(this.tick);
  }

  tick(now) {
    this.raf = 0;
    const dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 1 / 60;
    this.last = now;
    for (const live of this.awake) {
      const moving = live.step(dt);
      live.draw();
      if (!moving && !live.dirty) this.awake.delete(live);
      else if (!live.visible && !moving) this.awake.delete(live);
    }
    if (this.awake.size) this.schedule(); else this.last = 0;
  }
}
