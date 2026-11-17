// The layout gates for a pairing, in Chromium. Usage: node tools/type-gates.mjs <pair>
//  1. fonts: does anything move when the web fonts arrive? The page is laid out once with every font
//     file refused (so text is in the fallback stack) and once normally, and every box is compared.
//  2. voxels: does anything move when the voxels take over from the plain page? Swept across widths.
//  3. pixels: at each text size, does every label, heading and part start on a whole pixel?
import { chromium } from 'playwright';
const port = process.env.PORT || 5987;
const pair = process.argv[2] || 'plex';
const lang = process.env.TYPE_LANG ? `&lang=${process.env.TYPE_LANG}` : '';
const only = process.argv[3]; // fonts | voxels | pixels, or nothing for all three
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const SEL = '.pairing .vx-lettering, .pairing .lede, .pairing h3, .pairing .say p, .pairing .vx-button, .pairing .vx-toggle, .pairing .vx-tabs, .pairing .vx-list, .pairing .vx-field, .pairing .vx-card, .pairing .vx-toast';
const boxes = async (w, q, block) => {
  const page = await (await browser.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: 1 })).newPage();
  if (block) await page.route('**/*.woff2', (r) => r.abort());
  await page.goto(`http://127.0.0.1:${port}/showcase/type.html?pair=${pair}&faces=none&fallback=real${lang}${q}`);
  await page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 12000 });
  await page.waitForTimeout(500);
  const out = await page.evaluate((sel) => [...document.querySelectorAll(sel)].map((e) => { const r = e.getBoundingClientRect(); return { t: (e.dataset.role || e.className.split(' ')[0] || e.tagName) + ' ' + e.textContent.trim().slice(0, 10), x: r.left, y: r.top + scrollY, w: r.width, h: r.height }; }), SEL);
  await page.context().close();
  return out;
};
const worst = (a, b) => { let m = { d: 0 }; a.forEach((p, i) => { const q = b[i]; const d = Math.max(Math.abs(p.y - q.y), Math.abs(p.h - q.h)); if (d > m.d) m = { d, t: p.t, from: `${Math.round(p.h)} tall at ${Math.round(p.y)}`, to: `${Math.round(q.h)} tall at ${Math.round(q.y)}` }; }); return m; };

if (!only || only === 'fonts') console.log(`== ${pair}: when the fonts arrive (fallback: Arial)`);
for (const w of !only || only === 'fonts' ? [390, 768, 1280] : []) { const m = worst(await boxes(w, '', true), await boxes(w, '', false)); console.log(String(w).padEnd(6), m.d ? `moves up to ${Math.round(m.d)} px: ${m.t}, ${m.from} -> ${m.to}` : 'nothing moves'); }

const bad = [];
for (let w = 320; (!only || only === 'voxels') && w <= 1440; w += 40) { const m = worst(await boxes(w, '&plain=1', false), await boxes(w, '', false)); if (m.d >= 1) bad.push(`${w}: ${Math.round(m.d)} px (${m.t})`); }
if (!only || only === 'voxels') console.log(`== ${pair}: when the voxels take over, by width\n` + (bad.length ? 'moves at ' + bad.join(' | ') : 'nothing moves at any width from 320 to 1440, every 40 px'));

if (!only || only === 'pixels') console.log(`== ${pair}: whole pixels, by text size`);
for (const size of !only || only === 'pixels' ? [14, 16, 17, 20] : []) for (const w of [390, 1280]) {
  const page = await (await browser.newContext({ viewport: { width: w, height: 1800 }, deviceScaleFactor: 1 })).newPage();
  await page.goto(`http://127.0.0.1:${port}/showcase/type.html?pair=${pair}&faces=none${lang}&size=${size}`);
  await page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 12000 });
  await page.waitForTimeout(700);
  const off = await page.evaluate(() => [...document.querySelectorAll('.pairing .vx-label, .pairing .vx-row a, .pairing .vx-field-label, .pairing .vx-lettering, .pairing .vx-button, .pairing .vx-tabs, .pairing .vx-list, .pairing .vx-well, .pairing .vx-card, .pairing .vx-toast, .pairing .vx-switch')].map((e) => { const r = e.getBoundingClientRect(); return { n: e.textContent.trim().slice(0, 12) || e.className, x: r.left, y: r.top + scrollY }; }).filter((o) => Math.abs(o.x - Math.round(o.x)) > 0.01 || Math.abs(o.y - Math.round(o.y)) > 0.01).map((o) => `${o.n} at ${o.x.toFixed(2)}, ${o.y.toFixed(2)}`));
  console.log(`${size} px at ${w}:`.padEnd(16), off.length ? off.length + ' off the grid, e.g. ' + off.slice(0, 2).join(' | ') : 'all on whole pixels');
  await page.context().close();
}
await browser.close();
