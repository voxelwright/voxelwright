// A person reading an article: the lines are a comfortable length, the headings are real ones in
// order, a long word and a long address wrap, and the links are reached with Tab and followed
// with Enter. Also holds the quote's groove to where the quote's rule is. In voxels and plain, on
// a laptop and on a phone. Says ok or FAIL for each thing that must hold.
//   PORT=5989 node tools/parts/prose.mjs
import { chromium } from 'playwright';

const port = process.env.PORT || 5989;
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
let bad = 0;
const say = (ok, what) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); };

for (const mode of ['voxels', 'plain']) for (const w of [1280, 390]) {
  const tag = `${mode} ${w}:`;
  const p = await (await browser.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: 1 })).newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  if (mode === 'plain') await p.addInitScript(() => { new MutationObserver((_, o) => { if (document.documentElement) { document.documentElement.setAttribute('data-vx-plain', ''); o.disconnect(); } }).observe(document, { childList: true }); });
  await p.goto(`http://127.0.0.1:${port}/showcase/parts/prose.html?theme=light`);
  await p.waitForFunction(() => document.documentElement.dataset.ready === '1');
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(600);

  const m = await p.evaluate(() => {
    const post = document.querySelector('#post');
    // characters on each full line of the post's paragraphs (a paragraph's last line is left out)
    const full = [];
    for (const para of post.querySelectorAll(':scope > p')) {
      if (para.querySelector('small')) continue;
      const lines = new Map(), r = document.createRange(), tw = document.createTreeWalker(para, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = tw.nextNode())) for (let i = 0; i < n.length; i++) { r.setStart(n, i); r.setEnd(n, i + 1); const b = r.getBoundingClientRect(); if (b.width) { const k = Math.round(b.top); lines.set(k, (lines.get(k) || 0) + 1); } }
      full.push(...[...lines.values()].slice(0, -1));
    }
    const body = getComputedStyle(post.querySelector('p'));
    const heads = [...document.querySelectorAll('.vx-prose :is(h1, h2, h3, h4, h5, h6)')].map((h) => [h.tagName, parseFloat(getComputedStyle(h).fontSize)]);
    const sizes = Object.fromEntries(heads.map(([t, s]) => [t, s]));
    // every block of the article starts a whole number of voxels below the article's top
    const top = post.getBoundingClientRect().top;
    const grid = [...post.children].map((c) => (c.getBoundingClientRect().top - top) % 4).filter((v) => Math.abs(v) > 0.01 && Math.abs(v - 4) > 0.01).length;
    const wide = [...document.querySelectorAll('.sheet *')].filter((e) => !e.classList.contains('vx-canvas') && e.getBoundingClientRect().right > innerWidth + 0.5).length;
    const inside = [...document.querySelectorAll('.vx-prose *')].filter((e) => !e.classList.contains('vx-canvas') && e.getBoundingClientRect().right > e.closest('.vx-prose').getBoundingClientRect().right + 0.5).length;
    scrollTo(300, 0); const moved = scrollX; scrollTo(0, 0);
    return { full, face: body.fontFamily.split(',')[0], size: parseFloat(body.fontSize), lead: parseFloat(body.lineHeight), tags: [...new Set(heads.map((h) => h[0]))].sort().join(' '), sizes, grid, wide, inside, moved };
  });
  const mean = m.full.reduce((a, b) => a + b, 0) / (m.full.length || 1);
  if (w === 1280) say(m.full.length > 0 && mean >= 58 && mean <= 72 && Math.max(...m.full) <= 78, `${tag} a full line of the post holds ${mean.toFixed(0)} characters on average (${Math.min(...m.full)} to ${Math.max(...m.full)}): between 60 and 70 is comfortable`);
  else say(m.full.length > 0 && mean >= 30, `${tag} on a phone a full line holds ${mean.toFixed(0)} characters on average (${Math.min(...m.full)} to ${Math.max(...m.full)})`);
  say(/IBM Plex Sans/.test(m.face) && m.size >= 16 && m.lead / m.size >= 1.5 && m.lead % 4 === 0, `${tag} the words are the text face at ${m.size} px on ${m.lead} px lines (${(m.lead / m.size).toFixed(2)}), a whole number of voxels`);
  say(m.tags === 'H2 H3 H4' && m.sizes.H2 > m.sizes.H3 && m.sizes.H3 > m.sizes.H4 && m.sizes.H4 >= m.size, `${tag} the headings are real h2, h3 and h4, each smaller than the last (${m.sizes.H2}, ${m.sizes.H3}, ${m.sizes.H4} px)`);
  say(m.grid === 0, `${tag} every block of the post starts on a whole voxel (${m.grid} do not)`);
  say(m.moved === 0 && m.wide === 0 && m.inside === 0, `${tag} the long word and the long address wrap: nothing is wider than the article or the window (${m.inside}, ${m.wide}), and the page does not move sideways`);

  // the quote's rule
  const rule = await p.evaluate((voxels) => [...document.querySelectorAll('.vx-prose blockquote')].map((q) => {
    const s = getComputedStyle(q), clear = s.borderLeftColor.endsWith(', 0)') || s.borderLeftColor === 'transparent';
    if (!voxels) return { ok: parseFloat(s.borderLeftWidth) === 4 && !clear };
    const l = window.vx.live(q);
    return { ok: !!l && !!l.well && l.well[0] === 0 && l.well[2] === 1 && l.well[1] === 0 && l.well[3] === l.H && clear && q.offsetHeight % 4 === 0, tall: q.offsetHeight };
  }), mode === 'voxels');
  say(rule.length === 2 && rule.every((r) => r.ok), mode === 'voxels' ? `${tag} each quote's rule is a groove one voxel wide and as tall as the quote (${rule.map((r) => r.tall).join(', ')} px), and the painted rule is cleared` : `${tag} with no voxels each quote's rule is its own border, one voxel wide`);

  // Tab goes through the links in the order they are read; the one in focus has a ring
  await p.evaluate(() => { document.activeElement?.blur(); scrollTo(0, 0); });
  const order = [];
  let ring = true;
  for (let i = 0; i < 6; i++) {
    await p.keyboard.press('Tab');
    const at = await p.evaluate(() => { const a = document.activeElement; if (!a || a.tagName !== 'A') return null; const s = getComputedStyle(a); return { text: a.textContent.slice(0, 24), ring: s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2 }; });
    if (!at) break;
    order.push(at.text); if (!at.ring) ring = false;
  }
  const want = await p.evaluate(() => [...document.querySelectorAll('.vx-prose a')].map((a) => a.textContent.slice(0, 24)));
  say(order.length === want.length && order.every((t, i) => t === want[i]), `${tag} Tab stops on each of the ${want.length} links, in the order they are read`);
  say(ring, `${tag} and each has a ring while it is in focus`);

  // Enter follows a link; so does a real click
  await p.evaluate(() => { history.replaceState(null, '', location.pathname + location.search); document.activeElement?.blur(); scrollTo(0, 0); });
  await p.keyboard.press('Tab');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(150);
  say(await p.evaluate(() => location.hash) === '#post', `${tag} Enter on a link follows it`);
  await p.evaluate(() => { history.replaceState(null, '', location.pathname + location.search); });
  const link = p.locator('#all a').first();
  await link.scrollIntoViewIfNeeded();
  // a link may run over two lines: aim at the first of its pieces
  const box = await link.evaluate((a) => { const r = a.getClientRects()[0]; return { x: r.left, y: r.top, width: r.width, height: r.height }; });
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 });
  const hover = await p.evaluate(() => { const a = document.querySelector('#all a'); const s = getComputedStyle(a); return { line: s.textDecorationLine, thick: s.textDecorationThickness, hand: s.cursor }; });
  await p.mouse.down(); await p.mouse.up();
  await p.waitForTimeout(150);
  say(await p.evaluate(() => location.hash) === '#all', `${tag} a real click on a link follows it`);
  say(hover.line.includes('underline') && hover.thick === '2px' && hover.hand === 'pointer', `${tag} a link is underlined, and under the pointer its line is thicker (${hover.thick})`);

  say(errors.length === 0, `${tag} no errors` + (errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''));
  await p.context().close();
}
await browser.close();
process.exit(bad ? 1 : 0);
