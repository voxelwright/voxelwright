// Regression test for cable car phase coordination on shared tracks and crossings (#94).
// Verifies:
//   1. The old coprime per-line departure periods (111 s vs 118 s) inevitably overlap on shared corridors.
//   2. `coordinateCablePhases` with shared 120 s cycle-aligned departures keeps strictly positive OBB
//      clearance at 0.25 s resolution across shared tracks, opposite parallel tracks, and crossings,
//      even with 60 s traffic lights along the route.
//   3. When the local SF transit.json is present, all 6 real SF cable car lines achieve positive OBB clearance.
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { boxGap, coordinateCablePhases } from '../page/street.ts'

const SPEED = 42, STEP = 0.25, CYCLE = 60, EVERY = CYCLE * 2
const HALF_L = 41.5, HALF_W = 12 // actual cable-car model: 8.3 m x 2.4 m (fleet.mjs)

function makeLine(pts, seed) {
  const n = pts.length >> 1
  const p = Float64Array.from(pts)
  const cum = new Float64Array(n)
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(p[2 * i] - p[2 * i - 2], p[2 * i + 1] - p[2 * i - 1])
  return { p, cum, len: cum[n - 1], seed }
}

function alongLine(l, s) {
  const { p, cum } = l, n = cum.length
  if (s <= 0) { const dx = p[2] - p[0], dz = p[3] - p[1], len = Math.hypot(dx, dz) || 1; return { x: p[0], z: p[1], tx: dx / len, tz: dz / len } }
  if (s >= cum[n - 1]) { const dx = p[2 * n - 2] - p[2 * n - 4], dz = p[2 * n - 1] - p[2 * n - 3], len = Math.hypot(dx, dz) || 1; return { x: p[2 * n - 2], z: p[2 * n - 1], tx: dx / len, tz: dz / len } }
  let lo = 0, hi = n - 1
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m }
  const f = (s - cum[lo]) / Math.max(1e-6, cum[hi] - cum[lo])
  const dx = p[2 * hi] - p[2 * lo], dz = p[2 * hi + 1] - p[2 * lo + 1], len = Math.hypot(dx, dz) || 1
  return { x: p[2 * lo] + dx * f, z: p[2 * lo + 1] + dz * f, tx: dx / len, tz: dz / len }
}

/** Deterministic timetable with periodic 60 s red lights along the line. */
function makeTimetable(lights) {
  const cache = new Map()
  return (l, left) => {
    const key = `${l.seed}:${left}`
    if (cache.has(key)) return cache.get(key)
    const out = []
    let s = 0, v = SPEED, tau = 0
    while (s < l.len && out.length < 40000) {
      out.push(s)
      let stop = Infinity
      for (const L of lights) {
        const d = L.s - s
        if (d < 0 || d > 400) continue
        const u = ((left + tau + L.offset) % CYCLE + CYCLE) % CYCLE
        if (u >= 29) { stop = d; break }
      }
      const most = stop === Infinity ? SPEED : Math.sqrt(2 * 14 * Math.max(0, stop - 2))
      v = Math.min(SPEED, most, v + 9 * STEP)
      s += v * STEP; tau += STEP
    }
    out.push(l.len)
    const arr = Float32Array.from(out)
    cache.set(key, arr)
    return arr
  }
}

function worstGapOverWindow(lines, schedules, ttAt, durationS, stepS = 0.25) {
  let worst = Infinity
  for (let t = 0; t < durationS; t += stepS) {
    const cars = []
    for (let li = 0; li < lines.length; li++) {
      const l = lines[li], { every, base } = schedules[li]
      const most = (2 * l.len) / SPEED + 300
      for (let n = Math.ceil((t - most - base) / every); n <= Math.floor((t - base) / every); n++) {
        const t0 = base + n * every
        const tt = ttAt(l, ((t0 % CYCLE) + CYCLE) % CYCLE)
        const f = (t - t0) / STEP, i = Math.floor(f)
        if (i < 0 || i + 1 >= tt.length) continue
        const s = tt[i] + (tt[i + 1] - tt[i]) * (f - i)
        cars.push({ li, ...alongLine(l, s) })
      }
    }
    for (let i = 0; i < cars.length; i++) {
      for (let j = i + 1; j < cars.length; j++) {
        const a = cars[i], b = cars[j]
        if (Math.abs(a.x - b.x) > 200 || Math.abs(a.z - b.z) > 200) continue
        const g = boxGap(a.x, a.z, a.tx, a.tz, HALF_L, HALF_W, b.x, b.z, b.tx, b.tz, HALF_L, HALF_W)
        if (g < worst) worst = g
      }
    }
  }
  return worst
}

// 1. Synthetic SF topology: PH & PM sharing a 1.5 km corridor + diverging, plus California crossing at (0, 7500).
const ph = makeLine([0, 0, 0, 15000, -17690, 15000], 101) // 3269 m -> old every = 111 s
const pm = makeLine([0, 0, 0, 15000, -9760, 15000], 202)  // 2476 m -> old every = 118 s
const cal = makeLine([-11000, 7500, 11500, 7500], 303)    // 2250 m crossing at (0, 7500)
const synth = [ph, pm, cal]
const lights = [
  { s: 3500, offset: 11 },
  { s: 7440, offset: 27 },
  { s: 11200, offset: 43 },
]
const ttAt = makeTimetable(lights)

// Confirm the old coprime schedule DOES collide deeply on the shared corridor (fails on old logic).
const oldSchedules = synth.map((l) => {
  const count = Math.max(1, Math.floor(l.len / 4200))
  const every = Math.max(30, Math.round(l.len / count / SPEED))
  return { every, base: 0 }
})
const oldWorst = worstGapOverWindow(synth, oldSchedules, ttAt, 3600, 1.0)
assert(oldWorst < -20, `expected old coprime schedule to overlap deeply, got ${(oldWorst / 10).toFixed(2)} m`)

// Confirm coordinated 120 s phases keep strictly positive OBB clearance across the entire period at 0.25 s.
const bases = coordinateCablePhases(synth, ttAt)
const newSchedules = synth.map((l) => ({ every: EVERY, base: bases.get(l) ?? 0 }))
const newWorst = worstGapOverWindow(synth, newSchedules, ttAt, EVERY, 0.25)
assert(newWorst > 5, `expected coordinated schedule to keep > 0.5 m clearance, got ${(newWorst / 10).toFixed(2)} m`)
console.log(`  ok   synthetic shared+crossing lines: old worst ${(oldWorst / 10).toFixed(2)} m -> coordinated worst +${(newWorst / 10).toFixed(2)} m`)

// 2. Real SF transit.json check when staged releases are present locally.
const relRoot = join(homedir(), '.village', 'engine', 'bay', '450-city-paint', 'sf', 'releases')
if (existsSync(relRoot)) {
  const dirs = readdirSync(relRoot).sort()
  const transitPath = dirs.map((d) => join(relRoot, d, 'life', 'transit.json')).filter(existsSync).at(-1)
  if (transitPath) {
    const transit = JSON.parse(readFileSync(transitPath, 'utf8'))
    const sfLines = []
    for (const r of transit.routes) {
      if (r.kind !== 'cable') continue
      for (const flat of r.lines) {
        const l = makeLine(flat, (flat[0] | 0) ^ ((flat[1] | 0) * 31))
        if (l.len >= 3000) sfLines.push(l)
      }
    }
    const plainTt = makeTimetable([])
    const sfBases = coordinateCablePhases(sfLines, plainTt)
    const sfSched = sfLines.map((l) => ({ every: EVERY, base: sfBases.get(l) ?? 0 }))
    const sfWorst = worstGapOverWindow(sfLines, sfSched, plainTt, EVERY, 0.25)
    assert(sfWorst > 0, `expected real SF cable lines to have zero overlap, got ${(sfWorst / 10).toFixed(2)} m`)
    console.log(`  ok   real SF ${sfLines.length} cable lines: coordinated worst +${(sfWorst / 10).toFixed(2)} m over full 120 s cycle`)
  }
}
