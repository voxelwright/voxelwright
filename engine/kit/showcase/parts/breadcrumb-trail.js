// A strip of low-profile return keys ends in a flush location legend.
import { cue, halo, listeners, PRESS, RELEASE } from '../../src/index.js';
import { reducedMotion } from '../../src/core/motion.js';

export const rail = {
  selector: '#trail .rail', name: 'breadcrumb-rail', pad: 3,
  build(live, model) {
    const { W, H } = live;
    const plate = model.part('rail');
    plate.slab(0, 0, 0, W, H, 1, 'gasket');
    plate.slab(0, 0, 1, W, H, 1, 'slate');
    for (const x of [2, W - 4]) {
      plate.box(x, 2, 1, 2, 1, 1, 'warm-metal');
    }
    live.faceZ = 2;
  },
};

export const lens = {
  selector: '#trail .locator', name: 'breadcrumb-lens', pad: 2,
  glowStrength: halo(0.035), glowRadius: 1.5,
  build(live, model) {
    const { W, H } = live;
    const fitting = model.part('socket');
    fitting.slab(0, 0, 0, W, H, 1, 'steel');
    fitting.box(1, 1, 0, W - 2, H - 2, 1, 'light');
    live.faceZ = 1;
  },
};

function stroke(el, on, move) {
  let held = null;
  function down(source) {
    if (held !== null) return;
    held = source;
    move?.(true);
    cue('press');
  }
  function up(source, sounded) {
    if (held === null || held !== source) return;
    held = null;
    move?.(false);
    if (sounded) cue('release');
  }
  on(el, 'pointerdown', e => { if (e.button === 0 && e.isPrimary) down(e.pointerId); });
  on(el, 'pointermove', e => { if (!(e.buttons & 1)) up(e.pointerId, true); });
  on(el, 'pointerup', e => up(e.pointerId, true));
  for (const event of ['pointercancel', 'pointerleave']) on(el, event, e => up(e.pointerId, false));
  on(el, 'keydown', e => { if (e.key === 'Enter' && !e.repeat) down(e.key); });
  on(el, 'keyup', e => up(e.key, true));
  on(el, 'blur', () => up(held, false));
}

export const returnKey = {
  selector: '#trail a[href]', name: 'breadcrumb-return', pad: 2,
  build(live, model) {
    const { W, H } = live;
    model.part('mount').slab(1, 4, 0, W - 2, H - 8, 2, 'gasket');
    model.part('cap').slab(0, 3, 2, W, H - 6, 2, 'key');
    live.faceZ = 4;
    live.label(live.el.querySelector('.legend'), () => 4 + live.model.byName.cap.tz);
  },
  pose(live) { live.model.byName.cap.tz = live.spring('stroke').x; },
  bind(live) {
    const on = listeners(), spring = live.spring('stroke');
    stroke(live.el, on, down => {
      const stop = down ? -1 : 0, springType = down ? PRESS : RELEASE;
      if (reducedMotion()) spring.snap(stop);
      else {
        if (down) spring.x = Math.min(-0.4, spring.x);
        spring.to(stop, springType.k, springType.c);
      }
      live.invalidate();
    });
    return on.done;
  },
  plain(el, on) { stroke(el, on, down => el.toggleAttribute('data-held', down)); },
};
