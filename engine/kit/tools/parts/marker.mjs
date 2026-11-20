// A marker is a line across a thread with a word in it. What must hold: the word is read where it
// stands and the grooves are only seen; the unread pilot carries the accent and says what is new in
// words; a date keeps to the room's own light; long words wrap between the grooves. Says ok or
// FAIL for each thing; exit 1 on a failure.
//   PORT=5989 node tools/parts/marker.mjs
import { chromium } from 'playwright';

const port = process.env.PORT || 5989;
const url = `http://127.0.0.1:${port}/kit/showcase/parts/marker.html`;
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
let bad = 0;
const say = (ok, what) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); };
const errors = [];

async function open({ plain = false, width = 1180 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 1000 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  if (plain) await p.addInitScript(() => { new MutationObserver((_, o) => { if (document.documentElement) { document.documentElement.setAttribute('data-vx-plain', ''); o.disconnect(); } }).observe(document, { childList: true }); });
  await p.goto(`${url}?theme=light`);
  await p.waitForFunction(() => document.documentElement.dataset.ready === '1');
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(800);
  return p;
}

async function behaves(p, tag, live) {
  const m = await p.evaluate(() => [...document.querySelectorAll('.vx-marker')].map((k) => ({ grooves: [...k.querySelectorAll(':scope > .vx-groove')].map((g) => g.getAttribute('aria-hidden')).join(), words: k.querySelector('.vx-marker-word').textContent })));
  say(m.every((x) => x.grooves === 'true,true' && x.words.trim()), `${tag}every marker is a word between two grooves that are only seen ("${m[0].words}")`);
  const day = await p.evaluate(() => document.querySelector('#day time').getAttribute('datetime'));
  say(day === '2026-11-16', `${tag}a date is a <time> (datetime="${day}")`);
  const fresh = p.locator('#new');
  const lamp = fresh.locator('.marker-pilot[aria-hidden="true"]');
  say(await fresh.locator('.vx-marker-word').textContent() === 'New messages' && await lamp.count() === 1,
    `${tag}the unread boundary has one fixed pilot and reads “New messages”`);
  say(await p.locator('.stack [data-vx-kind="new"] > [data-vx-light="accent"]').count() === 2,
    `${tag}the catalog's generic new marker retains its two accent grooves`);
  if (live) {
    const emission = () => lamp.evaluate(el => {
      const lens = window.vx.live(el).model.byName.lens;
      return [lens.count, Math.max(...lens.col.filter((_, i) => i % 4 === 3))];
    });
    const [cells, on] = await emission();
    await fresh.evaluate(el => el.removeAttribute('data-vx-kind'));
    const [unlitCells, off] = await emission();
    await fresh.evaluate(el => { el.dataset.vxKind = 'new'; });
    const [, restored] = await emission();
    say(cells > 0 && cells === unlitCells && on > 0 && off === 0 && restored === on,
      'the same lens stays seated through light, dark and return');
  }
  const grooves = await p.evaluate(() => [...document.querySelectorAll('.vx-marker > .vx-groove')].map((g) => g.getBoundingClientRect().width));
  say(grooves.every((w) => w >= 16), `${tag}no groove is narrower than four voxels (narrowest ${Math.min(...grooves)} px)`);
  if (live) {
    const lit = await p.evaluate(() => [...document.querySelectorAll('#new > .vx-groove, #day > .vx-groove')].map((g) => !!window.vx.live(g)?.model).every(Boolean));
    say(lit, 'every groove is the kit\'s groove, drawn in voxels');
  }
}

const p = await open();
await behaves(p, '', true);
await p.waitForTimeout(600);
say(await p.evaluate(() => window.vx.stage.awake.size) === 0, 'at rest nothing runs');
await p.context().close();

{
  const q = await open({ plain: true });
  say(await q.locator('[data-vx-live]').count() === 0, 'plain: nothing is drawn in voxels');
  await behaves(q, 'plain: ', false);
  const paint = await q.evaluate(() => getComputedStyle(document.querySelector('#new > .vx-groove')).backgroundColor);
  say(paint !== 'rgba(0, 0, 0, 0)', `plain: the new marker's grooves are painted (${paint})`);
  await q.context().close();
}

for (const plain of [false, true]) {
  const q = await open({ width: 390, plain });
  const m = await q.evaluate(() => {
    scrollTo(200, 0); const moved = scrollX; scrollTo(0, 0);
    const sheet = document.querySelector('.sheet').getBoundingClientRect();
    const out = [...document.querySelectorAll('.vx-marker, .vx-marker > *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && (r.left < sheet.left - 1 || r.right > sheet.right + 1); }).length;
    const long = document.getElementById('long'), w = long.querySelector('.vx-marker-word');
    return { moved, out, lines: Math.round(w.offsetHeight / 20), grooves: [...long.querySelectorAll('.vx-groove')].map((g) => g.offsetWidth) };
  });
  say(m.moved === 0 && m.out === 0 && m.lines >= 2 && m.grooves.every((w) => w >= 16), `at 390 px${plain ? ', plain' : ''}: nothing is cut (${m.out}); a long one wraps to ${m.lines} lines and keeps its grooves (${m.grooves.join(', ')} px)`);
  await q.context().close();
}

say(errors.length === 0, 'no errors' + (errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''));
await browser.close();
process.exit(bad ? 1 : 0);
