// Number stepper. A well for the number, and two small keys beside it: fewer, and more.
// Tool: the kit's well (.vx-well) and the kit's key (.vx-button). This part draws nothing of its
// own; it is what the keys do.
// Markup: <div class="vx-stepper" role="group" aria-label="Replicas">
//           <button class="vx-button" type="button" data-vx-step="down" aria-label="One replica fewer" tabindex="-1">-</button>
//           <span class="vx-well"><input type="number" min="1" max="12" step="1" value="3" aria-label="Replicas"></span>
//           <button class="vx-button" type="button" data-vx-step="up" aria-label="One replica more" tabindex="-1">+</button>
//         </div>
// The field is a real number input: typing, the arrow keys in it, min, max and step are the
// browser's. A key steps once when pressed and goes on stepping while it is held; at a limit it
// is switched off (aria-disabled). `input` and `change` come from the field, as if typed.
// The keys are out of the tab order (tabindex="-1"): the arrow keys in the field do their work.


import { watchFieldsets } from './util.js';

const WAIT = 420, EVERY = 70; // ms: how long a key is held before it repeats, and how often then

function wire(el, on) {
  const input = el.querySelector('input');
  const keys = [...el.querySelectorAll('[data-vx-step]')];
  if (!input) return;
  const num = (name) => { const v = input.getAttribute(name); return v === null || v === '' || isNaN(Number(v)) ? null : Number(v); };
  const locked = () => input.matches(':disabled') || input.readOnly;

  // can it go that way from here? (an empty field can go either way)
  const can = (dir) => {
    if (locked()) return false;
    const v = input.valueAsNumber, lim = num(dir > 0 ? 'max' : 'min');
    return lim === null || isNaN(v) || (dir > 0 ? v < lim : v > lim);
  };
  // a key at a limit is switched off; it keeps its place in the page and its name
  const sync = () => {
    for (const key of keys) {
      const off = !can(key.dataset.vxStep === 'up' ? 1 : -1);
      if (off !== (key.getAttribute('aria-disabled') === 'true')) { if (off) key.setAttribute('aria-disabled', 'true'); else key.removeAttribute('aria-disabled'); }
    }
  };
  // one step, by the field's own rules for min, max and step. True if the number changed.
  const step = (dir) => {
    if (!can(dir)) return false;
    const was = input.value;
    try { if (dir > 0) input.stepUp(); else input.stepDown(); }
    catch { // step="any" has no step to take: go by one
      const lo = num('min'), hi = num('max');
      let v = (isNaN(input.valueAsNumber) ? 0 : input.valueAsNumber) + dir;
      if (lo !== null) v = Math.max(lo, v);
      if (hi !== null) v = Math.min(hi, v);
      input.value = String(v);
    }
    if (input.value === was) return false;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    sync();
    return true;
  };

  let timer = 0, repeating = null;
  const presses = new Map();
  const stop = () => { clearTimeout(timer); clearInterval(timer); timer = 0; repeating = null; };
  const hold = (dir, id) => {
    stop();
    repeating = id;
    timer = setTimeout(() => { timer = setInterval(() => { if (!step(dir)) stop(); }, EVERY); }, WAIT);
  };
  for (const key of keys) {
    const dir = key.dataset.vxStep === 'up' ? 1 : -1;
    // the press does not take the focus from where it is (the field, as a rule)
    on(key, 'mousedown', (e) => e.preventDefault());
    on(key, 'pointerdown', (e) => {
      if (e.button !== 0) return;
      presses.set(e.pointerId, { key });
      if (step(dir)) hold(dir, e.pointerId);
    });
    on(key, 'pointerleave', e => { if (e.pointerId === repeating) stop(); });
    on(key, 'blur', stop);
    // a click with no press before it is a key from the keyboard, or a screen reader
    on(key, 'click', e => {
      if (e.detail > 0) {
        const id = e.pointerId ?? [...presses].find(([, stroke]) => stroke.key === key)?.[0];
        if (presses.get(id)?.key === key) {
          presses.delete(id);
          return;
        }
      }
      step(dir);
    });
  }
  // wherever the pointer comes up, the holding ends; a press that got no click is forgotten
  on(document, 'pointerup', e => {
    if (repeating === e.pointerId) stop();
    const stroke = presses.get(e.pointerId);
    if (stroke) setTimeout(() => {
      if (presses.get(e.pointerId) === stroke) presses.delete(e.pointerId);
    }, 500);
  });
  on(document, 'pointercancel', e => {
    if (repeating === e.pointerId) stop();
    presses.delete(e.pointerId);
  });
  // and when these listeners are dropped (the part is released), so is a holding that is under way
  on({ addEventListener() {}, removeEventListener: stop }, 'drop', stop);

  on(input, 'input', sync);
  on(input, 'change', sync);
  on.heed(input, 'value', sync); // set from code
  on.watch(input, { attributes: true, attributeFilter: ['min', 'max', 'step', 'disabled', 'readonly'] }, sync);
  if (input.form) on(input.form, 'reset', () => setTimeout(sync));
  watchFieldsets(input, on, sync);
  on(window, 'blur', stop);
  sync();
}

export const stepper = {
  name: 'stepper',
  selector: '.vx-stepper',
  plain: wire,
};
