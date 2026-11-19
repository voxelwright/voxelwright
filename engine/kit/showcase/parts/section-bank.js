// Five momentary paddles with independently powered pilots in a fixed escutcheon.
import { halo, byTheme } from '../../src/core/light.js';
import { tableOf } from '../../src/core/look.js';
import { MATERIALS } from '../../src/core/materials.js';
import { PRESS, RELEASE, reducedMotion } from '../../src/core/motion.js';
import { cue } from '../../src/core/sound.js';
import { listeners } from '../../src/components/util.js';

function strokes(el, on, live) {
  for (const [i, link] of [...el.querySelectorAll('a')].entries()) {
    let owner = null;
    const travel = live?.spring('stroke' + i);
    function move(down, instant) {
      if (!travel) return;
      const target = down ? -live.state.travel : 0;
      const spring = down ? PRESS : RELEASE;
      if (instant || reducedMotion()) travel.snap(target);
      else {
        if (down) travel.x = Math.min(travel.x, target * .36);
        travel.to(target, spring.k, spring.c);
      }
      live.invalidate();
    }
    function press(id) {
      if (owner !== null) return;
      owner = id;
      move(true, id === 'Enter');
      cue('press');
    }
    function release(id, audible) {
      if (owner === null || owner !== id) return;
      owner = null;
      move(false, id === 'Enter');
      if (audible) cue('release');
    }
    on(link, 'pointerdown', e => { if (e.button === 0) press(e.pointerId); });
    on(link, 'pointerup', e => release(e.pointerId, true));
    on(link, 'pointercancel', e => release(e.pointerId, false));
    on(link, 'pointerleave', e => release(e.pointerId, false));
    on(link, 'keydown', e => { if (e.key === 'Enter' && !e.repeat) press(e.key); });
    on(link, 'keyup', e => release(e.key, true));
    on(link, 'blur', () => release(owner, false));
  }
}

export const sectionBank = {
  name: 'settings-selector',
  selector: '#sections',
  plain: strokes,

  build(live, model) {
    const { el, W, H, vx } = live;
    const rtl = getComputedStyle(el).direction === 'rtl';
    const plate = model.part('plate');
    const lens = model.part('lens');
    const collars = model.part('collars');
    const capX = rtl ? 5 : 15;
    const capW = W - 20;
    const lampX = rtl ? W - 10 : 7;
    const rise = live.look.rise > 3 ? 5 : 4;
    live.state.travel = rise - 3;
    live.faceZ = 3;
    plate.slab(0, 0, 0, W, H, 3, 'chalk', 2);
    for (const y of [2, H - 4]) {
      for (const x of [3, W - 6]) {
        plate.box(x, y, 2, 3, 2, 1, 'steel').plot(x + 1, y, 2, 'gasket');
      }
    }
    live.state.rows = [...el.querySelectorAll('li')].map((li, i) => {
      const y = Math.round(li.offsetTop / vx);
      const h = Math.round(li.offsetHeight / vx);
      const lampY = y + Math.floor((h - 6) / 2);
      // The gasket lines the pocket. Its floor supports the paddle at full travel.
      plate.carve(capX - 1, y, 1, capW + 2, h, 2);
      plate.box(capX - 1, y, 0, capW + 2, h, 1, 'gasket');
      const paddle = model.part('paddle' + i);
      // A recessed plunger carries the hollow skirt. At the stop the skirt meets the floor.
      const stemX = capX + Math.floor(capW / 2) - 2;
      const stemY = y + Math.floor(h / 2) - 2;
      plate.box(stemX - 1, stemY - 1, 1, 6, 6, 2, 'slate')
        .carve(stemX, stemY, 1, 4, 4, 2);
      paddle.slab(capX, y + 1, rise - 2, capW, h - 3, 2, 'key', 2)
        .carve(capX + 2, y + 4, rise - 2, capW - 4, h - 8, 2);
      paddle.box(stemX, stemY, rise - 2, 4, 4, 2, 'gasket');
      paddle.slab(capX + 1, y + 2, rise, capW - 2, h - 5, 1, 'key', 1);
      const gripX = rtl ? capX + 5 : capX + capW - 11;
      paddle.box(gripX, y + h - 7, rise + 1, 6, 1, 1, 'key');
      paddle.grounded = false;
      const spring = live.spring('stroke' + i);
      live.label(li.querySelector('span'), () => rise + 1 + spring.x);
      collars.slab(lampX - 1, lampY - 1, 3, 5, 8, 1, 'steel', 1)
        .carve(lampX, lampY, 3, 3, 6, 1);
      lens.box(lampX, lampY, 3, 3, 6, 1, 'pilot-glass');
      return { link: li.querySelector('a'), paddle, spring, lampY };
    });
    live.state.lampX = lampX;
    live.state.current = undefined;
  },

  pose(live) {
    const { rows, lampX } = live.state;
    for (const { paddle, spring } of rows) paddle.tz = spring.x;
    const selected = rows.find(row => row.link.getAttribute('aria-current') === 'page');
    if (selected === live.state.current && live.state.tint === live.tintRevision) return;
    live.state.current = selected;
    live.state.tint = live.tintRevision;
    const { lens, collars } = live.model.byName;
    const source = tableOf(live.look)[MATERIALS.light.id][live.theme];
    for (const part of [lens, collars]) {
      part.tint(live.theme, live.look);
      if (!selected) continue;
      for (let i = 0; i < part.count; i++) {
        const x = part.rest[i * 3] - lampX - 1.5;
        const y = part.rest[i * 3 + 1] - selected.lampY - 3;
        if (Math.abs(y) > 4) continue;
        // Frost carries the bright core to the edges; the metal returns a faint reflection.
        const strength = (part === lens ? .98 : .21) / (1 + .11 * x * x + .055 * y * y);
        for (let c = 0; c < 3; c++) {
          const k = i * 4 + c;
          part.col[k] += (source[c] - part.col[k]) * strength;
        }
        if (part === lens) part.col[i * 4 + 3] = strength;
      }
    }
    live.glows = !!selected;
    live.glowStrength = halo(.05) * byTheme(live);
    live.glowRadius = 2.8;
  },

  bind(live) {
    const on = listeners();
    strokes(live.el, on, live);
    on.watch(live.el, { subtree: true, attributes: true, attributeFilter: ['aria-current', 'dir'] }, changes => {
      if (changes.some(change => change.attributeName === 'dir')) live.rebuild();
      else live.invalidate();
    });
    return on.done;
  },
};
