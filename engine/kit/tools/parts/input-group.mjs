// A person at the input group: a real mouse and real keys, with voxels and plain, on a laptop and
// on a phone. Says ok or FAIL for each thing that must hold.
//   PORT=5989 node tools/parts/input-group.mjs
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const port = process.env.PORT || 5989;
await mkdir('shots/parts/input-group', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
let bad = 0;
for (const mode of ['live', 'plain']) for (const width of [1180, 390]) {
  const tag = `${mode} ${width}`;
  const p = await (await browser.newContext({ viewport: { width, height: 1000 }, deviceScaleFactor: 1 })).newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const say = (ok, what) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${tag}: ${what}`); };
  const press = async (loc, fx = 0.5) => { const b = await loc.boundingBox(); await p.mouse.move(b.x + b.width * fx, b.y + b.height / 2, { steps: 6 }); await p.mouse.down(); await p.waitForTimeout(80); await p.mouse.up(); };
  const focused = () => p.evaluate(() => document.activeElement?.id || '');
  if (mode === 'plain') await p.addInitScript(() => { new MutationObserver((_, o) => { if (document.documentElement) { document.documentElement.setAttribute('data-vx-plain', ''); o.disconnect(); } }).observe(document, { childList: true }); });
  let allowFont, intercepted = false;
  if (mode === 'live') {
    const fontGate = new Promise(resolve => { allowFont = resolve; });
    await p.route('**/ibm-plex-sans-latin-wght-normal.woff2', async route => {
      intercepted = true;
      await fontGate;
      await route.continue();
    });
  }
  await p.goto(`http://127.0.0.1:${port}/kit/showcase/parts/input-group.html?theme=light`, { waitUntil: 'domcontentloaded' });
  if (allowFont) {
    try {
      await p.waitForFunction(() => window.vx?.live(document.querySelector('.address-well'))?.capacity > 0);
      say(intercepted, 'the Latin font request is held through the first live draw');
    } finally { allowFont(); }
    await p.evaluate(() => document.fonts.ready);
    say(await p.evaluate(() => [...document.fonts].some(face => face.family.includes('IBM Plex Sans') && face.status === 'loaded')), 'Plex Sans loaded after the held request');
    await p.waitForFunction(() => {
      const el = document.querySelector('.address-well'), frame = window.vx.live(el);
      const r = el.querySelector('input').getBoundingClientRect();
      const origin = el.getBoundingClientRect().left + (frame.cssW - frame.W * frame.vx) / 2;
      return frame.well[0] === Math.round((r.left - origin) / frame.vx) &&
        frame.well[2] === Math.round((r.right - origin) / frame.vx);
    });
    say(true, 'the aperture follows the native text edges after a late font load, before focus');
  }
  await p.waitForFunction(() => document.documentElement.dataset.ready === '1');
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(700);
  const lives = await p.locator('[data-vx-live]').count();
  say(mode === 'live' ? lives > 0 : lives === 0, mode === 'live' ? `the page is drawn in voxels (${lives} parts)` : 'the page is plain');

  // how every group on the page is put together
  const made = await p.evaluate(() => [...document.querySelectorAll('.vx-input-group')].map((g) => {
    const well = g.querySelector(':scope > .vx-well'), input = well.querySelector('input'), key = g.querySelector(':scope > .vx-button'), name = g.closest('.vx-field').querySelector('.vx-field-label');
    const w = well.getBoundingClientRect(), i = input.getBoundingClientRect(), k = key?.getBoundingClientRect();
    const inside = (r) => r.left >= w.left - 0.5 && r.right <= w.right + 0.5 && r.top >= w.top - 0.5 && r.bottom <= w.bottom + 0.5;
    return {
      id: input.id,
      oneWell: g.querySelectorAll('.vx-well').length === 1,
      addons: [...well.querySelectorAll('.vx-addon')].every((a) => a.tagName === 'LABEL' && a.control === input && inside(a.getBoundingClientRect())),
      named: name.control === input && [...input.labels][0] === name,
      keyOut: !key || (!well.contains(key) && (k.left >= w.right || k.top >= w.bottom)),
      keyTall: !key || k.height >= 44,
      room: i.width >= 32,
      clipped: input.scrollWidth > input.clientWidth + 1,
    };
  }));
  say(made.every((g) => g.oneWell), 'each group is one well');
  say(made.every((g) => g.addons), 'its add-on words are inside that well, and are labels of its input');
  say(made.every((g) => g.named), 'the input is named first by its own label');
  say(made.every((g) => g.keyOut && g.keyTall), 'a key that belongs to it stands outside the well, beside or under it, 44 px tall');
  say(made.every((g) => g.room && !g.clipped), 'every input has room for what it holds' + (made.some((g) => !g.room || g.clipped) ? ': not ' + made.filter((g) => !g.room || g.clipped).map((g) => g.id).join(', ') : ''));
  say(await p.evaluate(() => { scrollTo(200, 0); const moved = scrollX; scrollTo(0, 0); return moved; }) === 0, 'the page does not scroll sideways');

  if (width === 390) {
    await p.setViewportSize({ width: 320, height: 1000 });
    const site = p.locator('#site');
    await site.fill('harbor-prod');
    await site.blur();
    say(await site.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'harbor-prod fits between the fixed labels after blur at 320px');
    await p.setViewportSize({ width, height: 1000 });
  }
  // a press on the words before lands in the input; so does one on the words after
  await press(p.locator('.vx-addon[for="site"]').first());
  say(await focused() === 'site', 'a press on the words before the input puts focus in it');
  if (mode === 'live') {
    await p.waitForTimeout(250);
    const lit = await p.evaluate(async () => { const { MATERIALS } = await import('/kit/src/index.js'); const w = window.vx.live(document.getElementById('site').closest('.vx-well')); return w.model.byName.frame.mats.includes(MATERIALS.light.id); });
    say(lit, "the focus window lights when the add-on focuses its input");
  }
  await p.screenshot({ path: `shots/parts/input-group/hand-${mode}-${width}-focus.png` });
  await p.evaluate(() => document.activeElement.blur());
  await press(p.locator('.vx-addon[for="site"]').last());
  say(await focused() === 'site', 'and so does a press on the words after it');
  await p.keyboard.press('ControlOrMeta+a');
  await p.keyboard.type('Harbor API', { delay: 15 });
  await p.keyboard.press('Enter');
  await p.waitForTimeout(200);
  say(await p.evaluate(() => document.getElementById('said').textContent) === 'Lower case, digits and dashes only.', 'Enter in the input presses the key that belongs to it');
  await p.keyboard.press('ControlOrMeta+a');
  await p.keyboard.type('fogline-docs', { delay: 15 });
  say(await p.evaluate(() => document.getElementById('said').textContent) === '', 'typing takes the answer away');
  await p.keyboard.press('Tab');
  say(await focused() === 'check', 'Tab goes from the input to its key');
  await p.keyboard.press('Shift+Tab');
  say(await focused() === 'site', 'and Shift+Tab back: the words are no stop on the way');
  await press(p.locator('#check'));
  await p.waitForTimeout(250);
  say(await p.evaluate(() => document.getElementById('said').textContent) === 'fogline-docs.fogline.app is free.', 'a press on the key asks');
  // switched off: a press on its words goes nowhere
  await p.evaluate(() => document.activeElement?.blur());
  await press(p.locator('.vx-addon[for="s-off"]').first());
  say(await focused() === '', 'a press on the words of a group that is switched off does nothing');

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
