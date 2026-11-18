// Walk the whole type page as a visitor would: scroll it top to bottom at two widths, click every tab, and report errors.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
const port = process.env.PORT || 5987;
await mkdir('shots/type/walk', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
for (const w of [1280, 390]) {
  const page = await (await browser.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: 1 })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${port}/kit/showcase/type.html`);
  await page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 15000 });
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  let n = 0;
  for (let y = 0; y < height; y += 900) { await page.evaluate((v) => scrollTo(0, v), y); await page.waitForTimeout(350); if (n % 4 === 0 || y + 900 >= height) await page.screenshot({ path: `shots/type/walk/${w}-${String(n).padStart(2, '0')}.png` }); n++; }
  await page.evaluate(() => scrollTo(0, 0));
  const clicks = [];
  for (const [tabs, label] of [['#size', '14'], ['#size', '20'], ['#size', '16'], ['#size', '17'], ['#light', 'Night'], ['#light', 'Day'], ['#light', 'Auto']]) {
    await page.locator(`${tabs} [role="tab"]`, { hasText: label }).click();
    await page.waitForTimeout(500);
    clicks.push(label + ': root ' + await page.evaluate(() => getComputedStyle(document.documentElement).fontSize + ' ' + (document.documentElement.dataset.theme || 'auto')));
  }
  await page.locator('#light [role="tab"]', { hasText: 'Night' }).click(); await page.waitForTimeout(800);
  await page.screenshot({ path: `shots/type/walk/${w}-night-top.png` });
  console.log(`${w}: page ${height} px tall, ${n} screens, sideways overflow ${overflow} px, ${errors.length ? 'ERRORS: ' + errors.slice(0, 4).join(' | ') : 'no errors'}`);
  console.log('   ' + clicks.join(' | '));
  await page.context().close();
}
await browser.close();
