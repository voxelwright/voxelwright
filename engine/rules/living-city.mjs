// Unified Living-City AI Coordinator (#164):
//
// Deterministic, zero-dependency ESM subsystem composing the classical AI
// runtime (#168) and systemic witness/memory/bark/LLM bridge (#169) into one
// cohesive engine coordinator ready for `world.mjs` and rules to drive:
//   - Hierarchical StateTree + Utility AI + Blackboard (`statetree.mjs`)
//   - Spatial Smart Object Registry + geometric voxel scanner + made-thing slots (`smart-objects.mjs`, `make/affordances.mjs`)
//   - Acoustic & visual Stimulus Bus (`stimulus.mjs`)
//   - Actor<->Actor spatial-hashed LOD Sight (`sight.mjs`)
//   - Localized per-NPC Memory, district reputation & 2-hop proximity gossip (`memory.mjs`)
//   - Non-omniscient Witness Chain, descriptor-based Heat & Tactical Dispatch (`dispatch.mjs`)
//   - 0 ms contextual Barks & Greet/Antagonize social escalation (`barks.mjs`)
//   - Sanitized Blackboard-to-`engine/mind` context & BEHAVIOR_NOTES executor (`mind/form.mjs`)
//   - Bounded `directorSummary()` telemetry for the AI Director (`make/director.mjs`)
//
// Time convention: all coordinator `now` and `dt` timestamps are in milliseconds
// (matching `statetree`, `smart-objects`, `stimulus`, and `sight`). Calls into
// `memory`, `dispatch`, and `barks` convert cleanly to seconds (`now / 1000`).
import { createCityNpcTree } from './statetree.mjs'
import { createSmartObjectRegistry } from './smart-objects.mjs'
import { STIMULUS_SPECS, createStimulusBus, personalityFromSeed, rayAttenuation } from './stimulus.mjs'
import { NOTICED, SIGHT, WIDE, sight } from './sight.mjs'
import { createMemory, descriptorOf } from './memory.mjs'
import { createDispatch } from './dispatch.mjs'
import { createBarkEngine, generateBark } from './barks.mjs'
import { inferAffordances, validateAffordances } from '../make/affordances.mjs'
import { BEHAVIOR_NOTES, noted, sanitizeContext } from '../mind/form.mjs'
import { text } from '../text.mjs'

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)
const toSec = (ms) => (Number.isFinite(ms) ? ms / 1000 : 0)

/** Eye/head/chest offsets above feet in 10 cm cells (matching `sight.mjs`). */
const EYES = 16, HEAD = 16, CHEST = 11

/** Default severity for reportable stimuli when caller omits `severity`. */
const DEFAULT_SEVERITY = Object.freeze({
  blast: 4,
  gunshot: 4,
  crime: 2,
  crash: 2,
})

const REPORTABLE_KINDS = new Set(Object.keys(DEFAULT_SEVERITY))
const RECENT_EVENTS_MOST = 16
const NEARBY_MADE_RADIUS = 250
const DEFAULT_REACTION_MS = 8_000

/** Normalize a `[x, y, z]` or `[x, z]` position into `[x, y, z]`. */
function pos3(p, fallback = [0, 0, 0]) {
  if (!Array.isArray(p) || p.length < 2) return [...fallback]
  if (p.length >= 3) return [Number(p[0]) || 0, Number(p[1]) || 0, Number(p[2]) || 0]
  return [Number(p[0]) || 0, 0, Number(p[1]) || 0]
}

/** Normalize weather callback output into `{ rain, fog, night, label }`. */
function normalizeWeather(raw) {
  if (typeof raw === 'string') {
    const label = text(raw, 40).toLowerCase() || 'clear'
    return {
      rain: label === 'rain' ? 0.7 : 0,
      fog: label === 'fog' ? 0.6 : 0,
      night: label === 'night',
      label,
    }
  }
  if (!raw || typeof raw !== 'object') return { rain: 0, fog: 0, night: false, label: 'clear' }
  const rain = Number.isFinite(raw.rain) ? clamp(raw.rain, 0, 1) : 0
  const fog = Number.isFinite(raw.fog) ? clamp(raw.fog, 0, 1) : 0
  const night = Boolean(raw.night)
  const label = typeof raw.label === 'string' && raw.label
    ? text(raw.label, 40).toLowerCase()
    : rain > 0.3 ? 'rain' : fog > 0.4 ? 'fog' : night ? 'night' : 'clear'
  return { rain, fog, night, label }
}

/** Apply optional archetype trait biases on top of deterministic seed traits. */
function resolvePersonality(id, archetype, explicit) {
  const base = personalityFromSeed(id)
  const shaped = { ...base }
  const arch = String(archetype ?? 'civilian').toLowerCase()
  if (arch === 'guard' || arch === 'officer') {
    shaped.bravery = Math.max(shaped.bravery, 0.82)
    shaped.composure = Math.max(shaped.composure, 0.78)
    shaped.civic = Math.max(shaped.civic, 0.9)
  } else if (arch === 'tourist') {
    shaped.curiosity = Math.max(shaped.curiosity, 0.85)
  } else if (arch === 'vendor') {
    shaped.composure = Math.max(shaped.composure, 0.7)
  } else if (arch === 'timid' || arch === 'cautious') {
    shaped.bravery = Math.min(shaped.bravery, 0.2)
    shaped.composure = Math.min(shaped.composure, 0.25)
  }
  if (explicit && typeof explicit === 'object') {
    for (const k of ['bravery', 'composure', 'curiosity', 'civic', 'aggression']) {
      if (Number.isFinite(explicit[k])) shaped[k] = clamp(explicit[k], 0, 1)
    }
  }
  shaped.id = String(id)
  return shaped
}

/** Human-readable activity string from an NPC's active StateTree & Blackboard. */
function describeActivity(npc, madeThings) {
  const state = npc.tree.state ?? 'Walk'
  const intent = npc.tree.blackboard.get('intent') ?? 'walk'
  const slotId = npc.tree.blackboard.get('claimedSlotId')
  const made = slotId ? [...madeThings.values()].find((m) => m.slots.some((s) => s.slotId === slotId)) : null
  const objName = made ? ` ${made.name}` : ''

  if (state === 'Sit' || intent === 'sit') return objName ? `sitting on${objName}` : 'sitting'
  if (state === 'Browse' || intent === 'browse') return objName ? `browsing${objName}` : 'browsing a stall'
  if (state === 'Spectacle' || intent === 'spectacle') return objName ? `admiring${objName}` : 'watching a landmark'
  if (state === 'WeatherShelter' || intent === 'shelter_rain') return 'sheltering from rain'
  if (state === 'Flee' || intent === 'flee') return 'fleeing danger'
  if (state === 'Shelter' || intent === 'shelter') return 'taking cover'
  if (state === 'Film' || intent === 'film') return 'filming the commotion'
  if (state === 'Confront' || intent === 'confront') return 'confronting someone'
  if (state === 'CallHelp' || intent === 'call_help') return 'calling for help'
  if (state === 'Converse' || intent === 'converse') return 'talking with someone'
  if (intent === 'follow') return 'following someone'
  if (intent === 'help') return 'helping someone'
  if (state === 'Commute' || intent === 'commute') return 'commuting'
  return 'walking in the street'
}

/** Map a StateTree leaf state into a gossip-eligibility state for `memory.propagateGossip`. */
function gossipStateOf(npc) {
  const st = npc.tree.state
  if (st === 'Flee' || st === 'Shelter' || st === 'Confront' || st === 'CallHelp') return 'alarmed'
  if (st === 'Converse' || st === 'Chat') return 'conversing'
  if (st === 'Walk' || st === 'Commute') return 'walking'
  return 'calm'
}

/**
 * Create the unified Living-City AI coordinator composing StateTree, Smart
 * Objects, Stimulus Bus, LOD Sight, Memory/Gossip, Witness/Dispatch, 0 ms
 * Fast Barks, and the `engine/mind` Blackboard bridge.
 *
 * @param {object} [opts]
 * @param {(x:number,y:number,z:number)=>number} [opts.kind]
 * @param {Map<string, object>} [opts.folk]
 * @param {()=>number} [opts.now]
 * @param {(pos:number[])=>string} [opts.districtOf]
 * @param {(pos:number[], now:number)=>({rain?:number,fog?:number,night?:boolean,label?:string}|string)} [opts.weatherOf]
 * @param {(actor:object)=>(1|2|3)} [opts.lodOf]
 * @param {number} [opts.sightRange=SIGHT]
 * @param {object} [opts.treeOptions]
 * @param {object} [opts.dispatchOptions]
 * @param {object} [opts.memoryOptions]
 * @param {object} [opts.smartObjectOptions]
 * @param {object} [opts.stimulusOptions]
 */
export function createLivingCity({
  kind = () => 0,
  folk = new Map(),
  now = null,
  districtOf = () => 'downtown',
  weatherOf = () => ({ rain: 0, label: 'clear' }),
  lodOf = null,
  sightRange = SIGHT,
  treeOptions = {},
  dispatchOptions = {},
  memoryOptions = {},
  smartObjectOptions = {},
  stimulusOptions = {},
} = {}) {
  const kindFn = typeof kind === 'function' ? kind : () => 0
  const folkMap = folk instanceof Map ? folk : new Map()
  const districtFn = typeof districtOf === 'function' ? districtOf : () => 'downtown'
  const weatherFn = typeof weatherOf === 'function' ? weatherOf : () => ({ rain: 0, label: 'clear' })
  const lodFn = typeof lodOf === 'function' ? lodOf : null

  let currentNow = typeof now === 'function' ? Number(now()) || 0 : 0
  const clockNow = (override = null) => {
    if (Number.isFinite(override)) {
      if (override > currentNow) currentNow = override
      return override
    }
    if (typeof now === 'function') {
      const v = Number(now())
      if (Number.isFinite(v)) currentNow = v
    }
    return currentNow
  }

  const smartObjects = createSmartObjectRegistry(smartObjectOptions)
  const stimulusBus = createStimulusBus(stimulusOptions)
  const memory = createMemory(memoryOptions)
  const dispatch = createDispatch({ ...dispatchOptions, memory })
  const barks = createBarkEngine({ memory })
  const sightEngine = sight({
    folk: folkMap,
    kind: kindFn,
    actorToActor: true,
    range: sightRange,
    lod: lodFn ? null : true,
    lodOf: lodFn,
  })

  /** npcId -> NPC runtime record */
  const npcs = new Map()
  /** playerId -> player runtime record (pos, vel, yaw, descriptor, playerState, district) */
  const players = new Map()
  /** objectId -> registered player-made thing metadata */
  const madeThings = new Map()
  /** Bounded ring of recent significant world events for Director telemetry. */
  const recentEvents = []
  /** Latest cached Sight map from `sightEngine.now()`. */
  let latestSeen = new Map()

  const districtNameFor = (pos, explicit = null) => {
    const raw = explicit || districtFn(pos) || 'downtown'
    return text(String(raw), 48).toLowerCase() || 'downtown'
  }

  /** Sync an NPC's body into `folkMap` for spatial-hashed Sight. */
  const syncNpcFolk = (npc) => {
    folkMap.set(npc.id, {
      by: npc.id,
      rule: 'living-city',
      seat: null,
      at: [npc.pos[0], npc.pos[1], npc.pos[2]],
      yaw: npc.yaw,
      lod: npc.lod,
    })
  }

  /** Sync a player's body into `folkMap` (`rule: null` so Sight treats them as an anchor/person). */
  const syncPlayerFolk = (player) => {
    folkMap.set(player.id, {
      by: player.id,
      rule: null,
      seat: player.id,
      at: [player.pos[0], player.pos[1], player.pos[2]],
      yaw: player.yaw,
    })
  }

  /** Direct cone + voxel LOS test between an observer and a 3D point (feet position). */
  const canVisuallySee = (viewerPos, viewerYaw, targetPos, range = sightRange) => {
    const far = Math.hypot(targetPos[0] - viewerPos[0], targetPos[2] - viewerPos[2])
    if (far > range || Math.abs(targetPos[1] - viewerPos[1]) > range) return false
    const inCone = far <= NOTICED ||
      (Math.sin(viewerYaw) * (targetPos[0] - viewerPos[0]) - Math.cos(viewerYaw) * (targetPos[2] - viewerPos[2])) / far >= WIDE
    if (!inCone) return false
    const eye = [viewerPos[0], viewerPos[1] + EYES, viewerPos[2]]
    const head = [targetPos[0], targetPos[1] + HEAD, targetPos[2]]
    if (!rayAttenuation(eye, head, kindFn, 'visual').visualBlocked) return true
    const chest = [targetPos[0], targetPos[1] + CHEST, targetPos[2]]
    return !rayAttenuation(eye, chest, kindFn, 'visual').visualBlocked
  }

  /** Build the StateTree evaluation context for one NPC at `nowMs`. */
  const treeCtxFor = (npc, nowMs, extra = {}) => {
    const weather = normalizeWeather(weatherFn(npc.pos, nowMs))
    const computedLod = lodFn ? lodFn(folkMap.get(npc.id) ?? { by: npc.id, at: npc.pos, yaw: npc.yaw, lod: npc.lod }) : npc.lod
    return {
      actorId: npc.id,
      pos: npc.pos,
      now: nowMs,
      rain: weather.rain,
      weather,
      personality: npc.personality,
      smartObjects,
      lod: computedLod,
      commuteTarget: npc.commuteTarget,
      ...extra,
    }
  }

  /** Register a living-city NPC with StateTree, Blackboard, Sight body, and deterministic personality. */
  function registerNpc(id, {
    pos = [0, 0, 0],
    yaw = 0,
    archetype = 'civilian',
    personality = null,
    district = null,
    lod = 1,
    hasPhone = true,
    nearOfficer = false,
    commuteTarget = null,
    courage = null,
    name = null,
    now: nowOverride = null,
  } = {}) {
    const npcId = text(String(id ?? ''), 48)
    if (!npcId) throw new Error('registerNpc requires a non-empty id')
    if (npcs.has(npcId)) removeNpc(npcId)

    const nowMs = clockNow(nowOverride)
    const p3 = pos3(pos)
    const resolvedPersonality = resolvePersonality(npcId, archetype, personality)
    const resolvedCourage = Number.isFinite(courage) ? clamp(courage, 0, 1) : clamp(resolvedPersonality.bravery ?? 0.5, 0, 1)
    const resolvedDistrict = districtNameFor(p3, district)
    const tree = createCityNpcTree(treeOptions)

    const npc = {
      id: npcId,
      name: text(String(name || npcId), 40) || npcId,
      pos: p3,
      yaw: Number.isFinite(yaw) ? yaw : 0,
      archetype: text(String(archetype || 'civilian'), 24).toLowerCase() || 'civilian',
      personality: resolvedPersonality,
      courage: resolvedCourage,
      district: resolvedDistrict,
      lod: lod >= 3 ? 3 : lod === 2 ? 2 : 1,
      hasPhone: hasPhone !== false,
      nearOfficer: Boolean(nearOfficer),
      commuteTarget: Array.isArray(commuteTarget) ? pos3(commuteTarget) : null,
      mood: 'calm',
      tree,
    }

    npcs.set(npcId, npc)
    syncNpcFolk(npc)
    tree.blackboard.set('mood', 'calm', { now: nowMs, priority: 4 })
    tree.start(treeCtxFor(npc, nowMs), nowMs)
    return npc
  }

  /** Update an existing NPC's position, facing, district, LOD, or commute target. */
  function updateNpc(id, patch = {}) {
    const npc = npcs.get(String(id ?? ''))
    if (!npc) return null
    if (Array.isArray(patch.pos)) {
      npc.pos = pos3(patch.pos, npc.pos)
      if (!patch.district) npc.district = districtNameFor(npc.pos)
    }
    if (Number.isFinite(patch.yaw)) npc.yaw = patch.yaw
    if (patch.district) npc.district = districtNameFor(npc.pos, patch.district)
    if (Number.isFinite(patch.lod)) npc.lod = patch.lod >= 3 ? 3 : patch.lod === 2 ? 2 : 1
    if (patch.hasPhone !== undefined) npc.hasPhone = Boolean(patch.hasPhone)
    if (patch.nearOfficer !== undefined) npc.nearOfficer = Boolean(patch.nearOfficer)
    if (patch.commuteTarget !== undefined) {
      npc.commuteTarget = Array.isArray(patch.commuteTarget) ? pos3(patch.commuteTarget) : null
    }
    syncNpcFolk(npc)
    return npc
  }

  /** Remove an NPC, releasing any claimed Smart Object slots and Sight entry. */
  function removeNpc(id) {
    const npcId = String(id ?? '')
    const npc = npcs.get(npcId)
    if (!npc) return false
    smartObjects.releaseAllFor(npcId, clockNow())
    npcs.delete(npcId)
    folkMap.delete(npcId)
    return true
  }

  /** Register or update a player/suspect tracked by Sight, Witness Chains, and Descriptor Heat. */
  function registerPlayer(id, {
    pos = [0, 0, 0],
    vel = [0, 0, 0],
    yaw = 0,
    look = null,
    vehicle = null,
    masked = undefined,
    district = null,
    playerState = {},
    now: nowOverride = null,
  } = {}) {
    const pid = text(String(id ?? ''), 48)
    if (!pid) throw new Error('registerPlayer requires a non-empty id')
    const nowMs = clockNow(nowOverride)
    const p3 = pos3(pos)
    const descriptor = descriptorOf({ look, vehicle, masked })
    const rec = {
      id: pid,
      pos: p3,
      vel: pos3(vel),
      yaw: Number.isFinite(yaw) ? yaw : 0,
      look,
      vehicle,
      masked: descriptor.masked,
      descriptor,
      district: districtNameFor(p3, district),
      playerState: { ...(playerState ?? {}), ...(descriptor.masked ? { masked: true } : {}) },
      updatedAt: nowMs,
    }
    players.set(pid, rec)
    syncPlayerFolk(rec)
    return rec
  }

  /**
   * Update a player's position, velocity, or appearance/vehicle.
   * If appearance/vehicle changes while no dispatch unit holds LOS, notifies
   * `dispatch.notifyUnseenSwap(...)` so descriptor-based evasion works cleanly.
   */
  function updatePlayer(id, patch = {}) {
    const pid = String(id ?? '')
    let rec = players.get(pid)
    if (!rec) return registerPlayer(pid, patch)
    const nowMs = clockNow(patch.now)
    const prevHash = rec.descriptor.hash

    if (Array.isArray(patch.pos)) {
      rec.pos = pos3(patch.pos, rec.pos)
      if (!patch.district) rec.district = districtNameFor(rec.pos)
    }
    if (Array.isArray(patch.vel)) rec.vel = pos3(patch.vel, rec.vel)
    if (Number.isFinite(patch.yaw)) rec.yaw = patch.yaw
    if (patch.district) rec.district = districtNameFor(rec.pos, patch.district)
    if (patch.look !== undefined) rec.look = patch.look
    if (patch.vehicle !== undefined) rec.vehicle = patch.vehicle
    if (patch.masked !== undefined) rec.masked = Boolean(patch.masked)
    if (patch.playerState && typeof patch.playerState === 'object') {
      rec.playerState = { ...rec.playerState, ...patch.playerState }
    }

    const maskedArg = patch.masked !== undefined ? rec.masked : undefined
    rec.descriptor = descriptorOf({ look: rec.look, vehicle: rec.vehicle, masked: maskedArg })
    rec.masked = rec.descriptor.masked
    rec.playerState = { ...rec.playerState, masked: rec.masked }
    rec.updatedAt = nowMs
    syncPlayerFolk(rec)

    let unseenSwap = null
    if (rec.descriptor.hash !== prevHash) {
      unseenSwap = dispatch.notifyUnseenSwap({ newDescriptor: rec.descriptor, now: toSec(nowMs) })
    }
    return { player: rec, unseenSwap }
  }

  /** Remove a tracked player. */
  function removePlayer(id) {
    const pid = String(id ?? '')
    folkMap.delete(pid)
    return players.delete(pid)
  }

  /**
   * Run a patrol unit observation check for a player/suspect.
   * When `hasLos` is omitted, computes voxel LOS between the unit's position
   * and the player so patrol never sees through solid voxel walls.
   */
  function observeSuspect(suspectId, {
    unitId = null,
    hasLos = null,
    committingAct = false,
    descriptor = null,
    pos = null,
    vel = null,
    district = null,
    now: nowOverride = null,
  } = {}) {
    const nowMs = clockNow(nowOverride)
    const player = players.get(String(suspectId ?? ''))
    const p3 = pos ? pos3(pos) : (player ? player.pos : [0, 0, 0])
    const v3 = vel ? pos3(vel) : (player ? player.vel : [0, 0, 0])
    const distName = districtNameFor(p3, district ?? player?.district)
    const desc = descriptor ?? player?.descriptor ?? descriptorOf({})

    let los = typeof hasLos === 'boolean' ? hasLos : null
    if (los === null) {
      const snap = dispatch.snapshot()
      const unit = unitId ? snap.units.find((u) => u.id === unitId) : snap.units[0]
      if (!unit) {
        los = false
      } else {
        const unitEye = [unit.pos[0], p3[1] + EYES, unit.pos[1]]
        const targetHead = [p3[0], p3[1] + HEAD, p3[2]]
        const far = Math.hypot(p3[0] - unit.pos[0], p3[2] - unit.pos[1])
        los = far <= sightRange && !rayAttenuation(unitEye, targetHead, kindFn, 'visual').visualBlocked
      }
    }

    return dispatch.observeSuspect({
      unitId,
      district: distName,
      pos: p3,
      vel: v3,
      hasLos: los,
      descriptor: desc,
      committingAct: Boolean(committingAct),
      now: toSec(nowMs),
    })
  }

  /**
   * Register a player-created voxel object (from Maker or direct record) as a
   * Smart Object so nearby NPCs immediately discover and use its slots.
   */
  function registerMadeThing(thing) {
    if (!thing || typeof thing !== 'object') throw new Error('registerMadeThing requires an object')
    const nowMs = clockNow(thing.now)
    const pos = pos3(thing.pos ?? thing.at ?? [0, 0, 0])
    const size = Array.isArray(thing.size) && thing.size.length === 3 ? thing.size : [16, 16, 16]
    const name = text(String(thing.name || thing.label || thing.wish || 'made object'), 60) || 'made object'
    const id = thing.id ? String(thing.id) : `made:${Math.round(pos[0])}_${Math.round(pos[1])}_${Math.round(pos[2])}`
    const facing = thing.facing ?? 'south'
    const ownerId = thing.ownerId ?? thing.by ?? null

    // Preserve validated explicit affordances (top-level or inside record.behaviour),
    // falling back to geometric + label inference when none were provided.
    const rawAff = thing.affordances ?? thing.behaviour?.affordances ?? thing.record?.behaviour?.affordances ?? null
    let localSlots
    if (rawAff != null) {
      const checked = validateAffordances(rawAff, size)
      localSlots = checked.slots.length > 0
        ? checked.slots
        : inferAffordances({ name, size, cells: thing.cells ?? null }).slots
    } else {
      localSlots = inferAffordances({ name, size, cells: thing.cells ?? null }).slots
    }

    const registered = smartObjects.registerMadeObject({
      id,
      ownerId,
      name,
      label: name,
      pos,
      facing,
      size,
      cells: thing.cells ?? null,
      affordances: localSlots,
    })

    const district = districtNameFor(pos, thing.district)
    const entry = {
      id: registered.id,
      name,
      pos,
      size: [...size],
      facing,
      ownerId,
      district,
      affordances: localSlots,
      slots: registered.slots,
      registeredAt: nowMs,
    }
    madeThings.set(registered.id, entry)

    if (thing.emitStimulus === true) {
      emitStimulus({
        kind: 'made_thing',
        pos,
        actorId: ownerId,
        district,
        now: nowMs,
        meta: { objectId: registered.id, name },
      })
    }

    return entry
  }

  /** Remove a previously registered player-made thing from Smart Objects and telemetry. */
  function unregisterMadeThing(id) {
    const key = String(id ?? '')
    madeThings.delete(key)
    return smartObjects.unregister(key)
  }

  /**
   * Publish an acoustic/visual world stimulus, evaluate perceiving NPCs via
   * acoustic attenuation + voxel Sight, drive immediate event-driven StateTree
   * reactions, and start non-omniscient Witness Chains for reportable incidents.
   */
  function emitStimulus(ev) {
    if (!ev || typeof ev !== 'object') throw new Error('emitStimulus requires an event object')
    const nowMs = clockNow(ev.now)
    const nowSec = toSec(nowMs)
    const pos = pos3(ev.pos)
    const district = districtNameFor(pos, ev.district)
    const suspectId = ev.suspectId ?? ev.actorId ?? null

    const emitted = stimulusBus.emit({
      kind: ev.kind,
      pos,
      radius: ev.radius,
      loudness: ev.loudness,
      decayMs: ev.decayMs,
      modality: ev.modality,
      threat: ev.threat,
      actorId: ev.actorId ?? suspectId,
      meta: ev.meta ?? null,
      now: nowMs,
    })

    const suspectPlayer = suspectId ? players.get(String(suspectId)) : null
    const suspectPos = suspectPlayer ? suspectPlayer.pos : pos
    const perceivedBy = []
    const reactions = {}
    const seeingWitnesses = []

    const reportable = ev.reportable !== undefined
      ? Boolean(ev.reportable)
      : REPORTABLE_KINDS.has(emitted.kind)

    for (const npc of npcs.values()) {
      if (npc.lod >= 3) continue
      const heard = stimulusBus.perceive(
        { id: npc.id, pos: npc.pos, yaw: npc.yaw },
        { kind: kindFn, now: nowMs, maxResults: 6, ignoreSelf: true }
      )
      const hit = heard.find((h) => h.event.id === emitted.id)
      if (!hit) continue

      perceivedBy.push(npc.id)
      const ctx = treeCtxFor(npc, nowMs, { stimulus: hit })
      npc.tree.sendEvent({ type: 'stimulus', stimulus: hit }, ctx, nowMs)
      const reaction = npc.tree.blackboard.get('reaction') ?? 'glance'
      reactions[npc.id] = reaction

      if (reaction === 'flee' || reaction === 'shelter') {
        npc.mood = 'alarmed'
        npc.tree.blackboard.set('mood', 'alarmed', { now: nowMs, priority: 5 })
      } else if (reaction === 'confront') {
        npc.mood = 'angry'
        npc.tree.blackboard.set('mood', 'angry', { now: nowMs, priority: 5 })
      } else if (reaction === 'call_help') {
        npc.mood = 'wary'
        npc.tree.blackboard.set('mood', 'wary', { now: nowMs, priority: 5 })
      }

      if (reportable && npc.id !== suspectId) {
        // Non-omniscient witness rule: NPC must visually see either the suspect
        // or the incident source through clear voxel LOS (never through walls).
        const seesSuspect = (suspectId && latestSeen.get(npc.id)?.has(String(suspectId))) ||
          canVisuallySee(npc.pos, npc.yaw, suspectPos) ||
          (!hit.visualBlocked && canVisuallySee(npc.pos, npc.yaw, pos))
        if (seesSuspect) {
          seeingWitnesses.push({
            id: npc.id,
            pos: npc.pos,
            hasPhone: npc.hasPhone,
            nearOfficer: npc.nearOfficer,
            courage: npc.courage,
            seesSuspect: true,
          })
        }
      }
    }

    let incident = null
    if (reportable) {
      const severity = Number.isFinite(ev.severity) ? ev.severity : (DEFAULT_SEVERITY[emitted.kind] ?? 1)
      const descriptor = ev.descriptor ?? suspectPlayer?.descriptor ?? descriptorOf({})
      incident = dispatch.reportIncident({
        kind: emitted.kind,
        severity,
        pos,
        district,
        suspectId,
        descriptor,
        witnesses: seeingWitnesses,
        cctvNodes: Array.isArray(ev.cctvNodes) ? ev.cctvNodes : [],
        now: nowSec,
      })
    }

    recentEvents.push({
      id: emitted.id,
      kind: emitted.kind,
      district,
      threat: emitted.threat,
      at: nowMs,
      perceivedCount: perceivedBy.length,
    })
    while (recentEvents.length > RECENT_EVENTS_MOST) recentEvents.shift()

    return { event: emitted, perceivedBy, reactions, incident }
  }

  /** Convenience alias: `emitEvent(kind, pos, opts)` -> `emitStimulus({ kind, pos, ...opts })`. */
  function emitEvent(evKind, pos, opts = {}) {
    return emitStimulus({ ...opts, kind: evKind, pos })
  }

  /**
   * Handle a player-to-NPC social interaction (`greet`, `antagonize`, `defuse`,
   * `intimidate`, `apologize`, `bribe`, `block_los`, `react`):
   *   - Runs a 0 ms contextual bark (updating trust & mood)
   *   - Intercepts active witness reports when applicable and checks all
   *     other NPCs with clear LOS for secondary witnesses
   *   - Returns `{ bark, intercepted, interceptResult, secondaryWitnesses, escalateToMind, mindContext }`
   */
  function interactSocial(playerId, npcId, action = 'greet', opts = {}) {
    const npc = npcs.get(String(npcId ?? ''))
    if (!npc) throw new Error(`unknown NPC "${String(npcId)}"`)
    const pid = text(String(playerId ?? 'player'), 48) || 'player'
    const player = players.get(pid)
    const nowMs = clockNow(opts.now)
    const nowSec = toSec(nowMs)
    const act = String(action || 'greet').toLowerCase()
    const district = opts.district ? districtNameFor(npc.pos, opts.district) : npc.district
    const weather = normalizeWeather(weatherFn(npc.pos, nowMs))
    const descriptor = opts.descriptor ?? player?.descriptor ?? descriptorOf({})
    const playerState = { ...(player?.playerState ?? {}), ...(opts.playerState ?? {}) }

    // 1. Check if NPC is an active witness and this action can intercept their report.
    const activeWitness = dispatch.snapshot().witnesses.find(
      (w) => w.witnessId === npc.id && (w.state === 'spotting' || w.state === 'reporting')
    )
    const interceptAction = act === 'intimidate' || act === 'apologize' || act === 'bribe' || act === 'block_los'
      ? act
      : (act === 'defuse' && activeWitness ? 'apologize' : null)

    let interceptResult = null
    let intercepted = false
    let secondaryWitnesses = []

    if (activeWitness && interceptAction) {
      // Discover bystanders who visually witness the intimidation/bribe (zero omniscience).
      let bystanders
      if (Array.isArray(opts.bystanders)) {
        bystanders = opts.bystanders
      } else {
        bystanders = []
        for (const other of npcs.values()) {
          if (other.id === npc.id || other.id === pid || other.lod >= 3) continue
          const sees = (latestSeen.get(other.id)?.has(npc.id) || latestSeen.get(other.id)?.has(pid)) ||
            canVisuallySee(other.pos, other.yaw, npc.pos)
          if (sees) {
            bystanders.push({
              id: other.id,
              pos: other.pos,
              hasPhone: other.hasPhone,
              nearOfficer: other.nearOfficer,
              courage: other.courage,
              seesSuspect: true,
            })
          }
        }
      }

      interceptResult = dispatch.interceptWitness({
        witnessId: npc.id,
        chainId: activeWitness.chainId,
        suspectId: pid,
        action: interceptAction,
        pos: npc.pos,
        descriptor,
        bystanders,
        now: nowSec,
      })
      intercepted = Boolean(interceptResult.intercepted)
      secondaryWitnesses = interceptResult.secondaryWitnesses ?? []

      // Push classical reactions onto any secondary witnesses who spotted the intimidation.
      for (const sw of secondaryWitnesses) {
        const bystanderNpc = npcs.get(sw.witnessId)
        if (!bystanderNpc) continue
        const stim = {
          event: { id: 0, kind: 'crime', pos: npc.pos, threat: STIMULUS_SPECS.crime.threat, loudness: 0.85 },
          kind: 'crime',
          salience: 0.9,
          distance: Math.hypot(bystanderNpc.pos[0] - npc.pos[0], bystanderNpc.pos[2] - npc.pos[2]),
        }
        bystanderNpc.mood = 'alarmed'
        bystanderNpc.tree.blackboard.set('mood', 'alarmed', { now: nowMs, priority: 5 })
        bystanderNpc.tree.sendEvent({ type: 'stimulus', stimulus: stim }, treeCtxFor(bystanderNpc, nowMs, { stimulus: stim }), nowMs)
      }
    }

    // 2. Resolve 0 ms procedural bark and update trust/memory consistently.
    let bark
    if (act === 'greet' || act === 'antagonize' || act === 'defuse' || act === 'react') {
      bark = barks.interact({
        actorId: npc.id,
        subjectId: pid,
        action: act,
        district,
        weather: weather.label,
        playerState,
        courage: npc.courage,
        now: nowSec,
        seed: opts.seed ?? 0,
      })
    } else if (act === 'intimidate') {
      if (!interceptResult) {
        memory.remember(npc.id, pid, { trustDelta: -4, tag: 'threatened', descriptor, now: nowSec })
      }
      bark = generateBark({
        actorId: npc.id,
        subjectId: pid,
        district,
        trust: memory.recall(npc.id, pid).trust,
        weather: weather.label,
        playerState,
        action: 'antagonize',
        step: intercepted ? 2 : 3,
        courage: npc.courage,
        seed: opts.seed ?? 0,
      })
      if (intercepted) {
        bark = {
          ...bark,
          text: 'Alright, alright—I did not see a thing! Just leave me alone!',
          mood: 'alarmed',
          outcome: 'flee',
          escalateToMind: true,
        }
      }
    } else if (act === 'apologize') {
      if (!interceptResult) {
        bark = barks.interact({
          actorId: npc.id,
          subjectId: pid,
          action: 'defuse',
          district,
          weather: weather.label,
          playerState,
          courage: npc.courage,
          now: nowSec,
          seed: opts.seed ?? 0,
        })
      } else {
        bark = generateBark({
          actorId: npc.id,
          subjectId: pid,
          district,
          trust: memory.recall(npc.id, pid).trust,
          weather: weather.label,
          playerState,
          action: intercepted ? 'defuse' : 'antagonize',
          step: intercepted ? 1 : 2,
          courage: npc.courage,
          seed: opts.seed ?? 0,
        })
      }
    } else if (act === 'bribe') {
      if (!interceptResult) {
        memory.remember(npc.id, pid, { trustDelta: 1, tag: 'bribed', descriptor, now: nowSec })
      }
      bark = {
        text: intercepted ? 'Keep walking—my phone stays in my pocket.' : 'Keep your money. I am still calling this in.',
        tone: generateBark({ district }).tone,
        mood: intercepted ? 'wary' : 'angry',
        moodDelta: intercepted ? 0 : -2,
        trustDelta: intercepted ? 1 : -2,
        escalateToMind: true,
        outcome: intercepted ? 'defused' : 'report',
        step: 1,
        ms: 0,
      }
    } else {
      bark = generateBark({
        actorId: npc.id,
        subjectId: pid,
        district,
        trust: memory.recall(npc.id, pid).trust,
        weather: weather.label,
        playerState,
        action: 'react',
        courage: npc.courage,
        seed: opts.seed ?? 0,
      })
    }

    // 3. Reflect social outcome in NPC mood & StateTree.
    npc.mood = bark.mood || npc.mood
    npc.tree.blackboard.set('mood', npc.mood, { now: nowMs, priority: 5 })
    if (bark.outcome === 'flee') {
      npc.tree.blackboard.set('reaction', 'flee', { now: nowMs, ttlMs: DEFAULT_REACTION_MS, priority: 6 })
      npc.tree.blackboard.set('stateUntil', nowMs + DEFAULT_REACTION_MS, { now: nowMs })
      npc.tree.transitionTo('Flee', treeCtxFor(npc, nowMs), nowMs)
    } else if (bark.outcome === 'confront') {
      npc.tree.blackboard.set('reaction', 'confront', { now: nowMs, ttlMs: DEFAULT_REACTION_MS, priority: 6 })
      npc.tree.blackboard.set('stateUntil', nowMs + DEFAULT_REACTION_MS, { now: nowMs })
      npc.tree.transitionTo('Confront', treeCtxFor(npc, nowMs), nowMs)
    } else if (bark.outcome === 'converse') {
      npc.tree.sendEvent({ type: 'converse', partnerId: pid }, treeCtxFor(npc, nowMs, { partnerId: pid }), nowMs)
    }

    const escalateToMind = Boolean(bark.escalateToMind || opts.forceMind)
    const mindContext = buildMindContext(npc.id, pid, { now: nowMs })

    return {
      bark,
      intercepted,
      interceptResult,
      secondaryWitnesses,
      escalateToMind,
      mindContext,
    }
  }

  /**
   * Build a strictly sanitized Blackboard context object (`district`, `weather`,
   * `activity`, `mood`, `reputation`, `witnessed`, `nearby_made`) ready for
   * `world.think(id, { context, notes: BEHAVIOR_NOTES })` and `form.mjs:asked()`.
   */
  function buildMindContext(npcId, speakerId, opts = {}) {
    const npc = npcs.get(String(npcId ?? ''))
    const nowMs = clockNow(opts.now)
    const nowSec = toSec(nowMs)
    const pos = npc ? npc.pos : pos3(opts.pos)
    const district = opts.district ? districtNameFor(pos, opts.district) : (npc?.district ?? districtNameFor(pos))
    const weather = opts.weather ? text(String(opts.weather), 40) : normalizeWeather(weatherFn(pos, nowMs)).label
    const activity = opts.activity ?? (npc ? describeActivity(npc, madeThings) : 'walking in the street')
    const mood = opts.mood ?? npc?.tree?.blackboard.get('mood') ?? npc?.mood ?? ''

    // Gather nearby player-made things (raw names are sanitized by `sanitizeContext`).
    const radius = Number.isFinite(opts.madeRadius) ? opts.madeRadius : NEARBY_MADE_RADIUS
    const nearbyMade = []
    if (Array.isArray(opts.nearbyMade)) {
      nearbyMade.push(...opts.nearbyMade)
    } else {
      const scored = []
      for (const m of madeThings.values()) {
        const d = Math.hypot(m.pos[0] - pos[0], m.pos[2] - pos[2])
        if (d <= radius) {
          const kinds = [...new Set(m.affordances.map((a) => a.kind))]
          scored.push({ d, label: kinds.length ? `${m.name} (${kinds.join(', ')})` : m.name })
        }
      }
      scored.sort((a, b) => a.d - b.d)
      for (const s of scored.slice(0, 4)) nearbyMade.push(s.label)
    }

    const rawCtx = memory.blackboardFor(String(npcId ?? ''), String(speakerId ?? ''), {
      district,
      weather,
      activity,
      mood,
      nearbyMade,
      now: nowSec,
    })

    return sanitizeContext(rawCtx) ?? { district, mood: 'calm' }
  }

  /**
   * Apply validated `BEHAVIOR_NOTES` (`mood`, `intent`, `trust_delta`, `rumor`)
   * returned by `engine/mind` directly into the NPC's StateTree Blackboard,
   * Memory, local Gossip queue, and Witness/Dispatch state.
   */
  function applyMindThought(npcId, speakerId, notes, nowOverride = null) {
    const npc = npcs.get(String(npcId ?? ''))
    if (!npc) throw new Error(`unknown NPC "${String(npcId)}"`)
    const pid = text(String(speakerId ?? 'player'), 48) || 'player'
    const player = players.get(pid)
    const nowMs = clockNow(nowOverride)
    const nowSec = toSec(nowMs)

    // Strictly coerce untrusted model notes through `engine/mind/form.mjs`.
    const applied = noted(BEHAVIOR_NOTES, notes)

    if (applied.mood) {
      npc.mood = applied.mood
      npc.tree.blackboard.set('mood', applied.mood, { now: nowMs, priority: 5 })
    }

    if (typeof applied.trust_delta === 'number' && applied.trust_delta !== 0) {
      memory.remember(npc.id, pid, {
        trustDelta: applied.trust_delta,
        tag: applied.trust_delta > 0 ? 'helped' : 'antagonized',
        descriptor: player?.descriptor ?? null,
        now: nowSec,
      })
    }

    let rumorQueued = false
    if (applied.rumor === true) {
      memory.recordWitnessed(npc.id, {
        kind: 'rumor',
        severity: 2,
        district: npc.district,
        pos: npc.pos,
        suspectId: pid,
        descriptor: player?.descriptor ?? null,
        salience: 0.78,
        hops: 0,
        source: 'conversation',
        t: nowSec,
      })
      rumorQueued = true
    }

    let reported = null
    const ctx = treeCtxFor(npc, nowMs, { partnerId: pid })
    if (applied.intent === 'flee') {
      npc.tree.blackboard.set('reaction', 'flee', { now: nowMs, ttlMs: DEFAULT_REACTION_MS, priority: 6 })
      npc.tree.blackboard.set('stateUntil', nowMs + DEFAULT_REACTION_MS, { now: nowMs })
      npc.tree.transitionTo('Flee', ctx, nowMs)
      npc.tree.blackboard.set('intent', 'flee', { now: nowMs, priority: 6 })
    } else if (applied.intent === 'confront') {
      npc.tree.blackboard.set('reaction', 'confront', { now: nowMs, ttlMs: DEFAULT_REACTION_MS, priority: 6 })
      npc.tree.blackboard.set('stateUntil', nowMs + DEFAULT_REACTION_MS, { now: nowMs })
      npc.tree.transitionTo('Confront', ctx, nowMs)
      npc.tree.blackboard.set('intent', 'confront', { now: nowMs, priority: 6 })
    } else if (applied.intent === 'report') {
      npc.tree.blackboard.set('reaction', 'call_help', { now: nowMs, ttlMs: DEFAULT_REACTION_MS, priority: 6 })
      npc.tree.blackboard.set('stateUntil', nowMs + DEFAULT_REACTION_MS, { now: nowMs })
      npc.tree.transitionTo('CallHelp', ctx, nowMs)
      npc.tree.blackboard.set('intent', 'call_help', { now: nowMs, priority: 6 })
      const alreadyReporting = dispatch.snapshot().witnesses.some(
        (w) => w.witnessId === npc.id && (w.state === 'spotting' || w.state === 'reporting')
      )
      if (!alreadyReporting) {
        reported = dispatch.reportIncident({
          kind: 'disturbance',
          severity: 1,
          pos: player ? player.pos : npc.pos,
          district: npc.district,
          suspectId: pid,
          descriptor: player?.descriptor ?? descriptorOf({}),
          witnesses: [{
            id: npc.id,
            pos: npc.pos,
            hasPhone: npc.hasPhone,
            nearOfficer: npc.nearOfficer,
            courage: npc.courage,
            seesSuspect: true,
          }],
          now: nowSec,
        })
      }
    } else if (applied.intent === 'follow') {
      npc.tree.transitionTo('Converse', ctx, nowMs)
      npc.tree.blackboard.set('intent', 'follow', { now: nowMs, priority: 5 })
      npc.tree.blackboard.set('partnerId', pid, { now: nowMs, priority: 4 })
    } else if (applied.intent === 'help') {
      npc.tree.transitionTo('Converse', ctx, nowMs)
      npc.tree.blackboard.set('intent', 'help', { now: nowMs, priority: 5 })
      npc.tree.blackboard.set('partnerId', pid, { now: nowMs, priority: 4 })
    } else if (applied.intent === 'use_object') {
      npc.tree.transitionTo('SmartActivity', ctx, nowMs)
    } else if (applied.intent === 'stay') {
      npc.tree.blackboard.set('intent', 'stay', { now: nowMs, priority: 4 })
    }

    return {
      applied,
      state: npc.tree.state,
      intent: npc.tree.blackboard.get('intent'),
      mood: npc.mood,
      trust: memory.recall(npc.id, pid).trust,
      rumorQueued,
      reported,
    }
  }

  /**
   * Build a bounded telemetry summary for the AI Director (`make/director.mjs`).
   */
  function directorSummary(nowOverride = null) {
    const nowMs = clockNow(nowOverride)
    const nowSec = toSec(nowMs)
    const dSnap = dispatch.snapshot()

    // Collect known districts across NPCs, BOLOs, made things, and recent events.
    const districtSet = new Set()
    for (const npc of npcs.values()) districtSet.add(npc.district)
    for (const b of dSnap.bolos) districtSet.add(b.district)
    for (const m of madeThings.values()) districtSet.add(m.district)
    for (const e of recentEvents) districtSet.add(e.district)

    const districtHeat = {}
    for (const dist of districtSet) {
      const rep = memory.districtReputation(dist, nowSec)
      const activeBolos = dSnap.bolos.filter((b) => b.district === dist && (b.status === 'active' || b.status === 'searching'))
      const heat = activeBolos.reduce((mx, b) => Math.max(mx, b.heat), 0)
      districtHeat[dist] = {
        heat,
        reputation: rep.score,
        attitude: rep.attitude,
        activeBolos: activeBolos.length,
        recentIncidents: rep.wantedHistory.length,
      }
    }

    const activeWitnesses = dSnap.witnesses
      .filter((w) => w.state === 'spotting' || w.state === 'reporting')
      .slice(0, 8)
      .map((w) => ({
        chainId: w.chainId,
        witnessId: w.witnessId,
        state: w.state,
        method: w.method,
        kind: w.kind,
        district: w.district,
        reportEndsAt: w.reportEndsAt,
      }))

    const counts = { calm: 0, warm: 0, wary: 0, annoyed: 0, angry: 0, alarmed: 0 }
    for (const npc of npcs.values()) {
      const m = Object.hasOwn(counts, npc.mood) ? npc.mood : 'calm'
      counts[m]++
    }
    let dominant = 'calm'
    let topCount = -1
    for (const [m, c] of Object.entries(counts)) {
      if (c > topCount) { topCount = c; dominant = m }
    }
    const totalNpcs = npcs.size
    const panicRatio = totalNpcs > 0
      ? Number(((counts.alarmed + counts.angry) / totalNpcs).toFixed(3))
      : 0

    const madeAffordances = [...madeThings.values()].slice(0, 8).map((m) => {
      const kinds = [...new Set(m.slots.map((s) => s.kind))]
      let claimedCount = 0
      for (const s of m.slots) {
        if (smartObjects.isClaimed(s.slotId, nowMs)) claimedCount++
      }
      return {
        id: m.id,
        name: m.name,
        district: m.district,
        kinds,
        slotCount: m.slots.length,
        claimedCount,
      }
    })

    return {
      now: nowMs,
      maxHeat: dSnap.heat,
      districtHeat,
      activeWitnesses,
      crowdMood: { dominant, counts, panicRatio, totalNpcs },
      recentEvents: recentEvents.slice(-8).map((e) => ({ ...e })),
      madeAffordances,
    }
  }

  /**
   * Advance the entire Living-City simulation to `now` (ms):
   *   1. Sweep expired Smart Object leases & decayed stimuli
   *   2. Run LOD-throttled spatial-hashed Sight
   *   3. Tick each NPC's scheduled StateTree (with weather, stimuli, Smart Objects)
   *   4. Propagate bounded local proximity gossip between calm/conversing NPCs
   *   5. Advance Witness Chains, BOLO search timers, and Tactical Dispatch units
   * Returns a bounded `directorSummary(now)`.
   */
  function step(nowMs, dt = 0) {
    const t = clockNow(Number.isFinite(nowMs) ? nowMs : currentNow + (Number.isFinite(dt) ? dt : 0))
    const tSec = toSec(t)

    smartObjects.sweepExpired(t)
    stimulusBus.sweep(t)
    latestSeen = sightEngine.now(t)

    const gossipActors = []
    for (const npc of npcs.values()) {
      const ctx = treeCtxFor(npc, t)
      // Only perceive stimuli for LOD 1/2 actors when their StateTree can tick.
      if (ctx.lod < 3 && npc.tree.canTick(t)) {
        const perceived = stimulusBus.perceive(
          { id: npc.id, pos: npc.pos, yaw: npc.yaw },
          { kind: kindFn, now: t, maxResults: 2, ignoreSelf: true }
        )
        if (perceived.length > 0 && !npc.tree.isIn('ReactStimulus')) {
          ctx.stimulus = perceived[0]
        }
      }
      npc.tree.tick(ctx, t)
      gossipActors.push({ id: npc.id, pos: npc.pos, state: gossipStateOf(npc) })
    }

    memory.propagateGossip(gossipActors, tSec)
    dispatch.tick(tSec)

    return directorSummary(t)
  }

  return {
    // Subsystems (read-only handles for inspection & direct composition)
    smartObjects,
    stimulusBus,
    sight: sightEngine,
    memory,
    dispatch,
    barks,
    folk: folkMap,

    // Actor & player management
    registerNpc,
    updateNpc,
    removeNpc,
    getNpc: (id) => npcs.get(String(id ?? '')) ?? null,
    get npcCount() { return npcs.size },
    registerPlayer,
    updatePlayer,
    removePlayer,
    getPlayer: (id) => players.get(String(id ?? '')) ?? null,
    observeSuspect,
    observePlayer: observeSuspect,

    // Smart Objects & player-made creations
    registerMadeThing,
    onMadeThing: registerMadeThing,
    unregisterMadeThing,
    registerCitySlots: (entries) => smartObjects.registerCitySlots(entries),
    scanRegion: (bounds, opts) => smartObjects.scanRegion(kindFn, bounds, opts),

    // Stimuli, social interaction & hybrid LLM bridge
    emitStimulus,
    emitEvent,
    interactSocial,
    buildMindContext,
    applyMindThought,

    // Simulation tick & Director telemetry
    step,
    directorSummary,
  }
}
