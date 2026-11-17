// Lettering is text, and a toy. Both have to work, and a gesture must mean one of them.
//   [PORT=5986] node tools/select.mjs
// With real pointer input, in Chromium and WebKit, with voxels and without:
//   text   a drag from the text before a heading to the text after it takes the heading along;
//          a drag, a double click and a triple click on a heading select; Shift-click extends;
//          the highlight of each line lies on that line of voxels (also at 320 px, where a
//          heading wraps); what is copied is the words.
//   play   a click breaks once and selects nothing; a held press brushes for as long as it is
//          held and selects nothing; the sign breaks on the press itself; all of it mends.
//   touch  (Chromium) a tap breaks; a thumb moved sideways brushes and the page stays put;
//          up and down scrolls and breaks nothing; a resting thumb breaks nothing.
//   less motion: nothing breaks, and a drag on a heading selects.
import { chromium, webkit } from 'playwright';
const port = process.env.PORT || 5985;
const url = `http://127.0.0.1:${port}/showcase/`;
let fails = 0;
const say = (ok, what, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? '  ' + detail : ''}`); };
const norm = (s) => s.replace(/\s+/g, ' ').trim().toLowerCase();

const open = async (browser, { w = 1280, plain = false, reduced = false, touch = false } = {}) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: 1, reducedMotion: reduced ? 'reduce' : 'no-preference', hasTouch: touch, permissions: browser.browserType().name() === 'chromium' ? ['clipboard-read', 'clipboard-write'] : [] });
  const page = await ctx.newPage();
  if (plain) await page.addInitScript(() => { new MutationObserver((_, o) => { if (document.documentElement) { document.documentElement.setAttribute('data-vx-plain', ''); o.disconnect(); } }).observe(document, { childList: true }); });
  await page.addInitScript(() => { window.__pokes = 0; addEventListener('vx-poke', () => window.__pokes++); });
  await page.goto(url);
  await page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 12000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  return page;
};
// where things are, after bringing the heading to the middle of the screen
const place = (page, sel) => page.evaluate((sel) => {
  const h = document.querySelector(sel);
  h.scrollIntoView({ block: 'center' });
  const box = (e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
  const all = [...document.querySelectorAll('main p, main figcaption, header p')].filter((e) => e.offsetParent);
  const before = all.filter((e) => e.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_FOLLOWING).pop();
  const after = all.find((e) => h.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING && !h.contains(e));
  return { h: box(h), before: before && box(before), after: after && box(after), text: h.textContent.trim() };
}, sel);
const state = (page, sel) => page.evaluate((sel) => {
  const h = document.querySelector(sel), l = window.vx?.live?.(h);
  const fx = l?.model?.byName?.letters?.fx;
  return { pokes: window.__pokes, sel: String(getSelection()), busy: Boolean(fx), brush: Boolean(fx?.brush), y: scrollY };
}, sel);
const clear = (page) => page.evaluate(() => { getSelection().removeAllRanges(); window.__pokes = 0; });
const settle = async (page, sel) => { for (let i = 0; i < 40; i++) { if (!(await state(page, sel)).busy) return true; await page.waitForTimeout(100); } return false; };

for (const [name, kind, args] of [['chromium', chromium, ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu']], ['webkit', webkit, []]]) {
  let browser;
  try { browser = await kind.launch({ args }); } catch { console.log(`${name}: not installed, skipped`); continue; }
  for (const plain of [false, true]) {
    const mode = `${name} ${plain ? 'plain' : 'voxels'}`;
    const page = await open(browser, { plain });
    const H = '#kit-h';

    // ---- text
    let p = await place(page, H);
    await page.mouse.move(p.before.x + 20, p.before.y + p.before.h - 8);
    await page.mouse.down();
    await page.mouse.move(p.h.x + 30, p.h.y + p.h.h / 2, { steps: 6 });
    await page.mouse.move(p.after.x + 160, p.after.y + 10, { steps: 6 });
    await page.mouse.up();
    let s = await state(page, H);
    const through = norm(s.sel);
    say(through.includes(norm(p.text)) && through.indexOf(norm(p.text)) > 0 && through.length > norm(p.text).length + 10 && s.pokes === 0, `${mode}: a drag from the text before a heading to the text after takes the heading along`, JSON.stringify(s.sel.replace(/\s+/g, ' ').slice(0, 90)));
    if (name === 'chromium') {
      await page.keyboard.press('ControlOrMeta+c');
      const copied = await page.evaluate(() => navigator.clipboard.readText());
      say(norm(copied).includes(norm(p.text)), `${mode}: the heading is in what was copied`, JSON.stringify(copied.replace(/\s+/g, ' ').slice(0, 90)));
    }

    await clear(page);
    await page.mouse.move(p.h.x + 3, p.h.y + p.h.h / 2);
    await page.mouse.down();
    await page.mouse.move(p.h.x + p.h.w + 6, p.h.y + p.h.h / 2, { steps: 5 });
    await page.mouse.up();
    s = await state(page, H);
    say(norm(s.sel) === norm(p.text) && s.pokes === 0, `${mode}: a drag along a heading selects it and breaks nothing`, JSON.stringify(s.sel));

    await clear(page);
    await page.mouse.dblclick(p.h.x + 20, p.h.y + p.h.h / 2);
    s = await state(page, H);
    say(norm(s.sel) === norm(p.text).split(' ')[0], `${mode}: a double click selects a word`, JSON.stringify(s.sel));
    await settle(page, H);
    await clear(page);
    await page.mouse.click(p.h.x + 20, p.h.y + p.h.h / 2, { clickCount: 3 });
    s = await state(page, H);
    say(norm(s.sel) === norm(p.text), `${mode}: a triple click selects the heading`, JSON.stringify(s.sel));
    await settle(page, H);

    await clear(page);
    await page.mouse.click(p.before.x + 20, p.before.y + p.before.h - 8);
    await page.keyboard.down('Shift');
    await page.mouse.click(p.h.x + p.h.w + 2, p.h.y + p.h.h / 2);
    await page.keyboard.up('Shift');
    s = await state(page, H);
    say(norm(s.sel).endsWith(norm(p.text)) && s.pokes === 0, `${mode}: Shift-click extends a selection over the heading and breaks nothing`, JSON.stringify(s.sel.replace(/\s+/g, ' ').slice(-40)));

    // ---- the highlight lies on the voxels (a heading of several lines too)
    if (!plain) {
      for (const [w, sel] of [[1280, '#growth-h'], [320, '#growth-h'], [320, '.top .vx-sign'], [1280, '.top .vx-sign']]) {
        const q = w === 1280 ? page : await open(browser, { w });
        const got = await q.evaluate((sel) => {
          const h = document.querySelector(sel), l = window.vx.live(h), f = l.state.fit, vx = l.vx;
          const text = h.querySelector('.vx-lettering-text');
          const range = document.createRange(); range.selectNodeContents(text);
          const r = h.getBoundingClientRect();
          // one box per line of text
          const lines = [];
          for (const c of range.getClientRects()) { const at = lines.find((b) => Math.abs(b.top - c.top) < 2); if (at) { at.left = Math.min(at.left, c.left); at.right = Math.max(at.right, c.right); } else lines.push({ top: c.top, bottom: c.bottom, left: c.left, right: c.right }); }
          const W = Math.floor(h.offsetWidth / vx + 0.01), H = Math.floor(h.offsetHeight / vx + 0.01);
          const bw = f.width * f.scale + (f.bare ? 0 : f.margin * 2 * f.scale + 2), bh = (f.rows + f.over + f.under) * f.scale + (f.bare ? 0 : f.margin * 2 * f.scale + 2);
          let y = Math.round((H - bh) / 2) + (f.bare ? 0 : f.margin * f.scale + 1) + f.over * f.scale;
          const want = f.laid.map((line, i) => { const x0 = f.bare ? 0 : Math.round((W - line.width * f.scale) / 2); const out = { left: r.left + x0 * vx, right: r.left + (x0 + line.width * f.scale) * vx, top: r.top + y * vx, bottom: r.top + (y + f.font.cap * f.scale) * vx }; y += (f.font.cap + (f.gaps[i] ?? f.font.lineGap)) * f.scale; return out; });
          return { lines, want, words: f.lines, gap: f.font.gap * f.scale * vx, vx, bw };
        }, sel);
        // each line starts where its voxels start, ends within one glyph gap of where they end, and covers them top to bottom
        const off = got.lines.length !== got.want.length ? ['lines ' + got.lines.length + ' for ' + got.want.length] : got.want.map((v, i) => { const t = got.lines[i]; return Math.abs(t.left - v.left) > 1.5 || t.right < v.right - 1.5 || t.right > v.right + got.gap + 1.5 || t.top > v.top + 1.5 || t.bottom < v.bottom - 1.5 ? `line ${i + 1}: text ${Math.round(t.left)}-${Math.round(t.right)} x ${Math.round(t.top)}-${Math.round(t.bottom)}, voxels ${Math.round(v.left)}-${Math.round(v.right)} x ${Math.round(v.top)}-${Math.round(v.bottom)}` : ''; }).filter(Boolean);
        say(off.length === 0, `${mode}: at ${w} px the text of ${sel} lies on its ${got.want.length} line${got.want.length === 1 ? '' : 's'} of voxels`, off.join('; '));
        if (q !== page) await q.context().close();
      }
    }

    // ---- play (only with voxels)
    if (!plain) {
      p = await place(page, H);
      await clear(page);
      await page.mouse.click(p.h.x + 30, p.h.y + p.h.h / 2);
      s = await state(page, H);
      say(s.pokes === 1 && s.sel === '' && s.busy, `${mode}: a click on a heading breaks once and selects nothing`, JSON.stringify(s));
      say(await settle(page, H), `${mode}: and it mends`);

      await clear(page);
      await page.mouse.move(p.h.x + 20, p.h.y + p.h.h / 2);
      await page.mouse.down();
      await page.waitForTimeout(320);
      const held = await state(page, H);
      await page.mouse.move(p.h.x + p.h.w - 10, p.h.y + p.h.h / 2, { steps: 12 });
      await page.waitForTimeout(1500);
      const still = await state(page, H);
      await page.mouse.up();
      const after = await state(page, H);
      say(held.brush && held.pokes === 1 && still.brush && still.busy && still.sel === '' && still.pokes === 1 && !after.brush, `${mode}: a held press brushes for as long as it is held, and selects nothing`, JSON.stringify({ held, still }));
      say(await settle(page, H), `${mode}: and it mends`);
      // the page can select again afterwards
      await page.mouse.dblclick(p.h.x + 20, p.h.y + p.h.h / 2);
      say(norm((await state(page, H)).sel) === norm(p.text).split(' ')[0], `${mode}: and text can be selected again after a brush`);
      await settle(page, H);

      const S = '.top .vx-sign';
      p = await place(page, S);
      await clear(page);
      await page.mouse.move(p.h.x + p.h.w * 0.3, p.h.y + p.h.h / 2);
      await page.mouse.down();
      const down = await state(page, S);
      await page.mouse.move(p.h.x + p.h.w * 0.8, p.h.y + p.h.h / 2, { steps: 8 });
      const moved = await state(page, S);
      await page.mouse.up();
      say(down.pokes === 1 && down.brush && moved.sel === '' && moved.brush, `${mode}: the sign breaks on the press itself, brushes at once, and a drag on it selects nothing`, JSON.stringify({ down, moved }));
      say(await settle(page, S), `${mode}: and it mends`);
    }
    await page.context().close();

    // ---- less motion: plain text to every gesture
    if (!plain) {
      const q = await open(browser, { reduced: true });
      const p2 = await place(q, H);
      await q.mouse.click(p2.h.x + 30, p2.h.y + p2.h.h / 2);
      await q.mouse.move(p2.h.x + 3, p2.h.y + p2.h.h / 2);
      await q.mouse.down();
      await q.waitForTimeout(350);
      await q.mouse.move(p2.h.x + p2.h.w + 6, p2.h.y + p2.h.h / 2, { steps: 5 });
      await q.mouse.up();
      const s2 = await state(q, H);
      say(s2.pokes === 0 && !s2.busy && norm(s2.sel) === norm(p2.text), `${mode}, less motion: nothing breaks, and a held drag on a heading selects`, JSON.stringify(s2));
      await q.context().close();
    }
  }

  // ---- touch, through the browser's own gesture handling (Chromium only: WebKit has no such input here)
  if (name === 'chromium') {
    const page = await open(browser, { w: 390, touch: true });
    const cdp = await page.context().newCDPSession(page);
    const touch = async (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
    const swipe = async (x0, y0, x1, y1, hold = 0) => { await touch('touchStart', x0, y0); if (hold) await page.waitForTimeout(hold); for (let i = 1; i <= 10; i++) { await touch('touchMove', x0 + (x1 - x0) * i / 10, y0 + (y1 - y0) * i / 10); await page.waitForTimeout(16); } };
    const H = '#kit-h';
    let p = await place(page, H);
    const cx = p.h.x + 30, cy = p.h.y + p.h.h / 2;

    await clear(page);
    await touch('touchStart', cx, cy); await page.waitForTimeout(60); await touch('touchEnd');
    await page.waitForTimeout(80);
    let s = await state(page, H);
    say(s.pokes === 1 && s.busy, 'chromium touch: a tap breaks', JSON.stringify(s));
    await settle(page, H);

    await clear(page);
    const y0 = (await state(page, H)).y;
    await swipe(cx, cy, cx + 6, cy - 220); await touch('touchEnd');
    await page.waitForTimeout(300);
    s = await state(page, H);
    say(s.pokes === 0 && !s.busy && Math.abs(s.y - y0) > 100, 'chromium touch: a thumb moved up from a heading scrolls the page and breaks nothing', JSON.stringify({ scrolled: s.y - y0, pokes: s.pokes }));

    await page.waitForTimeout(700); // let the last scroll come to rest
    p = await place(page, H);
    await page.waitForTimeout(200);
    p = await place(page, H);
    await clear(page);
    const y1 = (await state(page, H)).y;
    await swipe(p.h.x + 10, p.h.y + p.h.h / 2, p.h.x + p.h.w - 6, p.h.y + p.h.h / 2 + 4);
    const mid = await state(page, H);
    await page.waitForTimeout(900);
    const kept = await state(page, H);
    await touch('touchEnd');
    await page.waitForTimeout(60);
    const done = await state(page, H);
    say(mid.brush && mid.pokes === 1 && kept.brush && kept.busy && !done.brush && Math.abs(done.y - y1) < 2 && done.sel === '', 'chromium touch: a thumb moved sideways brushes while it is down, and the page stays put', JSON.stringify({ mid, kept, moved: done.y - y1 }));
    say(await settle(page, H), 'chromium touch: and it mends');

    p = await place(page, H);
    await clear(page);
    await touch('touchStart', p.h.x + 30, p.h.y + p.h.h / 2); await page.waitForTimeout(800); await touch('touchEnd');
    await page.waitForTimeout(80);
    s = await state(page, H);
    say(s.pokes === 0 && !s.busy, 'chromium touch: a resting thumb breaks nothing (it is the device\'s gesture for selecting)', JSON.stringify(s));
    await page.context().close();
  }
  await browser.close();
}
console.log(fails ? `${fails} FAILED` : 'all pass');
process.exit(fails ? 1 : 0);
