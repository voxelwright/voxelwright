// Non-omniscient Witness Chain FSM, Descriptor-Based Heat & WantedHistory, and Tactical Dispatch (#164).
//
// Core invariants:
//   1. Zero omniscience: an incident with 0 perceiving witnesses and 0 active CCTV triggers ZERO dispatch.
//   2. Interceptable reporting window: civilian witnesses transition spotting -> reporting (4-8 s countdown);
//      the player can intercept (intimidate, apologize, bribe, block_los) to abort the report — and any
//      bystander who sees an intimidation spawns a secondary witness chain.
//   3. Descriptor-based Heat: warrants/BOLOs bind to what was seen (`descriptorOf`), not internal player IDs.
//      Breaking LOS and swapping vehicle or outfit evades patrol recognition unless committing a new act
//      or returning in the reported car/outfit.
//   4. Tactical Dispatch: units move to last-known sighting vectors and compute ring/flank search waypoints
//      (never magically chasing live coordinates when out of LOS).
import { text } from '../text.mjs'
import { createMemory, descriptorOf, descriptorsMatch } from './memory.mjs'

export const WITNESS_STATES = Object.freeze(['spotting', 'reporting', 'reported', 'intercepted', 'abandoned'])
export const REPORT_METHODS = Object.freeze(['phone', 'flee_to_officer', 'yell'])
export const UNIT_STATES = Object.freeze([
  'calm', 'investigating', 'questioning_witness', 'searching_perimeter', 'pursuing', 'standing_down',
])
export const BOLO_STATES = Object.freeze(['active', 'searching', 'evaded', 'cleared'])

const SPOT_DELAY_S = 1.0
const LOS_GRACE_S = 5.0
const SEARCH_DURATION_S = 20.0
const SEARCH_EVADED_DURATION_S = 12.0
const STAND_DOWN_S = 6.0

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

/** Deterministic hash in [0, 1) from string seed. */
function hash01(seed) {
  let h = 0x811c9dc5
  const s = String(seed)
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return (h >>> 0) / 0x100000000
}

/** Normalize [x, z] or [x, y, z] position to [x, z] pair. */
function pos2(p) {
  if (!Array.isArray(p)) return [0, 0]
  return [Number(p[0]) || 0, Number(p.length >= 3 ? p[2] : p[1]) || 0]
}

/**
 * Compute tactical ring and flank search waypoints around the last-known sighting vector.
 * Units bias forward along `lastKnownVel` (if non-zero) and fan out across flanking perimeter angles.
 */
export function computeSearchWaypoints(lastKnownPos, lastKnownVel = [0, 0], unitCount = 2, radius = 45) {
  const [lx, lz] = pos2(lastKnownPos)
  const [vx, vz] = pos2(lastKnownVel)
  const speed = Math.hypot(vx, vz)
  const heading = speed > 0.1 ? Math.atan2(vz, vx) : 0
  const lead = speed > 0.1 ? Math.min(radius * 0.6, speed * 3) : 0
  const cx = lx + Math.cos(heading) * lead
  const cz = lz + Math.sin(heading) * lead
  const count = Math.max(1, Math.min(8, Math.floor(unitCount)))
  const out = []
  for (let i = 0; i < count; i++) {
    // Lead unit takes forward/flank-0, remaining units form an encompassing perimeter ring.
    const angle = heading + (i * Math.PI * 2) / count
    const r = i === 0 && lead > 0 ? radius * 0.55 : radius
    out.push({
      role: i === 0 ? 'point' : i % 2 === 1 ? 'flank_left' : 'flank_right',
      pos: [Math.round(cx + Math.cos(angle) * r), Math.round(cz + Math.sin(angle) * r)],
      angle: Number(angle.toFixed(3)),
      radius: Math.round(r),
    })
  }
  return out
}

/** Choose witness reporting method & 4-8 s countdown deterministically. */
function pickReportPlan(witness, incidentId) {
  const r = hash01(`${incidentId}:${witness.id}`)
  if (witness.nearOfficer) {
    return { method: 'flee_to_officer', countdown: Number((4.0 + r * 2.0).toFixed(2)) }
  }
  if (witness.hasPhone !== false) {
    return { method: 'phone', countdown: Number((4.5 + r * 3.0).toFixed(2)) }
  }
  return { method: 'yell', countdown: Number((5.0 + r * 3.0).toFixed(2)) }
}

/**
 * Create the systemic Witness Chain & Tactical Dispatch engine.
 */
export function createDispatch({
  memory = createMemory(),
  spotDelay = SPOT_DELAY_S,
  losGrace = LOS_GRACE_S,
  searchDuration = SEARCH_DURATION_S,
  evadedSearchDuration = SEARCH_EVADED_DURATION_S,
  standDownDuration = STAND_DOWN_S,
} = {}) {
  /** witnessChainId -> witness record */
  const witnesses = new Map()
  /** boloId -> BOLO warrant bound to descriptor */
  const bolos = new Map()
  /** unitId -> patrol unit FSM */
  const units = new Map()
  let seq = 0

  const activeBoloForDescriptor = (descriptor) => {
    for (const b of bolos.values()) {
      if (b.status === 'cleared') continue
      if (descriptorsMatch(b.descriptor, descriptor).matched) return b
    }
    return null
  }

  /** Ensure patrol units exist and are assigned to a BOLO proportional to heat. */
  const assignUnitsForBolo = (bolo, witnessPos, now) => {
    const needed = clamp(bolo.heat, 1, 5)
    const assigned = [...units.values()].filter((u) => u.boloId === bolo.id)
    const waypoints = computeSearchWaypoints(bolo.lastKnownPos, bolo.lastKnownVel, needed, bolo.searchRadius)
    for (let i = assigned.length; i < needed; i++) {
      const uid = `unit-${++seq}`
      const wp = waypoints[i % waypoints.length]
      const unit = {
        id: uid,
        boloId: bolo.id,
        state: i === 0 && witnessPos ? 'investigating' : 'investigating',
        pos: [bolo.lastKnownPos[0] + (i + 1) * 35, bolo.lastKnownPos[1] - (i + 1) * 20],
        targetPos: witnessPos ? [...witnessPos] : [...bolo.lastKnownPos],
        searchWaypoint: wp,
        hasLos: false,
        witnessId: i === 0 ? (bolo.reportedBy[0] ?? null) : null,
        stateEnteredAt: now,
        lastSightingAt: 0,
      }
      units.set(uid, unit)
      assigned.push(unit)
    }
    // Refresh search waypoints across all assigned units.
    const freshWps = computeSearchWaypoints(bolo.lastKnownPos, bolo.lastKnownVel, assigned.length, bolo.searchRadius)
    assigned.forEach((u, idx) => { u.searchWaypoint = freshWps[idx % freshWps.length] })
    return assigned
  }

  /** Escalate a reported crime (from witness completion or CCTV) into a descriptor-bound BOLO & dispatch. */
  const fileReport = ({ incidentId, kind, severity, pos, district, suspectId, descriptor, reporterId, reporterPos, source, now }) => {
    const desc = descriptor ?? descriptorOf({})
    const p = pos2(pos)
    // Record in district WantedHistory first so repeat offenses in the district elevate Heat.
    memory.recordDistrictIncident(district, { id: incidentId, kind, severity, descriptor: desc, suspectId, pos: p, now })
    const matchingPrior = memory.districtMatchingIncidents(district, desc, now).length
    const heatBonus = matchingPrior >= 2 ? 1 : 0
    const computedHeat = clamp(Math.round(severity) + heatBonus, 1, 5)

    let bolo = activeBoloForDescriptor(desc)
    if (bolo) {
      bolo.heat = clamp(Math.max(bolo.heat, computedHeat), 1, 5)
      bolo.status = 'active'
      bolo.lastKnownPos = [...p]
      bolo.lastSeenAt = now
      bolo.searchStartedAt = null
      bolo.descriptorSwappedUnseen = false
      if (reporterId && !bolo.reportedBy.includes(reporterId)) bolo.reportedBy.push(reporterId)
      bolo.searchRadius = 35 + bolo.heat * 12
    } else {
      const id = `bolo-${++seq}`
      bolo = {
        id,
        incidentId,
        kind: text(String(kind), 32) || 'incident',
        descriptor: desc,
        heat: computedHeat,
        status: 'active',
        district: text(String(district || 'downtown'), 48).toLowerCase() || 'downtown',
        lastKnownPos: [...p],
        lastKnownVel: [0, 0],
        lastSeenAt: now,
        startedAt: now,
        searchStartedAt: null,
        descriptorSwappedUnseen: false,
        searchRadius: 35 + computedHeat * 12,
        reportedBy: reporterId ? [reporterId] : [],
        source,
      }
      bolos.set(id, bolo)
    }

    const assigned = assignUnitsForBolo(bolo, source === 'witness' ? pos2(reporterPos ?? p) : null, now)
    return { bolo, units: assigned }
  }

  /** Spawn witness chain records for perceiving civilians. */
  const spawnWitnesses = ({ incidentId, kind, severity, pos, district, suspectId, descriptor, list, now, parentIncidentId = null }) => {
    const created = []
    for (const w of list) {
      if (!w || !w.id || w.seesSuspect === false) continue
      const plan = pickReportPlan(w, incidentId)
      const chainId = `wit-${++seq}`
      const rec = {
        chainId,
        witnessId: String(w.id),
        incidentId,
        parentIncidentId,
        kind: text(String(kind), 32) || 'incident',
        severity: clamp(Number(severity) || 1, 1, 5),
        pos: pos2(pos),
        witnessPos: pos2(w.pos ?? pos),
        district: text(String(district || 'downtown'), 48).toLowerCase() || 'downtown',
        suspectId: suspectId ? String(suspectId) : null,
        descriptor: descriptor ?? descriptorOf({}),
        courage: clamp(Number(w.courage ?? 0.5), 0, 1),
        state: 'spotting',
        method: plan.method,
        spotEndsAt: now + spotDelay,
        reportDuration: plan.countdown,
        reportEndsAt: now + spotDelay + plan.countdown,
        startedAt: now,
        interceptedBy: null,
        boloId: null,
      }
      witnesses.set(chainId, rec)
      memory.recordWitnessed(rec.witnessId, {
        id: incidentId,
        t: now,
        kind: rec.kind,
        severity: rec.severity,
        district: rec.district,
        pos: rec.pos,
        suspectId: rec.suspectId,
        descriptor: rec.descriptor,
        hops: 0,
        source: 'firsthand',
      })
      created.push(rec)
    }
    return created
  }

  return {
    memory,

    /**
     * Report a world incident (crime, blast, assault, theft).
     * ZERO OMNISCIENCE: if no witness perceived it and no active CCTV saw it, nothing is dispatched.
     */
    reportIncident({
      kind = 'crime',
      severity = 1,
      pos = [0, 0],
      district = 'downtown',
      suspectId = null,
      descriptor = null,
      witnesses: witnessList = [],
      cctvNodes = [],
      now = 0,
    } = {}) {
      const perceiving = Array.isArray(witnessList) ? witnessList.filter((w) => w && w.id && w.seesSuspect !== false) : []
      const activeCctv = Array.isArray(cctvNodes) ? cctvNodes.filter((c) => c && c.id && c.active !== false) : []

      if (perceiving.length === 0 && activeCctv.length === 0) {
        return {
          dispatched: false,
          incidentId: null,
          witnesses: [],
          cctv: [],
          bolo: null,
          reason: 'no_witnesses',
        }
      }

      const incidentId = `inc-${++seq}`
      const desc = descriptor ?? descriptorOf({})
      const spawned = spawnWitnesses({
        incidentId, kind, severity, pos, district, suspectId, descriptor: desc, list: perceiving, now,
      })

      let bolo = null
      const cctvIds = []
      if (activeCctv.length > 0) {
        for (const cam of activeCctv) cctvIds.push(String(cam.id))
        const filed = fileReport({
          incidentId,
          kind,
          severity,
          pos,
          district,
          suspectId,
          descriptor: desc,
          reporterId: `cctv:${cctvIds[0]}`,
          reporterPos: pos,
          source: 'cctv',
          now,
        })
        bolo = filed.bolo
      }

      return {
        dispatched: Boolean(bolo),
        incidentId,
        witnesses: spawned.map((w) => ({
          chainId: w.chainId,
          witnessId: w.witnessId,
          state: w.state,
          method: w.method,
          reportEndsAt: w.reportEndsAt,
        })),
        cctv: cctvIds,
        bolo: bolo ? { id: bolo.id, heat: bolo.heat, status: bolo.status, descriptorHash: bolo.descriptor.hash } : null,
        reason: bolo ? 'cctv_reported' : 'witness_window_open',
      }
    },

    /**
     * Intercept an active witness during their spotting/reporting countdown.
     * Actions: 'intimidate' | 'apologize' | 'bribe' | 'block_los'.
     * If bystanders perceive an intimidation, secondary witness chains spawn!
     */
    interceptWitness({
      witnessId,
      chainId = null,
      suspectId = null,
      action = 'intimidate',
      pos = null,
      descriptor = null,
      bystanders = [],
      now = 0,
    } = {}) {
      const target = chainId
        ? witnesses.get(chainId)
        : [...witnesses.values()].find((w) => w.witnessId === String(witnessId) && (w.state === 'spotting' || w.state === 'reporting'))
      if (!target) return { ok: false, intercepted: false, reason: 'no_active_witness', secondaryWitnesses: [] }
      if (target.state !== 'spotting' && target.state !== 'reporting') {
        return { ok: false, intercepted: false, reason: `witness_${target.state}`, secondaryWitnesses: [] }
      }

      let succeeded = false
      let reason = 'failed'
      const act = String(action)
      if (act === 'intimidate') {
        succeeded = target.courage < 0.95
        reason = succeeded ? 'intimidated' : 'witness_fearless'
        if (suspectId) memory.remember(target.witnessId, suspectId, { trustDelta: -4, tag: 'threatened', descriptor: descriptor ?? target.descriptor, now })
      } else if (act === 'apologize') {
        succeeded = target.severity <= 1
        reason = succeeded ? 'apologized' : 'too_severe_for_apology'
        if (suspectId) memory.remember(target.witnessId, suspectId, { trustDelta: succeeded ? 1 : -1, tag: 'apologized', descriptor: descriptor ?? target.descriptor, now })
      } else if (act === 'bribe') {
        succeeded = target.severity <= 3
        reason = succeeded ? 'bribed' : 'too_severe_for_bribe'
        if (suspectId) memory.remember(target.witnessId, suspectId, { trustDelta: succeeded ? 1 : -2, tag: 'bribed', descriptor: descriptor ?? target.descriptor, now })
      } else if (act === 'block_los') {
        succeeded = target.state === 'spotting' || target.reportEndsAt - now > 0.5
        reason = succeeded ? 'los_blocked' : 'too_late_to_block'
      } else {
        return { ok: false, intercepted: false, reason: 'unknown_action', secondaryWitnesses: [] }
      }

      if (succeeded) {
        target.state = 'intercepted'
        target.interceptedBy = act
      }

      // Secondary witness rule: if bystanders witness an intimidation (or high-severity bribe), spawn new witness chains!
      const secondaryWitnesses = []
      if (act === 'intimidate' || (act === 'bribe' && target.severity >= 2)) {
        const seeingBystanders = (Array.isArray(bystanders) ? bystanders : [])
          .filter((b) => b && b.id && String(b.id) !== target.witnessId && b.seesSuspect !== false)
        if (seeingBystanders.length > 0) {
          const secIncidentId = `inc-${++seq}`
          const spawned = spawnWitnesses({
            incidentId: secIncidentId,
            parentIncidentId: target.incidentId,
            kind: act === 'intimidate' ? 'witness_intimidation' : 'witness_bribery',
            severity: Math.max(target.severity, 2),
            pos: pos ?? target.witnessPos,
            district: target.district,
            suspectId: suspectId ?? target.suspectId,
            descriptor: descriptor ?? target.descriptor,
            list: seeingBystanders,
            now,
          })
          for (const s of spawned) {
            secondaryWitnesses.push({
              chainId: s.chainId,
              witnessId: s.witnessId,
              state: s.state,
              method: s.method,
              kind: s.kind,
              reportEndsAt: s.reportEndsAt,
            })
          }
        }
      }

      return {
        ok: true,
        intercepted: succeeded,
        action: act,
        witnessId: target.witnessId,
        chainId: target.chainId,
        reason,
        secondaryWitnesses,
      }
    },

    /**
     * Patrol unit observation check against active & recent district BOLOs.
     * NEVER leaks live coordinates when `!hasLos`.
     * Recognizes the suspect ONLY when `hasLos` AND (`descriptorsMatch` OR `committingAct`).
     */
    observeSuspect({
      unitId = null,
      district = 'downtown',
      pos,
      vel = [0, 0],
      hasLos = false,
      descriptor = null,
      committingAct = false,
      now = 0,
    } = {}) {
      const unit = unitId ? units.get(unitId) : [...units.values()][0]
      if (!hasLos) {
        if (unit) unit.hasLos = false
        return { recognized: false, reason: 'no_los', unitState: unit?.state ?? 'calm', boloId: null }
      }

      const observed = descriptor ?? descriptorOf({})
      const p = pos2(pos)
      const v = pos2(vel)

      // 1. Check active / searching BOLOs first.
      let matchedBolo = null
      let matchInfo = null
      for (const b of bolos.values()) {
        if (b.status !== 'active' && b.status !== 'searching') continue
        const m = descriptorsMatch(b.descriptor, observed)
        if (m.matched || committingAct) {
          matchedBolo = b
          matchInfo = m.matched ? m : { matched: true, confidence: 1, reason: 'caught_in_the_act' }
          break
        }
      }

      // 2. If no active/searching BOLO matched, check evaded BOLOs & district WantedHistory
      //    (returning in the same reported car or unmasked old outfit re-triggers recognition!).
      if (!matchedBolo) {
        const dist = text(String(district || 'downtown'), 48).toLowerCase() || 'downtown'
        for (const b of bolos.values()) {
          if (b.status !== 'evaded') continue
          if (b.district !== dist) continue
          const m = descriptorsMatch(b.descriptor, observed)
          if (m.matched) {
            matchedBolo = b
            matchInfo = { ...m, reason: `re_recognized_${m.reason}` }
            break
          }
        }
        if (!matchedBolo) {
          const prior = memory.districtMatchingIncidents(dist, observed, now)
          if (prior.length > 0) {
            const latest = prior[prior.length - 1]
            const filed = fileReport({
              incidentId: latest.id,
              kind: latest.kind,
              severity: latest.severity,
              pos: p,
              district: dist,
              suspectId: latest.suspectId,
              descriptor: observed,
              reporterId: unit?.id ?? 'patrol',
              source: 'wanted_history',
              now,
            })
            matchedBolo = filed.bolo
            matchInfo = { matched: true, confidence: 0.85, reason: 'wanted_history_match' }
          }
        }
      }

      if (!matchedBolo) {
        if (unit) unit.hasLos = false
        return { recognized: false, reason: 'descriptor_mismatch', unitState: unit?.state ?? 'calm', boloId: null }
      }

      // Recognition confirmed! Update last-known sighting vector (only because hasLos === true!).
      matchedBolo.status = 'active'
      matchedBolo.lastKnownPos = [...p]
      matchedBolo.lastKnownVel = [...v]
      matchedBolo.lastSeenAt = now
      matchedBolo.searchStartedAt = null
      matchedBolo.descriptorSwappedUnseen = false
      if (committingAct) matchedBolo.descriptor = observed

      const assigned = assignUnitsForBolo(matchedBolo, null, now)
      const spotter = unit ?? assigned[0]
      if (spotter) {
        spotter.boloId = matchedBolo.id
        spotter.hasLos = true
        spotter.state = 'pursuing'
        spotter.targetPos = [...p]
        spotter.stateEnteredAt = now
        spotter.lastSightingAt = now
      }
      // Radio flanking updates to partner units on this BOLO.
      for (const u of assigned) {
        if (u === spotter) continue
        if (u.state !== 'pursuing') {
          u.state = 'searching_perimeter'
          u.targetPos = [...u.searchWaypoint.pos]
          u.stateEnteredAt = now
        }
      }

      return {
        recognized: true,
        reason: matchInfo.reason,
        confidence: matchInfo.confidence,
        unitId: spotter?.id ?? null,
        unitState: spotter?.state ?? 'pursuing',
        boloId: matchedBolo.id,
        heat: matchedBolo.heat,
        lastKnownPos: [...matchedBolo.lastKnownPos],
      }
    },

    /**
     * Mark that the suspect broke LOS and swapped outfit/vehicle while unseen.
     * Patrol units never see the swap; once in searching state they will fail to match the new descriptor
     * and stand down cleanly into `'evaded'`.
     */
    notifyUnseenSwap({ boloId = null, newDescriptor = null, now = 0 } = {}) {
      let updated = 0
      for (const b of bolos.values()) {
        if (boloId && b.id !== boloId) continue
        if (b.status !== 'active' && b.status !== 'searching') continue
        const anyLos = [...units.values()].some((u) => u.boloId === b.id && u.hasLos)
        if (anyLos) continue
        if (!newDescriptor || !descriptorsMatch(b.descriptor, newDescriptor).matched) {
          b.descriptorSwappedUnseen = true
          if (b.status === 'active') {
            b.status = 'searching'
            b.searchStartedAt = now
          }
          updated++
        }
      }
      return { updated }
    },

    /**
     * Advance Witness Chain FSMs, BOLO search/evasion timers, and Tactical Dispatch unit states to `now` (seconds).
     */
    tick(now = 0) {
      const events = []

      // 1. Advance witness FSMs: spotting -> reporting -> reported.
      for (const w of witnesses.values()) {
        if (w.state === 'spotting' && now >= w.spotEndsAt) {
          w.state = 'reporting'
          events.push({ type: 'witness_reporting', chainId: w.chainId, witnessId: w.witnessId, method: w.method })
        }
        if (w.state === 'reporting' && now >= w.reportEndsAt) {
          w.state = 'reported'
          const { bolo } = fileReport({
            incidentId: w.incidentId,
            kind: w.kind,
            severity: w.severity,
            pos: w.pos,
            district: w.district,
            suspectId: w.suspectId,
            descriptor: w.descriptor,
            reporterId: w.witnessId,
            reporterPos: w.witnessPos,
            source: 'witness',
            now,
          })
          w.boloId = bolo.id
          events.push({ type: 'witness_reported', chainId: w.chainId, witnessId: w.witnessId, boloId: bolo.id, heat: bolo.heat })
        }
      }

      // 2. Advance BOLO states and tactical patrol units.
      for (const b of bolos.values()) {
        const assigned = [...units.values()].filter((u) => u.boloId === b.id)
        const anyLos = assigned.some((u) => u.hasLos)

        // Advance investigating -> questioning_witness -> searching_perimeter.
        for (const u of assigned) {
          if (u.state === 'investigating' && now - u.stateEnteredAt >= 2.0) {
            if (u.witnessId) {
              u.state = 'questioning_witness'
              u.stateEnteredAt = now
              events.push({ type: 'unit_questioning_witness', unitId: u.id, witnessId: u.witnessId, boloId: b.id })
            } else {
              u.state = 'searching_perimeter'
              u.targetPos = [...u.searchWaypoint.pos]
              u.stateEnteredAt = now
              events.push({ type: 'unit_searching_perimeter', unitId: u.id, boloId: b.id, targetPos: [...u.targetPos] })
            }
          } else if (u.state === 'questioning_witness' && now - u.stateEnteredAt >= 2.5) {
            u.state = 'searching_perimeter'
            u.targetPos = [...u.searchWaypoint.pos]
            u.stateEnteredAt = now
            events.push({ type: 'unit_searching_perimeter', unitId: u.id, boloId: b.id, targetPos: [...u.targetPos] })
          }
        }

        // Transition active -> searching when LOS is lost for `losGrace`.
        if (b.status === 'active' && !anyLos && now - b.lastSeenAt >= losGrace) {
          b.status = 'searching'
          b.searchStartedAt = now
          const wps = computeSearchWaypoints(b.lastKnownPos, b.lastKnownVel, assigned.length, b.searchRadius)
          assigned.forEach((u, idx) => {
            u.searchWaypoint = wps[idx % wps.length]
            if (u.state === 'pursuing' || u.state === 'investigating') {
              u.state = 'searching_perimeter'
              u.targetPos = [...u.searchWaypoint.pos]
              u.stateEnteredAt = now
            }
          })
          events.push({ type: 'bolo_searching', boloId: b.id, lastKnownPos: [...b.lastKnownPos] })
        }

        // Transition searching -> evaded when search window expires without re-acquisition.
        if (b.status === 'searching' && !anyLos) {
          const limit = b.descriptorSwappedUnseen ? evadedSearchDuration : searchDuration
          if (now - (b.searchStartedAt ?? b.lastSeenAt) >= limit) {
            b.status = 'evaded'
            for (const u of assigned) {
              u.state = 'standing_down'
              u.stateEnteredAt = now
            }
            events.push({ type: 'bolo_evaded', boloId: b.id, district: b.district, descriptorHash: b.descriptor.hash })
          }
        }

        // Transition standing_down -> calm.
        if (b.status === 'evaded' || b.status === 'cleared') {
          for (const u of assigned) {
            if (u.state === 'standing_down' && now - u.stateEnteredAt >= standDownDuration) {
              u.state = 'calm'
              u.stateEnteredAt = now
              events.push({ type: 'unit_calm', unitId: u.id, boloId: b.id })
            }
          }
        }
      }

      return events
    },

    /** Current active Heat (0 when no active or searching BOLO). */
    heat() {
      let max = 0
      for (const b of bolos.values()) {
        if (b.status === 'active' || b.status === 'searching') max = Math.max(max, b.heat)
      }
      return max
    },

    /** Read full state snapshot for rules, UI, or tests. */
    snapshot() {
      return {
        heat: this.heat(),
        witnesses: [...witnesses.values()].map((w) => ({ ...w, pos: [...w.pos], witnessPos: [...w.witnessPos] })),
        bolos: [...bolos.values()].map((b) => ({
          ...b,
          lastKnownPos: [...b.lastKnownPos],
          lastKnownVel: [...b.lastKnownVel],
          reportedBy: [...b.reportedBy],
        })),
        units: [...units.values()].map((u) => ({
          ...u,
          pos: [...u.pos],
          targetPos: [...u.targetPos],
          searchWaypoint: u.searchWaypoint ? { ...u.searchWaypoint, pos: [...u.searchWaypoint.pos] } : null,
        })),
      }
    },
  }
}
