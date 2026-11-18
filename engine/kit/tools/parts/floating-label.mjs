// A person at the floating label: a real mouse and real keys, with voxels and plain, on a laptop
// and on a phone. Says ok or FAIL for each thing that must hold.
//   PORT=5989 node tools/parts/floating-label.mjs
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const port = process.env.PORT || 5989;
await mkdir('shots/parts/floating-label', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
let bad = 0;
for (const mode of ['live', 'plain']) for (const width of [1180, 390]) {
  const tag = `${mode} ${width}`;
  const p = await (await browser.newContext({ viewport: { width, height: 1000 }, deviceScaleFactor: 1 })).newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const say = (ok, what) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${tag}: ${what}`); };
  // where the label's words are, against the well: 'in' (wholly inside it), 'above' (wholly over it), or 'across'
  const where = (id) => p.evaluate((id) => {
    const i = document.getElementById(id), l = document.querySelector(`label[for="${id}"]`), w = i.closest('.vx-well');
    const range = document.createRange(); range.selectNodeContents(l);
    const t = range.getBoundingClientRect(), b = w.getBoundingClientRect();
    return t.bottom <= b.top + 0.5 ? 'above' : t.top >= b.top - 0.5 && t.bottom <= b.bottom + 0.5 && t.left >= b.left && t.right <= b.right ? 'in' : 'across';
  }, id);
  const settle = () => p.waitForTimeout(320);
  const press = async (sel) => { const b = await p.locator(sel).first().boundingBox(); await p.mouse.move(b.x + Math.min(b.width / 2, 30), b.y + b.height / 2, { steps: 6 }); await p.mouse.down(); await p.waitForTimeout(80); await p.mouse.up(); };
  const focused = (id) => p.evaluate((id) => document.activeElement?.id === id, id);
  const tall = () => p.evaluate(() => [document.documentElement.scrollHeight, document.getElementById('mail').closest('.vx-field').getBoundingClientRect().height]);
  if (mode === 'plain') await p.addInitScript(() => { new MutationObserver((_, o) => { if (document.documentElement) { document.documentElement.setAttribute('data-vx-plain', ''); o.disconnect(); } }).observe(document, { childList: true }); });
  await p.goto(`http://127.0.0.1:${port}/showcase/parts/floating-label.html?theme=light`);
  await p.waitForFunction(() => document.documentElement.dataset.ready === '1');
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(700);
  const lives = await p.locator('[data-vx-live]').count();
  say(mode === 'live' ? lives > 0 : lives === 0, mode === 'live' ? `the page is drawn in voxels (${lives} parts)` : 'the page is plain');
  say(await p.evaluate(() => [...document.querySelectorAll('.vx-floating')].every((f) => { const l = f.querySelector('label'), c = f.querySelector('input, textarea'); return l && c && l.htmlFor === c.id && l.control === c; })), 'every label is a real label for its control');

  // as the page arrives
  const first = {};
  for (const id of ['mail', 'pass', 's-empty', 's-full', 's-words', 's-date', 's-off', 's-off-full', 's-bad', 's-long', 's-area', 's-area-full']) first[id] = await where(id);
  say(['mail', 'pass', 's-empty', 's-off', 's-long', 's-area'].every((id) => first[id] === 'in'), `empty fields: the label rests inside the well (${['mail', 'pass', 's-empty', 's-off', 's-long', 's-area'].map((id) => first[id]).join(', ')})`);
  say(['s-full', 's-off-full', 's-bad', 's-area-full'].every((id) => first[id] === 'above'), 'fields that hold something: the label is above the well');
  say(first['s-date'] === 'above', 'a kind of field that is never empty (a date): the label is above');
  say(first['s-words'] === 'in' && await p.evaluate(() => getComputedStyle(document.getElementById('s-words'), '::placeholder').color === 'rgba(0, 0, 0, 0)'), 'a placeholder of words is not shown under the resting label');
  const [page0, field0] = await tall();

  // a press on the resting label lands in the field, and the label moves out of the way
  await press('label[for="mail"]');
  await settle();
  say(await focused('mail'), 'a press on the resting label puts focus in its field');
  say(await where('mail') === 'above', 'and the label moves above the well');
  await p.screenshot({ path: `shots/parts/floating-label/hand-${mode}-${width}-focus.png` });
  await p.keyboard.type('mina@harbor.dev', { delay: 15 });
  say(await where('mail') === 'above', 'it is above while something is typed');
  await p.keyboard.press('Tab');
  await settle();
  say(await focused('pass') && await where('mail') === 'above', 'Tab goes on, and the label of the filled field stays above');
  say(await where('pass') === 'above', 'the next field has focus: its label is above before anything is typed');
  await p.keyboard.press('Shift+Tab');
  await p.keyboard.press('ControlOrMeta+a');
  await p.keyboard.press('Backspace');
  await p.keyboard.press('Tab');
  await settle();
  say(await where('mail') === 'in', 'emptied and left, its label rests inside again');
  await p.keyboard.press('Tab');
  await settle();
  say(await where('pass') === 'in', 'a field left empty: its label goes back inside');
  const [page1, field1] = await tall();
  say(page1 === page0 && field1 === field0, `the field is the same size through all of it (${field1} px), and so is the page`);

  // a placeholder of words shows once the label has moved
  await press('#s-words');
  await settle();
  say(await where('s-words') === 'above' && await p.evaluate(() => getComputedStyle(document.getElementById('s-words'), '::placeholder').color !== 'rgba(0, 0, 0, 0)'), 'in focus, the label is above and the placeholder of words shows');
  await p.keyboard.press('Escape');

  // filled without a hand: from code, with no focus and no event (how a browser fills a field in)
  await p.evaluate(() => { document.activeElement?.blur(); document.getElementById('s-empty').value = 'fogline'; document.getElementById('s-area').value = 'Ships every Friday.'; });
  await settle();
  say(await where('s-empty') === 'above' && await where('s-area') === 'above', 'a value set from code, with no focus and no event, moves the label above');
  await p.evaluate(() => { document.getElementById('s-empty').value = ''; });
  await settle();
  say(await where('s-empty') === 'in', 'and taking it away puts the label back');
  // A field the browser filled in by itself cannot be made here. So the stylesheet's own rules are
  // asked the same question with a stand-in: wherever they say "filled in by the browser"
  // (:autofill, :-webkit-autofill) an attribute is put, which weighs the same in the cascade. An
  // empty field at rest that carries it must then have its label above.
  const probe = await p.evaluate(() => {
    let named = 0;
    for (const s of document.styleSheets) {
      if (!s.href?.endsWith('floating-label.css')) continue;
      for (const r of s.cssRules) if (r.selectorText?.includes('autofill')) { named++; r.selectorText = r.selectorText.replace(/:is\([^()]*autofill[^()]*\)/g, '[data-vx-probe]').replace(/:(-webkit-)?autofill/g, '[data-vx-probe]'); }
    }
    document.getElementById('pass').setAttribute('data-vx-probe', '');
    document.getElementById('s-area').value = '';
    document.getElementById('s-area').setAttribute('data-vx-probe', '');
    return named;
  });
  await settle();
  say(probe > 0, `this browser kept the rules that ask whether it filled the field in itself (${probe})`);
  say(await where('pass') === 'above' && await where('s-area') === 'above', 'a field that says the browser filled it in, though it still counts as empty and at rest, has its label above');
  await p.evaluate(() => { document.getElementById('pass').removeAttribute('data-vx-probe'); document.getElementById('s-area').removeAttribute('data-vx-probe'); });
  await settle();
  say(await where('pass') === 'in', 'and without that, it rests inside again');
  say(await p.evaluate(() => getComputedStyle(document.querySelector('label[for="s-off"]')).cursor === 'default' && getComputedStyle(document.querySelector('label[for="pass"]')).cursor === 'text'), 'the resting label of a live field shows the text cursor; of one switched off, the plain one');

  // a long label wraps, rests inside, and the page does not move sideways
  say(first['s-long'] === 'in', 'a long Ukrainian label rests wholly inside its well');
  say(await p.evaluate(() => { scrollTo(200, 0); const moved = scrollX; scrollTo(0, 0); return moved; }) === 0, 'the page does not scroll sideways');

  // less motion: the label changes place at once
  await p.emulateMedia({ reducedMotion: 'reduce' });
  say(await p.evaluate(() => getComputedStyle(document.querySelector('label[for="pass"]')).transitionDuration.split(',').every((d) => parseFloat(d) === 0)), 'with less motion asked for, the label does not travel');
  await press('label[for="pass"]');
  say(await where('pass') === 'above', 'it is above on the same frame as the press');
  await p.emulateMedia({ reducedMotion: 'no-preference' });

  if (mode === 'live') {
    await p.evaluate(() => document.activeElement?.blur());
    await p.mouse.move(5, 5);
    await p.waitForTimeout(1500);
    say(await p.evaluate(() => window.vx.stage.awake.size) === 0, 'at rest nothing runs');
  }
  say(errors.length === 0, 'no errors' + (errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''));
  await p.close();
}
await browser.close();
process.exit(bad ? 1 : 0);
