// A person on the close button's page: a real mouse, at its cap and at the edge of its target,
// and real keys. Says ok or FAIL for each thing that must hold; exit 1 on a failure.
//   PORT=5989 node tools/parts/close-button.mjs
import { chromium } from 'playwright';

const port = process.env.PORT || 5989;
const url = `http://127.0.0.1:${port}/showcase/parts/close-button.html`;
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
let bad = 0;
const say = (ok, what) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); };
const errors = [];

async function open({ plain = false, width = 1180 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
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
const mid = async (p, sel) => { const b = await p.locator(sel).first().boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
// a click of the real mouse this far from the middle of something
const clickAt = async (p, sel, dx = 0, dy = 0) => { const [x, y] = await mid(p, sel); await p.mouse.move(x + dx, y + dy, { steps: 6 }); await p.mouse.down(); await p.waitForTimeout(80); await p.mouse.up(); };
const shown = (p) => p.evaluate(() => !document.getElementById('detail').hidden);
const reopen = async (p) => { await p.evaluate(() => document.getElementById('open').click()); await p.waitForTimeout(300); };
// is the sign in the middle of the cap? The darkest pixels of a picture of the key, plain.
const sign = (p, sel) => p.locator(sel).first().screenshot().then((png) => p.evaluate(async (b64) => {
  const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data; let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) { const i = (y * c.width + x) * 4; if (d[i] + d[i + 1] + d[i + 2] < 200) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } }
  return [x0, y0, c.width - 1 - x1, c.height - 1 - y1]; // clear on the left, above, on the right, below
}, png.toString('base64')));

const p = await open();
const box = await p.locator('#s-rest').boundingBox();
say(box.width === 28 && box.height === 28, `its cap is seven voxels square (${box.width} by ${box.height} px)`);
const room = await p.evaluate(() => { const c = getComputedStyle(document.getElementById('s-rest')), a = getComputedStyle(document.getElementById('s-rest'), '::after'); return [parseFloat(c.marginLeft) * 2 + 28, 28 - parseFloat(a.left) - parseFloat(a.right), 28 - parseFloat(a.top) - parseFloat(a.bottom)]; });
say(room.join() === '44,44,44', `it keeps 44 px of room, and its target is 44 by 44 px (${room.join(', ')})`);
const names = await p.evaluate(() => [...document.querySelectorAll('.vx-close')].map((b) => b.getAttribute('aria-label') || ''));
say(names.every((n) => n.length > 3) && await p.getByRole('button', { name: 'Close the details of deploy 214' }).count() === 1, `every one has a name a screen reader can say (${names.slice(0, 3).join('; ')}; ...)`);
say(await p.evaluate(() => !!window.vx.live(document.getElementById('close')) && window.vx.live(document.getElementById('close')).def.name === 'button'), 'it is the kit\'s own key, drawn by the kit\'s button');

// ---- a real mouse: on the cap, at the edge of the target, and just past it
await clickAt(p, '#close');
say(!(await shown(p)), 'a press on the cap closes what it names');
await reopen(p);
await clickAt(p, '#close', -20, 0);
say(!(await shown(p)), 'a press 20 px to the left of its middle, off the cap but in the target, closes too');
await reopen(p);
await clickAt(p, '#close', 0, 20);
say(!(await shown(p)), 'and 20 px below its middle');
await reopen(p);
await clickAt(p, '#close', -20, -20);
say(!(await shown(p)), 'and at the corner of the target, 20 px left and 20 px up');
await reopen(p);
await clickAt(p, '#close', -26, 0);
say(await shown(p), 'a press 26 px from its middle, past the target, does nothing');
// the cap goes down under a press that is off the cap
let [x, y] = await mid(p, '#close');
await p.mouse.move(x - 19, y + 19, { steps: 6 });
await p.mouse.down();
await p.waitForTimeout(160);
const tz = await p.evaluate(() => { const l = window.vx.live(document.getElementById('close')); return [+l.model.byName.cap.tz.toFixed(2), l.look.travel]; });
say(Math.abs(tz[0] - (0.5 - tz[1])) < 0.15, `held at the edge of its target, the cap still goes down (${tz[0]})`);
await p.mouse.move(x - 19, y + 150, { steps: 6 });
await p.mouse.up();
await p.waitForTimeout(500);
say(await shown(p) && await p.evaluate(() => window.vx.live(document.getElementById('close')).model.byName.cap.tz) === 0, 'dragged off before letting go, nothing closes and the cap comes up');

// two targets that lie side by side do not lie on each other
const rows = await p.evaluate(() => [...document.querySelectorAll('.files .vx-close')].map((b) => { const r = b.getBoundingClientRect(); return [r.top - 8, r.bottom + 8]; }));
say(rows[0][1] <= rows[1][0], `in the list the two targets do not overlap (${rows[0][1]} then ${rows[1][0]})`);
await clickAt(p, '.files li:nth-child(2) .vx-close', 0, -19);
say(await p.evaluate(() => [...document.querySelectorAll('.files .file')].map((f) => f.textContent).join()) === 'build-214.log', 'a press at the top edge of the second one\'s target removes the second file, not the first');

// ---- the keyboard
await p.focus('#close');
await p.keyboard.press('Shift+Tab'); await p.keyboard.press('Tab'); // arrive by the keyboard
const ring = await p.evaluate(() => { const c = getComputedStyle(document.activeElement); return document.activeElement.matches(':focus-visible') && c.outlineStyle === 'solid' && parseFloat(c.outlineWidth) >= 2; });
say(ring, 'focus from the keyboard shows a ring');
await p.keyboard.press('Enter');
say(!(await shown(p)), 'Enter closes');
await reopen(p);
await p.focus('#close');
await p.keyboard.press('Space');
say(!(await shown(p)), 'Space closes');
await reopen(p);

// off
const dis = '.vx-close[disabled]';
say(await p.evaluate((s) => { const l = window.vx.live(document.querySelector(s)); return l.state.off && !l.model.byName.light; }, dis), 'off, it is low and has no light');
await p.mouse.move(4, 4);
await p.waitForTimeout(900);
say(await p.evaluate(() => window.vx.stage.awake.size) === 0, 'at rest nothing runs');
const nudge = await p.evaluate(() => [...document.querySelectorAll('.vx-close')].filter((e) => { const r = document.createRange(); r.selectNodeContents(e.querySelector('.vx-label')); const q = r.getBoundingClientRect(); return Math.abs(q.left - Math.round(q.left)) > 0.02 || Math.abs(q.top + scrollY - Math.round(q.top + scrollY)) > 0.02; }).length);
say(nudge === 0, `every cross starts on a whole pixel (${nudge} do not)`);
await p.context().close();

// ---- plain: the same key, painted; and the sign in the middle of it
{
  const q = await open({ plain: true });
  say(await q.locator('[data-vx-live]').count() === 0, 'plain: nothing is drawn in voxels');
  const s = await sign(q, '#s-rest');
  // (plain, a page's own spacing may leave the key on a fraction of a pixel, which blurs one row: a pixel is allowed)
  say(s.every((c) => c === 8 || c === 9), `plain: the cross is three voxels across, in the middle of the cap (clear ${s.join(', ')} px on the left, above, on the right, below; 8 is the middle)`);
  await clickAt(q, '#close', 20, 20);
  say(!(await shown(q)), 'plain: a press at the lower right corner of the target closes, though the painted key moves away from it');
  await q.context().close();
}
// ---- on a phone
{
  const q = await open({ width: 390 });
  const r = await q.evaluate(() => { const b = document.getElementById('close').getBoundingClientRect(); return [Math.round(b.right) + 8, innerWidth, document.documentElement.scrollWidth]; });
  say(r[0] <= r[1] && r[2] <= r[1], `at 390 px its whole target is on the page (it ends at ${r[0]} of ${r[1]})`);
  await q.context().close();
}

say(errors.length === 0, 'no errors' + (errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''));
await browser.close();
process.exit(bad ? 1 : 0);
