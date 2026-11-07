import * as THREE from 'three/webgpu'
import type { Context } from 'cordis'
import { own, replace } from '../kernel'
import { LIVING_X } from '../layout'
import { rng } from '../paint'
import { Foliage, paintCeramic, pot } from '../greenery'
import { LOUNGE } from './lounge'

/**
 * A tiered wooden plant stand in the corner: white trays on pale wood legs,
 * holding a ruby rubber plant, a bright schefflera and a snake plant.
 */
export default {
  name: 'plantstand',
  inject: ['stage'],
  apply(ctx: Context) {
    const group = new THREE.Group()
    group.name = 'plant stand'
    group.position.set(LIVING_X + 1.12, 0, LOUNGE.back + 0.42)
    const pale = new THREE.MeshStandardMaterial({ color: '#d8b98e', roughness: 0.6 })
    const white = new THREE.MeshStandardMaterial({ color: '#f4f2ee', roughness: 0.4 })
    const ceramic = ctx.stage.features().has('phys')
      ? new THREE.MeshPhysicalMaterial({ map: paintCeramic(9), roughness: 0.45, clearcoat: 0.8, clearcoatRoughness: 0.1 })
      : new THREE.MeshStandardMaterial({ map: paintCeramic(9), roughness: 0.35 })
    const blush = new THREE.MeshStandardMaterial({ color: '#d79b86', roughness: 0.55 })

    // Three trays climbing towards the corner, each on its own pair of legs.
    const trays: [number, number, number][] = [[0.12, 0.3, 0.22], [-0.18, 0.62, 0.05], [0.05, 0.95, -0.12]]
    for (const [x, y, z] of trays) {
      const tray = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.03, 28), white)
      tray.position.set(x, y, z)
      tray.castShadow = tray.receiveShadow = true
      group.add(tray)
      for (const dx of [-0.11, 0.11]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, y, 8), pale)
        leg.position.set(x + dx, y / 2, z)
        leg.castShadow = true
        group.add(leg)
      }
    }
    const r = rng(3)
    const rubber = new Foliage('oval', 0.35)
    const bright = new Foliage('oval')
    const blades = new Foliage('blade')

    // Rubber plant: tall pot on the top tray, a few stems of large glossy leaves,
    // deep green with ruby and cream edges.
    const top = new THREE.Vector3(...trays[2]).add(new THREE.Vector3(0, 0.015, 0))
    const tall = pot(0.11, 0.24, ceramic)
    tall.position.copy(top)
    group.add(tall)
    const stemMat = new THREE.MeshStandardMaterial({ color: '#6b3a32', roughness: 0.6 })
    const RUBBER = ['#3d4a2e', '#5b3d38', '#8a3f45', '#46553a', '#b2646a']
    for (let s = 0; s < 4; s++) {
      const height = 0.4 + s * 0.1
      const lean = new THREE.Vector3((s - 1.5) * 0.08, 1, (r() - 0.5) * 0.08).normalize()
      const base = top.clone().add(new THREE.Vector3((s - 1.5) * 0.025, 0.22, 0))
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.011, height, 6), stemMat)
      stem.position.copy(base).addScaledVector(lean, height / 2)
      stem.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), lean)
      group.add(stem)
      for (let i = 0; i < 8; i++) {
        const u = 0.2 + (i / 8) * 0.85
        const a = i * 2.4 + s
        const at = base.clone().addScaledVector(lean, height * Math.min(u, 1))
        const dir = new THREE.Vector3(Math.cos(a), 0.55 + u * 0.4, Math.sin(a) * 0.7 + 0.35)
        rubber.add(at, dir, 0.16 + r() * 0.06 - u * 0.03, RUBBER[(i + s) % RUBBER.length], a)
      }
    }

    // Schefflera in a blush fluted pot on the middle tray: umbrellas of small bright leaves.
    const mid = new THREE.Vector3(...trays[1]).add(new THREE.Vector3(0, 0.015, 0))
    const blushPot = pot(0.1, 0.2, blush)
    blushPot.position.copy(mid)
    group.add(blushPot)
    for (let u = 0; u < 8; u++) {
      const hub = mid.clone().add(new THREE.Vector3((r() - 0.5) * 0.18, 0.32 + r() * 0.3, (r() - 0.5) * 0.14))
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2 + u
        bright.add(hub, new THREE.Vector3(Math.cos(a), 0.25, Math.sin(a)), 0.075 + r() * 0.02, ['#9cc04e', '#b5d062', '#c7d977', '#86ad45'][i % 4], 0.3)
      }
    }

    // Snake plant on the low tray: upright variegated blades.
    const low = new THREE.Vector3(...trays[0]).add(new THREE.Vector3(0, 0.015, 0))
    const small = pot(0.08, 0.14, ceramic)
    small.position.copy(low)
    group.add(small)
    for (let i = 0; i < 9; i++) {
      const a = r() * Math.PI * 2
      const base = low.clone().add(new THREE.Vector3(Math.cos(a) * 0.03, 0.12, Math.sin(a) * 0.03))
      blades.add(base, new THREE.Vector3(Math.cos(a) * 0.18, 1, Math.sin(a) * 0.18), 0.28 + r() * 0.18, ['#4d6b35', '#5f7d3c', '#c9c46a'][i % 3], a)
    }
    group.add(rubber.build('rubber plant leaves'), bright.build('schefflera leaves'), blades.build('snake plant blades'))
    own(ctx, group)
  },
}

if (import.meta.hot) import.meta.hot.accept((m) => m && replace(m.default))
