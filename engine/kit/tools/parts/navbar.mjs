// The navbar under a real mouse and real keys: a bar on one surface, links that are words, and
// on a narrow bar one key that folds the links away and brings them back.
//   PORT=5989 node tools/parts/navbar.mjs
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const port = process.env.PORT || 5989;
await mkdir('shots/parts/navbar', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
const url = `http://127.0.0.1:${port}/showcase/parts/navbar.html?theme=light`;
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
  await p.waitForTimeout(800);
};
await open();

// a bar as a person finds it: what shows, what the key says, where the focus is
const read = (id) => p.evaluate((id) => {
  const el = document.getElementById(id), key = el.querySelector('.vx-navbar-key'), fold = el.querySelector('.vx-navbar-fold'), nav = el.querySelector('.vx-nav');
  const links = [...nav.querySelectorAll('a')], seen = (n) => !!n && n.getClientRects().length > 0;
  const tops = links.map((a) => Math.round(a.getBoundingClientRect().top));
  const live = window.vx?.live(nav), surface = el.closest('.vx-card');
  return {
    nav: nav.tagName, label: nav.getAttribute('aria-label'), links: links.length, real: links.every((a) => a.matches('a[href]')),
    current: links.find((a) => a.hasAttribute('aria-current'))?.textContent.trim() ?? null,
    keyShown: seen(key), expanded: key.getAttribute('aria-expanded'), controls: key.getAttribute('aria-controls') === fold.id, keyTag: key.tagName,
    keyBox: seen(key) ? [key.offsetWidth, key.offsetHeight] : null, linksShown: links.filter(seen).length, column: new Set(tops).size === links.length && seen(links[0]),
    well: live?.well?.map((v) => v * live.vx) ?? null, barH: el.offsetHeight, surfaceH: surface.offsetHeight, on: el.hasAttribute('data-vx-on'),
    focus: document.activeElement === key ? 'key' : links.includes(document.activeElement) ? 'link ' + (links.indexOf(document.activeElement) + 1) : document.activeElement.tagName,
    linkH: seen(links[0]) ? links[0].offsetHeight : null,
  };
}, id);
const press = async (sel) => { const b = await p.locator(sel).first().boundingBox(); await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 5 }); await p.mouse.down(); await p.waitForTimeout(60); await p.mouse.up(); await p.waitForTimeout(350); };

// wide
let m = await read('site');
say(m.nav === 'NAV' && !!m.label && m.real && m.links === 4 && m.current === 'Deploys', `its links are a <nav> with a name ("${m.label}"), ${m.links} real links, one of them current`);
say(!m.keyShown && m.linksShown === 4 && !m.column, 'wide: the links lie in a row and there is no folding key');
say(m.well && m.well[3] - m.well[1] === 4 && m.well[2] - m.well[0] > 20, `the current link has an accent groove under it (${m.well?.join(', ')} px)`);
const kinds = await p.evaluate(() => [...document.querySelectorAll('#site .vx-button:not(.vx-navbar-key)')].map((b) => b.dataset.vxKind));
say(kinds.length === 1 && kinds[0] === 'main', 'one key at the end, and it is the main one');
await press('#site .vx-nav a:nth-of-type(2)');
m = await read('site');
say(m.current === 'Logs' && m.well, 'a press on a link follows it, and the groove is under it');
await p.screenshot({ path: 'shots/parts/navbar/hand-wide.png' });

// a narrow bar on a wide screen folds by its own width
m = await read('shut');
say(m.keyShown && m.expanded === 'false' && m.linksShown === 0 && m.links === 3, 'a bar in a narrow column folds on a wide screen: the key shows, the links are behind it, none is gone from the page');
m = await read('out');
say(m.keyShown && m.expanded === 'true' && m.linksShown === 3 && m.column, 'one written with aria-expanded="true" is out as the page arrives: a column under the bar');
say(m.well && m.well[2] - m.well[0] === 4 && m.well[3] - m.well[1] > 12, `and there the groove stands at the start of the current link (${m.well?.join(', ')} px)`);

// a phone
await p.setViewportSize({ width: 390, height: 800 }); await p.waitForTimeout(600);
m = await read('site');
const shutH = m.surfaceH;
say(m.keyShown && m.keyTag === 'BUTTON' && m.controls && m.expanded === 'false' && m.linksShown === 0 && m.links === 4, 'at 390 px the links fold behind one key: a button that names what it folds and says it is shut');
say(m.keyBox[0] >= 44 && m.keyBox[1] >= 44, `the key is ${m.keyBox.join(' by ')} px to hit`);
await press('#site-key');
m = await read('site');
say(m.expanded === 'true' && m.linksShown === 4 && m.column && m.surfaceH > shutH, `a press on the key brings them out in a column, and the bar's surface grows to hold them (${shutH} to ${m.surfaceH} px)`);
say(m.linkH >= 44, `each link is ${m.linkH} px tall to hit`);
say(await p.evaluate(() => { const l = window.vx.live(document.querySelector('header.site')); return l.cssH === l.el.offsetHeight; }), 'and the surface was drawn again at its new height');
const inside = await p.evaluate(() => [...document.querySelectorAll('#site a, #site .vx-button')].every((a) => { const r = a.getBoundingClientRect(); return !r.width || (r.left >= 0 && r.right <= innerWidth); }) && document.documentElement.scrollWidth <= innerWidth);
say(inside, 'nothing is cut and the page does not scroll sideways');
await p.screenshot({ path: 'shots/parts/navbar/hand-phone-out.png' });
await press('#site-key');
m = await read('site');
say(m.expanded === 'false' && m.linksShown === 0 && m.surfaceH === shutH, 'a second press folds them away');

// keys
await p.focus('#site-key');
await p.keyboard.press('Enter'); await p.waitForTimeout(300);
m = await read('site');
say(m.expanded === 'true' && m.focus === 'key', 'Enter on the key brings them out; the focus stays on the key');
await p.keyboard.press('Tab');
m = await read('site');
say(m.focus === 'link 1', 'Tab goes on into the links');
await p.keyboard.press('Tab');
await p.keyboard.press('Escape'); await p.waitForTimeout(300);
m = await read('site');
say(m.expanded === 'false' && m.linksShown === 0 && m.focus === 'key', 'Escape folds them away and gives the focus back to the key');
await p.keyboard.press('Space'); await p.waitForTimeout(300);
await p.keyboard.press('Tab'); await p.keyboard.press('Tab'); await p.keyboard.press('Tab');
await p.keyboard.press('Enter'); await p.waitForTimeout(350);
m = await read('site');
say(m.current === 'Team' && m.expanded === 'false', 'Space opens too; Enter on a link follows it, and the links fold away behind it');

// from code
await p.evaluate(() => document.getElementById('site-key').setAttribute('aria-expanded', 'true'));
await p.waitForTimeout(300);
m = await read('site');
say(m.linksShown === 4, 'aria-expanded set from code: the links come out');
await p.setViewportSize({ width: 1180, height: 900 }); await p.waitForTimeout(600);
m = await read('site');
say(!m.keyShown && m.linksShown === 4 && !m.column && m.well && m.well[3] - m.well[1] === 4, 'wide again: the key goes, the links are a row, and the groove lies under the current one again');

// plain: the same behaviour with no voxels
const ctx2 = await browser.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 1 });
p = await ctx2.newPage(); hear(p);
await p.addInitScript(() => { new MutationObserver((_, o) => { if (document.documentElement) { document.documentElement.setAttribute('data-vx-plain', ''); o.disconnect(); } }).observe(document, { childList: true }); });
await open();
m = await read('site');
say(await p.evaluate(() => document.querySelectorAll('[data-vx-live]').length) === 0 && m.on && m.keyShown && m.linksShown === 0, 'with no voxels the bar folds the same way');
await press('#site-key');
m = await read('site');
const paint = await p.evaluate(() => { const s = getComputedStyle(document.querySelector('#site .vx-nav a[aria-current]'), '::before'); return [parseFloat(s.width), parseFloat(s.height)]; });
say(m.expanded === 'true' && m.linksShown === 4 && paint[0] === 4 && paint[1] > 12, `the key brings the links out, and the painted groove stands beside the current one (${paint.join(' by ')} px)`);
await p.keyboard.press('Escape'); await p.waitForTimeout(200);
m = await read('site');
say(m.expanded === 'false' && m.focus === 'key', 'Escape folds them away');
await ctx2.close();

// no script at all: nothing to press, so nothing is hidden
const ctx3 = await browser.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 1, javaScriptEnabled: false });
p = await ctx3.newPage();
await p.goto(url); await p.waitForTimeout(500);
const bare = await p.locator('#site').evaluate((el) => { const seen = (n) => n.getClientRects().length > 0; return { key: seen(el.querySelector('.vx-navbar-key')), links: [...el.querySelectorAll('.vx-nav a')].filter(seen).length, action: seen(el.querySelector('.vx-navbar-fold > .vx-button')), wide: document.documentElement.scrollWidth <= 390 }; });
say(!bare.key && bare.links === 4 && bare.action && bare.wide, 'with no script on a phone the key is not shown and every link is: they wrap under the name, and none is lost');
await p.screenshot({ path: 'shots/parts/navbar/hand-no-script.png' });
await ctx3.close();

say(errors.length === 0, 'no errors' + (errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''));
await browser.close();
process.exit(bad ? 1 : 0);
