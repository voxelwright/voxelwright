// The sheet under a real mouse and real keys: a panel of voxels that comes in from an edge of
// the window over a scrim, keeps the focus, keeps the page still, and goes back on Escape, on its
// keys and on a press on the scrim.
//   PORT=5989 node tools/parts/sheet.mjs
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const port = process.env.PORT || 5989;
const url = `http://127.0.0.1:${port}/kit/showcase/parts/sheet.html`;
await mkdir('shots/parts/sheet', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
const errors = [];
let bad = 0;
const say = (ok, what) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); };
async function open(opts = {}, query = '?theme=light', plain = false) {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 700 }, deviceScaleFactor: 1, ...opts });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  if (plain) await p.addInitScript(() => { new MutationObserver((_, o) => { if (document.documentElement) { document.documentElement.setAttribute('data-vx-plain', ''); o.disconnect(); } }).observe(document, { childList: true }); });
  await p.goto(url + query);
  await p.waitForFunction(() => document.documentElement.dataset.ready === '1');
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(700);
  return p;
}
const mid = async (p, sel) => { const b = await p.locator(sel).first().boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
const press = async (p, sel) => { await p.locator(sel).first().scrollIntoViewIfNeeded(); const [x, y] = await mid(p, sel); await p.mouse.move(x, y, { steps: 5 }); await p.mouse.down(); await p.waitForTimeout(60); await p.mouse.up(); };
// what a sheet is, as the page has it now
const read = (p, sel) => p.evaluate(async (sel) => {
  const el = document.querySelector(sel), cs = getComputedStyle(el), r = el.getBoundingClientRect();
  const l = window.vx?.live?.(el);
  let made = null;
  if (l) {
    const { MATERIALS } = await import('/kit/src/index.js');
    const name = (i) => Object.keys(MATERIALS).find((k) => MATERIALS[k].id === i);
    const of = (q) => (q ? [...new Set(q.mats)].map(name).sort().join('+') : 'none');
    made = { panel: of(l.model.byName.panel), cubes: l.model.byName.panel?.count ?? 0, groove: of(l.model.byName.groove), top: l.faceZ, slab: l.look.slab, edge: l.state.edge, seen: l.visible, drawn: !l.dirty, bolts: !!l.model.byName.bolts, light: !!l.model.byName.light };
  }
  const a = document.activeElement;
  return {
    open: el.open, modal: el.matches(':modal'), shown: cs.display !== 'none', value: el.returnValue, moved: /^(none|0px( 0px)?)$/.test(cs.translate) ? '0' : cs.translate,
    left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: r.width, h: r.height, vw: document.documentElement.clientWidth, vh: innerHeight,
    inside: el.contains(a), focus: a === document.body || a === document.documentElement ? a.tagName : a.id || a.getAttribute('aria-label') || a.textContent.trim().slice(0, 24) || a.tagName, scrollY, made,
  };
}, sel);
const settle = (p) => p.waitForTimeout(450);

// ---------------------------------------------------------------------------------------------
let p = await open();

// the four that stand open on the page, one at each edge of a small window
const stand = {};
for (const [edge, n] of [['right', 0], ['left', 1], ['top', 2], ['bottom', 3]]) stand[edge] = await read(p, `.frames > div:nth-child(${n + 1}) dialog`);
say(Object.entries(stand).every(([edge, s]) => s.made?.edge === edge && s.made.panel === 'panel' && s.made.cubes > 500), `a sheet is a reading plate at its edge (${Object.entries(stand).map(([e, s]) => `${e}: ${s.made?.panel}, ${s.made?.cubes} cubes`).join('; ')})`);
say(Object.values(stand).every((s) => s.made.top === s.made.slab && !s.made.bolts && !s.made.light), `it is as thick as a surface (${stand.right.made.top} voxels), with no bolts (it moves) and no light of its own`);
say(Object.values(stand).every((s) => s.made.groove === 'light-warm'), 'a groove of the room\'s light parts its header from what is below');

// the page scrolls, until a sheet is over it
await p.mouse.move(600, 300); await p.mouse.wheel(0, 200); await p.waitForTimeout(250);
const scrolled = await p.evaluate(() => scrollY);
await p.evaluate(() => scrollTo(0, 0)); await p.waitForTimeout(150);

// opened with the mouse: it slides in from the end
await press(p, '#open-filters');
await p.waitForTimeout(70);
let s = await read(p, '#filters');
say(s.open && s.modal && s.moved !== '0', `a press on Filters opens it as a modal dialog, and it is on its way in (${s.moved} to go)`);
say(s.made.seen && s.made.cubes > 5000 && s.made.panel === 'gasket+panel+slate+steel' && s.made.groove === 'backlight+steel', `its mounted plate and light pipe are there from the start (${s.made.cubes} cubes of ${s.made.panel})`);
await settle(p);
s = await read(p, '#filters');
say(s.moved === '0' && Math.abs(s.right - s.vw) < 0.5 && s.top === 0 && Math.abs(s.bottom - s.vh) < 0.5 && s.made.drawn, `then it rests against the end of the window, from top to bottom (${s.left} to ${s.right} of ${s.vw})`);
say(s.w % 4 === 0 && s.w <= 96 * 4, `it is a whole number of voxels wide (${s.w / 4})`);
say(s.inside, `the focus is inside it (${s.focus})`);
const keysDrawn = await p.evaluate(() => [...document.querySelectorAll('#filters .vx-button, #filters .vx-box, #filters .vx-well')].every((n) => { const l = window.vx.live(n); return l && l.visible && !l.dirty && l.W > 1; }));
say(keysDrawn, 'the keys, the boxes and the well in it are drawn too');
await p.screenshot({ path: 'shots/parts/sheet/hand-end-day.png' });
const stops = [];
for (let i = 0; i < 9; i++) { await p.keyboard.press('Tab'); const r = await read(p, '#filters'); stops.push(r.inside ? r.focus : 'OUT:' + r.focus); }
say(!stops.some((t) => t.startsWith('OUT:') && !/^OUT:(BODY|HTML)/.test(t)) && stops.includes('Apply') && stops.includes('Reset'), `Tab goes round inside it and never reaches the page behind (${[...new Set(stops)].join(', ')})`);
await p.mouse.move(300, 300); await p.mouse.wheel(0, 200); await p.waitForTimeout(250);
s = await read(p, '#filters');
say(scrolled > 0 && s.scrollY === 0, `the page behind does not scroll under it (a wheel moved the page ${scrolled} px before, ${s.scrollY} px now)`);

// Escape: it slides out, the focus goes back
// Sample the browser's exit transition at its midpoint. A wall-clock wait
// can miss the entire 200 ms slide when the other part checks share the GPU.
await p.locator('#filters').evaluate(el => {
  el.addEventListener('cancel', () => {
    const slide = el.getAnimations().find(a => a.transitionProperty === 'translate');
    if (slide) slide.currentTime = slide.effect.getTiming().duration / 2;
    const rect = el.getBoundingClientRect();
    window.sheetExit = { column: getComputedStyle(el).flexDirection === 'column', open: el.open, shown: getComputedStyle(el).display !== 'none',
      width: rect.width, outside: rect.right - document.documentElement.clientWidth };
  }, { once: true });
});
await p.keyboard.press('Escape');
const exitSample = await p.waitForFunction(() => window.sheetExit);
const exit = await exitSample.jsonValue();
say(!exit.open && exit.column && exit.shown && exit.outside > 0 && exit.outside < exit.width,
  `Escape closes the sheet and it slides out (${exit.outside.toFixed(1)} of ${exit.width} px outside at mid-travel)`);
await p.locator('#filters').waitFor({ state: 'hidden', timeout: 1500 });
s = await read(p, '#filters');
say(!s.shown && s.value === 'cancel' && s.focus === 'open-filters', `then it is gone, with "cancel", and the focus is back on the key that opened it (${s.focus})`);
say(await p.evaluate(() => document.getElementById('result').textContent) === 'Filters left as they were', 'the page heard it close');

// a press on the scrim closes it; a press on its own face does not
await p.keyboard.press('Enter'); await settle(p);
s = await read(p, '#filters');
say(s.open && s.modal, 'Enter on that key opens it again');
await p.mouse.click(s.left + 150, s.top + 300); await p.waitForTimeout(200);
say((await read(p, '#filters')).open, 'a press on its own face leaves it open');
await p.mouse.move(s.left + 150, 300); await p.mouse.down(); await p.mouse.move(200, 300, { steps: 4 }); await p.mouse.up(); await p.waitForTimeout(200);
say((await read(p, '#filters')).open, 'a drag that starts on it and ends on the scrim leaves it open');
await p.mouse.click(200, 300); await settle(p);
s = await read(p, '#filters');
say(!s.open && !s.shown && s.value === 'cancel' && s.focus === 'open-filters', 'a press on the scrim closes it with "cancel"; the focus is back');

// its keys
await press(p, '#open-filters'); await settle(p);
await press(p, '#filters .vx-close'); await settle(p);
s = await read(p, '#filters');
say(!s.open && s.value === 'cancel', 'its close key closes it');
await press(p, '#open-filters'); await settle(p);
await press(p, '#filters [data-vx-close="reset"]'); await settle(p);
s = await read(p, '#filters');
say(!s.open && s.value === 'reset' && await p.evaluate(() => document.getElementById('result').textContent) === 'Showing every deploy', 'Reset closes it with "reset"');
await press(p, '#open-filters'); await settle(p);
await p.locator('#branch').fill('fogline-cache'); await p.locator('#branch').press('Enter'); await settle(p);
s = await read(p, '#filters');
say(!s.open && s.value === 'apply' && s.focus === 'open-filters', 'Enter in its field sends the form: it closes with the main key\'s value');

const visibleDeploys = () => p.locator('.deploys .vx-item:visible .vx-item-title').allTextContents();
say((await visibleDeploys()).join(',') === 'Deploy 213,Deploy 212', 'the branch match and the pinned live deploy are visible');
await press(p, '#open-filters'); await settle(p);
await p.locator('#filters [name="live"]').uncheck();
await p.locator('#branch').fill('missing');
await p.keyboard.press('Escape'); await settle(p);
await press(p, '#open-filters'); await settle(p);
say(await p.locator('#branch').inputValue() === 'fogline-cache' && await p.locator('#filters [name="live"]').isChecked(),
  'cancelling discards both draft changes');
await p.locator('#filters [name="live"]').uncheck();
await p.locator('#filters [name="failed"]').check();
await p.locator('#branch').press('Enter'); await settle(p);
say((await visibleDeploys()).join(',') === 'Deploy 212', 'Apply shows the failed deploy alone');
await press(p, '#open-filters'); await settle(p);
await press(p, '#filters [data-vx-close="reset"]'); await settle(p);
say((await visibleDeploys()).length === 3, 'Reset restores all three deploys');

// the other three edges
for (const [id, key, edge] of [['s-top', 'open-top', 'top'], ['s-bottom', 'open-bottom', 'bottom'], ['s-start', 'open-start', 'left']]) {
  await press(p, '#' + key); await settle(p);
  s = await read(p, '#' + id);
  const at = edge === 'top' ? s.top === 0 && s.left === 0 && Math.abs(s.right - s.vw) < 0.5 && s.bottom < s.vh - 44
    : edge === 'bottom' ? Math.abs(s.bottom - s.vh) < 0.5 && s.left === 0 && Math.abs(s.right - s.vw) < 0.5 && s.top > 44
      : s.left === 0 && s.top === 0 && Math.abs(s.bottom - s.vh) < 0.5 && s.right < s.vw - 44;
  say(s.open && s.modal && s.moved === '0' && at && s.made.edge === edge && s.inside, `${key}: it rests against the ${edge} edge, with the scrim left to press (${Math.round(s.left)}, ${Math.round(s.top)} to ${Math.round(s.right)}, ${Math.round(s.bottom)})`);
  if (edge === 'bottom') await p.screenshot({ path: 'shots/parts/sheet/hand-bottom-day.png' });
  if (edge === 'left') await p.screenshot({ path: 'shots/parts/sheet/hand-start-day.png' });
  if (edge === 'top') await p.screenshot({ path: 'shots/parts/sheet/hand-top-day.png' });
  await p.keyboard.press('Escape'); await settle(p);
  s = await read(p, '#' + id);
  say(!s.shown && s.focus === key, `Escape sends it back, and the focus is on its key (${s.focus})`);
}

// right to left: the end is the left
await p.evaluate(() => { document.documentElement.dir = 'rtl'; }); await p.waitForTimeout(300);
await press(p, '#open-filters'); await p.waitForTimeout(70);
s = await read(p, '#filters');
const fromLeft = s.left < -1;
await settle(p);
s = await read(p, '#filters');
say(s.open && s.left === 0 && s.made.edge === 'left' && fromLeft, `written right to left, the end is the left edge, and it comes in from there (${s.left} to ${s.right})`);
await p.keyboard.press('Escape'); await settle(p);
await p.close();

// night
p = await open({}, '?theme=dark');
await press(p, '#open-filters'); await settle(p);
await p.screenshot({ path: 'shots/parts/sheet/hand-end-night.png' });
await p.close();

// where motion is not wanted, nothing travels
p = await open({ reducedMotion: 'reduce' });
await press(p, '#open-filters'); await p.waitForTimeout(40);
s = await read(p, '#filters');
say(s.open && s.moved === '0' && Math.abs(s.right - s.vw) < 0.5, 'with reduced motion it is in place at once');
await p.waitForTimeout(200);
say((await read(p, '#filters')).made.drawn, 'and drawn');
await p.keyboard.press('Escape'); await p.waitForTimeout(40);
s = await read(p, '#filters');
say(!s.open && !s.shown && s.focus === 'open-filters', 'and gone at once on Escape');
await p.close();

// a phone
p = await open({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2 });
await press(p, '#open-filters'); await settle(p);
s = await read(p, '#filters');
const side = await p.evaluate(() => { scrollTo(200, 0); const x = scrollX; scrollTo(0, 0); return x; });
say(s.open && s.left >= 44 && Math.abs(s.right - 390) < 0.5 && s.w % 4 === 0 && side === 0, `at 390 px it leaves ${s.left} px of scrim to press, is ${s.w / 4} voxels wide, and the page does not move sideways`);
const cut = await p.evaluate(() => [...document.querySelectorAll('#filters :is(h2, label, button, input)')].filter((n) => { const r = n.getBoundingClientRect(); return r.width && (r.left < 0 || r.right > innerWidth + 0.5); }).length);
say(cut === 0, 'nothing in it is cut off');
await p.screenshot({ path: 'shots/parts/sheet/hand-end-390.png' });
await p.keyboard.press('Escape'); await settle(p);
await press(p, '#open-bottom'); await settle(p);
await p.screenshot({ path: 'shots/parts/sheet/hand-bottom-390.png' });
await p.close();

// with no voxels at all it is the same sheet
p = await open({}, '?theme=light', true);
say(await p.evaluate(() => !document.querySelector('[data-vx-live]')), 'plain: nothing on the page is voxels');
await press(p, '#open-filters'); await p.waitForTimeout(70);
s = await read(p, '#filters');
say(s.open && s.modal && s.moved !== '0', 'plain: its key opens it, and it slides in');
await settle(p);
s = await read(p, '#filters');
say(s.moved === '0' && Math.abs(s.right - s.vw) < 0.5 && s.inside, 'plain: it rests at the end, with the focus inside');
await p.screenshot({ path: 'shots/parts/sheet/hand-end-plain.png' });
await p.mouse.click(200, 300); await settle(p);
s = await read(p, '#filters');
say(!s.shown && s.value === 'cancel' && s.focus === 'open-filters', 'plain: a press on the scrim closes it; the focus is back');
await press(p, '#open-filters'); await settle(p);
await press(p, '#filters [data-vx-close="reset"]'); await settle(p);
say((await read(p, '#filters')).value === 'reset', 'plain: its keys close it with their words');
await p.close();

say(errors.length === 0, 'no errors' + (errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''));
await browser.close();
process.exit(bad ? 1 : 0);
