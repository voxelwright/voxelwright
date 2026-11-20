// The fixed protocol and domain are legends on one faceplate. Only the name
// sits behind its aperture. All three strings stay in the native field.
import { defineLook, FULL, halo, hole } from '../../src/index.js';

defineLook('address-insert', {
  quiet: true,
  seam: 0.25,
  materials: {
    steel: { day: '#49544e', night: '#404b46', jitter: 0.005 },
    floor: { day: '#d3dfcb', night: '#b6cab8', jitter: 0.002 },
    gasket: { day: '#313c35', night: '#202b25' },
    lens: { day: '#728578', night: '#596b60', transmission: 0.22 },
    light: { day: '#a6e5ca', night: '#a6e5ca' },
  },
  finishes: {
    steel: { chamfer: 48, specular: 75 },
    floor: { chamfer: 12, specular: 0 },
    lens: { chamfer: 88, specular: 90 },
  },
  light: { day: { glow: FULL }, night: { glow: FULL } },
  parts: {
    field: {
      glowRadius: 1.6,
      glowStrength: halo(0.065),
      build(live, model) {
        const { W, H, vx, el } = live;
        const input = el.querySelector('input');
        const bounds = input.getBoundingClientRect();
        const origin = el.getBoundingClientRect().left + (live.cssW - W * vx) / 2;
        const left = Math.max(1, Math.round((bounds.left - origin) / vx));
        const right = Math.min(W - 1, Math.round((bounds.right - origin) / vx));
        hole(live, model, { x: left, y: 1, w: right - left, h: H - 2, depth: 1, wall: 'gasket' });

        const frame = model.part('frame');
        frame.slab(0, 0, 0, W, H, 1, 'steel', 1)
          .carve(left, 1, 0, right - left, H - 2, 1);
        // A flush light pipe indexes the editable span at its entry edge.
        const entry = getComputedStyle(el).direction === 'rtl' ? right - 5 : left;
        frame.box(entry, 0, 0, 5, 1, 1, 'lens');
        if (input.matches(':focus')) frame.box(entry + 1, 0, 0, 3, 1, 1, 'light');
      },
    },
  },
});
