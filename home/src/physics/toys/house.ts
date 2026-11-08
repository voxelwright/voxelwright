// The house's own toys (#74): the ground under the house, and a few light things on the floor
// along the villagers' walks for them to nudge, plus one heavy crate. The house itself (floors,
// walls, furniture) is drawn by its plugins and gets its bodies from ../home.ts; the ground is
// here so the light things never fall before the floor's body is read.
import { FRONT_Z, KITCHEN, LIVING_X, WALL_Z } from '../../layout'
import type { ToySpec } from '../../engine/toy'

const RIGHT = LIVING_X + 1.6

export const HOUSE: ToySpec = {
  id: 'house',
  label: 'House',
  frame: { at: [0, 0, 0], yaw: 0, tilt: 0 },
  inputs: {},
  parts: [
    { id: 'ground', shape: { kind: 'box', half: [(RIGHT - KITCHEN.x0) / 2 + 1, 0.1, (FRONT_Z - WALL_Z) / 2 + 1] }, material: 'plaster', at: [(KITCHEN.x0 + RIGHT) / 2, -0.1, (WALL_Z + FRONT_Z) / 2], hidden: true },
    // Light things on the floor, in the open where people walk.
    { id: 'felt-ball', shape: { kind: 'sphere', radius: 0.07 }, material: 'felt', paint: '#c2714f', motion: 'dynamic', at: [-1.0, 0.07, 1.42] },
    { id: 'yarn-ball', shape: { kind: 'sphere', radius: 0.055 }, material: 'felt', paint: '#e6b85a', motion: 'dynamic', at: [0.45, 0.055, 1.4] },
    { id: 'block-sage', shape: { kind: 'box', half: [0.05, 0.05, 0.05] }, material: 'maple', paint: '#9fb58f', motion: 'dynamic', at: [1.5, 0.05, 1.05] },
    { id: 'block-rust', shape: { kind: 'box', half: [0.06, 0.04, 0.04] }, material: 'maple', paint: '#d9876a', motion: 'dynamic', at: [-0.32, 0.04, 1.47] },
    { id: 'block-cream', shape: { kind: 'box', half: [0.045, 0.045, 0.045] }, material: 'maple', paint: '#efe4cc', motion: 'dynamic', at: [-0.32, 0.125, 1.47], turn: [0, 0.5, 0] },
    { id: 'cork-ball', shape: { kind: 'sphere', radius: 0.05 }, material: 'cork', motion: 'dynamic', at: [LIVING_X - 1.5, 0.05, 2.1] },
    // Heavy: a walnut toy crate. It moves, slowly, when someone walks into it.
    { id: 'crate', shape: { kind: 'box', half: [0.16, 0.13, 0.12] }, material: 'walnut', motion: 'dynamic', at: [LIVING_X - 0.1, 0.13, 0.25], turn: [0, 0.3, 0] },
  ],
  gadgets: [],
  wires: [],
}
