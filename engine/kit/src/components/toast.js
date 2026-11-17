// Toast. A small slab that is set down when something has happened and crumbles away after.
// The stripe says what kind of news it is: leaf for done, brick for failed, signal for a notice.
// Use toast('Watered.', { kind: 'done' }) from index.js, or mark up a .vx-toast yourself.

import { cue } from '../core/sound.js';
import { listeners } from './util.js';

const STRIPE = { done: 'leaf', failed: 'brick', note: 'signal' };

export const toastDef = {
  name: 'toast',
  selector: '.vx-toast',
  pad: 9,

  build(live, m) {
    const { W, H, el } = live;
    m.part('body').slab(0, 0, 0, W, H, 4, 'chalk', 2);
    const s = m.part('stripe');
    s.grounded = false;
    s.box(0, 2, 4, 2, H - 4, 1, STRIPE[el.dataset.vxKind] || 'signal');
    live.faceZ = 4;
  },

  bind(live) {
    const on = listeners();
    on.watch(live.el, { attributes: true, attributeFilter: ['data-vx-kind'] }, () => live.rebuild());
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
    const text = document.createElement('span');
    text.className = 'vx-toast-text';
    text.textContent = message;
    el.append(text);
    region.append(el);
    adopt(el);
    const live = liveOf(el);
    live?.play('assemble', null, { from: [0, live.H / 2], duration: 0.3, each: 0.18 });
    cue(opts.kind === 'failed' ? 'failed' : opts.kind === 'done' ? 'done' : 'tick');

    let left = opts.duration ?? 4200, since = performance.now(), timer = 0, gone = false;
    const dismiss = async () => {
      if (gone) return;
      gone = true;
      clearTimeout(timer);
      el.setAttribute('data-vx-leaving', '');
      if (live) await live.play('crumble', null, { duration: 0.28 });
      el.remove();
    };
    // the clock stops while the pointer is over it, while it has focus, and while the tab is hidden
    const run = () => { since = performance.now(); timer = setTimeout(dismiss, left); };
    const hold = () => { clearTimeout(timer); left -= performance.now() - since; };
    el.addEventListener('pointerenter', hold);
    el.addEventListener('pointerleave', run);
    const vis = () => { if (gone) return document.removeEventListener('visibilitychange', vis); document.hidden ? hold() : run(); };
    document.addEventListener('visibilitychange', vis);
    if (left !== Infinity) run();
    return dismiss;
  };
}
