// A hand for the things of the house (#107), by pointer events so a mouse and a finger do the
// same: press on a loose thing (a mug, a plate, a toy block, the high chair) and it lifts off
// what it stands on; drag and it follows the pointer over whatever is under it (the table, the
// floor, a shelf, another thing: that is how things are stacked), bumping what is in its way;
// let go and it keeps the speed it has, so a flick throws it. A quick tap nudges it away from
// the viewer. The hand is as strong as the `grip` below, so a heavy thing drags and tips
// instead of rising.
//
// It takes the house's own things (bodies bound to scene objects, src/physics/home.ts); toys'
// parts are poked by src/physics/touch.ts, which leaves bound things alone, so one press is
// never both. Order of claims: build mode's wall grip (earlier on the window) yields to a
// loose thing in front of the wall, through its own `claims` (src/build/edit.ts); an entry
// under the point is never ours, nor a press while an entry is chosen or a table is played. What is ours is swallowed, so the view does not turn with the drag. A
// second finger lets go (two fingers are the view's), as does a press the page loses.
import * as THREE from 'three/webgpu'
import type { Context } from 'cordis'
import type { Vec3 } from '../engine/core'
import type { World } from '../engine/world'
import { claims } from '../build/edit'

/** N the hand draws a thing with: it lifts about 12 kg, and drags what is heavier. */
const GRIP = 120
/** px round a thing that still take it: small things are a few pixels wide from the dollhouse view. */
const NEAR = { mouse: 14, touch: 30 }
/** m a held thing rides above what is under it. */
const LIFT = 0.07
/** m higher a held thing may ride while it has far to go: over the chair backs between the dresser and the table. */
const ARC = 0.45
/** px above the finger a held thing is shown on a touch screen, so the finger does not cover it. */
const ABOVE_FINGER = 44
/** px a press may drift, and ms it may last, and still be a tap. */
const TAP = 10
const TAP_MS = 350
/** m/s a tap adds, away from the viewer, and the hop on top of it. */
const POKE = 1.2
const HOP = 0.5
/** A throw faster than this (m/s) rises a little, as a thrown thing does: this share of its speed, upward. */
const THROW = 1.2
const RISE = 0.28
/** How far (m) a ray looks. */
const FAR = 200

const swallow = (e: Event) => e.stopImmediatePropagation()

export function hand(ctx: Context, world: World, played: () => string | null) {
  const { camera, renderer } = ctx.stage
  const canvas = renderer.domElement
  const ndc = new THREE.Vector2()
  const ray = new THREE.Raycaster()
  const v = new THREE.Vector3()

  /** The ray from the eye through a screen point: its origin and a direction FAR long. */
  const rayAt = (x: number, y: number): { origin: Vec3; direction: Vec3 } => {
    const rect = canvas.getBoundingClientRect()
    ndc.set(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1)
    ray.setFromCamera(ndc, camera)
    const o = ray.ray.origin, d = ray.ray.direction
    return { origin: [o.x, o.y, o.z], direction: [d.x * FAR, d.y * FAR, d.z * FAR] }
  }
  /** A world point on the screen (CSS px), its distance from the eye, and how many px a metre is there. */
  const onScreen = (at: Vec3) => {
    const rect = canvas.getBoundingClientRect()
    const distance = v.set(...at).distanceTo(camera.position)
    v.project(camera)
    const perMetre = (rect.height / 2) * camera.projectionMatrix.elements[5] / Math.max(distance, 1e-3)
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height, distance, perMetre, seen: v.z < 1 }
  }

  const box = new THREE.Box3()
  /** Whether a point on a thing is on a part of it that is not drawn (a wall the dollhouse view has cut away). */
  const unseenAt = (object: THREE.Object3D, point: Vec3) => {
    let seen = false, unseen = false
    v.set(...point)
    const visit = (o: THREE.Object3D, shown: boolean) => {
      shown &&= o.visible
      const m = o as THREE.Mesh
      if (m.isMesh && m.geometry) {
        if (!m.geometry.boundingBox) m.geometry.computeBoundingBox()
        // A cut-away wall is kept for its shadow on a layer the view does not draw (src/plugins/camera.ts).
        if (box.copy(m.geometry.boundingBox!).applyMatrix4(m.matrixWorld).expandByScalar(0.03).containsPoint(v)) shown && m.layers.test(camera.layers) ? (seen = true) : (unseen = true)
      }
      for (const child of o.children) visit(child, shown)
    }
    let shown = true
    for (let o = object.parent; o; o = o.parent) shown &&= o.visible
    visit(object, shown)
    return unseen && !seen
  }
  /** The first thing a ray meets that the eye can see: bodies of walls cut away from the view are passed through. */
  const cast = (origin: Vec3, direction: Vec3, ignore: string[] = []) => {
    let from = origin, to = direction, done = 0
    for (let i = 0; i < 8; i++) {
      const hit = world.castRay(from, to, ignore)
      if (!hit) return null
      const object = world.boundObject(hit.key)
      const fraction = done + hit.fraction * (1 - done)
      if (!object || !unseenAt(object, hit.point)) return { ...hit, fraction }
      // On from just past it, along what is left of the ray.
      const past = Math.min(1, fraction + 0.02 / FAR)
      if (past >= 1) return null
      done = past
      from = [origin[0] + direction[0] * past, origin[1] + direction[1] * past, origin[2] + direction[2] * past]
      to = [direction[0] * (1 - past), direction[1] * (1 - past), direction[2] * (1 - past)]
    }
    return null
  }

  /**
   * The loose thing a press at a screen point takes: the one the ray meets, else the one nearest the
   * point on the screen, within NEAR px of its outline and not behind a wall.
   */
  const pick = (x: number, y: number, near: number) => {
    const things = world.movables()
    const { origin, direction } = rayAt(x, y)
    const first = cast(origin, direction)
    const direct = first && things.find((t) => t.key === first.key)
    if (direct) return direct
    let best: (typeof things)[number] | null = null, least = Infinity
    for (const t of things) {
      const s = onScreen(t.at)
      if (!s.seen) continue
      const size = Math.hypot(...t.half) * 0.7 * s.perMetre
      const off = Math.hypot(s.x - x, s.y - y) - size
      if (off > near || off >= least) continue
      // Hidden: what the eye meets on the way to it is some other thing, well in front of it.
      const to: Vec3 = [t.at[0] - origin[0], t.at[1] - origin[1], t.at[2] - origin[2]]
      const seen = cast(origin, to)
      if (seen && seen.key !== t.key && seen.fraction * s.distance < s.distance - Math.hypot(...t.half) - 0.05) continue
      best = t
      least = off
    }
    return best
  }

  // Build mode asks before it grips a wall (and on every hover move): the answer for one point is kept for the frame.
  let asked: { x: number; y: number; distance: number } | null = null
  const claim = (x: number, y: number) => {
    if (played() || ctx.entries.active) return Infinity
    if (asked?.x === x && asked.y === y) return asked.distance
    const t = pick(x, y, NEAR.mouse)
    asked = { x, y, distance: t ? v.set(...t.at).distanceTo(camera.position) - Math.hypot(...t.half) : Infinity }
    return asked.distance
  }

  interface Held { key: string; pointer: number; touch: boolean; half: Vec3; x: number; y: number; t: number; moved: boolean; /** px from the pointer to where the thing is shown. */ dx: number; dy: number; height: number }
  let held: Held | null = null

  /** Where a held thing is drawn to for a pointer at (x, y): above what the pointer is over. */
  const aim = (h: Held, x: number, y: number) => {
    const { origin, direction } = rayAt(x + h.dx, y + h.dy)
    const under = cast(origin, direction, [h.key])
    let to: Vec3
    if (under) {
      // Clear of the surface along its normal by the thing's own size that way, and lifted.
      const n = under.normal
      const clear = Math.abs(n[0]) * h.half[0] + Math.abs(n[1]) * h.half[1] + Math.abs(n[2]) * h.half[2]
      to = [under.point[0] + n[0] * clear, under.point[1] + n[1] * clear + LIFT, under.point[2] + n[2] * clear]
      h.height = to[1]
    } else {
      // Over nothing (past the island's edge): on the level it was last held at.
      const k = (h.height - origin[1]) / direction[1]
      if (!(k > 0 && k < 1)) return
      to = [origin[0] + direction[0] * k, h.height, origin[2] + direction[2] * k]
    }
    world.hold(h.key, to, GRIP, ARC)
  }

  const letGo = () => {
    if (!held) return
    world.hold(held.key, null)
    held = null
    canvas.style.cursor = ''
  }

  const onDown = (e: PointerEvent) => {
    if (e.target === canvas && !e.isPrimary) letGo() // two fingers: the view's
    if (e.target !== canvas || e.button !== 0 || !e.isPrimary || played() || ctx.entries.active || held) return
    const touch = e.pointerType === 'touch'
    const thing = pick(e.clientX, e.clientY, touch ? NEAR.touch : NEAR.mouse)
    if (!thing) return
    // An entry in front of it (the notebook on the table) is the entry's press.
    if (ctx.entries.probe(e.clientX, e.clientY).entry) return
    swallow(e)
    const s = onScreen(thing.at)
    held = { key: thing.key, pointer: e.pointerId, touch, half: thing.half, x: e.clientX, y: e.clientY, t: e.timeStamp, moved: false, dx: s.x - e.clientX, dy: s.y - e.clientY, height: thing.at[1] + LIFT }
    // Lifted at once, where it stands: the press is felt before the drag.
    world.hold(thing.key, [thing.at[0], thing.at[1] + LIFT, thing.at[2]], GRIP)
    canvas.style.cursor = 'grabbing'
  }
  const onMove = (e: PointerEvent) => {
    if (!held || e.pointerId !== held.pointer) return
    swallow(e)
    if (!held.moved && Math.hypot(e.clientX - held.x, e.clientY - held.y) <= TAP) return
    if (!held.moved) {
      held.moved = true
      // Under a finger the thing is shown above it; under a mouse it stays where it was taken.
      if (held.touch) [held.dx, held.dy] = [0, -ABOVE_FINGER]
    }
    aim(held, e.clientX, e.clientY)
  }
  const onUp = (e: PointerEvent) => {
    if (!held || e.pointerId !== held.pointer) return
    swallow(e)
    const h = held
    letGo()
    if (e.type === 'pointercancel') return
    const thing = world.thing(h.key)
    if (!thing) return
    if (!h.moved && e.timeStamp - h.t < TAP_MS) {
      // A tap: a nudge away from the viewer, flat, with a little hop.
      const away = v.set(thing.position[0] - camera.position.x, 0, thing.position[2] - camera.position.z)
      if (away.lengthSq() < 1e-6) away.set(0, 0, -1)
      away.normalize()
      const dv = Math.min(POKE * world.rules.kick, world.rules.maxSpeed)
      world.setVelocity(h.key, [away.x * dv, HOP * dv, away.z * dv])
      return
    }
    // A throw: it keeps its speed, and a fast one rises a little.
    const [vx, vy, vz] = thing.velocity
    const speed = Math.hypot(vx, vz)
    if (speed > THROW) world.setVelocity(h.key, [vx, Math.max(vy, speed * RISE), vz])
  }

  // Over a loose thing the mouse shows an open hand: once a frame at most, and only while it moves.
  let hover: { x: number; y: number } | null = null
  const onHover = (e: PointerEvent) => {
    if (held || e.pointerType !== 'mouse') return
    hover = e.target === canvas && !e.buttons ? { x: e.clientX, y: e.clientY } : null
    if (!hover && canvas.style.cursor === 'grab') canvas.style.cursor = ''
  }
  const off = ctx.on('village/frame', () => {
    asked = null
    if (!hover || held) return
    const { x, y } = hover
    hover = null
    const over = !played() && !ctx.entries.active && pick(x, y, NEAR.mouse)
    if (over) canvas.style.cursor = 'grab'
    else if (canvas.style.cursor === 'grab') canvas.style.cursor = ''
  })

  // The double click of two quick taps on a thing is not the view's glide.
  let claimed = -Infinity
  const onDouble = (e: MouseEvent) => {
    if (e.target === canvas && e.timeStamp - claimed < 600) swallow(e)
  }
  const down = (e: PointerEvent) => {
    onDown(e)
    if (held?.pointer === e.pointerId) claimed = e.timeStamp
  }
  const opts = { capture: true }
  ctx.effect(() => {
    claims.add(claim)
    addEventListener('pointerdown', down, opts)
    addEventListener('pointermove', onMove, opts)
    addEventListener('pointermove', onHover)
    addEventListener('pointerup', onUp, opts)
    addEventListener('pointercancel', onUp, opts)
    addEventListener('dblclick', onDouble, opts)
    addEventListener('blur', letGo)
    document.addEventListener('visibilitychange', letGo)
    return () => {
      claims.delete(claim)
      removeEventListener('pointerdown', down, opts)
      removeEventListener('pointermove', onMove, opts)
      removeEventListener('pointermove', onHover)
      removeEventListener('pointerup', onUp, opts)
      removeEventListener('pointercancel', onUp, opts)
      removeEventListener('dblclick', onDouble, opts)
      removeEventListener('blur', letGo)
      document.removeEventListener('visibilitychange', letGo)
      off()
      letGo()
    }
  }, 'physics hand')

  return { holding: () => held?.key ?? null, pick: (x: number, y: number, touch = false) => pick(x, y, touch ? NEAR.touch : NEAR.mouse)?.key ?? null }
}
