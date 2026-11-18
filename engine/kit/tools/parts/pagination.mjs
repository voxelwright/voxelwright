// A person on the pagination page: a real mouse presses seats and keys, real keys walk the links,
// and the page's router says which page is current. Run in voxels and plain, then on a phone,
// then with reduced motion. Says ok or FAIL for each thing that must hold.
//   PORT=5989 node tools/parts/pagination.mjs
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const port = process.env.PORT || 5989;
await mkdir('shots/parts/pagination', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
let bad = 0;
const say = (ok, what) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); };

async function open({ width = 1180, plain = false, reduced = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') p.errors.push(m.text()); });
  if (plain) await p.addInitScript(() => { new MutationObserver((_, o) => { if (document.documentElement) { document.documentElement.setAttribute('data-vx-plain', ''); o.disconnect(); } }).observe(document, { childList: true }); });
  await p.goto(`http://127.0.0.1:${port}/showcase/parts/pagination.html?theme=light`);
  await p.waitForFunction(() => document.documentElement.dataset.ready === '1');
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(600);
  return p;
}
const press = async (p, sel) => { await p.locator(sel).first().scrollIntoViewIfNeeded(); const b = await p.locator(sel).first().boundingBox(); await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 }); await p.mouse.down(); await p.waitForTimeout(80); await p.mouse.up(); };
const current = (p, nav = '#pager') => p.evaluate((nav) => [...document.querySelectorAll(`${nav} [aria-current="page"]`)].map((a) => a.textContent).join(','), nav);
const seats = (p, nav = '#pager') => p.evaluate((nav) => [...document.querySelectorAll(`${nav} ol > li`)].filter((li) => li.offsetParent).map((li) => (li.classList.contains('vx-pagination-gap') ? '…' : li.textContent.trim())).join(' '), nav);
// where the key is drawn, and where the current seat is, in voxels from the trench's edge
const key = (p, nav = '#pager') => p.evaluate((nav) => {
  const ol = document.querySelector(`${nav} ol`), l = window.vx.live(ol), cur = ol.querySelector('[aria-current="page"]');
  const seat = cur ? Math.round((cur.getBoundingClientRect().left - ol.getBoundingClientRect().left) / l.vx) : null;
  const near = (v) => (Math.abs(v - Math.round(v)) < 0.01 ? Math.round(v) : v);
  return { at: l.state.has ? near(l.model.byName.block.tx) : null, target: l.state.has ? l.spring('x').target : null, seat, well: l.well };
}, nav);
// everything of the part that reaches past the sheet's inner edge
const outside = (p, sel) => p.evaluate((sel) => {
  const sheet = document.querySelector('.sheet'), cs = getComputedStyle(sheet), r = sheet.getBoundingClientRect();
  const lo = r.left + parseFloat(cs.paddingLeft) - 0.5, hi = r.right - parseFloat(cs.paddingRight) + 0.5, out = [];
  for (const part of document.querySelectorAll(sel)) for (const el of [part, ...part.querySelectorAll('*')]) {
    if (el.matches('.vx-canvas, [class$="-aloud"]') || !el.getClientRects().length) continue;
    const b = el.getBoundingClientRect();
    if (b.width && (b.left < lo || b.right > hi)) out.push(`${el.tagName.toLowerCase()}.${el.className} ${Math.round(b.left)}..${Math.round(b.right)} past ${Math.round(lo)}..${Math.round(hi)}`);
  }
  if (document.documentElement.scrollWidth > innerWidth) out.push(`the page is ${document.documentElement.scrollWidth} px wide in a ${innerWidth} px window`);
  return out;
}, sel);

for (const plain of [false, true]) {
  const tag = plain ? 'plain' : 'voxels';
  const p = await open({ plain });
  say(await p.locator('.vx-pagination-pages[data-vx-live]').count() === (plain ? 0 : 6), `${tag}: ${plain ? 'no trench is drawn in voxels' : 'every trench is drawn in voxels'}`);
  say(await current(p) === '5' && await seats(p) === '1 … 4 5 6 … 20', `${tag}: it starts on page 5 of 20: ${await seats(p)}`);

  // a real press on a seat
  await press(p, '#pager ol a[href="#page-6"]');
  await p.waitForTimeout(700);
  say(await current(p) === '6' && await p.textContent('#count') === 'Page 6 of 20', `${tag}: a press on seat 6 makes page 6 current (${await p.textContent('#count')})`);
  say(await seats(p) === '1 … 5 6 7 … 20', `${tag}: and the seats are written round it: ${await seats(p)}`);
  if (!plain) { const k = await key(p); say(k.at === k.seat && k.at !== null, `${tag}: the key is drawn in the current seat (key at ${k.at}, seat at ${k.seat})`); }

  if (!plain) {
    const off = await p.evaluate(() => {
      const out = [], range = document.createRange();
      for (const a of document.querySelectorAll('.vx-pagination-pages a')) { if (!a.offsetParent) continue; range.selectNodeContents(a); const r = range.getBoundingClientRect(); if (Math.abs(r.left - Math.round(r.left)) > 0.02 || Math.abs(r.top + scrollY - Math.round(r.top + scrollY)) > 0.02) out.push(`${a.textContent} x ${r.left.toFixed(2)} y ${(r.top + scrollY).toFixed(2)}`); }
      return out;
    });
    say(off.length === 0, `${tag}: every number starts on a whole pixel${off.length ? ': ' + off.slice(0, 4).join(', ') : ''}`);
  }

  // the small keys
  await press(p, '#pager [rel="next"]');
  await p.waitForTimeout(500);
  say(await current(p) === '7', `${tag}: the next key goes on a page (${await current(p)})`);
  await press(p, '#pager [rel="prev"]');
  await press(p, '#pager [rel="prev"]');
  await p.waitForTimeout(500);
  say(await current(p) === '5', `${tag}: the previous key, twice, goes back two (${await current(p)})`);

  // keys: Tab walks the links in order, Enter follows one
  await p.evaluate(() => document.querySelector('#count').scrollIntoView());
  await p.locator('#pager [rel="prev"]').focus();
  const order = [];
  for (let i = 0; i < 6; i++) { await p.keyboard.press('Tab'); order.push(await p.evaluate(() => document.activeElement.getAttribute('aria-label'))); }
  say(order.join(' | ') === 'Page 1 | Page 4 | Page 5 | Page 6 | Page 20 | Next page', `${tag}: Tab walks the links in order and skips the gaps (${order.join(' | ')})`);
  await p.keyboard.press('Shift+Tab'); // Page 20
  const ring = await p.evaluate(() => { const cs = getComputedStyle(document.activeElement); return document.activeElement.matches(':focus-visible') && cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2; });
  say(ring, `${tag}: a seat in focus shows a ring`);
  await p.locator('#pager').screenshot({ path: `shots/parts/pagination/hand-${tag}-focus.png` });
  await p.keyboard.press('Enter');
  await p.waitForTimeout(700);
  say(await current(p) === '20' && await seats(p) === '1 … 16 17 18 19 20', `${tag}: Enter on seat 20 goes to the last page: ${await seats(p)}`);
  say(await p.evaluate(() => document.activeElement.getAttribute('aria-current')) === 'page', `${tag}: and focus is on the current page`);
  await p.locator('#pager').screenshot({ path: `shots/parts/pagination/hand-${tag}-last.png` });
  const next = await p.evaluate(() => { const a = document.querySelector('#pager [rel="next"]'); return [a.getAttribute('aria-disabled'), a.hasAttribute('href')]; });
  await p.keyboard.press('Tab');
  const left = await p.evaluate(() => !document.querySelector('#pager').contains(document.activeElement));
  say(next[0] === 'true' && next[1] === false && left, `${tag}: at the last page the next key is switched off, and Tab passes it by`);
  await press(p, '#pager [rel="next"]');
  await p.waitForTimeout(300);
  say(await current(p) === '20', `${tag}: pressing it does nothing`);
  if (!plain) { const k = await key(p); say(k.at === k.seat, `${tag}: the key is in the last seat (key at ${k.at}, seat at ${k.seat})`); }
  if (!plain) say(await p.evaluate(() => { const ol = document.querySelector('#pager ol'); return ol.firstElementChild === window.vx.live(ol).canvas; }), `${tag}: the app wrote the list again, and the trench still has its canvas`);

  // set from code: the mark follows the markup
  await p.evaluate(() => { const all = document.querySelectorAll('#few ol a'); all[0].removeAttribute('aria-current'); all[2].setAttribute('aria-current', 'page'); });
  if (!plain) {
    const moving = await key(p, '#few');
    await p.waitForTimeout(700);
    const k = await key(p, '#few');
    say(moving.target === k.seat && moving.at !== moving.target, `${tag}: aria-current set from code: the key sets off for the new seat (at ${moving.at?.toFixed(2)}, going to ${moving.target})`);
    say(k.at === k.seat, `${tag}: and arrives (key at ${k.at}, seat at ${k.seat})`);
    const none = await key(p, '#nocurrent');
    say(none.at === null && none.well !== null, `${tag}: a trench with no current page has no key in it`);
  } else {
    const painted = await p.evaluate(() => [...document.querySelectorAll('#few ol a')].map((a) => getComputedStyle(a).boxShadow !== 'none'));
    say(painted.join() === 'false,false,true', `${tag}: aria-current set from code: the painted key is on the new seat`);
  }

  // what cannot be pressed, and what can
  const gaps = await p.evaluate(() => [...document.querySelectorAll('.vx-pagination-gap')].every((li) => !li.querySelector('a, button, [tabindex]')));
  say(gaps, `${tag}: a gap holds no link`);
  const small = await p.evaluate(() => [...document.querySelectorAll('.vx-pagination a')].filter((a) => a.offsetParent).map((a) => a.getBoundingClientRect()).filter((r) => r.width < 44 || r.height < 44).length);
  say(small === 0, `${tag}: every seat and key is at least 44 px each way (${small} smaller)`);
  say(p.errors.length === 0, `${tag}: no errors` + (p.errors.length ? ': ' + [...new Set(p.errors)].join(' | ') : ''));
  await p.context().close();
}

// a phone
for (const plain of [false, true]) {
  const tag = plain ? 'phone, plain' : 'phone, voxels';
  const p = await open({ width: 390, plain });
  say(await seats(p) === '1 … 5 … 20', `${tag}: five seats: ${await seats(p)}`);
  const rows = await p.evaluate(() => [...document.querySelectorAll('.vx-pagination')].map((n) => n.offsetHeight));
  say(rows.every((h) => h === 44), `${tag}: every pagination is one row (${rows.join(', ')} px high)`);
  say(await seats(p, '#many') === '1 … 1280 … 4096', `${tag}: seats marked for wide screens are left out: ${await seats(p, '#many')}`);
  const out = await outside(p, '.vx-pagination');
  say(out.length === 0, `${tag}: nothing reaches past the sheet${out.length ? ': ' + out.slice(0, 4).join('; ') : ''}`);
  await p.locator('#pager').scrollIntoViewIfNeeded();
  await press(p, '#pager ol a[href="#page-20"]');
  await p.waitForTimeout(600);
  say(await current(p) === '20' && await seats(p) === '1 … 18 19 20', `${tag}: a press on 20: ${await seats(p)}`);
  if (!plain) { const k = await key(p); say(k.at === k.seat, `${tag}: the key is in its seat (key at ${k.at}, seat at ${k.seat})`); }
  say(p.errors.length === 0, `${tag}: no errors` + (p.errors.length ? ': ' + [...new Set(p.errors)].join(' | ') : ''));
  await p.context().close();
}

// reduced motion: nothing travels
{
  const p = await open({ reduced: true });
  await p.evaluate(() => { const all = document.querySelectorAll('#few ol a'); all[0].removeAttribute('aria-current'); all[2].setAttribute('aria-current', 'page'); });
  await p.waitForTimeout(60);
  const k = await key(p, '#few');
  say(k.at === k.seat, `reduced motion: the key is in the new seat at once (key at ${k.at}, seat at ${k.seat})`);
  await p.context().close();
}

await browser.close();
console.log(bad ? `${bad} to fix` : 'ok: pagination');
process.exit(bad ? 1 : 0);
