// A person at the charts: the light against the table's numbers, the words on the axes against
// the light, a real press that changes the numbers, reduced motion, a phone, and no script. In
// voxels and plain. Says ok or FAIL for each thing that must hold.
//   PORT=5989 node tools/parts/chart.mjs
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const port = process.env.PORT || 5989;
const url = `http://127.0.0.1:${port}/showcase/parts/chart.html?theme=light`;
await mkdir('shots/parts/chart', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
let bad = 0;
const say = (ok, what) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); };

async function open({ width = 1180, plain = false, reduced = false, wait = 700 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  if (plain) await ctx.addInitScript(() => { new MutationObserver((_, o) => { if (document.documentElement) { document.documentElement.setAttribute('data-vx-plain', ''); o.disconnect(); } }).observe(document, { childList: true }); });
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') p.errors.push(m.text()); });
  await p.goto(url);
  await p.waitForFunction(() => document.documentElement.dataset.ready === '1');
  if (wait) { await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(wait); }
  p.ctx = ctx;
  return p;
}

// One chart as it is now: the table's numbers, the scale's words, and what is drawn (in voxels:
// read from the model's own cells; plain: from the painted marks), all in voxels of the window.
const read = (p, id) => p.evaluate(async (id) => {
  const { MATERIALS } = await import('/packages/voxelmorphism/src/index.js');
  const fig = document.getElementById(id), win = fig.querySelector('.vx-chart-window'), table = fig.querySelector('table');
  const vx = 4, wr = win.getBoundingClientRect();
  const value = (c) => { const t = (c.dataset.vxValue ?? c.textContent).trim(); return t === '' ? null : Number(t); };
  const rows = [...table.tBodies[0].rows].map((r) => [...r.cells].slice(1).map(value));
  const ticks = [...fig.querySelectorAll('.vx-chart-y > span')].map((s) => { const r = s.getBoundingClientRect(); return { text: s.textContent, y: (r.top + r.height / 2 - wr.top) / vx }; });
  const names = [...fig.querySelectorAll('.vx-chart-x > span')].map((s) => ({ text: s.textContent, shown: !s.hidden, box: s.getBoundingClientRect() }));
  const tcs = getComputedStyle(table);
  const out = {
    rows, ticks, names: names.map((n) => n.text), shownNames: names.filter((n) => n.shown).map((n) => n.text),
    overlap: names.filter((n) => n.shown).some((n, i, a) => i && a[i - 1].box.right + 4 > n.box.left),
    w: wr.width / vx, h: wr.height / vx, hidden: win.getAttribute('aria-hidden'),
    table: { shown: tcs.display !== 'none' && tcs.visibility !== 'hidden', tiny: tcs.position === 'absolute' && tcs.clipPath !== 'none' },
    key: [...fig.querySelectorAll('.vx-chart-key li')].map((li) => `${li.querySelector('.vx-lamp').dataset.vxLight}:${li.textContent}`),
  };
  const l = window.vx.live(win);
  if (l) {
    const L = l.state.L, decode = (k) => [(k >>> 21) - 1024, ((k >>> 8) & 8191) - 4096, (k & 255) - 128];
    const cells = (part) => [...(l.model.byName[part]?.cells ?? [])].map(([k, id]) => [...decode(k), Object.values(MATERIALS).find((m) => m.id === id)?.name]);
    const fill = cells('fill'), studs = cells('studs');
    out.drawn = 'voxels';
    out.mats = [...new Set(l.model.parts.flatMap((pt) => [...pt.cells.values()]).map((id) => Object.values(MATERIALS).find((m) => m.id === id)?.name))].sort();
    out.L = { rows: L.rows, base: L.base, max: L.max };
    // each column: how many voxels of it are lit, its top lit row, and whether it has studs
    out.cols = L.cols.map((c) => {
      const mine = (x) => x >= c.x && x < c.x + c.w;
      const lit = fill.filter(([x, , z]) => mine(x) && z === -1), ys = lit.map(([, y]) => y);
      return { place: c.place, series: c.series, light: lit[0]?.[3] ?? null, litRows: new Set(ys).size, top: ys.length ? Math.min(...ys) : null, studs: studs.filter(([x]) => mine(x)).length };
    });
    out.points = L.points.map((pt) => ({ ...pt, lit: fill.filter(([x, y, z]) => x >= pt.x && x < pt.x + 2 && y >= pt.y && y < pt.y + 2 && z === -1).length }));
    const f = l.model.byName.fill;
    out.scales = f.scales ? [Math.min(...f.scales), Math.max(...f.scales)] : null;
    out.g = l.state.g;
  } else {
    out.drawn = 'plain';
    out.cols = [...fig.querySelectorAll('.vx-chart-marks > span:not([data-vx-light="stud"])')].map((s) => ({ top: parseFloat(s.style.top) / vx, litRows: parseFloat(s.style.height) / vx, light: s.dataset.vxLight }));
    out.studs = fig.querySelectorAll('.vx-chart-marks > span[data-vx-light="stud"]').length;
    out.points = [...fig.querySelectorAll('.vx-chart-marks rect')].map((r) => ({ x: +r.getAttribute('x'), y: +r.getAttribute('y') }));
    out.lines = fig.querySelectorAll('.vx-chart-marks polyline').length;
  }
  return out;
}, id);

// the number of rows of light a value should have, from the chart's own scale
const want = (v, rows, max) => (v == null ? 0 : Math.round((Math.min(v, max) / max) * rows));

for (const plain of [false, true]) {
  const tag = plain ? 'plain' : 'voxels';
  const p = await open({ plain });
  let d = await read(p, 'deploys');
  say(d.drawn === tag, `${tag}: the charts are drawn ${tag === 'plain' ? 'plain' : 'in voxels'}`);
  say(d.hidden === 'true' && d.table.shown && d.table.tiny, `${tag}: the window is aria-hidden, and the table is there for a screen reader (in the tree, clipped out of sight)`);
  const g = await read(p, 'gaps');
  say(g.table.shown && !g.table.tiny, `${tag}: data-vx-table="shown" keeps the table on the page as well`);
  say(Number.isInteger(d.w) && Number.isInteger(d.h), `${tag}: the window is whole voxels both ways (${d.w} by ${d.h})`);
  say(d.ticks.map((t) => t.text).join() === '0,5,10,15' && d.names.join() === 'Mon,Tue,Wed,Thu,Fri,Sat,Sun', `${tag}: the axes are words: ${d.ticks.map((t) => t.text).join(' ')} up the side, ${d.names.join(' ')} along the bottom`);
  say(d.key.join() === 'go:Went out,stop:Failed', `${tag}: two series: their names, each beside a lamp of its light (${d.key.join(', ')})`);

  // the light against the table
  const max = 15, rows = plain ? null : d.L.rows;
  if (!plain) {
    say(d.L.max === max, `${tag}: the scale runs to the next round number over the largest value (${d.L.max})`);
    const mism = d.cols.filter((c) => { const n = want(d.rows[c.place][c.series], rows, max); const expect = [...Array(n).keys()].filter((r) => r % 3 !== 2).length; return c.litRows !== expect; });
    say(mism.length === 0, `${tag}: every column's light is its number in the table, in lamps two rows tall a row apart (${d.cols.map((c) => c.litRows).join(' ')})`);
    say(d.cols.every((c) => c.light === null || c.light === (c.series ? 'light-stop' : 'light-go')), `${tag}: went out is on the green light, failed on the red`);
    const sun = d.cols.filter((c) => c.place === 6);
    say(sun.every((c) => c.litRows === 0 && c.studs > 0), `${tag}: Sunday, nought: no light, and its studs still show where its columns stand (${sun.map((c) => c.studs).join(', ')} studs)`);
    const allowed = ['floor', 'light', 'light-go', 'light-stop', 'light-warm', 'slate', 'steel'];
    const mats = [...new Set([...(await read(p, 'build')).mats, ...d.mats, ...(await read(p, 'hours')).mats])];
    say(mats.every((m) => allowed.includes(m)), `${tag}: its colours are only the look's lights, and steel, slate and floor: ${mats.join(' ')}`);
    say(d.scales[0] === 1 && d.g === 1, `${tag}: once grown, all its light is in`);
    say(await p.evaluate(() => window.vx.stage.awake.size) === 0, `${tag}: at rest nothing runs`);
  } else {
    // plain: the painted columns, against the same numbers
    // the scale's own words say how many rows it has: from the level of 0 to the level of its top
    const rowsP = Math.round(d.ticks[0].y - d.ticks.at(-1).y);
    const mism = d.cols.filter((c, i) => c.litRows !== want(d.rows[Math.floor(i / 2)][i % 2], rowsP, max));
    say(mism.length === 0, `${tag}: every painted column is its number in the table (${d.cols.map((c) => c.litRows).join(' ')})`);
    say(d.studs === d.cols.length, `${tag}: every column has its lamps not lit painted under it, so one at nought still shows where it stands (${d.studs})`);
  }
  // the words on the scale lie on the level they mark: Wednesday's 15 reaches the line marked 15
  const fifteen = d.ticks.find((t) => t.text === '15'), wed = d.cols.find((c) => (plain ? false : c.place === 2 && c.series === 0)) ?? d.cols[4];
  say(Math.abs(fifteen.y - wed.top) <= 0.5, `${tag}: the scale's 15 is level with the top of Wednesday's 15 (${fifteen.y.toFixed(2)} and ${wed.top})`);

  // the line
  const b = await read(p, 'build');
  say(b.ticks.map((t) => t.text).join() === '0,20,40,60,80', `${tag}: the line's scale: ${b.ticks.map((t) => t.text).join(' ')}`);
  const sixty = b.ticks.find((t) => t.text === '60');
  const wedP = plain ? b.points[2] : b.points.find((q) => q.place === 2);
  say(Math.abs(sixty.y - (wedP.y + 1)) <= 1, `${tag}: Wednesday's 61 s is a lamp on the line marked 60 (${(wedP.y + 1)} and ${sixty.y.toFixed(2)})`);
  if (!plain) say(b.points.length === 7 && b.points.every((q) => q.lit === 4), `${tag}: each of the 7 values is a lamp two voxels square`);
  const gp = await read(p, 'gaps');
  say(gp.points.length === 4 && (plain ? gp.lines === 2 : true), `${tag}: a value missing: 4 lamps for 5 days${plain ? ', and the line in two pieces' : ''}`);
  if (!plain) {
    const wedX = gp.points.find((q) => q.place === 1).x + 2, thuX = gp.points.find((q) => q.place === 3).x;
    const between = await p.evaluate(([a, z]) => { const l = window.vx.live(document.querySelector('#gaps .vx-chart-window')); let n = 0; for (const k of l.model.byName.fill.cells.keys()) { const x = (k >>> 21) - 1024; if (x > a + 1 && x < z - 1) n++; } return n; }, [wedX, thuX]);
    say(between === 0, `${tag}: and no light where it is missing`);
  }
  const z = await read(p, 'zero');
  say(z.ticks.map((t) => t.text).join() === '0,1', `${tag}: everything at nought: the scale is 0 and 1, counted in whole numbers (${z.ticks.map((t) => t.text).join(' ')})`);
  say(plain ? z.studs === 5 : z.cols.every((c) => c.litRows === 0 && c.studs > 0), `${tag}: and every column shows where it stands`);
  const uk = await read(p, 'uk');
  say(uk.ticks.at(-1).text === '100' && uk.ticks[1].text === '25', `${tag}: data-vx-max fixes the scale at 100 (${uk.ticks.map((t) => t.text).join(' ')})`);
  const tiny = plain ? uk.cols[3] : uk.cols.find((c) => c.place === 3);
  say(tiny.litRows === 1, `${tag}: 0,4 on a scale to 100 still has a row of light, so it is not read as nought (${tiny.litRows})`);

  // a real press changes the numbers: the chart hears its table
  await p.locator('#week').scrollIntoViewIfNeeded();
  const kb = await p.locator('#week').boundingBox();
  await p.mouse.move(kb.x + kb.width / 2, kb.y + kb.height / 2, { steps: 5 });
  await p.mouse.down(); await p.waitForTimeout(70); await p.mouse.up();
  await p.waitForTimeout(60);
  const mid = await read(p, 'deploys');
  if (!plain) say(mid.scales[0] === 0 && mid.g < 1, `${tag}: the numbers change: the light grows again from the bottom (g ${mid.g.toFixed(2)})`);
  await p.waitForTimeout(1100);
  d = await read(p, 'deploys');
  const n0 = plain ? null : d.L.rows;
  if (!plain) {
    const mism = d.cols.filter((c) => { const n = want(d.rows[c.place][c.series], n0, d.L.max); return c.litRows !== [...Array(n).keys()].filter((r) => r % 3 !== 2).length; });
    say(d.rows[0][0] === 8 && mism.length === 0 && d.scales[0] === 1, `${tag}: and stands at the week before's numbers (Mon ${d.rows[0][0]}, scale to ${d.L.max})`);
    say(await p.evaluate(() => window.vx.stage.awake.size) === 0, `${tag}: then nothing runs`);
  } else say(d.rows[0][0] === 8 && d.cols[0].litRows === want(8, Math.round(d.ticks[0].y - d.ticks.at(-1).y), 15), `${tag}: the numbers change: the painted columns follow (Mon ${d.rows[0][0]})`);
  say(d.ticks.map((t) => t.text).join() === '0,5,10,15', `${tag}: the scale is written again (${d.ticks.map((t) => t.text).join(' ')})`);

  await p.locator('#deploys').screenshot({ path: `shots/parts/chart/hand-${tag}.png` });
  say(p.errors.length === 0, `${tag}: no errors` + (p.errors.length ? ': ' + [...new Set(p.errors)].join(' | ') : ''));
  await p.ctx.close();
}

// reduced motion: the light is there on the first frame, and stays put when the numbers change
{
  const p = await open({ reduced: true, wait: 0 });
  await p.evaluate(() => new Promise(requestAnimationFrame));
  let d = await read(p, 'deploys');
  say(d.scales && d.scales[0] === 1 && d.g === 1, `reduced motion: on the first frame every column is full (g ${d.g})`);
  await p.locator('#week').click();
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  d = await read(p, 'deploys');
  say(d.scales[0] === 1 && d.rows[0][0] === 8 && d.cols.find((c) => c.place === 0 && c.series === 0).litRows > 0, 'reduced motion: the numbers change and the columns are there at once, with no growing');
  say(p.errors.length === 0, 'reduced motion: no errors' + (p.errors.length ? ': ' + [...new Set(p.errors)].join(' | ') : ''));
  await p.ctx.close();
}

// a phone
for (const plain of [false, true]) {
  const tag = plain ? 'phone, plain' : 'phone, voxels';
  const p = await open({ width: 390, plain });
  const side = await p.evaluate(() => { scrollTo(200, 0); const x = scrollX; scrollTo(0, 0); return x; });
  say(side === 0, `${tag}: the page does not move sideways`);
  const h = await read(p, 'hours');
  say(h.shownNames.length < h.names.length && !h.overlap && h.shownNames[0] === '00', `${tag}: 24 hours in a narrow window: ${h.shownNames.length} names written, none running into the next`);
  const out = await p.evaluate(() => {
    const sheet = document.querySelector('.sheet').getBoundingClientRect();
    return [...document.querySelectorAll('.vx-chart-window, .vx-chart-y > span, .vx-chart-x > span:not([hidden])')].filter((e) => { const r = e.getBoundingClientRect(); return r.left < sheet.left || r.right > sheet.right; }).length;
  });
  say(out === 0, `${tag}: no window and no word reaches past the panel (${out})`);
  say(p.errors.length === 0, `${tag}: no errors` + (p.errors.length ? ': ' + [...new Set(p.errors)].join(' | ') : ''));
  await p.ctx.close();
}

// no script: the table is the chart
{
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 900 }, javaScriptEnabled: false });
  const p = await ctx.newPage();
  await p.goto(url);
  const s = await p.evaluate(() => [...document.querySelectorAll('.vx-chart')].map((f) => [getComputedStyle(f.querySelector('.vx-chart-window')).display, f.querySelector('table').getBoundingClientRect().width > 50]));
  say(s.every(([d, t]) => d === 'none' && t), `no script: no empty window, and every chart's table is on the page to be read (${s.length} charts)`);
  await ctx.close();
}

await browser.close();
console.log(bad ? `${bad} to fix` : 'ok: chart');
process.exit(bad ? 1 : 0);
