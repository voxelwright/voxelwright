import * as THREE from 'three/webgpu'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import type { Context } from 'cordis'
import { own, replace } from '../kernel'
import { LIVING_X } from '../layout'
import { paintWood } from '../paint'
import { LOUNGE } from './lounge'

/** A fluted light-oak sideboard with a glowing table lamp and a serving board on top. */
export default {
  name: 'sideboard',
  inject: ['stage'],
  apply(ctx: Context) {
    const W = 1.5, H = 0.78, D = 0.45
    const group = new THREE.Group()
    group.name = 'sideboard'
    group.position.set(LIVING_X - 0.78, 0, LOUNGE.back + D / 2 + 0.02)

    const grain = paintWood({ seed: 23, w: 512, h: 512, planks: 2, light: [226, 208, 182], dark: [196, 176, 150], knots: 0 })
    const oak = new THREE.MeshStandardMaterial({ map: grain, roughness: 0.55 })
    const body = new THREE.Mesh(new RoundedBoxGeometry(W, H - 0.06, D, 4, 0.04), oak)
    body.position.y = (H - 0.06) / 2 + 0.04
    const topSlab = new THREE.Mesh(new RoundedBoxGeometry(W + 0.02, 0.04, D + 0.02, 4, 0.018), oak)
    topSlab.position.y = H
    for (const m of [body, topSlab]) {
      m.castShadow = m.receiveShadow = true
      group.add(m)
    }
    const front = D / 2
    // Two drawers across the top, separated by thin shadow lines.
    const gap = new THREE.MeshStandardMaterial({ color: '#8c7660', roughness: 0.9 })
    const line = (w: number, h: number, x: number, y: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.004), gap)
      m.position.set(x, y, front + 0.001)
      group.add(m)
    }
    line(W - 0.06, 0.006, 0, H - 0.2)
    line(0.006, 0.16, 0, H - 0.11)
    line(0.006, H - 0.3, 0, (H - 0.2) / 2 + 0.03)
    // Flutes: rounded vertical reeds on the doors, one instanced mesh.
    const reeds: THREE.Matrix4[] = []
    for (let x = -W / 2 + 0.05; x < W / 2 - 0.04; x += 0.034) if (Math.abs(x) > 0.02) reeds.push(new THREE.Matrix4().makeTranslation(x, (H - 0.2) / 2 + 0.035, front - 0.004))
    const flutes = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.015, 0.015, H - 0.3, 10, 1, true), oak, reeds.length)
    flutes.name = 'flutes'
    reeds.forEach((m, i) => flutes.setMatrixAt(i, m))
    flutes.castShadow = flutes.receiveShadow = true
    group.add(flutes)

    // On top: a pale serving board and a table lamp already on.
    const board = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.018, 0.2, 3, 0.008), new THREE.MeshStandardMaterial({ color: '#d7b98c', roughness: 0.5 }))
    board.position.set(0.15, H + 0.03, 0.04)
    board.rotation.y = 0.08
    board.castShadow = true
    group.add(board)
    const lamp = new THREE.Group()
    lamp.position.set(-0.55, H + 0.02, -0.05)
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.075, 0.07, 24), new THREE.MeshStandardMaterial({ color: '#d9dcd6', roughness: 0.25, metalness: 0.1 }))
    base.position.y = 0.035
    const shade = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, 0.3, 28, 1, true),
      new THREE.MeshStandardMaterial({ color: '#fbf3e3', emissive: '#ffd9a0', emissiveIntensity: 0.7, side: THREE.DoubleSide }),
    )
    shade.position.y = 0.22
    const glow = new THREE.PointLight('#ffc98a', 0.55, 2.2, 1.8)
    glow.position.y = 0.24
    lamp.add(base, shade, glow)
    group.add(lamp)
    own(ctx, group)
  },
}

if (import.meta.hot) import.meta.hot.accept((m) => m && replace(m.default))
