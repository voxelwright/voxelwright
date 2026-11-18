// A person on the toggle group's page: a real mouse and real keys, on both kinds of group. Says
// ok or FAIL for each thing that must hold; exit 1 on a failure.
//   PORT=5989 node tools/parts/toggle-group.mjs
import { chromium } from 'playwright';

const port = process.env.PORT || 5989;
const url = `http://127.0.0.1:${port}/showcase/parts/toggle-group.html`;
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
let bad = 0;
const say = (ok, what) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); };
const errors = [];

async function open({ plain = false, still = false, width = 1180 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 1300 }, deviceScaleFactor: 1, reducedMotion: still ? 'reduce' : 'no-preference' });
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
const press = async (p, sel) => { const [x, y] = await mid(p, sel); await p.mouse.move(x, y, { steps: 6 }); await p.mouse.down(); await p.waitForTimeout(100); await p.mouse.up(); };
const chosen = (p, group) => p.evaluate((g) => document.querySelector(`${g} input:checked`)?.value ?? null, group);
const said = (p) => p.evaluate(() => document.getElementById('said').textContent);
const focus = (p) => p.evaluate(() => { const a = document.activeElement; return a.value || a.dataset.value || a.textContent.trim(); });
// where the middle of the key in the trench is, in px from the group's corner, beside the middle
// of the chosen seat. `on` is true when they are within a pixel of each other.
const block = (p, group) => p.evaluate((g) => {
  const el = document.querySelector(g), l = window.vx.live(el), b = l.model.byName.block, seat = el.querySelector('label:has(input:checked)');
  const [, , w, h] = l.state.at[l.state.index] ?? l.state.at[0];
  const x = +((b.tx + w / 2) * l.vx + (l.cssW - l.W * l.vx) / 2).toFixed(1), y = +((b.ty + h / 2) * l.vx + (l.cssH - l.H * l.vx) / 2).toFixed(1);
  const seatX = seat ? seat.offsetLeft + seat.offsetWidth / 2 : null, seatY = seat ? seat.offsetTop + seat.offsetHeight / 2 : null;
  return { x, y, hidden: b.hidden, seatX, seatY, first: el.querySelector('label').offsetWidth / 2, on: seat !== null && Math.abs(x - seatX) <= 1 && Math.abs(y - seatY) <= 1, moving: l.spring('x').moving || l.spring('y').moving };
}, group);

// at 390 px: is anything of the part outside the sheet's own column? (the page clips what overflows, so it would be cut, not scrolled)
// Boxes are the layout's own (offsets): a painted key that is down is drawn a voxel aside, and that is not this.
const cut = (q, sel) => q.evaluate((s) => { const at = (e) => { let x = 0; for (let n = e; n; n = n.offsetParent) x += n.offsetLeft; return x; }; const sheet = document.querySelector('.sheet'), c = getComputedStyle(sheet); const lo = at(sheet) + parseFloat(c.paddingLeft) - 0.5, hi = at(sheet) + sheet.offsetWidth - parseFloat(c.paddingRight) + 0.5; return [...document.querySelectorAll(s)].filter((e) => !e.matches('.vx-canvas') && e.offsetWidth && (at(e) < lo || at(e) + e.offsetWidth > hi)).map((e) => (e.getAttribute('aria-label') || e.textContent.trim()).slice(0, 24)); }, sel);
// every group and every seat: its box, to the pixel
const boxes = (q) => q.evaluate(() => [...document.querySelectorAll('.vx-toggle-group, .vx-toggle-group > label, .vx-toggle-group > button')].filter((e) => !e.matches('.vx-canvas')).map((e) => { let x = 0, y = 0; for (let n = e; n; n = n.offsetParent) { x += n.offsetLeft; y += n.offsetTop; } return [x, y, e.offsetWidth, e.offsetHeight].join(' '); }));

const p = await open();
const firstBoxes = await boxes(p);

// ---- the seats lie on the voxel grid, and their words where a key's are
const tall = await p.evaluate(() => [...document.querySelectorAll('.vx-toggle-group > label')].map((l) => l.offsetHeight));
say(tall.every((h) => h === 44), `at this width every seat holds one line and is 11 voxels tall (${[...new Set(tall)].join(', ')} px)`);
const words = await p.evaluate(() => { const top = (e) => { const w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode()) && !n.textContent.trim()); const r = document.createRange(); r.selectNodeContents(n); return +(r.getBoundingClientRect().top - e.getBoundingClientRect().top).toFixed(2); }; return [top(document.querySelector('#two label')), top(document.querySelector('#style button[aria-pressed="false"]'))]; });
// (each is put on a whole pixel of the page by the stage, so they may differ by a part of one)
say(Math.abs(words[0] - words[1]) < 1, `a seat's words stand at the same height as a key's (${words[0]} px down in the seat, ${words[1]} px down in the key)`);

// ---- one of many: a radio group
say(await p.locator('#range[role="radiogroup"] input[type="radio"]').count() === 3, 'one of many is a radio group of real radio buttons');
let b = await block(p, '#range');
say(!b.hidden && b.on, `the key is in the chosen seat (its middle at ${b.x}, ${b.y}; the seat's at ${b.seatX}, ${b.seatY})`);
say(await p.evaluate(() => window.vx.stage.awake.size) === 0, 'at rest nothing runs');

// a real mouse
const [mx, my] = await mid(p, '#range label:nth-of-type(3)');
await p.mouse.move(mx, my, { steps: 6 });
await p.mouse.down(); await p.mouse.up();
await p.waitForTimeout(50);
b = await block(p, '#range');
say(await chosen(p, '#range') === 'month' && b.moving && b.x > b.first && b.x < b.seatX, `a press on Month chooses it, and the key is on its way there (at ${b.x} of ${b.seatX})`);
await p.waitForTimeout(700);
b = await block(p, '#range');
say(!b.moving && b.on, `and comes to rest in Month's seat (${b.x} for ${b.seatX})`);
say((await said(p)).includes('month'), `the page heard change: "${await said(p)}"`);

// the keyboard: one tab stop, arrow keys
await p.focus('#range input:checked');
await p.keyboard.press('ArrowLeft');
await p.waitForTimeout(30);
b = await block(p, '#range');
say(await chosen(p, '#range') === 'week' && !b.moving && b.on, `the left arrow chooses Week, and the key is there at once (${b.x} for ${b.seatX})`);
await p.keyboard.press('ArrowRight');
await p.keyboard.press('ArrowRight');
say(await chosen(p, '#range') === 'day', 'the right arrow goes on, and round from the last seat to the first');
await p.keyboard.press('ArrowDown');
say(await chosen(p, '#range') === 'week', 'the down arrow moves the choice too');
await p.keyboard.press('Tab');
say(await p.evaluate(() => !document.getElementById('range').contains(document.activeElement)), `Tab leaves the group: it is one tab stop (focus is on "${await focus(p)}")`);
await p.keyboard.press('Shift+Tab');
say(await focus(p) === 'week', 'Shift+Tab comes back to the chosen seat');
const ring = await p.evaluate(() => { const s = document.activeElement.closest('label'), c = getComputedStyle(s); return c.outlineStyle === 'solid' && parseFloat(c.outlineWidth) >= 2; });
say(ring, 'focus from the keyboard shows a ring round the seat');
await p.keyboard.press('Space');
say(await chosen(p, '#range') === 'week', 'Space on the chosen seat leaves it chosen');

// nothing chosen, then one
b = await p.evaluate(() => window.vx.live(document.getElementById('none')).model.byName.block.hidden);
say(b === true && await chosen(p, '#none') === null, 'nothing chosen: no key in the trench');
await press(p, '#none label:nth-of-type(2)');
await p.waitForTimeout(400);
b = await block(p, '#none');
say(await chosen(p, '#none') === 'partly' && !b.hidden && b.on, `a press on Partly puts the key there (${b.x} for ${b.seatX})`);

// a seat that is off
await press(p, 'input[name="plan"][value="fleet"]');
say(await chosen(p, '[aria-label="Plan"]') === 'team', 'a seat that cannot be chosen is not chosen by a press');
await p.focus('input[name="plan"]:checked');
await p.keyboard.press('ArrowRight');
say(await chosen(p, '[aria-label="Plan"]') === 'free', 'and the arrow keys pass over it');

// standing
await press(p, '#when label:nth-of-type(3)');
await p.waitForTimeout(700);
b = await block(p, '#when');
say(await chosen(p, '#when') === 'monday' && b.on && b.y > 100, `standing: a press on the last seat sends the key down to it (${b.y} for ${b.seatY})`);

// from code
await p.evaluate(() => { document.querySelector('#two input[value="board"]').checked = true; });
await p.waitForTimeout(100);
b = await block(p, '#two');
say(b.on && b.x > b.first, `chosen from code (input.checked = true): the key follows (${b.x} for ${b.seatX})`);

// ---- several of many: a toolbar of toggle buttons
const tabs = () => p.evaluate(() => [...document.querySelectorAll('#kinds button')].map((k) => k.tabIndex).join());
say(await p.locator('#kinds[role="toolbar"] button[aria-pressed]').count() === 3 && await tabs() === '0,-1,-1', `several of many is a toolbar of toggle buttons with one tab stop (tabindex ${await tabs()})`);
await p.focus('#range input:checked');
await p.keyboard.press('Tab');
say(await focus(p) === 'failed', 'Tab from the group before comes to its first key');
await p.keyboard.press('ArrowRight');
say(await focus(p) === 'live' && await p.evaluate(() => document.querySelector('#kinds [data-value="live"]').getAttribute('aria-pressed')) === 'true', 'the right arrow moves to the next key, and flips nothing');
await p.keyboard.press('End');
say(await focus(p) === 'rolled back', 'End goes to the last key');
await p.keyboard.press('ArrowRight');
say(await focus(p) === 'failed', 'the right arrow goes round to the first');
await p.keyboard.press('Home');
await p.keyboard.press('ArrowLeft');
say(await focus(p) === 'rolled back', 'Home, then the left arrow, goes round to the last');
await p.keyboard.press('Space');
await p.waitForTimeout(500);
say(await p.evaluate(() => document.querySelector('#kinds [data-value="rolled back"]').getAttribute('aria-pressed')) === 'true' && (await said(p)).endsWith('failed, live, rolled back'), `Space flips the key in focus, and the page hears: "${await said(p)}"`);
say(await tabs() === '-1,-1,0', `the tab stop has moved with the focus (tabindex ${await tabs()})`);
await p.keyboard.press('Tab');
say(await p.evaluate(() => !document.getElementById('kinds').contains(document.activeElement)), 'Tab leaves the toolbar: it is one tab stop');
await press(p, '#kinds [data-value="failed"]');
await p.mouse.move(4, 4);
await p.waitForTimeout(600);
const st = await p.evaluate(() => [...document.querySelectorAll('#kinds button')].map((k) => k.getAttribute('aria-pressed')).join());
const cap = await p.evaluate(() => window.vx.live(document.querySelector('#kinds [data-value="failed"]')).model.byName.cap.tz);
say(st === 'false,true,true' && cap === 0, `a press of the mouse flips one key and leaves the others (${st}); it stands up (${cap})`);
// one that cannot be changed stays in reach of the arrows, and does not flip
await press(p, '[aria-label="Channels"] [aria-disabled="true"]');
say(await p.evaluate(() => document.querySelector('[aria-label="Channels"] [aria-disabled="true"]').getAttribute('aria-pressed')) === 'true', 'a key that cannot be changed does not flip');
await p.focus('[aria-label="Channels"] button');
await p.keyboard.press('ArrowRight');
say(await focus(p) === 'Pager', 'but the arrows still come to it, so it can be read');
// standing: up and down
await p.focus('[aria-label="Days"] button');
await p.keyboard.press('ArrowDown');
say(await focus(p) === 'Saturday', 'standing: the down arrow moves to the next key');
// right to left
await p.evaluate(() => { document.getElementById('style').dir = 'rtl'; });
await p.focus('#style button');
await p.keyboard.press('ArrowLeft');
say(await focus(p) === 'Italic', 'right to left: the left arrow is the one that goes on');
await p.evaluate(() => { document.getElementById('style').removeAttribute('dir'); });

// legends on whole pixels
const offPixel = await p.evaluate(() => [...document.querySelectorAll('.vx-toggle-group label, .vx-toggle-group button')].filter((e) => { const w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode()) && !n.textContent.trim()); const r = document.createRange(); r.selectNodeContents(n); const q = r.getBoundingClientRect(); return Math.abs(q.left - Math.round(q.left)) > 0.02 || Math.abs(q.top + scrollY - Math.round(q.top + scrollY)) > 0.02; }).length);
say(offPixel === 0, `every legend starts on a whole pixel (${offPixel} do not)`);
await p.mouse.move(4, 4);
await p.waitForTimeout(900);
say(await p.evaluate(() => window.vx.stage.awake.size) === 0, 'and at rest again nothing runs');
await p.context().close();

// ---- reduced motion
{
  const q = await open({ still: true });
  const [x, y] = await mid(q, '#range label:nth-of-type(3)');
  await q.mouse.move(x, y);
  await q.mouse.down(); await q.mouse.up();
  await q.waitForTimeout(40);
  const k = await block(q, '#range');
  say(!k.moving && k.on, `reduced motion: the key is in the new seat at once (${k.x} for ${k.seatX})`);
  await q.context().close();
}

// ---- plain
{
  const q = await open({ plain: true });
  say(await q.locator('[data-vx-live]').count() === 0, 'plain: nothing is drawn in voxels');
  const plainBoxes = await boxes(q);
  const moved = plainBoxes.filter((b, i) => b !== firstBoxes[i]).length;
  say(plainBoxes.length === firstBoxes.length && moved === 0, `plain: every group, seat and key has the box it has in voxels (${moved} of ${plainBoxes.length} differ)`);
  await press(q, '#range label:nth-of-type(2)');
  const paint = await q.evaluate(() => getComputedStyle(document.querySelector('#range label:nth-of-type(2)')).backgroundColor);
  say(await chosen(q, '#range') === 'week' && paint !== 'rgba(0, 0, 0, 0)', `plain: a press chooses a seat, and it is painted as the key (${paint})`);
  await q.focus('#range input:checked');
  await q.keyboard.press('ArrowRight');
  say(await chosen(q, '#range') === 'month', 'plain: the arrow keys move the choice');
  const t = await q.evaluate(() => [...document.querySelectorAll('#kinds button')].map((k) => k.tabIndex).join());
  await q.focus('#kinds button');
  await q.keyboard.press('ArrowRight');
  await q.keyboard.press('Enter');
  say(t === '0,-1,-1' && await q.evaluate(() => document.querySelector('#kinds [data-value="live"]').getAttribute('aria-pressed')) === 'false', `plain: the toolbar has one tab stop (${t}), the arrow moves, Enter flips`);
  await q.context().close();
}

// ---- on a phone
for (const plain of [false, true]) {
  const q = await open({ width: 390, plain });
  const out = await cut(q, '.vx-toggle-group, .vx-toggle-group > *');
  const h = await q.evaluate(() => [...new Set([...document.querySelectorAll('.vx-toggle-group > label')].map((l) => l.offsetHeight))].sort().join(', '));
  const wraps = await q.evaluate(() => document.querySelector('[lang="uk"] label').offsetHeight);
  say(out.length === 0 && wraps === 64 && h === '44, 64', `at 390 px${plain ? ', plain' : ''}: nothing is cut (${out.length} outside the column), the long names wrap to two lines, and seats are 11 or 16 voxels tall (${h} px)`);
  if (!plain) {
    await press(q, '[lang="uk"] label:nth-of-type(2)');
    await q.waitForTimeout(700);
    const k = await block(q, '[lang="uk"]');
    say(k.on, `at 390 px a press on a seat of two lines sends the key to it (${k.x} for ${k.seatX})`);
  }
  await q.context().close();
}

say(errors.length === 0, 'no errors' + (errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''));
await browser.close();
process.exit(bad ? 1 : 0);
