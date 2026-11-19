// A command display captured in a thin casting. The native menu owns focus,
// placement and the assembly of the panel from the trigger's corner.
import { halo } from '../../src/core/light.js';

export const projectMenu = {
  pad: 9,
  glowRadius: 1.7,
  glowStrength: halo(0.055),

  build(live, model) {
    const { W, H, vx, el, state } = live;
    const panel = model.part('panel');
    panel.slab(1, 1, 0, W - 2, H - 2, 1, 'gasket', 1);
    panel.slab(0, 0, 1, W, H, 2, 'chalk', 2);
    // Glass sits one course below the retaining edge.
    panel.box(1, 1, 1, W - 2, H - 2, 1, 'gasket');
    panel.slab(1, 1, 2, W - 2, H - 2, 1, 'floor', 1);
    panel.slab(0, 0, 3, W, H, 1, 'slate', 2)
      .carve(2, 2, 3, W - 4, H - 4, 1);
    live.faceZ = 3;

    state.items = [...el.querySelectorAll('[role="menuitem"]')];
    const x = getComputedStyle(el).direction === 'rtl' ? W - 7 : 4;
    // A continuous recessed channel lets the lenses track scrolled commands
    // without painting a second face over the display glass.
    panel.carve(x, 2, 2, 3, H - 4, 1);
    state.centers = state.items.map(item => Math.round(item.offsetHeight / (2 * vx)));
    state.ys = state.items.map(item => Math.round(item.offsetTop / vx));
    state.lenses = state.centers.map((center, i) => {
      const fitting = model.part('lens-' + i);
      fitting.box(x, center - 1, 2, 3, 2, 1, 'lens');
      return fitting;
    });
    // Interchange the glass at the selected fitting. The emissive face is
    // the same size as the smoked face it replaces.
    for (const [name, material] of [['pick', 'light'], ['danger', 'light-stop']]) {
      model.part(name).box(x, (state.centers[0] ?? 1) - 1, 2, 3, 2, 1, material);
    }
  },

  pose(live) {
    const { state, H } = live;
    const { pick, danger } = live.model.byName;
    pick.hidden = danger.hidden = true;
    state.lenses.forEach((fitting, i) => {
      const y = state.ys[i] - (state.scrollY ?? 0);
      const mid = y + state.centers[i];
      const visible = mid >= 3 && mid <= H - 3;
      fitting.ty = y;
      fitting.hidden = !visible || state.active === i;
      if (!visible || state.active !== i) return;
      const lamp = state.items[i].dataset.vxKind === 'danger' ? danger : pick;
      lamp.ty = y + state.centers[i] - state.centers[0];
      lamp.hidden = false;
    });
  },
};
