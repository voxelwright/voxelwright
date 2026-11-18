// Calendar. A month on the surface. The days are words; the chosen day is a key level with the
// surface, standing on its light in a seat cut for it; a range is a trench with light on its
// floor, a key at each end and a plain tile under each day between, so no word lies on bare
// light; today has a lamp under its number.
// Tool: none for the days (words), well and key for what is chosen, a lamp for today. Previous
// and next month are the kit's keys (.vx-button).
// Markup: <div class="vx-calendar"><input type="date" aria-label="Deploy on" value="2026-11-20"></div>
//         Two date inputs make it a range (the first is the start, the second the end).
//         data-vx-for="a b" names inputs elsewhere instead (the date picker does this).
//         min and max on the input are the first and last day that can be chosen; disabled
//         or readonly, no day can be (the month can still be read and turned).
//         data-vx-prev / data-vx-next on it name the two keys in the page's language;
//         data-vx-today="2026-11-17" fixes today (for a page that is a picture of a day).
// With no script it is the browser's own date input. With script the input is kept (it holds the
// value, goes with the form, and sends `input` and `change` when a day is chosen) and hidden, and
// the month is drawn under it: a grid (role="grid"), six rows of seven days, each a real button.
// The calendar takes the hidden input's name (role="group"), and the grid is named by the month.
// The week begins on the day the page's language begins it (Monday for Ukrainian, Sunday for
// American English), from the nearest lang.
// Keys, with a day in focus (one day is the tab stop):
//   arrows             a day back or on, a week up or down (mirrored right to left)
//   Home, End          the first and last day of the week
//   Page Up, Page Down a month back or on; with Shift a year
//   Enter, Space       choose the day (in a range: its start, then its end)
// The month's name is read out when it changes (aria-live). `vx-choose` comes from the calendar
// after each choice (detail.value; detail.done is true once a range has both ends).

import { ring, hole, halo, byTheme, lightName, cap as capOf } from '../core/light.js';
import { cue } from '../core/sound.js';
import { listeners } from './util.js';
import { button } from './button.js';

const DAY = 864e5;
const GLOW = 0.07;

// ---- days, as UTC midnights: no time zone moves a day
const parse = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s || '') ? Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) : null);
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const first = (t) => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); };
const months = (t, n) => {
  const d = new Date(t), y = d.getUTCFullYear(), m = d.getUTCMonth() + n;
  return Date.UTC(y, m, Math.min(d.getUTCDate(), new Date(Date.UTC(y, m + 1, 0)).getUTCDate()));
};
const localToday = () => { const n = new Date(); return Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()); };

/** The day a week begins on in a language, 0 Sunday to 6 Saturday. */
export function weekStart(lang) {
  try {
    const l = new Intl.Locale(lang), w = l.getWeekInfo?.() ?? l.weekInfo;
    if (w?.firstDay) return w.firstDay % 7;
  } catch { /* an unknown language: below */ }
  return /^en(-US)?$/i.test(lang) ? 0 : 1;
}

const set = (el, name, v) => { if (v === null) { if (el.hasAttribute(name)) el.removeAttribute(name); } else if (el.getAttribute(name) !== v) el.setAttribute(name, v); };
let ids = 0;

/** The calendar's DOM: made once, found again after that. */
function dom(el) {
  let head = el.querySelector(':scope > .vx-calendar-head'), grid = el.querySelector(':scope > .vx-calendar-grid');
  if (head && grid) return { head, grid, made: false };
  const id = `vx-cal-${++ids}`;
  head = document.createElement('div');
  head.className = 'vx-calendar-head';
  const key = (way) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'vx-button'; b.dataset.vxStep = way;
    b.innerHTML = '<span class="vx-calendar-chevron" aria-hidden="true"></span>';
    return b;
  };
  const month = document.createElement('div');
  month.className = 'vx-calendar-month'; month.id = `${id}-month`; month.setAttribute('aria-live', 'polite');
  head.append(key('prev'), month, key('next'));
  grid = document.createElement('div');
  grid.className = 'vx-calendar-grid'; grid.setAttribute('role', 'grid'); grid.setAttribute('aria-labelledby', month.id);
  const names = document.createElement('div');
  names.className = 'vx-calendar-names'; names.setAttribute('role', 'row');
  for (let i = 0; i < 7; i++) { const n = document.createElement('span'); n.className = 'vx-calendar-name'; n.setAttribute('role', 'columnheader'); names.append(n); }
  grid.append(names);
  for (let w = 0; w < 6; w++) {
    const row = document.createElement('div');
    row.className = 'vx-calendar-week'; row.setAttribute('role', 'row');
    for (let i = 0; i < 7; i++) {
      const cell = document.createElement('span');
      cell.className = 'vx-calendar-cell'; cell.setAttribute('role', 'gridcell');
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'vx-calendar-day'; b.tabIndex = -1;
      cell.append(b); row.append(cell);
    }
    grid.append(row);
  }
  el.append(head, grid);
  return { head, grid, made: true };
}

/**
 * The calendar's behaviour, with voxels or without. Returns its keys and its week rows (for the
 * voxels) and `chose`, called after each choice.
 */
function wire(el, on) {
  const inputs = el.dataset.vxFor
    ? el.dataset.vxFor.split(/\s+/).map((id) => document.getElementById(id)).filter(Boolean)
    : [...el.querySelectorAll(':scope > input[type="date"]')];
  const st = { keys: [], rows: [], chose: () => {} };
  if (!inputs.length) return st;
  const range = inputs.length > 1;
  const { head, grid, made } = dom(el);
  const [prev, month, next] = head.children;
  const names = [...grid.querySelector('.vx-calendar-names').children];
  const rows = [...grid.querySelectorAll(':scope > .vx-calendar-week')];
  const cells = rows.flatMap((r) => [...r.children]);
  st.keys = [prev, next]; st.rows = rows;
  // the inputs that are the calendar's own are hidden: it stands in for them
  const own = inputs.filter((i) => el.contains(i) && !i.hidden);
  for (const i of own) i.hidden = true;
  if (range) grid.setAttribute('aria-multiselectable', 'true');

  const lang = () => el.closest('[lang]')?.getAttribute('lang') || navigator.language || 'en';
  const rtl = () => getComputedStyle(grid).direction === 'rtl';
  const today = () => parse(el.dataset.vxToday) ?? localToday();
  const lo = () => parse(inputs[0].min), hi = () => parse(inputs[0].max);
  const clampDay = (t) => { const a = lo(), b = hi(); return a !== null && t < a ? a : b !== null && t > b ? b : t; };
  const out = (t) => { const a = lo(), b = hi(); return (a !== null && t < a) || (b !== null && t > b); };
  const values = () => inputs.map((i) => parse(i.value));
  // an input that cannot be changed: the month can still be read and turned, but no day chosen
  const locked = () => inputs.some((i) => i.disabled || i.readOnly);
  // the calendar is named by its input's name, which it hides: the grid then says the month
  if (own.length && !el.hasAttribute('aria-label') && !el.hasAttribute('aria-labelledby')) {
    const i = inputs[0], by = i.getAttribute('aria-labelledby');
    const name = (by ? by.split(/\s+/).map((id) => document.getElementById(id)?.textContent.trim()).filter(Boolean).join(' ') : '') || i.getAttribute('aria-label') || [...(i.labels ?? [])].map((l) => l.textContent.trim()).join(' ');
    if (name) { el.setAttribute('role', 'group'); el.setAttribute('aria-label', range ? [name, inputs[1].getAttribute('aria-label')].filter(Boolean).join(', ') : name); st.named = true; }
  }

  // where it is: the month it shows, and the day that is the tab stop
  const start = values()[0] ?? clampDay(today());
  let view = first(start), focus = start;

  const render = (take = false) => {
    const L = lang(), ws = el.dataset.vxWeekStart !== undefined ? Number(el.dataset.vxWeekStart) % 7 : weekStart(L);
    const fmt = (o) => new Intl.DateTimeFormat(L, { timeZone: 'UTC', ...o });
    const long = fmt({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    month.textContent = fmt({ month: 'long', year: 'numeric' }).format(view);
    // the names of the days, from a week that begins on the right day (4 January 1970 was a Sunday)
    const short = fmt({ weekday: 'short' }), full = fmt({ weekday: 'long' });
    names.forEach((n, i) => { const t = (3 + ((ws + i) % 7)) * DAY; if (n.textContent !== short.format(t)) n.textContent = short.format(t); set(n, 'aria-label', full.format(t)); });
    const [a, b] = values(), now = today();
    const from = view - ((new Date(view).getUTCDay() - ws + 7) % 7) * DAY;
    const viewMonth = new Date(view).getUTCMonth();
    cells.forEach((cell, i) => {
      const t = from + i * DAY, btn = cell.firstElementChild, d = new Date(t);
      const s = String(d.getUTCDate());
      if (btn.textContent !== s) btn.textContent = s;
      btn.dataset.vxDay = iso(t);
      set(btn, 'aria-label', long.format(t));
      set(btn, 'aria-current', t === now ? 'date' : null);
      set(btn, 'aria-disabled', out(t) || locked() ? 'true' : null);
      set(cell, 'data-vx-out', d.getUTCMonth() !== viewMonth ? '' : null);
      // what is chosen: one day; or a range's start, its end, and the days between
      let mark = null;
      if (!range || b === null || a === null) mark = t === a ? 'one' : null;
      else if (t === a && t === b) mark = 'one';
      else if (t === a) mark = 'start';
      else if (t === b) mark = 'end';
      else if (t > a && t < b) mark = 'mid';
      set(cell, 'data-vx-mark', mark);
      set(cell, 'aria-selected', mark ? 'true' : range || a !== null ? 'false' : null);
      btn.tabIndex = t === focus ? 0 : -1;
    });
    // a month before the first day that can be chosen, or after the last, is not gone to
    const a0 = lo(), b0 = hi();
    set(prev, 'aria-disabled', a0 !== null && view <= first(a0) ? 'true' : null);
    set(next, 'aria-disabled', b0 !== null && view >= first(b0) ? 'true' : null);
    set(prev, 'aria-label', el.dataset.vxPrev || 'Previous month');
    set(next, 'aria-label', el.dataset.vxNext || 'Next month');
    if (take) cells.find((c) => c.firstElementChild.tabIndex === 0)?.firstElementChild.focus();
  };

  // the tab stop goes to day t, and the month with it
  const go = (t, take) => { focus = clampDay(t); if (first(focus) !== view) view = first(focus); render(take); };

  // a day chosen: the input says so, as if it had been typed in
  let writing = false;
  const write = (input, t) => {
    const v = t === null ? '' : iso(t);
    if (input.value === v) return;
    writing = true;
    input.value = v;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    writing = false;
  };
  const choose = (t) => {
    if (locked()) return;
    let done = true;
    if (!range) write(inputs[0], t);
    else {
      const [a, b] = values();
      if (a === null || b !== null) { write(inputs[1], null); write(inputs[0], t); done = false; }
      else if (t < a) { write(inputs[1], a); write(inputs[0], t); }
      else write(inputs[1], t);
    }
    focus = t;
    if (first(t) !== view) view = first(t);
    render(grid.contains(document.activeElement));
    st.chose();
    el.dispatchEvent(new CustomEvent('vx-choose', { bubbles: true, detail: { value: range ? inputs.map((i) => i.value) : inputs[0].value, done } }));
  };

  on(grid, 'click', (e) => {
    const btn = e.target.closest('.vx-calendar-day');
    if (!btn || btn.getAttribute('aria-disabled') === 'true') return;
    choose(parse(btn.dataset.vxDay));
  });
  on(grid, 'keydown', (e) => {
    const btn = e.target.closest?.('.vx-calendar-day');
    if (!btn || e.altKey || e.ctrlKey || e.metaKey) return;
    const t = parse(btn.dataset.vxDay), flip = rtl() ? -1 : 1;
    const ws = el.dataset.vxWeekStart !== undefined ? Number(el.dataset.vxWeekStart) % 7 : weekStart(lang());
    const back = (new Date(t).getUTCDay() - ws + 7) % 7;
    const to = {
      ArrowRight: t + flip * DAY, ArrowLeft: t - flip * DAY, ArrowDown: t + 7 * DAY, ArrowUp: t - 7 * DAY,
      Home: t - back * DAY, End: t + (6 - back) * DAY,
      PageUp: months(t, e.shiftKey ? -12 : -1), PageDown: months(t, e.shiftKey ? 12 : 1),
    }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    go(to, true);
  });
  // the tab stop follows a day that is pressed or tabbed to
  on(grid, 'focusin', (e) => {
    const btn = e.target.closest?.('.vx-calendar-day');
    if (!btn) return;
    const t = parse(btn.dataset.vxDay);
    if (t !== focus) { focus = t; for (const c of cells) c.firstElementChild.tabIndex = c.firstElementChild === btn ? 0 : -1; }
  });
  const turn = (dir) => (e) => {
    if (e.currentTarget.getAttribute('aria-disabled') === 'true') return;
    view = months(view, dir);
    focus = clampDay(months(focus, dir));
    if (first(focus) !== view) focus = clampDay(view);
    render(false);
  };
  on(prev, 'click', turn(-1));
  on(next, 'click', turn(1));

  // a value set from elsewhere (typed in the input, or from code): the month shows it
  const heard = () => {
    if (writing) return;
    const v = values()[0];
    if (v !== null) { focus = v; view = first(v); }
    render(false);
  };
  for (const input of inputs) {
    on(input, 'input', heard);
    on(input, 'change', heard);
    on.heed(input, 'value', heard);
    on.watch(input, { attributes: true, attributeFilter: ['min', 'max', 'disabled', 'readonly'] }, () => render(false));
  }
  on.watch(el, { attributes: true, attributeFilter: ['lang', 'data-vx-today', 'data-vx-week-start', 'data-vx-prev', 'data-vx-next'] }, () => render(false));

  // when these listeners go, the calendar is the input it began as
  on({ addEventListener() {}, removeEventListener() { for (const i of own) i.hidden = false; if (st.named) { el.removeAttribute('role'); el.removeAttribute('aria-label'); } if (made) { head.remove(); grid.remove(); } } }, 'end', render);
  render(false);
  return st;
}

// ---------------------------------------------------------------------------------------------
// A week: the row of seven days, drawn as one. It has one hole at most: the seat of the chosen
// day, or the part of a range that lies in this week.
export const calendarWeek = {
  name: 'calendar-week',
  selector: '.vx-calendar-week',
  pad: 7,
  glowRadius: 3.4,
  glowStrength: halo(GLOW),

  build(live, m) {
    const { el, vx, H } = live, D = live.look.well;
    const mat = lightName(el.closest('.vx-calendar') ?? el, 'light');
    const cells = [...el.children].filter((c) => c.classList.contains('vx-calendar-cell')).map((c) => ({
      x: Math.round(c.offsetLeft / vx), w: Math.round(c.offsetWidth / vx),
      mark: c.dataset.vxMark, today: c.firstElementChild?.getAttribute('aria-current') === 'date', btn: c.firstElementChild,
    }));
    const marked = cells.filter((c) => c.mark);
    const block = m.part('block');
    block.grounded = false;
    // what stands in the seat stands on a ring of light one voxel high, and is as tall as reaches
    // the surface: its foot, and its face (the top layer of its voxels)
    const base = 1 - D, face = base + (D - 1) - 1;
    if (marked.length) {
      const x0 = Math.min(...marked.map((c) => c.x)), x1 = Math.max(...marked.map((c) => c.x + c.w));
      const ranged = marked.some((c) => c.mark !== 'one');
      hole(live, m, { x: x0 + 1, y: 1, w: x1 - x0 - 2, h: H - 2, depth: D, wall: 'slate', floor: 'slate' });
      if (ranged) {
        // the floor of the trench is light, end to end
        const lit = m.part('lit');
        lit.grounded = false; lit.sunk = true;
        lit.box(x0 + 1, 1, -D, x1 - x0 - 2, H - 2, 1, mat);
      }
      for (const c of marked) {
        const x = c.x + 2, y = 2, w = c.w - 4, h = H - 4;
        // the chosen day, and the ends of a range: a key on its light, its face level with the surface
        if (c.mark !== 'mid') { ring(block, x, y, -D, w, h, mat, 1); capOf(block, x, y, base, w, h, D - 1, 'key'); }
        // a day between: a plain tile, level with the surface, so its number lies on something
        else block.box(x, y, base, w, h, D - 1, 'floor');
      }
    }
    // today: a lamp under its number. On the surface it stands in a steel collar; on a key or a
    // tile it is set into its face, which is its collar.
    const lamp = m.part('lamp');
    lamp.grounded = false;
    for (const c of cells) {
      if (!c.today) continue;
      const lx = c.x + Math.floor((c.w - 3) / 2);
      if (c.mark) for (let i = 0; i < 3; i++) block.plot(lx + i, H - 3, face, 'light-warm');
      else {
        m.part('collar').slab(lx - 1, H - 3, 0, 5, 3, 1, 'steel').carve(lx, H - 2, 0, 3, 1, 1);
        lamp.box(lx, H - 2, 0, 3, 1, 2, 'light-warm');
      }
    }
    live.faceZ = 0;
    for (const c of cells) live.label(c.btn, () => 0);
  },

  pose(live) { live.glowStrength = halo(GLOW) * byTheme(live); },

  bind(live) {
    const on = listeners();
    // a day chosen, today moved, a month turned: the week is drawn again
    on.watch(live.el, { attributes: true, subtree: true, attributeFilter: ['data-vx-mark', 'aria-current'] }, () => live.rebuild());
    const cal = live.el.closest('.vx-calendar');
    if (cal) on.watch(cal, { attributes: true, attributeFilter: ['data-vx-light'] }, () => live.rebuild());
    return on.done;
  },
};

export const calendar = {
  name: 'calendar',
  selector: '.vx-calendar',
  pad: 0,

  bind(live) {
    const on = listeners(), st = wire(live.el, on), added = [];
    // the keys and the weeks were made just now, after the page was adopted: they are added here
    for (const [node, def] of [...st.keys.map((k) => [k, button]), ...st.rows.map((r) => [r, calendarWeek])]) {
      if (live.stage.lives.has(node)) continue;
      live.stage.add(node, def);
      added.push(node);
    }
    st.chose = () => cue('tick');
    return () => { for (const n of added) live.stage.remove(n); on.done(); };
  },

  plain(el, on) { wire(el, on); },
};
