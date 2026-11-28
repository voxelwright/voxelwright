// High-detail 2.5 cm procedural delivery fleet sculptors & upgrade catalog for DoorSmash.
// Builds distinct, recognizable voxel vehicles (Electric Scooter, Moped, Prius Hybrid, Turbo Courier Hatch)
// with customizable clearcoat paint finishes, glowing lighting kits (roof topper & neon underglow),
// and visible practical upgrades (cargo racks, thermal pizza box, liquid gimbal mount, shock dampers).
import { coarser } from './car-sculpt.ts'
import type { Foot, Making, Motor, Thing } from './living.ts'
import { LIGHT_CAR, type LocalLightSink } from './lights.ts'
import { POLISHED } from './spells.ts'

const GLASS = 11, STEEL = 12, ROOFING = 14, LAMP = 15, PLASTER = 9
const k = (material: number, colour = 0) => material | (colour << 8)
const hue = (h: number, tone: number) => 16 + (h % 24) * 10 + (tone % 10)
const grey = (step: number) => 1 + Math.max(0, Math.min(14, step))

const K = {
  glass: k(GLASS, grey(11)),
  dark: k(STEEL, grey(13)),
  rubber: k(ROOFING, grey(14)),
  chrome: k(STEEL, grey(3)),
  alloy: k(STEEL, grey(6)),
  seat: k(ROOFING, grey(12)),
  dash: k(ROOFING, grey(11)),
  head: k(LAMP, grey(0)),
  amber: k(LAMP, hue(3, 4)),
  tail: k(LAMP, hue(0, 4)),
  plate: k(PLASTER, grey(1)),
  boxRed: k(STEEL, hue(0, 4)) | POLISHED,
  boxWhite: k(PLASTER, grey(1)),
  cyanLed: k(LAMP, hue(13, 3)),
  pinkLed: k(LAMP, hue(22, 3)),
  mintLed: k(LAMP, hue(9, 3)),
} as const

export type DeliveryVehicleId = 'scooter' | 'moped' | 'prius' | 'turbo'
export type PaintId = 'crimson' | 'mint' | 'gold' | 'stealth' | 'sakura' | 'pearl' | 'cobalt'
export type LightingId = 'stock' | 'topper' | 'underglow' | 'cyber'

export interface PaintDef {
  id: PaintId
  name: string
  hex: string
  cost: number
  kind: number
}

export interface LightingDef {
  id: LightingId
  name: string
  desc: string
  cost: number
  underglowRgb?: [number, number, number]
  topper?: boolean
  ledKind?: number
}

export interface VehicleUpgrades {
  paint: PaintId
  lighting: LightingId
  /** 0..2: expands cargo grid slots and mounts larger racks/top boxes. */
  cargoRack: number
  /** 0..1: insulated flat pizza warmer deck (cuts cooling 65%, locks flat boxes). */
  pizzaWarmer: number
  /** 0..1: gimballed spill-proof soup/drink mount (cuts spill shock 75%). */
  liquidMount: number
  /** 0..2: shock-absorbing foam & dampers (cuts impact force 40% / 70%). */
  fragileShock: number
}

export interface DeliveryVehicleDef {
  id: DeliveryVehicleId
  name: string
  tagline: string
  category: 'e-scooter' | 'moped' | 'car'
  cost: number
  topKmh: number
  baseGrid: readonly [number, number] // [cols, rows]
  /** Cargo zone position on vehicle for impact localization: 'front' | 'rear' | 'trunk'. */
  cargoZone: 'front' | 'rear' | 'trunk'
  /** Natural crash damping before shock upgrades. */
  chassisProtection: number
  per: number
}

export const DELIVERY_PAINTS: readonly PaintDef[] = [
  { id: 'crimson', name: 'DoorSmash Red', hex: '#e63946', cost: 0, kind: k(STEEL, hue(0, 4)) | POLISHED },
  { id: 'pearl', name: 'Bay Pearl', hex: '#e9eef4', cost: 45, kind: k(STEEL, grey(1)) | POLISHED },
  { id: 'mint', name: 'Electric Mint', hex: '#2ec4b6', cost: 65, kind: k(STEEL, hue(10, 4)) | POLISHED },
  { id: 'gold', name: 'SF Taxi Gold', hex: '#f4b41a', cost: 75, kind: k(STEEL, hue(3, 3)) | POLISHED },
  { id: 'cobalt', name: 'Pacific Cobalt', hex: '#2563eb', cost: 85, kind: k(STEEL, hue(16, 4)) | POLISHED },
  { id: 'sakura', name: 'Japantown Pink', hex: '#ec4899', cost: 95, kind: k(STEEL, hue(22, 3)) | POLISHED },
  { id: 'stealth', name: 'Matte Obsidian', hex: '#232833', cost: 110, kind: k(ROOFING, grey(13)) },
]

export const DELIVERY_LIGHTING: readonly LightingDef[] = [
  { id: 'stock', name: 'Factory Lamps', desc: 'Standard DOT headlights & tail lamps', cost: 0 },
  { id: 'topper', name: 'Roof Beacon Sign', desc: 'Illuminated DoorSmash courier beacon', cost: 90, topper: true, ledKind: K.amber },
  { id: 'underglow', name: 'Neon Underglow', desc: 'Cyan street-glow light bars underneath', cost: 140, underglowRgb: [0.15, 0.95, 1.0], ledKind: K.cyanLed },
  { id: 'cyber', name: 'Cyber Courier LED', desc: 'Hot-pink underglow + lit roof beacon', cost: 240, underglowRgb: [1.0, 0.22, 0.68], topper: true, ledKind: K.pinkLed },
]

export const DELIVERY_VEHICLES: readonly DeliveryVehicleDef[] = [
  {
    id: 'scooter',
    name: 'VoltZip E-Scooter',
    tagline: 'Zippy sidewalk & alley shredder · tight handlebar basket',
    category: 'e-scooter',
    cost: 0,
    topKmh: 58,
    baseGrid: [2, 2],
    cargoZone: 'front',
    chassisProtection: 0.75,
    per: 4,
  },
  {
    id: 'moped',
    name: 'FogRunner 150 Moped',
    tagline: 'Classic SF delivery scooter · rear thermal top box',
    category: 'moped',
    cost: 260,
    topKmh: 94,
    baseGrid: [3, 2],
    cargoZone: 'rear',
    chassisProtection: 0.9,
    per: 4,
  },
  {
    id: 'prius',
    name: 'Pious Hybrid',
    tagline: 'San Francisco courier icon · huge hatchback trunk',
    category: 'car',
    cost: 780,
    topKmh: 156,
    baseGrid: [4, 3],
    cargoZone: 'trunk',
    chassisProtection: 1.25,
    per: 4,
  },
  {
    id: 'turbo',
    name: 'Apex Courier RS',
    tagline: 'Widebody rally hatch · maximum cargo & hill pace',
    category: 'car',
    cost: 1850,
    topKmh: 194,
    baseGrid: [5, 3],
    cargoZone: 'trunk',
    chassisProtection: 1.45,
    per: 4,
  },
]

export const PRACTICAL_UPGRADES = {
  cargoRack: {
    name: 'Cargo Rack Expansion',
    desc: '+1 cargo grid column per tier & bigger 3D delivery rack',
    max: 2,
    costs: [110, 260] as const,
  },
  pizzaWarmer: {
    name: 'Thermal Pizza Deck',
    desc: 'Heated flat rack — cuts heat loss 65% & stabilizes flat boxes',
    max: 1,
    costs: [150] as const,
  },
  liquidMount: {
    name: 'Gimbal Liquid Mount',
    desc: 'Spill-proof soup & drink caddy — cuts slosh shock 75%',
    max: 1,
    costs: [175] as const,
  },
  fragileShock: {
    name: 'Fragile Shock Mounts',
    desc: 'Foam cradle & tuned dampers — cuts crash food damage 40% / 70%',
    max: 2,
    costs: [140, 320] as const,
  },
} as const

export function defaultUpgrades(): VehicleUpgrades {
  return { paint: 'crimson', lighting: 'stock', cargoRack: 0, pizzaWarmer: 0, liquidMount: 0, fragileShock: 0 }
}

export function getVehicleDef(id: DeliveryVehicleId): DeliveryVehicleDef {
  return DELIVERY_VEHICLES.find((v) => v.id === id) ?? DELIVERY_VEHICLES[0]
}

export function getPaintDef(id: PaintId): PaintDef {
  return DELIVERY_PAINTS.find((p) => p.id === id) ?? DELIVERY_PAINTS[0]
}

export function getLightingDef(id: LightingId): LightingDef {
  return DELIVERY_LIGHTING.find((l) => l.id === id) ?? DELIVERY_LIGHTING[0]
}

export function cargoGridSizeFor(vehicleId: DeliveryVehicleId, up: VehicleUpgrades): [number, number] {
  const def = getVehicleDef(vehicleId)
  return [def.baseGrid[0] + Math.max(0, Math.min(2, up.cargoRack)), def.baseGrid[1]]
}

interface VoxelGrid {
  W: number
  H: number
  D: number
  s: number
  cells: Uint16Array
  c(m: number): number
  set(x: number, y: number, z: number, v: number): void
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, v: number): void
  wheel(xm: number, ym: number, z0: number, z1: number, r: number, tyre: number, hub: number): void
}

function makeGrid(L: number, H: number, W: number, per: number): VoxelGrid {
  const s = per * 10
  const gx = Math.ceil(L * s), gy = Math.ceil(H * s), gz = Math.ceil(W * s)
  const cells = new Uint16Array(gx * gy * gz)
  const c = (m: number) => Math.round(m * s)
  const set = (x: number, y: number, z: number, v: number) => {
    if (x >= 0 && x < gx && y >= 0 && y < gy && z >= 0 && z < gz) cells[x + gx * (z + gz * y)] = v
  }
  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, v: number) => {
    const X0 = Math.max(0, c(x0)), X1 = Math.min(gx, c(x1))
    const Y0 = Math.max(0, c(y0)), Y1 = Math.min(gy, c(y1))
    const Z0 = Math.max(0, c(z0)), Z1 = Math.min(gz, c(z1))
    for (let y = Y0; y < Y1; y++)
      for (let z = Z0; z < Z1; z++)
        for (let x = X0; x < X1; x++) cells[x + gx * (z + gz * y)] = v
  }
  const wheel = (xm: number, ym: number, z0: number, z1: number, r: number, tyre: number, hub: number) => {
    const cx = xm * s, cy = ym * s, R = r * s, rHub = R * 0.56
    const Z0 = Math.max(0, c(z0)), Z1 = Math.min(gz, c(z1))
    for (let y = Math.floor(cy - R); y <= Math.ceil(cy + R); y++)
      for (let x = Math.floor(cx - R); x <= Math.ceil(cx + R); x++) {
        const d2 = (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2
        if (d2 <= R * R) {
          const v = d2 <= rHub * rHub ? hub : tyre
          for (let z = Z0; z < Z1; z++) set(x, y, z, v)
        }
      }
  }
  return { W: gx, H: gy, D: gz, s, cells, c, set, box, wheel }
}

const clamp = (v: number, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v)
const smooth = (a: number, b: number, v: number) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t) }
const bump = (v: number, at: number, wide: number) => Math.exp(-(((v - at) / wide) ** 2))

function sculptScooter(paint: number, up: VehicleUpgrades): { cells: Uint16Array; size: [number, number, number]; wheels: [number, number]; eye: [number, number, number]; seat: [number, number, number] } {
  const per = 4, L = 1.4, H = 1.24, W = 0.62
  const g = makeGrid(L, H, W, per)
  const cz = W / 2
  const lit = getLightingDef(up.lighting)

  // Front & rear scooter wheels (solid central track, slightly recessed mudguards)
  g.wheel(0.28, 0.14, cz - 0.06, cz + 0.06, 0.14, K.rubber, K.alloy)
  g.wheel(1.12, 0.14, cz - 0.06, cz + 0.06, 0.14, K.rubber, K.alloy)
  // Standing deck + battery housing
  g.box(0.26, 1.04, 0.12, 0.22, cz - 0.14, cz + 0.14, K.dark)
  g.box(0.28, 1.02, 0.20, 0.23, cz - 0.13, cz + 0.13, paint)
  // Rear fender + taillight
  g.box(0.14, 0.36, 0.25, 0.31, cz - 0.07, cz + 0.07, paint)
  g.box(0.12, 0.17, 0.25, 0.31, cz - 0.04, cz + 0.04, K.tail)
  // Slanted steering stem rising from front fork up to handlebars
  for (let i = 0; i <= 26; i++) {
    const t = i / 26
    const xm = 1.12 - t * 0.18
    const ym = 0.20 + t * 0.88
    g.box(xm - 0.035, xm + 0.035, ym - 0.025, ym + 0.035, cz - 0.035, cz + 0.035, t > 0.3 ? paint : K.dark)
  }
  // Wide handlebars, rubber grips, display & front LED headlight
  g.box(0.90, 0.97, 1.06, 1.12, cz - 0.28, cz + 0.28, K.dark)
  g.box(0.90, 0.97, 1.05, 1.13, cz - 0.29, cz - 0.18, K.rubber)
  g.box(0.90, 0.97, 1.05, 1.13, cz + 0.18, cz + 0.29, K.rubber)
  g.box(0.96, 1.03, 0.96, 1.05, cz - 0.06, cz + 0.06, K.head)
  // Handlebar cargo basket / front thermal bag
  g.box(1.00, 1.28, 0.68, 0.96, cz - 0.18, cz + 0.18, K.boxRed)
  g.box(1.03, 1.25, 0.74, 0.97, cz - 0.15, cz + 0.15, 0)
  // Rear cargo rack upgrade adds insulated thermal pack behind the deck!
  if (up.cargoRack > 0) {
    const hBox = up.cargoRack >= 2 ? 0.68 : 0.54
    g.box(0.06, 0.42, 0.28, hBox, cz - 0.20, cz + 0.20, K.boxRed)
    g.box(0.05, 0.43, hBox - 0.06, hBox + 0.02, cz - 0.21, cz + 0.21, K.boxWhite)
  }
  if (up.liquidMount > 0) {
    g.box(0.84, 0.98, 0.82, 0.96, cz + 0.16, cz + 0.26, K.chrome)
  }
  if (lit.underglowRgb && lit.ledKind) {
    g.box(0.32, 0.98, 0.10, 0.13, cz - 0.14, cz - 0.11, lit.ledKind)
    g.box(0.32, 0.98, 0.10, 0.13, cz + 0.11, cz + 0.14, lit.ledKind)
  }
  if (lit.topper) {
    g.box(0.91, 0.97, 1.12, 1.22, cz - 0.10, cz + 0.10, lit.ledKind ?? K.amber)
  }
  return {
    cells: g.cells,
    size: [g.W, g.H, g.D],
    wheels: [0.28, 1.12],
    eye: [0.68, 1.56, cz],
    seat: [0.62, 0.24, cz],
  }
}

function sculptMoped(paint: number, up: VehicleUpgrades): { cells: Uint16Array; size: [number, number, number]; wheels: [number, number]; eye: [number, number, number]; seat: [number, number, number] } {
  const per = 4, L = 2.08, H = 1.38, W = 0.82
  const g = makeGrid(L, H, W, per)
  const cz = W / 2
  const lit = getLightingDef(up.lighting)

  // Wheels
  g.wheel(0.45, 0.24, cz - 0.08, cz + 0.08, 0.24, K.rubber, K.alloy)
  g.wheel(1.62, 0.24, cz - 0.08, cz + 0.08, 0.24, K.rubber, K.alloy)
  // Step-through chassis floorboard & lower pan
  g.box(0.34, 1.54, 0.22, 0.34, cz - 0.24, cz + 0.24, K.dark)
  g.box(0.84, 1.42, 0.33, 0.38, cz - 0.22, cz + 0.22, K.rubber)
  // Rear Vespa-style rounded side cowls
  g.box(0.28, 0.92, 0.30, 0.72, cz - 0.28, cz + 0.28, paint)
  g.box(0.22, 0.30, 0.50, 0.68, cz - 0.14, cz + 0.14, K.tail)
  // Saddle seat
  g.box(0.42, 1.00, 0.72, 0.86, cz - 0.18, cz + 0.18, K.seat)
  // Curved front leg shield & fender
  g.box(1.44, 1.78, 0.38, 0.50, cz - 0.12, cz + 0.12, paint)
  g.box(1.36, 1.62, 0.34, 0.94, cz - 0.26, cz + 0.26, paint)
  g.box(1.34, 1.42, 0.38, 0.90, cz - 0.22, cz + 0.22, K.dark)
  // Headlight nacelle & windshield fairing
  g.box(1.36, 1.58, 0.94, 1.12, cz - 0.14, cz + 0.14, paint)
  g.box(1.56, 1.64, 0.96, 1.10, cz - 0.09, cz + 0.09, K.head)
  g.box(1.46, 1.52, 1.12, 1.32, cz - 0.22, cz + 0.22, K.glass)
  // Handlebars & mirrors
  g.box(1.36, 1.44, 1.00, 1.06, cz - 0.38, cz + 0.38, K.chrome)
  g.box(1.36, 1.44, 0.99, 1.07, cz - 0.40, cz - 0.28, K.rubber)
  g.box(1.36, 1.44, 0.99, 1.07, cz + 0.28, cz + 0.40, K.rubber)
  // Rear metal rack + DoorSmash insulated delivery box (scales up with cargoRack!)
  g.box(0.06, 0.46, 0.72, 0.78, cz - 0.26, cz + 0.26, K.chrome)
  const boxTop = up.cargoRack >= 2 ? 1.34 : up.cargoRack >= 1 ? 1.24 : 1.12
  const boxW = up.cargoRack >= 1 ? 0.32 : 0.25
  g.box(0.04, 0.46, 0.78, boxTop, cz - boxW, cz + boxW, K.boxRed)
  g.box(0.03, 0.47, boxTop - 0.06, boxTop + 0.02, cz - boxW - 0.01, cz + boxW + 0.01, K.boxWhite)
  if (up.pizzaWarmer > 0) {
    // Sleek warm amber thermal indicator strip on the box
    g.box(0.02, 0.05, 0.90, 0.96, cz - 0.16, cz + 0.16, K.amber)
  }
  if (lit.underglowRgb && lit.ledKind) {
    g.box(0.55, 1.40, 0.20, 0.23, cz - 0.24, cz - 0.20, lit.ledKind)
    g.box(0.55, 1.40, 0.20, 0.23, cz + 0.20, cz + 0.24, lit.ledKind)
  }
  if (lit.topper) {
    g.box(0.14, 0.36, boxTop + 0.02, Math.min(H - 0.02, boxTop + 0.14), cz - 0.14, cz + 0.14, lit.ledKind ?? K.amber)
  }
  return {
    cells: g.cells,
    size: [g.W, g.H, g.D],
    wheels: [0.45, 1.62],
    eye: [0.84, 1.50, cz],
    seat: [0.76, 0.56, cz],
  }
}

function sculptHatchback(
  spec: { L: number; H: number; W: number; wheels: [number, number]; priusWedge: boolean; spoiler: boolean },
  paint: number,
  up: VehicleUpgrades,
): { cells: Uint16Array; size: [number, number, number]; wheels: [number, number]; eye: [number, number, number]; seat: [number, number, number] } {
  const per = 4
  const { L, H, W, wheels: [xr, xf], priusWedge, spoiler } = spec
  const lit = getLightingDef(up.lighting)
  const extraH = lit.topper ? 0.22 : (up.cargoRack >= 2 ? 0.18 : 0)
  const totalH = H + extraH
  const S = per * 10
  const w = Math.ceil(L * S), h = Math.ceil(totalH * S), d = Math.ceil(W * S)
  const zc = d / (2 * S), hw = W / 2 - 0.01
  const n = w * h * d
  const solid = new Uint8Array(n)
  const kinds = new Uint16Array(n)
  const wheelY = 0.33, wheelR = 0.33, tyreW = 0.23, archR = wheelR + 0.045, inner = W / 2 - tyreW - 0.09

  const beltY = priusWedge ? 0.78 : 0.76
  const roofPeak = H - 0.03
  const roofProfile = (s: number) => {
    if (s > 0.74) return 0.62 + (beltY - 0.62) * smooth(1.0, 0.74, s)
    if (s > 0.56) {
      const t = (0.74 - s) / 0.18
      return beltY + (roofPeak - beltY) * Math.sin((t * Math.PI) / 2) ** 0.85
    }
    if (s > 0.28) return roofPeak - (priusWedge ? 0.04 * ((0.56 - s) / 0.28) ** 1.3 : 0.015 * ((0.56 - s) / 0.28))
    // Kammback hatchback drop at rear
    const t = clamp((0.28 - s) / 0.28)
    return priusWedge
      ? roofPeak - 0.04 - (roofPeak - 0.92) * t ** 1.35
      : roofPeak - 0.015 - (roofPeak - 0.88) * t ** 1.75
  }

  for (let y = 0; y < h; y++) {
    const Y = (y + 0.5) / S
    if (Y > H + 0.01) continue
    for (let z = 0; z < d; z++) {
      const u = Math.abs((z + 0.5) / S - zc)
      for (let x = 0; x < w; x++) {
        const X = (x + 0.5) / S
        const s = X / L
        const noseEnd = L - 0.02 - 0.18 * (u / hw) ** 2.6 - (Y < 0.28 ? 0.05 : 0)
        const tailEnd = 0.02 + 0.08 * (u / hw) ** 2.4 + (Y < 0.30 ? 0.06 : 0)
        if (X > noseEnd || X < tailEnd) continue
        if ((Math.hypot(X - xr, Y - wheelY) < archR || Math.hypot(X - xf, Y - wheelY) < archR) && u > inner) continue
        let bw = hw - 0.025 + 0.025 * bump(X, xr, 0.5) + 0.025 * bump(X, xf, 0.45)
        if (s > 0.82) bw *= 1 - 0.16 * ((s - 0.82) / 0.18) ** 2
        if (s < 0.08) bw *= 1 - 0.08 * ((0.08 - s) / 0.08) ** 2
        const yb = 0.17 + 0.04 * smooth(0.93, 1, s) + 0.06 * smooth(0.08, 0, s)
        if (Y < yb) continue
        const topY = roofProfile(s) - 0.07 * clamp(u / Math.max(bw, 0.1)) ** 2.4
        const sideW = Y > beltY
          ? bw - 0.06 - 0.22 * clamp((Y - beltY) / Math.max(0.1, roofPeak - beltY)) ** 1.15
          : bw - 0.02 * smooth(0.45, beltY, Y)
        if (u <= sideW && Y <= topY) solid[x + w * (z + d * y)] = 1
      }
    }
  }

  // Hollow shell (2 cells thick) so interior cabin is open for First-Person Seat camera!
  const idx = (x: number, y: number, z: number) => x + w * (z + d * y)
  const isSolid = (x: number, y: number, z: number) => x >= 0 && y >= 0 && z >= 0 && x < w && y < h && z < d && solid[idx(x, y, z)] === 1
  for (let y = 0; y < h; y++) {
    const Y = (y + 0.5) / S
    for (let z = 0; z < d; z++) {
      const u = Math.abs((z + 0.5) / S - zc)
      for (let x = 0; x < w; x++) {
        if (!solid[idx(x, y, z)]) continue
        let skin = false
        for (let dy = -2; dy <= 2 && !skin; dy++)
          for (let dz = -2; dz <= 2 && !skin; dz++)
            for (let dx = -2; dx <= 2 && !skin; dx++)
              if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) <= 2 && !isSolid(x + dx, y + dy, z + dz)) skin = true
        if (!skin) continue
        const X = (x + 0.5) / S
        const s = X / L
        let mat = paint
        // Greenhouse glass (front windshield, side windows, iconic split Prius rear hatch glass with dark spoiler bar)
        const inGlassH = Y > beltY + 0.02 && Y < roofPeak - 0.08
        const sideWin = inGlassH && s > 0.14 && s < 0.72 && u > hw * 0.55 && Math.abs(s - 0.44) > 0.025 && Math.abs(s - 0.24) > 0.022
        const frontWin = inGlassH && s >= 0.57 && s <= 0.76 && u < hw * 0.76
        const splitBar = priusWedge && s <= 0.20 && u < hw * 0.76 && Math.abs(Y - (beltY + 0.16)) <= 0.045
        const rearWin = inGlassH && s <= 0.20 && u < hw * 0.74 && !splitBar
        if (sideWin || frontWin || rearWin) mat = K.glass
        else if (splitBar) mat = K.dark
        // Headlights, front grille, crisp taillights, lower diffuser
        else if (s > 0.92 && Y > 0.44 && Y < 0.62 && u > hw * 0.42 && u < hw * 0.88) mat = K.head
        else if (s > 0.94 && Y > 0.24 && Y < 0.44 && u < hw * 0.46) mat = K.dark
        else if (s < 0.09 && Y > 0.54 && Y < 0.82 && u > hw * 0.44 && u < hw * 0.92) mat = K.tail
        else if (s < 0.06 && Y > 0.38 && Y < 0.52 && u < 0.24) mat = K.plate
        else if (Y < 0.25) mat = K.dark
        kinds[idx(x, y, z)] = mat
      }
    }
  }

  // Interior floor, dash (low enough for crisp seat camera view), seats & steering wheel
  const setBox = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, v: number) => {
    const X0 = Math.max(0, Math.round(x0 * S)), X1 = Math.min(w, Math.round(x1 * S))
    const Y0 = Math.max(0, Math.round(y0 * S)), Y1 = Math.min(h, Math.round(y1 * S))
    const Z0 = Math.max(0, Math.round(z0 * S)), Z1 = Math.min(d, Math.round(z1 * S))
    for (let y = Y0; y < Y1; y++) for (let z = Z0; z < Z1; z++) for (let x = X0; x < X1; x++) kinds[idx(x, y, z)] = v
  }
  setBox(0.35, L - 0.95, 0.22, 0.28, 0.24, W - 0.24, K.dark)
  // Sleek low dashboard cowl + recessed center infotainment bezel + hollow circular driver steering wheel!
  setBox(L * 0.62, L * 0.74, 0.54, 0.71, 0.22, W - 0.22, K.dash)
  // Dark recessed center console & compact infotainment screen (never juts out like a solid bright brick)
  setBox(L * 0.61, L * 0.66, 0.63, 0.76, zc - 0.13, zc + 0.13, K.dark)
  setBox(L * 0.60, L * 0.62, 0.66, 0.73, zc - 0.09, zc + 0.09, K.cyanLed)
  // Steering column + true hollow circular steering wheel rim with spokes at driver z = 0.52
  const swX0 = Math.round(L * 0.555 * S), swX1 = Math.round(L * 0.578 * S)
  const swY = 0.77 * S, swZ = 0.52 * S, swR = 0.145 * S, swIn = 0.105 * S
  setBox(L * 0.57, L * 0.65, 0.73, 0.79, 0.48, 0.56, K.dark)
  for (let y = Math.floor(swY - swR); y <= Math.ceil(swY + swR); y++) {
    for (let z = Math.floor(swZ - swR); z <= Math.ceil(swZ + swR); z++) {
      const dr = Math.hypot(y - swY, z - swZ)
      const isRim = dr >= swIn && dr <= swR
      const isHub = dr <= 0.045 * S
      const isSpoke = dr <= swR && ((Math.abs(y - swY) <= 0.02 * S) || (Math.abs(z - swZ) <= 0.02 * S && y < swY))
      if ((isRim || isHub || isSpoke) && y >= 0 && y < h && z >= 0 && z < d) {
        for (let x = swX0; x <= swX1 && x < w; x++) kinds[idx(x, y, z)] = isHub ? K.alloy : K.rubber
      }
    }
  }
  // Front bucket seats (driver left + passenger right)
  for (const sz of [0.52, W - 0.52]) {
    setBox(L * 0.34, L * 0.50, 0.30, 0.48, sz - 0.22, sz + 0.22, K.seat)
    setBox(L * 0.32, L * 0.38, 0.46, 0.88, sz - 0.20, sz + 0.20, K.seat)
  }
  // Visible thermal cargo deck in trunk area when upgraded
  if (up.cargoRack > 0 || up.pizzaWarmer > 0) {
    setBox(0.28, 1.12, 0.32, 0.66, 0.32, W - 0.32, up.pizzaWarmer > 0 ? K.boxRed : K.dark)
  }
  if (up.cargoRack >= 2) {
    // Roof cargo rails + sleek aerodynamic roof courier pod (seated flush into curved roof)
    setBox(1.15, 2.55, H - 0.06, H + 0.14, zc - 0.42, zc + 0.42, K.dark)
    setBox(1.25, 2.45, H + 0.04, H + 0.13, zc - 0.36, zc + 0.36, K.boxRed)
  }
  if (spoiler) {
    setBox(0.06, 0.28, roofPeak - 0.06, roofPeak + 0.07, 0.20, W - 0.20, K.dark)
  }
  if (lit.topper) {
    // Glowing DoorSmash roof delivery topper sign (seated flush on roof crown)
    setBox(L * 0.38, L * 0.52, H - 0.06, H + 0.18, zc - 0.32, zc + 0.32, lit.ledKind ?? K.amber)
    setBox(L * 0.41, L * 0.49, H + 0.03, H + 0.14, zc - 0.34, zc + 0.34, K.boxRed)
  }
  if (lit.underglowRgb && lit.ledKind) {
    setBox(xr + 0.38, xf - 0.38, 0.17, 0.23, 0.08, 0.16, lit.ledKind)
    setBox(xr + 0.38, xf - 0.38, 0.17, 0.23, W - 0.16, W - 0.08, lit.ledKind)
    setBox(0.05, 0.12, 0.19, 0.24, 0.32, W - 0.32, lit.ledKind)
  }
  // Static tires inside wheel wells (carved automatically by living.ts `carveWheelWells` for animated spinning wheels!)
  const addWheel = (xm: number, z0: number, z1: number) => {
    const cx = xm * S, cy = wheelY * S, R = wheelR * S, rHub = R * 0.58
    const Z0 = Math.max(0, Math.round(z0 * S)), Z1 = Math.min(d, Math.round(z1 * S))
    for (let y = Math.floor(cy - R); y <= Math.ceil(cy + R); y++)
      for (let x = Math.floor(cx - R); x <= Math.ceil(cx + R); x++) {
        const d2 = (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2
        if (d2 <= R * R && x >= 0 && y >= 0 && x < w && y < h) {
          const v = d2 <= rHub * rHub ? K.alloy : K.rubber
          for (let z = Z0; z < Z1; z++) kinds[idx(x, y, z)] = v
        }
      }
  }
  for (const xm of [xr, xf]) {
    addWheel(xm, 0.04, 0.04 + tyreW)
    addWheel(xm, W - 0.04 - tyreW, W - 0.04)
  }

  return {
    cells: kinds,
    size: [w, h, d],
    wheels: [xr, xf],
    eye: [L * 0.44, 1.13, 0.52],
    seat: [L * 0.42, 0.12, 0.52],
  }
}

/** Builds a ready-to-spawn `Making` (minus world `low`) for any DoorSmash fleet vehicle + upgrades. */
export function buildDeliveryVehicle(vehicleId: DeliveryVehicleId, up: VehicleUpgrades): Omit<Making, 'low'> {
  const def = getVehicleDef(vehicleId)
  const paint = getPaintDef(up.paint).kind
  const shockBoost = up.fragileShock * 45

  let sculpted: { cells: Uint16Array; size: [number, number, number]; wheels: [number, number]; eye: [number, number, number]; seat: [number, number, number] }
  let motorParams: { grip: number; power: number; top: number; steer: number; upright: number; tough: number; reach: number; footY: number; awd?: boolean }

  if (vehicleId === 'scooter') {
    sculpted = sculptScooter(paint, up)
    motorParams = { grip: 1.55, power: 118, top: 165, steer: 0.68, upright: 16, tough: 320 + shockBoost, reach: 4.5, footY: 2.2, awd: true }
  } else if (vehicleId === 'moped') {
    sculpted = sculptMoped(paint, up)
    motorParams = { grip: 1.48, power: 122, top: 265, steer: 0.64, upright: 13, tough: 360 + shockBoost, reach: 5.2, footY: 2.8 }
  } else if (vehicleId === 'prius') {
    sculpted = sculptHatchback({ L: 4.46, H: 1.44, W: 1.78, wheels: [0.92, 3.50], priusWedge: true, spoiler: false }, paint, up)
    motorParams = { grip: 1.46, power: 112, top: 435, steer: 0.60, upright: 0, tough: 440 + shockBoost, reach: 5.8, footY: 3.1, awd: true }
  } else {
    sculpted = sculptHatchback({ L: 4.42, H: 1.36, W: 1.90, wheels: [0.92, 3.48], priusWedge: false, spoiler: true }, paint, up)
    motorParams = { grip: 1.42, power: 140, top: 540, steer: 0.62, upright: 0, tough: 510 + shockBoost, reach: 5.8, footY: 3.1, awd: true }
  }

  const body = coarser(sculpted.cells, sculpted.size, def.per)
  const [, , bd] = body.size
  const [xr, xf] = sculpted.wheels.map((x) => x * 10)
  const zInset = bd <= 8 ? 0.5 : 1.0
  const foot = (x: number, z: number, front: boolean): Foot => ({
    at: [x, motorParams.footY, z],
    reach: motorParams.reach,
    steers: front,
    drives: motorParams.awd ? true : !front,
  })
  const motor: Motor = {
    front: 0,
    grip: motorParams.grip,
    power: motorParams.power,
    top: motorParams.top,
    steer: motorParams.steer,
    hover: 0,
    lift: 0,
    upright: motorParams.upright,
    turns: 0,
    jump: 0,
    tough: motorParams.tough,
    feet: [
      foot(xr, zInset, false),
      foot(xr, bd - zInset, false),
      foot(xf, zInset, true),
      foot(xf, bd - zInset, true),
    ],
  }

  const [ex, ey, ez] = sculpted.eye
  const [sx, sy, sz] = sculpted.seat
  return {
    name: def.name,
    cells: Int32Array.from(body.kinds),
    size: body.size,
    controls: 'drive',
    motor,
    seats: [[sx * 10, sy * 10, sz * 10]],
    eye: [ex * 10, ey * 10, ez * 10],
    fine: [{ size: sculpted.size, per: def.per, low: [0, 0, 0], cells: sculpted.cells }],
  }
}

/** Emits dynamic underglow neon pools, roof beacon glow, and double-park hazard flashers into the shared WebGPU local light sink. */
export function emitDeliveryVehicleLights(
  sink: LocalLightSink,
  thing: Thing | null,
  where: { at: [number, number, number]; rot: [number, number, number, number]; front: [number, number, number] } | null,
  up: VehicleUpgrades,
  doubleParked: boolean,
  seconds: number,
): void {
  if (!thing || !thing.alive || !where) return
  const lit = getLightingDef(up.lighting)
  const [ax, ay, az] = where.at
  if (lit.underglowRgb) {
    const [r, g, b] = lit.underglowRgb
    const boost = 0.75 + sink.dark * 0.95
    sink.addPoint(ax, ay - thing.size[1] * 0.32, az, r * 2.4 * boost, g * 2.4 * boost, b * 2.4 * boost, 58, 22, 1.35, 94, LIGHT_CAR)
  }
  if (lit.topper) {
    const boost = 0.55 + sink.dark * 1.0
    const col: [number, number, number] = lit.id === 'cyber' ? [1.0, 0.25, 0.72] : [1.0, 0.62, 0.18]
    sink.addPoint(ax, ay + thing.size[1] * 0.62, az, col[0] * 1.9 * boost, col[1] * 1.9 * boost, col[2] * 1.9 * boost, 42, 16, 0.85, 88, LIGHT_CAR)
  }
  if (doubleParked) {
    // Classic SF double-park 4-way amber hazard blinkers!
    const blink = Math.sin(seconds * 7.8) > 0 ? 1 : 0
    if (blink > 0) {
      const fx = where.front[0], fz = where.front[2]
      const hl = thing.size[0] * 0.52
      sink.addPoint(ax + fx * hl, ay, az + fz * hl, 2.2, 0.92, 0.08, 44, 18, 0.7, 92, LIGHT_CAR)
      sink.addPoint(ax - fx * hl, ay, az - fz * hl, 2.2, 0.92, 0.08, 44, 18, 0.7, 92, LIGHT_CAR)
    }
  }
}
