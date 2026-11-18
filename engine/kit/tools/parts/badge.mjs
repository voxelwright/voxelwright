// The badge page, looked at by a script: a badge is read, not pressed, so this checks its lamp is
// drawn, that a real Tab passes it by, what a count says aloud, and that a long one wraps on a phone.
//   PORT=5989 node tools/parts/badge.mjs
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const port = process.env.PORT || 5989;
await mkdir('shots/parts/badge', { recursive: true });
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
  await p.goto(`http://127.0.0.1:${port}/showcase/parts/badge.html?theme=light`);
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
  const lamps = await p.locator('.vx-badge > .vx-lamp').count();
  say(await p.locator('.vx-badge > .vx-lamp[data-vx-live]').count() === (plain ? 0 : lamps), `${tag}: ${plain ? 'no lamp is drawn in voxels' : `each of the ${lamps} lamps is drawn in voxels`}`);
  const box = await p.evaluate(() => [...document.querySelectorAll('.vx-badge')].filter((b) => { const cs = getComputedStyle(b); return cs.backgroundColor !== 'rgba(0, 0, 0, 0)' || cs.boxShadow !== 'none' || parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.paddingLeft) > 0; }).length);
  say(box === 0, `${tag}: no badge has a box: no ground, no border, no shadow, no padding (${box} do)`);
  const words = await p.evaluate(() => [...document.querySelectorAll('.vx-badge')].filter((b) => !b.textContent.trim()).length);
  say(words === 0, `${tag}: every badge says its state in words, lamp or no lamp (${words} do not)`);
  const count = await p.evaluate(() => { const b = document.querySelector('.inbox .vx-badge'), a = b.querySelector('.vx-badge-aloud').getBoundingClientRect(); return [b.textContent, b.innerText.trim(), a.width, a.height]; });
  say(count[0] === '3 open' && count[2] <= 1 && count[3] <= 1, `${tag}: a count is read as "${count[0]}" and shows as "3"`);
  await p.evaluate(() => document.body.focus());
  await p.keyboard.press('Tab');
  say(await p.evaluate(() => !document.activeElement.closest('.vx-badge')), `${tag}: Tab does not stop on a badge`);
  // the lamp follows its attribute (it is the kit's own part; this is that the badge leaves it alone)
  await p.evaluate(() => { document.querySelector('.services .vx-lamp').dataset.vxLight = 'stop'; });
  await p.waitForTimeout(300);
  const lit = await p.evaluate((plain) => { const l = document.querySelector('.services .vx-lamp'); return plain ? getComputedStyle(l).backgroundColor : String(window.vx.live(l).model.parts[0].count > 0); }, plain);
  say(plain ? lit === await p.evaluate(() => getComputedStyle(document.querySelectorAll('.services .vx-lamp')[2]).backgroundColor) : lit === 'true', `${tag}: a lamp set to another light from code is drawn in it`);
  const mid = await p.evaluate(() => [...document.querySelectorAll('.services .vx-badge, .row .vx-badge')].filter((b) => b.querySelector('.vx-lamp')).map((b) => { const l = b.querySelector('.vx-lamp').getBoundingClientRect(), r = document.createRange(); r.selectNodeContents(b.lastChild); const t = r.getBoundingClientRect(); return Math.abs((l.top + l.bottom) / 2 - (t.top + t.bottom) / 2); }));
  say(Math.max(...mid) <= 1.5, `${tag}: each lamp sits on the middle of its word (at most ${Math.max(...mid).toFixed(2)} px off)`);
  noErrors(p, tag);
  await p.context().close();
}

for (const plain of [false, true]) {
  const tag = plain ? 'phone, plain' : 'phone, voxels';
  const p = await open({ width: 390, plain });
  await fits(p, '.vx-badge', tag);
  const long = await p.evaluate(() => { const b = [...document.querySelectorAll('.vx-badge')].pop(), l = b.querySelector('.vx-lamp').getBoundingClientRect(), r = b.getBoundingClientRect(); return [Math.round(r.height / 20), l.top - r.top]; });
  say(long[0] >= 2 && long[1] <= 8, `${tag}: a long Ukrainian badge wraps onto ${long[0]} lines, and its lamp stays on the first (${long[1]} px down)`);
  noErrors(p, tag);
  await p.context().close();
}

await browser.close();
console.log(bad ? `${bad} to fix` : 'ok: badge');
process.exit(bad ? 1 : 0);
