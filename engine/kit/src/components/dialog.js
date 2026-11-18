// Dialog. The face assembles in courses and breaks back into them when dismissed.
// Markup: <dialog class="vx-dialog"><header>Title</header><div class="vx-dialog-body">…</div>
//           <footer><button class="vx-button" data-vx-close>Done</button></footer></dialog>

import { cue } from '../core/sound.js';
import { nativeRelease } from './popover.js';
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
    const palette = el.classList.contains('vx-command-dialog');
    const surface = palette ? 'rim' : 'courses';
    nativeRelease(live, on, null, palette ? 0.1 : 0.23, surface);
    const opened = () => {
      live.visible = true;
      live.rebuild();
      cue('build');
      live.play('assemble', null, { duration: palette ? 0.16 : 0.32, surface });
    };
    live.state.leave = value => el.close(value);
    // Keep the native cancel and submit defaults. A page can veto either, even
    // from a listener registered after adoption. Only an accepted close plays.
    let cancel, acceptedCancel = false;
    on(el, 'cancel', e => {
      cancel = e;
      setTimeout(() => { if (cancel === e) cancel = null; }, 0);
    });
    on(el, 'beforetoggle', e => {
      if (e.newState === 'closed') {
        acceptedCancel = !!cancel && !cancel.defaultPrevented;
        cue('release');
      }
      cancel = null;
    });
    on.watch(el, { attributes: true, attributeFilter: ['open'] }, () => {
      if (el.open) opened();
      // The UA writes requestClose(value) after beforetoggle. Keep its explicit
      // value, and give Escape its established result before close is delivered.
      else if (acceptedCancel && !el.returnValue) el.returnValue = 'cancel';
      acceptedCancel = false;
    });
    on(el, 'click', e => {
      if (e.defaultPrevented) return;
      const b = e.target.closest('[data-vx-close]');
      if (b) { e.preventDefault(); el.close(b.value || b.dataset.vxClose || ''); }
      else if (e.target === el && el.hasAttribute('data-vx-light-dismiss')) el.close('cancel');
    });
    if (el.open) queueMicrotask(opened);
    return on.done;
  },
};
