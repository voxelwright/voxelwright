// Numbers before taste: overflow, fonts, console errors, focus order. Usage: node tools/probe.mjs [page] [--w 390]
import { chromium } from 'playwright';
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : args[i + 1]; };
const w = Number(flag('w', 390));
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
const ctx = await b.newContext({ viewport: { width: w, height: 844 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
const errors = [];
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
p.on('pageerror', (e) => errors.push(String(e)));
const requests = [];
p.on('request', (r) => { if (!r.url().startsWith('http://127.0.0.1')) requests.push(r.url()); });
await p.goto(`http://127.0.0.1:${process.env.PORT || 5985}/${args[0] && !args[0].startsWith('--') ? args[0] : 'showcase/'}`);
await p.waitForTimeout(1200);
const r = await p.evaluate(() => {
  const de = document.documentElement;
  window.scrollTo(500, 0);
  const wide = [];
  for (const el of document.querySelectorAll('body *')) {
    if (el.classList.contains('vx-canvas')) continue;
    const r = el.getBoundingClientRect();
    if (r.right > de.clientWidth + 1 && r.width > 0) wide.push(el.tagName + '.' + el.className + ' ' + Math.round(r.right));
  }
  const small = [];
  for (const el of document.querySelectorAll('button, a, input, [role="tab"]')) {
    const r = el.getBoundingClientRect();
    if (r.width && (r.height < 44) && !el.closest('p, .say, .foot')) small.push(el.tagName + '#' + el.id + '.' + el.className + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
  }
  return { scrollX: window.scrollX, scrollWidth: de.scrollWidth, clientWidth: de.clientWidth, wide: wide.slice(0, 8), small: small.slice(0, 12),
    fonts: [...document.fonts].map((f) => f.family + ':' + f.status), lives: document.querySelectorAll('[data-vx-live]').length };
});
console.log(JSON.stringify({ ...r, errors, external: requests }, null, 1));
await b.close();
