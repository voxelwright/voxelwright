// Does anything move when the voxels take over from the plain page? Compares every heading's box, plain against live.
import { chromium } from 'playwright';
const port = process.env.PORT || 5987;
const pair = process.argv[2] || 'vox';
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
for (const w of [390, 768, 1280]) {
  const boxes = {};
  for (const mode of ['plain', 'live']) {
    const page = await (await browser.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: 1 })).newPage();
    await page.goto(`http://127.0.0.1:${port}/showcase/type.html?pair=${pair}&faces=none${mode === 'plain' ? '&plain=1' : ''}`);
    await page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 9000 });
    await page.waitForTimeout(400);
    boxes[mode] = await page.evaluate(() => [...document.querySelectorAll('.pairing .vx-lettering, .pairing .vx-sign, .pairing h3, .pairing .show')].map((e) => { const r = e.getBoundingClientRect(); return { t: (e.dataset.role || e.tagName) + ' ' + e.textContent.trim().slice(0, 12), x: Math.round(r.left), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) }; }));
    await page.close();
  }
  console.log(`-- ${pair} at ${w}`);
  boxes.live.forEach((l, i) => { const p = boxes.plain[i]; console.log(l.t.padEnd(22), `plain ${p.w}x${p.h} at y ${p.y}`.padEnd(28), `live ${l.w}x${l.h} at y ${l.y}`.padEnd(28), `moved ${l.y - p.y} px, height ${l.h - p.h}`); });
}
await browser.close();
