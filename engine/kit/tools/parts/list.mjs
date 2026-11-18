// The lit list under a real mouse and real keys: rows of words with no tray, an accent groove at
// the current row, and rows that answer a press when they hold a link or a button.
//   PORT=5989 node tools/parts/list.mjs
import { chromium } from 'playwright';

const port = process.env.PORT || 5989;
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
const p = await (await browser.newContext({ viewport: { width: 1180, height: 1100 }, deviceScaleFactor: 1 })).newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(String(e)));
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
let bad = 0;
const say = (ok, what) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); };

await p.goto(`http://127.0.0.1:${port}/kit/showcase/parts/list.html?theme=light`);
await p.waitForFunction(() => document.documentElement.dataset.ready === '1' && window.vx);
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(600);

// what a list's model holds: its parts, where its groove is (px from the list's top), each row's press
const read = (sel) => p.evaluate((sel) => {
  const el = document.querySelector(sel), l = window.vx.live(el);
  const rows = l.state.rows.map((r) => ({ top: r.li.offsetTop, h: r.li.offsetHeight, current: r.current, press: r.press.target, x: r.press.x, moved: r.li.querySelector('.vx-row').style.transform }));
  return { parts: l.model.parts.map((q) => q.name), cubes: l.model.count, well: l.well && l.well.map((v) => v * l.vx), rows, glow: l.glowStrength, w: el.offsetWidth };
}, sel);
// two CSS translates, the same to a twentieth of a pixel (at rest the words may be nudged a fraction, onto whole pixels)
const shift = (t) => { const v = (t.match(/-?[\d.]+px/g) || []).map(parseFloat); return [v[0] || 0, v[1] || 0]; };
const near = (a, b) => { const [ax, ay] = shift(a), [bx, by] = shift(b); return Math.abs(ax - bx) < 0.05 && Math.abs(ay - by) < 0.05; };
const rowBox = (sel, i) => p.locator(`${sel} > li`).nth(i).boundingBox();

let m = await read('#projects');
say(!m.parts.includes('tray') && !m.parts.some((n) => n.startsWith('row')), `no tray and no tiles: its only voxels are the groove (parts: ${m.parts.join(', ')}; ${m.cubes} cubes)`);
const cur = m.rows.findIndex((r) => r.current);
say(cur === 0 && m.well && Math.abs(m.well[1] - (m.rows[0].top + 8)) < 1 && Math.abs(m.well[3] - (m.rows[0].top + m.rows[0].h - 8)) < 1 && m.well[0] === 4, `the groove is at the start of the current row (${m.well})`);
const shadows = await p.evaluate(() => [...document.querySelectorAll('#projects > li')].map((li) => getComputedStyle(li).boxShadow));
say(shadows[0] === 'none' && shadows.slice(1).every((s) => /inset/.test(s) && /1px/.test(s)), 'rows are parted by hairlines, with none above the first');
const grid = await p.evaluate(() => [...document.querySelectorAll('.vx-list > li')].every((li) => li.offsetHeight % 4 === 0 && li.offsetTop % 4 === 0));
say(grid, 'every row on the page begins and ends on the voxel grid, the one that wraps too');

// a real press on a row that holds a link
let b = await rowBox('#projects', 1);
await p.mouse.move(b.x + b.width * 0.5, b.y + b.height / 2, { steps: 8 });
const tint = await p.evaluate(() => getComputedStyle(document.querySelectorAll('#projects > li')[1]).getPropertyValue('--_tint'));
say(tint.trim() !== '', `under the pointer the row is tinted (${tint.trim().slice(0, 44)})`);
const still = m.rows[1].moved;
await p.mouse.down(); await p.waitForTimeout(140);
m = await read('#projects');
say(m.rows[1].press < 0 && m.rows[1].x < -0.3 && !near(m.rows[1].moved, still), `held, the row's words go into the surface (${m.rows[1].x.toFixed(2)} voxels; ${m.rows[1].moved})`);
say(m.rows.every((r, i) => i === 1 || r.press === 0), 'and no other row moves');
await p.mouse.up(); await p.waitForTimeout(450);
m = await read('#projects');
say(m.rows[1].press === 0 && Math.abs(m.rows[1].x) < 0.02 && near(m.rows[1].moved, still), `let go, they come back (${m.rows[1].moved || 'no shift'})`);
say(m.rows[1].current && !m.rows[0].current && Math.abs(m.well[1] - (m.rows[1].top + 8)) < 1, `the row that was pressed is now current, and the groove is beside it (${m.well})`);

// the whole row is the target: its far end, where the trailing word is
b = await rowBox('#projects', 3);
await p.mouse.click(b.x + b.width - 6, b.y + b.height - 6); await p.waitForTimeout(300);
m = await read('#projects');
say(m.rows[3].current && Math.abs(m.well[1] - (m.rows[3].top + 8)) < 1, 'a press at the far end of a row chooses it too');
await p.screenshot({ path: 'shots/parts/list/hand.png' });

// the mark's light answers a press on its own row
b = await rowBox('#projects', 3);
const rest = m.glow;
await p.mouse.move(b.x + 80, b.y + b.height / 2); await p.mouse.down(); await p.waitForTimeout(140);
const lit = (await read('#projects')).glow;
await p.mouse.up(); await p.waitForTimeout(300);
say(lit > rest * 1.3, `pressing the current row brightens its groove (${(lit / rest).toFixed(2)} times)`);

// rows of words only do not answer
b = await rowBox('#states', 0);
await p.mouse.move(b.x + 100, b.y + b.height / 2); await p.mouse.down(); await p.waitForTimeout(140);
m = await read('#states');
await p.mouse.up();
say(m.rows.every((r) => r.press === 0), 'a row of words only does not answer a press');
say(m.rows[1].current && Math.abs(m.well[1] - (m.rows[1].top + 8)) < 1, 'a current row of words only still has its groove');

// a row that is a button
b = await rowBox('#states', 2);
await p.mouse.click(b.x + b.width - 10, b.y + b.height / 2); await p.waitForTimeout(150);
say(await p.evaluate(() => window.pressed) === 1, 'a row that holds a button: a press anywhere on the row presses the button');

// keys
await p.focus('#row-button'); await p.keyboard.press('Shift+Tab'); await p.keyboard.press('Tab');
say(await p.evaluate(() => document.activeElement.id === 'row-button'), 'Tab reaches the button in a row');
const ring = await p.evaluate(() => { const c = getComputedStyle(document.activeElement.closest('.vx-row')); return c.outlineStyle + ' ' + c.outlineWidth; });
say(/solid 2px/.test(ring), `and the row has the focus ring (${ring})`);
await p.keyboard.press('Enter'); await p.keyboard.press('Space'); await p.waitForTimeout(100);
say(await p.evaluate(() => window.pressed) === 3, 'Enter and Space press it');
await p.keyboard.press('Tab');
say(await p.evaluate(() => document.activeElement.getAttribute('href')) === '#long', 'Tab goes on to the link in the next row');

// several chosen at once, and right to left
m = await read('[role="listbox"]');
say(m.rows.filter((r) => r.current).length === 2 && Math.abs(m.well[1] - (m.rows[0].top + 8)) < 1 && Math.abs(m.well[3] - (m.rows[2].top + m.rows[2].h - 8)) < 1, 'two rows chosen: a groove beside each (the hole runs from the first to the last)');
m = await read('[dir="rtl"]');
say(m.well && Math.abs(m.well[2] - (m.w - 4)) < 1, `right to left: the groove is at the right (${m.well})`);

// set from code: the list is drawn again, and only once
const builds = await p.evaluate(async () => {
  const el = document.querySelector('#states'), l = window.vx.live(el);
  let n = 0; const was = l.rebuild.bind(l); l.rebuild = () => { n++; was(); };
  const li = el.querySelectorAll(':scope > li');
  li[1].removeAttribute('aria-current'); li[3].setAttribute('aria-current', 'true');
  await new Promise((r) => setTimeout(r, 400));
  return n;
});
m = await read('#states');
say(m.rows[3].current && Math.abs(m.well[1] - (m.rows[3].top + 8)) < 1, 'aria-current set from code moves the groove');
say(builds >= 1 && builds <= 2, `and the list is drawn again without going round in circles (${builds} times)`);

say(errors.length === 0, 'no errors' + (errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''));
await browser.close();
process.exit(bad ? 1 : 0);
