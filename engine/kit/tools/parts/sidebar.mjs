// The sidebar under a real mouse and real keys: a column of links beside the content, parted by
// a standing groove, that a key folds away; on a phone the same key brings it in over the page.
//   PORT=5989 node tools/parts/sidebar.mjs
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const port = process.env.PORT || 5989;
await mkdir('shots/parts/sidebar', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
const url = `http://127.0.0.1:${port}/showcase/parts/sidebar.html?theme=light`;
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

// a sidebar as a person finds it
const read = (id) => p.evaluate((id) => {
  const el = document.getElementById(id), keys = [...document.querySelectorAll(`[aria-controls="${id}"]`)], key = keys[0];
  const nav = el.querySelector('.vx-nav'), links = [...nav.querySelectorAll('a')], seen = (n) => !!n && n.getClientRects().length > 0 && getComputedStyle(n).visibility !== 'hidden';
  const live = window.vx?.live(nav), cur = links.find((a) => a.hasAttribute('aria-current'));
  const r = el.getBoundingClientRect(), g = el.querySelector(':scope > .vx-groove');
  return {
    nav: nav.tagName, label: nav.getAttribute('aria-label'), real: links.every((a) => a.matches('a[href]')), links: links.length,
    current: cur?.textContent.trim() ?? null, shown: seen(el) && r.width > 0, hidden: el.hidden, popover: el.getAttribute('popover'), open: el.matches(':popover-open'),
    expanded: key.getAttribute('aria-expanded'), keyTag: key.tagName, groove: !!g && seen(g) && g.getBoundingClientRect().height > r.height * 0.8,
    well: live?.well?.map((v) => v * live.vx) ?? null, curTop: cur ? cur.getBoundingClientRect().top - nav.getBoundingClientRect().top : null,
    left: r.left, right: r.right, width: r.width, focus: document.activeElement === key ? 'key' : links.includes(document.activeElement) ? 'link ' + document.activeElement.textContent.trim() : document.activeElement?.tagName,
  };
}, id);
const press = async (sel) => { const b = await p.locator(sel).first().boundingBox(); await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 5 }); await p.mouse.down(); await p.waitForTimeout(60); await p.mouse.up(); await p.waitForTimeout(400); };

// beside the content
let m = await read('side');
say(m.nav === 'NAV' && !!m.label && m.real && m.links === 7, `its rows are a <nav> with a name ("${m.label}") and ${m.links} real links`);
say(m.shown && !m.popover && m.expanded === 'true' && m.groove, 'wide: it stands beside the content, its key says it is out, and a standing groove parts it from the rest');
say(m.well && m.well[2] - m.well[0] === 4 && m.well[1] >= m.curTop && m.current === 'harbor-api', `the current link has the accent groove at its start (${m.well?.join(', ')} px)`);
await press('#side a[href="#tide-worker"]');
m = await read('side');
say(m.current === 'tide-worker' && m.well && m.well[1] >= m.curTop && (await p.evaluate(() => document.getElementById('name').textContent)) === 'tide-worker', 'a press on a row follows it, and the groove goes with it');
m = await read('away');
say(!m.shown && m.hidden && m.expanded === 'false', 'one whose key says aria-expanded="false" is folded away as the page arrives');

// its key, with the mouse and with keys
await press('#side-key');
m = await read('side');
say(!m.shown && m.hidden && m.expanded === 'false', 'a press on its key folds it away (the hidden attribute), and the key says so');
await p.screenshot({ path: 'shots/parts/sidebar/hand-folded.png' });
await p.focus('#side-key');
await p.keyboard.press('Enter'); await p.waitForTimeout(300);
m = await read('side');
say(m.shown && m.expanded === 'true' && m.focus === 'key', 'Enter on the key brings it back; the focus stays on the key');
// folded with the focus in it: the focus goes to its key
await p.locator('#side a').first().focus();
await p.evaluate(() => document.getElementById('side-key').setAttribute('aria-expanded', 'false'));
await p.waitForTimeout(300);
m = await read('side');
say(!m.shown && m.focus === 'key', 'aria-expanded set from code folds it, and the focus that was in it goes to its key');
await p.evaluate(() => document.getElementById('away-key').setAttribute('aria-expanded', 'true'));
await p.waitForTimeout(300);
m = await read('away');
say(m.shown && m.well && m.well[2] - m.well[0] === 4, 'and set to "true" brings one out, with its groove drawn');
await p.evaluate(() => document.getElementById('side-key').setAttribute('aria-expanded', 'true'));
await p.waitForTimeout(300);

// a long one scrolls by itself, and its groove goes with its row
const sc = await p.evaluate(() => { const s = document.querySelector('#long .vx-sidebar-scroll'); const before = s.scrollHeight > s.clientHeight; s.scrollTop = 1000; return { scrolls: before, at: s.scrollTop }; });
say(sc.scrolls && sc.at > 0, `a long one in a short window scrolls inside itself (${sc.at} px down)`);

// a phone: over the page
await p.setViewportSize({ width: 390, height: 800 }); await p.waitForTimeout(700);
m = await read('side');
say(m.popover === 'auto' && !m.open && !m.shown && m.expanded === 'false', 'at 390 px it is not beside the content: it is a popover, away, and its key says so');
const flow = await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
say(flow, 'nothing is cut and the page does not scroll sideways');
await press('#side-key');
await p.waitForTimeout(300);
m = await read('side');
say(m.open && m.expanded === 'true' && m.left >= -1 && m.width >= 200 && m.right <= 390, `a press on the key brings it in over the page from its edge (${Math.round(m.left)} to ${Math.round(m.right)} px)`);
say(m.focus === 'link tide-worker', `the focus goes into it, to the current link (${m.focus})`);
say(await p.evaluate(() => { const l = window.vx.live(document.getElementById('side')); return !!l && !l.canvas.hidden && l.model.parts.length > 0 && l.cssH === document.getElementById('side').offsetHeight; }), 'over the page it is drawn as a surface of its own');
await p.screenshot({ path: 'shots/parts/sidebar/hand-phone-over.png' });
await p.keyboard.press('Escape'); await p.waitForTimeout(400);
m = await read('side');
say(!m.open && m.expanded === 'false' && m.focus === 'key', 'Escape sends it away and the focus goes back to the key');
await press('#side-key');
await press('#side a[href="#ferry-cron"]');
m = await read('side');
say(!m.open && m.current === 'ferry-cron' && m.expanded === 'false', 'a link followed in it: the page goes there and the sidebar goes away');
await press('#side-key');
await p.mouse.click(370, 400); await p.waitForTimeout(400);
m = await read('side');
say(!m.open && m.expanded === 'false', 'a press outside it sends it away');

// wide again: beside the content, as it was
await p.setViewportSize({ width: 1180, height: 900 }); await p.waitForTimeout(700);
m = await read('side');
say(m.shown && !m.popover && m.expanded === 'true' && m.groove, 'wide again: beside the content, out, as it was before the window was narrow');

// reduced motion: it is there at once
await p.emulateMedia({ reducedMotion: 'reduce' });
await p.setViewportSize({ width: 390, height: 800 }); await p.waitForTimeout(600);
const t0 = await p.evaluate(() => getComputedStyle(document.getElementById('side')).transitionDuration);
say(t0.split(',').every((d) => parseFloat(d) === 0), `with reduced motion it comes in with no travel (transition ${t0})`);
await p.emulateMedia({ reducedMotion: 'no-preference' });
await p.setViewportSize({ width: 1180, height: 900 }); await p.waitForTimeout(400);

// plain
const ctx2 = await browser.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 1 });
p = await ctx2.newPage(); hear(p);
await p.addInitScript(() => { new MutationObserver((_, o) => { if (document.documentElement) { document.documentElement.setAttribute('data-vx-plain', ''); o.disconnect(); } }).observe(document, { childList: true }); });
await open();
m = await read('side');
say(await p.evaluate(() => document.querySelectorAll('[data-vx-live]').length) === 0 && m.popover === 'auto' && !m.open, 'with no voxels it behaves the same: at 390 px it is a popover, away');
await press('#side-key');
m = await read('side');
const painted = await p.evaluate(() => getComputedStyle(document.getElementById('side')).backgroundColor);
say(m.open && m.expanded === 'true' && painted !== 'rgba(0, 0, 0, 0)', `its key brings it in, painted as a surface (${painted})`);
await p.keyboard.press('Escape'); await p.waitForTimeout(300);
m = await read('side');
say(!m.open && m.focus === 'key', 'Escape sends it away');
await ctx2.close();

// no script: always shown, in the flow
const ctx3 = await browser.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 1, javaScriptEnabled: false });
p = await ctx3.newPage();
await p.goto(url); await p.waitForTimeout(500);
const bare = await p.evaluate(() => { const el = document.getElementById('side'); return { shown: el.getClientRects().length > 0 && !el.hidden, links: [...el.querySelectorAll('a')].filter((a) => a.getClientRects().length).length, wide: document.documentElement.scrollWidth <= 390 }; });
say(bare.shown && bare.links === 7 && bare.wide, 'with no script on a phone it stands in the page with all its links: none is lost');
await ctx3.close();

say(errors.length === 0, 'no errors' + (errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''));
await browser.close();
process.exit(bad ? 1 : 0);
