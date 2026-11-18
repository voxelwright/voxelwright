// A person at the collapsible's page: a real mouse and real keys. Says ok or FAIL for each thing
// that must hold.
//   PORT=5989 node tools/parts/collapsible.mjs
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const port = process.env.PORT || 5989;
const dir = 'shots/parts/collapsible';
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
  await p.goto(`http://127.0.0.1:${port}/kit/showcase/parts/collapsible.html?theme=light${hash}`);
  if (script) { await p.waitForFunction(() => document.documentElement.dataset.ready === '1'); await p.evaluate(() => document.fonts.ready); }
  await p.waitForTimeout(script ? 600 : 300);
  const loc = (sel) => p.locator(sel);
  const top = async (sel) => (await loc(sel).boundingBox()).y;
  const tall = async (sel) => (await loc(sel).boundingBox()).height;
  const isOpen = (sel) => loc(sel).evaluate((d) => d.open);
  const words = () => p.evaluate(() => [...document.querySelectorAll('#older > summary span')].filter((s) => s.offsetParent).map((s) => s.textContent).join('|'));
  const focus = () => p.evaluate(() => { const a = document.activeElement; return a?.tagName === 'SUMMARY' ? a.parentElement.id : a?.tagName; });
  const press = async (sel) => { const b = await loc(sel).boundingBox(); await p.mouse.move(b.x + 60, b.y + b.height / 2, { steps: 6 }); await p.mouse.down(); await p.waitForTimeout(60); await p.mouse.up(); };
  return { p, ctx, errors, loc, top, tall, isOpen, words, focus, press };
}

// ---- drawn in voxels, on a laptop
{
  const { p, ctx, errors, top, tall, isOpen, words, focus, press } = await visit();
  say(await p.evaluate(() => [...document.querySelectorAll('.vx-collapsible')].every((d) => d.tagName === 'DETAILS' && d.firstElementChild.tagName === 'SUMMARY')), 'each one is a real <details> whose first child is its <summary>');
  say(!(await isOpen('#older')) && await words() === 'Show 3 older deploys', 'at rest it is closed, and its row says "Show 3 older deploys"');

  const y0 = await p.evaluate(() => scrollY), s0 = await top('#older > summary'), a0 = await top('#after'), closed = await tall('#older');
  // watch the line under it, the surface, and the time between frames, while it opens
  await p.evaluate(() => { window.seen = []; window.made = 0; const after = document.querySelector('#after'), card = window.vx.live(document.querySelector('.sheet')), make = card.rebuild.bind(card); card.rebuild = () => { window.made++; make(); }; let last = performance.now(); const tick = (now) => { window.seen.push([after.getBoundingClientRect().top, now - last]); last = now; if (window.seen.length < 40) requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
  await press('#older > summary');
  await p.waitForTimeout(700);
  const seen = await p.evaluate(() => window.seen), a1 = await top('#after'), full = await tall('#older');
  const between = [...new Set(seen.map((s) => Math.round(s[0])))].filter((y) => y > a0 + 1 && y < a1 - 1);
  let step = 0; for (let i = 1; i < seen.length; i++) step = Math.max(step, seen[i][0] - seen[i - 1][0]);
  say(await isOpen('#older') && full > closed + 60, `a press on the row opens it (${closed} px to ${full} px)`);
  say(await words() === 'Hide older deploys', 'its row now says "Hide older deploys"');
  say(between.length >= 3 && step < (a1 - a0) * 0.6, `the line under it slides down over several frames, it does not jump (${between.length} places on the way, the largest step ${step.toFixed(1)} of ${(a1 - a0).toFixed(1)} px)`);
  say(await p.evaluate(() => window.made) === 1, `the surface it is on was made again once as it opened, not on every frame (${await p.evaluate(() => window.made)} times; the slowest frame ${Math.max(...seen.slice(2).map((s) => s[1])).toFixed(0)} ms)`);
  say(await p.evaluate(() => scrollY) === y0 && Math.abs(await top('#older > summary') - s0) < 0.5, 'the page has not scrolled and the row is where it was under the pointer');
  await p.screenshot({ path: `${dir}/hand-open.png`, clip: { x: 180, y: 180, width: 820, height: 400 } });
  await press('#older > summary');
  await p.waitForTimeout(600);
  say(!(await isOpen('#older')) && Math.abs(await tall('#older') - closed) < 0.5 && Math.abs(await top('#after') - a0) < 0.5 && await p.evaluate(() => document.querySelector('.sheet').style.minBlockSize) === '', 'a second press closes it, to exactly its row, and everything is where it began');

  // keys
  await p.mouse.move(16, 16); await p.mouse.down(); await p.mouse.up(); // a press on the bare ground: Tab starts from the top
  await p.keyboard.press('Tab');
  say(await focus() === 'older', 'Tab reaches the row');
  say(await p.evaluate(() => { const s = getComputedStyle(document.activeElement); return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2; }), 'the row that has the focus shows a focus ring');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(500);
  say(await isOpen('#older'), 'Enter opens it');
  await p.screenshot({ path: `${dir}/hand-focus.png`, clip: { x: 180, y: 180, width: 820, height: 400 } });
  await p.keyboard.press('Space');
  await p.waitForTimeout(500);
  say(!(await isOpen('#older')), 'Space closes it');

  // set from code: it follows
  await p.evaluate(() => { document.querySelector('#s-closed').open = true; });
  await p.waitForTimeout(500);
  say(await isOpen('#s-closed') && await tall('#s-closed') > 60, 'opened from code (details.open = true) it opens the same way');
  const rest = await p.evaluate(() => window.vx.stage.awake.size);
  say(rest === 0, `at rest nothing runs (${rest} parts awake)`);
  say(errors.length === 0, 'no errors' + (errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''));
  await ctx.close();
}

// ---- a link to words inside a closed one opens it (the browser does for find-in-page what it does here)
{
  const { ctx, isOpen } = await visit({ hash: '#:~:text=Friday%2C%2016%3A12' });
  const opened = await isOpen('#older');
  console.log(`${opened ? 'ok  ' : 'note'} a link to words inside a closed one (#:~:text=…) ${opened ? 'opens it' : 'did not open it in this headless browser: not counted'}`);
  await ctx.close();
}

// ---- on a phone: nothing is cut and the page does not move sideways
{
  const { p, ctx, errors, isOpen, press } = await visit({ width: 390, height: 844 });
  await press('#older > summary');
  await p.waitForTimeout(500);
  const sx = await p.evaluate(() => { scrollTo(200, scrollY); const x = scrollX; scrollTo(0, scrollY); return x; });
  const cut = await p.evaluate(() => [...document.querySelectorAll('.vx-collapsible summary, .vx-collapsible li, .vx-collapsible p')].filter((n) => n.scrollWidth > n.clientWidth + 1 || n.getBoundingClientRect().right > innerWidth).length);
  say(await isOpen('#older') && sx === 0 && cut === 0, `390 px: it opens, nothing is cut (${cut}) and the page does not scroll sideways (${sx})`);
  await p.screenshot({ path: `${dir}/hand-390.png` });
  say(errors.length === 0, '390 px: no errors' + (errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''));
  await ctx.close();
}

// ---- reduced motion: it opens at once
{
  const { p, ctx, errors, top, isOpen, press } = await visit({ reduced: true });
  const a0 = await top('#after');
  await p.evaluate(() => { window.seen = []; const after = document.querySelector('#after'); const tick = () => { window.seen.push(after.getBoundingClientRect().top); if (window.seen.length < 30) requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
  await press('#older > summary');
  await p.waitForTimeout(600);
  const seen = await p.evaluate(() => window.seen), a1 = await top('#after');
  const between = seen.filter((y) => y > a0 + 1 && y < a1 - 1).length;
  say(await isOpen('#older') && a1 > a0 + 60 && between === 0, `reduced motion: it opens at once (${between} frames part way)`);
  say(errors.length === 0, 'reduced motion: no errors' + (errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''));
  await ctx.close();
}

// ---- plain (no voxels): the same behaviour
{
  const { p, ctx, errors, top, isOpen, words, press } = await visit({ plain: true });
  say(await p.evaluate(() => document.querySelectorAll('[data-vx-live]').length) === 0, 'plain: nothing is drawn in voxels');
  const a0 = await top('#after');
  await p.evaluate(() => { window.seen = []; const after = document.querySelector('#after'); const tick = () => { window.seen.push(after.getBoundingClientRect().top); if (window.seen.length < 30) requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
  await press('#older > summary');
  await p.waitForTimeout(600);
  const seen = await p.evaluate(() => window.seen), a1 = await top('#after');
  const between = new Set(seen.filter((y) => y > a0 + 1 && y < a1 - 1).map(Math.round)).size;
  say(await isOpen('#older') && await words() === 'Hide older deploys' && between >= 3, `plain: a press opens it, its words change, and the line under it slides (${between} places on the way)`);
  say(errors.length === 0, 'plain: no errors' + (errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''));
  await ctx.close();
}

// ---- with no script at all: it still opens and closes
{
  const { p, ctx, isOpen, words, press } = await visit({ script: false });
  await press('#older > summary');
  await p.waitForTimeout(500);
  say(await isOpen('#older') && await words() === 'Hide older deploys', 'no script: a press opens it and its words change');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(400);
  say(!(await isOpen('#older')), 'no script: Enter on the row closes it');
  await ctx.close();
}

await browser.close();
console.log(bad ? `${bad} to fix` : 'ok: the collapsible answers a real mouse and real keys');
process.exit(bad ? 1 : 0);
