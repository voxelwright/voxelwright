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
//   { log, state, counts }        what came of it or of a tick: `log` is what must never be
//                                 missed (cells out and back, bodies born and gone, dust),
//                                 `state` is where things are now (bodies, fire, water)
import { readFile } from 'node:fs/promises'
import { parentPort, workerData } from 'node:worker_threads'

const { instance } = await WebAssembly.instantiate(await readFile(workerData.core), {})
const core = instance.exports
/** The core's records (bodies.rs): which are log and which are state. */
const STATE = new Set([5, 7, 8])

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

let nudged = false
parentPort.on('message', ({ ask, replay, at, look: line, id }) => {
  if (line) return parentPort.postMessage({ id, ...look(line.from, line.to) })
  // A question, answered at once: what a cell is made of, and how high the ground's rule puts the land there.
  if (at) return parentPort.postMessage({ id, kind: core.world_kind(at[0], at[1], at[2]), ground: core.ground_at(at[0], at[2]) })
  // What was done before this process began: the edits only, with nothing thrown and nothing let fall.
  if (replay) return edit(replay)
  parentPort.postMessage({ echo: ask })
  if (ask.blast) told(core.bodies_blast(ask.blast[0], ask.blast[1], ask.blast[2], ask.radius, -1, ask.spark ? 1 : 0), true)
  else if (ask.ignite) { core.bodies_ignite(ask.ignite[0], ask.ignite[1], ask.ignite[2], ask.radius); told(core.bodies_advance(0), false) }
  else if (ask.ball) told(core.bodies_throw(...ask.ball.from, ...ask.ball.speed, ask.ball.radius, ask.ball.kind), false)
  else if (ask.edit) { edit(ask.edit); told(core.bodies_release(ask.release[0], ask.release[1], ask.release[2], 0), true) }
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
