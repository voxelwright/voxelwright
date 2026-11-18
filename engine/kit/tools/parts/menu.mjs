// The lit menu under a real mouse and real keys: a float of voxels built out of its trigger's
// corner, with the active row marked by an accent groove that follows the pointer and the arrows.
//   PORT=5989 node tools/parts/menu.mjs
import { chromium } from 'playwright';

const port = process.env.PORT || 5989;
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
const p = await (await browser.newContext({ viewport: { width: 1180, height: 900 }, deviceScaleFactor: 1 })).newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(String(e)));
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
let bad = 0;
const say = (ok, what) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); };

await p.goto(`http://127.0.0.1:${port}/kit/showcase/parts/menu.html?theme=light`);
await p.waitForFunction(() => document.documentElement.dataset.ready === '1' && window.vx);
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(900);

// what a menu's model holds: its parts and what they are made of, where the mark is, what is being built
const read = (id) => p.evaluate(async (id) => {
  const { MATERIALS } = await import('/kit/src/index.js');
  const name = (i) => Object.keys(MATERIALS).find((k) => MATERIALS[k].id === i);
  const el = document.getElementById(id), l = window.vx.live(el), { panel, pick } = l.model.byName;
  const made = (q) => [...new Set(q.mats)].map(name).sort().join('+');
  const items = l.state.items;
  return {
    open: el.matches(':popover-open'), parts: l.model.parts.map((q) => q.name).join(','), panel: made(panel), panelCubes: panel.count, pick: made(pick), pickCubes: pick.count,
    danger: !l.model.byName.danger.hidden, active: l.state.active, shown: !pick.hidden || !l.model.byName.danger.hidden, markY: pick.ty * l.vx, rowY: items.map((it) => it.offsetTop), marked: items.findIndex((it) => it.hasAttribute('data-vx-active')),
    building: panel.fx?.kind ?? null, top: l.faceZ, float: l.look.float, focus: items.indexOf(document.activeElement),
    expanded: document.querySelector(`[popovertarget="${id}"]`).getAttribute('aria-expanded'), rect: (({ left, top, width, height }) => ({ left, top, width, height }))(el.getBoundingClientRect()),
  };
}, id);
const item = (id, i) => p.locator(`#${id} [role="menuitem"]`).nth(i).boundingBox();
const over = async (id, i) => { const b = await item(id, i); await p.mouse.move(b.x + b.width * 0.6, b.y + b.height / 2, { steps: 6 }); await p.waitForTimeout(120); };
const focusId = () => p.evaluate(() => document.activeElement.id || document.activeElement.textContent.trim());

// the one shown open on the page
let m = await read('still-menu');
say(m.open && m.panelCubes > 200 && m.panel === 'light+panel' && m.pick === 'light', `the panel and the mark are voxels: a slab of ${m.panel} (${m.panelCubes} cubes), a mark of ${m.pick} (${m.pickCubes})`);
say(m.top === m.float, `it stands at the height of a float (${m.top} voxels)`);
say(m.active === 1 && m.shown && m.markY === m.rowY[1], `its second row is active, and the mark is beside it (${m.markY} px down for a row at ${m.rowY[1]})`);
await over('still-menu', 2);
m = await read('still-menu');
say(m.active === 2 && m.shown && m.markY === m.rowY[2] && m.marked === 2, 'the pointer moves to the third row, and the mark goes with it at once');
await p.mouse.move(m.rect.left + m.rect.width + 120, m.rect.top + 40, { steps: 6 }); await p.waitForTimeout(120);
m = await read('still-menu');
say(m.active === -1 && !m.shown && m.marked === -1, 'the pointer leaves, and no row is marked');

// opened with the mouse
const t = await p.locator('#trigger').boundingBox();
await p.mouse.move(t.x + t.width / 2, t.y + t.height / 2, { steps: 6 });
await p.mouse.down(); await p.waitForTimeout(60); await p.mouse.up();
await p.waitForTimeout(40);
m = await read('project-menu');
say(m.open && m.building === 'assemble', 'a press on its key opens it, and it is being built');
say(!m.parts.split(',').includes('light') && m.panel === 'light+panel', 'its light is part of what is built, so light and slab rise out of the corner together');
say(Math.abs(m.rect.left - t.x) < 1 && m.rect.top > t.y + t.height, `it opens under its key, from the key's corner (left ${m.rect.left} for ${t.x})`);
await p.waitForTimeout(450);
m = await read('project-menu');
say(m.building === null && m.expanded === 'true' && m.active === -1 && m.focus === -1, 'built; its key says it is open; opened by the mouse, no row is marked yet');
await over('project-menu', 1);
m = await read('project-menu');
say(m.active === 1 && m.shown && m.markY === m.rowY[1], 'the mark follows the pointer');
await p.screenshot({ path: 'shots/parts/menu/hand-pointer.png' });
await over('project-menu', 3);
const colours = await p.evaluate(() => [...document.querySelectorAll('#project-menu [role="menuitem"]')].map((it) => getComputedStyle(it).color));
say((await read('project-menu')).danger && colours[3] !== colours[0] && colours[3] !== 'rgb(255, 255, 255)', `the destructive row keeps its red while it is active (${colours[3]})`);
const b1 = await item('project-menu', 1);
await p.mouse.click(b1.x + 30, b1.y + b1.height / 2); await p.waitForTimeout(400);
m = await read('project-menu');
say(!m.open && m.expanded === 'false' && await focusId() === 'trigger', 'a press on a row closes it, and focus is back on its key');
say(await p.evaluate(() => document.getElementById('chosen').textContent) === 'Chosen: Roll back to 4f2c9a1', 'and the row was chosen');

// opened with the keyboard
await p.focus('#trigger'); await p.keyboard.press('Shift+Tab'); await p.keyboard.press('Tab');
await p.keyboard.press('Enter'); await p.waitForTimeout(40);
m = await read('project-menu');
say(m.open && m.building === 'assemble' && m.shown && m.focus === 0, 'Enter opens it with the focus mark on the first row during assembly');
await p.waitForTimeout(450);
m = await read('project-menu');
say(m.focus === 0 && m.active === 0 && m.shown && m.markY === m.rowY[0], 'opened from the keyboard, focus is on the first row and the mark is beside it');
const walk = [['ArrowDown', 1], ['ArrowDown', 2], ['End', 3], ['ArrowDown', 0], ['ArrowUp', 3], ['Home', 0], ['ArrowDown', 1]];
let followed = true; const went = [];
for (const [key, want] of walk) {
  await p.keyboard.press(key); await p.waitForTimeout(90);
  m = await read('project-menu');
  went.push(`${key} ${m.focus}`);
  if (m.focus !== want || m.active !== want || !m.shown || m.markY !== m.rowY[want]) followed = false;
}
say(followed, `the arrows, Home and End move focus and the mark together, and wrap at the ends (${went.join(', ')})`);
await p.screenshot({ path: 'shots/parts/menu/hand-keys.png' });
await p.keyboard.press('Escape'); await p.waitForTimeout(300);
m = await read('project-menu');
say(!m.open && m.expanded === 'false' && await focusId() === 'trigger', 'Escape closes it, and focus is back on its key');
await p.keyboard.press('Space'); await p.waitForTimeout(500);
await p.keyboard.press('ArrowDown'); await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter'); await p.waitForTimeout(400);
m = await read('project-menu');
say(!m.open && await p.evaluate(() => document.getElementById('chosen').textContent) === 'Chosen: Розгорнути на сервері' && await focusId() === 'trigger', 'Space opens it too; Enter on a row chooses it, closes the menu and gives focus back');

// a press outside closes it
await p.mouse.click(t.x + t.width / 2, t.y + t.height / 2); await p.waitForTimeout(500);
say((await read('project-menu')).open, 'opened again');
await p.mouse.click(900, 40); await p.waitForTimeout(300);
m = await read('project-menu');
say(!m.open && m.expanded === 'false', 'a press outside it closes it');

// a phone: it stays inside the window
await p.setViewportSize({ width: 390, height: 800 }); await p.waitForTimeout(500);
const t2 = await p.locator('#trigger').boundingBox();
await p.mouse.click(t2.x + t2.width / 2, t2.y + t2.height / 2); await p.waitForTimeout(500);
m = await read('project-menu');
say(m.open && m.rect.left >= 0 && m.rect.left + m.rect.width <= 390, `at 390 px it is inside the window (${m.rect.left} to ${m.rect.left + m.rect.width})`);

await p.keyboard.press('Escape');
await p.setViewportSize({ width: 390, height: 270 });
await p.locator('#project-menu').evaluate(menu => {
  for (const label of ['View logs', 'Copy URL', 'Manage access', 'Pause builds', 'Resume builds', 'Archive project']) {
    const item = document.createElement('button');
    item.setAttribute('role', 'menuitem');
    item.textContent = label;
    menu.append(item);
  }
});
await p.locator('#trigger').focus();
await p.keyboard.press('Shift+Tab');
await p.keyboard.press('Tab');
await p.keyboard.press('Enter');
await p.keyboard.press('End');
await p.waitForTimeout(180);
const short = await p.locator('#project-menu').evaluate(menu => {
  const r = menu.getBoundingClientRect(), item = document.activeElement, row = item.getBoundingClientRect();
  return item.textContent === 'Archive project' && menu.contains(item) && menu.querySelector('.vx-menu-rows')?.scrollTop > 0
    && r.top >= 0 && r.bottom <= innerHeight && row.top >= r.top && row.bottom <= r.bottom;
});
say(short, 'in a 270px-high viewport End scrolls the last choice fully into the fixed plate');
await p.screenshot({ path: 'shots/parts/menu/hand-short.png' });
await p.keyboard.press('Enter');
say(!(await read('project-menu')).open && await focusId() === 'trigger'
  && await p.locator('#chosen').textContent() === 'Chosen: Archive project', 'the last choice commits, closes the short menu and restores focus');

say(errors.length === 0, 'no errors' + (errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''));
await browser.close();
process.exit(bad ? 1 : 0);
