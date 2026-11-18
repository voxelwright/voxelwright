// A person at a table: reaches a wide one with Tab, moves it with the arrow keys and a wheel, and
// the page holds still. Also holds the table to what a screen reader needs (a caption, a real
// head, a scope on every heading cell) and the groove to where the head ends. In voxels and
// plain, on a laptop and on a phone. Says ok or FAIL for each thing that must hold.
//   PORT=5989 node tools/parts/table.mjs
import { chromium } from 'playwright';

const port = process.env.PORT || 5989;
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
let bad = 0;
const say = (ok, what) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); };

for (const mode of ['voxels', 'plain']) for (const w of [1280, 390]) {
  const tag = `${mode} ${w}:`;
  const p = await (await browser.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: 1 })).newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  if (mode === 'plain') await p.addInitScript(() => { new MutationObserver((_, o) => { if (document.documentElement) { document.documentElement.setAttribute('data-vx-plain', ''); o.disconnect(); } }).observe(document, { childList: true }); });
  await p.goto(`http://127.0.0.1:${port}/kit/showcase/parts/table.html?theme=light`);
  await p.waitForFunction(() => document.documentElement.dataset.ready === '1');
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(600);

  // what a screen reader needs
  const made = await p.evaluate(() => [...document.querySelectorAll('.vx-table')].map((t) => {
    const region = t.querySelector('.vx-table-scroll'), cap = t.querySelector('caption');
    return {
      id: t.id,
      caption: !!cap && cap.textContent.trim().length > 0 && region.getAttribute('aria-labelledby') === cap.id && region.getAttribute('role') === 'region',
      head: !!t.querySelector('thead') && [...t.querySelectorAll('thead > tr > *')].every((c) => c.tagName === 'TH' && c.getAttribute('scope') === 'col'),
      rows: [...t.querySelectorAll('tbody > tr, tfoot > tr')].every((r) => r.firstElementChild.tagName === 'TH' && r.firstElementChild.getAttribute('scope') === 'row'),
    };
  }));
  say(made.length === 4 && made.every((t) => t.caption), `${tag} every table has a caption, and its scrolling region is named by it`);
  say(made.every((t) => t.head), `${tag} every table has a real head, each cell a th with scope="col"`);
  say(made.every((t) => t.rows), `${tag} every row begins with a th with scope="row"`);

  // the groove: where the head ends
  const rule = await p.evaluate((voxels) => [...document.querySelectorAll('.vx-table')].map((t) => {
    const head = t.querySelector('thead').getBoundingClientRect(), box = t.getBoundingClientRect();
    const th = getComputedStyle(t.querySelector('thead tr:last-child th'));
    const want = head.bottom - box.top - 4;
    if (!voxels) return { id: t.id, off: parseFloat(th.borderBottomWidth) - 4, painted: !th.borderBottomColor.endsWith(', 0)') && th.borderBottomColor !== 'transparent' };
    const l = window.vx.live(t);
    if (!l || !l.well) return { id: t.id, off: NaN };
    const slack = (l.cssH - l.H * l.vx) / 2;
    return { id: t.id, off: l.well[1] * l.vx + slack - want, tall: (l.well[3] - l.well[1]) * l.vx, wide: (l.well[2] - l.well[0]) * l.vx - Math.floor(box.width / 4) * 4, clear: th.borderBottomColor.endsWith(', 0)') || th.borderBottomColor === 'transparent', grid: want % 4 };
  }), mode === 'voxels');
  if (mode === 'voxels') {
    say(rule.every((r) => Math.abs(r.off) < 0.51 && r.tall === 4 && r.wide === 0), `${tag} the groove is cut where the head ends, one voxel tall, as wide as the table's place (off by ${rule.map((r) => r.off.toFixed(2)).join(', ')} px)`);
    say(rule.every((r) => r.grid === 0), `${tag} and the head ends on a whole voxel (${rule.map((r) => r.grid).join(', ')} px over)`);
    say(rule.every((r) => r.clear), `${tag} the painted line under the head is cleared, so the groove is not drawn twice`);
  } else say(rule.every((r) => r.off === 0 && r.painted), `${tag} with no voxels the head's own border is the line, one voxel thick`);

  // the page keeps still
  const page = await p.evaluate(() => { scrollTo(300, 0); const moved = scrollX; scrollTo(0, 0); const wide = [...document.querySelectorAll('.sheet *')].filter((e) => !e.closest('table') && !e.classList.contains('vx-canvas') && e.getBoundingClientRect().right > innerWidth + 0.5).length; return { moved, wide }; });
  say(page.moved === 0 && page.wide === 0, `${tag} the page does not move sideways, and nothing but a table's own cells is wider than the window (${page.wide} are)`);
  const size = await p.evaluate(() => { const e = document.querySelector('#wide .vx-table-scroll'); return [e.scrollWidth, e.clientWidth]; });
  say(size[0] > size[1], `${tag} the wide table is wider than its place (${size[0]} in ${size[1]}): it scrolls inside itself`);
  const lines = await p.evaluate(() => [...document.querySelectorAll('#use tbody td, #use tbody th')].every((c) => c.getBoundingClientRect().height < 50));
  say(lines, `${tag} its cells keep to one line: the table scrolls before its words are broken up`);

  // Tab to the wide table; the ring shows; arrows move it; the caption stays
  await p.evaluate(() => { document.activeElement?.blur(); scrollTo(0, 0); });
  let reached = '';
  for (let i = 0; i < 6 && reached !== 'wide'; i++) { await p.keyboard.press('Tab'); reached = await p.evaluate(() => document.activeElement?.closest('.vx-table')?.id || ''); }
  say(reached === 'wide', `${tag} Tab reaches the wide table`);
  const ring = await p.evaluate(() => { const s = getComputedStyle(document.querySelector('#wide')); return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2; });
  say(ring, `${tag} in focus it has a ring`);
  for (let i = 0; i < 5; i++) await p.keyboard.press('ArrowRight');
  await p.waitForTimeout(350);
  const moved = await p.evaluate(() => { const t = document.querySelector('#wide'), e = t.querySelector('.vx-table-scroll'), c = t.querySelector('caption').getBoundingClientRect(), b = t.getBoundingClientRect(); return { left: e.scrollLeft, page: scrollX, cap: c.left - b.left, capWide: c.width <= b.width + 0.5 }; });
  say(moved.left > 0 && moved.page === 0, `${tag} Right arrow moves the table (${Math.round(moved.left)} px), not the page`);
  say(Math.abs(moved.cap) < 1 && moved.capWide, `${tag} its caption stays where it was, no wider than the table's place`);

  // a wheel turned sideways
  await p.evaluate(() => { document.querySelector('#wide .vx-table-scroll').scrollLeft = 0; });
  await p.locator('#wide').scrollIntoViewIfNeeded();
  const box = await p.locator('#wide .vx-table-scroll').boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await p.mouse.wheel(140, 0);
  await p.waitForTimeout(300);
  const wheel = await p.evaluate(() => [document.querySelector('#wide .vx-table-scroll').scrollLeft, scrollX]);
  say(wheel[0] > 0 && wheel[1] === 0, `${tag} a wheel turned sideways over it moves the table (${Math.round(wheel[0])} px), not the page`);

  // the head grows: the groove follows it
  if (mode === 'voxels') {
    await p.evaluate(() => { const th = document.querySelector('#small thead th'); th.innerHTML = 'Runner<br>and<br>where<br>it is'; });
    await p.waitForTimeout(500);
    const after = await p.evaluate(() => { const t = document.querySelector('#small'), l = window.vx.live(t), head = t.querySelector('thead').getBoundingClientRect(), box = t.getBoundingClientRect(); return l.well[1] * l.vx + (l.cssH - l.H * l.vx) / 2 - (head.bottom - box.top - 4); });
    say(Math.abs(after) < 0.51, `${tag} when a heading grows by two lines the groove moves down with the head (off by ${after.toFixed(2)} px)`);
  }

  say(errors.length === 0, `${tag} no errors` + (errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''));
  await p.context().close();
}
await browser.close();
process.exit(bad ? 1 : 0);
