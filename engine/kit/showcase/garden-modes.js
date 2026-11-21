// Three momentary switches on one plate. The lamp remembers the mode after the cap returns.
import { define, defineLook, cue, listeners, wrapLabel, PRESS, RELEASE } from '../src/index.js';
import { chooseTab, keyTarget, tabKeys, watchDirection } from '../src/plain.js';
import { reducedMotion } from '../src/core/motion.js';

defineLook('garden-modes', {
  seam: 0.18,
  materials: {
    steel: { day: '#797a6c', night: '#54594e', jitter: 0.007 },
    gasket: { day: '#282b28', night: '#242724' },
    key: { day: '#383b36', night: '#393c37', jitter: 0.005 },
    lens: { day: '#505144', night: '#484b3f' },
    'light-warm': { day: '#b99759', night: '#a78650', glow: 0.18 },
    signal: { day: '#ffc45b', night: '#ffbf55', glow: 0.7 },
  },
  finishes: {
    steel: { chamfer: 55, specular: 100 }, key: { chamfer: 65, specular: 20 },
    lens: { chamfer: 65, specular: 130 }, signal: { chamfer: 65, specular: 90 },
  },
  light: { day: { glow: 0.32 }, night: { glow: 0.48 } },
});

function wire(el, on, live) {
  const keys = [...el.querySelectorAll('[role="tab"]')];
  if (!live) keys.forEach(key => wrapLabel(key));
  const current = () => keys.findIndex(key => key.getAttribute('aria-selected') === 'true');
  chooseTab(keys, current());
  function choose(index) {
    if (index === current()) return;
    chooseTab(keys, index);
    live?.invalidate();
    el.dispatchEvent(new CustomEvent('vx-change', { bubbles: true, detail: { index } }));
  }
  on(el, 'click', e => {
    const index = keys.indexOf(e.target.closest('[role="tab"]'));
    if (index >= 0) choose(index);
  });
  on(el, 'keydown', e => {
    const index = keyTarget(e.key, current(), keys.length, tabKeys(el));
    if (index < 0) return;
    e.preventDefault();
    choose(index);
    keys[index].focus();
  });

  let pointer = null, held = -1, heldKey = null;
  function stroke(index, down, instant = false) {
    if (live) {
      const spring = live.spring('cap' + index);
      const { k, c } = down ? PRESS : RELEASE;
      const z = down ? -3 : 0;
      if (instant || reducedMotion()) spring.snap(z);
      else spring.to(z, k, c);
      live.invalidate();
    } else {
      keys[index].toggleAttribute('data-held', down);
    }
    cue(down ? 'press' : 'release');
  }
  function release() {
    if (held >= 0) stroke(held, false, pointer === null);
    held = -1;
    heldKey = null;
    pointer = null;
  }
  on(el, 'pointerdown', e => {
    const index = keys.indexOf(e.target.closest('[role="tab"]'));
    if (index < 0 || held >= 0 || !e.isPrimary || e.button !== 0) return;
    pointer = e.pointerId;
    held = index;
    stroke(index, true);
  });
  for (const event of ['pointerup', 'pointercancel']) on(window, event, e => {
    if (pointer === e.pointerId) release();
  });
  const activation = e => e.key === 'Enter' || e.key === ' ';
  on(el, 'keydown', e => {
    const index = keys.indexOf(e.target);
    if (index >= 0 && activation(e) && !e.repeat && held < 0) {
      held = index;
      heldKey = e.key;
      stroke(index, true, true);
    }
  });
  on(el, 'keyup', e => { if (heldKey === e.key) release(); });
  on(el, 'focusout', () => { if (pointer === null) release(); });
  on(window, 'blur', release);
}

define({
  name: 'garden-modes',
  selector: '#garden-modes',
  plain: wire,
  bind(live) {
    const on = listeners();
    watchDirection(live, on);
    wire(live.el, on, live);
    return on.done;
  },
  build(live, model) {
    const { W, H, vx } = live;
    const plate = model.part('plate');
    plate.slab(0, 0, 0, W, H, 1, 'gasket', 2);
    plate.slab(0, 0, 1, W, H, 3, 'steel', 2);
    live.faceZ = 9;
    live.state.seats = [...live.el.querySelectorAll('[role="tab"]')].map((button, i) => {
      const x = Math.round(button.offsetLeft / vx) + 1;
      const w = Math.round((button.offsetLeft + button.offsetWidth) / vx) - x - 1;
      const y = Math.round(button.offsetTop / vx), h = H - y - 2;
      plate.carve(x, y, 1, w, h, 3);
      const cap = model.part('cap' + i);
      cap.grounded = false;
      // The skirt fills the opening. Only its upper shoulder narrows to the finger surface.
      cap.slab(x + 1, y + 1, 4, w - 2, h - 2, 3, 'key', 2);
      cap.slab(x + 2, y + 2, 7, w - 4, h - 4, 2, 'key', 2);
      cap.mouldRadius = 1;
      const mid = x + Math.floor(w / 2);
      const stemY = y + Math.floor(h / 2) - 3;
      plate.box(mid - 5, stemY, 1, 10, 6, 3, 'gasket');
      // The cap's hollow underside clears the switch housing at bottom-out.
      cap.carve(x + 3, y + 3, 4, w - 6, h - 6, 3);
      plate.carve(mid - 2, stemY + 1, 1, 4, 4, 3);
      cap.box(mid - 2, stemY + 1, 4, 4, 4, 3, 'key');
      plate.box(mid - 5, 1, 3, 10, 4, 1, 'gasket');
      plate.carve(mid - 4, 2, 3, 8, 2, 1);
      const lenses = ['lens', 'signal'].map(material =>
        model.part(material + i).box(mid - 4, 2, 3, 8, 2, 1, material));
      lenses[1].box(mid - 4, 2, 3, 1, 2, 1, 'light-warm');
      lenses[1].box(mid + 3, 2, 3, 1, 2, 1, 'light-warm');
      const spring = live.spring('cap' + i);
      live.label(wrapLabel(button), () => live.faceZ + cap.tz);
      return { button, cap, lenses, spring };
    });
  },
  pose(live) {
    for (const { button, cap, lenses, spring } of live.state.seats) {
      cap.tz = spring.x;
      const selected = button.getAttribute('aria-selected') === 'true';
      lenses[0].hidden = selected;
      lenses[1].hidden = !selected;
    }
  },
});
