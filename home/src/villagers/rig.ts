// The shared procedural rig: one controller drives every art direction.
// Feet are planned in world space and stay planted while in stance, so a
// walking villager never slides; the body bobs, squashes on footfalls, sways
// over the standing foot and leans into speed and turns.
import * as THREE from 'three/webgpu'
import { route, routeFrom, SEAT_Y, SPOTS, type Paths } from './world'
import { theme } from '../theme'
import type { Soft } from './soft'

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
  /** Strength of a soft outline in the owner's colour, 0 to 1, where the direction has one. */
  outline?: { value: number }
  /** A skinned body: a spine that bends and parts that flop (./soft.ts). Without it the figure moves as rigid parts. */
  soft?: Soft | null
}

export interface Task { spot: string; stay: number }

type State = 'walk' | 'work' | 'hop' | 'sit'
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
const smooth = (u: number) => u * u * (3 - 2 * u)
const frac = (x: number) => x - Math.floor(x)

const CHIN = new THREE.Vector3()
const chin = new THREE.Vector3()
const pawsAt = new THREE.Vector3()

interface Foot { world: THREE.Vector3; from: THREE.Vector3; swing: boolean; settle: number }

/** A damped spring chasing a target: under-damped, so what it drives overshoots and settles. */
class Spring {
  x = 0
  v = 0
  constructor(private hz: number, private damping: number) {}
  step(target: number, dt: number) {
    const w = 2 * Math.PI * this.hz
    this.v += (w * w * (target - this.x) - 2 * this.damping * w * this.v) * dt
    this.x += this.v * dt
    return this.x
  }
}
const tipWorld = new THREE.Vector3()
const hingeWorld = new THREE.Vector3()
const restDir = new THREE.Vector3()
const nowDir = new THREE.Vector3()

export class Villager {
  readonly fig: Figure
  readonly pos = new THREE.Vector3()
  yaw = 0
  state: State = 'work'
  /** Chosen by the person: stop, face them, talk. */
  chosen = false
  /** Someone is standing just ahead on the path: wait for them. */
  blocked = false
  /** The person's pointer is on it: pause, so it is easy to click. */
  paused = false
  /** Sent somewhere by the person (a chair at the table): stays there until released. */
  held = false
  /** Stays at its chore a while longer (out of someone else's conversation). */
  linger = false
  /** Sideways step off its path, to pass around someone in the way; set by the crowd. */
  readonly sidestep = new THREE.Vector3()
  /** Where the path itself is, before any sidestep. */
  readonly onPath = new THREE.Vector3()
  /** Waiting on its own words: looks up and taps its chin. */
  thinking = false
  /** Holding a note it has just been given: both paws bring it up in front, and it looks down at it (#42). */
  reading = false
  /** Saying something right now: leans in and nods. */
  speaking = false
  /** Someone else at the table is speaking: where they are, so it turns its head to listen (#42). */
  listenTo: THREE.Vector3 | null = null
  /** Being written to from across the room: turns part way to the person and looks up. */
  attending = false
  /** Called when a chore at a spot is finished, before moving on. */
  onDone?: (spot: string) => void
  /** Called as a hop onto (true) or off (false) a seat starts; it lands 0.7 s later (#52 sound). */
  onHop?: (onto: boolean) => void
  /** Gait phase in cycles, and the blends the pose reads. */
  phase = 0
  walk = 0
  seated = 0
  working = 0
  talking = 0
  think = 0
  read = 0
  speak = 0
  yawRate = 0
  t = 0
  camera = new THREE.Vector3()
  private tasks: Task[]
  private at = 0
  /** The spot it is at or walking to. */
  spot: string
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
  private paths: Paths
  /** Where to walk once a hop off a chair lands. */
  private pending: string | null = null
  /** Progress of the short "oh, hello" hop; 1 is at rest. */
  private beatU = 1
  /** Progress of a glance and a little wave at the person; 1 is at rest. */
  private greetU = 1
  /** Progress of a nod (a pass at the table, #42); 1 is at rest. */
  private nodU = 1
  /** The gather before a walk: 0 as it starts to crouch, 1 once it is off. */
  private windU = 1
  /** Forward acceleration, m/s², smoothed; the soft body's upper half trails it. */
  private accel = 0
  private readonly trail = new Spring(1.9, 0.32)
  private readonly sway = new Spring(1.6, 0.35)
  private readonly bounce = new Spring(2.6, 0.28)
  private readonly settleSpring = new Spring(2.2, 0.3)
  /** Height it sits at on a chair: the bare seat, or a booster cushion on it. */
  readonly seatY: number

  /** `idle` villagers stay where they are put (the lineup). */
  constructor(fig: Figure, tasks: Task[], opts: { start: string; seated?: boolean; idle?: boolean; wait?: number; at?: [number, number]; yaw?: number; paths?: Paths; seatY?: number }) {
    this.fig = fig
    this.seatY = opts.seatY ?? SEAT_Y
    this.tasks = tasks
    this.spot = opts.start
    this.idle = Boolean(opts.idle)
    this.paths = opts.paths ?? 'kitchen'
    const s = SPOTS[opts.start]
    if (opts.seated && s.seat) {
      this.pos.set(s.seat.x, this.seatY, s.seat.z)
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

  /** Poses per second when held (12 is on twos): the theme's, else 12 for directions drawn that way; 0 animates every frame. */
  private get fps() { return theme().motion.characterFps ?? (this.fig.stepped ? 12 : 0) }
  private forward() { return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)) }
  private right() { return new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw)) }
  /** Root scale: figures are modelled in their own units and placed larger or smaller. */
  private get k() { return this.fig.root.scale.x }
  private restFoot(i: number) {
    return this.pos.clone().setY(0).addScaledVector(this.right(), (i ? -1 : 1) * this.fig.side * this.k)
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
    this.curve = route(this.spot, task.spot, this.paths)
    this.len = this.curve.getLength()
    this.s = 0
    this.spot = task.spot
    this.timer = task.stay
    this.state = 'walk'
    this.windU = 0
  }

  /** Walk to a spot (a chair: sit on it) and stay there until released. */
  sendTo(spot: string) {
    this.held = true
    this.chosen = false
    if (this.spot === spot && this.state !== 'walk') {
      if (SPOTS[spot].seat && this.state === 'work') this.beginHop(true)
      return
    }
    if (this.state === 'sit' || this.state === 'hop') {
      this.pending = spot
      if (this.state === 'sit') this.beginHop(false)
      return
    }
    this.walkTo(spot)
  }

  /** Back to its chores: off the chair after a moment, then the next task. */
  release(delay = 0.4) {
    this.held = false
    this.pending = null
    this.timer = Math.min(this.timer, delay)
  }

  /** A short hop of recognition when someone turns to it. */
  beat() {
    this.beatU = 0
  }

  /** Two small nods: agreeing without a word. */
  nod() {
    this.nodU = 0
  }

  /** Look up from the chore, turn a little to the person and wave. */
  greet() {
    if (this.greetU >= 1) this.greetU = 0
  }

  /** How far it would walk to reach a spot from where it stands. */
  distanceTo(spot: string) {
    return this.spot === spot ? 0 : routeFrom(this.pos.x, this.pos.z, spot, this.paths).getLength()
  }

  private walkTo(spot: string) {
    this.curve = routeFrom(this.pos.x, this.pos.z, spot, this.paths)
    this.len = this.curve.getLength()
    this.s = 0
    this.spot = spot
    this.state = 'walk'
    if (this.v < 0.01) this.windU = 0
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
    const to = onto ? new THREE.Vector3(seat.x, this.seatY, seat.z) : new THREE.Vector3(s.at[0], 0, s.at[1])
    const yaw1 = onto ? seat.yaw : s.face
    this.hop = { from: this.pos.clone(), to, yaw0: this.yaw, yaw1: this.yaw + wrap(yaw1 - this.yaw), u: 0, onto }
    this.state = 'hop'
    this.onHop?.(onto)
  }

  update(dt: number, t: number, camera: THREE.Vector3) {
    this.t = t
    this.camera.copy(camera)
    const fig = this.fig
    const yaw0 = this.yaw
    const v0 = this.v
    const toCamera = Math.atan2(camera.x - this.pos.x, camera.z - this.pos.z)
    let goalYaw = this.yaw

    if (this.state === 'walk' && this.curve) {
      const remaining = this.len - this.s
      const stop = this.chosen || this.blocked || this.paused
      // From rest it gathers itself first: a short crouch, then off.
      const gather = !stop && this.windU < 1 && Boolean(this.fig.soft)
      if (gather) this.windU = Math.min(1, this.windU + dt / 0.22)
      else if (stop && this.v < 0.01) this.windU = 0
      // Sent for by the person, it hurries.
      const cap = stop || (gather && this.windU < 0.75) ? 0 : Math.min(fig.speed * this.k * (this.held ? 1.7 : 1), Math.sqrt(2 * 1.2 * remaining) + 0.04)
      const accel = stop ? 3 : 1.4
      this.v += Math.max(-accel * dt, Math.min(accel * dt, cap - this.v))
      this.v = Math.max(0, this.v)
      this.s = Math.min(this.len, this.s + this.v * dt)
      const p = this.curve.getPointAt(this.s / this.len)
      this.onPath.set(p.x, 0, p.z)
      // The sidestep fades in the last half metre, so it arrives exactly at the spot.
      const fade = Math.min(1, remaining / 0.5)
      this.pos.set(p.x + this.sidestep.x * fade, 0, p.z + this.sidestep.z * fade)
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
      if (!this.chosen && !this.idle && !this.held && !this.linger) {
        this.timer -= dt
        if (this.timer <= 0) {
          this.onDone?.(this.spot)
          this.next()
        }
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
          if (this.pending) {
            const next = this.pending
            this.pending = null
            this.walkTo(next)
          }
        }
      }
    } else if (this.state === 'sit') {
      goalYaw = SPOTS[this.spot]?.seat?.yaw ?? this.yaw
      if (!this.chosen && !this.idle && !this.held) {
        this.timer -= dt
        if (this.timer <= 0) this.beginHop(false)
      }
    }
    // A chosen villager turns to the person; seated ones only turn their head.
    const greeting = this.greetU < 1 && this.state === 'work' ? Math.sin(Math.PI * Math.min(1, this.greetU * 1.25)) : 0
    if (greeting) goalYaw += THREE.MathUtils.clamp(wrap(toCamera - goalYaw), -0.8, 0.8) * 0.7 * greeting
    else if (this.attending && this.state === 'work') goalYaw += THREE.MathUtils.clamp(wrap(toCamera - goalYaw), -0.9, 0.9) * 0.6
    if (this.chosen && this.state !== 'sit' && this.state !== 'hop') goalYaw = toCamera
    // Speaking from a chair, it turns part way round to the person.
    else if (this.speaking && this.state === 'sit') goalYaw += THREE.MathUtils.clamp(wrap(toCamera - goalYaw), -0.7, 0.7) * 0.8
    if (this.idle && !this.chosen) goalYaw = this.yaw
    if (this.state !== 'hop') this.yaw += wrap(goalYaw - this.yaw) * (1 - Math.exp(-dt * (this.state === 'walk' ? 6 : 5)))
    this.yawRate = THREE.MathUtils.lerp(this.yawRate, wrap(this.yaw - yaw0) / Math.max(dt, 1e-3), 1 - Math.exp(-dt * 8))

    this.accel += ((this.v - v0) / Math.max(dt, 1e-3) - this.accel) * (1 - Math.exp(-dt * 14))
    const walking = this.state === 'walk' ? Math.min(1, this.v / (fig.speed * this.k * 0.5)) : 0
    this.walk = walking
    this.working += ((this.state === 'work' && !this.chosen && !this.idle ? 1 : 0) - this.working) * (1 - Math.exp(-dt * 4))
    this.talking += ((this.chosen ? 1 : 0) - this.talking) * (1 - Math.exp(-dt * 6))
    this.think += ((this.thinking ? 1 : 0) - this.think) * (1 - Math.exp(-dt * 7))
    this.read += ((this.reading ? 1 : 0) - this.read) * (1 - Math.exp(-dt * 8))
    this.speak += ((this.speaking ? 1 : 0) - this.speak) * (1 - Math.exp(-dt * 6))
    this.beatU = Math.min(1, this.beatU + dt / 0.42)
    this.greetU = Math.min(1, this.greetU + dt / 1.8)
    this.nodU = Math.min(1, this.nodU + dt / 1.1)
    if (this.state === 'sit') this.seated = 1
    else if (this.state !== 'hop') this.seated = 0
    this.phase += (this.v * dt) / (fig.stride * this.k)
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
    const stride = fig.stride * this.k
    const lift = stride * 0.16
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
          if (this.fps) u = Math.floor(u * 4) / 4
          const target = this.restFoot(i).addScaledVector(fwd, 0.5 * stride * (1 - u) + 0.25 * stride)
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
        if (f.settle < 0 && other.settle < 0 && f.world.distanceTo(rest) > 0.035 * this.k) {
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
    // On twos: hold each pose for 1 / fps of a second.
    const fps = this.fps
    if (fps) {
      const tick = Math.floor(t * fps)
      if (tick === this.tick) return
      this.tick = tick
      t = tick / fps
      dt = 1 / fps
    }
    const { pose, head, hands } = fig
    const w = this.walk
    const p = fps ? Math.floor(this.phase * 8) / 8 : this.phase
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
    lean += 0.05 * this.seated
    roll += 0.04 * this.seated * Math.sin(t * 0.3)
    y += Math.abs(Math.sin(t * 8.5)) * 0.008 * this.talking * (1 - this.think)
    // Speaking leans in; the hop of recognition squashes, springs and lands.
    lean += 0.11 * this.speak + 0.04 * this.speak * Math.sin(t * 3.1)
    if (this.beatU < 1) {
      const u = this.beatU
      y += Math.sin(Math.min(1, u / 0.7) * Math.PI) * 0.045
      sy *= 1 - 0.12 * Math.sin(Math.min(1, u / 0.18) * Math.PI) * (u < 0.18 ? 1 : 0) + 0.07 * Math.sin(Math.min(1, u / 0.7) * Math.PI) - 0.08 * (u > 0.7 ? Math.sin(((u - 0.7) / 0.3) * Math.PI) : 0)
    }
    // The little wave: up from the chore, the near hand raised and waggling.
    const greet = this.greetU < 1 && this.state === 'work' ? Math.sin(Math.PI * Math.min(1, this.greetU * 1.25)) : 0
    lean -= (this.working * 0.2 + 0.04) * greet
    const soft = fig.soft
    const sxz = 1 + (1 - sy) * 0.5
    /** How far the spine has turned the head off the body's heading; the head turns back by it. */
    let spineYaw = 0, spinePitch = 0
    if (soft) {
      const gather = this.state === 'walk' && this.windU < 1 ? Math.sin(Math.PI * this.windU) : 0
      // The hips lead; waist and chest trail the acceleration and swing back past upright as it stops.
      const trail = this.trail.step(THREE.MathUtils.clamp(-this.accel * 0.16, -0.3, 0.3), dt)
      const sway = this.sway.step(THREE.MathUtils.clamp(-this.yawRate * 0.1, -0.25, 0.25) * Math.min(1, w * 1.5), dt)
      // The belly keeps going when the hips stop: it chases the hips' height on a spring.
      const drop = y - 0.5 * fig.height * (1 - sy)
      const belly = this.bounce.step(drop, dt) - drop
      // The step: hips swing the stepping side forward and shift over the standing foot; the chest answers the other way.
      const swing = Math.sin(2 * Math.PI * p) * w
      const twist = 0.2 * swing
      const shift = fig.side * 0.55 * swing
      sy *= 1 - 0.1 * gather
      const wide = 1 + (1 - sy) * 0.55
      pose.position.set(shift + 0.012 * Math.sin(t * 0.45) * (1 - w) * (1 - this.seated), y, -0.02 * gather)
      pose.rotation.set(lean * 0.3 - 0.1 * gather, twist, roll * 0.5)
      pose.scale.set(wide, sy, wide)
      const breath = Math.sin(t * 2.1) * (1 - w)
      soft.waist.rotation.set(lean * 0.4 + trail * 0.5, -twist * 1.3, roll * 0.3 + sway * 0.5)
      soft.waist.position.y = (soft.waist.userData.y ??= soft.waist.position.y) + THREE.MathUtils.clamp(belly, -0.03, 0.03) * 0.5
      soft.waist.scale.setScalar(1 + 0.01 * breath)
      soft.chest.rotation.set(lean * 0.3 + trail * 0.5 + 0.02 * breath, -twist * 0.9 + sway * -0.3, roll * 0.2 + sway * 0.5)
      soft.chest.position.y = (soft.chest.userData.y ??= soft.chest.position.y) + THREE.MathUtils.clamp(belly, -0.03, 0.03) * 0.5
      soft.chest.scale.setScalar(1 + 0.018 * breath)
      spineYaw = twist - twist * 1.3 - twist * 0.9 - sway * 0.3
      spinePitch = lean + trail - 0.1 * gather
    } else {
      pose.position.set(0.012 * Math.sin(t * 0.45) * (1 - w) * (1 - this.seated), y, 0)
      pose.rotation.set(lean, 0, roll)
      pose.scale.set(sxz, sy, sxz)
    }
    // Hands swing against the feet; at work they bob in turn.
    hands.forEach((h, i) => {
      const rest = h.userData.rest as THREE.Vector3
      const s = i ? -1 : 1
      h.position.copy(rest)
      h.position.z += 0.09 * this.seated
      h.position.y += 0.07 * this.seated
      // Arms pump against the legs; on a soft body they swing wider, in an arc from the shoulder.
      const pump = Math.sin(2 * Math.PI * p) * s * w
      h.position.z += pump * fig.stride * (soft ? 0.34 : 0.18)
      if (soft) h.position.y += (Math.abs(pump) - 0.5) * fig.stride * 0.1 * w
      h.position.y += (Math.sin(t * 5 + i * Math.PI) * 0.02 * this.working) + 0.03 * this.talking * (i ? 0 : 1) * (0.6 + 0.4 * Math.sin(t * 5))
      if (i === 0 && greet > 0) {
        h.position.y += fig.height * 0.32 * greet
        h.position.x += Math.sin(t * 13) * fig.height * 0.05 * greet
      }
      // Speaking: the free hand opens out now and then.
      h.position.y += 0.035 * this.speak * (i ? 1 : 0) * Math.max(0, Math.sin(t * 2.3))
      // Reading: both paws come in front, a little apart, holding up what it was given.
      if (this.read > 0.001) {
        pawsAt.set(rest.x * 0.42, rest.y + 0.05, Math.abs(rest.x) * 0.95)
        h.position.lerp(pawsAt, this.read)
      }
      // Thinking: the free hand comes up to the chin and taps.
      if (i === 1 && this.think > 0.001) {
        chin.copy(head.position).add(CHIN.set(0.03, -fig.height * 0.14, fig.height * 0.3))
        chin.y += Math.max(0, Math.sin(t * 9)) * 0.012
        h.position.lerp(chin, this.think)
      }
    })
    // Glances around now and then, and at the person when chosen.
    this.nextGlance -= dt
    if (this.nextGlance <= 0) {
      this.glanceGoal = Math.random() < 0.35 ? THREE.MathUtils.clamp(wrap(toCamera - this.yaw), -1, 1) : (Math.random() - 0.5) * 1.0
      this.nextGlance = 1.8 + Math.random() * 3
    }
    const listening = this.listenTo && this.state === 'sit' && this.speak < 0.5 ? Math.atan2(this.listenTo.x - this.pos.x, this.listenTo.z - this.pos.z) : null
    const headGoal = listening !== null ? THREE.MathUtils.clamp(wrap(listening - this.yaw), -1.1, 1.1)
      : this.chosen || this.attending || this.speak > 0.5 || greet > 0.3 ? THREE.MathUtils.clamp(wrap(toCamera - this.yaw), -1.1, 1.1) : this.glanceGoal * (1 - w * 0.7)
    this.glance += (headGoal - this.glance) * (1 - Math.exp(-dt * (fps ? 12 : 5)))
    // The head looks where it is going: into a turn before the body, level over a leaning spine.
    const lead = soft ? THREE.MathUtils.clamp(this.yawRate * 0.22, -0.6, 0.6) * w : 0
    head.rotation.y = this.glance - spineYaw * 0.8 + lead
    head.rotation.x = this.talking * 0.06 * Math.sin(t * 6) * (1 - this.think) - this.working * 0.15 - this.think * 0.32 + this.read * 0.24 + this.speak * 0.07 * Math.sin(t * 4.2) + (this.nodU < 1 ? 0.22 * Math.max(0, Math.sin(this.nodU * Math.PI * 4)) * (1 - this.nodU) : 0)
    head.rotation.z = this.seated * 0.08 * Math.sin(t * 0.4 + 1)
    if (soft) {
      head.rotation.x -= spinePitch * 0.55
      head.rotation.z += this.settleSpring.step(-this.yawRate * 0.05 * w, dt)
      this.flop(dt)
    }
    // Blink every few seconds.
    this.blinkAt -= dt
    const closed = this.blinkAt < 0.12
    if (this.blinkAt <= 0) this.blinkAt = 2.4 + Math.random() * 3.2
    for (const e of fig.eyes) e.scale.y = closed ? 0.12 : 1
  }

  /** Ears, tufts and tails: each tip is a particle on a spring to where it would sit, and its bone turns to point at it. */
  private flop(dt: number) {
    const soft = this.fig.soft!
    if (!soft.flops.length) return
    this.fig.pose.updateMatrixWorld(true)
    for (const f of soft.flops) {
      tipWorld.copy(f.tip)
      f.parent.localToWorld(tipWorld)
      if (!f.live) {
        f.live = true
        f.at.copy(tipWorld)
        f.vel.set(0, 0, 0)
      }
      // Stepped at 60 a second or finer, so a long frame (or a look drawn on twos) cannot blow the spring up.
      const w = 2 * Math.PI * f.hz
      const steps = Math.ceil(dt * 60 - 1e-6)
      const h = dt / steps
      for (let n = 0; n < steps; n++) {
        f.vel.addScaledVector(restDir.copy(tipWorld).sub(f.at), w * w * h).multiplyScalar(1 - 2 * 0.22 * w * h)
        f.at.addScaledVector(f.vel, h)
      }
      // A tip never trails further than half its own length (a hop, a teleport, a long frame): felt bends, it does not fold back.
      tipWorld.copy(f.tip)
      f.parent.localToWorld(tipWorld)
      const reach = f.length * this.k * 0.5
      if (f.at.distanceTo(tipWorld) > reach) f.at.sub(tipWorld).setLength(reach).add(tipWorld), f.vel.multiplyScalar(0.5)
      nowDir.copy(f.at)
      f.parent.worldToLocal(nowDir)
      hingeWorld.copy(f.bone.position)
      nowDir.sub(hingeWorld).normalize()
      restDir.copy(f.tip).sub(hingeWorld).normalize()
      f.bone.quaternion.setFromUnitVectors(restDir, nowDir)
    }
  }
}
