// Navs under a real mouse and real keys: links to places, the current one marked by an accent
// groove (under it in a row, at its start in a column) or standing as the key in a trench.
//   PORT=5989 node tools/parts/navs.mjs
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const port = process.env.PORT || 5989;
await mkdir('shots/parts/navs', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
const p = await (await browser.newContext({ viewport: { width: 1180, height: 900 }, deviceScaleFactor: 1 })).newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(String(e)));
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
let bad = 0;
const say = (ok, what) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); };
const open = async (query = '') => {
  await p.goto(`http://127.0.0.1:${port}/showcase/parts/navs.html?theme=light${query}`);
  await p.waitForFunction(() => document.documentElement.dataset.ready === '1');
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(800);
};
await open();

// what a nav is, and where its mark is drawn (px from the nav's corner), read from its model
const read = (id) => p.evaluate(async (id) => {
  const { MATERIALS } = await import('/packages/voxelmorphism/src/index.js');
  const name = (i) => Object.keys(MATERIALS).find((k) => MATERIALS[k].id === i);
  const el = document.getElementById(id), l = window.vx.live(el);
  const links = [...el.querySelectorAll('a')], cur = links.find((a) => a.hasAttribute('aria-current'));
  const made = (q) => (q ? [...new Set(q.mats)].map(name).sort().join('+') : '');
  const n = el.getBoundingClientRect(), r = cur?.getBoundingClientRect(), cs = cur && getComputedStyle(cur);
  const { walls, block } = l.model.byName;
  return {
    tag: el.tagName, label: el.getAttribute('aria-label'), hrefs: links.filter((a) => a.matches('a[href]')).length, links: links.length,
    current: cur?.textContent.trim() ?? null, word: cur?.getAttribute('aria-current') ?? null, count: links.filter((a) => a.hasAttribute('aria-current')).length,
    walls: made(walls), block: made(block), well: l.well?.map((v) => v * l.vx) ?? null,
    blockAt: block ? [l.spring('x').x * l.vx, l.spring('y').x * l.vx] : null, moving: l.spring('x').moving || l.spring('y').moving,
    link: r ? { left: r.left - n.left, right: r.right - n.left, top: r.top - n.top, bottom: r.bottom - n.top, padL: parseFloat(cs.paddingLeft), padR: parseFloat(cs.paddingRight) } : null,
    focus: links.indexOf(document.activeElement), width: n.width,
  };
}, id);
const linkBox = (id, i) => p.locator(`#${id} a`).nth(i).boundingBox();
const click = async (id, i) => { const b = await linkBox(id, i); await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 5 }); await p.mouse.down(); await p.waitForTimeout(50); await p.mouse.up(); await p.waitForTimeout(350); };
const under = (m) => m.well && Math.abs(m.well[0] - (m.link.left + m.link.padL)) <= 2 && Math.abs(m.well[2] - (m.link.right - m.link.padR)) <= 2 && m.well[3] <= m.link.bottom && m.well[1] >= m.link.bottom - 12;
const beside = (m) => m.well && m.well[0] <= 8 && m.well[2] - m.well[0] === 4 && m.well[1] >= m.link.top && m.well[3] <= m.link.bottom;

// the row in use
let m = await read('pages');
say(m.tag === 'NAV' && !!m.label && m.hrefs === m.links && m.links === 5, `it is a <nav> with a name ("${m.label}") and ${m.links} real links`);
say(m.current === 'Deploys' && m.word === 'page' && m.count === 1, 'one link is current, and says so with aria-current="page"');
say(m.walls === 'light' && under(m), `the mark is a groove of the accent's light under the current link's words (${m.well?.join(', ')} px for a link from ${m.link.left} to ${m.link.right})`);
await click('pages', 2);
m = await read('pages');
say(m.current === 'Logs' && under(m), 'a press on another link follows it; the page makes it current and the groove is cut under it');
say((await p.evaluate(() => location.hash)) === '#logs' && (await p.evaluate(() => document.getElementById('where').textContent)).includes('Logs'), 'and the link was really followed (the address and the page changed)');

// keys: links are tab stops, Enter follows
await p.locator('#pages a').first().focus();
await p.keyboard.press('Tab'); await p.keyboard.press('Tab');
m = await read('pages');
say(m.focus === 2, `Tab goes from link to link (focus on link ${m.focus + 1})`);
await p.keyboard.press('Tab');
say(await p.evaluate(() => { const a = document.activeElement; const o = getComputedStyle(a); return a.matches('#pages a:focus-visible') && o.outlineStyle !== 'none' && parseFloat(o.outlineWidth) >= 2; }), 'the link in focus shows the focus ring');
await p.keyboard.press('Enter'); await p.waitForTimeout(350);
m = await read('pages');
say(m.current === 'Settings' && under(m) && (await p.evaluate(() => location.hash)) === '#settings', 'Enter follows the link in focus, and the groove goes with it');
await p.screenshot({ path: 'shots/parts/navs/hand-row.png' });

// set from code
await p.evaluate(() => { const links = document.querySelectorAll('#pages a'); links[3].removeAttribute('aria-current'); links[0].setAttribute('aria-current', 'page'); });
await p.waitForTimeout(250);
m = await read('pages');
say(m.current === 'Overview' && under(m), 'aria-current set from code: the groove is drawn again under that link');
await p.evaluate(() => document.querySelector('#pages a[aria-current]').removeAttribute('aria-current'));
await p.waitForTimeout(250);
m = await read('pages');
say(m.well === null && m.walls === '', 'no current link: no groove');

// one that leads nowhere
await p.locator('#under a').nth(1).focus(); await p.keyboard.press('Tab');
const off = await p.evaluate(() => { const a = document.querySelector('#under a[aria-disabled="true"]'); return { href: a.hasAttribute('href'), reached: document.activeElement === a, role: a.getAttribute('role') }; });
say(!off.href && !off.reached && off.role === 'link', 'a link that leads nowhere yet has no href, is not a tab stop, and still says it is a link');

// a column
m = await read('column');
say(m.walls === 'light' && beside(m), `in a column the groove stands at the start of the current link (${m.well?.join(', ')} px; the link is ${m.link.top} to ${m.link.bottom} down)`);
await click('column', 2);
m = await read('column');
say(m.current.startsWith('Secrets') && beside(m), 'a press on another row moves it there');

// seats
m = await read('seats');
say(m.walls === 'slate' && m.block === 'key+light', `seats: a trench of ${m.walls} with a key of ${m.block} in it`);
say(Math.abs(m.blockAt[0] - m.link.left) <= 2 && Math.abs(m.blockAt[1] - m.link.top) <= 2, `the key is on the current seat (${m.blockAt.join(', ')} px for a seat at ${m.link.left}, ${m.link.top})`);
await click('seats', 2);
m = await read('seats');
say(m.current === 'Failed' && m.block === 'key+light' && Math.abs(m.blockAt[0] - m.link.left) <= 2, 'a press on a seat of another width: a key of that width is on it');
// seats of one width (a column): the key slides
const b2 = await linkBox('seats-down', 2);
await p.mouse.move(b2.x + b2.width / 2, b2.y + b2.height / 2, { steps: 5 }); await p.mouse.down(); await p.waitForTimeout(40); await p.mouse.up();
await p.waitForTimeout(60);
m = await read('seats-down');
say(m.current === 'Warsaw' && m.moving, 'a press on another seat of the same width: the key is sliding to it');
await p.waitForTimeout(700);
m = await read('seats-down');
say(!m.moving && Math.abs(m.blockAt[1] - m.link.top) <= 2, 'and comes to rest on it');
m = await read('none');
say(m.walls === 'slate' && m.block === '' && m.current === null, 'a trench with nothing current has no key in it');
await p.screenshot({ path: 'shots/parts/navs/hand-seats.png' });
// the legends on seats are in the key face, which is sharp only from a whole pixel
// (tools/crisp.mjs does not look at seats: its list is keys, tabs and toggles)
await p.waitForTimeout(400);
const offGrid = await p.evaluate(() => {
  const out = [];
  for (const a of document.querySelectorAll('.vx-nav[data-vx-mark="seats"] a')) {
    const w = document.createTreeWalker(a, NodeFilter.SHOW_TEXT); let t; while ((t = w.nextNode()) && !t.data.trim());
    if (!t) continue;
    const r = document.createRange(); r.selectNodeContents(t); const b = r.getBoundingClientRect();
    if (Math.abs(b.left - Math.round(b.left)) > 0.02 || Math.abs(b.top + scrollY - Math.round(b.top + scrollY)) > 0.02) out.push(`${t.data.trim()} ${b.left.toFixed(2)},${b.top.toFixed(2)}`);
  }
  return out;
});
say(offGrid.length === 0, `every legend on a seat starts on a whole pixel${offGrid.length ? ': not ' + offGrid.join(' | ') : ''}`);

// reduced motion: the key does not travel
await p.emulateMedia({ reducedMotion: 'reduce' });
await click('seats', 0);
m = await read('seats');
say(m.current === 'All' && !m.moving && Math.abs(m.blockAt[0] - m.link.left) <= 2, 'with reduced motion the key is on the new seat at once');
await p.emulateMedia({ reducedMotion: 'no-preference' });

// a phone: links wrap, nothing is cut, the groove is still under its link
await p.setViewportSize({ width: 390, height: 800 }); await p.waitForTimeout(600);
await p.evaluate(() => { const links = document.querySelectorAll('#pages a'); links[4].setAttribute('aria-current', 'page'); });
await p.waitForTimeout(300);
m = await read('pages');
const fits = await p.evaluate(() => [...document.querySelectorAll('.vx-nav a')].every((a) => { const r = a.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }) && document.documentElement.scrollWidth <= innerWidth);
say(fits && m.link.top > 20 && under(m), 'at 390 px the links wrap onto a second line, none is cut, and the groove is under the Ukrainian link on that line');
await p.screenshot({ path: 'shots/parts/navs/hand-phone.png' });

// plain: the same marks, painted
await p.setViewportSize({ width: 1180, height: 900 });
await p.addInitScript(() => { new MutationObserver((_, o) => { if (document.documentElement) { document.documentElement.setAttribute('data-vx-plain', ''); o.disconnect(); } }).observe(document, { childList: true }); });
await open();
const plain = await p.evaluate(() => {
  const paint = (sel) => { const a = document.querySelector(sel), s = getComputedStyle(a, '::before'); return { w: parseFloat(s.width), h: parseFloat(s.height), bg: s.backgroundColor }; };
  return { live: document.querySelectorAll('[data-vx-live]').length, row: paint('#pages a[aria-current]'), col: paint('#column a[aria-current]'), seat: getComputedStyle(document.querySelector('#seats a[aria-current]')).backgroundColor, trench: getComputedStyle(document.querySelector('#seats')).backgroundColor };
});
say(plain.live === 0 && plain.row.h === 4 && plain.row.w > 20 && plain.col.w === 4 && plain.col.h > 20 && plain.row.bg !== 'rgba(0, 0, 0, 0)', `with no voxels the groove is painted in the same place (a line ${plain.row.w} by ${plain.row.h} px under, ${plain.col.w} by ${plain.col.h} beside)`);
say(plain.seat !== plain.trench && plain.trench !== 'rgba(0, 0, 0, 0)', 'and the trench and its key are painted');
await click('pages', 0);
say(await p.evaluate(() => document.querySelector('#pages a[aria-current]').textContent.trim()) === 'Overview', 'plain, a press still follows a link');

say(errors.length === 0, 'no errors' + (errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''));
await browser.close();
process.exit(bad ? 1 : 0);
