// Node WASM integration & performance test for destructible tiled navmesh, HPA* portals,
// panic flow fields, and ORCA/RVO2 crowd avoidance (#164).
//   node engine/test/nav-rvo.mjs
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const wasmPath = new URL('../page/core.wasm', import.meta.url)
const { instance } = await WebAssembly.instantiate(await readFile(wasmPath), {})
const core = instance.exports

const NAV_ALLOW_VAULT = 1 << 0
const NAV_ALLOW_DROP = 1 << 1
const NAV_ALLOW_CLIMB = 1 << 2
const NAV_WALK_ONLY = 1 << 3

const MAX_AGENTS = core.crowd_capacity()
assert.equal(MAX_AGENTS, 512, 'crowd capacity should be 512')

const FIELD_POS_X = 0
const FIELD_POS_Z = 1
const FIELD_POS_Y = 2
const FIELD_VEL_X = 3
const FIELD_VEL_Z = 4
const FIELD_PREF_VX = 5
const FIELD_PREF_VZ = 6
const FIELD_RADIUS = 7
const FIELD_MAX_SPEED = 8
const FIELD_FLAGS = 9
const CROWD_FLAG_IGNORE_WORLD = 1 << 2

const WOOD = 10
const BRICK = 8
const CONCRETE = 7

/** Write an Int32 edit stream and apply it via world_edit. */
function applyRuns(runs) {
  const words = [1, runs.length]
  for (const r of runs) words.push(r[0], r[1], r[2], r[3], r[4])
  const ptr = core.edits_room(words.length)
  new Int32Array(core.memory.buffer, ptr, words.length).set(words)
  core.world_edit(-1)
}

/** Read path waypoints from WASM memory AFTER nav_find_path returns. */
function readPath(count) {
  assert.equal(core.nav_path_len(), count)
  const ptr = core.nav_path_ptr()
  const view = new Float32Array(core.memory.buffer, ptr, count * 4)
  const out = []
  for (let i = 0; i < count; i++) {
    out.push([view[i * 4], view[i * 4 + 1], view[i * 4 + 2], view[i * 4 + 3]])
  }
  return out
}

// ── 1. Tile baking, dirty invalidation & budgeted rebake after real crater blast ──
const bx = 700
const bz = 4070
const by = core.ground_at(bx, bz)
const btx = Math.floor(bx / 64)
const btz = Math.floor(bz / 64)

core.world_forget()
const bakedInit = core.nav_bake_area(bx, bz, 2, 64)
assert.equal(bakedInit, 25, '5x5 initial nav area should bake 25 tiles')
assert.equal(core.nav_tile_count(), 25)
assert.equal(core.nav_dirty_count(), 0)
assert.ok(core.nav_tile_spans(btx, btz) > 100, 'street tile should have > 100 walkable spans')
assert.ok(core.nav_tile_portals(btx, btz) >= 2, 'street tile should have cross-tile portals')

// Detonate a real blast via bodies_blast and verify dirty invalidation + budgeted rebake timing.
core.bodies_blast(bx, by, bz, 14, -1, 0)
const dirtyAfterBlast = core.nav_dirty_count()
assert.ok(dirtyAfterBlast >= 9, `blast should dirty >= 9 tiles with portal border (got ${dirtyAfterBlast})`)

const tRebake1 = performance.now()
const rebakedOne = core.nav_rebake_budget(bx, bz, 1)
const singleRebakeMs = performance.now() - tRebake1
assert.equal(rebakedOne, 1)
assert.equal(core.nav_dirty_count(), dirtyAfterBlast - 1)

const remDirty = core.nav_dirty_count()
const tRebakeRest = performance.now()
const rebakedRest = core.nav_rebake_budget(bx, bz, remDirty)
const avgRebakeMs = (performance.now() - tRebakeRest) / Math.max(1, rebakedRest)
assert.equal(rebakedRest, remDirty)
assert.equal(core.nav_dirty_count(), 0)

// ── 2. Pathfinding around fresh crater & over newly placed player voxel bridge ──
core.world_forget()
core.nav_bake_area(bx, bz, 3, 64)
const craterY = core.ground_at(bx, bz)
const craterRuns = []
for (let y = craterY - 40; y <= craterY + 4; y++) {
  for (let z = bz - 16; z <= bz + 16; z++) {
    craterRuns.push([bx - 16, bx + 17, y, z, 0])
  }
}
applyRuns(craterRuns)
assert.ok(core.nav_dirty_count() >= 9, 'crater world_edit should dirty tiles')
core.nav_rebake_budget(bx, bz, 64)
assert.equal(core.nav_dirty_count(), 0)

const sx = bx - 48
const gx = bx + 48
const sy = core.feet_at(sx, bz)
const gy = core.feet_at(gx, bz)

const tPath0 = performance.now()
const craterPathLen = core.nav_find_path(sx, sy, bz, gx, gy, bz, NAV_WALK_ONLY)
const pathCraterMs = performance.now() - tPath0
assert.ok(craterPathLen >= 3, `expected detour path around crater (got ${craterPathLen} waypoints)`)
const craterPath = readPath(craterPathLen)
let maxLateral = 0
for (let i = 0; i < craterPath.length; i++) {
  const [wx, wy, wz] = craterPath[i]
  assert.ok(wy >= craterY - 10, `waypoint dropped into crater: y=${wy} < ${craterY - 10}`)
  maxLateral = Math.max(maxLateral, Math.abs(wz - bz))
  if (i + 1 < craterPath.length) {
    const [nx, , nz] = craterPath[i + 1]
    for (let s = 0; s <= 16; s++) {
      const t = s / 16
      const px = wx + (nx - wx) * t
      const pz = wz + (nz - wz) * t
      assert.ok(
        !(Math.abs(px - bx) < 12 && Math.abs(pz - bz) < 12),
        `smoothed segment ${i}->${i + 1} cut through crater core at (${px.toFixed(1)}, ${pz.toFixed(1)})`
      )
    }
  }
}
assert.ok(maxLateral > 14, `crater path should route laterally around crater rim (max |z-bz|=${maxLateral.toFixed(1)})`)

// Build a player voxel bridge directly across the crater!
const bridgeRuns = []
for (let z = bz - 6; z <= bz + 6; z++) {
  bridgeRuns.push([bx - 20, bx + 21, craterY, z, WOOD])
}
applyRuns(bridgeRuns)
assert.ok(core.nav_dirty_count() > 0, 'bridge edit should dirty intersecting tiles')
core.nav_rebake_budget(bx, bz, 64)

const tPath1 = performance.now()
const bridgePathLen = core.nav_find_path(sx, sy, bz, gx, gy, bz, NAV_WALK_ONLY)
const pathBridgeMs = performance.now() - tPath1
assert.ok(bridgePathLen >= 2, 'path over new bridge should succeed')
const bridgePath = readPath(bridgePathLen)
for (const [, , wz] of bridgePath) {
  assert.ok(Math.abs(wz - bz) <= 10, `bridge path should cross near z=${bz}, got z=${wz}`)
}

// ── 3. Multi-layer overpass check (road underpass + elevated deck simultaneously) ──
const spansBeforeDeck = core.nav_tile_spans(btx, btz)
const deckRuns = []
const deckY = craterY + 28
for (let z = btz * 64 + 8; z < btz * 64 + 40; z++) {
  deckRuns.push([btx * 64 + 8, btx * 64 + 56, deckY, z, CONCRETE])
}
applyRuns(deckRuns)
core.nav_rebake_budget(bx, bz, 16)
const spansAfterDeck = core.nav_tile_spans(btx, btz)
assert.ok(
  spansAfterDeck > spansBeforeDeck + 40,
  `elevated overpass deck should add stacked walkable layer spans (${spansBeforeDeck} -> ${spansAfterDeck})`
)
const upperLen = core.nav_find_path(
  btx * 64 + 14, deckY + 1, btz * 64 + 24,
  btx * 64 + 50, deckY + 1, btz * 64 + 24,
  NAV_WALK_ONLY
)
assert.ok(upperLen >= 2, 'path along elevated overpass deck should succeed')
const upperPath = readPath(upperLen)
for (const [, wy] of upperPath) {
  assert.equal(wy, deckY + 1, `elevated deck path should stay on deck layer y=${deckY + 1}`)
}

// ── 4. Panic flow field routing around wall & O(1) sampling for 200 NPCs ──
core.world_forget()
const fx0 = 700
const fz0 = 4070
const fy0 = core.feet_at(fx0, fz0)
core.nav_bake_area(fx0, fz0, 3, 64)
// Erect a solid brick wall east of the blast (x = fx0 + 20..26, z = fz0 - 36..+36).
const wallRuns = []
for (let y = fy0; y < fy0 + 28; y++) {
  for (let z = fz0 - 36; z <= fz0 + 36; z++) {
    wallRuns.push([fx0 + 20, fx0 + 26, y, z, BRICK])
  }
}
applyRuns(wallRuns)
core.nav_rebake_budget(fx0, fz0, 32)

core.nav_flow_clear()
core.nav_flow_add_threat(fx0, fy0, fz0, 180)
const tFlowBuild = performance.now()
const activeFlowSpans = core.nav_flow_build()
const flowBuildMs = performance.now() - tFlowBuild
assert.ok(activeFlowSpans > 200, `expected > 200 active flow spans (got ${activeFlowSpans})`)

// Sample between blast and wall: agent at (fx0 + 12, fy0, fz0 + 10) must get unit escape vector.
const ok = core.nav_flow_sample(fx0 + 12, fy0, fz0 + 10)
assert.equal(ok, 1, 'agent inside blast radius should receive active escape vector')
const vecPtr = core.nav_flow_vec_ptr()
const vec = new Float32Array(core.memory.buffer, vecPtr, 2)
const vlen = Math.hypot(vec[0], vec[1])
assert.ok(Math.abs(vlen - 1.0) < 1e-3, `escape vector should be unit length (got ${vlen})`)

// Time 200 O(1) flow field samples.
const tFlowSample = performance.now()
let hits = 0
for (let i = 0; i < 200; i++) {
  const a = (i / 200) * Math.PI * 2
  const r = 30 + (i % 5) * 20
  const px = fx0 + Math.cos(a) * r
  const pz = fz0 + Math.sin(a) * r
  const py = core.feet_at(Math.round(px), Math.round(pz))
  hits += core.nav_flow_sample(px, py, pz)
}
const flowSample200Ms = performance.now() - tFlowSample
assert.ok(hits > 100, `expected most nearby panicking NPCs to sample valid escape vectors (got ${hits}/200)`)

// ── 5. ORCA/RVO2 200-agent antipodal crossing & narrow-doorway stress test via SoA buffer ──
core.crowd_reset()
const N = 200
const ringR = 220
const agentR = 3.0
const maxSpd = 30.0
const dt = 0.05
const tau = 2.0
const goalsX = new Float32Array(N)
const goalsZ = new Float32Array(N)

const soaPtr = core.crowd_agents_ptr()
let soa = new Float32Array(core.memory.buffer, soaPtr, MAX_AGENTS * 10)
for (let i = 0; i < N; i++) {
  const a = (i / N) * Math.PI * 2
  const x = ringR * Math.cos(a)
  const z = ringR * Math.sin(a)
  goalsX[i] = -x
  goalsZ[i] = -z
  soa[FIELD_POS_X * MAX_AGENTS + i] = x
  soa[FIELD_POS_Z * MAX_AGENTS + i] = z
  soa[FIELD_POS_Y * MAX_AGENTS + i] = 10
  soa[FIELD_VEL_X * MAX_AGENTS + i] = 0
  soa[FIELD_VEL_Z * MAX_AGENTS + i] = 0
  soa[FIELD_RADIUS * MAX_AGENTS + i] = agentR
  soa[FIELD_MAX_SPEED * MAX_AGENTS + i] = maxSpd
  soa[FIELD_FLAGS * MAX_AGENTS + i] = CROWD_FLAG_IGNORE_WORLD
}

const rvoSteps = 700
let totalRvoMs = 0
for (let s = 0; s < rvoSteps; s++) {
  // Refresh typed-array view safely from current memory.buffer.
  soa = new Float32Array(core.memory.buffer, core.crowd_agents_ptr(), MAX_AGENTS * 10)
  for (let i = 0; i < N; i++) {
    const dx = goalsX[i] - soa[FIELD_POS_X * MAX_AGENTS + i]
    const dz = goalsZ[i] - soa[FIELD_POS_Z * MAX_AGENTS + i]
    const d = Math.hypot(dx, dz)
    if (d > 1.0) {
      const spd = Math.min(maxSpd, d / dt)
      soa[FIELD_PREF_VX * MAX_AGENTS + i] = (dx / d) * spd
      soa[FIELD_PREF_VZ * MAX_AGENTS + i] = (dz / d) * spd
    } else {
      soa[FIELD_PREF_VX * MAX_AGENTS + i] = 0
      soa[FIELD_PREF_VZ * MAX_AGENTS + i] = 0
    }
  }
  const t0 = performance.now()
  core.crowd_step(N, dt, tau)
  totalRvoMs += performance.now() - t0

  soa = new Float32Array(core.memory.buffer, core.crowd_agents_ptr(), MAX_AGENTS * 10)
  for (let i = 0; i < N; i++) {
    assert.ok(Number.isFinite(soa[FIELD_POS_X * MAX_AGENTS + i]), `NaN pos_x at step ${s} agent ${i}`)
    assert.ok(Number.isFinite(soa[FIELD_POS_Z * MAX_AGENTS + i]), `NaN pos_z at step ${s} agent ${i}`)
  }
  if (s % 70 === 0 || s === rvoSteps - 1) {
    const minDist = agentR * 2.0 * 0.98
    const minDistSq = minDist * minDist
    for (let i = 0; i < N; i++) {
      const xi = soa[FIELD_POS_X * MAX_AGENTS + i]
      const zi = soa[FIELD_POS_Z * MAX_AGENTS + i]
      for (let j = i + 1; j < N; j++) {
        const dx = soa[FIELD_POS_X * MAX_AGENTS + j] - xi
        const dz = soa[FIELD_POS_Z * MAX_AGENTS + j] - zi
        assert.ok(dx * dx + dz * dz >= minDistSq, `overlap at step ${s} between ${i} and ${j}`)
      }
    }
  }
}
const meanRvoMs = totalRvoMs / rvoSteps
let arrived = 0
soa = new Float32Array(core.memory.buffer, core.crowd_agents_ptr(), MAX_AGENTS * 10)
for (let i = 0; i < N; i++) {
  const d = Math.hypot(goalsX[i] - soa[FIELD_POS_X * MAX_AGENTS + i], goalsZ[i] - soa[FIELD_POS_Z * MAX_AGENTS + i])
  if (d < 35) arrived++
}
assert.ok(arrived >= 180, `expected >= 180/200 agents to cross antipodal ring (got ${arrived})`)

// Narrow 1.0m doorway evacuation stress test in WASM (30 agents squeezing through z in [-5..+5]).
core.crowd_reset()
core.crowd_add_obstacle(0, -200, 0, -5)
core.crowd_add_obstacle(0, 5, 0, 200)
const doorN = 30
for (let i = 0; i < doorN; i++) {
  const row = Math.floor(i / 5)
  const col = (i % 5) - 2
  core.crowd_set_agent(i, -14 - row * 7.5, 10, col * 7.5, 0, 0, 0, 0, 2.8, 24, CROWD_FLAG_IGNORE_WORLD)
}
for (let s = 0; s < 420; s++) {
  soa = new Float32Array(core.memory.buffer, core.crowd_agents_ptr(), MAX_AGENTS * 10)
  for (let i = 0; i < doorN; i++) {
    const px = soa[FIELD_POS_X * MAX_AGENTS + i]
    const pz = soa[FIELD_POS_Z * MAX_AGENTS + i]
    const tx = px < 2 ? (Math.abs(pz) > 2.2 ? 0 : 20) : 120
    const tz = px < 2 ? Math.max(-1.8, Math.min(1.8, pz)) : ((i % 5) - 2) * 8
    const dx = tx - px
    const dz = tz - pz
    const d = Math.hypot(dx, dz)
    soa[FIELD_PREF_VX * MAX_AGENTS + i] = d > 1 ? (dx / d) * 24 : 0
    soa[FIELD_PREF_VZ * MAX_AGENTS + i] = d > 1 ? (dz / d) * 24 : 0
  }
  core.crowd_step(doorN, dt, 1.5)
}
soa = new Float32Array(core.memory.buffer, core.crowd_agents_ptr(), MAX_AGENTS * 10)
let doorCrossed = 0
for (let i = 0; i < doorN; i++) {
  const px = soa[FIELD_POS_X * MAX_AGENTS + i]
  const pz = soa[FIELD_POS_Z * MAX_AGENTS + i]
  assert.ok(Number.isFinite(px) && Number.isFinite(pz), `doorway NaN on agent ${i}`)
  if (px > 4) doorCrossed++
}
assert.ok(doorCrossed >= 26, `expected >= 26/30 narrow doorway agents to evacuate (got ${doorCrossed})`)

// Bidirectional 2.0m doorway crossing in WASM (16 West->East vs 16 East->West through z in [-10..+10]).
core.crowd_reset()
core.crowd_add_obstacle(0, -200, 0, -10)
core.crowd_add_obstacle(0, 10, 0, 200)
const bidirN = 32
const bGoalsX = new Float32Array(bidirN)
const bGoalsZ = new Float32Array(bidirN)
for (let i = 0; i < 16; i++) {
  const row = Math.floor(i / 2)
  const col = i % 2
  core.crowd_set_agent(i, -18 - row * 8, 10, -2 + col * 8, 0, 0, 0, 0, 2.8, 22, CROWD_FLAG_IGNORE_WORLD)
  bGoalsX[i] = 90 + row * 8
  bGoalsZ[i] = -2 + col * 8
  const j = i + 16
  core.crowd_set_agent(j, 18 + row * 8, 10, 2 - col * 8, 0, 0, 0, 0, 2.8, 22, CROWD_FLAG_IGNORE_WORLD)
  bGoalsX[j] = -90 - row * 8
  bGoalsZ[j] = 2 - col * 8
}
for (let s = 0; s < 420; s++) {
  soa = new Float32Array(core.memory.buffer, core.crowd_agents_ptr(), MAX_AGENTS * 10)
  for (let i = 0; i < bidirN; i++) {
    const px = soa[FIELD_POS_X * MAX_AGENTS + i]
    const pz = soa[FIELD_POS_Z * MAX_AGENTS + i]
    const west = i < 16
    const tx = west && px < 2 ? (Math.abs(pz) > 6.5 ? 0 : 20) : !west && px > -2 ? (Math.abs(pz) > 6.5 ? 0 : -20) : bGoalsX[i]
    const tz = (west && px < 2) || (!west && px > -2) ? Math.max(-6, Math.min(6, pz)) : bGoalsZ[i]
    const dx = tx - px
    const dz = tz - pz
    const d = Math.hypot(dx, dz)
    soa[FIELD_PREF_VX * MAX_AGENTS + i] = d > 1 ? (dx / d) * 22 : 0
    soa[FIELD_PREF_VZ * MAX_AGENTS + i] = d > 1 ? (dz / d) * 22 : 0
  }
  core.crowd_step(bidirN, dt, 1.5)
}
soa = new Float32Array(core.memory.buffer, core.crowd_agents_ptr(), MAX_AGENTS * 10)
let bidirCrossed = 0
for (let i = 0; i < 16; i++) {
  if (soa[FIELD_POS_X * MAX_AGENTS + i] > 4) bidirCrossed++
  if (soa[FIELD_POS_X * MAX_AGENTS + i + 16] < -4) bidirCrossed++
}
assert.ok(bidirCrossed >= 28, `expected >= 28/32 bidirectional doorway agents to cross (got ${bidirCrossed})`)

console.log(
  `nav-rvo wasm ok: tile_rebake=${singleRebakeMs.toFixed(3)} ms (ring_avg=${avgRebakeMs.toFixed(3)} ms), ` +
    `path_crater=${pathCraterMs.toFixed(3)} ms (${craterPathLen} wps), path_bridge=${pathBridgeMs.toFixed(3)} ms (${bridgePathLen} wps), ` +
    `flow_build=${flowBuildMs.toFixed(3)} ms (${activeFlowSpans} spans), flow_sample_200=${flowSample200Ms.toFixed(3)} ms, ` +
    `rvo2_200_step=${meanRvoMs.toFixed(3)} ms (arrived=${arrived}/${N}, evac_1m=${doorCrossed}/${doorN}, bidir_2m=${bidirCrossed}/${bidirN})`
)
