// The things in the city that start the easter eggs (#450, eggs.ts): found, not typed. Each is a small model of the
// engine's own cells (quarters of the world's, as the signal heads in street.ts are), drawn as a piece (pieces.ts) where
// it stands, and offered the way the city offers anything usable: a cue beside it (hud.ts `cue`) that a tap or a click
// does, and E while one is near enough to reach. A click or the Use key with the aim on one does it too (eggs.ts).
//
// Nothing here says what an egg is: eggs.ts gives each thing its words and what using it does. Nothing is fetched: the
// models are made from these lines once the park is shown (main.ts imports eggs.ts then).
import type { Hud } from './hud.ts'
import type { Input } from './input.ts'
import type { View } from './march.ts'
import type { Piece, Pieces } from './pieces.ts'
import type { Born } from './told.ts'
import { faces } from './fine.ts'
import { POLISHED } from './spells.ts'

export type ThingId = 'payphone' | 'jukebox' | 'cart' | 'arcade' | 'viewer' | 'plane' | 'shield' | 'tv'

/** A model's cells in quarters of the world's (2.5 cm): its foot's middle is where it stands, its front is +z. */
const PER = 4
/** How near the feet (or the eye, flying) must be to use a thing, world cells past its own half-width; how far off the aim may use it. */
const REACH = 22, AIM = 70
/** Drawn within this many world cells of the eye, in view. */
const DRAWN = 2400

// The core's kinds (kinds.rs): a material in the low four bits, a colour in the high byte.
const WOOD = 10, GLASS = 11, STEEL = 12, ROOFING = 14, LAMP = 15, PLASTER = 9, CONCRETE = 7
const grey = (step: number) => 1 + Math.min(14, step)
const hue = (h: number, tone: number) => 16 + (h % 24) * 10 + tone
const k = (material: number, colour: number) => material | (colour << 8)

/** A box of cells to carve a model from. */
class Cells {
  readonly cells: Uint16Array
  readonly w: number
  readonly h: number
  readonly d: number
  constructor(w: number, h: number, d: number) { this.w = w; this.h = h; this.d = d; this.cells = new Uint16Array(w * h * d) }
  set(x: number, y: number, z: number, v: number) { if (x >= 0 && y >= 0 && z >= 0 && x < this.w && y < this.h && z < this.d) this.cells[(y * this.d + z) * this.w + x] = v }
  get(x: number, y: number, z: number) { return x >= 0 && y >= 0 && z >= 0 && x < this.w && y < this.h && z < this.d ? this.cells[(y * this.d + z) * this.w + x] : 0 }
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, v: number) { for (let y = y0; y < y1; y++) for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) this.set(x, y, z, v) }
  /** Every cell whose middle `inside` takes, in a box, set to what `kind` gives for it (0 leaves it). */
  each(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, kind: (x: number, y: number, z: number) => number) {
    for (let y = y0; y < y1; y++) for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) { const v = kind(x + 0.5, y + 0.5, z + 0.5); if (v) this.set(x, y, z, v) }
  }
  ball(cx: number, cy: number, cz: number, r: number, v: number) { this.each(Math.floor(cx - r), Math.ceil(cx + r), Math.floor(cy - r), Math.ceil(cy + r), Math.floor(cz - r), Math.ceil(cz + r), (x, y, z) => ((x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2 <= r * r ? v : 0)) }
  /** A post standing up: a round of radius r about (cx, cz). */
  post(cx: number, cz: number, r: number, y0: number, y1: number, v: number) { this.each(Math.floor(cx - r), Math.ceil(cx + r), y0, y1, Math.floor(cz - r), Math.ceil(cz + r), (x, _, z) => ((x - cx) ** 2 + (z - cz) ** 2 <= r * r ? v : 0)) }
  born(): Born {
    let n = 0
    for (const c of this.cells) if (c) n++
    return { id: 0, cells: n, size: [this.w, this.h, this.d], com: [this.w / 2, 0, this.d / 2], low: [0, 0, 0], faces: faces(this.cells, [this.w, this.h, this.d]) }
  }
}

// ── The models ──

/** A payphone on its post, its sign green while it rings (`ringing`: the sign lit). */
function payphone(ringing: boolean): Born {
  const m = new Cells(28, 90, 22)
  const POST = k(STEEL, grey(8)), BODY = k(STEEL, grey(10)), FACE = k(STEEL, grey(4)), BLACK = k(ROOFING, grey(14)), KEY = k(PLASTER, grey(1))
  m.box(4, 24, 0, 2, 3, 19, k(CONCRETE, grey(6)))
  m.box(11, 17, 2, 46, 8, 14, POST)
  // The housing, its hood, and the sign along the hood's front.
  m.box(3, 25, 44, 80, 4, 18, BODY)
  m.box(1, 27, 80, 85, 2, 20, BODY)
  m.box(3, 25, 81, 84, 20, 21, ringing ? k(LAMP, hue(8, 3)) : k(STEEL, hue(8, 6)))
  m.box(5, 23, 46, 78, 18, 19, FACE)
  // A little screen, the keys, the coin slot and the return.
  m.box(8, 20, 69, 74, 19, 20, ringing ? k(LAMP, hue(8, 2)) : k(GLASS, hue(8, 6)))
  for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) m.box(9 + c * 4, 11 + c * 4, 51 + r * 4, 53 + r * 4, 19, 20, KEY)
  m.box(20, 22, 62, 68, 19, 20, BLACK)
  m.box(20, 23, 50, 53, 19, 20, BLACK)
  // The handset in its cradle on the left, and its cord.
  m.box(3, 6, 52, 76, 18, 21, BODY)
  m.box(2, 8, 70, 77, 20, 23, BLACK)
  m.box(3, 7, 58, 70, 20, 22, BLACK)
  m.box(2, 8, 52, 58, 20, 23, BLACK)
  for (let y = 40; y < 52; y++) m.set(4 + ((y >> 1) & 1), y, 21, BLACK)
  return m.born()
}

/** A jukebox: a wooden case under an arch of light, a record behind its glass. */
function jukebox(): Born {
  const m = new Cells(38, 66, 26)
  const CASE = k(WOOD, hue(1, 6)), TRIM = k(STEEL, grey(3)) | POLISHED, DARK = k(ROOFING, grey(13))
  const cx = 19, cy = 44
  m.box(0, 38, 0, 3, 2, 24, k(STEEL, grey(11)))
  m.box(1, 37, 3, 44, 3, 24, CASE)
  m.each(0, 38, 44, 66, 3, 24, (x, y) => ((x - cx) ** 2 + (y - cy) ** 2 <= 19 * 19 ? CASE : 0))
  // The arch of tubes on its front, and the tubes down its sides, in three colours of light.
  const TUBES = [k(LAMP, hue(2, 3)), k(LAMP, hue(20, 3)), k(LAMP, hue(12, 3))]
  m.each(0, 38, 44, 66, 24, 26, (x, y) => { const r = Math.hypot(x - cx, y - cy); return r <= 19 && r > 15.5 ? TUBES[Math.floor(((Math.atan2(y - cy, x - cx) / Math.PI) * 9) % 3)] : 0 })
  m.box(1, 4, 3, 44, 24, 26, TUBES[0]); m.box(34, 37, 3, 44, 24, 26, TUBES[0])
  m.box(4, 5, 3, 44, 24, 25, TRIM); m.box(33, 34, 3, 44, 24, 25, TRIM)
  // The glass, and the record behind it with its label.
  m.each(4, 34, 30, 60, 21, 24, (x, y, z) => { const r = Math.hypot(x - cx, y - cy); if (r > 15) return 0; return z > 23 ? k(GLASS, grey(2)) : 0 })
  m.each(4, 34, 30, 60, 13, 21, (x, y) => (y < 30 || Math.hypot(x - cx, y - cy) > 15 ? 0 : DARK))
  m.each(6, 32, 32, 58, 20, 21, (x, y) => { const r = Math.hypot(x - cx, y - (cy - 2)); return r <= 2 ? k(LAMP, hue(0, 4)) : r <= 9 ? k(ROOFING, grey(14)) : 0 })
  // The rows of titles to choose from, and the grille the sound comes out of.
  m.box(6, 32, 22, 30, 24, 25, k(PLASTER, grey(1)))
  for (let r = 0; r < 3; r++) m.box(8, 30, 23 + r * 2.5 | 0, 24 + r * 2.5 | 0, 25, 26, k(PLASTER, grey(9)))
  m.box(6, 32, 6, 20, 24, 25, k(STEEL, grey(5)))
  for (let y = 7; y < 20; y += 2) m.box(8, 30, y, y + 1, 25, 26, DARK)
  return m.born()
}

/** A fruit cart under a striped awning: a crate of red apples, one of green, and one black apple on top (`taken`: not there). */
function cart(taken: boolean): Born {
  const m = new Cells(66, 78, 38)
  const WOODEN = k(WOOD, hue(3, 8)), RIM = k(STEEL, grey(10)), POLE = k(STEEL, grey(4))
  // The wheels at either side, on one axle, and a leg at the far end.
  for (const z of [0, 36]) m.each(20, 44, 0, 24, z, z + 2, (x, y) => { const r = Math.hypot(x - 32, y - 12); return r <= 12 && r > 10 ? RIM : r <= 10 && (Math.abs(x - 32) < 1 || Math.abs(y - 12) < 1 || Math.abs(x - 32 - (y - 12)) < 1.2) ? WOODEN : 0 })
  m.box(31, 33, 11, 13, 0, 38, RIM)
  m.box(58, 61, 0, 22, 16, 20, WOODEN)
  // The handle, and the bed: walls with crates in it.
  m.box(0, 6, 26, 28, 6, 8, WOODEN); m.box(0, 6, 26, 28, 30, 32, WOODEN); m.box(0, 2, 26, 28, 6, 32, WOODEN)
  m.box(4, 62, 20, 23, 3, 35, WOODEN)
  m.box(4, 62, 23, 32, 3, 5, WOODEN); m.box(4, 62, 23, 32, 33, 35, WOODEN); m.box(4, 6, 23, 32, 3, 35, WOODEN); m.box(60, 62, 23, 32, 3, 35, WOODEN); m.box(32, 34, 23, 32, 3, 35, WOODEN)
  // Apples heaped in each crate: red on the left, green on the right (a little different each).
  let seed = 7
  const rand = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32)
  for (const [x0, x1, colours] of [[6, 32, [hue(0, 4), hue(0, 5), hue(23, 4)]], [34, 60, [hue(7, 4), hue(6, 3), hue(7, 5)]]] as const) {
    for (let layer = 0; layer < 2; layer++) for (let z = 7.5; z < 33; z += 5) for (let x = x0 + 2.5 + layer * 2; x < x1 - 2; x += 5) {
      if (layer && (x > x1 - 6 || z > 30 || z < 9)) continue
      m.ball(x + rand() - 0.5, 26.5 + layer * 4 + rand(), z + rand() - 0.5, 2.6, k(PLASTER, colours[Math.floor(rand() * 3)]))
    }
  }
  // The black apple, at the front of the red ones, with its stem and a leaf.
  if (!taken) {
    m.ball(19, 36, 26, 3.4, k(ROOFING, grey(14)))
    m.box(19, 20, 39, 41, 26, 27, k(WOOD, hue(2, 9)))
    m.box(20, 22, 40, 41, 26, 27, k(PLASTER, hue(8, 5)))
  }
  // The poles and the awning, sloping to the front, red and white.
  for (const [x, z] of [[6, 5], [58, 5], [6, 33], [58, 33]]) m.box(x, x + 2, 32, 72, z, z + 2, POLE)
  m.each(0, 66, 66, 78, 0, 38, (x, y, z) => { const top = 75 - z * 0.16; return y > top - 2 && y <= top ? k(PLASTER, Math.floor(x / 6) % 2 ? grey(0) : hue(0, 4)) : 0 })
  m.each(0, 66, 62, 70, 37, 38, (x, y) => (y >= 64 && Math.floor(x / 6) % 2 === 0 ? k(PLASTER, hue(0, 4)) : y >= 66 ? k(PLASTER, grey(0)) : 0))
  return m.born()
}

/** An arcade cabinet: its screen and marquee lit, a stick and two buttons on its panel. */
function arcade(): Born {
  const m = new Cells(30, 78, 36)
  const SIDE = k(WOOD, hue(16, 6)), BLACK = k(ROOFING, grey(13)), STRIPE = k(PLASTER, hue(20, 4))
  // How far forward the cabinet reaches at each height: its foot, the panel jutting out, the screen leaning back, the marquee.
  const front = (y: number) => (y < 30 ? 26 : y < 36 ? 34 : y < 64 ? 27 - (y - 36) * 0.12 : 29)
  m.each(0, 30, 0, 78, 0, 36, (x, y, z) => {
    if (z > front(y)) return 0
    const side = x < 2 || x > 28
    if (side) return Math.abs(y - 1.6 * z - 8) < 3 ? STRIPE : SIDE
    return BLACK
  })
  // The screen: dark blue, a little scene of lit points on it.
  const screen = (y: number) => Math.floor(front(y))
  for (let y = 40; y < 61; y++) for (let x = 4; x < 26; x++) {
    let v = k(LAMP, hue(16, 6))
    if ((x * 7 + y * 13) % 23 === 0) v = k(LAMP, grey(0))
    if (y > 42 && y < 46 && x > 12 && x < 18) v = k(LAMP, hue(4, 3))
    if (y === 46 && x === 15) v = k(LAMP, hue(4, 3))
    if (y > 53 && y < 57 && (x === 7 || x === 8 || x === 21 || x === 22 || x === 14)) v = k(LAMP, hue(20, 3))
    m.set(x, y, screen(y), v)
  }
  // The marquee, lit.
  for (let y = 65; y < 75; y++) for (let x = 3; x < 27; x++) m.set(x, y, 29, y === 69 || y === 70 ? k(LAMP, hue(20, 3)) : k(LAMP, hue(3, 2)))
  // The panel: a stick with a red ball, two buttons.
  m.box(2, 28, 35, 36, 26, 35, k(STEEL, grey(11)))
  m.box(8, 9, 36, 40, 30, 31, BLACK)
  m.ball(8.5, 41, 30.5, 1.8, k(PLASTER, hue(0, 4)))
  m.box(16, 18, 36, 37, 29, 31, k(LAMP, hue(0, 3))); m.box(21, 23, 36, 37, 29, 31, k(LAMP, hue(4, 3)))
  // The coin door, its slots lit.
  m.box(10, 20, 9, 21, 26, 27, k(STEEL, grey(6)))
  m.box(12, 13, 15, 18, 27, 28, k(LAMP, hue(2, 3))); m.box(17, 18, 15, 18, 27, 28, k(LAMP, hue(2, 3)))
  return m.born()
}

/** A viewer at a lookout: a coin telescope on its post, two eyepieces at the back under a hood, two lenses at the front. */
function viewer(): Born {
  const m = new Cells(30, 70, 50)
  const PAINT = k(STEEL, hue(9, 5)), BLACK = k(ROOFING, grey(14)), BRASS = k(STEEL, hue(3, 3)) | POLISHED
  m.post(15, 25, 11, 0, 2, k(CONCRETE, grey(5)))
  m.post(15, 25, 3, 2, 40, PAINT)
  // The coin box on the post.
  m.box(11, 19, 24, 34, 27, 30, BRASS)
  m.box(14, 16, 29, 32, 30, 31, BLACK)
  // The yoke the head turns in.
  m.box(4, 26, 38, 42, 21, 29, PAINT)
  m.box(4, 7, 40, 54, 21, 29, PAINT); m.box(23, 26, 40, 54, 21, 29, PAINT)
  // The head: a broad round-topped box tipped up to the sky, two big lenses in brass at its front, the eyepieces under a hood at its back.
  m.each(6, 24, 42, 66, 4, 48, (x, y, z) => { const lift = (z - 26) * 0.18, r = Math.hypot(Math.max(0, Math.abs(x - 15) - 4), Math.max(0, Math.abs(y - 53 - lift) - 2)); return r <= 6 && z > 6 && z < 45 ? PAINT : 0 })
  for (const x of [11, 19]) {
    m.each(6, 24, 46, 66, 45, 48, (px, py) => { const r = Math.hypot(px - x, py - 56.5); return r <= 2.8 ? k(GLASS, grey(1)) : r <= 3.8 ? BRASS : 0 })
    m.each(6, 24, 42, 62, 2, 7, (px, py) => (Math.hypot(px - x, py - 49.5) <= 2 ? BLACK : 0))
  }
  m.box(6, 24, 54, 56, 1, 8, BLACK)
  m.box(10, 20, 44, 47, 3, 6, BLACK)
  return m.born()
}

/** A toy biplane on a stick (the plane alone: `planeStick` is the stick it spins on). Its nose is +x. */
function plane(): Born {
  const m = new Cells(46, 28, 52)
  const RED = k(PLASTER, hue(0, 4)), YELLOW = k(PLASTER, hue(4, 4)), BLACK = k(ROOFING, grey(14)), cy = 14, cz = 26
  // The body: round, thicker at the front, tapering to the tail.
  m.each(2, 42, 6, 22, 18, 34, (x, y, z) => { const r = x > 30 ? 4.2 : 1.6 + (x - 2) * 0.09; return Math.hypot(y - cy, z - cz) <= r ? RED : 0 })
  m.each(36, 42, 8, 20, 20, 32, (x, y, z) => (Math.hypot(y - cy, z - cz) <= 4.6 && x > 39 ? k(STEEL, grey(4)) : 0))
  // Two wings, struts between them, the tail.
  m.box(24, 32, cy - 4, cy - 3, 1, 51, YELLOW)
  m.box(24, 32, cy + 6, cy + 7, 1, 51, YELLOW)
  for (const z of [5, 46]) for (const x of [25, 30]) m.box(x, x + 1, cy - 3, cy + 6, z, z + 1, BLACK)
  m.box(2, 8, cy, cy + 1, 16, 36, YELLOW)
  m.box(2, 7, cy, cy + 9, 25, 27, RED)
  // The pilot's seat, and the propeller across its nose.
  m.box(20, 24, cy + 3, cy + 5, 23, 29, BLACK)
  m.box(42, 44, 0, 28, 25, 27, k(WOOD, hue(2, 9)))
  m.box(42, 45, cy - 1, cy + 1, cz - 1, cz + 1, BLACK)
  return m.born()
}
function planeStick(): Born {
  const m = new Cells(8, 48, 8)
  m.post(4, 4, 6, 0, 2, k(CONCRETE, grey(6)))
  m.post(4, 4, 1.5, 2, 48, k(STEEL, grey(7)))
  return m.born()
}

/** A golden shield on a stone plinth, a ring of light over it. */
function shield(): Born {
  const m = new Cells(32, 76, 32)
  const STONE = k(CONCRETE, grey(3)), GOLD = k(PLASTER, hue(4, 2)), DEEP = k(PLASTER, hue(3, 3)), LIGHT = k(LAMP, hue(4, 1))
  m.box(0, 32, 0, 3, 0, 32, STONE)
  m.box(3, 29, 3, 24, 3, 29, STONE)
  m.box(1, 31, 24, 27, 1, 31, STONE)
  // The shield: square at the top, coming to a point at the foot, its rim deeper than its face, standing up off the plinth.
  const cx = 16, top = 62, foot = 28
  const inside = (x: number, y: number, rim: number) => {
    if (y > top - rim || y < foot + rim * 1.6) return false
    const half = y > 46 ? 12 : 12 * Math.sqrt(Math.max(0, (y - foot) / 18))
    return Math.abs(x - cx) < half - rim
  }
  m.each(0, 32, foot, top, 13, 19, (x, y, z) => (!inside(x, y, 0) ? 0 : z >= 17 && inside(x, y, 1.6) ? GOLD : DEEP))
  // A sun on its face.
  m.each(0, 32, 30, 62, 19, 20, (x, y) => { const r = Math.hypot(x - cx, y - 48), a = Math.atan2(y - 48, x - cx); return r <= 3.2 || (r < 7 && Math.cos(a * 8) > 0.6 && r > 4.4) ? LIGHT : 0 })
  // The ring of light over it.
  m.each(0, 32, 68, 71, 0, 32, (x, y, z) => { const r = Math.hypot(x - cx, z - 16); return r <= 9 && r > 7.2 && y < 70 ? LIGHT : 0 })
  return m.born()
}

/** An old television on a low cabinet, rabbit ears up: its screen dark (`on` false), or showing colour bars. */
function tv(on: boolean): Born {
  const m = new Cells(28, 66, 24)
  const CABINET = k(WOOD, hue(1, 6)), CASE = k(STEEL, grey(12)), RIM = k(STEEL, grey(9)), KNOB = k(STEEL, grey(3)) | POLISHED, EAR = k(STEEL, grey(4)) | POLISHED
  // The cabinet, its doors' line and two round feet each side.
  m.box(1, 27, 2, 20, 3, 22, CABINET)
  m.box(0, 28, 20, 22, 2, 23, CABINET)
  m.box(13, 15, 4, 18, 22, 23, k(WOOD, hue(1, 8)))
  for (const x of [3, 24]) for (const z of [5, 19]) m.box(x, x + 2, 0, 2, z, z + 2, k(ROOFING, grey(13)))
  // The set: a deep case, the screen's rim, the screen, and the knobs beside it.
  m.box(2, 26, 22, 44, 4, 21, CASE)
  m.box(3, 20, 24, 42, 21, 22, RIM)
  const BARS = [k(LAMP, grey(0)), k(LAMP, hue(4, 3)), k(LAMP, hue(12, 3)), k(LAMP, hue(8, 3)), k(LAMP, hue(20, 3)), k(LAMP, hue(0, 3)), k(LAMP, hue(16, 3))]
  for (let y = 26; y < 40; y++) for (let x = 5; x < 18; x++) m.set(x, y, 22, on ? (y < 29 ? k(LAMP, grey(y === 27 ? 2 : 12)) : BARS[Math.floor(((x - 5) / 13) * BARS.length)]) : k(GLASS, grey(13)))
  m.ball(23, 37, 21.5, 1.6, KNOB); m.ball(23, 31, 21.5, 1.6, KNOB)
  m.box(21, 25, 25, 27, 21, 22, on ? k(LAMP, hue(0, 3)) : k(ROOFING, grey(13)))
  // Rabbit ears from a little dome on top.
  m.ball(14, 44, 12, 3, CASE)
  for (let t = 0; t <= 1; t += 0.02) { m.set(Math.round(14 - 9 * t), Math.round(46 + 18 * t), 12, EAR); m.set(Math.round(14 + 8 * t), Math.round(46 + 19 * t), 12, EAR) }
  m.ball(5, 64, 12, 1, EAR); m.ball(22, 65, 12, 1, EAR)
  return m.born()
}

// ── Where each stands ──

/**
 * Where a thing stands (world cells; `y` its foot's height there, as recorded), which way its front looks (degrees: 0
 * north, 90 east), and whether it is used from behind (the viewer looks out over the edge; whoever uses it stands at its back).
 */
interface Spot { id: ThingId; at: readonly [number, number, number]; facing: number; behind?: boolean }
const SPOTS: Spot[] = [
  // On 555 California's roof, where the visitor comes in (sf/boards.json, the EXPLORE board's `stand`: 525240, 670625),
  // a few steps off: two in the sun past the board's letters (in their shadow the jukebox was a dark box), and a viewer
  // at the edge looking out over the bay.
  { id: 'jukebox', at: [525222, 2392, 670735], facing: 20 },
  { id: 'plane', at: [525255, 2390, 670775], facing: 340 },
  { id: 'viewer', at: [525262, 2390, 670685], facing: 90, behind: true },
  // On the tower's plaza, under it, where a canopy comes down.
  { id: 'cart', at: [525150, 138, 670470], facing: 135 },
  // On the BLOG board's roof (Broadway), between the park and downtown.
  { id: 'arcade', at: [518093, 529, 664958], facing: 180 },
  // In the park of the first view (the realm's `arrive`: 516466, 664022), out of its picture.
  { id: 'payphone', at: [516466, 831, 663975], facing: 120 },
  { id: 'shield', at: [516430, 845, 664060], facing: 90 },
  { id: 'tv', at: [516426, 840, 664002], facing: 110 },
]
/** What the core says of the ground: where feet would stand at a column (world cells), once its tiles have come. */
export interface ThingsPage {
  hasMedia: boolean
  pieces: Pieces
  hud: Hud
  input: Input
  view(): View
  /** Where the feet are (world cells), or null flying as an eye. */
  feet(): readonly number[] | null
  ground(x: number, z: number): number
  touch(): boolean
  /** Which of a thing's looks to show now (`t`: seconds): the payphone's sign lit or not as it rings, the cart's apple taken. */
  look(id: ThingId, t: number): number
  /** What using a thing says on its cue now, and what using it does. */
  words(id: ThingId): string
  use(id: ThingId): void
}

export interface Things {
  /** Every frame: drawn where they are seen, offered where one is near. */
  frame(t: number): void
  /** Uses the thing the aim is on within reach (the nearest it meets), if it is: true if there was one. */
  aimed(): boolean
  /** Uses the thing offered now (E), if there is one: true if there was. */
  key(): boolean
  /** What the cue offered now says, or null. */
  readonly words: string | null
  /** The thing offered now (its cue shown), or null. */
  readonly near: ThingId | null
  /** Where each stands now and how big it is (world cells), for the checks. */
  readonly list: { id: ThingId; at: [number, number, number]; facing: number; behind: boolean; size: [number, number, number]; drawn: boolean }[]
  /** Turns the plane round its body (radians), as it does a barrel roll. */
  spin: number
  /** Puts back what the eye is to see after the world is put back. */
  forget(): void
}

export function things(o: ThingsPage): Things {
  const looks: Record<ThingId, Born[]> = { payphone: [payphone(false), payphone(true)], jukebox: [jukebox()], cart: [cart(false), cart(true)], arcade: [arcade()], viewer: [viewer()], plane: [planeStick()], shield: [shield()], tv: [tv(false), tv(true)] }
  // (The plane turns about the middle of its body.)
  const wings = { ...plane(), com: [23, 14.5, 26] as [number, number, number] }
  const spots = o.hasMedia ? SPOTS : SPOTS.filter((s) => !['jukebox', 'cart', 'tv'].includes(s.id))
  const placed = spots.map((s) => {
    const born = looks[s.id][0], a = Math.PI - (s.facing * Math.PI) / 180
    // (The plane's room is the stick's and the plane's over it: its wings reach 6.5 cells either way, its top 17 up.)
    const size = (s.id === 'plane' ? [13, 17, 13] : born.size.map((v) => v / PER)) as [number, number, number]
    return { ...s, y: s.at[1] as number, found: false, born, look: 0, piece: null as Piece | null, wings: null as Piece | null, rot: [0, Math.sin(a / 2), 0, Math.cos(a / 2)] as [number, number, number, number], size }
  })
  let near: (typeof placed)[number] | null = null, cue: { text: string; remove(): void } | null = null
  const self: Things = {
    spin: 0,
    get near() { return near?.id ?? null },
    get list() { return placed.map((p) => ({ id: p.id, at: [p.at[0], p.y, p.at[2]] as [number, number, number], facing: p.facing, behind: !!p.behind, size: p.size, drawn: !!p.piece })) },
    frame(t) {
      const v = o.view(), feet = o.feet(), from = feet ?? v.eye
      // (Offered only to someone on foot or flying who could act: not while riding, typing or choosing a tool, whose
      // solid modes are over the walk.)
      const free = o.input.live('moving')
      let best: (typeof placed)[number] | null = null, bestFar = Infinity
      for (const p of placed) {
        const dx = p.at[0] - v.eye[0], dz = p.at[2] - v.eye[2], far = Math.hypot(dx, dz)
        // Its height from the ground there once the tiles have come (a recorded height is what it is otherwise).
        if (!p.found && far < DRAWN) { const g = o.ground(p.at[0], p.at[2]); if (Number.isFinite(g) && (!p.at[1] || Math.abs(g - p.at[1]) < 30)) { p.y = g; p.found = true } }
        const ahead = dx * v.forward[0] + (p.y - v.eye[1]) * v.forward[1] + dz * v.forward[2], side = p.size[0] + p.size[1]
        const want = far < DRAWN && (p.found || !!p.at[1]) && ahead > -side && (far < 60 || ahead > far * 0.5)
        const look = o.look(p.id, t)
        if (!want) { p.piece?.destroy(); p.piece = null; p.wings?.destroy(); p.wings = null }
        else {
          if (!p.piece || p.look !== look) { p.piece?.destroy(); p.piece = o.pieces.add(looks[p.id][look], true); p.look = look; p.piece.cell = 1 / PER; p.piece.rot = p.rot }
          p.piece.pos = [p.at[0], p.y, p.at[2]]
          if (p.id === 'plane') {
            if (!p.wings) { p.wings = o.pieces.add(wings, true); p.wings.cell = 1 / PER }
            // Round its own length (its nose is +x, the facing turned), over the stick's top.
            // (A turn about y by a after one about x by s: their product, the second first.)
            const a = (Math.PI - (p.facing * Math.PI) / 180 - Math.PI / 2) / 2, s = self.spin / 2
            p.wings.rot = [Math.cos(a) * Math.sin(s), Math.sin(a) * Math.cos(s), -Math.sin(a) * Math.sin(s), Math.cos(a) * Math.cos(s)]
            p.wings.pos = [p.at[0], p.y + 48 / PER + 1, p.at[2]]
          }
        }
        // Near enough to use: the feet beside it (on it, or a step from it), or the eye flying close.
        const reach = REACH + Math.max(p.size[0], p.size[2]) / 2, h = Math.hypot(from[0] - p.at[0], from[2] - p.at[2])
        const up = from[1] - p.y, ok = feet ? up > -10 && up < p.size[1] + 10 : up > -10 && up < p.size[1] + 30
        if (free && h < reach && ok && h < bestFar) { best = p; bestFar = h }
      }
      if (near !== best) {
        cue?.remove(); cue = null
        near = best
        if (best) {
          const id = best.id, at = best
          // (Over its top, and over the head of whoever stands before it: the cue of a thing lower than a head was on the body.)
          cue = o.hud.cue('', () => { const f = o.feet(); return [at.at[0], Math.max(at.y + at.size[1] + 3, f ? f[1] + 26 : -Infinity), at.at[2]] }, () => o.use(id))
        }
      }
      if (near && cue) { const text = `${o.touch() ? '' : 'E  '}${o.words(near.id)}`; if (cue.text !== text) cue.text = text }
    },
    get words() { return cue?.text ?? null },
    key() { if (!near) return false; o.use(near.id); return true },
    aimed() {
      const v = o.view()
      // (The nearest the aim's line meets.)
      let hit: (typeof placed)[number] | null = null, first = Infinity
      for (const p of placed) {
        if (!p.piece) continue
        // The aim's line against a box round it (its widest across, as it may be turned).
        const r = Math.max(p.size[0], p.size[2]) / 2 + 1, lo = [p.at[0] - r, p.y, p.at[2] - r], hi = [p.at[0] + r, p.y + p.size[1] + 1, p.at[2] + r]
        let t0 = 0, t1 = AIM
        for (let a = 0; a < 3; a++) {
          const d = v.forward[a], e = v.eye[a]
          if (Math.abs(d) < 1e-9) { if (e < lo[a] || e > hi[a]) { t1 = -1; break } continue }
          let ta = (lo[a] - e) / d, tb = (hi[a] - e) / d
          if (ta > tb) [ta, tb] = [tb, ta]
          t0 = Math.max(t0, ta); t1 = Math.min(t1, tb)
        }
        if (t0 <= t1 && t0 < first) { hit = p; first = t0 }
      }
      if (hit) o.use(hit.id)
      return !!hit
    },
    forget() { for (const p of placed) p.found = false },
  }
  return self
}
