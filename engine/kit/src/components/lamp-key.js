// <button class="vx-button" data-lamp="tide" aria-pressed="false">Tide</button>
// data-vx-pilot="status" gives the face pilot its own supply, independent of the dimmer.
// Selection connects power. The switch always returns to its rest height.
import { wrapLabel } from './util.js';
import { button } from './button.js';
import { hole } from '../core/light.js';
import { defineMaterial } from '../core/materials.js';

for (const [name, day] of Object.entries({
  'lamp-cap': '#eee4cd',
  'key-plate': '#353b35',
  'key-liner': '#222722',
  'key-bed': '#191e1b',
  'pilot-glass': '#50564b',
}))
  defineMaterial(name, { day, jitter: 0.006 });

function mould(live, cap, x, y, w, h, rise) {
  // Slices of the mould. The long front apron curves around the two cheeks.
  // A little more draft on the far side keeps the face level in projection.
  const side = Math.max(2, Math.round(w * 0.12));
  const apron = Math.max(3, Math.round(h * 0.29));
  const origin = live.el.offsetLeft / live.vx;
  let pilot;
  for (let z = 0; z < rise; z++) {
    const t = z / (rise - 1);
    const left = x + Math.round(t * side * 0.35);
    const right = x + w - 1 - Math.round(t ** 2 * side * 1.3);
    const rear = y + Math.round(t * 2);
    const front = y + h - 1 - Math.round(t * apron);
    const radius = Math.max(2, Math.round(w * (0.06 + 0.05 * t)));
    for (let xx = left; xx <= right; xx++) {
      const u = (xx - left) / (right - left);
      const edge = Math.abs(u * 2 - 1);
      const dist = Math.max(0, radius - Math.min(xx - left, right - xx) - 0.5);
      const corner = Math.round(radius - Math.sqrt(radius * radius - dist * dist));
      const top = rear + corner;
      const bottom = front - corner - Math.round(t * edge ** 2 * h * 0.05);
      cap.box(xx, top, z, 1, bottom - top + 1, 1, 'lamp-cap');
      if (z !== rise - 1) continue;
      const pilotColumn = xx === left + Math.round((right - left) * 0.2);
      const pilotRow = Math.min(bottom, Math.max(top, rear + Math.round((front - rear) * 0.14)));
      const horizon = 0.82 + 0.09 * Math.sin((origin + xx) * 0.13) + 0.05 * Math.sin((origin + xx) * 0.31);
      for (let yy = top; yy <= bottom; yy++) {
        const v = (yy - rear) / Math.max(1, front - rear);
        const dish = Math.round(edge ** 3 + 0.09 * v);
        cap.box(xx, yy, z + 1, 1, 1, dish, 'lamp-cap');
        if (live.look.artwork && v >= horizon)
          cap.plot(xx, yy, z + dish, v > horizon + 0.08 ? 'cap-ridge' : 'cap-inlay');
        if (pilotColumn && yy === pilotRow) pilot = { x: xx, y: yy, z: z + dish };
      }
    }
  }
  return pilot;
}

// Direct, short-range light from the side diffuser. Sample only the receiving
// cells in its pocket. Opaque plastic blocks the ray, opal transmits a fraction.
function spill(cap, plate, walls, source, receiver, travel, transmission) {
  const [x, y, z] = receiver;
  const sx = source.x + 0.5,
    sy = Math.max(source.y + 0.5, Math.min(source.end - 0.5, y)),
    sz = source.z + 0.5;
  const dx = x - sx,
    dy = y - sy,
    dz = z - sz;
  const length = Math.hypot(dx, dy, dz);
  if (length > 7) return 0;
  let light = 0.52 / (1 + length * length * 0.17);
  for (let d = 0.55; d < length - 0.65; d += 0.65) {
    const f = d / length;
    const xx = Math.floor(sx + dx * f),
      yy = Math.floor(sy + dy * f),
      zz = sz + dz * f;
    if (plate.has(xx, yy, Math.floor(zz)) || walls.has(xx, yy, Math.floor(zz - walls.tz))) return 0;
    if (cap.has(xx, yy, Math.floor(zz - travel))) {
      if (!transmission) return 0;
      light *= transmission;
    }
  }
  return light;
}

function lighting(live, source, faceWindow, width) {
  const { cap, plate, walls, floor, emitter, diffuser, pilot } = live.model.byName;
  const through = live.look.materials['lamp-cap']?.transmission ?? 0;
  const dark = [0.2, 0.23, 0.21], unlitPilot = [0.33, 0.37, 0.34];
  let revision, power, pilotPower, depth, receivers;
  return () => {
    const on = !live.state.off && live.el.getAttribute('aria-pressed') === 'true';
    const level = on ? (live.look.dimmer ?? 1) : 0;
    const pilotLevel = on && live.el.dataset.vxPilot === 'status' ? 1 : level;
    const travel = Math.round(cap.tz * 2) / 2;
    if (revision === live.tintRevision && power === level && pilotPower === pilotLevel && (!level || depth === travel)) return;
    if (revision !== live.tintRevision) {
      receivers = [];
      for (const part of [walls, floor, cap]) {
        for (let i = 0; i < part.count; i++) {
          const [x, y, z] = part.rest.subarray(i * 3, i * 3 + 3);
          // The face window is bonded to the cap. Frosted resin scatters
          // locally around it even when the side fitting is behind the skirt.
          const wx = Math.max(faceWindow.x + 0.5, Math.min(faceWindow.x + width - 0.5, x));
          const distance =
            part === cap && through
              ? Math.hypot(x - wx, y - faceWindow.y - 0.5, z - faceWindow.z - 0.5)
              : Infinity;
          const frost = distance < 9 ? through * Math.exp(-distance / 3) : 0;
          if (!frost && (Math.abs(x - source.x) > 8 || y < source.y - 7 || y > source.end + 7)) continue;
          receivers.push({ part, i, x, y, z, frost, base: part.col.slice(i * 4, i * 4 + 3) });
        }
      }
      revision = live.tintRevision;
    }
    const color = live.look.illuminant ?? '#71e2cd';
    const rgb = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255);
    for (const lens of [emitter, diffuser, pilot]) {
      const supply = lens === pilot ? pilotLevel : level;
      const glass = lens === pilot ? unlitPilot : dark;
      for (let i = 0; i < lens.count; i++) {
        for (let j = 0; j < 3; j++) lens.col[i * 4 + j] = glass[j] * (1 - supply) + rgb[j] * supply;
        lens.col[i * 4 + 3] = supply;
      }
    }
    for (const { part, i, x, y, z, base, frost } of receivers) {
      const direct = level && spill(cap, plate, walls, source, [x, y, z + (part === cap ? travel : 0)], travel, through);
      const amount = pilotLevel * frost + level * direct;
      for (let j = 0; j < 3; j++) part.col[i * 4 + j] = base[j] + (rgb[j] - base[j]) * amount;
    }
    power = level;
    pilotPower = pilotLevel;
    depth = travel;
    live.glows = false; // direct spill is already on the receivers; skip the screen halo
  };
}

export const lampKey = {
  ...button,
  name: 'lamp-key',
  selector: '.vx-button[data-lamp]',
  momentary: true,
  soft: 0.22,
  pad: 3,
  plain(el, on) {
    wrapLabel(el);
    return button.plain(el, on, { momentary: true });
  },
  build(live, m) {
    const { W, H, el } = live;
    if (W < 12 || H < 12) {
      // The stage also measures controls while an ancestor is hidden.
      live.state.lightPocket = null;
      return;
    }
    const rim = Math.max(1, Math.round(Math.min(W, H) * 0.045));
    const w = W - rim * 2,
      h = H - rim * 2;
    const high = live.look.rise >= 6;
    const rise = Math.max(3, Math.min(high ? 10 : 5, Math.round(h * (high ? 0.24 : 0.14))));
    m.keyTravel = high ? rise - 1 : Math.max(2, rise - 2);
    const depth = m.keyTravel + 2;
    const { walls, floor } = hole(live, m, { x: rim, y: rim, w, h, depth, wall: 'key-liner', floor: 'key-bed' });
    // The fixed switch housing passes through the floor. Its open bore guides
    // the stem even at rest and leaves clearance at the bottom of the stroke.
    const shaft = Math.max(2, Math.round(Math.min(w, h) * 0.15));
    const x = Math.floor((W - shaft) / 2), y = Math.floor((H - shaft) / 2);
    const boreBottom = -depth - m.keyTravel - 2;
    const guideTop = -m.keyTravel;
    const guide = m.part('guide');
    guide.grounded = false;
    floor.carve(x - 2, y - 2, -depth - 1, shaft + 4, shaft + 4, 1);
    guide.box(x - 2, y - 2, boreBottom, shaft + 4, shaft + 4, guideTop - boreBottom, 'key-liner');
    guide.carve(x - 1, y - 1, boreBottom + 1, shaft + 2, shaft + 2, guideTop - boreBottom - 1);
    const stem = m.part('stem');
    stem.grounded = false;
    stem.box(x, y, -depth, shaft, shaft, depth, 'steel');
    const plate = m.part('plate');
    plate.box(0, 0, 0, W, H, 1, 'key-plate').carve(rim, rim, 0, w, h, 1);
    // The diode lies one course below the lip, alongside the skirt. As the
    // skirt seats it crosses the line of sight to the same fixed fitting.
    const kerf = Math.max(1, Math.round(Math.min(w, h) * 0.055));
    const source = { x: rim + w - kerf, y: rim + Math.floor(h * 0.42), z: -2 };
    source.end = source.y + Math.max(2, Math.round(h * 0.21));
    // A carrier on the liner holds the two-cell LED package beside the cap.
    walls.box(source.x + 1, source.y, source.z - 1, kerf - 1, source.end - source.y, 2, 'key-liner');
    for (const [name, z] of [
      ['emitter', source.z - 1],
      ['diffuser', source.z],
    ]) {
      const fitting = m.part(name);
      fitting.grounded = false;
      fitting.box(source.x, source.y, z, 1, source.end - source.y, 1, 'pilot-glass');
    }
    const cap = m.part('cap');
    cap.grounded = false;
    cap.mouldRadius = 4;
    const inset = Math.max(2, kerf);
    const pilot = mould(live, cap, rim + inset, rim + kerf, w - inset - kerf, h - 2 * kerf, rise);
    const width = Math.max(2, Math.round(w * 0.12));
    cap.carve(pilot.x, pilot.y, pilot.z, width, 1, 3);
    m.part('pilot').box(pilot.x, pilot.y, pilot.z, width, 1, 1, 'pilot-glass').grounded = false;
    live.label(el.querySelector(':scope > .vx-label'), () => cap.tz);
    live.state.off = el.matches(':disabled,[aria-disabled="true"]');
    live.state.lightPocket = lighting(live, source, pilot, width);
    live.glowStrength = 0;
  },
  pose(live) {
    if (!live.state.lightPocket) return;
    const { cap, stem, pilot } = live.model.byName;
    cap.tz = stem.tz = pilot.tz = live.state.off ? 0 : Math.max(-live.model.keyTravel, Math.min(0, live.spring('press').x));
    live.state.lightPocket();
  },
};
