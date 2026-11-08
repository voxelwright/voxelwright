// The physics engine's world (#74), with no app imports. It builds toys (parts, gadgets,
// wires) into solver bodies and three.js meshes, runs gadgets through their kinds' hooks
// (gadgets.ts) and carries their signals along wires, moves followers (kinematic bodies that
// track a scene object, such as a walking person), applies the world rules, guards against
// explosions, and reports what happens as events. It implements the engine API (api.ts).
// Fixed 60 Hz steps of simulated time; gadget actions run after each solver step.
import * as THREE from 'three/webgpu'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
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
/** Gadget signals carried along wires per step; the rest wait for the next step. */
const SIGNALS_PER_STEP = 200
/** Signals waiting past this are dropped (a loop of wires feeding itself faster than it drains). */
const SIGNALS_WAITING = 1000

interface Thing {
  key: string
  toy: string
  part: PartSpec
  body: BodyId
  mesh?: THREE.Mesh
  home: { p: Vec3; q: Quat }
  wobble: number
}

interface Follower { key: string; object: THREE.Object3D; body: BodyId; lift: number; radius: number; material: string; last: THREE.Vector3; walked: number; left: boolean }

export interface Stats { stepMs: { median: number; p95: number; n: number }; frameMs: { median: number; p95: number; n: number }; bodies: number; followers: number }

/** Paints a wood grain texture for a material's colour; the host app may supply one. */
export type Grain = (seed: number, light: [number, number, number], dark: [number, number, number], knots: number, planks: number) => THREE.Texture

const v3 = (a: Vec3) => new THREE.Vector3(a[0], a[1], a[2])
const arr = (p: THREE.Vector3): Vec3 => [p.x, p.y, p.z]
const at = (p: Vec3): At => ({ x: p[0], y: p[1], z: p[2] })
/** A point is finite and inside the world; a direction is finite and not zero. */
const pointOk = (p: Vec3) => Array.isArray(p) && p.length === 3 && p.every((x) => Number.isFinite(x) && Math.abs(x) <= WORLD_BOUND)
const dirOk = (d: Vec3) => Array.isArray(d) && d.length === 3 && d.every(Number.isFinite) && Math.hypot(...d) > 1e-9
const limitsOk = (l: [number, number]) => Array.isArray(l) && l.length === 2 && l.every(Number.isFinite) && l[0] <= l[1]
const quantile = (xs: number[], q: number) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return +s[Math.min(s.length - 1, Math.floor(s.length * q))].toFixed(3)
}

export class World implements WorldApi {
  readonly group = new THREE.Group()
  private things = new Map<string, Thing>()
  private byBody: (Thing | Follower | undefined)[] = []
  private gadgets = new Map<string, Gadget>()
  private byPart = new Map<string, Gadget[]>()
  private wires = new Map<string, string[]>()
  private frames = new Map<string, THREE.Matrix4>()
  private joints = new Map<string, number[]>()
  private droppedAt = -1
  private inputs = new Set<string>()
  private queue: { from: string; signal: Signal }[] = []
  private respawns = new Map<string, number>()
  private followers = new Map<string, Follower>()
  private pairs = new Map<string, readonly [number, number]>()
  private pairsVersion = -1
  private clampedAt = new Map<string, number>()
  private dust: { mesh: THREE.Mesh; life: number; v: THREE.Vector3 }[] = []
  private displays = new Map<string, { canvas: HTMLCanvasElement; texture: THREE.CanvasTexture }>()
  private looks = new Map<string, THREE.Material>()
  private tally = new Map<string, number>()
  private accumulator = 0
  private stepTimes: number[] = []
  private frameTimes: number[] = []
  clock = 0
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
    for (const part of toy.parts) {
      m.compose(v3(part.at), new THREE.Quaternion().setFromEuler(new THREE.Euler(...(part.turn ?? [0, 0, 0]))), new THREE.Vector3(1, 1, 1))
      m.premultiply(frame).decompose(p, q, s)
      const mat = material(part.material)!
      const home = { p: arr(p), q: [q.x, q.y, q.z, q.w] as Quat }
      const body = this.core.addBody({
        shape: part.shape, motion: part.motion ?? 'static', position: home.p, rotation: home.q,
        density: mat.density, friction: mat.friction, restitution: mat.restitution, linearDamping: this.rules.drag, sensor: part.sensor,
      })
      const thing: Thing = { key: `${toy.id}/${part.id}`, toy: toy.id, part, body, home, wobble: 0 }
      if (!part.hidden) {
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
  }

  /** Everything of a toy out of the world again: joints, bodies, meshes, gadgets, wires, displays. */
  private removeToy(id: string) {
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
      this.displays.delete(key)
    }
    this.frames.delete(id)
  }

  private geometry(shape: Shape): THREE.BufferGeometry {
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
      d = { canvas, texture }
      this.displays.set(key, d)
      thing.mesh.material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.8 })
    }
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
    g.fillText(String(text).slice(0, 12), 256, 96)
    d.texture.needsUpdate = true
  }

  // ── Followers ────────────────────────────────────────────────────────────

  /**
   * A kinematic capsule that follows a scene object (a walking person): it pushes what it walks
   * into, and reports a footstep each stride. Sized from the object's bounds when it is added.
   */
  follow(key: string, object: THREE.Object3D, materialName = 'villager') {
    if (this.followers.has(key) || !material(materialName)) return false
    const box = new THREE.Box3().setFromObject(object)
    const size = box.getSize(new THREE.Vector3())
    if (!Number.isFinite(size.y) || size.y <= 0) return false
    const radius = Math.min(0.2, Math.max(0.08, 0.35 * Math.max(size.x, size.z)))
    const root = object.getWorldPosition(new THREE.Vector3())
    const lift = box.min.y - root.y + size.y / 2
    const m = material(materialName)!
    const body = this.core.addBody({ shape: { kind: 'capsule', halfHeight: Math.max(0.01, size.y / 2 - radius), radius }, motion: 'kinematic', position: [root.x, root.y + lift, root.z], density: m.density, friction: m.friction, restitution: m.restitution })
    const f: Follower = { key, object, body, lift, radius, material: materialName, last: root.clone(), walked: 0, left: false }
    this.followers.set(key, f)
    this.byBody[body] = f
    return true
  }

  unfollow(key: string) {
    const f = this.followers.get(key)
    if (!f) return
    this.core.removeBody(f.body)
    this.byBody[f.body] = undefined
    this.followers.delete(key)
  }

  followerKeys() {
    return [...this.followers.keys()]
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
      this.core.moveKinematic(f.body, [p.x, p.y + f.lift, p.z], [0, 0, 0, 1], h)
      this.stride(f, p)
    }
    for (const g of this.gadgets.values()) gadgetKind(g.spec.kind)?.step?.(g, this, h)
    this.core.step(h, this.rules.substeps)
    for (const c of this.core.contacts()) this.contact(c)
    for (let n = 0; this.queue.length && n < SIGNALS_PER_STEP; n++) {
      const { from, signal } = this.queue.shift()!
      for (const to of this.wires.get(from) ?? []) {
        const dot = to.lastIndexOf('.')
        const g = this.gadgets.get(to.slice(0, dot))
        if (g) gadgetKind(g.spec.kind)?.receive?.(g, to.slice(dot + 1), signal, this)
      }
    }
    // The rest wait for the next step. A loop of wires feeding itself faster than that drains is cut here, and said so.
    if (this.queue.length > SIGNALS_WAITING) {
      const signals = this.queue.length - SIGNALS_WAITING
      this.queue.length = SIGNALS_WAITING
      if (this.clock - this.droppedAt > 0.25) {
        this.droppedAt = this.clock
        this.emit({ kind: 'dropped', signals })
      }
    }
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

  private shapeOf(t: Thing | Follower): Shape {
    return 'part' in t ? t.part.shape : { kind: 'capsule', halfHeight: 0, radius: t.radius }
  }

  fire(gadget: Gadget, port: string, signal: Signal) {
    const from = `${gadget.id}.${port}`
    this.tally.set(from, (this.tally.get(from) ?? 0) + 1)
    this.emit({ kind: 'signal', gadget: gadget.id, port, value: signal.value, ...(signal.thing ? { thing: signal.thing } : {}), ...(signal.at ? { at: at(signal.at) } : {}) })
    this.queue.push({ from, signal })
  }

  /** Too fast is slowed to the speed limit, lost (below the floor, past the world bound) or broken is put back home: never an explosion. */
  private guard() {
    const max = this.rules.maxSpeed
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

  /** Meshes follow bodies; wobbles and dust ease out. */
  private sync(dt: number) {
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
    return [...this.things.keys(), ...this.followers.keys()]
  }

  thing(key: string): ThingInfo | null {
    const t = this.things.get(key)
    const f = t ? undefined : this.followers.get(key)
    if (!t && !f) return null
    const body = (t ?? f)!.body
    const p = this.core.position(body)
    const frame = t && this.frames.get(t.toy)
    const local = frame ? arr(v3(p).applyMatrix4(frame.clone().invert())) : p
    return {
      key, toy: t?.toy ?? 'followers', material: t?.part.material ?? f!.material, shape: t ? t.part.shape : this.shapeOf(f!),
      motion: t?.part.motion ?? 'kinematic', position: p, rotation: this.core.rotation(body), velocity: this.core.velocity(body), local,
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

  setVelocity(key: string, v: Vec3) {
    const t = this.dynamic(key)
    if (!t || !v.every(Number.isFinite)) return false
    this.core.setVelocity(t.body, v)
    return true
  }

  applyImpulse(key: string, impulse: Vec3) {
    const t = this.dynamic(key)
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

  // ── Undo ─────────────────────────────────────────────────────────────────

  snapshot(): Snapshot {
    const things: Snapshot['things'] = {}
    for (const t of this.things.values()) if (t.part.motion === 'dynamic') things[t.key] = { p: this.core.position(t.body), q: this.core.rotation(t.body), v: this.core.velocity(t.body) }
    const gadgets: Snapshot['gadgets'] = {}
    for (const g of this.gadgets.values()) gadgets[g.id] = { knobs: { ...g.knobs }, state: { ...g.state } }
    return { clock: this.clock, rules: { ...this.rules, gravity: [...this.rules.gravity] }, things, gadgets, respawns: [...this.respawns].map(([key, t]) => ({ key, t })) }
  }

  /**
   * Puts moving things, gadget knobs and state, pending respawns and the rules back as a snapshot
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
      const t = this.dynamic(key)
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
      bodies: this.things.size + this.followers.size,
      followers: this.followers.size,
    }
  }

  clearStats() {
    this.stepTimes.length = this.frameTimes.length = 0
  }

  dispose() {
    this.unsubscribe()
    for (const d of this.displays.values()) d.texture.dispose()
    this.core.dispose()
  }
}
