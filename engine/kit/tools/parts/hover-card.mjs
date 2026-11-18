// A person at the hover card's page: a real mouse and real keys. Says ok or FAIL for each thing
// that must hold.
//   PORT=5989 node tools/parts/hover-card.mjs
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const port = process.env.PORT || 5989;
const dir = 'shots/parts/hover-card';
await mkdir(dir, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
let bad = 0;
const say = (ok, what) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); };

async function visit({ width = 1180, height = 900, plain = false, reduced = false, touch = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion: reduced ? 'reduce' : 'no-preference', hasTouch: touch });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  if (plain) await p.addInitScript(() => { new MutationObserver((_, o) => { if (document.documentElement) { document.documentElement.setAttribute('data-vx-plain', ''); o.disconnect(); } }).observe(document, { childList: true }); });
  await p.goto(`http://127.0.0.1:${port}/kit/showcase/parts/hover-card.html?theme=light&hand`);
  await p.waitForFunction(() => document.documentElement.dataset.ready === '1');
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(600);
  const rect = (sel) => p.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; }, sel);
  const open = (sel) => p.evaluate((s) => document.querySelector(s).matches(':popover-open'), sel);
  const focus = () => p.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);
  const onto = async (sel, fx = 0.5, fy = 0.5) => { const r = await rect(sel); await p.mouse.move(r.left + r.width * fx, r.top + r.height * fy, { steps: 6 }); };
  const away = () => p.mouse.move(16, 16, { steps: 6 }); // the bare ground, beside the sheet
  return { p, ctx, errors, rect, open, focus, onto, away };
}

// ---- drawn in voxels, on a laptop
{
  const { p, ctx, errors, rect, open, focus, onto, away } = await visit();
  say(await p.evaluate(() => [...document.querySelectorAll('.vx-hover-card')].every((c) => { const t = document.querySelector(`[data-vx-card="${c.id}"]`); return t && t.matches('a[href]') && document.querySelector(t.hash) && !c.matches(':popover-open'); })), 'at rest every card is closed, and its trigger is a real link to what the card shows');

  // it waits a little, then opens under its link
  await p.clock.install();
  await p.clock.pauseAt(Date.now() + 1000);
  await onto('#l-mina');
  await p.clock.runFor(150);
  say(!(await open('#c-mina')), 'the pointer comes to rest on a link: 150 ms on, no card yet');
  await p.evaluate(() => { const l = window.vx.live(document.querySelector('#c-mina')), make = l.rebuild.bind(l); window.made = 0; l.rebuild = () => { window.made++; make(); }; });
  await p.clock.runFor(330);
  const first = await p.evaluate(() => { const l = window.vx.live(document.querySelector('#c-mina')); const lamp = window.vx.live(document.querySelector('#c-mina .vx-lamp')); return { open: l.el.matches(':popover-open'), drawn: l.visible && l.cssW > 20, lamp: !!lamp && lamp.visible, building: l.model.parts.some((q) => q.fx) }; });
  say(first.open && first.drawn && first.lamp, `after a short wait (480 ms) it is open, drawn in voxels, the lamp in it too (${JSON.stringify(first)})`);
  let k = await rect('#l-mina'), f = await rect('#c-mina');
  say(Math.abs(f.left - k.left) < 1 && f.top > k.bottom && f.top - k.bottom < 30, `it is under its link, their near edges in line (link ${k.left},${k.bottom}; card ${f.left},${f.top})`);
  await p.clock.runFor(400);
  await p.screenshot({ path: `${dir}/hand-open.png`, clip: { x: 200, y: 180, width: 620, height: 320 } });
  say(await p.evaluate(() => window.made) === 1, `it was measured and made once as it opened (${await p.evaluate(() => window.made)})`);

  // the pointer travels from the link into the card, stopping in the gap between them on the way
  await p.mouse.move(k.left + 20, (k.bottom + f.top) / 2, { steps: 4 });
  await p.clock.runFor(120);
  const gap = await open('#c-mina');
  await p.mouse.move(f.left + 60, f.top + 40, { steps: 6 });
  await p.clock.runFor(700);
  say(gap && await open('#c-mina'), 'the pointer travels from the link, across the gap (a stop of 120 ms there), into the card: it stays open');
  // what is in it can be used: the link in the card is under the pointer
  await onto('#c-mina-link');
  say(await p.evaluate(() => document.querySelector('#c-mina-link').matches(':hover')), 'the link inside the card can be reached by the pointer');
  await away();
  await p.clock.runFor(120);
  const lingering = await open('#c-mina');
  await p.clock.runFor(400);
  say(lingering && !(await open('#c-mina')), 'the pointer leaves: it waits a little (still open at 120 ms), then closes');

  await p.clock.resume();
  // Escape
  await onto('#l-ada');
  await p.waitForTimeout(550);
  say(await open('#c-ada'), 'on another link its card opens');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(80);
  say(!(await open('#c-ada')), 'Escape closes it');
  await p.waitForTimeout(600);
  say(!(await open('#c-ada')), 'and it stays closed while the pointer rests there');
  await away();
  await p.waitForTimeout(350);

  // by keyboard: focus opens it after the wait, Tab goes into it, Tab out closes it
  await p.mouse.down(); await p.mouse.up(); // a press on the bare ground: Tab starts from the top of the page
  await p.keyboard.press('Tab');
  await p.waitForTimeout(150);
  const early = await open('#c-mina');
  await p.clock.runFor(400);
  await p.clock.resume();
  say(await focus() === 'l-mina' && !early && await open('#c-mina'), 'Tab to the link: after the short wait its card opens');
  await p.screenshot({ path: `${dir}/hand-focus.png`, clip: { x: 200, y: 180, width: 620, height: 320 } });
  await p.keyboard.press('Tab');
  await p.waitForTimeout(400);
  say(await focus() === 'c-mina-link' && await open('#c-mina'), 'Tab again: the focus is on the link inside the card, and the card stays open');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(80);
  say(!(await open('#c-mina')) && await focus() === 'l-mina', 'Escape closes it and puts the focus back on its link');
  await p.waitForTimeout(600);
  say(!(await open('#c-mina')), 'and the card does not open again by itself');
  await p.keyboard.press('Tab'); // to the next link (the card is closed, so what is in it is passed over)
  await p.waitForTimeout(550);
  say(await focus() === 'l-ada' && await open('#c-ada'), 'Tab goes on to the next link, and its card opens');
  await p.keyboard.press('Tab');
  await p.keyboard.press('Tab');
  await p.waitForTimeout(450);
  say(!(await open('#c-ada')), `Tab through it and out: it closes (the focus is on ${await focus()})`);
  // one at a time: the focus holds one card open, the pointer asks for another
  say(await focus() === 'l-up' && await open('#c-up'), 'the link the focus went on to has its card open');
  await onto('#l-mina');
  await p.waitForTimeout(550);
  say(await open('#c-mina') && !(await open('#c-up')), 'the pointer rests on another link: its card opens and the first closes (one at a time)');
  await p.evaluate(() => document.activeElement.blur());
  await away();
  await p.waitForTimeout(400);

  // the link itself leads there
  await onto('#l-mina');
  await p.waitForTimeout(550);
  await p.mouse.down(); await p.waitForTimeout(50); await p.mouse.up();
  await p.waitForTimeout(250);
  say(!(await open('#c-mina')) && await p.evaluate(() => location.hash) === '#mina', 'a press on the link follows it (the address ends in #mina) and the card goes');
  await p.waitForTimeout(700);
  say(!(await open('#c-mina')), 'and it does not come back while the pointer rests on the link');

  // over its link where it is asked to be; the page moves under it and it stays by its link
  await p.locator('#l-up').scrollIntoViewIfNeeded();
  await away();
  await p.waitForTimeout(300);
  await onto('#l-up');
  await p.waitForTimeout(600);
  k = await rect('#l-up'); f = await rect('#c-up');
  say(await open('#c-up') && f.bottom < k.top && k.top - f.bottom < 20, `data-vx-side="top": it is over its link (card ends ${f.bottom}, link starts ${k.top})`);
  await away();
  await p.waitForTimeout(500);
  const rest = await p.evaluate(() => window.vx.stage.awake.size);
  say(rest === 0, `with nothing open, nothing runs (${rest} parts awake)`);
  say(errors.length === 0, 'no errors' + (errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''));
  await ctx.close();
}

// ---- in a phone-wide window: nothing is cut and the page does not move sideways
{
  const { p, ctx, errors, rect, open, onto, away } = await visit({ width: 390, height: 844 });
  for (const [link, card] of [['#l-mina', '#c-mina'], ['#l-ada', '#c-ada'], ['#l-up', '#c-up']]) {
    await p.locator(link).scrollIntoViewIfNeeded();
    await away();
    await p.waitForTimeout(350);
    await onto(link);
    await p.waitForTimeout(600);
    const f = await rect(card), sx = await p.evaluate(() => { scrollTo(200, scrollY); const x = scrollX; scrollTo(0, scrollY); return x; });
    say(await open(card) && f.left >= 0 && f.right <= 390 && sx === 0, `390 px: ${card} is inside the window (${f.left} to ${f.right}) and the page does not scroll sideways`);
    if (card === '#c-mina') await p.screenshot({ path: `${dir}/hand-390.png` });
  }
  say(errors.length === 0, '390 px: no errors' + (errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''));
  await ctx.close();
}

// ---- a finger has no hover: a tap follows the link, and no card gets in its way
{
  const { p, ctx, errors, rect, open } = await visit({ width: 390, height: 844, touch: true });
  const r = await rect('#l-mina');
  await p.touchscreen.tap(r.left + r.width / 2, r.top + r.height / 2);
  await p.waitForTimeout(700);
  say(!(await open('#c-mina')) && await p.evaluate(() => location.hash) === '#mina', 'a finger taps the link: it is followed, and no card opens');
  say(errors.length === 0, 'touch: no errors' + (errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''));
  await ctx.close();
}

// ---- reduced motion: it is there, and nothing travels
{
  const { p, ctx, errors, open, onto } = await visit({ reduced: true });
  await onto('#l-mina');
  await p.waitForTimeout(440);
  const travel = await p.evaluate(() => { const l = window.vx.live(document.querySelector('#c-mina')); let far = 0, n = 0; for (const q of l.model.parts) for (let i = 0; i < q.count; i++, n++) far = Math.max(far, Math.abs(l.pos[n * 8 + 2] - (q.rest[i * 3 + 2] + q.tz))); return far; });
  await p.waitForTimeout(200);
  say(await open('#c-mina') && travel < 0.01, `reduced motion: it opens and no voxel travels (furthest from rest: ${travel.toFixed(3)} voxels)`);
  say(errors.length === 0, 'reduced motion: no errors' + (errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''));
  await ctx.close();
}

// ---- plain (no voxels): the same behaviour
{
  const { p, ctx, errors, rect, open, onto, away } = await visit({ plain: true });
  say(await p.evaluate(() => document.querySelectorAll('[data-vx-live]').length) === 0, 'plain: nothing is drawn in voxels');
  await p.clock.install();
  await p.clock.pauseAt(Date.now() + 1000);
  await onto('#l-mina');
  await p.clock.runFor(150);
  const early = await open('#c-mina');
  await p.clock.runFor(400);
  const k = await rect('#l-mina'), f = await rect('#c-mina');
  say(!early && await open('#c-mina') && Math.abs(f.left - k.left) < 1 && f.top > k.bottom && f.top - k.bottom < 30, 'plain: it waits, then opens under its link');
  await p.screenshot({ path: `${dir}/hand-plain.png`, clip: { x: 200, y: 180, width: 620, height: 320 } });
  await p.mouse.move(f.left + 60, f.top + 40, { steps: 6 });
  await p.clock.runFor(600);
  say(await open('#c-mina'), 'plain: it stays open with the pointer in it');
  await away();
  await p.clock.runFor(450);
  say(!(await open('#c-mina')), 'plain: the pointer leaves and it closes');
  await p.clock.resume();
  say(errors.length === 0, 'plain: no errors' + (errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''));
  await ctx.close();
}

await browser.close();
console.log(bad ? `${bad} to fix` : 'ok: the hover card answers a real mouse and real keys');
process.exit(bad ? 1 : 0);
