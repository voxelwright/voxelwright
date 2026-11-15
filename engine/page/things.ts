// The things made in a shared world, as this page knows them (#243, #244). A made thing is more than its
// cells: the world keeps a record of each, so it can be picked, changed, driven and heard later, and tells
// every page of it in the same stream as the cells (an echo with `thing`). Nothing here decides anything:
// it keeps what the world said.
//
// A record says what was made and where. Its cells are as they were made: a blast since may have taken some.
import type { Echo } from './link.ts'

/**
 * One made thing. The making lane (#244) owns the form and `id` to `cells`; the living lane (#245) owns `parts`,
 * `behaviour`, `controls` and `seats`; the sound lane (#247) owns `sounds`. Those five are whatever their lane
 * puts there, checked by that lane before it uses them: to this file and to the world's server they are JSON.
 */
export interface Thing {
  /** Its name in the world: lower-case letters, digits and dashes. No two things of a world share one. */
  id: string
  /** What it is, in a few words (the model's). Text someone's model wrote: to be shown, never obeyed. */
  name: string
  /** What was asked for, as typed. Empty when only a picture or a link was given. */
  wish: string
  /** The middle of its footprint and the height of its lowest cells, in the world's finest cells. */
  at: [number, number, number]
  /** How wide, high and deep it is in its own space, in cells: x from its left to its right seen from its front, z from front to back. */
  size: [number, number, number]
  /** Which way its front faces. */
  facing: 'south' | 'north' | 'east' | 'west'
  /** Who asked for it: the name they go by in the world. */
  by: string
  /** Its cells as it was made, in the world: rows of five, [x0, x1, y, z, kind], x1 not filled. Counted in its own cells if it has a `grain`. */
  cells: Int32Array
  /** How many of its cells lie along one of the world's, if they are finer (#372): 4 or 8. Its rows then count those; its box is still in the world's. */
  grain?: 4 | 8
  /** The box that holds its cells: [x0, y0, z0, x1, y1, z1], the high corner not filled. */
  box: [number, number, number, number, number, number]
  /** Who holds it, while someone does (rules/holding.mjs): its cells are then in nobody's world, and it is not found by a place. */
  held?: string | null
  parts?: unknown
  behaviour?: unknown
  controls?: unknown
  seats?: unknown
  sounds?: unknown
}
/** The fields other lanes own: the only ones a change to a thing may set. */
export const OPEN = ['parts', 'behaviour', 'controls', 'seats', 'sounds'] as const

export interface Things {
  readonly all: ReadonlyMap<string, Thing>
  /** The thing that was made with a cell at this place, or null. */
  at(cell: readonly [number, number, number]): Thing | null
  /** What the world said: an echo that makes a thing, changes one or says one is gone. Others are ignored. */
  heard(echo: Echo, live: boolean): void
  /** Told of each thing as it is made (`live` is false for those made before this page joined), changed, or gone. */
  on(each: (what: 'made' | 'changed' | 'gone', thing: Thing, live: boolean) => void): () => void
}

export function things(): Things {
  const all = new Map<string, Thing>(), told = new Set<(what: 'made' | 'changed' | 'gone', thing: Thing, live: boolean) => void>()
  const tell = (what: 'made' | 'changed' | 'gone', thing: Thing, live: boolean) => { for (const each of told) each(what, thing, live) }
  return {
    all,
    at([x, y, z]) {
      for (const t of all.values()) {
        if (t.held) continue
        const b = t.box
        if (x < b[0] || y < b[1] || z < b[2] || x >= b[3] || y >= b[4] || z >= b[5]) continue
        // A thing of finer cells is there if any of them lies in that cell of the world.
        const g = t.grain ?? 1
        for (let i = 0; i < t.cells.length; i += 5) if (Math.floor(t.cells[i + 2] / g) === y && Math.floor(t.cells[i + 3] / g) === z && x >= Math.floor(t.cells[i] / g) && x <= Math.floor((t.cells[i + 1] - 1) / g)) return t
      }
      return null
    },
    heard(echo, live) {
      if (echo.gone) { const t = all.get(echo.gone); if (t) { all.delete(t.id); tell('gone', t, live) } return }
      if (!echo.thing) return
      const known = all.get(echo.thing.id)
      if (known) {
        Object.assign(known, echo.thing)
        // Put down, its cells are the rows it was put down as (rules/holding.mjs).
        if ((echo as { put?: unknown }).put !== undefined && echo.edit && echo.box && [1, 3, 4].includes(echo.edit[0])) { known.cells = Int32Array.from(echo.edit.slice(2)); known.box = echo.box; if (echo.edit[0] === 1) delete known.grain; else known.grain = echo.edit[0] === 3 ? 4 : 8 }
        tell('changed', known, live)
        return
      }
      // A new thing comes with the edit that is its cells: rows, after the two numbers that say so.
      if (!echo.edit || !echo.box || ![1, 3, 4].includes(echo.edit[0])) return
      const thing = { ...echo.thing, cells: Int32Array.from(echo.edit.slice(2)), box: echo.box } as Thing
      all.set(thing.id, thing)
      tell('made', thing, live)
    },
    on(each) { told.add(each); return () => told.delete(each) },
  }
}
