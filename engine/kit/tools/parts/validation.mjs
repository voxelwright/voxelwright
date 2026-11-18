// A person at the field with error and validation: a real mouse and real keys, with voxels and
// plain. Says ok or FAIL for each thing that must hold.
//   PORT=5989 node tools/parts/validation.mjs
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const port = process.env.PORT || 5989;
await mkdir('shots/parts/validation', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
let bad = 0;
for (const mode of ['live', 'plain']) {
  const p = await (await browser.newContext({ viewport: { width: 1180, height: 1000 }, deviceScaleFactor: 1 })).newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const say = (ok, what) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${mode}: ${what}`); };
  const press = async (sel) => { const b = await p.locator(sel).first().boundingBox(); await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 }); await p.mouse.down(); await p.waitForTimeout(80); await p.mouse.up(); };
  const state = (id) => p.evaluate((id) => {
    const i = document.getElementById(id), note = document.getElementById(id + '-error'), hint = document.getElementById(id + '-hint');
    const seen = (el) => !!el && getComputedStyle(el).visibility === 'visible' && el.getClientRects().length > 0;
    return { invalid: i.getAttribute('aria-invalid'), tied: (i.getAttribute('aria-describedby') || '').split(/\s+/).includes(note.id), words: note.textContent.trim(), shown: seen(note), hint: seen(hint), focus: document.activeElement === i, tall: document.documentElement.scrollHeight };
  }, id);
  if (mode === 'plain') await p.addInitScript(() => { new MutationObserver((_, o) => { if (document.documentElement) { document.documentElement.setAttribute('data-vx-plain', ''); o.disconnect(); } }).observe(document, { childList: true }); });
  await p.goto(`http://127.0.0.1:${port}/kit/showcase/parts/validation.html?theme=light`);
  await p.waitForFunction(() => document.documentElement.dataset.ready === '1');
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(700);
  const lives = await p.locator('[data-vx-live]').count();
  say(mode === 'live' ? lives > 0 : lives === 0, mode === 'live' ? `the page is drawn in voxels (${lives} parts)` : 'the page is plain');

  // at rest: nothing is marked, and a message that says nothing is not the field's description
  let m = await state('mail'), h = await state('handle');
  const tall = m.tall;
  say(m.invalid === null && !m.shown && !m.tied && m.words === '', 'at rest the email field is not marked, shows no message and is not described by one');
  say(h.invalid === null && !h.shown && !h.tied && h.hint, 'at rest the handle field shows its hint, not its message');
  const still = await p.evaluate(() => ['s-bad', 's-hint-bad', 's-long', 's-area'].every((id) => { const i = document.getElementById(id); return i.getAttribute('aria-invalid') === 'true' && i.getAttribute('aria-describedby').split(/\s+/).includes(id + '-error') && getComputedStyle(document.getElementById(id + '-error')).visibility === 'visible'; }));
  say(still, 'the fields written as wrong in the markup show their messages and are described by them');
  say(await p.evaluate(() => document.querySelectorAll('.vx-field-error').length === [...document.querySelectorAll('.vx-field-error')].filter((n) => { const f = n.closest('.vx-field'), l = f.querySelector('label'), c = f.querySelector('input, textarea'); return l && c && l.htmlFor === c.id; }).length), 'every field has a real label for its control');

  // send it empty: both are marked, the first takes focus, nothing below moves
  await press('#send');
  await p.waitForTimeout(400);
  m = await state('mail'); h = await state('handle');
  say(m.invalid === 'true' && m.tied && m.shown && m.words.length > 0, `Send with nothing typed marks the email field and ties its message, in the browser's words ("${m.words}")`);
  say(h.invalid === 'true' && h.tied && h.shown && !h.hint && h.words.startsWith('Use lower case'), 'and the handle field: its own words take the place of its hint');
  say(m.focus, 'the first wrong field takes focus');
  say(m.tall === tall, `nothing below moved (the page is ${m.tall} px tall, was ${tall})`);
  say(await p.evaluate(() => document.getElementById('said').textContent) === '', 'and nothing was sent');
  if (mode === 'live') {
    const red = await p.evaluate(async () => {
      const { MATERIALS } = await import('/kit/src/index.js');
      const { walls, tell } = window.vx.live(document.getElementById('mail').closest('.vx-well')).model.byName;
      const stop = MATERIALS['light-stop'].id;
      return !walls.mats.includes(stop) && tell?.mats.includes(stop) && tell.rest[2] < 0;
    });
    say(red, 'the red tube sits inside the well below its rim');
  }
  await p.screenshot({ path: `shots/parts/validation/hand-${mode}-wrong.png` });

  // type: still wrong while it is wrong, cleared the moment it is right
  await p.keyboard.type('mina', { delay: 20 });
  m = await state('mail');
  say(m.invalid === 'true' && m.shown, 'half an address is still wrong');
  await p.keyboard.type('@harbor.example', { delay: 20 });
  m = await state('mail');
  say(m.invalid === null && !m.tied && !m.shown && m.words === '', 'a whole address clears the mark, the message and the tie at once');
  if (mode === 'live') {
    await p.waitForTimeout(200);
    const lit = await p.evaluate(async () => { const { MATERIALS } = await import('/kit/src/index.js'); const w = window.vx.live(document.getElementById('mail').closest('.vx-well')); return w.model.byName.walls.mats[0] === MATERIALS.light.id; });
    say(lit, 'and the rim is the accent again: it has focus');
  }

  // Tab to the next, type something wrong, Tab away: it is marked on leaving
  await p.keyboard.press('Tab');
  h = await state('handle');
  say(h.focus, 'Tab goes to the handle field');
  await p.keyboard.type('ada', { delay: 20 });
  h = await state('handle');
  say(h.invalid === null && h.hint && !h.shown, 'a right handle clears it, and the hint is back');
  await p.keyboard.press('Shift+Tab');
  await p.keyboard.press('Tab');
  await p.keyboard.press('ControlOrMeta+a');
  await p.keyboard.type('Ada Byron', { delay: 20 });
  h = await state('handle');
  say(h.invalid === null, 'typing something wrong does not mark the field while it is being typed');
  await p.keyboard.press('Tab');
  h = await state('handle');
  say(h.invalid === 'true' && h.tied && h.shown && !h.hint, 'leaving it wrong marks it');
  say(h.tall === tall, 'and nothing below moved');
  await p.keyboard.press('Shift+Tab');
  await p.keyboard.press('ControlOrMeta+a');
  await p.keyboard.type('ada-b', { delay: 20 });
  h = await state('handle');
  say(h.invalid === null && !h.tied && h.hint, 'mending it clears it');

  // Enter sends
  await p.keyboard.press('Enter');
  await p.waitForTimeout(300);
  say(await p.evaluate(() => document.getElementById('said').textContent) === 'Invite sent to mina@harbor.example.', 'Enter sends a right form');
  m = await state('mail');
  say(m.invalid === null && !m.shown, 'and the form is at rest again');

  // marked from code, as a server would: the message is tied without being asked
  await p.evaluate(() => { document.querySelector('#s-hint-error .vx-field-error-text').textContent = 'That team is full.'; document.getElementById('s-hint').setAttribute('aria-invalid', 'true'); });
  await p.waitForTimeout(200);
  let s = await state('s-hint');
  say(s.invalid === 'true' && s.tied && s.shown && !s.hint && s.words === 'That team is full.', 'aria-invalid set from code shows the message and ties it');
  await press('#s-hint');
  await p.keyboard.type('s', { delay: 20 });
  s = await state('s-hint');
  say(s.invalid === null && !s.tied && s.hint, 'and typing in it clears it');

  // a message written with a lamp and no place for words: the words are the browser's, and the lamp is kept
  await press('#s-own');
  await p.keyboard.type('mina', { delay: 20 });
  await p.keyboard.press('Tab');
  await p.waitForTimeout(250);
  s = await state('s-own');
  const kept = await p.evaluate((live) => { const n = document.getElementById('s-own-error'); return !!n.querySelector(':scope > .vx-lamp') && !n.querySelector(':scope > .vx-canvas') && (!!n.querySelector(':scope > .vx-lamp > .vx-canvas') === live) && n.querySelector(':scope > .vx-field-error-text')?.textContent.length > 0; }, mode === 'live');
  say(s.invalid === 'true' && s.tied && s.shown && s.words.length > 0 && kept, `a message with only a lamp in it is given the browser's words, beside the lamp ("${s.words}")`);

  if (mode === 'live') {
    await p.mouse.move(5, 5);
    await p.waitForTimeout(1500);
    say(await p.evaluate(() => window.vx.stage.awake.size) === 0, 'at rest nothing runs');
  }
  say(errors.length === 0, 'no errors' + (errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''));
  await p.close();
}
await browser.close();
process.exit(bad ? 1 : 0);
