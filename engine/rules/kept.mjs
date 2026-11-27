// A small kept set of living things, as data (#264, the BODIES lane): what a rule can bring into the world at once,
// with no model and no wait: its cells, the motor's numbers, how it is driven and where its riders sit.
//
// A thing a model makes (`world.make`) is made on someone's own machine, takes seconds and is theirs; a race that
// starts when a rule says so needs six karts on the line now. These are few and plain on purpose: a rule picks one
// by what it is like and gives it a colour. Nothing here names a game.
//
// Cells are laid out x, then z, then y (as page/living.ts `Making`); +x is the front. A seat is where a rider's
// feet are, in the thing's own cells from its low corner.

import { sculptCoupe, sculptKart } from '../page/car-sculpt.ts'
import { POLISHED } from '../page/spells.ts'

const STEEL = 12, GLASS = 11, LAMP = 15, WOOD = 10
const kind = (material, colour = 0) => material | (colour << 8)
/** A colour of the world's palette by hue (0 to 23) and tone (0 to 9), as page/living.ts has it. */
const hue = (h, tone) => 16 + (((h % 24) + 24) % 24) * 10 + (tone % 10)
const DARK = kind(STEEL, 13)
const fineCache = new Map()
const fineOnce = (key, make) => {
  let hit = fineCache.get(key)
  if (!hit) { hit = make(); fineCache.set(key, hit) }
  return hit
}

/** An empty grid and how to set a cell of it. */
const grid = (size) => { const cells = new Int32Array(size[0] * size[1] * size[2]); return { cells, set: (x, y, z, k) => { if (x >= 0 && y >= 0 && z >= 0 && x < size[0] && y < size[1] && z < size[2]) cells[x + size[0] * (z + size[2] * y)] = k } } }
/** Four wheels a cell proud of the body, and a foot at each: the front two steer, the back two drive. */
const wheels = (set, xs, zs, tall) => { for (const x0 of xs) for (const z of zs) for (let x = x0; x < x0 + tall; x++) for (let y = 0; y < tall; y++) if (!((x === x0 || x === x0 + tall - 1) && (y === 0 || y === tall - 1))) set(x, y, z, DARK) }
const feet = (xs, zs, y, reach) => [[xs[0], zs[0], false], [xs[0], zs[1], false], [xs[1], zs[0], true], [xs[1], zs[1], true]].map(([x, z, front]) => ({ at: [x, y, z], reach, steers: front, drives: !front }))

export const KEPT = {
  /** A kart: 2.4 m long, low and open, one seat, wearing a 2.5 cm sculpted kart look (#61). Quick to turn, 14 m/s. */
  kart(colour) {
    // Its floor is three cells over the bottom of its wheels: a kerb two cells high passes under it. (With its floor at two it sat astride a built kerb, belly on it, and was set back only to climb it again.)
    const size = [24, 8, 14], { cells, set } = grid(size), paint = kind(STEEL, hue(colour, 4))
    for (let x = 0; x < 24; x++) for (let z = 2; z < 12; z++) { set(x, 3, z, paint); if (x === 0 || x === 23 || z === 2 || z === 11) set(x, 4, z, paint) }
    for (let z = 3; z < 11; z++) { for (let y = 4; y < 8; y++) set(3, y, z, paint); set(19, 5, z, DARK) }
    for (const z of [4, 9]) set(23, 4, z, kind(LAMP))
    wheels(set, [2, 16], [0, 13], 6)
    const look = fineOnce(`kart:${paint}`, () => sculptKart({ paint: paint | POLISHED, per: 4 }))
    return { name: 'kart', size, cells, scheme: 'drive', seats: [[9, 4, 7]], eye: [9.5, 11, 7], fine: [{ size: look.size, per: 4, low: [0, 0, 0], cells: look.cells }], motor: { front: 0, grip: 1.6, power: 70, top: 140, steer: 0.7, hover: 0, lift: 0, upright: 0, turns: 0, jump: 0, tough: 300, feet: feet([5, 19], [1, 13], 3, 6) } }
  },
  /** A car: 4.2 m, wearing the 2.5 cm sculpted coupe look (#61), two seats. 20 m/s. */
  car(colour) {
    const size = [42, 10, 18], { cells, set } = grid(size), paint = kind(STEEL, hue(colour, 4))
    for (let y = 2; y < 10; y++) for (let z = 1; z < 17; z++) for (let x = 0; x < 42; x++) {
      const cabin = y >= 6
      if (cabin && !(x >= 10 && x < 31)) continue
      const x0 = cabin ? 10 : 0, x1 = cabin ? 30 : 41, y0 = cabin ? 6 : 2, y1 = cabin ? 9 : 5
      if (x === x0 || x === x1 || z === 1 || z === 16 || y === y0 || y === y1) set(x, y, z, cabin && y < 9 && y > 6 ? kind(GLASS) : paint)
    }
    for (const z of [3, 4, 13, 14]) for (const y of [3, 4]) set(41, y, z, kind(LAMP))
    wheels(set, [4, 32], [0, 17], 6)
    const look = fineOnce(`car:${paint}`, () => sculptCoupe({ L: 4.2, H: 1.3, W: 1.8, per: 4, wheels: [0.7, 3.5], wheelY: 0.3, wheelR: 0.3, tyreW: 0.22, eye: [1.9, 1.0, 0.55], paint: paint | POLISHED }))
    return { name: 'car', size, cells, scheme: 'drive', seats: [[20, 3, 5], [20, 3, 12]], eye: [19, 10, 5.5], fine: [{ size: look.size, per: 4, low: [0, 0, 0], cells: look.cells }], motor: { front: 0, grip: 1.3, power: 60, top: 200, steer: 0.55, hover: 0, lift: 0, upright: 0, turns: 0, jump: 0, tough: 120, feet: feet([7, 35], [1, 17], 3, 5) } }
  },
  /** A broom: 2 m of wood that hangs a metre over the ground and flies, one astride. */
  broom() {
    const size = [20, 2, 2], { cells } = grid(size)
    cells.fill(kind(WOOD))
    return { name: 'broom', size, cells, scheme: 'hover', seats: [[9, 0, 1]], motor: { front: 0, grip: 1, power: 120, top: 150, steer: 0, hover: 10, lift: 80, upright: 20, turns: 2, jump: 0, tough: 150, feet: [] } }
  },
  /** A craft: an open steel hull 5 m by 2.4 m that rides half a metre over land and water alike and comes up a beach, six seats in two rows. 11 m/s. */
  craft(colour) {
    const size = [50, 9, 24], { cells, set } = grid(size), paint = kind(STEEL, hue(colour, 2))
    for (let x = 0; x < 50; x++) for (let z = 0; z < 24; z++) { set(x, 0, z, paint); if (x === 0 || x === 49 || z === 0 || z === 23) for (let y = 1; y < (x === 49 ? 5 : 8); y++) set(x, y, z, paint) }
    return { name: 'craft', size, cells, scheme: 'drive', seats: [[12, 1, 6], [12, 1, 17], [24, 1, 6], [24, 1, 17], [36, 1, 6], [36, 1, 17]], motor: { front: 0, grip: 1, power: 60, top: 110, steer: 0, hover: 5, lift: 0, upright: 30, turns: 1.2, jump: 0, tough: 400, feet: [] } }
  },
}

/** The rows of a kept thing set down with its low corner at a place: x0, x1, y, z, kind. */
export function rowsOf(thing, low) {
  const out = [], [sx, sy, sz] = thing.size
  for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
    const k = thing.cells[x + sx * (z + sz * y)]
    if (!k) continue
    let x1 = x + 1
    while (x1 < sx && thing.cells[x1 + sx * (z + sz * y)] === k) x1++
    out.push(low[0] + x, low[0] + x1, low[1] + y, low[2] + z, k)
    x = x1 - 1
  }
  return out
}
