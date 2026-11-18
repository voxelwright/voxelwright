// A person at the checkboxes: a real mouse and real keys, with voxels and plain. Says ok or FAIL
// for each thing that must hold.
//   PORT=5989 node tools/parts/checkbox.mjs
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const port = process.env.PORT || 5989;
await mkdir('shots/parts/checkbox', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
let bad = 0;
const boxes = {};
for (const mode of ['live', 'plain']) {
  const p = await (await browser.newContext({ viewport: { width: 1180, height: 900 }, deviceScaleFactor: 1 })).newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const say = (ok, what) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${mode}: ${what}`); };
  const press = async (loc, fx = 0.5) => { const b = await loc.boundingBox(); await p.mouse.move(b.x + b.width * fx, b.y + b.height / 2, { steps: 6 }); await p.mouse.down(); await p.waitForTimeout(80); await p.mouse.up(); };
  // a checkbox as its input says it, and as the voxels show it: which of the cap's three states
  // is drawn (cap: dark, lit: its lamp on, some: a bar of light), and how far down it is
  const read = (id) => p.evaluate((id) => {
    const i = document.getElementById(id), l = window.vx?.live(i.parentElement.querySelector('.vx-box'));
    const level = i.indeterminate ? 0.5 : i.checked ? 1 : 0;
    if (!l) return { level, drawn: false };
    const shown = ['cap', 'lit', 'some'].filter((n) => !l.model.byName[n].hidden);
    return { level, drawn: true, to: l.spring('on').target, at: l.spring('on').x, shown: shown.join(), tz: +l.model.byName[shown[0]].tz.toFixed(2), travel: l.look.travel, step: l.look.step, held: l.spring('press').target, glow: l.glowStrength, off: l.state.off };
  }, id);
  const want = { 0: 'cap', 0.5: 'some', 1: 'lit' };
  // the input and the button agree: it is where its input says, showing what its input says
  const agrees = (s) => (mode === 'plain' ? true : s.drawn && s.to === s.level && s.at === s.level && s.shown === want[s.level] && s.tz === -s.travel * s.level);
  if (mode === 'plain') await p.addInitScript(() => { new MutationObserver((_, o) => { if (document.documentElement) { document.documentElement.setAttribute('data-vx-plain', ''); o.disconnect(); } }).observe(document, { childList: true }); });
  await p.goto(`http://127.0.0.1:${port}/kit/showcase/parts/checkbox.html?theme=light`);
  await p.waitForFunction(() => document.documentElement.dataset.ready === '1');
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(700);
  const lives = await p.locator('[data-vx-live]').count();
  say(mode === 'live' ? lives > 0 : lives === 0, mode === 'live' ? `the page is drawn in voxels (${lives} parts)` : 'the page is plain');
  say(await p.evaluate(() => [...document.querySelectorAll('.vx-check')].every((l) => l.tagName === 'LABEL' && l.querySelector('input')?.type === 'checkbox' && l.querySelector('input + .vx-box') && l.textContent.trim())), 'every one is a real checkbox in its own label, with words');
  say(await p.evaluate(() => [...document.querySelectorAll('.vx-check')].every((l) => l.getBoundingClientRect().height >= 44)), 'every one is at least 44 px tall to hit');
  boxes[mode] = await p.evaluate(() => [...document.querySelectorAll('.vx-check, .vx-box')].map((e) => { const r = e.getBoundingClientRect(); return [r.left, r.top + scrollY, r.width, r.height].map((v) => Math.round(v * 10) / 10).join(' '); }).join(';'));

  // as the page arrives
  let s = await read('tests'), t = await read('post'), u = await read('some');
  say(s.level === 1 && agrees(s) && t.level === 0 && agrees(t) && u.level === 0.5 && agrees(u), 'as the page arrives each is as its input says' + (mode === 'live' ? `: ticked is latched down with its lamp on (${s.shown}, ${s.tz}), empty stands up dark (${t.shown}, ${t.tz}), some of them is half way with a bar of light (${u.shown}, ${u.tz})` : ''));
  if (mode === 'live') {
    say(s.glow > 0 && t.glow === 0, `only one that is ticked has light (halo ${s.glow.toFixed(4)} ticked, ${t.glow} empty)`);
    say(await p.evaluate(() => window.vx.stage.awake.size) === 0, 'at rest nothing runs');
  }

  // the mouse: on the words, and on the button
  await press(p.locator('label:has(#post)'), 0.6);
  await p.waitForTimeout(500);
  t = await read('post');
  say(t.level === 1 && agrees(t), 'a press on its words ticks it' + (mode === 'live' ? `: it goes down and its lamp comes on (${t.shown}, ${t.tz})` : ''));
  await press(p.locator('label:has(#post) .vx-box'));
  await p.waitForTimeout(500);
  t = await read('post');
  say(t.level === 0 && agrees(t), 'a press on the button itself unticks it' + (mode === 'live' ? `: it comes up dark (${t.shown}, ${t.tz})` : ''));
  if (mode === 'live') {
    // held: the first frame answers, whichever way it rests
    for (const id of ['post', 'tests']) {
      const b = await p.locator(`label:has(#${id}) .vx-box`).boundingBox();
      await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 4 });
      await p.mouse.down();
      await p.waitForTimeout(250);
      const h = await read(id);
      say(h.held === -h.step && h.tz === -h.travel * h.level - h.step, `held down, one that is ${h.level ? 'ticked' : 'empty'} goes a step under where it rests (${h.tz})`);
      await p.mouse.move(b.x + b.width / 2, b.y - 60, { steps: 4 }); // dragged off before letting go
      await p.mouse.up();
      await p.waitForTimeout(400);
      const a = await read(id);
      say(a.held === 0 && a.level === h.level && agrees(a), 'dragged off before letting go, it is not changed and comes back to rest');
    }
  }

  // keys
  await p.evaluate(() => document.getElementById('tests').focus());
  await p.keyboard.press('Space');
  if (mode === 'live') await p.waitForFunction(() => window.vx.stage.awake.size === 0);
  s = await read('tests');
  say(s.level === 0 && agrees(s), 'Space unticks the one in focus');
  await p.keyboard.press('Tab');
  say(await p.evaluate(() => document.activeElement.id) === 'post', 'Tab goes to the next: each is a tab stop of its own');
  await p.keyboard.press('Space');
  if (mode === 'live') await p.waitForFunction(() => window.vx.stage.awake.size === 0);
  t = await read('post');
  say(t.level === 1 && agrees(t), 'and Space ticks it');
  const ring = await p.evaluate(() => { const c = getComputedStyle(document.activeElement.parentElement.querySelector('.vx-box')); return document.activeElement.matches(':focus-visible') && c.outlineStyle === 'solid' && parseFloat(c.outlineWidth) >= 2; });
  say(ring, 'focus from the keyboard shows a ring round the button');
  await p.screenshot({ path: `shots/parts/checkbox/hand-${mode}-keys.png` });

  // some of them: a press makes it ticked
  await press(p.locator('label:has(#some)'), 0.6);
  await p.waitForTimeout(500);
  u = await read('some');
  say(u.level === 1 && agrees(u), 'a press on one that is half ticked ticks it');

  // off
  await press(p.locator('label:has(#off)'), 0.6);
  await press(p.locator('label:has(#off-on)'), 0.6);
  await p.waitForTimeout(300);
  let o = await read('off'), q = await read('off-on');
  say(o.level === 0 && q.level === 1 && agrees(o) && agrees(q), 'a press on one that is switched off does nothing');
  if (mode === 'live') say(o.off && q.off && o.glow === 0 && q.glow === 0 && o.held === 0, `switched off, it has no light, ticked or not, and does not go down under the hand (halo ${o.glow}, ${q.glow})`);

  // from code
  await p.evaluate(() => { document.getElementById('tests').checked = true; document.getElementById('keep').indeterminate = true; });
  await p.waitForTimeout(500);
  s = await read('tests');
  const k = await read('keep');
  say(s.level === 1 && agrees(s) && k.level === 0.5 && agrees(k), 'checked and indeterminate set from code are followed');
  if (mode === 'live') {
    await p.evaluate(() => { document.getElementById('off').disabled = false; });
    await p.waitForTimeout(200);
    await press(p.locator('label:has(#off)'), 0.6);
    await p.waitForTimeout(500);
    o = await read('off');
    say(o.level === 1 && !o.off && o.glow > 0 && agrees(o), 'one switched back on answers again, with its light');
    // less motion: it is there at once
    await p.emulateMedia({ reducedMotion: 'reduce' });
    await press(p.locator('label:has(#s-empty)'), 0.6);
    const now = await read('s-empty');
    say(now.level === 1 && agrees(now), `with less motion asked for, it is down with its lamp on at once, with no travelling (${now.at}, ${now.shown})`);
    await p.emulateMedia({ reducedMotion: 'no-preference' });
    await p.mouse.move(5, 5);
    await p.waitForTimeout(1500);
    say(await p.evaluate(() => window.vx.stage.awake.size) === 0, 'at rest again nothing runs');
    await p.screenshot({ path: 'shots/parts/checkbox/hand-live-end.png' });
  }
  say(errors.length === 0, 'no errors' + (errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''));
  await p.close();
}
{
  const same = boxes.live === boxes.plain;
  if (!same) bad++;
  console.log(`${same ? 'ok  ' : 'FAIL'} plain: every label and button has the box it has in voxels`);
}
await browser.close();
process.exit(bad ? 1 : 0);
