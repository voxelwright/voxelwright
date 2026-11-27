// Procedural robotaxi model, spinning roof LiDAR dome, and charging-station builders (#57).
// Parameterized entirely by `RobotaxiService` (page/robotaxi-services.ts) so zero brand names are hardcoded here:
// renaming a service or registering rival services automatically builds each service's sculpted Waymo Ojai
// (page/ojai-sculpt.ts), roof LiDAR turret, and illuminated depot architecture.
import { coarser } from './car-sculpt.ts'
import { faces as facesOf } from './fine.ts'
import type { Foot, Making, Motor } from './living.ts'
import { FONT_5X7, OJAI_KINDS, OJAI_SPEC, sculptOjai } from './ojai-sculpt.ts'
import { ROBOTAXI_HANDLING, type RobotaxiService } from './robotaxi-services.ts'
import { POLISHED } from './spells.ts'
import type { Born } from './told.ts'

export {
  ROBOTAXI_SERVICES,
  type RobotaxiService,
  type RobotaxiStation,
  type StationBay,
} from './robotaxi-services.ts'

const CONCRETE = 7, GLASS = 11, STEEL = 12, ROOFING = 14, LAMP = 15
const k = (material: number, colour = 0) => material | (colour << 8)
const hue = (h: number, tone: number) => 16 + (h % 24) * 10 + (tone % 10)
const grey = (step: number) => 1 + Math.max(0, Math.min(14, step))

const ST_WHITE = k(STEEL, grey(0))
const ST_SILVER = k(STEEL, grey(4))
const ST_SLATE = k(STEEL, grey(11))
const ST_OBSIDIAN = k(ROOFING, grey(13))
const ST_TYRE = k(ROOFING, grey(14))
const ST_GLASS = k(GLASS, grey(12))
const ST_AMBER = k(LAMP, hue(2, 4))
const ST_AMBER_HOT = k(LAMP, hue(3, 3))
const ST_WHITE_LAMP = k(LAMP, grey(0))
const ST_WARM_LAMP = k(LAMP, hue(3, 1))
const ST_PAD = k(CONCRETE, grey(11))
const ST_SOLAR = k(STEEL, hue(15, 6))

/** Minimal street.ts-compatible Model descriptor generated procedurally for any robotaxi service. */
export interface RobotaxiLook {
  size: [number, number, number]
  per: number
  low: [number, number, number]
  palette: number[]
  runs: string
  roles?: string[]
}

export interface RobotaxiModel {
  id: string
  name: string
  kind: 'robotaxi'
  serviceId: string
  domeOffset: readonly [number, number, number]
  size: [number, number, number]
  body: { palette: number[]; runs: string; roles?: string[] }
  motor: Motor
  controls: Making['controls']
  seats: [number, number, number][]
  eye: [number, number, number]
  looks: RobotaxiLook[]
  variants: { name: string; body: number[]; looks: number[][] }[]
  front: number
  long: number
  wide: number
}

// ── Voxel Grid Helpers (for modular station architecture) ──
interface VoxelGrid {
  W: number
  H: number
  D: number
  s: number
  cells: Uint16Array
  c(m: number): number
  set(x: number, y: number, z: number, v: number): void
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, v: number): void
  rounded(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, r: number, v: number): void
  cylY(xm: number, zm: number, y0: number, y1: number, r: number, v: number): void
}

function makeGrid(lengthM: number, heightM: number, widthM: number, per: number): VoxelGrid {
  const s = per * 10
  const W = Math.ceil(lengthM * s), H = Math.ceil(heightM * s), D = Math.ceil(widthM * s)
  const cells = new Uint16Array(W * H * D)
  const c = (m: number) => Math.round(m * s)
  const set = (x: number, y: number, z: number, v: number) => {
    if (x >= 0 && x < W && y >= 0 && y < H && z >= 0 && z < D) cells[x + W * (z + D * y)] = v
  }
  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, v: number) => {
    for (let y = c(y0); y < c(y1); y++)
      for (let z = c(z0); z < c(z1); z++)
        for (let x = c(x0); x < c(x1); x++) set(x, y, z, v)
  }
  const rounded = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, r: number, v: number) => {
    const R = r * s
    const X0 = c(x0), X1 = c(x1), Y0 = c(y0), Y1 = c(y1), Z0 = c(z0), Z1 = c(z1)
    for (let y = Y0; y < Y1; y++) {
      for (let z = Z0; z < Z1; z++) {
        for (let x = X0; x < X1; x++) {
          const dx = Math.max(X0 + R - x - 0.5, x + 0.5 - (X1 - R), 0)
          const dz = Math.max(Z0 + R - z - 0.5, z + 0.5 - (Z1 - R), 0)
          if (dx * dx + dz * dz <= R * R) set(x, y, z, v)
        }
      }
    }
  }
  const cylY = (xm: number, zm: number, y0: number, y1: number, r: number, v: number) => {
    const cx = xm * s, cz = zm * s, R = r * s
    for (let y = c(y0); y < c(y1); y++)
      for (let z = Math.floor(cz - R); z <= Math.ceil(cz + R); z++)
        for (let x = Math.floor(cx - R); x <= Math.ceil(cx + R); x++)
          if ((x + 0.5 - cx) ** 2 + (z + 0.5 - cz) ** 2 <= R * R) set(x, y, z, v)
  }
  return { W, H, D, s, cells, c, set, box, rounded, cylY }
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

// ── RLE Packing (exact match with sf/cars.mjs & page/runs.ts) ──
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
    const kk = cells[i]
    let j = i + 1
    while (j < cells.length && cells[j] === kk) j++
    let idx = index.get(kk)
    if (idx === undefined) { idx = kinds.length; index.set(kk, idx); kinds.push(kk) }
    leb(j - i)
    leb(idx)
    i = j
  }
  let bin = ''
  for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.slice(i, i + 8192))
  return { palette: kinds, runs: btoa(bin) }
}

function rolesOf(palette: number[], paintKinds: Set<number>): string[] {
  return palette.map((kk) => {
    if (!kk) return ''
    const mat = kk & 15
    if (mat === GLASS) return 'glass'
    if (mat === LAMP) return 'lamp'
    if (paintKinds.has(kk)) return 'paint'
    if (kk === OJAI_KINDS.tyre) return 'tyre'
    return 'trim'
  })
}

// ── 1. Sculpted Waymo Ojai Robotaxi Builder (cached per service) ──
const modelCache = new Map<string, RobotaxiModel>()

/** (#83) Adopts models sculpted in a worker (`robotaxi-maker.ts`) so `buildRobotaxiModel` answers immediately. */
export function adoptRobotaxiModels(made: readonly RobotaxiModel[]): void {
  for (const m of made) if (!modelCache.has(m.id)) modelCache.set(m.id, m)
}

export function buildRobotaxiModel(service: RobotaxiService): RobotaxiModel {
  const existing = modelCache.get(service.id)
  if (existing) return existing

  const sculpted = sculptOjai({ livery: service.livery, badge: service.badge, spec: OJAI_SPEC })
  const paintKinds = new Set([service.livery.body, service.livery.roof, service.livery.accent, service.livery.text])

  // Build 2.5 cm (per=4), 5 cm (per=2), and 10 cm (per=1) shell-preserving LODs via car-sculpt.ts `coarser`.
  const look4 = encodeRuns(sculpted.cells)
  const c2 = coarser(sculpted.cells, sculpted.size, 2)
  const look2 = encodeRuns(c2.kinds)
  const c1 = coarser(sculpted.cells, sculpted.size, 4)
  const look1 = encodeRuns(c1.kinds)

  const looks: RobotaxiLook[] = [
    { size: sculpted.size, per: 4, low: [0, 0, 0], ...look4, roles: rolesOf(look4.palette, paintKinds) },
    { size: c2.size, per: 2, low: [0, 0, 0], ...look2, roles: rolesOf(look2.palette, paintKinds) },
    { size: c1.size, per: 1, low: [0, 0, 0], ...look1, roles: rolesOf(look1.palette, paintKinds) },
  ]
  const bSize = c1.size
  const body = { ...look1, roles: rolesOf(look1.palette, paintKinds) }

  // Electric AWD motor matched to Ojai 3.00 m wheelbase (`wheels: [0.84, 3.84]` -> x = 8.4 and 38.4 in 10 cm body cells).
  const foot = (x: number, z: number, steers: boolean): Foot => ({
    at: [x, 3.4, z],
    reach: 6.2,
    drives: true,
    steers,
  })
  const [wx0, wx1] = OJAI_SPEC.wheels
  const motor: Motor = {
    front: 0,
    power: ROBOTAXI_HANDLING.power,
    top: ROBOTAXI_HANDLING.top,
    grip: ROBOTAXI_HANDLING.grip,
    steer: ROBOTAXI_HANDLING.steer,
    hover: 0,
    lift: 0,
    upright: 0,
    turns: 0,
    jump: 0,
    tough: ROBOTAXI_HANDLING.tough,
    feet: [
      foot(wx0 * 10, 1, false),
      foot(wx0 * 10, bSize[2] - 1, false),
      foot(wx1 * 10, 1, true),
      foot(wx1 * 10, bSize[2] - 1, true),
    ],
  }

  const built: RobotaxiModel = {
    id: service.id,
    name: service.name,
    kind: 'robotaxi',
    serviceId: service.id,
    domeOffset: OJAI_SPEC.domeOffset,
    size: bSize,
    body,
    motor,
    controls: 'drive',
    seats: OJAI_SPEC.seats.map((s) => [s[0], s[1], s[2]]),
    eye: [OJAI_SPEC.eye[0], OJAI_SPEC.eye[1], OJAI_SPEC.eye[2]],
    looks,
    variants: [],
    front: 0,
    long: bSize[0],
    wide: bSize[2],
  }
  modelCache.set(service.id, built)
  return built
}

// ── 2. Spinning 360° Roof LiDAR Dome (cached per service: brand-accent normal vs bright amber stuck beacon) ──
const domeCache = new Map<string, { normal: Born; stuck: Born }>()

export function buildLidarDomeBorns(service: RobotaxiService): { normal: Born; stuck: Born } {
  const existing = domeCache.get(service.id)
  if (existing) return existing

  const make = (alert: boolean): Born => {
    // 2.5 cm cells -> 18 x 12 x 18 = 45 cm x 30 cm x 45 cm sleek streamlined Ojai 6th-gen LiDAR dome.
    const W = 18, H = 12, D = 18
    const cells = new Uint16Array(W * H * D)
    const set = (x: number, y: number, z: number, v: number) => {
      if (x >= 0 && x < W && y >= 0 && y < H && z >= 0 && z < D) cells[x + W * (z + D * y)] = v
    }
    const cx = W / 2, cz = D / 2
    const ringGlow = alert ? ST_AMBER : service.livery.accentLamp
    const accentGlow = alert ? ST_AMBER_HOT : service.stationGlow
    for (let y = 0; y < H; y++) {
      const r = y >= 10 ? 4.8 : y >= 8 ? 6.6 : y >= 2 ? 7.6 : 7.0
      for (let z = 0; z < D; z++) {
        for (let x = 0; x < W; x++) {
          const dx = x + 0.5 - cx, dz = z + 0.5 - cz
          const d = Math.hypot(dx, dz)
          if (d > r) continue
          if (y >= 9) set(x, y, z, service.livery.roof | POLISHED)
          else if (y >= 3 && y <= 6) {
            const onFace = d > r - 1.5
            const isAperture = onFace && Math.abs(dz) < 2.6 && dx > 0
            const isOpposite = onFace && Math.abs(dz) < 2.2 && dx < 0
            // 2-row bright amber hazard ring when stuck so the roof fault beacon reads clearly day & night!
            const isRing = onFace && (alert ? (y === 4 || y === 5) : y === 4)
            if (isAperture) set(x, y, z, accentGlow)
            else if (isOpposite || isRing) set(x, y, z, ringGlow)
            else set(x, y, z, ST_OBSIDIAN)
          } else if (y === 7 || y === 2) {
            set(x, y, z, d > r - 1.5 && y === 7 ? (service.livery.accent | POLISHED) : ST_OBSIDIAN)
          } else {
            set(x, y, z, ST_SLATE)
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
  const built = { normal: make(false), stuck: make(true) }
  domeCache.set(service.id, built)
  return built
}

// ── 3. Service Charging Depot Architecture (parameterized by service name, gantry title & livery) ──
export interface StationBorns {
  gantry: Born
  mascot: Born
  canopy: Born
  chargerIdle: Born
  chargerActive: Born
  pavilion: Born
  gateArm: Born
  gatePosts: Born
  bollard: Born
}

const stationCache = new Map<string, StationBorns>()

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

export function buildStationBorns(service: RobotaxiService): StationBorns {
  const existing = stationCache.get(service.id)
  if (existing) return existing

  const liv = service.livery
  const primaryGlow = service.stationGlow
  const secondaryGlow = liv.accentLamp
  const title = service.station.gantryTitle
  const depotTitle = service.station.depotTitle

  // 1. Entry/Exit Gantry Archway (depth x = 2.4 m, height y = 6.6 m, span z = 25.0 m along street frontage).
  const gantry = (() => {
    const L = 2.4, H = 6.6, Wd = 25.0, g = makeGrid(L, H, Wd, 1)
    const midZ = Wd / 2
    for (const pz of [1.2, midZ, Wd - 1.2]) {
      const half = pz === midZ ? 0.75 : 0.9
      g.box(0.2, L - 0.2, 0, 0.35, pz - half - 0.15, pz + half + 0.15, ST_PAD)
      g.rounded(0.35, L - 0.35, 0.35, 4.4, pz - half, pz + half, 0.25, ST_WHITE | POLISHED)
      g.box(L - 0.42, L - 0.28, 0.7, 4.1, pz - 0.12, pz + 0.12, primaryGlow)
      g.box(0.3, L - 0.3, 0.35, 0.95, pz - half, pz + half, ST_OBSIDIAN)
    }
    g.rounded(0.1, L - 0.1, 4.2, 6.45, 0.2, Wd - 0.2, 0.3, ST_OBSIDIAN)
    g.box(0.0, L, 6.25, 6.55, 0.15, Wd - 0.15, ST_WHITE | POLISHED)
    g.box(0.2, L - 0.2, 4.1, 4.25, 0.3, Wd - 0.3, ST_WHITE)
    g.box(L - 0.16, L, 4.30, 4.48, 0.5, Wd - 0.5, primaryGlow)
    g.box(0.0, 0.16, 4.30, 4.48, 0.5, Wd - 0.5, primaryGlow)
    // Auto-scale gantry brand lettering to fit cleanly between the IN & OUT lane wings for any service name length!
    const titleCols = Math.max(1, title.length * 6 - 1)
    const titlePx = Math.min(0.24, 11.4 / titleCols)
    const titleTop = 4.65 + 7 * titlePx
    drawTextZ(g, title, L - 0.12, L, Math.min(6.18, titleTop), midZ, titlePx, ST_WHITE_LAMP, true)
    drawTextZ(g, title, 0.0, 0.12, Math.min(6.18, titleTop), midZ, titlePx, ST_WHITE_LAMP, false)
    drawTextZ(g, 'IN', L - 0.12, L, 5.75, 4.1, 0.16, secondaryGlow, true)
    drawTextZ(g, 'OUT', L - 0.12, L, 5.75, Wd - 4.1, 0.16, primaryGlow, true)
    drawTextZ(g, 'IN', 0.0, 0.12, 5.75, 4.1, 0.16, secondaryGlow, false)
    drawTextZ(g, 'OUT', 0.0, 0.12, 5.75, Wd - 4.1, 0.16, primaryGlow, false)
    for (const lz of [4.2, 7.6, Wd - 7.6, Wd - 4.2]) g.box(0.8, L - 0.8, 4.05, 4.15, lz - 0.6, lz + 0.6, ST_WARM_LAMP)
    return bornFromGrid(g, [g.W / 2, 0, g.D / 2])
  })()

  // 2. Giant Decorative Spinning LiDAR Beacon Mascot atop the Gantry Center Pier.
  const mascot = (() => {
    const per = 2, L = 1.8, H = 1.3, Wd = 1.8, g = makeGrid(L, H, Wd, per)
    g.cylY(L / 2, Wd / 2, 0.0, 0.22, 0.62, ST_SLATE)
    g.cylY(L / 2, Wd / 2, 0.22, 0.92, 0.78, ST_OBSIDIAN)
    for (let a = 0; a < 36; a++) {
      const ang = (a * Math.PI * 2) / 36
      const px = L / 2 + Math.cos(ang) * 0.76, pz = Wd / 2 + Math.sin(ang) * 0.76
      g.box(px - 0.06, px + 0.06, 0.50, 0.64, pz - 0.06, pz + 0.06, a % 9 === 0 ? ST_WHITE_LAMP : secondaryGlow)
    }
    g.cylY(L / 2, Wd / 2, 0.92, 1.24, 0.72, liv.roof | POLISHED)
    g.cylY(L / 2, Wd / 2, 1.18, 1.30, 0.44, liv.accent | POLISHED)
    return bornFromGrid(g, [g.W / 2, 0, g.D / 2])
  })()

  // 3. Cantilevered Solar Charging Canopy.
  const canopy = (() => {
    const L = 22.0, H = 4.9, Wd = 7.6, g = makeGrid(L, H, Wd, 1)
    for (const cx of [2.5, 8.5, 13.5, 19.5]) {
      g.box(cx - 0.45, cx + 0.45, 0, 0.3, 0.65, 1.55, ST_PAD)
      g.box(cx - 0.28, cx + 0.28, 0.3, 4.15, 0.85, 1.35, ST_SLATE)
      for (let i = 0; i < 12; i++) {
        const t = i / 12
        const y0 = 3.2 + t * 1.15
        const z0 = 1.25 + t * 5.2
        g.box(cx - 0.16, cx + 0.16, y0, y0 + 0.26, z0, z0 + 0.65, ST_SLATE)
      }
    }
    for (let i = 0; i < 16; i++) {
      const t = i / 16
      const z0 = 0.2 + t * (Wd - 0.4), z1 = z0 + 0.55
      const yBase = 4.15 + t * 0.45
      g.box(0.2, L - 0.2, yBase, yBase + 0.22, z0, z1, ST_WHITE | POLISHED)
      g.box(0.45, L - 0.45, yBase + 0.20, yBase + 0.32, z0 + 0.05, z1 - 0.05, ST_SOLAR)
    }
    for (let x = 2.0; x < L - 1.0; x += 2.2) g.box(x, x + 0.12, 4.36, 4.76, 0.4, Wd - 0.4, ST_SILVER)
    g.box(0.3, L - 0.3, 4.55, 4.75, Wd - 0.28, Wd - 0.14, primaryGlow)
    for (const bx of [3.5, 11.0, 18.5]) g.box(bx - 1.8, bx + 1.8, 4.18, 4.28, 3.0, 4.8, ST_WARM_LAMP)
    return bornFromGrid(g, [g.W / 2, 0, g.D / 2])
  })()

  // 4. EV Fast-Charge Pedestal (idle vs active charging glow).
  const makeCharger = (active: boolean) => {
    const per = 2, L = 0.75, H = 2.15, Wd = 0.95, g = makeGrid(L, H, Wd, per)
    g.box(0.05, L - 0.05, 0.0, 0.16, 0.05, Wd - 0.05, ST_PAD)
    g.rounded(0.12, L - 0.12, 0.16, 2.05, 0.14, Wd - 0.14, 0.08, ST_WHITE | POLISHED)
    g.box(0.18, L - 0.18, 0.20, 1.96, 0.22, Wd - 0.22, ST_OBSIDIAN)
    const glow = active ? secondaryGlow : primaryGlow
    g.box(0.10, L - 0.10, 1.88, 2.02, 0.12, Wd - 0.12, glow)
    g.box(0.10, L - 0.10, 1.15, 1.55, Wd - 0.20, Wd - 0.10, active ? secondaryGlow : liv.accent)
    g.box(L - 0.14, L, 0.55, 1.45, 0.35, 0.50, ST_TYRE)
    return bornFromGrid(g, [g.W / 2, 0, g.D / 2])
  }

  // 5. Modern Glass Fleet Operations & Dispatch Pavilion.
  const pavilion = (() => {
    const L = 7.6, H = 6.4, Wd = 23.0, g = makeGrid(L, H, Wd, 1)
    g.box(0.2, L - 0.2, 0.0, 0.28, 0.2, Wd - 0.2, ST_PAD)
    g.box(0.3, 0.8, 0.28, 4.3, 0.4, Wd - 0.4, ST_WHITE | POLISHED)
    g.box(0.3, L - 1.2, 0.28, 4.3, 0.4, 0.9, ST_WHITE | POLISHED)
    g.box(0.3, L - 1.2, 0.28, 4.3, Wd - 0.9, Wd - 0.4, ST_WHITE | POLISHED)
    g.box(L - 1.3, L - 1.15, 0.42, 4.15, 1.0, Wd - 1.0, ST_GLASS)
    for (let z = 1.0; z <= Wd - 1.0; z += 3.5) g.box(L - 1.38, L - 1.08, 0.28, 4.3, z - 0.12, z + 0.12, ST_OBSIDIAN)
    g.box(L - 1.38, L - 1.08, 2.35, 2.52, 1.0, Wd - 1.0, ST_OBSIDIAN)
    g.box(1.1, 1.4, 1.25, 3.35, 3.0, 9.2, ST_OBSIDIAN)
    g.box(1.32, 1.48, 1.42, 3.18, 3.25, 8.95, secondaryGlow)
    g.box(1.1, 1.4, 1.25, 3.35, 13.8, 20.0, ST_OBSIDIAN)
    g.box(1.32, 1.48, 1.42, 3.18, 14.05, 19.75, primaryGlow)
    g.box(3.0, 4.2, 0.28, 1.15, 3.2, Wd - 3.2, ST_SLATE)
    for (let z = 3.5; z < Wd - 3.0; z += 4.5) g.box(2.0, 5.2, 4.08, 4.22, z - 0.5, z + 0.5, ST_WARM_LAMP)
    g.rounded(0.0, L, 4.25, 4.74, 0.0, Wd, 0.25, ST_WHITE | POLISHED)
    g.box(0.0, L, 4.72, 4.86, 0.0, Wd, ST_OBSIDIAN)
    g.box(L - 0.14, L, 4.32, 4.46, 0.5, Wd - 0.5, primaryGlow)
    g.box(L - 0.60, L - 0.12, 4.86, 6.28, Wd / 2 - 4.3, Wd / 2 + 4.3, ST_OBSIDIAN)
    g.box(L - 0.60, L - 0.05, 6.20, 6.32, Wd / 2 - 4.3, Wd / 2 + 4.3, ST_WHITE | POLISHED)
    drawTextZ(g, depotTitle, L - 0.12, L, 6.12, Wd / 2, 0.16, ST_WHITE_LAMP, true)
    return bornFromGrid(g, [g.W / 2, 0, g.D / 2])
  })()

  // 6. Animated Lift-Gate Barrier Arm & Freestanding Gate Posts (clear of overhead lintel!).
  const gateArm = (() => {
    const per = 2, L = 0.20, H = 0.22, Wd = 5.4, g = makeGrid(L, H, Wd, per)
    for (let z = 0; z < Wd; z += 0.55) {
      const stripe = Math.floor(z / 0.55) % 2 === 0
      g.box(0.04, 0.16, 0.04, 0.18, z, Math.min(Wd, z + 0.55), stripe ? ST_WHITE | POLISHED : liv.accent)
    }
    for (let z = 1.0; z < Wd - 0.4; z += 1.8) g.box(0.04, 0.16, 0.02, 0.06, z, z + 0.18, ST_AMBER)
    return bornFromGrid(g, [g.W / 2, g.H / 2, 0])
  })()

  const gatePosts = (() => {
    const per = 2, L = 0.65, H = 1.38, Wd = 6.2, g = makeGrid(L, H, Wd, per)
    g.box(0.05, L - 0.05, 0.0, 0.14, 0.0, 0.58, ST_PAD)
    g.rounded(0.10, L - 0.10, 0.14, 1.34, 0.05, 0.54, 0.08, ST_WHITE | POLISHED)
    g.box(0.16, L - 0.16, 0.18, 1.16, 0.10, 0.48, ST_SLATE)
    g.box(0.12, L - 0.12, 1.18, 1.30, 0.08, 0.50, primaryGlow)
    g.box(0.18, L - 0.18, 0.0, 1.12, 5.72, 6.02, ST_SLATE)
    g.box(0.12, L - 0.12, 1.00, 1.18, 5.68, 6.06, ST_OBSIDIAN)
    return bornFromGrid(g, [g.W / 2, 0, 0.30 * per * 10])
  })()

  // 7. Illuminated Depot Perimeter Bollard.
  const bollard = (() => {
    const per = 2, L = 0.4, H = 1.05, Wd = 0.4, g = makeGrid(L, H, Wd, per)
    g.cylY(0.2, 0.2, 0.0, 0.85, 0.14, ST_OBSIDIAN)
    g.cylY(0.2, 0.2, 0.85, 0.96, 0.14, primaryGlow)
    g.cylY(0.2, 0.2, 0.96, 1.05, 0.13, ST_WHITE)
    return bornFromGrid(g, [g.W / 2, 0, g.D / 2])
  })()

  const built: StationBorns = {
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
  stationCache.set(service.id, built)
  return built
}
