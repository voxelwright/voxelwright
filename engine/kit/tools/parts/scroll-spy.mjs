// The scroll spy, under a real wheel, a real mouse and real keys: does it mark the section being
// read, and does it leave the page where the person put it?
//   PORT=5989 node tools/parts/scroll-spy.mjs
import { reachByTab } from '../reach-by-tab.mjs';
import { chromium } from 'playwright';

const port = process.env.PORT || 5989;
const url = `http://127.0.0.1:${port}/kit/showcase/parts/scroll-spy.html?theme=light`;
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
let bad = 0;
const say = (ok, what) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); };
const errors = [];
const open = async (opts = {}, plain = false) => {
  const p = await (await browser.newContext({ viewport: { width: 1100, height: 700 }, deviceScaleFactor: 1, ...opts })).newPage();
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  if (plain) await p.addInitScript(() => { new MutationObserver((_, o) => { if (document.documentElement) { document.documentElement.setAttribute('data-vx-plain', ''); o.disconnect(); } }).observe(document, { childList: true }); });
  await p.goto(url);
  if (opts.javaScriptEnabled !== false) { await p.waitForFunction(() => document.documentElement.dataset.ready === '1'); await p.evaluate(() => document.fonts.ready); }
  await p.waitForTimeout(600);
  return p;
};
// one spy: which links say they are current, where its groove is against the current link
const read = (p, id = 'toc') => p.evaluate((id) => {
  const nav = document.getElementById(id), mark = nav.querySelector('.vx-spy-mark');
  const cur = [...nav.querySelectorAll('a[aria-current]')];
  const a = cur[0], fitting = a?.querySelector('.reading-lens') ?? mark;
  const r = a?.getBoundingClientRect(), m = fitting.getBoundingClientRect(), n = nav.getBoundingClientRect();
  const lenses = [...nav.querySelectorAll('.reading-lens')];
  const lit = lenses.filter(el => {
    const glass = window.vx?.live(el)?.model.byName.glass;
    return glass?.col.some((v, i) => i % 4 === 3 && v > 0);
  });
  return {
    current: cur.map((x) => x.getAttribute('href')), word: a?.getAttribute('aria-current'),
    link: r && { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom }, mark: { x: m.x, y: m.y, w: m.width, h: m.height, right: m.right, bottom: m.bottom }, nav: { x: n.x, right: n.right },
    shown: getComputedStyle(fitting).visibility === 'visible' && getComputedStyle(fitting).opacity === '1',
    live: fitting.hasAttribute('data-vx-live'), powered: lit.map(el => el.parentElement.hash),
    y: scrollY, move: getComputedStyle(fitting).transitionDuration,
  };
}, id);
const near = (a, b, by = 1.5) => Math.abs(a - b) <= by;
const beside = (s) => s.shown && near(s.mark.x, s.link.x + 4) && near(s.mark.y + s.mark.h / 2, s.link.y + s.link.h / 2) && (!s.live || s.powered.join() === s.current.join());
const settle = (p) => p.waitForTimeout(450);

async function spy(p, how) {
  let s = await read(p);
  say(s.y === 0 && s.current.join() === '#install' && s.word === 'location', `${how}: on arrival the page is where it was (0), and one link is marked: ${s.current.join()} (aria-current="${s.word}")`);
  say(beside(s) && s.live === (how === 'voxels'), `${how}: its fixed fitting is centered beside the current link`);
  // the keyboard, before anything else is touched: Tab to the links, Enter on one
  await reachByTab(p, '#toc a'); await p.keyboard.press('Tab'); await p.keyboard.press('Tab');
  const focus = await p.evaluate(() => [document.activeElement.getAttribute('href'), getComputedStyle(document.activeElement).outlineStyle]);
  const yWas = await p.evaluate(() => scrollY);
  await p.keyboard.press('Enter');
  await settle(p);
  s = await read(p);
  say(focus[0] === '#deploy' && focus[1] === 'solid' && yWas === 0 && s.y > 0 && s.current.join() === '#deploy' && beside(s), `${how}: Tab walks the links and shows the focus ring without moving the page; Enter on "${focus[0]}" jumps to it and marks it`);
  await p.mouse.move(700, 350);
  await p.mouse.wheel(0, -5000);
  await settle(p);
  // a real wheel reads down the page
  await p.mouse.move(700, 350);
  const seen = [];
  for (let i = 0; i < 14; i++) {
    await p.mouse.wheel(0, 160);
    await settle(p);
    s = await read(p);
    if (s.current.length !== 1 || !beside(s)) { seen.push('!'); break; }
    if (seen.at(-1) !== s.current[0]) seen.push(s.current[0]);
  }
  say(seen.join(' ') === '#install #configure #deploy #roll-back #logs', `${how}: wheeling down, each section is marked in turn, one at a time, its fitting beside it: ${seen.join(' ')}`);
  const before = await p.evaluate(() => scrollY);
  await p.waitForTimeout(700);
  say(await p.evaluate(() => scrollY) === before, `${how}: left alone, the page stays where the wheel put it (${before})`);
  // a real press on a link: the browser's own jump, and the link is the current one at once
  s = await read(p);
  const box = await p.locator('#toc a[href="#configure"]').boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 });
  await p.mouse.down(); await p.mouse.up();
  await settle(p);
  s = await read(p);
  const at = await p.evaluate(() => [location.hash, Math.round(document.getElementById('configure').getBoundingClientRect().top)]);
  say(at[0] === '#configure' && Math.abs(at[1]) <= 1 && s.current.join() === '#configure' && beside(s), `${how}: pressing "Configure" is the browser's own jump (the address says ${at[0]}, the section is at the top), and it is the one marked`);
  // the mouse is left on the link it pressed (the list stays beside what is read): the wheel still reads on
  await p.mouse.wheel(0, 420);
  await settle(p);
  s = await read(p);
  say(s.current.join() === '#deploy' && beside(s), `${how}: with the mouse still on the pressed link, wheeling on marks the next section (${s.current.join()})`);
  // the last section is short: pressed, it is current though it cannot reach the top
  const last = await p.locator('#toc a[href="#logs"]').boundingBox();
  await p.mouse.move(last.x + last.width / 2, last.y + last.height / 2, { steps: 5 });
  await p.mouse.down(); await p.mouse.up();
  await settle(p);
  s = await read(p);
  const short = await p.evaluate(() => Math.round(document.getElementById('logs').getBoundingClientRect().top));
  say(s.current.join() === '#logs' && beside(s), `${how}: the last link pressed is marked, though its section could only get to ${short} px from the top`);
  // then the person scrolls by themselves, and the page is read again
  await p.mouse.move(700, 350);
  await p.mouse.wheel(0, -5000);
  await settle(p);
  s = await read(p);
  say(s.y === 0 && s.current.join() === '#install' && beside(s), `${how}: wheeled back to the top, the first is marked again`);
}

// ---- voxels
const p = await open();
say(await p.evaluate(() => { const n = document.getElementById('toc'); return n.tagName === 'NAV' && n.getAttribute('aria-label') === 'On this page' && n.querySelectorAll('.reading-lens[aria-hidden="true"]').length === 5 && [...n.querySelectorAll('a')].every((a) => a.getBoundingClientRect().height >= 44); }), 'it is a named nav of real links, each 44 px to press; the five fittings are hidden from a screen reader');
await spy(p, 'voxels');
// Cancel navigation, then move the page without a wheel or a second pointer event.
await p.locator('#toc a[href="#logs"]').evaluate(a => {
  a.addEventListener('click', e => e.preventDefault(), { once: true });
  a.click();
});
await settle(p);
say((await read(p)).current.join() === '#install', 'a canceled jump leaves the lamp on the section still in view');
await p.locator('#deploy').evaluate(el => el.scrollIntoView());
await settle(p);
const programmatic = await read(p);
say(programmatic.current.join() === '#deploy' && beside(programmatic), 'a programmatic scroll lights only the reached section');
await p.evaluate(() => {
  document.documentElement.style.overflowAnchor = 'none';
  document.getElementById('install').style.paddingBottom = innerHeight * 2 + 'px';
});
await settle(p);
say((await read(p)).current.join() === '#install', 'reflow moves a different section under the reading line');
await p.evaluate(() => {
  document.getElementById('install').style.removeProperty('padding-bottom');
  document.documentElement.style.removeProperty('overflow-anchor');
});
// the row that watches a box
let s = await read(p, 'versions');
const under = (s) => s.shown && near(s.mark.x, s.link.x) && near(s.mark.w, s.link.w, 3) && s.mark.h === 4 && near(s.mark.bottom, s.link.bottom);
say(s.current.join() === '#v24' && under(s), 'in a row: the groove lies under the current link');
await p.evaluate(() => document.getElementById('notes').scrollIntoView({ block: 'center' }));
await settle(p);
const v = await p.locator('#notes .vx-scroll-view').boundingBox();
await p.mouse.move(v.x + v.width / 2, v.y + v.height / 2);
const pageWas = await p.evaluate(() => scrollY);
const row = [];
// wheel until the box has reached its end (how far that is depends on how tall its sections are)
for (let i = 0, was = -1; i < 40; i++) { await p.mouse.wheel(0, 60); await settle(p); const at = await p.evaluate(() => document.querySelector('#notes .vx-scroll-view').scrollTop); if (at === was) break; was = at; s = await read(p, 'versions'); if (s.current.length !== 1 || !under(s)) { row.push('!'); break; } if (row.at(-1) !== s.current[0]) row.push(s.current[0]); }
say(row.join(' ') === '#v24 #v23 #v22', `it watches the box its sections scroll in: wheeling the box marks ${row.join(' ')}`);
s = await read(p);
say(s.current.length === 1, `and the page's own spy still has one link marked (${s.current.join()})`);
s = await read(p, 'rtl');
say(s.current.length === 1 && s.shown && near(s.mark.right, s.nav.right) && s.mark.w === 4, 'right to left: the groove stands at the right, the start of the line');
say(await p.evaluate(() => [...document.querySelectorAll('.vx-spy')].every((n) => window.vx.live(n) === null) && window.vx.stage.awake.size === 0 && window.vx.stage.raf === 0), 'at rest nothing runs: no frame is asked for');
await p.context().close();

// ---- prefers-reduced-motion
const q = await open({ reducedMotion: 'reduce' });
s = await read(q);
say(s.move === '0s', 'prefers-reduced-motion: the current fitting changes without travel');
await q.mouse.move(700, 350);
await q.mouse.wheel(0, await q.locator('#configure').evaluate(el => el.getBoundingClientRect().top));
await q.waitForTimeout(450);
s = await read(q);
say(s.current.join() === '#configure' && beside(s), 'and it still marks the section being read');
await q.context().close();

// ---- plain (the script runs, no voxels)
const r = await open({}, true);
await spy(r, 'plain');
await r.context().close();

// ---- no script at all
const n = await open({ javaScriptEnabled: false });
say(await n.evaluate(() => { const a = document.querySelector('#toc a[aria-current="location"]'), other = a.nextElementSibling;
  return a.hash === '#install' && getComputedStyle(a.firstElementChild).backgroundColor !== getComputedStyle(other.firstElementChild).backgroundColor;
}), 'no script: the current fitting has a distinct fill');
await n.locator('#toc a[href="#deploy"]').click();
await n.waitForTimeout(300);
say(await n.evaluate(() => location.hash === '#deploy' && Math.abs(document.getElementById('deploy').getBoundingClientRect().top) <= 1), 'no script: a link pressed jumps to its section');
await n.context().close();

say(errors.length === 0, 'no errors' + (errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''));
await browser.close();
process.exit(bad ? 1 : 0);
