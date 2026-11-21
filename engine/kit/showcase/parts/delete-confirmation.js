// An instrument face with an inset display above the two action keys.
// The standard dialog owns the native close and its course-by-course build.
import { defineLook, LOOKS } from '../../src/index.js';
import { halo, ring } from '../../src/core/light.js';

defineLook('delete-confirmation', {
  from: 'lit', rise: 4, travel: 3, tooling: true,
  materials: {
    chalk: { day: '#65383c', night: '#523036', jitter: .006 },
    floor: { day: '#242d2c', night: '#202727', jitter: .002 },
    gasket: { day: '#262525', night: '#191b1b' },
    key: { day: '#ebe3cc', night: '#ded6c2' },
    backlight: { day: '#494541', night: '#302d2c', glow: 0 },
    lens: { day: '#913932', night: '#85332d', transmission: .2 },
  },
  finishes: {
    ...LOOKS.lit.finishes, chalk: { chamfer: 66, specular: 58 },
    floor: { chamfer: 0 }, lens: { chamfer: 90, specular: 110 },
  },
  parts: {
    dialog: {
      pad: 12, glowRadius: 2, glowStrength: halo(.055),
      build(live, model) {
        const { W, H, el, vx } = live;
        const panel = model.part('panel');
        panel.slab(0, 0, 0, W, H, 1, 'gasket', 2);
        panel.slab(0, 0, 1, W, H, 3, 'chalk', 2);
        live.faceZ = 4;
        if (!el.open || W < 12 || H < 12) return;

        const seam = Math.round(el.querySelector('footer').offsetTop / vx);
        // The display sits a course below a lip of the case.
        panel.slab(2, 2, 3, W - 4, seam - 2, 1, 'gasket', 1);
        panel.carve(3, 3, 3, W - 6, seam - 4, 1);
        panel.box(3, 3, 2, W - 6, seam - 4, 1, 'floor');

        // Status glass with an illuminated core and a polished edge.
        const x = getComputedStyle(el).direction === 'rtl' ? 7 : W - 11;
        panel.box(x - 1, 7, 2, 5, 3, 1, 'gasket');
        panel.box(x, 8, 2, 3, 1, 1, 'lens');
        panel.plot(x + 1, 8, 2, 'light-stop');
        for (const bx of [3, W - 5]) {
          panel.box(bx, H - 4, 3, 2, 2, 1, 'steel');
          panel.plot(bx + 1, H - 4, 3, 'gasket');
        }
      },
      pose: null, // The fitted status lens has constant output.
    },
  },
});
defineLook('delete-key', {
  from: 'delete-confirmation',
  materials: { key: { day: '#933e38', night: '#873b36' } },
  parts: {
    button: {
      ...LOOKS.lit.parts.button,
      build(live, model) {
        LOOKS.lit.parts.button.build(live, model);
        const lamp = model.byName.light;
        if (!lamp || live.W < 9 || live.H < 9) return;
        // A small diffuser under the shoulder lights the socket at contact.
        ring(lamp, 0, 0, 0, live.W, live.H, 'gasket', 1);
        const x = Math.floor(live.W / 2) - 2;
        lamp.box(x, 0, 0, 5, 1, 1, 'lens');
        lamp.box(x + 1, 0, 0, 3, 1, 1, 'light-stop');
      },
    },
  },
});
