// A picture of the whole kit as it stands, to climb from and to compare a round against.
//   PORT=5989 node tools/baseline.mjs <name> [--page showcase/]
// Writes shots/<name>/: the page walked a screen at a time (day and night, 1280 and 390 wide),
// every part in the states a hand can put it in (hover, pressed, focused, open), and index.html,
// which lays them all out. Two names side by side are a before and an after:
//   PORT=5989 node tools/baseline.mjs --compare <before> <after>   writes shots/<after>/compare.html
// Motion is not here: tools/film.mjs films it.
import { chromium } from 'playwright';
import { mkdir, readdir, writeFile } from 'node:fs/promises';

const args = process.argv.slice(2);
const port = process.env.PORT || 5985;
const flag = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : args[i + 1]; };

if (args[0] === '--compare') {
  const [, a, b] = args;
  const [before, after] = await Promise.all([a, b].map(async name =>
    new Set((await readdir(`shots/${name}`)).filter(f => f.endsWith('.png')))));
  const files = [...new Set([...before, ...after])].sort();
  const shot = (set, path, name, file) => set.has(file)
    ? `<img src="${path}${file}" loading="lazy" alt="${name}">`
    : `<span>No capture in ${name}</span>`;
  const rows = files.map(f => `<figure><figcaption>${f.replace('.png', '')}</figcaption><div>${shot(before, '../' + a + '/', a, f)}${shot(after, '', b, f)}</div></figure>`).join('\n');
  await writeFile(`shots/${b}/compare.html`, page(`${a} against ${b}`, `<p>Left: ${a}. Right: ${b}.</p>${rows}`, 'figure div { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }'));
  console.log(`shots/${b}/compare.html`);
  process.exit(0);
}

const name = args[0] && !args[0].startsWith('--') ? args[0] : 'baseline';
const path = flag('page', 'showcase/principles.html');
const dir = `shots/${name}`;
await mkdir(dir, { recursive: true });

const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
const made = [];
const problems = [];

async function open(w, h, dark) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, colorScheme: dark ? 'dark' : 'light' });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => problems.push(String(e)));
  await p.goto(`http://127.0.0.1:${port}/kit/${path}`);
  await p.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 8000 }).catch(() => problems.push('never became ready'));
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(700);
  return { ctx, p };
}

// ----- the page, a screen at a time. A part off screen is not drawn, so the page is walked, not stitched.
for (const [w, h, size] of [[1280, 900, 'desktop'], [390, 844, 'phone']]) {
  for (const dark of [false, true]) {
    const { ctx, p } = await open(w, h, dark);
    const total = await p.evaluate(() => document.documentElement.scrollHeight);
    const step = h - 80; // a little overlap, so nothing is cut between two screens
    let i = 0;
    for (let y = 0; y < total - 80; y += step, i++) {
      await p.evaluate((yy) => scrollTo(0, yy), y);
      await p.waitForTimeout(450);
      const file = `page-${size}-${dark ? 'night' : 'day'}-${String(i).padStart(2, '0')}.png`;
      await p.screenshot({ path: `${dir}/${file}` });
      made.push(file);
    }
    await ctx.close();
  }
}

// ----- every part in the states a hand can put it in
const STATES = [
  ['button', '#kit .vx-button:not([disabled])', ['rest', 'hover', 'press', 'focus']],
  ['button-chalk', '#kit .vx-button[data-vx-material="chalk"]', ['rest', 'hover', 'press']],
  ['button-brick', '#kit .vx-button[data-vx-material="brick"]', ['rest', 'press']],
  ['button-off', '#kit .vx-button[disabled]', ['rest']],
  ['switch-on', '#kit .vx-toggle:nth-of-type(1)', ['rest', 'focus']],
  ['switch-off', '#kit .vx-toggle:nth-of-type(2)', ['rest', 'press']],
  ['slider', '#kit .vx-slider', ['rest', 'press', 'focus']],
  ['meter', '#kit .vx-meter', ['rest']],
  ['field', '#kit .vx-field:nth-of-type(1) .vx-well', ['rest', 'focus']],
  ['textarea', '#kit .vx-field:nth-of-type(2) .vx-well', ['rest', 'focus']],
  ['list', '#kit .vx-list', ['rest', 'hover']],
  ['tabs', '#kit .vx-tabs', ['rest', 'hover', 'focus']],
  ['card', '#build-card', ['rest']],
];
const PAD = 36;
for (const dark of [false, true]) {
  const { ctx, p } = await open(1280, 900, dark);
  const tone = dark ? 'night' : 'day';
  const snap = async (el, file, pad = PAD) => {
    const b = await el.boundingBox();
    if (!b) { problems.push(`no box: ${file}`); return; }
    await p.screenshot({ path: `${dir}/${file}`, clip: { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: b.width + pad * 2, height: b.height + pad * 2 } });
    made.push(file);
  };
  for (const [part, sel, states] of STATES) {
    const el = p.locator(sel).first();
    if (!(await el.count())) { problems.push(`not on the page: ${part} (${sel})`); continue; }
    await el.evaluate((n) => scrollTo(0, n.getBoundingClientRect().top + scrollY - 300)); // a third of the way down the screen
    await p.waitForTimeout(350);
    for (const st of states) {
      const b = await el.boundingBox();
      const at = part === 'slider' ? [b.x + b.width * 0.58, b.y + b.height / 2] : part.startsWith('tabs') ? [b.x + b.width * 0.5, b.y + b.height / 2] : part === 'list' ? [b.x + b.width / 2, b.y + b.height * 0.5] : [b.x + Math.min(b.width / 2, 60), b.y + b.height / 2];
      await p.mouse.move(4, 4);
      await p.evaluate(() => document.activeElement?.blur?.());
      await p.waitForTimeout(260);
      if (st === 'hover') { await p.mouse.move(at[0], at[1]); await p.waitForTimeout(420); }
      if (st === 'press') { await p.mouse.move(at[0], at[1]); await p.mouse.down(); await p.waitForTimeout(480); }
      if (st === 'focus') { await el.evaluate((n) => (n.matches('button, input, textarea, [tabindex]') ? n : n.querySelector('button, input, textarea, a, [role="tab"][aria-selected="true"]'))?.focus({ focusVisible: true })); await p.waitForTimeout(420); }
      await snap(el, `part-${tone}-${part}-${st}.png`);
      if (st === 'press') { await p.mouse.up(); await p.waitForTimeout(350); }
    }
  }
  // things that open
  await p.mouse.move(4, 4);
  await p.click('[popovertarget="plant-menu"]');
  await p.waitForTimeout(700);
  await p.hover('#plant-menu [role^="menuitem"]:nth-of-type(2)').catch(() => {});
  await p.waitForTimeout(300);
  await snap(p.locator('#plant-menu'), `part-${tone}-menu-open.png`, 72);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(500);
  await p.click('#open-dialog');
  await p.waitForTimeout(1100);
  await snap(p.locator('#dlg'), `part-${tone}-dialog-open.png`, 72);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(700);
  await p.click('#toast-done');
  await p.waitForTimeout(800);
  await snap(p.locator('.vx-toasts .vx-toast').first(), `part-${tone}-toast.png`, 48);
  await ctx.close();
}
await browser.close();

function page(title, body, extra = '') {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<style>
  html { background: #15171c; color: #e8e9ee; font: 15px/1.5 ui-sans-serif, system-ui, sans-serif; }
  body { margin: 0 auto; max-width: 1500px; padding: 24px 16px 96px; }
  h1 { font-size: 1.4rem; margin: 0 0 4px; } h2 { font-size: 1.05rem; margin: 40px 0 12px; }
  p { margin: 0 0 16px; color: #a9adba; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; align-items: start; }
  .wide { grid-template-columns: repeat(auto-fill, minmax(420px, 1fr)); }
  .narrow { grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); }
  figure { margin: 0; } figcaption { font-size: 12px; color: #a9adba; margin-bottom: 4px; }
  img { display: block; max-width: 100%; height: auto; }
  ${extra}
</style><h1>${title}</h1>${body}</html>`;
}
const fig = (f) => `<figure><figcaption>${f.replace('.png', '')}</figcaption><a href="${f}"><img src="${f}" loading="lazy" alt=""></a></figure>`;
const group = (title, test, cls) => { const fs = made.filter(test); return fs.length ? `<h2>${title}</h2><div class="grid ${cls}">${fs.map(fig).join('')}</div>` : ''; };
const body = `<p>${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC, ${path}, ${made.length} pictures. Motion is filmed separately (tools/film.mjs).</p>`
  + group('Parts and their states, day', (f) => f.startsWith('part-day'), '')
  + group('Parts and their states, night', (f) => f.startsWith('part-night'), '')
  + group('The page at 1280, day', (f) => f.startsWith('page-desktop-day'), 'wide')
  + group('The page at 1280, night', (f) => f.startsWith('page-desktop-night'), 'wide')
  + group('The page at 390, day', (f) => f.startsWith('page-phone-day'), 'narrow')
  + group('The page at 390, night', (f) => f.startsWith('page-phone-night'), 'narrow');
await writeFile(`${dir}/index.html`, page(`Voxelmorphism: ${name}`, body));
if (problems.length) console.log('problems:\n  ' + [...new Set(problems)].join('\n  '));
console.log(`${dir}/index.html  (${made.length} pictures)`);
