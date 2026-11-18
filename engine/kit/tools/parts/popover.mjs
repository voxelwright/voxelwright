// A person at the popover's page: a real mouse and real keys. Says ok or FAIL for each thing that
// must hold, and shoots the first frames after a press.
//   PORT=5989 node tools/parts/popover.mjs
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const port = process.env.PORT || 5989;
const url = `http://127.0.0.1:${port}/kit/showcase/parts/popover.html?theme=light&hand`;
const dir = 'shots/parts/popover';
await mkdir(dir, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
let bad = 0;
const say = (ok, what) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); };

async function visit({ width = 1180, height = 900, plain = false, reduced = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  if (plain) await p.addInitScript(() => { new MutationObserver((_, o) => { if (document.documentElement) { document.documentElement.setAttribute('data-vx-plain', ''); o.disconnect(); } }).observe(document, { childList: true }); });
  await p.goto(url);
  await p.waitForFunction(() => document.documentElement.dataset.ready === '1');
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(600);
  const rect = (sel) => p.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; }, sel);
  const open = (sel) => p.evaluate((s) => document.querySelector(s).matches(':popover-open'), sel);
  const attr = (sel, a) => p.evaluate(([s, n]) => document.querySelector(s).getAttribute(n), [sel, a]);
  const focus = () => p.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);
  const press = async (sel) => { const r = await rect(sel); await p.mouse.move(r.left + r.width / 2, r.top + r.height / 2, { steps: 6 }); await p.mouse.down(); await p.waitForTimeout(70); await p.mouse.up(); };
  return { p, ctx, errors, rect, open, attr, focus, press };
}

// ---- drawn in voxels, on a laptop
{
  const { p, ctx, errors, rect, open, attr, focus, press } = await visit();
  say(await attr('#rename-key', 'aria-expanded') === 'false' && !(await open('#rename')), 'at rest it is closed, and its key says so');

  // count how often it is measured and made again while it opens: once, or its assembly is cut short
  await p.evaluate(() => { const l = window.vx.live(document.querySelector('#rename')), make = l.rebuild.bind(l), play = l.play.bind(l); window.made = 0; window.played = []; l.rebuild = () => { window.made++; make(); }; l.play = (effect, parts, opts) => { window.played.push([effect, opts?.from]); return play(effect, parts, opts); }; });
  await press('#rename-key');
  await p.waitForTimeout(30);
  const first = await p.evaluate(() => { const l = window.vx.live(document.querySelector('#rename')); const kids = [...document.querySelectorAll('#rename .vx-button, #rename .vx-well')].map((n) => window.vx.live(n)); return { drawn: !!l && l.visible && !l.dirty, kids: kids.every((k) => k && k.visible && k.cssW > 8 && !k.dirty), building: l.model.parts.some((q) => q.fx) }; });
  say(await open('#rename'), 'a press on its key opens it');
  say(first.drawn && first.kids, `30 ms after the press its slab is drawn, and the keys and the well inside it (${JSON.stringify(first)})`);
  const played = await p.evaluate(() => window.played);
  say(played.length === 1 && played[0][0] === 'assemble' && played[0][1][0] === 0 && played[0][1][1] === 0, `and it is built out of the corner nearest its key (${JSON.stringify(played)})`);
  await p.screenshot({ path: `${dir}/hand-open-030ms.png`, clip: { x: 300, y: 150, width: 560, height: 420 } });
  say(await attr('#rename-key', 'aria-expanded') === 'true', 'its key says it is open (aria-expanded)');
  let k = await rect('#rename-key'), f = await rect('#rename');
  say(Math.abs(f.left - k.left) < 1 && f.top > k.bottom && f.top - k.bottom < 30, `it is under its key, their near edges in line (key ${k.left},${k.bottom}; popover ${f.left},${f.top})`);
  say(await focus() === 'rename-input', 'the thing in it marked autofocus has the focus');
  await p.waitForTimeout(100);
  await p.screenshot({ path: `${dir}/hand-open-130ms.png`, clip: { x: 300, y: 150, width: 560, height: 420 } });
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${dir}/hand-open.png`, clip: { x: 300, y: 150, width: 560, height: 420 } });
  const still = await p.evaluate(() => { const l = window.vx.live(document.querySelector('#rename')); return !l.model.parts.some((q) => q.fx) && !l.stage.awake.has(l); });
  say(still, 'half a second on it is built and at rest: nothing runs');
  say(await p.evaluate(() => window.made) === 1, `it was measured and made once as it opened (${await p.evaluate(() => window.made)})`);

  // typing, and Enter (the page's own code closes it): the focus goes back to the key
  await p.keyboard.press('ControlOrMeta+a');
  await p.keyboard.type('harbor-core', { delay: 15 });
  await p.keyboard.press('Enter');
  await p.waitForTimeout(250);
  say(!(await open('#rename')) && await p.evaluate(() => document.querySelector('#service-name').textContent) === 'harbor-core', 'typing a name and Enter renames, and closes it');
  say(await focus() === 'rename-key' && await attr('#rename-key', 'aria-expanded') === 'false', 'the focus is back on its key, which says it is closed');

  // by keyboard: Enter on the key opens, Escape closes, the focus goes back
  await p.keyboard.press('Enter');
  await p.waitForTimeout(350);
  say(await open('#rename') && await focus() === 'rename-input', 'Enter on the key opens it');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(200);
  say(!(await open('#rename')) && await focus() === 'rename-key', 'Escape closes it and gives the focus back to its key');
  await p.keyboard.press('Space');
  await p.waitForTimeout(350);
  say(await open('#rename'), 'Space on the key opens it');
  // Tab goes through what is in it, and out of it: then it closes
  await p.keyboard.press('Tab');
  const t1 = await p.evaluate(() => document.activeElement.textContent.trim());
  await p.keyboard.press('Tab');
  const t2 = await focus();
  say(t1 === 'Cancel' && t2 === 'rename-save' && await open('#rename'), `Tab moves through what is in it (${t1}, ${t2})`);
  await p.keyboard.press('Tab');
  await p.waitForTimeout(200);
  say(!(await open('#rename')), `Tab out of it closes it (the focus is on ${await focus()})`);

  // a press outside closes it; the key inside that only closes it does so
  await press('#rename-key');
  await p.waitForTimeout(350);
  await p.mouse.move(1000, 700, { steps: 6 }); await p.mouse.down(); await p.mouse.up();
  await p.waitForTimeout(200);
  say(!(await open('#rename')) && await attr('#rename-key', 'aria-expanded') === 'false', 'a press outside closes it');
  await press('#rename-key');
  await p.waitForTimeout(350);
  await press('#rename [popovertargetaction="hide"]');
  await p.waitForTimeout(200);
  say(!(await open('#rename')), 'its Cancel key closes it');
  await press('#rename-key');
  await p.waitForTimeout(300);
  await press('#rename-key');
  await p.waitForTimeout(200);
  say(!(await open('#rename')), 'a second press on its key closes it');

  // above its key where it is asked to be; lined up at the far edge where it is asked to be
  await p.locator('#held-key').scrollIntoViewIfNeeded();
  await press('#held-key');
  await p.waitForTimeout(400);
  k = await rect('#held-key'); f = await rect('#held');
  say(await open('#held') && f.bottom < k.top && k.top - f.bottom < 20, `data-vx-side="top": it is over its key (popover ends ${f.bottom}, key starts ${k.top})`);
  await p.mouse.move(1000, 300, { steps: 6 }); await p.mouse.down(); await p.mouse.up();
  await p.waitForTimeout(200);
  say(await open('#held'), 'popover="manual": a press outside leaves it open');
  await p.locator('#held [popovertargetaction="hide"]').focus();
  await p.keyboard.press('Tab');
  await p.waitForTimeout(200);
  say(await open('#held'), 'popover="manual": Tab out of it leaves it open too');
  // the page moves under it: it stays by its key
  const before = await rect('#held');
  const was = await p.evaluate(() => scrollY);
  await p.mouse.wheel(0, -60);
  await p.waitForTimeout(250);
  k = await rect('#held-key'); f = await rect('#held');
  const moved = await p.evaluate(() => scrollY) - was;
  say(moved !== 0 && f.top !== before.top && (Math.abs(k.top - f.bottom - 8) < 2 || (f.top > k.bottom && f.top - k.bottom < 30)), `when the page scrolls (${moved} px) it stays by its key (key ${k.top} to ${k.bottom}, popover ${f.top} to ${f.bottom})`);
  await press('#held [popovertargetaction="hide"]');
  await p.waitForTimeout(200);
  say(!(await open('#held')), 'its Close key closes it');
  await press('#end-key');
  await p.waitForTimeout(400);
  k = await rect('#end-key'); f = await rect('#end');
  say(await open('#end') && Math.abs(f.right - k.right) < 1, `data-vx-align="end": their far edges are in line (${f.right}, ${k.right})`);
  await p.keyboard.press('Escape');
  say(errors.length === 0, 'no errors' + (errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''));
  await ctx.close();
}

// ---- on a phone: nothing is cut and the page does not move sideways
{
  const { p, ctx, errors, rect, open, press } = await visit({ width: 390, height: 844 });
  for (const [key, pop] of [['#rename-key', '#rename'], ['#closed-key', '#closed'], ['#held-key', '#held'], ['#end-key', '#end']]) {
    await p.locator(key).scrollIntoViewIfNeeded();
    await press(key);
    await p.waitForTimeout(400);
    const f = await rect(pop), sx = await p.evaluate(() => { scrollTo(200, scrollY); const x = scrollX; scrollTo(0, scrollY); return x; });
    say(await open(pop) && f.left >= 0 && f.right <= 390 && f.top >= 0 && f.bottom <= 844 && sx === 0, `390 px: ${pop} is inside the window (${f.left} to ${f.right} across, ${f.top} to ${f.bottom} down) and the page does not scroll sideways`);
    if (pop === '#held') await p.screenshot({ path: `${dir}/hand-390.png` });
    if (pop === '#held') await press('#held [popovertargetaction="hide"]'); else await p.keyboard.press('Escape');
    await p.waitForTimeout(150);
  }
  say(errors.length === 0, '390 px: no errors' + (errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''));
  await ctx.close();
}

// ---- reduced motion: it is there at once, nothing travels
{
  const { p, ctx, errors, rect, open, press } = await visit({ reduced: true });
  await press('#rename-key');
  await p.waitForTimeout(30);
  const a = await rect('#rename');
  const travel = await p.evaluate(() => { const l = window.vx.live(document.querySelector('#rename')); let far = 0; let n = 0; for (const q of l.model.parts) for (let i = 0; i < q.count; i++, n++) far = Math.max(far, Math.abs(l.pos[n * 8 + 2] - (q.rest[i * 3 + 2] + q.tz))); return far; });
  await p.waitForTimeout(400);
  const b = await rect('#rename');
  say(await open('#rename') && a.top === b.top && a.left === b.left && travel < 0.01, `reduced motion: it opens in its place and no voxel travels (furthest from rest: ${travel.toFixed(3)} voxels)`);
  say(errors.length === 0, 'reduced motion: no errors' + (errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''));
  await ctx.close();
}

// ---- plain (no voxels): the same behaviour
{
  const { p, ctx, errors, rect, open, attr, focus, press } = await visit({ plain: true });
  say(await p.evaluate(() => document.querySelectorAll('[data-vx-live]').length) === 0, 'plain: nothing is drawn in voxels');
  await press('#rename-key');
  await p.waitForTimeout(200);
  const k = await rect('#rename-key'), f = await rect('#rename');
  // (a plain key that is held down is painted a voxel up and left of where it was)
  say(await open('#rename') && Math.abs(f.left - k.left) < 5 && f.top > k.bottom && f.top - k.bottom < 30 && await attr('#rename-key', 'aria-expanded') === 'true', `plain: a press opens it under its key, and the key says so (key ${k.left},${k.bottom}; popover ${f.left},${f.top})`);
  await p.screenshot({ path: `${dir}/hand-plain.png`, clip: { x: 300, y: 150, width: 560, height: 420 } });
  await p.keyboard.press('Escape');
  await p.waitForTimeout(150);
  say(!(await open('#rename')) && await focus() === 'rename-key' && await attr('#rename-key', 'aria-expanded') === 'false', 'plain: Escape closes it and gives the focus back');
  say(errors.length === 0, 'plain: no errors' + (errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''));
  await ctx.close();
}

// ---- with no script at all, on a phone: the browser's own popover, in the middle of the window
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, javaScriptEnabled: false });
  const p = await ctx.newPage();
  await p.goto(url);
  await p.waitForTimeout(500);
  const key = await p.locator('#rename-key').boundingBox();
  await p.mouse.move(key.x + key.width / 2, key.y + key.height / 2, { steps: 6 }); await p.mouse.down(); await p.waitForTimeout(70); await p.mouse.up();
  await p.waitForTimeout(300);
  const f = await p.locator('#rename').boundingBox();
  say(!!f && f.x >= 0 && f.x + f.width <= 390 && f.y >= 0 && f.y + f.height <= 844, `no script: a press on its key opens it, inside the window on all four sides (${f ? `${f.x} to ${f.x + f.width} across, ${f.y} to ${f.y + f.height} down` : 'not shown'})`);
  await p.screenshot({ path: `${dir}/hand-noscript-390.png` });
  await p.keyboard.press('Escape');
  await p.waitForTimeout(200);
  say(await p.locator('#rename').boundingBox() === null, 'no script: Escape closes it');
  await ctx.close();
}

await browser.close();
console.log(bad ? `${bad} to fix` : 'ok: the popover answers a real mouse and real keys');
process.exit(bad ? 1 : 0);
