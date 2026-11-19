// The combobox under a real mouse and real keys: a well you type in, and a float of rows under it
// that holds what matches. The focus stays in the field; the arrows move the mark.
//   PORT=5989 node tools/parts/combobox.mjs
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const port = process.env.PORT || 5989;
await mkdir('shots/parts/combobox', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
const url = (q = '') => `http://127.0.0.1:${port}/kit/showcase/parts/combobox.html?theme=light${q}`;
let p = await (await browser.newContext({ viewport: { width: 1180, height: 900 }, deviceScaleFactor: 1 })).newPage();
const errors = [];
const hear = (pg) => { pg.on('pageerror', (e) => errors.push(String(e))); pg.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); }); };
hear(p);
let bad = 0;
const say = (ok, what) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); };
const open = async (q) => {
  await p.goto(url(q));
  await p.waitForFunction(() => document.documentElement.dataset.ready === '1');
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(800);
};
await open('&closed');

// a combobox as a person finds it, and what its float's model holds
const read = (id) => p.evaluate(async (id) => {
  const { MATERIALS } = await import('/kit/src/index.js');
  const name = (i) => Object.keys(MATERIALS).find((k) => MATERIALS[k].id === i);
  const box = document.getElementById(id), input = box.querySelector('[role="combobox"]'), float = box.querySelector('.vx-combobox-float');
  const list = document.getElementById(input.getAttribute('aria-controls')), opts = [...list.querySelectorAll('[role="option"]')];
  const seen = opts.filter((o) => o.getClientRects().length > 0);
  const act = document.getElementById(input.getAttribute('aria-activedescendant') || '-');
  const l = window.vx?.live(float), parts = l?.model.byName;
  const made = (q) => (q ? [...new Set(q.mats)].map(name).sort().join('+') : '');
  const f = float.getBoundingClientRect(), w = input.closest('.vx-well').getBoundingClientRect();
  const empty = float.querySelector('.vx-combobox-empty');
  return {
    role: input.getAttribute('role'), auto: input.getAttribute('aria-autocomplete'), listRole: list.getAttribute('role'),
    expanded: input.getAttribute('aria-expanded'), open: float.matches(':popover-open'), value: input.value,
    shown: seen.map((o) => o.textContent.trim().split(/\s{2,}| (?=Frankfurt|Amsterdam|Warsaw|Київ|archived)/)[0]), active: act ? act.firstChild.textContent.trim() : null,
    selected: opts.filter((o) => o.getAttribute('aria-selected') === 'true').length, focus: document.activeElement === input,
    under: Math.round(f.top - w.bottom), sameW: Math.abs(f.width - w.width) <= 4, left: Math.round(f.left - w.left),
    body: made(parts?.body), slides: made(parts?.panel), pick: made(parts?.pick), pickShown: parts ? !parts.pick.hidden : null,
    pickY: parts ? parts.pick.ty * l.vx : null, actY: act ? Math.round(act.getBoundingClientRect().top - f.top) : null,
    empty: empty && !empty.hidden ? empty.textContent : null,
  };
}, id);
const press = async (sel) => { const b = await p.locator(sel).first().boundingBox(); await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 5 }); await p.mouse.down(); await p.waitForTimeout(50); await p.mouse.up(); await p.waitForTimeout(350); };
const key = async (k, n = 1) => { for (let i = 0; i < n; i++) await p.keyboard.press(k); await p.waitForTimeout(250); };

let m = await read('use');
say(m.role === 'combobox' && m.auto === 'list' && m.listRole === 'listbox' && m.expanded === 'false' && !m.open, 'a field with role="combobox" and aria-autocomplete="list", controlling a listbox; shut as the page arrives');

// a press in the field opens the rows
await press('#use-q');
m = await read('use');
say(m.open && m.expanded === 'true' && m.focus && m.shown.length === 9 && m.active === null, `a press in the field opens the rows (${m.shown.length}), marks none, and the focus stays in the field`);
say(m.under >= 4 && m.under <= 24 && m.sameW && m.left === 0, `the float lies under the well, as wide as it (${m.under} px under)`);
say(m.body === 'lens+panel+slate' && m.slides === 'steel' && m.pick === 'light', 'the primary tray carries its reading face and smoked channel on steel slides, with a lit cursor');

// typing: what matches, and the first marked
await p.keyboard.type('fe', { delay: 40 }); await p.waitForTimeout(400);
m = await read('use');
say(m.shown.length === 1 && m.shown[0] === 'ferry-cron' && m.active === 'ferry-cron', `typing "fe" leaves what matches (${m.shown.join(', ')}) and marks the first`);
await key('Backspace', 2);
await p.keyboard.type('r', { delay: 40 }); await p.waitForTimeout(400);
m = await read('use');
say(m.shown.length >= 3 && m.active === m.shown[0] && m.selected === 1 && m.pickShown && Math.abs(m.pickY - m.actY) <= 4, `typing "r": ${m.shown.length} rows, the first marked, and the groove is drawn at its row (${m.pickY} px; the row is at ${m.actY})`);
await key('ArrowDown', 2);
m = await read('use');
const third = m.shown[2];
say(m.active === third && m.focus && m.pickShown && Math.abs(m.pickY - m.actY) <= 4, `Down moves the mark down the rows (${m.active}); the focus stays in the field, and the groove goes with it`);
await key('ArrowUp');
m = await read('use');
say(m.active === m.shown[1], 'Up moves it back');
await p.screenshot({ path: 'shots/parts/combobox/hand-typing.png' });
const want = m.active;
await key('Enter');
m = await read('use');
const chosen = await p.evaluate(() => document.getElementById('chosen').textContent);
say(!m.open && m.expanded === 'false' && m.value === want && chosen.includes(m.value) && m.focus,`Enter takes the marked row into the field ("${m.value}"), the rows close, and vx-choose is heard (${chosen})`);

// Escape: closes, then empties
await key('ArrowDown');
m = await read('use');
say(m.open && m.active !== null, 'Down on a shut field opens the rows on the first that matches');
await key('Escape');
m = await read('use');
say(!m.open && m.value !== '' && m.active === null, 'Escape closes the rows and keeps what is in the field');
await key('Escape');
m = await read('use');
say(m.value === '' && !m.open, 'a second Escape empties the field');
await key('ArrowUp');
m = await read('use');
say(m.open && m.active === 'lighthouse-auth', `Up on a shut field opens the rows on the last that can be taken (${m.active}; one that is off is passed over)`);
await key('ArrowDown');
m = await read('use');
say(m.active === 'harbor-api', 'and Down from the last goes round to the first');
await key('Escape');
await p.keyboard.press('Alt+ArrowDown'); await p.waitForTimeout(250);
m = await read('use');
say(m.open && m.active === null, 'Alt+Down opens the rows and marks nothing');

// the mouse
const opt = p.locator('#use-list [role="option"]').nth(3);
const ob = await opt.boundingBox();
await p.mouse.move(ob.x + ob.width / 2, ob.y + ob.height / 2, { steps: 6 }); await p.waitForTimeout(200);
m = await read('use');
say(m.active === 'ferry-cron' && m.focus, 'the pointer over a row marks it; the focus stays in the field');
await p.mouse.down(); await p.waitForTimeout(40);
say(await p.evaluate(() => document.activeElement.id === 'use-q'), 'a press on a row does not take the focus from the field');
await p.mouse.up(); await p.waitForTimeout(350);
m = await read('use');
say(!m.open && m.value === 'ferry-cron', 'and takes it');
const off = p.locator('#use-list [role="option"][aria-disabled="true"]');
await press('#use-q'); await p.keyboard.press('ControlOrMeta+a'); await p.keyboard.press('Backspace'); await p.waitForTimeout(300);
{ await off.scrollIntoViewIfNeeded(); const b = await off.boundingBox(); await p.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await p.waitForTimeout(300); }
m = await read('use');
say(m.value === '' && m.open, `a press on a row that is off takes nothing (the field holds "${m.value}", the rows are ${m.open ? 'out' : 'shut'})`);

// nothing matches: said in words
await p.keyboard.type('Oslo', { delay: 30 }); await p.waitForTimeout(300);
m = await read('use');
say(m.open && m.shown.length === 0 && m.empty === 'No project is called “Oslo”.' && m.active === null && !m.pickShown, `nothing matches: no rows, and it says so in words ("${m.empty}")`);
await key('Enter');
say((await read('use')).value === 'Oslo', 'and Enter takes nothing');

// a press elsewhere, and Tab, close it
await p.mouse.click(1100, 860); await p.waitForTimeout(300);
m = await read('use');
say(!m.open && m.expanded === 'false', 'a press anywhere else closes the rows');
await press('#use-q');
await key('Tab');
m = await read('use');
say(!m.open && !m.focus, 'Tab goes on and closes them');

// set from code
await p.evaluate(() => { const i = document.getElementById('use-q'); i.value = ''; i.dispatchEvent(new Event('input')); i.blur(); });
await p.evaluate(() => { const i = document.getElementById('held-q'); i.setAttribute('aria-expanded', 'true'); i.setAttribute('aria-activedescendant', document.querySelectorAll('#held-list [role="option"]')[0].id); });
await p.waitForTimeout(400);
m = await read('held');
say(m.open && m.active === 'main' && m.pickShown && Math.abs(m.pickY - m.actY) <= 4, 'aria-expanded and aria-activedescendant set from code: the rows come out and that row is marked');
await p.evaluate(() => document.getElementById('held-q').setAttribute('aria-expanded', 'false'));
await p.waitForTimeout(300);
say(!(await read('held')).open, 'and aria-expanded="false" puts them away');
const ob2 = await p.locator('#off-q').boundingBox();
await p.mouse.click(ob2.x + 20, ob2.y + ob2.height / 2); await p.waitForTimeout(250);
const offState = await p.evaluate(() => ({ disabled: document.getElementById('off-q').disabled, open: document.querySelector('#off-list').closest('.vx-combobox-float').matches(':popover-open'), focus: document.activeElement.id }));
say(offState.disabled && !offState.open && offState.focus !== 'off-q', 'a field that is off takes no focus, and a press on it opens nothing');

// the page as shown, with two open
await open();
m = await read('open');
say(m.open && m.active === 'ferry-cron' && m.pickShown && Math.abs(m.pickY - m.actY) <= 4, 'shown open on the page: the second row is marked, the groove at its row');
m = await read('none');
say(m.open && m.empty === 'No region is called “Oslo”.', 'and the one with nothing matching says so');

// a phone (the two shown open are put away first: on a short window they turn over, above their fields)
await p.evaluate(() => { for (const id of ['open-q', 'none-q']) document.getElementById(id).setAttribute('aria-expanded', 'false'); });
await p.setViewportSize({ width: 390, height: 800 }); await p.waitForTimeout(600);
await press('#use-q');
await p.keyboard.type('Р', { delay: 30 }); await p.waitForTimeout(300);
m = await read('use');
const fits = await p.evaluate(() => { const f = document.querySelector('#use .vx-combobox-float').getBoundingClientRect(); return f.left >= 0 && f.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth; });
say(m.open && m.shown.includes('Розгорнути на сервері') && fits, `at 390 px the float stays in the window, and a Ukrainian row is found by its letters (${m.shown.join(', ')}; ${fits ? 'inside' : 'cut'}; "${m.value}", ${m.open ? 'out' : 'shut'}, focus ${m.focus})`);
await p.screenshot({ path: 'shots/parts/combobox/hand-phone.png' });
await p.setViewportSize({ width: 1180, height: 900 });

// plain
const ctx2 = await browser.newContext({ viewport: { width: 1180, height: 900 }, deviceScaleFactor: 1 });
p = await ctx2.newPage(); hear(p);
await p.addInitScript(() => { new MutationObserver((_, o) => { if (document.documentElement) { document.documentElement.setAttribute('data-vx-plain', ''); o.disconnect(); } }).observe(document, { childList: true }); });
await open('&closed');
await press('#use-q');
await p.keyboard.type('t', { delay: 30 }); await key('ArrowDown');
m = await read('use');
const paint = await p.evaluate(() => { const a = document.querySelector('#use-list [data-vx-active]'); return a && getComputedStyle(a).backgroundImage !== 'none'; });
say(await p.evaluate(() => document.querySelectorAll('[data-vx-live]').length) === 0 && m.open && m.active === m.shown[1] && paint, 'with no voxels it works the same, and the mark is painted');
await key('Enter');
say((await read('use')).value === m.shown[1], 'Enter takes it');
await ctx2.close();

// no script: a field you type in
const ctx3 = await browser.newContext({ viewport: { width: 390, height: 800 }, javaScriptEnabled: false });
p = await ctx3.newPage();
await p.goto(url('&closed')); await p.waitForTimeout(400);
await p.locator('#use-q').fill('harbor-api');
say((await p.locator('#use-q').inputValue()) === 'harbor-api' && !(await p.evaluate(() => document.querySelector('#use .vx-combobox-float').matches(':popover-open'))), 'with no script it is a plain field you type in, and the rows stay shut');
await ctx3.close();

say(errors.length === 0, 'no errors' + (errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''));
await browser.close();
process.exit(bad ? 1 : 0);
