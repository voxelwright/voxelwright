// Date picker. A well with the real date input in it, and a small key beside it that opens the
// calendar in a float.
// Tool: the kit's well (.vx-well), the kit's key (.vx-button), the kit's popover (.vx-popover) and
// the calendar (.vx-calendar). This part draws nothing of its own; it is what joins them.
// Markup: <div class="vx-date">
//           <span class="vx-well"><input type="date" id="ship" aria-label="Ship on" value="2026-11-20"></span>
//           <button class="vx-button" type="button" popovertarget="ship-pick" data-vx-say="Choose the day"><span class="vx-date-glyph" aria-hidden="true"></span></button>
//           <div class="vx-popover vx-date-float" id="ship-pick" popover role="dialog" aria-label="Ship on">
//             <div class="vx-calendar" data-vx-for="ship"></div>
//           </div>
//         </div>
//         Two inputs in the well (or in two wells) and data-vx-for naming both make it a range.
// With no script the key is not shown and the browser's own picker is the input's. With script:
// the key opens the float (Enter, Space, a press), and the focus goes to the chosen day in the
// grid (or today); a choice closes it and the focus goes back to the key (a range, once it has
// both ends); Escape or a press outside closes it too. The key's name says what it does and
// the date it holds, in words ("Choose the day, Friday 20 November 2026"). Typing in the input
// is the browser's own, and the calendar follows it.

import { listeners } from './util.js';

function wire(el, on) {
  const key = el.querySelector(':scope > [popovertarget]');
  const float = key && document.getElementById(key.getAttribute('popovertarget'));
  const cal = float?.querySelector('.vx-calendar');
  if (!key || !float || !cal) return;
  const inputs = (cal.dataset.vxFor || '').split(/\s+/).map((id) => document.getElementById(id)).filter(Boolean);
  if (!inputs.length) return;
  if (!key.hasAttribute('aria-haspopup')) key.setAttribute('aria-haspopup', 'dialog');

  // the key's name: what it does, and the date it holds in words
  const lang = () => el.closest('[lang]')?.getAttribute('lang') || navigator.language || 'en';
  const name = () => {
    const say = key.dataset.vxSay || 'Choose a date';
    const fmt = new Intl.DateTimeFormat(lang(), { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const words = inputs.map((i) => (/^\d{4}-\d{2}-\d{2}$/.test(i.value) ? fmt.format(Date.parse(i.value)) : '')).filter(Boolean);
    const v = words.length ? `${say}, ${words.join(' – ')}` : say;
    if (key.getAttribute('aria-label') !== v) key.setAttribute('aria-label', v);
  };
  for (const i of inputs) { on(i, 'input', name); on(i, 'change', name); on.heed(i, 'value', name); }
  name();
  // an input that cannot be changed: its key cannot open the calendar either
  const lock = () => { const off = inputs.every((i) => i.disabled || i.readOnly); if (off !== (key.getAttribute('aria-disabled') === 'true')) { if (off) key.setAttribute('aria-disabled', 'true'); else key.removeAttribute('aria-disabled'); } };
  for (const i of inputs) on.watch(i, { attributes: true, attributeFilter: ['disabled', 'readonly'] }, lock);
  on(key, 'click', (e) => { if (key.getAttribute('aria-disabled') === 'true') e.preventDefault(); }, { capture: true });
  lock();

  // open: the focus goes to the day that is the tab stop. Closed with the focus still in it (a
  // choice, Escape): the focus goes back to the key.
  on(float, 'toggle', (e) => {
    if (e.newState === 'open') requestAnimationFrame(() => float.querySelector('.vx-calendar-day[tabindex="0"]')?.focus());
    else if (!document.activeElement || document.activeElement === document.body || float.contains(document.activeElement)) key.focus();
  });
  on(cal, 'vx-choose', (e) => { if (e.detail.done && float.matches(':popover-open')) float.hidePopover(); });

  // from here the key stands in for the browser's own picker
  el.setAttribute('data-vx-on', '');
  on({ addEventListener() {}, removeEventListener() { el.removeAttribute('data-vx-on'); } }, 'end', name);
}

export const datePicker = {
  name: 'date-picker',
  selector: '.vx-date',
  pad: 0,
  bind(live) { const on = listeners(); wire(live.el, on); return on.done; },
  plain: wire,
};
