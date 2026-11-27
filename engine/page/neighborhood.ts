// Systemic San Francisco neighborhood character & life engine (#93):
// Streams compiled open-data storefronts (with configurable GTA-style parody branding from sf/brands.json)
// and neighborhood town squares / civic plazas (from sf/plazas.json + OSM + DataSF) around the eye:
//   - Crisp fascia signboards, double-sided projecting blade signs & plaza entrance plaques (`storefront-signs.ts`)
//   - Instanced 3D voxel street furniture & plaza kits (`neighborhood-props.ts` -> `pieces.ts`)
//   - Living gathering crowds sitting on benches/patios, chatting in squares, and browsing shops (`folk.from`)
import type { Target } from '../probe/gpu.ts'
import type { View } from './march.ts'
import { NAMED } from './moves.ts'
import { neighborhoodPropKit, type PropAsset, type PropKit } from './neighborhood-props.ts'
import type { Person } from './people.ts'
import type { Piece, Pieces } from './pieces.ts'
import type { Shock } from './residents.ts'
import { createStorefrontSigns, type SignSpec, type SignStyle, type StorefrontSigns } from './storefront-signs.ts'

const M = 10 // 10 world cells per metre
const GRID_CELL = 100 // 100 m spatial index bucket
const SHOP_RADIUS = 115 // m: storefront signs & sidewalk props
const PLAZA_RADIUS = 195 // m: town squares, pavilions, benches, market stalls & gathering crowds
const SIGN_MAX = 64

export interface RawShop {
  n: string
  c: string
  t: string
  x: number
  z: number
  nx: number
  nz: number
  w: number
  sw: number
  h: number
  s: number
  p: string
  bl: number
  br?: string
  po?: number
  out?: number
}

export interface PlazaConfig {
  pav: number
  arch: number
  lit: number
  deck: number
  stalls: number
  tables: number
  planters: number
  bollards: number
  lib: number
  fnt: number
  crowd: number
  perf: number
  acc: string
  bg: string
  ink: string
}

export interface RawPlaza {
  id: string
  n: string
  label: string
  sub: string
  t: string
  x: number
  z: number
  ex: number
  ez: number
  nx: number
  nz: number
  lu: number
  lv: number
  a: number
  p: [number, number][]
  k?: [number, number, number][]
  bn?: [number, number][]
  bk?: [number, number][]
  fn?: [number, number][]
  wt?: [number, number][]
  mk?: number
  cfg: PlazaConfig
  hero?: number
}

export interface PlacesPayload {
  version: number
  frame: string
  credits?: string
  styles: [string, string, string, string, SignStyle['font'], number][]
  shops: RawShop[]
  plazas: RawPlaza[]
}

export interface NeighborhoodLand {
  ground_at(x: number, z: number): number
  feet_at(x: number, z: number): number
  top_at(x: number, z: number): number
  world_kind(x: number, y: number, z: number): number
}

export interface NeighborhoodOptions {
  device: GPUDevice
  format: GPUTextureFormat
  pieces: Pieces
  land: NeighborhoodLand
  hour: () => number
  rain: () => number
  clock: () => number
  shocks: readonly Shock[]
  load: () => Promise<ArrayBuffer | null>
}

export interface Neighborhood {
  enabled: boolean
  readonly ready: boolean
  readonly stats: {
    totalShops: number
    totalPlazas: number
    parodyShops: number
    activeShops: number
    activePlazas: number
    activeSigns: number
    activeProps: number
    activePeople: number
  }
  /** Call once per frame from main loop to stream nearby storefronts & plazas around the eye. */
  frame(view: View): void
  /** Single-draw-call instanced storefront & plaza signage pass. */
  drawSigns(
    encoder: GPUCommandEncoder,
    to: Target,
    view: View,
    sun: readonly [number, number, number],
    day: number,
    dull: number,
    faced?: GPUTextureView | null,
  ): void
  /** Provider function to push into `folk.from` for seated & gathering neighborhood crowds. */
  folk(view: View, seconds: number): readonly Person[]
  /** Query loaded storefronts & plazas near (xM, zM) in world metres (for inspection & tests). */
  near(xM: number, zM: number, radiusM?: number): {
    shops: { name: string; category: string; brandId: string | null; parody: boolean; distM: number; x: number; z: number }[]
    plazas: { name: string; id: string; archetype: string; distM: number; benches: number; x: number; z: number }[]
  }
  visibleSigns(): { id: string; title: string; kind: SignSpec['kind']; category: string }[]
  inspect(): {
    plazas: { id: string; name: string; groundM: number; propMinYM: number; propMaxYM: number; signCount: number; roadPropHits: number }[]
    shops: { name: string; brandId: string | null; groundM: number; signYM: number; outOffsetM: number; clearedAwning: boolean; roadPropHits: number }[]
  }
  reset(): void
}

// Deterministic hash [0, 1)
function hashStr(s: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function hash01(seed: number, salt: number): number {
  let x = (seed ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0
  x ^= x >>> 16
  x = Math.imul(x, 0x85ebca6b) >>> 0
  x ^= x >>> 13
  x = Math.imul(x, 0xc2b2ae35) >>> 0
  x ^= x >>> 16
  return (x >>> 0) / 4294967296
}

function yawQuat(yaw: number): [number, number, number, number] {
  return [0, Math.sin(yaw * 0.5), 0, Math.cos(yaw * 0.5)]
}

function pointInPoly(x: number, z: number, ring: readonly [number, number][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], zi = ring[i][1]
    const xj = ring[j][0], zj = ring[j][1]
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi || 1e-9) + xi) inside = !inside
  }
  return inside
}

function distToPolyEdge(x: number, z: number, ring: readonly [number, number][]): number {
  let best = Infinity
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length]
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz
    const t = l2 < 1e-6 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2))
    const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t))
    if (d < best) best = d
  }
  return best
}

interface CrowdSpot {
  x: number // world cells
  y: number // world cells
  z: number // world cells
  yaw: number
  seed: number
  role: 'sit' | 'chat' | 'browse' | 'perform' | 'listen'
  /** Minimum crowd activity level [0..1] needed for this spot to be occupied. */
  threshold: number
  /** Only active during daytime/market hours when true. */
  dayOnly?: boolean
}

interface BuiltPlaza {
  plaza: RawPlaza
  pieces: Piece[]
  signs: SignSpec[]
  crowd: CrowdSpot[]
  marketPieces: Piece[]
  sig: number
  groundM: number
}

interface BuiltShop {
  shop: RawShop
  pieces: Piece[]
  signs: SignSpec[]
  crowd: CrowdSpot[]
  sig: number
  groundM: number
  signYM: number
  outOffsetM: number
  clearedAwning: boolean
}

export async function createNeighborhood(o: NeighborhoodOptions): Promise<Neighborhood> {
  const signsPass: StorefrontSigns = await createStorefrontSigns(o.device, o.format)
  let kit: PropKit | null = null
  const getKit = () => (kit ??= neighborhoodPropKit())

  let enabled = true
  let ready = false
  let loading = false
  let payload: PlacesPayload | null = null
  let styles: SignStyle[] = []
  let parodyTotal = 0

  const shopGrid = new Map<string, RawShop[]>()
  const plazaGrid = new Map<string, RawPlaza[]>()
  const activeShops = new Map<string, BuiltShop>()
  const activePlazas = new Map<string, BuiltPlaza>()
  let activeSignSpecs: SignSpec[] = []
  let activePeopleCount = 0

  let lastSyncX = -1e9, lastSyncZ = -1e9
  let lastMarketOn = false
  let lastRefreshMs = 0

  const bucketKey = (gx: number, gz: number) => `${gx},${gz}`
  const shopKey = (s: RawShop) => `${s.x},${s.z},${s.n}`

  const loadOnce = () => {
    if (loading || ready) return
    loading = true
    void o.load().then((buf) => {
      loading = false
      if (!buf) return
      try {
        const parsed = JSON.parse(new TextDecoder().decode(buf)) as PlacesPayload
        if (!parsed || !Array.isArray(parsed.shops) || !Array.isArray(parsed.plazas)) return
        payload = parsed
        styles = (parsed.styles ?? []).map(([bg, ink, accent, trim, font, glow]) => ({
          bg, ink, accent, trim, font: font || 'clean', glow: glow === 1,
        }))
        parodyTotal = 0
        shopGrid.clear()
        for (const s of parsed.shops) {
          if (s.po) parodyTotal++
          const k = bucketKey(Math.floor(s.x / GRID_CELL), Math.floor(s.z / GRID_CELL))
          let arr = shopGrid.get(k)
          if (!arr) shopGrid.set(k, (arr = []))
          arr.push(s)
        }
        plazaGrid.clear()
        for (const p of parsed.plazas) {
          const k = bucketKey(Math.floor(p.x / GRID_CELL), Math.floor(p.z / GRID_CELL))
          let arr = plazaGrid.get(k)
          if (!arr) plazaGrid.set(k, (arr = []))
          arr.push(p)
        }
        ready = true
        lastSyncX = -1e9
      } catch (e) {
        console.warn('neighborhood places parse failed:', e)
      }
    }).catch(() => { loading = false })
  }

  /** Safe ground elevation in world cells (returns null if chunk terrain isn't loaded yet). */
  const groundCells = (xM: number, zM: number): number | null => {
    const cx = Math.round(xM * M), cz = Math.round(zM * M)
    const g = o.land.ground_at(cx, cz)
    if (!Number.isFinite(g) || g <= -200 || g > 5000) return null
    // Unloaded tiles return ground=0 with top_at=0 (air): wait for terrain tiles to arrive instead of burying props at y=0!
    if (g === 0 && (o.land.top_at(cx, cz) & 15) === 0) return null
    return g
  }

  /** Lightweight terrain/L0 signature so shops & plazas immediately re-seat when L0 tiles stream in. */
  const shopSig = (s: RawShop): number | null => {
    const gWall = groundCells(s.x, s.z)
    if (gWall === null) return null
    const fx = Math.round((s.x + s.nx * 0.9) * M), fz = Math.round((s.z + s.nz * 0.9) * M)
    const gFront = groundCells(s.x + s.nx * 0.9, s.z + s.nz * 0.9) ?? gWall
    const topF = o.land.top_at(fx, fz) & 15
    const gRef = Math.max(gWall, gFront)
    // Sample facade/awning presence at 0.5m and 0.9m out at 3.2m height to detect when L0 building detail arrives.
    const k1 = o.land.world_kind(Math.round((s.x + s.nx * 0.5) * M), gRef + 32, Math.round((s.z + s.nz * 0.5) * M)) & 15
    const k2 = o.land.world_kind(Math.round((s.x + s.nx * 0.9) * M), gRef + 32, Math.round((s.z + s.nz * 0.9) * M)) & 15
    return ((gWall >> 1) * 73856093) ^ ((gFront >> 1) * 19349663) ^ (topF << 4) ^ (k1 << 8) ^ (k2 << 12)
  }

  const plazaSig = (p: RawPlaza): number | null => {
    const gC = groundCells(p.x, p.z)
    if (gC === null) return null
    const gE = groundCells(p.ex, p.ez) ?? gC
    const topC = o.land.top_at(Math.round(p.x * M), Math.round(p.z * M)) & 15
    const topE = o.land.top_at(Math.round(p.ex * M), Math.round(p.ez * M)) & 15
    return ((gC >> 1) * 73856093) ^ ((gE >> 1) * 19349663) ^ (topC << 4) ^ (topE << 8)
  }

  /** True if (xM, zM) sits on asphalt carriageway (material 6) or water (material 5) or has a solid wall/shrub overhead. */
  const isRoadOrBlocked = (xM: number, zM: number, checkWall = true, blockFoliage = false): boolean => {
    const cx = Math.round(xM * M), cz = Math.round(zM * M)
    const topMat = o.land.top_at(cx, cz) & 15
    if (topMat === 6 || topMat === 5) return true
    if (blockFoliage && topMat === 13) return true
    if (!checkWall) return false
    const g = o.land.ground_at(cx, cz)
    // Check ankle-to-head clearance (0.3 m .. 2.2 m above ground) for existing solid structures (and optionally foliage 13)
    const heights = blockFoliage ? [3, 8, 14, 22] : [6, 14, 22]
    for (const dy of heights) {
      const k = o.land.world_kind(cx, g + dy, cz) & 15
      if (k !== 0 && (blockFoliage || k !== 13)) return true
    }
    return false
  }

  /** Place a shared voxel PropAsset at world metres (xM, zM) resting on ground (or deckOffsetM above ground) turned by yaw radians. */
  const spawnProp = (asset: PropAsset, xM: number, zM: number, yaw: number, deckOffsetM = 0): Piece | null => {
    const g = groundCells(xM, zM)
    if (g === null) return null
    const piece = o.pieces.add(asset.born, true)
    piece.cell = asset.cell
    piece.pos = [xM * M, g + deckOffsetM * M, zM * M]
    piece.rot = yawQuat(yaw)
    return piece
  }

  /** Build signs, sidewalk props, and patrons for one storefront. */
  const buildShop = (s: RawShop): BuiltShop | null => {
    const sig = shopSig(s)
    if (sig === null) return null
    const gWall = groundCells(s.x, s.z)
    if (gWall === null) return null
    const kkit = getKit()
    const st: SignStyle = styles[s.s] ?? { bg: '#24303c', ink: '#f8f2e4', accent: '#e09c48', trim: '#141b22', font: 'clean', glow: false }
    const seed = hashStr(`${s.n}@${s.x},${s.z}`)
    const pieces: Piece[] = []
    const signs: SignSpec[] = []
    const crowd: CrowdSpot[] = []

    // Standing on sidewalk looking at wall (viewDir = -normal): viewer's right = cross(-normal, up) = (nz, 0, -nx).
    const rx = s.nz
    const rz = -s.nx
    const faceYaw = Math.atan2(s.nx, s.nz)

    // Probe sidewalk ground just 0.9 m in front of the wall so fascia height aligns cleanly with ground-floor shopfront!
    const gFront = groundCells(s.x + s.nx * 0.9, s.z + s.nz * 0.9) ?? gWall
    const groundM = Math.max(gWall, gFront) / M

    // Only real flagship supermarkets (branded chains or wide buildings >= 14m) get oversized anchor fascias.
    const isAnchor = s.c === 'supermarket' && (!!s.br || s.w >= 14)
    const bldgH = Math.max(4.0, s.h || 8.0)
    const signH = isAnchor ? 1.05 : 0.78
    const signW = Math.max(2.1, Math.min(isAnchor ? 6.2 : 4.4, s.w * 0.68))

    // Probe voxel wall protrusion at (uOff, yM) along outward normal up to 1.5 m (skipping leaves 13).
    const wallExtentAt = (uOff: number, yM: number): number => {
      let maxOut = 0
      const py = Math.round(yM * M)
      for (let step = 0.2; step <= 1.5; step += 0.15) {
        const px = Math.round((s.x + rx * uOff + s.nx * step) * M)
        const pz = Math.round((s.z + rz * uOff + s.nz * step) * M)
        const kind = o.land.world_kind(px, py, pz) & 15
        if (kind !== 0 && kind !== 13) maxOut = step
      }
      return maxOut
    }

    const uSamples = [-signW * 0.34, 0, signW * 0.34]
    const extentAcross = (yM: number): number => {
      let best = 0
      for (const u of uSamples) best = Math.max(best, wallExtentAt(u, yM))
      return best
    }

    // Measure base wall surface above awning band (4.5..5.1 m) and scan ground-floor retail awning band (2.3..4.2 m).
    let upperWallOut = 0.15
    for (let dy = 4.4; dy <= Math.min(bldgH - 0.5, 5.2); dy += 0.3) {
      upperWallOut = Math.max(upperWallOut, extentAcross(groundM + dy))
    }
    let awningTopM = 0
    let awningOutM = 0
    for (let dy = 2.3; dy <= Math.min(bldgH - 0.5, 4.2); dy += 0.2) {
      const ext = extentAcross(groundM + dy)
      if (ext > upperWallOut + 0.22) {
        awningTopM = groundM + dy
        awningOutM = Math.max(awningOutM, ext)
      }
    }

    let signCenterY = Math.min(groundM + bldgH - signH * 0.65 - 0.3, groundM + (isAnchor ? 3.95 : 3.35))
    let outOffsetM = 0.24
    let clearedAwning = false
    if (awningTopM > 0) {
      clearedAwning = true
      const aboveY = awningTopM + signH * 0.5 + 0.24
      if (aboveY + signH * 0.5 + 0.15 <= groundM + bldgH) {
        // Mount fascia cleanly ABOVE the projecting retail awning so it's never sliced in half!
        signCenterY = aboveY
      } else {
        // Low 1-story storefront: mount fascia cleanly proud of the awning valance front face!
        signCenterY = Math.min(groundM + bldgH - signH * 0.55 - 0.1, Math.max(groundM + 2.65, awningTopM - 0.10))
        outOffsetM = Math.max(outOffsetM, awningOutM + 0.18)
      }
    }
    // Guarantee zero voxel clipping across the entire width and top/mid/bottom of the sign panel!
    for (const dy of [-signH * 0.42, 0, signH * 0.42]) {
      const ext = extentAcross(signCenterY + dy)
      if (ext > 0) outOffsetM = Math.max(outOffsetM, ext + 0.18)
    }
    outOffsetM = Math.min(outOffsetM, 1.55)

    signs.push({
      id: `f:${s.x}:${s.z}:${s.n}`,
      title: s.n,
      subtitle: s.t || undefined,
      category: s.c,
      kind: 'fascia',
      at: [(s.x + s.nx * outOffsetM) * M, signCenterY * M, (s.z + s.nz * outOffsetM) * M],
      hu: [rx * signW * 0.5 * M, 0, rz * signW * 0.5 * M],
      hv: [0, signH * 0.5 * M, 0],
      normal: [s.nx, 0, s.nz],
      both: false,
      style: st,
    })

    // Projecting perpendicular double-sided blade sign (for eateries, cafés, bookshops, florists, bars, corner stores)
    if (s.bl && s.sw >= 1.5 && s.w >= 3.2) {
      const sideSign = hash01(seed, 3) < 0.5 ? 1 : -1
      const shiftAlong = Math.min(s.w * 0.34, signW * 0.45 + 0.35) * sideSign
      const bxWall = s.x + rx * shiftAlong
      const bzWall = s.z + rz * shiftAlong
      const bladeY = awningTopM > 0 && signCenterY > awningTopM ? Math.min(signCenterY, awningTopM + 0.48) : Math.min(signCenterY - 0.12, groundM + 3.0)
      const bladeW = 0.92
      const bladeH = 0.48
      // Bracket mounted flush at wall, projecting outward along (nx, nz)
      const bracket = o.pieces.add(kkit.bladeBracket.born, true)
      bracket.cell = kkit.bladeBracket.cell
      bracket.pos = [(bxWall + s.nx * (outOffsetM - 0.10)) * M, (bladeY + bladeH * 0.5 + 0.08) * M, (bzWall + s.nz * (outOffsetM - 0.10)) * M]
      // bladeBracket extends along +X; rotate +X to (nx, nz) via yaw = atan2(-nz, nx)
      bracket.rot = yawQuat(Math.atan2(-s.nz, s.nx))
      pieces.push(bracket)

      const bMidOut = outOffsetM + 0.48
      signs.push({
        id: `b:${s.x}:${s.z}:${s.n}`,
        title: s.n,
        category: s.c,
        kind: 'blade',
        at: [(bxWall + s.nx * bMidOut) * M, bladeY * M, (bzWall + s.nz * bMidOut) * M],
        hu: [s.nx * bladeW * 0.5 * M, 0, s.nz * bladeW * 0.5 * M],
        hv: [0, bladeH * 0.5 * M, 0],
        normal: [rx, 0, rz],
        both: true,
        style: st,
      })
    }

    // Sidewalk character props & patrons (strictly clear of asphalt road & existing walls!)
    const sw = s.sw
    const propType = s.p
    const propBaseOut = Math.min(0.65, outOffsetM)
    if (propType && propType !== 'none' && sw >= 1.6) {
      if ((propType === 'cafe' || propType === 'patio') && sw >= 2.2) {
        // Place 1–2 café patio umbrella tables cleanly on the sidewalk!
        const nTables = sw >= 2.8 && s.w >= 5.2 ? 2 : 1
        const offsets = nTables === 2 ? [-1.25, 1.25] : [0]
        const colorIdx = s.c === 'coffee' ? 0 : Math.floor(hash01(seed, 11) * kkit.cafePatios.length)
        const patioAsset = kkit.cafePatios[colorIdx % kkit.cafePatios.length]
        const outD = Math.min(sw - 0.95, Math.max(1.30, propBaseOut + 1.05))
        for (let ti = 0; ti < offsets.length; ti++) {
          const px = s.x + s.nx * outD + rx * offsets[ti]
          const pz = s.z + s.nz * outD + rz * offsets[ti]
          if (isRoadOrBlocked(px, pz, true)) continue
          const piece = spawnProp(patioAsset, px, pz, faceYaw)
          if (!piece) continue
          pieces.push(piece)
          const gSeat = groundCells(px, pz)
          if (gSeat !== null) {
            // Two seated patrons facing the bistro table along +/- right axis
            for (const dir of [-1, 1]) {
              if (hash01(seed, 20 + ti * 3 + (dir > 0 ? 1 : 0)) > 0.78) continue
              const sx = px + rx * dir * 0.56
              const sz = pz + rz * dir * 0.56
              crowd.push({
                x: sx * M,
                y: gSeat,
                z: sz * M,
                yaw: Math.atan2(-rx * dir, -(-rz * dir)),
                seed: (seed + ti * 97 + (dir > 0 ? 13 : 41)) >>> 0,
                role: 'sit',
                threshold: 0.25 + ti * 0.2,
              })
            }
          }
        }
        // Plus an A-frame chalkboard menu beside the doorway if room
        if (s.w >= 4.0) {
          const ax = s.x + s.nx * (propBaseOut + 0.65) + rx * (nTables === 2 ? 0 : 1.35)
          const az = s.z + s.nz * (propBaseOut + 0.65) + rz * (nTables === 2 ? 0 : 1.35)
          if (!isRoadOrBlocked(ax, az, true)) {
            const p = spawnProp(kkit.aframe, ax, az, faceYaw + 0.25)
            if (p) pieces.push(p)
          }
        }
      } else if (propType === 'florist' || propType === 'books' || propType === 'grocery') {
        const asset = propType === 'florist' ? kkit.floristStand : propType === 'books' ? kkit.bookCart : kkit.groceryCrates
        const outD = Math.min(sw - 0.65, propBaseOut + 0.55)
        const px = s.x + s.nx * outD
        const pz = s.z + s.nz * outD
        if (!isRoadOrBlocked(px, pz, true)) {
          const piece = spawnProp(asset, px, pz, faceYaw)
          if (piece) {
            pieces.push(piece)
            // Occasional shopper browsing the florist stand / book cart / produce crates
            const bx = px + s.nx * 0.85
            const bz = pz + s.nz * 0.85
            const gB = groundCells(bx, bz)
            if (gB !== null && !isRoadOrBlocked(bx, bz, false)) {
              crowd.push({
                x: bx * M,
                y: gB,
                z: bz * M,
                yaw: Math.atan2(-s.nx, s.nz),
                seed: (seed + 313) >>> 0,
                role: 'browse',
                threshold: 0.35,
              })
            }
          }
        }
      } else if (propType === 'aframe' || propType === 'planter') {
        const asset = propType === 'aframe' ? kkit.aframe : kkit.planter
        const outD = Math.min(sw - 0.55, propBaseOut + 0.50)
        const shift = (hash01(seed, 7) < 0.5 ? -1 : 1) * Math.min(1.1, s.w * 0.25)
        const px = s.x + s.nx * outD + rx * shift
        const pz = s.z + s.nz * outD + rz * shift
        if (!isRoadOrBlocked(px, pz, true)) {
          const piece = spawnProp(asset, px, pz, faceYaw + (propType === 'aframe' ? 0.18 : 0))
          if (piece) pieces.push(piece)
        }
      }
    }

    return { shop: s, pieces, signs, crowd, sig, groundM, signYM: signCenterY, outOffsetM, clearedAwning }
  }

  /** Build civic architecture, real OSM benches/bookcases/fountains, market stalls & gathering crowd for one plaza/square. */
  const buildPlaza = (p: RawPlaza, marketOpen: boolean): BuiltPlaza | null => {
    const sig = plazaSig(p)
    if (sig === null) return null
    const gCenter = groundCells(p.x, p.z)
    if (gCenter === null) return null
    const kkit = getKit()
    const seed = hashStr(`plaza:${p.id}:${p.x},${p.z}`)
    const pieces: Piece[] = []
    const marketPieces: Piece[] = []
    const signs: SignSpec[] = []
    const crowd: CrowdSpot[] = []
    const cfg = p.cfg

    // Local plaza frame:
    //   outward (nx, nz) points from plaza toward main fronting street
    //   inward  (vx, vz) = (-nx, -nz) points into the square from the entrance
    //   right   (ux, uz) = (nz, -nx) runs along the street frontage
    const nx = p.nx, nz = p.nz
    const vx = -nx, vz = -nz
    const ux = nz, uz = -nx
    const faceStreetYaw = Math.atan2(nx, nz)
    const faceInwardYaw = Math.atan2(vx, vz)
    void faceInwardYaw
    const keepouts = p.k ?? []
    const placed: [number, number, number][] = [] // [xM, zM, radiusM] to prevent any prop overlap!

    const clearFor = (xM: number, zM: number, radM: number, requireInside = true, checkWorld = true, blockFoliage = false): boolean => {
      if (requireInside && !pointInPoly(xM, zM, p.p)) return false
      for (const [kx, kz, kr] of keepouts) {
        if (Math.hypot(xM - kx, zM - kz) < kr + radM) return false
      }
      for (const [ox, oz, orad] of placed) {
        if (Math.hypot(xM - ox, zM - oz) < orad + radM) return false
      }
      if (isRoadOrBlocked(xM, zM, checkWorld, blockFoliage)) return false
      if (blockFoliage && radM >= 0.9) {
        // Dense 0.6 m footprint scan so archways, pavilions & stalls never straddle narrow bushes or street curbs!
        const r = Math.min(radM, 1.8)
        for (let du = -r; du <= r + 0.01; du += 0.6) {
          for (let dv = -Math.min(r, 1.0); dv <= Math.min(r, 1.0) + 0.01; dv += 0.6) {
            if (isRoadOrBlocked(xM + ux * du + vx * dv, zM + uz * du + vz * dv, true, true)) return false
          }
        }
      }
      return true
    }

    const toWorld = (uOff: number, vOff: number): [number, number] => [
      p.ex + ux * uOff + vx * vOff,
      p.ez + uz * uOff + vz * vOff,
    ]

    // Measure safe interior span along u and v from entrance
    const spanU = Math.min(p.lu, 48)
    const spanV = Math.min(p.lv, 42)
    const deckElev = cfg.deck ? 0.12 : 0

    // 1. Warm Pale Granite Courtyard Paving Pads (replaces blank dark grey concrete YARD inside town_square / civic_plaza!)
    if (cfg.deck) {
      const step = 3.65
      for (let v = 2.6; v <= Math.min(spanV - 2.2, 26); v += step) {
        for (let u = -spanU * 0.42; u <= spanU * 0.42; u += step) {
          const [dx, dz] = toWorld(u, v)
          if (!pointInPoly(dx, dz, p.p) || distToPolyEdge(dx, dz, p.p) < 1.5) continue
          if (keepouts.some(([kx, kz, kr]) => Math.hypot(dx - kx, dz - kz) < kr + 1.8)) continue
          const g0 = groundCells(dx, dz)
          if (g0 === null) continue
          // Only lay flat paving slabs where ground isn't steep & isn't a building/road
          if (isRoadOrBlocked(dx, dz, true)) continue
          const g1 = groundCells(dx + ux * 1.6, dz + uz * 1.6) ?? g0
          const g2 = groundCells(dx + vx * 1.6, dz + vz * 1.6) ?? g0
          if (Math.abs(g1 - g0) > 6 || Math.abs(g2 - g0) > 6) continue
          const slab = spawnProp(kkit.deckPad, dx, dz, faceStreetYaw, 0)
          if (slab) pieces.push(slab)
        }
      }
    }

    // 2. Plaza Entrance Archway Portal + Crisp Front & Back Title Plaques (`NOE VALLEY TOWN SQUARE`, etc.)
    if (cfg.arch) {
      const archCandidates: [number, number][] = [
        [0, 1.8], [-2.8, 2.0], [2.8, 2.0], [0, 3.8], [-3.8, 3.6], [3.8, 3.6],
        [-4.5, 5.8], [4.5, 5.8], [0, 6.2], [-2.4, 2.0], [2.4, 2.0], [0, 1.4],
      ]
      let placedArch: [number, number] | null = null
      for (const strictFoliage of [true, false]) {
        for (const [uTry, vTry] of archCandidates) {
          const [ax, az] = toWorld(uTry, vTry)
          if (!clearFor(ax, az, 1.75, true, true, strictFoliage)) continue
          placedArch = [ax, az]
          break
        }
        if (placedArch) break
      }
      if (placedArch) {
        const [ax, az] = placedArch
        const gArch = groundCells(ax, az)
        if (gArch !== null) {
          const archPiece = spawnProp(kkit.archway, ax, az, faceStreetYaw, 0)
          if (archPiece) {
            pieces.push(archPiece)
            placed.push([ax, az, 1.7])
            // Mount TWO outward-facing title plaques cleanly proud of the slim ±0.12 m archway header (±0.20 m along ±normal!)
            const plaqueW = 3.38, plaqueH = 0.70, plaqueOut = 0.20
            const plaqueStyle: SignStyle = {
              bg: cfg.bg,
              ink: cfg.ink,
              accent: cfg.acc,
              trim: '#171310',
              font: 'serif',
              glow: true,
            }
            // Street-facing front plaque
            signs.push({
              id: `plaza:${p.id}:f`,
              title: p.n,
              subtitle: p.sub,
              category: 'plaza',
              kind: 'plaza',
              at: [(ax + nx * plaqueOut) * M, gArch + 2.98 * M, (az + nz * plaqueOut) * M],
              hu: [ux * plaqueW * 0.5 * M, 0, uz * plaqueW * 0.5 * M],
              hv: [0, plaqueH * 0.5 * M, 0],
              normal: [nx, 0, nz],
              both: false,
              style: plaqueStyle,
            })
            // Courtyard-facing back plaque (reads left-to-right from inside the plaza!)
            signs.push({
              id: `plaza:${p.id}:b`,
              title: p.n,
              subtitle: p.sub,
              category: 'plaza',
              kind: 'plaza',
              at: [(ax - nx * plaqueOut) * M, gArch + 2.98 * M, (az - nz * plaqueOut) * M],
              hu: [-ux * plaqueW * 0.5 * M, 0, -uz * plaqueW * 0.5 * M],
              hv: [0, plaqueH * 0.5 * M, 0],
              normal: [-nx, 0, -nz],
              both: false,
              style: plaqueStyle,
            })
          }
        }
      }
    }

    // 3. Perimeter Sidewalk Bollards along street frontage (classic Noe Valley Town Square look!)
    if (cfg.bollards) {
      for (let u = -spanU * 0.42; u <= spanU * 0.42; u += 2.2) {
        if (Math.abs(u) < 2.2) continue // leave wide open entrance portal
        const [bx, bz] = toWorld(u, 0.9)
        if (!clearFor(bx, bz, 0.45, true, true, true)) continue
        const bol = spawnProp(kkit.bollard, bx, bz, faceStreetYaw, 0)
        if (bol) {
          pieces.push(bol)
          placed.push([bx, bz, 0.45])
        }
      }
    }

    // 4. Timber Stage & Pergola Pavilion (hero community focal point!)
    let stagePos: [number, number] | null = null
    if (cfg.pav && p.a >= 350) {
      const candidates: [number, number][] = [
        [0, Math.min(spanV * 0.62, 16.5)],
        [spanU * 0.16, Math.min(spanV * 0.58, 15.0)],
        [-spanU * 0.16, Math.min(spanV * 0.58, 15.0)],
        [0, Math.min(spanV * 0.48, 11.5)],
      ]
      for (const strictFoliage of [true, false]) {
        for (const [uTry, vTry] of candidates) {
          const [px, pz] = toWorld(uTry, vTry)
          if (!clearFor(px, pz, 2.8, true, true, strictFoliage)) continue
          const pav = spawnProp(kkit.pavilion, px, pz, faceStreetYaw, 0)
          if (!pav) continue
          pieces.push(pav)
          placed.push([px, pz, 3.0])
          stagePos = [px, pz]
          // Performer standing on the raised timber stage during daytime/evening
          if (cfg.perf) {
            const gSt = groundCells(px, pz)
            if (gSt !== null) {
              crowd.push({
                x: px * M,
                y: gSt + 4.2, // stands atop the 0.42 m stage deck!
                z: pz * M,
                yaw: Math.atan2(nx, -nz),
                seed: (seed + 777) >>> 0,
                role: 'perform',
                threshold: 0.35,
                dayOnly: true,
              })
            }
          }
          break
        }
        if (stagePos) break
      }
    }

    // 5. Overhead Festoon Bistro String-Light Spans across the open courtyard (strictly clear of asphalt roads!)
    if (cfg.lit && p.a >= 250) {
      const spanRows = spanV > 16 ? [5.8, 11.8] : [6.2]
      for (const vRow of spanRows) {
        for (const uTry of [0, -4.5, 4.5]) {
          const [fx, fz] = toWorld(uTry, vRow)
          if (!pointInPoly(fx, fz, p.p)) continue
          if (keepouts.some(([kx, kz, kr]) => Math.hypot(fx - kx, fz - kz) < kr + 1.2)) continue
          // Ensure center AND both steel pole bases (±2.7 m along u) stay completely off asphalt carriageways & walls!
          const poleA = toWorld(uTry - 2.7, vRow)
          const poleB = toWorld(uTry + 2.7, vRow)
          if (isRoadOrBlocked(fx, fz, false) || isRoadOrBlocked(poleA[0], poleA[1], true) || isRoadOrBlocked(poleB[0], poleB[1], true)) continue
          if (!pointInPoly(poleA[0], poleA[1], p.p) || !pointInPoly(poleB[0], poleB[1], p.p)) continue
          const f = spawnProp(kkit.festoon, fx, fz, faceStreetYaw, 0)
          if (f) {
            pieces.push(f)
            break
          }
        }
      }
    }

    // 6. Real OSM Benches (exact real-world coordinates from OpenStreetMap!) + fallback courtyard benches
    const benchCoords: [number, number][] = [...(p.bn ?? [])]
    if (benchCoords.length < 4) {
      // Arrange welcoming courtyard benches facing inward along plaza sides
      const want = Math.min(8, Math.max(4, Math.round(Math.sqrt(p.a) / 5)))
      for (let i = 0; i < want; i++) {
        const side = i % 2 === 0 ? -1 : 1
        const row = Math.floor(i / 2)
        const uOff = side * Math.min(spanU * 0.34, 6.2 + (row % 2) * 1.4)
        const vOff = 4.0 + row * 3.8
        if (vOff > spanV - 2.5) continue
        benchCoords.push(toWorld(uOff, vOff))
      }
    }
    let benchIdx = 0
    for (const [bx, bz] of benchCoords.slice(0, 14)) {
      if (!clearFor(bx, bz, 1.0, false, true)) continue
      // Orient bench to face the center of the plaza (or stage!)
      const targetX = stagePos ? stagePos[0] : p.x
      const targetZ = stagePos ? stagePos[1] : p.z
      const toCx = targetX - bx, toCz = targetZ - bz
      const bYaw = Math.hypot(toCx, toCz) > 1.5 ? Math.atan2(toCx, toCz) : faceStreetYaw
      const bPiece = spawnProp(kkit.bench, bx, bz, bYaw, deckElev * 0.4)
      if (!bPiece) continue
      pieces.push(bPiece)
      placed.push([bx, bz, 1.05])
      const gB = groundCells(bx, bz)
      if (gB !== null) {
        // Place 1–2 seated neighbors on this bench!
        const benchRightX = Math.cos(bYaw), benchRightZ = -Math.sin(bYaw)
        const benchFwdX = Math.sin(bYaw), benchFwdZ = Math.cos(bYaw)
        const seats = hash01(seed, 100 + benchIdx) < 0.65 ? [-0.42, 0.42] : [0]
        seats.forEach((so, si) => {
          const sx = bx + benchRightX * so + benchFwdX * 0.10
          const sz = bz + benchRightZ * so + benchFwdZ * 0.10
          crowd.push({
            x: sx * M,
            y: gB + deckElev * 0.4 * M,
            z: sz * M,
            yaw: Math.atan2(benchFwdX, -benchFwdZ),
            seed: (seed + benchIdx * 131 + si * 37) >>> 0,
            role: 'sit',
            threshold: 0.12 + (benchIdx % 5) * 0.15,
          })
        })
      }
      benchIdx++
    }

    // 7. Real OSM Little Free Libraries (or 1 by the entrance for town squares / pocket parks)
    const libCoords: [number, number][] = [...(p.bk ?? [])]
    if (!libCoords.length && cfg.lib) libCoords.push(toWorld(-Math.min(spanU * 0.34, 4.2), 2.5))
    for (const [lx, lz] of libCoords.slice(0, 2)) {
      if (!clearFor(lx, lz, 0.6, false, true)) continue
      const lib = spawnProp(kkit.littleLibrary, lx, lz, faceStreetYaw, 0)
      if (lib) {
        pieces.push(lib)
        placed.push([lx, lz, 0.65])
      }
    }

    // 8. Real OSM Fountains & Drinking Water Fountains
    for (const [fx, fz] of (p.fn ?? []).slice(0, 2)) {
      if (!clearFor(fx, fz, 1.2, false, true)) continue
      const f = spawnProp(kkit.fountain, fx, fz, 0, 0)
      if (f) { pieces.push(f); placed.push([fx, fz, 1.3]) }
    }
    if (!(p.fn?.length) && cfg.fnt && p.a >= 500) {
      const [fx, fz] = toWorld(0, Math.min(spanV * 0.38, 9.5))
      if (clearFor(fx, fz, 1.3, true, true)) {
        const f = spawnProp(kkit.fountain, fx, fz, 0, 0)
        if (f) { pieces.push(f); placed.push([fx, fz, 1.4]) }
      }
    }
    for (const [wx, wz] of (p.wt ?? []).slice(0, 3)) {
      if (!clearFor(wx, wz, 0.5, false, true)) continue
      const wf = spawnProp(kkit.waterFountain, wx, wz, 0, 0)
      if (wf) { pieces.push(wf); placed.push([wx, wz, 0.55]) }
    }

    // 9. Farmers Market Canopy Stalls (active daytime 07:00–18:30!)
    if (marketOpen && cfg.stalls > 0 && p.a >= 350) {
      let placedStalls = 0
      const side = hash01(seed, 55) < 0.5 ? -1 : 1
      for (let i = 0; i < cfg.stalls && placedStalls < cfg.stalls; i++) {
        const uOff = side * Math.min(spanU * 0.30, 4.8 + (i % 2) * 0.6)
        const vOff = 4.6 + i * 4.0
        if (vOff > spanV - 2.6) break
        const [mx, mz] = toWorld(uOff, vOff)
        if (!clearFor(mx, mz, 1.75, true, true, true)) continue
        const stallYaw = side > 0 ? faceStreetYaw - Math.PI * 0.5 : faceStreetYaw + Math.PI * 0.5
        const stallAsset = kkit.marketStalls[(seed + i) % kkit.marketStalls.length]
        const stPiece = spawnProp(stallAsset, mx, mz, stallYaw, deckElev * 0.3)
        if (!stPiece) continue
        marketPieces.push(stPiece)
        placed.push([mx, mz, 1.85])
        placedStalls++
        // Vendor & browser standing by the stall
        const gM = groundCells(mx, mz)
        if (gM !== null) {
          const sx = mx - ux * side * 1.45
          const sz = mz - uz * side * 1.45
          crowd.push({
            x: sx * M,
            y: gM + deckElev * M,
            z: sz * M,
            yaw: Math.atan2(ux * side, -(uz * side)),
            seed: (seed + 501 + i * 43) >>> 0,
            role: 'browse',
            threshold: 0.2,
            dayOnly: true,
          })
        }
      }
    }

    // 10. Redwood Picnic Tables + Seated Friends
    for (let i = 0; i < cfg.tables; i++) {
      const side = i % 2 === 0 ? 1 : -1
      const uOff = side * Math.min(spanU * 0.22, 3.0 + (i % 2) * 1.8)
      const vOff = 5.4 + Math.floor(i / 2) * 4.4
      if (vOff > spanV - 2.8) break
      const [tx, tz] = toWorld(uOff, vOff)
      if (!clearFor(tx, tz, 1.35, true, true, true)) continue
      const tPiece = spawnProp(kkit.picnicTable, tx, tz, faceStreetYaw, deckElev * 0.4)
      if (!tPiece) continue
      pieces.push(tPiece)
      placed.push([tx, tz, 1.45])
      const gT = groundCells(tx, tz)
      if (gT !== null) {
        // Seated diners on both sides of the picnic table facing each other!
        for (const rowSide of [-1, 1]) {
          const px = tx + vx * rowSide * 0.58 + ux * (rowSide * 0.3)
          const pz = tz + vz * rowSide * 0.58 + uz * (rowSide * 0.3)
          crowd.push({
            x: px * M,
            y: gT + deckElev * 0.4 * M,
            z: pz * M,
            yaw: Math.atan2(-vx * rowSide, -(-vz * rowSide)),
            seed: (seed + 820 + i * 59 + (rowSide > 0 ? 7 : 19)) >>> 0,
            role: 'sit',
            threshold: 0.22 + i * 0.14,
          })
        }
      }
    }

    // 11. Corten-Steel Planter Boxes framing courtyard edges & corners
    const nPlanters = Math.min(12, cfg.planters)
    for (let i = 0; i < nPlanters; i++) {
      const t = (i + 0.5) / nPlanters
      const side = i % 2 === 0 ? -1 : 1
      const uOff = side * Math.min(spanU * 0.42, 4.5 + (i % 3) * 2.2)
      const vOff = 2.4 + t * Math.min(spanV - 4.0, 20.0)
      const [px, pz] = toWorld(uOff, vOff)
      if (!clearFor(px, pz, 0.85, true, true)) continue
      const pl = spawnProp(kkit.planter, px, pz, faceStreetYaw + (i % 2 === 0 ? Math.PI * 0.5 : -Math.PI * 0.5), 0)
      if (pl) {
        pieces.push(pl)
        placed.push([px, pz, 0.90])
      }
    }

    // 12. Gathering Neighborhood Chatting Circles (standing friends, coffee chats, listeners in front of the stage!)
    const wantStanding = Math.max(4, cfg.crowd - crowd.length)
    let made = 0
    for (let group = 0; group < 8 && made < wantStanding; group++) {
      const uOff = (hash01(seed, 900 + group * 2) - 0.5) * Math.min(spanU * 0.55, 16)
      const vOff = 3.2 + hash01(seed, 901 + group * 2) * Math.min(spanV * 0.52, 13)
      const [gx, gz] = toWorld(uOff, vOff)
      if (!clearFor(gx, gz, 0.85, true, true)) continue
      const gSpot = groundCells(gx, gz)
      if (gSpot === null) continue
      const groupSize = Math.min(wantStanding - made, 2 + Math.floor(hash01(seed, 950 + group) * 2))
      const baseAng = hash01(seed, 980 + group) * Math.PI * 2
      for (let m = 0; m < groupSize; m++) {
        const ang = baseAng + (m * Math.PI * 2) / groupSize
        const r = 0.58
        const px = gx + Math.cos(ang) * r
        const pz = gz + Math.sin(ang) * r
        const gp = groundCells(px, pz) ?? gSpot
        // Face center of circle (or toward stage for listeners)
        const isListener = !!stagePos && group === 0
        const fx = isListener ? stagePos![0] - px : gx - px
        const fz = isListener ? stagePos![1] - pz : gz - pz
        crowd.push({
          x: px * M,
          y: gp + deckElev * M,
          z: pz * M,
          yaw: Math.atan2(fx, -fz),
          seed: (seed + 1400 + group * 71 + m * 23) >>> 0,
          role: isListener ? 'listen' : 'chat',
          threshold: 0.10 + (made / Math.max(1, wantStanding)) * 0.72,
        })
        made++
      }
      placed.push([gx, gz, 1.1])
    }

    return { plaza: p, pieces, marketPieces, signs, crowd, sig, groundM: gCenter / M }
  }

  const destroyShop = (b: BuiltShop) => {
    for (const p of b.pieces) p.destroy()
  }
  const destroyPlaza = (b: BuiltPlaza) => {
    for (const p of b.pieces) p.destroy()
    for (const p of b.marketPieces) p.destroy()
  }

  const clearAll = () => {
    for (const b of activeShops.values()) destroyShop(b)
    for (const b of activePlazas.values()) destroyPlaza(b)
    activeShops.clear()
    activePlazas.clear()
    activeSignSpecs = []
    signsPass.clear()
    lastSyncX = -1e9
  }

  const refreshAround = (eyeXM: number, eyeZM: number) => {
    if (!enabled || !ready) return
    const hr = o.hour()
    const marketOpen = hr >= 7.0 && hr <= 18.5
    const now = performance.now()
    const moved = Math.hypot(eyeXM - lastSyncX, eyeZM - lastSyncZ)
    if (moved < 8.0 && marketOpen === lastMarketOn && now - lastRefreshMs < 450) return
    lastRefreshMs = now
    let dirty = moved >= 8.0
    if (moved >= 8.0) {
      lastSyncX = eyeXM
      lastSyncZ = eyeZM
    }

    // If market stalls toggled open/closed, rebuild active plazas once.
    if (marketOpen !== lastMarketOn) {
      lastMarketOn = marketOpen
      for (const b of activePlazas.values()) destroyPlaza(b)
      activePlazas.clear()
      dirty = true
    }

    // 1. Stream nearby Plazas & automatically re-seat if L0 tiles refine ground elevation!
    const wantedPlazas = new Set<string>()
    const pgx0 = Math.floor((eyeXM - PLAZA_RADIUS) / GRID_CELL), pgx1 = Math.floor((eyeXM + PLAZA_RADIUS) / GRID_CELL)
    const pgz0 = Math.floor((eyeZM - PLAZA_RADIUS) / GRID_CELL), pgz1 = Math.floor((eyeZM + PLAZA_RADIUS) / GRID_CELL)
    for (let gz = pgz0; gz <= pgz1; gz++) {
      for (let gx = pgx0; gx <= pgx1; gx++) {
        for (const p of plazaGrid.get(bucketKey(gx, gz)) ?? []) {
          const d = Math.hypot(p.x - eyeXM, p.z - eyeZM)
          if (d > PLAZA_RADIUS) continue
          wantedPlazas.add(p.id)
          const existing = activePlazas.get(p.id)
          const curSig = plazaSig(p)
          if (curSig === null) continue
          if (!existing || existing.sig !== curSig) {
            if (existing) destroyPlaza(existing)
            const built = buildPlaza(p, marketOpen)
            if (built) {
              activePlazas.set(p.id, built)
              dirty = true
            }
          }
        }
      }
    }
    for (const [id, b] of activePlazas) {
      if (!wantedPlazas.has(id)) {
        destroyPlaza(b)
        activePlazas.delete(id)
        dirty = true
      }
    }

    // 2. Stream nearby Storefronts (sorted closest first) & automatically re-mount if L0 facades/awnings stream in!
    const nearShops: { s: RawShop; d: number }[] = []
    const sgx0 = Math.floor((eyeXM - SHOP_RADIUS) / GRID_CELL), sgx1 = Math.floor((eyeXM + SHOP_RADIUS) / GRID_CELL)
    const sgz0 = Math.floor((eyeZM - SHOP_RADIUS) / GRID_CELL), sgz1 = Math.floor((eyeZM + SHOP_RADIUS) / GRID_CELL)
    for (let gz = sgz0; gz <= sgz1; gz++) {
      for (let gx = sgx0; gx <= sgx1; gx++) {
        for (const s of shopGrid.get(bucketKey(gx, gz)) ?? []) {
          const d = Math.hypot(s.x - eyeXM, s.z - eyeZM)
          if (d <= SHOP_RADIUS) nearShops.push({ s, d })
        }
      }
    }
    nearShops.sort((a, b) => a.d - b.d)
    const wantedShops = new Set<string>()
    for (const { s } of nearShops.slice(0, 56)) {
      const k = shopKey(s)
      wantedShops.add(k)
      const existing = activeShops.get(k)
      const curSig = shopSig(s)
      if (curSig === null) continue
      if (!existing || existing.sig !== curSig) {
        if (existing) destroyShop(existing)
        const built = buildShop(s)
        if (built) {
          activeShops.set(k, built)
          dirty = true
        }
      }
    }
    for (const [k, b] of activeShops) {
      if (!wantedShops.has(k)) {
        destroyShop(b)
        activeShops.delete(k)
        dirty = true
      }
    }

    if (!dirty) return

    // 3. Collect prioritized signs (plaza title signs first, then nearest storefront fascia & blade signs up to 64!)
    const signCandidates: { spec: SignSpec; prio: number }[] = []
    for (const b of activePlazas.values()) {
      const d = Math.hypot(b.plaza.x - eyeXM, b.plaza.z - eyeZM)
      for (const spec of b.signs) signCandidates.push({ spec, prio: d * 0.4 - 40 })
    }
    for (const b of activeShops.values()) {
      const d = Math.hypot(b.shop.x - eyeXM, b.shop.z - eyeZM)
      for (const spec of b.signs) {
        // Prioritize fascia signs slightly over blade signs when near the 64-slot cap
        signCandidates.push({ spec, prio: d + (spec.kind === 'blade' ? 16 : 0) })
      }
    }
    signCandidates.sort((a, b) => a.prio - b.prio)
    activeSignSpecs = signCandidates.slice(0, SIGN_MAX).map((c) => c.spec)
    signsPass.sync(activeSignSpecs)
  }

  /** Time-of-day & rain activity scalar [0..1] for neighborhood plaza & patio crowds. */
  const crowdActivity = (hour: number, rain: number): number => {
    let base: number
    if (hour >= 10 && hour <= 18.5) base = 1.0
    else if (hour >= 7.5 && hour < 10) base = 0.55 + ((hour - 7.5) / 2.5) * 0.45
    else if (hour > 18.5 && hour <= 21.5) base = 1.0 - ((hour - 18.5) / 3.0) * 0.55
    else if (hour > 21.5 && hour <= 23.0) base = 0.45 - ((hour - 21.5) / 1.5) * 0.35
    else base = 0.08
    return base * (1 - Math.min(0.65, rain * 0.65))
  }

  const folkList: Person[] = []
  const folk = (view: View, seconds: number): readonly Person[] => {
    folkList.length = 0
    if (!enabled || !ready) { activePeopleCount = 0; return folkList }
    const hr = o.hour()
    const rain = o.rain()
    const activity = crowdActivity(hr, rain)
    const isDay = hr >= 8.0 && hr <= 19.5
    const nowClk = o.clock()
    const eyeX = view.eye[0], eyeZ = view.eye[2]

    const emitSpot = (sp: CrowdSpot) => {
      if (sp.dayOnly && !isDay) return
      if (sp.threshold > activity) return
      const dx = sp.x - eyeX, dz = sp.z - eyeZ
      if (dx * dx + dz * dz > 1400 * 1400) return // 140 m crowd draw radius
      // React to recent nearby blasts/shocks
      let flinch = 0
      for (let i = o.shocks.length - 1; i >= 0; i--) {
        const sh = o.shocks[i]
        const age = nowClk - sh.t
        if (age > 4) break
        if (age < 0) continue
        const d = Math.hypot(sp.x - sh.at[0], sp.z - sh.at[2])
        if (d < sh.radius * 3 + 120) {
          flinch = Math.max(flinch, Math.max(0, 1 - age / 3.5))
        }
      }
      const phase = hash01(sp.seed, 1) * 12
      const glance = Math.sin(seconds * 0.55 + phase) * 0.32
      const person: Person = {
        at: [sp.x, sp.y, sp.z],
        yaw: sp.yaw,
        seed: sp.seed,
        time: seconds + phase,
        glance,
        ...(rain > 0.25 ? { umbrella: true } : {}),
        ...(flinch > 0.05 ? { flinch } : {}),
      }
      if (sp.role === 'sit') {
        person.move = { move: NAMED.sit, t: 5 }
        if (hash01(sp.seed, 9) < 0.28) person.reading = 0.85
      } else if (sp.role === 'perform' && Math.sin(seconds * 0.4 + phase) > 0.55) {
        // Occasional warm wave while performing on the town square stage
        person.move = { move: NAMED.wave, t: (seconds + phase) * 0.5 }
      }
      folkList.push(person)
    }

    for (const b of activePlazas.values()) for (const sp of b.crowd) emitSpot(sp)
    for (const b of activeShops.values()) for (const sp of b.crowd) emitSpot(sp)
    activePeopleCount = folkList.length
    return folkList
  }

  return {
    get enabled() { return enabled },
    set enabled(on: boolean) {
      if (enabled === on) return
      enabled = on
      if (!on) clearAll()
      else { lastSyncX = -1e9; loadOnce() }
    },
    get ready() { return ready },
    get stats() {
      let props = 0
      for (const b of activeShops.values()) props += b.pieces.length
      for (const b of activePlazas.values()) props += b.pieces.length + b.marketPieces.length
      return {
        totalShops: payload?.shops.length ?? 0,
        totalPlazas: payload?.plazas.length ?? 0,
        parodyShops: parodyTotal,
        activeShops: activeShops.size,
        activePlazas: activePlazas.size,
        activeSigns: signsPass.count,
        activeProps: props,
        activePeople: activePeopleCount,
      }
    },
    frame(view) {
      if (!enabled) return
      if (!ready) { loadOnce(); return }
      refreshAround(view.eye[0] / M, view.eye[2] / M)
    },
    drawSigns(encoder, to, view, sun, day, dull, faced = null) {
      if (!enabled || !ready) return
      signsPass.draw(encoder, to, view, sun, day, dull, faced)
    },
    folk,
    near(xM, zM, radiusM = 180) {
      const shops: { name: string; category: string; brandId: string | null; parody: boolean; distM: number; x: number; z: number }[] = []
      const plazas: { name: string; id: string; archetype: string; distM: number; benches: number; x: number; z: number }[] = []
      if (!payload) return { shops, plazas }
      for (const s of payload.shops) {
        const d = Math.hypot(s.x - xM, s.z - zM)
        if (d <= radiusM) shops.push({ name: s.n, category: s.c, brandId: s.br ?? null, parody: !!s.po, distM: Math.round(d * 10) / 10, x: s.x, z: s.z })
      }
      for (const p of payload.plazas) {
        const d = Math.hypot(p.x - xM, p.z - zM)
        if (d <= radiusM) plazas.push({ name: p.label, id: p.id, archetype: p.t, distM: Math.round(d * 10) / 10, benches: p.bn?.length ?? 0, x: p.x, z: p.z })
      }
      shops.sort((a, b) => a.distM - b.distM)
      plazas.sort((a, b) => a.distM - b.distM)
      return { shops, plazas }
    },
    visibleSigns() {
      return activeSignSpecs.map((s) => ({ id: s.id, title: s.title, kind: s.kind, category: s.category }))
    },
    inspect() {
      const onRoad = (pc: Piece) => (o.land.top_at(Math.round(pc.pos[0]), Math.round(pc.pos[2])) & 15) === 6
      const plazas = [...activePlazas.values()].map((b) => {
        const allP = [...b.pieces, ...b.marketPieces]
        let minY = Infinity, maxY = -Infinity, roadPropHits = 0
        for (const pc of allP) {
          const ym = pc.pos[1] / M
          if (ym < minY) minY = ym
          if (ym > maxY) maxY = ym
          if (onRoad(pc)) roadPropHits++
        }
        return {
          id: b.plaza.id,
          name: b.plaza.label,
          groundM: b.groundM,
          propMinYM: Number.isFinite(minY) ? minY : b.groundM,
          propMaxYM: Number.isFinite(maxY) ? maxY : b.groundM,
          signCount: b.signs.length,
          roadPropHits,
        }
      })
      const shops = [...activeShops.values()].map((b) => {
        let roadPropHits = 0
        for (const pc of b.pieces) if (onRoad(pc)) roadPropHits++
        return {
          name: b.shop.n,
          brandId: b.shop.br ?? null,
          groundM: b.groundM,
          signYM: b.signYM,
          outOffsetM: b.outOffsetM,
          clearedAwning: b.clearedAwning,
          roadPropHits,
        }
      })
      return { plazas, shops }
    },
    reset() {
      clearAll()
    },
  }
}
