// A message is words: who, when, the words. Nothing on it is pressed but a link or a key it holds.
// What must hold: each is an article named by who and when; the avatar is only a picture; one that
// follows the same person still says who and when to a screen reader; the words select and wrap;
// yours sits at the far side. Says ok or FAIL for each thing; exit 1 on a failure.
//   PORT=5989 node tools/parts/message.mjs
import { chromium } from 'playwright';

const port = process.env.PORT || 5989;
const url = `http://127.0.0.1:${port}/showcase/parts/message.html`;
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

async function behaves(p, tag) {
  const log = await p.evaluate(() => { const t = document.getElementById('talk'); return `${t.getAttribute('role')}/${t.getAttribute('aria-live') ?? 'polite'}/${!!t.getAttribute('aria-label')}`; });
  say(log === 'log/polite/true', `${tag}the thread is a named, polite log (${log})`);
  const m = await p.evaluate(() => [...document.querySelectorAll('.vx-message')].map((a) => ({
    tag: a.tagName,
    name: a.getAttribute('aria-labelledby').split(' ').map((id) => document.getElementById(id)?.textContent.trim()).join(' '),
    when: a.querySelector('time.vx-message-when')?.getAttribute('datetime') ?? '',
    avatar: [...a.querySelectorAll(':scope > .vx-avatar')].every((v) => v.getAttribute('aria-hidden') === 'true'),
  })));
  say(m.every((x) => x.tag === 'ARTICLE' && /^\S.* \d\d:\d\d$/.test(x.name)), `${tag}every message is an article named by who and when (${m.slice(0, 3).map((x) => `"${x.name}"`).join(', ')} ...)`);
  say(m.every((x) => /^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(x.when)), `${tag}every time says when to a machine too (datetime="${m[0].when}")`);
  say(m.every((x) => x.avatar), `${tag}the avatar is only a picture: the article already says who (aria-hidden on every avatar)`);
  const run = await p.evaluate(() => { const a = document.querySelector('.vx-message[data-vx-run]'), h = a.querySelector('.vx-message-head'), r = h.getBoundingClientRect(); return { seen: r.width > 1 && r.height > 1, text: h.textContent, named: a.getAttribute('aria-labelledby') }; });
  say(!run.seen && run.text.includes('Mina Okafor'), `${tag}one that follows the same person shows only its words, and still says who and when ("${run.text}")`);
  // the words select
  const sel = await p.evaluate(() => { const t = document.querySelector('#theirs .vx-message-text'); return getComputedStyle(t).userSelect; });
  say(sel !== 'none', `${tag}the words can be selected (user-select: ${sel})`);
  // yours: at the far side
  const far = await p.evaluate(() => { const a = document.getElementById('mine'), t = a.querySelector('.vx-message-text').getBoundingClientRect(), h = a.querySelector('.vx-message-head').getBoundingClientRect(), r = a.getBoundingClientRect(); return [Math.round(r.right - t.right), Math.round(r.right - h.right)]; });
  say(far[0] === 0 && far[1] === 0, `${tag}yours sits at the far side (its words ${far[0]} px, its head ${far[1]} px from the edge)`);
  // one not sent: the state is in words, the key to try again is a key, and stands at the far side too
  const unsent = await p.evaluate(() => { const f = document.querySelector('#unsent .vx-message-foot'), k = f.querySelector('.vx-button'), r = document.getElementById('unsent').getBoundingClientRect(); return { words: f.textContent.includes('Not sent'), lamp: f.querySelector('.vx-lamp').getAttribute('aria-hidden'), key: k.tagName, far: Math.round(r.right - k.getBoundingClientRect().right) }; });
  say(unsent.words && unsent.lamp === 'true' && unsent.key === 'BUTTON' && unsent.far <= 8, `${tag}not sent: said in words (the lamp only repeats it), with a key to send again at the far side (${unsent.far} px from the edge, its margin)`);
  await p.focus('#unsent .vx-button');
  say(await p.evaluate(() => document.activeElement.textContent.trim()) === 'Send again', `${tag}the key takes focus`);
}

const p = await open();
await behaves(p, '');
await p.mouse.move(4, 4);
await p.waitForTimeout(1000);
say(await p.evaluate(() => window.vx.stage.awake.size) === 0, 'at rest nothing runs');
await p.context().close();

{
  const q = await open({ plain: true });
  say(await q.locator('[data-vx-live]').count() === 0, 'plain: nothing is drawn in voxels');
  await behaves(q, 'plain: ');
  await q.context().close();
}

for (const plain of [false, true]) {
  const q = await open({ width: 390, plain });
  const m = await q.evaluate(() => {
    scrollTo(200, 0); const moved = scrollX; scrollTo(0, 0);
    const sheet = document.querySelector('.sheet').getBoundingClientRect();
    const out = [...document.querySelectorAll('.vx-message, .vx-message *')].filter((e) => !e.closest('.vx-canvas, svg')).filter((e) => { const r = e.getBoundingClientRect(); return r.width && (r.left < sheet.left - 1 || r.right > sheet.right + 1); }).map((e) => e.textContent.trim().slice(0, 20));
    return { moved, out };
  });
  say(m.moved === 0 && m.out.length === 0, `at 390 px${plain ? ', plain' : ''}: nothing scrolls sideways (${m.moved} px); a long word, a long link and Ukrainian wrap, and nothing is outside the sheet (${m.out.join(', ')})`);
  await q.context().close();
}

say(errors.length === 0, 'no errors' + (errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''));
await browser.close();
process.exit(bad ? 1 : 0);
