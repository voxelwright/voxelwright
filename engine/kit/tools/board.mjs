// The showcase's board and tab strips on narrow screens. Usage: [PORT=5989] node tools/board.mjs [page]
//  1. by width: does the board fit its column, is the page free of sideways scroll, and is the
//     plain board the same box as the voxel board? Does every tab strip end inside the page's
//     column, plain and voxel alike, at the same size?
//  2. a live resize across the thresholds, without a reload: does the board rebuild at the new voxel?
// The same gate for the type study's boards (both languages) is tools/type-board.mjs.
import { chromium } from 'playwright';
const port = process.env.PORT || 5989;
const path = process.argv[2] || 'showcase/principles.html';
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
const read = () => {
  const b = document.querySelector('.vx-sign:not([data-vx-board="none"])');
  const r = b.getBoundingClientRect();
  const cs = getComputedStyle(b);
  const edge = document.body.getBoundingClientRect().right - parseFloat(getComputedStyle(document.body).paddingRight);
  const tabs = [...document.querySelectorAll('.vx-tabs')].filter((t) => t.offsetWidth).map((t) => { const q = t.getBoundingClientRect(); return { w: q.width, h: q.height, over: q.right - edge }; });
  const cases = [...document.querySelectorAll('.tabcard, .tabcard [role="tab"]')].map(el => {
    const q = el.getBoundingClientRect();
    return [q.left + scrollX, q.top + scrollY, q.width, q.height];
  });
  return { tabs, cases, y: r.top + scrollY, w: r.width, h: r.height, room: b.parentElement.clientWidth, vx: parseFloat(cs.getPropertyValue('--vx')), scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth, live: b.hasAttribute('data-vx-live'), set: window.vx?.live?.(b)?.state?.fit?.font?.id || '' };
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
  const caseSame = L.cases.length === P.cases.length && L.cases.every((r, i) => r.every((n, j) => Math.abs(n - P.cases[i][j]) < 0.5));
  if (!caseSame) { fails++; console.log(`FAIL ${w}px tab case or seated tabs have different boxes in plain and voxels`); }
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

// Check the projected casting, including the edge behind its face. CSS overflow clips
// that edge without changing scrollWidth. Phone and desktop use the same part builder.
for (const width of [390, 1280]) {
  await page.setViewportSize({ width, height: 844 });
  await page.goto(`http://127.0.0.1:${port}/kit/showcase/principles.html`);
  await page.locator('.tabcard').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => window.vx?.live(document.querySelector('.tabcard'))?.visible && !window.vx.stage.awake.size);
  const tabs = await page.evaluate(() => {
    const card = document.querySelector('.tabcard');
    const live = window.vx.live(card);
    const body = live.model.byName.body;
    const scale = live.s / devicePixelRatio;
    const origin = live.canvas.getBoundingClientRect().top + live.oy / devicePixelRatio;
    let top = Infinity;
    for (let i = 0; i < body.count; i++) {
      const y = body.rest[i * 3 + 1], z = body.rest[i * 3 + 2];
      top = Math.min(top, origin + (y + z / 2 - 0.75) * scale);
    }
    const tabs = card.parentElement.querySelector('.vx-tabs');
    const strip = tabs.getBoundingClientRect();
    const heading = document.createRange();
    heading.selectNodeContents(card.closest('figure').querySelector('figcaption'));
    const ink = [...tabs.querySelectorAll('[role="tab"]')].map(button => {
      const range = document.createRange();
      range.selectNodeContents(button.querySelector('.vx-label') || button);
      return range.getBoundingClientRect();
    });
    const faceTop = origin + live.faceZ * scale / 2;
    const clearance = card.contains(tabs)
      ? Math.min(...ink.map(r => r.top - faceTop))
      : Math.min(...ink.map(r => top - r.bottom));
    const stripClearance = card.contains(tabs) ? strip.top - faceTop : top - strip.bottom;
    return { inset: top - card.getBoundingClientRect().top, clearance, stripClearance,
      headingGap: top - heading.getBoundingClientRect().bottom, count: ink.length, voxel: live.vx };
  });
  const clear = tabs.count > 0 && tabs.inset >= -0.5 && tabs.clearance >= 0 &&
    tabs.stripClearance >= 0 && tabs.headingGap >= tabs.voxel;
  if (!clear) fails++;
  console.log(`${width}px tab case: lip inside case by ${tabs.inset.toFixed(1)} px, strip clear by ${tabs.stripClearance.toFixed(1)} px, ${tabs.count} legends clear by ${tabs.clearance.toFixed(1)} px, heading gap ${tabs.headingGap.toFixed(1)} px ${clear ? 'ok' : 'FAIL'}`);
  await page.goto(`http://127.0.0.1:${port}/kit/showcase/lit.html?only=deploy&still`);
  await page.waitForFunction(() => window.lit && window.vx.stage.awake.size === 0);
  const fit = await page.evaluate(() => {
    const card = window.vx.live(document.querySelector('#deploy .vx-card'));
    const body = card.model.byName.body;
    const canvas = card.canvas.getBoundingClientRect();
    const scale = card.s / devicePixelRatio;
    const legends = [...document.querySelectorAll('#deploy .bar > *')].map(el => el.getBoundingClientRect());
    let left = Infinity, right = -Infinity, screws = 0, collision = false;
    for (let i = 0; i < body.count; i++) {
      const [x, y, z] = body.rest.subarray(i * 3, i * 3 + 3);
      const cx = canvas.left + card.ox / devicePixelRatio + scale * (x + z / 2);
      const cy = canvas.top + card.oy / devicePixelRatio + scale * (y + z / 2);
      const half = 0.75 * scale;
      left = Math.min(left, cx - half);
      right = Math.max(right, cx + half);
      if (z < card.faceZ) continue;
      screws++;
      if (legends.some(r => cx + half + scale > r.left && cx - half - scale < r.right &&
        cy + half + scale > r.top && cy - half - scale < r.bottom)) collision = true;
    }
    return { left, right, screws, collision };
  });
  const ok = fit.left >= 0 && fit.right <= width && !fit.collision && (width === 390 ? fit.screws === 0 : fit.screws > 0);
  if (!ok) fails++;
  console.log(`${width}px cast panel: ${fit.left.toFixed(1)}..${fit.right.toFixed(1)}, ${fit.screws} screw cells, header clear: ${!fit.collision} ${ok ? 'ok' : 'FAIL'}`);
}
await browser.close();
console.log(fails ? `${fails} FAILED` : 'all pass');
process.exit(fails ? 1 : 0);
