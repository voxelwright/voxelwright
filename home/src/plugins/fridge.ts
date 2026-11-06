import * as THREE from 'three/webgpu'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import type { Context } from 'cordis'
import { own, replace } from '../kernel'
import { WALL_Z } from '../layout'
import { paintEnamel, paintPhoto } from '../paint'

const PHOTOS = [
  { kind: 'beach', x: -0.17, y: 1.52, rot: 0.08, magnet: '#d9534f' },
  { kind: 'cat', x: 0.14, y: 1.42, rot: -0.1, magnet: '#f0ad4e' },
  { kind: 'drawing', x: -0.12, y: 1.12, rot: -0.05, magnet: '#5bc0de' },
  { kind: 'mountains', x: 0.16, y: 1.06, rot: 0.12, magnet: '#7cb35b' },
] as const

export default {
  name: 'fridge',
  inject: ['stage'],
  apply(ctx: Context) {
    const group = new THREE.Group()
    group.name = 'fridge'
    const W = 0.78, H = 1.82, D = 0.68
    group.position.set(1.5, 0, WALL_Z + D / 2 + 0.02)
    group.rotation.y = -0.12

    const enamel = new THREE.MeshPhysicalMaterial({
      map: paintEnamel(9, [196, 222, 206]),
      roughness: 0.32,
      clearcoat: 0.6,
      clearcoatRoughness: 0.25,
    })
    const body = new THREE.Mesh(new RoundedBoxGeometry(W, H, D, 6, 0.09), enamel)
    body.position.y = H / 2 + 0.06
    body.castShadow = body.receiveShadow = true
    group.add(body)

    // Freezer seam and chrome handles
    const seam = new THREE.Mesh(new THREE.BoxGeometry(W * 0.96, 0.008, 0.01), new THREE.MeshStandardMaterial({ color: '#7e958a' }))
    seam.position.set(0, 1.4 + 0.3, D / 2 + 0.001)
    group.add(seam)
    const chrome = new THREE.MeshStandardMaterial({ color: '#e8e2d6', metalness: 1, roughness: 0.22 })
    for (const [y, len] of [[1.84, 0.16], [1.3, 0.34]]) {
      const handle = new THREE.Mesh(new RoundedBoxGeometry(0.035, len, 0.04, 3, 0.012), chrome)
      handle.position.set(-W / 2 + 0.08, y, D / 2 + 0.035)
      handle.castShadow = true
      group.add(handle)
    }
    const feet = new THREE.Mesh(new THREE.BoxGeometry(W * 0.9, 0.06, D * 0.9), new THREE.MeshStandardMaterial({ color: '#3a3430', roughness: 0.8 }))
    feet.position.y = 0.03
    group.add(feet)

    // Photos held by round magnets
    const magnetGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.012, 20)
    PHOTOS.forEach((p, i) => {
      const photo = new THREE.Mesh(
        new THREE.PlaneGeometry(0.17, 0.2),
        new THREE.MeshStandardMaterial({ map: paintPhoto(p.kind, 50 + i), roughness: 0.75 }),
      )
      photo.position.set(p.x, p.y, D / 2 + 0.003 + i * 0.0004)
      photo.rotation.z = p.rot
      photo.castShadow = true
      photo.receiveShadow = true
      const magnet = new THREE.Mesh(magnetGeo, new THREE.MeshStandardMaterial({ color: p.magnet, roughness: 0.3 }))
      magnet.rotation.x = Math.PI / 2
      magnet.position.set(0, 0.085, 0.006)
      magnet.castShadow = true
      photo.add(magnet)
      group.add(photo)
    })

    own(ctx, group)
  },
}

if (import.meta.hot) import.meta.hot.accept((m) => m && replace(m.default))
