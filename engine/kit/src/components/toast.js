// Toast. A small slab that is set down when something has happened and crumbles away after.
// The stripe says what kind of news it is: leaf for done, brick for failed, signal for a notice.
// Use toast('Watered.', { kind: 'done' }) from index.js, or mark up a .vx-toast yourself.

import { inlineX, watchDirection } from '../plain.js';
import { cue } from '../core/sound.js';
import { listeners } from './util.js';

const STRIPE = { done: 'leaf', failed: 'brick', note: 'signal' };

// A click dismisses a notice, and it shatters under the click: the break starts at the point
// that was clicked. When nothing of it is left it says `vx-dismiss` (the event bubbles).
// A notice made by toast() is then taken out of the page. One written in the page is the page's
// own: it stays where it is, with nothing drawn and data-vx-leaving set, until the page shows it
// again (take data-vx-leaving off and play 'assemble') or removes it.
const owned = new WeakSet(); // notices made by toast(), which dismisses them itself

async function shatter(el, live, e) {
  el.setAttribute('data-vx-leaving', '');
  if (!live) return;
  const r = el.getBoundingClientRect();
  const from = e && (e.clientX || e.clientY) ? [(e.clientX - r.left) / live.vx, (e.clientY - r.top) / live.vx] : undefined;
  if (from) cue('break');
  const duration = el.dataset.vxSpecimen === 'deploy' ? 0.29 : 0.19;
  await live.play('crumble', null, { duration, from, contact: !!from });
}

export const toastDef = {
  name: 'toast',
  surface: 'courses',
  selector: '.vx-toast',
  pad: 9,

  build(live, m) {
    const { W, H, el } = live;
    const d = live.look.float, r = live.look.round;
    m.part('body').slab(0, 0, 0, W, H, d, 'chalk', r);
    const s = m.part('stripe');
    s.grounded = false;
    const x = inlineX(live);
    s.box(x(0, r), r, d, r, H - r * 2, 1, STRIPE[el.dataset.vxKind] || 'signal');
    live.faceZ = d;
  },

  bind(live) {
    const on = listeners();
    watchDirection(live, on);
    const el = live.el;
    on.watch(el, { attributes: true, attributeFilter: ['data-vx-kind'] }, () => live.rebuild());
    on(el, 'click', async (e) => {
      if (owned.has(el) || el.hasAttribute('data-vx-leaving')) return;
      await shatter(el, live, e);
      el.dispatchEvent(new CustomEvent('vx-dismiss', { bubbles: true }));
    });
    return on.done;
  },
};

let region = null;

/** Show a toast. Returns a function that dismisses it early. Needs adopt and live from index.js. */
export function makeToast(adopt, liveOf) {
  return function toast(message, opts = {}) {
    if (!region || !region.isConnected) {
      region = document.createElement('div');
      region.className = 'vx-toasts';
      region.setAttribute('role', 'region');
      region.setAttribute('aria-label', 'Notifications');
      document.body.append(region);
    }
    const el = document.createElement('div');
    el.className = 'vx-toast';
    el.setAttribute('role', opts.kind === 'failed' ? 'alert' : 'status');
    el.dataset.vxKind = opts.kind || 'note';
    if (opts.specimen === 'deploy') el.dataset.vxSpecimen = 'deploy';
    const text = document.createElement('span');
    text.className = 'vx-toast-text';
    text.textContent = message;
    el.append(text);
    region.append(el);
    owned.add(el);
    adopt(el);
    const live = liveOf(el);
    live?.play('assemble', null, { duration: opts.specimen === 'deploy' ? 0.40 : 0.25 });
    cue(opts.kind === 'failed' ? 'failed' : opts.kind === 'done' ? 'done' : 'tick');

    let left = opts.duration ?? 4200, since = performance.now(), timer = 0, gone = false;
    // called with the click, it shatters from the point clicked; called with nothing, from its top
    const dismiss = async (e) => {
      if (gone) return;
      gone = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', syncTimer);
      await shatter(el, live, e);
      el.dispatchEvent(new CustomEvent('vx-dismiss', { bubbles: true }));
      el.remove();
    };
    el.addEventListener('click', dismiss);
    // the clock stops while the pointer is over it, while it has focus, and while the tab is hidden
    const syncTimer = () => {
      if (gone || left === Infinity) return;
      if (document.hidden || el.matches(':hover, :focus-within')) {
        if (timer) left -= performance.now() - since;
        clearTimeout(timer);
        timer = 0;
      } else if (!timer) {
        since = performance.now();
        timer = setTimeout(dismiss, left);
      }
    };
    for (const event of ['pointerenter', 'pointerleave', 'focusin', 'focusout']) {
      el.addEventListener(event, () => queueMicrotask(syncTimer));
    }
    document.addEventListener('visibilitychange', syncTimer);
    syncTimer();
    return dismiss;
  };
}
