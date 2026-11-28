// Room-colliding 32^3 volumetric smoke advection tests (#166), Node-runnable with zero GPU contention:
// 1. Ceiling pooling: fire in a sealed room rises to the ceiling, never leaks above it, and spreads laterally beneath it.
// 2. Window venting: opening a hole in one side wall lets pooled smoke vent out into exterior cells.
// 3. Recentering & performance: shifting the grid preserves overlapping smoke, and 20 full 32^3 steps average < 2.0 ms/step.
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { SmokeGrid, SMOKE_CELL_SIZE, SMOKE_GRID_SIZE } from '../page/smoke-grid.ts'

const CELL = SMOKE_CELL_SIZE
const N = SMOKE_GRID_SIZE

// Helper: sealed room in grid coordinates centered around world origin:
// Room interior: ix in [10..21], iy in [8..15], iz in [10..21]
// Solid shell: floor iy=7, ceiling iy=16, walls ix=9, ix=22, iz=9, iz=22.
function makeRoomSampler(windowOpen = false) {
  return (wx, wy, wz) => {
    // Grid centered at (128, 128, 128) -> origin at (0, 0, 0).
    const ix = Math.floor(wx / CELL)
    const iy = Math.floor(wy / CELL)
    const iz = Math.floor(wz / CELL)
    const inBox = ix >= 9 && ix <= 22 && iy >= 7 && iy <= 16 && iz >= 9 && iz <= 22
    if (!inBox) return false
    const onFloor = iy === 7
    const onCeil = iy === 16
    const onWest = ix === 9
    const onEast = ix === 22
    const onNorth = iz === 9
    const onSouth = iz === 22
    // Window opening on the +x (east) wall near the upper half of the room.
    if (windowOpen && onEast && iy >= 12 && iy <= 15 && iz >= 14 && iz <= 17) return false
    return onFloor || onCeil || onWest || onEast || onNorth || onSouth
  }
}

const cellCenter = (i) => (i + 0.5) * CELL

// --- Test 1: Ceiling pooling in a sealed room ---
{
  const grid = new SmokeGrid()
  const sealed = makeRoomSampler(false)
  grid.recenter(128, 128, 128, sealed)
  assert.equal(grid.originX, 0)
  assert.equal(grid.originY, 0)
  assert.equal(grid.originZ, 0)

  // Fire near the floor at room center (ix=15, iy=9, iz=15).
  const fireX = cellCenter(15), fireY = cellCenter(9), fireZ = cellCenter(15)
  const dt = 1 / 20
  for (let s = 0; s < 80; s++) {
    grid.inject(fireX, fireY, fireZ, 1.4, 2.5)
    grid.step(dt, 0, 0)
  }

  // Verify ZERO smoke leaked above the solid ceiling (iy >= 16) or outside the sealed walls.
  let aboveCeiling = 0
  let outsideWalls = 0
  for (let y = 0; y < N; y++) {
    for (let z = 0; z < N; z++) {
      for (let x = 0; x < N; x++) {
        const d = grid.density[x + (z << 5) + (y << 10)]
        if (y >= 16) aboveCeiling += d
        if (x < 10 || x > 21 || z < 10 || z > 21 || y < 8 || y > 15) outsideWalls += d
      }
    }
  }
  assert.equal(aboveCeiling, 0, `smoke must not leak above solid ceiling (got ${aboveCeiling})`)
  assert.equal(outsideWalls, 0, `smoke must stay inside sealed room (got ${outsideWalls})`)

  // Verify smoke rose to the ceiling layer (iy=15) directly above the fire AND spread laterally across the ceiling!
  const centerCeil = grid.sampleAt(cellCenter(15), cellCenter(15), cellCenter(15))
  const lateralPlusX = grid.sampleAt(cellCenter(18), cellCenter(15), cellCenter(15))
  const lateralMinusX = grid.sampleAt(cellCenter(12), cellCenter(15), cellCenter(15))
  const lateralPlusZ = grid.sampleAt(cellCenter(15), cellCenter(15), cellCenter(18))
  const lateralMinusZ = grid.sampleAt(cellCenter(15), cellCenter(15), cellCenter(12))

  assert.ok(centerCeil > 0.15, `smoke must reach ceiling above fire (got ${centerCeil.toFixed(4)})`)
  assert.ok(lateralPlusX > 0.02, `smoke must spread laterally +x beneath ceiling (got ${lateralPlusX.toFixed(4)})`)
  assert.ok(lateralMinusX > 0.02, `smoke must spread laterally -x beneath ceiling (got ${lateralMinusX.toFixed(4)})`)
  assert.ok(lateralPlusZ > 0.02, `smoke must spread laterally +z beneath ceiling (got ${lateralPlusZ.toFixed(4)})`)
  assert.ok(lateralMinusZ > 0.02, `smoke must spread laterally -z beneath ceiling (got ${lateralMinusZ.toFixed(4)})`)

  // Verify samplePuffs returns valid visible puffs inside the room.
  const puffs = grid.samplePuffs(64)
  assert.ok(puffs.length > 10 && puffs.length <= 64, `samplePuffs returns visible cells (${puffs.length})`)
  for (const pf of puffs) {
    assert.ok(pf.y < 16 * CELL, `sampled puff stays below ceiling (y=${pf.y})`)
  }
  console.log(`ok  ceiling pooling: aboveCeiling=0, center=${centerCeil.toFixed(3)}, lateral=[+${lateralPlusX.toFixed(3)}, -${lateralMinusX.toFixed(3)}, +${lateralPlusZ.toFixed(3)}, -${lateralMinusZ.toFixed(3)}], puffs=${puffs.length}`)

  // --- Test 2: Window venting ---
  // Break open the east (+x) window at ix=22, iy=12..15, iz=14..17 and continue stepping!
  const vented = makeRoomSampler(true)
  grid.refreshSolids(vented)
  for (let s = 0; s < 60; s++) {
    grid.inject(fireX, fireY, fireZ, 1.4, 2.5)
    grid.step(dt, 4, 0)
  }

  let exteriorEast = 0
  let exteriorAboveRoof = 0
  for (let y = 0; y < N; y++) {
    for (let z = 0; z < N; z++) {
      for (let x = 23; x < N; x++) {
        exteriorEast += grid.density[x + (z << 5) + (y << 10)]
      }
      // Roof directly above the sealed room interior (x in 10..21) must still block smoke directly through the ceiling.
      if (y === 16) {
        for (let x = 10; x <= 21; x++) {
          exteriorAboveRoof += grid.density[x + (z << 5) + (y << 10)]
        }
      }
    }
  }
  assert.ok(exteriorEast > 0.15, `smoke must vent out through open window into exterior cells (got ${exteriorEast.toFixed(4)})`)
  assert.equal(exteriorAboveRoof, 0, `solid ceiling cells must still hold zero smoke (got ${exteriorAboveRoof})`)
  console.log(`ok  window venting: exteriorEast=${exteriorEast.toFixed(3)}, solidCeiling=0`)

  // --- Recenter preservation check ---
  const beforeShift = grid.sampleAt(cellCenter(15), cellCenter(15), cellCenter(15))
  grid.recenter(128 + 2 * CELL, 128, 128, vented)
  assert.equal(grid.originX, 2 * CELL, 'recenter snaps origin to 8-cell boundary')
  const afterShift = grid.sampleAt(cellCenter(15), cellCenter(15), cellCenter(15))
  assert.ok(Math.abs(afterShift - beforeShift) < 1e-6, `recenter preserves overlapping smoke (${beforeShift} -> ${afterShift})`)
  console.log(`ok  recenter preservation: originX=${grid.originX}, density preserved (${afterShift.toFixed(3)})`)
}

// --- Test 3: Performance benchmark (20 full 32^3 room-fire steps < 2.0 ms/step) ---
{
  const grid = new SmokeGrid()
  const room = makeRoomSampler(true)
  grid.recenter(128, 128, 128, room)
  const fireX = cellCenter(15), fireY = cellCenter(9), fireZ = cellCenter(15)
  // Fill the room and establish full ceiling pooling + venting before timing.
  for (let s = 0; s < 40; s++) {
    grid.inject(fireX, fireY, fireZ, 1.5, 2.5)
    grid.step(1 / 30, 4, 0)
  }
  const STEPS = 20
  const t0 = performance.now()
  for (let s = 0; s < STEPS; s++) {
    grid.inject(fireX, fireY, fireZ, 1.5, 2.5)
    grid.step(1 / 30, 4, 0)
  }
  const avgMs = (performance.now() - t0) / STEPS
  assert.ok(avgMs < 2.0, `32^3 SmokeGrid step must average < 2.0 ms/step (got ${avgMs.toFixed(3)} ms/step)`)
  console.log(`ok  performance: ${STEPS} populated-room steps averaged ${avgMs.toFixed(3)} ms/step (active=${grid.activeCount}, < 2.0 ms budget)`)
}
