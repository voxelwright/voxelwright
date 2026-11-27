// Regression tests for #129 (iPhone feedback s-mwyy70nl-xye8a):
// 1. Dynamic resolution scaler (`steerScale`) must not slash scale when CPU-bound or sawtooth-thrash on phones.
// 2. Camera `clearWay` deduplicates integer cell probes without missing thin 1-cell walls.
// 3. `trafficObstacleGap` breaks perpendicular mutual deadlocks while preventing overlaps.
// 4. `street()` rejects short road stubs whose endpoint enters a solid building and trims lanes whose width clips a wall.
import assert from 'node:assert/strict'
import { steerScale } from '../page/steer.ts'
import { clearWay } from '../page/eye.ts'
import { street, trafficObstacleGap } from '../page/street.ts'

// ── 1. steerScale: CPU-bound guard, unclocked deadband, GPU-bound backoff, desktop fast-drop ──
{
  // Exact iPhone driving scenario: frameMs 20.5 ms driven by cpuMs 16.5 ms (gpuMs 2 ms, clocked=false).
  const s = { scale: 0.45, held: 0, lateRun: 0, backoffs: 0, sinceDrop: 999 }
  let changes = 0
  for (let i = 0; i < 600; i++) {
    if (steerScale(s, { budget: 16.67, gap: 20.5, frameMs: 20.5, cpuMs: 16.5, gpuMs: 2.0, marchMs: 2.0, clocked: false, calm: false, fixed: false })) changes++
  }
  assert.equal(s.scale, 0.45, 'CPU-bound phone frames must not slash render scale')
  assert.equal(changes, 0, 'CPU-bound phone frames must trigger zero offscreen reallocations')

  // Marginal unclocked frames (17.8 ms, inside 1.04..1.12 deadband): must not sawtooth.
  const sDead = { scale: 0.5, held: 0, lateRun: 0, backoffs: 0, sinceDrop: 999 }
  let deadChanges = 0
  for (let i = 0; i < 600; i++) {
    if (steerScale(sDead, { budget: 16.67, gap: 17.8, frameMs: 17.8, cpuMs: 8.5, gpuMs: 4.0, marchMs: 4.0, clocked: false, calm: false, fixed: false })) deadChanges++
  }
  assert.equal(sDead.scale, 0.5, 'marginal phone frames in deadband keep steady scale')
  assert.equal(deadChanges, 0, 'deadband prevents sawtooth oscillation')

  // Genuine GPU-bound phone frames (frameMs 22 ms, cpuMs 5.5 ms): must back off and hold >= 150 frames cooldown.
  const sGpu = { scale: 0.6, held: 0, lateRun: 0, backoffs: 0, sinceDrop: 999 }
  assert.equal(steerScale(sGpu, { budget: 16.67, gap: 22, frameMs: 22, cpuMs: 5.5, gpuMs: 15, marchMs: 15, clocked: false, calm: false, fixed: false }), true)
  assert.ok(sGpu.scale < 0.6, `GPU-bound phone must back off (got ${sGpu.scale})`)
  assert.ok(sGpu.held >= 150, `phone backoff cooldown must be >= 150 frames (got ${sGpu.held})`)

  // Comfortably fast phone frames (frameMs 16.7 ms, cpuMs 7 ms): smoothly recovers upward.
  sGpu.held = 0
  assert.equal(steerScale(sGpu, { budget: 16.67, gap: 16.7, frameMs: 16.7, cpuMs: 7.0, gpuMs: 4.0, marchMs: 4.0, clocked: false, calm: false, fixed: false }), true)
  assert.ok(sGpu.scale > 0.5, `fast phone frames step scale back up (got ${sGpu.scale})`)

  // Clocked desktop sudden heavy GPU view: fast-drop still triggers on two late frames.
  const sDesk = { scale: 0.8, held: 10, lateRun: 0, backoffs: 0, sinceDrop: 999 }
  steerScale(sDesk, { budget: 16.67, gap: 30, frameMs: 17, cpuMs: 4, gpuMs: 25, marchMs: 28, clocked: true, calm: false, fixed: false })
  const dropped = steerScale(sDesk, { budget: 16.67, gap: 30, frameMs: 20, cpuMs: 4, gpuMs: 28, marchMs: 28, clocked: true, calm: false, fixed: false })
  assert.equal(dropped, true, 'clocked desktop fast-drop triggers on consecutive GPU-late frames')
  assert.ok(sDesk.scale <= 0.5, `desktop fast-drop fits GPU budget (got ${sDesk.scale})`)
}

// ── 2. clearWay: deduplicates integer cells while never skipping a 1-cell wall ──
{
  let probes = 0
  const freeOpen = clearWay(() => { probes++; return false }, [0.2, 50.2, 0.2], [100, 0, 0])
  assert.equal(freeOpen, 1)
  assert.ok(probes <= 125, `clearWay should deduplicate integer cells (got ${probes} probes for 100 cells)`)

  // Thin 1-cell vertical wall at x = 40 (world cell [40, 41)): must always be detected!
  const freeWall = clearWay((x) => Math.floor(x) === 40, [0.5, 50.5, 0.5], [100, 0, 0])
  assert.ok(freeWall > 0.3 && freeWall < 0.4, `clearWay must catch 1-cell wall at x=40 (got free=${freeWall})`)
}

// ── 3. trafficObstacleGap: perpendicular deadlock tie-breaker without allowing overlap ──
{
  // Two stopped cars meeting at ~90 deg with positive clearance (gap ~ 5 cells).
  const a = { x: 0, z: 0, hx: 1, hz: 0, halfL: 23, halfW: 10, v: 0, id: 10 }
  const b = { x: 38, z: 0, hx: 0, hz: 1, halfL: 23, halfW: 10, v: 0, id: 20 }
  const gapA = trafficObstacleGap(a, { x: b.x, z: b.z, hx: b.hx, hz: b.hz, long: b.halfL, wide: b.halfW, v: b.v, id: b.id })
  const gapB = trafficObstacleGap(b, { x: a.x, z: a.z, hx: a.hx, hz: a.hz, long: a.halfL, wide: a.halfW, v: a.v, id: a.id })
  assert.equal(gapA, Infinity, 'lower-id stopped car yields/breaks perpendicular deadlock')
  assert.equal(gapB, Infinity, 'car b is not behind a')

  // If already penetrating (gap <= -2), tie-breaker must NOT allow driving through.
  const bPen = { x: 25, z: 0, hx: 0, hz: 1, long: 23, wide: 10, v: 0, id: 20 }
  const gapPen = trafficObstacleGap(a, bPen)
  assert.ok(gapPen < 0, `penetrating car must still report negative gap (got ${gapPen})`)
}

// ── 4. street() open(r): short building-stub rejection & lane-width building trim ──
{
  const origFetch = globalThis.fetch
  const origWorker = globalThis.Worker
  const origMatchMedia = globalThis.matchMedia
  const origDocument = globalThis.document
  const lifeSquare = {
    walk: [],
    roads: [
      // Short 11.3-cell one-way road stub clear at s=0 (x=0..5), entering solid brick wall at x>=8 (exact 101 1st St failure mode).
      [175507524, 1, 2, 4, 0x39, [], 0, 0, 0, 11.3, 0],
      // Two-way 2-lane road (y=42) running along +X at z=200: lane 0 (off=+16.5 -> z=216.5) is clear; lane 1 (off=+49.5 -> z=249.5) clips brick wall at z>=255 on its right edge (+9).
      [88572905, 3, 4, 2, 0x38, [], 0, 0, 200, 100, 200],
      // Clean open road along +X at z=-200.
      [88572906, 5, 6, 2, 0x39, [], 0, 0, -200, 100, -200],
    ],
    park: [],
    rail: [],
    heads: [],
  }
  globalThis.Worker = class { postMessage() {} terminate() {} }
  globalThis.matchMedia = () => ({ matches: false })
  globalThis.document = { documentElement: { classList: { contains: () => false }, dataset: {} } }
  globalThis.fetch = async (url) => {
    const s = String(url)
    if (s.endsWith('life/index.json')) return new Response(JSON.stringify({ life: { '500.0_4250.0': { path: 'sq.json' } } }), { status: 200 })
    if (s.endsWith('life/sq.json')) return new Response(JSON.stringify(lifeSquare), { status: 200 })
    if (s.endsWith('cars/index.json')) return new Response(JSON.stringify({ cars: [] }), { status: 200 })
    return new Response('{}', { status: 404 })
  }
  try {
    const noopPieces = { add: () => ({ pos: [0, 0, 0], rot: [0, 0, 0, 1], cell: 1, born: { low: [0, 0, 0], com: [0, 0, 0], size: [1, 1, 1], faces: new Uint32Array(0), cells: 0 }, destroy() {} }), refit() {} }
    const noopAlive = { things: [], riding: null, where: () => null, spawn: async () => ({ alive: false }), place() {}, kick() {}, vanish() {}, hit() {}, mount() {} }
    const noopHud = { cue: () => ({ remove() {} }), notice() {} }
    const noopInput = { held: () => false, always: () => () => {} }
    const st = street({
      life: new URL('http://local/life/'),
      cars: new URL('http://local/cars/'),
      land: {
        ground_at: () => 42,
        feet_at: (x, z) => {
          // Building wall at x >= 8 around z=0, and at z >= 255 around z=200.
          if (Math.abs(z) < 80 && x >= 8) return 240
          if (z >= 255) return 240
          return 43
        },
        world_kind: (x, y, z) => {
          if (y >= 43 && Math.abs(z) < 80 && x >= 8) return 8 // BRICK
          if (y >= 43 && z >= 255) return 8 // BRICK
          return 0
        },
        top_at: () => 6,
      },
      hour: () => 12,
      rain: () => 0,
      clock: () => 1000,
      shocks: [],
      bodies: () => [],
      feet: () => null,
      pieces: noopPieces,
      alive: noopAlive,
      hud: noopHud,
      input: noopInput,
    })
    const view = { eye: [0, 60, 0], forward: [1, 0, 0], right: [0, 0, 1], up: [0, 1, 0], tanHalf: 0.7 }
    st.frame(0.016, view)
    await new Promise((r) => setTimeout(r, 25))
    st.frame(0.016, view)
    await new Promise((r) => setTimeout(r, 25))
    st.frame(0.016, view)
    const listed = st.roads(0, 0, 500)
    const stub = listed.find((r) => r.key === '175507524/1/2')
    const trimmed = listed.find((r) => r.key === '88572905/3/4')
    const clean = listed.find((r) => r.key === '88572906/5/6')
    assert.ok(stub, 'short stub road loaded')
    assert.equal(stub.open, false, 'short road stub entering solid building at s=len must be closed (not open)')
    assert.ok(trimmed, 'wall-grazing road loaded')
    assert.equal(trimmed.open, true, 'road with 1 clear lane stays open')
    assert.equal(trimmed.lanes, 1, 'outer lane whose right edge (+9 cells) hits brick wall must be trimmed')
    assert.ok(clean && clean.open && clean.lanes === 2, 'clear 2-lane road remains open with 2 lanes')
  } finally {
    globalThis.fetch = origFetch
    globalThis.Worker = origWorker
    globalThis.matchMedia = origMatchMedia
    globalThis.document = origDocument
  }
}

console.log('iphone-perf-fixes: PASS (steerScale, clearWay, deadlock tie-breaker, short-stub & lane-width building clearance)')
