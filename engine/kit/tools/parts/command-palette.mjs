// The command palette under a real mouse and real keys: a dialog with a well at its top and rows
// under it; the chord brings it, typing keeps what matches, the arrows move the mark, Enter does it.
//   PORT=5989 node tools/parts/command-palette.mjs
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const port = process.env.PORT || 5989;
await mkdir('shots/parts/command-palette', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
const url = `http://127.0.0.1:${port}/kit/showcase/parts/command-palette.html?theme=light`;
let p = await (await browser.newContext({ viewport: { width: 1180, height: 900 }, deviceScaleFactor: 1 })).newPage();
const errors = [];
const hear = (pg) => { pg.on('pageerror', (e) => errors.push(String(e))); pg.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); }); };
hear(p);
let bad = 0;
const say = (ok, what) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); };
const open = async () => {
  await p.goto(url);
  await p.waitForFunction(() => document.documentElement.dataset.ready === '1');
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(900);
};
await open();
const mac = await p.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent));
const CHORD = mac ? 'Meta+k' : 'Control+k';

// a palette as a person finds it
const read = (id) => p.evaluate(async (id) => {
  const { MATERIALS } = await import('/kit/src/index.js');
  const name = (i) => Object.keys(MATERIALS).find((k) => MATERIALS[k].id === i);
  const list = document.getElementById(id), dialog = list.closest('dialog'), input = document.querySelector(`[aria-controls="${id}"]`);
  const opts = [...list.querySelectorAll('[role="option"]')], seen = opts.filter((o) => o.getClientRects().length > 0);
  const act = document.getElementById(input.getAttribute('aria-activedescendant') || '-');
  const words = (o) => o.firstChild.textContent.trim();
  const l = window.vx?.live(list), walls = l?.model.byName.walls;
  const windows = l?.model.byName.windows;
  const litY = [];
  let darkCells = 0;
  for (let i = 0; i < (windows?.count ?? 0); i++) {
    const material = name(windows.mats[i]);
    if (material === 'light') litY.push(windows.rest[3 * i + 1] * l.vx);
    else if (material === 'lens') darkCells++;
  }
  const r = act?.getBoundingClientRect(), b = list.getBoundingClientRect();
  const empty = dialog.querySelector('.vx-command-empty');
  return {
    open: dialog.open, modal: dialog.matches(':modal'), focus: document.activeElement === input, value: input.value,
    role: input.getAttribute('role'), listRole: list.getAttribute('role'), shown: seen.map(words), active: act ? words(act) : null,
    groups: [...list.querySelectorAll('[role="group"]')].filter((g) => !g.hidden).length,
    walls: walls ? [...new Set(walls.mats)].map(name).join('+') : '', well: l?.well?.map((v) => v * l.vx) ?? null,
    litY, darkCells,
    row: r ? [r.top - b.top, r.bottom - b.top] : null, empty: empty && !empty.hidden ? empty.textContent : null,
    done: document.getElementById('done').textContent, inView: r ? (() => { const s = list.parentElement.getBoundingClientRect(); return r.top >= s.top - 1 && r.bottom <= s.bottom + 1; })() : null,
  };
}, id);
const groove = (m) => m.well && m.row && m.well[2] - m.well[0] === 4 && m.well[1] >= m.row[0] && m.well[3] <= m.row[1];
const fitted = m => m.row && m.litY.length === 2 && m.darkCells === 2 * (m.shown.length - 1)
  && m.litY.every(y => y >= m.row[0] && y < m.row[1]);
const key = async (k, n = 1) => { for (let i = 0; i < n; i++) await p.keyboard.press(k); await p.waitForTimeout(220); };

let m = await read('cmds');
say(!m.open && m.role === 'combobox' && m.listRole === 'listbox', 'shut as the page arrives; a field with role="combobox" and a listbox of rows');
const legend = await p.evaluate(() => document.querySelector('[data-vx-chord-for="cmds"] [data-vx-mod]').textContent.trim());
say(legend === (mac ? '⌘' : 'Ctrl'), `the chord is shown as this computer names it (${legend} K)`);

// the chord
await p.mouse.click(1100, 860);
await p.keyboard.press(CHORD); await p.waitForTimeout(700);
m = await read('cmds');
say(m.open && m.modal && m.focus && m.value === '' && m.shown.length === 11, `${CHORD} opens it, modal, with the focus in its well and every row (${m.shown.length})`);
say(m.active === 'harbor-api' && fitted(m), `the first row is marked, and its two lens cells light within the row (${m.litY.join(', ')} px)`);
await p.screenshot({ path: 'shots/parts/command-palette/hand-open.png' });

// typing
await p.keyboard.type('roll', { delay: 40 }); await p.waitForTimeout(350);
m = await read('cmds');
say(m.shown.length === 1 && m.shown[0] === 'Roll back to 4f2c9a1' && m.active === m.shown[0] && m.groups === 1 && fitted(m), `typing "roll" keeps what matches (${m.shown.join(', ')}), hides the groups with nothing left, and marks it`);
await key('Backspace', 4);
await p.keyboard.type('deploy', { delay: 30 }); await p.waitForTimeout(350);
m = await read('cmds');
say(m.shown.length === 2 && m.shown.includes('Розгорнути на сервері'), `a row is found by its keywords too ("deploy": ${m.shown.join(', ')})`);
await key('ArrowDown');
m = await read('cmds');
say(m.active === 'Розгорнути на сервері' && m.focus && fitted(m), 'Down moves the mark; the focus stays in the well and its fitted lens lights');
await key('ArrowDown');
m = await read('cmds');
say(m.active === 'Deploy harbor-api', 'and goes round from the last to the first');
await key('ArrowUp');
say((await read('cmds')).active === 'Розгорнути на сервері', 'Up goes back round');
await key('Enter'); await p.waitForTimeout(500);
m = await read('cmds');
say(!m.open && m.done === 'Done: Розгорнути на сервері.', `Enter does the marked one and the palette closes (${m.done})`);

// again: it begins empty
await key(CHORD); await p.waitForTimeout(500);
m = await read('cmds');
say(m.open && m.value === '' && m.shown.length === 11 && m.active === 'harbor-api', 'opened again it begins empty, with every row');
// the long list scrolls, and the mark stays in sight
await key('ArrowUp');
m = await read('cmds');
say(m.active === 'Sign out of fogline' && m.inView && fitted(m), 'Up from the first goes to the last, which is scrolled into sight with its lit lens');
await key('Escape'); await p.waitForTimeout(600);
m = await read('cmds');
say(!m.open, 'Escape closes it');
await key(CHORD); await p.waitForTimeout(500);
await key(CHORD); await p.waitForTimeout(600);
say(!(await read('cmds')).open, 'the chord again closes it');

// nothing matches
await key(CHORD); await p.waitForTimeout(500);
await p.keyboard.type('lighthouse', { delay: 20 }); await p.waitForTimeout(300);
m = await read('cmds');
say(m.shown.length === 0 && m.empty === 'Nothing is called “lighthouse”.' && m.active === null && !m.litY.length && !m.darkCells, `nothing matches: no rows, no groove, and it says so in words ("${m.empty}")`);
await key('Enter');
say((await read('cmds')).open, 'and Enter does nothing');
await key('Escape'); await p.waitForTimeout(600);

// the mouse
await p.locator('#find').click(); await p.waitForTimeout(600);
m = await read('cmds');
say(m.open && m.focus, 'its key on the page opens it too');
const row = p.locator('#cmds [role="option"]').nth(6);
const rb = await row.boundingBox();
await p.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2, { steps: 6 }); await p.waitForTimeout(250);
m = await read('cmds');
say(m.active === 'Invite Mina to fog-site' && fitted(m) && m.focus, 'the pointer over a row marks it; the focus stays in the well');
const off = await p.locator('#cmds [role="option"][aria-disabled="true"]').boundingBox();
await p.mouse.click(off.x + off.width / 2, off.y + off.height / 2); await p.waitForTimeout(300);
say((await read('cmds')).open, 'a press on a row that is off does nothing');
await p.mouse.click(rb.x + rb.width / 2, rb.y + rb.height / 2); await p.waitForTimeout(600);
m = await read('cmds');
say(!m.open && m.done === 'Done: Invite Mina to fog-site.', 'a press on a row does it');
say(await p.evaluate(() => document.activeElement?.id === 'find'), 'and the focus goes back to the key that opened it');

// the two shown open on the page
m = await read('still-list');
say(m.open && !m.modal && m.active === 'Deploy harbor-api' && groove(m), 'shown open: aria-activedescendant set from code marks that row');
await p.evaluate(() => document.getElementById('still-q').setAttribute('aria-activedescendant', document.querySelectorAll('#still-list [role="option"]')[0].id));
await p.waitForTimeout(300);
m = await read('still-list');
say(m.active === 'harbor-api' && groove(m), 'and set again, the groove is cut at the other row');
m = await read('none-list');
say(m.empty === 'Nothing is called “lighthouse”.' && m.shown.length === 0, 'the one with nothing matching says so');

// reduced motion: no building
await p.emulateMedia({ reducedMotion: 'reduce' });
await key(CHORD); await p.waitForTimeout(80);
const still = await p.evaluate(() => { const l = window.vx.live(document.getElementById('palette')); return l.model.parts.every((q) => !q.fx || q.fx.end === 0 || q.fx.t >= q.fx.end); });
say((await read('cmds')).open && still, 'with reduced motion it is there at once');
await key('Escape'); await p.waitForTimeout(300);
await p.emulateMedia({ reducedMotion: 'no-preference' });

// a phone
await p.setViewportSize({ width: 390, height: 800 }); await p.waitForTimeout(500);
await key(CHORD); await p.waitForTimeout(600);
const fits = await p.evaluate(() => { const d = document.getElementById('palette').getBoundingClientRect(); return d.left >= 0 && d.right <= innerWidth && [...document.querySelectorAll('#cmds [role="option"]')].every((o) => o.scrollWidth <= o.clientWidth + 1); });
say((await read('cmds')).open && fits, 'at 390 px it fits the window and no row is cut');
await p.screenshot({ path: 'shots/parts/command-palette/hand-phone.png' });
await key('Escape');

// plain
const ctx2 = await browser.newContext({ viewport: { width: 1180, height: 900 }, deviceScaleFactor: 1 });
p = await ctx2.newPage(); hear(p);
await p.addInitScript(() => { new MutationObserver((_, o) => { if (document.documentElement) { document.documentElement.setAttribute('data-vx-plain', ''); o.disconnect(); } }).observe(document, { childList: true }); });
await open();
await p.mouse.click(1100, 860);
await key(CHORD); await p.waitForTimeout(300);
await p.keyboard.type('fog', { delay: 20 }); await key('ArrowDown');
m = await read('cmds');
const paint = await p.evaluate(() => getComputedStyle(document.querySelector('#cmds [data-vx-active]')).backgroundImage !== 'none');
say(await p.evaluate(() => document.querySelectorAll('[data-vx-live]').length) === 0 && m.open && m.active === 'Invite Mina to fog-site' && paint, `with no voxels it works the same, and the mark is painted (${m.shown.join(', ')})`);
await key('Enter'); await p.waitForTimeout(200);
m = await read('cmds');
say(!m.open && m.done === 'Done: Invite Mina to fog-site.', 'Enter does it and closes');
await ctx2.close();

// no script: its key still opens it (the browser's own invoker), and every row is there
const ctx3 = await browser.newContext({ viewport: { width: 390, height: 800 }, javaScriptEnabled: false });
p = await ctx3.newPage();
await p.goto(url); await p.waitForTimeout(400);
await p.locator('#find').click(); await p.waitForTimeout(300);
const bare = await p.evaluate(() => { const d = document.getElementById('palette'); return { open: d.open, modal: d.matches(':modal'), rows: [...d.querySelectorAll('[role="option"]')].filter((o) => o.getClientRects().length).length }; });
say(bare.open && bare.modal && bare.rows === 11, `with no script its key opens it, modal, with every row (${bare.rows})`);
await p.keyboard.press('Escape'); await p.waitForTimeout(200);
say(!(await p.evaluate(() => document.getElementById('palette').open)), 'and Escape closes it');
await ctx3.close();

say(errors.length === 0, 'no errors' + (errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''));
await browser.close();
process.exit(bad ? 1 : 0);
