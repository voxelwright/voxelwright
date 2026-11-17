// Dialog. The one thing on the page that is plainly built in front of you: it assembles from its
// centre when it opens and crumbles when it closes. Opening a dialog is occasional, so it can
// afford half a second; the content appears as soon as there is a slab to carry it.
// Markup: <dialog class="vx-dialog"><header>Title</header><div class="vx-dialog-body">…</div>
//           <footer><button class="vx-button" data-vx-close>Done</button></footer></dialog>

import { cue } from '../core/sound.js';
import { listeners } from './util.js';

export const dialog = {
  name: 'dialog',
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
    let leaving = false;
    const opened = () => {
      leaving = false;
      el.removeAttribute('data-vx-leaving');
      el.setAttribute('data-vx-building', '');
      live.rebuild();
      cue('build');
      live.play('assemble', null, { from: [live.W / 2, live.H / 2], duration: 0.46, each: 0.24 });
      setTimeout(() => el.removeAttribute('data-vx-building'), 340); // the words arrive once there is a slab to carry them
    };
    const leave = async (value) => {
      if (leaving || !el.open) return;
      leaving = true;
      el.setAttribute('data-vx-leaving', '');
      cue('break');
      await live.play('crumble', null, { duration: 0.27 });
      el.close(value);
      el.removeAttribute('data-vx-leaving');
      for (const p of live.model.parts) p.hidden = false;
      leaving = false;
    };
    live.state.leave = leave;
    on.watch(el, { attributes: true, attributeFilter: ['open'] }, () => { if (el.open && !leaving) opened(); });
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
