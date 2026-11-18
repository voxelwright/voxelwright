// Message scroller. The thread: the kit's scroll area holding messages, which keeps to the
// newest message while you are at its foot, leaves you alone while you read back, and shows a
// key when something new has come below.
// Tool: the scroll area (its recess, and its bar: a trench with a small key) and the kit's key.
// This part draws nothing of its own: it is the behaviour of the thread.
// Markup: <div class="vx-scroll vx-thread" style="--vx-scroll-h: 96">
//           <div class="vx-recess vx-scroll-well">
//             <div class="vx-scroll-view" role="log" aria-label="Deploys, harbor-api" tabindex="0">
//               <article class="vx-message">…</article> …
//             </div>
//             <span class="vx-thread-new" hidden><button class="vx-button" type="button">New messages</button></span>
//           </div>
//           <span class="vx-scroll-bar" aria-hidden="true"></span>
//         </div>
//         The view is a log, so a screen reader reads a new message out when it is added
//         (politely); each message is an <article> named by who and when. The view takes focus,
//         and the wheel, a finger and the keys scroll it: they are the browser's own.
// Behaviour:
//   At the foot (within a line of it), it stays at the foot when a message is added, when the
//   last one grows as it is written, and when the thread itself is made shorter or taller.
//   Scrolled up, it is never moved. When something new comes below, the key is shown and says
//   how many messages there are ("2 new messages"; "More below" if what grew was not a new
//   message). The words are the slot's data-vx-one, data-vx-many (with {n}) and data-vx-more.
//   A press on the key goes to the foot and the key goes; so it does when you scroll to the
//   foot yourself. If the key had focus, the view takes it.
//   It starts at the foot. With no script it is a plain scrolling log that starts at its top.
// (The part's own element is the key's slot, .vx-thread-new: the thread is found from it.)

import { reducedMotion } from '../core/motion.js';
import { listeners } from './util.js';

const NEAR = 24; // px: a line of words. Nearer the foot than this is at the foot.

/** The thread's behaviour, with voxels or without. shown(key) is called when the key appears. */
function wire(slot, on, shown = () => {}) {
  const root = slot.closest('.vx-scroll'), view = root?.querySelector('.vx-scroll-view'), key = slot.querySelector('button');
  if (!view || !key) return;
  const gap = () => view.scrollHeight - view.clientHeight - view.scrollTop;
  let stuck = true;   // at the foot, and to be kept there
  let going = false;  // on the way to the foot after a press on the key
  let last = 0;       // how far from the foot it was when last looked at
  let unseen = 0;     // messages that came below while reading back

  const words = () => {
    const d = slot.dataset;
    return unseen === 0 ? (d.vxMore || 'More below') : unseen === 1 ? (d.vxOne || '1 new message') : (d.vxMany || '{n} new messages').replace('{n}', unseen);
  };
  const show = () => {
    const face = key.querySelector(':scope > .vx-label') ?? key, w = words();
    if (face.textContent !== w) face.textContent = w;
    if (!slot.hidden) return;
    slot.hidden = false;
    shown(key);
  };
  const hide = () => {
    unseen = 0;
    if (slot.hidden) return;
    const held = slot.contains(document.activeElement);
    slot.hidden = true;
    if (held) view.focus({ preventScroll: true });
  };
  const foot = (smooth) => view.scrollTo({ top: view.scrollHeight, behavior: smooth && !reducedMotion() ? 'smooth' : 'instant' });

  on(view, 'scroll', () => {
    const g = gap();
    if (going) { if (g <= 1) going = false; } else stuck = g <= NEAR;
    if (g <= NEAR) hide();
    last = g;
  }, { passive: true });
  // A hand on the thread takes over from a journey to the foot: the journey is stopped where it
  // is (the browser would finish a smooth scroll it has begun), and the hand moves on from there.
  const takeOver = (e) => {
    if (!going || key.contains(e.target)) return;
    going = false;
    view.scrollTo({ top: view.scrollTop, behavior: 'instant' });
    stuck = gap() <= NEAR;
  };
  for (const type of ['wheel', 'touchstart', 'pointerdown', 'keydown']) on(root, type, takeOver, { passive: true });

  // what is in the thread changed, or the thread did: more of it by `added` messages
  const grew = (added) => {
    if (stuck) { foot(false); last = gap(); return; }
    const g = gap();
    if (g > last + 1) { unseen += added; show(); }
    last = g;
  };
  const sizes = new ResizeObserver(() => grew(0));
  const watch = () => { sizes.disconnect(); sizes.observe(view); for (const c of view.children) sizes.observe(c); };
  on.watch(view, { childList: true, subtree: true, characterData: true }, (records) => {
    let added = 0;
    for (const r of records) if (r.target === view) for (const n of r.addedNodes) if (n.nodeType === 1 && (n.matches('article') || n.querySelector('article'))) added++;
    watch();
    grew(added);
  });
  watch();
  on({ addEventListener() {}, removeEventListener() { sizes.disconnect(); } }, 'end', grew);

  on(key, 'click', () => { stuck = true; going = true; hide(); foot(true); });

  foot(false);
  last = gap();
}

export const messageScroller = {
  name: 'message-scroller',
  selector: '.vx-thread-new',

  bind(live) {
    const on = listeners();
    wire(live.el, on, (key) => {
      // the key is made as it appears: it rises out of the surface, brick by brick
      const l = live.stage.lives.get(key);
      if (!l) return;
      l.rebuild();
      l.play('assemble', null, { duration: 0.24, each: 0.14 });
    });
    return on.done;
  },

  plain(el, on) { wire(el, on); },
};
