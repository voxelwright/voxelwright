// Systemic consequence loop & 0 ms contextual bark tests (#164):
//   - Zero omniscience when an incident has no perceiving witnesses and no active CCTV
//   - Interceptable witness reporting window + secondary witness on bystander-seen intimidation
//   - Descriptor-based Heat, outfit/vehicle-swap evasion out of LOS, and re-recognition upon return
//   - Tactical Dispatch FSM (calm -> investigating -> questioning_witness -> searching_perimeter -> pursuing -> standing_down -> calm)
//     and last-known-sighting vector search perimeter (never tracking live coordinates out of LOS)
//   - Bounded per-NPC memory LRU, district reputation decay, and local 2-hop proximity gossip (never global)
//   - 0 ms deterministic contextual barks & RDR2/GTA 6 Greet/Antagonize social escalation
//
//   node engine/test/witness-dispatch.mjs
import { createBarkEngine, classifySocialSpeech, districtTone, generateBark } from '../rules/barks.mjs'
import { computeSearchWaypoints, createDispatch } from '../rules/dispatch.mjs'
import {
  WITNESSED_MOST,
  createMemory,
  descriptorOf,
  descriptorsMatch,
  propagateGossip,
} from '../rules/memory.mjs'

const failures = []
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`)
  if (!ok) failures.push(what)
}

// ── 1. Zero Omniscience ───────────────────────────────────────────────────────
{
  const dispatch = createDispatch()
  const desc = descriptorOf({ look: { coat: 'black', mask: true }, vehicle: null })
  const silent = dispatch.reportIncident({
    kind: 'blast',
    severity: 4,
    pos: [200, 300],
    district: 'dogpatch',
    suspectId: 'player-1',
    descriptor: desc,
    witnesses: [],
    cctvNodes: [],
    now: 10,
  })
  check(!silent.dispatched && silent.reason === 'no_witnesses' && dispatch.heat() === 0, 'zero witnesses and zero CCTV triggers zero dispatch and zero Heat')

  // Unseeing bystanders and offline cameras also produce zero dispatch.
  const unseen = dispatch.reportIncident({
    kind: 'theft',
    severity: 3,
    pos: [210, 310],
    district: 'dogpatch',
    suspectId: 'player-1',
    descriptor: desc,
    witnesses: [{ id: 'civ-blind', pos: [240, 310], seesSuspect: false }],
    cctvNodes: [{ id: 'cam-off', pos: [205, 305], active: false }],
    now: 12,
  })
  dispatch.tick(30)
  check(!unseen.dispatched && dispatch.heat() === 0 && dispatch.snapshot().units.length === 0, 'unseeing witnesses and inactive CCTV never trigger dispatch')
}

// ── 2. Interceptable Witness Window & Secondary Witness ──────────────────────
{
  const dispatch = createDispatch()
  const desc = descriptorOf({ look: { coat: 'red', hat: 'cap' } })
  const rep = dispatch.reportIncident({
    kind: 'vandalism',
    severity: 2,
    pos: [100, 100],
    district: 'mission',
    suspectId: 'player-1',
    descriptor: desc,
    witnesses: [{ id: 'w1', pos: [115, 102], hasPhone: true, courage: 0.4 }],
    now: 100,
  })
  check(!rep.dispatched && rep.witnesses.length === 1 && rep.witnesses[0].state === 'spotting', 'witness starts in spotting state with zero immediate dispatch')
  check(rep.witnesses[0].reportEndsAt >= 105 && rep.witnesses[0].reportEndsAt <= 109.5, 'reporting countdown falls in interceptable 4-8 s window after spot delay')

  // Advance into reporting state (still before report finishes).
  const ev1 = dispatch.tick(101.5)
  check(ev1.some((e) => e.type === 'witness_reporting' && e.witnessId === 'w1') && dispatch.heat() === 0, 'witness transitions spotting -> reporting without firing dispatch yet')

  // Intercept w1 cleanly with no bystanders -> prevents dispatch completely!
  const cleanStop = dispatch.interceptWitness({
    witnessId: 'w1',
    suspectId: 'player-1',
    action: 'intimidate',
    pos: [115, 102],
    descriptor: desc,
    bystanders: [],
    now: 103,
  })
  dispatch.tick(120)
  check(cleanStop.ok && cleanStop.intercepted && cleanStop.secondaryWitnesses.length === 0 && dispatch.heat() === 0, 'intercepting witness before countdown prevents dispatch')

  // Now commit another incident and intimidate w2 in front of bystander w3 -> secondary witness spawns!
  dispatch.reportIncident({
    kind: 'assault',
    severity: 2,
    pos: [120, 110],
    district: 'mission',
    suspectId: 'player-1',
    descriptor: desc,
    witnesses: [{ id: 'w2', pos: [128, 112], hasPhone: true, courage: 0.3 }],
    now: 200,
  })
  dispatch.tick(201.5)
  const messyStop = dispatch.interceptWitness({
    witnessId: 'w2',
    suspectId: 'player-1',
    action: 'intimidate',
    pos: [128, 112],
    descriptor: desc,
    bystanders: [{ id: 'w3', pos: [140, 115], hasPhone: true, seesSuspect: true }],
    now: 202.5,
  })
  check(
    messyStop.intercepted && messyStop.secondaryWitnesses.length === 1 && messyStop.secondaryWitnesses[0].witnessId === 'w3' && messyStop.secondaryWitnesses[0].kind === 'witness_intimidation',
    'bystander witnessing intimidation spawns a secondary witness chain',
  )
  // Secondary witness w3 is NOT intercepted -> completes report and triggers dispatch!
  const secEnd = messyStop.secondaryWitnesses[0].reportEndsAt
  dispatch.tick(204) // w3 enters reporting
  const ev2 = dispatch.tick(secEnd + 0.2)
  check(
    ev2.some((e) => e.type === 'witness_reported' && e.witnessId === 'w3') && dispatch.heat() >= 2 && dispatch.snapshot().units.length >= 2,
    'unintercepted secondary witness finishes reporting and dispatches patrol units',
  )
}

// ── 3. Descriptor-Based Heat, Vehicle & Outfit Swap Evasion, Re-Recognition ──
{
  const dispatch = createDispatch()
  const redCoupe = descriptorOf({ look: { coat: 'navy' }, vehicle: { model: 'coupe', paint: 'red' } })
  const greenVan = descriptorOf({ look: { coat: 'navy' }, vehicle: { model: 'van', paint: 'green' } })

  // Witness reports reckless crime in red coupe.
  const rep = dispatch.reportIncident({
    kind: 'hit_and_run',
    severity: 2,
    pos: [500, 500],
    district: 'soma',
    suspectId: 'player-1',
    descriptor: redCoupe,
    witnesses: [{ id: 'w-car', pos: [510, 505], nearOfficer: true }],
    now: 10,
  })
  const reportDoneAt = rep.witnesses[0].reportEndsAt + 0.1
  dispatch.tick(11.5) // spotting -> reporting
  dispatch.tick(reportDoneAt) // reporting -> reported -> dispatch!

  const snapAfterReport = dispatch.snapshot()
  const leadUnit = snapAfterReport.units[0]
  check(snapAfterReport.heat === 2 && leadUnit.state === 'investigating', 'reported crime escalates Heat to 2 and dispatches investigating patrol units')

  // Unit progresses investigating -> questioning_witness -> searching_perimeter.
  const evQ = dispatch.tick(reportDoneAt + 2.2)
  check(evQ.some((e) => e.type === 'unit_questioning_witness'), 'lead unit questions witness at scene before expanding search')
  const evS = dispatch.tick(reportDoneAt + 5.0)
  check(evS.some((e) => e.type === 'unit_searching_perimeter'), 'unit transitions from questioning_witness to searching_perimeter')

  // Officer gets LOS on suspect in the red coupe -> recognized & pursued!
  const spot1 = dispatch.observeSuspect({
    unitId: leadUnit.id,
    district: 'soma',
    pos: [540, 520],
    vel: [12, 0],
    hasLos: true,
    descriptor: redCoupe,
    now: reportDoneAt + 6.0,
  })
  check(spot1.recognized && spot1.unitState === 'pursuing' && spot1.lastKnownPos[0] === 540, 'officer recognizes reported vehicle descriptor and enters pursuing state')

  // Suspect breaks LOS and drives far away to [900, 900] -> patrol NEVER gets true live coords!
  const blind = dispatch.observeSuspect({
    unitId: leadUnit.id,
    district: 'soma',
    pos: [900, 900],
    vel: [15, 0],
    hasLos: false,
    descriptor: redCoupe,
    now: reportDoneAt + 7.0,
  })
  const boloAfterLoss = dispatch.snapshot().bolos[0]
  check(!blind.recognized && boloAfterLoss.lastKnownPos[0] === 540 && boloAfterLoss.lastKnownPos[1] === 520, 'breaking LOS preserves last-known sighting vector and never leaks live coordinates')

  // Tactical search waypoints surround the last-known sighting vector with ring/flank roles.
  const wps = computeSearchWaypoints([540, 520], [12, 0], 3, 50)
  check(wps.length === 3 && wps[0].role === 'point' && wps[1].role === 'flank_left' && wps[2].role === 'flank_right', 'tactical search waypoints compute point + left/right flank ring around last-known vector')

  // Suspect swaps into a green van while out of LOS.
  dispatch.notifyUnseenSwap({ newDescriptor: greenVan, now: reportDoneAt + 12.0 })
  // Officer drives past suspect in the green van WITH LOS -> fails to recognize!
  const passInVan = dispatch.observeSuspect({
    unitId: leadUnit.id,
    district: 'soma',
    pos: [600, 550],
    hasLos: true,
    descriptor: greenVan,
    committingAct: false,
    now: reportDoneAt + 14.0,
  })
  check(!passInVan.recognized && passInVan.reason === 'descriptor_mismatch', 'swapping vehicle while out of LOS defeats descriptor-based patrol recognition')

  // Advance past search window -> BOLO shifts searching -> evaded, Heat drops to 0, units stand down -> calm.
  const evEvade = dispatch.tick(reportDoneAt + 26.0)
  check(
    evEvade.some((e) => e.type === 'bolo_evaded') && dispatch.heat() === 0 && dispatch.snapshot().units.every((u) => u.state === 'standing_down'),
    'unrecognized suspect evades Heat cleanly and units stand down',
  )
  dispatch.tick(reportDoneAt + 33.0)
  check(dispatch.snapshot().units.every((u) => u.state === 'calm'), 'standing_down units return to calm state')

  // Suspect returns to SoMa in the SAME red coupe -> re-triggers recognition & pursuit!
  const returnInCoupe = dispatch.observeSuspect({
    unitId: leadUnit.id,
    district: 'soma',
    pos: [520, 510],
    hasLos: true,
    descriptor: redCoupe,
    now: reportDoneAt + 40.0,
  })
  check(returnInCoupe.recognized && returnInCoupe.unitState === 'pursuing' && dispatch.heat() >= 2, 'returning in the reported car re-triggers recognition and pursuit')
}

// ── 4. On-Foot Outfit Swap Evasion & Re-Recognition + CCTV + WantedHistory ───
{
  const dispatch = createDispatch()
  const redCoat = descriptorOf({ look: { coat: 'crimson', trousers: 'jeans' }, masked: false })
  const darkSuit = descriptorOf({ look: { suit: 'charcoal', tie: 'black' }, masked: false })

  // CCTV immediately files a BOLO for on-foot crime in red coat.
  const cctvRep = dispatch.reportIncident({
    kind: 'break_in',
    severity: 2,
    pos: [300, 300],
    district: 'fidi',
    suspectId: 'player-2',
    descriptor: redCoat,
    cctvNodes: [{ id: 'cam-1', pos: [302, 302], active: true }],
    now: 10,
  })
  check(cctvRep.dispatched && dispatch.heat() === 2, 'active CCTV immediately triggers descriptor-bound BOLO')

  // Break LOS, swap outfit to dark suit -> unrecognized -> evaded.
  dispatch.notifyUnseenSwap({ newDescriptor: darkSuit, now: 16 })
  const seenInSuit = dispatch.observeSuspect({ district: 'fidi', pos: [330, 310], hasLos: true, descriptor: darkSuit, now: 18 })
  check(!seenInSuit.recognized, 'swapping outfit on foot while unseen defeats recognition')
  dispatch.tick(32)
  check(dispatch.heat() === 0, 'on-foot outfit swap completes evasion')

  // Spotted again unmasked in the old red coat -> re-recognized!
  const seenInOldCoat = dispatch.observeSuspect({ district: 'fidi', pos: [315, 305], hasLos: true, descriptor: redCoat, now: 40 })
  check(seenInOldCoat.recognized && dispatch.heat() >= 2, 'being spotted unmasked in the old reported outfit re-triggers recognition')

  // Repeat offense in same district elevates Heat via WantedHistory, and decays over time.
  const beforeScore = dispatch.memory.districtReputation('fidi', 40).score
  dispatch.reportIncident({
    kind: 'break_in',
    severity: 2,
    pos: [315, 305],
    district: 'fidi',
    suspectId: 'player-2',
    descriptor: redCoat,
    cctvNodes: [{ id: 'cam-2', pos: [316, 306], active: true }],
    now: 45,
  })
  check(dispatch.heat() === 3, 'repeat matching incident in district WantedHistory elevates Heat (+1)')
  const laterRep = dispatch.memory.districtReputation('fidi', 45 + 1200)
  check(laterRep.score > beforeScore, 'district reputation decays back toward neutral over time')
}

// ── 5. Memory LRU Bounds & Local 2-Hop Proximity Gossip (Never Global) ───────
{
  const mem = createMemory({ maxSubjects: 3, maxWitnessed: WITNESSED_MOST })
  for (let i = 1; i <= 5; i++) mem.remember('npc-lru', `sub-${i}`, { trustDelta: i, tag: 'greeted', now: i })
  check(mem.recall('npc-lru', 'sub-1').familiarity === 0 && mem.recall('npc-lru', 'sub-5').familiarity === 1, 'per-NPC subject memory enforces bounded LRU eviction')

  for (let i = 1; i <= 9; i++) mem.recordWitnessed('npc-lru', { id: `w-${i}`, t: i, kind: 'theft', severity: 2, district: 'mission' })
  check(mem.witnessedBy('npc-lru').length === WITNESSED_MOST && mem.witnessedBy('npc-lru')[0].id === 'w-4', 'witnessed event log stays bounded to last 6 events')

  // Chain of 4 actors spaced 30 units apart (hop 0 -> hop 1 -> hop 2 -> STOP before hop 3) + 1 distant actor + 1 fleeing actor.
  const gossipMem = createMemory({ maxHops: 2, gossipCooldown: 5 })
  const desc = descriptorOf({ look: { coat: 'yellow' } })
  gossipMem.recordWitnessed('a0', {
    id: 'ev-robbery',
    t: 10,
    kind: 'robbery',
    severity: 3,
    district: 'north beach',
    suspectId: 'suspect-x',
    descriptor: desc,
    salience: 0.9,
    hops: 0,
  })

  const crowd = [
    { id: 'a0', pos: [0, 0], state: 'calm' },
    { id: 'a1', pos: [25, 0], state: 'conversing' },
    { id: 'a2', pos: [70, 0], state: 'calm' },
    { id: 'a3', pos: [115, 0], state: 'calm' },
    { id: 'far-away', pos: [900, 900], state: 'calm' },
    { id: 'panicked', pos: [10, 5], state: 'fleeing' },
  ]
  // Tick 1: a0 -> a1 (within 50 units; a2 is 70 from a0, 45 from a1; a1 has nothing yet at t=10 before a0 tells it... wait, loop order a0->a1 then a1->a2 can occur in one pass if a1 received it; let's test step-by-step explicitly!)
  const t1 = propagateGossip(gossipMem, [crowd[0], crowd[1], crowd[4], crowd[5]], 20, 40)
  check(t1.some((x) => x.from === 'a0' && x.to === 'a1' && x.hops === 1), 'nearby calm/conversing actor receives hop-1 gossip')
  check(gossipMem.witnessedBy('far-away').length === 0, 'distant actor never receives gossip (no global teleporting)')
  check(gossipMem.witnessedBy('panicked').length === 0, 'fleeing/panicked actor does not gossip')

  // Tick 2: a1 -> a2 (hop 2).
  const t2 = propagateGossip(gossipMem, [crowd[1], crowd[2]], 30, 50)
  check(t2.some((x) => x.from === 'a1' && x.to === 'a2' && x.hops === 2), 'hop-1 listener forwards decayed rumor to hop-2 neighbor')
  check(gossipMem.witnessedBy('a2')[0].salience < gossipMem.witnessedBy('a1')[0].salience, 'gossip salience decays on each hop')

  // Tick 3: a2 -> a3 MUST NOT propagate (maxHops = 2 reached!).
  const t3 = propagateGossip(gossipMem, [crowd[2], crowd[3]], 40, 50)
  check(!t3.some((x) => x.kind === 'event' && x.to === 'a3') && gossipMem.witnessedBy('a3').length === 0, 'gossip strictly stops at maxHops = 2 and never reaches hop 3')
}

// ── 6. 0 ms Contextual Barks & RDR2/GTA 6 Greet/Antagonize Escalation ────────
{
  const mem = createMemory()
  const barks = createBarkEngine({ memory: mem })

  check(districtTone('Financial District') === 'aloof' && districtTone('Mission') === 'friendly' && districtTone('Dogpatch') === 'defensive', 'districtTone maps SF neighborhoods to tone profiles')
  check(classifySocialSpeech('Hey there!') === 'greet' && classifySocialSpeech('Get lost!') === 'antagonize' && classifySocialSpeech('My bad.') === 'defuse' && classifySocialSpeech('Where is the ferry building?') === null, 'classifySocialSpeech separates quick barks from open-ended speech')

  // Greet -> Greet -> Greet builds trust and escalates to mind on step 3.
  const g1 = barks.interact({ actorId: 'ana', subjectId: 'wren', action: 'greet', district: 'mission', weather: 'fog', now: 1 })
  const g2 = barks.interact({ actorId: 'ana', subjectId: 'wren', action: 'greet', district: 'mission', weather: 'fog', now: 3 })
  const g3 = barks.interact({ actorId: 'ana', subjectId: 'wren', action: 'greet', district: 'mission', weather: 'fog', now: 5 })
  check(g1.ms === 0 && !g1.escalateToMind && g1.trustDelta > 0 && /marine|fog/i.test(g1.text), 'step-1 greet costs 0 ms, includes weather modulation, and builds trust')
  check(!g2.escalateToMind && g2.outcome === 'warm' && g2.trustDelta === 2, 'greet -> greet warms relationship without invoking LLM')
  check(g3.escalateToMind && g3.outcome === 'converse' && mem.recall('ana', 'wren').trust === 4, '3rd greet escalates cleanly to engine/mind with accumulated trust')

  // Antagonize -> Antagonize -> Antagonize escalates warn -> defensive -> confront/flee/report.
  const a1 = barks.interact({ actorId: 'gus', subjectId: 'wren', action: 'antagonize', district: 'dogpatch', now: 10 })
  const a2 = barks.interact({ actorId: 'gus', subjectId: 'wren', action: 'antagonize', district: 'dogpatch', now: 12 })
  const a3 = barks.interact({ actorId: 'gus', subjectId: 'wren', action: 'antagonize', district: 'dogpatch', now: 14 })
  check(!a1.escalateToMind && a1.outcome === 'warn' && a1.trustDelta < 0, 'step-1 antagonize gives 0 ms warning')
  check(a2.escalateToMind && a2.outcome === 'defensive', 'step-2 antagonize turns defensive and flags mind escalation')
  check(a3.escalateToMind && a3.outcome === 'confront' && mem.recall('gus', 'wren').trust <= -9, 'step-3 antagonize in defensive district escalates to confront')

  // Antagonize -> Defuse (or Greet) de-escalates cleanly.
  barks.interact({ actorId: 'lena', subjectId: 'wren', action: 'antagonize', district: 'soma', now: 20 })
  const defused = barks.interact({ actorId: 'lena', subjectId: 'wren', action: 'greet', district: 'soma', now: 22 })
  check(defused.outcome === 'defused' && !defused.escalateToMind && defused.moodDelta > 0, 'greet after antagonize defuses escalation')

  // Contextual micro-reactions (PayMo stall, weapon alarm, determinism).
  const paymo1 = generateBark({ actorId: 'milo', subjectId: 'wren', action: 'react', district: 'soma', playerState: { nearStalledPayMo: true } })
  const paymo2 = generateBark({ actorId: 'milo', subjectId: 'wren', action: 'react', district: 'soma', playerState: { nearStalledPayMo: true } })
  check(paymo1.text === paymo2.text && /PayMo/i.test(paymo1.text) && !paymo1.escalateToMind, 'stalled PayMo micro-reaction is deterministic and 0 ms')

  const weapon = generateBark({ actorId: 'milo', subjectId: 'wren', action: 'greet', district: 'fidi', playerState: { holdingWeapon: true }, courage: 0.2 })
  check(weapon.outcome === 'flee' && weapon.escalateToMind && weapon.mood === 'alarmed', 'holding weapon triggers immediate alarmed flee/report escalation')

  // Descriptor match sanity check.
  const dA = descriptorOf({ look: { coat: 'blue' }, vehicle: { model: 'sedan', paint: 'white' } })
  const dB = descriptorOf({ look: { coat: 'blue' }, vehicle: { model: 'sedan', paint: 'white' } })
  const dC = descriptorOf({ look: { coat: 'blue' }, vehicle: { model: 'hatch', paint: 'black' } })
  check(descriptorsMatch(dA, dB).matched && !descriptorsMatch(dA, dC).matched, 'descriptorsMatch matches identical snapshots and rejects swapped vehicles')
}

if (failures.length) {
  console.error(`FAILED\n  ${failures.join('\n  ')}`)
  process.exit(1)
}
console.log('witness-dispatch: ok')
process.exit(0)
