// A thing as cells (#220): the third form of a reply, beside parts (form.mjs) and a program (program.mjs). Builds
// made from a picture arrive as cells already (a five-view sheet carved into a few hundred thousand cells), and a
// thing that was made once is kept as the cells it came to, so that it is never run again.
//
//   { "form": "cells", "name": "blue saloon car", "size": [w, h, d], "cm": 2.5,
//     "palette": [["steel", "15:5"], ["glass", "own"], ...],
//     "runs": "<base64>" }
//
// in the thing's own space, as a program's grid is: x from left to right as seen from its front, y up from the
// ground, z from the front (0) to the back. `cm` is the side of a cell: 10, 5, 2.5 or 1.25. At most 256 cells a
// side, 255 pairs of a material and a colour, each by name ("own", "white", "black", "grey:0" to "grey:14",
// "hue:tone"). `runs` is the grid in order (x fastest, then z, then y) as runs: each a count and which pair it is
// (0 is air, 1 the first pair), both as unsigned LEB128 numbers, the bytes in base64. A car of 257,000 cells is
// 23,000 runs, about 60 KB of text.
//
// It is data: nothing in it is run, no kind number is taken from it (a kind is built here from the names), and
// a key nobody named (form.mjs `field`) is refused. It is read, checked to be joined to the ground and kept like
// any reply. A thing of 5 cm cells stands in cells of 10 cm: the world's finer cells are 2.5 and 1.25 cm (#259),
// and 256 of 2.5 cm is 6.4 m, short of a bus.
import { FIELDS, MATERIALS, RECORD_FIELDS, colour, drivesOf } from './form.mjs'
import { alive } from './alive.mjs'

/** The cells a thing may be made of, in cm; the most along a side and the most text of runs. */
export const CMS = [10, 5, 2.5, 1.25], SIDE_MOST = 256, RUNS_MOST = 8 << 20
const KEYS = ['form', 'name', 'size', 'cm', 'palette', 'runs', 'living', 'drives']

export class Refused extends Error {}
export const refused = (e) => e instanceof Refused
const no = (why) => { throw new Refused(why) }
const whole = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi

/**
 * Reads a reply of cells. Resolves to { name, size, cm, cells, filled, crumbs, left, kept, record, extra } as a
 * program's thing is (program.mjs `shaped`), cut down to the box it fills, or throws `Refused` with why.
 * `joined`: it was proved joined to the ground when it was kept (library.mjs), and is not proved again.
 */
export function read(reply, { joined = false } = {}) {
  let got
  try { got = typeof reply === 'string' ? JSON.parse(reply) : reply } catch { no('the reply is not JSON') }
  if (!got || typeof got !== 'object' || Array.isArray(got) || got.form !== 'cells') no('a reply of cells is an object whose form is "cells"')
  for (const key of Object.keys(got)) if (!KEYS.includes(key) && !FIELDS.has(key)) no(`"${key.slice(0, 20)}" is not part of the form: only ${[...KEYS, ...FIELDS.keys()].join(', ')} are`)
  if (!CMS.includes(got.cm)) no(`cm is one of ${CMS.join(', ')}`)
  if (!Array.isArray(got.size) || got.size.length !== 3 || !got.size.every((v) => whole(v, 1, SIDE_MOST))) no(`size is [wide, high, deep], each 1 to ${SIDE_MOST} cells`)
  const all = unrun(got.runs, got.size[0] * got.size[1] * got.size[2], paletted(got.palette))
  // A living thing (make/alive.mjs): its cells are a body, not a thing that stands, so they are not held to the ground.
  if (got.living !== undefined && got.cm !== 10) no('a living thing\'s body is in the world\'s own cells: cm 10')
  const thing = got.living !== undefined ? body(all, got.size) : grounded(all, got.size, { joined })
  thing.name = typeof got.name === 'string' && got.name ? got.name.slice(0, 60) : 'a thing'
  thing.cm = got.cm
  // The other lanes' keys, each by its own check, as form.mjs reads them: kept as they came (`extra`), for keeping the thing again.
  thing.record = {}; thing.extra = {}
  // Meant to be driven (make/drivable.mjs): kept as it came, for keeping the thing again.
  if (got.drives !== undefined && got.living === undefined) { try { thing.drives = drivesOf(got.drives) } catch (e) { no(`"drives": ${e.message}`) } thing.extra.drives = got.drives }
  if (got.living !== undefined) {
    try { thing.living = alive(got.living, thing.size, thing.shift) } catch (e) { if (!(e instanceof Refused)) no(e.message); throw e }
    thing.extra.living = thing.living.raw
  }
  for (const [key, f] of FIELDS) {
    if (got[key] === undefined) continue
    let r
    try { r = f.check(got[key], thing) } catch (e) { thing.left.push(`"${key}": ${e.message}`); continue }
    for (const [name, value] of Object.entries(r ?? {})) { if (!RECORD_FIELDS.includes(name)) throw new Error(`the check of "${key}" returned "${name}", which is not a field of a thing's record`); thing.record[name] = value }
    thing.extra[key] = got[key]
  }
  return thing
}

/** A palette of named pairs as kinds: [0, the first pair's kind, ...]. Throws `Refused` for a name that is not one. */
export function paletted(palette) {
  if (!Array.isArray(palette) || !palette.length || palette.length > 255) no('palette is 1 to 255 pairs of a material and a colour')
  const kinds = [0]
  for (const pair of palette) {
    const [material, tint] = Array.isArray(pair) && pair.length === 2 ? pair : []
    if (!Object.hasOwn(MATERIALS, material) || material === 'air') no(`"${String(material).slice(0, 20)}" is not a material: ${Object.keys(MATERIALS).filter((m) => m !== 'air').join(', ')}`)
    const c = colour(tint)
    if (c < 0) no(`"${String(tint).slice(0, 20)}" is not a colour: "own", "white", "black", "grey:0" to "grey:14", or "hue:tone" with hue 0 to 23 and tone 0 to 9`)
    kinds.push(MATERIALS[material] | (c << 8))
  }
  return kinds
}

/** `runs` (base64 of LEB128 counts and pairs) as `n` kinds of a palette (`paletted`). Throws `Refused` if they do not fit. */
export function unrun(runs, n, kinds) {
  if (typeof runs !== 'string' || runs.length > RUNS_MOST || !/^[A-Za-z0-9+/]*={0,2}$/.test(runs)) no('runs is base64 text')
  const all = new Uint16Array(n), bytes = Buffer.from(runs, 'base64')
  let at = 0, k = 0
  const number = () => { let v = 0, shift = 0; for (;;) { if (at >= bytes.length || shift > 28) no('the runs end in the middle of a number'); const b = bytes[at++]; v += (b & 127) * 2 ** shift; if (b < 128) return v; shift += 7 } }
  while (at < bytes.length) {
    const c = number(), v = number()
    if (c > all.length - k || v >= kinds.length) no('the runs do not fit the size and the palette')
    if (v) all.fill(kinds[v], k, k + c)
    k += c
  }
  if (k !== all.length) no(`the runs cover ${k} cells and the size is ${all.length}`)
  return all
}

/** A living thing's body: cut down to the box it fills on every side (`shift` is how far its low corner moved), nothing asked of the ground. */
function body(all, [w, h, d]) {
  const lo = [w, h, d], hi = [0, 0, 0]
  let filled = 0
  for (let y = 0, i = 0; y < h; y++) for (let z = 0; z < d; z++) for (let x = 0; x < w; x++, i++) if (all[i]) { filled++; const p = [x, y, z]; for (let a = 0; a < 3; a++) { if (p[a] < lo[a]) lo[a] = p[a]; if (p[a] >= hi[a]) hi[a] = p[a] + 1 } }
  if (!filled) no('nothing was laid: every cell is air')
  const size = hi.map((v, a) => v - lo[a]), cells = new Uint16Array(size[0] * size[1] * size[2])
  for (let y = 0; y < size[1]; y++) for (let z = 0; z < size[2]; z++) { const from = ((y + lo[1]) * d + z + lo[2]) * w + lo[0]; cells.set(all.subarray(from, from + size[0]), (y * size[2] + z) * size[0]) }
  return { size, cells, filled, crumbs: 0, left: [], kept: 1, shift: lo }
}

/**
 * A grid of kinds as a thing: what touches nothing that reaches the ground is left out (unless `joined` says it was
 * proved already), and the grid is cut down to the box it fills, its foot kept at y 0. Throws `Refused` if nothing is
 * left. Returns { size, cells, filled, crumbs, left, kept }.
 */
export function grounded(all, [w, h, d], { joined = false } = {}) {
  let filled = 0
  for (let i = 0; i < all.length; i++) if (all[i]) filled++
  if (!filled) no('nothing was laid: every cell is air')
  let stands = filled
  const left = []
  if (!joined) {
    const seen = new Uint8Array(all.length), stack = new Int32Array(all.length), layer = w * d
    let top = 0
    for (let i = 0; i < layer; i++) if (all[i]) { seen[i] = 1; stack[top++] = i }
    if (!top) no('nothing of it touches the ground: something must reach y 0')
    stands = 0
    while (top) {
      const i = stack[--top], x = i % w, z = Math.floor(i / w) % d
      stands++
      const go = (j) => { if (all[j] && !seen[j]) { seen[j] = 1; stack[top++] = j } }
      if (x > 0) go(i - 1)
      if (x < w - 1) go(i + 1)
      if (z > 0) go(i - w)
      if (z < d - 1) go(i + w)
      if (i >= layer) go(i - layer)
      if (i + layer < all.length) go(i + layer)
    }
    const crumbs = filled - stands
    if (crumbs) for (let i = 0; i < all.length; i++) if (all[i] && !seen[i]) all[i] = 0
    if (crumbs > Math.max(40, filled / 50)) left.push(`${crumbs} of its ${filled} cells touch nothing that reaches the ground and were left out: every part must share a face with what holds it`)
  }
  // Cut down to the box it fills.
  const lo = [w, h, d], hi = [0, 0, 0]
  for (let y = 0, i = 0; y < h; y++) for (let z = 0; z < d; z++) for (let x = 0; x < w; x++, i++) if (all[i]) { if (x < lo[0]) lo[0] = x; if (x >= hi[0]) hi[0] = x + 1; if (y >= hi[1]) hi[1] = y + 1; if (z < lo[2]) lo[2] = z; if (z >= hi[2]) hi[2] = z + 1 }
  const size = [hi[0] - lo[0], hi[1], hi[2] - lo[2]]
  let cells = all
  if (size[0] !== w || size[1] !== h || size[2] !== d) {
    cells = new Uint16Array(size[0] * size[1] * size[2])
    for (let y = 0; y < size[1]; y++) for (let z = 0; z < size[2]; z++) { const from = (y * d + z + lo[2]) * w + lo[0]; cells.set(all.subarray(from, from + size[0]), (y * size[2] + z) * size[0]) }
  }
  return { size, cells, filled: stands, crumbs: filled - stands, left, kept: stands / filled }
}

/** The names of a kind, as a reply gives them: [material, colour]. */
const named = (kind) => {
  const material = Object.keys(MATERIALS).find((m) => MATERIALS[m] === (kind & 15)), c = kind >> 8
  return [material, c === 0 ? 'own' : c === 1 ? 'white' : c === 15 ? 'black' : c < 16 ? `grey:${c - 1}` : `${Math.floor((c - 16) / 10)}:${(c - 16) % 10}`]
}

/** A thing ({ name, size, cm, cells }) as a reply of cells: what is kept of a thing once it is made. `extra`: the lanes' keys it came with. */
export function written({ name, size, cm, cells }, extra = {}) {
  return JSON.stringify({ form: 'cells', name, size, cm, ...ran(cells), ...extra })
}

/** Kinds as a palette of named pairs and their runs, as a reply of cells has them. */
export function ran(cells) {
  const index = new Map(), palette = [], bytes = []
  const put = (v) => { while (v >= 128) { bytes.push((v % 128) | 128); v = Math.floor(v / 128) } bytes.push(v) }
  for (let k = 0; k < cells.length;) {
    const kind = cells[k]
    let end = k + 1
    while (end < cells.length && cells[end] === kind) end++
    let v = 0
    if (kind) { v = index.get(kind); if (v === undefined) { if (palette.length === 255) throw new Error('more than 255 kinds'); palette.push(named(kind)); v = palette.length; index.set(kind, v) } }
    put(end - k); put(v)
    k = end
  }
  return { palette, runs: Buffer.from(bytes).toString('base64') }
}
