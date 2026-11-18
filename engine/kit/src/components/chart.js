// Chart. A window cut into the panel, lit from its rim, with the numbers standing in it as light:
// a bar chart is columns of lamps, as on a bar-graph display (each lamp two voxels of light, a
// voxel apart, and above the light the dark studs of the lamps not lit, so a column at nought
// still shows where it stands); a line chart is a line of lamps, each value a lamp a size larger
// that reaches the level of the panel. Faint studs on the floor mark the scale.
// Tool: the well (hole(), a window to read through) holding rows of lamps, as the meter's slot
// does. Colours are only the look's lights: the accent by default, data-vx-light="go" or "stop"
// on a series' head where it means done or failed.
// Markup: <figure class="vx-chart" data-vx-kind="bar">
//           <figcaption>Deploys a day <small>fogline, the week to 24 May</small></figcaption>
//           <div class="vx-chart-window"></div>
//           <table>
//             <thead><tr><th scope="col">Day</th><th scope="col" data-vx-light="go">Went out</th><th scope="col" data-vx-light="stop">Failed</th></tr></thead>
//             <tbody><tr><th scope="row">Mon</th><td>12</td><td>1</td></tr>…</tbody>
//           </table>
//         </figure>
//   data-vx-kind: "bar" (the default) or "line". The table is the chart's numbers: its row heads
//   are the places along the bottom, each further column a series. A cell's value is its
//   data-vx-value or its text; an empty cell is no value (no light; a gap in a line). Below
//   nought is drawn as nought. data-vx-max on the figure fixes the top of the scale; otherwise
//   it is the next round number over the largest value.
//   The table is the chart for a screen reader: once the script has drawn the window, the table
//   is words for a screen reader only (data-vx-table="shown" keeps it on the page as well). With
//   no script the table is all there is, and nothing is drawn. The window and the words on its
//   axes are aria-hidden: they say what the table says.
//   The words on the axes and the series' names (beside a lamp each, when there is more than one)
//   are real text, written by the part. After changing the table from code nothing more is
//   needed: the part hears it. The window is whole voxels both ways (css/chart.css), so the axis
//   words land on the rows of lamps.
//   A chart reads from left to right in either direction of writing: its places, its columns
//   and their names are laid out left to right on a right-to-left page as well.
//   Under prefers-reduced-motion the light is there at once; otherwise the columns grow (the line
//   draws itself from the left) when the chart is first drawn and when its numbers change.

import { hole, halo, byTheme, lightName, warmth } from '../core/light.js';
import { reducedMotion } from '../core/motion.js';
import { lamp as lampPart } from '../looks/lit.js';
import { listeners } from './util.js';

const BASE = 2, TOP = 2, SIDE = 2; // voxels kept clear in the window: under the light, over it, at each side

/** A cell's value: a number, or NaN for an empty cell or one that is not a number. */
function valueOf(cell) {
  const raw = (cell?.dataset.vxValue ?? cell?.textContent ?? '').trim();
  if (raw === '') return NaN;
  return Number(raw.replace(/[\s  ,]/g, '').replace('−', '-').replace(/^(-?[\d.]+).*$/, '$1'));
}

/** What the table says: the places along the bottom, the series, and each series' values. */
function readTable(fig) {
  const table = fig.querySelector('table');
  if (!table) return { places: [], series: [] };
  const head = table.tHead?.rows[table.tHead.rows.length - 1];
  const rows = [...(table.tBodies[0]?.rows ?? [])];
  const heads = head ? [...head.cells].slice(1) : [];
  const n = heads.length || Math.max(0, ...rows.map((r) => r.cells.length - 1));
  const series = Array.from({ length: n }, (_, i) => ({
    name: heads[i]?.textContent.trim() ?? '',
    light: heads[i] ? lightName(heads[i], 'light') : 'light',
    values: rows.map((r) => Math.max(0, valueOf(r.cells[i + 1]))),
  }));
  return { places: rows.map((r) => r.cells[0]?.textContent.trim() ?? ''), series };
}

/** A round step for about four lines on the scale, and the top of the scale. Counts (every value a whole number) step by whole numbers. */
function scale(top, fixed, whole) {
  const max = fixed > 0 ? fixed : top > 0 ? top : 1;
  const rough = max / 4, mag = 10 ** Math.floor(Math.log10(rough));
  let step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= rough - 1e-9);
  if (whole && !Number.isInteger(step)) step = Math.max(1, Math.ceil(step));
  return { step, max: fixed > 0 ? fixed : Math.ceil(max / step - 1e-9) * step };
}

/**
 * Everything the chart is, in voxels of the window, from the table and the window's size: the
 * voxels and the words on the page are both laid from this one answer.
 */
function lay(win) {
  const fig = win.closest('.vx-chart') ?? win.parentElement;
  const vx = parseFloat(getComputedStyle(win).getPropertyValue('--vx')) || 4;
  const W = Math.max(1, Math.floor(win.offsetWidth / vx + 0.01)), H = Math.max(1, Math.floor(win.offsetHeight / vx + 0.01));
  const kind = fig.dataset.vxKind === 'line' ? 'line' : 'bar';
  const { places, series } = readTable(fig);
  const all = series.flatMap((s) => s.values).filter((v) => Number.isFinite(v));
  const { step, max } = scale(Math.max(0, ...all), Number(fig.dataset.vxMax), all.every(Number.isInteger));
  const base = H - 1 - BASE;                       // the lowest row of light
  // how many rows the scale has: lamps are two rows and a gap, so the top of the scale is the
  // top of a lamp; what is left over is room at the top
  const rows = Math.max(2, Math.floor((base - TOP + 1 - 2) / 3) * 3 + 2);
  // a value over nought has one row of light at least, so it is never mistaken for nought
  const lit = (v) => (Number.isFinite(v) && v > 0 ? Math.max(1, Math.min(rows, Math.round((Math.min(v, max) / max) * rows))) : 0);
  // a value's level: the edge between its top row of light and the row over it
  const edge = (v) => base + 1 - lit(v);
  const ticks = [];
  for (let v = 0; v <= max + step * 1e-6; v += step) ticks.push({ v: +v.toPrecision(12), y: edge(v) });
  const n = places.length, S = Math.max(1, series.length), inner = Math.max(1, W - SIDE * 2);
  const out = { vx, W, H, kind, places, series, max, step, ticks, base, rows, cols: [], points: [], at: [] };
  if (!n) return out;
  if (kind === 'bar') {
    const slot = inner / n;
    // a column is as wide as the place allows, two voxels at least and eight at most; the
    // columns of one place stand a voxel apart, and the places are parted by what is left
    const w = Math.max(2, Math.min(8, Math.floor((slot - 2 - (S - 1)) / S)));
    const group = w * S + (S - 1);
    for (let i = 0; i < n; i++) {
      const x0 = SIDE + Math.round(slot * i + (slot - group) / 2);
      out.at.push(x0 + group / 2);
      series.forEach((s, k) => out.cols.push({ place: i, series: k, x: x0 + k * (w + 1), w, n: lit(s.values[i]), light: s.light }));
    }
  } else {
    // the points are lamps two voxels square: their left edges run from the first voxel inside
    // to the last that leaves room for one
    const span = Math.max(0, inner - 2);
    for (let i = 0; i < n; i++) out.at.push(SIDE + (n === 1 ? span / 2 : Math.round((span * i) / (n - 1))) + 1);
    series.forEach((s, k) => s.values.forEach((v, i) => {
      if (!Number.isFinite(v)) return;
      out.points.push({ series: k, place: i, x: out.at[i] - 1, y: edge(v) - 1, light: s.light }); // a 2 by 2 lamp, its middle on the level
    }));
  }
  return out;
}

// the cells of a straight line between two points, both ends in
function line(x0, y0, x1, y1, put) {
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    put(x0, y0);
    if (x0 === x1 && y0 === y1) return;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

// ---------------------------------------------------------------------------------------------
// The words, the series' lamps and the plain marks: written into the page from the same layout.
const CSS_LIGHT = { light: 'accent', 'light-go': 'go', 'light-stop': 'stop', 'light-warm': 'warm' };
const fmt = (el) => new Intl.NumberFormat(el.closest('[lang]')?.lang || document.documentElement.lang || undefined, { maximumFractionDigits: 2 });

function holder(win, cls, tag = 'div') {
  let h = win.querySelector(`:scope > .${cls}`);
  if (!h) { h = document.createElement(tag); h.className = cls; h.setAttribute('aria-hidden', 'true'); win.append(h); }
  return h;
}

function write(win, L, adoptLamp) {
  const fig = win.closest('.vx-chart') ?? win.parentElement, vx = L.vx, num = fmt(fig);
  win.setAttribute('aria-hidden', 'true');
  // the scale: a number at each line, set on the level it marks
  const y = holder(win, 'vx-chart-y');
  y.replaceChildren(...L.ticks.map((t) => { const s = document.createElement('span'); s.textContent = num.format(t.v); s.style.insetBlockStart = `${t.y * vx}px`; return s; }));
  // the places along the bottom; where they would run into each other, every second (third…) one
  const x = holder(win, 'vx-chart-x');
  x.replaceChildren(...L.places.map((p, i) => { const s = document.createElement('span'); s.textContent = p; s.style.left = `${L.at[i] * vx}px`; return s; }));
  const spans = [...x.children], widest = Math.max(0, ...spans.map((s) => s.offsetWidth));
  const room = L.places.length > 1 ? (L.at[1] - L.at[0]) * vx : Infinity;
  const every = Math.max(1, Math.ceil((widest + vx * 3) / room));
  spans.forEach((s, i) => { s.hidden = i % every !== 0; });
  // the marks for a page with no voxels: the same columns and lamps, painted
  const marks = holder(win, 'vx-chart-marks');
  const px = (v) => `${v * vx}px`;
  if (L.kind === 'bar') {
    // the lamps not lit first (so a column at nought still shows where it stands), then the light
    marks.replaceChildren(...L.cols.flatMap((c) => [['stud', L.rows], [CSS_LIGHT[c.light] ?? 'accent', c.n]].map(([light, n]) => {
      const s = document.createElement('span');
      s.dataset.vxLight = light;
      Object.assign(s.style, { left: px(c.x), width: px(c.w), top: px(L.base + 1 - n), height: px(n) });
      return s;
    })));
  } else {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${L.W} ${L.H}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    L.series.forEach((s, k) => {
      const pts = L.points.filter((p) => p.series === k);
      // a gap where a value is missing
      let run = [];
      const flush = () => { if (run.length > 1) { const pl = document.createElementNS(svg.namespaceURI, 'polyline'); pl.setAttribute('points', run.map((p) => `${p.x + 1},${p.y + 1}`).join(' ')); pl.dataset.vxLight = CSS_LIGHT[s.light] ?? 'accent'; svg.append(pl); } run = []; };
      pts.forEach((p, i) => { if (i && p.place !== pts[i - 1].place + 1) flush(); run.push(p); });
      flush();
      for (const p of pts) { const r = document.createElementNS(svg.namespaceURI, 'rect'); Object.entries({ x: p.x, y: p.y, width: 2, height: 2 }).forEach(([a, v]) => r.setAttribute(a, v)); r.dataset.vxLight = CSS_LIGHT[p.light] ?? 'accent'; svg.append(r); }
    });
    marks.replaceChildren(svg);
  }
  // the series' names, each beside a lamp of its light, when there is more than one
  let key = fig.querySelector(':scope > .vx-chart-key');
  if (L.series.length > 1) {
    if (!key) { key = document.createElement('ul'); key.className = 'vx-chart-key'; key.setAttribute('aria-hidden', 'true'); win.after(key); }
    const want = L.series.map((s) => `${CSS_LIGHT[s.light] ?? 'accent'}:${s.name}`).join('|');
    if (key.dataset.was !== want) {
      key.dataset.was = want;
      key.replaceChildren(...L.series.map((s) => {
        const li = document.createElement('li'), l = document.createElement('span');
        l.className = 'vx-lamp'; l.dataset.vxLight = CSS_LIGHT[s.light] ?? 'accent';
        li.append(l, s.name);
        return li;
      }));
      for (const l of key.querySelectorAll('.vx-lamp')) adoptLamp?.(l);
    }
  } else key?.remove();
  fig.setAttribute('data-vx-drawn', '');
}

// What the chart does with or without voxels: it lays itself out and writes its words, and does
// so again when its numbers or its size change. `changed` is told, to draw the voxels again.
function wire(win, on, changed = () => {}, adoptLamp) {
  const fig = win.closest('.vx-chart') ?? win.parentElement;
  let last = '';
  const again = (news) => {
    const L = lay(win);
    const sig = JSON.stringify([L.W, L.H, L.kind, L.places, L.series, L.max]);
    if (sig === last) return;
    const first = !last;
    last = sig;
    write(win, L, adoptLamp);
    if (!first) changed(news);
  };
  const table = fig.querySelector('table');
  if (table) on.watch(table, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-vx-value', 'data-vx-light'] }, () => again(true));
  on.watch(fig, { attributes: true, attributeFilter: ['data-vx-kind', 'data-vx-max'] }, () => again(true));
  const size = new ResizeObserver(() => again(false));
  size.observe(win);
  // `on` drops what it was given when the part is let go; the observer goes with it
  on({ addEventListener() {}, removeEventListener: () => size.disconnect() }, 'gone', null);
  document.fonts?.ready.then(() => { last = last && 'fonts'; again(false); }); // the words are wider in their own face
  again(false);
}

// ---------------------------------------------------------------------------------------------
const GLOW = 0.045;

export const chart = {
  name: 'chart',
  selector: '.vx-chart-window',
  pad: 7,
  glowRadius: 3.4,
  glowStrength: halo(GLOW),

  build(live, m) {
    const { el } = live, D = live.look.well;
    const L = live.state.L = lay(el);
    const { W, H } = live;
    hole(live, m, { depth: D, wall: lightName(el, 'light-warm'), floor: 'floor' });
    const used = new Set(); // cells that hold a lamp or a stud: the scale's marks keep off them
    const studs = m.part('studs'), fill = m.part('fill');
    studs.sunk = true; studs.grounded = false;
    fill.sunk = true; fill.grounded = false;
    if (L.kind === 'bar') {
      // a column: lamps two rows tall, a row apart, from the bottom up; a row of the scale that
      // falls in a gap is a gap, so the light's top is never more than a row off its value
      for (const c of L.cols) for (let r = 0; r < L.rows; r++) {
        if (r % 3 === 2) continue;
        const y = L.base - r;
        for (let i = 0; i < c.w; i++) {
          const x = c.x + i;
          used.add(x + ',' + y);
          studs.box(x, y, -D, 1, 1, 1, 'steel');
          if (r < c.n) for (let k = -D; k < 0; k++) fill.plot(x, y, k, c.light, (r + 0.5) / L.rows);
        }
      }
    } else {
      // the line: a lamp on the floor at every voxel of it, drawn from the left; each value is a
      // lamp two voxels square that reaches the level of the panel, so its light lies on it
      L.series.forEach((s, k) => {
        const pts = L.points.filter((p) => p.series === k);
        pts.forEach((p, i) => {
          const q = pts[i + 1];
          if (!q || q.place !== p.place + 1) return;
          line(p.x + 1, p.y + 1, q.x + 1, q.y + 1, (x, y) => { if (!used.has(x + ',' + y)) { used.add(x + ',' + y); fill.plot(x, y, -D, s.light, x / W); } });
        });
      });
      for (const p of L.points) for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
        const x = p.x + i, y = p.y + j;
        used.add(x + ',' + y);
        studs.box(x, y, -D, 1, 1, 1, 'steel');
        for (let k = -D; k < 0; k++) fill.plot(x, y, k, p.light, (x + 0.5) / W);
      }
    }
    // the scale: a dotted line of slate on the floor at each of its levels, clear of the light
    const marks = m.part('marks');
    marks.sunk = true;
    for (const t of L.ticks) {
      // on the floor, a voxel down from where the light's top lies: drawn a row lower, it is
      // seen on the level it marks
      const y = t.y;
      if (y < 0 || y >= H) continue;
      for (let x = 2; x < W - 1; x += 4) if (!used.has(x + ',' + y)) marks.box(x, y, -D, 1, 1, 1, 'slate');
    }
    // the light grows when the chart is first drawn and when its numbers change, never when it
    // is only laid out again
    if (live.state.g === undefined || live.state.news) { live.state.g = reducedMotion() ? 1 : 0; live.state.news = false; }
    live.state.grown = false;
  },

  pose(live) {
    live.glowStrength = halo(GLOW) * byTheme(live) + halo(0.02) * warmth(live) * 0.5;
    if (!live.state.grown) { live.state.grown = true; live.model.byName.fill.grow(live.state.g, 0); }
  },

  step(live, dt) {
    const fill = live.model.byName.fill;
    if (reducedMotion()) live.state.g = 1;
    const was = live.state.g;
    live.state.g = Math.min(1, was + dt / 0.5);
    const busy = fill.grow(live.state.g, reducedMotion() ? 0 : dt);
    return busy || live.state.g < 1;
  },

  bind(live) {
    const on = listeners();
    wire(live.el, on, (news) => { if (news) live.state.news = true; live.rebuild(); }, (l) => live.stage.add(l, lampPart));
    return on.done;
  },

  plain(el, on) { wire(el, on); },
};
