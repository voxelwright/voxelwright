// Making (#220): a wish, a model's reply and a place become a thing of cells in a shared world, whole or not at all.
//
// NO MODEL IS RUN HERE. Replies kept in this file stand in for one, and a small script stands in for the binary
// where the run itself is what is tried (slow, failing, started with a tool). This proves the plumbing: the form,
// its refusals, the placing and the sending. That a real model answers in the form is proved by a real run
// (engine/README.md, "Making"), not by this.
//
//   node test/make.mjs
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir, userInfo } from 'node:os'
import { join } from 'node:path'
import { make, put, undo } from '../make.mjs'
import { BRIEF } from '../make/brief.mjs'
import { ROWS_MOST, read } from '../make/form.mjs'
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
} catch (e) {
  failures.push(String(e.stack ?? e))
}
server.stop()
rmSync(dir, { recursive: true, force: true })
if (failures.length) { console.error(`FAILED\n  ${failures.join('\n  ')}`); process.exit(1) }
console.log('make: ok (replies kept in the check stood in for the model: none was run)')
