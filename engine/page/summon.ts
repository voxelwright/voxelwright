// Instant street-level sports car summon (G key on foot): finds the nearest clear street asphalt spot
// within ~60 m at true street level (never on a building roof) and delivers a high-detail 2.5 cm drivable
// sports coupe aligned with the road, capping to 1 unmounted summoned car so it never leaks bodies.
import { POLISHED } from './spells.ts'
import type { Foot, Living, Making, Thing } from './living.ts'
import type { Hud } from './hud.ts'
import type { Street } from './street.ts'

export interface SummonLand {
  ground_at(x: number, z: number): number
  feet_at(x: number, z: number): number
  top_at(x: number, z: number): number
  world_kind(x: number, y: number, z: number): number
}

export interface SummonOptions {
  land: SummonLand
  alive: Living
  hud: Hud
  /** Current player anchor in 10 cm world cells (feet if on foot, else camera pose) and facing yaw (0 = North/-z). */
  origin(): { x: number; z: number; yaw: number }
  /** Optional street life graph for instant road-aligned placement in SF pilot squares. */
  street(): Street | null
  /** Optional citywide OSM street ways lookup (bay.ts `names`) for all 155 squares of San Francisco. */
  ways?(at: readonly [number, number], radius: number): Promise<{ ways: { line: readonly (readonly [number, number])[] }[] }[]>
}

export interface CarSummon {
  summon(): Promise<Thing | null>
  clear(): void
  readonly car: Thing | null
}

const STEEL = 12, GLASS = 11, ROOFING = 14, LAMP = 15
const kindOf = (material: number, colour = 0) => material | (colour << 8)
const hue = (h: number, tone: number) => 16 + (h % 24) * 10 + (tone % 10)
const grey = (step: number) => 1 + step

/** Built-once high-detail 2.5 cm sports coupe voxel data (4.4 m x 1.26 m x 1.96 m) + 10 cm collision shell. */
let cachedCoupe: Omit<Making, 'low'> | null = null

function sportsCoupeData(): Omit<Making, 'low'> {
  if (cachedCoupe) return cachedCoupe
  const per = 4, L = 4.4, Wd = 1.96, H = 1.26, s = per * 10
  const W = Math.ceil(L * s), Ht = Math.ceil(H * s), D = Math.ceil(Wd * s)
  const fineCells = new Uint16Array(W * Ht * D)
  const c = (m: number) => Math.round(m * s)
  const set = (x: number, y: number, z: number, v: number) => {
    if (x >= 0 && x < W && y >= 0 && y < Ht && z >= 0 && z < D) fineCells[x + W * (z + D * y)] = v
  }
  const get = (x: number, y: number, z: number) =>
    x >= 0 && x < W && y >= 0 && y < Ht && z >= 0 && z < D ? fineCells[x + W * (z + D * y)] : 0
  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, v: number) => {
    for (let y = c(y0); y < c(y1); y++)
      for (let z = c(z0); z < c(z1); z++)
        for (let x = c(x0); x < c(x1); x++) set(x, y, z, v)
  }
  const rounded = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, r: number, v: number) => {
    const R = r * s
    for (let y = c(y0); y < c(y1); y++)
      for (let z = c(z0); z < c(z1); z++)
        for (let x = c(x0); x < c(x1); x++) {
          const dx = Math.max(c(x0) + R - x - 0.5, 0, x + 0.5 - (c(x1) - R))
          const dz = Math.max(c(z0) + R - z - 0.5, 0, z + 0.5 - (c(z1) - R))
          if (Math.hypot(dx, dz) <= R) set(x, y, z, v)
        }
  }
  const wheel = (xm: number, ym: number, z0: number, z1: number, r: number, tyre: number, hub: number, cap: number) => {
    const R = r * s
    for (let y = c(ym - r); y <= c(ym + r); y++)
      for (let x = c(xm - r); x <= c(xm + r); x++) {
        const d = Math.hypot(x - c(xm), y - c(ym))
        if (d > R) continue
        const a = Math.atan2(y - c(ym), x - c(xm))
        const spoke = Math.abs(Math.sin(a * 2.5)) < 0.22 && d > R * 0.16 && d < R * 0.52
        const face = d < R * 0.55 && (d > R * 0.48 || d < R * 0.15 || spoke)
        for (let z = c(z0); z < c(z1); z++) {
          set(x, y, z, d >= R * 0.55 ? tyre : face && (z === c(z0) || z === c(z1) - 1) ? cap : hub)
        }
      }
  }

  const PAINT = kindOf(STEEL, hue(0, 4)) | POLISHED
  const DARK = kindOf(ROOFING, grey(13))
  const TRIM = kindOf(STEEL, grey(12))
  const TYRE = kindOf(ROOFING, grey(14))
  const RIM = kindOf(STEEL, grey(5))
  const CAP = kindOf(STEEL, grey(10))
  const GLASS_ = kindOf(GLASS, grey(12))
  const HEAD = kindOf(LAMP, 1)
  const TAIL = kindOf(LAMP, hue(0, 4))
  const SEAT = kindOf(ROOFING, grey(11))

  // Low sculpted wedge body, tapered nose, muscular haunches.
  rounded(0.08, L - 0.06, 0.22, 0.72, 0.04, Wd - 0.04, 0.18, PAINT)
  for (let i = 0; i < 14; i++) {
    const t = i / 14
    rounded(L - 1.35 + t * 1.25, L - 0.04, 0.56 - t * 0.16, 0.78 - t * 0.22, 0.08, Wd - 0.08, 0.16, PAINT)
  }
  rounded(0.12, 1.35, 0.64, 0.80, 0.06, Wd - 0.06, 0.16, PAINT)
  // Fastback cabin greenhouse with sloped windscreen & pillars.
  for (let i = 0; i < 16; i++) {
    const t = i / 16
    const y0 = 0.72 + t * 0.50, y1 = y0 + 0.04
    const x0 = 0.85 + t * 0.58, x1 = 3.10 - t * 0.65
    const inset = 0.14 + t * 0.16
    rounded(x0, x1, y0, y1, inset, Wd - inset, 0.12, t > 0.84 ? PAINT : GLASS_)
    box(x1 - 0.07, x1, y0, y1, inset, inset + 0.07, PAINT)
    box(x1 - 0.07, x1, y0, y1, Wd - inset - 0.07, Wd - inset, PAINT)
    box(x0, x0 + 0.09, y0, y1, inset, inset + 0.08, PAINT)
    box(x0, x0 + 0.09, y0, y1, Wd - inset - 0.08, Wd - inset, PAINT)
  }
  rounded(1.42, 2.46, 1.18, H, 0.28, Wd - 0.28, 0.10, PAINT)
  // Rear carbon-black wing spoiler, splitter, diffuser, side skirts & air intakes, twin exhausts, LED lamps.
  for (const z of [0.36, Wd - 0.44]) box(0.14, 0.28, 0.78, 0.90, z, z + 0.08, DARK)
  box(0.06, 0.26, 0.88, 0.94, 0.12, Wd - 0.12, DARK)
  box(L - 0.18, L, 0.18, 0.28, 0.08, Wd - 0.08, DARK)
  box(0.02, 0.20, 0.18, 0.34, 0.14, Wd - 0.14, DARK)
  for (const [z0, z1] of [[0.04, 0.10], [Wd - 0.10, Wd - 0.04]]) {
    box(0.95, L - 1.15, 0.18, 0.28, z0, z1, DARK)
    box(1.30, 1.65, 0.34, 0.60, z0, z1, DARK)
  }
  for (const z of [0.44, Wd - 0.56]) box(0, 0.12, 0.22, 0.30, z, z + 0.12, RIM)
  box(L - 0.04, L, 0.28, 0.46, 0.36, Wd - 0.36, DARK)
  for (const z of [0.12, Wd - 0.44]) box(L - 0.05, L, 0.44, 0.54, z, z + 0.32, HEAD)
  box(0.02, 0.08, 0.58, 0.66, 0.14, Wd - 0.14, TAIL)

  // Hollow shell so interior shows cleanly through the cabin glass.
  const hollowed = fineCells.slice()
  for (let y = 1; y < Ht - 1; y++)
    for (let z = 1; z < D - 1; z++)
      for (let x = 1; x < W - 1; x++) {
        const i = x + W * (z + D * y)
        if (fineCells[i] && get(x + 1, y, z) && get(x - 1, y, z) && get(x, y + 1, z) && get(x, y - 1, z) && get(x, y, z + 1) && get(x, y, z - 1)) hollowed[i] = 0
      }
  fineCells.set(hollowed)

  // Interior floor, twin bucket seats, dashboard, and steering wheel.
  box(1.15, 2.95, 0.24, 0.30, 0.16, Wd - 0.16, DARK)
  for (const z of [0.28, Wd - 0.82]) {
    box(1.55, 2.15, 0.30, 0.48, z, z + 0.54, SEAT)
    box(1.42, 1.62, 0.48, 0.96, z, z + 0.54, SEAT)
  }
  box(2.48, 2.86, 0.56, 0.78, 0.18, Wd - 0.18, TRIM)
  box(2.34, 2.48, 0.66, 0.86, 0.44, 0.74, DARK)

  // Carve arches & place wide performance tyres with bright alloy rims.
  for (const xm of [0.92, L - 0.92]) {
    for (let y = c(0.18); y <= c(0.76); y++)
      for (let x = c(xm - 0.42); x <= c(xm + 0.42); x++) {
        const d = Math.hypot(x - c(xm), y - c(0.34))
        if (d < 0.37 * s) for (const z of [0, 1, 2, 3, D - 4, D - 3, D - 2, D - 1]) set(x, y, z, 0)
        else if (d < 0.43 * s) for (const z of [0, 1, D - 2, D - 1]) if (get(x, y, z)) set(x, y, z, DARK)
      }
    for (const [z0, z1] of [[0, 0.24], [Wd - 0.24, Wd]]) wheel(xm, 0.34, z0, z1, 0.34, TYRE, RIM, CAP)
  }

  // Coarsen 2.5 cm look into the 10 cm solver collision body (exact same rule as sf/cars.mjs `coarser`).
  const bw = Math.ceil(W / per), bh = Math.ceil(Ht / per), bd = Math.ceil(D / per)
  const body = new Int32Array(bw * bh * bd)
  const counts = new Map<number, number>()
  for (let y = 0; y < bh; y++)
    for (let z = 0; z < bd; z++)
      for (let x = 0; x < bw; x++) {
        counts.clear()
        let filled = 0
        for (let dy = 0; dy < per; dy++)
          for (let dz = 0; dz < per; dz++)
            for (let dx = 0; dx < per; dx++) {
              const X = x * per + dx, Y = y * per + dy, Z = z * per + dz
              if (X >= W || Y >= Ht || Z >= D) continue
              const k = fineCells[X + W * (Z + D * Y)]
              if (!k) continue
              filled++
              counts.set(k, (counts.get(k) ?? 0) + ((k & 15) === GLASS ? 0.6 : 1))
            }
        if (filled * 3 < per * per * per) continue
        let best = 0, most = -1
        for (const [k, n] of counts) if (n > most) { most = n; best = k }
        body[x + bw * (z + bd * y)] = best & 0xffff
      }

  const foot = (x: number, z: number, front: boolean): Foot => ({ at: [x, 3.0, z], reach: 5.5, steers: front, drives: !front })
  cachedCoupe = {
    name: 'sports coupe',
    cells: body,
    size: [bw, bh, bd],
    controls: 'drive',
    // Blistering & drift-happy sports coupe handling (212 km/h top, matches sf/fleet.mjs HANDLING.coupe).
    motor: {
      front: 0, grip: 1.24, power: 142, top: 590, steer: 0.62,
      hover: 0, lift: 0, upright: 0, turns: 0, jump: 0, tough: 220,
      feet: [foot(9, 1, false), foot(9, bd - 1, false), foot(35, 1, true), foot(35, bd - 1, true)],
    },
    seats: [[20, -1.2, 5.5], [20, -1.2, 14.0]],
    eye: [19.5, 9.8, 5.5],
    fine: [{ size: [W, Ht, D], per, low: [0, 0, 0], cells: fineCells }],
  }
  return cachedCoupe
}

export function createCarSummon(opts: SummonOptions): CarSummon {
  let active: Thing | null = null
  let busy = false
  let lastAt = 0

  const isAsphalt = (px: number, pz: number) => (opts.land.top_at(Math.round(px), Math.round(pz)) & 15) === 6

  /**
   * Verifies that `(cx, cz)` oriented along `heading` (radians: front at cos, 0, sin) sits on open street-level
   * asphalt — never on a building roof or inside an overhang, tree, pole, or another living vehicle.
   */
  const spotAt = (cx: number, cz: number, heading: number, size: readonly [number, number, number]): { x: number; y: number; z: number; heading: number } | null => {
    const ix = Math.round(cx), iz = Math.round(cz)
    if (!isAsphalt(ix, iz)) return null
    const g0 = opts.land.ground_at(ix, iz)
    // Reject anything under a building roof, arcade, or upper deck (true street level only!).
    if (opts.land.feet_at(ix, iz) - g0 > 12) return null

    // Avoid spawning directly on top of another living vehicle.
    for (const t of opts.alive.things) {
      if (!t.alive || t === active) continue
      const w = opts.alive.where(t)
      if (w && Math.hypot(w.at[0] - cx, w.at[2] - cz) < 55) return null
    }

    const fx = Math.cos(heading), fz = Math.sin(heading)
    const rx = -fz, rz = fx
    const halfL = size[0] / 2 + 3, halfW = size[2] / 2 + 2
    const pts: [number, number][] = [
      [cx, cz],
      [cx + fx * halfL + rx * halfW, cz + fz * halfL + rz * halfW],
      [cx + fx * halfL - rx * halfW, cz + fz * halfL - rz * halfW],
      [cx - fx * halfL + rx * halfW, cz - fz * halfL + rz * halfW],
      [cx - fx * halfL - rx * halfW, cz - fz * halfL - rz * halfW],
    ]
    let minG = Infinity, maxG = -Infinity
    for (const [px, pz] of pts) {
      const rpx = Math.round(px), rpz = Math.round(pz)
      if (!isAsphalt(rpx, rpz)) return null
      const g = opts.land.ground_at(rpx, rpz)
      if (opts.land.feet_at(rpx, rpz) - g > 12) return null
      if (g < minG) minG = g
      if (g > maxG) maxG = g
      // Headroom check: clear of walls, trees, parked props, and poles above the asphalt.
      for (let y = 3; y <= size[1] + 8; y += 3) {
        if (opts.land.world_kind(rpx, g + y, rpz)) return null
      }
    }
    // Keep grade drivable (up to ~18% for SF hills).
    if (maxG - minG > (halfL * 2) / 5.5) return null
    return { x: Math.round(cx), y: maxG, z: Math.round(cz), heading }
  }

  /** Steps from a road centerline toward the right/left kerb to park cleanly beside the road, or uses the lane if narrow. */
  const tryRoadPoint = (px: number, pz: number, heading: number, size: readonly [number, number, number]) => {
    const rx = -Math.sin(heading), rz = Math.cos(heading)
    const wide = size[2] / 2 + 3
    for (const side of [1, -1]) {
      let out = 0
      while (out < 120 && isAsphalt(px + rx * side * (out + 3), pz + rz * side * (out + 3))) out += 3
      if (out >= wide) {
        const kSpot = spotAt(px + rx * side * Math.max(0, out - wide), pz + rz * side * Math.max(0, out - wide), heading, size)
        if (kSpot) return kSpot
      }
    }
    return spotAt(px, pz, heading, size)
  }

  /** Finds the nearest clear street asphalt spot within ~60 m (600 cells) at true street level. */
  const findStreetSpot = async (ox: number, oz: number, size: readonly [number, number, number]) => {
    const MAX_R = 600 // 60 m in 10 cm cells
    const candidates: { x: number; z: number; heading: number; far: number }[] = []

    // 1. Fast path: use SF street life graph roads when loaded nearby (exact open-road centerlines & headings).
    const st = opts.street()
    if (st?.ready) {
      for (const r of st.roads(ox, oz, MAX_R + 60)) {
        if (r.open === false) continue
        const l = r.line
        for (let i = 0; i + 3 < l.length; i += 2) {
          const ax = l[i], az = l[i + 1], bx = l[i + 2], bz = l[i + 3]
          const len = Math.hypot(bx - ax, bz - az)
          if (len < 10) continue
          const heading = Math.atan2(bz - az, bx - ax)
          for (let d = 0; d <= len; d += 25) {
            const px = ax + ((bx - ax) * d) / len, pz = az + ((bz - az) * d) / len
            const far = Math.hypot(px - ox, pz - oz)
            if (far <= MAX_R) candidates.push({ x: px, z: pz, heading, far })
          }
        }
      }
    }

    // 2. Citywide SF OSM road ways fallback (all 155 squares, any road orientation).
    if (!candidates.length && opts.ways) {
      for (const sq of await opts.ways([ox, oz], MAX_R + 80).catch(() => [])) {
        for (const way of sq.ways) {
          for (let i = 1; i < way.line.length; i++) {
            const [ax, az] = way.line[i - 1], [bx, bz] = way.line[i]
            const len = Math.hypot(bx - ax, bz - az)
            if (len < 10) continue
            const heading = Math.atan2(bz - az, bx - ax)
            for (let d = 0; d <= len; d += 25) {
              const px = ax + ((bx - ax) * d) / len, pz = az + ((bz - az) * d) / len
              const far = Math.hypot(px - ox, pz - oz)
              if (far <= MAX_R) candidates.push({ x: px, z: pz, heading, far })
            }
          }
        }
      }
    }

    // Sort nearest first, slightly preferring 4..60 m so the car lands beside the player rather than on their feet.
    candidates.sort((a, b) => Math.abs(a.far - 55) - Math.abs(b.far - 55))
    for (const c of candidates) {
      const hit = tryRoadPoint(c.x, c.z, c.heading, size)
      if (hit) return hit
    }

    // 3. Universal radial asphalt spiral within 5..60 m (works in /city and anywhere without way metadata).
    const dirs = [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4]
    for (let rad = 50; rad <= MAX_R; rad += 20) {
      const steps = rad < 140 ? 16 : 24
      for (let i = 0; i < steps; i++) {
        const a = (i * Math.PI * 2) / steps
        const px = ox + Math.cos(a) * rad, pz = oz + Math.sin(a) * rad
        if (!isAsphalt(px, pz)) continue
        // Pick the corridor direction with the longest clear asphalt run.
        let bestH = 0, bestRun = -1
        for (const h of dirs) {
          const fx = Math.cos(h), fz = Math.sin(h)
          let run = 0
          for (const sgn of [1, -1]) for (let step = 10; step <= 80; step += 10) {
            if (isAsphalt(px + fx * sgn * step, pz + fz * sgn * step)) run++
            else break
          }
          if (run > bestRun) { bestRun = run; bestH = h }
        }
        const hit = tryRoadPoint(px, pz, bestH, size)
        if (hit) return hit
      }
    }
    return null
  }

  return {
    get car() { return active && active.alive ? active : null },
    clear() {
      if (active && active.alive && opts.alive.riding !== active) opts.alive.vanish(active)
      active = null
    },
    async summon() {
      const now = performance.now()
      if (busy || opts.alive.riding || now - lastAt < 500) return null
      busy = true
      lastAt = now
      try {
        const data = sportsCoupeData()
        const o = opts.origin()
        const spot = await findStreetSpot(o.x, o.z, data.size)
        if (!spot) {
          opts.hud.notice('No clear street nearby to deliver a car', 3200)
          return null
        }
        // Cap to 1 unmounted summoned car: replace the previous one cleanly so bodies never leak.
        if (active && active.alive && opts.alive.riding !== active) {
          opts.alive.vanish(active)
        }
        active = null

        const low: [number, number, number] = [
          Math.round(spot.x - data.size[0] / 2),
          spot.y + 3,
          Math.round(spot.z - data.size[2] / 2),
        ]
        const thing = await opts.alive.spawn({ ...data, low })
        if (!thing.alive) {
          opts.hud.notice('Could not deliver car right here', 2800)
          return null
        }
        // Align the spawned sports coupe smoothly along the street heading.
        const own = [0, Math.PI, -Math.PI / 2, Math.PI / 2][thing.motor.front]
        const yawQ = own - spot.heading
        const q: [number, number, number, number] = [0, Math.sin(yawQ / 2), 0, Math.cos(yawQ / 2)]
        const at = opts.alive.where(thing)
        const comY = at ? at.at[1] - low[1] : data.size[1] * 0.42
        opts.alive.place(thing, [spot.x, spot.y + comY + 1, spot.z], q)
        active = thing
        opts.hud.notice('Car delivered nearby — press E to drive', 4000)
        return thing
      } finally {
        busy = false
      }
    },
  }
}
