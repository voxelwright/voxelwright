// Node WASM integration & performance test for EQS-Lite spatial queries
// (find_cover, find_shelter, find_vantage) and spatial visual/acoustic perception (#164).
//   node engine/test/eqs-perception.mjs
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const wasmPath = new URL('../page/core.wasm', import.meta.url)
const { instance } = await WebAssembly.instantiate(await readFile(wasmPath), {})
const core = instance.exports

const WATER = 5
const CONCRETE = 7
const BRICK = 8
const WOOD = 10
const GLASS = 11

const EYES = 16
const HEAD = 16
const CHEST = 11
const CROUCH = 8
const PEEK = 17

const VISION_CAP = core.perception_vision_capacity()
assert.equal(VISION_CAP, 256, 'vision capacity should be 256')

const FIELD_X = 0
const FIELD_Y = 1
const FIELD_Z = 2
const FIELD_YAW = 3
const FIELD_LOD = 4
const FIELD_FLAGS = 5

const VISION_FLAG_RULE = 1 << 0
const VISION_FLAG_IGNORE_ACTORS = 1 << 2

/** Write a y-sorted Int32 edit stream and apply it via world_edit (`Scratch::runs` binary-searches by `y`). */
function applyRuns(runs) {
  const sorted = [...runs].sort((a, b) => a[2] - b[2] || a[3] - b[3] || a[0] - b[0])
  const words = [1, sorted.length]
  for (const r of sorted) words.push(r[0], r[1], r[2], r[3], r[4])
  const ptr = core.edits_room(words.length)
  new Int32Array(core.memory.buffer, ptr, words.length).set(words)
  core.world_edit(-1)
}

/** Build a clean flat concrete plaza `[x0..x1) × [z0..z1)` with floor top at `floorY` (feet at `floorY + 1`) and air above. */
function buildPlaza(x0, z0, x1, z1, floorY, clearTopY) {
  const runs = []
  for (let z = z0; z < z1; z++) runs.push([x0, x1, floorY, z, CONCRETE])
  for (let y = floorY + 1; y < clearTopY; y++) {
    for (let z = z0; z < z1; z++) runs.push([x0, x1, y, z, 0])
  }
  applyRuns(runs)
}

function readEqsResults(count) {
  assert.equal(core.eqs_results_len(), count)
  const ptr = core.eqs_results_ptr()
  const view = new Float32Array(core.memory.buffer, ptr, count * 4)
  const out = []
  for (let i = 0; i < count; i++) {
    out.push([view[i * 4], view[i * 4 + 1], view[i * 4 + 2], view[i * 4 + 3]])
  }
  return out
}

function readVisionPairs(count) {
  assert.equal(core.perception_vision_pairs_len(), count)
  const ptr = core.perception_vision_pairs_ptr()
  const view = new Uint32Array(core.memory.buffer, ptr, count * 2)
  const out = []
  for (let i = 0; i < count; i++) {
    out.push([view[i * 2], view[i * 2 + 1]])
  }
  return out
}

const cx = 700
const cz = 4070
const baseY = core.ground_at(cx, cz)
const standY = baseY + 1

// ── 1. perception_los (glass & water clear vs opaque concrete/brick) ──
core.world_forget()
buildPlaza(cx - 80, cz - 80, cx + 80, cz + 80, baseY, baseY + 90)
{
  const glassRuns = []
  const waterRuns = []
  for (let y = standY; y < standY + 36; y++) {
    for (let z = cz - 24; z <= cz + 24; z++) {
      glassRuns.push([cx - 12, cx - 10, y, z, GLASS])
      waterRuns.push([cx + 4, cx + 7, y, z, WATER])
    }
  }
  applyRuns([...glassRuns, ...waterRuns])
  assert.equal(
    core.perception_los(cx - 40.5, standY + EYES, cz + 0.5, cx + 40.5, standY + EYES, cz + 0.5),
    1,
    'glass and water must be visually transparent'
  )

  const wallRuns = []
  for (let y = standY; y < standY + 36; y++) {
    for (let z = cz - 8; z <= cz + 8; z++) {
      wallRuns.push([cx + 18, cx + 22, y, z, CONCRETE])
    }
  }
  applyRuns(wallRuns)
  assert.equal(
    core.perception_los(cx - 40.5, standY + EYES, cz + 0.5, cx + 40.5, standY + EYES, cz + 0.5),
    0,
    'concrete wall must block visual LOS'
  )
  assert.equal(
    core.perception_los(cx - 40.5, standY + EYES, cz + 14.5, cx + 40.5, standY + EYES, cz + 14.5),
    1,
    'sightline past wall edge through glass and water must stay clear'
  )
}

// ── 2. perception_acoustic_attenuation (open air > glass > wood > thick concrete) ──
core.world_forget()
buildPlaza(cx - 80, cz - 80, cx + 80, cz + 80, baseY, baseY + 80)
{
  const ax = cx - 25.5
  const bx = cx + 24.5
  const ey = standY + 15.5
  const ez = cz + 0.5
  const maxR = 500.0

  const sOpen = core.perception_acoustic_attenuation(ax, ey, ez, bx, ey, ez, maxR)
  const expectedOpen = Math.pow(1 - 50 / maxR, 1.5)
  assert.ok(Math.abs(sOpen - expectedOpen) < 1e-3, `open air acoustic mismatch: ${sOpen} vs ${expectedOpen}`)
  assert.equal(core.perception_acoustic_attenuation(ax, ey, ez, ax + 0.2, ey, ez, maxR), 1.0)
  assert.equal(core.perception_acoustic_attenuation(ax, ey, ez, ax + maxR + 5, ey, ez, maxR), 0.0)

  // Add thin 2-cell glass partition.
  const gRuns = []
  for (let y = standY; y < standY + 40; y++) {
    for (let z = cz - 16; z <= cz + 16; z++) gRuns.push([cx, cx + 2, y, z, GLASS])
  }
  applyRuns(gRuns)
  const sGlass = core.perception_acoustic_attenuation(ax, ey, ez, bx, ey, ez, maxR)
  assert.ok(sGlass < sOpen && sGlass > sOpen * 0.75, `glass attenuation unexpected: ${sGlass} vs ${sOpen}`)

  // Replace with 6-cell wood wall.
  const wRuns = []
  for (let y = standY; y < standY + 40; y++) {
    for (let z = cz - 16; z <= cz + 16; z++) wRuns.push([cx, cx + 6, y, z, WOOD])
  }
  applyRuns(wRuns)
  const sWood = core.perception_acoustic_attenuation(ax, ey, ez, bx, ey, ez, maxR)
  assert.ok(sWood < sGlass, `wood wall should dampen more than glass: ${sWood} vs ${sGlass}`)

  // Replace with 12-cell (1.2 m) concrete wall.
  const cRuns = []
  for (let y = standY; y < standY + 40; y++) {
    for (let z = cz - 16; z <= cz + 16; z++) cRuns.push([cx, cx + 12, y, z, CONCRETE])
  }
  applyRuns(cRuns)
  const sConcrete = core.perception_acoustic_attenuation(ax, ey, ez, bx, ey, ez, maxR)
  assert.ok(
    sConcrete < sOpen * 0.08,
    `thick concrete wall must strongly attenuate sound: concrete=${sConcrete.toFixed(5)} vs open=${sOpen.toFixed(5)}`
  )
}

// ── 3. eqs_find_cover (hard concrete wall + waist-high crouch cover + < 0.5 ms gate) ──
core.world_forget()
buildPlaza(cx - 100, cz - 100, cx + 100, cz + 100, baseY, baseY + 80)
{
  // Full concrete cover wall at x = cx + 6..10, z = cz - 18..+18, height 24 cells.
  const wallRuns = []
  for (let y = standY; y < standY + 24; y++) {
    for (let z = cz - 18; z <= cz + 18; z++) {
      wallRuns.push([cx + 6, cx + 10, y, z, CONCRETE])
    }
  }
  applyRuns(wallRuns)
  core.nav_bake_area(cx, cz, 2, 64)

  const ox = cx - 16
  const tx = cx + 52
  const nCover = core.eqs_find_cover(ox, standY, cz, tx, standY, cz, 72)
  assert.ok(nCover >= 4, `expected >= 4 cover spots behind concrete wall (got ${nCover})`)
  const coverRes = readEqsResults(nCover)
  for (let i = 0; i < coverRes.length; i++) {
    const [rx, ry, rz, sc] = coverRes[i]
    if (i > 0) assert.ok(sc <= coverRes[i - 1][3], 'cover results must be sorted descending')
    assert.equal(
      core.perception_los(tx, standY + EYES, cz, rx, ry + CHEST, rz),
      0,
      `cover spot ${i} (${rx}, ${ry}, ${rz}) must be occluded at chest height from threat`
    )
  }
  assert.ok(
    coverRes[0][0] <= cx + 6 && Math.abs(coverRes[0][2] - cz) <= 24,
    `best cover should hug West side or corner shadow of wall, got (${coverRes[0][0]}, ${coverRes[0][2]})`
  )

  const coverIters = 40
  const tCover0 = performance.now()
  for (let i = 0; i < coverIters; i++) {
    core.eqs_find_cover(ox, standY, cz, tx, standY, cz, 72)
  }
  var coverMs = (performance.now() - tCover0) / coverIters
  assert.ok(coverMs < 0.5, `eqs_find_cover took ${coverMs.toFixed(3)} ms (gate < 0.5 ms)`)

  // Waist-high barricade (11 cells tall): occluded crouch + open standing peek!
  core.world_forget()
  buildPlaza(cx - 80, cz - 80, cx + 80, cz + 80, baseY, baseY + 80)
  const lowRuns = []
  for (let y = standY; y < standY + 11; y++) {
    for (let z = cz - 14; z <= cz + 14; z++) {
      lowRuns.push([cx + 6, cx + 10, y, z, CONCRETE])
    }
  }
  applyRuns(lowRuns)
  core.nav_bake_area(cx, cz, 2, 64)
  const nLow = core.eqs_find_cover(cx - 12, standY, cz, cx + 48, standY, cz, 60)
  assert.ok(nLow >= 1, 'waist-high barricade should yield crouch cover')
  const [lx, ly, lz] = readEqsResults(nLow)[0]
  assert.ok(lx < cx + 6 && Math.abs(lz - cz) <= 14, `waist cover behind barricade, got (${lx}, ${lz})`)
  assert.equal(core.perception_los(cx + 48, standY + EYES, cz, lx, ly + CROUCH, lz), 0)
  assert.equal(core.perception_los(cx + 48, standY + EYES, cz, lx, ly + PEEK, lz), 1)
}

// ── 4. eqs_find_shelter (rain awning vs open sky + < 0.5 ms gate) ──
core.world_forget()
buildPlaza(cx - 96, cz - 96, cx + 96, cz + 96, baseY, baseY + 90)
core.nav_bake_area(cx, cz, 2, 64)
{
  const nOpenSky = core.eqs_find_shelter(cx, standY, cz, 64)
  assert.equal(nOpenSky, 0, `open plaza sky must return 0 shelter spots (got ${nOpenSky})`)

  // Erect a 24×24 wood rain awning 28 cells above the floor at x = cx+12..36, z = cz-12..+12.
  const awningRuns = []
  for (let y = standY + 28; y < standY + 30; y++) {
    for (let z = cz - 12; z < cz + 12; z++) {
      awningRuns.push([cx + 12, cx + 36, y, z, WOOD])
    }
  }
  applyRuns(awningRuns)

  const nShelter = core.eqs_find_shelter(cx, standY, cz, 72)
  assert.ok(nShelter >= 4, `expected sheltered positions under awning (got ${nShelter})`)
  const shRes = readEqsResults(nShelter)
  for (let i = 0; i < shRes.length; i++) {
    const [sx, sy, sz, sc] = shRes[i]
    if (i > 0) assert.ok(sc <= shRes[i - 1][3], 'shelter results must be sorted descending')
    assert.ok(
      sx >= cx + 12 && sx < cx + 36 && sz >= cz - 12 && sz < cz + 12 && sy === standY,
      `shelter ${i} must lie strictly under awning at y=${standY}, got (${sx}, ${sy}, ${sz})`
    )
  }

  const shIters = 40
  const tSh0 = performance.now()
  for (let i = 0; i < shIters; i++) {
    core.eqs_find_shelter(cx, standY, cz, 72)
  }
  var shelterMs = (performance.now() - tSh0) / shIters
  assert.ok(shelterMs < 0.5, `eqs_find_shelter took ${shelterMs.toFixed(3)} ms (gate < 0.5 ms)`)
}

// ── 5. eqs_find_vantage (elevated balcony + parapet beats ground, rejects obstructed roof) ──
core.world_forget()
buildPlaza(cx - 110, cz - 96, cx + 110, cz + 96, baseY, baseY + 180)
{
  const targetX = cx
  const targetZ = cz
  const runs = []

  // Good elevated balcony West of target: x = cx - 72..-48, z = cz - 16..+16, deck y = standY + 38..40 (feet = standY + 40)
  // with a 9-cell waist-high parapet on target edge (x = cx - 50..-48, y = standY + 40..49).
  for (let z = cz - 16; z < cz + 16; z++) {
    runs.push([cx - 72, cx - 48, standY + 38, z, CONCRETE])
    runs.push([cx - 72, cx - 48, standY + 39, z, CONCRETE])
    for (let y = standY + 40; y < standY + 49; y++) {
      runs.push([cx - 50, cx - 48, y, z, BRICK])
    }
  }

  // Higher but OBSTRUCTED roof East of target: x = cx + 48..72, z = cz - 16..+16, deck y = standY + 48..50 (feet = standY + 50),
  // sealed on target-facing West edge by a 26-cell opaque wall!
  for (let z = cz - 16; z < cz + 16; z++) {
    runs.push([cx + 48, cx + 72, standY + 48, z, CONCRETE])
    runs.push([cx + 48, cx + 72, standY + 49, z, CONCRETE])
    for (let y = standY + 50; y < standY + 76; y++) {
      runs.push([cx + 48, cx + 50, y, z, BRICK])
    }
  }
  applyRuns(runs)
  core.nav_bake_area(cx, cz, 2, 64)

  const nVan = core.eqs_find_vantage(cx - 20, standY, cz, targetX, standY, targetZ, 30, 88)
  assert.ok(nVan >= 4, `expected clear vantage spots (got ${nVan})`)
  const vanRes = readEqsResults(nVan)
  assert.equal(vanRes[0][1], standY + 40, `top vantage must be on elevated balcony y=${standY + 40}, got ${vanRes[0][1]}`)
  assert.ok(vanRes[0][0] >= cx - 72 && vanRes[0][0] < cx - 48, `top vantage x should be on balcony, got ${vanRes[0][0]}`)

  for (let i = 0; i < vanRes.length; i++) {
    const [vx, vy, vz, sc] = vanRes[i]
    if (i > 0) assert.ok(sc <= vanRes[i - 1][3], 'vantage results must be sorted descending')
    assert.ok(
      !(vx >= cx + 48 && vx < cx + 72 && vy >= standY + 48),
      `obstructed East roof must be rejected, got (${vx}, ${vy}, ${vz})`
    )
    const d = Math.hypot(vx - targetX, vz - targetZ)
    assert.ok(d >= 29.9 && d <= 88.1, `vantage distance ${d} outside [30, 88]`)
    const losHead = core.perception_los(vx, vy + EYES, vz, targetX, standY + HEAD, targetZ)
    const losChest = core.perception_los(vx, vy + EYES, vz, targetX, standY + CHEST, targetZ)
    assert.ok(losHead === 1 || losChest === 1, `vantage ${i} lacks clear LOS to target`)
  }

  const vanIters = 40
  const tVan0 = performance.now()
  for (let i = 0; i < vanIters; i++) {
    core.eqs_find_vantage(cx - 20, standY, cz, targetX, standY, targetZ, 30, 88)
  }
  var vantageMs = (performance.now() - tVan0) / vanIters
  assert.ok(vantageMs < 0.5, `eqs_find_vantage took ${vantageMs.toFixed(3)} ms (gate < 0.5 ms)`)
}

// ── 6. perception_vision_step (100 agents via SoA buffer, wall occlusion, FOV, LOD Ring 3, < 1.0 ms gate) ──
core.world_forget()
buildPlaza(cx - 160, cz - 160, cx + 160, cz + 160, baseY, baseY + 60)
{
  // Solid brick divider along x = cx..cx+4 separating West and East halves.
  const divRuns = []
  for (let y = standY; y < standY + 32; y++) {
    for (let z = cz - 140; z <= cz + 140; z++) {
      divRuns.push([cx, cx + 4, y, z, BRICK])
    }
  }
  applyRuns(divRuns)

  core.perception_vision_reset()
  const N = 100
  const ptr = core.perception_vision_agents_ptr()
  const soa = new Float32Array(core.memory.buffer, ptr, VISION_CAP * 6)
  for (let i = 0; i < N; i++) {
    const east = i >= 50
    const local = i % 50
    const row = Math.floor(local / 10)
    const col = local % 10
    const x = cx + (east ? 16 + row * 18 : -16 - row * 18)
    const z = cz + (col - 4.5) * 20
    const yaw = east ? -Math.PI / 2 : Math.PI / 2
    const lod = i >= 90 ? 3 : i >= 70 ? 2 : 1
    const flags = i === 0 ? 0 : VISION_FLAG_RULE
    soa[FIELD_X * VISION_CAP + i] = x
    soa[FIELD_Y * VISION_CAP + i] = standY
    soa[FIELD_Z * VISION_CAP + i] = z
    soa[FIELD_YAW * VISION_CAP + i] = yaw
    soa[FIELD_LOD * VISION_CAP + i] = lod
    soa[FIELD_FLAGS * VISION_CAP + i] = flags
  }

  // Warm Ground sector cache once.
  const pairCount = core.perception_vision_step(N, 300)
  assert.ok(pairCount > 200, `expected > 200 same-side visibility pairs (got ${pairCount})`)
  const pairs = readVisionPairs(pairCount)
  for (const [obs, tgt] of pairs) {
    assert.notEqual(obs, tgt, 'self-vision not allowed')
    assert.ok(obs < 90 && tgt < 90, `Ring 3 agents (90..100) must be skipped: (${obs}, ${tgt})`)
    assert.equal(obs < 50, tgt < 50, `brick wall must block cross-side vision: (${obs}, ${tgt})`)
  }

  // Verify IGNORE_ACTORS flag works while preserving actor<->player vision.
  core.perception_vision_reset()
  core.perception_vision_set_agent(0, cx - 30, standY, cz, Math.PI / 2, 1, VISION_FLAG_RULE | VISION_FLAG_IGNORE_ACTORS)
  core.perception_vision_set_agent(1, cx - 10, standY, cz, -Math.PI / 2, 1, VISION_FLAG_RULE)
  core.perception_vision_set_agent(2, cx - 10, standY, cz + 6, -Math.PI / 2, 1, 0) // player
  const flagPairs = readVisionPairs(core.perception_vision_step(3, 200))
  const from0 = flagPairs.filter(([o]) => o === 0).map(([, t]) => t)
  assert.ok(!from0.includes(1), 'IGNORE_ACTORS observer must ignore other rule actors')
  assert.ok(from0.includes(2), 'IGNORE_ACTORS observer must still see player')

  // Restore 100 agents and benchmark WASM vision step.
  core.perception_vision_reset()
  const soa2 = new Float32Array(core.memory.buffer, core.perception_vision_agents_ptr(), VISION_CAP * 6)
  for (let i = 0; i < N; i++) {
    const east = i >= 50
    const local = i % 50
    const row = Math.floor(local / 10)
    const col = local % 10
    soa2[FIELD_X * VISION_CAP + i] = cx + (east ? 16 + row * 18 : -16 - row * 18)
    soa2[FIELD_Y * VISION_CAP + i] = standY
    soa2[FIELD_Z * VISION_CAP + i] = cz + (col - 4.5) * 20
    soa2[FIELD_YAW * VISION_CAP + i] = east ? -Math.PI / 2 : Math.PI / 2
    soa2[FIELD_LOD * VISION_CAP + i] = 1
    soa2[FIELD_FLAGS * VISION_CAP + i] = VISION_FLAG_RULE
  }
  core.perception_vision_step(N, 300) // warm
  const vIters = 20
  const tVis0 = performance.now()
  let lastPairs = 0
  for (let i = 0; i < vIters; i++) {
    lastPairs = core.perception_vision_step(N, 300)
  }
  var visionMs = (performance.now() - tVis0) / vIters
  assert.ok(visionMs < 1.0, `100-agent WASM vision step took ${visionMs.toFixed(3)} ms (gate < 1.0 ms)`)
  var visionPairs = lastPairs
}

console.log(
  `eqs-perception wasm ok: find_cover=${coverMs.toFixed(3)} ms, find_shelter=${shelterMs.toFixed(3)} ms, ` +
    `find_vantage=${vantageMs.toFixed(3)} ms, vision_100=${visionMs.toFixed(3)} ms (${visionPairs} pairs)`
)
