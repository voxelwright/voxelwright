// The standoff: what happens on the second press. Fetched by support-button.js after the first.
//
// Everything here is drawn for this page: the lettering is our own paths (no font has to carry
// the katakana), the fists, the bursts and the bulldozer are our own shapes. The homage is in
// the timing and the typography.
//
// Two actors are moved by the script each frame (the button and the bulldozer), so a hit can
// stop them dead for a few frames. Everything short-lived (fists, bursts, letters, dust) is a
// Web Animations one-shot on transform and opacity, tracked so that a hidden tab or a hit-stop
// pauses the lot. The layers exist only while the scene runs.

const SVG = "http://www.w3.org/2000/svg";
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const rand = (a, b) => a + Math.random() * (b - a);
const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";
const POP = "cubic-bezier(0.34, 1.56, 0.64, 1)"; // easeOutBack, easings.net

// Lettering, each glyph in a 100-unit box: one path per brush stroke.
const GLYPHS = {
  go: { w: 114, p: ["M14 16L80 12 78 27 14 30Z", "M66 14L80 12 78 86 64 86Z", "M10 72L66 73 66 86 10 87Z", "M84 2l7-2 4 14-7 2Z", "M97-2l7-2 4 14-7 2Z"] },
  do: { w: 96, p: ["M28 6L42 4 42 94 28 96Z", "M42 34L80 52 74 66 42 50Z", "M60 6l7-2 5 14-7 2Z", "M76 2l7-2 5 14-7 2Z"] },
  n: { w: 100, p: ["M12 22L24 16 36 34 24 40Z", "M12 82Q52 80 80 22L92 30Q64 96 16 96Z"] },
  mu: { w: 100, p: ["M44 6L58 10 26 74 12 70Z", "M12 70L84 62 86 76 14 84Z", "M62 44L74 38 94 88 80 94Z"] },
  da: { w: 114, p: ["M34 6L48 10 22 48 10 42Z", "M34 18L80 14 82 27 30 31Z", "M70 16L84 14Q78 74 28 96L20 86Q62 66 70 16Z", "M34 44L44 38 62 56 54 64Z", "M84 0l7-2 5 14-7 2Z", "M98-4l7-2 5 14-7 2Z"] },
  M: { w: 84, p: ["M4 96L10 6 26 6 40 50 54 6 70 6 76 96 60 96 57 40 46 78 34 78 23 40 20 96Z"] },
  U: { w: 82, p: ["M6 6H24V66Q24 80 40 80Q56 80 56 66V6H74V68Q74 98 40 98Q6 98 6 68Z"] },
  D: { w: 82, p: ["M6 6H40Q76 6 76 51Q76 96 40 96H6ZM24 24V78H38Q58 78 58 51Q58 24 38 24Z"] },
  A: { w: 80, p: ["M2 96L30 6H50L78 96H60L55 78H25L20 96ZM30 60H50L40 26Z"] },
  "!": { w: 40, p: ["M10 4H30L26 66H14Z", "M12 78H28V96H12Z"] },
};
const WORDS = { muda: ["M", "U", "D", "A"], mudaKana: ["mu", "da"], go: ["go"], don: ["do", "n", "!"] };

const FIST = `<svg viewBox="0 0 44 38"><path class="g-fill" d="M7 7h19q14 0 14 12T26 31H7q-5 0-5-5V12q0-5 5-5z"/><path class="g-fill" d="M9 7q1-6 8-5.500t6 5.500"/><path class="g-line" d="M27 13h8M28 19h10M27 25h8"/><path class="g-shine" d="M8 10h14q1 3-2 3H8z"/></svg>`;
const SPARK = `<svg viewBox="0 0 28 28"><path d="M14 1q1.500 10 13 13q-11.500 3-13 13q-1.500-10-13-13q11.500-3 13-13z"/></svg>`;
// The bulldozer, facing right. Drawn in a 330 by 210 box; the blade's face at half height is (310, 135).
const DOZER_BODY = `<svg class="d-main" viewBox="0 0 330 210" width="330" height="210">
  <path class="d-dark" d="M65 148h168a27 27 0 0 1 0 54H65a27 27 0 0 1 0-54z"/>
  <path class="d-body" d="M118 86h130q18 0 20 17l3 47H118z"/>
  <path class="d-body" d="M56 150V46q0-11 11-11h50q11 0 11 11v104z"/>
  <path class="d-dark" d="M51 24h82q6 0 6 6t-6 6H51q-6 0-6-6t6-6z"/>
  <path class="d-glass" d="M69 51h45v38H69z"/>
  <path class="d-line" d="M76 80l14-22M88 82l8-13"/>
  <path class="d-dark" d="M213 50h10v36h-10z"/><path class="d-dark" d="M207 44h22v6h-22z"/>
  <path class="d-line" d="M236 102v26M246 102v26M256 102v26"/>
  <path class="d-line" d="M56 118h62M140 86v64"/>
  <circle class="d-steel" cx="150" cy="112" r="9"/>
  <path class="d-shine" d="M124 91h122q9 0 11 7H124zM62 42q0-3 4-3h48q4 0 4 3v3H62z"/>
</svg>`;
const DOZER_BLADE = `<svg class="d-blade" viewBox="0 0 330 210" width="330" height="210">
  <path class="d-dark" d="M224 136l74 22v18l-78-22z"/>
  <path class="d-line" d="M252 98l44 26"/>
  <path class="d-steel" d="M290 60l32-6q-18 74 2 146h-28q-22-70-6-140z"/>
  <path class="d-line" d="M298 84q-9 48 4 98"/>
</svg>`;
const WHEELS = [66, 108, 150, 192, 232];

function el(cls, html = "") { const d = document.createElement("div"); d.className = cls; if (html) d.innerHTML = html; return d; }

/** A word of lettering: three layers (drop, edge, fill) so it reads on any page. `size` is the cap height in px. */
function lettering(word, size) {
  const g = el("glyph"), s = document.createElementNS(SVG, "svg");
  let x = 0; const parts = [];
  for (const key of WORDS[word]) { const gl = GLYPHS[key]; parts.push([x, gl]); x += gl.w * 0.92; }
  const w = x + 8, k = size / 100;
  s.setAttribute("viewBox", `-12 -14 ${w + 30} 130`);
  s.setAttribute("width", ((w + 30) * k).toFixed(1)); s.setAttribute("height", (130 * k).toFixed(1));
  s.style.left = `${(-(w + 30) * k / 2).toFixed(1)}px`; s.style.top = `${(-65 * k).toFixed(1)}px`;
  for (const [layer, dx] of [["drop", 7], ["edge", 0], ["fill", 0]]) {
    for (const [ox, gl] of parts) for (const d of gl.p) {
      const p = document.createElementNS(SVG, "path");
      p.setAttribute("d", d); p.setAttribute("class", layer); p.setAttribute("fill-rule", "evenodd");
      p.setAttribute("transform", `translate(${ox + dx} ${dx}) skewX(-8)`);
      s.append(p);
    }
  }
  g.append(s);
  return g;
}

function burst(points = 9, r1 = 28, r0 = 12) {
  let d = "";
  for (let i = 0; i < points * 2; i++) {
    const a = (i / (points * 2)) * Math.PI * 2, r = (i % 2 ? r0 : r1) * rand(0.8, 1.15);
    d += `${i ? "L" : "M"}${(30 + Math.cos(a) * r).toFixed(1)} ${(30 + Math.sin(a) * r).toFixed(1)}`;
  }
  return `<svg viewBox="0 0 60 60"><path d="${d}Z"/></svg>`;
}

/** Speed lines closing on a point: two drawings the size of the window, swapped back and forth, never one huge layer. */
function rays(cx, cy, w, h) {
  const far = Math.hypot(w, h), pt = (ang, r) => `${(cx + Math.cos(ang) * r).toFixed(0)} ${(cy + Math.sin(ang) * r).toFixed(0)}`;
  const drawing = () => {
    let d = "";
    for (let i = 0; i < 38; i++) {
      const a = (i / 38) * Math.PI * 2 + rand(-0.07, 0.07), half = rand(0.005, 0.022), inner = rand(250, 420);
      d += `M${pt(a, inner)}L${pt(a - half, far)}L${pt(a + half, far)}Z`;
    }
    return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><path d="${d}"/></svg>`;
  };
  return drawing() + drawing();
}

export class Standoff {
  constructor(core, { calm = false, holdAt = null, byKey = false } = {}) {
    this.core = core; this.calm = calm; this.holdAt = holdAt;
    // Pressed from the keyboard there is no pointer to go for, so it goes for the focus ring where it stood.
    this.fixed = byKey ? { ...core.pos } : null;
    this.t = 0; this.frozen = 0; this.held = false; this.done = false;
    this.anims = new Set(); this.nodes = new Set(); this.cues = []; this.cue = 0;
    this.shake = []; this.loops = [];
    const { back, front } = core.el;
    back.className = "back scene"; front.className = "front scene";
    this.back = back; this.front = front;
    const p = this.fixed ? null : core.pointer;
    this.touch = p?.type === "touch";
    this.last = p ? { x: p.x, y: p.y } : { ...core.pos };
    this.z = clamp(core.view.w / 900, 0.62, 1);
    if (calm) this.scriptCalm(); else this.script();
    this.cues.sort((a, b) => a[0] - b[0]);
  }

  // ── Plumbing ────────────────────────────────────────────────────────────
  at(ms, fn, label) { this.cues.push([ms, fn, label]); }
  /** Where the blows land: the live pointer, or the last place a finger was. Kept on screen. */
  target() {
    const p = this.core.pointer, v = this.core.view;
    if (this.fixed) return this.fixed;
    if (p && (p.inside || p.type === "touch")) this.last = { x: p.x, y: p.y };
    return { x: clamp(this.last.x, 14, v.w - 14), y: clamp(this.last.y, 14, v.h - 14) };
  }
  add(node, layer = this.front) { layer.append(node); this.nodes.add(node); return node; }
  /** A one-shot: plays, then removes its element. */
  shot(node, frames, options, layer = this.front) {
    this.add(node, layer);
    const a = node.animate(frames, { fill: "both", ...options });
    this.anims.add(a);
    a.finished.then(() => { this.anims.delete(a); if (!options.keep) { node.remove(); this.nodes.delete(node); } }, () => {});
    if (this.frozen > 0 || this.held) a.pause();
    return a;
  }
  freeze(ms) { this.frozen = ms; this.core.hold = 1e15; for (const a of this.anims) a.pause(); this.core.el.root.dataset.paused = ""; }
  thaw() { this.frozen = 0; if (!this.riding) this.core.hold = 0; for (const a of this.anims) a.play(); delete this.core.el.root.dataset.paused; }
  pause(hidden) { for (const a of this.anims) hidden || this.frozen > 0 || this.held ? a.pause() : a.play(); }
  jolt(amount, angle = rand(0, 6.28)) { this.shake.push({ a: amount, angle, t: 0 }); }
  sfx(...args) { return this.core.sfx(...args); }
  /** A beat, in words, for the live region: what it went for depends on how it was pressed. */
  tell(beat) { this.core.announce(this.core.lines.told[beat].replace("{target}", this.fixed ? "your focus ring" : this.touch ? "the spot you tapped" : "your cursor")); }

  update(dt) {
    if (this.done) return false;
    if (this.held) return false;
    if (this.frozen > 0) { this.frozen -= dt * 1000; if (this.frozen <= 0) this.thaw(); return true; }
    this.t += dt * 1000;
    while (this.cue < this.cues.length && this.cues[this.cue][0] <= this.t) {
      const [, fn, label] = this.cues[this.cue++];
      fn();
      if (this.done) return false;
      if (label && label === this.holdAt) this.holdWhen = this.t + (this.core.holdAfter ?? 30);
    }
    for (const loop of this.loops) loop(dt);
    // Shake: decaying impulses, summed and capped, on the scene's own layers only.
    let sx = 0, sy = 0;
    for (const s of this.shake) { s.t += dt; const m = s.a * Math.exp(-s.t * 16) * Math.cos(s.t * 62); sx += Math.cos(s.angle) * m; sy += Math.sin(s.angle) * m; }
    this.shake = this.shake.filter((s) => s.t < 0.4);
    const cap = 13, mag = Math.hypot(sx, sy); if (mag > cap) { sx *= cap / mag; sy *= cap / mag; }
    const tf = mag > 0.2 ? `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px)` : "";
    if (tf !== this.shook) { this.back.style.transform = tf; this.front.style.transform = tf; this.shook = tf; }
    this.shakeNow = { x: sx, y: sy };
    if (this.fingerEl) { const T = this.target(); this.fingerEl.style.transform = `translate(${T.x}px, ${T.y}px)`; }
    // For screenshots: stop a set time after a named beat.
    if (this.holdWhen && this.t >= this.holdWhen) { this.held = true; for (const a of this.anims) a.pause(); this.core.el.root.dataset.paused = ""; this.core.dispatchEvent(new CustomEvent("supportheld", { detail: this.holdAt })); }
    return true;
  }

  skip() { if (!this.done) this.finish(); }
  finish() { this.done = true; this.core.leave(); }
  destroy() {
    this.done = true;
    for (const a of this.anims) a.cancel();
    for (const n of this.nodes) n.remove();
    this.anims.clear(); this.nodes.clear(); this.loops = [];
    this.engine?.stop?.(); this.rumble?.stop?.();
    this.back.style.transform = this.front.style.transform = "";
    this.back.className = "back"; this.front.className = "front";
    this.core.hold = 0; this.core.pose = null; this.core.gaze = null;
    delete this.core.el.root.dataset.paused;
  }

  // ── Small pieces ────────────────────────────────────────────────────────
  flash(tone, ms = 90) {
    const f = el("flash"); if (tone) f.dataset.tone = tone;
    this.shot(f, [{ opacity: 0.92 }, { opacity: 0.92, offset: 0.55 }, { opacity: 0 }], { duration: ms, easing: "linear" });
  }
  word(word, x, y, size, { rot = rand(-14, 14), life = 620, layer = this.front } = {}) {
    const v = this.core.view, g = lettering(word, size * this.z);
    const half = size * this.z * (WORDS[word].length * 0.42 + 0.2);
    x = clamp(x, half + 6, v.w - half - 6); y = clamp(y, size * 0.6, v.h - size * 0.6);
    const at = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px) rotate(${rot.toFixed(1)}deg)`;
    return this.shot(g, [
      { transform: `${at} scale(0.62)`, opacity: 0, easing: POP },
      { transform: `${at} scale(1)`, opacity: 1, offset: 170 / life, easing: "steps(3, end)" },
      { transform: `${at} translate(2px, -3px) scale(1.03)`, opacity: 1, offset: 1 - 120 / life, easing: "ease" },
      { transform: `${at} translate(2px, -3px) scale(1.08)`, opacity: 0 },
    ], { duration: life }, layer);
  }
  zero(x, y, big = false) {
    const z = el("zero", "<span>0</span>");
    const at = `translate(${(x + rand(-18, 18)).toFixed(0)}px, ${(y - 18).toFixed(0)}px)`, s = big ? 1.7 : 1;
    this.shot(z, [
      { transform: `${at} scale(${0.7 * s})`, opacity: 0, easing: POP },
      { transform: `${at} translateY(-14px) scale(${s})`, opacity: 1, offset: 0.22, easing: EASE_OUT },
      { transform: `${at} translateY(-46px) scale(${s})`, opacity: 1, offset: 0.75, easing: "ease" },
      { transform: `${at} translateY(-54px) scale(${s})`, opacity: 0 },
    ], { duration: big ? 1100 : 760 });
    this.sfx("zero");
  }
  star(x, y, scale = 1) {
    const at = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px) rotate(${rand(0, 90).toFixed(0)}deg)`;
    this.shot(el("star", burst()), [{ transform: `${at} scale(${0.55 * scale})`, opacity: 1 }, { transform: `${at} scale(${1.2 * scale})`, opacity: 1, offset: 0.6 }, { transform: `${at} scale(${1.3 * scale})`, opacity: 0 }], { duration: 170, easing: EASE_OUT });
  }
  puff(x, y, dx, dy, { scale = 1, life = 520, dark = false } = {}) {
    const p = el("puff"); if (dark) p.style.setProperty("--puff", "#5a5d6e");
    const a = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`, b = `translate(${(x + dx).toFixed(0)}px, ${(y + dy).toFixed(0)}px)`;
    this.shot(p, [{ transform: `${a} scale(${0.5 * scale})`, opacity: 0.95 }, { transform: `${b} scale(${1.25 * scale})`, opacity: 0 }], { duration: life, easing: EASE_OUT });
  }
  ring(x, y) {
    const at = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`;
    this.shot(el("ring"), [{ transform: `${at} scale(0.5)`, opacity: 0.95 }, { transform: `${at} scale(1.5)`, opacity: 0 }], { duration: 480, easing: EASE_OUT });
  }
  spark(x, y, delay = 0) {
    const at = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`;
    this.shot(el("spark", SPARK), [{ transform: `${at} scale(0.5) rotate(-30deg)`, opacity: 0 }, { transform: `${at} scale(1.1) rotate(0deg)`, opacity: 1, offset: 0.4 }, { transform: `${at} scale(0.7) rotate(25deg)`, opacity: 0 }], { duration: 520, delay, easing: "ease" });
  }
  punch(i) {
    const T = this.target(), B = this.core.pos;
    const a = Math.atan2(T.y - B.y, T.x - B.x) + rand(-0.35, 0.35), deg = (a * 57.2958).toFixed(1);
    const ox = rand(-22, 22), oy = rand(-22, 22), x = T.x + ox, y = T.y + oy, cx = Math.cos(a), cy = Math.sin(a);
    const from = `translate(${(x - cx * 78).toFixed(0)}px, ${(y - cy * 78).toFixed(0)}px) rotate(${deg}deg)`;
    const hit = `translate(${(x - cx * 20).toFixed(0)}px, ${(y - cy * 20).toFixed(0)}px) rotate(${deg}deg)`;
    const s = rand(0.85, 1.25);
    const frames = [{ transform: `${from} scale(${0.7 * s})`, opacity: 0 }, { transform: `${hit} scale(${1.15 * s})`, opacity: 1, offset: 0.45 }, { transform: `${hit} scale(${s})`, opacity: 1, offset: 0.7 }, { transform: `${hit} scale(${0.96 * s})`, opacity: 0 }];
    this.shot(el("fist", FIST), frames, { duration: 150, easing: "linear" });
    this.shot(el("streak"), frames.map((f) => ({ ...f, opacity: f.opacity * 0.6 })), { duration: 150, easing: "linear" });
    if (i % 2 === 0) this.star(x, y, rand(0.7, 1.1));
    if (i % 5 === 2) this.zero(T.x, T.y - 16);
    this.jolt(2.6, a);
    this.sfx("punch");
    // The button throws itself into each one.
    const lean = (i % 2 ? 1 : -1) * 7;
    this.core.pose = `translate(${(cx * 5 + rand(-2, 2)).toFixed(1)}px, ${(cy * 5 + rand(-2, 2)).toFixed(1)}px) rotate(${lean}deg)`;
  }

  // ── The telling, in order ───────────────────────────────────────────────
  script() {
    const core = this.core, v = core.view, z = this.z;
    const P = this.target();
    // Where it squares up: back from the pointer, toward the middle of the window.
    let dx = v.w * 0.5 - P.x, dy = v.h * 0.42 - P.y, dl = Math.hypot(dx, dy);
    if (dl < 60) { dx = -1; dy = 0.35; dl = Math.hypot(dx, dy); }
    const reach = clamp(Math.min(v.w, v.h) * 0.3 + 70, 165, 290);
    const S = core.bound({ x: P.x + dx / dl * reach, y: clamp(P.y + dy / dl * reach, 110, v.h - 150) });
    const veil = this.add(el("veil"), this.back);
    veil.style.setProperty("--vx", `${(S.x / v.w * 100).toFixed(0)}%`); veil.style.setProperty("--vy", `${(S.y / v.h * 100).toFixed(0)}%`);
    const lines = this.add(el("rays"), this.back);
    this.aim = (x, y) => { lines.innerHTML = rays(x, y, v.w, v.h); };
    if (this.touch || this.fixed) { this.fingerEl = this.add(el("finger"), this.back); if (this.fixed) this.fingerEl.dataset.kind = "focus"; }

    // 0. The press lands. One white frame, everything stops.
    this.at(0, () => {
      core.mood("menace");
      this.flash(null, 80);
      this.sfx("sting");
      this.star(P.x, P.y, 1.5);
      this.freeze(90);
    });
    this.at(20, () => {
      veil.dataset.on = "";
      core.grow = 1.3;
      core.spring = [190, 19]; core.goal = { ...S }; core._rest = S; core.atHome = false;
      this.aim(S.x, S.y);
      this.rumble = this.sfx("rumble", 0, 1.9);
      if (this.fingerEl) this.fingerEl.dataset.on = "";
    });
    // 1. Menace: the lines close in, the letters climb.
    this.at(300, () => { lines.dataset.on = ""; });
    // The letters keep to the side the speech bubble is not on.
    const side = S.x > v.w / 2 === v.w - S.x > 190 ? 1 : -1;
    const spots = [[74, -70, 74], [128, -4, 52], [-26, -96, 56], [104, 66, 42]];
    [330, 450, 540, 610].forEach((ms, i) => this.at(ms, () => {
      const [ox, oy, size] = spots[i], x = clamp(S.x + side * ox * z, 34, v.w - 34), y = S.y + oy * z, rot = rand(-10, 10);
      const g = lettering("go", size * z), at = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px) rotate(${rot.toFixed(0)}deg)`;
      const life = 1560 - ms + 330;
      this.shot(g, [
        { transform: `${at} translateY(12px) scale(0.7)`, opacity: 0, easing: POP },
        { transform: `${at} translateY(0) scale(1)`, opacity: 1, offset: 0.14, easing: "steps(7, end)" },
        { transform: `${at} translateY(-16px) scale(1.04)`, opacity: 1, offset: 0.9, easing: "ease" },
        { transform: `${at} translateY(-22px) scale(1.1)`, opacity: 0 },
      ], { duration: life }, this.back);
      this.sfx("thud", 0, i);
    }));
    this.at(700, () => { core.speak("threat", { loud: true, hold: 1250, at: S }); this.sfx("threat"); }, "menace");
    // 2. The barrage: it closes the distance and does not stop.
    let acc = 0, n = 0, words = 0, wordAcc = 0;
    this.at(2000, () => {
      core.hush(); core.mood("rage"); delete lines.dataset.on;
      this.tell("barrage");
      core.spring = [240, 24];
      this.sfx("muda", 0, 14);
      this.loops.push(this.barrage = (dt) => {
        const T = this.target(), t = (this.t - 2000) / 2500;
        // Stand at arm's length from the target, on the side it came from.
        let ax = core.pos.x - T.x, ay = core.pos.y - T.y, al = Math.hypot(ax, ay) || 1;
        const arm = 122 * Math.max(0.8, z);
        core.goal = core.bound({ x: T.x + ax / al * arm, y: T.y + ay / al * arm });
        acc += dt * (9 + 17 * Math.min(1, t * 1.25));
        while (acc >= 1) { acc -= 1; this.punch(n++); }
        wordAcc += dt * 1000;
        if (wordAcc > (words < 2 ? 330 : 215)) {
          wordAcc = 0; words++;
          const side = words % 2 ? 1 : -1, mx = (core.pos.x + T.x) / 2, my = (core.pos.y + T.y) / 2;
          const px = -ay / al * side, py = ax / al * side, far = rand(105, 190) * Math.max(0.75, z);
          this.word(words % 3 === 0 ? "mudaKana" : "muda", mx + px * far + rand(-50, 50), my + py * far + rand(-30, 30), rand(46, 82), { life: 600, layer: this.back });
        }
      });
    }, "barrage");
    this.at(4500, () => {
      this.loops = this.loops.filter((l) => l !== this.barrage);
      const T = this.target();
      core.pose = null; core.mood("tired");
      this.ring(T.x, T.y); this.spark(T.x + 16, T.y - 18, 120); this.zero(T.x, T.y - 14, true);
      this.sfx("pant");
    });
    // 3. The bulldozer.
    this.at(5150, () => {
      const T = this.target();
      this.dir = T.x > v.w * 0.42 ? 1 : -1; // 1: it comes from the left, facing right
      core.mood("menace");
      core.spring = [130, 20];
      core.goal = { x: this.dir > 0 ? -90 : v.w + 90, y: clamp(T.y - 60, 40, v.h - 80) };
      this.engine = this.sfx("engine");
      this.sfx("whoosh");
    });
    this.at(5560, () => this.dozerIn(), "dozer");
    // 4. It can't. Good grief.
    this.at(9330, () => {
      const T = this.target();
      this.spark(T.x + 15, T.y - 17); this.spark(T.x - 13, T.y + 9, 150); this.ring(T.x, T.y);
      core.mood("grief"); core.gaze = { x: core.pos.x > T.x ? 0.9 : -0.9, y: 0.4 };
      delete veil.dataset.on;
    });
    this.at(9700, () => { core.speak("grief", { soft: true, hold: 1500, at: core.pos }); this.sfx("grief"); }, "grief");
    // 5. And it leaves, by the nearest side.
    this.at(11300, () => {
      core.hush();
      const out = core.pos.x > v.w / 2 ? 1 : -1;
      this.out = out;
      core.grow = 1;
      core.pose = `translate(${-out * 7}px, 0) scale(0.86, 1.1)`; // gathers itself the other way first
    });
    this.at(11480, () => {
      core.pose = null; core.gaze = { x: this.out, y: 0 };
      core.spring = [330, 30]; core.goal = { x: this.out > 0 ? v.w + 140 : -140, y: core.pos.y - 10 };
      for (let i = 0; i < 3; i++) this.puff(core.pos.x - this.out * 6, core.pos.y + 14, -this.out * rand(20, 60), rand(-26, 8), { scale: rand(0.6, 1), life: 600 });
      this.sfx("zip");
    }, "escape");
    this.at(12050, () => this.finish());
  }

  dozerIn() {
    const core = this.core, v = core.view, dir = this.dir, T = this.target();
    const u = clamp(v.w / 900, 0.6, 1.3);
    // Keep the whole machine on screen: the pointer may meet the blade above or below its middle.
    const top = T.y - 135 * u, bottom = T.y + 67 * u;
    let lift = 0;
    if (top < 8) lift = Math.min(60 * u, 8 - top); else if (bottom > v.h - 6) lift = -Math.min(52 * u, bottom - (v.h - 6));
    const node = el("dozer"), flip = el("dozer-flip"), tip = el("dozer-tip"), squash = el("dozer-squash"), blade = el("dozer-part");
    flip.style.transform = `scale(${dir * u}, ${u})`;
    tip.style.transformOrigin = "0px 65px";
    squash.style.transform = "translate(-314px, -135px)";
    squash.innerHTML = DOZER_BODY;
    for (const x of WHEELS) { const w = el("wheel"); w.style.left = `${x}px`; w.style.top = "175px"; squash.append(w); }
    blade.innerHTML = DOZER_BLADE; blade.style.transformOrigin = "296px 150px";
    squash.append(blade); tip.append(squash); flip.append(tip); node.append(flip);
    node.dataset.drive = "";
    this.add(node, this.back);
    const x0 = dir > 0 ? -30 : v.w + 30, x1 = T.x - dir * 3, y = T.y + lift;
    const roof = { x: -dir * 222 * u, y: -111 * u - 30 * core.grow + 6 };
    const start = this.t, travel = 430;
    let phase = "drive", angle = 0, spin = 0, vy = 0, fall = 0, x = x0, hop = 0, pound = 0, since = 0, puffAcc = 0, bladeAngle = 0, bladeFall = 0;
    this.riding = true; core.hold = 1e15; core.pose = null; core.mood("rage");
    core.gaze = { x: dir, y: 0.3 };
    const place = () => {
      node.style.transform = `translate(${x.toFixed(1)}px, ${(y + fall).toFixed(1)}px)`;
      tip.style.transform = angle ? `rotate(${angle.toFixed(2)}deg)` : "";
      if (bladeAngle || bladeFall) blade.style.transform = `translateY(${bladeFall.toFixed(1)}px) rotate(${bladeAngle.toFixed(1)}deg)`;
      if (this.riding) {
        // The rider sits on the roof and goes where the roof goes.
        const rad = angle * dir * Math.PI / 180, rx = roof.x, ry = roof.y - 65 * u;
        core.pos.x = x + rx * Math.cos(rad) - ry * Math.sin(rad);
        core.pos.y = y + fall + 65 * u + rx * Math.sin(rad) + ry * Math.cos(rad) - hop;
        core.goal.x = core.pos.x; core.goal.y = core.pos.y; core.vel.x = core.vel.y = 0;
      }
    };
    place();
    const loop = (dt) => {
      const t = this.t - start;
      if (phase === "drive") {
        const k = Math.min(1, t / travel);
        x = x0 + (x1 - x0) * (0.25 * k + 0.75 * k * k); // already rolling when it enters, and still gaining
        puffAcc += dt; if (puffAcc > 0.07) { puffAcc = 0; this.puff(x - dir * 250 * u, y + fall + 60 * u, -dir * rand(30, 70), rand(-30, -6), { scale: rand(0.6, 1) * u + 0.3, life: 420 }); }
        if (k >= 1) {
          // Impact. The pointer does not move; the bulldozer's back end does.
          phase = "hit"; spin = dir * -150; since = 0;
          const C = this.target();
          this.flash("ink", 100); this.jolt(13, dir > 0 ? 0 : Math.PI); this.jolt(8, 1.57);
          this.star(C.x, C.y, 2.4); this.star(C.x - dir * 20, C.y + 30, 1.4);
          this.word("don", C.x - dir * 120 * u, y + fall - 135 * u - 66 * this.z, 104, { rot: dir * -9, life: 1000 });
          for (let i = 0; i < 5; i++) this.puff(C.x - dir * rand(10, 110) * u, y + fall + 62 * u, dir * rand(-70, 90) * u, rand(-50, 10), { scale: rand(0.7, 1.3) * u, life: 700 });
          this.zero(C.x, C.y - 20, true);
          this.sfx("crash");
          this.tell("dozer");
          const lines = this.back.querySelector(".rays");
          if (lines) { this.aim(C.x, C.y); lines.dataset.on = ""; this.rayOff = this.t + 520; }
          place();
          this.freeze(120);
          return;
        }
      } else {
        since += dt * 1000;
        if (this.rayOff && this.t > this.rayOff) { this.rayOff = 0; delete this.back.querySelector(".rays")?.dataset.on; }
        if (phase === "hit" || phase === "strain") {
          // The back end kicks up and comes down on a spring.
          spin += (-210 * angle - 13 * spin) * dt; angle += spin * dt;
          if (phase === "hit" && since > 620) { phase = "strain"; since = 0; node.dataset.drive = "strain"; this.engine?.strain?.(); core.mood("rage"); }
        }
        if (phase === "strain") {
          // It pushes. The rider pounds on the roof. Nothing gives.
          pound += dt * 9.5;
          const beat = pound % 1;
          hop = Math.sin(Math.min(1, beat * 1.5) * Math.PI) * 15;
          if (beat < dt * 9.5) {
            const C = this.target(), i = Math.floor(pound);
            spin += dir * 34; this.jolt(3.2, 1.57); this.sfx("punch");
            if (i % 3 === 1) this.word(i % 2 ? "muda" : "mudaKana", core.pos.x + rand(-70, 70) - dir * 30, core.pos.y - rand(60, 96), rand(40, 56), { life: 520 });
            if (i % 3 === 0) this.zero(C.x, C.y - 16);
            this.star(C.x - dir * rand(0, 10), C.y + rand(-30, 30), rand(0.6, 0.9));
          }
          puffAcc += dt; if (puffAcc > 0.11) { puffAcc = 0; this.puff(x - dir * 92 * u, y + fall - 92 * u, -dir * rand(4, 26), rand(-50, -24), { scale: rand(0.5, 0.9), life: 520, dark: true }); }
          if (since > 1650) {
            phase = "dead"; since = 0; hop = 0; delete node.dataset.drive;
            this.engine?.stop?.(); this.engine = null; this.sfx("sputter");
            core.mood("tired");
            for (let i = 0; i < 3; i++) this.puff(x - dir * 92 * u, y + fall - 96 * u, -dir * rand(-10, 30), rand(-70, -40), { scale: rand(0.9, 1.4), life: 800, dark: true });
          }
        } else if (phase === "dead") {
          spin += (-210 * angle - 16 * spin) * dt; angle += spin * dt;
          if (since > 520) {
            // It gives up before the pointer does. The rider gets off; the machine falls out of the window.
            phase = "fall"; since = 0; vy = -260; spin = dir * 60;
            this.riding = false; core.hold = 0;
            const C = this.target();
            core.spring = [150, 15];
            core.goal = core.bound({ x: C.x - dir * clamp(v.w * 0.24, 110, 200), y: clamp(C.y + 20, 110, v.h - 150) });
            core._rest = core.goal;
            core.vel = { x: -dir * 120, y: -380 };
            this.sfx("clank");
          }
        } else if (phase === "fall") {
          vy += 2700 * dt; fall += vy * dt; angle += spin * dt; x -= dir * 60 * dt;
          bladeAngle += dir * 150 * dt * dir; bladeFall += 220 * dt;
          if (y + fall - 160 * u > v.h + 40) { this.loops = this.loops.filter((l) => l !== loop); node.remove(); this.nodes.delete(node); return; }
        }
      }
      place();
    };
    this.loops.push(loop);
  }

  /** Less motion: the same story as four still panels that fade in one after another. */
  scriptCalm() {
    const core = this.core;
    const card = this.add(el("strip-card"), this.front);
    const face = (mood) => {
      const b = document.createElement("span");
      b.className = "body"; b.dataset.mood = mood;
      b.style.cssText = "position:absolute;left:50%;top:38%;margin:-30px;pointer-events:none;animation:none";
      const shell = core.el.body.querySelector(".shell").cloneNode(true);
      shell.style.animation = "none";
      shell.querySelector(".tag")?.remove();
      b.append(shell);
      return b;
    };
    const panels = [
      (p) => { p.append(face("menace")); const g = lettering("go", 30); g.style.cssText = "position:absolute;left:80%;top:26%"; const g2 = lettering("go", 22); g2.style.cssText = "position:absolute;left:18%;top:22%"; p.append(g, g2); return core.lines.threat; },
      (p) => { const a = lettering("muda", 34); a.style.cssText = "position:absolute;left:44%;top:26%;transform:rotate(-8deg)"; const b = lettering("mudaKana", 26); b.style.cssText = "position:absolute;left:66%;top:56%;transform:rotate(7deg)"; const f = el("fist", FIST); f.style.cssText = "position:absolute;left:22%;top:58%;opacity:1"; const z = el("zero", "<span>0</span>"); z.style.cssText = "position:absolute;left:86%;top:30%;opacity:1;font-size:1.1rem"; p.append(a, b, f, z); return "MUDA MUDA MUDA MUDA"; },
      (p) => { const d = el("dozer"); d.style.cssText = "position:absolute;left:74%;top:52%"; d.innerHTML = `<div class="dozer-flip" style="transform:scale(0.36)"><div class="dozer-squash" style="transform:translate(-310px,-135px)">${DOZER_BODY}${WHEELS.map((x) => `<div class="wheel" style="left:${x}px;top:175px"></div>`).join("")}${DOZER_BLADE}</div></div>`; const z = el("zero", "<span>0</span>"); z.style.cssText = "position:absolute;left:86%;top:24%;opacity:1;font-size:1.1rem"; p.append(d, z); return "One bulldozer later."; },
      (p) => { p.append(face("grief")); return core.lines.grief; },
    ];
    const made = panels.map((fill) => { const p = el("panel"); const text = fill(p); const cap = document.createElement("p"); cap.textContent = text; p.append(cap); card.append(p); return p; });
    this.at(0, () => { core.mood("menace"); card.dataset.on = ""; made[0].dataset.on = ""; this.sfx("threat"); core.announce(core.lines.threat); }, "menace");
    this.at(1500, () => { made[1].dataset.on = ""; core.mood("rage"); this.sfx("muda", 0, 4); this.tell("barrage"); }, "barrage");
    this.at(3000, () => { made[2].dataset.on = ""; this.sfx("crash"); this.tell("dozer"); }, "dozer");
    this.at(4500, () => { made[3].dataset.on = ""; core.mood("grief"); this.sfx("grief"); core.announce(core.lines.grief); }, "grief");
    this.at(8200, () => { delete card.dataset.on; core.el.mover.dataset.fade = ""; }, "escape");
    this.at(8600, () => this.finish());
  }
}
