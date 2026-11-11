// The block as the world process holds it (#118): the engine's own World (home/src/engine),
// built from the block's toys (scene.ts), with a seat for each resident. It keeps what the
// wire needs and World does not: a small number for each moving thing, and each seat's
// inputs in the order they were made. One step is one tick of TICK.
import type { Vec3 } from '../../home/src/engine/core.ts'
import { createJolt, loadJolt } from '../../home/src/engine/jolt.ts'
import { World } from '../../home/src/engine/world.ts'
import { HALF_L, HALF_W, heightAt, onStreet } from './ground.ts'
import { nearest, placeOf, standsOver, type Box } from './near.ts'
import { HOUSES } from './houses.ts'
import { BINS, CARS, CAR_KINDS, FURNITURE, PARKED, STREET, cargo, registerBlock, resident } from './scene.ts'
import { NORMAL_UP, TICK, standing, type Input } from './walk.ts'
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkToy, type ToySpec } from '../../home/src/engine/toy.ts'
import type { Drawn, Pose, Self } from './wire.ts'

export interface BlockOptions {
  crates: number
  balls: number
  /** Nothing ever falls asleep: the worst case, for timing. */
  awake?: boolean
  /** Where made things are kept, one file each, so they are here again after a restart. None: nothing is kept. */
  dir?: string
}

/** A thing someone made by asking: its toy, the sentence, and who asked. */
export interface MadeThing { toy: ToySpec; text: string; by: string; at: string }
/** The most made things the street holds, and the most moving bodies in all (1,100 awake cost 9 ms of a 16.7 ms tick). */
const MOST = { made: 80, moving: 700 }

interface Seat { toy: string; body: string; legs: string; name: string; plush: number; queue: Input[]; newest: number; last: Input; ack: number; driven?: { x: number; z: number; jump: boolean }; /** Walked by the world itself (problems.ts): not someone who came. */ cast?: boolean }

/** What is on the street, as a resident who cannot see a picture is told it. */
export interface Seen {
  residents: { id: number; name: string; at: Vec3 }[]
  things: { id: string; what: string; askedFor: string; by: string; at: Vec3; size: Vec3; material: string; moves: boolean }[]
  loose: { crates: number; balls: number }
  /** What stands on the street that nobody made: the houses (at their doors), the lamps and trees, the bins where they now lie. */
  still: { what: string; at: Vec3 }[]
}

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
  private made = new Map<string, MadeThing>()
  private madeCount = 0
  private dir?: string

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
    for (const house of HOUSES) this.build(house)
    this.build(FURNITURE)
    this.build(CARS)
    this.build(cargo(options.crates, options.balls))
    this.build(BINS)
    this.dir = options.dir && join(options.dir, 'made')
    if (this.dir) this.load(this.dir)
  }

  /** Builds again what was made before this start. A file that no longer builds is left where it is and said. */
  private load(dir: string) {
    mkdirSync(dir, { recursive: true })
    const number = (name: string) => Number(/^made-(\d+)\.json$/.exec(name)?.[1] ?? NaN)
    for (const name of readdirSync(dir).filter((n) => Number.isFinite(number(n))).sort((a, b) => number(a) - number(b))) {
      try {
        const thing = JSON.parse(readFileSync(join(dir, name), 'utf8')) as MadeThing
        const bad = checkToy(thing.toy)
        if (bad || thing.toy.id !== name.slice(0, -5)) throw new Error(bad ?? 'its id is not its file name')
        this.build(thing.toy)
        this.made.set(thing.toy.id, thing)
        this.madeCount = Math.max(this.madeCount, number(name))
      } catch (e) {
        console.error(`street: ${join(dir, name)} was not built: ${e instanceof Error ? e.message : e}`)
      }
    }
  }

  /** The name the next made thing gets. */
  nextMade() {
    return `made-${this.madeCount + 1}`
  }

  /** Puts a made toy on the street and keeps it. Returns it as a page draws it, or why there is no room. */
  place(toy: ToySpec, text: string, by: string): Drawn | { reason: string } {
    const moving = toy.parts.filter((p) => p.motion === 'dynamic').length
    if (this.made.size >= MOST.made) return { reason: `the street holds ${MOST.made} made things and is full` }
    if (this.ids.size + moving > MOST.moving) return { reason: 'there are too many moving things on the street already' }
    this.build(toy)
    this.madeCount++
    const thing: MadeThing = { toy, text, by, at: new Date().toISOString() }
    this.made.set(toy.id, thing)
    if (this.dir) {
      // Whole or not at all: written beside, then renamed over.
      const file = join(this.dir, `${toy.id}.json`)
      writeFileSync(`${file}.tmp`, JSON.stringify(thing, null, 1))
      renameSync(`${file}.tmp`, file)
    }
    return this.drawnAs(toy)
  }

  /** Takes the last thing `by` made off the street. Returns its toy's id, or null when they have made nothing that is still here. */
  unmake(by: string): string | null {
    const id = [...this.made].reverse().find(([, thing]) => thing.by === by)?.[0]
    return id && this.take(id) ? id : null
  }
  /** Takes one made thing off the street, whoever made it. */
  take(id: string): boolean {
    if (!this.made.has(id)) return false
    this.drop(id)
    this.made.delete(id)
    if (this.dir) rmSync(join(this.dir, `${id}.json`), { force: true })
    return true
  }
  /** A built toy out of the world, with the numbers its moving parts had on the wire. */
  private drop(id: string) {
    this.world.removeToy(id)
    for (const part of this.specs.get(id)?.parts ?? []) {
      this.ids.delete(`${id}/${part.id}`)
      this.sleptAt.delete(`${id}/${part.id}`)
    }
    this.specs.delete(id)
  }
  /** The toy of the first thing a line from a point meets (`along` is the way and how far), leaving out one seat's own body. */
  meets(from: Vec3, along: Vec3, not: number): string | null {
    const seat = this.seats.get(not), hit = this.world.castRay(from, along, seat ? [seat.body] : [])
    return hit ? hit.key.slice(0, hit.key.indexOf('/')) : null
  }
  /** Where a part is now, for the rules that ask (near.ts). */
  private where = (key: string) => this.world.thing(key)?.position ?? null
  /** Each made thing, and the ground it stands over now. */
  madeNow(): { id: string; label: string; by: string; box: Box }[] {
    return [...this.made].map(([id, thing]) => ({ id, label: thing.toy.label, by: thing.by, box: standsOver(thing.toy, this.where) }))
  }
  /** The made thing someone means to change: the one named, or the nearest they face (near.ts). With where its own place is now and which way it is turned. */
  madeNear(from: Vec3, yaw: number, named?: string): { id: string; toy: ToySpec; at: [number, number]; yaw: number } | null {
    const id = named ?? nearest(this.madeNow(), from, yaw)?.id, thing = id === undefined ? undefined : this.made.get(id)
    return thing && id !== undefined ? { id, toy: thing.toy, at: placeOf(thing.toy, this.where), yaw: thing.toy.frame.yaw } : null
  }
  /** A resident the world itself walks (problems.ts): sat down as a felt figure in a scarf of its own, standing at a place. */
  cast(name: string, plush: number, scarf: string, at: Vec3): number {
    const id = this.join(name)
    const seat = this.seats.get(id)!, spec = this.specs.get(seat.toy)!
    seat.plush = plush
    seat.cast = true
    spec.parts[0].paint = scarf
    this.stand(id, at)
    return id
  }

  /** A seat's walker back where residents arrive. */
  top(id: number) {
    const seat = this.seats.get(id)
    const spec = seat && this.specs.get(seat.toy)
    if (seat && spec) this.world.moveTo(seat.body, spec.frame.at, [0, 0, 0])
  }

  /** Stands a seat at a place on the street, still. */
  stand(id: number, at: Vec3) {
    const seat = this.seats.get(id)
    if (seat) this.world.moveTo(seat.body, [at[0], at[1] + standing(NORMAL_UP), at[2]], [0, 0, 0])
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

  /** A new resident at the top of the street, called `name` (or "Resident 3"). Returns the number of its body. */
  join(name = ''): number {
    const n = this.seated++
    const toy = `seat-${n + 1}`
    const spec = resident(toy, this.seats.size)
    spec.parts[0].paint = SEAT_COLORS[n % SEAT_COLORS.length]
    spec.label = name || `Resident ${n + 1}`
    this.build(spec)
    const id = this.ids.get(`${toy}/body`)!
    this.seats.set(id, { toy, body: `${toy}/body`, legs: `${toy}/legs`, name: spec.label, plush: n, queue: [], newest: 0, last: STILL, ack: 0 })
    return id
  }
  /** A seat's name, as others read it over its head. */
  nameOf(id: number) {
    return this.seats.get(id)?.name ?? 'someone'
  }
  rename(id: number, name: string) {
    const seat = this.seats.get(id), spec = seat && this.specs.get(seat.toy)
    if (!seat || !spec || !name) return false
    seat.name = spec.label = name
    return true
  }
  /** Which felt figure a seat is drawn as, and its scarf's colour with it: a page that was here before asks to be who it was. */
  wear(id: number, plush: number) {
    const seat = this.seats.get(id), spec = seat && this.specs.get(seat.toy)
    if (!seat || !spec || !Number.isInteger(plush) || plush < 0 || plush > 255) return false
    seat.plush = plush
    spec.parts[0].paint = SEAT_COLORS[plush % SEAT_COLORS.length]
    return true
  }
  lookOf(id: number) {
    const seat = this.seats.get(id)
    return seat ? { plush: seat.plush, paint: this.specs.get(seat.toy)?.parts[0].paint } : {}
  }
  /** Walks a seat by the world's own hand (an agent's seat: it says where to go, not which keys are down). Null lets its own inputs walk it again. */
  drive(id: number, to: { x: number; z: number; jump: boolean } | null) {
    const seat = this.seats.get(id)
    if (seat) seat.driven = to ?? undefined
  }

  /** Who and what is on the street. */
  seen(): Seen {
    const residents = [...this.seats].map(([id, seat]) => ({ id, name: seat.name, at: this.world.thing(seat.body)?.position ?? [0, 0, 0] as Vec3 }))
    const things = [...this.made].map(([id, thing]) => {
      const part = thing.toy.parts.find((p) => p.motion === 'dynamic') ?? thing.toy.parts[0]
      const t = this.world.thing(`${id}/${part.id}`)
      const half = t?.shape.kind === 'box' ? t.shape.half : [0.5, 0.5, 0.5] as Vec3
      return { id, what: thing.toy.label, askedFor: thing.text, by: thing.by, at: t?.position ?? thing.toy.frame.at, size: half.map((h) => +(h * 2).toFixed(2)) as Vec3, material: part.material, moves: part.motion === 'dynamic' }
    })
    const cargo = this.specs.get('cargo')?.parts ?? []
    const still = [
      ...HOUSES.map((house) => ({ what: house.label, at: house.frame.at })),
      ...FURNITURE.parts.filter((p) => !p.id.startsWith('barrier')).map((p) => ({ what: p.id.startsWith('lamp') ? 'a street lamp' : p.id.startsWith('tree') ? 'a tree' : p.id.startsWith('palm') ? 'a palm tree' : p.id === 'hydrant' ? 'a hydrant' : p.id.startsWith('stop') ? 'a stop sign' : p.id.startsWith('newsbox') ? 'a newspaper box' : p.id === 'cabinet' ? 'a utility cabinet' : 'a letter box', at: p.at })),
      ...BINS.parts.map((p) => ({ what: `${p.id.startsWith('wheelie') ? 'a wheelie bin' : 'a steel bin'} (it can be knocked over)`, at: this.world.thing(`bins/${p.id}`)?.position ?? p.at })),
      ...PARKED.map((p) => ({ what: `a parked ${p.kind === 'hatch' ? 'hatchback' : p.kind === 'pickup' ? 'pickup truck' : p.kind}, ${CAR_KINDS[p.kind].long} m long`, at: this.world.thing(`cars/${p.id}`)?.position ?? [p.across, 0, p.along] as Vec3 })),
    ]
    return { residents, things, loose: { crates: cargo.filter((p) => p.id.startsWith('crate-')).length, balls: cargo.filter((p) => p.id.startsWith('ball-')).length }, still }
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
      const input = seat.driven ? { seq: 0, ...seat.driven } : next ?? { ...seat.last, jump: false }
      if (seat.driven) seat.driven.jump = false
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

  /** A ball that reached the bottom, or came to rest while someone is here, goes back to the top: the hill never goes still under a resident. With nobody here but those the world walks, the balls rest where they stop and so does the world. */
  private roll() {
    if (![...this.seats.values()].some((seat) => !seat.cast)) return
    for (const pose of this.world.poses(true)) {
      if (!pose.key.startsWith('cargo/ball-')) continue
      if (pose.position[2] < HALF_L - 3 && pose.awake) continue
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
    const seat = [...this.seats.values()].find((x) => x.toy === toy.id)
    return { toy: { ...toy, gadgets: [], wires: [], inputs: {} }, ids, poses, ...(seat ? { plush: seat.plush } : {}) }
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
