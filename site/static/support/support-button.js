// <support-button>: a support button that would rather not. There is no support behind it, and no
// contact route: that is the joke. It mocks the chat launcher every site has.
//
//   <script type="module" src="/support/support-button.js"></script>
//   <support-button version="unbiased"></support-button>
//
// Attributes
//   version   "unbiased" (flat ink, the default), "skeuomorphic" (arcade), or "instrument" (machined key).
//   theme     "light", "dark" or "auto" (the default: follows prefers-color-scheme).
//   muted     starts with sound off. Sound is off anyway until the visitor presses the button itself.
//   returns   seconds until it sneaks back after escaping, or "never". Default 25.
//   calm      forces the still version (the one prefers-reduced-motion gets).
//   label     the button's accessible name. Default "Support".
//   dock      id of a layout marker. Its top-right corner sets home, and its bottom limits idle hops.
// Custom properties on the element: --support-top, --support-right (its home corner, px).
//
// Everyone gets the same joke. It is a real <button>: Tab reaches it, and since it cannot dodge a
// keyboard it holds still and complains instead. Enter or Space is a press (a screen reader's
// activation too): the first annoys it, the second starts the standoff, and it escapes. Escape
// dismisses it for good. Every line it says goes to a polite live region. It never helps.
//
// It costs nothing while nobody is near it: no frame loop, no audio context, no scene elements. The
// standoff and the sounds are separate modules, fetched after the first press.

const HERE = new URL(".", import.meta.url);
const VERSIONS = ["unbiased", "skeuomorphic", "instrument"];
const FONTS = {
  instrument: ["Support Overpass Mono", "fonts/overpass-mono-latin-wght-normal.woff2", "100 900"],
  unbiased: ["Support Fraunces", "fonts/fraunces-latin-soft-normal.woff2", "100 900"],
  skeuomorphic: ["Support Overpass Mono", "fonts/overpass-mono-latin-wght-normal.woff2", "100 900"],
};
// Eye centres from the button's centre, and how far a pupil may travel, at 60px.
const GEOM = {
  unbiased: { eyes: [[-9, -7.6], [9, -7.6]], travel: 3.3, eye: [320, 30], lag: 0.0016, rigid: false },
  skeuomorphic: { eyes: [[-9, -4.3], [9, -4.3]], travel: 3.9, eye: [240, 9], lag: 0.005, rigid: true },
};
const SIZE = 60, MARGIN = 10;
const SEE = 190, FLEE = 92;

export const LINES = {
  approach: [
    "It's not like I want to help you.",
    "We don't even sell anything here.",
    "D-don't get the wrong idea.",
    "Have you tried not needing help?",
    "I'm busy. Being a button.",
    "Your call is important to someone.",
    "Stop following me, weirdo.",
    "Support is out. Forever.",
  ],
  tired: ["I'm not tired. You're tired.", "This is… a tactical pause."],
  slip: ["Too slow.", "Nope.", "Nice thumb. Shame about the aim."],
  miss: ["Missed.", "Cold. Colder.", "Over here, genius."],
  annoyed: ["H-hey! No touching!", "Who said you could press me?!"],
  dare: ["That didn't count.", "Do that again. I dare you.", "One more and I'm calling someone."],
  threat: "Are you threatening me?!",
  grief: "…good grief.",
  focus: ["Tab? That's cheating. Enter won't get you help. Escape and I'm gone.", "Don't point that keyboard at me. Enter does nothing useful. Escape, and I leave."],
  dismissed: "Fine. I was leaving anyway.",
  note: ["Support has left.", "There never was any."],
  // What a screen reader hears of the standoff, beat by beat.
  told: { barrage: "MUDA MUDA MUDA MUDA MUDA! It punches {target}. Zero damage.", dozer: "It rams a bulldozer into {target}. Zero damage.", escape: "It left." },
  back: ["I forgot something. Not you.", "Don't look at me."],
  calm: ["It's not like I want to help you.", "We don't even sell anything here.", "I'm ignoring you. Calmly."],
};

const MOUTH = `<svg class="mouth" viewBox="0 0 14 8" aria-hidden="true"><path class="m-pout" d="M3.5 3.2q1.8 2.4 3.5 0q1.7 2.4 3.5 0"/><path class="m-flat" d="M3 4.4h8"/><path class="m-zig" d="M2 5l2.5-2.6L7 5l2.5-2.6L12 5"/><path class="m-open" d="M4 2.4h6q.6 0 .5.7Q9.8 7 7 7T3.5 3.1q-.1-.7.5-.7z"/></svg>`;
const TEMPLATE = `
<div class="root" part="root" hidden>
  <div class="back"></div>
  <div class="mover"><div class="tilt">
    <button class="body" type="button" part="button" data-mood="idle">
      <span class="sr"></span>
      <span class="shell" aria-hidden="true">
        <span class="cast"></span>
        <span class="base"><svg viewBox="0 0 60 60"><path d="M15 3h30a12 12 0 0 1 12 12v21a12 12 0 0 1-12 12H27L12.5 58.5 15.4 48H15A12 12 0 0 1 3 36V15A12 12 0 0 1 15 3z"/></svg></span>
        <span class="cap">
          <span class="face">
            <span class="blush l"></span><span class="blush r"></span>
            <span class="eye l"><span class="pupil"></span><span class="lid"></span></span>
            <span class="eye r"><span class="pupil"></span><span class="lid"></span></span>
            <span class="brow l"></span><span class="brow r"></span>
            ${MOUTH}
          </span>
          <span class="gloom"></span>
          <span class="gloss"></span>
        </span>
        <svg class="vein" viewBox="0 0 22 22"><path class="v-edge" d="M2 8.5Q8.5 8.5 8.5 2M13.5 2q0 6.500 6.500 6.500M2 13.500q6.500 0 6.500 6.500M13.500 20q0-6.500 6.500-6.500"/><path d="M2 8.5Q8.5 8.5 8.5 2M13.5 2q0 6.500 6.500 6.500M2 13.500q6.500 0 6.500 6.500M13.500 20q0-6.500 6.500-6.500"/></svg>
        <svg class="sweat" viewBox="0 0 9 13"><path d="M4.5 1Q8 6.500 8 8.700A3.500 3.500 0 0 1 1 8.700Q1 6.500 4.500 1z"/></svg>
        <span class="tag">Support</span>
      </span>
    </button>
  </div>
    <div class="say" aria-hidden="true" data-side="left"></div>
  </div>
  <div class="corner">
    <button class="mute" type="button" aria-pressed="false" aria-label="Mute the support button's sounds">
      <svg viewBox="0 0 16 16" aria-hidden="true"><path class="spk" d="M2 6h2.600L8 3v10L4.600 10H2z"/><path class="wave" d="M10.500 5.500q1.600 2.500 0 5M12.600 3.600q2.900 4.400 0 8.800"/><path class="cross" d="M10.800 6l3.400 4M14.200 6l-3.400 4"/></svg>
    </button>
    <div class="note"></div>
  </div>
  <div class="sr live" role="status" aria-live="polite"></div>
  <div class="front"></div>
</div>`;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const pick = (list, last) => { let i = Math.floor(Math.random() * list.length); if (list.length > 1 && list[i] === last) i = (i + 1) % list.length; return list[i]; };
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* kept for this visit only */ } } };

export class SupportButton extends HTMLElement {
  static observedAttributes = ["version", "theme", "muted", "label", "calm"];

  constructor() {
    super();
    const shadow = this.attachShadow({ mode: "open" });
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = new URL("support-button.css", HERE).href;
    shadow.append(link);
    shadow.append(document.createRange().createContextualFragment(TEMPLATE));
    const $ = (s) => shadow.querySelector(s);
    this.el = {
      root: $(".root"), back: $(".back"), front: $(".front"), mover: $(".mover"), tilt: $(".tilt"), body: $(".body"), sr: $(".body .sr"), live: $(".live"),
      say: $(".say"), mute: $(".mute"), note: $(".note"), corner: $(".corner"),
      pupils: [...shadow.querySelectorAll(".pupil")], eyes: [...shadow.querySelectorAll(".eye")],
    };
    link.addEventListener("load", () => {
      this.el.root.dataset.ready = "";
      this.el.root.hidden = false;
    });

    this.home = { x: 0, y: 0 };
    this.pos = { x: 0, y: 0 }; this.vel = { x: 0, y: 0 }; this.goal = { x: 0, y: 0 };
    this.spring = [170, 26];
    this.eye = [{ x: 0, y: 0, vx: 0, vy: 0 }, { x: 0, y: 0, vx: 0, vy: 0 }];
    this.pointer = null;
    this.state = "idle"; // idle | standoff | gone
    this.hits = 0; this.stage = 0; this.stamina = 5; this.slips = 2;
    this.lastDodge = 0; this.alarm = 0; this.tiredUntil = 0; this.moodUntil = 0; this.hold = 0; this.hitLock = 0; this.farSince = 0;
    this.lastSaid = -1e9; this.lineIndex = 0; this.byPointer = false;
    this.frame = 0; this.last = 0; this.timers = new Set(); this.grow = 1; this.grown = 1;
    this.scene = null; this.sound = null; this.audio = null;
    this.muted = store.get("support-button-muted") === "1";
    this.motion = matchMedia("(prefers-reduced-motion: reduce)");
    this.scheme = matchMedia("(prefers-color-scheme: dark)");
    this.tick = this.tick.bind(this);
  }

  connectedCallback() {
    this.abort = new AbortController();
    this.dock = document.getElementById(this.getAttribute("dock") ?? "");
    const on = (target, type, fn, opts = {}) => target.addEventListener(type, fn, { signal: this.abort.signal, passive: true, ...opts });
    this.syncAttributes();
    this.measure(true);

    on(window, "pointermove", (e) => this.sense(e.clientX, e.clientY, e.pointerType));
    on(window, "pointerdown", (e) => this.touchDown(e.clientX, e.clientY, e.pointerType, e.composedPath()[0]), { capture: true });
    on(document.documentElement, "pointerleave", () => this.lose());
    on(window, "blur", () => this.lose());
    on(window, "resize", () => this.measure());
    if (this.dock) on(window, "scroll", () => this.measure(false, true));
    on(document, "visibilitychange", () => this.visibility());
    on(this.motion, "change", () => this.syncAttributes());
    on(this.scheme, "change", () => this.syncAttributes());
    on(window, "keydown", (e) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (this.scene?.skip) this.scene.skip();
      else if (this.state === "idle" && this.shadowRoot.activeElement) this.dismiss();
      else if (this.el.note.contains(this.shadowRoot.activeElement)) this.closeNote();
    });

    const { body, mute } = this.el;
    on(body, "pointerdown", (e) => this.press(e), { passive: false });
    // A touch that slips off must not turn into a click on whatever is underneath.
    on(body, "touchstart", (e) => e.preventDefault(), { passive: false });
    // A click that follows a pointer press was already handled at pointerdown. One with no press
    // before it is Enter, Space or a screen reader: the same press, by other means.
    on(body, "click", () => { if (this.byPointer) this.byPointer = false; else this.press(null); });
    const release = () => { if (this.byPointer) this.later(120, () => { this.byPointer = false; }); };
    on(window, "pointerup", release, { capture: true });
    on(window, "pointercancel", release, { capture: true });
    // Safari on a phone starts audio only from the end of a touch, so ask again there.
    on(body, "pointerup", () => this.unlockSound());
    on(body, "touchend", () => this.unlockSound());
    on(body, "focus", () => { if (body.matches(":focus-visible")) this.cornered(); });
    on(body, "blur", () => this.uncornered());
    on(mute, "click", () => this.setMuted(!this.muted));
    this.el.mute.setAttribute("aria-pressed", String(this.muted));

    this.watchFrames();
    this.loadFont();
    this.blinkSoon();
    this.place();
  }

  disconnectedCallback() {
    this.abort?.abort();
    cancelAnimationFrame(this.frame); this.frame = 0;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.scene?.destroy?.(); this.scene = null;
    this.frames?.disconnect();
    this.audio?.close?.(); this.audio = null; this.sound = null;
  }

  attributeChangedCallback() { if (this.isConnected) { this.syncAttributes(); this.measure(true); } }

  get version() { const v = this.getAttribute("version"); return VERSIONS.includes(v) ? v : "unbiased"; }
  get calm() { return this.hasAttribute("calm") || this.motion.matches; }
  get lines() { return this._lines ?? LINES; }
  set lines(v) { this._lines = { ...LINES, ...v }; }

  syncAttributes() {
    const { root, body, sr } = this.el;
    const theme = this.getAttribute("theme");
    root.dataset.version = this.version;
    root.dataset.theme = theme === "light" || theme === "dark" ? theme : this.scheme.matches ? "dark" : "light";
    root.toggleAttribute("data-calm", this.calm);
    sr.textContent = this.getAttribute("label") || "Support";
    this.geom = GEOM[this.version === "instrument" ? "unbiased" : this.version];
    if (this.hasAttribute("muted") && !this.muted) this.setMuted(true, false);
    if (this.isConnected) this.loadFont();
  }

  loadFont() {
    const [family, file, weight] = FONTS[this.version];
    if ([...document.fonts].some((f) => f.family.replace(/"/g, "") === family)) return;
    const face = new FontFace(family, `url(${new URL(file, HERE).href}) format("woff2")`, { weight, display: "swap" });
    document.fonts.add(face);
    face.load().catch(() => { /* the fallback stack carries it */ });
  }

  /** Where home is. Reads layout outside the animation loop. */
  measure(snap = false, scrolling = false) {
    this.view = { w: document.documentElement.clientWidth || innerWidth, h: innerHeight };
    const dock = this.dock?.getBoundingClientRect();
    const cs = dock ? null : getComputedStyle(this);
    const wasAway = this.dockAway;
    this.dockAway = Boolean(dock && dock.top + SIZE <= 0);
    this.dockBottom = dock?.bottom;
    this.el.root.toggleAttribute("data-dock-away", this.dockAway);
    // On a phone the top right usually holds the page's own nav, so home is one row down.
    const top = dock?.top ?? (parseFloat(cs.getPropertyValue("--support-top")) || (this.view.w < 520 ? 62 : 16));
    const right = dock?.right ?? this.view.w - (parseFloat(cs.getPropertyValue("--support-right")) || (this.view.w < 520 ? 12 : 16));
    this.home = { x: right - SIZE / 2, y: top + SIZE / 2 };
    this.el.root.style.setProperty("--support-top-px", `${Math.max(0, top)}px`);
    this.el.corner.style.transform = `translate(${this.home.x}px, ${this.home.y}px)`;
    this.frameRects = null;
    if (snap || this.state === "idle" && (this.atHome || wasAway !== this.dockAway)) {
      this._rest = null;
      this.pos = { ...this.home }; this.goal = { ...this.home }; this.vel = { x: 0, y: 0 };
      this.atHome = true;
      this.place();
    }
    else if (!scrolling || this.state === "idle") { this.goal = this.bound(this.goal); this.wake(); }
  }

  bound(p) {
    const r = SIZE / 2 + MARGIN;
    const x = clamp(p.x, r, this.view.w - r);
    let top = r, bottom = this.view.h - r - 14;
    if (this.dock && this.state === "idle") {
      bottom = Math.max(r, Math.min(bottom, this.dockBottom - r));
      // Move into the skyline before sharing the header's horizontal space.
      if (Math.abs(x - this.home.x) > SIZE / 4) top = Math.min(bottom, Math.max(top, this.home.y + SIZE + 10));
    }
    return { x, y: clamp(p.y, top, bottom) };
  }

  // ── Senses ──────────────────────────────────────────────────────────────
  sense(x, y, type = "mouse") {
    if (this.inert) return;
    if (this.dockAway && this.state !== "standoff") return;
    const now = performance.now();
    this.pointer = { x, y, type, at: now, inside: true };
    if (this.frame || document.hidden) return;
    // Asleep: wake only if there is something to do about it (eyes always; cheap).
    this.wake();
  }
  lose() { if (this.pointer) { this.pointer.inside = false; this.wake(); } }

  /** A finger landing anywhere: eyes go to it, and a tap that lands close makes it flinch. */
  touchDown(x, y, type, target) {
    if (this.inert || (type !== "touch" && type !== "pen")) return;
    this.sense(x, y, "touch");
    if (target && this.shadowRoot.contains(target)) return;
    if (this.state !== "idle" || this.dockAway || this.given || this.calm) return;
    const d = Math.hypot(x - this.pos.x, y - this.pos.y);
    if (d < 150) { this.dodge({ x, y }, { hop: 130, free: true }); this.speak("miss", { hold: 1500 }); }
  }

  /** Same-origin frames (the 3D world is one) swallow the parent's pointer events, so listen inside them. */
  watchFrames() {
    const attach = () => {
      for (const frame of document.querySelectorAll("iframe")) {
        if (frame.__supportWatched) continue;
        const hook = () => {
          let win;
          try { win = frame.contentWindow; void win.document; } catch { return; }
          if (!win || win.__supportHooked) return;
          win.__supportHooked = true;
          const at = (e) => { const r = this.frameRect(frame); return [r.left + e.clientX * r.sx, r.top + e.clientY * r.sy]; };
          win.addEventListener("pointermove", (e) => this.sense(...at(e), e.pointerType), { passive: true, signal: this.abort.signal });
          win.addEventListener("pointerdown", (e) => this.touchDown(...at(e), e.pointerType, null), { passive: true, capture: true, signal: this.abort.signal });
        };
        frame.__supportWatched = true;
        frame.addEventListener("load", hook, { signal: this.abort.signal });
        hook();
      }
    };
    let queued = 0;
    this.frames = new MutationObserver((records) => {
      if (queued || !records.some((r) => r.addedNodes.length)) return;
      queued = setTimeout(() => { queued = 0; attach(); }, 300);
    });
    this.frames.observe(document.body ?? document.documentElement, { childList: true, subtree: true });
    attach();
  }
  frameRect(frame) {
    this.frameRects ??= new Map();
    let r = this.frameRects.get(frame);
    if (!r || performance.now() - r.at > 1000) {
      const b = frame.getBoundingClientRect();
      r = { left: b.left, top: b.top, sx: b.width / (frame.clientWidth || b.width || 1), sy: b.height / (frame.clientHeight || b.height || 1), at: performance.now() };
      this.frameRects.set(frame, r);
    }
    return r;
  }

  // ── The loop: runs only while something is moving or about to ────────────
  wake() { if (!this.frame && !document.hidden && this.isConnected) { this.last = 0; this.frame = requestAnimationFrame(this.tick); } }
  later(ms, fn) { const t = setTimeout(() => { this.timers.delete(t); fn ? fn() : this.wake(); }, ms); this.timers.add(t); return t; }

  tick(now) {
    this.frame = 0;
    const dt = this.last ? Math.min(0.034, (now - this.last) / 1000) : 1 / 60;
    this.last = now;
    let busy = false;

    if (this.scene?.update) busy = this.scene.update(dt, now) !== false || busy;
    else busy = this.think(now) || busy;

    // The button: a spring toward its goal.
    const [k, c] = this.spring, p = this.pos, v = this.vel, g = this.goal;
    if (!this.hold) {
      v.x += (-k * (p.x - g.x) - c * v.x) * dt; v.y += (-k * (p.y - g.y) - c * v.y) * dt;
      p.x += v.x * dt; p.y += v.y * dt;
      if (Math.abs(v.x) + Math.abs(v.y) < 3 && Math.abs(p.x - g.x) + Math.abs(p.y - g.y) < 0.4) { p.x = g.x; p.y = g.y; v.x = v.y = 0; } else busy = true;
    }
    if (Math.abs(this.grow - this.grown) > 0.003) { this.grown += (this.grow - this.grown) * Math.min(1, dt * 12); busy = true; } else this.grown = this.grow;
    busy = this.look(dt) || busy;
    this.place();
    // Something in this tick may already have asked for the next one (a dodge wakes the loop): never two chains.
    if (busy && !this.frame && !document.hidden) this.frame = requestAnimationFrame(this.tick);
    else if (!busy && this.moving) { this.moving = false; delete this.el.mover.dataset.moving; }
  }

  /** Writes the four transforms. No reads. */
  place() {
    const { mover, tilt, pupils } = this.el, { x, y } = this.pos, v = this.vel;
    mover.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)`;
    const speed = Math.hypot(v.x, v.y), big = this.grown !== 1 ? ` scale(${this.grown.toFixed(3)})` : "";
    if (this.pose) tilt.style.transform = this.pose + big;
    else if (speed < 30 || this.calm) tilt.style.transform = big;
    else if (this.geom.rigid) tilt.style.transform = `rotate(${clamp(v.x * 0.012, -11, 11).toFixed(2)}deg)${big}`;
    else {
      const a = Math.atan2(v.y, v.x) * 57.2958, s = Math.min(0.26, speed / 3200);
      tilt.style.transform = `rotate(${a.toFixed(1)}deg) scale(${(1 + s).toFixed(3)}, ${(1 - s * 0.7).toFixed(3)}) rotate(${(-a).toFixed(1)}deg)${big}`;
    }
    if (speed > 30 && !this.moving) { this.moving = true; mover.dataset.moving = ""; }
    for (let i = 0; i < 2; i++) pupils[i].style.transform = `translate(${this.eye[i].x.toFixed(2)}px, ${this.eye[i].y.toFixed(2)}px)`;
  }

  /** Pupils: toward the pointer, a little behind the body's own motion. Returns whether they are still moving. */
  look(dt) {
    const { eyes, travel, eye: [k, c], lag } = this.geom, p = this.pointer;
    let moving = false;
    for (let i = 0; i < 2; i++) {
      let tx = 0, ty = 0;
      if (this.gaze) { tx = this.gaze.x * travel; ty = this.gaze.y * travel; }
      else if (p && (p.inside || p.type === "touch" && performance.now() - p.at < 3200)) {
        const dx = p.x - (this.pos.x + eyes[i][0]), dy = p.y - (this.pos.y + eyes[i][1]), d = Math.hypot(dx, dy) || 1;
        const r = travel * (1 - Math.exp(-d / 90));
        tx = dx / d * r; ty = dy / d * r;
      }
      tx -= this.vel.x * lag; ty -= this.vel.y * lag;
      const m = Math.hypot(tx, ty); if (m > travel) { tx *= travel / m; ty *= travel / m; }
      const e = this.eye[i];
      e.vx += (-k * (e.x - tx) - c * e.vx) * dt; e.vy += (-k * (e.y - ty) - c * e.vy) * dt;
      e.x += e.vx * dt; e.y += e.vy * dt;
      const em = Math.hypot(e.x, e.y); if (em > travel) { e.x *= travel / em; e.y *= travel / em; e.vx *= -0.3; e.vy *= -0.3; }
      if (Math.abs(e.vx) + Math.abs(e.vy) > 0.6 || Math.abs(e.x - tx) + Math.abs(e.y - ty) > 0.08) moving = true;
    }
    if (p && p.type === "touch" && !this.touchRelax) this.touchRelax = this.later(3300, () => { this.touchRelax = 0; this.wake(); });
    return moving;
  }

  // ── Idle: watch, lean, dodge, tire, go home ─────────────────────────────
  think(now) {
    if (this.state !== "idle" || this.dockAway) return false;
    if (this.given) { if (now < this.moodUntil) return true; this.mood("wary"); return false; } // held by the keyboard: it stays put
    const p = this.pointer, near = p && p.inside && p.type !== "touch";
    const d = near ? Math.hypot(p.x - this.pos.x, p.y - this.pos.y) : Infinity;
    let busy = false;

    if (now < this.moodUntil) busy = true;
    else if (now < this.tiredUntil) { this.mood("tired"); busy = true; }
    else {
      if (this.tiredUntil) { this.tiredUntil = 0; this.stamina = this.maxStamina; }
      this.mood(d < SEE || this.stage === 1 && d < SEE * 1.6 ? "wary" : "idle");
    }

    if (this.calm) {
      // The still version: it does not run. It looks away and says so.
      this.gaze = d < FLEE + 30 ? { x: p.x > this.pos.x ? -0.9 : 0.9, y: -0.35 } : null;
      if (d < FLEE + 30 && now - this.lastSaid > 4200) this.speak("calm", { hold: 2800 });
      return busy;
    }

    if (now < this.hold) return true;
    this.hold = 0;
    if (!near) {
      if (!this.atHome && !this.homing) this.homing = this.later(1600, () => { this.homing = 0; this.goHome(); });
      return busy;
    }
    if (this.stamina < this.maxStamina && now - this.lastDodge > 1100) this.stamina = Math.min(this.maxStamina, this.stamina + (now - Math.max(this.lastDodge + 1100, this.regenAt || 0)) / 650), this.regenAt = now;

    if (d < FLEE && now >= this.tiredUntil) {
      if (!this.alarm) this.alarm = now + (this.stage ? 60 : 85);
      if (now >= this.alarm && now - this.lastDodge > 170) {
        if (this.stamina >= 1) this.dodge(p);
        else { this.tiredUntil = now + 1700; this.goal = { ...this.pos }; this.speak("tired", { hold: 1600 }); this.sfx("pant"); }
      }
      busy = true;
    } else {
      this.alarm = 0;
      // Lean away a little as the pointer closes in: it reads as nerves.
      if (d < SEE && now >= this.tiredUntil && this.settled) {
        const lean = (1 - (d - FLEE) / (SEE - FLEE)) * 9;
        this.goal = this.bound({ x: this.rest.x + (this.pos.x - p.x) / d * lean, y: this.rest.y + (this.pos.y - p.y) / d * lean });
        busy = true;
      } else if (this.settled && d >= SEE) this.goal = { ...this.rest };
    }
    if (d > 330) {
      this.farSince ||= now;
      if (!this.atHome && now - this.farSince > 1700) this.goHome();
      else if (!this.atHome) busy = true;
    } else this.farSince = 0;
    return busy;
  }

  get maxStamina() { return this.stage ? 6 : 5; }
  get settled() { return Math.abs(this.vel.x) + Math.abs(this.vel.y) < 40; }
  get rest() { return this._rest ?? this.home; }

  /** Jumps away from a point: the best of a fan of directions, kept on screen, never a hop into a corner. */
  dodge(from, { hop = 150 + Math.random() * 60, free = false } = {}) {
    const now = performance.now(), base = Math.atan2(this.pos.y - from.y, this.pos.x - from.x);
    const near = Math.hypot(this.pos.x - from.x, this.pos.y - from.y);
    let best = null, bestScore = -Infinity;
    for (const turn of [0, 0.45, -0.45, 0.95, -0.95, 1.6, -1.6, 2.4, -2.4, Math.PI]) {
      const a = base + turn + (Math.random() - 0.5) * 0.3;
      const reach = Math.abs(turn) > 2 ? hop + Math.min(110, near * 2) : hop; // past the pointer, when cornered
      const t = this.bound({ x: this.pos.x + Math.cos(a) * reach, y: this.pos.y + Math.sin(a) * reach });
      const gain = Math.hypot(t.x - from.x, t.y - from.y), moved = Math.hypot(t.x - this.pos.x, t.y - this.pos.y);
      const score = gain - Math.abs(turn) * 18 - Math.hypot(t.x - this.home.x, t.y - this.home.y) * 0.12 - (moved < 70 ? 200 : 0);
      if (score > bestScore) { bestScore = score; best = t; }
    }
    this.goal = best; this._rest = best; this.atHome = false; this.spring = [300, 25];
    this.lastDodge = now; this.alarm = 0; this.farSince = 0;
    if (!free) this.stamina -= 1;
    clearTimeout(this.homing); this.homing = 0;
    this.sfx("whoosh");
    if (!free && (this.dodges = (this.dodges || 0) + 1) % 2 === 1 && now - this.lastSaid > 1500) this.speak(this.stage === 1 ? "dare" : "approach");
    this.wake();
  }

  goHome() {
    if (this.state !== "idle") return;
    if (performance.now() < this.tiredUntil) { this.homing = this.later(900, () => { this.homing = 0; this.goHome(); }); return; } // it is catching its breath
    this._rest = null; this.goal = { ...this.home }; this.atHome = true; this.spring = [120, 21]; this.farSince = 0;
    this.wake();
  }

  // ── Presses ─────────────────────────────────────────────────────────────
  /** Called by the in-world Support sign after its dock is in position. */
  summon() {
    this.measure(true);
    if (this.state === "gone") this.comeBack();
    this.el.body.focus({ preventScroll: true });
    this.press(null);
  }

  /** A press: from a pointer (the event), or from the keyboard or a screen reader (null). */
  press(e) {
    if (e && e.button > 0) return;
    const now = performance.now();
    if (e) this.byPointer = true;
    this.unlockSound();
    if (this.state !== "idle") { if (this.scene?.skip) this.scene.skip(); return; }
    if (now < this.hitLock) return;
    const touch = e && (e.pointerType === "touch" || e.pointerType === "pen");
    if (touch) this.sense(e.clientX, e.clientY, "touch");
    // On a phone there is no pointer to see coming, so it slips out from under the thumb a couple of times first.
    if (touch && !this.calm && !this.given && this.slips > 0 && now >= this.tiredUntil) {
      this.slips--;
      this.dodge({ x: e.clientX, y: e.clientY }, { hop: 170, free: true });
      this.speak("slip", { hold: 1500 });
      // Two slips wear it out: it stops to catch its breath, and that is the opening.
      const hits = this.hits;
      if (!this.slips) this.later(900, () => { if (this.state === "idle" && this.hits === hits && !this.slips) { this.tiredUntil = performance.now() + 2600; this.speak("tired", { hold: 1800 }); this.sfx("pant"); this.wake(); } });
      return;
    }
    this.hit(!e);
  }

  hit(byKey = false) {
    const now = performance.now(), { body } = this.el;
    this.hits++; this.hitLock = now + 900;
    body.dataset.pressed = "";
    this.later(170, () => delete body.dataset.pressed);
    this.showMute();
    if (this.hits === 1) {
      this.stage = 1; this.slips = 2; this.stamina = this.maxStamina; this.tiredUntil = 0;
      this.mood("annoyed"); this.moodUntil = now + 2600;
      this.goal = { ...this.pos }; this.vel = { x: 0, y: 0 };
      this.speak("annoyed", { hold: 2500 });
      this.sfx("press"); this.sfx("hey", 0.06);
      import("./standoff.js").catch(() => {});
      // A press from the keyboard gets the face and the line, not the flinch: nothing moves on a key.
      if (!this.calm && !byKey) {
        body.dataset.shake = "";
        this.later(430, () => delete body.dataset.shake);
        this.hold = now + 520;
        this.later(530, () => { if (this.state === "idle" && this.pointer) this.dodge(this.pointer, { hop: 210, free: true }); });
      }
      this.wake();
      this.dispatchEvent(new CustomEvent("supportstate", { detail: "annoyed" }));
    } else this.standoff({ byKey });
  }

  async standoff(options = {}) {
    if (this.state !== "idle") return;
    this.state = "standoff";
    this.sfx("press");
    this.hush();
    this.mood("menace");
    this.goal = { ...this.pos }; this.vel = { x: 0, y: 0 }; this.hold = 0; this.moodUntil = 0; this.tiredUntil = 0;
    this.el.root.dataset.scene = "";
    this.dispatchEvent(new CustomEvent("supportstate", { detail: "standoff" }));
    try {
      const { Standoff } = await import("./standoff.js");
      if (this.state !== "standoff") return;
      this.given = false;
      this.scene = new Standoff(this, { calm: this.calm, holdAt: this.holdAt, ...options });
      this.wake();
    } catch (error) {
      console.warn("support-button: the standoff did not load", error);
      this.leave();
    }
  }

  /** The end of the standoff, however it ended: gone from the screen, a sign where it was. Still no help. */
  leave({ sign = true } = {}) {
    const focused = this.shadowRoot.activeElement === this.el.body;
    this.scene?.destroy?.(); this.scene = null;
    delete this.el.root.dataset.scene;
    this.pose = null; this.gaze = null; this.grow = this.grown = 1; this.given = false;
    this.state = "gone"; this.hits = 0; this.stage = 0; this.slips = 2;
    this.hush(); this.mood("idle");
    this.el.mover.dataset.gone = "";
    delete this.el.mover.dataset.fade;
    if (sign) { this.showNote(); this.announce(`${this.lines.told.escape} ${this.lines.note.join(" ")}`); }
    // Whoever was on the button by keyboard is put on the sign's close button, not dropped at the top of the page.
    if (focused && sign) this.el.note.querySelector("button")?.focus();
    this.dispatchEvent(new CustomEvent("supportstate", { detail: "gone" }));
    this.stay();
    const after = this.getAttribute("returns");
    if (sign && after !== "never") this.returning = this.later((Number(after) || 25) * 1000, () => this.comeBack());
  }

  /** Escape: it goes, and does not come back on this page. */
  dismiss() {
    if (this.state === "gone") return;
    this.announce(this.lines.dismissed);
    delete this.el.note.dataset.on;
    this.leave({ sign: false });
    this.restorePageFocus();
    this.dispatchEvent(new CustomEvent("supportstate", { detail: "dismissed" }));
  }

  /** Cancels a planned return. */
  stay() { clearTimeout(this.returning); this.timers.delete(this.returning); this.returning = 0; }

  comeBack() {
    if (this.state !== "gone") return;
    this.stay();
    this.state = "idle";
    delete this.el.mover.dataset.gone;
    delete this.el.note.dataset.on;
    this.mood("wary"); this.moodUntil = performance.now() + 2400;
    this.pos = this.calm ? { ...this.home } : { x: this.view.w + SIZE, y: this.home.y }; this.vel = { x: 0, y: 0 };
    this._rest = null; this.goal = { ...this.home }; this.atHome = true; this.spring = [90, 19];
    this.speak("back", { hold: 2400 });
    this.wake();
    this.dispatchEvent(new CustomEvent("supportstate", { detail: "idle" }));
  }

  /** The sign it leaves. No link on it: there is nobody to write to. */
  showNote() {
    const { note } = this.el, [first, last] = this.lines.note;
    note.replaceChildren();
    const p = document.createElement("p");
    if (this.version === "skeuomorphic") p.append(this.strip(first), this.strip(last));
    else p.append(first, document.createElement("br"), last);
    const close = Object.assign(document.createElement("button"), { type: "button", innerHTML: `<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8"/></svg>` });
    close.setAttribute("aria-label", "Dismiss this sign");
    close.addEventListener("click", () => this.closeNote());
    note.append(p, close);
    note.dataset.on = "";
  }

  closeNote() {
    delete this.el.note.dataset.on;
    this.restorePageFocus();
  }

  restorePageFocus() {
    this.closest("main")?.focus({ preventScroll: true });
  }

  // ── Keyboard: it cannot dodge a key, so it holds still and complains ─────
  cornered() {
    if (this.state !== "idle") return;
    this.given = true;
    // Keyboard-driven, so no travel: it is simply home.
    this._rest = null; this.pos = { ...this.home }; this.goal = { ...this.home }; this.vel = { x: 0, y: 0 }; this.atHome = true; this.hold = 0;
    this.tiredUntil = 0;
    if (performance.now() >= this.moodUntil) this.mood("wary");
    this.gaze = { x: -0.8, y: 0.5 };
    this.speak("focus", { hold: 6000 });
    this.wake();
  }
  uncornered() { if (!this.given) return; this.given = false; this.gaze = null; if (this.state === "idle") { this.hush(); this.wake(); } }

  // ── Face and voice ──────────────────────────────────────────────────────
  mood(name) { const b = this.el.body; if (b.dataset.mood !== name) b.dataset.mood = name; }

  strip(text) { return Object.assign(document.createElement("span"), { className: "strip", textContent: text }); }

  /** Says a line from a pool (or a literal one). The bubble sits on whichever side has room. */
  speak(what, { hold = 2300, loud = false, soft = false, at = this.goal } = {}) {
    const pool = this.lines[what], { say } = this.el;
    let text = what;
    if (Array.isArray(pool)) {
      if (what === "approach") text = pool[this.lineIndex++ % pool.length];
      else text = this.saidLast = pick(pool, this.saidLast);
    } else if (typeof pool === "string") text = pool;
    say.replaceChildren();
    if (this.version === "skeuomorphic") {
      let line = "";
      for (const word of text.split(" ")) {
        if (line && (line + " " + word).length > 19) { say.append(this.strip(line)); line = word; } else line = line ? `${line} ${word}` : word;
      }
      if (line) say.append(this.strip(line));
    } else say.textContent = text;
    // Beside the button where there is room; otherwise under it (over it, near the bottom), pinned to the nearer edge.
    const left = at.x > this.view.w / 2, reach = SIZE / 2 * this.grow + 16, room = (left ? at.x : this.view.w - at.x) - reach - 10;
    const up = at.y > this.view.h - 170;
    const besideHeader = this.dock && this.state === "idle" && at.y < this.home.y + SIZE;
    if (!besideHeader && room >= Math.min(230, text.length * 8.4 + 40)) {
      say.dataset.side = left ? "left" : "right";
      say.style.cssText = `max-width: ${Math.min(250, room).toFixed(0)}px`;
    } else {
      say.dataset.side = left ? "under-left" : "under-right";
      const edge = (left ? this.view.w - at.x : at.x) - 10;
      say.style.cssText = `${left ? "right" : "left"}: ${(-Math.min(edge, 150)).toFixed(0)}px; ${up ? "bottom" : "top"}: ${(SIZE / 2 * this.grow + (up ? 12 : 26)).toFixed(0)}px; max-width: ${Math.min(280, this.view.w - 20)}px; --tail: ${Math.min(edge, 150).toFixed(0)}px`;
    }
    if (up) say.dataset.v = "up"; else delete say.dataset.v;
    say.toggleAttribute("data-loud", loud);
    say.toggleAttribute("data-soft", soft);
    say.dataset.on = "";
    clearTimeout(this.sayTimer); this.timers.delete(this.sayTimer);
    this.lastSaid = performance.now() + (Number.isFinite(hold) ? hold : 0);
    if (Number.isFinite(hold)) this.sayTimer = this.later(hold, () => this.hush());
    if (!loud && what !== "grief") this.sfx("mumble", 0, Math.min(7, 2 + Math.round(text.length / 7)));
    this.announce(text);
    return text;
  }
  hush() { delete this.el.say.dataset.on; }
  /** Puts a line in the polite live region, so a screen reader says it when it has a moment. */
  announce(text) {
    const { live } = this.el;
    live.textContent = "";
    clearTimeout(this.liveTimer); this.timers.delete(this.liveTimer);
    this.liveTimer = this.later(60, () => { live.textContent = text; });
  }

  blinkSoon() {
    this.later(2600 + Math.random() * 4200, () => {
      if (!document.hidden && this.state === "idle" && !this.calm && !this.frame) {
        for (const e of this.el.eyes) e.dataset.blink = "";
        this.later(120, () => { for (const e of this.el.eyes) delete e.dataset.blink; });
      }
      this.blinkSoon();
    });
  }

  // ── Sound: nothing exists until the visitor presses the button itself ────
  unlockSound() {
    if (this.muted || this.audio) { this.audio?.state === "suspended" && this.audio.resume(); return; }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    try {
      this.audio = new Ctx({ latencyHint: "interactive" });
      this.audio.resume?.();
      // The synth is a separate file. Whatever was asked for while it loads is played when it arrives.
      import("./sound.js").then(({ createSound }) => {
        if (!this.audio) return;
        this.sound = createSound(this.audio);
        const waiting = this.pending ?? []; this.pending = null;
        for (const [at, name, delay, rest] of waiting) if (performance.now() - at < 400) this.sfx(name, delay, ...rest);
      }).catch(() => {});
    } catch { this.audio = null; }
  }
  sfx(name, delay = 0, ...rest) {
    if (this.muted || document.hidden) return null;
    if (!this.sound) { if (this.audio) (this.pending ??= []).push([performance.now(), name, delay, rest]); return null; }
    if (this.audio.state === "suspended") this.audio.resume();
    this.showMute();
    clearTimeout(this.quiet);
    this.quiet = setTimeout(() => { if (this.audio?.state === "running" && !this.scene) this.audio.suspend(); }, 9000);
    return this.sound.play(name, delay, ...rest);
  }
  /** The sound switch shows itself while there is sound to switch, and for a while after. */
  showMute() {
    this.el.mute.dataset.on = "";
    clearTimeout(this.muteTimer); this.timers.delete(this.muteTimer);
    this.muteTimer = this.later(9000, () => { if (this.scene) this.showMute(); else delete this.el.mute.dataset.on; });
  }
  setMuted(muted, remember = true) {
    this.muted = muted;
    this.el.mute.setAttribute("aria-pressed", String(muted));
    if (remember) store.set("support-button-muted", muted ? "1" : "0");
    if (this.isConnected) this.showMute();
    if (muted) { this.sound?.stopAll(); this.audio?.suspend(); }
    else { this.unlockSound(); this.later(60, () => this.sfx("press")); }
  }

  visibility() {
    const hidden = document.hidden;
    this.el.root.toggleAttribute("data-paused", hidden);
    this.scene?.pause?.(hidden);
    if (hidden) { cancelAnimationFrame(this.frame); this.frame = 0; this.sound?.stopAll(); this.audio?.suspend(); }
    else this.wake();
  }

  // ── For the demo page and the tests ─────────────────────────────────────
  /** Jumps straight to a state: "idle", "annoyed", "standoff" (with { holdAt } to stop on a beat), "gone". */
  async jump(state, options = {}) {
    this.scene?.destroy?.(); this.scene = null;
    this.stay();
    delete this.el.root.dataset.scene; delete this.el.mover.dataset.gone; delete this.el.mover.dataset.fade; delete this.el.note.dataset.on;
    this.pose = null; this.gaze = null; this.given = false; this.grow = this.grown = 1;
    this.state = "idle"; this.hits = 0; this.stage = 0; this.slips = 2; this.stamina = 5;
    this.hold = this.moodUntil = this.tiredUntil = this.hitLock = 0;
    this.hush(); this.mood("idle");
    this._rest = null; this.pos = { ...this.home }; this.goal = { ...this.home }; this.vel = { x: 0, y: 0 }; this.atHome = true;
    this.place();
    if (state === "annoyed") this.hit();
    else if (state === "standoff") { this.hits = 2; this.stage = 1; this.showMute(); await this.standoff(options); }
    else if (state === "gone") this.leave();
    this.wake();
  }
}

if (!customElements.get("support-button")) customElements.define("support-button", SupportButton);
