// A date window and a short-throw calendar key in the two halves of one casting.
import { defineLook, halo, hole } from '../../src/index.js';

const finish = (day, night = day, extra = {}) => ({ day, night, ...extra });
const materials = {
  steel: finish('#766d5f', '#655f56', { jitter: .009 }),
  gasket: finish('#292c29'),
  floor: finish('#243736', '#20312f', { jitter: .003 }),
  key: finish('#3b4341', '#39413e', { jitter: .008 }),
  lens: finish('#545e54', '#475047', { transmission: .20 }),
  'light-warm': finish('#ffc780', '#efb46d', { glow: .65 }),
};

defineLook('deploy-date', {
  from: 'lit', seam: .26, materials,
  finishes: { steel: { chamfer: 90, specular: 95 }, key: { chamfer: 45, specular: 16 } },
  parts: {
    field: {
      build(live, model) {
        const { W, H } = live;
        const face = model.part('casting');
        face.slab(0, 0, 0, W, H, 2, 'steel', 2)
          .carve(3, 3, 0, W - 6, H - 6, 2);
        if (live.el.matches(':focus-within')) face.box(3, 2, 1, 10, 1, 1, 'ivory');
        hole(live, model, { x: 3, y: 3, w: W - 6, h: H - 6, depth: 1, wall: 'gasket' });
        live.faceZ = 2;
      },
    },
    button: {
      build(live, model) {
        const { W, H, el } = live;
        const mount = model.part('casting');
        mount.slab(0, 0, 0, W, H, 2, 'steel', 2)
          .carve(2, 2, 0, W - 4, H - 7, 2);
        hole(live, model, { x: 2, y: 2, w: W - 4, h: H - 7, depth: 5, wall: 'gasket', floor: 'gasket' });
        const cx = Math.floor(W / 2);
        mount.box(cx - 4, H - 4, 1, 8, 2, 1, 'gasket').carve(cx - 3, H - 4, 1, 6, 1, 1);
        model.part('lens').box(cx - 3, H - 4, 1, 6, 1, 1, 'lens');
        model.part('emitter').box(cx - 3, H - 4, 1, 6, 1, 1, 'light-warm');
        const guide = model.part('guide');
        guide.sunk = true;
        guide.box(cx - 4, 7, -5, 8, 8, 4, 'gasket').carve(cx - 2, 9, -5, 4, 4, 4);
        const cap = model.part('cap');
        cap.grounded = false;
        cap.sunk = true;
        cap.box(cx - 2, 9, -2, 4, 4, 4, 'key');
        cap.slab(4, 3, 2, W - 8, H - 10, 4, 'key', 2)
          .slab(5, 4, 6, W - 10, H - 12, 1, 'key', 2);
        // Inlay the calendar in the same top course as the surrounding PBT.
        const x = cx - 4, y = Math.floor((H - 7) / 2) - 2;
        cap.box(x, y + 1, 6, 8, 2, 1, 'ivory')
          .box(x, y + 3, 6, 1, 4, 1, 'ivory').box(x + 7, y + 3, 6, 1, 4, 1, 'ivory')
          .box(x, y + 7, 6, 8, 1, 1, 'ivory');
        for (const dx of [2, 5]) {
          cap.plot(x + dx, y, 6, 'ivory').plot(x + dx, y + 4, 6, 'ivory');
        }
        model.keyTravel = 3;
        live.faceZ = 2;
        live.state.top = 7;
        live.state.off = el.matches(':disabled, [aria-disabled="true"]');
      },
      pose(live) {
        const { cap, emitter, lens } = live.model.byName;
        const held = live.el.getAttribute('aria-expanded') === 'true';
        cap.tz = Math.max(-live.model.keyTravel, Math.min(.25, live.spring('press').x));
        lens.hidden = held;
        emitter.hidden = !held;
        live.glowStrength = held ? halo(.055) : 0;
        live.glowRadius = 1.8;
      },
    },
  },
});

// The native float already builds and sheds courses. Give those same courses a
// graphite edge and a paper face so the month can be read from across the panel.
defineLook('deploy-month', {
  from: 'lit', seam: .26, rise: 3, travel: 2, well: 2,
  materials: { ...materials, panel: finish('#e5e3cf'), key: finish('#d3d1bd'), floor: finish('#e5e3cf') },
  parts: {
    popover: {
      build(live, model) {
        const { W, H } = live;
        const body = model.part('body');
        body.slab(0, 0, 0, W, H, 2, 'key', 2)
          .slab(0, 0, 2, W, H, 2, 'gasket', 2)
          .slab(1, 1, 3, W - 2, H - 2, 1, 'panel', 1);
        live.faceZ = 4;
      },
    },
  },
});
