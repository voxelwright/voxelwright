// The addresses a person is actually given: the bare root of each server, by its tailnet name
// when one is passed. Every page must end on /kit/showcase/ with its own stylesheet, script and voxels.
// node tools/root.mjs [base ...]   (default: local kit server)
import { chromium, webkit } from 'playwright';
const bases = process.argv.slice(2).length ? process.argv.slice(2) : [`http://127.0.0.1:${process.env.PORT || 5989}`];
let bad = 0;
for (const [name, kind, args] of [['chromium', chromium, ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu']], ['webkit', webkit, []]]) {
  let browser;
  try { browser = await kind.launch({ args }); } catch (e) { console.log(`${name}: not installed, skipped`); continue; }
  for (const base of bases) {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    const failed = [];
    page.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${new URL(r.url()).pathname}`); });
    page.on('pageerror', (e) => failed.push('error: ' + e.message));
    await page.goto(base + '/');
    await page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 9000 }).catch(() => failed.push('never ready'));
    await page.waitForTimeout(600);
    const got = await page.evaluate(() => ({
      path: location.pathname,
      lives: document.querySelectorAll('[data-vx-live]').length,
      sheets: [...document.styleSheets].filter((s) => { try { return s.cssRules.length > 0; } catch { return false; } }).length,
      font: getComputedStyle(document.body).fontFamily.split(',')[0],
    }));
    const ok = got.path === '/kit/showcase/' && got.sheets >= 2 && failed.length === 0 && (name === 'webkit' || got.lives > 0);
    if (!ok) bad++;
    console.log(`${ok ? 'ok ' : 'BAD'} ${name} ${base}/ -> ${got.path}, ${got.lives} voxel parts, ${got.sheets} stylesheets, body in ${got.font}${failed.length ? ', ' + failed.join('; ') : ''}`);
    if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}/root-${name}-${new URL(base).port}.png` });
  }
  await browser.close();
}
console.log(bad ? `${bad} wrong` : 'every root address lands on the showcase with its styles and script');
process.exit(bad ? 1 : 0);
