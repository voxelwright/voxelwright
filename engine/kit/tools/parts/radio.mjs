// A person at the radio group: a real mouse and real keys, with voxels and plain. Says ok or FAIL
// for each thing that must hold.
//   PORT=5989 node tools/parts/radio.mjs
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const port = process.env.PORT || 5989;
await mkdir('shots/parts/radio', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
let bad = 0;
for (const mode of ['live', 'plain']) {
  const p = await (await browser.newContext({ viewport: { width: 1180, height: 1000 }, deviceScaleFactor: 1 })).newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const say = (ok, what) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${mode}: ${what}`); };
  const press = async (loc, fx = 0.5) => { const b = await loc.boundingBox(); await p.mouse.move(b.x + b.width * fx, b.y + b.height / 2, { steps: 6 }); await p.mouse.down(); await p.waitForTimeout(80); await p.mouse.up(); };
  // the group as the inputs say it, and as the voxels show it
  const read = (name) => p.evaluate((name) => {
    const all = [...document.querySelectorAll(`input[name="${name}"]`)];
    const lit = all.map((i) => { const l = window.vx?.live(i.parentElement.querySelector('.vx-dot')); return l ? l.spring('on').target : null; });
    return { chosen: all.filter((i) => i.checked).map((i) => i.value).join(','), focus: document.activeElement?.name === name ? document.activeElement.value : '', lit: lit.map((v, k) => (v === 1 ? all[k].value : '')).join(''), drawn: lit.every((v) => v !== null) };
  }, name);
  // the inputs and the buttons agree: exactly the chosen one is sent down, to where its lamp is on
  const agrees = (s) => (mode === 'plain' ? true : s.drawn && s.lit === s.chosen);
  if (mode === 'plain') await p.addInitScript(() => { new MutationObserver((_, o) => { if (document.documentElement) { document.documentElement.setAttribute('data-vx-plain', ''); o.disconnect(); } }).observe(document, { childList: true }); });
  await p.goto(`http://127.0.0.1:${port}/showcase/parts/radio.html?theme=light`);
  await p.waitForFunction(() => document.documentElement.dataset.ready === '1');
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(700);
  const lives = await p.locator('[data-vx-live]').count();
  say(mode === 'live' ? lives > 0 : lives === 0, mode === 'live' ? `the page is drawn in voxels (${lives} parts)` : 'the page is plain');
  say(await p.evaluate(() => [...document.querySelectorAll('.vx-radios')].every((g) => g.tagName === 'FIELDSET' && g.getAttribute('role') === 'radiogroup' && g.querySelector(':scope > legend')?.textContent.trim() && [...g.querySelectorAll('input')].every((i) => i.type === 'radio' && i.closest('label.vx-radio') && i.labels.length === 1 && i.name === g.querySelector('input').name))), 'every group is a fieldset named by its legend, of real radios of one name, each in its own label');
  say(await p.evaluate(() => [...document.querySelectorAll('.vx-radio')].every((l) => l.getBoundingClientRect().height >= 44)), 'every choice is at least 44 px tall to hit');
  let s = await read('where');
  say(s.chosen === 'fra' && agrees(s), 'as the page arrives, Frankfurt is chosen' + (mode === 'live' ? ' and is the one that is down' : ''));

  // what is drawn, at rest: which of the cap's states each button shows (cap: dark, lit: its lamp on), and how far down it is
  const drawn = (name) => p.evaluate((name) => [...document.querySelectorAll(`input[name="${name}"]`)].map((i) => { const l = window.vx.live(i.parentElement.querySelector('.vx-dot')); const shown = ['cap', 'lit', 'some'].filter((n) => !l.model.byName[n].hidden); return `${i.value} ${shown.join()} ${+l.model.byName[shown[0]].tz.toFixed(2)} ${l.glowStrength > 0 ? 'light' : 'dark'}`; }).join('; '), name);
  if (mode === 'live') {
    const d = await drawn('where'), travel = await p.evaluate(() => window.vx.live(document.querySelector('.vx-dot')).look.travel);
    say(d === `fra lit ${-travel} light; iad cap 0 dark; sin cap 0 dark`, `the chosen one is latched down by the look's travel with its lamp on; the others stand up, dark (${d})`);
    say(await p.evaluate(() => window.vx.stage.awake.size) === 0, 'at rest nothing runs');
  }

  // keys: one tab stop, arrows move the choice and go round
  await p.evaluate(() => document.body.focus());
  await p.keyboard.press('Tab');
  s = await read('where');
  say(s.focus === 'fra', 'Tab comes into the group at the chosen one');
  await p.keyboard.press('ArrowDown');
  await p.waitForTimeout(60);
  s = await read('where');
  say(s.chosen === 'iad' && s.focus === 'iad' && agrees(s), 'Arrow Down moves the choice and the focus to the next; the one left is let up');
  await p.keyboard.press('ArrowRight');
  s = await read('where');
  say(s.chosen === 'sin' && s.focus === 'sin' && agrees(s), 'Arrow Right does the same');
  await p.keyboard.press('ArrowDown');
  s = await read('where');
  say(s.chosen === 'fra' && s.focus === 'fra' && agrees(s), 'from the last it goes round to the first');
  await p.keyboard.press('ArrowUp');
  s = await read('where');
  say(s.chosen === 'sin' && agrees(s), 'Arrow Up from the first goes round to the last');
  await p.keyboard.press('ArrowLeft');
  s = await read('where');
  say(s.chosen === 'iad' && agrees(s), 'Arrow Left moves back');
  await p.screenshot({ path: `shots/parts/radio/hand-${mode}-keys.png` });
  await p.keyboard.press('Tab');
  s = await read('where');
  let t = await read('when');
  say(s.focus === '' && t.focus === 'push', 'Tab leaves the group in one step (one tab stop) and lands on the next group\'s chosen one');
  await p.keyboard.press('Shift+Tab');
  s = await read('where');
  say(s.focus === 'iad', 'Shift+Tab comes back to the chosen one, not the last');

  // the mouse: on the words, and on the button
  await press(p.locator('#where .vx-radio').nth(0), 0.6);
  await p.waitForTimeout(60);
  s = await read('where');
  say(s.chosen === 'fra' && agrees(s), 'a press on a choice\'s words chooses it');
  await press(p.locator('#where .vx-dot').nth(2));
  await p.waitForTimeout(60);
  s = await read('where');
  say(s.chosen === 'sin' && agrees(s), 'a press on its button chooses it');
  await press(p.locator('#where .vx-dot').nth(2));
  s = await read('where');
  say(s.chosen === 'sin', 'a second press does not let it up');
  if (mode === 'live') {
    await p.waitForTimeout(500);
    const d = await drawn('where'), travel = await p.evaluate(() => window.vx.live(document.querySelector('.vx-dot')).look.travel);
    say(d === `fra cap 0 dark; iad cap 0 dark; sin lit ${-travel} light`, `at rest again, the one chosen now is down with its lamp on and the one before it has come up (${d})`);
    const b = await p.locator('#where .vx-dot').nth(0).boundingBox();
    await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 4 });
    await p.mouse.down();
    await p.waitForTimeout(250);
    const h = await p.evaluate(() => { const l = window.vx.live(document.querySelector('#where .vx-dot')); return [+l.model.byName.cap.tz.toFixed(2), -l.look.step]; });
    await p.mouse.move(b.x + b.width / 2, b.y - 60, { steps: 4 });
    await p.mouse.up();
    await p.waitForTimeout(300);
    s = await read('where');
    say(h[0] === h[1] && s.chosen === 'sin', `held down, one that is up goes down a step under the hand (${h[0]}); dragged off before letting go, it chooses nothing`);
  }

  // a choice that is off is passed over; a group that is off does not answer
  await press(p.locator('#s-each .vx-radio').nth(1), 0.6);
  await p.keyboard.press('ArrowDown');
  s = await read('s-each');
  say(s.chosen === 'd' && agrees(s), 'the arrows pass over a choice that is switched off');
  await press(p.locator('#s-each .vx-radio').nth(2), 0.6);
  s = await read('s-each');
  say(s.chosen === 'd', 'a press on a choice that is switched off does nothing');
  await press(p.locator('#s-off .vx-radio').nth(1), 0.6);
  s = await read('s-off');
  say(s.chosen === 'a', 'nor does a press in a group that is switched off');

  // nothing chosen yet: Tab lands on the first, Space chooses it
  await press(p.locator('#s-each .vx-radio').nth(3), 0.6);
  await p.keyboard.press('Tab');
  s = await read('s-none');
  say(s.focus === 'a' && s.chosen === '' && agrees(s), 'in a group with nothing chosen, Tab lands on the first and chooses nothing');
  await p.keyboard.press('Space');
  s = await read('s-none');
  say(s.chosen === 'a' && agrees(s), 'Space chooses the one in focus');

  // from code, and a form put back
  await p.evaluate(() => { document.querySelector('input[name="where"][value="iad"]').checked = true; });
  await p.waitForTimeout(60);
  s = await read('where');
  say(s.chosen === 'iad' && agrees(s), 'a choice set from code is followed, and the one it replaced is let up');
  await p.evaluate(() => document.getElementById('run').reset());
  await p.waitForTimeout(120);
  s = await read('where');
  say(s.chosen === 'fra' && agrees(s), 'a form put back to how it began is followed');
  if (mode === 'live') {
    // less motion: the button is down at once
    await p.emulateMedia({ reducedMotion: 'reduce' });
    await press(p.locator('#s-row .vx-radio').nth(1), 0.6);
    const now = await p.evaluate(() => [...document.querySelectorAll('input[name="s-row"]')].map((i) => { const l = window.vx.live(i.parentElement.querySelector('.vx-dot')); return l.spring('on').x; }).join(','));
    say(now === '0,1,0', `with less motion asked for, the choice changes at once, with no travelling (${now})`);
    await p.emulateMedia({ reducedMotion: 'no-preference' });
    await p.evaluate(() => { document.getElementById('s-off').disabled = false; });
    await p.waitForTimeout(200);
    await press(p.locator('#s-off .vx-radio').nth(1), 0.6);
    await p.waitForTimeout(60);
    s = await read('s-off');
    say(s.chosen === 'b' && agrees(s), 'a group switched back on answers again');
    await p.mouse.move(5, 5);
    await p.waitForTimeout(1500);
    say(await p.evaluate(() => window.vx.stage.awake.size) === 0, 'at rest nothing runs');
    await p.screenshot({ path: 'shots/parts/radio/hand-live-end.png' });
  }
  say(errors.length === 0, 'no errors' + (errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''));
  await p.close();
}
await browser.close();
process.exit(bad ? 1 : 0);
