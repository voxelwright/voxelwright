// A person at the code input's page: a real mouse on its windows, real keys, a paste.
// Says ok or FAIL for each thing that must hold; exit 1 on a failure.
//   PORT=5989 node tools/parts/code-input.mjs
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const port = process.env.PORT || 5989;
const url = `http://127.0.0.1:${port}/kit/showcase/parts/code-input.html`;
const dir = 'shots/parts/code-input';
await mkdir(dir, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
let bad = 0;
const say = (ok, what) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); };
const errors = [];

async function open({ plain = false, width = 1180, height = 1000, script = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, javaScriptEnabled: script });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  if (plain) await p.addInitScript(() => { new MutationObserver((_, o) => { if (document.documentElement) { document.documentElement.setAttribute('data-vx-plain', ''); o.disconnect(); } }).observe(document, { childList: true }); });
  await p.goto(`${url}?theme=light`);
  if (script) await p.waitForFunction(() => document.documentElement.dataset.ready === '1');
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(script ? 500 : 300);
  return p;
}

// what a row says: its value, the window marked, where the caret is, how far the input is scrolled
const read = (p, id) => p.evaluate((id) => {
  const i = document.getElementById(id), row = i.parentElement, cells = [...row.querySelectorAll('.vx-otp-cell')];
  return { value: i.value, active: cells.findIndex((c) => c.hasAttribute('data-vx-active')), full: cells.filter((c) => c.hasAttribute('data-vx-full')).length, caret: i.selectionStart, scroll: i.scrollLeft, focus: document.activeElement === i };
}, id);
// does each character's middle lie on its window's middle? (measured with the input's own font)
const centred = (p, id) => p.evaluate((id) => {
  const i = document.getElementById(id), row = i.parentElement, cs = getComputedStyle(i), cells = [...row.querySelectorAll('.vx-otp-cell')];
  const c = document.createElement('canvas').getContext('2d');
  c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const ch = c.measureText('0').width, pitch = parseFloat(cs.letterSpacing) + ch, start = i.getBoundingClientRect().left + parseFloat(cs.paddingLeft) - i.scrollLeft;
  return Math.max(...cells.map((cell, k) => { const r = cell.getBoundingClientRect(); return Math.abs(start + k * pitch + ch / 2 - (r.left + r.width / 2)); }));
}, id);
const cell = (id, k) => `#${id} ~ .vx-otp-cell, .vx-otp:has(#${id}) > .vx-otp-cell:nth-of-type(${k + 1})`;
const at = async (p, id, k) => { const b = await p.locator(`.vx-otp:has(#${id}) > .vx-otp-cell`).nth(k).boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
const boxes = (q) => q.evaluate(() => [...document.querySelectorAll('.vx-otp, .vx-otp > input')].map((e) => { const r = e.getBoundingClientRect(); return [r.x, r.y + scrollY, r.width, r.height].map(Math.round).join(' '); }));

let liveBoxes;
for (const plain of [false, true]) {
  const p = await open({ plain });
  const tag = plain ? 'plain: ' : '';
  if (!plain) liveBoxes = await boxes(p);
  else { const b = await boxes(p); say(b.join() === liveBoxes.join(), `plain: every row and its input have the box they have in voxels`); }
  const shape = await p.evaluate(() => { const row = document.querySelector('.vx-otp:has(#code)'), cells = row.querySelectorAll('.vx-otp-cell'); return [cells.length, [...cells].every((c) => c.getAttribute('aria-hidden') === 'true'), row.querySelectorAll('input').length, document.getElementById('code').autocomplete, document.getElementById('code').inputMode]; });
  say(shape[0] === 6 && shape[1] && shape[2] === 1 && shape[3] === 'one-time-code' && shape[4] === 'numeric', `${tag}one real input (one-time-code, numeric) over six windows hidden from a screen reader (${shape.join(', ')})`);
  if (!plain) say(await p.evaluate(() => [...document.querySelectorAll('.vx-otp:has(#code) > .vx-otp-cell')].every((c) => !!window.vx.live(c)?.well)), 'each window is a well of its own, drawn by this part');
  let s = await read(p, 'code');
  say(s.active === -1, `${tag}with no focus no window is marked`);

  // ---- a real mouse on the first window, then typing
  const [x0, y0] = await at(p, 'code', 0);
  await p.mouse.click(x0, y0);
  s = await read(p, 'code');
  say(s.focus && s.active === 0, `${tag}a press on the first window: the input has the focus and the first window is marked`);
  if (!plain) say(await p.evaluate(() => { const l = window.vx.live(document.querySelector('.vx-otp:has(#code) > .vx-otp-cell')); const pilot = l.model.byName.pilot; return pilot.count === 3 && pilot.col[3] > 0; }), 'the first window lights its fixed three-voxel pilot at once');
  await p.keyboard.type('48a2');
  s = await read(p, 'code');
  say(s.value === '482' && s.active === 3 && s.full === 3, `${tag}typing 4, 8, a, 2: only the digits are kept, each in its window, and the fourth is marked (${s.value}, window ${s.active + 1})`);
  await p.keyboard.press('Backspace');
  s = await read(p, 'code');
  say(s.value === '48' && s.active === 2, `${tag}Backspace empties the window before and goes back to it (${s.value}, window ${s.active + 1})`);
  await p.keyboard.press('ArrowLeft');
  say((await read(p, 'code')).active === 1, `${tag}the left arrow goes a window back`);
  const [x1, y1] = await at(p, 'code', 0);
  await p.mouse.click(x1, y1);
  await p.keyboard.type('7');
  s = await read(p, 'code');
  say(s.value === '78' && s.active === 1, `${tag}a press on a window that holds a digit, and a digit typed: it is replaced, and the next is marked (${s.value})`);
  // ---- a paste, as a code from a message is
  await p.evaluate(() => { window.done = []; document.getElementById('code').addEventListener('vx-complete', (e) => window.done.push(e.detail.value)); });
  await p.keyboard.press('ControlOrMeta+a');
  await p.keyboard.insertText('123 456');
  s = await read(p, 'code');
  say(s.value === '123456' && s.full === 6 && s.active === 5 && (await p.evaluate(() => window.done)).join() === '123456', `${tag}a pasted "123 456" fills every window, and vx-complete is sent once (${s.value})`);
  await p.keyboard.type('9');
  s = await read(p, 'code');
  say(s.value === '123456' && s.scroll === 0, `${tag}full, a digit more does nothing, and the input does not scroll (${s.scroll} px)`);
  const off = await centred(p, 'code');
  say(off < 1.5, `${tag}each digit lies in the middle of its window (${off.toFixed(2)} px off at most)`);
  if (!plain) { await p.waitForTimeout(200); await p.screenshot({ path: `${dir}/hand-full.png`, clip: { x: 200, y: 200, width: 460, height: 260 } }); }
  await p.keyboard.press('Home');
  say((await read(p, 'code')).active === 0, `${tag}Home goes to the first window`);

  // ---- letters and digits
  await p.locator('#pair').click();
  for (let k = 0; k < 4; k++) await p.keyboard.press('ArrowRight');
  await p.keyboard.type('x9');
  s = await read(p, 'pair');
  say(s.value === 'K7QX', `${tag}inputmode="text" takes letters too, as capitals, and no more than its windows (${s.value})`);

  // ---- switched off
  await p.mouse.click(...await at(p, 'off', 2));
  s = await read(p, 'off');
  say(!s.focus && s.value === '301772', `${tag}one that is switched off takes no focus`);
  if (!plain) {
    await p.mouse.move(4, 4);
    await p.evaluate(() => document.activeElement.blur());
    await p.waitForTimeout(800);
    say(await p.evaluate(() => window.vx.stage.awake.size) === 0, 'at rest nothing runs');
  }
  await p.context().close();
}

// ---- on a phone
for (const plain of [false, true]) {
  const q = await open({ width: 390, height: 844, plain });
  const side = await q.evaluate(() => { scrollTo(200, scrollY); const x = scrollX; scrollTo(0, scrollY); return x; });
  const cut = await q.evaluate(() => { const s = document.querySelector('.sheet').getBoundingClientRect(); return [...document.querySelectorAll('.vx-otp')].filter((c) => { const r = c.getBoundingClientRect(); return r.left < s.left || r.right > s.right; }).length; });
  say(side === 0 && cut === 0, `at 390 px${plain ? ', plain' : ''}: no row is cut and the page does not scroll sideways`);
  await q.context().close();
}

// ---- no script: the windows are painted, and the input still takes a code
{
  const q = await open({ script: false });
  const bg = await q.evaluate(() => getComputedStyle(document.querySelector('.vx-otp')).backgroundImage);
  await q.locator('#code').click();
  await q.keyboard.type('135792');
  const v = await q.evaluate(() => document.getElementById('code').value);
  const off = await q.evaluate(() => {
    const i = document.getElementById('code'), cs = getComputedStyle(i), c = document.createElement('canvas').getContext('2d');
    c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const ch = c.measureText('0').width, pitch = parseFloat(cs.letterSpacing) + ch, r = i.getBoundingClientRect(), vx = parseFloat(cs.getPropertyValue('--vx')) || 4;
    return Math.max(...[0, 1, 2, 3, 4, 5].map((k) => Math.abs(r.left + parseFloat(cs.paddingLeft) - i.scrollLeft + k * pitch + ch / 2 - (r.left + k * 11 * vx + 4.5 * vx))));
  });
  say(bg.includes('gradient') && v === '135792' && off < 1.5, `with no script the windows are painted under the input, and a typed code lies in them (${v}, ${off.toFixed(2)} px off)`);
  await q.context().close();
}

say(errors.length === 0, 'no errors' + (errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''));
await browser.close();
console.log(bad ? `${bad} to fix` : 'ok: the code input answers a real mouse, real keys and a paste');
process.exit(bad ? 1 : 0);
