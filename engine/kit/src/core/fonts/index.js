// Lettering in voxels: glyph sets, and the layout that turns a string into voxels.
//
// A glyph set is drawn in cells. One cell is `scale` voxels on a side. A set knows its own
// vertical measures (cap height, x-height, descent), its spacing in whole cells, and how tightly
// two glyphs may sit (kerning in whole cells, worked out from the shapes and then corrected by hand).
//
// Glyph source: blocks separated by a blank line. The first line of a block is the character,
// optionally followed by the row it starts on (0 is the cap line; lowercase without an ascender
// starts lower, an accent starts above 0 with a negative number). '#' is a cell.

const INF = 99;

export function parse(src) {
  const glyphs = {};
  for (const block of src.replace(/\r/g, '').split(/\n\s*\n/)) {
    const lines = block.split('\n').map((l) => l.trimEnd()).filter((l) => l.length);
    if (!lines.length) continue;
    const m = lines[0].match(/^(space|\S)(?:\s+(-?\d+))?$/u);
    if (!m) throw new Error('bad glyph header: ' + lines[0]);
    const ch = m[1] === 'space' ? ' ' : m[1];
    const rows = lines.slice(1);
    const w = Math.max(...rows.map((r) => r.length));
    glyphs[ch] = { ch, y: Number(m[2] || 0), w, rows: rows.map((r) => r.padEnd(w, '.')) };
  }
  return glyphs;
}

/**
 * A font. cap: rows from the cap line to the baseline. descent: rows below the baseline that
 * letters may use. gap: cells between two glyphs. space: cells in a word space (the gaps on each
 * side come on top). lineGap: cells between the baseline of one line and the cap line of the next.
 * upper: the set has capitals only, so text is set in capitals. maxKern: the most two glyphs may
 * be drawn together, in cells. kern: pairs corrected by hand, e.g. { LT: -2 }.
 */
export function makeFont(o) {
  const glyphs = typeof o.src === 'string' ? parse(o.src) : o.glyphs;
  const font = { gap: 1, space: 2, lineGap: 3, descent: 0, xHeight: o.cap, upper: false, maxKern: 1, kern: {}, ...o, glyphs };
  delete font.src;
  const lo = -3, hi = font.cap + font.descent + 1; // rows a profile covers
  for (const g of Object.values(glyphs)) {
    g.left = []; g.right = []; g.cells = [];
    for (let r = lo; r < hi; r++) {
      const row = g.rows[r - g.y] || '';
      const a = row.indexOf('#'), b = row.lastIndexOf('#');
      g.left.push(a < 0 ? INF : a);
      g.right.push(b < 0 ? INF : g.w - 1 - b);
    }
    for (let r = 0; r < g.rows.length; r++) for (let c = 0; c < g.w; c++) if (g.rows[r][c] === '#') g.cells.push([c, r + g.y]);
    g.top = g.y; g.bottom = g.y + g.rows.length;
  }
  font.pairs = new Map();
  return font;
}

const DIGIT = /[0-9]/;

/** How far glyph b may move toward glyph a, in cells (zero or negative). */
export function kern(font, a, b) {
  const k = a + b;
  if (k in font.kern) return font.kern[k];
  let v = font.pairs.get(k);
  if (v !== undefined) return v;
  const A = font.glyphs[a], B = font.glyphs[b];
  v = 0;
  if (A && B && a !== ' ' && b !== ' ' && !(DIGIT.test(a) && DIGIT.test(b)) && font.maxKern > 0) {
    // the closest the two shapes come, looking one row up and down so corners count too
    let free = INF;
    for (let r = 0; r < A.right.length; r++) {
      if (A.right[r] === INF) continue;
      for (let q = Math.max(0, r - 1); q <= Math.min(B.left.length - 1, r + 1); q++) if (B.left[q] !== INF) free = Math.min(free, A.right[r] + B.left[q]);
    }
    if (free === INF) free = font.maxKern; // nothing faces anything: a quote before a low letter
    v = -Math.max(0, Math.min(font.maxKern, free - (font.kernKeep ?? 0)));
  }
  font.pairs.set(k, v);
  return v;
}

const chars = (font, text) => [...(font.upper ? String(text).toUpperCase() : String(text))];
const glyphOf = (font, ch) => font.glyphs[ch] ?? font.glyphs[ch.toUpperCase()] ?? font.glyphs['?'];

/** Width of a string, in cells. */
export function measure(font, text) {
  let x = 0, prev = null;
  for (const ch of chars(font, text)) {
    const g = glyphOf(font, ch);
    if (prev !== null) x += font.gap + kern(font, prev, g.ch);
    x += ch === ' ' ? font.space : g.w;
    prev = g.ch;
  }
  return x;
}

/**
 * Lay a string out. Returns { glyphs: [{ g, x }], width, top, bottom } in cells; top is negative
 * when something rises above the cap line, bottom exceeds cap when something descends.
 */
export function layout(font, text) {
  const out = [];
  let x = 0, prev = null, top = 0, bottom = font.cap;
  for (const ch of chars(font, text)) {
    const g = glyphOf(font, ch);
    if (prev !== null) x += font.gap + kern(font, prev, g.ch);
    if (ch !== ' ') { out.push({ g, x }); top = Math.min(top, g.top); bottom = Math.max(bottom, g.bottom); }
    x += ch === ' ' ? font.space : g.w;
    prev = g.ch;
  }
  return { glyphs: out, width: x, top, bottom };
}

// ---- drawing a glyph at a scale

const cache = new WeakMap();

/**
 * The voxels of one glyph at `scale` voxels per cell, as [[x, y], ...] from the glyph's own origin
 * (its left edge, the cap line). With refine, the glyph is redrawn for the scale rather than
 * enlarged: where two cells touch only at a corner, the notch on each side is stepped in, so a
 * diagonal becomes a staircase of single voxels and a round corner steps once per voxel.
 */
export function voxels(g, scale, refine = true) {
  let byScale = cache.get(g);
  if (!byScale) cache.set(g, (byScale = new Map()));
  const key = scale * 2 + (refine ? 1 : 0);
  let v = byScale.get(key);
  if (v) return v;
  v = [];
  const h = g.rows.length, w = g.w;
  const ink = (c, r) => r >= 0 && r < h && c >= 0 && c < w && g.rows[r][c] === '#';
  for (let r = -1; r <= h; r++) for (let c = -1; c <= w; c++) {
    if (ink(c, r)) {
      for (let j = 0; j < scale; j++) for (let i = 0; i < scale; i++) v.push([c * scale + i, (r + g.y) * scale + j]);
      continue;
    }
    if (!refine || scale < 2) continue;
    // an empty cell: for each of its four corners, are the two cells beside that corner inked
    // while the cell diagonally across it is empty? Then they meet only at a point: step it in.
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      if (!ink(c + dx, r) || !ink(c, r + dy) || ink(c + dx, r + dy)) continue;
      // do not weld a joint that is already solid on the far side of either arm
      for (let j = 0; j < scale - 1; j++) for (let i = 0; i < scale - 1 - j; i++) {
        const sx = dx < 0 ? i : scale - 1 - i, sy = dy < 0 ? j : scale - 1 - j;
        v.push([c * scale + sx, (r + g.y) * scale + sy]);
      }
    }
  }
  // a cell can be stepped from two corners at once; keep each voxel once
  const seen = new Set();
  v = v.filter(([x, y]) => { const k = x * 4096 + y; if (seen.has(k)) return false; seen.add(k); return true; });
  byScale.set(key, v);
  return v;
}

/** All voxels of a laid-out line, at a scale: [[x, y], ...] with y = 0 on the cap line. */
export function raster(font, text, scale = 1, refine = true) {
  const l = layout(font, text);
  const out = [];
  for (const { g, x } of l.glyphs) for (const [vx, vy] of voxels(g, scale, refine)) out.push([x * scale + vx, vy]);
  return { cells: out, width: l.width * scale, top: l.top * scale, bottom: l.bottom * scale };
}

// ---- the registry

export const FONTS = {};
export function registerFont(font) { FONTS[font.id] = font; return font; }
