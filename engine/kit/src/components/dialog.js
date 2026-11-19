// Dialog. The face assembles in courses and breaks back into them when dismissed.
// Markup: <dialog class="vx-dialog"><header>Title</header><div class="vx-dialog-body">…</div>
//           <footer><button class="vx-button" data-vx-close>Done</button></footer></dialog>

import { cue } from '../core/sound.js';
import { nativeRelease } from './popover.js';
import { listeners } from './util.js';

// Let the browser decide whether cancel succeeds. beforetoggle runs only when
// closing proceeds, before requestClose(value) writes an explicit value.
export function wireDialog(el, on) {
  let cancel, escape, normalizeEscape = false;
  on(el, 'keydown', e => { escape = e.key === 'Escape' ? e : null; });
  on(el, 'keyup', () => { escape = null; });
  on(el, 'cancel', e => {
    cancel = e;
    setTimeout(() => { if (cancel === e) { cancel = null; escape = null; } }, 0);
  });
  on(el, 'beforetoggle', e => {
    const accepted = e.newState === 'closed' && cancel?.eventPhase === Event.NONE && !cancel.defaultPrevented;
    // The key's native default runs after dispatch. requestClose() inside a
    // key listener is an explicit application request, even when its value is ''.
    normalizeEscape = accepted && escape?.eventPhase === Event.NONE && !escape.defaultPrevented;
    // Some browsers keep the previous result if no new value is supplied.
    if (accepted) el.returnValue = 'cancel';
    cancel = escape = null;
  });
  on.watch(el, { attributes: true, attributeFilter: ['open'] }, () => {
    // Other browsers explicitly write an empty result for the Escape key.
    if (!el.open && normalizeEscape && !el.returnValue) el.returnValue = 'cancel';
    normalizeEscape = false;
  });
  on(el, 'click', e => {
    if (e.defaultPrevented) return;
    const b = e.target.closest('[data-vx-close]');
    if (b) { e.preventDefault(); el.close(b.value || b.dataset.vxClose || ''); }
    else if (e.target === el && el.hasAttribute('data-vx-light-dismiss')) el.close('cancel');
  });
}

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
    const deck = el.hasAttribute('data-vx-command-deck');
    const palette = el.classList.contains('vx-command-dialog') && !deck;
    const surface = palette ? 'rim' : 'courses';
    nativeRelease(live, on, null, palette ? 0.1 : 0.23, surface);
    const opened = () => {
      live.visible = true;
      const resume = live.rebuild();
      cue(deck ? 'press' : 'build');
      live.play('assemble', null, { duration: palette ? 0.16 : deck ? 0.26 : 0.32, surface, resume });
    };
    live.state.leave = value => el.close(value);
    wireDialog(el, on);
    on(el, 'beforetoggle', e => { if (e.newState === 'closed') cue('release'); });
    on.watch(el, { attributes: true, attributeFilter: ['open'] }, () => { if (el.open) opened(); });
    if (el.open) queueMicrotask(opened);
    return on.done;
  },
};
