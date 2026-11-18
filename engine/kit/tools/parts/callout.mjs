// A person on the callout page: the key in a callout is pressed with a real mouse and with real
// keys, the page's script changes its kind, and the groove must follow. In voxels and plain, then a phone.
//   PORT=5989 node tools/parts/callout.mjs
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const port = process.env.PORT || 5989;
await mkdir('shots/parts/callout', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
let bad = 0;
const say = (ok, what) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); };

async function open({ width = 1180, plain = false, reduced = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') p.errors.push(m.text()); });
  if (plain) await p.addInitScript(() => { new MutationObserver((_, o) => { if (document.documentElement) { document.documentElement.setAttribute('data-vx-plain', ''); o.disconnect(); } }).observe(document, { childList: true }); });
  await p.goto(`http://127.0.0.1:${port}/kit/showcase/parts/callout.html?theme=light`);
  await p.waitForFunction(() => document.documentElement.dataset.ready === '1');
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(600);
  return p;
}
const press = async (p, sel) => { await p.locator(sel).first().scrollIntoViewIfNeeded(); const b = await p.locator(sel).first().boundingBox(); await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 }); await p.mouse.down(); await p.waitForTimeout(80); await p.mouse.up(); };
const noErrors = (p, tag) => say(p.errors.length === 0, `${tag}: no errors` + (p.errors.length ? ': ' + [...new Set(p.errors)].join(' | ') : ''));
// everything of the part that reaches past the sheet's inner edge, or holds words wider than itself
const outside = (p, sel) => p.evaluate((sel) => {
  const sheet = document.querySelector('.sheet'), cs = getComputedStyle(sheet), r = sheet.getBoundingClientRect();
  const lo = r.left + parseFloat(cs.paddingLeft) - 0.5, hi = r.right - parseFloat(cs.paddingRight) + 0.5, out = [];
  for (const part of document.querySelectorAll(sel)) for (const el of [part, ...part.querySelectorAll('*')]) {
    if (el.matches('.vx-canvas, [class$="-aloud"]') || !el.getClientRects().length) continue;
    const b = el.getBoundingClientRect(), s = getComputedStyle(el);
    if (b.width && (b.left < lo || b.right > hi)) out.push(`${el.tagName.toLowerCase()}.${el.className} ${Math.round(b.left)}..${Math.round(b.right)} past ${Math.round(lo)}..${Math.round(hi)}`);
    // (a part's canvas reaches past its box on purpose, for shadow and light: that is not this)
    else if (s.overflowX === 'visible' && el.clientWidth && !el.querySelector('.vx-canvas') && el.scrollWidth > el.clientWidth + 1) out.push(`${el.tagName.toLowerCase()}.${el.className} holds ${el.scrollWidth} px in ${el.clientWidth}`);
  }
  if (document.documentElement.scrollWidth > innerWidth) out.push(`the page is ${document.documentElement.scrollWidth} px wide in a ${innerWidth} px window`);
  return out;
}, sel);
const fits = async (p, sel, tag) => { const out = await outside(p, sel); say(out.length === 0, `${tag}: nothing reaches past the sheet${out.length ? ': ' + out.slice(0, 4).join('; ') : ''}`); };

// the light the groove is drawn in (voxels) or painted in (plain)
const lightOf = (p, sel, plain) => p.evaluate(([sel, plain]) => { const el = document.querySelector(sel); return plain ? getComputedStyle(el, '::before').backgroundColor : window.vx.live(el).state.mat; }, [sel, plain]);

for (const plain of [false, true]) {
  const tag = plain ? 'plain' : 'voxels';
  const p = await open({ plain });
  say(await p.locator('.vx-callout[data-vx-live]').count() === (plain ? 0 : 7), `${tag}: ${plain ? 'no callout is drawn in voxels' : 'every callout has its groove in voxels'}`);
  const roles = await p.evaluate(() => [...document.querySelectorAll('.vx-callout')].map((c) => `${c.dataset.vxKind}:${c.getAttribute('role') ?? (c.tagName === 'ASIDE' && document.getElementById(c.getAttribute('aria-labelledby')) ? 'region' : 'none')}`));
  say(roles.filter((r) => r.startsWith('failed')).every((r) => r === 'failed:alert') && !roles.some((r) => r.endsWith(':alert') && !r.startsWith('failed')), `${tag}: a failure is role="alert" and nothing else is (${roles.join(' ')})`);
  const kinds = await p.evaluate((plain) => ['note', 'done', 'warning', 'failed'].map((k) => { const el = document.querySelector(`.kinds .vx-callout[data-vx-kind="${k}"]`); return plain ? getComputedStyle(el, '::before').backgroundColor : window.vx.live(el).state.mat; }), plain);
  say(new Set(kinds).size === 4, `${tag}: the four kinds have four lights (${kinds.join(', ')})`);
  if (!plain) {
    const g = await p.evaluate(() => { const el = document.querySelector('#failed'), l = window.vx.live(el); return [l.well.join(','), l.H, getComputedStyle(el).paddingLeft]; });
    say(g[0] === `0,0,1,${g[1]}`, `${tag}: the groove is one voxel wide at the start, the full height of the words (${g[0]} of ${g[1]})`);
  }
  const before = await lightOf(p, '#failed', plain);

  // keys: Tab reaches the key in the callout, Enter presses it
  await p.evaluate(() => { document.querySelector('#again').focus(); });
  say(await p.evaluate(() => document.activeElement.id === 'again'), `${tag}: the key in the callout takes focus`);
  await p.locator('#failed').screenshot({ path: `shots/parts/callout/hand-${tag}-failed.png` });
  await p.keyboard.press('Enter');
  await p.waitForTimeout(400);
  const after = await lightOf(p, '#failed', plain);
  say(await p.evaluate(() => document.querySelector('#failed').dataset.vxKind) === 'note' && after !== before, `${tag}: Enter on it: the page makes the callout a note, and the groove changes light (${before} to ${after})`);
  say(await p.evaluate(() => document.querySelector('#failed').getAttribute('role')) === 'status', `${tag}: and it is a status now, not an alert`);
  await p.locator('#failed').screenshot({ path: `shots/parts/callout/hand-${tag}-note.png` });
  if (!plain) {
    const g = await p.evaluate(() => { const el = document.querySelector('#failed'), l = window.vx.live(el); return [l.well[3], l.H, Math.round(el.offsetHeight / l.vx)]; });
    say(g[0] === g[1] && g[1] === g[2], `${tag}: the groove is as high as the callout now is (${g[0]} voxels of ${g[2]})`);
  }
  // from code, and right to left
  await p.evaluate(() => { const c = document.querySelector('.kinds .vx-callout[data-vx-kind="done"]'); c.id = 'was-done'; c.dataset.vxKind = 'failed'; });
  await p.waitForTimeout(200);
  say(await lightOf(p, '#was-done', plain) === kinds[3], `${tag}: data-vx-kind set from code is drawn (${await lightOf(p, '#was-done', plain)})`);
  await p.evaluate(() => document.querySelector('#was-done').setAttribute('dir', 'rtl'));
  await p.waitForTimeout(200);
  const rtl = await p.evaluate((plain) => { const el = document.querySelector('#was-done'); if (plain) return parseFloat(getComputedStyle(el, '::before').right); const l = window.vx.live(el); return (l.W - 1 - l.well[0]) * l.vx; }, plain);
  say(rtl === 0, `${tag}: right to left, the groove is at the right (${rtl} px from it)`);
  noErrors(p, tag);
  await p.context().close();
}

// a real mouse on the key
{
  const p = await open();
  await press(p, '#again');
  await p.waitForTimeout(400);
  say(await p.evaluate(() => document.querySelector('#failed').dataset.vxKind) === 'note' && await p.locator('#again').count() === 0, 'voxels: a real press on the key does the same');
  await p.context().close();
}

for (const plain of [false, true]) {
  const tag = plain ? 'phone, plain' : 'phone, voxels';
  const p = await open({ width: 390, plain });
  await fits(p, '.vx-callout', tag);
  noErrors(p, tag);
  await p.context().close();
}

await browser.close();
console.log(bad ? `${bad} to fix` : 'ok: callout');
process.exit(bad ? 1 : 0);
