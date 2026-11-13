// The form of a made thing (#220): what a model is asked to reply with, and the only reading of it.
//
// A reply is data. It is JSON of exactly this shape, and anything else is refused with the reason:
//
//   { "name": "market stall", "size": [w, h, d], "parts": [ part, ... ] }
//
// in cells of 10 cm, in the thing's own space: x from left to right as seen from its front, y up from the ground,
// z from the front (0) to the back. A part fills a box [x0, y0, z0, x1, y1, z1) (the high corner is not filled):
//
//   ["box",     material, colour, x0, y0, z0, x1, y1, z1]
//   ["stripes", material, colour, x0, y0, z0, x1, y1, z1, axis, width, colour2]   bands across "x", "y" or "z"
//   ["cyl",     material, colour, x0, y0, z0, x1, y1, z1, axis]                   a round bar along "x", "y" or "z"
//   ["ball",    material, colour, x0, y0, z0, x1, y1, z1]                         the round thing the box holds
//   ["wedge",   material, colour, x0, y0, z0, x1, y1, z1, falls, thick?]          a slope down towards "+x" "-x" "+z" "-z";
//                                                                                 with thick, only a sheet that many cells thick
//   ["text",    material, colour, x0, y0, z0, "WORDS"]                            letters 5 by 7 on the plane z0, read from the front
//
// Parts are laid in order and a later one replaces an earlier one where they meet; the material "air" cuts.
// No number of a kind is ever taken from a reply: a kind is built here from a named material and a named colour,
// so nothing a reply says can set a kind's other bits (rubble) or name water.

/** The materials a thing may be made of, by name (core/src/kinds.rs). Water is not one: it flows. */
export const MATERIALS = { air: 0, earth: 1, rock: 2, grass: 3, sand: 4, asphalt: 6, concrete: 7, brick: 8, plaster: 9, wood: 10, glass: 11, steel: 12, leaves: 13, roofing: 14, lamp: 15 }
/** The most a thing may be, in cells, and in parts. */
export const SIZE_MOST = [64, 80, 64], PARTS_MOST = 240
/** An edit is at most 65,536 whole numbers (serve.mjs `EDIT_MOST`): two to say rows follow and how many, five a row. */
/** How many cells that touch nothing may be left out of a thing without asking for it again. */
const CRUMBS = 12
export const ROWS_MOST = Math.floor((65536 - 2) / 5)

/** A colour of the palette by name: "own", "white", "black", "grey:0" to "grey:14" (white to black), or "hue:tone" (24 hues, ten tones). */
function colour(name) {
  if (name === 'own') return 0
  if (name === 'white') return 1
  if (name === 'black') return 15
  const m = typeof name === 'string' ? /^(grey|\d{1,2}):(\d{1,2})$/.exec(name) : null
  if (!m) return -1
  const tone = Number(m[2])
  if (m[1] === 'grey') return tone <= 14 ? 1 + tone : -1
  const hue = Number(m[1])
  return hue <= 23 && tone <= 9 ? 16 + hue * 10 + tone : -1
}

const FONT = {
  A: '01110 10001 10001 11111 10001 10001 10001', B: '11110 10001 10001 11110 10001 10001 11110', C: '01110 10001 10000 10000 10000 10001 01110',
  D: '11110 10001 10001 10001 10001 10001 11110', E: '11111 10000 10000 11110 10000 10000 11111', F: '11111 10000 10000 11110 10000 10000 10000',
  G: '01110 10001 10000 10111 10001 10001 01111', H: '10001 10001 10001 11111 10001 10001 10001', I: '11111 00100 00100 00100 00100 00100 11111',
  J: '00111 00010 00010 00010 00010 10010 01100', K: '10001 10010 10100 11000 10100 10010 10001', L: '10000 10000 10000 10000 10000 10000 11111',
  M: '10001 11011 10101 10101 10001 10001 10001', N: '10001 11001 10101 10011 10001 10001 10001', O: '01110 10001 10001 10001 10001 10001 01110',
  P: '11110 10001 10001 11110 10000 10000 10000', Q: '01110 10001 10001 10001 10101 10010 01101', R: '11110 10001 10001 11110 10100 10010 10001',
  S: '01111 10000 10000 01110 00001 00001 11110', T: '11111 00100 00100 00100 00100 00100 00100', U: '10001 10001 10001 10001 10001 10001 01110',
  V: '10001 10001 10001 10001 10001 01010 00100', W: '10001 10001 10001 10101 10101 11011 10001', X: '10001 10001 01010 00100 01010 10001 10001',
  Y: '10001 10001 01010 00100 00100 00100 00100', Z: '11111 00001 00010 00100 01000 10000 11111',
  0: '01110 10001 10011 10101 11001 10001 01110', 1: '00100 01100 00100 00100 00100 00100 01110', 2: '01110 10001 00001 00010 00100 01000 11111',
  3: '11110 00001 00001 01110 00001 00001 11110', 4: '00010 00110 01010 10010 11111 00010 00010', 5: '11111 10000 11110 00001 00001 10001 01110',
  6: '00110 01000 10000 11110 10001 10001 01110', 7: '11111 00001 00010 00100 01000 01000 01000', 8: '01110 10001 10001 01110 10001 10001 01110',
  9: '01110 10001 10001 01111 00001 00010 01100', ' ': '00000 00000 00000 00000 00000 00000 00000', '-': '00000 00000 00000 11111 00000 00000 00000',
  '!': '00100 00100 00100 00100 00100 00000 00100', '&': '01100 10010 10100 01000 10101 10010 01101', '.': '00000 00000 00000 00000 00000 00000 00100',
}

/**
 * What else a reply may hold (#243): the other lanes' parts of a thing, made by the model along with its cells.
 * A lane names a key of the reply, says in `brief` what the model is to put there (it is added to what the model
 * is told), and gives `check(value, thing)`: it returns what goes into the thing's record, as an object of any of
 * RECORD_FIELDS, or throws an Error whose message the model can be told. A key nobody has named is still refused.
 * What a check returns is data like the rest: the world's server keeps it as JSON and runs none of it.
 */
export const RECORD_FIELDS = ['parts', 'behaviour', 'controls', 'seats', 'sounds']
const FIELDS = new Map()
export function field(key, { brief, check }) {
  if (['name', 'size', 'parts'].includes(key) || !/^[a-z]{2,20}$/.test(key)) throw new Error(`"${key}" cannot be a key of a reply`)
  FIELDS.set(key, { brief, check })
}
/** What the model is told of the keys lanes have named, to go after the brief; nothing if there are none. */
export const fieldsBrief = () => [...FIELDS].map(([key, f]) => `\n\n"${key}" (a further key of the reply)\n${f.brief}`).join('')

class Refused extends Error {}
const no = (why) => { throw new Refused(why) }
const whole = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi
const AXES = { x: 0, y: 1, z: 2 }

/**
 * Reads a reply: the cells of the thing as kinds in a grid of its own size, and which part put each.
 * Throws `Refused` with the reason, in words the model can be told, if the reply is anything but the form.
 * `lenient`: what can be left out is left out and said in `left` (words round the JSON, a key or a part that is not
 * the form's, cells that touch nothing), and only a reply nothing can be made of is refused. Lenient or not, a reply
 * is data: nothing in it is run, and no kind is taken from it.
 */
export function read(reply, { lenient = false } = {}) {
  let text = String(reply).trim()
  /** What was left out of a reply read leniently, in words the model can be told if it is asked again. */
  const left = []
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/.exec(text)
  if (fenced) text = fenced[1]
  let thing
  try { thing = JSON.parse(text) } catch {
    // Words round it: read leniently, the object among them is taken.
    const a = text.indexOf('{'), b = text.lastIndexOf('}')
    try { if (!lenient || a < 0 || b <= a) throw 0; thing = JSON.parse(text.slice(a, b + 1)); left.push('there were words round the JSON') } catch { no('the reply is not JSON alone') }
  }
  if (!thing || typeof thing !== 'object' || Array.isArray(thing)) no('the reply is not an object')
  for (const key of Object.keys(thing)) if (!['name', 'size', 'parts'].includes(key) && !FIELDS.has(key)) if (lenient) left.push(`"${key.slice(0, 20)}" is not part of the form`); else no(`"${key.slice(0, 20)}" is not part of the form: only ${['name', 'size', 'parts', ...FIELDS.keys()].join(', ')} are`)
  if (typeof thing.name !== 'string' || !thing.name || thing.name.length > 60) { if (lenient) thing.name = typeof thing.name === 'string' && thing.name ? thing.name.slice(0, 60) : 'a thing'; else no('name is a few words') }
  const size = thing.size
  if (!Array.isArray(size) || size.length !== 3 || !size.every((v, a) => whole(v, 1, SIZE_MOST[a]))) no(`size is [wide, high, deep] in cells, at most ${SIZE_MOST.join(' by ')}`)
  if (lenient && Array.isArray(thing.parts) && thing.parts.length > PARTS_MOST) { left.push(`parts after the first ${PARTS_MOST}`); thing.parts = thing.parts.slice(0, PARTS_MOST) }
  if (!Array.isArray(thing.parts) || !thing.parts.length || thing.parts.length > PARTS_MOST) no(`parts is a list of 1 to ${PARTS_MOST}`)
  const [w, h, d] = size
  const cells = new Uint16Array(w * h * d), by = new Uint16Array(w * h * d)
  let skipped = 0
  const lay = (part, n) => {
    const bad = (why) => no(`part ${n + 1} (${JSON.stringify(part).slice(0, 70)}): ${why}`)
    if (!Array.isArray(part) || part.length < 7 || part.length > 12) bad('a part is a list: shape, material, colour, then its numbers')
    const [shape, material, tint] = part
    if (!Object.hasOwn(MATERIALS, material)) bad(`"${String(material).slice(0, 20)}" is not a material: ${Object.keys(MATERIALS).join(', ')}`)
    const c = material === 'air' ? 0 : colour(tint)
    if (c < 0) bad(`"${String(tint).slice(0, 20)}" is not a colour: "own", "white", "black", "grey:0" to "grey:14", or "hue:tone" with hue 0 to 23 and tone 0 to 9`)
    const kind = MATERIALS[material] | (c << 8)
    const put = (x, y, z, k = kind) => { const i = (y * d + z) * w + x; cells[i] = k; by[i] = n + 1 }
    if (shape === 'text') {
      if (part.length !== 7) bad('text is ["text", material, colour, x0, y0, z0, "WORDS"]')
      const [x0, y0, z0, words] = part.slice(3)
      if (typeof words !== 'string' || !words || words.length > 12 || ![...words].every((ch) => Object.hasOwn(FONT, ch))) bad('the words are 1 to 12 of A to Z, 0 to 9, space and - ! & .')
      if (!whole(x0, 0, w - (words.length * 6 - 1)) || !whole(y0, 0, h - 7) || !whole(z0, 0, d - 1)) bad(`these words are ${words.length * 6 - 1} cells wide and 7 high from x0, y0, and must lie within the size`)
      ;[...words].forEach((ch, at) => FONT[ch].split(' ').forEach((bits, row) => { for (let col = 0; col < 5; col++) if (bits[col] === '1') put(x0 + at * 6 + col, y0 + 6 - row, z0) }))
      return
    }
    const box = part.slice(3, 9)
    if (box.length !== 6 || !box.every((v) => Number.isInteger(v))) bad('a box is six whole numbers: x0, y0, z0, x1, y1, z1')
    const [x0, y0, z0, x1, y1, z1] = box
    if (!(x0 >= 0 && y0 >= 0 && z0 >= 0 && x1 <= w && y1 <= h && z1 <= d && x0 < x1 && y0 < y1 && z0 < z1)) bad(`its box must lie within the size (${w}, ${h}, ${d}) and run from a low corner to a higher one`)
    const more = part.slice(9)
    const each = (keep) => { for (let y = y0; y < y1; y++) for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) { const k = keep(x, y, z); if (k !== false) put(x, y, z, k === true ? kind : k) } }
    if (shape === 'box') { if (more.length) bad('a box has nothing after its numbers'); each(() => true) }
    else if (shape === 'stripes') {
      const [axis, width, tint2] = more, c2 = colour(tint2)
      if (more.length !== 3 || !Object.hasOwn(AXES, axis) || !whole(width, 1, 64) || c2 < 0 || material === 'air') bad('stripes end with an axis ("x", "y" or "z"), a width in cells and a second colour')
      const other = MATERIALS[material] | (c2 << 8), lo = [x0, y0, z0][AXES[axis]]
      each((x, y, z) => (Math.floor(([x, y, z][AXES[axis]] - lo) / width) % 2 ? other : kind))
    } else if (shape === 'cyl' || shape === 'ball') {
      const axis = shape === 'cyl' ? more[0] : null
      if (more.length !== (shape === 'cyl' ? 1 : 0) || (shape === 'cyl' && !Object.hasOwn(AXES, axis))) bad(shape === 'cyl' ? 'a cyl ends with its axis: "x", "y" or "z"' : 'a ball has nothing after its numbers')
      const mid = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], half = [(x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2]
      each((x, y, z) => { let sum = 0; [x, y, z].forEach((v, a) => { if (a !== AXES[axis]) sum += ((v + 0.5 - mid[a]) / half[a]) ** 2 }); return sum <= 1.0001 })
    } else if (shape === 'wedge') {
      const [falls, thick] = more
      if (more.length < 1 || more.length > 2 || !['+x', '-x', '+z', '-z'].includes(falls) || (thick !== undefined && !whole(thick, 1, 64))) bad('a wedge ends with the way it falls ("+x", "-x", "+z" or "-z") and, for a sheet, how thick')
      const along = falls[1] === 'x' ? [x0, x1] : [z0, z1], long = along[1] - along[0], tall = y1 - y0
      // The top of the column `step` cells from the high end: the whole height there, one cell at the low end.
      const top = (step) => y0 + Math.max(1, Math.round(tall - (step * (tall - 1)) / Math.max(1, long - 1)))
      each((x, y, z) => {
        const v = falls[1] === 'x' ? x : z, step = falls[0] === '+' ? v - along[0] : along[1] - 1 - v
        // A sheet reaches down to a cell under the top of the next column, so each step shares a face with the last.
        const under = thick === undefined ? y0 : Math.max(y0, Math.min(top(step) - thick, step + 1 < long ? top(step + 1) - 1 : top(step) - thick))
        return y < top(step) && y >= under
      })
    } else bad(`"${String(shape).slice(0, 20)}" is not a shape: box, stripes, cyl, ball, wedge, text`)
  }
  // Read leniently, a part that is not one is left out and the rest is laid.
  thing.parts.forEach((part, n) => { try { lay(part, n) } catch (e) { if (!lenient || !(e instanceof Refused)) throw e; skipped++; left.push(e.message) } })
  const filled = cells.reduce((n, k) => n + (k ? 1 : 0), 0)
  if (!filled) no('nothing is left of it: every cell is air')
  // It must stand: every cell joined, face to face, to a cell on the ground. (Whether the joins carry it is the
  // core's rule, asked before it is sent: place.mjs.)
  const seen = new Uint8Array(cells.length), stack = []
  for (let i = 0; i < w * d; i++) if (cells[i]) { seen[i] = 1; stack.push(i) }
  if (!stack.length) no('nothing of it touches the ground: something must reach y 0')
  const steps = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
  while (stack.length) {
    const i = stack.pop(), x = i % w, z = Math.floor(i / w) % d, y = Math.floor(i / (w * d))
    for (const [dx, dy, dz] of steps) {
      const nx = x + dx, ny = y + dy, nz = z + dz
      if (nx < 0 || ny < 0 || nz < 0 || nx >= w || ny >= h || nz >= d) continue
      const j = (ny * d + nz) * w + nx
      if (cells[j] && !seen[j]) { seen[j] = 1; stack.push(j) }
    }
  }
  const loose = new Map()
  let crumbs = 0
  for (let i = 0; i < cells.length; i++) if (cells[i] && !seen[i]) { loose.set(by[i], (loose.get(by[i]) ?? 0) + 1); crumbs++ }
  // A few stray cells (the rim of a round thing one cell thick, a knob a cell off) are left out, and said so: they
  // would only fall as crumbs. More than that is a part in the wrong place, and the model is told which.
  if (crumbs > Math.max(CRUMBS, filled / 100)) (lenient ? (why) => left.push(why) : no)(`it would not stand: ${[...loose].slice(0, 6).map(([n, count]) => `${count} cells of part ${n} (${JSON.stringify(thing.parts[n - 1]).slice(0, 60)})`).join('; ')} touch nothing that reaches the ground. Parts must share a face with what holds them`)
  if (crumbs) for (let i = 0; i < cells.length; i++) if (cells[i] && !seen[i]) cells[i] = 0
  if (lenient && filled - crumbs <= 0) no('nothing of it reaches the ground')
  // `left` says what a lenient reading left out; `kept` how much of what the reply described is still there, 0 to 1.
  const out = { name: thing.name, size, cells, by, filled: filled - crumbs, crumbs, parts: thing.parts.length, said: thing.parts, record: {}, left, kept: (1 - skipped / thing.parts.length) * ((filled - crumbs) / filled) }
  // The other lanes' keys, each by its own check, last: a check may ask what the cells are.
  for (const [key, f] of FIELDS) {
    if (thing[key] === undefined) continue
    let got
    try { got = f.check(thing[key], out) } catch (e) { if (lenient) { left.push(`"${key}": ${e.message}`); continue } no(`"${key}": ${e.message}`) }
    for (const [name, value] of Object.entries(got ?? {})) { if (!RECORD_FIELDS.includes(name)) throw new Error(`the check of "${key}" returned "${name}", which is not a field of a thing's record`); out.record[name] = value }
  }
  return out
}
export const refused = (e) => e instanceof Refused

/** Which way a thing's front may face, and where its own x and z go in the world for each (x east, z south). */
export const FACINGS = { south: [1, 0, 0, -1], north: [-1, 0, 0, 1], east: [0, -1, -1, 0], west: [0, 1, 1, 0] }

/**
 * The thing in the world: rows of cells [x0, x1, y, z, kind], sorted by y, then z, then x, with its front facing
 * `facing`, the middle of its footprint at x, z and its lowest cells at y `base`. `feet(x, z)` says how high the
 * surface under a column is: a lowest cell is carried down to stand on it, as a parked car's wheels are.
 */
export function rows(thing, [x, base, z], facing, feet = () => base - 1) {
  const [w, h, d] = thing.size, [xx, xz, zx, zz] = FACINGS[facing]
  const at = new Map()
  const put = (wx, wy, wz, kind, part) => at.set(`${wy},${wz},${wx}`, [wx, wy, wz, kind, part])
  for (let ly = 0; ly < h; ly++) for (let lz = 0; lz < d; lz++) for (let lx = 0; lx < w; lx++) {
    const kind = thing.cells[(ly * d + lz) * w + lx], part = thing.by[(ly * d + lz) * w + lx]
    if (!kind) continue
    const cx = lx - (w >> 1), cz = lz - (d >> 1)
    const wx = x + cx * xx + cz * xz, wz = z + cx * zx + cz * zz
    put(wx, base + ly, wz, kind, part)
    if (ly === 0) for (let y = feet(wx, wz) + 1; y < base; y++) put(wx, y, wz, kind, part)
  }
  const cells = [...at.values()].sort((a, b) => a[1] - b[1] || a[2] - b[2] || a[0] - b[0])
  // `from` says which part each row's first cell came of: for telling a model what of its thing fell.
  const out = [], from = []
  for (const [wx, wy, wz, kind, part] of cells) {
    const last = out.at(-1)
    if (last && last[2] === wy && last[3] === wz && last[1] === wx && last[4] === kind) last[1]++
    else { out.push([wx, wx + 1, wy, wz, kind]); from.push(part) }
  }
  return Object.assign(out, { from })
}

/** Where a thing's footprint lies in the world: every column it has a cell in, and which of them it stands on. */
export function footprint(thing, [x, z], facing) {
  const [w, h, d] = thing.size, [xx, xz, zx, zz] = FACINGS[facing], out = []
  for (let lz = 0; lz < d; lz++) for (let lx = 0; lx < w; lx++) {
    let any = false
    for (let ly = 0; ly < h && !any; ly++) any = thing.cells[(ly * d + lz) * w + lx] !== 0
    if (!any) continue
    const cx = lx - (w >> 1), cz = lz - (d >> 1)
    out.push({ x: x + cx * xx + cz * xz, z: z + cx * zx + cz * zz, foot: thing.cells[lz * w + lx] !== 0 })
  }
  return out
}
