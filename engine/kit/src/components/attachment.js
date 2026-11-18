// Attachment. A file on a message, or waiting in the composer: a low tile with its name and its
// size on it. One that can be taken away has a small key beside it (the kit's close button);
// removed, the tile shatters from the point that was pressed.
// Tool: a low plate (half as thick as a panel, one corner cut as a card's is). It cannot be
// pressed, so it has no step and stands on no light. The key beside it is the kit's own.
// Markup: <ul class="vx-attachments" aria-label="Attached files" data-vx-return="attach">
//           <li class="vx-attachment">
//             <span class="vx-attachment-tile">
//               <span class="vx-attachment-name">build-214.log</span>
//               <span class="vx-attachment-size">Log, 48 KB</span>
//             </span>
//             <button class="vx-button vx-close" type="button" aria-label="Remove build-214.log">×</button>
//           </li>
//         </ul>
//         The name may be a link (<a class="vx-attachment-name" href>). On a message that has
//         been sent there is no key, and nothing to remove.
// Behaviour: a press on the key, or Delete or Backspace with focus on it, asks the page first:
// `vx-remove` (it bubbles; preventDefault() keeps the file). Then the attachment is marked
// data-vx-leaving, shatters, and is taken out of the page; the list then says `vx-removed`
// ({ name }). Focus goes at once to the next file's key, or the one before, or, when none is
// left, to the element named by data-vx-return on the list (its id: the key that attaches a
// file, the field), or to the list itself. With no voxels it is the same, without the shatter.

import { cue } from '../core/sound.js';
import { listeners } from './util.js';

const keyOf = (item) => item.querySelector('.vx-close, .vx-attachment-remove');
const nameOf = (item) => item.querySelector('.vx-attachment-name')?.textContent.trim() ?? '';

// Where focus goes when this one is removed.
function heir(item) {
  const list = item.closest('.vx-attachments');
  const all = list ? [...list.querySelectorAll('.vx-attachment')] : [];
  const at = all.indexOf(item), ok = (it) => !it.hasAttribute('data-vx-leaving') && keyOf(it);
  const near = all.slice(at + 1).find(ok) ?? all.slice(0, Math.max(0, at)).reverse().find(ok);
  if (near) return keyOf(near);
  const back = list?.dataset.vxReturn ? document.getElementById(list.dataset.vxReturn) : null;
  if (back) return back;
  if (list && !list.hasAttribute('tabindex')) list.tabIndex = -1;
  return list;
}

/**
 * What removing does, with voxels or without. shatter(item, event) resolves when nothing is
 * left; gone(item) is called once it is out of the page.
 */
function wire(tile, on, shatter, gone) {
  const item = tile.closest('.vx-attachment') ?? tile;
  const remove = async (e) => {
    if (item.hasAttribute('data-vx-leaving')) return;
    const name = nameOf(item);
    if (!item.dispatchEvent(new CustomEvent('vx-remove', { bubbles: true, cancelable: true, detail: { name } }))) return;
    const held = item.contains(document.activeElement);
    const to = heir(item);
    item.setAttribute('data-vx-leaving', '');
    if (held) to?.focus({ preventScroll: true });
    if (shatter) await shatter(item, e);
    const from = item.parentElement;
    item.remove();
    gone?.(item);
    from?.dispatchEvent(new CustomEvent('vx-removed', { bubbles: true, detail: { name } }));
  };
  on(item, 'click', (e) => { const k = keyOf(item); if (k && k.contains(e.target)) remove(e); });
  on(item, 'keydown', (e) => {
    if ((e.key !== 'Delete' && e.key !== 'Backspace') || e.altKey || e.ctrlKey || e.metaKey) return;
    const k = keyOf(item);
    if (!k || !k.contains(e.target)) return;
    e.preventDefault();
    remove(e);
  });
}

export const attachment = {
  name: 'attachment',
  selector: '.vx-attachment-tile',
  pad: 12, // room for its bricks to fall in

  build(live, m) {
    const { W, H } = live, look = live.look;
    const d = Math.max(1, Math.round(look.slab / 2)); // low: half as thick as a panel
    const tile = m.part('tile');
    tile.slab(0, 0, 0, W, H, d, 'key', 1);
    // one corner is cut, as a card's is: three steps at the top right
    if (W >= 8 && H >= 8) for (let j = 0; j < 3; j++) tile.carve(W - 3 + j, j, 0, 3 - j, 1, d);
    live.faceZ = d;
  },

  bind(live) {
    const on = listeners();
    wire(live.el, on, async (item, e) => {
      // the tile and the key beside it break together, from the point pressed (a key press:
      // from the key)
      const key = keyOf(item), keyLive = key ? live.stage.lives.get(key) : null;
      const kr = (key ?? live.el).getBoundingClientRect();
      const x = e?.clientX || kr.left + kr.width / 2, y = e?.clientY || kr.top + kr.height / 2;
      cue('break');
      const breaks = [live, keyLive].filter(Boolean).map((l) => {
        const r = l.el.getBoundingClientRect();
        return l.play('crumble', null, { duration: 0.28, from: [(x - r.left) / l.vx, (y - r.top) / l.vx] });
      });
      // a part that is out of sight is not drawn, and would never finish: do not wait for ever
      await Promise.race([Promise.all(breaks), new Promise((done) => setTimeout(done, 700))]);
    }, (item) => {
      // what was drawn in it (the tile, the key, a lamp) is given back to the stage
      const stage = live.stage;
      for (const el of [...stage.lives.keys()]) if (item.contains(el)) stage.remove(el);
    });
    return on.done;
  },

  plain(el, on) { wire(el, on); },
};
