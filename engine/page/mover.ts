// The worker that moves what has come loose (#146): one instance of the core, which holds the
// bodies and the world as they meet it. The page tells it of each blast, which answers with
// what the blast threw out and loosened, and then asks it every frame to move the bodies on. It answers in the core's own
// words (told.ts reads them). Everything is done in the order asked.
import { near, open } from './bay.ts'

/** What the page asks: a blast (where, how big, and how many of the mover's own edits the page had applied when it made it), or time to move on by. */
export interface Ask { /** Which world the page had when it asked (#450, main.ts `reset`): the answer says it again, and one of a world since put back is let by. */ age?: number; /** Forgets everything done to the world and everything that moves (#264): the page is leaving this world for another, whose edits are told next. */ forget?: true; blast?: [number, number, number]; radius?: number; after?: number; /** Whether the blast sets alight what can burn round it. */ spark?: boolean; tick?: number; /** Sets alight what can burn within `radius` of a point. */ ignite?: [number, number, number]; /** Edits made by the page (a cut, a thing placed), as edits.ts streams them; `release` is where to ask what they left unheld. */ edit?: Int32Array; release?: [number, number, number]; /** A ball thrown: from where, how fast (cells a second), its radius and kind. */ ball?: { from: [number, number, number]; speed: [number, number, number]; radius: number; kind: number }; /** A living thing to make (#245): its cells (one kind each, laid out x, then z, then y), its size, where its low corner is, whether those cells are taken out of the world as it is born, and its motor's numbers (living.ts `numbers`). The answer says its id. */ spawn?: { cells: Int32Array; size: [number, number, number]; low: [number, number, number]; take?: boolean; motor: Float32Array }; /** What a living thing is told to do until it is told again, or for a second. Alone, it gets no answer. */ drive?: { id: number; go: number; turn: number; rise: number; roll?: boolean; jump?: boolean; boost?: boolean; wetness?: number; surfaceGrip?: number }; /** A living thing that lives no more: a loose body from now on. Alone, it gets no answer. */ end?: number; /** Someone's body to make (#264, person.ts): where its low corner is, its size, its motor's numbers. The answer says its id. */ figure?: { low: [number, number, number]; size: [number, number, number]; motor: Float32Array }; /** How someone's body is to go: the way it faces (its front at cos, 0, sin), forward and to its right from -1 to 1, up and down, a jump. Alone, it gets no answer. */ walk?: { id: number; heading: number; go: number; side: number; rise: number; jump: boolean }; /** New numbers for a living thing's motor. Alone, it gets no answer. */ motor?: { id: number; numbers: Float32Array }; /** A living thing taken out of the world, leaving nothing. Alone, it gets no answer. */ vanish?: number; /** How a living thing falls (1 as everything does) and how high a wall it climbs (cells). Alone, it gets no answer. */ ways?: { id: number; fall: number; climb: number }; /** A push on a living thing: so much speed at once (cells a second). Alone, it gets no answer. */ kick?: { id: number; speed: [number, number, number] }; /** A living thing set at a place (its middle of mass, cells) and turned so (a quaternion), still: a car brought to life where it was drawn standing (#450, street.ts). Alone, it gets no answer. */ place?: { id: number; at: [number, number, number]; rot: [number, number, number, number] }; /** Which way is down for a living thing (all zero for the world's own), and whether it clings to whatever face it walks onto. Alone, it gets no answer. */ down?: { id: number; way: [number, number, number]; cling: boolean }; /** The Cleave (#226, cleave.ts): everything the flat sheet through `eye` crosses comes apart along it. The sheet faces `normal` (up, so that what is above it is what slides) and reaches `reach` cells from the eye, across the wedge that starts along `e1` and turns `theta` radians towards `e2`; what is above goes the way of `slide`. Answered as a blast is (`released`), with nothing if this core cannot cleave. */ cleave?: { eye: [number, number, number]; normal: [number, number, number]; e1: [number, number, number]; e2: [number, number, number]; theta: number; reach: number; slide: [number, number, number] }; /** After a cleave, what was cut hangs in the air and is let go: moved on by the clock on the wall (seconds), whatever the world's own time does. Alone, it gets no answer. */ hang?: number; /** A loose body put at a place (its middle of mass, cells), turned so (a quaternion), going so (cells a second) and turning so (radians a second): time let go after it was wound back (rewind.ts). Alone, it gets no answer. */ pose?: { id: number; pos: [number, number, number]; rot: [number, number, number, number]; vel: [number, number, number]; spin: [number, number, number] }; /** Loose bodies within `radius` cells of `center` taken hold of, `max` of them at most, to be carried round it. Alone, it gets no answer. */ orbit?: { center: [number, number, number]; radius: number; max: number }; /** What is held is thrown: which way, and how fast (cells a second). Alone, it gets no answer. */ fling?: { dir: [number, number, number]; speed: number } }
/**
 * The asks of #226 as whoever holds this worker would call them: each is one `Ask` posted (`cleave`, `hang`, `pose`,
 * `orbit`, `fling`). This module is the worker itself and the page takes only its types, so the page builds these.
 */
export interface CleaveAsks {
  cleave(eye: readonly [number, number, number], normal: readonly [number, number, number], e1: readonly [number, number, number], e2: readonly [number, number, number], theta: number, reach: number, slide: readonly [number, number, number]): void
  hangTick(realDt: number): void
  setPose(id: number, pos: readonly [number, number, number], rot: readonly [number, number, number, number], vel: readonly [number, number, number], spin: readonly [number, number, number]): void
  captureOrbit(center: readonly [number, number, number], radius: number, maxCount: number): void
  captureFling(dir: readonly [number, number, number], speed: number): void
}
/** What comes back: the core's words, how long it took, how many bodies still move and how many points it tried against the world. */
export interface Answer { /** The asking world's age, as the ask said it. */ age?: number; words: Uint32Array<ArrayBuffer>; ms: number; bodies: number; tried: number; released: boolean; /** How many cells are alight. */ burning: number; /** Whether water is flowing, or may. */ flowing: boolean; failed?: string; /** The id of the living thing a `spawn` made, 0 if it could not be. */ spawned?: number }

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
  world_forget(): void
  bodies_release(x: number, y: number, z: number, radius: number): number
  bodies_throw(x: number, y: number, z: number, vx: number, vy: number, vz: number, radius: number, kind: number): number
  bodies_burning(): number
  bodies_flowing(): number
  living_spawn(sx: number, sy: number, sz: number, x: number, y: number, z: number, take: number): number
  living_last(): number
  living_motor(id: number, count: number): number
  living_drive(id: number, go: number, turn: number, rise: number, roll: number, jump: number): number
  living_drive_aux?(id: number, boost: number, wetness: number, surfaceGrip: number): number
  living_end(id: number): number
  living_figure(x: number, y: number, z: number, wide: number, tall: number, deep: number): number
  living_walk(id: number, heading: number, go: number, side: number, rise: number, jump: number): number
  living_vanish(id: number): number
  living_ways(id: number, fall: number, climb: number): number
  living_kick(id: number, vx: number, vy: number, vz: number): number
  living_down(id: number, dx: number, dy: number, dz: number, cling: number): number
  living_place(id: number, x: number, y: number, z: number, qx: number, qy: number, qz: number, qw: number): number
  // The Cleave and what goes with it (#226): a core built before its lane has none of these, and then nothing is done.
  // The cleave is known by either name, and answers as a blast does: how many words it wrote.
  bodies_cleave?(ex: number, ey: number, ez: number, nx: number, ny: number, nz: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, theta: number, reach: number, sx: number, sy: number, sz: number): number
  bodies_cleave_wedge?: Core['bodies_cleave']
  bodies_hang?(dt: number): number
  bodies_cleave_hang?: Core['bodies_hang']
  bodies_set_pose?(id: number, x: number, y: number, z: number, qx: number, qy: number, qz: number, qw: number, vx: number, vy: number, vz: number, wx: number, wy: number, wz: number): number
  bodies_capture_orbit?(x: number, y: number, z: number, radius: number, max: number): number
  bodies_capture_fling?(dx: number, dy: number, dz: number, speed: number): number
}
let ready: Promise<Core> = open<Core>(new URL('./core.wasm', import.meta.url).href)
/** In the Bay that comes in tiles (#373): initial/teleport tile gate (bounded so a stalled tile never deadlocks physics). */
let here: Promise<void> = Promise.resolve()
/** Last tile center told to this mover; nearby streaming updates run in the background without blocking steps. */
let bayAt: [number, number] | null = null
const bounded = (p: Promise<void>, ms: number) => Promise.race([p, new Promise<void>((r) => setTimeout(r, ms))])
const post = (answer: Answer, age?: number) => (self as unknown as Worker).postMessage(age === undefined ? answer : { ...answer, age }, [answer.words.buffer])

self.onmessage = async (e: MessageEvent<Ask>) => {
  // The core built again (#264, main.ts `recore`): what is asked from here on is done by the new one, which knows
  // nothing yet: whoever sent this tells it the world's edits again and makes its bodies again.
  const anew = (e.data as unknown as { core?: string }).core
  if (anew) { ready = open<Core>(anew); bayAt = null; here = Promise.resolve(); return }
  const bay = (e.data as unknown as { bay?: [number, number] }).bay
  if (bay) {
    const p = ready.then((core) => near(core, bay[0], bay[1], 8000)).then(() => {}, () => {})
    const jumped = !bayAt || Math.hypot(bay[0] - bayAt[0], bay[1] - bayAt[1]) > 1500
    bayAt = [bay[0], bay[1]]
    if (jumped) here = bounded(p, 3000)
    return
  }
  const ask = e.data, t0 = performance.now(), released = !!ask.blast || !!ask.release || !!ask.cleave
  try {
    const core = await ready
    await here
    if (ask.forget) { bayAt = null; here = Promise.resolve(); core.world_forget(); return }
    if (ask.drive) {
      core.living_drive(ask.drive.id, ask.drive.go, ask.drive.turn, ask.drive.rise, ask.drive.roll ? 1 : 0, ask.drive.jump ? 1 : 0)
      if (ask.drive.boost !== undefined || ask.drive.wetness !== undefined || ask.drive.surfaceGrip !== undefined) {
        core.living_drive_aux?.(ask.drive.id, ask.drive.boost ? 1 : 0, ask.drive.wetness ?? 0, ask.drive.surfaceGrip ?? 0)
      }
    }
    if (ask.end !== undefined) core.living_end(ask.end)
    if (ask.walk) core.living_walk(ask.walk.id, ask.walk.heading, ask.walk.go, ask.walk.side, ask.walk.rise, ask.walk.jump ? 1 : 0)
    if (ask.vanish !== undefined) core.living_vanish(ask.vanish)
    const motor = (id: number, numbers: Float32Array) => { const room = core.edits_room(numbers.length); new Float32Array(core.memory.buffer, room, numbers.length).set(numbers); return core.living_motor(id, numbers.length) }
    if (ask.motor) motor(ask.motor.id, ask.motor.numbers)
    if (ask.ways) core.living_ways(ask.ways.id, ask.ways.fall, ask.ways.climb)
    if (ask.down) core.living_down(ask.down.id, ask.down.way[0], ask.down.way[1], ask.down.way[2], ask.down.cling ? 1 : 0)
    if (ask.kick) core.living_kick(ask.kick.id, ask.kick.speed[0], ask.kick.speed[1], ask.kick.speed[2])
    if (ask.place) core.living_place(ask.place.id, ask.place.at[0], ask.place.at[1], ask.place.at[2], ask.place.rot[0], ask.place.rot[1], ask.place.rot[2], ask.place.rot[3])
    // The Cleave's own orders (#226): done if this core can, and like a living thing's they are answered by the next step.
    if (ask.hang !== undefined) (core.bodies_hang ?? core.bodies_cleave_hang)?.(ask.hang)
    if (ask.pose) { const { id, pos, rot, vel, spin } = ask.pose; core.bodies_set_pose?.(id, pos[0], pos[1], pos[2], rot[0], rot[1], rot[2], rot[3], vel[0], vel[1], vel[2], spin[0], spin[1], spin[2]) }
    if (ask.orbit) core.bodies_capture_orbit?.(ask.orbit.center[0], ask.orbit.center[1], ask.orbit.center[2], ask.orbit.radius, ask.orbit.max)
    if (ask.fling) core.bodies_capture_fling?.(ask.fling.dir[0], ask.fling.dir[1], ask.fling.dir[2], ask.fling.speed)
    // Told on its own, a living thing's orders are answered by the next step. (A cleave is always answered: the page waits for it as for a blast.)
    if ((ask.drive || ask.end !== undefined || ask.walk || ask.vanish !== undefined || ask.motor || ask.ways || ask.kick || ask.down || ask.place || ask.hang !== undefined || ask.pose || ask.orbit || ask.fling) && ask.tick === undefined && !ask.figure && !ask.cleave) return
    if (ask.figure) {
      const { low, size } = ask.figure
      const n = core.living_figure(low[0], low[1], low[2], size[0], size[1], size[2]), at = core.bodies_words()
      const words = new Uint32Array(core.memory.buffer, at, n).slice(), spawned = core.living_last()
      if (spawned) motor(spawned, ask.figure.motor)
      post({ words, ms: performance.now() - t0, bodies: core.bodies_count(), tried: 0, released: false, burning: core.bodies_burning(), flowing: core.bodies_flowing() !== 0, spawned }, ask.age)
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
      post({ words, ms: performance.now() - t0, bodies: core.bodies_count(), tried: 0, released: false, burning: core.bodies_burning(), flowing: core.bodies_flowing() !== 0, spawned }, ask.age)
      return
    }
    if (ask.ignite) core.bodies_ignite(ask.ignite[0], ask.ignite[1], ask.ignite[2], ask.radius ?? 3)
    if (ask.edit) {
      const room = core.edits_room(ask.edit.length)
      new Int32Array(core.memory.buffer, room, ask.edit.length).set(ask.edit)
      core.world_edit(ask.after ?? -1)
    }
    const cleft = (c: NonNullable<Ask['cleave']>) => (core.bodies_cleave ?? core.bodies_cleave_wedge)?.(c.eye[0], c.eye[1], c.eye[2], c.normal[0], c.normal[1], c.normal[2], c.e1[0], c.e1[1], c.e1[2], c.e2[0], c.e2[1], c.e2[2], c.theta, c.reach, c.slide[0], c.slide[1], c.slide[2]) ?? 0
    const n = ask.cleave ? cleft(ask.cleave) : ask.ball ? core.bodies_throw(...ask.ball.from, ...ask.ball.speed, ask.ball.radius, ask.ball.kind) : ask.release ? core.bodies_release(ask.release[0], ask.release[1], ask.release[2], 0) : ask.blast ? core.bodies_blast(ask.blast[0], ask.blast[1], ask.blast[2], ask.radius ?? 0, ask.after ?? -1, ask.spark ? 1 : 0) : core.bodies_advance(ask.tick ?? 0)
    // The call first, then the memory: making bodies may have grown it.
    const at = core.bodies_words()
    post({ words: new Uint32Array(core.memory.buffer, at, n).slice(), ms: performance.now() - t0, bodies: core.bodies_count(), tried: core.bodies_tried(), released, burning: core.bodies_burning(), flowing: core.bodies_flowing() !== 0 }, ask.age)
  } catch (failed) {
    // Out of memory, most likely: the page is told, so that a device can report it.
    post({ words: new Uint32Array(0), ms: performance.now() - t0, bodies: 0, tried: 0, released, burning: 0, flowing: false, failed: String(failed) }, ask.age)
  }
}
