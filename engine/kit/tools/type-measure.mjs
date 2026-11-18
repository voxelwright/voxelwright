// Numbers for the lettering: how many lines and how tall a heading sets at a given width, per glyph set.
import { chromium } from 'playwright';
const port = process.env.PORT || 5987;
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
const rows = [];
for (const w of [390, 1280]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${port}/kit/showcase/type.html?faces=none`);
  await page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 9000 });
  const out = await page.evaluate(async () => {
    const { fit } = await import('/kit/src/components/lettering.js');
    const host = document.querySelector('#directions');
    const res = [];
    for (const [font, scale] of [['sign', 2], ['sign', 1], ['block', 1], ['sentence', 2], ['sentence', 1]]) {
      for (const text of ['The rules', 'A plant, grown from a number', 'The plain version']) {
        const el = document.createElement('h2');
        el.className = 'vx-lettering'; el.dataset.vxFont = font; el.dataset.vxScale = scale; el.dataset.vxBoard = 'none'; el.textContent = text;
        host.append(el);
        const f = fit(el, 4);
        res.push({ font, scale, text, lines: f.lines.length, widthPx: f.width * f.scale * 4, heightPx: (f.rows + f.over + f.under) * f.scale * 4 });
        el.remove();
      }
    }
    return res;
  });
  for (const r of out) rows.push({ viewport: w, ...r });
  await ctx.close();
}
await browser.close();
console.log('viewport font     scale lines width height  text');
for (const r of rows) console.log(String(r.viewport).padEnd(8), r.font.padEnd(8), String(r.scale).padEnd(5), String(r.lines).padEnd(5), String(r.widthPx).padEnd(5), String(r.heightPx).padEnd(7), r.text);
