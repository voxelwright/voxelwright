import * as THREE from 'three/webgpu'
import type { Context } from 'cordis'
import { own, replace } from '../kernel'

/** An enamel pendant lamp hanging over the table, already on as the sun goes down. */
export default {
  name: 'lamp',
  inject: ['stage'],
  apply(ctx: Context) {
    const group = new THREE.Group()
    group.name = 'lamp'
    group.position.set(0.42, 0, 0.35)
    const hang = 1.78
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 1.2, 6), new THREE.MeshStandardMaterial({ color: '#2b2420' }))
    cord.position.y = hang + 0.6
    const shade = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.22, 0.16, 40, 1, true),
      new THREE.MeshStandardMaterial({ color: '#2f5446', roughness: 0.4, metalness: 0.2, side: THREE.DoubleSide }),
    )
    shade.position.y = hang
    shade.castShadow = true
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.045, 20, 12),
      new THREE.MeshStandardMaterial({ color: '#fff1d0', emissive: '#ffcf8a', emissiveIntensity: 6 }),
    )
    bulb.position.y = hang - 0.06
    group.add(cord, shade, bulb)

    const light = new THREE.PointLight('#ffb867', 1.6, 3.5, 1.4)
    light.position.y = hang - 0.1
    group.add(light)
    own(ctx, group)
  },
}

if (import.meta.hot) import.meta.hot.accept((m) => m && replace(m.default))
