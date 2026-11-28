// Regression tests for #129 (iPhone feedback s-mwyy70nl-xye8a):
// 1. Dynamic resolution scaler (`steerScale`) must not slash scale when CPU-bound or sawtooth-thrash on phones.
// 2. Camera `clearWay` deduplicates integer cell probes without missing thin 1-cell walls.
// 3. `trafficObstacleGap` breaks perpendicular mutual deadlocks while preventing overlaps.
// 4. `street()` rejects short road stubs whose endpoint enters a solid building and trims lanes whose width clips a wall.
import assert from 'node:assert/strict'
import { steerScale } from '../page/steer.ts'
import { clearWay } from '../page/eye.ts'
import { street, trafficObstacleGap, stepDeepensOverlap } from '../page/street.ts'
import { createRecorder } from '../page/recorder.ts'

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

  // #155 iPhone swapchain-wait scenario: total cpuMs is 29.3 ms because getCurrentTexture() blocks on Metal,
  // but real main-thread workCpuMs is 7.3 ms -> MUST scale down from 1.0 instead of locking at 1.0.
  const sSwap = { scale: 1.0, held: 0, lateRun: 0, backoffs: 0, sinceDrop: 999 }
  assert.equal(
    steerScale(sSwap, { budget: 16.67, gap: 35, frameMs: 35.3, cpuMs: 29.3, workCpuMs: 7.3, gpuMs: 6.7, marchMs: 6.7, clocked: false, calm: false, fixed: false }),
    true,
    'GPU swapchain wait in cpuMs must not block render-scale backoff when workCpuMs is low (#155)',
  )
  assert.ok(sSwap.scale < 1.0, `scale must drop below 1.0 on GPU-bound phone frames (got ${sSwap.scale})`)
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

  // #155 Columbus Ave corner-sweep overlap: city bus in lane 2 bending onto a turn sweeps into stopped grey saloon in lane 1.
  const saloon = { x: 522249.6, z: 664522.9, heading: -0.156, halfL: 23.5, halfW: 10.5 }
  const busBefore = { x: 522257.0, z: 664556.0, heading: -0.156, halfL: 55, halfW: 13 }
  const busTurning = { x: 522260.8, z: 664554.4, heading: -0.78, halfL: 55, halfW: 13 }
  assert.equal(stepDeepensOverlap(busBefore, busTurning, saloon), true, 'turning bus sweeping into adjacent-lane saloon must be blocked (#155)')
  const busStraight = { x: 522261.0, z: 664555.4, heading: -0.156, halfL: 55, halfW: 13 }
  assert.equal(stepDeepensOverlap(busBefore, busStraight, saloon), false, 'parallel bus staying in lane 2 must not be blocked')
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

// ── 5. recorder.onPresented: async JPEG capture capped on longest edge (#155) ──
{
  const origDoc = globalThis.document
  const origFR = globalThis.FileReader
  let outW = 0, outH = 0, blobMime = '', syncResolved = false
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, 'canvas')
      return {
        set width(v) { outW = v },
        set height(v) { outH = v },
        getContext() { return { drawImage() {} } },
        toBlob(cb, mime) { blobMime = mime; cb({ size: 42 }) },
      }
    },
  }
  globalThis.FileReader = class {
    readAsDataURL() { this.result = 'data:image/jpeg;base64,AA=='; this.onload?.() }
  }
  try {
    const rec = createRecorder({
      build: 'test', localRealm: null, bay: false,
      env: () => ({}), release: async () => null, gpuFaults: () => [],
      input: { top: 'play', held: () => false, stick: [0, 0] },
      pose: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 }, fov: () => 60,
      view: () => ({ eye: [0, 0, 0], forward: [0, 0, 1], right: [1, 0, 0], up: [0, 1, 0], tanHalf: 0.5 }),
      march: { pick: async () => null },
      me: { on: false, feet: null, aloft: false, canopy: false },
      alive: { riding: null, things: [], where: () => null, telemetry: null, damage: () => null },
      street: () => null,
      worldStats: () => ({ wanted: 0, stale: 0, ready: 0, poolUsed: 0, poolWords: 1, full: 0, crashed: 0 }),
      mended: () => ({ movers: 0, makers: 0 }), tileFails: () => 0,
      perf: () => ({ frameMs: 16.7, gpuMs: 4, cpuMs: 12, workCpuMs: 6, presentWaitMs: 6, scale: 1, bodies: 0, loose: 0, burning: 0, resting: false, paused: false, mapOpen: false, firstStill: false }),
      settings: () => ({ hour: 12, rain: 0, fog: 0, graphics: 'high', hud: null }),
      clock: () => 0, groundAt: () => 0, topAt: () => 0, worldKind: () => 0, whereLabel: () => '',
      endpointBase: null,
    })
    const p = rec.captureCanvas(960).then((u) => { syncResolved = true; return u })
    rec.onPresented({ width: 1320, height: 2265 })
    assert.equal(syncResolved, false, 'feedback screenshot encode must yield out of onPresented (no sync rAF stall)')
    const url = await p
    assert.equal(url, 'data:image/jpeg;base64,AA==')
    assert.equal(blobMime, 'image/jpeg', 'feedback screenshot must encode as JPEG (no iOS WebP->double-PNG fallback)')
    assert.ok(Math.max(outW, outH) === 960 && outW < 600, `portrait 1320x2265 must cap longest edge to 960 (got ${outW}x${outH})`)
  } finally {
    globalThis.document = origDoc
    globalThis.FileReader = origFR
  }
}

console.log('iphone-perf-fixes: PASS (steerScale, clearWay, deadlock tie-breaker, short-stub & lane-width building clearance, corner-sweep overlap, async JPEG capture)')
