// A person with three files in the composer: a real mouse and real keys. A file says its name and
// size in words; its key is named for what it removes; removed, it shatters from the point
// pressed, and focus lands on the next file, or on the key that attaches one. Says ok or FAIL for
// each thing that must hold; exit 1 on a failure.
//   PORT=5989 node tools/parts/attachment.mjs
import { chromium } from 'playwright';

const port = process.env.PORT || 5989;
const url = `http://127.0.0.1:${port}/showcase/parts/attachment.html`;
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
let bad = 0;
const say = (ok, what) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); };
const errors = [];

async function open({ plain = false, still = false, width = 1180 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 1000 }, deviceScaleFactor: 1, reducedMotion: still ? 'reduce' : 'no-preference' });
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
const key = (name) => `#waiting .vx-close[aria-label="Remove ${name}"]`;
const press = async (p, sel, fx = 0.5) => { const b = await p.locator(sel).first().boundingBox(); await p.mouse.move(b.x + b.width * fx, b.y + b.height / 2, { steps: 6 }); await p.mouse.down(); await p.waitForTimeout(80); await p.mouse.up(); };
const files = (p) => p.evaluate(() => [...document.querySelectorAll('#waiting .vx-attachment:not([data-vx-leaving])')].map((a) => a.querySelector('.vx-attachment-name').textContent));
const focused = (p) => p.evaluate(() => { const a = document.activeElement; return a.getAttribute('aria-label') || a.id || a.textContent.trim() || a.tagName; });
const said = (p) => p.evaluate(() => document.getElementById('said').textContent);

async function behaves(p, tag, live) {
  // ---- what it is
  const items = await p.evaluate(() => [...document.querySelectorAll('.vx-attachment')].map((a) => ({ words: a.querySelector('.vx-attachment-tile').textContent.replace(/\s+/g, ' ').trim(), key: a.querySelector('.vx-close')?.getAttribute('aria-label') ?? null, name: a.querySelector('.vx-attachment-name').textContent, li: a.tagName })));
  say(items.every((i) => i.li === 'LI' && /\d+(\.\d+)? ?(KB|MB|КБ|%)/.test(i.words)), `${tag}each file is an item of a list, its name and size in words ("${items[0].words}")`);
  say(items.filter((i) => i.key).every((i) => i.key.endsWith(i.name)), `${tag}each remove key is named for what it removes ("${items[0].key}")`);
  const sent = await p.evaluate(() => ({ keys: document.querySelectorAll('#sent .vx-close').length, links: document.querySelectorAll('#sent a.vx-attachment-name[href]').length }));
  say(sent.keys === 0 && sent.links === 2, `${tag}on a message that was sent: no remove keys, and the names are links`);

  // ---- the mouse: the middle file goes, from where it was pressed
  if (live) await p.evaluate(() => { window.vx.stage.manual = true; });
  await press(p, key('timings.csv'), 0.3);
  if (live) {
    const s = await p.evaluate(() => {
      const item = document.querySelector('#waiting .vx-attachment:nth-child(2)'), tile = window.vx.live(item.querySelector('.vx-attachment-tile')), k = window.vx.live(item.querySelector('.vx-close'));
      const kinds = [tile, k].flatMap((l) => l.model.parts.map((q) => q.fx?.kind ?? null));
      const st = window.vx.stage; st.manual = false; st.schedule();
      return { leaving: item.hasAttribute('data-vx-leaving'), kinds };
    });
    say(s.leaving && s.kinds.length && s.kinds.every((k) => k === 'crumble'), `the press on its key: the tile and the key both shatter (${[...new Set(s.kinds)].join(', ')})`);
  }
  say(await focused(p) === 'Remove health-check.png', `${tag}focus goes at once to the next file's key (${await focused(p)})`);
  await p.waitForTimeout(800);
  say(JSON.stringify(await files(p)) === '["build-214.log","health-check.png"]', `${tag}and when nothing of it is left it is out of the page (${(await files(p)).join(', ')})`);
  say((await said(p)).startsWith('Removed timings.csv.'), `${tag}the page hears vx-removed: "${await said(p)}"`);
  if (live) say(await p.evaluate(() => [...window.vx.stage.lives.keys()].every((el) => el.isConnected)), 'what was drawn in it is given back to the stage');

  // ---- the keys: Delete on a key removes its file; the last file's key, then Enter
  await p.focus(key('build-214.log'));
  await p.keyboard.press('Delete');
  say(await focused(p) === 'Remove health-check.png', `${tag}Delete on a remove key removes its file; focus moves to the next (${await focused(p)})`);
  await p.waitForTimeout(800);
  await p.keyboard.press('Enter');
  say(await focused(p) === 'attach', `${tag}Enter on the last one removes it; with none left, focus is on the key that attaches a file (${await focused(p)})`);
  await p.waitForTimeout(800);
  say((await files(p)).length === 0, `${tag}nothing is attached`);
  // the key that attaches puts them back, and they work again
  await p.keyboard.press('Enter');
  await p.waitForTimeout(500);
  say((await files(p)).length === 3, `${tag}Attach a file puts the three back`);
  await p.focus(key('health-check.png'));
  await p.keyboard.press('Backspace');
  say(await focused(p) === 'Remove timings.csv', `${tag}Backspace on the last file's key removes it; focus goes to the one before (${await focused(p)})`);
  await p.waitForTimeout(800);
  // other keys do nothing
  await p.keyboard.press('a');
  await p.keyboard.press('Alt+Delete');
  await p.keyboard.press('Control+Backspace');
  say((await files(p)).length === 2, `${tag}other keys, and Delete with a modifier, remove nothing`);

  // ---- the page may say no
  await press(p, '#kept .vx-close');
  await p.waitForTimeout(700);
  const kept = await p.evaluate(() => ({ there: !!document.querySelector('#kept .vx-attachment:not([data-vx-leaving])') }));
  say(kept.there && (await said(p)).includes('contract.pdf has to go'), `${tag}a file the page keeps (vx-remove with preventDefault) stays whole: "${await said(p)}"`);
  // a press on the tile, not its key, removes nothing
  await press(p, '#waiting .vx-attachment-tile');
  await p.waitForTimeout(300);
  say((await files(p)).length === 2, `${tag}a press on the tile itself removes nothing`);
}

// ---------------------------------------------------------------- voxels
const p = await open();
await behaves(p, '', true);
await p.mouse.move(4, 4);
await p.waitForTimeout(1200);
say(await p.evaluate(() => window.vx.stage.awake.size) === 0, 'at rest nothing runs');
await p.context().close();

// ---------------------------------------------------------------- reduced motion: it goes at once
{
  const q = await open({ still: true });
  await press(q, key('timings.csv'));
  await q.waitForTimeout(350);
  const left = await q.evaluate(() => document.querySelectorAll('#waiting .vx-attachment').length);
  say(left === 2, `reduced motion: removed, it fades where it is and is out of the page within 350 ms (${left} left)`);
  await q.context().close();
}

// ---------------------------------------------------------------- plain
{
  const q = await open({ plain: true });
  say(await q.locator('[data-vx-live]').count() === 0, 'plain: nothing is drawn in voxels');
  await behaves(q, 'plain: ', false);
  await q.context().close();
}

// ---------------------------------------------------------------- on a phone
for (const plain of [false, true]) {
  const q = await open({ width: 390, plain });
  const m = await q.evaluate(() => {
    scrollTo(200, 0); const moved = scrollX; scrollTo(0, 0);
    const sheet = document.querySelector('.sheet').getBoundingClientRect();
    const out = [...document.querySelectorAll('.vx-attachment, .vx-attachment *')].filter((e) => !e.closest('.vx-canvas')).filter((e) => { const r = e.getBoundingClientRect(); return r.width && (r.left < sheet.left || r.right > sheet.right); }).length;
    const cut = document.querySelector('#longs .vx-attachment-name'), k = document.querySelector('#longs .vx-close'), keyBox = k.getBoundingClientRect(), after = getComputedStyle(k, '::after'), reach = { left: parseFloat(after.left), top: parseFloat(after.top) };
    return { moved, out, ellipsis: cut.scrollWidth > cut.clientWidth && getComputedStyle(cut).textOverflow === 'ellipsis' && !!cut.title, keyW: keyBox.width - 2 * reach.left, keyH: keyBox.height - 2 * reach.top }; // its target is its ::after, which reaches past its cap
  });
  say(m.moved === 0 && m.out === 0, `at 390 px${plain ? ', plain' : ''}: nothing scrolls sideways (${m.moved} px) and nothing is outside the sheet (${m.out})`);
  say(m.ellipsis && m.keyW >= 44 && m.keyH >= 44, `at 390 px${plain ? ', plain' : ''}: a long name is cut short with an ellipsis and has its whole in its title; its key's target is ${m.keyW}x${m.keyH} px`);
  await q.context().close();
}

say(errors.length === 0, 'no errors' + (errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''));
await browser.close();
process.exit(bad ? 1 : 0);
