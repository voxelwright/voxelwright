// A kept car's outside look, cleaned (#39): the bench's cars of 2.5 cm (the grey saloon, the SUV, the blue saloon) came
// out with their thin roofs and pillars open to rays, cells floating loose beside them, and single cells standing proud
// of a hood or a roof like the nubs of a 3D print. `cleanShell` takes those off before sf/cars.mjs makes the look
// coarser (page/car-sculpt.ts `coarser`, which keeps the shell) and packs it, in four passes over a copy:
//
//   specks   a cell touching nothing, or one other only at an edge or a corner, or a single other face to face and
//            nothing else round it (two in its 26); unless it is the tip of a stalk (an aerial, a mirror's arm, a
//            trolleybus's pole, which is a diagonal run of cells);
//   holes    a cell of outside air (a flood from the box's edge, by faces) between two opposite pairs of filled faces:
//            a hole in a sheet, filled with the kind most of those faces are (paint and glass before trim, a lamp only
//            among lamps); never in the three rows at the ground, where the tyres stand;
//   leaks    a cell of air shut inside (no flood by faces reaches it) that touches outside air across an edge or a
//            corner: a sloped sheet one cell thick whose steps meet only at their edges, which a ray passes between.
//            The saloon's roof and pillars had 281 of them and the SUV's 322. Filled from inside, so the outside
//            does not change, with the kind most of its filled faces are;
//   pimples  a cell of paint above the lowest quarter that touches a single other face to face and no more round it
//            than a flat panel gives (nine in its 26), unless the cell across the car's middle is filled too: a car's own details come in
//            pairs, a fault does not.
//
// Whole numbers and fixed orders throughout, so a look cleans the same on every machine. Kinds are laid
// `kinds[x + w * (z + d * y)]` (x along, z across, y up), as the looks are.

import { mostAround, outsideAir, sealLeaks } from '../page/car-sculpt.ts'

const material = (k) => k & 15
const FACES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]

/**
 * Cleans a look's kinds, in a copy: `{ kinds, specks, holes, leaks, pimples }`. `paint(k)` says which kinds are its
 * paint (sf/cars.mjs `paintOf`); without it, steel is.
 */
export function cleanShell(kinds, size, paint = (k) => material(k) === 12) {
  const [w, h, d] = size, out = Uint16Array.from(kinds)
  const at = (x, y, z) => (x < 0 || y < 0 || z < 0 || x >= w || y >= h || z >= d ? 0 : out[x + w * (z + d * y)])
  const faces = (x, y, z) => { let n = 0; for (const [a, b, c] of FACES) if (at(x + a, y + b, z + c)) n++; return n }
  const round = (x, y, z) => { let n = 0; for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) for (let a = -1; a <= 1; a++) if ((a || b || c) && at(x + a, y + b, z + c)) n++; return n }
  const most = (x, y, z) => mostAround(out, size, x + w * (z + d * y), paint)

  // ── Specks ──
  const gone = []
  for (let y = 0; y < h; y++) for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) {
    if (!at(x, y, z)) continue
    const f = faces(x, y, z)
    const r = round(x, y, z)
    if (f === 0 && r <= 1) {
      // Touching one other at a corner: a speck, unless that one is itself the end of a thin run (a pole's tip).
      let a = 0, b = 0, c = 0
      if (r) for (let e = -1; e <= 1; e++) for (let g = -1; g <= 1; g++) for (let q = -1; q <= 1; q++) if ((q || e || g) && at(x + q, y + e, z + g)) { a = q; b = e; c = g }
      if (!r || round(x + a, y + b, z + c) > 2) gone.push(x + w * (z + d * y))
      continue
    }
    if (f !== 1 || r > 2) continue
    const [a, b, c] = FACES.find(([a, b, c]) => at(x + a, y + b, z + c))
    if (at(x + 2 * a, y + 2 * b, z + 2 * c) && faces(x + a, y + b, z + c) <= 2) continue // the tip of a straight stalk
    gone.push(x + w * (z + d * y))
  }
  for (const i of gone) out[i] = 0
  const specks = gone.length

  // ── Holes ──
  const outside = outsideAir(out, size)
  const holes = []
  for (let y = 3; y < h; y++) for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) {
    const i = x + w * (z + d * y)
    if (out[i] || !outside[i]) continue
    const pairs = (at(x - 1, y, z) && at(x + 1, y, z) ? 1 : 0) + (at(x, y - 1, z) && at(x, y + 1, z) ? 1 : 0) + (at(x, y, z - 1) && at(x, y, z + 1) ? 1 : 0)
    if (pairs >= 2) holes.push([i, most(x, y, z)])
  }
  for (const [i, k] of holes) out[i] = k

  // ── Leaks ──
  const leaks = sealLeaks(out, size, paint)

  // ── Pimples ──
  // The car's middle across, twice over: where its cells are on average (a part on one side moves it little), so a
  // cell's pair across it is at `across - z`, give or take one.
  let sum = 0, many = 0
  for (let i = 0; i < out.length; i++) if (out[i]) { sum += Math.floor(i / w) % d; many++ }
  const across = Math.round((2 * sum) / Math.max(1, many))
  const nubs = []
  for (let y = Math.floor(h * 0.25) + 1; y < h; y++) for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) {
    const k = at(x, y, z)
    if (!k || !paint(k) || faces(x, y, z) !== 1 || round(x, y, z) > 9) continue
    if (at(x, y, across - z) || at(x, y, across - z - 1) || at(x, y, across - z + 1)) continue // its pair across the middle: a part of the car
    nubs.push(x + w * (z + d * y))
  }
  for (const i of nubs) out[i] = 0
  return { kinds: out, specks, holes: holes.length, leaks, pimples: nubs.length }
}
