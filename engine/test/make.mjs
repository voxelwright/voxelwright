// Making (#220): a wish, a model's reply and a place become a thing of cells in a shared world, whole or not at all.
//
// NO MODEL IS RUN HERE. Replies kept in this file stand in for one, and a small script stands in for the binary
// where the run itself is what is tried (slow, failing, started with a tool). This proves the plumbing: the form,
// its refusals, the placing and the sending. That a real model answers in the form is proved by a real run
// (engine/README.md, "Making"), not by this.
//
//   node test/make.mjs
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir, userInfo } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { make, put, undo } from '../make.mjs'
import { ran as runsOf, read as readCells, written } from '../make/cells.mjs'
import { turned } from '../make/alive.mjs'
import { importTo } from '../make/import.mjs'
import { fineCar } from '../page/living.ts'
import { library, recalled } from '../make/library.mjs'
import { BRIEF } from '../make/brief.mjs'
import { ROWS_MOST, read, rows as formRows } from '../make/form.mjs'
import { reply } from '../make/model.mjs'
import { at, send } from '../make/place.mjs'
import { serve } from './kit.mjs'

const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
const dir = mkdtempSync(join(tmpdir(), 'engine-make-')), journal = join(dir, 'made.jsonl')
const server = await serve('/dev/null', ['--world', join(dir, 'world.log')])
const world = server.url

/** How many things have been done to the world: the number its stream gives the frame that says "you are up to date". */
async function done() {
  const res = await fetch(`${world}/world/stream`), reader = res.body.getReader()
  let bytes = Buffer.alloc(0)
  for (;;) {
    const { value, done: ended } = await reader.read()
    if (ended) throw new Error('the stream ended')
    bytes = Buffer.concat([bytes, value])
    for (let i = 0; i + 12 <= bytes.length; i += 12 + bytes.readUInt32LE(i + 8)) if (bytes.readUInt32LE(i) === 4) { await reader.cancel(); return bytes.readUInt32LE(i + 4) }
  }
}

const STALL = { name: 'fruit stall', size: [34, 25, 18], parts: [
  ['box', 'wood', '2:6', 2, 0, 2, 4, 24, 4], ['box', 'wood', '2:6', 30, 0, 2, 32, 24, 4], ['box', 'wood', '2:6', 2, 0, 14, 4, 24, 16], ['box', 'wood', '2:6', 30, 0, 14, 32, 24, 16],
  ['box', 'wood', 'own', 2, 8, 2, 32, 9, 16], ['box', 'wood', '2:5', 4, 0, 3, 30, 8, 4],
  ['stripes', 'plaster', '0:4', 0, 24, 0, 34, 25, 18, 'x', 4, 'white'],
  ['box', 'leaves', '2:4', 6, 9, 5, 9, 11, 8], ['box', 'leaves', '0:4', 11, 9, 5, 14, 11, 8], ['ball', 'leaves', '8:4', 16, 9, 5, 19, 12, 8],
  ['cyl', 'wood', 'own', 22, 9, 5, 26, 13, 9, 'y'], ['text', 'lamp', '3:1', 3, 1, 2, 'FRUIT'],
] }
const kept = (thing) => async () => ({ text: JSON.stringify(thing), model: 'a kept reply', ms: 0, cost: 0 })
const say = (r) => `${r.state}${r.why ? `: ${r.why.slice(0, 90)}` : ''}`
try {
  // ── The form, by itself ──
  const stall = read(JSON.stringify(STALL))
  check(stall.filled > 900 && stall.cells.every((k) => (k & 0xf0) === 0 && (k & 15) !== 5), `a reply in the form is read: ${stall.filled} cells, none of them water, none with a bit a reply may not set`)
  const bad = {
    'words round the JSON': `Here it is:\n${JSON.stringify(STALL)}`,
    'a field that is not the form\'s': JSON.stringify({ ...STALL, run: 'rm -rf ~' }),
    'a kind as a number': JSON.stringify({ ...STALL, parts: [['box', 21, 'own', 0, 0, 0, 2, 2, 2]] }),
    'water': JSON.stringify({ ...STALL, parts: [['box', 'water', 'own', 0, 0, 0, 2, 2, 2]] }),
    'a colour that is not one': JSON.stringify({ ...STALL, parts: [['box', 'wood', '24:3', 0, 0, 0, 2, 2, 2]] }),
    'a box outside its size': JSON.stringify({ ...STALL, parts: [['box', 'wood', 'own', 0, 0, 0, 35, 2, 2]] }),
    'half a cell': JSON.stringify({ ...STALL, parts: [['box', 'wood', 'own', 0, 0, 0, 2.5, 2, 2]] }),
    'a size past the most': JSON.stringify({ ...STALL, size: [900, 25, 18] }),
    'a part that floats': JSON.stringify({ ...STALL, parts: [...STALL.parts, ['box', 'wood', 'own', 10, 15, 6, 14, 19, 10]] }),
    'nothing on the ground': JSON.stringify({ ...STALL, parts: [['box', 'wood', 'own', 0, 3, 0, 2, 5, 2]] }),
    'a shape that is not one': JSON.stringify({ ...STALL, parts: [['script', 'wood', 'own', 0, 0, 0, 2, 2, 2]] }),
  }
  for (const [what, text] of Object.entries(bad)) {
    let why = ''
    try { read(text) } catch (e) { why = e.message }
    check(why !== '', `refused: ${what} (${why.slice(0, 70)})`)
  }
  const crumbed = read(JSON.stringify({ ...STALL, parts: [...STALL.parts, ['box', 'wood', 'own', 10, 15, 8, 12, 17, 10]] }))
  check(crumbed.crumbs === 8 && crumbed.filled === stall.filled, `a few cells that touch nothing are left out and counted (${crumbed.crumbs}), and the rest is as it was`)
  const me = userInfo().username
  check(!/village/i.test(BRIEF) && !BRIEF.includes(homedir()) && !BRIEF.includes(me) && !BRIEF.includes('/Users/'), 'what the model is told names no project, no person and no place on a disk')

  // ── Into a world ──
  const before = await done()
  const where = { at: [700, 4070] }
  const asked = []
  const first = await make({ wish: 'a fruit stall', world, where, journal, model: async (q) => { asked.push(q); return (await kept(STALL)()) } })
  const cell = first.origin ? await at(world, [first.origin[0], first.origin[1] + 8, first.origin[2]]) : {}
  check(first.state === 'there' && cell.material === 10 && (await done()) === before + 1, `a wish is made: ${first.name}, ${first.cells} cells in ${first.rows} runs, and the world was asked one thing (${say(first)})`)
  check(asked.length === 1 && asked[0].prompt === 'a fruit stall' && asked[0].system === BRIEF, 'the model was given the brief and the wish, and nothing else')
  const lines = readFileSync(journal, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  check(lines.length === 2 && lines[0].state === 'sending' && lines[1].state === 'there' && lines[0].id === lines[1].id, 'it was written down before it was sent, and what came of it after')

  // The same place again: taken, so it stands beside the first. A wish is not turned down for where it was aimed.
  const mark0 = await done()
  const second = await make({ wish: 'a fruit stall', world, where, journal, model: kept(STALL) })
  check(second.state === 'there' && second.moved > 0 && second.moved <= 80 && (await done()) === mark0 + 1, `the same place again: it is made beside the first, ${second.moved} cells off (${say(second)})`)
  const roof = await make({ wish: 'a fruit stall', world, where: { from: [700, 400, 4060], toward: [0, 1, 0] }, journal, model: kept(STALL), dry: true })
  check(roof.state === 'dry' && roof.origin, `aimed at the sky, it goes on the ground ahead (${say(roof)})`)
  const mark = await done()

  // A reply nothing can be made of: asked three times, told why, then given up, and the world is as it was.
  const free = { at: [760, 4070] }
  for (const [what, text] of [['never JSON', 'I would rather not.'], ['nothing that reaches the ground', bad['nothing on the ground']]]) {
    const prompts = []
    const r = await make({ wish: 'a fruit stall', world, where: free, journal, model: async (q) => { prompts.push(q.prompt); return { text, model: 'a kept reply', ms: 0, cost: 0 } } })
    check(r.state === 'refused' && r.tries === 3 && prompts[1].includes('could not be used') && (await done()) === mark, `a reply that is ${what} is asked for three times, told why, and nothing is sent (${say(r)})`)
  }
  // A reply that is mostly right is made, without what could not be used and without asking again.
  for (const [what, text] of [['with a floating part', bad['a part that floats']], ['with a field of its own', bad['a field that is not the form\'s']], ['with words round it', bad['words round the JSON']], ['with a part of water', JSON.stringify({ ...STALL, parts: [...STALL.parts, ['box', 'water', 'own', 0, 0, 0, 2, 2, 2]] })]]) {
    const r = await make({ wish: 'a fruit stall', world, where: free, journal, model: async () => ({ text, model: 'a kept reply', ms: 0, cost: 0 }), dry: true })
    check(r.state === 'dry' && r.tries === 1 && r.made.every((row) => (row[4] & 15) !== 5 && (row[4] & 0xf0) === 0), `a reply ${what} is made without it, asked once (${say(r)}${r.left ? `, ${r.left} in a hundred left out` : ''})`)
  }
  // Joined face to face, but more than its joins carry: the core's own rule, asked before it is sent. The slab
  // would fall, so the model is asked again; when it never does better, what stands of the best reply is made.
  const heavy = { name: 'a slab on a stick', size: [60, 30, 40], parts: [['box', 'plaster', 'own', 0, 0, 0, 1, 28, 1], ['box', 'plaster', 'own', 0, 28, 0, 60, 30, 40]] }
  const told = []
  const fell = await make({ wish: 'a slab on a stick', world, where: free, journal, model: async (q) => { told.push(q.prompt); return kept(heavy)() }, dry: true })
  check(fell.state === 'dry' && fell.tries === 3 && /come loose/.test(told[1]) && /part 2/.test(told[1]) && fell.left > 50 && fell.made.every((row) => row[2] < fell.origin[1] + 28), `a thing whose joins would not carry it: the model is told which part would fall, and in the end what stands is made without it (${say(fell)}, ${fell.left} in a hundred left out)`)
  // More runs than an edit may be.
  const fine = { name: 'pinstripes', size: [40, 40, 40], parts: [['stripes', 'plaster', 'white', 0, 0, 0, 40, 40, 40, 'x', 1, 'black']] }
  const many = await make({ wish: 'pinstripes', world, where: free, journal, model: kept(fine) })
  check(many.state === 'refused' && /runs/.test(many.why) && (await done()) === mark, `a thing of more than ${ROWS_MOST} runs is refused (${say(many)})`)
  // A second try that is right is used.
  let turn = 0
  const twice = await make({ wish: 'a fruit stall', world, where: free, journal, model: async () => (turn++ ? kept(STALL)() : { text: 'not yet', model: 'a kept reply', ms: 0, cost: 0 }) })
  check(twice.state === 'there' && twice.tries === 2 && (await done()) === mark + 1, `a reply refused once and right the second time is made (${say(twice)})`)

  // ── The run itself: a script in the binary's place ──
  const fake = (body) => { const path = join(dir, `fake-${Math.random().toString(36).slice(2)}.mjs`); writeFileSync(path, `#!/usr/bin/env node\n${body}`); chmodSync(path, 0o755); return path }
  const lines2 = (init, result) => `console.log(JSON.stringify(${JSON.stringify(init)})); console.log(JSON.stringify(${JSON.stringify(result)}))`
  const init = { type: 'system', subtype: 'init', tools: [], mcp_servers: [], model: 'a script' }, ok = { type: 'result', subtype: 'success', is_error: false, result: JSON.stringify(STALL), usage: {}, total_cost_usd: 0 }
  const runs = {
    'is too slow and is stopped': [fake('setTimeout(() => {}, 60000)'), 400],
    'ends in failure': [fake('process.exit(1)'), 5000],
    'says it failed': [fake(lines2(init, { ...ok, is_error: true })), 5000],
    'was started with a tool': [fake(lines2({ ...init, tools: ['Bash'] }, ok)), 5000],
    'was started with a server': [fake(lines2({ ...init, mcp_servers: [{ name: 'files' }] }, ok)), 5000],
  }
  const there = { at: [820, 4070] }, held = await done()
  for (const [what, [binary, limit]] of Object.entries(runs)) {
    const r = await make({ wish: 'a fruit stall', world, where: there, journal, model: (q) => reply({ ...q, binary, limit }) })
    check(r.state === 'refused' && r.tries === 1 && (await done()) === held, `a run that ${what} makes nothing and is not tried again (${say(r)})`)
  }
  const ran = await make({ wish: 'a fruit stall', world, where: there, journal, model: (q) => reply({ ...q, binary: fake(`if (process.cwd().includes(${JSON.stringify(me)}) || process.env.NODE_OPTIONS !== undefined || !process.argv.includes('--tools') || !process.argv.includes('--strict-mcp-config') || !process.argv.includes('--no-session-persistence')) process.exit(3); ${lines2(init, ok)}`), limit: 5000 }) })
  check(ran.state === 'there' && (await done()) === held + 1, `a run that goes well is made; it was started in a folder that does not name the asker, with no tools, servers or session asked for (${say(ran)})`)

  // ── A send whose answer is lost ──
  const dry = await make({ wish: 'a fruit stall', world, where: { at: [880, 4070] }, journal, model: kept(STALL), dry: true })
  const count = await done()
  const lost = await send(world, dry.made, 'check', { post: async (...a) => { await fetch(...a); throw new Error('cut') } })
  check(lost.state === 'there' && (await done()) === count + 1, `a send that arrived but whose answer was lost is found there, and was sent once (${say(lost)})`)
  const dry2 = await make({ wish: 'a fruit stall', world, where: { at: [940, 4070] }, journal, model: kept(STALL), dry: true })
  const never = await send(world, dry2.made, 'check', { wait: 1200, post: async () => { throw new Error('cut') } })
  check(never.state === 'not there' && (await done()) === count + 1, `a send that never arrived is found not there, and is not sent again by itself (${say(never)})`)
  const refusedByWorld = await send(world, [[0, 5000, 200, 0, 10]], 'check')
  check(refusedByWorld.state === 'not there' && /refused/.test(refusedByWorld.why) && (await done()) === count + 1, `what the world's own check refuses is not there (${say(refusedByWorld)})`)

  // ── Cells (make/cells.mjs): a reply that is the thing's cells, data only ──
  // A bench of 2.5 cm cells: a seat on four legs, a back, two colours.
  const grid = (w, h, d, fill) => { const c = new Uint16Array(w * h * d); for (let y = 0; y < h; y++) for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) c[(y * d + z) * w + x] = fill(x, y, z); return c }
  const WOOD = 10 | (26 << 8), STEEL = 12 | (3 << 8)
  const bench = { name: 'a bench', size: [60, 36, 20], cm: 2.5, cells: grid(60, 36, 20, (x, y, z) => ((y < 16 && (x < 3 || x > 56) && (z < 3 || z > 16)) ? STEEL : y >= 16 && y < 18 ? WOOD : y >= 18 && z > 16 && (x < 3 || x > 56 || y > 30) ? WOOD : 0)) }
  const BENCH = written(bench)
  const back = readCells(BENCH)
  check(back.filled === bench.cells.filter(Boolean).length && back.cells.every((k, i) => k === bench.cells[i]) && BENCH.length < 4000, `a thing as cells is read back as it was written: ${back.filled} cells in ${BENCH.length} characters`)
  const cellsBad = {
    'a kind as a number': JSON.stringify({ ...JSON.parse(BENCH), palette: JSON.parse(BENCH).palette.map(([m, c], i) => (i ? [m, c] : [10, c])) }),
    'water': BENCH.replace('"wood"', '"water"'),
    'a key that is not the form\'s': BENCH.replace('{"form"', '{"run":"rm -rf ~","form"'),
    'a cell the engine does not have': BENCH.replace('"cm":2.5', '"cm":3'),
    'runs past its size': JSON.stringify({ ...JSON.parse(BENCH), size: [60, 36, 19] }),
    'runs that are not base64': JSON.stringify({ ...JSON.parse(BENCH), runs: 'not base64!' }),
    'a pair beyond its palette': JSON.stringify({ ...JSON.parse(BENCH), palette: [['steel', '3:3']] }),
  }
  for (const [what, text] of Object.entries(cellsBad)) { let why = ''; try { readCells(text) } catch (e) { why = e.message } check(why !== '', `refused, of cells: ${what} (${why.slice(0, 70)})`) }
  const benched = await make({ wish: 'a bench', world, where: { at: [1000, 4070] }, journal, how: 'cells', model: async () => ({ text: BENCH, model: 'a kept reply', ms: 0, cost: 0 }) })
  const seen = await at(world, [benched.origin[0], benched.origin[1] + 4, benched.origin[2]])
  check(benched.state === 'there' && benched.grain === 4 && seen.material === 10, `a reply of cells is made in the world as finer cells (${say(benched)}, grain ${benched.grain}, ${benched.rows} rows)`)
  check(benched.times.some(([n]) => n === 'stand') && benched.times.reduce((a, [, ms]) => a + ms, 0) < 3000, `its stages are timed: ${benched.times.map(([n, ms]) => `${n} ${ms}`).join(', ')} ms`)
  const benchOut = await undo({ world, journal, id: benched.id })
  check(benchOut.state === 'undone' && (await at(world, [benched.origin[0], benched.origin[1] + 2, benched.origin[2]])).material === 0, `and taken out again (${say(benchOut)})`)
  // Bigger than 256 cells of 2.5 cm (a bus is 11 m): built at 5 cm, it stands in the world's own cells of 10 cm.
  const bus = written({ name: 'a long box', size: [240, 40, 50], cm: 5, cells: grid(240, 40, 50, (x, y, z) => (y < 6 && (x % 60 < 6) && (z < 6 || z > 43) ? STEEL : y >= 6 && (y < 8 || y > 37 || x < 2 || x > 237 || z < 2 || z > 47) ? STEEL : 0)) })
  const busMade = await make({ wish: 'a long box', world, where: { at: [1100, 4070] }, journal, how: 'cells', model: async () => ({ text: bus, model: 'a kept reply', ms: 0, cost: 0 }), dry: true })
  check(busMade.state === 'dry' && busMade.grain === undefined && busMade.size[0] === 120 && busMade.size[2] === 25, `a thing of 5 cm cells, 12 m long, stands as 10 cm cells: ${busMade.size?.join(' x ')} (${say(busMade)})`)
  // From the command line, a file of cells stands in for a model.
  const file = join(dir, 'bench.json')
  writeFileSync(file, BENCH)
  const cli = execFileSync(process.execPath, [join(import.meta.dirname, '..', 'make.mjs'), 'a bench', '--world', world, '--at', '1200,4070', '--cells', '--reply', file, '--journal', journal], { encoding: 'utf8' })
  check(/^made a bench/m.test(cli), `make.mjs --reply file --cells makes it (${cli.trim().split('\n').at(-2)?.trim().slice(0, 80)})`)

  // ── Made before, made at once (make/library.mjs) ──
  const shelfDir = join(dir, 'library'), shelf = library(shelfDir, [])
  await shelf.keep('a park bench', '', BENCH, { name: 'a bench', model: 'a kept reply', form: 'cells', grade: 'best', made: BENCH, stands: true })
  const entry = await shelf.find('a park bench please')
  check(entry?.made && entry.proved?.joined && entry.proved.stands, 'what is kept keeps its cells, and that they were joined and stood')
  const fast = []
  for (const x of [1400, 1500, 1600]) { const r = await make({ wish: 'a park bench', world, where: { at: [x, 4070] }, journal, ...recalled(entry) }); fast.push([r.state, r.times.reduce((a, [, ms]) => a + ms, 0), r.times]) }
  check(fast.every(([state, ms]) => state === 'there' && ms < 1000), `a kept thing stands at once, three times: ${fast.map(([, ms]) => ms).join(', ')} ms (${fast[2][2].map(([n, ms]) => `${n} ${ms}`).join(', ')})`)
  const guesses = await Promise.all(['a park b', 'a prak bench', 'bench ', 'a pa', 'a helicopter', 'a p'].map((w) => shelf.guess(w)))
  check(guesses.slice(0, 4).every((g) => g?.entry.id === entry.id) && guesses[4] === null && guesses[5] === null, `words being typed find what is kept: a word and a letter, two letters swapped, a word alone, half a word; nothing for what is not kept, nor for one letter (${guesses.map((g) => g?.sure ?? '-').join(', ')})`)

  // ── Undo ──
  // A maker stopped after its send arrived leaves only "sending" written down: undo takes that thing, not the one before.
  const cut = await make({ wish: 'a fruit stall', world, where: { at: [940, 4070] }, journal, model: kept(STALL), dry: true })
  await fetch(`${world}/world/ask`, { method: 'POST', body: JSON.stringify({ by: 'check', edit: [1, cut.made.length, ...cut.made.flat()], release: [cut.origin[0] + 40, cut.origin[1] + 10, cut.origin[2]] }) })
  writeFileSync(journal, readFileSync(journal, 'utf8') + JSON.stringify({ id: 'cut-short', state: 'sending', world, by: 'check', name: 'a stall cut short', rows: cut.made }) + '\n')
  const took = await undo({ world, journal })
  check(took.state === 'undone' && took.id === 'cut-short' && (await at(world, [cut.origin[0], cut.origin[1] + 8, cut.origin[2]])).material === 0, `undo takes out a thing whose sending was never written as finished (${say(took)})`)
  const out = await undo({ world, journal, id: first.id })
  const gone = await at(world, [first.origin[0], first.origin[1] + 8, first.origin[2]])
  check(out.state === 'undone' && gone.material === 0, `undo takes the first stall out again (${say(out)})`)

  // (Last: what falls when a place is cleared goes on being told for a while.)
  // No place near will take it: it is held, and put where the asker says next, or there with the place cleared.
  const markHall = await done()
  const big = { name: 'a hall', size: [64, 30, 64], parts: [['box', 'brick', 'own', 0, 0, 0, 64, 30, 64]] }
  const shut = await make({ wish: 'a hall', world, where: { from: [700, 172, 3990], toward: [0, -1, -0.01] }, journal, model: kept(big) })
  if (shut.state === 'held') {
    check((await done()) === markHall, `a thing no place near will take is held, not thrown away (${say(shut)})`)
    const here2 = await put({ hold: shut.hold, world, where: { from: [700, 172, 3990], toward: [0, -1, -0.01] }, clear: true, journal })
    const inside = here2.origin ? await at(world, [here2.origin[0], here2.origin[1] + 29, here2.origin[2]]) : {}
    check(here2.state === 'there' && inside.material === 8 && (await done()) > markHall + 1, `put there with the place cleared, it stands where the house was (${say(here2)})`)
  } else check(false, `a hall aimed into a house should have been held (${say(shut)})`)
  // ── What the world says when it lays a thing: nothing loose, at once; something loose, seen to fall ──
  // A slab two metres up on nothing: the world lets it fall, and it is watched until it has.
  const slab = [], high = (await at(world, [1310, 0, 4075])).ground + 20
  for (let z = 0; z < 30; z++) for (let y = 0; y < 2; y++) slab.push([1290, 1330, high + y, 4060 + z, 9])
  const t1 = performance.now(), fell2 = await send(world, slab, 'check'), fellIn = performance.now() - t1
  const t2 = performance.now(), quiet = await send(world, [[1290, 1300, (await at(world, [1295, 0, 4110])).ground + 1, 4110, 9]], 'check'), quietIn = performance.now() - t2
  // At once: the old way waited four seconds to see a thing stand, and gave the same state.
  check(quietIn < 1500, `the step was there in ${Math.round(quietIn)} ms, with no wait to see it stand`)
  check(fell2.state !== 'there' && quiet.state === 'there', `a slab on nothing is not there (${say(fell2)}, ${Math.round(fellIn)} ms); a step on the ground is there at once (${say(quiet)})`)
  // ── A living thing as a reply (#245, make/alive.mjs): what is refused, and turned whole to face ──
  {
    const car = fineCar([0, 0, 0]), look = car.fine[0]
    const living = { scheme: 'drive', motor: car.motor, seats: car.seats, eye: car.eye, look: [{ size: look.size, per: look.per, low: look.low, ...runsOf(look.cells) }], facts: { measured: { top_kmh: 72 } } }
    const body = { name: 'roadster', size: car.size, cm: 10, ...runsOf(Uint16Array.from(car.cells)) }
    const reply = (l, more = {}) => JSON.stringify({ form: 'cells', ...body, ...more, living: l })
    const why = (text) => { try { readCells(text); return '' } catch (e) { return e.message } }
    const thing = readCells(reply(living))
    check(thing.living.look[0].filled > 0 && thing.living.facts.measured.top_kmh === 72 && thing.filled > 0, `a reply of cells with living is read: a body of ${thing.filled} cells, a look of ${thing.living.look[0].filled}`)
    const refusals = {
      'a kind number in the look': why(reply({ ...living, look: [{ ...living.look[0], palette: [[12, 'own']] }] })),
      'a key nobody named': why(reply({ ...living, script: 'x' })),
      'a body of 5 cm': why(reply(living, { cm: 5 })),
      'a look past what a page draws': why(reply({ ...living, look: [{ ...living.look[0], size: [464, 144, 208], per: 8, low: [-8, -8, -8] }] })),
      'a look far off the body': why(reply({ ...living, look: [{ ...living.look[0], low: [400, 0, 0] }] })),
      'facts that are not numbers': why(reply({ ...living, facts: { asked: { top: 'fast' } } })),
      'a motor that is not one': why(reply({ ...living, motor: { front: 0 } })),
    }
    check(Object.values(refusals).every(Boolean), `refused: ${Object.entries(refusals).map(([k, v]) => `${k} (${v.slice(0, 60) || 'TAKEN'})`).join('; ')}`)
    // Turned to each facing: every cell of the body, every foot and every cell of the look keeps its place on the body
    // (a turn, never a mirror), and the placing lays the turned body exactly.
    const FRONT = { east: [1, 0], west: [-1, 0], south: [0, 1], north: [0, -1] }, WAY = [[1, 0], [-1, 0], [0, 1], [0, -1]]
    const bad = []
    for (const facing of ['south', 'north', 'east', 'west']) {
      const t = turned(thing, facing), [W, , D] = t.size
      if (WAY[t.controls.motor.front].join() !== FRONT[facing].join()) bad.push(`${facing}: its front is ${t.controls.motor.front}`)
      // A point of the body in its own cells, turned as the thing was: by the turn its front took (east is none).
      const q = (p) => { let [x, y, z] = p, d = thing.size[2], w = thing.size[0]; for (let i = 0; i < t.k; i++) { [x, z] = [d - z, x]; [w, d] = [d, w] } return [x, y, z] }
      const G = (p) => { const [x, y, z] = p.map(Math.floor); return x < 0 || z < 0 || x >= W || z >= D ? -1 : t.cells[(y * D + z) * W + x] }
      let n = 0
      for (let y = 0; y < thing.size[1]; y++) for (let z = 0; z < thing.size[2]; z++) for (let x = 0; x < thing.size[0]; x++) { const v = thing.cells[(y * thing.size[2] + z) * thing.size[0] + x]; if (v && G(q([x + 0.5, y + 0.5, z + 0.5])) !== v) n++ }
      if (n) bad.push(`${facing}: ${n} cells of the body moved`)
      thing.living.motor.feet.forEach((f, i) => { const p = q(f.at), g = t.controls.motor.feet[i].at; if (Math.hypot(p[0] - g[0], p[1] - g[1], p[2] - g[2]) > 1e-6) bad.push(`${facing}: foot ${i}`) })
      const L = thing.living.look[0], T = t.look[0]
      let m = 0
      for (let i = 0; i < 4000; i++) {
        const x = (i * 7919) % L.size[0], y = (i * 104729) % L.size[1], z = (i * 1299709) % L.size[2], v = L.kinds[(y * L.size[2] + z) * L.size[0] + x]
        const p = q([L.low[0] + (x + 0.5) / L.per, L.low[1] + (y + 0.5) / L.per, L.low[2] + (z + 0.5) / L.per]), f = [(p[0] - T.low[0]) * T.per, (p[1] - T.low[1]) * T.per, (p[2] - T.low[2]) * T.per].map(Math.floor)
        if (T.kinds[(f[1] * T.size[2] + f[2]) * T.size[0] + f[0]] !== v) m++
      }
      if (m) bad.push(`${facing}: ${m} of 4000 cells of the look moved`)
      const rows = formRows(t.body, [100, 10, 200], facing)
      let r = 0, cells = 0
      for (const [x0, x1, y, z, kind] of rows) for (let x = x0; x < x1; x++) { cells++; if (G([x - 100 - t.low[0], y - 10, z - 200 - t.low[2]]) !== kind) r++ }
      if (r || cells !== thing.filled) bad.push(`${facing}: the placing lays ${cells} cells, ${r} of them not the turned body's`)
    }
    check(!bad.length, `turned to face south, north, east and west: the body, its feet and its look turn together and the placing lays it as turned${bad.length ? `: ${bad.join('; ')}` : ''}`)
    // The two cars of the bench, if they are on this machine (they are not in the repo).
    const bench = join(homedir(), '.village', 'engine', 'fast-voxels'), shelf = join(dir, 'bench-shelf')
    const cars = [['library/bmw_x3.json', 'out/world/x3_twin.json'], ['library/tesla_model_3.json', 'out/cars/tesla3/twin.json']]
    if (cars.every(([f, t]) => existsSync(join(bench, f)) && existsSync(join(bench, t)))) {
      const got = []
      for (const [f, t] of cars) got.push(await importTo(join(bench, f), { twin: join(bench, t), shelf }))
      const kept = await library(shelf, []).all()
      check(got.every((g) => g.cabin && g.look.length === 2) && kept.length === 2 && kept.every((e) => e.made && e.form === 'cells' && readCells(e.made).living.look.length === 2), `both of the bench's cars imported onto a shelf: ${got.map((g) => `${g.name} (${(g.bytes / 1e6).toFixed(2)} MB, ${g.look.join(' and ')})`).join('; ')}`)
    } else console.log('  (the bench\'s cars are not on this machine: not imported)')
  }
} catch (e) {
  failures.push(String(e.stack ?? e))
}
server.stop()
rmSync(dir, { recursive: true, force: true })
if (failures.length) { console.error(`FAILED\n  ${failures.join('\n  ')}`); process.exit(1) }
console.log('make: ok (replies kept in the check stood in for the model: none was run)')
