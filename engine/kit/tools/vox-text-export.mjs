// Write a glyph set from core/fonts/ as JSON, for tools/vox-text-build.py. Usage: node tools/vox-text-export.mjs sentence > glyphs.json
import { FONTS, kern } from '../src/core/fonts/index.js';
import '../src/core/fonts/sign.js';
import '../src/core/fonts/sentence.js';
import '../src/core/fonts/block.js';

const font = FONTS[process.argv[2] || 'sentence'];
const chars = Object.keys(font.glyphs);
const pairs = [];
for (const a of chars) for (const b of chars) { const k = kern(font, a, b); if (k) pairs.push([a, b, k]); }
console.log(JSON.stringify({
  id: font.id, name: font.name, cap: font.cap, xHeight: font.xHeight, descent: font.descent, gap: font.gap, space: font.space,
  glyphs: Object.fromEntries(chars.map((c) => [c, { y: font.glyphs[c].y, w: font.glyphs[c].w, rows: font.glyphs[c].rows }])), pairs,
}));
