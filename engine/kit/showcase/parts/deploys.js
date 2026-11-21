// The Services readout lives below a narrow alloy retaining strip.
import { button } from '../../src/components/button.js';
import { pilot, ring } from '../../src/core/light.js';

export const displayRim = {
  name: 'deploys-rim',
  selector: '#deploys > .vx-table > .display-rim',
  build({ W, H }, m) {
    const rail = m.part('rim');
    // Four bars leave the reading field open at every viewport width.
    rail.box(1, 0, 0, W - 2, 1, 2, 'slate');
    rail.box(1, H - 1, 0, W - 2, 1, 2, 'slate');
    rail.box(0, 1, 0, 1, H - 2, 2, 'slate');
    rail.box(W - 1, 1, 0, 1, H - 2, 2, 'slate');
    for (const x of [1, W - 2]) for (const y of [1, H - 2]) rail.plot(x, y, 1, 'steel');
  },
};

export const idlePilot = {
  name: 'deploys-idle-pilot',
  selector: '#deploys .idle-pilot',
  build(live, m) {
    pilot(m, live.W, live.H, 'lens');
    live.faceZ = 2;
  },
};

export const sortKey = {
  ...button,
  name: 'deploys-sort-key',
  selector: '#deploys thead .vx-data-table-sort',
  momentary: true,
  pad: 3,
  glowRadius: 1.6,
  glowStrength: .014,
  bind(live) {
    const release = button.bind(live);
    const watch = new MutationObserver(() => live.rebuild());
    watch.observe(live.el.parentElement, { attributes: true, attributeFilter: ['aria-sort'] });
    return () => { watch.disconnect(); release(); };
  },
  plain(el, on) { return button.plain(el, on, { momentary: true }); },
  build(live, m) {
    const { W, H } = live;
    // The contact bed and paired direction windows are stamped into one carrier.
    const mount = m.part('mount');
    mount.slab(1, 2, 0, W - 2, H - 4, 2, 'slate', 1);
    const width = W - 13;
    const rise = live.look.rise >= 6 ? 5 : 4;
    m.keyTravel = rise - 3;
    ring(mount, 2, 3, 2, width + 2, H - 6, 'gasket', 1);
    mount.carve(3, 4, 0, width, H - 8, 2);
    // The sleeve runs below the carrier. Its bore stays clear at bottom-out.
    const shaft = Math.floor(width / 2) + 2, guideY = Math.floor(H / 2) - 1;
    mount.box(shaft - 1, guideY - 1, -5, 5, 5, 5, 'gasket');
    mount.carve(shaft, guideY, -5, 3, 3, 5);
    const cap = m.part('cap');
    cap.grounded = false;
    cap.box(shaft, guideY, -2, 3, 3, 4, 'steel');
    cap.slab(3, 4, 2, width, H - 8, rise - 2, 'key', 1);
    cap.slab(4, 5, rise, width - 2, H - 10, 1, 'key', 1);
    live.state.top = live.faceZ = rise + 1;
    live.label(live.el.querySelector('.vx-label'), () => live.faceZ + cap.tz);

    const sort = live.el.parentElement.getAttribute('aria-sort');
    const cx = W - 6, mid = Math.floor(H / 2);
    const collar = m.part('collar');
    collar.slab(cx - 3, mid - 5, 2, 7, 11, 1, 'slate', 1);
    live.state.source = null;
    live.state.litRevision = null;
    for (const [direction, sign] of [['ascending', -1], ['descending', 1]]) {
      const on = sort === direction;
      const lens = m.part(direction);
      for (let row = 0; row < 3; row++) {
        const y = mid + sign * (4 - row);
        // A smoked arrow window is always fitted. Only the selected die is powered.
        collar.carve(cx - row, y, 2, row * 2 + 1, 1, 1);
        lens.box(cx - row, y, 2, row * 2 + 1, 1, 1, on ? 'lamp' : 'key-bed');
        if (on && row === 2) lens.plot(cx, y, 2, 'light-warm');
      }
      if (on) live.state.source = [cx + .5, mid + sign * 3 + .5];
    }
  },
  pose(live) {
    button.pose(live);
    const { source } = live.state;
    if (!source || live.state.litRevision === live.tintRevision) return;
    // The opaque divider keeps the other window dark. Only the metal beside
    // the powered window picks up its warm light, strongest along the cut edge.
    const { collar } = live.model.byName;
    for (let i = 0; i < collar.count; i++) {
      const x = collar.rest[i * 3], y = collar.rest[i * 3 + 1];
      const distance = Math.hypot(x - source[0], y - source[1]);
      const spill = .24 * Math.max(0, 1 - distance / 4);
      for (const [channel, value] of [1, .81, .5].entries()) {
        const k = i * 4 + channel;
        collar.col[k] += (value - collar.col[k]) * spill;
      }
    }
    live.state.litRevision = live.tintRevision;
  },
};
