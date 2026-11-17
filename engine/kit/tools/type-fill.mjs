// The fill-in gate. A letter built from cubes shows the top and left side of every cube, so each
// counter loses a strip half the depth wide along its right and bottom edges. This prints, per glyph
// set, scale and depth, how much of the tightest closed counter is still open ground.
import { FONTS } from '../packages/voxelmorphism/src/core/fonts/index.js';
import '../packages/voxelmorphism/src/core/fonts/sign.js';
import '../packages/voxelmorphism/src/core/fonts/sentence.js';
import '../packages/voxelmorphism/src/core/fonts/block.js';
import { layout as oldLayout } from '../packages/voxelmorphism/src/core/font.js';

function counters(rows) {
  const h = rows.length, w = rows[0].length, ink = (c, r) => rows[r]?.[c] === '#';
  const seen = new Set(), out = [];
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
    if (ink(c, r) || seen.has(c + ',' + r)) continue;
    const cells = [], stack = [[c, r]]; let closed = true;
    while (stack.length) {
      const [x, y] = stack.pop(); const k = x + ',' + y;
      if (x < 0 || y < 0 || x >= w || y >= h) { closed = false; continue; }
      if (seen.has(k) || ink(x, y)) continue;
      seen.add(k); cells.push([x, y]); stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    if (closed) out.push(cells.map(([x, y]) => ({ right: ink(x + 1, y), below: ink(x, y + 1) })));
  }
  return out;
}
// share of a counter's area still open at this scale and depth
const open = (cells, scale, depth) => { const s = Math.min(1, depth / 2 / scale); return cells.reduce((a, c) => a + (1 - (c.right ? s : 0)) * (1 - (c.below ? s : 0)), 0) / cells.length; };

const sets = [];
const today = {}; for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789') { const { cells, width } = oldLayout(ch); const rows = Array.from({ length: 7 }, () => Array(width).fill('.')); for (const [x, y] of cells) rows[y][x] = '#'; today[ch] = rows.map((r) => r.join('')); }
sets.push({ name: 'Vox Sign (today)', glyphs: today, depth: () => 2 });
for (const id of ['sign', 'block', 'sentence']) { const f = FONTS[id]; sets.push({ name: f.name, glyphs: Object.fromEntries(Object.entries(f.glyphs).filter(([c]) => /[A-Za-z0-9\u0400-\u04ff]/.test(c)).map(([c, g]) => [c, g.rows])), depth: f.depth }); }
console.log('set'.padEnd(18), 'scale depth  tightest counter open   glyphs with a counter under half open');
for (const s of sets) for (const scale of [1, 2, 3]) {
  const depth = s.depth(scale); let worst = 1, worstCh = '', bad = [];
  for (const [ch, rows] of Object.entries(s.glyphs)) for (const c of counters(rows)) { const o = open(c, scale, depth); if (o < worst) { worst = o; worstCh = ch; } if (o < 0.5 && !bad.includes(ch)) bad.push(ch); }
  console.log(s.name.padEnd(18), String(scale).padEnd(5), String(depth).padEnd(6), (Math.round(worst * 100) + '% (' + worstCh + ')').padEnd(23), bad.length ? bad.join('') : 'none');
}
