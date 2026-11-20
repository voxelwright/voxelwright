// The skeleton, under a real wheel, mouse and keys: does its light run only while it is loading
// and can be seen, and does a screen reader hear what a sighted person sees?
//   PORT=5989 node tools/parts/skeleton.mjs
import { chromium } from 'playwright';

const port = process.env.PORT || 5989;
const url = `http://127.0.0.1:${port}/kit/showcase/parts/skeleton.html?theme=light`;
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
let bad = 0;
const say = (ok, what) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); };
const errors = [];
const open = async (opts = {}, plain = false) => {
  const p = await (await browser.newContext({ viewport: { width: 1000, height: 420 }, deviceScaleFactor: 1, ...opts })).newPage();
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  if (plain) await p.addInitScript(() => { new MutationObserver((_, o) => { if (document.documentElement) { document.documentElement.setAttribute('data-vx-plain', ''); o.disconnect(); } }).observe(document, { childList: true }); });
  await p.goto(url);
  await p.waitForFunction(() => document.documentElement.dataset.ready === '1');
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(500);
  return p;
};
// every bone: is it loading, can it be seen (as the stage sees it), is it kept awake, is it lit
const bones = (p) => p.evaluate(() => [...document.querySelectorAll('.vx-bone')].map((el) => {
  const l = window.vx.live(el), r = el.getBoundingClientRect();
  return {
    busy: el.closest('[aria-busy]')?.getAttribute('aria-busy') !== 'false',
    seen: r.bottom > -200 && r.top < innerHeight + 200,
    far: r.bottom < -260 || r.top > innerHeight + 260,
    awake: !!l && window.vx.stage.awake.has(l),
    lit: !!l && [...l.model.byName.light.scales].some((s) => s > 0),
  };
}));

// ---- voxels
const p = await open();
let all = await bones(p);
say(all.some((b) => b.busy && b.seen) && all.filter((b) => b.busy && b.seen).every((b) => b.awake), `in sight and loading: every such trench is kept awake (${all.filter((b) => b.busy && b.seen && b.awake).length} of ${all.filter((b) => b.busy && b.seen).length})`);
say(await p.evaluate(() => window.vx.stage.raf !== 0), 'and frames are being asked for');
const sample = () => p.evaluate(() => [...window.vx.live(document.querySelector('#list .vx-bone:not([data-vx-bone])')).model.byName.light.scales].map((s) => s.toFixed(2)).join(''));
const seen = new Set();
for (let i = 0; i < 12; i++) { seen.add(await sample()); await p.waitForTimeout(170); }
say(seen.size > 2, `the light passes along a trench (${seen.size} different pictures of it in two seconds)`);
say(await p.evaluate(() => { const w = document.getElementById('word'), r = document.getElementById('list'); return w.getAttribute('role') === 'status' && w.textContent.trim() === 'Loading the deploys' && !r.contains(w) && r.getAttribute('aria-busy') === 'true' && w.getBoundingClientRect().width <= 1; }), 'a screen reader is told: the region is aria-busy, and the words "Loading the deploys" are a status outside it, not shown');
say(all.filter((b) => !b.busy).length > 0 && all.filter((b) => !b.busy).every((b) => !b.awake && !b.lit), 'a skeleton whose region says aria-busy="false" is dark and asleep');

// out of sight: a real wheel takes the page down
await p.mouse.move(500, 200);
const firstBone = await p.locator('#list .vx-bone').first().boundingBox();
await p.mouse.wheel(0, firstBone.y + firstBone.height + 320);
await p.waitForTimeout(700);
all = await bones(p);
say(all.some((b) => b.busy && b.far) && all.filter((b) => b.busy && b.far).every((b) => !b.awake), `scrolled away with the wheel: the trenches out of sight are asleep (${all.filter((b) => b.busy && b.far && !b.awake).length} of ${all.filter((b) => b.busy && b.far).length})`);
await p.mouse.wheel(0, 3000);
await p.waitForTimeout(700);
const bottom = await bones(p);
say(bottom.filter((b) => b.busy && b.far).every((b) => !b.awake), 'at the foot of the page the same holds');
await p.mouse.wheel(0, -4000);
await p.waitForTimeout(700);
all = await bones(p);
say(all.filter((b) => b.busy && b.seen).every((b) => b.awake) && await p.evaluate(() => window.vx.stage.raf !== 0), 'scrolled back: they run again');

// the page is hidden (another tab): nothing asks for a frame
await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
await p.waitForTimeout(400);
say(await p.evaluate(() => window.vx.stage.raf === 0), 'while the page is hidden no frame is asked for');
await p.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
await p.waitForTimeout(300);
say(await p.evaluate(() => window.vx.stage.raf !== 0), 'shown again, it goes on');

// a trench taken out of the page stops
const gone = await p.evaluate(() => { const el = document.querySelector('.states .vx-bone'); const l = window.vx.live(el); window.gone = l; el.remove(); return !!l; });
await p.waitForTimeout(500);
say(gone && await p.evaluate(() => !window.vx.stage.awake.has(window.gone)), 'a trench removed from the page is no longer kept awake');

// aria-busy set from code
await p.evaluate(() => document.getElementById('still').setAttribute('aria-busy', 'true'));
await p.evaluate(() => document.getElementById('still').scrollIntoView({ block: 'center' }));
await p.waitForTimeout(600);
say(await p.evaluate(() => [...document.querySelectorAll('#still .vx-bone')].every((el) => window.vx.stage.awake.has(window.vx.live(el)))), 'aria-busy="true" set from code starts the light');
await p.evaluate(() => document.getElementById('still').setAttribute('aria-busy', 'false'));
await p.waitForTimeout(500);
say(await p.evaluate(() => [...document.querySelectorAll('#still .vx-bone')].every((el) => { const l = window.vx.live(el); return !window.vx.stage.awake.has(l) && [...l.model.byName.light.scales].every((s) => s === 0); })), 'aria-busy="false" set from code stops it, and the trench is dark');

// what was coming arrives: a real press on the key
await p.evaluate(() => scrollTo(0, 0));
await p.waitForTimeout(300);
await p.locator('#flip').scrollIntoViewIfNeeded();
const b = await p.locator('#flip').boundingBox();
await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 });
await p.mouse.down(); await p.waitForTimeout(80); await p.mouse.up();
await p.waitForTimeout(400);
say(await p.evaluate(() => document.getElementById('list').getAttribute('aria-busy') === 'false' && document.getElementById('word').textContent === 'Deploys loaded' && !document.querySelector('#list .vx-bone') && document.querySelector('#list .name')?.textContent === 'Cloned main at 4f2c9a1'), 'pressing "Finish loading": the words are there, the region is no longer busy, the status says "Deploys loaded"');
await p.keyboard.press('Tab');
await p.keyboard.press('Shift+Tab');
say(await p.evaluate(() => document.activeElement?.id === 'flip'), 'Tab reaches the key');
await p.keyboard.press('Enter');
await p.waitForTimeout(600);
say(await p.evaluate(() => document.getElementById('list').getAttribute('aria-busy') === 'true' && document.getElementById('word').textContent === 'Loading the deploys' && [...document.querySelectorAll('#list .vx-bone')].every((el) => window.vx.stage.awake.has(window.vx.live(el)))), 'Enter on it loads again: the trenches are back and their light runs');
await p.context().close();

// ---- prefers-reduced-motion
const q = await open({ reducedMotion: 'reduce' });
say(await q.evaluate(() => [...document.querySelectorAll('.vx-bone')].every((el) => { const l = window.vx.live(el); return l && !window.vx.stage.awake.has(l) && [...l.model.byName.light.scales].every((s) => s === 0); }) && window.vx.stage.raf === 0), 'prefers-reduced-motion: the trenches are drawn, no light passes, and no frame is asked for');
await q.context().close();

// ---- plain (no voxels)
const r = await open({}, true);
say(await r.evaluate(() => { const a = document.querySelector('#list .vx-bone'), s = document.querySelector('#still .vx-bone'); return !a.hasAttribute('data-vx-live') && getComputedStyle(a).animationName === 'vx-bone' && getComputedStyle(s).animationName === 'none'; }), 'plain: the painted light runs while loading, and not when aria-busy="false"');
await r.context().close();
const s = await open({ reducedMotion: 'reduce' }, true);
say(await s.evaluate(() => [...document.querySelectorAll('.vx-bone')].every((el) => getComputedStyle(el).animationName === 'none')), 'plain, prefers-reduced-motion: nothing is animated');
await s.context().close();

say(errors.length === 0, 'no errors' + (errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''));
await browser.close();
process.exit(bad ? 1 : 0);
