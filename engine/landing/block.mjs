// The landing block (#421), written out: node landing/block.mjs  (after npm run core)
//
// The front door of the owner's site is a street corner in the engine's own town: the market row the engine's page
// starts beside (five shops in a row on a hill, city.rs `shop`), with the site's menu stood on its roofs as
// billboards. Everything added is made up here, of the world's own cells, so all of it breaks and falls as the town
// does. No data from anywhere else is in it.
//
// It writes two files: the scene (player/scene.ts) and the places in it that the landing world needs to know
// (landing.ts): where each sign's board is, where the face hangs, where the eye starts.
//
// What is glass here is what gives: a sign stands on glass feet, the crate table on glass legs. A ball thrown hard
// breaks them, and what stood on them comes down.
import { readFileSync, writeFileSync } from 'node:fs'

const core = (await WebAssembly.instantiate(readFileSync(new URL('../page/core.wasm', import.meta.url)), {})).instance.exports
const kind = (material, colour = 0) => material | (colour << 8)
const hue = (h, tone) => 16 + (h % 24) * 10 + tone
const CONCRETE = 7, WOOD = 10, GLASS = 11, STEEL = 12, LAMP = 15
/** The owner's two colours. They are not in the world's palette: the landing world writes them over these two places in it (landing.ts `BRAND`), the vivid blue and the vivid yellow, which stand nearest. */
export const BLUE = hue(16, 4), YELLOW = hue(4, 4)
const BOARD = kind(WOOD, BLUE), BULB = kind(LAMP, YELLOW), FRAME = kind(STEEL, 12), FOOT = kind(GLASS), RULE = kind(WOOD, YELLOW)

// The market row (city.rs): block (0, 4)'s houses that front the street at z = 4000, the first five of them shops.
const STREET_Z = 4000, LOT = 76, ROW_X = 140
/** The highest cell that holds anything over a place. */
const top = (x, z) => { let y = core.ground_at(x, z) + 220; while (y > 0 && core.world_kind(x, y, z) === 0) y--; return y }
/** A shop's roof: the top of its lot a little back from the front, and how far its front is set back from the street. */
const shop = (i) => {
  const x0 = ROW_X + i * LOT
  let set = 0
  while (set < 20 && top(x0 + LOT / 2, STREET_Z - 1 - set) < core.ground_at(x0 + LOT / 2, STREET_Z) + 40) set++
  return { x0, roof: top(x0 + LOT / 2, STREET_Z - 40 - set), front: STREET_Z - set }
}

const cells = new Map()
const set = (x, y, z, k) => cells.set(`${x},${y},${z}`, k)
/** A box of one kind: its low corner and its size. Later boxes are written over earlier ones. */
const box = (x, y, z, w, h, d, k) => { for (let j = 0; j < h; j++) for (let n = 0; n < d; n++) for (let i = 0; i < w; i++) set(x + i, y + j, z + n, k) }

// The sign's face: five wide and seven tall, heavy, with square shoulders. Drawn for bulbs three cells across.
const FACE = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.####', '#....', '#....', '#.###', '#...#', '#...#', '.###.'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  V: ['#...#', '#...#', '#...#', '#...#', '.#.#.', '.#.#.', '..#..'],
}
/** Cells across a bulb, and the gap between letters in bulbs. */
const BULBS = 3, GAP = 1
const wide = (word) => (word.length * (5 + GAP) - GAP) * BULBS

/**
 * A billboard that faces the street (south): a blue board with a yellow rule round it and its word in bulbs, on a
 * steel frame whose feet are glass. `x` is its middle, `y` the roof it stands on, `z` the front of its board; `over`
 * is a lower roof beside it that longer legs go down to, from which x on. Returns what the landing world needs.
 */
function sign(id, word, x, y, z, lift, over) {
  const w = wide(word) + 6, h = 7 * BULBS + 10, x0 = Math.round(x - w / 2), y0 = y + 1 + lift
  // Legs: steel, on glass feet four cells high. A foot is two cells square: one hard ball takes it out.
  const legs = []
  for (let n = 0, count = Math.max(3, Math.round(w / 34)); n < count; n++) legs.push(x0 + 3 + Math.round((n * (w - 8)) / (count - 1)))
  for (const lx of legs) {
    const base = over && lx >= over.from ? over.roof + 1 : y + 1
    box(lx, base, z - 3, 2, 4, 2, FOOT)
    box(lx, base + 4, z - 3, 2, y0 - base - 4, 2, FRAME)
    // A brace back to the roof behind, so that the board stands as a billboard does.
    if (base === y + 1) for (let s = 0; s < Math.min(12, lift + 6); s++) box(lx, y0 + 4 - s, z - 5 - s, 2, 1, 2, FRAME)
  }
  box(x0, y0, z - 3, w, 1, 2, FRAME)
  // The board, its rule, and the word.
  box(x0, y0 + 1, z - 2, w, h, 2, BOARD)
  for (let i = 0; i < w; i++) { set(x0 + i, y0 + 1, z, RULE); set(x0 + i, y0 + h, z, RULE) }
  for (let j = 1; j <= h; j++) { set(x0, y0 + j, z, RULE); set(x0 + w - 1, y0 + j, z, RULE) }
  const from = x0 + 3, low = y0 + 6
  for (const [n, letter] of [...word].entries()) for (const [row, bits] of FACE[letter].entries()) for (let col = 0; col < 5; col++) {
    if (bits[col] === '#') box(from + (n * (5 + GAP) + col) * BULBS, low + (6 - row) * BULBS, z, BULBS, BULBS, 1, BULB)
  }
  return { id, word, box: [x0, y0, z - 3, x0 + w, y0 + 1 + h, z + 1], at: [x0 + w / 2, y0 + 1 + h / 2, z + 1] }
}

const shops = [0, 1, 2, 3, 4].map(shop)
// Blog on the corner house; Village across the two houses beside it, the low one reached by long legs; then Tags and Feed.
const signs = [
  sign('blog', 'BLOG', shops[0].x0 + LOT / 2, shops[0].roof, shops[0].front - 8, 14),
  sign('village', 'VILLAGE', shops[2].x0 + 4, shops[2].roof, shops[2].front - 8, 8, { from: 0, roof: shops[1].roof, to: shops[2].x0 }),
  sign('tags', 'TAGS', shops[3].x0 + LOT / 2, shops[3].roof, shops[3].front - 8, 18),
  sign('feed', 'FEED', shops[4].x0 + LOT / 2, shops[4].roof, shops[4].front - 8, 8),
]

// The crate table, in the road before the row: a top of wood on four glass legs, crates stacked on it.
const TX = 300, TZ = 4062, TY = core.ground_at(TX, TZ) + 1
for (const [x, z] of [[-14, -9], [12, -9], [-14, 7], [12, 7]]) box(TX + x, TY, TZ + z, 2, 12, 2, FOOT)
box(TX - 16, TY + 12, TZ - 11, 32, 3, 22, kind(WOOD, BLUE))
box(TX - 11, TY + 15, TZ - 7, 9, 9, 9, kind(WOOD, YELLOW))
box(TX + 2, TY + 15, TZ - 5, 9, 9, 9, kind(WOOD))
box(TX - 5, TY + 24, TZ - 6, 9, 9, 9, kind(WOOD, YELLOW))
box(TX - 5, TY + 33, TZ - 6, 9, 9, 9, kind(WOOD))

// Where the face hangs: the corner house's west wall, over the side street. A frame of wood with nothing in it: the
// face itself is no cells (landing/face.ts draws it), so the frame is the slot.
const wall = ROW_X, FY = core.ground_at(ROW_X - 10, STREET_Z - 60) + 38, FZ = STREET_Z - 62
box(wall - 2, FY - 2, FZ - 2, 2, 56, 46, kind(WOOD, YELLOW))
box(wall - 3, FY, FZ, 2, 52, 42, kind(CONCRETE, 3))
const face = { at: [wall - 3, FY + 26, FZ + 21], wide: 42, tall: 52, normal: [-1, 0, 0] }

// As rows the core reads: x0, x1 (not filled), y, z, kind, in order of y, then z, then x.
const sorted = [...cells].map(([at, k]) => [...at.split(',').map(Number), k]).sort((a, b) => a[1] - b[1] || a[2] - b[2] || a[0] - b[0])
const rows = [], low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity]
for (const [x, y, z, k] of sorted) {
  const at = rows.length - 5
  if (at >= 0 && rows[at + 1] === x && rows[at + 2] === y && rows[at + 3] === z && rows[at + 4] === k) rows[at + 1] = x + 1
  else rows.push(x, x + 1, y, z, k)
  for (const [a, v] of [x, y, z].entries()) { low[a] = Math.min(low[a], v); high[a] = Math.max(high[a], v + 1) }
}
// The world's finest cells lie round the scene's middle (stage.ts): the row's middle, at the height of its roofs.
const centre = [ROW_X + (5 * LOT) / 2 - 20, core.ground_at(330, 4070) + 70, STREET_Z + 30]
const scene = { village: 'scene', version: 1, name: 'The corner', centre, eye: { far: 300, yaw: 0, pitch: -10 }, edits: [{ edit: [1, rows.length / 5, ...rows], box: [...low, ...high] }] }
const places = {
  centre,
  street: { z: STREET_Z + 70, ground: core.ground_at(330, STREET_Z + 70) },
  row: { x0: ROW_X, x1: ROW_X + 5 * LOT, front: STREET_Z, roof: Math.max(...shops.map((s) => s.roof)) },
  signs,
  table: { at: [TX, TY + 20, TZ] },
  face,
  colours: { blue: BLUE, yellow: YELLOW },
}
writeFileSync(new URL('scenes/corner.json', import.meta.url), JSON.stringify(scene) + '\n')
writeFileSync(new URL('scenes/places.json', import.meta.url), JSON.stringify(places, null, 1) + '\n')
console.log(`landing/scenes/corner.json: ${cells.size} cells in ${rows.length / 5} rows, ${JSON.stringify(scene).length} bytes; shops ${shops.map((s) => `${s.x0}:${s.roof}/${s.front}`).join(' ')}`)
