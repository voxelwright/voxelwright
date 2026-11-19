// The spinner, under a real wheel, mouse and keys: does it run only while it can be seen, and
// does a screen reader hear what a sighted person sees?
//   PORT=5989 node tools/parts/spinner.mjs
import { chromium } from 'playwright';

const port = process.env.PORT || 5989;
const url = `http://127.0.0.1:${port}/kit/showcase/parts/spinner.html?theme=light`;
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
let bad = 0;
const say = (ok, what) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); };
const errors = [];
const open = async (opts = {}, plain = false) => {
  const p = await (await browser.newContext({ viewport: { width: 1000, height: 300 }, deviceScaleFactor: 1, ...opts })).newPage();
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  if (plain) await p.addInitScript(() => { new MutationObserver((_, o) => { if (document.documentElement) { document.documentElement.setAttribute('data-vx-plain', ''); o.disconnect(); } }).observe(document, { childList: true }); });
  await p.goto(url);
  await p.waitForFunction(() => document.documentElement.dataset.ready === '1');
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(500);
  return p;
};
// every spinner: can it be seen (as the stage sees it), is it kept awake
const rings = (p) => p.evaluate(() => [...document.querySelectorAll('#spin, .vx-spinner')].map((el) => {
  const l = window.vx.live(el), r = el.getBoundingClientRect();
  return {
    shown: r.width > 0,
    seen: r.width > 0 && r.bottom > -200 && r.top < innerHeight + 200,
    far: r.width > 0 && (r.bottom < -260 || r.top > innerHeight + 260),
    awake: !!l && window.vx.stage.awake.has(l),
  };
}));

// ---- voxels
const p = await open();
let all = await rings(p);
say(all.some((r) => r.seen) && all.filter((r) => r.seen).every((r) => r.awake), `in sight: every spinner is kept awake (${all.filter((r) => r.seen && r.awake).length} of ${all.filter((r) => r.seen).length})`);
const signal = (page) => page.locator('#spin').evaluate(el => {
  const live = window.vx.live(el);
  const lenses = live.model.byName.lenses;
  // First voxel of each two-by-two lens.
  return Array.from({ length: 5 }, (_, i) => lenses.col[i * 16 + 3]);
});
const seats = new Set();
for (let i = 0; i < 26; i++) {
  const lamps = await signal(p);
  seats.add(lamps.indexOf(Math.max(...lamps)));
  await p.waitForTimeout(80);
}
say(seats.size === 5, `the light traverses all five fixed lenses (${seats.size})`);
say(await p.evaluate(() => { const line = document.getElementById('line'), log = document.getElementById('log'); return line.getAttribute('role') === 'status' && line.textContent.trim() === 'Building harbor-api' && document.getElementById('spin').getAttribute('aria-hidden') === 'true' && log.getAttribute('aria-busy') === 'true' && !log.contains(line); }), 'a screen reader is told: a status says "Building harbor-api", the log is aria-busy, and the status is outside it');
say(await p.evaluate(() => { const s = document.querySelector('.states .vx-spinner[role="status"]'), w = s.querySelector('.vx-spinner-word'); return w.textContent === 'Loading the deploys' && w.getBoundingClientRect().width <= 1; }), 'alone, it is itself the status, and its words are in the page but not shown');
say(all.filter((r) => !r.shown).length === 1 && all.filter((r) => !r.shown).every((r) => !r.awake), 'a spinner with the hidden attribute is asleep');

// out of sight: a real wheel takes the page down, and back
await p.mouse.move(500, 150);
await p.mouse.wheel(0, 3000);
await p.waitForTimeout(700);
all = await rings(p);
say(all.some((r) => r.far) && all.filter((r) => r.far).every((r) => !r.awake), `scrolled away with the wheel: the spinners out of sight are asleep (${all.filter((r) => r.far && !r.awake).length} of ${all.filter((r) => r.far).length})`);
const sibling = p.locator('.states .vx-spinner').first();
await sibling.scrollIntoViewIfNeeded();
const ringPhase = () => sibling.evaluate(el => [...window.vx.live(el).model.byName.cubes.scales]);
const firstPhase = await ringPhase();
await p.waitForTimeout(140);
say(firstPhase.length === 8 && firstPhase.join() !== (await ringPhase()).join(), 'the standalone ring still cycles its eight studs');
await p.mouse.wheel(0, -3000);
await p.waitForTimeout(700);
all = await rings(p);
say(all.filter((r) => r.seen).every((r) => r.awake) && await p.evaluate(() => window.vx.stage.raf !== 0), 'scrolled back: they run again');

// the page is hidden (another tab): nothing asks for a frame
await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
await p.waitForTimeout(400);
say(await p.evaluate(() => window.vx.stage.raf === 0), 'while the page is hidden no frame is asked for');
await p.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
await p.waitForTimeout(300);
say(await p.evaluate(() => window.vx.stage.raf !== 0), 'shown again, it goes on');

// the work ends: a real press on the key
await p.locator('#flip').scrollIntoViewIfNeeded(); // a mouse cannot press what is out of the window
const b = await p.locator('#flip').boundingBox();
await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 });
await p.mouse.down(); await p.waitForTimeout(80); await p.mouse.up();
await p.waitForTimeout(500);
say((await signal(p)).every(light => light === 0) && await p.evaluate(() => document.getElementById('spin').offsetWidth > 0 && !window.vx.stage.awake.has(window.vx.live(document.getElementById('spin'))) && document.getElementById('line').textContent.trim() === 'Built harbor-api in 45 s' && document.getElementById('log').getAttribute('aria-busy') === 'false'), 'pressing "Finish the build": the fitting is visible, dark and asleep, the status says "Built harbor-api in 45 s", the log is no longer busy');
await p.keyboard.press('Tab');
await p.keyboard.press('Shift+Tab');
say(await p.evaluate(() => document.activeElement?.id === 'flip'), 'Tab reaches the key');
await p.keyboard.press('Enter');
await p.waitForTimeout(600);
say(await p.evaluate(() => !document.getElementById('spin').hidden && window.vx.stage.awake.has(window.vx.live(document.getElementById('spin'))) && document.getElementById('log').getAttribute('aria-busy') === 'true'), 'Enter on it builds again: the spinner is back and runs');

// a spinner taken out of the page stops
const gone = await p.evaluate(() => { const el = document.querySelector('.states .vx-spinner'); window.gone = window.vx.live(el); el.remove(); return !!window.gone; });
await p.waitForTimeout(500);
say(gone && await p.evaluate(() => !window.vx.stage.awake.has(window.gone)), 'a spinner removed from the page is no longer kept awake');
await p.context().close();

// ---- prefers-reduced-motion
const q = await open({ reducedMotion: 'reduce' });
const held = await signal(q);
await q.waitForTimeout(250);
say(Math.max(...held) > 0 && held.join() === (await signal(q)).join(), 'reduced motion holds a lit lens steady');
say(await q.evaluate(() => [...document.querySelectorAll('.vx-spinner')].every((el) => { const l = window.vx.live(el); return l && !window.vx.stage.awake.has(l) && (el.hidden || new Set([...l.model.byName.cubes.scales].map((s) => s.toFixed(2))).size === 1); }) && window.vx.stage.raf === 0), 'prefers-reduced-motion: a still ring of equal cubes, and no frame is asked for');
await q.context().close();

// ---- plain (no voxels)
const r = await open({}, true);
say(await r.evaluate(() => { const a = document.getElementById('spin'); return !a.hasAttribute('data-vx-live') && getComputedStyle(a, '::before').animationName === 'build-sweep'; }), 'plain: the light sweeps across the fitting');
await r.locator('#flip').click();
say(await r.locator('#spin').evaluate(el => el.offsetWidth > 0 && getComputedStyle(el, '::before').animationName === 'none' && getComputedStyle(el, '::before').backgroundImage === 'none'), 'plain: completion darkens the same fitting');
await r.context().close();
const s = await open({ reducedMotion: 'reduce' }, true);
say(await s.locator('#spin').evaluate(el => getComputedStyle(el, '::before').animationName === 'none'), 'plain reduced-motion activity is steady');
say(await s.evaluate(() => [...document.querySelectorAll('.vx-spinner')].every((el) => getComputedStyle(el, '::after').animationName === 'none')), 'plain, prefers-reduced-motion: nothing is animated');
await s.context().close();

say(errors.length === 0, 'no errors' + (errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''));
await browser.close();
process.exit(bad ? 1 : 0);
