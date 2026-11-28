// Procedural 3D voxel kits for San Francisco neighborhood character (#93):
//   - Civic plazas & town squares: pergola/stage pavilion, plaza archway portal, festoon string lights,
//     slatted cedar park benches, corten planter boxes, Little Free Library, farmers-market stalls,
//     picnic tables, stone fountains, drinking fountains, bollards, and warm flagstone courtyard pads.
//   - Storefront sidewalks: café bistro tables with vibrant patio umbrellas, wooden A-frame menu boards,
//     florist plant stands, bookstore display racks, grocery produce crates, and blade sign brackets.
//
// Every mesh is generated lazily once and shared across all nearby instances via `pieces.add(born, true)`.
import { faces as facesOf } from './fine.ts'
import type { Born } from './told.ts'

// Material indices matching engine/core/src/kinds.rs
const GRASS = 3, WATER = 5, CONCRETE = 7, BRICK = 8, PLASTER = 9, WOOD = 10, GLASS = 11, STEEL = 12, LEAVES = 13, ROOFING = 14, LAMP = 15
const k = (material: number, colour = 0) => material | (colour << 8)
const hue = (h: number, tone: number) => 16 + (h % 24) * 10 + (tone % 10)
const grey = (step: number) => 1 + Math.max(0, Math.min(14, step))

// Shared architectural & neighborhood palette
const CEDAR = k(WOOD, hue(2, 5))
const CEDAR_DARK = k(WOOD, hue(2, 7))
const OAK = k(WOOD, hue(3, 4))
const REDWOOD = k(WOOD, hue(1, 6))
const IRON = k(STEEL, grey(13))
const STEEL_MED = k(STEEL, grey(8))
const CORTEN = k(BRICK, hue(1, 6))
const TERRACOTTA = k(BRICK, hue(1, 4))
const STONE_LIGHT = k(CONCRETE, hue(3, 1))
const STONE_WARM = k(CONCRETE, hue(3, 2))
const STONE_BORDER = k(CONCRETE, hue(3, 5))
const STONE_COOL = k(CONCRETE, grey(5))
const CHALKBOARD = k(ROOFING, grey(13))
const CREAM = k(PLASTER, hue(3, 1))
const WHITE = k(PLASTER, grey(1))
const GLASS_CLEAR = k(GLASS, grey(10))
const WATER_BLUE = k(WATER, hue(14, 3))
const SOIL = k(WOOD, hue(2, 8))
const LEAF_DEEP = k(LEAVES, hue(9, 6))
const LEAF_BRIGHT = k(LEAVES, hue(8, 4))
const LEAF_SAGE = k(LEAVES, hue(10, 5))
const WARM_BULB = k(LAMP, hue(3, 1))
const GOLD_BULB = k(LAMP, hue(3, 3))
const FLOWER_CORAL = k(PLASTER, hue(0, 3))
const FLOWER_SUN = k(PLASTER, hue(4, 2))
const FLOWER_PINK = k(PLASTER, hue(22, 3))
const FLOWER_VIOLET = k(PLASTER, hue(18, 4))
const ORANGE_FRUIT = k(PLASTER, hue(2, 3))
const APPLE_RED = k(PLASTER, hue(0, 4))
const LEMON = k(PLASTER, hue(4, 1))
const TURF = k(GRASS, hue(9, 4))

interface Grid {
  W: number
  H: number
  D: number
  s: number
  per: number
  cells: Uint16Array
  c(m: number): number
  set(x: number, y: number, z: number, v: number): void
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, v: number): void
  cylY(xm: number, zm: number, y0: number, y1: number, r: number, v: number): void
}

function makeGrid(lengthM: number, heightM: number, widthM: number, per: number): Grid {
  const s = per * 10
  const W = Math.max(1, Math.ceil(lengthM * s))
  const H = Math.max(1, Math.ceil(heightM * s))
  const D = Math.max(1, Math.ceil(widthM * s))
  const cells = new Uint16Array(W * H * D)
  const c = (m: number) => Math.round(m * s)
  const set = (x: number, y: number, z: number, v: number) => {
    if (x >= 0 && x < W && y >= 0 && y < H && z >= 0 && z < D) cells[x + W * (z + D * y)] = v
  }
  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, v: number) => {
    const X0 = Math.max(0, c(x0)), X1 = Math.min(W, c(x1))
    const Y0 = Math.max(0, c(y0)), Y1 = Math.min(H, c(y1))
    const Z0 = Math.max(0, c(z0)), Z1 = Math.min(D, c(z1))
    for (let y = Y0; y < Y1; y++)
      for (let z = Z0; z < Z1; z++)
        for (let x = X0; x < X1; x++) cells[x + W * (z + D * y)] = v
  }
  const cylY = (xm: number, zm: number, y0: number, y1: number, r: number, v: number) => {
    const cx = xm * s, cz = zm * s, R = r * s
    const Y0 = Math.max(0, c(y0)), Y1 = Math.min(H, c(y1))
    for (let y = Y0; y < Y1; y++)
      for (let z = Math.floor(cz - R); z <= Math.ceil(cz + R); z++)
        for (let x = Math.floor(cx - R); x <= Math.ceil(cx + R); x++)
          if ((x + 0.5 - cx) ** 2 + (z + 0.5 - cz) ** 2 <= R * R) set(x, y, z, v)
  }
  return { W, H, D, s, per, cells, c, set, box, cylY }
}

export interface PropAsset {
  born: Born
  /** Piece cell scale (`1 / per`). */
  cell: number
}

function finish(g: Grid, com: [number, number, number] = [g.W / 2, 0, g.D / 2]): PropAsset {
  let filled = 0
  for (let i = 0; i < g.cells.length; i++) if (g.cells[i]) filled++
  return {
    born: {
      id: 0,
      cells: filled,
      size: [g.W, g.H, g.D],
      com,
      low: [0, 0, 0],
      faces: facesOf(g.cells, [g.W, g.H, g.D]),
    },
    cell: 1 / g.per,
  }
}

export interface PropKit {
  bench: PropAsset
  pavilion: PropAsset
  archway: PropAsset
  festoon: PropAsset
  planter: PropAsset
  littleLibrary: PropAsset
  fountain: PropAsset
  waterFountain: PropAsset
  picnicTable: PropAsset
  bollard: PropAsset
  deckPad: PropAsset
  marketStalls: PropAsset[]
  cafePatios: PropAsset[]
  aframe: PropAsset
  floristStand: PropAsset
  bookCart: PropAsset
  groceryCrates: PropAsset
  bladeBracket: PropAsset
}

let cachedKit: PropKit | null = null

export function neighborhoodPropKit(): PropKit {
  if (cachedKit) return cachedKit

  // 1. Slatted Cedar & Cast-Iron Park Bench (length x = 1.8 m, height y = 0.85 m, depth z = 0.65 m; faces +z)
  const bench = (() => {
    const g = makeGrid(1.8, 0.85, 0.65, 2)
    // Iron leg frames + armrests at x = 0.2 and x = 1.6
    for (const x of [0.18, 1.54]) {
      g.box(x, x + 0.08, 0.0, 0.44, 0.12, 0.56, IRON)
      g.box(x, x + 0.08, 0.44, 0.64, 0.10, 0.18, IRON)
      g.box(x, x + 0.08, 0.44, 0.64, 0.48, 0.56, IRON)
      g.box(x, x + 0.08, 0.58, 0.64, 0.12, 0.56, IRON)
      // Backrest iron uprights
      g.box(x, x + 0.08, 0.44, 0.82, 0.08, 0.14, IRON)
    }
    // Cedar seat slats
    for (const z of [0.18, 0.30, 0.42, 0.52]) {
      g.box(0.06, 1.74, 0.42, 0.48, z, z + 0.08, CEDAR)
    }
    // Cedar backrest slats
    for (const y of [0.56, 0.68, 0.78]) {
      g.box(0.06, 1.74, y, y + 0.08, 0.12, 0.18, CEDAR_DARK)
    }
    return finish(g)
  })()

  // 2. Town Square Timber Stage & Pergola Pavilion (5.4 m x 3.4 m x 3.6 m, faces +z)
  const pavilion = (() => {
    const L = 5.4, H = 3.4, D = 3.6
    const g = makeGrid(L, H, D, 1)
    // Raised cedar deck platform + front step
    g.box(0.1, L - 0.1, 0.0, 0.36, 0.1, D - 0.3, CEDAR_DARK)
    g.box(0.2, L - 0.2, 0.30, 0.42, 0.2, D - 0.35, OAK)
    g.box(0.8, L - 0.8, 0.0, 0.20, D - 0.35, D - 0.05, CEDAR)
    // 4 redwood timber corner columns + steel bases
    for (const px of [0.3, L - 0.5]) {
      for (const pz of [0.3, D - 0.7]) {
        g.box(px - 0.06, px + 0.28, 0.35, 0.60, pz - 0.06, pz + 0.28, IRON)
        g.box(px, px + 0.22, 0.40, 3.05, pz, pz + 0.22, REDWOOD)
      }
    }
    // Low acoustic back timber slat screen + built-in greenery box along rear
    g.box(0.4, L - 0.4, 0.42, 1.05, 0.25, 0.55, CORTEN)
    g.box(0.5, L - 0.5, 1.00, 1.38, 0.28, 0.52, LEAF_DEEP)
    for (let x = 0.7; x < L - 0.6; x += 0.5) {
      g.box(x, x + 0.12, 1.05, 2.95, 0.22, 0.34, CEDAR)
    }
    // Overhead perimeter beams & slatted pergola rafters
    g.box(0.15, L - 0.15, 2.95, 3.22, 0.20, 0.48, REDWOOD)
    g.box(0.15, L - 0.15, 2.95, 3.22, D - 0.78, D - 0.50, REDWOOD)
    g.box(0.15, 0.45, 2.95, 3.22, 0.20, D - 0.50, REDWOOD)
    g.box(L - 0.45, L - 0.15, 2.95, 3.22, 0.20, D - 0.50, REDWOOD)
    for (let x = 0.6; x < L - 0.4; x += 0.48) {
      g.box(x, x + 0.14, 3.14, 3.34, 0.10, D - 0.35, CEDAR)
    }
    // Warm bistro string-light bulbs along front & inner pergola rafters (glows warmly at dusk/night!)
    for (let x = 0.75; x < L - 0.65; x += 0.65) {
      g.box(x, x + 0.12, 2.82, 2.94, D - 0.68, D - 0.56, WARM_BULB)
      g.box(x, x + 0.12, 2.84, 2.96, 1.55, 1.67, GOLD_BULB)
    }
    return finish(g)
  })()

  // 3. Plaza Entrance Archway Portal (3.8 m wide x 3.4 m tall x 0.6 m deep; paired with crisp dual-sided title plaques!)
  const archway = (() => {
    const L = 3.8, H = 3.4, D = 0.6
    const g = makeGrid(L, H, D, 1)
    // Flanking corten & terracotta planter bases + warm redwood/iron portal columns
    for (const px of [0.1, L - 0.75]) {
      g.box(px, px + 0.65, 0.0, 0.58, 0.05, D - 0.05, CORTEN)
      g.box(px - 0.02, px + 0.67, 0.56, 0.66, 0.03, D - 0.03, TERRACOTTA)
      g.box(px + 0.06, px + 0.58, 0.64, 0.94, 0.10, D - 0.10, LEAF_BRIGHT)
      g.box(px + 0.20, px + 0.44, 0.58, 3.15, 0.18, D - 0.18, IRON)
      g.box(px + 0.23, px + 0.41, 0.94, 2.90, 0.19, D - 0.19, REDWOOD)
    }
    // Slim header backing core (z = 0.18..0.42 m -> ±0.12 m from center) so plaques mounted at ±0.20 m sit cleanly proud on BOTH sides!
    g.box(0.15, L - 0.15, 2.60, 3.34, 0.18, D - 0.18, IRON)
    g.box(0.10, L - 0.10, 3.30, 3.40, 0.10, D - 0.10, REDWOOD)
    // Warm architectural downlights under header
    for (const lx of [1.0, 1.9, 2.8]) {
      g.box(lx - 0.08, lx + 0.08, 2.52, 2.62, 0.24, 0.36, WARM_BULB)
    }
    return finish(g)
  })()

  // 4. Overhead Festoon String-Light Span (5.6 m wide x 3.5 m tall x 0.3 m deep, per=2 -> 5 cm crisp unbroken cable & Edison bulbs)
  const festoon = (() => {
    const L = 5.6, H = 3.5, D = 0.3
    const g = makeGrid(L, H, D, 2)
    for (const px of [0.05, L - 0.17]) {
      g.box(px - 0.04, px + 0.16, 0.0, 0.35, 0.05, 0.25, STONE_COOL)
      g.box(px, px + 0.12, 0.30, 3.42, 0.09, 0.21, IRON)
    }
    // Continuous draped catenary cable (guaranteed >= 1 voxel thick at every step) with neat glowing Edison bulbs
    const steps = 64
    let prevY = 3.32
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const xm = 0.11 + t * (L - 0.22)
      const sag = 4 * t * (1 - t) * 0.48
      const ym = 3.32 - sag
      const yLo = Math.min(prevY, ym)
      const yHi = Math.max(prevY, ym) + 0.06
      g.box(xm - 0.05, xm + 0.05, yLo, yHi, 0.12, 0.18, IRON)
      prevY = ym
      if (i > 4 && i < steps - 4 && i % 8 === 0) {
        g.box(xm - 0.03, xm + 0.03, ym - 0.06, ym, 0.12, 0.18, IRON)
        g.box(xm - 0.05, xm + 0.05, ym - 0.16, ym - 0.05, 0.10, 0.20, WARM_BULB)
      }
    }
    return finish(g)
  })()

  // 5. Corten-Steel Planter Box with Lush Foliage & Flowers (1.4 m x 1.1 m x 0.7 m, per=2 -> 5 cm crisp foliage!)
  const planter = (() => {
    const g = makeGrid(1.4, 1.1, 0.7, 2)
    g.box(0.05, 1.35, 0.0, 0.56, 0.05, 0.65, CORTEN)
    g.box(0.02, 1.38, 0.52, 0.58, 0.02, 0.68, IRON)
    g.box(0.10, 1.30, 0.50, 0.58, 0.10, 0.60, SOIL)
    // Layered shrubs
    g.box(0.14, 1.26, 0.56, 0.86, 0.12, 0.58, LEAF_DEEP)
    g.box(0.22, 1.18, 0.78, 1.00, 0.16, 0.54, LEAF_BRIGHT)
    g.box(0.38, 1.02, 0.90, 1.06, 0.22, 0.48, LEAF_SAGE)
    // Bright seasonal blooms
    const blooms = [
      [0.28, 0.92, 0.24, FLOWER_CORAL], [0.56, 1.00, 0.36, FLOWER_SUN],
      [0.86, 0.98, 0.26, FLOWER_PINK], [1.10, 0.90, 0.42, FLOWER_CORAL],
      [0.44, 0.96, 0.48, FLOWER_VIOLET], [0.74, 1.02, 0.44, FLOWER_SUN],
    ] as const
    for (const [bx, by, bz, col] of blooms) g.box(bx - 0.06, bx + 0.06, by - 0.04, by + 0.06, bz - 0.06, bz + 0.06, col)
    return finish(g)
  })()

  // 6. Little Free Library (0.65 m x 1.45 m x 0.55 m, per=2)
  const littleLibrary = (() => {
    const g = makeGrid(0.65, 1.45, 0.55, 2)
    // Wooden post & base
    g.box(0.24, 0.40, 0.0, 0.86, 0.20, 0.36, CEDAR_DARK)
    // Little house cabinet
    g.box(0.08, 0.56, 0.84, 1.24, 0.10, 0.46, TERRACOTTA)
    g.box(0.13, 0.51, 0.89, 1.19, 0.15, 0.42, CREAM)
    // Tiny colorful book spines inside
    const books = [FLOWER_CORAL, FLOWER_SUN, LEAF_BRIGHT, FLOWER_VIOLET, ORANGE_FRUIT, APPLE_RED]
    books.forEach((col, i) => {
      const bx = 0.15 + i * 0.058
      g.box(bx, bx + 0.045, 0.90, 1.12 + (i % 2) * 0.04, 0.18, 0.38, col)
    })
    // Glass door front
    g.box(0.12, 0.52, 0.89, 1.19, 0.42, 0.47, GLASS_CLEAR)
    // Pitched shingle roof
    for (let step = 0; step < 5; step++) {
      const inset = step * 0.055
      g.box(0.02 + inset, 0.63 - inset, 1.24 + step * 0.045, 1.29 + step * 0.045, 0.05, 0.50, IRON)
    }
    return finish(g)
  })()

  // 7. Civic Stone Fountain (2.0 m x 1.35 m x 2.0 m, per=1)
  const fountain = (() => {
    const g = makeGrid(2.0, 1.35, 2.0, 1)
    g.cylY(1.0, 1.0, 0.0, 0.48, 0.95, STONE_COOL)
    g.cylY(1.0, 1.0, 0.22, 0.46, 0.78, WATER_BLUE)
    g.cylY(1.0, 1.0, 0.22, 0.98, 0.24, STONE_WARM)
    g.cylY(1.0, 1.0, 0.92, 1.10, 0.48, STONE_COOL)
    g.cylY(1.0, 1.0, 1.06, 1.32, 0.14, WATER_BLUE)
    return finish(g)
  })()

  // 8. Civic Drinking Fountain (0.45 m x 1.0 m x 0.45 m, per=2)
  const waterFountain = (() => {
    const g = makeGrid(0.45, 1.0, 0.45, 2)
    g.cylY(0.22, 0.22, 0.0, 0.82, 0.11, IRON)
    g.cylY(0.22, 0.22, 0.82, 0.96, 0.19, STEEL_MED)
    g.cylY(0.22, 0.22, 0.90, 0.97, 0.13, WATER_BLUE)
    return finish(g)
  })()

  // 9. Redwood Picnic Table with Attached Benches (1.8 m x 0.8 m x 1.5 m, per=2)
  const picnicTable = (() => {
    const g = makeGrid(1.8, 0.8, 1.5, 2)
    // Tabletop slats
    g.box(0.05, 1.75, 0.72, 0.78, 0.40, 1.10, CEDAR)
    // Two attached side benches
    g.box(0.08, 1.72, 0.42, 0.48, 0.04, 0.30, CEDAR_DARK)
    g.box(0.08, 1.72, 0.42, 0.48, 1.20, 1.46, CEDAR_DARK)
    // Steel cross legs & frame
    for (const lx of [0.28, 1.44]) {
      g.box(lx, lx + 0.08, 0.0, 0.72, 0.46, 0.54, IRON)
      g.box(lx, lx + 0.08, 0.0, 0.72, 0.96, 1.04, IRON)
      g.box(lx, lx + 0.08, 0.36, 0.43, 0.12, 1.38, IRON)
    }
    return finish(g)
  })()

  // 10. Plaza Perimeter Bollard (0.25 m x 0.85 m x 0.25 m, per=2)
  const bollard = (() => {
    const g = makeGrid(0.25, 0.85, 0.25, 2)
    g.cylY(0.125, 0.125, 0.0, 0.72, 0.085, IRON)
    g.cylY(0.125, 0.125, 0.72, 0.80, 0.08, WARM_BULB)
    g.cylY(0.125, 0.125, 0.80, 0.85, 0.08, IRON)
    return finish(g)
  })()

  // 11. Warm Pale Granite Courtyard Paver Slab (3.8 m x 0.12 m x 3.8 m, per=1; gentle tonal border, no harsh dark grid!)
  const deckPad = (() => {
    const g = makeGrid(3.8, 0.12, 3.8, 1)
    g.box(0.0, 3.8, 0.0, 0.12, 0.0, 3.8, STONE_WARM)
    g.box(0.2, 3.6, 0.0, 0.12, 0.2, 3.6, STONE_LIGHT)
    return finish(g)
  })()

  // 12. Farmers Market Striped Canopy Stalls (3 variants: terracotta, forest, saffron; 3.0 m x 2.75 m x 2.2 m, per=1)
  const makeMarketStall = (stripeKind: number): PropAsset => {
    const L = 3.0, H = 2.75, D = 2.2
    const g = makeGrid(L, H, D, 1)
    // 4 steel canopy legs
    for (const px of [0.1, L - 0.2]) {
      for (const pz of [0.1, D - 0.2]) {
        g.box(px, px + 0.12, 0.0, 2.25, pz, pz + 0.12, IRON)
      }
    }
    // Striped canvas tent canopy roof
    for (let x = 0; x < g.W; x++) {
      const stripe = Math.floor(x / 3) % 2 === 0 ? stripeKind : CREAM
      for (let z = 0; z < g.D; z++) {
        const edge = Math.min(x, g.W - 1 - x, z, g.D - 1 - z)
        const yRoof = Math.min(g.H - 1, 21 + Math.min(5, Math.floor(edge / 2)))
        g.set(x, yRoof, z, stripe)
        if (edge === 0) {
          g.set(x, 20, z, stripe)
          g.set(x, 19, z, stripe)
        }
      }
    }
    // Wooden trestle display table + colorful produce crates
    g.box(0.3, L - 0.3, 0.0, 0.85, 0.45, 1.35, CEDAR_DARK)
    g.box(0.25, L - 0.25, 0.82, 0.92, 0.40, 1.40, OAK)
    const goods = [ORANGE_FRUIT, LEAF_BRIGHT, APPLE_RED, LEMON, FLOWER_PINK]
    goods.forEach((col, i) => {
      const cx = 0.4 + i * 0.46
      g.box(cx, cx + 0.38, 0.90, 1.12, 0.55, 1.25, CEDAR)
      g.box(cx + 0.04, cx + 0.34, 1.06, 1.22, 0.60, 1.20, col)
    })
    return finish(g)
  }
  const marketStalls = [
    makeMarketStall(TERRACOTTA),
    makeMarketStall(k(PLASTER, hue(10, 6))),
    makeMarketStall(k(PLASTER, hue(4, 3))),
  ]

  // 13. Café Bistro Table + 2 Chairs + Vibrant Patio Umbrella (4 colorways; 1.7 m x 2.45 m x 1.7 m, per=2)
  const makeCafePatio = (umbrellaColor: number, stripeColor: number): PropAsset => {
    const g = makeGrid(1.7, 2.45, 1.7, 2)
    // Round bistro table in center
    g.cylY(0.85, 0.85, 0.0, 0.08, 0.24, IRON)
    g.cylY(0.85, 0.85, 0.08, 0.74, 0.04, IRON)
    g.cylY(0.85, 0.85, 0.74, 0.79, 0.40, CREAM)
    // Two coffee cups on table
    g.box(0.68, 0.76, 0.79, 0.88, 0.80, 0.88, WHITE)
    g.box(0.94, 1.02, 0.79, 0.88, 0.82, 0.90, WHITE)
    // Two bistro chairs flanking table along X
    for (const [cx, backX] of [[0.26, 0.10], [1.44, 1.56]] as const) {
      g.box(cx - 0.18, cx + 0.18, 0.42, 0.48, 0.66, 1.04, CEDAR)
      g.box(cx - 0.16, cx - 0.10, 0.0, 0.44, 0.68, 0.74, IRON)
      g.box(cx + 0.10, cx + 0.16, 0.0, 0.44, 0.68, 0.74, IRON)
      g.box(cx - 0.16, cx - 0.10, 0.0, 0.44, 0.96, 1.02, IRON)
      g.box(cx + 0.10, cx + 0.16, 0.0, 0.44, 0.96, 1.02, IRON)
      g.box(backX - 0.03, backX + 0.03, 0.46, 0.84, 0.68, 1.02, IRON)
    }
    // Umbrella pole & pitched octagonal canopy
    g.cylY(0.85, 0.85, 0.78, 2.38, 0.035, CEDAR_DARK)
    const cx = 0.85 * g.s, cz = 0.85 * g.s, maxR = 0.82 * g.s
    for (let z = 0; z < g.D; z++) {
      for (let x = 0; x < g.W; x++) {
        const dx = x + 0.5 - cx, dz = z + 0.5 - cz
        const d = Math.hypot(dx, dz)
        if (d > maxR) continue
        const drop = (d / maxR) * 0.40
        const y = Math.round((2.40 - drop) * g.s)
        const ang = Math.atan2(dz, dx)
        const sector = Math.floor(((ang + Math.PI) / (Math.PI * 2)) * 8)
        const col = sector % 2 === 0 ? umbrellaColor : stripeColor
        g.set(x, y, z, col)
        if (d > maxR - 1.2) g.set(x, y - 1, z, col)
      }
    }
    return finish(g)
  }
  const cafePatios = [
    // Sunny yellow (Martha & Bros Coffee!), crimson, sage green, warm terracotta
    makeCafePatio(k(PLASTER, hue(4, 2)), k(PLASTER, hue(4, 3))),
    makeCafePatio(k(PLASTER, hue(0, 5)), CREAM),
    makeCafePatio(k(PLASTER, hue(10, 5)), CREAM),
    makeCafePatio(TERRACOTTA, CREAM),
  ]

  // 14. Wooden A-Frame Sidewalk Chalkboard Menu (0.6 m x 1.0 m x 0.55 m, per=2)
  const aframe = (() => {
    const g = makeGrid(0.6, 1.0, 0.55, 2)
    for (let yi = 0; yi < g.H - 1; yi++) {
      const t = yi / (g.H - 1)
      const spread = (1 - t) * 0.22
      const zA = 0.275 - spread, zB = 0.275 + spread
      const y0 = yi / g.s, y1 = (yi + 1) / g.s
      g.box(0.06, 0.54, y0, y1, zA - 0.03, zA + 0.03, CEDAR)
      g.box(0.06, 0.54, y0, y1, zB - 0.03, zB + 0.03, CEDAR)
      if (t > 0.16 && t < 0.88) {
        g.box(0.11, 0.49, y0, y1, zA - 0.035, zA + 0.035, CHALKBOARD)
        g.box(0.11, 0.49, y0, y1, zB - 0.035, zB + 0.035, CHALKBOARD)
      }
    }
    return finish(g)
  })()

  // 15. Florist & Plant Store Stepped Sidewalk Greenery Stand (1.5 m x 1.3 m x 0.7 m, per=2)
  const floristStand = (() => {
    const g = makeGrid(1.5, 1.3, 0.7, 2)
    // Two-tier wooden bench shelf
    g.box(0.05, 1.45, 0.0, 0.42, 0.06, 0.64, CEDAR_DARK)
    g.box(0.05, 1.45, 0.42, 0.82, 0.06, 0.36, CEDAR)
    // Potted ferns & vibrant flowers on lower and upper tiers
    const pots: [number, number, number, number][] = [
      [0.24, 0.42, 0.50, FLOWER_CORAL], [0.58, 0.42, 0.50, FLOWER_SUN],
      [0.92, 0.42, 0.50, FLOWER_PINK], [1.26, 0.42, 0.50, FLOWER_VIOLET],
      [0.32, 0.82, 0.22, FLOWER_PINK], [0.75, 0.82, 0.22, FLOWER_CORAL],
      [1.18, 0.82, 0.22, FLOWER_SUN],
    ]
    for (const [px, py, pz, bloom] of pots) {
      g.cylY(px, pz, py, py + 0.18, 0.11, TERRACOTTA)
      g.cylY(px, pz, py + 0.16, py + 0.34, 0.14, LEAF_BRIGHT)
      g.cylY(px, pz, py + 0.30, py + 0.44, 0.10, bloom)
    }
    return finish(g)
  })()

  // 16. Bookstore Outdoor Book Cart / Display Rack (1.3 m x 1.15 m x 0.6 m, per=2)
  const bookCart = (() => {
    const g = makeGrid(1.3, 1.15, 0.6, 2)
    g.box(0.06, 1.24, 0.12, 1.08, 0.06, 0.54, CEDAR_DARK)
    g.box(0.10, 1.20, 0.18, 1.02, 0.14, 0.52, OAK)
    // Legs
    for (const lx of [0.08, 1.14]) {
      g.box(lx, lx + 0.08, 0.0, 0.16, 0.08, 0.16, IRON)
      g.box(lx, lx + 0.08, 0.0, 0.16, 0.44, 0.52, IRON)
    }
    // Two shelves packed with colorful books
    const colors = [APPLE_RED, k(PLASTER, hue(14, 5)), FLOWER_SUN, LEAF_DEEP, FLOWER_VIOLET, TERRACOTTA, CREAM, k(PLASTER, hue(12, 4))]
    for (const sy of [0.24, 0.66]) {
      g.box(0.08, 1.22, sy - 0.05, sy, 0.10, 0.54, CEDAR)
      for (let i = 0; i < 12; i++) {
        const bx = 0.12 + i * 0.088
        const bh = 0.24 + (i % 3) * 0.04
        g.box(bx, bx + 0.068, sy, sy + bh, 0.16, 0.50, colors[i % colors.length])
      }
    }
    return finish(g)
  })()

  // 17. Grocery / Corner Store Produce Crate Stand (1.55 m x 1.05 m x 0.7 m, per=2)
  const groceryCrates = (() => {
    const g = makeGrid(1.55, 1.05, 0.7, 2)
    g.box(0.06, 1.49, 0.0, 0.56, 0.06, 0.64, CEDAR_DARK)
    const crates: [number, number][] = [
      [0.10, ORANGE_FRUIT], [0.46, APPLE_RED], [0.82, TURF], [1.18, LEMON],
    ]
    for (const [cx, fruit] of crates) {
      g.box(cx, cx + 0.32, 0.56, 0.78, 0.10, 0.60, OAK)
      g.box(cx + 0.04, cx + 0.28, 0.70, 0.94, 0.14, 0.54, fruit)
    }
    return finish(g)
  })()

  // 18. Wrought-Iron Projecting Blade Sign Bracket (0.95 m along x, 0.25 m tall, 0.14 m deep, per=2)
  const bladeBracket = (() => {
    const g = makeGrid(0.95, 0.25, 0.14, 2)
    g.box(0.0, 0.08, 0.0, 0.24, 0.02, 0.12, IRON)
    g.box(0.06, 0.94, 0.16, 0.22, 0.04, 0.10, IRON)
    g.box(0.06, 0.34, 0.06, 0.12, 0.04, 0.10, IRON)
    return finish(g, [0, g.H / 2, g.D / 2])
  })()

  cachedKit = {
    bench,
    pavilion,
    archway,
    festoon,
    planter,
    littleLibrary,
    fountain,
    waterFountain,
    picnicTable,
    bollard,
    deckPad,
    marketStalls,
    cafePatios,
    aframe,
    floristStand,
    bookCart,
    groceryCrates,
    bladeBracket,
  }
  return cachedKit
}
