// The stage keeps one live voxel model per adopted element, and draws only what changed.
// At rest nothing runs: no frame loop, no timers.

import { Model } from './model.js';
import { lookOf, lightOf } from './look.js';
import { Spring, assemble, crumble, surfaceCourses, settle, reducedMotion } from './motion.js';
import { listeners } from '../components/util.js';

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
    this.tintRevision = 0;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'vx-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    // A renderer that owns the canvases (ownsCanvas) draws straight into each part's canvas with
    // its own context, so the kit must not take one: a canvas has only one kind of context.
    // Otherwise the renderer draws elsewhere and copies the picture into this 2D context.
    this.ctx = stage.renderer.ownsCanvas ? null : this.canvas.getContext('2d');
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
    // the look it stands in, and that look's own model for this part, if it has one
    this.look = lookOf(cs);
    const other = this.look.parts[def.name];
    this.form = other ? { ...def, ...other } : def;
    const w = el.offsetWidth, h = el.offsetHeight;
    this.cssW = w; this.cssH = h;
    this.W = Math.max(1, Math.floor(w / this.vx + 0.01));
    this.H = Math.max(1, Math.floor(h / this.vx + 0.01));
    this.pad = this.form.pad ?? 6;
    this.faceZ = 0;
    this.well = null;
    const previousSurface = this.surface;
    this.stopMotion();
    this.model = new Model();
    for (const l of this.labels) { l.node.style.transform = ''; l.last = undefined; } // a label's nudge belongs to the model it was on
    this.labels.length = 0;
    this.form.build(this, this.model);
    this.model.bake(this.theme, this.look);
    let n = 0, glows = false;
    for (const p of this.model.parts) { n += p.count; for (let i = 0; i < p.count; i++) if (p.col[i * 4 + 3] > 0) { glows = true; break; } }
    this.capacity = n;
    this.pos = new Float32Array(n * 8);
    this.col = new Float32Array(n * 4);
    this.ao = new Uint32Array(n * 2);
    this.glows = glows;
    this.layout();
    this.form.pose?.(this);
    this.invalidate();
    return previousSurface;
  }

  retint() {
    const cs = getComputedStyle(this.el);
    const theme = cs.getPropertyValue('--vx-theme').trim() === 'night' ? 'night' : 'day';
    if (lookOf(cs) !== this.look) return this.rebuild(); // another look is another shape
    if (theme === this.theme) return;
    this.theme = theme;
    this.recolor();
  }

  recolor() {
    this.tintRevision++;
    this.model.tint(this.theme, this.look);
    this.glows = this.model.parts.some(p => p.col.some((channel, i) => i % 4 === 3 && channel > 0));
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
    this.base = -padPx;
    this.nudge ??= [0, 0];
    c.style.left = this.base + this.nudge[0] + 'px'; c.style.top = this.base + this.nudge[1] + 'px';
    this.stage.resnapSoon();
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
    // every part builds on one grid of bricks, so the whole thing rises as one
    let top = 1;
    for (const p of this.model.parts) for (let i = 0; i < p.count; i++) top = Math.max(top, p.rest[i * 3 + 2] + 0.5);
    const shared = { W: this.W, H: this.H, top, ...opts };
    const out = effect === 'crumble' || effect === 'lower', still = reducedMotion();
    const surface = opts.surface ?? this.form.surface;
    const prior = this.surface ?? opts.resume;
    this.clearSurface();
    // Resolve superseded runs now. Their callers can distinguish cancellation from landing.
    this.waiters = (this.waiters ?? []).filter(waiter => {
      if (!waiter.list.some(part => list.includes(part))) return true;
      waiter.resolve(false);
      return false;
    });
    for (const p of list) {
      if (surface) p.fx = surfaceCourses(p, { duration: 0.3, ...shared, out, still,
        rim: surface === 'rim', previousRelease: prior?.release, start: prior?.progress ?? (out ? 1 : 0),
        from: prior?.from ?? opts.from ?? [0, this.H] });
      else if (still) p.fx = settle(p, { out });
      else p.fx = (out ? crumble : assemble)(p, shared);
      p.hidden = false;
    }
    if (surface && list.length) {
      this.surface = list[0].fx;
      this.el.dataset.vxSurface = still ? 'still' : surface;
      this.paintSurface();
    }
    this.invalidate();
    if (!list.length) return Promise.resolve(true);
    return new Promise(resolve => this.waiters.push({ list, resolve }));
  }

  paintSurface() {
    const { progress, still, rim, release } = this.surface;
    const alpha = still ? progress : rim && release ? Math.min(1, progress * 2) : 1;
    const reveal = release ? (progress - 0.9) / 0.1 : (progress - 0.78) / 0.18;
    const ink = still || rim ? alpha : Math.max(0, Math.min(1, reveal));
    this.el.style.setProperty('--vx-surface-alpha', alpha);
    this.el.style.setProperty('--vx-surface-ink', ink);
  }

  stopMotion() {
    this.clearSurface();
    for (const part of this.model?.parts ?? []) part.fx = null;
    for (const waiter of this.waiters ?? []) waiter.resolve(false);
    this.waiters = [];
  }

  clearSurface() {
    if (!this.surface) return;
    this.surface = null;
    delete this.el.dataset.vxSurface;
    this.el.style.removeProperty('--vx-surface-alpha');
    this.el.style.removeProperty('--vx-surface-ink');
  }

  invalidate() {
    if (this.destroyed) return;
    this.dirty = true;
    this.stage.wake(this);
  }

  /** One step of time. Returns true if this needs another frame. */
  step(dt) {
    let moving = false;
    for (const spring of Object.values(this.springs)) {
      if (!spring.moving) continue;
      this.dirty = true; // draw the exact resting pose on the step which snaps to target
      if (spring.step(dt)) moving = true;
    }
    for (const p of this.model.parts) {
      if (!p.fx) continue;
      p.fx.t += dt;
      if (p.fx.t >= p.fx.end && (!this.visible || p.hidden || !p.count)) {
        // draw() skips hidden geometry, including a menu's inactive selection mark.
        if (p.fx.kind === 'crumble') p.hidden = true;
        p.fx = null;
        this.dirty = true;
        this.settled(p);
      } else moving = true;
    }
    if (this.form.step && this.form.step(this, dt)) moving = true;
    if (moving) this.dirty = true;
    return moving;
  }

  draw() {
    if (!this.dirty || !this.visible) return;
    this.form.pose?.(this);
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
          if (p.hidden) continue; // nothing left to draw
          this.writeRest(p, o);
        }
      } else this.writeRest(p, o);
      col.set(p.col, n * 4);
      ao.set(p.ao, n * 2);
      o += cnt * 8; n += cnt;
    }
    const ok = this.stage.renderer.draw({
      pos, col, ao, count: n, wpx: this.wpx, hpx: this.hpx, ox: this.ox, oy: this.oy, s: this.s,
      bounds: this.bounds, light: lightOf(this.look, this.theme), shear: SHEAR, glows: this.glows,
      soft: this.form.soft, groundSoft: this.look.groundSoft, surfaceBytes: !!this.look.finishes,
      // a part may turn its own light up and down as it is used (live.glowStrength, live.glowRadius)
      glowRadius: this.glowRadius ?? this.form.glowRadius, glowStrength: this.glowStrength ?? this.form.glowStrength,
      well: this.well, groundShadow: this.well ? 0 : 1,
    }, this.ctx ?? this.canvas);
    if (ok && this.surface) {
      this.paintSurface();
      if (this.surface.t >= this.surface.end && this.surface.kind !== 'crumble') this.clearSurface();
    }
    // labels follow their faces
    const k = this.vx;
    for (const l of this.labels) {
      const dz = l.z() - this.faceZ;
      const tx = dz * SHEAR[0] * k, ty = dz * SHEAR[1] * k;
      // plus the nudge that puts the words on whole pixels (see Stage.resnap)
      l.ax = tx + (l.nx ?? 0); l.ay = ty + (l.ny ?? 0);
      const t = Math.abs(l.ax) < 0.01 && Math.abs(l.ay) < 0.01 ? '' : `translate(${l.ax.toFixed(3)}px, ${l.ay.toFixed(3)}px)`;
      if (l.last !== t) { l.node.style.transform = t; l.last = t; }
    }
    if (ok) this.dirty = false;
  }

  writeRest(p, o) {
    const pos = this.pos, rest = p.rest, sc = p.scales;
    // The encoder turns as one solid. Rotate cube centres and their normals about the same axle.
    if (p.axle) {
      const { x, y, angle } = p.axle;
      const c = Math.cos(angle), s = Math.sin(angle);
      const qz = Math.sin(angle / 2), qw = Math.cos(angle / 2);
      for (let i = 0; i < p.count; i++, o += 8) {
        const dx = rest[i * 3] - x, dy = rest[i * 3 + 1] - y;
        pos[o] = x + c * dx - s * dy + p.tx;
        pos[o + 1] = y + s * dx + c * dy + p.ty;
        pos[o + 2] = rest[i * 3 + 2] + p.tz;
        pos[o + 3] = 1;
        pos[o + 4] = pos[o + 5] = 0;
        pos[o + 6] = qz; pos[o + 7] = qw;
      }
      return;
    }
    for (let i = 0; i < p.count; i++, o += 8) {
      pos[o] = rest[i * 3] + p.tx; pos[o + 1] = rest[i * 3 + 1] + p.ty; pos[o + 2] = rest[i * 3 + 2] + p.tz;
      pos[o + 3] = sc ? sc[i] : 1; pos[o + 4] = 0; pos[o + 5] = 0; pos[o + 6] = 0; pos[o + 7] = 1;
    }
  }

  settled(part) {
    if (!this.waiters) return;
    this.waiters = this.waiters.filter((w) => {
      if (w.list.some((p) => p.fx)) return true;
      w.resolve(true);
      return false;
    });
  }

  destroy() {
    this.destroyed = true;
    this.stopMotion();
    this.unbind?.();
    this.canvas.remove();
    this.el.removeAttribute('data-vx-live');
    this.el.removeAttribute('data-vx-cover-legends');
    for (const l of this.labels) l.node.style.transform = '';
  }
}

export class Stage {
  /**
   * renderer: anything with draw(frame, target). target is the part's 2D context, or, if the
   * renderer says ownsCanvas: true, the part's canvas element itself. It may call its onrestore
   * after losing its context or device, and every part is drawn again; or its onfail if it can
   * never draw again, and every part goes back to plain CSS.
   */
  constructor(renderer) {
    this.renderer = renderer;
    this.renderer.onrestore = () => { for (const l of this.lives.values()) l.invalidate(); };
    // The renderer calls this when it has lost its device for good. The stage's owner (index.js)
    // sets onfail and gives every part back to plain CSS, so nothing is left without a face.
    this.renderer.onfail = () => this.onfail?.();
    this.lives = new Map();
    this.bindings = new WeakMap();
    this.shadowRoots = new WeakMap();
    const detached = new Set();
    let pruning = 0;
    this.removals = new MutationObserver((records) => {
      for (const record of records) for (const node of record.removedNodes) {
        if (node.nodeType !== 1 || (node.isConnected && node.ownerDocument === document)) continue;
        for (const el of this.boundUnder(node)) detached.add(el);
      }
      if (detached.size && !pruning) pruning = setTimeout(() => {
        pruning = 0;
        for (const el of detached) if (!el.isConnected || el.ownerDocument !== document) this.remove(el);
        detached.clear();
      }, 0);
    });
    this.removals.observe(document, { childList: true, subtree: true });
    this.awake = new Set();
    this.raf = 0;
    this.last = 0;
    this.tick = this.tick.bind(this);
    this.resizing = new Map();
    this.resize = new ResizeObserver((entries) => {
      for (const e of entries) {
        const live = this.lives.get(e.target);
        if (!live) continue;
        if (e.target.offsetWidth !== live.cssW || e.target.offsetHeight !== live.cssH) this.resizing.set(live, false);
        else this.resizing.delete(live);
      }
      this.settleSizes();
    });
    this.seen = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const live = this.lives.get(e.target);
        if (!live) continue;
        live.visible = e.isIntersecting;
        if (live.visible) this.resnapSoon(); // it may have been moved since it was last looked at
        if (live.visible && live.dirty) this.wake(live);
      }
    }, { rootMargin: '200px' });
    this.dpr = window.devicePixelRatio;
    addEventListener('resize', () => {
      this.resnapSoon();
      if (window.devicePixelRatio === this.dpr) return;
      this.dpr = window.devicePixelRatio;
      for (const l of this.lives.values()) { l.layout(); l.invalidate(); }
    });
    document.fonts?.addEventListener?.('loadingdone', () => this.resnapSoon());
    // text reflowing above a part moves it without resizing it; the page's height gives that away
    if (document.body) new ResizeObserver(() => this.resnapSoon()).observe(document.body);
    const retint = () => { for (const l of this.lives.values()) l.retint(); };
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', retint);
    new MutationObserver(retint).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-vx-look', 'class'], subtree: true });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && this.awake.size) this.schedule(); });
  }

  /**
   * Put every part's canvas, and the words on it, on whole device pixels.
   * A page may leave a part on a fraction of a pixel: a gap in rem, a line of text above it, a
   * label before it in a row. Voxels and pixel lettering are sharp only on whole pixels, so each
   * canvas and each label is nudged by the fraction it is off. All reads, then all writes.
   */
  resnap() {
    this.snapping = 0;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const off = (v) => Math.round(v * dpr) / dpr - v;
    const todo = [];
    const range = document.createRange();
    for (const l of this.lives.values()) {
      if (!l.canvas.isConnected || !l.el.offsetParent && getComputedStyle(l.el).position !== 'fixed') continue;
      const c = l.canvas.getBoundingClientRect();
      // where the words themselves start, not their box: a label may be centred in a wider one
      const labels = l.labels.map((b) => { range.selectNodeContents(b.node); const r = range.getBoundingClientRect(); return [b, off(r.left - (b.ax ?? 0)), off(r.top - (b.ay ?? 0))]; });
      todo.push([l, off(c.left - l.nudge[0]), off(c.top - l.nudge[1]), labels]);
    }
    for (const [l, nx, ny, labels] of todo) {
      let moved = false;
      if (Math.abs(nx - l.nudge[0]) > 0.005 || Math.abs(ny - l.nudge[1]) > 0.005) {
        l.nudge = [nx, ny];
        l.canvas.style.left = l.base + nx + 'px'; l.canvas.style.top = l.base + ny + 'px';
      }
      for (const [b, x, y] of labels) {
        if (Math.abs(x - (b.nx ?? 0)) <= 0.005 && Math.abs(y - (b.ny ?? 0)) <= 0.005) continue;
        // Put the words there now. A part that is out of sight is not drawn, and its words would
        // otherwise wait off the pixel grid until it is scrolled to.
        const tx = (b.ax ?? 0) - (b.nx ?? 0), ty = (b.ay ?? 0) - (b.ny ?? 0);
        b.nx = x; b.ny = y; b.ax = tx + x; b.ay = ty + y;
        const t = Math.abs(b.ax) < 0.01 && Math.abs(b.ay) < 0.01 ? '' : `translate(${b.ax.toFixed(3)}px, ${b.ay.toFixed(3)}px)`;
        if (b.last !== t) { b.node.style.transform = t; b.last = t; }
        moved = true;
      }
      if (moved) l.invalidate(); // the next draw keeps them there as the face moves
    }
  }

  resnapSoon() {
    if (this.snapping) return;
    this.snapping = requestAnimationFrame(() => this.resnap());
  }

  settleSizes() {
    if (this.resizeFrame || !this.resizing.size) return;
    this.resizeFrame = requestAnimationFrame(() => {
      this.resizeFrame = 0;
      for (const [live, quiet] of this.resizing) {
        if (!quiet) { this.resizing.set(live, true); continue; }
        this.resizing.delete(live);
        if (live.el.isConnected && (live.el.offsetWidth !== live.cssW || live.el.offsetHeight !== live.cssH)) live.rebuild();
      }
      this.settleSizes();
    });
  }

  add(el, def) {
    for (let root = el.getRootNode(); root.nodeType === 11 && root.host && !this.shadowRoots.has(root.host); root = root.host.getRootNode()) {
      this.shadowRoots.set(root.host, root);
      this.removals.observe(root, { childList: true, subtree: true });
    }
    if (!def.build || (def.draws && !def.draws(el))) {
      if (!def.bind && !def.plain) return null;
      let bindings = this.bindings.get(el);
      if (!bindings) this.bindings.set(el, bindings = new Map());
      if (bindings.has(def)) return bindings.get(def);
      const binding = { el, def, stage: this, state: {} };
      bindings.set(def, binding);
      if (def.bind) binding.unbind = def.bind(binding);
      else {
        const on = listeners();
        const undo = def.plain(el, on);
        binding.unbind = () => { if (typeof undo === 'function') undo(); on.done(); };
      }
      return binding;
    }
    if (this.lives.has(el)) return this.lives.get(el);
    const live = new Live(el, def, this);
    this.lives.set(el, live);
    this.resize.observe(el, { box: 'border-box' });
    this.seen.observe(el);
    return live;
  }

  remove(el) {
    const bindings = this.bindings.get(el);
    this.bindings.delete(el);
    if (bindings) for (const binding of bindings.values()) binding.unbind?.();
    const live = this.lives.get(el);
    if (!live) return;
    this.resize.unobserve(el); this.seen.unobserve(el);
    this.awake.delete(live);
    this.resizing.delete(live);
    live.destroy();
    this.lives.delete(el);
  }

  boundUnder(root) {
    const bound = new Set(root === document ? this.lives.keys() : []);
    const visit = (tree) => {
      for (const el of [tree, ...tree.querySelectorAll('*')]) {
        if (this.lives.has(el) || this.bindings.has(el)) bound.add(el);
        const shadow = this.shadowRoots.get(el);
        if (shadow) visit(shadow);
      }
    };
    visit(root);
    return bound;
  }

  wake(live) {
    this.awake.add(live);
    this.schedule();
  }

  schedule() {
    if (this.manual) return;
    if (!this.raf && !document.hidden) this.raf = requestAnimationFrame(this.tick);
  }

  /** Step time by hand: stage.manual = true, then advance(1 / 60) per frame. For filming and tests. */
  advance(dt) {
    for (const live of [...this.awake]) {
      const moving = live.step(dt);
      live.draw();
      if (!moving && !live.dirty) this.awake.delete(live);
      else if (!live.visible && !moving) this.awake.delete(live);
    }
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
