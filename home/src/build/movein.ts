// The move-in (#48): the room is lived in at once. After Build it and the walls rise, the
// villager who drew the room walks from where they are, through the new door, to the room's
// main piece, sits there (a stool at a playroom's table, the sofa, the desk chair or the bed's
// edge) and says one short, warm line; the dollhouse view glides round to a three-quarter view
// of the room and follows them in, so the new room ends up the subject of the frame.
// Taking the camera (a drag, the wheel, a held WASD or arrow key) ends the hold, and "Back to
// the house" (or Escape) glides out to the whole house; the villager stays a while.
//
// The walk is the villager's own: world.ts's `setSpot` gives the seat a spot whose path runs
// through both faces of the new doorway, and talk.ts's `walk` sends them; `where` reads them.
import * as THREE from 'three/webgpu'
import type { View, Frame } from '../plugins/camera'
import { nearestNode, setSpot } from '../villagers/world'
import { curveOf, outline as ringOf, pointAt, wallOf, type Furniture, type P, type Plan } from './plan'
import { draftGeometry, type Draft } from './resolve'
import { SEATS } from './pieces'
import { fitFrame, lift, movedOff } from './frame'

const SPOT = 'buildMovein'
/** The main piece a room's villager settles at, in order of preference. */
const MAIN = ['play-table', 'sofa', 'desk', 'bed']
/** The settled frame fills this screen box (NDC), clear of the notepad at the bottom. */
const BOX = { x: [-1.02, 0.9] as [number, number], y: [-0.66, 1.08] as [number, number] }
/** No closer than this: the overhead distance the art was made for, a little higher than the prototype's 0.36. */
const MOST = 0.3
/** One short line on sitting down, by room. */
const LINES: Array<[RegExp, string]> = [
  [/play|toy|kid|nursery|child/i, 'Oh, I love it in here!'],
  [/study|office|library|den|studio/i, 'A good spot to think.'],
  [/bed|sleep|guest/i, 'So cosy. I could nap right here.'],
]

type Talk = {
  walk(person: string, spot: string | null): void
  say(person: string, text: string): void
  where(person: string): { x: number; y: number; z: number; state: string; seated: boolean; spot: string } | null
}
const talk = () => (window as unknown as { village?: { talk?: Talk } }).village?.talk

export type Reveal = 'idle' | 'rising' | 'walking' | 'crossing' | 'settled'

export function makeMoveIn(view: View, camera: THREE.PerspectiveCamera) {
  let phase: Reveal = 'idle'
  let room = ''
  let label = ''
  let person: string | null = null
  let door: { mid: P; into: P; gap: [P, P] } | null = null
  let seat: { x: number; z: number; yaw: number; from: -1 | 1 } | null = null
  let spot: P = [0, 0]
  let centre: P = [0, 0]
  let startAt = 0
  let frame: Required<Frame> | null = null
  /** Where the view stood when the room was built: moving off it before the glide means someone took the camera. */
  let still: Required<Frame> | null = null
  let landed = false
  let held = false
  let path: P[] = []
  /** Where the settled frame looks, before camera.ts's bounds clamp it. */
  const look = new THREE.Vector3()
  const subject = new THREE.Vector3()
  const goal = new THREE.Vector3()
  const q = new THREE.Vector3()

  /** On Build it: where the door is, where to sit, the path in, and the frame to settle on. */
  const start = (base: Plan, made: Plan, d: Draft, pieces: Furniture[], riseMs: number, who: string | null) => {
    const r = made.rooms.find((x) => x.id === d.roomId)
    if (!r) return
    const c = curveOf(base, wallOf(base, d.wallId))
    const a = pointAt(c, d.door.from), b = pointAt(c, d.door.to)
    const mid: P = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    const ring = ringOf(made, r)
    // The middle of its footprint's box: an average of the ring's points leans toward a bent wall's many points.
    const xs = ring.map((p) => p[0]), zs = ring.map((p) => p[1])
    centre = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2]
    const geo = draftGeometry(base, d)
    const into = geo.out
    door = { mid, into, gap: [a, b] }

    // The settled view: a three-quarter view from the house's front, turned off the host wall so the far wall
    // (the curved one, when it bends) is seen at an angle, not edge-on.
    const toward = new THREE.Vector2(-into[0] * 0.55, 0.8 - into[1] * 0.55).normalize()
    const yaw = Math.atan2(toward.x, toward.y)
    // The floor and the walls' tops fill the frame, the room pinned to the side away from the house so the lawn
    // and lot edge beyond it stay out of the picture and the house shows beside it.
    const sideways = (centre[0] - mid[0]) * Math.cos(yaw) - (centre[1] - mid[1]) * Math.sin(yaw)
    const fitted = fitFrame([...lift(ringOf(made, r, 0.15), 0.02), ...lift(ringOf(made, r, -0.1), geo.height)], yaw, BOX, camera.aspect, MOST, Math.sign(sideways))
    frame = fitted.frame
    look.copy(fitted.look)

    // The seat: on the main piece, the one whose sitter faces the camera most.
    const toCam: P = [Math.sin(yaw), Math.cos(yaw)]
    seat = null
    const main = MAIN.map((k) => pieces.find((p) => 'kind' in p.item && p.item.kind === k && p.at.mount === 'floor')).find(Boolean)
    if (main && main.at.mount === 'floor' && 'kind' in main.item) {
      const { x, z, yaw: py } = main.at
      const options = (SEATS[main.item.kind] ?? []).map((s) => {
        const sx = x + s.x * Math.cos(py) + s.z * Math.sin(py), sz = z - s.x * Math.sin(py) + s.z * Math.cos(py)
        return { x: sx, z: sz, yaw: py + s.turn, from: s.from }
      })
      seat = options.sort((s, t) => (Math.sin(t.yaw) * toCam[0] + Math.cos(t.yaw) * toCam[1]) - (Math.sin(s.yaw) * toCam[0] + Math.cos(s.yaw) * toCam[1]))[0] ?? null
    }
    // Stand beside the seat on the side it is stepped onto from (behind a stool, in front of a sofa), or in the room's middle, and hop on.
    const fwd: P = seat ? [Math.sin(seat.yaw) * seat.from, Math.cos(seat.yaw) * seat.from] : [0, 0]
    spot = seat ? [seat.x + fwd[0] * 0.42, seat.z + fwd[1] * 0.42] : [centre[0], centre[1]]
    // The path: a step either side of the doorway, then, if the piece is in the way, round it.
    const outside: P = [mid[0] - into[0] * 0.45, mid[1] - into[1] * 0.45]
    const inside: P = [mid[0] + into[0] * 0.55, mid[1] + into[1] * 0.55]
    path = [outside, inside]
    if (main && main.at.mount === 'floor') {
      const m: P = [main.at.x, main.at.z]
      const near = closest(inside, spot, m)
      const off = Math.hypot(near[0] - m[0], near[1] - m[1])
      if (off < 0.75) {
        const away: P = off > 1e-3 ? [(near[0] - m[0]) / off, (near[1] - m[1]) / off] : [-into[1], into[0]]
        path.push([m[0] + away[0] * 0.95, m[1] + away[1] * 0.95])
      }
    }
    const face = seat ? seat.yaw : Math.atan2(centre[0] - spot[0], centre[1] - spot[1])
    setSpot(SPOT, { at: spot, face, via: nearestNode(outside[0], outside[1], 'open') ?? 'f0', through: path, ...(seat ? { seat: { x: seat.x, z: seat.z, yaw: seat.yaw } } : {}) })
    room = d.roomId
    label = d.label
    person = who
    startAt = performance.now() + riseMs
    // The proposal's own glide stops where it is, so only the person moves the view while the walls rise.
    void view.glide({ ...view.frame }, 0)
    still = { ...view.frame }
    phase = 'rising'
    landed = false
    held = true
    subject.copy(look)
  }

  /** Called each frame: walks, follows, and settles. */
  const step = () => {
    if (phase === 'idle' || !door) return
    const t = talk()
    if (phase === 'rising') {
      if (held && movedOff(view.frame, still!)) held = false
      if (performance.now() < startAt) return
      if (person && t?.where(person)) t.walk(person, SPOT)
      else person = null
      phase = person ? 'walking' : 'settled'
      // The view turns and glides to the room while they cross, unless the person has taken it already.
      const to = frame!
      if (held) void view.glide(to, 2.4).then(() => {
        if (!movedOff(view.frame, to)) landed = true
        else held = false
      })
      return
    }
    // Someone took the camera after it landed: the hold lets go.
    if (held && landed && movedOff(view.frame, frame!)) held = false
    if (phase === 'settled' || !person) return
    const me = t?.where(person)
    if (!me) return
    const past = (me.x - door.mid[0]) * door.into[0] + (me.z - door.mid[1]) * door.into[1]
    if (phase === 'walking' && past > 0.3) phase = 'crossing'
    if (phase === 'crossing' && me.spot === SPOT && (seat ? me.state === 'sit' : me.state === 'work')) {
      phase = 'settled'
      t!.say(person, LINES.find(([re]) => re.test(label))?.[1] ?? 'Oh, this is nice.')
    }
  }

  /**
   * While the reveal holds the view: the camera offset (as build.ts's frameHouse applies it) that
   * keeps the walker in the picture on the way in and ends on the room, nudged toward them.
   * Null when the reveal does not hold the view.
   */
  const framing = (dt: number) => {
    if (!held || !door || phase === 'idle') return null
    const me = person ? talk()?.where(person) : null
    // Before they reach the door the walker leads; once in, the room does, with them in it.
    const w = phase === 'rising' ? 0 : phase === 'walking' ? 0.55 : 0.2
    goal.set(me ? me.x : look.x, look.y, me ? me.z : look.z)
    goal.lerpVectors(look, goal, w)
    subject.lerp(goal, 1 - Math.exp(-dt * 2.2))
    camera.updateMatrixWorld()
    q.copy(subject).applyMatrix4(camera.matrixWorldInverse)
    return { right: q.x, up: q.y, back: 0 }
  }

  /** Let the villager go back to their chores and the view go back to framing the house. */
  const release = () => {
    if (phase === 'idle') return
    if (person && phase !== 'rising') talk()?.walk(person, null)
    phase = 'idle'
    held = false
  }

  return {
    start,
    frame: step,
    framing,
    release,
    /** The person took the camera: stop holding it (the villager stays a while). */
    letGo: () => (held = false),
    /** Whether the reveal is still holding the view. */
    holding: () => held,
    state: () => ({ phase, room, person, spot, seat, door: door && { mid: door.mid, gap: door.gap }, path, frame, held }),
  }
}

/** The point on segment a–b closest to p. */
function closest(a: P, b: P, p: P): P {
  const dx = b[0] - a[0], dz = b[1] - a[1]
  const L = dx * dx + dz * dz || 1
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L))
  return [a[0] + dx * t, a[1] + dz * t]
}
