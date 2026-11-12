// The worker that moves what has come loose (#146): one instance of the core, which holds the
// bodies and the world as they meet it. The page tells it of each blast, which answers with
// what the blast threw out and loosened, and then asks it every frame to move the bodies on. It answers in the core's own
// words (told.ts reads them). Everything is done in the order asked.

/** What the page asks: a blast (where, how big, and how many of the mover's own edits the page had applied when it made it), or time to move on by. */
export interface Ask { blast?: [number, number, number]; radius?: number; after?: number; /** Whether the blast sets alight what can burn round it. */ spark?: boolean; tick?: number; /** Sets alight what can burn within `radius` of a point. */ ignite?: [number, number, number]; /** Edits made by the page (a cut, a thing placed), as edits.ts streams them; `release` is where to ask what they left unheld. */ edit?: Int32Array; release?: [number, number, number]; /** A ball thrown: from where, how fast (cells a second), its radius and kind. */ ball?: { from: [number, number, number]; speed: [number, number, number]; radius: number; kind: number } }
/** What comes back: the core's words, how long it took, how many bodies still move and how many points it tried against the world. */
export interface Answer { words: Uint32Array<ArrayBuffer>; ms: number; bodies: number; tried: number; released: boolean; /** How many cells are alight. */ burning: number; failed?: string }

interface Core {
  memory: WebAssembly.Memory
  edits_room(words: number): number
  bodies_blast(x: number, y: number, z: number, radius: number, after: number, spark: number): number
  bodies_advance(dt: number): number
  bodies_words(): number
  bodies_count(): number
  bodies_tried(): number
  bodies_ignite(x: number, y: number, z: number, radius: number): number
  world_edit(after: number): void
  bodies_release(x: number, y: number, z: number, radius: number): number
  bodies_throw(x: number, y: number, z: number, vx: number, vy: number, vz: number, radius: number, kind: number): number
  bodies_burning(): number
}
const ready: Promise<Core> = WebAssembly.instantiateStreaming(fetch('/page/core.wasm'), {}).then((r) => r.instance.exports as unknown as Core)
const post = (answer: Answer) => (self as unknown as Worker).postMessage(answer, [answer.words.buffer])

self.onmessage = async (e: MessageEvent<Ask>) => {
  const ask = e.data, t0 = performance.now(), released = !!ask.blast || !!ask.release
  try {
    const core = await ready
    if (ask.ignite) core.bodies_ignite(ask.ignite[0], ask.ignite[1], ask.ignite[2], ask.radius ?? 3)
    if (ask.edit) {
      const room = core.edits_room(ask.edit.length)
      new Int32Array(core.memory.buffer, room, ask.edit.length).set(ask.edit)
      core.world_edit(ask.after ?? -1)
    }
    const n = ask.ball ? core.bodies_throw(...ask.ball.from, ...ask.ball.speed, ask.ball.radius, ask.ball.kind) : ask.release ? core.bodies_release(ask.release[0], ask.release[1], ask.release[2], 0) : ask.blast ? core.bodies_blast(ask.blast[0], ask.blast[1], ask.blast[2], ask.radius ?? 0, ask.after ?? -1, ask.spark ? 1 : 0) : core.bodies_advance(ask.tick ?? 0)
    // The call first, then the memory: making bodies may have grown it.
    const at = core.bodies_words()
    post({ words: new Uint32Array(core.memory.buffer, at, n).slice(), ms: performance.now() - t0, bodies: core.bodies_count(), tried: core.bodies_tried(), released, burning: core.bodies_burning() })
  } catch (failed) {
    // Out of memory, most likely: the page is told, so that a device can report it.
    post({ words: new Uint32Array(0), ms: performance.now() - t0, bodies: 0, tried: 0, released, burning: 0, failed: String(failed) })
  }
}
