// Questionnaire. A question inside a message, with a few answers to press: one of them, or
// several. Once answered it stays where it is, as the record of what was said.
// Tool: none of its own. One of many is the kit's toggle group standing (a trench of seats over
// real radio buttons); several of many are the kit's checkboxes, or its toggle buttons; the key
// that sends the answer is the kit's key. This file is what happens when that key is pressed.
// Markup: <fieldset class="vx-questionnaire">
//           <legend>When should harbor-api go out?</legend>
//           <div class="vx-toggle-group" data-vx-way="down">
//             <label><input type="radio" name="when" value="now">Now</label>
//             <label><input type="radio" name="when" value="tonight">Tonight, after the backup</label>
//           </div>
//           <button class="vx-button vx-questionnaire-send" data-vx-kind="main" type="button">Answer</button>
//           <p class="vx-questionnaire-note" role="status"></p>
//         </fieldset>
//         Several of many: <div class="vx-questionnaire-answers"><label class="vx-check">…</label>…</div>
//         in place of the toggle group.
// The fieldset and its legend are the group and its name; the radios and checkboxes are the
// browser's own, with its keys (arrows in a radio group, Space on a checkbox, Tab between).
// Behaviour: a press on the key with nothing chosen says so in the note, in words, and changes
// nothing (data-vx-optional on the fieldset lets an empty answer through). With something
// chosen, every answer is disabled, the fieldset is disabled and marked data-vx-answered, the
// key goes, and the note says what was answered ("Answered: Tonight, after the backup"; the
// word before the colon is data-vx-said, the words for nothing chosen are data-vx-ask). The
// fieldset then says `vx-answer` ({ values, labels }; it bubbles). Focus goes to the note.
// A questionnaire that was answered before the page was made is written that way: disabled on
// the fieldset and on each input, data-vx-answered, no key, the note already filled in.
// (The part's own element is the legend: the fieldset is found from it.)


const text = (n) => n.textContent.replace(/\s+/g, ' ').trim();
// the words beside an input: its label, without what the kit put in it
function words(input) {
  const label = input.closest('label');
  if (!label) return input.value;
  return text(label.querySelector(':scope > .vx-label') ?? label);
}

function wire(legend, on) {
  const el = legend.closest('.vx-questionnaire');
  if (!el) return;
  const note = () => el.querySelector('.vx-questionnaire-note');
  const inputs = () => [...el.querySelectorAll('input[type="radio"], input[type="checkbox"]')];
  const keys = () => [...el.querySelectorAll('.vx-toggle-button')];
  const chosen = () => [
    ...inputs().filter((i) => i.checked).map((i) => ({ value: i.value, label: words(i) })),
    ...keys().filter((k) => k.getAttribute('aria-pressed') === 'true').map((k) => ({ value: k.dataset.value ?? text(k), label: text(k) })),
  ];
  const say = (what, asking) => {
    const n = note();
    if (n) n.textContent = what;
    el.toggleAttribute('data-vx-asking', asking);
  };
  const answer = () => {
    if (el.hasAttribute('data-vx-answered')) return;
    const picks = chosen();
    if (!picks.length && !el.hasAttribute('data-vx-optional')) return say(el.dataset.vxAsk || 'Choose an answer first.', true);
    for (const i of inputs()) i.disabled = true;
    for (const k of keys()) k.setAttribute('aria-disabled', 'true');
    const send = el.querySelector('.vx-questionnaire-send');
    if (send) send.hidden = true;
    el.disabled = true;
    el.setAttribute('data-vx-answered', '');
    say(`${el.dataset.vxSaid || 'Answered'}: ${picks.length ? picks.map((p) => p.label).join(', ') : (el.dataset.vxNone || 'none of these')}`, false);
    // the key that had focus is gone: the record takes it
    const n = note();
    if (n) { if (!n.hasAttribute('tabindex')) n.tabIndex = -1; n.focus({ preventScroll: true }); }
    el.dispatchEvent(new CustomEvent('vx-answer', { bubbles: true, detail: { values: picks.map((p) => p.value), labels: picks.map((p) => p.label) } }));
  };
  on(el, 'click', (e) => { if (e.target.closest?.('.vx-questionnaire-send')) answer(); });
  // an answer is chosen: what the note asked for has been done
  const calm = () => { if (el.hasAttribute('data-vx-asking') && chosen().length) say('', false); };
  on(el, 'change', calm);
  on(el, 'vx-change', calm);
}

export const questionnaire = {
  name: 'questionnaire',
  selector: '.vx-questionnaire > legend',
  plain: wire,
};
