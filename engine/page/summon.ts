// Instant street-level sports car summon (G key on foot): finds the nearest clear street asphalt spot
// within ~60 m at true street level (never on a building roof) and delivers a high-detail 2.5 cm drivable
// sports coupe aligned with the road, capping to 1 unmounted summoned car so it never leaks bodies.
import { POLISHED } from './spells.ts'
import { coarser, GT_COUPE, sculptCoupe } from './car-sculpt.ts'
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

/** Its paint: red steel (a kind is a material and a colour, kinds.rs), hue 0 at tone 4. */
const PAINT = 12 | ((16 + 0 * 10 + 4) << 8)

/** The GT coupe (car-sculpt.ts, the SF library's coupe too) at 2.5 cm, its paint polished, and its 10 cm body made from it; built once. */
let cachedCoupe: Omit<Making, 'low'> | null = null

function sportsCoupeData(): Omit<Making, 'low'> {
  if (cachedCoupe) return cachedCoupe
  const { cells, size } = sculptCoupe({ ...GT_COUPE, paint: PAINT | POLISHED })
  const body = coarser(cells, size, GT_COUPE.per), [, , bd] = body.size, [ex, ey, ez] = GT_COUPE.eye
  const foot = (x: number, z: number, front: boolean): Foot => ({ at: [x, 3.0, z], reach: 5.5, steers: front, drives: !front })
  const [xr, xf] = GT_COUPE.wheels.map((x) => x * 10)
  cachedCoupe = {
    name: 'sports coupe',
    cells: Int32Array.from(body.kinds),
    size: body.size,
    controls: 'drive',
    // Blistering & drift-happy sports coupe handling (212 km/h top, matches sf/fleet.mjs HANDLING.coupe).
    motor: {
      front: 0, grip: 1.24, power: 142, top: 590, steer: 0.62,
      hover: 0, lift: 0, upright: 0, turns: 0, jump: 0, tough: 220,
      feet: [foot(xr, 1, false), foot(xr, bd - 1, false), foot(xf, 1, true), foot(xf, bd - 1, true)],
    },
    seats: [[ex * 10 + 0.5, -1.2, ez * 10], [ex * 10 + 0.5, -1.2, bd - ez * 10]],
    eye: [ex * 10, ey * 10, ez * 10],
    fine: [{ size, per: GT_COUPE.per, low: [0, 0, 0], cells }],
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
        opts.hud.notice('Car delivered nearby: press E to drive', 4000)
        return thing
      } finally {
        busy = false
      }
    },
  }
}
