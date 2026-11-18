// A person at the date picker's page: a real mouse on its key and days, real keys in its float.
// Says ok or FAIL for each thing that must hold; exit 1 on a failure.
//   PORT=5989 node tools/parts/date-picker.mjs
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const port = process.env.PORT || 5989;
const url = `http://127.0.0.1:${port}/kit/showcase/parts/date-picker.html`;
const dir = 'shots/parts/date-picker';
await mkdir(dir, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
let bad = 0;
const say = (ok, what) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); };
const errors = [];

async function open({ plain = false, width = 1180, height = 1000 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, locale: 'en-GB' });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  if (plain) await p.addInitScript(() => { new MutationObserver((_, o) => { if (document.documentElement) { document.documentElement.setAttribute('data-vx-plain', ''); o.disconnect(); } }).observe(document, { childList: true }); });
  await p.goto(`${url}?theme=light`);
  await p.waitForFunction(() => document.documentElement.dataset.ready === '1');
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(500);
  return p;
}

const read = (p, id) => p.evaluate((id) => {
  const key = document.querySelector(`[popovertarget="${id}-pick"]`), float = document.getElementById(`${id}-pick`);
  const r = float.getBoundingClientRect(), k = key.getBoundingClientRect();
  return {
    open: float.matches(':popover-open'), expanded: key.getAttribute('aria-expanded'), name: key.getAttribute('aria-label'),
    focus: document.activeElement?.dataset?.vxDay ?? (document.activeElement === key ? 'key' : document.activeElement?.tagName),
    values: (float.querySelector('.vx-calendar').dataset.vxFor).split(' ').map((i) => document.getElementById(i).value),
    month: float.querySelector('.vx-calendar-month')?.textContent,
    box: [r.left, r.top, r.right, r.bottom].map(Math.round), below: r.top > k.bottom, inside: r.left >= 0 && r.right <= document.documentElement.clientWidth,
  };
}, id);
const mid = async (p, sel) => { const b = await p.locator(sel).first().boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
const press = async (p, sel, held = 60) => { const [x, y] = await mid(p, sel); await p.mouse.move(x, y, { steps: 5 }); await p.mouse.down(); await p.waitForTimeout(held); await p.mouse.up(); };
const key = (id) => `[popovertarget="${id}-pick"]`;

for (const plain of [false, true]) {
  const p = await open({ plain });
  const tag = plain ? 'plain: ' : '';
  let s = await read(p, 'ship');
  say(s.name === 'Choose the deploy day, Friday, 20 November 2026' && !s.open && s.expanded === 'false', `${tag}the key says what it does and the date it holds, in words ("${s.name}")`);
  if (!plain) say(await p.evaluate(() => !!window.vx.live(document.querySelector('#ship-date .vx-well')) && !!window.vx.live(document.querySelector('[popovertarget="ship-pick"]')) && !!window.vx.live(document.querySelector('#ship-pick'))), 'the well, the key and the float are the kit\'s own parts');

  // ---- a real mouse on the key
  await press(p, key('ship'));
  await p.waitForTimeout(250);
  s = await read(p, 'ship');
  say(s.open && s.expanded === 'true' && s.focus === '2026-11-20' && s.month === 'November 2026' && s.below && s.inside, `${tag}a press on the key opens the calendar under it, at the month of its date, with the focus on the chosen day (${s.focus}; ${s.box.join(' ')})`);
  if (!plain) {
    const weeks = await p.evaluate(() => [...document.querySelectorAll('#ship-pick .vx-calendar-week')].map((w) => window.vx.live(w)?.W ?? 0));
    say(weeks.every((w) => w === 77), `the weeks in the float are measured and drawn once it is open (${weeks.join(' ')} voxels wide)`);
    await p.waitForTimeout(400);
    await p.screenshot({ path: `${dir}/hand-open.png`, clip: { x: 200, y: 160, width: 520, height: 520 } });
  }
  await p.keyboard.press('ArrowRight');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(100);
  s = await read(p, 'ship');
  say(!s.open && s.values[0] === '2026-11-21' && s.focus === 'key' && s.name.endsWith('Saturday, 21 November 2026'), `${tag}an arrow and Enter choose the 21st: the float closes, the focus is back on the key, and the key says the new date (${s.values[0]})`);

  // ---- Enter on the key; Escape
  await p.keyboard.press('Enter');
  await p.waitForTimeout(150);
  const opened = (await read(p, 'ship')).open;
  await p.keyboard.press('Escape');
  await p.waitForTimeout(100);
  s = await read(p, 'ship');
  say(opened && !s.open && s.focus === 'key' && s.values[0] === '2026-11-21', `${tag}Enter on the key opens it; Escape closes it with nothing changed, and the focus is on the key`);

  // ---- a press on a day; a press outside
  await press(p, key('ship'));
  await p.waitForTimeout(200);
  await press(p, '#ship-pick [data-vx-day="2026-11-26"]');
  await p.waitForTimeout(100);
  s = await read(p, 'ship');
  say(!s.open && s.values[0] === '2026-11-26', `${tag}a press on a day chooses it and closes the float (${s.values[0]})`);
  await press(p, key('ship'));
  await p.waitForTimeout(200);
  await p.mouse.click(1100, 900);
  await p.waitForTimeout(100);
  say(!(await read(p, 'ship')).open, `${tag}a press outside closes it`);

  // ---- typing: the browser's own, and the calendar follows
  await p.locator('#ship').focus();
  await p.keyboard.type('03012027'); // the order of the fields is the browser's: either way it is a day early in 2027
  await p.waitForTimeout(100);
  s = await read(p, 'ship');
  await press(p, key('ship'));
  await p.waitForTimeout(200);
  const typed = await read(p, 'ship');
  const want = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(Date.parse(s.values[0] || 0));
  say(/^2027-0[13]-0[13]$/.test(s.values[0]) && typed.month === want && typed.focus === s.values[0], `${tag}a date typed into the input: the calendar opens at it (${s.values[0]}, ${typed.month})`);
  await p.keyboard.press('Escape');

  // ---- a range: open, two days, then it closes
  await press(p, key('freeze'));
  await p.waitForTimeout(200);
  await press(p, '#freeze-pick [data-vx-day="2026-12-21"]');
  await p.waitForTimeout(100);
  const half = await read(p, 'freeze');
  await press(p, '#freeze-pick [data-vx-day="2026-12-31"]');
  await p.waitForTimeout(100);
  s = await read(p, 'freeze');
  say(half.open && half.values.join() === '2026-12-21,' && !s.open && s.values.join() === '2026-12-21,2026-12-31' && s.name.includes('Monday, 21 December 2026 – Thursday, 31 December 2026'), `${tag}a range stays open after its start and closes after its end (${s.values.join(' to ')})`);

  // ---- fixed: the key opens nothing
  await press(p, key('locked'));
  await p.waitForTimeout(150);
  say(!(await read(p, 'locked')).open && await p.evaluate(() => document.querySelector('[popovertarget="locked-pick"]').getAttribute('aria-disabled')) === 'true', `${tag}an input that cannot be changed: its key is switched off and opens nothing`);
  await p.context().close();
}

// ---- on a phone
for (const plain of [false, true]) {
  const q = await open({ width: 390, height: 844, plain });
  const side = await q.evaluate(() => { scrollTo(200, scrollY); const x = scrollX; scrollTo(0, scrollY); return x; });
  await press(q, key('ship'));
  await q.waitForTimeout(300);
  const s = await read(q, 'ship');
  say(side === 0 && s.open && s.inside, `at 390 px${plain ? ', plain' : ''}: the page does not scroll sideways, and the open float is inside the window (${s.box.join(' ')})`);
  if (!plain) await q.screenshot({ path: `${dir}/hand-390-open.png` });
  await q.context().close();
}

// ---- no script: the browser's own date input, and no key
{
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 1000 }, javaScriptEnabled: false });
  const q = await ctx.newPage();
  await q.goto(`${url}?theme=light`);
  await q.waitForTimeout(400);
  const s = await q.evaluate(() => { const k = document.querySelector('[popovertarget="ship-pick"]'), i = document.getElementById('ship'); return [k.getClientRects().length, i.type, i.offsetWidth > 0]; });
  say(s[0] === 0 && s[1] === 'date' && s[2], 'with no script the key is not shown and the input is the browser\'s own date input');
  await ctx.close();
}

say(errors.length === 0, 'no errors' + (errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''));
await browser.close();
console.log(bad ? `${bad} to fix` : 'ok: the date picker answers a real mouse and real keys');
process.exit(bad ? 1 : 0);
