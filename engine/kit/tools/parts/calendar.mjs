// A person at the calendar's page: a real mouse on its days and keys, real keys in its grid.
// Says ok or FAIL for each thing that must hold; exit 1 on a failure.
//   PORT=5989 node tools/parts/calendar.mjs
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const port = process.env.PORT || 5989;
const url = `http://127.0.0.1:${port}/showcase/parts/calendar.html`;
const dir = 'shots/parts/calendar';
await mkdir(dir, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
let bad = 0;
const say = (ok, what) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); };
const errors = [];

async function open({ plain = false, width = 1180, height = 1000 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
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

// what a calendar says about itself
const read = (p, id) => p.evaluate((id) => {
  const el = document.querySelector(id), cells = [...el.querySelectorAll('[role="gridcell"]')];
  const day = (c) => c.firstElementChild.dataset.vxDay;
  return {
    month: el.querySelector('.vx-calendar-month').textContent,
    values: [...el.querySelectorAll('input')].map((i) => i.value),
    stop: cells.filter((c) => c.firstElementChild.tabIndex === 0).map(day),
    focus: document.activeElement?.dataset?.vxDay ?? null,
    marks: cells.filter((c) => c.dataset.vxMark).map((c) => `${day(c).slice(8)}:${c.dataset.vxMark}`).join(' '),
    selected: cells.filter((c) => c.getAttribute('aria-selected') === 'true').length,
    names: [...el.querySelectorAll('[role="columnheader"]')].map((n) => n.textContent),
  };
}, id);
const day = (id, iso) => `${id} [data-vx-day="${iso}"]`;
const mid = async (p, sel) => { const b = await p.locator(sel).first().boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
const press = async (p, sel, held = 60) => { const [x, y] = await mid(p, sel); await p.mouse.move(x, y, { steps: 5 }); await p.mouse.down(); await p.waitForTimeout(held); await p.mouse.up(); };
// the row live that holds a day, and what its model has in it
const drawn = (p, id, iso) => p.evaluate(([id, iso]) => {
  const row = document.querySelector(`${id} [data-vx-day="${iso}"]`).closest('.vx-calendar-week'), l = window.vx.live(row);
  if (!l) return null;
  const b = l.model.byName;
  return { block: b.block?.count ?? 0, lit: b.lit?.count ?? 0, well: !!l.well, collar: b.collar?.count ?? 0, lamp: b.lamp?.count ?? 0 };
}, [id, iso]);
const boxes = (q) => q.evaluate(() => [...document.querySelectorAll('.vx-calendar, .vx-calendar-head > *, .vx-calendar-cell')].map((e) => { const r = e.getBoundingClientRect(); return [r.x, r.y + scrollY, r.width, r.height].map(Math.round).join(' '); }));

// ---- drawn in voxels, on a laptop
const p = await open();
const liveBoxes = await boxes(p);
{
  let s = await read(p, '#deploy');
  const shape = await p.evaluate(() => { const g = document.querySelector('#deploy [role="grid"]'); return [g.querySelectorAll(':scope > [role="row"]').length, g.querySelectorAll('[role="gridcell"] > button').length, document.querySelector('#deploy input').hidden, g.getAttribute('aria-labelledby') === document.querySelector('#deploy .vx-calendar-month').id, document.querySelector('#deploy .vx-calendar-month').getAttribute('aria-live')]; });
  say(shape[0] === 7 && shape[1] === 42 && shape[2] && shape[3] && shape[4] === 'polite', `a grid named by its month (read out when it changes): a row of day names and six weeks of seven real buttons; the input is kept, hidden (${shape.join(', ')})`);
  say(s.month === 'November 2026' && s.stop.join() === '2026-11-20' && s.marks === '20:one' && s.selected === 1, `at rest it shows the month of its value, the chosen day is the one tab stop and is selected (${s.month}; ${s.marks})`);
  say(s.names.join(' ') === 'Mon Tue Wed Thu Fri Sat Sun' && (await read(p, '#us')).names[0] === 'Sun' && (await read(p, '#uk')).names.join(' ') === 'пн вт ср чт пт сб нд', `the week begins where the page's language begins it: en-GB ${s.names[0]}, en-US ${(await read(p, '#us')).names[0]}, uk ${(await read(p, '#uk')).names[0]}`);
  say(await p.evaluate(() => !!window.vx.live(document.querySelector('#deploy .vx-calendar-week')) && !!window.vx.live(document.querySelector('#deploy [data-vx-step="next"]'))), 'its weeks are drawn by this part, its keys by the kit\'s own');
  let d = await drawn(p, '#deploy', '2026-11-20');
  say(d?.well && d.block > 0 && d.lit === 0, `the week of the chosen day has a seat cut in it and a key standing in the seat (${JSON.stringify(d)})`);
  d = await drawn(p, '#empty', '2026-11-17');
  say(d && !d.well && d.collar > 0 && d.lamp > 0, `today, with nothing chosen: a lamp in a steel collar under its number (${JSON.stringify(d)})`);
  say(await p.evaluate(() => document.querySelector('#deploy [data-vx-day="2026-11-17"]').getAttribute('aria-current')) === 'date', 'today is aria-current="date"');

  // ---- a real mouse on a day
  const changes = await p.evaluate(() => { window.changed = []; document.getElementById('deploy-day').addEventListener('change', (e) => window.changed.push(e.target.value)); });
  await press(p, day('#deploy', '2026-11-24'));
  await p.waitForTimeout(30);
  s = await read(p, '#deploy');
  d = await drawn(p, '#deploy', '2026-11-24');
  say(s.values[0] === '2026-11-24' && s.marks === '24:one' && d?.well && d.block > 0, `30 ms after a press on the 24th it is chosen, and its week has the key in its seat (${s.values[0]}; ${s.marks})`);
  say((await p.evaluate(() => window.changed)).join() === '2026-11-24' && (await p.textContent('#deploy-said')).includes('Tuesday 24 November'), 'the input sent `change` once, and the page heard it');
  d = await drawn(p, '#deploy', '2026-11-20');
  say(d && !d.well && d.block === 0, 'the week it left has no seat now');
  await p.screenshot({ path: `${dir}/hand-chosen.png`, clip: { x: 250, y: 220, width: 420, height: 400 } });

  // ---- real keys
  await p.keyboard.press('ArrowRight');
  s = await read(p, '#deploy');
  say(s.focus === '2026-11-25' && s.stop.join() === '2026-11-25', `the right arrow goes a day on, and the tab stop with it (${s.focus})`);
  await p.keyboard.press('ArrowDown');
  s = await read(p, '#deploy');
  say(s.focus === '2026-12-02' && s.month === 'December 2026', `the down arrow goes a week on, into the next month, which is shown (${s.focus}, ${s.month})`);
  await p.keyboard.press('PageUp');
  s = await read(p, '#deploy');
  say(s.focus === '2026-11-17' && s.month === 'November 2026', `Page Up goes a month back, and stops at the first day that can be chosen (${s.focus})`);
  await p.keyboard.press('ArrowUp');
  s = await read(p, '#deploy');
  say(s.focus === '2026-11-17', `so do the arrows (${s.focus})`);
  await p.keyboard.press('Shift+PageDown');
  s = await read(p, '#deploy');
  say(s.focus === '2027-02-28' && s.month === 'February 2027', `Shift and Page Down go a year on, but no further than the last day that can be chosen (${s.focus})`);
  await p.keyboard.press('PageUp'); await p.keyboard.press('PageUp');
  await p.keyboard.press('End');
  const end = (await read(p, '#deploy')).focus;
  await p.keyboard.press('Home');
  s = await read(p, '#deploy');
  say(end === '2027-01-03' && s.focus === '2026-12-28', `End goes to the week's last day (Sunday here, in the next month) and Home back to its first (${end}, ${s.focus})`);
  await p.keyboard.press('Enter');
  s = await read(p, '#deploy');
  say(s.values[0] === '2026-12-28' && s.marks === '28:one' && s.focus === '2026-12-28', `Enter chooses the day in focus, and the focus stays on it (${s.values[0]})`);
  await p.keyboard.press('ArrowLeft');
  await p.keyboard.press('Space');
  s = await read(p, '#deploy');
  say(s.values[0] === '2026-12-27', `Space chooses too (${s.values[0]})`);
  await p.keyboard.press('Shift+Tab');
  say(await p.evaluate(() => document.activeElement.dataset.vxStep) === 'next', 'Shift+Tab goes from the grid to the next-month key');
  await p.keyboard.press('Enter');
  s = await read(p, '#deploy');
  const after = s.month;
  await press(p, '#deploy [data-vx-step="prev"]');
  await press(p, '#deploy [data-vx-step="prev"]');
  s = await read(p, '#deploy');
  const prevOff = await p.evaluate(() => document.querySelector('#deploy [data-vx-step="prev"]').getAttribute('aria-disabled'));
  await press(p, '#deploy [data-vx-step="prev"]');
  say(after === 'January 2027' && s.month === 'November 2026' && prevOff === 'true' && (await read(p, '#deploy')).month === 'November 2026', `the keys turn the month; previous is off in the month of the first day that can be chosen (${after}, ${s.month})`);

  // ---- a range
  await press(p, day('#freeze', '2026-12-07'));
  s = await read(p, '#freeze');
  say(s.values.join() === '2026-12-07,' && s.marks === '07:one', `in a range, a press starts it again: the start is set, the end cleared (${s.values.join(' to ')})`);
  await press(p, day('#freeze', '2026-12-03'));
  s = await read(p, '#freeze');
  say(s.values.join() === '2026-12-03,2026-12-07' && s.marks === '03:start 04:mid 05:mid 06:mid 07:end' && s.selected === 5, `a second press before the start makes it the start (${s.marks})`);
  d = await drawn(p, '#freeze', '2026-12-04');
  say(d?.well && d.lit > 0 && d.block > 0, `the range is a trench with light on its floor, keys at its ends and tiles between (${JSON.stringify(d)})`);
  d = await drawn(p, '#span', '2026-11-17');
  const d2 = await drawn(p, '#span', '2026-11-24');
  say(d?.well && d.lit > 0 && d2?.well && d2.lit > 0, 'a range over two weeks is a trench in each');
  await p.screenshot({ path: `${dir}/hand-range.png`, clip: { x: 250, y: 640, width: 420, height: 400 } });

  // ---- days that cannot be chosen
  await press(p, day('#bounded', '2026-11-24'));
  s = await read(p, '#bounded');
  say(s.values[0] === '2026-11-12', `a press on a day after the last that can be chosen does nothing (${s.values[0]})`);

  // ---- an input that cannot be changed: no day can be chosen, the month can still be turned
  await p.evaluate(() => { document.querySelector('#bounded input').readOnly = true; });
  await p.waitForTimeout(50);
  await press(p, day('#bounded', '2026-11-13'));
  s = await read(p, '#bounded');
  const named = await p.evaluate(() => { const c = document.getElementById('bounded'); return [c.getAttribute('role'), c.getAttribute('aria-label'), c.querySelector('[data-vx-day="2026-11-13"]').getAttribute('aria-disabled')]; });
  say(s.values[0] === '2026-11-12' && named[2] === 'true', `a readonly input: a press on a day does nothing, and the days say so (${s.values[0]})`);
  say(named[0] === 'group' && named[1] === "Ada's review", `the calendar takes its hidden input's name (${named[0]} "${named[1]}")`);

  // ---- set from code: the month follows
  await p.evaluate(() => { document.getElementById('deploy-day').value = '2027-01-15'; });
  await p.waitForTimeout(50);
  s = await read(p, '#deploy');
  say(s.month === 'January 2027' && s.marks === '15:one', `a value set from code shows its month and its day (${s.month}; ${s.marks})`);

  // ---- right to left: the left arrow goes on
  await p.locator(day('#rtl', '2026-11-19')).focus();
  await p.keyboard.press('ArrowLeft');
  say((await read(p, '#rtl')).focus === '2026-11-20', 'right to left: the left arrow goes a day on');

  // ---- at rest nothing runs
  await p.mouse.move(4, 4);
  await p.waitForTimeout(1500);
  say(await p.evaluate(() => window.vx.stage.awake.size) === 0, 'at rest nothing runs');
  await p.context().close();
}

// ---- plain (no voxels): the same behaviour, the same boxes
{
  const q = await open({ plain: true });
  say(await q.locator('[data-vx-live]').count() === 0, 'plain: nothing is drawn in voxels');
  const plainBoxes = await boxes(q);
  const moved = plainBoxes.filter((b, i) => b !== liveBoxes[i]).length;
  say(plainBoxes.length === liveBoxes.length && moved === 0, `plain: every calendar, key and day has the box it has in voxels (${moved} of ${plainBoxes.length} differ)`);
  await press(q, day('#deploy', '2026-11-26'));
  await q.keyboard.press('ArrowRight');
  await q.keyboard.press('Enter');
  const s = await read(q, '#deploy');
  say(s.values[0] === '2026-11-27' && s.marks === '27:one', `plain: a press, an arrow and Enter choose the 27th (${s.values[0]})`);
  await q.context().close();
}

// ---- on a phone
for (const plain of [false, true]) {
  const q = await open({ width: 390, height: 844, plain });
  const side = await q.evaluate(() => { scrollTo(200, scrollY); const x = scrollX; scrollTo(0, scrollY); return x; });
  const cut = await q.evaluate(() => { const s = document.querySelector('.sheet').getBoundingClientRect(); return [...document.querySelectorAll('.vx-calendar')].filter((c) => { const r = c.getBoundingClientRect(); return r.left < s.left || r.right > s.right; }).length; });
  say(side === 0 && cut === 0, `at 390 px${plain ? ', plain' : ''}: no calendar is cut and the page does not scroll sideways`);
  await q.locator('#deploy').scrollIntoViewIfNeeded();
  await press(q, day('#deploy', '2026-11-30'));
  say((await read(q, '#deploy')).values[0] === '2026-11-30', `at 390 px${plain ? ', plain' : ''}: a press chooses a day`);
  await q.context().close();
}

// ---- no script: the browser's own date input
{
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 1000 }, javaScriptEnabled: false });
  const q = await ctx.newPage();
  await q.goto(`${url}?theme=light`);
  await q.waitForTimeout(400);
  const s = await q.evaluate(() => { const i = document.querySelector('#deploy input'); return [i.type, !i.hidden && i.offsetWidth > 0, document.querySelectorAll('.vx-calendar-grid').length]; });
  say(s[0] === 'date' && s[1] && s[2] === 0, 'with no script it is the browser\'s own date input');
  await ctx.close();
}

say(errors.length === 0, 'no errors' + (errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''));
await browser.close();
console.log(bad ? `${bad} to fix` : 'ok: the calendar answers a real mouse and real keys');
process.exit(bad ? 1 : 0);
