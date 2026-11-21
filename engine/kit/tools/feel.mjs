// How a key feels, plain and live, with real input: the Ridgeline print sits clear of the
// legend; a link made a key keeps its legend; plain keys move by the voxels' own springs (press,
// release with its carry, a mouse lifting one), and not at all with less motion; a live key's
// focus ring frames its whole solid; a plain slide switch is the voxel one (bezel, dark slot, a
// paddle that slides on the SLIDE spring, light behind it when on); and no two key strokes sound
// alike, with heavy caps lower than light ones.
//   PORT=5989 node tools/feel.mjs
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { springCurve, PRESS, RELEASE, SLIDE } from '../src/core/motion.js';
import { voice } from '../src/core/sound.js';

const port = process.env.PORT || 5989;
const base = `http://127.0.0.1:${port}/kit/showcase/parts/button-group.html`;
let bad = 0;
const say = (ok, what, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `  (${detail})` : ''}`); };

// ----- one owner for the springs: the stylesheet carries motion.js's, sampled
const css = await readFile(new URL('../voxelmorphism.css', import.meta.url), 'utf8');
for (const [name, spring] of [['press', PRESS], ['release', RELEASE], ['slide', SLIDE]]) {
  const { time, easing } = springCurve(spring);
  say(css.includes(`--vx-${name}-time: ${time}ms;`) && css.includes(`--vx-${name}-ease: ${easing};`), `the stylesheet's ${name} curve is motion.js's ${name.toUpperCase()} spring`, `${time} ms`);
}
const peak = Math.max(...springCurve(RELEASE).easing.slice(7, -1).split(', ').map(Number));
say(peak > 1.1 && peak < 1.2, 'a plain release carries past rest like a voxel key (14% in the spec)', `peak ${peak}`);

// ----- sound: never twice the same, heavier caps lower
{
  let same = 0, prev = null, light = 0, heavy = 0, out = 0;
  for (let i = 0; i < 400; i++) {
    const v = voice(300);
    if (prev && Math.abs(v.rate - prev.rate) < 0.004) same++;
    if (v.rate < 0.97 || v.rate > 1.03 || v.gain < 0.85 || v.gain > 1.01) out++;
    prev = v;
  }
  for (let i = 0; i < 400; i++) { light += voice(75).rate; heavy += voice(2400).rate; }
  say(same === 0, 'no two strokes in a row sound alike', `${same} near repeats in 400`);
  say(out === 0, 'a stroke stays within 3% of its pitch and 15% of its level', `${out} outside`);
  say(light / 400 > 1.04 && heavy / 400 < 0.92, 'a small cap rings higher than a 44 px key, a wide one lower', `${(light / 400).toFixed(3)} / ${(heavy / 400).toFixed(3)}`);
}

const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
async function open({ plain = false, reduced = false, dark = false, init } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 2, reducedMotion: reduced ? 'reduce' : 'no-preference', colorScheme: dark ? 'dark' : 'light' });
  const p = await ctx.newPage();
  if (init) await p.addInitScript(init);
  if (plain) await p.route((u) => u.href.startsWith(base), async (route) => {
    const r = await route.fetch();
    await route.fulfill({ response: r, body: (await r.text()).replace('<html', '<html data-vx-plain') });
  });
  await p.goto(base);
  await p.waitForFunction(() => document.documentElement.dataset.ready === '1');
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(plain ? 300 : 1200);
  return p;
}
const KEY = '.vx-button:not([data-vx-kind]):not([aria-pressed]):not(:disabled)';
// How far the focused key's ring keeps from the words on the keys before and after it (px; negative: it crosses them).
const neighbours = (p) => p.evaluate(() => {
  const el = document.activeElement, a = getComputedStyle(el, '::after'), r = el.getBoundingClientRect();
  const ring = { left: r.left + parseFloat(a.left), right: r.right - parseFloat(a.right), top: r.top + parseFloat(a.top), bottom: r.bottom - parseFloat(a.bottom) };
  // the words alone: a live key's contents also hold its canvas, which bleeds past the box
  const words = (k) => { const t = document.createRange(); t.selectNodeContents(k.querySelector(':scope > .vx-label') ?? k); return t.getBoundingClientRect(); };
  const out = [];
  for (const k of [el.previousElementSibling, el.nextElementSibling]) {
    if (!k?.matches('.vx-button')) continue;
    const w = words(k);
    if (w.bottom < ring.top || w.top > ring.bottom) continue;
    out.push(k === el.previousElementSibling ? ring.left - w.right : w.left - ring.right);
  }
  return out;
});

// ----- plain: the print, the legend, and the springs
{
  const p = await open({ plain: true });
  const key = p.locator(KEY, { hasText: 'Comment' }).first();
  await key.scrollIntoViewIfNeeded();
  await p.mouse.move(5, 5);
  await p.waitForTimeout(400);
  // the print's ink, counted inside the legend and along the foot
  const shot = await key.screenshot();
  const counts = await p.evaluate(async ({ png, key }) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + png; await img.decode();
    const c = new OffscreenCanvas(img.width, img.height), g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, img.width, img.height).data;
    const r = key.rect, l = key.label, sx = img.width / r.width;
    const inks = [[0x90, 0x9b, 0x80], [0x63, 0x7a, 0x6c]];
    let legend = 0, foot = 0;
    for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4;
      if (!inks.some(([a, b, cc]) => Math.abs(d[i] - a) + Math.abs(d[i + 1] - b) + Math.abs(d[i + 2] - cc) < 24)) continue;
      const px = r.x + x / sx, py = r.y + y / sx;
      if (px >= l.x && px <= l.x + l.width && py >= l.y && py <= l.y + l.height) legend++; else if (py > r.y + r.height * 0.6) foot++;
    }
    return { legend, foot };
  }, { png: shot.toString('base64'), key: await key.evaluate((el) => { const r = el.getBoundingClientRect(), t = document.createRange(); t.selectNodeContents(el); const l = t.getBoundingClientRect(); return { rect: { x: r.x, y: r.y, width: r.width, height: r.height }, label: { x: l.x, y: l.y, width: l.width, height: l.height } }; }) });
  say(counts.foot > 20, 'plain, the Ridgeline print runs along the foot of the cap', `${counts.foot} px`);
  say(counts.legend === 0, 'plain, the print never crosses the legend', `${counts.legend} px of print inside the words`);

  // a link made a key keeps its legend, even under a page rule for links
  const colours = await p.evaluate(() => {
    const style = document.createElement('style'); style.textContent = '.feel-page a { color: inherit; }'; document.head.append(style);
    const host = document.createElement('div'); host.className = 'feel-page'; host.style.color = 'rgb(1, 2, 3)';
    host.innerHTML = '<a class="vx-button" href="#x">City view</a> <button class="vx-button" type="button">City view</button>';
    document.querySelector('main, body').append(host);
    const [a, b] = host.children; return [getComputedStyle(a).color, getComputedStyle(b).color];
  });
  say(colours[0] === colours[1] && colours[0] !== 'rgb(1, 2, 3)', 'a link made a key keeps the key\'s legend colour', colours.join(' / '));

  // hover: a mouse raises the key; the press goes down on the press curve, the release carries past rest
  const box = await key.boundingBox();
  const at = async () => key.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m41);
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await p.waitForTimeout(450);
  const vx = await key.evaluate((el) => parseFloat(getComputedStyle(el).getPropertyValue('--vx')) || 4);
  const hovered = await at();
  const body = await key.evaluate((el) => parseFloat(getComputedStyle(el, '::before').top));
  await p.mouse.move(5, 5); await p.waitForTimeout(450);
  const restBody = await key.evaluate((el) => parseFloat(getComputedStyle(el, '::before').top));
  say(Math.abs(restBody - body - vx * 0.5) < 0.3 && hovered === 0, 'plain, a mouse resting on a key raises it half a voxel, and the face stays under the pointer', `body ${(restBody - body).toFixed(2)} px taller, face moved ${hovered} px`);
  // a pointer resting just inside the corner must not set the key rocking in and out of hover
  await p.mouse.move(box.x + 1, box.y + 1); await p.waitForTimeout(150);
  const rocks = await key.evaluate(async (el) => { let n = 0, was = el.matches(':hover'); for (let i = 0; i < 40; i++) { await new Promise((r) => requestAnimationFrame(r)); const now = el.matches(':hover'); if (now !== was) n++; was = now; } return n; });
  say(rocks === 0, 'plain, a pointer resting on the corner of a key holds it steady', `${rocks} hover changes in 40 frames`);
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await p.waitForTimeout(450);
  await p.mouse.down();
  const pressCurve = await key.evaluate((el) => el.getAnimations().map((a) => a.effect.getTiming().easing + '@' + a.effect.getTiming().duration));
  say(pressCurve.some((c) => c.startsWith('linear(') && c.endsWith(`@${springCurve(PRESS).time}`)), 'plain, a press goes down on the press spring', pressCurve[0] ?? 'no motion');
  await p.waitForTimeout(400);
  const down = await at();
  say(Math.abs(down + vx) < 0.3, 'plain, a held key is down a voxel', `${down.toFixed(2)} px`);
  await p.mouse.up();
  // stop the release at the release spring's peak and read where the face is
  const { time } = springCurve(RELEASE);
  const mid = await key.evaluate((el, t) => {
    const a = el.getAnimations().find((x) => x.transitionProperty === 'transform');
    if (!a) return null;
    a.pause(); a.currentTime = t; const x = new DOMMatrix(getComputedStyle(el).transform).m41; a.play(); return x;
  }, time * 0.4);
  say(mid !== null && mid > hovered + 0.05, 'plain, the released key carries past where it rests, then settles', mid === null ? 'no release motion' : `${mid.toFixed(2)} px at 40%, rests at ${hovered.toFixed(2)}`);
  await p.waitForTimeout(500);
  say(Math.abs((await at()) - hovered) < 0.05, 'plain, and settles where it rests');
  await p.context().close();
}

// ----- plain with less motion: states change at once
{
  const p = await open({ plain: true, reduced: true });
  const key = p.locator(KEY, { hasText: 'Comment' }).first();
  const box = await key.boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await p.mouse.down();
  const moving = await key.evaluate((el) => el.getAnimations().length);
  await p.mouse.up();
  const after = await key.evaluate((el) => el.getAnimations().length);
  say(moving === 0 && after === 0, 'with less motion a plain key changes at once', `${moving}/${after} animations`);
  await p.context().close();
}

// ----- live: the focus ring frames the solid
{
  const p = await open();
  const live = await p.evaluate(() => document.querySelectorAll('[data-vx-live]').length);
  say(live > 0, 'the page is live', `${live} parts`);
  const key = p.locator(KEY, { hasText: 'Comment' }).first();
  await key.scrollIntoViewIfNeeded();
  await key.focus();
  await p.keyboard.press('Shift+Tab'); await p.keyboard.press('Tab');
  const ring = await p.evaluate(() => {
    const el = document.activeElement, r = el.getBoundingClientRect(), a = getComputedStyle(el, '::after');
    const vx = parseFloat(getComputedStyle(el).getPropertyValue('--vx')) || 4, z = parseFloat(el.style.getPropertyValue('--vx-face-z'));
    return { live: el.hasAttribute('data-vx-live'), outline: `${a.outlineStyle} ${a.outlineWidth}`, top: parseFloat(a.top), left: parseFloat(a.left), right: parseFloat(a.right), z, vx, text: el.textContent.trim() };
  });
  say(ring.live && /solid 2px/.test(ring.outline), 'live, a focused key has a ring', `${ring.text}: ${ring.outline}`);
  say(ring.z > 0 && Math.abs(-ring.top - ring.vx * (ring.z / 2 + 1.5)) < 0.6 && Math.abs(-ring.left - ring.vx * (ring.z / 2 + 1.5)) < 0.6 && Math.abs(-ring.right - ring.vx * 1.5) < 0.6,
    'live, the ring frames the key\'s body up and to the left of its face', `face ${ring.z} voxels, ring ${-ring.top} px above`);
  const clear = await neighbours(p);
  say(clear.every((c) => c >= 0), 'live, the ring stays clear of the words on the keys beside it', clear.map((c) => `${c.toFixed(1)} px`).join(', '));
  await p.context().close();
}
{
  const p = await open({ plain: true });
  const key = p.locator(KEY, { hasText: 'Comment' }).first();
  await key.scrollIntoViewIfNeeded();
  await key.focus();
  await p.keyboard.press('Shift+Tab'); await p.keyboard.press('Tab');
  const ring = await p.evaluate(() => {
    const el = document.activeElement, a = getComputedStyle(el, '::after'), b = getComputedStyle(el, '::before');
    return { outline: `${a.outlineStyle} ${a.outlineWidth}`, top: parseFloat(a.top), body: parseFloat(b.top), vx: parseFloat(getComputedStyle(el).getPropertyValue('--vx')) || 4 };
  });
  say(/solid 2px/.test(ring.outline) && Math.abs(ring.top - (ring.body - ring.vx * 1.5)) < 0.6, 'plain, the ring frames the body band too', `ring ${-ring.top} px above, body ${-ring.body} px`);
  const clear = await neighbours(p);
  say(clear.every((c) => c >= 0), 'plain, the ring stays clear of the words on the keys beside it', clear.map((c) => `${c.toFixed(1)} px`).join(', '));
  await p.context().close();
}
// ----- the slide switch, plain: the voxel one's parts, its light, its slide
{
  for (const reduced of [false, true]) {
    const ctx = await browser.newContext({ viewport: { width: 900, height: 900 }, deviceScaleFactor: 2, reducedMotion: reduced ? 'reduce' : 'no-preference' });
    const p = await ctx.newPage();
    await p.goto(base);
    await p.evaluate(() => {
      document.documentElement.setAttribute('data-vx-plain', '');
      const host = document.createElement('div');
      host.innerHTML = '<label class="vx-toggle" id="feel-switch"><input type="checkbox" role="switch"><span class="vx-switch"></span>Switch sound</label>';
      document.querySelector('main, body').prepend(host);
    });
    const label = p.locator('#feel-switch');
    const parts = () => p.evaluate(() => {
      const s = document.querySelector('#feel-switch .vx-switch'), a = getComputedStyle(s, '::after'), b = getComputedStyle(s, '::before');
      const rgb = (c) => (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
      const lum = ([r, g, bb]) => [r, g, bb].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((t, v, i) => t + v * [0.2126, 0.7152, 0.0722][i], 0);
      const knob = lum(rgb(a.backgroundColor)), slot = lum(rgb(getComputedStyle(s).backgroundColor));
      return { x: new DOMMatrix(a.transform).m41, clip: b.clipPath, ratio: (Math.max(knob, slot) + 0.05) / (Math.min(knob, slot) + 0.05), moving: s.getAnimations({ subtree: true }).length,
        easing: s.getAnimations({ subtree: true }).map((x) => x.effect.getTiming().easing).join(' '), vx: parseFloat(getComputedStyle(s).getPropertyValue('--vx')) || 4 };
    });
    const off = await parts();
    if (!reduced) {
      say(off.ratio >= 3, 'plain, the paddle stands out from its slot (3:1 or more)', `${off.ratio.toFixed(1)}:1`);
      say(/inset\(0px 100%/.test(off.clip), 'plain, off, the trench is dark', off.clip);
    }
    await label.click();
    const moving = await parts();
    // the browser writes linear() back with a position per stop: compare the values alone
    const stops = (e) => (e.match(/linear\(([^)]*)\)/)?.[1] ?? '').split(',').map((v) => parseFloat(v)).join(' ');
    if (!reduced) say(moving.moving > 0 && stops(moving.easing) === stops(springCurve(SLIDE).easing), 'plain, the paddle slides on the SLIDE spring', `${moving.moving} animations`);
    else say(moving.moving === 0, 'with less motion the plain switch changes at once');
    await p.waitForTimeout(500);
    const on = await parts();
    if (!reduced) {
      say(Math.abs(on.x - 7 * on.vx) < 0.5, 'plain, on, the paddle has travelled the slot (seven voxels)', `${on.x.toFixed(1)} px`);
      say(/inset\(0px\)/.test(on.clip) || on.clip === 'inset(0px)', 'plain, on, the trench behind the paddle is full of light', on.clip);
    }
    await ctx.close();
  }
}

await browser.close();
console.log(bad ? `${bad} failed` : 'every feel check passed');
process.exit(bad ? 1 : 0);
