// A part's own page, looked at every way a person will meet it: drawn in voxels and plain, by
// day and at night, on a laptop and on a phone. Shoots each, lays them on one sheet, and says
// what can be measured.
//   PORT=5989 node tools/part.mjs <name>        the page is showcase/parts/<name>.html
// Writes shots/parts/<name>/{live,plain}-{day,night}-{1280,390}.png and sheet.png. Exit 1 if
// anything fails:
//   error      a script error, or a file that did not load
//   not ready  the page never set data-ready="1" on <html>
//   sideways   the page can be scrolled to the side (at 390 most of all)
//   no voxels  drawn in voxels, but nothing on the page was adopted
//   shift      the page is a different height plain and in voxels (things move when voxels arrive)
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const name = process.argv[2];
if (!name) { console.log('which part? node tools/part.mjs <name>'); process.exit(2); }
const port = process.env.PORT || 5989;
const dir = `shots/parts/${name}`;
await mkdir(dir, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
let bad = 0;
const fail = (what) => { bad++; console.log('FAIL ' + what); };
const heights = {};
for (const w of [1280, 390]) for (const theme of ['light', 'dark']) for (const mode of ['live', 'plain']) {
  const tone = theme === 'light' ? 'day' : 'night', tag = `${mode}-${tone}-${w}`;
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: w === 390 ? 2 : 1 });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  p.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${new URL(r.url()).pathname}`); });
  if (mode === 'plain') await p.addInitScript(() => { new MutationObserver((_, o) => { if (document.documentElement) { document.documentElement.setAttribute('data-vx-plain', ''); o.disconnect(); } }).observe(document, { childList: true }); });
  await p.goto(`http://127.0.0.1:${port}/showcase/parts/${name}.html?theme=${theme}`);
  const ready = await p.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 9000 }).then(() => true, () => false);
  if (!ready) fail(`${tag}: not ready`);
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(700);
  // can the page be pushed sideways at all? (a part's glow may reach past the window; that is clipped, and is not this)
  const m = await p.evaluate(() => { scrollTo(200, 0); const moved = scrollX; scrollTo(0, 0); return { moved, tall: document.documentElement.scrollHeight, live: document.querySelectorAll('[data-vx-live]').length }; });
  if (m.moved > 0) fail(`${tag}: sideways (the page scrolls ${m.moved} px to the side)`);
  if (mode === 'live' && !m.live) fail(`${tag}: no voxels`);
  for (const e of new Set(errors)) fail(`${tag}: error: ${e}`);
  heights[`${tone}-${w}`] ??= {};
  heights[`${tone}-${w}`][mode] = m.tall;
  await p.setViewportSize({ width: w, height: Math.min(Math.max(m.tall, 300), 4000) });
  await p.waitForTimeout(350);
  await p.screenshot({ path: `${dir}/${tag}.png` });
  await ctx.close();
}
await browser.close();
for (const [k, h] of Object.entries(heights)) if (h.live !== h.plain) fail(`${k}: shift (plain ${h.plain} px tall, voxels ${h.live})`);
// one sheet: laptop above (voxels day, voxels night, plain day, plain night), phone below
execFileSync('python3', ['-c', `
from PIL import Image
import sys
d = sys.argv[1]
def row(w, scale):
    ims = [Image.open(f"{d}/{m}-{t}-{w}.png").convert("RGB") for m in ("live", "plain") for t in ("day", "night")]
    ims = [im.resize((int(im.width * scale), int(im.height * scale)), Image.LANCZOS) for im in ims]
    h = max(im.height for im in ims)
    r = Image.new("RGB", (sum(im.width for im in ims) + 12 * 3, h), "#777")
    x = 0
    for im in ims:
        r.paste(im, (x, 0)); x += im.width + 12
    return r
a, b = row(1280, 0.5), row(390, 0.5)
s = Image.new("RGB", (max(a.width, b.width), a.height + b.height + 12), "#777")
s.paste(a, (0, 0)); s.paste(b, (0, a.height + 12))
s.save(f"{d}/sheet.png")
`, dir]);
console.log(bad ? `${bad} to fix. Pictures in ${dir}/` : `ok: ${dir}/sheet.png (voxels day, voxels night, plain day, plain night; laptop above, phone below)`);
process.exit(bad ? 1 : 0);
