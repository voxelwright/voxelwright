// A notice under a real mouse: a click dismisses it, and it shatters from the point clicked.
// Then the same with no voxels, and with less motion asked for.
//   PORT=5989 node tools/parts/toast.mjs
import { chromium } from 'playwright';

const port = process.env.PORT || 5989;
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
let bad = 0;
const say = (ok, what) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); };
const errors = [];
async function open(opts = {}, plain = false) {
  const p = await (await browser.newContext({ viewport: { width: 1180, height: 900 }, deviceScaleFactor: 1, ...opts })).newPage();
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  if (plain) await p.addInitScript(() => { new MutationObserver((_, o) => { if (document.documentElement) { document.documentElement.setAttribute('data-vx-plain', ''); o.disconnect(); } }).observe(document, { childList: true }); });
  await p.goto(`http://127.0.0.1:${port}/kit/showcase/parts/toast.html?theme=light`);
  await p.waitForFunction(() => document.documentElement.dataset.ready === '1' && window.vx);
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(700);
  return p;
}
const press = async (p, sel) => { const b = await p.locator(sel).first().boundingBox(); await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 }); await p.mouse.down(); await p.waitForTimeout(70); await p.mouse.up(); };
const count = (p) => p.evaluate(() => document.querySelectorAll('.vx-toasts .vx-toast').length);

// ---------------------------------------------------------------- voxels
let p = await open();

// A notice written in the page. Time is stepped by hand for a moment, so that the first frames
// of the break can be looked at: which bricks have let go, and which have not yet.
const first = async (sel, fx) => {
  const b = await p.locator(sel).boundingBox();
  const x = b.x + b.width * fx, y = b.y + b.height / 2;
  await p.mouse.move(x, y, { steps: 6 });
  await p.waitForTimeout(200);
  await p.evaluate(() => { window.vx.stage.manual = true; });
  await p.mouse.down(); await p.mouse.up();
  const seen = await p.evaluate(([sel, px, py]) => {
    const el = document.querySelector(sel), l = window.vx.live(el), st = window.vx.stage;
    const r = el.getBoundingClientRect(), cx = (px - r.left) / l.vx, cy = (py - r.top) / l.vx;
    const leaving = el.hasAttribute('data-vx-leaving'), kinds = l.model.parts.map((q) => q.fx?.kind ?? null);
    for (let i = 0; i < 3; i++) st.advance(1 / 60); // three frames: 50 ms
    // how far each cube of the slab has gone from its place, by its distance from the click
    const body = l.model.byName.body;
    let o = 0; for (const q of l.model.parts) { if (q === body) break; if (!q.hidden && q.count) o += q.count * 8; }
    let near = 0, far = 0, nearN = 0, farN = 0;
    const reach = Math.hypot(l.W, l.H);
    for (let i = 0; i < body.count; i++) {
      const rx = body.rest[i * 3], ry = body.rest[i * 3 + 1], rz = body.rest[i * 3 + 2];
      const moved = Math.hypot(l.pos[o + i * 8] - rx - body.tx, l.pos[o + i * 8 + 1] - ry - body.ty, l.pos[o + i * 8 + 2] - rz - body.tz);
      const d = Math.hypot(rx - cx, ry - cy);
      if (d < 4) { near = Math.max(near, moved); nearN++; } else if (d > reach * 0.6) { far = Math.max(far, moved); farN++; }
    }
    st.manual = false; st.schedule();
    return { leaving, kinds, near, far, nearN, farN, at: [cx, cy], W: l.W };
  }, [sel, x, y]);
  return seen;
};
const done = '#notes .vx-toast[data-vx-kind="done"]', failed = '#notes .vx-toast[data-vx-kind="failed"]';
let s = await first(failed, 0.12);
say(s.leaving && s.kinds.every((k) => k === 'crumble'), 'a click on a notice: it begins to break on that click');
say(s.nearN > 0 && s.farN > 0 && s.near > 0.3 && s.far === 0, `clicked near its left end (voxel ${s.at[0].toFixed(0)} of ${s.W}): after 50 ms the cubes under the click have moved ${s.near.toFixed(2)} voxels, those at the far end ${s.far.toFixed(2)}`);
await p.waitForTimeout(600);
say(JSON.stringify(await p.evaluate(() => window.dismissed)) === '["failed"]', 'when nothing of it is left it says vx-dismiss, once');
const gone = await p.evaluate((sel) => { const el = document.querySelector(sel), l = window.vx.live(el); return { there: el.isConnected, hidden: l.model.parts.every((q) => q.hidden), leaving: el.hasAttribute('data-vx-leaving'), words: getComputedStyle(el.querySelector('.vx-toast-text')).opacity }; }, failed);
say(gone.there && gone.hidden && gone.leaving && gone.words === '0', 'a notice the page wrote stays in the page, with nothing drawn and its words gone: it is the page\'s to put back');
await p.mouse.click(...(await p.locator(failed).boundingBox().then((b) => [b.x + 30, b.y + 20]))); await p.waitForTimeout(200);
say((await p.evaluate(() => window.dismissed.length)) === 1, 'a second click on what is already gone does nothing');
await p.waitForTimeout(1300);
const back = await p.evaluate((sel) => { const el = document.querySelector(sel), l = window.vx.live(el); return !el.hasAttribute('data-vx-leaving') && l.model.parts.every((q) => !q.hidden && !q.fx); }, failed);
say(back, 'the page puts it back, and it stands whole again');

// the other end: the break starts there
s = await first(done, 0.9);
say(s.near > 0.3 && s.far === 0, `clicked near its right end (voxel ${s.at[0].toFixed(0)} of ${s.W}): the break starts there (${s.near.toFixed(2)} voxels moved under the click, ${s.far.toFixed(2)} at the left end)`);
await p.waitForTimeout(2200);
// a picture of one in the air: clicked a quarter of the way along, 117 ms in
{
  const b = await p.locator('#notes .vx-toast[data-vx-kind="note"]').boundingBox();
  await p.mouse.move(b.x + b.width * 0.25, b.y + b.height / 2, { steps: 6 }); await p.waitForTimeout(200);
  await p.evaluate(() => { window.vx.stage.manual = true; });
  await p.mouse.down(); await p.mouse.up();
  await p.evaluate(() => { for (let i = 0; i < 7; i++) window.vx.stage.advance(1 / 60); });
  await p.screenshot({ path: 'shots/parts/toast/hand-shatter.png' });
  await p.evaluate(() => { window.vx.stage.manual = false; window.vx.stage.schedule(); });
  await p.waitForTimeout(2200);
}

// one made by toast()
await press(p, '#stay'); await p.waitForTimeout(500);
say(await count(p) === 1, 'toast() shows a notice');
await p.waitForTimeout(1200);
say(await count(p) === 1, 'this one stays (its time is long)');
const nb = await p.locator('.vx-toasts .vx-toast').boundingBox();
await p.mouse.move(nb.x + nb.width * 0.8, nb.y + nb.height / 2, { steps: 6 });
await p.mouse.down(); await p.mouse.up(); await p.waitForTimeout(50);
const mid = await p.evaluate(() => { const el = document.querySelector('.vx-toasts .vx-toast'); return el ? { leaving: el.hasAttribute('data-vx-leaving'), fx: window.vx.live(el)?.model.byName.body.fx?.kind } : null; });
say(mid && mid.leaving && mid.fx === 'crumble', 'a click on it: it breaks');
await p.waitForTimeout(700);
say(await count(p) === 0, 'and it is taken out of the page');

// left alone, a notice still goes by itself
await press(p, '#deploy'); await p.waitForTimeout(400);
await p.mouse.move(600, 300, { steps: 4 });
say(await count(p) === 1, 'Deploy shows a notice');
await p.waitForTimeout(4800);
say(await count(p) === 0, 'left alone, it goes by itself after its time');
await p.close();

// ---------------------------------------------------------------- no voxels
p = await open({}, true);
say(await p.evaluate(() => document.querySelectorAll('[data-vx-live]').length) === 0, 'plain: nothing is drawn in voxels');
await press(p, '#stay'); await p.waitForTimeout(300);
say(await count(p) === 1, 'plain: toast() shows a notice');
await p.locator('.vx-toasts .vx-toast').click(); await p.waitForTimeout(200);
say(await count(p) === 0, 'plain: a click dismisses it');
await p.close();

// ---------------------------------------------------------------- less motion
p = await open({ reducedMotion: 'reduce' });
await press(p, '#stay'); await p.waitForTimeout(500);
await p.locator('.vx-toasts .vx-toast').click(); await p.waitForTimeout(500);
say(await count(p) === 0, 'with less motion asked for: a click still dismisses it (it fades in place)');
await p.locator(done).click(); await p.waitForTimeout(500);
say(JSON.stringify(await p.evaluate(() => window.dismissed)) === '["done"]', 'and a notice written in the page still says vx-dismiss');
await p.close();

say(errors.length === 0, 'no errors' + (errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''));
await browser.close();
process.exit(bad ? 1 : 0);
