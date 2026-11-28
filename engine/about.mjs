// Getting about (#218, for #264): how a body the world's process moves gets from where it is to where it is
// going. A walk is a straight line while that is open. Stopped by something, the body looks for a way round
// over the world's own cells, edits and all (a search over a grid of standing places, each step one a person
// could take: along, up a kerb or a stair, down a drop, or up onto something waist-high with the hands), and
// walks that. A body can be told to follow someone, to keep away from them, or to keep a distance; and a rule
// hears `near` when a person comes within an actor's reach or into a place it marked, so it need not look
// every tick.
//
// And a body gets about as a person can, by the numbers a rule gives it (`can`: the names and ranges a person's
// have, rules/bodies.mjs): `climb` cells of wall it goes up, on the wall's face by its own up; `jump` how high it
// leaps, and with its pace and `fall` how wide a gap; `fly` how fast it goes through the air. One that can jump,
// climb or fly comes down from any height. With none of them it is as it was: it walks.
//
// For world.mjs, which owns the bodies (`folk`) and says what a cell is.

/** How far apart the standing places a way is searched over are (cells), and how many may be looked at in one search: about a tenth of a second of the world's one thread at the very most. */
const GRID = 4, LOOKED_MOST = 900
/** How high a body gets up onto something with its hands (cells: a car's bonnet, a wall to the waist), and how long that takes (ms). */
const HANDS = 10, CLIMB_MS = 550
/** How far up a wall and down a drop is looked for a place to stand, for a body that climbs or comes down (cells), and the world's pull (cells a second, each second). */
const FAR_UP = 600, PULL = 98
/** How long a way that was not found is not looked for again (ms), and how often a body following someone looks again. */
const NO_WAY_FOR = 3000, AGAIN_AFTER = 700
/** The furthest an actor's reach and a marked place may go (cells), and the most places a rule may mark. */
/** How far apart two bodies' middles are kept (cells): a body is about four and a half across the shoulders. */
export const APART = 6
export const REACH_MOST = 600, MARK_WITHIN_MOST = 2000, MARKS_MOST = 32

// Rust WASM NavMesh / Flow-Field / ORCA-RVO2 constants (matching engine/core/src/nav/).
const NAV_ALLOW_VAULT = 1 << 0
const NAV_ALLOW_DROP = 1 << 1
const NAV_ALLOW_CLIMB = 1 << 2
const CROWD_FLAG_STATIC = 1 << 0
const CROWD_FLAG_IGNORE_WORLD = 1 << 2
const FIELD_POS_X = 0, FIELD_POS_Z = 1, FIELD_POS_Y = 2
const FIELD_VEL_X = 3, FIELD_VEL_Z = 4
const FIELD_PREF_VX = 5, FIELD_PREF_VZ = 6
const FIELD_RADIUS = 7, FIELD_MAX_SPEED = 8, FIELD_FLAGS = 9
/** Fast WASM nav searches allowed per tick (vs 1/tick for JS A* fallback). */
const WASM_SEARCHES_PER_TICK = 12
/** Maximum vertical rise supported by Rust WASM nav climb edges (CLIMB_MAX = 64). */
const WASM_CLIMB_MAX = 64

/**
 * @param folk     everyone with a body, by key
 * @param footing  (x, y, z) => where feet come to rest in a column, coming to it at a height (a step of two up, a drop), or null
 * @param kind     (x, y, z) => what a cell is (0: air)
 * @param tall     how tall a body is, cells
 * @param pace     a walk, cells a second
 * @param say      what stopped a body, as a sentence: (x, y, z) => string
 * @param hear     (ruleId, event, e) => a rule is told something
 * @param rate     optional clock rate multiplier () => number
 * @param core     optional WASM core exports (or getter () => core) providing nav_* / crowd_* fast paths
 * @param memory   optional WebAssembly.Memory override if separate from core.memory
 */
export function about({ folk, footing, kind, tall, pace: PACE, say, hear, rate, core: coreOpt, memory: memoryOpt }) {
  const getCore = () => (typeof coreOpt === 'function' ? coreOpt() : coreOpt) ?? null
  const getMemory = (c) => memoryOpt ?? c?.memory ?? null
  // ── Bodies do not pass through each other ──
  // A body the world moves does not step to within a body's width of anyone else with a body: a person, a seat,
  // another actor. Going away from someone is always allowed (two put on one spot can part). Whoever is near the
  // one being moved is gathered once a step (`crowd`); a way round treats them as it treats a lamp, and keeps a
  // cell further off than a step must, so that a way found is a way that can be walked.
  let crowd = []
  const gather = (p, within) => { crowd = []; for (const o of folk.values()) if (o !== p && !o.gone && Math.abs(o.at[1] - p.at[1]) < tall && Math.hypot(o.at[0] - p.at[0], o.at[2] - p.at[2]) < within) crowd.push(o) }
  /** Who a step from one place to another would press into: someone within a body's width of where it ends, and nearer than where it began. */
  const pressed = (fx, fz, x, z, by = APART) => { for (const o of crowd) { const d = Math.hypot(o.at[0] - x, o.at[2] - z); if (d < by && d < Math.hypot(o.at[0] - fx, o.at[2] - fz) - 1e-6) return o } return null }
  /** Whether a place is clear of everyone but one body (its own): for whoever puts a body somewhere. */
  const blocked = (x, z, but, y) => { for (const o of folk.values()) if (o !== but && !o.gone && (y === undefined || Math.abs(o.at[1] - y) < tall) && Math.hypot(o.at[0] - x, o.at[2] - z) < APART) return o; return null }
  /** The place nearest a place where a body would stand in nobody, and can stand (`can`): itself, or as few steps to one side as there is room. */
  const room = (x, z, but, can = () => true) => {
    if (!blocked(x, z, but)) return [x, z]
    for (let ring = 1; ring <= 6; ring++) {
      const r = APART * ring + 1, n = Math.floor(2 * Math.PI * r / (APART + 1))
      for (let k = 0; k < n; k++) { const a = k * 2 * Math.PI / n + 0.4, at = [Math.round(x + Math.sin(a) * r), Math.round(z - Math.cos(a) * r)]; if (!blocked(at[0], at[1], but) && can(at[0], at[1])) return at }
    }
    return [x, z]
  }
  // ── What the body being moved can do (set for each step, as `crowd` is) ──
  const NOTHING = {}
  let able = NOTHING, going = PACE, mover = null
  const mind = (p) => { able = p.can ?? NOTHING; going = p.pace ?? PACE; mover = p }
  /** Whether a body has room at a place: nothing solid from its feet to its head. */
  const clear = (x, y, z) => { x = Math.round(x); y = Math.round(y); z = Math.round(z); for (let k = 0; k < tall; k++) if (kind(x, y + k, z)) return false; return true }
  /**
   * Where feet come to rest in a column, as `footing` says; or, with the hands, on top of something up to
   * waist-high there; or, for one that climbs, up a wall as high as it climbs; or, for one that jumps, climbs or
   * flies, down a drop of any height. `[feet, climbed]` or null.
   */
  const stand = (x, y, z) => {
    const feet = footing(x, y, z)
    if (feet !== null) return [feet, false]
    x = Math.round(x); y = Math.round(y); z = Math.round(z)
    const high = Math.max(HANDS, Math.min(FAR_UP, able.climb ?? 0))
    for (let up = 3; up <= high; up++) {
      if (!kind(x, y + up - 1, z)) continue
      let room = true
      for (let k = 0; k < tall && room; k++) room = !kind(x, y + up + k, z)
      if (room) return [y + up, true]
    }
    // Nothing to get up onto: a drop, then. It is stepped off by one who comes down from any height.
    if ((able.jump || able.climb || able.fly) && clear(x, y, z)) for (let down = 1; down <= FAR_UP; down++) if (kind(x, y - down, z)) return [y - down + 1, false]
    return null
  }
  /** How far a body leaps along the ground: its pace for as long as its jump keeps it in the air. */
  const span = () => going * 2 * Math.sqrt(2 * (able.jump ?? 0) / (PULL * Math.max(0.05, able.fall ?? 1)))
  /** Whether a body can go straight from a place to another, a cell at a time, without its hands; and the height it arrives at. */
  const straight = (from, to, most = 60) => {
    const dx = to[0] - from[0], dz = to[1] - from[2], far = Math.hypot(dx, dz)
    if (far > most) return null
    let y = from[1]
    for (let d = 1; d <= far; d++) { const x = from[0] + dx / far * d, z = from[2] + dz / far * d, feet = footing(x, y, z); if (feet === null || pressed(from[0] + dx / far * (d - 1), from[2] + dz / far * (d - 1), x, z, APART + 1)) return null; y = feet }
    return y
  }
  /**
   * A way from a place to another over standing places `GRID` apart: the places to pass, in order, the last of them
   * as near the end as could be got; or null if nothing nearer than the start was found. `spent` says how many
   * places were looked at.
   */
  function way(from, to) {
    const x0 = Math.round(from[0]), z0 = Math.round(from[2]), key = (i, j) => (i + 512) * 1024 + (j + 512)
    const h = (i, j) => Math.hypot(to[0] - (x0 + i * GRID), to[1] - (z0 + j * GRID))
    // By place on the grid: how high one stands there, how far it has been to get there, where from.
    const seen = new Map([[key(0, 0), { i: 0, j: 0, y: Math.round(from[1]), g: 0, f: h(0, 0), back: null, shut: false }]])
    const open = [seen.get(key(0, 0))]
    let best = open[0], looked = 0
    // One cell at a time along an edge, with the hands where the feet alone are stopped.
    const edge = (n, di, dj) => {
      let y = n.y, cost = 0
      const steps = di && dj ? Math.round(GRID * 1.414) : GRID
      for (let s = 1; s <= steps; s++) { const x = x0 + (n.i + di * s / steps) * GRID, z = z0 + (n.j + dj * s / steps) * GRID, at = stand(x, y, z); if (!at || pressed(x0 + (n.i + di * (s - 1) / steps) * GRID, z0 + (n.j + dj * (s - 1) / steps) * GRID, x, z, APART + 1)) return null; y = at[0]; cost += at[1] ? 30 : 0 }
      // Up a wall or down a drop costs its height, so that a street is taken while there is one.
      return { y, cost: cost + (di && dj ? GRID * 1.414 : GRID) + Math.abs(y - n.y) }
    }
    // A leap from a place, straight on: the nearest place further that way it can land on (no higher than it jumps), with nothing in the air between.
    const leap = (n, di, dj) => {
      const each = di && dj ? GRID * 1.414 : GRID, most = Math.min(60, Math.floor(span() / each))
      let low = null
      for (let by = 2; by <= most; by++) {
        const x = x0 + (n.i + di * by) * GRID, z = z0 + (n.j + dj * by) * GRID
        let y = null
        for (let up = Math.round(able.jump); up >= -FAR_UP && y === null; up--) { if (!kind(x, n.y + up - 1, z)) continue; if (clear(x, n.y + up, z)) y = n.y + up; else break }
        // (Not where somebody stands.)
        if (y === null || blocked(x, z, mover, y)) continue
        // The air between, at the height of the higher end and a little over.
        const over = Math.max(n.y, y) + 2
        for (let s = 1; s < by * GRID; s++) if (!clear(x0 + (n.i + di * s / GRID) * GRID, over, z0 + (n.j + dj * s / GRID) * GRID)) return low
        const found = { by, y, cost: by * each * 1.2 + Math.abs(y - n.y) }
        // The floor of the gap is a place to land too, but the far side is looked for first.
        if (y < n.y - HANDS) { low ??= found; continue }
        return found
      }
      return low
    }
    while (open.length && looked < LOOKED_MOST) {
      let at = 0
      for (let k = 1; k < open.length; k++) if (open[k].f < open[at].f) at = k
      const n = open.splice(at, 1)[0]
      if (n.shut) continue
      n.shut = true; looked++
      const left = h(n.i, n.j)
      if (left < h(best.i, best.j)) best = n
      if (left <= GRID * 1.5) { best = n; break }
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
        if ((!di && !dj) || Math.abs(n.i + di) > 500 || Math.abs(n.j + dj) > 500) continue
        const k = key(n.i + di, n.j + dj), old = seen.get(k)
        if (old?.shut) continue
        const e = edge(n, di, dj)
        // No step that way, or only a long way down. One that jumps may leap it: over a gap to the next place it can land.
        if (able.jump && (!e || n.y - e.y > HANDS)) leapt: {
          const l = leap(n, di, dj)
          if (!l) break leapt
          const lk = key(n.i + di * l.by, n.j + dj * l.by), was = seen.get(lk), lg = n.g + l.cost
          if (was?.shut || (was && was.g <= lg) || Math.abs(n.i + di * l.by) > 500 || Math.abs(n.j + dj * l.by) > 500) break leapt
          const over = { i: n.i + di * l.by, j: n.j + dj * l.by, y: l.y, g: lg, f: lg + 1.3 * h(n.i + di * l.by, n.j + dj * l.by), back: n, shut: false, leapt: true }
          seen.set(lk, over); open.push(over)
        }
        if (!e) continue
        const g = n.g + e.cost
        if (old && old.g <= g) continue
        // A little greedy (1.3): fewer places looked at for a way a little longer than the shortest.
        const next = { i: n.i + di, j: n.j + dj, y: e.y, g, f: g + 1.3 * h(n.i + di, n.j + dj), back: n, shut: false }
        seen.set(k, next); open.push(next)
      }
    }
    way.spent = looked
    if (h(best.i, best.j) > h(0, 0) - GRID * 2) return null
    const out = []
    // A place that is leapt to says so, and how high it is.
    for (let n = best; n.back; n = n.back) out.unshift(n.leapt ? [x0 + n.i * GRID, z0 + n.j * GRID, n.y] : [x0 + n.i * GRID, z0 + n.j * GRID])
    // The end itself, if the last place has it in a straight line.
    const last = out[out.length - 1], lastY = best.y
    if (Math.hypot(to[0] - last[0], to[1] - last[1]) <= GRID * 1.5 && straight([last[0], lastY, last[1]], to, GRID * 2) !== null) out.push([to[0], to[1]])
    return out
  }
  way.spent = 0
  /** One JS A* search a tick for everyone together; WASM HPA* allows up to WASM_SEARCHES_PER_TICK searches/tick. */
  let searched = -1
  let wasmSearchedTick = -1, wasmSearchesThisTick = 0
  const stats = { ways: 0, none: 0, looked: 0, ms: 0, worst: 0, wasmWays: 0, rvoSteps: 0, rvoAgents: 0, flowActive: false }

  /**
   * Fast Rust WASM multi-layer HPA* pathfinding via `core.nav_find_path` (#164).
   * Returns `[x, z]` waypoints compatible with `step()`, or `null` to fall back to JS `way()`
   * (e.g. when `core` lacks WASM exports, for horizontal jump arcs, high climbs > 64 cells, or partial approach to unreachable goals).
   */
  function wasmWay(from, to, c) {
    const mem = getMemory(c)
    if (!c || !mem || typeof c.nav_find_path !== 'function' || typeof c.nav_path_ptr !== 'function' || typeof c.nav_path_len !== 'function') return null
    if (able.jump || (able.climb ?? 0) > WASM_CLIMB_MAX) return null
    // Rebake any nearby dirty tiles (e.g., fresh crater or player bridge) before querying.
    if (typeof c.nav_rebake_budget === 'function' && (typeof c.nav_dirty_count !== 'function' || c.nav_dirty_count() > 0)) {
      c.nav_rebake_budget((from[0] + to[0]) * 0.5, (from[2] + to[1]) * 0.5, 4)
    }
    const climbCap = able.climb ?? 0
    let flags = NAV_ALLOW_VAULT | NAV_ALLOW_DROP
    if (climbCap > HANDS) flags |= NAV_ALLOW_CLIMB
    const standAt = footing(to[0], from[1], to[1]) ?? stand(to[0], from[1], to[1])?.[0]
    let gy = standAt
    if (gy === null || gy === undefined) {
      const fy = typeof c.feet_at === 'function' ? c.feet_at(Math.round(to[0]), Math.round(to[1])) : from[1]
      // Only use procedural `feet_at` when the live edited world actually has standing room there (not buried inside a built shed/wall).
      if (Number.isFinite(fy) && kind(Math.round(to[0]), Math.round(fy) - 1, Math.round(to[1])) !== 0 && clear(to[0], fy, to[1])) {
        gy = fy
      } else {
        return null
      }
    }
    if (!Number.isFinite(gy)) return null
    const count = c.nav_find_path(from[0], from[1], from[2], to[0], gy, to[1], flags)
    if (!count || count <= 0) return null
    const view = new Float32Array(mem.buffer, c.nav_path_ptr(), count * 4)
    const out = []
    let prevY = from[1]
    for (let i = 0; i < count; i++) {
      const wx = view[i * 4], wy = view[i * 4 + 1], wz = view[i * 4 + 2]
      if (!Number.isFinite(wx) || !Number.isFinite(wy) || !Number.isFinite(wz)) return null
      if (climbCap > HANDS && wy - prevY > climbCap + 1) return null
      if (climbCap <= HANDS && wy - prevY > HANDS + 1) return null
      prevY = wy
      if (i === 0 && count > 1 && Math.hypot(wx - from[0], wz - from[2]) < 3) continue
      out.push([wx, wz])
    }
    if (!out.length) return null
    const end = out[out.length - 1]
    const startDist = Math.hypot(to[0] - from[0], to[1] - from[2])
    const endDist = Math.hypot(to[0] - end[0], to[1] - end[1])
    // Reject degenerate paths that do not make progress toward the goal (avoids stall loops at walls).
    if (endDist > GRID * 2 && endDist > startDist - GRID * 2) return null
    if (Math.hypot(end[0] - from[0], end[1] - from[2]) < 2 && endDist > GRID) return null
    if (endDist <= GRID * 1.5 && endDist > 0.5) {
      out.push([to[0], to[1]])
    }
    return out
  }

  // ── Batched Rust WASM ORCA/RVO2 local crowd avoidance + budgeted nav rebake (#164) ──
  let rvoTick = -1
  const rvoPlan = new Map()
  const rvoVel = new WeakMap()

  function prepareTick(now, tick, dt) {
    if (tick === rvoTick) return
    rvoTick = tick
    rvoPlan.clear()
    const c = getCore()
    if (!c) return

    // Collect active ground movers for budgeted rebake & optional ORCA/RVO2 batch avoidance.
    const movers = []
    for (const p of folk.values()) {
      if (p.gone || p.asleep || p.aloft || p.leap || p.scales || p.falls || p.can?.fly || p.down > now || (p.climbs ?? 0) > now) continue
      if (p.follow) towards(p, now)
      if (!p.goal) continue
      movers.push(p)
    }

    // Small budgeted nav rebake near moving actors every tick so blasts/bridges update live.
    if (movers.length && typeof c.nav_rebake_budget === 'function' && (typeof c.nav_dirty_count !== 'function' || c.nav_dirty_count() > 0)) {
      const focus = movers[Math.abs(tick) % movers.length]
      c.nav_rebake_budget(focus.at[0], focus.at[2], 2)
    }

    const mem = getMemory(c)
    if (movers.length < 2 || !mem || typeof c.crowd_step !== 'function' || typeof c.crowd_agents_ptr !== 'function' || dt <= 0) {
      stats.rvoAgents = 0
      return
    }

    // Only run ORCA batch when at least two active movers are near enough to interact.
    let pairNear = false
    for (let i = 0; i < movers.length && !pairNear; i++) {
      const a = movers[i]
      for (let j = i + 1; j < movers.length; j++) {
        const b = movers[j]
        if (Math.abs(a.at[1] - b.at[1]) < tall && Math.hypot(a.at[0] - b.at[0], a.at[2] - b.at[2]) < 140) {
          pairNear = true
          break
        }
      }
    }
    if (!pairNear) {
      stats.rvoAgents = 0
      return
    }

    // Ensure nav tiles around active movers exist so RVO wall clamping sees static voxel doorways/walls.
    if (typeof c.nav_bake_area === 'function') {
      c.nav_bake_area(movers[0].at[0], movers[0].at[2], 2, 4)
    }
    if (typeof c.crowd_clear_obstacles === 'function') c.crowd_clear_obstacles()

    const cap = typeof c.crowd_capacity === 'function' ? c.crowd_capacity() : 512
    const active = []
    for (const p of movers) {
      if (active.length >= cap) break
      const to = p.path?.length ? p.path[0] : p.goal
      if (p.path?.length && to.length === 3) continue
      // Let standard `pressed()` handle stopping cleanly beside someone standing right on `p.goal`.
      const atGoal = blocked(p.goal[0], p.goal[1], p, p.at[1])
      if (atGoal && Math.hypot(p.goal[0] - p.at[0], p.goal[1] - p.at[2]) < APART + 5) continue
      active.push(p)
    }
    if (active.length < 2) {
      stats.rvoAgents = 0
      return
    }

    const activeSet = new Set(active)
    const statics = []
    for (const o of folk.values()) {
      if (active.length + statics.length >= cap) break
      if (o.gone || o.asleep || activeSet.has(o)) continue
      for (let i = 0; i < active.length; i++) {
        const a = active[i]
        if (Math.abs(o.at[1] - a.at[1]) < tall && Math.hypot(o.at[0] - a.at[0], o.at[2] - a.at[2]) < 100) {
          statics.push(o)
          break
        }
      }
    }

    const total = active.length + statics.length
    const ptr = c.crowd_agents_ptr()
    let soa = new Float32Array(mem.buffer, ptr, cap * 10)
    const radius = APART * 0.51 // 3.06 cells -> min pair separation 6.12 > APART (6.0)
    for (let i = 0; i < active.length; i++) {
      const p = active[i]
      const to = p.path?.length ? p.path[0] : p.goal
      const dx = to[0] - p.at[0], dz = to[1] - p.at[2], far = Math.hypot(dx, dz)
      const spd = p.pace ?? PACE
      const prefSpd = far > 0.5 ? Math.min(spd, far / dt) : 0
      const pvx = far > 0.5 ? (dx / far) * prefSpd : 0
      const pvz = far > 0.5 ? (dz / far) * prefSpd : 0
      const prev = rvoVel.get(p)
      const vx = prev && tick - prev.tick <= 2 ? prev.vx : pvx
      const vz = prev && tick - prev.tick <= 2 ? prev.vz : pvz
      const flags = p.can?.climb || p.can?.jump ? CROWD_FLAG_IGNORE_WORLD : 0
      soa[FIELD_POS_X * cap + i] = p.at[0]
      soa[FIELD_POS_Z * cap + i] = p.at[2]
      soa[FIELD_POS_Y * cap + i] = p.at[1]
      soa[FIELD_VEL_X * cap + i] = vx
      soa[FIELD_VEL_Z * cap + i] = vz
      soa[FIELD_PREF_VX * cap + i] = pvx
      soa[FIELD_PREF_VZ * cap + i] = pvz
      soa[FIELD_RADIUS * cap + i] = radius
      soa[FIELD_MAX_SPEED * cap + i] = spd
      soa[FIELD_FLAGS * cap + i] = flags
    }
    for (let k = 0; k < statics.length; k++) {
      const i = active.length + k, o = statics[k]
      soa[FIELD_POS_X * cap + i] = o.at[0]
      soa[FIELD_POS_Z * cap + i] = o.at[2]
      soa[FIELD_POS_Y * cap + i] = o.at[1]
      soa[FIELD_VEL_X * cap + i] = 0
      soa[FIELD_VEL_Z * cap + i] = 0
      soa[FIELD_PREF_VX * cap + i] = 0
      soa[FIELD_PREF_VZ * cap + i] = 0
      soa[FIELD_RADIUS * cap + i] = radius
      soa[FIELD_MAX_SPEED * cap + i] = 0
      soa[FIELD_FLAGS * cap + i] = CROWD_FLAG_STATIC
    }

    c.crowd_step(total, dt, 1.8)
    soa = new Float32Array(mem.buffer, c.crowd_agents_ptr(), cap * 10)
    for (let i = 0; i < active.length; i++) {
      const p = active[i]
      const nx = soa[FIELD_POS_X * cap + i], nz = soa[FIELD_POS_Z * cap + i]
      const vx = soa[FIELD_VEL_X * cap + i], vz = soa[FIELD_VEL_Z * cap + i]
      if (Number.isFinite(nx) && Number.isFinite(nz) && Number.isFinite(vx) && Number.isFinite(vz)) {
        rvoPlan.set(p, { x: nx, z: nz, vx, vz })
        rvoVel.set(p, { vx, vz, tick })
      }
    }
    stats.rvoSteps++
    stats.rvoAgents = active.length
  }

  // ── Panic flow-field helper using Rust WASM `nav_flow_*` (#164) ──
  function setThreats(threats) {
    const c = getCore()
    if (!c || typeof c.nav_flow_clear !== 'function' || typeof c.nav_flow_add_threat !== 'function' || typeof c.nav_flow_build !== 'function') {
      stats.flowActive = false
      return 0
    }
    c.nav_flow_clear()
    const list = Array.isArray(threats) ? threats : []
    if (!list.length) {
      stats.flowActive = false
      return 0
    }
    for (const th of list) {
      if (Array.isArray(th) && th.length >= 4) c.nav_flow_add_threat(th[0], th[1], th[2], th[3])
      else if (th && Array.isArray(th.at) && Number.isFinite(th.radius)) c.nav_flow_add_threat(th.at[0], th.at[1], th.at[2], th.radius)
    }
    const spans = c.nav_flow_build()
    stats.flowActive = spans > 0
    return spans
  }

  function fleeVector(x, y, z) {
    const c = getCore(), mem = getMemory(c)
    if (!c || !mem || typeof c.nav_flow_sample !== 'function' || typeof c.nav_flow_vec_ptr !== 'function') return null
    if (c.nav_flow_sample(x, y, z) !== 1) return null
    const v = new Float32Array(mem.buffer, c.nav_flow_vec_ptr(), 2)
    if (!Number.isFinite(v[0]) || !Number.isFinite(v[1])) return null
    return [v[0], v[1]]
  }

  /** A body that follows someone, or keeps away from them, is given where to go this tick. */
  function towards(p, now) {
    const f = p.follow, them = folk.get(f.by)
    if (!them) { p.follow = undefined; p.goal = null; p.path = undefined; p.stopped = 'whoever it followed is gone'; return }
    // One that flies follows through the air: how far off they are is measured with the height.
    const flies = !!p.can?.fly, dx = them.at[0] - p.at[0], dy = flies ? them.at[1] - p.at[1] : 0, dz = them.at[2] - p.at[2], far = Math.hypot(dx, dy, dz) || 1
    let goal = null
    // Following: up to `keep` cells of them, and no nearer. Keeping away: off along the line from them until `keep` cells lie between.
    // (Never nearer than two bodies can stand.)
    const keep = Math.max(f.keep, APART + 2)
    if (!f.flee && far > keep + 3) goal = [them.at[0] - dx / far * keep, them.at[2] - dz / far * keep]
    else if (f.flee && far < f.keep) goal = [p.at[0] - dx / far * (f.keep - far + 20), p.at[2] - dz / far * (f.keep - far + 20)]
    if (!goal) { if (p.goal) { p.goal = null; p.path = undefined } if (!f.flee) p.yaw = Math.atan2(dx, -dz); return }
    // The way it was on is good while they have not gone far from where it led.
    if (p.path && p.pathTo && Math.hypot(goal[0] - p.pathTo[0], goal[1] - p.pathTo[1]) > 16 && now - (p.pathAt ?? 0) > AGAIN_AFTER) p.path = undefined
    p.goal = goal; p.goalY = flies && !f.flee ? them.at[1] - dy / far * keep : undefined; p.stopped = ''
  }

  /**
   * A tenth of a second of a body's going: along its way if it has one, else straight; stopped, it looks for a way
   * round. Says whether it moved or changed (so that everyone is told).
   */
  function step(p, now, tick) {
    if (p.follow) towards(p, now)
    if (p.down > now || (p.climbs ?? 0) > now) return false
    mind(p)
    const dt = 0.1 * (rate?.() ?? 1)
    prepareTick(now, tick, dt)
    // In the air: a leap is an arc from where it left to where it lands.
    if (p.leap) {
      const l = p.leap, t = Math.min(1, (l.t += dt) / l.long)
      p.at = [l.from[0] + (l.to[0] - l.from[0]) * t, l.from[1] + (l.to[1] - l.from[1]) * t + 4 * l.high * t * (1 - t), l.from[2] + (l.to[2] - l.from[2]) * t]
      if (t >= 1) { p.at = [...l.to]; p.leap = undefined; p.aloft = false }
      return true
    }
    // Up a wall's face, by its own up: its feet on the wall, its head out from it.
    if (p.scales) {
      const c = p.scales
      p.at = [p.at[0], Math.min(c.y, p.at[1] + going * dt), p.at[2]]
      if (p.at[1] >= c.y) { p.at = [c.x, c.y, c.z]; p.scales = undefined; p.frame = undefined }
      return true
    }
    // Stepped off a height: it falls, as slowly as `fall` says.
    if (p.falls) {
      const f = p.falls
      f.speed += PULL * Math.max(0.05, able.fall ?? 1) * dt
      p.at = [p.at[0], Math.max(f.y, p.at[1] - f.speed * dt), p.at[2]]
      if (p.at[1] <= f.y) { p.falls = undefined; p.aloft = false }
      return true
    }
    if (able.fly) return flight(p, dt)
    // One that flew and no longer does, with nothing under it, comes down.
    if (p.aloft) { p.frame = undefined; let y = Math.round(p.at[1]); while (y > p.at[1] - FAR_UP && !kind(Math.round(p.at[0]), y - 1, Math.round(p.at[2]))) y--; p.falls = { y, speed: 0 }; return true }
    if (!p.goal) return false
    gather(p, 90 + (p.pace ?? PACE))

    // Rust WASM ORCA/RVO2 local crowd-avoidance step when 2+ actors are moving nearby (#164).
    const plan = rvoPlan.get(p)
    if (plan) {
      rvoPlan.delete(p)
      if (p.path?.length > 1 && p.path[0].length < 3 && p.path[1].length < 3) {
        if (straight(p.at, p.path[1], 48) !== null || Math.hypot(p.path[0][0] - p.at[0], p.path[0][1] - p.at[2]) < GRID) p.path.shift()
      }
      const to0 = p.path?.length ? p.path[0] : p.goal
      const dx0 = to0[0] - p.at[0], dz0 = to0[1] - p.at[2], far0 = Math.hypot(dx0, dz0)
      if (far0 < (p.path?.length > 1 ? GRID : 1.0)) {
        if (!p.path?.length) { p.goal = null; p.rvoYield = 0; return true }
        p.path.shift()
        if (!p.path.length) {
          p.path = undefined
          if (p.short_of) { p.stopped = p.short_of; p.short_of = undefined; p.goal = null; p.rvoYield = 0; return true }
        }
      }
      const probeDist = Math.min(far0, Math.max(1.5, (p.pace ?? PACE) * dt))
      const staticBlocked = !p.path && far0 > 1 && footing(p.at[0] + (dx0 / far0) * probeDist, p.at[1], p.at[2] + (dz0 / far0) * probeDist) === null
      if (!staticBlocked && !(p.path?.length && p.path[0].length === 3)) {
        const rvoWho = crowd.length ? pressed(p.at[0], p.at[2], plan.x, plan.z, APART - 0.25) : null
        const rvoFeet = p.path || rvoWho ? null : footing(plan.x, p.at[1], plan.z)
        const rvoAt = rvoWho ? null : p.path ? stand(plan.x, p.at[1], plan.z) : rvoFeet === null || (able.jump && p.at[1] - rvoFeet > HANDS) ? null : [rvoFeet, false]
        if (rvoAt && rvoAt[0] - p.at[1] <= HANDS && p.at[1] - rvoAt[0] <= 30 && !rvoAt[1]) {
          const moved = Math.hypot(plan.x - p.at[0], plan.z - p.at[2])
          const spd = Math.hypot(plan.vx, plan.vz)
          if (moved > 0.05 || spd > 0.5) {
            p.rvoYield = 0
            p.pressed = 0
            if (spd > 0.5) p.yaw = Math.atan2(plan.vx, -plan.vz)
            p.at = [plan.x, rvoAt[0], plan.z]
            if (p.path?.length && p.path[0].length < 3 && Math.hypot(p.path[0][0] - p.at[0], p.path[0][1] - p.at[2]) < (p.path.length > 1 ? GRID : 1.5)) {
              p.path.shift()
              if (!p.path.length) {
                p.path = undefined
                if (p.short_of) { p.stopped = p.short_of; p.short_of = undefined; p.goal = null }
              }
            } else if (!p.path?.length && Math.hypot(p.goal[0] - p.at[0], p.goal[1] - p.at[2]) < 1.2) {
              p.goal = null
            }
            return true
          }
          if ((p.rvoYield = (p.rvoYield ?? 0) + 1) <= 30) {
            p.pressed = 0
            return true
          }
          p.rvoYield = 0
        }
      }
    }

    // By the world's clock, which a rule may slow or quicken (rules/bodies.mjs).
    for (let left = (p.pace ?? PACE) / 10 * (rate?.() ?? 1); left > 0 && p.goal;) {
      // A way's next place is cut out when the one after can be walked to straight: the body does not zigzag a grid.
      if (p.path?.length > 1 && p.path[0].length < 3 && p.path[1].length < 3 && (straight(p.at, p.path[1], 48) !== null || Math.hypot(p.path[0][0] - p.at[0], p.path[0][1] - p.at[2]) < GRID)) p.path.shift()
      const to = p.path?.length ? p.path[0] : p.goal
      const dx = to[0] - p.at[0], dz = to[1] - p.at[2], far = Math.hypot(dx, dz), stride = Math.min(far, left, PACE / 10)
      left -= stride
      if (far < 0.5) {
        if (!p.path?.length) { p.goal = null; break }
        p.path.shift()
        if (p.path.length) continue
        // The end of a way: there, or as near as could be got (and it says what kept it from the rest), or straight on for what is left.
        p.path = undefined
        if (p.short_of) { p.stopped = p.short_of; p.short_of = undefined; p.goal = null; break }
        continue
      }
      // The next place of its way is leapt to: off it goes, for as long as its pace takes to cross.
      if (p.path?.length && to.length === 3) {
        const rise = to[2] - p.at[1], long = Math.max(0.3, far / going)
        p.leap = { from: [...p.at], to: [to[0], to[2], to[1]], t: 0, long, high: Math.max(3, Math.min(able.jump ?? 7, far / 3), rise > 0 ? rise * 0.4 + 2 : 0) }
        p.yaw = Math.atan2(dx, -dz); p.aloft = true; p.pressed = 0
        p.move = { n: (p.move?.n ?? 0) + 1, since: now, name: 'jump', long: Math.max(0.6, long), stays: false }
        p.path.shift(); if (!p.path.length) { p.path = undefined; if (Math.hypot(p.goal[0] - to[0], p.goal[1] - to[1]) < GRID * 1.5) p.goal = null }
        break
      }
      const x = p.at[0] + dx / far * stride, z = p.at[2] + dz / far * stride
      // On a way it may use its hands; walking straight it does not, and looks for a way when its feet are stopped.
      const who = crowd.length ? pressed(p.at[0], p.at[2], x, z) : null
      const feet = p.path || who ? null : footing(x, p.at[1], z)
      // (One that jumps does not just walk off a long step down: it looks for a way, which may be a leap.)
      const at = who ? null : p.path ? stand(x, p.at[1], z) : feet === null || (able.jump && p.at[1] - feet > HANDS) ? null : [feet, false]
      // Someone stands where it was going: it stops short of them, and says who.
      if (who && Math.hypot(p.goal[0] - who.at[0], p.goal[1] - who.at[2]) < APART + 2) { p.stopped = `${who.name || 'someone'} is standing where you were going: stopped beside them`; p.goal = null; p.path = undefined; break }
      if (at) {
        p.yaw = Math.atan2(dx, -dz); p.pressed = 0
        // A wall higher than hands reach: up its face, a pace at a time, turned so that the wall is its floor.
        if (at[0] - p.at[1] > HANDS) { p.scales = { x, y: at[0], z }; p.frame = lean(p.yaw, -Math.PI / 2); break }
        // A drop deeper than a step down: off the edge, and it falls.
        if (p.at[1] - at[0] > 30) { p.at = [x, p.at[1], z]; p.falls = { y: at[0], speed: 0 }; p.aloft = true; break }
        p.at = [x, at[0], z]
        // Up onto something with the hands: a moment's climb, and it looks like one.
        if (at[1]) { p.climbs = now + CLIMB_MS; p.move = { n: (p.move?.n ?? 0) + 1, since: now, name: 'climb', long: 0.7, stays: false }; break }
        continue
      }
      // Stopped. Try fast Rust WASM HPA* first (up to WASM_SEARCHES_PER_TICK/tick), then fall back to JS A* (1/tick).
      const goal = p.goal
      // Kept standing by someone for two seconds, way or no way: it says so and stops, and does not look for ever.
      if (who && (p.pressed = (p.pressed ?? 0) + 1) > 20) { p.pressed = 0; p.stopped = `${who.name || 'someone'} in the way, ${Math.round(Math.hypot(goal[0] - p.at[0], goal[1] - p.at[2]))} cells short of where you were going`; p.goal = null; p.path = undefined; break }
      if (p.noWay && now < p.noWay.until && Math.hypot(goal[0] - p.noWay.to[0], goal[1] - p.noWay.to[1]) < 12) { p.stopped = p.noWay.why; p.goal = null; p.path = undefined; break }
      const c = getCore()
      const useWasm = !who && c && typeof c.nav_find_path === 'function' && typeof c.nav_path_ptr === 'function' && getMemory(c) && !able.jump && (able.climb ?? 0) <= WASM_CLIMB_MAX
      if (useWasm) {
        if (wasmSearchedTick !== tick) { wasmSearchedTick = tick; wasmSearchesThisTick = 0 }
        if (wasmSearchesThisTick < WASM_SEARCHES_PER_TICK) {
          wasmSearchesThisTick++
          const began = performance.now(), wFound = wasmWay(p.at, goal, c), took = performance.now() - began
          stats.ms += took; stats.worst = Math.max(stats.worst, took)
          if (wFound) {
            stats.ways++; stats.wasmWays++
            p.path = wFound; p.pathTo = goal; p.pathAt = now
            const end = wFound[wFound.length - 1], short = Math.hypot(goal[0] - end[0], goal[1] - end[1])
            p.short_of = short > GRID * 1.5 ? `${say(x, p.at[1], z)}, and no way round was found: ${Math.round(short)} cells short of where it was going` : undefined
            break
          }
        } else {
          break
        }
      }
      if (searched === tick) break
      searched = tick
      const began = performance.now(), found = way(p.at, goal), took = performance.now() - began
      stats.looked += way.spent; stats.ms += took; stats.worst = Math.max(stats.worst, took)
      if (found) {
        stats.ways++
        p.path = found; p.pathTo = goal; p.pathAt = now
        const end = found[found.length - 1], short = Math.hypot(goal[0] - end[0], goal[1] - end[1])
        // As near as it can get, if it cannot get there: it walks that far and says what kept it from the rest.
        p.short_of = short > GRID * 1.5 ? `${who ? `${who.name || 'someone'} in the way` : say(x, p.at[1], z)}, and no way round was found: ${Math.round(short)} cells short of where it was going` : undefined
      } else {
        stats.none++
        const why = `${who ? `${who.name || 'someone'} in the way` : say(x, p.at[1], z)}, ${Math.round(Math.hypot(goal[0] - p.at[0], goal[1] - p.at[2]))} cells short of where you were going`
        p.noWay = { to: goal, until: now + NO_WAY_FOR, why }
        p.stopped = why; p.goal = null; p.path = undefined
      }
      break
    }
    return true
  }

  /** A turn (x, y, z, w) that leans a body forward by so much, the way it faces. */
  const lean = (yaw, by) => [-Math.cos(yaw) * Math.sin(by / 2), 0, -Math.sin(yaw) * Math.sin(by / 2), Math.cos(by / 2)]
  /**
   * A tenth of a second of flying: straight through the air to where it is going (a place with a height, or over
   * a place on the ground and then down onto it); over what is in the way, by rising. Still, it stays where it is.
   */
  function flight(p, dt) {
    const under = () => kind(Math.round(p.at[0]), Math.round(p.at[1]) - 1, Math.round(p.at[2])) !== 0
    p.aloft = !under()
    if (!p.goal) { if (p.frame) { p.frame = undefined; return true } return false }
    gather(p, 90 + able.fly)
    let moved = false
    for (let left = able.fly * dt; left > 0;) {
      const dx = p.goal[0] - p.at[0], dz = p.goal[1] - p.at[2], flat = Math.hypot(dx, dz), stride = Math.min(left, 1)
      left -= stride
      // Over a place on the ground: down onto it.
      if (p.goalY === undefined && flat < 0.7) {
        if (under()) { p.goal = null; p.aloft = false; break }
        // Somebody stands under it: it does not come down into them. It stays over them, and says who.
        const on = blocked(p.at[0], p.at[2], p, p.at[1] - stride)
        if (on) { p.stopped = `${on.name || 'someone'} is standing where you were going: stopped over them`; p.goal = null; break }
        p.at = [p.at[0], p.at[1] - stride, p.at[2]]; moved = true; continue
      }
      const dy = p.goalY === undefined ? 0 : p.goalY - p.at[1], far = Math.hypot(dx, dy, dz)
      if (far < 0.7) { p.goal = null; break }
      const step = Math.min(stride, far), next = [p.at[0] + dx / far * step, p.at[1] + dy / far * step, p.at[2] + dz / far * step]
      const level = flat > 0.01 ? [p.at[0] + dx / flat * step, p.at[1], p.at[2] + dz / flat * step] : null
      const who = pressed(p.at[0], p.at[2], next[0], next[2])
      if (who && Math.hypot(p.goal[0] - who.at[0], p.goal[1] - who.at[2]) < APART + 2) { p.stopped = `${who.name || 'someone'} is where you were going: stopped beside them`; p.goal = null; break }
      // Straight; or level, when straight is into what is below; or up, over what is in the way.
      const to = !who && clear(...next) ? next : !who && level && clear(...level) ? level : clear(p.at[0], p.at[1] + step, p.at[2]) ? [p.at[0], p.at[1] + step, p.at[2]] : null
      if (!to) { p.stopped = `${say(next[0], next[1], next[2])}, and no way over it: ${Math.round(far)} cells short of where you were going`; p.goal = null; break }
      if (flat > 0.01) p.yaw = Math.atan2(dx, -dz)
      p.at = to; moved = true
    }
    p.aloft = !under()
    // Going along, it leans into the way it goes; hanging in the air or landed, it is upright.
    p.frame = p.goal && p.aloft && Math.hypot(p.goal[0] - p.at[0], p.goal[1] - p.at[2]) > 6 ? lean(p.yaw, 1.15) : undefined
    return moved || !p.goal
  }

  // ── Near ──
  /** By rule: the places it marked. And who is inside what, so that coming in and going out are each said once. */
  const marks = new Map(), inside = new Set()
  /** A rule marks a place, or takes a mark away: `world.mark(id, {at: [x, z], within})`, `world.mark(id, {at: null})`. */
  function mark(rule, w, _now, wrong) {
    if (typeof w.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,23}$/.test(w.id)) return wrong('a marked place has a name of its rule\'s own: lower-case letters, digits and dashes, up to 24')
    const mine = marks.get(rule.id) ?? new Map()
    if (w.at === null) { mine.delete(w.id); return }
    if (!Array.isArray(w.at) || w.at.length < 2 || w.at.length > 3 || !w.at.every((v) => Number.isFinite(v) && Math.abs(v) < 2 ** 30) || !Number.isFinite(w.within) || w.within <= 0) return wrong('a marked place is at: [x, z] and within: cells (or at: null to take it away)')
    if (!mine.has(w.id) && mine.size >= MARKS_MOST) return wrong(`a rule may mark ${MARKS_MOST} places`)
    mine.set(w.id, { at: [w.at[0], w.at[w.at.length - 1]], within: Math.min(MARK_WITHIN_MOST, w.within) })
    marks.set(rule.id, mine)
  }
  /** Who has come within an actor's reach or into a marked place since last asked, and who has gone: each rule is told (`near`). */
  function nearness() {
    const now = new Set()
    const people = [...folk.values()].filter((p) => !p.rule)
    const test = (rule, what, id, x, z, within) => {
      for (const who of people) {
        const far = Math.hypot(who.at[0] - x, who.at[2] - z), k = `${rule}|${what}|${id}|${who.by}`, was = inside.has(k)
        // A little further to go out than to come in, or someone on the edge is told of ten times a second.
        if (far <= (was ? within * 1.15 + 3 : within)) { now.add(k); if (!was) hear(rule, 'near', { who: who.by, name: who.name, [what]: id, far: Math.round(far), at: who.at.map(Math.round) }) }
        else if (was) hear(rule, 'near', { who: who.by, name: who.name, [what]: id, far: Math.round(far), at: who.at.map(Math.round), left: true })
      }
    }
    for (const p of folk.values()) if (p.rule && p.rule !== '~' && p.reach) test(p.rule, 'actor', p.short, p.at[0], p.at[2], p.reach)
    for (const [rule, mine] of marks) for (const [id, m] of mine) test(rule, 'place', id, m.at[0], m.at[1], m.within)
    // Whoever was inside something that is no more (a body gone, a mark taken away, a person who left) is not told of: they are just forgotten.
    inside.clear()
    for (const k of now) inside.add(k)
  }
  /** A rule's marked places, to be kept over a restart; and put back as they were kept (read as anything from outside is). */
  const kept = (id) => { const mine = marks.get(id); return mine?.size ? Object.fromEntries(mine) : undefined }
  const back = (id, from) => {
    if (!from || typeof from !== 'object') return
    const mine = new Map()
    for (const [name, m] of Object.entries(from).slice(0, MARKS_MOST)) if (/^[a-z0-9][a-z0-9-]{0,23}$/.test(name) && Array.isArray(m?.at) && m.at.length === 2 && m.at.every((v) => Number.isFinite(v) && Math.abs(v) < 2 ** 30) && Number.isFinite(m.within) && m.within > 0) mine.set(name, { at: [m.at[0], m.at[1]], within: Math.min(MARK_WITHIN_MOST, m.within) })
    if (mine.size) marks.set(id, mine)
  }
  return { blocked, room, step, mark, nearness, dropped: (id) => { marks.delete(id) }, stats, way, kept, back, setThreats, fleeVector }
}
