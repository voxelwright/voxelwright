// A spike, to find out what "skeuomorphism on voxels" should mean here. Two variants of the lit
// look, on the same screen:
//   lit-m   material: the cubes show on every face, slabs and caps are thicker, a key is a keycap.
//   lit-o   object: the same, and three parts are modelled on real devices: the switch is a slide
//           switch in a bezel with a ridged knob, the bar is a row of lamps, the panel is bolted.
// Nothing here is in the kit. What the owner picks moves into src/looks/lit.js.
import { defineLook, LOOKS, ring, hole, lightName, kindOf } from '/packages/voxelmorphism/src/index.js';

const lit = LOOKS.lit;

// A keycap: a body, and a top one voxel smaller all round, on its ring of light.
const keycap = {
  ...lit.parts.button,
  build(live, m) {
    const { W, H, el } = live, look = live.look;
    const off = el.disabled || el.getAttribute('aria-disabled') === 'true';
    const kind = kindOf(el);
    const cap = m.part('cap');
    const depth = off ? 1 : look.rise;
    if (off) cap.slab(0, 0, 0, W, H, 1, 'steel', 1);
    else {
      ring(m.part('light'), 0, 0, 0, W, H, lightName(el, kind === 'danger' ? 'light-stop' : 'light'), 1);
      cap.grounded = false;
      const mat = kind === 'main' ? 'enamel' : 'key';
      cap.slab(0, 0, 1, W, H, depth - 2, mat, 1);
      cap.slab(1, 1, depth - 1, W - 2, H - 2, 1, mat, 1);
    }
    live.state.off = off;
    live.state.top = depth;
    live.faceZ = depth;
    live.label(el.querySelector(':scope > .vx-label'), () => live.state.top + cap.tz);
  },
};

defineLook('lit-m', {
  from: 'lit',
  quiet: false,
  rise: 5, travel: 2, slab: 4, well: 3, float: 6, round: 2,
  light: {
    day: { ...lit.light.day, seam: 0.05 },
    night: { ...lit.light.night, seam: 0.085 },
  },
  materials: {
    ...lit.materials,
    chalk: { ...lit.materials.chalk, jitter: 0.006 },
    key: { day: '#fffefa', night: '#2b3046', jitter: 0.006 },
    floor: { ...lit.materials.floor, jitter: 0.008 },
    slate: { ...lit.materials.slate, jitter: 0.008 },
    enamel: { ...lit.materials.enamel, jitter: 0.012 },
  },
  parts: { button: keycap },
});

// ---------------------------------------------------------------------------------------------
// A slide switch: a bezel round a slot, a knob with ridges to grip, light in the slot behind it.
const KNOB = 7;
const slide = {
  ...lit.parts.toggle,
  pad: 8,
  build(live, m) {
    const { W, H } = live, D = 2;
    const input = live.state.input = live.el.parentElement.querySelector('input');
    const off = input?.disabled;
    // the bezel stands a voxel proud of the surface, all round the slot
    const bezel = m.part('bezel');
    bezel.slab(-2, -2, 0, W + 4, H + 4, 1, 'steel', 1).carve(0, 0, 0, W, H, 1);
    hole(live, m, { depth: D, wall: 'slate', floor: 'slate' });
    const light = m.part('lit');
    light.masked = true; light.grounded = false; light.sunk = true; light.covered = true;
    light.box(0, 0, -D, W, H, 1, 'light');
    const knob = m.part('knob');
    knob.grounded = false;
    if (!off) ring(knob, 0, 0, -D, KNOB, H - 2, 'light');
    knob.slab(0, 0, 1 - D, KNOB, H - 2, D + 1, off ? 'steel' : 'ivory', 1);
    // three ridges across its top
    for (const x of [1, 3, 5]) knob.box(x, 1, 2, 1, H - 4, 1, off ? 'steel' : 'ivory');
    knob.ty = 1;
    live.state.travel = W - 2 - KNOB;
    const s = live.spring('at', input?.checked ? 1 : 0);
    if (!s.moving) s.snap(input?.checked ? 1 : 0);
  },
};

// A row of lamps in a bezel: each is two voxels of light, a voxel apart; what is not lit is a
// dark stud, so the scale can be read with nothing on.
const lamps = {
  ...lit.parts.meter,
  pad: 8,
  build(live, m) {
    const { W, H, el } = live;
    const p = el.querySelector('progress, meter');
    const max = Number(p?.getAttribute('max') || p?.max || 1), min = Number(p?.getAttribute('min') || 0);
    const v = p ? Math.max(0, Math.min(1, (Number(p.getAttribute('value') ?? p.value) - min) / (max - min || 1))) : 0;
    const s = live.spring('v', v);
    if (live.state.built === undefined) s.snap(v);
    live.state.built = true; live.state.posed = false; live.state.growth = false;
    const T = 3, y = Math.floor((H - T) / 2), D = 2;
    m.part('bezel').slab(-2, y - 2, 0, W + 4, T + 4, 1, 'steel', 1).carve(0, y, 0, W, T, 1);
    hole(live, m, { y, h: T, depth: D, wall: 'slate', floor: 'slate' });
    const studs = m.part('studs');
    studs.sunk = true; studs.grounded = false;
    const fill = m.part('fill');
    fill.sunk = true; fill.grounded = false;
    const n = Math.floor((W + 1) / 3), mat = lightName(el, 'light');
    for (let i = 0; i < n; i++) {
      studs.box(i * 3, y, -D, 2, T, 1, 'steel');
      for (let a = 0; a < 2; a++) for (let j = 0; j < T; j++) for (let k = -D; k < 0; k++) fill.plot(i * 3 + a, y + j, k, mat, (i + 0.5) / n);
    }
  },
};

// The panel is bolted down: a stud near each corner.
const bolted = {
  ...lit.parts.card,
  build(live, m) {
    lit.parts.card.build(live, m);
    const { W, H } = live, top = live.faceZ, at = 4;
    if (W < 60 || H < 40) return;
    const bolts = m.part('bolts');
    bolts.grounded = false;
    for (const [x, y] of [[at, at], [W - at - 2, at], [at, H - at - 2], [W - at - 2, H - at - 2]]) bolts.slab(x, y, top, 2, 2, 1, 'steel', 0);
  },
};

defineLook('lit-o', {
  from: 'lit-m',
  parts: { toggle: slide, meter: lamps, card: bolted },
});
