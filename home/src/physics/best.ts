// The best scores, kept between visits (#108). A `record` gadget holds a game's best as its `best`
// knob; here every record of a toy that belongs to the home (not one made from a sentence, which
// lasts a visit) is given back what was kept when the page opens, and kept again when it is beaten.
// Kept in this browser for now, the way the rules' tuning is: a per-viewer convenience, checked like
// any other input (the knob's own range). Keeping it with the house, on the host, is the next step
// and changes what the house stores.
import type { Context } from 'cordis'
import type { World } from '../engine/world'

const STORED = 'village.games.best'
/** Records kept at most. */
const MAX = 16
const kept = (id: string) => !id.startsWith('made-')

function read(): Record<string, number> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORED) ?? '{}')
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    return Object.fromEntries(Object.entries(raw).filter(([id, v]) => /^[A-Za-z0-9_/-]{1,100}$/.test(id) && typeof v === 'number' && Number.isFinite(v)).slice(0, MAX)) as Record<string, number>
  } catch {
    return {}
  }
}

export function bestScores(ctx: Context, world: World) {
  const best = read()
  // Given back through the knob, so the gadget's own range holds it and its card shows it.
  const give = () => {
    for (const g of world.knobs()) if (g.kind === 'record' && kept(g.id) && Object.hasOwn(best, g.id) && g.knobs.best < best[g.id]) world.setKnob(g.id, 'best', best[g.id])
  }
  give()
  ctx.on('village/physics', (e) => {
    // A snapshot put back (it says so with a rules event, before its knobs are in) carries the knobs of its moment: once
    // it is all back, a record beaten since is given its best again.
    if (e.kind === 'rules' && e.by === 'code') return queueMicrotask(give)
    if (e.kind !== 'signal' || e.port !== 'beaten' || !kept(e.gadget) || !Number.isFinite(e.value)) return
    if (!Object.hasOwn(best, e.gadget) && Object.keys(best).length >= MAX) return
    // Only ever upward: a record that lost its best some other way does not take the kept one down with it.
    if (best[e.gadget] >= e.value) return
    best[e.gadget] = e.value
    try {
      localStorage.setItem(STORED, JSON.stringify(best))
    } catch {
      // Storage refused: the best still stands for this visit.
    }
  })
}
