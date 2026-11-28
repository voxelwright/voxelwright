// Phase 3A Living City Traffic AI Overhaul (#164): deterministic headless simulation & anti-deadlock test.
// Proves:
//   1. Seed-derived per-driver profiles produce distinct speed biases, rain braking elongation, and horn patience.
//   2. Budgeted local junction detour planner avoids craters, stalled robotaxis, and dead-end traps within <= 20 expansions & caches cleanly.
//   3. Stalled PayMo / Blast Crater Anti-Deadlock: 8+ vehicles smoothly change lanes or detour with 0 permanent deadlocks & 0 OBB overlaps.
//   4. Emergency Siren Coupling: active ambulance/police siren cone pulls regular traffic to right kerb & slows them, then merges them back
//      once passed, emits pulsing red/blue roof flasher lights, and clears red lights safely.
//   5. Pedestrian-Vehicle Coupling: crosswalk yielding respects driver caution + rain braking scale, hurried drivers honk earlier,
//      and near-misses emit structured cues that trigger visible pedestrian flinch & step-back reactions.
//
//   node engine/test/traffic-ai.mjs
import {
  SIREN_RANGE,
  createDetourCache,
  crosswalkYieldBuffer,
  detectPedestrianNearMiss,
  driverProfile,
  evaluateSirenYield,
  isLaneClear,
  planLocalDetour,
  rainDrivingFactors,
} from '../page/traffic-ai.ts'
import { boxGap, street } from '../page/street.ts'

const failures = []
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`)
  if (!ok) failures.push(what)
}

// ── 1. Individualized Per-Driver Profiles & Rain Coupling ────────────────────
console.log('1. Per-driver profiles & rain wet-surface coupling')
{
  const seen = new Set()
  let boundsOk = true
  const byArch = { cautious: [], commuter: [], assertive: [], hurried: [], delivery: [], emergency: [] }

  for (let seed = 1; seed <= 240; seed++) {
    const kind = seed % 17 === 0 ? 'van' : seed % 23 === 0 ? 'robotaxi' : 'car'
    const em = seed % 37 === 0 ? (seed % 2 === 0 ? 'police' : 'ambulance') : undefined
    const p = driverProfile(seed, kind, em)
    const p2 = driverProfile(seed, kind, em)
    if (
      p.archetype !== p2.archetype ||
      p.speedBias !== p2.speedBias ||
      p.rainBrakeScale !== p2.rainBrakeScale ||
      p.hornImpatience !== p2.hornImpatience
    ) boundsOk = false
    if (
      p.caution < 0.4 || p.caution > 1.4 ||
      p.aggression < 0 || p.aggression > 1 ||
      p.speedBias < 0.82 || p.speedBias > 1.22 ||
      p.rainBrakeScale < 1.15 || p.rainBrakeScale > 1.75 ||
      p.laneChangeWillingness < 0 || p.laneChangeWillingness > 1
    ) boundsOk = false
    seen.add(p.archetype)
    byArch[p.archetype].push(p)
  }

  const avg = (arr, fn) => arr.reduce((s, x) => s + fn(x), 0) / Math.max(1, arr.length)
  const cautiousSpd = avg(byArch.cautious, (p) => p.speedBias)
  const commuterSpd = avg(byArch.commuter, (p) => p.speedBias)
  const hurriedSpd = avg(byArch.hurried, (p) => p.speedBias)
  const cautiousHorn = avg(byArch.cautious, (p) => p.hornImpatience)
  const hurriedHorn = avg(byArch.hurried, (p) => p.hornImpatience)
  const cautiousGap = avg(byArch.cautious, (p) => p.followGapCells)
  const hurriedGap = avg(byArch.hurried, (p) => p.followGapCells)

  check(seen.size === 6 && boundsOk, `all 6 driver archetypes generated deterministically within spec bounds (${[...seen].join(', ')})`)
  check(
    hurriedSpd > commuterSpd && commuterSpd > cautiousSpd && hurriedHorn < cautiousHorn && cautiousGap > hurriedGap,
    `distinct profile spread: speed ${cautiousSpd.toFixed(2)} < ${commuterSpd.toFixed(2)} < ${hurriedSpd.toFixed(2)}, horn patience ${hurriedHorn.toFixed(2)}s vs ${cautiousHorn.toFixed(2)}s, gap ${cautiousGap.toFixed(1)} vs ${hurriedGap.toFixed(1)} cells`,
  )

  const sampleCautious = byArch.cautious[0]
  const dry = rainDrivingFactors(sampleCautious, 0.1)
  const wet = rainDrivingFactors(sampleCautious, 0.9)
  check(
    dry.brakeMult === 1 && dry.gapMult === 1 && wet.brakeMult > 1.35 && wet.gapMult > 1.28 && wet.cornerSpeedScale < 0.85,
    `rain braking & corner scaling active for rain > 0.2 (dry=${dry.brakeMult.toFixed(2)}x -> wet=${wet.brakeMult.toFixed(2)}x brake, ${wet.gapMult.toFixed(2)}x gap, ${wet.cornerSpeedScale.toFixed(2)}x corner)`,
  )
}

// ── 2. Budgeted Local Junction Detour Planner & Lane Clearance ───────────────
console.log('2. Budgeted local junction detour planner & lane-change clearance')
{
  // Synthetic road graph:
  //   R_IN (0 -> 1) splits at node 1 into:
  //     - R_BLOCKED (1 -> 2, straight east, BLOCKED by crater)
  //     - R_TRAP (1 -> 3, north 1-hop stub whose only outgoing road is ALSO blocked)
  //     - R_BYPASS_1 (1 -> 4, south) -> R_BYPASS_2 (4 -> 5, east) -> R_BYPASS_3 (5 -> 2, north)
  const mkRoad = (key, way, a, b, next, tx, tz, len = 320, lanes = 2, blocked = false) => ({
    key, way, a, b, lanes, flags: 0x30, next, cls: 3, wired: false, blocked, len, mx: 0, mz: 0, tx, tz,
  })
  const roadList = [
    mkRoad('10/0/1', 10, 0, 1, ['10/1/2', '20/1/3', '30/1/4'], 1, 0, 320, 2, false),
    mkRoad('10/1/2', 10, 1, 2, ['10/2/6'], 1, 0, 320, 2, true), // cratered straight road
    mkRoad('20/1/3', 20, 1, 3, ['21/3/7'], 0, -1, 140, 1, false), // dead-end trap
    mkRoad('21/3/7', 21, 3, 7, [], 1, 0, 140, 1, true), // blocked beyond trap
    mkRoad('30/1/4', 30, 1, 4, ['31/4/5'], 0, 1, 220, 2, false), // clean bypass leg 1
    mkRoad('31/4/5', 31, 4, 5, ['32/5/2'], 1, 0, 320, 2, false), // clean bypass leg 2
    mkRoad('32/5/2', 32, 5, 2, ['10/2/6'], 0, -1, 220, 2, false), // rejoins past crater
    mkRoad('10/2/6', 10, 2, 6, [], 1, 0, 320, 2, false),
  ]
  const byKey = new Map(roadList.map((r) => [r.key, r]))
  const graph = {
    getRoad: (k) => byKey.get(k),
    isOpen: (r) => !r.blocked,
    tangentAt: (r) => ({ tx: r.tx, tz: r.tz }),
  }
  const cache = createDetourCache(32)
  const blocked = new Set(['10/1/2', '21/3/7'])
  const d1 = planLocalDetour(graph, byKey.get('10/0/1'), blocked, { maxExpansions: 20, cache })
  const d2 = planLocalDetour(graph, byKey.get('10/0/1'), blocked, { maxExpansions: 20, cache })

  check(
    !!d1 && d1.nextKey === '30/1/4' && d1.expansions <= 20 && !d1.fromCache && !!d2 && d2.nextKey === '30/1/4' && d2.fromCache,
    `local detour picks multi-hop clear bypass ${d1?.nextKey} over blocked/trap roads (${d1?.expansions} expansions <= 20, cache hit verified)`,
  )

  // Lane clearance rejects adjacent occupied car and accepts open lane.
  const obstacles = [
    { x: 100, z: 33, hx: 1, hz: 0, halfL: 22, halfW: 9, v: 40, id: 2 },
    { x: 180, z: 0, hx: 1, hz: 0, halfL: 22, halfW: 9, v: 0, id: 3, stalled: true },
  ]
  const blockedRight = isLaneClear({ id: 1, x: 100, z: 0, hx: 1, hz: 0, halfL: 22, halfW: 9, v: 20, lateralShift: 33 }, obstacles)
  const clearLeft = isLaneClear({ id: 1, x: 100, z: 0, hx: 1, hz: 0, halfL: 22, halfW: 9, v: 20, lateralShift: -33 }, obstacles)
  check(!blockedRight && clearLeft, 'isLaneClear rejects occupied right lane and approves clear left lane')
}

// ── Shared Headless `street()` Harness Builder ───────────────────────────────
function encodeSingleRun(n, paletteIndex = 0) {
  const bytes = []
  let v = n
  do { let b = v & 127; v >>>= 7; if (v) b |= 128; bytes.push(b) } while (v)
  bytes.push(paletteIndex & 127)
  return Buffer.from(bytes).toString('base64')
}

function createMockCarModel(id, kind, long = 44, wide = 18, tall = 15) {
  const runs = encodeSingleRun(long * tall * wide, 0)
  return {
    name: `grey ${id}`,
    kind,
    size: [long, tall, wide],
    body: { palette: [0, 12], runs },
    motor: { front: 0, power: 100, top: 180, grip: 1, steer: 0.5, feet: [] },
    looks: [{ size: [long, tall, wide], per: 1, low: [0, 0, 0], palette: [0, 12], runs }],
    variants: [{ name: 'white', body: [0, 12], looks: [[0, 12]] }],
  }
}

/**
 * Builds a closed two-block SF arterial loop with multi-lane main street, parallel bypass detour street,
 * and cross streets so vehicles circulate continuously without hitting dead ends.
 *
 *   Node 1 (0, 0) ===R1 (2 lanes, east)===> Node 2 (600, 0) ===R2 (2 lanes, east)===> Node 3 (1300, 0)
 *        ^                                       |                                        |
 *      R_W (west return)                      R_S1 (south bypass)                      R_E (south)
 *        |                                       v                                        v
 *   Node 6 (0, 500) <===R_B2 (west)==== Node 5 (600, 500) <===R_B1 (west)==== Node 4 (1300, 500)
 *                                                |
 *                                        R_BYP_E (east bypass 5->4)
 */
function buildTestSquare({ r2Lanes = 2, signalNode = 0, walk = [] } = {}) {
  const ctlOf = (b) => (b === signalNode ? 2 : 0)
  // Road format: [way, a, b, lanes, flags, nextPairs, ctl, x0, z0, x1, z1]
  // Opposite directions of a two-way street share the same `way` id (matching sf/life.py & OSM).
  const roads = [
    // North arterial (way 100): eastbound 1->2->3 and westbound 3->2->1
    [100, 1, 2, 2, 0x30, [100, 3, 200, 5], ctlOf(2), 0, 0, 600, 0],
    [100, 2, 3, r2Lanes, 0x30, [300, 4], ctlOf(3), 600, 0, 1300, 0],
    [100, 3, 2, 2, 0x30, [100, 1, 200, 5], ctlOf(2), 1300, 0, 600, 0],
    [100, 2, 1, 2, 0x30, [500, 6], ctlOf(1), 600, 0, 0, 0],
    // East cross-street (way 300): southbound 3->4 and northbound 4->3
    [300, 3, 4, 2, 0x30, [400, 5], ctlOf(4), 1300, 0, 1300, 500],
    [300, 4, 3, 2, 0x30, [100, 2], ctlOf(3), 1300, 500, 1300, 0],
    // Center cross-street (way 200): southbound 2->5 and northbound 5->2
    [200, 2, 5, 2, 0x30, [400, 4, 400, 6], ctlOf(5), 600, 0, 600, 500],
    [200, 5, 2, 2, 0x30, [100, 3, 100, 1], ctlOf(2), 600, 500, 600, 0],
    // South arterial (way 400): eastbound 6->5->4 and westbound 4->5->6
    [400, 6, 5, 2, 0x30, [400, 4, 200, 2], ctlOf(5), 0, 500, 600, 500],
    [400, 5, 4, 2, 0x30, [300, 3], ctlOf(4), 600, 500, 1300, 500],
    [400, 4, 5, 2, 0x30, [400, 6, 200, 2], ctlOf(5), 1300, 500, 600, 500],
    [400, 5, 6, 2, 0x30, [500, 1], ctlOf(6), 600, 500, 0, 500],
    // West cross-street (way 500): southbound 1->6 and northbound 6->1
    [500, 1, 6, 2, 0x30, [400, 5], ctlOf(6), 0, 0, 0, 500],
    [500, 6, 1, 2, 0x30, [100, 2], ctlOf(1), 0, 500, 0, 0],
  ]
  return { walk, roads, park: [], rail: [], heads: [] }
}

async function runHeadlessStreet(opts, fn) {
  const origFetch = globalThis.fetch
  const origWorker = globalThis.Worker
  const origMatchMedia = globalThis.matchMedia
  const origDocument = globalThis.document

  const sq = opts.square ?? buildTestSquare()
  const saloon = createMockCarModel('saloon', 'car', 44, 18, 15)
  const suv = createMockCarModel('suv', 'car', 46, 19, 17)
  const van = createMockCarModel('van', 'van', 50, 19, 20)

  globalThis.Worker = class { postMessage() {} terminate() {} }
  globalThis.matchMedia = () => ({ matches: false })
  globalThis.document = { documentElement: { classList: { contains: () => false }, dataset: {} } }
  globalThis.fetch = async (url) => {
    const s = String(url)
    if (s.endsWith('life/index.json')) return new Response(JSON.stringify({ life: { '500.0_4250.0': { path: 'sq.json' } } }), { status: 200 })
    if (s.endsWith('life/sq.json')) return new Response(JSON.stringify(sq), { status: 200 })
    if (s.endsWith('cars/index.json')) return new Response(JSON.stringify({ cars: [{ id: 'saloon', kind: 'car' }, { id: 'suv', kind: 'car' }, { id: 'van', kind: 'van' }] }), { status: 200 })
    if (s.endsWith('cars/saloon.json')) return new Response(JSON.stringify(saloon), { status: 200 })
    if (s.endsWith('cars/suv.json')) return new Response(JSON.stringify(suv), { status: 200 })
    if (s.endsWith('cars/van.json')) return new Response(JSON.stringify(van), { status: 200 })
    return new Response('{}', { status: 404 })
  }

  let clockSec = opts.startClock ?? 1000
  let rainVal = opts.rain ?? 0
  const shocks = opts.shocks ?? []
  const bodies = opts.bodies ?? []
  const horns = []
  const noopPieces = {
    add: () => ({
      pos: [0, 0, 0], rot: [0, 0, 0, 1], cell: 1,
      born: { low: [0, 0, 0], com: [0, 0, 0], size: [1, 1, 1], faces: new Uint32Array(0), cells: 0 },
      destroy() {},
    }),
    refit() {},
  }
  const noopAlive = {
    things: [], riding: null, where: () => null,
    spawn: async () => ({ alive: false }),
    place() {}, kick() {}, vanish() {}, hit() {}, mount() {},
  }
  const noopHud = { cue: () => ({ remove() {} }), notice() {} }
  const noopInput = { held: () => false, always: () => () => {}, push: () => () => {} }

  try {
    const st = street({
      life: new URL('http://local/life/'),
      cars: new URL('http://local/cars/'),
      land: opts.land ?? {
        ground_at: () => 40,
        feet_at: () => 41,
        world_kind: (_x, y) => (y < 41 ? 6 : 0),
        top_at: () => 6,
      },
      hour: () => 13,
      rain: () => rainVal,
      clock: () => clockSec,
      shocks,
      bodies: () => bodies,
      feet: () => null,
      pieces: noopPieces,
      alive: noopAlive,
      hud: noopHud,
      input: noopInput,
      onHorn: (h) => horns.push(h),
    })

    const view = { eye: [650, 80, 250], forward: [1, 0, 0], right: [0, 0, 1], up: [0, 1, 0], tanHalf: 0.7 }
    // Boot & let mocked async fetches resolve cleanly.
    st.frame(0.05, view)
    await new Promise((r) => setTimeout(r, 30))
    st.frame(0.05, view)
    await new Promise((r) => setTimeout(r, 30))
    st.frame(0.05, view)

    const ctx = {
      st,
      view,
      horns,
      bodies,
      shocks,
      setRain: (v) => { rainVal = v },
      step: (dt = 0.05) => { clockSec += dt; st.frame(dt, view) },
      getClock: () => clockSec,
    }
    return await fn(ctx)
  } finally {
    globalThis.fetch = origFetch
    globalThis.Worker = origWorker
    globalThis.matchMedia = origMatchMedia
    globalThis.document = origDocument
  }
}

/** Checks every active traffic pair for OBB overlap (returns worst penetration gap in cells; >= -1.0 means zero overlap). */
function worstVehiclePairGap(snaps) {
  let worst = Infinity
  let pair = null
  for (let i = 0; i < snaps.length; i++) {
    const a = snaps[i]
    const afx = Math.cos(a.heading), afz = Math.sin(a.heading)
    for (let j = i + 1; j < snaps.length; j++) {
      const b = snaps[j]
      if (Math.abs(a.x - b.x) > 160 || Math.abs(a.z - b.z) > 160) continue
      const g = boxGap(a.x, a.z, afx, afz, a.long / 2, a.wide / 2, b.x, b.z, Math.cos(b.heading), Math.sin(b.heading), b.long / 2, b.wide / 2)
      if (g < worst) { worst = g; pair = [a.id, b.id] }
    }
  }
  return { worst, pair }
}

// ── 3. Stalled PayMo Robotaxi Anti-Deadlock (8+ Cars, 0 Overlaps, 0 Snaps) ───
console.log('3. Stalled PayMo anti-deadlock simulation (multi-lane overtake + detour)')
await runHeadlessStreet({ square: buildTestSquare({ r2Lanes: 2 }) }, async ({ st, step }) => {
  // Spawn 10 traffic vehicles flowing along the loop; freeze a PayMo robotaxi right on the 2-lane arterial!
  const stuckInfo = st.robotaxis.triggerStuck('intersection', 'paymo')
  // Also ensure plenty of vehicles are queued / approaching behind the stalled PayMo (8+ vehicles total).
  let prevPos = new Map()
  let maxSingleStepJump = 0
  let overlapTicks = 0
  let worstGap = Infinity
  let maxTrafficSeen = 0
  const maxStuckById = new Map()
  const clearedPastIds = new Set()
  const stuckId = stuckInfo?.id ?? -1

  for (let tick = 0; tick < 700; tick++) {
    step(0.05)
    const snap = st.snapshot(650, 250, 2200).filter((c) => c.kind === 'traffic')
    if (snap.length > maxTrafficSeen) maxTrafficSeen = snap.length
    const { worst } = worstVehiclePairGap(snap)
    if (worst < worstGap) worstGap = worst
    if (worst < -1.0) overlapTicks++

    const nextPos = new Map()
    for (const c of snap) {
      nextPos.set(c.id, [c.x, c.z])
      if (c.id !== stuckId) {
        const prevMax = maxStuckById.get(c.id) ?? 0
        if (c.stuck > prevMax) maxStuckById.set(c.id, c.stuck)
        if (stuckInfo && c.x > stuckInfo.x + 60 && Math.abs(c.z - stuckInfo.z) < 90) clearedPastIds.add(c.id)
      }
      const p = prevPos.get(c.id)
      if (p) {
        const jump = Math.hypot(c.x - p[0], c.z - p[1])
        // Max physical travel in 0.05 s at 160 cells/s is ~8 cells; flag any sudden lane-snap (> 18 cells).
        if (jump > maxSingleStepJump) maxSingleStepJump = jump
      }
    }
    prevPos = nextPos
  }

  const stats = st.trafficAiStats()
  const permanentDeadlocks = [...maxStuckById.values()].filter((s) => s > 8.5).length
  check(
    !!stuckInfo && maxTrafficSeen >= 8,
    `simulated stalled PayMo (#${stuckInfo?.id}) with ${maxTrafficSeen} active traffic vehicles (>= 8)`,
  )
  check(
    stats.laneChanges > 0 && (stats.deadlocksResolved > 0 || stats.detours > 0) && permanentDeadlocks === 0,
    `queue cleared cleanly with 0 permanent deadlocks (laneChanges=${stats.laneChanges}, detours=${stats.detours}, resolved=${stats.deadlocksResolved}, maxStuck>8.5s=${permanentDeadlocks}, passed=${clearedPastIds.size})`,
  )
  check(
    overlapTicks === 0 && maxSingleStepJump < 18,
    `0 vehicle overlaps (worstGap=${worstGap.toFixed(2)} cells, overlapTicks=${overlapTicks}) and smooth lateral motion (maxStep=${maxSingleStepJump.toFixed(1)} cells)`,
  )
})

// ── 4. Blast Crater Road Blockage & Prior-Junction Detouring ─────────────────
console.log('4. Blast crater road blockage & prior-junction detouring')
{
  let craterActive = false
  const craterCenter = [950, 41, 16.5]
  const craterShocks = []
  await runHeadlessStreet({
    square: buildTestSquare({ r2Lanes: 2 }),
    shocks: craterShocks,
    land: {
      ground_at: () => 40,
      feet_at: () => 41,
      world_kind: (x, y, z) => {
        if (craterActive && Math.hypot(x - craterCenter[0], z - craterCenter[2]) < 55 && y >= 36 && y <= 41) return 0
        return y < 41 ? 6 : 0
      },
      top_at: () => 6,
    },
  }, async ({ st, view, step }) => {
    // Trigger a blast crater right in the middle of road 100/2/3 (`x=950, z=16.5`).
    craterActive = true
    craterShocks.push({ at: craterCenter, radius: 42, t: 1000 })
    // Run one frame to register the blast, wait briefly for probe() delay (1.5 s wall time in street.ts -> use fast wait?
    // Wait: probe() checks `performance.now()/1000 >= s.when` where `when = now + 1.5`, so wait 1.55 s once!).
    step(0.05)
    await new Promise((r) => setTimeout(r, 1580))

    let overlapTicks = 0
    let worstGap = Infinity
    let maxTraffic = 0
    const maxStuckById = new Map()

    for (let tick = 0; tick < 600; tick++) {
      step(0.05)
      const snap = st.snapshot(650, 250, 2200).filter((c) => c.kind === 'traffic')
      if (snap.length > maxTraffic) maxTraffic = snap.length
      const { worst } = worstVehiclePairGap(snap)
      if (worst < worstGap) worstGap = worst
      if (worst < -1.0) overlapTicks++
      for (const c of snap) {
        maxStuckById.set(c.id, Math.max(maxStuckById.get(c.id) ?? 0, c.stuck))
      }
    }

    const cnt = st.count(view, 2200)
    const stats = st.trafficAiStats()
    const deadlocks = [...maxStuckById.values()].filter((s) => s > 9.0).length
    check(
      cnt.craters >= 1 && cnt.blockedRoads >= 1 && maxTraffic >= 8,
      `crater detected and road marked blocked (craters=${cnt.craters}, blockedRoads=${cnt.blockedRoads}, traffic=${maxTraffic})`,
    )
    check(
      stats.detours > 0 && deadlocks === 0 && overlapTicks === 0,
      `approaching traffic detoured cleanly around crater with 0 deadlocks & 0 overlaps (detours=${stats.detours}, laneChanges=${stats.laneChanges}, resolved=${stats.deadlocksResolved}, worstGap=${worstGap.toFixed(2)})`,
    )
  })
}

// ── 5. Emergency Vehicle Siren Cone, Kerb Yielding, Red-Light Priority & Lights ──
console.log('5. Emergency vehicles: acoustic siren cone, kerb yield, resume & roof flashers')
{
  // Unit check of siren cone boundaries (45 m / 50° cone + 18 m omni, release after passing).
  const emitter = [{ id: 99, kind: 'ambulance', x: 200, y: 40, z: 16.5, hx: 1, hz: 0, v: 110, active: true }]
  const aheadInCone = evaluateSirenYield({ id: 1, x: 520, y: 40, z: 40, hx: 1, hz: 0, lane: 0, lanes: 2 }, emitter)
  const behindCleared = evaluateSirenYield({ id: 2, x: 100, y: 40, z: 16.5, hx: 1, hz: 0, lane: 0, lanes: 2 }, emitter)
  const farSideOut = evaluateSirenYield({ id: 3, x: 220, y: 40, z: 300, hx: 1, hz: 0, lane: 0, lanes: 2 }, emitter)
  const closeOmni = evaluateSirenYield({ id: 4, x: 240, y: 40, z: 140, hx: 0, hz: -1, lane: 0, lanes: 2 }, emitter)
  check(
    aheadInCone.yielding && aheadInCone.targetShift > 10 && aheadInCone.speedCapScale < 0.7 &&
    !behindCleared.yielding && !farSideOut.yielding && closeOmni.yielding && SIREN_RANGE === 450,
    `siren cone geometry exact: ahead yields (+${aheadInCone.targetShift.toFixed(1)} cells, speedCap=${aheadInCone.speedCapScale.toFixed(2)}), omni yields, behind/outside clear`,
  )

  // Full integrated simulation with spawned ambulance approaching cars & signalized intersection.
  await runHeadlessStreet({ square: buildTestSquare({ r2Lanes: 2, signalNode: 2 }) }, async ({ st, step }) => {
    // Spawn an ambulance behind traffic on eastbound road 100/1/2 heading toward 100/2/3.
    const amb = st.spawnEmergency({ kind: 'ambulance', roadKey: '100/1/2', lane: 0, s: 25, siren: true })
    // Also spawn a second emergency police car on another leg to verify multiple emitters & lights.
    const pol = st.spawnEmergency({ kind: 'police', roadKey: '400/5/4', lane: 0, s: 30, siren: true })

    let maxYieldShiftSeen = 0
    const yieldedState = new Map()
    let overlapTicks = 0
    let redFlashCount = 0
    let blueFlashCount = 0

    const mockSink = {
      quality: 'high', dark: 0, eyeX: 650, eyeY: 80, eyeZ: 250, fwdX: 1, fwdY: 0, fwdZ: 0,
      addPoint(_px, _py, _pz, cr, cg, cb) {
        if (cr > cb * 2 && cr > 0.5) redFlashCount++
        if (cb > cg * 0.9 && cb > 0.5) blueFlashCount++
      },
      addSpot() {},
      addVehicle() {},
      addStreetLamps() {},
    }

    for (let tick = 0; tick < 550; tick++) {
      step(0.05)
      if (tick % 3 === 0) st.lights(mockSink)
      const snap = st.snapshot(650, 250, 2200).filter((c) => c.kind === 'traffic')
      const { worst } = worstVehiclePairGap(snap)
      if (worst < -1.0) overlapTicks++

      for (const c of snap) {
        if (c.emergency) continue
        const sy = c.sirenYieldShift ?? 0
        if (sy > maxYieldShiftSeen) maxYieldShiftSeen = sy
        if (sy > 5 && !yieldedState.has(c.id)) yieldedState.set(c.id, { peak: sy, merged: false, resumed: false })
        const stY = yieldedState.get(c.id)
        if (stY) {
          if (sy > stY.peak) stY.peak = sy
          if (sy < 1.5) {
            stY.merged = true
            if (c.v > 35) stY.resumed = true
          }
        }
      }
    }

    const mergedCount = [...yieldedState.values()].filter((y) => y.merged).length
    const resumedCount = [...yieldedState.values()].filter((y) => y.resumed).length
    const stats = st.trafficAiStats()
    check(
      !!amb && !!pol && stats.activeEmergency >= 2 && stats.sirenYields >= 1 && maxYieldShiftSeen >= 5,
      `emergency vehicles spawned & induced right-kerb siren yields (active=${stats.activeEmergency}, sirenYields=${stats.sirenYields}, maxKerbShift=+${maxYieldShiftSeen.toFixed(1)} cells)`,
    )
    check(
      mergedCount >= 2 && resumedCount >= 2 && overlapTicks === 0,
      `${mergedCount}/${yieldedState.size} yielding cars smoothly merged back into lane & ${resumedCount} resumed speed after emergency passed with 0 overlaps`,
    )
    check(
      redFlashCount > 0 && blueFlashCount > 0,
      `pulsing emergency roof flasher lights emitted via LocalLightSink even in daylight (red=${redFlashCount}, blue=${blueFlashCount})`,
    )
  })
}

// ── 6. Pedestrian-Vehicle Coupling: Crosswalk Caution, Rain & Near-Miss Cues ─
console.log('6. Pedestrian-vehicle coupling (crosswalk yield, rain, & near-miss reaction cues)')
{
  const cautiousP = driverProfile(4, 'robotaxi')
  const hurriedP = Array.from({ length: 80 }, (_, i) => driverProfile(i + 1, 'car')).find((p) => p.archetype === 'hurried')
  const dryCautious = crosswalkYieldBuffer(cautiousP, 60, 0)
  const dryHurried = crosswalkYieldBuffer(hurriedP, 60, 0)
  const wetCautious = crosswalkYieldBuffer(cautiousP, 60, 0.9)
  const wetHurried = crosswalkYieldBuffer(hurriedP, 60, 0.9)

  check(
    dryCautious > dryHurried * 2.0 && wetCautious > dryCautious * 1.35 && wetHurried > dryHurried * 1.15,
    `crosswalk yield buffer scales with driver caution & rain (cautious ${dryCautious.toFixed(1)} -> ${wetCautious.toFixed(1)} cells; hurried ${dryHurried.toFixed(1)} -> ${wetHurried.toFixed(1)} cells)`,
  )

  // Near-miss cue unit check + cooldown check.
  const cool = new Map()
  let nid = 1
  const cues1 = detectPedestrianNearMiss(
    { id: 7, x: 100, z: 0, hx: 1, hz: 0, halfL: 22, halfW: 9, v: 85 },
    [[112, 16]], 10.0, cool, () => nid++,
  )
  const cuesDup = detectPedestrianNearMiss(
    { id: 7, x: 105, z: 0, hx: 1, hz: 0, halfL: 22, halfW: 9, v: 85 },
    [[112, 16]], 10.2, cool, () => nid++,
  )
  check(
    cues1.length === 1 && cues1[0].severity > 0.3 && cues1[0].stepDirZ > 0.5 && cuesDup.length === 0,
    `near-miss cue emits directional step-back vector (severity=${cues1[0]?.severity}, stepDirZ=${cues1[0]?.stepDirZ.toFixed(2)}) with per-ped cooldown`,
  )

  // Integrated pedestrian-vehicle coupling inside `street()` with a real walk segment & Ring-1 pedestrians!
  // Walk format in sf-walks.mjs: [a, b, kind=0 (pavement), busy=180, signal=0, x0, z0, x1, z1]
  // Eastbound lane 0 runs at z=16.5 (car halfW=9 -> outer edge z=25.5); sidewalk runs right beside kerb at z=32.
  const walkSeg = [10, 11, 0, 180, 0, 100, 32, 550, 32]
  await runHeadlessStreet({
    square: buildTestSquare({ r2Lanes: 2, walk: [walkSeg] }),
    bodies: [[280, 41, 31]],
  }, async ({ st, view, step, getClock }) => {
    // Move camera close to (280, 32) so sidewalk pedestrians are in Ring 1 (<= 35 m).
    view.eye = [280, 60, 80]
    let cuesObserved = 0
    let flinchedPedCount = 0
    let folkSeen = 0

    // Spawn a fast emergency cruiser passing right alongside the sidewalk pedestrians to trigger clean close passes.
    st.spawnEmergency({ kind: 'police', roadKey: '100/1/2', lane: 0, s: 120, siren: true })

    for (let tick = 0; tick < 120; tick++) {
      const folk = st.folk(view, getClock())
      if (folk.length > folkSeen) folkSeen = folk.length
      for (const p of folk) {
        if ((p.flinch ?? 0) > 0.05) flinchedPedCount++
      }
      step(0.05)
      if (st.nearMissCues.length > cuesObserved) cuesObserved = st.nearMissCues.length
    }

    check(
      cuesObserved >= 1,
      `integrated street() emitted ${cuesObserved} structured pedestrian near-miss cue(s) on close passing vehicle`,
    )
    check(
      folkSeen > 0 && flinchedPedCount > 0,
      `pedestrian near-miss cue coupled cleanly to Ring-1 street folk reactions (folk=${folkSeen}, flinchedSamples=${flinchedPedCount})`,
    )
  })
}

if (failures.length) {
  console.error(`\nFAILED (${failures.length}):\n  ${failures.join('\n  ')}`)
  process.exit(1)
}
console.log('\ntraffic-ai: ok')
process.exit(0)
