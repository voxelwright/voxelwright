// A person answering the agent: a real mouse and real keys. A questionnaire is a fieldset with a
// legend over radios or checkboxes; the key sends the answer; once answered it stays, unchangeable,
// as the record. Says ok or FAIL for each thing that must hold; exit 1 on a failure.
//   PORT=5989 node tools/parts/questionnaire.mjs
import { chromium } from 'playwright';

const port = process.env.PORT || 5989;
const url = `http://127.0.0.1:${port}/showcase/parts/questionnaire.html`;
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
const press = async (p, sel) => { await p.locator(sel).first().scrollIntoViewIfNeeded(); const b = await p.locator(sel).first().boundingBox(); await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 }); await p.mouse.down(); await p.waitForTimeout(80); await p.mouse.up(); await p.waitForTimeout(60); };
const state = (p, id) => p.evaluate((id) => {
  const f = document.getElementById(id), send = f.querySelector('.vx-questionnaire-send');
  return {
    chosen: [...f.querySelectorAll('input:checked')].map((i) => i.value).join(),
    pressed: [...f.querySelectorAll('[aria-pressed="true"]')].map((k) => k.textContent.trim()).join(),
    note: f.querySelector('.vx-questionnaire-note').textContent,
    answered: f.hasAttribute('data-vx-answered') && f.disabled,
    off: [...f.querySelectorAll('input')].every((i) => i.disabled) && [...f.querySelectorAll('.vx-toggle-button')].every((k) => k.getAttribute('aria-disabled') === 'true'),
    key: !!send && !send.hidden && send.offsetWidth > 0,
  };
}, id);
const focused = (p) => p.evaluate(() => { const a = document.activeElement; return a.matches('input') ? `input ${a.value}` : a.matches('.vx-questionnaire-note') ? `the note of #${a.closest('fieldset').id}` : a.textContent.trim(); });
const heard = (p) => p.evaluate(() => window.answers.map((a) => `${a.id}: ${a.values.join('+')}`).join('; '));

async function behaves(p, tag) {
  // ---- what it is
  const what = await p.evaluate(() => [...document.querySelectorAll('.vx-questionnaire')].map((f) => `${f.tagName}>${f.firstElementChild.tagName}`));
  say(what.every((w) => w === 'FIELDSET>LEGEND'), `${tag}every questionnaire is a fieldset whose first child is its legend`);
  const name = await p.evaluate(() => { const i = document.querySelector('#when input'); return i.type === 'radio' && i.closest('fieldset').querySelector('legend').textContent.trim(); });
  say(name === 'When should it go out?', `${tag}its answers are the browser's own radio buttons, in the group the legend names ("${name}")`);
  const roles = await p.evaluate(() => [...document.querySelectorAll('.vx-questionnaire-note')].filter((n) => !n.closest('[data-vx-answered]')).every((n) => n.getAttribute('role') === 'status'));
  say(roles, `${tag}the line under each that is still open is a status: what it says is read out`);

  // ---- nothing chosen: it says so, and waits
  await press(p, '#when .vx-questionnaire-send');
  let s = await state(p, 'when');
  say(s.note === 'Choose an answer first.' && !s.answered && s.key && await heard(p) === '', `${tag}the key with nothing chosen: "${s.note}", and nothing is sent`);
  // a real mouse chooses
  await press(p, '#when label:nth-of-type(2)');
  s = await state(p, 'when');
  say(s.chosen === 'tonight' && s.note === '', `${tag}a press on "Tonight" chooses it, and the line asking goes (${s.chosen})`);
  // the keys move the choice
  await p.focus('#when input:checked');
  await p.keyboard.press('ArrowDown');
  say((await state(p, 'when')).chosen === 'monday', `${tag}the down arrow moves the choice to Monday`);
  await p.keyboard.press('ArrowUp');
  say((await state(p, 'when')).chosen === 'tonight', `${tag}the up arrow moves it back`);
  // Tab to the key, Enter
  await p.keyboard.press('Tab');
  say(await focused(p) === 'Answer', `${tag}Tab from the answers comes to the key (${await focused(p)})`);
  await p.keyboard.press('Enter');
  await p.waitForTimeout(150);
  s = await state(p, 'when');
  say(s.answered && s.off && !s.key, `${tag}Enter answers: the fieldset and every answer are disabled, and the key goes`);
  say(s.note === 'Answered: Tonight, after the backup', `${tag}it stays as the record: "${s.note}"`);
  say(await focused(p) === 'the note of #when', `${tag}focus, which was on the key, is on the record (${await focused(p)})`);
  say(await heard(p) === 'when: tonight', `${tag}the page hears vx-answer once (${await heard(p)})`);
  // once answered it cannot be changed
  await press(p, '#when label:nth-of-type(1)');
  s = await state(p, 'when');
  say(s.chosen === 'tonight' && await heard(p) === 'when: tonight', `${tag}a press on another answer afterwards changes nothing (${s.chosen})`);
  if (!tag) {
    // (how the toggle group draws its keys is the toggle group's own: here, only that it is still drawn, and drawn again)
    await p.waitForTimeout(300);
    const k = await p.evaluate(() => { const l = window.vx.live(document.querySelector('#when .vx-toggle-group')); return !!l?.model && l.model.parts.some((q) => !q.hidden && q.count); });
    say(k, 'the answers are still drawn in voxels, as the record');
  }

  // ---- several of many: checkboxes, Space
  await p.focus('#tell input[value="oncall"]');
  await p.keyboard.press('Space');
  await press(p, '#tell .vx-questionnaire-send');
  s = await state(p, 'tell');
  say(s.answered && s.off && s.note === 'Answered: The team channel, Whoever is on call', `${tag}several of many: Space ticks one more, the key sends both: "${s.note}"`);
  // none may be the answer
  await press(p, '#optional .vx-questionnaire-send');
  s = await state(p, 'optional');
  say(s.answered && s.note === 'Answered: nothing more', `${tag}where none may be the answer, the key with nothing ticked: "${s.note}"`);
  // toggle buttons
  await press(p, '#days button:nth-of-type(2)');
  await press(p, '#days .vx-questionnaire-send');
  s = await state(p, 'days');
  say(s.answered && s.off && s.note === 'Answered: Weekdays, Saturday', `${tag}toggle buttons: Saturday pressed, then the key: "${s.note}"`);
  await press(p, '#days button:nth-of-type(3)');
  say((await state(p, 'days')).pressed === 'Weekdays,Saturday', `${tag}and afterwards Sunday cannot be pressed`);
  // the page's own words
  await press(p, '#uk .vx-questionnaire-send');
  s = await state(p, 'uk');
  say(s.note === 'Спершу оберіть відповідь.', `${tag}in Ukrainian it asks in the page's words: "${s.note}"`);
  await press(p, '#uk label:nth-of-type(2)');
  await press(p, '#uk .vx-questionnaire-send');
  s = await state(p, 'uk');
  say(s.note === 'Відповідь: Залишити локально', `${tag}and answers in them: "${s.note}"`);
  // what was answered before the page came cannot be changed either
  await press(p, '#done-one label:nth-of-type(2)');
  say((await state(p, 'done-one')).chosen === 'yes', `${tag}an answer given before the page came stays as it was`);
}

// ---------------------------------------------------------------- voxels
const p = await open();
await behaves(p, '');
await p.mouse.move(4, 4);
await p.waitForTimeout(1200);
say(await p.evaluate(() => window.vx.stage.awake.size) === 0, 'at rest nothing runs');
await p.context().close();

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
  const m = await q.evaluate(() => {
    scrollTo(200, 0); const moved = scrollX; scrollTo(0, 0);
    const sheet = document.querySelector('.sheet').getBoundingClientRect();
    const out = [...document.querySelectorAll('.vx-questionnaire, .vx-questionnaire *')].filter((e) => !e.closest('.vx-canvas')).filter((e) => { const r = e.getBoundingClientRect(); return r.width && (r.left < sheet.left || r.right > sheet.right); }).map((e) => e.textContent.trim().slice(0, 20));
    return { moved, out, wraps: document.querySelector('#uk label').offsetHeight };
  });
  say(m.moved === 0 && m.out.length === 0 && m.wraps > 44, `at 390 px${plain ? ', plain' : ''}: nothing scrolls sideways (${m.moved} px), nothing is outside the sheet (${m.out.join(', ')}), a long answer wraps (${m.wraps} px tall)`);
  await q.context().close();
}

say(errors.length === 0, 'no errors' + (errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''));
await browser.close();
process.exit(bad ? 1 : 0);
