// The short command key in the SD–01 header. The switch and its mounting
// flange stay on the panel while the stem and keytop move together.
import { defineMaterial } from '../src/core/materials.js';
import { button } from '../src/components/button.js';

defineMaterial('scan-flange', { day: '#68323b', jitter: .006 });
defineMaterial('scan-carbon', { day: '#303635', jitter: .01 });

export const scanKey = {
  ...button,
  name: 'scan-key',
  selector: '#scan',
  momentary: true,
  pad: 15,
  soft: .3,

  plain(el, on) {
    const reset = button.plain(el, on, {
      momentary: true,
      push: () => el.setAttribute('data-held', ''),
      lift: () => el.removeAttribute('data-held'),
    });
    return () => { reset(); el.removeAttribute('data-held'); };
  },

  build(live, model) {
    const { W, H, look } = live;
    if (W < 24 || H < 14) return;
    const high = look.rise >= 6;
    model.keyTravel = high ? 7 : 4;
    const bottom = 4 + model.keyTravel;
    const courses = high ? 5 : 3;
    const shaftX = Math.floor(W / 2) - 5, shaftY = Math.floor(H / 2) - 3;
    const plate = model.part('flange');
    plate.slab(0, 0, 0, W, H, 2, 'scan-flange', 3);
    plate.carve(shaftX, shaftY, 0, 10, 6, 2);
    const guide = model.part('housing');
    guide.slab(5, 3, 2, W - 10, H - 6, 2, 'slate', 2);
    // The guide continues inside the panel for the full stroke.
    guide.box(shaftX - 1, shaftY - 1, -model.keyTravel, 12, 8, model.keyTravel, 'gasket');
    guide.carve(shaftX, shaftY, -model.keyTravel, 10, 6, model.keyTravel);
    guide.carve(shaftX, shaftY, 2, 10, 6, 2);
    for (const x of [3, W - 5]) guide.box(x, shaftY, 2, 2, 6, 1, 'warm-metal');

    // A fixed switch LED under the shell shows through the opal finish.
    guide.box(shaftX + 2, shaftY - 3, 3, 6, 2, 1, 'backlight');

    const stem = model.part('stem');
    stem.grounded = false;
    stem.box(shaftX, shaftY, 0, 10, 6, bottom, 'gasket');
    const cap = model.part('cap');
    cap.grounded = false;
    cap.mouldRadius = high ? 3 : 2;
    // A broad finger bed with a shallow cylindrical dish. Only the shoulders
    // turn up. The middle stays level under the printed legend.
    const finish = document.documentElement.dataset.caps;
    const resin = finish === 'field' ? 'scan-carbon' : 'key';
    for (let z = 0; z < courses; z++) {
      const inset = Math.floor(z / 2);
      cap.slab(2 + inset, 1 + inset, bottom + z, W - 4 - 2 * inset, H - 3 - 2 * inset, 1, resin, 3);
    }
    cap.carve(shaftX + 3, shaftY, bottom, 4, 6, 1);
    cap.carve(shaftX, shaftY + 2, bottom, 10, 2, 1);
    stem.box(shaftX + 3, shaftY, bottom, 4, 6, 1, 'enamel');
    stem.box(shaftX, shaftY + 2, bottom, 10, 2, 1, 'enamel');
    const edge = 2 + Math.floor((courses - 1) / 2);
    for (let x = edge + 1; x < W - edge - 1; x++) {
      const u = Math.abs(2 * (x + .5) / W - 1);
      const lip = Math.round((high ? 3 : 2) * u ** 3);
      if (lip) cap.box(x, edge + 1, bottom + courses, 1, H - 2 * edge - 3, lip, resin);
    }
    live.glowStrength = 0; // The emitter lives under the keytop.
    live.faceZ = bottom + courses;
    live.label(live.el.querySelector('.vx-label'), () => live.faceZ + cap.tz);
  },

  pose(live) {
    const { cap, stem } = live.model.byName;
    if (cap) cap.tz = stem.tz = Math.max(-live.model.keyTravel, live.spring('press').x);
  },
};
