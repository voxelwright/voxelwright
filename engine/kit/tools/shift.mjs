// Does anything move when the voxels take over from the plain page?
// node tools/shift.mjs [page] : compares every lettering box and the page height, plain against live.
import { chromium } from 'playwright';
const port = process.env.PORT || 5985;
const path = process.argv[2] || 'showcase/principles.html';
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
let worst = 0;
for (const w of [320, 390, 560, 768, 1080, 1280]) {
  const boxes = {};
  for (const mode of ['plain', 'live']) {
    const page = await (await browser.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: 1 })).newPage();
    if (mode === 'plain') await page.addInitScript(() => { new MutationObserver((_, o) => { if (document.documentElement) { document.documentElement.setAttribute('data-vx-plain', ''); o.disconnect(); } }).observe(document, { childList: true }); });
    await page.goto(`http://127.0.0.1:${port}/kit/${path}`);
    await page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 9000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(500);
    boxes[mode] = await page.evaluate(() => ({
      live: document.querySelectorAll('[data-vx-live]').length,
      height: document.documentElement.scrollHeight,
      signs: [...document.querySelectorAll('.vx-sign, .vx-lettering')].map((e) => { const r = e.getBoundingClientRect(); return { t: e.textContent.trim().slice(0, 18), bare: e.dataset.vxBoard === 'none', y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) }; }),
    }));
    await page.close();
  }
  const { plain, live } = boxes;
  if (plain.live !== 0) console.log(`!! the plain run had ${plain.live} live parts`);
  console.log(`-- ${w}: page height plain ${plain.height}, live ${live.height} (${live.height - plain.height})`);
  worst = Math.max(worst, Math.abs(live.height - plain.height));
  live.signs.forEach((l, i) => {
    const p = plain.signs[i];
    // a heading is a block in its column, so only a board's width can move anything
    const d = Math.max(Math.abs(l.y - p.y), Math.abs(l.h - p.h), l.bare ? 0 : Math.abs(l.w - p.w));
    worst = Math.max(worst, d);
    if (d > 1) console.log(`   ${l.t.padEnd(20)} plain ${p.w}x${p.h} at ${p.y}   live ${l.w}x${l.h} at ${l.y}`);
  });
}
console.log(worst <= 1 ? 'no shift' : `worst shift ${worst} px`);
await browser.close();
