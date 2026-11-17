// Things of finer cells (#372): a thing made as a program stands in a shared world as cells of 1.25 cm, is solid to
// the world, is picked up and put down as the same cells, is taken out again, and is made better behind its first
// making. The real server and world process; programs kept here stand in for the model (no model is run); a page
// at the end sees it, with no switch said.
//
//   node test/fine.mjs [--out picture.png] [--no-page]
import { bodyOf } from '../make/drivable.mjs'
import { mkdtempSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { make, undo } from '../make.mjs'
import { wished } from '../make/best.mjs'
import { THING_ROWS_MOST } from '../make/form.mjs'
import { SHIPPED, library } from '../make/library.mjs'
import { made, refused } from '../make/program.mjs'
import { read as readCells } from '../make/cells.mjs'
import { arg, chrome, has, serve } from './kit.mjs'

const dir = mkdtempSync(join(tmpdir(), 'engine-fine-')), file = join(dir, 'world.log'), journal = join(dir, 'made.jsonl')
const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
const server = await serve('/dev/null', ['--world', file])
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const send = async (path, init) => { for (;;) { const r = await fetch(`${server.url}/world/${path}`, init); if (r.status === 429) { await wait(400); continue } return r.ok ? r.json() : { refused: r.status, why: await r.text() } } }
const get = (path) => send(path), post = (path, body) => send(path, { method: 'POST', body: JSON.stringify(body) })
const until = async (what, ask, ms = 10_000) => { for (const began = Date.now(); Date.now() - began < ms; await wait(150)) { const v = await ask(); if (v) return v } throw new Error(`never: ${what}`) }

// A sword standing on its point, in cells of 1.25 cm: a blade, a guard, a grip, a pommel. And a better one.
const SWORD = `size(24, 88, 6, 1.25); name('a plain sword')
for (let y = 0; y < 64; y++) { const half = y < 6 ? 0.5 + y * 0.25 : 2; box('steel', y % 9 ? 'grey:3' : 'grey:5', 12 - half, y, 2, 12 + half, y + 1, 4) }
box('steel', '3:5', 4, 64, 1, 20, 67, 5)
for (let y = 67; y < 82; y++) box('wood', y % 2 ? '2:6' : '2:8', 10.5, y, 1.5, 13.5, y + 1, 4.5)
ball('steel', '3:4', 12, 85, 3, 3)`
const BETTER = SWORD.replace('a plain sword', 'a better sword').replace("ball('steel', '3:4', 12, 85, 3, 3)", "ball('steel', '3:4', 12, 85, 3, 3); put('lamp', '0:4', 12, 85, 0)")
const canned = (text, count) => async () => { count.n++; return { text, model: 'a kept program (no model was run)', ms: 0, cost: 0 } }

try {
  // What comes with the engine (make/kept): every kept thing is a program that still runs and reads, in a cell the reader takes, within a thing's rows whichever way it faces.
  for (const name of await readdir(SHIPPED)) {
    const e = JSON.parse(await readFile(join(SHIPPED, name), 'utf8'))
    let said = ''
    try {
      const k = await made(e.reply), [w, h, d] = k.size
      // What is kept of it as cells (#220, what it is made from when asked for) is what its program makes, cell for cell.
      const r = e.made ? readCells(e.made, { joined: e.proved?.joined }) : null
      // A car that is driven (#245) is kept alive: its look is those cells, laid as a body lays them (make/drivable.mjs `bodyOf`).
      const look = r?.living?.look[0], c = look ? { cm: 10 / look.per, size: look.size, cells: look.kinds } : r, want = look ? bodyOf(k) : k.cells
      check(!!c && c.cm === k.cm && c.size.join() === k.size.join() && c.cells.every((v, i) => v === want[i]) && e.proved?.joined, `kept with the engine, ${e.wish}${e.apart ? ` (${e.apart})` : ''} is kept as the cells its program makes${e.proved?.stands ? ', and stood whole' : ''}`)
      let along = 0, across = 0
      for (let y = 0; y < h; y++) { for (let z = 0; z < d; z++) { let last = 0; for (let x = 0; x < w; x++) { const c = k.cells[(y * d + z) * w + x]; if (c && c !== last) along++; last = c } } for (let x = 0; x < w; x++) { let last = 0; for (let z = 0; z < d; z++) { const c = k.cells[(y * d + z) * w + x]; if (c && c !== last) across++; last = c } } }
      said = e.form === 'program' && e.grade === 'best' && Math.max(along, across) <= THING_ROWS_MOST ? `${k.size.join(' x ')} of ${k.cm} cm, ${Math.max(along, across)} rows` : `form ${e.form}, grade ${e.grade}, ${Math.max(along, across)} rows`
      check(e.form === 'program' && e.grade === 'best' && Math.max(along, across) <= THING_ROWS_MOST, `kept with the engine, ${e.wish}${e.apart ? ` (${e.apart})` : ''} runs and reads: ${said}`)
    } catch (err) { check(false, `kept with the engine, ${e.wish} runs and reads (${err.message})`) }
  }
  // The box a program runs in.
  const t = await made(SWORD)
  check(t.cm === 1.25 && t.size[1] === 88 && t.filled > 500 && t.crumbs === 0, `a program is run and what it built is read: ${t.size.join(' x ')} cells of ${t.cm} cm, ${t.filled} filled`)
  for (const [bad, why] of [['size(8, 8, 8, 3)', /cell/], ["size(8, 8, 8, 10); put('gold', 'own', 1, 0, 1)", /not a material/], ["size(8, 8, 8, 10); put('steel', 'own', 1, 3, 1)", /ground/], ['const a = []; size(4, 4, 4, 10); for (;;) a.push(new Array(1e6).fill(1))', /memory/], ['size(4, 4, 4, 10); process.exit(1)', /not defined/], ['size(300, 4, 4, 10)', /256/]]) {
    let said = ''
    try { await made(bad) } catch (e) { said = refused(e) ? e.message : `threw ${e.message}` }
    check(why.test(said), `a program that is wrong is refused with why (${said.slice(0, 70)})`)
  }

  // What the server takes of rows of finer cells.
  const none = (edit, more = {}) => post('ask', { by: 'tester', edit, release: [700, 200, 4040], ...more })
  check((await none([3, 1, 10, 10, 5, 5, 9])).refused === 400, 'a row of finer cells that runs nowhere is refused')
  check((await none([5, 1, 10, 11, 5, 5, 9])).refused === 400, 'an edit of a tag the world does not know is refused')
  check((await none([3, 2, 10, 11, 5, 5, 9])).refused === 400, 'rows of finer cells cut short are refused')
  check((await none(new Array(65537).fill(1))).refused === 400, 'an edit that is no thing is held to the usual size')
  check((await none([3, 1, 5600, 5604, 1600, 32800, 9], { thing: { id: 'alive', name: 'a block', wish: 'a block', at: [1400, 400, 8200], size: [1, 1, 1], facing: 'south', controls: { motor: [] } } })).refused === 400, 'a thing of finer cells is not given controls')
  // What a thing may be is bounded (the review of November 14): its cells, and what a hand will take.
  const wide = []
  for (let i = 0; i < 4097; i++) wide.push(0, 4096, 300 + (i >> 6), 4100 + (i & 63), 9)
  const record0 = (id) => ({ id, name: 'a slab', wish: 'a slab', at: [700, 300, 4100], size: [64, 64, 64], facing: 'south' })
  check((await none([1, wide.length / 5, ...wide], { thing: record0('slab') })).refused === 400, 'a thing of more cells than a grid 256 a side is refused')
  const long = []
  for (let y = 0; y < 3; y++) long.push(600, 670, 400 + y, 4100, 9)
  check((await none([1, 3, ...long], { thing: { ...record0('beam'), at: [635, 400, 4100] } })).asked, 'a beam seven metres long is made')
  await post('join', { by: 'robin', at: [640, 4104] })
  await post('ask', { by: 'robin', hold: 'beam' })
  await wait(1500)
  check(!(await get('things')).find((t) => t.id === 'beam')?.held, 'and is too big for a hand: it stays where it is')

  // Made in the world: fine rows, a record that says its grain, solid to the world's own process.
  const at = [700, 4040], count = { n: 0 }
  const r = await make({ wish: 'a sword', world: server.url, where: { at }, by: 'Ada', journal, how: 'program', model: canned(SWORD, count) })
  check(r.state === 'there' && r.grain === 8 && r.rows > 80, `a thing made as a program stands in the world as finer cells: ${r.state}${r.why ? ` (${r.why})` : ''}, grain ${r.grain}, ${r.rows} rows`)
  const record = async (id) => (await get('things')).find((t) => t.id === id)
  const first = await record(r.id), o = r.origin
  check(first?.grain === 8 && first.at.join() === o.join(), `its record says its grain (${first?.grain}) and where it stands`)
  const solid = async (x, y, z) => (await get(`at?x=${x}&y=${y}&z=${z}`)).material !== 0
  check(await solid(o[0], o[1] + 3, o[2]), 'the world takes a cell that holds finer cells as a cell: it is stood on and walked into')
  const kept = (await get(`things?id=${r.id}`)).cells.length / 5
  check(kept === r.rows, `the world keeps every row of it (${kept})`)

  // Picked up and put down: the same cells, still fine.
  await post('join', { by: 'wren', at: [o[0] + 6, o[2]] })
  check((await post('ask', { by: 'wren', hold: r.id })).asked, 'it is picked up')
  await until('its cells are gone', async () => !(await solid(o[0], o[1] + 3, o[2])))
  check((await record(r.id)).held === 'wren', 'picked up, its cells leave the world')
  const me = (await get('me?by=wren')).you
  check((await post('ask', { by: 'wren', put: true, at: [o[0] + 12, me.at[1], o[2]] })).asked, 'it is put down')
  const down = await until('it stands again', async () => { const t = await record(r.id); return t && !t.held ? t : null })
  const again = (await get(`things?id=${r.id}`)).cells.length / 5
  check(down.grain === 8 && again === r.rows && (await solid(down.at[0], down.at[1] + 3, down.at[2])), `put down it is the same thing: grain ${down.grain}, ${again} rows of ${r.rows}`)

  // At once, then better: the first stands, the better one takes its place and is kept; asked again, no model.
  const shelf = library(join(dir, 'library'), []), quick = { n: 0 }, best = { n: 0 }, where = { at: [720, 4040] }
  const w = await wished({ wish: 'a sword', world: server.url, where, by: 'Ada', journal, shelf, first: canned(SWORD, quick), best: canned(BETTER, best) })
  check(w.first.state === 'there' && w.first.name === 'a plain sword', `a wish is made at once by the quick model (${w.first.state}${w.first.why ? `: ${w.first.why}` : ''})`)
  const b = await w.better
  const now = (await get('things')).filter((t) => t.wish === 'a sword' && t.id !== r.id)
  check(b.state === 'there' && now.length === 1 && now[0].name === 'a better sword' && Math.abs(now[0].at[0] - w.first.origin[0]) <= 1 && Math.abs(now[0].at[2] - w.first.origin[2]) <= 1, `the better one takes its place where it stood: ${b.state}${b.why ? ` (${b.why})` : ''}, ${now.map((t) => `${t.name} at ${t.at}`).join(', ')} (the first at ${w.first.origin})`)
  const entry = JSON.parse(await readFile(join(dir, 'library', (await readdir(join(dir, 'library')))[0]), 'utf8'))
  check(entry.grade === 'best' && entry.form === 'program', `the better one is what is kept (${entry.grade}, ${entry.form})`)
  const w2 = await wished({ wish: 'a sword please', world: server.url, where: { at: [740, 4040] }, by: 'Bea', journal, shelf, first: canned(SWORD, quick), best: canned(BETTER, best) })
  check(w2.first.state === 'there' && w2.first.name === 'a better sword' && w2.better === null && quick.n === 1 && best.n === 1, `asked again it is the better one at once, with no model (${w2.first.name}; models run ${quick.n} and ${best.n} times)`)
  // A first one that someone holds is not replaced: the better one is kept all the same.
  const shelf2 = library(join(dir, 'library2'), [])
  let hold
  const w3 = await wished({ wish: 'a blade', world: server.url, where: { at: [760, 4040] }, by: 'Ada', journal, shelf: shelf2, first: canned(SWORD, quick), best: async (q) => { while (!hold) await wait(50); await post('ask', { by: 'wren', hold: hold.id }); await until('held', async () => (await record(hold.id))?.held === 'wren'); return canned(BETTER, best)(q) } })
  hold = w3.first
  const b3 = await w3.better
  check(b3.state === 'kept' && (await record(hold.id))?.held === 'wren', `a first one that is in a hand is left there, and the better one kept (${b3.state})`)

  // A crowd of fine things is not made (#367's bound: one fine thing's worth in view): where one bigger than a hand's stands within 20 m, the next goes in as cells of the world's own.
  const POST = `size(12, 100, 12, 2.5); name('a post'); for (let y = 0; y < 100; y++) box('wood', y % 7 ? '2:6' : '2:8', 3, y, 3, 9, y + 1, 9); ball('lamp', 'own', 6, 96, 6, 5)`
  const posts = []
  for (const x of [900, 930, 960]) posts.push(await make({ wish: 'a post', world: server.url, where: { at: [x, 4040] }, by: 'Ada', journal, how: 'program', model: canned(POST, count) }))
  check(posts.every((p) => p.state === 'there') && posts[0].grain === 4 && posts[1].grain === undefined && posts[1].coarse === true && posts[2].grain === undefined, `the first of three near each other stands as finer cells and the next two as cells of the world's own (${posts.map((p) => `${p.state} ${p.grain ?? 'plain'}`).join(', ')})`)

  // A thing of more rows than a plain edit may be is taken out as it was put in, and its better takes its place.
  const BIG = `size(60, 40, 40, 2.5); name('a speckled block'); for (let y = 0; y < 40; y++) for (let z = 0; z < 40; z++) for (let x = 0; x < 60; x++) put('plaster', (x + y + z) % 2 ? '0:4' : '4:4', x, y, z)`
  const big = await wished({ wish: 'a speckled block', world: server.url, where: { at: [1000, 4040] }, by: 'Ada', journal, shelf: library(join(dir, 'library3'), []), first: canned(BIG, quick), best: canned(BIG.replace('a speckled block', 'a better block'), best) })
  const bigger = await big.better
  const blocks = (await get('things')).filter((t) => t.wish === 'a speckled block')
  check(big.first.rows > 13107 && bigger.state === 'there' && blocks.length === 1 && blocks[0].name === 'a better block', `a thing of ${big.first.rows} rows is taken out for its better: ${bigger.state}${bigger.why ? ` (${bigger.why})` : ''}, ${blocks.map((t) => t.name).join(', ')}`)
  // What the review of the removal found: a thing's cells lie where its record says, and what is held is not taken out with its cells.
  check((await none([1, 1, 5000, 5001, 300, 9000, 9], { thing: { id: 'astray', name: 'a cell', wish: 'a cell', at: [700, 300, 4100], size: [1, 1, 1], facing: 'south' } })).refused === 400, 'a thing whose cells are not where its record says is refused')
  check((await post('ask', { by: 'tester', gone: hold.id, release: [760, 200, 4040] })).refused === 409, 'a thing someone holds is not taken out with its cells')

  // Taken out again.
  const gone = await undo({ world: server.url, id: w2.first.id, by: 'Bea', journal })
  check(gone.state === 'undone' && !(await record(w2.first.id)) && !(await solid(w2.first.origin[0], w2.first.origin[1] + 3, w2.first.origin[2])), `a thing of finer cells is taken out whole (${gone.state}${gone.why ? `: ${gone.why}` : ''})`)

  if (!has('no-page')) {
    // A page with no switch said: the world holds finer cells, so it looks into them; it knows the thing and its grain.
    const browser = await chrome(), page = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })).newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(`${server.url}/city?fly=0&shared=1&people=0&name=Bea&at=${now[0].at[0] / 10 + 0.3},${now[0].at[1] / 10 + 1.2},${now[0].at[2] / 10 + 2.2}&look=0,-12`)
    await page.waitForFunction(() => globalThis.engine?.things?.all?.size > 0 && globalThis.engine.world.options.bricks === true, null, { timeout: 120_000 })
    await page.waitForFunction(() => { const s = globalThis.engine.world.stats; return s.wanted === 0 && s.stale === 0 && s.ready > 0 }, null, { timeout: 120_000 })
    const seen = await page.evaluate((id) => { const e = globalThis.engine, t = e.things.all.get(id); return { grain: t?.grain, rows: t ? t.cells.length / 5 : 0, refused: e.world.stats.refused, bricks: e.world.options.bricks } }, now[0].id)
    check(seen.grain === 8 && seen.rows === b.rows && seen.refused === 0 && seen.bricks && !errors.length, `another player's page sees it as finer cells with no switch said: grain ${seen.grain}, ${seen.rows} rows, ${seen.refused} sectors refused${errors.length ? `, ${errors[0]}` : ''}`)
    if (arg('out', '')) { await page.waitForTimeout(1500); await page.screenshot({ path: arg('out') }) }
    await browser.close()
  }
} catch (e) { failures.push(`stopped: ${e.message}`); console.error(e) }
server.stop()
if (failures.length) { console.error(`FAILED\n  ${failures.join('\n  ')}`); process.exit(1) }
console.log('fine: ok')
process.exit(0)
