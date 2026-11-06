// The shared procedural rig: one controller drives every art direction.
// Feet are planned in world space and stay planted while in stance, so a
// walking villager never slides; the body bobs, squashes on footfalls, sways
// over the standing foot and leans into speed and turns.
import * as THREE from 'three/webgpu'
import { route, SEAT_Y, SPOTS } from './world'

/** What an art direction builds. Characters face +z; the rig moves `root`. */
export interface Figure {
  /** World placement and the entry's hit target. Everything else hangs under it. */
  root: THREE.Group
  /** Lean, bob, squash and sit are applied here. Its origin is at the floor. */
  pose: THREE.Group
  head: THREE.Object3D
  /** Scaled flat to blink. */
  eyes: THREE.Object3D[]
  /** Two children of root, or none for a floating villager. */
  feet: THREE.Object3D[]
  /** Children of pose; their rest position is kept in userData.rest. */
  hands: THREE.Object3D[]
  /** Top of the head, standing. */
  height: number
  /** Height of the body's underside above the floor; sitting lowers pose by this. */
  hip: number
  /** Half the distance between the feet. */
  side: number
  /** Metres per gait cycle (two steps). */
  stride: number
  /** Walking speed, metres per second. */
  speed: number
  bob: number
  floats?: boolean
  /** Pose animated on twos: 12 poses a second, like stop motion. */
  stepped?: boolean
  /** Per-frame touches particular to a direction (paper legs, card facing). */
  touch?(v: Villager): void
}

export interface Task { spot: string; stay: number }

type State = 'walk' | 'work' | 'hop' | 'sit'
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
const smooth = (u: number) => u * u * (3 - 2 * u)
const frac = (x: number) => x - Math.floor(x)

interface Foot { world: THREE.Vector3; from: THREE.Vector3; swing: boolean; settle: number }

export class Villager {
  readonly fig: Figure
  readonly pos = new THREE.Vector3()
  yaw = 0
  state: State = 'work'
  /** Chosen by the person: stop, face them, talk. */
  chosen = false
  /** Gait phase in cycles, and the blends the pose reads. */
  phase = 0
  walk = 0
  seated = 0
  working = 0
  talking = 0
  yawRate = 0
  t = 0
  camera = new THREE.Vector3()
  private tasks: Task[]
  private at = 0
  private spot: string
  private curve: THREE.CatmullRomCurve3 | null = null
  private s = 0
  private len = 0
  private v = 0
  private timer = 0
  private hop: { from: THREE.Vector3; to: THREE.Vector3; yaw0: number; yaw1: number; u: number; onto: boolean } | null = null
  private feet: Foot[] = []
  private glance = 0
  private glanceGoal = 0
  private nextGlance = 1
  private blinkAt = 2
  private tick = -1
  private idle: boolean

  /** `idle` villagers stay where they are put (the lineup). */
  constructor(fig: Figure, tasks: Task[], opts: { start: string; seated?: boolean; idle?: boolean; wait?: number; at?: [number, number]; yaw?: number }) {
    this.fig = fig
    this.tasks = tasks
    this.spot = opts.start
    this.idle = Boolean(opts.idle)
    const s = SPOTS[opts.start]
    if (opts.seated && s.seat) {
      this.pos.set(s.seat.x, SEAT_Y, s.seat.z)
      this.yaw = s.seat.yaw
      this.state = 'sit'
      this.seated = 1
      this.timer = tasks[0]?.stay ?? 20
      this.at = tasks.length > 1 ? 1 : 0
    } else {
      const [x, z] = opts.at ?? s.at
      this.pos.set(x, 0, z)
      this.yaw = opts.yaw ?? s.face
      this.timer = opts.wait ?? 0.4
    }
    for (const i of [0, 1]) {
      const w = this.restFoot(i)
      this.feet.push({ world: w, from: w.clone(), swing: false, settle: -1 })
    }
    this.place()
  }

  private forward() { return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)) }
  private right() { return new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw)) }
  private restFoot(i: number) {
    return this.pos.clone().setY(0).addScaledVector(this.right(), (i ? -1 : 1) * this.fig.side)
  }
  private place() {
    const { root } = this.fig
    root.position.copy(this.pos)
    root.rotation.y = this.yaw
    root.updateMatrixWorld(true)
  }

  private next() {
    if (this.idle || !this.tasks.length) return
    const task = this.tasks[this.at]
    this.at = (this.at + 1) % this.tasks.length
    if (task.spot === this.spot) {
      this.startAt(task)
      return
    }
    this.curve = route(this.spot, task.spot)
    this.len = this.curve.getLength()
    this.s = 0
    this.spot = task.spot
    this.timer = task.stay
    this.state = 'walk'
  }

  private startAt(task: Task) {
    const s = SPOTS[task.spot]
    this.timer = task.stay
    if (s.seat) this.beginHop(true)
    else this.state = 'work'
  }

  private beginHop(onto: boolean) {
    const s = SPOTS[this.spot]
    const seat = s.seat!
    const to = onto ? new THREE.Vector3(seat.x, SEAT_Y, seat.z) : new THREE.Vector3(s.at[0], 0, s.at[1])
    const yaw1 = onto ? seat.yaw : s.face
    this.hop = { from: this.pos.clone(), to, yaw0: this.yaw, yaw1: this.yaw + wrap(yaw1 - this.yaw), u: 0, onto }
    this.state = 'hop'
  }

  update(dt: number, t: number, camera: THREE.Vector3) {
    this.t = t
    this.camera.copy(camera)
    const fig = this.fig
    const yaw0 = this.yaw
    const toCamera = Math.atan2(camera.x - this.pos.x, camera.z - this.pos.z)
    let goalYaw = this.yaw

    if (this.state === 'walk' && this.curve) {
      const remaining = this.len - this.s
      const cap = this.chosen ? 0 : Math.min(fig.speed, Math.sqrt(2 * 1.2 * remaining) + 0.04)
      const accel = this.chosen ? 4 : 1.4
      this.v += Math.max(-accel * dt, Math.min(accel * dt, cap - this.v))
      this.v = Math.max(0, this.v)
      this.s = Math.min(this.len, this.s + this.v * dt)
      const p = this.curve.getPointAt(this.s / this.len)
      this.pos.set(p.x, 0, p.z)
      const tan = this.curve.getTangentAt(Math.min(0.999, this.s / this.len))
      goalYaw = Math.atan2(tan.x, tan.z)
      if (this.s >= this.len - 1e-3) {
        this.v = 0
        this.curve = null
        const s = SPOTS[this.spot]
        if (s.seat) this.beginHop(true)
        else this.state = 'work'
      }
    } else if (this.state === 'work') {
      goalYaw = SPOTS[this.spot]?.face ?? this.yaw
      if (!this.chosen && !this.idle) {
        this.timer -= dt
        if (this.timer <= 0) this.next()
      }
    } else if (this.state === 'hop' && this.hop) {
      const h = this.hop
      h.u = Math.min(1, h.u + dt / 0.7)
      // Crouch for the first fifth, fly, land.
      const fly = smooth(Math.max(0, (h.u - 0.2) / 0.8))
      this.pos.lerpVectors(h.from, h.to, fly)
      this.pos.y += Math.sin(fly * Math.PI) * 0.22
      this.yaw = h.yaw0 + (h.yaw1 - h.yaw0) * fly
      goalYaw = this.yaw
      this.seated = h.onto ? fly : 1 - fly
      if (h.u >= 1) {
        this.hop = null
        if (this.seated > 0.5) this.state = 'sit'
        else {
          this.state = 'work'
          this.timer = 0.3
        }
      }
    } else if (this.state === 'sit') {
      goalYaw = SPOTS[this.spot]?.seat?.yaw ?? this.yaw
      if (!this.chosen && !this.idle) {
        this.timer -= dt
        if (this.timer <= 0) this.beginHop(false)
      }
    }
    // A chosen villager turns to the person; seated ones only turn their head.
    if (this.chosen && this.state !== 'sit' && this.state !== 'hop') goalYaw = toCamera
    if (this.idle && !this.chosen) goalYaw = this.yaw
    if (this.state !== 'hop') this.yaw += wrap(goalYaw - this.yaw) * (1 - Math.exp(-dt * (this.state === 'walk' ? 6 : 5)))
    this.yawRate = THREE.MathUtils.lerp(this.yawRate, wrap(this.yaw - yaw0) / Math.max(dt, 1e-3), 1 - Math.exp(-dt * 8))

    const walking = this.state === 'walk' ? Math.min(1, this.v / (fig.speed * 0.5)) : 0
    this.walk = walking
    this.working += ((this.state === 'work' && !this.chosen && !this.idle ? 1 : 0) - this.working) * (1 - Math.exp(-dt * 4))
    this.talking += ((this.chosen ? 1 : 0) - this.talking) * (1 - Math.exp(-dt * 6))
    if (this.state === 'sit') this.seated = 1
    else if (this.state !== 'hop') this.seated = 0
    this.phase += (this.v * dt) / fig.stride
    this.place()
    this.stepFeet(dt)
    this.pose(dt, t, toCamera)
    fig.touch?.(this)
  }

  /** Plant, swing and settle the feet in world space, then express them under root. */
  private stepFeet(dt: number) {
    const fig = this.fig
    if (fig.floats || !fig.feet.length) return
    const fwd = this.forward()
    const lift = fig.stride * 0.16
    const airborne = this.state === 'hop' || this.state === 'sit'
    for (let i = 0; i < 2; i++) {
      const f = this.feet[i]
      const node = fig.feet[i]
      if (airborne) {
        // Feet travel with the body; seated they dangle over the seat edge.
        const k = this.seated
        const local = new THREE.Vector3((i ? -1 : 1) * fig.side * (1 - 0.15 * k), -fig.hip * 0.8 * k + Math.sin(this.t * 2.2 + i * 1.7) * 0.012 * k, 0.17 * k)
        node.position.copy(local)
        f.world.copy(this.fig.root.localToWorld(local.clone()))
        f.world.y = Math.max(0, f.world.y)
        f.swing = false
        f.settle = -1
        continue
      }
      if (this.walk > 0.02) {
        f.settle = -1
        const q = frac(this.phase + i * 0.5)
        if (q >= 0.5) {
          if (!f.swing) {
            f.swing = true
            f.from.copy(f.world)
          }
          let u = (q - 0.5) / 0.5
          if (fig.stepped) u = Math.floor(u * 4) / 4
          const target = this.restFoot(i).addScaledVector(fwd, 0.5 * fig.stride * (1 - u) + 0.25 * fig.stride)
          f.world.lerpVectors(f.from, target, smooth(u))
          f.world.y = Math.sin(u * Math.PI) * lift
        } else if (f.swing) {
          f.swing = false
          f.world.y = 0
        }
      } else {
        if (f.swing) {
          f.swing = false
          f.settle = 0
          f.from.copy(f.world)
        }
        const rest = this.restFoot(i)
        const other = this.feet[1 - i]
        if (f.settle < 0 && other.settle < 0 && f.world.distanceTo(rest) > 0.035) {
          f.settle = 0
          f.from.copy(f.world)
        }
        if (f.settle >= 0) {
          f.settle = Math.min(1, f.settle + dt / 0.2)
          f.world.lerpVectors(f.from, rest, smooth(f.settle))
          f.world.y = Math.sin(f.settle * Math.PI) * lift * 0.6
          if (f.settle >= 1) {
            f.settle = -1
            f.world.y = 0
          }
        }
      }
      node.position.copy(this.fig.root.worldToLocal(f.world.clone()))
    }
  }

  private pose(dt: number, t: number, toCamera: number) {
    const fig = this.fig
    // On twos: hold each pose for a twelfth of a second.
    if (fig.stepped) {
      const tick = Math.floor(t * 12)
      if (tick === this.tick) return
      this.tick = tick
      t = tick / 12
      dt = 1 / 12
    }
    const { pose, head, hands } = fig
    const w = this.walk
    const p = fig.stepped ? Math.floor(this.phase * 8) / 8 : this.phase
    const c = frac(2 * p)
    const pulse = c < 0.25 ? (1 - c / 0.25) ** 2 : 0
    const breathe = Math.sin(t * 2.1) * 0.012
    let sy = 1 + breathe * (1 - w) - 0.08 * pulse * w + 0.035 * Math.sin(Math.PI * c) * w
    let y = fig.bob * Math.sin(Math.PI * c) * w
    let lean = 0.13 * w + this.working * (0.16 + 0.05 * Math.sin(t * 4.5))
    let roll = 0.06 * Math.sin(2 * Math.PI * p) * w + 0.022 * Math.sin(t * 0.45) * (1 - w) * (1 - this.seated)
    roll += THREE.MathUtils.clamp(-this.yawRate * 0.09 * w, -0.2, 0.2)
    if (this.hop) {
      const u = this.hop.u
      const crouch = u < 0.2 ? Math.sin((u / 0.2) * Math.PI) : 0
      const land = u > 0.85 ? Math.sin(((u - 0.85) / 0.15) * Math.PI) : 0
      sy *= 1 - 0.14 * crouch - 0.1 * land + 0.08 * Math.sin(Math.max(0, (u - 0.2) / 0.65) * Math.PI) * (u < 0.85 ? 1 : 0)
    }
    if (fig.floats) y += 0.09 + Math.sin(t * 1.7) * 0.025
    y += -fig.hip * this.seated
    lean -= 0.06 * this.seated
    y += Math.abs(Math.sin(t * 8.5)) * 0.008 * this.talking
    pose.position.set(0.012 * Math.sin(t * 0.45) * (1 - w) * (1 - this.seated), y, 0)
    pose.rotation.set(lean, 0, roll)
    const sxz = 1 + (1 - sy) * 0.5
    pose.scale.set(sxz, sy, sxz)
    // Hands swing against the feet; at work they bob in turn.
    hands.forEach((h, i) => {
      const rest = h.userData.rest as THREE.Vector3
      const s = i ? -1 : 1
      h.position.copy(rest)
      h.position.z += Math.sin(2 * Math.PI * p) * s * fig.stride * 0.18 * w
      h.position.y += (Math.sin(t * 5 + i * Math.PI) * 0.02 * this.working) + 0.03 * this.talking * (i ? 0 : 1) * (0.6 + 0.4 * Math.sin(t * 5))
    })
    // Glances around now and then, and at the person when chosen.
    this.nextGlance -= dt
    if (this.nextGlance <= 0) {
      this.glanceGoal = (Math.random() - 0.5) * 1.0
      this.nextGlance = 1.8 + Math.random() * 3
    }
    const headGoal = this.chosen ? THREE.MathUtils.clamp(wrap(toCamera - this.yaw), -1.1, 1.1) : this.glanceGoal * (1 - w * 0.7)
    this.glance += (headGoal - this.glance) * (1 - Math.exp(-dt * (fig.stepped ? 12 : 5)))
    head.rotation.y = this.glance
    head.rotation.x = this.talking * 0.06 * Math.sin(t * 6) - this.working * 0.15
    // Blink every few seconds.
    this.blinkAt -= dt
    const closed = this.blinkAt < 0.12
    if (this.blinkAt <= 0) this.blinkAt = 2.4 + Math.random() * 3.2
    for (const e of fig.eyes) e.scale.y = closed ? 0.12 : 1
  }
}
