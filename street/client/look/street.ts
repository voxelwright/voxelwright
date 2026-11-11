// The block's ground as the page draws it (#136): a roadway of asphalt between two kerbs, a
// pavement of concrete squares a kerb's height over it, and the trench cut through all of it
// to the earth. The world's ground is one plane (a walker's rule knows one height across the
// street), so what stands on the pavement is drawn that kerb's height higher than the world
// has it (`lift`).
import * as THREE from 'three/webgpu'
import { float, mix, positionLocal, smoothstep, vec2, vec3 } from 'three/tsl'
import { GRADE, HALF_L, HALF_W, ROAD, TRENCH, overTrench } from '../../src/ground.ts'
import { Mesher } from './mesher.ts'
import { asphalt, earth, kerbstone, made, onGround, paving } from './surfaces.ts'

/** Where the kerb is painted red: either side of the hydrant (src/scene.ts has it on the west pavement, 17.5 m up from the middle). */
const NO_STOPPING: [number, number, number][] = [[-1, -20.2, -14.8]]
/** How high the pavement stands over the road, and how wide its kerbstone is. */
export const CURB = 0.13, STONE = 0.16

/** How much higher than the world has it a thing at `x` across the street and `z` along it is drawn: a kerb's height on the pavements, nothing on the road or down in the trench. */
export function lift(x: number, z: number): number {
  if (overTrench(z)) return 0
  const t = Math.max(0, Math.min(1, (Math.abs(x) - (ROAD - 0.06)) / 0.16))
  return CURB * t * t * (3 - 2 * t)
}

/** The ground, standing in the scene as the street's own toy does: tilted with the hill. */
export function street(): THREE.Group {
  const road = new Mesher(), walk = new Mesher(), kerb = new Mesher(), dug = new Mesher()
  const wide = HALF_W + 0.2
  for (const [z0, z1] of [[-HALF_L, TRENCH.from], [TRENCH.to, HALF_L]]) {
    road.quad([-ROAD, 0, z1], [ROAD, 0, z1], [ROAD, 0, z0], [-ROAD, 0, z0])
    for (const side of [-1, 1]) {
      kerb.box([side * (ROAD + STONE / 2), CURB / 2 - 0.15, (z0 + z1) / 2], [STONE / 2, CURB / 2 + 0.15, (z1 - z0) / 2], undefined, '-y')
      const half = (wide - ROAD - STONE) / 2
      walk.box([side * (ROAD + STONE + half), CURB / 2 - 0.05, (z0 + z1) / 2], [half, CURB / 2 + 0.05, (z1 - z0) / 2], undefined, `-y ${side > 0 ? '-x' : '+x'}`)
    }
  }
  // The trench: a face of earth at each end of the cut, and its floor.
  const deep = -TRENCH.depth
  dug.quad([-wide, deep, TRENCH.from], [wide, deep, TRENCH.from], [wide, -0.001, TRENCH.from], [-wide, -0.001, TRENCH.from])
  dug.quad([wide, deep, TRENCH.to], [-wide, deep, TRENCH.to], [-wide, -0.001, TRENCH.to], [wide, -0.001, TRENCH.to])
  dug.quad([-wide, deep, TRENCH.to], [wide, deep, TRENCH.to], [wide, deep, TRENCH.from], [-wide, deep, TRENCH.from])

  // The cut shows what the road is laid on: a hand of asphalt, a bed of pale gravel, then the earth.
  const face = earth(vec2(positionLocal.x, positionLocal.y.add(positionLocal.z)))
  const down = positionLocal.y.negate(), bed = smoothstep(0.34, 0.3, down), top = smoothstep(0.13, 0.11, down)
  const cut = { ...face, color: mix(mix(face.color, vec3(0.42, 0.4, 0.36).mul(face.height.mul(18).add(0.7)), bed), vec3(0.05, 0.05, 0.055), top), roughness: float(0.95) }

  const group = new THREE.Group()
  group.name = 'the ground'
  group.rotation.x = Math.atan(GRADE)
  for (const [name, mesher, material] of [['road', road, made(asphalt(onGround, ROAD, HALF_L))], ['pavement', walk, made(paving(onGround, ROAD + STONE))], ['kerb', kerb, made(kerbstone(onGround, NO_STOPPING))], ['trench', dug, made(cut)]] as const) {
    const mesh = new THREE.Mesh(mesher.geometry(), material)
    mesh.name = name
    mesh.receiveShadow = true
    mesh.castShadow = name !== 'road'
    group.add(mesh)
  }
  return group
}
