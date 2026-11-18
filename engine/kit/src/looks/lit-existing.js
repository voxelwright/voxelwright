// The lit look's own models for four parts the kit already has: slider, list, menu, dialog.
// Each is drawn with the tools in core/light.js, as the parts in lit.js are. The kit's own `bind`
// for each part keeps running (the stage calls the part's bind, never the look's), so every model
// here keeps the part names and the state fields that bind reads, and has its own `pose`.
//
//   import { LOOKS } from '../index.js';
//   import { parts } from './lit-existing.js';
//   Object.assign(LOOKS.lit.parts, parts);
//
// Their CSS under the look is css/existing.css.
import { halo, byTheme, ring, hole, bezel, lightName, UNDER, cap as capOf } from '../core/light.js';
import { clamp, wrapLabel } from '../components/util.js';

const rtl = (el) => getComputedStyle(el).direction === 'rtl';

// ---------------------------------------------------------------------------------------------
// Slider. A fader: a slot in a steel bezel, a knob standing in the slot with a line across its
// top to read its place by, and the slot behind the knob full of the accent's light. The same
// device as the switch (lit.js), made to stop anywhere.
// Tool: what slides (bezel, slot, knob). The light is on the floor of the slot, so the slot stays
// a slot.
// bind (components/slider.js) only says "draw again", so pose reads the input every time.
const KEY = 7, TRENCH = 7; // the knob's width and the slot's height: sizes, not depths. Depths are the look's.

const slider = {
  pad: 7,
  glowRadius: 3,
  glowStrength: halo(0.05),

  build(live, m) {
    const { W, H, el } = live, look = live.look, DEEP = look.well;
    const input = live.state.input = el.querySelector('input');
    const off = !!input?.disabled;
    const y = live.state.y = Math.floor((H - TRENCH) / 2);
    const instrument = Boolean(look.tooling);
    bezel(m, 0, y, W, TRENCH);
    if (look.tooling) {
      const graduations = m.part('scale');
      for (let i = 0; i <= 10; i++) {
        const x = 1 + Math.round((W - 3) * i / 10);
        graduations.plot(x, y - 2, 1, 'gasket');
      }
    }
    hole(live, m, { y, h: TRENCH, depth: DEEP, wall: 'slate', floor: 'slate' });
    const lit = m.part('lit');
    lit.masked = true; lit.grounded = false; lit.sunk = true;
    lit.box(0, look.tooling ? y + 3 : y, -DEEP, W, look.tooling ? 1 : TRENCH, 1, off ? 'steel' : instrument ? 'backlight' : 'light');
    // The knob stands on the floor of the slot, on its own light. Its shoulder is as far above the
    // surface as a key travels, so it clears the bezel, and its top is a keycap's: a step smaller.
    const thumb = m.part('thumb');
    thumb.grounded = false;
    const mat = off ? 'steel' : 'ivory', h = instrument ? TRENCH + 1 : TRENCH - 2, d = DEEP + look.travel, top = 1 - DEEP + d;
    if (!off) ring(thumb, 0, 0, -DEEP, KEY, h, 'light');
    capOf(thumb, 0, 0, 1 - DEEP, KEY, h, d, mat, 0); // square-cornered: a fader's cap is a block
    // The line: painted across the middle of its top, as deep as a groove, and not cut: a cut
    // splits a top this small into two lumps. It is enamel, the kit's one paint, which shows on the
    // ivory by day and at night alike (ink turns light at night and is lost on it; steel is lost by
    // day). Switched off, the knob is steel and the line is slate.
    const mid = (KEY - 1) / 2, g = look.groove;
    thumb.box(mid, 1, top - g, 1, h - 2, g, off ? 'slate' : 'enamel');
    thumb.ty = instrument ? y - 1 : y + 1;
    live.state.travel = Math.max(0, W - 2 - KEY);
    live.state.flip = rtl(el);
  },

  pose(live) {
    const input = live.state.input;
    const { thumb, lit } = live.model.byName;
    const min = Number(input?.min || 0), max = Number(input?.max || 100);
    const t = max > min ? clamp((Number(input?.value) - min) / (max - min), 0, 1) : 0;
    const at = live.state.flip ? 1 - t : t;
    const x = 1 + at * live.state.travel;
    thumb.tx = x;
    thumb.tz = live.spring('press').x;
    // lit from the end the value starts at up to the middle of the knob
    const edge = x + KEY / 2;
    for (let i = 0; i < lit.count; i++) {
      const d = live.state.flip ? lit.rest[i * 3] - edge : edge - lit.rest[i * 3];
      lit.scales[i] = t <= 0.001 ? 0 : clamp(d + 0.5, 0, 1);
    }
    live.glowStrength = halo(0.05) * byTheme(live);
  },
};

// ---------------------------------------------------------------------------------------------
// List. Rows of words on the surface, parted by hairlines (CSS). The only voxels are the mark of
// the current row: an accent groove at its start. Tool: none, and a groove.
// bind (components/list.js) reads state.rows[i].li and .press, and rebuilds on any change under
// the list, so build must not touch the DOM once the rows are wrapped.
const list = {
  pad: 6,
  glowRadius: 2.8,
  glowStrength: halo(0.06),

  build(live, m) {
    const { W, el, vx } = live, GROOVE = live.look.groove;
    const rows = live.state.rows = [];
    const marks = [];
    const x = rtl(el) ? W - 2 : 1;
    [...el.children].filter((n) => n.tagName === 'LI').forEach((li, i) => {
      const top = Math.round(li.offsetTop / vx), h = Math.max(2, Math.round(li.offsetHeight / vx));
      const current = li.getAttribute('aria-current') === 'true' || li.getAttribute('aria-selected') === 'true';
      const row = { li, part: null, current, press: live.spring('row' + i) };
      rows.push(row);
      if (current && h > 4) marks.push([top + 2, h - 4]);
      // the words answer a press: they go a little way into the surface with it
      live.label(wrapLabel(li, 'vx-row'), () => row.press.x);
    });
    live.faceZ = 0;
    if (!marks.length) return;
    // One groove a current row, all in one column. The stage knows one hole a part, so the hole
    // is the column from the first mark to the last, and each mark has its own walls and floor.
    const walls = m.part('walls'), bed = m.part('floor');
    walls.sunk = true; walls.tz = UNDER; bed.sunk = true;
    for (const [y, h] of marks) {
      walls.box(x - 1, y, -GROOVE, 1, h, GROOVE, 'light').box(x + 1, y, -GROOVE, 1, h, GROOVE, 'light');
      bed.box(x - 1, y, -GROOVE - 1, 3, h, 1, 'light');
    }
    const first = marks[0], last = marks[marks.length - 1];
    walls.box(x - 1, first[0] - 1, -GROOVE, 3, 1, GROOVE, 'light').box(x - 1, last[0] + last[1], -GROOVE, 3, 1, GROOVE, 'light');
    live.well = [x, first[0], x + 1, last[0] + last[1]];
  },

  pose(live) {
    // the mark's light answers a press on its own row
    let down = 0;
    for (const r of live.state.rows) if (r.current) down = Math.max(down, -r.press.x);
    live.glowStrength = halo(0.06) * byTheme(live) * (1 + down * 1.6);
  },
};

// ---------------------------------------------------------------------------------------------
// Menu. A plate above everything on the accent's light, as thick as the look's float, built out
// of its trigger's corner. Its top is flat: a plate, not a keycap. It is not bolted: bolts hold a
// panel down where it stays, and a plate comes and goes (and it is built and taken away as one
// part, `panel`, so bolts of their own would hang in the air while it builds). The active row is
// marked as the look marks "current": an accent groove at its start, full of light to the level
// of the face. Tool: float, and a groove.
// bind (components/menu.js) hides the part named `pick` and assembles the part named `panel` when
// the menu opens, and reads state.items and state.active; it sets state.active itself.
const MENU_GLOW = 0.027, MARK_X = 2;

const menu = {
  pad: 11,
  glowRadius: 2.2,
  glowStrength: halo(MENU_GLOW),

  build(live, m) {
    const { W, H, el, vx } = live, d = live.look.float, GROOVE = live.look.groove;
    // the light and the slab are one part, so both are built out of the corner together
    const panel = m.part('panel');
    ring(panel, 0, 0, 0, W, H, 'light', 1);
    panel.slab(0, 0, 1, W, H, d - 1, live.look.readingPlate, 1); // a float is a plate, not a keycap
    const items = live.state.items = [...el.querySelectorAll('[role^="menuitem"]')];
    const h = items[0] ? Math.max(2, Math.round(items[0].offsetHeight / vx)) : 2;
    live.state.ys = items.map((it) => Math.round(it.offsetTop / vx));
    // the mark: light in the top layer of the slab, where a groove would be cut. It moves from
    // row to row, so it lies in the slab's own cells, a hair proud of them.
    const pick = m.part('pick');
    pick.grounded = false;
    pick.box(rtl(el) ? W - 1 - MARK_X : MARK_X, Math.min(2, h - 1), d - GROOVE, 1, Math.max(1, h - 4), GROOVE, 'light');
    pick.tz = 0.03;
    const danger = m.part('danger');
    danger.grounded = false;
    danger.box(rtl(el) ? W - 1 - MARK_X : MARK_X, Math.min(2, h - 1), d - GROOVE, 1, Math.max(1, h - 4), GROOVE, 'light-stop');
    danger.tz = pick.tz;
    live.faceZ = d;
  },

  pose(live) {
    const { pick, panel } = live.model.byName, a = live.state.active;
    // not while the slab is still being built: the mark would hang in the air
    pick.hidden = !(a >= 0) || !!panel.fx;
    const danger = live.model.byName.danger;
    danger.hidden = pick.hidden || live.state.items[a]?.dataset.vxKind !== 'danger';
    if (!danger.hidden) pick.hidden = true;
    if (a >= 0) danger.ty = pick.ty = live.state.ys[a] ?? 0;
    live.glowStrength = halo(MENU_GLOW) * (live.theme === 'day' ? 1.2 : 1);
  },

  // one more drawing after the build ends, so the mark appears on the finished slab
  step(live) {
    const building = !!live.model.byName.panel?.fx, was = live.state.building;
    live.state.building = building;
    return !!was && !building;
  },
};

// ---------------------------------------------------------------------------------------------
// Dialog. A plate above everything on the accent's light, as thick as the look's dialog (the
// thickest thing in the kit), with a flat top. Not bolted, for the menu's reason: it is dismissed,
// and what is bolted down stays. Its header is words; a groove of the room's own light parts them
// from the body. Its keys are keys. Tool: float, and a groove.
// bind (components/dialog.js) assembles and crumbles every part, so no name matters here.
const DIALOG_GLOW = 0.025, INSET = 4;

const dialog = {
  pad: 16,
  glowRadius: 2.2,
  glowStrength: halo(DIALOG_GLOW),

  build(live, m) {
    const { W, H, el, vx } = live, d = live.look.dialog, r = live.look.round, GROOVE = live.look.groove;
    const panel = m.part('panel');
    ring(panel, 0, 0, 0, W, H, lightName(el, 'light'), r);
    panel.slab(0, 0, 1, W, H, d - 1, 'chalk', r);
    const head = el.querySelector(':scope > header');
    const y = head ? Math.round((head.offsetTop + head.offsetHeight) / vx) - 1 : 0;
    if (y > 1 && y < H - 2 && W > INSET * 2 + 2) {
      // The groove: the last row of the header, cut into the face. Its floor is light, and so is
      // the wall that is seen from here (the lower one), as in a groove cut in the page. That
      // wall lies in the slab's own cells, a hair inside the channel and under the face, so only
      // its lit side shows.
      const x = INSET, w = W - INSET * 2;
      panel.carve(x, y, d - GROOVE - 1, w, 1, GROOVE + 1);
      const groove = m.part('groove');
      groove.grounded = false;
      groove.box(x, y, d - GROOVE - 1, w, 1, 1, 'light-warm').box(x, y + 1, d - GROOVE, w, 1, GROOVE, 'light-warm');
      groove.ty = UNDER; groove.tz = UNDER;
    }
    live.faceZ = d;
  },

  pose(live) { live.glowStrength = halo(DIALOG_GLOW) * (live.theme === 'day' ? 1.25 : 1); },
};

export const parts = { slider, list, menu, dialog };
