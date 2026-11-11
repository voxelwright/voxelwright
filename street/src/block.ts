// The block as the world process holds it (#118): the engine's own World (home/src/engine),
// built from the block's toys (scene.ts), with a seat for each resident. It keeps what the
// wire needs and World does not: a small number for each moving thing, and each seat's
// inputs in the order they were made. One step is one tick of TICK.
import { createJolt, loadJolt } from '../../home/src/engine/jolt.ts'
import { World } from '../../home/src/engine/world.ts'
import { HALF_L, HALF_W, heightAt, onStreet } from './ground.ts'
import { STREET, cargo, registerBlock, resident } from './scene.ts'
import { TICK, type Input } from './walk.ts'
import type { ToySpec } from '../../home/src/engine/toy.ts'
import type { Drawn, Pose, Self } from './wire.ts'

export interface BlockOptions {
  crates: number
  balls: number
  /** Nothing ever falls asleep: the worst case, for timing. */
  awake?: boolean
}

interface Seat { toy: string; body: string; legs: string; queue: Input[]; newest: number; last: Input; ack: number }

const STILL: Input = { seq: 0, x: 0, z: 0, jump: false }
const SEAT_COLORS = ['#f06f6f', '#5fb0e8', '#84c96a', '#e6b95c', '#b48be0']
/** A sleeping thing is still said for this many ticks after it stops, and now and then after. */
const SAID_AFTER_SLEEP = 12, SLEEPERS_PER_SNAP = 6
/** The lowest ground of the block, with room under it: a thing below this is lost. */
export const FLOOR = heightAt(HALF_L) - 6

export class Block {
  tick = 0
  /** How long each of the last steps took, ms. */
  readonly stepMs: number[] = []
  private ids = new Map<string, number>()
  private specs = new Map<string, ToySpec>()
  private sleptAt = new Map<string, number>()
  private seats = new Map<number, Seat>()
  private nextId = 1
  private seated = 0
  private turn = 0
  private seed = 20261110
  private world: World
  private keepAwake: boolean

  static async make(options: BlockOptions) {
    await loadJolt()
    registerBlock()
    return new Block(options)
  }

  private constructor(options: BlockOptions) {
    this.keepAwake = options.awake === true
    this.world = new World(createJolt(), () => {}, undefined, FLOOR)
    // A long hill: things may go faster than in a room, and nothing is slowed by the air (a walker's speed is its own).
    const rules = this.world.setRules({ maxSpeed: 25, drag: 0 }, 'code')
    if (!rules.ok) throw new Error(rules.reason)
    this.build(STREET)
    this.build(cargo(options.crates, options.balls))
  }

  /** Builds a toy and gives each of its moving parts a number for the wire. */
  private build(toy: ToySpec) {
    this.world.addToy(toy)
    this.specs.set(toy.id, toy)
    for (const part of toy.parts) if (part.motion && part.motion !== 'static') this.ids.set(`${toy.id}/${part.id}`, this.nextId++)
  }

  private random() {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0
    return this.seed / 2 ** 32
  }

  /** A new resident at the top of the street. Returns the number of its body. */
  join(): number {
    const n = this.seated++
    const toy = `seat-${n + 1}`
    const spec = resident(toy, this.seats.size)
    spec.parts[0].paint = SEAT_COLORS[n % SEAT_COLORS.length]
    this.build(spec)
    const id = this.ids.get(`${toy}/body`)!
    this.seats.set(id, { toy, body: `${toy}/body`, legs: `${toy}/legs`, queue: [], newest: 0, last: STILL, ack: 0 })
    return id
  }
  leave(id: number) {
    const seat = this.seats.get(id)
    if (!seat) return
    this.world.removeToy(seat.toy)
    this.specs.delete(seat.toy)
    this.ids.delete(seat.body)
    this.sleptAt.delete(seat.body)
    this.seats.delete(id)
  }

  /** Inputs from a seat, newest first; ones already had are dropped. */
  input(id: number, inputs: Input[]) {
    const seat = this.seats.get(id)
    if (!seat) return
    for (let i = inputs.length - 1; i >= 0; i--) {
      if (inputs[i].seq <= seat.newest) continue
      seat.queue.push(inputs[i])
      seat.newest = inputs[i].seq
    }
  }

  step() {
    const started = performance.now()
    for (const seat of this.seats.values()) {
      // A seat that fell behind catches up at once rather than staying late for good.
      while (seat.queue.length > 4) seat.queue.shift()
      const next = seat.queue.shift()
      const input = next ?? { ...seat.last, jump: false }
      if (next) { seat.last = next; seat.ack = next.seq }
      this.world.setKnob(seat.legs, 'x', input.x)
      this.world.setKnob(seat.legs, 'z', input.z)
      this.world.setKnob(seat.legs, 'jump', input.jump ? 1 : 0)
    }
    if (this.keepAwake) for (const key of this.ids.keys()) this.world.applyImpulse(key, [0, 1e-9, 0])
    this.world.advance(TICK)
    this.tick++
    if (this.tick % 30 === 0) this.roll()
    this.stepMs.push(performance.now() - started)
    if (this.stepMs.length > 3600) this.stepMs.shift()
  }

  /** A ball that reached the bottom, or came to rest while someone is here, goes back to the top: the hill never goes still under a resident. */
  private roll() {
    for (const pose of this.world.poses(true)) {
      if (!pose.key.startsWith('cargo/ball-')) continue
      if (pose.position[2] < HALF_L - 3 && (pose.awake || this.seats.size === 0)) continue
      this.world.moveTo(pose.key, onStreet((this.random() * 2 - 1) * (HALF_W - 1), -HALF_L + 1.5 + this.random(), 1 + this.random() * 3), [0, 0, 0])
    }
  }

  /** A toy as a page needs it to draw. */
  private drawnAs(toy: ToySpec): Drawn {
    const ids: Drawn['ids'] = {}, poses: Drawn['poses'] = {}
    for (const part of toy.parts) {
      const key = `${toy.id}/${part.id}`, id = this.ids.get(key), t = id === undefined ? null : this.world.thing(key)
      if (id === undefined || !t) continue
      ids[part.id] = id
      poses[part.id] = { p: t.position, q: t.rotation }
    }
    return { toy: { ...toy, gadgets: [], wires: [], inputs: {} }, ids, poses }
  }
  /** Everything built, as a new seat needs it. */
  drawn(): Drawn[] {
    return [...this.specs.values()].map((toy) => this.drawnAs(toy))
  }
  /** The toy of one seat. */
  drawnOf(id: number): Drawn {
    return this.drawnAs(this.specs.get(this.seats.get(id)!.toy)!)
  }
  toyOf(id: number) {
    return this.seats.get(id)?.toy
  }

  /** What moved: every thing awake, each one that just stopped, and a few sleepers in turn (so a pose lost on the way is put right). */
  poses(): Pose[] {
    const out: Pose[] = [], asleep: Pose[] = []
    for (const pose of this.world.poses(true)) {
      const id = this.ids.get(pose.key)
      if (id === undefined) continue
      const said = { id, p: pose.position, q: pose.rotation }
      if (pose.awake) this.sleptAt.delete(pose.key)
      else {
        const since = this.sleptAt.get(pose.key) ?? this.sleptAt.set(pose.key, this.tick).get(pose.key)!
        if (this.tick - since > SAID_AFTER_SLEEP) { asleep.push(said); continue }
      }
      out.push(said)
    }
    for (let i = 0; i < SLEEPERS_PER_SNAP && i < asleep.length; i++) out.push(asleep[this.turn++ % asleep.length])
    return out
  }
  awake() {
    return this.world.poses().length
  }

  self(id: number): Self | null {
    const seat = this.seats.get(id)
    const t = seat && this.world.thing(seat.body), legs = seat && this.world.state(seat.legs)
    if (!seat || !t || !legs) return null
    return { tick: this.tick, ack: seat.ack, p: t.position, v: t.velocity, hop: legs.hop, grounded: legs.grounded === 1 }
  }

  dispose() { this.world.dispose() }
}
