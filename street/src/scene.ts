// The block as the engine's own data (#118): the street, its crates and balls are toys
// (home/src/engine/toy.ts), a resident is a toy with one upright part and a `walker` gadget
// whose knobs are that seat's input. Nothing here is special to the street's world process:
// World builds and runs it like any toy.
import type { WorldApi } from '../../home/src/engine/api.ts'
import type { Vec3 } from '../../home/src/engine/core.ts'
import { registerGadget } from '../../home/src/engine/gadgets.ts'
import { registerMaterial } from '../../home/src/engine/materials.ts'
import type { PartSpec, ToySpec } from '../../home/src/engine/toy.ts'
import { GRADE, HALF_L, HALF_W, KERB, heightAt, onStreet } from './ground.ts'
import { HALF_H, HOP, MASS, RADIUS, REACH, standing, steer, NORMAL_UP } from './walk.ts'

const TILT = Math.atan(GRADE)
const CRATE = 0.3, BALL = 0.25, WALL_WIDE = 8, WALL_HIGH = 3

/** Registers what the block needs beyond the home's kit. Call once before building. */
export function registerBlock() {
  const bad = [
    // Slides on everything: a walker's speed is its own, and what it stands on holds it up, not back.
    registerMaterial('resident', { density: 600, friction: 0, restitution: 0, hardness: 0.05, look: { color: '#c97a5a', roughness: 0.95, metalness: 0 } }),
    registerMaterial('asphalt', { density: 2300, friction: 0.9, restitution: 0.05, hardness: 0.8, look: { color: '#8f8a80', roughness: 0.95, metalness: 0 } }),
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
        if (normal && jump) g.state.hop = HOP
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
const slab = (id: string, half: Vec3, at: Vec3, paint?: string): PartSpec => ({ id, shape: { kind: 'box', half }, material: 'asphalt', at, ...(paint ? { paint } : {}) })

/** The road, its kerbs and end walls: parts in the street's own flat frame, tilted as one. A part is at most 20 m from its middle (toy.ts), so the long ones are laid in two lengths. */
export const STREET: ToySpec = {
  id: 'street', label: 'The street', frame, gadgets: [], wires: [], inputs: {},
  parts: [
    ...[-1, 1].flatMap((end) => [
      slab(`road${end}`, [HALF_W, 0.5, HALF_L / 2], [0, -0.5, (end * HALF_L) / 2]),
      slab(`kerb-west${end}`, [KERB, 0.6, HALF_L / 2], [-HALF_W, 0.6, (end * HALF_L) / 2], '#d9d2c3'),
      slab(`kerb-east${end}`, [KERB, 0.6, HALF_L / 2], [HALF_W, 0.6, (end * HALF_L) / 2], '#d9d2c3'),
      slab(`end${end}`, [HALF_W, 1.5, KERB], [0, 1.5, end * HALF_L], '#d9d2c3'),
    ]),
  ],
}

/** Walls of maple crates across the street, and rubber balls waiting at its top. */
export function cargo(crates: number, balls: number): ToySpec {
  const parts: PartSpec[] = []
  const walls = Math.max(1, Math.ceil(crates / (WALL_WIDE * WALL_HIGH)))
  for (let i = 0; i < crates; i++) {
    const wall = Math.floor(i / (WALL_WIDE * WALL_HIGH)), n = i % (WALL_WIDE * WALL_HIGH), level = Math.floor(n / WALL_WIDE), col = n % WALL_WIDE
    parts.push({ id: `crate-${i}`, shape: { kind: 'box', half: [CRATE, CRATE, CRATE] }, material: 'maple', motion: 'dynamic', mass: 43, at: [(col - (WALL_WIDE - 1) / 2) * (CRATE * 2 + 0.01) + (level % 2) * CRATE * 0.5, CRATE + level * (CRATE * 2 + 0.005), -22 + (wall * 46) / walls] })
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
