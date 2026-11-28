// Player-made voxel object affordances (#164): pure data schema validator and
// geometric + label auto-tagger.
//
// Model output is data, never authority: `validateAffordances` enforces an
// allowlist of slot kinds, clamps coordinates inside the object's bounds, caps
// slot counts, and strips unknown fields. `inferAffordances` analyzes voxel
// geometry and object names so player-made things ("park bench", "bus shelter",
// "lemonade stand", "sandbag barricade", "neon statue") automatically emit
// usable Smart Object slots even when no explicit metadata was authored.

/** Allowed affordance slot kinds, shared with SmartObjectRegistry. */
export const AFFORDANCE_KINDS = Object.freeze(['sit', 'shelter', 'browse', 'cover', 'spectacle', 'queue'])
const KIND_SET = new Set(AFFORDANCE_KINDS)

/** Strict schema limits so untrusted replies stay small and bounded. */
export const SLOTS_MOST = 8
export const TAGS_MOST = 8
export const TAG_LEN_MOST = 24
export const CAPACITY_MOST = 4

const TAG_RE = /^[a-z0-9][a-z0-9_-]{0,23}$/

/** Materials considered solid structure (everything except air=0 and water=5). */
const isSolid = (k) => { const m = k & 15; return m !== 0 && m !== 5 }
/** Emissive lamp material (matching engine/core/src/kinds.rs). */
const isLamp = (k) => (k & 15) === 15

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

/** Normalize yaw into [-PI, PI]. */
function wrapYaw(rad) {
  let a = rad % (Math.PI * 2)
  if (a > Math.PI) a -= Math.PI * 2
  if (a < -Math.PI) a += Math.PI * 2
  return Object.is(a, -0) ? 0 : a
}

/**
 * Normalize bounds input into `{ min: [x0,y0,z0], max: [x1,y1,z1] }`.
 * Accepts `[w, h, d]`, `{ size: [w, h, d] }`, or `{ min: [...], max: [...] }`.
 */
function normalizeBounds(bounds) {
  if (Array.isArray(bounds) && bounds.length === 3 && bounds.every((n) => typeof n === 'number' && Number.isFinite(n) && n > 0)) {
    return { min: [0, 0, 0], max: [bounds[0], bounds[1], bounds[2]] }
  }
  if (bounds && typeof bounds === 'object') {
    if (Array.isArray(bounds.size)) return normalizeBounds(bounds.size)
    if (
      Array.isArray(bounds.min) && bounds.min.length === 3 &&
      Array.isArray(bounds.max) && bounds.max.length === 3 &&
      bounds.min.every((n) => typeof n === 'number' && Number.isFinite(n)) &&
      bounds.max.every((n) => typeof n === 'number' && Number.isFinite(n))
    ) {
      return {
        min: [Math.min(bounds.min[0], bounds.max[0]), Math.min(bounds.min[1], bounds.max[1]), Math.min(bounds.min[2], bounds.max[2])],
        max: [Math.max(bounds.min[0], bounds.max[0]), Math.max(bounds.min[1], bounds.max[1]), Math.max(bounds.min[2], bounds.max[2])],
      }
    }
  }
  return { min: [0, 0, 0], max: [64, 80, 64] }
}

/**
 * Validate and sanitize raw affordance slots as pure data.
 *
 * - Accepts an array of slot objects or `{ slots: [...] }`.
 * - Rejects non-objects, disallowed `kind`, and non-finite `pos`.
 * - Clamps finite coordinates inside `bounds` (with optional `pad` margin).
 * - Caps total slots to `SLOTS_MOST` (8).
 * - Strips every unknown field (including prototype-pollution keys).
 *
 * @param {unknown} raw
 * @param {number[]|{min:number[],max:number[]}|{size:number[]}} bounds
 * @param {{ pad?: number }} [opts]
 * @returns {{ valid: boolean, slots: Array<{ kind: string, pos: [number,number,number], yaw: number, tags: string[], capacity: number }>, rejected: number, warnings: string[] }}
 */
export function validateAffordances(raw, bounds, { pad = 0 } = {}) {
  const b = normalizeBounds(bounds)
  const margin = Number.isFinite(pad) && pad >= 0 ? Math.min(pad, 16) : 0
  const lo = [b.min[0] - margin, b.min[1], b.min[2] - margin]
  const hi = [b.max[0] + margin, b.max[1], b.max[2] + margin]

  const warnings = []
  let list = null
  if (Array.isArray(raw)) {
    list = raw
  } else if (raw && typeof raw === 'object' && Array.isArray(raw.slots)) {
    list = raw.slots
    for (const k of Object.keys(raw)) {
      if (k !== 'slots') warnings.push(`stripped unknown top-level field "${k.slice(0, 24)}"`)
    }
  } else {
    return { valid: false, slots: [], rejected: 1, warnings: ['affordances must be an array or { slots: [...] }'] }
  }

  let rejected = 0
  const slots = []

  if (list.length > SLOTS_MOST) {
    warnings.push(`capped slots from ${list.length} to ${SLOTS_MOST}`)
  }

  for (let i = 0; i < list.length && slots.length < SLOTS_MOST; i++) {
    const entry = list[i]
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      rejected++
      warnings.push(`slot[${i}]: expected object`)
      continue
    }
    const kind = typeof entry.kind === 'string' ? entry.kind.trim().toLowerCase() : ''
    if (!KIND_SET.has(kind)) {
      rejected++
      warnings.push(`slot[${i}]: disallowed kind "${String(entry.kind).slice(0, 24)}"`)
      continue
    }
    if (!Array.isArray(entry.pos) || entry.pos.length !== 3 || !entry.pos.every((v) => typeof v === 'number' && Number.isFinite(v))) {
      rejected++
      warnings.push(`slot[${i}]: pos must be 3 finite numbers`)
      continue
    }

    const clamped = [
      clamp(entry.pos[0], lo[0], hi[0]),
      clamp(entry.pos[1], lo[1], hi[1]),
      clamp(entry.pos[2], lo[2], hi[2]),
    ]
    if (clamped[0] !== entry.pos[0] || clamped[1] !== entry.pos[1] || clamped[2] !== entry.pos[2]) {
      warnings.push(`slot[${i}]: clamped pos [${entry.pos.join(',')}] inside bounds`)
    }

    const yaw = typeof entry.yaw === 'number' && Number.isFinite(entry.yaw) ? wrapYaw(entry.yaw) : 0
    if (entry.yaw !== undefined && (typeof entry.yaw !== 'number' || !Number.isFinite(entry.yaw))) {
      warnings.push(`slot[${i}]: reset invalid yaw to 0`)
    }

    let capacity = 1
    if (entry.capacity !== undefined) {
      if (typeof entry.capacity === 'number' && Number.isFinite(entry.capacity)) {
        capacity = clamp(Math.round(entry.capacity), 1, CAPACITY_MOST)
      } else {
        warnings.push(`slot[${i}]: reset invalid capacity to 1`)
      }
    }

    const tags = []
    if (Array.isArray(entry.tags)) {
      const seenTags = new Set()
      for (const t of entry.tags) {
        if (tags.length >= TAGS_MOST) break
        if (typeof t !== 'string') continue
        const clean = t.trim().toLowerCase().slice(0, TAG_LEN_MOST)
        if (TAG_RE.test(clean) && !seenTags.has(clean)) {
          seenTags.add(clean)
          tags.push(clean)
        }
      }
    }

    for (const k of Object.keys(entry)) {
      if (k !== 'kind' && k !== 'pos' && k !== 'yaw' && k !== 'tags' && k !== 'capacity') {
        warnings.push(`slot[${i}]: stripped unknown field "${k.slice(0, 24)}"`)
      }
    }

    // Construct a fresh plain object with only allowlisted keys.
    slots.push({
      kind,
      pos: [Number(clamped[0].toFixed(2)), Number(clamped[1].toFixed(2)), Number(clamped[2].toFixed(2))],
      yaw: Number(yaw.toFixed(4)),
      tags,
      capacity,
    })
  }

  return {
    valid: rejected === 0 && warnings.length === 0,
    slots,
    rejected,
    warnings,
  }
}

/** Semantic label heuristics for inferring affordances from object names. */
const LABEL_RULES = [
  { kind: 'sit',       tag: 'seating',   re: /\b(bench|chair|stool|sofa|couch|pew|seat|bleacher|picnic\s*table|lounger|ottoman)\b/i },
  { kind: 'shelter',   tag: 'awning',    re: /\b(shelter|bus\s*stop|canopy|awning|pergola|gazebo|tent|pavilion|umbrella|overhang)\b/i },
  { kind: 'browse',    tag: 'vendor',    re: /\b(stand|stall|shop|cart|booth|counter|kiosk|vending|bookshelf|market|cafe|lemonade|coffee|newsstand|bakery|food\s*truck)\b/i },
  { kind: 'cover',     tag: 'barricade', re: /\b(barricade|sandbag|jersey\s*barrier|barrier|bunker|planter|dumpster|crate|wall|fort|shield)\b/i },
  { kind: 'spectacle', tag: 'landmark',  re: /\b(statue|fountain|monument|sculpture|neon|mural|stage|hologram|billboard|totem|art|obelisk|clock\s*tower)\b/i },
  { kind: 'queue',     tag: 'queue',     re: /\b(ticket|atm|register|bus\s*stop|stand|kiosk|booth)\b/i },
]

/** Inspect voxel grid (Uint16Array or array indexed `(y * d + z) * w + x`) for geometric affordances. */
function analyzeVoxelGeometry(size, cells) {
  const [w, h, d] = size
  const at = (x, y, z) => {
    if (x < 0 || y < 0 || z < 0 || x >= w || y >= h || z >= d) return 0
    return cells[(y * d + z) * w + x] | 0
  }

  const slots = []
  let lampCount = 0
  let solidCount = 0

  // 1. Scan for flat sittable surfaces (top solid y in 3..6, i.e., height 4..7 cells above ground)
  //    with at least 6 cells of clear air above them.
  const sitCells = []
  // 2. Scan for shelter canopy (solid ceiling at y >= 18 with walkable clear air underneath).
  const shelterCols = []
  // 3. Scan for waist-high cover barrier (column top in 7..14 cells).
  const coverCols = []

  for (let z = 0; z < d; z++) {
    for (let x = 0; x < w; x++) {
      let topSolid = -1
      let lowSolid = -1
      let ceilingY = -1
      let maxAirRun = 0
      let curAir = 0

      for (let y = 0; y < h; y++) {
        const k = at(x, y, z)
        if (isSolid(k)) {
          solidCount++
          if (isLamp(k)) lampCount++
          if (lowSolid < 0) lowSolid = y
          if (curAir >= 14 && y >= 18 && ceilingY < 0) ceilingY = y
          curAir = 0
          topSolid = y
        } else {
          curAir++
          if (curAir > maxAirRun) maxAirRun = curAir
        }
      }

      if (ceilingY >= 18) {
        // Verify bottom 14 cells above floor (y 1..15) are mostly open for standing.
        let open = 0
        for (let y = 1; y <= Math.min(h - 1, 15); y++) if (!isSolid(at(x, y, z))) open++
        if (open >= 12) shelterCols.push([x, 0, z])
      }

      // Check for flat seat top at y in 3..6 with clear headroom above it.
      for (let sy = Math.min(6, h - 1); sy >= 3; sy--) {
        if (!isSolid(at(x, sy, z))) continue
        let clearAbove = true
        const headTop = Math.min(h - 1, sy + 6)
        for (let y = sy + 1; y <= headTop; y++) {
          if (isSolid(at(x, y, z))) { clearAbove = false; break }
        }
        if (clearAbove) {
          sitCells.push([x, sy + 1, z])
          break
        }
      }

      if (topSolid >= 7 && topSolid <= 14) {
        coverCols.push([x, topSolid + 1, z])
      }
    }
  }

  // Emit sittable slots along the wider axis of detected seat surfaces.
  if (sitCells.length >= 6) {
    let minX = w, maxX = 0, minZ = d, maxZ = 0, sumY = 0
    for (const [x, y, z] of sitCells) {
      if (x < minX) minX = x; if (x > maxX) maxX = x
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
      sumY += y
    }
    const spanX = maxX - minX + 1
    const spanZ = maxZ - minZ + 1
    const seatY = Math.round(sumY / sitCells.length)
    // Only treat as a bench/seat if it isn't a huge solid slab covering a tall wall.
    if (spanX >= 3 && spanZ >= 2) {
      const alongX = spanX >= spanZ
      const longSpan = alongX ? spanX : spanZ
      const count = clamp(Math.floor(longSpan / 6), 1, 3)
      for (let i = 0; i < count; i++) {
        const frac = (i + 0.5) / count
        const sx = alongX ? minX + frac * spanX : (minX + maxX + 1) / 2
        const sz = alongX ? (minZ + maxZ + 1) / 2 : minZ + frac * spanZ
        // Front of a form.mjs thing is z=0 (facing -z => yaw = 0 in engine coords where sin(yaw)*dx - cos(yaw)*dz).
        slots.push({ kind: 'sit', pos: [sx, seatY, sz], yaw: 0, tags: ['geometric', 'seat'], capacity: 1 })
      }
    }
  }

  // Emit shelter slots under detected canopy.
  if (shelterCols.length >= 16) {
    let sumX = 0, sumZ = 0, minX = w, maxX = 0
    for (const [x, , z] of shelterCols) {
      sumX += x; sumZ += z
      if (x < minX) minX = x; if (x > maxX) maxX = x
    }
    const cx = sumX / shelterCols.length + 0.5
    const cz = sumZ / shelterCols.length + 0.5
    const spanX = maxX - minX + 1
    if (spanX >= 20) {
      slots.push({ kind: 'shelter', pos: [minX + spanX * 0.3, 0, cz], yaw: 0, tags: ['geometric', 'overhang'], capacity: 2 })
      slots.push({ kind: 'shelter', pos: [minX + spanX * 0.7, 0, cz], yaw: 0, tags: ['geometric', 'overhang'], capacity: 2 })
    } else {
      slots.push({ kind: 'shelter', pos: [cx, 0, cz], yaw: 0, tags: ['geometric', 'overhang'], capacity: 2 })
    }
  }

  // Emit cover slots along waist-high barrier (skip thin backrests of detected seating).
  if (coverCols.length >= 12 && shelterCols.length < 16 && sitCells.length <= coverCols.length * 2) {
    let minX = w, maxX = 0, minZ = d, maxZ = 0
    for (const [x, , z] of coverCols) {
      if (x < minX) minX = x; if (x > maxX) maxX = x
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
    }
    const cx = (minX + maxX + 1) / 2
    const frontZ = Math.max(0, minZ - 1)
    slots.push({ kind: 'cover', pos: [cx, 0, frontZ], yaw: Math.PI, tags: ['geometric', 'waist-high'], capacity: 1 })
  }

  // Emit spectacle slot if glowing (lamp voxels) or tall sculptural form.
  if (lampCount >= 4 || (h >= 20 && solidCount >= 40 && Math.max(w, d) <= 24 && shelterCols.length < 16)) {
    slots.push({
      kind: 'spectacle',
      pos: [w / 2, 0, 0],
      yaw: Math.PI,
      tags: lampCount >= 4 ? ['geometric', 'lit'] : ['geometric', 'tall'],
      capacity: 2,
    })
  }

  return slots
}

/**
 * Automatically infer validated affordance slots from a player-made voxel
 * object's name, size, and optional voxel cell grid.
 *
 * @param {{ name?: string, size: [number,number,number], cells?: Uint16Array|number[] }} thing
 * @returns {{ slots: Array<{ kind: string, pos: [number,number,number], yaw: number, tags: string[], capacity: number }>, inferredBy: string[] }}
 */
export function inferAffordances({ name = '', size = [16, 16, 16], cells = null } = {}) {
  const b = normalizeBounds(size)
  const [w, h, d] = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]]
  const candidates = []
  const inferredBy = []

  // 1. Geometric analysis when voxel cells are present.
  if (cells && cells.length >= w * h * d) {
    const geo = analyzeVoxelGeometry([w, h, d], cells)
    if (geo.length) {
      candidates.push(...geo)
      inferredBy.push('geometry')
    }
  }

  // 2. Semantic label heuristics from object name.
  const label = typeof name === 'string' ? name.trim() : ''
  const existingKinds = new Set(candidates.map((s) => s.kind))

  if (label) {
    for (const rule of LABEL_RULES) {
      if (!rule.re.test(label)) continue
      inferredBy.push(`label:${rule.kind}`)
      if (existingKinds.has(rule.kind)) continue

      if (rule.kind === 'sit') {
        const count = clamp(Math.floor(Math.max(w, d) / 7), 1, 3)
        const seatY = clamp(Math.round(Math.min(5, h * 0.5)), 0, h)
        const alongX = w >= d
        for (let i = 0; i < count; i++) {
          const frac = (i + 0.5) / count
          const pos = alongX ? [w * frac, seatY, d * 0.5] : [w * 0.5, seatY, d * frac]
          candidates.push({ kind: 'sit', pos, yaw: 0, tags: ['label', rule.tag], capacity: 1 })
        }
      } else if (rule.kind === 'shelter') {
        candidates.push({ kind: 'shelter', pos: [w * 0.5, 0, d * 0.5], yaw: 0, tags: ['label', rule.tag], capacity: 2 })
      } else if (rule.kind === 'browse') {
        candidates.push({ kind: 'browse', pos: [w * 0.5, 0, 0], yaw: Math.PI, tags: ['label', rule.tag], capacity: 2 })
      } else if (rule.kind === 'cover') {
        candidates.push({ kind: 'cover', pos: [w * 0.5, 0, 0], yaw: Math.PI, tags: ['label', rule.tag], capacity: 1 })
        if (w >= 16) {
          candidates.push({ kind: 'cover', pos: [w * 0.25, 0, 0], yaw: Math.PI, tags: ['label', rule.tag], capacity: 1 })
          candidates.push({ kind: 'cover', pos: [w * 0.75, 0, 0], yaw: Math.PI, tags: ['label', rule.tag], capacity: 1 })
        }
      } else if (rule.kind === 'spectacle') {
        candidates.push({ kind: 'spectacle', pos: [w * 0.5, 0, 0], yaw: Math.PI, tags: ['label', rule.tag], capacity: 2 })
      } else if (rule.kind === 'queue') {
        candidates.push({ kind: 'queue', pos: [w * 0.5, 0, 0], yaw: Math.PI, tags: ['label', rule.tag], capacity: 1 })
      }
      existingKinds.add(rule.kind)
    }
  }

  // 3. Fallback: every player-made thing is at least a mild spectacle so NPCs can notice new creations.
  if (candidates.length === 0) {
    candidates.push({ kind: 'spectacle', pos: [w * 0.5, 0, 0], yaw: Math.PI, tags: ['fallback', 'made'], capacity: 1 })
    inferredBy.push('fallback')
  }

  // Deduplicate slots of the same kind that are within 3 cells of each other.
  const deduped = []
  for (const s of candidates) {
    const dup = deduped.some((o) =>
      o.kind === s.kind &&
      Math.hypot(o.pos[0] - s.pos[0], o.pos[1] - s.pos[1], o.pos[2] - s.pos[2]) < 3
    )
    if (!dup) deduped.push(s)
  }

  const checked = validateAffordances(deduped, [w, h, d])
  return { slots: checked.slots, inferredBy: [...new Set(inferredBy)] }
}
