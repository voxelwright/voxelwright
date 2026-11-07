import * as THREE from 'three/webgpu'
import type { Context } from 'cordis'
import { own, replace } from '../kernel'
import { WALL_Z } from '../layout'
import { rng } from '../paint'

/** A little house-shaped wall shelf with rows of peg-doll figures and a pink speaker box. */
export default {
  name: 'toyshelf',
  inject: ['stage'],
  apply(ctx: Context) {
    const group = new THREE.Group()
    group.name = 'toyshelf'
    group.position.set(-1.95, 0.62, WALL_Z + 0.01)
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
    // Peg-doll figures: a flared dress, a face and a cap of hair, drawn as three
    // instanced meshes so forty little people cost three draw calls.
    const r = rng(8)
    const dresses = ['#e53935', '#fbc02d', '#1e88e5', '#43a047', '#ab47bc', '#ff7043', '#26a69a', '#f48fb1']
    const hairs = ['#3e2a1e', '#6d4c31', '#c9a24a', '#1f1a17', '#a0522d']
    const figures: { x: number; y: number; h: number; dress: string; hair: string }[] = []
    for (let row = 0; row < 4; row++) {
      const y = 0.04 + row * 0.13
      const shelf = new THREE.Mesh(new THREE.BoxGeometry(W - 0.02, 0.014, 0.07), pine)
      shelf.position.set(0, y, 0.035)
      shelf.castShadow = shelf.receiveShadow = true
      group.add(shelf)
      let x = -W / 2 + 0.05
      while (x < W / 2 - 0.04) {
        if (row === 0 && x < -0.05 && x > -0.2) {
          const box = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.06), new THREE.MeshStandardMaterial({ color: '#e05a9a', roughness: 0.6 }))
          box.position.set(x + 0.04, y + 0.052, 0.04)
          box.castShadow = true
          group.add(box)
          x += 0.11
          continue
        }
        figures.push({ x, y: y + 0.007, h: 0.045 + r() * 0.03, dress: dresses[Math.floor(r() * dresses.length)], hair: hairs[Math.floor(r() * hairs.length)] })
        x += 0.046 + r() * 0.012
      }
    }
    const n = figures.length
    const dress = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.008, 0.016, 1, 12), new THREE.MeshStandardMaterial({ roughness: 0.45 }), n)
    const face = new THREE.InstancedMesh(new THREE.SphereGeometry(0.0125, 14, 10), new THREE.MeshStandardMaterial({ color: '#f3cfae', roughness: 0.55 }), n)
    const hair = new THREE.InstancedMesh(new THREE.SphereGeometry(0.0135, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), new THREE.MeshStandardMaterial({ roughness: 0.7 }), n)
    const m = new THREE.Matrix4()
    const c = new THREE.Color()
    figures.forEach((f, i) => {
      const body = f.h - 0.022
      m.makeScale(1, body, 1).setPosition(f.x, f.y + body / 2, 0.04)
      dress.setMatrixAt(i, m)
      dress.setColorAt(i, c.set(f.dress))
      const headY = f.y + body + 0.011
      m.makeTranslation(f.x, headY, 0.04)
      face.setMatrixAt(i, m)
      m.makeTranslation(f.x, headY + 0.002, 0.038)
      hair.setMatrixAt(i, m)
      hair.setColorAt(i, c.set(f.hair))
    })
    for (const mesh of [dress, face, hair]) {
      mesh.castShadow = true
      group.add(mesh)
    }
    own(ctx, group)
  },
}

if (import.meta.hot) import.meta.hot.accept((m) => m && replace(m.default))
