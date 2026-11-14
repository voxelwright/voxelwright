// What has been done to the world (#140), as the page, its workers and the core all read it:
// whole numbers, in order. A ball filled with a kind; a blast (a ball of kind 0), which empties
// each material as far as that material gives; rows of cells set or emptied, which is how a
// piece that fell is taken from where it was and put where it landed (the core's `read_edits`).

/** One thing done: the numbers that tell it, and the box of the finest cells it can change (high corner exclusive). */
export interface Edit {
  words: Int32Array
  box: readonly [number, number, number, number, number, number]
}

/** How far from its centre a ball can change a cell. A blast reaches glass 44 sixteenths of its radius away (kinds.rs). */
export const reachOf = (radius: number, kind: number) => (kind === 0 ? Math.ceil((radius * 44) / 16) + 1 : radius)

export function ball(x: number, y: number, z: number, radius: number, kind: number): Edit {
  const r = reachOf(radius, kind)
  return { words: Int32Array.of(0, x, y, z, radius, kind), box: [x - r, y - r, z - r, x + r + 1, y + r + 1, z + r + 1] }
}

/** Rows of cells (x0, x1, y, z, kind each, sorted by y, then z, then x), moved `down` cells and all set to `kind` when one is given. */
export function rows(runs: Int32Array, box: readonly [number, number, number, number, number, number], down = 0, kind?: number): Edit {
  const words = new Int32Array(2 + runs.length)
  words[0] = 1
  words[1] = runs.length / 5
  words.set(runs, 2)
  for (let i = 2; i < words.length; i += 5) {
    words[i + 2] -= down
    if (kind !== undefined) words[i + 4] = kind
  }
  return { words, box: [box[0], box[1] - down, box[2], box[3], box[4] - down, box[5]] }
}

/** Edits one after another, as the core reads them. */
export function stream(edits: readonly Edit[]): Int32Array {
  const out = new Int32Array(edits.reduce((n, e) => n + e.words.length, 0))
  let at = 0
  for (const e of edits) { out.set(e.words, at); at += e.words.length }
  return out
}

/** Rows of cells finer than the world's (#259, an experiment; the core's `Edit::Fine`): x0, x1, y, z count cells of which `grain` (4 or 8) lie along one of the world's, the box is in the world's cells. */
export function fineRows(runs: Int32Array, box: readonly [number, number, number, number, number, number], grain = 4): Edit {
  const words = new Int32Array(2 + runs.length)
  words[0] = grain === 8 ? 4 : 3
  words[1] = runs.length / 5
  words.set(runs, 2)
  return { words, box }
}
