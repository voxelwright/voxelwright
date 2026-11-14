// A thing in a hand (#264, the HANDS lane), as it is drawn: for the world's process (what a holder's figure
// carries, which everyone sees) and for the holder's own page (the thing itself before their eye, when the eye is
// in the head and no figure of their own is drawn). Pure sums over a thing's rows of cells: nothing here draws.
import { materials, palette } from './march.ts'
import type { View } from './march.ts'
import type { Extra } from './wear.ts'

/** The most boxes a hand's thing is shown as, and how long (cells) the longest thing in a hand is drawn: longer is drawn smaller. */
const BOXES = 8, LONG = 14
const paints = palette(), stuffs = materials()
/** A kind's colour as the screen has it: #rrggbb. */
const hex = (kind: number) => { const c = kind >> 8 ? paints.subarray((kind >> 8) * 4, (kind >> 8) * 4 + 3) : stuffs.subarray((kind & 15) * 8, (kind & 15) * 8 + 3); return '#' + [...c].map((v) => Math.round(255 * Math.max(0, Math.min(1, v)) ** (1 / 2.2)).toString(16).padStart(2, '0')).join('') }
/** The box round rows of cells (x0, x1, y, z, kind each): [x0, y0, z0, x1, y1, z1], the high corner not filled. */
export const boxOf = (rows: ArrayLike<number>): number[] => { const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]; for (let i = 0; i < rows.length; i += 5) { b[0] = Math.min(b[0], rows[i]); b[3] = Math.max(b[3], rows[i + 1]); b[1] = Math.min(b[1], rows[i + 2]); b[4] = Math.max(b[4], rows[i + 2] + 1); b[2] = Math.min(b[2], rows[i + 3]); b[5] = Math.max(b[5], rows[i + 3] + 1) } return b }
/** Which way a thing is longest (0 x, 1 y, 2 z), which of the other two was up (y, if it is one of them), and the third. */
const ways = (size: number[]) => { const long = size.indexOf(Math.max(...size)), others = [0, 1, 2].filter((a) => a !== long), up = others.includes(1) ? 1 : others[1]; return { long, up, side: others.find((a) => a !== up)! } }

/** What a grip is not made of: steel, glass and lamp are a blade, a head, a lens, a flame. */
const HARD = new Set([11, 12, 15])

/**
 * A thing's cells as what a hand carries: up to eight boxes told from the hand, each a slice of its longest way in
 * the colour most of that slice is. It is held by one end and stands up out of the fist, as a sword, a torch or a
 * bat is carried (boxes on 'gripR', wear.ts: a figure that has any bends that elbow, so the forearm lies level and the
 * hand's -z is up), so it is seen from behind, over the shoulder, and by anyone else. The end in the fist is the one that is
 * less of a blade: of its two outer thirds, the one with less steel, glass and lamp. Drawn at its own size up to
 * 1.4 m long, smaller beyond.
 */
export function inHand(rows: ArrayLike<number>): Extra[] {
  const b = boxOf(rows), size = [b[3] - b[0], b[4] - b[1], b[5] - b[2]], { long, up, side } = ways(size)
  const scale = Math.min(1, LONG / size[long]), n = Math.max(1, Math.min(BOXES, Math.ceil(size[long] / 2)))
  const slices = Array.from({ length: n }, () => ({ lo: [Infinity, Infinity], hi: [-Infinity, -Infinity], kinds: new Map<number, number>() }))
  // How much of each end is hard: [cells, hard cells] of the low third and of the high third.
  const ends = [[0, 0], [0, 0]]
  for (let i = 0; i < rows.length; i += 5) for (let x = rows[i]; x < rows[i + 1]; x++) {
    const c = [x, rows[i + 2], rows[i + 3]], along = (c[long] - b[long]) / size[long], s = slices[Math.min(n - 1, Math.floor(along * n))]
    s.lo[0] = Math.min(s.lo[0], c[side]); s.hi[0] = Math.max(s.hi[0], c[side] + 1); s.lo[1] = Math.min(s.lo[1], c[up]); s.hi[1] = Math.max(s.hi[1], c[up] + 1)
    s.kinds.set(rows[i + 4], (s.kinds.get(rows[i + 4]) ?? 0) + 1)
    const end = along < 1 / 3 ? ends[0] : along >= 2 / 3 ? ends[1] : null
    if (end) { end[0]++; if (HARD.has(rows[i + 4] & 15)) end[1]++ }
  }
  // Held by the high end if that is the less hard one; a thing that stood upright and is alike at both ends is held by its foot.
  const share = (e: number[]) => (e[0] ? e[1] / e[0] : 1), flip = share(ends[1]) < share(ends[0])
  if (flip) slices.reverse()
  const out: Extra[] = [], each = (size[long] / n) * scale, mid = [(b[side] + b[side + 3]) / 2, (b[up] + b[up + 3]) / 2], round = (v: number) => Number(v.toFixed(2))
  slices.forEach((s, k) => {
    if (!s.kinds.size) return
    const kind = [...s.kinds].sort((p, q) => q[1] - p[1])[0][0]
    // A hand's width of it under the fist, the rest standing out of it.
    out.push({ on: 'gripR', at: [round(((s.lo[0] + s.hi[0]) / 2 - mid[0]) * scale), round(-((s.lo[1] + s.hi[1]) / 2 - mid[1]) * scale), round(1 - (k + 0.5) * each)], size: [round(Math.max(0.2, (s.hi[0] - s.lo[0]) * scale)), round(Math.max(0.2, (s.hi[1] - s.lo[1]) * scale)), round(Math.max(0.2, each))], colour: hex(kind), shiny: (kind & 15) === 12 || (kind & 15) === 11 })
  })
  return out
}

/** A thing's cells as a block of kinds (laid out x, then z, then y, as the core lays a body's), with its size. */
export function block(rows: ArrayLike<number>): { kinds: Uint16Array; size: [number, number, number] } {
  const b = boxOf(rows), size: [number, number, number] = [b[3] - b[0], b[4] - b[1], b[5] - b[2]], kinds = new Uint16Array(size[0] * size[1] * size[2])
  for (let i = 0; i < rows.length; i += 5) for (let x = rows[i]; x < rows[i + 1]; x++) kinds[x - b[0] + size[0] * (rows[i + 3] - b[2] + size[2] * (rows[i + 2] - b[1]))] = rows[i + 4]
  return { kinds, size }
}

/**
 * Where a held thing is before the holder's own eye, and how it is turned: low and to the right, its near end a
 * hand's reach from the eye, its longest way pointing where they look, what was its up still up. A thing longer
 * than 1.4 m is drawn smaller, as it is in a figure's hand. `pos` is its middle, `cell` how big one of its cells is drawn.
 */
export function before(view: View, size: readonly [number, number, number]): { pos: [number, number, number]; rot: [number, number, number, number]; cell: number } {
  const { long, up, side } = ways([...size]), cell = Math.min(1, LONG / size[long]), f = view.forward, u = view.up, r = view.right
  // Its long way goes to forward and its up to up; its third way goes to whichever of forward x up and its opposite keeps this a turn and not a mirror.
  const even = (long + 1) % 3 === up, cols: number[][] = [[], [], []]
  const fxu = [f[1] * u[2] - f[2] * u[1], f[2] * u[0] - f[0] * u[2], f[0] * u[1] - f[1] * u[0]]
  cols[long] = [...f]; cols[up] = [...u]; cols[side] = even ? fxu : fxu.map((v) => -v)
  const m = (row: number, col: number) => cols[col][row], trace = m(0, 0) + m(1, 1) + m(2, 2)
  let q: [number, number, number, number]
  if (trace > 0) { const s = Math.sqrt(trace + 1) * 2; q = [(m(2, 1) - m(1, 2)) / s, (m(0, 2) - m(2, 0)) / s, (m(1, 0) - m(0, 1)) / s, s / 4] }
  else if (m(0, 0) > m(1, 1) && m(0, 0) > m(2, 2)) { const s = Math.sqrt(1 + m(0, 0) - m(1, 1) - m(2, 2)) * 2; q = [s / 4, (m(0, 1) + m(1, 0)) / s, (m(0, 2) + m(2, 0)) / s, (m(2, 1) - m(1, 2)) / s] }
  else if (m(1, 1) > m(2, 2)) { const s = Math.sqrt(1 + m(1, 1) - m(0, 0) - m(2, 2)) * 2; q = [(m(0, 1) + m(1, 0)) / s, s / 4, (m(1, 2) + m(2, 1)) / s, (m(0, 2) - m(2, 0)) / s] }
  else { const s = Math.sqrt(1 + m(2, 2) - m(0, 0) - m(1, 1)) * 2; q = [(m(0, 2) + m(2, 0)) / s, (m(1, 2) + m(2, 1)) / s, s / 4, (m(1, 0) - m(0, 1)) / s] }
  const reach = 5 + (size[long] * cell) / 2
  return { pos: [0, 1, 2].map((a) => view.eye[a] + f[a] * reach + r[a] * 3.5 - u[a] * 3.2) as [number, number, number], rot: q, cell }
}
