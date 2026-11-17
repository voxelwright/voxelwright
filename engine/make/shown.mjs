// A kept thing as the page draws it before it is made (#220): the ghost on the ask bar. The page draws a body as
// its outside faces (page/pieces.ts); they are worked out here, once for each way the thing may face, with the
// page's own function (page/fine.ts `faces`), so the page has nothing to do but hand them to the GPU.
import { faces } from '../page/fine.ts'
import { turned } from './alive.mjs'
import { fineRows } from './fine.mjs'

/**
 * A thing as `kept` (make.mjs) gives it, facing a way, as cells in the world's frame: { grain, low, size, faces }.
 * `low` is where its lowest corner lies from the place it stands (`origin`, in the world's cells) in its own cells,
 * `grain` how many of those make one of the world's. Drawn at `origin + low / grain` with no turn, it is where its
 * cells will be.
 */
export function shown(thing, facing) {
  // A living thing (make/alive.mjs) is shown as its look's first part (its outside), turned as it will stand: not
  // its body of 10 cm. Its low corner is the turned body's, from the place it stands, and the part's on that.
  if (thing.living) {
    const t = turned(thing.living, facing), p = t.look[0]
    if (p) return { grain: p.per, low: t.low.map((v, a) => (v + p.low[a]) * p.per), size: p.size, faces: faces(p.kinds, p.size) }
    return shown({ ...t.body, fine: undefined, living: undefined }, facing)
  }
  // A thing of finer cells is shown as those; one of the world's cells (or 5 cm, which stands so) as its stand-in.
  const t = thing.fine ?? { ...thing, grain: 1 }, g = t.grain, rows = fineRows(t, [0, 0, 0], facing)
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
  for (const [x0, x1, y, z] of rows) { lo[0] = Math.min(lo[0], x0); hi[0] = Math.max(hi[0], x1); lo[1] = Math.min(lo[1], y); hi[1] = Math.max(hi[1], y + 1); lo[2] = Math.min(lo[2], z); hi[2] = Math.max(hi[2], z + 1) }
  const size = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]], cells = new Uint16Array(size[0] * size[1] * size[2])
  for (const [x0, x1, y, z, kind] of rows) { const at = ((y - lo[1]) * size[2] + (z - lo[2])) * size[0] - lo[0]; cells.fill(kind, at + x0, at + x1) }
  return { grain: g, low: lo, size, faces: faces(cells, size) }
}
