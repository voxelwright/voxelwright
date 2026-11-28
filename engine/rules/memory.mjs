// Per-NPC localized memory, district reputation, proximity gossip, and descriptor snapshots (#164).
//
// Witnesses and patrol units track *what they actually saw* (outfit, mask, vehicle model + paint) rather than
// a suspect's internal ID. Memory stays bounded per actor (LRU), district reputation decays over time, and
// gossip spreads only between nearby calm/conversing actors within a strict hop limit (never globally).
import { text } from '../text.mjs'

/** Bounds on per-actor memory, witnessed history, gossip hops, and district history. */
export const ACTORS_MOST = 512
export const SUBJECTS_MOST = 32
export const WITNESSED_MOST = 6
export const TAGS_MOST = 8
export const DISTRICT_INCIDENTS_MOST = 16
export const GOSSIP_MAX_HOPS = 2
export const GOSSIP_DEFAULT_DIST = 60
export const GOSSIP_COOLDOWN_S = 20
export const GOSSIP_MIN_SALIENCE = 0.5
export const GOSSIP_MIN_TRUST = 4
export const DISTRICT_HALF_LIFE_S = 600
export const WANTED_HISTORY_TTL_S = 1800

export const VALID_TAGS = new Set([
  'greeted', 'antagonized', 'helped', 'threatened',
  'witnessed_crime', 'bribed', 'apologized', 'rumor',
])

const GOSSIP_STATES = new Set(['calm', 'conversing', 'idle', 'standing', 'walking'])

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

/** Deterministic 32-bit FNV-1a hash as 8-char hex string. */
function fnv1a(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/** Canonical sorted string for a flat look/outfit descriptor. */
function normalizeLook(look) {
  if (!look) return ''
  if (typeof look === 'string') return text(look, 120).toLowerCase()
  if (typeof look !== 'object' || Array.isArray(look)) return ''
  const keys = Object.keys(look).sort()
  const parts = []
  for (const k of keys) {
    const v = look[k]
    if (v === undefined || v === null || v === false || v === '') continue
    const key = text(k, 24).toLowerCase()
    if (!key) continue
    if (v === true) parts.push(key)
    else {
      const val = text(String(v), 32).toLowerCase()
      if (val) parts.push(`${key}:${val}`)
    }
  }
  return parts.join(', ')
}

/** Canonical string for a vehicle descriptor (`{ model, paint, plate }` or string). */
function normalizeVehicle(vehicle) {
  if (!vehicle) return ''
  if (typeof vehicle === 'string') return text(vehicle, 80).toLowerCase()
  if (typeof vehicle !== 'object' || Array.isArray(vehicle)) return ''
  const parts = []
  if (vehicle.paint) parts.push(text(String(vehicle.paint), 24).toLowerCase())
  if (vehicle.model) parts.push(text(String(vehicle.model), 32).toLowerCase())
  if (vehicle.plate) parts.push(`plate:${text(String(vehicle.plate), 16).toLowerCase()}`)
  return parts.filter(Boolean).join(' ')
}

/**
 * Appearance / vehicle descriptor snapshot: summarizes and hashes what witnesses actually saw
 * (outfit, mask status, vehicle model + paint) rather than the player's internal ID.
 */
export function descriptorOf({ look = null, vehicle = null, masked } = {}) {
  const isMasked = masked !== undefined
    ? Boolean(masked)
    : Boolean(look && typeof look === 'object' && (look.mask || look.helmet || look.balaclava))
  const outfit = normalizeLook(look) || 'plain clothes'
  const veh = normalizeVehicle(vehicle) || null
  const outfitHash = fnv1a(`outfit|${outfit}`)
  const vehicleHash = veh ? fnv1a(`vehicle|${veh}`) : null
  const hash = fnv1a(`desc|${outfitHash}|${vehicleHash ?? 'foot'}|${isMasked ? 'm' : 'u'}`)
  const who = isMasked ? `masked person in ${outfit}` : `person in ${outfit}`
  const summary = veh ? `${who} driving ${veh}` : who
  return Object.freeze({
    hash,
    outfitHash,
    vehicleHash,
    masked: isMasked,
    outfit,
    vehicle: veh,
    summary,
  })
}

/**
 * Whether an observed appearance/vehicle descriptor matches a reported BOLO descriptor.
 * Swapping vehicle (when driving) or swapping outfit (when on foot) while unseen breaks recognition;
 * returning in the reported vehicle or unmasked in the reported outfit re-triggers recognition.
 */
export function descriptorsMatch(reported, observed) {
  if (!reported || !observed) return { matched: false, confidence: 0, reason: 'missing' }
  if (reported.hash === observed.hash) return { matched: true, confidence: 1, reason: 'exact' }
  // Both in vehicles: patrol recognizes the vehicle model/paint/plate, not a swapped car.
  if (reported.vehicleHash && observed.vehicleHash) {
    if (reported.vehicleHash === observed.vehicleHash) return { matched: true, confidence: 0.9, reason: 'vehicle' }
    return { matched: false, confidence: 0, reason: 'vehicle_swapped' }
  }
  // Reported in a vehicle, now spotted on foot: matches only if unmasked in the same reported outfit.
  if (reported.vehicleHash && !observed.vehicleHash) {
    if (!reported.masked && !observed.masked && reported.outfitHash === observed.outfitHash) {
      return { matched: true, confidence: 0.75, reason: 'exited_same_outfit' }
    }
    return { matched: false, confidence: 0, reason: 'exited_different_profile' }
  }
  // Reported on foot, now driving a clean vehicle unseen during the crime.
  if (!reported.vehicleHash && observed.vehicleHash) {
    return { matched: false, confidence: 0, reason: 'entered_unreported_vehicle' }
  }
  // Both on foot: matches if wearing the same outfit (unless masked during crime and now unmasked in a different outfit).
  if (reported.outfitHash === observed.outfitHash) {
    if (reported.masked && !observed.masked) return { matched: true, confidence: 0.7, reason: 'same_outfit_unmasked' }
    return { matched: true, confidence: 0.85, reason: 'outfit' }
  }
  return { matched: false, confidence: 0, reason: 'outfit_swapped' }
}

/** Map numeric trust (-10..+10) to a concise attitude label. */
export function attitudeOf(trust) {
  if (trust <= -6) return 'hostile'
  if (trust <= -2) return 'wary'
  if (trust >= 6) return 'trusted'
  if (trust >= 2) return 'warm'
  return 'neutral'
}

/** Distance in XZ plane for 2D `[x, z]` or 3D `[x, y, z]` positions. */
function xzDist(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return Infinity
  const ax = a[0] ?? 0, az = a.length >= 3 ? a[2] : (a[1] ?? 0)
  const bx = b[0] ?? 0, bz = b.length >= 3 ? b[2] : (b[1] ?? 0)
  return Math.hypot(ax - bx, az - bz)
}

/** Touch a key in a Map to maintain bounded LRU eviction order (oldest first). */
function lruSet(map, key, val, limit) {
  if (map.has(key)) map.delete(key)
  map.set(key, val)
  while (map.size > limit) map.delete(map.keys().next().value)
  return val
}

function lruGet(map, key) {
  if (!map.has(key)) return undefined
  const val = map.get(key)
  map.delete(key)
  map.set(key, val)
  return val
}

/**
 * Localized NPC memory, district reputation, and proximity gossip store.
 */
export function createMemory({
  maxActors = ACTORS_MOST,
  maxSubjects = SUBJECTS_MOST,
  maxWitnessed = WITNESSED_MOST,
  maxHops = GOSSIP_MAX_HOPS,
  gossipCooldown = GOSSIP_COOLDOWN_S,
  districtHalfLife = DISTRICT_HALF_LIFE_S,
  wantedHistoryTtl = WANTED_HISTORY_TTL_S,
} = {}) {
  /** actorId -> { subjects: Map<subjectId, record>, witnessed: Event[] } */
  const actors = new Map()
  /** district -> { score: number, updatedAt: number, wantedHistory: Incident[] } */
  const districts = new Map()
  /** "a|b" -> lastGossipAt */
  const pairCooldowns = new Map()
  let nextEventId = 1

  const ensureActor = (actorId) => {
    const id = text(String(actorId ?? ''), 48)
    if (!id) return null
    let rec = lruGet(actors, id)
    if (!rec) {
      rec = { subjects: new Map(), witnessed: [] }
      lruSet(actors, id, rec, maxActors)
    }
    return rec
  }

  const ensureDistrict = (district, now = 0) => {
    const key = text(String(district || 'downtown'), 48).toLowerCase() || 'downtown'
    let d = districts.get(key)
    if (!d) {
      d = { name: key, score: 0, updatedAt: now, wantedHistory: [] }
      districts.set(key, d)
    }
    return d
  }

  /** Apply exponential decay to district reputation score and prune expired wantedHistory. */
  const decayDistrict = (d, now) => {
    if (now > d.updatedAt) {
      const dt = now - d.updatedAt
      const factor = Math.pow(0.5, dt / Math.max(1, districtHalfLife))
      d.score = Math.abs(d.score * factor) < 0.01 ? 0 : d.score * factor
      d.updatedAt = now
    }
    if (d.wantedHistory.length) {
      d.wantedHistory = d.wantedHistory.filter((inc) => now - inc.t <= wantedHistoryTtl)
    }
  }

  const addTag = (tags, tag) => {
    if (!tag || !VALID_TAGS.has(tag)) return
    const idx = tags.indexOf(tag)
    if (idx >= 0) tags.splice(idx, 1)
    tags.push(tag)
    while (tags.length > TAGS_MOST) tags.shift()
  }

  const store = {
    /** Record or update an NPC's attitude/trust memory of a subject. */
    remember(actorId, subjectId, { trustDelta = 0, tag = null, descriptor = null, now = 0, bumpFamiliarity = true } = {}) {
      const actor = ensureActor(actorId)
      const sub = text(String(subjectId ?? ''), 48)
      if (!actor || !sub) return null
      let entry = lruGet(actor.subjects, sub)
      if (!entry) {
        entry = {
          subjectId: sub,
          trust: 0,
          attitude: 'neutral',
          familiarity: 0,
          tags: [],
          lastSeen: now,
          lastDescriptor: null,
        }
      }
      if (Number.isFinite(trustDelta) && trustDelta !== 0) {
        entry.trust = clamp(Math.round((entry.trust + trustDelta) * 100) / 100, -10, 10)
      }
      entry.attitude = attitudeOf(entry.trust)
      if (bumpFamiliarity) entry.familiarity += 1
      if (tag) addTag(entry.tags, tag)
      if (descriptor) entry.lastDescriptor = descriptor
      entry.lastSeen = now
      lruSet(actor.subjects, sub, entry, maxSubjects)
      return { ...entry, tags: [...entry.tags] }
    },

    /** Read one NPC's memory of a subject (or a clean neutral snapshot). */
    recall(actorId, subjectId) {
      const actor = actors.get(String(actorId ?? ''))
      const entry = actor?.subjects.get(String(subjectId ?? ''))
      if (!entry) {
        return {
          subjectId: String(subjectId ?? ''),
          trust: 0,
          attitude: 'neutral',
          familiarity: 0,
          tags: [],
          lastSeen: 0,
          lastDescriptor: null,
        }
      }
      return { ...entry, tags: [...entry.tags] }
    },

    /** Record a structured witnessed event on an NPC (bounded to last 6 events). */
    recordWitnessed(actorId, {
      id = null,
      t = 0,
      kind = 'incident',
      severity = 1,
      district = 'downtown',
      pos = null,
      suspectId = null,
      descriptor = null,
      salience = null,
      hops = 0,
      source = 'firsthand',
    } = {}) {
      const actor = ensureActor(actorId)
      if (!actor) return null
      const evId = id || `ev-${nextEventId++}`
      // Deduplicate by event id: keep the lower-hop (more firsthand) record.
      const existing = actor.witnessed.find((e) => e.id === evId)
      if (existing) {
        if (hops < existing.hops) {
          existing.hops = hops
          existing.salience = Math.max(existing.salience, salience ?? clamp(severity * 0.35, 0.2, 1))
        }
        return { ...existing }
      }
      const ev = {
        id: evId,
        t,
        kind: text(String(kind), 32) || 'incident',
        severity: clamp(Number(severity) || 1, 1, 5),
        district: text(String(district || 'downtown'), 48).toLowerCase() || 'downtown',
        pos: Array.isArray(pos) ? pos.map((n) => Math.round(n)) : null,
        suspectId: suspectId ? text(String(suspectId), 48) : null,
        descriptor: descriptor ?? null,
        salience: salience !== null && Number.isFinite(salience)
          ? clamp(salience, 0, 1)
          : clamp(0.25 + (Number(severity) || 1) * 0.2, 0.2, 1),
        hops: Math.max(0, Math.floor(hops)),
        source: text(String(source), 32) || 'firsthand',
      }
      actor.witnessed.push(ev)
      while (actor.witnessed.length > maxWitnessed) actor.witnessed.shift()
      if (suspectId) {
        this.remember(actorId, suspectId, {
          trustDelta: hops === 0 ? -Math.min(4, ev.severity) : -Math.min(2, Math.ceil(ev.severity * 0.5)),
          tag: hops === 0 ? 'witnessed_crime' : 'rumor',
          descriptor,
          now: t,
          bumpFamiliarity: hops === 0,
        })
      }
      return { ...ev }
    },

    /** List an NPC's witnessed events (most recent last, up to 6). */
    witnessedBy(actorId) {
      const actor = actors.get(String(actorId ?? ''))
      return actor ? actor.witnessed.map((e) => ({ ...e })) : []
    },

    /** Adjust a district's rolling reputation score (-10..+10) with time decay. */
    adjustDistrictReputation(district, delta, now = 0) {
      const d = ensureDistrict(district, now)
      decayDistrict(d, now)
      if (Number.isFinite(delta)) d.score = clamp(d.score + delta, -10, 10)
      return { district: d.name, score: Number(d.score.toFixed(2)), incidents: d.wantedHistory.length }
    },

    /** Record a reported incident into a district's rolling WantedHistory. */
    recordDistrictIncident(district, { id = null, kind = 'incident', severity = 1, descriptor = null, suspectId = null, pos = null, now = 0 } = {}) {
      const d = ensureDistrict(district, now)
      decayDistrict(d, now)
      const sev = clamp(Number(severity) || 1, 1, 5)
      const inc = {
        id: id || `inc-${nextEventId++}`,
        t: now,
        kind: text(String(kind), 32) || 'incident',
        severity: sev,
        descriptor: descriptor ?? null,
        suspectId: suspectId ? text(String(suspectId), 48) : null,
        pos: Array.isArray(pos) ? pos.map((n) => Math.round(n)) : null,
      }
      d.wantedHistory.push(inc)
      while (d.wantedHistory.length > DISTRICT_INCIDENTS_MOST) d.wantedHistory.shift()
      d.score = clamp(d.score - sev * 0.8, -10, 10)
      return { ...inc }
    },

    /** Read a district's decayed reputation and recent WantedHistory. */
    districtReputation(district, now = 0) {
      const d = ensureDistrict(district, now)
      decayDistrict(d, now)
      return {
        district: d.name,
        score: Number(d.score.toFixed(2)),
        attitude: attitudeOf(d.score),
        wantedHistory: d.wantedHistory.map((i) => ({ ...i })),
      }
    },

    /** Count recent matching incidents in a district's WantedHistory for a descriptor. */
    districtMatchingIncidents(district, descriptor, now = 0) {
      const rep = this.districtReputation(district, now)
      if (!descriptor) return []
      return rep.wantedHistory.filter((inc) => inc.descriptor && descriptorsMatch(inc.descriptor, descriptor).matched)
    },

    /**
     * Local proximity gossip propagation:
     * Two nearby calm/conversing actors within `maxDist` exchange high-salience witnessed events
     * or strong reputation impressions, strictly bounded by `maxHops` (default 2) with decay.
     * Never teleports information across distant actors.
     */
    propagateGossip(actorList, now = 0, maxDist = GOSSIP_DEFAULT_DIST) {
      const transfers = []
      if (!Array.isArray(actorList) || actorList.length < 2) return transfers
      const eligible = actorList.filter((a) => a && a.id && Array.isArray(a.pos) && GOSSIP_STATES.has(a.state ?? 'calm'))
      for (let i = 0; i < eligible.length; i++) {
        for (let j = i + 1; j < eligible.length; j++) {
          const a = eligible[i], b = eligible[j]
          if (a.id === b.id) continue
          if (xzDist(a.pos, b.pos) > maxDist) continue
          const pairKey = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`
          const last = pairCooldowns.get(pairKey) ?? -Infinity
          if (now - last < gossipCooldown) continue

          let exchanged = false
          for (const [speaker, listener] of [[a, b], [b, a]]) {
            const spkMem = actors.get(String(speaker.id))
            if (!spkMem) continue
            const lstMem = ensureActor(listener.id)
            if (!lstMem) continue

            // 1. Exchange highest-salience witnessed event within hop limit.
            const candidates = spkMem.witnessed
              .filter((ev) => ev.hops < maxHops && (ev.salience >= GOSSIP_MIN_SALIENCE || ev.severity >= 2))
              .filter((ev) => !lstMem.witnessed.some((known) => known.id === ev.id))
              .sort((x, y) => y.salience - x.salience || y.t - x.t)
            if (candidates.length) {
              const ev = candidates[0]
              const nextHops = ev.hops + 1
              const decayedSalience = Number((ev.salience * 0.65).toFixed(3))
              this.recordWitnessed(listener.id, {
                ...ev,
                salience: decayedSalience,
                hops: nextHops,
                source: `gossip:${speaker.id}`,
              })
              transfers.push({
                from: speaker.id,
                to: listener.id,
                kind: 'event',
                eventId: ev.id,
                eventKind: ev.kind,
                hops: nextHops,
                salience: decayedSalience,
              })
              exchanged = true
            }

            // 2. Exchange strongest reputation impression (|trust| >= 4) if listener doesn't know them strongly.
            let strongest = null
            for (const sub of spkMem.subjects.values()) {
              if (Math.abs(sub.trust) < GOSSIP_MIN_TRUST) continue
              if (sub.tags.includes('rumor') && !sub.tags.includes('witnessed_crime') && !sub.tags.includes('threatened') && !sub.tags.includes('helped') && !sub.tags.includes('antagonized')) continue
              if (!strongest || Math.abs(sub.trust) > Math.abs(strongest.trust)) strongest = sub
            }
            if (strongest) {
              const known = lstMem.subjects.get(strongest.subjectId)
              if (!known || Math.abs(known.trust) < Math.abs(strongest.trust) * 0.5) {
                const delta = Math.trunc(strongest.trust * 0.4)
                if (delta !== 0) {
                  this.remember(listener.id, strongest.subjectId, {
                    trustDelta: delta,
                    tag: 'rumor',
                    descriptor: strongest.lastDescriptor,
                    now,
                    bumpFamiliarity: false,
                  })
                  transfers.push({
                    from: speaker.id,
                    to: listener.id,
                    kind: 'impression',
                    subjectId: strongest.subjectId,
                    hops: 1,
                    trustDelta: delta,
                  })
                  exchanged = true
                }
              }
            }
          }
          if (exchanged) pairCooldowns.set(pairKey, now)
        }
      }
      return transfers
    },

    /** Build a compact classical Blackboard context snapshot for `world.think(..., { context })`. */
    blackboardFor(actorId, subjectId, { district = 'downtown', weather = '', activity = '', mood = '', nearbyMade = [], now = 0 } = {}) {
      const mem = this.recall(actorId, subjectId)
      const distRep = this.districtReputation(district, now)
      const events = this.witnessedBy(actorId).slice(-3).map((e) => {
        const who = e.descriptor?.summary ? ` (${e.descriptor.summary})` : ''
        return `${e.hops > 0 ? 'heard rumor of ' : 'saw '}${e.kind} in ${e.district}${who}`
      })
      const repSummary = `trust ${mem.trust >= 0 ? '+' : ''}${mem.trust} (${mem.attitude}), district ${distRep.score >= 0 ? '+' : ''}${distRep.score}`
      return {
        district: text(String(district), 60),
        ...(weather ? { weather: text(String(weather), 60) } : {}),
        ...(activity ? { activity: text(String(activity), 80) } : {}),
        mood: text(String(mood || mem.attitude), 40),
        reputation: repSummary,
        ...(events.length ? { witnessed: events } : {}),
        ...(Array.isArray(nearbyMade) && nearbyMade.length ? { nearby_made: nearbyMade.slice(0, 4) } : {}),
      }
    },

    /** Diagnostics for tests and introspection. */
    stats() {
      return {
        actors: actors.size,
        districts: districts.size,
        cooldowns: pairCooldowns.size,
      }
    },
  }

  return store
}

/** Standalone convenience wrapper matching `propagateGossip(actors, now, maxDist)` using a provided store. */
export function propagateGossip(store, actors, now = 0, maxDist = GOSSIP_DEFAULT_DIST) {
  return store.propagateGossip(actors, now, maxDist)
}
