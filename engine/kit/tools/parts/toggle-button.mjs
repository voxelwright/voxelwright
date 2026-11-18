// A person on the toggle button's page: a real mouse and real keys. Says ok or FAIL for each
// thing that must hold; exit 1 on a failure.
//   PORT=5989 node tools/parts/toggle-button.mjs
import { chromium } from 'playwright';

const port = process.env.PORT || 5989;
const url = `http://127.0.0.1:${port}/showcase/parts/toggle-button.html`;
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
let bad = 0;
const say = (ok, what) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); };
const errors = [];

async function open({ theme = 'light', plain = false, still = false, width = 1180 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1, reducedMotion: still ? 'reduce' : 'no-preference' });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  if (plain) await p.addInitScript(() => { new MutationObserver((_, o) => { if (document.documentElement) { document.documentElement.setAttribute('data-vx-plain', ''); o.disconnect(); } }).observe(document, { childList: true }); });
  await p.goto(`${url}?theme=${theme}`);
  await p.waitForFunction(() => document.documentElement.dataset.ready === '1');
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(800);
  return p;
}
const mid = async (p, sel) => { const b = await p.locator(sel).first().boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
const press = async (p, sel) => { const [x, y] = await mid(p, sel); await p.mouse.move(x, y, { steps: 6 }); await p.mouse.down(); await p.waitForTimeout(140); await p.mouse.up(); };
const pressed = (p, sel) => p.evaluate((s) => document.querySelector(s).getAttribute('aria-pressed'), sel);
// the voxels behind an element: how far its cap is down, and its light
const voxels = (p, sel) => p.evaluate((s) => { const l = window.vx.live(document.querySelector(s)); const cap = l.model.byName.cap; return { tz: cap ? +cap.tz.toFixed(2) : null, light: !!l.model.byName.light, travel: l.look.travel, glow: l.glowStrength, reach: l.glowRadius, parts: l.model.parts.map((q) => q.name).join() }; }, sel);
// the picture of one key with everything else on the page put out of sight
async function alone(p, sel, pad = 30) { // 30 px round it: its side, its shadow and its halo, and still clear of the sheet's edge
  await p.evaluate((s) => { for (const st of document.querySelectorAll('.state')) { st.style.visibility = st.contains(document.querySelector(s)) ? '' : 'hidden'; st.querySelector('span').style.visibility = 'hidden'; } }, sel);
  await p.mouse.move(4, 4);
  await p.waitForTimeout(500);
  const b = await p.locator(sel).boundingBox();
  const shot = await p.screenshot({ clip: { x: Math.round(b.x) - pad, y: Math.round(b.y) - pad, width: Math.round(b.width) + pad * 2, height: Math.round(b.height) + pad * 2 } });
  await p.evaluate(() => { for (const st of document.querySelectorAll('.state')) { st.style.visibility = ''; st.querySelector('span').style.visibility = ''; } });
  return shot.toString('base64');
}
// how many pixels of two pictures differ at all
const differ = (p, a, b) => p.evaluate(async ([a, b]) => {
  const data = async (s) => { const i = new Image(); i.src = 'data:image/png;base64,' + s; await i.decode(); const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const g = c.getContext('2d'); g.drawImage(i, 0, 0); return [g.getImageData(0, 0, c.width, c.height).data, c.width, c.height]; };
  const [x, w, h] = await data(a), [y, w2, h2] = await data(b);
  if (w !== w2 || h !== h2) return -1;
  let n = 0; for (let i = 0; i < x.length; i += 4) if (x[i] !== y[i] || x[i + 1] !== y[i + 1] || x[i + 2] !== y[i + 2]) n++;
  return n;
}, [a, b]);
const where = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); const w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode()) && !n.textContent.trim()); const r = document.createRange(); r.selectNodeContents(n); const q = r.getBoundingClientRect(), k = e.getBoundingClientRect(); return [+(q.left - k.left).toFixed(2), +(q.top - k.top).toFixed(2), k.width, k.height]; }, sel);

// at 390 px: is anything of the part outside the sheet's own column? (the page clips what overflows, so it would be cut, not scrolled)
// Boxes are the layout's own (offsets): a painted key that is down is drawn a voxel aside, and that is not this.
const cut = (q, sel) => q.evaluate((s) => { const at = (e) => { let x = 0; for (let n = e; n; n = n.offsetParent) x += n.offsetLeft; return x; }; const sheet = document.querySelector('.sheet'), c = getComputedStyle(sheet); const lo = at(sheet) + parseFloat(c.paddingLeft) - 0.5, hi = at(sheet) + sheet.offsetWidth - parseFloat(c.paddingRight) + 0.5; return [...document.querySelectorAll(s)].filter((e) => !e.matches('.vx-canvas') && e.offsetWidth && (at(e) < lo || at(e) + e.offsetWidth > hi)).map((e) => (e.getAttribute('aria-label') || e.textContent.trim()).slice(0, 24)); }, sel);

// ---- off and at rest, it is the kit's key
for (const theme of ['light', 'dark']) {
  const p = await open({ theme });
  const tone = theme === 'light' ? 'by day' : 'at night';
  const a = await where(p, '#s-off'), b = await where(p, '#s-key');
  say(a.join() === b.join(), `${tone}: off, its box and its legend lie as the kit's key's do (${a.join(' ')} and ${b.join(' ')})`);
  const n = await differ(p, await alone(p, '#s-off'), await alone(p, '#s-key'));
  say(n === 0, `${tone}: off and at rest, no pixel of it differs from the kit's key (${n} differ)`);
  const v = await voxels(p, '#s-off'), k = await voxels(p, '#s-key');
  say(v.tz === 0 && v.light && Math.abs(v.glow - k.glow) < 1e-9 && v.reach === k.reach, `${tone}: the same light at rest (halo ${v.glow.toFixed(4)} and ${k.glow.toFixed(4)}, reach ${v.reach} and ${k.reach})`);
  await p.context().close();
}
{
  const p = await open({ plain: true });
  const a = await where(p, '#s-off'), b = await where(p, '#s-key');
  say(a.join() === b.join(), `plain: off, its box and its legend lie as the kit's key's do (${a.join(' ')} and ${b.join(' ')})`);
  const n = await differ(p, await alone(p, '#s-off'), await alone(p, '#s-key'));
  say(n === 0, `plain: off and at rest, no pixel of it differs from the kit's key (${n} differ)`);
  await p.context().close();
}

// ---- a real mouse and real keys
const p = await open();
let on = await voxels(p, '#s-on'), off = await voxels(p, '#s-off');
say(on.tz === -on.travel, `on, the cap is down by the key's travel (${on.tz})`);
say(on.glow > off.glow * 1.5 && on.reach === off.reach, `on, its light is held brighter than a key's at rest, and reaches no further (${(on.glow / off.glow).toFixed(2)} times; reach ${on.reach})`);
say(await p.evaluate(() => window.vx.stage.awake.size) === 0, 'at rest nothing runs');

// the page hears it
await p.evaluate(() => { window.heard = []; document.addEventListener('vx-change', (e) => window.heard.push(e.target.id + ':' + e.detail.pressed)); });
let [x, y] = await mid(p, '#wrap');
await p.mouse.move(x, y, { steps: 6 });
await p.mouse.down();
await p.waitForTimeout(160);
let v = await voxels(p, '#wrap');
say(Math.abs(v.tz - (0.5 - v.travel)) < 0.15 && await pressed(p, '#wrap') === 'false', `held down by the mouse the cap goes down (${v.tz}), and it has not flipped yet`);
await p.mouse.up();
await p.waitForTimeout(500);
v = await voxels(p, '#wrap');
say(await pressed(p, '#wrap') === 'true', 'let go, it is on: aria-pressed="true"');
say(Math.abs(v.tz - (0.5 - v.travel)) < 0.05, `and it stays down (${v.tz}, with the pointer still over it)`);
say(await p.evaluate(() => document.getElementById('log').hasAttribute('data-wrap')), 'the page heard vx-change: the log wraps');
await p.mouse.move(4, 4, { steps: 4 });
await p.waitForTimeout(900);
v = await voxels(p, '#wrap');
say(v.tz === -v.travel && v.reach === off.reach, `the pointer gone, it rests down by the travel and its light has come back in (${v.tz}; reach ${v.reach})`);
await press(p, '#wrap');
await p.mouse.move(4, 4, { steps: 4 });
await p.waitForTimeout(700);
v = await voxels(p, '#wrap');
say(await pressed(p, '#wrap') === 'false' && v.tz === 0, `pressed again it is off and stands up (${v.tz})`);
say((await p.evaluate(() => window.heard.join(' '))) === 'wrap:true wrap:false', `vx-change said: ${await p.evaluate(() => window.heard.join(' '))}`);

// pressed, then the pointer taken off it before letting go: nothing happens
[x, y] = await mid(p, '#s-off');
await p.mouse.move(x, y, { steps: 6 });
await p.mouse.down();
await p.waitForTimeout(120);
await p.mouse.move(x, y + 120, { steps: 6 });
await p.mouse.up();
await p.waitForTimeout(600);
v = await voxels(p, '#s-off');
say(await pressed(p, '#s-off') === 'false' && v.tz === 0, `pressed and dragged off before letting go: it does not flip, and stands up again (${v.tz})`);

// the keyboard
await p.focus('#s-off');
await p.keyboard.press('Space');
await p.waitForTimeout(500);
v = await voxels(p, '#s-off');
say(await pressed(p, '#s-off') === 'true' && v.tz === -v.travel, `Space flips it on, and it goes down (${v.tz})`);
await p.keyboard.press('Enter');
await p.waitForTimeout(500);
v = await voxels(p, '#s-off');
say(await pressed(p, '#s-off') === 'false' && v.tz === 0, `Enter flips it off, and it comes up (${v.tz})`);
await p.keyboard.press('Tab');
say(await p.evaluate(() => document.activeElement.id) === 's-on', 'Tab goes to the next one: each is a tab stop');
const ring = await p.evaluate(() => { const c = getComputedStyle(document.activeElement); return document.activeElement.matches(':focus-visible') && c.outlineStyle === 'solid' && parseFloat(c.outlineWidth) >= 2; });
say(ring, 'focus from the keyboard shows a ring');

// from code
await p.evaluate(() => { window.heard = []; document.getElementById('s-off').setAttribute('aria-pressed', 'true'); });
await p.waitForTimeout(600);
v = await voxels(p, '#s-off');
say(v.tz === -v.travel && await p.evaluate(() => window.heard.length) === 0, `aria-pressed set from code: the key goes down (${v.tz}), and no vx-change is sent`);
await p.evaluate(() => document.getElementById('s-off').setAttribute('aria-pressed', 'false'));
await p.waitForTimeout(600);

// off
const dis = 'button.vx-toggle-button[disabled][aria-pressed="false"]', disOn = 'button.vx-toggle-button[disabled][aria-pressed="true"]';
await press(p, dis);
say(await pressed(p, dis) === 'false', 'one that cannot be changed does not flip under the mouse');
v = await voxels(p, dis);
const d = await voxels(p, disOn);
say(!v.light && !d.light && d.parts.includes('walls'), `off, it has no light; off while on, it is a dent (${d.parts})`);
await p.evaluate((s) => { document.querySelector(s).disabled = false; }, disOn);
await p.waitForTimeout(600);
v = await voxels(p, 'button.vx-toggle-button[aria-pressed="true"]:not([id]):not([data-vx-light]):not([lang])');
say(v.light && v.tz === -v.travel, `switched back on from code it is a lit key again, down (${v.tz})`);

// legends on whole pixels
const offPixel = await p.evaluate(() => [...document.querySelectorAll('.vx-toggle-button')].filter((e) => { const w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode()) && !n.textContent.trim()); const r = document.createRange(); r.selectNodeContents(n); const q = r.getBoundingClientRect(); return Math.abs(q.left - Math.round(q.left)) > 0.02 || Math.abs(q.top + scrollY - Math.round(q.top + scrollY)) > 0.02; }).length);
say(offPixel === 0, `every legend starts on a whole pixel (${offPixel} do not)`);
say(await p.evaluate(() => window.vx.stage.awake.size) === 0, 'and at rest again nothing runs');
await p.context().close();

// ---- reduced motion: nothing travels
{
  const q = await open({ still: true });
  const [mx, my] = await mid(q, '#wrap');
  await q.mouse.move(mx, my);
  await q.mouse.down();
  await q.waitForTimeout(60);
  const a = await voxels(q, '#wrap');
  await q.mouse.up();
  await q.mouse.move(4, 4);
  await q.waitForTimeout(80);
  const b = await voxels(q, '#wrap');
  say(a.tz === 0.5 - a.travel && b.tz === -b.travel && b.reach === off.reach, `reduced motion: down at once and no flare (${a.tz} under the pointer, then ${b.tz}; reach ${b.reach})`);
  await q.context().close();
}

// ---- plain: the same behaviour with no voxels
{
  const q = await open({ plain: true });
  say(await q.locator('[data-vx-live]').count() === 0, 'plain: nothing is drawn in voxels');
  await press(q, '#wrap');
  say(await pressed(q, '#wrap') === 'true' && await q.evaluate(() => document.getElementById('log').hasAttribute('data-wrap')), 'plain: a press flips it, and the page hears');
  const t = await q.evaluate(() => getComputedStyle(document.getElementById('wrap')).transform);
  say(t !== 'none', `plain: on, it is painted down (${t})`);
  const edge = await q.locator('#wrap').boundingBox();
  await q.mouse.move(edge.x + edge.width - 2, edge.y + edge.height - 2, { steps: 4 });
  await q.mouse.down(); await q.waitForTimeout(80); await q.mouse.up();
  say(await pressed(q, '#wrap') === 'false', 'plain: a press 2 px inside its lower right corner flips it too, though the painted key lies a voxel up and left');
  await q.focus('#times');
  await q.keyboard.press('Space');
  say(await pressed(q, '#times') === 'false', 'plain: Space flips it');
  await q.context().close();
}

// ---- on a phone
for (const plain of [false, true]) {
  const q = await open({ width: 390, plain });
  const out = await cut(q, '.vx-toggle-button');
  const long = await q.evaluate(() => { const b = document.querySelector('[lang="uk"]'), r = document.createRange(); const w = document.createTreeWalker(b, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode()) && !n.textContent.trim()); r.selectNodeContents(n); return [b.offsetWidth, Math.round(r.getBoundingClientRect().width)]; });
  say(out.length === 0 && long[1] + 40 === long[0], `at 390 px${plain ? ', plain' : ''}: no key is cut, and the long name fits its key with five voxels each side (${long[1]} px of words in ${long[0]} px; ${out.length} outside the column)`);
  await q.context().close();
}

say(errors.length === 0, 'no errors' + (errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''));
await browser.close();
process.exit(bad ? 1 : 0);
