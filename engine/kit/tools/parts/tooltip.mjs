// A person at the tooltip's page: a real mouse and real keys. Says ok or FAIL for each thing that
// must hold.
//   PORT=5989 node tools/parts/tooltip.mjs
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const port = process.env.PORT || 5989;
const dir = 'shots/parts/tooltip';
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
  await p.goto(`http://127.0.0.1:${port}/kit/showcase/parts/tooltip.html?theme=light&hand`);
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
  say(await p.evaluate(() => [...document.querySelectorAll('.vx-tooltip')].every((t) => t.id && document.querySelector(`[aria-describedby~="${t.id}"]`) && t.getAttribute('role') === 'tooltip' && !t.matches(':popover-open'))), 'at rest every tooltip is hidden, and tied to its trigger by aria-describedby');
  say(await p.evaluate(() => [...document.querySelectorAll('.vx-tooltip')].every((t) => !t.querySelector('a, button, input, select, textarea, [tabindex]'))), 'none holds anything that can be pressed');

  // the first one waits a moment
  await onto('#k-deploy');
  await p.waitForTimeout(150);
  say(!(await open('#t-deploy')), 'the pointer comes to rest on a key: 150 ms on, no tooltip yet');
  await p.waitForTimeout(450);
  say(await open('#t-deploy'), 'a moment later (600 ms) it is there');
  const first = await p.evaluate(() => { const l = window.vx.live(document.querySelector('#t-deploy')); return !!l && l.visible && l.cssW > 20; });
  say(first, 'and it is drawn in voxels at its own size');
  let k = await rect('#k-deploy'), f = await rect('#t-deploy');
  say(f.bottom <= k.top && k.top - f.bottom < 12 && Math.abs((f.left + f.right) / 2 - (k.left + k.right) / 2) < 1.5, `it is over its key, in the middle (key ${k.left} to ${k.right}, top ${k.top}; tooltip ${f.left} to ${f.right}, bottom ${f.bottom})`);
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${dir}/hand-open.png`, clip: { x: 300, y: 180, width: 560, height: 220 } });

  // none between neighbours
  await onto('#k-back');
  await p.waitForTimeout(60);
  say(await open('#t-back') && !(await open('#t-deploy')), 'on to its neighbour: that tooltip is there at once (60 ms) and the first has gone');
  await onto('#k-logs');
  await p.waitForTimeout(60);
  say(await open('#t-logs') && !(await open('#t-back')), 'and the next neighbour the same');

  // the pointer can go onto the words and they stay (they can be read, pointed at, selected by a magnifier)
  f = await rect('#t-logs');
  await p.mouse.move(f.left + f.width / 2, f.top + f.height / 2, { steps: 4 });
  await p.waitForTimeout(400);
  say(await open('#t-logs'), 'the pointer moves from the key onto the words: they stay');
  await away();
  await p.waitForTimeout(300);
  say(!(await open('#t-logs')), 'the pointer leaves: it goes');

  // long after, the wait is back
  await p.waitForTimeout(500);
  await onto('#k-deploy');
  await p.waitForTimeout(150);
  say(!(await open('#t-deploy')), 'a while later the first one waits again');
  await p.waitForTimeout(500);
  say(await open('#t-deploy'), 'and comes');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(80);
  say(!(await open('#t-deploy')), 'Escape hides it, though the pointer has not moved');
  await p.waitForTimeout(700);
  say(!(await open('#t-deploy')), 'and it stays away while the pointer rests there');
  await away();
  await p.waitForTimeout(400);

  // a press is the answer: the words go
  await onto('#k-back');
  await p.waitForTimeout(650);
  say(await open('#t-back'), 'on another key it comes again');
  await p.mouse.down(); await p.waitForTimeout(60);
  const gone = !(await open('#t-back'));
  await p.mouse.up();
  say(gone, 'pressing the key hides it');
  await away();
  await p.waitForTimeout(500);

  // by keyboard: focus shows it at once, Tab moves it on, Escape hides it and the focus stays
  await p.mouse.down(); await p.mouse.up(); // a press on the bare ground: Tab starts from the top of the page again
  await p.keyboard.press('Tab');
  await p.waitForTimeout(80);
  say(await focus() === 'k-deploy' && await open('#t-deploy'), 'Tab to the first key: its tooltip is there at once');
  await p.keyboard.press('Tab');
  await p.waitForTimeout(80);
  say(await focus() === 'k-back' && await open('#t-back') && !(await open('#t-deploy')), 'Tab again: the next key has its tooltip, the first has none');
  await p.screenshot({ path: `${dir}/hand-focus.png`, clip: { x: 300, y: 180, width: 560, height: 220 } });
  await p.keyboard.press('Escape');
  await p.waitForTimeout(80);
  say(!(await open('#t-back')) && await focus() === 'k-back', 'Escape hides it and the focus stays on the key');
  await p.keyboard.press('Tab');
  await p.waitForTimeout(80);
  await p.keyboard.press('Enter');
  await p.waitForTimeout(80);
  say(!(await open('#t-logs')) && await focus() === 'k-logs', 'Enter on a key (using it) hides its tooltip');
  await p.keyboard.press('Shift+Tab');
  await p.waitForTimeout(80);
  say(await open('#t-back'), 'Shift+Tab back: the tooltip of the key before is there');
  await p.evaluate(() => document.activeElement.blur());
  await p.waitForTimeout(80);
  say(!(await open('#t-back')), 'the focus leaves: it goes');

  // where it is asked to be, and at rest
  await onto('#s-below');
  await p.waitForTimeout(700);
  k = await rect('#s-below'); f = await rect('#ts-below');
  const gap = await p.evaluate(() => {
    const tip = window.vx.live(document.querySelector('#ts-below'));
    return (1.5 + tip.faceZ * 0.5) * tip.vx;
  });
  say(await open('#ts-below') && Math.abs(f.top - k.bottom - gap) <= 0.5, `data-vx-side="bottom": it is under its key (key ends ${k.bottom}, tooltip starts ${f.top})`);
  await away();
  await p.waitForTimeout(600);
  const rest = await p.evaluate(() => window.vx.stage.awake.size);
  say(rest === 0, `with nothing open, nothing runs (${rest} parts awake)`);
  say(errors.length === 0, 'no errors' + (errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''));
  await ctx.close();
}

// ---- on a phone-wide window: nothing is cut and the page does not move sideways
{
  const { p, ctx, errors, rect, open, onto } = await visit({ width: 390, height: 844 });
  for (const [key, tip] of [['#k-logs', '#t-logs'], ['#s-edge', '#ts-edge'], ['#s-long', '#ts-long']]) {
    await p.locator(key).scrollIntoViewIfNeeded();
    await p.mouse.move(5, 5);
    await p.waitForTimeout(450);
    await onto(key);
    await p.waitForTimeout(700);
    const f = await rect(tip), sx = await p.evaluate(() => { scrollTo(200, scrollY); const x = scrollX; scrollTo(0, scrollY); return x; });
    say(await open(tip) && f.left >= 0 && f.right <= 390 && sx === 0, `390 px: ${tip} is inside the window (${f.left} to ${f.right}, ${f.height} px tall) and the page does not scroll sideways`);
    if (tip === '#ts-long') await p.screenshot({ path: `${dir}/hand-390.png` });
  }
  say(errors.length === 0, '390 px: no errors' + (errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''));
  await ctx.close();
}

// ---- a finger: a tap is the press, no tooltip gets in its way
{
  const { p, ctx, errors, rect, open } = await visit({ width: 390, height: 844, touch: true });
  const r = await rect('#k-back');
  await p.touchscreen.tap(r.left + r.width / 2, r.top + r.height / 2);
  await p.waitForTimeout(800);
  say(!(await open('#t-back')), 'a finger taps a key: no tooltip opens');
  say(errors.length === 0, 'touch: no errors' + (errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''));
  await ctx.close();
}

// ---- reduced motion: it is there, and nothing travels
{
  const { p, ctx, errors, open, onto } = await visit({ reduced: true });
  await onto('#k-deploy');
  await p.waitForTimeout(540);
  const travel = await p.evaluate(() => { const l = window.vx.live(document.querySelector('#t-deploy')); let far = 0, n = 0; for (const q of l.model.parts) for (let i = 0; i < q.count; i++, n++) far = Math.max(far, Math.abs(l.pos[n * 8 + 2] - (q.rest[i * 3 + 2] + q.tz))); return far; });
  await p.waitForTimeout(200);
  say(await open('#t-deploy') && travel < 0.01, `reduced motion: it comes and no voxel travels (furthest from rest: ${travel.toFixed(3)} voxels)`);
  say(errors.length === 0, 'reduced motion: no errors' + (errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''));
  await ctx.close();
}

// ---- plain (no voxels): the same behaviour
{
  const { p, ctx, errors, rect, open, focus, onto, away } = await visit({ plain: true });
  say(await p.evaluate(() => document.querySelectorAll('[data-vx-live]').length) === 0, 'plain: nothing is drawn in voxels');
  await onto('#k-deploy');
  await p.waitForTimeout(150);
  const early = await open('#t-deploy');
  await p.waitForTimeout(500);
  const k = await rect('#k-deploy'), f = await rect('#t-deploy');
  say(!early && await open('#t-deploy') && f.bottom <= k.top && k.top - f.bottom < 12, 'plain: it waits, then is over its key');
  await p.screenshot({ path: `${dir}/hand-plain.png`, clip: { x: 300, y: 180, width: 560, height: 220 } });
  await onto('#k-back');
  await p.waitForTimeout(60);
  say(await open('#t-back') && !(await open('#t-deploy')), 'plain: its neighbour comes at once');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(80);
  say(!(await open('#t-back')), 'plain: Escape hides it');
  await away();
  await p.waitForTimeout(450);
  await p.mouse.down(); await p.mouse.up();
  await p.keyboard.press('Tab');
  await p.waitForTimeout(80);
  say(await focus() === 'k-deploy' && await open('#t-deploy'), 'plain: the focus shows it');
  say(errors.length === 0, 'plain: no errors' + (errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''));
  await ctx.close();
}

await browser.close();
console.log(bad ? `${bad} to fix` : 'ok: the tooltip answers a real mouse and real keys');
process.exit(bad ? 1 : 0);
