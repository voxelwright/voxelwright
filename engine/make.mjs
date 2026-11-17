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
//   --program                        the reply is a program that lays the thing in cells as fine as 1.25 cm (minutes, far more detail)
//   --cells                          the reply is cells (make/cells.mjs): what a picture was carved into, or a thing kept once made
//   --reply file                     a reply kept in a file stands in for the model (no model is run)
//   --dry                            make and check it, send nothing
//   --fresh                          ask the model even if the wish was made before and is kept (make/library.mjs; --library dir)
//   --times                          say how long each stage took
//   --by name  --journal file  --claude path
//
// The model is your own Claude Code, run on this machine with no tools, and its reply is data: a list of boxes
// (make/form.mjs), checked, turned into cells here, and sent to the world as one ordinary edit that the world
// takes whole or not at all. The world's server never runs a model.
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BRIEF, PROGRAM, SEEN, again, asked } from './make/brief.mjs'
import { fineRows, grained, standin } from './make/fine.mjs'
import { ROWS_MOST, SIZE_MOST, THING_ROWS_MOST, fieldKeys, fieldsBrief, read, refused, scaled } from './make/form.mjs'
import { LIBRARY, library, recalled } from './make/library.mjs'
import { made as programmed, refused as stopped } from './make/program.mjs'
import { read as readCells, refused as unread, written } from './make/cells.mjs'
import { keepLook, turned } from './make/alive.mjs'
import { OWN_FRONT, bodyOf, driven } from './make/drivable.mjs'
import { reply as ask } from './make/model.mjs'
import { at, beside, edit, emptied, gaze, look, middle, people, outOf, send, site, stands, towards } from './make/place.mjs'
import { text } from './text.mjs'

const here = dirname(fileURLToPath(import.meta.url))
/** How many times a model is asked for one thing: once, and twice more if its reply cannot be used, told why. */
const TRIES = 3
/** The most of one sector's cells that rows of finer cells may reach (the core's scratch.rs `FINE_BLOCKS`). */
const FINE_REACH_MOST = 16_384
/** How many things of finer cells, bigger than a hand's, may stand within `NEAR` cells of each other (one: #367's bound is one fine thing's worth in view): the next is made in the world's own cells. And how long a thing for a hand is at most, in the world's cells. */
const FINE_NEAR_MOST = 1, NEAR = 200, HAND_MOST = 16
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

/** Where a thing goes at a place that was found (`ground`): `site`, from where its front or back is. */
async function sited(world, thing, { spot, eye, wall, centred }, facing, clear = false) {
  // A living thing (make/alive.mjs) is turned to face whole, and stands as its body: level, nothing carried down,
  // set over the ground as far as its feet reach, in one edit of the world's usual size.
  const t = thing.living && turned(thing.living, facing), laid = t ? t.body : thing
  // Looked at, the place is where its front goes: it stands behind that, not round it and half on the asker's
  // toes. At the foot of a wall it is where its back goes: it stands out from the wall, towards the asker.
  const out1 = outOf(facing), deep = Math.ceil(laid.size[2] / 2) * (wall ? 1 : -1)
  // A box to fill is filled where it is: the thing's middle at the box's.
  const p = await site(world, laid, eye && !centred ? [spot[0] + out1[0] * deep, spot[1], spot[2] + out1[1] * deep] : spot, facing, eye ? out1 : [0, 0], { clear, most: thing.program && !t ? THING_ROWS_MOST : ROWS_MOST, level: !!thing.fine || !!t })
  if (!t) return p
  const rows = Object.assign(p.rows.map((r) => [r[0], r[1], r[2] + t.lift, r[3], r[4]]), { from: p.rows.from })
  return { ...p, origin: [p.origin[0], p.origin[1] + t.lift, p.origin[2]], rows, turned: t }
}

/**
 * Where a thing (as `kept` gives it) would stand if it were asked for now from `where`, as `make` would stand it: for
 * the ghost on the ask bar. Resolves to { origin, facing, moved } or { why }. Whether it would stand there is not
 * asked, and nothing is sent.
 */
export async function placing({ world, where, thing }) {
  const found = await ground(world, where)
  if (found.why) return found
  const facing = found.eye ? towards(found.spot, found.eye) : 'south'
  try { const p = await sited(world, thing, found, facing); return { origin: p.origin, facing, moved: p.moved } } catch (e) { if (e.place || e.form) return { why: e.message }; throw e }
}

/** A kept reply (`recalled`, make/library.mjs) as the thing `make` would stand: read, but neither placed nor sent. */
export async function kept(entry) {
  const { how, proved } = recalled(entry), text = entry.made ?? entry.reply
  // (One that says it is driven is shown and made alive: make/drivable.mjs.)
  return enlivened(how === 'parts' ? read(text, { lenient: true }) : await built(text, how, proved.joined), () => {})
}

/**
 * Stands a thing at a place and takes out of it whatever would fall there by the core's own rule, until what is
 * left stands. Resolves to { origin, rows, moved, share, fell }: `share` is how much of it is left (0 to 1), `fell`
 * names the parts that lost cells. Throws an error with `place` if no place near will take it.
 */
async function settle(world, core, thing, found, facing, clear, lap = () => {}) {
  const placed = await sited(world, thing, found, facing, clear)
  lap('site')
  const count = (rows) => rows.reduce((n, r) => n + r[1] - r[0], 0), whole = count(placed.rows), parts = new Map(), all = placed.rows
  let rows = placed.rows
  // What falls is taken off from the top down, a third of its height at a time, and asked again: a top too heavy
  // for its post brings the post down with it, and without the top the post stands.
  // A kept thing that stood whole when it was made (`proved.stands`, make/library.mjs) stands on level ground: it is not asked
  // again. On any other ground, or a thing nobody has seen stand, the core is asked.
  for (let round = 0; round < 16 && rows.length && !(thing.stands && placed.flat) && !thing.living; round++) {
    const fell = await stands(core, rows)
    if (!fell.length) break
    const ys = fell.map((i) => rows[i][2]), top = Math.max(...ys), from = top - Math.floor((top - Math.min(...ys)) / 3)
    const gone = new Set(fell.filter((i) => rows[i][2] >= from))
    for (const i of gone) parts.set(rows.from[i], (parts.get(rows.from[i]) ?? 0) + rows[i][1] - rows[i][0])
    rows = Object.assign(rows.filter((_, i) => !gone.has(i)), { from: rows.from.filter((_, i) => !gone.has(i)) })
    if (round === 15 && (await stands(core, rows)).length) rows = Object.assign([], { from: [] })
  }
  lap('stand')
  // A thing of finer cells is sent as those, where its stand-in stands (make/fine.mjs). Unless it would make a
  // crowd of them (#367's bound: fine cells in view are paid for in picture size, and that must not add up): where
  // a thing of finer cells bigger than a hand's already stands within 20 m, this one goes in as its stand-in,
  // in the world's own cells. What is for a hand (under a metre) is always fine.
  const big = (size) => Math.max(...size) > HAND_MOST
  const crowd = thing.fine && big(thing.size) ? (await fetch(`${world}/world/things`).then((r) => r.json()).catch(() => [])).filter((t) => t.grain && !t.held && big(t.size) && Math.hypot(t.at[0] - placed.origin[0], t.at[2] - placed.origin[2]) <= NEAR).length : 0
  const fine = thing.fine && crowd < FINE_NEAR_MOST ? { grain: thing.fine.grain, rows: fineRows(thing.fine, placed.origin, facing) } : undefined
  // A sector of the world (6.4 m a side) takes rows of finer cells that reach at most so many of its cells, whole or
  // not at all (the core's scratch.rs `FINE_BLOCKS`): a thing that would be refused there is not sent.
  if (fine) {
    const reach = new Map()
    for (const r of rows) for (let sx = r[0] >> 6; sx <= (r[1] - 1) >> 6; sx++) { const key = `${sx},${r[2] >> 6},${r[3] >> 6}`; reach.set(key, (reach.get(key) ?? 0) + Math.min(r[1], (sx + 1) << 6) - Math.max(r[0], sx << 6)) }
    const most = Math.max(...reach.values())
    if (most > FINE_REACH_MOST) throw Object.assign(new Error(`it is too solid for cells so fine: ${most} of the world's 10 cm cells in one box 6.4 m a side would hold finer cells, and the most is ${FINE_REACH_MOST}. Build it as a shell two or three cells thick and hollow inside, or thinner, or with a bigger cell`), { form: true })
  }
  lap('near and fine rows')
  if (fine && fine.rows.length > THING_ROWS_MOST) throw Object.assign(new Error(`it comes to ${fine.rows.length} runs and the most is ${THING_ROWS_MOST}: fewer changes of colour from cell to cell along a row`), { form: true })
  // A thing of finer cells is sent whole or not at all, so it is asked after whole: `rows` is all of its stand-in,
  // and `share` still says how much of it the standing rule would let stand.
  return { origin: placed.origin, rows: fine ? all : rows, fine, turned: placed.turned, coarse: !!thing.fine && !fine, moved: placed.moved, share: count(rows) / whole, fell: [...parts].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n]) => (thing.said[n - 1] ? `part ${n} (${JSON.stringify(thing.said[n - 1]).slice(0, 60)})` : 'what is highest and reaches furthest out')) }
}

/**
 * Sends a thing that stands at its place, written down before and after. `clear`: the cells of its box are emptied
 * first. `replaces`: the id of a thing it is sent in place of, taken out on the same ask (serve.mjs: both or neither).
 */
async function deliver({ out, thing, placed, world, by, journal, wish, facing, clear, replaces, say, lap = () => {} }) {
  // What goes: the rows it stands as, or for a thing of finer cells those (and then only if all of its stand-in stands: it is sent whole).
  const fine = placed.fine
  Object.assign(out, { name: thing.name, size: thing.size, parts: thing.parts, cells: thing.fine?.filled ?? thing.filled, crumbs: thing.crumbs, rows: (fine?.rows ?? placed.rows).length, grain: fine?.grain, coarse: placed.coarse || undefined, origin: placed.origin, moved: placed.moved })
  if (placed.coarse) say('a thing of finer cells stands near: this one is made in the world\'s own cells', { stage: 'note', why: 'made plainer: a fine thing stands near' })
  // It is written down before it is sent, and what came of it after: a send that was cut short is not made again blindly.
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  // A living thing (make/alive.mjs): its look is kept by the world first, and its record says where, with its
  // controls and its facts. A look that could not be kept is not made at all: it would stand as a block of 10 cm cells.
  const t = placed.turned
  let record = thing.record
  if (t) {
    let fine
    try { fine = t.look.length ? await keepLook(world, t.look) : [] } catch (e) { return { ...out, state: 'refused', why: e.message } }
    lap('look kept')
    record = { ...record, controls: { ...t.controls, ...(fine.length ? { fine } : {}) }, ...(thing.living.living.facts ? { facts: thing.living.living.facts } : {}) }
    out.size = t.body.size
  }
  say('sending it', { stage: 'sending', id, name: thing.name, at: placed.origin, size: t ? t.body.size : thing.size, facing })
  if (clear) for (const rows of emptied(placed.rows)) await fetch(`${world}/world/ask`, { method: 'POST', body: JSON.stringify({ by, edit: edit(rows), release: beside(placed.rows) }) })
  await note(journal, { id, state: 'sending', world, by, wish, name: thing.name, model: out.model, facing, origin: placed.origin, rows: fine?.rows ?? placed.rows, grain: fine?.grain, stood: fine ? placed.rows : undefined, living: t ? true : undefined })
  lap('written down')
  // Its record goes on the same ask as its cells (#243): the world has neither without the other, and never two of one id.
  const sent = await send(world, placed.rows, by, { fine, settle: fine ? 4000 : 1500, replaces, thing: { id, name: thing.name, wish, at: placed.origin, size: t ? t.body.size : thing.size, facing, ...record } })
  lap('sent and seen')
  // A thing of finer cells that the world took only part of, or that came apart, is taken out again: no slice of it and no record are left behind.
  // So is a living thing the world could not bring to life: it arrives whole, alive, or not at all. (Not one sent in
  // place of another: that one went with the same ask, and what the world has now is all that stands there.)
  if ((fine || t) && !replaces && ['not there', 'fell'].includes(sent.state)) {
    await send(world, placed.rows, by, { kind: 0, gone: id, fine, wait: 3000, settle: 0 }).catch(() => {})
    await note(journal, { id, state: 'undone', why: `taken out again: ${sent.why}` })
  }
  await note(journal, { id, state: sent.state, why: sent.why })
  // The one it was sent in place of went with it, if the world has it: the one ask did both.
  if (replaces && sent.state !== 'not there' && (sent.state !== 'unknown' || (await inWorld(world, id)))) { await note(journal, { id: replaces, state: 'undone', why: `made again in its place as ${id}` }); if (sent.state === 'unknown') { await note(journal, { id, state: 'there', why: 'it arrived' }); Object.assign(sent, { state: 'there', why: undefined }) } }
  lap('written down')
  return { ...out, id, ...sent, look: middle(placed.rows) }
}

/** A clock for the stages of one making: `lap(name)` adds the time since the last to `lap.times` ([name, ms] each). */
const lapper = () => { let last = performance.now(); const times = [], lap = (name) => { const now = performance.now(); times.push([name, Math.round(now - last)]); last = now }; return Object.assign(lap, { times }) }

/** Whether a made thing is still as it was put: in the world, where it was stood, in nobody's hand. */
async function asPut(world, { id, at: was }) {
  try {
    const t = (await (await fetch(`${world}/world/things`)).json()).find((t) => t.id === id)
    if (!t || t.held || !t.at.every((v, a) => v === was[a])) return false
    // A living thing someone has got on or driven (a rider or a rule) may be anywhere now, and may be ridden still: it
    // is left to them. The world writes that into its record (`controls.driven`, kept over a restart); `ridden` covers
    // the moment before that is written.
    return !t.controls || (!t.controls.driven && !(await (await fetch(`${world}/world/things?id=${encodeURIComponent(id)}`)).json()).ridden)
  } catch { return false }
}

/**
 * A reply that is a program or cells, as a thing the placing takes: its stand-in in the world's cells, with the finer
 * thing under `fine` if it is finer, and under `made` the thing as it came (for keeping as cells). `joined`: cells
 * proved joined to the ground when they were kept, not proved again. A thing of 5 cm cells stands in the world's own.
 */
async function built(reply, how, joined) {
  const thing = grained(how === 'cells' ? readCells(reply, { joined }) : await programmed(reply)), stand = standin(thing)
  return { ...stand, record: thing.record ?? {}, program: true, fine: thing.grain >= 4 ? thing : undefined, made: thing, living: thing.living ? thing : undefined }
}

/**
 * A thing whose reply says it is driven (`drives`, make/drivable.mjs), brought to life: its cells worked into a reply of
 * cells with `living`, read as any is. A thing that cannot be (too big) stands as it is, and `say` is told why, as is
 * one that has nothing to roll on and goes on small feet under its corners.
 */
async function enlivened(thing, say) {
  const own = thing.made ?? thing
  if (thing.living || !own.drives) return thing
  try {
    const r = await driven({ name: thing.name, size: own.size, cm: own.cm ?? 10, cells: bodyOf(own), front: OWN_FRONT[own.drives.front], asked: own.drives })
    if (!r.rolls) say(r.said[0], { stage: 'note', why: r.said[0] })
    return { ...(await built(r.text, 'cells', false)), left: thing.left, kept: thing.kept, crumbs: thing.crumbs }
  } catch (e) {
    say(`it stands as it is: ${e.message}`, { stage: 'note', why: `it stands as it is: ${e.message}` })
    return thing
  }
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
 * `kept`: made in place of a thing that is no longer as it was put (`instead`): it has a reply to keep, and stands nowhere.
 *
 * `say(words, stage)` is told how it goes: { stage: 'place', at, facing }, { stage: 'asking', try }, { stage: 'shaped', name, size, facing }, { stage: 'refused', why }, { stage: 'sending', id, name, at, size, facing }.
 * `model` is how a reply is got ({ system, prompt } to { text, model, ms, cost }): the real binary unless another is given.
 * `tries`: how many times it is asked at most (a reply that is kept is the same however often it is asked for: once).
 * `proved`: what was proved of a kept thing when it was kept (make/library.mjs), and is not proved again: `joined` (every
 * cell joined to the ground) and `stands` (it stood whole: on level ground the core is not asked). The place, the ground
 * under it, what is in the way and what the world says when it is laid are checked every time.
 * Resolves with `times`: [stage, ms] for each stage, and for a program or cells `toCells()`: the thing as cells, to keep.
 */
export async function make({ wish = '', picture, page, world, where, fill, grow = 'cap', facing, by = 'maker', journal = JOURNAL, model = (q) => ask(q), how = 'parts', proved = {}, instead, tries = TRIES, dry = false, core = join(here, 'page', 'core.wasm'), say = () => {} }) {
  const lap = lapper()
  wish = String(wish).trim().slice(0, 400)
  if (!wish && !picture && !page) return { state: 'refused', why: 'say what to make' }
  // In place of a thing that stands (`instead`), it goes where that one stands: on the cell under its lowest.
  const found = instead?.id ? { spot: [instead.at[0], instead.at[1] - 1, instead.at[2]], eye: null, wall: false } : await ground(world, where)
  if (found.why) return { state: 'refused', why: found.why }
  const { spot, eye } = found
  facing ??= eye ? towards(spot, eye) : 'south'
  const out = { wish, facing, tries: 0, ms: 0, cost: 0, times: lap.times }
  lap('place')
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
  // `how: 'program'` (#372): the reply is a program that lays the thing in cells of its own choosing (make/program.mjs),
  // run in a box; what it built is read as any reply is. It is given the room a program has, whatever `fill` says.
  const program = how === 'program'
  const first = asked(wish, page, picture) + (program ? '' : sized), system = program ? PROGRAM + (picture || page ? SEEN.replace('in the form', 'as a program') : '') : BRIEF.replace(`Size is at most ${SIZE_MOST.join(' by ')}`, `Size is at most ${most.join(' by ')}`) + fieldsBrief() + (picture || page ? SEEN : ''), pictures = picture ? [picture] : []
  /** The best of what the replies gave so far: the thing, where it stands, and how much of what was described is left. */
  let prompt = first, best = null, why = ''
  for (; out.tries < tries;) {
    out.tries++
    say(`asking the model${out.tries > 1 ? ' again' : ''}`, { stage: 'asking', try: out.tries })
    let got
    try { got = await model({ system, prompt, pictures }) } catch (e) { if (best) break; return { ...out, state: 'refused', why: e.message } }
    lap('reply')
    out.ms += got.ms; out.cost += got.cost ?? 0; out.model = got.model; out.reply = got.text
    why = ''
    try {
      const thing = await enlivened(how === 'parts' ? scaled(read(got.text, { lenient: true, most }), times) : await built(got.text, how, proved.joined), say)
      if (proved.stands) thing.stands = true
      // (What is made only to be kept, below, is kept as cells too.)
      if (thing.made) { const m = thing.made; out.toCells = () => written(m, m.extra) }
      lap('read')
      // Made in place of a thing that stands (`instead`: { id, at }, make/best.mjs): that one is taken out now, when
      // this one has a shape, if it is still as it was put; if it is not (held, moved, gone), this one is made for the
      // keeping only and stood nowhere.
      if (instead && !out.swapped) {
        if (!instead.id || !(await asPut(world, instead))) return { ...out, state: 'kept', name: thing.name, size: thing.size }
        const gone = await undo({ world, id: instead.id, by, journal })
        if (gone.state !== 'undone') return { ...out, state: 'kept', name: thing.name, size: thing.size, why: gone.why }
        out.swapped = true
      }
      // Its size is known from here, a second or two before it is placed and sent: what covers the wait closes round it.
      say('it has a shape', { stage: 'shaped', name: thing.name, size: thing.size, facing })
      let placed = null
      try { placed = await settle(world, core, thing, found, facing, false, lap) } catch (e) {
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
      if (!refused(e) && !stopped(e) && !unread(e) && !e.form) throw e
      why = e.message
    }
    if (!why) break
    say(`asked again: ${why}`, { stage: 'refused', why })
    out.refusals = [...(out.refusals ?? []), why]
    if (out.tries < tries) prompt = program ? again(first, got.text.slice(0, 80_000), why).replace('in the same form', 'as a program') : again(first, got.text.slice(0, 20_000), why)
  }
  if (!best) return { ...out, state: 'refused', why }
  const { thing, placed } = best
  // The reply the thing was made from (the best of them), for whoever keeps a library of what was made; and, for a
  // program or cells, the thing as cells (make/cells.mjs), asked for only by a keeper: kept so, it is never run again.
  out.reply = best.reply
  if (best.thing.made) { const m = best.thing.made; out.toCells = () => written(m, m.extra) }
  // Anything left out or let fall is at least one in a hundred: rounded to none, a thing that lost a few rows was kept as having stood whole (make/best.mjs `whole`), and stood unchecked ever after.
  if (best.share < 1) out.left = Math.max(1, Math.round((1 - best.share) * 100))
  if (!placed) return { ...out, state: 'held', why: best.blocked, name: thing.name, size: thing.size, hold: { thing, facing, wish, model: out.model } }
  if (dry) { Object.assign(out, { name: thing.name, size: thing.size, parts: thing.parts, cells: thing.fine?.filled ?? thing.filled, crumbs: thing.crumbs, rows: (placed.fine?.rows ?? placed.rows).length, grain: placed.fine?.grain, origin: placed.origin, moved: placed.moved }); return { ...out, state: 'dry', made: placed.rows, fine: placed.fine } }
  return deliver({ out, thing, placed, world, by, journal, wish, facing, say, lap })
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
  if (!thing && id) return gone({ world, id, by, journal })
  if (!thing) return { state: 'refused', why: 'nothing made in that world is written down' }
  // Its record goes with its cells, on the one ask: a thing of more rows than a plain edit may be is taken out as it was put in.
  const out = (gone) => (thing.grain ? send(world, thing.stood, by, { kind: 0, gone, fine: { grain: thing.grain, rows: thing.rows } }) : send(world, thing.rows, by, { kind: 0, gone }))
  let sent = await out(thing.id)
  // (A thing whose record is gone already, or that was made before the world kept records: its cells alone.)
  // A living thing is not: where its cells were may be anything now, and a thing that broke is cells where it broke.
  // (Not when another ask has it this moment: its cells are that ask's to take, and taken here too they would be taken from under what it lays.)
  if (sent.state === 'not there' && /\(409\)/.test(sent.why ?? '') && !/on its way out already/.test(sent.why ?? '')) {
    if (thing.living) { await note(journal, { id: thing.id, state: 'gone', why: 'it is no longer in the world' }); return { id: thing.id, name: thing.name, state: 'gone', why: 'it is no longer in the world: it broke, or was taken out' } }
    sent = await out(undefined)
  }
  const state = sent.state === 'there' ? 'undone' : sent.state
  await note(journal, { id: thing.id, state, why: sent.why })
  return { id: thing.id, name: thing.name, state, why: sent.why }
}

/** The rows a made thing came with, as the world keeps them (`GET /world/things?id=`), in the world's own cells (a thing of finer cells: the cells that hold them). */
export async function cellsOf(world, id) {
  const r = await fetch(`${world}/world/things?id=${encodeURIComponent(id)}`)
  if (!r.ok) return null
  const t = await r.json(), g = t.grain ?? 1, rows = []
  for (let i = 0; i + 4 < t.cells.length; i += 5) rows.push(t.cells.slice(i, i + 5))
  const coarse = g === 1 ? rows : [...new Map(rows.flatMap(([x0, x1, y, z]) => { const out = []; for (let x = Math.floor(x0 / g); x <= Math.floor((x1 - 1) / g); x++) out.push([`${x},${Math.floor(y / g)},${Math.floor(z / g)}`, [x, x + 1, Math.floor(y / g), Math.floor(z / g), 1]]); return out })).values()].sort((a, b) => a[2] - b[2] || a[3] - b[3] || a[0] - b[0])
  return { thing: t, grain: g, rows, coarse }
}

/** Whether the world has a thing of this id now (false if it cannot be asked). */
async function inWorld(world, id) {
  try { return (await (await fetch(`${world}/world/things`)).json()).some((t) => t.id === id) } catch { return false }
}

/** Which way a body's front points in the world, by its number (page/living.ts `Motor.front`): a body is laid in the world's own axes. */
const FACED = ['east', 'west', 'south', 'north']

/**
 * The made thing the asker's eye meets (`from`: { eye, toward }, its box and half a metre round it, the nearest), or
 * the one of that `id`; and whether it is `mine`: made by `by` (the name it was made under, as undo goes by), not
 * alive and in nobody's hand. Words that point at a thing ("make it drivable") are for the maker only then
 * (helper.mjs, page/making.ts by way of the helper's POST /drivable): one rule for both. `things`: the world's
 * records, if they were asked for already.
 */
export async function aimed({ world, from, id, by, things }) {
  things ??= await (await fetch(`${world}/world/things`)).json()
  const box = (t) => { const across = t.facing === 'east' || t.facing === 'west', w = across ? t.size[2] : t.size[0], d = across ? t.size[0] : t.size[2]; return [t.at[0] - (w >> 1) - 5, t.at[1] - 5, t.at[2] - (d >> 1) - 5, t.at[0] - (w >> 1) + w + 5, t.at[1] + t.size[1] + 5, t.at[2] - (d >> 1) + d + 5] }
  const hit = (b) => { let lo = 0, hi = 2000; for (let a = 0; a < 3; a++) { const o = from.eye[a], v = from.toward[a] / (Math.hypot(...from.toward) || 1); if (Math.abs(v) < 1e-9) { if (o < b[a] || o > b[a + 3]) return Infinity; continue } let t0 = (b[a] - o) / v, t1 = (b[a + 3] - o) / v; if (t0 > t1) [t0, t1] = [t1, t0]; lo = Math.max(lo, t0); hi = Math.min(hi, t1) } return lo <= hi ? lo : Infinity }
  let thing = id ? things.find((t) => t.id === id) ?? null : null
  if (!thing && !id && from) thing = things.filter((t) => !t.held).map((t) => [t, hit(box(t))]).filter(([, d]) => d < Infinity).sort((a, b) => a[1] - b[1])[0]?.[0] ?? null
  return { thing, mine: !!thing && thing.by === text(by, 24) && !thing.controls && !thing.held }
}

/**
 * Brings a made thing to life where it stands (#245: "make it drivable", aimed at it): the asker's own, not alive
 * (`aimed`). Its cells are what the world keeps of it; what makes it live is worked out from them (make/drivable.mjs):
 * its wheels, then its front from what its cells say (its lamps), from the way it was made to face only when they do
 * not, and the place is told when nothing says. The living thing is sent in its place on one ask that also takes the
 * old one out (`gone`, serve.mjs): the world does both or neither, so an answer that is lost or late leaves one of
 * them standing, never two and never none, and nothing is ever put back. It is an act on that thing: nothing kept
 * for its words changes. Resolves as `make` does, with `note`: what was done, in a few words for the place to say,
 * and `said`: what was worked out.
 */
export async function enliven({ world, from, id, by = 'maker', journal = JOURNAL, core = join(here, 'page', 'core.wasm'), say = () => {} }) {
  const { thing } = await aimed({ world, from, id, by })
  if (!thing) return { state: 'refused', why: 'nothing made is where the eye looks: look at what you made and ask again', note: 'Look at what you made, then ask again' }
  // Another's: nothing is done to it (the nearest thing met is the one meant, so none further off is looked for).
  if (thing.by !== text(by, 24)) return { state: 'refused', why: `it was made by ${thing.by || 'someone else'}`, note: `That ${thing.name} is ${thing.by || 'someone else'}'s: only they can make it drivable` }
  if (thing.controls) return { state: 'there', id: thing.id, name: thing.name, origin: thing.at, size: thing.size, note: `Your ${thing.name} is alive already: walk up to it and press E` }
  if (thing.held) return { state: 'refused', why: 'it is held', note: `Your ${thing.name} is held: put it down and ask again` }
  const got = await cellsOf(world, thing.id)
  if (!got) return { state: 'refused', why: 'what it is made of could not be read from the world' }
  // Its cells, in the world's axes, cut to the box they fill.
  const g = got.grain, lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
  // (Cells of 10 cm carried down to the ground under its lowest, on a slope, are not its own: form.mjs `rows`.)
  if (g === 1) got.rows = got.rows.filter((r) => r[2] >= thing.at[1])
  for (const [x0, x1, y, z] of got.rows) { lo[0] = Math.min(lo[0], x0); hi[0] = Math.max(hi[0], x1); lo[1] = Math.min(lo[1], y); hi[1] = Math.max(hi[1], y + 1); lo[2] = Math.min(lo[2], z); hi[2] = Math.max(hi[2], z + 1) }
  const size = hi.map((v, a) => v - lo[a]), cells = new Uint16Array(size[0] * size[1] * size[2])
  for (const [x0, x1, y, z, k] of got.rows) cells.fill(k, ((y - lo[1]) * size[2] + z - lo[2]) * size[0] + x0 - lo[0], ((y - lo[1]) * size[2] + z - lo[2]) * size[0] + x1 - lo[0])
  const faced = FACED.indexOf(thing.facing)
  let r
  try { r = await driven({ name: thing.name, size, cm: 10 / g, cells, faced: faced >= 0 ? faced : undefined, core }) } catch (e) { return { state: 'refused', why: e.message, note: `Your ${thing.name} stays as it is: ${e.message}` } }
  // Stood where the old one stands, as it stands (`clear`: its own cells are not in the way of it), facing its front.
  const facing = FACED[r.front], wish = thing.wish || thing.name
  const living = await built(r.text, 'cells', false)
  let placed
  try { placed = await settle(world, core, living, { spot: [thing.at[0], thing.at[1] - 1, thing.at[2]], eye: null, wall: false }, facing, true) } catch (e) { if (!e.place && !e.form) throw e; return { state: 'refused', why: e.message, note: `Your ${thing.name} stays as it is: ${e.message}` } }
  const out = { wish, facing, tries: 0, ms: 0, cost: 0, model: 'brought to life from its own cells (no model)', times: [] }
  const made = await deliver({ out, thing: living, placed, world, by, journal, wish, facing, say, replaces: thing.id })
  // What the place says: and that nothing of it rolls, or that nobody can tell its front, if so.
  const told = [r.rolls ? '' : r.said[0], r.unsure].filter(Boolean)
  if (made.state === 'there') return { ...made, said: r.said, note: `Your ${thing.name} is alive: ${told.length ? `${told.join('. ')}. Walk up to it and press E` : 'walk up to it and press E'}` }
  return { ...made, said: r.said, note: `Your ${thing.name}: ${made.state === 'unknown' ? 'the world did not say what it did, so look before asking again' : `it could not be brought to life (${made.why})`}` }
}

/** Takes out a made thing that nobody here wrote down, by what the world keeps of it (its record and its cells, on one ask): only its maker's, by the name it was made under. */
async function gone({ world, id, by, journal }) {
  const got = await cellsOf(world, id).catch(() => null)
  if (!got) return { state: 'refused', why: 'nothing of that id is in the world' }
  if (got.thing.by !== text(by, 24)) return { id, name: got.thing.name, state: 'refused', why: `it was made by ${got.thing.by || 'someone else'}` }
  const sent = await send(world, got.coarse, by, { kind: 0, gone: id })
  const state = sent.state === 'there' ? 'undone' : sent.state
  await note(journal, { id, state, why: sent.why })
  return { id, name: got.thing.name, state, why: sent.why }
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
  const model = canned ? async () => ({ text: await readFile(canned, 'utf8'), model: `a reply kept in ${canned} (no model was run)`, ms: 0, cost: 0 }) : (q) => ask({ ...q, model: flag('model') ?? 'opus', effort: flag('effort'), binary: flag('claude') ?? 'claude', limit: has('program') ? 1_200_000 : undefined })
  // Made before (make/library.mjs): a wish kept on this machine or with the engine is made from what was kept, with no model.
  const known = !canned && !fill && !has('fresh') ? await library(flag('library') ?? LIBRARY).find(wish, '', fieldKeys()) : null
  if (known) console.log(`  made before as ${known.name}: no model is asked`)
  const r = await make({ wish, world, where, fill, grow: flag('grow') ?? 'cap', facing: flag('facing'), by, journal, model, how: has('program') ? 'program' : has('cells') ? 'cells' : 'parts', dry: has('dry'), say: (s) => console.log(`  ${s}`), ...(known ? recalled(known) : {}) })
  const what = r.origin ? `${r.name}: ${r.cells} cells in ${r.rows} runs, ${r.size.join(' x ')}, facing ${r.facing} at ${r.origin.join(', ')}` : ''
  if (r.left) console.log(`  about ${r.left} in a hundred of what the model described could not be used and was left out`)
  if (r.moved) console.log(`  the place itself was taken: it stands ${(r.moved / 10).toFixed(1)} m from it`)
  if (has('times')) console.log(`  stages: ${r.times.map(([n, ms]) => `${n} ${ms} ms`).join(', ')}; all ${r.times.reduce((a, [, ms]) => a + ms, 0)} ms`)
  if (r.state === 'there') console.log(`made ${what}\n  by ${r.model} in ${(r.ms / 1000).toFixed(1)} s${r.tries > 1 ? ` (asked ${r.tries} times)` : ''}; undo with --undo ${r.id}`)
  else if (r.state === 'dry') console.log(`would make ${what} (nothing was sent)`)
  else if (r.state === 'held') console.log(`made ${r.name}, and no place near there will take it (${r.why}): say another place with --at or --from`)
  else console.log(`not made (${r.state}): ${r.why}${what ? `\n  ${what}` : ''}`)
  process.exit(r.state === 'there' || r.state === 'dry' ? 0 : 1)
}
