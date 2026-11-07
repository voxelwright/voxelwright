import * as THREE from 'three/webgpu'
import type { Context } from 'cordis'
import { own, replace } from '../kernel'
import { FRONT_Z, HOUSE, HOUSE_H, KITCHEN, LIVING_X, TABLE_TOP, WALL_T, WALL_Z } from '../layout'
import { floorPlanks, paintGlow, paintLawn, paintPlaster } from '../paint'
import { CUT, YARD_TOP, floor, shell, trees, yard } from '../diorama'

/**
 * The house as a dollhouse for ?cam=iso (#42): one base under both rooms, the
 * kitchen's floor, the front wall, cut stubs and caps for every wall, a wall arm
 * the kitchen lamp hangs from, the garden behind the house and the yard around it.
 * Only the iso plan loads it.
 */
export default {
  name: 'diorama',
  inject: ['stage'],
  apply(ctx: Context) {
    const group = new THREE.Group()
    group.name = 'diorama'
    const T = WALL_T
    const x0 = KITCHEN.x0, x1 = LIVING_X + 1.6, z0 = WALL_Z, z1 = FRONT_Z, height = HOUSE_H
    const plaster = new THREE.MeshStandardMaterial({ map: paintPlaster(5, [244, 239, 230], 1536, 768, 0.45), roughness: 0.95 })
    group.add(shell({
      x0, x1, z0, z1, height, thickness: T,
      wall: plaster,
      // The kitchen's and the living room's own walls stand at full height; the shell adds the front.
      existing: ['back', 'left', 'right'],
      casts: true,
    }))

    const planks = floorPlanks()
    // About 14 cm boards across the 6 m depth, the grain at the same scale along them.
    planks.repeat.set(5.4, 4.2)
    group.add(floor(KITCHEN.x0, KITCHEN.x1, z0, z1, planks))

    // There is no ceiling in the cutaway, so the pendant hangs from a slim iron arm
    // fixed to the back wall, braced like a shelf bracket; the cord meets its tip
    // (lamp at x 0.42, z 0.35, cord top at y 2.98).
    // Painted the wall's cream, not black iron: from above a dark arm was the strongest line in the room (#42 room).
    const iron = new THREE.MeshStandardMaterial({ color: '#efe6d6', roughness: 0.55 })
    const tip = new THREE.Vector3(0.42, 2.98, 0.35)
    const rod = (a: THREE.Vector3, b: THREE.Vector3, r: number) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, a.distanceTo(b), 8), iron)
      m.position.copy(a).add(b).multiplyScalar(0.5)
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize())
      m.castShadow = true
      group.add(m)
    }
    rod(new THREE.Vector3(0.42, 2.98, z0), tip, 0.008)
    rod(new THREE.Vector3(0.42, 2.35, z0), new THREE.Vector3(0.42, 2.98, z0 + 1.1), 0.008)
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.78, 0.02), iron)
    plate.position.set(0.42, 2.64, z0 + 0.01)
    group.add(plate)
    const knuckle = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 8), iron)
    knuckle.position.copy(tip)
    group.add(knuckle)
    // From above the bulb hides inside the shade, so a soft pool of its light on the table says the lamp is on.
    const pool = new THREE.Mesh(new THREE.CircleGeometry(0.95, 48), new THREE.MeshBasicMaterial({ map: paintGlow(), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }))
    pool.rotation.x = -Math.PI / 2
    pool.position.set(0.42, TABLE_TOP + 0.004, 0.35)
    pool.name = 'lamp pool'
    group.add(pool)

    // A garden plot behind the house: the kitchen window looks down onto it, and from
    // the ends of the orbit it reads as the house's own garden.
    const plot = { x0: HOUSE.x0, x1: HOUSE.x1, z0: HOUSE.z0 - 2.6, z1: HOUSE.z0 }
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

    // Small trees in the garden whose crowns show over the back wall, a younger one at
    // the corner, and an orchard row behind, so the back of the yard reads as garden.
    group.add(trees([
      [-0.5, z0 - T - 1.8, 0.78, 0], [5.6, -3.7, 0.7, 0.5],
      [10.3, -1.2, 0.55, 2.8],
      [-4.6, -6.6, 0.62, 0.4], [-2.2, -7.4, 0.7, 2.2], [1.6, -7.0, 0.66, 4.1], [4.4, -6.9, 0.58, 5.3], [7.6, -7.3, 0.64, 1.7],
    ], YARD_TOP))

    // The yard the house stands in: stones from the garden round the left side to the front gate.
    group.add(yard({
      x0: HOUSE.x0 - 2.7, x1: HOUSE.x1 + 2.7, z0: -8.6, z1: 6.6, seed: 21,
      path: [[-3.9, -3.7], [-4.35, -1.2], [-4.4, 2.4], [-3.7, 4.9], [-2.8, 6.38]],
    }))

    own(ctx, group)
  },
}

if (import.meta.hot) import.meta.hot.accept((m) => m && replace(m.default))
