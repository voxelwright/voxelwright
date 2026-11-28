// Wave 3B Crowd & Navigation Runtime Wiring Verification (#164).
// Proves with the real Rust WASM `core.wasm`:
//   1. `about.mjs` multi-actor pathfinding around a freshly blasted crater & over a newly placed
//      voxel bridge simultaneously (no 1-search/tick stall), plus `setThreats`/`fleeVector` panic
//      flow-field routing and 100% JS fallback compatibility when `core` lacks WASM exports.
//   2. `about.mjs` bidirectional narrow-doorway crossing (8 opposing actors through a 2.0 m doorway)
//      via batched WASM ORCA/RVO2 with 0 deadlocks and 0 overlaps.
//   3. `street.ts` dense Ring 1/2 SF pedestrians running batched WASM ORCA/RVO2 mutual avoidance
//      (including player obstacle avoidance) with 0 overlaps, 0 teleports, and < 1.0 ms step time.
//   4. `street.ts` blast shock triggering WASM panic flow-field fleeing + divergent
//      `{ flee, shelter, film, glance }` roles.
//   5. `street.ts` geometric rain-awning shelter seeking when `rain > 0.3` and smooth recovery
//      when rain clears.
//
//   node engine/test/crowd-wiring.mjs
import { readFile } from 'node:fs/promises'
import { about, APART } from '../about.mjs'
import { street } from '../page/street.ts'

const failures = []
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`)
  if (!ok) failures.push(what)
}

const wasmPath = new URL('../page/core.wasm', import.meta.url)
const wasmBytes = await readFile(wasmPath)
async function freshCore() {
  const { instance } = await WebAssembly.instantiate(wasmBytes, {})
  return instance.exports
}

const WOOD = 10
const BRICK = 8
const TALL = 18
const CLIMB = 2
const DROP = 30

function applyRuns(core, runs) {
  const words = [1, runs.length]
  for (const r of runs) words.push(r[0], r[1], r[2], r[3], r[4])
  const ptr = core.edits_room(words.length)
  new Int32Array(core.memory.buffer, ptr, words.length).set(words)
  core.world_edit(-1)
}

function makeFooting(core) {
  const solid = (x, y, z) => core.world_kind(x, y, z) !== 0
  return (x, y, z) => {
    x = Math.round(x); y = Math.round(y); z = Math.round(z)
    for (let up = 0; up <= CLIMB; up++) {
      let feet = y + up, room = true
      for (let k = 0; k < TALL && room; k++) room = !solid(x, feet + k, z)
      if (!room) continue
      let fell = 0
      while (!solid(x, feet - 1, z) && fell <= DROP) { feet--; fell++ }
      return fell > DROP ? null : feet
    }
    return null
  }
}

// ── 1. `about.mjs` WASM Multi-Actor Crater Detour, Bridge Crossing, Flow Field & JS Fallback ──
console.log('1. about.mjs WASM navmesh (crater detour, voxel bridge, flow field & JS fallback)')
{
  const core = await freshCore()
  const bx = 700, bz = 4070
  const craterY = core.ground_at(bx, bz)
  core.nav_bake_area(bx, bz, 3, 64)

  // Carve a deep steep crater right in the middle of the street at (700, craterY, 4070).
  const craterRuns = []
  for (let y = craterY - 40; y <= craterY + 4; y++) {
    for (let z = bz - 16; z <= bz + 16; z++) {
      craterRuns.push([bx - 16, bx + 17, y, z, 0])
    }
  }
  applyRuns(core, craterRuns)
  check(core.nav_dirty_count() >= 9, `crater edit dirtied ${core.nav_dirty_count()} nav tiles`)

  const folk = new Map()
  const footing = makeFooting(core)
  const getting = about({
    folk,
    footing,
    kind: (x, y, z) => core.world_kind(x, y, z),
    tall: TALL,
    pace: 20,
    say: () => 'crater in the way',
    hear: () => {},
    core,
  })

  // Spawn 6 actors on the West rim, all tasked simultaneously to cross to the East rim.
  const actors = []
  for (let i = 0; i < 6; i++) {
    const sx = bx - 46 - (i % 2) * 8
    const sz = bz - 15 + i * 6
    const sy = core.feet_at(sx, sz)
    const p = {
      by: `a${i}`,
      name: `Actor ${i}`,
      at: [sx, sy, sz],
      yaw: 0,
      pace: 22,
      goal: [bx + 46 + (i % 2) * 8, sz],
      stopped: '',
      down: 0,
    }
    folk.set(p.by, p)
    actors.push(p)
  }

  // First, verify multiple WASM searches execute without a 1-search/tick stall as actors meet the crater.
  let maxWasmPathsSingleTick = 0
  let droppedIntoCrater = false
  let now = 10_000
  for (let tick = 1; tick <= 140; tick++) {
    now += 100
    const beforeWasm = getting.stats.wasmWays
    for (const p of actors) getting.step(p, now, tick)
    maxWasmPathsSingleTick = Math.max(maxWasmPathsSingleTick, getting.stats.wasmWays - beforeWasm)
    for (const p of actors) {
      if (p.at[1] < craterY - 12) droppedIntoCrater = true
    }
    if (actors.every((p) => !p.goal)) break
  }
  const arrivedCrater = actors.filter((p) => !p.goal && Math.hypot(p.at[0] - (bx + 46), p.at[2] - p.at[2]) < 16 && p.at[0] > bx + 32).length
  check(
    getting.stats.wasmWays >= 4 && maxWasmPathsSingleTick >= 2,
    `WASM nav_find_path served multiple actors simultaneously (total wasmWays=${getting.stats.wasmWays}, max/tick=${maxWasmPathsSingleTick}, dirty remaining=${core.nav_dirty_count()})`,
  )
  check(
    arrivedCrater === actors.length && !droppedIntoCrater,
    `all ${arrivedCrater}/${actors.length} actors detoured cleanly around blasted crater with 0 falls`,
  )

  // Now build a player voxel bridge directly over the crater and send 4 actors straight back across it.
  const bridgeRuns = []
  for (let z = bz - 7; z <= bz + 7; z++) {
    bridgeRuns.push([bx - 20, bx + 21, craterY, z, WOOD])
  }
  applyRuns(core, bridgeRuns)
  check(core.nav_dirty_count() > 0, `voxel bridge edit dirtied ${core.nav_dirty_count()} nav tiles`)

  const bridgeActors = actors.slice(0, 4)
  for (let i = 0; i < bridgeActors.length; i++) {
    const p = bridgeActors[i]
    const row = Math.floor(i / 2), col = i % 2
    const sx = bx + 38 + row * 12
    const sz = bz - 3 + col * 6
    p.at = [sx, core.feet_at(sx, sz), sz]
    p.goal = [bx - 42 - row * 12, sz]
    p.path = undefined
    p.stopped = ''
    p.noWay = undefined
  }
  let crossedBridge = 0
  let maxBridgeZDev = 0
  for (let tick = 150; tick <= 260; tick++) {
    now += 100
    for (const p of bridgeActors) {
      getting.step(p, now, tick)
      if (Math.abs(p.at[0] - bx) < 12) maxBridgeZDev = Math.max(maxBridgeZDev, Math.abs(p.at[2] - bz))
    }
    if (bridgeActors.every((p) => !p.goal)) break
  }
  crossedBridge = bridgeActors.filter((p) => !p.goal && p.at[0] < bx - 30).length
  check(
    crossedBridge === bridgeActors.length && maxBridgeZDev <= 14,
    `all ${crossedBridge}/${bridgeActors.length} actors crossed straight over newly placed voxel bridge (max |z-bz|=${maxBridgeZDev.toFixed(1)})`,
  )

  // Panic flow-field helper (`setThreats` + `fleeVector`) around a solid wall.
  const fy0 = core.feet_at(bx, bz)
  const wallRuns = []
  for (let y = fy0; y < fy0 + 28; y++) {
    for (let z = bz - 36; z <= bz + 36; z++) wallRuns.push([bx + 20, bx + 26, y, z, BRICK])
  }
  applyRuns(core, wallRuns)
  core.nav_rebake_budget(bx, bz, 32)
  const spans = getting.setThreats([{ at: [bx, fy0, bz], radius: 180 }])
  const fv = getting.fleeVector(bx + 12, fy0, bz + 10)
  check(
    spans > 100 && Array.isArray(fv) && Math.abs(Math.hypot(fv[0], fv[1]) - 1) < 1e-2 && getting.stats.flowActive,
    `about.mjs setThreats/fleeVector returned unit escape vector (${fv ? fv.map((n) => n.toFixed(2)).join(', ') : 'null'}) over ${spans} spans`,
  )

  // Fallback compatibility when `core` is omitted or lacks WASM exports.
  const stubFolk = new Map()
  const stubWallX = 12
  const stubKind = (x, y, z) => {
    if (y < 0) return 7
    if (Math.round(x) === stubWallX && y >= 0 && y < 24 && Math.abs(z) <= 8) return 8
    return 0
  }
  const stubFooting = (x, y, z) => (stubKind(Math.round(x), 0, Math.round(z)) ? null : 0)
  const stubGetting = about({
    folk: stubFolk,
    footing: stubFooting,
    kind: stubKind,
    tall: TALL,
    pace: 20,
    say: () => 'wall in the way',
    hear: () => {},
    core: {}, // stub core with NO WASM exports
  })
  const sp = { by: 'stub', name: 'Stub', at: [0, 0, 0], yaw: 0, pace: 20, goal: [24, 0], stopped: '', down: 0 }
  stubFolk.set('stub', sp)
  for (let tick = 1; tick <= 80 && sp.goal; tick++) stubGetting.step(sp, tick * 100, tick)
  check(
    !sp.goal && Math.hypot(sp.at[0] - 24, sp.at[2]) < 2 && stubGetting.stats.wasmWays === 0 && stubGetting.stats.ways >= 1,
    `stub core without WASM exports cleanly falls back to JS A* (arrived at [${sp.at.map((v) => Math.round(v)).join(', ')}])`,
  )
}

// ── 2. `about.mjs` Bidirectional Narrow-Doorway Crossing via WASM ORCA/RVO2 ──
console.log('2. about.mjs bidirectional narrow-doorway crossing via WASM RVO2')
{
  const core = await freshCore()
  const bx = 700, bz = 4070
  const fy = core.feet_at(bx, bz)
  core.nav_bake_area(bx, bz, 3, 64)

  // Build a solid brick wall at x = 700..703 with a 2.0 m (20-cell) doorway at z in [bz-10, bz+10].
  const doorRuns = []
  for (let y = fy; y < fy + 30; y++) {
    for (let z = bz - 70; z < bz - 10; z++) doorRuns.push([bx, bx + 3, y, z, BRICK])
    for (let z = bz + 11; z <= bz + 70; z++) doorRuns.push([bx, bx + 3, y, z, BRICK])
  }
  applyRuns(core, doorRuns)
  core.nav_rebake_budget(bx, bz, 64)

  const folk = new Map()
  const footing = makeFooting(core)
  const getting = about({
    folk,
    footing,
    kind: (x, y, z) => core.world_kind(x, y, z),
    tall: TALL,
    pace: 20,
    say: () => 'brick in the way',
    hear: () => {},
    core,
  })

  // 4 West actors heading East vs 4 East actors heading West through the 2.0 m doorway.
  const actors = []
  for (let i = 0; i < 4; i++) {
    const row = Math.floor(i / 2), col = i % 2
    const wx = bx - 22 - row * 10, wz = bz - 4 + col * 8
    const w = { by: `w${i}`, name: `West ${i}`, at: [wx, core.feet_at(wx, wz), wz], yaw: 0, pace: 20, goal: [bx + 36 + row * 10, wz], stopped: '', down: 0 }
    folk.set(w.by, w); actors.push(w)

    const ex = bx + 24 + row * 10, ez = bz + 4 - col * 8
    const e = { by: `e${i}`, name: `East ${i}`, at: [ex, core.feet_at(ex, ez), ez], yaw: 0, pace: 20, goal: [bx - 36 - row * 10, ez], stopped: '', down: 0 }
    folk.set(e.by, e); actors.push(e)
  }

  let minPairDist = Infinity
  let now = 20_000
  for (let tick = 1; tick <= 160; tick++) {
    now += 100
    for (const p of actors) getting.step(p, now, tick)
    for (let i = 0; i < actors.length; i++) {
      for (let j = i + 1; j < actors.length; j++) {
        const d = Math.hypot(actors[i].at[0] - actors[j].at[0], actors[i].at[2] - actors[j].at[2])
        if (d < minPairDist) minPairDist = d
      }
    }
    if (actors.every((p) => !p.goal)) break
  }
  const crossed = actors.filter((p) => (p.by.startsWith('w') ? p.at[0] > bx + 16 : p.at[0] < bx - 16)).length
  const stuckStopped = actors.filter((p) => p.stopped && /in the way/.test(p.stopped)).length
  check(
    getting.stats.rvoSteps > 5 && crossed === actors.length && stuckStopped === 0 && minPairDist >= APART - 0.5,
    `all ${crossed}/${actors.length} opposing doorway actors crossed via WASM RVO2 (${getting.stats.rvoSteps} steps, 0 deadlocks, min pair dist ${minPairDist.toFixed(2)} cells)`,
  )
}

// ── Shared Headless `street()` + Real `core.wasm` Harness ────────────────────
function buildDenseSfSquare(cx, cz) {
  // Dense downtown SF sidewalk network around (cx, cz) with busy=95 so Ring 1 & Ring 2 hold 50-120+ pedestrians.
  const walk = []
  let nid = 100
  const gridX = [-320, -160, 0, 160, 320]
  const gridZ = [-240, -120, 0, 120, 240]
  const nodeAt = (ix, iz) => nid + iz * 10 + ix
  for (let iz = 0; iz < gridZ.length; iz++) {
    for (let ix = 0; ix < gridX.length - 1; ix++) {
      const a = nodeAt(ix, iz), b = nodeAt(ix + 1, iz)
      const x0 = cx + gridX[ix], x1 = cx + gridX[ix + 1], z = cz + gridZ[iz]
      walk.push([a, b, 0, 95, x0, z, x1, z])
      walk.push([b, a, 0, 95, x1, z + 6, x0, z + 6])
    }
  }
  for (let ix = 0; ix < gridX.length; ix++) {
    for (let iz = 0; iz < gridZ.length - 1; iz++) {
      const a = nodeAt(ix, iz), b = nodeAt(ix, iz + 1)
      const x = cx + gridX[ix], z0 = cz + gridZ[iz], z1 = cz + gridZ[iz + 1]
      walk.push([a, b, 0, 95, x, z0, x, z1])
    }
  }
  // Extra dense parallel plaza walkways right through the center (Ring 1 <= 35 m) to guarantee high crowd density & mutual encounters.
  for (let k = 0; k < 6; k++) {
    const z = cz - 15 + k * 6
    walk.push([500 + k * 2, 501 + k * 2, 0, 100, cx - 220, z, cx + 220, z])
    walk.push([600 + k * 2, 601 + k * 2, 0, 100, cx + 220, z + 2, cx - 220, z + 2])
  }
  return { walk, roads: [], park: [], rail: [], heads: [] }
}

async function runStreetWasm(core, { cx = 700, cz = 4070, rain = 0, shocks = [], bodies = [] }, fn) {
  const origFetch = globalThis.fetch
  const origWorker = globalThis.Worker
  const origMatchMedia = globalThis.matchMedia
  const origDocument = globalThis.document
  const sq = buildDenseSfSquare(cx, cz)

  globalThis.Worker = class { postMessage() {} terminate() {} }
  globalThis.matchMedia = () => ({ matches: false })
  globalThis.document = { documentElement: { classList: { contains: () => false }, dataset: {} } }
  globalThis.fetch = async (url) => {
    const s = String(url)
    if (s.endsWith('life/index.json')) return new Response(JSON.stringify({ life: { '500.0_4250.0': { path: 'sq.json' } } }), { status: 200 })
    if (s.endsWith('life/sq.json')) return new Response(JSON.stringify(sq), { status: 200 })
    if (s.endsWith('cars/index.json')) return new Response(JSON.stringify({ cars: [] }), { status: 200 })
    return new Response('{}', { status: 404 })
  }

  let clockSec = 1000
  let rainVal = rain
  const noopPieces = { add: () => ({ pos: [0, 0, 0], rot: [0, 0, 0, 1], cell: 1, born: { low: [0, 0, 0], com: [0, 0, 0], size: [1, 1, 1], faces: new Uint32Array(0), cells: 0 }, destroy() {} }), refit() {} }
  const noopAlive = { things: [], riding: null, where: () => null, spawn: async () => ({ alive: false }), place() {}, kick() {}, vanish() {}, hit() {}, mount() {} }
  const noopHud = { cue: () => ({ remove() {} }), notice() {} }
  const noopInput = { held: () => false, always: () => () => {}, push: () => () => {} }

  try {
    const st = street({
      life: new URL('http://local/life/'),
      cars: new URL('http://local/cars/'),
      land: core,
      hour: () => 13,
      rain: () => rainVal,
      clock: () => clockSec,
      shocks,
      bodies: () => bodies,
      feet: () => (bodies.length ? bodies[0] : null),
      pieces: noopPieces,
      alive: noopAlive,
      hud: noopHud,
      input: noopInput,
    })
    const fy = core.feet_at(cx, cz)
    const view = {
      eye: [cx, fy + 16, cz],
      forward: [1, 0, 0],
      right: [0, 0, 1],
      up: [0, 1, 0],
      tanHalf: 0.7,
    }
    st.warmAt(cx, cz)
    // Allow async mock fetch microtasks to settle so walk graph is loaded.
    for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 10))
    const stepFolk = (dt = 0.05) => {
      clockSec += dt
      return st.folk(view, clockSec)
    }
    await fn({
      st,
      view,
      fy,
      stepFolk,
      getClock: () => clockSec,
      setRain: (r) => { rainVal = r },
    })
  } finally {
    globalThis.fetch = origFetch
    globalThis.Worker = origWorker
    globalThis.matchMedia = origMatchMedia
    globalThis.document = origDocument
  }
}

// ── 3. `street.ts` Dense Ring 1/2 WASM ORCA/RVO2 Mutual Avoidance ────────────
console.log('3. street.ts dense Ring 1/2 WASM ORCA/RVO2 mutual avoidance')
{
  const core = await freshCore()
  const cx = 700, cz = 4070
  const fy = core.feet_at(cx, cz)
  // Place a stationary player body right on the busy central walkway.
  const bodies = [[cx, fy, cz]]
  await runStreetWasm(core, { cx, cz, bodies }, async ({ st, stepFolk }) => {
    // Warm up 2 frames to settle initial spawn separation.
    stepFolk(0.05)
    stepFolk(0.05)
    let minPedDist = Infinity
    let minPlayerDist = Infinity
    let maxStepJump = 0
    let nanFound = false
    let rvoMsSum = 0
    let maxRvoAgents = 0
    const prevPos = new Map()
    const frames = 50

    for (let f = 0; f < frames; f++) {
      const list = stepFolk(0.05)
      const stats = st.crowdAiStats()
      rvoMsSum += stats.rvoStepMs
      maxRvoAgents = Math.max(maxRvoAgents, stats.rvoAgents)
      const r12 = []
      for (let i = 0; i < list.length; i++) {
        const p = list[i]
        if (!Number.isFinite(p.at[0]) || !Number.isFinite(p.at[1]) || !Number.isFinite(p.at[2])) nanFound = true
        if (p.lod <= 2 && p.down <= 0.3) r12.push(p)
        const prev = prevPos.get(p.seed)
        if (prev && p.lod <= 2) {
          const jump = Math.hypot(p.at[0] - prev[0], p.at[2] - prev[1])
          if (jump > maxStepJump) maxStepJump = jump
        }
        prevPos.set(p.seed, [p.at[0], p.at[2]])
      }
      for (let i = 0; i < r12.length; i++) {
        const a = r12[i]
        const dp = Math.hypot(a.at[0] - cx, a.at[2] - cz)
        if (Math.abs(a.at[1] - fy) < 18 && dp < minPlayerDist) minPlayerDist = dp
        for (let j = i + 1; j < r12.length; j++) {
          const b = r12[j]
          if (Math.abs(a.at[1] - b.at[1]) >= 18) continue
          const d = Math.hypot(a.at[0] - b.at[0], a.at[2] - b.at[2])
          if (d < minPedDist) minPedDist = d
        }
      }
    }
    const meanRvoMs = rvoMsSum / frames
    check(
      maxRvoAgents >= 30 && meanRvoMs < 1.0 && !nanFound,
      `batched WASM RVO2 stepped ${maxRvoAgents} Ring 1/2 pedestrians in ${meanRvoMs.toFixed(3)} ms/frame (< 1.0 ms, 0 NaNs)`,
    )
    check(
      minPedDist >= 5.8 && minPlayerDist >= 6.2 && maxStepJump < 12,
      `0 pedestrian overlaps (min ped-ped=${minPedDist.toFixed(2)} cells >= 5.8, min ped-player=${minPlayerDist.toFixed(2)} >= 6.2, max frame move=${maxStepJump.toFixed(2)})`,
    )
  })
}

// ── 4. `street.ts` WASM Panic Flow Fields & Divergent Blast Reactions ────────
console.log('4. street.ts WASM panic flow fields & divergent blast roles (flee/shelter/film/glance)')
{
  const core = await freshCore()
  const cx = 700, cz = 4070
  const fy = core.feet_at(cx, cz)
  core.nav_bake_area(cx, cz, 4, 128)
  const shocks = []
  await runStreetWasm(core, { cx, cz, shocks }, async ({ st, stepFolk, getClock }) => {
    // Establish initial positions before the blast.
    stepFolk(0.05)
    stepFolk(0.05)

    // Detonate a real blast at (cx, fy, cz)!
    core.bodies_blast(cx, fy, cz, 12, -1, 0)
    shocks.push({ at: [cx, fy, cz], radius: 14, t: getClock() })

    const startDist = new Map()
    const firstBlast = stepFolk(0.05)
    for (const p of firstBlast) {
      if (p.panicRole === 'flee') startDist.set(p.seed, Math.hypot(p.at[0] - cx, p.at[2] - cz))
    }

    let lastList = firstBlast
    let lastStats = st.crowdAiStats()
    for (let f = 0; f < 30; f++) {
      lastList = stepFolk(0.05)
      lastStats = st.crowdAiStats()
    }

    let fledFurther = 0, fledTotal = 0, filmActive = 0, shelterActive = 0, glanceActive = 0
    for (const p of lastList) {
      if (p.panicRole === 'flee') {
        fledTotal++
        const d0 = startDist.get(p.seed)
        const d1 = Math.hypot(p.at[0] - cx, p.at[2] - cz)
        if (d0 !== undefined && d1 > d0 + 8 && p.running > 0.4) fledFurther++
      } else if (p.panicRole === 'film' && p.filming > 0.3) {
        filmActive++
      } else if (p.panicRole === 'shelter' && (p.move || p.flinch > 0.3)) {
        shelterActive++
      } else if (p.panicRole === 'glance' && p.flinch > 0.2) {
        glanceActive++
      }
    }

    const r = lastStats.panicRoles
    check(
      lastStats.flowActive && r.flee > 0 && r.shelter > 0 && r.film > 0 && r.glance > 0,
      `WASM panic flow active (${lastStats.flowActive}) with all 4 divergent roles: flee=${r.flee}, shelter=${r.shelter}, film=${r.film}, glance=${r.glance}`,
    )
    check(
      fledFurther >= Math.max(1, Math.floor(fledTotal * 0.5)) && filmActive > 0 && shelterActive > 0 && glanceActive > 0,
      `divergent reactions verified: ${fledFurther}/${fledTotal} fleers sprinted away, ${filmActive} filming, ${shelterActive} sheltering, ${glanceActive} startled/glancing`,
    )
  })
}

// ── 5. `street.ts` Geometric Rain-Awning Shelter Seeking (`rain > 0.3`) ──────
console.log('5. street.ts geometric rain-awning shelter seeking (rain > 0.3)')
{
  const core = await freshCore()
  const cx = 700, cz = 4070
  const fy = core.feet_at(cx, cz)
  // Build a solid overhead storefront awning/canopy slab at y = fy + 26..28 over z in [cz-26..cz-8], x in [cx-80..cx+80].
  const awningRuns = []
  for (let y = fy + 26; y <= fy + 28; y++) {
    for (let z = cz - 26; z <= cz - 8; z++) {
      awningRuns.push([cx - 80, cx + 81, y, z, WOOD])
    }
  }
  applyRuns(core, awningRuns)

  await runStreetWasm(core, { cx, cz, rain: 0 }, async ({ st, stepFolk, setRain }) => {
    stepFolk(0.05)
    const drySheltered = st.crowdAiStats().rainSheltered
    check(drySheltered === 0, `dry weather has 0 rain-sheltered pedestrians (got ${drySheltered})`)

    // Turn on heavy rain (`rain = 0.85`) and simulate 5 seconds so nearby pedestrians duck under the awning.
    setRain(0.85)
    let list = []
    for (let f = 0; f < 100; f++) list = stepFolk(0.05)
    const wetStats = st.crowdAiStats()
    let trulyUnderAwning = 0
    for (const p of list) {
      if (!p.sheltered) continue
      const ix = Math.round(p.at[0]), iz = Math.round(p.at[2]), py = core.feet_at(ix, iz)
      let covered = false
      for (let oy = 20; oy <= 56; oy += 4) if (core.world_kind(ix, py + oy, iz) !== 0) { covered = true; break }
      if (covered && p.walking === 0 && p.umbrella === false) trulyUnderAwning++
    }
    check(
      wetStats.rainSheltered >= 3 && trulyUnderAwning >= 3,
      `rain=0.85 sheltered ${wetStats.rainSheltered} pedestrians (${trulyUnderAwning} verified dry under solid overhead voxel awning with folded umbrellas)`,
    )

    // Clear rain and verify pedestrians resume walking cleanly.
    setRain(0)
    for (let f = 0; f < 20; f++) stepFolk(0.05)
    const clearedStats = st.crowdAiStats()
    check(clearedStats.rainSheltered === 0, `clearing rain released sheltered pedestrians (rainSheltered=${clearedStats.rainSheltered})`)
  })
}

if (failures.length) {
  console.error(`\nFAILED (${failures.length}):\n  ${failures.join('\n  ')}`)
  process.exit(1)
}
console.log('\ncrowd-wiring: ok')
process.exit(0)
