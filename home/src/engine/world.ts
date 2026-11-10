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
import { gadgetKind } from './gadgets'
import { material, materialNames, materialsVersion } from './materials'
import { checkRules, NORMAL, onRuleAdded, presetRules, type Rules } from './rules'
import { checkToy, WORLD_BOUND, type PartSpec, type Signal, type ToySpec } from './toy'

const STEP = 1 / 60
const MAX_STEPS = 4
/** Below this (N·s, after the impact rule) an impact is not reported. */
const IMPACT_MIN = 0.003
/** Below the floor by this much, a thing has fallen out of the world and is put back. */
const LOST_Y = -1
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

interface Thing {
  key: string
  toy: string
  part: PartSpec
  body: BodyId
  mesh?: THREE.Mesh
  home: { p: Vec3; q: Quat }
  wobble: number
}

interface Follower { key: string; object: THREE.Object3D; body: BodyId; lift: number; radius: number; material: string; mass: number; last: THREE.Vector3; walked: number; left: boolean; solid: boolean; heldFor: number; aim: THREE.Vector3; passing: boolean; sent: Vec3 }

/** A body that stands for a scene object drawn by someone else (src/physics/home.ts binds the home's things). */
interface Bound { key: string; object: THREE.Object3D; body: BodyId; material: string; motion: 'static' | 'dynamic'; shape: Shape; outline: Shape; p: THREE.Vector3; q: THREE.Quaternion; home: { p: Vec3; q: Quat }; parts?: BindSpec['parts']; woke?: () => void; slept?: (home: boolean) => void }
/** A thing held by a hand (hold): where it is drawn to, and the most force that draws it. */
interface Hold { to: Vec3; strength: number }
/** How fast (1/s) a held thing closes on where it is held to, its top speed (m/s), and how fast it is turned upright (1/s). */
const HOLD_RATE = 14
const HOLD_SPEED = 9
const HOLD_UPRIGHT = 9
/** A moving bound thing that comes to rest within this (m) of where it was made is set there exactly. */
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
const halfOf = (shape: Shape): Vec3 => shape.kind === 'box' ? shape.half : shape.kind === 'sphere' ? [shape.radius, shape.radius, shape.radius]
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
  private pairs = new Map<string, readonly [number, number]>()
  private pairsVersion = -1
  private clampedAt = new Map<string, number>()
  private dust: { mesh: THREE.Mesh; life: number; v: THREE.Vector3 }[] = []
  /** A part's face drawn as a card (a score): its canvas, texture and material, and the text it should show next frame when changed. */
  private displays = new Map<string, { canvas: HTMLCanvasElement; texture: THREE.CanvasTexture; material: THREE.MeshStandardMaterial; text: string; drawn: string | null }>()
  private looks = new Map<string, THREE.Material>()
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

  /** `emit` receives every event; `grain`, when given, paints wood (else wood is flat colour). */
  constructor(private core: PhysicsCore, private emit: (e: PhysicsEvent) => void, private grain?: Grain) {
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
    this.rules = { ...next, gravity: [...next.gravity] }
    this.core.setGravity(this.rules.gravity)
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
    for (const part of toy.parts) if (!material(part.material)) throw new Error(`${toy.id}/${part.id}: no material ${part.material}`)
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
    const frame = new THREE.Matrix4().compose(v3(toy.frame.at), new THREE.Quaternion().setFromEuler(new THREE.Euler(toy.frame.tilt, toy.frame.yaw, 0, 'YXZ')), new THREE.Vector3(1, 1, 1))
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
      const body = this.core.addBody({
        shape: part.shape, motion: part.motion ?? 'static', position: home.p, rotation: home.q,
        density: mat.density, friction: mat.friction, restitution: mat.restitution, linearDamping: this.rules.drag, sensor: part.sensor, ...(part.mass !== undefined ? { mass: part.mass } : {}),
      })
      const thing: Thing = { key: `${toy.id}/${part.id}`, toy: toy.id, part, body, home, wobble: 0 }
      if (!part.hidden && (part.motion ?? 'static') === 'static' && !named.has(part.id)) {
        const look = this.look(part)
        const key = `${part.material}:${part.paint ?? ''}`
        const group = merged.get(key) ?? merged.set(key, { look, parts: [] }).get(key)!
        group.parts.push(this.geometry(part.shape).applyMatrix4(m))
      } else if (!part.hidden) {
        thing.mesh = new THREE.Mesh(this.geometry(part.shape), this.look(part))
        thing.mesh.name = thing.key
        thing.mesh.position.copy(p)
        thing.mesh.quaternion.copy(q)
        thing.mesh.castShadow = thing.mesh.receiveShadow = true
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
    return { things: this.things.size, gadgets: this.gadgets.size, joints, wires: this.wires.size, looks: this.looks.size, displays: this.displays.size, draws: this.draws, toys: this.frames.size }
  }

  /** Whether a toy with this id is built. */
  hasToy(id: string) {
    return this.frames.has(id)
  }

  /** Everything of a toy out of the world again: joints, bodies, meshes, gadgets, wires, displays. */
  removeToy(id: string) {
    this.version++
    const lookOf = (part: PartSpec) => `${part.material}:${part.paint ?? ''}`
    const itsLooks = new Set([...this.things.values()].filter((t) => t.toy === id).map((t) => lookOf(t.part)))
    for (const joint of this.joints.get(id) ?? []) this.core.removeJoint(joint)
    this.joints.delete(id)
    for (const [key, t] of this.things) {
      if (t.toy !== id) continue
      this.core.removeBody(t.body)
      this.byBody[t.body] = undefined
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
    for (const [key, d] of this.displays) {
      if (!mine(key)) continue
      d.texture.dispose()
      d.material.dispose()
      this.displays.delete(key)
    }
    for (const mesh of this.scenery.get(id) ?? []) {
      this.group.remove(mesh)
      mesh.geometry.dispose()
    }
    this.scenery.delete(id)
    this.frames.delete(id)
    // A drawn look (and its painted grain) only this toy used goes with it: made toys come in many colours.
    for (const t of this.things.values()) itsLooks.delete(lookOf(t.part))
    for (const key of itsLooks) {
      const look = this.looks.get(key) as THREE.MeshStandardMaterial | undefined
      if (!look) continue
      look.map?.dispose()
      look.dispose()
      this.looks.delete(key)
    }
  }

  private geometry(shape: Shape): THREE.BufferGeometry {
    if (shape.kind === 'compound') throw new Error('a compound shape is not drawn')
    if (shape.kind === 'sphere') return new THREE.SphereGeometry(shape.radius, 24, 16)
    if (shape.kind === 'cylinder') return new THREE.CylinderGeometry(shape.radius, shape.radius, shape.halfHeight * 2, 28)
    if (shape.kind === 'capsule') return new THREE.CapsuleGeometry(shape.radius, shape.halfHeight * 2, 6, 16)
    const [x, y, z] = shape.half
    return new RoundedBoxGeometry(x * 2, y * 2, z * 2, 2, Math.min(0.006, 0.45 * Math.min(x, y, z)))
  }

  /** One drawn material per material and paint; wood gets a grain painted from its colour. */
  private look(part: PartSpec): THREE.Material {
    const key = `${part.material}:${part.paint ?? ''}`
    const known = this.looks.get(key)
    if (known) return known
    const l = material(part.material)!.look
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
    d.text = String(text).slice(0, 12)
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
    g.font = '600 104px "Iowan Old Style", Palatino, Georgia, serif'
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
    const b: Bound = { key, object, body, material: spec.material, motion: spec.motion, shape: spec.shape, outline: outline(spec.shape), p, q, home: { p: arr(p), q: [q.x, q.y, q.z, q.w] }, parts: spec.parts, woke: spec.woke, slept: spec.slept }
    this.bound.set(key, b)
    this.byBody[body] = b
    this.version++
    return true
  }

  unbind(key: string) {
    const b = this.bound.get(key)
    if (!b) return
    this.core.removeBody(b.body)
    this.byBody[b.body] = undefined
    this.bound.delete(key)
    this.stirring.delete(b)
    this.holds.delete(b)
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
        // settled, or was put back by hand), it is set there exactly: the house stays as it was drawn.
        this.pose(b)
        this.stirring.delete(b)
        const home = this.isHome(b, NEARLY_HOME, 3e-4)
        if (home) {
          this.core.rest(b.body, b.home.p, b.home.q)
          this.pose(b)
        }
        b.slept?.(home)
      }
    }
  }

  /** Draws a held thing towards where it is held with at most the hold's force, and turns it upright. */
  private pull(b: Bound, hold: Hold, h: number) {
    const p = this.core.position(b.body), v = this.core.velocity(b.body)
    const mass = this.core.mass(b.body)
    const want = hold.to.map((x, i) => (x - p[i]) * HOLD_RATE)
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
   * space) with at most `strength` newtons, step after step, until hold(key, null) lets it go
   * with the speed it has. A thing too heavy for the hand drags and tips instead of rising.
   */
  hold(key: string, to: Vec3 | null, strength = 60) {
    const b = this.boundDynamic(key)
    if (!b) return false
    if (!to) return this.holds.delete(b)
    if (!pointOk(to) || !(strength > 0)) return false
    const held = this.holds.get(b)
    if (held) {
      held.to = [...to]
      held.strength = strength
    } else {
      this.holds.set(b, { to: [...to], strength })
      // Woken with the speed it has (none): the first step draws it.
      this.core.setVelocity(b.body, this.core.velocity(b.body))
      this.core.applyImpulse(b.body, [0, 1e-6, 0])
    }
    return true
  }

  /** The moving bound things a hand may take: each one's key, where it is (world space) and the half sizes of the box round it. */
  movables(): { key: string; at: Vec3; half: Vec3 }[] {
    const out: { key: string; at: Vec3; half: Vec3 }[] = []
    for (const b of this.bound.values()) if (b.motion === 'dynamic') out.push({ key: b.key, at: [b.p.x, b.p.y, b.p.z], half: halfOf(b.outline) })
    return out
  }

  /** The scene object a bound thing's body stands for. */
  boundObject(key: string) {
    return this.bound.get(key)?.object
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
      return t ? [t.body] : []
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
      this.holds.delete(b)
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
      if (d > by || turned > 0.002) out[b.key] = d
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
      else this.core.setState(b.body, at, [0, 0, 0], turn)
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

  /** One rendered frame: real seconds in, simulated time out by the rules' time scale. */
  frame(dt: number) {
    const t0 = performance.now()
    this.follows()
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
    return 'part' in t ? t.part.shape : 'outline' in t ? t.outline : { kind: 'cylinder', halfHeight: t.lift, radius: t.radius }
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
      if (!(p.every(Number.isFinite) && p[1] >= LOST_Y && Math.abs(p[0]) <= WORLD_BOUND && Math.abs(p[2]) <= WORLD_BOUND && p[1] <= WORLD_BOUND)) {
        this.holds.delete(b)
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
      const lost = !p.every(Number.isFinite) || !Number.isFinite(speed) || p[1] < LOST_Y || p[1] > WORLD_BOUND || Math.abs(p[0]) > WORLD_BOUND || Math.abs(p[2]) > WORLD_BOUND
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
    const p = this.core.position(b.body), q = this.core.rotation(b.body)
    b.p.set(p[0], p[1], p[2])
    b.q.set(q[0], q[1], q[2], q[3])
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
    for (const b of this.bound.values()) {
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
      if (typeof display === 'string' && 'value' in g.state) this.show(`${g.toy}/${display}`, String(g.state.value).padStart(5, '0'))
    }
    this.respawns = new Map((Array.isArray(s.respawns) ? s.respawns : []).filter((r) => r && this.dynamic(r.key) && typeof r.t === 'number' && Number.isFinite(r.t)).map((r) => [r.key, r.t]))
    if (typeof s.clock === 'number' && Number.isFinite(s.clock)) this.clock = s.clock
    this.queue.length = 0
    // Fire is put back as the snapshot had it, or out everywhere when it had none; the heat field starts cold either way.
    if (this.burner) clamped.push(...this.burner.restore(s.fire))
    return { clamped }
  }

  /** Every moving thing home and every counter to zero. The rules and knobs stay as tuned. */
  reset() {
    for (const t of this.things.values()) if (t.part.motion === 'dynamic') this.core.setState(t.body, t.home.p, [0, 0, 0], t.home.q)
    this.respawns.clear()
    this.queue.length = 0
    for (const g of this.gadgets.values()) if ('value' in g.state) gadgetKind(g.spec.kind)?.receive?.(g, 'reset', { value: 0 }, this)
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
    this.core.dispose()
  }
}
