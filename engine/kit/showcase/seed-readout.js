// The Seed specimen keeps the standard field's input, focus and state bindings.
import { defineLook, FULL, halo, hole } from '../src/index.js';

defineLook('seed-readout', {
  quiet: true,
  seam: 0.28,
  materials: {
    floor: { day: '#26343a', night: '#263139', jitter: 0.002 },
    steel: { day: '#73818a', night: '#58676f', jitter: 0.012 },
    gasket: { day: '#242c30', night: '#171e24' },
    lens: { day: '#536b70', night: '#40565b', transmission: 0.2 },
    light: { day: '#a1e6df', night: '#8ad6cf' },
  },
  light: { day: { glow: FULL }, night: { glow: FULL } },
  parts: {
    field: {
      glowRadius: 1.6,
      glowStrength: halo(0.08),
      build(live, model) {
        const { W, H, el } = live;
        const input = el.querySelector('input');
        const rtl = getComputedStyle(el).direction === 'rtl';
        const cheek = 7;
        const x = rtl ? cheek : 1;
        const width = W - cheek - 1;
        hole(live, model, { x, y: 1, w: width, h: H - 2, wall: 'gasket' });

        // One stamped face seats both the readout and the separate light pipe.
        const face = model.part('escutcheon');
        face.slab(0, 0, 0, W, H, 1, 'steel', 1).carve(x, 1, 0, width, H - 2, 1);
        const lampX = rtl ? 2 : W - cheek + 2;
        const lampY = Math.floor(H / 2);
        face.box(lampX - 1, lampY - 1, 0, 5, 3, 1, 'gasket');
        const invalid = input.getAttribute('aria-invalid') === 'true';
        const active = input.matches(':enabled') && (invalid || input.matches(':focus'));
        face.box(lampX, lampY, 0, 3, 1, 1, active ? (invalid ? 'light-stop' : 'light') : 'lens');
      },
    },
  },
});
