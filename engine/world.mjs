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
import { residents } from './page/residents.ts'

const { instance } = await WebAssembly.instantiate(await readFile(workerData.core), {})
const core = instance.exports
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
    i += size
  }
  const join = (parts) => { const out = new Uint32Array(parts.reduce((sum, p) => sum + p.length, 0)); let at = 0; for (const p of parts) { out.set(p, at); at += p.length } return out }
  const counts = [core.bodies_count(), core.bodies_burning(), core.bodies_flowing(), released ? 1 : 0]
  parentPort.postMessage({ log: join(log), state: join(state), counts })
  if (alive.size) heed(words)
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
function live(id, value, rows, fresh) {
  const controls = controlsOf(value)
  if (!controls) return
  const motor = numbers(controls.motor), known = alive.get(id)
  const set = (body) => { const room = core.edits_room(motor.length); new Float32Array(core.memory.buffer, room, motor.length).set(motor); return core.living_motor(body, motor.length) }
  if (known) { known.controls = controls; set(known.body); return }
  const g = rows && grid(rows, fresh)
  if (!g) return
  // The room first, then the memory: making room may grow it.
  const room = core.edits_room(g.cells.length)
  new Int32Array(core.memory.buffer, room, g.cells.length).set(g.cells)
  const n = core.living_spawn(g.size[0], g.size[1], g.size[2], g.low[0], g.low[1], g.low[2], fresh ? 1 : 0), body = core.living_last()
  if (!body) return
  alive.set(id, { body, controls, pose: null, awake: true })
  set(body)
  if (!fresh && controls.rest) core.living_place(body, ...controls.rest.at, ...controls.rest.rot)
  told(n, false)
  parentPort.postMessage({ living: { thing: id, body } })
  nudged = true
}
/** What the core said, for the living: where each is, which broke (it lives no more, and its record goes), which fell asleep (where is written in its record). */
function heed(words) {
  const f = new Float32Array(words.buffer, words.byteOffset, words.length), awake = new Set(), broke = new Set()
  let moved = false
  const bodies = new Map([...alive].map(([id, a]) => [a.body, id]))
  for (let i = 0; i < words.length;) {
    const tag = words[i], n = words[i + 1], at = i + 2
    if (tag === 5) { moved = true; for (let k = at; k < at + n; k += 8) { const a = alive.get(bodies.get(words[k])); if (a) a.pose = { at: [f[k + 1], f[k + 2], f[k + 3]], rot: [f[k + 4], f[k + 5], f[k + 6], f[k + 7]] } } }
    else if (tag === 11) for (let k = at; k < at + n; k += 8) awake.add(words[k])
    else if (tag === 6) broke.add(words[at])
    i = at + n
  }
  for (const [id, a] of [...alive]) {
    if (broke.has(a.body)) {
      alive.delete(id)
      parentPort.postMessage({ living: { thing: id, body: 0 } })
      parentPort.postMessage({ echo: { by: 'the world', gone: id } })
    } else if (moved) {
      if (a.awake && !awake.has(a.body) && a.pose) {
        a.controls = { ...a.controls, rest: { at: a.pose.at.map((v) => Math.round(v * 100) / 100), rot: a.pose.rot.map((v) => Math.round(v * 10000) / 10000) } }
        parentPort.postMessage({ echo: { by: 'the world', thing: { id, controls: a.controls } } })
      }
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
const tell = (p) => parentPort.postMessage({ here: { by: p.by, name: p.name, at: p.at, yaw: p.yaw, walking: p.goal ? 1 : 0, down: p.down > Date.now(), flinch: p.flinch > Date.now(), seat: p.seat, gone: p.gone } })
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
/** What a seat asks about its own body. Answers what came of it, or `error`. */
function seat(m) {
  const now = Date.now()
  let p = folk.get(m.by)
  if (m.op === 'join') {
    // On the pavement north of where the town starts, unless a place is given; at the height the world has ground there.
    const x = m.at ? m.at[0] : 690 + (spoken + folk.size * 7) % 40, z = m.at ? m.at[1] : 4009
    // The highest place to stand within six metres of where the land's rule puts the ground: on a heap, if one lies there.
    let feet = null
    for (let y = core.feet_at(x, z) + 60; y > core.feet_at(x, z) - 60 && feet === null; y--) if (solid(x, y - 1, z) && footing(x, y, z) === y) feet = y
    if (feet === null) return { error: 'there is no room to stand there' }
    p = { by: m.by, name: m.by, seat: true, at: [x, feet, z], yaw: m.yaw ?? Math.PI, goal: null, stopped: '', down: 0, flinch: 0, last: now, told: 0 }
    folk.set(m.by, p)
    tell(p)
    return { you: state(p) }
  }
  // A page's body may speak; everything else a body does here is a seat's.
  if (!p || (!p.seat && m.op !== 'say')) return { error: 'nobody of that name has a body here: POST /world/join first' }
  p.last = now
  if (m.op === 'leave') { folk.delete(m.by); p.gone = true; tell(p); return { left: true } }
  if (m.op === 'walk') {
    if (p.down > now) return { error: 'you are on the ground: wait a few seconds' }
    p.goal = [m.to[0], m.to[1]]; p.stopped = ''
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
    return { said: v.n }
  }
  if (m.op === 'me') return { you: state(p) }
  if (m.op === 'around') {
    const within = Math.min(m.within || NEAR, 1200), people = []
    for (const o of folk.values()) {
      if (o === p) continue
      const dx = o.at[0] - p.at[0], dz = o.at[2] - p.at[2], far = Math.hypot(dx, dz, o.at[1] - p.at[1])
      if (far <= within) people.push({ name: o.name, what: o.seat ? 'in a seat' : 'at a page', at: o.at.map(Math.round), far: Math.round(far), towards: bearing(dx, dz), doing: o.down > now ? 'on the ground' : o.goal ? 'walking' : 'standing' })
    }
    // The town's residents, by the same rule the pages draw them from. This process has no hour: it is noon to it.
    const found = [], n = residents(core, [p.at[0], p.at[2]], Math.min(within, 400), now / 1000, 12, found, shocks)
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
// Ten times a second: bodies with somewhere to go take a step, and everyone is told where they are.
setInterval(() => {
  const now = Date.now()
  for (const p of folk.values()) {
    if (now - p.last > (p.seat ? SEAT_STAYS : PAGE_STAYS) * 1000) { folk.delete(p.by); p.gone = true; if (p.seat) tell(p); continue }
    if (!p.seat) continue
    if (p.goal && p.down <= now) {
      const dx = p.goal[0] - p.at[0], dz = p.goal[1] - p.at[2], far = Math.hypot(dx, dz), step = Math.min(far, PACE / 10)
      if (far < 0.5) { p.goal = null }
      else {
        const x = p.at[0] + (dx / far) * step, z = p.at[2] + (dz / far) * step, feet = footing(x, p.at[1], z)
        if (feet === null) {
          // What is in the way, for the telling: the first thing from the knees up, or a drop.
          let what = 'a drop too far to step down'
          for (let k = 0; k < TALL; k++) { const kind = core.world_kind(Math.round(x), Math.round(p.at[1]) + CLIMB + k, Math.round(z)); if (kind) { what = `${MATERIALS[kind & 15]} in the way`; break } }
          p.stopped = `${what}, ${Math.round(far)} cells short of where you were going`
          p.goal = null
        } else { p.at = [x, feet, z]; p.yaw = Math.atan2(dx, -dz) }
      }
      tell(p); p.told = now
    } else if (now - p.told > 1000) { if (p.stopped.startsWith('knocked') && p.down <= now) p.stopped = ''; tell(p); p.told = now }
  }
}, 100)

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
parentPort.on('message', ({ ask, replay, at, look: line, id, seat: asks, here, rows, revive, drive, nudge, tops: area }) => {
  if (area) return parentPort.postMessage({ id, ...tops(area.box, area.from) })
  // What a living thing's rider asks of it: never kept, and nothing if it is not there.
  if (drive) { const a = alive.get(drive.id); if (a && core.living_drive(a.body, drive.go, drive.turn, drive.rise, drive.roll ? 1 : 0, drive.jump ? 1 : 0)) nudged = true; return }
  // A world started again: each thing that lived gets up where it last slept.
  if (revive) return live(revive.id, revive.controls, revive.rows, false)
  // Someone has joined: where everything is is said once more, for what sleeps says nothing by itself.
  if (nudge) { nudged = true; return }
  if (asks) return parentPort.postMessage({ id, ...seat(asks) })
  // A page's own body: its eyes are where its view is.
  if (here) {
    const old = folk.get(here.by)
    if (old?.seat) return
    const p = old ?? { by: here.by, seat: false, goal: null, down: 0, flinch: 0 }
    Object.assign(p, { name: here.name, at: [here.at[0], here.at[1] - EYES - 0.5, here.at[2]], yaw: here.yaw, last: Date.now() })
    folk.set(here.by, p)
    return tell(p)
  }
  if (line) return parentPort.postMessage({ id, ...look(line.from, line.to) })
  // A question, answered at once: what a cell is made of, and how high the ground's rule puts the land there.
  if (at) return parentPort.postMessage({ id, kind: core.world_kind(at[0], at[1], at[2]), ground: core.ground_at(at[0], at[2]) })
  // What was done before this process began: the edits only, with nothing thrown and nothing let fall.
  if (replay) return edit(replay)
  parentPort.postMessage({ echo: ask })
  if (ask.blast) shock(ask.blast, ask.radius)
  if (ask.blast) told(core.bodies_blast(ask.blast[0], ask.blast[1], ask.blast[2], ask.radius, -1, ask.spark ? 1 : 0), true)
  else if (ask.ignite) { core.bodies_ignite(ask.ignite[0], ask.ignite[1], ask.ignite[2], ask.radius); told(core.bodies_advance(0), false) }
  else if (ask.ball) told(core.bodies_throw(...ask.ball.from, ...ask.ball.speed, ask.ball.radius, ask.ball.kind), false)
  else if (ask.edit) {
    edit(ask.edit)
    // A thing that comes with its controls lives at once: before the world is asked what the edit left unheld, or a
    // car set down on a sloping street would be let fall as loose cells first.
    if (ask.thing?.controls !== undefined) live(ask.thing.id, ask.thing.controls, ask.edit.slice(2), true)
    told(core.bodies_release(ask.release[0], ask.release[1], ask.release[2], 0), true)
  }
  // A thing that is there, given controls with a motor, lives from now on (the server sent its cells with the ask).
  else if (ask.thing?.controls !== undefined) live(ask.thing.id, ask.thing.controls, rows, true)
  // Water may have been let out: it is found when the world is next moved on.
  nudged = true
})

// Its own clock: sixty times a second while anything moves, burns or flows.
let last = performance.now()
setInterval(() => {
  const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000)
  last = now
  if (!nudged && !core.bodies_count() && !core.bodies_burning() && !core.bodies_flowing()) return
  nudged = false
  told(core.bodies_advance(dt), false)
}, 16)
parentPort.postMessage({ ready: true })
