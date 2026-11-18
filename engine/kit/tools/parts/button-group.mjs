// A person on the button group's page: a real mouse and real keys. The group is only how its
// keys sit together, so this is mostly a ruler. Says ok or FAIL for each thing that must hold;
// exit 1 on a failure.
//   PORT=5989 node tools/parts/button-group.mjs
import { chromium } from 'playwright';

const port = process.env.PORT || 5989;
const url = `http://127.0.0.1:${port}/kit/showcase/parts/button-group.html`;
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
let bad = 0;
const say = (ok, what) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); };
const errors = [];

async function open({ plain = false, width = 1180 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
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
const press = async (p, sel) => { const [x, y] = await mid(p, sel); await p.mouse.move(x, y, { steps: 6 }); await p.mouse.down(); await p.waitForTimeout(90); await p.mouse.up(); };
const said = (p) => p.evaluate(() => document.getElementById('said').textContent);
// the gaps between the keys of a group, across and down, in px; and whether any key is cut by the page
const gaps = (p, sel) => p.evaluate((s) => {
  const keys = [...document.querySelector(s).children].map((k) => k.getBoundingClientRect());
  const out = { across: [], down: [], rows: new Set(keys.map((k) => k.top)).size, cut: keys.some((k) => k.right > innerWidth || k.left < 0) };
  for (let i = 1; i < keys.length; i++) { if (keys[i].top === keys[i - 1].top) out.across.push(keys[i].left - keys[i - 1].right); else out.down.push(keys[i].top - keys[i - 1].bottom); }
  return out;
}, sel);

const p = await open();
const groups = await p.evaluate(() => [...document.querySelectorAll('.vx-button-group')].map((g) => [g.getAttribute('role'), g.getAttribute('aria-label')]));
say(groups.every(([r, n]) => r === 'group' && n), `every group is a group with a name (${groups.map((g) => g[1]).join(', ')})`);
let g = await gaps(p, '[aria-label="Review"]');
say(g.across.join() === '12,12' && g.rows === 1, `its keys are three voxels apart, the least that keeps each cap's side clear of the key before it (${g.across.join(', ')} px)`);
g = await gaps(p, '[aria-label="Move"]');
const widths = await p.evaluate(() => [...document.querySelector('[aria-label="Move"]').children].map((k) => k.offsetWidth));
say(g.down.join() === '12,12' && new Set(widths).size === 1, `standing, they are three voxels apart and all as wide as the widest (${g.down.join(', ')} px; ${widths.join(', ')} px wide)`);
say(await p.evaluate(() => [...document.querySelectorAll('.vx-button-group .vx-button')].every((k) => window.vx.live(k)?.def.name === 'button')), 'each key is the kit\'s own, drawn by the kit\'s button');

// each is still a key of its own: a real mouse, real keys
await press(p, '#undo');
say(await said(p) === '2 changes since the last draft', `a press on Undo undoes one: "${await said(p)}"`);
await p.waitForTimeout(300);
say(await p.evaluate(() => !document.getElementById('redo').disabled && !window.vx.live(document.getElementById('redo')).state.off), 'and Redo, beside it, is switched on and stands up');
await press(p, '#redo');
say(await said(p) === '3 changes since the last draft' && await p.evaluate(() => document.getElementById('redo').disabled), 'a press on Redo puts it back, and Redo is off again');
await press(p, '#redo');
say(await said(p) === '3 changes since the last draft', 'a key that is off does nothing under a press');
await p.focus('#undo');
await p.keyboard.press('Tab');
say(await p.evaluate(() => document.activeElement.id) === 'publish', 'Tab passes over the key that is off, and goes on to the next group');
await p.keyboard.press('Tab');
say(await p.evaluate(() => document.activeElement.id) === 'draft', 'Tab again: each key is a tab stop of its own');
await p.keyboard.press('Enter');
say(await said(p) === 'Draft saved', `Enter presses the key in focus: "${await said(p)}"`);
await p.mouse.move(4, 4);
await p.waitForTimeout(900);
say(await p.evaluate(() => window.vx.stage.awake.size) === 0, 'at rest nothing runs');
await p.context().close();

// ---- on a phone: the row wraps, nothing is cut
for (const plain of [false, true]) {
  const q = await open({ width: 390, plain });
  const w = await gaps(q, '[lang="uk"]');
  const side = await q.evaluate(() => { scrollTo(200, 0); const m = scrollX; scrollTo(0, 0); return m; });
  say(w.rows > 1 && !w.cut && w.down.every((d) => d === 12) && side === 0, `at 390 px${plain ? ', plain' : ''}: the long row wraps to ${w.rows} rows three voxels apart, no key is cut, and the page does not move sideways`);
  await q.context().close();
}
// ---- plain
{
  const q = await open({ plain: true });
  const k = await gaps(q, '[aria-label="Review"]');
  await press(q, '#undo');
  say(k.across.join() === '12,12' && await said(q) === '2 changes since the last draft', 'plain: the same gaps, and the keys still press');
  await q.context().close();
}

say(errors.length === 0, 'no errors' + (errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''));
await browser.close();
process.exit(bad ? 1 : 0);
