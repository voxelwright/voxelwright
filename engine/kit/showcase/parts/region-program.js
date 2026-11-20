// A program window and a momentary key share one casting. The native select
// spans both, so pressing the setting or its arrow opens the same picker.
import { defineLook, LOOKS } from '../../src/core/look.js';
import { halo } from '../../src/core/light.js';

defineLook('region-program', {
  from: 'lit',
  seam: 0.28,
  materials: {
    slate: { day: '#414b49', night: '#374240', jitter: 0.009 },
    steel: { day: '#b6bdb5', night: '#abb3ad', jitter: .006 },
    gasket: { day: '#262e2c', night: '#202927' },
    floor: { day: '#b3caa5', night: '#a1bd94', jitter: 0.003 },
    'warm-metal': { day: '#cab58e', night: '#bcaa87', jitter: 0.005 },
    lens: { day: '#806545', night: '#69553c' },
    'light-warm': { day: '#f5be71', night: '#eeb265', glow: 0.8 },
  },
  finishes: {
    ...LOOKS.lit.finishes,
    slate: { chamfer: 54, specular: 38 },
    floor: { chamfer: 10, specular: 28 },
    'warm-metal': { chamfer: 75, specular: 106 },
  },
  parts: {
    select: {
      glowRadius: 2,
      glowStrength: halo(0.045),
      build(live, model) {
        const { W, H, el } = live;
        const rtl = getComputedStyle(el).direction === 'rtl';
        const off = live.state.off = live.state.control.matches(':disabled');
        const keyWidth = 8;
        const keyX = rtl ? 2 : W - keyWidth - 2;
        const windowX = rtl ? keyWidth + 4 : 2;
        const windowWidth = W - keyWidth - 6;
        const body = model.part('housing');
        body.slab(0, 0, 0, W, H, 3, 'slate', 1);
        body.carve(windowX, 2, 2, windowWidth, H - 4, 1);
        body.box(windowX, 2, 1, windowWidth, H - 4, 1, off ? 'steel' : 'floor');
        body.carve(keyX - 1, 1, 1, keyWidth + 2, H - 2, 2);
        body.box(keyX - 1, 1, 0, keyWidth + 2, H - 2, 1, 'gasket');

        // A sliding stem passes through the socket floor. At its stop the key
        // face is flush with the casting. The display stays on its own plane.
        const key = model.part('picker-key');
        key.grounded = false;
        body.carve(keyX + 2, 4, 0, keyWidth - 4, H - 7, 1);
        key.box(keyX + 2, 4, 0, keyWidth - 4, H - 7, 4, 'gasket');
        key.slab(keyX, 3, 4, keyWidth, H - 5, 2, off ? 'steel' : 'warm-metal', 1);
        for (let i = 0; i < 5; i++) {
          key.plot(keyX + 1 + i, Math.floor(H / 2) - 1 + Math.min(i, 4 - i), 5, 'gasket');
        }

        const lensX = keyX + 2;
        body.box(lensX, 1, 1, 4, 1, 1, 'gasket');
        model.part('lens').box(lensX, 1, 2, 4, 1, 1, 'lens');
        model.part('pilot').box(lensX, 1, 2, 4, 1, 1, 'light-warm');
        model.keyTravel = 3;
        live.faceZ = 2;
        if (off) {
          live.state.held = false;
          live.spring('press').snap(0);
        }
        live.label(el.querySelector('.vx-select-face'), () => live.faceZ);
      },
      pose(live) {
        const { lens, pilot, 'picker-key': key } = live.model.byName;
        const stroke = Math.max(-live.model.keyTravel, Math.min(0, live.spring('press').x));
        key.tz = live.state.off ? -live.model.keyTravel : stroke;
        pilot.hidden = live.state.off || stroke > -1.5;
        lens.hidden = !pilot.hidden;
      },
    },
  },
});
