// The navigation menu under a real mouse and real keys: a site's top links, some of which open a
// float of links (the disclosure pattern), by press, by hover, and by keys.
//   PORT=5989 node tools/parts/navigation-menu.mjs
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const port = process.env.PORT || 5989;
await mkdir('shots/parts/navigation-menu', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
const url = (q = '&closed') => `http://127.0.0.1:${port}/kit/showcase/parts/navigation-menu.html?theme=light${q}`;
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
await open();

const read = (id = 'site') => p.evaluate(async (id) => {
  const { MATERIALS } = await import('/kit/src/index.js');
  const name = (i) => Object.keys(MATERIALS).find((k) => MATERIALS[k].id === i);
  const el = document.getElementById(id), btns = [...el.querySelectorAll(':scope > ul > li > button')];
  const outB = btns.find((b) => document.getElementById(b.getAttribute('popovertarget')).matches(':popover-open'));
  const f = outB && document.getElementById(outB.getAttribute('popovertarget'));
  const a = document.activeElement;
  const l = window.vx?.live(el), fl = f && window.vx?.live(f);
  const cur = [...el.querySelectorAll(':scope > ul > li > :is(a, button)')].find((n) => n.matches('a[aria-current]') || n.hasAttribute('data-vx-current'));
  const cr = cur?.getBoundingClientRect(), n = el.getBoundingClientRect();
  const made = (q) => (q ? [...new Set(q.mats)].map(name).sort().join('+') : '');
  const fr = f?.getBoundingClientRect(), br = outB?.getBoundingClientRect();
  return {
    tag: el.tagName, label: el.getAttribute('aria-label'), roles: [...el.querySelectorAll('[role]')].map((r) => r.getAttribute('role')),
    out: outB?.textContent.trim() ?? null, outs: btns.filter((b) => document.getElementById(b.getAttribute('popovertarget')).matches(':popover-open')).length,
    expanded: btns.filter((b) => b.getAttribute('aria-expanded') === 'true').map((b) => b.textContent.trim()),
    focus: a === document.body ? 'body' : a.closest('.vx-navigation-menu-float') ? 'in ' + (a.querySelector('.vx-nm-name') ?? a).textContent.trim() : el.contains(a) ? 'word ' + a.textContent.trim() : a.tagName,
    current: cur?.textContent.trim() ?? null, well: l?.well?.map((v) => v * l.vx) ?? null, word: cr ? [cr.left - n.left, cr.right - n.left, cr.bottom - n.top] : null,
    body: made(fl?.model.byName.body), light: made(fl?.model.byName.light), mark: made(fl?.model.byName.mark),
    under: fr && br ? Math.round(fr.top - br.bottom) : null, inside: fr ? fr.left >= 0 && fr.right <= innerWidth : null,
  };
}, id);
const under = (m) => m.well && m.word && m.well[3] - m.well[1] === 4 && m.well[0] >= m.word[0] - 1 && m.well[2] <= m.word[1] + 1 && m.well[3] <= m.word[2];
const key = async (k) => { await p.keyboard.press(k); await p.waitForTimeout(300); };
const at = async (sel) => { const b = await p.locator(sel).boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
const press = async (sel) => { const [x, y] = await at(sel); await p.mouse.move(x, y, { steps: 5 }); await p.mouse.down(); await p.waitForTimeout(40); await p.mouse.up(); await p.waitForTimeout(400); };

let m = await read();
say(m.tag === 'NAV' && !!m.label && !m.roles.some((r) => /^menu/.test(r)), `a <nav> with a name ("${m.label}"), with no menu roles: it is navigation`);
say(m.out === null && m.expanded.length === 0 && m.current === 'Docs' && under(m), `nothing out; the current page is in the Docs float, so Docs has the groove under it (${m.well?.join(', ')} px)`);

// a press
await press('#product-k');
m = await read();
say(m.out === 'Product' && m.expanded.join() === 'Product' && m.under >= 4 && m.under <= 24 && m.inside, `a press on a word opens its float under it (${m.under} px under), and the word says so`);
say(m.body === 'panel' && m.light === 'light' && m.mark === '', `the float is a plate of ${m.body} on a ring of ${m.light}; no page in it is current, so no mark`);
await press('#product-k');
m = await read();
say(m.out === null && m.expanded.length === 0, 'a second press closes it');

// hover
await p.mouse.move(1100, 860);
let [x, y] = await at('#docs-k');
await p.mouse.move(x, y, { steps: 6 }); await p.waitForTimeout(500);
m = await read();
say(m.out === 'Docs' && m.mark === 'light', 'the pointer resting on a word opens its float; the current page in it has the accent mark');
await p.screenshot({ path: 'shots/parts/navigation-menu/hand-hover.png' });
await p.mouse.down(); await p.waitForTimeout(40); await p.mouse.up(); await p.waitForTimeout(300);
m = await read();
say(m.out === 'Docs', 'a press just after it opened that way keeps it open instead of closing it');
await p.mouse.move(1100, 860, { steps: 6 }); await p.waitForTimeout(500);
say((await read()).out === 'Docs', 'pressed open, it stays when the pointer leaves');
await p.mouse.click(1100, 860); await p.waitForTimeout(300);
say((await read()).out === null, 'a press outside closes it');
[x, y] = await at('#product-k');
await p.mouse.move(x, y, { steps: 6 }); await p.waitForTimeout(500);
const link = await p.locator('#product a').first().boundingBox();
await p.mouse.move(link.x + 20, link.y + link.height / 2, { steps: 12 }); await p.waitForTimeout(500);
m = await read();
say(m.out === 'Product', 'the pointer can travel from the word into its float and it stays');
await p.mouse.move(1100, 860, { steps: 6 }); await p.waitForTimeout(600);
say((await read()).out === null, 'leaving both, a float opened by the pointer closes');
[x, y] = await at('#product-k');
await p.mouse.move(x, y, { steps: 4 }); await p.waitForTimeout(500);
[x, y] = await at('#docs-k');
await p.mouse.move(x, y, { steps: 4 }); await p.waitForTimeout(500);
m = await read();
say(m.out === 'Docs' && m.outs === 1, 'from one word to the next: one float at a time');
await p.mouse.move(1100, 860, { steps: 4 }); await p.waitForTimeout(600);

// keys
await p.locator('#product-k').focus();
await key('ArrowRight');
say((await read()).focus === 'word Docs', 'Right goes to the next word');
await key('End');
say((await read()).focus === 'word Changes', 'End to the last');
await key('Home');
say((await read()).focus === 'word Product', 'Home to the first');
await key('Enter');
m = await read();
say(m.out === 'Product' && m.focus === 'word Product', 'Enter opens its float; the focus stays on the word');
await key('Tab');
m = await read();
say(m.out === 'Product' && m.focus === 'in Deploys', 'Tab goes on into the float, in the page\'s order');
await key('ArrowDown');
say((await read()).focus === 'in Logs', 'Down goes to the next link in it');
await key('ArrowUp'); await key('ArrowUp');
say((await read()).focus === 'in Розгорнути на сервері', 'Up from the first goes round to the last');
await key('Escape');
m = await read();
say(m.out === null && m.focus === 'word Product', 'Escape closes it and gives the focus back to its word');
await key('ArrowRight');
await key('ArrowDown');
m = await read();
say(m.out === 'Docs' && m.focus === 'in Install', 'Down on a word opens its float on its first link');
await key('ArrowDown');
await key('Enter');
m = await read();
say(m.out === null && (await p.evaluate(() => location.hash)) === '#configure', 'Enter on a link follows it, and the float closes');
await p.locator('#product-k').focus();
await key('Space');
for (let i = 0; i < 5; i++) await key('Tab');
m = await read();
say(m.out === null && m.focus === 'word Docs', `Tab out of the float closes it (${m.focus})`);

// set from code
await p.evaluate(() => { document.querySelector('#docs a[aria-current]').removeAttribute('aria-current'); document.querySelector('#site a[href="#pricing"]').setAttribute('aria-current', 'page'); });
await p.waitForTimeout(300);
m = await read();
say(m.current === 'Pricing' && under(m), 'aria-current set from code: the groove goes under that word');
await press('#product-k');
await press('#product a[href="#logs"]');
m = await read();
say(m.current === 'Product' && under(m) && m.out === null, 'a link followed in a float: its word gets the groove');

// the one shown open
await open('');
m = await read('still');
say(m.out === 'Guides' && m.mark === 'light' && m.current === 'Guides' && under(m), 'shown open on the page: the float has the mark at its current page, and its word the groove');

// a phone
await p.setViewportSize({ width: 390, height: 800 }); await p.waitForTimeout(500);
await p.evaluate(() => document.getElementById('still-float').hidePopover());
await press('#product-k');
m = await read();
const wide = await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
say(m.out === 'Product' && m.inside && wide, 'at 390 px the float stays in the window and nothing scrolls sideways');
await p.screenshot({ path: 'shots/parts/navigation-menu/hand-phone.png' });

// a finger: no hover; a press opens
const ctxT = await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });
p = await ctxT.newPage(); hear(p);
await open();
[x, y] = await at('#product-k');
await p.touchscreen.tap(x, y); await p.waitForTimeout(500);
say((await read()).out === 'Product', 'a tap opens a float (and is not taken for a hover that a second press would close)');
await ctxT.close();

// plain
const ctx2 = await browser.newContext({ viewport: { width: 1180, height: 900 }, deviceScaleFactor: 1 });
p = await ctx2.newPage(); hear(p);
await p.addInitScript(() => { new MutationObserver((_, o) => { if (document.documentElement) { document.documentElement.setAttribute('data-vx-plain', ''); o.disconnect(); } }).observe(document, { childList: true }); });
await open();
await p.locator('#docs-k').focus();
await key('ArrowDown');
m = await read();
const paint = await p.evaluate(() => [getComputedStyle(document.getElementById('docs-k'), '::before').height, getComputedStyle(document.querySelector('#docs a[aria-current]')).backgroundImage !== 'none']);
say(await p.evaluate(() => document.querySelectorAll('[data-vx-live]').length) === 0 && m.out === 'Docs' && m.focus === 'in Install' && paint[0] === '4px' && paint[1], 'with no voxels the keys are the same, and the grooves are painted');
await key('Escape');
say((await read()).focus === 'word Docs', 'Escape gives the focus back');
await ctx2.close();

// no script: the browser's own popovers still open
const ctx3 = await browser.newContext({ viewport: { width: 390, height: 800 }, javaScriptEnabled: false });
p = await ctx3.newPage();
await p.goto(url()); await p.waitForTimeout(400);
await p.locator('#product-k').click(); await p.waitForTimeout(300);
const bare = await p.evaluate(() => { const f = document.getElementById('product'); const r = f.getBoundingClientRect(); return f.matches(':popover-open') && r.left >= 0 && r.right <= innerWidth && f.querySelectorAll('a[href]').length === 4; });
say(bare, 'with no script a word still opens its float of links (the browser\'s own popover, in the middle of the window)');
await ctx3.close();

say(errors.length === 0, 'no errors' + (errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''));
await browser.close();
process.exit(bad ? 1 : 0);
