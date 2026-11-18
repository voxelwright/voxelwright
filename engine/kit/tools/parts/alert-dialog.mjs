// The alert dialog under a real mouse and real keys: the kit's dialog, asking before something
// is destroyed. Modal, answered only by its keys or Escape; the focus starts on the key that
// destroys nothing; the key that destroys is on a red light.
//   PORT=5989 node tools/parts/alert-dialog.mjs
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const port = process.env.PORT || 5989;
const url = `http://127.0.0.1:${port}/kit/showcase/parts/alert-dialog.html`;
await mkdir('shots/parts/alert-dialog', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
const errors = [];
let bad = 0;
const say = (ok, what) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); };
async function open(opts = {}, query = '?theme=light', plain = false) {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 800 }, deviceScaleFactor: 1, ...opts });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  if (plain) await p.addInitScript(() => { new MutationObserver((_, o) => { if (document.documentElement) { document.documentElement.setAttribute('data-vx-plain', ''); o.disconnect(); } }).observe(document, { childList: true }); });
  await p.goto(url + query);
  await p.waitForFunction(() => document.documentElement.dataset.ready === '1');
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(700);
  return p;
}
const mid = async (p, sel) => { const b = await p.locator(sel).first().boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
const press = async (p, sel) => { await p.locator(sel).first().scrollIntoViewIfNeeded(); const [x, y] = await mid(p, sel); await p.mouse.move(x, y, { steps: 5 }); await p.mouse.down(); await p.waitForTimeout(60); await p.mouse.up(); };
const read = (p, id) => p.evaluate(async (id) => {
  const el = document.getElementById(id), l = window.vx?.live?.(el);
  let made = null;
  if (l) {
    const { MATERIALS } = await import('/kit/src/index.js');
    const name = (i) => Object.keys(MATERIALS).find((k) => MATERIALS[k].id === i);
    const of = (q) => (q ? [...new Set(q.mats)].map(name).sort().join('+') : 'none');
    const keys = [...el.querySelectorAll('footer .vx-button')].map((k) => { const kl = window.vx.live(k); return { word: k.textContent.trim(), light: of(kl?.model.byName.light), cap: of(kl?.model.byName.cap) }; });
    made = { part: l.def.name, panel: of(l.model.byName.panel), top: l.faceZ, dialog: l.look.dialog, fx: l.model.byName.panel?.fx?.kind ?? null, keys };
  }
  const a = document.activeElement, r = el.getBoundingClientRect();
  return {
    open: el.open, modal: el.matches(':modal'), value: el.returnValue, role: el.getAttribute('role'), named: !!document.getElementById(el.getAttribute('aria-labelledby'))?.textContent.trim(), told: !!document.getElementById(el.getAttribute('aria-describedby'))?.textContent.trim(),
    left: r.left, right: r.right, top: r.top, bottom: r.bottom,
    focus: a === document.body || a === document.documentElement ? a.tagName : a.id || a.textContent.trim().slice(0, 24) || a.tagName, inside: el.contains(a), made,
  };
}, id);
const result = (p) => p.evaluate(() => document.getElementById('result').textContent);
const gone = (p) => p.waitForTimeout(700);

// ---------------------------------------------------------------------------------------------
let p = await open();
let d = await read(p, 'still');
say(d.made.part === 'dialog' && d.made.panel === 'chalk+light' && d.made.top === d.made.dialog, `it is the kit's dialog: drawn by the dialog part, a float ${d.made.top} voxels high on its light (${d.made.panel})`);
say(d.made.keys[0].light === 'light' && d.made.keys[1].light === 'light-stop' && d.made.keys.every((k) => k.cap === 'key'), `its keys: "${d.made.keys[0].word}" on the accent's light, "${d.made.keys[1].word}" an ordinary cap on a red light (${d.made.keys.map((k) => k.cap + '/' + k.light).join(', ')})`);

await press(p, '#open-delete'); await p.waitForTimeout(80);
d = await read(p, 'delete');
say(d.open && d.modal && d.role === 'alertdialog' && d.named && d.told, 'Delete project opens it: modal, role alertdialog, named by its header and described by its words');
say(d.made.fx === 'assemble', 'it is built as it opens');
say(d.focus === 'Keep it', `the focus starts on the key that destroys nothing (${d.focus})`);
await p.waitForTimeout(600);
await p.screenshot({ path: 'shots/parts/alert-dialog/hand-open-day.png' });
// a press outside does nothing: it must be answered
await p.mouse.click(40, 40); await p.waitForTimeout(400);
d = await read(p, 'delete');
say(d.open && d.inside, 'a press outside it does nothing: it is still open, the focus still inside');
const stops = [];
for (let i = 0; i < 4; i++) { await p.keyboard.press('Tab'); const r = await read(p, 'delete'); stops.push(r.inside ? r.focus : 'OUT:' + r.focus); }
say(!stops.some((s) => s.startsWith('OUT:') && !/^OUT:(BODY|HTML)$/.test(s)) && stops.includes('Delete harbor-api'), `Tab goes between its keys and never reaches the page (${stops.join(', ')})`);
await p.keyboard.press('Escape'); await p.waitForTimeout(60);
d = await read(p, 'delete');
say(d.open && d.made.fx === 'lower', 'Escape: the plate lowers first');
await gone(p);
d = await read(p, 'delete');
say(!d.open && d.value === 'cancel' && d.focus === 'open-delete' && await result(p) === 'Nothing deleted', `then it is closed with "cancel", nothing is deleted, the focus is back on Delete project (${d.focus})`);
// Enter at once answers "no"
await p.keyboard.press('Enter'); await p.waitForTimeout(500);
d = await read(p, 'delete');
say(d.open && d.focus === 'Keep it', 'Enter on Delete project opens it again, on Keep it');
await p.keyboard.press('Enter'); await gone(p);
d = await read(p, 'delete');
say(!d.open && d.value === 'cancel' && await result(p) === 'Nothing deleted', 'Enter straight away keeps it: the hasty answer destroys nothing');
// the danger key
await press(p, '#open-delete'); await p.waitForTimeout(600);
await press(p, '#delete [data-vx-kind="danger"]'); await p.waitForTimeout(60);
d = await read(p, 'delete');
say(d.made.fx === 'lower', 'a press on Delete harbor-api: the plate lowers');
await gone(p);
d = await read(p, 'delete');
say(!d.open && d.value === 'delete' && await result(p) === 'harbor-api deleted' && d.focus === 'open-delete', 'and closes with "delete"; the page heard it');
// another, from a key in a row
await press(p, '#open-revoke'); await p.waitForTimeout(600);
d = await read(p, 'revoke');
say(d.open && d.focus === 'Cancel', 'Remove on Ada\'s row opens its own, on Cancel');
await press(p, '#revoke [data-vx-close="cancel"]'); await gone(p);
d = await read(p, 'revoke');
say(!d.open && d.value === 'cancel' && d.focus === 'open-revoke', 'Cancel closes it; the focus is back on Remove');
await p.close();

// night
p = await open({}, '?theme=dark');
await press(p, '#open-delete'); await p.waitForTimeout(700);
await p.screenshot({ path: 'shots/parts/alert-dialog/hand-open-night.png' });
await p.close();

// a phone
p = await open({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2 });
await press(p, '#open-delete'); await p.waitForTimeout(700);
d = await read(p, 'delete');
const cut = await p.evaluate(() => [...document.querySelectorAll('#delete :is(header, p, button)')].filter((n) => { const r = n.getBoundingClientRect(); return r.width && (r.left < 0 || r.right > innerWidth + 0.5); }).length);
const order = await p.evaluate(() => { const [a, b] = document.querySelectorAll('#delete footer .vx-button'); const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(); return rb.top > ra.top + 1 || rb.left > ra.left; });
say(d.open && d.left >= 12 && d.right <= 378 && cut === 0 && order, `at 390 px it fits (${Math.round(d.left)} to ${Math.round(d.right)}), nothing is cut, and the key that destroys stays after the other`);
await p.screenshot({ path: 'shots/parts/alert-dialog/hand-open-390.png' });
await p.close();

// with no voxels at all it is the same
p = await open({}, '?theme=light', true);
say(await p.evaluate(() => !document.querySelector('[data-vx-live]')), 'plain: nothing on the page is voxels');
await press(p, '#open-delete'); await p.waitForTimeout(100);
d = await read(p, 'delete');
say(d.open && d.modal && d.focus === 'Keep it', 'plain: it opens modal, on Keep it');
await p.mouse.click(40, 40); await p.waitForTimeout(200);
say((await read(p, 'delete')).open, 'plain: a press outside does nothing');
await p.keyboard.press('Escape'); await p.waitForTimeout(200);
d = await read(p, 'delete');
// (the kit's plain dialog lets the browser close it on Escape, which leaves returnValue as it was: "")
say(!d.open && (d.value === 'cancel' || d.value === '') && d.focus === 'open-delete' && await result(p) === 'Nothing deleted', `plain: Escape closes it, nothing is deleted, the focus is back (returnValue "${d.value}")`);
await press(p, '#open-delete'); await p.waitForTimeout(100);
await press(p, '#delete [data-vx-kind="danger"]'); await p.waitForTimeout(200);
d = await read(p, 'delete');
say(!d.open && d.value === 'delete', 'plain: its danger key closes it with "delete"');
await p.close();

say(errors.length === 0, 'no errors' + (errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''));
await browser.close();
process.exit(bad ? 1 : 0);
