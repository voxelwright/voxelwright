// Screenshots for the type study. Takes a full URL (http or file), so it can shoot scratch pages too.
// Usage: node tools/type-shot.mjs <url> <out.png> [--w 1280] [--h 800] [--scale 2] [--dark] [--sel css] [--full] [--fit] [--wait 600] [--eval js]
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : args[i + 1]; };
const has = (n) => args.includes('--' + n);
const [url, out] = args;
await mkdir(dirname(out), { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
const ctx = await browser.newContext({ viewport: { width: Number(flag('w', 1280)), height: Number(flag('h', 800)) }, deviceScaleFactor: Number(flag('scale', 2)), colorScheme: has('dark') ? 'dark' : 'light' });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(url);
await page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 8000 }).catch(() => {});
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(Number(flag('wait', 600)));
const ev = flag('eval', null);
if (ev) { const r = await page.evaluate(ev); if (r !== undefined) console.log(typeof r === 'string' ? r : JSON.stringify(r)); await page.waitForTimeout(300); }
// --fit: grow the window to the whole page first, so parts below the fold are built before the picture
if (has('fit')) {
  const hh = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: Number(flag('w', 1280)), height: Math.min(hh, 8000) });
  await page.waitForTimeout(Number(flag('settle', 1400)));
}
const sel = flag('sel', null);
if (sel) await page.locator(sel).first().screenshot({ path: out });
else await page.screenshot({ path: out, fullPage: has('full') });
if (errors.length) console.log('console:', errors.slice(0, 12).join('\n'));
console.log(out);
await browser.close();
