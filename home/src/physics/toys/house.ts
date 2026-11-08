// The house as the physics world sees it (#74): hidden colliders where the floor, walls and
// heavy furniture already stand (drawn by their own plugins), and a few light things on the
// floor along the villagers' walks for them to nudge, plus one heavy crate.
import { FRONT_Z, KITCHEN, LIVING_X, TABLE_TOP, WALL_T, WALL_Z, DOORWAY, HOUSE_H } from '../../layout'
import type { PartSpec, ToySpec } from '../toy'

const block = (id: string, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): PartSpec =>
  ({ id, shape: { kind: 'box', half: [(x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2] }, material: 'plaster', at: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], hidden: true })
const RIGHT = LIVING_X + 1.6
const SHARED = KITCHEN.x1

export const HOUSE: ToySpec = {
  id: 'house',
  label: 'House',
  frame: { at: [0, 0, 0], yaw: 0, tilt: 0 },
  inputs: {},
  parts: [
    block('floor', KITCHEN.x0 - 1, RIGHT + 1, -0.2, 0, WALL_Z - 1, FRONT_Z + 1),
    block('wall-back', KITCHEN.x0 - 1, RIGHT + 1, 0, HOUSE_H, WALL_Z - 0.2, WALL_Z),
    block('wall-front', KITCHEN.x0 - 1, RIGHT + 1, 0, HOUSE_H, FRONT_Z, FRONT_Z + 0.2),
    block('wall-left', KITCHEN.x0 - 0.2, KITCHEN.x0, 0, HOUSE_H, WALL_Z, FRONT_Z),
    block('wall-right', RIGHT, RIGHT + 0.2, 0, HOUSE_H, WALL_Z, FRONT_Z),
    block('wall-shared-back', SHARED, SHARED + WALL_T, 0, HOUSE_H, WALL_Z, DOORWAY.z0),
    block('wall-shared-front', SHARED, SHARED + WALL_T, 0, HOUSE_H, DOORWAY.z1, FRONT_Z),
    // Heavy furniture: static, where its plugin draws it.
    block('kitchen-table', -0.25 - 0.9, -0.25 + 0.9, 0, TABLE_TOP, 0.15 - 0.5, 0.15 + 0.5),
    block('counters', 1.98, KITCHEN.x1, 0, 0.9, WALL_Z, WALL_Z + 0.62),
    block('fridge', 1.14, 1.86, 0, 1.78, WALL_Z, WALL_Z + 0.72),
    block('sofa', LIVING_X - 3.2, LIVING_X - 3.2 + 0.95, 0, 0.8, -0.2, 2.05),
    block('coffee-table', LIVING_X - 1.55 - 0.55, LIVING_X - 1.55 + 0.55, 0, 0.45, 0.95 - 0.42, 0.95 + 0.42),
    // Light things on the floor, in the open where people walk.
    { id: 'felt-ball', shape: { kind: 'sphere', radius: 0.07 }, material: 'felt', paint: '#c2714f', motion: 'dynamic', at: [-1.0, 0.07, 1.42] },
    { id: 'yarn-ball', shape: { kind: 'sphere', radius: 0.055 }, material: 'felt', paint: '#e6b85a', motion: 'dynamic', at: [0.45, 0.055, 1.4] },
    { id: 'block-sage', shape: { kind: 'box', half: [0.05, 0.05, 0.05] }, material: 'maple', paint: '#9fb58f', motion: 'dynamic', at: [1.5, 0.05, 1.05] },
    { id: 'block-rust', shape: { kind: 'box', half: [0.06, 0.04, 0.04] }, material: 'maple', paint: '#d9876a', motion: 'dynamic', at: [-0.32, 0.04, 1.47] },
    { id: 'block-cream', shape: { kind: 'box', half: [0.045, 0.045, 0.045] }, material: 'maple', paint: '#efe4cc', motion: 'dynamic', at: [-0.32, 0.125, 1.47], turn: [0, 0.5, 0] },
    { id: 'cork-ball', shape: { kind: 'sphere', radius: 0.05 }, material: 'cork', motion: 'dynamic', at: [LIVING_X - 1.5, 0.05, 2.1] },
    // Heavy: a walnut toy crate. It moves, slowly, when someone walks into it.
    { id: 'crate', shape: { kind: 'box', half: [0.16, 0.13, 0.12] }, material: 'walnut', motion: 'dynamic', at: [LIVING_X - 0.35, 0.13, 1.7], turn: [0, 0.3, 0] },
  ],
  gadgets: [],
  wires: [],
}
