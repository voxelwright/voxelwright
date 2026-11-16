// The sample scene (#419), written out: node player/sample.mjs  (after npm run core)
//
// Everything in it is made up here: a few things stood in the middle of the street the engine's own page starts in,
// which the core makes from its rules. No data from anywhere else is in it. What stands there is for poking: a table
// of brick on four legs of glass with crates of wood on it, a pane of glass on a kerb of concrete, and a low wall
// of brick. A ball thrown hard at a glass leg breaks it, and what stood on it comes down.
import { readFileSync, writeFileSync } from 'node:fs'

const core = (await WebAssembly.instantiate(readFileSync(new URL('../page/core.wasm', import.meta.url)), {})).instance.exports
const GLASS = 11, WOOD = 10, CONCRETE = 7, BRICK = 8 | (30 << 8)
/** The middle of the road at the start, and the height of the cell that stands on it. */
const X = 700, Z = 4070, FLOOR = core.ground_at(X, Z) + 1

const cells = new Map()
/** A box of one kind: its low corner from the scene's own, and its size. Later boxes are written over earlier ones. */
const box = (x, y, z, w, h, d, kind) => { for (let j = 0; j < h; j++) for (let k = 0; k < d; k++) for (let i = 0; i < w; i++) cells.set(`${X + x + i},${FLOOR + y + j},${Z + z + k}`, kind) }

// The table: four legs of glass, a top of brick, three crates on it.
for (const [x, z] of [[-14, -9], [12, -9], [-14, 7], [12, 7]]) box(x, 0, z, 2, 12, 2, GLASS)
box(-16, 12, -11, 32, 3, 22, BRICK)
box(-10, 15, -6, 8, 8, 8, WOOD)
box(2, 15, -4, 8, 8, 8, WOOD)
box(-4, 23, -5, 8, 8, 8, WOOD)
// The pane: glass 3 m wide and 2.4 m high, on a kerb.
box(34, 0, -16, 4, 2, 34, CONCRETE)
box(35, 2, -15, 1, 24, 32, GLASS)
// The wall: brick, a metre high, with a gap in it.
box(-52, 0, -14, 4, 10, 12, BRICK)
box(-52, 0, 4, 4, 10, 12, BRICK)
box(-52, 10, -14, 4, 4, 30, BRICK)

// As rows the core reads: x0, x1 (not filled), y, z, kind, in order of y, then z, then x.
const sorted = [...cells].map(([at, kind]) => [...at.split(',').map(Number), kind]).sort((a, b) => a[1] - b[1] || a[2] - b[2] || a[0] - b[0])
const rows = [], low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity]
for (const [x, y, z, kind] of sorted) {
  const at = rows.length - 5
  if (at >= 0 && rows[at + 1] === x && rows[at + 2] === y && rows[at + 3] === z && rows[at + 4] === kind) rows[at + 1] = x + 1
  else rows.push(x, x + 1, y, z, kind)
  for (const [a, v] of [x, y, z].entries()) { low[a] = Math.min(low[a], v); high[a] = Math.max(high[a], v + 1) }
}
const scene = {
  village: 'scene', version: 1, name: 'A table on glass legs',
  centre: [X - 4, FLOOR + 12, Z],
  eye: { far: 230, yaw: 25, pitch: -20, nearest: 60, farthest: 420 },
  edits: [{ edit: [1, rows.length / 5, ...rows], box: [...low, ...high] }],
}
const to = new URL('scenes/sample.json', import.meta.url)
writeFileSync(to, JSON.stringify(scene) + '\n')
console.log(`${to.pathname}: ${cells.size} cells in ${rows.length / 5} rows, ${JSON.stringify(scene).length} bytes`)
