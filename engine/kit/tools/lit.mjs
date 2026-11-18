// Pictures of a lit-look page, by day and at night.
//   PORT=5989 node tools/lit.mjs <page under showcase/> [--w 1100] [--h 800] [--scale 2] [--press <selector>] [--focus <selector>] [--out name]
// Writes shots/lit/<out>-{day,night}.png, and with --press or --focus the same with that done.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : args[i + 1]; };
const page = args[0] || 'lit-spike.html';
const port = process.env.PORT || 5989;
const w = Number(flag('w', 1100)), h = Number(flag('h', 800)), scale = Number(flag('scale', 2));
const out = flag('out', page.replace(/\.html.*$/, ''));
const press = flag('press', ''), focus = flag('focus', '');
const dir = 'shots/lit';
await mkdir(dir, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
const problems = [];
for (const theme of ['light', 'dark']) {
  const tone = theme === 'light' ? 'day' : 'night';
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: scale });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => problems.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
  await p.goto(`http://127.0.0.1:${port}/showcase/${page}${page.includes('?') ? '&' : '?'}theme=${theme}`);
  await p.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 9000 }).catch(() => problems.push('never became ready'));
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(900);
  await p.screenshot({ path: `${dir}/${out}-${tone}.png` });
  if (press) {
    const b = await p.locator(press).first().boundingBox();
    await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await p.waitForTimeout(350);
    await p.screenshot({ path: `${dir}/${out}-${tone}-aim.png` });
    await p.mouse.down();
    await p.waitForTimeout(160);
    await p.screenshot({ path: `${dir}/${out}-${tone}-press.png` });
    await p.mouse.up();
    await p.mouse.move(2, 2);
  }
  if (focus) {
    await p.locator(focus).first().focus();
    await p.waitForTimeout(500);
    await p.screenshot({ path: `${dir}/${out}-${tone}-focus.png` });
  }
  await ctx.close();
}
await browser.close();
if (problems.length) console.log('problems:\n  ' + [...new Set(problems)].join('\n  '));
console.log(`${dir}/${out}-{day,night}.png`);
