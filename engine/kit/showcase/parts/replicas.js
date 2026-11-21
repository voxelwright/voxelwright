// The Replicas module uses the kit's ordinary key stroke, number field and hold-to-repeat
// behavior. Only the tooling changes: two short plungers and one reflective LCD.
import { defineLook, FONTS, hole, listeners, measureText } from '../../src/index.js';
import { watchDirection } from '../../src/plain.js';

const colors = (day, night = day) => ({ day, night });
const keyFace = 8;

const plunger = {
  build(live, m) {
    const { W, H, el } = live;
    const off = el.matches(':disabled, [aria-disabled="true"]');
    live.state.off = off;
    m.keyTravel = 3;
    // The underside stays inside the guide throughout the stroke. At a limit
    // the whole key parks against its stop, leaving just the face above the rim.
    const seat = m.part('seat');
    // The plate ends four CSS pixels above the origin, two key cells up.
    seat.slab(-1, -1, 2, W + 2, H + 2, 4, 'gasket', 2)
      .carve(0, 0, 3, W, H, 3);
    const cx = Math.floor(W / 2), cy = Math.floor(H / 2);
    seat.grounded = false;
    seat.box(cx - 3, cy - 3, -3, 7, 7, 5, 'gasket')
      .carve(cx - 2, cy - 2, -2, 5, 5, 5);
    const cap = m.part('cap');
    cap.grounded = false;
    const z = off ? 3 : 6;
    cap.box(cx - 1, cy - 1, z - 5, 3, 3, 5, 'steel');
    cap.slab(1, 1, z, W - 2, H - 2, 3, 'key', 2);
    cap.slab(1, 2, z + 3, W - 2, H - 4, 1, 'key', 2);
    cap.mouldRadius = 2;
    const legend = off ? 'steel' : 'ivory';
    cap.box(cx - 4, cy - 1, z + 3, 7, 1, 1, legend);
    if (el.dataset.vxStep === 'up') cap.box(cx - 1, cy - 4, z + 3, 1, 7, 1, legend);
    live.faceZ = keyFace;
  },
  pose(live) {
    live.model.byName.cap.tz = live.state.off ? 0 : Math.max(-3, Math.min(0, live.spring('press').x));
  },
};

defineLook('replicas', {
  from: 'lit', seam: .18, quiet: false,
  materials: {
    slate: colors('#4a5050'), gasket: colors('#252a2a'), key: colors('#373f40'),
    steel: colors('#a7aaa0'), ivory: colors('#f5f0db'), floor: colors('#c6cdad', '#aeb99c'),
  },
  finishes: {
    slate: { chamfer: 35, specular: 46 }, steel: { chamfer: 65, specular: 102 },
    key: { chamfer: 30, specular: 18 }, floor: { chamfer: 0, specular: 18 },
  },
  parts: {
    button: plunger,
    field: {
      build(live, m) {
        const { W, H } = live;
        const bezel = m.part('bezel');
        bezel.slab(1, 2, 0, W - 2, H - 4, 2, 'gasket', 2)
          .carve(3, 4, 0, W - 6, H - 8, 2);
        hole(live, m, { x: 3, y: 4, w: W - 6, h: H - 8, depth: 1, wall: 'slate', floor: 'floor' });
      },
    },
  },
});

export const replicaPlate = {
  name: 'replica-plate', selector: '#replicas',
  bind(live) {
    const on = listeners();
    watchDirection(live, on);
    on.watch(live.el.querySelector('input'), { attributes: true, attributeFilter: ['min', 'max'] }, () => live.rebuild());
    return on.done;
  },
  build(live, model) {
    const { W, H } = live;
    const plate = model.part('plate');
    plate.slab(1, 1, 0, W - 2, H - 2, 2, 'gasket', 3);
    plate.slab(0, 0, 2, W, H, 2, 'slate', 3);
    live.faceZ = 4;
    // Two flush slotted fasteners along the mounting ears.
    for (const x of [5, W - 14]) {
      const y = Math.floor(H / 2) - 4;
      plate.slab(x, y, 3, 9, 9, 1, 'gasket', 3);
      plate.slab(x + 1, y + 1, 3, 7, 7, 1, 'steel', 2);
      for (let i = 2; i < 7; i++) {
        plate.carve(x + i, y + 8 - i, 3, 1, 1, 1);
        plate.plot(x + i, y + 8 - i, 2, 'gasket');
      }
    }
    const input = live.el.querySelector('input');
    for (const el of live.el.querySelectorAll('button, .vx-well')) {
      const x = Math.round(el.offsetLeft / live.vx), y = Math.round(el.offsetTop / live.vx);
      const w = Math.round(el.offsetWidth / live.vx), h = Math.round(el.offsetHeight / live.vx);
      if (el.matches('button')) {
        // The socket flange bears on the panel. Only its guide passes through.
        const unit = parseFloat(getComputedStyle(el).getPropertyValue('--vx')) / live.vx;
        const origin = (live.faceZ - keyFace * unit) / 2;
        const bore = extent => Math.round(origin + (Math.floor(extent / (2 * unit)) - 3) * unit);
        plate.carve(x + bore(w), y + bore(h), 0, 7 * unit, 7 * unit, 4);
        const limit = el.dataset.vxStep === 'down' ? input.min : input.max;
        if (/^\d{1,2}$/.test(limit)) {
          const width = measureText(FONTS.block, limit);
          plate.text(limit, x + Math.floor((w - width) / 2), H - 15, 3, 1, 'steel', 1, 'block');
        }
      } else {
        // The insert includes the bezel and its recessed glass. Cut the full footprint
        // projected from the child canvas onto the parent plane (two plate cells).
        const dx = live.faceZ / 2;
        plate.carve(x + dx + 2, y + dx + 4, 0, w - 4, h - 8, 4);
      }
    }
  },
};
