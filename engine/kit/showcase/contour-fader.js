// The three-cell carriage runs on a guide under the faceplate. Its width
// determines travel. The ivory line sits four courses above the plate.
import { hole } from '../src/core/light.js';
import { defineMaterial } from '../src/core/materials.js';
import { watchDirection } from '../src/plain.js';
import { listeners } from '../src/components/util.js';

defineMaterial('contour-graphite', { day: '#373e39', jitter: .004 });

const leftStop = 6;
const stemWidth = 3;

export const contourFader = {
  name: 'contour-fader',
  selector: '.contour-fader',
  pad: 2,

  build(live, model) {
    const { W, H } = live;
    const y = Math.floor(H / 2) - 2;
    const width = W - leftStop - 10;
    hole(live, model, { x: leftStop, y, w: width, h: 4, depth: 2, wall: 'gasket', floor: 'key-bed' });
    const guide = model.part('guide');
    guide.sunk = true;
    guide.box(leftStop, y + 2, -2, width, 1, 1, 'slate');

    // Only the exposed edge of the punched plate catches the light.
    const lip = model.part('lip');
    lip.slab(leftStop - 1, y - 1, 0, width + 2, 6, 1, 'key-plate', 1)
      .carve(leftStop, y, 0, width, 4, 1);

    const input = live.state.input = live.el.querySelector('input');
    live.state.travel = width - stemWidth;
    live.state.rtl = getComputedStyle(input).direction === 'rtl';
    const scale = model.part('scale');
    const steps = 8; // Nine engraved positions on this instrument.
    scale.tx = -0.5; // Cancel the projection of the one-course engraving.
    for (let i = 0; i <= steps; i++) {
      const x = leftStop + 3 + Math.round(i * live.state.travel / steps);
      const h = i % 4 === 0 ? 3 : 2;
      scale.box(x, y - 5 - h, 0, 1, h, 1, 'steel');
    }

    const thumb = model.part('thumb');
    thumb.grounded = false;
    thumb.box(0, y + 1, -1, stemWidth, 2, 3, 'steel');
    thumb.slab(-4, y - 6, 2, 11, 15, 2, 'contour-graphite', 2);
    // Raised cheeks leave a shallow saddle for the fingertip.
    for (const x of [-3, 5]) thumb.box(x, y - 5, 4, 1, 13, 1, 'contour-graphite');
    thumb.box(1, y - 5, 3, 1, 13, 1, input.matches(':disabled') ? 'slate' : 'ivory');
  },

  pose({ state, model }) {
    const { input, travel, rtl } = state;
    const min = Number(input.min || 0), max = Number(input.max || 100);
    const t = max > min ? (input.valueAsNumber - min) / (max - min) : 0;
    model.byName.thumb.tx = leftStop + Math.round((rtl ? 1 - t : t) * travel);
  },

  bind(live) {
    const input = live.el.querySelector('input');
    const on = listeners();
    watchDirection(live, on);
    on(input, 'input', () => live.invalidate());
    on.heed(input, 'value', () => live.invalidate());
    on.watch(input, { attributes: true, attributeFilter: ['disabled', 'value', 'min', 'max', 'dir'] }, () => live.rebuild());
    return on.done;
  },
};
