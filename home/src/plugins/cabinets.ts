import * as THREE from 'three/webgpu'
import type { Context } from 'cordis'
import { own, replace } from '../kernel'
import { WALL_Z } from '../layout'
import { paintPlaster, paintWood } from '../paint'

/** White shaker cabinets with round knobs, a grey counter, a sink tap and an upper run. */
export default {
  name: 'cabinets',
  inject: ['stage'],
  apply(ctx: Context) {
    const group = new THREE.Group()
    group.name = 'cabinets'
    // Painted wood (#42 room): a faint grain under eggshell paint, and a carcass a shade
    // darker than the doors so the gaps between them read as shadow lines.
    const grain = paintWood({ seed: 31, w: 256, h: 256, planks: 1, light: [246, 242, 233], dark: [236, 230, 218], knots: 0 })
    const paint = new THREE.MeshStandardMaterial({ map: grain, roughness: 0.68 })
    const carcass = new THREE.MeshStandardMaterial({ color: '#d9d1c2', roughness: 0.75 })
    const inset = new THREE.MeshStandardMaterial({ color: '#ece6da', roughness: 0.72 })
    const knob = new THREE.MeshStandardMaterial({ color: '#b08a5a', metalness: 0.7, roughness: 0.4 })
    const stone = paintPlaster(29, [150, 150, 148], 512, 512)
    const counterMat = new THREE.MeshStandardMaterial({ map: stone, roughness: 0.7 })
    const x0 = 1.98, x1 = 3.4
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(geo, mat)
      m.position.set(x, y, z)
      m.castShadow = m.receiveShadow = true
      group.add(m)
      return m
    }
    // A shaker door: frame plus a recessed centre panel and a knob.
    const door = (cx: number, cy: number, w: number, h: number, z: number, knobX: number, knobY: number) => {
      add(new THREE.BoxGeometry(w - 0.01, h - 0.01, 0.02), paint, cx, cy, z)
      add(new THREE.BoxGeometry(w - 0.13, h - 0.13, 0.012), inset, cx, cy, z + 0.006)
      add(new THREE.SphereGeometry(0.014, 12, 8), knob, cx + knobX, cy + knobY, z + 0.025)
    }
    const baseD = 0.6, baseH = 0.88
    add(new THREE.BoxGeometry(x1 - x0, baseH, baseD), carcass, (x0 + x1) / 2, baseH / 2, WALL_Z + baseD / 2)
    const doorW = (x1 - x0) / 3
    for (let i = 0; i < 3; i++) {
      const cx = x0 + doorW * (i + 0.5)
      door(cx, 0.73, doorW, 0.18, WALL_Z + baseD + 0.01, 0, 0)
      door(cx, 0.33, doorW, 0.58, WALL_Z + baseD + 0.01, i % 2 ? -doorW / 2 + 0.06 : doorW / 2 - 0.06, 0.2)
    }
    add(new THREE.BoxGeometry(x1 - x0 + 0.03, 0.04, baseD + 0.03), counterMat, (x0 + x1) / 2, baseH + 0.02, WALL_Z + baseD / 2 + 0.01)

    // Upper run.
    const upD = 0.33, upY0 = 1.5, upY1 = 2.32
    add(new THREE.BoxGeometry(x1 - x0, upY1 - upY0, upD), carcass, (x0 + x1) / 2, (upY0 + upY1) / 2, WALL_Z + upD / 2)
    for (let i = 0; i < 3; i++) {
      const cx = x0 + doorW * (i + 0.5)
      door(cx, (upY0 + upY1) / 2, doorW, upY1 - upY0, WALL_Z + upD + 0.01, i % 2 ? -doorW / 2 + 0.06 : doorW / 2 - 0.06, -(upY1 - upY0) / 2 + 0.08)
    }

    // Brushed tap over the sink, and a soap bottle.
    const steel = new THREE.MeshStandardMaterial({ color: '#b9b6ae', metalness: 0.9, roughness: 0.3 })
    const tapX = 2.45, tapZ = WALL_Z + 0.12
    add(new THREE.CylinderGeometry(0.018, 0.022, 0.3, 12), steel, tapX, baseH + 0.19, tapZ)
    const arc = add(new THREE.TorusGeometry(0.08, 0.014, 8, 16, Math.PI), steel, tapX, baseH + 0.34, tapZ + 0.08)
    arc.rotation.y = Math.PI / 2
    add(new THREE.CylinderGeometry(0.03, 0.03, 0.16, 12), new THREE.MeshStandardMaterial({ color: '#8e8e8a', roughness: 0.4 }), tapX - 0.2, baseH + 0.1, tapZ + 0.02)
    own(ctx, group)
  },
}

if (import.meta.hot) import.meta.hot.accept((m) => m && replace(m.default))
