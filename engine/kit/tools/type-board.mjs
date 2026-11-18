// The board on narrow screens. Usage: node tools/type-board.mjs [pair] [extra query, e.g. "&lang=uk"]
//  1. by width, in English and Ukrainian: does the board fit its column, is the page free of
//     sideways scroll, and is the plain board the same box as the voxel board?
//  2. a live resize across the thresholds, without a reload: does the board rebuild at the new voxel?
import { chromium } from 'playwright';
const port = process.env.PORT || 5987;
const pair = process.argv[2] || 'vox';
const extra = process.argv[3] || '';
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const url = (lang, plain) => `http://127.0.0.1:${port}/kit/showcase/type.html?pair=${pair}&faces=none${lang ? '&lang=' + lang : ''}${plain ? '&plain=1' : ''}${extra}`;
const read = () => {
  const b = document.querySelector('.pairing [data-role="board"]');
  const r = b.getBoundingClientRect(), p = b.parentElement.getBoundingClientRect();
  const cs = getComputedStyle(b);
  return { x: r.left, y: r.top + scrollY, w: r.width, h: r.height, room: b.parentElement.clientWidth, right: r.right - p.right, vx: parseFloat(cs.getPropertyValue('--vx')), scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth, live: b.hasAttribute('data-vx-live'), set: window.vx?.live?.(b)?.state?.fit?.font?.id || '' };
};
const open = async (w, lang, plain) => {
  const page = await (await browser.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: 1 })).newPage();
  await page.goto(url(lang, plain));
  await page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 12000 });
  await page.waitForTimeout(400);
  return page;
};
let fails = 0;
for (const lang of ['', 'uk']) {
  console.log(`== ${pair}${extra}, ${lang || 'en'}: width | voxel | set | board | column | plain box equal`);
  for (const w of [280, 300, 320, 352, 356, 360, 364, 375, 390, 430, 520, 560, 800, 1040, 1100, 1280]) {
    const a = await open(w, lang, false), b = await open(w, lang, true);
    const L = await a.evaluate(read), P = await b.evaluate(read);
    await a.context().close(); await b.context().close();
    const same = Math.abs(L.w - P.w) < 0.5 && Math.abs(L.h - P.h) < 0.5 && Math.abs(L.y - P.y) < 0.5;
    const ok = L.w <= L.room + 0.5 && P.w <= P.room + 0.5 && L.scroll <= 0 && P.scroll <= 0 && same && L.live && !P.live;
    if (!ok) fails++;
    console.log(String(w).padEnd(5), `${L.vx} px`.padEnd(5), L.set.padEnd(8), `${Math.round(L.w)}x${Math.round(L.h)}`.padEnd(8), String(L.room).padEnd(4), same ? 'same' : `PLAIN ${Math.round(P.w)}x${Math.round(P.h)} at ${Math.round(P.y)} vs ${Math.round(L.y)}`, ok ? '' : `  <-- FAIL${L.scroll > 0 || P.scroll > 0 ? ' sideways scroll ' + Math.max(L.scroll, P.scroll) : ''}${L.w > L.room ? ' overflows' : ''}`);
  }
}
// a live resize, no reload
for (const lang of ['', 'uk']) {
  const page = await open(430, lang, false);
  const seen = [];
  for (const w of [430, 340, 320, 280, 320, 360, 430, 800, 430]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(700);
    const L = await page.evaluate(read);
    const ok = L.w <= L.room + 0.5 && L.scroll <= 0 && Math.abs(L.w / L.vx - Math.round(L.w / L.vx)) < 0.01;
    if (!ok) fails++;
    seen.push(`${w}: ${L.vx} px ${L.set} ${Math.round(L.w)}${ok ? '' : ' FAIL'}`);
  }
  console.log(`== resize, ${lang || 'en'}: ` + seen.join(' | '));
  await page.context().close();
}
await browser.close();
console.log(fails ? `${fails} FAILED` : 'all pass');
process.exit(fails ? 1 : 0);
