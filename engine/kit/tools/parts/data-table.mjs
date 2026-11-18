// A person at the data table: a real mouse presses heads, checkboxes and pages, real keys sort
// and turn pages, in voxels and plain, then on a phone and with no script. Says ok or FAIL for
// each thing that must hold.
//   PORT=5989 node tools/parts/data-table.mjs
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const port = process.env.PORT || 5989;
const url = `http://127.0.0.1:${port}/kit/showcase/parts/data-table.html?theme=light`;
await mkdir('shots/parts/data-table', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
let bad = 0;
const say = (ok, what) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); };

async function open({ width = 1180, plain = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
  if (plain) await ctx.addInitScript(() => { new MutationObserver((_, o) => { if (document.documentElement) { document.documentElement.setAttribute('data-vx-plain', ''); o.disconnect(); } }).observe(document, { childList: true }); });
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') p.errors.push(m.text()); });
  await p.goto(url);
  await p.waitForFunction(() => document.documentElement.dataset.ready === '1');
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(700);
  p.ctx = ctx;
  return p;
}
const press = async (p, loc) => { await loc.scrollIntoViewIfNeeded(); const b = await loc.boundingBox(); await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 5 }); await p.mouse.down(); await p.waitForTimeout(70); await p.mouse.up(); await p.waitForTimeout(350); };
// what a table is now: the rows shown (their names, and a column's text), its sort, its ticks, its pages
const read = (p, id, col) => p.evaluate(([id, col]) => {
  const el = document.getElementById(id), rows = [...el.querySelector('tbody').rows];
  const shown = rows.filter((r) => !r.hidden);
  const all = el.querySelector('thead .vx-data-table-pick input');
  const sorted = [...el.querySelectorAll('thead th[aria-sort]')];
  const cur = el.querySelector('.vx-pagination-pages a[aria-current="page"]');
  return {
    names: shown.map((r) => r.querySelector('th').textContent.trim()),
    col: col === undefined ? null : shown.map((r) => r.cells[col].textContent.trim()),
    sort: sorted.map((th) => `${th.textContent.trim()}:${th.getAttribute('aria-sort')}`).join(','),
    all: all ? (all.indeterminate ? 'some' : all.checked ? 'all' : 'none') : null,
    ticked: shown.filter((r) => r.querySelector('.vx-data-table-pick input')?.checked).length,
    tickedAll: rows.filter((r) => r.querySelector('.vx-data-table-pick input')?.checked).length,
    page: cur ? Number(cur.textContent) : null,
    pagerHidden: el.querySelector('.vx-pagination')?.hidden ?? null,
    count: el.querySelector('.vx-data-table-count')?.textContent ?? '',
    prev: el.querySelector('[rel="prev"]')?.getAttribute('aria-disabled') === 'true' ? 'off' : 'on',
    next: el.querySelector('[rel="next"]')?.getAttribute('aria-disabled') === 'true' ? 'off' : 'on',
  };
}, [id, col]);
const heard = (p) => p.evaluate(() => window.heard.splice(0));
// in voxels: every checkbox's cap is where its input says, and the latched page is the current one
const drawn = (p) => p.evaluate(() => {
  const bad = [];
  for (const box of document.querySelectorAll('.vx-data-table .vx-box')) {
    const l = window.vx.live(box), i = box.parentElement.querySelector('input');
    if (!l) continue;
    if (box.closest('tr')?.hidden) continue;
    const want = i.indeterminate ? 0.5 : i.checked ? 1 : 0;
    if (l.spring('on').target !== want) bad.push(i.getAttribute('aria-label'));
  }
  for (const ol of document.querySelectorAll('.vx-data-table .vx-pagination:not([hidden]) .vx-pagination-pages')) {
    const l = window.vx.live(ol), links = [...ol.querySelectorAll(':scope > li > a')];
    if (!l) { bad.push('pages not drawn'); continue; }
    if (l.state.latched !== links.findIndex((a) => a.getAttribute('aria-current') === 'page')) bad.push('pages latched ' + l.state.latched);
  }
  return bad;
});
const head = (p, id, word) => p.locator(`#${id} thead th button`, { hasText: word });
const seat = (p, id, n) => p.locator(`#${id} .vx-pagination-pages a`, { hasText: new RegExp(`^${n}$`) });

for (const plain of [false, true]) {
  const tag = plain ? 'plain' : 'voxels';
  const p = await open({ plain });
  const lives = await p.locator('[data-vx-live]').count();
  say(plain ? lives === 0 : lives > 0, `${tag}: the page is ${plain ? 'plain' : `drawn in voxels (${lives} parts)`}`);

  // as the page arrives: sorted as the markup says, five rows, the pages written
  let s = await read(p, 'deploys');
  say(s.sort === 'Service:ascending' && s.names.join() === 'buoy-auth,dune-media,ferry-cron,fog-site,gull-metrics', `${tag}: as it arrives it is sorted as its markup says (Service, ascending) and shows the first five: ${s.names.join(' ')}`);
  say(s.pagerHidden === false && s.page === 1 && s.prev === 'off' && s.next === 'on' && s.count === 'Services 1 to 5 of 12', `${tag}: the pages are written: page 1 of 3, no previous; "${s.count}"`);
  const u = await read(p, 'people', 3);
  say(u.col.join('|') === '1 200|10|9|7|3|2|' && u.sort === 'Чергувань:descending', `${tag}: a column of numbers, descending, is sorted as numbers, the empty cell last: ${u.col.join(' | ')}`);
  say(u.all === 'some' && u.ticked === 2, `${tag}: two of seven chosen: the head's box is half way (${u.all})`);
  if (!plain) {
    say((await drawn(p)).length === 0, `${tag}: every checkbox is drawn as its input says, and the current page is the one latched down`);
    say(await p.evaluate(() => window.vx.stage.awake.size) === 0, `${tag}: at rest nothing runs`);
  }
  const small = await p.evaluate(() => [...document.querySelectorAll('.vx-data-table-sort, .vx-data-table-pick > .vx-check')].filter((e) => e.getClientRects().length).map((e) => e.getBoundingClientRect()).filter((r) => r.width < 44 || r.height < 44).length);
  say(small === 0, `${tag}: every head you can press and every checkbox shown is at least 44 px each way (${small} smaller)`);
  const real = await p.evaluate(() => [...document.querySelectorAll('.vx-data-table thead th')].every((th) => !th.querySelector('button') || (th.querySelector(':scope > button[type="button"]') && !th.hasAttribute('tabindex'))));
  say(real, `${tag}: a head you can sort by is a real <button> inside its <th>`);
  const grid = await p.evaluate(() => [...document.querySelectorAll('.vx-data-table thead tr')].map((r) => r.getBoundingClientRect().height));
  // 11 voxels of head, and the voxel of the groove's own border under it
  say(grid.every((h) => h === 48), `${tag}: every head row is 11 voxels and its groove 1, so the groove is on the grid (${[...new Set(grid)].join(', ')} px)`);

  // a real mouse on a head of numbers
  await press(p, head(p, 'deploys', 'Deploys'));
  s = await read(p, 'deploys', 4);
  say(s.sort === 'Deploys:ascending' && s.col.join() === '0,1,2,3,4', `${tag}: a press on Deploys sorts by it as numbers, ascending, and only that head has aria-sort: ${s.col.join(' ')}`);
  let h = await heard(p);
  say(h.length === 1 && h[0].type === 'vx-sort' && h[0].column === 4 && h[0].direction === 'ascending', `${tag}: the page hears vx-sort once: ${JSON.stringify(h.map((e) => [e.type, e.column, e.direction]))}`);
  await press(p, head(p, 'deploys', 'Deploys'));
  s = await read(p, 'deploys', 4);
  say(s.sort === 'Deploys:descending' && s.col.join() === '21,14,12,10,9', `${tag}: pressed again, descending: ${s.col.join(' ')}`);
  await heard(p);

  // a value that is not its text, and an empty one
  await press(p, head(p, 'deploys', 'Build time'));
  s = await read(p, 'deploys', 5);
  say(s.col.join('|') === '21 s|29 s|33 s|38 s|45 s', `${tag}: Build time sorts by data-vx-value (seconds), not its words: ${s.col.join(' | ')}`);
  await press(p, seat(p, 'deploys', 3));
  s = await read(p, 'deploys', 5);
  say(s.page === 3 && s.names.at(-1) === 'wharf-docs' && s.col.at(-1) === '', `${tag}: the service never built is last (${s.names.join(' ')})`);
  await press(p, head(p, 'deploys', 'Build time'));
  s = await read(p, 'deploys', 5);
  say(s.page === 1 && s.col[0] === '3 min 40 s', `${tag}: descending, the longest first, and a sort goes back to page 1 (${s.col[0]})`);
  await press(p, seat(p, 'deploys', 3));
  s = await read(p, 'deploys');
  say(s.names.at(-1) === 'wharf-docs', `${tag}: and the empty one is still last`);

  // keys: Enter and Space on a head
  await p.locator('#deploys thead th button', { hasText: /^By$/ }).focus();
  await p.keyboard.press('Enter');
  await p.waitForTimeout(250);
  s = await read(p, 'deploys', 3);
  say(s.sort === 'By:ascending' && s.page === 1 && s.col.every((v) => v === 'Ada'), `${tag}: Enter on By sorts by it (${s.col.join(' ')})`);
  const order = (await p.evaluate(() => [...document.querySelectorAll('#deploys tbody tr')].filter((r) => r.cells[3].textContent === 'Ada').map((r) => r.querySelector('th').textContent)));
  // they were by build time, longest first, the empty one last
  say(order.join() === 'kelp-search,fog-site,gull-metrics,ferry-cron,wharf-docs', `${tag}: rows that are equal keep the order they had, longest build first (${order.join(' ')})`);
  await p.keyboard.press('Space');
  await p.waitForTimeout(250);
  s = await read(p, 'deploys', 3);
  say(s.sort === 'By:descending' && s.col.every((v) => v === 'Oren' || v === 'Mina'), `${tag}: Space sorts it the other way (${s.col.join(' ')})`);
  const ring = await p.evaluate(() => { const b = document.activeElement, cs = getComputedStyle(b); return b.matches('.vx-data-table-sort:focus-visible') && cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2; });
  say(ring, `${tag}: the head in focus shows a ring`);
  await heard(p);

  // words in the page's language
  await press(p, head(p, 'people', "Ім'я"));
  const uk = (await read(p, 'people')).names;
  say(uk.join(' ') === 'Борис Галина Ґанна Євген Іван Їжа Яр', `${tag}: Ukrainian words in Ukrainian order (a sort by code points puts Є, І, Ї first and Ґ last): ${uk.join(' ')}`);

  // choosing: the head's box for the rows of the page shown
  await press(p, p.locator('#people thead .vx-check'));
  let c = await read(p, 'people');
  say(c.all === 'all' && c.ticked === 7, `${tag}: a press on the half-way head box chooses every row (${c.ticked})`);
  h = await heard(p);
  say(h.some((e) => e.type === 'vx-select' && e.count === 7), `${tag}: the page hears vx-select with 7 rows`);
  await press(p, p.locator('#people tbody tr', { hasText: 'Іван' }).locator('.vx-check'));
  c = await read(p, 'people');
  say(c.all === 'some' && c.ticked === 6 && c.count === 'Усього 7 · вибрано 6', `${tag}: one let go: the head box is half way again; "${c.count}"`);
  await press(p, p.locator('#people tbody tr', { hasText: 'Іван' }).locator('.vx-check'));
  await press(p, p.locator('#people thead .vx-check'));
  c = await read(p, 'people');
  say(c.all === 'none' && c.ticked === 0, `${tag}: all of them, then the head box again: none chosen`);
  if (!plain) { await p.waitForTimeout(400); say((await drawn(p)).length === 0, `${tag}: and every cap is where its input says`); }

  await press(p, head(p, 'deploys', 'Service'));
  await press(p, p.locator('#deploys tbody tr:not([hidden])', { hasText: 'dune-media' }).locator('.vx-check'));
  s = await read(p, 'deploys');
  say(s.all === 'some' && s.count === 'Services 1 to 5 of 12 · 1 chosen' && !(await p.locator('#redeploy').isDisabled()), `${tag}: one service chosen: the head box is half way, the count says so, and the page's key is on`);
  await press(p, p.locator('#deploys thead .vx-check'));
  s = await read(p, 'deploys');
  say(s.all === 'all' && s.ticked === 5 && s.tickedAll === 5, `${tag}: the head box chooses the five on this page and no others (${s.tickedAll} in all)`);
  await heard(p);

  // pages: the mouse, the next key, the keyboard
  await press(p, seat(p, 'deploys', 2));
  s = await read(p, 'deploys');
  say(s.page === 2 && s.names.join() === 'harbor-api,kelp-search,pier-mail,reef-billing,salt-queue' && s.all === 'none' && s.count.startsWith('Services 6 to 10 of 12'), `${tag}: a press on 2: the next five, and the head box is for them (${s.all}); "${s.count}"`);
  h = await heard(p);
  say(h.length === 1 && h[0].type === 'vx-page' && h[0].page === 2 && h[0].pages === 3, `${tag}: the page hears vx-page: ${JSON.stringify(h.map((e) => [e.type, e.page, e.pages]))}`);
  await press(p, p.locator('#deploys [rel="next"]'));
  s = await read(p, 'deploys');
  say(s.page === 3 && s.names.length === 2 && s.next === 'off' && s.prev === 'on', `${tag}: the next key: page 3, two rows, and no next (${s.names.join(' ')})`);
  if (!plain) {
    await p.waitForTimeout(400);
    say((await drawn(p)).length === 0, `${tag}: the current page is latched down, and the caps of the rows shown are as their inputs`);
    const keys = await p.evaluate(() => ['prev', 'next'].map((r) => window.vx.live(document.querySelector(`#deploys [rel="${r}"]`))?.state.off));
    say(keys[0] === false && keys[1] === true, `${tag}: the next key is drawn switched off (steel), the previous one is a key again`);
  }
  await p.locator('#deploys .vx-pagination-pages a', { hasText: /^1$/ }).focus();
  await p.keyboard.press('Enter');
  await p.waitForTimeout(350);
  s = await read(p, 'deploys');
  const focus = await p.evaluate(() => document.activeElement.getAttribute('aria-current'));
  say(s.page === 1 && s.all === 'all' && focus === 'page', `${tag}: Enter on page 1 goes there, focus stays on its seat, and the five chosen are still chosen`);
  await heard(p);

  // a table sorted somewhere else
  await press(p, head(p, 'server', 'Builds today'));
  const now = await read(p, 'server', 1);
  await p.waitForTimeout(700);
  const later = await read(p, 'server', 1);
  say(now.sort === 'Builds today:ascending' && now.col.join() === '31,28,4' && later.col.join() === '4,28,31', `${tag}: told no with preventDefault(), the part leaves the rows alone (${now.col.join(' ')}) and the page's own come back (${later.col.join(' ')})`);

  // no rows
  const e = await read(p, 'empty');
  say(e.pagerHidden === true && e.all === 'none' && e.count === '0 failed deploys this week', `${tag}: no rows: no pages, the head box empty, "${e.count}"`);

  // a row added by the app
  await p.evaluate(() => { const tr = document.querySelector('#empty tbody').insertRow(); tr.innerHTML = '<td class="vx-data-table-pick"><label class="vx-check"><input type="checkbox" aria-label="Choose tide-worker"><span class="vx-box"></span></label></td><th scope="row">tide-worker</th><td class="vx-num">09:30</td>'; });
  await p.waitForTimeout(300);
  const e2 = await read(p, 'empty');
  say(e2.count === '1 failed deploys this week' && e2.pagerHidden === true, `${tag}: a row the app adds is counted: "${e2.count}"`);

  await p.screenshot({ path: `shots/parts/data-table/hand-${tag}.png`, fullPage: true });
  say(p.errors.length === 0, `${tag}: no errors` + (p.errors.length ? ': ' + [...new Set(p.errors)].join(' | ') : ''));
  await p.ctx.close();
}

// a phone
for (const plain of [false, true]) {
  const tag = plain ? 'phone, plain' : 'phone, voxels';
  const p = await open({ width: 390, plain });
  const wide = await p.evaluate(() => { scrollTo(200, 0); const x = scrollX; scrollTo(0, 0); return x; });
  say(wide === 0, `${tag}: the page does not move sideways; a wide table scrolls inside itself`);
  await press(p, seat(p, 'deploys', 2));
  const s = await read(p, 'deploys');
  say(s.page === 2, `${tag}: a press on 2 turns the page`);
  say(p.errors.length === 0, `${tag}: no errors` + (p.errors.length ? ': ' + [...new Set(p.errors)].join(' | ') : ''));
  await p.ctx.close();
}

// no script: every row is there, in the order written, and nothing offers what it cannot do
{
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 900 }, javaScriptEnabled: false });
  const p = await ctx.newPage();
  await p.goto(url);
  const s = await p.evaluate(() => {
    const el = document.getElementById('deploys');
    return { rows: [...el.querySelectorAll('tbody tr')].filter((r) => r.getClientRects().length).length, pager: getComputedStyle(el.querySelector('.vx-pagination')).display, mark: getComputedStyle(el.querySelector('.vx-data-table-sort'), '::after').display };
  });
  say(s.rows === 12 && s.pager === 'none' && s.mark === 'none', `no script: all ${s.rows} rows can be read, the pages are not shown (${s.pager}), and no head shows a sort mark (${s.mark})`);
  await ctx.close();
}

await browser.close();
console.log(bad ? `${bad} to fix` : 'ok: data-table');
process.exit(bad ? 1 : 0);
