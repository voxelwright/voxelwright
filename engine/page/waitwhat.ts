// WaitWhat autonomous robotaxis & WaitWhat Station depot (#57):
// Procedural 2.5 cm sculpted electric crossover robotaxi (pearl-white bodywork, spinning roof LiDAR turret,
// perimeter sensor pods, mint-teal WaitWhat livery, flush tinted panoramic glass, empty driver's seat,
// 4-corner amber hazard flashers) plus the WaitWhat Station charging depot on Stockton St (Fisherman's Wharf /
// North Beach) with cantilevered solar canopies, 6 EV fast-charge bays, glass Fleet Ops pavilion, illuminated
// WAITWHAT entry/exit gantry, lifting barrier gates, and smooth bay-to-street circulation splines.
import { faces as facesOf } from './fine.ts'
import type { Foot, Making, Motor } from './living.ts'
import { POLISHED } from './spells.ts'
import type { Born } from './told.ts'

const CONCRETE = 7, PLASTER = 9, GLASS = 11, STEEL = 12, ROOFING = 14, LAMP = 15
const k = (material: number, colour = 0) => material | (colour << 8)
const hue = (h: number, tone: number) => 16 + (h % 24) * 10 + (tone % 10)
const grey = (step: number) => 1 + Math.max(0, Math.min(14, step))

/** Shared palette constants for WaitWhat brand identity: pearl white, obsidian trim, electric mint-teal, deep navy. */
const WW_WHITE = k(STEEL, grey(0))
const WW_PEARL = k(STEEL, grey(1))
const WW_SILVER = k(STEEL, grey(4))
const WW_SLATE = k(STEEL, grey(11))
const WW_OBSIDIAN = k(ROOFING, grey(13))
const WW_TYRE = k(ROOFING, grey(14))
const WW_MINT = k(STEEL, hue(10, 4))
const WW_TEAL = k(STEEL, hue(11, 3))
const WW_NAVY = k(STEEL, hue(15, 6))
const WW_GLASS = k(GLASS, grey(12))
const WW_DARK_GLASS = k(GLASS, grey(13))
const WW_HEAD = k(LAMP, 1)
const WW_TAIL = k(LAMP, hue(0, 4))
const WW_AMBER = k(LAMP, hue(2, 4))
const WW_CYAN_LAMP = k(LAMP, hue(11, 4))
const WW_MINT_LAMP = k(LAMP, hue(10, 4))
const WW_WHITE_LAMP = k(LAMP, grey(0))
const WW_WARM_LAMP = k(LAMP, hue(3, 1))
const WW_RED_LAMP = k(LAMP, hue(0, 4))
const WW_SEAT = k(ROOFING, grey(11))
const WW_PAD = k(CONCRETE, grey(11))
const WW_STRIPE = k(PLASTER, grey(1))
const WW_SOLAR = k(STEEL, hue(15, 6))

/** WaitWhat smooth electric AWD SUV handling archetype (10 cm cells/s; 1 cell/s = 0.36 km/h -> 158 km/h top). */
export const WAITWHAT_HANDLING = { power: 108, top: 440, grip: 1.52, steer: 0.58, tough: 270 }

/** Minimal street.ts-compatible Model descriptor generated procedurally so WaitWhat works on every SF release. */
export interface WaitWhatLook {
  size: [number, number, number]
  per: number
  low: [number, number, number]
  palette: number[]
  runs: string
  roles?: string[]
}

export interface WaitWhatModel {
  id: string
  name: string
  kind: string
  size: [number, number, number]
  body: { palette: number[]; runs: string; roles?: string[] }
  motor: Motor
  controls: Making['controls']
  seats: [number, number, number][]
  eye: [number, number, number]
  looks: WaitWhatLook[]
  variants: { name: string; body: number[]; looks: number[][] }[]
  front: number
  long: number
  wide: number
}

/**
 * WaitWhat Station location in San Francisco (flat open commercial parcel on the west side of Stockton St
 * between Beach St & North Point St, inside both the 6-square pilot and 155-square full-city SF releases).
 * Local orthonormal frame in world 10 cm cells:
 *   `u` (ux, uz): southbound along Stockton St
 *   `w` (wx, wz): westward into the station forecourt (perpendicular to Stockton St)
 */
export interface StationBay {
  id: number
  /** Bay center in local station metres (u along Stockton, w into lot). */
  u: number
  w: number
  /** Heading of a WaitWhat parked/charging in this bay (radians in world x/z). */
  heading: number
  /** Side of the forecourt ('north' or 'south'). */
  row: 'north' | 'south'
}

export const WAITWHAT_STATION = (() => {
  const cx = 518520
  const cz = 653904
  // Aligned precisely with Stockton St segment (518744, 653425) -> (518884, 654269).
  const ux = 0.16364
  const uz = 0.98652
  const wx = -0.98652
  const wz = 0.16364
  const toWorld = (uM: number, wM: number): [number, number] => [
    cx + (ux * uM + wx * wM) * 10,
    cz + (uz * uM + wz * wM) * 10,
  ]
  const dirAngle = (du: number, dw: number) => Math.atan2(uz * du + wz * dw, ux * du + wx * dw)
  // Six spacious charging bays (3 north row, 3 south row), all angled toward the exit aisle so departure is smooth!
  const bays: StationBay[] = [
    { id: 0, u: -10.8, w: -5.5, heading: dirAngle(0.45, -0.89), row: 'north' },
    { id: 1, u: -10.8, w: 2.0, heading: dirAngle(0.45, -0.89), row: 'north' },
    { id: 2, u: -10.8, w: 9.5, heading: dirAngle(0.45, -0.89), row: 'north' },
    { id: 3, u: 10.8, w: -5.5, heading: dirAngle(-0.45, -0.89), row: 'south' },
    { id: 4, u: 10.8, w: 2.0, heading: dirAngle(-0.45, -0.89), row: 'south' },
    { id: 5, u: 10.8, w: 9.5, heading: dirAngle(-0.45, -0.89), row: 'south' },
  ]
  // Road curb apron entry & exit points (on Stockton St western edge, w = -29 m) and gate points (w = -18.5 m).
  const [inRoadX, inRoadZ] = toWorld(-5.0, -29.5)
  const [inGateX, inGateZ] = toWorld(-4.6, -18.5)
  const [outGateX, outGateZ] = toWorld(4.6, -18.5)
  const [outRoadX, outRoadZ] = toWorld(5.2, -29.5)
  const [visitX, visitZ] = toWorld(2.0, -34.0)
  return {
    name: 'WaitWhat Station',
    /** Exact lat/lon for map.mjs Visit pin (Stockton St entrance). */
    lat: 37.80745,
    lon: -122.41062,
    cx,
    cz,
    ux,
    uz,
    wx,
    wz,
    /** Rotation angle of station +x axis (= -w, pointing east toward Stockton St) in world x/z. */
    eastHeading: Math.atan2(-wz, -wx),
    /** High WaitWhat spawn boost radius (cells: 700 m outer halo, 340 m dense core). */
    boostOuter: 7000,
    boostCore: 3400,
    /** Draw radius for station structures (cells: 420 m). */
    drawReach: 4200,
    bays,
    inRoad: [inRoadX, inRoadZ] as readonly [number, number],
    inGate: [inGateX, inGateZ] as readonly [number, number],
    outGate: [outGateX, outGateZ] as readonly [number, number],
    outRoad: [outRoadX, outRoadZ] as readonly [number, number],
    visit: [visitX, visitZ] as readonly [number, number],
    toWorld,
    dirAngle,
  }
})()

// ── Voxel Grid Helpers ──
interface VoxelGrid {
  W: number
  H: number
  D: number
  s: number
  cells: Uint16Array
  c(m: number): number
  set(x: number, y: number, z: number, v: number): void
  get(x: number, y: number, z: number): number
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, v: number): void
  rounded(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, r: number, v: number): void
  cylY(xm: number, zm: number, y0: number, y1: number, r: number, v: number): void
  wheel(xm: number, ym: number, z0: number, z1: number, r: number, tyre: number, hub: number, cap?: number): void
  hollow(): void
}

function makeGrid(lengthM: number, heightM: number, widthM: number, per: number): VoxelGrid {
  const s = per * 10
  const W = Math.ceil(lengthM * s), H = Math.ceil(heightM * s), D = Math.ceil(widthM * s)
  const cells = new Uint16Array(W * H * D)
  const c = (m: number) => Math.round(m * s)
  const set = (x: number, y: number, z: number, v: number) => {
    if (x >= 0 && x < W && y >= 0 && y < H && z >= 0 && z < D) cells[x + W * (z + D * y)] = v
  }
  const get = (x: number, y: number, z: number) =>
    x >= 0 && x < W && y >= 0 && y < H && z >= 0 && z < D ? cells[x + W * (z + D * y)] : 0
  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, v: number) => {
    for (let y = c(y0); y < c(y1); y++)
      for (let z = c(z0); z < c(z1); z++)
        for (let x = c(x0); x < c(x1); x++) set(x, y, z, v)
  }
  const rounded = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, r: number, v: number) => {
    const R = r * s
    for (let y = c(y0); y < c(y1); y++)
      for (let z = c(z0); z < c(z1); z++)
        for (let x = c(x0); x < c(x1); x++) {
          const dx = Math.max(c(x0) + R - x - 0.5, 0, x + 0.5 - (c(x1) - R))
          const dz = Math.max(c(z0) + R - z - 0.5, 0, z + 0.5 - (c(z1) - R))
          if (Math.hypot(dx, dz) <= R) set(x, y, z, v)
        }
  }
  const cylY = (xm: number, zm: number, y0: number, y1: number, r: number, v: number) => {
    const cx = c(xm), cz = c(zm), R = r * s
    for (let y = c(y0); y < c(y1); y++)
      for (let z = Math.floor(cz - R - 1); z <= Math.ceil(cz + R + 1); z++)
        for (let x = Math.floor(cx - R - 1); x <= Math.ceil(cx + R + 1); x++)
          if (Math.hypot(x + 0.5 - cx, z + 0.5 - cz) <= R) set(x, y, z, v)
  }
  const wheel = (xm: number, ym: number, z0: number, z1: number, r: number, tyre: number, hub: number, cap = 0) => {
    const R = r * s, cx = c(xm), cy = c(ym)
    for (let y = c(ym - r); y <= c(ym + r); y++)
      for (let x = c(xm - r); x <= c(xm + r); x++) {
        const d = Math.hypot(x - cx, y - cy)
        if (d > R) continue
        const a = Math.atan2(y - cy, x - cx)
        const spoke = Math.abs(Math.sin(a * 2.5)) < 0.22 && d > R * 0.16 && d < R * 0.52
        const face = cap && d < R * 0.56 && (d > R * 0.48 || d < R * 0.15 || spoke)
        for (let z = c(z0); z < c(z1); z++) {
          set(x, y, z, d >= R * 0.56 ? tyre : face && (z === c(z0) || z === c(z1) - 1) ? cap : hub)
        }
      }
  }
  const hollow = () => {
    const out = cells.slice()
    for (let y = 1; y < H - 1; y++)
      for (let z = 1; z < D - 1; z++)
        for (let x = 1; x < W - 1; x++) {
          const i = x + W * (z + D * y)
          if (cells[i] && get(x + 1, y, z) && get(x - 1, y, z) && get(x, y + 1, z) && get(x, y - 1, z) && get(x, y, z + 1) && get(x, y, z - 1)) out[i] = 0
        }
    cells.set(out)
  }
  return { W, H, D, s, cells, c, set, get, box, rounded, cylY, wheel, hollow }
}

/** Compact 5x7 pixel font for crisp 3D voxel signage ("WAITWHAT", "IN", "OUT", "DEPOT", "WAIT?"). */
const FONT_5X7: Record<string, readonly string[]> = {
  W: ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  '?': ['01110', '10001', '00001', '00110', '00100', '00000', '00100'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
}

function drawTextZ(g: VoxelGrid, text: string, x0: number, x1: number, yTop: number, zMid: number, px: number, kind: number, flipZ = false) {
  const chars = [...text.toUpperCase()]
  const totalW = chars.length * 6 - 1
  const startZ = zMid - (totalW * px) / 2
  for (let ci = 0; ci < chars.length; ci++) {
    const glyph = FONT_5X7[chars[ci]] ?? FONT_5X7[' ']
    for (let r = 0; r < 7; r++) {
      for (let col = 0; col < 5; col++) {
        if (glyph[r][col] !== '1') continue
        const lc = flipZ ? (chars.length - 1 - ci) * 6 + (4 - col) : ci * 6 + col
        const z0 = startZ + lc * px
        const y0 = yTop - (r + 1) * px
        g.box(x0, x1, y0, y0 + px, z0, z0 + px, kind)
      }
    }
  }
}

function drawTextX(g: VoxelGrid, text: string, z0: number, z1: number, yTop: number, xMid: number, px: number, kind: number, flipX = false) {
  const chars = [...text.toUpperCase()]
  const totalW = chars.length * 6 - 1
  const startX = xMid - (totalW * px) / 2
  for (let ci = 0; ci < chars.length; ci++) {
    const glyph = FONT_5X7[chars[ci]] ?? FONT_5X7[' ']
    for (let r = 0; r < 7; r++) {
      for (let col = 0; col < 5; col++) {
        if (glyph[r][col] !== '1') continue
        const lc = flipX ? (chars.length - 1 - ci) * 6 + (4 - col) : ci * 6 + col
        const x0 = startX + lc * px
        const y0 = yTop - (r + 1) * px
        g.box(x0, x0 + px, y0, y0 + px, z0, z1, kind)
      }
    }
  }
}

// ── RLE & Coarsening (exact match with sf/cars.mjs & page/runs.ts) ──
function encodeRuns(cells: Uint16Array): { palette: number[]; runs: string } {
  const kinds = [0]
  const index = new Map<number, number>([[0, 0]])
  const bytes: number[] = []
  const leb = (v: number) => {
    do {
      let b = v & 127
      v = Math.floor(v / 128)
      if (v) b |= 128
      bytes.push(b)
    } while (v)
  }
  for (let i = 0; i < cells.length;) {
    const kv = cells[i]
    let j = i + 1
    while (j < cells.length && cells[j] === kv) j++
    let idx = index.get(kv)
    if (idx === undefined) {
      idx = kinds.length
      kinds.push(kv)
      index.set(kv, idx)
    }
    leb(j - i)
    leb(idx)
    i = j
  }
  let bin = ''
  for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.slice(i, i + 8192))
  return { palette: kinds, runs: btoa(bin) }
}

function coarser(kinds: Uint16Array, size: readonly [number, number, number], by: number): { kinds: Uint16Array; size: [number, number, number] } {
  const [w, h, d] = size
  const cs: [number, number, number] = [Math.ceil(w / by), Math.ceil(h / by), Math.ceil(d / by)]
  const out = new Uint16Array(cs[0] * cs[1] * cs[2])
  const counts = new Map<number, number>()
  for (let y = 0; y < cs[1]; y++)
    for (let z = 0; z < cs[2]; z++)
      for (let x = 0; x < cs[0]; x++) {
        counts.clear()
        let filled = 0
        for (let dy = 0; dy < by; dy++)
          for (let dz = 0; dz < by; dz++)
            for (let dx = 0; dx < by; dx++) {
              const X = x * by + dx, Y = y * by + dy, Z = z * by + dz
              if (X >= w || Y >= h || Z >= d) continue
              const kv = kinds[X + w * (Z + d * Y)]
              if (!kv) continue
              filled++
              counts.set(kv, (counts.get(kv) ?? 0) + ((kv & 15) === GLASS ? 0.6 : 1))
            }
        if (filled * 3 < by * by * by) continue
        let best = 0, most = -1
        for (const [kv, n] of counts) if (n > most) { most = n; best = kv }
        out[x + cs[0] * (z + cs[2] * y)] = best
      }
  return { kinds: out, size: cs }
}

function rolesOf(palette: readonly number[]): string[] {
  return palette.map((kv) => {
    if (!kv) return ''
    const mat = kv & 15
    if (mat === GLASS) return 'glass'
    if (mat === LAMP) return 'lamp'
    if (kv === WW_WHITE || kv === WW_PEARL || kv === WW_MINT || kv === WW_TEAL) return 'paint'
    if (kv === WW_TYRE) return 'tyre'
    return 'trim'
  })
}

// ── 1. WaitWhat Autonomous Crossover SUV (2.5 cm sculpted voxels) ──
let cachedModel: WaitWhatModel | null = null

/**
 * Builds the WaitWhat autonomous robotaxi model (4.68 m x 1.98 m x 1.98 m including roof sensor arch;
 * spinning top LiDAR turret rides on top at y = 1.72..2.06 m). Smooth Jaguar I-PACE crossover proportions,
 * crisp pearl-white paint, mint-teal WaitWhat livery, perimeter black sensor pods, empty driver seat,
 * glowing rear passenger infotainment screen, and 4-corner amber hazard flashers.
 */
export function buildWaitWhatModel(): WaitWhatModel {
  if (cachedModel) return cachedModel
  // Wheel bottoms sit at y = 0.07 m (0.7 cells) so both tires stay flush on concrete even across subtle 10 cm lot grade steps!
  const per = 4, L = 4.68, Wd = 1.98, H = 1.78
  const g = makeGrid(L, H, Wd, per)
  const midZ = Wd / 2

  // 1. Sleek lower chassis / rocker & sculpted front/rear bumper apron (y = 0.30..0.62 m).
  g.rounded(0.10, L - 0.14, 0.30, 0.62, 0.04, Wd - 0.04, 0.24, WW_WHITE)
  g.rounded(0.05, 0.45, 0.33, 0.62, 0.09, Wd - 0.09, 0.18, WW_WHITE)
  g.rounded(L - 0.34, L - 0.04, 0.27, 0.35, 0.12, Wd - 0.12, 0.14, WW_OBSIDIAN)
  g.rounded(0.06, 0.30, 0.27, 0.41, 0.12, Wd - 0.12, 0.12, WW_OBSIDIAN)

  // 2. Continuous sculpted side beltline & ripple-free crossover hood (single seamless panel from tail to front fender — zero vertical door/fender crease!).
  g.rounded(0.12, L - 0.22, 0.31, 0.88, 0.04, Wd - 0.04, 0.20, WW_WHITE)
  g.rounded(0.18, L - 0.62, 0.88, 0.93, 0.07, Wd - 0.07, 0.20, WW_WHITE)
  g.rounded(0.18, L - 1.24, 0.93, 1.00, 0.08, Wd - 0.08, 0.20, WW_WHITE)

  // 3. Tapered sculpted front nose.
  g.rounded(L - 0.36, L - 0.08, 0.31, 0.82, 0.08, Wd - 0.08, 0.20, WW_WHITE)
  g.rounded(L - 0.18, L - 0.03, 0.33, 0.72, 0.12, Wd - 0.12, 0.16, WW_WHITE)

  // 4. Flush dark-tinted greenhouse (swept windshield, panoramic roof, fastback hatch).
  for (let i = 0; i < 20; i++) {
    const t = i / 19
    const y0 = 0.98 + t * 0.56
    const y1 = y0 + 0.045
    const x0 = 0.36 + t * 0.58
    const x1 = 3.40 - t * 0.66
    const inset = 0.10 + t * 0.18
    const isRoofBand = t > 0.86
    g.rounded(x0, x1, y0, y1, inset, Wd - inset, 0.16, isRoofBand ? WW_WHITE : WW_GLASS)
    g.box(x1 - 0.08, x1, y0, y1, inset, inset + 0.08, WW_OBSIDIAN)
    g.box(x1 - 0.08, x1, y0, y1, Wd - inset - 0.08, Wd - inset, WW_OBSIDIAN)
    g.box(1.98, 2.12, y0, y1, inset, inset + 0.06, WW_OBSIDIAN)
    g.box(1.98, 2.12, y0, y1, Wd - inset - 0.06, Wd - inset, WW_OBSIDIAN)
    g.box(x0, x0 + 0.13, y0, y1, inset, inset + 0.10, WW_WHITE)
    g.box(x0, x0 + 0.13, y0, y1, Wd - inset - 0.10, Wd - inset, WW_WHITE)
  }
  g.rounded(0.92, 2.78, 1.50, 1.58, 0.26, Wd - 0.26, 0.14, WW_WHITE)
  g.rounded(1.16, 2.54, 1.54, 1.59, 0.42, Wd - 0.42, 0.08, WW_DARK_GLASS)

  // 5. Signature WaitWhat livery: mint-teal rocker ribbon + navy pinstripe + clean unobstructed "WAIT?" door badge!
  for (const [z0, z1] of [[0.03, 0.07], [Wd - 0.07, Wd - 0.03]]) {
    g.box(0.32, L - 0.34, 0.29, 0.39, z0, z1, WW_OBSIDIAN)
    g.box(1.14, L - 1.22, 0.41, 0.48, z0, z1, WW_MINT)
    g.box(1.14, L - 1.22, 0.48, 0.52, z0, z1, WW_NAVY)
    // Slim silver door handles set cleanly high near the beltline (y = 0.90..0.93) — completely clear of WAIT? lettering!
    g.box(1.48, 1.62, 0.90, 0.93, z0, z1, WW_SILVER)
    g.box(2.38, 2.52, 0.90, 0.93, z0, z1, WW_SILVER)
  }
  // Crisp high-contrast navy "WAIT?" centered in the open white mid-door zone (y = 0.55..0.80, zero handle or seam collisions!).
  drawTextX(g, 'WAIT?', 0.03, 0.06, 0.80, 2.18, 0.036, WW_NAVY, true)
  drawTextX(g, 'WAIT?', Wd - 0.06, Wd - 0.03, 0.80, 2.18, 0.036, WW_NAVY, false)

  // 6. Sleek sculpted front fascia: recessed obsidian EV grille, front radar pod, crisp dark-bezel LED headlamps & wraparound AMBER hazards!
  g.box(L - 0.14, L - 0.02, 0.37, 0.64, 0.50, Wd - 0.50, WW_OBSIDIAN)
  g.rounded(L - 0.09, L, 0.47, 0.60, midZ - 0.18, midZ + 0.18, 0.05, WW_OBSIDIAN)
  g.box(L - 0.03, L, 0.51, 0.57, midZ - 0.11, midZ + 0.11, WW_CYAN_LAMP)
  // Distinct recessed obsidian headlight pods with bright pale LED lenses + sleek outer AMBER wraparound hazard blinkers!
  for (const z of [0.28, Wd - 0.58]) {
    g.box(L - 0.16, L - 0.02, 0.62, 0.78, z - 0.04, z + 0.34, WW_OBSIDIAN)
    g.box(L - 0.10, L - 0.01, 0.65, 0.75, z, z + 0.30, WW_HEAD)
    g.box(L - 0.10, L - 0.01, 0.73, 0.76, z, z + 0.30, WW_WHITE_LAMP)
  }
  for (const z of [0.06, Wd - 0.26]) g.box(L - 0.32, L - 0.04, 0.64, 0.77, z, z + 0.20, WW_AMBER)

  // 7. Rear fascia: full-width crimson LED taillight bar, bold wraparound AMBER hazards (visible from side & rear!), reverse lenses & plate.
  g.box(0.08, 0.18, 0.42, 0.48, 0.32, Wd - 0.32, WW_MINT)
  g.box(0.08, 0.15, 0.52, 0.66, midZ - 0.22, midZ + 0.22, WW_STRIPE)
  g.box(0.12, 0.20, 0.80, 0.90, 0.28, Wd - 0.28, WW_TAIL)
  for (const z of [midZ - 0.34, midZ + 0.18]) g.box(0.11, 0.18, 0.74, 0.80, z, z + 0.16, WW_WHITE_LAMP)
  for (const z of [0.04, Wd - 0.28]) g.box(0.10, 0.34, 0.76, 0.92, z, z + 0.24, WW_AMBER)
  g.rounded(0.06, 0.16, 0.68, 0.78, midZ - 0.14, midZ + 0.14, 0.04, WW_OBSIDIAN)
  for (const z of [0.04, Wd - 0.18]) g.rounded(0.28, 0.46, 0.88, 1.00, z, z + 0.14, 0.04, WW_OBSIDIAN)

  // 8. Front-fender "cheek" perimeter LiDAR blisters & stalked wing mirrors with amber side hazard repeaters!
  for (const [z0, z1, stalk0, stalk1] of [[0.0, 0.12, 0.06, 0.24], [Wd - 0.12, Wd, Wd - 0.24, Wd - 0.06]]) {
    g.rounded(3.18, 3.44, 0.82, 0.96, z0, z1, 0.05, WW_OBSIDIAN)
    g.box(2.98, 3.10, 0.95, 1.04, stalk0, stalk1, WW_OBSIDIAN)
    g.box(2.96, 3.12, 0.98, 1.12, z0, z1, WW_OBSIDIAN)
    g.box(3.02, 3.12, 1.02, 1.08, z0, z1, WW_AMBER)
  }

  g.hollow()

  // 9. Interior cabin: dark floor, empty front seats (no driver!), rear bench, steering wheel & glowing cyan autonomous ride displays!
  g.box(1.05, 3.12, 0.36, 0.42, 0.18, Wd - 0.18, WW_OBSIDIAN)
  for (const z of [0.28, Wd - 0.80]) {
    g.box(2.12, 2.66, 0.42, 0.60, z, z + 0.52, WW_SEAT)
    g.box(2.02, 2.18, 0.60, 1.14, z, z + 0.52, WW_SEAT)
  }
  g.box(1.16, 1.72, 0.42, 0.60, 0.26, Wd - 0.26, WW_SEAT)
  g.box(1.08, 1.24, 0.60, 1.16, 0.26, Wd - 0.26, WW_SEAT)
  g.box(1.94, 2.00, 0.86, 1.08, midZ - 0.20, midZ + 0.20, WW_CYAN_LAMP)
  g.box(2.86, 3.22, 0.70, 0.96, 0.20, Wd - 0.20, WW_OBSIDIAN)
  g.box(2.74, 2.82, 0.94, 1.14, midZ - 0.22, midZ + 0.22, WW_OBSIDIAN)
  g.box(2.72, 2.78, 0.96, 1.12, midZ - 0.19, midZ + 0.19, WW_CYAN_LAMP)
  g.box(2.74, 2.86, 0.82, 1.02, 0.42, 0.70, WW_SLATE)

  // 10. Low-profile streamlined aerodynamic roof LiDAR bridge (spinning 360° turret mounts flush at y = 1.70 m!).
  g.rounded(1.52, 2.38, 1.56, 1.66, 0.36, Wd - 0.36, 0.14, WW_WHITE)
  g.rounded(1.66, 2.24, 1.64, 1.72, 0.56, Wd - 0.56, 0.12, WW_OBSIDIAN)
  g.rounded(2.42, 2.70, 1.56, 1.66, midZ - 0.26, midZ + 0.26, 0.08, WW_OBSIDIAN)
  g.box(2.64, 2.70, 1.58, 1.64, midZ - 0.16, midZ + 0.16, WW_CYAN_LAMP)
  g.rounded(1.06, 1.32, 1.56, 1.66, midZ - 0.22, midZ + 0.22, 0.08, WW_OBSIDIAN)
  g.cylY(1.94, midZ, 1.68, 1.77, 0.21, WW_OBSIDIAN)

  // 11. Athletic short-overhang wheel arches & sculpted 20-inch alloy wheels (bottom at y = 0.07 m -> flush on asphalt!).
  for (const xm of [0.90, L - 0.88]) {
    for (let y = g.c(0.26); y <= g.c(0.88); y++)
      for (let x = g.c(xm - 0.46); x <= g.c(xm + 0.46); x++) {
        const d = Math.hypot(x - g.c(xm), y - g.c(0.43))
        if (d < 0.39 * g.s) for (const z of [0, 1, 2, 3, g.D - 4, g.D - 3, g.D - 2, g.D - 1]) g.set(x, y, z, 0)
        else if (d < 0.46 * g.s) for (const z of [0, 1, g.D - 2, g.D - 1]) if (g.get(x, y, z)) g.set(x, y, z, WW_OBSIDIAN)
      }
    for (const [z0, z1] of [[0, 0.24], [Wd - 0.24, Wd]]) g.wheel(xm, 0.43, z0, z1, 0.36, WW_TYRE, WW_SILVER, WW_SLATE)
  }

  // Encode fine 2.5 cm look + 5 cm & 10 cm coarse LODs + 10 cm physics body.
  const fineSize: [number, number, number] = [g.W, g.H, g.D]
  const l0 = encodeRuns(g.cells)
  const c2 = coarser(g.cells, fineSize, 2)
  const l1 = encodeRuns(c2.kinds)
  const c4 = coarser(g.cells, fineSize, 4)
  const l2 = encodeRuns(c4.kinds)

  const looks: WaitWhatLook[] = [
    { size: fineSize, per: 4, low: [0, 0, 0], ...l0, roles: rolesOf(l0.palette) },
    { size: c2.size, per: 2, low: [0, 0, 0], ...l1, roles: rolesOf(l1.palette) },
    { size: c4.size, per: 1, low: [0, 0, 0], ...l2, roles: rolesOf(l2.palette) },
  ]
  const body = { ...l2, roles: rolesOf(l2.palette) }
  const bSize = c4.size
  const foot = (x: number, z: number, steers: boolean): Foot => ({ at: [x, 3.4, z], reach: 6.2, steers, drives: true })
  const motor: Motor = {
    front: 0,
    grip: WAITWHAT_HANDLING.grip,
    power: WAITWHAT_HANDLING.power,
    top: WAITWHAT_HANDLING.top,
    steer: WAITWHAT_HANDLING.steer,
    hover: 0,
    lift: 0,
    upright: 0,
    turns: 0,
    jump: 0,
    tough: WAITWHAT_HANDLING.tough,
    feet: [foot(10, 1, false), foot(10, bSize[2] - 1, false), foot(bSize[0] - 10, 1, true), foot(bSize[0] - 10, bSize[2] - 1, true)],
  }

  cachedModel = {
    id: 'waitwhat',
    name: 'WaitWhat',
    kind: 'waitwhat',
    size: bSize,
    body,
    motor,
    controls: 'drive',
    seats: [[23, 0.2, 5.5], [23, 0.2, 14.3], [14, 0.2, 5.5], [14, 0.2, 14.3]],
    eye: [22.5, 11.8, 5.5],
    looks,
    variants: [],
    front: 0,
    long: bSize[0],
    wide: bSize[2],
  }
  return cachedModel
}

// ── 2. Spinning 360° Roof LiDAR Dome (Shared tiny GPU buffers: calm cyan vs stuck amber alert) ──
let cachedDomes: { normal: Born; stuck: Born } | null = null

export function buildLidarDomeBorns(): { normal: Born; stuck: Born } {
  if (cachedDomes) return cachedDomes
  const make = (alert: boolean): Born => {
    const per = 4 // 2.5 cm cells -> 20 x 14 x 20 = 50 cm x 35 cm x 50 cm compact spinning turret
    const W = 20, H = 14, D = 20
    const cells = new Uint16Array(W * H * D)
    const set = (x: number, y: number, z: number, v: number) => {
      if (x >= 0 && x < W && y >= 0 && y < H && z >= 0 && z < D) cells[x + W * (z + D * y)] = v
    }
    const cx = W / 2, cz = D / 2
    // Normal mode: calm cyan/mint 360° scan band; Stuck mode: unmistakable bright AMBER hazard alert band (never red police-light!).
    const ringGlow = alert ? WW_AMBER : WW_CYAN_LAMP
    const accentGlow = alert ? k(LAMP, hue(3, 3)) : WW_MINT_LAMP
    for (let y = 0; y < H; y++) {
      const r = y >= 11 ? 5.2 : y >= 9 ? 7.2 : y >= 2 ? 8.2 : 7.5
      for (let z = 0; z < D; z++) {
        for (let x = 0; x < W; x++) {
          const dx = x + 0.5 - cx, dz = z + 0.5 - cz
          const d = Math.hypot(dx, dz)
          if (d > r) continue
          // Glossy white aerodynamic crown cap on top, obsidian laser window cylinder in middle, rotating optical windows + glowing scan pulse!
          if (y >= 10) set(x, y, z, WW_WHITE | POLISHED)
          else if (y >= 4 && y <= 7) {
            // Optical laser aperture on +x and -x sides so rotation is clearly visible!
            const onFace = d > r - 1.5
            const isAperture = onFace && Math.abs(dz) < 2.6 && dx > 0
            const isOpposite = onFace && Math.abs(dz) < 2.2 && dx < 0
            const isRing = onFace && y === 5
            if (isAperture) set(x, y, z, accentGlow)
            else if (isOpposite || isRing) set(x, y, z, ringGlow)
            else set(x, y, z, WW_OBSIDIAN)
          } else if (y === 8 || y === 3) {
            set(x, y, z, d > r - 1.5 && (y === 8) ? (WW_MINT | POLISHED) : WW_OBSIDIAN)
          } else {
            set(x, y, z, WW_SLATE)
          }
        }
      }
    }
    let filled = 0
    for (let i = 0; i < cells.length; i++) if (cells[i]) filled++
    return {
      id: 0,
      cells: filled,
      size: [W, H, D],
      com: [W / 2, 0, D / 2],
      low: [0, 0, 0],
      faces: facesOf(cells, [W, H, D]),
    }
  }
  cachedDomes = { normal: make(false), stuck: make(true) }
  return cachedDomes
}

// ── 3. WaitWhat Station Depot Architecture (High-craft 10 cm modular voxel structures, shared GPU buffers) ──
export interface StationBorns {
  /** Grand Stockton St entry/exit gantry archway with 3D illuminated WAITWHAT sign + IN/OUT portals (cell = 1). */
  gantry: Born
  /** Giant decorative spinning LiDAR beacon sculpture perched atop the gantry center pier (cell = 0.5). */
  mascot: Born
  /** Cantilevered solar charging canopy (19 m x 4.6 m x 8 m) — reused for North & South bay rows (cell = 1). */
  canopy: Born
  /** Sleek WaitWhat EV Fast-Charge pedestal — reused for all 6 charging bays, idle vs charging glow (cell = 0.5). */
  chargerIdle: Born
  chargerActive: Born
  /** Modern glass Fleet Operations & Dispatch Pavilion on west edge of the depot (cell = 1). */
  pavilion: Born
  /** Animated striped lift-gate barrier arm — reused for IN & OUT portals (cell = 0.5). */
  gateArm: Born
  /** Freestanding gate motor housing & outer catch post set cleanly inside the gantry apron so open arms swing into open sky (cell = 0.5). */
  gatePosts: Born
  /** Corner perimeter bollard with subtle glowing mint cap (cell = 0.5). */
  bollard: Born
}

let cachedStation: StationBorns | null = null

function bornFromGrid(g: VoxelGrid, com: [number, number, number]): Born {
  let filled = 0
  for (let i = 0; i < g.cells.length; i++) if (g.cells[i]) filled++
  return {
    id: 0,
    cells: filled,
    size: [g.W, g.H, g.D],
    com,
    low: [0, 0, 0],
    faces: facesOf(g.cells, [g.W, g.H, g.D]),
  }
}

export function buildStationBorns(): StationBorns {
  if (cachedStation) return cachedStation

  // 1. Entry/Exit Gantry Archway (depth x = 2.4 m, height y = 6.6 m, span z = 25.0 m along Stockton St).
  // Local frame: +x = east (facing Stockton St), +z = south (along Stockton St), +y = up.
  const gantry = (() => {
    const L = 2.4, H = 6.6, Wd = 25.0, g = makeGrid(L, H, Wd, 1)
    const midZ = Wd / 2
    // Three sculptural tapered pearl-white & obsidian portal piers: North end (z=1.5), Center divider (z=midZ), South end (z=Wd-1.5).
    for (const pz of [1.2, midZ, Wd - 1.2]) {
      const half = pz === midZ ? 0.75 : 0.9
      g.box(0.2, L - 0.2, 0, 0.35, pz - half - 0.15, pz + half + 0.15, WW_PAD)
      g.rounded(0.35, L - 0.35, 0.35, 4.4, pz - half, pz + half, 0.25, WW_WHITE | POLISHED)
      // Vertical mint accent LED channel on the street-facing front of each pier.
      g.box(L - 0.42, L - 0.28, 0.7, 4.1, pz - 0.12, pz + 0.12, WW_MINT_LAMP)
      // Dark obsidian inner bumper base.
      g.box(0.3, L - 0.3, 0.35, 0.95, pz - half, pz + half, WW_OBSIDIAN)
    }
    // Overhead architectural lintel beam spanning the full 25 m (y = 4.2..6.5 m) with crisp chamfered roof cap.
    g.rounded(0.1, L - 0.1, 4.2, 6.45, 0.2, Wd - 0.2, 0.3, WW_OBSIDIAN)
    // Bright pearl-white upper fascia trim & underside soffit.
    g.box(0.0, L, 6.25, 6.55, 0.15, Wd - 0.15, WW_WHITE | POLISHED)
    g.box(0.2, L - 0.2, 4.1, 4.25, 0.3, Wd - 0.3, WW_WHITE)
    // Electric mint-cyan LED accent ribbon running beneath the sign face on both sides!
    g.box(L - 0.16, L, 4.30, 4.48, 0.5, Wd - 0.5, WW_MINT_LAMP)
    g.box(0.0, 0.16, 4.30, 4.48, 0.5, Wd - 0.5, WW_MINT_LAMP)
    // Bold illuminated 3D voxel block lettering "WAITWHAT" on BOTH Stockton St face (+x) and Forecourt face (-x)!
    // 8 chars * 6 - 1 = 47 cols * 0.22 m = 10.34 m wide, 7 * 0.22 m = 1.54 m tall (super crisp & readable from 100 m away!).
    // Facing +x (viewer looking West from Stockton St): viewer's left is +z (South), right is -z (North) -> flipZ = true.
    drawTextZ(g, 'WAITWHAT', L - 0.12, L, 6.12, midZ, 0.22, WW_WHITE_LAMP, true)
    drawTextZ(g, 'WAITWHAT', 0.0, 0.12, 6.12, midZ, 0.22, WW_WHITE_LAMP, false)
    // Subtle secondary lane badges on the north (IN) and south (OUT) wings of the lintel!
    drawTextZ(g, 'IN', L - 0.12, L, 5.75, 4.1, 0.16, WW_CYAN_LAMP, true)
    drawTextZ(g, 'OUT', L - 0.12, L, 5.75, Wd - 4.1, 0.16, WW_MINT_LAMP, true)
    drawTextZ(g, 'IN', 0.0, 0.12, 5.75, 4.1, 0.16, WW_CYAN_LAMP, false)
    drawTextZ(g, 'OUT', 0.0, 0.12, 5.75, Wd - 4.1, 0.16, WW_MINT_LAMP, false)
    // Warm recessed downlights inside each portal ceiling so cars rolling through glow warmly at night.
    for (const lz of [4.2, 7.6, Wd - 7.6, Wd - 4.2]) g.box(0.8, L - 0.8, 4.05, 4.15, lz - 0.6, lz + 0.6, WW_WARM_LAMP)
    return bornFromGrid(g, [g.W / 2, 0, g.D / 2])
  })()

  // 2. Giant Decorative Spinning LiDAR Beacon Mascot atop the Gantry Center Pier (1.6 m diameter, 5 cm cells).
  const mascot = (() => {
    const per = 2, L = 1.8, H = 1.3, Wd = 1.8, g = makeGrid(L, H, Wd, per)
    g.cylY(L / 2, Wd / 2, 0.0, 0.22, 0.62, WW_SLATE)
    g.cylY(L / 2, Wd / 2, 0.22, 0.92, 0.78, WW_OBSIDIAN)
    // Glowing cyan/mint 360° scan band + 4 directional beacon lenses so rotation pops from across the street!
    for (let a = 0; a < 36; a++) {
      const ang = (a * Math.PI * 2) / 36
      const px = L / 2 + Math.cos(ang) * 0.76, pz = Wd / 2 + Math.sin(ang) * 0.76
      g.box(px - 0.06, px + 0.06, 0.50, 0.64, pz - 0.06, pz + 0.06, a % 9 === 0 ? WW_WHITE_LAMP : WW_CYAN_LAMP)
    }
    g.cylY(L / 2, Wd / 2, 0.92, 1.24, 0.72, WW_WHITE | POLISHED)
    g.cylY(L / 2, Wd / 2, 1.18, 1.30, 0.44, WW_MINT | POLISHED)
    return bornFromGrid(g, [g.W / 2, 0, g.D / 2])
  })()

  // 3. Cantilevered Solar Charging Canopy (22 m along w [local x], 4.8 m tall, 7.6 m wide [local z]).
  const canopy = (() => {
    const L = 22.0, H = 4.9, Wd = 7.6, g = makeGrid(L, H, Wd, 1)
    // Four sturdy dark-steel cantilevered support columns set cleanly along the outer bay edge (z = 1.1 m) so bays open completely toward the central aisle!
    for (const cx of [2.5, 8.5, 13.5, 19.5]) {
      g.box(cx - 0.45, cx + 0.45, 0, 0.3, 0.65, 1.55, WW_PAD)
      g.box(cx - 0.28, cx + 0.28, 0.3, 4.15, 0.85, 1.35, WW_SLATE)
      // Angled cantilevered roof truss arms extending out over the 3 charging bays!
      for (let i = 0; i < 12; i++) {
        const t = i / 12
        const y0 = 3.2 + t * 1.15
        const z0 = 1.25 + t * 5.2
        g.box(cx - 0.16, cx + 0.16, y0, y0 + 0.26, z0, z0 + 0.65, WW_SLATE)
      }
    }
    // Slight architectural solar tilt across the canopy deck (y = 4.25 m back to 4.65 m front).
    for (let i = 0; i < 16; i++) {
      const t = i / 16
      const z0 = 0.2 + t * (Wd - 0.4), z1 = z0 + 0.55
      const yBase = 4.15 + t * 0.45
      g.box(0.2, L - 0.2, yBase, yBase + 0.22, z0, z1, WW_WHITE | POLISHED)
      g.box(0.45, L - 0.45, yBase + 0.20, yBase + 0.32, z0 + 0.05, z1 - 0.05, WW_SOLAR)
    }
    // Photovoltaic cell silver grid mullions on top of roof.
    for (let x = 2.0; x < L - 1.0; x += 2.2) g.box(x, x + 0.12, 4.36, 4.76, 0.4, Wd - 0.4, WW_SILVER)
    // Glowing mint-white linear LED strip along the front fascia + bright warm under-canopy bay downlights (clean flat floor, no protruding floor bars!).
    g.box(0.3, L - 0.3, 4.55, 4.75, Wd - 0.28, Wd - 0.14, WW_MINT_LAMP)
    for (const bx of [3.5, 11.0, 18.5]) {
      g.box(bx - 1.8, bx + 1.8, 4.18, 4.28, 3.0, 4.8, WW_WARM_LAMP)
    }
    return bornFromGrid(g, [g.W / 2, 0, g.D / 2])
  })()

  // 4. EV Fast-Charge Pedestal (5 cm cells: 0.7 m x 2.1 m x 0.9 m) — idle mint vs active bright cyan charging glow!
  const makeCharger = (active: boolean) => {
    const per = 2, L = 0.75, H = 2.15, Wd = 0.95, g = makeGrid(L, H, Wd, per)
    g.box(0.05, L - 0.05, 0.0, 0.16, 0.05, Wd - 0.05, WW_PAD)
    g.rounded(0.12, L - 0.12, 0.16, 2.05, 0.14, Wd - 0.14, 0.08, WW_WHITE | POLISHED)
    g.box(0.18, L - 0.18, 0.20, 1.96, 0.22, Wd - 0.22, WW_OBSIDIAN)
    // Glowing vertical charge status halo + display screen!
    const glow = active ? WW_CYAN_LAMP : WW_MINT_LAMP
    g.box(0.10, L - 0.10, 1.88, 2.02, 0.12, Wd - 0.12, glow)
    g.box(0.10, L - 0.10, 1.15, 1.55, Wd - 0.20, Wd - 0.10, active ? WW_CYAN_LAMP : WW_TEAL)
    // Thick black charging umbilical cable loop on the side.
    g.box(L - 0.14, L, 0.55, 1.45, 0.35, 0.50, WW_TYRE)
    return bornFromGrid(g, [g.W / 2, 0, g.D / 2])
  }

  // 5. Modern Glass Fleet Operations & Dispatch Pavilion (7.6 m deep [local x], 6.4 m tall, 23.0 m wide [local z]).
  const pavilion = (() => {
    const L = 7.6, H = 6.4, Wd = 23.0, g = makeGrid(L, H, Wd, 1)
    // Raised concrete plinth & perimeter step.
    g.box(0.2, L - 0.2, 0.0, 0.28, 0.2, Wd - 0.2, WW_PAD)
    // Solid white-and-slate back wall, side walls, and structural columns.
    g.box(0.3, 0.8, 0.28, 4.3, 0.4, Wd - 0.4, WW_WHITE | POLISHED)
    g.box(0.3, L - 1.2, 0.28, 4.3, 0.4, 0.9, WW_WHITE | POLISHED)
    g.box(0.3, L - 1.2, 0.28, 4.3, Wd - 0.9, Wd - 0.4, WW_WHITE | POLISHED)
    // Floor-to-ceiling tinted glass curtain wall facing the forecourt (+x) with dark aluminum mullions!
    g.box(L - 1.3, L - 1.15, 0.42, 4.15, 1.0, Wd - 1.0, WW_GLASS)
    for (let z = 1.0; z <= Wd - 1.0; z += 3.5) g.box(L - 1.38, L - 1.08, 0.28, 4.3, z - 0.12, z + 0.12, WW_OBSIDIAN)
    g.box(L - 1.38, L - 1.08, 2.35, 2.52, 1.0, Wd - 1.0, WW_OBSIDIAN)
    // Visible interior Fleet Operations consoles & giant glowing SF live-telemetry wall monitors!
    g.box(1.1, 1.4, 1.25, 3.35, 3.0, 9.2, WW_OBSIDIAN)
    g.box(1.32, 1.48, 1.42, 3.18, 3.25, 8.95, WW_CYAN_LAMP)
    g.box(1.1, 1.4, 1.25, 3.35, 13.8, 20.0, WW_OBSIDIAN)
    g.box(1.32, 1.48, 1.42, 3.18, 14.05, 19.75, WW_MINT_LAMP)
    // Interior desk bank & warm ceiling lighting strips.
    g.box(3.0, 4.2, 0.28, 1.15, 3.2, Wd - 3.2, WW_SLATE)
    for (let z = 3.5; z < Wd - 3.0; z += 4.5) g.box(2.0, 5.2, 4.08, 4.22, z - 0.5, z + 0.5, WW_WARM_LAMP)
    // Sleek cantilevered roof overhang extending 1.4 m past the glass facade + dark roof mechanical parapet.
    g.rounded(0.0, L, 4.25, 4.74, 0.0, Wd, 0.25, WW_WHITE | POLISHED)
    g.box(0.0, L, 4.72, 4.86, 0.0, Wd, WW_OBSIDIAN)
    // Mint LED accent trim along cantilevered roof edge + generous rooftop "DEPOT" marquee sign (reads clearly from afar!).
    g.box(L - 0.14, L, 4.32, 4.46, 0.5, Wd - 0.5, WW_MINT_LAMP)
    g.box(L - 0.60, L - 0.12, 4.86, 6.28, Wd / 2 - 4.3, Wd / 2 + 4.3, WW_OBSIDIAN)
    g.box(L - 0.60, L - 0.05, 6.20, 6.32, Wd / 2 - 4.3, Wd / 2 + 4.3, WW_WHITE | POLISHED)
    drawTextZ(g, 'DEPOT', L - 0.12, L, 6.12, Wd / 2, 0.16, WW_WHITE_LAMP, true)
    return bornFromGrid(g, [g.W / 2, 0, g.D / 2])
  })()

  // 6. Animated Lift-Gate Barrier Arm (5 cm cells, 5.4 m arm — set cleanly west of the gantry beam so lifted arms swing up into open sky!).
  const gateArm = (() => {
    const per = 2, L = 0.20, H = 0.22, Wd = 5.4, g = makeGrid(L, H, Wd, per)
    for (let z = 0; z < Wd; z += 0.55) {
      const stripe = Math.floor(z / 0.55) % 2 === 0
      g.box(0.04, 0.16, 0.04, 0.18, z, Math.min(Wd, z + 0.55), stripe ? WW_WHITE | POLISHED : WW_TEAL)
    }
    for (let z = 1.0; z < Wd - 0.4; z += 1.8) g.box(0.04, 0.16, 0.02, 0.06, z, z + 0.18, WW_AMBER)
    return bornFromGrid(g, [g.W / 2, g.H / 2, 0])
  })()

  // 6b. Freestanding Gate Motor Housing + Outer Catch-Fork Post (set 2.7 m west of the gantry beam -> zero overhead lintel collision!).
  const gatePosts = (() => {
    const per = 2, L = 0.65, H = 1.38, Wd = 6.2, g = makeGrid(L, H, Wd, per)
    // Motor cabinet at z = 0..0.55 m.
    g.box(0.05, L - 0.05, 0.0, 0.14, 0.0, 0.58, WW_PAD)
    g.rounded(0.10, L - 0.10, 0.14, 1.34, 0.05, 0.54, 0.08, WW_WHITE | POLISHED)
    g.box(0.16, L - 0.16, 0.18, 1.16, 0.10, 0.48, WW_SLATE)
    g.box(0.12, L - 0.12, 1.18, 1.30, 0.08, 0.50, WW_MINT_LAMP)
    // Outer catch-fork post at z = 5.65..6.05 m (right under the closed 5.4 m arm tip!).
    g.box(0.18, L - 0.18, 0.0, 1.12, 5.72, 6.02, WW_SLATE)
    g.box(0.12, L - 0.12, 1.00, 1.18, 5.68, 6.06, WW_OBSIDIAN)
    return bornFromGrid(g, [g.W / 2, 0, 0.30 * per * 10])
  })()

  // 7. Illuminated Depot Perimeter Bollard (5 cm cells, 0.35 m x 1.0 m x 0.35 m).
  const bollard = (() => {
    const per = 2, L = 0.4, H = 1.05, Wd = 0.4, g = makeGrid(L, H, Wd, per)
    g.cylY(0.2, 0.2, 0.0, 0.85, 0.14, WW_OBSIDIAN)
    g.cylY(0.2, 0.2, 0.85, 0.96, 0.14, WW_MINT_LAMP)
    g.cylY(0.2, 0.2, 0.96, 1.05, 0.13, WW_WHITE)
    return bornFromGrid(g, [g.W / 2, 0, g.D / 2])
  })()

  cachedStation = {
    gantry,
    mascot,
    canopy,
    chargerIdle: makeCharger(false),
    chargerActive: makeCharger(true),
    pavilion,
    gateArm,
    gatePosts,
    bollard,
  }
  return cachedStation
}

/** Punchy, single-line San Francisco bystander yells & filming captions when a WaitWhat freezes in traffic. */
export const WAITWHAT_YELLS: readonly string[] = [
  'WAIT WHAT?! MOVE!',
  'IT FROZE AGAIN!',
  'ANYBODY IN THERE?!',
  'TURN ALREADY!',
  'NOT HERE! MOVE!',
  'CALL SUPPORT!',
  'BLOCKING THE LANE!',
  'YOU CAN\'T PARK HERE!',
  'JUST GO AROUND!',
  'EVERY DAY WITH THIS!',
]

export const WAITWHAT_FILM_LINES: readonly string[] = [
  'Caught in 4K!',
  'Classic WaitWhat',
  'Going to reels!',
  'What is it doing?',
  'Staring contest!',
  'Peak San Francisco',
]
