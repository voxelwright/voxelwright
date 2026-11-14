// The worker that moves what has come loose (#146): one instance of the core, which holds the
// bodies and the world as they meet it. The page tells it of each blast, which answers with
// what the blast threw out and loosened, and then asks it every frame to move the bodies on. It answers in the core's own
// words (told.ts reads them). Everything is done in the order asked.

/** What the page asks: a blast (where, how big, and how many of the mover's own edits the page had applied when it made it), or time to move on by. */
export interface Ask { blast?: [number, number, number]; radius?: number; after?: number; /** Whether the blast sets alight what can burn round it. */ spark?: boolean; tick?: number; /** Sets alight what can burn within `radius` of a point. */ ignite?: [number, number, number]; /** Edits made by the page (a cut, a thing placed), as edits.ts streams them; `release` is where to ask what they left unheld. */ edit?: Int32Array; release?: [number, number, number]; /** A ball thrown: from where, how fast (cells a second), its radius and kind. */ ball?: { from: [number, number, number]; speed: [number, number, number]; radius: number; kind: number }; /** A living thing to make (#245): its cells (one kind each, laid out x, then z, then y), its size, where its low corner is, whether those cells are taken out of the world as it is born, and its motor's numbers (living.ts `numbers`). The answer says its id. */ spawn?: { cells: Int32Array; size: [number, number, number]; low: [number, number, number]; take?: boolean; motor: Float32Array }; /** What a living thing is told to do until it is told again, or for a second. Alone, it gets no answer. */ drive?: { id: number; go: number; turn: number; rise: number; roll?: boolean; jump?: boolean }; /** A living thing that lives no more: a loose body from now on. Alone, it gets no answer. */ end?: number; /** Someone's body to make (#264, person.ts): where its low corner is, its size, its motor's numbers. The answer says its id. */ figure?: { low: [number, number, number]; size: [number, number, number]; motor: Float32Array }; /** How someone's body is to go: the way it faces (its front at cos, 0, sin), forward and to its right from -1 to 1, up and down, a jump. Alone, it gets no answer. */ walk?: { id: number; heading: number; go: number; side: number; rise: number; jump: boolean }; /** New numbers for a living thing's motor. Alone, it gets no answer. */ motor?: { id: number; numbers: Float32Array }; /** A living thing taken out of the world, leaving nothing. Alone, it gets no answer. */ vanish?: number }
/** What comes back: the core's words, how long it took, how many bodies still move and how many points it tried against the world. */
export interface Answer { words: Uint32Array<ArrayBuffer>; ms: number; bodies: number; tried: number; released: boolean; /** How many cells are alight. */ burning: number; /** Whether water is flowing, or may. */ flowing: boolean; failed?: string; /** The id of the living thing a `spawn` made, 0 if it could not be. */ spawned?: number }

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
  bodies_flowing(): number
  living_spawn(sx: number, sy: number, sz: number, x: number, y: number, z: number, take: number): number
  living_last(): number
  living_motor(id: number, count: number): number
  living_drive(id: number, go: number, turn: number, rise: number, roll: number, jump: number): number
  living_end(id: number): number
  living_figure(x: number, y: number, z: number, wide: number, tall: number, deep: number): number
  living_walk(id: number, heading: number, go: number, side: number, rise: number, jump: number): number
  living_vanish(id: number): number
}
const ready: Promise<Core> = WebAssembly.instantiateStreaming(fetch('/page/core.wasm'), {}).then((r) => r.instance.exports as unknown as Core)
const post = (answer: Answer) => (self as unknown as Worker).postMessage(answer, [answer.words.buffer])

self.onmessage = async (e: MessageEvent<Ask>) => {
  const ask = e.data, t0 = performance.now(), released = !!ask.blast || !!ask.release
  try {
    const core = await ready
    if (ask.drive) core.living_drive(ask.drive.id, ask.drive.go, ask.drive.turn, ask.drive.rise, ask.drive.roll ? 1 : 0, ask.drive.jump ? 1 : 0)
    if (ask.end !== undefined) core.living_end(ask.end)
    if (ask.walk) core.living_walk(ask.walk.id, ask.walk.heading, ask.walk.go, ask.walk.side, ask.walk.rise, ask.walk.jump ? 1 : 0)
    if (ask.vanish !== undefined) core.living_vanish(ask.vanish)
    const motor = (id: number, numbers: Float32Array) => { const room = core.edits_room(numbers.length); new Float32Array(core.memory.buffer, room, numbers.length).set(numbers); return core.living_motor(id, numbers.length) }
    if (ask.motor) motor(ask.motor.id, ask.motor.numbers)
    // Told on its own, a living thing's orders are answered by the next step.
    if ((ask.drive || ask.end !== undefined || ask.walk || ask.vanish !== undefined || ask.motor) && ask.tick === undefined && !ask.figure) return
    if (ask.figure) {
      const { low, size } = ask.figure
      const n = core.living_figure(low[0], low[1], low[2], size[0], size[1], size[2]), at = core.bodies_words()
      const words = new Uint32Array(core.memory.buffer, at, n).slice(), spawned = core.living_last()
      if (spawned) motor(spawned, ask.figure.motor)
      post({ words, ms: performance.now() - t0, bodies: core.bodies_count(), tried: 0, released: false, burning: core.bodies_burning(), flowing: core.bodies_flowing() !== 0, spawned })
      return
    }
    if (ask.spawn) {
      const { cells, size, low, take, motor } = ask.spawn
      // The room first, then the memory: making room may grow it.
      let room = core.edits_room(cells.length)
      new Int32Array(core.memory.buffer, room, cells.length).set(cells)
      const n = core.living_spawn(size[0], size[1], size[2], low[0], low[1], low[2], take ? 1 : 0), at = core.bodies_words()
      const words = new Uint32Array(core.memory.buffer, at, n).slice(), spawned = core.living_last()
      room = core.edits_room(motor.length)
      new Float32Array(core.memory.buffer, room, motor.length).set(motor)
      if (spawned) core.living_motor(spawned, motor.length)
      post({ words, ms: performance.now() - t0, bodies: core.bodies_count(), tried: 0, released: false, burning: core.bodies_burning(), flowing: core.bodies_flowing() !== 0, spawned })
      return
    }
    if (ask.ignite) core.bodies_ignite(ask.ignite[0], ask.ignite[1], ask.ignite[2], ask.radius ?? 3)
    if (ask.edit) {
      const room = core.edits_room(ask.edit.length)
      new Int32Array(core.memory.buffer, room, ask.edit.length).set(ask.edit)
      core.world_edit(ask.after ?? -1)
    }
    const n = ask.ball ? core.bodies_throw(...ask.ball.from, ...ask.ball.speed, ask.ball.radius, ask.ball.kind) : ask.release ? core.bodies_release(ask.release[0], ask.release[1], ask.release[2], 0) : ask.blast ? core.bodies_blast(ask.blast[0], ask.blast[1], ask.blast[2], ask.radius ?? 0, ask.after ?? -1, ask.spark ? 1 : 0) : core.bodies_advance(ask.tick ?? 0)
    // The call first, then the memory: making bodies may have grown it.
    const at = core.bodies_words()
    post({ words: new Uint32Array(core.memory.buffer, at, n).slice(), ms: performance.now() - t0, bodies: core.bodies_count(), tried: core.bodies_tried(), released, burning: core.bodies_burning(), flowing: core.bodies_flowing() !== 0 })
  } catch (failed) {
    // Out of memory, most likely: the page is told, so that a device can report it.
    post({ words: new Uint32Array(0), ms: performance.now() - t0, bodies: 0, tried: 0, released, burning: 0, flowing: false, failed: String(failed) })
  }
}
