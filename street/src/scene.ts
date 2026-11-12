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
  /** A pane that gives light: a lantern's, a street lamp's. Drawn glowing. */
  lamp: { density: 2500, friction: 0.2, restitution: 0.3, hardness: 0.9, look: { color: '#fff1c2', roughness: 0.3, metalness: 0 } },
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
  block([0.55, 0.04, 0.04], [-side * 0.5, 5.55, 0], IRON), block([0.24, 0.06, 0.13], [-side * 0.95, 5.47, 0], IRON), { ...block([0.19, 0.02, 0.09], [-side * 0.95, 5.4, 0], '#fff1c2'), material: 'lamp' },
])
/**
 * A street tree's shapes: a trunk to where it forks, and a crown of balls of leaves round the fork (one at its heart, five on
 * its boughs, one on top). `n` is which tree: each is a little its own. What the page draws of a tree is laid over these very
 * shapes (client/look/trees.ts), so its shade and what bumps into it are the world's too.
 */
export function treePieces(n: number): Piece[] {
  const some = (k: number) => { const x = Math.sin((n + 1) * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x) }
  const r3 = (v: number) => Math.round(v * 1000) / 1000
  const fork = 2.3 + some(1) * 0.3, lx = (some(2) - 0.5) * 0.3, lz = (some(3) - 0.5) * 0.3
  // The trunk goes on up into the crown, so the two are one thing: cut the trunk and the crown comes down with it.
  const pieces = [can(0.13, r3(fork / 2), [0, r3(fork / 2), 0], '#7b5b3d'), can(0.1, 0.5, [r3(lx * 0.5), r3(fork + 0.4), r3(lz * 0.5)], '#7b5b3d'), ball(1.15, [r3(lx), r3(fork + 1.4), r3(lz)], LEAVES[n % 4])]
  for (let i = 0; i < 5; i++) {
    const round = ((i + some(10 + i) * 0.6) / 5) * Math.PI * 2, out = 0.85 + some(20 + i) * 0.35, up = 0.9 + some(30 + i) * 0.8
    pieces.push(ball(r3(0.8 + some(40 + i) * 0.25), [r3(lx + Math.cos(round) * out), r3(fork + up), r3(lz + Math.sin(round) * out)], LEAVES[(n + i + 1) % 4]))
  }
  pieces.push(ball(0.9, [r3(lx), r3(fork + 2.3), r3(lz)], LEAVES[(n + 2) % 4]))
  return pieces
}
/** A palm's shapes: a tall trunk and one ball where its fronds spread. */
export function palmPieces(n: number): Piece[] {
  const tall = 6.4 + ((n * 37) % 5) * 0.25
  return [can(0.17, tall / 2, [0, tall / 2, 0], '#8a7a66'), ball(1.5, [0, tall + 0.5, 0], LEAVES[n % 4])]
}
/** A street tree on the kerb side of a pavement: one with a round crown, or (its id says) a palm. */
const tree = (id: string, side: number, along: number, n: number) => stood(id, side * (ROAD + 0.7), along, 'maple', id.startsWith('palm') ? palmPieces(n) : treePieces(n))
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
    tree('tree-1', 1, -19, 0), tree('palm-1', -1, -13, 1), tree('tree-3', 1, -1, 2), tree('tree-4', -1, 1.5, 3), tree('palm-2', 1, 13, 1), tree('tree-6', -1, 21, 0),
    stood('hydrant', -(ROAD + 0.5), -17.5, 'steel', [can(0.1, 0.28, [0, 0.28, 0], '#f3efe4'), ball(0.11, [0, 0.58, 0], '#d7a21a'), can(0.05, 0.16, [0, 0.36, 0], '#d7a21a', [Math.PI / 2, 0, 0]), can(0.13, 0.03, [0, 0.03, 0], '#d7a21a')]),
    stood('letter-box', HALF_W - 0.75, 19.5, 'steel', [block([0.22, 0.3, 0.24], [0, 0.85, 0], '#2f528f'), can(0.24, 0.22, [0, 1.15, 0], '#2f528f', [0, 0, Math.PI / 2]), ...[-1, 1].flatMap((x) => [-1, 1].map((z) => block([0.025, 0.28, 0.025], [x * 0.17, 0.28, z * 0.19], '#2f528f')))]),
    ...[-1, 1].flatMap((end) => [-5, -2.5, 0, 2.5, 5].map((across, i) => barrier(`barrier${end}-${i}`, across, end * (HALF_L + 0.05)))),
    // A stop sign's post at each end, on the right of whoever is leaving the block that way (the page hangs the sign on it), two boxes of newspapers and a cabinet of the telephone company's.
    stood('stop-1', -(ROAD + 0.55), HALF_L - 1.4, 'steel', [can(0.03, 1.55, [0, 1.55, 0], '#9a9fa4')]),
    stood('stop-2', ROAD + 0.55, -(HALF_L - 1.4), 'steel', [can(0.03, 1.55, [0, 1.55, 0], '#9a9fa4')]),
    ...([['newsbox-1', 26.3, '#c8452e'], ['newsbox-2', 27.0, '#2f6aa3']] as const).map(([id, along, paint]) => stood(id, -(ROAD + 0.62), along, 'steel', [block([0.2, 0.36, 0.19], [0, 0.72, 0], paint), block([0.21, 0.05, 0.2], [0, 1.13, 0], '#22262a'), block([0.04, 0.18, 0.04], [0, 0.18, 0], '#22262a'), block([0.16, 0.14, 0.01], [0, 0.82, 0.19], '#dfe6ea')])),
    stood('cabinet', HALF_W - 0.5, -26.6, 'steel', [block([0.28, 0.62, 0.5], [0, 0.66, 0], '#5b7461'), block([0.3, 0.03, 0.52], [0, 1.31, 0], '#4a6050'), block([0.3, 0.02, 0.52], [0, 0.03, 0], '#8f8a80')]),
  ],
}

/** A kind of car: how long and wide it is, how high its body comes (its belt), where its cabin starts and ends along it from its nose, how far the glass leans in at the front and the back, and how tall the cabin is over the belt. A pickup has an open bed behind its cabin. */
export interface CarKind { long: number; wide: number; belt: number; cabin: [number, number]; rake: [number, number]; roof: number; bed?: boolean }
export const CAR_KINDS = {
  sedan: { long: 4.5, wide: 1.78, belt: 0.86, cabin: [1.25, 3.75], rake: [0.62, 0.55], roof: 0.52 },
  hatch: { long: 3.95, wide: 1.72, belt: 0.88, cabin: [1.05, 3.85], rake: [0.55, 0.28], roof: 0.56 },
  wagon: { long: 4.6, wide: 1.84, belt: 0.98, cabin: [1.2, 4.5], rake: [0.5, 0.22], roof: 0.66 },
  van: { long: 4.7, wide: 1.9, belt: 1.05, cabin: [0.55, 4.62], rake: [0.4, 0.08], roof: 0.86 },
  pickup: { long: 5.0, wide: 1.86, belt: 0.98, cabin: [1.35, 3.0], rake: [0.45, 0.1], roof: 0.62, bed: true },
} satisfies Record<string, CarKind>
/** A car parked at a kerb: where its middle is across and along the street, which way its nose points (1 down the hill), its kind and its paint. */
export interface Parked { id: string; across: number; along: number; nose: 1 | -1; kind: keyof typeof CAR_KINDS; paint: string }
const KERBSIDE = ROAD - 1.04
/** The block's parked cars: each on its own side of the road, facing the way the traffic on that side goes. None near the top, where residents arrive, by the hydrant, by Otis, or by Ines, where shade has to stand. */
export const PARKED: Parked[] = [
  { id: 'car-1', across: -KERBSIDE, along: -11.9, nose: 1, kind: 'sedan', paint: '#2f4a6b' },
  { id: 'car-2', across: -KERBSIDE, along: -6.2, nose: 1, kind: 'hatch', paint: '#c9cdd1' },
  { id: 'car-3', across: -KERBSIDE, along: 17.2, nose: 1, kind: 'pickup', paint: '#a8392c' },
  { id: 'car-4', across: KERBSIDE, along: -3.2, nose: -1, kind: 'wagon', paint: '#3c5a48' },
  { id: 'car-5', across: KERBSIDE, along: 12.6, nose: -1, kind: 'van', paint: '#ece7da' },
]
/** The parked cars as the world holds them: a box for each body and one for its cabin. Still: a thing to stand on, walk round and build against. What the page draws is laid over these (client/look/cars.ts). */
export const CARS: ToySpec = {
  id: 'cars', label: 'Parked cars', frame, gadgets: [], wires: [], inputs: {},
  parts: PARKED.map((p) => {
    const k: CarKind = CAR_KINDS[p.kind], middle = (k.cabin[0] + k.cabin[1]) / 2, r3 = (v: number) => Math.round(v * 1000) / 1000
    const pieces = [
      block([k.wide / 2, r3((k.belt - 0.2) / 2), k.long / 2], [0, r3((k.belt + 0.2) / 2), 0], p.paint),
      block([k.wide / 2 - 0.16, k.roof / 2, r3((k.cabin[1] - k.cabin[0]) / 2 - 0.2)], [0, r3(k.belt + k.roof / 2), r3(p.nose * (k.long / 2 - middle))], p.paint),
    ]
    return { id: p.id, shape: piecesShape(pieces), pieces, material: 'steel', at: [p.across, 0, p.along] as Vec3 }
  }),
}

/**
 * A parked car as a street of cells holds it: a body on four wheels, a cabin of dark glass under a painted roof on four
 * posts, bumpers, lamps in front and behind. Each piece says what it is made of, so glass breaks as glass.
 */
export function carPieces(p: Parked): Piece[] {
  const k: CarKind = CAR_KINDS[p.kind], r3 = (v: number) => Math.round(v * 1000) / 1000, n = p.nose
  const middle = n * (k.long / 2 - (k.cabin[0] + k.cabin[1]) / 2), cabin = (k.cabin[1] - k.cabin[0]) / 2 - 0.1, wide = k.wide / 2
  const of = (piece: Piece, material: string): Piece => ({ ...piece, material })
  const pieces: Piece[] = [
    block([wide, r3((k.belt - 0.3) / 2), k.long / 2], [0, r3((k.belt + 0.3) / 2), 0], p.paint),
    of(block([wide - 0.15, k.roof / 2, r3(cabin)], [0, r3(k.belt + k.roof / 2), r3(middle)], '#27343f'), 'glass'),
    block([wide - 0.1, 0.05, r3(cabin + 0.05)], [0, r3(k.belt + k.roof + 0.05), r3(middle)], p.paint),
    ...[-1, 1].flatMap((x) => [-1, 1].map((z) => block([0.05, k.roof / 2, 0.05], [x * (wide - 0.15), r3(k.belt + k.roof / 2), r3(middle + z * cabin)], p.paint))),
    ...[-1, 1].flatMap((x) => [-1, 1].flatMap((z) => [
      of(can(0.33, 0.11, [x * (wide - 0.08), 0.33, r3(z * (k.long / 2 - 0.85))], '#1c1e20', [0, 0, Math.PI / 2]), 'rubber'),
      can(0.15, 0.12, [x * (wide - 0.06), 0.33, r3(z * (k.long / 2 - 0.85))], '#b9bcc0', [0, 0, Math.PI / 2]),
    ])),
    ...[-1, 1].map((z) => block([wide - 0.05, 0.09, 0.06], [0, 0.45, r3(z * (k.long / 2 + 0.03))], '#2c2f33')),
    ...[-1, 1].map((x) => of(block([0.14, 0.07, 0.04], [x * (wide - 0.25), r3(k.belt - 0.14), r3(n * (k.long / 2 + 0.01))], '#fff1c2'), 'lamp')),
    ...[-1, 1].map((x) => block([0.14, 0.07, 0.04], [x * (wide - 0.25), r3(k.belt - 0.14), r3(-n * (k.long / 2 + 0.01))], '#c0392b')),
  ]
  // A pickup's bed: low sides behind the cabin instead of a boot.
  if ('bed' in k && k.bed) pieces.push(...[-1, 1].map((x) => block([0.06, 0.16, r3((k.long - k.cabin[1]) / 2 - 0.05)], [x * (wide - 0.06), r3(k.belt + 0.16), r3(-n * (k.cabin[1] / 2))], p.paint)))
  return pieces
}
/** The parked cars for a street of cells: the same cars in the same places, each made of the pieces above. */
export const CARS_IN_CELLS: ToySpec = {
  id: 'cars', label: 'Parked cars', frame, gadgets: [], wires: [], inputs: {},
  parts: PARKED.map((p) => { const pieces = carPieces(p); return { id: p.id, shape: piecesShape(pieces), pieces, material: 'steel', at: [p.across, 0, p.along] as Vec3 } }),
}

/** Where the still things on the pavements and at the kerbs stand, as rounds on the ground: across, along (world z), how wide, and from what height up (a tree's crown starts over a head; a car is three rounds in a row). A made thing is stood clear of them. */
export const STANDING: { x: number; z: number; r: number; from: number }[] = FURNITURE.parts.flatMap((p) => {
  const round = (r: number, from = 0) => ({ x: p.at[0], z: p.at[2], r, from })
  return p.id.startsWith('tree') ? [round(0.25), round(2.1, 2.2)] : p.id.startsWith('palm') ? [round(0.3), round(1.6, 5.5)] : p.id.startsWith('lamp') || p.id === 'hydrant' ? [round(0.2)] : p.id.startsWith('stop') ? [round(0.15)] : p.id === 'letter-box' || p.id.startsWith('newsbox') ? [round(0.4)] : p.id === 'cabinet' ? [round(0.65)] : []
}).concat(PARKED.flatMap((p) => [-1.45, 0, 1.45].map((along) => { const at = onStreet(p.across, p.along + along); return { x: at[0], z: at[2], r: 1.2, from: 0 } })))

/** A wheelie bin as households put out: a tall box with a lid, two wheels and a handle. Loose: it can be knocked over and sent down the hill. */
const wheelie = (id: string, side: number, along: number, paint: string): PartSpec => {
  const pieces = [
    block([0.26, 0.46, 0.29], [0, 0.46, 0], paint), block([0.28, 0.035, 0.32], [0, 0.955, 0.01], paint), block([0.22, 0.02, 0.025], [0, 0.93, -0.33], '#1c1e20'),
    can(0.1, 0.035, [-0.235, 0.11, -0.24], '#1c1e20', [0, 0, Math.PI / 2]), can(0.1, 0.035, [0.235, 0.11, -0.24], '#1c1e20', [0, 0, Math.PI / 2]),
  ]
  return { id, shape: piecesShape(pieces), pieces, material: 'plastic', motion: 'dynamic', mass: 16, at: [side * (ROAD + 0.62), 0.005, along] }
}
/** Two steel bins on the pavements and the households' wheelie bins at the kerb (rubbish, recycling, compost), all loose: anything can knock one over and send it down the hill. */
export const BINS: ToySpec = {
  id: 'bins', label: 'Bins', frame, gadgets: [], wires: [], inputs: {},
  parts: [
    ...[[1, -11.5], [-1, 17]].map(([side, along], i): PartSpec => ({ id: `bin-${i + 1}`, shape: { kind: 'cylinder', radius: 0.27, halfHeight: 0.42 }, material: 'steel', paint: '#3f6b58', motion: 'dynamic', mass: 9, at: [side * (HALF_W - 0.85), 0.43, along] })),
    ...([[-1, -22.2], [1, -15.4], [-1, 22.4]] as const).flatMap(([side, along], group) => (['#2b2d30', '#2a5d9a', '#3d7a46'] as const).map((paint, i) => wheelie(`wheelie-${group * 3 + i + 1}`, side, along + i * 0.68, paint))),
  ],
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
