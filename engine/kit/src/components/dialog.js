// Dialog. An engraved plate rises carrying its controls and lowers intact to release the page.
// Markup: <dialog class="vx-dialog"><header>Title</header><div class="vx-dialog-body">…</div>
//           <footer><button class="vx-button" data-vx-close>Done</button></footer></dialog>

import { cue } from '../core/sound.js';
import { listeners } from './util.js';

export const dialog = {
  name: 'dialog',
  carryPlate: true,
  selector: 'dialog.vx-dialog',
  pad: 16,

  build(live, m) {
    const { W, H, el, vx } = live;
    const head = el.querySelector(':scope > header');
    const hh = head ? Math.round((head.offsetTop + head.offsetHeight) / vx) : 0;
    const panel = m.part('panel');
    const d = live.look.dialog;
    panel.box(0, 0, 0, W, H, d, 'chalk');
    if (hh) panel.box(0, 0, 0, W, hh, d, el.dataset.vxMaterial || 'enamel');
    panel.notch(0, 0, 0, W, H, d, live.look.round);
    live.faceZ = d;
  },

  bind(live) {
    const on = listeners();
    const el = live.el;
    let closing = null;
    const opened = () => {
      closing = null;
      el.removeAttribute('data-vx-leaving');
      live.rebuild();
      cue('build');
      live.play('assemble', null, { duration: 0.46 });
    };
    const leave = async (value) => {
      if (closing || !el.open) return;
      const request = closing = Symbol();
      el.setAttribute('data-vx-leaving', '');
      cue('release');
      await live.play('lower', null, { duration: 0.27 });
      if (request !== closing || !el.open || live.destroyed) return;
      el.close(value);
      el.removeAttribute('data-vx-leaving');
      closing = null;
    };
    live.state.leave = leave;
    on.watch(el, { attributes: true, attributeFilter: ['open'] }, () => {
      if (el.open) opened();
      else {
        closing = null;
        live.stopMotion();
        el.removeAttribute('data-vx-leaving');
      }
    });
    on(el, 'cancel', (e) => { e.preventDefault(); leave('cancel'); });
    on(el, 'click', (e) => {
      const b = e.target.closest('[data-vx-close]');
      if (b) { e.preventDefault(); leave(b.value || b.dataset.vxClose || ''); }
      else if (e.target === el && el.hasAttribute('data-vx-light-dismiss')) leave('cancel');
    });
    on(el, 'submit', (e) => {
      if (e.target.method !== 'dialog') return;
      e.preventDefault();
      leave(e.submitter?.value || '');
    });
    if (el.open) queueMicrotask(opened);
    return on.done;
  },
};
