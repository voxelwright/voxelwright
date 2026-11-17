// Pictures of the directions page, for a person and for reviewers.
//   PORT=5989 node tools/directions.mjs      writes shots/directions/ and its index.html
// The three columns side by side at 1400 wide and 1x (what a laptop shows), each column alone on
// a 390 px phone, by day and by night, and each column with a button held and a menu open.
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const port = process.env.PORT || 5985;
const LOOKS = ['today', 'chunky', 'paper'];
const dir = 'shots/directions';
await mkdir(dir, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
const made = [], problems = [];

async function open(query, w, h, scale) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: scale });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => problems.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
  await p.goto(`http://127.0.0.1:${port}/showcase/directions.html?${query}`);
  await p.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 9000 }).catch(() => problems.push('never became ready'));
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(800);
  return { ctx, p };
}
const save = async (p, name, opts = {}) => { await p.screenshot({ path: `${dir}/${name}.png`, ...opts }); made.push(name); };

for (const theme of ['light', 'dark']) {
  const tone = theme === 'light' ? 'day' : 'night';
  // side by side, at the size a laptop shows it
  { const { ctx, p } = await open(`theme=${theme}`, 1400, 1420, 1); await save(p, `wide-${tone}`); await ctx.close(); }
  // each column on a phone
  for (const look of LOOKS) {
    const { ctx, p } = await open(`theme=${theme}&look=${look}`, 390, 844, 2);
    const h = await p.evaluate(() => document.documentElement.scrollHeight);
    await p.setViewportSize({ width: 390, height: Math.min(h, 2400) });
    await p.waitForTimeout(700);
    await save(p, `phone-${tone}-${look}`);
    await ctx.close();
  }
  // a button held, and a menu open
  for (const look of LOOKS) {
    const { ctx, p } = await open(`theme=${theme}&look=${look}`, 460, 1500, 2);
    const col = p.locator(`#col-${look}`);
    const first = col.locator('.vx-button').first();
    const b = await first.boundingBox();
    const rowClip = { x: 0, y: Math.max(0, b.y - 36), width: 460, height: 190 };
    await save(p, `rest-${tone}-${look}`, { clip: rowClip });
    await p.mouse.move(b.x + 40, b.y + b.height / 2);
    await p.mouse.down();
    await p.waitForTimeout(450);
    await save(p, `press-${tone}-${look}`, { clip: rowClip });
    await p.mouse.up();
    await p.mouse.move(4, 4);
    await p.waitForTimeout(300);
    const trigger = col.locator('[popovertarget]');
    await trigger.scrollIntoViewIfNeeded();
    await trigger.click();
    await p.waitForTimeout(700);
    const menu = col.locator('.vx-menu');
    await menu.locator('[role^="menuitem"]').nth(1).hover();
    await p.waitForTimeout(300);
    const t = await trigger.boundingBox(), m = await menu.boundingBox();
    // the menu opens below its trigger, or above it when there is no room below
    const top = t && m ? Math.max(0, Math.min(t.y, m.y) - 28) : 0;
    if (t && m) await save(p, `menu-${tone}-${look}`, { clip: { x: 0, y: top, width: 460, height: Math.max(t.y + t.height, m.y + m.height) - top + 44 } });
    else problems.push(`no menu: ${look} ${tone}`);
    await ctx.close();
  }
}
await browser.close();

const fig = (f) => `<figure><figcaption>${f}</figcaption><a href="${f}.png"><img src="${f}.png" loading="lazy" alt=""></a></figure>`;
const group = (title, test, cls = '') => `<h2>${title}</h2><div class="grid ${cls}">${made.filter(test).map(fig).join('')}</div>`;
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Voxelmorphism: directions, in pictures</title>
<style>
  html { background: #15171c; color: #e8e9ee; font: 15px/1.5 ui-sans-serif, system-ui, sans-serif; }
  body { margin: 0 auto; max-width: 1500px; padding: 24px 16px 96px; }
  h1 { font-size: 1.4rem; margin: 0 0 4px; } h2 { font-size: 1.05rem; margin: 40px 0 12px; } p { margin: 0 0 16px; color: #a9adba; }
  .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; align-items: start; } .one { grid-template-columns: 1fr; }
  figure { margin: 0; } figcaption { font-size: 12px; color: #a9adba; margin-bottom: 4px; } img { display: block; max-width: 100%; height: auto; }
</style><h1>Three directions, in pictures</h1><p>${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC. Columns: today, chunky, paper. The live page is <a style="color:#9aa5ff" href="/showcase/directions.html">/showcase/directions.html</a>.</p>
${group('Side by side at 1400 wide, as a laptop shows it', (f) => f.startsWith('wide-'), 'one')}
${group('At rest and held, day', (f) => /^(rest|press)-day/.test(f))}
${group('At rest and held, night', (f) => /^(rest|press)-night/.test(f))}
${group('A menu open', (f) => f.startsWith('menu-'))}
${group('On a 390 px phone, day', (f) => f.startsWith('phone-day'))}
${group('On a 390 px phone, night', (f) => f.startsWith('phone-night'))}
</html>`;
await writeFile(`${dir}/index.html`, html);
if (problems.length) console.log('problems:\n  ' + [...new Set(problems)].join('\n  '));
console.log(`${dir}/index.html  (${made.length} pictures)`);
