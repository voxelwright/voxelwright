// The build log's G915-style memory key. The metal shoulder carries its own pilot.
import { toggleButton } from '../../src/components/toggle-button.js';
import { defineMaterial } from '../../src/core/materials.js';
import { button } from '../../src/components/button.js';
import { wrapLabel } from '../../src/components/util.js';

defineMaterial('times-deck', { day: '#535a5c', night: '#495257', jitter: 0.006,
  grain: (_, y) => 0.013 * Math.sin(y * 2.7) });
defineMaterial('times-rubber', { day: '#26292a', night: '#292d2e', jitter: 0.006 });
defineMaterial('times-collar', { day: '#424645', jitter: 0.004 });

// Cut the socket and the cap with the same racetrack profile.
function rows(x, y, w, h, draw) {
  const r = h / 2;
  for (let i = 0; i < h; i++) {
    const end = Math.round(r - Math.sqrt(r * r - (i + 0.5 - r) ** 2));
    draw(x + end, y + i, w - 2 * end);
  }
}

export const timesKey = {
  ...toggleButton,
  name: 'times-key',
  selector: '#times',
  soft: 0.28,
  pad: 6,

  plain(el, on) {
    toggleButton.plain(el, on);
    wrapLabel(el);
    button.plain(el, on, {
      momentary: true,
      push: () => el.toggleAttribute('data-held', true),
      lift: () => el.removeAttribute('data-held'),
    });
  },

  build(live, m) {
    const { W, H, el, state } = live;
    live.faceZ = 5;
    const h = H - 8, w = W - 16, x = 2, y = 3;
    const deck = m.part('plate');
    deck.slab(0, 1, 0, W, H - 2, 3, 'times-deck', 2);
    rows(x - 1, y - 1, w + 2, h + 2, (xx, yy, width) => {
      deck.carve(xx, yy, 1, width, 1, 2);
      deck.box(xx, yy, 0, width, 1, 1, 'key-bed');
    });
    const cap = m.part('cap');
    cap.grounded = false;
    cap.mouldRadius = 2;
    // The skirt stays in the opening. Only the last course rolls in at the edge.
    rows(x, y, w, h, (xx, yy, width) => cap.box(xx, yy, 4, width, 1, 4, 'times-rubber'));
    rows(x + 1, y + 1, w - 2, h - 2, (xx, yy, width) => cap.box(xx, yy, 8, width, 1, 1, 'times-rubber'));
    const stem = m.part('stem');
    stem.grounded = false;
    const cx = x + Math.floor(w / 2) - 2, cy = y + Math.floor(h / 2) - 2;
    deck.carve(cx, cy, 0, 5, 5, 1);
    stem.box(cx, cy, -1, 5, 5, 5, 'key-bed');

    const lx = W - 6, ly = Math.floor(H / 2) - 1;
    const collar = m.part('collar');
    rows(lx - 3, ly - 3, 6, 6, (xx, yy, width) => {
      deck.carve(xx, yy, 1, width, 1, 2);
      collar.box(xx, yy, 1, width, 1, 2, 'times-collar');
    });
    const lens = m.part('lens');
    rows(lx - 2, ly - 2, 4, 4, (xx, yy, width) => {
      collar.carve(xx, yy, 1, width, 1, 2);
      lens.box(xx, yy, 1, width, 1, 1, 'pilot-glass');
    });
    m.keyTravel = 2;
    m.keyStop = 3;
    state.off = el.matches(':disabled,[aria-disabled="true"]');
    const on = el.getAttribute('aria-pressed') === 'true';
    live.spring('press').snap(state.held && !state.off ? -m.keyStop : on ? -m.keyTravel : 0);
    state.lit = Number(on);
    state.lensPower = null;
    live.label(wrapLabel(el), () => 9 + cap.tz);
  },

  pose(live) {
    const { cap, stem, lens, collar } = live.model.byName;
    // Three courses to the stop, two to the latch, one left to release it.
    cap.tz = stem.tz = Math.max(-3, Math.min(0, live.spring('press').x));
    const power = live.state.off ? 0 : live.state.lit;
    if (power === live.state.lensPower && live.state.tint === live.tintRevision) return;
    live.state.lensPower = power;
    live.state.tint = live.tintRevision;
    const amber = [1, .73, .26];
    for (const part of [lens, collar]) {
      const glass = part === lens;
      const base = glass ? [.42, .44, .39] : [.25, .27, .27];
      for (let i = 0; i < part.count; i++) {
        // The glass transmits. Only the metal at its perimeter catches a reflection.
        const distance = Math.hypot(part.rest[3 * i] - (live.W - 6),
          part.rest[3 * i + 1] - (Math.floor(live.H / 2) - 1));
        const mix = power * (glass ? 1 - .09 * distance : .30 / (1 + distance ** 2 * .25));
        for (let j = 0; j < 3; j++) part.col[4 * i + j] = base[j] + (amber[j] - base[j]) * mix;
        part.col[4 * i + 3] = glass ? power * .85 : 0;
      }
    }
    live.glows = false;
  },
};
