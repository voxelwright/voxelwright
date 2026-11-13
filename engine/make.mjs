// Making (#220): say what you want and where, and a model makes it in a shared world, out of the world's own cells.
//
//   node make.mjs "a market stall with a striped awning" --world http://127.0.0.1:5741 --at 700,3990
//   node make.mjs "a red phone box" --world URL --from 700,172,4060 --toward 0,-0.2,-1    where an eye there looks
//   node make.mjs "a fountain" --world URL --me              in front of you, if you alone have that world open in a page (--me name if not: the name over your head)
//   node make.mjs --undo --world URL                         takes the last one out again
//
//   --fill 100,120,100 --grow cap|scale   a space to fill, in cells (wide, high, deep), and how a thing past 6.4 m is come by
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
import { BRIEF, SEEN, again, asked } from './make/brief.mjs'
import { SIZE_MOST, fieldsBrief, read, refused, scaled } from './make/form.mjs'
import { reply as ask } from './make/model.mjs'
import { at, beside, edit, emptied, gaze, look, middle, people, outOf, send, site, stands, towards } from './make/place.mjs'

const here = dirname(fileURLToPath(import.meta.url))
/** How many times a model is asked for one thing: once, and twice more if its reply cannot be used, told why. */
const TRIES = 3
/** How far above the land's own top a place may be and still be the ground, in cells. */
const ON_GROUND = 12
export const JOURNAL = join(homedir(), '.village', 'engine', 'made.jsonl')
const note = async (journal, line) => { await mkdir(dirname(journal), { recursive: true }); await appendFile(journal, JSON.stringify({ at: new Date().toISOString(), ...line }) + '\n') }

/** How much of what a reply described must be left, after what cannot be used is taken out, for it to be made without asking again. */
const ENOUGH = 0.85
/** The most a thing asked to fill a space may be along any side, in cells: 25.6 m, the biggest area the wand marks. */
const FILL_MOST = 256
/** The most a thing is built whole along a side, in cells of 10 cm, before it is built as a model and scaled. */
const WHOLE_MOST = 128
/** How far round a place ground is looked for, in cells, when the place itself is not ground. */
const REACH = 64

/**
 * Where a thing asked for at `where` goes: the ground there, or the nearest ground to it. A wish is not turned down
 * for where it was aimed: on a roof, at the sky, at a car, it is taken to mean the ground nearest that.
 * Resolves to { spot, eye, wall } or { why } when there is no ground within reach (the open sea).
 */
async function ground(world, where) {
  // Ground is a top: near the land's own height, with air over it. The foot of a wall is near it too, with wall over it.
  const land = async (c) => c && c[1] <= (await at(world, c)).ground + ON_GROUND && (await at(world, [c[0], c[1] + 1, c[2]])).material === 0 && (await at(world, c)).material !== 5
  const down = async (x, z) => (await look(world, [x, (await at(world, [x, 0, z])).ground + 60, z], [0, -1, 0])).at
  let spot, eye = null, wall = false, aim
  // A box to fill: its middle, on what its floor lies on.
  if (where.box) { const b = where.box; aim = [Math.round((b[0] + b[3]) / 2), Math.round((b[2] + b[5]) / 2)]; spot = [aim[0], b[1] - 1, aim[1]]; if (await land(spot)) return { spot, eye: where.from ?? null, wall: false, centred: true }; spot = await down(...aim); if (spot && (await land(spot))) return { spot, eye: where.from ?? null, wall: false, centred: true } }
  else if (where.at) { aim = where.at; spot = await down(...aim) }
  else {
    eye = where.from
    spot = (await look(world, where.from, where.toward)).at
    // A look that meets nothing (the sky, or further than a look goes): four metres ahead, on the ground.
    const flat = Math.hypot(where.toward[0], where.toward[2]) || 1
    aim = spot ? [spot[0], spot[2]] : [Math.round(eye[0] + (where.toward[0] / flat) * 40), Math.round(eye[2] + (where.toward[2] / flat) * 40)]
    if (!spot) spot = await down(...aim)
    // A look that meets a wall means the ground at its foot, on the side of whoever looks.
    else if (!(await land(spot))) {
      const [dx, dz] = outOf(towards(spot, eye))
      const foot = (await look(world, [spot[0] + dx * 2, spot[1], spot[2] + dz * 2], [0, -1, 0])).at
      if (foot && (await land(foot))) { spot = foot; wall = true }
    }
  }
  if (spot && (await land(spot))) return { spot, eye, wall }
  // Not ground (a roof, a car, water): the nearest ground round it, nearer first, towards whoever asked first.
  for (let r = 4; r <= REACH; r += 4) for (let k = 0; k < 8; k++) {
    const turn = (k * Math.PI) / 4 + (eye ? Math.atan2(eye[2] - aim[1], eye[0] - aim[0]) : 0)
    const c = await down(Math.round(aim[0] + Math.cos(turn) * r), Math.round(aim[1] + Math.sin(turn) * r))
    if (c && (await land(c))) return { spot: c, eye, wall: false }
  }
  return { why: 'there is no ground near there to stand it on' }
}

/**
 * Stands a thing at a place and takes out of it whatever would fall there by the core's own rule, until what is
 * left stands. Resolves to { origin, rows, moved, share, fell }: `share` is how much of it is left (0 to 1), `fell`
 * names the parts that lost cells. Throws an error with `place` if no place near will take it.
 */
async function settle(world, core, thing, { spot, eye, wall, centred }, facing, clear) {
  // Looked at, the place is where its front goes: it stands behind that, not round it and half on the asker's
  // toes. At the foot of a wall it is where its back goes: it stands out from the wall, towards the asker.
  const out1 = outOf(facing), deep = Math.ceil(thing.size[2] / 2) * (wall ? 1 : -1)
  // A box to fill is filled where it is: the thing's middle at the box's.
  const placed = await site(world, thing, eye && !centred ? [spot[0] + out1[0] * deep, spot[1], spot[2] + out1[1] * deep] : spot, facing, eye ? out1 : [0, 0], { clear })
  const count = (rows) => rows.reduce((n, r) => n + r[1] - r[0], 0), whole = count(placed.rows), parts = new Map()
  let rows = placed.rows
  // What falls is taken off from the top down, a third of its height at a time, and asked again: a top too heavy
  // for its post brings the post down with it, and without the top the post stands.
  for (let round = 0; round < 16 && rows.length; round++) {
    const fell = await stands(core, rows)
    if (!fell.length) break
    const ys = fell.map((i) => rows[i][2]), top = Math.max(...ys), from = top - Math.floor((top - Math.min(...ys)) / 3)
    const gone = new Set(fell.filter((i) => rows[i][2] >= from))
    for (const i of gone) parts.set(rows.from[i], (parts.get(rows.from[i]) ?? 0) + rows[i][1] - rows[i][0])
    rows = Object.assign(rows.filter((_, i) => !gone.has(i)), { from: rows.from.filter((_, i) => !gone.has(i)) })
    if (round === 15 && (await stands(core, rows)).length) rows = Object.assign([], { from: [] })
  }
  return { origin: placed.origin, rows, moved: placed.moved, share: count(rows) / whole, fell: [...parts].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n]) => `part ${n} (${JSON.stringify(thing.said[n - 1]).slice(0, 60)})`) }
}

/** Sends a thing that stands at its place, written down before and after. `clear`: the cells of its box are emptied first. */
async function deliver({ out, thing, placed, world, by, journal, wish, facing, clear, say }) {
  Object.assign(out, { name: thing.name, size: thing.size, parts: thing.parts, cells: thing.filled, crumbs: thing.crumbs, rows: placed.rows.length, origin: placed.origin, moved: placed.moved })
  // It is written down before it is sent, and what came of it after: a send that was cut short is not made again blindly.
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  say('sending it', { stage: 'sending', id, name: thing.name, at: placed.origin, size: thing.size, facing })
  if (clear) for (const rows of emptied(placed.rows)) await fetch(`${world}/world/ask`, { method: 'POST', body: JSON.stringify({ by, edit: edit(rows), release: beside(placed.rows) }) })
  await note(journal, { id, state: 'sending', world, by, wish, name: thing.name, model: out.model, facing, origin: placed.origin, rows: placed.rows })
  // Its record goes on the same ask as its cells (#243): the world has neither without the other, and never two of one id.
  const sent = await send(world, placed.rows, by, { thing: { id, name: thing.name, wish, at: placed.origin, size: thing.size, facing, ...thing.record } })
  await note(journal, { id, state: sent.state, why: sent.why })
  return { ...out, id, ...sent, look: middle(placed.rows) }
}

/**
 * Makes one thing from a wish and, if they came with it, a `picture` ({ type, data: base64 }) and a `page` ({ from, text }:
 * words the caller fetched from a link). Neither is written down or sent anywhere but to the model. `where` is
 * { at: [x, z] } or { from: [x, y, z], toward: [dx, dy, dz] }. Resolves to what happened:
 * { state: 'there' | 'fell' | 'not there' | 'unknown' | 'held' | 'refused' | 'dry', why, name, rows, cells, origin, facing, ms, model, tries }.
 *
 * A wish is kept to. What of a reply cannot be used is left out and the rest made (a part that is not the form's,
 * cells that touch nothing, what would fall); the model is asked again only when too much would be lost, and after
 * the last asking the best of its replies is made. A place that is not ground means the ground nearest it, and a
 * place that is taken means the nearest that is not, out to eight metres. `held`: it is made and no place near will
 * take it; `hold` is the thing, for `put` to stand where the asker next says, or there with the place cleared.
 * `refused` is left for a model that could not be run, replies nothing can be made of, and no ground within reach.
 *
 * `say(words, stage)` is told how it goes: { stage: 'place', at, facing }, { stage: 'asking', try }, { stage: 'shaped', name, size, facing }, { stage: 'refused', why }, { stage: 'sending', id, name, at, size, facing }.
 * `model` is how a reply is got ({ system, prompt } to { text, model, ms, cost }): the real binary unless another is given.
 */
export async function make({ wish = '', picture, page, world, where, fill, grow = 'cap', facing, by = 'maker', journal = JOURNAL, model = (q) => ask(q), dry = false, core = join(here, 'page', 'core.wasm'), say = () => {} }) {
  wish = String(wish).trim().slice(0, 400)
  if (!wish && !picture && !page) return { state: 'refused', why: 'say what to make' }
  const found = await ground(world, where)
  if (found.why) return { state: 'refused', why: found.why }
  const { spot, eye } = found
  facing ??= eye ? towards(spot, eye) : 'south'
  const out = { wish, facing, tries: 0, ms: 0, cost: 0 }
  say('a place was found', { stage: 'place', at: spot, facing })
  // The wish is all the model is asked, unless a picture or a page came with it: those are set apart as things to look at.
  // A space to fill (`fill`: wide, high, deep in cells, as seen from its front). A thing bigger than the usual most
  // is come by in one of two ways. Built whole: the model builds it at its full size in 10 cm cells, which keeps a
  // house's boards and railings and holds to about 12 m a side (a house 11 m wide was 10,821 of an edit's 13,107 runs
  // and took 101 s). Scaled: it builds a model and every cell becomes a block k cells a side, which always fits and
  // is coarser. `grow: 'cap'` builds whole up to WHOLE_MOST a side and scales past that; `'scale'` scales past the usual most.
  const whole = grow === 'scale' ? SIZE_MOST : SIZE_MOST.map((v) => Math.max(v, WHOLE_MOST))
  const times = fill ? Math.max(1, Math.ceil(Math.max(fill[0] / whole[0], fill[1] / whole[1], fill[2] / whole[2]))) : 1
  const most = fill ? fill.map((v, a) => Math.max(SIZE_MOST[a], Math.min(whole[a], Math.ceil(v / times)))) : SIZE_MOST
  const sized = !fill ? '' : times > 1
    ? `\n\nIt will be made ${times} times as big after you build it, to fill a space ${(fill[0] / 10).toFixed(1)} m wide, ${(fill[1] / 10).toFixed(1)} m high and ${(fill[2] / 10).toFixed(1)} m deep. Build a model of it at one part in ${times}: about ${Math.floor(fill[0] / times)} cells wide, ${Math.floor(fill[1] / times)} high and ${Math.floor(fill[2] / times)} deep, in its own proportions. Every cell of yours becomes a block ${times} cells a side, so the sizes of things given above are ${times} times too big for it: a person would be ${Math.round(17 / times)} cells tall beside it.`
    : `\n\nIt is to fill a space ${Math.min(fill[0], FILL_MOST)} cells wide, ${Math.min(fill[1], FILL_MOST)} high and ${Math.min(fill[2], FILL_MOST)} deep: build it that big, in its own proportions (do not stretch it to fit).`
  const first = asked(wish, page, picture) + sized, system = BRIEF.replace(`Size is at most ${SIZE_MOST.join(' by ')}`, `Size is at most ${most.join(' by ')}`) + fieldsBrief() + (picture || page ? SEEN : ''), pictures = picture ? [picture] : []
  /** The best of what the replies gave so far: the thing, where it stands, and how much of what was described is left. */
  let prompt = first, best = null, why = ''
  for (; out.tries < TRIES;) {
    out.tries++
    say(`asking the model${out.tries > 1 ? ' again' : ''}`, { stage: 'asking', try: out.tries })
    let got
    try { got = await model({ system, prompt, pictures }) } catch (e) { if (best) break; return { ...out, state: 'refused', why: e.message } }
    out.ms += got.ms; out.cost += got.cost ?? 0; out.model = got.model; out.reply = got.text
    why = ''
    try {
      const thing = scaled(read(got.text, { lenient: true, most }), times)
      // Its size is known from here, a second or two before it is placed and sent: what covers the wait closes round it.
      say('it has a shape', { stage: 'shaped', name: thing.name, size: thing.size, facing })
      let placed = null
      try { placed = await settle(world, core, thing, found, facing, false) } catch (e) {
        if (!e.place) throw e
        // It is made, and no place near will take it: it is held for the asker to say where, not thrown away.
        if (!best) best = { thing, placed: null, share: thing.kept, blocked: e.message, reply: got.text }
        break
      }
      const share = thing.kept * placed.share
      if (placed.rows.length && (!best || share > best.share)) best = { thing, placed, share, reply: got.text }
      if (!placed.rows.length) why = 'none of it would stand: nothing of it that reaches the ground carries the rest'
      else if (share < ENOUGH) why = [...thing.left.slice(0, 6), placed.fell.length ? `these would come loose and fall: ${placed.fell.join('; ')}. A join carries only so much: let wood or steel that reaches the ground carry what hangs or reaches out, make what carries thicker, and keep the weight over the feet` : ''].filter(Boolean).join('. ')
    } catch (e) {
      if (!refused(e) && !e.form) throw e
      why = e.message
    }
    if (!why) break
    say(`asked again: ${why}`, { stage: 'refused', why })
    out.refusals = [...(out.refusals ?? []), why]
    if (out.tries < TRIES) prompt = again(first, got.text.slice(0, 20_000), why)
  }
  if (!best) return { ...out, state: 'refused', why }
  const { thing, placed } = best
  // The reply the thing was made from (the best of them), for whoever keeps a library of what was made.
  out.reply = best.reply
  if (best.share < 1) out.left = Math.round((1 - best.share) * 100)
  if (!placed) return { ...out, state: 'held', why: best.blocked, name: thing.name, size: thing.size, hold: { thing, facing, wish, model: out.model } }
  if (dry) { Object.assign(out, { name: thing.name, size: thing.size, parts: thing.parts, cells: thing.filled, crumbs: thing.crumbs, rows: placed.rows.length, origin: placed.origin, moved: placed.moved }); return { ...out, state: 'dry', made: placed.rows } }
  return deliver({ out, thing, placed, world, by, journal, wish, facing, say })
}

/**
 * Stands a held thing (`make`'s `hold`) where the asker now says, without asking a model again. `clear`: at that very
 * place, with whatever is in its box emptied first: what stood there is gone, and what stood on that falls.
 * Resolves as `make` does; `held` again if that place will not take it either.
 */
export async function put({ hold, world, where, clear = false, by = 'maker', journal = JOURNAL, core = join(here, 'page', 'core.wasm'), say = () => {} }) {
  const { thing, wish } = hold
  // To clear a place is to mean that place: what is looked at, whatever it is.
  const found = clear && where.from ? await look(world, where.from, where.toward).then((m) => (m.at ? { spot: m.at, eye: where.from, wall: false } : ground(world, where))) : await ground(world, where)
  if (found.why) return { state: 'held', why: found.why, name: thing.name, size: thing.size, hold }
  const facing = found.eye ? towards(found.spot, found.eye) : hold.facing
  const out = { wish, facing, tries: 0, ms: 0, cost: 0, model: hold.model }
  say('a place was found', { stage: 'place', at: found.spot, facing })
  say('it has a shape', { stage: 'shaped', name: thing.name, size: thing.size, facing })
  let placed
  try { placed = await settle(world, core, thing, found, facing, clear) } catch (e) { if (!e.place && !e.form) throw e; return { ...out, state: 'held', why: e.message, name: thing.name, size: thing.size, hold } }
  if (!placed.rows.length) return { ...out, state: 'held', why: 'it would not stand there', name: thing.name, size: thing.size, hold }
  return deliver({ out, thing, placed, world, by, journal, wish, facing, clear, say })
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
  // Its record goes with it. (A thing made before the world kept records has none: that refusal is not a failure.)
  if (state === 'undone') await fetch(`${world}/world/ask`, { method: 'POST', body: JSON.stringify({ by, gone: thing.id }) }).catch(() => {})
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
  const spotAt = numbers('at', 2), from = numbers('from', 3), toward = numbers('toward', 3), fill = numbers('fill', 3)
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
  const r = await make({ wish, world, where, fill, grow: flag('grow') ?? 'cap', facing: flag('facing'), by, journal, model, dry: has('dry'), say: (s) => console.log(`  ${s}`) })
  const what = r.origin ? `${r.name}: ${r.cells} cells in ${r.rows} runs, ${r.size.join(' x ')}, facing ${r.facing} at ${r.origin.join(', ')}` : ''
  if (r.left) console.log(`  about ${r.left} in a hundred of what the model described could not be used and was left out`)
  if (r.moved) console.log(`  the place itself was taken: it stands ${(r.moved / 10).toFixed(1)} m from it`)
  if (r.state === 'there') console.log(`made ${what}\n  by ${r.model} in ${(r.ms / 1000).toFixed(1)} s${r.tries > 1 ? ` (asked ${r.tries} times)` : ''}; undo with --undo ${r.id}`)
  else if (r.state === 'dry') console.log(`would make ${what} (nothing was sent)`)
  else if (r.state === 'held') console.log(`made ${r.name}, and no place near there will take it (${r.why}): say another place with --at or --from`)
  else console.log(`not made (${r.state}): ${r.why}${what ? `\n  ${what}` : ''}`)
  process.exit(r.state === 'there' || r.state === 'dry' ? 0 : 1)
}
