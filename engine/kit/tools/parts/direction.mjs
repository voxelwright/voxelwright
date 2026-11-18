// Right to left, measured: the direction page under a real mouse and real keys, in voxels and
// plain. Each line is one thing that must hold when the language runs the other way. A FAIL
// names the file and line where it is to be mended. The light is not measured: it stays upper
// left, and shadows fall right and down, whatever the language.
//   PORT=5989 node tools/parts/direction.mjs
// It exits 1 while anything fails, and that includes faults in the kit's shared files, which
// this page shows and does not mend.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';

const port = process.env.PORT || 5989;
const url = `http://127.0.0.1:${port}/showcase/parts/direction.html?theme=light`;
await mkdir('shots/parts/direction', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
let bad = 0;
const say = (ok, what) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); };
const note = (what) => console.log(`note ${what}`);
const errors = [];
const open = async (plain) => {
  const p = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 })).newPage();
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  if (plain) await p.addInitScript(() => { new MutationObserver((_, o) => { if (document.documentElement) { document.documentElement.setAttribute('data-vx-plain', ''); o.disconnect(); } }).observe(document, { childList: true }); });
  await p.goto(url);
  await p.waitForFunction(() => document.documentElement.dataset.ready === '1');
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(700);
  return p;
};
const near = (a, b, by = 1.5) => Math.abs(a - b) <= by;
const rtl = (id, sel) => `#${id} [dir="rtl"] ${sel}`, ltr = (id, sel) => `#${id} [dir="ltr"] ${sel}`;
const show = async (p, sel) => { await p.locator(sel).first().scrollIntoViewIfNeeded(); await p.waitForTimeout(250); };

// ============================================================ voxels
const p = await open(false);

// ---- switch
const knob = (sel) => p.evaluate((sel) => { const el = document.querySelector(sel), l = window.vx.live(el), k = l.model.byName.knob, lit = l.model.byName.lit; const xs = []; for (let i = 0; i < lit.count; i++) if (lit.scales[i] > 0.5) xs.push(lit.rest[i * 3]); return { x: k.tx, far: 1 + l.state.travel, W: l.W, lit: xs.length ? [Math.min(...xs), Math.max(...xs)] : null, on: el.parentElement.querySelector('input').checked }; }, sel);
let a = await knob(ltr('p-switch', '.vx-toggle:nth-child(1) .vx-switch')), b = await knob(rtl('p-switch', '.vx-toggle:nth-child(1) .vx-switch'));
say(near(a.x, a.far, 0.05) && a.lit[0] < 1, `switch, left to right, on: the knob is at the right end and the trench is lit from the left wall to it`);
say(near(b.x, 1, 0.05), `switch, right to left, on: the knob belongs at the left end (x 1); it is at x ${b.x.toFixed(1)} of 1..${b.far}, the right end. Mend: src/looks/lit.js:300 (the same in src/components/toggle.js:37)`);
say(b.lit && b.lit[1] > b.W - 1.6 && b.lit[0] > 2, `switch, right to left, on: the light belongs between the right wall and the knob; it lies from x ${b.lit?.[0]} to ${b.lit?.[1]} of ${b.W}, from the left wall. Mend: src/looks/lit.js:303-304 (src/components/toggle.js:41-44)`);
b = await knob(rtl('p-switch', '.vx-toggle:nth-child(2) .vx-switch'));
say(near(b.x, b.far, 0.05), `switch, right to left, off: the knob belongs at the right end, beside its label; it is at x ${b.x.toFixed(1)}, the left end. Mend: the same lines`);

// ---- meter
const fill = (sel) => p.evaluate((sel) => { const l = window.vx.live(document.querySelector(sel)), f = l.model.byName.fill; const xs = []; for (let i = 0; i < f.count; i++) if (f.scales[i] > 0.5) xs.push(f.rest[i * 3]); return { W: l.W, from: Math.min(...xs), to: Math.max(...xs) }; }, sel);
a = await fill(ltr('p-meter', '.vx-meter')); b = await fill(rtl('p-meter', '.vx-meter'));
say(a.from < 1 && near(a.to / a.W, 0.3, 0.03), `meter, left to right, 30%: the light fills from the left wall (to ${Math.round(a.to / a.W * 100)}% of the trench)`);
say(b.to > b.W - 1 && near(b.from / b.W, 0.7, 0.03), `meter, right to left, 30%: the light belongs in the right 30% of the trench; it fills x ${b.from} to ${b.to} of ${b.W}, from the left. Mend: src/looks/lit.js:132 (src/components/meter.js:45)`);

// ---- slider: a real press at 80% of its width
const slide = async (sel) => {
  await show(p, sel);
  const r = await p.locator(sel).boundingBox(), x = r.x + r.width * 0.8, y = r.y + r.height / 2;
  await p.mouse.click(x, y);
  await p.waitForTimeout(350);
  const s = await p.evaluate((sel) => { const el = document.querySelector(sel), l = window.vx.live(el), t = l.model.byName.thumb; return { value: Number(el.querySelector('input').value), thumb: el.getBoundingClientRect().left + (t.tx + 2.5) * l.vx }; }, sel);
  await p.evaluate((sel) => { document.querySelector(sel + ' input').value = 20; }, sel);
  return { ...s, x };
};
a = await slide(ltr('p-slider', '.vx-slider')); b = await slide(rtl('p-slider', '.vx-slider'));
say(near(a.value, 80, 4) && near(a.thumb, a.x, 8), `slider, left to right: a press at 80% of its width sets ${a.value}, and the thumb is under the mouse`);
say(near(b.value, 20, 4), `slider, right to left: the same press sets ${b.value} (the browser's own range runs from the right)`);
say(near(b.thumb, b.x, 8), `slider, right to left: the thumb belongs under the mouse; it is drawn ${Math.round(Math.abs(b.thumb - b.x))} px away, at the mirror of where the hand is. Mend: src/components/slider.js:36-40`);

// ---- tabs: a real press on the first, then the arrow keys
const tabsAt = (sel) => p.evaluate((sel) => { const el = document.querySelector(sel), l = window.vx.live(el), all = [...el.querySelectorAll('[role="tab"]')], i = all.findIndex((t) => t.getAttribute('aria-selected') === 'true'); return { i, focus: all.indexOf(document.activeElement), block: el.getBoundingClientRect().left + l.model.byName.block.tx * l.vx, tab: all[i].getBoundingClientRect().left, xs: all.map((t) => Math.round(t.getBoundingClientRect().left)) }; }, sel);
const arrows = async (sel, name, first) => {
  await show(p, sel);
  const t = await p.locator(`${sel} [role="tab"]`).first().boundingBox();
  await p.mouse.click(t.x + t.width / 2, t.y + t.height / 2);
  await p.waitForTimeout(300);
  let s = await tabsAt(sel);
  say(s.i === 0 && near(s.block, s.tab, 4.5), `tabs, ${name}: the key in the trench sits on the chosen tab (the first, at the ${first})`);
  const want = s.xs[1] < s.xs[0] ? 'ArrowLeft' : 'ArrowRight', other = want === 'ArrowLeft' ? 'ArrowRight' : 'ArrowLeft';
  await p.keyboard.press(want);
  await p.waitForTimeout(300);
  s = await tabsAt(sel);
  const fwd = s.i;
  await p.keyboard.press(other);
  await p.waitForTimeout(300);
  s = await tabsAt(sel);
  return { want, other, fwd, back: s.i };
};
a = await arrows(ltr('p-tabs', '.vx-tabs'), 'left to right', 'left');
say(a.fwd === 1 && a.back === 0, `tabs, left to right: ${a.want} goes to the tab on the right, ${a.other} comes back`);
b = await arrows(rtl('p-tabs', '.vx-tabs'), 'right to left', 'right');
say(b.fwd === 1 && b.back === 0, `tabs, right to left: ${b.want} belongs to the tab on its left (the second); it chose tab ${b.fwd + 1} of 3${b.fwd === 2 ? ', the one at the far end' : ''}. Mend: src/components/tabs.js:62`);

// ---- button: a key with an icon
const icon = (sel, look) => p.evaluate(([sel, look]) => {
  const el = document.querySelector(sel);
  if (look) el.style.setProperty('--vx-look', look); else el.style.removeProperty('--vx-look');
  const l = window.vx.live(el); l.rebuild();
  const cap = l.model.byName.cap, xs = [];
  for (let i = 0; i < cap.count; i++) if (cap.rest[i * 3 + 2] > l.state.top) xs.push(cap.rest[i * 3]);
  const r = el.getBoundingClientRect(), range = document.createRange(); range.selectNodeContents(el.querySelector('.vx-label')); const w = range.getBoundingClientRect();
  const cs = getComputedStyle(el);
  return { glyph: xs.length ? [r.left + Math.min(...xs) * l.vx, r.left + (Math.max(...xs) + 0.5) * l.vx] : null, words: [w.left, w.right], box: [r.left, r.right], pad: [parseFloat(cs.paddingLeft), parseFloat(cs.paddingRight)] };
}, [sel, look]);
a = await icon(ltr('p-button', '[data-vx-icon]')); b = await icon(rtl('p-button', '[data-vx-icon]'));
say(a.pad[1] === 60 && b.pad[0] === 60, `button with an icon: the room kept for the icon is at the end of the line both ways (right ${a.pad[1]} px, and left ${b.pad[0]} px right to left)`);
say(!!a.glyph && !!b.glyph, `button with an icon, lit look: an icon belongs in that room; none is drawn, in either direction (this is not a fault of direction). Mend: src/looks/lit.js:19-37, the key's build has no icon; src/components/button.js:25-32 has`);
a = await icon(ltr('p-button', '[data-vx-icon]'), 'default'); b = await icon(rtl('p-button', '[data-vx-icon]'), 'default');
say(a.glyph && a.glyph[0] > a.words[1], 'button with an icon, the base look, left to right: the chevron is drawn after the words');
say(b.glyph && b.glyph[1] < b.words[0], `button with an icon, the base look, right to left: the chevron belongs left of the words, in the room kept for it; it is drawn at x ${b.glyph?.map(Math.round).join('..')} and the words are at ${b.words.map(Math.round).join('..')}: on top of them. Mend: src/components/button.js:30`);
await icon(ltr('p-button', '[data-vx-icon]'), ''); await icon(rtl('p-button', '[data-vx-icon]'), '');

// ---- the kit's list: its mark and its padding
const tray = (sel) => p.evaluate((sel) => {
  const el = document.querySelector(sel), l = window.vx.live(el), row = l.model.byName.row0;
  let top = -Infinity; for (let i = 0; i < row.count; i++) top = Math.max(top, row.rest[i * 3 + 2]);
  const xs = []; for (let i = 0; i < row.count; i++) if (row.rest[i * 3 + 2] === top) xs.push(row.rest[i * 3]);
  const cs = getComputedStyle(el.querySelector('.vx-row'));
  return { W: l.W, mark: [Math.min(...xs), Math.max(...xs)], pad: [parseFloat(cs.paddingLeft), parseFloat(cs.paddingRight)] };
}, sel);
a = await tray(ltr('p-list', '.vx-list')); b = await tray(rtl('p-list', '.vx-list'));
say(a.mark[1] < 4 && a.pad[0] > a.pad[1], `list, left to right: the mark of the current row is at the left, where the row begins, and the row keeps ${a.pad[0]} px for it there`);
say(b.mark[0] > b.W - 4, `list, right to left: the mark belongs at the right, where the row begins; it is at x ${b.mark[0]}..${b.mark[1]} of ${b.W}, the left. Mend: src/components/list.js:26`);
say(b.pad[1] > b.pad[0], `list, right to left: the room for the mark belongs at the right; the row has ${b.pad[0]} px at the left and ${b.pad[1]} px at the right, as it has left to right. Mend: voxelmorphism.css:307 and :310 (padding given as four physical sides)`);

// ---- what turns as it should
const sides = await p.evaluate(() => {
  const q = (s) => document.querySelector(s), r = (s) => q(s).getBoundingClientRect();
  const text = (el) => { const g = document.createRange(); g.selectNodeContents(el); return g.getBoundingClientRect(); };
  const words = (s) => { const el = q(s), w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode()) && !n.textContent.trim()); return text(n); };
  const R = '[dir="rtl"]';
  return {
    check: r(`#p-check ${R} .vx-box`).left > words(`#p-check ${R} .vx-check`).right,
    toggle: r(`#p-switch ${R} .vx-switch`).left > words(`#p-switch ${R} .vx-toggle`).right,
    groove: r(`#p-groove ${R} .vx-groove`).left > r(`#p-groove ${R} p`).right,
    words: Math.round(r(`#p-words ${R} li`).right - r(`#p-words ${R} .mark`).right),
    field: [getComputedStyle(q(`#p-field ${R} input`)).direction, getComputedStyle(q(`#p-field ${R} input`)).textAlign, getComputedStyle(q(`#p-field ${R} input[type="email"]`)).direction],
    label: Math.round(r(`#p-field ${R} .vx-well`).right - text(q(`#p-field ${R} .vx-field-label`)).right),
    block: Math.round(r(`#p-tabs ${R} [role="tab"]`).right - r(`#p-tabs ${R} .vx-tabs`).right),
    keys: r(`#p-button ${R} .vx-button`).right > r(`#p-button ${R} .vx-button:nth-child(2)`).right,
    bar: r(`#p-scroll ${R} .vx-scroll-bar`).right < r(`#p-scroll ${R} .vx-scroll-well`).left,
    spy: [Math.round(r(`#p-scroll ${R} .vx-spy-mark`).left - r(`#p-scroll ${R} a[aria-current]`).left), Math.round(r(`#p-scroll ${R} a[aria-current]`).right - r(`#p-scroll ${R} .vx-spy`).right)],
    empty: [Math.round(r(`#p-empty ${R} .vx-empty`).right - text(q(`#p-empty ${R} .vx-empty-title`)).right), Math.round(r(`#p-empty ${R} .vx-empty`).right - r(`#p-empty ${R} .vx-button`).right)],
    spinner: r(`#p-spinner ${R} .vx-spinner`).left > words(`#p-spinner ${R} .loading`).right,
    bone: Math.round(r(`#p-skeleton ${R} .vx-skeleton`).right - r(`#p-skeleton ${R} .vx-bone`).right),
    canvases: [...document.querySelectorAll('[data-vx-live]')].filter((el) => el.offsetParent && el.closest(R)).map((el) => { const c = el.querySelector(':scope > .vx-canvas'); if (!c || c.hidden) return 0; const a = el.getBoundingClientRect(), b = c.getBoundingClientRect(); return Math.abs((a.left + a.right) / 2 - (b.left + b.right) / 2); }),
  };
});
say(sides.keys && sides.block === 0, 'right to left: the first key of a row and the first tab are at the right');
say(sides.check && sides.toggle && sides.spinner, 'right to left: a checkbox, a switch and a spinner stand to the right of their words');
say(sides.field[0] === 'rtl' && sides.field[1] === 'start' && sides.label === 0 && sides.field[2] === 'ltr', 'right to left: a field\'s label and what is typed start at the right; an address given dir="ltr" still runs left to right');
say(sides.groove && sides.words === 4, 'right to left: a quote\'s groove and the accent groove of the current row are at the right (they are placed with logical properties)');
say(sides.bar && sides.spy[0] === 0 && sides.spy[1] === 0, 'right to left, this batch: the scroll area\'s bar is at the left, the far edge; the spy\'s groove lies under the current link, the first from the right');
say(sides.empty[0] === 0 && sides.empty[1] === 0 && sides.bone === 0, 'right to left, this batch: an empty state set at the start, and a skeleton\'s trenches, begin at the right');
say(sides.canvases.every((d) => d < 0.6), `right to left: every voxel canvas sits on its own element (${sides.canvases.length} of them, the furthest off by ${Math.max(...sides.canvases).toFixed(2)} px)`);
// the skeleton's light: which way it travels
const travel = async (sel) => { await show(p, sel); const xs = []; for (let i = 0; i < 40 && xs.length < 6; i++) { const x = await p.evaluate((sel) => { const l = window.vx.live(document.querySelector(sel)), f = l.model.byName.light; let s = 0, n = 0; for (let i = 0; i < f.count; i++) { s += f.rest[i * 3] * f.scales[i]; n += f.scales[i]; } return n > 2 ? s / n : null; }, sel); if (x !== null && x !== xs.at(-1)) xs.push(x); else if (x === null && xs.length) { if (xs.length > 2) break; xs.length = 0; } await p.waitForTimeout(40); } return xs.length > 2 ? Math.sign(xs.at(-1) - xs[0]) : 0; };
a = await travel(ltr('p-skeleton', '.vx-bone:nth-child(2)')); b = await travel(rtl('p-skeleton', '.vx-bone:nth-child(2)'));
say(a === 1 && b === -1, `skeleton: the light passes the way the words run (left to right it goes ${a > 0 ? 'right' : a < 0 ? 'left' : 'nowhere'}, right to left it goes ${b > 0 ? 'right' : b < 0 ? 'left' : 'nowhere'})`);

// ---- the face the legends are drawn in
const cdp = await p.context().newCDPSession(p);
const faces = async (sel) => { const { root } = await cdp.send('DOM.getDocument'); const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: sel }); const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId }); return fonts.map((f) => f.familyName).join(', '); };
await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
const en = await faces(ltr('p-button', '.vx-button .vx-label')), ar = await faces(rtl('p-button', '.vx-button .vx-label')), body = await faces(rtl('p-empty', '.vx-empty-text'));
say(/Vox Text/.test(en), `a legend in English is drawn in the key face (${en})`);
say(/Vox Text/.test(ar), `a legend in Arabic belongs in a key face too; it is drawn in ${ar}, the system's, because Vox Text has no Arabic (nor Hebrew) glyphs. Mend: packages/voxelmorphism/fonts/vox-text (the glyph set), or name a face for these scripts in --vx-key-font at voxelmorphism.css:58`);
note(`reading text in Arabic is drawn in ${body}: IBM Plex Sans is shipped in Latin and Cyrillic only (voxelmorphism.css:5-26), so Arabic and Hebrew are the system's face`);
await p.context().close();

// ============================================================ plain
const q = await open(true);
// the switch: a painted knob
const painted = (sel) => q.evaluate((sel) => { const el = document.querySelector(sel), cs = getComputedStyle(el, '::after'); const m = new DOMMatrixReadOnly(cs.transform === 'none' ? undefined : cs.transform); const x = parseFloat(cs.left) + m.m41; return { from: x, to: x + parseFloat(cs.width), W: el.offsetWidth }; }, sel);
a = await painted(ltr('p-switch', '.vx-toggle:nth-child(1) .vx-switch')); b = await painted(rtl('p-switch', '.vx-toggle:nth-child(1) .vx-switch'));
say(a.to === a.W - 4, 'switch, plain, left to right, on: the painted knob is at the right end, inside the track');
say(b.from === 4, `switch, plain, right to left, on: the painted knob belongs at the left end; it is at x ${b.from}..${b.to} of a track ${b.W} px wide, which is outside it to the right. Mend: voxelmorphism.css:255 (translateX is a physical move; the knob starts from inset-inline-start at :249)`);
b = await painted(rtl('p-switch', '.vx-toggle:nth-child(2) .vx-switch'));
say(b.to === b.W - 4, 'switch, plain, right to left, off: the painted knob is at the right end, beside its label');
// the meter: the browser's own, read from a picture of it
const side = async (sel, name) => { await show(q, sel); const file = `shots/parts/direction/${name}.png`; await q.locator(sel).screenshot({ path: file }); return execFileSync('python3', ['-c', 'import sys\nfrom PIL import Image\nim = Image.open(sys.argv[1]).convert("HSV")\nw, h = im.size\nsat = lambda x0, x1: sum(im.getpixel((x, h // 2))[1] for x in range(x0, x1)) / max(1, x1 - x0)\nl, r = sat(2, w // 5), sat(w - w // 5, w - 2)\nprint("left" if l > r + 40 else "right" if r > l + 40 else "neither")', file]).toString().trim(); };
a = await side(ltr('p-meter', 'progress'), 'plain-meter-ltr'); b = await side(rtl('p-meter', 'progress'), 'plain-meter-rtl');
say(a === 'left' && b === 'right', `meter, plain: the browser's own progress turns by itself (left to right it fills from the ${a}, right to left from the ${b})`);
// the slider: the browser's own
const pressed = async (sel) => { await show(q, sel); const r = await q.locator(sel).boundingBox(); await q.mouse.click(r.x + r.width * 0.8, r.y + r.height / 2); await q.waitForTimeout(250); return q.evaluate((sel) => Number(document.querySelector(sel + ' input').value), sel); };
a = await pressed(ltr('p-slider', '.vx-slider')); b = await pressed(rtl('p-slider', '.vx-slider'));
say(near(a, 80, 4) && near(b, 20, 4), `slider, plain: the browser's own range turns by itself (a press at 80% of its width sets ${a} left to right and ${b} right to left)`);
// tabs: the keys
const keysPlain = async (sel) => {
  await show(q, sel);
  const t = await q.locator(`${sel} [role="tab"]`).first().boundingBox();
  await q.mouse.click(t.x + t.width / 2, t.y + t.height / 2);
  const xs = await q.evaluate((sel) => [...document.querySelectorAll(sel + ' [role="tab"]')].map((t) => t.getBoundingClientRect().left), sel);
  const want = xs[1] < xs[0] ? 'ArrowLeft' : 'ArrowRight';
  await q.keyboard.press(want);
  await q.waitForTimeout(200);
  return [want, await q.evaluate((sel) => [...document.querySelectorAll(sel + ' [role="tab"]')].findIndex((t) => t.getAttribute('aria-selected') === 'true'), sel)];
};
a = await keysPlain(ltr('p-tabs', '.vx-tabs')); b = await keysPlain(rtl('p-tabs', '.vx-tabs'));
say(a[1] === 1, `tabs, plain, left to right: ${a[0]} goes to the tab on the right`);
say(b[1] === 1, `tabs, plain, right to left: ${b[0]} belongs to the tab on its left (the second); it chose tab ${b[1] + 1} of 3. Mend: src/plain.js:37`);
// the list: a painted mark
const mark = (sel) => q.evaluate((sel) => { const li = document.querySelector(sel + ' li[aria-current]'), cs = getComputedStyle(li); return { shadow: cs.boxShadow, pad: [parseFloat(cs.paddingLeft), parseFloat(cs.paddingRight)] }; }, sel);
b = await mark(rtl('p-list', '.vx-list'));
const dx = Number((b.shadow.match(/\)\s*(-?[\d.]+)px/) || [])[1]);
say(dx < 0, `list, plain, right to left: the painted mark belongs at the right edge of the row; it is an inset shadow of ${dx} px, which paints the left edge. Mend: voxelmorphism.css:322`);
say(b.pad[1] > b.pad[0], `list, plain, right to left: the room for the mark belongs at the right; the row has ${b.pad[0]} px at the left and ${b.pad[1]} px at the right. Mend: voxelmorphism.css:310`);
// this batch, plain
const mine = await q.evaluate(() => {
  const q = (s) => document.querySelector(s), r = (s) => q(s).getBoundingClientRect(), R = '[dir="rtl"]';
  return {
    bar: r(`#p-scroll ${R} .vx-scroll-bar`).right < r(`#p-scroll ${R} .vx-scroll-well`).left && getComputedStyle(q(`#p-scroll ${R} .vx-scroll-bar`)).visibility === 'visible',
    spy: Math.round(r(`#p-scroll ${R} .vx-spy-mark`).left - r(`#p-scroll ${R} a[aria-current]`).left),
    bone: [getComputedStyle(q(`#p-skeleton ${R} .vx-bone`)).animationDirection, getComputedStyle(q('#p-skeleton [dir="ltr"] .vx-bone')).animationDirection],
  };
});
say(mine.bar && mine.spy === 0 && mine.bone[0] === 'reverse' && mine.bone[1] === 'normal', 'right to left, this batch, plain: the bar is at the left, the spy\'s groove under the first link from the right, and the skeleton\'s painted light runs the other way');
await q.context().close();

say(errors.length === 0, 'no errors' + (errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''));
await browser.close();
console.log(bad ? `${bad} to mend` : 'everything turns');
process.exit(bad ? 1 : 0);
