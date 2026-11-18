// A person at the select: a real mouse and real keys, with voxels and plain. Says ok or FAIL for
// each thing that must hold. The picker is the browser's own and is not part of the page, so a
// headless browser draws none: what is asked here is whether the browser says it is open
// (select:open), what the key does while it is, and what a real key does to the choice.
//   PORT=5989 node tools/parts/select.mjs
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const port = process.env.PORT || 5989;
await mkdir('shots/parts/select', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
let bad = 0;
// 'live, no :open' is the page in voxels in a browser that cannot say whether a picker is open
// (select:open is made unknown, as it is in older browsers): the key must still come up.
for (const mode of ['live', 'live, no :open', 'plain']) {
  const p = await (await browser.newContext({ viewport: { width: 1180, height: 1000 }, deviceScaleFactor: 1 })).newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const say = (ok, what) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${mode}: ${what}`); };
  const centre = async (sel) => { const b = await p.locator(sel).boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
  const click = async (x, y) => { await p.mouse.move(x, y, { steps: 6 }); await p.mouse.down(); await p.waitForTimeout(80); await p.mouse.up(); };
  const read = (id) => p.evaluate((id) => {
    const c = document.getElementById(id), l = window.vx?.live(c.closest('.vx-select'));
    let open = null; try { open = c.matches(':open'); } catch {}
    return { value: c.value, text: c.selectedOptions[0]?.textContent.trim(), open, focus: document.activeElement === c, down: l ? l.spring('press').target < 0 : null, held: l ? !!l.state.held : null };
  }, id);
  const voxels = mode !== 'plain';
  if (mode === 'live, no :open') await p.addInitScript(() => { const m = Element.prototype.matches; Element.prototype.matches = function (q) { if (String(q).includes(':open')) throw new DOMException('not a valid selector', 'SyntaxError'); return m.call(this, q); }; });
  if (mode === 'plain') await p.addInitScript(() => { new MutationObserver((_, o) => { if (document.documentElement) { document.documentElement.setAttribute('data-vx-plain', ''); o.disconnect(); } }).observe(document, { childList: true }); });
  await p.goto(`http://127.0.0.1:${port}/showcase/parts/select.html?theme=light`);
  await p.waitForFunction(() => document.documentElement.dataset.ready === '1');
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(700);
  const lives = await p.locator('[data-vx-live]').count();
  say(voxels ? lives > 0 : lives === 0, voxels ? `the page is drawn in voxels (${lives} parts)` : 'the page is plain');

  // what it is made of
  const made = await p.evaluate(() => [...document.querySelectorAll('.vx-select')].map((k) => {
    const c = k.querySelector('select'), r = k.getBoundingClientRect(), s = c.getBoundingClientRect();
    const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2), end = document.elementFromPoint(r.right - 20, r.top + r.height / 2);
    return { id: c.id, real: c.tagName === 'SELECT' && !c.multiple && getComputedStyle(c).opacity === '1' && getComputedStyle(c).visibility === 'visible', covers: Math.abs(s.left - r.left) < 1 && Math.abs(s.right - r.right) < 1 && Math.abs(s.top - r.top) < 1 && Math.abs(s.bottom - r.bottom) < 1, hit: at === c && end === c, named: c.labels.length === 1 && c.labels[0].htmlFor === c.id, tall: r.height >= 44, grid: [s.left, s.top + scrollY].every((v) => Math.abs(v - Math.round(v)) < 0.02) };
  }));
  say(made.every((k) => k.real), 'every key holds a real, visible <select>');
  say(made.every((k) => k.covers && k.hit), 'the select covers its whole key: a press anywhere on it, the chevron too, goes to the browser');
  say(made.every((k) => k.named), 'each has a real label for it');
  say(made.every((k) => k.tall), 'each is at least 44 px tall');
  // Vox Text is sharp only from a whole pixel. With voxels the stage puts the words there; plain, the page's own spacing decides, and it is told, not failed (as tools/crisp.mjs does)
  if (voxels) say(made.every((k) => k.grid), 'the legend of every key starts on a whole pixel' + (made.every((k) => k.grid) ? '' : ': not ' + made.filter((k) => !k.grid).map((k) => k.id).join(', ')));
  else console.log(`      plain: ${made.filter((k) => !k.grid).length} of ${made.length} legends start off a whole pixel (the page's spacing decides)`);
  say(await p.evaluate(() => { scrollTo(200, 0); const moved = scrollX; scrollTo(0, 0); return moved; }) === 0, 'the page does not scroll sideways');

  // a real press opens the browser's picker, and the key is down while it is open
  const [x, y] = await centre('#region');
  await p.mouse.move(x, y, { steps: 6 });
  await p.mouse.down();
  await p.waitForTimeout(60);
  let s = await read('region');
  const can = s.open !== null;
  console.log(`      ${mode}: this browser ${can ? 'says' : 'cannot say'} whether a picker is open (select:open)`);
  if (can) say(s.open === true, "a press on the key opens the browser's own picker");
  if (voxels) say(s.down === true, 'the key goes down under the press');
  await p.mouse.up();
  await p.waitForTimeout(400);
  s = await read('region');
  if (can) say(s.open === true && s.focus, 'letting go leaves the picker open, and the select has the focus');
  if (voxels && !can) say(s.down === false && s.held === false, 'where the browser cannot say, the key comes up once the release is heard');
  if (voxels && can) say(s.down === true, 'the key stays down while its picker is open');
  await p.screenshot({ path: `shots/parts/select/hand-${mode}-open.png` });
  // a press elsewhere closes it
  await click(900, 800);
  await p.waitForTimeout(400);
  s = await read('region');
  if (can) say(s.open === false, 'a press elsewhere closes the picker');
  if (voxels) say(s.down === false && s.held === false, 'and the key comes up');
  say(s.value === 'iad', 'nothing was chosen: Virginia still');
  // open, and the same key again closes it
  await click(x, y);
  await p.waitForTimeout(300);
  s = await read('region');
  if (can) say(s.open === true, 'a press opens it again');
  await click(x, y);
  await p.waitForTimeout(400);
  s = await read('region');
  if (can) say(s.open === false, 'a second press on the key closes it');
  if (voxels) say(s.down === false, 'and the key is up');
  // open, then Tab: focus moves on, the picker closes, the key comes up
  await click(x, y);
  await p.waitForTimeout(300);
  await p.keyboard.press('Tab');
  await p.waitForTimeout(400);
  s = await read('region');
  const next = await read('runtime');
  say(!s.focus && next.focus, 'Tab moves on to the next select');
  if (can) say(s.open === false, 'and the picker it left is closed');
  if (voxels) say(s.down === false, 'and its key is up');

  // keys: a real key changes the choice, and the page hears it
  await p.keyboard.press('Shift+Tab');
  await p.keyboard.type('s');
  await p.waitForTimeout(300);
  s = await read('region');
  say(s.focus && s.value === 'sin', 'typing S with the key in focus chooses Singapore');
  say(await p.evaluate(() => document.getElementById('said').textContent) === 'Builds in Singapore on Node 22, kept for a week.', 'and the page hears the choice');
  if (voxels) say(s.down === false, 'the key does not stay down for a letter');
  await p.waitForTimeout(1500); // the browser forgets what was typed after a moment; F is then a new word
  await p.keyboard.type('f');
  await p.waitForTimeout(1500);
  s = await read('region');
  say(s.value === 'fra' && s.text === 'Frankfurt', 'F chooses Frankfurt, and the key says so');
  // Space opens the picker from the keyboard
  await p.keyboard.press('Space');
  await p.waitForTimeout(300);
  s = await read('region');
  if (can) say(s.open === true, 'Space opens the picker');
  if (voxels && can) say(s.down === true, 'and the key is down while it is open');
  await p.keyboard.press('Tab');
  await p.waitForTimeout(400);
  s = await read('region');
  if (can) say(s.open === false, 'Tab closes it');
  if (voxels) say(s.down === false && s.held === false, 'and the key is up');

  // a choice made from code is shown: the words are the select's own
  await p.evaluate(() => { document.getElementById('keep').value = 'A month'; });
  s = await read('keep');
  say(s.text === 'A month', 'a choice set from code is the one shown');
  // switched off: it does not open, and does not go down
  const [ox, oy] = await centre('#s-off');
  await click(ox, oy);
  await p.waitForTimeout(250);
  s = await read('s-off');
  say(s.open !== true && !s.focus, 'a select that is switched off does not open');
  if (voxels) say(s.down === false, 'and its key does not go down');
  // nothing chosen yet: the words say so, and the form knows it is not answered
  say(await p.evaluate(() => { const c = document.getElementById('s-none'); return c.value === '' && c.selectedOptions[0].textContent === 'Choose a team' && !c.validity.valid; }), 'a select with nothing chosen says so, and is not yet valid');
  await p.focus('#s-none');
  await p.keyboard.type('s');
  await p.waitForTimeout(300);
  say(await p.evaluate(() => { const c = document.getElementById('s-none'); return c.value === 'saltmarsh' && c.validity.valid; }), 'a key chooses one, and it is valid');

  if (voxels) {
    // less motion: the cap is down or up, with nothing between
    await p.emulateMedia({ reducedMotion: 'reduce' });
    const [kx, ky] = await centre('#keep');
    await p.mouse.move(kx, ky, { steps: 4 });
    await p.mouse.down();
    const at = await p.evaluate(() => { const l = window.vx.live(document.getElementById('keep').closest('.vx-select')); return [l.spring('press').x, l.look.travel]; });
    say(at[0] === -at[1], `with less motion asked for, the cap is down at once (${at[0]} of ${-at[1]})`);
    await p.mouse.up();
    await click(900, 800);
    await p.waitForTimeout(400);
    say(await p.evaluate(() => window.vx.live(document.getElementById('keep').closest('.vx-select')).spring('press').x) === 0, 'and up again');
    await p.emulateMedia({ reducedMotion: 'no-preference' });
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
