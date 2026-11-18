// A stopped encoder on a native range. The outer edge tracks angle, and a drag
// starting at the spindle uses vertical travel (useful at small touch sizes).
import { clamp, listeners } from './util.js';

const sweep = Math.PI * 1.5;
const valueOf = input => clamp((input.valueAsNumber - Number(input.min || 0)) /
  (Number(input.max || 100) - Number(input.min || 0) || 1), 0, 1);
const angleOf = input => (valueOf(input) - .5) * sweep;

function wire(el, on, redraw = () => {}) {
  const input = el.querySelector('input');
  let drag;
  function paint() {
    el.style.setProperty('--angle', angleOf(input) + 'rad');
    redraw();
  }
  const point = (x, y) => Math.atan2(x, -y);
  on(input, 'pointerdown', event => {
    if (event.button !== 0 || drag || input.disabled) return;
    event.preventDefault();
    input.focus({ preventScroll: true });
    const rect = input.getBoundingClientRect(), cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    drag = { id: event.pointerId, cx, cy, y: event.clientY, span: Math.max(96, rect.height),
      angular: Math.hypot(event.clientX - cx, event.clientY - cy) > rect.width * .19,
      last: point(event.clientX - cx, event.clientY - cy), t: valueOf(input), start: input.value };
    input.setPointerCapture(event.pointerId);
  });
  on(input, 'pointermove', event => {
    if (drag?.id !== event.pointerId) return;
    const angle = point(event.clientX - drag.cx, event.clientY - drag.cy);
    const delta = angle - drag.last;
    drag.t = clamp(drag.t + (drag.angular ? Math.atan2(Math.sin(delta), Math.cos(delta)) / sweep :
      (drag.y - event.clientY) / drag.span), 0, 1);
    drag.y = event.clientY;
    drag.last = angle;
    const previous = input.value, min = Number(input.min || 0);
    input.value = min + drag.t * (Number(input.max || 100) - min);
    if (input.value !== previous) input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  function finish(event) {
    if (drag?.id !== event.pointerId) return;
    const changed = drag.start !== input.value;
    drag = null;
    if (changed) input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  for (const type of ['pointerup','pointercancel','lostpointercapture']) on(input, type, finish);
  on(input, 'input', paint);
  on.heed(input, 'value', paint);
  on.watch(input, { attributes: true, attributeFilter: ['min','max','step','value'] }, paint);
  paint();
}

export const rotary = {
  name: 'rotary', selector: '.vx-rotary', pad: 6,
  build(live, m) {
    const { W, H } = live;
    const x = W / 2, y = H / 2, radius = Math.max(3, Math.min(x, y) - 2);
    const collar = m.part('collar'), drum = m.part('drum');
    drum.axle = { x, y, angle: 0 };
    for (let row = 0; row < H; row++) for (let col = 0; col < W; col++) {
      const dx = col + .5 - x, dy = row + .5 - y;
      const r = Math.hypot(dx, dy), a = Math.atan2(dx, -dy);
      if (r <= radius + 1.5) collar.box(col, row, 0, 1, 1, 2, 'gasket');
      if (r > radius) continue;
      const flute = Math.cos(a * 24);
      if (r < radius - 1 || flute > -.3) drum.box(col, row, 2, 1, 1, 5, flute > .25 ? 'steel' : 'slate');
      if (r < radius - 1) drum.plot(col, row, 7, 'warm-metal');
      if (r < radius - 2) drum.plot(col, row, 8, Math.abs(dx) < 1 && dy < -radius * .34 ? 'gasket' : 'warm-metal');
    }
    live.faceZ = 6;
  },
  pose(live) { live.model.byName.drum.axle.angle = angleOf(live.el.querySelector('input')); },
  bind(live) {
    const on = listeners();
    wire(live.el, on, () => live.invalidate());
    return on.done;
  },
  plain: wire,
};
