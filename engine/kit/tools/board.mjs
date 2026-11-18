// The showcase's board and tab strips on narrow screens. Usage: [PORT=5986] node tools/board.mjs [page]
//  1. by width: does the board fit its column, is the page free of sideways scroll, and is the
//     plain board the same box as the voxel board? Does every tab strip end inside the page's
//     column, plain and voxel alike, at the same size?
//  2. a live resize across the thresholds, without a reload: does the board rebuild at the new voxel?
// The same gate for the type study's boards (both languages) is tools/type-board.mjs.
import { chromium } from 'playwright';
const port = process.env.PORT || 5985;
const path = process.argv[2] || 'showcase/';
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
const read = () => {
  const b = document.querySelector('.vx-sign:not([data-vx-board="none"])');
  const r = b.getBoundingClientRect();
  const cs = getComputedStyle(b);
  const edge = document.body.getBoundingClientRect().right - parseFloat(getComputedStyle(document.body).paddingRight);
  const tabs = [...document.querySelectorAll('.vx-tabs')].filter((t) => t.offsetWidth).map((t) => { const q = t.getBoundingClientRect(); return { w: q.width, h: q.height, over: q.right - edge }; });
  return { tabs, y: r.top + scrollY, w: r.width, h: r.height, room: b.parentElement.clientWidth, vx: parseFloat(cs.getPropertyValue('--vx')), scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth, live: b.hasAttribute('data-vx-live'), set: window.vx?.live?.(b)?.state?.fit?.font?.id || '' };
};
const open = async (w, plain) => {
  const page = await (await browser.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: 1 })).newPage();
  if (plain) await page.addInitScript(() => { new MutationObserver((_, o) => { if (document.documentElement) { document.documentElement.setAttribute('data-vx-plain', ''); o.disconnect(); } }).observe(document, { childList: true }); });
  await page.goto(`http://127.0.0.1:${port}/kit/${path}`);
  await page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 12000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  return page;
};
let fails = 0;
console.log(`== ${path} on ${port}: width | voxel | board | column | plain box`);
for (const w of [280, 300, 320, 352, 356, 360, 375, 390, 393, 397, 398, 430, 520, 560, 800, 1040, 1100, 1280]) {
  const a = await open(w, false), b = await open(w, true);
  const L = await a.evaluate(read), P = await b.evaluate(read);
  await a.context().close(); await b.context().close();
  const same = Math.abs(L.w - P.w) < 0.5 && Math.abs(L.h - P.h) < 0.5 && Math.abs(L.y - P.y) < 0.5;
  const over = Math.max(0, ...L.tabs.map((t) => t.over), ...P.tabs.map((t) => t.over));
  const tabsSame = L.tabs.length === P.tabs.length && L.tabs.every((t, i) => Math.abs(t.w - P.tabs[i].w) < 0.5 && Math.abs(t.h - P.tabs[i].h) < 0.5);
  const ok = L.w <= L.room + 0.5 && P.w <= P.room + 0.5 && L.scroll <= 0 && P.scroll <= 0 && same && L.live && !P.live && over < 0.5 && tabsSame;
  if (!ok) fails++;
  console.log(String(w).padEnd(5), `${L.vx} px`.padEnd(5), `${Math.round(L.w)}x${Math.round(L.h)}`.padEnd(8), String(L.room).padEnd(4), same ? 'same' : `PLAIN ${Math.round(P.w)}x${Math.round(P.h)} at ${Math.round(P.y)} vs ${Math.round(L.y)}`, 'tabs ' + L.tabs.map((t) => `${Math.round(t.w)}x${Math.round(t.h)}`).join(' '), ok ? '' : `  <-- FAIL${L.scroll > 0 || P.scroll > 0 ? ' sideways scroll ' + Math.max(L.scroll, P.scroll) : ''}${L.w > L.room ? ' board overflows' : ''}${L.live ? '' : ' not live'}${over >= 0.5 ? ` a tab strip runs ${Math.round(over)} px past the column` : ''}${tabsSame ? '' : ' plain tabs differ: ' + P.tabs.map((t) => `${Math.round(t.w)}x${Math.round(t.h)}`).join(' ')}`);
}
const page = await open(430, false);
const seen = [];
for (const w of [430, 340, 320, 280, 320, 360, 430, 800, 430]) {
  await page.setViewportSize({ width: w, height: 900 });
  await page.waitForTimeout(700);
  const L = await page.evaluate(read);
  const ok = L.w <= L.room + 0.5 && L.scroll <= 0 && Math.abs(L.w / L.vx - Math.round(L.w / L.vx)) < 0.01 && Math.max(0, ...L.tabs.map((t) => t.over)) < 0.5;
  if (!ok) fails++;
  seen.push(`${w}: ${L.vx} px ${Math.round(L.w)}${ok ? '' : ' FAIL'}`);
}
console.log('== resize: ' + seen.join(' | '));
await browser.close();
console.log(fails ? `${fails} FAILED` : 'all pass');
process.exit(fails ? 1 : 0);
