// The block as the engine's own data (#118): the street, its crates and balls are toys
// (home/src/engine/toy.ts), a resident is a toy with one upright part and a `walker` gadget
// whose knobs are that seat's input. Nothing here is special to the street's world process:
// World builds and runs it like any toy.
import type { WorldApi } from '../../home/src/engine/api.ts'
import type { Vec3 } from '../../home/src/engine/core.ts'
import { registerGadget } from '../../home/src/engine/gadgets.ts'
import { registerMaterial, type Material } from '../../home/src/engine/materials.ts'
import { piecesShape, type PartSpec, type Piece, type ToySpec } from '../../home/src/engine/toy.ts'
import { GRADE, HALF_L, HALF_W, KERB, ROAD, TRENCH, heightAt, onStreet } from './ground.ts'
import { HALF_H, HOP, MASS, RADIUS, REACH, standing, steer, NORMAL_UP } from './walk.ts'

const TILT = Math.atan(GRADE)
/** The tallest thing a walker steps onto without jumping. */
const STEP = 0.45
const CRATE = 0.3, BALL = 0.25, WALL_WIDE = 8, WALL_HIGH = 3

/** What things on the street may be made of beyond the home's materials. Data: the world process and every page register the same. */
export const STREET_MATERIALS: Record<string, Material> = {
  asphalt: { density: 2300, friction: 0.9, restitution: 0.05, hardness: 0.8, look: { color: '#8f8a80', roughness: 1, metalness: 0 } },
  stone: { density: 2600, friction: 0.8, restitution: 0.1, hardness: 0.95, look: { color: '#9a958c', roughness: 0.9, metalness: 0 } },
  foam: { density: 40, friction: 0.8, restitution: 0.35, hardness: 0.02, look: { color: '#f2c94c', roughness: 0.9, metalness: 0 }, heat: { flammability: 0.7, ignition: 300, burnRate: 0.08, heatCapacity: 0.3, absorbs: 0.6 } },
  plastic: { density: 950, friction: 0.4, restitution: 0.5, hardness: 0.5, look: { color: '#e8553d', roughness: 0.35, metalness: 0 }, heat: { flammability: 0.4, ignition: 400, burnRate: 0.03, heatCapacity: 1, absorbs: 0 } },
  fur: { density: 250, friction: 0.85, restitution: 0.08, hardness: 0.03, look: { color: '#a8744a', roughness: 1, metalness: 0 }, heat: { flammability: 0.8, ignition: 250, burnRate: 0.1, heatCapacity: 0.5, absorbs: 0.9 } },
  ice: { density: 917, friction: 0.03, restitution: 0.05, hardness: 0.7, look: { color: '#cfe9f5', roughness: 0.15, metalness: 0 } },
  jelly: { density: 1000, friction: 0.6, restitution: 0.92, hardness: 0.02, look: { color: '#e05a8a', roughness: 0.25, metalness: 0 } },
}

/** Registers what the block needs beyond the home's kit. Call once before building. */
export function registerBlock() {
  const bad = [
    ...Object.entries(STREET_MATERIALS).map(([name, m]) => registerMaterial(name, m)),
    // Slides on everything: a walker's speed is its own, and what it stands on holds it up, not back.
    registerMaterial('resident', { density: 600, friction: 0, restitution: 0, hardness: 0.05, look: { color: '#c97a5a', roughness: 0.95, metalness: 0 } }),
    registerGadget({
      kind: 'walker',
      about: 'Walks its upright part where its knobs point: x and z are the way to go in the world, jump over a half is a jump.',
      knobs: { x: { min: -1, max: 1, step: 0.01, default: 0, about: 'east, of the way to go' }, z: { min: -1, max: 1, step: 0.01, default: 0, about: 'south, of the way to go' }, jump: { min: 0, max: 1, step: 1, default: 0, about: 'jump now' } },
      inputs: [], outputs: [],
      needs: { part: 'moving' },
      setup(g) { g.state.hop = 0; g.state.grounded = 1 },
      step(g, w: WorldApi, h) {
        const thing = g.part ? w.thing(g.part) : null
        if (!thing) return
        g.state.hop = Math.max(0, g.state.hop - 1)
        let normal: Vec3 | null = null, gap = 0
        if (g.state.hop === 0) {
          const far = HALF_H + RADIUS * 2 + REACH
          const hit = w.castRay(thing.position, [0, -far, 0], [thing.key])
          if (hit && hit.normal[1] > 0.6) {
            gap = hit.fraction * far - standing(hit.normal)
            if (gap <= REACH) normal = hit.normal
          }
        }
        const jump = g.knobs.jump > 0.5
        const v = steer(thing.velocity, { seq: 0, x: g.knobs.x, z: g.knobs.z, jump }, normal)
        // A low thing in the way is stepped onto (a kerb stone, a stair, a bridge's deck): look down from knee
        // height a little ahead, and where something stands higher than the ground would be there, rise to it.
        let rise = 0
        const speed = Math.hypot(v[0], v[2])
        if (normal && !jump && speed > 0.5) {
          const ahead = RADIUS + 0.12, dx = (v[0] / speed) * ahead, dz = (v[2] / speed) * ahead
          const feet = thing.position[1] - standing(normal) - gap, due = feet - (dx * normal[0] + dz * normal[2]) / normal[1]
          const top = due + STEP + 0.05
          const step = w.castRay([thing.position[0] + dx, top, thing.position[2] + dz], [0, -(STEP + 0.05), 0], [thing.key])
          if (step && step.fraction > 0.02 && step.normal[1] > 0.6) rise = Math.max(0, top - step.fraction * (STEP + 0.05) - due)
          if (rise < 0.05) rise = 0
        }
        if (normal && jump) g.state.hop = HOP
        else if (rise) v[1] = Math.max(v[1], Math.min(rise / h, 3.5))
        else if (normal && gap > 0.004) v[1] -= Math.min(gap / h, 3)
        g.state.grounded = normal ? 1 : 0
        // The walk rule carries its own gravity; the world's, which the solver is about to add, is taken off first.
        const gravity = w.rules.gravity
        w.setVelocity(thing.key, [v[0] - gravity[0] * h, v[1] - gravity[1] * h, v[2] - gravity[2] * h])
      },
    }),
  ].filter(Boolean)
  if (bad.length) throw new Error(`the block's kit was refused: ${bad.join('; ')}`)
}

const frame = { at: [0, 0, 0] as Vec3, yaw: 0, tilt: TILT }
const ASPHALT = '#6d6e72', PAVEMENT = '#c9c3b6', KERBSTONE = '#e4dfd3', DUG = '#8a7f6f'
const slab = (id: string, half: Vec3, at: Vec3, paint: string, hidden = false): PartSpec => ({ id, shape: { kind: 'box', half }, material: 'asphalt', at, paint, ...(hidden ? { hidden } : {}) })

/**
 * The street's ground above and below the trench (a roadway between two pavements, each edged with a line of
 * kerbstone), the trench's floor, and a wall across each end that is there but not drawn. Parts in the street's
 * own flat frame, tilted as one. Under a hand of road is three metres of earth, so the trench has walls of it;
 * its sides are the houses' own footings (houses.ts).
 */
export const STREET: ToySpec = {
  id: 'street', label: 'The street', frame, gadgets: [], wires: [], inputs: {},
  parts: [
    ...([['top', (HALF_L + TRENCH.from) / 2, (TRENCH.from - HALF_L) / 2], ['bottom', (HALF_L - TRENCH.to) / 2, (TRENCH.to + HALF_L) / 2]] as const).flatMap(([name, half, at]) => [
      slab(`road-${name}`, [ROAD, 0.12, half], [0, -0.12, at], ASPHALT),
      ...[-1, 1].flatMap((side) => [
        slab(`kerb-${name}${side}`, [0.09, 0.12, half], [side * (ROAD + 0.09), -0.12, at], KERBSTONE),
        slab(`pavement-${name}${side}`, [(HALF_W - ROAD - 0.18) / 2, 0.12, half], [side * (HALF_W + ROAD + 0.18) / 2, -0.12, at], PAVEMENT),
      ]),
      slab(`earth-${name}`, [HALF_W, 1.38, half], [0, -1.62, at], DUG),
    ]),
    slab('trench-floor', [HALF_W, 0.4, (TRENCH.to - TRENCH.from) / 2], [0, -TRENCH.depth - 0.4, (TRENCH.from + TRENCH.to) / 2], DUG),
    ...[-1, 1].map((end) => slab(`end${end}`, [HALF_W, 4, KERB], [0, 4, end * HALF_L], ASPHALT, true)),
  ],
}

/** A thing that stands on the street, upright whatever the hill does: `at` is across and along the street, its pieces rise from the ground there. */
const stood = (id: string, across: number, along: number, material: string, pieces: Piece[]): PartSpec => ({ id, shape: piecesShape(pieces), pieces, material, at: onStreet(across, along) })
const can = (radius: number, halfHeight: number, at: Vec3, paint: string, turn?: Vec3): Piece => ({ shape: { kind: 'cylinder', radius, halfHeight }, at, paint, ...(turn ? { turn } : {}) })
const block = (half: Vec3, at: Vec3, paint: string, turn?: Vec3): Piece => ({ shape: { kind: 'box', half }, at, paint, ...(turn ? { turn } : {}) })
const ball = (radius: number, at: Vec3, paint: string): Piece => ({ shape: { kind: 'sphere', radius }, at, paint })
const IRON = '#2c3438', LEAVES = ['#6fa35a', '#5c954f', '#80b36a', '#679d57']

/** A street lamp on the kerb, its arm out over the road (`side` is which pavement). */
const lamp = (id: string, side: number, along: number) => stood(id, side * (ROAD + 0.5), along, 'steel', [
  can(0.13, 0.3, [0, 0.3, 0], IRON), can(0.06, 2.5, [0, 3.1, 0], IRON),
  block([0.55, 0.04, 0.04], [-side * 0.5, 5.55, 0], IRON), block([0.24, 0.06, 0.13], [-side * 0.95, 5.47, 0], IRON), block([0.19, 0.02, 0.09], [-side * 0.95, 5.4, 0], '#fff1c2'),
])
/** A street tree: a trunk and a crown of four balls of leaves. */
const tree = (id: string, side: number, along: number, n: number) => stood(id, side * (ROAD + 0.7), along, 'maple', [
  can(0.1, 1.15, [0, 1.15, 0], '#7b5b3d'),
  ball(0.95, [0, 2.95, 0], LEAVES[n % 4]), ball(0.72, [0.5, 2.6, 0.35], LEAVES[(n + 1) % 4]), ball(0.74, [-0.45, 2.7, -0.3], LEAVES[(n + 2) % 4]), ball(0.6, [0.1, 3.6, 0.1], LEAVES[(n + 3) % 4]),
])
/** A striped barrier across the road, where the block ends. */
const barrier = (id: string, across: number, along: number) => stood(id, across, along, 'maple', [
  ...[-2, -1, 0, 1, 2].map((i) => block([0.22, 0.1, 0.03], [i * 0.44, 0.92, 0], i % 2 ? '#fbf6ea' : '#e8752c')),
  ...[-1, 1].flatMap((x) => [block([0.03, 0.55, 0.03], [x * 0.9, 0.5, 0.2], '#fbf6ea', [0.38, 0, 0]), block([0.03, 0.55, 0.03], [x * 0.9, 0.5, -0.2], '#fbf6ea', [-0.38, 0, 0])]),
])

/**
 * What stands on the pavements and at the ends: lamps, trees, a hydrant, a letter box, and barriers where the
 * block stops. Still parts, upright, each made of pieces. The barriers stand on the unseen end walls, past
 * where a walker's own rule stops it; the rest a walker meets as it meets a made thing.
 */
export const FURNITURE: ToySpec = {
  id: 'furniture', label: 'Lamps, trees and barriers', frame: { at: [0, 0, 0], yaw: 0, tilt: 0 }, gadgets: [], wires: [], inputs: {},
  parts: [
    lamp('lamp-1', -1, -24), lamp('lamp-2', 1, -9), lamp('lamp-3', -1, 14.5), lamp('lamp-4', 1, 26),
    tree('tree-1', 1, -19, 0), tree('tree-2', -1, -13, 1), tree('tree-3', 1, -1, 2), tree('tree-4', -1, 1.5, 3), tree('tree-5', 1, 13, 1), tree('tree-6', -1, 21, 0),
    stood('hydrant', -(ROAD + 0.5), -17.5, 'steel', [can(0.1, 0.28, [0, 0.28, 0], '#f3efe4'), ball(0.11, [0, 0.58, 0], '#d7a21a'), can(0.05, 0.16, [0, 0.36, 0], '#d7a21a', [Math.PI / 2, 0, 0]), can(0.13, 0.03, [0, 0.03, 0], '#d7a21a')]),
    stood('letter-box', HALF_W - 0.75, 19.5, 'steel', [block([0.22, 0.3, 0.24], [0, 0.85, 0], '#2f528f'), can(0.24, 0.22, [0, 1.15, 0], '#2f528f', [0, 0, Math.PI / 2]), ...[-1, 1].flatMap((x) => [-1, 1].map((z) => block([0.025, 0.28, 0.025], [x * 0.17, 0.28, z * 0.19], '#2f528f')))]),
    ...[-1, 1].flatMap((end) => [-5, -2.5, 0, 2.5, 5].map((across, i) => barrier(`barrier${end}-${i}`, across, end * (HALF_L + 0.05)))),
  ],
}

/** Two steel bins on the pavements that anything can knock over and send down the hill. */
export const BINS: ToySpec = {
  id: 'bins', label: 'Bins', frame, gadgets: [], wires: [], inputs: {},
  parts: [[1, -11.5], [-1, 17]].map(([side, along], i) => ({ id: `bin-${i + 1}`, shape: { kind: 'cylinder', radius: 0.27, halfHeight: 0.42 } as const, material: 'steel', paint: '#3f6b58', motion: 'dynamic' as const, mass: 9, at: [side * (HALF_W - 0.85), 0.43, along] as Vec3 })),
}

/** Walls of maple crates across the street above the trench, and rubber balls waiting at its top. */
export function cargo(crates: number, balls: number): ToySpec {
  const parts: PartSpec[] = []
  const walls = Math.max(1, Math.ceil(crates / (WALL_WIDE * WALL_HIGH)))
  for (let i = 0; i < crates; i++) {
    const wall = Math.floor(i / (WALL_WIDE * WALL_HIGH)), n = i % (WALL_WIDE * WALL_HIGH), level = Math.floor(n / WALL_WIDE), col = n % WALL_WIDE
    parts.push({ id: `crate-${i}`, shape: { kind: 'box', half: [CRATE, CRATE, CRATE] }, material: 'maple', motion: 'dynamic', mass: 43, at: [(col - (WALL_WIDE - 1) / 2) * (CRATE * 2 + 0.01) + (level % 2) * CRATE * 0.5, CRATE + level * (CRATE * 2 + 0.005), -22 + (wall * (20 + TRENCH.from)) / walls] })
  }
  for (let i = 0; i < balls; i++) parts.push({ id: `ball-${i}`, shape: { kind: 'sphere', radius: BALL }, material: 'rubber', motion: 'dynamic', mass: 5, at: [((i * 7919) % 1000) / 1000 * (HALF_W - 1) * 2 - (HALF_W - 1), 1 + (i % 20) * 0.7, -HALF_L + 2] })
  return { id: 'cargo', label: 'Crates and balls', frame, parts, gadgets: [], wires: [], inputs: {} }
}

/** A resident: one upright body, walked by its gadget. `n` is which seat (it picks where they arrive). */
export function resident(id: string, n: number): ToySpec {
  const at = onStreet((n % 2 ? 1 : -1) * (0.8 + Math.floor(n / 2) * 1.2), -26, 0)
  at[1] = heightAt(at[2]) + standing(NORMAL_UP)
  return {
    id, label: 'A resident', frame: { at, yaw: 0, tilt: 0 }, wires: [], inputs: {},
    parts: [{ id: 'body', shape: { kind: 'capsule', halfHeight: HALF_H, radius: RADIUS }, material: 'resident', motion: 'dynamic', mass: MASS, upright: true, at: [0, 0, 0] }],
    gadgets: [{ id: 'legs', kind: 'walker', part: 'body' }],
  }
}
