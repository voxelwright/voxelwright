// Verification suite for Phase 2A classical AI runtime (#164):
//   - StateTree + Utility AI + Blackboard (statetree.mjs)
//   - Smart Objects, reservation locks, MRU anti-repeat & geometric overhang/cover/sit scanner (smart-objects.mjs)
//   - Player-made voxel affordance validator + heuristic auto-tagger (make/affordances.mjs)
//   - Acoustic & visual Stimulus Event Bus with voxel wall attenuation & divergent crowd reactions (stimulus.mjs)
//   - Upgraded actor<->actor Sight with spatial-hash bucketing & per-actor LOD throttling (sight.mjs)
//
//   node engine/test/ai-statetree.mjs
import { performance } from 'node:perf_hooks'
import { createBlackboard, createCityNpcTree, createStateTree, evalCurve, selectUtility } from '../rules/statetree.mjs'
import { createSmartObjectRegistry, scanGeometricAffordances } from '../rules/smart-objects.mjs'
import { AFFORDANCE_KINDS, SLOTS_MOST, inferAffordances, validateAffordances } from '../make/affordances.mjs'
import { createStimulusBus, chooseReaction, personalityFromSeed, rayAttenuation } from '../rules/stimulus.mjs'
import { KEPT, SIGHT, sight } from '../rules/sight.mjs'

const failures = []
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`)
  if (!ok) failures.push(what)
}

// ── 1. Blackboard: types, dirty tracking, TTL expiry, bounded snapshots ──
console.log('1. Blackboard & Utility AI')
{
  const bb = createBlackboard({
    mood: { type: 'string', default: 'calm', priority: 5 },
    fear: { type: 'number', default: 0, priority: 4 },
    note: { type: 'string', priority: 1 },
  })
  check(bb.get('mood') === 'calm', 'blackboard loads schema defaults')

  let threw = false
  try { bb.set('fear', 'very-scared') } catch (e) { threw = e instanceof TypeError }
  check(threw, 'blackboard enforces declared types')

  bb.set('fear', 0.8, { now: 1000, ttlMs: 2000 })
  check(bb.isDirty('fear') && bb.consumeDirty().includes('fear'), 'blackboard tracks and consumes dirty keys')
  check(bb.get('fear', 2500) === 0.8, 'blackboard keeps TTL memory before expiry')
  check(bb.get('fear', 3000) === undefined, 'blackboard expires transient memory once TTL elapses')

  // Bounded snapshot drops low-priority bulky entries to stay under maxBytes.
  bb.set('mood', 'alert', { now: 3100, priority: 10 })
  bb.set('note', 'x'.repeat(300), { now: 3100, priority: 0 })
  const snap = bb.snapshot(3100, { maxBytes: 120 })
  check(JSON.stringify(snap).length <= 120 && snap.values.mood === 'alert' && snap.truncated === true, 'blackboard snapshot enforces maxBytes while keeping high-priority keys')

  const bb2 = createBlackboard({ mood: 'string', fear: 'number' })
  bb2.restore(snap, 3100)
  check(bb2.get('mood', 3100) === 'alert', 'blackboard restores cleanly from snapshot')

  // Utility curves & inertia anti-thrashing.
  check(evalCurve('linear', 0.5) === 0.5, 'linear curve maps 0.5 -> 0.5')
  check(evalCurve('quadratic', 0.5) === 0.25, 'quadratic curve maps 0.5 -> 0.25')
  check(evalCurve('inverse', 0.25) === 0.75, 'inverse curve maps 0.25 -> 0.75')
  check(evalCurve('step', 0.6) === 1 && evalCurve('step', 0.4) === 0, 'step curve thresholds at 0.5')
  check(evalCurve('logistic', 0.5) === 0.5 && evalCurve('logistic', 0.9) > 0.9, 'logistic curve is S-shaped')

  const actions = [
    { id: 'sit', baseScore: 0.60 },
    { id: 'browse', baseScore: 0.66 },
  ]
  const sticky = selectUtility(actions, {}, { currentActionId: 'sit', inertia: 0.12 })
  const fresh = selectUtility(actions, {}, { currentActionId: null, inertia: 0.12 })
  check(sticky.action.id === 'sit' && fresh.action.id === 'browse', 'utility inertia prevents thrashing between close actions')
}

// ── 2. WeatherShelter StateTree + geometric overhang scanning ───────────
console.log('2. WeatherShelter & Geometric Overhang / Cover / Sit Scanning')
{
  // Build a synthetic voxel street with:
  //   - Ground floor at y = 0 (asphalt=6)
  //   - Rain awning overhang at x in [20..36], z in [10..26], y = 30 (roofing=14)
  //   - Waist-high concrete cover wall at x = 60, z in [10..24], y in [1..10] (concrete=7)
  //   - Sittable brick ledge at x = 80, z in [10..24], y in [1..5] (brick=8)
  const worldKind = (x, y, z) => {
    if (y === 0) return 6
    if (y === 30 && x >= 20 && x <= 36 && z >= 10 && z <= 26) return 14
    if (x === 60 && z >= 10 && z <= 24 && y >= 1 && y <= 10) return 7
    if (x === 80 && z >= 10 && z <= 24 && y >= 1 && y <= 5) return 8
    return 0
  }

  const geoSlots = scanGeometricAffordances(worldKind, { min: [15, 0, 8], max: [85, 2, 28] }, { stride: 2, minSpacing: 8 })
  const hasShelter = geoSlots.some((s) => s.kind === 'shelter' && s.pos[0] >= 20 && s.pos[0] <= 36)
  const hasCover = geoSlots.some((s) => s.kind === 'cover' && Math.abs(s.pos[0] - 60) <= 2)
  const hasSit = geoSlots.some((s) => s.kind === 'sit' && s.pos[0] === 80 && s.pos[1] === 6)
  check(hasShelter, `geometric scanner detects rain-shelter overhangs (found ${geoSlots.filter((s) => s.kind === 'shelter').length})`)
  check(hasCover, `geometric scanner detects waist-high cover ledges (found ${geoSlots.filter((s) => s.kind === 'cover').length})`)
  check(hasSit, `geometric scanner detects sittable ledges (found ${geoSlots.filter((s) => s.kind === 'sit').length})`)

  const reg = createSmartObjectRegistry()
  reg.scanRegion(worldKind, { min: [15, 0, 8], max: [40, 2, 28] }, { id: 'market-awning', stride: 2, minSpacing: 12 })

  const npcTree = createCityNpcTree({ rainThreshold: 0.3, rainClear: 0.25 })
  const ctx = { actorId: 'npc-rain-1', pos: [10, 1, 18], rain: 0.0, smartObjects: reg, now: 0 }
  npcTree.start(ctx, 0)
  check(npcTree.isIn('Routine'), `NPC starts in Routine when dry (${npcTree.state})`)

  // Scheduled tick throttling check: ticking before nextTickAt skips execution.
  const skipped = npcTree.tick({ ...ctx, now: 100 }, 100)
  check(skipped.ticked === false, 'StateTree scheduled tick skips calls before tickIntervalMs elapses')

  // Rain rises above 0.3 -> NPC transitions to WeatherShelter and claims an overhang slot.
  const rainy = npcTree.tick({ ...ctx, rain: 0.65, now: 600 }, 600)
  const claimedSlotId = npcTree.blackboard.get('claimedSlotId')
  check(rainy.state === 'WeatherShelter' && npcTree.isIn('WeatherShelter'), `NPC transitions to WeatherShelter when rain > 0.3 (${rainy.state})`)
  check(Boolean(claimedSlotId) && reg.isClaimed(claimedSlotId, 600, 'npc-rain-1'), `NPC claims an overhang shelter slot (${claimedSlotId})`)

  // Rain clears -> NPC exits WeatherShelter, releases slot, and returns to Routine.
  const cleared = npcTree.tick({ ...ctx, rain: 0.05, now: 1200 }, 1200)
  check(npcTree.isIn('Routine'), `NPC returns to Routine when rain clears (${cleared.state})`)
  check(!reg.isClaimed(claimedSlotId, 1200), 'NPC releases shelter slot cleanly when rain clears')
}

// ── 3. Player-made affordances -> SmartObjectRegistry -> Claim + MRU ────
console.log('3. Player-Made Voxel Affordances, Reservation Locks & MRU Anti-Repeat')
{
  // Build a simple voxel park bench: 16x9x6 cells, legs at x=1..2 & 13..14, seat at y=4, backrest at z=5 y=5..8.
  const [w, h, d] = [16, 9, 6]
  const benchCells = new Uint16Array(w * h * d)
  const setCell = (x, y, z, k) => { benchCells[(y * d + z) * w + x] = k }
  for (let z = 1; z < 5; z++) {
    for (let y = 0; y < 4; y++) {
      setCell(1, y, z, 10); setCell(2, y, z, 10)
      setCell(13, y, z, 10); setCell(14, y, z, 10)
    }
    for (let x = 1; x <= 14; x++) setCell(x, 4, z, 10)
  }
  for (let y = 5; y < 9; y++) for (let x = 1; x <= 14; x++) setCell(x, y, 5, 10)

  const inferredBench = inferAffordances({ name: 'a park bench', size: [w, h, d], cells: benchCells })
  check(inferredBench.slots.length >= 1 && inferredBench.slots.every((s) => s.kind === 'sit'), `inferAffordances emits sit slots for a park bench (${inferredBench.slots.length} slots)`)

  // Also test label-driven inference with zero explicit metadata for the other archetypes.
  const busShelter = inferAffordances({ name: 'a bus shelter', size: [24, 24, 14] })
  const lemonade = inferAffordances({ name: 'a lemonade stand', size: [18, 22, 12] })
  const barricade = inferAffordances({ name: 'a sandbag barricade', size: [20, 10, 8] })
  const statue = inferAffordances({ name: 'a neon statue', size: [12, 28, 12] })
  check(busShelter.slots.some((s) => s.kind === 'shelter'), 'inferAffordances tags "a bus shelter" with shelter')
  check(lemonade.slots.some((s) => s.kind === 'browse'), 'inferAffordances tags "a lemonade stand" with browse')
  check(barricade.slots.some((s) => s.kind === 'cover'), 'inferAffordances tags "a sandbag barricade" with cover')
  check(statue.slots.some((s) => s.kind === 'spectacle'), 'inferAffordances tags "a neon statue" with spectacle')

  // Register two player-made single-seat benches in SmartObjectRegistry.
  const reg = createSmartObjectRegistry()
  const benchA = reg.registerMadeObject({
    id: 'made-bench-a',
    ownerId: 'player-1',
    name: 'a park bench',
    pos: [100, 0, 100],
    facing: 'south',
    size: [10, 9, 6],
    affordances: [{ kind: 'sit', pos: [5, 5, 3], yaw: 0, tags: ['wood'], capacity: 1 }],
  })
  const benchB = reg.registerMadeObject({
    id: 'made-bench-b',
    ownerId: 'player-1',
    name: 'a park bench',
    pos: [130, 0, 100],
    facing: 'south',
    size: [10, 9, 6],
    affordances: [{ kind: 'sit', pos: [5, 5, 3], yaw: 0, tags: ['wood'], capacity: 1 }],
  })
  const slotA = benchA.slots[0].slotId
  const slotB = benchB.slots[0].slotId

  // NPC 1 claims nearest bench (bench A).
  const firstPick = reg.findBestAndClaim('npc-1', { pos: [102, 0, 100], radius: 200, kind: 'sit', now: 1000 }, 5000)
  check(firstPick?.slot.slotId === slotA, 'NPC 1 claims nearest player-made bench slot')

  // NPC 2 cannot double-claim occupied slot A, and automatically picks slot B instead.
  const overlapAttempt = reg.claim(slotA, 'npc-2', 1100, 5000)
  check(!overlapAttempt.ok && overlapAttempt.reason === 'slot_full', 'second NPC cannot overlap already-claimed seat')
  const secondPick = reg.findBestAndClaim('npc-2', { pos: [102, 0, 100], radius: 200, kind: 'sit', now: 1100 }, 5000)
  check(secondPick?.slot.slotId === slotB, 'second NPC skips claimed slot A and claims free slot B')

  // Release both benches; NPC 1 queries right beside bench A again — MRU anti-repeat picks bench B!
  reg.release(slotA, 'npc-1', 2000)
  reg.release(slotB, 'npc-2', 2000)
  const repeatPick = reg.findBest('npc-1', { pos: [102, 0, 100], radius: 200, kind: 'sit', now: 2100 })
  check(repeatPick?.slot.slotId === slotB, `MRU anti-repeat steers NPC 1 to bench B instead of infinitely re-claiming bench A (picked ${repeatPick?.slot.slotId})`)
  check(reg.mruPenaltyFor('npc-1', benchA.slots[0], 2100) > 0.5, 'MRU records strong recency penalty for just-used bench A')

  // Lease expiry prevents stuck locks when an actor despawns without calling release().
  reg.claim(slotA, 'ghost-npc', 3000, 2000)
  check(reg.isClaimed(slotA, 4000, 'ghost-npc'), 'lease holds slot before expiry')
  const swept = reg.sweepExpired(5001)
  check(swept === 1 && !reg.isClaimed(slotA, 5001), 'sweepExpired frees stuck lock after lease expires')

  // validateAffordances security & sanitization checks.
  const malicious = {
    slots: [
      { kind: 'sit', pos: [999, -50, 999], yaw: 10, capacity: 99, tags: ['Good-Tag', '<script>alert(1)</script>'], evil: 'drop table', __proto__: { polluted: true } },
      { kind: 'exec_shell', pos: [1, 1, 1] },
      { kind: 'sit', pos: [NaN, 1, 1] },
      ...Array.from({ length: 12 }, (_, i) => ({ kind: 'browse', pos: [i, 0, 0] })),
    ],
    extraTopLevel: 'strip-me',
  }
  const checked = validateAffordances(malicious, [16, 12, 16])
  check(!checked.valid && checked.rejected === 2, `validateAffordances rejects disallowed kind & NaN pos (rejected=${checked.rejected})`)
  check(checked.slots.length === SLOTS_MOST, `validateAffordances caps slots at SLOTS_MOST=${SLOTS_MOST} (got ${checked.slots.length})`)
  const s0 = checked.slots[0]
  check(s0.pos[0] === 16 && s0.pos[1] === 0 && s0.pos[2] === 16, `validateAffordances clamps out-of-bounds pos inside bounds (${s0.pos})`)
  check(s0.evil === undefined && !('polluted' in Object.prototype) && s0.tags.length === 1 && s0.tags[0] === 'good-tag', 'validateAffordances strips unknown fields, unsafe tags, and blocks prototype pollution')
  check(checked.slots.every((s) => AFFORDANCE_KINDS.includes(s.kind)), 'all validated slots use allowlisted kinds')
  const badPrimitive = validateAffordances('not-an-object', [10, 10, 10])
  check(!badPrimitive.valid && badPrimitive.slots.length === 0, 'validateAffordances rejects primitive payloads')
}

// ── 4. Acoustic & Visual Stimulus Bus + Wall Occlusion + 20-NPC Crowd ───
console.log('4. Stimulus Bus, Voxel Occlusion & Divergent 20-NPC Crowd')
{
  const bus = createStimulusBus({ tileSize: 128, maxEvents: 64 })
  // Thick concrete wall (material 7) at x in [50..59] (10 cells = 1 m thick), y in [0..40], z in [-50..50].
  const wallKind = (x, y, z) => (x >= 50 && x <= 59 && y >= 0 && y <= 40 && z >= -50 && z <= 50 ? 7 : 0)

  const blast = bus.emit({ kind: 'blast', pos: [0, 15, 0], radius: 800, loudness: 1.0, now: 1000 })

  const openStreetListener = { id: 'open-1', pos: [-100, 0, 0] }
  const behindWallListener = { id: 'wall-1', pos: [100, 0, 0] }
  const pOpen = bus.perceive(openStreetListener, { kind: wallKind, now: 1050 })
  const pWall = bus.perceive(behindWallListener, { kind: wallKind, now: 1050 })

  check(pOpen.length === 1 && pWall.length === 1, 'both open-street and behind-wall listeners perceive nearby blast')
  check(pOpen[0].occludedCells === 0 && pWall[0].occludedCells >= 9, `voxel raymarch counts concrete wall cells (open=${pOpen[0].occludedCells}, wall=${pWall[0].occludedCells})`)
  check(pWall[0].salience < pOpen[0].salience * 0.15, `thick concrete wall strongly attenuates blast salience (open=${pOpen[0].salience.toFixed(3)}, wall=${pWall[0].salience.toFixed(3)})`)

  // Purely visual stimulus is fully blocked by opaque wall, passes through open street.
  bus.emit({ kind: 'made_thing', pos: [0, 15, 0], radius: 400, loudness: 0.8, now: 1100 })
  const visOpen = bus.perceive(openStreetListener, { kind: wallKind, now: 1120, kinds: ['made_thing'] })
  const visWall = bus.perceive(behindWallListener, { kind: wallKind, now: 1120, kinds: ['made_thing'] })
  check(visOpen.length === 1 && visWall.length === 0, 'visual-only stimulus passes open street and is blocked behind solid wall')

  // Automatic decay removes old events.
  const afterDecay = bus.perceive(openStreetListener, { kind: wallKind, now: 25_000 })
  check(afterDecay.length === 0 && bus.size === 0, 'stimuli automatically decay and sweep from ring buffer')

  // 20-NPC diverse crowd reacts to a fresh open-street blast via StateTree event-driven dispatch.
  const bus2 = createStimulusBus()
  const reg2 = createSmartObjectRegistry()
  reg2.registerCitySlots([
    { id: 'cover-1', type: 'barrier', pos: [40, 0, 60] },
    { id: 'cover-2', type: 'barrier', pos: [-40, 0, 60] },
    { id: 'awning-1', type: 'awning', pos: [0, 0, 90], capacity: 4 },
  ])

  const npcs = Array.from({ length: 20 }, (_, i) => ({
    id: `citizen-${i + 1}`,
    pos: [Math.cos((i / 20) * Math.PI * 2) * 110, 0, Math.sin((i / 20) * Math.PI * 2) * 110],
    personality: personalityFromSeed(`sf-resident-v1-${i}`),
    tree: createCityNpcTree(),
  }))

  for (const n of npcs) n.tree.start({ actorId: n.id, pos: n.pos, personality: n.personality, smartObjects: reg2, now: 5000 }, 5000)

  const t0 = performance.now()
  const boom = bus2.emit({ kind: 'blast', pos: [0, 15, 0], radius: 900, loudness: 1.0, now: 5100 })
  const counts = { flee: 0, shelter: 0, film: 0, call_help: 0, confront: 0, glance: 0 }
  const stateCounts = {}
  for (const n of npcs) {
    const perceived = bus2.perceive({ id: n.id, pos: n.pos }, { now: 5100 })
    const top = perceived[0]
    const decision = chooseReaction(n.personality, top)
    counts[decision.reaction] = (counts[decision.reaction] ?? 0) + 1
    // Event-driven transition: reacts immediately at 5100 without waiting for tickIntervalMs!
    const tr = n.tree.sendEvent({ type: 'stimulus', stimulus: top }, { actorId: n.id, pos: n.pos, personality: n.personality, smartObjects: reg2, now: 5100 }, 5100)
    stateCounts[tr.state] = (stateCounts[tr.state] ?? 0) + 1
  }
  const elapsedMs = performance.now() - t0
  check(
    counts.flee >= 2 && counts.shelter >= 2 && counts.film >= 2 && counts.call_help >= 2,
    `20-NPC crowd splits realistically across roles (${JSON.stringify(counts)})`
  )
  check(
    (stateCounts.Flee ?? 0) >= 2 && (stateCounts.Shelter ?? 0) >= 2 && (stateCounts.Film ?? 0) >= 2 && (stateCounts.CallHelp ?? 0) >= 2,
    `StateTree branches immediately on stimulus event into Flee/Shelter/Film/CallHelp (${JSON.stringify(stateCounts)})`
  )
  check(elapsedMs < 25, `20-NPC perception + StateTree event dispatch completes without CPU spike (${elapsedMs.toFixed(2)} ms)`)

  // Verify rayAttenuation directly returns expected range for open vs thick wall.
  const openAtt = rayAttenuation([0, 15, 0], [40, 15, 0], wallKind, 'acoustic')
  const wallAtt = rayAttenuation([40, 15, 0], [70, 15, 0], wallKind, 'acoustic')
  check(openAtt.transmission === 1 && wallAtt.transmission < 0.12 && boom.kind === 'blast', `rayAttenuation matches physical attenuation profile (open=${openAtt.transmission}, wall=${wallAtt.transmission.toFixed(3)})`)
}

// ── 5. Upgraded Sight: actor<->actor LOS, voxel walls, spatial hash & LOD ─
console.log('5. Upgraded Sight (actor<->actor, spatial hash & LOD throttling)')
{
  const wallBetween = (x, y, z) => (x >= 50 && x <= 51 && y >= 0 && y <= 30 && z >= -20 && z <= 20 ? 8 : 0)
  const openWorld = () => 0

  const folk = new Map([
    ['npc-a', { by: 'npc-a', rule: 'city', at: [0, 0, 0], yaw: Math.PI / 2 }],   // facing +x
    ['npc-b', { by: 'npc-b', rule: 'city', at: [100, 0, 0], yaw: -Math.PI / 2 }], // facing -x
  ])

  // Backward-compatible default (actorToActor omitted/false): two rule actors do NOT see each other.
  const legacySight = sight({ folk, kind: openWorld })
  const legacySeen = legacySight.now(1000)
  check(!legacySeen.get('npc-a')?.has('npc-b') && !legacySeen.get('npc-b')?.has('npc-a'), 'default sight() preserves backward compatibility (rule<->rule skipped)')

  // Opt-in actorToActor: true enables NPC<->NPC sight in open street.
  const witnessSight = sight({ folk, kind: openWorld, actorToActor: true })
  const openSeen = witnessSight.now(1000)
  check(openSeen.get('npc-a')?.has('npc-b') && openSeen.get('npc-b')?.has('npc-a'), 'sight({ actorToActor: true }) detects mutual NPC<->NPC line of sight')

  // Respects opaque brick wall between the two NPCs.
  const blockedSight = sight({ folk, kind: wallBetween, actorToActor: true })
  const blockedSeen = blockedSight.now(1000)
  check(!blockedSeen.get('npc-a')?.has('npc-b') && !blockedSeen.get('npc-b')?.has('npc-a'), 'sight({ actorToActor: true }) respects voxel walls')

  // Spatial-hash pre-filter: 60 actors spread across 6000 cells should check far fewer than N*(N-1)/2 = 1770 pairs!
  const spreadFolk = new Map()
  for (let i = 0; i < 60; i++) {
    spreadFolk.set(`a-${i}`, { by: `a-${i}`, rule: 'city', at: [i * 120, 0, (i % 5) * 1500], yaw: Math.PI / 2 })
  }
  const spatialSight = sight({ folk: spreadFolk, kind: openWorld, actorToActor: true, bucketSize: 300 })
  spatialSight.now(1000)
  const spStats = spatialSight.stats()
  check(spStats.pairs < 250 && SIGHT === 600, `spatial-hash pre-filter prunes distant pairs (${spStats.pairs} checked vs 1770 O(N^2) pairs)`)

  // Per-actor LOD tick throttling: Ring 1 every KEPT, Ring 2 every 3*KEPT, Ring 3 skipped.
  const lodFolk = new Map([
    ['r1-a', { by: 'r1-a', rule: 'city', at: [0, 0, 0], yaw: Math.PI / 2, lod: 1 }],
    ['r1-b', { by: 'r1-b', rule: 'city', at: [60, 0, 0], yaw: -Math.PI / 2, lod: 1 }],
    ['r2-a', { by: 'r2-a', rule: 'city', at: [0, 0, 2000], yaw: Math.PI / 2, lod: 2 }],
    ['r2-b', { by: 'r2-b', rule: 'city', at: [60, 0, 2000], yaw: -Math.PI / 2, lod: 2 }],
    ['r3-a', { by: 'r3-a', rule: 'city', at: [0, 0, 4000], yaw: Math.PI / 2, lod: 3 }],
    ['r3-b', { by: 'r3-b', rule: 'city', at: [60, 0, 4000], yaw: -Math.PI / 2, lod: 3 }],
  ])
  const lodSight = sight({ folk: lodFolk, kind: openWorld, actorToActor: true })

  // Tick 0 (t=1000): Ring 1 & Ring 2 evaluated, Ring 3 skipped.
  const s0 = lodSight.now(1000)
  const st0 = lodSight.stats()
  check(s0.get('r1-a')?.has('r1-b') && s0.get('r2-a')?.has('r2-b'), 'LOD tick 0 evaluates Ring 1 and Ring 2')
  check(!s0.has('r3-a') && !s0.has('r3-b') && st0.skippedLod === 2, 'LOD skips Ring 3 actors completely')

  // Move r2-b out of sight at t=1000+KEPT (1400): Ring 2 is NOT due yet (needs 3*KEPT = 1200ms),
  // so Ring 2 keeps cached sight & skips raycast; Ring 1 updates immediately.
  lodFolk.get('r2-b').at = [60, 0, 3500]
  lodFolk.get('r1-b').at = [60, 0, 900]
  const s1 = lodSight.now(1000 + KEPT)
  const st1 = lodSight.stats()
  check(!s1.get('r1-a')?.has('r1-b'), 'Ring 1 refreshes after 1 * KEPT ms')
  check(s1.get('r2-a')?.has('r2-b') && st1.deferredLod2 === 2, 'Ring 2 defers re-evaluation before 3 * KEPT ms')

  // At t=1000 + 3*KEPT (2200): Ring 2 refreshes and notices r2-b left!
  const s2 = lodSight.now(1000 + 3 * KEPT)
  check(!s2.get('r2-a')?.has('r2-b'), 'Ring 2 refreshes after 3 * KEPT ms and clears lost sight')
}

if (failures.length) {
  console.error(`\nFAILED (${failures.length}):\n  ${failures.join('\n  ')}`)
  process.exit(1)
}
console.log('\nai-statetree: ok')
process.exit(0)
