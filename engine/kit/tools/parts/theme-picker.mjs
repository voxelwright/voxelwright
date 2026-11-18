// A person on the theme picker's page: a real mouse presses seats, real keys move the choice,
// the system changes its mind, the page is loaded again, and another tab of the site is open.
// Run in voxels and plain, then on a phone. Says ok or FAIL for each thing that must hold.
//   PORT=5989 node tools/parts/theme-picker.mjs
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const port = process.env.PORT || 5989;
const url = `http://127.0.0.1:${port}/showcase/parts/theme-picker.html?theme=light`;
await mkdir('shots/parts/theme-picker', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
let bad = 0;
const say = (ok, what) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); };

async function context({ width = 1180, plain = false, scheme = 'light' } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1, colorScheme: scheme });
  if (plain) await ctx.addInitScript(() => { new MutationObserver((_, o) => { if (document.documentElement) { document.documentElement.setAttribute('data-vx-plain', ''); o.disconnect(); } }).observe(document, { childList: true }); });
  return ctx;
}
async function open(ctx) {
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') p.errors.push(m.text()); });
  await p.goto(url);
  await settle(p);
  return p;
}
async function settle(p) {
  await p.waitForFunction(() => document.documentElement.dataset.ready === '1');
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(600);
}
const press = async (p, sel) => { const l = p.locator(sel).first(); await l.scrollIntoViewIfNeeded(); const b = await l.boundingBox(); await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 }); await p.mouse.down(); await p.waitForTimeout(80); await p.mouse.up(); await p.waitForTimeout(450); };
const seat = (picker, bank, value) => `${picker} [data-vx-pick="${bank}"] label:has(input[value="${value}"])`;
// what the page is, read from everything a choice is written to
const state = (p) => p.evaluate(async () => {
  const d = document.documentElement, kit = await import('/packages/voxelmorphism/src/index.js');
  const chosen = (sel, bank) => [...document.querySelectorAll(`${sel} [data-vx-pick="${bank}"] input`)].filter((r) => r.checked).map((r) => r.value).join(',');
  let kept = {}; try { kept = JSON.parse(localStorage.getItem('vx-theme')) || {}; } catch {}
  return {
    theme: d.dataset.vxTheme ?? null, time: d.getAttribute('data-theme'), night: getComputedStyle(d).getPropertyValue('--vx-theme').trim() === 'night',
    accent: d.style.getPropertyValue('--lit-accent-day'), drawn: kit.MATERIALS.light.hex.day, want: Object.fromEntries(Object.entries(kit.THEMES).map(([k, t]) => [k, t.light.day])),
    kept, heard: window.heard.at(-1) ?? null, heardCount: window.heard.length,
    header: [chosen('#picker', 'theme'), chosen('#picker', 'time')], settings: [chosen('#settings', 'theme'), chosen('#settings', 'time')], written: [chosen('#written', 'theme'), chosen('#written', 'time')],
  };
});
// the trench's key is on the seat that is chosen (read from the toggle group's own state, where it has one)
const keyed = (p) => p.evaluate(() => [...document.querySelectorAll('.vx-theme-picker .vx-toggle-group')].map((g) => {
  const l = window.vx?.live(g), at = [...g.querySelectorAll(':scope > label > input')].findIndex((r) => r.checked);
  return !l || l.state.index === undefined || l.state.index === at;
}).every(Boolean));

for (const plain of [false, true]) {
  const tag = plain ? 'plain' : 'voxels';
  const ctx = await context({ plain });
  const p = await open(ctx);
  let s = await state(p);
  const names = Object.keys(s.want);

  const banks = await p.evaluate(() => [...document.querySelectorAll('[data-vx-pick="theme"]')].map((b) => [...b.querySelectorAll('input')].map((r) => r.value).join(' ')));
  say(banks.length === 4 && banks.every((b) => b.split(' ').sort().join() === [...names].sort().join()), `${tag}: every theme bank has a seat for each of THEMES, the site's own Tide among them: ${banks[0]}`);
  const lamps = await p.evaluate(() => { const all = [...document.querySelectorAll('.vx-theme-lamp')]; return [all.length, all.filter((l) => l.hasAttribute('data-vx-live')).length, document.querySelectorAll('[data-vx-pick="theme"] label').length]; });
  say(lamps[0] === lamps[2] && lamps[1] === (plain ? 0 : lamps[0]), `${tag}: each seat has its lamp${plain ? ', painted' : ', drawn in voxels'} (${lamps[0]} lamps for ${lamps[2]} seats, ${lamps[1]} in voxels)`);
  const colours = await p.evaluate(() => [...document.querySelectorAll('#picker .vx-theme-lamp')].map((l) => l.style.getPropertyValue('--_day')));
  say(colours.join() === names.map((n) => s.want[n]).join(), `${tag}: a lamp carries its own theme's accent: ${colours.join(' ')}`);
  say(s.header.join() === 'bay,light' && s.settings.join() === 'bay,light' && s.written.join() === 'bay,light', `${tag}: with nothing remembered it shows what holds: Bay, by day (${s.header.join(', ')})`);
  say(s.heardCount === 0, `${tag}: and the page is told nothing, for nothing changed`);
  say(await p.evaluate(() => [...document.querySelectorAll('.vx-theme-picker')].every((el) => getComputedStyle(el).visibility === 'visible')), `${tag}: every picker is shown once it can choose`);

  // a real press on a theme
  await press(p, seat('#picker', 'theme', 'rose'));
  s = await state(p);
  say(s.theme === 'rose' && s.accent === s.want.rose, `${tag}: a press on Rose: <html> has data-vx-theme="rose" and the stylesheet's accent is Rose's (${s.accent})`);
  say(s.drawn === s.want.rose, `${tag}: and the kit's theme() was called: the look's light is Rose's (${s.drawn})`);
  say(s.heard?.theme === 'rose' && s.heard.time === 'light' && s.heard.night === false && s.heardCount === 1, `${tag}: the page hears vx-theme once: ${JSON.stringify(s.heard)}`);
  say(s.kept.theme === 'rose' && s.kept.time === 'light' && s.kept.vars?.['--lit-accent-day'] === s.want.rose, `${tag}: it is remembered, with its tokens (${Object.keys(s.kept.vars ?? {}).length} of them)`);
  say(s.settings[0] === 'rose' && s.written[0] === 'rose', `${tag}: the other pickers on the page follow (${s.settings[0]}, ${s.written[0]})`);
  if (!plain) say(await keyed(p), `${tag}: and in every bank the key is on the chosen seat`);

  // the site's own theme
  await press(p, seat('#settings', 'theme', 'tide'));
  s = await state(p);
  say(s.theme === 'tide' && s.accent === s.want.tide && s.drawn === s.want.tide && s.header[0] === 'tide', `${tag}: a press on Tide in the settings picker: the site's own theme holds, and the header follows (${s.accent})`);
  await p.locator('#picker').screenshot({ path: `shots/parts/theme-picker/hand-${tag}-tide.png` });

  // the time of day
  await press(p, seat('#picker', 'time', 'dark'));
  s = await state(p);
  say(s.time === 'dark' && s.night && s.heard?.night === true && s.heard.time === 'dark' && s.kept.time === 'dark', `${tag}: a press on Night: data-theme="dark", it is night, the page is told and it is remembered`);
  say(s.theme === 'tide' && s.settings[1] === 'dark', `${tag}: the theme stays as it was, and the settings picker shows Night`);
  await p.locator('.site').screenshot({ path: `shots/parts/theme-picker/hand-${tag}-night-tide.png` });
  await press(p, seat('#picker', 'time', 'system'));
  s = await state(p);
  say(s.time === null && !s.night && s.heard?.time === 'system' && s.kept.time === 'system', `${tag}: a press on System: the attribute is gone, and the page is as the system has it (day)`);
  const before = s.heardCount;
  await p.emulateMedia({ colorScheme: 'dark' });
  await p.waitForTimeout(400);
  s = await state(p);
  say(s.time === null && s.night && s.heard?.night === true && s.heard.time === 'system' && s.heardCount === before + 1, `${tag}: the system goes dark: the page follows, and is told once (${JSON.stringify(s.heard)})`);
  await p.emulateMedia({ colorScheme: 'light' });
  await p.waitForTimeout(300);
  await press(p, seat('#picker', 'time', 'light'));
  const told = (await state(p)).heardCount;
  await p.emulateMedia({ colorScheme: 'dark' });
  await p.waitForTimeout(300);
  s = await state(p);
  say(!s.night && s.heardCount === told, `${tag}: with Day chosen the system going dark changes nothing, and nothing is told`);
  await p.emulateMedia({ colorScheme: 'light' });

  // keys: one tab stop a bank, arrows move the choice
  await p.locator('#picker [data-vx-pick="theme"] input:checked').focus();
  await p.keyboard.press('ArrowLeft');
  await p.waitForTimeout(400);
  s = await state(p);
  say(s.theme === names[names.indexOf('tide') - 1], `${tag}: Arrow Left moves the choice to the theme before (${s.theme})`);
  await p.keyboard.press('ArrowRight');
  await p.waitForTimeout(400);
  s = await state(p);
  say(s.theme === 'tide' && s.accent === s.want.tide, `${tag}: Arrow Right moves it back (${s.theme})`);
  const ring = await p.evaluate(() => { const l = document.activeElement.closest('label'), cs = getComputedStyle(l); return document.activeElement.matches(':focus-visible') && cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2; });
  say(ring, `${tag}: the seat in focus shows a ring`);
  await p.keyboard.press('Tab');
  const next = await p.evaluate(() => [document.activeElement.closest('[data-vx-pick]')?.dataset.vxPick, document.activeElement.value, document.activeElement.closest('.vx-theme-picker')?.id]);
  say(next.join() === 'time,light,picker', `${tag}: Tab leaves the theme bank for the time bank's chosen seat: one tab stop a bank (${next.join(' ')})`);
  await p.keyboard.press('ArrowRight');
  await p.waitForTimeout(400);
  s = await state(p);
  say(s.time === 'dark' && s.night, `${tag}: Arrow Right there makes it night`);

  // from code
  await p.evaluate(async () => { const { pick } = await import('/packages/voxelmorphism/src/components/theme-picker.js'); await pick({ theme: 'dusk', time: 'light' }); });
  await p.waitForTimeout(400);
  s = await state(p);
  say(s.theme === 'dusk' && s.time === 'light' && s.header.join() === 'dusk,light' && s.written.join() === 'dusk,light' && s.kept.theme === 'dusk', `${tag}: pick({ theme: 'dusk', time: 'light' }) from code: every picker shows it, and it is remembered`);
  if (!plain) say(await keyed(p), `${tag}: and the keys are on the chosen seats`);

  // loaded again: it is there before any module runs
  await press(p, seat('#picker', 'theme', 'rose'));
  await press(p, seat('#picker', 'time', 'dark'));
  await p.reload();
  await settle(p);
  const early = await p.evaluate(() => window.early);
  s = await state(p);
  say(early.theme === 'rose' && early.time === 'dark' && early.accent === s.want.rose, `${tag}: loaded again: before any module ran <html> already had Rose, night and Rose's accent (${JSON.stringify(early)})`);
  say(s.header.join() === 'rose,dark' && s.settings.join() === 'rose,dark' && s.drawn === s.want.rose && s.night, `${tag}: and then the seats show it, and the voxels' own light is Rose's`);
  say(s.heardCount === 0, `${tag}: with nothing told: nothing changed after the first paint`);
  if (!plain) say(await keyed(p), `${tag}: the keys are on the chosen seats`);
  await p.screenshot({ path: `shots/parts/theme-picker/hand-${tag}-again.png` });

  // another tab of the site
  const q = await open(ctx);
  await press(q, seat('#picker', 'theme', 'bay'));
  await press(q, seat('#picker', 'time', 'light'));
  await p.waitForTimeout(500);
  s = await state(p);
  say(s.theme === 'bay' && s.time === 'light' && s.header.join() === 'bay,light' && s.drawn === s.want.bay && s.heard?.theme === 'bay', `${tag}: chosen in another tab: this tab follows, and its page is told (${s.header.join(', ')})`);
  say(q.errors.length === 0, `${tag}: the other tab has no errors` + (q.errors.length ? ': ' + [...new Set(q.errors)].join(' | ') : ''));
  await q.close();

  // a theme that was remembered and is no longer the site's
  await p.evaluate(() => localStorage.setItem('vx-theme', JSON.stringify({ time: 'system', theme: 'moss', vars: { '--lit-accent-day': '#00aa00' } })));
  await p.reload();
  await settle(p);
  s = await state(p);
  say(s.theme === 'bay' && s.accent === s.want.bay && s.header[0] === 'bay' && s.kept.theme === 'bay', `${tag}: a remembered theme the site no longer has: back to the kit's own (${s.theme}, ${s.accent})`);

  // the early script on the page is the one the part gives
  const same = await p.evaluate(async () => { const { EARLY } = await import('/packages/voxelmorphism/src/components/theme-picker.js'); return [document.head.querySelector('script').textContent === EARLY, EARLY.length]; });
  say(same[0] && same[1] < 500, `${tag}: the script in the page's head is the part's EARLY, ${same[1]} bytes`);

  const small = await p.evaluate(() => [...document.querySelectorAll('.vx-theme-picker label')].map((l) => l.getBoundingClientRect()).filter((r) => r.width < 44 || r.height < 44).length);
  say(small === 0, `${tag}: every seat is at least 44 px each way (${small} smaller)`);
  say(p.errors.length === 0, `${tag}: no errors` + (p.errors.length ? ': ' + [...new Set(p.errors)].join(' | ') : ''));
  await ctx.close();
}

// the system is dark, and nothing was ever chosen: with or without the script the page is dark
{
  const ctx = await context({ scheme: 'dark' });
  const p = await ctx.newPage();
  await p.goto(url.replace('?theme=light', ''));
  await settle(p);
  const s = await state(p);
  say(s.time === null && s.night && s.header[1] === 'system', `nothing chosen, a dark system: the page is dark and the bank says System (${s.header.join(', ')})`);
  await ctx.close();
  const none = await browser.newContext({ viewport: { width: 1180, height: 900 }, colorScheme: 'dark', javaScriptEnabled: false });
  const n = await none.newPage();
  await n.goto(url.replace('?theme=light', ''));
  const off = await n.locator('html').evaluate((d) => [getComputedStyle(d).getPropertyValue('--vx-theme').trim(), getComputedStyle(document.querySelector('.vx-theme-picker')).visibility]).catch(() => null);
  say(off === null || (off[0] === 'night' && off[1] === 'hidden'), off === null ? 'no script: could not be read without script' : `no script: the page still follows the system (${off[0]}), and the picker, which could do nothing, is not shown (${off[1]})`);
  await none.close();
}

// a phone
for (const plain of [false, true]) {
  const tag = plain ? 'phone, plain' : 'phone, voxels';
  const ctx = await context({ width: 390, plain });
  const p = await open(ctx);
  const out = await p.evaluate(() => {
    const sheet = document.querySelector('.sheet'), cs = getComputedStyle(sheet), r = sheet.getBoundingClientRect();
    const lo = r.left + parseFloat(cs.paddingLeft) - 0.5, hi = r.right - parseFloat(cs.paddingRight) + 0.5, out = [];
    for (const part of document.querySelectorAll('.vx-theme-picker')) for (const el of [part, ...part.querySelectorAll('*')]) {
      if (el.matches('.vx-canvas, input') || !el.getClientRects().length) continue;
      const b = el.getBoundingClientRect();
      if (b.width && (b.left < lo || b.right > hi)) out.push(`${el.tagName.toLowerCase()}.${el.className} ${Math.round(b.left)}..${Math.round(b.right)} past ${Math.round(lo)}..${Math.round(hi)}`);
    }
    if (document.documentElement.scrollWidth > innerWidth) out.push(`the page is ${document.documentElement.scrollWidth} px wide in a ${innerWidth} px window`);
    return out;
  });
  say(out.length === 0, `${tag}: nothing reaches past the sheet${out.length ? ': ' + out.slice(0, 4).join('; ') : ''}`);
  const broken = await p.evaluate(() => [...document.querySelectorAll('[data-vx-pick="theme"] .vx-label')].filter((l) => l.getClientRects().length > 1 || l.getBoundingClientRect().height > 30).map((l) => l.textContent));
  say(broken.length === 0, `${tag}: no theme's name is broken over two lines${broken.length ? ': ' + broken.join(', ') : ''}`);
  const inside = await p.evaluate(() => [...document.querySelectorAll('[data-vx-pick="theme"] label')].filter((seat) => { const s = seat.getBoundingClientRect(), l = seat.querySelector('.vx-label').getBoundingClientRect(); return l.left < s.left || l.right > s.right; }).length);
  say(inside === 0, `${tag}: every name is inside its own seat (${inside} are not)`);
  await press(p, seat('#written', 'theme', 'dusk'));
  const s = await state(p);
  say(s.theme === 'dusk' && s.header[0] === 'dusk', `${tag}: a press on Сутінки sets Dusk`);
  if (!plain) say(await keyed(p), `${tag}: and the keys are on the chosen seats`);
  await p.screenshot({ path: `shots/parts/theme-picker/hand-${plain ? 'plain' : 'voxels'}-phone.png` });
  say(p.errors.length === 0, `${tag}: no errors` + (p.errors.length ? ': ' + [...new Set(p.errors)].join(' | ') : ''));
  await ctx.close();
}

await browser.close();
console.log(bad ? `${bad} to fix` : 'ok: theme-picker');
process.exit(bad ? 1 : 0);
