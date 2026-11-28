// Spatial Smart Object Registry (#164): O(1) tile-bucketed XZ slot discovery,
// reservation locks with lease expiry, UE 5.7/5.8-style MRU anti-repetition,
// OSM/city slot ingestion, geometric voxel affordance scanning (rain overhangs,
// waist-high cover, sittable ledges), and player-made object registration.
import { AFFORDANCE_KINDS, inferAffordances, validateAffordances } from '../make/affordances.mjs'

/** Allowed Smart Object slot kinds. */
export const SLOT_KINDS = AFFORDANCE_KINDS
const KIND_SET = new Set(SLOT_KINDS)

/** Allowed Smart Object sources. */
export const SOURCES = Object.freeze(['city', 'geometric', 'made'])
const SOURCE_SET = new Set(SOURCES)

/** Facing transforms matching `engine/make/form.mjs` FACINGS (x east, z south). */
const FACINGS = {
  south: { m: [1, 0, 0, -1], yaw: 0 },
  north: { m: [-1, 0, 0, 1], yaw: Math.PI },
  east:  { m: [0, -1, -1, 0], yaw: Math.PI / 2 },
  west:  { m: [0, 1, 1, 0], yaw: -Math.PI / 2 },
}

/** Mapping from common OSM / city feature types to Smart Object slot kinds. */
const CITY_TYPE_MAP = {
  bench: 'sit',
  seating: 'sit',
  chair: 'sit',
  sit: 'sit',
  awning: 'shelter',
  bus_stop: 'shelter',
  bus_shelter: 'shelter',
  canopy: 'shelter',
  overhang: 'shelter',
  shelter: 'shelter',
  storefront: 'browse',
  shop: 'browse',
  kiosk: 'browse',
  stall: 'browse',
  vendor: 'browse',
  browse: 'browse',
  barrier: 'cover',
  planter: 'cover',
  ledge: 'cover',
  cover: 'cover',
  statue: 'spectacle',
  fountain: 'spectacle',
  plaza: 'spectacle',
  monument: 'spectacle',
  spectacle: 'spectacle',
  crosswalk: 'queue',
  atm: 'queue',
  ticket: 'queue',
  queue: 'queue',
}

/** Solid voxel check matching engine material ids (air=0, water=5 are non-solid). */
const isSolid = (k) => { const m = k & 15; return m !== 0 && m !== 5 }
/** Solid structural ceiling (excludes air=0, water=5, leaves=13 for real rain shelter). */
const isRoofSolid = (k) => { const m = k & 15; return m !== 0 && m !== 5 && m !== 13 }

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

function wrapYaw(rad) {
  let a = rad % (Math.PI * 2)
  if (a > Math.PI) a -= Math.PI * 2
  if (a < -Math.PI) a += Math.PI * 2
  return Object.is(a, -0) ? 0 : a
}

/**
 * Scan a voxel region `(x, y, z) => kind` for geometric affordances:
 *   (a) Rain-shelter overhangs: solid ceiling 20–50 cells above walkable floor
 *   (b) Waist-high cover ledges: solid obstacle 8–14 cells tall with open air above
 *   (c) Sittable ledges: flat solid ledge 4–6 cells tall with clear headroom above
 *
 * @param {(x: number, y: number, z: number) => number} kindFn
 * @param {{ min: [number,number,number], max: [number,number,number] }} bounds
 * @param {object} [opts]
 * @param {number} [opts.stride=2]        XZ sampling stride in cells
 * @param {number} [opts.minSpacing=8]    minimum spacing between emitted slots of same kind (cells)
 * @param {number} [opts.maxSlots=128]    safety cap per region scan
 * @param {string} [opts.idPrefix='geo']  id prefix for generated object
 */
export function scanGeometricAffordances(kindFn, bounds, opts = {}) {
  if (typeof kindFn !== 'function') throw new Error('kindFn must be a function (x, y, z) => kind')
  const min = bounds?.min ?? [0, 0, 0]
  const max = bounds?.max ?? [0, 0, 0]
  const x0 = Math.floor(Math.min(min[0], max[0])), x1 = Math.floor(Math.max(min[0], max[0]))
  const y0 = Math.floor(Math.min(min[1], max[1])), y1 = Math.floor(Math.max(min[1], max[1]))
  const z0 = Math.floor(Math.min(min[2], max[2])), z1 = Math.floor(Math.max(min[2], max[2]))

  const stride = Math.max(1, (opts.stride ?? 2) | 0)
  const minSpacing = Math.max(2, Number(opts.minSpacing ?? 8))
  const maxSlots = Math.max(1, (opts.maxSlots ?? 128) | 0)
  const idPrefix = String(opts.idPrefix ?? 'geo')

  const slots = []
  const tooClose = (kind, x, y, z) => {
    for (const s of slots) {
      if (s.kind !== kind) continue
      if (Math.hypot(s.pos[0] - x, s.pos[1] - y, s.pos[2] - z) < minSpacing) return true
    }
    return false
  }

  /** True if (x, y, z) is solid floor and (x, y+1..y+18, z) is non-solid headroom. */
  const walkableFloor = (x, y, z) => {
    if (!isSolid(kindFn(x, y, z))) return false
    for (let dy = 1; dy <= 18; dy++) {
      if (isSolid(kindFn(x, y + dy, z))) return false
    }
    return true
  }

  /** Measure contiguous solid wall height rising from y+1 at (nx, nz), up to maxCheck. */
  const solidRise = (nx, y, nz, maxCheck) => {
    let h = 0
    for (let dy = 1; dy <= maxCheck; dy++) {
      if (isSolid(kindFn(nx, y + dy, nz))) h = dy
      else break
    }
    return h
  }

  /** Cardinal neighbors [dx, dz, yawFacingOutFromLedge, yawFacingIntoCover]. */
  const DIRS = [
    [1,  0, -Math.PI / 2,  Math.PI / 2],
    [-1, 0,  Math.PI / 2, -Math.PI / 2],
    [0,  1,  0,            Math.PI],
    [0, -1,  Math.PI,      0],
  ]

  for (let z = z0; z <= z1 && slots.length < maxSlots; z += stride) {
    for (let x = x0; x <= x1 && slots.length < maxSlots; x += stride) {
      // Find walkable floor heights in [y0, y1] at column (x, z).
      for (let y = y0; y <= y1 && slots.length < maxSlots; y++) {
        if (!walkableFloor(x, y, z)) continue

        // (a) Rain-shelter overhang: solid ceiling 20..50 cells above walkable floor.
        if (!tooClose('shelter', x, y + 1, z)) {
          let ceilingDy = -1
          for (let dy = 20; dy <= 50; dy++) {
            if (isRoofSolid(kindFn(x, y + dy, z))) { ceilingDy = dy; break }
          }
          if (ceilingDy >= 20) {
            slots.push({
              slotId: `${idPrefix}:shelter:${x}_${y + 1}_${z}`,
              kind: 'shelter',
              pos: [x, y + 1, z],
              yaw: 0,
              tags: ['geometric', 'overhang', `ceil_${ceilingDy}`],
              capacity: 2,
            })
          }
        }

        // (b) Waist-high cover (8..14 cells) and (c) Sittable ledges (4..6 cells).
        for (const [dx, dz, yawOut, yawIn] of DIRS) {
          if (slots.length >= maxSlots) break
          const nx = x + dx, nz = z + dz
          const h = solidRise(nx, y, nz, 18)

          if (h >= 8 && h <= 14) {
            // Confirm open air above the waist-high cover (y+h+1 .. y+h+6) so actor can peek.
            let openAbove = true
            for (let dy = h + 1; dy <= h + 6; dy++) {
              if (isSolid(kindFn(nx, y + dy, nz))) { openAbove = false; break }
            }
            if (openAbove && !tooClose('cover', x, y + 1, z)) {
              slots.push({
                slotId: `${idPrefix}:cover:${x}_${y + 1}_${z}`,
                kind: 'cover',
                pos: [x, y + 1, z],
                yaw: yawIn,
                tags: ['geometric', 'cover', 'waist-high'],
                capacity: 1,
              })
            }
          } else if (h >= 4 && h <= 6) {
            // Confirm clear headroom above the sittable ledge top (y+h+1 .. y+h+12).
            let openAbove = true
            for (let dy = h + 1; dy <= h + 12; dy++) {
              if (isSolid(kindFn(nx, y + dy, nz))) { openAbove = false; break }
            }
            if (openAbove && !tooClose('sit', nx, y + h + 1, nz)) {
              slots.push({
                slotId: `${idPrefix}:sit:${nx}_${y + h + 1}_${nz}`,
                kind: 'sit',
                pos: [nx, y + h + 1, nz],
                yaw: yawOut,
                tags: ['geometric', 'ledge', 'seat'],
                capacity: 1,
              })
            }
          }
        }
      }
    }
  }

  return slots
}

/**
 * Create a Spatial Smart Object Registry with reservation locks, lease expiry,
 * and UE 5.7/5.8-style MRU anti-repetition.
 *
 * @param {object} [opts]
 * @param {number} [opts.tileSize=64]       XZ spatial bucket size in 10 cm cells
 * @param {number} [opts.mruSize=12]        recent entries remembered per actor
 * @param {number} [opts.mruPenalty=0.72]   max score penalty for most recent repeat
 * @param {number} [opts.mruWindowMs=120000] age window over which MRU penalty decays
 * @param {number} [opts.defaultTtlMs=30000] default reservation lease duration (ms)
 */
export function createSmartObjectRegistry({
  tileSize = 64,
  mruSize = 12,
  mruPenalty = 0.72,
  mruWindowMs = 120_000,
  defaultTtlMs = 30_000,
} = {}) {
  const tile = Math.max(8, tileSize | 0)
  const objects = new Map()       // objectId -> object record
  const slots = new Map()         // slotId -> internal slot record
  const buckets = new Map()       // `${bx},${bz}` -> Set<slotRecord>
  const claims = new Map()        // slotId -> Map<actorId, expiresAt>
  const actorClaims = new Map()   // actorId -> Set<slotId>
  const actorMru = new Map()      // actorId -> Array<{ objectId, slotId, at }>

  const bucketKey = (x, z) => `${Math.floor(x / tile)},${Math.floor(z / tile)}`

  const addSlotToBucket = (slot) => {
    const key = bucketKey(slot.pos[0], slot.pos[2])
    slot._bkey = key
    let set = buckets.get(key)
    if (!set) { set = new Set(); buckets.set(key, set) }
    set.add(slot)
  }

  const removeSlotFromBucket = (slot) => {
    const set = buckets.get(slot._bkey)
    if (!set) return
    set.delete(slot)
    if (set.size === 0) buckets.delete(slot._bkey)
  }

  /** Record a slot/object in an actor's MRU anti-repetition ring. */
  function recordRecent(actorId, slotId, now = 0) {
    const slot = slots.get(slotId)
    if (!slot || actorId == null) return
    const aid = String(actorId)
    let list = actorMru.get(aid)
    if (!list) { list = []; actorMru.set(aid, list) }
    // Move existing entry to front or insert new at index 0.
    const idx = list.findIndex((e) => e.slotId === slotId)
    if (idx >= 0) list.splice(idx, 1)
    list.unshift({ objectId: slot.objectId, slotId, at: now })
    if (list.length > mruSize) list.length = mruSize
  }

  /** Compute MRU penalty in [0, mruPenalty] for an actor revisiting a slot/object. */
  function mruPenaltyFor(actorId, slot, now = 0) {
    if (actorId == null || !slot) return 0
    const list = actorMru.get(String(actorId))
    if (!list || !list.length) return 0
    let best = 0
    for (let rank = 0; rank < list.length; rank++) {
      const entry = list[rank]
      const age = Math.max(0, now - entry.at)
      if (age >= mruWindowMs) continue
      const match = entry.slotId === slot.slotId ? 1.0 : entry.objectId === slot.objectId ? 0.85 : 0
      if (match === 0) continue
      const rankWeight = Math.pow(0.75, rank)
      const ageWeight = 1 - age / mruWindowMs
      const p = mruPenalty * match * rankWeight * ageWeight
      if (p > best) best = p
    }
    return best
  }

  /** Evict expired leases on a single slot. */
  function pruneSlotClaims(slotId, now) {
    const map = claims.get(slotId)
    if (!map) return 0
    let expired = 0
    for (const [aid, expiresAt] of map) {
      if (now >= expiresAt) {
        map.delete(aid)
        const set = actorClaims.get(aid)
        if (set) { set.delete(slotId); if (set.size === 0) actorClaims.delete(aid) }
        recordRecent(aid, slotId, now)
        expired++
      }
    }
    if (map.size === 0) claims.delete(slotId)
    return expired
  }

  /** Sweep all expired reservation leases across the registry. */
  function sweepExpired(now) {
    let total = 0
    for (const slotId of [...claims.keys()]) {
      total += pruneSlotClaims(slotId, now)
    }
    return total
  }

  /**
   * Register a Smart Object and index all of its slots in the spatial hash.
   * Re-registering an existing `id` cleanly replaces the previous object.
   */
  function register(obj) {
    if (!obj || typeof obj !== 'object') throw new Error('smart object must be an object')
    const id = typeof obj.id === 'string' && obj.id ? obj.id : null
    if (!id) throw new Error('smart object requires a non-empty string id')
    const source = SOURCE_SET.has(obj.source) ? obj.source : 'city'
    if (objects.has(id)) unregister(id)

    const rawSlots = Array.isArray(obj.slots) ? obj.slots : []
    const normSlots = []
    for (let i = 0; i < rawSlots.length; i++) {
      const s = rawSlots[i]
      if (!s || typeof s !== 'object') continue
      const kind = typeof s.kind === 'string' ? s.kind.toLowerCase() : ''
      if (!KIND_SET.has(kind)) continue
      if (!Array.isArray(s.pos) || s.pos.length !== 3 || !s.pos.every((v) => typeof v === 'number' && Number.isFinite(v))) continue
      const slotId = typeof s.slotId === 'string' && s.slotId ? s.slotId : `${id}#${i}`
      const rec = {
        slotId,
        objectId: id,
        source,
        kind,
        pos: [s.pos[0], s.pos[1], s.pos[2]],
        yaw: typeof s.yaw === 'number' && Number.isFinite(s.yaw) ? wrapYaw(s.yaw) : 0,
        tags: Array.isArray(s.tags) ? s.tags.filter((t) => typeof t === 'string').slice(0, 8) : [],
        capacity: Number.isInteger(s.capacity) && s.capacity >= 1 ? Math.min(s.capacity, 8) : 1,
        _bkey: '',
      }
      if (slots.has(slotId)) {
        // Ensure uniqueness if caller reused a slotId.
        rec.slotId = `${id}#${i}_${slots.size}`
      }
      slots.set(rec.slotId, rec)
      addSlotToBucket(rec)
      normSlots.push(rec)
    }

    const record = {
      id,
      source,
      ownerId: obj.ownerId ?? null,
      label: typeof obj.label === 'string' ? obj.label : (typeof obj.name === 'string' ? obj.name : id),
      slots: normSlots,
    }
    objects.set(id, record)
    return record
  }

  /** Remove a Smart Object, its slots, and any active claims on those slots. */
  function unregister(objectId) {
    const obj = objects.get(objectId)
    if (!obj) return false
    for (const s of obj.slots) {
      removeSlotFromBucket(s)
      const map = claims.get(s.slotId)
      if (map) {
        for (const aid of map.keys()) {
          const set = actorClaims.get(aid)
          if (set) { set.delete(s.slotId); if (set.size === 0) actorClaims.delete(aid) }
        }
        claims.delete(s.slotId)
      }
      slots.delete(s.slotId)
    }
    objects.delete(objectId)
    return true
  }

  /**
   * Ingest OSM / city feature slots into the registry with `source: 'city'`.
   * Accepts an array of city items like `{ id, type|kind, pos, yaw?, label?, tags?, capacity?, slots? }`.
   */
  function registerCitySlots(entries) {
    if (!Array.isArray(entries)) return []
    const added = []
    for (let i = 0; i < entries.length; i++) {
      const item = entries[i]
      if (!item || typeof item !== 'object') continue
      const id = item.id ? String(item.id) : `city:${i}:${Math.round(item.pos?.[0] ?? 0)}_${Math.round(item.pos?.[2] ?? 0)}`
      if (Array.isArray(item.slots)) {
        added.push(register({ ...item, id, source: 'city' }))
        continue
      }
      const rawKind = String(item.kind ?? item.type ?? '').toLowerCase()
      const kind = CITY_TYPE_MAP[rawKind] ?? (KIND_SET.has(rawKind) ? rawKind : null)
      if (!kind || !Array.isArray(item.pos) || item.pos.length !== 3) continue
      const tags = Array.isArray(item.tags) ? [...item.tags] : []
      if (rawKind && !tags.includes(rawKind)) tags.push(rawKind)
      added.push(register({
        id,
        source: 'city',
        label: item.label ?? item.name ?? rawKind,
        slots: [{
          slotId: item.slotId ?? `${id}#0`,
          kind,
          pos: item.pos,
          yaw: item.yaw ?? 0,
          tags,
          capacity: item.capacity ?? (kind === 'shelter' || kind === 'spectacle' ? 2 : 1),
        }],
      }))
    }
    return added
  }

  /**
   * Register a player-made voxel object as a Smart Object (`source: 'made'`),
   * validating explicit affordances or automatically inferring them via
   * `inferAffordances`, and transforming local slots into world coordinates.
   */
  function registerMadeObject({ id, ownerId = null, name = '', label = '', pos = [0, 0, 0], facing = 'south', size = [16, 16, 16], cells = null, affordances = null }) {
    const objId = id ? String(id) : `made:${Math.round(pos[0])}_${Math.round(pos[1])}_${Math.round(pos[2])}`
    let localSlots
    if (affordances != null) {
      localSlots = validateAffordances(affordances, size).slots
    } else {
      localSlots = inferAffordances({ name: name || label, size, cells }).slots
    }

    const f = FACINGS[facing] ?? FACINGS.south
    const [xx, xz, zx, zz] = f.m
    const [w, , d] = size
    const worldSlots = localSlots.map((s, i) => {
      const cx = s.pos[0] - (w >> 1)
      const cz = s.pos[2] - (d >> 1)
      const wx = pos[0] + cx * xx + cz * xz
      const wy = pos[1] + s.pos[1]
      const wz = pos[2] + cx * zx + cz * zz
      return {
        slotId: `${objId}#${i}`,
        kind: s.kind,
        pos: [Number(wx.toFixed(2)), Number(wy.toFixed(2)), Number(wz.toFixed(2))],
        yaw: wrapYaw(s.yaw + f.yaw),
        tags: s.tags,
        capacity: s.capacity,
      }
    })

    return register({
      id: objId,
      source: 'made',
      ownerId,
      label: label || name || objId,
      slots: worldSlots,
    })
  }

  /**
   * Scan a voxel region via `scanGeometricAffordances` and register discovered
   * overhangs, cover ledges, and sittable ledges as a `geometric` Smart Object.
   */
  function scanRegion(kindFn, bounds, opts = {}) {
    const id = opts.id ?? `geo:${Math.floor(bounds.min[0])}_${Math.floor(bounds.min[2])}`
    const found = scanGeometricAffordances(kindFn, bounds, { ...opts, idPrefix: id })
    return register({
      id,
      source: 'geometric',
      label: opts.label ?? id,
      slots: found,
    })
  }

  /** Remaining free capacity on a slot at `now`. */
  function availableCapacity(slotId, now = 0) {
    const slot = slots.get(slotId)
    if (!slot) return 0
    pruneSlotClaims(slotId, now)
    const map = claims.get(slotId)
    return Math.max(0, slot.capacity - (map ? map.size : 0))
  }

  /** True if the slot currently has at least one active claim (or is claimed by `actorId`). */
  function isClaimed(slotId, now = 0, actorId = undefined) {
    pruneSlotClaims(slotId, now)
    const map = claims.get(slotId)
    if (!map || map.size === 0) return false
    return actorId === undefined ? true : map.has(String(actorId))
  }

  /** List active claimant actorIds for a slot at `now`. */
  function claimants(slotId, now = 0) {
    pruneSlotClaims(slotId, now)
    const map = claims.get(slotId)
    return map ? [...map.keys()] : []
  }

  /** List slotIds currently held by `actorId` at `now`. */
  function claimedBy(actorId, now = 0) {
    const aid = String(actorId)
    const set = actorClaims.get(aid)
    if (!set) return []
    const out = []
    for (const sid of [...set]) {
      pruneSlotClaims(sid, now)
      if (claims.get(sid)?.has(aid)) out.push(sid)
    }
    return out
  }

  /**
   * Reserve a slot for `actorId` until `now + ttlMs`.
   * Guarantees zero double-booking when `capacity === 1`; renews lease if the
   * same actor already holds the slot.
   */
  function claim(slotId, actorId, now = 0, ttlMs = defaultTtlMs) {
    const slot = slots.get(slotId)
    if (!slot) return { ok: false, reason: 'unknown_slot' }
    if (actorId == null || actorId === '') return { ok: false, reason: 'invalid_actor' }
    const aid = String(actorId)
    const lease = Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : defaultTtlMs
    pruneSlotClaims(slotId, now)

    let map = claims.get(slotId)
    if (!map) { map = new Map(); claims.set(slotId, map) }

    const expiresAt = now + lease
    if (map.has(aid)) {
      map.set(aid, expiresAt)
      return { ok: true, renewed: true, slot, expiresAt }
    }
    if (map.size >= slot.capacity) {
      return { ok: false, reason: 'slot_full', holders: [...map.keys()] }
    }
    map.set(aid, expiresAt)
    let held = actorClaims.get(aid)
    if (!held) { held = new Set(); actorClaims.set(aid, held) }
    held.add(slotId)
    return { ok: true, renewed: false, slot, expiresAt }
  }

  /** Release an actor's reservation on `slotId` and record it in their MRU history. */
  function release(slotId, actorId, now = 0) {
    const aid = String(actorId)
    const map = claims.get(slotId)
    if (!map || !map.has(aid)) return false
    map.delete(aid)
    if (map.size === 0) claims.delete(slotId)
    const held = actorClaims.get(aid)
    if (held) { held.delete(slotId); if (held.size === 0) actorClaims.delete(aid) }
    recordRecent(aid, slotId, now)
    return true
  }

  /** Release every slot held by `actorId` (e.g. when an actor despawns). */
  function releaseAllFor(actorId, now = 0) {
    const aid = String(actorId)
    const held = actorClaims.get(aid)
    if (!held) return 0
    let count = 0
    for (const sid of [...held]) {
      if (release(sid, aid, now)) count++
    }
    return count
  }

  /**
   * Spatial O(local) query for slots within `radius` (XZ / 3D distance) of `pos`.
   */
  function queryNear(pos, radius, { kind = null, kinds = null, tags = null, source = null, availableOnly = false, actorId = null, now = 0 } = {}) {
    if (!Array.isArray(pos) || pos.length !== 3 || !Number.isFinite(radius) || radius <= 0) return []
    const kindFilter = kinds
      ? (kinds instanceof Set ? kinds : new Set(kinds))
      : kind ? new Set([kind]) : null
    const tagList = Array.isArray(tags) && tags.length ? tags : null
    const aid = actorId != null ? String(actorId) : null

    const minBx = Math.floor((pos[0] - radius) / tile)
    const maxBx = Math.floor((pos[0] + radius) / tile)
    const minBz = Math.floor((pos[2] - radius) / tile)
    const maxBz = Math.floor((pos[2] + radius) / tile)

    const out = []
    for (let bz = minBz; bz <= maxBz; bz++) {
      for (let bx = minBx; bx <= maxBx; bx++) {
        const set = buckets.get(`${bx},${bz}`)
        if (!set) continue
        for (const slot of set) {
          if (kindFilter && !kindFilter.has(slot.kind)) continue
          if (source && slot.source !== source) continue
          const dist = Math.hypot(slot.pos[0] - pos[0], slot.pos[1] - pos[1], slot.pos[2] - pos[2])
          if (dist > radius) continue
          if (tagList && !tagList.every((t) => slot.tags.includes(t))) continue
          if (availableOnly) {
            pruneSlotClaims(slot.slotId, now)
            const map = claims.get(slot.slotId)
            const alreadyMine = aid !== null && map?.has(aid)
            if (!alreadyMine && (map ? map.size : 0) >= slot.capacity) continue
          }
          out.push({ slot, object: objects.get(slot.objectId), distance: dist })
        }
      }
    }
    out.sort((a, b) => a.distance - b.distance || (a.slot.slotId < b.slot.slotId ? -1 : 1))
    return out
  }

  /**
   * Score nearby candidate slots for `actorId`, factoring in distance, optional
   * tag preferences, availability, and MRU anti-repetition penalty.
   *
   * @param {string} actorId
   * @param {object} query  { pos, radius=300, kind?, kinds?, tags?, source?, now=0, availableOnly=true, avoidRecent=true, excludeRecent=false, scoreFn? }
   */
  function findBest(actorId, query = {}) {
    const pos = query.pos
    const radius = Number.isFinite(query.radius) ? query.radius : 300
    const now = Number.isFinite(query.now) ? query.now : 0
    const availableOnly = query.availableOnly !== false
    const avoidRecent = query.avoidRecent !== false
    const excludeRecent = query.excludeRecent === true
    const preferTags = Array.isArray(query.preferTags) ? query.preferTags : null

    const candidates = queryNear(pos, radius, {
      kind: query.kind ?? null,
      kinds: query.kinds ?? null,
      tags: query.tags ?? null,
      source: query.source ?? null,
      availableOnly,
      actorId,
      now,
    })

    let best = null
    for (const c of candidates) {
      const mruPen = avoidRecent ? mruPenaltyFor(actorId, c.slot, now) : 0
      if (excludeRecent && mruPen > 0) continue

      const distScore = 1 - clamp(c.distance / Math.max(1, radius), 0, 1)
      let tagBonus = 0
      if (preferTags && preferTags.length) {
        let matched = 0
        for (const t of preferTags) if (c.slot.tags.includes(t)) matched++
        tagBonus = 0.25 * (matched / preferTags.length)
      }
      const extra = typeof query.scoreFn === 'function' ? Number(query.scoreFn(c.slot, c.object, c.distance)) || 0 : 0
      const base = Math.max(0.05, distScore + tagBonus + extra)
      // Combine multiplicative + subtractive MRU penalty so recently used slots
      // decisively yield to unused alternatives while staying valid as a last resort.
      const score = Math.max(0.01, base * (1 - mruPen) - mruPen * 0.45)

      if (!best || score > best.score || (score === best.score && c.distance < best.distance)) {
        best = { slot: c.slot, object: c.object, distance: c.distance, score, mruPenalty: mruPen }
      }
    }
    return best
  }

  /** Convenience helper: find the best available slot and claim it atomically. */
  function findBestAndClaim(actorId, query = {}, ttlMs = defaultTtlMs) {
    const found = findBest(actorId, { ...query, availableOnly: true })
    if (!found) return null
    const res = claim(found.slot.slotId, actorId, query.now ?? 0, ttlMs)
    if (!res.ok) return null
    return { ...found, claim: res }
  }

  return {
    get objectCount() { return objects.size },
    get slotCount() { return slots.size },
    register,
    unregister,
    getObject: (id) => objects.get(id) ?? null,
    getSlot: (id) => slots.get(id) ?? null,
    registerCitySlots,
    registerMadeObject,
    scanRegion,
    claim,
    release,
    releaseAllFor,
    sweepExpired,
    isClaimed,
    claimants,
    claimedBy,
    availableCapacity,
    recordRecent,
    mruPenaltyFor,
    queryNear,
    findBest,
    findBestAndClaim,
  }
}
