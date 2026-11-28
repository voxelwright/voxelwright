// What the solver tells whoever draws (#146), read from the words the core writes (bodies.rs):
// cells taken out of the world or put back, bodies born, bodies come to rest, dust, and where
// every body is now.
import { POSE_RECORD_WORDS, POSE_TAG, unpackPoseWords, type RagdollPoseRecord } from './ragdoll-bridge.ts'

export type { RagdollPoseRecord } from './ragdoll-bridge.ts'

/** A body as it came loose: its outside as faces (the core's `support::faces`), its size, its middle of mass from its own low corner, and where that corner was. */
export interface Born {
  id: number; cells: number; size: [number, number, number]; com: [number, number, number]; low: [number, number, number]; faces: Uint32Array<ArrayBuffer>
  /** Four words for each face (two words of `faces`), one a corner: its smooth normal and how open it is there (fine.ts `facesWithSmooth`, #38). None for the core's bodies. */
  smooth?: Uint32Array<ArrayBuffer>
}
/** Where a body is: its middle of mass in the world's finest cells, and its turn as a quaternion (x, y, z, w). */
export interface Placed { id: number; pos: [number, number, number]; rot: [number, number, number, number] }
export interface Told {
  /** Rows of cells set or emptied (x0, x1, y, z, kind each) and the box round them, in the order to apply them. */
  edits: { runs: Int32Array<ArrayBuffer>; box: [number, number, number, number, number, number] }[]
  born: Born[]
  /** Bodies that are cells again, and where they lay. */
  gone: Placed[]
  dust: { at: [number, number, number]; kind: number; amount: number }[]
  /** Bodies that broke: they are no more, and what they broke into has been born. */
  broke: number[]
  /** Where it burns, if the fire was moved on: some of the burning cells (x, y, z each, the world's finest cells). */
  fire: Float32Array<ArrayBuffer> | null
  moves: Placed[]
  /** Water that flows, if it moved: the window and the height of its top over each column (the core's water.rs `tell`). */
  water: Uint32Array<ArrayBuffer> | null
  /** Blasts the solver set off itself (something that goes up when hit went up): where, and how big, for their fire and smoke. The cells they emptied come as edits. */
  bursts: { at: [number, number, number]; radius: number }[]
  /** What struck what (#245), the hardest few of the call: for sound, and for whoever wants to know what a thing ran into. */
  struck: Struck[]
  /** Someone's body born (#264): its id, its size in cells and its middle of mass from its own low corner. It is in `moves` as every body is, and drawn by whoever draws people. */
  figures: { id: number; size: [number, number, number]; com: [number, number, number] }[]
  /** How each living thing that is awake is doing (#245): its speed along its front (cells a second), how many feet are on the ground, how many touches it had in the last step, what it is told, whether it is in the air, and vehicle boost/burnout state (#28). */
  live: { id: number; speed: number; feet: number; touches: number; go: number; turn: number; rise: number; aloft: boolean; boosting: boolean; launching: boolean; boost: number; burnout: number; detachedWheels: number; detachedPanels: number; /** The turn from its own upright to the world's (x, y, z, w): no turn unless its down is not the world's. */ frame: [number, number, number, number] }[]
  /** Active ragdoll 13-bone poses (`POSE = 14`, #166): `ragdollId: u32` followed by 17 `u32` words holding the 67-byte smallest-three packed pose from `ragdoll.rs`. */
  poses: RagdollPoseRecord[]
}
/**
 * One thing meeting another: `a` the body that struck, `b` the body struck or 0 for the standing world; where (the
 * world's finest cells); how fast the two were closing (cells a second: 10 is 1 m/s); how hard (weight times the
 * speed lost); the kind of each at the touch (`kind & 15` is the material); and flags: 1 `a` is a living thing,
 * 2 `b` is, 4 the blow broke something. Things resting on each other are not told.
 */
export interface Struck { a: number; b: number; at: [number, number, number]; speed: number; push: number; kindA: number; kindB: number; flags: number }

const EDIT = 1, BORN = 2, GONE = 3, DUST = 4, MOVES = 5, BROKE = 6, FIRE = 7, FLOW = 8, BURST = 9, STRUCK = 10, LIVE = 11, FIGURE = 12, POSE = POSE_TAG

/** The fewest words a record of each kind holds, and for kinds that are a list of rows, each row's words. */
const LEAST: Record<number, number> = { [EDIT]: 6, [BORN]: 11, [GONE]: 8, [DUST]: 5, [BROKE]: 1, [FIRE]: 1, [FLOW]: 0, [BURST]: 4, [STRUCK]: 10, [LIVE]: 0, [FIGURE]: 7, [MOVES]: 0, [POSE]: POSE_RECORD_WORDS }
const STRIDE: Record<number, number> = { [LIVE]: 12, [MOVES]: 8, [POSE]: POSE_RECORD_WORDS }
/** Whether a record of `n` words at `at` lies inside the words and is the shape its kind says. Unknown kinds only need to fit. */
export function fits(tag: number, n: number, at: number, length: number): boolean {
  if (!Number.isInteger(n) || at > length || n > length - at) return false
  if (n < (LEAST[tag] ?? 0)) return false
  const stride = STRIDE[tag]
  return !stride || n % stride === 0
}

export function read(words: Uint32Array<ArrayBuffer>): Told {
  const f = new Float32Array(words.buffer, words.byteOffset, words.length), i32 = new Int32Array(words.buffer, words.byteOffset, words.length)
  const told: Told = { edits: [], born: [], gone: [], dust: [], broke: [], fire: null, moves: [], water: null, bursts: [], struck: [], live: [], figures: [], poses: [] }
  const placed = (at: number): Placed => ({ id: words[at], pos: [f[at + 1], f[at + 2], f[at + 3]], rot: [f[at + 4], f[at + 5], f[at + 6], f[at + 7]] })
  for (let i = 0; i + 2 <= words.length;) {
    const tag = words[i], n = words[i + 1], at = i + 2
    // A record that would run past the words, or is shorter than its kind's fixed part, or not whole strides of it, is
    // not one (#81): reading stops there with what was read. Words from another's server must not freeze the tab.
    if (!fits(tag, n, at, words.length)) break
    if (tag === EDIT) told.edits.push({ box: [i32[at], i32[at + 1], i32[at + 2], i32[at + 3], i32[at + 4], i32[at + 5]], runs: i32.slice(at + 6, at + n) })
    else if (tag === BORN) told.born.push({ id: words[at], cells: words[at + 1], size: [words[at + 2], words[at + 3], words[at + 4]], com: [f[at + 5], f[at + 6], f[at + 7]], low: [i32[at + 8], i32[at + 9], i32[at + 10]], faces: words.slice(at + 11, at + n) })
    else if (tag === GONE) told.gone.push(placed(at))
    else if (tag === DUST) told.dust.push({ at: [f[at], f[at + 1], f[at + 2]], kind: words[at + 3], amount: words[at + 4] })
    else if (tag === BROKE) told.broke.push(words[at])
    else if (tag === FIRE) told.fire = f.slice(at + 1, at + n)
    else if (tag === FLOW) told.water = words.slice(at, at + n)
    else if (tag === BURST) told.bursts.push({ at: [f[at], f[at + 1], f[at + 2]], radius: words[at + 3] })
    else if (tag === STRUCK) told.struck.push({ a: words[at], b: words[at + 1], at: [f[at + 2], f[at + 3], f[at + 4]], speed: f[at + 5], push: f[at + 6], kindA: words[at + 7], kindB: words[at + 8], flags: words[at + 9] })
    else if (tag === LIVE) for (let k = at; k < at + n; k += 12) { const flags = words[k + 7]; told.live.push({ id: words[k], speed: f[k + 1], feet: words[k + 2], touches: words[k + 3], go: f[k + 4], turn: f[k + 5], rise: f[k + 6], aloft: (flags & 1) !== 0, boosting: (flags & 2) !== 0, launching: (flags & 4) !== 0, boost: ((flags >>> 8) & 255) / 255, burnout: ((flags >>> 16) & 255) / 255, detachedWheels: (flags >>> 24) & 15, detachedPanels: (flags >>> 28) & 15, frame: [f[k + 8], f[k + 9], f[k + 10], f[k + 11]] }) }
    else if (tag === FIGURE) told.figures.push({ id: words[at], size: [words[at + 1], words[at + 2], words[at + 3]], com: [f[at + 4], f[at + 5], f[at + 6]] })
    else if (tag === MOVES) for (let k = at; k < at + n; k += 8) told.moves.push(placed(k))
    else if (tag === POSE) for (let k = at; k < at + n; k += POSE_RECORD_WORDS) told.poses.push(unpackPoseWords(words, k))
    i = at + n
  }
  return told
}
