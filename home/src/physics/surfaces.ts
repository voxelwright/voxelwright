// Where a toy made from a sentence may stand (#88): clear patches the page offers the model by
// name, each with its own frame (origin at the middle of its top, x along its long side, z
// across, y up). The kitchen table's clear front-right corner (the notebook, the mug, the jug,
// the candle and the fruit bowl take the rest), and an open patch of floor in the room the
// person's villager is in.
import type * as THREE from 'three/webgpu'
import { KITCHEN, TABLE_TOP, WALL_T } from '../layout'
import type { Surface } from '../engine/made'

/** Long axis along the world's z, turned a quarter so the frame's back (-z) is toward the notebook and its front toward the room. */
const ALONG_Z = Math.PI / 2

export const TABLE: Surface = { id: 'table', label: 'the kitchen table', at: [0.45, TABLE_TOP, 0.37], yaw: ALONG_Z, half: [0.25, 0.17], height: 0.45 }
const FLOORS: { room: 'kitchen' | 'living room'; surface: Surface }[] = [
  { room: 'kitchen', surface: { id: 'floor', label: 'the kitchen floor', at: [2.1, 0, 0.45], yaw: 0, half: [0.6, 0.4], height: 0.6 } },
  { room: 'living room', surface: { id: 'floor', label: 'the living room floor', at: [4.95, 0, 2.25], yaw: 0, half: [0.6, 0.5], height: 0.6 } },
]

/** The room a point is in, by the shared wall between kitchen and living room. */
const roomAt = (x: number) => (x > KITCHEN.x1 + WALL_T / 2 ? 'living room' : 'kitchen')

/** The surfaces offered for `person`: the table, and the floor of the room their villager stands in (the kitchen when none is found). */
export function surfacesFor(scene: THREE.Object3D, person: string): Surface[] {
  let room: 'kitchen' | 'living room' = 'kitchen'
  scene.traverse((o) => {
    if (o.userData.villagerId === person) room = roomAt(o.getWorldPosition(o.position.clone()).x)
  })
  return [TABLE, FLOORS.find((f) => f.room === room)!.surface]
}

/** What the model is told of a surface: no world positions, only its name and room. */
export const offered = (s: Surface) => ({ id: s.id, label: s.label, half: s.half, height: s.height })
