// Regroup 2 prototype "movein" (#48, ?build=1&look=movein only): the room is lived in at once.
// After Build it and the walls rise, the villager who drew it walks from the kitchen through the
// new door to the room's main piece, says one happy line, and the dollhouse view follows them in
// so the new room ends up the subject of the frame.
//
// The walk is the villager's own (talk's `walk(person, spot)`, real gait and routing). No API
// takes an arbitrary point, so this registers one temporary spot in world.ts's SPOTS table at
// runtime (the file is untouched). Its last leg is a straight-ish chord from a kitchen corridor
// node, so the spot is put on the line from the best node through the middle of the new door.
import * as THREE from 'three/webgpu'
import type { View } from '../plugins/camera'
import { SPOTS } from '../villagers/world'
import { curveOf, outline as ringOf, pointAt, wallOf, type Furniture, type P, type Plan } from './plan'
import type { Draft } from './resolve'

/** Who drew the room in the scenario: Alex's Dumpling. */
const PERSON = 'alex'
const SPOT = 'buildMovein'
/** Corridor nodes on the kitchen's open paths (copied from world.ts, which keeps them private). */
const NODES: Record<string, P> = { l0: [-1.95, 0.5], l1: [-1.95, -0.55], l2: [-1.7, -1.15], f0: [-1.75, 1.3], f1: [-0.3, 1.45], b0: [-0.85, -1.15] }
/** The settled frame: close enough that the room fills it, turned so the shared wall is at the side, not in front. */
const FRAME = { zoom: 0.36, yaw: -0.2 }

type Talk = {
  walk(person: string, spot: string | null): void
  say(person: string, text: string): void
  state(): { cast: Record<string, { x: number; z: number; state: string; spot: string }> }
}
const talk = () => (window as unknown as { village?: { talk?: Talk } }).village?.talk

export type Reveal = 'idle' | 'rising' | 'walking' | 'crossing' | 'settled'

export function makeMoveIn(view: View, camera: THREE.PerspectiveCamera) {
  let phase: Reveal = 'idle'
  let plan: Plan | null = null
  let room = ''
  let door: { mid: P; into: P } | null = null
  let spot: P = [0, 0]
  let piece: P = [0, 0]
  let centre: P = [0, 0]
  let startAt = 0
  let glided = false
  let held = false
  const subject = new THREE.Vector3()
  const goal = new THREE.Vector3()
  const q = new THREE.Vector3()

  /** On Build it: where the door is, which piece to settle at, and where to stand. */
  const start = (base: Plan, made: Plan, d: Draft, pieces: Furniture[], riseMs: number) => {
    const wall = wallOf(base, d.wallId)
    const c = curveOf(base, wall)
    const a = pointAt(c, d.door.from), b = pointAt(c, d.door.to)
    const mid: P = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    const r = made.rooms.find((x) => x.id === d.roomId)
    if (!r) return
    const ring = ringOf(made, r)
    // The middle of its footprint's box: an average of the ring's points leans toward a bent wall's many points.
    const xs = ring.map((p) => p[0]), zs = ring.map((p) => p[1])
    centre = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2]
    // Into the room: across the wall, on the room's side.
    const along: P = [b[0] - a[0], b[1] - a[1]]
    let into: P = [-along[1], along[0]]
    const n = Math.hypot(...into) || 1
    into = [into[0] / n, into[1] / n]
    if ((centre[0] - mid[0]) * into[0] + (centre[1] - mid[1]) * into[1] < 0) into = [-into[0], -into[1]]
    door = { mid, into }
    const floor = (kind: string) => {
      const f = pieces.find((p) => 'kind' in p.item && p.item.kind === kind)
      return f && f.at.mount === 'floor' ? ([f.at.x, f.at.z] as P) : null
    }
    piece = floor('play-table') ?? floor('play-tent') ?? floor('sofa') ?? floor('desk') ?? floor('bed') ?? centre
    // Stand about 0.6 m short of the piece, on a chord from a kitchen node through the door's middle:
    // try each node and keep the one whose chord lands nearest the piece.
    const reach = Math.max(0.9, Math.hypot(piece[0] - mid[0], piece[1] - mid[1]) - 0.6)
    let best = Infinity, via = 'l0'
    for (const [name, [x, z]] of Object.entries(NODES)) {
      const dx = mid[0] - x, dz = mid[1] - z, len = Math.hypot(dx, dz)
      // Only nodes on the kitchen side, coming at the door fairly square.
      if ((dx * into[0] + dz * into[1]) / len < 0.55) continue
      const p: P = [mid[0] + (dx / len) * reach, mid[1] + (dz / len) * reach]
      const miss = Math.hypot(p[0] - piece[0], p[1] - piece[1])
      if (miss < best) [best, via, spot] = [miss, name, p]
    }
    if (best === Infinity) spot = [mid[0] + into[0] * reach, mid[1] + into[1] * reach]
    const face = Math.atan2(piece[0] - spot[0], piece[1] - spot[1])
    // A runtime spot in world.ts's table: left there after release, since the villager may still name it.
    SPOTS[SPOT] = { at: spot, face, via }
    plan = made
    room = d.roomId
    startAt = performance.now() + riseMs
    phase = 'rising'
    glided = false
    held = true
    subject.set(mid[0], 0.8, mid[1])
  }

  /** Called each frame: walks, follows, and settles. */
  const frame = () => {
    if (phase === 'idle' || phase === 'settled') return
    const t = talk()
    if (phase === 'rising') {
      if (performance.now() < startAt || !t) return
      t.walk(PERSON, SPOT)
      phase = 'walking'
      // The view turns and comes in on the doorway while they cross the kitchen.
      void view.glide({ x: door!.mid[0], z: door!.mid[1], zoom: FRAME.zoom, yaw: FRAME.yaw }, 2.4).then(() => (glided = true))
      return
    }
    const me = t?.state().cast[PERSON]
    if (!me || !door) return
    const past = (me.x - door.mid[0]) * door.into[0] + (me.z - door.mid[1]) * door.into[1]
    if (phase === 'walking' && past > 0) phase = 'crossing'
    if (phase === 'crossing' && me.state === 'work' && me.spot === SPOT && glided) {
      phase = 'settled'
      t!.say(PERSON, 'Oh, I love it in here!')
    }
  }

  /**
   * While the reveal holds the view: the camera offset (as build.ts's frameHouse applies it) that
   * centres the subject, following the villager in and ending between them and the room's middle.
   * Null when the reveal does not hold the view.
   */
  const framing = (dt: number) => {
    if (!held || !door) return null
    const t = talk()
    const me = t?.state().cast[PERSON]
    // Follow the walker once they are near the door; end on the room's middle, nudged toward them.
    const x = me ? me.x : door.mid[0], z = me ? me.z : door.mid[1]
    const near = me ? Math.max(0, 1 - Math.hypot(x - door.mid[0], z - door.mid[1]) / 3) : 0
    const inRoom = phase === 'crossing' || phase === 'settled' ? 1 : 0
    const w = phase === 'rising' ? 0 : Math.max(near * 0.6, inRoom)
    const fx = THREE.MathUtils.lerp(door.mid[0], centre[0] * 0.7 + x * 0.3, w)
    const fz = THREE.MathUtils.lerp(door.mid[1], centre[1] * 0.7 + z * 0.3, w)
    goal.set(fx, 0.15, fz)
    subject.lerp(goal, 1 - Math.exp(-dt * 2.2))
    camera.updateMatrixWorld()
    q.copy(subject).applyMatrix4(camera.matrixWorldInverse)
    return { right: q.x, up: q.y, back: 0 }
  }

  /** Let the villager go back to their chores and the view go back to framing the house. */
  const release = () => {
    if (phase === 'idle') return
    if (phase !== 'rising') talk()?.walk(PERSON, null)
    phase = 'idle'
    held = false
  }

  return {
    start,
    frame,
    framing,
    release,
    /** The person took the camera: stop holding it (the villager stays a while). */
    letGo: () => (held = false),
    state: () => ({ phase, room, spot, piece, held, built: plan !== null }),
  }
}
