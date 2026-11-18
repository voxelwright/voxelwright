// A person on the lit page: a real mouse comes in, presses things, changes the time and the theme,
// and leaves. Says ok or FAIL for each thing that must hold, and shoots the page under each theme.
//   PORT=5989 node tools/lit-hand.mjs
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const port = process.env.PORT || 5989;
await mkdir('shots/lit', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
const p = await (await browser.newContext({ viewport: { width: 1180, height: 900 }, deviceScaleFactor: 1 })).newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(String(e)));
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
let bad = 0;
const say = (ok, what) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); };
const mid = async (sel, fx = 0.5, fy = 0.5) => { const b = await p.locator(sel).first().boundingBox(); return [b.x + b.width * fx, b.y + b.height * fy]; };
const press = async (sel) => { const [x, y] = await mid(sel); await p.mouse.move(x, y, { steps: 8 }); await p.mouse.down(); await p.waitForTimeout(90); await p.mouse.up(); };

await p.goto(`http://127.0.0.1:${port}/showcase/lit.html?theme=light`);
await p.waitForFunction(() => document.documentElement.dataset.ready === '1' && window.lit);
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(1200);
say(await p.locator('#deploy .vx-cursor[data-on]').count() === 1, 'the story runs by itself: its pointer is shown');

// the time of day and the theme, by their own switches
await press('#time [data-value="dark"]');
await p.waitForTimeout(600);
say(await p.evaluate(() => document.documentElement.dataset.theme) === 'dark', 'pressing Night makes it night');
await p.screenshot({ path: 'shots/lit/hand-night-bay.png' });
for (const name of ['rose', 'dusk']) {
  await press(`#accent [data-value="${name}"]`);
  await p.waitForTimeout(700);
  say(await p.evaluate(() => document.documentElement.dataset.accent) === name, `pressing ${name} sets the theme`);
  await p.screenshot({ path: `shots/lit/hand-night-${name}.png` });
}
await press('#time [data-value="light"]');
await p.waitForTimeout(600);
await p.screenshot({ path: 'shots/lit/hand-day-dusk.png' });
await press('#accent [data-value="rose"]');
await p.waitForTimeout(600);
await p.screenshot({ path: 'shots/lit/hand-day-rose.png' });
await press('#accent [data-value=""]');
await p.waitForTimeout(600);
say(!(await p.evaluate(() => document.documentElement.dataset.accent)), 'pressing Bay goes back');

// a real pointer comes into the deploy panel
const [ax, ay] = await mid('#deploy .actions', 0.5, 0.5);
await p.mouse.move(ax, ay, { steps: 10 });
await p.waitForTimeout(300);
say(await p.locator('#deploy[data-own]').count() === 1, 'a real pointer takes the stage');
say(await p.evaluate(() => document.querySelector('#deploy .state-word').textContent) === 'Live' && await p.evaluate(() => document.querySelector('#deploy .build-num').textContent) === '100%', 'and the story is put back to rest');
const tip = await p.evaluate(() => { const s = document.querySelector('#deploy').getBoundingClientRect(), c = document.querySelector('#deploy .vx-cursor').getBoundingClientRect(); return [c.left, c.top, s.left, s.top]; });
say(Math.abs(tip[0] - ax) < 2 && Math.abs(tip[1] - ay) < 2, `the voxel pointer's tip is under the real one (${tip[0].toFixed(1)}, ${tip[1].toFixed(1)} for ${ax.toFixed(1)}, ${ay.toFixed(1)})`);
await press('#go');
await p.waitForTimeout(900);
say(await p.evaluate(() => document.querySelector('#deploy .state-word').textContent) === 'Building', 'pressing Deploy by hand starts a build');
await p.screenshot({ path: 'shots/lit/hand-building.png' });
await p.waitForTimeout(3600);
say(await p.locator('#deploy .vx-toast[data-shown]').count() === 1 && await p.evaluate(() => document.querySelector('#deploy .state-word').textContent) === 'Live', 'and it ends with the notice, and Live');
const was = await p.evaluate(() => document.querySelector('#deploy .auto input').checked);
await press('#deploy .vx-switch');
await p.waitForTimeout(400);
say(await p.evaluate(() => document.querySelector('#deploy .auto input').checked) !== was, 'the switch flips under a real press');

// the blog: an empty address, then a good one
await p.locator('#blog').scrollIntoViewIfNeeded();
await p.waitForTimeout(500);
await press('#sub');
await p.waitForTimeout(500);
say(await p.evaluate(() => document.querySelector('#mail').getAttribute('aria-invalid')) === 'true', 'Subscribe with no address marks the field');
await p.screenshot({ path: 'shots/lit/hand-invalid.png' });
await p.keyboard.type('mina@saltmarsh.dev', { delay: 20 });
say(await p.evaluate(() => document.querySelector('#mail').getAttribute('aria-invalid')) === null, 'typing clears the mark');
await press('#sub');
await p.waitForTimeout(500);
say(await p.evaluate(() => document.querySelector('.sub-word').textContent) === 'Subscribed', 'a good address: the key says Subscribed');
await p.screenshot({ path: 'shots/lit/hand-subscribed.png' });

// leaving gives the stage back
await p.mouse.move(4, 4, { steps: 6 });
await p.waitForTimeout(3600);
say(await p.locator('#blog[data-own]').count() === 0 && await p.locator('#blog .vx-cursor[data-on]').count() === 1, 'when the pointer leaves, the story takes the stage back');
say(errors.length === 0, 'no errors' + (errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''));
await browser.close();
process.exit(bad ? 1 : 0);
