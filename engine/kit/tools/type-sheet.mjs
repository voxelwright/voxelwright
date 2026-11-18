// Shoot every text face on the real kit, one screen per face, for side-by-side sheets.
// Usage: node tools/type-sheet.mjs <round> [--faces a,b] [--sizes 14,17] [--themes light,dark] [--scales 1,2]
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : args[i + 1]; };
const round = args[0] || 'r1';
const port = process.env.PORT || 5987;
const faces = flag('faces', 'overpass,plex,atkinson,barlow,chakra,b612,geistpixel,departure,voxtext').split(',');
const sizes = flag('sizes', '17').split(',');
const themes = flag('themes', 'light,dark').split(',');
const scales = flag('scales', '2').split(',').map(Number);
const dir = `shots/type/${round}`;
await mkdir(dir, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
for (const scale of scales) for (const theme of themes) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, deviceScaleFactor: scale, colorScheme: theme === 'dark' ? 'dark' : 'light' });
  for (const face of faces) for (const size of sizes) {
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`http://127.0.0.1:${port}/kit/showcase/type.html?face=${face}&size=${size}&theme=${theme}`);
    await page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 9000 }).catch(() => errors.push('never ready'));
    const there = await page.locator('.screen[data-solo]').count();
    if (!there) { await page.close(); continue; }
    const loaded = await page.locator('.screen[data-solo]').getAttribute('data-loaded');
    const hh = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.setViewportSize({ width: 390, height: Math.min(hh, 8000) });
    await page.waitForTimeout(1500);
    const out = `${dir}/${face}-${size}-${theme}-${scale}x.png`;
    await page.screenshot({ path: out });
    console.log(out, loaded === 'yes' ? '' : 'FONT DID NOT LOAD', errors.join(' | '));
    await page.close();
  }
  await ctx.close();
}
await browser.close();
