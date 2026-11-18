// Film a story on the lit page, frame by frame, with the page's clock stepped by hand, so the film
// is the same on any machine and no frame is dropped.
//   PORT=5989 node tools/lit-film.mjs <deploy|blog> [--dark] [--w 1040] [--h 680] [--secs 13] [--fps 30] [--accent rose]
// Writes shots/lit/film/<name>.mp4, <name>-sheet.png (a contact sheet) and a few named stills.
import { chromium } from 'playwright';
import { mkdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : args[i + 1]; };
const which = args[0] || 'deploy', dark = args.includes('--dark');
const port = process.env.PORT || 5989;
const w = Number(flag('w', which === 'blog' ? 800 : 1040)), h = Number(flag('h', which === 'blog' ? 900 : 660));
const secs = Number(flag('secs', 13)), fps = Number(flag('fps', 30)), accent = flag('accent', '');
const name = `${which}-${dark ? 'night' : 'day'}${accent ? '-' + accent : ''}`;
const dir = `shots/lit/film/${name}`;
await rm(dir, { recursive: true, force: true });
await mkdir(dir, { recursive: true });

const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
await page.goto(`http://127.0.0.1:${port}/kit/showcase/lit.html?still=1&only=${which}&theme=${dark ? 'dark' : 'light'}${accent ? '&accent=' + accent : ''}`);
await page.waitForFunction(() => document.documentElement.dataset.ready === '1' && window.lit);
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(700);
await page.clock.install();
await page.clock.pauseAt(Date.now() + 1000);
await page.clock.runFor(100);
await page.evaluate((i) => window.lit.stories[i].start(true), which === 'blog' ? 1 : 0);
const frames = Math.round(secs * fps);
for (let f = 0; f < frames; f++) {
  await page.clock.runFor(1000 / fps);
  await page.screenshot({ path: `${dir}/f${String(f).padStart(4, '0')}.png` });
}
await browser.close();
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', `${dir}/f%04d.png`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '17', '-movflags', '+faststart', `shots/lit/film/${name}.mp4`]);
// a contact sheet: every sixth of a second, half size
const every = Math.max(1, Math.round(fps / 5));
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', `${dir}/f%04d.png`, '-vf', `select='not(mod(n\\,${every}))',scale=iw/5:-1,tile=8x${Math.ceil(frames / every / 8)}`, '-frames:v', '1', `shots/lit/film/${name}-sheet.png`]);
if (problems.length) console.log('problems:\n  ' + [...new Set(problems)].join('\n  '));
console.log(`shots/lit/film/${name}.mp4  (${frames} frames)`);
