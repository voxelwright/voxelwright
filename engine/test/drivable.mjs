// What a made thing brought to life must not do (#245), in Node: no Chrome, a world of its own, helpers with
// stand-ins for the models. NO MODEL IS RUN.
//   words      only words that point at the thing looked at ("make it drivable") are asked of it; "make the dragon
//              alive", "let me ride the horse" go where they always went
//   replies    a reply that does not validly say it drives (false, "no", a figure out of range) is not driven
//   no wheels  a table, a crate on feet, a table of 2.5 cm: nothing rolls, and the place says so; cars keep their wheels
//   the card   what the card and the record are held to fails with nothing measured and with a wrong figure
//   its front  "make it drivable" on cars whose noses are at low x, high x and high z (as a model may lay them), each
//              made facing each way: driven toward its white lamps; the roadster keeps its own wheels whichever way
//              it was stood; a car with nothing to say which end is its front is said to be so
//   the wish   bringing a thing to life changes that thing, not what its words make next time
//   whose      aimed at another's thing, nothing changes, and the words do what they did before (#245's base)
//   one ask    the old thing goes and the living one comes on one ask: an answer that is lost, late, or a world that
//              cannot be reached after it, leaves exactly one thing where it stood
//   driven     a car got on or driven (by a rider, by a rule) is not taken out for its better, after a restart too
//
//   node test/drivable.mjs
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { helper } from '../helper.mjs'
import { enliven, make, undo } from '../make.mjs'
import { read } from '../make/form.mjs'
import { made as programmed } from '../make/program.mjs'
import { OWN_FRONT, bodyOf, driven } from '../make/drivable.mjs'
import { asksToDrive } from '../page/living.ts'
import { cardSays, measuredOnly } from './made-cars/card.mjs'
import { here, serve } from './kit.mjs'

const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
const dir = mkdtempSync(join(tmpdir(), 'engine-drivable-'))

// ── Words ──
for (const w of ['make it drivable', 'let me drive it', 'make this driveable', 'Make that one drivable.', 'can I ride it?']) check(asksToDrive(w), `"${w}" points at the thing looked at`)
for (const w of ['make it alive', 'make the dragon alive', 'make the tree alive', 'ride that wave', 'drive it off the cliff', 'let me drive it home', 'can I ride the horse']) check(!asksToDrive(w), `"${w}" is not asked of the thing looked at`)

// ── Replies that say they are driven ──
const HATCH = readFileSync(join(here, 'test/made-cars/hatchback.json'), 'utf8'), hatch = JSON.parse(HATCH)
for (const v of [false, null, 'no', 0, { top_kmh: 500 }, { front: 'up' }]) {
  const t = read(JSON.stringify({ ...hatch, drives: v }), { lenient: true })
  check(t.drives === undefined && t.left.some((l) => /drives/.test(l)), `a reply of parts saying "drives": ${JSON.stringify(v)} is not driven, and that is said (${JSON.stringify(t.drives)})`)
}
for (const v of [true, {}]) check(!!read(JSON.stringify({ ...hatch, drives: v }), { lenient: true }).drives, `a reply of parts saying "drives": ${JSON.stringify(v)} is driven`)
const BOX = `size(40, 20, 80, 2.5); name("test box"); box("steel", "own", 0, 0, 0, 40, 20, 80);`
for (const call of ['drives("no")', 'drives(false)', 'drives(null)', 'drives({ top_kmh: 9000 })']) {
  const t = await programmed(`${BOX} ${call}`)
  check(t.drives === undefined, `a program calling ${call} is not driven (${JSON.stringify(t.drives)})`)
}
check(!!(await programmed(`${BOX} drives()`)).drives, 'a program calling drives() is driven')

// ── Nothing that rolls ──
const parts = (o) => read(JSON.stringify(o), { lenient: true })
const corners = (w, d, s = 1) => [[0, 0], [w - s, 0], [0, d - s], [w - s, d - s]]
const TABLES = {
  'a wooden table': { name: 'wooden table', size: [12, 8, 8], parts: [['box', 'wood', 'own', 0, 7, 0, 12, 8, 8], ...corners(12, 8).map(([x, z]) => ['box', 'wood', 'own', x, 0, z, x + 1, 7, z + 1])] },
  'a table on steel legs': { name: 'steel-legged table', size: [12, 8, 8], parts: [['box', 'wood', 'own', 0, 7, 0, 12, 8, 8], ...corners(12, 8).map(([x, z]) => ['box', 'steel', 'own', x, 0, z, x + 1, 7, z + 1])] },
  'a crate on stubby feet': { name: 'crate on feet', size: [12, 8, 16], parts: [['box', 'wood', 'own', 0, 2, 0, 12, 8, 16], ...corners(12, 16).map(([x, z]) => ['box', 'steel', 'own', x, 0, z, x + 1, 2, z + 1])] },
  'a table on thick legs': { name: 'thick-legged table', size: [16, 8, 10], parts: [['box', 'wood', 'own', 0, 7, 0, 16, 8, 10], ...corners(16, 10, 2).map(([x, z]) => ['box', 'wood', 'own', x, 0, z, x + 2, 7, z + 2])] },
}
for (const [what, o] of Object.entries(TABLES)) {
  const t = parts(o), r = await driven({ name: t.name, size: t.size, cm: 10, cells: bodyOf(t) })
  check(!r.rolls && r.said[0] === 'nothing of it rolls: it goes on four small wheels under its corners', `${what} is no car: ${r.said[0]}`)
}
{
  const t = await programmed('size(48, 32, 32, 2.5); name("fine table"); box("wood", "own", 0, 28, 0, 48, 32, 32); for (const [x, z] of [[0, 0], [44, 0], [0, 28], [44, 28]]) box("wood", "own", x, 0, z, x + 4, 28, z + 4)')
  const r = await driven({ name: t.name, size: t.size, cm: 2.5, cells: bodyOf(t) })
  check(!r.rolls, `a table of 2.5 cm is no car: ${r.said[0]}`)
}
// Cars keep their wheels, as measured before (wheels with their round side out, and a van whose wheels are flush with its flank).
const wheels = (r) => (/on its wheels \(([^)]*)\)/.exec(r.said.join(' | '))?.[1] ?? 'none')
{
  const t = read(HATCH, { lenient: true }), r = await driven({ name: t.name, size: t.size, cm: 10, cells: bodyOf(t), front: OWN_FRONT[t.drives.front] })
  check(r.rolls && wheels(r) === '0.60 m, 0.60 m, 0.60 m, 0.60 m', `the hatchback rolls on its wheels (${wheels(r)})`)
  const p = await programmed(readFileSync(join(here, 'test/made-cars/roadster.js'), 'utf8')), q = await driven({ name: p.name, size: p.size, cm: 2.5, cells: bodyOf(p), front: OWN_FRONT[p.drives.front] })
  check(q.rolls && wheels(q) === '0.70 m, 0.70 m, 0.70 m, 0.70 m', `the roadster rolls on its wheels (${wheels(q)})`)
  const flush = parts({ name: 'flush van', size: [18, 16, 44], parts: [['box', 'steel', '0:4', 1, 2, 0, 17, 16, 44], ...[[0, 6], [0, 32], [12, 6], [12, 32]].map(([x, z]) => ['cyl', 'steel', 'grey:13', x, 0, z, x + 6, 6, z + 6, 'x'])] })
  const f = await driven({ name: flush.name, size: flush.size, cm: 10, cells: bodyOf(flush), front: 2 })
  check(f.rolls, `a van with its wheels flush with its flank rolls (${wheels(f)})`)
}

// ── The card ──
check(!measuredOnly({}) && !measuredOnly({ measured: {} }) && !measuredOnly({ measured: { top_kmh: 160 } }) && measuredOnly({ measured: { zero_to_100_s: 11.1 } }), 'a record that measured nothing, or measured what is not measured, is not passed')
check(cardSays('160 km/h, 0 to 100 in 11.1 s', { top_kmh: 160, zero_to_100_s: 11 }, 11.1) && !cardSays('160 km/h, 0 to 100 in 14.0 s', { top_kmh: 160, zero_to_100_s: 11 }, 14) && !cardSays('170 km/h, 0 to 100 in 11.1 s', { top_kmh: 160, zero_to_100_s: 11 }, 11.1) && !cardSays('160 km/h, 0 to 100 in 11.1 s', { top_kmh: 160, zero_to_100_s: 11 }, 11.4) && !cardSays('', { top_kmh: 160, zero_to_100_s: 11 }), 'a card with a wrong top speed, a 0 to 100 far from what was asked or not what was measured, or nothing, is not passed')

// ── In a world ──
/** A pickup with its cab ahead of a low bed and no red lamps; a box van (the same at each end, but its white lamps). Noses at z 0, as the brief has them. */
const WHEELS = [[0, 5], [16, 5], [0, 33], [16, 33]].map(([x, z]) => ['cyl', 'steel', 'grey:13', x, 0, z, x + 2, 6, z + 6, 'x'])
const LAMPS = [['box', 'lamp', 'white', 3, 4, 0, 6, 6, 1], ['box', 'lamp', 'white', 12, 4, 0, 15, 6, 1]]
const PICKUP = { name: 'red pickup', size: [18, 16, 44], parts: [['box', 'steel', '0:4', 1, 3, 0, 17, 6, 44], ['box', 'steel', '0:4', 1, 6, 1, 17, 16, 16], ['box', 'steel', '0:4', 1, 6, 16, 2, 9, 44], ['box', 'steel', '0:4', 16, 6, 16, 17, 9, 44], ['box', 'steel', '0:4', 1, 6, 43, 17, 9, 44], ...WHEELS, ...LAMPS] }
const VAN = { name: 'grey box van', size: [18, 16, 44], parts: [['box', 'steel', '15:4', 1, 3, 0, 17, 16, 44], ...WHEELS, ...LAMPS] }
const TABLE = { ...TABLES['a wooden table'], name: 'kitchen table' }
/**
 * A car of 10 cm parts with its nose where a model may put it: at low x, high x or high z of its own space (the
 * brief says low z; real replies do not always keep to it). White lamps at its nose, red at its tail, its cabin in the
 * middle (so its shape says nothing of which end is which), and nothing said of driving it.
 */
function noseCar(nose) {
  const alongX = nose !== '+z', head = (lo, hi) => (nose === '-x' || nose === '-z' ? [lo, lo + 1] : [hi - 1, hi])
  if (alongX) {
    const [f0, f1] = head(0, 44), [b0, b1] = nose === '-x' ? [43, 44] : [0, 1]
    return { name: `teal coupe nosed ${nose}`, size: [44, 16, 18], parts: [['box', 'steel', '10:5', 0, 2, 1, 44, 9, 17], ['box', 'steel', '10:5', 14, 9, 2, 30, 15, 16],
      ...[5, 33].flatMap((x) => [[0, 2], [16, 18]].map(([z0, z1]) => ['cyl', 'steel', 'grey:13', x, 0, z0, x + 6, 6, z1, 'z'])),
      ...[[2, 5], [13, 16]].flatMap(([z0, z1]) => [['box', 'lamp', 'white', f0, 4, z0, f1, 7, z1], ['box', 'lamp', '0:4', b0, 4, z0, b1, 7, z1]])] }
  }
  return { name: `teal coupe nosed ${nose}`, size: [18, 16, 44], parts: [['box', 'steel', '10:5', 1, 2, 0, 17, 9, 44], ['box', 'steel', '10:5', 2, 9, 14, 16, 15, 30], ...WHEELS,
    ...[[2, 5], [13, 16]].flatMap(([x0, x1]) => [['box', 'lamp', 'white', x0, 4, 43, x1, 7, 44], ['box', 'lamp', '0:4', x0, 4, 0, x1, 7, 1]])] }
}
/** A plain slab on four wheels: no lamps, the same at each end. Nothing says which end is its front. */
const SLAB = { name: 'plain slab cart', size: [44, 10, 18], parts: [['box', 'wood', 'own', 0, 2, 1, 44, 8, 17], ...[5, 33].flatMap((x) => [[0, 2], [16, 18]].map(([z0, z1]) => ['cyl', 'steel', 'grey:13', x, 0, z0, x + 6, 6, z1, 'z']))] }
const ROADSTER = readFileSync(join(here, 'test/made-cars/roadster.js'), 'utf8').replace(/^drives\(.*$/m, '')
/** The saloon of make/kept/ as its program was on 42df1b38, before `drives` was added by hand: its nose at low x, red lamps at its tail. */
const SALOON = (({ reply }) => reply.slice(0, reply.indexOf('\n\n// Added by hand')))(JSON.parse(readFileSync(join(here, 'make/kept/0782ba87f3267813204077d0.json'), 'utf8')))
/** Which way a thing's red lamps point in the world (0 +x, 1 -x, 2 +z, 3 -z): its nose is the other way. */
async function tail(id) {
  const r = await one(id), red = (k) => (k & 15) === 15 && k >> 8 >= 16 && Math.floor(((k >> 8) - 16) / 10) <= 1
  const mean = (want) => { let n = 0, sx = 0, sz = 0; for (let i = 0; i + 4 < r.cells.length; i += 5) { const [x0, x1, , z, k] = r.cells.slice(i, i + 5); if (!want(k)) continue; for (let xx = x0; xx < x1; xx++) { n++; sx += xx; sz += z } } return [sx / n, sz / n] }
  const all = mean((k) => k !== 0), lamps = mean(red), d = [lamps[0] - all[0], lamps[1] - all[1]]
  return Math.abs(d[0]) > Math.abs(d[1]) ? (d[0] > 0 ? 0 : 1) : (d[1] > 0 ? 2 : 3)
}
const replies = { pickup: PICKUP, 'box van': VAN, minibus: { ...VAN, name: 'white minibus' }, lorry: { ...VAN, name: 'blue lorry' }, table: TABLE, hatchback: { ...hatch } }
let file = join(dir, 'world.log'), server = await serve('/dev/null', ['--world', file])
const journal = join(dir, 'made.jsonl'), other = join(dir, 'other.jsonl')
let asked = 0
const a = await helper({ world: server.url, port: 0, journal, kept: join(dir, 'shelf'), model: async ({ prompt }) => { asked++; const k = Object.keys(replies).find((k) => prompt.includes(k)); return { text: JSON.stringify(replies[k] ?? hatch), model: 'a stand-in', ms: 0, cost: 0 } } })
await a.warm
const post = async (path, body) => { const r = await fetch(`${a.url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-village-secret': a.secret }, body: JSON.stringify(body) }); return (await r.text()).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) }
const things = () => fetch(`${server.url}/world/things`).then((r) => r.json())
const one = (id) => fetch(`${server.url}/world/things?id=${id}`).then((r) => (r.ok ? r.json() : null))
const notes = (lines) => lines.filter((l) => l.stage === 'note').map((l) => l.why)
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
/** Where the eye is to ask for a thing: 5 m back from a place on the main street and 4.6 m up, looking down at it (test/words.mjs). */
const from = (x, z) => ({ eye: [x, 200, z + 50], toward: [0, -0.35, -1] })
let x = 300
/** An eye 6 m off a thing and 4 m over it, looking at its middle: what the person aims at. */
const aim = (t) => ({ eye: [t.at[0], t.at[1] + 40, t.at[2] + 60], toward: [0, t.size[1] / 2 - 40, -60] })
/** Has Rhea's helper make a thing from the stand-in's reply: its record. */
const asks = async (wish, where, by = 'Rhea') => { const before = new Set((await things()).map((t) => t.id)); const lines = await post('/ask', { wish, from: where, by }); return { lines, made: (await things()).find((t) => !before.has(t.id)) ?? null } }
/** Makes a thing from a reply given here (no helper), standing on the main street facing as asked: its record. (A place that will not take it whole is passed over for the next.) */
const stood = async (reply, facing, how = 'parts') => {
  for (let i = 0; i < 4; i++) {
    const r = await make({ wish: reply.name ?? 'a test car', world: server.url, where: { at: [(x += 300), 4070] }, facing, how, model: async () => ({ text: typeof reply === 'string' ? reply : JSON.stringify(reply), model: 'a stand-in', ms: 0, cost: 0 }), by: 'Rhea', journal, tries: 1 })
    if (r.state === 'there') return (await things()).find((t) => t.id === r.id) ?? null
    if (r.id) await undo({ world: server.url, id: r.id, by: 'Rhea', journal })
    stood.why = `${r.state}: ${r.why}`
  }
  return null
}
/** Which way a thing's nose points in the world, from its white lamps in the cells the world keeps of it: 0 +x, 1 -x, 2 +z, 3 -z (page/living.ts `Motor.front`). */
async function nose(id) {
  const r = await one(id), mean = (want) => { let n = 0, sx = 0, sz = 0; for (let i = 0; i + 4 < r.cells.length; i += 5) { const [x0, x1, , z, k] = r.cells.slice(i, i + 5); if (!want(k)) continue; for (let xx = x0; xx < x1; xx++) { n++; sx += xx; sz += z } } return [sx / n, sz / n] }
  const all = mean((k) => k !== 0), lamps = mean((k) => k === (15 | (1 << 8))), d = [lamps[0] - all[0], lamps[1] - all[1]]
  return Math.abs(d[0]) > Math.abs(d[1]) ? (d[0] > 0 ? 0 : 1) : (d[1] > 0 ? 2 : 3)
}
/** The thing alive where `was` stood (within 0.3 m), if any. */
const aliveAt = async (was) => (await things()).find((t) => t.controls && Math.hypot(t.at[0] - was.at[0], t.at[2] - was.at[2]) <= 3) ?? null
/** Drives a living thing ahead for a second and a half and lets it come to rest: which way it went (0 +x, 1 -x, 2 +z, 3 -z) and how far, in cells, from where its record says it was made. */
async function drove(t) {
  for (let i = 0; i < 6; i++) { await fetch(`${server.url}/world/drive`, { method: 'POST', body: JSON.stringify({ by: 'Rhea', id: t.id, go: 1 }) }); await wait(250) }
  await fetch(`${server.url}/world/drive`, { method: 'POST', body: JSON.stringify({ by: 'Rhea', id: t.id, go: 0 }) })
  let rest = null
  for (let i = 0; i < 80 && !rest; i++) { await wait(250); rest = (await one(t.id))?.controls?.rest?.at ?? null }
  if (!rest) return { way: -1, far: 0 }
  const d = [rest[0] - t.at[0], rest[2] - t.at[2]]
  return { way: Math.abs(d[0]) > Math.abs(d[1]) ? (d[0] > 0 ? 0 : 1) : (d[1] > 0 ? 2 : 3), far: Math.round(Math.hypot(...d)) }
}
const FACINGS = ['south', 'north', 'east', 'west']
try {
  // The roadster of 2.5 cm cells, its nose at +x and nothing said of driving it: its own wheels of 0.70 m, nose first, made facing each way.
  for (const facing of FACINGS) {
    const car = await stood(ROADSTER, facing, 'program')
    if (!car) { check(false, `the roadster made facing ${facing} is made (${stood.why})`); continue }
    const want = await nose(car.id), lines = await post('/ask', { wish: 'make it drivable', from: aim(car), by: 'Rhea' })
    const alive = await aliveAt(car), said = lines.find((l) => l.stage === 'done')?.said ?? []
    check(!!alive && alive.controls.motor.front === want && !notes(lines).some((n) => /nothing of it rolls/.test(n)) && /on its wheels \(0\.70 m, 0\.70 m, 0\.70 m, 0\.70 m\)/.test(said.join(' | ')), `the roadster made facing ${facing} rolls on its own wheels, nose first (its nose ${want}, its motor's front ${alive?.controls.motor.front}; ${said.join(' | ') || notes(lines).join('; ')})`)
    if (alive) await undo({ world: server.url, id: alive.id, by: 'Rhea', journal })
  }
  // The reviewer's own case: the saloon's program of 42df1b38 (nothing said of driving it), made facing each way:
  // nose first (away from its red lamps), on its own wheels, and nothing said of not knowing its front.
  for (const facing of FACINGS) {
    const car = await stood(SALOON, facing, 'program')
    if (!car) { check(false, `the saloon made facing ${facing} is made (${stood.why})`); continue }
    const want = [1, 0, 3, 2][await tail(car.id)], lines = await post('/ask', { wish: 'make it drivable', from: aim(car), by: 'Rhea' })
    const alive = await aliveAt(car), said = lines.find((l) => l.stage === 'done')?.said ?? []
    check(!!alive && alive.controls.motor.front === want && /on its wheels/.test(said.join(' | ')) && !said.some((l) => /could not be told/.test(l)), `the saloon of 42df1b38 made facing ${facing} is driven nose first, on its own wheels (its nose ${want}, its motor's front ${alive?.controls.motor.front}; ${said.join(' | ') || notes(lines).join('; ')})`)
    if (alive) await undo({ world: server.url, id: alive.id, by: 'Rhea', journal })
  }
  // Its front: what its own cells say (its lamps), whichever way it was made to face and wherever the model put its
  // nose. Each is driven, and goes toward its white lamps (across the street, only as far as the kerb: 0.3 m).
  for (const where of ['-x', '+x', '+z']) for (const facing of FACINGS) {
    const car = await stood(noseCar(where), facing)
    if (!car) { check(false, `a car nosed ${where} made facing ${facing} is made`); continue }
    const want = await nose(car.id), lines = await post('/ask', { wish: 'make it drivable', from: aim(car), by: 'Rhea' })
    const alive = await aliveAt(car), went = alive ? await drove(alive) : { way: -1, far: 0 }
    check(!!alive && alive.controls.motor.front === want && went.way === want && went.far >= 2, `a car nosed ${where} in its reply, made facing ${facing}: "make it drivable" drives it toward its white lamps (they point ${want}; its motor's front ${alive?.controls.motor.front}; it went ${went.way}, ${went.far} cells; ${notes(lines).join('; ')})`)
    if (alive) await undo({ world: server.url, id: alive.id, by: 'Rhea', journal })
  }
  // Nothing says which end is the front of a plain slab on wheels, made facing across its length: it is brought to life, and the place says so.
  {
    const slab = await stood(SLAB, 'south'), lines = slab ? await post('/ask', { wish: 'make it drivable', from: aim(slab), by: 'Rhea' }) : []
    const alive = slab && (await aliveAt(slab))
    check(!!alive && notes(lines).some((n) => /which end is its front/i.test(n)), `a slab with nothing to say which end is its front is alive, and the place says so (${notes(lines).join('; ')})`)
    if (alive) await undo({ world: server.url, id: alive.id, by: 'Rhea', journal })
  }

  // The pickup through the helper as a person asks, and then asked for again: bringing it to life changed that
  // pickup, not what the words make.
  {
    const still = await asks('a red pickup', from((x += 300), 4070))
    const want = still.made && (await nose(still.made.id)), lines = still.made ? await post('/ask', { wish: 'make it drivable', from: aim(still.made), by: 'Rhea' }) : []
    const alive = still.made && (await aliveAt(still.made))
    check(!!alive && alive.controls.motor.front === want, `the pickup, made facing ${still.made?.facing}: "make it drivable" drives it nose first (its nose ${want}; its motor's front ${alive?.controls.motor.front}; ${notes(lines).join('; ')})`)
    const again = await asks('a red pickup', from((x += 300), 4070))
    check(!!again.made && !again.made.controls, `the pickup asked for again is made as it was before, not alive (${again.made ? (again.made.controls ? 'alive' : 'not alive') : 'nothing made'})`)
    for (const t of [alive, again.made]) if (t) await undo({ world: server.url, id: t.id, by: 'Rhea', journal })
  }

  // Nothing that rolls, aimed at: told so by the place. And "a kitchen table" asked for again is a table, not a living thing.
  {
    const t = await asks('a kitchen table', from((x += 300), 4070)), lines = t.made ? await post('/ask', { wish: 'make it drivable', from: aim(t.made), by: 'Rhea' }) : []
    check(notes(lines).some((n) => /nothing of it rolls/.test(n)), `"make it drivable" on a table says nothing of it rolls (${notes(lines).join('; ')})`)
    const alive = (await things()).find((u) => u.controls && u.name === t.made?.name)
    const again = await asks('a kitchen table', from((x += 300), 4070))
    check(!!again.made && !again.made.controls, `"a kitchen table" asked for again after one was made drivable is a table that does not live (${again.made ? (again.made.controls ? 'alive' : 'not alive') : 'nothing made'})`)
    for (const u of [alive, again.made]) if (u) await undo({ world: server.url, id: u.id, by: 'Rhea', journal })
  }

  // Another's: nothing is done to it, by the eye or by its id, and undo does not take it out. The words go where they
  // went before: by the eye, a new thing is asked of the model; by its id, the helper says a thing cannot be aimed at.
  {
    const where = from((x += 300), 4070), van = (await asks('a white minibus', where)).made
    const before = new Set((await things()).map((t) => t.id)), models = asked
    const byEye = await post('/ask', { wish: 'make it drivable', from: aim(van), by: 'Tomas' })
    const byId = await post('/ask', { wish: 'make it drivable', from: where, target: { thing: van.id }, by: 'Tomas' })
    const u = await undo({ world: server.url, id: van?.id, by: 'Tomas', journal: other })
    const now = await one(van?.id)
    check(!!van && !!now && !now.controls && u.state === 'refused', `Rhea's minibus, asked of by Tomas by the eye and by its id, and undone by him (${u.state}), stands as it was (${!!now}, alive ${!!now?.controls})`)
    check(!notes(byEye).some((n) => /Rhea's/.test(n)) && asked === models + 1 && byId.at(-1)?.why === 'a thing cannot be aimed at yet', `the words do what they did before: by the eye the model is asked for a new thing (${asked - models}), by its id ${JSON.stringify(byId.at(-1)?.why)} (${[...notes(byEye), ...notes(byId)].join('; ')})`)
    for (const t of await things()) if (!before.has(t.id) && t.by === 'Tomas') await undo({ world: server.url, id: t.id, by: 'Tomas', journal: other })
    if (van) await undo({ world: server.url, id: van.id, by: 'Rhea', journal })
  }

  // One ask: the old thing goes and the living one comes together, or neither. The ask that brings the new one is
  // answered late (the asker hears nothing back; it reaches the world 5 s on), or its answer is lost after it arrives,
  // or the world cannot be reached from the moment it is taken, or it never arrives. Exactly one thing stands there.
  const real = globalThis.fetch
  const failing = async (how, wish) => {
    const where = from((x += 300), 4070), old = (await asks(wish, where)).made
    if (!old) return check(false, `${how}: ${wish} is made`)
    let taken = false, late = null
    globalThis.fetch = async (url, init) => {
      const body = typeof init?.body === 'string' ? init.body : '', asking = /\/world\/ask$/.test(String(url))
      if (how === 'unreachable' && taken) throw new TypeError('fetch failed')
      if (asking && body.includes('"gone"')) taken = true
      if (how === 'never arrives' && asking && body.includes('"controls"')) throw new TypeError('fetch failed')
      if (how === 'late' && asking && body.includes('"controls"')) { late = wait(5000).then(() => real(url, init)).catch(() => {}); throw new TypeError('fetch failed') }
      if (how === 'lost after' && asking && body.includes('"controls"')) { await real(url, init); throw new TypeError('fetch failed') }
      return real(url, init)
    }
    let r, threw
    try { r = await enliven({ world: server.url, from: aim(old), by: 'Rhea', journal }) } catch (e) { threw = e } finally { globalThis.fetch = real }
    await late
    await wait(1000)
    const here_ = (await things()).filter((t) => Math.hypot(t.at[0] - old.at[0], t.at[2] - old.at[2]) <= 3)
    check(!threw && here_.length === 1 && (how === 'never arrives' ? here_[0].id === old.id && !here_[0].controls : !!here_[0].controls), `${how}: one thing stands where ${old.name} stood (${here_.map((t) => `${t.id}${t.controls ? ' alive' : ''}`).join(', ') || 'nothing'}; ${threw ? `threw: ${threw.message}` : `${r?.state}: ${r?.note}`})`)
    for (const t of here_) await undo({ world: server.url, id: t.id, by: 'Rhea', journal })
  }
  for (const how of ['late', 'lost after', 'unreachable', 'never arrives']) await failing(how, 'a blue lorry')

  // Two asks at once that each make a thing in place of the same one (two askers, or one sent twice): the world takes
  // one and refuses the other, and one thing stands there. Both were taken, and two things stood where one had.
  {
    const where = from((x += 300), 4070), old = (await asks('a blue lorry', where)).made, answers = []
    globalThis.fetch = async (url, init) => {
      const body = typeof init?.body === 'string' ? init.body : ''
      if (!/\/world\/ask$/.test(String(url)) || !body.includes('"gone"')) return real(url, init)
      const twin = JSON.parse(body); twin.thing.id = `${twin.thing.id}-twin`
      const [a, b] = await Promise.all([real(url, init), real(url, { ...init, body: JSON.stringify(twin) })])
      answers.push(a.status, b.status)
      return a
    }
    let r, threw
    try { r = await enliven({ world: server.url, from: aim(old), by: 'Rhea', journal }) } catch (e) { threw = e } finally { globalThis.fetch = real }
    await wait(1000)
    const there = (await things()).filter((t) => Math.hypot(t.at[0] - old.at[0], t.at[2] - old.at[2]) <= 3)
    check(!!old && !threw && answers.slice().sort().join() === '202,409' && there.length === 1 && !!there[0].controls, `two asks at once to make a thing in place of ${old?.name}: the world answers ${answers.join(' and ')}, and one living thing stands there (${there.map((t) => `${t.id}${t.controls ? ' alive' : ''}`).join(', ') || 'nothing'}; ${threw ? `threw: ${threw.message}` : `${r?.state}`})`)
    for (const t of there) await undo({ world: server.url, id: t.id, by: 'Rhea', journal })
  }

  // A thing someone is picking up this moment (the ask taken, the world not yet done with it) is not made again in
  // its place: the hand would hold a thing that is gone. And one being taken out by its id is not taken twice.
  {
    const where = from((x += 300), 4070), old = (await asks('a blue lorry', where)).made, answers = []
    globalThis.fetch = async (url, init) => {
      const body = typeof init?.body === 'string' ? init.body : ''
      if (!/\/world\/ask$/.test(String(url)) || !body.includes('"gone"')) return real(url, init)
      const [h, a] = await Promise.all([real(url, { method: 'POST', body: JSON.stringify({ by: 'Rhea', hold: old.id }) }), real(url, init)])
      answers.push(h.status, a.status)
      return a
    }
    let r, threw
    try { r = await enliven({ world: server.url, from: aim(old), by: 'Rhea', journal }) } catch (e) { threw = e } finally { globalThis.fetch = real }
    await wait(1000)
    const there = (await things()).filter((t) => Math.hypot(t.at[0] - old.at[0], t.at[2] - old.at[2]) <= 3)
    check(!!old && !threw && answers.join() === '202,409' && there.length === 1 && there[0].id === old.id && !there[0].controls, `a thing being picked up as it is asked to be made drivable: the world answers ${answers.join(' and ')}, and it stands as it was (${there.map((t) => `${t.id}${t.controls ? ' alive' : ''}`).join(', ') || 'nothing'}; ${threw ? `threw: ${threw.message}` : `${r?.state}`})`)
    const twice = await Promise.all([0, 1].map(() => real(`${server.url}/world/ask`, { method: 'POST', body: JSON.stringify({ by: 'Rhea', gone: old.id }) }).then((res) => res.status)))
    await wait(500)
    check(twice.slice().sort().join() === '202,409' && !(await one(old.id)), `taken out twice at once by its id: the world answers ${twice.join(' and ')}, and it is gone`)
  }

  // Driven, by a rider and by a rule: not taken out for its better one, now and after the world starts again.
  const better = (t) => make({ wish: 'a little hatchback', world: server.url, how: 'parts', model: async () => ({ text: HATCH.replace('little red hatchback', 'little red hatchback, better'), model: 'a better stand-in', ms: 0, cost: 0 }), instead: { id: t.id, at: t.at }, by: 'Rhea', journal, tries: 1 })
  const ridden = (await asks('a little hatchback', from((x += 300), 4070))).made, ruled = (await asks('a little hatchback', from((x += 300), 4070))).made
  const plain = (await asks('a little hatchback', from((x += 300), 4070))).made
  check(!!ridden?.controls && !!ruled?.controls && !!plain?.controls, 'three hatchbacks stand alive')
  for (let i = 0; i < 4; i++) { await fetch(`${server.url}/world/drive`, { method: 'POST', body: JSON.stringify({ by: 'Rhea', id: ridden.id, go: 1 }) }); await wait(250) }
  await fetch(`${server.url}/world/drive`, { method: 'POST', body: JSON.stringify({ by: 'Rhea', id: ridden.id, go: 0 }) })
  await fetch(`${server.url}/world/ask`, { method: 'POST', body: JSON.stringify({ by: 'tester', rule: { id: 'pusher', name: 'Drives a car a little', source: `on('start', (world) => world.drive(${JSON.stringify(ruled.id)}, {go: 1}))` } }) })
  for (let i = 0; i < 40 && !(await one(ruled.id))?.controls?.driven; i++) await wait(250)
  if (process.env.DEBUG) console.log(JSON.stringify(await fetch(`${server.url}/world/rules`).then((r) => r.json())), JSON.stringify((await one(ruled.id))?.controls?.driven), JSON.stringify((await one(ridden.id))?.controls?.driven))
  const r1 = await better(ruled)
  check(r1.state === 'kept' && !!(await one(ruled.id)), `a car a rule drove is not taken out for its better one (${r1.state})`)
  // The world starts again on its own file.
  await fetch(`${server.url}/world/ask`, { method: 'POST', body: JSON.stringify({ by: 'tester', unrule: 'pusher' }) })
  await wait(1500)
  server.stop(); await wait(800)
  server = await serve('/dev/null', ['--world', file])
  await wait(1500)
  const r2 = await better(ridden)
  check(r2.state === 'kept' && !!(await one(ridden.id)), `after the world starts again, a car a rider drove is not taken out for its better one (${r2.state})`)
  const r3 = await better(plain)
  check(r3.state === 'there' && !(await one(plain.id)), `one nobody got on is (${r3.state}: ${r3.why ?? ''})`)
} catch (e) { failures.push(`stopped: ${e.message}`); console.error(e) }
await a.close()
server.stop()
rmSync(dir, { recursive: true, force: true })
if (failures.length) { console.error(`FAILED\n  ${failures.join('\n  ')}`); process.exit(1) }
console.log('drivable: ok (no model was run)')
process.exit(0)
