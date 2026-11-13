// Making (#220): say what you want and where, and a model makes it in a shared world, out of the world's own cells.
//
//   node make.mjs "a market stall with a striped awning" --world http://127.0.0.1:5741 --at 700,3990
//   node make.mjs "a red phone box" --world URL --from 700,172,4060 --toward 0,-0.2,-1    where an eye there looks
//   node make.mjs "a fountain" --world URL --me              in front of you, if you alone have that world open in a page (--me name if not: the name over your head)
//   node make.mjs --undo --world URL                         takes the last one out again
//
//   --facing south|north|east|west   which way its front faces (default: towards --from, or south)
//   --model opus                     which of your models makes it (sonnet is about twice as fast and plainer)
//   --reply file                     a reply kept in a file stands in for the model (no model is run)
//   --dry                            make and check it, send nothing
//   --by name  --journal file  --claude path
//
// The model is your own Claude Code, run on this machine with no tools, and its reply is data: a list of boxes
// (make/form.mjs), checked, turned into cells here, and sent to the world as one ordinary edit that the world
// takes whole or not at all. The world's server never runs a model.
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BRIEF, again } from './make/brief.mjs'
import { read, refused } from './make/form.mjs'
import { reply as ask } from './make/model.mjs'
import { at, gaze, look, middle, people, outOf, send, site, stands, towards } from './make/place.mjs'

const here = dirname(fileURLToPath(import.meta.url))
/** How many times a model is asked for one thing: once, and twice more if its reply cannot be used, told why. */
const TRIES = 3
/** How far above the land's own top a place may be and still be the ground, in cells. */
const ON_GROUND = 12
export const JOURNAL = join(homedir(), '.village', 'engine', 'made.jsonl')
const note = async (journal, line) => { await mkdir(dirname(journal), { recursive: true }); await appendFile(journal, JSON.stringify({ at: new Date().toISOString(), ...line }) + '\n') }

/**
 * Makes one thing. `where` is { at: [x, z] } or { from: [x, y, z], toward: [dx, dy, dz] }. Resolves to what
 * happened: { state: 'there' | 'fell' | 'not there' | 'unknown' | 'refused' | 'dry', why, name, rows, cells, origin, facing, ms, model, tries }.
 * `model` is how a reply is got ({ system, prompt } to { text, model, ms, cost }): the real binary unless another is given.
 */
export async function make({ wish, world, where, facing, by = 'maker', journal = JOURNAL, model = (q) => ask(q), dry = false, core = join(here, 'page', 'core.wasm'), say = () => {} }) {
  wish = String(wish).trim().slice(0, 400)
  if (!wish) return { state: 'refused', why: 'say what to make' }
  // Where. A thing stands on the ground (a kerb or a heap is ground enough), never on top of something else:
  // whether it would stand is asked of a world that has only the rules in it (place.mjs `stands`).
  // Ground is a top: near the land's own height, with air over it. The foot of a wall is near it too, with wall over it.
  const land = async (c) => c && c[1] <= (await at(world, c)).ground + ON_GROUND && (await at(world, [c[0], c[1] + 1, c[2]])).material === 0
  let spot, eye = null, wall = false
  if (where.at) {
    // From above: the first thing down a line from over the land at that place.
    const [x, z] = where.at
    spot = (await look(world, [x, (await at(world, [x, 0, z])).ground + 60, z], [0, -1, 0])).at
    if (spot && !(await land(spot))) return { state: 'refused', why: 'something already stands there' }
  } else {
    eye = where.from
    spot = (await look(world, where.from, where.toward)).at
    // A look that meets a wall means the ground at its foot, on the side of whoever looks.
    if (spot && !(await land(spot))) {
      wall = true
      const [dx, dz] = outOf(towards(spot, eye))
      spot = (await look(world, [spot[0] + dx * 2, spot[1], spot[2] + dz * 2], [0, -1, 0])).at
      if (spot && !(await land(spot))) return { state: 'refused', why: 'that is on top of something: a thing stands on the ground' }
    }
  }
  if (!spot) return { state: 'refused', why: 'nothing is there to stand it on' }
  facing ??= eye ? towards(spot, eye) : 'south'
  const out = { wish, facing, tries: 0, ms: 0, cost: 0 }
  let prompt = wish, thing, placed
  for (; out.tries < TRIES;) {
    out.tries++
    say(`asking the model${out.tries > 1 ? ' again' : ''}`)
    let got
    try { got = await model({ system: BRIEF, prompt }) } catch (e) { return { ...out, state: 'refused', why: e.message } }
    out.ms += got.ms; out.cost += got.cost ?? 0; out.model = got.model; out.reply = got.text
    let why
    try {
      thing = read(got.text)
      // Looked at, the place is where its front goes: it stands behind that, not round it and half on the asker's
      // toes. At the foot of a wall it is where its back goes: it stands out from the wall, towards the asker.
      const out1 = outOf(facing), deep = Math.ceil(thing.size[2] / 2) * (wall ? 1 : -1)
      placed = await site(world, thing, eye ? [spot[0] + out1[0] * deep, spot[1], spot[2] + out1[1] * deep] : spot, facing, eye ? out1 : [0, 0])
      const fell = await stands(core, placed.rows)
      if (fell.length) {
        const parts = new Map()
        for (const i of fell) parts.set(placed.rows.from[i], (parts.get(placed.rows.from[i]) ?? 0) + 1)
        const worst = [...parts].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n]) => `part ${n} (${JSON.stringify(thing.said[n - 1]).slice(0, 60)})`)
        why = `it would not stand. These would come loose and fall: ${worst.join('; ')}. A join carries only so much: let wood or steel that reaches the ground carry what hangs or reaches out, make what carries thicker, and keep the weight over the feet`
      }
    } catch (e) {
      if (e.place) return { ...out, state: 'refused', why: e.message, name: thing.name }
      if (!refused(e) && !e.form) throw e
      why = e.message
    }
    if (!why) break
    say(`refused: ${why}`)
    out.refusals = [...(out.refusals ?? []), why]
    if (out.tries === TRIES) return { ...out, state: 'refused', why }
    prompt = again(wish, got.text.slice(0, 20_000), why)
  }
  Object.assign(out, { name: thing.name, size: thing.size, parts: thing.parts, cells: thing.filled, crumbs: thing.crumbs, rows: placed.rows.length, origin: placed.origin })
  if (dry) return { ...out, state: 'dry', made: placed.rows }
  // It is written down before it is sent, and what came of it after: a send that was cut short is not made again blindly.
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  await note(journal, { id, state: 'sending', world, by, wish, name: thing.name, model: out.model, facing, origin: placed.origin, rows: placed.rows })
  const sent = await send(world, placed.rows, by)
  await note(journal, { id, state: sent.state, why: sent.why })
  return { ...out, id, ...sent, look: middle(placed.rows) }
}

/**
 * Takes a made thing out again: every cell it put is emptied (and anything put inside it since). The last one sent
 * to this world, or the one named. One whose sending was never finished (the maker was stopped) counts as sent:
 * it may be there.
 */
export async function undo({ world, id, by = 'maker', journal = JOURNAL }) {
  let lines = []
  try { lines = (await readFile(journal, 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l)) } catch { /* nothing was ever made */ }
  const last = new Map()
  for (const l of lines) last.set(l.id, { ...last.get(l.id), ...l })
  const thing = [...last.values()].reverse().find((t) => t.world === world && t.rows && (id ? t.id === id : ['there', 'fell', 'unknown', 'sending'].includes(t.state)))
  if (!thing) return { state: 'refused', why: 'nothing made in that world is written down' }
  const sent = await send(world, thing.rows, by, { kind: 0 })
  const state = sent.state === 'there' ? 'undone' : sent.state
  await note(journal, { id: thing.id, state, why: sent.why })
  return { id: thing.id, name: thing.name, state, why: sent.why }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), flag = (name) => { const i = args.indexOf(`--${name}`); return i < 0 ? undefined : args[i + 1] }, has = (name) => args.includes(`--${name}`)
  const numbers = (name, n) => { const v = flag(name)?.split(',').map(Number); if (v && (v.length !== n || !v.every(Number.isFinite))) { console.error(`--${name} is ${n} numbers with commas between`); process.exit(2) } return v }
  const world = flag('world')?.replace(/\/$/, ''), journal = flag('journal') ?? JOURNAL, by = flag('by') ?? 'maker'
  if (!world) { console.error('say which world: --world http://127.0.0.1:port (a server started with --world file)'); process.exit(2) }
  if (has('undo')) {
    const r = await undo({ world, id: flag('undo')?.startsWith('--') ? undefined : flag('undo'), by, journal })
    console.log(r.state === 'undone' ? `took out ${r.name}` : `not undone (${r.state}): ${r.why}`)
    process.exit(r.state === 'undone' ? 0 : 1)
  }
  const wish = args[0]?.startsWith('--') ? '' : args[0]
  const spotAt = numbers('at', 2), from = numbers('from', 3), toward = numbers('toward', 3)
  let where = spotAt ? { at: spotAt } : from && toward ? { from: from.map(Math.round), toward } : null
  if (wish && has('me')) {
    const name = flag('me')?.startsWith('--') ? undefined : flag('me'), there = (await people(world)).filter((p) => !p.seat)
    const who = name ? there.find((p) => p.name === name || p.by === name) : there.length === 1 ? there[0] : null
    if (!who) { console.error(there.length ? `${there.length} have that world open: say which with --me name (${there.map((p) => p.name ?? p.by).join(', ')})` : 'nobody has that world open in a page: open /city?shared=1 there, or say where with --at or --from'); process.exit(2) }
    where = gaze(who)
  }
  if (!wish || !where) { console.error('node make.mjs "what to make" --world URL (--me | --at x,z | --from x,y,z --toward dx,dy,dz)'); process.exit(2) }
  const canned = flag('reply')
  const model = canned ? async () => ({ text: await readFile(canned, 'utf8'), model: `a reply kept in ${canned} (no model was run)`, ms: 0, cost: 0 }) : (q) => ask({ ...q, model: flag('model') ?? 'opus', binary: flag('claude') ?? 'claude' })
  const r = await make({ wish, world, where, facing: flag('facing'), by, journal, model, dry: has('dry'), say: (s) => console.log(`  ${s}`) })
  const what = r.origin ? `${r.name}: ${r.cells} cells in ${r.rows} runs, ${r.size.join(' x ')}, facing ${r.facing} at ${r.origin.join(', ')}` : ''
  if (r.crumbs) console.log(`  ${r.crumbs} stray cells that touched nothing were left out`)
  if (r.state === 'there') console.log(`made ${what}\n  by ${r.model} in ${(r.ms / 1000).toFixed(1)} s${r.tries > 1 ? ` (asked ${r.tries} times)` : ''}; undo with --undo ${r.id}`)
  else if (r.state === 'dry') console.log(`would make ${what} (nothing was sent)`)
  else console.log(`not made (${r.state}): ${r.why}${what ? `\n  ${what}` : ''}`)
  process.exit(r.state === 'there' || r.state === 'dry' ? 0 : 1)
}
