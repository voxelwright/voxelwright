// Record a short clip of the showcase being used. Output: shots/showcase.webm (and .mp4 if ffmpeg exists).
import { chromium } from 'playwright';
import { rename, readdir, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const port = process.env.PORT || 5985;
await mkdir('shots/clip', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2, recordVideo: { dir: 'shots/clip', size: { width: 1280, height: 720 } } });
const page = await ctx.newPage();
await page.goto(`http://127.0.0.1:${port}/showcase/`);
await page.waitForFunction(() => document.documentElement.dataset.ready === '1');
const wait = (ms) => page.waitForTimeout(ms);
const glide = async (x, y, steps = 18) => { await page.mouse.move(x, y, { steps }); };
await wait(900);

// poke the sign
for (const [x, y] of [[300, 150], [620, 160], [900, 140]]) { await glide(x, y); await page.mouse.down(); await page.mouse.up(); await wait(450); }
await wait(1500);

// night and back
const tab = async (name) => { const b = await page.locator('#light [role="tab"]', { hasText: name }).boundingBox(); await glide(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); await wait(90); await page.mouse.up(); };
await tab('Night'); await wait(1300);
for (const [x, y] of [[480, 150]]) { await glide(x, y); await page.mouse.down(); await page.mouse.up(); await wait(1700); }
await tab('Day'); await wait(700);

// the kit: press, toggle, dialog
await page.evaluate(() => document.querySelector('#kit').scrollIntoView({ behavior: 'instant', block: 'start' }));
await wait(500);
const press = async (sel, hold = 220) => { const b = await page.locator(sel).first().boundingBox(); await glide(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); await wait(hold); await page.mouse.up(); await wait(350); };
await press('#kit .vx-button'); await press('#kit .vx-button[data-vx-material="signal"]');
await press('#kit .vx-toggle:nth-of-type(2)', 60); await press('#kit .vx-toggle:nth-of-type(1)', 60); await press('#kit .vx-toggle:nth-of-type(1)', 60);
await page.evaluate(() => document.querySelector('#open-dialog').scrollIntoView({ behavior: 'instant', block: 'center' }));
await wait(300);
await press('#open-dialog', 120); await wait(1200);
await press('#dlg [data-vx-close="yes"]', 120); await wait(2200);

// grow the plants
await page.evaluate(() => document.querySelector('#growth').scrollIntoView({ behavior: 'instant', block: 'start' }));
await wait(400);
const g = await page.locator('#grow').boundingBox();
await glide(g.x + g.width * 0.55, g.y + g.height / 2);
await page.mouse.down();
await page.mouse.move(g.x + 4, g.y + g.height / 2, { steps: 20 });
await wait(500);
await page.mouse.move(g.x + g.width - 4, g.y + g.height / 2, { steps: 110 });
await wait(400);
await page.mouse.up();
await wait(1400);
await ctx.close();
await browser.close();
const f = (await readdir('shots/clip')).filter((n) => n.endsWith('.webm')).sort().pop();
await rename(`shots/clip/${f}`, 'shots/showcase.webm');
try { execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', 'shots/showcase.webm', '-vf', 'fps=30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', 'shots/showcase.mp4']); console.log('shots/showcase.mp4'); } catch { console.log('shots/showcase.webm (no ffmpeg)'); }
