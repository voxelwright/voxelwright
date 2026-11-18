// A person on the item page: rows that are links and buttons are pressed with a real mouse and
// real keys; long words are measured on a phone. In voxels and plain.
//   PORT=5989 node tools/parts/item.mjs
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const port = process.env.PORT || 5989;
await mkdir('shots/parts/item', { recursive: true });
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
  await p.goto(`http://127.0.0.1:${port}/kit/showcase/parts/item.html?theme=light`);
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

for (const plain of [false, true]) {
  const tag = plain ? 'plain' : 'voxels';
  const p = await open({ plain });

  // a row that is a link
  await p.locator('#let-in').focus();
  await p.keyboard.press('Tab');
  const ring = await p.evaluate(() => { const a = document.activeElement, cs = getComputedStyle(a); return a.id + ': ' + (a.matches(':focus-visible') && cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2); });
  say(ring === 'link: true', `${tag}: Tab from the key in the first rows lands on the link row, and it shows a ring (${ring})`);
  await p.locator('#link').screenshot({ path: `shots/parts/item/hand-${tag}-focus.png` });
  await p.keyboard.press('Enter');
  say(await p.evaluate(() => location.hash) === '#fog-site', `${tag}: Enter follows the link`);
  await p.evaluate(() => { history.replaceState(null, '', location.pathname + location.search); });
  const far = await p.locator('#link').boundingBox();
  await p.mouse.move(far.x + far.width - 8, far.y + far.height / 2, { steps: 6 });
  const under = await p.evaluate(() => getComputedStyle(document.querySelector('#link .vx-item-title')).textDecorationLine);
  say(under === 'underline', `${tag}: under the pointer the title is underlined (${under})`);
  await p.mouse.down(); await p.mouse.up();
  say(await p.evaluate(() => location.hash) === '#fog-site', `${tag}: a press at the far end of the row follows it too`);

  // a row that is a button
  await p.locator('#link').focus();
  await p.keyboard.press('Tab');
  say(await p.evaluate(() => document.activeElement.id) === 'press', `${tag}: Tab goes on to the button row`);
  await p.keyboard.press('Space');
  say(await p.textContent('#pressed') === 'Open', `${tag}: Space presses it (${await p.textContent('#pressed')})`);
  await p.keyboard.press('Enter');
  say(await p.textContent('#pressed') === 'Closed', `${tag}: Enter presses it (${await p.textContent('#pressed')})`);
  await press(p, '#press');
  say(await p.textContent('#pressed') === 'Open', `${tag}: a real press does (${await p.textContent('#pressed')})`);
  await p.locator('#press').focus();
  await p.keyboard.press('Tab');
  say(await p.evaluate(() => !document.activeElement.matches('button.vx-item')), `${tag}: Tab passes the switched-off row by`);
  const same = await p.evaluate(() => { const a = document.querySelector('#press'), b = document.querySelector('#link'); return [a.offsetWidth === b.offsetWidth, a.querySelector('.vx-item-title').getBoundingClientRect().left === b.querySelector('.vx-item-title').getBoundingClientRect().left]; });
  say(same[0] && same[1], `${tag}: a button row is laid out as a link row is (same width ${same[0]}, same start ${same[1]})`);

  // a key trailing a row is its own thing
  await press(p, '#let-in');
  await p.waitForTimeout(300);
  say(await p.evaluate(() => document.querySelector('#people .vx-item:last-child .vx-item-line').textContent) === 'Can deploy' && await p.evaluate(() => document.querySelector('#let-in').disabled), `${tag}: the key trailing a row is pressed by itself`);

  const small = await p.evaluate(() => [...document.querySelectorAll('a.vx-item, button.vx-item')].filter((e) => e.getBoundingClientRect().height < 44).length);
  say(small === 0, `${tag}: every row you can press is at least 44 px high (${small} lower)`);
  noErrors(p, tag);
  await p.context().close();
}

for (const plain of [false, true]) {
  const tag = plain ? 'phone, plain' : 'phone, voxels';
  const p = await open({ width: 390, plain });
  await fits(p, '.vx-item', tag);
  const m = await p.evaluate(() => {
    const [wrapped, cut] = document.querySelectorAll('#long .vx-item');
    const t = (el) => el.querySelector('.vx-item-title'), lh = (el) => parseFloat(getComputedStyle(el).lineHeight);
    return { lines: Math.round(t(wrapped).offsetHeight / lh(t(wrapped))), cutLines: Math.round(t(cut).offsetHeight / lh(t(cut))), cutShort: t(cut).scrollWidth > t(cut).clientWidth, trail: [...document.querySelectorAll('#long .vx-item-trail')].every((e) => e.offsetWidth > 40) };
  });
  say(m.lines >= 2, `${tag}: a long title wraps (${m.lines} lines)`);
  say(m.cutLines === 1 && m.cutShort, `${tag}: with data-vx-clip it stays on one line, cut short`);
  say(m.trail, `${tag}: what trails keeps its room`);
  noErrors(p, tag);
  await p.context().close();
}

await browser.close();
console.log(bad ? `${bad} to fix` : 'ok: item');
process.exit(bad ? 1 : 0);
