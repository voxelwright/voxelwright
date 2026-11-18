// The lit look: one system of depth and light. Its tools and helpers are in core/light.js; this
// file draws the kit's parts with them, and adds four parts the look needs: a groove, a recess,
// a lamp and a pointer. `--vx-look: lit` on an element (the kit's stylesheet sets it for
// data-vx-look="lit") holds for everything inside it.
import { defineLook, LOOKS } from '../core/look.js';
import { defineMaterial } from '../core/materials.js';
import { CALM } from '../core/motion.js';
import { FULL, halo, byTheme, warmth, lightName, kindOf, ring, hole, cap as capOf, bezel } from '../core/light.js';
import { parts as existing } from './lit-existing.js';

// ---------------------------------------------------------------------------------------------
// Key. A cap standing on a ring of light.
const KEY_GLOW = 0.075, KEY_REACH = 4.2;

const key = {
  pad: 9,
  glowRadius: KEY_REACH,
  glowStrength: halo(KEY_GLOW),

  build(live, m) {
    const { W, H, el } = live, look = live.look;
    const off = el.disabled || el.getAttribute('aria-disabled') === 'true';
    const kind = kindOf(el);
    const cap = m.part('cap');
    const depth = off ? 1 : look.rise;
    if (off) cap.slab(0, 0, 0, W, H, 1, 'steel', 1);
    else {
      // the light is a ring one voxel high under the cap's edge: it shows as a lit line at the
      // foot of the key, and its halo is the light on the surface round it
      ring(m.part('light'), 0, 0, 0, W, H, lightName(el, kind === 'danger' ? 'light-stop' : 'light'), 1);
      cap.grounded = false;
      capOf(cap, 0, 0, 1, W, H, depth - 1, kind === 'main' ? 'enamel' : 'key');
    }
    live.state.off = off;
    live.state.top = depth;
    live.faceZ = depth;
    live.label(el.querySelector(':scope > .vx-label'), () => live.state.top + cap.tz);
    // a key that is already held down as the page arrives (open, or pressed) is drawn down
    if (live.state.first === undefined) { live.state.first = false; if (!off && (el.getAttribute('aria-expanded') === 'true' || el.getAttribute('aria-pressed') === 'true')) live.spring('press').snap(-look.travel); }
  },

  pose(live) {
    const cap = live.model.byName.cap;
    const press = live.spring('press').x, hover = live.spring('hover').x;
    cap.tz = live.state.off ? 0 : press + hover;
    // the light answers: brighter while aimed at, a flare as the key goes down, a slow fall after
    const f = live.state.flare ?? 0;
    live.glowStrength = halo(KEY_GLOW) * byTheme(live) * (1 + hover * 1.2 + f * 2.6);
    live.glowRadius = KEY_REACH + f * 2.2;
    live.el.style.setProperty('--lit', f.toFixed(3));
  },

  step(live, dt) {
    if (live.state.off) return false;
    const down = live.spring('press').x < -0.4;
    const was = live.state.flare ?? 0;
    const f = down ? Math.min(1, was + dt / 0.06) : Math.max(0, was - dt / 0.55);
    live.state.flare = f;
    return f > 0 && f !== was;
  },
};

// ---------------------------------------------------------------------------------------------
// Well. A level below the surface for what you put in. The light is in its rim: the floor you
// type on stays plain. In focus the rim is the accent and brighter; an invalid one is red.
const WELL_GLOW = 0.05;

const well = {
  pad: 7,
  glowRadius: 3.2,
  glowStrength: halo(WELL_GLOW),

  build(live, m) {
    const { W, H, el } = live, D = live.look.well;
    const input = el.querySelector('input, textarea');
    const bad = input?.getAttribute('aria-invalid') === 'true', focus = !!input?.matches(':focus');
    hole(live, m, { depth: D, wall: bad ? 'light-stop' : focus ? 'light' : lightName(el, 'light-warm'), floor: input?.disabled ? 'slate' : 'floor' });
    live.spring('lit', 0, CALM.k * 2, CALM.c * 1.4).to(focus || bad ? 1 : 0);
  },

  pose(live) {
    const lit = live.spring('lit').x;
    live.glowStrength = halo(WELL_GLOW) * (warmth(live) + lit * (live.theme === 'day' ? 2.2 : 1.6));
    live.glowRadius = 3.2 + lit * 1.2;
  },
};

// ---------------------------------------------------------------------------------------------
// Groove. A channel one voxel deep with light in it. Lies along its longer side.
// Markup: <div class="vx-groove" role="separator"></div>
export const groove = {
  name: 'groove',
  selector: '.vx-groove',
  pad: 6,
  glowRadius: 2.6,
  glowStrength: halo(0.05),

  build(live, m) {
    const { W, H, el } = live;
    const mat = lightName(el, 'light-warm');
    hole(live, m, { depth: live.look.groove, wall: mat, floor: mat });
  },

  pose(live) { live.glowStrength = halo(0.05) * (live.el.dataset.vxLight ? byTheme(live) : warmth(live)); },
};

// ---------------------------------------------------------------------------------------------
// Bar. A trench in the surface that fills with light, one column at a time.
const read = (el) => {
  const p = el.querySelector('progress, meter');
  if (!p) return Number(el.dataset.vxValue || 0);
  const max = Number(p.getAttribute('max') || p.max || 1), min = Number(p.getAttribute('min') || 0);
  return Math.max(0, Math.min(1, (Number(p.getAttribute('value') ?? p.value) - min) / (max - min || 1)));
};

const bar = {
  pad: 7,
  glowRadius: 3.4,
  glowStrength: halo(0.04),

  build(live, m) {
    const { W, H, el } = live;
    const v = read(el);
    const s = live.spring('v', v, CALM.k, CALM.c);
    if (live.state.built === undefined) s.snap(v);
    live.state.built = true;
    live.state.posed = false;
    live.state.growth = false;
    const T = 3, y = Math.floor((H - T) / 2), D = live.look.well;
    hole(live, m, { y, h: T, depth: D, wall: 'slate', floor: 'slate' });
    // A row of lamps in a slot: each is two voxels of light, a voxel apart. One that is not lit
    // is a dark stud, so the scale can be read with nothing on. A lit one reaches the level of the
    // surface, so its light lies on the surface.
    const studs = m.part('studs');
    studs.sunk = true; studs.grounded = false;
    const fill = m.part('fill');
    fill.sunk = true; fill.grounded = false;
    const mat = lightName(el, 'light'), n = Math.max(1, Math.floor((W + 1) / 3));
    for (let i = 0; i < n; i++) {
      studs.box(i * 3, y, -D, 2, T, 1, 'steel');
      for (let a = 0; a < 2; a++) for (let j = 0; j < T; j++) for (let k = -D; k < 0; k++) fill.plot(i * 3 + a, y + j, k, mat, (i + 0.5) / n);
    }
  },

  pose(live) {
    live.glowStrength = halo(0.04) * byTheme(live);
    if (!live.state.posed) { live.state.posed = true; live.model.byName.fill.grow(live.spring('v').x + 0.0001, 0); }
  },
};

// ---------------------------------------------------------------------------------------------
// Recess. A well with no input in it: what you read as set apart (a log, code).
// Markup: <div class="vx-recess">…</div>
export const recess = {
  name: 'recess',
  selector: '.vx-recess',
  pad: 7,
  glowRadius: 3.2,
  glowStrength: halo(WELL_GLOW),

  build(live, m) {
    const { W, H, el } = live, D = live.look.well;
    hole(live, m, { depth: D, wall: lightName(el, 'light-warm'), floor: 'floor' });
  },

  pose(live) { live.glowStrength = halo(WELL_GLOW) * warmth(live); },
};

// ---------------------------------------------------------------------------------------------
// Lamp. A small light standing on the surface: a state you can see from across the room.
// Markup: <span class="vx-lamp" data-vx-light="go"></span>
export const lamp = {
  name: 'lamp',
  selector: '.vx-lamp',
  pad: 6,
  glowRadius: 3.4,
  glowStrength: halo(0.16),

  build(live, m) {
    const { W, H, el } = live;
    // a lamp in its collar: the collar is a voxel wide and reaches past the element's box
    m.part('collar').slab(-1, -1, 0, W + 2, H + 2, 1, 'steel', 1).carve(0, 0, 0, W, H, 1);
    m.part('lamp').box(0, 0, 0, W, H, 2, lightName(el, 'light-go'));
    live.faceZ = 1;
  },

  pose(live) { live.glowStrength = halo(0.16) * byTheme(live) * (1 + live.spring('pulse').x); },

  bind(live) {
    const watch = new MutationObserver(() => { live.rebuild(); const p = live.spring('pulse', 0, CALM.k, CALM.c * 0.8); p.snap(1.4); p.to(0); live.invalidate(); });
    watch.observe(live.el, { attributes: true, attributeFilter: ['data-vx-light'] });
    return () => watch.disconnect();
  },
};

// ---------------------------------------------------------------------------------------------
// Surface. One slab a region. With data-vx-light it stands on a light of its own, which lies on
// the ground round it: a window that lights the page it is on.
const surface = {
  pad: 14,
  glowRadius: 10,
  glowStrength: halo(0.02),

  build(live, m) {
    const { W, H, el } = live, d = live.look.slab, r = live.look.round;
    const lit = el.dataset.vxLight;
    const body = m.part('body');
    if (lit) {
      // the light sits a voxel in from the edge, under the slab: no lit line, only its light on the ground
      ring(m.part('light'), 1, 1, 0, W - 2, H - 2, lightName(el, 'light'), 3);
      body.grounded = false;
      body.slab(0, 0, 1, W, H, d, 'chalk', r);
    } else body.slab(0, 0, 0, W, H, d, 'chalk', r);
    // a panel is bolted down: a stud near each corner of one large enough to be a panel
    if (W >= 60 && H >= 40 && el.dataset.vxBolts !== 'none') {
      const top = lit ? d + 1 : d, at = 4, bolts = m.part('bolts');
      bolts.grounded = false;
      for (const [x, y] of [[at, at], [W - at - 2, at], [at, H - at - 2], [W - at - 2, H - at - 2]]) bolts.box(x, y, top, 2, 2, 1, 'steel');
    }
    live.faceZ = lit ? d + 1 : d;
  },

  pose(live) { live.glowStrength = halo(0.02) * (live.theme === 'day' ? 0.9 : 1); },
};

// ---------------------------------------------------------------------------------------------
// Notice. A small slab that floats above the surface on a light that says what kind of news it is.
const NEWS = { done: 'light-go', failed: 'light-stop', note: 'light' };

const notice = {
  pad: 11,
  glowRadius: 6,
  glowStrength: halo(0.15),

  build(live, m) {
    const { W, H, el } = live, d = live.look.float;
    ring(m.part('light'), 0, 0, 0, W, H, NEWS[el.dataset.vxKind] || 'light', 1);
    const body = m.part('body');
    body.grounded = false;
    body.slab(0, 0, 1, W, H, d - 1, 'key', 1);
    live.faceZ = d;
  },

  pose(live) { live.glowStrength = halo(live.theme === 'day' ? 0.18 : 0.15); },
};

// ---------------------------------------------------------------------------------------------
// Pointer. An arrow of the same voxels, under the same light, a few voxels above everything: it
// casts a shadow on what it is over, and comes down onto what it presses.
// Markup: <span class="vx-cursor"></span>, moved with CSS translate.
const ARROW = [
  '#.......',
  '##......',
  '#o#.....',
  '#oo#....',
  '#ooo#...',
  '#oooo#..',
  '#ooooo#.',
  '#oooooo#',
  '#ooo####',
  '#o#oo#..',
  '##.#oo#.',
  '#...#o#.',
  '.....##.',
];
const HOVER = 6;
export const pointer = {
  name: 'cursor',
  selector: '.vx-cursor',
  pad: 15,

  build(live, m) {
    const arrow = m.part('arrow');
    arrow.grounded = false;
    ARROW.forEach((row, j) => [...row].forEach((c, i) => { if (c !== '.') arrow.box(i, j, HOVER, 1, 1, 2, c === '#' ? 'pointer-edge' : 'ivory'); }));
    live.faceZ = HOVER + 2;
  },

  pose(live) {
    const arrow = live.model.byName.arrow, d = live.spring('press').x;
    // it comes down along the line of sight, so its tip stays on the point it is aimed at
    arrow.tz = d; arrow.tx = -d * 0.5; arrow.ty = -d * 0.5;
  },
};

// ---------------------------------------------------------------------------------------------
// Switch. A trench with a key in it. On: the key is at the far end and the trench behind it is
// full of light.
const KNOB = 7;

const switchPart = {
  pad: 7,
  glowRadius: 3,
  glowStrength: halo(0.05),

  build(live, m) {
    const { W, H } = live, D = live.look.well;
    const input = live.state.input = live.el.parentElement.querySelector('input');
    const off = input?.disabled;
    // a slide switch: a bezel round a slot, a knob with ridges to grip, light in the slot behind it
    bezel(m, 0, 0, W, H);
    hole(live, m, { depth: D, wall: 'slate', floor: 'slate' });
    const lit = m.part('lit');
    lit.masked = true; lit.grounded = false; lit.sunk = true; lit.covered = true;
    lit.box(0, 0, -D, W, H, 1, 'light'); // light on the floor of the trench: the trench stays a trench
    // the key stands on the floor of the trench, on its own light, a voxel proud of the surface
    const knob = m.part('knob');
    knob.grounded = false;
    if (!off) ring(knob, 0, 0, -D, KNOB, H - 2, 'light');
    knob.slab(0, 0, 1 - D, KNOB, H - 2, D + 1, off ? 'steel' : 'ivory', 1);
    for (const x of [1, 3, 5]) knob.box(x, 1, 2, 1, H - 4, 1, off ? 'steel' : 'ivory'); // three ridges across its top
    knob.ty = 1;
    live.state.travel = W - 2 - KNOB;
    const s = live.spring('at', input?.checked ? 1 : 0);
    if (!s.moving) s.snap(input?.checked ? 1 : 0);
  },

  pose(live) {
    const { knob, lit } = live.model.byName;
    const t = live.spring('at').x;
    const x = 1 + t * live.state.travel;
    knob.tx = x;
    knob.tz = live.spring('press').x;
    const edge = x + KNOB / 2;
    for (let i = 0; i < lit.count; i++) lit.scales[i] = t <= 0.001 ? 0 : Math.max(0, Math.min(1, edge - lit.rest[i * 3] + 0.5));
    live.glowStrength = halo(0.05) * byTheme(live);
  },
};

// ---------------------------------------------------------------------------------------------
// Choice. A trench of seats; the chosen one is a key level with the surface, standing on its
// light; the others are down in the trench.
const choice = {
  pad: 7,
  glowRadius: 3.4,
  glowStrength: halo(0.07),

  build(live, m) {
    const { W, H, el, vx } = live, D = live.look.well;
    const tabsEl = live.state.tabs = [...el.querySelectorAll(':scope > [role="tab"]')];
    hole(live, m, { depth: D, wall: 'slate', floor: 'slate' });
    const seat = live.state.seat = tabsEl.length ? Math.round(tabsEl[0].offsetWidth / vx) : W;
    const block = m.part('block');
    block.grounded = false;
    ring(block, 1, 1, -D, seat - 2, H - 2, 'light');
    capOf(block, 1, 1, 1 - D, seat - 2, H - 2, D - 1, 'key');
    const index = Math.max(0, tabsEl.findIndex((t) => t.getAttribute('aria-selected') === 'true'));
    live.state.index = index;
    const xs = live.state.xs = tabsEl.map((t) => Math.round(t.offsetLeft / vx) + 1);
    live.spring('x', xs[index] ?? 1, 260, 30).snap(xs[index] ?? 1);
    tabsEl.forEach((t) => live.label(t.querySelector(':scope > .vx-label') ?? t, () => live.faceZ));
  },

  pose(live) {
    live.model.byName.block.tx = live.spring('x').x - 1;
    live.glowStrength = halo(0.07) * byTheme(live);
  },
};

// ---------------------------------------------------------------------------------------------
defineLook('lit', {
  // Objects, not flat faces: the cubes show on every face, slabs and caps are thick, a key is a
  // keycap, what slides has a bezel, a panel is bolted down.
  quiet: false,
  rise: 5, travel: 2, step: 1,
  slab: 4, round: 2, float: 6, dialog: 7, well: 2,
  light: {
    day: { glow: FULL, seam: 0.05, shadow: [0.16, 0.13, 0.1, 0.24] },
    night: { glow: FULL, seam: 0.085, sun: 0.5, shadow: [0, 0, 0.02, 0.6] },
  },
  materials: {
    chalk: { day: '#f5f2e9', night: '#1b1e2d', jitter: 0.006 },   // the surface
    floor: { day: '#fbf9f2', night: '#0c0e18', jitter: 0.004 },   // the bottom of a well
    slate: { day: '#dcd8cb', night: '#11131f', jitter: 0.008 },   // trays, trenches
    steel: { day: '#c2beb0', night: '#30344a', jitter: 0.012 },   // bezels, bolts, collars, and what is switched off
    enamel: { day: '#2f5bff', night: '#3560f2', jitter: 0.012 },  // the cap of the one main key
    key: { day: '#fffefa', night: '#2b3046', jitter: 0.006 },     // an ordinary cap
    ivory: { day: '#fffefa', night: '#d7dbf0', jitter: 0.006 },
    signal: { day: '#2f5bff', night: '#4d7dff', glow: 1 }, // what is on: the accent's light
  },
  parts: { button: key, field: well, meter: bar, card: surface, toast: notice, toggle: switchPart, tabs: choice, ...existing },
});

// ---------------------------------------------------------------------------------------------
// Themes. A theme is the accent: the light under what acts, the cap of the one main key, and the
// words that follow them. The system does not change with it. An accent keeps clear of green and
// red, which mean done and failed whatever the theme. One object holds all of a theme: the
// materials and the stylesheet's tokens are both set from it.
export const THEMES = {
  bay: { light: { day: '#2f5bff', night: '#4d7dff' }, cap: { day: '#2f5bff', night: '#3560f2' }, link: { day: '#1f40c4', night: '#9db8ff' }, legend: '#dfe8ff' },
  rose: { light: { day: '#ff3d9a', night: '#ff6fb4' }, cap: { day: '#c2186f', night: '#c9237a' }, link: { day: '#9a1056', night: '#ffa3cf' }, legend: '#ffe3f1' },
  dusk: { light: { day: '#6a4dff', night: '#9278ff' }, cap: { day: '#5b3df0', night: '#6548f2' }, link: { day: '#4a2fd0', night: '#b9a8ff' }, legend: '#e9e3ff' },
};

/**
 * Set the theme: a name from THEMES, or an object of the same shape. Changes the look's
 * materials and writes the tokens on <html>. The kit's theme() calls this and then recolours
 * every part that is drawn.
 */
export function applyTheme(t = 'bay') {
  const th = typeof t === 'string' ? THEMES[t] ?? THEMES.bay : t;
  const look = LOOKS.lit;
  look.materials.enamel = th.cap;
  look.materials.signal = { ...th.light, glow: 1 };
  defineMaterial('light', { ...th.light, glow: 1, jitter: 0 }); // and every look's colours are read again
  const root = globalThis.document?.documentElement;
  if (root) {
    const set = (k, v) => root.style.setProperty(k, v);
    set('--lit-accent-day', th.light.day); set('--lit-accent-night', th.light.night);
    set('--lit-cap-day', th.cap.day); set('--lit-cap-night', th.cap.night);
    set('--lit-link-day', th.link.day); set('--lit-link-night', th.link.night);
    set('--lit-legend-night', th.legend);
    if (typeof t === 'string') root.dataset.vxTheme = t; else delete root.dataset.vxTheme;
  }
  return th;
}
