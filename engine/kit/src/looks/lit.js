// The lit look: one system of depth and light. Its tools and helpers are in core/light.js; this
// file draws the kit's parts with them, and adds four parts the look needs: a groove, a recess,
// a lamp and a pointer. `--vx-look: lit` on an element (the kit's stylesheet sets it for
// data-vx-look="lit") holds for everything inside it.
import { defineLook, LOOKS } from '../core/look.js';
import { defineMaterial } from '../core/materials.js';
import { CALM, SLIDE } from '../core/motion.js';
import { pilot, FULL, halo, byTheme, warmth, lightName, kindOf, seatedKey, keyLight, ring, hole, cap as capOf, bezel } from '../core/light.js';
import { inlineX } from '../plain.js';
import { toggle, KNOB } from '../components/toggle.js';
import { meter } from '../components/meter.js';
import { wrapLabel } from '../components/util.js';
import { cardSpine } from '../components/card.js';
import { capIcon } from '../components/button.js';
import { parts as existing } from './lit-existing.js';

// ---------------------------------------------------------------------------------------------
// Key. A cap standing on a ring of light.

const key = {
  pad: 9,
  soft: 0.65,

  build(live, m) {
    const { el } = live;
    const off = el.disabled || el.getAttribute('aria-disabled') === 'true';
    const kind = kindOf(el);
    const cap = seatedKey(live, m, off, kind === 'main' ? 'enamel' : 'key', lightName(el, kind === 'danger' ? 'light-stop' : 'light'));
    capIcon(live, cap, live.faceZ - 1, !off && kind === 'main' ? 'ivory' : 'ink');
    live.state.off = off;
    live.label(el.querySelector(':scope > .vx-label'), () => live.state.top + cap.tz);
    // a key that is already held down as the page arrives (open, or pressed) is drawn down
    if (live.state.first === undefined) { live.state.first = false; if (!off && (el.getAttribute('aria-expanded') === 'true' || el.getAttribute('aria-pressed') === 'true')) live.spring('press').snap(-live.state.keyTravel); }
  },

  pose(live) {
    const cap = live.model.byName.cap;
    const press = live.spring('press').x, hover = live.spring('hover').x;
    cap.tz = live.state.off ? 0 : press + hover;
    // the light answers: brighter while aimed at, a flare as the key goes down, a slow fall after
    const f = live.state.flare ?? 0;
    keyLight(live, hover, f);
    if (kindOf(live.el) === 'main' && !live.state.off) {
      live.glowStrength *= 2.6;
      live.glowRadius += 1;
    }
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
    live.glowStrength = halo(WELL_GLOW) * (0.2 + lit * (live.theme === 'day' ? 2.2 : 1.6));
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
    const header = !el.dataset.vxLight && W > H && el.parentElement?.matches('.vx-card')
      && el.parentElement.querySelector(':scope > .vx-groove') === el;
    const { floor } = hole(live, m, { depth: live.look.groove, wall: mat, floor: mat });
    if (header) {
      // A short opal tube is recessed below the header; the remaining channel reflects it.
      const length = Math.min(W - 2, Math.max(6, Math.round(W / 4)));
      if (length > 0) floor.box(1, 0, -live.look.groove - 1, length, H, 1, 'lamp');
    }
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
    if (el.dataset.vxKind === 'growth') return meter.build(live, m);
    const v = read(el);
    const s = live.spring('v', v, CALM.k, CALM.c);
    if (live.state.built === undefined) s.snap(v);
    live.state.built = true;
    live.state.posed = false;
    live.state.growth = false;
    const T = 3, y = Math.floor((H - T) / 2), D = live.look.well;
    hole(live, m, { y, h: T, depth: D, wall: 'slate', floor: 'slate' });
    // A row of lamps in a slot: each is two voxels of light, two apart. One that is not lit
    // is a dark stud, so the scale can be read with nothing on. A lit one reaches the level of the
    // surface, so its light lies on the surface.
    const inlineStud = inlineX(live);
    const studs = m.part('studs');
    studs.sunk = true; studs.grounded = false;
    const fill = m.part('fill');
    fill.sunk = true; fill.grounded = false;
    const mat = lightName(el, 'light'), n = Math.max(1, Math.floor((W + 2) / 4));
    for (let i = 0; i < n; i++) {
      const x = inlineStud(i * 4, 2);
      studs.box(x, y, -D, 2, T, 1, 'steel');
      for (let a = 0; a < 2; a++) for (let j = 0; j < T; j++) for (let k = -D; k < 0; k++) fill.plot(x + a, y + j, k, mat, (i + 0.5) / n);
    }
  },

  pose(live) {
    if (live.state.growth) return meter.pose(live);
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
    const { walls } = hole(live, m, { depth: D, wall: lightName(el, 'light-warm'), floor: 'floor' });
    if (el.dataset.vxReflection === 'warm' && W > 4) {
      walls.box(2, H, -D, W - 4, 1, Math.min(D, 2), 'warm-metal');
    }
  },

  pose(live) { live.glowStrength = halo(WELL_GLOW) * 0.2; },
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
    pilot(m, W, H, lightName(el, 'light-go'));
    live.faceZ = 2;
  },

  pose(live) { live.glowStrength = halo(0.032) * byTheme(live) * (1 + 2 * live.spring('pulse').x); },

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
  soft: 1,
  glowRadius: 3,
  glowStrength: halo(0.02),

  build(live, m) {
    const { W, el } = live;
    const inset = el.clientTop / live.vx;
    const H = Math.max(1, live.H - Math.round(inset));
    const large = W >= 48 && H >= 22;
    const wide = W > 100 && H >= 46;
    const depth = wide ? 14 : large ? 8 : live.look.slab;
    const top = inset ? Math.min(depth, 2 * inset) : depth;
    const r = large ? 3 : live.look.round;
    const body = m.part('body');
    body.slab(2, 2, 0, W - 4, H - 4, 2, 'gasket', r);
    body.slab(0, 0, 2, W, H, top - 4, 'chalk', r);
    ring(body, 0, 0, top - 3, W, H, 'gasket', r);
    body.slab(1, 1, top - 2, W - 2, H - 2, 2, 'chalk', r);
    if (el.dataset.vxLight) ring(m.part('light'), 1, 1, 0, W - 2, H - 2, lightName(el), r);
    if (wide && el.dataset.vxBolts !== 'none') {
      for (const x of [4, W - 5]) for (const y of [4, H - 5]) {
        body.slab(x - 1, y - 1, top - 1, 3, 3, 1, 'steel', 1);
        body.slab(x - 1, y - 1, top, 3, 3, 1, 'steel', 1);
        body.box(x, y, top, 1, 1, 1, 'slate');
      }
    }
    cardSpine(live, m, top, H);
    live.faceZ = top;
  },

  pose(live) { live.glowStrength = halo(0.012) * byTheme(live); },
};

// ---------------------------------------------------------------------------------------------
// Notice. A small slab that floats above the surface on a light that says what kind of news it is.
const NEWS = { done: 'light-go', failed: 'light-stop', note: 'light' };

const notice = {
  pad: 11,
  glowRadius: 2.2,
  glowStrength: halo(0.035),

  build(live, m) {
    const { W, H, el } = live, d = live.look.float;
    ring(m.part('light'), 0, 0, 0, W, H, NEWS[el.dataset.vxKind] || 'light', 1);
    const body = m.part('body');
    body.grounded = false;
    body.slab(0, 0, 1, W, H, d - 1, 'key', 1);
    live.faceZ = d;
  },

  pose(live) { live.glowStrength = halo(live.theme === 'day' ? 0.04 : 0.025); },
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
    lit.box(1, Math.floor((H - 2) / 2), -D, W - 2, 2, 1, 'light-go'); // light on the floor of the trench: the trench stays a trench
    // the key stands on the floor of the trench, on its own light, a voxel proud of the surface
    const knob = m.part('knob');
    knob.grounded = false;
    if (!off) ring(knob, 0, 0, -D, KNOB, H - 2, 'light');
    knob.slab(0, 0, 1 - D, KNOB, H - 2, D + 1, off ? 'steel' : 'ivory', 1);
    const paddle = off ? 'steel' : 'ivory';
    knob.slab(0, 0, 2, KNOB, H - 2, 1, paddle, 1);
    knob.box(1, 1, 3, KNOB - 2, 2, 1, paddle);
    knob.box(2, 1, 3, KNOB - 4, 1, 1, off ? 'slate' : 'key');
    knob.ty = 1;
    live.state.inlineX = inlineX(live);
    live.state.travel = W - 2 - KNOB;
    const s = live.spring('at', input?.checked ? 1 : 0);
    if (!s.moving) s.snap(input?.checked ? 1 : 0);
  },

  pose(live) {
    toggle.pose(live);
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
    live.spring('x', xs[index] ?? 1, SLIDE.k * 1.25, SLIDE.c * 1.12).snap(xs[index] ?? 1);
    tabsEl.forEach((t) => live.label(wrapLabel(t), () => live.faceZ));
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
  groundSoft: 1,
  finishes: {
    chalk: { chamfer: 75 }, floor: { chamfer: 0 }, slate: { chamfer: 80 },
    steel: { chamfer: 195, specular: 165 }, enamel: { chamfer: 175, specular: 105 },
    key: { chamfer: 135, specular: 30 }, ivory: { chamfer: 150, specular: 38 },
  },
  rise: 6, travel: 4, step: 1,
  slab: 5, round: 2, float: 6, dialog: 7, well: 4,
  light: {
    day: { glow: FULL, seam: 0.008, shadow: [0.13, 0.10, 0.07, 0.34] },
    night: { glow: FULL, seam: 0.016, sun: 0.63, shadow: [0, 0, 0.02, 0.6] },
  },
  materials: {
    chalk: { day: '#e9dcc5', night: '#23313b', jitter: 0.006 },   // the surface
    floor: { day: '#c8bda7', night: '#141a1f', jitter: 0.004 },   // the bottom of a well
    slate: { day: '#9f998a', night: '#283038', jitter: 0.008 },   // trays, trenches
    'light-warm': { day: '#c1ac83', night: '#87704e', glow: 0.2 },
    steel: { day: '#aba58f', night: '#535b5b', jitter: 0.012 },   // bezels, bolts, collars, and what is switched off
    enamel: { day: '#174ec6', night: '#315aca', jitter: 0.012 },  // the cap of the one main key
    key: { day: '#f2ebda', night: '#434745', jitter: 0.006 },     // an ordinary cap
    ivory: { day: '#fffefa', night: '#d7dbf0', jitter: 0.006 },
    light: { day: '#388de6', night: '#458fe3', glow: 0.68 },
    signal: { day: '#388de6', night: '#458fe3', glow: 1 }, // what is on: the accent's light
  },
  parts: { button: key, field: well, meter: bar, card: surface, toast: notice, toggle: switchPart, tabs: choice, ...existing },
});

// ---------------------------------------------------------------------------------------------
// Themes. A theme is the accent: the light under what acts, the cap of the one main key, and the
// words that follow them. The system does not change with it. An accent keeps clear of green and
// red, which mean done and failed whatever the theme. One object holds all of a theme: the
// materials and the stylesheet's tokens are both set from it.
export const THEMES = {
  bay: { light: { day: '#388de6', night: '#458fe3' }, cap: { day: '#174ec6', night: '#315aca' }, link: { day: '#1f40c4', night: '#9db8ff' }, legend: '#dfe8ff' },
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
  look.materials.light = { ...th.light, glow: 0.68 };
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
