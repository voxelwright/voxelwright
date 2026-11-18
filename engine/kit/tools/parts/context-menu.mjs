// The context menu under a real mouse, a real finger and real keys: the kit's menu, opened at
// the pointer by a right press, at the thing in focus by the menu key or Shift+F10, and under
// the finger by a long press; closed by Escape, a press outside, a scroll and a choice, with the
// focus given back. A text field keeps the browser's own menu.
//   PORT=5989 node tools/parts/context-menu.mjs
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const port = process.env.PORT || 5989;
const url = `http://127.0.0.1:${port}/kit/showcase/parts/context-menu.html`;
await mkdir('shots/parts/context-menu', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
const errors = [];
let bad = 0;
const say = (ok, what) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); };
const PHONE = { viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };
async function open(opts = {}, query = '?theme=light', plain = false) {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 760 }, deviceScaleFactor: 1, ...opts });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  if (plain) await p.addInitScript(() => { new MutationObserver((_, o) => { if (document.documentElement) { document.documentElement.setAttribute('data-vx-plain', ''); o.disconnect(); } }).observe(document, { childList: true }); });
  await p.goto(url + query);
  await p.waitForFunction(() => document.documentElement.dataset.ready === '1');
  await p.evaluate(() => document.fonts.ready);
  // what the page did with each right press: whether the browser's own menu was let be
  await p.evaluate(() => { window.said = []; document.addEventListener('contextmenu', (e) => window.said.push(e.defaultPrevented ? 'kept' : 'browser')); });
  await p.waitForTimeout(700);
  return p;
}
const box = async (p, sel) => p.locator(sel).first().boundingBox();
const read = (p, id) => p.evaluate(async (id) => {
  const el = document.getElementById(id), l = window.vx?.live?.(el), r = el.getBoundingClientRect();
  let made = null;
  if (l) {
    const { MATERIALS } = await import('/kit/src/index.js');
    const name = (i) => Object.keys(MATERIALS).find((k) => MATERIALS[k].id === i);
    const of = (q) => (q ? [...new Set(q.mats)].map(name).sort().join('+') : 'none');
    made = { panel: of(l.model.byName.panel), cubes: l.model.byName.panel?.count ?? 0, top: l.faceZ, float: l.look.float, fx: l.model.byName.panel?.fx?.kind ?? null, active: l.state.active, mark: !l.model.byName.pick?.hidden, lift: l.faceZ * l.vx / 2 };
  }
  const a = document.activeElement;
  return {
    open: el.matches(':popover-open'), left: r.left, top: r.top, right: r.right, bottom: r.bottom, vw: document.documentElement.clientWidth, vh: innerHeight,
    label: el.getAttribute('aria-label'), focus: a === document.body || a === document.documentElement ? a.tagName : a === el ? 'MENU' : a.id || a.textContent.trim().slice(0, 28) || a.tagName,
    chosen: document.getElementById('chosen').textContent, hash: location.hash, said: window.said.slice(-1)[0] ?? null, made,
  };
}, id);
const right = async (p, x, y) => { await p.mouse.move(x, y, { steps: 4 }); await p.mouse.click(x, y, { button: 'right' }); await p.waitForTimeout(80); };
const fresh = async (p) => { await p.keyboard.press('Escape'); await p.waitForTimeout(150); };

// ---------------------------------------------------------------------------------------------
let p = await open();
let b = await box(p, '#log-212');
let [x, y] = [b.x + 120, b.y + b.height / 2];
await right(p, x, y);
let m = await read(p, 'log-menu');
const anchoredY = y + (m.bottom - m.top) + m.made.lift > m.vh - 12 ? m.bottom : m.top;
say(m.open && Math.abs(m.left - x) <= 1 && Math.abs(anchoredY - y) <= 1, `a right press on deploy-212.log opens the menu with its corner at the pointer (${m.left}, ${m.top} for ${x}, ${y})`);
say(m.said === 'kept', 'and the browser\'s own menu does not open over it');
say(m.made.panel === 'key+light' && m.made.top === m.made.float && m.made.fx === 'assemble', `it is the kit's menu: a float ${m.made.top} voxels high on the accent's light, being built (${m.made.cubes} cubes)`);
say(m.label === 'deploy-212.log', `the page heard which log it is for (${m.label})`);
say(m.focus === 'MENU', `the focus is in the menu (${m.focus})`);
await p.waitForTimeout(400);
await p.keyboard.press('ArrowDown'); await p.keyboard.press('ArrowDown'); await p.waitForTimeout(80);
m = await read(p, 'log-menu');
say(m.focus === 'Download' && m.made.active === 1 && m.made.mark, `the arrows go down its rows, and the mark follows (${m.focus})`);
await p.screenshot({ path: 'shots/parts/context-menu/hand-open-day.png' });
await p.keyboard.press('Enter'); await p.waitForTimeout(150);
m = await read(p, 'log-menu');
say(!m.open && m.chosen === 'Downloaded deploy-212.log' && m.hash === '', `Enter chooses Download and closes it (${m.chosen}); the link under it was not followed`);
say(m.focus === 'log-212', `the focus goes back to what had it (${m.focus})`);

// Escape
await right(p, x, y);
await p.keyboard.press('Escape'); await p.waitForTimeout(150);
m = await read(p, 'log-menu');
say(!m.open && m.focus === 'log-212', `Escape closes it, and the focus is back (${m.focus})`);
// a press outside it, on nothing in particular
await right(p, x, y);
await p.mouse.click(1100, 600); await p.waitForTimeout(150);
m = await read(p, 'log-menu');
say(!m.open, 'a press outside it closes it');
// a press outside it, on a field: the focus stays where the hand put it
await right(p, x, y);
b = await box(p, '#find');
await p.mouse.click(b.x + 40, b.y + b.height / 2); await p.waitForTimeout(150);
m = await read(p, 'log-menu');
say(!m.open && m.focus === 'find', `a press on the field closes it, and the field keeps the focus (${m.focus})`);
// a scroll
await p.evaluate(() => document.activeElement.blur());
await right(p, x, y);
await p.mouse.move(1100, 500); await p.mouse.wheel(0, 120); await p.waitForTimeout(200);
m = await read(p, 'log-menu');
say(!m.open, 'a scroll closes it: it would be left behind by what it is for');
await p.evaluate(() => scrollTo(0, 0)); await p.waitForTimeout(150);
// a second right press somewhere else moves it there
b = await box(p, '#log-212');
[x, y] = [b.x + 120, b.y + b.height / 2];
await right(p, x, y);
const b2 = await box(p, '#log-211');
await right(p, b2.x + 300, b2.y + b2.height / 2);
m = await read(p, 'log-menu');
say(m.open && Math.abs(m.left - (b2.x + 300)) <= 1 && m.label === 'deploy-211.log', 'a right press somewhere else while it is open opens it there, for that log');
await fresh(p);
// a text field keeps the browser's own menu
b = await box(p, '#find');
await right(p, b.x + 40, b.y + b.height / 2);
m = await read(p, 'log-menu');
say(!m.open && m.said === 'browser', 'a right press in the text field leaves the browser\'s own menu (copy, paste) to it');
await fresh(p);
// Tab out of it closes it
await right(p, x, y);
await p.keyboard.press('ArrowDown'); await p.keyboard.press('End'); await p.keyboard.press('Tab'); await p.waitForTimeout(150);
m = await read(p, 'log-menu');
say(!m.open, `Tab out of it closes it (the focus is on ${m.focus})`);
await fresh(p);

// from the keys
await p.locator('#log-213').focus();
await p.keyboard.press('Shift+F10'); await p.waitForTimeout(120);
m = await read(p, 'log-menu');
b = await box(p, '#log-213');
say(m.open && m.focus === 'Open' && m.top >= b.y && m.top <= b.y + b.height && m.label === 'deploy-213.log', `Shift+F10 on deploy-213.log opens it on that row, with the first row in focus (${m.focus}, at ${Math.round(m.left)}, ${Math.round(m.top)})`);
await p.keyboard.press('Escape'); await p.waitForTimeout(150);
m = await read(p, 'log-menu');
say(!m.open && m.focus === 'log-213', `Escape: closed, the focus back on the row (${m.focus})`);
await p.keyboard.press('ContextMenu'); await p.waitForTimeout(120);
m = await read(p, 'log-menu');
say(m.open && m.focus === 'Open', 'the menu key opens it the same way');
await p.keyboard.press('ArrowUp'); await p.waitForTimeout(60);
m = await read(p, 'log-menu');
say(m.focus === 'Delete', 'ArrowUp from the first row goes round to the last');
await p.keyboard.press('Escape'); await p.waitForTimeout(150);
await p.locator('#find').focus();
await p.keyboard.press('Shift+F10'); await p.waitForTimeout(120);
say(!(await read(p, 'log-menu')).open, 'Shift+F10 in the text field is the field\'s, not this menu\'s');

// right to left: it opens toward the start, which is the left
await p.locator('#board-uk').scrollIntoViewIfNeeded(); await p.waitForTimeout(150);
b = await box(p, '#board-uk');
[x, y] = [b.x + b.width / 2, b.y + 10];
await right(p, x, y);
m = await read(p, 'board-menu-uk');
say(m.open && Math.abs(m.right - x) <= 1, `written right to left, it opens toward the left of the pointer (its right edge at ${m.right} for ${x})`);
await fresh(p);
await p.close();

// near the edges of a small window it turns over, and stays in the window
p = await open({ viewport: { width: 600, height: 500 } });
await p.locator('#board').evaluate((n) => n.scrollIntoView({ block: 'end' }));
await p.waitForTimeout(200);
b = await box(p, '#board');
[x, y] = [b.x + b.width - 4, Math.min(500 - 6, b.y + b.height - 4)];
await right(p, x, y);
m = await read(p, 'board-menu');
say(m.open && Math.abs(m.right - x) <= 1 && m.bottom <= y + 1 && m.bottom >= y - m.made.lift - 12 && m.right + m.made.lift <= 600 - 12 + 0.5 && m.bottom + m.made.lift <= 500 - 12 + 0.5, `by the end and the bottom of the window it opens toward the start and up, from the pointer, inside the window (${Math.round(m.left)}, ${Math.round(m.top)} to ${Math.round(m.right)}, ${Math.round(m.bottom)} for ${Math.round(x)}, ${Math.round(y)})`);
await p.waitForTimeout(400);
await p.screenshot({ path: 'shots/parts/context-menu/hand-edge-day.png' });
await fresh(p);
await p.close();

// night
p = await open({}, '?theme=dark');
b = await box(p, '#log-213');
await right(p, b.x + 120, b.y + b.height / 2); await p.waitForTimeout(450);
await p.keyboard.press('ArrowDown'); await p.waitForTimeout(80);
await p.screenshot({ path: 'shots/parts/context-menu/hand-open-night.png' });
await p.close();

// a phone: a long press of a finger
p = await open(PHONE);
const cdp = await p.context().newCDPSession(p);
const touch = async (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1, radiusX: 4, radiusY: 4 }] });
b = await box(p, '#log-213');
[x, y] = [b.x + b.width - 30, b.y + b.height / 2];
await touch('touchStart', x, y); await p.waitForTimeout(300);
m = await read(p, 'log-menu');
const early = m.open;
await p.waitForTimeout(400);
m = await read(p, 'log-menu');
say(!early && m.open, 'a finger held still on a log opens the menu after half a second, while it is still held');
await touch('touchEnd'); await p.waitForTimeout(200);
m = await read(p, 'log-menu');
say(m.open && m.hash === '', 'let go, the menu stays, and the link under the finger is not followed');
say(m.left >= 12 && m.right + m.made.lift <= 390 - 12 + 0.5 && m.label === 'deploy-213.log', `at 390 px it is inside the window (${Math.round(m.left)} to ${Math.round(m.right)})`);
await p.screenshot({ path: 'shots/parts/context-menu/hand-long-390.png' });
await touch('touchStart', 20, 20); await touch('touchEnd'); await p.waitForTimeout(200);
say(!(await read(p, 'log-menu')).open, 'a tap outside it closes it');
// a finger that moves is scrolling, not asking for the menu
await touch('touchStart', x, y);
for (let i = 1; i <= 6; i++) { await touch('touchMove', x, y - i * 8); await p.waitForTimeout(20); }
await p.waitForTimeout(700); await touch('touchEnd'); await p.waitForTimeout(150);
say(!(await read(p, 'log-menu')).open, 'a finger that moves on does not open it');
// a quick tap is a tap
await p.evaluate(() => scrollTo(0, 0)); await p.waitForTimeout(150);
b = await box(p, '#log-213');
[x, y] = [b.x + b.width - 30, b.y + b.height / 2];
await touch('touchStart', x, y); await p.waitForTimeout(60); await touch('touchEnd'); await p.waitForTimeout(250);
m = await read(p, 'log-menu');
say(!m.open && m.hash === '#deploy-213', 'a quick tap on a log follows its link');
const side = await p.evaluate(() => { scrollTo(200, 0); const x = scrollX; scrollTo(0, 0); return x; });
say(side === 0, 'the page does not move sideways');
await p.close();

// with no voxels it is the same menu, painted
p = await open({}, '?theme=light', true);
say(await p.evaluate(() => !document.querySelector('[data-vx-live]')), 'plain: nothing on the page is voxels');
b = await box(p, '#log-212');
[x, y] = [b.x + 120, b.y + b.height / 2];
await right(p, x, y);
m = await read(p, 'log-menu');
say(m.open && Math.abs(m.left - x) <= 1 && m.focus === 'MENU' && m.said === 'kept', 'plain: a right press opens it at the pointer');
await p.keyboard.press('ArrowDown'); await p.waitForTimeout(60);
say((await read(p, 'log-menu')).focus === 'Open', 'plain: the arrows go to its rows');
await p.screenshot({ path: 'shots/parts/context-menu/hand-open-plain.png' });
await p.keyboard.press('Escape'); await p.waitForTimeout(150);
m = await read(p, 'log-menu');
say(!m.open && m.focus === 'log-212', `plain: Escape closes it, the focus is back (${m.focus})`);
await p.locator('#log-211').focus();
await p.keyboard.press('Shift+F10'); await p.waitForTimeout(100);
await p.keyboard.press('Enter'); await p.waitForTimeout(150);
m = await read(p, 'log-menu');
say(!m.open && m.chosen === 'Opened deploy-211.log' && m.focus === 'log-211', 'plain: Shift+F10 and Enter choose its first row, and the focus is back');
await p.close();

say(errors.length === 0, 'no errors' + (errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''));
await browser.close();
process.exit(bad ? 1 : 0);
