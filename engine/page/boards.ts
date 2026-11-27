// The realm's billboards and the banner a plane tows (#450): the site's navigation as things of the city.
//
// Where each board stands and what it is are data (sf/boards.json, in the realm's record as `signs`): a board names
// its building by a point on its roof, its type, its size, which way it faces and what it says. Nothing here places
// one: `propose` only offers roofs to whoever is editing (`?boards=edit`, sf/boards.mjs), and the file is what counts.
//
//   lettering   letters of lamp on panels of wood, one panel and one steel post a letter, all cells of the world,
//               set in the realm's lettering face (typeface.ts: a glyph set of the kit's, a cell of it a square of cells):
//               every tool breaks them as it breaks a wall, a letter whose post is cut falls by itself. By night it is
//               lit as a billboard is: a lamp on an arm over each panel, whose light the march lays on the face.
//               From further off than the world's cells there can hold its letters (they are coarser than a
//               letter's stroke, or the far model has the roof) it is shown as a face, a picture of its own cells
//               as they stand: so a board may stand on a far roof and be read from the park, on a phone too.
//   digital     an LED billboard as a roof carries one: a dark cabinet of cells with a rim round its face, on steel
//               posts braced back to the roof, a walkway under its foot; and on its face a panel of LEDs
//               (screens.ts), one every 10 cm, that shows words, an image or a video and glows by night. The part
//               of the panel whose cabinet is gone is dark.
//   logo        the mark or the wordmark of a network the owner is on, as a head office wears its company's: cut
//               out (no plate behind it), lit of itself. It is a face and no cells, so no tool breaks it. It leads to
//               the owner's page on that network. Mounted one of two ways (`mount`):
//                 roof   standing on the tower's roof on a steel frame, turned to face the park. A roof sign may be
//                        taller than any wall of a tower 1.3 km off is wide, which is what lets it be read from there.
//                 wall   flush on a wall under the crown, lying whichever way that wall looks. A tower of the skyline
//                        is drawn by the far model from the park and as cells from near, and the two walls are metres
//                        apart: the sign is seated on whichever is drawn from where the eye is (`seat`).
//   banner      a plane towing a strip of cloth with words or a picture. Its own round is far off, past the towers and
//               over the bay, small in a corner of the sky as a painter's name is in a corner of a painting; when it has
//               something to say that must be read (an egg's line) it comes in to a round close before the park.
//
// What each says is set through signs.ts (`realm.signs.set`), which this file brings every sign to.
// A click or tap on a board from where the pointer is free flies the eye to it and then tells the host page where to
// go (host.ts `navigate`); flying free, O opens the board ahead. Each board is also a link in the page, for a
// keyboard and a screen reader. A board that leads nowhere may do something instead (`does`): the EXPLORE board
// takes the visitor into the realm, and whoever does that (explore.ts) is told of a click on it, and lights it.
import { rows, type Edit } from './edits.ts'
import { thing } from './fine.ts'
import { embedded, hear, tell } from './host.ts'
import type { Hud } from './hud.ts'
import type { Input } from './input.ts'
import type { View } from './march.ts'
import type { Piece, Pieces } from './pieces.ts'
import { screens as screensOf, type Screen, type Style } from './screens.ts'
import { signs, type Content } from './signs.ts'
import { MARKS, sign as signOf } from './logos.ts'
import { DISPLAY_CAP, lettering as letteringFace, lettersAsked, type Lettering, type Size } from './typeface.ts'
import { DEVICE } from './bay.ts'
import { ARMS, letterLight, type LetterLight, type LitLetter } from './letterlight.ts'
import type { Target } from '../probe/gpu.ts'

export interface Board {
  id: string
  /** Its accessible name: what a link to it is called. */
  name: string
  type: 'lettering' | 'digital' | 'logo'
  /** Its building: a point on its roof, in the frame's cells (x east, z south). */
  building: [number, number]
  /** Where it stands: the middle of its foot on that roof, cells. */
  at: [number, number, number]
  /** Which way its face looks: 0 west, 1 north, 2 east, 3 south. A logo lies on a wall that may look any way: `turn` is where its face looks, degrees clockwise from north. */
  facing: 0 | 1 | 2 | 3
  turn?: number
  /** A logo: `roof` stands on the roof on a frame (`at` is the middle of its frame's foot on the roof as the far model draws it), `wall` lies flush on a wall (`at` is the middle of its lower edge). `wall` where not said. */
  mount?: 'roof' | 'wall'
  /** A logo: the building's wall as the far model draws it is where `at` is (sf/boards.mjs `seat`); its wall as cells is found where they are drawn, within this many metres of that, out or in (20 where not said). */
  search?: number
  /** A logo's mark: one of logos.ts `MARKS`. */
  logo?: string
  /** Lettering: how tall a capital is, metres, as near as whole cells of its face allow (shape). Digital: how wide and how tall its housing is, metres. A logo: how tall its sign is, metres (how wide follows from its mark, logos.ts). */
  size: number | [number, number]
  /** Lettering: which of the face's sets it is set in (typeface.ts), where the address does not ask: the display set on a wide screen where a capital is four of its cells or more, else the compact set. A board read from far off may ask for the compact set's stouter strokes everywhere. */
  letters?: Size
  /** How far its foot is over the roof, metres. */
  lift?: number
  content: { text: string } | { image: string }
  /** A digital board's own colours for words: its ground (one, or two for a wash from left to right) and its letters. */
  colors?: { ground: string | [string, string]; ink: string }
  /** Where the host page goes when it is opened: a path of the site, or for a logo the address of the owner's page on that network. A board with none is only looked at. */
  to?: string
  /** What a click on it does, where it leads nowhere: `explore` takes the visitor into the realm (explore.ts). */
  does?: 'explore'
  /** Where whoever it takes into the realm stands on its roof, and which way they look: [x, z] in cells, and degrees clockwise from north. Before its middle, looking as it looks, where not said. */
  stand?: [number, number, number]
}
export interface Banner {
  content: { text: string } | { image: string }
  /** The middle of the plane's round, cells. */
  around: [number, number]
  /** How wide the round is, m: a circle's radius, or half the length and half the breadth of a long round. */
  radius: number | [number, number]
  /** Which way a long round's length lies, degrees from east towards south. */
  bearing?: number
  /** How high over the sea it flies, m, and how much higher on the one long side and lower on the other. */
  height: number
  rise?: number
  /** How fast, m/s. */
  speed: number
  /** How long and how high the cloth is, m. */
  size: [number, number]
  /** Where on its round it is as the place is first shown, 0 to 1. */
  start?: number
  /** How big the plane is: the size of its cells, in the world's (2 where not said: a plane 8.4 m long). A round flown far off wants a bigger one to be seen at all. */
  craft?: number
  /**
   * The round it comes in to when it has something to say (an egg's line, `plane.loud`): whatever of the above it
   * says otherwise. Its own round may be far off and small, a signature in a corner of the picture; a line someone
   * must read and answer is flown close, and it goes back out when the line is done.
   */
  near?: Partial<Omit<Banner, 'content' | 'upright' | 'near'>>
  /**
   * The round flown where the picture is taller than it is wide (a phone held upright): whatever of the above it says
   * otherwise. Such a picture sees a strip of the sky a third as wide, and a round that crosses a wide one whole is
   * out of it but for a second or two a lap.
   */
  upright?: Partial<Omit<Banner, 'content' | 'upright'>>
}
export interface SignsFile { version: 1; banner?: Banner; boards: Board[] }

const M = 10
const PLASTER = 9, WOOD = 10, STEEL = 12, LAMP = 15
/** Panels near black, posts dark grey, letters pale grey: white lamp blooms into a blot by night (tried, #450). */
const PANEL = WOOD | (14 << 8), POST = STEEL | (11 << 8), HOUSING = PLASTER | (14 << 8), LETTER = LAMP | (6 << 8), GRATING = STEEL | (13 << 8)
/** A lettering board's lamps: how far before its face each hangs, cells; the lamp itself is a street lamp's (march.ts: colour 46, lit by night, spread into a glow). */
const ARM = 8, BULB = LAMP | (46 << 8), HOOD = STEEL | (14 << 8)
/** How far a digital board's foot is over its roof where its record does not say, m: room for the walkway and a person under it. */
export const DIGITAL_LIFT = 3.2
/** How deep a digital board's cabinet is, cells. */
const DEEP = 6
const NORMALS = [[-1, 0], [0, -1], [1, 0], [0, 1]] as const
/** A roof sign's frame: how tall its legs are for the sign's height, and how far they go down into the roof, cells (the far model's roof and the cells' are not at one height). */
export const STAND = 0.16, SUNK = 30
/** How many pixels tall a logo's sign is on its picture (its frame's legs are more). */
const LOGO_PX = 256
/** What a lettering board can say in its face: capitals where the face has only capitals, a character it has no glyph for a space, 14 at most. */
export const lettered = (text: string, face: Lettering) => [...(face.set.upper ? text.toUpperCase() : text)].map((c) => (c in face.set.glyphs ? c : ' ')).join('').slice(0, 14)

/** A letter of a lettering board as laid: along the face from its left edge (cells), where its panel starts and how far to the next, its square of the face's grid, and the middle of each of the glyph's squares with whether it is lamp. */
interface Laid { ch: string; k0: number; pitch: number; mid: number; /** How wide its glyph is, cells. */ wide: number; /** Half way up its capitals, cells. */ up: number; squares: { along: number; y: number; lit: boolean }[] }
/** What a board is made of: its cells as rows, the box they lie in, and its face (middle, half its width along its right, how high, where its foot is). A lettering board: its letters, one for each character of what it says (a space none), and how tall a capital is. */
interface Shape { runs: Int32Array<ArrayBuffer>; box: Edit['box']; middle: [number, number, number]; right: [number, number, number]; normal: [number, number, number]; wide: number; high: number; letters?: (Laid | null)[]; cap?: number; /** A lettering board: world cells a cell of its face. */ px?: number }

/** Cells as rows: sorted by y, then z, then x, neighbours of one kind joined. */
function asRows(cells: number[][]): Int32Array<ArrayBuffer> {
  cells.sort((a, b) => a[1] - b[1] || a[2] - b[2] || a[0] - b[0])
  const out: number[] = []
  for (const [x, y, z, k] of cells) {
    const n = out.length
    if (n && out[n - 3] === y && out[n - 2] === z && out[n - 1] === k && out[n - 4] === x) out[n - 4] = x + 1
    else out.push(x, x + 1, y, z, k)
  }
  return Int32Array.from(out)
}

/**
 * A board's cells. Its face lies on a plane of the grid of 8 cells, and a phone's letters (the compact set, 8 cells a
 * cell) on that grid too, so that the world's coarser copies of it, which is what a far eye is shown, hold whole
 * letters and not a smear of them.
 */
export function shape(b: Board, text = 'text' in b.content ? b.content.text : '', face?: Lettering): Shape {
  if (b.type === 'logo') {
    // A face alone, flat on a wall: `at` is the middle of its lower edge, a little out from the wall.
    // (On a roof it stands on its frame's legs: its own lower edge is that much over the roof.)
    const t = ((b.turn ?? 270) * Math.PI) / 180, n: [number, number, number] = [Math.sin(t), 0, -Math.cos(t)], high = (b.size as number) * M, wide = high * (MARKS[b.logo ?? '']?.wide ?? 1), y0 = b.at[1] + (b.lift ?? 0) * M + (b.mount === 'roof' ? high * STAND : 0)
    return { runs: new Int32Array(0), box: [b.at[0], y0, b.at[2], b.at[0] + 1, y0 + 1, b.at[2] + 1], middle: [b.at[0], y0 + high / 2, b.at[2]], right: [n[2], 0, -n[0]], normal: n, wide, high }
  }
  const [nx, nz] = NORMALS[b.facing], rx = nz, rz = -nx, snap = (v: number) => Math.round(v / 8) * 8
  // (Its face on a plane of 16: the coarsest cells it is seen in, on a phone, are that big.)
  const cx = nx ? Math.round(b.at[0] / 16) * 16 : snap(b.at[0]), cz = nz ? Math.round(b.at[2] / 16) * 16 : snap(b.at[2]), foot = Math.round(b.at[1]), y0 = Math.ceil((foot + (b.lift ?? (b.type === 'digital' ? DIGITAL_LIFT : 1.6)) * M) / 8) * 8
  const cells: number[][] = []
  /** A cell `k` along the face from its left edge, `d` behind it, at height `y`, when the face is `wide` across. */
  const put = (wide: number, k: number, d: number, y: number, kind: number) => {
    const along = k - wide / 2
    const x = rx ? cx + rx * along - (rx < 0 ? 1 : 0) : nx > 0 ? cx - 1 - d : cx + d
    const z = rz ? cz + rz * along - (rz < 0 ? 1 : 0) : nz > 0 ? cz - 1 - d : cz + d
    cells.push([x, y, z, kind])
  }
  let wide: number, high: number
  let letters: (Laid | null)[] | undefined, cap: number | undefined, cell: number | undefined
  if (b.type === 'lettering') {
    if (!face) throw new Error(`the lettering board ${b.id} is laid without its face (typeface.ts)`)
    // A cell of the face is `px` of the world's. The display set (capitals 11 cells): a capital as tall as the board's
    // size says, in whole cells (4 m: 4 cells, 4.4 m). The compact set (7), on a phone: in whole cells of 8, which the
    // coarser cells a phone's march draws a board in from the park keep whole (4 m: 8 cells, 5.6 m), where the display
    // set's 4 were a smear (#450, ~/.village/engine/sf/type/probe). A board too small for the display set (boards()) is
    // at least as tall as asked (3 m: 5 cells, 3.5 m; EXPLORE's face from the park needs it), and on a phone as near as
    // whole cells allow (4 cells, 2.8 m): from the park it is its face, never its cells, and at 8 cells (5.6 m) or 5 it
    // stood under a phone's column of tools.
    const said = lettered(text, face), metres = (b.size as number) * M
    const px = (cell = face.size === 'display' ? Math.max(2, Math.round(metres / face.set.cap)) : DEVICE === 'phone' && Math.round(metres / DISPLAY_CAP) >= 4 ? Math.max(8, Math.round(metres / face.set.cap / 8) * 8) : DEVICE === 'phone' ? Math.max(4, Math.round(metres / face.set.cap)) : Math.max(4, Math.ceil(metres / face.set.cap))), line = face.layout(said)
    // Each glyph where the face sets it, but never so close to the one before that their boxes share a column: a
    // letter is a part of its own, on a panel of its own (the face's kerning may tuck one under the next). What a
    // glyph is pushed along by that, everything after it is pushed too, a word space with it.
    const at: number[] = []
    let shift = 0
    line.glyphs.forEach(({ x }, i) => { const prev = line.glyphs[i - 1], to = prev ? Math.max(x + shift, at[i - 1] + prev.g.w + 1) : x; shift = to - x; at.push(to) })
    // Its panel round it: half way to the next letter of its word, a cell of the face beyond a word's ends.
    const words: boolean[] = [] // whether a glyph begins a word
    for (let i = 0, was = true; i < said.length; i++) { if (said[i] === ' ') { was = true; continue } words.push(was); was = false }
    const spans = line.glyphs.map(({ g }, i) => {
      const prev = line.glyphs[i - 1], within = (j: number) => j < line.glyphs.length && !words[j]
      const left = within(i) ? Math.round(((at[i - 1] + prev.g.w + at[i]) / 2) * px) : (at[i] - 1) * px
      const right = within(i + 1) ? Math.round(((at[i] + g.w + at[i + 1]) / 2) * px) : (at[i] + g.w + 1) * px
      return [left, right]
    })
    const from = spans.length ? spans[0][0] : 0
    // As wide as whole pairs of the face's cells (the last panel takes what that adds), so that from its middle, on the
    // grid of 8, every cell of the face lies on the grid of its own size: a phone's cells of 8 on the grid of 8.
    wide = Math.max(2 * px, spans.length ? spans[spans.length - 1][1] - from : 2 * px)
    if (wide % (2 * px)) { const more = 2 * px - (wide % (2 * px)); wide += more; if (spans.length) spans[spans.length - 1][1] += more }
    // A cell of the face over its highest mark and under its lowest, and the cap line that far under the panel's top.
    const top = line.top, bottom = line.bottom
    high = (bottom - top + 2) * px; cap = (face.set.cap * px) / high
    const capLine = y0 + high - (1 - top) * px
    letters = []
    let g = 0
    for (const ch of said) {
      if (ch === ' ') { letters.push(null); continue }
      const { g: glyph } = line.glyphs[g], k0 = spans[g][0] - from, pitch = spans[g][1] - spans[g][0], left = at[g] * px - spans[g][0]
      g++
      // Its lamp: the glyph's cells at px a cell, along the panel from its left edge and up from the cap line.
      const ink = new Set<number>()
      for (const [vx, vy] of face.voxels(glyph, px)) ink.add((left + vx) * 4096 + (capLine - 1 - vy - y0))
      const squares: Laid['squares'] = []
      for (let r = 0; r < glyph.rows.length; r++) for (let c = 0; c < glyph.w; c++) {
        // (The cell at its middle, or of an even number of cells the one past it.)
        const k = left + c * px + Math.floor(px / 2), y = capLine - 1 - (r + glyph.y) * px - Math.floor(px / 2)
        squares.push({ along: k0 + k + 0.5 - wide / 2, y: y + 0.5, lit: ink.has(k * 4096 + (y - y0)) })
      }
      letters.push({ ch, k0, pitch, mid: k0 + left + (glyph.w * px) / 2 - wide / 2, wide: glyph.w * px, up: capLine - (face.set.cap * px) / 2, squares })
      // Its panel, a cell short of the next one's: the letters are parts of their own.
      for (let k = 0; k < pitch - 1; k++) for (let y = 0; y < high; y++) {
        const lit = ink.has(k * 4096 + y)
        for (let d = 0; d < 2; d++) put(wide, k0 + k, d, y0 + y, lit ? LETTER : PANEL)
      }
      // Its lamp, as a billboard is lit: an arm up from the panel's top, a hood at its end hung out before the face, and
      // the lamp under the hood (a bar of light from before the board), turned down on the letters. All of it is over
      // the panel's top and not before the letters: a far eye is shown coarser cells (16 on a phone), in which a hood
      // hung before the top row of the panel was a block over the letters' heads. What its light does to the face is
      // the march's (march.ts: the box `kept` tells it is washed by night, and its letters are lit by that and not
      // of themselves).
      const post = Math.round(pitch / 2)
      if (ARMS) {
        for (let d = 0; d < 2; d++) for (let k = post - 1; k < post + 1; k++) for (let y = 0; y < 4; y++) put(wide, k0 + k, d, y0 + high + y, POST)
        for (let d = -ARM; d < 2; d++) for (let k = post - 4; k < post + 4; k++) for (let y = 2; y < 6; y++) put(wide, k0 + k, d, y0 + high + y, y === 2 && d < 0 ? BULB : HOOD)
      }
      // Its beam and its post.
      for (let k = 0; k < pitch - 1; k++) for (let d = 0; d < 2; d++) for (let y = 1; y <= 2; y++) put(wide, k0 + k, d, y0 - y, POST)
      for (let k = post - 2; k < post + 2; k++) for (let d = 0; d < 2; d++) for (let y = foot - 2; y < y0 - 2; y++) put(wide, k0 + k, d, y, POST)
    }
  } else {
    const [w, h] = b.size as [number, number]
    wide = Math.max(16, Math.round((w * M) / 8) * 8); high = Math.max(16, Math.round((h * M) / 8) * 8)
    // Its cabinet breaks as a wall does (steel would barely give); the beam it rests on is steel.
    for (let k = 0; k < wide; k++) for (let y = -2; y < high; y++) for (let d = 0; d < DEEP; d++) put(wide, k, d, y0 + y, y < 0 ? POST : HOUSING)
    // A walkway before its foot, as wide as it: grating on the beam, for whoever mends it.
    for (let k = 0; k < wide; k++) for (let d = -6; d < 0; d++) put(wide, k, d, y0 - 2, GRATING)
    // Posts under it (two under a narrow one, more under a wide), each braced back and down to the roof, with a tie between them half way up.
    const posts = wide >= 160 ? [wide / 8, (wide * 3) / 8, (wide * 5) / 8, (wide * 7) / 8] : wide >= 64 ? [wide / 4, (wide * 3) / 4] : [wide / 2], tall = y0 - 2 - (foot - 2)
    for (const at of posts) {
      for (let k = at - 2; k < at + 2; k++) for (let d = 1; d < 5; d++) for (let y = foot - 2; y < y0 - 2; y++) put(wide, k, d, y, POST)
      // The brace: from the cabinet's back, half way up it, down to the roof as far behind as it is high.
      const from = y0 + Math.floor(high / 2), run = from - foot
      for (let i = 0; i <= run; i++) for (let k = at - 1; k < at + 1; k++) for (let t = 0; t < 2; t++) put(wide, k, DEEP + i + t, from - i, POST)
    }
    if (tall >= 16) for (let k = posts[0]; k < posts[posts.length - 1]; k++) for (let d = 2; d < 4; d++) for (let y = 0; y < 2; y++) put(wide, k, d, foot - 2 + Math.floor(tall / 2) + y, POST)
  }
  const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]
  for (const [x, y, z] of cells) { box[0] = Math.min(box[0], x); box[1] = Math.min(box[1], y); box[2] = Math.min(box[2], z); box[3] = Math.max(box[3], x + 1); box[4] = Math.max(box[4], y + 1); box[5] = Math.max(box[5], z + 1) }
  if (!cells.length) box.splice(0, 6, cx, y0, cz, cx + 1, y0 + 1, cz + 1)
  return { runs: asRows(cells), box: box as unknown as Edit['box'], middle: [cx, y0 + high / 2, cz], right: [rx, 0, rz], normal: [nx, 0, nz], wide, high, letters, cap, px: cell }
}

/** The plane: a small high-winged one, its nose along +x, in cells of 20 cm. */
function plane(): { kinds: Uint16Array; size: [number, number, number] } {
  const size: [number, number, number] = [42, 14, 52], kinds = new Uint16Array(size[0] * size[1] * size[2])
  const white = STEEL | (1 << 8), red = STEEL | (20 << 8), dark = STEEL | (13 << 8), glass = 11
  const set = (x: number, y: number, z: number, k: number) => { if (x >= 0 && y >= 0 && z >= 0 && x < size[0] && y < size[1] && z < size[2]) kinds[x + size[0] * (z + size[2] * y)] = k }
  const mid = size[2] / 2
  // The body, narrowing to the tail; a red stripe along it; glass round the seats.
  for (let x = 0; x < 40; x++) {
    const taper = x < 18 ? 1 - (18 - x) / 26 : 1, half = Math.max(1, Math.round(3 * taper)), low = x < 18 ? Math.round(4 - 2 * taper) + 1 : 3, top = x < 18 ? low + Math.max(2, Math.round(5 * taper)) : x > 34 ? 7 : 8
    for (let y = low; y < top; y++) for (let z = mid - half; z < mid + half; z++) set(x, y, z, x > 37 ? dark : x >= 24 && x < 31 && y >= 6 ? glass : y === 5 ? red : white)
  }
  // The wing over the seats, red at its tips; the tailplane and the fin.
  for (let z = 1; z < size[2] - 1; z++) for (let x = 22; x < 31; x++) set(x, 8, z, z < 5 || z >= size[2] - 5 ? red : white)
  for (let z = mid - 8; z < mid + 8; z++) for (let x = 1; x < 6; x++) set(x, 6, z, white)
  for (let x = 0; x < 7; x++) for (let y = 6; y < 13 - Math.max(0, x - 3); y++) set(x, y, mid, x < 2 ? red : white)
  // The airscrew as it turns, a dark disc; the wheels on their legs.
  for (let y = 2; y < 10; y++) for (let z = mid - 4; z < mid + 4; z++) if ((y - 5.5) ** 2 + (z - mid + 0.5) ** 2 < 17) set(40, y, z, dark)
  for (const z of [mid - 6, mid + 5]) { for (let y = 1; y < 4; y++) set(27, y, z, dark); for (let x = 26; x < 29; x++) for (let y = 0; y < 2; y++) set(x, y, z, dark) }
  return { kinds, size }
}

export interface Boards {
  readonly records: readonly Board[]
  /** Every board as the host page is told of it. */
  listed(): { id: string; name: string; type: Board['type']; to: string | null }[]
  /** How many edits the boards have laid in the world as it is now: what a world with nothing done to it holds (the checks). */
  readonly edits: number
  /** Lays every board again: the world was put back as it came (reset). */
  relay(): void
  /** Flies the eye to a board. Resolves when it is there, false if there is no such board or the flight was cut short. */
  fly(id: string): Promise<boolean>
  /** Tells the host page to go where the board leads. */
  open(id: string): boolean
  /** Lights a lettering board's letters, 0 (as they stand) to 1 (fully lit): it is then shown as its face, wherever the eye is. */
  light(id: string, lit: number): void
  /** Whether a lettering board is shown as its face now, and not as its cells: for the checks. */
  faced(id: string): boolean
  /** The box a board's cells lie in (finest cells, low corner and high), or null: for whoever flies an eye round it. */
  box(id: string): readonly number[] | null
  /** Where a board is on the picture now, client px (its middle and its box), or null if it is behind the eye: for the checks and the host. */
  where(id: string): { x: number; y: number; wide: number; high: number; /** How tall its face is down its middle, px. */ tall: number; far: number } | null
  marks(id: string): { x: number; y: number; lit: boolean; /** Which of its letters the square is of (spaces counted). */ letter: number }[]
  /** Whether the logos are drawn: a check reads a logo off the picture as what it changes there (test/sf-logos.mjs). */
  logos: boolean
  /**
   * The boards' own light off (true), as while an egg plays on the city's windows (eggs.ts): BLOG's and EXPLORE's
   * letters out and their lamps' wash gone, the logos and the boards' far faces lit only as the day lights a wall. The
   * banner is the eggs' own and stays lit. Off again (false), the letters strike as the lights coming on make them.
   */
  dark: boolean
  /** How many of a lettering board's letters still stand (most of their lamp there), and a digital board's tiles lit. */
  standing(id: string): { letters: string; whole: boolean }
  /** The lettering boards' own light (letterlight.ts): its clock can be held, and it says when it has settled and how lit each letter is. */
  readonly glow: LetterLight
  /** A lettering board's letters as laid, for the checks: each one's middle and glyph width (cells), how tall a capital is (cells, and as a share of the panel), and the face they are in. */
  letters(id: string): { face: string; px: number; cap: number; capShare: number; middles: { ch: string; at: [number, number, number]; wide: number }[]; middle: [number, number, number]; right: [number, number, number]; normal: [number, number, number]; wide: number; high: number } | null
  /** Roofs a board could stand on, seen from where the realm begins, best first. An offer to the editor: the file decides. */
  propose(count?: number, size?: number): Omit<Board, 'id' | 'name' | 'content' | 'to'>[]
  /**
   * The plane: where it is (cells), and its place on its round (0 to 1), which the checks may hold still. `call(true)`
   * keeps it in the picture for whoever has something to say on its banner (the eggs): whenever it is out of sight, it
   * is put, unseen, just short of where it comes into the picture on its nearest pass, and flies in. `call(false)` lets it go round.
   */
  readonly plane: {
    at: [number, number, number]; phase: number; hold: number | null; readonly cloth: Screen; call(on: boolean): void; readonly called: boolean; readonly inView: boolean
    /** It has something to say: it comes in to its near round over some seconds, and goes back out when this is false again. */
    loud: boolean
    /** How far it has come in: 0 on its own round, 1 on the near one. */
    readonly come: number
    /** The cloth's box on the page now (client px), or null where any of it is behind the eye. */
    readonly box: { x0: number; y0: number; x1: number; y1: number } | null
    /** Whether its words can be read now: the whole cloth in the picture, seen more from before it than along it, and under nothing the page lays over the picture (the hour's panel, the keys, a notice). */
    readonly readable: boolean
    /** Starts its round from `start` now: the place is first shown, and where the plane is in the first picture should not be how long the page took to come. */
    begin(): void
  } | null
  /** The editor, in `?boards=edit`. */
  readonly editor: { add(b: Board): void; change(id: string, to: Partial<Board>): void; remove(id: string): void; file(): SignsFile; save(): Promise<string>; select(id: string): void; readonly selected: string | null } | null
}

export interface Needs {
  file: SignsFile
  device: GPUDevice
  format: GPUTextureFormat
  passes: { add(name: string, draw: (encoder: GPUCommandEncoder, to: Target, view: View, time: number) => void): void }
  pieces: Pieces
  /** Puts an edit in the world and tells whoever moves things. */
  lay(edit: Edit): void
  /**
   * Told the box round the lettering boards' letters whenever they are laid (finest cells, low and high corners), or
   * null: what the far model's wedge, which takes over from 100 m, must leave to the cells they are (far.ts `keep`).
   */
  kept?(box: number[] | null): void
  /** How many edits the world holds. */
  done(): number
  kind(x: number, y: number, z: number): number
  /** Where feet would stand at a column and what the ground itself is, cells; what its top is made of. */
  feet(x: number, z: number): number
  ground(x: number, z: number): number
  top(x: number, z: number): number
  pose: { x: number; y: number; z: number; yaw: number; pitch: number }
  began: { x: number; y: number; z: number; yaw: number; pitch: number }
  view(): View
  canvas: HTMLCanvasElement
  input: Input
  hud: Hud
  day(): number
  /** How far windows, lamps and signs are lit, 0 to 1 (march.ts `lights`): the lettering boards' letters strike from a half. */
  lights?(): number
  /** Tells the march the lettering boards' own light (letterlight.ts, march.ts `letters`). */
  letters?(data: Float32Array | null): void
  /** The far model's depth as its last draw left it, if there is one (far.ts). */
  faced(): GPUTextureView | null
  /** How far cloud, rain or fog take the daylight off what the day lights, 0 to 1. */
  dull(): number
  /** How far off what is straight ahead is, cells. */
  pick(): Promise<{ t: number } | null>
  /** Up off one's feet: a flight to a board is flown. */
  aloft(): void
  /** How far from the eye the far model's faces take over from cells (0: never), cells. */
  reach(): number
  /** How big the cells the world shows at a point are now, in its finest cells (1, 2, 4 and so on): the finest of its boxes that holds the point. */
  cell(x: number, y: number, z: number): number
  /** A board that does something (`does`) was clicked or tapped, or its button pressed. False where there is nothing
   * left for it to do (EXPLORE with the visitor already in): a click on it is then any click on the picture. */
  does?(board: Board): boolean
  /** The first view's eye as the page opens it, framed for how the phone is held now (main.ts `firstEye`): metres, radians, degrees. Where there is none, where the realm begins. */
  home?(): { at: readonly number[]; yaw: number; pitch: number; fov: number }
  /** The eye's angle from top to bottom, degrees, and setting it. */
  fov?(): number
  setFov?(degrees: number): void
  /** The realm's own way back to the first view (explore.ts `back`), when the visitor is in it: true if it was taken. */
  back?(): boolean
  /** The same for what stands at a point (finest cells, x and z): nearer in the far model's wedge. Infinity where there is no far model. */
  handover(x: number, z: number): number
  edit: boolean
}

/** A panel showing words with no colours of its own: a deep blue running to violet, as a board between two bookings shows its owner's. */
const SCREEN: Style = { ground: '#1038ff', ground2: '#7a1cff', ink: '#ffffff', glows: true }
// (Lit by night as from the plane: an egg speaks on it in the dark, eggs.ts; 0.5 reads from the park, 0.2 did not.)
const CLOTH: Style = { ground: '#f6f1e4', ink: '#c2261c', glows: false, least: 0.5 }
/** An LED every 10 cm: a cell each, which from before the board (where a flight to it ends) is some five pixels. */
const LED = 1
/** The rim of the cabinet round its panel, cells. */
const RIM = 4
/**
 * A lettering board as a face: its panel, its posts and its letters as the day shows its cells, and its letters fully
 * lit. Further off than CELLS_TO (cells) it is never its cells: a 4 m letter is 16 px there through the park's lens.
 */
const FACE = { panel: [20, 20, 20], post: [58, 60, 64], lamp: [198, 198, 190], lit: [255, 250, 232] }, CELLS_TO = 4000

export async function boards(o: Needs): Promise<Boards> {
  // The face's display set, or on a phone (bay.ts `DEVICE`: one fewer level of cells) its compact set (shape).
  // A face that does not come leaves the lettering boards out, and only them: the screens, logos and banner need none.
  // A board too small for the display set's cells to be four of the world's (EXPLORE, 3 m) is set in the compact set
  // too: the display set's hairlines a cell wide were finer than its face from the park holds (618 of its 748 squares).
  const sizeOf = (b: Board): Size => lettersAsked ?? b.letters ?? (DEVICE === 'phone' || Math.round(((b.size as number) * M) / DISPLAY_CAP) < 4 ? 'compact' : 'display')
  const sizes = [...new Set(o.file.boards.filter((b) => b.type === 'lettering').map(sizeOf))]
  /** Whether the boards' own light is off (`dark`), and how far it is on now: the city's lights, or none while it is off. */
  let dark = false
  const lights = () => (dark ? 0 : o.lights?.() ?? 0)
  const [drawn, glow, faces] = await Promise.all([screensOf(o.device, o.format), letterLight(o.device, o.format, lights), Promise.all(sizes.map((z) => letteringFace(z))).then((got) => new Map(sizes.map((z, i) => [z, got[i]]))).catch((e: unknown) => { console.warn(`no lettering boards: their face did not come (${e instanceof Error ? e.message : String(e)})`); return null })])
  const faceOf = (b: Board) => faces?.get(sizeOf(b)) ?? null
  o.passes.add('signs', (encoder, to, view, time) => {
    // Past where the far model's faces take over, a board's cells are not drawn: nor is its screen.
    const reach = o.reach()
    let turned = false
    for (const s of stood.values()) {
      if (!s.shape) continue
      // A lettering board: its cells, or from too far for them its face (`asCells`), painted again if the world changed under it.
      // (Each frame, as a far face is made again when its size changes and a reset lays the boards again.)
      if (s.screen) s.screen.unlit = dark
      if (s.far) s.far.unlit = dark
      if (s.far) { const face = !asCells(s, view.eye), dusk = (dark ? 'dark ' : '') + (glow.power[s.b.id] ?? []).map((p) => Math.round(Math.min(1, p) * 8)).join(''); if (face !== s.faced) { s.faced = face; turned = true } s.far.hidden = !face; if (face && s.stale) paintFar(s, true); else if (face && dusk !== s.dusk) { s.dusk = dusk; inkFar(s) } }
      if (!s.screen) continue
      if (s.b.type === 'digital') s.screen.hidden = reach > 0 && Math.hypot(s.shape.middle[0] - view.eye[0], s.shape.middle[2] - view.eye[2]) > reach
      else if (s.b.type === 'logo') { seat(s, view.eye); sharpen(s, view, to.size) }
    }
    if (turned) keep()
    // The letters' own light: the march is told it for the next frame, and their halos are drawn over this one.
    // (Dark, the lamps on arms are said to be off too: the march washes no panel with them and lights no bulb of theirs.)
    const told = glow.step(lights(), seen)
    if (dark) told[7] = -1
    o.letters?.(told)
    drawn.draw(encoder, to, view, time, o.day(), o.dull(), o.faced())
    glow.draw(encoder, to, view, o.faced())
  })
  /** Whether a board is in the picture now (its middle before the eye and on the picture). */
  const seen = (id: string) => { const w = where(id), r = o.canvas.getBoundingClientRect(); return !!w && w.x > r.left && w.x < r.right && w.y > r.top && w.y < r.bottom }
  const records: Board[] = o.file.boards.map((b) => ({ ...b }))
  /** A board as it stands: its record, its cells as laid, its screen if it has one. */
  interface Stood { b: Board; shape: Shape | null; text: string; screen: Screen | null; content: Content | null; tiles: [number, number]; gone: () => void; /** A lettering board's face (FACE): how big its picture is, how much of each pixel of it is panel, post and lamp (three shares of 255), whether the world changed since it was painted, whether it is shown now in place of the cells, and how far its letters are lit (`light`). */ far?: Screen; farSize?: string; farKinds?: Uint8Array; stale?: boolean; faced?: boolean; lit?: number; /** Which letter each of its picture's columns is (-1 none), and how lit its letters were when it was last inked (letterlight.ts, in eighths). */ farLetter?: Int16Array; dusk?: string; /** A logo: how far out from `at` along its normal its face is now, cells (`seat`), and when its wall as cells was last looked for. */ out?: number; /** A logo: how many pixels of the picture across and up its sign was last painted for (`sharpen`), and how to paint it for a size. */ seen?: string; sharp?: (seen?: [number, number]) => void; /** A logo: how wide its mark is for its height (logos.ts). */ wide?: number; looked?: number; cells?: number | null; /** A roof sign: how far over `at` the cells' roof is, cells, while the eye is near enough for the tower to be cells. */ up?: number }
  const stood = new Map<string, Stood>()
  let laid = 0
  const lay = (edit: Edit) => { laid++; o.lay(edit) }
  const emptied = (s: Shape): Edit => {
    // Every cell of its box, from its foot up, as nothing.
    const [x0, y0, z0, x1, y1, z1] = s.box, runs: number[] = []
    for (let y = y0 + 2; y < y1; y++) for (let z = z0; z < z1; z++) runs.push(x0, x1, y, z, 0)
    return rows(Int32Array.from(runs), s.box)
  }
  const place = (s: Stood) => {
    const sh = s.shape!, sc = s.screen
    if (!sc) return
    if (s.b.type === 'logo') {
      const out = s.out ?? 0
      // A roof sign's picture is the sign over its frame: the legs under it, down into the roof.
      const legs = s.b.mount === 'roof' ? sh.high * STAND + SUNK : 0
      sc.at = [sh.middle[0] + sh.normal[0] * out, sh.middle[1] - legs / 2 + (s.up ?? 0), sh.middle[2] + sh.normal[2] * out]; sc.hu = [sh.right[0] * sh.wide / 2, 0, sh.right[2] * sh.wide / 2]; sc.hv = [0, (sh.high + legs) / 2, 0]
      return
    }
    // Its panel: on the cabinet's face, inside a rim of four cells.
    sc.at = [sh.middle[0] + sh.normal[0] * 0.5, sh.middle[1], sh.middle[2] + sh.normal[2] * 0.5]
    sc.hu = [sh.right[0] * (sh.wide / 2 - RIM), 0, sh.right[2] * (sh.wide / 2 - RIM)]
    sc.hv = [0, sh.high / 2 - RIM, 0]
  }
  /**
   * Whether a lettering board is shown as its cells from an eye: near enough (CELLS_TO, and the far model's reach),
   * the world's cells there no coarser than a letter's stroke (on a phone they are 1.6 m from 200 m off, and a 4 m
   * letter was a smear), and its letters not lit (`light`). Otherwise as its face.
   */
  const asCells = (s: Stood, eye: readonly number[]) => {
    const sh = s.shape!, reach = o.reach()
    return !s.lit && Math.hypot(sh.middle[0] - eye[0], sh.middle[1] - eye[1], sh.middle[2] - eye[2]) < Math.min(CELLS_TO, reach > 0 ? reach : Infinity) && o.cell(sh.middle[0], sh.middle[1], sh.middle[2]) <= (sh.px ?? 1)
  }
  /**
   * A lettering board's face: a picture of the front of its cells as the world has them now (a letter that fell is
   * not on it), from its posts' feet to its panels' top, a cell proud of them.
   * When `fromWorld` is false (freshly laid), samples directly from `s.shape.runs` so boot never forces the page's
   * WASM core to generate distant 64³ sectors synchronously on the main thread.
   */
  const paintFar = (s: Stood, fromWorld = false) => {
    // A pixel of it a quarter of a letter's stroke, and what it is the mean of the cells under it: from where a face
    // is shown a stroke is a pixel or two of the picture, and one cell picked out of nine lost a letter's diagonals.
    const sh = s.shape!, low = sh.box[1], tall = sh.box[4] - low, step = Math.max(1, Math.round((sh.px ?? 4) / 4)), w = Math.ceil(sh.wide / step), h = Math.ceil(tall / step)
    if (s.farSize !== `${w}x${h}`) { s.far?.destroy(); s.far = drawn.add({ pixels: [w, h], style: { ground: '#000', ink: '#fff', glows: true, glow: 0.5, dim: 0.9 } }); s.farSize = `${w}x${h}`; s.far.hidden = !s.faced }
    const kinds = (s.farKinds = new Uint8Array(w * h * 3)), each = 255 / (step * step)
    const letters = (sh.letters ?? []).filter((l): l is Laid => !!l)
    s.farLetter = Int16Array.from({ length: w }, (_, i) => letters.findIndex((l) => i * step + step / 2 >= l.k0 && i * step + step / 2 < l.k0 + l.pitch))
    let front: Uint8Array | null = null
    if (!fromWorld && sh.runs.length && sh.wide > 0 && tall > 0) {
      front = new Uint8Array(sh.wide * tall)
      const runs = sh.runs, ax = sh.right[0] !== 0, dir = ax ? sh.right[0] : sh.right[2]
      const plane = Math.floor((ax ? sh.middle[2] - sh.normal[2] * 0.5 : sh.middle[0] - sh.normal[0] * 0.5))
      const org = Math.round((ax ? sh.middle[0] : sh.middle[2]) - (dir > 0 ? sh.wide / 2 : -sh.wide / 2 + 1))
      for (let r = 0; r < runs.length; r += 5) {
        const x0 = runs[r], x1 = runs[r + 1], y = runs[r + 2], z = runs[r + 3], k = runs[r + 4] & 15
        if (!k || y < low || y >= low + tall) continue
        const row = (y - low) * sh.wide
        if (ax) { if (z === plane) for (let x = x0; x < x1; x++) { const c = dir > 0 ? x - org : org - x; if (c >= 0 && c < sh.wide) front[row + c] = k } }
        else if (plane >= x0 && plane < x1) { const c = dir > 0 ? z - org : org - z; if (c >= 0 && c < sh.wide) front[row + c] = k }
      }
    }
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      let s0 = 0, s1 = 0, s2 = 0
      for (let v = 0; v < step; v++) for (let u = 0; u < step; u++) {
        let kind: number
        if (front) {
          const col = i * step + u, ky = low + tall - 1 - (j * step + v)
          kind = col < sh.wide && ky >= low && ky < low + tall ? front[(ky - low) * sh.wide + col] : 0
        } else {
          const along = i * step + u + 0.5 - sh.wide / 2
          kind = o.kind(Math.floor(sh.middle[0] + sh.right[0] * along - sh.normal[0] * 0.5), Math.floor(low + tall - j * step - v - 0.5), Math.floor(sh.middle[2] + sh.right[2] * along - sh.normal[2] * 0.5)) & 15
        }
        if (kind) { if (kind === LAMP) s2 += each; else if (kind === STEEL) s1 += each; else s0 += each }
      }
      const off = (j * w + i) * 3
      kinds[off] = s0; kinds[off + 1] = s1; kinds[off + 2] = s2
    }
    s.stale = false
    s.far!.at = [sh.middle[0] + sh.normal[0], low + tall / 2, sh.middle[2] + sh.normal[2]]; s.far!.hu = [(sh.right[0] * sh.wide) / 2, 0, (sh.right[2] * sh.wide) / 2]; s.far!.hv = [0, tall / 2, 0]
    inkFar(s)
  }
  /**
   * Its picture from what each pixel is, its lamp as far lit as it is (`light`); lit, it glows by night as a lit sign does.
   * By night each letter is as lit as its own lamp is (letterlight.ts: they strike a beat apart as the lights come on),
   * warm, as the lamps over the cells' own make them (they were a cold grey beside BLOG's).
   */
  const inkFar = (s: Stood) => {
    const kinds = s.farKinds!, power = glow.power[s.b.id] ?? [], w = s.farLetter?.length ?? 1, own = dark ? 0 : s.lit ?? 0
    const lamps = Array.from({ length: Math.max(1, power.length) }, (_, k) => { const lit = Math.max(own, 0.55 * Math.min(1, power[k] ?? 0)); return FACE.lamp.map((v, c) => v + (FACE.lit[c] - v) * lit) })
    const unlit = FACE.lamp.map((v, c) => v + (FACE.lit[c] - v) * own)
    ;(s.far as Screen & { style: Style }).style.glow = 0.5 + own
    s.far!.paint((pen, w, h) => {
      const picture = pen.createImageData(w, h)
      for (let i = 0; i < w * h; i++) {
        const panel = kinds[i * 3], post = kinds[i * 3 + 1], lit = kinds[i * 3 + 2], all = panel + post + lit
        // (Cut where under half of it is anything: a post's edge, the gap under the beam.)
        const letter = s.farLetter?.[i % w] ?? -1, lamp = letter >= 0 ? lamps[letter] ?? unlit : unlit
        if (all >= 127) picture.data.set([0, 1, 2].map((k) => (FACE.panel[k] * panel + FACE.post[k] * post + lamp[k] * lit) / all).concat(255), i * 4)
      }
      pen.putImageData(picture, 0, 0)
    })
  }
  /** The box round the lettering boards shown as their cells, grown by two of the coarsest cells the march meets them in from the park (80 cm). */
  const keep = () => {
    const boxes = [...stood.values()].filter((s) => s.b.type === 'lettering' && s.shape && !s.faced).map((s) => s.shape!.box), grow = 16
    o.kept?.(boxes.length ? [0, 1, 2].map((k) => Math.min(...boxes.map((b) => b[k])) - grow).concat([3, 4, 5].map((k) => Math.max(...boxes.map((b) => b[k])) + grow)) : null)
  }
  /**
   * A logo's seat. Its `at` is on the wall the far model draws (sf/boards.mjs `seat` measured it). Nearer than the far
   * model's handover the tower is cells, whose wall is the city's outline and not the lidar's: there the sign lies on
   * that wall, found by walking in through the cells at five points of the sign (the outermost of them: the plane of
   * its piers), 40 cm proud of it. Looked for twice a second while the eye is near and it is not found (the cells may not be made yet).
   */
  const seat = (s: Stood, eye: readonly number[]) => {
    const sh = s.shape!, near = Math.hypot(sh.middle[0] - eye[0], sh.middle[1] - eye[1], sh.middle[2] - eye[2]) < o.handover(sh.middle[0], sh.middle[2])
    if (s.b.mount === 'roof') {
      // On a roof: the cells' roof under its foot, where the tower is cells (looked for as its wall is, and only a roof within 12 m of the far model's: a spire beside it is not its roof).
      if (near && s.cells == null && performance.now() - (s.looked ?? -1e9) > 500) {
        s.looked = performance.now()
        const feet = o.feet(Math.round(s.b.at[0]), Math.round(s.b.at[2])) - s.b.at[1]
        s.cells = Math.abs(feet) < 120 && o.kind(Math.round(s.b.at[0]), Math.round(s.b.at[1] + feet - 2), Math.round(s.b.at[2])) ? feet : null
      }
      const up = near && s.cells != null ? s.cells : 0
      if (up !== (s.up ?? 0)) { s.up = up; place(s) }
      return
    }
    if (near && s.cells == null && performance.now() - (s.looked ?? -1e9) > 500) {
      s.looked = performance.now()
      const reach = Math.round((s.b.search ?? 20) * M)
      let most: number | null = null
      for (const [u, v] of [[0, 0], [-0.35, -0.3], [0.35, -0.3], [-0.35, 0.3], [0.35, 0.3]]) for (let d = reach; d >= -reach; d--) {
        const x = sh.middle[0] + sh.right[0] * u * sh.wide + sh.normal[0] * d, z = sh.middle[2] + sh.right[2] * u * sh.wide + sh.normal[2] * d
        if (o.kind(Math.floor(x), Math.floor(sh.middle[1] + v * sh.high), Math.floor(z))) { if (most === null || d > most) most = d; break }
      }
      s.cells = most === null ? null : most + 4
    }
    const out = near && s.cells != null ? s.cells : 0
    if (out !== s.out) { s.out = out; place(s) }
  }
  /**
   * A logo's picture drawn for the size it is seen at (logos.ts `sign`): how many of the drawn picture's pixels its
   * sign covers across and up, from its edges' middles as they stand (`place`), so that a sign seen from one side or
   * from under is as narrow or as short as it looks. Painted again when that changes, in whole pixels, until it is as
   * big as its picture (LOGO_PX) both ways, past which it is the picture itself.
   */
  const sharpen = (s: Stood, view: View, size: readonly number[]) => {
    const sh = s.shape!, out = s.out ?? 0, m = [sh.middle[0] + sh.normal[0] * out, sh.middle[1] + (s.up ?? 0), sh.middle[2] + sh.normal[2] * out], k = size[1] / (2 * view.tanHalf)
    const on = (u: number, v: number) => {
      const d = [m[0] + sh.right[0] * u - view.eye[0], m[1] + v - view.eye[1], m[2] + sh.right[2] * u - view.eye[2]], far = d[0] * view.forward[0] + d[1] * view.forward[1] + d[2] * view.forward[2]
      return far > 1 ? [(k * (d[0] * view.right[0] + d[1] * view.right[1] + d[2] * view.right[2])) / far, (k * (d[0] * view.up[0] + d[1] * view.up[1] + d[2] * view.up[2])) / far] : null
    }
    const l = on(-sh.wide / 2, 0), r = on(sh.wide / 2, 0), t = on(0, sh.high / 2), b = on(0, -sh.high / 2)
    if (!s.sharp) return
    // (Part of it beside or behind the eye: it is near, and its picture is the whole one.)
    const seen: [number, number] | undefined = l && r && t && b ? [Math.floor(Math.hypot(r[0] - l[0], r[1] - l[1])), Math.floor(Math.hypot(t[0] - b[0], t[1] - b[1]))] : undefined
    const key = !seen || (seen[0] >= LOGO_PX * (s.wide ?? 1) && seen[1] >= LOGO_PX) ? 'whole' : [Math.min(seen[0], LOGO_PX * (s.wide ?? 1)), Math.min(seen[1], LOGO_PX)].join('x')
    if (key === s.seen) return
    s.seen = key
    s.sharp(key === 'whole' ? undefined : seen)
  }
  let seenEdits = -1
  let standingEdits = -1
  const stand = (s: Stood, again = false) => {
    const b = s.b, face = faceOf(b), text = b.type === 'lettering' ? lettered(s.content && 'text' in s.content ? s.content.text : '', face!) : ''
    if (!again && s.shape && s.text === text) return
    if (!again && s.shape) lay(emptied(s.shape))
    s.shape = shape(b, text, face ?? undefined); s.text = text
    if (s.shape.runs.length) lay(rows(s.shape.runs, s.shape.box))
    place(s)
    if (b.type === 'lettering') {
      s.faced ??= !asCells(s, [o.pose.x * M, o.pose.y * M, o.pose.z * M])
      paintFar(s, false)
      keep()
      glow.board(b.id, litOf(b, s.shape))
      glow.standing(b.id, (s.shape.letters ?? []).filter((l): l is Laid => !!l).map((l) => l.squares.filter((q) => q.lit).map(() => true)))
    }
    seenEdits = o.done()
    standingEdits = seenEdits
  }
  /** A lettering board's letters as their light knows them (letterlight.ts): each one's box, which way it faces, the middle of each cell of its lamp. */
  const litOf = (b: Board, sh: Shape): LitLetter[] => (sh.letters ?? []).filter((l): l is Laid => !!l).map((l) => {
    const y0 = sh.middle[1] - sh.high / 2, at = (along: number, back: number) => [sh.middle[0] + sh.right[0] * along - sh.normal[0] * back, sh.middle[2] + sh.right[2] * along - sh.normal[2] * back]
    const a = at(l.k0 - sh.wide / 2, 2.5), c = at(l.k0 + l.pitch - sh.wide / 2, -1)
    return {
      lo: [Math.min(a[0], c[0]), y0, Math.min(a[1], c[1])], hi: [Math.max(a[0], c[0]), y0 + sh.high, Math.max(a[1], c[1])], facing: b.facing, cell: sh.px!,
      // (A square's middle: its `along` and `y` are a cell's to sample, half a cell along and down from it.)
      cells: l.squares.filter((q) => q.lit).map((q) => [sh.middle[0] + sh.right[0] * (q.along - 0.5), q.y + 0.5, sh.middle[2] + sh.right[2] * (q.along - 0.5)] as [number, number, number]),
    }
  })
  // What stands of each lettering board's lamp, twice a second when edits have occurred: a halo only over the cells of it that are there.
  setInterval(() => {
    const n = o.done()
    if (n === standingEdits) return
    standingEdits = n
    for (const s of stood.values()) {
      const sh = s.shape
      if (s.b.type !== 'lettering' || !sh?.letters) continue
      glow.standing(s.b.id, sh.letters.filter((l): l is Laid => !!l).map((l) => l.squares.filter((q) => q.lit).map(({ along, y }) => (o.kind(Math.floor(sh.middle[0] + sh.right[0] * along - sh.normal[0] * 0.5), Math.floor(y), Math.floor(sh.middle[2] + sh.right[2] * along - sh.normal[2] * 0.5)) & 15) === LAMP)))
    }
  }, 500)
  const bring = (b: Board) => {
    if (b.type === 'lettering' && !faceOf(b)) return
    const s: Stood = { b, shape: null, text: '', screen: null, content: null, tiles: [1, 1], gone: () => {} }
    if (b.type === 'logo') {
      const mark = MARKS[b.logo ?? '']
      if (!mark) throw new Error(`the logo "${b.logo}" of the board ${b.id} is none of ${Object.keys(MARKS).join(', ')}`)
      // (Lit as channel letters are, not as a screen is: a screen's light on a mark's white was a blot by night from before it.)
      const roof = b.mount === 'roof', wide = Math.round((LOGO_PX * mark.wide) / 4) * 4, legs = roof ? Math.round((LOGO_PX * (STAND + SUNK / ((b.size as number) * M))) / 4) * 4 : 0
      // (A roof sign is read from behind too, the right way round, as the banner is.)
      s.screen = drawn.add({ pixels: [wide, LOGO_PX + legs], both: roof, style: { ground: '#000', ink: '#fff', glows: true, glow: 0.3, dim: 0.72 } })
      s.sharp = (seen) => s.screen!.paint((pen, w, h) => signOf(pen, mark, w, h - legs, legs, seen)); s.wide = mark.wide
      s.screen.paint((pen, w, h) => signOf(pen, mark, w, h - legs, legs))
      stood.set(b.id, s)
      stand(s)
      return
    }
    if (b.type === 'digital') {
      const [w, h] = b.size as [number, number]
      s.tiles = [Math.max(1, Math.min(8, Math.round(w / 1.6))), Math.max(1, Math.min(4, Math.round(h / 1.6)))]
      // A pixel of its picture an LED: as many as its panel has, inside the rim.
      const wide = Math.max(16, Math.round((w * M) / 8) * 8), high = Math.max(16, Math.round((h * M) / 8) * 8), c = b.colors
      s.screen = drawn.add({ pixels: [Math.round((wide - 2 * RIM) / LED), Math.round((high - 2 * RIM) / LED)], tiles: s.tiles, leds: true, style: c ? { ground: typeof c.ground === 'string' ? c.ground : c.ground[0], ground2: typeof c.ground === 'string' ? undefined : c.ground[1], ink: c.ink, glows: true } : SCREEN })
    }
    stood.set(b.id, s)
    s.gone = signs.add({ id: b.id, kind: b.type, name: b.name, accepts: b.type === 'lettering' ? ['text'] : ['text', 'image', 'video'], own: b.content, show: (content) => { s.content = content; if (b.type === 'lettering') stand(s); else { if (!s.shape) stand(s); s.screen!.show(content) } } })
  }
  const drop = (id: string) => { const s = stood.get(id); if (!s) return; if (s.shape) lay(emptied(s.shape)); s.screen?.destroy(); s.far?.destroy(); s.gone(); stood.delete(id); keep(); glow.board(id, null) }
  for (const b of records) bring(b)

  // ── What still stands: a letter by its lamp, a screen's tile by the housing behind it ──
  const letterStands = (s: Stood, i: number) => {
    const sh = s.shape!, letter = sh.letters?.[i]
    if (!letter) return true
    let lamp = 0, there = 0
    for (const { along, y } of letter.squares.filter((q) => q.lit)) {
      lamp++
      if ((o.kind(Math.floor(sh.middle[0] + sh.right[0] * along - sh.normal[0] * 0.5), Math.floor(y), Math.floor(sh.middle[2] + sh.right[2] * along - sh.normal[2] * 0.5)) & 15) === LAMP) there++
    }
    return there * 2 > lamp
  }
  const standing = (id: string) => {
    const s = stood.get(id)
    if (!s?.shape) return { letters: '', whole: false }
    if (s.b.type === 'lettering') { const letters = [...s.text].filter((_, i) => letterStands(s, i)).join(''); return { letters, whole: letters === s.text } }
    if (s.b.type === 'logo') return { letters: s.b.logo ?? '', whole: true }
    const n = s.tiles[0] * s.tiles[1]
    let lit = 0
    for (let i = 0; i < n; i++) if ((s.screen!.mask >>> i) & 1) lit++
    return { letters: `${lit}/${n}`, whole: lit === n }
  }
  /** Each tile of a screen shows while the housing behind its middle is there. */
  const masks = () => {
    for (const s of stood.values()) {
      if (!s.screen || !s.shape || s.b.type !== 'digital') continue
      const sh = s.shape, [cols, rws] = s.tiles
      let mask = 0
      for (let j = 0; j < rws; j++) for (let i = 0; i < cols; i++) {
        // Nine looks at the housing behind it: lit while most of it is there.
        let there = 0
        for (const u of [0.2, 0.5, 0.8]) for (const w of [0.2, 0.5, 0.8]) {
          const along = ((i + u) / cols - 0.5) * sh.wide, y = sh.middle[1] - sh.high / 2 + ((j + w) / rws) * sh.high
          if (o.kind(Math.floor(sh.middle[0] + sh.right[0] * along - sh.normal[0] * 0.5), Math.floor(y), Math.floor(sh.middle[2] + sh.right[2] * along - sh.normal[2] * 0.5))) there++
        }
        if (there > 4) mask |= 1 << (j * cols + i)
      }
      s.screen.mask = mask >>> 0
    }
  }
  // Asked only when the world has changed since: nothing a frame.
  seenEdits = o.done()
  standingEdits = seenEdits
  setInterval(() => { const n = o.done(); if (n !== seenEdits) { seenEdits = n; masks(); for (const s of stood.values()) if (s.far) s.stale = true } }, 400)

  // ── The plane and its banner ──
  const whole_ = o.file.banner ?? null, shape0 = o.canvas.getBoundingClientRect()
  const towed: Banner | null = whole_ ? (whole_.upright && shape0.height > shape0.width ? { ...whole_, ...whole_.upright } : whole_) : null
  let flown: { piece: Piece; cloth: Screen; line: Screen; at: [number, number, number]; phase: number; hold: number | null; call(on: boolean): void; called: boolean; inView: boolean; loud: boolean; readonly come: number; readonly box: { x0: number; y0: number; x1: number; y1: number } | null; readonly readable: boolean; begin(): void } | null = null
  /** Keeps a called plane in the picture (below, where the picture's projection is): every frame of its flight. */
  let summon: (() => void) | null = null
  let boxAt: (phase: number) => { x0: number; y0: number; x1: number; y1: number } | null = () => null, read: (phase: number) => boolean = () => false
  if (towed) {
    const model = plane(), born = thing(model.kinds, model.size)
    born.com = [model.size[0] / 2, model.size[1] / 2, model.size[2] / 2]
    const piece = o.pieces.add(born)
    const [long, tall] = towed.size
    const cloth = drawn.add({ pixels: [1024, Math.max(64, Math.round((1024 * tall) / long / 4) * 4)], both: true, style: CLOTH })
    cloth.wave = 5
    const line = drawn.add({ pixels: [4, 4], both: true, style: { ground: '#2a2a2a', ink: '#2a2a2a', glows: false } })
    line.show(null)
    signs.add({ id: 'banner', kind: 'banner', name: 'The banner a plane tows', accepts: ['text', 'image', 'video'], own: towed.content, show: (content) => cloth.show(content) })
    /**
     * A round: a circle, or a long round (an ellipse) lying along `bearing`, higher on one long side than the other.
     * Flown at one speed: where it is after so many cells is looked up in the round's own lengths. With it, the sizes
     * of what flies it there (cells): the plane's cell and half its length, the line's length, drop and thickness (as
     * the plane is big), half the cloth's length and its height.
     */
    const roundOf = (b: Omit<Banner, 'content' | 'upright' | 'near'>) => {
      const [A, B] = (typeof b.radius === 'number' ? [b.radius, b.radius] : b.radius).map((r) => r * M), lie = ((b.bearing ?? 0) * Math.PI) / 180, rise = (b.rise ?? 0) * M
      const on = (a: number): [number, number, number] => { const u = A * Math.cos(a), v = B * Math.sin(a); return [b.around[0] + u * Math.cos(lie) - v * Math.sin(lie), b.height * M + rise * Math.sin(a), b.around[1] + u * Math.sin(lie) + v * Math.cos(lie)] }
      const STEPS = 720, lengths = new Float64Array(STEPS + 1)
      for (let i = 1, last = on(0); i <= STEPS; i++) { const p = on((i / STEPS) * 2 * Math.PI); lengths[i] = lengths[i - 1] + Math.hypot(p[0] - last[0], p[2] - last[2]); last = p }
      const whole = lengths[STEPS], cell = b.craft ?? 2, big = cell / 2
      /** Where it is `s` cells along its round. */
      const along = (s: number): [number, number, number] => {
        const d = ((s % whole) + whole) % whole
        let lo = 0, hi = STEPS
        while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (lengths[mid] <= d) lo = mid; else hi = mid }
        return on(((lo + (d - lengths[lo]) / Math.max(1e-6, lengths[hi] - lengths[lo])) / STEPS) * 2 * Math.PI)
      }
      return { along, whole, lap: whole / (b.speed * M), cell, body: (model.size[0] * cell) / 2, gap: 12 * M * big, drop: 12 * big, line: 0.8 * big, half: (b.size[0] * M) / 2, tall: b.size[1] * M }
    }
    type Round = ReturnType<typeof roundOf>
    const own = roundOf(towed), near = towed.near ? roundOf({ ...towed, ...towed.near }) : own
    /** How far it has come in to say something (0 on its own round, 1 on the near one), eased. */
    let come = 0
    const eased = () => come * come * (3 - 2 * come)
    /** A size of what flies, as far in as it has come. */
    const now = (pick: (r: Round) => number) => { const a = pick(own); return near === own || come === 0 ? a : a + (pick(near) - a) * eased() }
    /** A point of what flies at a place on the round (0 to 1), `back` cells behind the plane's middle along it: between the two rounds as far in as it has come. Coming in, it is a plane that grows as it nears. */
    const point = (phase: number, back: (r: Round) => number): [number, number, number] => {
      const p = own.along(phase * own.whole - back(own))
      if (near === own || come === 0) return p
      const q = near.along(phase * near.whole - back(near)), e = eased()
      return [p[0] + (q[0] - p[0]) * e, p[1] + (q[1] - p[1]) * e, p[2] + (q[2] - p[2]) * e]
    }
    /** Where on its round it is as it flies on, 0 to 1 (held, `flown.phase` is where it is held). */
    let running = towed.start ?? 0, last = performance.now()
    flown = { piece, cloth, line, at: [0, 0, 0], phase: 0, hold: null, called: false, inView: false, loud: false, get come() { return come }, call(on) { this.called = on }, get box() { return boxAt(this.phase) }, get readable() { return read(this.phase) }, begin() { running = towed.start ?? 0; last = performance.now() } }
    /** Where the plane is and where its cloth's two ends are, at a place on its round (0 to 1). */
    const parts = (phase: number) => [point(phase, () => 0), point(phase, (r) => r.body + r.gap), point(phase, (r) => r.body + r.gap + 2 * r.half)]
    let looked = 0
    /** The cloth's box on the page at a place on its round, as `fly` hangs it there (client px); null where any corner is behind the eye. */
    boxAt = (phase: number) => {
      const [, a, b] = parts(phase), rect = o.canvas.getBoundingClientRect(), v = o.view(), aspect = rect.width / Math.max(1, rect.height)
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
      for (const end of [a, b]) for (const up of [-1, 1]) {
        const at = onPicture([end[0], end[1] - now((r) => r.drop) + (up * now((r) => r.tall)) / 2, end[2]], v, aspect)
        if (!at) return null
        const x = rect.left + ((at.x + 1) / 2) * rect.width, y = rect.top + ((1 - at.y) / 2) * rect.height
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y)
      }
      return { x0, y0, x1, y1 }
    }
    /** What the page lays over the picture, as boxes of the page: asked for four times a second. */
    let laid: DOMRect[] = [], laidAt = -1e9
    const overlays = () => {
      if (performance.now() - laidAt < 250) return laid
      laidAt = performance.now()
      laid = [...document.querySelectorAll<HTMLElement>('#realm .sky, #realm .fold, #realm .tools, #hud, #notices p, #first .corner > button')].filter((el) => el.checkVisibility?.({ visibilityProperty: true, opacityProperty: true }) ?? true).map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0)
      return laid
    }
    read = (phase: number) => {
      const box = boxAt(phase), rect = o.canvas.getBoundingClientRect()
      if (!box || box.x0 < rect.left || box.y0 < rect.top || box.x1 > rect.right || box.y1 > rect.bottom) return false
      // As long on the page as half of what it is seen square on from there: turning at an end of its round it is seen along.
      const [, a, b] = parts(phase), v = o.view(), far = Math.hypot((a[0] + b[0]) / 2 - v.eye[0], (a[1] + b[1]) / 2 - v.eye[1], (a[2] + b[2]) / 2 - v.eye[2])
      if (box.x1 - box.x0 < 0.5 * (now((r) => 2 * r.half) / far / (2 * v.tanHalf)) * rect.height) return false
      return !overlays().some((r) => box.x0 < r.right + 4 && box.x1 > r.left - 4 && box.y0 < r.bottom + 4 && box.y1 > r.top - 4)
    }
    // (Run from its flight, which first runs before `onPicture` below is made: it is not called before an egg calls it.)
    summon = () => {
      const f = flown!
      if (!f.called || f.hold !== null) { f.inView = false; return }
      const rect = o.canvas.getBoundingClientRect(), v = o.view(), aspect = rect.width / Math.max(1, rect.height)
      /** How much of it is on the picture at a place on its round: the plane, the cloth's ends, its middle. */
      const seen = (phase: number, edge: number) => { const [p, a, b] = parts(phase); return [p, a, b, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2] as [number, number, number]].filter((q) => { const at = onPicture([q[0], q[1] - now((r) => r.drop), q[2]], v, aspect); return at && Math.abs(at.x) < edge && Math.abs(at.y) < edge }).length }
      f.inView = seen(f.phase, 1) > 0
      // Out of sight, and not looked for in the last second (from where nothing of the round is seen, it waits).
      if (f.inView || performance.now() - looked < 1000) return
      looked = performance.now()
      // Each stretch of the round where its cloth can be read (whole in the picture, under nothing), and how near it passes there: the nearest.
      const STEP = 1 / 360
      let best: { from: number; far: number } | null = null
      for (let i = 0; i < 360; i++) {
        const phase = (f.phase + i * STEP) % 1
        if (!read(phase)) continue
        const [, a, b] = parts(phase), far = Math.hypot((a[0] + b[0]) / 2 - v.eye[0], (a[1] + b[1]) / 2 - v.eye[1], (a[2] + b[2]) / 2 - v.eye[2])
        // Back along the round to where nothing of it was in the picture yet, and a second more.
        if (!best || far < best.far * 0.8) {
          let from = phase
          for (let k = 0; k < 360 && seen(from, 1.05) > 0; k++) from = (from - STEP + 1) % 1
          best = { from: (from - 1 / now((r) => r.lap) + 1) % 1, far }
        }
      }
      if (!best) return
      running = f.phase = best.from
      // It is out of sight there and comes in within a second or two: not looked for again until it has.
      looked = performance.now() + 5000
    }
    const fly = () => {
      const f = flown!, t = performance.now(), dt = Math.min(0.1, (t - last) / 1000)
      last = t
      // It comes in over five seconds when it has something to say, and goes back out as slowly.
      come = Math.max(0, Math.min(1, come + (f.loud ? dt : -dt) / 5))
      running = (running + dt / now((r) => r.lap)) % 1
      f.phase = f.hold ?? running
      summon?.()
      const at = point(f.phase, () => 0), ahead = point(f.phase, (r) => -10 * r.cell), heading = [ahead[0] - at[0], ahead[2] - at[2]], turn = Math.atan2(-heading[1], heading[0])
      f.at = at
      piece.pos = f.at
      piece.cell = now((r) => r.cell)
      // Its nose along its way, banked into the round by how hard it is turning there.
      const next = point(f.phase, (r) => -100 * r.cell), bend = Math.atan2(next[2] - ahead[2], next[0] - ahead[0]) - Math.atan2(heading[1], heading[0])
      const bank = Math.max(-0.5, Math.min(0.5, Math.atan2(Math.sin(bend), Math.cos(bend)) * 1.6)), sn = Math.sin(turn / 2), c = Math.cos(turn / 2), sb = Math.sin(bank / 2), cb = Math.cos(bank / 2)
      piece.rot = [c * sb, sn * cb, -sn * sb, c * cb]
      // The cloth behind it along the round, its leading edge first, a little under its tail; the line from the tail to that edge.
      const [, to, end] = parts(f.phase), from = point(f.phase, (r) => r.body), drop = now((r) => r.drop)
      cloth.at = [(to[0] + end[0]) / 2, (to[1] + end[1]) / 2 - drop, (to[2] + end[2]) / 2]
      cloth.hu = [(to[0] - end[0]) / 2, (to[1] - end[1]) / 2, (to[2] - end[2]) / 2]
      cloth.hv = [0, now((r) => r.tall) / 2, 0]
      line.at = [(from[0] + to[0]) / 2, (from[1] + to[1] - drop) / 2, (from[2] + to[2]) / 2]
      line.hu = [(to[0] - from[0]) / 2, (to[1] - drop - from[1]) / 2, (to[2] - from[2]) / 2]
      line.hv = [0, now((r) => r.line), 0]
      requestAnimationFrame(fly)
    }
    fly()
  }

  // ── Where a board is on the picture, and the flight to it ──
  const corners = (sh: Shape, grow = 0): [number, number, number][] => {
    const hw = sh.wide / 2 + grow, hh = sh.high / 2 + grow
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => [sh.middle[0] + sh.right[0] * hw * i, sh.middle[1] + hh * j, sh.middle[2] + sh.right[2] * hw * i])
  }
  const onPicture = (p: readonly [number, number, number], v: View, aspect: number) => {
    const d = [p[0] - v.eye[0], p[1] - v.eye[1], p[2] - v.eye[2]], far = d[0] * v.forward[0] + d[1] * v.forward[1] + d[2] * v.forward[2]
    return far > 1 ? { x: (d[0] * v.right[0] + d[1] * v.right[1] + d[2] * v.right[2]) / (v.tanHalf * aspect * far), y: (d[0] * v.up[0] + d[1] * v.up[1] + d[2] * v.up[2]) / (v.tanHalf * far), far } : null
  }
  const where = (id: string) => {
    const s = stood.get(id), rect = o.canvas.getBoundingClientRect()
    if (!s?.shape || !rect.width) return null
    const v = o.view(), ps = corners(s.shape).map((p) => onPicture(p, v, rect.width / rect.height))
    if (ps.some((p) => !p)) return null
    const xs = ps.map((p) => rect.left + ((p!.x + 1) / 2) * rect.width), ys = ps.map((p) => rect.top + ((1 - p!.y) / 2) * rect.height)
    // How tall its face is on the picture down its middle: its box is taller where it is seen from one side.
    const tall = ((s.shape.high / ((ps[0]!.far + ps[1]!.far) / 2)) / v.tanHalf / 2) * rect.height
    return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2, wide: Math.max(...xs) - Math.min(...xs), high: Math.max(...ys) - Math.min(...ys), tall, far: ps[0]!.far / M }
  }
  /** The board a point of the page is on (client px): the nearest of those whose face it is inside, a little grown. */
  const thumb = matchMedia('(pointer: coarse)')
  const under = (x: number, y: number): Stood | null => {
    const rect = o.canvas.getBoundingClientRect(), v = o.view(), mx = ((x - rect.left) / rect.width) * 2 - 1, my = 1 - ((y - rect.top) / rect.height) * 2
    let best: Stood | null = null, nearest = Infinity
    for (const s of stood.values()) {
      if (!s.shape) continue
      // (A little grown, and more from far off: a board a kilometre away is a few dozen pixels, and a thumb is wider than its letters.
      // Under a thumb, by 20 px of the picture all round as well: a logo 19 px tall on an upright phone is then a 59 px target,
      // over the 44 a touch target wants, #450.)
      const far = Math.hypot(s.shape.middle[0] - v.eye[0], s.shape.middle[1] - v.eye[1], s.shape.middle[2] - v.eye[2])
      const ps = corners(s.shape, Math.max(6, 0.008 * far, thumb.matches ? (20 / rect.height) * 2 * v.tanHalf * far : 0)).map((p) => onPicture(p, v, rect.width / rect.height))
      if (ps.some((p) => !p)) continue
      // Inside all four edges, whichever way round they run.
      let sign = 0, inside = true
      for (let i = 0; i < 4 && inside; i++) { const a = ps[i]!, b = ps[(i + 1) % 4]!, side = Math.sign((b.x - a.x) * (my - a.y) - (b.y - a.y) * (mx - a.x)); if (side && sign && side !== sign) inside = false; if (side) sign = side }
      if (inside && ps[0]!.far < nearest) { nearest = ps[0]!.far; best = s }
    }
    return best
  }
  /** Where the middle of each square of a lettering board's letters is on the picture (client px), and whether it is lamp: for the check that reads the picture. */
  const marks = (id: string) => {
    const s = stood.get(id), rect = o.canvas.getBoundingClientRect(), out: { x: number; y: number; lit: boolean; letter: number }[] = []
    if (!s?.shape || s.b.type !== 'lettering') return out
    const sh = s.shape, v = o.view()
    for (const [i, letter] of (sh.letters ?? []).entries()) for (const { along, y, lit } of letter?.squares ?? []) {
      const p = onPicture([sh.middle[0] + sh.right[0] * along, y, sh.middle[2] + sh.right[2] * along], v, rect.width / rect.height)
      if (p) out.push({ x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height, lit, letter: i })
    }
    return out
  }
  let flight = 0
  const fly = (id: string): Promise<boolean> => {
    const s = stood.get(id)
    if (!s?.shape) return Promise.resolve(false)
    const sh = s.shape, rect = o.canvas.getBoundingClientRect(), v = o.view(), across = Math.atan(v.tanHalf * (rect.width / Math.max(1, rect.height)))
    // Far enough off that the whole face is in the picture, and not further than 90 m: a narrow picture sees less of it.
    // A logo's tower is the far model's from the park: the flight to it ends past the far model's handover there (and a little), before the same wall the sign was seen on.
    const least = s.b.type === 'logo' ? Math.min(1700, o.handover(sh.middle[0], sh.middle[2]) * 1.15) : 80
    const off = Math.min(s.b.type === 'logo' ? (s.b.mount === 'roof' ? 4000 : 1800) : 900, Math.max(least, (sh.wide * 0.9) / Math.tan(across), (sh.high * (s.b.mount === 'roof' ? 1.5 : 1.1)) / v.tanHalf))
    // Before it on the line to where the realm begins, where that is before its face at all: a board is placed to be
    // seen from there, so that line is clear, while straight out from its face another roof may stand (one did, #450).
    const park = [o.began.x * M - sh.middle[0], o.began.y * M - sh.middle[1], o.began.z * M - sh.middle[2]], far = Math.hypot(park[0], park[1], park[2]) || 1
    const along = (park[0] * sh.normal[0] + park[2] * sh.normal[2]) / far > 0.3 ? park.map((v) => v / far) : sh.normal
    o.aloft()
    return flyTo({ x: (sh.middle[0] + along[0] * off) / M, y: (sh.middle[1] + along[1] * off) / M, z: (sh.middle[2] + along[2] * off) / M, yaw: Math.atan2(-along[0], along[2]), pitch: -Math.asin(along[1]) })
  }
  /** Flies the eye to a pose (metres, radians), its lens going to `fov` on the way where one is given. Resolves false if another flight took over. */
  const flyTo = (to: { x: number; y: number; z: number; yaw: number; pitch: number }, fov?: { from: number; to: number }): Promise<boolean> => {
    const from = { ...o.pose }, mine = ++flight, began = performance.now(), ms = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 2200
    let turn = (to.yaw - from.yaw) % (2 * Math.PI)
    if (turn > Math.PI) turn -= 2 * Math.PI
    if (turn < -Math.PI) turn += 2 * Math.PI
    return new Promise((done) => {
      const step = () => {
        if (mine !== flight) return done(false)
        const t = ms ? Math.min(1, (performance.now() - began) / ms) : 1, e = t * t * (3 - 2 * t)
        Object.assign(o.pose, { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, z: from.z + (to.z - from.z) * e, yaw: from.yaw + turn * e, pitch: from.pitch + (to.pitch - from.pitch) * e })
        if (fov) o.setFov?.(fov.from + (fov.to - fov.from) * e)
        if (t < 1) requestAnimationFrame(step); else done(true)
      }
      step()
    })
  }
  const open = (id: string) => {
    const b = stood.get(id)?.b
    if (!b?.to) return false
    tell('navigate', { board: b.id, name: b.name, to: b.to })
    // Run as a page of its own, the realm is the one that goes; to another site (a logo's network) it does not go at
    // all: the visitor is asked, and that site opens in a tab of its own (`leaving`).
    const to = new URL(b.to, location.href)
    if (embedded || o.edit) return true
    if (to.origin === location.origin) location.assign(to); else leaving.ask(b, to)
    return true
  }
  const visit = async (id: string) => { leaving.close(); if (await fly(id)) open(id) }

  // ── Before another site: the card that opens it in a new tab or flies back to the view (leaving.ts, fetched when first wanted) ──
  let card: Promise<import('./leaving.ts').Leaving> | null = null
  const leaving = {
    ask(b: Board, to: URL) {
      card ??= import('./leaving.ts').then(({ leaving }) => leaving(() => {
        if (o.back?.()) return
        const h = o.home?.() ?? { at: [o.began.x, o.began.y, o.began.z], yaw: o.began.yaw, pitch: o.began.pitch, fov: NaN }
        void flyTo({ x: h.at[0], y: h.at[1], z: h.at[2], yaw: h.yaw, pitch: h.pitch }, Number.isFinite(h.fov) && o.fov ? { from: o.fov(), to: h.fov } : undefined)
      }))
      void card.then((c) => c.ask(b.name, b.id, to))
    },
    close() { void card?.then((c) => c.close()) },
  }

  // A click or tap on a board while the pointer is free: before the picture takes the pointer for itself (input.ts).
  addEventListener('click', (e) => {
    if (e.target !== o.canvas || o.input.locked) return
    const s = under(e.clientX, e.clientY)
    if (!s || (!editor && s.b.does && !o.does?.(s.b))) return
    e.stopImmediatePropagation(); e.preventDefault()
    if (editor) editor.select(s.b.id); else if (!s.b.does) void visit(s.b.id)
  }, true)
  // A board under the pointer is brightened, as one with the focus is (its link, below).
  addEventListener('mousemove', (e) => { if (o.input.locked) return; const s = e.target === o.canvas ? under(e.clientX, e.clientY) : null; o.canvas.style.cursor = s ? 'pointer' : ''; if (!document.activeElement?.closest?.('nav[aria-label="Billboards"]')) glow.hot = s?.b.id ?? null })
  /** The board straight ahead, within 90 m: flying free, O opens it. */
  const ahead = (): Stood | null => {
    const v = o.view()
    let best: Stood | null = null, most = 0.9
    for (const s of stood.values()) {
      if (!s.shape || !s.b.to) continue
      const d = [s.shape.middle[0] - v.eye[0], s.shape.middle[1] - v.eye[1], s.shape.middle[2] - v.eye[2]], far = Math.hypot(d[0], d[1], d[2])
      const facing = (d[0] * v.forward[0] + d[1] * v.forward[1] + d[2] * v.forward[2]) / Math.max(1, far)
      if (far < 900 && facing > most) { most = facing; best = s }
    }
    return best
  }
  o.input.always('KeyO', () => { const s = ahead(); if (!s) return false; open(s.b.id); return true })
  let hinted: Stood | null = null
  setInterval(() => { const s = o.input.locked ? ahead() : null; if (s && s !== hinted) o.hud.notice(`O opens ${s.b.name}`, 4000); hinted = s }, 500)

  // ── Each board as a link of the page: for a keyboard and a screen reader. Seen only while one of them has the focus. ──
  const links = document.createElement('nav')
  links.setAttribute('aria-label', 'Billboards')
  links.style.cssText = 'position:fixed;left:12px;top:12px;z-index:30;display:flex;gap:8px;flex-wrap:wrap'
  const listLinks = () => {
    links.replaceChildren(...records.filter((b) => b.to || b.does).map((b) => {
      // A board that leads somewhere is a link; one that does something is a button.
      const a = b.to ? Object.assign(document.createElement('a'), { href: b.to }) : Object.assign(document.createElement('button'), { type: 'button' })
      const act = () => { if (b.to) void visit(b.id); else o.does?.(b) }
      a.textContent = b.name; a.dataset.board = b.id
      a.style.cssText = 'font:600 15px system-ui,sans-serif;padding:8px 12px;border:0;border-radius:8px;background:#111a;color:#fff;text-decoration:none;position:absolute;left:-9999px'
      a.onfocus = () => { a.style.position = 'static'; glow.hot = b.id }
      a.onblur = () => { a.style.position = 'absolute'; if (glow.hot === b.id) glow.hot = null }
      a.onclick = (e) => { e.preventDefault(); act() }
      // Enter is the page's own key everywhere else (input.ts): on a link it follows the link, and goes no further.
      // (A key held until it repeats is pressed once.)
      a.onkeydown = (e) => { if (e.key !== 'Enter') return; e.preventDefault(); e.stopPropagation(); if (!e.repeat) act() }
      return a
    }))
  }
  listLinks()
  document.body.prepend(links)

  // ── The host page: it may fly the eye and set a sign (main.ts tells it when the realm is ready) ──
  const listed = () => records.map((b) => ({ id: b.id, name: b.name, type: b.type, to: b.to ?? null }))
  if (embedded) {
    hear((m) => {
      if (m.type === 'fly' && typeof m.board === 'string') void fly(m.board)
      else if (m.type === 'open' && typeof m.board === 'string') void visit(m.board)
      else if (m.type === 'signs.set' && typeof m.id === 'string') { try { signs.set(m.id, (m.content ?? null) as Content | null) } catch (e) { tell('error', { message: String((e as Error).message), fatal: false }) } }
    })
  }

  // ── Roofs a board could stand on ──
  const propose: Boards['propose'] = (count = 6, size = 4) => {
    const eye = [o.began.x * M, o.began.y * M, o.began.z * M], px = Math.max(2, Math.round((size * M) / 5 / 2) * 2), wide = 4 * 4 * px, high = 7 * px
    /** Each with where its face is on the picture as the realm begins, degrees: across and up, and half its width and height there. */
    const found: { b: Omit<Board, 'id' | 'name' | 'content' | 'to'>; score: number; bearing: number; up: number; halfWide: number; halfHigh: number }[] = []
    /** Whether a point is seen from where the realm begins: nothing stands over the line to it. */
    const seen = (p: number[]) => {
      const far = Math.hypot(p[0] - eye[0], p[2] - eye[2])
      for (let d = 40; d < far - 30; d += 30) { const t = d / far; if (o.feet(Math.round(eye[0] + (p[0] - eye[0]) * t), Math.round(eye[2] + (p[2] - eye[2]) * t)) > eye[1] + (p[1] - eye[1]) * t - 4) return false }
      return true
    }
    for (let deg = -16; deg <= 16; deg += 1) for (let far = 900; far <= 3300; far += 80) {
      const yaw = o.began.yaw + (deg * Math.PI) / 180, x = Math.round((eye[0] + far * Math.sin(yaw)) / 8) * 8, z = Math.round((eye[2] - far * Math.cos(yaw)) / 8) * 8
      const roof = o.feet(x, z)
      // In the middle of the picture as the realm begins, clear of what the page lays over its edges.
      if (Math.abs(Math.atan2(roof + 16 + high / 2 - eye[1], far) - o.began.pitch) > Math.atan(o.view().tanHalf) * 0.72) continue
      // A roof: six metres and more over the ground, and no tree's crown.
      // Not where a board stands already.
      if (records.some((b) => Math.hypot(b.at[0] - x, b.at[2] - z) < 250)) continue
      if (roof - o.ground(x, z) < 60 || (o.top(x, z) & 15) === 13) continue
      for (const facing of [0, 1, 2, 3] as const) {
        const [nx, nz] = NORMALS[facing], rx = nz, rz = -nx, towards = (nx * (eye[0] - x) + nz * (eye[2] - z)) / Math.max(1, Math.hypot(eye[0] - x, eye[2] - z))
        if (towards < 0.45) continue
        // Level under its whole length, and at the roof's edge on the side it faces: where a rooftop board stands.
        let level = true
        for (let k = -wide / 2; k <= wide / 2 && level; k += 8) if (Math.abs(o.feet(x + rx * k, z + rz * k) - roof) > 5 || Math.abs(o.feet(x + rx * k - nx * 12, z + rz * k - nz * 12) - roof) > 12) level = false
        if (!level) continue
        const edge = o.feet(x + nx * 30, z + nz * 30) < roof - 25
        const y0 = roof + 16
        if (![[0, 0], [-1, 0], [1, 0], [-1, 1], [1, 1], [0, 1]].every(([i, j]) => seen([x + rx * (wide / 2) * i + nx * 4, y0 + high * j, z + rz * (wide / 2) * i + nz * 4]))) continue
        const deg1 = 180 / Math.PI
        found.push({ b: { type: 'lettering', building: [x, z], at: [x, roof, z], facing, size }, score: towards * (edge ? 1.5 : 1) * (2000 / (far + 1000)), bearing: deg, up: Math.atan2(y0 + high / 2 - eye[1], far) * deg1, halfWide: Math.atan2((wide / 2) * towards, far) * deg1, halfHigh: Math.atan2(high / 2, far) * deg1 })
      }
    }
    // The best first, none over another on the picture, nor within a degree of it.
    found.sort((a, b) => b.score - a.score)
    const picked: typeof found = []
    for (const f of found) { if (picked.length >= count) break; if (picked.every((p) => Math.abs(p.bearing - f.bearing) > p.halfWide + f.halfWide + 1 || Math.abs(p.up - f.up) > p.halfHigh + f.halfHigh + 1)) picked.push(f) }
    return picked.map((p) => p.b)
  }

  // ── The editor (`?boards=edit`): boards added, moved, sized and turned where they stand, and the file saved ──
  const file = (): SignsFile => ({ version: 1, ...(whole_ ? { banner: whole_ } : {}), boards: records.map((b) => ({ ...b })) })
  const change = (id: string, to: Partial<Board>) => {
    const at = records.findIndex((b) => b.id === id)
    if (at < 0) return
    const next = { ...records[at], ...to } as Board
    drop(id)
    records[at] = next
    bring(next)
    masks(); listLinks()
  }
  const editing = {
    add(b: Board) { records.push(b); bring(b); masks(); listLinks() },
    change,
    remove(id: string) { const at = records.findIndex((b) => b.id === id); if (at < 0) return; drop(id); records.splice(at, 1); listLinks() },
    file,
    /** To the tool that serves the page (sf/boards.mjs edit), which writes sf/boards.json; from any other host, as a file to keep. */
    async save() {
      const body = JSON.stringify(file(), null, 2) + '\n'
      const put = await fetch(new URL('boards.json', location.href), { method: 'PUT', body }).then((r) => r.ok, () => false)
      if (put) return 'saved to sf/boards.json'
      const a = document.createElement('a')
      a.href = URL.createObjectURL(new Blob([body], { type: 'application/json' })); a.download = 'boards.json'; a.click()
      return 'this host keeps no files: boards.json was downloaded, put it at engine/sf/boards.json'
    },
  }
  // (Defined, not spread: the panel says which board is selected as it is asked.)
  const editor = o.edit ? Object.defineProperties(editing, Object.getOwnPropertyDescriptors((await import('./boards-edit.ts')).panel({ records, editing, propose, pick: o.pick, view: o.view, feet: o.feet, input: o.input, fly: (id) => void fly(id) }))) as typeof editing & { select(id: string): void; readonly selected: string | null } : null

  return {
    records,
    get edits() { return laid },
    relay() { laid = 0; for (const s of stood.values()) stand(s, true); seenEdits = -1 },
    fly, open, where, marks, standing, propose, listed, glow,
    light(id, lit) { const s = stood.get(id); if (!s?.far || (s.lit ?? 0) === lit) return; s.lit = lit; inkFar(s) },
    faced: (id) => stood.get(id)?.faced === true,
    box: (id) => stood.get(id)?.shape?.box ?? null,
    letters(id) {
      const sh = stood.get(id)?.shape
      if (!sh?.letters) return null
      const middles = sh.letters.filter((l): l is Laid => !!l).map((l) => ({ ch: l.ch, at: [sh.middle[0] + sh.right[0] * l.mid, l.up, sh.middle[2] + sh.right[2] * l.mid] as [number, number, number], wide: l.wide }))
      return { face: faceOf(stood.get(id)!.b)!.set.name, px: sh.px!, cap: sh.cap! * sh.high, capShare: sh.cap!, middles, middle: sh.middle, right: sh.right, normal: sh.normal, wide: sh.wide, high: sh.high }
    },

    get plane() { return flown },
    get logos() { return [...stood.values()].some((s) => s.b.type === 'logo' && !s.screen?.hidden) },
    set logos(on: boolean) { for (const s of stood.values()) if (s.b.type === 'logo' && s.screen) s.screen.hidden = !on },
    get dark() { return dark },
    set dark(on: boolean) { dark = on },
    editor,
  }
}
