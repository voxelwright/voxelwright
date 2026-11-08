// The physics world (#74): builds toys (parts, gadgets, wires) into solver bodies and
// three.js meshes, runs the gadget kit and the wires, keeps villagers as kinematic bodies,
// applies the world rules, and reports what happens as `village/physics` events. Fixed
// 60 Hz steps of simulated time; gadget actions are queued during a step and run after it.
import * as THREE from 'three/webgpu'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import type { BodyId, Contact, JointId, PhysicsCore, Quat, Shape, Vec3 } from './core'
import type { At, PhysicsEvent } from './events'
import { MATERIALS, MATERIAL_NAMES, type MaterialName } from './materials'
import { checkRules, NORMAL, PRESETS, type Rules } from './rules'
import { KNOBS, type GadgetSpec, type PartSpec, type Signal, type ToySpec } from './toy'
import { paintWood } from '../paint'

const STEP = 1 / 60
const MAX_STEPS = 4
/** Below this (N·s, after the impact rule) an impact is not reported. */
const IMPACT_MIN = 0.003
/** Below the floor by this much, a thing has fallen out of the world and is put back. */
const LOST_Y = -1

interface Thing {
  key: string
  toy: string
  part: PartSpec
  body: BodyId
  material: number
  mesh?: THREE.Mesh
  home: { p: Vec3; q: Quat }
  wobble: number
}

interface Runtime {
  spec: GadgetSpec
  knobs: Record<string, number>
  toy: string
  thing?: Thing
  joint?: JointId
  /** piston: 0..1 while charging; speed while firing. */
  charge: number
  firing: number
  value: number
}

export interface Stats { stepMs: { median: number; p95: number; n: number }; frameMs: { median: number; p95: number; n: number }; bodies: number; villagers: number }

const v3 = (a: Vec3) => new THREE.Vector3(a[0], a[1], a[2])
const at = (p: Vec3 | THREE.Vector3): At => (Array.isArray(p) ? { x: p[0], y: p[1], z: p[2] } : { x: p.x, y: p.y, z: p.z })
const quantile = (xs: number[], q: number) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return +s[Math.min(s.length - 1, Math.floor(s.length * q))].toFixed(3)
}

export class World {
  readonly group = new THREE.Group()
  private things: Thing[] = []
  private byBody: (Thing | undefined)[] = []
  private byKey = new Map<string, Thing>()
  private gadgets = new Map<string, Runtime>()
  private wires = new Map<string, string[]>()
  private frames = new Map<string, THREE.Matrix4>()
  private held = new Set<string>()
  private queue: { from: string; signal: Signal }[] = []
  private respawns: { thing: Thing; t: number }[] = []
  private villagers = new Map<THREE.Object3D, { body: BodyId; key: string; lift: number }>()
  private pairs: [number, number][] = []
  private clampedAt = new Map<string, number>()
  private dust: { mesh: THREE.Mesh; life: number; v: THREE.Vector3 }[] = []
  private displays = new Map<string, { canvas: HTMLCanvasElement; texture: THREE.CanvasTexture }>()
  private wood = new Map<string, THREE.Texture>()
  private looks = new Map<string, THREE.Material>()
  private accumulator = 0
  private clock = 0
  private stepTimes: number[] = []
  private frameTimes: number[] = []
  rules: Rules = { ...NORMAL, gravity: [...NORMAL.gravity] }

  constructor(private core: PhysicsCore, private emit: (e: PhysicsEvent) => void) {
    this.group.name = 'physics'
    core.setCombine((a, b) => this.pairs[(this.byBody[a]?.material ?? 0) * MATERIAL_NAMES.length + (this.byBody[b]?.material ?? 0)] ?? [0.5, 0.3])
    this.applyRules(this.rules)
    // A small pool of felt dust for impacts.
    const dustMat = new THREE.MeshStandardMaterial({ color: '#e9dcc4', roughness: 1, transparent: true, opacity: 0.8, depthWrite: false })
    const dustGeo = new THREE.SphereGeometry(1, 8, 6)
    for (let i = 0; i < 24; i++) {
      const mesh = new THREE.Mesh(dustGeo, dustMat)
      mesh.visible = false
      this.group.add(mesh)
      this.dust.push({ mesh, life: 0, v: new THREE.Vector3() })
    }
  }

  // ── Rules ────────────────────────────────────────────────────────────────

  /** Checks raw rules over the current ones and applies them all at once; a refused change leaves the world as it was. */
  setRules(raw: unknown, by: Extract<PhysicsEvent, { kind: 'rules' }>['by'], preset?: string): { ok: true; rules: Rules; clamped: string[] } | { ok: false; reason: string } {
    const checked = checkRules(raw, this.rules)
    if ('reason' in checked) return { ok: false, reason: checked.reason }
    this.applyRules(checked.rules)
    this.emit({ kind: 'rules', rules: this.rules, by, ...(preset ? { preset } : {}), clamped: checked.clamped })
    return { ok: true, rules: this.rules, clamped: checked.clamped }
  }

  preset(name: string) {
    const p = Object.hasOwn(PRESETS, name) ? PRESETS[name] : undefined
    if (!p) return { ok: false as const, reason: `no preset ${name}` }
    return this.setRules(p.rules, 'preset', name)
  }

  private applyRules(next: Rules) {
    this.rules = { ...next, gravity: [...next.gravity] }
    const r = this.rules
    this.core.setGravity(r.gravity)
    // The combine table: geometric friction, the livelier restitution, both scaled by the rules.
    const n = MATERIAL_NAMES.length
    this.pairs = new Array(n * n)
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const a = MATERIALS[MATERIAL_NAMES[i]], b = MATERIALS[MATERIAL_NAMES[j]]
      this.pairs[i * n + j] = [Math.sqrt(a.friction * b.friction) * r.friction, Math.min(1.2, Math.max(a.restitution, b.restitution) * r.bounce)]
    }
    for (const t of this.things) if (t.part.motion === 'dynamic') this.core.setLinearDamping(t.body, r.drag)
  }

  // ── Building ─────────────────────────────────────────────────────────────

  addToy(toy: ToySpec) {
    const frame = new THREE.Matrix4().compose(v3(toy.frame.at), new THREE.Quaternion().setFromEuler(new THREE.Euler(toy.frame.tilt, toy.frame.yaw, 0, 'YXZ')), new THREE.Vector3(1, 1, 1))
    this.frames.set(toy.id, frame)
    const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3()
    for (const part of toy.parts) {
      m.compose(v3(part.at), new THREE.Quaternion().setFromEuler(new THREE.Euler(...(part.turn ?? [0, 0, 0]))), new THREE.Vector3(1, 1, 1))
      m.premultiply(frame).decompose(p, q, s)
      const mat = MATERIALS[part.material]
      const home = { p: [p.x, p.y, p.z] as Vec3, q: [q.x, q.y, q.z, q.w] as Quat }
      const body = this.core.addBody({
        shape: part.shape, motion: part.motion ?? 'static', position: home.p, rotation: home.q,
        density: mat.density, friction: mat.friction, restitution: mat.restitution, linearDamping: this.rules.drag, sensor: part.sensor,
      })
      const thing: Thing = { key: `${toy.id}/${part.id}`, toy: toy.id, part, body, material: MATERIAL_NAMES.indexOf(part.material), home, wobble: 0 }
      if (!part.hidden) {
        thing.mesh = new THREE.Mesh(this.geometry(part.shape), this.look(part))
        thing.mesh.name = thing.key
        thing.mesh.position.copy(p)
        thing.mesh.quaternion.copy(q)
        thing.mesh.castShadow = thing.mesh.receiveShadow = true
        this.group.add(thing.mesh)
      }
      this.things.push(thing)
      this.byBody[body] = thing
      this.byKey.set(thing.key, thing)
    }
    for (const g of toy.gadgets) {
      const rt: Runtime = { spec: g, knobs: { ...('knobs' in g ? g.knobs : {}) }, toy: toy.id, charge: 0, firing: 0, value: 0 }
      if ('part' in g) {
        rt.thing = this.byKey.get(`${toy.id}/${g.part}`)
        if (!rt.thing) throw new Error(`${toy.id}: gadget ${g.id} names no part ${g.part}`)
      }
      if (g.kind === 'hinge') {
        const anchor = v3(g.anchor).applyMatrix4(frame)
        const axis = v3(g.axis).transformDirection(frame)
        rt.joint = this.core.addHinge({ body: rt.thing!.body, anchor: [anchor.x, anchor.y, anchor.z], axis: [axis.x, axis.y, axis.z], limits: [0, g.knobs.swing], motor: { velocity: -g.knobs.speed, maxTorque: g.knobs.torque } })
      }
      if (g.kind === 'counter' && g.display) this.display(`${toy.id}/${g.display}`, 0)
      this.gadgets.set(`${toy.id}/${g.id}`, rt)
    }
    for (const w of toy.wires) {
      const from = `${toy.id}/${w.from}`
      const list = this.wires.get(from) ?? []
      list.push(`${toy.id}/${w.to}`)
      this.wires.set(from, list)
    }
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
    const l = MATERIALS[part.material].look
    const color = new THREE.Color(part.paint ?? l.color)
    const wooden = part.material === 'maple' || part.material === 'walnut' || part.material === 'lacquer'
    let map: THREE.Texture | undefined
    if (wooden) {
      map = this.wood.get(key)
      if (!map) {
        const rgb = (k: number) => [color.r, color.g, color.b].map((c) => Math.round(Math.min(255, c * 255 * k))) as [number, number, number]
        map = paintWood({ seed: 70 + this.wood.size, w: 256, h: 256, planks: part.material === 'lacquer' ? 1 : 2, light: rgb(1.06), dark: rgb(0.86), knots: part.material === 'walnut' ? 2 : 0 })
        this.wood.set(key, map)
      }
    }
    const material = new THREE.MeshStandardMaterial({ color: wooden ? '#ffffff' : color, roughness: l.roughness, metalness: l.metalness, ...(map ? { map } : {}) })
    this.looks.set(key, material)
    return material
  }

  /** A counter's value drawn on its display part, like a hand-lettered score card. */
  private display(key: string, value: number) {
    const thing = this.byKey.get(key)
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
    g.fillText(String(value).padStart(5, '0'), 256, 96)
    d.texture.needsUpdate = true
  }

  // ── Villagers ────────────────────────────────────────────────────────────

  /** Villagers are kinematic capsules that follow their figures and push what they walk into. */
  syncVillagers(scene: THREE.Object3D) {
    const seen = new Set<THREE.Object3D>()
    scene.traverse((o) => {
      if (typeof o.userData.villagerId !== 'string') return
      seen.add(o)
      if (this.villagers.has(o)) return
      const box = new THREE.Box3().setFromObject(o)
      const size = box.getSize(new THREE.Vector3())
      if (!Number.isFinite(size.y) || size.y <= 0) return
      const radius = Math.min(0.2, Math.max(0.08, 0.35 * Math.max(size.x, size.z)))
      const half = Math.max(0.01, size.y / 2 - radius)
      const root = o.getWorldPosition(new THREE.Vector3())
      const lift = box.min.y - root.y + size.y / 2
      const mat = MATERIALS.villager
      const body = this.core.addBody({ shape: { kind: 'capsule', halfHeight: half, radius }, motion: 'kinematic', position: [root.x, root.y + lift, root.z], density: mat.density, friction: mat.friction, restitution: mat.restitution })
      const key = `villager/${o.userData.villagerId}`
      const thing: Thing = { key, toy: 'villagers', part: { id: key, shape: { kind: 'capsule', halfHeight: half, radius }, material: 'villager', motion: 'kinematic', at: [0, 0, 0] }, body, material: MATERIAL_NAMES.indexOf('villager'), home: { p: [root.x, root.y + lift, root.z], q: [0, 0, 0, 1] }, wobble: 0 }
      this.byBody[body] = thing
      this.villagers.set(o, { body, key, lift })
    })
    for (const [o, v] of this.villagers) if (!seen.has(o)) {
      this.core.removeBody(v.body)
      this.byBody[v.body] = undefined
      this.villagers.delete(o)
    }
  }

  // ── Running ──────────────────────────────────────────────────────────────

  input(name: string, down: boolean) {
    if (down) this.held.add(name)
    else this.held.delete(name)
  }

  setKnob(gadget: string, knob: string, value: number) {
    const rt = this.gadgets.get(gadget)
    const range = KNOBS[knob]
    if (!rt || !range || !Object.hasOwn(rt.knobs, knob) || !Number.isFinite(value)) return false
    rt.knobs[knob] = Math.min(range.max, Math.max(range.min, value))
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
    const r = this.rules
    const t0 = performance.now()
    this.clock += h
    // Villagers: their figures lead, their bodies follow.
    const p = new THREE.Vector3()
    for (const [o, v] of this.villagers) {
      o.getWorldPosition(p)
      this.core.moveKinematic(v.body, [p.x, p.y + v.lift, p.z], [0, 0, 0, 1], h)
    }
    for (const rt of this.gadgets.values()) {
      const g = rt.spec
      if (g.kind === 'hinge') {
        const k = rt.knobs
        this.core.setMotor(rt.joint!, (this.held.has(g.input) ? 1 : -1) * k.speed * Math.min(2, r.kick), k.torque * r.kick)
      } else if (g.kind === 'piston') this.piston(rt, g, h)
    }
    this.core.step(h, r.substeps)
    for (const c of this.core.contacts()) this.contact(c)
    for (let n = 0; this.queue.length && n < 200; n++) {
      const { from, signal } = this.queue.shift()!
      this.deliver(from, signal)
    }
    this.queue.length = 0
    for (let i = this.respawns.length - 1; i >= 0; i--) {
      const s = this.respawns[i]
      if (s.t > this.clock) continue
      this.respawns.splice(i, 1)
      this.core.setState(s.thing.body, s.thing.home.p, [0, 0, 0], s.thing.home.q)
    }
    this.guard()
    this.stepTimes.push(performance.now() - t0)
    if (this.stepTimes.length > 1200) this.stepTimes.splice(0, 600)
  }

  /** A kinematic part pulled back along -axis while held, then shot home at a speed set by how long it was held. */
  private piston(rt: Runtime, g: Extract<GadgetSpec, { kind: 'piston' }>, h: number) {
    const thing = rt.thing!
    const k = rt.knobs
    const frame = this.frames.get(rt.toy)!
    const axis = v3(g.axis).transformDirection(frame)
    const home = v3(thing.home.p)
    if (this.held.has(g.input) && !rt.firing) rt.charge = Math.min(1, rt.charge + h / k.charge)
    else if (rt.charge > 0 && !rt.firing) rt.firing = Math.max(0.05, k.strength * rt.charge * this.rules.kick)
    let back = rt.charge * k.travel
    if (rt.firing) {
      back -= rt.firing * h
      rt.charge = Math.max(0, back / k.travel)
      if (back <= 0) {
        back = 0
        rt.firing = 0
        rt.charge = 0
      }
    }
    const target = home.addScaledVector(axis, -back)
    this.core.moveKinematic(thing.body, [target.x, target.y, target.z], thing.home.q, h)
  }

  private contact(c: Contact) {
    const ta = this.byBody[c.a], tb = this.byBody[c.b]
    if (!ta || !tb) return
    if (c.sensor) {
      for (const [zone, other] of [[ta, tb], [tb, ta]] as const) {
        if (!zone.part.sensor || other.part.motion !== 'dynamic') continue
        for (const [id, rt] of this.gadgets) if (rt.spec.kind === 'zone' && rt.thing === zone) this.fire(id, 'enter', { value: 1, body: other.body, at: c.point })
      }
      return
    }
    const impulse = c.impulse * this.rules.impact
    if (impulse >= IMPACT_MIN) {
      const ma = MATERIALS[ta.part.material], mb = MATERIALS[tb.part.material]
      this.emit({ kind: 'impact', a: ta.key, b: tb.key, materials: [ta.part.material, tb.part.material], at: at(c.point), impulse: c.impulse, hardness: Math.max(ma.hardness, mb.hardness), impact: this.rules.impact })
      this.puff(c.point, impulse)
      for (const t of [ta, tb]) if (t.part.motion !== 'dynamic' && t.mesh) t.wobble = Math.min(1, t.wobble + impulse * 4)
    }
    for (const [part, other, sign] of [[ta, tb, 1], [tb, ta, -1]] as const) {
      for (const [id, rt] of this.gadgets) {
        if (rt.spec.kind !== 'sensor' || rt.thing !== part || c.impulse < rt.knobs.threshold) continue
        this.fire(id, 'hit', { value: c.impulse, body: other.body, dir: [c.normal[0] * sign, c.normal[1] * sign, c.normal[2] * sign], at: c.point })
      }
    }
  }

  /** A gadget output: reported, then carried along its wires. */
  private fire(gadget: string, port: string, signal: Signal) {
    const thing = signal.body !== undefined ? this.byBody[signal.body]?.key : undefined
    this.emit({ kind: 'signal', gadget, port, value: signal.value, ...(thing ? { thing } : {}), ...(signal.at ? { at: at(signal.at) } : {}) })
    this.queue.push({ from: `${gadget}.${port}`, signal })
  }

  private deliver(from: string, signal: Signal) {
    for (const to of this.wires.get(from) ?? []) {
      const dot = to.lastIndexOf('.')
      const rt = this.gadgets.get(to.slice(0, dot))
      const port = to.slice(dot + 1)
      if (!rt) continue
      const g = rt.spec
      if (g.kind === 'kick' && port === 'fire' && signal.body !== undefined && signal.dir) {
        const other = this.byBody[signal.body]
        if (other?.part.motion !== 'dynamic') continue
        const v = this.core.velocity(signal.body)
        const s = rt.knobs.strength * this.rules.kick
        this.core.setVelocity(signal.body, [v[0] + signal.dir[0] * s, v[1] + signal.dir[1] * s, v[2] + signal.dir[2] * s])
        this.fire(to.slice(0, dot), 'kicked', { value: s, body: signal.body })
      } else if (g.kind === 'emitter' && port === 'spawn' && rt.thing) {
        if (!this.respawns.some((r) => r.thing === rt.thing)) this.respawns.push({ thing: rt.thing, t: this.clock + rt.knobs.delay })
        this.fire(to.slice(0, dot), 'spawned', { value: 1 })
      } else if (g.kind === 'counter' && (port === 'add' || port === 'reset')) {
        rt.value = port === 'add' ? rt.value + rt.knobs.step : 0
        if (g.display) this.display(`${rt.toy}/${g.display}`, rt.value)
        this.fire(to.slice(0, dot), 'changed', { value: rt.value })
      }
    }
  }

  /** Too fast is slowed to the speed limit, lost or broken is put back home: never an explosion. */
  private guard() {
    const max = this.rules.maxSpeed
    for (const t of this.things) {
      if (t.part.motion !== 'dynamic') continue
      const p = this.core.position(t.body)
      const v = this.core.velocity(t.body)
      const speed = Math.hypot(...v)
      const lost = !p.every(Number.isFinite) || !Number.isFinite(speed) || p[1] < LOST_Y
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
      d.mesh.scale.setScalar(0.004 + Math.min(0.012, impulse * 0.05))
    }
  }

  /** Meshes follow bodies; wobbles and dust ease out. */
  private sync(dt: number) {
    for (const t of this.things) {
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
      d.mesh.scale.multiplyScalar(1 + dt * 1.5)
      if (d.life <= 0) d.mesh.visible = false
    }
  }

  // ── Reading and resetting ───────────────────────────────────────────────

  /** A thing's position in the world and in its toy's own frame, and its velocity. */
  thing(key: string) {
    const t = this.byKey.get(key)
    if (!t) return null
    const p = this.core.position(t.body)
    const frame = this.frames.get(t.toy)
    const local = frame ? v3(p).applyMatrix4(frame.clone().invert()) : v3(p)
    return { position: p, local: [local.x, local.y, local.z] as Vec3, velocity: this.core.velocity(t.body), body: t.body }
  }

  mesh(key: string) {
    return this.byKey.get(key)?.mesh
  }

  counters() {
    const out: Record<string, number> = {}
    for (const [id, rt] of this.gadgets) if (rt.spec.kind === 'counter') out[id] = rt.value
    return out
  }

  knobs() {
    return [...this.gadgets].filter(([, rt]) => Object.keys(rt.knobs).length).map(([id, rt]) => ({ id, kind: rt.spec.kind, knobs: { ...rt.knobs } }))
  }

  /** Every moving thing home and every counter to zero. The rules and knobs stay as tuned. */
  reset() {
    for (const t of this.things) if (t.part.motion === 'dynamic') this.core.setState(t.body, t.home.p, [0, 0, 0], t.home.q)
    this.respawns.length = 0
    for (const [id, rt] of this.gadgets) if (rt.spec.kind === 'counter') {
      rt.value = 0
      if (rt.spec.display) this.display(`${rt.toy}/${rt.spec.display}`, 0)
      this.fire(id, 'changed', { value: 0 })
    }
  }

  stats(): Stats {
    return {
      stepMs: { median: quantile(this.stepTimes, 0.5), p95: quantile(this.stepTimes, 0.95), n: this.stepTimes.length },
      frameMs: { median: quantile(this.frameTimes, 0.5), p95: quantile(this.frameTimes, 0.95), n: this.frameTimes.length },
      bodies: this.things.length + this.villagers.size,
      villagers: this.villagers.size,
    }
  }

  clearStats() {
    this.stepTimes.length = this.frameTimes.length = 0
  }

  dispose() {
    for (const d of this.displays.values()) d.texture.dispose()
    this.core.dispose()
  }
}
