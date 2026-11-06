import * as THREE from 'three/webgpu'
import type { Context } from 'cordis'
import { own, replace } from '../kernel'
import { WALL_Z } from '../layout'
import { paintKidDrawing } from '../paint'

/** Mila's crayon drawing, taped to the wall a little crooked. */
export default {
  name: 'drawing',
  inject: ['stage'],
  apply(ctx: Context) {
    const group = new THREE.Group()
    group.name = 'drawing'
    group.position.set(0.32, 1.42, WALL_Z + 0.006)
    group.rotation.z = 0.06
    const paper = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.3), new THREE.MeshStandardMaterial({ map: paintKidDrawing(61), roughness: 0.9 }))
    paper.receiveShadow = true
    group.add(paper)
    const tape = new THREE.MeshStandardMaterial({ color: '#f3e7c4', roughness: 0.6, transparent: true, opacity: 0.75 })
    for (const [x, y, a] of [[-0.19, 0.14, 0.6], [0.19, 0.14, -0.5]]) {
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.022), tape)
      strip.position.set(x, y, 0.001)
      strip.rotation.z = a
      group.add(strip)
    }
    own(ctx, group)
  },
}

if (import.meta.hot) import.meta.hot.accept((m) => m && replace(m.default))
