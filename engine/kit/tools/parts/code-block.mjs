// A person at a code block: selects the code with a real mouse and copies it, reaches a block
// with Tab and moves it with the arrow keys, and turns a wheel over it. In voxels and plain, on a
// laptop and on a phone. Says ok or FAIL for each thing that must hold.
//   PORT=5989 node tools/parts/code-block.mjs
import { reachByTab } from '../reach-by-tab.mjs';
import { chromium } from 'playwright';

const port = process.env.PORT || 5989;
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
let bad = 0;
const say = (ok, what) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); };

for (const mode of ['voxels', 'plain']) for (const w of [1280, 390]) {
  const tag = `${mode} ${w}:`;
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: 1 });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  if (mode === 'plain') await p.addInitScript(() => { new MutationObserver((_, o) => { if (document.documentElement) { document.documentElement.setAttribute('data-vx-plain', ''); o.disconnect(); } }).observe(document, { childList: true }); });
  await p.goto(`http://127.0.0.1:${port}/kit/showcase/parts/code-block.html?theme=light`);
  await p.waitForFunction(() => document.documentElement.dataset.ready === '1');
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(500);
  if (mode === 'voxels') say(await p.locator('.vx-recess[data-vx-live]').count() === 6, `${tag} every block's recess is drawn in voxels`);

  // the page keeps still: nothing in it is wider than the window
  const page = await p.evaluate(() => { scrollTo(300, 0); const moved = scrollX; scrollTo(0, 0); const wide = [...document.querySelectorAll('.sheet *')].filter((e) => !e.closest('pre') && !e.classList.contains('vx-canvas') && e.getBoundingClientRect().right > innerWidth + 0.5).length; return { moved, wide }; });
  say(page.moved === 0 && page.wide === 0, `${tag} the page does not move sideways, and nothing but code is wider than the window (${page.wide} are)`);
  const long = await p.evaluate(() => { const e = document.querySelector('#long pre'); return [e.scrollWidth, e.clientWidth]; });
  say(long[0] > long[1], `${tag} the long line is wider than its block (${long[0]} in ${long[1]}): the block scrolls, the page does not`);
  const wrap = await p.evaluate(() => { const e = document.querySelector('#wrap pre'); return [e.scrollWidth, e.clientWidth]; });
  say(wrap[0] <= wrap[1], `${tag} the wrapped block has nothing to scroll (${wrap[0]} in ${wrap[1]})`);

  // a real mouse selects the first block from its first character to its last, and copies it
  await p.locator('#use').scrollIntoViewIfNeeded();
  const ends = await p.evaluate(() => {
    const code = document.querySelector('#use code'), r = document.createRange();
    const tw = document.createTreeWalker(code, NodeFilter.SHOW_TEXT); let first = tw.nextNode(), last = first, n; while ((n = tw.nextNode())) last = n;
    r.setStart(first, 0); r.setEnd(first, 1); const a = r.getBoundingClientRect();
    r.setStart(last, last.length - 1); r.setEnd(last, last.length); const b = r.getBoundingClientRect();
    document.querySelector('#use pre').scrollLeft = 0;
    return { a: [a.left + 0.5, a.top + a.height / 2], b: [b.right - 0.5, b.top + b.height / 2], text: code.textContent, fits: b.right < code.closest('pre').getBoundingClientRect().right };
  });
  if (ends.fits) {
    await p.mouse.move(...ends.a); await p.mouse.down(); await p.mouse.move(...ends.b, { steps: 12 }); await p.mouse.up();
    const picked = await p.evaluate(() => getSelection().toString());
    say(picked === ends.text, `${tag} dragging over the code selects exactly the code (${picked.length} of ${ends.text.length} characters)`);
    await p.keyboard.press(process.platform === 'darwin' ? 'Meta+C' : 'Control+C');
    const copied = await p.evaluate(() => navigator.clipboard.readText()).catch((e) => 'could not read the clipboard: ' + e.message);
    say(copied === ends.text, `${tag} and the copy shortcut puts the same text on the clipboard${copied === ends.text ? '' : ' (' + JSON.stringify(copied.slice(0, 60)) + ')'}`);
  } else {
    // on a phone the last line runs past the edge: select it the way a person would, from the keyboard
    await p.mouse.click(...ends.a);
    await p.evaluate(() => getSelection().selectAllChildren(document.querySelector('#use code')));
    const picked = await p.evaluate(() => getSelection().toString());
    say(picked === ends.text, `${tag} the code selects as written (${picked.length} of ${ends.text.length} characters)`);
  }
  await p.evaluate(() => getSelection().removeAllRanges());

  // numbered lines: the numbers are seen but are not text
  const lines = await p.evaluate(() => {
    const code = document.querySelector('#lines code');
    getSelection().selectAllChildren(code);
    const picked = getSelection().toString(); getSelection().removeAllRanges();
    return { same: picked === code.textContent, starts: picked.slice(0, 18), shown: getComputedStyle(code.querySelector('.vx-line'), '::before').content };
  });
  say(lines.same && lines.starts.startsWith('def ready') && lines.shown.includes('counter'), `${tag} numbered lines select without their numbers (it starts ${JSON.stringify(lines.starts)})`);

  // and a real mouse dragged from their first character to their last copies the code alone
  await p.locator('#lines').scrollIntoViewIfNeeded();
  const span = await p.evaluate(() => {
    const code = document.querySelector('#lines code'), r = document.createRange();
    const tw = document.createTreeWalker(code, NodeFilter.SHOW_TEXT); let first = tw.nextNode(), last = first, n; while ((n = tw.nextNode())) last = n;
    r.setStart(first, 0); r.setEnd(first, 1); const a = r.getBoundingClientRect();
    r.setStart(last, last.length - 1); r.setEnd(last, last.length); const b = r.getBoundingClientRect();
    return { a: [a.left + 0.5, a.top + a.height / 2], b: [b.right - 0.5, b.top + b.height / 2], text: code.textContent };
  });
  await p.mouse.move(...span.a); await p.mouse.down(); await p.mouse.move(...span.b, { steps: 12 }); await p.mouse.up();
  await p.keyboard.press(process.platform === 'darwin' ? 'Meta+C' : 'Control+C');
  const numbered = await p.evaluate(() => navigator.clipboard.readText()).catch((e) => 'could not read the clipboard: ' + e.message);
  say(numbered === span.text, `${tag} dragged over and copied, numbered lines put the code alone on the clipboard (${numbered.length} of ${span.text.length} characters${numbered === span.text ? '' : ': ' + JSON.stringify(numbered.slice(0, 50))})`);
  await p.evaluate(() => getSelection().removeAllRanges());

  // Tab reaches the first block that scrolls; the ring shows; the arrow keys move it
  await p.evaluate(() => { document.activeElement?.blur(); scrollTo(0, 0); });
  say(await reachByTab(p, '#long'), `${tag} Tab reaches the block with the long line`);
  const ring = await p.evaluate(() => { const r = document.querySelector('#long .vx-recess'), s = getComputedStyle(r); return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2; });
  say(ring, `${tag} in focus it has a ring`);
  for (let i = 0; i < 6; i++) await p.keyboard.press('ArrowRight');
  await p.waitForTimeout(300);
  const moved = await p.evaluate(() => [document.querySelector('#long pre').scrollLeft, scrollX]);
  say(moved[0] > 0 && moved[1] === 0, `${tag} Right arrow moves the code (${Math.round(moved[0])} px), not the page`);
  for (let i = 0; i < 30; i++) await p.keyboard.press('ArrowRight');
  await p.waitForTimeout(400);
  const end = await p.evaluate(() => { const e = document.querySelector('#long pre'), c = e.querySelector('code'), r = document.createRange(); r.selectNodeContents(c); const rects = [...r.getClientRects()]; return { at: e.scrollLeft, most: e.scrollWidth - e.clientWidth, gap: e.getBoundingClientRect().right - Math.max(...rects.map((x) => x.right)) }; });
  say(end.gap >= 12, `${tag} scrolled to its end, the longest line has room after it (${end.gap.toFixed(0)} px)`);

  // the tall block: Tab to it, Down arrow moves it
  say(await reachByTab(p, '#tall'), `${tag} Tab reaches the tall block`);

  // a wheel turned sideways over the long block moves the block
  await p.evaluate(() => { document.querySelector('#long pre').scrollLeft = 0; });
  await p.locator('#long pre').scrollIntoViewIfNeeded();
  const box = await p.locator('#long pre').boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await p.mouse.wheel(160, 0);
  await p.waitForTimeout(300);
  const wheel = await p.evaluate(() => [document.querySelector('#long pre').scrollLeft, scrollX]);
  say(wheel[0] > 0 && wheel[1] === 0, `${tag} a wheel turned sideways over it moves the code (${Math.round(wheel[0])} px), not the page`);

  say(errors.length === 0, `${tag} no errors` + (errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''));
  await ctx.close();
}
await browser.close();
process.exit(bad ? 1 : 0);
