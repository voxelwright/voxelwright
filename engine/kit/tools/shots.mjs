// Screenshots for the look loop. Usage: node tools/shots.mjs <page> <name> [--dark] [--w 1280] [--h 800] [--press #id] [--scale 2]
import { chromium, webkit } from 'playwright';
import { mkdir } from 'node:fs/promises';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : args[i + 1]; };
const has = (n) => args.includes('--' + n);
const page_ = args[0] || 'showcase/';
const name = args[1] || 'shot';
const port = process.env.PORT || 5985;
const w = Number(flag('w', 1280)), h = Number(flag('h', 800)), scale = Number(flag('scale', 2));

await mkdir('shots', { recursive: true });
const browser = has('webkit') ? await webkit.launch() : await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: scale, colorScheme: has('dark') ? 'dark' : 'light', reducedMotion: has('reduced') ? 'reduce' : 'no-preference' });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`http://127.0.0.1:${port}/${page_}`);
await page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 8000 }).catch(() => errors.push('never became ready'));
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(Number(flag('wait', 900)));
const press = flag('press', null);
if (press) {
  const box = await page.locator(press).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(400);
}
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--click') { await page.click(args[i + 1]); await page.waitForTimeout(Number(flag('after', 700))); }
  if (args[i] === '--hover') { await page.hover(args[i + 1]); await page.waitForTimeout(250); }
  if (args[i] === '--key') { await page.keyboard.press(args[i + 1]); await page.waitForTimeout(250); }
  if (args[i] === '--eval') { await page.evaluate(args[i + 1]); await page.waitForTimeout(Number(flag('after', 700))); }
}
const clip = flag('clip', null);
await page.screenshot({ path: `shots/${name}.png`, fullPage: has('full'), clip: clip ? Object.fromEntries(clip.split(',').map((v, i) => [['x', 'y', 'width', 'height'][i], Number(v)])) : undefined });
if (errors.length) console.log('console:', errors.slice(0, 12).join('\n'));
console.log(`shots/${name}.png`);
await browser.close();
