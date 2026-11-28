// Acoustic & Visual Stimulus Event Bus (#164): spatial-hashed ring buffer for
// world events (blasts, crashes, horns, gunshots, shouts, sirens, player-made
// things, crimes, stalled cars) with distance falloff, voxel material occlusion
// attenuation, time decay, and deterministic divergent crowd reactions.

/** Supported stimulus kinds and their default propagation / threat parameters. */
export const STIMULUS_SPECS = Object.freeze({
  blast:       Object.freeze({ radius: 900, loudness: 1.0,  decayMs: 8000,  modality: 'both',     threat: 0.95 }),
  gunshot:     Object.freeze({ radius: 750, loudness: 0.95, decayMs: 6000,  modality: 'acoustic', threat: 0.95 }),
  crash:       Object.freeze({ radius: 550, loudness: 0.85, decayMs: 9000,  modality: 'both',     threat: 0.72 }),
  crime:       Object.freeze({ radius: 360, loudness: 0.75, decayMs: 12000, modality: 'both',     threat: 0.78 }),
  siren:       Object.freeze({ radius: 650, loudness: 0.70, decayMs: 4000,  modality: 'acoustic', threat: 0.35 }),
  shout:       Object.freeze({ radius: 280, loudness: 0.60, decayMs: 3500,  modality: 'acoustic', threat: 0.40 }),
  horn:        Object.freeze({ radius: 340, loudness: 0.55, decayMs: 2500,  modality: 'acoustic', threat: 0.22 }),
  stalled_car: Object.freeze({ radius: 260, loudness: 0.40, decayMs: 10000, modality: 'visual',   threat: 0.12 }),
  made_thing:  Object.freeze({ radius: 320, loudness: 0.65, decayMs: 15000, modality: 'visual',   threat: 0.05 }),
})

/** Allowlisted stimulus kind names. */
export const STIMULUS_KINDS = Object.freeze(Object.keys(STIMULUS_SPECS))

/** Divergent crowd reaction roles. */
export const REACTIONS = Object.freeze(['flee', 'shelter', 'film', 'confront', 'call_help', 'glance'])

/**
 * Acoustic absorption per 10 cm cell by engine material id (`kind & 15`,
 * matching `engine/core/src/kinds.rs`). Transmission across a wall is
 * `Math.exp(-sum(absorption))`.
 */
export const MATERIAL_ATTENUATION = Object.freeze({
  0:  0.00, // air
  1:  0.18, // earth
  2:  0.24, // rock
  3:  0.15, // grass
  4:  0.17, // sand
  5:  0.05, // water
  6:  0.22, // asphalt
  7:  0.24, // concrete
  8:  0.20, // brick
  9:  0.14, // plaster
  10: 0.13, // wood
  11: 0.09, // glass (visually transparent, moderately dampens sound)
  12: 0.24, // steel
  13: 0.03, // leaves
  14: 0.14, // roofing
  15: 0.10, // lamp
})

/** Materials that are visually transparent (air, water, glass — matching sight.mjs). */
const isVisuallyClear = (k) => { const m = k & 15; return m === 0 || m === 5 || m === 11 }
/** Materials that are acoustically open air. */
const isAir = (k) => (k & 15) === 0

/** Ear/eye height above actor feet in 10 cm cells. */
const EAR_HEIGHT = 15

/** Clamps a number to [lo, hi]. */
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

/** Deterministic 32-bit FNV-1a hash for string/number seeds. */
function hash32(input) {
  const str = String(input)
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Deterministic PRNG step from uint32 -> [0, 1). */
function nextUnit(state) {
  let x = (state + 0x6d2b79f5) >>> 0
  x = Math.imul(x ^ (x >>> 15), 1 | x)
  x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296
}

/**
 * Derive a realistic, deterministic personality profile from any actor id or
 * numeric seed so a crowd naturally spans cautious, sheltered, curious, civic,
 * and bold archetypes without using `Math.random()`.
 */
export function personalityFromSeed(seed) {
  const h = hash32(seed)
  // Stratified archetype blend + continuous trait jitter so every crowd of ~20
  // reliably includes distinct flee, shelter, film, call_help, and bold actors.
  const bucket = h % 10
  const u1 = nextUnit(h ^ 0x9e3779b9)
  const u2 = nextUnit(h ^ 0x85ebca6b)
  const u3 = nextUnit(h ^ 0xc2b2ae35)
  const u4 = nextUnit(h ^ 0x27d4eb2f)
  const u5 = nextUnit(h ^ 0x165667b1)

  // Archetypes:
  // 0,1,2: cautious runners (flee-leaning)
  // 3,4:   composed cover-seekers (shelter-leaning)
  // 5,6:   curious spectators / phone filmers (film-leaning)
  // 7,8:   civic helpers (call_help-leaning)
  // 9:     bold / confrontational
  if (bucket <= 2) {
    return {
      id: String(seed),
      bravery:    clamp(0.12 + u1 * 0.22, 0, 1),
      composure:  clamp(0.15 + u2 * 0.25, 0, 1),
      curiosity:  clamp(0.20 + u3 * 0.30, 0, 1),
      civic:      clamp(0.25 + u4 * 0.30, 0, 1),
      aggression: clamp(0.05 + u5 * 0.15, 0, 1),
    }
  }
  if (bucket <= 4) {
    return {
      id: String(seed),
      bravery:    clamp(0.28 + u1 * 0.24, 0, 1),
      composure:  clamp(0.62 + u2 * 0.28, 0, 1),
      curiosity:  clamp(0.20 + u3 * 0.28, 0, 1),
      civic:      clamp(0.30 + u4 * 0.28, 0, 1),
      aggression: clamp(0.08 + u5 * 0.18, 0, 1),
    }
  }
  if (bucket <= 6) {
    return {
      id: String(seed),
      bravery:    clamp(0.55 + u1 * 0.25, 0, 1),
      composure:  clamp(0.50 + u2 * 0.30, 0, 1),
      curiosity:  clamp(0.75 + u3 * 0.23, 0, 1),
      civic:      clamp(0.20 + u4 * 0.25, 0, 1),
      aggression: clamp(0.10 + u5 * 0.20, 0, 1),
    }
  }
  if (bucket <= 8) {
    return {
      id: String(seed),
      bravery:    clamp(0.45 + u1 * 0.25, 0, 1),
      composure:  clamp(0.65 + u2 * 0.25, 0, 1),
      curiosity:  clamp(0.25 + u3 * 0.25, 0, 1),
      civic:      clamp(0.78 + u4 * 0.20, 0, 1),
      aggression: clamp(0.10 + u5 * 0.18, 0, 1),
    }
  }
  return {
    id: String(seed),
    bravery:    clamp(0.78 + u1 * 0.20, 0, 1),
    composure:  clamp(0.45 + u2 * 0.30, 0, 1),
    curiosity:  clamp(0.35 + u3 * 0.25, 0, 1),
    civic:      clamp(0.35 + u4 * 0.25, 0, 1),
    aggression: clamp(0.72 + u5 * 0.25, 0, 1),
  }
}

/**
 * Raymarch between two world points (in 10 cm cells) to measure acoustic
 * absorption and visual occlusion through voxel terrain/buildings.
 *
 * @param {number[]} from
 * @param {number[]} to
 * @param {(x: number, y: number, z: number) => number} kindFn
 * @param {'acoustic'|'visual'|'both'} modality
 * @returns {{ occludedCells: number, absorption: number, visualBlocked: boolean, transmission: number }}
 */
export function rayAttenuation(from, to, kindFn, modality = 'both') {
  const dx = to[0] - from[0]
  const dy = to[1] - from[1]
  const dz = to[2] - from[2]
  const dist = Math.hypot(dx, dy, dz)
  if (dist < 1 || typeof kindFn !== 'function') {
    return { occludedCells: 0, absorption: 0, visualBlocked: false, transmission: 1 }
  }
  const inv = 1 / dist
  const sx = dx * inv, sy = dy * inv, sz = dz * inv
  let occludedCells = 0
  let absorption = 0
  let visualBlocked = false
  let prevX = NaN, prevY = NaN, prevZ = NaN

  // Step 1 cell at a time, skipping endpoints.
  const steps = Math.floor(dist)
  for (let s = 1; s < steps; s++) {
    const cx = Math.floor(from[0] + sx * s)
    const cy = Math.floor(from[1] + sy * s)
    const cz = Math.floor(from[2] + sz * s)
    if (cx === prevX && cy === prevY && cz === prevZ) continue
    prevX = cx; prevY = cy; prevZ = cz
    const k = kindFn(cx, cy, cz) | 0
    if (isAir(k)) continue
    const mat = k & 15
    occludedCells++
    absorption += MATERIAL_ATTENUATION[mat] ?? 0.25
    if (!isVisuallyClear(k)) visualBlocked = true
    // Early exit when sound is already attenuated below 0.5% and sight is blocked.
    if (absorption >= 5.5 && (visualBlocked || modality === 'acoustic')) break
  }

  let transmission
  if (modality === 'visual') {
    transmission = visualBlocked ? 0 : 1
  } else if (modality === 'acoustic') {
    transmission = Math.exp(-absorption)
  } else {
    // 'both': visual component contributes when unobstructed; acoustic carries through walls with attenuation.
    const acoustic = Math.exp(-absorption)
    transmission = visualBlocked ? acoustic * 0.85 : Math.min(1, acoustic * 0.7 + 0.3)
  }
  return { occludedCells, absorption, visualBlocked, transmission }
}

/**
 * Deterministic divergent crowd reaction selector. Splits bystanders cleanly
 * across `flee`, `shelter`, `film`, `confront`, `call_help`, and `glance`
 * based on personality traits and stimulus characteristics.
 *
 * @param {object} personality  { bravery, curiosity, civic, composure, aggression, id? }
 * @param {object} stimulus     perceived stimulus ({ event, salience, distance, ... }) or raw event
 * @returns {{ reaction: string, scores: Record<string, number>, confidence: number }}
 */
export function chooseReaction(personality = {}, stimulus = {}) {
  const ev = stimulus.event ?? stimulus
  const kind = ev.kind ?? 'shout'
  const spec = STIMULUS_SPECS[kind] ?? STIMULUS_SPECS.shout
  const salience = clamp(stimulus.salience ?? ev.loudness ?? spec.loudness, 0, 1)
  const threat = clamp(ev.threat ?? spec.threat, 0, 1)
  const distance = Number.isFinite(stimulus.distance) ? stimulus.distance : 120

  const bravery    = clamp(personality.bravery    ?? 0.5, 0, 1)
  const composure  = clamp(personality.composure  ?? 0.5, 0, 1)
  const curiosity  = clamp(personality.curiosity  ?? 0.5, 0, 1)
  const civic      = clamp(personality.civic      ?? 0.5, 0, 1)
  const aggression = clamp(personality.aggression ?? 0.2, 0, 1)

  // Proximity panic factor: very close high-threat events amplify flee/shelter.
  const closeFactor = clamp(1 - distance / 200, 0, 1)
  const danger = threat * salience

  // Tiny deterministic jitter (< 0.02) from personality id + event id to break exact ties cleanly.
  const tieSeed = hash32(`${personality.id ?? ''}:${ev.id ?? kind}`)
  const jitter = (idx) => (nextUnit(tieSeed ^ (idx * 0x9e3779b9)) - 0.5) * 0.015

  const isNovelty = kind === 'made_thing' || kind === 'stalled_car'
  const isConfrontable = kind === 'crime' || kind === 'shout' || kind === 'horn' || kind === 'crash'

  const scores = {
    flee: isNovelty
      ? 0.01
      : clamp(danger * (1.28 - bravery * 0.95) * (1.12 - composure * 0.60) + danger * closeFactor * 0.20 + jitter(1), 0, 1.5),

    shelter: isNovelty
      ? 0.01
      : clamp(danger * (0.92 - bravery * 0.45) * (0.42 + composure * 0.78) + (kind === 'blast' || kind === 'gunshot' ? 0.10 * danger : 0) + jitter(2), 0, 1.5),

    film: clamp(
      (isNovelty ? salience * 0.85 : danger * 0.80 + salience * 0.15) *
      (0.32 + curiosity * 0.95) *
      (0.45 + bravery * 0.55) *
      (closeFactor > 0.85 && threat > 0.8 ? 0.55 : 1.0) +
      jitter(3),
      0, 1.5
    ),

    call_help: isNovelty
      ? 0.02
      : clamp(
          danger * (0.28 + civic * 0.98) * (0.48 + composure * 0.62) +
          (kind === 'crime' || kind === 'crash' || kind === 'blast' || kind === 'gunshot' ? 0.08 * civic * salience : 0) +
          jitter(4),
          0, 1.5
        ),

    confront: isNovelty
      ? 0.01
      : clamp(
          danger * (isConfrontable ? 1.05 : 0.62) * (0.25 + bravery * 0.60) * (0.20 + aggression * 0.95) +
          jitter(5),
          0, 1.5
        ),

    glance: clamp(
      (1 - danger * 0.92) * 0.58 + (isNovelty ? salience * 0.48 * (1 - curiosity * 0.45) : 0) + jitter(6),
      0, 1.5
    ),
  }

  let best = 'glance'
  let bestScore = -Infinity
  let secondScore = -Infinity
  for (const r of REACTIONS) {
    const s = scores[r]
    if (s > bestScore) {
      secondScore = bestScore
      bestScore = s
      best = r
    } else if (s > secondScore) {
      secondScore = s
    }
  }

  const confidence = bestScore > 0 ? clamp((bestScore - Math.max(0, secondScore)) / bestScore, 0, 1) : 0
  return { reaction: best, scores, confidence }
}

/**
 * Create an Acoustic & Visual Stimulus Event Bus backed by a spatial-hashed
 * ring buffer with automatic time decay.
 *
 * @param {object} [opts]
 * @param {number} [opts.tileSize=128]   XZ spatial bucket size in 10 cm cells
 * @param {number} [opts.maxEvents=256]  ring buffer capacity
 */
export function createStimulusBus({ tileSize = 128, maxEvents = 256 } = {}) {
  const tile = Math.max(16, tileSize | 0)
  const cap = Math.max(8, maxEvents | 0)
  /** @type {Array<object|null>} */
  const ring = new Array(cap).fill(null)
  let head = 0
  let nextId = 1
  let activeCount = 0
  let maxActiveRadius = 0

  /** Spatial hash: `${bx},${bz}` -> Set<event> */
  const buckets = new Map()
  /** Optional subscribers notified immediately on emit (for event-driven StateTree). */
  const listeners = new Set()

  const bucketKey = (x, z) => `${Math.floor(x / tile)},${Math.floor(z / tile)}`

  const addToBucket = (ev) => {
    const key = ev._bkey
    let set = buckets.get(key)
    if (!set) { set = new Set(); buckets.set(key, set) }
    set.add(ev)
  }

  const removeFromBucket = (ev) => {
    const set = buckets.get(ev._bkey)
    if (!set) return
    set.delete(ev)
    if (set.size === 0) buckets.delete(ev._bkey)
  }

  const recomputeMaxRadius = () => {
    let m = 0
    for (let i = 0; i < cap; i++) {
      const ev = ring[i]
      if (ev && ev.radius > m) m = ev.radius
    }
    maxActiveRadius = m
  }

  const removeSlot = (idx) => {
    const ev = ring[idx]
    if (!ev) return
    removeFromBucket(ev)
    ring[idx] = null
    activeCount--
  }

  /** Remove all decayed events as of `now` (ms). */
  function sweep(now) {
    let removed = 0
    let maxDropped = false
    for (let i = 0; i < cap; i++) {
      const ev = ring[i]
      if (!ev) continue
      if (now - ev.at >= ev.decayMs) {
        if (ev.radius >= maxActiveRadius) maxDropped = true
        removeSlot(i)
        removed++
      }
    }
    if (maxDropped) recomputeMaxRadius()
    return removed
  }

  /**
   * Emit a world stimulus into the spatial ring buffer and notify subscribers.
   *
   * @param {object} input  { kind, pos: [x,y,z], radius?, loudness?, decayMs?, threat?, actorId?, meta?, now }
   */
  function emit(input) {
    if (!input || typeof input !== 'object') throw new Error('stimulus event must be an object')
    const kind = input.kind
    if (!Object.hasOwn(STIMULUS_SPECS, kind)) {
      throw new Error(`unknown stimulus kind "${String(kind)}": expected one of ${STIMULUS_KINDS.join(', ')}`)
    }
    const pos = input.pos
    if (!Array.isArray(pos) || pos.length !== 3 || !pos.every((v) => typeof v === 'number' && Number.isFinite(v))) {
      throw new Error('stimulus pos must be [x, y, z] finite numbers')
    }
    const spec = STIMULUS_SPECS[kind]
    const now = Number.isFinite(input.now) ? input.now : 0
    const radius = Number.isFinite(input.radius) && input.radius > 0 ? input.radius : spec.radius
    const loudness = Number.isFinite(input.loudness) ? clamp(input.loudness, 0, 2) : spec.loudness
    const decayMs = Number.isFinite(input.decayMs) && input.decayMs > 0 ? input.decayMs : spec.decayMs
    const threat = Number.isFinite(input.threat) ? clamp(input.threat, 0, 1) : spec.threat

    const ev = {
      id: nextId++,
      kind,
      pos: [pos[0], pos[1], pos[2]],
      radius,
      loudness,
      decayMs,
      modality: input.modality ?? spec.modality,
      threat,
      actorId: input.actorId ?? null,
      meta: input.meta ?? null,
      at: now,
      _bkey: bucketKey(pos[0], pos[2]),
      _slot: head,
    }

    const evicted = ring[head]
    if (evicted) removeSlot(head)
    ring[head] = ev
    head = (head + 1) % cap
    activeCount++
    addToBucket(ev)
    if (radius > maxActiveRadius) maxActiveRadius = radius
    else if (evicted && evicted.radius >= maxActiveRadius) recomputeMaxRadius()

    for (const fn of listeners) fn(ev)
    return ev
  }

  /**
   * Perceive active stimuli from a listener's position with distance falloff,
   * time decay, and optional voxel wall occlusion attenuation.
   *
   * @param {object} listener  { id?, pos?: [x,y,z], at?: [x,y,z], yaw?, hearing?, earHeight? }
   * @param {object} [opts]
   * @param {(x:number,y:number,z:number)=>number} [opts.kind]  voxel lookup function
   * @param {number} [opts.now=0]
   * @param {boolean} [opts.rayOcclusion=true]
   * @param {number} [opts.minSalience=0.02]
   * @param {number} [opts.maxResults=8]
   * @param {boolean} [opts.ignoreSelf=true]
   * @param {string[]|Set<string>} [opts.kinds]  optional kind filter
   */
  function perceive(listener, opts = {}) {
    if (!listener || typeof listener !== 'object') return []
    const lpos = listener.pos ?? listener.at
    if (!Array.isArray(lpos) || lpos.length !== 3) return []
    const now = Number.isFinite(opts.now) ? opts.now : 0
    if (activeCount === 0) return []

    const kindFn = typeof opts.kind === 'function' ? opts.kind : null
    const rayOcclusion = opts.rayOcclusion !== false && kindFn !== null
    const minSalience = Number.isFinite(opts.minSalience) ? opts.minSalience : 0.02
    const maxResults = Number.isFinite(opts.maxResults) ? opts.maxResults : 8
    const ignoreSelf = opts.ignoreSelf !== false
    const kindFilter = opts.kinds ? (opts.kinds instanceof Set ? opts.kinds : new Set(opts.kinds)) : null
    const hearing = Number.isFinite(listener.hearing) ? clamp(listener.hearing, 0, 2) : 1.0
    const earY = lpos[1] + (Number.isFinite(listener.earHeight) ? listener.earHeight : EAR_HEIGHT)
    const earPos = [lpos[0], earY, lpos[2]]

    const searchRadius = Math.min(maxActiveRadius, Number.isFinite(opts.maxRange) ? opts.maxRange : maxActiveRadius)
    const minBx = Math.floor((lpos[0] - searchRadius) / tile)
    const maxBx = Math.floor((lpos[0] + searchRadius) / tile)
    const minBz = Math.floor((lpos[2] - searchRadius) / tile)
    const maxBz = Math.floor((lpos[2] + searchRadius) / tile)

    const out = []
    let expiredSeen = false

    for (let bz = minBz; bz <= maxBz; bz++) {
      for (let bx = minBx; bx <= maxBx; bx++) {
        const set = buckets.get(`${bx},${bz}`)
        if (!set) continue
        for (const ev of set) {
          const age = now - ev.at
          if (age < 0) continue
          if (age >= ev.decayMs) { expiredSeen = true; continue }
          if (ignoreSelf && listener.id != null && ev.actorId === listener.id) continue
          if (kindFilter && !kindFilter.has(ev.kind)) continue

          const dist = Math.hypot(ev.pos[0] - lpos[0], ev.pos[1] - lpos[1], ev.pos[2] - lpos[2])
          if (dist > ev.radius) continue

          // Distance falloff: 1 at source, smoothly reaching 0 at ev.radius.
          const norm = dist / ev.radius
          const distFactor = Math.pow(1 - norm, 1.5)
          const ageFactor = 1 - age / ev.decayMs

          let occludedCells = 0
          let absorption = 0
          let visualBlocked = false
          let transmission = 1

          if (rayOcclusion) {
            const att = rayAttenuation(earPos, ev.pos, kindFn, ev.modality)
            occludedCells = att.occludedCells
            absorption = att.absorption
            visualBlocked = att.visualBlocked
            transmission = att.transmission
          }

          const modGain = ev.modality === 'visual' ? 1.0 : hearing
          const intensity = ev.loudness * distFactor * transmission * modGain
          const salience = clamp(intensity * ageFactor, 0, 1)
          if (salience < minSalience) continue

          out.push({
            event: ev,
            kind: ev.kind,
            distance: dist,
            ageMs: age,
            occludedCells,
            absorption,
            visualBlocked,
            transmission,
            intensity,
            salience,
          })
        }
      }
    }

    if (expiredSeen) sweep(now)

    out.sort((a, b) => b.salience - a.salience || a.distance - b.distance || a.event.id - b.event.id)
    if (out.length > maxResults) out.length = maxResults
    return out
  }

  /** Subscribe to newly emitted stimuli (returns unsubscribe fn). */
  function subscribe(fn) {
    if (typeof fn !== 'function') throw new Error('subscriber must be a function')
    listeners.add(fn)
    return () => listeners.delete(fn)
  }

  /** Clear all stored events. */
  function clear() {
    ring.fill(null)
    buckets.clear()
    head = 0
    activeCount = 0
    maxActiveRadius = 0
  }

  return {
    get size() { return activeCount },
    get capacity() { return cap },
    emit,
    perceive,
    sweep,
    subscribe,
    clear,
  }
}
