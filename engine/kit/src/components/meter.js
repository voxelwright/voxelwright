// Meter. Two kinds.
//   plain:  a channel that fills with leaf, one column of voxels at a time.
//   growth: a plant in a pot. The value is how far along its life it is.
// Markup: <span class="vx-meter"><progress value="3" max="5">3 of 5</progress></span>
//         <span class="vx-meter" data-vx-kind="growth" data-vx-seed="4"><progress value="0.6"></progress></span>

import { plant, pot } from '../core/plant.js';
import { CALM } from '../core/motion.js';
import { listeners, clamp } from './util.js';

const read = (el) => {
  const p = el.querySelector('progress, meter');
  if (!p) return Number(el.dataset.vxValue || 0);
  const max = Number(p.getAttribute('max') || p.max || 1), min = Number(p.getAttribute('min') || 0);
  return clamp((Number(p.getAttribute('value') ?? p.value) - min) / (max - min || 1), 0, 1);
};

export const meter = {
  name: 'meter',
  selector: '.vx-meter',
  pad: 8,

  build(live, m) {
    const { W, H, el } = live;
    const growth = live.state.growth = el.dataset.vxKind === 'growth';
    const v = read(el);
    const s = live.spring('v', v, CALM.k, CALM.c);
    if (live.state.built === undefined) s.snap(v);
    live.state.built = true;
    live.state.posed = false;
    if (growth) {
      const potW = 7, x = Math.floor((W - potW) / 2), base = H - 6;
      pot(m.part('pot'), x, base, 0, potW, el.dataset.vxPot || 'brick');
      const p = m.part('plant');
      p.grounded = false;
      plant(p, { x: x + 3, base, z: 2, seed: Number(el.dataset.vxSeed || 1), height: Math.max(8, Math.min(22, base - 6)), petal: el.dataset.vxPetal });
      live.faceZ = 0;
    } else {
      const y = Math.floor((H - 5) / 2);
      m.part('rail').slab(0, y, 0, W, 5, 2, 'steel', 1).carve(1, y + 1, 1, W - 2, 3, 1);
      m.part('floor').box(1, y + 1, 0, W - 2, 3, 1, 'slate');
      const fill = m.part('fill');
      fill.grounded = false;
      const n = W - 2;
      for (let i = 0; i < n; i++) for (let j = 0; j < 3; j++) for (let k = 1; k <= 2; k++) fill.plot(1 + i, y + 1 + j, k, el.dataset.vxMaterial || 'leaf', (i + 0.5) / n);
      live.faceZ = 2;
    }
  },

  pose(live) {
    // first drawing: show the value as it is, with no growing in
    if (!live.state.posed) { live.state.posed = true; meter.step(live, 0); }
  },

  step(live, dt) {
    const v = live.spring('v').x;
    const part = live.state.growth ? live.model.byName.plant : live.model.byName.fill;
    return part.grow(v + 0.0001, dt);
  },

  bind(live) {
    const on = listeners();
    const set = () => { live.spring('v').to(read(live.el)); live.invalidate(); };
    on.watch(live.el, { attributes: true, subtree: true, attributeFilter: ['value', 'max', 'data-vx-value'] }, set);
    on.watch(live.el, { attributes: true, attributeFilter: ['data-vx-kind', 'data-vx-seed', 'data-vx-petal', 'data-vx-pot'] }, () => live.rebuild());
    return on.done;
  },
};
