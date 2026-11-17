import { chromium } from 'playwright';
const b = await chromium.launch();
for (const q of ['', '?none', '?fail', '?late=0']) {
  const p = await b.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://127.0.0.1:5985/showcase/seam.html' + q);
  await p.waitForSelector('html[data-ready]');
  console.log(q || '(late)', JSON.stringify(await p.evaluate(() => window.seam)), errs);
  if (!q) await p.screenshot({ path: 'shots/seam.png' });
  await p.close();
}
await b.close();
