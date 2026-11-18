// The drawer under a real mouse, a real finger and real keys: the sheet, from the end on a wide
// screen and from the bottom on a phone, where its handle drags it shut. Let go short of a third
// of the way it springs back; past it, or thrown, it closes. It never rests in between.
//   PORT=5989 node tools/parts/drawer.mjs
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const port = process.env.PORT || 5989;
const url = `http://127.0.0.1:${port}/kit/showcase/parts/drawer.html`;
await mkdir('shots/parts/drawer', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
const errors = [];
let bad = 0;
const say = (ok, what) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); };
const PHONE = { viewport: { width: 390, height: 780 }, deviceScaleFactor: 2 };
async function open(opts = {}, query = '?theme=light', plain = false) {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 700 }, deviceScaleFactor: 1, ...opts });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  if (plain) await p.addInitScript(() => { new MutationObserver((_, o) => { if (document.documentElement) { document.documentElement.setAttribute('data-vx-plain', ''); o.disconnect(); } }).observe(document, { childList: true }); });
  await p.goto(url + query);
  await p.waitForFunction(() => document.documentElement.dataset.ready === '1');
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(700);
  return p;
}
const mid = async (p, sel) => { const b = await p.locator(sel).first().boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
const press = async (p, sel) => { await p.locator(sel).first().scrollIntoViewIfNeeded(); const [x, y] = await mid(p, sel); await p.mouse.move(x, y, { steps: 5 }); await p.mouse.down(); await p.waitForTimeout(60); await p.mouse.up(); };
const read = (p, sel) => p.evaluate(async (sel) => {
  const el = document.querySelector(sel), cs = getComputedStyle(el), r = el.getBoundingClientRect();
  const l = window.vx?.live?.(el);
  let made = null;
  if (l) {
    const { MATERIALS } = await import('/kit/src/index.js');
    const name = (i) => Object.keys(MATERIALS).find((k) => MATERIALS[k].id === i);
    const of = (q) => (q ? [...new Set(q.mats)].map(name).sort().join('+') : 'none');
    const { pull, 'pull-held': held } = l.model.byName;
    made = { panel: of(l.model.byName.panel), cubes: l.model.byName.panel?.count ?? 0, pull: pull ? (pull.hidden ? of(held) : of(pull)) : 'none', proud: pull ? pull.rest?.[2] ?? null : null, top: l.faceZ, slab: l.look.slab, edge: l.state.edge, drawn: !l.dirty, seen: l.visible };
  }
  const a = document.activeElement, h = el.querySelector('.vx-drawer-handle');
  return {
    open: el.open, modal: el.matches(':modal'), shown: cs.display !== 'none', value: el.returnValue, moved: /^(none|0px( 0px)?)$/.test(cs.translate) ? '0' : cs.translate,
    drag: el.style.getPropertyValue('--_drag'), held: el.hasAttribute('data-vx-dragging'), handle: !!h?.offsetWidth,
    left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: r.width, h: r.height, vw: document.documentElement.clientWidth, vh: innerHeight,
    inside: el.contains(a), focus: a === document.body || a === document.documentElement ? a.tagName : a.id || a.getAttribute('aria-label') || a.textContent.trim().slice(0, 24) || a.tagName, made,
  };
}, sel);
const settle = (p) => p.waitForTimeout(450);
// a hand on the handle: down, a drag of `by` px in `steps` (each `ms` apart), and, unless told to hold, up
async function pull(p, sel, by, { steps = 10, ms = 16, hold = false, axis = 'y' } = {}) {
  const [x, y] = await mid(p, `${sel} .vx-drawer-handle`);
  await p.mouse.move(x, y, { steps: 3 }); await p.mouse.down();
  for (let i = 1; i <= steps; i++) { await p.mouse.move(axis === 'y' ? x : x + (by * i) / steps, axis === 'y' ? y + (by * i) / steps : y); await p.waitForTimeout(ms); }
  if (!hold) await p.mouse.up();
}

// ---------------------------------------------------------------------------------------------
// a wide screen: it comes from the end, and has no handle
let p = await open();
await press(p, '#open-deploy'); await p.waitForTimeout(70);
let s = await read(p, '#deploy');
say(s.open && s.modal && s.moved !== '0', `wide: a press on its key opens it as a modal dialog, on its way in (${s.moved})`);
await settle(p);
s = await read(p, '#deploy');
say(s.made.edge === 'right' && Math.abs(s.right - s.vw) < 0.5 && s.top === 0 && Math.abs(s.bottom - s.vh) < 0.5, `wide: it rests against the end of the window, top to bottom (${s.left} to ${s.right})`);
say(!s.handle && s.made.pull === 'none', 'wide: no handle and no pull: at the side it is not needed');
say(s.made.panel === 'chalk' && s.made.top === s.made.slab, `wide: it is the sheet's slab of chalk, ${s.made.top} voxels thick`);
say(s.inside && s.focus === 'Close deploy 213', `wide: the focus is inside it, on its close key (${s.focus})`);
await p.keyboard.press('Escape'); await settle(p);
s = await read(p, '#deploy');
say(!s.shown && s.value === 'cancel' && s.focus === 'open-deploy', `wide: Escape closes it and the focus is back on its key (${s.focus})`);

// fixed to the bottom on a wide screen: the mouse drags it by its handle
await press(p, '#open-bottom'); await settle(p);
s = await read(p, '#d-bottom');
say(s.made.edge === 'bottom' && s.handle && s.made.pull === 'steel' && Math.abs(s.bottom - s.vh) < 0.5, `data-vx-side="bottom": it comes up from the bottom, with a pull of steel on its handle (${Math.round(s.top)} to ${Math.round(s.bottom)})`);
say(s.focus === 'Done', `the handle is not in the Tab order: the focus lands on its key (${s.focus})`);
const H = s.h;
await pull(p, '#d-bottom', H * 0.2, { hold: true });
s = await read(p, '#d-bottom');
say(s.open && s.held && s.moved !== '0' && Number(s.drag) > 0.1 && s.made.pull === 'light', `held and dragged a fifth of the way, it follows the hand (${s.moved}), the scrim thins (${s.drag}), the pull is lit`);
await p.mouse.up(); await p.waitForTimeout(40);
const half = await read(p, '#d-bottom');
await settle(p);
s = await read(p, '#d-bottom');
say(s.open && !s.held && s.moved === '0' && Math.abs(s.bottom - s.vh) < 0.5 && s.made.pull === 'steel', `let go short of a third: it springs back (${half.moved} a moment after, then ${s.moved})`);
say(s.inside, 'and the focus is still inside it');
await pull(p, '#d-bottom', H * 0.5);
await p.waitForTimeout(40);
const going = await read(p, '#d-bottom');
await settle(p);
s = await read(p, '#d-bottom');
say(!going.open && !s.shown && s.value === 'cancel' && s.focus === 'open-bottom', `let go past a third: it goes the rest of the way and closes, with "cancel"; the focus is back (${s.focus})`);
await press(p, '#open-bottom'); await settle(p);
await pull(p, '#d-bottom', 40, { steps: 3, ms: 8 }); await settle(p);
s = await read(p, '#d-bottom');
say(!s.shown && s.value === 'cancel', 'thrown: a short quick flick closes it however little way it went');
await press(p, '#open-bottom'); await settle(p);
await pull(p, '#d-bottom', -60); await settle(p);
s = await read(p, '#d-bottom');
say(s.open && s.moved === '0', 'pulled the other way, it gives a little and comes back');
// never in between: let go at many places, it is either home or gone
const rests = [];
for (const f of [0.1, 0.25, 0.3, 0.4, 0.6]) {
  if (!(await read(p, '#d-bottom')).open) { await press(p, '#open-bottom'); await settle(p); }
  await pull(p, '#d-bottom', H * f, { steps: 8, ms: 30 }); await settle(p);
  const r = await read(p, '#d-bottom');
  rests.push(r.open ? (r.moved === '0' ? 'home' : 'BETWEEN ' + r.moved) : r.shown ? 'BETWEEN closing' : 'gone');
}
say(!rests.some((r) => r.startsWith('BETWEEN')) && rests[0] === 'home' && rests[4] === 'gone', `let go at a tenth, a quarter, 0.3, 0.4 and 0.6 of the way: ${rests.join(', ')}`);
// a press on the handle, with no drag, closes it
if (!(await read(p, '#d-bottom')).open) { await press(p, '#open-bottom'); await settle(p); }
await press(p, '#d-bottom .vx-drawer-handle'); await settle(p);
s = await read(p, '#d-bottom');
say(!s.shown && s.value === 'cancel', 'a press on the handle without a drag closes it');
await p.close();

// ---------------------------------------------------------------------------------------------
// a phone: from the bottom, by itself
p = await open({ ...PHONE, hasTouch: true, isMobile: true });
await press(p, '#open-deploy'); await p.waitForTimeout(70);
s = await read(p, '#deploy');
say(s.open && s.moved !== '0', `phone: it is on its way in (${s.moved})`);
await settle(p);
s = await read(p, '#deploy');
say(s.made.edge === 'bottom' && s.handle && s.made.pull === 'steel' && s.left === 0 && Math.abs(s.right - s.vw) < 0.5 && Math.abs(s.bottom - s.vh) < 0.5 && s.top >= 44, `phone: it comes up from the bottom, as wide as the window, with its handle, and leaves ${Math.round(s.top)} px of scrim`);
const cut = await p.evaluate(() => [...document.querySelectorAll('#deploy :is(h2, button, dd, p)')].filter((n) => { const r = n.getBoundingClientRect(); return r.width && (r.left < 0 || r.right > innerWidth + 0.5); }).length);
const side = await p.evaluate(() => { scrollTo(200, 0); const x = scrollX; scrollTo(0, 0); return x; });
say(cut === 0 && side === 0, 'phone: nothing in it is cut, and the page does not move sideways');
await p.screenshot({ path: 'shots/parts/drawer/hand-phone-day.png' });
// a finger on the handle, through the browser's own touch input
const cdp = await p.context().newCDPSession(p);
const finger = async (sel, by, { steps = 10, ms = 16, lift = true } = {}) => {
  const [x, y] = await mid(p, `${sel} .vx-drawer-handle`);
  const at = (yy) => [{ x, y: yy, id: 1, radiusX: 4, radiusY: 4 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(y) });
  for (let i = 1; i <= steps; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(y + (by * i) / steps) }); await p.waitForTimeout(ms); }
  if (lift) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
};
const PH = s.h;
await finger('#deploy', PH * 0.2, { lift: false });
s = await read(p, '#deploy');
say(s.held && s.moved !== '0', `phone: a finger drags it down by its handle (${s.moved})`);
await p.screenshot({ path: 'shots/parts/drawer/hand-phone-held.png' });
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await settle(p);
s = await read(p, '#deploy');
say(s.open && s.moved === '0', 'phone: let go a fifth of the way, it springs back');
await finger('#deploy', PH * 0.55, { steps: 12, ms: 25 }); await settle(p);
s = await read(p, '#deploy');
say(!s.shown && s.value === 'cancel', 'phone: dragged more than a third of the way, it closes');
await press(p, '#open-uk'); await settle(p);
s = await read(p, '#d-uk');
const ukCut = await p.evaluate(() => [...document.querySelectorAll('#d-uk :is(h2, button, p)')].filter((n) => { const r = n.getBoundingClientRect(); return r.width && (r.left < 0 || r.right > innerWidth + 0.5); }).length);
say(s.open && ukCut === 0, 'phone: "Розгорнути на сервері" fits');
await p.screenshot({ path: 'shots/parts/drawer/hand-phone-uk.png' });
await p.keyboard.press('Escape'); await settle(p);
await p.close();

// night, on a phone
p = await open({ ...PHONE }, '?theme=dark');
await press(p, '#open-deploy'); await settle(p);
await p.screenshot({ path: 'shots/parts/drawer/hand-phone-night.png' });
await p.close();

// where motion is not wanted: nothing slides; a drag still follows the hand, and let go it is home or gone at once
p = await open({ reducedMotion: 'reduce' });
await press(p, '#open-bottom'); await p.waitForTimeout(40);
s = await read(p, '#d-bottom');
say(s.open && s.moved === '0' && Math.abs(s.bottom - s.vh) < 0.5, 'reduced motion: it is in place at once');
await pull(p, '#d-bottom', s.h * 0.2); await p.waitForTimeout(40);
s = await read(p, '#d-bottom');
say(s.open && s.moved === '0', 'reduced motion: let go short, it is home at once');
await pull(p, '#d-bottom', s.h * 0.6); await p.waitForTimeout(40);
s = await read(p, '#d-bottom');
say(!s.shown && s.value === 'cancel', 'reduced motion: let go past a third, it is gone at once');
await p.close();

// with no voxels at all it is the same drawer
p = await open({ ...PHONE }, '?theme=light', true);
say(await p.evaluate(() => !document.querySelector('[data-vx-live]')), 'plain: nothing on the page is voxels');
await press(p, '#open-deploy'); await settle(p);
s = await read(p, '#deploy');
say(s.open && s.handle && Math.abs(s.bottom - s.vh) < 0.5, 'plain: on a phone it comes up from the bottom with its handle');
await p.screenshot({ path: 'shots/parts/drawer/hand-phone-plain.png' });
await pull(p, '#deploy', s.h * 0.2); await settle(p);
s = await read(p, '#deploy');
say(s.open && s.moved === '0', 'plain: let go short, it springs back');
await pull(p, '#deploy', s.h * 0.5); await settle(p);
s = await read(p, '#deploy');
say(!s.shown && s.value === 'cancel' && s.focus === 'open-deploy', 'plain: dragged past a third it closes, and the focus is back');
await p.close();

say(errors.length === 0, 'no errors' + (errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''));
await browser.close();
process.exit(bad ? 1 : 0);
