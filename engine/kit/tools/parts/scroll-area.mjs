// The scroll area, under a real wheel, real keys, a real mouse on its bar, and a finger: is it a
// scrolling element first, and is the bar only an extra?
//   PORT=5989 node tools/parts/scroll-area.mjs
import { chromium } from 'playwright';

const port = process.env.PORT || 5989;
const url = `http://127.0.0.1:${port}/showcase/parts/scroll-area.html?theme=light`;
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
let bad = 0;
const say = (ok, what) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); };
const errors = [];
const open = async (opts = {}, plain = false) => {
  const p = await (await browser.newContext({ viewport: { width: 1000, height: 900 }, deviceScaleFactor: 1, ...opts })).newPage();
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  if (plain) await p.addInitScript(() => { new MutationObserver((_, o) => { if (document.documentElement) { document.documentElement.setAttribute('data-vx-plain', ''); o.disconnect(); } }).observe(document, { childList: true }); });
  await p.goto(url);
  if (opts.javaScriptEnabled !== false) { await p.waitForFunction(() => document.documentElement.dataset.ready === '1'); await p.evaluate(() => document.fonts.ready); }
  await p.waitForTimeout(500);
  return p;
};
const read = (p, id = 'log') => p.evaluate((id) => {
  const root = document.getElementById(id), view = root.querySelector('.vx-scroll-view'), bar = root.querySelector('.vx-scroll-bar');
  const l = window.vx?.live?.(bar), b = bar.getBoundingClientRect(), v = view.getBoundingClientRect();
  const at = parseFloat(bar.style.getPropertyValue('--_at')) || 0, len = parseFloat(bar.style.getPropertyValue('--_len')) || 0;
  return {
    top: view.scrollTop, far: view.scrollHeight - view.clientHeight, at, len,
    key: l?.model.byName.key ? l.model.byName.key.ty * l.vx : null, tz: l?.model.byName.key?.tz ?? null, glow: l?.glowStrength ?? null,
    bar: { x: b.x, y: b.y, w: b.width, h: b.height }, view: { x: v.x, y: v.y, w: v.width, h: v.height },
    shown: getComputedStyle(bar).visibility === 'visible', held: bar.hasAttribute('data-vx-held'), idle: bar.hasAttribute('data-vx-idle'),
    native: getComputedStyle(view).scrollbarWidth, pageY: scrollY, live: bar.hasAttribute('data-vx-live'),
  };
}, id);
const near = (a, b, by = 2) => Math.abs(a - b) <= by;

async function bar(p, how) {
  let s = await read(p);
  const focus = await p.evaluate(() => document.activeElement.getAttribute('aria-label') || document.activeElement.tagName);
  say(s.shown && s.native === 'none' && s.live === (how === 'voxels'), `${how}: the kit's bar is shown and the browser's own steps aside`);
  say(s.len >= 44 && s.bar.w === 16, `${how}: the key is ${s.len} px long in a trench ${s.bar.w} px wide`);
  // the wheel, over the words
  await p.mouse.move(s.view.x + s.view.w / 2, s.view.y + s.view.h / 2);
  await p.mouse.wheel(0, 120);
  await p.waitForTimeout(300);
  let t = await read(p);
  say(near(t.top, 120) && t.at > s.at && near(t.at, 4 + (t.top / t.far) * (t.bar.h - 8 - t.len), 1) && (how !== 'voxels' || near(t.key, t.at, 0.01)), `${how}: the wheel scrolls the words by 120 px, and the key follows (${s.at.toFixed(1)} to ${t.at.toFixed(1)} px down the trench)`);
  say(t.pageY === 0, `${how}: the page itself stayed where it was`);
  // a real mouse takes the key and drags it down 40 px
  const kx = t.bar.x + t.bar.w / 2, ky = t.bar.y + t.at + t.len / 2;
  await p.mouse.move(kx, ky, { steps: 5 });
  await p.mouse.down();
  await p.waitForTimeout(160);
  const held = await read(p);
  await p.mouse.move(kx, ky + 40, { steps: 8 });
  await p.waitForTimeout(200);
  const dragged = await read(p);
  await p.mouse.up();
  await p.waitForTimeout(300);
  const let_go = await read(p);
  const want = t.top + 40 / (t.bar.h - 8 - t.len) * t.far;
  say(held.held && near(dragged.top, want, 3) && near(dragged.at, t.at + 40, 1.5), `${how}: dragging the key 40 px down scrolls ${Math.round(dragged.top - t.top)} px (${Math.round(want - t.top)} is its share), and the key stays under the mouse`);
  if (how === 'voxels') say(held.tz < -0.5 && held.glow > t.glow * 1.5 && near(let_go.tz, 0, 0.05) && near(let_go.glow, t.glow, 0.0001), `voxels: held, the key is down (${held.tz.toFixed(2)}) and its light brighter; let go, it comes back`);
  say(!let_go.held && near(let_go.top, dragged.top, 1), `${how}: letting go leaves the words where they were dragged to`);
  // dragged off the bar sideways, it still follows (the pointer is captured)
  await p.mouse.move(kx, t.bar.y + let_go.at + let_go.len / 2, { steps: 3 });
  await p.mouse.down();
  await p.mouse.move(kx - 200, t.bar.y + let_go.at + let_go.len / 2 - 30, { steps: 8 });
  await p.waitForTimeout(150);
  const off = await read(p);
  await p.mouse.up();
  say(off.top < let_go.top - 20, `${how}: with the mouse 200 px off the bar the key still follows it up`);
  // the trench below the key, then above it
  await p.evaluate(() => { document.querySelector('#log .vx-scroll-view').scrollTop = 0; });
  await p.waitForTimeout(200);
  s = await read(p);
  await p.mouse.click(kx, s.bar.y + s.bar.h - 10);
  await p.waitForTimeout(250);
  t = await read(p);
  say(near(t.top, Math.min(t.far, s.view.h * 0.9), 2), `${how}: pressing the trench below the key goes a page down (${Math.round(t.top)} px)`);
  await p.evaluate(() => { const v = document.querySelector('#log .vx-scroll-view'); v.scrollTop = v.scrollHeight; });
  await p.waitForTimeout(200);
  s = await read(p);
  await p.mouse.click(kx, s.bar.y + 6);
  await p.waitForTimeout(250);
  t = await read(p);
  say(near(t.top, Math.max(0, s.top - s.view.h * 0.9), 2), `${how}: pressing the trench above it goes a page up`);
  say(await p.evaluate(() => (document.activeElement.getAttribute('aria-label') || document.activeElement.tagName)) === focus, `${how}: the bar took no focus (it is still on ${focus})`);
  await p.evaluate(() => { document.querySelector('#log .vx-scroll-view').scrollTop = 0; });
}

// ---- voxels
const p = await open();
say(await p.evaluate(() => { const v = document.querySelector('#log .vx-scroll-view'), b = document.querySelector('#log .vx-scroll-bar'); return v.getAttribute('role') === 'region' && v.getAttribute('aria-label') === 'Build log' && v.tabIndex === 0 && getComputedStyle(v).overflowY === 'auto' && b.getAttribute('aria-hidden') === 'true' && b.tabIndex === -1 && !v.hasAttribute('data-vx-live'); }), 'the view is a named region that scrolls and takes focus; the bar is hidden from a screen reader and takes none; the view is no part\'s own element');
// keys, once it has focus
await p.keyboard.press('Tab');
say(await p.evaluate(() => document.activeElement === document.querySelector('#log .vx-scroll-view') && getComputedStyle(document.querySelector('#log .vx-scroll-well')).outlineStyle === 'solid'), 'Tab puts focus on the view, and the recess shows the focus ring');
const keys = [];
const top = () => p.evaluate(() => document.querySelector('#log .vx-scroll-view').scrollTop);
for (const k of ['ArrowDown', 'PageDown', 'Space', 'End', 'ArrowUp', 'PageUp', 'Home']) { const was = await top(); await p.keyboard.press(k); await p.waitForTimeout(350); keys.push([k, was, await top()]); }
const far = (await read(p)).far;
const moved = (k) => { const [, a, b] = keys.find((x) => x[0] === k); return b - a; };
say(moved('ArrowDown') > 0 && moved('PageDown') > 100 && moved('Space') > 100 && near(keys.find((x) => x[0] === 'End')[2], far, 1) && moved('ArrowUp') < 0 && moved('PageUp') < -100 && keys.find((x) => x[0] === 'Home')[2] === 0, `the keys scroll it: ${keys.map(([k, a, b]) => `${k} ${b - a > 0 ? '+' : ''}${Math.round(b - a)}`).join(', ')}`);
await p.keyboard.press('End');
await p.waitForTimeout(350);
const end = await read(p);
say(near(end.at + end.len, end.bar.h - 4, 1), 'at the end the key is at the foot of the trench, a voxel clear of it');
await p.keyboard.press('Home');
await p.waitForTimeout(300);

// the bar, with a real mouse
await bar(p, 'voxels');

// nothing to scroll; then something; then nothing again
let s = await read(p, 'short');
say(s.idle && !s.shown && s.key === null, 'nothing to scroll: no bar, and no key is drawn');
await p.evaluate(() => { const v = document.querySelector('#short .vx-scroll-view'); for (let i = 0; i < 12; i++) v.insertAdjacentHTML('beforeend', `<div data-more><span class="at">10:44:${10 + i}</span>Retry ${i + 1}</div>`); });
await p.waitForTimeout(400);
s = await read(p, 'short');
say(!s.idle && s.shown && s.key !== null && s.len >= 44, `lines are added from code: the bar appears, its key ${s.len} px long`);
await p.evaluate(() => { for (const n of document.querySelectorAll('#short [data-more]')) n.remove(); });
await p.waitForTimeout(400);
s = await read(p, 'short');
say(s.idle && !s.shown, 'they are taken out again: the bar goes');
s = await read(p, 'long');
say(s.len === 44 && s.far > 3000, `two hundred lines (${Math.round(s.far)} px to go): the key is ${s.len} px, not a sliver`);
s = await read(p, 'rtl');
say(s.shown && s.bar.x < s.view.x, 'right to left: the bar is at the left of the recess, the far edge');
// another part inside it keeps its own size, and its canvas does not make the view scroll
s = await read(p, 'loading');
const inside = await p.evaluate(() => { const b = document.querySelector('#loading .vx-bone:not([data-vx-bone])'), v = document.querySelector('#loading .vx-scroll-view'); return { h: b.offsetHeight, live: b.hasAttribute('data-vx-live'), over: v.scrollHeight - v.clientHeight, side: v.scrollWidth - v.clientWidth }; });
say(inside.live && inside.h === 8 && s.idle && inside.over <= 0, `a skeleton inside it: its trenches keep their own height (${inside.h} px; the area is ${s.view.h} px), and the view has nothing to scroll (${inside.over} px over)`);
await p.context().close();

// ---- plain (the script runs, no voxels)
const q = await open({}, true);
await bar(q, 'plain');
await q.context().close();

// ---- a finger
const f = await open({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 800 } });
try {
  const v = await f.evaluate(() => { const r = document.querySelector('#log .vx-scroll-view').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  const cdp = await f.context().newCDPSession(f);
  await cdp.send('Input.synthesizeScrollGesture', { x: Math.round(v.x), y: Math.round(v.y), yDistance: -90, speed: 400, gestureSourceType: 'touch' });
  await f.waitForTimeout(500);
  const t = await read(f);
  say(t.top > 40 && t.at > 4, `a finger drawn 90 px up the words scrolls them (${Math.round(t.top)} px), and the key follows`);
  say(await f.evaluate(() => getComputedStyle(document.querySelector('#log .vx-scroll-bar')).pointerEvents === 'none' && getComputedStyle(document.querySelector('#log .vx-scroll-view')).touchAction === 'auto'), 'under a finger the bar is only a sign (it takes no touch), and the view keeps the browser\'s own touch scrolling');
} catch (e) { say(false, 'a finger: could not be driven here: ' + String(e).slice(0, 120)); }
await f.context().close();

// ---- no script at all
const n = await open({ javaScriptEnabled: false });
const before = await n.evaluate(() => { const v = document.querySelector('#log .vx-scroll-view'), b = document.querySelector('#log .vx-scroll-bar'); return { native: getComputedStyle(v).scrollbarWidth, bar: getComputedStyle(b).visibility, on: document.getElementById('log').hasAttribute('data-vx-on'), x: v.getBoundingClientRect().x + 80, y: v.getBoundingClientRect().y + 80 }; });
say(!before.on && before.native === 'auto' && before.bar === 'hidden', 'no script: the browser\'s own bar is left alone, and the kit\'s is not shown');
await n.mouse.move(before.x, before.y);
await n.mouse.wheel(0, 100);
await n.waitForTimeout(300);
const wheeled = await n.evaluate(() => document.querySelector('#log .vx-scroll-view').scrollTop);
await n.keyboard.press('Tab');
await n.keyboard.press('End');
await n.waitForTimeout(350);
const ended = await n.evaluate(() => { const v = document.querySelector('#log .vx-scroll-view'); return [document.activeElement === v, v.scrollTop, v.scrollHeight - v.clientHeight]; });
say(near(wheeled, 100) && ended[0] && near(ended[1], ended[2], 1), `no script: the wheel scrolls it (${Math.round(wheeled)} px), Tab reaches it and End goes to the end`);
await n.context().close();

say(errors.length === 0, 'no errors' + (errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''));
await browser.close();
process.exit(bad ? 1 : 0);
