import * as THREE from 'three/webgpu'
import type { Context } from 'cordis'
import { replace } from '../kernel'

/** Where the camera stands and what it looks at. */
export interface Pose {
  position: THREE.Vector3
  look: THREE.Vector3
}

/** Lets other plugins ask the camera to frame something, and to come back. */
export interface View {
  /** Ease to a pose, or back to the seat with null. Instant when the person prefers reduced motion. */
  focus(pose: Pose | null): void
  /** True while a focus pose is requested. */
  readonly focused: boolean
  /**
   * Move the seat itself: ease the resting pose to a new one over seconds, or
   * jump with 0. Resolves on arrival. Instant when the person prefers reduced motion.
   */
  travel(pose: Pose, seconds: number): Promise<void>
}

declare module 'cordis' {
  interface Context {
    view: View
  }
}

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')

/**
 * #42 probe. ?cam=iso looks down on the room like a dollhouse (narrow field of
 * view from far away, drag or Q/E to orbit a little, scroll to zoom from the
 * whole room to the table). ?cam=third stands behind and above a point on the
 * floor that walks to what you click. Without ?cam= the seated view is unchanged.
 * Both rigs hang off the resting pose that travel() moves, so room walks and
 * focus poses work in every mode.
 */
const cam = new URLSearchParams(location.search).get('cam')
const MODE: 'seat' | 'iso' | 'third' = cam === 'iso' || cam === 'third' ? cam : 'seat'
const SEAT_FOV = 40
const ISO = { fov: 20, far: 16, near: 5.6, pitchFar: 0.66, pitchNear: 0.5, yaw: 0.6, yawMin: -0.5, yawMax: 1.4 }
const THIRD = { fov: 50, ahead: 1.3, back: 2.4, up: 2.2, lookAhead: 1.6, lookUp: 0.7, reach: 3.2 }
const UP = new THREE.Vector3(0, 1, 0)

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
    const from = { position: new THREE.Vector3(), look: new THREE.Vector3() }
    const to = { position: new THREE.Vector3(), look: new THREE.Vector3() }
    const last: Pose = { position: new THREE.Vector3(), look: new THREE.Vector3() }

    // Rig state for ?cam=iso and ?cam=third: goals set by input, eased each frame.
    const orbit = { yaw: ISO.yaw, goal: ISO.yaw, zoom: 0, zoomGoal: 0 }
    const walk = { at: new THREE.Vector3(), goal: new THREE.Vector3() } // offset from the rest pose's standing point
    const forward = new THREE.Vector3()
    const ground = new THREE.Vector3()
    const backdrop = new THREE.Color('#c99d74')
    let roomBackground: THREE.Scene['background'] = null
    const fogs = new Map<THREE.Fog, [number, number]>()
    const cutaway = new Set<THREE.Object3D>()
    // Iso: the floor planes run past the room, so a ring at floor level fades them into the backdrop.
    const edge = MODE === 'iso' ? softEdge(backdrop) : null
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
    const settle = () => {
      if (!reducedMotion.matches) return
      orbit.yaw = orbit.goal
      orbit.zoom = orbit.zoomGoal
      walk.at.copy(walk.goal)
    }

    // Iso: drag past the entries' 10 px click threshold orbits; Q and E step; the wheel zooms.
    let drag: { x: number; yaw: number; moved: boolean; focused: boolean } | null = null
    const onDown = (e: PointerEvent) => {
      if (e.button === 0) drag = { x: e.clientX, yaw: orbit.goal, moved: false, focused: target !== null }
    }
    const onDrag = (e: PointerEvent) => {
      if (!drag) return
      if (Math.abs(e.clientX - drag.x) > 10) drag.moved = true
      if (drag.moved && !target) {
        orbit.goal = THREE.MathUtils.clamp(drag.yaw - (e.clientX - drag.x) * 0.004, ISO.yawMin, ISO.yawMax)
        settle()
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (target || typing() || e.metaKey || e.ctrlKey || e.altKey) return
      const step = e.key === 'q' || e.key === 'Q' ? -0.35 : e.key === 'e' || e.key === 'E' ? 0.35 : 0
      if (!step) return
      orbit.goal = THREE.MathUtils.clamp(orbit.goal + step, ISO.yawMin, ISO.yawMax)
      settle()
    }
    const onWheel = (e: WheelEvent) => {
      if (target) return
      e.preventDefault()
      orbit.zoomGoal = THREE.MathUtils.clamp(orbit.zoomGoal - e.deltaY * 0.0015, 0, 1)
      settle()
    }

    // Third: a click (not a drag) walks to the floor point, or to a step in front of a thing.
    const raycaster = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    const solid = (object: THREE.Object3D) => {
      if (!(object as THREE.Mesh).isMesh) return false
      for (let o: THREE.Object3D | null = object; o; o = o.parent) if (!o.visible) return false
      return ([] as THREE.Material[]).concat((object as THREE.Mesh).material).some((m) => m.visible && m.depthWrite)
    }
    const onUp = (e: PointerEvent) => {
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

    ctx.effect(() => {
      const saved = { position: camera.position.clone(), quaternion: camera.quaternion.clone(), fov: camera.fov }
      const canvas = renderer.domElement
      if (edge) scene.add(edge)
      if (MODE === 'seat') addEventListener('pointermove', onMove)
      else {
        canvas.addEventListener('pointerdown', onDown)
        addEventListener('pointermove', onDrag)
        addEventListener('pointerup', onUp)
      }
      if (MODE === 'iso') {
        addEventListener('keydown', onKey)
        canvas.addEventListener('wheel', onWheel, { passive: false })
      }
      return () => {
        trip?.done()
        removeEventListener('pointermove', onMove)
        canvas.removeEventListener('pointerdown', onDown)
        removeEventListener('pointermove', onDrag)
        removeEventListener('pointerup', onUp)
        removeEventListener('keydown', onKey)
        canvas.removeEventListener('wheel', onWheel)
        for (const [fog, [near, far]] of fogs) Object.assign(fog, { near, far })
        if (scene.background === backdrop) scene.background = roomBackground
        for (const o of cutaway) o.visible = true
        if (edge) {
          edge.removeFromParent()
          edge.geometry.dispose()
          edge.material.map?.dispose()
          edge.material.dispose()
        }
        camera.position.copy(saved.position)
        camera.quaternion.copy(saved.quaternion)
        camera.fov = saved.fov
        camera.updateProjectionMatrix()
      }
    }, 'camera rig')

    ctx.provide('view', {
      focus(pose: Pose | null) {
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
    })

    camera.fov = MODE === 'iso' ? ISO.fov : MODE === 'third' ? THIRD.fov : SEAT_FOV
    camera.updateProjectionMatrix()
    const rigPosition = new THREE.Vector3()
    const rigLook = new THREE.Vector3()
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
      const goal = target ? 1 : 0
      blend += (goal - blend) * (1 - Math.exp(-dt * 3.2))
      if (Math.abs(goal - blend) < 0.001) blend = goal
      const k = blend * blend * (3 - 2 * blend)
      const calm = 1 - k
      const ease = 1 - Math.exp(-dt * 5)
      let rigFov = SEAT_FOV
      if (MODE === 'iso') {
        orbit.yaw += (orbit.goal - orbit.yaw) * ease
        orbit.zoom += (orbit.zoomGoal - orbit.zoom) * ease
        const z = orbit.zoom * orbit.zoom * (3 - 2 * orbit.zoom)
        const distance = THREE.MathUtils.lerp(ISO.far, ISO.near, z)
        const pitch = THREE.MathUtils.lerp(ISO.pitchFar, ISO.pitchNear, z)
        rigLook.copy(standing(THREE.MathUtils.lerp(3.4, 2.55, z))).setY(THREE.MathUtils.lerp(1.15, 0.75, z))
        toCamera.copy(forward).negate().applyAxisAngle(UP, orbit.yaw).multiplyScalar(Math.cos(pitch) * distance)
        toCamera.y = Math.sin(pitch) * distance
        rigPosition.copy(rigLook).add(toCamera)
        rigPosition.y += Math.sin(t * 0.25) * 0.01
        rigFov = ISO.fov
        edge?.position.set(rigLook.x, 0.004, rigLook.z)
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
      camera.lookAt(from.look.lerp(to.look, k))
      if (MODE === 'seat') return
      // Focus poses were framed at the seat's field of view, so every rig blends back to it.
      const fov = THREE.MathUtils.lerp(rigFov, SEAT_FOV, k)
      if (camera.fov !== fov) {
        camera.fov = fov
        camera.updateProjectionMatrix()
      }
      atmosphere(rigPosition.distanceTo(rigLook) * calm + 3.6 * k)
    })

    /**
     * The rooms' fog was tuned for a viewer 3.6 m from what they look at, so it
     * slides back with the rig. Walls the camera stands behind are cut away, and
     * iso sits on a warm backdrop instead of the dark beyond the room.
     */
    const atmosphere = (distance: number) => {
      const fog = scene.fog
      if (fog instanceof THREE.Fog) {
        if (!fogs.has(fog)) fogs.set(fog, [fog.near, fog.far])
        const [near, far] = fogs.get(fog)!
        const extra = Math.max(0, distance - 3.6)
        fog.near = near + extra
        fog.far = far + extra
      }
      if (scene.background !== backdrop) {
        roomBackground = scene.background
        scene.background = backdrop
      }
      if (--refresh <= 0) {
        refresh = 30
        scene.traverse((o) => (o.userData.inward || (MODE === 'iso' && o.userData.seatOnly)) && cutaway.add(o))
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
        o.getWorldPosition(toCamera)
        toCamera.subVectors(camera.position, toCamera)
        o.visible = toCamera.dot(o.userData.inward as THREE.Vector3) > 0
      }
    }
  },
}

/** A floor-level square, clear in the middle and the backdrop colour at its rim. Not solid, so picking passes through. */
function softEdge(colour: THREE.Color): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
  const size = 512
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')!
  const fade = g.createRadialGradient(size / 2, size / 2, size * 0.28, size / 2, size / 2, size * 0.46)
  fade.addColorStop(0, 'rgba(0,0,0,0)')
  fade.addColorStop(1, `#${colour.getHexString()}`)
  g.fillStyle = fade
  g.fillRect(0, 0, size, size)
  const map = new THREE.CanvasTexture(c)
  map.colorSpace = THREE.SRGBColorSpace
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(12, 12),
    new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, fog: false, toneMapped: false }),
  )
  mesh.rotation.x = -Math.PI / 2
  mesh.name = 'iso soft edge'
  mesh.renderOrder = 1
  return mesh
}

if (import.meta.hot) import.meta.hot.accept((m) => m && replace(m.default))
