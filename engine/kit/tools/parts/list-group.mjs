// A person on the list group page: a real mouse and real keys choose rows, the page's script says
// which is current, and the mark must follow that and nothing else. In voxels and plain, then on a phone.
//   PORT=5989 node tools/parts/list-group.mjs
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const port = process.env.PORT || 5989;
await mkdir('shots/parts/list-group', { recursive: true });
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
  await p.goto(`http://127.0.0.1:${port}/kit/showcase/parts/list-group.html?theme=light`);
  await p.waitForFunction(() => document.documentElement.dataset.ready === '1');
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(600);
  return p;
}
const press = async (p, sel) => { await p.locator(sel).first().scrollIntoViewIfNeeded(); const b = await p.locator(sel).first().boundingBox(); await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 }); await p.mouse.down(); await p.waitForTimeout(80); await p.mouse.up(); };
const noErrors = (p, tag) => say(p.errors.length === 0, `${tag}: no errors` + (p.errors.length ? ': ' + [...new Set(p.errors)].join(' | ') : ''));
// everything of the part that reaches past the sheet's inner edge, or holds words wider than itself
const outside = (p, sel) => p.evaluate((sel) => {
  const sheet = document.querySelector('.sheet'), cs = getComputedStyle(sheet), r = sheet.getBoundingClientRect();
  const lo = r.left + parseFloat(cs.paddingLeft) - 0.5, hi = r.right - parseFloat(cs.paddingRight) + 0.5, out = [];
  for (const part of document.querySelectorAll(sel)) for (const el of [part, ...part.querySelectorAll('*')]) {
    if (el.matches('.vx-canvas, [class$="-aloud"]') || !el.getClientRects().length) continue;
    const b = el.getBoundingClientRect(), s = getComputedStyle(el);
    if (b.width && (b.left < lo || b.right > hi)) out.push(`${el.tagName.toLowerCase()}.${el.className} ${Math.round(b.left)}..${Math.round(b.right)} past ${Math.round(lo)}..${Math.round(hi)}`);
    // (a part's canvas reaches past its box on purpose, for shadow and light: that is not this)
    else if (s.overflowX === 'visible' && el.clientWidth && !el.querySelector('.vx-canvas') && el.scrollWidth > el.clientWidth + 1) out.push(`${el.tagName.toLowerCase()}.${el.className} holds ${el.scrollWidth} px in ${el.clientWidth}`);
  }
  if (document.documentElement.scrollWidth > innerWidth) out.push(`the page is ${document.documentElement.scrollWidth} px wide in a ${innerWidth} px window`);
  return out;
}, sel);
const fits = async (p, sel, tag) => { const out = await outside(p, sel); say(out.length === 0, `${tag}: nothing reaches past the sheet${out.length ? ': ' + out.slice(0, 4).join('; ') : ''}`); };

const currentOf = (p, list) => p.evaluate((list) => [...document.querySelectorAll(`${list} > li`)].filter((li) => li.matches('[aria-current]:not([aria-current="false"])') || li.querySelector(':scope > [aria-current]:not([aria-current="false"])')).map((li) => li.querySelector('a, button')?.textContent ?? li.textContent).join(','), list);
// where the mark is drawn (voxels) or painted (plain): the row it is on, by its top edge
const markOf = (p, list, plain) => p.evaluate(([list, plain]) => {
  const ul = document.querySelector(list), rows = [...ul.children].filter((n) => n.tagName === 'LI');
  if (plain) return rows.map((li, i) => (getComputedStyle(li, '::before').content !== 'none' ? i : -1)).filter((i) => i >= 0).join(',');
  const l = window.vx.live(ul);
  if (!l.well) return '';
  const y = l.well[1] * l.vx, yy = l.well[3] * l.vx;
  return rows.map((li, i) => (y >= li.offsetTop && yy <= li.offsetTop + li.offsetHeight ? i : -1)).filter((i) => i >= 0).join(',') + (l.well[0] === 1 ? '' : ` (x ${l.well[0]})`);
}, [list, plain]);

for (const plain of [false, true]) {
  const tag = plain ? 'plain' : 'voxels';
  const p = await open({ plain });
  say(await p.locator('.vx-list-group[data-vx-live]').count() === (plain ? 0 : 6), `${tag}: ${plain ? 'no list is drawn in voxels' : 'every list has its canvas'}`);
  say(await currentOf(p, '#sections') === 'Domains' && await markOf(p, '#sections', plain) === '1', `${tag}: it starts with Domains current, and the mark on the second row (row ${await markOf(p, '#sections', plain)})`);

  // a real press on a row
  await press(p, '#sections a[href="#secrets"]');
  await p.waitForTimeout(300);
  say(await currentOf(p, '#sections') === 'Secrets' && await p.textContent('#pane-name') === 'Secrets', `${tag}: a press on Secrets makes it the current row, and the only one (${await currentOf(p, '#sections')})`);
  say(await markOf(p, '#sections', plain) === '2', `${tag}: and the mark is on its row (row ${await markOf(p, '#sections', plain)})`);
  await p.locator('#sections').screenshot({ path: `shots/parts/list-group/hand-${tag}-secrets.png` });
  // the whole row is the target, not only the word
  const row = await p.locator('#sections li').nth(4).boundingBox();
  await p.mouse.move(row.x + row.width - 6, row.y + row.height / 2, { steps: 6 }); await p.mouse.down(); await p.mouse.up();
  await p.waitForTimeout(300);
  say(await currentOf(p, '#sections') === 'Billing', `${tag}: a press at the far end of a row counts (${await currentOf(p, '#sections')})`);

  // keys: Tab walks the rows, Enter follows a link
  await p.locator('#sections a').first().focus();
  await p.keyboard.press('Tab');
  await p.keyboard.press('Tab');
  const ring = await p.evaluate(() => { const li = document.activeElement.closest('li'), cs = getComputedStyle(li); return document.activeElement.textContent + ': ' + (document.activeElement.matches(':focus-visible') && cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2); });
  say(ring === 'Secrets: true', `${tag}: Tab, Tab from General lands on Secrets, and its row shows a ring (${ring})`);
  await p.locator('#sections').screenshot({ path: `shots/parts/list-group/hand-${tag}-focus.png` });
  await p.keyboard.press('Enter');
  await p.waitForTimeout(300);
  say(await currentOf(p, '#sections') === 'Secrets' && await markOf(p, '#sections', plain) === '2', `${tag}: Enter makes it current (${await currentOf(p, '#sections')}, mark on row ${await markOf(p, '#sections', plain)})`);

  // buttons: Space presses, a switched-off row is passed by
  await p.locator('#buttons button').first().focus();
  await p.keyboard.press('Tab');
  await p.keyboard.press('Space');
  await p.waitForTimeout(300);
  say(await currentOf(p, '#buttons') === 'Preview' && await markOf(p, '#buttons', plain) === '1', `${tag}: Space on a button row makes it current (${await currentOf(p, '#buttons')}, mark on row ${await markOf(p, '#buttons', plain)})`);
  await p.keyboard.press('Tab');
  say(await p.evaluate(() => !document.querySelector('#buttons').contains(document.activeElement)), `${tag}: Tab passes the switched-off row by`);
  await press(p, '#buttons button:disabled');
  say(await currentOf(p, '#buttons') === 'Preview', `${tag}: and a press on it does nothing`);

  // set from code: the mark is drawn from aria-current and nothing else
  say(await markOf(p, '#none', plain) === '', `${tag}: a list with no current row has no mark`);
  await p.evaluate(() => document.querySelectorAll('#none > li')[2].setAttribute('aria-current', 'true'));
  await p.waitForTimeout(200);
  say(await markOf(p, '#none', plain) === '2', `${tag}: aria-current set on a row from code: the mark is there (row ${await markOf(p, '#none', plain)})`);
  await p.evaluate(() => document.querySelectorAll('#none > li')[2].setAttribute('aria-current', 'false'));
  await p.waitForTimeout(200);
  say(await markOf(p, '#none', plain) === '', `${tag}: aria-current="false": no mark`);
  // an app that writes the rows again
  await p.evaluate(() => { const ul = document.querySelector('#none'); ul.replaceChildren(...['One', 'Two', 'Three', 'Four'].map((w, i) => { const li = document.createElement('li'); li.textContent = w; if (i === 3) li.setAttribute('aria-current', 'true'); return li; })); });
  await p.waitForTimeout(300);
  say(await markOf(p, '#none', plain) === '3' && (plain || await p.evaluate(() => { const ul = document.querySelector('#none'); return ul.firstElementChild === window.vx.live(ul).canvas; })), `${tag}: the rows written again by an app: the mark is on the new current row${plain ? '' : ', and the canvas is still there'} (row ${await markOf(p, '#none', plain)})`);
  // right to left: the mark is at the start of the line, which is the right
  await p.evaluate(() => document.querySelector('#sections').setAttribute('dir', 'rtl'));
  await p.waitForTimeout(300);
  const rtl = await p.evaluate((plain) => { const ul = document.querySelector('#sections'); if (plain) { const li = ul.querySelector('li:has([aria-current])'), b = getComputedStyle(li, '::before'); return parseFloat(b.right); } const l = window.vx.live(ul); return (l.W - 1 - l.well[0]) * l.vx; }, plain);
  say(rtl === 4, `${tag}: right to left, the mark is one voxel in from the right (${rtl} px)`);

  const small = await p.evaluate(() => [...document.querySelectorAll('.vx-list-group > li')].filter((li) => li.querySelector('a, button') && li.getBoundingClientRect().height < 44).length);
  say(small === 0, `${tag}: every row you can press is at least 44 px high (${small} lower)`);
  noErrors(p, tag);
  await p.context().close();
}

for (const plain of [false, true]) {
  const tag = plain ? 'phone, plain' : 'phone, voxels';
  const p = await open({ width: 390, plain });
  await fits(p, '.vx-list-group', tag);
  const tall = await p.evaluate(() => { const li = document.querySelectorAll('#items > li'); return [li[1].offsetHeight, li[2].offsetHeight]; });
  say(tall[0] > 60 && tall[1] > 60, `${tag}: a long line and a long title wrap inside their rows (${tall.join(', ')} px high)`);
  say(await markOf(p, '#items', plain) === '1', `${tag}: the mark is on the tall current row (row ${await markOf(p, '#items', plain)})`);
  noErrors(p, tag);
  await p.context().close();
}

await browser.close();
console.log(bad ? `${bad} to fix` : 'ok: list-group');
process.exit(bad ? 1 : 0);
