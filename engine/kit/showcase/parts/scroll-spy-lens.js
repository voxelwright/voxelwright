// One fixed window per link. The diode sits inside a smoked light pipe with a
// steel retaining lip. Reading position only changes its supply.
export const readingLens = {
  name: 'reading-lens',
  selector: '#toc > a > .reading-lens',
  pad: 2,
  glowStrength: 0,

  build(live, model) {
    const { W, H } = live;
    const lip = model.part('lip');
    lip.slab(0, 0, 0, W, H, 1, 'steel', 1)
      .carve(1, 1, 0, W - 2, H - 2, 1);
    model.part('liner').box(1, 1, 0, W - 2, H - 2, 1, 'gasket')
      .carve(2, 2, 0, W - 4, H - 4, 1);
    const diode = model.part('diode');
    diode.grounded = false;
    diode.box(2, H / 2 - 1, -1, W - 4, 2, 1, 'light');
    model.part('glass').box(2, 2, 0, W - 4, H - 4, 1, 'lens');
    live.faceZ = 1;
  },

  pose(live) {
    const on = live.el.parentElement.getAttribute('aria-current') === 'location';
    if (live.state.on === on && live.state.tint === live.tintRevision && live.state.model === live.model) return;
    live.state.on = on;
    live.state.tint = live.tintRevision;
    live.state.model = live.model;
    const { diode, glass, lip } = live.model.byName;
    diode.tint(live.theme, live.look);
    const source = diode.col.slice(0, 3);
    for (const part of [glass, lip]) {
      part.tint(live.theme, live.look);
      if (!on) continue;
      for (let i = 0; i < part.count; i++) {
        const y = part.rest[i * 3 + 1];
        const distance = Math.abs(y - live.H / 2);
        // Frost carries the light along the window. Only the adjacent metal
        // catches a weak reflection; the black liner absorbs it.
        const mix = (part === glass ? 0.97 : 0.18) / (1 + 0.04 * distance ** 2);
        const core = part === glass ? Math.max(0, 1 - distance / 2.5) * 0.55 : 0;
        for (let c = 0; c < 3; c++) {
          const k = i * 4 + c;
          const light = source[c] + (1 - source[c]) * core;
          part.col[k] += (light - part.col[k]) * mix;
        }
        if (part === glass) part.col[i * 4 + 3] = mix;
      }
    }
    if (!on) diode.col.fill(0);
    live.glows = false;
  },

  bind(live) {
    const observer = new MutationObserver(() => live.invalidate());
    observer.observe(live.el.parentElement, { attributes: true, attributeFilter: ['aria-current'] });
    return () => observer.disconnect();
  },
};
