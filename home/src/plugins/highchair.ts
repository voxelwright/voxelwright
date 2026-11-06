import * as THREE from 'three/webgpu'
import type { Context } from 'cordis'
import { own, replace } from '../kernel'
import { pineMaterial } from './chairs'

/** A tall wooden child's chair pulled up to the left end of the table. */
export default {
  name: 'highchair',
  inject: ['stage'],
  apply(ctx: Context) {
    const group = new THREE.Group()
    group.name = 'highchair'
    group.position.set(-1.28, 0, 0.0)
    group.rotation.y = Math.PI / 2 - 0.2
    const pine = pineMaterial()
    const walnut = new THREE.MeshStandardMaterial({ color: '#5b3d2a', roughness: 0.6 })
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0) => {
      const m = new THREE.Mesh(geo, mat)
      m.position.set(x, y, z)
      m.rotation.x = rx
      m.castShadow = m.receiveShadow = true
      group.add(m)
    }
    // Two leaning side rails, as on a step-style high chair.
    for (const x of [-0.2, 0.2]) {
      add(new THREE.BoxGeometry(0.035, 1.05, 0.05), walnut, x, 0.5, -0.05, -0.18)
      add(new THREE.BoxGeometry(0.035, 0.03, 0.5), walnut, x, 0.02, 0.0)
    }
    add(new THREE.BoxGeometry(0.42, 0.025, 0.3), pine, 0, 0.62, 0.0)
    add(new THREE.BoxGeometry(0.42, 0.022, 0.24), pine, 0, 0.3, 0.07)
    add(new THREE.BoxGeometry(0.42, 0.16, 0.022), pine, 0, 0.82, -0.16, -0.1)
    own(ctx, group)
  },
}

if (import.meta.hot) import.meta.hot.accept((m) => m && replace(m.default))
