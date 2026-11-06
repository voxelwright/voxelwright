import * as THREE from 'three/webgpu'
import type { Context } from 'cordis'
import { own, replace } from '../kernel'
import { WALL_Z } from '../layout'
import { paintCalendar } from '../paint'

/** A paper wall calendar hanging from a nail, with this month's family plans. */
export default {
  name: 'calendar',
  inject: ['stage'],
  apply(ctx: Context) {
    const group = new THREE.Group()
    group.name = 'calendar'
    group.position.set(2.3, 1.55, WALL_Z + 0.008)
    group.rotation.z = -0.02
    const page = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.51), new THREE.MeshStandardMaterial({ map: paintCalendar(71), roughness: 0.85 }))
    page.castShadow = page.receiveShadow = true
    group.add(page)
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.36, 8), new THREE.MeshStandardMaterial({ color: '#6b4a30', roughness: 0.6 }))
    rod.rotation.z = Math.PI / 2
    rod.position.set(0, 0.258, 0.006)
    group.add(rod)
    const string = new THREE.Mesh(new THREE.CylinderGeometry(0.0015, 0.0015, 0.13, 4), new THREE.MeshStandardMaterial({ color: '#8b6a4a' }))
    for (const s of [-1, 1]) {
      const piece = string.clone()
      piece.position.set(s * 0.06, 0.29, 0.005)
      piece.rotation.z = s * 1.0
      group.add(piece)
    }
    const nail = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), new THREE.MeshStandardMaterial({ color: '#888', metalness: 0.9, roughness: 0.3 }))
    nail.position.set(0, 0.325, 0.005)
    group.add(nail)
    own(ctx, group)
  },
}

if (import.meta.hot) import.meta.hot.accept((m) => m && replace(m.default))
