// The floor villagers walk on (#79): a 10 cm grid of the plan's room floors and door passages,
// minus what stands on them, so a walk goes round a bed placed after world.ts's hand-placed
// corridors were drawn. Built when the plan or a placed thing changes (plugins/place.ts), never
// per walk or per frame; a walk is planned on it only when its hand-placed curve comes too close
// to a placed thing (world.ts).
//
// Each cell is one of three:
//   free  open floor.
//   near  within RADIUS of a built-in. The hand-placed corridors already pass built-ins this
//         close (between the counter and the table, say), so a planned walk may too, at a cost.
//   hard  off the floor, within TOUCH of a built-in, or within RADIUS + MARGIN of a placed thing.
// A door's passage and the clear floor either side of it (mount.ts keeps placed things out of
// it) are never hard because of a built-in: the doorway's own casing stands in the gap.
// Small loose things on the floor (a felt ball) are pushed aside by the walker's body
// (engine/world.ts), not walked round.
import type { Obstacle } from '../build/mount'
import { DOOR_CLEAR } from '../build/mount'
import { curveOf, floorOf, inside, normalAt, pointAt, type P, type Plan } from '../build/plan'

export const CELL = 0.1
/** A walker's half width: no planned walk comes closer than this to a placed thing. */
export const RADIUS = 0.2
/** Kept past RADIUS when planning, for the smooth curve's swing at corners. */
const MARGIN = 0.07
/** No walk goes closer than this to a built-in. */
const TOUCH = 0.08
/** Each metre walked near a built-in counts this many. */
const NEAR_COST = 3
/** What can block a walker: from above the floor (not a rug) to about head height. */
const BAND: [number, number] = [0.05, 0.9]
/** Loose things under this footprint and height are pushed aside, not walked round. */
const LOOSE = 0.2
const LOOSE_H = 0.3
/** How far from a spot or a walker to look for open floor, when it stands in a blocked cell. */
const REACH = 1.2
/** A walk's first and last this many metres are its own when it starts or ends beside a placed thing (its seat). */
const OWN_STEPS = 0.35
/** Planned curves pass through a point at least this often, so they keep to the planned line. */
const STEP = 0.3

const FREE = 0, NEAR = 1, HARD = 2

/** A placed thing on the floor: its middle, size (h tall) and turn (as mount.ts's footprint takes them). */
export interface Thing { x: number; z: number; w: number; d: number; h: number; yaw: number }

/** How far a point is from a thing's footprint (0 inside). */
function fromThing(t: Thing, x: number, z: number) {
  const c = Math.cos(t.yaw), s = Math.sin(t.yaw)
  const wx = x - t.x, wz = z - t.z
  const lx = Math.abs(wx * c - wz * s) - t.w / 2, lz = Math.abs(wx * s + wz * c) - t.d / 2
  return Math.hypot(Math.max(lx, 0), Math.max(lz, 0)) + Math.min(Math.max(lx, lz), 0)
}

/** Each door's passage through its wall and the clear floor either side, as quads. */
function doorQuads(plan: Plan): P[][] {
  const out: P[][] = []
  for (const wall of plan.walls) {
    const c = curveOf(plan, wall)
    const reach = wall.thickness / 2 + DOOR_CLEAR
    for (const o of wall.openings) {
      if (o.kind !== 'door') continue
      // The passage keeps a walker's radius off each jamb (#79 review), leaving at least a cell to walk through.
      const inset = Math.max(0, Math.min(RADIUS, (o.to - o.from) / 2 - CELL))
      const quad: P[] = []
      for (const [t, k] of [[o.from + inset, -1], [o.to - inset, -1], [o.to - inset, 1], [o.from + inset, 1]] as const) {
        const [px, pz] = pointAt(c, t), [nx, nz] = normalAt(c, t)
        quad.push([px + nx * k * reach, pz + nz * k * reach])
      }
      out.push(quad)
    }
  }
  return out
}

export interface Floor {
  /** Whether a curve keeps RADIUS from every placed thing, away from its ends where they stand by one. */
  clear(points: P[], from: P, to: P): boolean
  /** A walk from one floor point to another round what stands in the way, as points to pass through; null when there is none. */
  path(from: P, to: P): P[] | null
  readonly stats: { cells: number; buildMs: number }
}

export function buildFloor(plan: Plan, builtIns: Obstacle[], placed: Thing[]): Floor {
  const t0 = performance.now()
  // A rug is walked over.
  const things = placed.filter((t) => t.h >= BAND[0])
  const rings = plan.rooms.map((r) => floorOf(plan, r))
  const doors = doorQuads(plan)
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
  for (const ring of [...rings, ...doors]) for (const [x, z] of ring) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z)
  }
  const nx = Math.max(1, Math.ceil((x1 - x0) / CELL)), nz = Math.max(1, Math.ceil((z1 - z0) / CELL))
  const kind = new Uint8Array(nx * nz).fill(HARD)
  const door = new Uint8Array(nx * nz)
  /** Cells whose middle is inside something: a spot there cannot be stood on. */
  const solid = new Uint8Array(nx * nz)
  const cx = (i: number) => x0 + (i + 0.5) * CELL, cz = (j: number) => z0 + (j + 0.5) * CELL
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const p: P = [cx(i), cz(j)]
    if (doors.some((q) => inside(q, p))) door[j * nx + i] = 1
    if (door[j * nx + i] || rings.some((r) => inside(r, p))) kind[j * nx + i] = FREE
  }
  const span = (lo: number, hi: number, o: number, n: number) => [Math.max(0, Math.floor((lo - o) / CELL)), Math.min(n - 1, Math.floor((hi - o) / CELL))]
  for (const { box } of builtIns) {
    if (box.max.y < BAND[0] || box.min.y > BAND[1]) continue
    const w = box.max.x - box.min.x, d = box.max.z - box.min.z
    if (w < LOOSE && d < LOOSE && box.max.y < LOOSE_H) continue
    const [i0, i1] = span(box.min.x - RADIUS, box.max.x + RADIUS, x0, nx)
    const [j0, j1] = span(box.min.z - RADIUS, box.max.z + RADIUS, z0, nz)
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = cx(i), z = cz(j), k = j * nx + i
      const dist = Math.hypot(Math.max(box.min.x - x, 0, x - box.max.x), Math.max(box.min.z - z, 0, z - box.max.z))
      if (dist === 0) solid[k] = 1
      if (door[k] || kind[k] === HARD || dist > RADIUS) continue
      kind[k] = dist <= TOUCH ? HARD : NEAR
    }
  }
  const keep = RADIUS + MARGIN
  for (const t of things) {
    const r = Math.hypot(t.w, t.d) / 2 + keep
    const [i0, i1] = span(t.x - r, t.x + r, x0, nx)
    const [j0, j1] = span(t.z - r, t.z + r, z0, nz)
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const dist = fromThing(t, cx(i), cz(j))
      if (dist <= 0) solid[j * nx + i] = 1
      if (dist <= keep) kind[j * nx + i] = HARD
    }
  }

  const cellOf = ([x, z]: P) => {
    const i = Math.floor((x - x0) / CELL), j = Math.floor((z - z0) / CELL)
    return i < 0 || j < 0 || i >= nx || j >= nz ? -1 : j * nx + i
  }
  const at = (k: number): P => [cx(k % nx), cz(Math.floor(k / nx))]
  const nearThing = (x: number, z: number, r: number) => things.some((t) => fromThing(t, x, z) < r)

  /** The open cell nearest a point, searched outward ring by ring, or -1. */
  const openNear = (p: P) => {
    const k = cellOf(p)
    if (k < 0) return -1
    if (kind[k] !== HARD) return k
    const i = k % nx, j = Math.floor(k / nx)
    let best = -1, bestD = Infinity
    for (let r = 1; r * CELL <= REACH && best < 0; r++) {
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue
        const a = i + di, b = j + dj
        if (a < 0 || b < 0 || a >= nx || b >= nz || kind[b * nx + a] === HARD) continue
        const q = at(b * nx + a), d = Math.hypot(q[0] - p[0], q[1] - p[1])
        if (d < bestD) [best, bestD] = [b * nx + a, d]
      }
    }
    return best
  }

  /** Cells a straight line between two points passes over, sampled at half a cell. */
  const along = (a: P, b: P, each: (k: number) => boolean) => {
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (CELL / 2)))
    for (let s = 0; s <= n; s++) {
      const k = cellOf([a[0] + ((b[0] - a[0]) * s) / n, a[1] + ((b[1] - a[1]) * s) / n])
      if (k < 0 || !each(k)) return false
    }
    return true
  }

  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const
  const g = new Float64Array(nx * nz), prev = new Int32Array(nx * nz)
  const search = (s: number, goal: number): number[] | null => {
    g.fill(Infinity)
    prev.fill(-1)
    const gi = goal % nx, gj = Math.floor(goal / nx)
    const h = (k: number) => {
      const di = Math.abs((k % nx) - gi), dj = Math.abs(Math.floor(k / nx) - gj)
      return (Math.max(di, dj) + (Math.SQRT2 - 1) * Math.min(di, dj)) * CELL
    }
    // A binary heap of [f, cell].
    const heap: Array<[number, number]> = []
    const push = (f: number, k: number) => {
      heap.push([f, k])
      for (let i = heap.length - 1; i > 0;) {
        const p = (i - 1) >> 1
        if (heap[p][0] <= heap[i][0]) break
        ;[heap[p], heap[i]] = [heap[i], heap[p]]
        i = p
      }
    }
    const pop = () => {
      const top = heap[0], last = heap.pop()!
      if (heap.length) {
        heap[0] = last
        for (let i = 0; ;) {
          const l = 2 * i + 1, r = l + 1
          let m = i
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r
          if (m === i) break
          ;[heap[m], heap[i]] = [heap[i], heap[m]]
          i = m
        }
      }
      return top
    }
    g[s] = 0
    push(h(s), s)
    while (heap.length) {
      const [f, k] = pop()
      if (k === goal) break
      if (f - h(k) > g[k] + 1e-9) continue
      const i = k % nx, j = Math.floor(k / nx)
      for (const [di, dj] of DIRS) {
        const a = i + di, b = j + dj
        if (a < 0 || b < 0 || a >= nx || b >= nz) continue
        const n = b * nx + a
        if (kind[n] === HARD) continue
        // No cutting a corner past something hard.
        if (di && dj && (kind[j * nx + a] === HARD || kind[b * nx + i] === HARD)) continue
        const c = g[k] + (di && dj ? Math.SQRT2 : 1) * CELL * (kind[n] === NEAR ? NEAR_COST : 1)
        if (c < g[n]) {
          g[n] = c
          prev[n] = k
          push(c + h(n), n)
        }
      }
    }
    if (g[goal] === Infinity) return null
    const cells: number[] = []
    for (let k = goal; k >= 0; k = prev[k]) cells.push(k)
    return cells.reverse()
  }

  const floor: Floor = {
    clear(points, from, to) {
      const fromNear = nearThing(from[0], from[1], keep), toNear = nearThing(to[0], to[1], keep)
      return points.every(([x, z]) => {
        if ((fromNear && Math.hypot(x - from[0], z - from[1]) < OWN_STEPS) || (toNear && Math.hypot(x - to[0], z - to[1]) < OWN_STEPS)) return true
        return !nearThing(x, z, RADIUS)
      })
    },
    path(from, to) {
      const s = openNear(from), e = openNear(to)
      if (s < 0 || e < 0) return null
      const cells = search(s, e)
      if (!cells) return null
      // Pull the cell path straight: from each kept point, as far ahead as a line stays off hard cells
      // and passes no more near cells than the path did.
      const nearUpTo = [0]
      for (const k of cells) nearUpTo.push(nearUpTo[nearUpTo.length - 1] + (kind[k] === NEAR ? 1 : 0))
      const kept = [0]
      for (let i = 0; i < cells.length - 1;) {
        let j = cells.length - 1
        for (; j > i + 1; j--) {
          let near = 0
          const ok = along(at(cells[i]), at(cells[j]), (k) => {
            if (kind[k] === NEAR) near++
            return kind[k] !== HARD
          })
          // The line is sampled at half a cell, so it counts each cell about twice.
          if (ok && near <= 2 * (nearUpTo[j + 1] - nearUpTo[i]) + 1) break
        }
        kept.push(j)
        i = j
      }
      const pts: P[] = [from]
      for (const i of kept) pts.push(at(cells[i]))
      // Its spot, unless something now stands on it: then the open floor nearest it.
      const k = cellOf(to)
      if (k >= 0 && !solid[k] && !nearThing(to[0], to[1], 0)) pts.push(to)
      // Short steps, so the smooth curve keeps to the line.
      const out: P[] = [pts[0]]
      for (let i = 1; i < pts.length; i++) {
        const [a, b] = [pts[i - 1], pts[i]]
        const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / STEP)
        for (let s = 1; s <= n; s++) out.push([a[0] + ((b[0] - a[0]) * s) / n, a[1] + ((b[1] - a[1]) * s) / n])
      }
      return out
    },
    stats: { cells: nx * nz, buildMs: 0 },
  }
  floor.stats.buildMs = performance.now() - t0
  return floor
}
