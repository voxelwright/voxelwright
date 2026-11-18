// A person at the label: a real mouse, with voxels and plain, on a laptop and on a phone. A label
// has one behaviour, and it is the browser's: a press on the words lands in the control they
// name. Says ok or FAIL for each thing that must hold.
//   PORT=5989 node tools/parts/label.mjs
import { chromium } from 'playwright';

const port = process.env.PORT || 5989;
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
let bad = 0;
for (const mode of ['live', 'plain']) for (const width of [1180, 390]) {
  const tag = `${mode} ${width}`;
  const p = await (await browser.newContext({ viewport: { width, height: 1000 }, deviceScaleFactor: 1 })).newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const say = (ok, what) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${tag}: ${what}`); };
  if (mode === 'plain') await p.addInitScript(() => { new MutationObserver((_, o) => { if (document.documentElement) { document.documentElement.setAttribute('data-vx-plain', ''); o.disconnect(); } }).observe(document, { childList: true }); });
  await p.goto(`http://127.0.0.1:${port}/showcase/parts/label.html?theme=light`);
  await p.waitForFunction(() => document.documentElement.dataset.ready === '1');
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(700);
  const lives = await p.locator('[data-vx-live]').count();
  say(mode === 'live' ? lives > 0 : lives === 0, mode === 'live' ? `the page is drawn in voxels (${lives} parts)` : 'the page is plain');
  const made = await p.evaluate(() => [...document.querySelectorAll('.vx-field')].map((f) => {
    const l = f.querySelector('.vx-field-label'), c = f.querySelector('input, textarea, select'), hint = f.querySelector('.vx-field-hint');
    const lr = l.getBoundingClientRect(), fr = f.getBoundingClientRect();
    return { id: c.id, real: l.tagName === 'LABEL' && l.htmlFor === c.id && l.control === c, name: c.labels[0] === l, hint: !hint || (c.getAttribute('aria-describedby') || '').split(/\s+/).includes(hint.id), fits: lr.left >= fr.left - 0.5 && lr.right <= fr.right + 0.5, mark: [...l.querySelectorAll('.vx-field-mark')].every((m) => m.getAttribute('aria-hidden') === 'true' && c.required), quiet: getComputedStyle(l).color };
  }));
  say(made.every((m) => m.real && m.name), 'every label is a real <label> for its control, and names it');
  say(made.every((m) => m.hint), 'a line under a field is tied to its control as its description');
  say(made.every((m) => m.mark), 'a mark for "must be filled" is hidden from a screen reader, and the control itself says it is required');
  say(made.every((m) => m.fits), 'no label is wider than its field: a long one wraps');
  say(new Set(made.map((m) => m.quiet)).size === 2 && made.find((m) => m.id === 's-off').quiet !== made[0].quiet, 'the label of a control that is switched off is quiet; every other is the page\'s ink');
  say(await p.evaluate(() => { scrollTo(200, 0); const moved = scrollX; scrollTo(0, 0); return moved; }) === 0, 'the page does not scroll sideways');
  // a real press on the words of each label lands in its control
  const landed = [];
  for (const m of made) {
    await p.evaluate(() => document.activeElement?.blur());
    const l = p.locator(`label[for="${m.id}"]`);
    await l.scrollIntoViewIfNeeded();
    const b = await l.boundingBox();
    await p.mouse.move(b.x + Math.min(12, b.width / 2), b.y + Math.min(8, b.height / 2), { steps: 4 });
    await p.mouse.down(); await p.waitForTimeout(40); await p.mouse.up();
    const got = await p.evaluate(() => document.activeElement?.id || '');
    landed.push(m.id === 's-off' ? got === '' : got === m.id);
  }
  say(landed.every(Boolean), `a press on each label's words puts focus in its control (${landed.filter(Boolean).length} of ${landed.length}; the one that is switched off takes none)`);
  say(errors.length === 0, 'no errors' + (errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''));
  await p.close();
}
await browser.close();
process.exit(bad ? 1 : 0);
