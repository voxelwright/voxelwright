// A maker of sectors (#140): one instance of the core in a worker. It is asked for a column
// of sectors at one coarseness and answers with each sector's tree. It keeps nothing between
// asks: the edits that reach the column come with the ask.

import { need, open } from './bay.ts'

export interface Ask {
  id: number
  level: number
  sx: number
  sz: number
  /** The sectors wanted, first and last. */
  y0: number
  y1: number
  /** What has been done to the world that reaches this column, as the core reads it (edits.ts). */
  edits: Int32Array
  /** The lowest and one past the highest cell each of those edits can change, two numbers an edit. */
  heights: Int32Array
  /** How many times finer than the core's own the world's finest cells are (#259): the first `fine` boxes hold the core's cells written out 2, 4 times each way. 0 as things are. */
  fine?: number
  /** Whether cells may hold finer cells (#259, `?bricks=1`): where not, the core refuses every edit of tags 3 and 4. */
  bricks?: boolean
}
export interface Answer {
  id: number
  level: number
  sx: number
  sz: number
  y0: number
  /** One a sector from y0 up: 0 for air, 1 for all one kind, else how many words its tree is. */
  sizes: Uint32Array<ArrayBuffer>
  /** Each sector's words one after another (a sector that is all one kind has one: the kind). */
  words: Uint32Array<ArrayBuffer>
  ms: number
  /** How many times one of these sectors refused an edit of finer cells whole (the core's `fine_refused`). */
  refused: number
}

interface Core {
  memory: WebAssembly.Memory
  edits_room(words: number): number
  make_sector(sx: number, sy: number, sz: number, lod: number): number
  make_finer(sx: number, sy: number, sz: number, fine: number): number
  fine_cells(on: number): void
  fine_refused(): number
  tree_words(): number
  sector_span(sx: number, sz: number, lod: number): number
}

/** What a sector far under the ground is: earth in its own colour (kinds.rs: EARTH, OWN). */
const EARTH = 1
const SIDE = 64

let ready: Promise<Core> = open<Core>('/page/core.wasm')

self.onmessage = async (e: MessageEvent<Ask>) => {
  // The core built again (#264, world.ts `recore`): what is asked for from here on is made by the new one.
  const anew = (e.data as unknown as { core?: string }).core
  if (anew) { ready = open<Core>(anew); return }
  const core = await ready, ask = e.data, t0 = performance.now()
  const size = SIDE << ask.level
  // The core's memory moves when it grows: ask for an address first, then look at the memory.
  // A box of cells finer than the core's: its sectors are parts of the core's finest, and the span is theirs.
  const fine = ask.fine ?? 0, finer = Math.max(0, fine - ask.level), lod = Math.max(0, ask.level - fine)
  // In the Bay that comes in tiles (#373): the ones that know this column, before anything is asked of it.
  { const wide = SIDE << lod, x0 = (ask.sx >> finer) * wide, z0 = (ask.sz >> finer) * wide; await need(core, x0, z0, x0 + wide, z0 + wide, 1 << lod) }
  const spanAt = core.sector_span(ask.sx >> finer, ask.sz >> finer, lod)
  const span = new Int32Array(core.memory.buffer, spanAt, 2)
  const lo = span[0] << finer, hi = ((span[1] + 1) << finer) - 1
  const count = ask.y1 - ask.y0 + 1, sizes = new Uint32Array(count)
  const parts: Uint32Array[] = []
  let total = 0, refused = 0
  core.fine_cells(ask.bricks ? 1 : 0)
  // The column's edits are told to the core once: it keeps them for every sector asked of it after.
  const roomAt = core.edits_room(ask.edits.length)
  new Int32Array(core.memory.buffer, roomAt, ask.edits.length).set(ask.edits)
  for (let i = 0; i < count; i++) {
    const sy = ask.y0 + i
    // Whether any edit reaches this sector: one that does not is what the rules alone make it.
    let touched = false
    for (let k = 0; k < ask.heights.length; k += 2) if (ask.heights[k + 1] > sy * size && ask.heights[k] < (sy + 1) * size) { touched = true; break }
    if (!touched && sy > hi) continue
    if (!touched && sy < lo) { sizes[i] = 1; parts.push(Uint32Array.of(EARTH)); total += 1; continue }
    const n = finer ? core.make_finer(ask.sx, sy, ask.sz, finer) : core.make_sector(ask.sx, sy, ask.sz, lod)
    sizes[i] = n
    if (!finer) refused += core.fine_refused()
    if (n) { const wordsAt = core.tree_words(); parts.push(new Uint32Array(core.memory.buffer, wordsAt, n).slice()); total += n }
  }
  const words = new Uint32Array(total)
  let at = 0
  for (const p of parts) { words.set(p, at); at += p.length }
  const answer: Answer = { id: ask.id, level: ask.level, sx: ask.sx, sz: ask.sz, y0: ask.y0, sizes, words, ms: performance.now() - t0, refused }
  ;(self as unknown as Worker).postMessage(answer, [sizes.buffer, words.buffer])
}
