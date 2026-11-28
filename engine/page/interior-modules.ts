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
  /** Interactive pickup standing point in local room metres. */
  x: number
  z: number
  /** Exact 3D shelf/cooler display point [x, y, z] in local room metres where the item & target marker sit. */
  shelfAt?: [number, number, number]
  /** Facing yaw in radians for a shelf-front item tag sign. */
  shelfYaw?: number
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
  ellipsoid(xm: number, ym: number, zm: number, rx: number, ry: number, rz: number, v: number): void
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
  const ellipsoid = (xm: number, ym: number, zm: number, rx: number, ry: number, rz: number, v: number) => {
    const cx = xm * s, cy = ym * s, cz = zm * s
    const RX = Math.max(0.5, rx * s), RY = Math.max(0.5, ry * s), RZ = Math.max(0.5, rz * s)
    const X0 = Math.max(0, Math.floor(cx - RX)), X1 = Math.min(W - 1, Math.ceil(cx + RX))
    const Y0 = Math.max(0, Math.floor(cy - RY)), Y1 = Math.min(gH - 1, Math.ceil(cy + RY))
    const Z0 = Math.max(0, Math.floor(cz - RZ)), Z1 = Math.min(gD - 1, Math.ceil(cz + RZ))
    for (let y = Y0; y <= Y1; y++) {
      const dy = (y + 0.5 - cy) / RY
      for (let z = Z0; z <= Z1; z++) {
        const dz = (z + 0.5 - cz) / RZ
        const r2 = dy * dy + dz * dz
        if (r2 > 1) continue
        for (let x = X0; x <= X1; x++) {
          const dx = (x + 0.5 - cx) / RX
          if (dx * dx + r2 <= 1) cells[x + W * (z + gD * y)] = v
        }
      }
    }
  }
  return { W, H: gH, D: gD, s, per, cells, box, cylY, ellipsoid }
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
const PACK_RED_DEEP = k(PLASTER, hue(0, 6))
const PACK_ORANGE = k(PLASTER, hue(2, 4))
const PACK_GOLD = k(PLASTER, hue(4, 2))
const PACK_YELLOW = k(PLASTER, hue(4, 4))
const PACK_LIME = k(PLASTER, hue(7, 4))
const PACK_BLUE = k(PLASTER, hue(16, 4))
const PACK_CYAN = k(PLASTER, hue(13, 3))
const PACK_GREEN = k(PLASTER, hue(9, 4))
const PACK_AVOCADO = k(LEAVES, hue(8, 6))
const PACK_CREAM = k(PLASTER, hue(3, 1))
const PACK_EGG_TAN = k(PLASTER, hue(3, 7))
const PACK_BREAD = k(WOOD, hue(3, 3))
const PACK_CRUST = k(WOOD, hue(2, 5))
const PACK_CHOC = k(WOOD, hue(1, 9))
const PACK_PURPLE = k(PLASTER, hue(20, 4))
const PACK_PINK = k(PLASTER, hue(22, 4))
const LAMP_PINK = k(LAMP, hue(22, 4))
const LAMP_EMERALD = k(LAMP, hue(9, 3))
const PRICE_RAIL = k(PLASTER, grey(2))

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

/** Helper: supermarket metal gondola frame with charcoal toe-kick, bright backing, and white price-rail shelf edges. */
function gondolaBase(g: Grid, shelfYs: readonly number[], backMat = MARBLE): void {
  g.box(0.04, 3.16, 0, 0.16, 0.04, 0.91, SLATE)
  g.box(0.04, 3.16, 0.16, 1.98, 0.43, 0.52, backMat)
  // Top cap molding
  g.box(0.04, 3.16, 1.96, 2.02, 0.36, 0.59, IRON)
  for (const y of shelfYs) {
    g.box(0.05, 3.15, y, y + 0.05, 0.07, 0.88, STEEL_BRT)
    // Crisp white price-strip rails along both front shelf edges
    g.box(0.06, 3.14, y, y + 0.05, 0.05, 0.08, PRICE_RAIL)
    g.box(0.06, 3.14, y, y + 0.05, 0.87, 0.90, PRICE_RAIL)
  }
}

/** Aisle 1 — Fresh Produce Farm-Stand: cedar wood tiered bins, dark-green canopy trim, rounded avocados, apples, bananas & greens. */
function buildProduceAisle(): ModuleAsset {
  const g = makeGrid(3.2, 2.05, 1.12, 2)
  // Timber farm-stand base & slanted produce deck
  g.box(0.06, 3.14, 0, 0.72, 0.08, 1.04, CEDAR)
  g.box(0.06, 3.14, 0.72, 1.28, 0.32, 0.80, OAK)
  // Corner wooden market posts + green produce canopy valence
  for (const x of [0.10, 3.02]) {
    g.box(x, x + 0.08, 0.72, 2.00, 0.48, 0.64, WALNUT)
  }
  g.box(0.04, 3.16, 1.84, 2.02, 0.34, 0.78, PACK_GREEN)
  g.box(0.06, 3.14, 1.78, 1.84, 0.44, 0.68, WARM_LAMP)

  // Divided cedar crate walls along both faces
  for (let b = 0; b <= 4; b++) {
    const bx = 0.10 + b * 0.75
    g.box(bx, bx + 0.05, 0.72, 0.94, 0.08, 1.04, WALNUT)
  }
  // Sculpted recognizable produce mounds in the 4 bins on BOTH sides:
  // Bin 0: Organic Avocados (dark green clustered ovals)
  for (const zc of [0.24, 0.88]) {
    for (let i = 0; i < 4; i++) {
      g.ellipsoid(0.24 + i * 0.16, 0.86 + (i % 2) * 0.06, zc, 0.09, 0.08, 0.11, PACK_AVOCADO)
    }
    g.ellipsoid(0.48, 0.96, zc, 0.16, 0.09, 0.12, PACK_GREEN)
  }
  // Bin 1: Honeycrisp Apples (stacked red spheres with tiny green leaves)
  for (const zc of [0.24, 0.88]) {
    for (let i = 0; i < 4; i++) {
      g.ellipsoid(1.00 + i * 0.16, 0.86, zc, 0.09, 0.09, 0.10, i % 2 ? PACK_CORAL : PACK_RED_DEEP)
    }
    g.ellipsoid(1.16, 0.98, zc, 0.10, 0.09, 0.09, PACK_CORAL)
    g.ellipsoid(1.34, 0.98, zc, 0.10, 0.09, 0.09, PACK_RED_DEEP)
    g.box(1.20, 1.28, 1.04, 1.09, zc - 0.03, zc + 0.03, LEAF_BRT)
  }
  // Bin 2: Leafy Spinach & Organic Greens (lush layered mounds)
  for (const zc of [0.24, 0.88]) {
    g.ellipsoid(1.88, 0.88, zc, 0.24, 0.13, 0.14, LEAF)
    g.ellipsoid(2.08, 0.92, zc, 0.22, 0.14, 0.13, LEAF_BRT)
    g.ellipsoid(1.96, 1.00, zc, 0.16, 0.09, 0.11, LEAF_BRT)
  }
  // Bin 3: Yellow Banana Bunches & Heirloom Tomatoes / Citrus
  for (const zc of [0.24, 0.88]) {
    for (let i = 0; i < 3; i++) {
      g.ellipsoid(2.50 + i * 0.18, 0.89, zc, 0.11, 0.08, 0.12, i === 2 ? PACK_ORANGE : PACK_YELLOW)
    }
    g.ellipsoid(2.68, 0.99, zc, 0.14, 0.07, 0.10, PACK_YELLOW)
  }
  // Upper stepped display shelf: baskets of tomatoes & citrus
  for (let i = 0; i < 6; i++) {
    const cx = 0.36 + i * 0.48
    g.box(cx - 0.18, cx + 0.18, 1.28, 1.40, 0.36, 0.76, CEDAR)
    g.ellipsoid(cx, 1.46, 0.56, 0.15, 0.10, 0.14, i % 3 === 0 ? PACK_CORAL : i % 3 === 1 ? PACK_YELLOW : LEAF_BRT)
  }
  return finishModule(g, 3.2, 1.12)
}

/** Aisle 2 — Artisan Bakery Display: warm oak shelving, glowing warm valance, sourdough boules, baguettes, croissants & bagels. */
function buildBakeryAisle(): ModuleAsset {
  const g = makeGrid(3.2, 1.98, 0.98, 2)
  g.box(0.05, 3.15, 0, 0.18, 0.06, 0.92, WALNUT)
  g.box(0.05, 3.15, 0.18, 1.92, 0.44, 0.54, OAK)
  // Warm glowing top bakery canopy
  g.box(0.04, 3.16, 1.84, 1.98, 0.16, 0.82, WALNUT)
  g.box(0.10, 3.10, 1.78, 1.84, 0.18, 0.80, WARM_LAMP)
  for (const y of [0.58, 1.02, 1.44]) {
    g.box(0.06, 3.14, y, y + 0.05, 0.09, 0.89, OAK)
    // Dark slate baking sheet trays on every shelf
    g.box(0.12, 3.08, y + 0.05, y + 0.09, 0.13, 0.42, SLATE)
    g.box(0.12, 3.08, y + 0.05, y + 0.09, 0.56, 0.85, SLATE)
  }
  // Bottom wicker baskets with upright French baguettes poking out!
  for (const z0 of [0.12, 0.56]) {
    for (let i = 0; i < 6; i++) {
      const bx = 0.14 + i * 0.49
      g.box(bx, bx + 0.40, 0.18, 0.40, z0, z0 + 0.28, CEDAR)
      // Vertical golden baguettes leaning inside basket
      g.cylY(bx + 0.12, z0 + 0.14, 0.28, 0.56, 0.045, PACK_BREAD)
      g.cylY(bx + 0.26, z0 + 0.15, 0.28, 0.55, 0.045, PACK_CRUST)
    }
  }
  // Mid shelf 1 (y = 0.67): Domed SF Sourdough Boules with pale flour score lines!
  for (const zc of [0.27, 0.71]) {
    for (let i = 0; i < 7; i++) {
      const lx = 0.30 + i * 0.43
      g.ellipsoid(lx, 0.75, zc, 0.15, 0.10, 0.11, i % 2 ? PACK_CRUST : PACK_BREAD)
      // Flour-dusted crust stripe across top of boule
      g.box(lx - 0.08, lx + 0.08, 0.83, 0.86, zc - 0.02, zc + 0.02, PACK_CREAM)
    }
  }
  // Mid shelf 2 (y = 1.11): Golden Croissants & Bagels
  for (const zc of [0.27, 0.71]) {
    for (let i = 0; i < 9; i++) {
      const px = 0.24 + i * 0.33
      g.ellipsoid(px, 1.17, zc, 0.11, 0.07, 0.08, PACK_GOLD)
      if (i % 2 === 0) g.box(px - 0.04, px + 0.04, 1.22, 1.25, zc - 0.02, zc + 0.02, PACK_CRUST)
    }
  }
  // Top shelf (y = 1.53): Blueberry Muffins & Pastry Boxes
  for (const zc of [0.27, 0.71]) {
    for (let i = 0; i < 8; i++) {
      const mx = 0.26 + i * 0.37
      if (i % 3 === 0) {
        // White window pastry box with pink bakery ribbon
        g.box(mx - 0.13, mx + 0.13, 1.53, 1.69, zc - 0.10, zc + 0.10, PACK_CREAM)
        g.box(mx - 0.13, mx + 0.13, 1.60, 1.64, zc - 0.11, zc + 0.11, PACK_PINK)
      } else {
        g.cylY(mx, zc, 1.53, 1.62, 0.07, PACK_EGG_TAN)
        g.ellipsoid(mx, 1.64, zc, 0.09, 0.06, 0.08, PACK_CRUST)
        g.box(mx - 0.03, mx + 0.03, 1.68, 1.71, zc - 0.02, zc + 0.02, PACK_BLUE)
      }
    }
  }
  return finishModule(g, 3.2, 0.98)
}

/** Aisle 3 — GTA 6–Style Cereal & Pantry Gondola: tall graphic cereal boxes, sauce jars, olive oil bottles, ramen & coffee pouches. */
function buildPantryAisle(): ModuleAsset {
  const g = makeGrid(3.2, 2.05, 0.95, 2)
  gondolaBase(g, [0.56, 1.02, 1.48], MARBLE)
  const cerealColors = [PACK_CORAL, PACK_YELLOW, PACK_BLUE, PACK_PURPLE, PACK_PINK, PACK_ORANGE, PACK_RED_DEEP, PACK_CYAN]
  const bandColors = [PACK_YELLOW, PACK_CORAL, PACK_CREAM, PACK_GOLD, PACK_CREAM, PACK_BLUE, PACK_GOLD, PACK_CREAM]

  // Top & Eye-level shelves (y=1.53 & y=1.07): Tall Thin Cereal Boxes with bright label bands (just like GTA 6's Colonel Crunch shelf!)
  for (const side of [0, 1]) {
    const z0 = side === 0 ? 0.12 : 0.62
    const z1 = side === 0 ? 0.33 : 0.83
    for (let i = 0; i < 11; i++) {
      const x0 = 0.12 + i * 0.27
      const col = cerealColors[(i + side * 3) % cerealColors.length]
      const band = bandColors[(i + side * 3) % bandColors.length]
      // Tall crisp vertical cereal box (0.21m wide, 0.34m tall, slim depth)
      g.box(x0, x0 + 0.21, 1.53, 1.87, z0, z1, col)
      g.box(x0 + 0.02, x0 + 0.19, 1.64, 1.76, z0 - 0.01, z1 + 0.01, band)
    }
    // Mid-upper shelf (y=1.07): Glass Tomato/Jam Jars (left half) + Slender Olive Oil Bottles (right half)!
    for (let i = 0; i < 6; i++) {
      const jx = 0.24 + i * 0.24
      const jz = side === 0 ? 0.24 : 0.71
      // Glass jar body + cream wrap label + silver metal lid
      g.cylY(jx, jz, 1.07, 1.29, 0.08, i % 2 === 0 ? PACK_RED_DEEP : PACK_ORANGE)
      g.cylY(jx, jz, 1.13, 1.22, 0.085, PACK_CREAM)
      g.cylY(jx, jz, 1.29, 1.33, 0.065, STEEL_BRT)
    }
    for (let i = 0; i < 6; i++) {
      const bx = 1.74 + i * 0.23
      const bz = side === 0 ? 0.24 : 0.71
      // Tall cylindrical olive oil / vinegar bottle with narrow neck + cap!
      g.cylY(bx, bz, 1.07, 1.28, 0.065, i % 2 === 0 ? PACK_GREEN : PACK_GOLD)
      g.cylY(bx, bz, 1.28, 1.38, 0.032, i % 2 === 0 ? PACK_GREEN : PACK_GOLD)
      g.cylY(bx, bz, 1.38, 1.42, 0.035, IRON)
    }
    // Mid-lower shelf (y=0.61): Ramen 4-Packs & Dark-Roast Espresso Pouches
    for (let i = 0; i < 9; i++) {
      const rx = 0.14 + i * 0.33
      if (i < 5) {
        // Ramen 4-pack with bold top band
        g.box(rx, rx + 0.26, 0.61, 0.87, side === 0 ? 0.12 : 0.58, side === 0 ? 0.38 : 0.84, i % 2 ? PACK_ORANGE : PACK_CORAL)
        g.box(rx, rx + 0.26, 0.72, 0.79, side === 0 ? 0.11 : 0.57, side === 0 ? 0.39 : 0.85, PACK_YELLOW)
      } else {
        // Tapered espresso bean pouches (wider base, narrow crimp top)
        g.box(rx + 0.02, rx + 0.24, 0.61, 0.82, side === 0 ? 0.14 : 0.60, side === 0 ? 0.36 : 0.82, PACK_CHOC)
        g.box(rx + 0.05, rx + 0.21, 0.82, 0.91, side === 0 ? 0.18 : 0.64, side === 0 ? 0.32 : 0.78, PACK_GOLD)
      }
    }
    // Bottom shelf (y=0.16): Heavy kraft flour/rice sacks & bulk pantry boxes
    for (let i = 0; i < 6; i++) {
      const fx = 0.16 + i * 0.49
      g.box(fx, fx + 0.38, 0.16, 0.48, side === 0 ? 0.11 : 0.56, side === 0 ? 0.40 : 0.85, i % 2 ? PACK_EGG_TAN : PACK_CREAM)
      g.box(fx + 0.04, fx + 0.34, 0.28, 0.38, side === 0 ? 0.10 : 0.55, side === 0 ? 0.41 : 0.86, i % 2 ? PACK_RED_DEEP : PACK_BLUE)
    }
  }
  return finishModule(g, 3.2, 0.95)
}

/** Aisle 4 — Snacks & Drinks Gondola: puffed chip bags, tall snack canisters, chocolate displays & sparkling water 12-packs. */
function buildSnacksAisle(): ModuleAsset {
  const g = makeGrid(3.2, 2.05, 0.95, 2)
  gondolaBase(g, [0.58, 1.04, 1.48], MARBLE)
  const chipColors = [PACK_YELLOW, PACK_CORAL, PACK_BLUE, PACK_LIME, PACK_PURPLE, PACK_ORANGE]

  for (const side of [0, 1]) {
    const zc = side === 0 ? 0.25 : 0.70
    // Top shelf (y=1.53): Puffed Chip Bags (plump ellipsoid middle + pinched top seal!)
    for (let i = 0; i < 10; i++) {
      const cx = 0.24 + i * 0.30
      const col = chipColors[(i + side * 2) % chipColors.length]
      g.ellipsoid(cx, 1.68, zc, 0.11, 0.15, 0.09, col)
      g.box(cx - 0.10, cx + 0.10, 1.81, 1.87, zc - 0.03, zc + 0.03, col)
      g.box(cx - 0.07, cx + 0.07, 1.66, 1.74, zc - 0.10, zc + 0.10, PACK_CREAM)
    }
    // Mid-upper shelf (y=1.09): Tall Cylindrical Chip Canisters (Pringles-style tubes with white plastic caps)
    for (let i = 0; i < 12; i++) {
      const tx = 0.20 + i * 0.25
      const col = chipColors[(i + 1 + side) % chipColors.length]
      g.cylY(tx, zc, 1.09, 1.38, 0.065, col)
      g.cylY(tx, zc, 1.38, 1.42, 0.068, PACK_CREAM)
    }
    // Mid-lower shelf (y=0.63): Chocolate Bar & Trail Mix Dispenser Trays
    for (let i = 0; i < 8; i++) {
      const bx = 0.16 + i * 0.37
      g.box(bx, bx + 0.30, 0.63, 0.72, side === 0 ? 0.12 : 0.57, side === 0 ? 0.39 : 0.84, SLATE)
      g.box(bx + 0.03, bx + 0.27, 0.72, 0.90, side === 0 ? 0.15 : 0.60, side === 0 ? 0.36 : 0.81, i % 2 ? PACK_CHOC : PACK_PURPLE)
      g.box(bx + 0.06, bx + 0.24, 0.77, 0.85, side === 0 ? 0.14 : 0.59, side === 0 ? 0.37 : 0.82, PACK_GOLD)
    }
    // Bottom shelf (y=0.16): Heavy Sparkling Water & Soda 12-Pack Cases with bright graphics + visible silver can tops!
    for (let i = 0; i < 5; i++) {
      const sx = 0.14 + i * 0.60
      const caseCol = i % 3 === 0 ? PACK_CYAN : i % 3 === 1 ? PACK_CORAL : PACK_LIME
      g.box(sx, sx + 0.50, 0.16, 0.44, side === 0 ? 0.10 : 0.54, side === 0 ? 0.41 : 0.85, caseCol)
      // White graphic band + silver top cans peeking through pack window
      g.box(sx + 0.04, sx + 0.46, 0.26, 0.36, side === 0 ? 0.09 : 0.53, side === 0 ? 0.42 : 0.86, PACK_CREAM)
      g.box(sx + 0.12, sx + 0.38, 0.44, 0.49, side === 0 ? 0.16 : 0.60, side === 0 ? 0.34 : 0.78, STEEL_BRT)
    }
  }
  return finishModule(g, 3.2, 0.95)
}

/** Aisle 5 / Cold Case — Open-Front Illuminated Dairy Cooler: gable milk cartons, flat egg cartons, yogurt cups & cheddar blocks. */
function buildDairyAisle(): ModuleAsset {
  const g = makeGrid(3.2, 2.10, 0.95, 2)
  // Stainless refrigerated housing + cool LED lighting strip under top canopy
  g.box(0.04, 3.16, 0, 0.24, 0.05, 0.90, STEEL_BRT)
  g.box(0.04, 3.16, 0.24, 2.02, 0.43, 0.52, MARBLE)
  g.box(0.04, 3.16, 1.94, 2.08, 0.06, 0.89, STEEL_BRT)
  g.box(0.10, 3.10, 1.88, 1.95, 0.10, 0.85, COOL_LAMP)
  // Glass end-panel chill guards
  for (const x of [0.04, 3.10]) g.box(x, x + 0.06, 0.24, 1.94, 0.06, 0.89, GLASS_CLR)
  for (const y of [0.64, 1.08, 1.50]) {
    g.box(0.08, 3.12, y, y + 0.05, 0.08, 0.87, STEEL_BRT)
  }

  for (const side of [0, 1]) {
    const zc = side === 0 ? 0.25 : 0.70
    // Top shelf (y=1.55): Gable-Top Milk & Oat Milk Cartons!
    for (let i = 0; i < 11; i++) {
      const mx = 0.18 + i * 0.27
      const col = i % 3 === 0 ? PACK_CREAM : i % 3 === 1 ? PACK_BLUE : PACK_CYAN
      g.box(mx - 0.08, mx + 0.08, 1.55, 1.77, zc - 0.08, zc + 0.08, col)
      // Peaked carton gable ridge + cap
      g.box(mx - 0.05, mx + 0.05, 1.77, 1.83, zc - 0.04, zc + 0.04, col)
      g.box(mx - 0.02, mx + 0.02, 1.80, 1.85, zc - 0.08, zc - 0.03, PACK_CORAL)
    }
    // Mid shelf (y=1.13): Yogurt Cups (white/berry cylinders) + Cheddar Cheese Blocks!
    for (let i = 0; i < 6; i++) {
      const yx = 0.24 + i * 0.24
      g.cylY(yx, zc, 1.13, 1.29, 0.075, PACK_CREAM)
      g.cylY(yx, zc, 1.29, 1.32, 0.08, i % 2 ? PACK_PINK : PACK_BLUE)
    }
    for (let i = 0; i < 5; i++) {
      const cx = 1.72 + i * 0.28
      g.box(cx - 0.10, cx + 0.10, 1.13, 1.31, zc - 0.09, zc + 0.09, PACK_YELLOW)
      g.box(cx - 0.07, cx + 0.07, 1.18, 1.26, zc - 0.10, zc + 0.10, PACK_CORAL)
    }
    // Lower-mid shelf (y=0.69): Wide Flat Tan Pasture Egg Cartons (stacked 2-high!)
    for (let i = 0; i < 7; i++) {
      const ex = 0.16 + i * 0.42
      g.box(ex, ex + 0.34, 0.69, 0.80, side === 0 ? 0.12 : 0.56, side === 0 ? 0.38 : 0.82, PACK_EGG_TAN)
      g.box(ex + 0.02, ex + 0.32, 0.81, 0.91, side === 0 ? 0.13 : 0.57, side === 0 ? 0.37 : 0.81, PACK_CREAM)
    }
    // Bottom cold well (y=0.24): Large Milk Jugs & Orange Juice Carafes
    for (let i = 0; i < 8; i++) {
      const jx = 0.24 + i * 0.37
      const jCol = i % 3 === 0 ? PACK_CREAM : i % 3 === 1 ? PACK_ORANGE : PACK_YELLOW
      g.box(jx - 0.11, jx + 0.11, 0.24, 0.50, zc - 0.10, zc + 0.10, jCol)
      g.cylY(jx, zc, 0.50, 0.58, 0.04, jCol)
      g.cylY(jx, zc, 0.58, 0.61, 0.045, i % 3 === 0 ? PACK_RED_DEEP : PACK_GREEN)
    }
  }
  return finishModule(g, 3.2, 0.95)
}

let cachedBeacons: { pink: ModuleAsset; emerald: ModuleAsset } | null = null
/** Glowing 3D floating target diamond halo placed directly over needed supermarket items (pink) or ready checkout (emerald). */
export function getItemBeaconAsset(tone: 'pink' | 'emerald'): ModuleAsset {
  if (!cachedBeacons) {
    const make = (lampMat: number): ModuleAsset => {
      const g = makeGrid(0.42, 0.48, 0.42, 2)
      // Crisp floating diamond crystal + subtle base halo ring
      g.ellipsoid(0.21, 0.30, 0.21, 0.12, 0.16, 0.12, lampMat)
      g.cylY(0.21, 0.21, 0.04, 0.09, 0.18, lampMat)
      g.cylY(0.21, 0.21, 0.04, 0.09, 0.11, 0)
      return finishModule(g, 0.42, 0.42, false)
    }
    cachedBeacons = { pink: make(LAMP_PINK), emerald: make(LAMP_EMERALD) }
  }
  return cachedBeacons[tone]
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
    const g = makeGrid(2.6, 1.32, 1.45, 2)
    // Slatted cedar produce stand with dark wood corner rails
    g.box(0.08, 2.52, 0, 0.76, 0.08, 1.37, CEDAR)
    g.box(0.06, 2.54, 0.72, 0.84, 0.06, 1.39, WALNUT)
    g.box(0.14, 2.46, 0.76, 0.86, 0.14, 1.31, OAK)
    // Compartment dividers
    g.box(0.88, 0.94, 0.76, 0.98, 0.10, 1.35, WALNUT)
    g.box(1.66, 1.72, 0.76, 0.98, 0.10, 1.35, WALNUT)
    g.box(0.10, 2.50, 0.76, 0.98, 0.70, 0.75, WALNUT)
    // Sculpted rounded produce pyramids: Avocados (dark green), Red Apples, Leafy Greens, Bananas & Citrus!
    for (let i = 0; i < 3; i++) {
      g.ellipsoid(0.32 + i * 0.20, 0.94, 0.42, 0.12, 0.10, 0.14, PACK_AVOCADO)
      g.ellipsoid(0.32 + i * 0.20, 0.94, 1.04, 0.12, 0.11, 0.14, i % 2 ? PACK_CORAL : PACK_RED_DEEP)
    }
    g.ellipsoid(0.50, 1.08, 0.42, 0.16, 0.09, 0.14, PACK_GREEN)
    g.ellipsoid(0.50, 1.08, 1.04, 0.15, 0.10, 0.14, PACK_CORAL)
    // Center lush spinach & heirloom tomatoes
    g.ellipsoid(1.30, 0.98, 0.42, 0.28, 0.16, 0.20, LEAF_BRT)
    g.ellipsoid(1.30, 0.96, 1.04, 0.26, 0.14, 0.18, PACK_CORAL)
    // Right bananas & citrus oranges
    for (let i = 0; i < 3; i++) {
      g.ellipsoid(1.88 + i * 0.20, 0.95, 0.42, 0.13, 0.09, 0.14, PACK_YELLOW)
      g.ellipsoid(1.88 + i * 0.20, 0.95, 1.04, 0.12, 0.11, 0.13, PACK_ORANGE)
    }
    return finishModule(g, 2.6, 1.45)
  })()

  const fridge_wall = (() => {
    const g = makeGrid(3.0, 2.32, 0.88, 2)
    // Iconic GTA 6 illuminated glass-door beverage & dairy cooler wall!
    g.box(0, 3.0, 0, 2.32, 0.14, 0.88, SLATE)
    // Glowing bright backlit cooler interior + top cool LED bar
    g.box(0.10, 2.90, 0.24, 2.06, 0.76, 0.84, COOL_LAMP)
    g.box(0.10, 2.90, 2.00, 2.08, 0.18, 0.80, COOL_LAMP)
    // 4 metal cold-case shelves + vertical LED mullions
    const ys = [0.28, 0.72, 1.16, 1.60]
    for (const y of ys) g.box(0.10, 2.90, y, y + 0.05, 0.18, 0.76, STEEL_BRT)
    // Distinct recognizable cold products inside:
    // Bottom shelf: wide milk jugs + cold 12-packs
    for (let i = 0; i < 8; i++) {
      const x = 0.28 + i * 0.34
      g.box(x - 0.10, x + 0.10, 0.33, 0.58, 0.30, 0.68, i % 2 === 0 ? PACK_CREAM : PACK_CYAN)
      g.cylY(x, 0.46, 0.58, 0.66, 0.04, i % 2 === 0 ? PACK_CORAL : PACK_BLUE)
    }
    // Shelf 2: Flat egg cartons + yogurt cups
    for (let i = 0; i < 6; i++) {
      const x = 0.20 + i * 0.44
      if (i < 3) {
        g.box(x, x + 0.34, 0.77, 0.89, 0.28, 0.66, PACK_EGG_TAN)
        g.box(x + 0.02, x + 0.32, 0.90, 1.01, 0.30, 0.64, PACK_CREAM)
      } else {
        g.cylY(x + 0.14, 0.46, 0.77, 0.96, 0.08, PACK_CREAM)
        g.cylY(x + 0.14, 0.46, 0.96, 1.00, 0.085, i % 2 ? PACK_PINK : PACK_YELLOW)
      }
    }
    // Shelf 3 & 4: Tall cylindrical soda / beer / iced-tea bottles & cold cans (GTA 6 glass-door cooler rows!)
    const drinkCols = [PACK_GREEN, PACK_BLUE, PACK_CORAL, PACK_YELLOW, PACK_CYAN, PACK_ORANGE, PACK_RED_DEEP, PACK_LIME]
    for (const sy of [1.21, 1.65]) {
      for (let i = 0; i < 12; i++) {
        const bx = 0.22 + i * 0.23
        const col = drinkCols[(i + (sy > 1.4 ? 3 : 0)) % drinkCols.length]
        g.cylY(bx, 0.44, sy, sy + 0.22, 0.055, col)
        g.cylY(bx, 0.44, sy + 0.22, sy + 0.31, 0.028, col)
        g.cylY(bx, 0.44, sy + 0.31, sy + 0.34, 0.032, STEEL_BRT)
      }
    }
    // Crisp glass cooler doors + dark vertical frames + chrome vertical door handles!
    g.box(0.08, 2.92, 0.22, 2.08, 0.08, 0.14, GLASS_CLR)
    for (const x of [0.05, 1.00, 1.95, 2.90]) {
      g.box(x, x + 0.08, 0.18, 2.12, 0.05, 0.16, IRON)
      if (x < 2.5) g.box(x + 0.82, x + 0.87, 0.88, 1.48, 0.02, 0.07, STEEL_BRT)
    }
    // Glowing top cooler header fascia backing
    g.box(0.04, 2.96, 2.10, 2.30, 0.06, 0.16, COOL_LAMP)
    return finishModule(g, 3.0, 0.88)
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
    aisle_produce: buildProduceAisle(),
    aisle_bakery: buildBakeryAisle(),
    aisle_dairy: buildDairyAisle(),
    aisle_pantry: buildPantryAisle(),
    aisle_snacks: buildSnacksAisle(),
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
