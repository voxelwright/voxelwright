// Shared room measurements in metres. Plugins that must line up read them here.
export const WALL_Z = -2.2
export const WINDOW = { x0: -1.55, x1: -0.15, y0: 1.0, y1: 2.15 }
export const TABLE_TOP = 0.76
// The doorway to the living room, at the left end of the back wall.
export const DOORWAY = { x0: -3.0, x1: -2.3, top: 2.08 }
// The living room sits far from the kitchen in world space so nothing of one shows in the other.
export const LIVING_X = 20
