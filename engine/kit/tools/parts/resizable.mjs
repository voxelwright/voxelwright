// A person at the resizable panels' page: a real mouse on the groove, real keys, a finger, a
// window that narrows. Says ok or FAIL for each thing that must hold; exit 1 on a failure.
//   PORT=5989 node tools/parts/resizable.mjs
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const port = process.env.PORT || 5989;
const url = `http://127.0.0.1:${port}/showcase/parts/resizable.html?theme=light`;
const dir = 'shots/parts/resizable';
await mkdir(dir, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
let bad = 0;
const say = (ok, what) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); };
const errors = [];

async function open({ plain = false, width = 1180, script = true, touch = false, reduced = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 950 }, deviceScaleFactor: 1, javaScriptEnabled: script, hasTouch: touch, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  if (plain) await p.addInitScript(() => { new MutationObserver((_, o) => { if (document.documentElement) { document.documentElement.setAttribute('data-vx-plain', ''); o.disconnect(); } }).observe(document, { childList: true }); });
  await p.goto(url);
  if (script) { await p.waitForFunction(() => document.documentElement.dataset.ready === '1'); await p.evaluate(() => document.fonts.ready); }
  await p.waitForTimeout(700);
  return p;
}

// one container: its panes' sizes along the split, its grooves and what they say, and how each is drawn
const read = (p, id) => p.evaluate(async (id) => {
  const root = document.getElementById(id), down = root.dataset.vxWay === 'down';
  const { MATERIAL_IDS } = await import('/packages/voxelmorphism/src/core/materials.js');
  const len = (n) => n.getBoundingClientRect()[down ? 'height' : 'width'];
  const kids = (c) => [...root.children].filter((n) => n.classList.contains(c));
  const gs = kids('vx-resizable-groove');
  const cs = getComputedStyle(root);
  const inner = down ? root.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) : root.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  return {
    panes: kids('vx-resizable-pane').map(len),
    mins: kids('vx-resizable-pane').map((n) => (parseFloat(n.dataset.vxMin) >= 0 ? parseFloat(n.dataset.vxMin) : 12) * 4),
    room: inner - gs.reduce((a, g) => a + len(g), 0),
    grooves: gs.map((g) => {
      const l = window.vx?.live?.(g), r = g.getBoundingClientRect(), walls = l?.model.byName.walls;
      return {
        role: g.getAttribute('role'), tab: g.getAttribute('tabindex'), controls: g.getAttribute('aria-controls'), way: g.getAttribute('aria-orientation'),
        now: Number(g.getAttribute('aria-valuenow')), min: Number(g.getAttribute('aria-valuemin')), max: Number(g.getAttribute('aria-valuemax')),
        has: ['aria-valuenow', 'aria-valuemin', 'aria-valuemax'].every((a) => g.hasAttribute(a)),
        held: g.hasAttribute('data-vx-held'), live: g.hasAttribute('data-vx-live'), focus: document.activeElement === g,
        ring: getComputedStyle(g).outlineStyle, cursor: getComputedStyle(g).cursor, touch: getComputedStyle(g).touchAction,
        mat: walls ? MATERIAL_IDS[walls.mats[0]].name : null, deep: walls ? Math.round(-Math.min(...walls.rest.filter((_, i) => i % 3 === 2)) + 0.5) : null, look: l?.look.groove ?? null,
        glow: l?.glowStrength ?? null, lit: l?.spring('lit').target ?? null,
        x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height,
      };
    }),
  };
}, id);
const boxes = (p) => p.evaluate(() => [...document.querySelectorAll('.vx-resizable, .vx-resizable > *')].filter((e) => !e.matches('.vx-canvas')).map((e) => { const r = e.getBoundingClientRect(); return [r.x + scrollX, r.y + scrollY, r.width, r.height].map((v) => v.toFixed(2)).join(' '); }));
const sent = (p) => p.evaluate(() => window.resized.splice(0));
const near = (a, b, by = 0.6) => Math.abs(a - b) <= by;
const voxel = (v) => near(v / 4, Math.round(v / 4), 0.01);
const true_ = (s, i = 0) => s.grooves[i].now === Math.round(100 * s.panes[i] / s.room) && s.grooves[i].min <= s.grooves[i].now && s.grooves[i].now <= s.grooves[i].max;
const drag = async (p, g, dx, dy = 0, { hold = 140, shot } = {}) => {
  await p.mouse.move(g.x, g.y, { steps: 6 });
  await p.mouse.down();
  await p.waitForTimeout(hold);
  await p.mouse.move(g.x + dx, g.y + dy, { steps: 10 });
  await p.waitForTimeout(120);
  if (shot) await p.screenshot({ path: shot.path, clip: shot.clip });
};

// what the groove does, drawn in voxels or painted: the same list for both
async function hand(p, how) {
  const live = how === 'voxels';
  await p.locator('#use').scrollIntoViewIfNeeded();
  let s = await read(p, 'use'), g = s.grooves[0];
  say(g.role === 'separator' && g.tab === '0' && g.has && g.controls === 'services' && g.way === 'vertical' && g.live === live, `${how}: the groove is a separator that takes focus, says which way it stands (${g.way}) and what it controls (${g.controls}), with aria-valuenow ${g.now}, min ${g.min}, max ${g.max}`);
  say(true_(s) && s.panes.slice(0, -1).every(voxel), `${how}: aria-valuenow is the first pane's share of the room (${s.panes[0]} of ${s.room} px is ${g.now}), and the pane is a whole number of voxels wide`);
  say(g.w === 20 && g.cursor === 'col-resize' && g.touch === 'none', `${how}: it is five voxels of surface (${g.w} px) with a resize cursor, and a finger on it does not scroll (touch-action ${g.touch})`);
  const target = await p.evaluate(() => { const g = document.getElementById('use-groove'), r = g.getBoundingClientRect(); return [-21, -23, 21, 23].map((d) => document.elementFromPoint(r.x + r.width / 2 + d, r.y + r.height / 2) === g).join(); });
  say(target === 'true,false,true,false', `${how}: its target is eleven voxels wide: a press 21 px either side of its middle lands on it, 23 px does not (${target})`);
  if (live) say(g.mat === 'light-warm' && g.deep === g.look && g.look >= 1, `voxels: at rest the channel holds the room's own warm light (${g.mat}), cut as deep as the look's groove (${g.deep})`);

  // ---- a real mouse
  const was = s.panes[0], rest = g;
  await p.mouse.move(g.x, g.y, { steps: 6 });
  await p.waitForTimeout(250);
  const aimed = (await read(p, 'use')).grooves[0];
  if (live) say(aimed.lit === 1 && aimed.glow > rest.glow && aimed.mat === 'light-warm', `voxels: under the pointer its light is brighter, and still warm (${rest.glow.toFixed(4)} to ${aimed.glow.toFixed(4)})`);
  await p.mouse.down();
  await p.waitForTimeout(140);
  let h = (await read(p, 'use')).grooves[0];
  say(h.held && h.focus && h.ring === 'none', `${how}: pressed, it is held (data-vx-held), and has the focus with no ring for a mouse`);
  if (live) say(h.mat === 'light' && h.glow > aimed.glow, `voxels: held, the channel is the accent's light (${h.mat}), and brighter (${h.glow.toFixed(4)})`);
  await p.mouse.move(g.x + 60, g.y + 30, { steps: 10 });
  await p.waitForTimeout(150);
  await p.screenshot({ path: `${dir}/hand-held-${how}.png`, clip: { x: 240, y: 200, width: 700, height: 280 } });
  let t = await read(p, 'use');
  say(t.panes[0] === was + 60 && t.grooves[0].held, `${how}: dragged 60 px, the first pane is 60 px wider (${was} to ${t.panes[0]}), and the groove is under the pointer (${t.grooves[0].x} for ${g.x + 60})`);
  say(near(t.grooves[0].x, g.x + 60) && true_(t) && t.grooves[0].now > g.now, `${how}: aria-valuenow follows (${g.now} to ${t.grooves[0].now})`);
  await p.mouse.move(g.x + 67, g.y, { steps: 4 });
  t = await read(p, 'use');
  say(voxel(t.panes[0]) && t.panes[0] === was + 68, `${how}: it moves a voxel at a time: 67 px along, the pane is ${t.panes[0] - was} px wider`);
  await p.mouse.up();
  await p.waitForTimeout(350);
  t = await read(p, 'use');
  say(!t.grooves[0].held && t.panes[0] === was + 68, `${how}: let go, it stays where it was put and is no longer held`);
  if (live) say(t.grooves[0].mat === 'light-warm', `voxels: and its light is warm again (${t.grooves[0].mat})`);
  let ev = await sent(p);
  say(ev.length >= 2 && ev.every((e) => e[0] === 'use') && ev.at(-1)[1] === t.grooves[0].now && ev.at(-1)[2] === t.panes[0] && await p.evaluate(() => document.getElementById('said').textContent) === `The list has ${t.grooves[0].now}% of the room.`, `${how}: each change sent vx-resize (${ev.length} of them; the last says ${ev.at(-1)?.[1]}%, ${ev.at(-1)?.[2]} px), and the page heard it`);

  // past either limit
  await drag(p, t.grooves[0], -900);
  let lo = await read(p, 'use');
  await p.mouse.up();
  say(lo.panes[0] === lo.mins[0] && lo.panes[1] >= lo.mins[1] && lo.grooves[0].now === lo.grooves[0].min && true_(lo), `${how}: dragged far past its least, the first pane stops at its least (${lo.panes[0]} px, ${lo.mins[0] / 4} voxels) and says so (${lo.grooves[0].now})`);
  await drag(p, lo.grooves[0], 1500);
  let hi = await read(p, 'use');
  await p.mouse.up();
  say(hi.panes[1] >= hi.mins[1] && hi.panes[1] < hi.mins[1] + 4 && hi.panes[0] >= hi.mins[0] && hi.grooves[0].now === hi.grooves[0].max && true_(hi), `${how}: dragged far past its most, the second pane keeps its least (${hi.panes[1]} px, ${hi.mins[1] / 4} voxels) and the groove says it is at its most (${hi.grooves[0].now})`);
  // a double press: back to where the page put it
  await p.mouse.dblclick(hi.grooves[0].x, hi.grooves[0].y);
  await p.waitForTimeout(200);
  t = await read(p, 'use');
  say(t.panes[0] === was && !t.grooves[0].held, `${how}: a double press puts it back where the page had it (${t.panes[0]} px)`);
  await sent(p);

  // ---- real keys
  await p.mouse.move(5, 5);
  await p.evaluate(() => { document.activeElement.blur(); scrollTo(0, 0); });
  await p.mouse.click(5, 5); // Tab goes on from where the last press was: from the top of the page now, not from the groove
  await p.keyboard.press('Tab');
  await p.waitForTimeout(250);
  s = await read(p, 'use');
  say(s.grooves[0].focus && s.grooves[0].ring === 'solid', `${how}: Tab reaches the groove, and the focus can be seen (outline ${s.grooves[0].ring})`);
  if (live) say(s.grooves[0].lit === 1 && s.grooves[0].glow > rest.glow, 'voxels: and its own light is brighter with it');
  await p.screenshot({ path: `${dir}/hand-focus-${how}.png`, clip: { x: 240, y: 200, width: 700, height: 280 } });
  const step = async (key, by, what) => {
    const a = await read(p, 'use');
    await p.keyboard.press(key);
    const b = await read(p, 'use');
    say(b.panes[0] - a.panes[0] === by && true_(b) && !b.grooves[0].held, `${how}: ${what} (${a.panes[0]} to ${b.panes[0]} px, aria-valuenow ${a.grooves[0].now} to ${b.grooves[0].now})`);
  };
  await step('ArrowRight', 8, 'the right arrow moves it two voxels right');
  await step('ArrowLeft', -8, 'the left arrow moves it two voxels back');
  await step('Shift+ArrowRight', 40, 'with Shift the arrow moves it ten voxels');
  await step('Shift+ArrowLeft', -40, 'and back');
  await step('ArrowDown', 0, 'the down arrow does nothing to a standing groove');
  await p.keyboard.down('ArrowRight');
  await p.waitForTimeout(120);
  h = (await read(p, 'use')).grooves[0];
  await p.keyboard.up('ArrowRight');
  await p.waitForTimeout(250);
  t = await read(p, 'use');
  say(h.held && (!live || h.mat === 'light') && !t.grooves[0].held && (!live || t.grooves[0].mat === 'light-warm'), `${how}: while an arrow key is down it is held${live ? ` and drawn in the accent (${h.mat})` : ''}; let go, it is not${live ? ` (${t.grooves[0].mat})` : ''}`);
  await p.keyboard.press('ArrowLeft');
  await p.keyboard.press('Home');
  t = await read(p, 'use');
  say(t.panes[0] === t.mins[0] && t.grooves[0].now === t.grooves[0].min, `${how}: Home takes the first pane to its least (${t.panes[0]} px, aria-valuenow ${t.grooves[0].now})`);
  await p.keyboard.press('ArrowLeft');
  say((await read(p, 'use')).panes[0] === t.mins[0], `${how}: at its least the left arrow does nothing`);
  await p.keyboard.press('End');
  t = await read(p, 'use');
  say(t.panes[1] >= t.mins[1] && t.panes[1] < t.mins[1] + 4 && t.grooves[0].now === t.grooves[0].max, `${how}: End takes it to its most: the second pane is at its least (${t.panes[1]} px, aria-valuenow ${t.grooves[0].now})`);
  await p.keyboard.press('Enter');
  t = await read(p, 'use');
  const folded = t.panes[0];
  await p.keyboard.press('Enter');
  t = await read(p, 'use');
  say(folded === t.mins[0] && t.panes[1] >= t.mins[1] && t.panes[1] < t.mins[1] + 4, `${how}: Enter folds the first pane to its least (${folded} px); Enter again puts it back (${t.panes[0]} px)`);
  ev = await sent(p);
  say(ev.length >= 8 && ev.every((e) => e[0] === 'use'), `${how}: the keys sent vx-resize too (${ev.length})`);
  await p.mouse.dblclick(t.grooves[0].x, t.grooves[0].y);

  // ---- stacked: a lying groove
  await p.locator('#stack').scrollIntoViewIfNeeded();
  s = await read(p, 'stack'); g = s.grooves[0];
  say(g.way === 'horizontal' && g.h === 20 && g.cursor === 'row-resize' && true_(s), `${how}: stacked, the groove lies (aria-orientation ${g.way}, ${g.h} px high) and says the first pane's share of the height (${g.now})`);
  await p.locator('#stack .vx-resizable-groove').focus();
  await p.keyboard.press('ArrowDown');
  let a = await read(p, 'stack');
  await p.keyboard.press('ArrowUp'); await p.keyboard.press('ArrowUp');
  let b = await read(p, 'stack');
  await p.keyboard.press('ArrowRight');
  let c = await read(p, 'stack');
  say(a.panes[0] === s.panes[0] + 8 && b.panes[0] === s.panes[0] - 8 && c.panes[0] === b.panes[0] && true_(b), `${how}: stacked, the down arrow makes the first pane two voxels taller, the up arrow shorter, and the right arrow does nothing (${s.panes[0]}, ${a.panes[0]}, ${b.panes[0]}, ${c.panes[0]} px)`);
  g = (await read(p, 'stack')).grooves[0];
  await drag(p, g, 40, 24);
  t = await read(p, 'stack');
  await p.mouse.up();
  say(t.panes[0] === b.panes[0] + 24, `${how}: stacked, a drag 24 px down makes the first pane 24 px taller (${b.panes[0]} to ${t.panes[0]})`);
  await drag(p, t.grooves[0], 0, 600);
  hi = await read(p, 'stack');
  await p.mouse.up();
  await drag(p, hi.grooves[0], 0, -600);
  lo = await read(p, 'stack');
  await p.mouse.up();
  say(hi.panes[1] >= hi.mins[1] && hi.panes[1] < hi.mins[1] + 4 && lo.panes[0] === lo.mins[0], `${how}: stacked, both panes keep their least height (the second ${hi.panes[1]} px, the first ${lo.panes[0]} px)`);

  // ---- three panes
  await p.locator('#three').scrollIntoViewIfNeeded();
  s = await read(p, 'three');
  await p.locator('#three .vx-resizable-groove').nth(1).focus();
  await p.keyboard.press('ArrowRight');
  a = await read(p, 'three');
  await p.locator('#three .vx-resizable-groove').nth(0).focus();
  await p.keyboard.press('Shift+ArrowLeft');
  b = await read(p, 'three');
  say(a.panes[0] === s.panes[0] && a.panes[1] === s.panes[1] + 8 && near(a.panes[2], s.panes[2] - 8) && b.panes[0] === a.panes[0] - 40 && b.panes[1] === a.panes[1] + 40 && near(b.panes[2], a.panes[2]) && true_(b, 0) && true_(b, 1),
    `${how}: three panes: each groove moves the pane before it against the pane after it, and leaves the third alone (${s.panes.map(Math.round)} to ${a.panes.map(Math.round)} to ${b.panes.map(Math.round)})`);
  await p.keyboard.press('Home');
  c = await read(p, 'three');
  await p.locator('#three .vx-resizable-groove').nth(1).focus();
  await p.keyboard.press('End');
  const d = await read(p, 'three');
  say(c.panes[0] === c.mins[0] && d.panes[0] === d.mins[0] && d.panes[2] >= d.mins[2] && d.panes[2] < d.mins[2] + 4 && true_(d, 0) && true_(d, 1), `${how}: three panes: pushed to their ends, the first and the last keep their least (${d.panes.map(Math.round)})`);

  // ---- right to left
  await p.locator('#rtl').scrollIntoViewIfNeeded();
  s = await read(p, 'rtl');
  await p.locator('#rtl .vx-resizable-groove').focus();
  await p.keyboard.press('ArrowLeft');
  a = await read(p, 'rtl');
  await p.keyboard.press('ArrowRight');
  g = (await read(p, 'rtl')).grooves[0];
  await drag(p, g, -40);
  b = await read(p, 'rtl');
  await p.mouse.up();
  say(a.panes[0] === s.panes[0] + 8 && near(a.grooves[0].x, s.grooves[0].x - 8) && b.panes[0] === s.panes[0] + 40 && near(b.grooves[0].x, g.x - 40) && true_(b), `${how}: right to left, the left arrow moves the groove left (the first pane, on the right, grows: ${s.panes[0]} to ${a.panes[0]} px), and a drag 40 px left does the same (${b.panes[0]} px)`);

  // ---- fixed
  await p.locator('#fixed').scrollIntoViewIfNeeded();
  s = await read(p, 'fixed'); g = s.grooves[0];
  await drag(p, g, 80);
  t = await read(p, 'fixed');
  await p.mouse.up();
  say(g.tab === null && g.cursor !== 'col-resize' && t.panes[0] === s.panes[0] && !t.grooves[0].held && true_(s), `${how}: a groove with aria-disabled takes no focus, and a drag does not move it (${s.panes[0]} px still), but it still says its share (${g.now})`);
  // set from code: held, and fixed
  await p.evaluate(() => { document.querySelector('#rest .vx-resizable-groove').setAttribute('data-vx-held', ''); document.querySelector('#fixed .vx-resizable-groove').removeAttribute('aria-disabled'); });
  await p.waitForTimeout(200);
  a = (await read(p, 'rest')).grooves[0]; b = (await read(p, 'fixed')).grooves[0];
  await p.evaluate(() => { document.querySelector('#rest .vx-resizable-groove').removeAttribute('data-vx-held'); });
  await p.waitForTimeout(200);
  c = (await read(p, 'rest')).grooves[0];
  say((!live || (a.mat === 'light' && c.mat === 'light-warm')) && b.tab === '0', `${how}: set from code: data-vx-held ${live ? `redraws it in the accent and back (${a.mat}, ${c.mat})` : 'is painted'}, and a fixed groove let go takes focus again`);

  // ---- the window narrows: the least sizes hold, and the split comes back
  await p.locator('#use').scrollIntoViewIfNeeded();
  await p.locator('#use-groove').focus();
  await p.keyboard.press('End');
  const wide = await read(p, 'use');
  await p.setViewportSize({ width: 390, height: 950 });
  await p.waitForTimeout(500);
  const narrow = await read(p, 'use'), three = await read(p, 'three'), sideways = await p.evaluate(() => { scrollTo(200, scrollY); const x = scrollX; scrollTo(0, scrollY); return x; });
  say(narrow.panes.every((v, i) => v >= narrow.mins[i]) && true_(narrow) && three.panes.every((v, i) => v >= three.mins[i]) && true_(three, 0) && true_(three, 1) && sideways === 0,
    `${how}: the window narrowed to 390 px: every pane keeps its least (${narrow.panes.map(Math.round)} px for ${narrow.mins} px; three panes ${three.panes.map(Math.round)}), the values are true (${narrow.grooves[0].now} of ${narrow.grooves[0].min} to ${narrow.grooves[0].max}), and the page does not scroll sideways`);
  await p.screenshot({ path: `${dir}/hand-390-${how}.png`, clip: { x: 0, y: 150, width: 390, height: 420 } });
  await p.setViewportSize({ width: 1180, height: 950 });
  await p.waitForTimeout(500);
  t = await read(p, 'use');
  say(t.panes[0] === wide.panes[0] && true_(t), `${how}: wide again, the split is what it was (${wide.panes[0]} px, ${t.panes[0]} px)`);
  await p.keyboard.press('Home');
  await p.evaluate(() => document.activeElement.blur());
  await p.mouse.move(5, 5);
  await p.waitForTimeout(900);
  if (live) { const awake = await p.evaluate(() => [...window.vx.stage.awake].map((l) => `${l.def.name}${l.el.id ? '#' + l.el.id : ''}`)); say(awake.length === 0, `voxels: at rest nothing runs${awake.length ? ` (awake: ${awake.join(', ')})` : ''}`); }
}

// ---- drawn in voxels
const p = await open();
const liveBoxes = await boxes(p);
await hand(p, 'voxels');
await p.context().close();

// ---- plain: the same boxes, the same behaviour
{
  const q = await open({ plain: true });
  say(await q.locator('[data-vx-live]').count() === 0, 'plain: nothing is drawn in voxels');
  const plainBoxes = await boxes(q);
  const moved = plainBoxes.filter((b, i) => b !== liveBoxes[i]).length;
  say(plainBoxes.length === liveBoxes.length && moved === 0, `plain: every container, pane and groove has the box it has in voxels (${moved} of ${plainBoxes.length} differ)`);
  await hand(q, 'plain');
  await q.context().close();
}

// ---- a finger
{
  const q = await open({ touch: true, width: 390 });
  await q.locator('#use').scrollIntoViewIfNeeded();
  const s = await read(q, 'use'), g = s.grooves[0], y0 = await q.evaluate(() => scrollY);
  const cdp = await q.context().newCDPSession(q);
  const finger = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  await finger('touchStart', g.x, g.y);
  for (let i = 1; i <= 8; i++) { await finger('touchMove', g.x + i * 4, g.y + i * 6); await q.waitForTimeout(16); }
  const mid = await read(q, 'use');
  await finger('touchEnd');
  await q.waitForTimeout(250);
  const t = await read(q, 'use');
  say(mid.grooves[0].held && t.panes[0] === s.panes[0] + 32 && !t.grooves[0].held && await q.evaluate(() => scrollY) === y0, `a finger on the groove drags it (32 px: ${s.panes[0]} to ${t.panes[0]}), and the page does not scroll under it`);
  await q.context().close();
}

// ---- reduced motion: its light changes at once
{
  const q = await open({ reduced: true });
  const g = (await read(q, 'use')).grooves[0];
  await q.mouse.move(g.x, g.y, { steps: 4 });
  const at = await q.evaluate(() => { const l = window.vx.live(document.getElementById('use-groove')); return [l.spring('lit').x, l.spring('lit').target]; });
  say(at[0] === 1 && at[1] === 1, `reduced motion: under the pointer its light is brighter at once, with no easing (${at})`);
  await q.context().close();
}

// ---- no script at all: a still divider where the page put it
{
  const q = await open({ script: false });
  const s = await q.evaluate(() => { const root = document.getElementById('use'), g = document.getElementById('use-groove'), a = document.getElementById('services'); return { tab: g.getAttribute('tabindex'), now: g.getAttribute('aria-valuenow'), role: g.getAttribute('role'), cursor: getComputedStyle(g).cursor, share: a.getBoundingClientRect().width / root.clientWidth, line: getComputedStyle(g).backgroundImage.startsWith('linear-gradient') }; });
  await q.keyboard.press('Tab');
  const focus = await q.evaluate(() => document.activeElement === document.getElementById('use-groove'));
  const g = await q.locator('#use-groove').boundingBox(), w = (await q.locator('#services').boundingBox()).width;
  // the drag goes straight to the browser: Playwright's own mouse waits on a script to watch for
  // dragging while a button is held, and with no script that wait never ends
  const cdp = await q.context().newCDPSession(q), m = (type, x, extra = {}) => cdp.send('Input.dispatchMouseEvent', { type, x, y: g.y + 20, button: 'left', ...extra });
  await m('mouseMoved', g.x + 10); await m('mousePressed', g.x + 10, { clickCount: 1, buttons: 1 });
  for (let x = 26; x <= 90; x += 16) await m('mouseMoved', g.x + x, { buttons: 1 });
  await m('mouseReleased', g.x + 90, { clickCount: 1 });
  say(s.role === 'separator' && s.tab === null && !focus && s.cursor === 'auto' && s.line && Math.abs(s.share - 0.32) < 0.005 && s.now === '32' && (await q.locator('#services').boundingBox()).width === w,
    `no script: a still, painted divider at the split the page wrote (${(s.share * 100).toFixed(1)}%, aria-valuenow ${s.now}); it takes no focus and a drag does nothing`);
  await q.context().close();
}

say(errors.length === 0, 'no errors' + (errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''));
await browser.close();
console.log(bad ? `${bad} to fix` : 'ok: the groove answers a real mouse, real keys and a finger');
process.exit(bad ? 1 : 0);
