// A person on the number stepper's page: a real mouse on its keys, real keys in its field. Says
// ok or FAIL for each thing that must hold; exit 1 on a failure.
//   PORT=5989 node tools/parts/stepper.mjs
import { chromium } from 'playwright';

const port = process.env.PORT || 5989;
const url = `http://127.0.0.1:${port}/showcase/parts/stepper.html`;
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
let bad = 0;
const say = (ok, what) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); };
const errors = [];

async function open({ plain = false, width = 1180 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 950 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  if (plain) await p.addInitScript(() => { new MutationObserver((_, o) => { if (document.documentElement) { document.documentElement.setAttribute('data-vx-plain', ''); o.disconnect(); } }).observe(document, { childList: true }); });
  await p.goto(`${url}?theme=light`);
  await p.waitForFunction(() => document.documentElement.dataset.ready === '1');
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(800);
  return p;
}
const mid = async (p, sel) => { const b = await p.locator(sel).first().boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
const press = async (p, sel, held = 90) => { const [x, y] = await mid(p, sel); await p.mouse.move(x, y, { steps: 6 }); await p.mouse.down(); await p.waitForTimeout(held); await p.mouse.up(); };
const val = (p, id) => p.evaluate((i) => document.querySelector(`${i} input`).value, id);
const off = (p, id, way) => p.evaluate(([i, w]) => document.querySelector(`${i} [data-vx-step="${w}"]`).getAttribute('aria-disabled') === 'true', [id, way]);
const up = (id) => `${id} [data-vx-step="up"]`, down = (id) => `${id} [data-vx-step="down"]`;
const said = (p) => p.evaluate(() => document.getElementById('said').textContent);

// at 390 px: is anything of the part outside the sheet's own column? (the page clips what overflows, so it would be cut, not scrolled)
// Boxes are the layout's own (offsets): a painted key that is down is drawn a voxel aside, and that is not this.
const cut = (q, sel) => q.evaluate((s) => { const at = (e) => { let x = 0; for (let n = e; n; n = n.offsetParent) x += n.offsetLeft; return x; }; const sheet = document.querySelector('.sheet'), c = getComputedStyle(sheet); const lo = at(sheet) + parseFloat(c.paddingLeft) - 0.5, hi = at(sheet) + sheet.offsetWidth - parseFloat(c.paddingRight) + 0.5; return [...document.querySelectorAll(s)].filter((e) => !e.matches('.vx-canvas') && e.offsetWidth && (at(e) < lo || at(e) + e.offsetWidth > hi)).map((e) => (e.getAttribute('aria-label') || e.textContent.trim()).slice(0, 24)); }, sel);
// every stepper, its well and its keys: its box, to the pixel
const boxes = (q) => q.evaluate(() => [...document.querySelectorAll('.vx-stepper, .vx-stepper > *')].filter((e) => !e.matches('.vx-canvas')).map((e) => { let x = 0, y = 0; for (let n = e; n; n = n.offsetParent) { x += n.offsetLeft; y += n.offsetTop; } return [x, y, e.offsetWidth, e.offsetHeight].join(' '); }));

const p = await open();
const firstBoxes = await boxes(p);
const sizes = await p.evaluate(() => { const s = document.querySelector('#replicas'); return [...s.children].filter((c) => !c.matches('.vx-canvas')).map((c) => c.offsetWidth + 'x' + c.offsetHeight).join(' '); });
say(sizes === '28x28 72x44 28x28', `each key's cap is seven voxels square, a small key beside a window eleven tall (${sizes})`);
// the room each key keeps (its margin) and its target (::after) are 44 px, as the close button's are
const room = await p.evaluate(() => [...document.querySelectorAll('#replicas > .vx-button')].map((k) => { const c = getComputedStyle(k), a = getComputedStyle(k, '::after'); return [parseFloat(c.marginLeft) + parseFloat(c.marginRight) + k.offsetWidth, parseFloat(c.marginTop) + parseFloat(c.marginBottom) + k.offsetHeight, k.offsetWidth - parseFloat(a.left) - parseFloat(a.right), k.offsetHeight - parseFloat(a.top) - parseFloat(a.bottom)].join('x'); }).join(' '));
say(room === '44x44x44x44 44x44x44x44', `each key keeps 44 px of room and its target is 44 by 44 px (${room})`);
say(await p.evaluate(() => { const i = document.querySelector('#replicas input'); return i.type === 'number' && i.matches('.vx-well > input') && document.querySelectorAll('#replicas > .vx-button[aria-label]').length === 2; }), 'it is a real number field in the kit\'s well, with two of the kit\'s keys, each with a name');
say(await p.evaluate(() => !!window.vx.live(document.querySelector('#replicas .vx-well')) && !!window.vx.live(document.querySelector('#replicas .vx-button'))), 'the well and the keys are drawn in voxels by the kit\'s own parts');

// ---- a real mouse on the keys
await press(p, up('#replicas'));
say(await val(p, '#replicas') === '4', `a press on the plus key steps once (3 to ${await val(p, '#replicas')})`);
say(await said(p) === '4 replicas', `the field sent change, as if typed: "${await said(p)}"`);
await press(p, down('#replicas'));
await press(p, down('#replicas'));
say(await val(p, '#replicas') === '2', `two presses on the minus key step twice (${await val(p, '#replicas')})`);
await press(p, down('#replicas'));
say(await val(p, '#replicas') === '1' && await off(p, '#replicas', 'down'), 'at the least (1) the minus key is switched off');
const low = await p.evaluate(() => { const l = window.vx.live(document.querySelector('#replicas [data-vx-step="down"]')); return l.state.off && l.model.byName.cap.tz === 0 && !l.model.byName.light; });
say(low, 'and is drawn off: low, with no light');
await press(p, down('#replicas'));
say(await val(p, '#replicas') === '1', 'a press on it then does nothing (still 1)');

// the target, not the cap: a press 20 px right of the plus key's middle (off its cap) steps; 26 px does not
{
  const at = async (dx, dy) => { const [mx, my] = await mid(p, up('#replicas')); await p.mouse.move(mx + dx, my + dy, { steps: 4 }); await p.mouse.down(); await p.waitForTimeout(90); await p.mouse.up(); await p.mouse.move(4, 4); };
  await at(20, 20);
  const one = await val(p, '#replicas');
  await at(26, 0);
  const two = await val(p, '#replicas');
  say(one === '2' && two === '2', `a press at the corner of the plus key's target, 20 px right and down of its middle, steps (1 to ${one}); one 26 px off does nothing (${two})`);
  await press(p, down('#replicas'));
}

// holding a key repeats, and stops at the limit
let [x, y] = await mid(p, up('#replicas'));
await p.mouse.move(x, y, { steps: 6 });
await p.mouse.down();
await p.waitForTimeout(300);
const early = await val(p, '#replicas');
await p.waitForTimeout(1500);
const late = await val(p, '#replicas');
say(early === '2' && late === '12', `held, the plus key steps once, waits, then goes on stepping, and stops at the most (${early} after 0.3 s, ${late} after 1.8 s)`);
say(await off(p, '#replicas', 'up') && !(await off(p, '#replicas', 'down')), 'at the most (12) the plus key is switched off, and the minus key is back on');
await p.mouse.up();
await p.waitForTimeout(250);
const cap = await p.evaluate(() => { const l = window.vx.live(document.querySelector('#replicas [data-vx-step="up"]')); return [l.spring('press').target, l.model.byName.cap.tz]; });
say(cap[0] === 0 && cap[1] === 0, `let go, the key that was switched off under the hand is not left down (press ${cap[0]}, cap ${cap[1]})`);

// held in the middle of the range: it stops when the hand lets go, and keeps to the step
[x, y] = await mid(p, up('#memory'));
await p.mouse.move(x, y, { steps: 6 });
await p.mouse.down();
await p.waitForTimeout(800);
await p.mouse.up();
const a = Number(await val(p, '#memory'));
await p.waitForTimeout(400);
const b = Number(await val(p, '#memory'));
say(a > 1280 && a < 4096 && a % 256 === 0 && a === b, `held for 0.8 s the memory goes up in steps of 256 and stops when let go (1024 to ${a}, then ${b})`);
// the pointer taken off the key while held: it stops
[x, y] = await mid(p, down('#memory'));
await p.mouse.move(x, y, { steps: 6 });
await p.mouse.down();
await p.waitForTimeout(120);
await p.mouse.move(x, y + 150, { steps: 6 });
const c = Number(await val(p, '#memory'));
await p.waitForTimeout(900);
say(Number(await val(p, '#memory')) === c && c === a - 256, `held, then the pointer taken off the key: it stops (${c})`);
await p.mouse.up();

// a step that is not a whole number
await press(p, up('#timeout'));
say(await val(p, '#timeout') === '3', `a step of a half: 2.5 to ${await val(p, '#timeout')}`);
await press(p, down('#timeout'));
await press(p, down('#timeout'));
say(await val(p, '#timeout') === '2', `and back down by halves (${await val(p, '#timeout')})`);

// the focus stays in the field
await p.click('#replicas input');
await press(p, down('#replicas'));
say(await p.evaluate(() => document.activeElement === document.querySelector('#replicas input')), 'a press on a key leaves the focus in the field');

// ---- real keys in the field
await p.keyboard.press('ArrowUp');
say(await val(p, '#replicas') === '12', `in the field the up arrow steps up, and not past the most (11 to ${await val(p, '#replicas')})`);
await p.keyboard.press('ArrowUp');
say(await val(p, '#replicas') === '12', 'at the most the up arrow does nothing');
await p.keyboard.press('ArrowDown');
await p.keyboard.press('ArrowDown');
say(await val(p, '#replicas') === '10' && !(await off(p, '#replicas', 'up')), `the down arrow steps down, and the plus key comes back on (${await val(p, '#replicas')})`);
// a key held down repeats: the browser sends keydown again and again
await p.keyboard.down('ArrowDown'); await p.keyboard.down('ArrowDown'); await p.keyboard.down('ArrowDown'); await p.keyboard.up('ArrowDown');
say(await val(p, '#replicas') === '7', `the down arrow held (three keydowns) steps three times (${await val(p, '#replicas')})`);
await p.keyboard.press('ControlOrMeta+a');
await p.keyboard.type('12');
say(await val(p, '#replicas') === '12' && await off(p, '#replicas', 'up'), 'typing 12 into the field switches the plus key off');
await p.keyboard.press('ControlOrMeta+a');
await p.keyboard.type('5');
say(await val(p, '#replicas') === '5' && !(await off(p, '#replicas', 'up')) && !(await off(p, '#replicas', 'down')), 'typing 5 switches both keys on');
await p.keyboard.press('Tab');
say(await p.evaluate(() => document.activeElement === document.querySelector('#memory input')), 'Tab goes from one field to the next: the keys are not tab stops');
const lit = await p.evaluate(() => getComputedStyle(document.querySelector('#memory .vx-well')).outlineStyle + ' ' + window.vx.live(document.querySelector('#memory .vx-well')).spring('lit').target);
say(lit === 'none 1', `the field in focus shows it with its rim's own light (outline ${lit.split(' ')[0]}, rim light ${lit.split(' ')[1]})`);

// a key reached another way (a screen reader, a script): a click with no press before it
await p.evaluate(() => document.querySelector('#replicas [data-vx-step="up"]').click());
say(await val(p, '#replicas') === '6', 'a click on a key with no pointer steps once');
await p.evaluate(() => document.querySelector('#replicas [data-vx-step="up"]').focus());
await p.keyboard.press('Enter');
await p.keyboard.press('Space');
say(await val(p, '#replicas') === '8', `Enter and Space on a key in focus step once each (${await val(p, '#replicas')})`);

// ---- from code, and the other states
await p.evaluate(() => { document.querySelector('#replicas input').value = '1'; });
say(await off(p, '#replicas', 'down'), 'the number set from code (input.value = 1): the minus key is switched off');
await p.evaluate(() => { document.querySelector('#replicas input').max = '1'; });
await p.waitForTimeout(50);
say(await off(p, '#replicas', 'up'), 'the most set from code (max = 1): the plus key is switched off');
say(await off(p, '#least', 'down') && await off(p, '#most', 'up'), 'on the page as loaded: at the least the minus key is off, at the most the plus key');
await press(p, down('#any'));
say(await val(p, '#any') === '-1', `empty and without limits, the minus key goes below nothing (${await val(p, '#any')})`);
await press(p, up('[aria-label="Seats, too many"]'));
say(await val(p, '[aria-label="Seats, too many"]') === '14', 'above the most, the plus key does nothing');
await press(p, down('[aria-label="Seats, too many"]'));
say(await val(p, '[aria-label="Seats, too many"]') === '10', `and the minus key brings it back to the most (${await val(p, '[aria-label="Seats, too many"]')})`);
await press(p, up('[aria-label="Seats, off"]'));
say(await val(p, '[aria-label="Seats, off"]') === '5' && await off(p, '[aria-label="Seats, off"]', 'up') && await off(p, '[aria-label="Seats, off"]', 'down'), 'a stepper that is off has both keys off, and does not step');
await p.mouse.move(4, 4);
await p.waitForTimeout(900);
say(await p.evaluate(() => window.vx.stage.awake.size) === 0, 'at rest nothing runs');
await p.context().close();

// ---- plain
{
  const q = await open({ plain: true });
  say(await q.locator('[data-vx-live]').count() === 0, 'plain: nothing is drawn in voxels');
  const plainBoxes = await boxes(q);
  const moved = plainBoxes.filter((b, i) => b !== firstBoxes[i]).length;
  say(plainBoxes.length === firstBoxes.length && moved === 0, `plain: every stepper, well and key has the box it has in voxels (${moved} of ${plainBoxes.length} differ)`);
  await press(q, up('#replicas'));
  say(await val(q, '#replicas') === '4', 'plain: a press on the plus key steps once');
  await press(q, up('#replicas'), 1300);
  say(await val(q, '#replicas') === '12' && await off(q, '#replicas', 'up'), `plain: held, it repeats to the most and the key is switched off (${await val(q, '#replicas')})`);
  await q.click('#replicas input');
  await q.keyboard.press('ArrowDown');
  say(await val(q, '#replicas') === '11', 'plain: the arrow keys work in the field');
  await q.context().close();
}

// ---- on a phone
for (const plain of [false, true]) {
  const q = await open({ width: 390, plain });
  const out = await cut(q, '.vx-stepper, .vx-stepper > *:not(.vx-canvas)');
  say(out.length === 0, `at 390 px${plain ? ', plain' : ''}: no stepper is cut (${out.length} outside the column)`);
  await q.context().close();
}

// ---- no script at all: the keys could do nothing, so they are gone and the field is the browser's own
{
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 950 }, javaScriptEnabled: false });
  const q = await ctx.newPage();
  await q.goto(`${url}?theme=light`);
  await q.waitForTimeout(600);
  const keys = await q.locator('#replicas > .vx-button').evaluateAll((all) => all.filter((k) => k.offsetParent).length).catch(() => -1);
  const spin = await q.locator('#replicas input').evaluate((i) => getComputedStyle(i, '::-webkit-inner-spin-button').appearance).catch(() => '?');
  say(keys === 0 && spin === 'auto', `with no script the two keys are not shown and the browser's own spin buttons are back (${keys} keys shown; spin buttons: ${spin})`);
  await q.click('#replicas input');
  await q.keyboard.press('ArrowUp');
  say(await q.locator('#replicas input').inputValue() === '4', 'and the arrow keys still step the field');
  await ctx.close();
}

say(errors.length === 0, 'no errors' + (errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''));
await browser.close();
process.exit(bad ? 1 : 0);
