// What the solver tells whoever draws (#146), read from the words the core writes (bodies.rs):
// cells taken out of the world or put back, bodies born, bodies come to rest, dust, and where
// every body is now.

/** A body as it came loose: its outside as faces (the core's `support::faces`), its size, its middle of mass from its own low corner, and where that corner was. */
export interface Born { id: number; cells: number; size: [number, number, number]; com: [number, number, number]; low: [number, number, number]; faces: Uint32Array<ArrayBuffer> }
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
  moves: Placed[]
}

const EDIT = 1, BORN = 2, GONE = 3, DUST = 4, MOVES = 5, BROKE = 6

export function read(words: Uint32Array<ArrayBuffer>): Told {
  const f = new Float32Array(words.buffer, words.byteOffset, words.length), i32 = new Int32Array(words.buffer, words.byteOffset, words.length)
  const told: Told = { edits: [], born: [], gone: [], dust: [], broke: [], moves: [] }
  const placed = (at: number): Placed => ({ id: words[at], pos: [f[at + 1], f[at + 2], f[at + 3]], rot: [f[at + 4], f[at + 5], f[at + 6], f[at + 7]] })
  for (let i = 0; i < words.length;) {
    const tag = words[i], n = words[i + 1], at = i + 2
    if (tag === EDIT) told.edits.push({ box: [i32[at], i32[at + 1], i32[at + 2], i32[at + 3], i32[at + 4], i32[at + 5]], runs: i32.slice(at + 6, at + n) })
    else if (tag === BORN) told.born.push({ id: words[at], cells: words[at + 1], size: [words[at + 2], words[at + 3], words[at + 4]], com: [f[at + 5], f[at + 6], f[at + 7]], low: [i32[at + 8], i32[at + 9], i32[at + 10]], faces: words.slice(at + 11, at + n) })
    else if (tag === GONE) told.gone.push(placed(at))
    else if (tag === DUST) told.dust.push({ at: [f[at], f[at + 1], f[at + 2]], kind: words[at + 3], amount: words[at + 4] })
    else if (tag === BROKE) told.broke.push(words[at])
    else if (tag === MOVES) for (let k = at; k < at + n; k += 8) told.moves.push(placed(k))
    i = at + n
  }
  return told
}
