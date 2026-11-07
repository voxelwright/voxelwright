import * as THREE from 'three/webgpu'
import type { Context } from 'cordis'
import { own, replace } from '../kernel'
import { DOORWAY, TABLE_TOP, WALL_Z } from '../layout'
import { floorPlanks, paintGlow, paintLawn, paintPlaster } from '../paint'
import { CUT, YARD_TOP, floor, shell, trees, yard } from '../diorama'

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
    plaster.userData.themeRole = 'wall'
    group.add(shell({
      x0, x1, z0, z1, height, thickness: T,
      wall: plaster,
      existing: ['back', 'left'],
      casts: true,
      openings: { back: [[DOORWAY.x0, DOORWAY.x1, DOORWAY.top]] },
    }))

    const planks = floorPlanks()
    // About 14 cm boards across the 6 m depth, the grain at the same scale along them.
    planks.repeat.set(5.4, 4.2)
    group.add(floor(x0, x1, z0, z1, planks))

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
    pool.material.userData.themeRole = 'beam'
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

    // A small tree in the garden whose crown shows over the back wall, a younger one at
    // the corner, and an orchard row behind, so the back of the yard reads as garden.
    group.add(trees([
      [-0.5, z0 - T - 1.8, 0.78, 0],
      [4.4, -3.9, 0.55, 1.2],
      [-4.6, -6.6, 0.62, 0.4], [-2.2, -7.4, 0.7, 2.2], [1.6, -7.0, 0.66, 4.1], [4.4, -6.9, 0.58, 5.3],
    ], YARD_TOP))

    // The yard the house stands in: stones from the garden round the left side to the front gate.
    group.add(yard({
      x0: -6.2, x1: 6.2, z0: -8.6, z1: 6.6, seed: 21,
      path: [[-3.9, -3.7], [-4.35, -1.2], [-4.4, 2.4], [-3.7, 4.9], [-2.8, 6.38]],
    }))

    own(ctx, group)
  },
}

if (import.meta.hot) import.meta.hot.accept((m) => m && replace(m.default))
