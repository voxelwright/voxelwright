// The realm's billboards and the banner a plane tows (#450): the site's navigation as things of the city.
//
// Where each board stands and what it is are data (sf/boards.json, in the realm's record as `signs`): a board names
// its building by a point on its roof, its type, its size, which way it faces and what it says. Nothing here places
// one: `propose` only offers roofs to whoever is editing (`?boards=edit`, sf/boards.mjs), and the file is what counts.
//
//   lettering   letters of lamp on panels of wood, one panel and one steel post a letter, all cells of the world:
//               every tool breaks them as it breaks a wall, a letter whose post is cut falls by itself, and the
//               march lights them by night as it lights any sign (march.ts: lamp in a colour of its own).
//   digital     a housing of cells on steel posts, and on its face a screen (screens.ts) that shows words, an image or
//               a video; the part of the screen whose housing is gone is dark.
//   banner      a small plane flying a round over the park's view, towing a strip of cloth with words or a picture.
//
// What each says is set through signs.ts (`realm.signs.set`), which this file brings every sign to.
// A click or tap on a board from where the pointer is free flies the eye to it and then tells the host page where to
// go (host.ts `navigate`); flying free, O opens the board ahead. Each board is also a link in the page, for a
// keyboard and a screen reader.
import { rows, type Edit } from './edits.ts'
import { thing } from './fine.ts'
import { embedded, hear, tell } from './host.ts'
import type { Hud } from './hud.ts'
import type { Input } from './input.ts'
import type { View } from './march.ts'
import type { Piece, Pieces } from './pieces.ts'
import { screens as screensOf, type Screen, type Style } from './screens.ts'
import { signs, type Content } from './signs.ts'
import type { Target } from '../probe/gpu.ts'

export interface Board {
  id: string
  /** Its accessible name: what a link to it is called. */
  name: string
  type: 'lettering' | 'digital'
  /** Its building: a point on its roof, in the frame's cells (x east, z south). */
  building: [number, number]
  /** Where it stands: the middle of its foot on that roof, cells. */
  at: [number, number, number]
  /** Which way its face looks: 0 west, 1 north, 2 east, 3 south. */
  facing: 0 | 1 | 2 | 3
  /** Lettering: how tall a letter is, metres. Digital: how wide and how tall its housing is, metres. */
  size: number | [number, number]
  /** How far its foot is over the roof, metres. */
  lift?: number
  content: { text: string } | { image: string }
  /** Where the host page goes when it is opened: a path of the site. A board with none is only looked at. */
  to?: string
}
export interface Banner { content: { text: string } | { image: string }; /** The middle of the plane's round, cells, how wide the round is (m), how high over the sea it flies (m) and how fast (m/s). */ around: [number, number]; radius: number; height: number; speed: number; /** How long and how high the cloth is, m. */ size: [number, number] }
export interface SignsFile { version: 1; banner?: Banner; boards: Board[] }

const M = 10
const PLASTER = 9, WOOD = 10, STEEL = 12, LAMP = 15
/** Panels near black, posts dark grey, letters pale grey: white lamp blooms into a blot by night (tried, #450). */
const PANEL = WOOD | (14 << 8), POST = STEEL | (11 << 8), HOUSING = PLASTER | (14 << 8), LETTER = LAMP | (6 << 8)
const NORMALS = [[-1, 0], [0, -1], [1, 0], [0, 1]] as const
/** Three across and five up, a row a digit (4, 2, 1 from the left), from the top. */
const FONT: Record<string, string> = {
  A: '25755', B: '65656', C: '34443', D: '65556', E: '74647', F: '74644', G: '34553', H: '55755', I: '72227', J: '11152', K: '55655', L: '44447', M: '57755',
  N: '65555', O: '75557', P: '65644', Q: '25573', R: '65655', S: '34216', T: '72222', U: '55557', V: '55552', W: '55775', X: '55255', Y: '55222', Z: '71247',
  0: '25552', 1: '26227', 2: '61247', 3: '61216', 4: '55711', 5: '74616', 6: '34652', 7: '71222', 8: '25252', 9: '25316', '!': '22202', '?': '61202', '.': '00002', '-': '00700', '+': '02720', '/': '11244',
}
export const lettered = (text: string) => [...text.toUpperCase()].map((c) => (c in FONT ? c : ' ')).join('').slice(0, 14)

/** What a board is made of: its cells as rows, the box they lie in, and its face (middle, half its width along its right, how high, where its foot is). */
interface Shape { runs: Int32Array<ArrayBuffer>; box: Edit['box']; middle: [number, number, number]; right: [number, number, number]; normal: [number, number, number]; wide: number; high: number }

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
 * A board's cells. Its face lies on a plane of the grid of 8 cells and its letters on that grid too, so that the
 * world's coarser copies of it, which is what a far eye is shown, hold whole letters and not a smear of them.
 */
export function shape(b: Board, text = 'text' in b.content ? b.content.text : ''): Shape {
  const [nx, nz] = NORMALS[b.facing], rx = nz, rz = -nx, snap = (v: number) => Math.round(v / 8) * 8
  const cx = snap(b.at[0]), cz = snap(b.at[2]), foot = Math.round(b.at[1]), y0 = Math.ceil((foot + (b.lift ?? 1.6) * M) / 8) * 8
  const cells: number[][] = []
  /** A cell `k` along the face from its left edge, `d` behind it, at height `y`, when the face is `wide` across. */
  const put = (wide: number, k: number, d: number, y: number, kind: number) => {
    const along = k - wide / 2
    const x = rx ? cx + rx * along - (rx < 0 ? 1 : 0) : nx > 0 ? cx - 1 - d : cx + d
    const z = rz ? cz + rz * along - (rz < 0 ? 1 : 0) : nz > 0 ? cz - 1 - d : cz + d
    cells.push([x, y, z, kind])
  }
  let wide: number, high: number
  if (b.type === 'lettering') {
    const said = lettered(text), px = Math.max(2, Math.round(((b.size as number) * M) / 5 / 2) * 2), pitch = 4 * px
    wide = Math.max(1, said.length) * pitch; high = 7 * px
    ;[...said].forEach((letter, i) => {
      if (letter === ' ') return
      const k0 = i * pitch, glyph = FONT[letter]
      // Its panel, a cell short of the next one's: the letters are parts of their own.
      for (let k = 0; k < pitch - 1; k++) for (let y = 0; y < high; y++) {
        const col = Math.floor((k - px / 2) / px), row = Math.floor(y / px) - 1
        const lit = k >= px / 2 && col < 3 && row >= 0 && row < 5 && ((Number(glyph[4 - row]) >> (2 - col)) & 1) === 1
        for (let d = 0; d < 2; d++) put(wide, k0 + k, d, y0 + y, lit ? LETTER : PANEL)
      }
      // Its beam and its post.
      for (let k = 0; k < pitch - 1; k++) for (let d = 0; d < 2; d++) for (let y = 1; y <= 2; y++) put(wide, k0 + k, d, y0 - y, POST)
      for (let k = pitch / 2 - 2; k < pitch / 2 + 2; k++) for (let d = 0; d < 2; d++) for (let y = foot - 2; y < y0 - 2; y++) put(wide, k0 + k, d, y, POST)
    })
  } else {
    const [w, h] = b.size as [number, number]
    wide = Math.max(16, Math.round((w * M) / 8) * 8); high = Math.max(16, Math.round((h * M) / 8) * 8)
    // Its face breaks as a wall does (steel would barely give); the beam it rests on is steel.
    for (let k = 0; k < wide; k++) for (let y = -2; y < high; y++) for (let d = 0; d < 2; d++) put(wide, k, d, y0 + y, y < 0 ? POST : HOUSING)
    // A post under each quarter (one in the middle of a narrow one).
    for (const at of wide >= 64 ? [wide / 4, (wide * 3) / 4] : [wide / 2]) for (let k = at - 2; k < at + 2; k++) for (let d = 0; d < 2; d++) for (let y = foot - 2; y < y0 - 2; y++) put(wide, k, d, y, POST)
  }
  const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]
  for (const [x, y, z] of cells) { box[0] = Math.min(box[0], x); box[1] = Math.min(box[1], y); box[2] = Math.min(box[2], z); box[3] = Math.max(box[3], x + 1); box[4] = Math.max(box[4], y + 1); box[5] = Math.max(box[5], z + 1) }
  if (!cells.length) box.splice(0, 6, cx, y0, cz, cx + 1, y0 + 1, cz + 1)
  return { runs: asRows(cells), box: box as unknown as Edit['box'], middle: [cx, y0 + high / 2, cz], right: [rx, 0, rz], normal: [nx, 0, nz], wide, high }
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
  /** How many edits the boards have laid in the world as it is now: what a world with nothing done to it holds (the checks). */
  readonly edits: number
  /** Lays every board again: the world was put back as it came (reset). */
  relay(): void
  /** Flies the eye to a board. Resolves when it is there, false if there is no such board or the flight was cut short. */
  fly(id: string): Promise<boolean>
  /** Tells the host page to go where the board leads. */
  open(id: string): boolean
  /** Where a board is on the picture now, client px (its middle and its box), or null if it is behind the eye: for the checks and the host. */
  where(id: string): { x: number; y: number; wide: number; high: number; /** How tall its face is down its middle, px. */ tall: number; far: number } | null
  marks(id: string): { x: number; y: number; lit: boolean }[]
  /** How many of a lettering board's letters still stand (most of their lamp there), and a digital board's tiles lit. */
  standing(id: string): { letters: string; whole: boolean }
  /** Roofs a board could stand on, seen from where the realm begins, best first. An offer to the editor: the file decides. */
  propose(count?: number, size?: number): Omit<Board, 'id' | 'name' | 'content' | 'to'>[]
  /** The plane: where it is (cells), and its place on its round (0 to 1), which the checks may hold still. */
  readonly plane: { at: [number, number, number]; phase: number; hold: number | null; readonly cloth: Screen } | null
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
  /** How far off what is straight ahead is, cells. */
  pick(): Promise<{ t: number } | null>
  /** Up off one's feet: a flight to a board is flown. */
  aloft(): void
  /** Whether the place is shown round the eye: the host is told the realm is ready. */
  shown(): boolean
  edit: boolean
}

const SCREEN: Style = { ground: '#0b1020', ink: '#f4f1e6', glows: true }
const CLOTH: Style = { ground: '#f6f1e4', ink: '#c2261c', glows: false }

export async function boards(o: Needs): Promise<Boards> {
  const drawn = await screensOf(o.device, o.format)
  o.passes.add('signs', (encoder, to, view, time) => drawn.draw(encoder, to, view, time, o.day()))
  const records: Board[] = o.file.boards.map((b) => ({ ...b }))
  /** A board as it stands: its record, its cells as laid, its screen if it has one. */
  interface Stood { b: Board; shape: Shape | null; text: string; screen: Screen | null; content: Content | null; tiles: [number, number]; gone: () => void }
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
    // Its screen: on the housing's face, inside a rim of two cells.
    sc.at = [sh.middle[0] + sh.normal[0] * 0.5, sh.middle[1] - 1, sh.middle[2] + sh.normal[2] * 0.5]
    sc.hu = [sh.right[0] * (sh.wide / 2 - 2), 0, sh.right[2] * (sh.wide / 2 - 2)]
    sc.hv = [0, sh.high / 2 - 2, 0]
  }
  const stand = (s: Stood, again = false) => {
    const b = s.b, text = b.type === 'lettering' ? lettered(s.content && 'text' in s.content ? s.content.text : '') : ''
    if (!again && s.shape && s.text === text) return
    if (!again && s.shape) lay(emptied(s.shape))
    s.shape = shape(b, text); s.text = text
    if (s.shape.runs.length) lay(rows(s.shape.runs, s.shape.box))
    place(s)
  }
  const bring = (b: Board) => {
    const s: Stood = { b, shape: null, text: '', screen: null, content: null, tiles: [1, 1], gone: () => {} }
    if (b.type === 'digital') {
      const [w, h] = b.size as [number, number]
      s.tiles = [Math.max(1, Math.min(8, Math.round(w / 1.6))), Math.max(1, Math.min(4, Math.round(h / 1.6)))]
      s.screen = drawn.add({ pixels: [512, Math.max(64, Math.min(512, Math.round((512 * h) / w / 4) * 4))], tiles: s.tiles, style: SCREEN })
    }
    stood.set(b.id, s)
    s.gone = signs.add({ id: b.id, kind: b.type, name: b.name, accepts: b.type === 'lettering' ? ['text'] : ['text', 'image', 'video'], own: b.content, show: (content) => { s.content = content; if (b.type === 'lettering') stand(s); else { if (!s.shape) stand(s); s.screen!.show(content) } } })
  }
  const drop = (id: string) => { const s = stood.get(id); if (!s) return; if (s.shape) lay(emptied(s.shape)); s.screen?.destroy(); s.gone(); stood.delete(id) }
  for (const b of records) bring(b)

  // ── What still stands: a letter by its lamp, a screen's tile by the housing behind it ──
  const letterStands = (s: Stood, i: number) => {
    const sh = s.shape!, px = sh.high / 7, pitch = 4 * px, glyph = FONT[s.text[i]]
    if (!glyph) return true
    let lamp = 0, there = 0
    for (let row = 0; row < 5; row++) for (let col = 0; col < 3; col++) if ((Number(glyph[4 - row]) >> (2 - col)) & 1) {
      const along = i * pitch + px / 2 + col * px + px / 2 - sh.wide / 2, y = sh.middle[1] - sh.high / 2 + (row + 1) * px + px / 2
      lamp++
      if ((o.kind(Math.floor(sh.middle[0] + sh.right[0] * along - sh.normal[0] * 0.5), Math.floor(y), Math.floor(sh.middle[2] + sh.right[2] * along - sh.normal[2] * 0.5)) & 15) === LAMP) there++
    }
    return there * 2 > lamp
  }
  const standing = (id: string) => {
    const s = stood.get(id)
    if (!s?.shape) return { letters: '', whole: false }
    if (s.b.type === 'lettering') { const letters = [...s.text].filter((_, i) => letterStands(s, i)).join(''); return { letters, whole: letters === s.text } }
    const n = s.tiles[0] * s.tiles[1]
    let lit = 0
    for (let i = 0; i < n; i++) if ((s.screen!.mask >>> i) & 1) lit++
    return { letters: `${lit}/${n}`, whole: lit === n }
  }
  /** Each tile of a screen shows while the housing behind its middle is there. */
  const masks = () => {
    for (const s of stood.values()) {
      if (!s.screen || !s.shape) continue
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
  let seenEdits = -1
  setInterval(() => { const n = o.done(); if (n !== seenEdits) { seenEdits = n; masks() } }, 400)

  // ── The plane and its banner ──
  const towed = o.file.banner ?? null
  let flown: { piece: Piece; cloth: Screen; line: Screen; at: [number, number, number]; phase: number; hold: number | null } | null = null
  if (towed) {
    const model = plane(), born = thing(model.kinds, model.size)
    born.com = [model.size[0] / 2, model.size[1] / 2, model.size[2] / 2]
    const piece = o.pieces.add(born)
    piece.cell = 2
    const [long, tall] = towed.size
    const cloth = drawn.add({ pixels: [1024, Math.max(64, Math.round((1024 * tall) / long / 4) * 4)], both: true, style: CLOTH })
    cloth.wave = 6
    const line = drawn.add({ pixels: [4, 4], both: true, style: { ground: '#2a2a2a', ink: '#2a2a2a', glows: false } })
    line.show(null)
    flown = { piece, cloth, line, at: [0, 0, 0], phase: 0, hold: null }
    signs.add({ id: 'banner', kind: 'banner', name: 'The banner a plane tows', accepts: ['text', 'image', 'video'], own: towed.content, show: (content) => cloth.show(content) })
    const began = performance.now(), lap = (2 * Math.PI * towed.radius) / towed.speed, R = towed.radius * M, gap = 14 * M, half = (long * M) / 2
    const on = (a: number): [number, number, number] => [towed.around[0] + R * Math.cos(a), towed.height * M, towed.around[1] + R * Math.sin(a)]
    const fly = () => {
      const f = flown!
      f.phase = f.hold ?? ((((performance.now() - began) / 1000 / lap) % 1) + 1) % 1
      const a = f.phase * 2 * Math.PI, heading = [-Math.sin(a), Math.cos(a)], turn = Math.atan2(-heading[1], heading[0])
      f.at = on(a)
      piece.pos = f.at
      // Its nose along its way, banked a little into the round.
      const bank = 0.12, s = Math.sin(turn / 2), c = Math.cos(turn / 2), sb = Math.sin(bank / 2), cb = Math.cos(bank / 2)
      piece.rot = [c * sb, s * cb, -s * sb, c * cb]
      // The cloth behind it along the round, its leading edge first; the line from the tail to that edge.
      const back = a - (gap + half + model.size[0] * 1) / R, lead = a - (gap + model.size[0] * 1) / R, tail = a - (model.size[0] * 1) / R
      const mid = on(back), from = on(tail), to = on(lead)
      cloth.at = [mid[0], mid[1] - 10, mid[2]]
      cloth.hu = [Math.sin(back) * half, 0, -Math.cos(back) * half]
      cloth.hv = [0, (tall * M) / 2, 0]
      line.at = [(from[0] + to[0]) / 2, from[1] - 5, (from[2] + to[2]) / 2]
      line.hu = [(to[0] - from[0]) / 2, -5, (to[2] - from[2]) / 2]
      line.hv = [0, 0.8, 0]
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
  const under = (x: number, y: number): Stood | null => {
    const rect = o.canvas.getBoundingClientRect(), v = o.view(), mx = ((x - rect.left) / rect.width) * 2 - 1, my = 1 - ((y - rect.top) / rect.height) * 2
    let best: Stood | null = null, nearest = Infinity
    for (const s of stood.values()) {
      if (!s.shape) continue
      const ps = corners(s.shape, 6).map((p) => onPicture(p, v, rect.width / rect.height))
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
    const s = stood.get(id), rect = o.canvas.getBoundingClientRect(), out: { x: number; y: number; lit: boolean }[] = []
    if (!s?.shape || s.b.type !== 'lettering') return out
    const sh = s.shape, px = sh.high / 7, v = o.view()
    ;[...s.text].forEach((letter, i) => {
      const glyph = FONT[letter]
      if (!glyph) return
      for (let row = 0; row < 5; row++) for (let col = 0; col < 3; col++) {
        const along = i * 4 * px + px / 2 + col * px + px / 2 - sh.wide / 2, p = onPicture([sh.middle[0] + sh.right[0] * along, sh.middle[1] - sh.high / 2 + (row + 1.5) * px, sh.middle[2] + sh.right[2] * along], v, rect.width / rect.height)
        if (p) out.push({ x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height, lit: ((Number(glyph[4 - row]) >> (2 - col)) & 1) === 1 })
      }
    })
    return out
  }
  let flight = 0
  const fly = (id: string): Promise<boolean> => {
    const s = stood.get(id)
    if (!s?.shape) return Promise.resolve(false)
    const sh = s.shape, rect = o.canvas.getBoundingClientRect(), v = o.view(), across = Math.atan(v.tanHalf * (rect.width / Math.max(1, rect.height)))
    // Far enough off that the whole face is in the picture, and not further than 90 m: a narrow picture sees less of it.
    const off = Math.min(900, Math.max(80, (sh.wide * 0.9) / Math.tan(across), (sh.high * 1.1) / v.tanHalf))
    const to = { x: (sh.middle[0] + sh.normal[0] * off) / M, y: sh.middle[1] / M, z: (sh.middle[2] + sh.normal[2] * off) / M, yaw: Math.atan2(-sh.normal[0], sh.normal[2]), pitch: 0 }
    const from = { ...o.pose }, mine = ++flight, began = performance.now(), ms = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 2200
    o.aloft()
    let turn = (to.yaw - from.yaw) % (2 * Math.PI)
    if (turn > Math.PI) turn -= 2 * Math.PI
    if (turn < -Math.PI) turn += 2 * Math.PI
    return new Promise((done) => {
      const step = () => {
        if (mine !== flight) return done(false)
        const t = ms ? Math.min(1, (performance.now() - began) / ms) : 1, e = t * t * (3 - 2 * t)
        Object.assign(o.pose, { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, z: from.z + (to.z - from.z) * e, yaw: from.yaw + turn * e, pitch: from.pitch + (to.pitch - from.pitch) * e })
        if (t < 1) requestAnimationFrame(step); else done(true)
      }
      step()
    })
  }
  const open = (id: string) => {
    const b = stood.get(id)?.b
    if (!b?.to) return false
    tell('navigate', { board: b.id, name: b.name, to: b.to })
    // Run as a page of its own, the realm is the one that goes.
    if (!embedded && !o.edit) location.assign(new URL(b.to, location.href))
    return true
  }
  const visit = async (id: string) => { if (await fly(id)) open(id) }

  // A click or tap on a board while the pointer is free: before the picture takes the pointer for itself (input.ts).
  addEventListener('click', (e) => {
    if (e.target !== o.canvas || o.input.locked) return
    const s = under(e.clientX, e.clientY)
    if (!s) return
    e.stopImmediatePropagation(); e.preventDefault()
    if (editor) editor.select(s.b.id); else void visit(s.b.id)
  }, true)
  addEventListener('mousemove', (e) => { if (!o.input.locked) o.canvas.style.cursor = e.target === o.canvas && under(e.clientX, e.clientY) ? 'pointer' : '' })
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
    links.replaceChildren(...records.filter((b) => b.to).map((b) => {
      const a = document.createElement('a')
      a.href = b.to!; a.textContent = b.name; a.dataset.board = b.id
      a.style.cssText = 'font:600 15px system-ui,sans-serif;padding:8px 12px;border-radius:8px;background:#111a;color:#fff;text-decoration:none;position:absolute;left:-9999px'
      a.onfocus = () => { a.style.position = 'static' }
      a.onblur = () => { a.style.position = 'absolute' }
      a.onclick = (e) => { e.preventDefault(); void visit(b.id) }
      // Enter is the page's own key everywhere else (input.ts): on a link it follows the link, and goes no further.
      a.onkeydown = (e) => { if (e.key !== 'Enter') return; e.preventDefault(); e.stopPropagation(); void visit(b.id) }
      return a
    }))
  }
  listLinks()
  document.body.prepend(links)

  // ── The host page: told when the realm is ready and where to go; it may fly the eye and set a sign ──
  const listed = () => records.map((b) => ({ id: b.id, name: b.name, type: b.type, to: b.to ?? null }))
  if (embedded) {
    const ready = setInterval(() => { if (!o.shown()) return; clearInterval(ready); tell('ready', { boards: listed(), signs: signs.list().map((s) => ({ id: s.id, kind: s.kind, accepts: s.accepts })) }) }, 100)
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
  const file = (): SignsFile => ({ version: 1, ...(towed ? { banner: towed } : {}), boards: records.map((b) => ({ ...b })) })
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
    fly, open, where, marks, standing, propose,
    get plane() { return flown },
    editor,
  }
}
