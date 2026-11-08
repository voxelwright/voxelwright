// Shared house measurements in metres. Plugins that must line up read them here.
//
// One house, rooms side by side along one back wall, all 6 m deep and 3 m tall:
//   kitchen (x -3.31 to 3.4) | living room (x 3.58 to 8.38) | room for the Workshop later
// The rooms share an 18 cm wall; the doorway between kitchen and living room is in it.
export const WALL_Z = -2.2
export const WALL_T = 0.18
export const HOUSE_H = 3.0
/** The front walls' inner face. */
export const FRONT_Z = WALL_Z + 6
export const WINDOW = { x0: -1.55, x1: -0.15, y0: 1.0, y1: 2.15 }
export const TABLE_TOP = 0.76
/** Inner faces of the kitchen's side walls. */
export const KITCHEN = { x0: -3.4 + WALL_T / 2, x1: 3.4 }
/** The living room's own origin: lounge.ts measures from here (its left wall's inner face is at -3.2). */
export const LIVING_X = KITCHEN.x1 + WALL_T + 3.2
/** The doorway between kitchen and living room, in the shared wall (x from KITCHEN.x1 to KITCHEN.x1 + WALL_T). */
export const DOORWAY = { z0: 2.45, z1: 3.15, top: 2.08 }
/** The Workshop's closed door in the living room's right wall: its centre z, width and height. */
export const WORKSHOP_DOOR = { z: WALL_Z + 1.75, w: 0.82, h: 2.05 }
/** The house's outer footprint, for the camera's bounds and the yard. */
export const HOUSE = { x0: KITCHEN.x0 - WALL_T, x1: LIVING_X + 1.6 + WALL_T, z0: WALL_Z - WALL_T, z1: FRONT_Z + WALL_T }
