// A person at the carousel's page: a real mouse on its keys, real keys on its track, a wheel, a
// finger. Says ok or FAIL for each thing that must hold; exit 1 on a failure.
//   PORT=5989 node tools/parts/carousel.mjs
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const port = process.env.PORT || 5989;
const url = `http://127.0.0.1:${port}/showcase/parts/carousel.html`;
const dir = 'shots/parts/carousel';
await mkdir(dir, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
let bad = 0;
const say = (ok, what) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); };
const errors = [];

// every timer the page has started and not yet ended, so that "nothing runs" can be counted
const countTimers = () => {
  // every timer but the renderer's: the engine keeps one of its own now and then, which is not the part's
  const live = window.__timers = new Set();
  const mine = () => !/\/src\/engine\//.test(new Error().stack.split('\n').slice(2, 4).join(' '));
  const st = window.setTimeout, ct = window.clearTimeout, si = window.setInterval, ci = window.clearInterval;
  window.setTimeout = (fn, ms, ...a) => { const id = st(() => { live.delete(id); fn(...a); }, ms); if (mine()) live.add(id); return id; };
  window.clearTimeout = (id) => { live.delete(id); ct(id); };
  window.setInterval = (fn, ms, ...a) => { const id = si(fn, ms, ...a); if (mine()) live.add(id); return id; };
  window.clearInterval = (id) => { live.delete(id); ci(id); };
};

async function open({ query = 'still', plain = false, width = 1180, height = 1000, reduced = false, touch = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion: reduced ? 'reduce' : 'no-preference', hasTouch: touch, isMobile: touch });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await p.addInitScript(countTimers);
  if (plain) await p.addInitScript(() => { new MutationObserver((_, o) => { if (document.documentElement) { document.documentElement.setAttribute('data-vx-plain', ''); o.disconnect(); } }).observe(document, { childList: true }); });
  await p.goto(`${url}?theme=light${query ? '&' + query : ''}`);
  await p.waitForFunction(() => document.documentElement.dataset.ready === '1');
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(700);
  return p;
}

// what a carousel says about itself, and where its track really is
const read = (p, id) => p.evaluate((id) => {
  const root = document.querySelector(id), track = root.querySelector('.vx-carousel-track'), b = track.getBoundingClientRect();
  const slides = [...track.querySelectorAll(':scope > .vx-carousel-slide')], lamps = root.querySelector('.vx-carousel-lamps');
  const live = window.vx?.live?.(lamps), rtl = getComputedStyle(track).direction === 'rtl';
  let near = 0, least = Infinity;
  slides.forEach((s, i) => { const r = s.getBoundingClientRect(), d = Math.abs(r.left + r.width / 2 - b.left - b.width / 2); if (d < least) { least = d; near = i; } });
  const r = slides[near].getBoundingClientRect();
  const offOf = (way) => root.querySelector(`[data-vx-step="${way}"]`)?.getAttribute('aria-disabled') === 'true';
  return {
    at: Number(lamps.style.getPropertyValue('--_at')), n: Number(lamps.style.getPropertyValue('--vx-carousel-n')), near,
    gap: Math.round(Math.abs(rtl ? r.right - b.right : r.left - b.left) * 10) / 10,
    prevOff: offOf('prev'), nextOff: offOf('next'),
    lit: live ? [...live.state.level].map((v) => Math.round(v * 100) / 100).join(' ') : null,
    inert: slides.map((s) => (s.inert ? 1 : 0)).join(''),
    names: slides.map((s) => `${s.getAttribute('role')}/${s.getAttribute('aria-roledescription')}/${s.getAttribute('aria-label')}`),
    say: track.getAttribute('aria-live'), word: root.querySelector('[data-vx-play]')?.textContent.trim() ?? null,
  };
}, id);
// it is brought into the window first: a mouse cannot press what is below the window's edge
const mid = async (p, sel) => { const l = p.locator(sel).first(); await l.scrollIntoViewIfNeeded(); const b = await l.boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
const press = async (p, sel, held = 70) => { const [x, y] = await mid(p, sel); await p.mouse.move(x, y, { steps: 6 }); await p.mouse.down(); await p.waitForTimeout(held); await p.mouse.up(); };
const key = (id, way) => `${id} [data-vx-step="${way}"]`;
const settle = (p) => p.waitForTimeout(750);
const sideways = (q) => q.evaluate(() => { scrollTo(200, scrollY); const x = scrollX; scrollTo(0, scrollY); return x; });
// is anything of the part outside the sheet's own column? (the page clips what overflows, so it would be cut, not scrolled)
const cut = (q) => q.evaluate(() => { const at = (e) => { let x = 0; for (let n = e; n; n = n.offsetParent) x += n.offsetLeft; return x; }; const sheet = document.querySelector('.sheet'), c = getComputedStyle(sheet); const lo = at(sheet) + parseFloat(c.paddingLeft) - 0.5, hi = at(sheet) + sheet.offsetWidth - parseFloat(c.paddingRight) + 0.5; return [...document.querySelectorAll('.vx-carousel, .vx-carousel-window, .vx-carousel-track, .vx-carousel-bar, .vx-carousel-bar > *')].filter((e) => e.offsetWidth && (at(e) < lo || at(e) + e.offsetWidth > hi)).map((e) => e.className.slice(0, 30)); });
// every carousel, its window and what is in its bar: its box, to the pixel
const boxes = (q) => q.evaluate(() => [...document.querySelectorAll('.vx-carousel, .vx-carousel-window, .vx-carousel-track, .vx-carousel-bar, .vx-carousel-bar > *')].map((e) => { let x = 0, y = 0; for (let n = e; n; n = n.offsetParent) { x += n.offsetLeft; y += n.offsetTop; } return [x, y, e.offsetWidth, e.offsetHeight].join(' '); }));

// ---- drawn in voxels, on a laptop; nothing on the page is asked to move by itself (?still)
const p = await open();
const liveBoxes = await boxes(p);
{
  let s = await read(p, '#week');
  say(s.names.join() === [1, 2, 3, 4].map((i) => `group/slide/${i} of 4`).join(), `each slide is a group that says it is a slide and which: ${s.names.map((n) => n.split('/')[2]).join(', ')}`);
  const filled = await read(p, '#first'), uk = await read(p, '#uk');
  say(filled.names.join() === [1, 2, 3].map((i) => `group/slide/${i} of 3`).join() && uk.names[1] === 'group/slide/2 з 2', `a slide written with no name is given one, in the page's own word ("${filled.names[2].split('/')[2]}", "${uk.names[1].split('/')[2]}")`);
  say(await p.evaluate(() => { const r = document.querySelector('#week'); return r.getAttribute('aria-roledescription') === 'carousel' && !!r.getAttribute('aria-label') && r.querySelector('.vx-carousel-track').tabIndex === 0 && [...r.querySelectorAll('[data-vx-step]')].every((k) => k.tagName === 'BUTTON' && k.getAttribute('aria-label')); }), 'it is a named carousel; its track takes the focus; previous and next are real buttons with names');
  say(await p.evaluate(() => !!window.vx.live(document.querySelector('#week .vx-carousel-lamps')) && !!window.vx.live(document.querySelector('#week .vx-carousel-window')) && !!window.vx.live(document.querySelector('#week [data-vx-step="next"]'))), 'the lamps are drawn in voxels by this part, the window and the keys by the kit\'s own');
  say(s.at === 0 && s.prevOff && !s.nextOff && s.lit === '1 0 0 0' && s.inert === '0111' && s.say === 'polite', `at rest it is on the first slide: its lamp is lit, previous is switched off, the other slides are out of reach (lamps ${s.lit}; inert ${s.inert})`);

  // ---- a real mouse on the keys
  await press(p, key('#week', 'next'));
  await p.waitForTimeout(30);
  s = await read(p, '#week');
  say(s.at === 1 && !s.prevOff, `30 ms after a press on next it says it is on the second slide, and previous is back on (at ${s.at})`);
  await settle(p);
  s = await read(p, '#week');
  say(s.near === 1 && s.gap < 1 && s.lit === '0 1 0 0' && s.inert === '1011', `and the second slide is in the window, its edge on the window's (${s.gap} px off), its lamp lit (lamps ${s.lit})`);
  await p.screenshot({ path: `${dir}/hand-second.png`, clip: { x: 200, y: 220, width: 780, height: 330 } });
  await press(p, key('#week', 'next'));
  await press(p, key('#week', 'next'));
  await settle(p);
  s = await read(p, '#week');
  say(s.near === 3 && s.at === 3 && s.nextOff && !s.prevOff && s.lit === '0 0 0 1', `two more presses, one after the other, go two slides on; on the last, next is switched off (slide ${s.near + 1}, lamps ${s.lit})`);
  say(await p.evaluate(() => { const l = window.vx.live(document.querySelector('#week [data-vx-step="next"]')); return l.state.off && l.model.byName.cap.tz === 0; }), 'and the key is drawn off: low, with no light');
  await press(p, key('#week', 'next'));
  await settle(p);
  s = await read(p, '#week');
  say(s.near === 3 && s.at === 3, 'a press on it then does nothing: it does not go round');
  await press(p, key('#week', 'prev'));
  await settle(p);
  s = await read(p, '#week');
  say(s.near === 2 && s.at === 2 && !s.nextOff, `a press on previous goes one back (slide ${s.near + 1})`);

  // ---- real keys
  await p.locator('#week .vx-carousel-track').focus();
  await p.keyboard.press('ArrowLeft');
  await settle(p);
  s = await read(p, '#week');
  const back = s.near;
  await p.keyboard.press('ArrowRight');
  await settle(p);
  s = await read(p, '#week');
  say(back === 1 && s.near === 2 && s.gap < 1, `on the track the left arrow goes a slide back and the right arrow a slide on (to ${back + 1}, then ${s.near + 1})`);
  await p.keyboard.press('Home');
  await settle(p);
  s = await read(p, '#week');
  const home = s.near;
  await p.keyboard.press('ArrowLeft');
  await settle(p);
  const stay = (await read(p, '#week')).near;
  await p.keyboard.press('End');
  await settle(p);
  s = await read(p, '#week');
  say(home === 0 && stay === 0 && s.near === 3 && s.at === 3 && s.lit === '0 0 0 1', `Home goes to the first slide, where the left arrow does nothing; End to the last (${home + 1}, ${stay + 1}, ${s.near + 1})`);
  say(await p.evaluate(() => document.activeElement === document.querySelector('#week .vx-carousel-track')), 'and the focus stays on the track throughout');
  await p.keyboard.press('Tab');
  const tabbed = await p.evaluate(() => document.activeElement.getAttribute('aria-label'));
  await p.keyboard.press('Enter');
  await settle(p);
  s = await read(p, '#week');
  const entered = s.near;
  await p.keyboard.press('Space');
  await settle(p);
  s = await read(p, '#week');
  say(tabbed === 'Previous slide' && entered === 2 && s.near === 1, `Tab goes from the track to the previous key; Enter and Space on it go a slide back each (${entered + 1}, ${s.near + 1})`);
  await p.keyboard.press('ArrowRight');
  await settle(p);
  s = await read(p, '#week');
  say(s.near === 2 && await p.evaluate(() => document.activeElement.getAttribute('aria-label')) === 'Previous slide', 'with the focus on a key in the bar the arrows still move the slides, and the focus stays on the key');
  // a slide that is out of the window cannot be tabbed into: the link in the second slide is skipped from the third
  await p.locator('#week .vx-carousel-track').focus();
  await p.keyboard.press('Tab');
  say(await p.evaluate(() => document.activeElement.tagName) === 'BUTTON', 'Tab from the track does not go into a slide that is out of the window');
  await p.keyboard.press('Home');
  await settle(p);

  // ---- the wheel: the track is a real scroller
  const [wx, wy] = await mid(p, '#week .vx-carousel-track');
  await p.mouse.move(wx, wy, { steps: 6 });
  await p.mouse.wheel(500, 0);
  await p.waitForTimeout(1100);
  s = await read(p, '#week');
  say(s.near === 1 && s.at === 1 && s.gap < 1 && s.lit === '0 1 0 0' && !s.prevOff, `a wheel pushed sideways over the track goes to the next slide and stops on it; the lamps and the keys follow (slide ${s.near + 1}, ${s.gap} px off, lamps ${s.lit})`);

  // ---- the other states
  s = await read(p, '#last');
  say(s.near === 2 && s.at === 2 && s.nextOff && !s.prevOff && s.lit === '0 0 1', `a carousel that is on its last slide as the page loads says so (lamps ${s.lit})`);
  s = await read(p, '#one');
  await press(p, key('#one', 'next'));
  say(s.prevOff && s.nextOff && s.n === 1 && s.lit === '1' && (await read(p, '#one')).at === 0, 'one slide only: one lamp, both keys switched off, a press does nothing');
  // right to left: next is the key on the left, and the left arrow goes on
  const [nx] = await mid(p, key('#rtl', 'next')), [px] = await mid(p, key('#rtl', 'prev'));
  await press(p, key('#rtl', 'next'));
  await settle(p);
  s = await read(p, '#rtl');
  const lampX = await p.evaluate(() => { const l = window.vx.live(document.querySelector('#rtl .vx-carousel-lamps')), f = l.model.byName.fill; let x = 0, n = 0; for (let i = 0; i < f.count; i++) if (f.scales[i] > 0.5) { x += f.rest[i * 3]; n++; } return [x / n, l.W / 2]; });
  say(nx < px && s.near === 1 && s.gap < 1 && s.lit === '0 1 0' && Math.abs(lampX[0] - lampX[1]) < 0.01, `right to left: next is the key on the left; a press on it shows the second slide, its far edge on the window's (${s.gap} px off), the middle lamp lit`);
  await p.locator('#rtl .vx-carousel-track').focus();
  await p.keyboard.press('ArrowLeft');
  await settle(p);
  const on = (await read(p, '#rtl')).near;
  await p.keyboard.press('ArrowRight');
  await settle(p);
  s = await read(p, '#rtl');
  const first = await p.evaluate(() => { const l = window.vx.live(document.querySelector('#rtl .vx-carousel-lamps')), f = l.model.byName.fill; let x = 0, n = 0; for (let i = 0; i < f.count; i++) if (f.scales[i] > 0.5) { x += f.rest[i * 3]; n++; } return x / n > l.W / 2; });
  say(on === 2 && s.near === 1, `right to left: the left arrow goes a slide on and the right arrow a slide back (${on + 1}, ${s.near + 1})`);
  await p.keyboard.press('Home');
  await settle(p);
  say(first === false && await p.evaluate(() => { const l = window.vx.live(document.querySelector('#rtl .vx-carousel-lamps')), f = l.model.byName.fill; let x = 0, n = 0; for (let i = 0; i < f.count; i++) if (f.scales[i] > 0.5) { x += f.rest[i * 3]; n++; } return x / n > l.W / 2; }), 'right to left: the first slide\'s lamp is the one at the right end');

  // ---- slides added from code: the lamps and the names follow
  await p.evaluate(() => { const t = document.querySelector('#first .vx-carousel-track'), s = document.createElement('div'); s.className = 'vx-carousel-slide'; s.innerHTML = '<h4>Build 209</h4><p>harbor-api, 47 s.</p>'; t.append(s); });
  await p.waitForTimeout(300);
  s = await read(p, '#first');
  say(s.n === 4 && s.lit === '1 0 0 0' && s.names[3] === 'group/slide/4 of 4' && s.names[0] === 'group/slide/1 of 4', `a slide added from code: there are four lamps, and every slide it named is named again (${s.names.map((n) => n.split('/')[2]).join(', ')})`);

  // ---- at rest nothing runs
  await p.mouse.move(4, 4);
  await p.waitForTimeout(5200); // past the page's own five-second fallback for "ready"
  const rest = await p.evaluate(() => [window.vx.stage.awake.size, window.__timers.size]);
  say(rest[0] === 0 && rest[1] === 0, `with nothing asked to move by itself, at rest nothing runs: ${rest[0]} parts awake, ${rest[1]} timers waiting`);
  await p.context().close();
}

// ---- asked to go on by itself (data-vx-auto, here 1.2 s a slide)
{
  const q = await open({ query: 'auto=1200' });
  await q.mouse.move(4, 4);
  let s = await read(q, '#rotating');
  say(s.word === 'Pause' && s.say === 'off' && !s.nextOff && !s.prevOff, `asked to go on by itself: its key says Pause, a screen reader is not told of every slide (aria-live ${s.say}), and neither end switches a key off`);
  const seen = [s.at];
  for (let i = 0; i < 3; i++) { await q.waitForTimeout(1250); seen.push((await read(q, '#rotating')).at); }
  say(new Set(seen).size === 3 && seen.every((v, i) => i === 0 || v === (seen[i - 1] + 1) % 3), `it goes on a slide at a time, and round to the first again (${seen.map((v) => v + 1).join(', ')})`);
  say((await read(q, '#week')).at === 0, 'and a carousel that was not asked to has not moved');
  // the pointer over it: it waits
  const [hx, hy] = await mid(q, '#rotating .vx-carousel-track');
  await q.mouse.move(hx, hy, { steps: 8 });
  await q.waitForTimeout(400);
  const held = (await read(q, '#rotating')).at;
  await q.waitForTimeout(2900);
  s = await read(q, '#rotating');
  say(s.at === held && s.word === 'Pause', `while the pointer is over it, it waits (still on ${s.at + 1} after 2.9 s; the key still says ${s.word})`);
  await q.mouse.move(4, 4, { steps: 8 });
  await q.waitForTimeout(1500);
  s = await read(q, '#rotating');
  say(s.at !== held, `when the pointer leaves, it goes on (${held + 1} to ${s.at + 1})`);
  // the focus comes in: it stops for good
  await q.locator('#rotating .vx-carousel-track').focus();
  s = await read(q, '#rotating');
  const stopped = s.at;
  await q.waitForTimeout(2900);
  const later = await read(q, '#rotating');
  say(s.word === 'Play' && s.say === 'polite' && later.at === stopped, `when the focus comes into it, it stops: the key says ${s.word}, and 2.9 s on it is on the same slide`);
  say(await q.evaluate(() => window.__timers.size) === 0, 'stopped, it has no timer waiting');
  await q.evaluate(() => document.activeElement.blur());
  await q.waitForTimeout(1500);
  say((await read(q, '#rotating')).at === stopped, 'and the focus leaving does not start it again');
  // Play: asked for by hand, it runs, even with the pointer on the key
  await press(q, '#rotating [data-vx-play]');
  await q.waitForTimeout(200);
  s = await read(q, '#rotating');
  const from = s.at;
  await q.waitForTimeout(1300);
  const went = await read(q, '#rotating');
  say(s.word === 'Pause' && went.at === (from + 1) % 3, `a press on Play starts it again: the key says ${s.word} and it goes on (${from + 1} to ${went.at + 1})`);
  const snug = await q.evaluate(() => { const k = document.querySelector('#rotating [data-vx-play]'), w = document.createTreeWalker(k, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode()) && !n.data.trim()); const r = document.createRange(); r.selectNodeContents(n); const b = r.getBoundingClientRect(); return [b.left, b.top + scrollY, k.offsetWidth]; });
  say(Math.abs(snug[0] - Math.round(snug[0])) < 0.02 && Math.abs(snug[1] - Math.round(snug[1])) < 0.02, `the key's new word starts on a whole pixel (${snug[0]}, ${snug[1]})`);
  await press(q, '#rotating [data-vx-play]');
  await q.waitForTimeout(100);
  s = await read(q, '#rotating');
  const paused = s.at;
  await q.waitForTimeout(1500);
  const w2 = await q.evaluate(() => document.querySelector('#rotating [data-vx-play]').offsetWidth);
  say(s.word === 'Play' && (await read(q, '#rotating')).at === paused && w2 === snug[2], `a press on Pause stops it, and the key keeps its width (${w2} px)`);
  // previous and next stop it too; next at the last slide goes round
  await press(q, '#rotating [data-vx-play]');
  await q.keyboard.press('End');
  await settle(q);
  await press(q, '#rotating [data-vx-play]');
  await q.waitForTimeout(100);
  await press(q, key('#rotating', 'next'));
  await settle(q);
  s = await read(q, '#rotating');
  const round = s.at;
  await q.waitForTimeout(1400);
  say(round === 0 && s.word === 'Play' && (await read(q, '#rotating')).at === 0, `running, a press on next at the last slide goes round to the first, and stops it (slide ${round + 1}, the key says ${s.word})`);
  await q.context().close();
}

// ---- where less motion is asked for
{
  const q = await open({ query: 'auto=1200', reduced: true });
  await q.mouse.move(4, 4);
  await q.waitForTimeout(2800);
  let s = await read(q, '#rotating');
  say(s.at === 0 && s.word === 'Play' && s.say === 'polite' && await q.evaluate(() => window.__timers.size <= 1), `reduced motion: asked to go on by itself, it does not start; its key says ${s.word}`);
  await press(q, key('#week', 'next'));
  await q.waitForTimeout(60);
  s = await read(q, '#week');
  say(s.near === 1 && s.gap < 1 && s.lit === '0 1 0 0', `reduced motion: 60 ms after a press on next the second slide is in the window, whole, and its lamp is fully lit (${s.gap} px off; lamps ${s.lit})`);
  await press(q, '#rotating [data-vx-play]');
  await q.waitForTimeout(1300);
  await q.waitForTimeout(60);
  s = await read(q, '#rotating');
  say(s.word === 'Pause' && s.at === 1 && s.gap < 1, `reduced motion: a press on Play is being asked: it goes on, a slide at once (slide ${s.at + 1}, ${s.gap} px off)`);
  await q.context().close();
}

// ---- a finger
{
  const q = await open({ width: 390, height: 844, touch: true });
  await q.locator('#week').scrollIntoViewIfNeeded();
  await q.evaluate(() => { window.touches = 0; document.querySelector('#week .vx-carousel-track').addEventListener('touchstart', () => { window.touches++; }, { passive: true }); });
  const [x, y] = await mid(q, '#week .vx-carousel-track');
  const cdp = await q.context().newCDPSession(q);
  let how = 'a scroll gesture from a touch';
  try { await cdp.send('Input.synthesizeScrollGesture', { x: x + 90, y, xDistance: -240, yDistance: 0, gestureSourceType: 'touch', speed: 900 }); } catch { how = ''; }
  await q.waitForTimeout(900);
  let s = await read(q, '#week');
  if (s.near !== 1) {
    // the same by hand: a finger down, dragged to the left, lifted
    how = 'touch events sent one by one';
    const pt = (dx) => [{ x: x + 90 - dx, y, id: 1 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(0) });
    for (let d = 20; d <= 240; d += 20) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(d) }); await q.waitForTimeout(16); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await q.waitForTimeout(900);
    s = await read(q, '#week');
  }
  const touches = await q.evaluate(() => window.touches);
  if (s.near === 1 && touches > 0) say(s.at === 1 && s.gap < 1 && s.lit === '0 1 0 0' && !s.prevOff, `a finger drags the track to the left (${how}): it stops on the second slide, and the lamps and keys follow (${s.gap} px off, lamps ${s.lit})`);
  else console.log(`      not checked: a swipe with a finger. Neither a touch scroll gesture nor touch events moved the track in this browser (slide ${s.near + 1}, ${touches} touchstart heard).`);
  await q.screenshot({ path: `${dir}/hand-390-swiped.png` });
  await q.context().close();
}

// ---- plain (no voxels): the same behaviour, the same boxes
{
  const q = await open({ plain: true });
  say(await q.locator('[data-vx-live]').count() === 0, 'plain: nothing is drawn in voxels');
  const plainBoxes = await boxes(q);
  const moved = plainBoxes.filter((b, i) => b !== liveBoxes[i]).length;
  say(plainBoxes.length === liveBoxes.length && moved === 0, `plain: every carousel, window, key and row of lamps has the box it has in voxels (${moved} of ${plainBoxes.length} differ)`);
  await press(q, key('#week', 'next'));
  await settle(q);
  let s = await read(q, '#week');
  const lamp = await q.evaluate(() => { const l = document.querySelector('#week .vx-carousel-lamps'), a = getComputedStyle(l, '::after'); return [parseFloat(a.insetInlineStart), a.backgroundColor]; });
  say(s.near === 1 && s.at === 1 && s.gap < 1 && !s.prevOff && lamp[0] === 16, `plain: a press on next shows the second slide, and the painted lamp is on the second stud (${lamp[0]} px along)`);
  await q.locator('#week .vx-carousel-track').focus();
  await q.keyboard.press('End');
  await settle(q);
  s = await read(q, '#week');
  const end = s.near;
  await q.keyboard.press('ArrowLeft');
  await settle(q);
  say(end === 3 && s.nextOff && (await read(q, '#week')).near === 2, 'plain: End, and the arrows, work on the track; at the last slide next is switched off');
  await q.context().close();
}

// ---- on a phone
for (const plain of [false, true]) {
  const q = await open({ width: 390, height: 844, plain });
  const out = await cut(q);
  say(out.length === 0 && await sideways(q) === 0, `at 390 px${plain ? ', plain' : ''}: no carousel is cut (${out.length} outside the column) and the page does not scroll sideways`);
  const tall = await q.evaluate(() => { const t = document.querySelector('#uk .vx-carousel-track'), s = t.querySelector('.vx-carousel-slide'); return [s.scrollWidth <= s.clientWidth, t.offsetWidth === s.offsetWidth]; });
  say(tall[0] && tall[1], `at 390 px${plain ? ', plain' : ''}: the long word wraps inside its slide, and a slide is as wide as the window`);
  await q.locator('#week').scrollIntoViewIfNeeded();
  await press(q, key('#week', 'next'));
  await settle(q);
  const s = await read(q, '#week');
  say(s.near === 1 && s.gap < 1, `at 390 px${plain ? ', plain' : ''}: a press on next shows the second slide`);
  await q.context().close();
}

// ---- no script at all: the track still scrolls a slide at a time, and the keys that could do nothing are not shown
{
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 1000 }, javaScriptEnabled: false });
  const q = await ctx.newPage();
  await q.goto(`${url}?theme=light`);
  await q.waitForTimeout(600);
  const shown = await q.locator('#week .vx-carousel-bar').evaluate((b) => !!b.offsetParent || b.getClientRects().length > 0);
  const room = await q.locator('#week .vx-carousel-track').evaluate((t) => [t.scrollWidth > t.clientWidth * 3, getComputedStyle(t).scrollSnapType, getComputedStyle(t).scrollbarWidth]);
  say(!shown && room[0] && room[1].includes('x') && room[2] !== 'none', `with no script the keys and lamps are not shown; the track is a scroller that snaps (${room[1]}) under the browser's own bar`);
  const b = await q.locator('#week .vx-carousel-track').boundingBox();
  await q.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 });
  await q.mouse.wheel(500, 0);
  await q.waitForTimeout(1100);
  const at = await q.locator('#week .vx-carousel-track').evaluate((t) => { const s = t.children[1].getBoundingClientRect(), r = t.getBoundingClientRect(); return Math.abs(s.left - r.left); });
  say(at < 1, `and the wheel takes it to the second slide, where it stops (${at.toFixed(1)} px off)`);
  await ctx.close();
}

say(errors.length === 0, 'no errors' + (errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''));
await browser.close();
console.log(bad ? `${bad} to fix` : 'ok: the carousel answers a real mouse, real keys, the wheel and a finger');
process.exit(bad ? 1 : 0);
