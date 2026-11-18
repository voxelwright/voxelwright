// Radio group. Each choice is a latching push-button with its lamp in its cap, standing in a
// steel collar: the checkbox's button with its corners stepped. The chosen one is latched down,
// level with its collar, and its lamp is on; choosing another lets it up again, as the buttons of
// a radio do, which is where the name is from.
// Tool: key (a cap, drawn by cap()) and lamp. The object is `latch` in checkbox.js; the two are a pair.
// Markup: <fieldset class="vx-radios" role="radiogroup">
//           <legend>Deploy to</legend>
//           <label class="vx-radio"><input type="radio" name="where" value="fra" checked><span class="vx-dot"></span>Frankfurt</label>
//           <label class="vx-radio"><input type="radio" name="where" value="iad"><span class="vx-dot"></span>Virginia</label>
//         </fieldset>
// The inputs are real radios of one name, so the browser gives the group its keys: one tab stop
// (the chosen one, or the first), arrow keys that move the choice and go round at the ends, Space
// to choose the one in focus. This part only draws what the inputs say.

import { halo } from '../core/light.js';
import { cue } from '../core/sound.js';
import { watchFieldsets, listeners } from './util.js';
import { latch, latchPose, latchTo, latchHold } from './checkbox.js';

const GLOW = 0.06, REACH = 3; // the checkbox's own light

const level = (input) => (input?.checked ? 1 : 0);
const inputOf = (el) => el.parentElement.querySelector('input[type="radio"]');
/** The radios an input is one of: the same name, in the same form (or in none). */
const group = (input) => (input.name
  ? [...input.getRootNode().querySelectorAll('input[type="radio"]')].filter((r) => r.name === input.name && r.form === input.form)
  : [input]);

export const radio = {
  name: 'radio',
  selector: '.vx-dot',
  pad: 7,
  glowRadius: REACH,
  glowStrength: halo(GLOW),

  build(live, m) {
    const input = live.state.input = inputOf(live.el);
    latch(live, m, { r: 2, off: !!input?.matches(':disabled') });
    // the first drawing is as it is, with nothing moving
    const s = live.spring('on', level(input));
    if (live.state.built === undefined) s.snap(level(input));
    live.state.built = true;
  },

  pose: latchPose,

  bind(live) {
    const on = listeners();
    const input = inputOf(live.el);
    if (!input) return on.done;
    // with less motion asked for the cap does not travel: it is down, or it is up (latchTo sees to that)
    const set = () => { latchTo(live, level(input)); };
    latchHold(live, input, on);
    live.state.sync = set;
    // Choosing one radio empties another, and the one that is emptied is told nothing: no event,
    // no property set. So each listens for a choice anywhere in its group.
    const mine = (e) => e.target?.type === 'radio' && e.target.name === input.name && e.target.form === input.form;
    on(input.getRootNode(), 'change', (e) => { if (!mine(e)) return; if (e.target === input) cue('tick'); set(); });
    // set from code: the whole group follows, without a sound
    on.heed(input, 'checked', () => { for (const r of group(input)) live.stage.lives.get(r.parentElement?.querySelector('.vx-dot'))?.state.sync?.(); });
    // a form put back to how it began: the inputs change after the event, so look a moment later
    if (input.form) on(input.form, 'reset', () => setTimeout(set));
    on.watch(input, { attributes: true, attributeFilter: ['disabled'] }, () => live.rebuild());
    watchFieldsets(input, on, () => live.rebuild());
    return on.done;
  },
};
