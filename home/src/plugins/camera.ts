import * as THREE from 'three/webgpu'
import type { Context } from 'cordis'
import { TALK } from '../features'
import { replace } from '../kernel'
import { focusOn } from '../lens'
import { HOUSE } from '../layout'

/** Where the camera stands and what it looks at. */
export interface Pose {
  position: THREE.Vector3
  look: THREE.Vector3
}

/** Where the dollhouse view rests: a floor point, a zoom (0 the whole house, 1 close up) and, optionally, a turn. */
export interface Frame {
  x: number
  z: number
  zoom: number
  yaw?: number
}

/** Lets other plugins ask the camera to frame something, and to come back. */
export interface View {
  /**
   * Ease to a pose, or back to the seat with null. `rate` is the easing rate per
   * second (3.2 settles in about a second, 7 in about 0.4 s). Instant when the
   * person prefers reduced motion.
   */
  focus(pose: Pose | null, rate?: number): void
  /** True while a focus pose is requested. */
  readonly focused: boolean
  /**
   * Move the seat itself: ease the resting pose to a new one over seconds, or
   * jump with 0. Resolves on arrival. Instant when the person prefers reduced motion.
   */
  travel(pose: Pose, seconds: number): Promise<void>
  /**
   * Dollhouse view: glide over the house to a frame, or jump with 0. Resolves on
   * arrival, or when someone takes the camera on the way. Instant under reduced motion.
   */
  glide(frame: Frame, seconds: number): Promise<void>
  /** The floor point the view rests on (dollhouse) or looks at (other modes). */
  readonly looking: THREE.Vector3
  /** The dollhouse view's current frame, eased. */
  readonly frame: Required<Frame>
}

declare module 'cordis' {
  interface Context {
    view: View
  }
}

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')

/**
 * Keys the dollhouse view has taken for moving around. The always-on input checks
 * this before it turns a key into writing (talk.ts `blocked`), so a held W pans
 * instead of writing "w". A tapped W still writes: see `onKeyDown` below.
 */
export const navigation = {
  claims: () => false,
  /** Set by talk.ts: a line is being written (words on the pad, the field focused, or a sketch), so keys are the line's. */
  writing: () => false,
}

/**
 * ?cam=iso (the default while talk is on) looks down on the whole house like a
 * dollhouse you move around freely; ?cam=third stands behind and above a point on
 * the floor that walks to what you click. With ?talk=off and no ?cam= the seated view is unchanged.
 * Every rig hangs off a resting pose, so focus poses work in every mode.
 */
const query = new URLSearchParams(location.search)
// With talk on (the default) the page looks at the house from above unless ?cam= says otherwise (?cam=seat is the seated view).
const cam = query.get('cam') ?? (TALK ? 'iso' : null)
export const MODE: 'seat' | 'iso' | 'third' = cam === 'iso' || cam === 'third' ? cam : 'seat'
/** Layer for walls cut away from the camera: the sun's shadow camera still sees them, the view does not. */
export const SHADOW_ONLY = 1
const SEAT_FOV = 40
/**
 * The dollhouse rig. Distance runs from `far` (the whole house and its yard) to
 * `near` (one corner of a room), evenly in ratio so each wheel notch feels the same.
 * Pitch flattens a little as you come close; dragging up or down tilts within `tilt`.
 */
const ISO = { fov: 20, far: 36, near: 5.6, pitchFar: 0.74, pitchNear: 0.5, tilt: [-0.22, 0.32] as const }
/** The whole-house frame the dollhouse opens on. */
export const OVERVIEW: Required<Frame> = { x: (HOUSE.x0 + HOUSE.x1) / 2, z: (HOUSE.z0 + HOUSE.z1) / 2 + 0.2, zoom: 0, yaw: 0.42 }
/** The view rests on the house and its yard, never past them. */
const BOUNDS = { x0: HOUSE.x0 - 1, x1: HOUSE.x1 + 1, z0: HOUSE.z0 - 1.5, z1: HOUSE.z1 + 1.5 }
const THIRD = { fov: 50, ahead: 1.3, back: 2.4, up: 2.2, lookAhead: 1.6, lookUp: 0.7, reach: 3.2 }
const UP = new THREE.Vector3(0, 1, 0)
/** Letters that move the dollhouse view while held: WASD pan, Q and E turn. */
const LETTERS: Record<string, [number, number, number]> = { w: [0, 1, 0], s: [0, -1, 0], a: [-1, 0, 0], d: [1, 0, 0], q: [0, 0, -1], e: [0, 0, 1] }
const ARROWS: Record<string, [number, number, number]> = { ArrowUp: [0, 1, 0], ArrowDown: [0, -1, 0], ArrowLeft: [-1, 0, 0], ArrowRight: [1, 0, 0] }
/** How long a letter must stay down before it moves the view instead of writing. */
const HOLD_MS = 170

/** Seated view across the table, with a slow breath and pointer parallax. Provides the view service. */
export default {
  name: 'camera',
  inject: ['stage'],
  apply(ctx: Context) {
    const { camera, renderer, scene } = ctx.stage
    const home = new THREE.Vector3(0.1, 1.45, 2.7)
    const look = new THREE.Vector3(0.12, 1.05, -0.9)
    let trip: { from: Pose; to: Pose; u: number; seconds: number; done: () => void } | null = null
    const pointer = new THREE.Vector2()
    const eased = new THREE.Vector2()
    const onMove = (e: PointerEvent) => pointer.set((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1)

    let target: Pose | null = null
    let blend = 0 // 0 at the seat, 1 at the focus pose
    let rate = 3.2
    const from = { position: new THREE.Vector3(), look: new THREE.Vector3() }
    const to = { position: new THREE.Vector3(), look: new THREE.Vector3() }
    const last: Pose = { position: new THREE.Vector3(), look: new THREE.Vector3() }

    // Dollhouse rig: goals set by input, eased each frame.
    const rig = { ...OVERVIEW, tilt: 0 }
    const goal = { ...OVERVIEW, tilt: 0 }
    let glide: { from: Required<Frame>; to: Required<Frame>; u: number; seconds: number; done: () => void } | null = null
    const held = new Map<string, [number, number, number]>()
    const walk = { at: new THREE.Vector3(), goal: new THREE.Vector3() } // third: offset from the rest pose's standing point
    const forward = new THREE.Vector3()
    const ground = new THREE.Vector3()
    // Behind a theme's world, where the home's own sky (atmosphere.ts) has stepped back: a warm haze.
    const backdrop = new THREE.Color('#c99d74')
    let roomBackground: THREE.Scene['background'] = null
    const fogs = new Map<THREE.Fog, [number, number]>()
    const cutaway = new Set<THREE.Object3D>()
    let refresh = 0

    /** The rest pose's facing on the floor and the floor point some metres ahead of it. */
    const standing = (ahead: number) => {
      forward.set(look.x - home.x, 0, look.z - home.z).normalize()
      return ground.copy(home).addScaledVector(forward, ahead).setY(0)
    }
    const typing = () => {
      const el = document.activeElement as HTMLElement | null
      return Boolean(el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable))
    }
    const written = () => {
      const el = document.activeElement as HTMLInputElement | null
      return navigation.writing() || (typing() && Boolean(el?.value ?? el?.textContent))
    }
    const clampGoal = () => {
      goal.x = THREE.MathUtils.clamp(goal.x, BOUNDS.x0, BOUNDS.x1)
      goal.z = THREE.MathUtils.clamp(goal.z, BOUNDS.z0, BOUNDS.z1)
      goal.zoom = THREE.MathUtils.clamp(goal.zoom, 0, 1)
      goal.tilt = THREE.MathUtils.clamp(goal.tilt, ISO.tilt[0], ISO.tilt[1])
    }
    /** Someone took the camera: an unfinished glide stops where it is. */
    const takeOver = () => {
      if (!glide) return
      const { done } = glide
      glide = null
      Object.assign(goal, { x: rig.x, z: rig.z, zoom: rig.zoom, yaw: rig.yaw })
      done()
    }
    const settle = () => {
      clampGoal()
      if (!reducedMotion.matches) return
      Object.assign(rig, goal)
      walk.at.copy(walk.goal)
    }
    const distance = (zoom: number) => ISO.far * Math.pow(ISO.near / ISO.far, zoom)
    /** Pan the goal by screen-relative amounts in metres: +x right, +y away from the viewer. */
    const pan = (right: number, away: number) => {
      const s = Math.sin(goal.yaw), c = Math.cos(goal.yaw)
      goal.x += right * c - away * s
      goal.z += -right * s - away * c
    }

    // Pointer: a left drag past the entries' click threshold turns and tilts; a right
    // drag, a shift drag or two fingers pan; the wheel or a pinch zooms; a double click glides there.
    const pointers = new Map<number, { x: number; y: number }>()
    let drag: { x: number; y: number; moved: boolean; pan: boolean; focused: boolean } | null = null
    let pinch = 0
    const onDown = (e: PointerEvent) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()]
        pinch = Math.hypot(a.x - b.x, a.y - b.y)
      }
      if (e.button === 0 || e.button === 2 || e.button === 1) drag = { x: e.clientX, y: e.clientY, moved: false, pan: e.button !== 0 || e.shiftKey || pointers.size > 1, focused: target !== null }
    }
    const onDrag = (e: PointerEvent) => {
      const p = pointers.get(e.pointerId)
      if (!drag || !p) return
      const dx = e.clientX - p.x, dy = e.clientY - p.y
      p.x = e.clientX
      p.y = e.clientY
      if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 10) drag.moved = true
      if (!drag.moved || target || MODE !== 'iso') return
      takeOver()
      if (pointers.size > 1) {
        // Two fingers: the midpoint pans, the spread zooms.
        const [a, b] = [...pointers.values()]
        const spread = Math.hypot(a.x - b.x, a.y - b.y)
        if (pinch) goal.zoom += Math.log(spread / pinch) * 0.9
        pinch = spread
        drag.pan = true
      }
      if (drag.pan) {
        const perPixel = (2 * distance(rig.zoom) * Math.tan(THREE.MathUtils.degToRad(ISO.fov) / 2)) / innerHeight / (pointers.size > 1 ? 2 : 1)
        pan(-dx * perPixel, dy * perPixel / Math.sin(pitchOf(rig.zoom, rig.tilt)))
      } else {
        goal.yaw -= dx * 0.006
        goal.tilt += dy * 0.003
      }
      settle()
    }
    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId)
      if (pointers.size < 2) pinch = 0
      if (pointers.size) return
      const was = drag
      drag = null
      // The entries layer may already have chosen what was clicked; walk there all the same.
      if (MODE !== 'third' || !was || was.moved || was.focused) return
      const rect = renderer.domElement.getBoundingClientRect()
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1)
      raycaster.setFromCamera(ndc, camera)
      const hit = raycaster.intersectObject(scene, true).find((h) => solid(h.object))
      if (!hit) return
      const base = standing(THIRD.ahead).clone()
      const spot = hit.point.clone().setY(0)
      if (hit.point.y > 0.05) spot.addScaledVector(forward, -1.1)
      const offset = spot.sub(base)
      if (offset.length() > THIRD.reach) offset.setLength(THIRD.reach)
      walk.goal.copy(offset)
      settle()
    }
    const onContext = (e: Event) => e.preventDefault()
    const onWheel = (e: WheelEvent) => {
      if (target) return
      e.preventDefault()
      takeOver()
      // A trackpad pinch arrives as a wheel with ctrl held, in much smaller steps.
      const lines = e.deltaMode === 1 ? 33 : 1
      goal.zoom -= e.deltaY * lines * (e.ctrlKey ? 0.01 : 0.0015)
      settle()
    }
    const floorPoint = new THREE.Vector3()
    const floorPlane = new THREE.Plane(UP, 0)
    const onDouble = (e: MouseEvent) => {
      if (target || MODE !== 'iso') return
      const rect = renderer.domElement.getBoundingClientRect()
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1)
      raycaster.setFromCamera(ndc, camera)
      if (!raycaster.ray.intersectPlane(floorPlane, floorPoint)) return
      void view.glide({ x: floorPoint.x, z: floorPoint.z, zoom: Math.max(goal.zoom, 0.55) }, 0.9)
    }

    // Keyboard. Arrows pan whenever nothing is being written. Letters belong to the
    // always-on input: a tapped letter writes, as before; held for HOLD_MS, a WASD or
    // QE letter moves the view instead, until it is let go. A second key during the
    // wait means someone is typing, so the first letter is written and typing goes on.
    // When the main thread stalls, the timer fires before the queued keyup or next
    // keydown runs, so a letter the timer called a hold is judged again by the events'
    // own timeStamps (when the key really went down) and typed if it was a tap.
    let pending: { key: string; timer: ReturnType<typeof setTimeout> } | null = null
    let turned: { key: string; down: number } | null = null // the letter the timer last turned into a hold
    let replaying = false
    navigation.claims = () => pending !== null || [...held.keys()].some((k) => k in LETTERS)
    const type = (key: string) => {
      replaying = true
      try {
        dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
      } finally {
        replaying = false
      }
    }
    const write = () => {
      if (!pending) return
      const { key, timer } = pending
      clearTimeout(timer)
      pending = null
      type(key)
    }
    /** The timer's hold was a tap if the event came within HOLD_MS of the keydown: stop moving and type it. */
    const unhold = (at: number) => {
      if (!turned) return false
      const { key, down } = turned
      turned = null
      if (at - down >= HOLD_MS || !held.delete(key)) return false
      type(key)
      return true
    }
    /** Another key came while a letter was undecided or within HOLD_MS of its keydown: the letter was typed. */
    const settles = (e: KeyboardEvent) => {
      if (pending) {
        write()
        return true
      }
      return e.key.length === 1 && unhold(e.timeStamp)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (replaying || MODE !== 'iso' || e.metaKey || e.ctrlKey || e.altKey) return
      if (target) return
      const arrow = ARROWS[e.key]
      if (arrow) {
        if (written()) return
        e.preventDefault()
        takeOver()
        held.set(e.key, arrow)
        return
      }
      const letter = LETTERS[e.key]
      if (!letter || typing() || navigation.writing()) {
        settles(e)
        return
      }
      if (e.repeat || held.has(e.key)) {
        e.preventDefault()
        return
      }
      if (settles(e)) return
      e.preventDefault()
      const key = e.key
      const down = e.timeStamp
      pending = {
        key,
        timer: setTimeout(() => {
          pending = null
          turned = { key, down }
          takeOver()
          held.set(key, letter)
        }, HOLD_MS),
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (pending?.key === e.key) write()
      else if (turned?.key === e.key) unhold(e.timeStamp)
      held.delete(e.key)
    }
    const onBlur = () => {
      if (pending) clearTimeout(pending.timer)
      pending = null
      turned = null
      held.clear()
    }

    const raycaster = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    const solid = (object: THREE.Object3D) => {
      if (!(object as THREE.Mesh).isMesh) return false
      for (let o: THREE.Object3D | null = object; o; o = o.parent) if (!o.visible) return false
      return ([] as THREE.Material[]).concat((object as THREE.Mesh).material).some((m) => m.visible && m.depthWrite)
    }

    ctx.effect(() => {
      const saved = { position: camera.position.clone(), quaternion: camera.quaternion.clone(), fov: camera.fov }
      const canvas = renderer.domElement
      if (MODE === 'seat') addEventListener('pointermove', onMove)
      else {
        canvas.addEventListener('pointerdown', onDown)
        addEventListener('pointermove', onDrag)
        addEventListener('pointerup', onUp)
        addEventListener('pointercancel', onUp)
      }
      if (MODE === 'iso') {
        // Capture on window, registered before the always-on input's own listener.
        addEventListener('keydown', onKeyDown, true)
        addEventListener('keyup', onKeyUp, true)
        addEventListener('blur', onBlur)
        canvas.addEventListener('wheel', onWheel, { passive: false })
        canvas.addEventListener('dblclick', onDouble)
        canvas.addEventListener('contextmenu', onContext)
        canvas.style.touchAction = 'none'
      }
      return () => {
        trip?.done()
        glide?.done()
        onBlur()
        navigation.claims = () => false
        removeEventListener('pointermove', onMove)
        canvas.removeEventListener('pointerdown', onDown)
        removeEventListener('pointermove', onDrag)
        removeEventListener('pointerup', onUp)
        removeEventListener('pointercancel', onUp)
        removeEventListener('keydown', onKeyDown, true)
        removeEventListener('keyup', onKeyUp, true)
        removeEventListener('blur', onBlur)
        canvas.removeEventListener('wheel', onWheel)
        canvas.removeEventListener('dblclick', onDouble)
        canvas.removeEventListener('contextmenu', onContext)
        for (const [fog, [near, far]] of fogs) Object.assign(fog, { near, far })
        if (scene.background === backdrop) scene.background = roomBackground
        for (const o of cutaway) {
          o.traverse((n) => n.layers.set(0))
          o.visible = !o.userData.cutaway
        }
        camera.position.copy(saved.position)
        camera.quaternion.copy(saved.quaternion)
        camera.fov = saved.fov
        camera.updateProjectionMatrix()
      }
    }, 'camera rig')

    const rigLook = new THREE.Vector3()
    const view: View = {
      focus(pose: Pose | null, speed = 3.2) {
        // About 1 s at the default rate, 0.4 s at 7 (the ease is exponential); instant under reduced motion.
        if (pose || target) ctx.emit('village/glide', { seconds: reducedMotion.matches ? 0 : 3.2 / speed, to: pose?.look })
        rate = speed
        if (pose) {
          last.position.copy(pose.position)
          last.look.copy(pose.look)
        }
        target = pose
        if (reducedMotion.matches) blend = pose ? 1 : 0
      },
      get focused() {
        return target !== null
      },
      travel(pose: Pose, seconds: number) {
        trip?.done()
        trip = null
        walk.goal.set(0, 0, 0) // a room walk starts from the room's own standing point
        if (seconds <= 0 || reducedMotion.matches) {
          home.copy(pose.position)
          look.copy(pose.look)
          walk.at.set(0, 0, 0)
          return Promise.resolve()
        }
        return new Promise<void>((done) => {
          trip = { from: { position: home.clone(), look: look.clone() }, to: pose, u: 0, seconds, done }
        })
      },
      glide(frame: Frame, seconds: number) {
        takeOver()
        // A frame's turn is reached the short way round, however many times the view has been turned.
        const yaw = frame.yaw === undefined ? goal.yaw : rig.yaw + THREE.MathUtils.euclideanModulo(frame.yaw - rig.yaw + Math.PI, Math.PI * 2) - Math.PI
        const end = { x: frame.x, z: frame.z, zoom: frame.zoom, yaw, tilt: goal.tilt }
        Object.assign(goal, end)
        clampGoal()
        if (seconds <= 0 || reducedMotion.matches) {
          Object.assign(rig, goal)
          return Promise.resolve()
        }
        ctx.emit('village/glide', { seconds, to: { x: frame.x, y: 0, z: frame.z } })
        return new Promise<void>((done) => {
          glide = { from: { x: rig.x, z: rig.z, zoom: rig.zoom, yaw: rig.yaw }, to: { x: goal.x, z: goal.z, zoom: goal.zoom, yaw: goal.yaw }, u: 0, seconds, done }
        })
      },
      get looking() {
        return rigLook
      },
      get frame() {
        return { x: rig.x, z: rig.z, zoom: rig.zoom, yaw: rig.yaw }
      },
    }
    ctx.provide('view', view)

    const pitchOf = (zoom: number, tilt: number) => THREE.MathUtils.lerp(ISO.pitchFar, ISO.pitchNear, zoom) + tilt
    camera.fov = MODE === 'iso' ? ISO.fov : MODE === 'third' ? THIRD.fov : SEAT_FOV
    // Outside the seated rooms the view reaches the sea of cloud under the island (atmosphere.ts).
    if (MODE !== 'seat') camera.far = 260
    camera.updateProjectionMatrix()
    const rigPosition = new THREE.Vector3()
    const toCamera = new THREE.Vector3()
    ctx.on('village/frame', (dt, t) => {
      if (trip) {
        trip.u = Math.min(1, trip.u + dt / trip.seconds)
        const u = trip.u
        const k = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2
        home.lerpVectors(trip.from.position, trip.to.position, k)
        look.lerpVectors(trip.from.look, trip.to.look, k)
        if (u === 1) {
          const { done } = trip
          trip = null
          done()
        }
      }
      if (MODE === 'seat') eased.lerp(pointer, 1 - Math.exp(-dt * 2.5))
      const goalBlend = target ? 1 : 0
      blend += (goalBlend - blend) * (1 - Math.exp(-dt * rate))
      if (Math.abs(goalBlend - blend) < 0.001) blend = goalBlend
      const k = blend * blend * (3 - 2 * blend)
      const calm = 1 - k
      let rigFov = SEAT_FOV
      if (MODE === 'iso') {
        // Held keys move the goal at a pace that scales with how far away the view is.
        if (held.size && !target) {
          let right = 0, away = 0, turn = 0
          for (const [x, y, r] of held.values()) {
            right += x
            away += y
            turn += r
          }
          const speed = distance(rig.zoom) * 0.45 * dt
          pan(right * speed, away * speed)
          goal.yaw += turn * 1.6 * dt
          settle()
        }
        if (glide) {
          glide.u = Math.min(1, glide.u + dt / glide.seconds)
          const u = glide.u
          const e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2
          const { from: a, to: b } = glide
          // A long glide lifts a little on the way, so it reads as moving over the house.
          const span = Math.hypot(b.x - a.x, b.z - a.z)
          rig.x = THREE.MathUtils.lerp(a.x, b.x, e)
          rig.z = THREE.MathUtils.lerp(a.z, b.z, e)
          rig.yaw = THREE.MathUtils.lerp(a.yaw, b.yaw, e)
          rig.zoom = THREE.MathUtils.lerp(a.zoom, b.zoom, e) - Math.sin(Math.PI * u) * Math.min(0.18, span * 0.025)
          if (u === 1) {
            const { done } = glide
            glide = null
            done()
          }
        } else {
          const ease = 1 - Math.exp(-dt * 6)
          rig.x += (goal.x - rig.x) * ease
          rig.z += (goal.z - rig.z) * ease
          rig.yaw += (goal.yaw - rig.yaw) * ease
          rig.zoom += (goal.zoom - rig.zoom) * ease
        }
        rig.tilt += (goal.tilt - rig.tilt) * (1 - Math.exp(-dt * 6))
        const d = distance(rig.zoom)
        const pitch = pitchOf(rig.zoom, rig.tilt)
        rigLook.set(rig.x, THREE.MathUtils.lerp(0.9, 0.75, rig.zoom), rig.z)
        toCamera.set(Math.sin(rig.yaw), 0, Math.cos(rig.yaw)).multiplyScalar(Math.cos(pitch) * d)
        toCamera.y = Math.sin(pitch) * d
        rigPosition.copy(rigLook).add(toCamera)
        rigFov = ISO.fov
      } else if (MODE === 'third') {
        walk.at.lerp(walk.goal, 1 - Math.exp(-dt * 2.2))
        const stand = standing(THIRD.ahead).add(walk.at)
        rigPosition.copy(stand).addScaledVector(forward, -THIRD.back).setY(THIRD.up + Math.sin(t * 0.4) * 0.005)
        rigLook.copy(stand).addScaledVector(forward, THIRD.lookAhead).setY(THIRD.lookUp)
        rigFov = THIRD.fov
      } else {
        rigPosition.set(
          home.x + eased.x * 0.14 * calm + Math.sin(t * 0.25) * 0.008,
          home.y - eased.y * 0.07 * calm + Math.sin(t * 0.4) * 0.005,
          home.z,
        )
        rigLook.set(look.x + eased.x * 0.04 * calm, look.y - eased.y * 0.02 * calm, look.z)
      }
      from.position.copy(rigPosition)
      from.look.copy(rigLook)
      to.position.copy(last.position)
      to.look.copy(last.look)
      camera.position.lerpVectors(from.position, to.position, k)
      // Off the seat a focus move arcs up on the way, so it comes down onto its pose instead of through the furniture.
      if (MODE !== 'seat') camera.position.y += Math.sin(Math.PI * k) * Math.min(1.2, 0.3 * from.position.distanceTo(to.position))
      const looked = from.look.lerp(to.look, k)
      camera.lookAt(looked)
      if (MODE === 'seat') {
        // Seated, the whole room is sharp; leaning in to the notebook or the fridge, the room behind it softens.
        focusOn(camera.position.distanceTo(looked), k, k)
        return
      }
      // Focus poses were framed at the seat's field of view, so every rig blends back to it.
      const fov = THREE.MathUtils.lerp(rigFov, SEAT_FOV, k)
      if (camera.fov !== fov) {
        camera.fov = fov
        camera.updateProjectionMatrix()
      }
      atmosphere(rigPosition.distanceTo(rigLook) * calm + 3.6 * k, looked, MODE === 'iso' ? Math.max(rig.zoom, k) : 1)
      // Walking in third person nothing blurs, as on the seat: the lens opens only on a focus pose.
      focusOn(camera.position.distanceTo(looked), MODE === 'iso' ? Math.max(rig.zoom, k) : k, MODE === 'iso' ? 1 : k)
    })

    /**
     * The rooms' fog was tuned for a viewer 3.6 m from what they look at, so it
     * slides back with the rig. Off the seat the view stands under the sky (atmosphere.ts), with a warm haze behind a theme's world.
     *
     * Cutaway. Outer walls (`userData.inward`) the camera stands behind leave the view
     * but keep casting shadows, and a cut stub (`userData.cutaway`) takes their place.
     * Interior walls (`userData.interior`, between two rooms) have two insides, so they
     * follow a different rule: they stand at full height only when the view is close in
     * (zoom over 0.5, or a focus pose) and the wall is behind what you look at, so it is
     * that room's backdrop. Otherwise they are stubs, and the next room shows over them.
     */
    const lookAt = new THREE.Vector3()
    const atmosphere = (distanceToLook: number, looked: THREE.Vector3, closeness: number) => {
      lookAt.copy(looked)
      const fog = scene.fog
      if (fog instanceof THREE.Fog) {
        if (!fogs.has(fog)) fogs.set(fog, [fog.near, fog.far])
        const [near, far] = fogs.get(fog)!
        const extra = Math.max(0, distanceToLook - 3.6)
        fog.near = near + extra
        fog.far = far + extra
      }
      if (scene.background !== backdrop) {
        roomBackground = scene.background
        scene.background = backdrop
      }
      if (--refresh <= 0) {
        refresh = 30
        scene.traverse((o) => (o.userData.inward || o.userData.interior || (MODE === 'iso' && o.userData.seatOnly)) && cutaway.add(o))
      }
      for (const o of cutaway) {
        if (!o.parent) {
          cutaway.delete(o)
          continue
        }
        if (o.userData.seatOnly) {
          o.visible = false
          continue
        }
        let facing: boolean
        if (o.userData.interior) {
          const x = (o.userData.interior as { x: number }).x
          facing = closeness > 0.5 && Math.sign(camera.position.x - x) === Math.sign(lookAt.x - x)
        } else {
          o.getWorldPosition(toCamera)
          toCamera.subVectors(camera.position, toCamera)
          facing = toCamera.dot(o.userData.inward as THREE.Vector3) > 0
        }
        if (o.userData.cutaway) o.visible = !facing
        else if (o.layers.isEnabled(0) !== facing) o.traverse((n) => n.layers.set(facing ? 0 : SHADOW_ONLY))
      }
    }
  },
}

if (import.meta.hot) import.meta.hot.accept((m) => m && replace(m.default))
