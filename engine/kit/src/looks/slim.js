// The slim look (Voxelmorphism v1): compact, low-profile, precision-machined hardware designed
// for live gameplay HUDs over a 3D world. Fine voxel pitch (--vx: 2px for HUD keys, 3px for
// panels), low cap height (3 courses), translucent smoked polycarbonate caps with Fresnel rim
// gleam, cobalt enamel primary keys, hollow stepped octagonal thumbstick gimbal, and subtle
// edge backlighting that flares on press.
import { defineLook, LOOKS } from '../core/look.js';
import './lit.js';
import { FULL, halo, byTheme, lightName, kindOf, ring, hole, keyLight } from '../core/light.js';
import { capIcon } from '../components/button.js';
import { ICONS } from '../core/icons.js';

// Precision micro-voxel icons for slim keys (at 2px voxel pitch, 9-11 cells = 18-22px crisp relief).
const SLIM_ICONS = {
  ...ICONS,
  back: [
    '....##',
    '...##.',
    '..##..',
    '.##...',
    '##....',
    '.##...',
    '..##..',
    '...##.',
    '....##',
  ],
  spark: [
    '....#....',
    '....#....',
    '...###...',
    '..#####..',
    '#########',
    '..#####..',
    '...###...',
    '....#....',
    '....#....',
  ],
  car: [
    '..#####..',
    '.#.....#.',
    '#########',
    '##.###.##',
    '#########',
    '.##...##.',
  ],
  radio: [
    '......#..',
    '....##...',
    '..##.....',
    '#########',
    '#..###..#',
    '#.#####.#',
    '#..###..#',
    '#########',
  ],
  // A media player's keys (the eggs' player, engine/page/eggs.ts).
  play: [
    '##......',
    '####....',
    '######..',
    '########',
    '########',
    '######..',
    '####....',
    '##......',
  ],
  pause: [
    '###..###',
    '###..###',
    '###..###',
    '###..###',
    '###..###',
    '###..###',
    '###..###',
    '###..###',
  ],
  stop: [
    '#######',
    '#######',
    '#######',
    '#######',
    '#######',
    '#######',
    '#######',
  ],
  next: [
    '#....#....##',
    '##...##...##',
    '###..###..##',
    '####.####.##',
    '###..###..##',
    '##...##...##',
    '#....#....##',
  ],
  sound: [
    '...#...#..',
    '..##....#.',
    '####..#..#',
    '####...#.#',
    '####...#.#',
    '####..#..#',
    '..##....#.',
    '...#...#..',
  ],
  muted: [
    '...#......',
    '..##......',
    '####.#...#',
    '####..#.#.',
    '####...#..',
    '####..#.#.',
    '..##.#...#',
    '...#......',
  ],
  minimize: [
    '........',
    '........',
    '........',
    '........',
    '........',
    '........',
    '########',
    '########',
  ],
  playing: [
    '...##......',
    '...##......',
    '...##....##',
    '...##....##',
    '##.##....##',
    '##.##....##',
    '##.##.##.##',
    '##.##.##.##',
    '##.##.##.##',
  ],
};

/** Corner step scaled to control proportion: sculpted octagon for square keys, crisp chamfer for pills. */
const cornerStep = (W, H) => {
  const m = Math.min(W, H);
  if (Math.abs(W - H) <= 4 && m >= 16) return Math.min(4, Math.floor(m / 5));
  return m >= 10 ? 2 : 1;
};

// ---------------------------------------------------------------------------------------------
// Slim key. A low-profile floating keycap (3 courses total, 1.5 travel) that stays strictly
// inside W x H with no bulky outer collar. Sculpted stepped plateau, backlit under-ring that
// flares on press, and an optional top pilot LED slit when active/latched.
const slimKey = {
  pad: 5,
  soft: 0.45,

  build(live, m) {
    const { W, H, el } = live;
    const off = el.matches(':disabled') || el.getAttribute('aria-disabled') === 'true';
    const kind = kindOf(el);
    const active = !off && (el.classList.contains('chute') || el.classList.contains('flying') || el.getAttribute('aria-pressed') === 'true' || el.getAttribute('aria-expanded') === 'true');
    const isMain = !off && (kind === 'main' || el.classList.contains('chute'));
    const mat = off ? 'steel' : isMain ? 'enamel' : el.dataset.vxMaterial || 'key';
    const lamp = lightName(el, kind === 'danger' ? 'light-stop' : 'light');
    const r = cornerStep(W, H);

    // Floating thumbstick cap: precision stepped octagon with sculpted concave dish & pearl center pip.
    if (el.hasAttribute('data-vx-stick-cap')) {
      const rr = Math.min(5, Math.floor(Math.min(W, H) / 4));
      const cap = m.part('cap');
      cap.grounded = false;
      cap.slab(0, 0, 0, W, H, 1, 'steel', rr);
      cap.slab(1, 1, 1, Math.max(1, W - 2), Math.max(1, H - 2), 1, 'key', Math.max(1, rr - 1));
      if (W >= 12 && H >= 12) {
        // Subtle 1-course recessed thumb dish in the center with a crisp pearl-ivory locating pip.
        cap.carve(4, 4, 1, W - 8, H - 8, 1);
        const cx = Math.floor(W / 2) - 1, cy = Math.floor(H / 2) - 1;
        cap.box(cx, cy, 1, 2, 2, 1, 'ivory');
      }
      m.keyTravel = 0;
      live.state.off = false;
      live.state.top = live.faceZ = 2;
      return;
    }

    const depth = off ? 1 : 3;
    m.keyTravel = off ? 0 : 1.5;
    const cap = m.part('cap');

    if (off) {
      cap.slab(0, 0, 0, W, H, 1, 'steel', Math.min(r, 2));
    } else {
      // Recessed under-keycap light ring: whisper-quiet at rest, flares cleanly on hover/press.
      const lr = Math.max(1, r - 1);
      if (W >= 6 && H >= 6) {
        ring(m.part('light'), 1, 1, 0, W - 2, H - 2, isMain || active ? lamp : 'light-warm', lr);
      }
      cap.grounded = false;
      // Low-profile skirt + stepped reading face (the 1-voxel chamfer reads as machined hardware).
      cap.slab(0, 0, 1, W, H, 1, mat, r);
      if (W >= 6 && H >= 6) {
        cap.slab(1, 1, 2, W - 2, H - 2, 1, mat, lr);
      } else {
        cap.slab(0, 0, 2, W, H, 1, mat, r);
      }
      // Subtle top status LED bar when latched/flying/expanded (or red warning bar for danger).
      if ((active || kind === 'danger') && W >= 10 && H >= 8) {
        const lw = Math.min(6, Math.max(3, Math.floor(W / 4)));
        const lx = Math.floor((W - lw) / 2);
        cap.box(lx, 1, 2, lw, 1, 1, kind === 'danger' ? 'light-stop' : 'light');
      }
    }

    // Crisp voxel icon relief (inlaid flush into the top course so it never looks bulbous).
    if (el.dataset.vxIcon) {
      capIcon(live, cap, depth - 1, off ? 'slate' : 'ivory');
    }
    live.state.off = off;
    live.state.active = active;
    live.state.isMain = isMain;
    live.state.top = live.faceZ = depth;
    live.label(el.querySelector(':scope > .vx-label'), () => live.state.top + cap.tz);

    if (live.state.first === undefined || live.state.pressTravel !== m.keyTravel) {
      live.state.first = false;
      live.state.pressTravel = m.keyTravel;
      if (!off && (el.getAttribute('aria-expanded') === 'true' || el.getAttribute('aria-pressed') === 'true')) {
        live.spring('press').snap(-m.keyTravel * 0.5);
      }
    }
  },

  pose(live) {
    const cap = live.model.byName.cap;
    if (!cap) return;
    const el = live.el;
    const press = live.spring('press').x, hover = live.spring('hover').x;
    cap.tz = live.state.off ? 0 : press + hover * 0.6;
    const f = live.state.flare ?? 0;
    const active = live.state.active || (!live.state.off && (el.getAttribute('aria-pressed') === 'true' || el.getAttribute('aria-expanded') === 'true'));
    keyLight(live, hover * 0.7, f, active ? 0.95 : 0);
    live.glowStrength *= live.state.isMain ? 1.5 : active ? 1.15 : 0.65;
    live.glowRadius = 1.9 + f * 0.8;
    el.style.setProperty('--lit', f.toFixed(3));
  },

  step(live, dt) {
    if (live.state.off) return false;
    const down = live.spring('press').x < -0.3;
    const was = live.state.flare ?? 0;
    const f = down ? Math.min(1, was + dt / 0.05) : Math.max(0, was - dt / 0.45);
    live.state.flare = f;
    return f > 0 && f !== was;
  },
};

// ---------------------------------------------------------------------------------------------
// Slim card. Compact HUD cues & badges are 2-course smoked translucent plates with a left
// accent edge; larger panels (Settings drawer) are refined 4-course machined enclosures.
const slimCard = {
  pad: 6,
  soft: 0.55,
  glowRadius: 2.2,
  glowStrength: halo(0.014),

  build(live, m) {
    const { W, H, el } = live;
    const panel = W >= 36 && H >= 22;
    const body = m.part('body');
    if (!panel) {
      const r = Math.min(2, Math.floor(Math.min(W, H) / 4));
      body.slab(0, 0, 0, W, H, 2, 'chalk', r);
      if (H >= 6 && W >= 8) {
        // Subtle 1-voxel backlit accent edge along the left side of a cue card.
        const h = Math.max(2, H - 4);
        body.box(0, Math.floor((H - h) / 2), 1, 1, h, 1, lightName(el, 'light'));
      }
      live.faceZ = 2;
      return;
    }
    // Refined low-profile machined hardware panel (4 courses total instead of v0's 14).
    const r = 2;
    body.slab(1, 1, 0, Math.max(1, W - 2), Math.max(1, H - 2), 1, 'gasket', r);
    body.slab(0, 0, 1, W, H, 2, 'chalk', r);
    ring(body, 0, 0, 2, W, H, 'steel', r);
    body.slab(1, 1, 3, Math.max(1, W - 2), Math.max(1, H - 2), 1, 'chalk', Math.max(1, r - 1));
    if (el.dataset.vxLight) ring(m.part('light'), 1, 1, 0, W - 2, H - 2, lightName(el), r);
    live.faceZ = 4;
  },

  pose(live) { live.glowStrength = halo(0.012) * byTheme(live); },
};

// ---------------------------------------------------------------------------------------------
// Slim recess. For the floating touch thumbstick (.float), builds a HOLLOW stepped octagonal
// gimbal ring so the game world shows straight through its center; elsewhere a sleek 2-course well.
const slimRecess = {
  pad: 5,
  glowRadius: 2.2,
  glowStrength: halo(0.018),

  build(live, m) {
    const { W, H, el } = live;
    if (el.classList.contains('float')) {
      const cx = (W - 1) / 2, cy = (H - 1) / 2;
      const rOut = Math.min(W, H) / 2 - 0.3;
      const rIn = rOut - 2.1;
      const gimbal = m.part('ring');
      gimbal.grounded = false;
      // Stepped circular/octagonal hollow voxel ring — 100% open interior!
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const d = Math.hypot(x - cx, y - cy);
          if (d <= rOut && d >= rIn) {
            const cardinal = Math.abs(x - cx) < 1.2 || Math.abs(y - cy) < 1.2;
            gimbal.plot(x, y, 0, 'chalk');
            if (d >= rIn + 0.7) gimbal.plot(x, y, 1, cardinal ? 'steel' : 'chalk');
          }
        }
      }
      // Subtle 1-voxel backlit compass ticks at N/S/E/W.
      const midX = Math.round(cx), midY = Math.round(cy);
      const tick = Math.max(2, Math.round(rIn) - 1);
      for (const [tx, ty] of [[midX, midY - tick], [midX, midY + tick], [midX - tick, midY], [midX + tick, midY]]) {
        if (tx >= 0 && tx < W && ty >= 0 && ty < H) gimbal.plot(tx, ty, 1, 'light');
      }
      live.faceZ = 2;
      return;
    }
    hole(live, m, { depth: 2, wall: 'steel', floor: 'floor' });
  },

  pose(live) { live.glowStrength = halo(0.016); },
};

// ---------------------------------------------------------------------------------------------
// Slim inline kbd. A razor-crisp 2-course miniature smoked keycap.
const slimKbd = {
  pad: 3,

  build(live, m) {
    const { W, H } = live;
    const cap = m.part('cap');
    cap.slab(0, 0, 0, W, H, 1, 'steel', 1);
    const inset = W >= 5 && H >= 5 ? 1 : 0;
    cap.slab(inset, inset, 1, W - 2 * inset, H - 2 * inset, 1, 'key', 1);
    live.faceZ = 2;
    live.label(live.el.querySelector(':scope > .vx-label'), () => live.faceZ);
  },
};

defineLook('slim', {
  from: 'lit',
  quiet: false,
  groundSoft: 0.7,
  icons: SLIM_ICONS,
  inlay: true,
  rise: 3,
  travel: 1.5,
  step: 1,
  slab: 3,
  round: 2,
  float: 3,
  dialog: 4,
  well: 2,
  groove: 1,
  seam: 0.45,
  grain: 0.55,
  finishes: {
    ...LOOKS.lit.finishes,
    chalk: { chamfer: 135, specular: 95 },
    floor: { chamfer: 0, specular: 0 },
    slate: { chamfer: 90, specular: 30 },
    gasket: { chamfer: 85, specular: 25 },
    steel: { chamfer: 195, specular: 170 },
    enamel: { chamfer: 190, specular: 165 },
    key: { chamfer: 170, specular: 130 },
    ivory: { chamfer: 160, specular: 95 },
    lens: { chamfer: 50, specular: 140 },
  },
  light: {
    day: { glow: FULL, seam: 0.012, sun: 0.82, shadow: [0.04, 0.06, 0.12, 0.34] },
    night: { glow: FULL, seam: 0.018, sun: 0.68, shadow: [0, 0, 0.04, 0.52] },
  },
  materials: {
    chalk: { day: '#151c29', night: '#111622', jitter: 0.005, transmission: 0.14 },
    floor: { day: '#0f141e', night: '#0c1018', jitter: 0.004, transmission: 0.12 },
    slate: { day: '#131924', night: '#0e131d', jitter: 0.006, transmission: 0.12 },
    gasket: { day: '#0b0f17', night: '#080b12', jitter: 0.004, transmission: 0.10 },
    steel: { day: '#5a6b86', night: '#485872', jitter: 0.008 },
    enamel: { day: '#1f52e8', night: '#2c60f6', jitter: 0.008, transmission: 0.06 },
    key: { day: '#1d2638', night: '#182030', jitter: 0.006, transmission: 0.15 },
    ivory: { day: '#f0f5fc', night: '#e4ebf6', jitter: 0.004 },
    ink: { day: '#f0f5fc', night: '#f0f5fc', jitter: 0, seamless: true },
    light: { day: '#4e9aff', night: '#60a8ff', glow: 0.94 },
    'light-warm': { day: '#7e93b5', night: '#627698', glow: 0.28 },
    signal: { day: '#4e9aff', night: '#60a8ff', glow: 1 },
    'light-go': { day: '#2ee07a', night: '#38eb84', glow: 1 },
    'light-stop': { day: '#ff5847', night: '#ff6454', glow: 1 },
  },
  parts: {
    button: slimKey,
    card: slimCard,
    recess: slimRecess,
    kbd: slimKbd,
  },
});
