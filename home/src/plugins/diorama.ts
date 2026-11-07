import * as THREE from 'three/webgpu'
import type { Context } from 'cordis'
import { own, replace } from '../kernel'
import { DOORWAY, TABLE_TOP, WALL_Z } from '../layout'
import { paintGlow, paintLawn, paintPlaster, paintWood } from '../paint'
import { CUT, floor, shell } from '../diorama'

/**
 * The kitchen as a dollhouse for ?cam=iso (#42): a base, a floor that stops at
 * the walls, the two open walls with their cut stubs, a wall arm the lamp
 * hangs from, and the garden under the window. Only the iso plan loads it.
 */
export default {
  name: 'diorama',
  inject: ['stage'],
  apply(ctx: Context) {
    const group = new THREE.Group()
    group.name = 'diorama'
    const T = 0.18
    // The side wall in room.ts is centred on x = -3.4, so its inner face is at -3.31.
    const x0 = -3.4 + T / 2, x1 = 3.4, z0 = WALL_Z, z1 = WALL_Z + 6, height = 3
    const plaster = new THREE.MeshStandardMaterial({ map: paintPlaster(5, [244, 239, 230], 1536, 768, 0.45), roughness: 0.95 })
    group.add(shell({
      x0, x1, z0, z1, height, thickness: T,
      wall: plaster,
      existing: ['back', 'left'],
      casts: true,
      openings: { back: [[DOORWAY.x0, DOORWAY.x1, DOORWAY.top]] },
    }))

    const planks = paintWood({ seed: 11, planks: 8, light: [222, 186, 140], dark: [176, 136, 96], knots: 2 })
    planks.wrapS = planks.wrapT = THREE.RepeatWrapping
    planks.rotation = Math.PI / 2
    planks.repeat.set(2.2, 3.4)
    group.add(floor(x0, x1, z0, z1, planks))

    // There is no ceiling in the cutaway, so the pendant hangs from a slim iron arm
    // fixed to the back wall, braced like a shelf bracket; the cord meets its tip
    // (lamp at x 0.42, z 0.35, cord top at y 2.98).
    const iron = new THREE.MeshStandardMaterial({ color: '#2b2420', roughness: 0.45, metalness: 0.3 })
    const tip = new THREE.Vector3(0.42, 2.98, 0.35)
    const rod = (a: THREE.Vector3, b: THREE.Vector3, r: number) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, a.distanceTo(b), 8), iron)
      m.position.copy(a).add(b).multiplyScalar(0.5)
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize())
      m.castShadow = true
      group.add(m)
    }
    rod(new THREE.Vector3(0.42, 2.98, z0), tip, 0.014)
    rod(new THREE.Vector3(0.42, 2.35, z0), new THREE.Vector3(0.42, 2.98, z0 + 1.1), 0.01)
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.78, 0.02), iron)
    plate.position.set(0.42, 2.64, z0 + 0.01)
    group.add(plate)
    const knuckle = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 8), iron)
    knuckle.position.copy(tip)
    group.add(knuckle)
    // From above the bulb hides inside the shade, so a soft pool of its light on the table says the lamp is on.
    const pool = new THREE.Mesh(new THREE.CircleGeometry(0.95, 48), new THREE.MeshBasicMaterial({ map: paintGlow(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }))
    pool.rotation.x = -Math.PI / 2
    pool.position.set(0.42, TABLE_TOP + 0.004, 0.35)
    pool.name = 'lamp pool'
    group.add(pool)

    // A garden plot on the base behind the kitchen: the window looks down onto it, and
    // from the ends of the orbit it reads as the house's own garden. The doorway's short
    // passage gets an outside (walls and a roof) so it doesn't show as open planes.
    const plot = { x0: x0 - T, x1: x1 + T, z0: z0 - T - 2.6, z1: z0 - T }
    const lawn = new THREE.Mesh(new THREE.PlaneGeometry(plot.x1 - plot.x0, plot.z1 - plot.z0), new THREE.MeshStandardMaterial({ map: paintLawn(3), roughness: 0.95 }))
    lawn.rotation.x = -Math.PI / 2
    lawn.position.set((plot.x0 + plot.x1) / 2, 0, (plot.z0 + plot.z1) / 2)
    lawn.receiveShadow = true
    lawn.name = 'diorama garden'
    group.add(lawn)
    const cut = new THREE.MeshStandardMaterial({ color: CUT, roughness: 0.8 })
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(plot.x1 - plot.x0 + 0.08, 0.3, plot.z1 - plot.z0), cut)
    plinth.position.set(lawn.position.x, -0.152, lawn.position.z - 0.04)
    plinth.receiveShadow = true
    group.add(plinth)
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m)
      b.position.set(x, y, z)
      b.castShadow = b.receiveShadow = true
      group.add(b)
    }
    const hall = { x0: DOORWAY.x0 - 0.25, x1: DOORWAY.x1 + 0.55, z: z0 - 1.3, h: 2.45 }
    box(0.1, hall.h, z0 - hall.z, hall.x0 + 0.05, hall.h / 2, (z0 + hall.z) / 2, plaster)
    box(0.1, hall.h, z0 - hall.z, hall.x1 - 0.05, hall.h / 2, (z0 + hall.z) / 2, plaster)
    box(hall.x1 - hall.x0, hall.h, 0.1, (hall.x0 + hall.x1) / 2, hall.h / 2, hall.z + 0.05, plaster)
    box(hall.x1 - hall.x0 + 0.04, 0.05, z0 - hall.z + 0.02, (hall.x0 + hall.x1) / 2, hall.h + 0.025, (z0 + hall.z) / 2, cut)

    // A small tree in the garden whose crown shows over the back wall.
    const bark = new THREE.MeshStandardMaterial({ color: '#5a4030', roughness: 0.9 })
    const leaves = [
      new THREE.MeshStandardMaterial({ color: '#6c8c3c', roughness: 0.9 }),
      new THREE.MeshStandardMaterial({ color: '#86a347', roughness: 0.9 }),
    ]
    const tree = new THREE.Group()
    tree.name = 'garden tree'
    tree.position.set(-0.5, 0, z0 - T - 1.8)
    tree.scale.setScalar(0.78)
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.11, 2.6, 8), bark)
    trunk.position.y = 1.3
    trunk.castShadow = true
    tree.add(trunk)
    for (const [x, y, z, r, k] of [[0, 3.0, 0, 0.85, 0], [0.55, 2.6, 0.2, 0.6, 1], [-0.5, 2.7, -0.1, 0.62, 1], [0.1, 3.5, -0.2, 0.55, 1], [-0.2, 2.45, 0.45, 0.5, 0]] as const) {
      const blob = new THREE.Mesh(lumpy(r, x * 7 + y), leaves[k])
      blob.position.set(x, y, z)
      blob.castShadow = blob.receiveShadow = true
      tree.add(blob)
    }
    group.add(tree)

    own(ctx, group)
  },
}

/** A leafy clump: a sphere pushed in and out by low noise, so the crown has lobes, not facets. */
function lumpy(r: number, seed: number): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(r, 28, 18)
  const p = geo.attributes.position as THREE.BufferAttribute
  const v = new THREE.Vector3()
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i)
    const k = 1 + 0.09 * Math.sin(v.x * 9 + seed) * Math.sin(v.y * 8 - seed) + 0.05 * Math.sin(v.z * 15 + seed * 2)
    p.setXYZ(i, v.x * k, v.y * k * 0.9, v.z * k)
  }
  geo.computeVertexNormals()
  return geo
}

if (import.meta.hot) import.meta.hot.accept((m) => m && replace(m.default))
