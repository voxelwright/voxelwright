// Rehearsal: film a motion one frame at a time, lay every frame on a contact sheet, and report what
// can be measured (the idea is from Benji Taylor's Stageshow skill; its own scripts film a React
// stage and cannot see into a canvas, so this one reads the voxels themselves).
//
//   node tools/film.mjs [scene ...] [--dark] [--reduced] [--w 1280] [--page showcase/]
//
// Time is stepped with Playwright's clock, 1/60 s a frame, so nothing depends on how fast the
// machine is. For each scene it prints: how long the motion took, and any of
//   no response   nothing changed on the frame of the input
//   pop           voxels that appear at over a third of their size in one frame
//   snap          a voxel that moves far more in one frame than in the frames around it
//   empty frame   a frame with nothing drawn between two frames with something
//   slow / fast   a settle time outside the range the spec gives

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : args[i + 1]; };
const has = (n) => args.includes('--' + n);
const wanted = args.filter((a, i) => !a.startsWith('--') && !(args[i - 1] || '').match(/^--(w|page)$/));
const port = process.env.PORT || 5989;
const FRAME = 1000 / 60;

// A scene: what to film, how to start it, and how long the spec says it should take (ms).
const SCENES = {
  'button-press': { el: '#kit .vx-button', frames: 30, pad: 28, expect: [70, 170], act: async (p, b) => { await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await p.mouse.down(); }, mid: { at: 14, act: async (p) => p.mouse.up() }, expectAfter: [120, 330] },
  'toggle': { el: '#kit .vx-toggle:nth-of-type(2) .vx-switch', frames: 30, pad: 28, expect: [140, 420], act: async (p, b) => { await p.mouse.click(b.x + b.width / 2, b.y + b.height / 2); } },
  'tabs': { el: '#kit .vx-tabs', frames: 30, pad: 28, expect: [140, 420], act: async (p, b) => { await p.mouse.click(b.x + b.width * 0.83, b.y + b.height / 2); } },
  'menu-open': { el: '#plant-menu', scroll: '[popovertarget="plant-menu"]', frames: 24, pad: 44, expect: [150, 260], act: async (p) => { await p.click('[popovertarget="plant-menu"]'); }, late: true },
  'dialog-open': { el: '#dlg', scroll: '#open-dialog', frames: 40, pad: 72, expect: [300, 520], act: async (p) => { await p.click('#open-dialog'); }, late: true },
  'dialog-close': { el: '#dlg', scroll: '#open-dialog', frames: 30, pad: 72, expect: [200, 420], before: async (p) => { await p.click('#open-dialog'); await p.clock.runFor(900); }, act: async (p) => { await p.click('#dlg [data-vx-close="no"]'); } },
  'toast': { el: '.vx-toasts .vx-toast', scroll: '#toast-done', frames: 30, pad: 44, expect: [200, 360], act: async (p) => { await p.click('#toast-done'); }, late: true },
  'break': { el: '#build-card', frames: 32, pad: 60, expect: [200, 460], act: async (p) => { await p.click('#break'); } },
  'build': { el: '#build-card', frames: 40, pad: 60, expect: [300, 560], before: async (p) => { await p.click('#break'); await p.clock.runFor(900); }, act: async (p) => { await p.click('#build'); } },
  'poke': { el: '.top .vx-sign', frames: 110, every: 5, pad: 60, expect: [600, 2200], act: async (p, b) => { await p.mouse.click(b.x + b.width * 0.42, b.y + b.height / 2); } },
  // a held pointer drawn across the sign: it breaks on the press, keeps breaking under the pointer, and mends behind it
  'brush': { el: '.top .vx-sign', frames: 170, every: 6, pad: 60, expect: [1700, 2900], act: async (p, b) => { await p.mouse.move(b.x + b.width * 0.12, b.y + b.height / 2); await p.mouse.down(); },
    each: async (p, f, b) => { if (f < 80) await p.mouse.move(b.x + b.width * (0.12 + 0.78 * f / 80), b.y + b.height / 2); else if (f === 80) await p.mouse.up(); } },
  // the same on a heading, where a press must be held a moment before it brushes
  'brush-heading': { el: '#kit-h', frames: 150, every: 6, pad: 60, late: true, expect: [1500, 2600], act: async (p) => { const b = await p.locator('#kit-h').boundingBox(); await p.mouse.move(b.x + 8, b.y + b.height / 2); await p.mouse.down(); },
    each: async (p, f) => { const b = await p.locator('#kit-h').boundingBox(); if (f >= 14 && f < 64) await p.mouse.move(b.x + 8 + (b.width - 12) * (f - 14) / 50, b.y + b.height / 2); else if (f === 64) await p.mouse.up(); } },
  'grow': { el: '#shelf .vx-meter:nth-of-type(3)', frames: 90, every: 4, pad: 20, expect: [400, 1400], act: async (p) => { await p.evaluate(() => { const g = document.querySelector('#grow'); g.value = 100; g.dispatchEvent(new Event('input', { bubbles: true })); }); } },
};

// The hardware pages use the same manual clock as the showcase.
if (has('hardware')) {
  Object.assign(SCENES, {
    'key-latch': { el: '#s-off', path: 'toggle-button', frames: 28, pad: 24, expect: [80, 330],
      act: async (p, b) => p.mouse.click(b.x + b.width / 2, b.y + b.height / 2) },
    'hardware-menu': { ...SCENES['menu-open'], path: 'menu', el: '#project-menu', scroll: '#trigger',
      act: async (p) => p.click('#trigger') },
    'release-menu': { el: '#project-menu', path: 'menu', scroll: '#trigger', frames: 16, pad: 44, expect: [90, 160],
      before: async p => { await p.click('#trigger'); await p.clock.runFor(400); }, act: async p => p.keyboard.press('Escape') },
    'release-toast': { el: '.vx-toasts .vx-toast', path: 'toast', scroll: '#stay', frames: 20, pad: 44, expect: [160, 240],
      before: async p => { await p.click('#stay'); await p.clock.runFor(400); },
      act: async (p, b) => p.mouse.click(b.x + b.width / 4, b.y + b.height / 2) },
    'raise-plate': { ...SCENES['dialog-open'], path: 'dialog', el: '#rename', scroll: '#open-rename',
      act: async (p) => p.click('#open-rename') },
    'lower-plate': { ...SCENES['dialog-close'], path: 'dialog', el: '#rename', scroll: '#open-rename',
      before: async (p) => { await p.click('#open-rename'); await p.clock.runFor(900); },
      act: async (p) => p.keyboard.press('Escape') },
  });
}

const names = wanted.length ? wanted : Object.keys(SCENES).filter((name) => !!SCENES[name].path === has('hardware'));
await mkdir('shots/film', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
let faults = 0;

for (const name of names) {
  const sc = SCENES[name];
  if (!sc) { console.log(`unknown scene: ${name}`); continue; }
  const ctx = await browser.newContext({ viewport: { width: Number(flag('w', 1280)), height: 900 }, deviceScaleFactor: 2, colorScheme: has('dark') ? 'dark' : 'light', reducedMotion: has('reduced') ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const path = sc.path ? `showcase/parts/${sc.path}.html?theme=${has('dark') ? 'dark' : 'light'}` : flag('page', 'showcase/principles.html');
  await page.goto(`http://127.0.0.1:${port}/kit/${path}`);
  await page.waitForFunction(() => document.documentElement.dataset.ready === '1');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  await page.clock.install();
  await page.clock.pauseAt(Date.now() + 1000);
  await page.locator(sc.scroll || sc.el).first().scrollIntoViewIfNeeded();
  await page.clock.runFor(200);
  if (sc.before) await sc.before(page);
  await page.evaluate(() => { window.vx.stage.manual = true; });
  const followsInk = ['menu-open', 'hardware-menu', 'dialog-open', 'raise-plate', 'dialog-close', 'lower-plate', 'toast', 'release-toast', 'release-menu'].includes(name);
  if (followsInk) await page.evaluate(async () => {
    window.measurePlateInk = (await import('/kit/tools/plate-ink.mjs')).plateInk;
  });

  // read the voxels behind an element: positions and sizes, compared with the frame before
  const measure = () => page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const live = el && window.vx.live(el);
    if (!live) return null;
    let n = 0, o = 0;
    for (const p of live.model.parts) if (!p.hidden) n += p.count;
    const pos = live.pos, prev = window.__film;
    const cur = new Float32Array(pos.subarray(0, n * 8));
    let visible = 0, maxStep = 0, popped = 0, changed = 0;
    // voxels that appear inside another solid (a lit track under its knob) cannot be seen arriving
    const covered = new Uint8Array(n);
    for (const p of live.model.parts) { if (p.hidden) continue; if (p.covered) covered.fill(1, o, o + p.count); o += p.count; }
    for (let i = 0; i < n; i++) {
      const s = cur[i * 8 + 3];
      if (s > 0.01) visible++;
      if (prev && prev.length === cur.length) {
        const ps = prev[i * 8 + 3];
        const d = Math.hypot(cur[i * 8] - prev[i * 8], cur[i * 8 + 1] - prev[i * 8 + 1], cur[i * 8 + 2] - prev[i * 8 + 2]);
        if (ps > 0.01 && s > 0.01 && d > maxStep) maxStep = d;
        if (ps <= 0.01 && s > 0.34 && !covered[i]) popped++;
        if (d > 0.012 || Math.abs(s - ps) > 0.012) changed++; // under a twentieth of a pixel nobody sees it
      } else if (prev) changed = n;
    }
    // A reduced-motion surface changes opacity with stationary vertices. Measure the
    // actual rendered alpha as well as translations, including the native close frame.
    if (window.measurePlateInk) {
      const alpha = el.getClientRects().length ? Number(getComputedStyle(live.canvas).opacity) * Number(getComputedStyle(el).opacity) : 0;
      if (Math.abs(alpha - window.__filmAlpha) > 0.01) changed++;
      window.__filmAlpha = alpha;
    }
    window.__film = cur;
    return { n, visible, maxStep, popped, changed, ink: window.measurePlateInk?.(live) };
  }, sc.el);

  let box = sc.late ? null : await page.locator(sc.el).first().boundingBox();
  await page.evaluate(() => { window.__film = null; });
  const resting = sc.late ? null : await measure();
  await sc.act(page, box);
  await page.waitForTimeout(40); // real time, so the page has handled the input before frame 1
  const firstInk = followsInk ? await page.evaluate(sel => {
    const el = document.querySelector(sel), live = el && window.vx.live(el);
    return live && window.measurePlateInk(live);
  }, sc.el) : null;
  const shots = [], stats = [];
  const every = sc.every || 1;
  for (let f = 0; f < sc.frames; f++) {
    if (sc.mid && f === sc.mid.at) { await sc.mid.act(page); await page.waitForTimeout(40); }
    if (sc.each) await sc.each(page, f, box);
    await page.clock.runFor(FRAME);
    await page.evaluate((dt) => window.vx.stage.advance(dt), 1 / 60);
    const m = await measure();
    stats.push(m);
    if (f % every === 0) {
      box = await page.evaluate(sel => document.querySelector(sel)?.getBoundingClientRect().toJSON(), sc.el).then(r => r?.width ? r : box);
      if (box) {
        const pad = sc.pad;
        const clip = { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: box.width + pad * 2, height: box.height + pad * 2 };
        const file = `shots/film/.${name}-${String(f).padStart(3, '0')}.png`;
        await page.screenshot({ path: file, clip });
        shots.push(file);
      }
    }
  }
  await ctx.close();

  if (process.env.FILM_DEBUG) console.log(JSON.stringify(stats.slice(0, 4)));
  // ----- the report
  const lines = [];
  const ms = (f) => Math.round((f + 1) * FRAME);
  const live = stats.filter(Boolean);
  if (!live.length) lines.push('not filmed: no voxels behind ' + sc.el);
  else {
    const segments = sc.mid ? [[0, sc.mid.at, sc.expect], [sc.mid.at, stats.length, sc.expectAfter]] : [[0, stats.length, followsInk && has('reduced') ? [90, 170] : sc.expect]];
    for (const [a, b, expect] of segments) {
      const seg = stats.slice(a, b);
      if (seg[0] && seg[0].changed === 0 && !sc.late) lines.push(`no response: nothing changed on the frame of the input (frame ${a + 1})`);
      let last = -1;
      seg.forEach((m, i) => { if (m && m.changed > 0) last = i; });
      const took = last < 0 ? 0 : ms(last);
      const tag = !expect ? '' : took < expect[0] ? `  fast: the spec says ${expect[0]} to ${expect[1]} ms` : took > expect[1] ? `  slow: the spec says ${expect[0]} to ${expect[1]} ms` : '';
      lines.push(`settled in ${took} ms${last === seg.length - 1 ? ' or more (still moving at the last frame)' : ''}${tag}`);
      if (tag) faults++;
      const steps = seg.map((m) => (m ? m.maxStep : 0)).filter((v) => v > 0.001).sort((x, y) => x - y);
      const median = steps.length ? steps[Math.floor(steps.length / 2)] : 0;
      seg.forEach((m, i) => {
        if (!m) return;
        if (m.popped > 0) { lines.push(`pop: ${m.popped} voxels appear at over a third of their size at ${ms(a + i)} ms`); faults++; }
        const near = Math.max(seg[i - 1]?.maxStep ?? 0, seg[i + 1]?.maxStep ?? 0);
        if (i > 0 && m.maxStep > 1.5 && m.maxStep > near * 4) { lines.push(`snap: a voxel moves ${m.maxStep.toFixed(1)} voxels in one frame at ${ms(a + i)} ms (typical ${median.toFixed(2)})`); faults++; }
        const before = seg[i - 1], after = seg[i + 1];
        if (before && after && before.visible > 0 && after.visible > 0 && m.visible === 0) { lines.push(`empty frame at ${ms(a + i)} ms`); faults++; }
      });
    }
  }
  if (followsInk) {
    const samples = [resting?.ink, firstInk, ...live.map(m => m.ink)].filter(Boolean);
    const checked = samples.reduce((sum, sample) => sum + sample.checked, 0);
    const unsupported = samples.reduce((sum, sample) => sum + sample.unsupported, 0);
    if (!checked || unsupported) faults++;
    lines.push(`app-clock text samples without a supporting cube: ${unsupported} of ${checked}, input through frame ${sc.frames}`);
  }
  for (const e of errors) { lines.push('page error: ' + e); faults++; }
  // collapse repeats (a pop on many frames is one fault to fix)
  const seen = new Map();
  for (const l of lines) { const k = l.replace(/[\d.]+/g, '#'); seen.set(k, seen.has(k) ? [seen.get(k)[0], seen.get(k)[1] + 1] : [l, 1]); }
  console.log(`\n${name}`);
  for (const [l, c] of seen.values()) console.log('  ' + l + (c > 1 ? `  (and on ${c - 1} more frames)` : ''));

  if (shots.length) {
    const cols = Math.min(shots.length, 10);
    const out = `shots/film/${name}${has('dark') ? '-night' : ''}${has('reduced') ? '-reduced' : ''}.png`;
    execFileSync('python3', ['-c', `
import sys
from PIL import Image, ImageDraw
files = sys.argv[3:]; cols = int(sys.argv[2]); ims = [Image.open(f).convert('RGB') for f in files]
w = max(i.width for i in ims); h = max(i.height for i in ims)
scale = min(1.0, 2600 / (w * cols))
tw, th = int(w * scale), int(h * scale)
rows = (len(ims) + cols - 1) // cols
sheet = Image.new('RGB', (cols * tw, rows * (th + 18)), (255, 255, 255))
d = ImageDraw.Draw(sheet)
for i, im in enumerate(ims):
    x, y = (i % cols) * tw, (i // cols) * (th + 18)
    sheet.paste(im.resize((tw, th), Image.LANCZOS), (x, y + 18))
    f = int(files[i].rsplit('-', 1)[1].split('.')[0])
    d.text((x + 4, y + 3), '%d  %d ms' % (f + 1, round((f + 1) * 1000 / 60)), fill=(0, 0, 0))
sheet.save(sys.argv[1])
`, out, String(cols), ...shots]);
    execFileSync('sh', ['-c', `rm -f shots/film/.${name}-*.png`]);
    console.log('  sheet: ' + out);
  }
}
await browser.close();
console.log(faults ? `\nrehearsal: ${faults} lines to fix` : '\nrehearsal passed (passing is necessary, not sufficient: read the sheets)');
process.exit(faults ? 1 : 0);
