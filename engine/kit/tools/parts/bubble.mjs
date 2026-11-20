// A person reading bubbles: a real mouse selects their words and the keys copy them; a link in one
// is reached and followed; long words and links wrap; on a phone a bubble takes most of the width.
// Theirs is a hole a level into the panel, yours a plate a voxel above it, neither on a light.
// Says ok or FAIL for each thing that must hold; exit 1 on a failure.
//   PORT=5989 node tools/parts/bubble.mjs
import { chromium } from 'playwright';

const port = process.env.PORT || 5989;
const url = `http://127.0.0.1:${port}/kit/showcase/parts/bubble.html`;
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
let bad = 0;
const say = (ok, what) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); };
const errors = [];

async function open({ plain = false, width = 1180 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 1000 }, deviceScaleFactor: 1, permissions: ['clipboard-read', 'clipboard-write'] });
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
// the box of a word in a bubble's text
const word = (p, sel, w) => p.evaluate(([sel, w]) => {
  const el = document.querySelector(sel), t = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let n; while ((n = t.nextNode()) && !n.textContent.includes(w));
  const r = document.createRange(), i = n.textContent.indexOf(w); r.setStart(n, i); r.setEnd(n, i + w.length);
  const b = r.getBoundingClientRect(); return [b.left, b.top + b.height / 2, b.right];
}, [sel, w]);

async function behaves(p, tag, live) {
  // ---- the words select and copy, with the mouse and with the keys
  await p.locator('#first').scrollIntoViewIfNeeded();
  const [x0, y0] = await word(p, '#first', 'Build');
  const [, y1, x1] = await word(p, '#first', 'green.');
  await p.mouse.move(x0 + 1, y0, { steps: 4 }); await p.mouse.down();
  await p.mouse.move(x1 - 1, y1, { steps: 10 }); await p.mouse.up();
  const sel = await p.evaluate(() => getSelection().toString());
  say(sel === 'Build 214 is green.', `${tag}a drag of the mouse selects a bubble's words ("${sel}")`);
  await p.keyboard.press('ControlOrMeta+c');
  const copied = await p.evaluate(() => navigator.clipboard.readText());
  say(copied === 'Build 214 is green.', `${tag}and the keys copy them ("${copied}")`);
  const [dx, dy] = await word(p, '#reply', 'health');
  await p.mouse.dblclick(dx + 4, dy);
  say(await p.evaluate(() => getSelection().toString().trim()) === 'health', `${tag}a double press on a word in yours selects that word`);
  // ---- a link in one is reached by Tab, and followed
  await p.focus('#first');
  await p.evaluate(() => { document.querySelector('#first').tabIndex = -1; document.querySelector('#first').focus(); });
  await p.keyboard.press('Tab');
  const link = await p.evaluate(() => document.activeElement.textContent);
  await p.keyboard.press('Enter');
  say(link === 'the release page' && await p.evaluate(() => location.hash) === '#talk', `${tag}Tab reaches the link in a bubble ("${link}"), and Enter follows it`);
  // ---- long words and links wrap
  const wide = await p.evaluate(() => [...document.querySelectorAll('.vx-bubble')].filter((b) => [...b.children].some((c) => !c.matches('.vx-canvas') && c.scrollWidth > c.clientWidth + 1) || b.getBoundingClientRect().right > b.parentElement.getBoundingClientRect().right + 1).length); // (the voxels' canvas reaches past the bubble on purpose)
  say(wide === 0, `${tag}a long link and a word longer than the line wrap: no bubble is wider than its column (${wide} are)`);
  // ---- the side
  const sides = await p.evaluate(() => {
    const at = (sel) => { const b = document.querySelector(sel).getBoundingClientRect(), c = document.querySelector(sel).closest('.vx-message-body, .state').getBoundingClientRect(); return Math.round(c.right - b.right); };
    return { reply: at('#reply'), quoted: at('#quoted') };
  });
  say(sides.reply === 0, `${tag}yours stands at the far side of its message (${sides.reply} px from it)`);
  if (live) {
    const m = await p.evaluate(() => {
      const of = (sel) => { const l = window.vx.live(document.querySelector(sel)); return { parts: Object.keys(l.model.byName).join(), face: l.faceZ, glow: l.glowStrength ?? 0, sunk: !!l.model.byName.walls?.sunk }; };
      return { theirs: of('#theirs'), mine: of('#mine'), reply: of('#reply'), quoted: of('#quoted'), step: window.vx.live(document.querySelector('#mine')).look.step };
    });
    say(m.theirs.parts === 'walls,floor' && m.theirs.sunk && !m.theirs.glow, `theirs is a hole cut into the panel, with no light (${m.theirs.parts})`);
    say(m.mine.parts === 'plate' && m.mine.face === m.step && !m.mine.glow, `yours is a plate standing the look's step above the panel (${m.mine.face} of ${m.step}), with no light`);
    say(m.reply.parts === 'plate,retainers' && m.reply.face === m.step && !m.reply.glow, 'the in-use reply has fixed retainers and a one-step, unlit reading face');
    say(m.quoted.parts === 'walls,floor', 'theirs quoted in yours keeps its own side (data-vx-from wins over the message\'s)');
    // its side changed from code: drawn again
    await p.evaluate(() => { document.getElementById('theirs').dataset.vxFrom = 'me'; });
    await p.waitForTimeout(300);
    const now = await p.evaluate(() => Object.keys(window.vx.live(document.getElementById('theirs')).model.byName).join());
    say(now === 'plate', `its side set from code: it is drawn again as yours (${now})`);
  }
}

// ---------------------------------------------------------------- voxels
const p = await open();
await behaves(p, '', true);
await p.mouse.move(4, 4);
await p.waitForTimeout(1000);
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
    const out = [...document.querySelectorAll('.vx-bubble')].filter((e) => { const r = e.getBoundingClientRect(); return r.left < sheet.left || r.right > sheet.right; }).length;
    const col = document.querySelector('#talk').clientWidth, first = document.querySelector('#first').offsetWidth, long = document.querySelector('#long').offsetWidth;
    return { moved, out, col, first, long };
  });
  say(m.moved === 0 && m.out === 0, `at 390 px${plain ? ', plain' : ''}: nothing scrolls sideways (${m.moved} px), no bubble is outside the sheet (${m.out})`);
  say(m.first >= m.col * 0.7 && m.long >= m.col * 0.9, `at 390 px${plain ? ', plain' : ''}: a bubble of a full line takes most of the width (${m.first} px in a message of ${m.col}; the long one ${m.long})`);
  await q.context().close();
}

say(errors.length === 0, 'no errors' + (errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''));
await browser.close();
process.exit(bad ? 1 : 0);
