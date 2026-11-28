// Modular 3D voxel interior building kit & serializable blueprint schema for SF stores and restaurants.
// Designed for non-cookie-cutter procedural generation from real map/brand data AND seamless future
// 1:1 custom interiors (including photo/video-derived layouts and custom image wall panels).
import { faces as facesOf } from './fine.ts'
import type { Born } from './told.ts'
import type { SignStyle } from './storefront-signs.ts'

// Material indices matching engine/core/src/kinds.rs
const CONCRETE = 7, BRICK = 8, PLASTER = 9, WOOD = 10, GLASS = 11, STEEL = 12, LEAVES = 13, ROOFING = 14, LAMP = 15
export const k = (material: number, colour = 0) => material | (colour << 8)
export const hue = (h: number, tone: number) => 16 + (h % 24) * 10 + (tone % 10)
export const grey = (step: number) => 1 + Math.max(0, Math.min(14, step))

export type FloorStyle = 'checker' | 'wood' | 'terrazzo' | 'concrete' | 'tile'

export type ModuleKind =
  | 'counter_wood'
  | 'counter_marble'
  | 'counter_steel'
  | 'counter_tile'
  | 'pizza_oven'
  | 'espresso_bar'
  | 'kitchen_pass'
  | 'pickup_shelf'
  | 'booth_red'
  | 'booth_teal'
  | 'booth_tan'
  | 'table_bistro'
  | 'stool_bar'
  | 'aisle_produce'
  | 'aisle_bakery'
  | 'aisle_dairy'
  | 'aisle_pantry'
  | 'aisle_snacks'
  | 'produce_island'
  | 'fridge_wall'
  | 'checkout_lane'
  | 'planter_indoor'
  | 'wine_rack'
  | 'bakery_case'
  | 'ice_cream_case'
  | 'pendant_lamp'
  | 'lantern_cluster'

export interface InteriorModulePlacement {
  id: string
  kind: ModuleKind
  /** Local room coordinates in metres (x across width [0..W], z depth from front door 0 to back wall D). */
  x: number
  y?: number
  z: number
  /** Rotation in radians about +Y. */
  yaw?: number
  /** Optional collision AABB half-extents [hx, hz] in metres (auto-derived if omitted). */
  collider?: [number, number]
}

export interface InteriorSignPlacement {
  id: string
  title: string
  subtitle?: string
  category: string
  /** Local room position in metres. */
  x: number
  y: number
  z: number
  /** Width and height in metres. */
  widthM: number
  heightM: number
  /** Facing yaw in radians (0 faces -z toward front door, PI faces +z, etc.). */
  yaw: number
  both?: boolean
  style: SignStyle
  /** Optional future photo/video texture URL for 1:1 custom interiors. */
  imageUrl?: string
}

export interface InteriorNpcPlacement {
  id: string
  role: 'worker' | 'patron_sit' | 'patron_stand' | 'shopper' | 'delivery_driver'
  x: number
  z: number
  yaw: number
  seed: number
  label?: string
  says?: string
  apronColor?: string
  packColor?: string
}

export interface ShoppingAisleZone {
  id: string
  aisleNumber: number
  aisleName: string
  category: 'produce' | 'bakery' | 'dairy' | 'pantry' | 'snacks'
  /** Interactive pickup point in local room metres. */
  x: number
  z: number
  /** Candidate item names found in this aisle. */
  items: string[]
}

export interface InteriorCustomVoxel {
  x0: number; x1: number; y0: number; y1: number; z0: number; z1: number
  kind: number
}

/**
 * Serializable blueprint describing any store or restaurant interior.
 * Works identically for procedural data-driven interiors AND hand-crafted or photo/video 1:1 overrides.
 */
export interface InteriorBlueprint {
  id: string
  version: 1
  source: 'procedural' | 'custom-1to1' | 'photo-scan'
  archetype: string
  name: string
  category: string
  brandId?: string | null
  room: { widthM: number; depthM: number; heightM: number }
  theme: {
    floor: FloorStyle
    wallKind: number
    wainscotKind: number
    floorKindA: number
    floorKindB: number
    ceilingKind: number
    accentKind: number
    trimKind: number
    lightColor: [number, number, number]
    lightIntensity: number
  }
  modules: InteriorModulePlacement[]
  signs: InteriorSignPlacement[]
  npcs: InteriorNpcPlacement[]
  shoppingZones: ShoppingAisleZone[]
  /** Local metres [x, z] of the restaurant pickup counter or supermarket checkout. */
  pickupPoint: [number, number]
  /** Local metres [x, z] inside the front entrance door. */
  exitPoint: [number, number]
  /** Optional raw voxel boxes for 1:1 bespoke architecture or photo-scanned rooms. */
  customVoxels?: InteriorCustomVoxel[]
}

export interface ModuleAsset {
  born: Born
  cell: number
  halfX: number
  halfZ: number
  solid: boolean
}

interface Grid {
  W: number; H: number; D: number; s: number; per: number
  cells: Uint16Array
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, v: number): void
  cylY(xm: number, zm: number, y0: number, y1: number, r: number, v: number): void
}

function makeGrid(L: number, H: number, D: number, per = 2): Grid {
  const s = per * 10
  const W = Math.max(1, Math.ceil(L * s))
  const gH = Math.max(1, Math.ceil(H * s))
  const gD = Math.max(1, Math.ceil(D * s))
  const cells = new Uint16Array(W * gH * gD)
  const c = (m: number) => Math.round(m * s)
  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, v: number) => {
    const X0 = Math.max(0, c(x0)), X1 = Math.min(W, c(x1))
    const Y0 = Math.max(0, c(y0)), Y1 = Math.min(gH, c(y1))
    const Z0 = Math.max(0, c(z0)), Z1 = Math.min(gD, c(z1))
    for (let y = Y0; y < Y1; y++)
      for (let z = Z0; z < Z1; z++)
        for (let x = X0; x < X1; x++) cells[x + W * (z + gD * y)] = v
  }
  const cylY = (xm: number, zm: number, y0: number, y1: number, r: number, v: number) => {
    const cx = xm * s, cz = zm * s, R = r * s
    const Y0 = Math.max(0, c(y0)), Y1 = Math.min(gH, c(y1))
    for (let y = Y0; y < Y1; y++)
      for (let z = Math.floor(cz - R); z <= Math.ceil(cz + R); z++)
        for (let x = Math.floor(cx - R); x <= Math.ceil(cx + R); x++)
          if (x >= 0 && x < W && z >= 0 && z < gD && (x + 0.5 - cx) ** 2 + (z + 0.5 - cz) ** 2 <= R * R) {
            cells[x + W * (z + gD * y)] = v
          }
  }
  return { W, H: gH, D: gD, s, per, cells, box, cylY }
}

function finishModule(g: Grid, lengthM: number, depthM: number, solid = true): ModuleAsset {
  let filled = 0
  for (let i = 0; i < g.cells.length; i++) if (g.cells[i]) filled++
  return {
    born: {
      id: 0,
      cells: filled,
      size: [g.W, g.H, g.D],
      com: [g.W / 2, 0, g.D / 2],
      low: [0, 0, 0],
      faces: facesOf(g.cells, [g.W, g.H, g.D]),
    },
    cell: 1 / g.per,
    halfX: lengthM * 0.5,
    halfZ: depthM * 0.5,
    solid,
  }
}

const OAK = k(WOOD, hue(3, 4))
const WALNUT = k(WOOD, hue(2, 7))
const CEDAR = k(WOOD, hue(2, 5))
const MARBLE = k(PLASTER, grey(1))
const SLATE = k(CONCRETE, grey(11))
const STEEL_BRT = k(STEEL, grey(4))
const IRON = k(STEEL, grey(13))
const BRICK_WARM = k(BRICK, hue(1, 5))
const BRICK_DARK = k(BRICK, hue(0, 7))
const GLASS_CLR = k(GLASS, grey(10))
const EMBER = k(LAMP, hue(2, 4))
const WARM_LAMP = k(LAMP, hue(3, 1))
const COOL_LAMP = k(LAMP, hue(14, 1))
const RED_VINYL = k(PLASTER, hue(0, 5))
const TEAL_VINYL = k(PLASTER, hue(12, 5))
const TAN_VINYL = k(PLASTER, hue(3, 5))
const LEAF = k(LEAVES, hue(9, 5))
const LEAF_BRT = k(LEAVES, hue(8, 3))
const PACK_CORAL = k(PLASTER, hue(0, 4))
const PACK_GOLD = k(PLASTER, hue(4, 2))
const PACK_BLUE = k(PLASTER, hue(16, 4))
const PACK_GREEN = k(PLASTER, hue(9, 4))
const PACK_CREAM = k(PLASTER, hue(3, 1))
const PACK_PURPLE = k(PLASTER, hue(20, 4))

let cachedModules: Record<ModuleKind, ModuleAsset> | null = null

function buildCounter(frontMat: number, topMat: number): ModuleAsset {
  const g = makeGrid(2.6, 1.05, 0.85, 2)
  g.box(0, 2.6, 0, 0.94, 0.08, 0.80, frontMat)
  g.box(0, 2.6, 0.94, 1.04, 0, 0.85, topMat)
  // Register POS screen on top
  g.box(1.75, 2.15, 1.04, 1.05, 0.25, 0.55, IRON)
  return finishModule(g, 2.6, 0.85)
}

function buildBooth(seatMat: number): ModuleAsset {
  const g = makeGrid(1.7, 1.12, 1.9, 2)
  // Two opposing vinyl benches
  for (const z0 of [0.05, 1.38]) {
    g.box(0.05, 1.65, 0.0, 0.45, z0, z0 + 0.47, seatMat)
    const bz = z0 < 0.5 ? z0 : z0 + 0.34
    g.box(0.05, 1.65, 0.45, 1.08, bz, bz + 0.13, seatMat)
  }
  // Center pedestal table
  g.box(0.75, 0.95, 0, 0.72, 0.85, 1.05, IRON)
  g.box(0.15, 1.55, 0.72, 0.78, 0.58, 1.32, MARBLE)
  return finishModule(g, 1.7, 1.9)
}

function buildAisle(palette: readonly number[]): ModuleAsset {
  const g = makeGrid(3.2, 2.05, 0.95, 2)
  // Gondola metal spine + base + 4 double-sided shelves
  g.box(0.05, 3.15, 0, 0.16, 0.05, 0.90, SLATE)
  g.box(0.05, 3.15, 0.16, 2.00, 0.43, 0.52, STEEL_BRT)
  for (const y of [0.55, 1.00, 1.45, 1.88]) {
    g.box(0.05, 3.15, y, y + 0.06, 0.08, 0.87, STEEL_BRT)
  }
  // Stock colorful voxel groceries along both sides!
  const shelfYs = [0.18, 0.62, 1.07, 1.52]
  for (let r = 0; r < shelfYs.length; r++) {
    const sy = shelfYs[r]
    for (let i = 0; i < 10; i++) {
      const x0 = 0.12 + i * 0.30
      const cA = palette[(i + r * 3) % palette.length]
      const cB = palette[(i * 2 + r + 1) % palette.length]
      const hA = 0.22 + ((i + r) % 3) * 0.05
      const hB = 0.20 + ((i + r + 1) % 3) * 0.05
      g.box(x0, x0 + 0.22, sy, sy + hA, 0.12, 0.40, cA)
      g.box(x0, x0 + 0.22, sy, sy + hB, 0.55, 0.83, cB)
    }
  }
  return finishModule(g, 3.2, 0.95)
}

export function getInteriorModuleKit(): Record<ModuleKind, ModuleAsset> {
  if (cachedModules) return cachedModules

  const pizza_oven = (() => {
    const g = makeGrid(2.2, 2.35, 1.9, 2)
    // Brick hearth base
    g.box(0.1, 2.1, 0, 0.95, 0.1, 1.8, BRICK_WARM)
    g.box(0.05, 2.15, 0.95, 1.05, 0.05, 1.85, SLATE)
    // Domed brick oven body
    g.cylY(1.1, 0.98, 1.05, 1.65, 0.88, BRICK_WARM)
    g.cylY(1.1, 0.98, 1.65, 1.98, 0.68, BRICK_DARK)
    // Chimney flue
    g.cylY(1.1, 0.98, 1.95, 2.35, 0.24, IRON)
    // Dark fire mouth + glowing embers inside!
    g.box(0.70, 1.50, 1.06, 1.52, 0.05, 0.60, IRON)
    g.box(0.76, 1.44, 1.07, 1.24, 0.25, 0.65, EMBER)
    // Stacked firewood logs underneath
    g.box(0.45, 1.75, 0.08, 0.55, 0.12, 0.65, CEDAR)
    return finishModule(g, 2.2, 1.9)
  })()

  const espresso_bar = (() => {
    const g = makeGrid(2.4, 1.55, 0.85, 2)
    g.box(0, 2.4, 0, 0.92, 0.08, 0.80, WALNUT)
    g.box(0, 2.4, 0.92, 1.00, 0, 0.85, MARBLE)
    // Chrome espresso machine + portafilters + cup warmer
    g.box(0.25, 1.15, 1.00, 1.48, 0.18, 0.72, STEEL_BRT)
    g.box(0.35, 1.05, 1.06, 1.28, 0.12, 0.22, IRON)
    g.box(0.32, 1.08, 1.48, 1.55, 0.24, 0.64, PACK_CREAM)
    // Glass pastry display case on the right
    g.box(1.35, 2.25, 1.00, 1.45, 0.12, 0.74, GLASS_CLR)
    g.box(1.42, 2.18, 1.04, 1.18, 0.22, 0.64, PACK_GOLD)
    return finishModule(g, 2.4, 0.85)
  })()

  const kitchen_pass = (() => {
    const g = makeGrid(2.8, 2.15, 0.85, 2)
    g.box(0, 2.8, 0, 0.95, 0.08, 0.82, STEEL_BRT)
    g.box(0, 2.8, 0.95, 1.02, 0, 0.85, MARBLE)
    // Overhead stainless pass shelf + glowing orange heat lamps!
    g.box(0.08, 0.18, 1.00, 1.85, 0.35, 0.50, IRON)
    g.box(2.62, 2.72, 1.00, 1.85, 0.35, 0.50, IRON)
    g.box(0.05, 2.75, 1.82, 1.94, 0.20, 0.68, STEEL_BRT)
    for (const lx of [0.65, 1.40, 2.15]) g.box(lx - 0.12, lx + 0.12, 1.72, 1.82, 0.34, 0.54, EMBER)
    // Waiting takeout bags & pizza boxes under heat lamps
    g.box(0.38, 0.88, 1.02, 1.14, 0.18, 0.68, PACK_CREAM)
    g.box(0.38, 0.88, 1.15, 1.26, 0.18, 0.68, PACK_CREAM)
    g.box(1.25, 1.60, 1.02, 1.38, 0.24, 0.58, CEDAR)
    g.box(1.92, 2.30, 1.02, 1.34, 0.24, 0.58, PACK_CORAL)
    return finishModule(g, 2.8, 0.85)
  })()

  const pickup_shelf = (() => {
    const g = makeGrid(1.6, 1.95, 0.65, 2)
    // Industrial black steel DoorSmash pickup rack
    for (const x of [0.04, 1.48]) for (const z of [0.04, 0.54]) g.box(x, x + 0.08, 0, 1.92, z, z + 0.08, IRON)
    for (const y of [0.22, 0.72, 1.22, 1.72]) g.box(0.04, 1.56, y, y + 0.06, 0.04, 0.62, OAK)
    // Branded red top strip + takeout bags waiting on shelves
    g.box(0.04, 1.56, 1.78, 1.94, 0.04, 0.14, PACK_CORAL)
    g.box(0.20, 0.58, 0.78, 1.14, 0.14, 0.50, CEDAR)
    g.box(0.74, 1.26, 0.78, 0.90, 0.12, 0.54, PACK_CREAM)
    g.box(0.32, 0.72, 1.28, 1.62, 0.14, 0.50, PACK_CORAL)
    g.box(0.95, 1.32, 1.28, 1.56, 0.16, 0.48, PACK_GOLD)
    return finishModule(g, 1.6, 0.65)
  })()

  const table_bistro = (() => {
    const g = makeGrid(1.5, 0.92, 1.1, 2)
    g.cylY(0.75, 0.55, 0, 0.72, 0.07, IRON)
    g.cylY(0.75, 0.55, 0.72, 0.78, 0.42, MARBLE)
    // Two bistro chairs
    for (const cx of [0.16, 1.34]) {
      g.box(cx - 0.16, cx + 0.16, 0, 0.45, 0.36, 0.74, OAK)
      const bx = cx < 0.5 ? cx - 0.16 : cx + 0.10
      g.box(bx, bx + 0.06, 0.45, 0.90, 0.36, 0.74, OAK)
    }
    return finishModule(g, 1.5, 1.1)
  })()

  const stool_bar = (() => {
    const g = makeGrid(2.4, 1.08, 0.85, 2)
    g.box(0, 2.4, 0.98, 1.06, 0.05, 0.45, OAK)
    for (const x of [0.12, 2.20]) g.box(x, x + 0.08, 0, 0.98, 0.12, 0.38, IRON)
    for (const sx of [0.45, 1.20, 1.95]) {
      g.cylY(sx, 0.66, 0, 0.68, 0.05, IRON)
      g.cylY(sx, 0.66, 0.68, 0.75, 0.17, TAN_VINYL)
    }
    return finishModule(g, 2.4, 0.85)
  })()

  const produce_island = (() => {
    const g = makeGrid(2.6, 1.25, 1.45, 2)
    g.box(0.08, 2.52, 0, 0.78, 0.08, 1.37, CEDAR)
    // Heaped fresh fruit & greens crates
    g.box(0.18, 0.88, 0.78, 1.08, 0.18, 1.26, PACK_CORAL)
    g.box(0.94, 1.66, 0.78, 1.12, 0.18, 1.26, LEAF_BRT)
    g.box(1.72, 2.42, 0.78, 1.08, 0.18, 1.26, PACK_GOLD)
    return finishModule(g, 2.6, 1.45)
  })()

  const fridge_wall = (() => {
    const g = makeGrid(3.0, 2.25, 0.85, 2)
    g.box(0, 3.0, 0, 2.25, 0.12, 0.85, SLATE)
    g.box(0.12, 2.88, 0.25, 2.05, 0.18, 0.78, COOL_LAMP)
    // Bright milk jugs & beverages inside glass doors
    for (const y of [0.35, 0.85, 1.35]) {
      for (let i = 0; i < 8; i++) {
        const x = 0.22 + i * 0.32
        g.box(x, x + 0.22, y, y + 0.34, 0.26, 0.68, i % 3 === 0 ? PACK_CREAM : i % 3 === 1 ? PACK_BLUE : PACK_GREEN)
      }
    }
    // Glass doors & vertical mullions
    g.box(0.08, 2.92, 0.22, 2.08, 0.06, 0.14, GLASS_CLR)
    for (const x of [0.05, 1.00, 1.95, 2.90]) g.box(x, x + 0.08, 0.18, 2.12, 0.04, 0.16, IRON)
    return finishModule(g, 3.0, 0.85)
  })()

  const checkout_lane = (() => {
    const g = makeGrid(2.5, 1.25, 1.15, 2)
    g.box(0.08, 2.42, 0, 0.88, 0.10, 0.78, SLATE)
    // Dark conveyor belt + illuminated checkout scanner + POS display
    g.box(0.15, 1.60, 0.88, 0.94, 0.18, 0.68, IRON)
    g.box(1.68, 1.92, 0.88, 0.95, 0.28, 0.56, COOL_LAMP)
    g.box(1.78, 2.22, 0.94, 1.22, 0.14, 0.30, IRON)
    return finishModule(g, 2.5, 1.15)
  })()

  const planter_indoor = (() => {
    const g = makeGrid(0.85, 1.65, 0.85, 2)
    g.box(0.12, 0.73, 0, 0.56, 0.12, 0.73, BRICK_WARM)
    g.cylY(0.42, 0.42, 0.54, 1.15, 0.07, WALNUT)
    g.cylY(0.42, 0.42, 0.92, 1.58, 0.34, LEAF)
    g.cylY(0.42, 0.42, 1.25, 1.65, 0.22, LEAF_BRT)
    return finishModule(g, 0.85, 0.85)
  })()

  const wine_rack = (() => {
    const g = makeGrid(1.6, 2.15, 0.50, 2)
    g.box(0, 1.6, 0, 2.15, 0.05, 0.48, WALNUT)
    for (const y of [0.32, 0.78, 1.24, 1.70]) {
      for (let i = 0; i < 6; i++) {
        g.box(0.14 + i * 0.23, 0.28 + i * 0.23, y, y + 0.34, 0.08, 0.36, i % 2 ? PACK_GREEN : BRICK_DARK)
      }
    }
    return finishModule(g, 1.6, 0.50)
  })()

  const bakery_case = (() => {
    const g = makeGrid(2.2, 1.38, 0.90, 2)
    g.box(0, 2.2, 0, 0.76, 0.05, 0.85, OAK)
    g.box(0.05, 2.15, 0.76, 1.36, 0.08, 0.82, GLASS_CLR)
    g.box(0.16, 2.04, 0.80, 0.96, 0.20, 0.72, PACK_GOLD)
    g.box(0.16, 2.04, 1.06, 1.20, 0.24, 0.70, CEDAR)
    return finishModule(g, 2.2, 0.90)
  })()

  const ice_cream_case = (() => {
    const g = makeGrid(2.2, 1.32, 0.92, 2)
    g.box(0, 2.2, 0, 0.78, 0.05, 0.88, MARBLE)
    g.box(0.06, 2.14, 0.78, 1.28, 0.08, 0.84, GLASS_CLR)
    const tubs = [PACK_CORAL, PACK_CREAM, PACK_GREEN, PACK_PURPLE, PACK_GOLD, PACK_BLUE]
    for (let i = 0; i < 6; i++) {
      g.box(0.16 + i * 0.32, 0.42 + i * 0.32, 0.80, 0.98, 0.22, 0.70, tubs[i])
    }
    return finishModule(g, 2.2, 0.92)
  })()

  const pendant_lamp = (() => {
    const g = makeGrid(0.55, 0.85, 0.55, 2)
    g.cylY(0.275, 0.275, 0.32, 0.85, 0.03, IRON)
    g.cylY(0.275, 0.275, 0.14, 0.34, 0.22, IRON)
    g.cylY(0.275, 0.275, 0.04, 0.18, 0.14, WARM_LAMP)
    return finishModule(g, 0.55, 0.55, false)
  })()

  const lantern_cluster = (() => {
    const g = makeGrid(0.75, 0.95, 0.75, 2)
    g.cylY(0.375, 0.375, 0.48, 0.95, 0.025, IRON)
    g.cylY(0.375, 0.375, 0.08, 0.52, 0.24, EMBER)
    g.cylY(0.375, 0.375, 0.50, 0.56, 0.14, IRON)
    g.cylY(0.375, 0.375, 0.04, 0.10, 0.14, IRON)
    return finishModule(g, 0.75, 0.75, false)
  })()

  cachedModules = {
    counter_wood: buildCounter(WALNUT, MARBLE),
    counter_marble: buildCounter(MARBLE, SLATE),
    counter_steel: buildCounter(STEEL_BRT, STEEL_BRT),
    counter_tile: buildCounter(BRICK_WARM, OAK),
    pizza_oven,
    espresso_bar,
    kitchen_pass,
    pickup_shelf,
    booth_red: buildBooth(RED_VINYL),
    booth_teal: buildBooth(TEAL_VINYL),
    booth_tan: buildBooth(TAN_VINYL),
    table_bistro,
    stool_bar,
    aisle_produce: buildAisle([PACK_GREEN, LEAF_BRT, PACK_GOLD, PACK_CORAL]),
    aisle_bakery: buildAisle([PACK_GOLD, CEDAR, PACK_CREAM, OAK]),
    aisle_dairy: buildAisle([PACK_CREAM, PACK_BLUE, PACK_GOLD, MARBLE]),
    aisle_pantry: buildAisle([PACK_CORAL, PACK_GOLD, PACK_BLUE, PACK_PURPLE, PACK_CREAM]),
    aisle_snacks: buildAisle([PACK_CORAL, PACK_PURPLE, PACK_GOLD, PACK_GREEN]),
    produce_island,
    fridge_wall,
    checkout_lane,
    planter_indoor,
    wine_rack,
    bakery_case,
    ice_cream_case,
    pendant_lamp,
    lantern_cluster,
  }
  return cachedModules
}

/** Builds a 3D rolling supermarket shopping cart whose basket fills visually as items are collected! */
export function buildShoppingCartAsset(itemCount: number): ModuleAsset {
  const g = makeGrid(0.95, 1.05, 0.62, 2)
  // Four corner caster wheels + lower tubular frame
  for (const x of [0.14, 0.80]) for (const z of [0.10, 0.52]) g.box(x - 0.04, x + 0.04, 0, 0.10, z - 0.03, z + 0.03, IRON)
  g.box(0.10, 0.84, 0.10, 0.16, 0.08, 0.54, STEEL_BRT)
  // Upright rear handle frame + red push bar
  for (const z of [0.08, 0.50]) g.box(0.08, 0.14, 0.14, 1.00, z, z + 0.05, STEEL_BRT)
  g.box(0.06, 0.15, 0.94, 1.02, 0.06, 0.56, PACK_CORAL)
  // Wire basket walls
  g.box(0.14, 0.88, 0.42, 0.48, 0.06, 0.56, STEEL_BRT)
  for (const z of [0.06, 0.52]) g.box(0.14, 0.88, 0.48, 0.86, z, z + 0.04, STEEL_BRT)
  g.box(0.84, 0.88, 0.48, 0.86, 0.06, 0.56, STEEL_BRT)
  g.box(0.14, 0.18, 0.48, 0.86, 0.06, 0.56, STEEL_BRT)
  // Grocery packages visually stacked inside the basket!
  const cols = [PACK_GREEN, PACK_GOLD, PACK_CREAM, PACK_CORAL, PACK_BLUE, PACK_PURPLE]
  for (let i = 0; i < Math.min(6, itemCount); i++) {
    const col = i % 3
    const row = Math.floor(i / 3)
    const x0 = 0.20 + col * 0.21
    const z0 = 0.12 + row * 0.19
    g.box(x0, x0 + 0.18, 0.48, 0.72 + (i % 2) * 0.10, z0, z0 + 0.16, cols[i % cols.length])
  }
  return finishModule(g, 0.95, 0.62, false)
}

/** Builds the complete enclosing 3D voxel room shell (floor, patterned tile/wood, walls, storefront glass door, ceiling beams, and optional custom 1:1 voxels). */
export function buildRoomShellAsset(bp: InteriorBlueprint): { born: Born; cell: number } {
  // 10 cm voxel resolution (per = 1) keeps large 16x16x4 m supermarkets ultra fast (<5 ms) while modules are crisp 5 cm!
  const per = 1
  const s = 10
  const W = Math.max(40, Math.round(bp.room.widthM * s))
  const H = Math.max(30, Math.round(bp.room.heightM * s))
  const D = Math.max(50, Math.round(bp.room.depthM * s))
  const cells = new Uint16Array(W * H * D)
  const set = (x: number, y: number, z: number, v: number) => {
    if (x >= 0 && x < W && y >= 0 && y < H && z >= 0 && z < D) cells[x + W * (z + D * y)] = v
  }
  const { floor, wallKind, wainscotKind, floorKindA, floorKindB, ceilingKind, accentKind, trimKind } = bp.theme

  // 1. Patterned floor (y = 0..1)
  for (let z = 0; z < D; z++) {
    for (let x = 0; x < W; x++) {
      let f = floorKindA
      if (floor === 'checker') f = (((x >> 2) + (z >> 2)) & 1) === 0 ? floorKindA : floorKindB
      else if (floor === 'wood') f = ((x >> 1) & 1) === 0 && ((z + (x * 3)) % 14) !== 0 ? floorKindA : floorKindB
      else if (floor === 'terrazzo') f = ((x * 7 + z * 13) % 11 === 0) ? floorKindB : floorKindA
      else if (floor === 'tile') f = (x % 6 === 0 || z % 6 === 0) ? floorKindB : floorKindA
      set(x, 0, z, f)
    }
  }

  // 2. Ceiling + architectural beams + recessed lighting coves (y = H - 2 .. H - 1)
  for (let z = 0; z < D; z++) {
    for (let x = 0; x < W; x++) {
      set(x, H - 1, z, ceilingKind)
      if (z % 26 === 0 || z % 26 === 1) set(x, H - 2, z, trimKind)
      if ((x === Math.floor(W * 0.3) || x === Math.floor(W * 0.7)) && z > 8 && z < D - 8 && (z % 18) < 6) {
        set(x, H - 2, z, WARM_LAMP)
      }
    }
  }

  // 3. Left, Right & Back walls with wainscoting + accent stripe
  const wainH = Math.min(11, Math.floor(H * 0.30))
  for (let y = 1; y < H - 1; y++) {
    const isStripe = y === wainH || y === H - 4
    const mat = isStripe ? accentKind : y < wainH ? wainscotKind : wallKind
    for (let z = 0; z < D; z++) {
      set(0, y, z, mat)
      set(W - 1, y, z, mat)
    }
    for (let x = 0; x < W; x++) {
      set(x, y, D - 1, mat)
    }
  }

  // 4. Front Storefront Wall (z = 0): crisp glass windows + framed double entry door at exitPoint!
  const doorCX = Math.round(bp.exitPoint[0] * s)
  const doorHalfW = 9 // 1.8 m wide entrance
  const doorH = 23 // 2.3 m tall doorway
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const inDoor = Math.abs(x - doorCX) <= doorHalfW && y <= doorH
      const onDoorFrame = (Math.abs(x - doorCX) === doorHalfW && y <= doorH + 1) || (Math.abs(x - doorCX) <= doorHalfW && y === doorH + 1)
      const inWindow = !inDoor && y >= 7 && y <= doorH && x > 4 && x < W - 5 && Math.abs(x - doorCX) > doorHalfW + 2
      if (onDoorFrame) set(x, y, 0, trimKind)
      else if (inDoor) set(x, y, 0, Math.abs(x - doorCX) === 0 ? trimKind : GLASS_CLR)
      else if (inWindow) set(x, y, 0, (x % 16 === 0) ? trimKind : GLASS_CLR)
      else set(x, y, 0, y < 7 ? wainscotKind : accentKind)
    }
  }

  // 5. Optional custom 1:1 raw voxel geometry from custom overrides / future photo-scans!
  if (bp.customVoxels?.length) {
    for (const v of bp.customVoxels) {
      const X0 = Math.max(1, Math.round(v.x0 * s)), X1 = Math.min(W - 1, Math.round(v.x1 * s))
      const Y0 = Math.max(1, Math.round(v.y0 * s)), Y1 = Math.min(H - 1, Math.round(v.y1 * s))
      const Z0 = Math.max(1, Math.round(v.z0 * s)), Z1 = Math.min(D - 1, Math.round(v.z1 * s))
      for (let y = Y0; y < Y1; y++)
        for (let z = Z0; z < Z1; z++)
          for (let x = X0; x < X1; x++) set(x, y, z, v.kind)
    }
  }

  let filled = 0
  for (let i = 0; i < cells.length; i++) if (cells[i]) filled++
  return {
    born: {
      id: 0,
      cells: filled,
      size: [W, H, D],
      com: [0, 0, 0],
      low: [0, 0, 0],
      faces: facesOf(cells, [W, H, D]),
    },
    cell: 1 / per,
  }
}
