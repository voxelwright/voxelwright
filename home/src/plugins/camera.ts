import * as THREE from 'three/webgpu'
import type { Context } from 'cordis'
import { replace } from '../kernel'

/** Seated view across the table, with a slow breath and pointer parallax. */
export default {
  name: 'camera',
  inject: ['stage'],
  apply(ctx: Context) {
    const { camera } = ctx.stage
    const home = new THREE.Vector3(0.1, 1.45, 2.7)
    const look = new THREE.Vector3(0.12, 1.05, -0.9)
    const pointer = new THREE.Vector2()
    const eased = new THREE.Vector2()
    const onMove = (e: PointerEvent) => pointer.set((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1)

    ctx.effect(() => {
      const saved = { position: camera.position.clone(), quaternion: camera.quaternion.clone(), fov: camera.fov }
      addEventListener('pointermove', onMove)
      return () => {
        removeEventListener('pointermove', onMove)
        camera.position.copy(saved.position)
        camera.quaternion.copy(saved.quaternion)
        camera.fov = saved.fov
        camera.updateProjectionMatrix()
      }
    }, 'camera rig')

    camera.fov = 40
    camera.updateProjectionMatrix()
    ctx.on('village/frame', (dt, t) => {
      eased.lerp(pointer, 1 - Math.exp(-dt * 2.5))
      camera.position.set(
        home.x + eased.x * 0.14 + Math.sin(t * 0.25) * 0.008,
        home.y - eased.y * 0.07 + Math.sin(t * 0.4) * 0.005,
        home.z,
      )
      camera.lookAt(look.x + eased.x * 0.04, look.y - eased.y * 0.02, look.z)
    })
  },
}

if (import.meta.hot) import.meta.hot.accept((m) => m && replace(m.default))
