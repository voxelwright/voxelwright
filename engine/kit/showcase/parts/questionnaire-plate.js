// The faceplate belongs to the deploy question. Its pilot repeats the written
// validation or receipt. Choosing a radio alone does not acknowledge an answer.
import { listeners } from '../../src/components/util.js';

export const dispatchPlate = {
  name: 'dispatch-plate',
  selector: '.dispatch-plate',
  pad: 4,
  build(live, model) {
    const { W, H } = live;
    live.faceZ = 3;
    const face = model.part('casting');
    face.slab(1, 1, 0, W - 2, H - 2, 1, 'gasket', 2);
    face.slab(0, 0, 1, W, H, 2, 'key-plate', 2);

    // The key bank supplies its own bezel and trench through this aperture.
    const plate = live.el.getBoundingClientRect();
    const bank = live.el.querySelector('.vx-toggle-group').getBoundingClientRect();
    face.carve(Math.round((bank.left - plate.left) / live.vx), Math.round((bank.top - plate.top) / live.vx), 0,
      Math.floor(bank.width / live.vx), Math.floor(bank.height / live.vx), 3);

    // A countersunk screw at either end of the front rail.
    for (const x of [2, W - 5]) {
      face.slab(x, H - 5, 2, 3, 3, 1, 'warm-metal', 1);
      face.plot(x + 1, H - 4, 2, 'gasket');
    }

    const x = W - 11, y = 6;
    face.carve(x - 1, y - 1, 2, 7, 4, 1);
    model.part('socket').box(x - 1, y - 1, 2, 7, 4, 1, 'steel').carve(x, y, 2, 5, 2, 1);
    model.part('window').box(x, y, 2, 5, 2, 1, 'lens');
  },
  pose(live) {
    const form = live.el.querySelector('fieldset');
    const signal = form.hasAttribute('data-vx-answered') ? [0.42, 0.90, 0.62]
      : form.hasAttribute('data-vx-asking') ? [1, 0.69, 0.24] : null;
    const { window: lens, socket } = live.model.byName;
    // Light scatters along the smoked window from its centre. Only the
    // bordering metal receives a reflection; the opaque case stays dark.
    lens.tint(live.theme, live.look);
    socket.tint(live.theme, live.look);
    if (signal) {
      const cx = live.W - 8.5, cy = 7;
      for (const part of [lens, socket]) {
        for (let i = 0; i < part.count; i++) {
          const dx = Math.abs(part.rest[i * 3] - cx), dy = Math.abs(part.rest[i * 3 + 1] - cy);
          const amount = (part === lens ? 0.95 : 0.22) / (1 + dx * 0.14 + dy * 0.2);
          for (let c = 0; c < 3; c++) part.col[4 * i + c] += (signal[c] - part.col[4 * i + c]) * amount;
          if (part === lens) part.col[4 * i + 3] = amount;
        }
      }
    }
    live.glows = false;
  },
  bind(live) {
    const on = listeners();
    on.watch(live.el.querySelector('fieldset'), { attributes: true, attributeFilter: ['data-vx-asking', 'data-vx-answered'] }, () => live.invalidate());
    return on.done;
  },
};
