// The seam between the kit and a renderer handed to it: use(), ready(), a late one, none, one that
// fails, one that owns the canvases, one that loses its device.   [PORT=5989] node tools/seam.mjs
import { chromium } from 'playwright';
const port = process.env.PORT || 5985;
const b = await chromium.launch();
for (const q of ['', '?none', '?fail', '?late=0', '?own', '?own&lost']) {
  const p = await b.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${port}/showcase/seam.html` + q);
  await p.waitForSelector('html[data-ready]');
  console.log(q || '(late)', JSON.stringify(await p.evaluate(() => window.seam)), errs);
  if (!q) await p.screenshot({ path: 'shots/seam.png' });
  await p.close();
}
await b.close();
