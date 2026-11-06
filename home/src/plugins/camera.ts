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

/** Seated view across the table, with a slow breath and pointer parallax. Provides the view service. */
export default {
  name: 'camera',
  inject: ['stage'],
  apply(ctx: Context) {
    const { camera } = ctx.stage
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

    ctx.effect(() => {
      const saved = { position: camera.position.clone(), quaternion: camera.quaternion.clone(), fov: camera.fov }
      addEventListener('pointermove', onMove)
      return () => {
        trip?.done()
        removeEventListener('pointermove', onMove)
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
        if (seconds <= 0 || reducedMotion.matches) {
          home.copy(pose.position)
          look.copy(pose.look)
          return Promise.resolve()
        }
        return new Promise<void>((done) => {
          trip = { from: { position: home.clone(), look: look.clone() }, to: pose, u: 0, seconds, done }
        })
      },
    })

    camera.fov = 40
    camera.updateProjectionMatrix()
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
      eased.lerp(pointer, 1 - Math.exp(-dt * 2.5))
      const goal = target ? 1 : 0
      blend += (goal - blend) * (1 - Math.exp(-dt * 3.2))
      if (Math.abs(goal - blend) < 0.001) blend = goal
      const k = blend * blend * (3 - 2 * blend)
      const calm = 1 - k
      from.position.set(
        home.x + eased.x * 0.14 * calm + Math.sin(t * 0.25) * 0.008,
        home.y - eased.y * 0.07 * calm + Math.sin(t * 0.4) * 0.005,
        home.z,
      )
      from.look.set(look.x + eased.x * 0.04 * calm, look.y - eased.y * 0.02 * calm, look.z)
      to.position.copy(last.position)
      to.look.copy(last.look)
      camera.position.lerpVectors(from.position, to.position, k)
      camera.lookAt(from.look.lerp(to.look, k))
    })
  },
}

if (import.meta.hot) import.meta.hot.accept((m) => m && replace(m.default))
