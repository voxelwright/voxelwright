// Flush status jewel. The steel ferrule captures the smoked lens around a small central die.
export const markerPilot = {
  name: 'marker-pilot',
  selector: '#new .marker-pilot',
  pad: 2,
  glowStrength: 0,
  build(live, model) {
    const on = live.el.closest('#new').dataset.vxKind === 'new';
    live.well = [0, 0, 13, 9];
    model.part('ferrule').slab(0, 0, -3, 13, 9, 1, 'steel', 3);
    model.part('seat').slab(1, 1, -2, 11, 7, 1, 'gasket', 2).carve(5, 3, -2, 3, 3, 1);
    model.part('lens').slab(2, 2, -1, 9, 5, 1, 'lens', 2);
    model.part('die').box(5, 3, -2, 3, 3, 1, on ? 'light' : 'lens');
    for (const part of model.parts) {
      part.grounded = false;
      part.sunk = true;
    }
    live.faceZ = 0;
    live.state.tint = null;
  },
  pose(live) {
    if (live.state.tint === live.tintRevision) return;
    live.state.tint = live.tintRevision;
    const { die, lens, ferrule } = live.model.byName;
    // Frost spreads light inside the lens. Only a small reflection reaches the metal.
    if (die.col[3] === 0) return;
    for (const part of [lens, ferrule]) {
      for (let i = 0; i < part.count; i++) {
        const dx = part.rest[i * 3] - 6.5, dy = part.rest[i * 3 + 1] - 4.5;
        const falloff = 1 / (1 + .09 * dx * dx + .18 * dy * dy);
        const amount = (part === lens ? .94 : .28) * falloff;
        const core = part === lens ? .22 * falloff ** 2 : 0;
        for (let c = 0; c < 3; c++) {
          const at = 4 * i + c;
          const light = die.col[c] + (1 - die.col[c]) * core;
          part.col[at] += (light - part.col[at]) * amount;
        }
        if (part === lens) part.col[i * 4 + 3] = amount * die.col[3];
      }
    }
    live.glows = false;
  },
  bind(live) {
    const watch = new MutationObserver(() => live.rebuild());
    watch.observe(live.el.closest('#new'), { attributes: true, attributeFilter: ['data-vx-kind'] });
    return () => watch.disconnect();
  },
};
