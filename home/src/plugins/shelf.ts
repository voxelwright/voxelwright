import * as THREE from 'three/webgpu'
import type { Context } from 'cordis'
import { own, replace } from '../kernel'
import { WALL_Z } from '../layout'
import { paintWood, rng } from '../paint'

/** A wall shelf with jars, a stack of books and a trailing pothos. */
export default {
  name: 'shelf',
  inject: ['stage'],
  apply(ctx: Context) {
    const group = new THREE.Group()
    group.name = 'shelf'
    const y = 1.98, x0 = -2.5, x1 = -1.65, depth = 0.22
    group.position.set((x0 + x1) / 2, y, WALL_Z + depth / 2)
    const wood = new THREE.MeshStandardMaterial({ map: paintWood({ seed: 17, planks: 1, light: [196, 142, 92], dark: [128, 84, 52], knots: 1, w: 512, h: 128 }), roughness: 0.55 })
    const board = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.03, depth), wood)
    board.castShadow = board.receiveShadow = true
    group.add(board)
    for (const bx of [-0.36, 0.36]) {
      const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.14, 0.16), wood)
      bracket.position.set(bx, -0.085, -0.02)
      group.add(bracket)
    }

    // Jars of pasta, lentils and honey.
    const jars: [number, string, number][] = [[-0.4, '#e9c46a', 0.16], [-0.3, '#a0522d', 0.13], [-0.21, '#d98e2f', 0.11]]
    for (const [x, fill, h] of jars) {
      const content = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, h * 0.75, 16), new THREE.MeshStandardMaterial({ color: fill, roughness: 0.6 }))
      content.position.set(x, 0.015 + h * 0.375, 0)
      const glass = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.04, h, 16),
        new THREE.MeshPhysicalMaterial({ color: '#fff8ec', roughness: 0.08, transparent: true, opacity: 0.28, clearcoat: 1 }),
      )
      glass.position.set(x, 0.015 + h / 2, 0)
      const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.018, 16), new THREE.MeshStandardMaterial({ color: '#b04a32', roughness: 0.5 }))
      lid.position.set(x, 0.015 + h + 0.009, 0)
      content.castShadow = true
      group.add(content, glass, lid)
    }

    // Books standing, leaning on each other.
    const r = rng(5)
    const spines = ['#7a3b2e', '#2f5446', '#c49a3c', '#5b6c8f', '#8a5a7a']
    let bx = 0.0
    spines.forEach((color, i) => {
      const h = 0.17 + r() * 0.06, t = 0.025 + r() * 0.015
      const book = new THREE.Mesh(new THREE.BoxGeometry(t, h, 0.15), new THREE.MeshStandardMaterial({ color, roughness: 0.8 }))
      const lean = i === spines.length - 1 ? -0.3 : 0
      book.rotation.z = lean
      book.position.set(bx + t / 2 + (lean ? 0.03 : 0), 0.015 + h / 2 - (lean ? 0.01 : 0), 0)
      book.castShadow = true
      group.add(book)
      bx += t + 0.002
    })

    // Pothos in a little pot, vines trailing over the edge.
    const potX = 0.36
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.045, 0.1, 18), new THREE.MeshStandardMaterial({ color: '#e7dccb', roughness: 0.5 }))
    pot.position.set(potX, 0.065, 0.01)
    pot.castShadow = true
    group.add(pot)
    const leafGeo = new THREE.CircleGeometry(0.022, 8)
    leafGeo.scale(1, 1.3, 1)
    const leafMat = new THREE.MeshStandardMaterial({ color: '#5d8a3c', roughness: 0.55, side: THREE.DoubleSide })
    const leafLight = new THREE.MeshStandardMaterial({ color: '#86ad4f', roughness: 0.55, side: THREE.DoubleSide })
    const vines = ctx.stage.quality === 'low' ? 3 : 5
    for (let v = 0; v < vines; v++) {
      const sx = potX + (r() - 0.5) * 0.1, sz = 0.04 + r() * 0.05
      const len = 0.25 + r() * 0.35
      for (let k = 0; k < 12; k++) {
        const s = k / 11
        const leaf = new THREE.Mesh(leafGeo, r() < 0.5 ? leafMat : leafLight)
        const out = Math.min(s * 3, 1) * 0.06
        leaf.position.set(sx + Math.sin(s * 5 + v) * 0.03 + (v - 2) * 0.03, 0.1 - s * len - (s < 0.2 ? -0.03 : 0), sz + out + 0.04)
        leaf.rotation.set(-0.3 + r() * 0.6, r() * 2 - 1, r() * Math.PI)
        leaf.castShadow = true
        group.add(leaf)
      }
    }
    for (let k = 0; k < 10; k++) {
      const leaf = new THREE.Mesh(leafGeo, k % 2 ? leafMat : leafLight)
      const a = (k / 10) * Math.PI * 2
      leaf.position.set(potX + Math.cos(a) * 0.05, 0.13 + r() * 0.05, 0.01 + Math.sin(a) * 0.04)
      leaf.rotation.set(-1 + r(), a, r())
      group.add(leaf)
    }
    own(ctx, group)
  },
}

if (import.meta.hot) import.meta.hot.accept((m) => m && replace(m.default))
