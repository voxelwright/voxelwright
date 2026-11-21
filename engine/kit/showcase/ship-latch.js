// A panel-mount slide switch. The metal flange carries the pilot independently of the carriage.
import { define, defineLook } from '../src/index.js';
import { hole, halo } from '../src/core/light.js';
import { MATERIALS } from '../src/core/materials.js';
import { PRESS, RELEASE, SLIDE, reducedMotion } from '../src/core/motion.js';
import { cue } from '../src/core/sound.js';
import { inlineX, watchDirection } from '../src/plain.js';
import { clamp, listeners } from '../src/components/util.js';

defineLook('ship-latch', {
  from: 'lit',
  materials: {
    steel: { day: '#a8abb0', night: '#646e78', jitter: 0.008 },
    floor: { day: '#24292e', night: '#20262b' },
    gasket: { day: '#393636', night: '#313238' },
    key: { day: '#3d4147', night: '#434953' },
    lens: { day: '#324940', night: '#283b33' },
  },
});

const thumbWidth = 9;
const travel = 12;
const seated = (position, target) => Math.abs(position - target) < 0.05;
const contact = checked => cue(checked ? 'press' : 'release');

define({
  name: 'ship-latch',
  selector: '.ship-latch',
  glowRadius: 2,
  glowStrength: halo(0.11),

  build(live, model) {
    const x = live.state.x = inlineX(live);
    const slot = x(2, 23);
    const flange = model.part('flange');
    flange.slab(0, 0, 0, 32, 16, 1, 'gasket', 2);
    flange.slab(0, 0, 1, 32, 16, 1, 'steel', 2);
    flange.carve(slot, 3, 0, 23, 10, 2);
    hole(live, model, { x: slot, y: 3, w: 23, h: 10, depth: 2, wall: 'gasket' });
    // The shoe rides between two fixed guides on the floor of the slot.
    const guides = model.part('runners');
    guides.sunk = true;
    for (const y of [4, 11]) guides.box(slot, y, -2, 23, 1, 3, 'gasket');
    live.faceZ = 2;

    const shoe = model.part('shoe');
    shoe.grounded = false;
    shoe.sunk = true;
    shoe.box(1, 5, -2, 7, 6, 1, 'gasket');
    shoe.box(3, 6, -1, 3, 4, 3, 'steel');
    const thumb = model.part('thumb');
    thumb.grounded = false;
    thumb.sunk = true;
    // The cap telescopes one course over the shoe's stem under finger pressure.
    thumb.slab(1, 5, 0, thumbWidth - 2, 6, 2, 'gasket', 1);
    thumb.slab(0, 4, 2, thumbWidth, 8, 2, 'key', 1);
    thumb.carve(3, 6, 0, 3, 4, 3);
    // The transverse index and two raised grip ribs are set into the same moulding.
    for (const rib of [1, 4, 7]) thumb.box(rib, 5, 4, 1, 6, 1, rib === 4 ? 'ivory' : 'key');

    const pilot = x(27, 3);
    model.part('ferrule').slab(pilot - 1, 5, 2, 5, 6, 1, 'gasket', 1)
      .carve(pilot, 6, 2, 3, 4, 1);
    model.part('lens').slab(pilot, 6, 2, 3, 4, 1, 'light-go', 1);
    live.state.lit = undefined;
    live.spring('at').snap(Number(live.state.input.checked));
  },

  pose(live) {
    const { thumb, shoe, lens, ferrule } = live.model.byName;
    const at = live.spring('at'), position = clamp(at.x, 0, 1);
    thumb.tx = live.state.x(3 + travel * position, thumbWidth);
    shoe.tx = thumb.tx;
    thumb.tz = clamp(live.spring('press').x, -1, 0);

    const { input } = live.state;
    const lit = (seated(position, Number(input.checked)) ? input.checked : live.state.lit) && !input.matches(':disabled');
    if (lit !== live.state.lit || live.state.tint !== live.tintRevision) {
      lens.mats.fill(MATERIALS[lit ? 'light-go' : 'lens'].id);
      lens.tint(live.theme, live.look);
      ferrule.tint(live.theme, live.look);
      live.glows = lit;
      if (lit) {
        // The frosted centre is brightest above the die. The inside of the ferrule catches green.
        for (let i = 0; i < lens.count; i++) {
          const distance = Math.hypot(lens.rest[i * 3] - live.state.x(28, 1) - 0.5, lens.rest[i * 3 + 1] - 8);
          const core = clamp(1 - distance / 2, 0, 1);
          lens.col[4 * i] += 0.5 * core;
          lens.col[4 * i + 2] += 0.2 * core;
        }
        for (let i = 0; i < ferrule.count; i++) ferrule.col[4 * i + 1] += 0.09;
      }
      live.state.lit = lit;
      live.state.tint = live.tintRevision;
    }
  },

  // Trip the contact when the spring reaches its stop, including a keyboard snap.
  // Consume the stroke on the clock so a hidden control cannot replay it when redrawn.
  step(live) {
    const at = live.spring('at');
    if (live.state.impact && seated(at.x, at.target)) {
      live.state.impact = false;
      if (live.visible) contact(at.target === 1);
    }
  },

  bind(live) {
    const on = listeners();
    wireSlide(live.el, on, live);
    watchDirection(live, on);
    return on.done;
  },

  plain: wireSlide,
});

function wireSlide(el, on, live) {
  const label = el.parentElement;
  const input = label.querySelector('input');
  if (live) live.state.input = input;
  const at = live?.spring('at', Number(input.checked), SLIDE.k, SLIDE.c);
  const press = live?.spring('press');
  let pointer = null, drag = null, consumed = null, slide = false;

  const blocked = new Map();
  function pressure(value, spring) {
    if (!press) return;
    if (reducedMotion()) press.snap(value);
    else press.to(value, spring.k, spring.c);
    live.invalidate();
  }

  function horizontalStroke(dx, dy) {
    return Math.abs(dx) >= 4 && Math.abs(dx) > Math.abs(dy);
  }

  function release(event) {
    if (pointer === null) return;
    if (event?.type === 'pointerup' && drag && horizontalStroke(event.clientX - drag.x, event.clientY - drag.y)) drag.moving = true;
    if (drag?.moving) {
      consumed = pointer;
      if (event?.type === 'pointerup') {
        drag.position = clamp(drag.start + (event.clientX - drag.x) / drag.distance, 0, 1);
      }
      if (event?.type === 'pointerup' && !input.matches(':disabled') && input.checked !== (drag.position >= 0.5)) {
        // Native checkbox activation sends input/change once even on a touch drag without click.
        // A later compatibility click from this pointer is consumed below.
        input.click();
      }
      at?.to(Number(input.checked));
      if (reducedMotion()) at?.snap(Number(input.checked));
      el.removeAttribute('data-dragging');
      el.style.removeProperty('--ship-offset');
    }
    pointer = null;
    drag = null;
    pressure(0, RELEASE);
  }

  on(label, 'pointerdown', e => {
    if (e.button !== 0 || input.matches(':disabled')) return;
    if (pointer !== null || !e.isPrimary) {
      if (pointer !== e.pointerId) blocked.set(e.pointerId, {});
      return;
    }
    blocked.delete(e.pointerId);
    consumed = null;
    pointer = e.pointerId;
    const box = el.getBoundingClientRect();
    if (e.clientX >= box.left && e.clientX <= box.right && e.clientY >= box.top && e.clientY <= box.bottom) {
      const start = at?.x ?? Number(input.checked);
      const pitch = parseFloat(getComputedStyle(el).getPropertyValue('--vx'));
      const sign = getComputedStyle(el).direction === 'rtl' ? -1 : 1;
      drag = { x: e.clientX, y: e.clientY, start, position: start, distance: sign * travel * pitch, moving: false };
    }
    pressure(-1, PRESS);
  });
  on(window, 'pointermove', e => {
    if (pointer !== e.pointerId || !drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moving) {
      if (!horizontalStroke(dx, dy)) return;
      drag.moving = true;
      input.setPointerCapture(pointer);
      if (!live) el.setAttribute('data-dragging', '');
      if (live) live.state.impact = false;
    }
    drag.position = clamp(drag.start + dx / drag.distance, 0, 1);
    if (live) {
      at.snap(drag.position);
      live.invalidate();
    } else {
      el.style.setProperty('--ship-offset', drag.position * drag.distance + 'px');
    }
  });
  for (const type of ['pointerup', 'pointercancel']) {
    on(window, type, e => {
      if (pointer === e.pointerId) release(e);
      const stroke = blocked.get(e.pointerId);
      if (stroke) {
        if (type === 'pointercancel') blocked.delete(e.pointerId);
        else setTimeout(() => { if (blocked.get(e.pointerId) === stroke) blocked.delete(e.pointerId); }, 500);
      }
    });
  }
  on(window, 'blur', () => release());
  on(document, 'visibilitychange', () => {
    if (document.hidden) {
      if (live) live.state.impact = false;
      release();
    }
  });
  on(label, 'click', e => {
    if (e.detail > 0 && (blocked.delete(e.pointerId) || (pointer !== null && e.pointerId !== pointer))) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (consumed !== null && e.detail > 0 && (e.pointerId == null || e.pointerId === consumed)) {
      e.preventDefault();
      e.stopPropagation();
      consumed = null;
    }
  }, true);
  on(input, 'click', e => { slide = e.detail > 0 || !!drag?.moving; });
  function sync(user) {
    if (!live) {
      if (user) contact(input.checked);
      return;
    }
    live.state.impact = user;
    if (user && slide && !reducedMotion()) at.to(Number(input.checked));
    else at.snap(Number(input.checked));
    live.invalidate();
  }
  on(input, 'change', () => sync(true));
  if (live) {
    on.heed(input, 'checked', () => sync(false));
    on.watch(input, { attributes: true, attributeFilter: ['checked', 'disabled'] }, () => sync(false));
    if (input.form) on(input.form, 'reset', () => queueMicrotask(() => sync(false)));
  }
}
