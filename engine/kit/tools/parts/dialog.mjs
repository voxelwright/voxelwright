// The lit dialog under a real mouse and real keys: a float on the accent's light with a groove
// under its header, built when it opens and broken when it closes, with its keys and its values.
//   PORT=5989 node tools/parts/dialog.mjs
import { chromium } from 'playwright';

const port = process.env.PORT || 5989;
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
const p = await (await browser.newContext({ viewport: { width: 1180, height: 900 }, deviceScaleFactor: 1 })).newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(String(e)));
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
let bad = 0;
const say = (ok, what) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); };
const mid = async (sel) => { const b = await p.locator(sel).first().boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
const press = async (sel) => { const [x, y] = await mid(sel); await p.mouse.move(x, y, { steps: 6 }); await p.mouse.down(); await p.waitForTimeout(70); await p.mouse.up(); };

await p.goto(`http://127.0.0.1:${port}/showcase/parts/dialog.html?theme=light`);
await p.waitForFunction(() => document.documentElement.dataset.ready === '1' && window.vx);
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(900);

const read = (id) => p.evaluate(async (id) => {
  const { MATERIALS } = await import('/packages/voxelmorphism/src/index.js');
  const name = (i) => Object.keys(MATERIALS).find((k) => MATERIALS[k].id === i);
  const el = document.getElementById(id), l = window.vx.live(el), { panel, groove } = l.model.byName;
  const made = (q) => (q ? [...new Set(q.mats)].map(name).sort().join('+') : 'none');
  const head = el.querySelector('header'), ink = getComputedStyle(el.querySelector('.vx-dialog-body')).color;
  let gy = null;
  if (groove?.count) { gy = Infinity; for (let i = 0; i < groove.count; i++) gy = Math.min(gy, groove.rest[i * 3 + 1] - 0.5); gy *= l.vx; }
  const keys = [...el.querySelectorAll('footer .vx-button')];
  return {
    open: el.open, value: el.returnValue, panel: made(panel), groove: made(groove), grooveY: gy, headEnd: head.offsetTop + head.offsetHeight, headH: head.offsetHeight,
    headInk: getComputedStyle(head).color === ink, headBand: getComputedStyle(head).backgroundColor, top: l.faceZ, height: l.look.dialog,
    fx: panel.fx?.kind ?? null, leaving: el.hasAttribute('data-vx-leaving'), hidden: panel.hidden,
    keys: keys.map((k) => ({ kind: k.dataset.vxKind || 'plain', lit: !!window.vx.live(k)?.model.byName.light, cap: made(window.vx.live(k)?.model.byName.cap) })),
    inside: el.contains(document.activeElement), astray: document.activeElement !== document.body && !el.contains(document.activeElement), focus: document.activeElement.id || document.activeElement.textContent.trim().slice(0, 20),
  };
}, id);
const result = () => p.evaluate(() => document.getElementById('result').textContent);

// the one that stands open on the page
let d = await read('still');
say(d.open && d.panel === 'chalk+light' && d.top === d.height, `a float at dialog height (${d.top} voxels) on the accent's light: a slab of ${d.panel}`);
say(d.groove === 'light-warm' && Math.abs(d.grooveY - (d.headEnd - 4)) < 0.5, `a groove of the room's light parts header from body: the header's last row of voxels (${d.grooveY} px down, the header ends at ${d.headEnd})`);
say(d.headInk && d.headBand === 'rgba(0, 0, 0, 0)' && d.headH % 4 === 0, `its header is words in ink with no band behind them, ${d.headH / 4} voxels high`);
say(d.keys.length === 2 && d.keys.filter((k) => k.kind === 'main').length === 1 && d.keys.every((k) => k.lit), `its keys stand on light, and one is main (${d.keys.map((k) => k.kind + ':' + k.cap).join(', ')})`);

// its key closes it with the key's value: it breaks, then it is gone
await press('#still [data-vx-close="later"]');
await p.waitForTimeout(60);
d = await read('still');
say(d.open && d.leaving && d.fx === 'crumble', 'a press on Not now: it breaks first');
await p.waitForTimeout(700);
d = await read('still');
say(!d.open && d.value === 'later' && await result() === 'still: later', 'then it is closed, with that key\'s value');
await press('#open-still'); await p.waitForTimeout(60);
d = await read('still');
say(d.open && d.fx === 'assemble' && !d.hidden, 'shown again, it is built again');
await p.waitForTimeout(700);
say((await read('still')).fx === null, 'and stands whole');
// not modal: the page behind still works
await press('#open-rename'); await p.waitForTimeout(700);
say((await read('rename')).open && (await read('still')).open, 'with it open the page behind still works: Rename opens over it');

// the modal one: a form
d = await read('rename');
say(d.inside && d.focus === 'new-name', `it opens with focus inside, on the field (${d.focus})`);
await p.screenshot({ path: 'shots/parts/dialog/hand-modal.png' });
// (after the last key a browser may give focus to its own bar for one stop; that is not the page)
const stops = [];
for (let i = 0; i < 6; i++) { await p.keyboard.press('Tab'); const r = await read('rename'); stops.push(r.astray ? 'OUT:' + r.focus : r.inside ? r.focus : '(browser)'); }
say(!stops.some((s) => s.startsWith('OUT')) && stops.includes('Cancel') && stops.includes('Save'), `Tab never reaches the page behind it (${stops.join(', ')})`);
await p.locator('#new-name').fill('harbor-core');
await p.locator('#new-name').press('Enter'); await p.waitForTimeout(60);
d = await read('rename');
say(d.leaving && d.fx === 'crumble', 'Enter in the field sends the form: the dialog breaks');
await p.waitForTimeout(700);
d = await read('rename');
say(!d.open && d.value === 'save' && await result() === 'rename: save', 'and closes with the main key\'s value');
say(await p.evaluate(() => document.activeElement.id) === 'open-rename', 'focus is back on the key that opened it');

await p.keyboard.press('Enter'); await p.waitForTimeout(700);
say((await read('rename')).open, 'Enter on that key opens it again');
await p.keyboard.press('Escape'); await p.waitForTimeout(60);
d = await read('rename');
say(d.open && d.fx === 'crumble', 'Escape breaks it');
await p.waitForTimeout(700);
d = await read('rename');
say(!d.open && d.value === 'cancel' && await p.evaluate(() => document.activeElement.id) === 'open-rename', 'and closes it with "cancel"; focus is back');

await press('#open-rename'); await p.waitForTimeout(700);
await p.mouse.click(40, 40); await p.waitForTimeout(500);
say((await read('rename')).open, 'a press outside a modal dialog does not close it');
await press('#rename [data-vx-close="cancel"]'); await p.waitForTimeout(800);
d = await read('rename');
say(!d.open && d.value === 'cancel', 'its Cancel key closes it');

// the one that asks before destroying
await press('#open-delete'); await p.waitForTimeout(700);
d = await read('delete');
say(d.open && d.focus === 'Keep it', `the alert dialog opens with focus on the key that destroys nothing (${d.focus})`);
say(d.keys.some((k) => k.kind === 'danger') && !d.keys.some((k) => k.kind === 'main'), 'its destructive key is a danger key');
await p.screenshot({ path: 'shots/parts/dialog/hand-alert.png' });
await p.keyboard.press('Tab'); await p.keyboard.press('Space'); await p.waitForTimeout(800);
d = await read('delete');
say(!d.open && d.value === 'delete' && await result() === 'delete: delete', 'Tab to Delete and Space: it closes with "delete"');
say(await p.evaluate(() => document.activeElement.id) === 'open-delete', 'focus is back on the key that opened it');

say(errors.length === 0, 'no errors' + (errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''));
await browser.close();
process.exit(bad ? 1 : 0);
