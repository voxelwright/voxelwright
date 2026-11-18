// A person at the accordion's page: a real mouse and real keys. Says ok or FAIL for each thing
// that must hold.
//   PORT=5989 node tools/parts/accordion.mjs
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const port = process.env.PORT || 5989;
const dir = 'shots/parts/accordion';
await mkdir(dir, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
let bad = 0;
const say = (ok, what) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); };

async function visit({ width = 1180, height = 900, plain = false, reduced = false, script = true, hash = '' } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion: reduced ? 'reduce' : 'no-preference', javaScriptEnabled: script });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  if (plain) await p.addInitScript(() => { new MutationObserver((_, o) => { if (document.documentElement) { document.documentElement.setAttribute('data-vx-plain', ''); o.disconnect(); } }).observe(document, { childList: true }); });
  await p.goto(`http://127.0.0.1:${port}/kit/showcase/parts/accordion.html?theme=light${hash}`);
  if (script) { await p.waitForFunction(() => document.documentElement.dataset.ready === '1'); await p.evaluate(() => document.fonts.ready); }
  await p.waitForTimeout(script ? 600 : 300);
  const loc = (sel) => p.locator(sel);
  const top = async (sel) => (await loc(sel).boundingBox()).y;
  const tall = async (sel) => (await loc(sel).boundingBox()).height;
  const isOpen = (sel) => loc(sel).evaluate((d) => d.open);
  const focus = () => p.evaluate(() => { const a = document.activeElement; return a?.tagName === 'SUMMARY' ? a.parentElement.id : a?.tagName; });
  const press = async (sel) => { const b = await loc(sel).boundingBox(); await p.mouse.move(b.x + 60, b.y + b.height / 2, { steps: 6 }); await p.mouse.down(); await p.waitForTimeout(60); await p.mouse.up(); };
  return { p, ctx, errors, loc, top, tall, isOpen, focus, press };
}

// ---- drawn in voxels, on a laptop
{
  const { p, ctx, errors, loc, top, tall, isOpen, focus, press } = await visit();
  say(await p.evaluate(() => [...document.querySelectorAll('.vx-accordion > details')].every((d) => d.firstElementChild.tagName === 'SUMMARY')) && await p.evaluate(() => document.querySelectorAll('.vx-accordion > .vx-groove[data-vx-live]').length) === 4, 'every row is a real <details> with a <summary>, and the grooves between them are drawn in voxels');
  say(await isOpen('#faq-1') && !(await isOpen('#faq-2')) && !(await isOpen('#faq-3')), 'at rest the first row is open, as the markup says');

  // a row opens under the pointer; the row itself and the page stay where they are
  const y0 = await p.evaluate(() => scrollY), s0 = await top('#many-1 > summary'), closed = await tall('#many-1');
  // watch its height, and the time between frames, while it opens
  await p.evaluate(() => { window.seen = []; window.made = 0; const card = window.vx.live(document.querySelector('.sheet')), make = card.rebuild.bind(card); card.rebuild = () => { window.made++; make(); }; const d = document.querySelector('#many-1'); let last = performance.now(); const tick = (now) => { window.seen.push([d.getBoundingClientRect().height, now - last]); last = now; if (window.seen.length < 40) requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
  await press('#many-1 > summary');
  await p.waitForTimeout(700);
  const seen = await p.evaluate(() => window.seen), full = await tall('#many-1');
  const heights = [...new Set(seen.map((s) => Math.round(s[0])))], between = heights.filter((h) => h > closed + 1 && h < full - 1);
  let step = 0; for (let i = 1; i < seen.length; i++) step = Math.max(step, seen[i][0] - seen[i - 1][0]);
  const first = seen.findIndex(([height]) => height > closed), last = seen.findIndex(([height]) => height >= full - 0.01);
  const opening = first >= 0 && last >= first ? seen.slice(first, last + 1) : [];
  const slow = Math.max(0, ...opening.map((sample) => sample[1]));
  say(await isOpen('#many-1') && full > closed + 20, `a press on a row opens it (${closed} px to ${full} px)`);
  say(between.length >= 3 && step < (full - closed) * 0.6, `it opens over several frames, not in one jump (${between.length} heights on the way, the largest step ${step.toFixed(1)} of ${(full - closed).toFixed(1)} px; the slowest frame ${slow.toFixed(0)} ms)`);
  say(opening.length > 0 && slow < 40, `the slowest frame while the row opens is ${slow.toFixed(1)} ms (budget: under 40 ms)`);
  say(await p.evaluate(() => window.made) === 1, `the surface it is on was made again once as it opened, not on every frame (${await p.evaluate(() => window.made)} times)`);
  say(await p.evaluate(() => scrollY) === y0 && Math.abs(await top('#many-1 > summary') - s0) < 0.5, 'the page has not scrolled and the row is where it was under the pointer');
  say(await isOpen('#many-2') && await isOpen('#many-3'), 'with no name on the rows, the others stay open (several at a time)');
  const groove = await p.evaluate(() => { const g = document.querySelector('#many-1 + .vx-groove'), c = g.querySelector('canvas').getBoundingClientRect(), r = g.getBoundingClientRect(), pad = (c.height - r.height) / 2; return Math.abs(c.top + pad - r.top); });
  say(groove < 1, `the groove under it moved with the page, its voxels with it (${groove.toFixed(2)} px apart)`);
  await press('#many-1 > summary');
  await p.waitForTimeout(500);
  say(!(await isOpen('#many-1')) && Math.abs(await tall('#many-1') - closed) < 0.5 && await p.evaluate(() => document.querySelector('.sheet').style.minBlockSize) === '', 'a second press closes it, to exactly its row, and the surface is let go');

  // pressed again while it is still opening: it turns back, and the surface is let go
  await press('#many-1 > summary');
  await p.waitForTimeout(80);
  const part = await tall('#many-1');
  await press('#many-1 > summary');
  await p.waitForTimeout(700);
  const let1 = await p.evaluate(() => { const s = document.querySelector('.sheet').style; return s.minBlockSize + '|' + s.alignContent; });
  say(!(await isOpen('#many-1')) && Math.abs(await tall('#many-1') - closed) < 0.5 && let1 === '|', `pressed again part way open (${part.toFixed(0)} px), it closes to its row, and nothing is left on the surface ("${let1}")`);

  // one at a time: opening another closes the first
  await press('#faq-2 > summary');
  await p.waitForTimeout(600);
  say(await isOpen('#faq-2') && !(await isOpen('#faq-1')) && !(await isOpen('#faq-3')), 'rows that share a name: opening the second closes the first');
  await press('#faq-3 > summary');
  await p.waitForTimeout(600);
  say(await isOpen('#faq-3') && !(await isOpen('#faq-2')), 'and opening the third closes the second');
  const let2 = await p.evaluate(() => { const s = document.querySelector('.sheet').style; return s.minBlockSize + '|' + s.alignContent; });
  say(let2 === '|', `after one row closed as another opened, nothing is left on the surface ("${let2}")`);
  await p.screenshot({ path: `${dir}/hand-third.png`, clip: { x: 180, y: 200, width: 820, height: 420 } });

  // keys: Tab reaches the rows, Enter and Space open and close, arrows, Home and End move between rows
  await p.mouse.move(16, 16); await p.mouse.down(); await p.mouse.up(); // a press on the bare ground: Tab starts from the top
  await p.keyboard.press('Tab');
  say(await focus() === 'faq-1', 'Tab reaches the first row');
  const ring = await p.evaluate(() => { const s = getComputedStyle(document.activeElement); return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2; });
  say(ring, 'the row that has the focus shows a focus ring');
  await p.screenshot({ path: `${dir}/hand-focus.png`, clip: { x: 180, y: 200, width: 820, height: 420 } });
  await p.keyboard.press('Enter');
  await p.waitForTimeout(500);
  say(await isOpen('#faq-1') && !(await isOpen('#faq-3')), 'Enter opens it (and closes the one that was open)');
  await p.keyboard.press('Space');
  await p.waitForTimeout(500);
  say(!(await isOpen('#faq-1')), 'Space closes it');
  await p.keyboard.press('ArrowDown');
  say(await focus() === 'faq-2', 'Down moves to the next row');
  await p.keyboard.press('ArrowDown');
  await p.keyboard.press('ArrowDown');
  say(await focus() === 'faq-1', 'Down from the last row comes round to the first');
  await p.keyboard.press('ArrowUp');
  say(await focus() === 'faq-3', 'Up from the first goes to the last');
  await p.keyboard.press('Home');
  const home = await focus();
  await p.keyboard.press('End');
  say(home === 'faq-1' && await focus() === 'faq-3', 'Home and End go to the first and the last row');
  say(await p.evaluate(() => scrollY) === y0, 'the arrows did not scroll the page');
  await p.keyboard.press('Tab');
  say(await focus() === 'many-1', 'Tab leaves the accordion for the next one');

  // set from code: it follows
  await p.evaluate(() => { document.querySelector('#faq-2').open = true; });
  await p.waitForTimeout(500);
  say(await isOpen('#faq-2') && !(await isOpen('#faq-3')) && await tall('#faq-2') > 60, 'opened from code (details.open = true) it opens the same way');
  const rest = await p.evaluate(() => window.vx.stage.awake.size);
  say(rest === 0, `at rest nothing runs (${rest} parts awake)`);
  say(errors.length === 0, 'no errors' + (errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''));
  await ctx.close();
}

// ---- a link to words inside a closed row opens it (the browser does for find-in-page what it does here)
{
  const { p, ctx, isOpen } = await visit({ hash: '#:~:text=Mina%20and%20Ada%20are%20told' });
  const opened = await isOpen('#faq-3');
  console.log(`${opened ? 'ok  ' : 'note'} a link to words inside a closed row (#:~:text=…) ${opened ? 'opens that row' : 'did not open the row in this headless browser: not counted'}`);
  await ctx.close();
}

// ---- on a phone: nothing is cut and the page does not move sideways
{
  const { p, ctx, errors, isOpen, press } = await visit({ width: 390, height: 844 });
  for (const id of ['#faq-2', '#many-1']) { await p.locator(id).scrollIntoViewIfNeeded(); await press(`${id} > summary`); await p.waitForTimeout(500); }
  const sx = await p.evaluate(() => { scrollTo(200, scrollY); const x = scrollX; scrollTo(0, scrollY); return x; });
  const cut = await p.evaluate(() => [...document.querySelectorAll('.vx-accordion summary, .vx-accordion p')].filter((n) => n.scrollWidth > n.clientWidth + 1 || n.getBoundingClientRect().right > innerWidth).length);
  say(await isOpen('#faq-2') && await isOpen('#many-1') && sx === 0 && cut === 0, `390 px: rows open, nothing is cut (${cut}) and the page does not scroll sideways (${sx})`);
  await p.locator('#many').scrollIntoViewIfNeeded();
  await p.screenshot({ path: `${dir}/hand-390.png` });
  say(errors.length === 0, '390 px: no errors' + (errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''));
  await ctx.close();
}

// ---- reduced motion: it opens at once
{
  const { p, ctx, errors, tall, isOpen, press } = await visit({ reduced: true });
  const closed = await tall('#many-1');
  await p.evaluate(() => { window.seen = []; const d = document.querySelector('#many-1'); const tick = () => { window.seen.push(d.getBoundingClientRect().height); if (window.seen.length < 30) requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
  await press('#many-1 > summary');
  await p.waitForTimeout(600);
  const seen = await p.evaluate(() => window.seen), full = await tall('#many-1');
  const between = seen.filter((h) => h > closed + 1 && h < full - 1).length;
  say(await isOpen('#many-1') && full > closed + 20 && between === 0, `reduced motion: it opens at once (${between} frames part way)`);
  say(errors.length === 0, 'reduced motion: no errors' + (errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''));
  await ctx.close();
}

// ---- plain (no voxels): the same behaviour
{
  const { p, ctx, errors, isOpen, focus, press } = await visit({ plain: true });
  say(await p.evaluate(() => document.querySelectorAll('[data-vx-live]').length) === 0, 'plain: nothing is drawn in voxels');
  await press('#faq-2 > summary');
  await p.waitForTimeout(500);
  say(await isOpen('#faq-2') && !(await isOpen('#faq-1')), 'plain: a press opens a row and closes the other');
  await p.keyboard.press('ArrowDown');
  say(await focus() === 'faq-3', 'plain: Down moves to the next row');
  await p.keyboard.press('Home');
  say(await focus() === 'faq-1', 'plain: Home goes to the first');
  say(errors.length === 0, 'plain: no errors' + (errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''));
  await ctx.close();
}

// ---- with no script at all: it is still an accordion
{
  const { p, ctx, isOpen, press } = await visit({ script: false });
  await press('#faq-2 > summary');
  await p.waitForTimeout(500);
  say(await isOpen('#faq-2') && !(await isOpen('#faq-1')), 'no script: a press opens a row, and the one that was open closes');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(400);
  say(!(await isOpen('#faq-2')), 'no script: Enter on the row closes it');
  await ctx.close();
}

await browser.close();
console.log(bad ? `${bad} to fix` : 'ok: the accordion answers a real mouse and real keys');
process.exit(bad ? 1 : 0);
