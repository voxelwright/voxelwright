// Hands for the physics world (#74), by pointer events so a mouse and a finger do the same:
//
// - The pinball table: while it is chosen, a press on the left half of the screen holds the left
//   flipper, on the right half the right one, a swipe down (or a hold on the plunger) pulls the
//   plunger and lets go on release. They set the same inputs as the keys (the toy's `inputs`).
// - Poking: a tap on a light thing in the home nudges it away from the viewer, a press and drag
//   flings it the way the finger went. Both are the `kick` rule's strength.
//
// Order of claims: the build mode (earlier on the window) takes its wall handles; an entry under the
// point is never ours, except the table's own while it is played (the entries layer owns it: `probe`);
// walls and furniture are static and do nothing; while an entry is chosen (the notebook, the
// pinball table) a poke is not ours either. What is ours is swallowed, so the camera does not also
// turn and the entries layer does not also back out. A second finger on the screen ends a poke
// (two fingers are the camera's) and a press the page loses (a window switched away) is let go.
import * as THREE from 'three/webgpu'
import type { Context } from 'cordis'
import type { World } from '../engine/world'

/** px of downward travel that turns a press on the table into a pull on the plunger. */
const SWIPE = 36
/** px a press may drift and still be a tap (the entries layer's threshold). */
const TAP = 10
/** m/s a tap adds to a thing, before the `kick` rule, and the small hop on top of it. */
const POKE = 1.4
const HOP = 0.4
/** m/s a fling may add, before the `kick` rule, and the span of the drag (ms) its speed is read from. */
const FLING = 4
const SPAN = 100
/** A drag slower than this (m/s) when the finger lifts is a thing put down, not thrown. */
const SLOWEST = 0.15
/** Toy ids whose things are not for poking: a played table has its own gestures. */
const NOT_POKED = new Set(['followers', 'bound'])

const swallow = (e: Event) => e.stopImmediatePropagation()

export function touch(ctx: Context, world: World, input: (name: string, down: boolean) => void, played: () => string | null) {
  const { camera, renderer } = ctx.stage
  const canvas = renderer.domElement

  // ── The table's hands ──
  const holds = new Map<number, string>()
  const lift = (id: number) => {
    const name = holds.get(id)
    if (name === undefined) return false
    holds.delete(id)
    // Another finger may still hold the same input.
    if (![...holds.values()].includes(name)) input(name, false)
    return true
  }
  const press = (id: number, name: string) => {
    lift(id) // a mouse is always pointer 1: a press whose release was lost is let go first
    holds.set(id, name)
    input(name, true)
  }
  const origin = new Map<number, { x: number; y: number }>()

  const controls = document.createElement('div')
  controls.className = 'village-table'
  const plunger = document.createElement('button')
  plunger.type = 'button'
  plunger.className = 'plunger'
  plunger.textContent = 'Pull'
  plunger.setAttribute('aria-label', 'Hold to pull the plunger, let go to launch the ball')
  const done = document.createElement('button')
  done.type = 'button'
  done.className = 'done'
  done.textContent = 'Done'
  done.addEventListener('click', () => ctx.entries.back())
  controls.append(done, plunger)
  const style = document.createElement('style')
  style.textContent = `
    .village-table { display: none; }
    .village-table.on { display: block; }
    .village-table button { position: fixed; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; cursor: pointer;
      font: 600 20px "Bradley Hand", "Segoe Print", "Comic Sans MS", cursive; color: #5a4030; background: rgba(251, 243, 226, 0.92);
      border: 0; box-shadow: 0 6px 24px rgba(60, 30, 10, 0.25); z-index: 20; }
    .village-table .plunger { right: max(18px, env(safe-area-inset-right)); bottom: max(86px, calc(env(safe-area-inset-bottom) + 70px)); width: 76px; height: 76px; border-radius: 50%; }
    .village-table .plunger.held { background: #e6b85a; }
    .village-table .done { left: max(14px, env(safe-area-inset-left)); top: max(14px, env(safe-area-inset-top)); padding: 8px 18px; border-radius: 999px; font-size: 18px; }
  `
  plunger.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    e.preventDefault()
    plunger.setPointerCapture(e.pointerId)
    plunger.classList.add('held')
    press(e.pointerId, 'plunger')
  })
  const letGo = (e: PointerEvent) => {
    lift(e.pointerId)
    if (![...holds.values()].includes('plunger')) plunger.classList.remove('held')
  }
  plunger.addEventListener('pointerup', letGo)
  plunger.addEventListener('pointercancel', letGo)
  plunger.addEventListener('lostpointercapture', letGo)

  const onTableDown = (e: PointerEvent) => {
    if (e.target !== canvas || e.button !== 0) return
    // Another entry under the finger is chosen as it always was (leaving the table); the table's own, the field, flips.
    const { entry } = ctx.entries.probe(e.clientX, e.clientY)
    if (entry && entry !== played()) return
    swallow(e)
    origin.set(e.pointerId, { x: e.clientX, y: e.clientY })
    press(e.pointerId, e.clientX < innerWidth / 2 ? 'left' : 'right')
  }
  const onTableMove = (e: PointerEvent) => {
    const from = origin.get(e.pointerId)
    if (!from) return
    swallow(e)
    const dx = e.clientX - from.x, dy = e.clientY - from.y
    if (holds.get(e.pointerId) === 'plunger' || dy < SWIPE || dy < Math.abs(dx) * 1.5) return
    // A swipe down: the press that began as a flip is the plunger's.
    lift(e.pointerId)
    press(e.pointerId, 'plunger')
  }
  const onTableUp = (e: PointerEvent) => {
    if (!origin.delete(e.pointerId)) return
    swallow(e)
    lift(e.pointerId)
  }

  // ── Poking ──
  const ray = new THREE.Raycaster()
  const ndc = new THREE.Vector2()
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0))
  const spot = new THREE.Vector3()
  /** Where a screen point meets the level plane at `height`, or null when it points away from it. */
  const onPlane = (x: number, y: number, height: number) => {
    const rect = canvas.getBoundingClientRect()
    ndc.set(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1)
    ray.setFromCamera(ndc, camera)
    plane.constant = -height
    return ray.ray.intersectPlane(plane, spot) ? spot.clone() : null
  }
  interface Grip { key: string; at: THREE.Vector3; away: THREE.Vector3; x: number; y: number; moved: boolean; trail: { t: number; x: number; y: number }[] }
  const grips = new Map<number, Grip>()
  const push = (key: string, direction: THREE.Vector3, speed: number) => {
    const thing = world.thing(key)
    if (!thing || !Number.isFinite(thing.mass)) return
    const dv = Math.min(speed * world.rules.kick, world.rules.maxSpeed)
    world.applyImpulse(key, [direction.x * dv * thing.mass, direction.y * dv * thing.mass, direction.z * dv * thing.mass])
  }
  let claimed = -Infinity
  const onPokeDown = (e: PointerEvent) => {
    if (e.target === canvas && !e.isPrimary) grips.clear() // two fingers: the camera's
    if (e.target !== canvas || e.button !== 0 || !e.isPrimary || played() || ctx.entries.active) return
    const { entry, hit } = ctx.entries.probe(e.clientX, e.clientY)
    if (entry || !hit) return
    const thing = world.thing(hit.object.name)
    if (!thing || thing.motion !== 'dynamic' || NOT_POKED.has(thing.toy) || hit.object.parent !== world.group) return
    swallow(e)
    claimed = e.timeStamp
    // Away from the viewer along the ray, flat, with a little hop so a thing on the floor lifts off it.
    const away = hit.point.clone().sub(camera.position)
    away.y = 0
    if (away.lengthSq() < 1e-6) away.set(0, 0, -1)
    away.normalize().y = HOP
    grips.set(e.pointerId, { key: thing.key, at: hit.point.clone(), away, x: e.clientX, y: e.clientY, moved: false, trail: [{ t: e.timeStamp, x: e.clientX, y: e.clientY }] })
  }
  const onPokeMove = (e: PointerEvent) => {
    const g = grips.get(e.pointerId)
    if (!g) return
    swallow(e)
    if (Math.hypot(e.clientX - g.x, e.clientY - g.y) > TAP) g.moved = true
    g.trail.push({ t: e.timeStamp, x: e.clientX, y: e.clientY })
    while (g.trail.length > 2 && e.timeStamp - g.trail[0].t > SPAN) g.trail.shift()
  }
  const onPokeUp = (e: PointerEvent) => {
    const g = grips.get(e.pointerId)
    if (!g) return
    grips.delete(e.pointerId)
    swallow(e)
    if (e.type === 'pointercancel' || played()) return
    if (!g.moved) return push(g.key, g.away, POKE)
    // The drag over its last moments (the lift itself counts: a finger held still before it lifts throws nothing), on the
    // level through where it was taken, is the throw.
    g.trail.push({ t: e.timeStamp, x: e.clientX, y: e.clientY })
    while (g.trail.length > 2 && e.timeStamp - g.trail[0].t > SPAN) g.trail.shift()
    const [from, to] = [g.trail[0], g.trail.at(-1)!]
    const a = onPlane(from.x, from.y, g.at.y), b = onPlane(to.x, to.y, g.at.y)
    const seconds = (to.t - from.t) / 1000
    if (!a || !b || seconds < 0.016) return
    const way = b.sub(a)
    const speed = way.length() / seconds
    if (speed < SLOWEST) return
    push(g.key, way.normalize(), Math.min(speed, FLING))
  }

  // The double click of two quick taps on a thing is not the camera's glide.
  const onDouble = (e: MouseEvent) => {
    if (e.target === canvas && e.timeStamp - claimed < 600) swallow(e)
  }
  const letGoAll = () => {
    for (const id of [...holds.keys()]) lift(id)
    origin.clear()
    grips.clear()
    plunger.classList.remove('held')
  }
  const down = (e: PointerEvent) => (played() ? onTableDown(e) : onPokeDown(e))
  const opts = { capture: true }
  ctx.effect(() => {
    document.head.append(style)
    document.body.append(controls)
    addEventListener('pointerdown', down, opts)
    addEventListener('dblclick', onDouble, opts)
    addEventListener('blur', letGoAll)
    document.addEventListener('visibilitychange', letGoAll)
    addEventListener('pointermove', onTableMove, opts)
    addEventListener('pointermove', onPokeMove, opts)
    for (const type of ['pointerup', 'pointercancel'] as const) {
      addEventListener(type, onTableUp, opts)
      addEventListener(type, onPokeUp, opts)
    }
    return () => {
      removeEventListener('pointerdown', down, opts)
      removeEventListener('dblclick', onDouble, opts)
      removeEventListener('blur', letGoAll)
      document.removeEventListener('visibilitychange', letGoAll)
      removeEventListener('pointermove', onTableMove, opts)
      removeEventListener('pointermove', onPokeMove, opts)
      for (const type of ['pointerup', 'pointercancel'] as const) {
        removeEventListener(type, onTableUp, opts)
        removeEventListener(type, onPokeUp, opts)
      }
      for (const id of [...holds.keys()]) lift(id)
      controls.remove()
      style.remove()
    }
  }, 'physics touch')

  return {
    /** The table is chosen or left: its controls show or hide, and every press on it is let go. */
    table(on: boolean) {
      controls.classList.toggle('on', on)
      letGoAll()
    },
  }
}
