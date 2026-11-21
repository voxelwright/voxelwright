// A person on the breadcrumb page: real keys walk the trail, a real mouse follows a link, and a
// long trail is measured on a phone. In voxels and plain (the last location stays passive in both).
//   PORT=5989 node tools/parts/breadcrumb.mjs
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const port = process.env.PORT || 5989;
await mkdir('shots/parts/breadcrumb', { recursive: true });
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
  await p.goto(`http://127.0.0.1:${port}/kit/showcase/parts/breadcrumb.html?theme=light`);
  await p.waitForFunction(() => document.documentElement.dataset.ready === '1');
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(600);
  const fitted = await p.locator('#trail [data-vx-live]').count();
  say(fitted === (plain ? 0 : 5), plain ? 'the breadcrumb uses CSS throughout' : 'the rail, locator and three keys use the shared renderer');
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

for (const plain of [false, true]) {
  const tag = plain ? 'plain' : 'voxels';
  const p = await open({ plain });
  const shape = await p.evaluate(() => [...document.querySelectorAll('.vx-breadcrumb')].map((n) => {
    const links = [...n.querySelectorAll('li > a, li > [aria-current]')], cur = [...n.querySelectorAll('[aria-current="page"]')];
    return n.tagName === 'NAV' && !!n.getAttribute('aria-label') && n.firstElementChild.tagName === 'OL' && cur.length === 1 && cur[0] === links[links.length - 1];
  }));
  say(shape.every(Boolean) && shape.length === 6, `${tag}: each of the ${shape.length} is a named nav holding an ordered list, with aria-current="page" on the last and only there`);
  const labels = await p.evaluate(() => [...document.querySelectorAll('.vx-breadcrumb')].map((n) => n.getAttribute('aria-label')));
  say(new Set(labels).size === labels.length, `${tag}: no two navs on the page have the same name`);

  // keys
  await p.evaluate(() => document.querySelector('#trail a').focus());
  const order = [await p.evaluate(() => document.activeElement.textContent)];
  for (let i = 0; i < 3; i++) { await p.keyboard.press('Tab'); order.push(await p.evaluate(() => document.activeElement.textContent)); }
  const leftTrail = await p.evaluate(() => !document.activeElement.closest('#trail'));
  const passive = await p.locator('#trail [aria-current]').evaluate(el => el.tagName === 'SPAN' && el.tabIndex < 0);
  say(order.slice(0, 3).join(' > ') === 'fogline > Projects > harbor-api' && leftTrail && passive,
    `${tag}: Tab visits three ancestor links and skips the passive current location`);
  await p.keyboard.press('Shift+Tab');
  await p.keyboard.press('Shift+Tab');
  const ring = await p.evaluate(() => { const a = document.activeElement, cs = getComputedStyle(a); return a.textContent + ': ' + (a.matches(':focus-visible') && cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2); });
  say(ring === 'Projects: true', `${tag}: the link in focus shows a ring (${ring})`);
  await p.locator('#trail').screenshot({ path: `shots/parts/breadcrumb/hand-${tag}-focus.png` });
  await p.keyboard.press('Enter');
  say(await p.evaluate(() => location.hash) === '#projects', `${tag}: Enter follows it (${await p.evaluate(() => location.hash)})`);

  // a real mouse
  const b = await p.locator('#trail li:has(> a[href="#harbor-api"])').boundingBox(), w = await p.locator('#trail a[href="#harbor-api"]').boundingBox();
  await p.mouse.move(w.x + w.width / 2, b.y + 4, { steps: 6 });
  const hover = await p.evaluate(() => getComputedStyle(document.querySelector('#trail a[href="#harbor-api"]')).textDecorationLine);
  say(hover === 'underline', `${tag}: under the pointer a link is underlined (${hover})`);
  await p.mouse.down(); await p.mouse.up();
  say(await p.evaluate(() => location.hash) === '#harbor-api', `${tag}: a press near the top of its 44 px follows it (${await p.evaluate(() => location.hash)})`);
  const targets = await p.evaluate(() => [...document.querySelectorAll('.vx-breadcrumb a[href]')].filter((a) => { a.scrollIntoView({ block: 'center' }); const r = a.getBoundingClientRect(), x = r.left + r.width / 2, y = (r.top + r.bottom) / 2; return document.elementFromPoint(x, y - 21) !== a || document.elementFromPoint(x, y + 21) !== a; }).length);
  say(targets === 0, `${tag}: every link's target is at least 44 px high (${targets} lower)`);

  // the chevrons are drawn, not written
  const chev = await p.evaluate(() => { const li = document.querySelectorAll('#trail li'), b = (n) => getComputedStyle(n, '::before'); return [b(li[0]).content, b(li[1]).content, b(li[1]).width, b(li[1]).height, document.querySelector('#trail').innerText.replace(/\s+/g, ' ').trim()]; });
  say(chev[0] === 'none' && chev[1] === '""' && chev[2] === '4px' && chev[3] === '7px', `${tag}: a chevron before every level but the first, 4 by 7 px, with no words in it`);
  say(chev[4] === 'fogline Projects harbor-api Domains', `${tag}: the trail's own words are only the levels (${chev[4]})`);
  await p.evaluate(() => document.querySelector('#trail').setAttribute('dir', 'rtl'));
  const rtl = await p.evaluate(() => { const li = document.querySelectorAll('#trail li'); return [getComputedStyle(li[1], '::before').transform, li[0].getBoundingClientRect().left > li[3].getBoundingClientRect().left]; });
  say(rtl[0] === 'matrix(-1, 0, 0, 1, 0, 0)' && rtl[1], `${tag}: right to left, the trail runs from the right and the chevrons point left`);
  noErrors(p, tag);
  await p.context().close();
}

for (const plain of [false, true]) {
  const tag = plain ? 'phone, plain' : 'phone, voxels';
  const p = await open({ width: 390, plain });
  await fits(p, '.vx-breadcrumb', tag);
  const m = await p.evaluate(() => { const rows = (id) => new Set([...document.querySelectorAll(`${id} li`)].map((li) => Math.round(li.getBoundingClientRect().top))).size; const name = document.querySelector('#tight [aria-current]'); return [rows('#long'), rows('#trail'), Math.round(name.offsetHeight / parseFloat(getComputedStyle(name).lineHeight))]; });
  say(m[0] >= 2, `${tag}: the long trail wraps onto ${m[0]} lines`);
  say(m[1] === 1, `${tag}: a short one stays on one`);
  say(m[2] >= 2, `${tag}: one long name breaks inside itself (${m[2]} lines)`);
  await p.locator('#long').screenshot({ path: `shots/parts/breadcrumb/hand-${tag.replace(', ', '-')}-long.png` });
  await p.setViewportSize({ width: 320, height: 800 });
  await fits(p, '#trail', tag + ' at 320 px');
  const rows = await p.locator('#trail li').evaluateAll(items => items.map(item => item.offsetTop));
  say(rows[0] === rows[1] && rows[1] < rows[2] && rows[2] === rows[3], `${tag}: four levels wrap into two ordered pairs`);
  noErrors(p, tag);
  await p.context().close();
}

await browser.close();
console.log(bad ? `${bad} to fix` : 'ok: breadcrumb');
process.exit(bad ? 1 : 0);
