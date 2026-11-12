// The physics engine's world (#74), with no app imports. It builds toys (parts, gadgets,
// wires) into solver bodies and three.js meshes, runs gadgets through their kinds' hooks
// (gadgets.ts) and carries their signals along wires, binds bodies to scene objects drawn
// elsewhere (the home's furniture: the object moved by its owner moves the body, a dynamic
// body moves the object), drives followers (a walking person's body, pushing with finite
// strength), applies the world rules, guards against explosions, and reports what happens as
// events. It implements the engine API (api.ts).
// Fixed 60 Hz steps of simulated time; gadget actions run after each solver step.
import * as THREE from 'three/webgpu'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { Gadget, Snapshot, ThingInfo, Touch, WorldApi } from './api'
import type { BodyId, Contact, PhysicsCore, Quat, Shape, Vec3 } from './core'
import type { At, PhysicsEvent } from './events'
import { digits, gadgetKind } from './gadgets'
import { material, materialNames, materialsVersion } from './materials'
import { checkRules, NORMAL, onRuleAdded, presetRules, type Rules } from './rules'
import { checkToy, WORLD_BOUND, type CellsSpec, type PartSpec, type Signal, type ToySpec } from './toy'
import { boxesOf, drop, fillSphere, loosened, pack, solidCells, take, takeSphere, unpack, weigh, type Box as CellBox, type Voxels } from './voxels'

/** The drawn look a part wears: one per material and paint, and one per material for parts made of pieces (their paints are in the mesh). */
const lookKey = (part: PartSpec) => (part.pieces ? `${part.material}:pieces` : `${part.material}:${part.paint ?? ''}`)

const STEP = 1 / 60
const MAX_STEPS = 4
/** Below this (N·s, after the impact rule) an impact is not reported. */
const IMPACT_MIN = 0.003
/** Below the floor by this much, a thing has fallen out of the world and is put back. */
const LOST = 1
const STRIDE = 0.32
/** A follower whose body is this far (m) from its figure jumped (a hop, a seat, a squeeze past): its body follows without touching anything. */
const JUMP = 0.5
/** A follower's body this far (m, across the floor) behind its figure is held back by something it cannot push. */
const HELD_LAG = 0.08
/** Behind and pushed back this long (s) is held: a bump that slows it for a moment is not. */
const HELD_AFTER = 0.2
/** Held this long (s), a follower stops saying so and walks on: its body catches up by a jump. */
const HELD_MAX = 1.5
/** A follower's body stands this far (m) off the floor: it pushes what stands on the floor, but never scrapes the floor itself. */
const CLEAR = 0.03
/** The fastest a follower's body chases its figure, m/s. */
const CHASE = 4
/** A figure standing still is drifted to at this rate (1/s), at most SETTLE_MAX m/s. */
const SETTLE = 3
const SETTLE_MAX = 0.5
/** Contact taking back over this share of the most a step's chase may add to a follower's speed pushes it back. */
const PUSHED_BACK = 0.5
/** A bound object moved by its owner further than this (m, or radians) puts its body there. */
const MOVED = 1e-4
/** Gadget signals carried along wires per step; the rest wait for the next step. */
const SIGNALS_PER_STEP = 200
/** Signals waiting past this are dropped (a loop of wires feeding itself faster than it drains). */
const SIGNALS_WAITING = 1000
/** A signal more than this many wires away from a physical cause is dropped: a loop of wires feeding itself ends here however slowly it fills the queue. */
const SIGNAL_HOPS = 64
/** The longest hit-stop (real seconds), and the rest (ms) after one before the next may start: a held world never stutters. */
const HOLD_MAX = 0.15
const HOLD_REST = 250
/** A lit lamp's emissive strength (glow level 1). */
const GLOW = 1.4

interface Thing {
  key: string
  toy: string
  part: PartSpec
  /** Its body. A still part of cells has one body for each chunk of it that has cells; this is one of them (or a stand-in that touches nothing, when it has none). */
  body: BodyId
  mesh?: THREE.Mesh
  home: { p: Vec3; q: Quat }
  wobble: number
  cells?: Cells
}

/** A part's cells as the world holds them (#138). */
interface Cells {
  v: Voxels
  /** The block's low corner in the part's frame, m. */
  low: Vec3
  held: number
  /** A still part: the body of each chunk that has cells, by the chunk's number. */
  chunks: Map<number, BodyId>
  /** A moving part that still collides as its part's own shape: it has not been cut. */
  smooth: boolean
  /** How many cells it had when it was made (a part with a set mass loses it in proportion). */
  made: number
}
/** Cells a side of the piece of a still block that one body stands for: a blow rebuilds only the chunks it touched. */
const CHUNK = 32
/** A piece that comes loose with fewer cells than this is dust: it is gone, not a thing. */
const CRUMB = 10

/** What a cut did to a block, as whoever keeps a copy of the block needs it to do the same (applyCut). Whole numbers of cells. */
export interface CutRecord {
  thing: string
  at: Vec3
  r: number
  kind: number
  /** How ragged the hole's edge is (0 a clean ball, towards 1 very), and the number its raggedness is worked out from. */
  rough: number
  seed: number
  /** The lowest layers left alone: a still thing's footing. */
  keep: number
  /** Cells that came loose too small to be things, by their number in the block. */
  gone: number[]
  /** Pieces that came loose: each one's low corner in the block and its own cells. */
  took: { low: Vec3; size: [number, number, number]; data: string }[]
}
/** A piece that came loose from a block: its cells and where it is. Whoever asked for the cut makes a toy of it (bitToy). */
export interface Bit { cells: CellsSpec; material: string; position: Vec3; rotation: Quat; velocity: Vec3 }

/** A loose piece as a toy of one moving part. */
export function bitToy(id: string, label: string, bit: Bit): ToySpec {
  const e = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(bit.rotation[0], bit.rotation[1], bit.rotation[2], bit.rotation[3]), 'YXZ')
  const half = bit.cells.size.map((n) => (n * bit.cells.cell) / 2) as Vec3
  return { id, label, frame: { at: bit.position, yaw: e.y, tilt: e.x, roll: e.z }, gadgets: [], wires: [], inputs: {}, parts: [{ id: 'bit', shape: { kind: 'box', half }, material: bit.material, motion: 'dynamic', at: [0, 0, 0], cells: bit.cells }] }
}

interface Follower { key: string; object: THREE.Object3D; body: BodyId; lift: number; radius: number; material: string; mass: number; last: THREE.Vector3; walked: number; left: boolean; solid: boolean; heldFor: number; aim: THREE.Vector3; passing: boolean; sent: Vec3 }

/** A body that stands for a scene object drawn by someone else (src/physics/home.ts binds the home's things). */
interface Bound { key: string; object: THREE.Object3D; body: BodyId; material: string; motion: 'static' | 'dynamic'; shape: Shape; outline: Shape; p: THREE.Vector3; q: THREE.Quaternion; home: { p: Vec3; q: Quat }; parts?: BindSpec['parts']; woke?: () => void; slept?: (home: boolean) => void }
/** A thing held by a hand (carry): where it is drawn to, and the most force that draws it. */
interface Hold { to: Vec3; strength: number; arc: number }
/** How fast (1/s) a held thing closes on where it is held to, its top speed (m/s), and how fast it is turned upright (1/s). */
const HOLD_RATE = 14
const HOLD_SPEED = 5
const HOLD_UPRIGHT = 9
/** A moving bound thing that comes to rest within this (m) of where it was made counts as home. */
const NEARLY_HOME = 0.012

export interface BindSpec {
  /** In the object's frame (its world position and turn), at world scale. */
  shape: Shape
  motion: 'static' | 'dynamic'
  material: string
  /** kg, dynamic only: in place of density × volume. */
  mass?: number
  /**
   * Named parts of a compound, each its own material for heat and fire (a merged kit's sofa is felt,
   * its stove steel): indices into shape.boxes. Boxes no part names burn as the thing's material.
   */
  parts?: { name: string; material: string; boxes: number[] }[]
  /** Where it was made, when that is not where it is now (a thing bound again while it lies thrown): tidying puts it there. */
  home?: { p: Vec3; q: Quat }
  /** Called when its body starts to move (a hand, a bump) and when it has come to rest again: a thing drawn cheaply at rest draws itself in full while it moves (src/kit.ts). */
  woke?: () => void
  /** `home`: it rests where it was made, to the eye. */
  slept?: (home: boolean) => void
}

/** A part that can take heat, in world space: what fire.ts keeps a temperature, fuel and wetness for. */
export interface Burnable {
  /** `thing` or `thing:part`. */
  id: string
  thing: string
  /** Its name in the thing, '' for the whole thing. */
  part: string
  material: string
  /** The box round it, world space (axis-aligned). */
  center: Vec3
  half: Vec3
  /** It moves (a dynamic body): its box is read again as it goes. */
  moving: boolean
}

/** What World needs of fire.ts (kept apart so the world runs without fire). */
export interface Burner {
  ignite(thing: string, part: string | undefined, by: 'ask' | 'gadget' | 'code'): string | null
  douse(thing: string, part: string | undefined, by: 'ask' | 'gadget' | 'code'): string | null
  burning(thing: string): boolean
  rain(seconds: number): string | null
  strike(thing: string, part: string | undefined): string | null
  snapshot(): unknown
  restore(s: unknown): string[]
}

export interface Stats { stepMs: { median: number; p95: number; n: number }; frameMs: { median: number; p95: number; n: number }; bodies: number; followers: number; static: number; dynamic: number }

/** Paints a wood grain texture for a material's colour; the host app may supply one. */
export type Grain = (seed: number, light: [number, number, number], dark: [number, number, number], knots: number, planks: number) => THREE.Texture

const v3 = (a: Vec3) => new THREE.Vector3(a[0], a[1], a[2])
const arr = (p: THREE.Vector3): Vec3 => [p.x, p.y, p.z]
const at = (p: Vec3): At => ({ x: p[0], y: p[1], z: p[2] })
/** A point is finite and inside the world; a direction is finite and not zero. */
const pointOk = (p: Vec3) => Array.isArray(p) && p.length === 3 && p.every((x) => Number.isFinite(x) && Math.abs(x) <= WORLD_BOUND)
const dirOk = (d: Vec3) => Array.isArray(d) && d.length === 3 && d.every(Number.isFinite) && Math.hypot(...d) > 1e-9
const limitsOk = (l: [number, number]) => Array.isArray(l) && l.length === 2 && l.every(Number.isFinite) && l[0] <= l[1]
/** A compound as the one box round it (in its frame, ignoring its parts' turns): what an event says of its size. */
const outline = (shape: Shape): Shape => {
  if (shape.kind !== 'compound') return shape
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
  for (const b of shape.boxes) for (let i = 0; i < 3; i++) {
    lo[i] = Math.min(lo[i], b.at[i] - b.half[i])
    hi[i] = Math.max(hi[i], b.at[i] + b.half[i])
  }
  return { kind: 'box', half: [0, 1, 2].map((i) => +((hi[i] - lo[i]) / 2).toFixed(3)) as Vec3 }
}
const poseM = new THREE.Matrix4(), parentM = new THREE.Matrix4(), ONE = new THREE.Vector3(1, 1, 1), poseS = new THREE.Vector3(), scratchS = new THREE.Vector3()
const corner = new THREE.Vector3(), box3 = new THREE.Box3(), boxPose = new THREE.Matrix4(), partPose = new THREE.Matrix4()
/** Grows `into` by a box (half extents, at, turn in a frame) carried by `pose` (that frame to the world). */
function growBy(into: THREE.Box3, pose: THREE.Matrix4, half: Vec3, at: Vec3, rotation: Quat) {
  partPose.compose(v3(at), new THREE.Quaternion(rotation[0], rotation[1], rotation[2], rotation[3]), new THREE.Vector3(1, 1, 1)).premultiply(pose)
  for (let i = 0; i < 8; i++) into.expandByPoint(corner.set(i & 1 ? half[0] : -half[0], i & 2 ? half[1] : -half[1], i & 4 ? half[2] : -half[2]).applyMatrix4(partPose))
}
export const halfOf = (shape: Shape): Vec3 => shape.kind === 'box' ? shape.half : shape.kind === 'sphere' ? [shape.radius, shape.radius, shape.radius]
  : shape.kind === 'compound' ? (outline(shape) as { half: Vec3 }).half : [shape.radius, shape.halfHeight + (shape.kind === 'capsule' ? shape.radius : 0), shape.radius]
const quantile = (xs: number[], q: number) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return +s[Math.min(s.length - 1, Math.floor(s.length * q))].toFixed(3)
}

export class World implements WorldApi {
  readonly group = new THREE.Group()
  private things = new Map<string, Thing>()
  private byBody: (Thing | Follower | Bound | undefined)[] = []
  private gadgets = new Map<string, Gadget>()
  private byPart = new Map<string, Gadget[]>()
  private wires = new Map<string, string[]>()
  private frames = new Map<string, THREE.Matrix4>()
  private joints = new Map<string, number[]>()
  private droppedAt = -1
  private inputs = new Set<string>()
  private queue: { from: string; signal: Signal; hops: number }[] = []
  /** How many wires the signal being delivered has crossed; 0 outside delivery. */
  private hops = 0
  private respawns = new Map<string, number>()
  private followers = new Map<string, Follower>()
  private bound = new Map<string, Bound>()
  /** Bound moving things whose bodies are awake: the only ones a step or a frame looks at. */
  private stirring = new Set<Bound>()
  private holds = new Map<Bound, Hold>()
  private gravitySet = false
  /** Bound moving things posed (by their body, a tidy, or their owner) since fire last read the moving ones. */
  private posed = new Set<Bound>()
  private pairs = new Map<string, readonly [number, number]>()
  private pairsVersion = -1
  private clampedAt = new Map<string, number>()
  private dust: { mesh: THREE.Mesh; life: number; v: THREE.Vector3 }[] = []
  /** A part's face drawn as a card (a score): its canvas, texture and material, and the text it should show next frame when changed. */
  private displays = new Map<string, { canvas: HTMLCanvasElement; texture: THREE.CanvasTexture; material: THREE.MeshStandardMaterial; text: string; drawn: string | null }>()
  /** What each card says, page or no page. */
  private cards = new Map<string, string>()
  private looks = new Map<string, THREE.Material>()
  /** A part that glows (a lamp) is drawn with a material of its own: the looks are shared by every part of a material and paint. */
  private glows = new Map<string, THREE.MeshStandardMaterial>()
  /** Per toy, its scenery: the parts drawn together, one mesh per look (see build). */
  private scenery = new Map<string, THREE.Mesh[]>()
  private tally = new Map<string, number>()
  private accumulator = 0
  /** Bumped whenever a thing is added or taken away: fire.ts reads burnables() again. */
  version = 0
  /** Fire and heat (fire.ts), when the host runs them: ignite, douse and snapshots go through it. */
  burner?: Burner
  private stepTimes: number[] = []
  private frameTimes: number[] = []
  clock = 0
  /** Set by dispose(): the solver is freed, so nothing may touch it again. */
  disposed = false
  rules: Rules = { ...NORMAL, gravity: [...NORMAL.gravity] }
  private unsubscribe: () => void

  /** The lowest ground there is, m: the home's floor is 0, a street falls below it. A thing well under it is lost, and nothing is moved below it. Followers still take the floor to be 0 (off it they touch nothing, and their footsteps are said at 0). */
  private floor: number

  /** `emit` receives every event; `grain`, when given, paints wood (else wood is flat colour); `floor` is the height of the lowest ground. */
  /** Whether this world's solver solves: a world that only shows another's (the street's page) builds no shapes for cells to collide as. */
  private solid: boolean

  constructor(private core: PhysicsCore, private emit: (e: PhysicsEvent) => void, private grain?: Grain, floor = 0) {
    this.solid = core.name !== 'puppet'
    this.floor = floor
    this.group.name = 'physics'
    core.setCombine((a, b) => this.combine(a, b))
    this.applyRules(this.rules)
    // A rule registered after this world started reads as its default here too.
    this.unsubscribe = onRuleAdded((name, value) => {
      if (!Object.hasOwn(this.rules, name)) this.rules[name] = value
    })
    const dustMat = new THREE.MeshStandardMaterial({ color: '#e9dcc4', roughness: 1, transparent: true, opacity: 0.45, depthWrite: false })
    const dustGeo = new THREE.SphereGeometry(1, 8, 6)
    for (let i = 0; i < 24; i++) {
      const mesh = new THREE.Mesh(dustGeo, dustMat)
      mesh.visible = false
      this.group.add(mesh)
      this.dust.push({ mesh, life: 0, v: new THREE.Vector3() })
    }
  }

  // ── Rules ────────────────────────────────────────────────────────────────

  setRules(raw: unknown, by: Extract<PhysicsEvent, { kind: 'rules' }>['by'], preset?: string): { ok: true; rules: Rules; clamped: string[] } | { ok: false; reason: string } {
    if (this.disposed) return { ok: false, reason: 'the world has stopped' }
    const checked = checkRules(raw, this.rules)
    if ('reason' in checked) return { ok: false, reason: checked.reason }
    this.applyRules(checked.rules)
    this.emit({ kind: 'rules', rules: this.rules, by, ...(preset ? { preset } : {}), clamped: checked.clamped })
    return { ok: true, rules: this.rules, clamped: checked.clamped }
  }

  preset(name: string) {
    const rules = presetRules(name)
    if (!rules) return { ok: false as const, reason: `no preset ${name}` }
    return this.setRules(rules, 'preset', name)
  }

  private applyRules(next: Rules) {
    // Changing gravity wakes every moving body (a sleeping one would not feel it); the same gravity again wakes none.
    const same = this.gravitySet && next.gravity.every((g, i) => g === this.rules.gravity[i])
    this.rules = { ...next, gravity: [...next.gravity] }
    if (!same) this.core.setGravity(this.rules.gravity)
    this.gravitySet = true
    this.core.setRestSpeed(this.rules.rest)
    this.pairsVersion = -1
    for (const t of this.things.values()) if (t.part.motion === 'dynamic') this.core.setLinearDamping(t.body, this.rules.drag)
    for (const b of this.bound.values()) if (b.motion === 'dynamic') this.core.setLinearDamping(b.body, this.rules.drag)
  }

  /** Village's combine per pair: geometric friction, the livelier restitution, both scaled by the rules. Cached per material pair. */
  private combine(a: BodyId, b: BodyId): readonly [number, number] {
    if (this.pairsVersion !== materialsVersion()) {
      this.pairs.clear()
      this.pairsVersion = materialsVersion()
    }
    const ma = this.materialOf(a), mb = this.materialOf(b)
    const key = ma < mb ? `${ma}|${mb}` : `${mb}|${ma}`
    let pair = this.pairs.get(key)
    if (!pair) {
      const x = material(ma), y = material(mb)
      pair = x && y ? [Math.sqrt(x.friction * y.friction) * this.rules.friction, Math.min(1.2, Math.max(x.restitution, y.restitution) * this.rules.bounce)] : [0.5, 0.3]
      this.pairs.set(key, pair)
    }
    return pair
  }

  private materialOf(body: BodyId) {
    const t = this.byBody[body]
    return t ? ('part' in t ? t.part.material : t.material) : ''
  }

  // ── Building ─────────────────────────────────────────────────────────────

  /**
   * Builds a toy, all or nothing: it throws, leaving nothing of it behind, for numbers that
   * cannot be built (toy.ts checkToy), an id already built, an unknown material, gadget kind or
   * part, or a gadget whose setup fails.
   */
  addToy(toy: ToySpec) {
    const bad = checkToy(toy)
    if (bad) throw new Error(bad)
    if (this.frames.has(toy.id)) throw new Error(`${toy.id}: a toy with this id is already built`)
    for (const part of toy.parts) {
      if (!material(part.material)) throw new Error(`${toy.id}/${part.id}: no material ${part.material}`)
      for (const kind of part.cells?.kinds ?? []) if (!material(kind.material)) throw new Error(`${toy.id}/${part.id}: no material ${kind.material}`)
    }
    for (const g of toy.gadgets) {
      if (!gadgetKind(g.kind)) throw new Error(`${toy.id}/${g.id}: no gadget kind ${g.kind}`)
      if (g.part !== undefined && !toy.parts.some((p) => p.id === g.part)) throw new Error(`${toy.id}/${g.id}: no part ${g.part}`)
    }
    try {
      this.build(toy)
    } catch (error) {
      this.removeToy(toy.id)
      throw error
    }
  }

  private build(toy: ToySpec) {
    const frame = new THREE.Matrix4().compose(v3(toy.frame.at), new THREE.Quaternion().setFromEuler(new THREE.Euler(toy.frame.tilt, toy.frame.yaw, toy.frame.roll ?? 0, 'YXZ')), new THREE.Vector3(1, 1, 1))
    this.frames.set(toy.id, frame)
    const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3()
    // Scenery: a part that never moves, that no gadget names and that is not the toy's handle is
    // drawn merged with the toy's other scenery of its look, one mesh (and one draw per pass) per
    // look instead of one per part. It has no mesh of its own: world.mesh() finds nothing for it
    // and it does not wobble when hit.
    const named = new Set(toy.gadgets.flatMap((g) => Object.values(g).filter((v): v is string => typeof v === 'string')))
    if (toy.handle) named.add(toy.handle)
    const merged = new Map<string, { look: THREE.Material; parts: THREE.BufferGeometry[] }>()
    for (const part of toy.parts) {
      m.compose(v3(part.at), new THREE.Quaternion().setFromEuler(new THREE.Euler(...(part.turn ?? [0, 0, 0]))), new THREE.Vector3(1, 1, 1))
      m.premultiply(frame).decompose(p, q, s)
      const mat = material(part.material)!
      const home = { p: arr(p), q: [q.x, q.y, q.z, q.w] as Quat }
      const thing: Thing = { key: `${toy.id}/${part.id}`, toy: toy.id, part, body: -1, home, wobble: 0 }
      if (part.cells) {
        const c = part.cells, v = unpack(c.size, c.cell, c.kinds, c.data)
        thing.cells = { v, low: [...c.low], held: c.held ?? 0, chunks: new Map(), smooth: c.smooth === true, made: solidCells(v) }
      }
      if (thing.cells && this.solid && !(thing.cells.smooth && part.motion === 'dynamic')) this.collide(thing)
      else thing.body = this.core.addBody({
        shape: part.shape, motion: part.motion ?? 'static', position: home.p, rotation: home.q,
        density: mat.density, friction: mat.friction, restitution: mat.restitution, linearDamping: this.rules.drag, sensor: part.sensor, ...(part.mass !== undefined ? { mass: part.mass } : {}), ...(part.upright ? { upright: true } : {}),
      })
      const body = thing.body
      // Cells are drawn by whoever draws this world (cellsOf): the world keeps them and what they collide as.
      if (part.cells) {
        // Nothing to draw here.
      } else if (!part.hidden && (part.motion ?? 'static') === 'static' && !named.has(part.id) && !part.pieces) {
        const look = this.look(part)
        const key = this.lookKey(part)
        const group = merged.get(key) ?? merged.set(key, { look, parts: [] }).get(key)!
        group.parts.push(this.geometry(part.shape).applyMatrix4(m))
      } else if (!part.hidden) {
        thing.mesh = new THREE.Mesh(part.pieces ? this.piecesGeometry(part) : this.geometry(part.shape), this.look(part))
        thing.mesh.name = thing.key
        thing.mesh.position.copy(p)
        thing.mesh.quaternion.copy(q)
        // A trigger volume that is drawn (a light set into a playfield) is not a solid thing: it casts no shadow.
        thing.mesh.castShadow = !part.sensor
        thing.mesh.receiveShadow = true
        this.group.add(thing.mesh)
      }
      this.things.set(thing.key, thing)
      this.byBody[body] = thing
    }
    const scenery: THREE.Mesh[] = []
    this.scenery.set(toy.id, scenery)
    for (const [key, { look, parts }] of merged) {
      const geometry = parts.length > 1 ? mergeGeometries(parts) : parts[0]
      if (parts.length > 1) for (const g of parts) g.dispose()
      if (!geometry) throw new Error(`${toy.id}: its ${key} parts could not be drawn together`)
      const mesh = new THREE.Mesh(geometry, look)
      mesh.name = `${toy.id} scenery ${key}`
      mesh.castShadow = mesh.receiveShadow = true
      this.group.add(mesh)
      scenery.push(mesh)
    }
    for (const spec of toy.gadgets) {
      const kind = gadgetKind(spec.kind)!
      const knobs: Record<string, number> = {}
      for (const [name, k] of Object.entries(kind.knobs)) {
        const v = spec.knobs?.[name]
        knobs[name] = typeof v === 'number' && Number.isFinite(v) ? Math.min(k.max, Math.max(k.min, v)) : k.default
      }
      const g: Gadget = { id: `${toy.id}/${spec.id}`, toy: toy.id, spec, knobs, state: {}, ...(spec.part ? { part: `${toy.id}/${spec.part}` } : {}) }
      this.gadgets.set(g.id, g)
      if (g.part) this.byPart.set(g.part, [...(this.byPart.get(g.part) ?? []), g])
      kind.setup?.(g, this)
    }
    for (const w of toy.wires) {
      const from = `${toy.id}/${w.from}`
      this.wires.set(from, [...(this.wires.get(from) ?? []), `${toy.id}/${w.to}`])
    }
    this.version++
  }

  /** How much is built: things, gadgets, joints, wired outputs and drawn looks (to see that taking a toy out leaves nothing behind). */
  census() {
    let joints = 0
    for (const list of this.joints.values()) joints += list.length
    return { things: this.things.size, gadgets: this.gadgets.size, joints, wires: this.wires.size, looks: this.looks.size, displays: this.displays.size, glows: this.glows.size, draws: this.draws, toys: this.frames.size }
  }

  /** Whether a toy with this id is built. */
  hasToy(id: string) {
    return this.frames.has(id)
  }

  /** Everything of a toy out of the world again: joints, bodies, meshes, gadgets, wires, displays. */
  removeToy(id: string) {
    this.version++
    const lookOf = (part: PartSpec) => this.lookKey(part)
    const itsLooks = new Set([...this.things.values()].filter((t) => t.toy === id).map((t) => lookOf(t.part)))
    for (const joint of this.joints.get(id) ?? []) this.core.removeJoint(joint)
    this.joints.delete(id)
    for (const [key, t] of this.things) {
      if (t.toy !== id) continue
      for (const body of this.bodiesOf(t)) {
        this.core.removeBody(body)
        this.byBody[body] = undefined
      }
      if (t.mesh) {
        this.group.remove(t.mesh)
        t.mesh.geometry.dispose()
      }
      this.things.delete(key)
      this.respawns.delete(key)
      this.clampedAt.delete(key)
    }
    for (const [gid, g] of this.gadgets) {
      if (g.toy !== id) continue
      this.gadgets.delete(gid)
      if (g.part) {
        const rest = (this.byPart.get(g.part) ?? []).filter((o) => o !== g)
        if (rest.length) this.byPart.set(g.part, rest)
        else this.byPart.delete(g.part)
      }
    }
    const mine = (key: string) => key.startsWith(`${id}/`)
    for (const key of [...this.wires.keys()].filter(mine)) this.wires.delete(key)
    for (const key of [...this.tally.keys()].filter(mine)) this.tally.delete(key)
    for (const key of [...this.cards.keys()].filter(mine)) this.cards.delete(key)
    for (const [key, d] of this.displays) {
      if (!mine(key)) continue
      d.texture.dispose()
      d.material.dispose()
      this.displays.delete(key)
    }
    for (const [key, glow] of this.glows) {
      if (!mine(key)) continue
      glow.dispose()
      this.glows.delete(key)
    }
    for (const mesh of this.scenery.get(id) ?? []) {
      this.group.remove(mesh)
      mesh.geometry.dispose()
    }
    this.scenery.delete(id)
    this.frames.delete(id)
    // A drawn look (and its painted grain) only this toy used goes with it: made toys come in many colours.
    // Still worn by a part that is drawn: a hidden part of the same material and paint has no look to keep.
    for (const t of this.things.values()) if (!t.part.hidden) itsLooks.delete(lookOf(t.part))
    for (const key of itsLooks) {
      const look = this.looks.get(key) as THREE.MeshStandardMaterial | undefined
      if (!look) continue
      look.map?.dispose()
      look.dispose()
      this.looks.delete(key)
    }
  }

  // ── Cells (#138) ─────────────────────────────────────────────────────────

  /** Every body that stands for a thing: its one body, or a still block of cells' chunks. */
  private bodiesOf(t: Thing): BodyId[] {
    return t.cells?.chunks.size ? [...t.cells.chunks.values()] : t.body >= 0 ? [t.body] : []
  }

  /** The boxes of some cells as a shape in the part's frame. */
  private cellShape(c: Cells, within?: CellBox): Shape | null {
    const boxes = boxesOf(c.v, within), cell = c.v.cell
    if (!boxes.length) return null
    const out: Extract<Shape, { kind: 'compound' }>['boxes'] = []
    for (let i = 0; i < boxes.length; i += 6) out.push({
      half: [((boxes[i + 3] - boxes[i]) * cell) / 2, ((boxes[i + 4] - boxes[i + 1]) * cell) / 2, ((boxes[i + 5] - boxes[i + 2]) * cell) / 2],
      at: [c.low[0] + ((boxes[i] + boxes[i + 3]) * cell) / 2, c.low[1] + ((boxes[i + 1] + boxes[i + 4]) * cell) / 2, c.low[2] + ((boxes[i + 2] + boxes[i + 5]) * cell) / 2],
      rotation: [0, 0, 0, 1],
    })
    return { kind: 'compound', boxes: out }
  }

  /**
   * What a thing of cells collides as, built or built again from its cells. A still one: a body
   * for each chunk in `within` (all of it when not said). A moving one: one body of all its
   * cells, where the old one was and moving as it did.
   */
  private collide(t: Thing, within?: CellBox) {
    const c = t.cells!, mat = material(t.part.material)!, [nx, ny, nz] = c.v.size
    const common = { density: mat.density, friction: mat.friction, restitution: mat.restitution }
    if ((t.part.motion ?? 'static') === 'static') {
      const b = within ?? [0, 0, 0, nx, ny, nz], across = Math.ceil(nx / CHUNK), deep = Math.ceil(nz / CHUNK)
      const was = this.byBody[t.body] === t && !c.chunks.size ? t.body : -1
      for (let cy = Math.floor(b[1] / CHUNK); cy * CHUNK < b[4]; cy++) for (let cz = Math.floor(b[2] / CHUNK); cz * CHUNK < b[5]; cz++) for (let cx = Math.floor(b[0] / CHUNK); cx * CHUNK < b[3]; cx++) {
        const n = cx + across * (cz + deep * cy), old = c.chunks.get(n)
        if (old !== undefined) { this.core.removeBody(old); this.byBody[old] = undefined; c.chunks.delete(n) }
        const shape = this.cellShape(c, [cx * CHUNK, cy * CHUNK, cz * CHUNK, (cx + 1) * CHUNK, (cy + 1) * CHUNK, (cz + 1) * CHUNK])
        if (!shape) continue
        const body = this.core.addBody({ shape, motion: 'static', position: t.home.p, rotation: t.home.q, ...common })
        c.chunks.set(n, body)
        this.byBody[body] = t
      }
      // What rested on cells that have gone must fall: a sleeping body is not told its floor went, so wake whatever is in the box that changed (a walker standing still over a blast stayed in the air).
      if (within) {
        const turn = new THREE.Quaternion(t.home.q[0], t.home.q[1], t.home.q[2], t.home.q[3]), lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity], at = new THREE.Vector3()
        for (let i = 0; i < 8; i++) {
          at.set(c.low[0] + b[i & 1 ? 3 : 0] * c.v.cell, c.low[1] + b[i & 2 ? 4 : 1] * c.v.cell, c.low[2] + b[i & 4 ? 5 : 2] * c.v.cell).applyQuaternion(turn)
          for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], t.home.p[k] + at.getComponent(k) - 1.2); hi[k] = Math.max(hi[k], t.home.p[k] + at.getComponent(k) + 1.2) }
        }
        this.core.wakeIn(lo, hi)
      }
      if (c.chunks.size) {
        // The stand-in goes once there is a real body; the thing's own body is any of its chunks'.
        if (was >= 0) { this.core.removeBody(was); this.byBody[was] = undefined }
        if (![...c.chunks.values()].includes(t.body)) t.body = c.chunks.values().next().value!
      } else if (was < 0) {
        // Nothing left of it: a stand-in that touches nothing keeps its place.
        t.body = this.core.addBody({ shape: { kind: 'sphere', radius: 0.01 }, motion: 'static', position: t.home.p, rotation: t.home.q, ...common })
        this.core.setSolid(t.body, false)
        this.byBody[t.body] = t
      }
      return
    }
    const shape = this.cellShape(c)
    if (!shape) return
    const weight = weigh(c.v, (k) => material(k.material)?.density ?? mat.density).mass
    const mass = t.part.mass !== undefined ? Math.max(0.001, (t.part.mass * solidCells(c.v)) / Math.max(1, c.made)) : Math.max(0.001, weight)
    const old = t.body
    const pose = old >= 0 ? { position: this.core.position(old), rotation: this.core.rotation(old), velocity: this.core.velocity(old), spin: this.core.angularVelocity(old) } : { position: t.home.p, rotation: t.home.q, velocity: [0, 0, 0] as Vec3, spin: [0, 0, 0] as Vec3 }
    if (old >= 0) { this.core.removeBody(old); this.byBody[old] = undefined }
    // Not swept along its path: a body of many boxes cast against chunks of many boxes cost steps of half a second (street/test/voxel-blows.mjs).
    t.body = this.core.addBody({ shape, motion: 'dynamic', position: pose.position, rotation: pose.rotation, velocity: pose.velocity, mass, linearDamping: this.rules.drag, swept: false, ...common })
    this.core.setAngularVelocity(t.body, pose.spin)
    this.byBody[t.body] = t
    c.smooth = false
  }

  /** A thing's cells, for whoever draws them or asks what is there: the block, its low corner in the part's frame, and the part's pose in the world now. */
  cellsOf(key: string): { v: Voxels; low: Vec3; position: Vec3; rotation: Quat; moves: boolean } | null {
    const t = this.things.get(key)
    if (!t?.cells) return null
    const moves = (t.part.motion ?? 'static') !== 'static'
    return { v: t.cells.v, low: t.cells.low, position: moves ? this.core.position(t.body) : t.home.p, rotation: moves ? this.core.rotation(t.body) : t.home.q, moves }
  }

  /** Every thing made of cells, by key. */
  cellKeys() {
    return [...this.things.values()].filter((t) => t.cells).map((t) => t.key)
  }

  /** A thing's part as it is now: its spec with its cells as they stand (a cut thing is not what it was made as). */
  partNow(key: string): PartSpec | null {
    const t = this.things.get(key)
    if (!t) return null
    return t.cells ? { ...t.part, cells: { ...t.part.cells!, data: pack(t.cells.v) } } : t.part
  }

  /**
   * Sets the cells of a thing within `r` cells of cell `at` to a kind of its own (0 takes them
   * out). What that cuts off from a still thing's footing, or from the rest of a moving thing,
   * comes loose: pieces big enough to be things are returned as bits (the caller makes toys of
   * them), smaller ones are gone. Null when nothing changed. `empty` says a moving thing has no
   * cells left and should be taken away.
   */
  cut(key: string, at: Vec3, r: number, kind = 0, rough = 0, lumps = 0, fling = 0): { record: CutRecord; bits: Bit[]; changed: number; empty: boolean } | null {
    const t = this.things.get(key), c = t?.cells
    if (!t || !c || ![...at, r, kind].every(Number.isInteger) || r < 0 || r > 64 || kind < 0 || kind > c.v.kinds.length) return null
    const seed = (Math.random() * 0x7fffffff) | 0
    const moves = (t.part.motion ?? 'static') !== 'static'
    // What a still thing stands on is never cut: a street's lowest layer is the bottom of the world.
    const keep = moves ? 0 : c.held
    const hit = fillSphere(c.v, at, r, kind, kind ? 'air' : 'solid', rough, seed, keep)
    if (!hit) return null
    const record: CutRecord = { thing: key, at, r, kind, rough, seed, keep, gone: [], took: [] }, bits: Bit[] = []
    const dirty: CellBox = [...hit.box]
    const [nx, , nz] = c.v.size, cell = c.v.cell
    const p = moves ? this.core.position(t.body) : t.home.p, q = moves ? this.core.rotation(t.body) : t.home.q, velocity = moves ? this.core.velocity(t.body) : [0, 0, 0] as Vec3
    const turn = new THREE.Quaternion(q[0], q[1], q[2], q[3])
    const most = (block: Voxels) => {
      const count = new Map<string, number>()
      for (let i = 0; i < block.cells.length; i++) if (block.cells[i]) { const m = block.kinds[block.cells[i] - 1].material; count.set(m, (count.get(m) ?? 0) + 1) }
      return [...count].sort((x, y) => y[1] - x[1])[0][0]
    }
    // Lumps knocked out of the hole's rim, thrown away from the blow: rubble that lies about and can be walked on.
    for (let i = 0; i < lumps; i++) {
      const a = Math.random() * Math.PI * 2, up = Math.random() * 1.6 - 0.8, flat = Math.sqrt(1 - Math.min(1, up * up) * 0.6), size = 2 + ((Math.random() * 2) | 0)
      const dir = [Math.cos(a) * flat, up * 0.75, Math.sin(a) * flat], reach = r + size - 1
      const mid: Vec3 = [Math.round(at[0] + dir[0] * reach), Math.round(at[1] + dir[1] * reach), Math.round(at[2] + dir[2] * reach)]
      const lump = takeSphere(c.v, mid, size, keep)
      if (!lump) continue
      const low: Vec3 = [mid[0] - size, mid[1] - size, mid[2] - size], side = 2 * size + 1
      for (let k = 0; k < 3; k++) { dirty[k] = Math.min(dirty[k], Math.max(0, low[k])); dirty[k + 3] = Math.max(dirty[k + 3], Math.min(c.v.size[k], low[k] + side)) }
      const data = pack(lump.block)
      record.took.push({ low, size: [side, side, side], data })
      if (lump.cells < CRUMB) continue
      const out = new THREE.Vector3(dir[0], dir[1], dir[2]).applyQuaternion(turn), where = new THREE.Vector3(c.low[0] + (mid[0] + 0.5) * cell, c.low[1] + (mid[1] + 0.5) * cell, c.low[2] + (mid[2] + 0.5) * cell).applyQuaternion(turn)
      const speed = fling * (0.5 + Math.random() * 0.7)
      bits.push({
        cells: { size: [side, side, side], cell, kinds: lump.block.kinds, data, low: [(-side * cell) / 2, (-side * cell) / 2, (-side * cell) / 2] },
        material: most(lump.block), position: [p[0] + where.x, p[1] + where.y, p[2] + where.z], rotation: [...q] as Quat, velocity: [velocity[0] + out.x * speed, velocity[1] + out.y * speed + fling * 0.35, velocity[2] + out.z * speed],
      })
    }
    const { list, labels } = loosened(c.v, dirty, moves ? 0 : c.held, kind !== 0)
    for (const piece of list) {
      const b = piece.box
      for (let i = 0; i < 3; i++) { dirty[i] = Math.min(dirty[i], b[i]); dirty[i + 3] = Math.max(dirty[i + 3], b[i + 3]) }
      if (piece.cells < CRUMB) {
        for (let y = b[1]; y < b[4]; y++) for (let z = b[2]; z < b[5]; z++) for (let x = b[0]; x < b[3]; x++) if (labels[x + nx * (z + nz * y)] === piece.label) record.gone.push(x + nx * (z + nz * y))
        drop(c.v, piece, labels)
        continue
      }
      const block = take(c.v, piece, labels), data = pack(block), size = [...block.size] as [number, number, number]
      record.took.push({ low: [b[0], b[1], b[2]], size, data })
      // The bit's own frame is at its block's middle: where that is in the world now.
      const mid = new THREE.Vector3(c.low[0] + (b[0] + size[0] / 2) * cell, c.low[1] + (b[1] + size[1] / 2) * cell, c.low[2] + (b[2] + size[2] / 2) * cell).applyQuaternion(turn)
      bits.push({
        cells: { size, cell, kinds: block.kinds, data, low: [(-size[0] * cell) / 2, (-size[1] * cell) / 2, (-size[2] * cell) / 2] },
        material: most(block), position: [p[0] + mid.x, p[1] + mid.y, p[2] + mid.z], rotation: [...q] as Quat, velocity: [...velocity] as Vec3,
      })
    }
    const empty = moves && solidCells(c.v) === 0
    if (this.solid && !empty) this.collide(t, dirty)
    this.version++
    return { record, bits, changed: hit.changed, empty }
  }

  /** Does to a copy of a block what a cut did to the block itself (a page's world, told by the world process). Returns the cells that changed, as a box, or null when there is no such thing. */
  applyCut(record: CutRecord): CellBox | null {
    const c = this.things.get(record.thing)?.cells
    if (!c) return null
    const [nx, ny, nz] = c.v.size, layer = nx * nz
    const dirty: CellBox = fillSphere(c.v, record.at, record.r, record.kind, record.kind ? 'air' : 'solid', record.rough, record.seed, record.keep)?.box ?? [nx, ny, nz, 0, 0, 0]
    const grow = (x: number, y: number, z: number) => { dirty[0] = Math.min(dirty[0], x); dirty[1] = Math.min(dirty[1], y); dirty[2] = Math.min(dirty[2], z); dirty[3] = Math.max(dirty[3], x + 1); dirty[4] = Math.max(dirty[4], y + 1); dirty[5] = Math.max(dirty[5], z + 1) }
    for (const i of record.gone) {
      if (!(i >= 0 && i < c.v.cells.length)) continue
      c.v.cells[i] = 0
      const y = Math.floor(i / layer), rem = i - y * layer, z = Math.floor(rem / nx)
      grow(rem - z * nx, y, z)
    }
    for (const piece of record.took) {
      const block = unpack(piece.size, c.v.cell, c.v.kinds, piece.data), [bx, by, bz] = block.size, [x0, y0, z0] = piece.low
      for (let y = 0; y < by; y++) for (let z = 0; z < bz; z++) for (let x = 0; x < bx; x++) {
        if (!block.cells[x + bx * (z + bz * y)]) continue
        const X = x + x0, Y = y + y0, Z = z + z0
        if (X < 0 || Y < 0 || Z < 0 || X >= nx || Y >= ny || Z >= nz) continue
        c.v.cells[X + nx * (Z + nz * Y)] = 0
      }
      grow(x0, y0, z0)
      grow(x0 + bx - 1, y0 + by - 1, z0 + bz - 1)
    }
    return dirty[3] > dirty[0] ? dirty : null
  }

  /**
   * A blow at a point in the world: every thing of cells within `radius` metres loses the cells
   * inside it (`rough` makes the hole's edge ragged, `lumps` knocks that many bits of rubble out of each
   * still thing's rim at up to `fling` m/s), and every moving thing near is pushed away with `push` N·s.
   * Returns what each cut did, as `cut` does.
   */
  blast(point: Vec3, radius: number, push = 0, rough = 0, lumps = 0, fling = 0): NonNullable<ReturnType<World['cut']>>[] {
    if (!pointOk(point) || !(radius > 0 && radius <= 8)) return []
    const out: NonNullable<ReturnType<World['cut']>>[] = []
    const local = new THREE.Vector3(), turn = new THREE.Quaternion()
    for (const t of [...this.things.values()]) {
      const c = t.cells
      if (!c || !this.things.has(t.key)) continue
      const moves = (t.part.motion ?? 'static') !== 'static'
      const p = moves ? this.core.position(t.body) : t.home.p, q = moves ? this.core.rotation(t.body) : t.home.q
      local.set(point[0] - p[0], point[1] - p[1], point[2] - p[2]).applyQuaternion(turn.set(-q[0], -q[1], -q[2], q[3]))
      const cell = c.v.cell, at: Vec3 = [Math.floor((local.x - c.low[0]) / cell), Math.floor((local.y - c.low[1]) / cell), Math.floor((local.z - c.low[2]) / cell)]
      const r = Math.max(1, Math.round(radius / cell))
      if (at[0] < -r || at[1] < -r || at[2] < -r || at[0] >= c.v.size[0] + r || at[1] >= c.v.size[1] + r || at[2] >= c.v.size[2] + r) continue
      // Lumps come out of what stands still (a wall, the road): a loose thing just loses the bite.
      const did = this.cut(t.key, at, r, 0, rough, moves ? 0 : lumps, fling)
      if (did) out.push(did)
    }
    if (push > 0) for (const t of this.things.values()) {
      if (t.part.motion !== 'dynamic' || t.part.upright) continue
      const p = this.core.position(t.body), d: Vec3 = [p[0] - point[0], p[1] - point[1], p[2] - point[2]], far = Math.hypot(...d)
      if (far > radius * 3 || far < 1e-6) continue
      const k = (push * Math.min(1, (radius / Math.max(far, radius * 0.5)) ** 2)) / far
      this.core.applyImpulse(t.body, [d[0] * k, d[1] * k + push * 0.25, d[2] * k])
    }
    return out
  }

  private geometry(shape: Shape): THREE.BufferGeometry {
    if (shape.kind === 'compound') throw new Error('a compound shape is not drawn')
    if (shape.kind === 'sphere') return new THREE.SphereGeometry(shape.radius, 24, 16)
    if (shape.kind === 'cylinder') return new THREE.CylinderGeometry(shape.radius, shape.radius, shape.halfHeight * 2, 28)
    if (shape.kind === 'capsule') return new THREE.CapsuleGeometry(shape.radius, shape.halfHeight * 2, 6, 16)
    const [x, y, z] = shape.half
    // A toy's edge is rounded by 6 mm; a thing the size of a crate or a car by a little more, so it does not read as a razor.
    const least = Math.min(x, y, z)
    return new RoundedBoxGeometry(x * 2, y * 2, z * 2, 2, Math.min(Math.max(0.006, Math.min(0.06, 0.08 * least)), 0.45 * least))
  }

  /** A part made of pieces as one mesh: each piece's shape where it stands in the part, in its own paint (a colour per vertex). */
  private piecesGeometry(part: PartSpec): THREE.BufferGeometry {
    const base = part.paint ?? material(part.material)!.look.color
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), c = new THREE.Color()
    const drawn = part.pieces!.map((piece) => {
      // A rounded box comes without an index and the round shapes with one: merged, they must all be without.
      const made = this.geometry(piece.shape), g = made.index ? made.toNonIndexed() : made
      if (g !== made) made.dispose()
      g.applyMatrix4(m.compose(v3(piece.at), q.setFromEuler(new THREE.Euler(...(piece.turn ?? [0, 0, 0]))), one))
      c.set(piece.paint ?? base)
      const n = g.getAttribute('position').count, colors = new Float32Array(n * 3)
      for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3)
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
      return g
    })
    const merged = drawn.length > 1 ? mergeGeometries(drawn) : drawn[0]
    if (drawn.length > 1) for (const g of drawn) g.dispose()
    if (!merged) throw new Error(`${part.id}: its pieces could not be drawn together`)
    return merged
  }

  /** Whoever draws this world may dress a part its own way (the street's page, #136): a material for it, or null to leave it to the world. One is asked for per material and paint, as the world's own are. */
  dress?: (part: PartSpec) => THREE.Material | null
  /** What that dressing depends on beyond a part's material and paint (a crate's slats): parts that differ in it get a look each. */
  dressKey?: (part: PartSpec) => string
  private lookKey(part: PartSpec) {
    return lookKey(part) + (this.dressKey?.(part) ?? '')
  }

  /** One drawn material per material and paint; wood gets a grain painted from its colour. */
  private look(part: PartSpec): THREE.Material {
    const key = this.lookKey(part)
    const known = this.looks.get(key)
    if (known) return known
    const dressed = this.dress?.(part)
    if (dressed) {
      this.looks.set(key, dressed)
      return dressed
    }
    const l = material(part.material)!.look
    if (part.pieces) {
      const look = new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: l.roughness, metalness: l.metalness })
      this.looks.set(key, look)
      return look
    }
    const color = new THREE.Color(part.paint ?? l.color)
    let map: THREE.Texture | undefined
    if (this.grain && (part.material === 'maple' || part.material === 'walnut' || part.material === 'lacquer')) {
      const rgb = (k: number) => [color.r, color.g, color.b].map((c) => Math.round(Math.min(255, c * 255 * k))) as [number, number, number]
      map = this.grain(70 + this.looks.size, rgb(1.06), rgb(0.86), part.material === 'walnut' ? 2 : 0, part.material === 'lacquer' ? 1 : 2)
    }
    const look = new THREE.MeshStandardMaterial({ color: map ? '#ffffff' : color, roughness: l.roughness, metalness: l.metalness, ...(map ? { map } : {}) })
    this.looks.set(key, look)
    return look
  }

  /** Sets a part's card text; it is drawn once in the next sync, however many times it changed meanwhile. */
  show(key: string, text: string) {
    const thing = this.things.get(key)
    if (!thing?.mesh) return
    this.cards.set(key, String(text).slice(0, 12))
    // Where there is no page (the street's world process, #118) a card is its text: whoever draws the world reads texts().
    if (typeof document === 'undefined') return
    let d = this.displays.get(key)
    if (!d) {
      const canvas = document.createElement('canvas')
      canvas.width = 512
      canvas.height = 180
      const texture = new THREE.CanvasTexture(canvas)
      texture.colorSpace = THREE.SRGBColorSpace
      const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.8 })
      d = { canvas, texture, material, text, drawn: null }
      this.displays.set(key, d)
      thing.mesh.material = material
    }
    d.text = this.cards.get(key)!
  }

  /** Each card's text, by its part's key. */
  texts() {
    return Object.fromEntries(this.cards)
  }

  /**
   * A part glowing in its own colour. Its material is made the first time (a lamp asks at setup, so
   * nothing compiles in the middle of play); after that only its brightness changes.
   */
  glow(key: string, level: number) {
    const thing = this.things.get(key)
    if (!thing?.mesh || this.cards.has(key) || !Number.isFinite(level)) return
    let glow = this.glows.get(key)
    if (!glow) {
      glow = (this.look(thing.part) as THREE.MeshStandardMaterial).clone()
      glow.emissive.set(thing.part.paint ?? material(thing.part.material)!.look.color)
      this.glows.set(key, glow)
      thing.mesh.material = glow
    }
    glow.emissiveIntensity = GLOW * Math.min(4, Math.max(0, level))
  }

  /** Draws the cards whose text changed since they were last drawn. */
  private drawDisplays() {
    for (const d of this.displays.values()) if (d.drawn !== d.text) this.draw(d)
  }

  /** Cards drawn since the world started. */
  private draws = 0

  private draw(d: { canvas: HTMLCanvasElement; texture: THREE.CanvasTexture; text: string; drawn: string | null }) {
    this.draws++
    d.drawn = d.text
    const g = d.canvas.getContext('2d')!
    g.fillStyle = '#f6ead2'
    g.fillRect(0, 0, 512, 180)
    g.strokeStyle = '#9a5a35'
    g.lineWidth = 6
    g.strokeRect(14, 14, 484, 152)
    g.fillStyle = '#4a3326'
    const font = (px: number) => `600 ${px}px "Iowan Old Style", Palatino, Georgia, serif`
    g.font = font(104)
    // A longer text (a word and a number) is set smaller, to fit inside the frame.
    const wide = g.measureText(d.text).width
    if (wide > 440) g.font = font(Math.floor((104 * 440) / wide))
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(d.text, 256, 96)
    d.texture.needsUpdate = true
  }

  // ── Followers ────────────────────────────────────────────────────────────

  /**
   * A body for a scene object that walks (a person): an upright cylinder sized from the object's
   * bounds, with the mass of its material, chasing the object each step with at most the
   * `strength` rule's force while the object moves; standing, it stays where it is pushed to (a
   * figure drawn pressed against the fridge does not lean on it). What it cannot push holds it
   * back: while its body lags the object the object's `userData.held` is true (the walker's
   * owner may wait), for at most HELD_MAX seconds. Off the floor (a hop, a seat) or after a jump
   * it touches nothing and just follows.
   * It reports a footstep each stride.
   */
  follow(key: string, object: THREE.Object3D, materialName = 'villager') {
    if (this.followers.has(key) || !material(materialName)) return false
    const box = new THREE.Box3().setFromObject(object)
    const size = box.getSize(new THREE.Vector3())
    if (!Number.isFinite(size.y) || size.y <= 0) return false
    const tall = Math.max(0.05, size.y - CLEAR)
    const radius = Math.min(0.2, Math.max(0.08, 0.35 * Math.max(size.x, size.z)))
    const root = object.getWorldPosition(new THREE.Vector3())
    const lift = box.min.y - root.y + CLEAR + tall / 2
    const m = material(materialName)!
    // An upright cylinder, not a capsule: its flat sides push a ball along instead of pressing it into the floor.
    const body = this.core.addBody({ shape: { kind: 'cylinder', halfHeight: tall / 2, radius }, motion: 'dynamic', upright: true, gravityFactor: 0, linearDamping: 0, position: [root.x, root.y + lift, root.z], density: m.density, friction: m.friction, restitution: m.restitution })
    const f: Follower = { key, object, body, lift, radius, material: materialName, mass: this.core.mass(body), last: root.clone(), walked: 0, left: false, solid: true, heldFor: 0, aim: root.clone(), passing: false, sent: [0, 0, 0] }
    this.followers.set(key, f)
    this.byBody[body] = f
    return true
  }

  unfollow(key: string) {
    const f = this.followers.get(key)
    if (!f) return
    this.core.removeBody(f.body)
    this.byBody[f.body] = undefined
    delete f.object.userData.held
    this.followers.delete(key)
  }

  followerKeys() {
    return [...this.followers.keys()]
  }

  /** Whether a follower's body is held back by something it cannot push. */
  heldBack(key: string) {
    const f = this.followers.get(key)
    return Boolean(f && f.heldFor > HELD_AFTER && f.heldFor < HELD_MAX)
  }

  private chase(f: Follower, at: THREE.Vector3, h: number) {
    const target: Vec3 = [at.x, at.y + f.lift, at.z]
    const p = this.core.position(f.body)
    const gap = Math.hypot(target[0] - p[0], target[1] - p[1], target[2] - p[2])
    const lag = Math.hypot(target[0] - p[0], target[2] - p[2])
    const moving = at.distanceTo(f.aim) > 1e-4
    // Off the floor, or jumped (a teleport, or squeezing past what held it too long): follow without
    // touching. After a jump it touches things again once its figure stands still (at a spot, which is
    // clear of furniture), so it never comes back to life inside the sofa it squeezed past.
    if (gap > JUMP) f.passing = true
    else if (!moving) f.passing = false
    if (at.y > 0.05 || f.passing) {
      if (f.solid) this.core.setSolid(f.body, (f.solid = false))
      this.core.setState(f.body, target, [0, 0, 0])
      f.sent = [0, 0, 0]
      f.heldFor = 0
    } else {
      if (!f.solid) {
        this.core.setState(f.body, target, [0, 0, 0])
        this.core.setSolid(f.body, (f.solid = true))
        f.sent = [0, 0, 0]
      }
      // Chase the figure with at most `strength` newtons: the velocity change per step is capped at F/m·h.
      // A walking figure is tracked step for step; a figure standing still is drifted towards gently,
      // so a body pushed out of a cupboard it is drawn against leans on it lightly instead of ramming it.
      const v = this.core.velocity(f.body)
      const want = target.map((x, i) => (x - p[i]) * (moving ? 1 / h : SETTLE))
      const speed = Math.hypot(...want)
      const top = moving ? CHASE : SETTLE_MAX
      if (speed > top) for (let i = 0; i < 3; i++) want[i] *= top / speed
      const dv = want.map((w, i) => w - v[i])
      const most = (Number(this.rules.strength) / f.mass) * h
      const n = Math.hypot(...dv)
      const k = n > most ? most / n : 1
      // Held: behind its figure and pushed back step after step, i.e. what it touches took back most of the speed the
      // last step's chase sent it with. A light thing it bumps takes a little once; one it cannot push takes it all every
      // step. Its own inertia never counts: a heavy walker gathering speed again after a bump is not held.
      const pushedBack = lag > 1e-6 ? ((f.sent[0] - v[0]) * (target[0] - p[0]) + (f.sent[2] - v[2]) * (target[2] - p[2])) / lag : 0
      f.heldFor = lag > HELD_LAG && pushedBack > PUSHED_BACK * most ? f.heldFor + h : 0
      f.sent = [v[0] + dv[0] * k, v[1] + dv[1] * k, v[2] + dv[2] * k]
      this.core.setVelocity(f.body, f.sent)
    }
    f.aim.copy(at)
    const held = f.heldFor > HELD_AFTER && f.heldFor < HELD_MAX
    if (held) f.object.userData.held = true
    else delete f.object.userData.held
  }

  // ── Bound bodies ─────────────────────────────────────────────────────────

  /**
   * A body for a scene object drawn by someone else. When the object's owner moves it (a placed
   * thing posed again, undo), its body goes there; a dynamic body moves the object in turn.
   * Static ones never move by themselves. Added asleep: an object left resting slightly inside
   * another waits to be touched. False for an unknown material or a key in use.
   */
  bind(key: string, object: THREE.Object3D, spec: BindSpec) {
    const mat = material(spec.material)
    if (this.bound.has(key) || this.things.has(key) || !mat) return false
    object.updateWorldMatrix(true, false)
    const p = new THREE.Vector3(), q = new THREE.Quaternion()
    object.matrixWorld.decompose(p, q, new THREE.Vector3())
    const body = this.core.addBody({
      shape: spec.shape, motion: spec.motion, position: arr(p), rotation: [q.x, q.y, q.z, q.w], asleep: true,
      density: mat.density, friction: mat.friction, restitution: mat.restitution, linearDamping: this.rules.drag, ...(spec.mass !== undefined ? { mass: spec.mass } : {}),
    })
    const b: Bound = { key, object, body, material: spec.material, motion: spec.motion, shape: spec.shape, outline: outline(spec.shape), p, q, home: spec.home ?? { p: arr(p), q: [q.x, q.y, q.z, q.w] }, parts: spec.parts, woke: spec.woke, slept: spec.slept }
    this.bound.set(key, b)
    this.byBody[body] = b
    this.version++
    return true
  }

  unbind(key: string) {
    const b = this.bound.get(key)
    if (!b) return
    this.release(b)
    this.core.removeBody(b.body)
    this.byBody[b.body] = undefined
    this.bound.delete(key)
    this.stirring.delete(b)
    this.posed.delete(b)
    this.version++
  }

  boundKeys() {
    return [...this.bound.keys()]
  }

  /** Bodies that woke or fell asleep: a bound moving thing joins or leaves the ones looked at each step, and is told. */
  private stirs() {
    for (const { id, awake } of this.core.activity()) {
      const b = this.byBody[id]
      if (!b || !('home' in b) || !('object' in b) || b.motion !== 'dynamic') continue
      // Said some steps ago, it may no longer be so (a thing tidied away since): the solver is asked.
      if (awake === this.stirring.has(b) || awake === this.core.sleeping(b.body)) continue
      if (awake) {
        this.stirring.add(b)
        b.woke?.()
      } else {
        // Its last pose is drawn before it is left alone. Come to rest a hair from where it was made (it only
        // settled, or was put back by hand), it counts as home: its owner may draw it as it was made. Its body
        // stays where it settled, so woken again it does not settle again.
        this.pose(b)
        this.stirring.delete(b)
        b.slept?.(!this.holds.has(b) && this.isHome(b, NEARLY_HOME, 3e-4))
      }
    }
  }

  /** Draws a held thing towards where it is held with at most the hold's force, and turns it upright. */
  private pull(b: Bound, hold: Hold, h: number) {
    // Held still, its body would fall asleep in the hand and hang there when let go.
    if (this.core.sleeping(b.body)) this.core.wake(b.body)
    const p = this.core.position(b.body), v = this.core.velocity(b.body)
    const mass = this.core.mass(b.body)
    // Carried a long way it rides higher, over what stands between, and comes down as it nears.
    const far = Math.hypot(hold.to[0] - p[0], hold.to[2] - p[2])
    const to: Vec3 = [hold.to[0], hold.to[1] + Math.min(hold.arc, far * 0.8), hold.to[2]]
    const want = to.map((x, i) => (x - p[i]) * HOLD_RATE)
    const speed = Math.hypot(...want)
    if (speed > HOLD_SPEED) for (let i = 0; i < 3; i++) want[i] *= HOLD_SPEED / speed
    // Gravity is carried by the hand first; what is left of its strength moves the thing.
    const g = this.rules.gravity
    const dv = want.map((w, i) => w - v[i] - g[i] * h)
    const most = (hold.strength / mass) * h
    const n = Math.hypot(...dv)
    const k = n > most ? most / n : 1
    this.core.setVelocity(b.body, [v[0] + dv[0] * k, v[1] + dv[1] * k, v[2] + dv[2] * k])
    // Upright: turn its own up towards the world's, as fast as the hand is strong for it; no spin about up.
    const q = this.core.rotation(b.body)
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion(q[0], q[1], q[2], q[3]))
    const axis = up.clone().cross(new THREE.Vector3(0, 1, 0))
    const sin = axis.length(), angle = Math.atan2(sin, up.y)
    const turn = sin > 1e-5 ? axis.multiplyScalar((angle * HOLD_UPRIGHT * Math.min(1, most / 0.5)) / sin) : axis.set(0, 0, 0)
    this.core.setAngularVelocity(b.body, [turn.x, turn.y, turn.z])
  }

  /**
   * A hand takes hold of a moving bound thing (a mug, a chair) and draws it towards `to` (world
   * space) with at most `strength` newtons, step after step, until carry(key, null) lets it go
   * with the speed it has. A thing too heavy for the hand drags and tips instead of rising.
   * `arc` (m) is how much higher than `to` it may ride while it still has far to go.
   */
  carry(key: string, to: Vec3 | null, strength = 60, arc = 0) {
    const b = this.boundDynamic(key)
    if (!b) return false
    if (!to) return this.release(b)
    if (!pointOk(to) || !(strength > 0)) return false
    const held = this.holds.get(b)
    if (held) {
      held.to = [...to]
      held.strength = strength
      held.arc = arc
    } else {
      this.holds.set(b, { to: [...to], strength, arc })
      this.core.wake(b.body)
      this.emit({ kind: 'held', thing: b.key, material: b.material, shape: b.outline, at: at(this.core.position(b.body)), held: true })
    }
    return true
  }

  /** The moving bound things a hand may take: each one's key, where it is (world space) and the half sizes of the box round it. */
  movables(): { key: string; at: Vec3; half: Vec3 }[] {
    const out: { key: string; at: Vec3; half: Vec3 }[] = []
    for (const b of this.bound.values()) if (b.motion === 'dynamic') out.push({ key: b.key, at: [b.p.x, b.p.y, b.p.z], half: halfOf(b.outline) })
    return out
  }

  /** The key of the bound thing a scene object is, if it is one. */
  keyOf(object: THREE.Object3D) {
    for (const b of this.bound.values()) if (b.object === object) return b.key
    return undefined
  }

  /** The scene object a bound thing's body stands for. */
  boundObject(key: string) {
    return this.bound.get(key)?.object
  }

  /** Ends a hold, however it ends (let go, tidied away, lost and put back, unbound), and says so. */
  private release(b: Bound) {
    if (!this.holds.delete(b)) return false
    this.core.wake(b.body)
    this.emit({ kind: 'held', thing: b.key, material: b.material, shape: b.outline, at: at(this.core.position(b.body)), held: false })
    return true
  }

  /** Whether a hand holds this thing now: a hold can end without the hand (tidying, a thing lost and put back). */
  isHeld(key: string) {
    const b = this.bound.get(key)
    return Boolean(b && this.holds.has(b))
  }

  /** Every held thing's key. */
  holding() {
    return [...this.holds.keys()].map((b) => b.key)
  }

  /**
   * The first thing a ray from `origin` along `direction` (world space; its length is how far to look) meets, not
   * counting the things in `ignore`: its key, where, and the surface's normal there.
   */
  castRay(origin: Vec3, direction: Vec3, ignore: string[] = []) {
    if (!pointOk(origin) || !dirOk(direction)) return null
    const skip = ignore.flatMap((key) => {
      const t = this.things.get(key) ?? this.followers.get(key) ?? this.bound.get(key)
      return t ? ('part' in t ? this.bodiesOf(t) : [t.body]) : []
    })
    const hit = this.core.castRay(origin, direction, skip)
    const t = hit && this.byBody[hit.body]
    return hit && t ? { key: t.key, point: hit.point, normal: hit.normal, fraction: hit.fraction } : null
  }

  /**
   * Puts moving bound things back where they were made, at rest (tidying up after play): all of
   * them, or the ones named. Held things are let go. Returns the keys put back.
   */
  tidy(keys?: string[]) {
    const back: string[] = []
    for (const b of this.bound.values()) {
      if (b.motion !== 'dynamic' || (keys && !keys.includes(b.key))) continue
      this.release(b)
      this.core.rest(b.body, b.home.p, b.home.q)
      this.pose(b)
      this.stirring.delete(b)
      b.slept?.(true)
      back.push(b.key)
    }
    return back
  }

  /** Whether a bound thing is within `by` metres of where it was made, and turned no more than `turned` (1 - |q·q₀|: 3e-4 is about 3°). */
  private isHome(b: Bound, by: number, turned: number) {
    const d = Math.hypot(b.p.x - b.home.p[0], b.p.y - b.home.p[1], b.p.z - b.home.p[2])
    return d < by && 1 - Math.abs(b.q.x * b.home.q[0] + b.q.y * b.home.q[1] + b.q.z * b.home.q[2] + b.q.w * b.home.q[3]) < turned
  }

  /** How far (m) each moving bound thing is from where it was made, for the ones that are not there. */
  astray(by = 0.02) {
    const out: Record<string, number> = {}
    for (const b of this.bound.values()) {
      if (b.motion !== 'dynamic') continue
      const d = Math.hypot(b.p.x - b.home.p[0], b.p.y - b.home.p[1], b.p.z - b.home.p[2])
      const turned = 1 - Math.abs(b.q.x * b.home.q[0] + b.q.y * b.home.q[1] + b.q.z * b.home.q[2] + b.q.w * b.home.q[3])
      // A ball that only turned where it lies is not out of place.
      const ball = b.shape.kind === 'compound' && b.shape.boxes.length === 1 && b.shape.boxes[0].round === 'ball'
      if (d > by || (turned > 0.002 && !ball)) out[b.key] = d
    }
    return out
  }

  /** Bound objects their owners moved since the last look: their bodies go there, at rest. */
  private follows() {
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3()
    for (const b of this.bound.values()) {
      b.object.updateWorldMatrix(true, false)
      b.object.matrixWorld.decompose(p, q, s)
      if (p.distanceTo(b.p) <= MOVED && Math.abs(q.dot(b.q)) >= 1 - MOVED * MOVED) continue
      b.p.copy(p)
      b.q.copy(q)
      const at = arr(p), turn: Quat = [q.x, q.y, q.z, q.w]
      b.home = { p: at, q: turn }
      if (b.motion === 'static') this.core.setPose(b.body, at, turn)
      else {
        this.core.setState(b.body, at, [0, 0, 0], turn)
        this.posed.add(b)
      }
    }
  }

  // ── Running ──────────────────────────────────────────────────────────────

  input(name: string, down: boolean) {
    if (down) this.inputs.add(name)
    else this.inputs.delete(name)
  }

  held(input: string) {
    return this.inputs.has(input)
  }

  setKnob(gadget: string, knob: string, value: number) {
    const g = this.gadgets.get(gadget)
    return g ? this.applyKnob(g, knob, value) : false
  }

  /** A knob to a value held in its range, and whatever its kind fixed from it at setup (a hinge's travel) brought into line. */
  private applyKnob(g: Gadget, knob: string, value: number) {
    const kind = gadgetKind(g.spec.kind)
    const range = kind && Object.hasOwn(kind.knobs, knob) ? kind.knobs[knob] : undefined
    if (!range || typeof value !== 'number' || !Number.isFinite(value)) return false
    g.knobs[knob] = Math.min(range.max, Math.max(range.min, value))
    kind!.knob?.(g, knob, this)
    return true
  }

  /** Real time (performance.now) until which the world holds still, for a hit-stop. */
  private heldUntil = 0

  /** Hit-stop: frames step nothing for `seconds` of real time (advance, the checks' clock, never holds). False when one ran too recently. */
  hold(seconds: number) {
    const now = performance.now()
    if (!Number.isFinite(seconds) || seconds <= 0 || now < this.heldUntil + HOLD_REST) return false
    this.heldUntil = now + Math.min(HOLD_MAX, seconds) * 1000
    return true
  }

  /** One rendered frame: real seconds in, simulated time out by the rules' time scale. */
  frame(dt: number) {
    const t0 = performance.now()
    this.follows()
    // Held for a hit-stop: nothing steps and no time is owed for it; what is drawn stays as it is.
    if (t0 < this.heldUntil) return this.sync(0)
    this.accumulator += Math.min(dt, 0.1) * this.rules.timeScale
    let steps = 0
    while (this.accumulator >= STEP && steps < MAX_STEPS) {
      this.step()
      this.accumulator -= STEP
      steps++
    }
    if (steps === MAX_STEPS) this.accumulator = 0
    this.sync(dt)
    this.frameTimes.push(performance.now() - t0)
    if (this.frameTimes.length > 1200) this.frameTimes.splice(0, 600)
  }

  /** Simulated seconds, stepped at once with no drawing in between (checks and tests). `each` sees every step. */
  advance(seconds: number, each?: () => void) {
    this.follows()
    for (let i = 0; i < Math.round(seconds / STEP); i++) {
      this.step()
      each?.()
    }
    this.sync(0)
  }

  private step() {
    const h = STEP
    const t0 = performance.now()
    this.clock += h
    const p = new THREE.Vector3()
    for (const f of this.followers.values()) {
      f.object.getWorldPosition(p)
      this.chase(f, p, h)
      this.stride(f, p)
    }
    for (const g of this.gadgets.values()) gadgetKind(g.spec.kind)?.step?.(g, this, h)
    for (const [b, hold] of this.holds) this.pull(b, hold, h)
    this.core.step(h, this.rules.substeps)
    this.stirs()
    for (const c of this.core.contacts()) this.contact(c)
    for (let n = 0; this.queue.length && n < SIGNALS_PER_STEP; n++) {
      const { from, signal, hops } = this.queue.shift()!
      this.hops = hops
      try {
        for (const to of this.wires.get(from) ?? []) {
          const dot = to.lastIndexOf('.')
          const g = this.gadgets.get(to.slice(0, dot))
          if (g) gadgetKind(g.spec.kind)?.receive?.(g, to.slice(dot + 1), signal, this)
        }
      } finally {
        this.hops = 0
      }
    }
    // The rest wait for the next step. A loop of wires feeding itself faster than that drains is cut here, and said so.
    if (this.queue.length > SIGNALS_WAITING) this.drop(this.queue.splice(SIGNALS_WAITING).length)
    else if (this.dropping) this.drop(0)
    for (const [key, t] of this.respawns) {
      if (t > this.clock) continue
      this.respawns.delete(key)
      const thing = this.things.get(key)
      if (thing) this.core.setState(thing.body, thing.home.p, [0, 0, 0], thing.home.q)
    }
    this.guard()
    this.stepTimes.push(performance.now() - t0)
    if (this.stepTimes.length > 1200) this.stepTimes.splice(0, 600)
  }

  /** A step each stride along the floor, alternating feet either side of the walking line. */
  private stride(f: Follower, p: THREE.Vector3) {
    const dx = p.x - f.last.x, dz = p.z - f.last.z
    const d = Math.hypot(dx, dz)
    // A jump (a seat hop, a teleport) is not walking; nor is standing on a chair.
    if (d > 0.5 || p.y > 0.05) {
      f.last.copy(p)
      f.walked = 0
      return
    }
    f.walked += d
    f.last.copy(p)
    if (f.walked < STRIDE || d < 1e-5) return
    f.walked -= STRIDE
    f.left = !f.left
    const hx = dx / d, hz = dz / d
    const side = (f.left ? 1 : -1) * f.radius * 0.45
    this.emit({ kind: 'step', thing: f.key, material: f.material, at: { x: p.x - hz * side, y: 0, z: p.z + hx * side }, heading: { x: hx, y: 0, z: hz }, side: f.left ? 'left' : 'right', foot: { length: f.radius * 0.9, width: f.radius * 0.45 } })
  }

  private contact(c: Contact) {
    const ta = this.byBody[c.a], tb = this.byBody[c.b]
    if (!ta || !tb) return
    if (!c.sensor) {
      const impulse = c.impulse * this.rules.impact
      if (impulse >= IMPACT_MIN) {
        const ma = material(this.materialOf(c.a)), mb = material(this.materialOf(c.b))
        this.emit({ kind: 'impact', a: ta.key, b: tb.key, materials: [this.materialOf(c.a), this.materialOf(c.b)], shapes: [this.shapeOf(ta), this.shapeOf(tb)], at: at(c.point), normal: at(c.normal), impulse: c.impulse, hardness: Math.max(ma?.hardness ?? 0, mb?.hardness ?? 0), impact: this.rules.impact })
        this.puff(c.point, impulse)
        for (const t of [ta, tb]) if ('part' in t && t.part.motion !== 'dynamic' && t.mesh) t.wobble = Math.min(1, t.wobble + impulse * 4)
      }
    }
    for (const [self, other, sign] of [[ta, tb, 1], [tb, ta, -1]] as const) {
      const touched = this.byPart.get(self.key)
      if (!touched) continue
      const t: Touch = { other: other.key, impulse: c.impulse, dir: [c.normal[0] * sign, c.normal[1] * sign, c.normal[2] * sign], point: c.point, sensor: c.sensor }
      for (const g of touched) gadgetKind(g.spec.kind)?.touch?.(g, t, this)
    }
  }

  private shapeOf(t: Thing | Follower | Bound): Shape {
    return 'part' in t ? outline(t.part.shape) : 'outline' in t ? t.outline : { kind: 'cylinder', halfHeight: t.lift, radius: t.radius }
  }

  fire(gadget: Gadget, port: string, signal: Signal) {
    const from = `${gadget.id}.${port}`
    this.tally.set(from, (this.tally.get(from) ?? 0) + 1)
    this.emit({ kind: 'signal', gadget: gadget.id, port, value: signal.value, ...(signal.thing ? { thing: signal.thing } : {}), ...(signal.at ? { at: at(signal.at) } : {}) })
    const hops = this.hops + 1
    if (hops > SIGNAL_HOPS) this.drop(1)
    else this.queue.push({ from, signal, hops })
  }

  /** Dropped signals are said at most four times a second, with the count since the last saying. */
  private dropping = 0
  private drop(signals: number) {
    this.dropping += signals
    if (this.clock - this.droppedAt <= 0.25) return
    this.droppedAt = this.clock
    this.emit({ kind: 'dropped', signals: this.dropping })
    this.dropping = 0
  }

  /** Too fast is slowed to the speed limit, lost (below the floor, past the world bound) or broken is put back home: never an explosion. */
  private guard() {
    const max = this.rules.maxSpeed
    // Only what is awake can be lost or too fast.
    for (const b of this.stirring) {
      const p = this.core.position(b.body)
      if (!(p.every(Number.isFinite) && p[1] >= this.floor - LOST && Math.abs(p[0]) <= WORLD_BOUND && Math.abs(p[2]) <= WORLD_BOUND && p[1] <= WORLD_BOUND)) {
        this.release(b)
        this.core.setState(b.body, b.home.p, [0, 0, 0], b.home.q)
        this.emit({ kind: 'clamped', thing: b.key, speed: -1, at: at(b.home.p), reset: true })
        continue
      }
      const v = this.core.velocity(b.body)
      const speed = Math.hypot(...v)
      if (speed > max) this.core.setVelocity(b.body, [v[0] * max / speed, v[1] * max / speed, v[2] * max / speed])
    }
    for (const t of this.things.values()) {
      if (t.part.motion !== 'dynamic') continue
      const p = this.core.position(t.body)
      const v = this.core.velocity(t.body)
      const speed = Math.hypot(...v)
      const lost = !p.every(Number.isFinite) || !Number.isFinite(speed) || p[1] < this.floor - LOST || p[1] > WORLD_BOUND || Math.abs(p[0]) > WORLD_BOUND || Math.abs(p[2]) > WORLD_BOUND
      if (!lost && speed <= max) continue
      if (lost) this.core.setState(t.body, t.home.p, [0, 0, 0], t.home.q)
      else this.core.setVelocity(t.body, [v[0] * max / speed, v[1] * max / speed, v[2] * max / speed])
      const last = this.clampedAt.get(t.key) ?? -1
      if (this.clock - last > 0.25) {
        this.clampedAt.set(t.key, this.clock)
        this.emit({ kind: 'clamped', thing: t.key, speed: Number.isFinite(speed) ? speed : -1, at: at(lost ? t.home.p : p), reset: lost })
        this.puff(lost ? t.home.p : p, 0.05)
      }
    }
  }

  private puff(point: Vec3, impulse: number) {
    const n = Math.min(4, Math.floor(impulse * 20))
    for (let i = 0, k = 0; i < this.dust.length && k < n; i++) {
      const d = this.dust[i]
      if (d.life > 0) continue
      k++
      d.life = 1
      d.mesh.visible = true
      d.mesh.position.set(point[0], point[1], point[2])
      d.v.set((Math.random() - 0.5) * 0.3, 0.15 + Math.random() * 0.2, (Math.random() - 0.5) * 0.3).multiplyScalar(Math.min(1, 0.3 + impulse * 3))
      d.mesh.scale.setScalar(0.0025 + Math.min(0.004, impulse * 0.02))
    }
  }

  /** A bound moving thing's object goes where its body is. */
  private pose(b: Bound) {
    this.posed.add(b)
    const p = this.core.position(b.body), q = this.core.rotation(b.body)
    b.p.set(p[0], p[1], p[2])
    // The solver's turn is a float's width off unit length; left so, the object's own (unit) turn would read as its
    // owner having moved it (follows), and the thing's home would follow it wherever it was thrown.
    b.q.set(q[0], q[1], q[2], q[3]).normalize()
    // World pose to the object's own (its parent's frame), keeping its scale.
    const o = b.object
    const m = poseM.compose(b.p, b.q, ONE)
    if (o.parent) {
      o.parent.updateWorldMatrix(true, false)
      m.premultiply(parentM.copy(o.parent.matrixWorld).invert())
    }
    poseS.copy(o.scale)
    m.decompose(o.position, o.quaternion, scratchS)
    o.scale.copy(poseS)
  }

  /** Meshes follow bodies; wobbles and dust ease out. */
  private sync(dt: number) {
    this.drawDisplays()
    for (const b of this.stirring) this.pose(b)
    for (const t of this.things.values()) {
      if (!t.mesh) continue
      if (t.part.motion && t.part.motion !== 'static') {
        const p = this.core.position(t.body), q = this.core.rotation(t.body)
        t.mesh.position.set(p[0], p[1], p[2])
        t.mesh.quaternion.set(q[0], q[1], q[2], q[3])
      }
      if (t.wobble > 0.001) {
        t.wobble *= Math.exp(-dt * 7)
        t.mesh.scale.setScalar(1 + 0.12 * t.wobble * Math.sin(this.clock * 70))
      } else if (t.wobble) {
        t.wobble = 0
        t.mesh.scale.setScalar(1)
      }
    }
    for (const d of this.dust) {
      if (d.life <= 0) continue
      d.life -= dt * 1.8
      d.mesh.position.addScaledVector(d.v, dt)
      d.mesh.scale.multiplyScalar(1 + dt * 0.8)
      if (d.life <= 0) d.mesh.visible = false
    }
  }

  // ── The API: reading and acting ─────────────────────────────────────────

  keys() {
    return [...this.things.keys(), ...this.followers.keys(), ...this.bound.keys()]
  }

  thing(key: string): ThingInfo | null {
    const t = this.things.get(key)
    const f = t ? undefined : this.followers.get(key)
    const b = t || f ? undefined : this.bound.get(key)
    const any = t ?? f ?? b
    if (!any) return null
    const p = this.core.position(any.body)
    const frame = t && this.frames.get(t.toy)
    const local = frame ? arr(v3(p).applyMatrix4(frame.clone().invert())) : p
    return {
      key, toy: t?.toy ?? (f ? 'followers' : 'bound'), material: t?.part.material ?? (f ?? b)!.material, shape: this.shapeOf(any),
      motion: t ? t.part.motion ?? 'static' : b?.motion ?? 'dynamic', position: p, rotation: this.core.rotation(any.body), velocity: this.core.velocity(any.body), local,
      mass: this.core.mass(any.body),
    }
  }

  material(name: string) {
    return material(name)
  }

  materials() {
    return materialNames()
  }

  private dynamic(key: string) {
    const t = this.things.get(key)
    return t?.part.motion === 'dynamic' ? t : undefined
  }

  /** A moving body bound to a scene object drawn by someone else (a high chair, a lamp): snapshots keep and restore it too. */
  private boundDynamic(key: string) {
    const b = this.bound.get(key)
    return b?.motion === 'dynamic' ? b : undefined
  }

  setVelocity(key: string, v: Vec3) {
    const t = this.dynamic(key) ?? this.boundDynamic(key)
    if (!t || !v.every(Number.isFinite)) return false
    this.core.setVelocity(t.body, v)
    return true
  }

  applyImpulse(key: string, impulse: Vec3) {
    const t = this.dynamic(key) ?? this.boundDynamic(key)
    if (!t || !impulse.every(Number.isFinite)) return false
    this.core.applyImpulse(t.body, impulse)
    return true
  }

  place(key: string, local: Vec3) {
    const t = this.dynamic(key)
    const frame = t && this.frames.get(t.toy)
    if (!t || !frame || !local.every(Number.isFinite)) return false
    const world = arr(v3(local).applyMatrix4(frame))
    if (!world.every((x) => Math.abs(x) <= WORLD_BOUND)) return false
    this.core.setState(t.body, world, [0, 0, 0], t.home.q)
    return true
  }

  moveTo(key: string, position: Vec3, velocity: Vec3, rotation?: Quat) {
    const t = this.dynamic(key)
    if (!t || !pointOk(position) || position[1] < this.floor || !velocity.every(Number.isFinite)) return false
    const n = rotation ? Math.hypot(...rotation) : 1
    if (!(n > 1e-6)) return false
    const speed = Math.hypot(...velocity), k = speed > this.rules.maxSpeed ? this.rules.maxSpeed / speed : 1
    this.core.setState(t.body, position, [velocity[0] * k, velocity[1] * k, velocity[2] * k], rotation ? [rotation[0] / n, rotation[1] / n, rotation[2] / n, rotation[3] / n] : this.core.rotation(t.body))
    return true
  }

  respawn(key: string, delay: number) {
    if (!this.dynamic(key) || this.respawns.has(key)) return false
    this.respawns.set(key, this.clock + Math.max(0, delay))
    return true
  }

  private bodyOf(key: string) {
    const t = this.things.get(key)
    if (!t) throw new Error(`no thing ${key}`)
    return t
  }

  addHinge(key: string, anchor: Vec3, axis: Vec3, limits: [number, number]) {
    const t = this.bodyOf(key)
    const frame = this.frames.get(t.toy)!
    if (!pointOk(anchor) || !dirOk(axis) || !limitsOk(limits)) throw new Error(`${key}: a hinge needs a finite anchor, a direction and limits min <= max`)
    return this.joined(t.toy, this.core.addHinge({ body: t.body, anchor: arr(v3(anchor).applyMatrix4(frame)), axis: arr(v3(axis).transformDirection(frame)), limits }))
  }

  addSlider(key: string, axis: Vec3, limits: [number, number]) {
    const t = this.bodyOf(key)
    if (!dirOk(axis) || !limitsOk(limits)) throw new Error(`${key}: a slider needs a direction and limits min <= max`)
    return this.joined(t.toy, this.core.addSlider({ body: t.body, axis: arr(v3(axis).transformDirection(this.frames.get(t.toy)!)), limits }))
  }

  /** A joint made for a toy is remembered there, to be taken out with it. */
  private joined(toy: string, joint: number) {
    this.joints.set(toy, [...(this.joints.get(toy) ?? []), joint])
    return joint
  }

  setLimits(joint: number, limits: [number, number]) {
    if (limitsOk(limits)) this.core.setLimits(joint, limits)
  }

  setMotor(joint: number, velocity: number, limit: number) {
    this.core.setMotor(joint, velocity, limit)
  }

  jointPosition(joint: number) {
    return this.core.jointPosition(joint)
  }

  upright(key: string) {
    const t = this.things.get(key)
    if (!t) return 1
    // Its own y axis in the world, now and as made: their dot product.
    const y = (q: Quat): Vec3 => [2 * (q[0] * q[1] - q[3] * q[2]), 1 - 2 * (q[0] * q[0] + q[2] * q[2]), 2 * (q[1] * q[2] + q[3] * q[0])]
    const a = y(this.core.rotation(t.body)), b = y(t.home.q)
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  }

  restartToy(toy: string) {
    if (!this.frames.has(toy)) return false
    for (const t of this.things.values()) {
      if (t.toy !== toy || t.part.motion !== 'dynamic') continue
      this.core.setState(t.body, t.home.p, [0, 0, 0], t.home.q)
      this.respawns.delete(t.key)
    }
    for (const g of this.gadgets.values()) {
      const kind = g.toy === toy ? gadgetKind(g.spec.kind) : undefined
      if (kind?.inputs.includes('reset')) kind.receive?.(g, 'reset', { value: 0 }, this)
    }
    return true
  }

  toWorldDir(toy: string, dir: Vec3): Vec3 {
    const frame = this.frames.get(toy)
    return frame ? arr(v3(dir).transformDirection(frame)) : dir
  }

  signals() {
    return Object.fromEntries(this.tally)
  }

  mesh(key: string) {
    return this.things.get(key)?.mesh
  }

  /**
   * Where each moving thing is now (toy parts and bound things; followers go where their figures go):
   * what whoever draws this world somewhere else is sent (the street, #118). Only the ones awake,
   * unless `asleep` asks for the sleeping ones too.
   */
  poses(asleep = false): { key: string; position: Vec3; rotation: Quat; awake: boolean }[] {
    const out: { key: string; position: Vec3; rotation: Quat; awake: boolean }[] = []
    const add = (key: string, body: BodyId) => {
      const awake = !this.core.sleeping(body)
      if (awake || asleep) out.push({ key, position: this.core.position(body), rotation: this.core.rotation(body), awake })
    }
    for (const t of this.things.values()) if (t.part.motion && t.part.motion !== 'static') add(t.key, t.body)
    for (const b of this.bound.values()) if (b.motion === 'dynamic') add(b.key, b.body)
    return out
  }

  /** A gadget's own numbers (a copy), or null for an unknown gadget. */
  state(gadget: string): Record<string, number> | null {
    const g = this.gadgets.get(gadget)
    return g ? { ...g.state } : null
  }

  /** Each counter-like gadget's `value` state. */
  counters() {
    const out: Record<string, number> = {}
    for (const [id, g] of this.gadgets) if ('value' in g.state) out[id] = g.state.value
    return out
  }

  knobs() {
    return [...this.gadgets.values()].filter((g) => gadgetKind(g.spec.kind) && Object.keys(g.knobs).length).map((g) => ({ id: g.id, kind: g.spec.kind, knobs: { ...g.knobs }, ranges: gadgetKind(g.spec.kind)!.knobs }))
  }

  // ── Heat and fire ────────────────────────────────────────────────────────

  /**
   * Every part that takes heat, with its box in the world now: each toy part, and each bound
   * thing's named parts plus the rest of it. Followers (villagers) are not burnables.
   */
  burnables(movingOnly = false): Burnable[] {
    const out: Burnable[] = []
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), c = new THREE.Vector3(), h = new THREE.Vector3()
    const push = (id: string, thing: string, part: string, mat: string, moving: boolean) => {
      if (box3.isEmpty()) return
      box3.getCenter(c)
      box3.getSize(h).multiplyScalar(0.5)
      out.push({ id, thing, part, material: mat, center: arr(c), half: arr(h), moving })
    }
    for (const t of this.things.values()) {
      if (t.part.sensor || t.part.hidden || (movingOnly && t.part.motion !== 'dynamic')) continue
      const pos = this.core.position(t.body), rot = this.core.rotation(t.body)
      boxPose.compose(v3(pos), q.set(rot[0], rot[1], rot[2], rot[3]), one)
      box3.makeEmpty()
      if (t.part.shape.kind === 'compound') for (const b of t.part.shape.boxes) growBy(box3, boxPose, b.half, b.at, b.rotation)
      else growBy(box3, boxPose, halfOf(t.part.shape), [0, 0, 0], [0, 0, 0, 1])
      push(t.key, t.key, '', t.part.material, t.part.motion === 'dynamic')
    }
    // Asked for the moving ones only (fire asks every frame), a bound thing counts if it has been posed since the
    // last such ask: a house of sleeping mugs costs nothing here.
    const boundNow = movingOnly ? [...this.posed] : this.bound.values()
    if (movingOnly) this.posed.clear()
    for (const b of boundNow) {
      if (movingOnly && b.motion !== 'dynamic') continue
      if (b.motion === 'dynamic') {
        const pos = this.core.position(b.body), rot = this.core.rotation(b.body)
        p.set(pos[0], pos[1], pos[2])
        q.set(rot[0], rot[1], rot[2], rot[3])
      } else {
        b.object.updateWorldMatrix(true, false)
        b.object.matrixWorld.decompose(p, q, h)
      }
      boxPose.compose(p, q, one)
      const boxes = b.shape.kind === 'compound' ? b.shape.boxes : [{ half: halfOf(b.shape), at: [0, 0, 0] as Vec3, rotation: [0, 0, 0, 1] as Quat }]
      const named = new Set<number>()
      for (const part of b.parts ?? []) {
        box3.makeEmpty()
        for (const i of part.boxes) {
          const x = boxes[i]
          if (!x) continue
          named.add(i)
          growBy(box3, boxPose, x.half, x.at, x.rotation)
        }
        push(`${b.key}:${part.name}`, b.key, part.name, material(part.material) ? part.material : b.material, b.motion === 'dynamic')
      }
      if (named.size === boxes.length) continue
      box3.makeEmpty()
      boxes.forEach((x, i) => named.has(i) || growBy(box3, boxPose, x.half, x.at, x.rotation))
      push(b.key, b.key, '', b.material, b.motion === 'dynamic')
    }
    return out
  }

  /** Sets a thing (or one named part of it) alight. Null, or why not. */
  ignite(key: string, part?: string, by: 'ask' | 'gadget' | 'code' = 'code') {
    return this.burner ? this.burner.ignite(key, part, by) : 'fire is not running'
  }

  /** Puts water on a thing (or one named part): it puts out what burns and wets the rest. Null, or why not. */
  douse(key: string, part?: string, by: 'ask' | 'gadget' | 'code' = 'code') {
    return this.burner ? this.burner.douse(key, part, by) : 'fire is not running'
  }

  /** Rain over the whole home for some seconds. Null, or why not. */
  rain(seconds: number) {
    return this.burner ? this.burner.rain(seconds) : 'fire is not running'
  }

  /** Lightning: a burst of great heat at a thing (or part). What burns there catches; metal only gets hot. Null, or why not. */
  strike(key: string, part?: string) {
    return this.burner ? this.burner.strike(key, part) : 'fire is not running'
  }

  /** Whether any part of a thing is burning. */
  burning(key: string) {
    return this.burner?.burning(key) ?? false
  }

  // ── Undo ─────────────────────────────────────────────────────────────────

  snapshot(): Snapshot {
    const things: Snapshot['things'] = {}
    for (const t of [...this.things.values(), ...this.bound.values()]) if (('part' in t ? t.part.motion : t.motion) === 'dynamic') things[t.key] = { p: this.core.position(t.body), q: this.core.rotation(t.body), v: this.core.velocity(t.body) }
    const gadgets: Snapshot['gadgets'] = {}
    for (const g of this.gadgets.values()) gadgets[g.id] = { knobs: { ...g.knobs }, state: { ...g.state } }
    return { clock: this.clock, rules: { ...this.rules, gravity: [...this.rules.gravity] }, things, gadgets, respawns: [...this.respawns].map(([key, t]) => ({ key, t })), ...(this.burner ? { fire: this.burner.snapshot() } : {}) }
  }

  /**
   * Puts moving things (toys' and bound ones), gadget knobs and state, pending respawns and the rules back as a snapshot
   * had them. A snapshot is data like any other: rules go through checkRules, poses must be
   * finite and inside the world, speeds are held to the speed limit, knobs to their ranges.
   * What could not be used is skipped and listed in `clamped`. Spin is not kept.
   */
  restore(s: Snapshot): { clamped: string[] } {
    const clamped: string[] = []
    if (!s || typeof s !== 'object') return { clamped: ['snapshot'] }
    const checked = checkRules(s.rules, this.rules)
    if ('reason' in checked) clamped.push('rules')
    else {
      this.applyRules(checked.rules)
      clamped.push(...checked.clamped)
      this.emit({ kind: 'rules', rules: this.rules, by: 'code', clamped: checked.clamped })
    }
    const num = (v: unknown, n: number): v is number[] => Array.isArray(v) && v.length === n && v.every((x) => typeof x === 'number' && Number.isFinite(x))
    for (const [key, b] of Object.entries(s.things ?? {})) {
      const t = this.dynamic(key) ?? this.boundDynamic(key)
      if (!t || !b || !num(b.p, 3) || !pointOk(b.p as Vec3) || !num(b.v, 3) || !num(b.q, 4) || !(Math.hypot(...b.q) > 1e-6)) {
        clamped.push(`things.${key}`)
        continue
      }
      const speed = Math.hypot(...b.v), k = speed > this.rules.maxSpeed ? this.rules.maxSpeed / speed : 1
      const n = Math.hypot(...b.q)
      // A thing asleep where the snapshot has it stays asleep: putting a quiet house back wakes nothing.
      if (speed < 1e-6 && this.core.sleeping(t.body)) {
        const at = this.core.position(t.body), turn = this.core.rotation(t.body)
        if (Math.hypot(at[0] - b.p[0], at[1] - b.p[1], at[2] - b.p[2]) < 1e-5 && 1 - Math.abs(turn[0] * b.q[0] + turn[1] * b.q[1] + turn[2] * b.q[2] + turn[3] * b.q[3]) / (n * Math.hypot(...turn)) < 1e-9) continue
      }
      this.core.setState(t.body, b.p as Vec3, [b.v[0] * k, b.v[1] * k, b.v[2] * k], [b.q[0] / n, b.q[1] / n, b.q[2] / n, b.q[3] / n])
    }
    for (const [id, saved] of Object.entries(s.gadgets ?? {})) {
      const g = this.gadgets.get(id)
      if (!g || !saved) continue
      // Joint handles are the world's, not the experiment's: keep them.
      const state: Record<string, number> = {}
      for (const [name, v] of Object.entries(saved.state ?? {})) if (name !== 'joint' && typeof v === 'number' && Number.isFinite(v)) state[name] = v
      g.state = { ...state, ...('joint' in g.state ? { joint: g.state.joint } : {}) }
      for (const [name, v] of Object.entries(saved.knobs ?? {})) if (!this.applyKnob(g, name, v)) clamped.push(`${id}.${name}`)
      const display = g.spec.display
      if (typeof display === 'string' && 'value' in g.state) this.show(`${g.toy}/${display}`, digits(g.state.value))
    }
    this.respawns = new Map((Array.isArray(s.respawns) ? s.respawns : []).filter((r) => r && this.dynamic(r.key) && typeof r.t === 'number' && Number.isFinite(r.t)).map((r) => [r.key, r.t]))
    if (typeof s.clock === 'number' && Number.isFinite(s.clock)) this.clock = s.clock
    this.queue.length = 0
    // Fire is put back as the snapshot had it, or out everywhere when it had none; the heat field starts cold either way.
    if (this.burner) clamped.push(...this.burner.restore(s.fire))
    return { clamped }
  }

  /** Every moving thing home and every gadget that takes a `reset` back as it started (a counter, a game, a lamp). The rules and knobs stay as tuned. */
  reset() {
    for (const t of this.things.values()) if (t.part.motion === 'dynamic') this.core.setState(t.body, t.home.p, [0, 0, 0], t.home.q)
    this.respawns.clear()
    this.queue.length = 0
    for (const g of this.gadgets.values()) {
      const kind = gadgetKind(g.spec.kind)
      if (kind?.inputs.includes('reset')) kind.receive?.(g, 'reset', { value: 0 }, this)
    }
  }

  stats(): Stats {
    return {
      stepMs: { median: quantile(this.stepTimes, 0.5), p95: quantile(this.stepTimes, 0.95), n: this.stepTimes.length },
      frameMs: { median: quantile(this.frameTimes, 0.5), p95: quantile(this.frameTimes, 0.95), n: this.frameTimes.length },
      bodies: this.things.size + this.followers.size + this.bound.size,
      followers: this.followers.size,
      static: [...this.things.values()].filter((t) => (t.part.motion ?? 'static') === 'static').length + [...this.bound.values()].filter((b) => b.motion === 'static').length,
      dynamic: [...this.things.values()].filter((t) => t.part.motion === 'dynamic').length + [...this.bound.values()].filter((b) => b.motion === 'dynamic').length + this.followers.size,
    }
  }

  clearStats() {
    this.stepTimes.length = this.frameTimes.length = 0
  }

  dispose() {
    this.disposed = true
    this.unsubscribe()
    // A walker held back as the world goes would wait for a body that no longer exists (src/villagers/cast.ts).
    for (const f of this.followers.values()) delete f.object.userData.held
    for (const d of this.displays.values()) d.texture.dispose()
    for (const glow of this.glows.values()) glow.dispose()
    this.core.dispose()
  }
}
