import * as THREE from 'three/webgpu'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { Context } from 'cordis'
import { own, replace } from '../kernel'
import { paintWood } from '../paint'

/** Slatted pine chairs with tufted linen seat cushions around the table. */
export function makeChair(pine: THREE.Material, cushion: THREE.Material) {
  const chair = new THREE.Group()
  const seatY = 0.45, w = 0.42, d = 0.42
  // The pine parts share one material, so they are baked into one mesh: a draw and a shadow draw per chair, not twelve of each.
  const pieces: THREE.BufferGeometry[] = []
  const part = (geo: THREE.BufferGeometry, x: number, y: number, z: number, mat?: THREE.Material) => {
    if (!mat) return void pieces.push(geo.translate(x, y, z))
    const m = new THREE.Mesh(geo, mat)
    m.position.set(x, y, z)
    m.castShadow = m.receiveShadow = true
    chair.add(m)
    return m
  }
  part(new THREE.BoxGeometry(w, 0.03, d), 0, seatY, 0)
  for (const [x, z] of [[-1, 1], [1, 1]]) part(new THREE.BoxGeometry(0.035, seatY, 0.035), x * (w / 2 - 0.02), seatY / 2, z * (d / 2 - 0.02))
  // Back legs run up into the backrest.
  for (const x of [-1, 1]) part(new THREE.BoxGeometry(0.035, 0.95, 0.035), x * (w / 2 - 0.02), 0.475, -d / 2 + 0.02)
  part(new THREE.BoxGeometry(w, 0.07, 0.025), 0, 0.9, -d / 2 + 0.02)
  part(new THREE.BoxGeometry(w, 0.03, 0.02), 0, 0.58, -d / 2 + 0.02)
  for (let i = 0; i < 4; i++) part(new THREE.BoxGeometry(0.03, 0.29, 0.016), -0.12 + i * 0.08, 0.735, -d / 2 + 0.02)
  part(new THREE.BoxGeometry(w - 0.04, 0.03, 0.02), 0, 0.12, d / 2 - 0.02)
  const pad = part(new RoundedBoxGeometry(w - 0.04, 0.05, d - 0.04, 3, 0.02), 0, seatY + 0.04, 0.01, cushion)!
  pad.castShadow = true
  const frame = new THREE.Mesh(mergeGeometries(pieces), pine)
  for (const g of pieces) g.dispose()
  frame.castShadow = frame.receiveShadow = true
  chair.add(frame)
  return chair
}

export function pineMaterial() {
  return new THREE.MeshStandardMaterial({
    map: paintWood({ seed: 13, planks: 1, light: [232, 190, 132], dark: [196, 150, 98], knots: 1, w: 256, h: 256 }),
    roughness: 0.5,
  })
}

export default {
  name: 'chairs',
  inject: ['stage'],
  apply(ctx: Context) {
    const group = new THREE.Group()
    group.name = 'chairs'
    const pine = pineMaterial()
    const cushion = new THREE.MeshStandardMaterial({ color: '#e3dccf', roughness: 0.95 })
    // Two on the far side facing us, one at the right end turned to the table.
    const seats: [number, number, number][] = [[-0.7, -0.5, 0], [0.2, -0.5, 0.05], [1.05, -0.05, -Math.PI / 2 + 0.35]]
    for (const [x, z, ry] of seats) {
      const chair = makeChair(pine, cushion)
      chair.position.set(x, 0, z)
      chair.rotation.y = ry
      group.add(chair)
    }
    own(ctx, group)
  },
}

if (import.meta.hot) import.meta.hot.accept((m) => m && replace(m.default))
