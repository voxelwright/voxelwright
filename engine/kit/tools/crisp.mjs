// Do the words on keys start on whole pixels at 1x? Vox Text is cut from half-voxel cells, so it
// is sharp only when its text box starts on a whole pixel. node tools/crisp.mjs [page]
import { chromium } from 'playwright';
const port = process.env.PORT || 5985;
const path = process.argv[2] || 'showcase/index.html';
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
let bad = 0;
for (const w of [390, 768, 1280]) for (const mode of ['plain', 'live']) {
  const page = await (await browser.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: 1 })).newPage();
  if (mode === 'plain') await page.addInitScript(() => { new MutationObserver((_, o) => { if (document.documentElement) { document.documentElement.setAttribute('data-vx-plain', ''); o.disconnect(); } }).observe(document, { childList: true }); });
  await page.goto(`http://127.0.0.1:${port}/kit/${path}`);
  await page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 9000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  const off = await page.evaluate((live) => {
    const out = [];
    for (const el of document.querySelectorAll('.vx-button, .vx-tabs > [role="tab"], .vx-toggle-button, .vx-toggle-group > label')) {
      if (!el.offsetParent) continue;
      if (live && !el.closest('[data-vx-live]')) continue; // a part the page keeps plain on purpose
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let node; while ((node = walker.nextNode()) && !node.textContent.trim());
      if (!node) continue;
      const range = document.createRange(); range.selectNodeContents(node);
      const r = range.getBoundingClientRect();
      const fx = Math.abs(r.left - Math.round(r.left)), fy = Math.abs(r.top + scrollY - Math.round(r.top + scrollY));
      if (fx > 0.02 || fy > 0.02) out.push(`${node.textContent.trim().slice(0, 16)} x ${r.left.toFixed(2)} y ${(r.top + scrollY).toFixed(2)}`);
    }
    const canvases = [...document.querySelectorAll('.vx-canvas')].filter((c) => c.offsetParent).map((c) => c.getBoundingClientRect()).filter((r) => Math.abs(r.left - Math.round(r.left)) > 0.02 || Math.abs(r.top - Math.round(r.top)) > 0.02).length;
    return { off: out, all: document.querySelectorAll('.vx-button, .vx-tabs > [role="tab"], .vx-toggle-button, .vx-toggle-group > label').length, canvases, parts: document.querySelectorAll('.vx-canvas').length };
  }, mode === 'live');
  // Live is the gate. Plain is told, not failed: there the page's own spacing decides.
  if (mode === 'live') bad += off.off.length + off.canvases;
  console.log(`${w} ${mode}: ${off.off.length} of ${off.all} key labels start off a whole pixel${mode === 'live' ? `; ${off.canvases} of ${off.parts} voxel canvases do` : ''}${off.off.length ? '\n   ' + off.off.slice(0, 4).join('\n   ') : ''}`);
  await page.close();
}
await browser.close();
console.log(bad ? `${bad} live labels or canvases are off the pixel grid` : 'live: every key label and every voxel canvas starts on a whole pixel');
process.exit(bad ? 1 : 0);
