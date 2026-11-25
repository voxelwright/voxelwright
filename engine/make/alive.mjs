// A living thing as a reply (#245): a reply of cells (make/cells.mjs) whose cells are a body that lives, driven
// from its seat. Beside the body's own cells of 10 cm it carries what makes it live, under `living`:
//
//   { "form": "cells", "name": "BMW X3", "size": [47, 18, 22], "cm": 10, "palette": [...], "runs": "...",
//     "living": {
//       "scheme": "drive",                                 drive, fly, hover or ride (page/living.ts SCHEMES)
//       "motor": { "front": 0, "grip": 0.88, ..., "feet": [{ "at": [x, y, z], "reach": 5.9, "steers": true, "drives": true }] },
//       "seats": [[x, y, z], ...], "eye": [x, y, z],       where riders sit and the driver's eye
//       "look": [{ "size": [w, h, d], "per": 4, "low": [x, y, z], "palette": [...], "runs": "..." }],
//       "facts": { "asked": { "top_kmh": 240, ... }, "measured": { "zero_to_100_s": 6.32, ... } } } }
//
// Everything is in the body's own cells from its low corner, as the solver takes it (page/living.ts `Controls`):
// x, then z, then y, its front along the motor's `front`. A part of the look is laid the same way in cells `per` to
// one of the body's (4 or 8), named by material and colour as the body is: no kind number is taken from it. What a
// look may be is what a page will draw (page/living.ts `fineWithin`, `FINE_FILLED`); the core clamps the motor's
// numbers; places are held near the body. `facts` are numbers a card or a rule may say ("0 to 100 in 6.3 s").
//
// It is data like any reply: nothing in it is run. The maker stands the body as the thing's cells with `controls` in
// its record, sends each part of the look to the world first (`POST /world/fine`, kept by its sha256) so that the
// record says where they are, and the world brings it to life.
import { FINE_FILLED, FINE_PARTS, controlsOf, fineWithin } from '../page/living.ts'
import { paletted, unrun } from './cells.mjs'
import { FACINGS } from './form.mjs'

/** The most a living body is along a side (world.mjs `grid`), how far outside its box a place on it may be (cells), and the most JSON its facts are. */
export const BODY_MOST = 96, OUT_MOST = 8, FACTS_MOST = 1024
const KEYS = ['scheme', 'motor', 'seats', 'eye', 'look', 'facts'], PART_KEYS = ['size', 'per', 'low', 'palette', 'runs']
const no = (why) => { throw new Error(why) }
const finite = (v, n) => Array.isArray(v) && v.length === n && v.every((x) => typeof x === 'number' && Number.isFinite(x))
const near = (p, size, out = OUT_MOST) => p.every((v, a) => v >= -out && v <= size[a] + out)
const less = (p, by) => p.map((v, a) => v - by[a])

/** What a thing's facts may be: `asked` and `measured`, each up to 16 names (snake_case) of numbers. Or why not. */
export function factsOf(f) {
  if (!f || typeof f !== 'object' || Array.isArray(f)) no('facts are { asked, measured }: names of numbers')
  const out = {}
  for (const [key, v] of Object.entries(f)) {
    if (key !== 'asked' && key !== 'measured') no(`"${key.slice(0, 20)}" is not part of facts: asked and measured are`)
    if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).length > 16) no(`facts.${key} is up to 16 names of numbers`)
    for (const [name, n] of Object.entries(v)) if (!/^[a-z][a-z0-9_]{0,31}$/.test(name) || typeof n !== 'number' || !Number.isFinite(n)) no(`facts.${key}.${name.slice(0, 32)} is a number, named in lower case`)
    out[key] = v
  }
  if (JSON.stringify(out).length > FACTS_MOST) no(`facts are at most ${FACTS_MOST} bytes`)
  return out
}

/**
 * Reads a reply's `living` for a body of `size` cut down by `shift` (its low corner moved so far: every place is
 * moved with it). Returns { scheme, motor, seats, eye, look: [{ size, per, low, kinds, filled }], facts, raw }:
 * `raw` is `living` as it would be written for the cut-down body. Throws an Error with why.
 */
export function alive(living, size, shift = [0, 0, 0]) {
  if (!living || typeof living !== 'object' || Array.isArray(living)) no('living is an object: scheme, motor, seats, eye, look, facts')
  for (const key of Object.keys(living)) if (!KEYS.includes(key)) no(`"${key.slice(0, 20)}" is not part of living: only ${KEYS.join(', ')} are`)
  if (!size.every((v) => v <= BODY_MOST)) no(`a living body is at most ${BODY_MOST} cells along a side`)
  const c = controlsOf({ scheme: living.scheme, motor: living.motor })
  if (!c) no('living has a scheme (drive, fly, hover or ride) and a motor: front, grip, power, top, steer, hover, lift, upright, turns, jump, tough (numbers) and up to 16 feet, each { at: [x, y, z], reach, steers, drives }')
  if (!c.motor.feet.every((f) => near(less(f.at, shift), size) && f.reach >= 0 && f.reach <= 32)) no(`a foot is at most ${OUT_MOST} cells outside the body and reaches 0 to 32 cells`)
  if (![0, 1, 2, 3].includes(c.motor.front)) no('a motor\'s front is 0, 1, 2 or 3: which way it faces in its own cells (+x, -x, +z, -z)')
  const motor = { ...c.motor, feet: c.motor.feet.map((f) => ({ ...f, at: less(f.at, shift) })) }
  let seats, eye
  if (living.seats !== undefined) { if (!Array.isArray(living.seats) || living.seats.length > 8 || !living.seats.every((s) => finite(s, 3) && near(less(s, shift), size))) no(`seats are up to 8 places [x, y, z] on the body`); seats = living.seats.map((s) => less(s, shift)) }
  if (living.eye !== undefined) { if (!finite(living.eye, 3) || !near(less(living.eye, shift), size, OUT_MOST + 12)) no('eye is a place [x, y, z] on the body'); eye = less(living.eye, shift) }
  const look = []
  if (living.look !== undefined) {
    if (!Array.isArray(living.look) || living.look.length > FINE_PARTS) no(`a look is up to ${FINE_PARTS} parts`)
    for (const p of living.look) {
      if (!p || typeof p !== 'object' || Array.isArray(p)) no('a part of a look is { size, per, low, palette, runs }')
      for (const key of Object.keys(p)) if (!PART_KEYS.includes(key)) no(`"${key.slice(0, 20)}" is not part of a look's part: only ${PART_KEYS.join(', ')} are`)
      if (p.per !== 4 && p.per !== 8) no('a part of a look has 4 or 8 of its cells along one of the body\'s (per)')
      if (!Array.isArray(p.size) || p.size.length !== 3 || !p.size.every((v) => Number.isInteger(v) && v >= 1 && v <= 1023)) no('a part of a look is [wide, high, deep], each 1 to 1023 cells')
      if (!finite(p.low, 3)) no('a part of a look has its low corner on the body (low: [x, y, z])')
      const low = less(p.low, shift), high = low.map((v, a) => v + p.size[a] / p.per)
      if (!near(low, size) || !near(high, size)) no(`a part of a look lies on the body: at most ${OUT_MOST} cells outside it`)
      look.push({ size: p.size, per: p.per, low, palette: p.palette, runs: p.runs })
    }
    if (!fineWithin(look)) no('a look is more cells than a page will draw: at most 8 million in a part and 12 million in all')
  }
  let filled = 0
  for (const p of look) {
    p.kinds = kindsOf(p)
    let n = 0
    for (let i = 0; i < p.kinds.length; i++) if (p.kinds[i]) n++
    p.filled = n; filled += n
  }
  if (filled > FINE_FILLED) no(`a look is at most ${FINE_FILLED} filled cells (it has ${filled})`)
  const facts = living.facts === undefined ? undefined : factsOf(living.facts)
  const moved = shift.some((v) => v !== 0)
  const raw = !moved ? living : { ...living, motor: { ...living.motor, feet: motor.feet.map((f, i) => ({ ...living.motor.feet[i], at: f.at })) }, ...(seats ? { seats } : {}), ...(eye ? { eye } : {}), ...(look.length ? { look: look.map((p) => ({ size: p.size, per: p.per, low: p.low, palette: p.palette, runs: p.runs })) } : {}) }
  return { scheme: c.scheme, motor, seats, eye, look: look.map(({ size, per, low, kinds, filled }) => ({ size, per, low, kinds, filled })), facts, raw }
}

// A part's cells are read once for each text of them (a kept car is made over and over): by the text itself.
const read = new Map()
const remember = (map, key, value, most) => { map.set(key, value); if (map.size > most) map.delete(map.keys().next().value); return value }
function kindsOf(p) {
  const key = `${p.size.join()} ${JSON.stringify(p.palette ?? null)} ${String(p.runs)}`
  const was = read.get(key)
  if (was) return was
  return remember(read, key, unrun(p.runs, p.size[0] * p.size[1] * p.size[2], paletted(p.palette)), 8)
}

// ── Turned to face (#245) ───────────────────────────────────────────────
// A thing made faces whoever asked (make.mjs `towards`). A living thing is turned for that whole, by quarter turns
// about the up, as a body is turned: its cells, its motor's front and feet, its seats, its eye and its look. (The
// placing's own turn, form.mjs FACINGS, mirrors what it lays as well: a car so laid would be driven from the
// wrong side.) Its look's cells are big, so each part is turned once for each way and kept.

/** The way each front points along the ground (x, z), and each facing. */
const FRONTS = [[1, 0], [-1, 0], [0, 1], [0, -1]], WAYS = { east: [1, 0], west: [-1, 0], south: [0, 1], north: [0, -1] }
/** A quarter turn about the up: (x, z) to (d - z, x) in a box d deep. A front's way turns as (x, z) to (-z, x). */
const quarter = (p, d) => [d - p[2], p[1], p[0]]
const frontAfter = (front) => [2, 3, 1, 0][front]
/** Cells laid (y * d + z) * w + x, turned `k` quarter turns: [cells, size]. */
export function spun(kinds, [w, h, d], k) {
  if (!k) return [kinds, [w, h, d]]
  const W = k === 2 ? w : d, D = k === 2 ? d : w, out = new Uint16Array(kinds.length)
  for (let y = 0; y < h; y++) for (let z = 0; z < d; z++) {
    const row = (y * d + z) * w
    for (let x = 0; x < w; x++) {
      const v = kinds[row + x]
      if (!v) continue
      const nx = k === 1 ? d - 1 - z : k === 2 ? w - 1 - x : z, nz = k === 1 ? x : k === 2 ? d - 1 - z : w - 1 - x
      out[(y * D + nz) * W + nx] = v
    }
  }
  return [out, [W, h, D]]
}

const turnedLooks = new Map()
/**
 * A living thing (as cells.mjs reads it, with `living`) turned to face `facing`. Returns, kept on the thing:
 * { body: the thing as the placing lays it (form.mjs `rows`, which mirrors: so its cells are laid mirrored here, and
 * come out turned), size and cells: the turned body in the world's axes, k: how many quarter turns, low: where the turned body's low corner is from the place it stands ([x, 0, z], world cells),
 * lift: how far over the ground it is set so that its feet just touch it, controls: the record's (without the
 * look), look: the turned parts [{ size, per, low, kinds }] }.
 */
export function turned(thing, facing) {
  thing.turns ??= new Map()
  if (thing.turns.has(facing)) return thing.turns.get(facing)
  const L = thing.living, want = WAYS[facing]
  let k = 0, front = L.motor.front
  while (k < 4 && (FRONTS[front][0] !== want[0] || FRONTS[front][1] !== want[1])) { front = frontAfter(front); k++ }
  if (k === 4) k = 0
  // The body, its places and its look, a quarter turn at a time.
  let size = thing.size, cells = thing.cells, feet = L.motor.feet.map((f) => f.at), seats = L.seats, eye = L.eye, lows = L.look.map((p) => p.low), sizes = L.look.map((p) => p.size)
  for (let i = 0; i < k; i++) {
    const d = size[2]
    feet = feet.map((p) => quarter(p, d)); seats = seats?.map((p) => quarter(p, d)); eye = eye && quarter(eye, d)
    lows = lows.map((p, j) => quarter([p[0], p[1], p[2] + sizes[j][2] / L.look[j].per], d)); sizes = sizes.map((s) => [s[2], s[1], s[0]])
    size = [size[2], size[1], size[0]]
  }
  ;[cells] = spun(cells, thing.size, k)
  const look = L.look.map((p, j) => {
    let hit = turnedLooks.get(p.kinds)?.get(k)
    if (!hit) {
      const [kinds, s] = spun(p.kinds, p.size, k)
      hit = { kinds, size: s }
      if (!turnedLooks.has(p.kinds)) remember(turnedLooks, p.kinds, new Map(), 8)
      turnedLooks.get(p.kinds).set(k, hit)
    }
    return { size: hit.size, per: p.per, low: lows[j], kinds: hit.kinds, filled: p.filled }
  })
  // As the placing lays it: a cell of its own (lx, lz) goes to (cx * xx + cz * xz, cx * zx + cz * zz) from where it
  // stands, cx and cz from its middle. So the cells it is given are the turned body's, read back through that.
  const [xx, xz, zx, zz] = FACINGS[facing], [GW, h, GD] = size, w = xx !== 0 ? GW : GD, d = xx !== 0 ? GD : GW
  const off = (lx, lz) => { const cx = lx - (w >> 1), cz = lz - (d >> 1); return [cx * xx + cz * xz, cx * zx + cz * zz] }
  let minx = Infinity, minz = Infinity
  for (const [lx, lz] of [[0, 0], [w - 1, 0], [0, d - 1], [w - 1, d - 1]]) { const [ox, oz] = off(lx, lz); minx = Math.min(minx, ox); minz = Math.min(minz, oz) }
  const laid = new Uint16Array(cells.length)
  for (let y = 0; y < h; y++) for (let lz = 0; lz < d; lz++) for (let lx = 0; lx < w; lx++) { const [ox, oz] = off(lx, lz); laid[(y * d + lz) * w + lx] = cells[(y * GD + oz - minz) * GW + ox - minx] }
  // Set over the ground by as much as its feet reach under it, so that they just touch it.
  const lift = Math.max(0, Math.min(OUT_MOST, Math.ceil(Math.max(0, ...L.motor.feet.map((f) => f.reach - f.at[1])))))
  const motor = { ...L.motor, front, feet: L.motor.feet.map((f, i) => ({ ...f, at: feet[i] })) }
  const controls = { scheme: L.scheme, motor, ...(seats ? { seats, size } : {}), ...(eye ? { eye } : {}) }
  const out = { body: { ...thing, size: [w, h, d], cells: laid, by: new Uint16Array(laid.length) }, low: [minx, 0, minz], lift, size, cells, k, controls, look }
  thing.turns.set(facing, out)
  return out
}
