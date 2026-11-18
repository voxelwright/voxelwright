// A person reading what the agent did: a real mouse and real keys on its steps, and the run going
// on to its end. A lamp at each step in the light of its state; the state said in words; a step
// that changes state is said once, and the seconds ticking are not said at all. Says ok or FAIL
// for each thing that must hold; exit 1 on a failure.
//   PORT=5989 node tools/parts/trace.mjs
import { chromium } from 'playwright';

const port = process.env.PORT || 5989;
const url = `http://127.0.0.1:${port}/kit/showcase/parts/trace.html`;
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
const press = async (p, sel) => { await p.locator(sel).first().scrollIntoViewIfNeeded(); const b = await p.locator(sel).first().boundingBox(); await p.mouse.move(b.x + 40, b.y + b.height / 2, { steps: 6 }); await p.mouse.down(); await p.waitForTimeout(80); await p.mouse.up(); };
const lamps = (p, id) => p.evaluate((id) => [...document.querySelectorAll(`#${id} > li`)].map((li) => `${li.dataset.vxState}:${li.querySelector('.vx-lamp').dataset.vxLight ?? 'dark'}`).join(' '), id);
// where the rail is, beside where the first and last lamps are (px, in the list)
const rail = (p, id) => p.evaluate((id) => {
  const el = document.getElementById(id), l = window.vx.live(el), r = el.getBoundingClientRect();
  const ls = [...el.querySelectorAll(':scope > li > .vx-lamp')].map((x) => x.getBoundingClientRect());
  const remY = (l.cssH - l.H * l.vx) / 2;
  return { top: Math.round(l.well[1] * l.vx + remY), bottom: Math.round(l.well[3] * l.vx + remY), first: Math.round(ls[0].top - r.top), last: Math.round(ls.at(-1).bottom - r.top), walls: !!l.model.byName.walls };
}, id);

async function behaves(p, tag, live) {
  // ---- what it is
  const shape = await p.evaluate(() => [...document.querySelectorAll('.vx-trace')].map((t) => `${t.tagName}/${t.getAttribute('aria-live')}/${!!t.getAttribute('aria-label')}`));
  say(shape.every((s) => s === 'OL/off/true'), `${tag}every trace is a named ordered list that is not itself live (${[...new Set(shape)].join(', ')})`);
  const words = await p.evaluate(() => [...document.querySelectorAll('.vx-trace > li')].map((li) => ({ state: li.dataset.vxState, words: li.querySelector('.vx-trace-state')?.textContent.trim() ?? '', hidden: li.querySelector('.vx-lamp').getAttribute('aria-hidden') })));
  say(words.every((w) => w.words && w.hidden === 'true'), `${tag}every step says its state in words; the lamp, which only repeats it, is hidden from a screen reader`);
  const failed = words.filter((w) => w.state === 'failed');
  say(failed.length && failed.every((w) => /^(Failed)/.test(w.words)), `${tag}a failed step says "Failed" in words (${failed.map((w) => `"${w.words}"`).join(', ')})`);
  say(await lamps(p, 'four') === 'done:go running:accent failed:stop waiting:dark', `${tag}the lamps: ${await lamps(p, 'four')}`);
  const status = await p.evaluate(() => [...document.querySelectorAll('.vx-trace')].every((t) => t.nextElementSibling?.matches('.vx-trace-status[role="status"]')));
  say(status, `${tag}after each list, a status line that says a change once`);

  // ---- a step opens: the mouse, then the keys
  await press(p, '#read summary');
  say(await p.evaluate(() => document.getElementById('read').open), `${tag}a press on a step that has more opens it`);
  if (live) {
    await p.waitForTimeout(500);
    const r = await rail(p, 'ship');
    say(r.walls && Math.abs(r.top - r.first) <= 4 && Math.abs(r.bottom - r.last) <= 4, `the rail runs from the first lamp to the last as the step opens (${r.top} to ${r.bottom} px; lamps ${r.first} to ${r.last})`);
  }
  await p.focus('#read summary');
  await p.keyboard.press('Enter');
  say(!(await p.evaluate(() => document.getElementById('read').open)), `${tag}Enter on it closes it`);
  await p.keyboard.press('Space');
  say(await p.evaluate(() => document.getElementById('read').open), `${tag}Space opens it again`);
  await p.keyboard.press('Space');
  if (live) {
    await p.waitForTimeout(500);
    const r = await rail(p, 'ship');
    say(Math.abs(r.bottom - r.last) <= 4, `closed, the rail is short again (${r.bottom} px; the last lamp ends at ${r.last})`);
  }

  // ---- the run goes on: each change of state is said once; the ticks are not
  await p.evaluate(() => {
    window.said = [];
    const s = document.querySelector('#ship + .vx-trace-status');
    new MutationObserver(() => window.said.push(s.textContent)).observe(s, { childList: true, characterData: true, subtree: true });
    window.ticks = 0;
    new MutationObserver(() => window.ticks++).observe(document.querySelector('#ship'), { characterData: true, childList: true, subtree: true });
  });
  await p.evaluate(() => window.run(600));
  await p.waitForTimeout(1600);
  const r = await p.evaluate(() => ({ said: window.said, ticks: window.ticks }));
  const one = r.said.every((s, i) => r.said.indexOf(s) === i);
  say(r.ticks >= 6 && r.said.length >= 2 && r.said.length <= 4 && one, `${tag}the seconds changed ${r.ticks} times; the status said ${r.said.length} things, each once: ${r.said.map((s) => `"${s}"`).join(' / ')}`);
  say(r.said.some((s) => s.includes('Watch the health check for five minutes: Done, 5 min')), `${tag}the last change is said in the step's own words`);
  say(await lamps(p, 'ship') === 'done:go done:go done:go done:go', `${tag}at the end every lamp is green (${await lamps(p, 'ship')})`);
  // from code: a step that fails
  await p.evaluate(() => { const li = document.querySelector('#four > li:nth-of-type(2)'); li.querySelector('.vx-trace-state').textContent = 'Failed: no network'; li.dataset.vxState = 'failed'; });
  await p.waitForTimeout(200);
  const s = await p.evaluate(() => document.querySelector('#four + .vx-trace-status').textContent);
  say(s === 'Installing packages: Failed: no network.' && (await lamps(p, 'four')).startsWith('done:go failed:stop'), `${tag}set from code, a step fails: its lamp turns red, and it is said once: "${s}"`);
  // a step added
  await p.evaluate(() => { const li = document.createElement('li'); li.dataset.vxState = 'running'; li.innerHTML = '<span class="vx-lamp" aria-hidden="true"></span><p class="vx-trace-line"><span class="vx-trace-what">Retry the install</span><span class="vx-trace-state">In progress</span></p>'; document.getElementById('one').append(li); });
  await p.waitForTimeout(300);
  say((await lamps(p, 'one')) === 'done:go running:accent', `${tag}a step added takes the light of its state (${await lamps(p, 'one')})`);
  if (live) { const q = await rail(p, 'one'); say(q.walls && Math.abs(q.bottom - q.last) <= 4, `and the rail now runs to it (${q.bottom} px; its lamp ends at ${q.last})`); }
}

// ---------------------------------------------------------------- voxels
const p = await open();
const one = await p.evaluate(() => !window.vx.live(document.getElementById('one')).model.byName.walls);
say(one, 'a trace of one step has no rail: only its lamp');
await behaves(p, '', true);
await p.mouse.move(4, 4);
await p.waitForTimeout(1200);
say(await p.evaluate(() => window.vx.stage.awake.size) === 0, 'at rest nothing runs');
await p.context().close();

// ---------------------------------------------------------------- plain
{
  const q = await open({ plain: true });
  say(await q.locator('[data-vx-live]').count() === 0, 'plain: nothing is drawn in voxels');
  await behaves(q, 'plain: ', false);
  await q.context().close();
}

// ---------------------------------------------------------------- on a phone
for (const plain of [false, true]) {
  const q = await open({ width: 390, plain });
  const m = await q.evaluate(() => {
    scrollTo(200, 0); const moved = scrollX; scrollTo(0, 0);
    const sheet = document.querySelector('.sheet').getBoundingClientRect();
    const out = [...document.querySelectorAll('.vx-trace, .vx-trace *')].filter((e) => !e.closest('.vx-canvas')).filter((e) => { const r = e.getBoundingClientRect(); return r.width && (r.left < sheet.left - 1 || r.right > sheet.right + 1); }).map((e) => e.textContent.trim().slice(0, 20));
    return { moved, out };
  });
  say(m.moved === 0 && m.out.length === 0, `at 390 px${plain ? ', plain' : ''}: nothing scrolls sideways (${m.moved} px), nothing is outside the sheet (${m.out.join(', ')})`);
  await q.context().close();
}

say(errors.length === 0, 'no errors' + (errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''));
await browser.close();
process.exit(bad ? 1 : 0);
