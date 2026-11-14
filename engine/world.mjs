// The world process (#140): one instance of the core, in a thread of its own behind the page
// server, that everyone in a shared world sees through. It is asked things (a blast, a fire, a
// thrown ball, an edit), does them one after another, moves on what is loose by its own clock,
// and says what happened in the core's own words. Nobody else decides anything: a page in a
// shared world applies only what this says, in the order it says it.
//
// To the server it posts, in order:
//   { echo }                      an ask, at the moment it is done: pages apply it then
//   { id, kind, ground }          the answer to a question (what is at a cell)
//   { id, at, kind, far }         the answer to a look (the first thing along a line)
//   { here }                      where someone in the world is now (people, below)
//   { said }                      something someone said
//   { log, state, counts }        what came of it or of a tick: `log` is what must never be
//                                 missed (cells out and back, bodies born and gone, dust),
//                                 `state` is where things are now (bodies, fire, water)
import { readFile } from 'node:fs/promises'
import { parentPort, workerData } from 'node:worker_threads'
import { controlsOf, numbers } from './page/living.ts'
import { things as livingThings } from './rules/things.mjs'
import { sight } from './rules/sight.mjs'
import { rowsOf as keptRows } from './rules/kept.mjs'
import { about, REACH_MOST } from './about.mjs'
import { lengthOf, moveOf } from './page/moves.ts'
import { residents, whereabouts } from './page/residents.ts'
import { lookOf, ownLook } from './page/wear.ts'
import { plugger } from './plugins.mjs'
import { blows } from './rules/blows.mjs'
import { bodies, CAN } from './rules/bodies.mjs'
import { built } from './rules/built.mjs'
import { hands } from './rules/hands.mjs'
import { holding } from './rules/holding.mjs'
import { thinking } from './mind/think.mjs'
import { rules as ruling } from './rules/run.mjs'
import { text } from './text.mjs'

const { instance } = await WebAssembly.instantiate(await readFile(workerData.core), {})
// The core may be swapped for a newer build while this process runs (`swap`, below): everything here asks `core` for
// what it needs at the moment it needs it, and keeps nothing of the core's memory from one call to the next.
let core = instance.exports
/** While the core is being swapped: what was said meanwhile, to be done in order when the new one is whole; when it began; where the fire was. */
let swapping = null
/** Where the core last said some of its fire was (three numbers a cell), or null when nothing burns: to light it again in another core. */
let fireSeen = null
/** The core's records (bodies.rs): which are log and which are state. */
const STATE = new Set([5, 7, 8, 10, 11])   // 10 what struck what and 11 how living things are doing (#245): heard as they happen, never kept

/** The words of the last call, parted into what is log and what is state. */
function told(n, released) {
  const at = core.bodies_words()
  const words = new Uint32Array(core.memory.buffer, at, n)
  const log = [], state = []
  for (let i = 0; i < words.length;) {
    const size = 2 + words[i + 1]
    ;(STATE.has(words[i]) ? state : log).push(words.subarray(i, i + size))
    // Where some of the fire is (record 7: how many cells are alight, then three floats a cell): kept for a swap of the core.
    if (words[i] === 7) fireSeen = words[i + 2] ? new Float32Array(words.buffer.slice(words.byteOffset + (i + 3) * 4, words.byteOffset + (i + size) * 4)) : null
    i += size
  }
  const join = (parts) => { const out = new Uint32Array(parts.reduce((sum, p) => sum + p.length, 0)); let at = 0; for (const p of parts) { out.set(p, at); at += p.length } return out }
  const counts = [core.bodies_count(), core.bodies_burning(), core.bodies_flowing(), released ? 1 : 0]
  parentPort.postMessage({ log: join(log), state: join(state), counts })
  if (alive.size) heed(words)
  blow.heed(words, Date.now())
}

// ── Living things (#245) ─────────────────────────────────────────────────
// A made thing whose record has `controls` with a motor lives: its cells are taken out of the world and it is a
// body the core keeps (bodies/living.rs). This process is the only one that moves it: a page says what its rider
// asks (`drive`), and sees where it is in the stream as it sees every body. Where each last slept is written into
// its record, so that a world started again (whose bodies are lost) stands it up there.
/** The living things, by their thing's id: the core's body, the controls, where it is, and whether it was awake when last told. */
const alive = new Map()
/** A thing's cells (rows of x0, x1, y, z, kind) as a body's: the box round them, a kind for each cell. Only cells the world still has are taken: a blast since it was made may have had some. */
function grid(rows, there) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i + 4 < rows.length; i += 5) { lo[0] = Math.min(lo[0], rows[i]); hi[0] = Math.max(hi[0], rows[i + 1]); lo[1] = Math.min(lo[1], rows[i + 2]); hi[1] = Math.max(hi[1], rows[i + 2] + 1); lo[2] = Math.min(lo[2], rows[i + 3]); hi[2] = Math.max(hi[2], rows[i + 3] + 1) }
  const size = hi.map((h, a) => h - lo[a])
  if (!size.every((s) => s >= 1 && s <= 96)) return null
  const cells = new Int32Array(size[0] * size[1] * size[2])
  let any = false
  for (let i = 0; i + 4 < rows.length; i += 5) for (let x = rows[i]; x < rows[i + 1]; x++) {
    if (there && core.world_kind(x, rows[i + 2], rows[i + 3]) !== rows[i + 4]) continue
    cells[x - lo[0] + size[0] * (rows[i + 3] - lo[2] + size[2] * (rows[i + 2] - lo[1]))] = rows[i + 4]
    any = true
  }
  return any ? { cells, size, low: lo } : null
}
/** Brings a thing to life, or gives one that lives a new motor. `fresh` is false for a world started again: its cells were taken when it first lived. */
function live(id, value, rows, fresh, name = '') {
  const controls = controlsOf(value)
  if (!controls) return
  const motor = numbers(controls.motor), known = alive.get(id)
  const set = (body) => { const room = core.edits_room(motor.length); new Float32Array(core.memory.buffer, room, motor.length).set(motor); return core.living_motor(body, motor.length) }
  if (known) { known.controls = controls; if (name) known.name = name; set(known.body); return }
  const g = rows && grid(rows, fresh)
  if (!g) return
  // The room first, then the memory: making room may grow it.
  const room = core.edits_room(g.cells.length)
  new Int32Array(core.memory.buffer, room, g.cells.length).set(g.cells)
  const n = core.living_spawn(g.size[0], g.size[1], g.size[2], g.low[0], g.low[1], g.low[2], fresh ? 1 : 0), body = core.living_last()
  if (!body) return
  alive.set(id, { body, controls, name, pose: null, awake: true })
  set(body)
  if (!fresh && controls.rest) core.living_place(body, ...controls.rest.at, ...controls.rest.rot)
  told(n, false)
  parentPort.postMessage({ living: { thing: id, body } })
  nudged = true
}
/**
 * Writes where a sleeper sleeps into its record, if it has moved since that was last written and it is twenty seconds
 * since: every such change is kept in the world's file, and a frog that hops and stops all day must not fill it.
 */
function rests(now) {
  for (const [id, a] of alive) {
    if (!a.rested || a.awake || !a.pose || now - (a.wrote ?? -Infinity) < 20_000) continue
    a.rested = false
    const was = a.controls.rest, at = a.pose.at.map((v) => Math.round(v * 100) / 100), rot = a.pose.rot.map((v) => Math.round(v * 10000) / 10000)
    if (was && Math.hypot(at[0] - was.at[0], at[1] - was.at[1], at[2] - was.at[2]) < 0.05 && Math.abs(rot[0] * was.rot[0] + rot[1] * was.rot[1] + rot[2] * was.rot[2] + rot[3] * was.rot[3]) > 0.9999) continue
    a.wrote = now
    a.controls = { ...a.controls, rest: { at, rot } }
    parentPort.postMessage({ echo: { by: 'the world', thing: { id, controls: a.controls } } })
  }
}
/** What the core said, for the living: where each is, which broke (it lives no more, and its record goes), which fell asleep (where is written in its record). */
function heed(words) {
  const f = new Float32Array(words.buffer, words.byteOffset, words.length), awake = new Set(), broke = new Set()
  let moved = false
  const bodies = new Map([...alive].map(([id, a]) => [a.body, id]))
  for (let i = 0; i < words.length;) {
    const tag = words[i], n = words[i + 1], at = i + 2
    if (tag === 5) { moved = true; for (let k = at; k < at + n; k += 8) { const a = alive.get(bodies.get(words[k])); if (a) a.pose = { at: [f[k + 1], f[k + 2], f[k + 3]], rot: [f[k + 4], f[k + 5], f[k + 6], f[k + 7]] } } }
    else if (tag === 11) for (let k = at; k < at + n; k += 12) { awake.add(words[k]); const a = alive.get(bodies.get(words[k])); if (a) a.speed = f[k + 1] }
    else if (tag === 6) broke.add(words[at])
    i = at + n
  }
  for (const [id, a] of [...alive]) {
    if (broke.has(a.body)) {
      alive.delete(id)
      driven.broke(id)
      parentPort.postMessage({ living: { thing: id, body: 0 } })
      parentPort.postMessage({ echo: { by: 'the world', gone: id } })
    } else if (moved) {
      // Asleep now: where is to be written, if it is somewhere else than was last written.
      if (a.awake && !awake.has(a.body) && a.pose) a.rested = true
      a.awake = awake.has(a.body)
    }
  }
}

/** Edits in the core's own form (page/edits.ts), put last. */
function edit(words) {
  // The room first, then the memory: making room may grow it, and what was read before is then gone.
  const room = core.edits_room(words.length)
  new Int32Array(core.memory.buffer, room, words.length).set(words)
  core.world_edit(-1)
}

/** How far a look goes, in cells. */
const LOOK = 800
/** The first cell along a line from a place that is not air, as a pair of eyes there would meet it. */
function look(from, to) {
  const long = Math.hypot(...to)
  let last = []
  for (let far = 0; far <= LOOK; far += 0.5) {
    const c = from.map((v, a) => Math.floor(v + (to[a] / long) * far))
    if (c.every((v, a) => v === last[a])) continue
    last = c
    const kind = core.world_kind(c[0], c[1], c[2])
    if (kind) return { at: c, kind, far: Math.round(far) }
  }
  return { at: null, kind: 0, far: LOOK }
}

// ── People (#218) ────────────────────────────────────────────────────────
// Everyone in the world has a body here: a page says where its own is (it flies where it likes), and a seat's is
// moved by this process, a step at a time over the world's own cells, edits and all, so a body cannot be walked
// through a wall or off a roof. Nobody is asked who they are: a name is whoever used it last. Nothing of this is kept.
const MATERIALS = ['air', 'earth', 'rock', 'grass', 'sand', 'water', 'asphalt', 'concrete', 'brick', 'plaster', 'wood', 'glass', 'steel', 'leaves', 'roofing', 'lamp']
/** How tall a body is, how high its eyes, how fast it walks (cells a second), how high a step it takes and how far it will drop. */
const TALL = 18, EYES = 16, PACE = 13, CLIMB = 2, DROP = 30
/** How far off someone is told of (cells), and how far a voice carries. */
const NEAR = 400, EARSHOT = 300
/** Seconds after its last request that a seat's body is gone, and a page's after it last said where it was. */
const SEAT_STAYS = 180, PAGE_STAYS = 5
const folk = new Map()
const voices = []
/** What has gone off lately: the town's residents are moved by it, by their rule (residents.ts). */
const shocks = []
let spoken = 0
const solid = (x, y, z) => core.world_kind(x, y, z) !== 0
/** Where feet come to rest in a column, coming to it at a height: on the ground there, up a step of two cells, or down a drop; null where there is no room to stand or the drop is too far. */
function footing(x, y, z) {
  x = Math.round(x); y = Math.round(y); z = Math.round(z)
  for (let up = 0; up <= CLIMB; up++) {
    let feet = y + up, room = true
    for (let k = 0; k < TALL && room; k++) room = !solid(x, feet + k, z)
    if (!room) continue
    let fell = 0
    while (!solid(x, feet - 1, z) && fell <= DROP) { feet--; fell++ }
    return fell > DROP ? null : feet
  }
  return null
}
const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west']
/** Which way something lies from a place, as a word: north is -z, east is +x. */
const bearing = (dx, dz) => COMPASS[((Math.round(Math.atan2(dx, -dz) / (Math.PI / 4)) % 8) + 8) % 8]
/** What a body is doing with its limbs (page/moves.ts), as pages are told it: its name, or its keys when it has none (those once a second and when it changes, not with every step), when it began and what it is aimed at. */
const doing = (p, now) => {
  if (!p.move) return {}
  const whole = !p.move.name && (p.move.told !== p.move.n || now - p.move.toldAt > 1000)
  if (whole) { p.move.told = p.move.n; p.move.toldAt = now }
  return { move: { n: p.move.n, since: p.move.since, ...(p.move.name ? { name: p.move.name } : whole ? { keys: p.move.data } : {}), ...(p.move.aim ? { aim: p.move.aim } : {}) } }
}
/** Who holds what (rules/holding.mjs): set where the rules are, below. What a hand carries is part of how its figure looks. */
let grasp = null
const tell = (p) => { blow.seen(p); parentPort.postMessage({ here: { by: p.by, name: p.name, at: p.at, yaw: p.yaw, walking: p.goal && !p.aloft ? 1 : 0, down: p.down > Date.now(), flinch: p.flinch > Date.now(), seat: p.seat, gone: p.gone, ...(p.frame ? { frame: p.frame } : {}), ...(p.aloft ? { aloft: true } : {}), ...(grasp?.carried(p.by) ? { look: { ...(p.look ?? {}), carry: grasp.carried(p.by) } } : p.look ? { look: p.look } : {}), ...(p.was !== undefined ? { was: p.was, stride: p.stride } : {}), ...doing(p, Date.now()), ...(p.thinking ? { thinking: true } : {}) } }) }
const state = (p) => ({ name: p.name, at: p.at.map(Math.round), yaw: Number(p.yaw.toFixed(3)), facing: COMPASS[((Math.round(p.yaw / (Math.PI / 4)) % 8) + 8) % 8], walking: !!p.goal, ...(p.goal ? { to: p.goal } : {}), ...(p.stopped ? { stopped: p.stopped } : {}), down: p.down > Date.now() })
/** A blast near people: those close are knocked off their feet for a few seconds, those further off flinch. Nobody is hurt. */
function shock(at, radius) {
  const now = Date.now()
  shocks.push({ at, radius, t: now / 1000 })
  while (shocks.length > 32 || (shocks.length && now / 1000 - shocks[0].t > 60)) shocks.shift()
  for (const p of folk.values()) {
    const far = Math.hypot(p.at[0] - at[0], p.at[1] + 9 - at[1], p.at[2] - at[2])
    if (far < radius * 2.5 + 10) { p.down = now + 3500; p.goal = null; p.stopped = 'knocked down by a blast: on your feet again in a few seconds' } else if (far < radius * 6 + 60) p.flinch = now + 1500
    else continue
    tell(p)
  }
}
/** The highest place to stand within six metres of where the land's rule puts the ground: on a heap, if one lies there. Or null. */
function stand(x, z) {
  const ground = core.feet_at(x, z)
  for (let y = ground + 60; y > ground - 60; y--) if (solid(x, y - 1, z) && footing(x, y, z) === y) return y
  return null
}
/** What a seat asks about its own body. Answers what came of it, or `error`. */
function seat(m) {
  const now = Date.now()
  let p = folk.get(m.by)
  // A rule's actor is the rule's alone: nobody outside takes its body by using its name.
  if (p?.rule) return { error: 'that name is an actor of one of the world\'s rules: use another' }
  if (m.op === 'join') {
    // On the pavement north of where the town starts, unless a place is given; at the height the world has ground there.
    const [x, z] = getting.room(m.at ? m.at[0] : 690 + (spoken + folk.size * 7) % 40, m.at ? m.at[1] : 4009, p, (x, z) => stand(x, z) !== null)
    const feet = stand(x, z)
    if (feet === null) return { error: 'there is no room to stand there' }
    p = { by: m.by, name: m.by, seat: true, at: [x, feet, z], yaw: m.yaw ?? Math.PI, goal: null, stopped: '', down: 0, flinch: 0, last: now, told: 0 }
    folk.set(m.by, p)
    tell(p)
    return { you: state(p) }
  }
  // A page's body may speak; everything else a body does here is a seat's.
  if (!p || (!p.seat && m.op !== 'say')) return { error: 'nobody of that name has a body here: POST /world/join first' }
  p.last = now
  if (m.op === 'leave') { folk.delete(m.by); p.gone = true; tell(p); lay(grasp.left(p)); return { left: true } }
  if (m.op === 'walk') {
    if (p.down > now) return { error: 'you are on the ground: wait a few seconds' }
    p.goal = [m.to[0], m.to[1]]; p.stopped = ''; p.path = undefined
    const far = Math.hypot(m.to[0] - p.at[0], m.to[1] - p.at[2])
    p.yaw = Math.atan2(m.to[0] - p.at[0], -(m.to[1] - p.at[2]))
    return { you: state(p), far: Math.round(far), seconds: Math.round(far / PACE) }
  }
  if (m.op === 'turn') { p.yaw = m.yaw; tell(p); return { you: state(p) } }
  if (m.op === 'say') {
    const v = { n: ++spoken, by: p.by, name: p.name, text: m.text, at: p.at.map(Math.round), t: now }
    voices.push(v)
    if (voices.length > 400) voices.shift()
    parentPort.postMessage({ said: v })
    happen('said', { by: p.by, name: p.name, text: m.text, at: v.at })
    return { said: v.n }
  }
  if (m.op === 'me') return { you: state(p) }
  if (m.op === 'around') {
    const within = Math.min(m.within || NEAR, 1200), people = []
    for (const o of folk.values()) {
      if (o === p) continue
      const dx = o.at[0] - p.at[0], dz = o.at[2] - p.at[2], far = Math.hypot(dx, dz, o.at[1] - p.at[1])
      if (far <= within) people.push({ name: o.name, what: o.rule ? 'an actor of a rule' : o.seat ? 'in a seat' : 'at a page', at: o.at.map(Math.round), far: Math.round(far), towards: bearing(dx, dz), doing: o.down > now ? 'on the ground' : o.thinking ? 'thinking' : o.goal ? 'walking' : 'standing' })
    }
    // The town's residents, by the same rule the pages draw them from, at the realm's own hour (`hourNow`).
    const found = [], n = residents(core, [p.at[0], p.at[2]], Math.min(within, 400), now / 1000, hourNow(), found, shocks, taken)
    const town = found.slice(0, n).map((r) => ({ far: Math.round(Math.hypot(r.at[0] - p.at[0], r.at[2] - p.at[2])), towards: bearing(r.at[0] - p.at[0], r.at[2] - p.at[2]), doing: r.down > 0.5 ? 'on the ground' : r.flinch > 0.5 ? 'shrinking from a blast' : r.walking > 0.5 ? 'walking' : r.reading > 0.5 ? 'reading a phone' : 'standing' })).filter((r) => r.far <= within).sort((a, b) => a.far - b.far)
    const heard = voices.filter((v) => v.n > (m.since || 0) && v.by !== p.by && Math.hypot(v.at[0] - p.at[0], v.at[1] - p.at[1], v.at[2] - p.at[2]) <= EARSHOT).map((v) => ({ n: v.n, name: v.name, text: v.text, far: Math.round(Math.hypot(v.at[0] - p.at[0], v.at[2] - p.at[2])), seconds_ago: Math.round((now - v.t) / 1000) }))
    // What the eyes meet, level, the eight ways round.
    const eye = [Math.round(p.at[0]) + 0.5, p.at[1] + EYES + 0.5, Math.round(p.at[2]) + 0.5]
    // And how far the body could walk each way before something stopped it (a look at eye height goes over a parked car).
    const walks = (dx, dz) => { let y = p.at[1], far = 0; for (; far < 200; far++) { const feet = footing(p.at[0] + dx * (far + 1), y, p.at[2] + dz * (far + 1)); if (feet === null) break; y = feet } return far }
    const sees = COMPASS.map((to, k) => { const a = k * Math.PI / 4, way = [Math.sin(a), 0, -Math.cos(a)], met = look(eye, way); return { to, far: met.far, meets: met.at ? MATERIALS[met.kind & 15] : 'nothing', walk: walks(way[0], way[2]) } })
    return { you: state(p), people: people.sort((a, b) => a.far - b.far), residents: { near: town.length, nearest: town.slice(0, 8) }, heard, heard_up_to: spoken, sees }
  }
  return { error: 'not something a body does' }
}
// ── Residents a rule takes as its own (#218, for #264) ──────────────────────
// The town's residents are a rule of place and time (page/residents.ts): nobody moves them and nobody can tell one
// anything. A rule of the world is told of those near people, each by an id that is the same from one telling to
// the next, and may take one: from then on that resident is the rule's actor, standing where they stood, facing
// as they faced, in the same clothes and the same step, and every page leaves them out of the town's rule (the
// actor's `here` says who it was). Let go, the body walks back to where its round has got to and is a resident again.
/** The most residents the world's rules may hold at once, the most a rule is told of, and how near a person one must be to be told of (cells). */
const TAKEN_MOST = 128, TOLD_MOST = 64, TOLD_WITHIN = 320
/** How long one let go has to walk back to its round before it is simply back on it (ms), and how fast it goes (cells a second). */
const BACK_WITHIN = 45_000, BACK_PACE = 22
/** Who is off their round, by the rule's own number for them: the body that is them meanwhile. */
const taken = new Map()
const residentId = (seed) => `r${(seed >>> 0).toString(36)}`
let town = { at: 0, list: [], by: new Map() }
/** The residents near people now (nearest first), found again four times a second at most. */
function townNear(now) {
  if (now - town.at < 250) return town
  const by = new Map(), found = []
  let persons = 0
  for (const p of folk.values()) {
    if (p.rule || persons++ >= 8) continue
    const n = residents(core, [p.at[0], p.at[2]], TOLD_WITHIN, now / 1000, hourNow(), found, shocks, taken)
    for (let i = 0; i < n; i++) {
      const r = found[i], far = Math.hypot(r.at[0] - p.at[0], r.at[2] - p.at[2]), id = residentId(r.seed), old = by.get(id)
      if (far <= TOLD_WITHIN && (!old || far < old.far)) by.set(id, { id, seed: r.seed, home: [...r.home], at: [...r.at], yaw: r.yaw, stride: r.stride, walking: r.walking > 0.5, far })
    }
  }
  const list = [...by.values()].sort((a, b) => a.far - b.far).slice(0, TOLD_MOST)
  return (town = { at: now, list, by: new Map(list.map((r) => [r.id, r])) })
}
/** The residents a rule is told of: who, where, how they face, whether they walk, and how far the nearest person is. */
const townTold = () => townNear(Date.now()).list.map((r) => ({ id: r.id, at: r.at.map(Math.round), yaw: Number(r.yaw.toFixed(2)), walking: r.walking, near: Math.round(r.far), ...looksOf(r.seed) }))
/** What a resident looks like by their own number (page/wear.ts `ownLook`), kept for those lately asked about. */
const looked = new Map()
const looksOf = (seed) => { let l = looked.get(seed); if (!l) { if (looked.size > 512) looked.clear(); looked.set(seed, l = ownLook(seed)) } return l }
/** A resident becomes a body of a rule's, where they are this moment; or why not. */
function take(rule, short, id, now, wrong) {
  const r = typeof id === 'string' ? townNear(now).by.get(id) : undefined
  if (!r) { wrong(`no resident "${String(id).slice(0, 16)}" is near anyone now: world.residents says who is`); return null }
  if (taken.has(r.seed)) { wrong(`resident "${r.id}" is somebody's actor already`); return null }
  if (taken.size >= TAKEN_MOST) { wrong(`the world's rules hold ${TAKEN_MOST} residents already: let one go first`); return null }
  // Where they are now, not a quarter of a second ago: nobody should see them jump.
  const fresh = [], n = residents(core, [r.at[0], r.at[2]], 60, now / 1000, hourNow(), fresh, shocks, taken), live = fresh.slice(0, n).find((f) => f.seed === r.seed) ?? r
  const p = { by: `${rule.id}/${short}`, short, rule: rule.id, name: '', seat: true, at: [...live.at], yaw: live.yaw, goal: null, stopped: '', down: 0, flinch: 0, last: now, told: 0, was: r.seed, home: [...r.home], stride: live.stride }
  folk.set(p.by, p); taken.set(r.seed, p); town.at = 0
  return p
}
/** A taken resident is let go: nobody's any more, it walks back to its round. */
function release(p) {
  p.rule = '~'; p.name = ''; p.look = undefined; p.move = undefined; p.stopped = ''; p.pace = BACK_PACE; p.back = Date.now() + BACK_WITHIN
  tell(p)
}
/** A body on its way back: towards where its round has got to; there (or out of time), it is a resident again. Says whether it has gone. */
function goingBack(p, now) {
  const w = whereabouts(core, p.home, now / 1000), far = w ? Math.hypot(w.at[0] - p.at[0], w.at[2] - p.at[2]) : 0
  if (!w || far < 2 || now > p.back) { folk.delete(p.by); taken.delete(p.was); town.at = 0; p.gone = true; tell(p); return true }
  p.goal = [w.at[0], w.at[2]]
  return false
}
/** What is to be kept of the rules' people over a restart (the server writes it beside the world's file): each rule's actors as they stand. */
/** What a kept actor could do, read back: only the numbers a body has, each within its range. */
const canKept = (c) => { if (!c || typeof c !== 'object') return null; const out = {}; for (const k of ['jump', 'climb', 'fly', 'fall']) if (Number.isFinite(c[k])) out[k] = Math.max(CAN[k][0], Math.min(CAN[k][1], c[k])); return Object.keys(out).length ? out : null }
const actorsKept = () => { const out = {}; for (const p of folk.values()) if (p.rule && p.rule !== '~') (out[p.rule] ??= []).push({ id: p.short, name: p.name, at: p.at, yaw: p.yaw, pace: p.pace, can: p.can, aloft: p.aloft || undefined, look: p.look, goal: p.goal, was: p.was, home: p.home, ...(p.move?.stays ? { move: { name: p.move.name, keys: p.move.data, aim: p.move.aim } } : {}) }); return out }
/** A rule's actors as they were kept, put back before the rule starts again. What was kept is read as anything from outside is. */
function actorsBack(ruleId, actors, now) {
  const three = (a) => Array.isArray(a) && a.length === 3 && a.every((v) => Number.isFinite(v) && Math.abs(v) < 2 ** 30)
  for (const a of Array.isArray(actors) ? actors.slice(0, 64) : []) {
    if (!a || typeof a.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,23}$/.test(a.id) || !three(a.at) || !Number.isFinite(a.yaw)) continue
    const was = Number.isInteger(a.was) && three(a.home) && !taken.has(a.was) ? a.was : undefined
    const p = { by: `${ruleId}/${a.id}`, short: a.id, rule: ruleId, name: typeof a.name === 'string' ? text(a.name, 24) : a.id, seat: true, at: [...a.at], yaw: a.yaw, goal: Array.isArray(a.goal) && a.goal.length === 2 && a.goal.every(Number.isFinite) ? a.goal : null, stopped: '', down: 0, flinch: 0, last: now, told: 0, ...(Number.isFinite(a.pace) ? { pace: Math.max(0, Math.min(PACE_MOST, a.pace)) } : {}), ...(canKept(a.can) ? { can: canKept(a.can) } : {}), ...(a.aloft === true ? { aloft: true } : {}), ...(was !== undefined ? { was, home: [...a.home], stride: 0 } : {}) }
    if (a.look && typeof a.look === 'object') p.look = lookOf(a.look)
    // A move it was held in (sitting, aiming, going round and round): it is in it still, at its end.
    const move = a.move && typeof a.move === 'object' ? moveOf(typeof a.move.name === 'string' ? a.move.name : a.move.keys) : null
    if (move && (move.hold || move.loop)) p.move = { n: 1, since: now - lengthOf(move) * 1000, ...(typeof a.move.name === 'string' ? { name: a.move.name } : { data: move }), long: lengthOf(move), stays: true, aim: three(a.move.aim) ? a.move.aim : undefined }
    folk.set(p.by, p)
    if (was !== undefined) taken.set(was, p)
    tell(p)
  }
}

/** The middle of someone, for aiming at: lower when they are on the ground. */
const middle = (p, now) => [Math.round(p.at[0] * 10) / 10, Math.round(p.at[1]) + (p.down > now ? 3 : 10), Math.round(p.at[2] * 10) / 10]
/** A body whose move is aimed turns to what it is aimed at while the move lasts, and its aim goes with whoever it is aimed at. Says whether anything changed. */
function turned(p, now) {
  const m = p.move
  if (!m?.aim || !(m.stays || now - m.since < m.long * 1000)) return false
  let changed = false
  if (m.aimAt) {
    const them = folk.get(m.aimAt)
    if (!them) m.aimAt = undefined
    else { const at = middle(them, now); if (Math.hypot(at[0] - m.aim[0], at[1] - m.aim[1], at[2] - m.aim[2]) > 1) { m.aim = at; changed = true } }
  }
  // Standing, the whole body faces it. Walking, it faces where it goes, and the page turns chest and head (people.ts).
  if (!p.goal && p.down <= now) {
    const dx = m.aim[0] - p.at[0], dz = m.aim[2] - p.at[2]
    if (Math.hypot(dx, dz) > 3) { const yaw = Math.atan2(dx, -dz); let by = yaw - p.yaw; by -= Math.round(by / (Math.PI * 2)) * Math.PI * 2; if (Math.abs(by) > 0.03) { p.yaw = yaw; changed = true } }
  }
  return changed
}
/** What is in a body's way at a place, for the telling: the first thing from the knees up, or a drop. */
const inTheWay = (x, y, z) => { for (let k = 0; k < TALL; k++) { const kind = core.world_kind(Math.round(x), Math.round(y) + CLIMB + k, Math.round(z)); if (kind) return `${MATERIALS[kind & 15]} in the way` } return 'a drop too far to step down' }
/** How bodies get about: round what is in the way, after or away from someone, and who is near whom (about.mjs). */
const getting = about({ folk, footing, kind: (x, y, z) => core.world_kind(x, y, z), tall: TALL, pace: PACE, say: inTheWay, hear: (rule, event, e) => ruled.happen(event, e, rule), rate: () => body.rate })
// Ten times a second: bodies with somewhere to go take a step, and everyone is told where they are.
let ticks = 0
setInterval(() => {
  // Bodies stand still for the moment a core is swapped: the world under their feet is being put together again.
  if (swapping) return
  const now = Date.now()
  ticks++
  rests(now)
  if (ticks % 10 === 0) blow.sweep(now)
  if (driven.step(now)) nudged = true
  driven.watch(now)
  driven.carry(now)
  for (const p of folk.values()) {
    if (!p.rule && now - p.last > (p.seat ? SEAT_STAYS : PAGE_STAYS) * 1000) { folk.delete(p.by); p.gone = true; if (p.seat) tell(p); lay(grasp.left(p)); continue }
    if (!p.seat) continue
    if (p.back && goingBack(p, now)) continue
    // A tenth of a second of its going: straight, or round what is in its way, or after whoever it follows (about.mjs).
    const aimed = turned(p, now)
    if (getting.step(p, now, ticks) || aimed) { tell(p); p.told = now
    } else if (now - p.told > 1000) { if (p.stopped.startsWith('knocked') && p.down <= now) p.stopped = ''; tell(p); p.told = now }
  }
  // Who has come near whom, and into what: the rules that asked are told.
  getting.nearness()
}, 100)

/** What a body looks like and does with its limbs, as a rule gives it: for a rule's actor, and for someone at a page (rules/bodies.mjs). */
function limbs(rule, p, w, now, wrong) {
  if (w.look !== undefined) p.look = lookOf(w.look)
  // What it does with its limbs: a move that has a name, or keys of the rule's own; null ends it. And what it is aimed at.
  if (w.move !== undefined) {
    if (w.move === null) p.move = undefined
    else { const move = moveOf(w.move); if (move) p.move = { n: (p.move?.n ?? 0) + 1, since: now, ...(typeof w.move === 'string' ? { name: w.move } : { data: move }), long: lengthOf(move), stays: !!(move.loop || move.hold), aim: p.move?.aim }; else wrong(typeof w.move === 'string' ? `"${w.move.slice(0, 24)}" is not a move with a name: the guide lists them, or send keys` : 'a move is a name, or {keys: [{t, ...joints}], loop, hold}') }
  }
  // What the move is aimed at: a place, or someone (an id from world.people), who is then followed by it. The body turns to it while the move lasts.
  if (w.aim !== undefined && p.move) {
    const them = typeof w.aim === 'string' ? folk.get(`${rule.id}/${w.aim}`) ?? folk.get(w.aim) : undefined
    if (w.aim === null) { p.move.aim = undefined; p.move.aimAt = undefined }
    else if (them && them !== p) { p.move.aimAt = them.by; p.move.aim = middle(them, now) }
    else if (Array.isArray(w.aim) && w.aim.length === 3 && w.aim.every((v) => Number.isFinite(v) && Math.abs(v) < 2 ** 30)) { p.move.aim = w.aim.map((v) => Math.round(v * 10) / 10); p.move.aimAt = undefined }
    else wrong(typeof w.aim === 'string' ? `aim: nobody called "${w.aim.slice(0, 24)}" has a body here (world.people says who has)` : 'what a move is aimed at is aim: [x, y, z], or the id of someone in world.people, or null')
  }
}

// ── Rules (#264) ─────────────────────────────────────────────────────────
// A rule is text that someone, or a model of theirs, wrote: what the people of a world do, what a game in it is.
// It is kept with the world as the ask that put it there. This process never runs a line of one: each has a
// thread of its own (rules/run.mjs), is posted a copy of who is there when something happens that it listens for,
// and posts back what it wants done. Every field of that is checked here, as anything from outside is: a rule
// moves only its own actors, by names, places, paces and looks that this process would take from anyone.
//
// An actor is a body this process moves for a rule, as a seat is a body it moves for someone outside a page:
// everyone sees it as a figure, a walk meets the world's own cells, and it stays while its rule does.
const ACTOR_ID = /^[a-z0-9][a-z0-9-]{0,23}$/, COLOUR = /^#[0-9a-f]{6}$/
/** The most actors a rule may have, the most it may want done in one answer, the most people it is told of. */
const ACTORS_MOST = 64, WANTS_MOST = 64, PEOPLE_MOST = 256
/** The fastest an actor may go, cells a second (a walk is 13), and the most a rule's actors may say a second. */
const PACE_MOST = CAN.pace[1], SAYS_A_SECOND = 8
const pair = (a) => Array.isArray(a) && (a.length === 2 || a.length === 3) && a.every((v) => Number.isFinite(v) && Math.abs(v) < 2 ** 30)
/** Who sees whom (rules/sight.mjs): a clear line through the world as it stands, and where each faces. */
const eyes = sight({ folk, kind: (x, y, z) => core.world_kind(x, y, z) })
/** Who is there, as a rule is told it: its own actors by the names it gave them, anyone else by the name the world knows them by. */
function people(id) {
  const now = Date.now(), out = [], seen = eyes.now(now)
  /** Whom someone sees, by the ids this rule knows them by. */
  const sees = (p) => { const s = seen.get(p.by); return s ? { sees: [...s].map((by) => folk.get(by)).filter(Boolean).map((q) => (q.rule === id ? q.short : q.by)) } : {} }
  for (const p of folk.values()) {
    if (out.length >= PEOPLE_MOST) break
    out.push({ id: p.rule === id ? p.short : p.by, name: p.name, kind: p.rule ? 'actor' : p.seat ? 'seat' : 'page', mine: p.rule === id, at: p.at.map(Math.round), yaw: Number(p.yaw.toFixed(2)), walking: !!p.goal, down: p.down > now, ...sees(p), ...(grasp?.of(p.by) ? { holds: grasp.of(p.by) } : {}), ...(p.rule === id && p.stopped ? { stopped: p.stopped } : {}), ...(p.rule === id && p.follow ? { [p.follow.flee ? 'flees' : 'follows']: folk.get(p.follow.by)?.rule === id ? folk.get(p.follow.by).short : p.follow.by } : {}), ...(p.rule === id && p.thinking ? { thinking: true } : {}), ...(p.rule === id && p.can ? { can: { ...p.can } } : {}), ...(p.aloft ? { aloft: true } : {}), ...(p.rule === id && p.was !== undefined ? { was: residentId(p.was) } : {}), ...(p.rule === id && (p.look || p.was !== undefined) ? { look: p.look ?? looksOf(p.was).look } : {}), ...(p.rule ? {} : { person: true }), ...(p.move && (p.move.stays || now - p.move.since < p.move.long * 1000) ? { move: p.move.name ?? 'keys' } : {}) })
  }
  return out
}
/** Whether someone's helper answers for this world's people now: the server says when it changes (mind/door.mjs). */
let voiced = false
/** Living things as rules have them (rules/things.mjs): told of, and driven. */
const driven = livingThings({ alive, folk, drive: (a, go, turn, rise, jump) => core.living_drive(a.body, go, turn, rise, 0, jump ? 1 : 0), tell: (p) => tell(p), happen: (event, e) => ruled.happen(event, e), stand: (x, z) => stand(x, z), changed: () => body.say(),
  // A kept thing is brought in as any made thing is: its record and its cells together in one ask of the world's own, so it is in the world's file and every page has it. Then it is turned to face as asked.
  bring: ({ id, rule, thing, low, yaw }) => {
    const rows = keptRows(thing, low), mid = [low[0] + thing.size[0] / 2, low[1] + thing.size[1] / 2 + 2, low[2] + thing.size[2] / 2]
    parentPort.emit('message', { ask: { by: 'the world', edit: [1, rows.length / 5, ...rows], box: [low[0], low[1], low[2], low[0] + thing.size[0], low[1] + thing.size[1], low[2] + thing.size[2]], release: [low[0] - 2, low[1] + 1, low[2]], thing: { id, name: thing.name, wish: '', by: 'the world', at: [Math.round(mid[0]), low[1], Math.round(mid[2])], size: thing.size, facing: 'east', rule, controls: { scheme: thing.scheme, motor: thing.motor, seats: thing.seats, size: thing.size } } } })
    const a = alive.get(id)
    if (a && Number.isFinite(yaw)) { const half = (Math.PI / 2 - yaw) / 2; core.living_place(a.body, mid[0], mid[1], mid[2], 0, Math.sin(half), 0, Math.cos(half)); nudged = true }
    return !!a
  },
  place: (a, at, rot) => { core.living_place(a.body, at[0], at[1], at[2], rot[0], rot[1], rot[2], rot[3]); nudged = true },
  hear: (rule, event, e) => ruled.happen(event, e, rule),
  retune: (a, motor) => { const n = numbers(motor), room = core.edits_room(n.length); new Float32Array(core.memory.buffer, room, n.length).set(n); core.living_motor(a.body, n.length); nudged = true },
  take: (id) => {
    const a = alive.get(id)
    if (!a) return
    told(core.living_vanish(a.body), false)
    alive.delete(id)
    parentPort.postMessage({ living: { thing: id, body: 0 } })
    parentPort.postMessage({ echo: { by: 'the world', gone: id } })
    nudged = true
  } })
const ruled = ruling({ people, residents: townTold, things: (id) => driven.near(id), does: () => [...does.keys()], obey: (rule, wants, event) => { during = event; try { obey(rule, wants, Date.now()) } finally { during = '' } }, voiced: () => voiced, realm: () => (realmIs ? { name: String(realmIs.name ?? ''), about: String(realmIs.about ?? '') } : null) })
/** Something happened that rules may listen for: `only` names the one rule it is told to, when it is nobody else's to hear. */
const happen = (event, e, only) => ruled.happen(event, e, only)
/** A rule is taken out, and its actors go with it. */
function drop(id) {
  ruled.drop(id)
  hand.dropped(id)
  plug.dropped(id)
  getting.dropped(id)
  body.dropped(id)
  driven.dropped(id)
  minds.drop(id)
  builds.dropped(id)
  // Its actors go with it; those who were residents go back to their rounds.
  for (const p of [...folk.values()]) if (p.rule === id) { if (p.was !== undefined) release(p); else { folk.delete(p.by); p.gone = true; tell(p) } }
}
/**
 * What a rule may ask for, by name: `world.<name>(id, fields)` in a rule comes here as `{do: name, id, ...fields}`.
 * Each entry checks its own fields and does it, or says what is wrong (`wrong`) and leaves it. To give rules
 * something new to do, add an entry here (from a file of its own, if it is more than a few lines) and a line to
 * the guide in serve.mjs: a rule is told the names with every call, so nothing in the interpreter changes.
 */
const does = new Map()
/** What the rule whose answer is being done now was answering: the name of what it heard, or '' when nothing of a rule's is being done. */
let during = ''
/**
 * A rule's actor has finished saying something: rules that listen for `spoke` are told, the actor's own rule too
 * (`mine`). It is not `said`: a rule that answers what people say does not hear actors, so nothing that only
 * listens for people can be set talking by another rule's people. And what stops two rules that do listen from
 * answering each other for ever: what an actor says while its rule is answering a `spoke` (`echo`) is heard by
 * everyone near and told to no rule. So talk between rules' actors goes one deep and stops.
 */
function spoke(p, words, to, echo) {
  if (echo || !p.rule || p.rule === '~') return
  const e = { by: p.by, rule: p.rule, id: p.short, name: p.name || 'Someone', text: words, to, at: p.at.map(Math.round) }
  ruled.happen('spoke', { ...e, mine: true }, p.rule)
  ruled.happen('spoke', { ...e, mine: false }, undefined, p.rule)
}
/** A body says words: everyone near hears. Rules are not told here: `spoke` does that, once for a whole answer. */
const utter = (p, words, now = Date.now()) => { const v = { n: ++spoken, by: p.by, name: p.name || 'Someone', text: words, at: p.at.map(Math.round), t: now }; voices.push(v); if (voices.length > 400) voices.shift(); parentPort.postMessage({ said: v }) }
/** What this world is called and is about, as the server last said (it keeps the realm's record): for the people of it who are asked to think. */
let realmIs = null
/** The hour of the day here (#264): the realm's own, if it says one; else eleven, which is what a page has the town's residents out by when nothing says. A page in this world goes by the same, so a rule takes only residents that every page draws. */
const HOUR = 11, hourNow = () => (typeof realmIs?.hour === 'number' ? realmIs.hour : HOUR)
const minds = thinking({ actor: (rule, id) => { const p = folk.get(`${rule}/${id}`); return p?.rule === rule ? p : undefined }, say: utter, show: (p) => tell(p), hand: (think) => parentPort.postMessage({ think }), happen, spoke, answering: () => during, realm: () => realmIs })
setInterval(() => minds.tidy(Date.now()), 1000)
/** Makes an actor of the rule's, or changes one. */
does.set('actor', (rule, w, now, wrong) => {
  const id = w.id
  if (typeof id !== 'string' || !ACTOR_ID.test(id)) return wrong('an actor has a name of its rule\'s own: lower-case letters, digits and dashes, up to 24')
  const by = `${rule.id}/${id}`
  let p = folk.get(by)
  // Someone outside may have joined under that very name first: they are not the rule's to move.
  if (p && p.rule !== rule.id) { wrong(p.rule === '~' ? `"${id}" was let go and is still walking back to its round: use another name, or wait` : `the name "${id}" is taken by someone who is not this rule's actor`); return }
  // A resident of the town, taken as this rule's own: it stands where it stood.
  if (!p && w.take !== undefined) {
    if (actorsOf(rule.id) >= ACTORS_MOST) { wrong(`a rule may have ${ACTORS_MOST} actors`); return }
    if (!(p = take(rule, id, w.take, now, wrong))) return
  }
  if (w.at !== undefined || !p) {
    if (!pair(w.at)) { wrong(`actor "${id}" is not in the world yet: it needs a place, at: [x, z]`); return }
    // Where it was asked for, or a step to one side if someone stands there: nobody is put inside anybody.
    const [x, z] = getting.room(Math.round(w.at[0]), Math.round(w.at[w.at.length - 1]), p, (x, z) => stand(x, z) !== null), feet = stand(x, z)
    if (feet === null) { wrong(`there is no room for actor "${id}" to stand at ${x}, ${z}`); return }
    if (!p) {
      let mine = 0
      for (const o of folk.values()) if (o.rule === rule.id) mine++
      if (mine >= ACTORS_MOST) { wrong(`a rule may have ${ACTORS_MOST} actors`); return }
      p = { by, short: id, rule: rule.id, name: id, seat: true, at: [x, feet, z], yaw: Math.PI, goal: null, stopped: '', down: 0, flinch: 0, last: now, told: 0 }
      folk.set(by, p)
    } else { p.at = [x, feet, z]; p.goal = null; p.path = undefined; p.stopped = ''; p.leap = p.scales = p.falls = p.frame = undefined; p.aloft = false }
  }
  // A name is shown over the head; null (or nothing) is no name shown, as a resident has none.
  if (w.name !== undefined) p.name = w.name === null ? '' : text(w.name, 24)
  if (w.pace !== undefined) { if (Number.isFinite(w.pace)) p.pace = Math.max(0, Math.min(PACE_MOST, w.pace)); else if (w.pace === null) p.pace = undefined; else wrong('a pace is a number of cells a second') }
  // What else its body can do, by the names and ranges a person's has (rules/bodies.mjs): about.mjs moves it by them.
  for (const k of ['jump', 'climb', 'fly', 'fall']) {
    if (w[k] === undefined) continue
    if (w[k] === null) { if (p.can) { delete p.can[k]; if (!Object.keys(p.can).length) p.can = undefined } }
    else if (Number.isFinite(w[k])) (p.can ??= {})[k] = Math.max(CAN[k][0], Math.min(CAN[k][1], w[k]))
    else wrong(`${k} is a number, or null to put it back`)
    p.path = undefined; p.noWay = undefined
  }
  if (w.to !== undefined) {
    p.follow = undefined
    if (w.to === null) { p.goal = null; p.path = undefined }
    else if (pair(w.to)) { p.goal = [w.to[0], w.to[w.to.length - 1]]; p.goalY = w.to.length === 3 ? w.to[1] : undefined; p.noWay = undefined; p.stopped = ''; if (p.pathTo && Math.hypot(p.goal[0] - p.pathTo[0], p.goal[1] - p.pathTo[1]) > 8) p.path = undefined } else wrong('where to go is to: [x, z] (or [x, y, z] for one that flies), or null to stop')
  }
  // After someone, or away from them, until told otherwise: whoever world.people names (this rule's own actors by the names it gave them).
  for (const flee of [false, true]) {
    const who = flee ? w.flee : w.follow
    if (who === undefined) continue
    if (who === null) { if (p.follow && p.follow.flee === flee) { p.follow = undefined; p.goal = null; p.path = undefined } continue }
    const them = typeof who === 'string' ? folk.get(`${rule.id}/${who}`) ?? folk.get(who) : undefined
    if (!them || them === p) { wrong(`${flee ? 'flee' : 'follow'}: nobody called "${String(who).slice(0, 24)}" has a body here (world.people says who has)`); continue }
    p.follow = { by: them.by, flee, keep: Number.isFinite(w.keep) ? Math.max(4, Math.min(2000, w.keep)) : flee ? 150 : 15 }
    p.path = undefined; p.stopped = ''
  }
  if (w.keep !== undefined && p.follow && Number.isFinite(w.keep)) p.follow.keep = Math.max(4, Math.min(2000, w.keep))
  // How near a person must come for the rule to hear of it (`near`); 0 or null: it does not.
  if (w.reach !== undefined) p.reach = Number.isFinite(w.reach) && w.reach > 0 ? Math.min(REACH_MOST, w.reach) : undefined
  if (w.face !== undefined) { if (pair(w.face)) { const dx = w.face[0] - p.at[0], dz = w.face[w.face.length - 1] - p.at[2]; if (dx || dz) p.yaw = Math.atan2(dx, -dz) } else wrong('what to face is face: [x, z]') }
  limbs(rule, p, w, now, wrong)
  if (w.say !== undefined) {
    const words = text(w.say, 200)
    if (now - rule.since > 1000) { rule.since = now; rule.says = 0 }
    // What an actor says is heard by everyone near, and told to rules as `spoke`, never as `said` (see `spoke`).
    if (words && ++rule.says <= SAYS_A_SECOND) { utter(p, words, now); spoke(p, words, '', during === 'spoke') }
  }
  tell(p); p.told = now
})
// `world.gone(id)`, an actor of the rule's leaving, is a plugin (plugins/gone): the first of these moved into that form.
/** An actor is asked to think (mind/think.mjs): what a model on someone's own machine makes of it comes back to the rule as `thought`. */
does.set('think', (rule, w, now, wrong) => minds.ask(rule, w, now, wrong))
/** A model reads what someone said for the notes a rule wants (mind/think.mjs): nobody answers; the rule hears `read`. */
does.set('read', (rule, w, now, wrong) => minds.read(rule, w, now, wrong))
// What a realm puts in a person's hands (rules/hands.mjs): things to do, and what the aim of one who does one met.
const hand = hands({ folk, tall: TALL, look, text, tell: (m) => parentPort.postMessage(m), hear: (rule, event, e) => ruled.happen(event, e, rule), using: (by) => grasp.of(by) })
// Holding a thing (rules/holding.mjs): picked up its cells leave the world, put down they go back where it is said.
grasp = holding({ folk, kind: (x, y, z) => core.world_kind(x, y, z), hear: (event, e) => happen(event, e), seen: (p) => tell(p), want: (m) => parentPort.postMessage({ want: m }) })
does.set('give', grasp.give)
does.set('take', grasp.take)
/** An ask the world's process made itself (what someone who left held is put down): done as any ask is, and told. */
const lay = (ask) => { if (!ask || grasp.put(ask)) return; parentPort.postMessage({ echo: ask }); edit(ask.edit); told(core.bodies_release(ask.release[0], ask.release[1], ask.release[2], 0), true); nudged = true }
// What a person's body can do, and how fast the world goes (rules/bodies.mjs).
const body = bodies({ folk, tell: (m) => parentPort.postMessage(m), limbs, shown: tell, seated: () => driven.seated() })
does.set('person', body.person)
// Blows (rules/blows.mjs): everyone's ghost in the core, what a rule hears of what meets them, and throwing, pushing and putting down.
// Thrown, what a hand held is a body of its own cells; its record goes, for it lies wherever it lands (rules/holding.mjs `letGo`).
const blow = blows({ core, folk, tell, post: (m) => parentPort.postMessage(m), told: (n) => { told(n, false); nudged = true }, happen: (event, e) => ruled.happen(event, e), hear: (rule, event, e) => ruled.happen(event, e, rule), thing: (bodyId) => { for (const [id, a] of alive) if (a.body === bodyId) return id }, blast: (at, radius, spark) => { shock(at, radius); told(core.bodies_blast(at[0], at[1], at[2], radius, -1, spark ? 1 : 0), true); nudged = true }, ignite: (at, radius) => { core.bodies_ignite(at[0], at[1], at[2], radius); told(core.bodies_advance(0), false); nudged = true } , letGo: (by) => { const h = grasp?.letGo(by); if (!h) return null; const g = grid(h.rows, false); parentPort.postMessage({ echo: { by, gone: h.thing } }); return g } })
does.set('throw', blow.throw)
does.set('push', blow.push)
does.set('down', blow.down)
does.set('blast', blow.blast)
does.set('ignite', blow.ignite)
does.set('clock', body.clock)
does.set('drive', driven.drive)
does.set('seat', driven.seat)
does.set('thing', driven.thing)
does.set('line', driven.line)
does.set('offer', hand.offer)
/** A place the rule marks: it hears `near` when a person comes into it or goes out. */
does.set('mark', getting.mark)
does.set('show', hand.show)
// What a realm sounds like, `world.sound`, is a plugin (plugins/sound), as its music is (plugins/music).
// Engine plugins (plugins.mjs, the WORKSHOP lane): more that a rule can hear and do, each a folder under plugins/,
// loaded when the world starts and swapped while it runs. Rules wait for a load that is under way: a rule is told
// what it may do with every call, and one started again must find what it used.
// What rules have built (rules/built.mjs, the BUILD lane): cells a rule put into the world, and what each replaced, so that they can be taken out again. Its edits are done as an ask's are: echoed, put into the core, and what they left unheld let fall.
const builds = built({ core: () => core, folk, lives: () => [...alive.values()].map((a) => a.pose?.at), footing, stand, tell, busy: () => !!swapping, apply: (echo) => { parentPort.postMessage({ echo }); edit(echo.edit) }, settle: (at) => { told(at ? core.bodies_release(at[0], at[1], at[2], 0) : 0, true); nudged = true } })
const plug = plugger({ does, dir: workerData.plugins, post: (m) => parentPort.postMessage(m), doors: { builds, core: () => core, folk, living: (id) => alive.get(id)?.pose?.at ?? null, text, tell, release, look, stand, tall: TALL, happen: (event, e) => ruled.happen(event, e), hear: (rule, event, e) => ruled.happen(event, e, rule) } })
let plugging = Promise.resolve()
/** What a rule wants done, a thing at a time. What is not as it should be is left out and said (`error`): the rest is done. */
function obey(rule, wants, now) {
  const wrong = (what) => { rule.error = what }
  if (wants.length > WANTS_MOST) wrong(`a rule may want ${WANTS_MOST} things done in one answer: the rest were left`)
  for (const w of wants.slice(0, WANTS_MOST)) {
    const fn = w && typeof w === 'object' ? does.get(w.do) : undefined
    if (!fn) { wrong(`"${String(w?.do).slice(0, 24)}" is not something a rule can do here: ${[...does.keys()].join(', ')} are`); continue }
    // Whatever one of these does with what a rule sent, it is not thrown into the world's process.
    try { fn(rule, w, now, wrong) } catch (e) { wrong(`${w.do} failed: ${String(e?.message ?? e).slice(0, 120)}`) }
  }
}
/** Under this name, beside the rules' own (no rule's id has a ~ in it): what the world's people remember of talk (mind/think.mjs). */
const TALKED = '~talk'
// What is to be kept of the rules over a restart: said to the server when it has changed, every two seconds at most.
let keptLast = ''
setInterval(() => { const actors = actorsKept(), out = {}; for (const [id, keep] of ruled.keeps()) out[id] = { keep, actors: actors[id] ?? [], marks: getting.kept(id) }; const talk = minds.kept(); if (Object.keys(talk).length) out[TALKED] = talk; const json = JSON.stringify(out); if (json !== keptLast) { keptLast = json; parentPort.postMessage({ kept: json }) } }, 2000)
/** How many actors a rule has. */
const actorsOf = (id) => { let n = 0; for (const p of folk.values()) if (p.rule === id) n++; return n }
// Twice a second, while anyone is there to see: a world with nobody in it asks nothing of its rules.
setInterval(() => { for (const p of folk.values()) if (!p.rule) return happen('tick', { dt: 0.5 }) }, 500)

let nudged = false
/** The first thing down each column of a rectangle of the ground, looked for from a height: how high it is (or null) and what it is. One question in place of a look a column. */
function tops([x0, z0, x1, z1], from) {
  const high = [], kinds = []
  for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) {
    let y = from, kind = 0
    // No further down than a tall thing and a slope under it: asked from far above, a column is not looked down for ever.
    for (; y > from - 400 && !(kind = core.world_kind(x, y, z)); y--);
    high.push(kind ? y : null); kinds.push(kind)
  }
  return { high, kinds }
}
parentPort.on('message', (said) => {
  const { ask, replay, at, look: line, id, seat: asks, here, rows, revive, drive, nudge, tops: area, rule, rules: how, act, kept, pick, plugins, thought, swap, swapped, voiced: answers, called, talked, settle } = said
  // A thing a world started again finds still held by nobody: put down where it was taken from.
  if (settle) { const down = grasp.settle(settle.id, settle.rows, settle.at); if (down) { parentPort.postMessage({ echo: down }); edit(down.edit); nudged = true } return }
  // What the world's people remembered of talk when it last stopped.
  if (talked !== undefined) return minds.back(talked)
  if (called !== undefined) { realmIs = called && typeof called === 'object' ? called : null; return }
  // Whether a model answers for this world's people now: said at once, whatever else waits.
  if (answers !== undefined) { voiced = answers === true; return }
  // The core swapped for another build (#264, the workshop): a new module of the same file is started, and from then
  // everything said to this process waits its turn (the server sends the world's edits again, as when a world
  // starts, and then `swapped`). What is in the old core and in no file is lost with it: bodies in the air, fire,
  // water on the move. Living things get up where they last slept (the server sends `revive`). People, actors, rules
  // and what they keep are this process's own and are untouched.
  if (swap) {
    // One at a time: a second asked for while one is under way is answered as not done.
    if (swapping) return parentPort.postMessage({ id, ready: { error: 'a swap is already under way' } })
    const began = performance.now()
    // From this line the old core is not stepped (the clocks below look at `swapping`), so it logs nothing more:
    // what it had logged is on its way to the server ahead of the answer to this, and is in what the server sends back.
    swapping = { held: [], began, fire: fireSeen }
    alive.clear()
    void readFile(swap).then((bytes) => WebAssembly.instantiate(bytes, {})).then(({ instance }) => { core = instance.exports; swapping.ms = performance.now() - began }, (e) => { swapping.error = String(e?.message ?? e).slice(0, 200) }).then(() => parentPort.postMessage({ id, ready: { error: swapping.error ?? '' } }))
    return
  }
  // While the swap is under way: the world's own history is taken as it comes (the server sends it once the new
  // core is ready), and everything else waits for it to be whole, to be done in the order it came.
  if (swapping && !replay && !revive && !swapped) { swapping.held.push(said); return }
  if (swapped) {
    const was = swapping
    swapping = null
    // Fire is carried across as far as the old core said where it was: those cells are lit again, and it spreads from them.
    let lit = 0
    if (was?.fire && !was.error) for (let f = 0; f + 2 < was.fire.length && lit < 256; f += 3, lit++) core.bodies_ignite(Math.floor(was.fire[f]), Math.floor(was.fire[f + 1]), Math.floor(was.fire[f + 2]), 1)
    nudged = true
    plug.recored()
    parentPort.postMessage({ id, swapped: { instantiate: Number((was?.ms ?? 0).toFixed(1)), ms: Number((performance.now() - (was?.began ?? performance.now())).toFixed(1)), held: was?.held.length ?? 0, relit: lit, error: was?.error ?? '' } })
    for (const m of was?.held ?? []) parentPort.emit('message', m)
    return
  }
  if (plugins) { plugging = plugging.then(() => plug.load(plugins)).then((plugged) => parentPort.postMessage({ id, plugged }), (e) => parentPort.postMessage({ id, plugged: [], error: String(e) })); return }
  // What a helper answered for an actor that was asked to think.
  if (thought) return minds.answer(thought)
  if (pick) return parentPort.postMessage({ id, error: hand.pick(pick) })
  // Someone did something a rule offers: the rule hears it, with what their aim met.
  if (act) return parentPort.postMessage({ id, error: hand.act(act) })
  // How the rules are doing; and a rule the world had when it last stopped, put in again as it starts.
  if (how) return parentPort.postMessage({ id, rules: ruled.doing(actorsOf) })
  if (rule) return void plugging.then(() => { actorsBack(rule.id, kept?.actors, Date.now()); getting.back(rule.id, kept?.marks); ruled.put(rule, 'restart', kept?.keep && typeof kept.keep === 'object' && !Array.isArray(kept.keep) ? kept.keep : undefined) })
  if (area) return parentPort.postMessage({ id, ...tops(area.box, area.from) })
  // What a living thing's rider asks of it: never kept, and nothing if it is not there.
  if (drive?.on !== undefined) return driven.rides(drive.by, drive.id, drive.on, Date.now())
  if (drive && driven.held(drive.id)) return
  if (drive) { const a = alive.get(drive.id); if (a) { a.ridden = Date.now(); a.asked = drive.go } if (a && core.living_drive(a.body, drive.go, drive.turn, drive.rise, drive.roll ? 1 : 0, drive.jump ? 1 : 0)) nudged = true; return }
  // A world started again: each thing that lived gets up where it last slept.
  if (revive) return live(revive.id, revive.controls, revive.rows, false, text(revive.name ?? '', 40))
  // Someone has joined: where everything is is said once more, for what sleeps says nothing by itself.
  if (nudge) { nudged = true; for (const p of folk.values()) if (p.rule) { if (p.move) p.move.told = -1; tell(p) } return }
  if (asks) return parentPort.postMessage({ id, ...seat(asks) })
  // A page's own body: its eyes are where its view is.
  if (here) {
    const old = folk.get(here.by)
    if (old?.seat) return
    const p = old ?? { by: here.by, seat: false, goal: null, down: 0, flinch: 0 }
    // One who rides is where their thing is (rules/things.mjs), not where their page's eye is.
    if (driven.seatOf(here.by)) Object.assign(p, { name: here.name, last: Date.now() })
    else Object.assign(p, { name: here.name, at: [here.at[0], here.at[1] - EYES - 0.5, here.at[2]], yaw: here.yaw, frame: here.frame, last: Date.now() })
    folk.set(here.by, p)
    return tell(p)
  }
  if (line) return parentPort.postMessage({ id, ...look(line.from, line.to) })
  // A question, answered at once: what a cell is made of, and how high the ground's rule puts the land there.
  if (at) return parentPort.postMessage({ id, kind: core.world_kind(at[0], at[1], at[2]), ground: core.ground_at(at[0], at[2]) })
  // What was done before this process began: the edits only, with nothing thrown and nothing let fall.
  if (replay) { if (said.built) builds.replayed(said.built, replay); return edit(replay) }
  // A thing picked up or put down: the ask is made whole here (its edit, what the hand carries), or said why not.
  // A hand that is full puts down what it holds, at its owner's feet, before it takes another: nobody is told no.
  if (ask.hold !== undefined && grasp.of(ask.by)) lay({ by: ask.by, put: true })
  if (ask.hold !== undefined || ask.put !== undefined) { const why = ask.hold !== undefined ? grasp.hold(ask, rows) : grasp.put(ask); if (why) return parentPort.postMessage({ refused: { by: ask.by, why } }) }
  parentPort.postMessage({ echo: ask })
  // A rule put in or taken out, or what the realm is called: kept as every ask is, and nothing of the cells' to do.
  if (ask.rule) return void plugging.then(() => ruled.put(ask.rule, ruled.has(ask.rule.id) ? 'changed' : 'put'))
  if (ask.unrule) return drop(ask.unrule)
  if (ask.realm) return
  if (ask.blast) shock(ask.blast, ask.radius)
  if (ask.blast) told(core.bodies_blast(ask.blast[0], ask.blast[1], ask.blast[2], ask.radius, -1, ask.spark ? 1 : 0), true)
  else if (ask.ignite) { core.bodies_ignite(ask.ignite[0], ask.ignite[1], ask.ignite[2], ask.radius); told(core.bodies_advance(0), false) }
  else if (ask.ball) told(core.bodies_throw(...ask.ball.from, ...ask.ball.speed, ask.ball.radius, ask.ball.kind), false)
  else if (ask.edit) {
    edit(ask.edit)
    // A thing that comes with its controls lives at once: before the world is asked what the edit left unheld, or a
    // car set down on a sloping street would be let fall as loose cells first.
    if (ask.thing?.controls !== undefined) live(ask.thing.id, ask.thing.controls, ask.edit.slice(2), true, text(ask.thing.name ?? '', 40))
    told(core.bodies_release(ask.release[0], ask.release[1], ask.release[2], 0), true)
  }
  // A thing that is there, given controls with a motor, lives from now on (the server sent its cells with the ask).
  else if (ask.thing?.controls !== undefined) live(ask.thing.id, ask.thing.controls, rows, true, text(ask.thing.name ?? '', 40))
  // Water may have been let out: it is found when the world is next moved on.
  nudged = true
})

// Its own clock: sixty times a second while anything moves, burns or flows.
let last = performance.now()
setInterval(() => {
  const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000)
  last = now
  // Not while the core is being swapped: the old one must say nothing more, and the new one is not whole yet.
  if (swapping) { last = performance.now(); return }
  if (!nudged && !core.bodies_count() && !core.bodies_burning() && !core.bodies_flowing()) { if (fireSeen && !core.bodies_burning()) fireSeen = null; return }
  nudged = false
  // Ghosts are carried on as their people were going (rules/blows.mjs), and all moves by the world's clock, which a rule may slow or quicken (rules/bodies.mjs).
  blow.track()
  told(core.bodies_advance(dt * body.rate), false)
}, 16)
parentPort.postMessage({ ready: true })
