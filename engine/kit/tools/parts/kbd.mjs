// Kbd names a key and is not one. This holds it to that: Tab never stops on it, a real press
// changes nothing, a line of words with caps in it is no taller than one without, and its legend
// (cut from half-voxel cells) starts on whole pixels at 1x. Says ok or FAIL for each.
//   PORT=5989 node tools/parts/kbd.mjs
import { chromium } from 'playwright';

const port = process.env.PORT || 5989;
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
let bad = 0;
const say = (ok, what) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); };

for (const mode of ['voxels', 'plain']) for (const w of [1280, 768, 390]) {
  const tag = `${mode} ${w}:`;
  const p = await (await browser.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: 1 })).newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  if (mode === 'plain') await p.addInitScript(() => { new MutationObserver((_, o) => { if (document.documentElement) { document.documentElement.setAttribute('data-vx-plain', ''); o.disconnect(); } }).observe(document, { childList: true }); });
  await p.goto(`http://127.0.0.1:${port}/kit/showcase/parts/kbd.html?theme=light`);
  await p.waitForFunction(() => document.documentElement.dataset.ready === '1');
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(600);

  const m = await p.evaluate(() => {
    const caps = [...document.querySelectorAll('.vx-kbd')];
    const off = [];
    for (const k of caps) {
      const n = document.createTreeWalker(k, NodeFilter.SHOW_TEXT).nextNode(), r = document.createRange();
      r.selectNodeContents(n);
      const b = r.getBoundingClientRect(), y = b.top + scrollY;
      if (Math.abs(b.left - Math.round(b.left)) > 0.02 || Math.abs(y - Math.round(y)) > 0.02) off.push(`${k.textContent} x ${b.left.toFixed(2)} y ${y.toFixed(2)}`);
    }
    // a line of words: every line the same height, caps or no caps
    const tall = [...document.querySelectorAll('.words')].map((el) => { const lh = parseFloat(getComputedStyle(el).lineHeight); return [el.offsetHeight, lh, el.offsetHeight / lh]; });
    const wide = [...document.querySelectorAll('.sheet *')].filter((e) => !e.classList.contains('vx-canvas') && e.getBoundingClientRect().right > innerWidth + 0.5).length;
    scrollTo(300, 0); const moved = scrollX; scrollTo(0, 0);
    return { caps: caps.length, live: caps.filter((k) => k.hasAttribute('data-vx-live')).length, off, tall, wide, moved, hand: caps.filter((k) => getComputedStyle(k).cursor === 'pointer').length, height: [...new Set(caps.map((k) => k.offsetHeight))] };
  });
  if (mode === 'voxels') {
    say(m.live === m.caps, `${tag} all ${m.caps} caps are drawn in voxels`);
    say(m.off.length === 0, `${tag} every legend starts on a whole pixel` + (m.off.length ? ': ' + m.off.slice(0, 4).join(' | ') : ''));
  }
  say(m.height.length === 1 && m.height[0] === 28, `${tag} every cap is seven voxels tall (${m.height.join(', ')} px)`);
  say(m.tall.every(([h, lh, n]) => Math.abs(n - Math.round(n)) < 0.01), `${tag} a line with caps in it is as tall as any other (${m.tall.map(([h, lh]) => `${h} px of ${lh} px lines`).join('; ')})`);
  say(m.moved === 0 && m.wide === 0, `${tag} nothing is cut and the page does not move sideways`);
  say(m.hand === 0, `${tag} no cap shows a hand: it cannot be pressed`);

  // Tab through the whole page: it must never stop on a cap
  let stops = 0, onCap = 0;
  for (let i = 0; i < 12; i++) { await p.keyboard.press('Tab'); const at = await p.evaluate(() => { const a = document.activeElement; return a && a !== document.body ? (a.closest('.vx-kbd') ? 'cap' : 'other') : ''; }); if (at) stops++; if (at === 'cap') onCap++; }
  say(onCap === 0, `${tag} Tab never stops on a cap (${stops} stops on the page)`);

  // a real press on a cap: nothing moves, nothing changes
  const cap = p.locator('.shortcuts .vx-kbd').first();
  const box = await cap.boundingBox();
  const before = await p.evaluate(() => document.querySelector('main').innerHTML.length + '|' + document.querySelector('main').offsetHeight);
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 });
  await p.mouse.down(); await p.waitForTimeout(80);
  const held = mode === 'voxels' ? await p.evaluate(() => { const l = window.vx.live(document.querySelector('.shortcuts .vx-kbd')); return l ? Object.values(l.springs).some((s) => s.moving) || !l.well || l.model.byName.floor.tz !== 0 : null; }) : false;
  await p.mouse.up();
  const after = await p.evaluate(() => document.querySelector('main').innerHTML.length + '|' + document.querySelector('main').offsetHeight);
  say(before === after && held === false, `${tag} pressing a cap with a real mouse moves nothing and changes nothing`);

  say(errors.length === 0, `${tag} no errors` + (errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''));
  await p.context().close();
}
await browser.close();
process.exit(bad ? 1 : 0);
