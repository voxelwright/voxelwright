// Field with error and validation. The field is the well, as it is. Invalid, its rim is red (the
// well reads aria-invalid on the control and draws that itself), and the message below is words
// beside a red lamp. Valid needs nothing.
// Tool: the well, and a lamp. This part draws no voxels: it is the behaviour of the message.
// Markup: <div class="vx-field">
//           <label class="vx-field-label" for="mail">Email</label>
//           <span class="vx-well"><input id="mail" type="email" required></span>
//           <p class="vx-field-hint" id="mail-hint">…</p>                          (optional)
//           <p class="vx-field-error" id="mail-error"><span class="vx-lamp" data-vx-light="stop"></span><span class="vx-field-error-text"></span></p>
//         </div>
// The state is the control's: aria-invalid="true", and the message's id in its aria-describedby.
// A page that knows the field is wrong writes both (and the words), and no script is needed.
// With the script the browser's own rules (required, type, pattern, min, max, setCustomValidity)
// are asked: a field is marked when it is left changed and wrong, or when its form is sent; it
// is cleared as soon as what is typed is right. Words left empty are the browser's own, in the
// reader's language. aria-invalid set from code is heard, and the message is tied or untied.

import { listeners } from './util.js';

const CONTROL = 'input, textarea, select';

function wire(note, on) {
  const field = note.closest('.vx-field');
  const input = field?.querySelector(CONTROL);
  if (!input) return;
  // the words have a span of their own, beside the lamp: one is made where the page left it out
  let words = note.querySelector('.vx-field-error-text');
  if (!words) {
    words = document.createElement('span');
    words.className = 'vx-field-error-text';
    for (const n of [...note.childNodes]) if (n.nodeType === 3 || (n.nodeType === 1 && !n.matches('.vx-lamp, .vx-canvas'))) words.append(n);
    note.append(words);
  }
  const own = words.textContent.trim() !== ''; // the page wrote the words: they are kept
  if (!note.id) note.id = `${input.id || 'vx-field'}-error-${Math.random().toString(36).slice(2, 7)}`;
  const bad = () => input.getAttribute('aria-invalid') === 'true';

  // the message is the control's description only while it is wrong: a description is read even
  // when it cannot be seen
  const tie = () => {
    const ids = (input.getAttribute('aria-describedby') || '').split(/\s+/).filter((id) => id && id !== note.id);
    if (bad()) ids.push(note.id);
    const next = ids.join(' ');
    if (next === (input.getAttribute('aria-describedby') || '')) return;
    if (next) input.setAttribute('aria-describedby', next); else input.removeAttribute('aria-describedby');
  };
  const clear = () => {
    if (bad()) input.removeAttribute('aria-invalid');
    if (!own) words.textContent = '';
    tie();
  };
  const check = () => {
    if (!input.willValidate || input.validity.valid) return clear();
    if (!own) words.textContent = input.validationMessage;
    if (!bad()) input.setAttribute('aria-invalid', 'true');
    tie();
  };

  // the form was sent with this field wrong: the message stands in for the browser's bubble, and
  // the first wrong field takes focus, which is when its message is read out
  on(input, 'invalid', (e) => {
    e.preventDefault();
    check();
    const first = input.form && [...input.form.elements].find((c) => c.willValidate && !c.validity.valid);
    if (!first || first === input) input.focus();
  });
  // left, changed: say so now. While it is marked, every keystroke is asked, so it clears at once.
  on(input, 'change', check);
  on(input, 'input', () => { if (bad()) check(); });
  if (input.form) on(input.form, 'reset', clear);
  // marked or cleared from code
  on.watch(input, { attributes: true, attributeFilter: ['aria-invalid'] }, tie);
  tie();
}

export const validation = {
  name: 'validation',
  selector: '.vx-field-error',
  pad: 0,
  build() {}, // nothing of its own to draw: the well and the lamp are parts already
  bind(live) {
    const on = listeners();
    wire(live.el, on);
    return on.done;
  },
  plain: wire,
};
