// The lit slider under a real mouse and real keys: the key stays under the pointer, the trench
// behind it is lit, the arrow keys move it, and it follows a value set from code.
//   PORT=5989 node tools/parts/slider.mjs
import { chromium } from 'playwright';

const port = process.env.PORT || 5989;
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
const p = await (await browser.newContext({ viewport: { width: 1180, height: 900 }, deviceScaleFactor: 1 })).newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(String(e)));
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
let bad = 0;
const say = (ok, what) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); };

await p.goto(`http://127.0.0.1:${port}/showcase/parts/slider.html?theme=light`);
await p.waitForFunction(() => document.documentElement.dataset.ready === '1' && window.vx);
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(600);

// what the model says: where the key's middle is on the page, how far down it is, how much is lit
const read = (id) => p.evaluate((id) => {
  const input = document.getElementById(id), el = input.closest('.vx-slider'), l = window.vx.live(el);
  const { thumb, lit, walls } = l.model.byName, r = el.getBoundingClientRect();
  let on = 0;
  for (let i = 0; i < lit.count; i++) if (lit.scales[i] > 0.5) on++;
  return { value: Number(input.value), key: r.left + (thumb.tx + 2.5) * l.vx, down: thumb.tz, press: l.spring('press').target, lit: on / (lit.count || 1), trench: !!walls && !!l.well, left: r.left, right: r.right, y: r.top + r.height / 2, W: l.W, vx: l.vx };
}, id);

let s = await read('fine');
say(s.trench, 'the slider is drawn as a trench in the surface (the lit model)');
say(Math.abs(s.key - (s.left + s.right) / 2) < 3, `at half, the key is in the middle of the trench (${s.key.toFixed(1)} for ${((s.left + s.right) / 2).toFixed(1)})`);
say(s.lit > 0.4 && s.lit < 0.6, `and half of the trench is lit (${(s.lit * 100).toFixed(0)}%)`);

// a real press on the track: the key comes to the pointer
for (const f of [0.2, 0.83]) {
  const x = Math.round(s.left + (s.right - s.left) * f);
  await p.mouse.move(x, s.y, { steps: 6 });
  await p.mouse.down(); await p.waitForTimeout(120);
  const held = await read('fine');
  say(held.press < 0 && held.down < -0.5, `pressed at ${(f * 100).toFixed(0)}%: the key goes down (${held.down.toFixed(2)} voxels)`);
  await p.mouse.up(); await p.waitForTimeout(350);
  const now = await read('fine');
  say(Math.abs(now.key - x) <= 1.5, `and its middle is under the pointer (${now.key.toFixed(1)} for ${x})`);
  say(now.press === 0 && Math.abs(now.down) < 0.05, 'let go, it comes back up');
  say(Math.abs(now.lit - f) < 0.06, `the trench is lit up to the key (${(now.lit * 100).toFixed(0)}% for ${(f * 100).toFixed(0)}%)`);
}

// a drag: the key follows the pointer all the way
s = await read('fine');
await p.mouse.move(s.key, s.y, { steps: 4 });
await p.mouse.down();
let worst = 0;
for (const f of [0.7, 0.55, 0.4, 0.3]) {
  const x = Math.round(s.left + (s.right - s.left) * f);
  await p.mouse.move(x, s.y, { steps: 5 });
  await p.waitForTimeout(80);
  worst = Math.max(worst, Math.abs((await read('fine')).key - x));
}
await p.mouse.up();
say(worst <= 1.5, `dragged, the key stays under the pointer (never more than ${worst.toFixed(1)} px away)`);
const dragged = await read('fine');
say(dragged.value > 250 && dragged.value < 350, `and the value is where it was left (${dragged.value} of 1000)`);

// the ends: the key stops inside the trench, and at the least nothing is lit
await p.mouse.click(s.left + 1, s.y); await p.waitForTimeout(250);
let end = await read('fine');
say(end.value === 0 && end.lit === 0 && end.key - 2.5 * end.vx >= end.left + end.vx - 0.5, `at the least: value 0, nothing lit, the key a voxel inside the trench`);
await p.mouse.click(s.right - 1, s.y); await p.waitForTimeout(250);
end = await read('fine');
say(end.value === 1000 && end.lit > 0.9 && end.key + 2.5 * end.vx <= end.right - end.vx + 0.5, `at the most: value 1000, the trench lit, the key a voxel inside`);

// keys
await p.focus('#inst'); await p.keyboard.press('Shift+Tab'); await p.keyboard.press('Tab');
say(await p.evaluate(() => document.activeElement.id === 'inst'), 'Tab reaches the slider');
const ring = await p.evaluate(() => { const c = getComputedStyle(document.activeElement.closest('.vx-slider')); return c.outlineStyle + ' ' + c.outlineWidth; });
say(/solid 2px/.test(ring), `in focus it has a ring (${ring})`);
const before = await read('inst');
await p.keyboard.press('ArrowRight'); await p.waitForTimeout(150);
let after = await read('inst');
say(after.value === before.value + 1 && after.key > before.key, `ArrowRight: ${before.value} to ${after.value}, and the key moves right`);
say(await p.evaluate(() => document.getElementById('inst-out').textContent) === String(after.value), 'the number beside it follows');
await p.keyboard.press('ArrowLeft'); await p.keyboard.press('ArrowLeft'); await p.waitForTimeout(150);
after = await read('inst');
say(after.value === before.value - 1 && after.key < before.key, `ArrowLeft twice: ${after.value}, and the key moves left`);
await p.keyboard.press('End'); await p.waitForTimeout(150);
say((await read('inst')).value === 12, 'End goes to the most');
await p.keyboard.press('Home'); await p.waitForTimeout(150);
after = await read('inst');
say(after.value === 1 && after.lit === 0, 'Home goes to the least, and the light is out');

// set from code
await p.evaluate(() => { document.getElementById('mem').value = 1536; }); await p.waitForTimeout(200);
const mem = await read('mem');
say(mem.value === 1536 && mem.lit > 0.6 && mem.lit < 0.85, `a value set from code moves the key and the light (${(mem.lit * 100).toFixed(0)}% lit)`);

// off, and right to left
await p.locator('#rtl').scrollIntoViewIfNeeded(); await p.waitForTimeout(200);
const off = await read('off');
await p.mouse.click(off.left + 20, off.y); await p.waitForTimeout(200);
say((await read('off')).value === 6, 'one that is off does not answer a press');
const rtl = await read('rtl');
say(rtl.key > (rtl.left + rtl.right) / 2, 'right to left: a low value has its key toward the right');
await p.mouse.click(rtl.left + 30, rtl.y); await p.waitForTimeout(250);
const rtl2 = await read('rtl');
say(rtl2.value >= 9 && Math.abs(rtl2.key - (rtl.left + 30)) < 22, `and a press near the left gives a high value, with the key there (${rtl2.value})`);

await p.screenshot({ path: 'shots/parts/slider/hand.png' });
say(errors.length === 0, 'no errors' + (errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''));
await browser.close();
process.exit(bad ? 1 : 0);
