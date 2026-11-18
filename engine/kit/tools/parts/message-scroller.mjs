// A person in the thread: a real wheel, a real mouse and real keys. It keeps to the foot while
// you are there, never moves you while you read back, and shows a key when something new has come
// below. Says ok or FAIL for each thing that must hold; exit 1 on a failure.
//   PORT=5989 node tools/parts/message-scroller.mjs
import { chromium } from 'playwright';

const port = process.env.PORT || 5989;
const url = `http://127.0.0.1:${port}/showcase/parts/message-scroller.html`;
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
let bad = 0;
const say = (ok, what) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); };
const errors = [];

async function open({ plain = false, still = false, width = 1180 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 1000 }, deviceScaleFactor: 1, reducedMotion: still ? 'reduce' : 'no-preference' });
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
const mid = async (p, sel) => { const b = await p.locator(sel).first().boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
const press = async (p, sel) => { await p.locator(sel).first().scrollIntoViewIfNeeded(); const [x, y] = await mid(p, sel); await p.mouse.move(x, y, { steps: 6 }); await p.mouse.down(); await p.waitForTimeout(80); await p.mouse.up(); };
// the thread as it is now: how far from the foot, where it is, and the key
const at = (p, id) => p.evaluate((id) => {
  const v = document.querySelector(`#${id} .vx-scroll-view`), slot = document.querySelector(`#${id} .vx-thread-new`);
  return { gap: Math.round(v.scrollHeight - v.clientHeight - v.scrollTop), top: Math.round(v.scrollTop), key: !slot.hidden, words: slot.textContent.trim(), count: v.querySelectorAll('article').length };
}, id);
const wheel = async (p, id, dy) => { await p.locator(`#${id}`).scrollIntoViewIfNeeded(); const [x, y] = await mid(p, `#${id} .vx-scroll-view`); await p.mouse.move(x, y, { steps: 4 }); await p.mouse.wheel(0, dy); await p.waitForTimeout(350); };
const focused = (p) => p.evaluate(() => { const a = document.activeElement; return a.matches('.vx-scroll-view') ? `the view of #${a.closest('.vx-scroll').id}` : (a.textContent.trim() || a.tagName); });

async function behaves(p, tag) {
  // ---- what it is
  const roles = await p.evaluate(() => [...document.querySelectorAll('.vx-thread .vx-scroll-view')].map((v) => `${v.getAttribute('role')}/${v.getAttribute('aria-live') ?? 'polite'}/${v.tabIndex}`));
  say(roles.every((r) => r === 'log/polite/0'), `${tag}every thread is a polite log that takes focus (${[...new Set(roles)].join(', ')})`);
  const names = await p.evaluate(() => [...document.querySelectorAll('#chat article')].map((a) => a.getAttribute('aria-labelledby').split(' ').map((id) => document.getElementById(id)?.textContent.trim()).join(' ')));
  say(names.length === 4 && names.every((n) => /^\S.* \d\d:\d\d$/.test(n)), `${tag}each message is an article named by who and when ("${names[0]}", "${names[2]}")`);

  // ---- it starts at the foot
  let s = await at(p, 'chat');
  say(s.gap <= 1 && s.top > 0 && !s.key, `${tag}the chat starts at its newest message (${s.gap} px from the foot, scrolled ${s.top} px) with no key`);
  s = await at(p, 'log');
  say(s.gap <= 1 && !s.key, `${tag}so does the small thread (${s.gap} px from the foot)`);

  // ---- at the foot, it keeps to the foot
  await p.evaluate(() => window.arrive('log'));
  await p.waitForTimeout(300);
  s = await at(p, 'log');
  say(s.gap <= 1 && !s.key && s.count === 9, `${tag}at the foot a new message arrives and the thread keeps to it (${s.gap} px from the foot, no key)`);
  await p.evaluate(() => { const t = [...document.querySelectorAll('#log article')].at(-1).querySelector('p'); t.textContent += ' It is still being written, and it grows as the words come in, line after line after line.'; });
  await p.waitForTimeout(300);
  s = await at(p, 'log');
  say(s.gap <= 1 && !s.key, `${tag}the last message grows as it is written, and the thread keeps to its foot (${s.gap} px)`);

  // ---- reading back: never moved, the key appears
  await wheel(p, 'log', -260);
  const back = await at(p, 'log');
  say(back.gap > 100 && !back.key, `${tag}the wheel takes the reader up (${back.gap} px from the foot), and there is no key yet`);
  await p.evaluate(() => window.arrive('log'));
  await p.waitForTimeout(400);
  s = await at(p, 'log');
  say(s.top === back.top, `${tag}a message arrives while they read back: they are not moved (scrolled ${s.top} px, as before ${back.top})`);
  say(s.key && s.words === '1 new message', `${tag}and the key appears, saying "${s.words}"`);
  await p.evaluate(() => window.arrive('log'));
  await p.waitForTimeout(400);
  s = await at(p, 'log');
  say(s.top === back.top && s.words === '2 new messages', `${tag}another: still not moved (${s.top} px), and the key says "${s.words}"`);
  if (!tag) {
    const k = await p.evaluate(() => { const b = document.querySelector('#log .vx-thread-new button'), l = window.vx.live(b), slot = b.parentElement.getBoundingClientRect(), well = document.querySelector('#log .vx-scroll-well').getBoundingClientRect(); return { drawn: !!l?.model && !l.model.parts.every((q) => q.hidden), centred: Math.abs((slot.left + slot.right) / 2 - (well.left + well.right) / 2) <= 1, inside: slot.left >= well.left && slot.right <= well.right && slot.bottom <= well.bottom }; });
    say(k.drawn && k.centred && k.inside, `the key is the kit's key, drawn in voxels, in the middle of the thread's foot (${JSON.stringify(k)})`);
  }
  // the key takes them down, and goes
  await press(p, '#log .vx-thread-new button');
  await p.waitForTimeout(1100);
  s = await at(p, 'log');
  say(s.gap <= 1 && !s.key, `${tag}a press on the key takes them to the foot (${s.gap} px), and the key goes`);
  say(await focused(p) === 'the view of #log', `${tag}the key had focus, so the thread takes it (focus: ${await focused(p)})`);

  // ---- the keyboard: read back with Page Up, go down with the key from Tab and Enter
  await p.focus('#log .vx-scroll-view');
  await p.keyboard.press('PageUp');
  await p.waitForTimeout(500);
  const up = await at(p, 'log');
  await p.evaluate(() => window.arrive('log'));
  await p.waitForTimeout(400);
  s = await at(p, 'log');
  say(up.gap > 100 && s.top === up.top && s.key, `${tag}Page Up reads back (${up.gap} px from the foot); a message arrives; not moved, the key is there`);
  await p.keyboard.press('Tab');
  say(await focused(p) === '1 new message', `${tag}Tab from the thread comes to the key (${await focused(p)})`);
  await p.keyboard.press('Enter');
  await p.waitForTimeout(1100);
  s = await at(p, 'log');
  say(s.gap <= 1 && !s.key && await focused(p) === 'the view of #log', `${tag}Enter takes them down (${s.gap} px), the key goes, and focus is back on the thread`);
  // scrolling to the foot oneself sends the key away too
  await p.keyboard.press('PageUp');
  await p.waitForTimeout(500);
  await p.evaluate(() => window.arrive('log'));
  await p.waitForTimeout(300);
  const had = (await at(p, 'log')).key;
  await p.keyboard.press('End');
  await p.waitForTimeout(700);
  s = await at(p, 'log');
  say(had && s.gap <= 1 && !s.key, `${tag}End, by the reader's own hand, reaches the foot and the key goes`);
  // a hand on the wheel takes over from a journey to the foot
  await wheel(p, 'log', -300);
  await p.evaluate(() => window.arrive('log'));
  await p.waitForTimeout(300);
  await press(p, '#log .vx-thread-new button');
  await p.waitForTimeout(40);
  await wheel(p, 'log', -200);
  await p.waitForTimeout(700);
  s = await at(p, 'log');
  say(s.gap > 30, `${tag}on the way down, a turn of the wheel stops it where the reader wants (${s.gap} px from the foot)`);

  // ---- the thread that was read back as the page came: the key says two
  s = await at(p, 'back');
  say(s.top === 0 && s.key && s.words === '2 new messages', `${tag}reading back while two arrived: at the top still (${s.top} px), the key says "${s.words}"`);
  // a short one: nothing to scroll, no key, no bar
  const short = await p.evaluate(() => ({ key: !document.querySelector('#short .vx-thread-new').hidden, idle: document.querySelector('#short .vx-scroll-bar').hasAttribute('data-vx-idle') }));
  say(!short.key && short.idle, `${tag}a short thread has no key and no bar`);
  // the key's words are the page's own
  await wheel(p, 'uk', -200);
  await p.evaluate(() => window.arrive('uk'));
  await p.waitForTimeout(400);
  s = await at(p, 'uk');
  say(s.key && s.words === '1 нове повідомлення', `${tag}in Ukrainian the key says "${s.words}"`);

  // ---- the chat: what you send is yours, at the foot; the answer comes to the foot
  await p.focus('#words');
  await p.keyboard.type('Thank you, watching it too.');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(300);
  s = await at(p, 'chat');
  const mine = await p.evaluate(() => { const a = [...document.querySelectorAll('#chat article')].at(-1); return a.dataset.vxFrom === 'me' && a.textContent.includes('watching it too'); });
  say(mine && s.gap <= 1, `${tag}what you send is added as yours, and the chat is at its foot (${s.gap} px)`);
  await p.waitForTimeout(1200);
  s = await at(p, 'chat');
  say(s.count === 6 && s.gap <= 1 && !s.key, `${tag}the agent answers, and the chat keeps to it (${s.count} messages, ${s.gap} px from the foot)`);
}

// ---------------------------------------------------------------- voxels
const p = await open();
await behaves(p, '');
await p.mouse.move(4, 4);
await p.waitForTimeout(1200);
say(await p.evaluate(() => window.vx.stage.awake.size) === 0, 'at rest nothing runs');
await p.context().close();

// ---------------------------------------------------------------- reduced motion: the key takes them down at once
{
  const q = await open({ still: true });
  await wheel(q, 'log', -300);
  await q.evaluate(() => window.arrive('log'));
  await q.waitForTimeout(300);
  await press(q, '#log .vx-thread-new button');
  await q.waitForTimeout(60);
  const s = await at(q, 'log');
  say(s.gap <= 1 && !s.key, `reduced motion: the key takes them to the foot at once (${s.gap} px after 60 ms)`);
  await q.context().close();
}

// ---------------------------------------------------------------- plain
{
  const q = await open({ plain: true });
  say(await q.locator('[data-vx-live]').count() === 0, 'plain: nothing is drawn in voxels');
  await behaves(q, 'plain: ');
  await q.context().close();
}

// ---------------------------------------------------------------- on a phone
for (const plain of [false, true]) {
  const q = await open({ width: 390, plain });
  const m = await q.evaluate(() => { scrollTo(200, 0); const moved = scrollX; scrollTo(0, 0); const col = document.querySelector('#chat .vx-scroll-view').clientWidth; const bubbles = [...document.querySelectorAll('#chat .vx-bubble')].map((b) => b.offsetWidth); return { moved, col, widest: Math.max(...bubbles), over: (() => { const v = document.querySelector('#chat .vx-scroll-view').getBoundingClientRect(); return [...document.querySelectorAll('#chat .vx-scroll-view *')].filter((e) => { if (e.closest('.vx-canvas') || e.closest('svg')) return false; const r = e.getBoundingClientRect(); return r.width && (r.left < v.left - 1 || r.right > v.right + 1); }).length; })() }; });
  say(m.moved === 0 && m.over === 0, `at 390 px${plain ? ', plain' : ''}: the page does not scroll sideways (${m.moved} px) and nothing in the chat overflows (${m.over})`);
  say(m.widest >= m.col * 0.7, `at 390 px${plain ? ', plain' : ''}: a long bubble takes most of the thread's width (${m.widest} of ${m.col} px)`);
  await q.context().close();
}

say(errors.length === 0, 'no errors' + (errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''));
await browser.close();
process.exit(bad ? 1 : 0);
