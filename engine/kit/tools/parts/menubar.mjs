// The menubar under a real mouse and real keys: a row of words that each open the kit's menu,
// with the WAI-ARIA menubar's keys, and the accent groove under the word whose menu is out.
//   PORT=5989 node tools/parts/menubar.mjs
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const port = process.env.PORT || 5989;
await mkdir('shots/parts/menubar', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
const url = `http://127.0.0.1:${port}/showcase/parts/menubar.html?theme=light&closed`;
let p = await (await browser.newContext({ viewport: { width: 1180, height: 900 }, deviceScaleFactor: 1 })).newPage();
const errors = [];
const hear = (pg) => { pg.on('pageerror', (e) => errors.push(String(e))); pg.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); }); };
hear(p);
let bad = 0;
const say = (ok, what) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); };
const open = async (u = url) => {
  await p.goto(u);
  await p.waitForFunction(() => document.documentElement.dataset.ready === '1');
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(800);
};
await open();

// the bar as a person finds it: which menu is out, where the focus is, where the groove is
const read = (id = 'bar') => p.evaluate((id) => {
  const el = document.getElementById(id), words = [...el.querySelectorAll(':scope > li > [role="menuitem"]')];
  const out = words.find((w) => document.getElementById(w.getAttribute('popovertarget')).matches(':popover-open'));
  const a = document.activeElement, menu = a?.closest('[role="menu"]');
  const l = window.vx?.live(el), wr = out?.getBoundingClientRect(), n = el.getBoundingClientRect();
  return {
    role: el.getAttribute('role'), label: el.getAttribute('aria-label'), words: words.map((w) => w.textContent.trim()),
    stops: words.filter((w) => w.tabIndex === 0).map((w) => w.textContent.trim()),
    out: out?.textContent.trim() ?? null, outs: words.filter((w) => document.getElementById(w.getAttribute('popovertarget')).matches(':popover-open')).length,
    expanded: words.filter((w) => w.getAttribute('aria-expanded') === 'true').map((w) => w.textContent.trim()),
    focus: words.includes(a) ? 'word ' + a.textContent.trim() : menu ? `${document.getElementById(menu.getAttribute('aria-labelledby')).textContent.trim()} > ${a.textContent.trim()}` : a?.tagName,
    well: l?.well?.map((v) => v * l.vx) ?? null, word: wr ? [wr.left - n.left, wr.right - n.left, wr.bottom - n.top] : null,
  };
}, id);
const under = (m) => m.well && m.word && m.well[3] - m.well[1] === 4 && m.well[0] >= m.word[0] && m.well[2] <= m.word[1] && m.well[3] <= m.word[2];
const key = async (k) => { await p.keyboard.press(k); await p.waitForTimeout(300); };
const at = async (sel) => { const b = await p.locator(sel).boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };

let m = await read();
say(m.role === 'menubar' && !!m.label && m.words.join() === 'File,Edit,Deploy,Help' && m.out === null, `a menubar with a name ("${m.label}") of ${m.words.length} words, nothing out`);
say(m.stops.join() === 'File', 'one word is the tab stop');

// the mouse
let [x, y] = await at('#bar-edit-k');
await p.mouse.move(x, y, { steps: 5 }); await p.mouse.down(); await p.waitForTimeout(40); await p.mouse.up(); await p.waitForTimeout(400);
m = await read();
say(m.out === 'Edit' && m.expanded.join() === 'Edit' && under(m), `a press on a word brings its menu out; the word says so and has the groove under it (${m.well?.join(', ')} px)`);
[x, y] = await at('#bar-deploy-k');
await p.mouse.move(x, y, { steps: 8 }); await p.waitForTimeout(400);
m = await read();
say(m.out === 'Deploy' && m.outs === 1 && under(m), 'with a menu out, the pointer over another word brings that one out instead');
await p.screenshot({ path: 'shots/parts/menubar/hand-hover.png' });
const item = await p.locator('#bar-deploy [role="menuitem"]').nth(1).boundingBox();
await p.mouse.move(item.x + item.width / 2, item.y + item.height / 2, { steps: 6 }); await p.waitForTimeout(150);
await p.mouse.down(); await p.waitForTimeout(40); await p.mouse.up(); await p.waitForTimeout(400);
m = await read();
say(m.out === null && (await p.evaluate(() => document.getElementById('done').textContent)) === 'Done: Roll back to 4f2c9a1.' && m.well === null, 'a press on a command does it; the menu goes and so does the groove');
await p.mouse.click(1100, 860); await p.waitForTimeout(200);

// keys
await p.keyboard.press('Tab'); // from the page into the bar
let guard = 0;
while (!(await read()).focus.startsWith('word') && guard++ < 10) await p.keyboard.press('Tab');
m = await read();
say(m.focus.startsWith('word '), `Tab reaches the bar (${m.focus})`);
await p.locator('#bar-file-k').focus();
await key('ArrowRight');
m = await read();
say(m.focus === 'word Edit' && m.stops.join() === 'Edit' && m.out === null, 'Right goes to the next word, which becomes the tab stop');
await key('ArrowLeft'); await key('ArrowLeft');
m = await read();
say(m.focus === 'word Help', 'Left from the first goes round to the last');
await key('Home');
say((await read()).focus === 'word File', 'Home goes to the first');
await key('End');
say((await read()).focus === 'word Help', 'End to the last');
await key('Home');
await key('ArrowDown');
m = await read();
say(m.out === 'File' && m.focus === 'File > New project' && under(m), `Down brings the menu out on its first command (${m.focus})`);
await key('ArrowDown');
say((await read()).focus === 'File > Duplicate harbor-api', 'Down in it goes to the next command (the menu\'s own key)');
await key('ArrowRight');
m = await read();
say(m.out === 'Edit' && m.outs === 1 && m.focus === 'Edit > Undo the rename' && under(m), `Right in a menu puts it away and brings the next one out on its first command (${m.focus})`);
await key('ArrowLeft');
m = await read();
say(m.out === 'File' && m.focus === 'File > New project', 'Left in a menu goes back the same way');
await key('Escape');
m = await read();
say(m.out === null && m.focus === 'word File' && m.well === null, `Escape puts it away and gives the focus back to its word (${m.focus})`);
await key('ArrowRight'); await key('ArrowRight');
await key('ArrowUp');
m = await read();
say(m.out === 'Deploy' && m.focus === 'Deploy > Delete the project', `Up brings the menu out on its last command (${m.focus})`);
await key('Escape');
await key('Enter');
m = await read();
say(m.out === 'Deploy' && m.focus === 'Deploy > Deploy main', 'Enter on a word brings its menu out on its first command');
await key('ArrowRight');
say((await read()).focus === 'Help > Keys and chords', 'and Right from there goes on to the next menu');
await key('Escape');
await key('Space');
m = await read();
say(m.out === 'Help' && m.focus === 'Help > Keys and chords', 'Space does as Enter does');
await key('Enter');
m = await read();
say(m.out === null && m.focus === 'word Help' && (await p.evaluate(() => document.getElementById('done').textContent)) === 'Done: Keys and chords.', 'Enter on a command does it, and the focus goes back to its word');
await key('ArrowDown');
await key('Tab');
m = await read();
say(m.out === null && !m.focus.startsWith('Help'), `Tab in a menu puts it away and goes on (${m.focus})`);
await p.locator('#bar-help-k').focus();
await key('ArrowDown');
await p.mouse.click(1100, 860); await p.waitForTimeout(300);
say((await read()).out === null, 'a press anywhere else puts the menu away');

// right to left: the arrows turn round
await p.evaluate(() => { document.getElementById('bar').dir = 'rtl'; });
await p.locator('#bar-file-k').focus();
await key('ArrowLeft');
say((await read()).focus === 'word Edit', 'right to left, Left goes to the next word');
await p.evaluate(() => { document.getElementById('bar').removeAttribute('dir'); });

// the one shown open on the page
await open(url.replace('&closed', ''));
m = await read('still');
say(m.out === 'View' && under(m), 'shown open on the page: the groove is under its word');

// a phone
await p.setViewportSize({ width: 390, height: 800 }); await p.waitForTimeout(600);
const fits = await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth && [...document.querySelectorAll('#bar [role="menuitem"]')].filter((b) => b.closest('li') && !b.closest('[role="menu"]')).every((b) => { const r = b.getBoundingClientRect(); return r.right <= innerWidth && r.height >= 44; }));
say(fits, 'at 390 px the words fit, each 44 px to hit, and nothing scrolls sideways');
await p.setViewportSize({ width: 1180, height: 900 });

// plain
const ctx2 = await browser.newContext({ viewport: { width: 1180, height: 900 }, deviceScaleFactor: 1 });
p = await ctx2.newPage(); hear(p);
await p.addInitScript(() => { new MutationObserver((_, o) => { if (document.documentElement) { document.documentElement.setAttribute('data-vx-plain', ''); o.disconnect(); } }).observe(document, { childList: true }); });
await open();
await p.locator('#bar-file-k').focus();
await key('ArrowDown'); await key('ArrowRight');
m = await read();
const paint = await p.evaluate(() => { const s = getComputedStyle(document.querySelector('#bar-edit-k'), '::before'); return [parseFloat(s.width), parseFloat(s.height)]; });
say(await p.evaluate(() => document.querySelectorAll('[data-vx-live]').length) === 0 && m.out === 'Edit' && m.focus === 'Edit > Undo the rename' && paint[1] === 4 && paint[0] > 10, `with no voxels the keys are the same, and the groove is painted (${paint.join(' by ')} px)`);
await key('Escape');
say((await read()).focus === 'word Edit', 'Escape gives the focus back to its word');
await ctx2.close();

say(errors.length === 0, 'no errors' + (errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''));
await browser.close();
process.exit(bad ? 1 : 0);
