// Shots that read as shots (#264, the bodies lane). Something thrown fast is a ball 30 cm across that crosses
// a street in a tenth of a second: drawn only as its faces it is a speck in two or three frames. Here a body that
// goes fast is seen in flight: a streak of light along the way it came since it was last told of, a flash where
// it began to go fast and one where it stops or breaks. Nothing here knows what threw it or why: any body that
// goes that fast is drawn so.
import type { Crumbs } from './crumbs.ts'
import type { Puffs } from './puffs.ts'
import type { Told } from './told.ts'

/** How far a body must go between two tellings to be drawn as a shot (cells: about 15 m/s at sixty tellings a second), and the furthest it can have gone (further, it was put somewhere else). */
const FAST = 2.5, FAR = 60

export function shots(smoke: Puffs, debris: Crumbs): { heard(told: Told): void; readonly seen: number } {
  /** Where each body was last told to be, and whether it has been fast. */
  const last = new Map<number, { at: [number, number, number]; fast: boolean }>()
  let seen = 0
  const end = (id: number) => {
    const was = last.get(id)
    last.delete(id)
    if (!was?.fast) return
    // Where it stopped or broke: a flash, and a few bright bits.
    smoke.glint(was.at, 3)
    debris.burst(was.at, 1.5, 10, [1, 0.86, 0.55], 0.5, 0.5, 2.2)
  }
  return {
    get seen() { return seen },
    heard(told) {
      for (const m of told.moves) {
        const was = last.get(m.id)
        if (!was) { last.set(m.id, { at: m.pos, fast: false }); continue }
        const d = [m.pos[0] - was.at[0], m.pos[1] - was.at[1], m.pos[2] - was.at[2]], far = Math.hypot(d[0], d[1], d[2])
        if (far > FAST && far < FAR) {
          // The first time it is fast: a flash where it set out.
          if (!was.fast) { smoke.glint(was.at, 2.5); seen++ }
          was.fast = true
          // The streak: light every cell and a half along the way it came.
          const n = Math.min(24, Math.ceil(far / 1.5))
          for (let k = 1; k <= n; k++) smoke.glint([was.at[0] + (d[0] * k) / n, was.at[1] + (d[1] * k) / n, was.at[2] + (d[2] * k) / n], 0.55)
        }
        was.at = m.pos
      }
      for (const g of told.gone) end(g.id)
      for (const id of told.broke) end(id)
    },
  }
}
