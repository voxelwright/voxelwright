import * as THREE from 'three/webgpu'
import type { Context } from 'cordis'
import { own, replace } from '../kernel'
import { WALL_Z } from '../layout'
import { rng } from '../paint'

/** A little house-shaped wall shelf with rows of tiny figurines and a pink speaker box. */
export default {
  name: 'toyshelf',
  inject: ['stage'],
  apply(ctx: Context) {
    const group = new THREE.Group()
    group.name = 'toyshelf'
    group.position.set(-2.25, 0.62, WALL_Z + 0.01)
    const white = new THREE.MeshStandardMaterial({ color: '#f6f3ec', roughness: 0.6 })
    const pine = new THREE.MeshStandardMaterial({ color: '#d9b07a', roughness: 0.55 })
    // House outline: walls and a pitched roof made from thin strips.
    const W = 0.46, H = 0.5, roof = 0.2, t = 0.025
    const strip = (len: number, x: number, y: number, rot: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(len, t, 0.03), white)
      m.position.set(x, y, 0.015)
      m.rotation.z = rot
      m.castShadow = true
      group.add(m)
    }
    strip(H, -W / 2, H / 2, Math.PI / 2)
    strip(H, W / 2, H / 2, Math.PI / 2)
    const slope = Math.hypot(W / 2, roof)
    const angle = Math.atan2(roof, W / 2)
    strip(slope + 0.02, -W / 4, H + roof / 2, angle)
    strip(slope + 0.02, W / 4, H + roof / 2, -angle)
    const r = rng(8)
    const colors = ['#e53935', '#fbc02d', '#1e88e5', '#43a047', '#ab47bc', '#ff7043', '#8d6e63', '#f48fb1']
    for (let row = 0; row < 4; row++) {
      const y = 0.04 + row * 0.13
      const shelf = new THREE.Mesh(new THREE.BoxGeometry(W - 0.02, 0.014, 0.07), pine)
      shelf.position.set(0, y, 0.035)
      shelf.castShadow = shelf.receiveShadow = true
      group.add(shelf)
      let x = -W / 2 + 0.05
      while (x < W / 2 - 0.05) {
        const color = colors[Math.floor(r() * colors.length)]
        if (row === 0 && x < -0.05 && x > -0.2) {
          const box = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.06), new THREE.MeshStandardMaterial({ color: '#e05a9a', roughness: 0.6 }))
          box.position.set(x + 0.04, y + 0.052, 0.04)
          box.castShadow = true
          group.add(box)
          x += 0.11
          continue
        }
        const h = 0.05 + r() * 0.035
        const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.012, h - 0.03, 3, 8), new THREE.MeshStandardMaterial({ color, roughness: 0.5 }))
        body.position.set(x, y + 0.007 + h / 2, 0.04)
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.011, 10, 8), new THREE.MeshStandardMaterial({ color: '#f1c9a5', roughness: 0.6 }))
        head.position.set(x, y + 0.007 + h + 0.008, 0.04)
        body.castShadow = true
        group.add(body, head)
        x += 0.04 + r() * 0.02
      }
    }
    own(ctx, group)
  },
}

if (import.meta.hot) import.meta.hot.accept((m) => m && replace(m.default))
