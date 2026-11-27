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

/**
 * Cleans a kept car's interior look (`look[1..]`, #74): removes floating specks and single-voxel surface nubs,
 * neutralizes stray chromatic noise voxels on dark plaster interiors to matching charcoal grey, and applies two passes
 * of 3x3x3 grey-level median smoothing to eliminate salt-and-pepper white speckles on dark dashboards, pillars and
 * steering wheels while keeping large light regions (headliners, pillar trim) intact.
 */
export function cleanInterior(kinds, size) {
  const [w, h, d] = size, out = Uint16Array.from(kinds)
  const PLASTER = 9
  const colourOf = (k) => (k >> 8) & 255
  const at = (buf, x, y, z) => (x < 0 || y < 0 || z < 0 || x >= w || y >= h || z >= d ? 0 : buf[x + w * (z + d * y)])
  const facesOf = (buf, x, y, z) => { let n = 0; for (const [a, b, c] of FACES) if (at(buf, x + a, y + b, z + c)) n++; return n }
  const roundOf = (buf, x, y, z) => { let n = 0; for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) for (let a = -1; a <= 1; a++) if ((a || b || c) && at(buf, x + a, y + b, z + c)) n++; return n }

  // 1. Floating specks and jagged 1-voxel interior spikes.
  const gone = []
  for (let y = 0; y < h; y++) for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) {
    if (!at(out, x, y, z)) continue
    const f = facesOf(out, x, y, z), r = roundOf(out, x, y, z)
    if (f === 0 || (f === 1 && r <= 6)) gone.push(x + w * (z + d * y))
  }
  for (const i of gone) out[i] = 0

  // 2. Neutralize isolated chromatic plaster noise (green/pink/purple speckles in dark cabins) to local charcoal grey.
  let chromFixed = 0
  const greys = new Int32Array(27)
  const snap = Uint16Array.from(out)
  for (let y = 0; y < h; y++) for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) {
    const idx = x + w * (z + d * y), k = snap[idx]
    if (!k || material(k) !== PLASTER || colourOf(k) < 16) continue
    let chromN = 0, gn = 0
    for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) for (let a = -1; a <= 1; a++) {
      if (!a && !b && !c) continue
      const nk = at(snap, x + a, y + b, z + c)
      if (!nk || material(nk) !== PLASTER) continue
      const nc = colourOf(nk)
      if (nc >= 16) chromN++
      else if (nc >= 1 && nc <= 15) greys[gn++] = nc
    }
    if (chromN < 6) {
      let g = 13
      if (gn > 0) {
        const slice = greys.subarray(0, gn).sort()
        g = Math.max(10, Math.min(14, slice[gn >> 1]))
      }
      out[idx] = PLASTER | (g << 8)
      chromFixed++
    }
  }

  // 3. Tone down specular-white bench artifacts (c <= 6) in the lower cabin (dash/console/wheel/seats, below 68% height)
  // to shaded dark slate/charcoal so they don't flash bright white beneath the steering wheel, while keeping light headliners.
  const lowerCut = Math.floor(h * 0.68)
  let glared = 0
  for (let y = 0; y < lowerCut; y++) for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) {
    const idx = x + w * (z + d * y), k = out[idx]
    if (!k || material(k) !== PLASTER) continue
    const c0 = colourOf(k)
    if (c0 >= 1 && c0 <= 6) {
      out[idx] = PLASTER | ((11 + Math.min(2, (6 - c0) >> 1)) << 8)
      glared++
    }
  }

  // 4. Two passes of 3x3x3 grey-level median smoothing on plaster to remove salt-and-pepper speckles on dark cabins.
  let smoothed = 0
  for (let pass = 0; pass < 2; pass++) {
    const src = Uint16Array.from(out)
    for (let y = 0; y < h; y++) for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) {
      const idx = x + w * (z + d * y), k = src[idx]
      if (!k || material(k) !== PLASTER) continue
      const c0 = colourOf(k)
      if (c0 < 1 || c0 > 15) continue
      let gn = 0
      for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) for (let a = -1; a <= 1; a++) {
        const nk = at(src, x + a, y + b, z + c)
        if (!nk || material(nk) !== PLASTER) continue
        const nc = colourOf(nk)
        if (nc >= 1 && nc <= 15) greys[gn++] = nc
      }
      if (gn < 7) continue
      const slice = greys.subarray(0, gn).sort()
      const med = slice[gn >> 1]
      if ((c0 <= 6 && med >= 9) || Math.abs(c0 - med) >= 2) {
        out[idx] = PLASTER | (med << 8)
        smoothed++
      }
    }
  }
  return { kinds: out, specks: gone.length, chromFixed, smoothed: smoothed + glared }
}

/**
 * Polishes the blue saloon (`hatch`, 170x60x80 at per=4, front=-x) cabin interior (#74): clears the blocky flat-black
 * dash slab and stray center post, and sculpts a lower raked matte-charcoal dashboard, subtle brushed-slate trim strip,
 * recessed instrument binnacle with crisp dial markings, compact center console, and a 3-spoke steering wheel in front
 * of the driver seat so seat-view framing is clear and readable.
 */
export function polishHatch(kinds, size) {
  const [w, h, d] = size, out = Uint16Array.from(kinds)
  if (w < 168 || h < 56 || d < 76) return { kinds: out, changed: 0 }
  const PLASTER = 9, GLASS = 11, STEEL = 12
  const DASH = PLASTER | (13 << 8)
  const DARK = PLASTER | (14 << 8)
  const DEEP = PLASTER | (15 << 8)
  const TRIM = STEEL | (7 << 8)
  const KNOB = STEEL | (8 << 8)
  const DIAL = PLASTER | (169 << 8) // soft cool cyan-white gauge accent
  const WHEEL = PLASTER | (14 << 8)
  const WHEEL_TOP = PLASTER | (11 << 8)
  const idxOf = (x, y, z) => x + w * (z + d * y)
  const colourOf = (k) => (k >> 8) & 255
  let changed = 0
  const set = (x, y, z, k) => {
    if (x < 0 || y < 0 || z < 0 || x >= w || y >= h || z >= d) return
    const i = idxOf(x, y, z), prev = out[i]
    // Never overwrite exterior glass or painted shell.
    if (prev && (material(prev) === GLASS || colourOf(prev) >= 16)) return
    if (prev !== k) { out[i] = k; changed++ }
  }

  // Compute lowest windshield glass height per (x, z) so sculpted cabin pieces stay cleanly beneath it.
  const glassLow = (x, z) => {
    for (let y = 26; y < h; y++) if (material(out[idxOf(x, y, z)]) === GLASS) return y
    return h
  }

  // 1. Clear the flat dark-steel dash slab (x=55..75) and stray center stick (x=72, z=40) inside the cabin walls.
  for (let z = 11; z <= 68; z++) {
    for (let x = 55; x <= 76; x++) {
      const top = Math.min(44, glassLow(x, z))
      for (let y = 23; y < top; y++) {
        const i = idxOf(x, y, z), k = out[i]
        if (!k) continue
        // Clear dark grey steel slabs/posts; keep seats (plaster) and exterior paint/glass untouched.
        if (material(k) === STEEL && colourOf(k) <= 15) { out[i] = 0; changed++ }
      }
    }
  }

  // 2. Sculpt raked charcoal dashboard (x=55..62, sloping smoothly down from y=33 at windshield base to y=29 at driver edge).
  for (let z = 11; z <= 68; z++) {
    for (let x = 55; x <= 62; x++) {
      const cap = Math.min(glassLow(x, z) - 1, Math.round(33 - (x - 55) * 0.55))
      for (let y = 21; y <= cap; y++) {
        const isTrim = x === 62 && y === 27 && z >= 13 && z <= 66
        set(x, y, z, isTrim ? TRIM : y >= cap - 1 ? DASH : DARK)
      }
    }
  }

  // 3. Driver instrument binnacle hood (z=47..62, x=59..64) + recessed gauge cluster with two crisp dials.
  for (let z = 47; z <= 62; z++) {
    const arch = Math.round(2 * (1 - ((z - 54.5) / 8.5) ** 2))
    for (let x = 59; x <= 64; x++) {
      const top = Math.min(glassLow(x, z) - 1, 29 + arch + (x <= 61 ? 1 : 0))
      for (let y = 27; y <= top; y++) {
        const recessed = x >= 63 && z >= 49 && z <= 60 && y >= 27 && y <= top - 1
        if (recessed) continue
        if (x === 62 && z >= 49 && z <= 60 && y >= 27 && y <= 30) {
          const d1 = Math.hypot(z - 52, y - 28.5), d2 = Math.hypot(z - 57.5, y - 28.5)
          const ring = (d1 >= 1.1 && d1 <= 2.1) || (d2 >= 1.1 && d2 <= 2.1)
          set(x, y, z, ring ? DIAL : DEEP)
        } else {
          set(x, y, z, y === top ? DASH : DARK)
        }
      }
    }
  }

  // 4. Compact center stack & infotainment screen (z=35..44, x=60..63) + low center tunnel & gear knob.
  for (let z = 35; z <= 44; z++) {
    for (let x = 60; x <= 63; x++) {
      for (let y = 21; y <= 31; y++) {
        if (x === 63 && z >= 36 && z <= 43 && y >= 27 && y <= 30) set(x, y, z, DEEP)
        else if (x === 63 && (z === 35 || z === 44) && y >= 27 && y <= 30) set(x, y, z, TRIM)
        else set(x, y, z, DARK)
      }
    }
  }
  for (let z = 36; z <= 43; z++) for (let x = 64; x <= 82; x++) for (let y = 20; y <= 23; y++) set(x, y, z, y === 23 ? DASH : DARK)
  for (let z = 39; z <= 40; z++) for (let x = 70; x <= 71; x++) for (let y = 24; y <= 26; y++) set(x, y, z, y === 26 ? KNOB : DARK)

  // 5. Sculpted 3-spoke steering wheel in front of driver (center z=55, y=29.5, x=70, tilted 20 deg toward driver).
  const cx = 70, cy = 29.5, cz = 55, R = 6.2
  // Steering column shaft from dash to wheel hub.
  for (let x = 63; x <= 69; x++) for (let y = 28; y <= 30; y++) for (let z = 54; z <= 56; z++) set(x, y, z, DARK)
  // Wheel rim & center hub.
  for (let y = Math.floor(cy - R - 1); y <= Math.ceil(cy + R + 1); y++) {
    for (let z = Math.floor(cz - R - 1); z <= Math.ceil(cz + R + 1); z++) {
      const dy = y - cy, dz = z - cz, r = Math.hypot(dy, dz)
      const wx = Math.round(cx - dy * 0.34)
      if (r <= 1.8) {
        set(wx, y, z, r <= 1.0 ? TRIM : WHEEL)
        set(wx - 1, y, z, DARK)
      } else if (r >= R - 1.15 && r <= R + 0.55) {
        const topMark = dy > R - 1.4 && Math.abs(dz) <= 1
        set(wx, y, z, topMark ? WHEEL_TOP : WHEEL)
        set(wx + 1, y, z, WHEEL)
      } else if (r < R - 0.8) {
        // 3 spokes: left, right (slightly angled down), and bottom vertical spoke.
        const sideSpoke = Math.abs(dy + 0.3) <= 0.7 && Math.abs(dz) >= 1.5
        const botSpoke = dy < -1.2 && Math.abs(dz) <= 0.75
        if (sideSpoke || botSpoke) set(wx, y, z, TRIM)
      }
    }
  }
  return { kinds: out, changed }
}
