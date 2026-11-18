// Theme picker. One small part a site puts in its header or its settings, and the one place the
// whole site's theme is set from: a bank of seats for the theme, each with a lamp of that
// theme's own accent, and a bank for the time of day (day, night, or as the system has it).
// Tool: the kit's trench of seats (.vx-toggle-group, one of many), which this part does not
// draw; it draws only the lamps (a lamp in a collar, as .vx-lamp is), and does the choosing.
// Markup: <div class="vx-theme-picker">
//           <div class="vx-toggle-group" role="radiogroup" aria-label="Theme" data-vx-pick="theme" data-vx-size="small"></div>
//           <div class="vx-toggle-group" role="radiogroup" aria-label="Time of day" data-vx-pick="time" data-vx-size="small">
//             <label><input type="radio" name="time" value="light">Day</label>
//             <label><input type="radio" name="time" value="dark">Night</label>
//             <label><input type="radio" name="time" value="system" checked>System</label>
//           </div>
//         </div>
//   The theme bank is filled from THEMES (src/looks/lit.js), so a theme a site defines itself
//   (THEMES.tide = { light, cap, link, legend, label? }, before adopt()) has its seat with no more
//   said. A site that wants its own words, or no change of width when the script arrives, writes
//   the seats out: <label><input type="radio" value="rose"><span class="vx-theme-lamp"></span><span class="vx-label">Rose</span></label>
//   Either bank may be left out. Real radio buttons underneath: one tab stop a bank, the arrow
//   keys move the choice, Space takes it.
//
// What it does with a choice:
//   theme        the kit's theme(name): every part is recoloured, the stylesheet's tokens follow,
//                and <html> carries data-vx-theme="name"
//   time of day  data-theme="light" or "dark" on <html>; "system" takes the attribute off, and
//                the stylesheet follows prefers-color-scheme by itself
//   remembers    localStorage "vx-theme": { time, theme, vars } (vars: the --lit-* tokens)
//   tells        a `vx-theme` event that bubbles from the picker (from document when the cause is
//                the system or another tab): detail { theme, time, night }
// Every picker on a page, and every tab of the site, follows the others.
//
// Before first paint. A module runs after the page is first painted, so a site pastes this into
// <head>, before its stylesheets (it is EARLY below, 368 bytes, and needs nothing):
//   <script>(function(){try{var d=document.documentElement,s=JSON.parse(localStorage.getItem('vx-theme'))||{},k;if(s.time=='light'||s.time=='dark')d.setAttribute('data-theme',s.time);else if(s.time=='system')d.removeAttribute('data-theme');if(s.theme)d.setAttribute('data-vx-theme',s.theme);for(k in s.vars)if(k.indexOf('--lit-')==0)d.style.setProperty(k,s.vars[k])}catch(e){}})()</script>
// With no script at all, and for someone who has chosen nothing, the page follows the system.
//
// From code: pick({ theme: 'rose', time: 'dark' }) sets either or both; picked() says what
// holds now; restore() applies what is remembered on a page that has no picker on it.

import { THEMES } from '../looks/lit.js';
import { MATERIALS, defineMaterial } from '../core/materials.js';
import { halo, byTheme } from '../core/light.js';
import { listeners } from './util.js';

const KEY = 'vx-theme';
const TIMES = ['light', 'dark', 'system'];

/** The script a site pastes into <head>: what is remembered, set before the first paint. */
export const EARLY = "(function(){try{var d=document.documentElement,s=JSON.parse(localStorage.getItem('vx-theme'))||{},k;if(s.time=='light'||s.time=='dark')d.setAttribute('data-theme',s.time);else if(s.time=='system')d.removeAttribute('data-theme');if(s.theme)d.setAttribute('data-vx-theme',s.theme);for(k in s.vars)if(k.indexOf('--lit-')==0)d.style.setProperty(k,s.vars[k])}catch(e){}})()";

const html = () => document.documentElement;
const dark = () => matchMedia('(prefers-color-scheme: dark)');
const remembered = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const remember = (s) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* no storage: the choice holds for this page */ } };

const timeNow = () => { const t = html().dataset.theme; return t === 'light' || t === 'dark' ? t : 'system'; };
// the theme that holds: the one <html> names, or the one whose light the look is drawn in now
const themeNow = () => {
  const n = html().dataset.vxTheme;
  if (n && THEMES[n]) return n;
  if (n !== undefined) return null; // named, and not one of ours
  const now = MATERIALS.light?.hex;
  return Object.keys(THEMES).find((k) => THEMES[k].light.day === now?.day && THEMES[k].light.night === now?.night) ?? null;
};
const nightNow = () => { const t = timeNow(); return t === 'dark' || (t === 'system' && dark().matches); };
// the tokens the kit's theme() wrote on <html>, so the early script can write them again
const tokens = () => { const st = html().style, out = {}; for (const k of st) if (k.startsWith('--lit-')) out[k] = st.getPropertyValue(k); return out; };

/** What holds now: { theme: a name from THEMES or null, time: 'light' | 'dark' | 'system', night }. */
export const picked = () => ({ theme: themeNow(), time: timeNow(), night: nightNow() });

// The kit's own theme() lives in index.js, which imports this file: it is asked for when it is
// first needed, and is there by then.
let kit = null, asking = null;
const withKit = () => (asking ??= import('../index.js').then((k) => (kit = k)));

const pickers = new Set(); // each picker's own "show what holds"
function tell(from) {
  for (const show of pickers) show();
  (from?.isConnected ? from : document).dispatchEvent(new CustomEvent('vx-theme', { bubbles: true, detail: picked() }));
}

function apply({ theme, time }) {
  if (TIMES.includes(time)) { if (time === 'system') html().removeAttribute('data-theme'); else html().dataset.theme = time; }
  if (theme && THEMES[theme]) kit.theme(theme);
}

/** Set the theme, the time of day, or both, from code. Every picker follows. Returns a promise for what then holds. */
export function pick(choice = {}, from) {
  return withKit().then(() => {
    apply(choice);
    remember({ time: timeNow(), theme: themeNow(), vars: tokens() });
    tell(from);
    return picked();
  });
}

// Once a page: what is remembered is applied (the early script has set the tokens; the voxels'
// own colours are set here), and the system and the site's other tabs are listened to.
let begun = null;
/** Apply what is remembered. A picker does this by itself; a page with none on it calls this. */
export function restore() {
  return (begun ??= withKit().then(() => {
    const s = remembered();
    const theme = THEMES[s.theme] ? s.theme : null;
    const was = picked();
    apply({ theme: theme && (theme !== html().dataset.vxTheme || MATERIALS.light?.hex?.day !== THEMES[theme].light.day) ? theme : null, time: s.time });
    // a theme that was remembered and is no longer one of the site's: back to the kit's own
    if (s.theme && !theme) { kit.theme(); remember({ time: timeNow(), theme: themeNow(), vars: tokens() }); }
    dark().addEventListener('change', () => { if (timeNow() === 'system') tell(); });
    addEventListener('storage', (e) => {
      if (e.key !== KEY) return;
      const next = remembered();
      apply({ theme: next.theme !== themeNow() ? next.theme : null, time: next.time });
      tell();
    });
    const now = picked();
    if (now.theme !== was.theme || now.time !== was.time) tell();
    return now;
  }));
}

// ---------------------------------------------------------------------------------------------
// The lamps. A theme's accent is the one colour that is not the look's own: each theme gets a
// light of its own, named for it and read from THEMES, and nothing else in the kit uses it.
function lightOf(name) {
  const th = THEMES[name];
  if (!th?.light) return 'steel';
  const id = 'theme:' + name, have = MATERIALS[id]?.hex;
  if (!have || have.day !== th.light.day || have.night !== th.light.night) defineMaterial(id, { day: th.light.day, night: th.light.night ?? th.light.day, jitter: 0, glow: 1 });
  return id;
}
const inputOf = (lamp) => lamp.closest('label')?.querySelector('input');
const nameOf = (lamp) => lamp.dataset.vxTheme || inputOf(lamp)?.value || '';
const isLamp = (el) => el.classList.contains('vx-theme-lamp');
const words = (name) => THEMES[name]?.label ?? name.charAt(0).toUpperCase() + name.slice(1);

// A seat as the trench wants it: the radio, the lamp, then the words in a span of their own.
function dress(seat, name) {
  const input = seat.querySelector('input');
  let lamp = seat.querySelector('.vx-theme-lamp');
  if (!lamp) { lamp = document.createElement('span'); lamp.className = 'vx-theme-lamp'; input.after(lamp); }
  lamp.setAttribute('aria-hidden', 'true');
  const th = THEMES[name];
  if (th?.light) { lamp.style.setProperty('--_day', th.light.day); lamp.style.setProperty('--_night', th.light.night ?? th.light.day); }
  let label = seat.querySelector('.vx-label');
  if (!label) {
    label = document.createElement('span');
    label.className = 'vx-label';
    for (const n of [...seat.childNodes]) if (!(n.nodeType === 1 && n.matches('input, .vx-canvas, .vx-theme-lamp'))) label.append(n);
    seat.append(label);
  }
  if (!label.textContent.trim()) label.textContent = words(name);
  return lamp;
}

let made = 0;

// The picker itself: the seats, the choosing, and showing what holds. `stage` is there when the
// page is drawn in voxels; `def` is this part, for the lamps it makes.
function wire(el, on, stage, def) {
  const id = ++made;
  const themes = el.querySelector('[data-vx-pick="theme"]'), times = el.querySelector('[data-vx-pick="time"]');
  const radios = (bank) => (bank ? [...bank.querySelectorAll('input[type="radio"]')] : []);
  const again = (node) => stage?.lives.get(node)?.rebuild();

  // a seat for every theme there is; the ones written out are kept, with their own words
  function seats() {
    if (!themes) return;
    let grew = false;
    for (const name of Object.keys(THEMES)) {
      if (radios(themes).some((r) => r.value === name)) continue;
      const seat = document.createElement('label'), input = document.createElement('input');
      input.type = 'radio'; input.value = name;
      seat.append(input);
      themes.append(seat);
      grew = true;
    }
    for (const r of radios(themes)) {
      r.name = `vx-theme-${id}`; // a bank is one group, and two pickers on a page are two
      const lamp = dress(r.closest('label'), r.value);
      if (stage && !stage.lives.has(lamp)) { stage.add(lamp, def); grew = true; }
    }
    for (const r of radios(times)) r.name = `vx-time-${id}`;
    measure();
    if (grew) again(themes); // the trench was drawn before its seats were there
  }

  // Equal seats in one row; where a row of them does not fit, as many to a row as do, so a
  // theme's name is never broken up. The widest seat is measured with its words on one line.
  function measure() {
    if (!themes || !themes.isConnected) return;
    const vx = parseFloat(getComputedStyle(themes).getPropertyValue('--vx')) || 4;
    const all = [...themes.querySelectorAll(':scope > label')];
    let widest = 0;
    for (const seat of all) {
      const cs = getComputedStyle(seat), label = seat.querySelector('.vx-label'), lamp = seat.querySelector('.vx-theme-lamp');
      if (!label) continue;
      widest = Math.max(widest, label.getBoundingClientRect().width + (lamp ? lamp.offsetWidth + (parseFloat(cs.columnGap) || 0) : 0) + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight));
    }
    const seat = Math.ceil(widest / vx - 0.01) * vx;
    if (!seat) return;
    const was = themes.style.gridTemplateColumns;
    // every seat is as wide as the widest, so each is a whole number of voxels; laid in one row,
    // the bank is as wide as its place lets it be, and that says how many fit
    themes.style.gridAutoFlow = 'row';
    themes.style.gridTemplateColumns = `repeat(${all.length}, ${seat}px)`;
    const cols = Math.max(1, Math.min(all.length, Math.floor((themes.clientWidth + 0.5) / seat)));
    const next = `repeat(${cols}, minmax(0, ${seat}px))`;
    themes.style.gridTemplateColumns = next;
    if (next !== was) again(themes);
  }

  // the seats say what holds. A bank a person has just changed already says it, and is left alone.
  function show() {
    const want = [[themes, themeNow()], [times, timeNow()]];
    for (const [bank, value] of want) {
      if (!bank) continue;
      let changed = false;
      for (const r of radios(bank)) { const is = r.value === value; if (r.checked !== is) { r.checked = is; changed = true; } }
      if (changed) again(bank);
    }
    if (themes) for (const lamp of themes.querySelectorAll('.vx-theme-lamp')) stage?.lives.get(lamp)?.invalidate();
  }

  seats();
  document.fonts?.ready.then(measure); // the words are wider in their own face
  // its place grows or shrinks: the seats are counted again
  let seen = false;
  const place = new ResizeObserver(() => { if (seen) measure(); else seen = true; });
  if (el.parentElement) place.observe(el.parentElement);
  el.setAttribute('data-vx-picker', '');
  pickers.add(show);
  on(el, 'change', (e) => {
    const r = e.target;
    if (!r.matches?.('input[type="radio"]') || !r.checked) return;
    if (themes?.contains(r)) pick({ theme: r.value }, el);
    else if (times?.contains(r)) pick({ time: r.value }, el);
  });
  // a choice in the markup that nothing remembered or set overrules: the site's own first theme
  const first = radios(themes).find((r) => r.defaultChecked)?.value;
  restore().then(() => {
    if (!pickers.has(show)) return;
    if (first && THEMES[first] && !remembered().theme && html().dataset.vxTheme === undefined && first !== themeNow()) { apply({ theme: first }); tell(el); }
    else show();
  });
  return { seats, gone: () => { pickers.delete(show); place.disconnect(); } };
}

export const themePicker = {
  name: 'theme-picker',
  selector: '.vx-theme-picker, .vx-theme-lamp',
  draws: isLamp,
  refresh(live) { live.state.seats(); },
  pad: 6,
  glowRadius: 3.4,
  glowStrength: halo(0.16),

  build(live, m) {
    const { W, H, el } = live;
    // a lamp in its collar, as the kit's lamp is: the collar is a voxel wide, past the element's box
    m.part('collar').slab(-1, -1, 0, W + 2, H + 2, 1, 'steel', 1).carve(0, 0, 0, W, H, 1);
    m.part('lamp').box(0, 0, 0, W, H, 2, lightOf(nameOf(el)));
    live.faceZ = 1;
  },

  pose(live) {
    if (!isLamp(live.el)) return;
    // the chosen theme's lamp is the bright one; the others are lit, so their colours can be told
    live.glowStrength = halo(inputOf(live.el)?.checked ? 0.16 : 0.05) * byTheme(live);
  },

  bind(live) {
    if (isLamp(live.el)) return null;
    const on = listeners();
    const { seats, gone } = wire(live.el, on, live.stage, live.def);
    live.state.seats = seats;
    return () => { gone(); on.done(); };
  },

  plain(el, on) { if (!isLamp(el)) return wire(el, on, null, null).gone; },
};
