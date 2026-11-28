// Placement QA in world cells. The sampler reads the world before the objects are added.
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a, b) => [a[1]*b[2] - a[2]*b[1], a[2]*b[0] - a[0]*b[2], a[0]*b[1] - a[1]*b[0]]

function axes({ yaw = 0, rot = [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)] }) {
  const length = Math.hypot(...rot)
  if (!Number.isFinite(length) || length === 0) throw new RangeError('Invalid placement rotation')
  const [x, y, z, w] = rot.map(v => v / length)
  return [
    [1 - 2*(y*y + z*z), 2*(x*y + w*z), 2*(x*z - w*y)],
    [2*(x*y - w*z), 1 - 2*(x*x + z*z), 2*(y*z + w*x)],
    [2*(x*z + w*y), 2*(y*z - w*x), 1 - 2*(x*x + y*y)],
  ]
}

function position(box, x, y, z) {
  const [a, b, c] = box.axes
  return box.center.map((v, i) => v + x*a[i] + y*b[i] + z*c[i])
}

// Project onto the six face normals and all nine edge cross products. Unit axes
// keep the minimum translation in cells, including when one box contains another.
function penetration(a, b) {
  const delta = b.center.map((v, i) => v - a.center[i])
  const radius = (box, axis) => box.axes.reduce((r, v, i) => r + Math.abs(dot(v, axis)) * box.halfExtents[i], 0)
  let depth = Infinity
  for (const axis of [...a.axes, ...b.axes, ...a.axes.flatMap(v => b.axes.map(w => cross(v, w)))]) {
    const length = Math.hypot(...axis)
    if (length < 1e-12) continue
    const unit = axis.map(v => v / length)
    const span = radius(a, unit) + radius(b, unit)
    const overlap = span - Math.abs(dot(delta, unit))
    if (overlap <= Number.EPSILON * 16 * span) return 0
    depth = Math.min(depth, overlap)
  }
  return depth
}

const feet = [[0, 0], [-.72, -.72], [.72, -.72], [.72, .72], [-.72, .72]]

function support(box, sample, maxGap, maxDrop, minSupportedPoints) {
  const [hx, hy, hz] = box.halfExtents
  const gaps = feet.map(([u, v]) => {
    const [x, y, z] = position(box, u*hx, -hy, v*hz)
    const below = Math.floor(y - 1 + 1e-9)
    for (let gap = 0; gap <= maxGap; gap++) {
      if (sample(Math.floor(x), below - gap, Math.floor(z))) return gap
    }
    return null // No solid within the measured range.
  })
  const deep = gap => gap === null || gap > maxDrop
  const corners = gaps.slice(1)
  const unsupportedCorners = corners.flatMap((gap, i) => gap === 0 ? [] : [i])
  const details = { id: box.id, floatCells: gaps[0], gaps, unsupportedCorners }
  if (gaps.filter(g => g === 0).length < minSupportedPoints || (deep(gaps[0]) && corners.filter(deep).length >= 3)) {
    return { type: 'floating', ...details }
  }
  if (unsupportedCorners.length) return { type: 'cantilevered', ...details }
}

function embedding(box, sample) {
  let tested = 0, embedded = 0
  const sampleCells = []
  const inspect = (x, y, z) => {
    tested++
    if (!sample(x, y, z)) return
    embedded++
    if (sampleCells.length < 8) sampleCells.push([x, y, z])
  }
  if (box.rows) {
    // The maker already knows which world cells are occupied. A hollow room's
    // empty interior must not count as material intersecting a wall.
    const bottom = Math.floor(box.center[1] - box.halfExtents[1])
    for (const [x0, x1, y, z, kind] of box.rows) {
      if (!kind || y === bottom) continue
      const count = Math.min(12, x1 - x0)
      for (let i = 0; i < count; i++) inspect(x0 + Math.floor((i + .5)*(x1 - x0)/count), y, z)
    }
  } else {
    // Sample cell-centred points on a bounded local lattice. Leave the first
    // cell of height out so a flush floor cannot look like an embedded wall.
    const [hx, hy, hz] = box.halfExtents
    const lattice = (lo, hi) => {
      const n = Math.min(12, Math.max(0, Math.ceil(hi - lo)))
      return Array.from({ length: n }, (_, i) => lo + (i + .5)*(hi - lo)/n)
    }
    const xs = lattice(-hx, hx), ys = lattice(1 - hy, hy), zs = lattice(-hz, hz)
    for (const y of ys) for (const z of zs) for (const x of xs) inspect(...position(box, x, y, z).map(Math.floor))
  }
  if (embedded) return { type: 'wall_embedded', id: box.id, embeddedFraction: embedded / tested, sampleCells }
}

/** Array of support, embedding and pairwise overlap findings. yaw is in radians,
 * rot is an xyzw quaternion. floatCells is the centre gap (null beyond maxGap).
 * Corner indices start at local -X/-Z and continue towards +X then +Z.
 * Optional rows are occupied runs already transformed to world coordinates. */
export function probePlacedObjects(objects, worldSampler, { maxGap = 16, maxDrop = Math.min(1, maxGap), minSupportedPoints = 2 } = {}) {
  if (!Number.isSafeInteger(maxGap) || maxGap < 0 || !Number.isSafeInteger(maxDrop) || maxDrop < 0 || maxDrop > maxGap ||
      !Number.isInteger(minSupportedPoints) || minSupportedPoints < 1 || minSupportedPoints > 5) throw new RangeError('Invalid support probe limits')
  const boxes = objects.map(obj => ({ ...obj, axes: axes(obj) }))
  const defects = []
  for (const [i, box] of boxes.entries()) {
    const feet = support(box, worldSampler, maxGap, maxDrop, minSupportedPoints)
    const wall = embedding(box, worldSampler)
    if (feet) defects.push(feet)
    if (wall) defects.push(wall)
    for (let j = 0; j < i; j++) {
      const penetrationDepth = penetration(boxes[j], box)
      if (penetrationDepth) defects.push({ type: 'prop_overlap', ids: [boxes[j].id, box.id], penetrationDepth })
    }
  }
  return defects
}

export const bounds = (made) => { const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]; for (const r of made) [[r[0], r[1] - 1], [r[2], r[2]], [r[3], r[3]]].forEach(([a, b], k) => { lo[k] = Math.min(lo[k], a); hi[k] = Math.max(hi[k], b) }); return [lo, hi] }

/** The made runs have exclusive x1. Their tight box is aligned with the world.
 * Neighbors may be passed as OBBs to include pairwise overlap checks. */
export function probeMadeRows(rows, worldSampler, { id = 'made', neighbors = [], ...opts } = {}) {
  const solid = rows.filter(row => row[4] !== 0 && row[1] > row[0])
  if (!solid.length) return []
  const [lo, hi] = bounds(solid)
  const halfExtents = hi.map((v, i) => (v + 1 - lo[i]) / 2)
  const center = lo.map((v, i) => v + halfExtents[i])
  return probePlacedObjects([{ id, center, halfExtents, rows: solid }, ...neighbors], worldSampler, opts)
}
