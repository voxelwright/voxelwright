// A made thing that is meant to be driven, brought to life (#245). A model makes a car as cells (parts in cells of
// 10 cm, or a program in cells of 2.5 cm); what makes it live is worked out here from those cells, and the model
// says only what the cells cannot: which end is its front, and how fast a thing of its kind goes.
//
//   the body      its cells of 10 cm: the thing's own finer cells, a cell filled where a quarter of its finer cells are
//   its look      its own finer cells, riding on the body (page/living.ts `Fine`), when they are finer than the body's
//   its feet      one at each wheel: the cells that touch the ground, gathered into groups; each group's wheel is
//                 measured slice by slice across it (how tall and how long the round thing there is). Front wheels
//                 steer, every wheel drives. A leg or a post is no wheel. Nothing that rolls: four feet under its
//                 corners, and it is said so
//   its front     as the model said it; else what its own cells say plainly: its lamps (white ahead, red behind);
//                 else, made alive where it stands (make.mjs `enliven`), the way it was made to face if that lies
//                 along it. When nothing says, the end its high parts are not over, and it is said that nobody knows
//   its length    along its front when that was said; else the way it rolls on its wheels, else its longer side: so
//                 its wheels are found before its front is looked for
//   its seat      the deepest room on the driver's line between its axles (a cockpit, a cabin), on the left of what
//                 is wider than 1.5 m; the eye 0.8 m over it, under any roof
//   its motor     grip enough for the sprint asked, the X3's steering; its power tried in the engine's own solver
//                 (page/core.wasm, here, with no page) until it reaches 100 km/h in the time asked. `facts.measured` holds only what that last run
//                 measured with the motor as it is kept; what was asked and not measured stays under `asked`
//
// The result is a reply of cells with `living` (make/alive.mjs), read and checked as any reply is, and kept as one:
// the next asker of the same words gets the living thing with nothing worked out again.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BODY_MOST } from './alive.mjs'
import { ran, written } from './cells.mjs'
export { drivesOf } from './form.mjs'

const here = dirname(fileURLToPath(import.meta.url))
/** Which way each front points in a body's own cells (x, z), as page/living.ts `Motor.front` counts them. */
const FRONTS = [[1, 0], [-1, 0], [0, 1], [0, -1]]
const LAMP = 15
/** What a thing goes like when nothing says: a plain car (km/h, and seconds from 0 to 100). */
export const PLAIN = { top_kmh: 180, zero_to_100_s: 9 }
const KMH = 0.36

/** A thing's own front, as a reply says it, in the body's own cells: a reply's space has z from the front to the back, a body's z runs the other way (`bodyOf`). */
export const OWN_FRONT = { '+x': 0, '-x': 1, '-z': 2, '+z': 3 }

/**
 * A thing as a reply lays it (x, then z from its front, then y) as a body lays it: z turned round. A reply's space
 * is laid in the world mirrored (form.mjs FACINGS), a living body only turned, so without this a car would be driven
 * from the wrong side.
 */
export function bodyOf({ size: [w, h, d], cells }) {
  const out = new Uint16Array(cells.length)
  for (let y = 0; y < h; y++) for (let z = 0; z < d; z++) out.set(cells.subarray((y * d + z) * w, (y * d + z + 1) * w), (y * d + (d - 1 - z)) * w)
  return out
}

/**
 * Cells (in a body's own axes: x, z, y as the world's, laid (y * d + z) * w + x) brought to life. `cm` is a cell's
 * side (10, 5, 2.5 or 1.25); `front` the way its nose points (0 to 3) if its maker said it; `faced` the way it was
 * made to face (0 to 3), taken only when its cells do not say and it lies along it; `asked` how it should go.
 * Resolves to { text: a reply of cells with living, said: [what was worked out, in words], wheels, front, unsure: why
 * its front is not known (or ''), facts }, or throws an Error with why it cannot live (too big).
 */
export async function driven({ name, size, cm, cells, front, faced, asked = {}, core = join(here, '..', 'page', 'core.wasm') }) {
  const [w, h, d] = size, per = Math.round(10 / cm), said = []
  const at = (x, y, z) => (x < 0 || y < 0 || z < 0 || x >= w || y >= h || z >= d ? 0 : cells[(y * d + z) * w + x])
  // The body, in cells of 10 cm.
  const W = Math.ceil(w / per), H = Math.ceil(h / per), D = Math.ceil(d / per)
  if (Math.max(W, H, D) > BODY_MOST) throw new Error(`it is ${(Math.max(W, H, D) / 10).toFixed(1)} m along a side, and a thing that is driven is at most ${BODY_MOST / 10} m`)
  const body = new Uint16Array(W * H * D), count = new Map()
  const need = per === 1 ? 1 : per === 2 ? 1 : per ** 3 / 4
  for (let Y = 0; Y < H; Y++) for (let Z = 0; Z < D; Z++) for (let X = 0; X < W; X++) {
    count.clear(); let filled = 0
    for (let y = Y * per; y < (Y + 1) * per; y++) for (let z = Z * per; z < (Z + 1) * per; z++) for (let x = X * per; x < (X + 1) * per; x++) { const k = at(x, y, z); if (k) { filled++; count.set(k, (count.get(k) ?? 0) + 1) } }
    if (filled < need) continue
    let best = 0, most = 0
    for (const [k, n] of count) if (n > most) { most = n; best = k }
    body[(Y * D + Z) * W + X] = best
  }
  if (!body.some(Boolean)) throw new Error('it is too thin to have a body to drive')
  // The way it is driven: the way its front points, if that was said; else the way it rolls on its wheels (its longer
  // side tried first), else its longer side. Its wheels are found along it before its front is looked for.
  const said_ = [0, 1, 2, 3].includes(front), longer = w >= d ? 0 : 2
  let L, len, wide, along, across, cell, low, wheels, round, rolls, feet, noRoll
  for (const tried of said_ ? [front < 2 ? 0 : 2] : [longer, 2 - longer]) {
    ;({ L, len, wide, along, across, cell, low, wheels, round, rolls, feet, noRoll } = rollsAlong(tried))
    if (rolls) break
  }
  if (!rolls && !said_ && L !== longer) ({ L, len, wide, along, across, cell, low, wheels, round, rolls, feet, noRoll } = rollsAlong(longer))
  if (!rolls) said.push(noRoll)
  /** Its wheels, with its length along x (L 0) or z (L 2): what touches the ground, in groups, measured; and whether it rolls on them. */
  function rollsAlong(L) {
    const len = L === 0 ? w : d, wide = L === 0 ? d : w
    const along = (x, z) => (L === 0 ? x : z), across = (x, z) => (L === 0 ? z : x)
    const cell = (l, y, c) => (L === 0 ? at(l, y, c) : at(c, y, l))

    // The wheels: what touches the ground, in groups.
    const low = Math.max(1, Math.min(2, per >> 1)), touching = new Uint8Array(len * wide)
    for (let l = 0; l < len; l++) for (let c = 0; c < wide; c++) for (let y = 0; y < low; y++) if (cell(l, y, c)) touching[c * len + l] = 1
    const group = new Int32Array(len * wide).fill(-1), groups = []
    for (let i = 0; i < touching.length; i++) {
      if (!touching[i] || group[i] >= 0) continue
      const g = [], stack = [i]; group[i] = groups.length
      while (stack.length) {
        const j = stack.pop(), l = j % len, c = Math.floor(j / len); g.push([l, c])
        for (const [dl, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2]]) {
          const nl = l + dl, nc = c + dc, k = nc * len + nl
          if (nl >= 0 && nc >= 0 && nl < len && nc < wide && touching[k] && group[k] < 0) { group[k] = groups.length; stack.push(k) }
        }
      }
      groups.push(g)
    }
    // A group longer than a third of the thing is a skirt or a floor, not a wheel; one of a cell or two is a crumb.
    const wheels = groups.filter((g) => g.length >= (per >= 4 ? 4 : 1)).map((g) => {
      const ls = g.map((p) => p[0]), cs = g.map((p) => p[1]), l0 = Math.min(...ls), l1 = Math.max(...ls), c0 = Math.min(...cs), c1 = Math.max(...cs)
      return { l: (l0 + l1 + 1) / 2, c: (c0 + c1 + 1) / 2, l0, l1, c0, c1, n: g.length }
    }).filter((g) => g.l1 - g.l0 + 1 <= len / 3)
    for (const wh of wheels) wh.r = radius(wh)
    /** How big a wheel is: in each slice across it, the round thing that touches the ground there, grown through what is filled; the biggest that is still what a wheel may be. */
    function radius(wh) {
      const most = Math.min(h * 0.9, len * 0.3)
      let round = 0
      for (let c = wh.c0; c <= wh.c1; c++) {
        const seen = new Set(), stack = []
        for (let l = wh.l0; l <= wh.l1; l++) for (let y = 0; y < low; y++) if (cell(l, y, c)) { stack.push([l, y]); seen.add(l * 4096 + y) }
        let top = 0, l0 = Infinity, l1 = -Infinity
        while (stack.length) {
          const [l, y] = stack.pop()
          top = Math.max(top, y + 1); l0 = Math.min(l0, l); l1 = Math.max(l1, l)
          if (top > most || l1 - l0 + 1 > most) break
          for (const [dl, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nl = l + dl, ny = y + dy, k = nl * 4096 + ny; if (nl >= 0 && ny >= 0 && !seen.has(k) && cell(nl, ny, c)) { seen.add(k); stack.push([nl, ny]) } }
        }
        const r = Math.max(top, l1 - l0 + 1)
        if (r <= most) round = Math.max(round, r)
      }
      if (round >= 2) return round / 2
      // Grown into the body in every slice (a wheel flush with its flank): its own kind, up from where it touches, is a
      // round thing: no taller than a wheel may be, and about as long along the ground as it is tall at its middle. A leg
      // or a post (taller, or thin) is no wheel: 0.
      // (Its middle cell: the middle of a group one cell long is that cell.)
      const l = Math.floor(wh.l), c = Math.floor(wh.c), kind = cell(l, 0, c) || cell(l, 1, c)
      if (!kind) return 0
      let up = 0
      while (up < h && cell(l, up, c) === kind) up++
      if (up < 2 || up > most) return 0
      const y = up >> 1
      let a = l, b = l
      while (a > 0 && cell(a - 1, y, c) === kind) a--
      while (b < len - 1 && cell(b + 1, y, c) === kind) b++
      const long = b - a + 1
      return long / up >= 0.6 && long / up <= 1.6 ? Math.max(up, long) / 2 : 0
    }
    // Which wheels it rolls on: those on each side of its middle line, two or more of them along it.
    // (A leg or a post that touches the ground is no wheel: a wheel is 0.1 m or more across its middle.)
    const round = wheels.filter((wh) => wh.r * cm >= 10)
    const rolls = round.length >= 3 && new Set(round.map((wh) => wh.c < wide / 2)).size === 2 && Math.max(...round.map((wh) => wh.l)) - Math.min(...round.map((wh) => wh.l)) > len / 3
    let feet
    if (rolls) feet = round.slice().sort((a, b) => b.n - a.n).slice(0, 16)
    else {
      // Nothing that rolls (a block, a boat, a broom): four feet under its corners, as if it had small wheels there (0.3 m).
      const r = Math.max(2, Math.round(30 / cm)), inset = Math.max(r, len * 0.15)
      feet = [[inset, wide * 0.2], [inset, wide * 0.8], [len - inset, wide * 0.2], [len - inset, wide * 0.8]].map(([l, c]) => ({ l, c, r, n: 0 }))
    }
    return { L, len, wide, along, across, cell, low, wheels, round, rolls, feet, noRoll: 'nothing of it rolls: it goes on four small wheels under its corners' }
  }

  // Its front: as said; else what its cells say plainly (its lamps: white ahead, red behind); else the way it was made
  // to face, if that lies along it; else a guess (the end its high parts are not over), and nobody claims it.
  let how = 'said', unsure = ''
  if (!said_) {
    const ahead0 = [0, 0]
    for (let y = 0; y < h; y++) for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) {
      const k = cells[(y * d + z) * w + x]
      if ((k & 15) !== LAMP) continue
      const l = along(x, z), hue = k >> 8, red = hue >= 16 && Math.floor((hue - 16) / 10) <= 1, white = hue <= 3
      // ahead0[0]: lamps that say its front is at the low end of its length; [1]: at the high end.
      if (red) ahead0[l < len / 2 ? 1 : 0]++
      else if (white) ahead0[l < len / 2 ? 0 : 1]++
    }
    const most = Math.max(...ahead0), least = Math.min(...ahead0)
    let high
    if (most >= 4 && most >= 2 * least) { high = ahead0[1] > ahead0[0]; how = 'its lamps' }
    else if ([0, 1, 2, 3].includes(faced) && (faced < 2 ? 0 : 2) === L) { high = faced === 0 || faced === 2; how = 'the way it was made to face' }
    else {
      // How much of it is high, nearer one end than the other: a bonnet or a nose is low, a cabin or a wing is behind the middle.
      let a = 0, b = 0
      for (let y = Math.floor(h * 0.6); y < h; y++) for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) if (cells[(y * d + z) * w + x]) { const l = along(x, z); if (l < len / 2) a++; else b++ }
      high = a > b
      unsure = 'which end is its front could not be told: if it goes the wrong way, turn it round'
    }
    front = L === 0 ? (high ? 0 : 1) : (high ? 2 : 3)
  }
  const ahead = FRONTS[front][L === 0 ? 0 : 1]
  said.push(unsure || `its front by ${how === 'said' ? 'what was said' : how}`)

  // Its middle of mass along its length, from the body's cells: how the weight is shared between its axles.
  let mass = 0, ml = 0, mc = 0
  for (let Y = 0; Y < H; Y++) for (let Z = 0; Z < D; Z++) for (let X = 0; X < W; X++) if (body[(Y * D + Z) * W + X]) { mass++; ml += L === 0 ? X : Z; mc += L === 0 ? Z : X }
  ml = (ml / mass + 0.5) * per; mc = (mc / mass + 0.5) * per
  const front_ = (wh) => (wh.l - len / 2) * ahead > 0
  const fronts = feet.filter(front_), backs = feet.filter((f) => !front_(f))
  const axle = (list) => (list.length ? list.reduce((a, f) => a + f.l, 0) / list.length : ml)
  const fa = axle(fronts), ba = axle(backs), span = Math.abs(fa - ba) || 1
  const share = (f) => Math.min(0.75, Math.max(0.25, front_(f) ? Math.abs(ml - ba) / span : Math.abs(fa - ml) / span)) / ((front_(f) ? fronts.length : backs.length) / 2 || 1)
  const foot = (f) => {
    const r = f.r / per, y = r, l = f.l / per, c = f.c / per, s = share(f)
    // Pressed in at rest by 0.4 × reach × its load over a quarter of the weight (as make/alive.mjs's importer's bench levels it): so it stands with its wheels on the road.
    const reach = Math.min(24, Math.max(1, y / Math.max(0.2, 1 - 0.4 * 2 * s) + 0.3))
    return { at: L === 0 ? [+l.toFixed(2), +y.toFixed(2), +c.toFixed(2)] : [+c.toFixed(2), +y.toFixed(2), +l.toFixed(2)], reach: +reach.toFixed(2), steers: front_(f), drives: true }
  }
  const motorFeet = feet.map(foot)

  // The seat: on the driver's line, between the axles, where there is the most room over a floor.
  const lo = Math.min(fa, ba), hi = Math.max(fa, ba)
  // How wide it is between its axles, half way up: its wheels left out, an open single seater is narrow.
  let wideM = 0
  { const l = Math.round((lo + hi) / 2), y = Math.floor(h / 2); let c0 = wide, c1 = -1; for (let cc = 0; cc < wide; cc++) if (cell(l, y, cc)) { c0 = Math.min(c0, cc); c1 = cc } wideM = c1 < c0 ? 0 : ((c1 - c0 + 1) * cm) / 100 }
  // The driver sits on the left of what is wider than 1.5 m (facing +x its left is -z, facing +z its left is +x), else in the middle.
  const left = L === 0 ? (ahead > 0 ? 0.3 : 0.7) : (ahead > 0 ? 0.7 : 0.3), c = Math.round(wide * (wideM >= 1.5 ? left : 0.5))
  let seatL = (lo + hi) / 2, seatY = 0, seatRoof = h, seatRim = 0, best = -Infinity
  const topOf = (l, cc) => { for (let y = h - 1; y >= 0; y--) if (cell(l, y, cc)) return y + 1; return 0 }
  for (let l = Math.round(lo + (hi - lo) * 0.1); l <= Math.round(hi - (hi - lo) * 0.1); l++) {
    let y = 0
    while (y < h && !cell(l, y, c)) y++
    while (y < h && cell(l, y, c)) y++
    if (y >= h) continue
    // Room: air over the floor up to a roof, or up to the highest of what is round it (a cockpit's rim). A roof counts for more.
    let roof = y
    while (roof < h && !cell(l, roof, c)) roof++
    const rim = Math.max(...[-6, 6].map((dl) => topOf(l + dl * Math.max(1, per >> 1), c)), ...[-4, 4].map((dc) => topOf(l, c + dc * Math.max(1, per >> 1))))
    const room = roof < h ? roof - y : rim - y
    const score = room * (roof < h ? 1.5 : 1) - Math.abs(l - (lo + (hi - lo) * 0.45)) * 0.05
    if (room > 0 && score > best) { best = score; seatL = l; seatY = y; seatRoof = roof; seatRim = rim }
  }
  if (best === -Infinity) { seatY = topOf(Math.round(seatL), c); seatRim = seatY }
  // The eye 0.8 m over the seat: under a roof, a little under it; in the open (a cockpit, or on top of what is solid), not far over its rim.
  const eyeY = seatRoof < h ? Math.min(seatY + 80 / cm, seatRoof - 10 / cm) : Math.min(seatY + 80 / cm, Math.max(seatRim, seatY) + 30 / cm)
  const eyeAt = (l, y, cc) => (L === 0 ? [l / per, y / per, cc / per] : [cc / per, y / per, l / per]).map((v) => +v.toFixed(2))
  const eye = eyeAt(seatL + 0.5, eyeY, c + 0.5), seat = [eye[0], +(eye[1] - 12).toFixed(2), eye[2]]
  said.push(`its seat ${(Math.abs(seatL - ml) * cm / 100).toFixed(1)} m ${(seatL - ml) * ahead > 0 ? 'ahead of' : 'behind'} its middle, the eye ${(eyeY * cm / 100).toFixed(1)} m up`)

  // Its motor: its top speed as asked, its power tried until 0 to 100 takes the time asked.
  const want = { top_kmh: asked.top_kmh ?? PLAIN.top_kmh, zero_to_100_s: asked.zero_to_100_s ?? PLAIN.zero_to_100_s }
  // Grip enough for the sprint asked, with every wheel driving (a back axle alone carries half the weight, and the X3's 0.9 cannot give an F1 car its 2.6 s).
  const motor = { front, grip: +Math.min(3, Math.max(0.9, (27.8 / want.zero_to_100_s) / 9.81 * 1.3)).toFixed(2), power: 60, top: +(want.top_kmh / KMH).toFixed(0), steer: 0.6, hover: 0, lift: 0, upright: 0, turns: 0, jump: 0, tough: 120, feet: motorFeet }
  // Only what was asked is said to have been asked: a figure nobody gave is the motor's, not the card's.
  const given = Object.fromEntries(Object.entries(asked).filter(([k, v]) => ['top_kmh', 'zero_to_100_s'].includes(k) && typeof v === 'number'))
  const facts = Object.keys(given).length ? { asked: given } : {}
  const s = await solver(core)
  if (want.top_kmh >= 110) {
    let a = 5, b = 2000
    for (let i = 0; i < 12; i++) { const mid = (a + b) / 2, t = s.sprint(body, [W, H, D], { ...motor, power: mid }); if (t === null || t > want.zero_to_100_s) a = mid; else b = mid }
    motor.power = Math.round((a + b) / 2)
  }
  const run = s.sprint(body, [W, H, D], motor, true)
  if (run.broke) throw new Error('it broke in the engine\'s own solver when it was first driven')
  if (run.to100 !== null) facts.measured = { zero_to_100_s: +run.to100.toFixed(2) }
  said.push(`${feet.length} feet${rolls ? ` on its wheels (${feet.map((f) => `${((f.r * cm * 2) / 100).toFixed(2)} m`).join(', ')})` : ''}; ${run.to100 !== null ? `0 to 100 in ${run.to100.toFixed(1)} s as measured` : `${Math.round(run.fastest)} km/h in 12 s as measured`}, ${Math.round(want.top_kmh)} km/h as asked`)

  const look = per >= 4 ? [{ size: [w, h, d], per, low: [0, 0, 0], ...ran(cells) }] : undefined
  const living = { scheme: 'drive', motor, seats: [seat], eye, ...(look ? { look } : {}), facts }
  return { text: written({ name, size: [W, H, D], cm: 10, cells: body }, { living }), said, rolls, wheels: feet.length, front, unsure, facts, motor, run }
}

// ── The engine's own solver, here with no page (page/core.wasm) ─────────────────────────────────────
const H = 1 / 60, TOP_Y = 2400, X0 = 2000, Z0 = 2000
let wasm = null
/** A solver of the engine's own, with a level strip of asphalt laid high over its town, on which a body is driven flat out from standing. */
async function solver(file) {
  wasm ??= await WebAssembly.compile(readFileSync(file))
  return {
    /** How long it takes to reach 100 km/h from standing (null: not in 12 s). `all`: also whether it broke, and the fastest it went. */
    sprint(cells, size, motor, all = false) {
      const c = new WebAssembly.Instance(wasm, {}).exports
      const put = (Type, values) => { const room = c.edits_room(values.length); new Type(c.memory.buffer, room, values.length).set(values) }
      const f = FRONTS[motor.front], ahead = 3000, runs = []
      const lo = [X0 - 200 + Math.min(0, f[0] * ahead), Z0 - 200 + Math.min(0, f[1] * ahead)], hi = [X0 + 200 + Math.max(0, f[0] * ahead), Z0 + 200 + Math.max(0, f[1] * ahead)]
      for (let z = lo[1]; z < hi[1]; z++) runs.push(lo[0], hi[0], TOP_Y - 1, z, 6)
      for (let i = 0; i < runs.length; i += 5 * 3000) { const part = runs.slice(i, i + 5 * 3000); put(Int32Array, [1, part.length / 5, ...part]); c.world_edit(-1) }
      put(Int32Array, Int32Array.from(cells))
      const lift = Math.ceil(Math.max(0, ...motor.feet.map((ft) => ft.reach - ft.at[1])))
      c.living_spawn(size[0], size[1], size[2], X0 - (size[0] >> 1), TOP_Y + lift, Z0 - (size[2] >> 1), 0)
      const id = c.living_last()
      if (!id) return all ? { broke: true, to100: null, fastest: 0 } : null
      const n = Float32Array.from([motor.front, motor.grip, motor.power, motor.top, motor.steer, motor.hover, motor.lift, motor.upright, motor.turns, motor.jump, motor.tough, ...motor.feet.flatMap((ft) => [...ft.at, ft.reach, ft.steers ? 1 : 0, ft.drives ? 1 : 0])])
      put(Float32Array, n); c.living_motor(id, n.length)
      let pos = null, last = null, t = 0, to100 = null, fastest = 0, broke = false
      const step = (go) => {
        c.living_drive(id, go, 0, 0, 0, 0)
        const said = c.bodies_advance(H), words = new Uint32Array(c.memory.buffer, c.bodies_words(), said).slice(), fl = new Float32Array(words.buffer)
        for (let i = 0; i < words.length;) {
          const tag = words[i], k = words[i + 1], a = i + 2
          if (tag === 5) for (let j = a; j < a + k; j += 8) if (words[j] === id) pos = [fl[j + 1], fl[j + 2], fl[j + 3]]
          if (tag === 6) for (let j = a; j < a + k; j++) if (words[j] === id) broke = true
          i = a + k
        }
        t += H
      }
      for (let i = 0; i < 120; i++) step(0)
      const start = pos && [...pos]
      t = 0; last = start
      while (t < 12 && !broke) {
        step(1)
        if (pos && start && Math.hypot(pos[0] - start[0], pos[2] - start[2]) > ahead - 300) break
        if (!pos || !last) continue
        const v = ((pos[0] - last[0]) * f[0] + (pos[2] - last[2]) * f[1]) / H * KMH
        last = pos; fastest = Math.max(fastest, v)
        if (to100 === null && v >= 100) { to100 = t; if (!all) break }
      }
      return all ? { broke, to100, fastest } : to100
    },
  }
}
