// The avatar page, looked at by a script: nothing in an avatar is pressed, so this checks what it
// does by itself (a picture that cannot be had gives way to initials, and the person is still named
// once) and that a real Tab passes it by. In voxels and plain, then a phone.
//   PORT=5989 node tools/parts/avatar.mjs
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const port = process.env.PORT || 5989;
await mkdir('shots/parts/avatar', { recursive: true });
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
  await p.goto(`http://127.0.0.1:${port}/showcase/parts/avatar.html?theme=light`);
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

const GOOD = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 2 2'%3E%3Crect width='2' height='2' fill='%23456'/%3E%3C/svg%3E";
const state = (p, sel) => p.evaluate((sel) => {
  const el = document.querySelector(sel), img = el.querySelector('img'), ini = el.querySelector('.vx-avatar-initials');
  return { empty: el.getAttribute('data-vx-empty'), role: el.getAttribute('role'), label: el.getAttribute('aria-label'), img: img ? getComputedStyle(img).display !== 'none' : null, alt: img?.alt ?? null, initials: ini ? getComputedStyle(ini).visibility === 'visible' : null, hidden: ini?.getAttribute('aria-hidden') ?? null };
}, sel);

for (const plain of [false, true]) {
  const tag = plain ? 'plain' : 'voxels';
  const p = await open({ plain });
  const all = await p.locator('.vx-avatar').count();
  say(await p.locator('.vx-avatar[data-vx-live]').count() === (plain ? 0 : all), `${tag}: ${plain ? 'no well is drawn in voxels' : `each of the ${all} wells is drawn in voxels`}`);

  const pic = await state(p, '#pic');
  say(pic.img && pic.alt === 'Ines Duarte' && pic.role === null && pic.label === null && pic.empty === null, `${tag}: a picture is named by its alt, and the well round it says nothing more`);
  const letters = await state(p, '#letters');
  say(letters.role === 'img' && letters.label === 'Ada Lindqvist' && letters.hidden === 'true' && letters.initials, `${tag}: initials are read as the person's name, and the letters themselves are not read`);
  const lost = await state(p, '#lost');
  say(lost.empty === 'named' && lost.img === false && lost.initials, `${tag}: a picture that cannot be had is taken away and the initials show`);
  say(lost.role === 'img' && lost.label === 'Tomas Reyes', `${tag}: and the well takes the picture's name (${lost.role}, ${lost.label})`);
  // every avatar says a name exactly once, or sits beside one and says none
  const names = await p.evaluate(() => [...document.querySelectorAll('.vx-avatar')].map((el) => {
    const img = el.querySelector(':scope > img'), svg = el.querySelector(':scope > svg');
    const shown = img && getComputedStyle(img).display !== 'none';
    return (el.getAttribute('aria-label') ? 1 : 0) + (shown && img.alt ? 1 : 0) + (svg?.getAttribute('aria-label') ? 1 : 0);
  }));
  say(names.filter((n) => n > 1).length === 0, `${tag}: no avatar says a name twice (${names.filter((n) => n === 1).length} say one, ${names.filter((n) => n === 0).length} say none)`);
  const noAlt = await p.evaluate(() => [...document.querySelectorAll('.vx-avatar img')].filter((i) => !i.hasAttribute('alt')).length);
  say(noAlt === 0, `${tag}: every picture has an alt (${noAlt} without)`);

  // the picture comes after all: it is shown, and the name goes back to it
  await p.evaluate((src) => { document.querySelector('#lost img').src = src; }, GOOD);
  await p.waitForTimeout(300);
  const back = await state(p, '#lost');
  say(back.empty === null && back.img && back.role === null && back.label === null && !back.initials, `${tag}: given a picture that loads, it is shown, the initials go, and the name is the picture's again`);
  await p.evaluate(() => { document.querySelector('#lost img').src = 'data:image/png;base64,AAAA'; });
  await p.waitForTimeout(300);
  const again = await state(p, '#lost');
  say(again.empty === 'named' && again.label === 'Tomas Reyes' && again.initials, `${tag}: and losing it again brings the initials back`);

  // the box: what is in the well lies on its floor, clear of the wall at the right and the bottom
  const box = await p.evaluate(() => [...document.querySelectorAll('.vx-avatar')].map((el) => { const a = el.getBoundingClientRect(), c = el.querySelector(':scope > img, :scope > svg, :scope > .vx-avatar-initials'); if (!c || getComputedStyle(c).display === 'none') return 'ok'; const b = c.getBoundingClientRect(); return b.left === a.left && b.top === a.top && a.right - b.right === 4 && a.bottom - b.bottom === 4 && a.width % 4 === 0 && a.width === a.height ? 'ok' : `${a.width}x${a.height} holds ${b.width}x${b.height}`; }).filter((s) => s !== 'ok'));
  say(box.length === 0, `${tag}: every well is square, a whole number of voxels, and what it holds stops a voxel short of the right and the bottom${box.length ? ': ' + box.join(', ') : ''}`);
  const sizes = await p.evaluate(() => ['small', null, 'large'].map((s) => document.querySelector(s ? `.vx-avatar[data-vx-size="${s}"]` : '.vx-avatar:not([data-vx-size])').offsetWidth));
  say(sizes.join() === '32,40,56', `${tag}: three sizes: ${sizes.join(', ')} px`);

  // keys: an avatar is not a control
  await p.evaluate(() => document.body.focus());
  const stops = [];
  for (let i = 0; i < 4; i++) { await p.keyboard.press('Tab'); stops.push(await p.evaluate(() => (document.activeElement.closest('.vx-avatar, .vx-avatar-stack') ? 'avatar' : document.activeElement.tagName))); }
  say(!stops.includes('avatar'), `${tag}: Tab never stops on an avatar (${stops.join(', ')})`);
  const group = await p.evaluate(() => { const s = document.querySelector('#stack'); return [s.getAttribute('role'), s.getAttribute('aria-label'), s.querySelector('.vx-avatar-more').textContent]; });
  say(group[0] === 'group' && group[1] === 'Reviewers' && group[2] === '+3 more', `${tag}: a stack is a named group, and its count is read as "${group[2]}"`);
  await p.locator('.sheet section').nth(1).screenshot({ path: `shots/parts/avatar/hand-${tag}-states.png` });
  noErrors(p, tag);
  await p.context().close();
}

for (const plain of [false, true]) {
  const tag = plain ? 'phone, plain' : 'phone, voxels';
  const p = await open({ width: 390, plain });
  await fits(p, '.vx-avatar, .vx-avatar-stack', tag);
  const rows = await p.evaluate(() => new Set([...document.querySelectorAll('#long-stack > *')].map((e) => Math.round(e.getBoundingClientRect().top + e.getBoundingClientRect().height / 2))).size);
  say(rows === 1, `${tag}: a stack of five and a count is one row (${rows})`);
  noErrors(p, tag);
  await p.context().close();
}

await browser.close();
console.log(bad ? `${bad} to fix` : 'ok: avatar');
process.exit(bad ? 1 : 0);
