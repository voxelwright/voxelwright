// Open every showcase page. Only generated pictures under shots/ may be missing.
//   PORT=5989 node tools/links.mjs
import { chromium } from 'playwright';
import { readdir } from 'node:fs/promises';

const base = `http://127.0.0.1:${process.env.PORT || 5989}/kit/`;
const origin = new URL(base).origin;
const files = (await readdir('showcase', { recursive: true })).filter((f) => f.endsWith('.html')).sort();
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
const shots = (url) => url.startsWith(base + 'shots/');
let bad = 0;
for (const file of files) {
  const page = await browser.newPage();
  const errors = new Set();
  await page.route((url) => /^https?:$/.test(url.protocol) && url.origin !== origin, (r) => r.abort());
  page.on('requestfailed', (r) => { if (!shots(r.url())) errors.add(`${r.failure().errorText} ${r.url()}`); });
  page.on('response', (r) => { if (r.status() >= 400 && !shots(r.url())) errors.add(`${r.status()} ${r.url()}`); });
  page.on('pageerror', (e) => errors.add(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !(shots(m.location().url) && m.text().startsWith('Failed to load resource'))) errors.add(m.text());
  });
  try {
    await page.goto(base + 'showcase/' + file);
    await page.evaluate(async () => {
      for (const img of document.images) img.loading = 'eager';
      await document.fonts.ready;
    });
    await page.waitForLoadState('networkidle');
  } catch (e) { errors.add(e.message); }
  for (const e of errors) console.log(`FAIL ${file}: ${e}`);
  bad += errors.size;
  await page.close();
}
await browser.close();
console.log(`${files.length} showcase pages, ${bad} errors`);
process.exitCode = bad ? 1 : 0;
