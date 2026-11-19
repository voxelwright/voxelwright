// The deploy selector is one drilled rail. A number latches, its lamp stays in
// the rail, and the two end keys always return. The DOM owns every hit target.
import { watchDirection } from '../../src/plain.js';
import { halo } from '../../src/core/light.js';
import { PRESS, RELEASE, reducedMotion } from '../../src/core/motion.js';
import { cue } from '../../src/core/sound.js';
import { listeners, wrapLabel } from '../../src/components/util.js';

function move(seat, down, instant) {
  const to = down ? -seat.travel : 0;
  const { k, c } = down ? PRESS : RELEASE;
  if (instant || reducedMotion()) seat.spring.snap(to);
  else seat.spring.to(to, k, c);
}

function wireKeys(el, on, live) {
  let held;
  function press(e, source) {
    const a = e.target.closest('a[href]');
    if (!a || held || a.hasAttribute('aria-current')) return;
    const seat = live?.state.seats.find(s => s.a === a);
    held = { key: a.rel || a.hash, source };
    if (live) live.state.heldKey = held.key;
    if (seat) {
      seat.spring.x = Math.min(seat.spring.x, -seat.travel * .4);
      move(seat, true, source === 'Enter');
      live.invalidate();
    }
    cue('press');
  }
  function release(source) {
    if (!held || held.source !== source) return;
    const seat = live?.state.seats.find(s => s.key === held.key);
    if (!seat && live) live.spring(held.key).snap(0);
    held = null;
    if (live) live.state.heldKey = null;
    if (seat) move(seat, seat.a.matches('[aria-current], [aria-disabled="true"]'), source === 'Enter');
    live?.invalidate();
    cue('release');
  }
  on(el, 'pointerdown', e => { if (e.isPrimary && e.button === 0) press(e, e.pointerId); });
  for (const event of ['pointerup', 'pointercancel', 'pointerleave']) on(el, event, e => release(e.pointerId));
  on(el, 'keydown', e => { if (e.key === 'Enter' && !e.repeat) press(e, e.key); });
  on(window, 'keyup', e => release(e.key));
  on(window, 'blur', () => release(held?.source));
}

export const deployPager = {
  name: 'deploy-pager',
  selector: '#pager',
  glowRadius: 1.7,
  glowStrength: halo(.042),

  build(live, model) {
    const { el, W, H, vx } = live;
    const travel = live.look.travel >= 3 ? 3 : 2;
    const deck = 3 + travel;
    const plate = model.part('rail').slab(0, 0, 0, W, H, deck, 'slate', 2);
    const bed = model.part('switch-bed');
    live.state.windowTint = -1;
    const bounds = el.getBoundingClientRect();
    live.faceZ = deck + travel + 1;
    live.state.seats = Array.from(el.querySelectorAll('a')).filter(a => a.offsetWidth).map((a, i) => {
      const r = a.getBoundingClientRect();
      const x = Math.round((r.left - bounds.left) / vx);
      const y = Math.round((r.top - bounds.top) / vx);
      const w = Math.round(r.width / vx);
      const h = Math.round(r.height / vx);
      const current = a.getAttribute('aria-current') === 'page';
      const arrow = !!a.rel;
      const disabled = !a.hasAttribute('href');
      const keyHeight = h - (arrow ? 4 : 6);
      plate.carve(x + 1, y + 1, 1, w - 2, keyHeight + 2, deck - 1);
      bed.box(x + 1, y + 1, 1, w - 2, keyHeight + 2, 1, 'gasket');
      const part = model.part('cap' + i);
      part.grounded = false;
      part.mouldRadius = 2;
      // The skirt remains inside its socket even at the upper travel stop.
      part.slab(x + 2, y + 2, deck - 1, w - 4, keyHeight, travel + 1, disabled ? 'steel' : 'key', 2);
      part.slab(x + 3, y + 3, deck + travel, w - 6, keyHeight - 2, 1, disabled ? 'steel' : 'key', 1);
      if (!arrow) {
        const left = x + Math.floor((w - 5) / 2), front = y + h - 2;
        plate.box(left - 1, front - 1, deck - 1, 7, 3, 1, 'gasket');
        const lenses = model.part(current ? 'windows' : 'smoked-windows');
        lenses.box(left, front, deck - 1, 5, 1, 1, current ? 'light' : 'lens');
        lenses.plot(left, front, deck - 1, current ? 'ivory' : 'slate');
        // Two metal retaining tabs frame the smoked window in its black seal.
        plate.carve(left - 1, front, deck - 1, 7, 1, 1);
        const clips = model.part(current ? 'lit-clips' : 'clips');
        clips.plot(left - 1, front, deck - 1, 'steel');
        clips.plot(left + 5, front, deck - 1, 'steel');
      }
      const key = a.rel || a.hash;
      const seat = { a, key, part, travel, spring: live.spring(key) };
      move(seat, current || disabled || key === live.state.heldKey, !live.state.animate);
      live.label(wrapLabel(a), () => live.faceZ + part.tz);
      return seat;
    });
    live.state.animate = false;
  },

  pose(live) {
    for (const seat of live.state.seats) seat.part.tz = Math.max(-seat.travel, Math.min(0, seat.spring.x));

    // Reflected light on the two metal ends only. The seal absorbs it. Read
    // the baked emitter colour again when a change of finish retints the model.
    const clips = live.model.byName['lit-clips'];
    if (clips && live.state.windowTint !== live.tintRevision) {
      const lens = live.model.byName.windows;
      const emitter = lens.col.findIndex((v, i) => i % 4 === 3 && v > 0) - 3;
      if (emitter >= 0) {
        for (let i = 0; i < clips.count; i++) {
          for (let c = 0; c < 3; c++) {
            const j = 4 * i + c;
            clips.col[j] += .24 * (lens.col[emitter + c] - clips.col[j]);
          }
        }
      }
      live.state.windowTint = live.tintRevision;
    }
  },

  plain: wireKeys,
  bind(live) {
    const on = listeners();
    wireKeys(live.el, on, live);
    watchDirection(live, on);
    return on.done;
  },
};
